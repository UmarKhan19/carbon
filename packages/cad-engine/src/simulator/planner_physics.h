#pragma once

/// Shared physics helpers for BFS and RRT planners.
/// Contact detection and penetration correction against SDF obstacles.

#include "collision/sdf_collision.h"
#include "geometry/types.h"
#include "physics/contact_solver.h"
#include "physics/rigid_body.h"
#include <vector>

namespace carbon {

/// Detect contacts between a moving body and static SDF obstacles.
/// Returns BodyContact list compatible with contact_solver functions.
inline std::vector<physics::BodyContact> detect_sdf_contacts(
    const physics::RigidBody& body, int body_idx,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    int max_sample_verts) {
    std::vector<physics::BodyContact> contacts;
    if (!body.mesh) return contacts;

    Isometry iso = body.state.to_isometry();
    AABB body_aabb = body.world_aabb();

    for (const auto& obs : obstacles) {
        if (!obs || obs->sdf.empty()) continue;
        if (!body_aabb.overlaps(obs->sdf.grid_aabb())) continue;

        int nverts = static_cast<int>(body.mesh->vertices.size());
        int stride = 1;
        if (max_sample_verts > 0 && nverts > max_sample_verts) {
            stride = (nverts + max_sample_verts - 1) / max_sample_verts;
        }

        for (int vi = 0; vi < nverts; vi += stride) {
            Vec3 world_v = iso.transform_point(body.mesh->vertices[vi]);
            float dist = obs->sdf.query(world_v);

            if (dist < 0.0f) {
                Vec3 grad = obs->sdf.gradient(world_v);
                float mag = grad.norm();
                if (mag > 1e-8f) grad /= mag;
                else grad = Vec3(0, 1, 0);

                physics::BodyContact c;
                c.body_a = -1; // obstacle (static)
                c.body_b = body_idx;
                c.position = world_v;
                c.normal = grad; // Points outward from obstacle
                c.depth = -dist;
                contacts.push_back(c);
            }
        }
    }
    return contacts;
}

/// Apply penetration correction for a body against SDF obstacles.
/// Projects penetrating vertices out along SDF gradient.
inline void apply_sdf_penetration_correction(
    physics::RigidBody& body,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    int max_sample_verts) {
    if (!body.mesh) return;

    Isometry iso = body.state.to_isometry();
    AABB body_aabb = body.world_aabb();

    for (const auto& obs : obstacles) {
        if (!obs || obs->sdf.empty()) continue;
        if (!body_aabb.overlaps(obs->sdf.grid_aabb())) continue;

        Vec3 correction_sum = Vec3::Zero();
        int correction_count = 0;

        int nverts = static_cast<int>(body.mesh->vertices.size());
        int stride = 1;
        if (max_sample_verts > 0 && nverts > max_sample_verts) {
            stride = (nverts + max_sample_verts - 1) / max_sample_verts;
        }

        for (int vi = 0; vi < nverts; vi += stride) {
            Vec3 world_v = iso.transform_point(body.mesh->vertices[vi]);
            float dist = obs->sdf.query(world_v);

            if (dist < 0.0f) {
                Vec3 grad = obs->sdf.gradient(world_v);
                float mag = grad.norm();
                if (mag > 1e-8f) {
                    grad /= mag;
                    correction_sum += grad * (-dist);
                    correction_count++;
                }
            }
        }

        if (correction_count > 0) {
            Vec3 avg_correction = correction_sum / static_cast<float>(correction_count);
            body.state.position += avg_correction;

            // Zero velocity into the surface
            Vec3 correction_dir = avg_correction.normalized();
            float v_into = body.state.linear_velocity.dot(correction_dir);
            if (v_into < 0.0f) {
                body.state.linear_velocity -= v_into * correction_dir;
            }

            // Update isometry for next obstacle check
            iso = body.state.to_isometry();
        }
    }
}

} // namespace carbon
