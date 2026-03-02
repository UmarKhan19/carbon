#pragma once

/// Stability checking for remaining assembly after part removal.
/// Simulates remaining parts under gravity and checks if they settle
/// or collapse. Uses the RedMax physics engine from Phase 3.

#include "collision/sdf.h"
#include "geometry/types.h"
#include "physics/simulation.h"
#include <string>
#include <vector>

namespace carbon {

/// Configuration for stability checking.
struct StabilityConfig {
    float sim_dt = 0.001f;               ///< Physics timestep.
    int max_steps = 2000;                 ///< Maximum simulation steps.
    float displacement_threshold = 0.1f;  ///< Max displacement before "unstable" (units).
    float velocity_threshold = 0.01f;     ///< Rest velocity threshold.
    Vec3 gravity{0, -9.81f, 0};           ///< Gravity direction and magnitude.
    bool enable_ground = true;            ///< Enable ground plane.
    Vec3 ground_point{0, 0, 0};           ///< Ground plane point.
    Vec3 ground_normal{0, 1, 0};          ///< Ground plane normal.
};

/// Stability status of a single part.
struct PartStability {
    std::string part_id;
    bool stable = true;
    float max_displacement = 0.0f;        ///< Maximum displacement during simulation.
    Vec3 final_position{0, 0, 0};         ///< Final position after simulation.
};

/// Result of a stability check.
struct StabilityResult {
    bool assembly_stable = true;           ///< True if all parts are stable.
    std::vector<PartStability> parts;      ///< Per-part stability info.
    std::vector<std::string> unstable_ids; ///< IDs of parts that moved.
    int steps_simulated = 0;
};

/// Part data for stability checking.
struct StabilityPart {
    std::string id;
    const TriMesh* mesh = nullptr;
    Isometry transform;
    float mass = 1.0f;
    bool is_grounded = false;             ///< Fixed to ground (won't move).
};

/// Check if a subassembly (remaining parts) is stable under gravity.
/// Simulates the parts for a short time and checks displacement.
///
/// @param parts     The remaining parts with their poses.
/// @param config    Stability checking configuration.
/// @return          Stability result with per-part information.
StabilityResult check_stability(
    const std::vector<StabilityPart>& parts,
    const StabilityConfig& config = {});

} // namespace carbon
