#pragma once

/// Collision detection utilities using CGAL.
/// Replaces parry3d collision functions from collision.rs.

#include "geometry/types.h"
#include <optional>

namespace carbon {

/// Check if two meshes intersect in their given poses.
/// Uses CGAL::Polygon_mesh_processing::do_intersect.
bool mesh_intersects(const TriMesh& a, const Isometry& ta,
                     const TriMesh& b, const Isometry& tb);

/// Compute minimum distance between two meshes.
/// Uses CGAL AABB_tree squared_distance.
float mesh_distance(const TriMesh& a, const Isometry& ta,
                    const TriMesh& b, const Isometry& tb);

/// Discrete CCD approximation: sample N positions along a linear path.
/// Returns parametric time [0,1] of first intersection, or nullopt if clear.
/// This replaces rapier3d's cast_shapes which CGAL doesn't provide natively.
std::optional<float> cast_shapes_discrete(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const TriMesh& obstacle, const Isometry& obstacle_pose,
    float max_toi = 1.0f, int samples = 20);

} // namespace carbon
