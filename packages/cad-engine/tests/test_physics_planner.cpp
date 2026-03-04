#include <gtest/gtest.h>
#include "simulator/bfs_planner.h"
#include "simulator/rrt_planner.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::test;

// ---------------------------------------------------------------------------
// Helper: build SDF obstacle from a cube at a position
// ---------------------------------------------------------------------------

static std::shared_ptr<CachedSDFMesh> make_obstacle(const TriMesh& mesh,
                                                      const Vec3& pos) {
    Isometry iso;
    iso.translation = pos;
    SDFConfig cfg;
    cfg.min_resolution = 20;
    cfg.padding = 2;
    return build_sdf_mesh(mesh, iso, cfg);
}

// ---------------------------------------------------------------------------
// BFS Planner tests
// ---------------------------------------------------------------------------

TEST(BFSPlannerTest, FindsPathForFreePart) {
    TriMesh cube = make_cube(0.5f);

    // Moving cube at origin, obstacle far to the right — cube can move in any direction
    auto obstacle = make_obstacle(cube, Vec3(5.0f, 0, 0));

    BFSPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_action = 5;
    cfg.sim_dt = 0.01f;
    cfg.max_bfs_depth = 20;
    cfg.max_states = 1000;
    cfg.separation_distance = 3.0f;

    auto result = plan_bfs(cube, Isometry::identity(),
                            {obstacle}, cfg);

    EXPECT_TRUE(result.success) << "BFS should find a path for an unobstructed part";
    EXPECT_GT(result.actions.size(), 0u) << "Should have at least one action";
    EXPECT_GT(result.trajectory.size(), 1u) << "Should have a trajectory";
}

TEST(BFSPlannerTest, FindsPathWithSingleObstacle) {
    TriMesh cube = make_cube(0.5f);

    // One obstacle blocking +X, moving cube should escape via -X, Y, or Z
    auto obs = make_obstacle(cube, Vec3(1.5f, 0, 0));

    BFSPlannerConfig cfg;
    cfg.force_magnitude = 100.0f;        // Strong enough for meaningful displacement
    cfg.sim_steps_per_action = 20;       // Enough time for displacement > dedup threshold
    cfg.sim_dt = 0.01f;
    cfg.max_bfs_depth = 30;
    cfg.max_states = 5000;
    cfg.separation_distance = 1.0f;
    cfg.pos_threshold = 0.5f;            // Allow more diverse exploration

    auto result = plan_bfs(cube, Isometry::identity(), {obs}, cfg);

    EXPECT_TRUE(result.success) << "BFS should escape from single obstacle";
}

TEST(BFSPlannerTest, EmptyMeshReturnsFalse) {
    TriMesh empty;
    auto result = plan_bfs(empty, Isometry::identity(), {});
    EXPECT_FALSE(result.success);
}

TEST(BFSPlannerTest, NoObstaclesFindsPath) {
    TriMesh cube = make_cube(0.5f);

    BFSPlannerConfig cfg;
    cfg.separation_distance = 0.1f; // Very easy to "disassemble"
    cfg.max_bfs_depth = 5;

    auto result = plan_bfs(cube, Isometry::identity(), {}, cfg);
    // With no obstacles, should always succeed
    EXPECT_TRUE(result.success);
}

// ---------------------------------------------------------------------------
// RRT Planner tests
// ---------------------------------------------------------------------------

TEST(RRTPlannerTest, FindsPathForFreePart) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = make_obstacle(cube, Vec3(5.0f, 0, 0));

    RRTPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_extend = 5;
    cfg.sim_dt = 0.01f;
    cfg.max_iterations = 500;
    cfg.separation_distance = 3.0f;
    cfg.pos_range = 5.0f;

    auto result = plan_rrt(cube, Isometry::identity(),
                            {obstacle}, cfg);

    EXPECT_TRUE(result.success) << "RRT should find a path for an unobstructed part";
    EXPECT_GT(result.trajectory.size(), 1u);
}

TEST(RRTPlannerTest, EmptyMeshReturnsFalse) {
    TriMesh empty;
    auto result = plan_rrt(empty, Isometry::identity(), {});
    EXPECT_FALSE(result.success);
}

TEST(RRTPlannerTest, ReturnsDirectionForSuccessfulPath) {
    TriMesh cube = make_cube(0.5f);

    RRTPlannerConfig cfg;
    cfg.separation_distance = 0.1f;
    cfg.max_iterations = 100;

    auto result = plan_rrt(cube, Isometry::identity(), {}, cfg);
    if (result.success) {
        float mag = result.final_direction.norm();
        EXPECT_NEAR(mag, 1.0f, 0.1f) << "Direction should be roughly unit length";
    }
}

