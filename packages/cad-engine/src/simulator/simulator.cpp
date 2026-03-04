#include "simulator/simulator.h"
#include "simulator/animation_gen.h"
#include "simulator/bfs_planner.h"
#include "simulator/rrt_planner.h"
#include "collision/contact_graph.h"
#include "collision/sdf_collision.h"
#include "classification/part_classifier.h"
#include "graph/dependency_graph.h"
#include "identical/geometry_signature.h"
#include "geometry/aabb.h"

#include <chrono>
#include <iostream>
#include <algorithm>
#include <numeric>

namespace carbon {

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

    Vec3 aabb_center = (part.world_aabb.min + part.world_aabb.max) * 0.5f;
    int null_obs = 0, empty_sdf_obs = 0;
    for (const auto& o : obstacles) {
        if (!o) null_obs++;
        else if (o->sdf.empty()) empty_sdf_obs++;
    }
    std::cout << "[physics] Planning for '" << part.name << "'"
              << " center=(" << aabb_center.x()
              << "," << aabb_center.y()
              << "," << aabb_center.z() << ")"
              << " xform=(" << part.transform.translation.x()
              << "," << part.transform.translation.y()
              << "," << part.transform.translation.z() << ")"
              << " obstacles=" << obstacles.size()
              << " (null=" << null_obs << " empty_sdf=" << empty_sdf_obs << ")"
              << " removal_dist=" << compute_removal_distance()
              << " retry=" << retry_count << std::endl;

    // Scale search budget aggressively with retry count
    int depth_scale = 1 + retry_count * 2;

    // Try BFS first
    BFSPlannerConfig bfs_cfg;
    bfs_cfg.separation_distance = compute_removal_distance();
    bfs_cfg.max_bfs_depth = 100 * depth_scale;
    bfs_cfg.max_states = 10000 * depth_scale;
    bfs_cfg.force_magnitude = 50.0f;
    // sim_steps_per_action uses header default (100) — do NOT override to 10

    auto bfs_result = plan_bfs(*part.mesh, part.transform, obstacles, bfs_cfg);
    if (bfs_result.success) {
        out_direction = bfs_result.final_direction;
        // Build animation path from trajectory
        out_eval.success = true;
        Vec3 bfs_disp = bfs_result.trajectory.back().position - bfs_result.trajectory.front().position;
        out_eval.travel_distance = bfs_disp.norm();
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
    // sim_steps_per_extend uses header default (100) — do NOT override to 10
    rrt_cfg.pos_range = compute_removal_distance() * 2.0f;

    auto rrt_result = plan_rrt(*part.mesh, part.transform, obstacles, rrt_cfg);
    if (rrt_result.success) {
        out_direction = rrt_result.final_direction;
        out_eval.success = true;
        Vec3 rrt_disp = rrt_result.trajectory.back().position - rrt_result.trajectory.front().position;
        out_eval.travel_distance = rrt_disp.norm();
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

    // --- 3. Compute removal distance ---
    float removal_dist = compute_removal_distance();

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

    // --- 6. Physics-only greedy disassembly loop ---

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

    struct RemovableCandidate {
        std::string id;
        Vec3 direction;
        PathEvaluation eval;
        float quality;
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

    // Physics-only greedy loop: sort by outsideness, try physics removal on each part
    int retry_count = 0;

    while (removed_parts_.size() < parts_.size()) {
        auto now = std::chrono::steady_clock::now();
        auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
        if (static_cast<uint64_t>(elapsed_ms) > config_.timeout_ms) {
            result.error = "Simulation timed out after " + std::to_string(elapsed_ms) + "ms";
            break;
        }

        // Sort remaining parts by outsideness (furthest from centroid first)
        std::vector<size_t> remaining_indices;
        for (size_t i = 0; i < parts_.size(); ++i) {
            if (!removed_parts_.count(parts_[i].id)) {
                remaining_indices.push_back(i);
            }
        }
        std::sort(remaining_indices.begin(), remaining_indices.end(), [&](size_t a, size_t b) {
            float da = (parts_[a].transform.translation - assembly_centroid).squaredNorm();
            float db = (parts_[b].transform.translation - assembly_centroid).squaredNorm();
            return da > db;  // exterior parts first
        });

        bool progress = false;
        for (size_t idx : remaining_indices) {
            const auto& part = parts_[idx];
            path_evaluations_++;

            Vec3 phys_dir;
            PathEvaluation phys_eval;
            if (try_physics_path(part, retry_count, phys_dir, phys_eval, part_sdfs)) {
                RemovableCandidate candidate;
                candidate.id = part.id;
                candidate.direction = phys_dir;
                candidate.eval = phys_eval;
                candidate.quality = 1.0f;
                record_removal(candidate);
                progress = true;
                break;  // restart with updated obstacles
            }
        }

        if (!progress) {
            retry_count++;
            if (retry_count > config_.max_retries) {
                // Mark remaining as stuck
                for (const auto& p : parts_) {
                    if (!removed_parts_.count(p.id)) {
                        result.stuck_parts.push_back(p.id);
                    }
                }
                break;
            }
        } else {
            retry_count = 0;
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
