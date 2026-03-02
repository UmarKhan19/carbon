#include "collision/sdf_collision.h"

#include <algorithm>

namespace carbon {

// ---------------------------------------------------------------------------
// build_sdf_mesh
// ---------------------------------------------------------------------------

std::shared_ptr<CachedSDFMesh> build_sdf_mesh(
    const TriMesh& mesh, const Isometry& transform, const SDFConfig& config) {
    if (mesh.empty()) return nullptr;

    auto cached = std::make_shared<CachedSDFMesh>();
    cached->sdf = generate_sdf(mesh, transform, config);
    cached->world_aabb = mesh.world_aabb(transform);
    return cached;
}

// ---------------------------------------------------------------------------
// Internal: generate sample points from a mesh (vertices + face centers)
// ---------------------------------------------------------------------------

namespace {

/// Generate world-space sample points from a mesh: all vertices + face centers.
std::vector<Vec3> sample_points(const TriMesh& mesh, const Isometry& transform) {
    std::vector<Vec3> points;
    points.reserve(mesh.vertices.size() + mesh.indices.size());

    // All vertices
    for (const auto& v : mesh.vertices) {
        points.push_back(transform.transform_point(v));
    }

    // Face centers (average of 3 vertices per triangle)
    for (const auto& tri : mesh.indices) {
        Vec3 center = (mesh.vertices[tri[0]] +
                       mesh.vertices[tri[1]] +
                       mesh.vertices[tri[2]]) / 3.0f;
        points.push_back(transform.transform_point(center));
    }

    return points;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// sdf_mesh_intersects
// ---------------------------------------------------------------------------

bool sdf_mesh_intersects(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf) {
    if (query_mesh.empty() || obstacle_sdf.sdf.empty()) return false;

    // Quick AABB pre-check
    AABB query_aabb = query_mesh.world_aabb(query_transform);
    if (!query_aabb.overlaps(obstacle_sdf.world_aabb, 0.001f)) return false;

    // Sample query mesh points and test against SDF
    auto points = sample_points(query_mesh, query_transform);
    for (const auto& p : points) {
        if (obstacle_sdf.sdf.query(p) < 0.0f) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// sdf_contact_points
// ---------------------------------------------------------------------------

std::vector<SDFContact> sdf_contact_points(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf) {
    std::vector<SDFContact> contacts;
    if (query_mesh.empty() || obstacle_sdf.sdf.empty()) return contacts;

    // Quick AABB pre-check
    AABB query_aabb = query_mesh.world_aabb(query_transform);
    if (!query_aabb.overlaps(obstacle_sdf.world_aabb, 0.001f)) return contacts;

    auto points = sample_points(query_mesh, query_transform);
    for (const auto& p : points) {
        float dist = obstacle_sdf.sdf.query(p);
        if (dist < 0.0f) {
            SDFContact c;
            c.position = p;
            c.depth = -dist; // positive depth for penetration
            c.normal = obstacle_sdf.sdf.gradient(p);
            float mag = c.normal.norm();
            if (mag > 1e-8f) {
                c.normal /= mag; // normalize
            } else {
                c.normal = Vec3(0, 1, 0); // fallback
            }
            contacts.push_back(c);
        }
    }
    return contacts;
}

// ---------------------------------------------------------------------------
// sdf_cast_shapes_discrete
// ---------------------------------------------------------------------------

std::optional<float> sdf_cast_shapes_discrete(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const CachedSDFMesh& obstacle_sdf,
    float max_toi, int samples) {
    if (moving.empty() || obstacle_sdf.sdf.empty()) return std::nullopt;

    for (int s = 0; s <= samples; ++s) {
        float t = max_toi * static_cast<float>(s) / static_cast<float>(samples);
        Isometry pose = start_pose;
        pose.translation += velocity * t;

        // AABB check
        AABB moving_aabb = moving.world_aabb(pose);
        if (!moving_aabb.overlaps(obstacle_sdf.world_aabb, 0.001f)) continue;

        // Check vertices against SDF (skip face centers for speed)
        for (const auto& v : moving.vertices) {
            Vec3 wv = pose.transform_point(v);
            if (obstacle_sdf.sdf.query(wv) < 0.0f) {
                // Binary search refinement
                float lo = (s > 0)
                    ? max_toi * static_cast<float>(s - 1) / static_cast<float>(samples)
                    : 0.0f;
                float hi = t;

                for (int refine = 0; refine < 6; ++refine) {
                    float mid = (lo + hi) * 0.5f;
                    Isometry mid_pose = start_pose;
                    mid_pose.translation += velocity * mid;

                    bool hit = false;
                    for (const auto& mv : moving.vertices) {
                        if (obstacle_sdf.sdf.query(mid_pose.transform_point(mv)) < 0.0f) {
                            hit = true;
                            break;
                        }
                    }
                    if (hit) {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                return hi;
            }
        }
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// sdf_penetration_depth
// ---------------------------------------------------------------------------

float sdf_penetration_depth(
    const TriMesh& query_mesh, const Isometry& query_transform,
    const CachedSDFMesh& obstacle_sdf) {
    if (query_mesh.empty() || obstacle_sdf.sdf.empty()) return 0.0f;

    float max_depth = 0.0f;
    auto points = sample_points(query_mesh, query_transform);
    for (const auto& p : points) {
        float dist = obstacle_sdf.sdf.query(p);
        if (dist < 0.0f) {
            max_depth = std::max(max_depth, -dist);
        }
    }
    return max_depth;
}

} // namespace carbon