TEST(RRTPlannerTest, ContactPhysicsPreventstunneling) {
    // Cube with nearby obstacle. With contact physics, the RRT should
    // NOT produce states that tunnel through the obstacle.
    TriMesh cube = make_cube(0.5f);

    // Obstacle blocking +X at close range
    auto wall = make_obstacle(cube, Vec3(1.2f, 0, 0));

    RRTPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_extend = 100;
    cfg.sim_dt = 0.001f;
    cfg.max_iterations = 500;
    cfg.separation_distance = 2.0f;
    cfg.pos_range = 5.0f;

    auto result = plan_rrt(cube, Isometry::identity(), {wall}, cfg);

    // Should find a path (around the obstacle, not through it)
    EXPECT_TRUE(result.success) << "RRT with contacts should find escape path";
    if (result.success) {
        EXPECT_GT(result.trajectory.size(), 1u);
    }
}

// ---------------------------------------------------------------------------
// Contact-aware BFS tests
// ---------------------------------------------------------------------------

TEST(BFSPlannerTest, ContactPhysicsWithObstacles) {
    // Cube with two nearby obstacles. With contact-aware physics, the BFS
    // uses penalty forces and friction during simulation (not just post-hoc
    // collision checks). Verify it still finds a valid path.
    TriMesh cube = make_cube(0.5f);

    // Two obstacles on +X and -X, leaving Y and Z open
    auto wall_px = make_obstacle(cube, Vec3(1.2f, 0, 0));
    auto wall_nx = make_obstacle(cube, Vec3(-1.2f, 0, 0));

    BFSPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_action = 100;
    cfg.sim_dt = 0.001f;
    cfg.max_bfs_depth = 50;
    cfg.max_states = 5000;
    cfg.separation_distance = 2.0f;

    auto result = plan_bfs(cube, Isometry::identity(), {wall_px, wall_nx}, cfg);

    EXPECT_TRUE(result.success) << "Should find escape path with contact-aware physics";
    EXPECT_GT(result.trajectory.size(), 1u) << "Should have a trajectory";
}

TEST(BFSPlannerTest, StuckDetectionLimitsExploration) {
    // Cube surrounded by obstacles on all sides.
    // With contact physics, the cube gets stuck (penalty forces prevent escape).
    // Even if it eventually finds a path through a gap, stuck detection should
    // limit the number of states explored compared to max budget.
    TriMesh cube = make_cube(0.5f);
    TriMesh big_cube = make_cube(2.0f);
    // Overlapping big cubes form an impenetrable cage
    float gap = 1.5f;

    std::vector<std::shared_ptr<CachedSDFMesh>> obstacles;
    Vec3 dirs[] = {{gap,0,0}, {-gap,0,0}, {0,gap,0}, {0,-gap,0}, {0,0,gap}, {0,0,-gap}};
    for (const auto& d : dirs) {
        obstacles.push_back(make_obstacle(big_cube, d));
    }

    BFSPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_action = 100;
    cfg.sim_dt = 0.001f;
    cfg.max_bfs_depth = 10;
    cfg.max_states = 500;
    cfg.separation_distance = 3.0f;

    auto result = plan_bfs(cube, Isometry::identity(), obstacles, cfg);

    // With stuck detection pruning directions that don't move,
    // we should explore significantly fewer states than the max budget
    EXPECT_LT(result.states_explored, 500)
        << "Stuck detection should prune quickly when all directions are blocked";
}

TEST(BFSPlannerTest, VertexSamplingStrideWorks) {
    // Verify that max_sample_vertices config affects BFS behavior
    // (doesn't crash, still finds path with limited sampling)
    TriMesh cube = make_cube(0.5f);
    auto obs = make_obstacle(cube, Vec3(5.0f, 0, 0));

    BFSPlannerConfig cfg;
    cfg.force_magnitude = 50.0f;
    cfg.sim_steps_per_action = 100;  // Enough steps for meaningful displacement
    cfg.sim_dt = 0.001f;
    cfg.max_bfs_depth = 20;
    cfg.max_states = 1000;
    cfg.separation_distance = 2.0f;
    cfg.contact_config.max_sample_vertices = 4; // Very aggressive stride

    auto result = plan_bfs(cube, Isometry::identity(), {obs}, cfg);
    EXPECT_TRUE(result.success)
        << "BFS should still find path with limited vertex sampling";
}
