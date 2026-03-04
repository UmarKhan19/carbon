#include "simulator/rrt_planner.h"
#include "simulator/planner_physics.h"
#include "physics/rigid_body.h"
#include "physics/contact_solver.h"

#include <cmath>
#include <iostream>
#include <limits>
#include <random>

namespace carbon {

using physics::BodyState;

namespace {

/// RRT tree node.
struct RRTNode {
    BodyState state;
    int parent = -1;
};

/// Distance metric between two body states (position + orientation).
float state_distance(const BodyState& a, const BodyState& b) {
    float pos_dist = (a.position - b.position).norm();
    float dot = std::abs(a.orientation.dot(b.orientation));
    dot = std::min(dot, 1.0f);
    float rot_dist = 2.0f * std::acos(dot);
    return pos_dist + rot_dist; // Combined metric
}

/// Check if the body is separated from all obstacles.
bool is_separated(const BodyState& state, const TriMesh& mesh,
                  const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
                  float sep_dist) {
    Isometry iso = state.to_isometry();
    AABB body_aabb = mesh.world_aabb(iso);

    for (const auto& obs : obstacles) {
        if (!obs) continue;
        AABB expanded = obs->world_aabb;
        expanded.min -= Vec3(sep_dist, sep_dist, sep_dist);
        expanded.max += Vec3(sep_dist, sep_dist, sep_dist);
        if (body_aabb.overlaps(expanded)) return false;
    }
    return true;
}

/// Simulate extending from a state with a force/torque, using contact-aware physics.
BodyState extend(const BodyState& from, const TriMesh& mesh,
                 const Vec3& force, const Vec3& torque,
                 const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
                 const RRTPlannerConfig& config) {
    physics::RigidBody body;
    body.id = "rrt";
    body.mass = 1.0f;
    body.mesh = &mesh;
    body.state = from;

    Vec3 half = mesh.local_aabb().size() * 0.5f;
    body.inertia = physics::RigidBody::box_inertia(body.mass, half);
    body.inertia_inv = body.inertia.inverse();

    const auto& cc = config.contact_config;

    for (int s = 0; s < config.sim_steps_per_extend; ++s) {
        body.clear_forces();
        body.apply_force(force);
        body.apply_torque(torque);

        // Detect contacts with obstacles and apply penalty + friction forces
        auto contacts = detect_sdf_contacts(body, 0, obstacles, cc.max_sample_vertices);
        if (!contacts.empty()) {
            std::vector<physics::RigidBody> bodies_vec = {body};
            physics::apply_contact_forces(bodies_vec, contacts, cc);
            body = bodies_vec[0];
        }

        // Semi-implicit Euler integration
        Vec3 accel = body.force / body.mass;
        body.state.linear_velocity += accel * config.sim_dt;
        body.state.position += body.state.linear_velocity * config.sim_dt;

        // Angular dynamics
        if (body.torque.norm() > 1e-8f || body.state.angular_velocity.norm() > 1e-8f) {
            Eigen::Matrix3f I_inv = body.world_inertia_inv();
            Vec3 angular_accel = I_inv * body.torque;
            body.state.angular_velocity += angular_accel * config.sim_dt;

            Vec3 w = body.state.angular_velocity;
            float w_mag = w.norm();
            if (w_mag > 1e-8f) {
                float half_angle = w_mag * config.sim_dt * 0.5f;
                Vec3 axis = w / w_mag;
                Quat dq(std::cos(half_angle),
                         axis.x() * std::sin(half_angle),
                         axis.y() * std::sin(half_angle),
                         axis.z() * std::sin(half_angle));
                body.state.orientation = (dq * body.state.orientation).normalized();
            }
        }

        // Penetration correction after integration
        apply_sdf_penetration_correction(body, obstacles, cc.max_sample_vertices);
    }
    return body.state;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// RRT planner
// ---------------------------------------------------------------------------

RRTResult plan_rrt(
    const TriMesh& moving_mesh,
    const Isometry& moving_pose,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    const RRTPlannerConfig& config) {

    RRTResult result;
    if (moving_mesh.empty()) return result;

    std::mt19937 rng(42); // Fixed seed for reproducibility
    std::uniform_real_distribution<float> unit_dist(0.0f, 1.0f);
    std::uniform_real_distribution<float> pos_dist(-config.pos_range, config.pos_range);
    std::uniform_real_distribution<float> angle_dist(0.0f, 2.0f * static_cast<float>(M_PI));

    // Initialize tree
    std::vector<RRTNode> tree;
    BodyState initial;
    initial.position = moving_pose.translation;
    initial.orientation = moving_pose.rotation;

    RRTNode root;
    root.state = initial;
    tree.push_back(root);

    std::cout << "[rrt] start pos=(" << moving_pose.translation.x()
              << "," << moving_pose.translation.y()
              << "," << moving_pose.translation.z() << ")"
              << " obstacles=" << obstacles.size()
              << " sep_dist=" << config.separation_distance
              << " steps/extend=" << config.sim_steps_per_extend
              << " dt=" << config.sim_dt << std::endl;

    for (int iter = 0; iter < config.max_iterations; ++iter) {
        result.iterations = iter + 1;

        // Sample a target state (with goal bias)
        BodyState target;
        if (unit_dist(rng) < config.goal_bias) {
            // Goal: sample a point far away in a random direction
            float theta = angle_dist(rng);
            float phi = angle_dist(rng) * 0.5f;
            Vec3 dir(std::sin(phi) * std::cos(theta),
                     std::sin(phi) * std::sin(theta),
                     std::cos(phi));
            target.position = initial.position + dir * config.separation_distance * 2.0f;
            target.orientation = initial.orientation;
        } else {
            // Random sample in workspace
            target.position = initial.position +
                Vec3(pos_dist(rng), pos_dist(rng), pos_dist(rng));
            target.orientation = initial.orientation;
        }

        // Find nearest node in tree
        int nearest_idx = 0;
        float nearest_dist = std::numeric_limits<float>::max();
        for (int i = 0; i < static_cast<int>(tree.size()); ++i) {
            float d = state_distance(tree[i].state, target);
            if (d < nearest_dist) {
                nearest_dist = d;
                nearest_idx = i;
            }
        }

        // Compute force direction toward target
        Vec3 direction = target.position - tree[nearest_idx].state.position;
        float dir_mag = direction.norm();
        if (dir_mag < 1e-6f) continue;
        direction /= dir_mag;

        Vec3 force = direction * config.force_magnitude;
        Vec3 torque_vec = Vec3::Zero();

        // Extend with contact-aware physics
        BodyState new_state = extend(tree[nearest_idx].state, moving_mesh,
                                      force, torque_vec, obstacles, config);

        // Reject states that are deeply penetrating
        // (contact physics should prevent this, but check anyway)
        bool deeply_penetrating = false;
        {
            Isometry iso = new_state.to_isometry();
            for (const auto& obs : obstacles) {
                if (!obs || obs->sdf.empty()) continue;
                AABB body_aabb = moving_mesh.world_aabb(iso);
                if (!body_aabb.overlaps(obs->world_aabb, 0.001f)) continue;

                int nverts = static_cast<int>(moving_mesh.vertices.size());
                int stride = std::max(1, nverts / 50); // Quick check
                for (int vi = 0; vi < nverts; vi += stride) {
                    Vec3 world_v = iso.transform_point(moving_mesh.vertices[vi]);
                    float dist = obs->sdf.query(world_v);
                    if (dist < -0.1f) { // Allow minor penetration from contact physics
                        deeply_penetrating = true;
                        break;
                    }
                }
                if (deeply_penetrating) break;
            }
        }
        if (deeply_penetrating) continue;

        // Add to tree
        RRTNode node;
        node.state = new_state;
        node.parent = nearest_idx;
        int new_idx = static_cast<int>(tree.size());
        tree.push_back(node);

        // Check disassembly
        if (is_separated(new_state, moving_mesh, obstacles,
                          config.separation_distance)) {
            result.success = true;
            result.tree_size = static_cast<int>(tree.size());

            // Reconstruct path
            int idx = new_idx;
            while (idx >= 0) {
                result.trajectory.insert(result.trajectory.begin(), tree[idx].state);
                idx = tree[idx].parent;
            }

            Vec3 displacement = new_state.position - initial.position;
            float mag = displacement.norm();
            if (mag > 1e-6f) result.final_direction = displacement / mag;

            std::cout << "[rrt] result: success=1 iters=" << result.iterations
                      << " tree=" << result.tree_size << std::endl;
            return result;
        }
    }

    result.tree_size = static_cast<int>(tree.size());
    std::cout << "[rrt] result: success=0 iters=" << result.iterations
              << " tree=" << result.tree_size << std::endl;
    return result;
}

} // namespace carbon
