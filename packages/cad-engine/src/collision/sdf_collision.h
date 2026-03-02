#pragma once

/// SDF-based collision detection.
/// Uses precomputed signed distance fields for fast O(1) collision queries.
/// Supplements the CGAL-based collision in collision_utils.h.

#include "collision/sdf.h"
#include "geometry/types.h"
#include <memory>
#include <optional>
#include <vector>

namespace carbon {

/// A contact point from SDF collision detection.
struct SDFContact {
    Vec3 position;       ///< World-space contact position.
    Vec3 normal;         ///< Contact normal (from SDF gradient, points outward).
    float depth;         ///< Penetration depth (positive when penetrating).
};

/// Pre-built SDF for a mesh at a fixed pose. Analogous to CachedCollisionMesh.
struct CachedSDFMesh {
    SDFGrid sdf;
    AABB world_aabb;
};

/// Build a cached SDF mesh for repeated collision queries.
/// The mesh is transformed to world space and an SDF is generated.
std::shared_ptr<CachedSDFMesh> build_sdf_mesh(
    const TriMesh& mesh, const Isometry& transform,
    const SDFConfig& config = {});

/// Check if any sample points penetrate the SDF (fast boolean test).
/// Samples the vertices (and optionally face centers) of the query mesh
/// against the SDF of the obstacle mesh.
bool sdf_mesh_intersects(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf);

/// Compute all contact points where the query mesh penetrates the SDF.
/// Returns contacts with position, normal, and penetration depth.
std::vector<SDFContact> sdf_contact_points(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf);

/// SDF-based discrete continuous collision detection.
/// Samples N positions along a linear path and checks for SDF penetration.
/// Returns the approximate time of impact (0 to max_toi), or nullopt if no collision.
std::optional<float> sdf_cast_shapes_discrete(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const CachedSDFMesh& obstacle_sdf,
    float max_toi = 1.0f, int samples = 20);

/// Compute the total penetration depth of a mesh against an SDF.
/// Useful for optimization-based contact resolution.
float sdf_penetration_depth(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf);

} // namespace carbon
