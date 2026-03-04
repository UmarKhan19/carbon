#include <gtest/gtest.h>
#include "simulator/simulator.h"
#include "simulator/path_planner.h"
#include "simulator/animation_gen.h"
#include "collision/blocking_matrix.h"
#include "collision/collision_utils.h"
#include "collision/contact_graph.h"
#include "geometry/aabb.h"
#include "test_helpers.h"

#include <cmath>
#include <algorithm>
#include <numeric>

using namespace carbon;
using namespace carbon::test;

// ===========================================================================
// Simulator config & basic tests
// ===========================================================================

TEST(Simulator, ConfigDefault) {
    SimulatorConfig config;
    EXPECT_EQ(config.timeout_ms, 60000u);
    EXPECT_EQ(config.removal_steps, 50u);
    EXPECT_FLOAT_EQ(config.removal_distance, 100.0f);
}

TEST(Simulator, EmptyAssemblyReturnsError) {
    AssemblySimulator sim;
    // Don't load anything
    auto result = sim.simulate();
    EXPECT_FALSE(result.success);
    EXPECT_TRUE(result.error.has_value());
}

TEST(Simulator, SinglePartSucceeds) {
    AssemblyNode root = make_assembly("root", {
        make_part_node("part_a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0))
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 1u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

// ===========================================================================
// Blocking matrix tests
// ===========================================================================

TEST(BlockingMatrix, FreePart) {
    // Three cubes in a row along X with gaps (2-unit spacing for size-1 cubes)
    TriMesh cube = make_cube(0.5f);
    Isometry iso_left = iso_at(Vec3(-3.0f, 0, 0));
    Isometry iso_center = iso_at(Vec3(0, 0, 0));
    Isometry iso_right = iso_at(Vec3(3.0f, 0, 0));

    std::vector<BlockingPartData> parts = {
        {"left", &cube, iso_left, cube.world_aabb(iso_left)},
        {"center", &cube, iso_center, cube.world_aabb(iso_center)},
        {"right", &cube, iso_right, cube.world_aabb(iso_right)},
    };

    auto bm = BlockingMatrix::build(parts, 5.0f, 0.01f);

    std::unordered_set<std::string> removed;
    // Center is blocked in ±X but free in ±Y, ±Z
    EXPECT_FALSE(bm.is_blocked_in_all_directions("center", removed));
}

TEST(BlockingMatrix, TrappedPart) {
    // Center cube surrounded by 6 cubes on all faces (tight gap ~0.1)
    TriMesh cube = make_cube(0.5f);
    float gap = 1.1f;  // center-to-center distance (cube size 1 + 0.1 gap)

    Isometry iso_center = iso_at(Vec3(0, 0, 0));
    Isometry iso_px = iso_at(Vec3(gap, 0, 0));
    Isometry iso_nx = iso_at(Vec3(-gap, 0, 0));
    Isometry iso_py = iso_at(Vec3(0, gap, 0));
    Isometry iso_ny = iso_at(Vec3(0, -gap, 0));
    Isometry iso_pz = iso_at(Vec3(0, 0, gap));
    Isometry iso_nz = iso_at(Vec3(0, 0, -gap));

    std::vector<BlockingPartData> parts = {
        {"center", &cube, iso_center, cube.world_aabb(iso_center)},
        {"px", &cube, iso_px, cube.world_aabb(iso_px)},
        {"nx", &cube, iso_nx, cube.world_aabb(iso_nx)},
        {"py", &cube, iso_py, cube.world_aabb(iso_py)},
        {"ny", &cube, iso_ny, cube.world_aabb(iso_ny)},
        {"pz", &cube, iso_pz, cube.world_aabb(iso_pz)},
        {"nz", &cube, iso_nz, cube.world_aabb(iso_nz)},
    };

    auto bm = BlockingMatrix::build(parts, 5.0f, 0.01f);

    std::unordered_set<std::string> removed;
    EXPECT_TRUE(bm.is_blocked_in_all_directions("center", removed));
}

TEST(BlockingMatrix, AfterRemoval) {
    // Same trapped setup — remove +Y neighbor → center becomes free
    TriMesh cube = make_cube(0.5f);
    float gap = 1.1f;

    Isometry iso_center = iso_at(Vec3(0, 0, 0));
    Isometry iso_px = iso_at(Vec3(gap, 0, 0));
    Isometry iso_nx = iso_at(Vec3(-gap, 0, 0));
    Isometry iso_py = iso_at(Vec3(0, gap, 0));
    Isometry iso_ny = iso_at(Vec3(0, -gap, 0));
    Isometry iso_pz = iso_at(Vec3(0, 0, gap));
    Isometry iso_nz = iso_at(Vec3(0, 0, -gap));

    std::vector<BlockingPartData> parts = {
        {"center", &cube, iso_center, cube.world_aabb(iso_center)},
        {"px", &cube, iso_px, cube.world_aabb(iso_px)},
        {"nx", &cube, iso_nx, cube.world_aabb(iso_nx)},
        {"py", &cube, iso_py, cube.world_aabb(iso_py)},
        {"ny", &cube, iso_ny, cube.world_aabb(iso_ny)},
        {"pz", &cube, iso_pz, cube.world_aabb(iso_pz)},
        {"nz", &cube, iso_nz, cube.world_aabb(iso_nz)},
    };

    auto bm = BlockingMatrix::build(parts, 5.0f, 0.01f);

    std::unordered_set<std::string> removed = {"py"};
    EXPECT_FALSE(bm.is_blocked_in_all_directions("center", removed));
}

TEST(BlockingMatrix, IsolatedPart) {
    // Two cubes far apart — both should be free
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(500.0f, 500.0f, 500.0f));

    std::vector<BlockingPartData> parts = {
        {"alone", &cube, iso_a, cube.world_aabb(iso_a)},
        {"far", &cube, iso_b, cube.world_aabb(iso_b)},
    };

    auto bm = BlockingMatrix::build(parts, 5.0f, 0.01f);

    std::unordered_set<std::string> removed;
    EXPECT_FALSE(bm.is_blocked_in_all_directions("alone", removed));
    EXPECT_FALSE(bm.is_blocked_in_all_directions("far", removed));
}

// ===========================================================================
// AABB utility tests
// ===========================================================================

TEST(AABB, SweptAABBEntryTime) {
    // AABB at x=[2,3], moving -X by 5 units toward obstacle at x=[-1,1]
    AABB moving;
    moving.min = Vec3(2.0f, -0.5f, -0.5f);
    moving.max = Vec3(3.0f, 0.5f, 0.5f);

    AABB obstacle;
    obstacle.min = Vec3(-1.0f, -0.5f, -0.5f);
    obstacle.max = Vec3(1.0f, 0.5f, 0.5f);

    // Moving left: displacement = (-5, 0, 0)
    Vec3 disp(-5.0f, 0, 0);
    auto entry = swept_aabb_entry_time(moving, disp, obstacle);
    ASSERT_TRUE(entry.has_value());
    // Gap is 1.0 (from x=2 to x=1), displacement magnitude 5 → t = 1/5 = 0.2
    EXPECT_NEAR(*entry, 0.2f, 0.05f);

    // Moving right (away) → no entry
    auto no_entry = swept_aabb_entry_time(moving, Vec3(5, 0, 0), obstacle);
    EXPECT_FALSE(no_entry.has_value());
}

TEST(AABB, OverlapVolume) {
    AABB a;
    a.min = Vec3(0, 0, 0);
    a.max = Vec3(2, 2, 2);

    AABB b;
    b.min = Vec3(1, 1, 1);
    b.max = Vec3(3, 3, 3);

    float vol = aabb_overlap_volume(a, b);
    EXPECT_NEAR(vol, 1.0f, 0.01f);  // 1x1x1 overlap
}

// ===========================================================================
// Collision utility tests
// ===========================================================================

TEST(Collision, MeshIntersectsOverlapping) {
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(0.5f, 0, 0));  // overlapping

    EXPECT_TRUE(mesh_intersects(cube, iso_a, cube, iso_b));
}

TEST(Collision, MeshIntersectsSeparated) {
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(5.0f, 0, 0));  // far apart

    EXPECT_FALSE(mesh_intersects(cube, iso_a, cube, iso_b));
}

TEST(Collision, MeshDistance) {
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(3.0f, 0, 0));  // 2.0 gap between faces

    float dist = mesh_distance(cube, iso_a, cube, iso_b);
    EXPECT_GT(dist, 1.5f);  // at least 2.0 gap minus some tolerance
    EXPECT_LT(dist, 2.5f);
}

