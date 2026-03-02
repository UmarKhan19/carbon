#include "simulator/simulator.h"
#include "simulator/path_planner.h"
#include "simulator/animation_gen.h"
#include "simulator/bfs_planner.h"
#include "simulator/rrt_planner.h"
#include "collision/contact_graph.h"
#include "collision/blocking_matrix.h"
#include "collision/sdf_collision.h"
#include "classification/part_classifier.h"
#include "graph/dependency_graph.h"
#include "identical/geometry_signature.h"
#include "geometry/aabb.h"

#include <chrono>
#include <deque>
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

    // Collect all part nodes with composed world transforms.
    // get_all_parts_world() walks the tree and multiplies parent transforms
    // so that nested sub-assembly positioning is correctly accumulated.
    auto parts_with_transforms = root.get_all_parts_world();

    for (const auto& [node, world_transform] : parts_with_transforms) {
        if (!node->mesh || node->mesh->empty()) continue;

        PartData pd;
        pd.id = node->id;
        pd.name = node->name;
        pd.mesh = &(*node->mesh);
        pd.transform = Isometry::from_matrix4(world_transform);

        AABB local_aabb = node->mesh->local_aabb();
        pd.bbox_size = local_aabb.size();
        pd.world_aabb = node->mesh->world_aabb(pd.transform);
        pd.brep_analysis = node->metadata.brep_analysis;
        std::cout << "[load_debug] Part '" << pd.name << "'"
                  << " has_brep=" << pd.brep_analysis.has_value();
        if (pd.brep_analysis.has_value()) {
            std::cout << " vol=" << pd.brep_analysis->volume
                      << " faces=" << pd.brep_analysis->total_faces
                      << " threads=" << pd.brep_analysis->has_threads;
        }
        std::cout << std::endl;

        parts_.push_back(std::move(pd));
    }

    // Build part lookup map
    part_map_.clear();
    for (const auto& p : parts_) {
        part_map_[p.id] = &p;
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

    // A4: Scene dump for diagnostics
    std::cout << "[scene] === PART SCENE DUMP ===" << std::endl;
    for (size_t i = 0; i < parts_.size(); i++) {
        const auto& p = parts_[i];
        Vec3 center = (p.world_aabb.min + p.world_aabb.max) * 0.5f;
        Vec3 sizes = p.world_aabb.size();
        std::cout << "[scene] [" << i << "] '" << p.name << "'"
                  << " center=(" << center.x() << "," << center.y() << "," << center.z() << ")"
                  << " size=(" << sizes.x() << "," << sizes.y() << "," << sizes.z() << ")"
                  << " diag=" << p.world_aabb.diagonal()
                  << std::endl;
    }
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
        const PartData* np = part_map_.count(nid) ? part_map_.at(nid) : nullptr;
        if (!np) continue;

        // Pre-build cached CGAL mesh + AABB tree for this neighbor (static pose)
        auto cached = build_collision_mesh(*np->mesh, np->transform);

        NeighborState ns;
        ns.part = np;
        ns.cached_mesh = cached;

        // Check baseline intersection with depth threshold.
        // Shallow mesh overlap at contact surfaces (tessellation artifact)
        // is NOT counted as baseline-intersecting.
        bool raw_intersects = mesh_intersects_cached(
            *part.mesh, part.transform, *cached);
        if (raw_intersects) {
            AABB overlap;
            overlap.min = part.world_aabb.min.cwiseMax(np->world_aabb.min);
            overlap.max = part.world_aabb.max.cwiseMin(np->world_aabb.max);
            Vec3 overlap_size = overlap.size();
            float min_extent = std::min({overlap_size.x(), overlap_size.y(), overlap_size.z()});
            float small_diag = std::min(part.world_aabb.diagonal(), np->world_aabb.diagonal());
            float threshold = small_diag * 0.05f;
            ns.baseline_intersecting = (min_extent > threshold);
        } else {
            ns.baseline_intersecting = false;
        }

        // Compute baseline overlap volume
        if (ns.baseline_intersecting) {
            ns.baseline_overlap_volume = aabb_overlap_volume(part.world_aabb, np->world_aabb);
        } else {
            ns.baseline_overlap_volume = 0.0f;
        }

        // Relaxed clearance: 0 if near-contact, else use configured clearance
        float dist = mesh_distance_cached(*part.mesh, part.transform, *cached);
        ns.relaxed_clearance = (dist < config_.clearance_epsilon * 2.0f)
            ? 0.0f : config_.clearance_epsilon;

        neighbors.push_back(std::move(ns));
    }

    return neighbors;
}

