#include "simulator/animation_gen.h"
#include <algorithm>
#include <cmath>

namespace carbon {

Vec3 compute_staging_point(const AABB& part_aabb, const AABB& global_aabb,
                            const Vec3& approach_direction, float margin_factor) {
    // Place part outside the global AABB along the approach direction.
    // Port of staging point logic from simulator.rs.
    Vec3 global_size = global_aabb.size();
    float margin = global_aabb.diagonal() * margin_factor;

    Vec3 part_center = part_aabb.center();
    Vec3 global_center = global_aabb.center();

    // Project along approach direction to find exit point
    Vec3 dir = approach_direction.normalized();
    float max_extent = 0.0f;
    for (int i = 0; i < 3; ++i) {
        if (std::abs(dir[i]) > 1e-6f) {
            float extent = (dir[i] > 0)
                ? (global_aabb.max[i] - part_center[i])
                : (part_center[i] - global_aabb.min[i]);
            max_extent = std::max(max_extent, std::abs(extent / dir[i]));
        }
    }

    return part_center + dir * (max_extent + margin);
}

std::vector<AnimationKeyframe> build_assembly_animation(
    const Mat4& rest_transform,
    const Vec3& staging_point,
    const Vec3& approach_direction,
    float approach_time_fraction) {
    // Build 3-keyframe animation: staging(t=0) -> approach(t=0.3) -> rest(t=1.0)
    std::vector<AnimationKeyframe> keyframes;

    // Keyframe 0: Part at staging point (far away)
    Mat4 staging_transform = rest_transform;
    staging_transform.block<3, 1>(0, 3) = staging_point;
    keyframes.push_back({0.0f, staging_transform});

    // Keyframe 1: Part at approach point (just outside assembly)
    // The approach point is along the approach direction, close to the final position
    Vec3 rest_pos = rest_transform.block<3, 1>(0, 3);
    Vec3 approach_pos = rest_pos + approach_direction.normalized() *
                        (staging_point - rest_pos).norm() * 0.1f;
    Mat4 approach_transform = rest_transform;
    approach_transform.block<3, 1>(0, 3) = approach_pos;
    keyframes.push_back({approach_time_fraction, approach_transform});

    // Keyframe 2: Part at rest position (final assembly position)
    keyframes.push_back({1.0f, rest_transform});

    return keyframes;
}

uint32_t compute_step_duration(float travel_distance, float scene_diagonal,
                                uint32_t min_ms, uint32_t max_ms) {
    if (scene_diagonal < 1e-6f) return min_ms;
    float ratio = travel_distance / scene_diagonal;
    float t = std::clamp(ratio, 0.0f, 1.0f);
    return static_cast<uint32_t>(min_ms + t * (max_ms - min_ms));
}

} // namespace carbon