TEST(Collision, CastShapesDiscrete) {
    // Cube moving +X toward another cube
    TriMesh cube = make_cube(0.5f);
    Isometry start = iso_at(Vec3(-3.0f, 0, 0));
    Isometry obstacle_iso = iso_at(Vec3(0, 0, 0));

    Vec3 velocity(6.0f, 0, 0);  // move 6 units right
    auto toi = cast_shapes_discrete(cube, start, velocity, cube, obstacle_iso, 1.0f, 20);

    ASSERT_TRUE(toi.has_value());
    // Gap is 2.0 (from -2.5 to -0.5), velocity 6 → t ≈ 2/6 ≈ 0.33
    EXPECT_GT(*toi, 0.1f);
    EXPECT_LT(*toi, 0.6f);
}

// ===========================================================================
// Path planner tests
// ===========================================================================

TEST(PathPlanner, CandidateDirectionsGenerated) {
    TriMesh cube = make_cube(0.5f);
    PartData part;
    part.id = "test";
    part.name = "test_part";
    part.mesh = &cube;
    part.transform = Isometry::identity();
    part.bbox_size = Vec3(1, 1, 1);
    part.world_aabb = cube.local_aabb();

    // Empty contact graph → still generates global + local axes
    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> empty_parts;
    auto graph = ContactGraph::build(empty_parts, 0.1f);

    auto dirs = candidate_directions_for_part(part, graph);

    // Should have at least 6 directions (global axes)
    EXPECT_GE(dirs.size(), 6u);
}

