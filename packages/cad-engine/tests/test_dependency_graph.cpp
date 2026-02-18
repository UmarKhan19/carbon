#include <gtest/gtest.h>
#include "graph/dependency_graph.h"
#include "test_helpers.h"

#include <algorithm>
#include <variant>

using namespace carbon;
using namespace carbon::test;

// Helper: build a contact graph from a list of touching part pairs
static ContactGraph build_chain_graph(
    const std::vector<std::string>& ids,
    const std::vector<std::pair<int, int>>& touching_pairs) {

    TriMesh cube = make_cube(0.5f);

    std::vector<TriMesh> meshes(ids.size(), cube);
    std::vector<Isometry> isos;
    for (size_t i = 0; i < ids.size(); ++i) {
        isos.push_back(iso_at(Vec3(static_cast<float>(i), 0, 0)));
    }

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts;
    for (size_t i = 0; i < ids.size(); ++i) {
        parts.push_back({ids[i], &meshes[i], &isos[i]});
    }

    // Build with threshold that connects adjacent cubes (1 unit apart, cube size 1)
    return ContactGraph::build(parts, 0.1f);
}

TEST(DependencyGraph, FastenerDependsOnNeighbors) {
    // plate_a -- bolt -- plate_b (linear chain)
    auto graph = build_chain_graph(
        {"plate_a", "bolt_1", "plate_b"},
        {{0, 1}, {1, 2}});

    std::unordered_map<std::string, PartClassification> classifications;
    classifications["plate_a"] = {0.0f, 0.7f, 0.0f};  // structural
    classifications["bolt_1"] = {0.8f, 0.0f, 0.0f};    // fastener
    classifications["plate_b"] = {0.0f, 0.7f, 0.0f};   // structural

    std::unordered_map<std::string, PartKind> kinds = {
        {"plate_a", PartKind::Structural},
        {"bolt_1", PartKind::Fastener},
        {"plate_b", PartKind::Structural},
    };

    auto dep = DependencyGraph::build(graph, classifications, kinds);

    // Bolt can only be disassembled first (nothing depends on it)
    std::unordered_set<std::string> empty;
    EXPECT_TRUE(dep.can_disassemble("bolt_1", empty));

    // Plates cannot be disassembled before bolt (bolt depends on them)
    EXPECT_FALSE(dep.can_disassemble("plate_a", empty));
    EXPECT_FALSE(dep.can_disassemble("plate_b", empty));
}

TEST(DependencyGraph, PanelBetweenStructuralAndFastener) {
    // frame (structural) -- cover (panel) -- bolt (fastener)
    auto graph = build_chain_graph(
        {"frame", "cover", "bolt_1"},
        {{0, 1}, {1, 2}});

    std::unordered_map<std::string, PartClassification> classifications;
    classifications["frame"] = {0.0f, 0.8f, 0.0f};
    classifications["cover"] = {0.0f, 0.0f, 0.6f};
    classifications["bolt_1"] = {0.8f, 0.0f, 0.0f};

    std::unordered_map<std::string, PartKind> kinds = {
        {"frame", PartKind::Structural},
        {"cover", PartKind::Panel},
        {"bolt_1", PartKind::Fastener},
    };

    auto dep = DependencyGraph::build(graph, classifications, kinds);

    // Disassembly order: bolt → cover → frame
    std::unordered_set<std::string> empty;
    EXPECT_TRUE(dep.can_disassemble("bolt_1", empty));
    EXPECT_FALSE(dep.can_disassemble("cover", empty));
    EXPECT_FALSE(dep.can_disassemble("frame", empty));

    // After removing bolt
    std::unordered_set<std::string> removed_bolt = {"bolt_1"};
    EXPECT_TRUE(dep.can_disassemble("cover", removed_bolt));
    EXPECT_FALSE(dep.can_disassemble("frame", removed_bolt));

    // After removing bolt + cover
    std::unordered_set<std::string> removed_both = {"bolt_1", "cover"};
    EXPECT_TRUE(dep.can_disassemble("frame", removed_both));
}

