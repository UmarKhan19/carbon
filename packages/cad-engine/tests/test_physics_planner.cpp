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
