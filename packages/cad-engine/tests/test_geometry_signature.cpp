#include <gtest/gtest.h>
#include "identical/geometry_signature.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::test;

// --- Port of geometry.rs tests ---

TEST(GeometrySignature, IdenticalCubesGrouped) {
    // 4 identical unit cubes → should form 1 group of 4
    TriMesh cube = make_cube(0.5f);
    std::vector<std::pair<std::string, const TriMesh*>> parts = {
        {"a", &cube}, {"b", &cube}, {"c", &cube}, {"d", &cube}
    };
    auto groups = find_identical_groups(parts);
    ASSERT_EQ(groups.size(), 1u);
    EXPECT_EQ(groups[0].size(), 4u);
}

TEST(GeometrySignature, DifferentMeshesNotGrouped) {
    // Cube, small cube, cylinder — all different geometry
    TriMesh cube = make_cube(0.5f);
    TriMesh small_cube = make_cube(0.25f);
    TriMesh cylinder = make_cylinder(0.3f, 1.0f);

    std::vector<std::pair<std::string, const TriMesh*>> parts = {
        {"cube", &cube}, {"small", &small_cube}, {"cyl", &cylinder}
    };
    auto groups = find_identical_groups(parts);
    EXPECT_EQ(groups.size(), 0u);
}

TEST(GeometrySignature, MixedIdenticalAndDifferent) {
    // 3 identical cubes + 2 identical cylinders → 2 groups
    TriMesh cube = make_cube(0.5f);
    TriMesh cylinder = make_cylinder(0.3f, 1.0f);

    std::vector<std::pair<std::string, const TriMesh*>> parts = {
        {"washer_1", &cube}, {"washer_2", &cube}, {"washer_3", &cube},
        {"bolt_1", &cylinder}, {"bolt_2", &cylinder}
    };
    auto groups = find_identical_groups(parts);
    EXPECT_EQ(groups.size(), 2u);
}

TEST(GeometrySignature, SinglePartNoGroup) {
    TriMesh cube = make_cube(0.5f);
    std::vector<std::pair<std::string, const TriMesh*>> parts = {
        {"lonely", &cube}
    };
    auto groups = find_identical_groups(parts);
    EXPECT_EQ(groups.size(), 0u);
}

TEST(GeometrySignature, SignatureDeterministic) {
    TriMesh cube1 = make_cube(0.5f);
    TriMesh cube2 = make_cube(0.5f);
    auto sig1 = compute_signature(cube1);
    auto sig2 = compute_signature(cube2);
    EXPECT_EQ(sig1, sig2);
}

TEST(GeometrySignature, SignatureDifferentForDifferentSizes) {
    TriMesh cube = make_cube(0.5f);
    TriMesh small = make_cube(0.25f);
    auto sig_cube = compute_signature(cube);
    auto sig_small = compute_signature(small);
    EXPECT_NE(sig_cube.volume_quantized, sig_small.volume_quantized);
}

TEST(GeometrySignature, EmptyMeshSignature) {
    TriMesh empty;
    auto sig = compute_signature(empty);
    EXPECT_EQ(sig.vertex_count, 0u);
    EXPECT_EQ(sig.triangle_count, 0u);
}