TEST(DependencyGraph, TopologicalSortNoCycles) {
    // base (structural) → panel (panel) → screw (fastener) chain
    // Avoids structural↔structural cycles that arise from Rule 2
    auto graph = build_chain_graph(
        {"base", "panel", "screw"},
        {{0, 1}, {1, 2}});

    std::unordered_map<std::string, PartClassification> classifications;
    classifications["base"] = {0.0f, 0.8f, 0.0f};
    classifications["panel"] = {0.0f, 0.0f, 0.6f};
    classifications["screw"] = {0.8f, 0.0f, 0.0f};

    std::unordered_map<std::string, PartKind> kinds = {
        {"base", PartKind::Structural},
        {"panel", PartKind::Panel},
        {"screw", PartKind::Fastener},
    };

    auto dep = DependencyGraph::build(graph, classifications, kinds);
    auto result = dep.topological_sort();

    // Should be a valid ordering (not cycles)
    ASSERT_TRUE(std::holds_alternative<std::vector<std::string>>(result));
    auto& sorted = std::get<std::vector<std::string>>(result);
    EXPECT_EQ(sorted.size(), 3u);

    // Assembly order: base → panel → screw
    auto pos = [&](const std::string& id) {
        return std::find(sorted.begin(), sorted.end(), id) - sorted.begin();
    };
    EXPECT_LT(pos("base"), pos("screw"));
}

TEST(DependencyGraph, CanDisassemble) {
    // a → b (a must be assembled before b; in disassembly, b removed before a)
    auto graph = build_chain_graph({"a", "b"}, {{0, 1}});

    std::unordered_map<std::string, PartClassification> classifications;
    classifications["a"] = {0.0f, 0.8f, 0.0f};  // structural
    classifications["b"] = {0.8f, 0.0f, 0.0f};   // fastener

    std::unordered_map<std::string, PartKind> kinds = {
        {"a", PartKind::Structural},
        {"b", PartKind::Fastener},
    };

    auto dep = DependencyGraph::build(graph, classifications, kinds);

    std::unordered_set<std::string> empty;
    // b can be disassembled first (nothing depends on it being removed first)
    EXPECT_TRUE(dep.can_disassemble("b", empty));
    // a cannot be disassembled until b is removed (b depends on a → must remove b first)
    EXPECT_FALSE(dep.can_disassemble("a", empty));

    // After removing b
    std::unordered_set<std::string> removed = {"b"};
    EXPECT_TRUE(dep.can_disassemble("a", removed));
}

TEST(DependencyGraph, EdgeCount) {
    // Place frame at center, bolts adjacent on both sides
    TriMesh cube = make_cube(0.5f);
    Isometry iso_frame = iso_at(Vec3(0, 0, 0));
    Isometry iso_bolt1 = iso_at(Vec3(1.0f, 0, 0));   // touches frame
    Isometry iso_bolt2 = iso_at(Vec3(0, 1.0f, 0));    // also touches frame

    std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>> parts = {
        {"frame", &cube, &iso_frame},
        {"bolt_1", &cube, &iso_bolt1},
        {"bolt_2", &cube, &iso_bolt2},
    };
    auto graph = ContactGraph::build(parts, 0.1f);

    std::unordered_map<std::string, PartClassification> classifications;
    classifications["frame"] = {0.0f, 0.8f, 0.0f};
    classifications["bolt_1"] = {0.8f, 0.0f, 0.0f};
    classifications["bolt_2"] = {0.8f, 0.0f, 0.0f};

    std::unordered_map<std::string, PartKind> kinds = {
        {"frame", PartKind::Structural},
        {"bolt_1", PartKind::Fastener},
        {"bolt_2", PartKind::Fastener},
    };

    auto dep = DependencyGraph::build(graph, classifications, kinds);
    // frame → bolt_1, frame → bolt_2 = at least 2 dependency edges
    EXPECT_GE(dep.edge_count(), 2u);
}