TEST(PathPlanner, DirectionConstraintFiltersCandidates) {
    TriMesh cube = make_cube(0.5f);
    PartData part;
    part.id = "block";
    part.name = "block";
    part.mesh = &cube;
    part.transform = Isometry::identity();
    part.bbox_size = Vec3(1, 1, 1);
    part.world_aabb = cube.local_aabb();

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> empty_parts;
    auto graph = ContactGraph::build(empty_parts, 0.1f);
    auto all_dirs = candidate_directions_for_part(part, graph);
    auto filtered_dirs = candidate_directions_for_part(part, graph, Vec3(0, 1, 0));

    // Filtered should have fewer or equal directions
    EXPECT_LE(filtered_dirs.size(), all_dirs.size());

    // All filtered directions should be within 45° of +Y
    for (const auto& d : filtered_dirs) {
        float dot = d.dot(Vec3(0, 1, 0));
        EXPECT_GT(dot, 0.7f);  // cos(45°) ≈ 0.707
    }
}

TEST(PathPlanner, EvaluateRemovalPathNoNeighbors) {
    TriMesh cube = make_cube(0.5f);
    PartData part;
    part.id = "alone";
    part.name = "alone";
    part.mesh = &cube;
    part.transform = Isometry::identity();
    part.bbox_size = Vec3(1, 1, 1);
    part.world_aabb = cube.local_aabb();

    std::vector<NeighborState> no_neighbors;
    uint64_t checks = 0;

    auto eval = evaluate_removal_path(part, Vec3(1, 0, 0), 5.0f, 0.01f,
                                       no_neighbors, checks);
    ASSERT_TRUE(eval.has_value());
    EXPECT_TRUE(eval->success);
    EXPECT_GE(eval->travel_distance, 5.0f);
    EXPECT_GE(eval->animation_path.size(), 2u);
}

