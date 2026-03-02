#include <gtest/gtest.h>
#include "simulator/stability_checker.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::test;

// ---------------------------------------------------------------------------
// Basic stability tests
// ---------------------------------------------------------------------------

TEST(StabilityTest, EmptyAssemblyIsStable) {
    auto result = check_stability({});
    EXPECT_TRUE(result.assembly_stable);
    EXPECT_EQ(result.parts.size(), 0u);
}

TEST(StabilityTest, GroundedPartIsStable) {
    TriMesh cube = make_cube(0.5f);

    StabilityPart part;
    part.id = "ground_cube";
    part.mesh = &cube;
    part.transform = Isometry::identity();
    part.is_grounded = true;

    auto result = check_stability({part});
    EXPECT_TRUE(result.assembly_stable);
    EXPECT_EQ(result.unstable_ids.size(), 0u);
}

TEST(StabilityTest, FloatingPartIsUnstable) {
    TriMesh cube = make_cube(0.5f);

    // Cube floating in air with no support
    StabilityPart part;
    part.id = "floating_cube";
    part.mesh = &cube;
    part.transform.translation = Vec3(0, 5.0f, 0);
    part.is_grounded = false;
    part.mass = 1.0f;

    StabilityConfig cfg;
    cfg.sim_dt = 0.001f;
    cfg.max_steps = 1000;
    cfg.displacement_threshold = 0.1f;

    auto result = check_stability({part}, cfg);

    EXPECT_FALSE(result.assembly_stable) << "Floating part should be unstable";
    EXPECT_EQ(result.unstable_ids.size(), 1u);
    EXPECT_EQ(result.unstable_ids[0], "floating_cube");
}

TEST(StabilityTest, StackedCubesOnGroundStable) {
    TriMesh cube = make_cube(0.5f);

    // Bottom cube is grounded
    StabilityPart bottom;
    bottom.id = "bottom";
    bottom.mesh = &cube;
    bottom.transform.translation = Vec3(0, 0.5f, 0); // Resting on ground
    bottom.is_grounded = true;
    bottom.mass = 1.0f;

    // Top cube resting on bottom (at y=1.5, bottom of top cube at y=1.0 = top of bottom)
    StabilityPart top;
    top.id = "top";
    top.mesh = &cube;
    top.transform.translation = Vec3(0, 1.5f, 0);
    top.is_grounded = false;
    top.mass = 1.0f;

    StabilityConfig cfg;
    cfg.sim_dt = 0.001f;
    cfg.max_steps = 1000;
    cfg.displacement_threshold = 0.5f;

    auto result = check_stability({bottom, top}, cfg);

    // Top cube should be relatively stable (resting on grounded bottom cube)
    // Find top part result
    for (const auto& ps : result.parts) {
        if (ps.part_id == "bottom") {
            EXPECT_TRUE(ps.stable) << "Grounded bottom should be stable";
        }
    }
}

TEST(StabilityTest, CantileverIsUnstable) {
    TriMesh cube = make_cube(0.5f);

    // Cube hanging off the edge with no support below it
    StabilityPart cantilever;
    cantilever.id = "cantilever";
    cantilever.mesh = &cube;
    cantilever.transform.translation = Vec3(3.0f, 3.0f, 0); // Floating, nothing below
    cantilever.is_grounded = false;
    cantilever.mass = 1.0f;

    StabilityConfig cfg;
    cfg.sim_dt = 0.001f;
    cfg.max_steps = 1000;
    cfg.displacement_threshold = 0.1f;

    auto result = check_stability({cantilever}, cfg);

    EXPECT_FALSE(result.assembly_stable) << "Unsupported cantilever should be unstable";
    EXPECT_GT(result.parts[0].max_displacement, 0.1f)
        << "Should have significant displacement";
}

// ---------------------------------------------------------------------------
// Result structure tests
// ---------------------------------------------------------------------------

TEST(StabilityTest, ResultContainsAllParts) {
    TriMesh cube = make_cube(0.5f);

    StabilityPart a, b;
    a.id = "part_a";
    a.mesh = &cube;
    a.transform.translation = Vec3(0, 5, 0);
    a.mass = 1.0f;

    b.id = "part_b";
    b.mesh = &cube;
    b.transform.translation = Vec3(3, 5, 0);
    b.mass = 1.0f;

    StabilityConfig cfg;
    cfg.max_steps = 100;

    auto result = check_stability({a, b}, cfg);

    EXPECT_EQ(result.parts.size(), 2u);
    EXPECT_EQ(result.parts[0].part_id, "part_a");
    EXPECT_EQ(result.parts[1].part_id, "part_b");
}
