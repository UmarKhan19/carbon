#include "collision/collision_utils.h"

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/Polygon_mesh_processing/intersection.h>
#include <CGAL/AABB_tree.h>
#include <CGAL/AABB_traits_3.h>
#include <CGAL/AABB_face_graph_triangle_primitive.h>

#include <algorithm>
#include <cmath>
#include <limits>

namespace carbon {

// --- CGAL type aliases ---

using K = CGAL::Exact_predicates_inexact_constructions_kernel;
using Point_3 = K::Point_3;
using SMesh = CGAL::Surface_mesh<Point_3>;
using Primitive = CGAL::AABB_face_graph_triangle_primitive<SMesh>;
using Traits = CGAL::AABB_traits_3<K, Primitive>;
using AABBTree = CGAL::AABB_tree<Traits>;

namespace PMP = CGAL::Polygon_mesh_processing;

// --- Helper: convert TriMesh + Isometry to CGAL Surface_mesh ---

static SMesh to_cgal_mesh(const TriMesh& mesh, const Isometry& transform) {
    SMesh sm;

    // Add transformed vertices
    std::vector<SMesh::Vertex_index> vi_map;
    vi_map.reserve(mesh.vertices.size());

    for (const auto& v : mesh.vertices) {
        Vec3 wv = transform.transform_point(v);
        auto vi = sm.add_vertex(Point_3(wv.x(), wv.y(), wv.z()));
        vi_map.push_back(vi);
    }

    // Add faces
    for (const auto& tri : mesh.indices) {
        sm.add_face(vi_map[tri[0]], vi_map[tri[1]], vi_map[tri[2]]);
    }

    return sm;
}

// --- Public API ---

bool mesh_intersects(const TriMesh& a, const Isometry& ta,
                     const TriMesh& b, const Isometry& tb) {
    if (a.empty() || b.empty()) return false;

    // Quick AABB pre-check
    AABB aabb_a = a.world_aabb(ta);
    AABB aabb_b = b.world_aabb(tb);
    if (!aabb_a.overlaps(aabb_b, 0.001f)) return false;

    SMesh sm_a = to_cgal_mesh(a, ta);
    SMesh sm_b = to_cgal_mesh(b, tb);

    return PMP::do_intersect(sm_a, sm_b);
}

float mesh_distance(const TriMesh& a, const Isometry& ta,
                    const TriMesh& b, const Isometry& tb) {
    if (a.empty() || b.empty()) return std::numeric_limits<float>::max();

    // Quick AABB distance pre-check
    AABB aabb_a = a.world_aabb(ta);
    AABB aabb_b = b.world_aabb(tb);
    // If AABBs don't overlap with generous margin, return AABB distance estimate
    if (!aabb_a.overlaps(aabb_b, 5.0f)) {
        // Compute min AABB surface distance
        float dx = std::max(0.0f, std::max(aabb_a.min.x() - aabb_b.max.x(),
                                            aabb_b.min.x() - aabb_a.max.x()));
        float dy = std::max(0.0f, std::max(aabb_a.min.y() - aabb_b.max.y(),
                                            aabb_b.min.y() - aabb_a.max.y()));
        float dz = std::max(0.0f, std::max(aabb_a.min.z() - aabb_b.max.z(),
                                            aabb_b.min.z() - aabb_a.max.z()));
        return std::sqrt(dx*dx + dy*dy + dz*dz);
    }

    // Build AABB tree from mesh B for nearest-point queries
    SMesh sm_b = to_cgal_mesh(b, tb);
    AABBTree tree(faces(sm_b).first, faces(sm_b).second, sm_b);
    tree.accelerate_distance_queries();

    // Query closest distance from each vertex of A to mesh B
    float min_dist = std::numeric_limits<float>::max();

    // Sample vertices (limit to 500 for performance on large meshes)
    size_t step = std::max<size_t>(1, a.vertices.size() / 500);
    for (size_t i = 0; i < a.vertices.size(); i += step) {
        Vec3 wv = ta.transform_point(a.vertices[i]);
        Point_3 query(wv.x(), wv.y(), wv.z());
        float sq_dist = static_cast<float>(tree.squared_distance(query));
        float dist = std::sqrt(sq_dist);
        min_dist = std::min(min_dist, dist);

        // Early exit if we found intersection (distance ~0)
        if (min_dist < 1e-6f) return 0.0f;
    }

    return min_dist;
}

std::optional<float> cast_shapes_discrete(
    const TriMesh& moving, const Isometry& start_pose, const Vec3& velocity,
    const TriMesh& obstacle, const Isometry& obstacle_pose,
    float max_toi, int samples) {

    if (moving.empty() || obstacle.empty()) return std::nullopt;

    // Pre-build CGAL mesh for obstacle (stays static)
    SMesh sm_obstacle = to_cgal_mesh(obstacle, obstacle_pose);

    for (int i = 0; i <= samples; ++i) {
        float t = max_toi * static_cast<float>(i) / static_cast<float>(samples);
        Isometry pose = start_pose;
        pose.translation += velocity * t;

        // Quick AABB check before expensive intersection test
        AABB aabb_moving = moving.world_aabb(pose);
        AABB aabb_obstacle = obstacle.world_aabb(obstacle_pose);
        if (!aabb_moving.overlaps(aabb_obstacle, 0.001f)) continue;

        // Full mesh intersection test
        SMesh sm_moving = to_cgal_mesh(moving, pose);
        if (PMP::do_intersect(sm_moving, sm_obstacle)) {
            // Binary search refinement for more precise time
            float lo = (i > 0)
                ? max_toi * static_cast<float>(i - 1) / static_cast<float>(samples)
                : 0.0f;
            float hi = t;

            for (int refine = 0; refine < 6; ++refine) {
                float mid = (lo + hi) * 0.5f;
                Isometry mid_pose = start_pose;
                mid_pose.translation += velocity * mid;

                SMesh sm_mid = to_cgal_mesh(moving, mid_pose);
                if (PMP::do_intersect(sm_mid, sm_obstacle)) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            return hi;
        }
    }
    return std::nullopt;
}

} // namespace carbon
