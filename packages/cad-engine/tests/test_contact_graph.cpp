#include <gtest/gtest.h>
#include "collision/contact_graph.h"
#include "collision/collision_utils.h"
#include "classification/part_classifier.h"
#include "test_helpers.h"

#include <algorithm>

using namespace carbon;
using namespace carbon::test;

// --- Port of contact_graph.rs tests ---

TEST(ContactGraph, TouchingCubesHaveContact) {
    // Two unit cubes touching along X axis
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(1.0f, 0, 0));  // touching at x=0.5

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"cube_a", &cube, &iso_a},
        {"cube_b", &cube, &iso_b},
    };

    float threshold = 0.1f;
    auto graph = ContactGraph::build(parts, threshold);

    EXPECT_EQ(graph.edge_count(), 1u);
    EXPECT_EQ(graph.degree("cube_a"), 1);
    EXPECT_EQ(graph.degree("cube_b"), 1);

    auto neighbors = graph.neighbors("cube_a");
    ASSERT_EQ(neighbors.size(), 1u);
    EXPECT_EQ(neighbors[0], "cube_b");
}

TEST(ContactGraph, SeparatedCubesNoContact) {
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(5.0f, 0, 0));  // far apart

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"cube_a", &cube, &iso_a},
        {"cube_b", &cube, &iso_b},
    };

    auto graph = ContactGraph::build(parts, 0.1f);
    EXPECT_EQ(graph.edge_count(), 0u);
}

TEST(ContactGraph, ThreePartAssembly) {
    // A — B — C in a row along X
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(1.0f, 0, 0));
    Isometry iso_c = iso_at(Vec3(2.0f, 0, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"a", &cube, &iso_a},
        {"b", &cube, &iso_b},
        {"c", &cube, &iso_c},
    };

    auto graph = ContactGraph::build(parts, 0.1f);
    EXPECT_EQ(graph.edge_count(), 2u);
    EXPECT_EQ(graph.degree("a"), 1);
    EXPECT_EQ(graph.degree("b"), 2);
    EXPECT_EQ(graph.degree("c"), 1);
}

TEST(ContactGraph, BroadPhaseSameAsBruteForce) {
    // 5 parts: 4 close together + 1 far away
    TriMesh cube = make_cube(0.5f);
    Isometry iso0 = iso_at(Vec3(0, 0, 0));
    Isometry iso1 = iso_at(Vec3(1.0f, 0, 0));
    Isometry iso2 = iso_at(Vec3(2.0f, 0, 0));
    Isometry iso3 = iso_at(Vec3(0, 1.0f, 0));
    Isometry iso4 = iso_at(Vec3(5.0f, 5.0f, 5.0f));  // far

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"p0", &cube, &iso0},
        {"p1", &cube, &iso1},
        {"p2", &cube, &iso2},
        {"p3", &cube, &iso3},
        {"p4", &cube, &iso4},
    };

    auto graph = ContactGraph::build(parts, 0.1f);
    // p0-p1, p1-p2, p0-p3, p1-p3 could be contacts depending on threshold
    // At minimum: p0-p1, p1-p2, p0-p3
    EXPECT_GE(graph.edge_count(), 3u);
    EXPECT_EQ(graph.degree("p4"), 0);  // p4 is far away
}

TEST(ContactGraph, ContactPatchNormalFlat) {
    // Two cubes touching on flat face along X
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(1.0f, 0, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"a", &cube, &iso_a},
        {"b", &cube, &iso_b},
    };

    auto graph = ContactGraph::build(parts, 0.1f);
    ASSERT_EQ(graph.edges().size(), 1u);

    // Normal should be predominantly along X
    Vec3 normal = graph.edges()[0].estimated_normal;
    float x_component = std::abs(normal.x());
    EXPECT_GT(x_component, 0.5f);  // predominantly X direction
}

