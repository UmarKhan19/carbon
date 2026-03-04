#include "simulator/bfs_planner.h"
#include "physics/contact_solver.h"

#include <deque>
#include <unordered_set>
#include <cmath>

namespace carbon {

using physics::BodyState;
using physics::RigidBody;
using physics::BodyContact;

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

/// Generate the set of canonical actions (forces in +/-X, +/-Y, +/-Z).
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

/// Check if the body is separated from all obstacles using SDF queries.
/// Samples body vertices at final position against all obstacle SDFs.
/// Separated when all sampled distances are positive and > threshold.
bool is_disassembled(const BodyState& state, const TriMesh& mesh,
                     const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
                     float separation_dist, int max_sample_verts) {
    Isometry iso = state.to_isometry();
    AABB body_aabb = mesh.world_aabb(iso);

    for (const auto& obs : obstacles) {
        if (!obs) continue;

        // Fast AABB pre-check with separation margin
        AABB expanded = obs->world_aabb;
        expanded.min -= Vec3(separation_dist, separation_dist, separation_dist);
        expanded.max += Vec3(separation_dist, separation_dist, separation_dist);
        if (!body_aabb.overlaps(expanded)) continue;

        // Detailed SDF check: sample body vertices
        if (obs->sdf.empty()) {
            // Fall back to AABB overlap
            return false;
        }

        int stride = 1;
        int nverts = static_cast<int>(mesh.vertices.size());
        if (max_sample_verts > 0 && nverts > max_sample_verts) {
            stride = (nverts + max_sample_verts - 1) / max_sample_verts;
        }

        for (int vi = 0; vi < nverts; vi += stride) {
            Vec3 world_v = iso.transform_point(mesh.vertices[vi]);
            float dist = obs->sdf.query(world_v);
            if (dist < separation_dist) return false;
        }
    }
    return true;
}

/// Check if a state is similar to any ancestor in the current branch.
/// Prevents back-and-forth oscillation within a single BFS trajectory.
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

/// Detect contacts between a moving body and static SDF obstacles.
/// Returns BodyContact list compatible with contact_solver functions.
std::vector<BodyContact> detect_sdf_contacts(
    const RigidBody& body, int body_idx,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    int max_sample_verts) {
    std::vector<BodyContact> contacts;
    if (!body.mesh) return contacts;

    Isometry iso = body.state.to_isometry();
    AABB body_aabb = body.world_aabb();

    for (const auto& obs : obstacles) {
        if (!obs || obs->sdf.empty()) continue;
        if (!body_aabb.overlaps(obs->world_aabb, 0.001f)) continue;

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

                BodyContact c;
                c.body_a = -1; // obstacle (static, not in bodies array)
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
void apply_sdf_penetration_correction(
    RigidBody& body,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    int max_sample_verts) {
    if (!body.mesh) return;

    Isometry iso = body.state.to_isometry();
    AABB body_aabb = body.world_aabb();

    for (const auto& obs : obstacles) {
        if (!obs || obs->sdf.empty()) continue;
        if (!body_aabb.overlaps(obs->world_aabb, 0.001f)) continue;

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

/// Simulate one action with full contact-aware physics.
/// Applies penalty forces, Coulomb friction, and penetration correction at each step.
BodyState simulate_action(const BodyState& start, const TriMesh& mesh,
                           const BFSAction& action,
                           const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
                           const BFSPlannerConfig& config) {
    RigidBody body;
    body.id = "moving";
    body.mass = 1.0f;
    body.mesh = &mesh;
    body.state = start;

    Vec3 half = mesh.local_aabb().size() * 0.5f;
    body.inertia = RigidBody::box_inertia(body.mass, half);
    body.inertia_inv = body.inertia.inverse();

    const auto& cc = config.contact_config;

    for (int s = 0; s < config.sim_steps_per_action; ++s) {
        body.clear_forces();
        body.apply_force(action.force);
        body.apply_torque(action.torque);

        // Detect contacts with obstacles and apply penalty + friction forces
        auto contacts = detect_sdf_contacts(body, 0, obstacles, cc.max_sample_vertices);
        if (!contacts.empty()) {
            // Apply penalty and friction forces via existing contact solver
            // We need a vector with the body in it for the solver API
            std::vector<RigidBody> bodies_vec = {body};
            physics::apply_contact_forces(bodies_vec, contacts, cc);
            body = bodies_vec[0]; // Copy back forces
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

    int max_sample_verts = config.contact_config.max_sample_vertices;

    while (!queue.empty() && result.states_explored < config.max_states) {
        int current_idx = queue.front();
        queue.pop_front();
        const auto& current = nodes[current_idx];

        if (current.depth >= config.max_bfs_depth) continue;

        for (int ai = 0; ai < static_cast<int>(actions.size()); ++ai) {
            // Simulate action with contact physics
            BodyState new_state = simulate_action(
                current.state, moving_mesh, actions[ai], obstacles, config);

            result.states_explored++;

            // Stuck detection: if part barely moved, skip this direction
            float movement = (new_state.position - current.state.position).norm();
            if (movement < config.stuck_threshold) continue;

            // Check if already visited (similar state)
            if (visited.count(new_state)) continue;

            // Check oscillation: is new state similar to any ancestor in this branch?
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
                                config.separation_distance, max_sample_verts)) {
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
