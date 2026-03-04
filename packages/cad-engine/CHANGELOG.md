# CAD Engine Changelog

## 2026-03-02 — Physics-Only Assembly Simulation

Replace hybrid geometric+physics approach with physics-only disassembly simulation
(Assemble-Them-All algorithm). The BFS planner now uses full contact-aware simulation
at every timestep instead of free-body motion with post-hoc collision checks.

### Changed

- **Contact solver** (`contact_solver.h/cpp`):
  - Increased `contact_stiffness` from `1e4` to `1e6` and `contact_damping` from `100` to `1e3`
  - Added `max_sample_vertices` config (default 200) with vertex sampling stride for O(N/stride) contact detection
  - Fixed Baumgarte stabilization to use actual `dt` parameter instead of hardcoded `0.01`
  - Added `resolve_contacts_impulse()` overload accepting explicit `dt`
  - Added `apply_penetration_correction()` — projects penetrating vertices out along SDF gradient after integration

- **BFS planner** (`bfs_planner.h/cpp`):
  - Rewrote `simulate_action()` with full contact-aware physics: penalty forces, Coulomb friction, and penetration correction at each timestep
  - Changed defaults: `sim_dt` 0.01 -> 0.001, `sim_steps_per_action` 10 -> 100, `max_bfs_depth` 50 -> 100, `max_states` 5000 -> 10000
  - Added `stuck_threshold` config and stuck detection: actions producing < 0.01mm movement are pruned
  - Replaced AABB-only `is_disassembled()` with SDF-based check: samples body vertices against obstacle SDFs
  - Added `ContactConfig` field to `BFSPlannerConfig` for tuning contact physics parameters
  - Removed post-hoc `collides_with_obstacles()` check (contacts are resolved during simulation)

- **Simulator** (`simulator.h/cpp`):
  - Replaced hybrid geometric+physics main loop with physics-only greedy approach
  - Removed `SequenceStrategy` enum (`Current`, `Queue`, `ProgressiveQueue`)
  - Removed geometric planner path (`try_geometric_removal` lambda)
  - Removed SDF validation gate (`validate_path_with_sdf`)
  - Removed blocking matrix from planning path (kept module for diagnostics)
  - Removed `build_neighbor_states()` (was only used by geometric planner)
  - Simplified main loop: sort by outsideness, try physics removal, restart on success, increase budget on failure

### Removed

- `SequenceStrategy` enum and `strategy` config field
- `validate_path_with_sdf()` static function
- `try_geometric_removal` lambda in `simulate()`
- Blocking matrix usage in planning path (module still exists for diagnostics)

### Tests

- Added `ContactPhysicsWithObstacles` — verifies BFS with contact-aware simulation finds paths around obstacles
- Added `StuckDetectionLimitsExploration` — verifies stuck detection prunes trapped parts early
- Added `VertexSamplingStrideWorks` — verifies aggressive vertex sampling still finds paths
- Added `ThreePartStackPhysicsOnly` — verifies full assembly ordering via physics only
- Updated `PhysicsOnlyHandlesTouchingParts` (was `SDFGatekeeperRejectsClippingPath`)
- Updated `RespectsTimeout` (was `QueueStrategyRespectsTimeout`)
- Updated `ConfigMaxRetriesDefault` (was `SequenceStrategyDefaultIsProgressiveQueue`)
- Removed strategy-specific tests (Queue/ProgressiveQueue variants)
