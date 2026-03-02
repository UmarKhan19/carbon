#include "simulator/rrt_planner.h"
#include "physics/rigid_body.h"

#include <cmath>
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

/// Check if the body collides with any obstacle.
bool collides(const BodyState& state, const TriMesh& mesh,
              const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles) {
    Isometry iso = state.to_isometry();
    for (const auto& obs : obstacles) {
        if (!obs) continue;
        if (sdf_mesh_intersects(mesh, iso, *obs)) return true;
    }
    return false;
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

/// Simulate extending from a state with a random force/torque.
BodyState extend(const BodyState& from, const TriMesh& mesh,
                 const Vec3& force, const Vec3& torque,
                 const RRTPlannerConfig& config) {
    physics::RigidBody body;
    body.id = "rrt";
    body.mass = 1.0f;
    body.mesh = &mesh;
    body.state = from;

    Vec3 half = mesh.local_aabb().size() * 0.5f;
    body.inertia = physics::RigidBody::box_inertia(body.mass, half);
    body.inertia_inv = body.inertia.inverse();

    for (int s = 0; s < config.sim_steps_per_extend; ++s) {
        body.clear_forces();
        body.apply_force(force);
        body.apply_torque(torque);

        Vec3 accel = body.force / body.mass;
        body.state.linear_velocity += accel * config.sim_dt;
        body.state.position += body.state.linear_velocity * config.sim_dt;

        if (torque.norm() > 1e-8f) {
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
        Vec3 torque = Vec3::Zero();

        // Extend
        BodyState new_state = extend(tree[nearest_idx].state, moving_mesh,
                                      force, torque, config);

        // Check collision
        if (collides(new_state, moving_mesh, obstacles)) continue;

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

            return result;
        }
    }

    result.tree_size = static_cast<int>(tree.size());
    return result;
}

} // namespace carbon