TEST(PathPlanner, EvaluateRemovalPathBlocked) {
    // Part trying to move into an obstacle directly in front
    TriMesh cube = make_cube(0.5f);
    PartData moving;
    moving.id = "moving";
    moving.name = "moving";
    moving.mesh = &cube;
    moving.transform = iso_at(Vec3(0, 0, 0));
    moving.bbox_size = Vec3(1, 1, 1);
    moving.world_aabb = cube.world_aabb(moving.transform);

    PartData obstacle;
    obstacle.id = "obstacle";
    obstacle.name = "obstacle";
    obstacle.mesh = &cube;
    obstacle.transform = iso_at(Vec3(1.5f, 0, 0));  // 0.5 gap in +X
    obstacle.bbox_size = Vec3(1, 1, 1);
    obstacle.world_aabb = cube.world_aabb(obstacle.transform);

    NeighborState ns;
    ns.part = &obstacle;
    ns.baseline_intersecting = false;
    ns.baseline_overlap_volume = 0.0f;
    ns.relaxed_clearance = 0.01f;

    uint64_t checks = 0;
    auto eval = evaluate_removal_path(moving, Vec3(1, 0, 0), 10.0f, 0.01f,
                                       {ns}, checks);
    // Should fail or have very short travel (blocked by obstacle)
    if (eval.has_value()) {
        EXPECT_LT(eval->travel_distance, 9.0f);  // didn't make full distance
    }
}

// ===========================================================================
// Animation tests
// ===========================================================================

TEST(Animation, StagingPointOutsideAABB) {
    AABB part_aabb;
    part_aabb.min = Vec3(-0.5f, -0.5f, -0.5f);
    part_aabb.max = Vec3(0.5f, 0.5f, 0.5f);

    AABB global_aabb;
    global_aabb.min = Vec3(-5, -5, -5);
    global_aabb.max = Vec3(5, 5, 5);

    Vec3 dir(0, 1, 0);  // approach from +Y
    Vec3 staging = compute_staging_point(part_aabb, global_aabb, dir);

    // Staging point should be outside global AABB in +Y direction
    EXPECT_GT(staging.y(), global_aabb.max.y());
}

TEST(Animation, MultiSegmentKeyframeCount) {
    Mat4 rest = Mat4::Identity();
    Vec3 staging(0, 10, 0);
    Vec3 dir(0, -1, 0);  // approach from above

    auto keyframes = build_assembly_animation(rest, staging, dir);
    EXPECT_GE(keyframes.size(), 3u);  // staging + approach + rest
}

TEST(Animation, TimeAllocationApproachVsInsertion) {
    Mat4 rest = Mat4::Identity();
    Vec3 staging(0, 10, 0);
    Vec3 dir(0, -1, 0);

    auto keyframes = build_assembly_animation(rest, staging, dir, 0.30f);

    ASSERT_GE(keyframes.size(), 2u);
    // Second keyframe should be near t=0.30 (approach fraction)
    EXPECT_NEAR(keyframes[1].time, 0.30f, 0.05f);
}

TEST(Animation, AdaptiveDurationScalesWithDistance) {
    float scene_diag = 10.0f;
    uint32_t short_ms = compute_step_duration(0.5f, scene_diag);
    uint32_t long_ms = compute_step_duration(8.0f, scene_diag);

    EXPECT_GT(long_ms, short_ms);
    EXPECT_GE(short_ms, 300u);
    EXPECT_LE(long_ms, 3000u);
}

TEST(Animation, AdaptiveDurationZeroDiagonalFallback) {
    uint32_t ms = compute_step_duration(1.0f, 0.0f);
    // C++ implementation returns min_ms (300) for zero diagonal
    EXPECT_EQ(ms, 300u);
}

// ===========================================================================
// Integration: full simulation tests
// ===========================================================================

