#pragma once

/// Collision detection utilities using CGAL.
/// Replaces parry3d collision functions from collision.rs.

#include "geometry/types.h"
#include <memory>
#include <optional>

namespace carbon {

// --- Pre-built CGAL mesh cache (opaque, defined in .cpp) ---

struct CachedCollisionMesh;

/// Pre-build a CGAL Surface_mesh + AABB tree for a mesh at a given pose.
/// Reuse the result across multiple collision queries against this mesh.
std::shared_ptr<CachedCollisionMesh> build_collision_mesh(
    const TriMesh& mesh, const Isometry& transform);

// --- Original (uncached) API ---

/// Check if two meshes intersect in their given poses.
bool mesh_intersects(const TriMesh& a, const Isometry& ta,
                     const TriMesh& b, const Isometry& tb);

/// Compute minimum distance between two meshes.
float mesh_distance(const TriMesh& a, const Isometry& ta,
                    const TriMesh& b, const Isometry& tb);

/// Discrete CCD approximation: sample N positions along a linear path.
std::optional<float> cast_shapes_discrete(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const TriMesh& obstacle, const Isometry& obstacle_pose,
    float max_toi = 1.0f, int samples = 20);

// --- Cached API (use pre-built mesh for the static obstacle) ---

/// Check if mesh A intersects a pre-built cached mesh B.
bool mesh_intersects_cached(const TriMesh& a, const Isometry& ta,
                            const CachedCollisionMesh& b_cached);

/// Compute minimum distance from mesh A to a pre-built cached mesh B.
float mesh_distance_cached(const TriMesh& a, const Isometry& ta,
                           const CachedCollisionMesh& b_cached);

/// Discrete CCD with pre-built obstacle mesh.
std::optional<float> cast_shapes_discrete_cached(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const CachedCollisionMesh& obstacle_cached,
    float max_toi = 1.0f, int samples = 20);

} // namespace carbon
