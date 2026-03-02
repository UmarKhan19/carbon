#pragma once

/// BFS (Breadth-First Search) physics-based path planner.
/// Explores state space by applying forces in canonical directions and
/// simulating forward with the physics engine. Based on the approach
/// from Assemble-Them-All (SIGGRAPH Asia 2022).

#include "collision/sdf_collision.h"
#include "geometry/types.h"
#include "physics/simulation.h"
#include <functional>
#include <optional>
#include <vector>

namespace carbon {

/// Configuration for the BFS planner.
struct BFSPlannerConfig {
    float force_magnitude = 50.0f;       ///< Force magnitude per action (N).
    float torque_magnitude = 10.0f;      ///< Torque magnitude per action (Nm).
    int sim_steps_per_action = 10;       ///< Physics steps per BFS action.
    float sim_dt = 0.01f;               ///< Physics timestep.
    int max_bfs_depth = 50;              ///< Maximum BFS tree depth.
    int max_states = 5000;               ///< Maximum states explored.
    float pos_threshold = 0.05f;         ///< State dedup: position threshold.
    float rot_threshold = 0.5f;          ///< State dedup: rotation threshold (rad).
    float separation_distance = 2.0f;    ///< Distance to consider part disassembled.
    bool use_torques = false;            ///< Include torque actions in search.
};

/// A single action (force/torque) in the BFS search.
struct BFSAction {
    Vec3 force{0, 0, 0};
    Vec3 torque{0, 0, 0};
};

/// Result of a BFS path planning attempt.
struct BFSResult {
    bool success = false;
    std::vector<BFSAction> actions;       ///< Sequence of actions to disassemble.
    std::vector<physics::BodyState> trajectory; ///< State trajectory of the moving part.
    Vec3 final_direction{0, 0, 0};       ///< Approximate overall removal direction.
    int states_explored = 0;
    int depth = 0;
};

/// Plan a removal path for a single part using BFS over physics actions.
///
/// @param moving_mesh   Mesh of the part to remove.
/// @param moving_pose   Initial pose of the part.
/// @param obstacles     Pre-built SDF meshes of all other (static) parts.
/// @param config        BFS planner configuration.
/// @return BFS result with success flag and action sequence.
BFSResult plan_bfs(
    const TriMesh& moving_mesh,
    const Isometry& moving_pose,
    const std::vector<std::shared_ptr<CachedSDFMesh>>& obstacles,
    const BFSPlannerConfig& config = {});

} // namespace carbon
