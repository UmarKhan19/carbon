#include <gtest/gtest.h>
#include "collision/sdf.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::test;

// ---------------------------------------------------------------------------
// SDFGrid generation tests
// ---------------------------------------------------------------------------

TEST(SDFTest, EmptyMeshReturnsEmptyGrid) {
    TriMesh empty;
    SDFGrid grid = generate_sdf(empty);
    EXPECT_TRUE(grid.empty());
}

TEST(SDFTest, CubeSDFGenerates) {
    TriMesh cube = make_cube(0.5f);
    SDFGrid grid = generate_sdf(cube);

    EXPECT_FALSE(grid.empty());
    EXPECT_GE(grid.ni, 20);
    EXPECT_GE(grid.nj, 20);
    EXPECT_GE(grid.nk, 20);
    EXPECT_GT(grid.dx, 0.0f);
}

TEST(SDFTest, CubeSDFCenterIsNegative) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 30;
    SDFGrid grid = generate_sdf(cube, cfg);

    // Center of unit cube at origin should be inside (negative SDF)
    float val = grid.query(Vec3(0, 0, 0));
    EXPECT_LT(val, 0.0f) << "Center of cube should have negative SDF, got " << val;
}

TEST(SDFTest, CubeSDFOutsideIsPositive) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 30;
    SDFGrid grid = generate_sdf(cube, cfg);

    // Points well outside the cube should be positive
    EXPECT_GT(grid.query(Vec3(2.0f, 0, 0)), 0.0f) << "Point far outside +X should be positive";
    EXPECT_GT(grid.query(Vec3(-2.0f, 0, 0)), 0.0f) << "Point far outside -X should be positive";
    EXPECT_GT(grid.query(Vec3(0, 2.0f, 0)), 0.0f) << "Point far outside +Y should be positive";
    EXPECT_GT(grid.query(Vec3(0, 0, 2.0f)), 0.0f) << "Point far outside +Z should be positive";
}

TEST(SDFTest, CubeSDFSurfaceNearZero) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 40;
    SDFGrid grid = generate_sdf(cube, cfg);

    // Points on cube faces should have SDF near zero
    // Tolerance depends on grid resolution
    float tol = grid.dx * 1.5f;

    EXPECT_NEAR(grid.query(Vec3(0.5f, 0, 0)), 0.0f, tol) << "+X face";
    EXPECT_NEAR(grid.query(Vec3(-0.5f, 0, 0)), 0.0f, tol) << "-X face";
    EXPECT_NEAR(grid.query(Vec3(0, 0.5f, 0)), 0.0f, tol) << "+Y face";
    EXPECT_NEAR(grid.query(Vec3(0, -0.5f, 0)), 0.0f, tol) << "-Y face";
    EXPECT_NEAR(grid.query(Vec3(0, 0, 0.5f)), 0.0f, tol) << "+Z face";
    EXPECT_NEAR(grid.query(Vec3(0, 0, -0.5f)), 0.0f, tol) << "-Z face";
}

TEST(SDFTest, CubeSDFDistanceAccuracy) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 40;
    cfg.padding = 10; // Extra padding so we can test outside points within the grid
    SDFGrid grid = generate_sdf(cube, cfg);

    // Point ~0.2 outside the +X face (within grid due to padding)
    float val = grid.query(Vec3(0.7f, 0, 0));
    EXPECT_NEAR(val, 0.2f, grid.dx * 2.0f) << "Distance from +X face should be ~0.2";

    // Inside point: distance from center to nearest face should be ~0.5
    float inside_val = grid.query(Vec3(0, 0, 0));
    EXPECT_NEAR(inside_val, -0.5f, grid.dx * 3.0f)
        << "Signed distance at center should be ~-0.5";
}

TEST(SDFTest, CubeIsInsideCheck) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 30;
    SDFGrid grid = generate_sdf(cube, cfg);

    EXPECT_TRUE(grid.is_inside(Vec3(0, 0, 0))) << "Center should be inside";
    EXPECT_TRUE(grid.is_inside(Vec3(0.2f, 0.2f, 0.2f))) << "Interior point should be inside";
    EXPECT_FALSE(grid.is_inside(Vec3(2.0f, 0, 0))) << "Exterior point should not be inside";
}

// ---------------------------------------------------------------------------
// Gradient tests
// ---------------------------------------------------------------------------

