#include "simulator/simulator.h"
#include "simulator/path_planner.h"
#include "simulator/animation_gen.h"
#include "collision/contact_graph.h"
#include "collision/blocking_matrix.h"
#include "classification/part_classifier.h"
#include "graph/dependency_graph.h"
#include "identical/geometry_signature.h"
#include "geometry/aabb.h"

#include <chrono>
#include <iostream>
#include <algorithm>
#include <cmath>
#include <numeric>

namespace carbon {

// --- Constants ---

static constexpr float APPROACH_TIME_FRACTION = 0.30f;
static constexpr float STAGING_MARGIN = 0.10f;

// --- Constructor ---

AssemblySimulator::AssemblySimulator(SimulatorConfig config)
    : config_(std::move(config)) {}

// --- Load assembly tree ---

void AssemblySimulator::load_assembly(const AssemblyNode& root) {
    parts_.clear();

    // Collect all part nodes
    std::vector<const AssemblyNode*> part_nodes = root.get_all_parts();

    for (const auto* node : part_nodes) {
        if (!node->mesh || node->mesh->empty()) continue;

        PartData pd;
        pd.id = node->id;
        pd.name = node->name;
        pd.mesh = &(*node->mesh);
        pd.transform = Isometry::from_matrix4(node->transform);

        AABB local_aabb = node->mesh->local_aabb();
        pd.bbox_size = local_aabb.size();
        pd.world_aabb = node->mesh->world_aabb(pd.transform);

        parts_.push_back(std::move(pd));
    }

    // Compute global assembly AABB
    if (!parts_.empty()) {
        global_aabb_ = parts_[0].world_aabb;
        for (size_t i = 1; i < parts_.size(); ++i) {
            global_aabb_ = global_aabb_.merged(parts_[i].world_aabb);
        }
        scene_diagonal_ = global_aabb_.diagonal();
    }

    std::cout << "[simulator] Loaded " << parts_.size() << " parts"
              << ", scene diagonal = " << scene_diagonal_ << std::endl;
}

// --- Compute auto removal distance ---

float AssemblySimulator::compute_removal_distance() const {
    if (config_.removal_distance > 0) return config_.removal_distance;
    // Auto: 2x smallest part dimension, clamped to scene scale
    float min_dim = std::numeric_limits<float>::max();
    for (const auto& p : parts_) {
        float pmin = p.bbox_size.minCoeff();
        if (pmin > 1e-6f) min_dim = std::min(min_dim, pmin);
    }
    return std::max(min_dim * 2.0f, scene_diagonal_ * 0.1f);
}

// --- Build neighbor states for a part ---

std::vector<NeighborState> AssemblySimulator::build_neighbor_states(
    const PartData& part,
    const ContactGraph& contacts) const {

    std::vector<NeighborState> neighbors;
    auto neighbor_ids = contacts.neighbors(part.id);

    for (const auto& nid : neighbor_ids) {
        // Skip removed parts
        if (removed_parts_.count(nid)) continue;

        // Find the neighbor's PartData
        const PartData* np = nullptr;
        for (const auto& p : parts_) {
            if (p.id == nid) { np = &p; break; }
        }
        if (!np) continue;

        NeighborState ns;
        ns.part = np;

        // Check baseline intersection
        ns.baseline_intersecting = mesh_intersects(
            *part.mesh, part.transform, *np->mesh, np->transform);

        // Compute baseline overlap volume
        if (ns.baseline_intersecting) {
            ns.baseline_overlap_volume = aabb_overlap_volume(part.world_aabb, np->world_aabb);
        } else {
            ns.baseline_overlap_volume = 0.0f;
        }

        // Relaxed clearance: 0 if near-contact, else use configured clearance
        float dist = mesh_distance(*part.mesh, part.transform, *np->mesh, np->transform);
        ns.relaxed_clearance = (dist < config_.clearance_epsilon * 2.0f)
            ? 0.0f : config_.clearance_epsilon;

        neighbors.push_back(ns);
    }

    return neighbors;
}

// --- Main simulation ---

SimulationResult AssemblySimulator::simulate() {
    auto start = std::chrono::steady_clock::now();
    SimulationResult result;
    result.success = false;

    if (parts_.empty()) {
        result.error = "No parts loaded";
        return result;
    }

    // --- 1. Build contact graph ---
    float threshold = scene_diagonal_ * 0.002f;
    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> part_tuples;
    for (const auto& p : parts_) {
        part_tuples.emplace_back(p.id, p.mesh, &p.transform);
    }
    auto contact_graph = ContactGraph::build(part_tuples, threshold);

    // --- 2. Classify all parts ---
    SequencingRules rules;
    float total_volume = 0.0f;
    for (const auto& p : parts_) {
        total_volume += p.bbox_size.x() * p.bbox_size.y() * p.bbox_size.z();
    }
    total_volume = std::max(total_volume, 0.001f);

    std::vector<std::pair<std::string, ClassificationInput>> class_inputs;
    for (const auto& p : parts_) {
        ClassificationInput ci;
        ci.name = p.name;
        ci.bbox_dims = p.bbox_size;
        ci.relative_volume = (p.bbox_size.x() * p.bbox_size.y() * p.bbox_size.z()) / total_volume;
        ci.contact_degree = contact_graph.degree(p.id);
        class_inputs.push_back({p.id, ci});
    }

    auto classifications = classify_all_parts(class_inputs, rules);

    // Infer kinds
    std::unordered_map<std::string, PartKind> kinds;
    for (const auto& [id, cls] : classifications) {
        // Find part name
        std::string name;
        for (const auto& p : parts_) {
            if (p.id == id) { name = p.name; break; }
        }
        kinds[id] = infer_part_kind(name, cls, rules);
    }

    // --- 3. Build dependency graph ---
    auto dep_graph = DependencyGraph::build(contact_graph, classifications, kinds);

    // --- 4. Auto-compute clearance ---
    if (config_.clearance_epsilon <= 0.0f) {
        float min_dim = std::numeric_limits<float>::max();
        for (const auto& p : parts_) {
            float pmin = p.bbox_size.minCoeff();
            if (pmin > 1e-6f) min_dim = std::min(min_dim, pmin);
        }
        config_.clearance_epsilon = std::max(min_dim * 0.02f, 1e-4f);
    }

    // --- 5. Build blocking matrix ---
    float removal_dist = compute_removal_distance();
    std::vector<BlockingPartData> blocking_parts;
    for (const auto& p : parts_) {
        blocking_parts.push_back({p.id, p.mesh, p.transform, p.world_aabb});
    }
    auto blocking_matrix = BlockingMatrix::build(
        blocking_parts, removal_dist, config_.clearance_epsilon);

    // --- 6. Detect initial overlap issues ---
    for (const auto& edge : contact_graph.edges()) {
        if (edge.distance <= 0.0f) {
            // Parts are touching/overlapping — check if truly intersecting
            const PartData* pa = nullptr;
            const PartData* pb = nullptr;
            for (const auto& p : parts_) {
                if (p.id == edge.part_a) pa = &p;
                if (p.id == edge.part_b) pb = &p;
            }
            if (pa && pb && mesh_intersects(*pa->mesh, pa->transform, *pb->mesh, pb->transform)) {
                SimulationIssue issue;
                issue.kind = SimulationIssueKind::Overlap;
                issue.severity = SimulationIssueSeverity::Warning;
                issue.part_ids = {edge.part_a, edge.part_b};
                issue.message = "Parts overlap at rest position";
                result.issues.push_back(issue);
            }
        }
    }

    // --- 7. Main disassembly loop ---
    removed_parts_.clear();
    collision_checks_ = 0;
    path_evaluations_ = 0;
    blocking_matrix_skips_ = 0;

    // Pre-compute fastener preferred directions from contact normals.
    // Ports Rust simulator.rs:958-977: sum "away from neighbor" normals
    // for each fastener to find its natural removal axis.
    std::unordered_map<std::string, Vec3> preferred_directions;
    for (const auto& [id, kind] : kinds) {
        if (kind != PartKind::Fastener) continue;
        Vec3 weighted_dir = Vec3::Zero();
        for (const auto& edge : contact_graph.edges()) {
            if (edge.part_a != id && edge.part_b != id) continue;
            Vec3 away = (edge.part_a == id) ? -edge.estimated_normal : edge.estimated_normal;
            weighted_dir += away;
        }
        if (weighted_dir.squaredNorm() > 1e-8f) {
            preferred_directions[id] = weighted_dir.normalized();
        }
    }

    std::vector<AssemblyStep> disassembly_steps;
    uint32_t step_number = 0;

    while (removed_parts_.size() < parts_.size()) {
        // Check timeout
        auto now = std::chrono::steady_clock::now();
        auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
        if (static_cast<uint64_t>(elapsed_ms) > config_.timeout_ms) {
            result.error = "Simulation timed out after " + std::to_string(elapsed_ms) + "ms";
            break;
        }

        // Find removable parts
        struct RemovableCandidate {
            std::string id;
            Vec3 direction;
            PathEvaluation eval;
            float quality;
        };

        std::vector<RemovableCandidate> removable;

        // Sort parts by disassembly priority (fasteners first)
        std::vector<size_t> part_indices(parts_.size());
        std::iota(part_indices.begin(), part_indices.end(), 0);
        std::sort(part_indices.begin(), part_indices.end(), [&](size_t a, size_t b) {
            auto ka = kinds.count(parts_[a].id) ? kinds.at(parts_[a].id) : PartKind::Unknown;
            auto kb = kinds.count(parts_[b].id) ? kinds.at(parts_[b].id) : PartKind::Unknown;
            auto ca = classifications.count(parts_[a].id) ? classifications.at(parts_[a].id) : PartClassification{};
            auto cb = classifications.count(parts_[b].id) ? classifications.at(parts_[b].id) : PartClassification{};
            return disassembly_priority(ka, ca) > disassembly_priority(kb, cb);
        });

        for (size_t idx : part_indices) {
            const auto& part = parts_[idx];
            if (removed_parts_.count(part.id)) continue;

            // Check dependency constraints
            if (!dep_graph.can_disassemble(part.id, removed_parts_)) continue;

            // Blocking matrix pre-filter
            if (blocking_matrix.is_blocked_in_all_directions(part.id, removed_parts_)) {
                blocking_matrix_skips_++;
                continue;
            }

            // Generate candidate directions
            auto directions = candidate_directions_for_part(part, contact_graph, kinds);

            // Build neighbor states (excluding removed parts)
            auto neighbors = build_neighbor_states(part, contact_graph);

            // Evaluate each direction
            RemovableCandidate best;
            best.quality = -1.0f;

            // Look up fastener preferred direction for alignment bonus
            auto pref_it = preferred_directions.find(part.id);

            for (const auto& dir : directions) {
                path_evaluations_++;

                auto eval = evaluate_removal_path(
                    part, dir, removal_dist, config_.clearance_epsilon,
                    neighbors, collision_checks_);

                if (!eval) continue;

                float ratio = eval->travel_distance / std::max(removal_dist, 1e-6f);
                float quality = ratio;
                if (eval->min_clearance) {
                    quality += *eval->min_clearance * 1e-3f;
                }

                // Fastener alignment bonus: prefer removal along preferred axis
                // Ports Rust simulator.rs:1011-1020
                if (pref_it != preferred_directions.end()) {
                    float alignment = dir.dot(pref_it->second);
                    quality += (alignment + 1.0f) * 0.025f;
                }

                if (quality > best.quality + 0.01f) {
                    best.id = part.id;
                    best.direction = dir;
                    best.eval = *eval;
                    best.quality = quality;
                }

                // Short-circuit on near-perfect path
                if (ratio >= 0.999f) break;
            }

            if (best.quality > 0.0f) {
                removable.push_back(std::move(best));
                // Don't break — collect ALL removable parts this iteration
            }
        }

        if (removable.empty()) {
            // Stuck — collect remaining parts
            for (const auto& p : parts_) {
                if (!removed_parts_.count(p.id)) {
                    result.stuck_parts.push_back(p.id);
                }
            }
            break;
        }

        // Sort by quality (best first) and batch-remove all candidates
        std::sort(removable.begin(), removable.end(),
            [](const RemovableCandidate& a, const RemovableCandidate& b) {
                return a.quality > b.quality;
            });

        for (const auto& candidate : removable) {
            removed_parts_.insert(candidate.id);

            AssemblyStep step;
            step.step_number = ++step_number;
            step.part_ids = {candidate.id};

            // Find part name
            for (const auto& p : parts_) {
                if (p.id == candidate.id) {
                    step.part_names = {p.name};
                    break;
                }
            }

            step.assembly_direction = {
                candidate.direction.x(),
                candidate.direction.y(),
                candidate.direction.z()
            };
            step.animation_path = candidate.eval.animation_path;
            step.min_clearance = candidate.eval.min_clearance;
            step.suggested_duration_ms = compute_step_duration(
                candidate.eval.travel_distance, scene_diagonal_);

            disassembly_steps.push_back(std::move(step));
        }
    }

    // --- 8. Reverse steps for assembly order ---
    std::reverse(disassembly_steps.begin(), disassembly_steps.end());
    for (size_t i = 0; i < disassembly_steps.size(); ++i) {
        disassembly_steps[i].step_number = static_cast<uint32_t>(i + 1);

        // Reverse and flip animation keyframe times
        auto& kf = disassembly_steps[i].animation_path;
        std::reverse(kf.begin(), kf.end());
        for (auto& f : kf) {
            f.time = 1.0f - f.time;
        }

        // Negate assembly direction (insertion is opposite of removal)
        for (int j = 0; j < 3; ++j) {
            disassembly_steps[i].assembly_direction[j] = -disassembly_steps[i].assembly_direction[j];
        }
    }

    result.steps = std::move(disassembly_steps);

    // --- 9. Identical groups, subassemblies, kits ---
    // Identical geometry groups
    std::vector<std::pair<std::string, const TriMesh*>> sig_parts;
    for (const auto& p : parts_) {
        sig_parts.push_back({p.id, p.mesh});
    }
    result.identical_groups = find_identical_groups(sig_parts);

    // Subassemblies via label propagation
    result.suggested_subassemblies = contact_graph.detect_subassemblies(kinds);

    // Fastener kits via BFS
    result.kits = contact_graph.detect_kits(kinds);

    // --- 10. Finalize ---
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start
    ).count();

    result.simulation_time_ms = static_cast<uint64_t>(elapsed);
    result.success = result.stuck_parts.empty();

    PlannerStats stats;
    stats.contact_edges = contact_graph.edge_count();
    stats.dependency_edges = dep_graph.edge_count();
    stats.candidate_paths_evaluated = path_evaluations_;
    stats.collision_checks = collision_checks_;
    stats.overlap_issue_count = result.issues.size();
    stats.blocking_matrix_skips = blocking_matrix_skips_;
    result.planner_stats = stats;

    if (!result.success && !result.error) {
        result.error = std::to_string(result.stuck_parts.size()) + " parts could not be sequenced";
    }

    std::cout << "[simulator] Complete: " << result.steps.size() << " steps, "
              << result.stuck_parts.size() << " stuck, "
              << elapsed << "ms" << std::endl;

    return result;
}

} // namespace carbon
