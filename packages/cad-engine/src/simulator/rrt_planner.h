#pragma once

/// BK-RRT (Backward Kinodynamic Rapidly-exploring Random Tree) planner.
/// For complex removal paths where BFS fails — random sampling in
/// configuration space with physics-based extension.

#include "collision/sdf_collision.h"
#include "geometry/types.h"
#include "physics/contact_solver.h"
#include "physics/rigid_body.h"
#include <memory>
#include <vector>

namespace carbon {

/// Configuration for the RRT planner.
struct RRTPlannerConfig {
    float force_magnitude = 50.0f;       ///< Force magnitude per extension (N).
    float torque_magnitude = 10.0f;      ///< Torque magnitude per extension (Nm).
    int sim_steps_per_extend = 100;      ///< Physics steps per tree extension.
    float sim_dt = 0.001f;              ///< Physics timestep (prevents tunneling).
    int max_iterations = 5000;           ///< Maximum RRT iterations.
    float goal_bias = 0.2f;             ///< Probability of sampling toward goal.
    float separation_distance = 2.0f;    ///< Distance to consider disassembled.
    float pos_range = 5.0f;             ///< Position sampling range from start.
    bool use_torques = false;            ///< Include torque actions.
    physics::ContactConfig contact_config; ///< Contact physics parameters.
};

/// Result of an RRT path planning attempt.
struct RRTResult {
    bool success = false;
    std::vector<physics::BodyState> trajectory; ///< State trajectory.
    Vec3 final_direction{0, 0, 0};       ///< Approximate removal direction.
    int iterations = 0;
    int tree_size = 0;
};

/// Plan a removal path for a single part using BK-RRT.
///
/// @param moving_mesh   Mesh of the part to remove.
/// @param moving_pose   Initial pose of the part.
/// @param obstacles     Pre-built SDF meshes of all other (static) parts.
/// @param config        RRT planner configuration.
/// @return RRT result with success flag and trajectory.
RRTResult plan_rrt(
    const TriMesh& moving_mesh,
    const Isometry& moving_pose,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    const RRTPlannerConfig& config = {});

} // namespace carbon
