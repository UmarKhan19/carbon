#include "simulator/path_planner.h"
#include "geometry/aabb.h"

#include <algorithm>
#include <cmath>
#include <iostream>

namespace carbon {

// --- Constants (matching Rust) ---

static constexpr float MIN_REMOVAL_RATIO = 0.90f;
static constexpr int MAX_DIRECTIONS = 12;
static constexpr int MAX_MOTION_STEPS = 100;
static constexpr float DIRECTION_DEDUP_DOT = 0.98f;

// --- Helper: deduplicate directions ---

static void add_unique_direction(std::vector<Vec3>& dirs, const Vec3& d) {
    float len = d.norm();
    if (len < 1e-8f) return;
    Vec3 nd = d / len;
    for (const auto& existing : dirs) {
        if (nd.dot(existing) > DIRECTION_DEDUP_DOT) return;
    }
    dirs.push_back(nd);
}

// --- Generate candidate removal directions ---

std::vector<Vec3> candidate_directions_for_part(
    const PartData& part,
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds,
    std::optional<Vec3> forced_direction) {

    std::vector<Vec3> directions;

    // Check if this part is classified as a fastener
    auto kind_it = kinds.find(part.id);
    bool is_fastener = (kind_it != kinds.end() && kind_it->second == PartKind::Fastener);

    // 1. Contact normals (away from neighbors)
    for (const auto& edge : contacts.edges()) {
        if (edge.part_a != part.id && edge.part_b != part.id) continue;

        Vec3 normal = edge.estimated_normal;
        // Normal points from A → B; if we are A, we want to move away (-normal)
        Vec3 away = (edge.part_a == part.id) ? -normal : normal;
        add_unique_direction(directions, away);

        if (directions.size() >= MAX_DIRECTIONS) break;
    }

    // 2. Part-local axes (longest bbox dimension first)
    Eigen::Matrix3f rot = part.transform.rotation.toRotationMatrix();
    // Sort local axes by bbox dimension (largest first for fasteners)
    std::array<int, 3> axis_order = {0, 1, 2};
    std::sort(axis_order.begin(), axis_order.end(), [&](int a, int b) {
        return part.bbox_size[a] > part.bbox_size[b];
    });
    for (int idx : axis_order) {
        Vec3 local_axis = rot.col(idx);
        add_unique_direction(directions, local_axis);
        add_unique_direction(directions, -local_axis);
    }

    // For fasteners, stop here — only use contact normals + local axes.
    // Fasteners (bolts/screws) should only be removed along their shaft axis,
    // not along arbitrary diagonals which would cut through the hole wall.
    if (is_fastener) {
        // 6. Apply forced direction filter (keep only directions within 45 degrees)
        if (forced_direction) {
            Vec3 fd = forced_direction->normalized();
            float cos_45 = 0.707f;
            std::vector<Vec3> filtered;
            for (const auto& d : directions) {
                if (d.dot(fd) > cos_45) filtered.push_back(d);
            }
            if (!filtered.empty()) return filtered;
        }
        return directions;
    }

    // --- Non-fastener parts get the full direction candidate set ---

    // 3. Global canonical axes
    add_unique_direction(directions, Vec3(1, 0, 0));
    add_unique_direction(directions, Vec3(-1, 0, 0));
    add_unique_direction(directions, Vec3(0, 1, 0));
    add_unique_direction(directions, Vec3(0, -1, 0));
    add_unique_direction(directions, Vec3(0, 0, 1));
    add_unique_direction(directions, Vec3(0, 0, -1));

    // 4. Diagonal directions
    float inv_sqrt2 = 1.0f / std::sqrt(2.0f);
    Vec3 diags[] = {
        Vec3(inv_sqrt2, inv_sqrt2, 0), Vec3(inv_sqrt2, -inv_sqrt2, 0),
        Vec3(inv_sqrt2, 0, inv_sqrt2), Vec3(inv_sqrt2, 0, -inv_sqrt2),
        Vec3(0, inv_sqrt2, inv_sqrt2), Vec3(0, inv_sqrt2, -inv_sqrt2),
    };
    for (const auto& d : diags) {
        add_unique_direction(directions, d);
        add_unique_direction(directions, -d);
    }

    // 5. Combined diagonal directions from pairs of primary directions
    // Ports Rust simulator.rs:1115-1146: combine sufficiently different
    // directions to find paths through narrow gaps.
    {
        size_t n_primary = std::min(directions.size(), size_t(4));
        for (size_t i = 0; i < n_primary; ++i) {
            for (size_t j = i + 1; j < n_primary; ++j) {
                if (std::abs(directions[i].dot(directions[j])) < 0.7f) {
                    Vec3 combined = directions[i] + directions[j];
                    if (combined.squaredNorm() > 0.5f)
                        add_unique_direction(directions, combined.normalized());
                    Vec3 combined_neg = directions[i] - directions[j];
                    if (combined_neg.squaredNorm() > 0.5f)
                        add_unique_direction(directions, combined_neg.normalized());
                }
            }
        }
    }

    // Truncate to max
    if (directions.size() > MAX_DIRECTIONS) {
        directions.resize(MAX_DIRECTIONS);
    }

    // 6. Apply forced direction filter (keep only directions within 45 degrees)
    if (forced_direction) {
        Vec3 fd = forced_direction->normalized();
        float cos_45 = 0.707f;
        std::vector<Vec3> filtered;
        for (const auto& d : directions) {
            if (d.dot(fd) > cos_45) filtered.push_back(d);
        }
        if (!filtered.empty()) return filtered;
        // Fallback: no matches, return all
    }

    return directions;
}

// --- Evaluate motion transform (per-step collision check) ---

static bool evaluate_motion_transform(
    const PartData& part,
    const Isometry& test_transform,
    const std::vector<NeighborState>& neighbors,
    float distance_from_start,
    std::optional<float>& min_clearance,
    uint64_t& collision_checks) {

    AABB part_aabb = part.mesh->world_aabb(test_transform);

    for (const auto& ns : neighbors) {
        // AABB pre-filter
        if (!part_aabb.overlaps(ns.part->world_aabb, ns.relaxed_clearance)) {
            continue;
        }

        collision_checks++;

        // Intersection test (use cached neighbor mesh when available)
        bool intersecting;
        if (ns.cached_mesh) {
            intersecting = mesh_intersects_cached(
                *part.mesh, test_transform, *ns.cached_mesh);
        } else {
            intersecting = mesh_intersects(
                *part.mesh, test_transform,
                *ns.part->mesh, ns.part->transform);
        }

        if (intersecting) {
            if (ns.baseline_intersecting) {
                // Check if overlap volume is decreasing (monotonic reduction)
                AABB test_aabb = part.mesh->world_aabb(test_transform);
                AABB nb_aabb = ns.part->world_aabb;

                float overlap_vol = aabb_overlap_volume(test_aabb, nb_aabb);
                float allowed = ns.baseline_overlap_volume * 1.01f + 1e-4f;

                if (overlap_vol <= allowed) {
                    continue;  // Overlap is decreasing — allowed
                }
                return true;  // Overlap increased — collision
            }
            return true;  // Non-baseline intersection — collision
        }

        // Distance check (use cached neighbor AABB tree when available)
        collision_checks++;
        float dist;
        if (ns.cached_mesh) {
            dist = mesh_distance_cached(
                *part.mesh, test_transform, *ns.cached_mesh);
        } else {
            dist = mesh_distance(
                *part.mesh, test_transform,
                *ns.part->mesh, ns.part->transform);
        }

        if (dist < ns.relaxed_clearance) {
            return true;  // Too close — collision
        }

        if (!min_clearance || dist < *min_clearance) {
            min_clearance = dist;
        }
    }

    return false;  // No collision
}

// --- Trace motion using discrete sampling ---

MotionTrace trace_motion_discrete(
    const PartData& part,
    const Vec3& direction,
    float required_distance,
    float clearance,
    const std::vector<NeighborState>& neighbors,
    int steps,
    uint64_t& collision_checks) {

    MotionTrace trace;
    trace.travel_distance = 0.0f;
    trace.sampled_distances.push_back(0.0f);

    steps = std::clamp(steps, 4, MAX_MOTION_STEPS);
    float step_size = required_distance / static_cast<float>(steps);

    for (int i = 1; i <= steps; ++i) {
        float distance = step_size * i;

        // Build test transform
        Isometry test_pose = part.transform;
        test_pose.translation += direction * distance;

        std::optional<float> step_clearance;
        bool collides = evaluate_motion_transform(
            part, test_pose, neighbors, distance, step_clearance, collision_checks);

        if (collides) {
            // Binary search refinement (6 iterations)
            float lo = (i > 1) ? step_size * (i - 1) : 0.0f;
            float hi = distance;
            for (int refine = 0; refine < 6; ++refine) {
                float mid = (lo + hi) * 0.5f;
                Isometry mid_pose = part.transform;
                mid_pose.translation += direction * mid;

                std::optional<float> rc;
                if (evaluate_motion_transform(part, mid_pose, neighbors, mid, rc, collision_checks)) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            trace.travel_distance = lo;
            trace.sampled_distances.push_back(lo);
            break;
        }

        trace.travel_distance = distance;
        trace.sampled_distances.push_back(distance);

        if (step_clearance) {
            if (!trace.min_clearance || *step_clearance < *trace.min_clearance) {
                trace.min_clearance = step_clearance;
            }
        }
    }

    return trace;
}

// --- Evaluate removal path ---

std::optional<PathEvaluation> evaluate_removal_path(
    const PartData& part,
    const Vec3& direction,
    float required_distance,
    float clearance,
    const std::vector<NeighborState>& neighbors,
    uint64_t& collision_checks) {

    if (neighbors.empty()) {
        // No neighbors — trivial removal
        float travel = std::max(required_distance, part.bbox_size.minCoeff() * 2.0f);
        PathEvaluation eval;
        eval.travel_distance = travel;
        eval.required_distance = required_distance;
        eval.success = true;

        // Simple 2-keyframe animation
        Mat4 start_mat = part.transform.to_matrix4();
        eval.animation_path.push_back({0.0f, start_mat});
        Isometry end_pose = part.transform;
        end_pose.translation += direction * travel;
        eval.animation_path.push_back({1.0f, end_pose.to_matrix4()});

        return eval;
    }

    // Compute number of sampling steps
    float min_dim = part.bbox_size.minCoeff();
    float max_step = std::max(min_dim * 0.4f, 0.1f);
    int steps = std::max(static_cast<int>(required_distance / max_step), 10);
    steps = std::clamp(steps, 4, MAX_MOTION_STEPS);

    // Trace motion
    auto trace = trace_motion_discrete(
        part, direction, required_distance, clearance, neighbors, steps, collision_checks);

    // Check if we traveled far enough
    float min_travel = required_distance * MIN_REMOVAL_RATIO;
    if (trace.travel_distance < min_travel) {
        return std::nullopt;  // Path blocked
    }

    // Build animation keyframes from sampled distances
    PathEvaluation eval;
    eval.travel_distance = trace.travel_distance;
    eval.required_distance = required_distance;
    eval.min_clearance = trace.min_clearance;
    eval.success = true;

    for (float dist : trace.sampled_distances) {
        float t = (trace.travel_distance > 1e-6f) ? dist / trace.travel_distance : 0.0f;
        t = std::clamp(t, 0.0f, 1.0f);
        Isometry pose = part.transform;
        pose.translation += direction * dist;
        eval.animation_path.push_back({t, pose.to_matrix4()});
    }

    return eval;
}

} // namespace carbon
