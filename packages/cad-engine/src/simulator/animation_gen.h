#pragma once

/// Animation keyframe generation for assembly steps.
/// Port of animation generation code from simulator.rs.

#include "geometry/types.h"
#include <vector>

namespace carbon {

/// Compute the staging point for a part (outside the global AABB).
Vec3 compute_staging_point(const AABB& part_aabb, const AABB& global_aabb,
                            const Vec3& approach_direction, float margin_factor = 0.10f);

/// Build the full multi-segment animation path for an assembly step:
/// staging -> approach -> insertion.
std::vector<AnimationKeyframe> build_assembly_animation(
    const Mat4& rest_transform,
    const Vec3& staging_point,
    const Vec3& approach_direction,
    float approach_time_fraction = 0.30f);

/// Compute adaptive step duration based on travel distance and scene size.
uint32_t compute_step_duration(float travel_distance, float scene_diagonal,
                                uint32_t min_ms = 300, uint32_t max_ms = 3000);

} // namespace carbon