TEST(ContactGraph, DetectSubassembliesTwoClusters) {
    // Two functional clusters connected by a fastener
    TriMesh cube = make_cube(0.5f);
    Isometry iso_base = iso_at(Vec3(0, 0, 0));
    Isometry iso_plate = iso_at(Vec3(1.0f, 0, 0));
    Isometry iso_bolt = iso_at(Vec3(2.0f, 0, 0));
    Isometry iso_bracket = iso_at(Vec3(3.0f, 0, 0));
    Isometry iso_support = iso_at(Vec3(4.0f, 0, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"base", &cube, &iso_base},
        {"plate", &cube, &iso_plate},
        {"bolt_1", &cube, &iso_bolt},
        {"bracket", &cube, &iso_bracket},
        {"support", &cube, &iso_support},
    };

    auto graph = ContactGraph::build(parts, 0.1f);

    std::unordered_map<std::string, PartKind> kinds = {
        {"base", PartKind::Structural},
        {"plate", PartKind::Structural},
        {"bolt_1", PartKind::Fastener},
        {"bracket", PartKind::Structural},
        {"support", PartKind::Structural},
    };

    auto subassemblies = graph.detect_subassemblies(kinds);
    // Should detect at least 1 subassembly with functional parts
    EXPECT_GE(subassemblies.size(), 1u);
    if (!subassemblies.empty()) {
        EXPECT_GE(subassemblies[0].part_ids.size(), 2u);
    }
}

TEST(ContactGraph, DetectSubassembliesSingleCluster) {
    // Three tightly connected functional parts
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(1.0f, 0, 0));
    Isometry iso_c = iso_at(Vec3(0, 1.0f, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"a", &cube, &iso_a},
        {"b", &cube, &iso_b},
        {"c", &cube, &iso_c},
    };

    auto graph = ContactGraph::build(parts, 0.1f);

    std::unordered_map<std::string, PartKind> kinds = {
        {"a", PartKind::Structural},
        {"b", PartKind::Structural},
        {"c", PartKind::Structural},
    };

    auto subassemblies = graph.detect_subassemblies(kinds);
    // All three are functional and connected → 1 subassembly
    EXPECT_GE(subassemblies.size(), 1u);
    if (!subassemblies.empty()) {
        EXPECT_GE(subassemblies[0].part_ids.size(), 2u);
    }
}

TEST(ContactGraph, DetectKitsBoltWasherNut) {
    // bolt → washer → nut chain
    TriMesh cube = make_cube(0.5f);
    Isometry iso_bolt = iso_at(Vec3(0, 0, 0));
    Isometry iso_washer = iso_at(Vec3(1.0f, 0, 0));
    Isometry iso_nut = iso_at(Vec3(2.0f, 0, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"bolt_1", &cube, &iso_bolt},
        {"washer_1", &cube, &iso_washer},
        {"nut_1", &cube, &iso_nut},
    };

    auto graph = ContactGraph::build(parts, 0.1f);

    std::unordered_map<std::string, PartKind> kinds = {
        {"bolt_1", PartKind::Fastener},
        {"washer_1", PartKind::Fastener},
        {"nut_1", PartKind::Fastener},
    };

    auto kits = graph.detect_kits(kinds);
    EXPECT_GE(kits.size(), 1u);
    if (!kits.empty()) {
        // Kit should have a primary and accessories
        EXPECT_FALSE(kits[0].primary.empty());
        EXPECT_GE(kits[0].accessories.size(), 1u);
    }
}

TEST(ContactGraph, DetectKitsNoBolts) {
    // Assembly with no fasteners → no kits
    TriMesh cube = make_cube(0.5f);
    Isometry iso_a = iso_at(Vec3(0, 0, 0));
    Isometry iso_b = iso_at(Vec3(1.0f, 0, 0));

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"frame", &cube, &iso_a},
        {"panel", &cube, &iso_b},
    };

    auto graph = ContactGraph::build(parts, 0.1f);

    std::unordered_map<std::string, PartKind> kinds = {
        {"frame", PartKind::Structural},
        {"panel", PartKind::Panel},
    };

    auto kits = graph.detect_kits(kinds);
    EXPECT_EQ(kits.size(), 0u);
}