// --- Physics-based path planning ---

bool AssemblySimulator::try_physics_path(
    const PartData& part,
    int retry_count,
    Vec3& out_direction,
    PathEvaluation& out_eval,
    const std::unordered_map<std::string, std::shared_ptr<CachedSDFMesh>>& part_sdfs) {

    // Filter precomputed SDFs to non-removed, nearby parts
    std::vector<std::shared_ptr<CachedSDFMesh>> obstacles;
    float margin = compute_removal_distance() * 1.5f;
    for (const auto& other : parts_) {
        if (other.id == part.id) continue;
        if (removed_parts_.count(other.id)) continue;
        if (!part.world_aabb.overlaps(other.world_aabb, margin)) continue;

        auto it = part_sdfs.find(other.id);
        if (it != part_sdfs.end()) {
            obstacles.push_back(it->second);
        }
    }

    // Scale search budget aggressively with retry count
    int depth_scale = 1 + retry_count * 2;

    // Try BFS first
    BFSPlannerConfig bfs_cfg;
    bfs_cfg.separation_distance = compute_removal_distance();
    bfs_cfg.max_bfs_depth = 100 * depth_scale;
    bfs_cfg.max_states = 10000 * depth_scale;
    bfs_cfg.force_magnitude = 50.0f;
    bfs_cfg.sim_steps_per_action = 10;

    auto bfs_result = plan_bfs(*part.mesh, part.transform, obstacles, bfs_cfg);
    if (bfs_result.success) {
        out_direction = bfs_result.final_direction;
        // Build animation path from trajectory
        out_eval.success = true;
        out_eval.travel_distance = bfs_cfg.separation_distance;
        out_eval.required_distance = bfs_cfg.separation_distance;

        float n = static_cast<float>(bfs_result.trajectory.size());
        for (size_t i = 0; i < bfs_result.trajectory.size(); ++i) {
            float t = (n > 1) ? static_cast<float>(i) / (n - 1.0f) : 0.0f;
            Isometry pose;
            pose.translation = bfs_result.trajectory[i].position;
            pose.rotation = bfs_result.trajectory[i].orientation;
            out_eval.animation_path.push_back({t, pose.to_matrix4()});
        }

        std::cout << "[physics] BFS succeeded for '" << part.name
                  << "' (depth=" << bfs_result.depth
                  << ", states=" << bfs_result.states_explored << ")" << std::endl;
        return true;
    }

    // Try RRT if BFS fails
    RRTPlannerConfig rrt_cfg;
    rrt_cfg.separation_distance = compute_removal_distance();
    rrt_cfg.max_iterations = 10000 * depth_scale;
    rrt_cfg.force_magnitude = 50.0f;
    rrt_cfg.sim_steps_per_extend = 10;
    rrt_cfg.pos_range = compute_removal_distance() * 2.0f;

    auto rrt_result = plan_rrt(*part.mesh, part.transform, obstacles, rrt_cfg);
    if (rrt_result.success) {
        out_direction = rrt_result.final_direction;
        out_eval.success = true;
        out_eval.travel_distance = rrt_cfg.separation_distance;
        out_eval.required_distance = rrt_cfg.separation_distance;

        float n = static_cast<float>(rrt_result.trajectory.size());
        for (size_t i = 0; i < rrt_result.trajectory.size(); ++i) {
            float t = (n > 1) ? static_cast<float>(i) / (n - 1.0f) : 0.0f;
            Isometry pose;
            pose.translation = rrt_result.trajectory[i].position;
            pose.rotation = rrt_result.trajectory[i].orientation;
            out_eval.animation_path.push_back({t, pose.to_matrix4()});
        }

        std::cout << "[physics] RRT succeeded for '" << part.name
                  << "' (iters=" << rrt_result.iterations
                  << ", tree=" << rrt_result.tree_size << ")" << std::endl;
        return true;
    }

    return false;
}

// --- SDF validation gate ---

