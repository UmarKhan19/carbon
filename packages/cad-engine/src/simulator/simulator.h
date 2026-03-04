#pragma once

/// Main assembly-by-disassembly simulator.
/// Uses physics-only approach (BFS + RRT with contact-aware simulation).

#include "geometry/types.h"
#include "simulator/path_planner.h"
#include "collision/contact_graph.h"
#include "collision/sdf_collision.h"
#include "classification/part_classifier.h"
#include "graph/dependency_graph.h"
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace carbon {

struct SimulatorConfig {
    uint64_t timeout_ms = 60000;
    float removal_distance = 100.0f;
    uint32_t removal_steps = 50;
    bool check_stability = true;
    Vec3 gravity{0.0f, -9.81f, 0.0f};
    float clearance_epsilon = 0.0f;
    int max_retries = 4;  ///< Max retries (with increasing budget) before giving up.
};

class AssemblySimulator {
public:
    explicit AssemblySimulator(SimulatorConfig config = {});

    /// Load the assembly tree and extract part meshes.
    void load_assembly(const AssemblyNode& root);

    /// Run the simulation and return the result.
    SimulationResult simulate();

private:
    SimulatorConfig config_;

    // Part data extracted from the assembly tree
    std::vector<PartData> parts_;
    std::unordered_map<std::string, const PartData*> part_map_;  // O(1) lookup by ID
    AABB global_aabb_;
    float scene_diagonal_ = 0.0f;

    // State during simulation
    std::unordered_set<std::string> removed_parts_;
    uint64_t collision_checks_ = 0;
    uint64_t path_evaluations_ = 0;
    uint64_t blocking_matrix_skips_ = 0;

    // Helpers
    float compute_removal_distance() const;

    /// Try to find a removal path for a part using physics-based planners (BFS then RRT).
    /// Returns true and populates direction/eval if successful.
    /// Uses precomputed SDFs for collision detection.
    bool try_physics_path(
        const PartData& part,
        int retry_count,
        Vec3& out_direction,
        PathEvaluation& out_eval,
        const std::unordered_map<std::string, std::shared_ptr<CachedSDFMesh>>& part_sdfs);
};

} // namespace carbon
