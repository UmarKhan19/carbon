#include <gtest/gtest.h>
#include "collision/sdf_collision.h"
#include "collision/collision_utils.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::test;

// ---------------------------------------------------------------------------
// build_sdf_mesh tests
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, BuildSDFMeshFromCube) {
    TriMesh cube = make_cube(0.5f);
    auto sdf = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(sdf, nullptr);
    EXPECT_FALSE(sdf->sdf.empty());
}

TEST(SDFCollisionTest, BuildSDFMeshFromEmptyReturnsNull) {
    TriMesh empty;
    auto sdf = build_sdf_mesh(empty, Isometry::identity());
    EXPECT_EQ(sdf, nullptr);
}

// ---------------------------------------------------------------------------
// sdf_mesh_intersects tests
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, OverlappingCubesIntersect) {
    TriMesh cube = make_cube(0.5f);

    // Obstacle at origin
    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Query cube overlapping at (0.5, 0, 0) — 50% overlap along X
    EXPECT_TRUE(sdf_mesh_intersects(cube, iso_at(Vec3(0.5f, 0, 0)), *obstacle));
}

TEST(SDFCollisionTest, SeparatedCubesDoNotIntersect) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Query cube far away
    EXPECT_FALSE(sdf_mesh_intersects(cube, iso_at(Vec3(5.0f, 0, 0)), *obstacle));
}

TEST(SDFCollisionTest, SlightlySeparatedCubesDoNotIntersect) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Query cube with small gap (slightly more than SDF resolution)
    // Note: exactly touching cubes may report intersection due to SDF discretization
    float gap = obstacle->sdf.dx * 2.0f;
    EXPECT_FALSE(sdf_mesh_intersects(cube, iso_at(Vec3(1.0f + gap, 0, 0)), *obstacle));
}

TEST(SDFCollisionTest, EmptyMeshDoesNotIntersect) {
    TriMesh cube = make_cube(0.5f);
    TriMesh empty;

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    EXPECT_FALSE(sdf_mesh_intersects(empty, Isometry::identity(), *obstacle));
}

// ---------------------------------------------------------------------------
// sdf_contact_points tests
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, ContactPointsForOverlap) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Overlapping cube
    auto contacts = sdf_contact_points(cube, iso_at(Vec3(0.5f, 0, 0)), *obstacle);
    EXPECT_GT(contacts.size(), 0u) << "Should find contact points for overlapping cubes";

    // All contacts should have positive depth
    for (const auto& c : contacts) {
        EXPECT_GT(c.depth, 0.0f) << "Contact depth should be positive";
    }
}

TEST(SDFCollisionTest, ContactNormalsAreNormalized) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    auto contacts = sdf_contact_points(cube, iso_at(Vec3(0.5f, 0, 0)), *obstacle);
    for (const auto& c : contacts) {
        EXPECT_NEAR(c.normal.norm(), 1.0f, 0.01f)
            << "Contact normals should be unit vectors";
    }
}

TEST(SDFCollisionTest, NoContactsForSeparatedMeshes) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    auto contacts = sdf_contact_points(cube, iso_at(Vec3(5.0f, 0, 0)), *obstacle);
    EXPECT_EQ(contacts.size(), 0u);
}

// ---------------------------------------------------------------------------
// sdf_cast_shapes_discrete tests
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, CastDetectsCollision) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Moving cube from far away toward obstacle
    Isometry start = iso_at(Vec3(3.0f, 0, 0));
    Vec3 velocity(-4.0f, 0, 0); // Moving toward origin

    auto toi = sdf_cast_shapes_discrete(cube, start, velocity, *obstacle);
    EXPECT_TRUE(toi.has_value()) << "Should detect collision";
    EXPECT_GT(*toi, 0.0f) << "Time of impact should be positive";
    EXPECT_LT(*toi, 1.0f) << "Time of impact should be before end";
}

TEST(SDFCollisionTest, CastNoCollisionForParallelPath) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Moving cube parallel to obstacle (no collision)
    Isometry start = iso_at(Vec3(3.0f, 0, 0));
    Vec3 velocity(0, 5.0f, 0);

    auto toi = sdf_cast_shapes_discrete(cube, start, velocity, *obstacle);
    EXPECT_FALSE(toi.has_value()) << "Should not detect collision for parallel path";
}

// ---------------------------------------------------------------------------
// sdf_penetration_depth tests
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, PenetrationDepthForOverlap) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    float depth = sdf_penetration_depth(cube, iso_at(Vec3(0.5f, 0, 0)), *obstacle);
    EXPECT_GT(depth, 0.0f) << "Should have positive penetration depth";
    EXPECT_LT(depth, 1.0f) << "Penetration should be less than cube size";
}

TEST(SDFCollisionTest, ZeroPenetrationForSeparated) {
    TriMesh cube = make_cube(0.5f);

    auto obstacle = build_sdf_mesh(cube, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    float depth = sdf_penetration_depth(cube, iso_at(Vec3(5.0f, 0, 0)), *obstacle);
    EXPECT_FLOAT_EQ(depth, 0.0f);
}

// ---------------------------------------------------------------------------
// Comparison with CGAL collision
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, AgreesWithCGALForOverlap) {
    TriMesh cube = make_cube(0.5f);
    Isometry at_origin = Isometry::identity();
    Isometry shifted = iso_at(Vec3(0.5f, 0, 0));

    // CGAL says they intersect
    bool cgal_result = mesh_intersects(cube, at_origin, cube, shifted);
    EXPECT_TRUE(cgal_result);

    // SDF should agree
    auto sdf = build_sdf_mesh(cube, at_origin);
    bool sdf_result = sdf_mesh_intersects(cube, shifted, *sdf);
    EXPECT_EQ(sdf_result, cgal_result)
        << "SDF collision should agree with CGAL for overlapping cubes";
}

TEST(SDFCollisionTest, AgreesWithCGALForSeparated) {
    TriMesh cube = make_cube(0.5f);
    Isometry at_origin = Isometry::identity();
    Isometry far_away = iso_at(Vec3(5.0f, 0, 0));

    bool cgal_result = mesh_intersects(cube, at_origin, cube, far_away);
    EXPECT_FALSE(cgal_result);

    auto sdf = build_sdf_mesh(cube, at_origin);
    bool sdf_result = sdf_mesh_intersects(cube, far_away, *sdf);
    EXPECT_EQ(sdf_result, cgal_result)
        << "SDF collision should agree with CGAL for separated cubes";
}

// ---------------------------------------------------------------------------
// Cylinder collision
// ---------------------------------------------------------------------------

TEST(SDFCollisionTest, CylinderOverlapDetected) {
    TriMesh cyl = make_cylinder(0.5f, 2.0f, 32);

    auto obstacle = build_sdf_mesh(cyl, Isometry::identity());
    ASSERT_NE(obstacle, nullptr);

    // Overlapping cylinder
    EXPECT_TRUE(sdf_mesh_intersects(cyl, iso_at(Vec3(0.3f, 0, 0)), *obstacle));
    // Separated cylinder
    EXPECT_FALSE(sdf_mesh_intersects(cyl, iso_at(Vec3(5.0f, 0, 0)), *obstacle));
}