TEST(SDFTest, GradientPointsOutward) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 40;
    SDFGrid grid = generate_sdf(cube, cfg);

    // Gradient on +X face should point roughly in +X direction
    Vec3 grad = grid.gradient(Vec3(0.5f, 0, 0));
    EXPECT_GT(grad.x(), 0.0f) << "Gradient on +X face should have positive X component";
    EXPECT_GT(std::abs(grad.x()), std::abs(grad.y()))
        << "X component should dominate on +X face";
    EXPECT_GT(std::abs(grad.x()), std::abs(grad.z()))
        << "X component should dominate on +X face";
}

TEST(SDFTest, GradientNearUnitMagnitudeOnSurface) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.min_resolution = 40;
    SDFGrid grid = generate_sdf(cube, cfg);

    // SDF gradient magnitude should be approximately 1 near the surface
    Vec3 grad = grid.gradient(Vec3(0.5f, 0, 0));
    float mag = grad.norm();
    EXPECT_NEAR(mag, 1.0f, 0.3f)
        << "Gradient magnitude near surface should be ~1, got " << mag;
}

// ---------------------------------------------------------------------------
// Transform tests
// ---------------------------------------------------------------------------

TEST(SDFTest, TransformedSDFShiftsCorrectly) {
    TriMesh cube = make_cube(0.5f);
    Isometry shift;
    shift.translation = Vec3(5.0f, 0, 0);

    SDFConfig cfg;
    cfg.min_resolution = 30;
    SDFGrid grid = generate_sdf(cube, shift, cfg);

    // Center of shifted cube (at 5,0,0) should be inside
    EXPECT_LT(grid.query(Vec3(5.0f, 0, 0)), 0.0f) << "Shifted center should be inside";
    // Original origin should be outside
    EXPECT_GT(grid.query(Vec3(0, 0, 0)), 0.0f) << "Original origin should be outside";
}

// ---------------------------------------------------------------------------
// Configuration tests
// ---------------------------------------------------------------------------

TEST(SDFTest, CustomResolutionAffectsGridSize) {
    TriMesh cube = make_cube(0.5f);

    SDFConfig low_res;
    low_res.min_resolution = 20;
    SDFGrid grid_low = generate_sdf(cube, low_res);

    SDFConfig high_res;
    high_res.min_resolution = 50;
    SDFGrid grid_high = generate_sdf(cube, high_res);

    EXPECT_GT(grid_high.total_cells(), grid_low.total_cells())
        << "Higher resolution should produce more cells";
}

TEST(SDFTest, ExplicitDxOverridesMinResolution) {
    TriMesh cube = make_cube(0.5f);
    SDFConfig cfg;
    cfg.dx = 0.1f;
    cfg.min_resolution = 100; // Would produce much finer grid if used
    SDFGrid grid = generate_sdf(cube, cfg);

    // dx=0.1 for a 1x1x1 cube should give ~12 cells per axis (10 + 2 padding)
    EXPECT_NEAR(grid.dx, 0.1f, 1e-6f);
}

TEST(SDFTest, GridAABBCoversEntireMesh) {
    TriMesh cube = make_cube(0.5f);
    SDFGrid grid = generate_sdf(cube);

    AABB grid_bb = grid.grid_aabb();
    AABB mesh_bb = cube.local_aabb();

    // Grid AABB should fully contain the mesh AABB (plus padding)
    EXPECT_LE(grid_bb.min.x(), mesh_bb.min.x());
    EXPECT_LE(grid_bb.min.y(), mesh_bb.min.y());
    EXPECT_LE(grid_bb.min.z(), mesh_bb.min.z());
    EXPECT_GE(grid_bb.max.x(), mesh_bb.max.x());
    EXPECT_GE(grid_bb.max.y(), mesh_bb.max.y());
    EXPECT_GE(grid_bb.max.z(), mesh_bb.max.z());
}

// ---------------------------------------------------------------------------
// Cylinder test (non-axis-aligned surfaces)
// ---------------------------------------------------------------------------

TEST(SDFTest, CylinderSDFCenterIsNegative) {
    TriMesh cyl = make_cylinder(0.5f, 2.0f, 32);
    SDFConfig cfg;
    cfg.min_resolution = 30;
    SDFGrid grid = generate_sdf(cyl, cfg);

    EXPECT_LT(grid.query(Vec3(0, 0, 0)), 0.0f) << "Cylinder center should be inside";
    EXPECT_GT(grid.query(Vec3(2.0f, 0, 0)), 0.0f) << "Point outside cylinder should be outside";
}