/// SDF cross-validation of a geometric removal path.
/// Samples multiple points along the path against precomputed SDFs.
/// Returns true if the path is clean (no clipping detected at any sample).
static bool validate_path_with_sdf(
    const PartData& part,
    const Vec3& direction,
    float travel,
    const std::vector<PartData>& all_parts,
    const std::unordered_set<std::string>& removed,
    const std::unordered_set<std::string>& baseline_neighbors,
    const std::unordered_map<std::string, std::shared_ptr<CachedSDFMesh>>& sdfs) {

    // Sample N points along the path: every ~10 units, minimum 5 samples
    int num_samples = std::max(5, static_cast<int>(travel / 10.0f));

    for (int i = 1; i <= num_samples; ++i) {
        float t = static_cast<float>(i) / static_cast<float>(num_samples);
        Isometry pose = part.transform;
        pose.translation += direction * (travel * t);

        for (const auto& obs : all_parts) {
            if (obs.id == part.id || removed.count(obs.id)) continue;
            if (baseline_neighbors.count(obs.id)) continue;
            auto it = sdfs.find(obs.id);
            if (it == sdfs.end()) continue;
            if (sdf_mesh_intersects(*part.mesh, pose, *it->second)) {
                return false;
            }
        }
    }

    return true;
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

    // --- 2. Auto-compute clearance ---
    if (config_.clearance_epsilon <= 0.0f) {
        float min_dim = std::numeric_limits<float>::max();
        for (const auto& p : parts_) {
            float pmin = p.bbox_size.minCoeff();
            if (pmin > 1e-6f) min_dim = std::min(min_dim, pmin);
        }
        config_.clearance_epsilon = std::max(min_dim * 0.02f, 1e-4f);
    }

    // --- 3. Build blocking matrix ---
    float removal_dist = compute_removal_distance();
    std::vector<BlockingPartData> blocking_parts;
    for (const auto& p : parts_) {
        blocking_parts.push_back({p.id, p.mesh, p.transform, p.world_aabb});
    }
    auto blocking_matrix = BlockingMatrix::build(
        blocking_parts, removal_dist, config_.clearance_epsilon);

    // --- 4. Detect initial overlap issues ---
    for (const auto& edge : contact_graph.edges()) {
        if (edge.distance <= 0.0f) {
            // Parts are touching/overlapping — check if truly intersecting
            auto pa_it = part_map_.find(edge.part_a);
            auto pb_it = part_map_.find(edge.part_b);
            const PartData* pa = (pa_it != part_map_.end()) ? pa_it->second : nullptr;
            const PartData* pb = (pb_it != part_map_.end()) ? pb_it->second : nullptr;
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

    // --- 5. Precompute SDFs for physics planners ---
    std::unordered_map<std::string, std::shared_ptr<CachedSDFMesh>> part_sdfs;
    for (const auto& p : parts_) {
        part_sdfs[p.id] = build_sdf_mesh(*p.mesh, p.transform);
    }

    // --- 6. Main disassembly loop ---

    // Compute assembly centroid for outsideness heuristic (ASAP-style).
    // Parts furthest from centroid are tried first — they're most likely
    // to be exterior and removable without obstruction.
    Vec3 assembly_centroid = Vec3::Zero();
    for (const auto& p : parts_) {
        assembly_centroid += p.transform.translation;
    }
    assembly_centroid /= static_cast<float>(parts_.size());

    removed_parts_.clear();
    collision_checks_ = 0;
    path_evaluations_ = 0;
    blocking_matrix_skips_ = 0;

    std::vector<AssemblyStep> disassembly_steps;
    uint32_t step_number = 0;

    // Helper: try geometric removal for a single part. Returns true if path found.
    struct RemovableCandidate {
        std::string id;
        Vec3 direction;
        PathEvaluation eval;
        float quality;
    };

    auto try_geometric_removal = [&](const PartData& part) -> std::optional<RemovableCandidate> {
        // Blocking matrix pre-filter (purely geometric, no classification)
        if (blocking_matrix.is_blocked_in_all_directions(part.id, removed_parts_)) {
            blocking_matrix_skips_++;
            return std::nullopt;
        }

        // Generate candidate directions — full set for all parts
        auto directions = candidate_directions_for_part(part, contact_graph);

        // Build neighbor states (excluding removed parts)
        auto neighbors = build_neighbor_states(part, contact_graph);

        // Collect all passing candidates, sorted by quality (best first)
        std::vector<RemovableCandidate> candidates;

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

            if (quality > 0.0f) {
                RemovableCandidate c;
                c.id = part.id;
                c.direction = dir;
                c.eval = *eval;
                c.quality = quality;
                candidates.push_back(std::move(c));
            }
        }

        // Sort by quality descending
        std::sort(candidates.begin(), candidates.end(),
            [](const RemovableCandidate& a, const RemovableCandidate& b) {
                return a.quality > b.quality;
            });

        // A1: Per-part collision audit (log once for best candidate)
        int baseline_count = 0, checked_count = 0;
        if (!candidates.empty()) {
            const auto& best = candidates[0];
            for (const auto& ns : neighbors) {
                if (ns.baseline_intersecting) baseline_count++;
                else checked_count++;
            }
            std::cout << "[path_audit] '" << part.name << "'"
                      << " dir=(" << best.direction.x() << "," << best.direction.y() << "," << best.direction.z() << ")"
                      << " neighbors=" << neighbors.size()
                      << " baseline_skipped=" << baseline_count
                      << " checked=" << checked_count
                      << " travel=" << best.eval.travel_distance
                      << " candidates=" << candidates.size()
                      << std::endl;
        }

        // Fix 1: If ALL neighbors are baseline-intersecting, the geometric planner
        // has zero collision data. Skip it entirely and force physics planner.
        if (checked_count == 0 && baseline_count > 0) {
            std::cout << "[blind_skip] '" << part.name
                      << "' has 0 checked neighbors (" << baseline_count
                      << " baseline) — forcing physics planner" << std::endl;
            return std::nullopt;
        }

        // Build baseline-intersecting neighbor set for SDF gate exclusion
        std::unordered_set<std::string> baseline_ids;
        for (const auto& ns : neighbors) {
            if (ns.baseline_intersecting) {
                baseline_ids.insert(ns.part->id);
            }
        }

        // B2: SDF validation gate — try each candidate in quality order
        for (const auto& candidate : candidates) {
            bool sdf_ok = validate_path_with_sdf(
                part, candidate.direction, candidate.eval.travel_distance,
                parts_, removed_parts_, baseline_ids, part_sdfs);

            if (sdf_ok) {
                return candidate;
            }

            std::cout << "[sdf_gate] Rejected geometric result for '" << part.name
                      << "' dir=(" << candidate.direction.x() << "," << candidate.direction.y()
                      << "," << candidate.direction.z() << ") — SDF detected clipping" << std::endl;
        }

        // All geometric directions rejected by SDF — fall through to physics
        return std::nullopt;
    };

    // Helper: log and record a removal step
    auto record_removal = [&](const RemovableCandidate& candidate) {
        removed_parts_.insert(candidate.id);

        auto rp_it = part_map_.find(candidate.id);
        const PartData* removed_part = (rp_it != part_map_.end()) ? rp_it->second : nullptr;
        if (removed_part) {
            Vec3 start_pos = removed_part->transform.translation;
            Vec3 end_pos = start_pos + candidate.direction * candidate.eval.travel_distance;
            std::cout << "[disassembly] Remove step " << step_number + 1
                      << ": \"" << removed_part->name << "\""
                      << " | dir=(" << candidate.direction.x()
                      << ", " << candidate.direction.y()
                      << ", " << candidate.direction.z() << ")"
                      << " | start=(" << start_pos.x()
                      << ", " << start_pos.y()
                      << ", " << start_pos.z() << ")"
                      << " | end=(" << end_pos.x()
                      << ", " << end_pos.y()
                      << ", " << end_pos.z() << ")"
                      << " | travel=" << candidate.eval.travel_distance
                      << " | quality=" << candidate.quality
                      << std::endl;
        }

        AssemblyStep step;
        step.step_number = ++step_number;
        step.part_ids = {candidate.id};
        if (removed_part) {
            step.part_names = {removed_part->name};
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
    };

    if (config_.strategy == SequenceStrategy::Current) {
        // --- Original single-pass approach (no retries) ---
        while (removed_parts_.size() < parts_.size()) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
            if (static_cast<uint64_t>(elapsed_ms) > config_.timeout_ms) {
                result.error = "Simulation timed out after " + std::to_string(elapsed_ms) + "ms";
                break;
            }

            std::vector<RemovableCandidate> removable;

            // Sort parts by outsideness (furthest from centroid first)
            std::vector<size_t> part_indices(parts_.size());
            std::iota(part_indices.begin(), part_indices.end(), 0);
            std::sort(part_indices.begin(), part_indices.end(), [&](size_t a, size_t b) {
                float da = (parts_[a].transform.translation - assembly_centroid).squaredNorm();
                float db = (parts_[b].transform.translation - assembly_centroid).squaredNorm();
                return da > db;  // exterior parts first
            });

            for (size_t idx : part_indices) {
                const auto& part = parts_[idx];
                if (removed_parts_.count(part.id)) continue;

                auto candidate = try_geometric_removal(part);
                if (candidate) {
                    removable.push_back(std::move(*candidate));
                }
            }

            if (removable.empty()) {
                for (const auto& p : parts_) {
                    if (!removed_parts_.count(p.id)) {
                        result.stuck_parts.push_back(p.id);
                    }
                }
                break;
            }

            std::sort(removable.begin(), removable.end(),
                [](const RemovableCandidate& a, const RemovableCandidate& b) {
                    return a.quality > b.quality;
                });

            for (const auto& candidate : removable) {
                record_removal(candidate);
            }
        }
    } else {
        // --- Queue / ProgressiveQueue strategies ---
        // Build initial queue sorted by outsideness (furthest from centroid first)
        std::vector<size_t> sorted_indices(parts_.size());
        std::iota(sorted_indices.begin(), sorted_indices.end(), 0);
        std::sort(sorted_indices.begin(), sorted_indices.end(), [&](size_t a, size_t b) {
            float da = (parts_[a].transform.translation - assembly_centroid).squaredNorm();
            float db = (parts_[b].transform.translation - assembly_centroid).squaredNorm();
            return da > db;  // exterior parts first
        });
        std::deque<size_t> queue;
        for (size_t idx : sorted_indices) {
            queue.push_back(idx);
        }

        // Track retry counts per part
        std::unordered_map<std::string, int> retry_counts;
        size_t stall_counter = 0;  // counts consecutive failures without progress

        while (!queue.empty()) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
            if (static_cast<uint64_t>(elapsed_ms) > config_.timeout_ms) {
                result.error = "Simulation timed out after " + std::to_string(elapsed_ms) + "ms";
                break;
            }

            // If we've gone through the entire queue with no progress, we're stuck
            if (stall_counter >= queue.size()) {
                for (size_t idx : queue) {
                    if (!removed_parts_.count(parts_[idx].id)) {
                        result.stuck_parts.push_back(parts_[idx].id);
                    }
                }
                break;
            }

            size_t idx = queue.front();
            queue.pop_front();

            const auto& part = parts_[idx];
            if (removed_parts_.count(part.id)) {
                stall_counter = 0;  // removed parts don't count as stalls
                continue;
            }

            // Try geometric approach first
            auto candidate = try_geometric_removal(part);

            // If geometric fails, try physics immediately (primary, not fallback)
            if (!candidate &&
                config_.strategy == SequenceStrategy::ProgressiveQueue) {
                int retries = retry_counts[part.id];
                Vec3 phys_dir;
                PathEvaluation phys_eval;
                if (try_physics_path(part, retries, phys_dir, phys_eval, part_sdfs)) {
                    RemovableCandidate phys_candidate;
                    phys_candidate.id = part.id;
                    phys_candidate.direction = phys_dir;
                    phys_candidate.eval = phys_eval;
                    phys_candidate.quality = 0.5f;  // lower than geometric
                    candidate = phys_candidate;
                }
            }

            if (candidate) {
                record_removal(*candidate);
                stall_counter = 0;
                retry_counts.erase(part.id);
            } else {
                // Failed — re-queue with incremented retry count
                int& retries = retry_counts[part.id];
                retries++;
                if (retries > config_.max_retries) {
                    // Give up on this part
                    result.stuck_parts.push_back(part.id);
                    stall_counter++;
                } else {
                    queue.push_back(idx);
                    stall_counter++;
                }
            }
        }
    }

    // --- Log disassembly order summary (BEFORE reversal) ---
    std::cout << "\n=== DISASSEMBLY ORDER (before reverse) ===" << std::endl;
    for (const auto& s : disassembly_steps) {
        std::string name = s.part_names.empty() ? s.part_ids[0] : s.part_names[0];
        std::cout << "  Step " << s.step_number << ": " << name
                  << " | removal dir=(" << s.assembly_direction[0]
                  << ", " << s.assembly_direction[1]
                  << ", " << s.assembly_direction[2] << ")" << std::endl;
    }
    if (!result.stuck_parts.empty()) {
        std::cout << "  STUCK: ";
        for (const auto& sp : result.stuck_parts) std::cout << sp << " ";
        std::cout << std::endl;
    }

    // --- 7. Reverse steps for assembly order ---
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

    // --- Log assembly order summary (AFTER reversal) ---
    std::cout << "\n=== ASSEMBLY ORDER (after reverse) ===" << std::endl;
    for (const auto& s : disassembly_steps) {
        std::string name = s.part_names.empty() ? s.part_ids[0] : s.part_names[0];
        std::cout << "  Step " << s.step_number << ": " << name
                  << " | insert dir=(" << s.assembly_direction[0]
                  << ", " << s.assembly_direction[1]
                  << ", " << s.assembly_direction[2] << ")" << std::endl;
    }
    std::cout << std::endl;

    result.steps = std::move(disassembly_steps);

    // --- Post-planning: classify parts for display labels ---
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
        ci.brep = p.brep_analysis;
        class_inputs.push_back({p.id, ci});
    }

    auto classifications = classify_all_parts(class_inputs, rules);

    std::unordered_map<std::string, PartKind> kinds;
    for (const auto& [id, cls] : classifications) {
        auto it = part_map_.find(id);
        std::string name = (it != part_map_.end()) ? it->second->name : "";
        kinds[id] = infer_part_kind(name, cls, rules);
    }

    // Log classifications (display only, no effect on planning)
    std::cout << "\n=== PART CLASSIFICATIONS (display only) ===" << std::endl;
    for (const auto& p : parts_) {
        auto kind_it = kinds.find(p.id);
        const char* kind_str = "Unknown";
        if (kind_it != kinds.end()) {
            switch (kind_it->second) {
                case PartKind::Fastener:   kind_str = "Fastener"; break;
                case PartKind::Structural: kind_str = "Structural"; break;
                case PartKind::Panel:      kind_str = "Panel"; break;
                case PartKind::Unknown:    kind_str = "Unknown"; break;
            }
        }
        auto cls_it = classifications.find(p.id);
        if (cls_it != classifications.end()) {
            std::cout << "  \"" << p.name << "\" [" << kind_str << "]"
                      << " fastener=" << cls_it->second.fastener_score
                      << " structural=" << cls_it->second.structural_score
                      << " panel=" << cls_it->second.panel_score
                      << std::endl;
        }
    }

    // Build dependency graph for stats/logging only
    auto dep_graph = DependencyGraph::build(contact_graph, classifications, kinds);

    std::cout << "\n=== DEPENDENCY GRAPH EDGES (display only) ===" << std::endl;
    for (const auto& [from_id, tos] : dep_graph.forward_edges()) {
        auto from_it = part_map_.find(from_id);
        std::string from_name = (from_it != part_map_.end()) ? from_it->second->name : from_id;
        for (const auto& to_id : tos) {
            auto to_it = part_map_.find(to_id);
            std::string to_name = (to_it != part_map_.end()) ? to_it->second->name : to_id;
            std::cout << "  " << from_name << " -> " << to_name << std::endl;
        }
    }
    std::cout << std::endl;

    // --- Identical groups, subassemblies, kits ---
    std::vector<std::pair<std::string, const TriMesh*>> sig_parts;
    for (const auto& p : parts_) {
        sig_parts.push_back({p.id, p.mesh});
    }
    result.identical_groups = find_identical_groups(sig_parts);
    result.suggested_subassemblies = contact_graph.detect_subassemblies(kinds);
    result.kits = contact_graph.detect_kits(kinds);

    // --- Finalize ---
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
