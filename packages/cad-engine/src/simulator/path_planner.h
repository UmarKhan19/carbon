#pragma once

/// Path planning for part removal/insertion.
/// Port of candidate_directions_for_part(), evaluate_removal_path(), trace_motion()
/// from simulator.rs.

#include "geometry/types.h"
#include "collision/contact_graph.h"
#include "collision/collision_utils.h"
#include "classification/part_classifier.h"
#include <optional>
#include <string>
#include <vector>
#include <unordered_set>

namespace carbon {

enum class MotionType { Linear, Helix };

struct RemovalPath {
    Vec3 direction;
    MotionType motion = MotionType::Linear;
    float travel_distance = 100.0f;
    std::optional<Vec3> helix_axis;
    std::optional<float> helix_turns;
};

struct PathEvaluation {
    float travel_distance = 0.0f;
    float required_distance = 0.0f;
    std::optional<float> min_clearance;
    std::vector<AnimationKeyframe> animation_path;
    bool success = false;
};

/// Internal part data used during simulation.
struct PartData {
    std::string id;
    std::string name;
    const TriMesh* mesh;
    Isometry transform;
    Vec3 bbox_size;   // local AABB dimensions
    AABB world_aabb;
};

/// Neighbor state for collision checking during motion.
struct NeighborState {
    const PartData* part;
    bool baseline_intersecting;
    float baseline_overlap_volume;
    float relaxed_clearance;
};

/// Generate candidate removal directions for a part.
std::vector<Vec3> candidate_directions_for_part(
    const PartData& part,
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds,
    std::optional<Vec3> forced_direction = std::nullopt);

/// Evaluate whether a removal path is collision-free.
/// Returns nullopt if the path is blocked.
std::optional<PathEvaluation> evaluate_removal_path(
    const PartData& part,
    const Vec3& direction,
    float required_distance,
    float clearance,
    const std::vector<NeighborState>& neighbors,
    uint64_t& collision_checks);

/// Trace linear motion using discrete CCD sampling.
struct MotionTrace {
    float travel_distance;
    std::optional<float> min_clearance;
    std::vector<float> sampled_distances;
};

MotionTrace trace_motion_discrete(
    const PartData& part,
    const Vec3& direction,
    float required_distance,
    float clearance,
    const std::vector<NeighborState>& neighbors,
    int steps,
    uint64_t& collision_checks);

} // namespace carbon
