#pragma once

/// AABB utility functions for broad-phase filtering.
/// Port of aabb utilities from simulator.rs.

#include "geometry/types.h"

namespace carbon {

/// Compute the overlap volume between two AABBs (0 if no overlap).
float aabb_overlap_volume(const AABB& a, const AABB& b);

/// Compute the swept AABB of a shape moving from start to end.
AABB swept_aabb(const AABB& start, const Vec3& displacement);

/// Check if a swept AABB could overlap a static AABB.
bool swept_aabb_could_overlap(const AABB& moving_start, const Vec3& displacement,
                               const AABB& obstacle, float margin = 0.0f);

/// Compute the parametric entry time [0,1] of swept AABB entering a static AABB.
/// Returns std::nullopt if no intersection.
std::optional<float> swept_aabb_entry_time(const AABB& moving_start, const Vec3& displacement,
                                            const AABB& obstacle);

} // namespace carbon
