#pragma once

/// Shared test utilities for creating test meshes and assemblies.

#include "geometry/types.h"
#include <array>
#include <cmath>
#include <string>

namespace carbon::test {

/// Create a unit cube mesh centered at origin with given half-size.
/// 8 vertices, 12 triangles (2 per face).
inline TriMesh make_cube(float half = 0.5f) {
    TriMesh m;
    m.vertices = {
        {-half, -half, -half}, { half, -half, -half},
        { half,  half, -half}, {-half,  half, -half},
        {-half, -half,  half}, { half, -half,  half},
        { half,  half,  half}, {-half,  half,  half},
    };
    m.indices = {
        {0, 1, 2}, {0, 2, 3},  // -Z face
        {4, 6, 5}, {4, 7, 6},  // +Z face
        {0, 4, 5}, {0, 5, 1},  // -Y face
        {2, 6, 7}, {2, 7, 3},  // +Y face
        {0, 3, 7}, {0, 7, 4},  // -X face
        {1, 5, 6}, {1, 6, 2},  // +X face
    };
    return m;
}

/// Create a cube mesh with specified size (edge length).
inline TriMesh make_cube_sized(float size) {
    return make_cube(size * 0.5f);
}

/// Create a cylinder mesh along Z axis centered at origin.
inline TriMesh make_cylinder(float radius, float height, int segments = 16) {
    TriMesh m;
    float half_h = height * 0.5f;

    // Bottom center (0) and top center (1)
    m.vertices.push_back({0, 0, -half_h});
    m.vertices.push_back({0, 0,  half_h});

    // Generate ring vertices (bottom ring starting at index 2, top ring at 2+segments)
    for (int i = 0; i < segments; ++i) {
        float angle = 2.0f * M_PI * i / segments;
        float x = radius * std::cos(angle);
        float y = radius * std::sin(angle);
        m.vertices.push_back({x, y, -half_h});  // bottom ring
    }
    for (int i = 0; i < segments; ++i) {
        float angle = 2.0f * M_PI * i / segments;
        float x = radius * std::cos(angle);
        float y = radius * std::sin(angle);
        m.vertices.push_back({x, y, half_h});   // top ring
    }

    uint32_t bot_center = 0;
    uint32_t top_center = 1;
    uint32_t bot_start = 2;
    uint32_t top_start = 2 + segments;

    for (int i = 0; i < segments; ++i) {
        int next = (i + 1) % segments;

        // Bottom cap
        m.indices.push_back({bot_center, bot_start + next, bot_start + i});
        // Top cap
        m.indices.push_back({top_center, top_start + i, top_start + next});
        // Side quad (2 triangles)
        m.indices.push_back({bot_start + i, bot_start + next, top_start + next});
        m.indices.push_back({bot_start + i, top_start + next, top_start + i});
    }

    return m;
}

/// Create an AssemblyNode with a mesh placed at the given position.
inline AssemblyNode make_part_node(const std::string& id, const std::string& name,
                                    TriMesh mesh, const Vec3& position) {
    AssemblyNode node;
    node.id = id;
    node.name = name;
    node.node_type = NodeType::Part;
    node.transform = Mat4::Identity();
    node.transform(0, 3) = position.x();
    node.transform(1, 3) = position.y();
    node.transform(2, 3) = position.z();
    node.mesh = std::move(mesh);
    return node;
}

/// Create a root assembly node with children.
inline AssemblyNode make_assembly(const std::string& id, std::vector<AssemblyNode> children) {
    AssemblyNode root;
    root.id = id;
    root.name = id;
    root.node_type = NodeType::Assembly;
    root.transform = Mat4::Identity();
    root.children = std::move(children);
    return root;
}

/// Create a sub-assembly node with a position offset and children.
inline AssemblyNode make_sub_assembly(const std::string& id, const Vec3& position,
                                       std::vector<AssemblyNode> children) {
    AssemblyNode node;
    node.id = id;
    node.name = id;
    node.node_type = NodeType::Assembly;
    node.transform = Mat4::Identity();
    node.transform(0, 3) = position.x();
    node.transform(1, 3) = position.y();
    node.transform(2, 3) = position.z();
    node.children = std::move(children);
    return node;
}

/// Create an Isometry from a translation vector.
inline Isometry iso_at(const Vec3& pos) {
    Isometry iso;
    iso.translation = pos;
    return iso;
}

} // namespace carbon::test