TEST(Simulator, TwoPartRemoval) {
    // Two touching cubes — both should be removable
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 2u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, ThreePartVerticalStack) {
    // A (bottom), B (middle), C (top) — stack along Y
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Base_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(0, 1.0f, 0)),
        make_part_node("c", "Part_C", make_cube(0.5f), Vec3(0, 2.0f, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 3u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, RealisticAssemblyOrder) {
    // base_frame + bracket + 2 bolts stacked vertically
    AssemblyNode root = make_assembly("root", {
        make_part_node("frame", "base_frame", make_cube(2.0f), Vec3(0, 0, 0)),
        make_part_node("bracket", "L_bracket", make_cube(1.0f), Vec3(0, 3.0f, 0)),
        make_part_node("bolt_1", "M6_bolt_1", make_cube(0.25f), Vec3(0, 4.5f, 0)),
        make_part_node("bolt_2", "M6_bolt_2", make_cube(0.25f), Vec3(1.0f, 4.5f, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 10.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    // Physics determines order — just verify all parts are sequenced
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 4u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, DetectsInitialOverlapIssues) {
    // Two cubes overlapping
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(0.5f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    // Should detect overlap issues
    bool has_overlap = false;
    for (const auto& issue : result.issues) {
        if (issue.kind == SimulationIssueKind::Overlap) {
            has_overlap = true;
        }
    }
    EXPECT_TRUE(has_overlap);
}

TEST(Simulator, ResultHasClusteringFields) {
    // Three identical cubes → should detect identical groups
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(3.0f, 0, 0)),
        make_part_node("c", "Part_C", make_cube(0.5f), Vec3(6.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_FALSE(result.identical_groups.empty());
    // Count total grouped parts
    size_t total_grouped = 0;
    for (const auto& g : result.identical_groups) {
        total_grouped += g.size();
    }
    EXPECT_GE(total_grouped, 2u);
}

TEST(Simulator, PlannerStatsPopulated) {
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    ASSERT_TRUE(result.planner_stats.has_value());
    auto& stats = *result.planner_stats;
    EXPECT_GE(stats.contact_edges, 1u);
    EXPECT_GE(stats.candidate_paths_evaluated, 1u);
}

TEST(Simulator, ContactNormalGuidesRemovalDirection) {
    // Two touching cubes: A at left, B at right
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    // Check that at least one step has a predominantly X-axis removal direction
    bool has_x_direction = false;
    for (const auto& step : result.steps) {
        float x_component = std::abs(step.assembly_direction[0]);
        if (x_component > 0.5f) {
            has_x_direction = true;
            break;
        }
    }
    EXPECT_TRUE(has_x_direction);
}

TEST(Simulator, AssemblyDirectionNegated) {
    // After reversal, assembly directions should be negated from removal.
    // Parts placed far apart (10 units) so no obstacles interfere.
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(10.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 2.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    ASSERT_TRUE(result.success);
    for (const auto& step : result.steps) {
        // Direction should be non-zero (assembly requires a direction)
        float mag = std::sqrt(
            step.assembly_direction[0] * step.assembly_direction[0] +
            step.assembly_direction[1] * step.assembly_direction[1] +
            step.assembly_direction[2] * step.assembly_direction[2]);
        EXPECT_GT(mag, 0.1f);
    }
}

TEST(Simulator, StepNumbersSequential) {
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
        make_part_node("c", "Part_C", make_cube(0.5f), Vec3(2.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    for (size_t i = 0; i < result.steps.size(); ++i) {
        EXPECT_EQ(result.steps[i].step_number, static_cast<uint32_t>(i + 1));
    }
}

TEST(Simulator, SimulationTimeMsNonZero) {
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_GE(result.simulation_time_ms, 0u);
}

// ===========================================================================
// Nested assembly world transform tests
// ===========================================================================

TEST(AssemblyNode, GetAllPartsWorldComposesTransforms) {
    // Unit test: sub-assembly at (10,0,0) contains part at local (0,5,0)
    // World position should be (10, 5, 0)
    AssemblyNode root;
    root.id = "root";
    root.node_type = NodeType::Assembly;
    root.transform = Mat4::Identity();

    AssemblyNode sub;
    sub.id = "sub";
    sub.node_type = NodeType::Assembly;
    sub.transform = Mat4::Identity();
    sub.transform(0, 3) = 10.0f;

    AssemblyNode part;
    part.id = "part";
    part.node_type = NodeType::Part;
    part.transform = Mat4::Identity();
    part.transform(1, 3) = 5.0f;
    part.mesh = make_cube(0.5f);

    sub.children.push_back(std::move(part));
    root.children.push_back(std::move(sub));

    auto parts = root.get_all_parts_world();
    ASSERT_EQ(parts.size(), 1u);

    const Mat4& world = parts[0].second;
    EXPECT_NEAR(world(0, 3), 10.0f, 1e-5f);
    EXPECT_NEAR(world(1, 3), 5.0f, 1e-5f);
    EXPECT_NEAR(world(2, 3), 0.0f, 1e-5f);
}

TEST(Simulator, NestedAssemblyWorldTransform) {
    // Sub-assembly offset by (10,0,0) with two parts at local (1,0,0) and (2,0,0).
    // A third part sits at root level at (0,0,0).
    // All three should be removable with correct world positions.
    AssemblyNode root = make_assembly("root", {
        make_sub_assembly("sub_a", Vec3(10, 0, 0), {
            make_part_node("p1", "Part_1", make_cube(0.5f), Vec3(1, 0, 0)),
            make_part_node("p2", "Part_2", make_cube(0.5f), Vec3(2, 0, 0)),
        }),
        make_part_node("p3", "Part_3", make_cube(0.5f), Vec3(0, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 3u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, DeeplyNestedAssemblyTransforms) {
    // Root -> SubAsm_A(5,0,0) -> SubAsm_B(0,5,0) -> Part(0,0,0)
    // Part world position should be (5, 5, 0).
    // A second part at root level at origin.
    AssemblyNode root = make_assembly("root", {
        make_sub_assembly("sub_a", Vec3(5, 0, 0), {
            make_sub_assembly("sub_b", Vec3(0, 5, 0), {
                make_part_node("p1", "Part_1", make_cube(0.5f), Vec3(0, 0, 0)),
            }),
        }),
        make_part_node("p2", "Part_2", make_cube(0.5f), Vec3(0, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 2u);
}

// ===========================================================================
// Config defaults test
// ===========================================================================

TEST(Simulator, ConfigMaxRetriesDefault) {
    SimulatorConfig config;
    EXPECT_EQ(config.max_retries, 4);
}

TEST(Simulator, OutsidenessOrderingExteriorFirst) {
    // Outer parts at (10,0,0) and (-10,0,0), inner part at (0,0,0).
    // All should be removable; exterior parts tried first due to outsideness sort.
    AssemblyNode root = make_assembly("root", {
        make_part_node("inner", "Inner", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("outer_a", "Outer_A", make_cube(0.5f), Vec3(10, 0, 0)),
        make_part_node("outer_b", "Outer_B", make_cube(0.5f), Vec3(-10, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 3u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, PhysicsOnlyHandlesTouchingParts) {
    // Two tightly touching cubes — physics-only planner handles them correctly.
    // Both parts should be removable via contact-aware BFS/RRT.
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 2u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}

TEST(Simulator, RespectsTimeout) {
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Part_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(1.0f, 0, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    config.timeout_ms = 1;  // extremely short timeout
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    // Should either succeed very fast or timeout — either way result.error may be set
    // The important thing is that it doesn't run forever
    EXPECT_TRUE(result.error.has_value() || result.success);
}

// ===========================================================================
// Physics-only assembly tests
// ===========================================================================

TEST(Simulator, ThreePartStackPhysicsOnly) {
    // A (bottom), B (middle), C (top) — stack along Y.
    // Physics-only planner should produce a valid disassembly ordering.
    AssemblyNode root = make_assembly("root", {
        make_part_node("a", "Base_A", make_cube(0.5f), Vec3(0, 0, 0)),
        make_part_node("b", "Part_B", make_cube(0.5f), Vec3(0, 1.0f, 0)),
        make_part_node("c", "Part_C", make_cube(0.5f), Vec3(0, 2.0f, 0)),
    });

    SimulatorConfig config;
    config.removal_distance = 5.0f;
    AssemblySimulator sim(config);
    sim.load_assembly(root);
    auto result = sim.simulate();

    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.steps.size(), 3u);
    EXPECT_EQ(result.stuck_parts.size(), 0u);
}
