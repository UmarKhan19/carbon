#include "simulator/bfs_planner.h"

#include <deque>
#include <unordered_set>
#include <cmath>

namespace carbon {

using physics::BodyState;

namespace {

/// Discretize a float to a grid for state hashing.
int discretize(float val, float resolution) {
    return static_cast<int>(std::round(val / resolution));
}

/// Hash a body state for deduplication.
struct StateHash {
    float pos_res;
    float rot_res;

    size_t operator()(const BodyState& s) const {
        // Hash position and orientation (discretized)
        int px = discretize(s.position.x(), pos_res);
        int py = discretize(s.position.y(), pos_res);
        int pz = discretize(s.position.z(), pos_res);

        // Use quaternion w and first component as rotation proxy
        int rw = discretize(s.orientation.w(), rot_res);
        int rx = discretize(s.orientation.x(), rot_res);

        size_t h = 0;
        h ^= std::hash<int>()(px) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>()(py) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>()(pz) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>()(rw) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>()(rx) + 0x9e3779b9 + (h << 6) + (h >> 2);
        return h;
    }
};

struct StateEqual {
    float pos_threshold;
    float rot_threshold;

    bool operator()(const BodyState& a, const BodyState& b) const {
        if ((a.position - b.position).norm() > pos_threshold) return false;
        // Quaternion distance: angle between orientations
        float dot = std::abs(a.orientation.dot(b.orientation));
        dot = std::min(dot, 1.0f);
        float angle = 2.0f * std::acos(dot);
        return angle < rot_threshold;
    }
};

/// BFS node in the search tree.
struct BFSNode {
    BodyState state;
    int parent = -1;      ///< Index of parent node (-1 for root).
    int action_idx = -1;  ///< Index of action taken from parent.
    int depth = 0;
};

/// Generate the set of canonical actions (forces in ±X, ±Y, ±Z).
std::vector<BFSAction> generate_actions(float force_mag, float torque_mag,
                                         bool use_torques) {
    std::vector<BFSAction> actions;

    // 6 force directions
    Vec3 dirs[] = {{1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1}};
    for (const auto& d : dirs) {
        BFSAction a;
        a.force = d * force_mag;
        actions.push_back(a);
    }

    // 6 torque directions (optional)
    if (use_torques) {
        for (const auto& d : dirs) {
            BFSAction a;
            a.torque = d * torque_mag;
            actions.push_back(a);
        }
    }

    return actions;
}

/// Check if the body is separated from all obstacles.
bool is_disassembled(const BodyState& state, const TriMesh& mesh,
                     const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
                     float separation_dist) {
    Isometry iso = state.to_isometry();
    AABB body_aabb = mesh.world_aabb(iso);

    for (const auto& obs : obstacles) {
        if (!obs) continue;
        // Check if AABBs are separated by at least separation_dist
        AABB expanded = obs->world_aabb;
        expanded.min -= Vec3(separation_dist, separation_dist, separation_dist);
        expanded.max += Vec3(separation_dist, separation_dist, separation_dist);
        if (body_aabb.overlaps(expanded)) return false;
    }
    return true;
}

/// Check if the body collides with any obstacle.
bool collides_with_obstacles(const BodyState& state, const TriMesh& mesh,
                              const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles) {
    Isometry iso = state.to_isometry();
    for (const auto& obs : obstacles) {
        if (!obs) continue;
        if (sdf_mesh_intersects(mesh, iso, *obs)) return true;
    }
    return false;
}

/// Check if a state is similar to any ancestor in the current branch.
/// Prevents back-and-forth oscillation within a single BFS trajectory.
/// Reference: Assemble-Them-All's any_state_similar(temp_path[:-frame_skip], new_state.q).
bool oscillates_with_ancestors(const BodyState& state,
                                int parent_idx,
                                const std::vector<BFSNode>& nodes,
                                float pos_threshold) {
    int idx = parent_idx;
    while (idx > 0) {  // skip root (idx 0) — everything starts there
        if ((state.position - nodes[idx].state.position).norm() < pos_threshold) {
            return true;
        }
        idx = nodes[idx].parent;
    }
    return false;
}

/// Simulate one action: apply force/torque for N steps and return final state.
BodyState simulate_action(const BodyState& start, const TriMesh& mesh,
                           const BFSAction& action, const BFSPlannerConfig& config) {
    physics::RigidBody body;
    body.id = "moving";
    body.mass = 1.0f;
    body.mesh = &mesh;
    body.state = start;

    Vec3 half = mesh.local_aabb().size() * 0.5f;
    body.inertia = physics::RigidBody::box_inertia(body.mass, half);
    body.inertia_inv = body.inertia.inverse();

    // Simulate with applied force/torque (no gravity, no ground)
    for (int s = 0; s < config.sim_steps_per_action; ++s) {
        body.clear_forces();
        body.apply_force(action.force);
        body.apply_torque(action.torque);

        // Semi-implicit Euler (lightweight, no full simulation needed)
        Vec3 accel = body.force / body.mass;
        body.state.linear_velocity += accel * config.sim_dt;
        body.state.position += body.state.linear_velocity * config.sim_dt;

        if (action.torque.norm() > 1e-8f) {
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
// BFS planner
// ---------------------------------------------------------------------------

BFSResult plan_bfs(
    const TriMesh& moving_mesh,
    const Isometry& moving_pose,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    const BFSPlannerConfig& config) {

    BFSResult result;

    if (moving_mesh.empty()) return result;

    auto actions = generate_actions(config.force_magnitude, config.torque_magnitude,
                                     config.use_torques);

    // State deduplication
    StateHash hasher{config.pos_threshold, config.rot_threshold};
    StateEqual equaler{config.pos_threshold, config.rot_threshold};
    std::unordered_set<BodyState, StateHash, StateEqual> visited(16, hasher, equaler);

    // BFS tree
    std::vector<BFSNode> nodes;
    std::deque<int> queue;

    // Root node
    BodyState initial;
    initial.position = moving_pose.translation;
    initial.orientation = moving_pose.rotation;

    BFSNode root;
    root.state = initial;
    nodes.push_back(root);
    queue.push_back(0);
    visited.insert(initial);

    while (!queue.empty() && result.states_explored < config.max_states) {
        int current_idx = queue.front();
        queue.pop_front();
        const auto& current = nodes[current_idx];

        if (current.depth >= config.max_bfs_depth) continue;

        for (int ai = 0; ai < static_cast<int>(actions.size()); ++ai) {
            // Simulate action
            BodyState new_state = simulate_action(
                current.state, moving_mesh, actions[ai], config);

            result.states_explored++;

            // Check if already visited (similar state)
            if (visited.count(new_state)) continue;

            // Check collision
            if (collides_with_obstacles(new_state, moving_mesh, obstacles)) continue;

            // Check oscillation: is new state similar to any ancestor in this branch?
            // Uses 2x pos_threshold (= 0.1) as oscillation radius — slightly looser
            // than state dedup to catch near-revisits that hash differently.
            if (oscillates_with_ancestors(new_state, current_idx, nodes,
                                           config.pos_threshold * 2.0f)) continue;

            // Add to tree
            visited.insert(new_state);
            BFSNode node;
            node.state = new_state;
            node.parent = current_idx;
            node.action_idx = ai;
            node.depth = current.depth + 1;
            int new_idx = static_cast<int>(nodes.size());
            nodes.push_back(node);
            queue.push_back(new_idx);

            // Check disassembly
            if (is_disassembled(new_state, moving_mesh, obstacles,
                                config.separation_distance)) {
                result.success = true;
                result.depth = node.depth;

                // Reconstruct path
                int idx = new_idx;
                while (idx > 0) {
                    result.actions.insert(result.actions.begin(),
                                          actions[nodes[idx].action_idx]);
                    result.trajectory.insert(result.trajectory.begin(),
                                              nodes[idx].state);
                    idx = nodes[idx].parent;
                }
                result.trajectory.insert(result.trajectory.begin(), initial);

                // Compute approximate direction
                Vec3 displacement = new_state.position - initial.position;
                float mag = displacement.norm();
                if (mag > 1e-6f) result.final_direction = displacement / mag;

                return result;
            }
        }
    }

    return result;
}

} // namespace carbon
