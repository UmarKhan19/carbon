#pragma once

/// Core geometric types for the CAD assembly engine.
/// Replaces nalgebra types from Rust (Point3, Vector3, Matrix4, Isometry3).

#include "parsing/brep_analysis_types.h"
#include <Eigen/Dense>
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace carbon {

// --- Linear algebra aliases ---

using Vec3 = Eigen::Vector3f;
using Vec3d = Eigen::Vector3d;
using Mat4 = Eigen::Matrix4f;
using Quat = Eigen::Quaternionf;

// --- Axis-Aligned Bounding Box ---

struct AABB {
    Vec3 min{0, 0, 0};
    Vec3 max{0, 0, 0};

    Vec3 center() const { return (min + max) * 0.5f; }
    Vec3 size() const { return max - min; }
    float diagonal() const { return size().norm(); }

    bool overlaps(const AABB& other, float margin = 0.0f) const {
        return min.x() - margin <= other.max.x() &&
               max.x() + margin >= other.min.x() &&
               min.y() - margin <= other.max.y() &&
               max.y() + margin >= other.min.y() &&
               min.z() - margin <= other.max.z() &&
               max.z() + margin >= other.min.z();
    }

    float volume() const {
        Vec3 s = size();
        return s.x() * s.y() * s.z();
    }

    /// Merge with another AABB (union).
    AABB merged(const AABB& other) const {
        return {
            Vec3(std::min(min.x(), other.min.x()),
                 std::min(min.y(), other.min.y()),
                 std::min(min.z(), other.min.z())),
            Vec3(std::max(max.x(), other.max.x()),
                 std::max(max.y(), other.max.y()),
                 std::max(max.z(), other.max.z()))
        };
    }
};

// --- Isometry (rigid-body transform: rotation + translation) ---

struct Isometry {
    Quat rotation = Quat::Identity();
    Vec3 translation{0, 0, 0};

    static Isometry identity() {
        return {};
    }

    /// Build from a column-major 4x4 matrix (as used in the JSON API).
    static Isometry from_matrix4(const Mat4& m) {
        Isometry iso;
        // Extract 3x3 rotation submatrix
        Eigen::Matrix3f rot = m.block<3, 3>(0, 0);
        iso.rotation = Quat(rot).normalized();
        iso.translation = m.block<3, 1>(0, 3);
        return iso;
    }

    /// Build from a flat 16-float column-major array (JSON transform field).
    static Isometry from_column_major(const float* data) {
        Mat4 m = Eigen::Map<const Mat4>(data);
        return from_matrix4(m);
    }

    /// Convert to a column-major 4x4 matrix.
    Mat4 to_matrix4() const {
        Mat4 m = Mat4::Identity();
        m.block<3, 3>(0, 0) = rotation.toRotationMatrix();
        m.block<3, 1>(0, 3) = translation;
        return m;
    }

    /// Transform a point.
    Vec3 transform_point(const Vec3& p) const {
        return rotation * p + translation;
    }

    /// Transform a direction (rotation only, no translation).
    Vec3 transform_direction(const Vec3& d) const {
        return rotation * d;
    }

    /// Compose two isometries (this * other).
    Isometry operator*(const Isometry& other) const {
        Isometry result;
        result.rotation = (rotation * other.rotation).normalized();
        result.translation = rotation * other.translation + translation;
        return result;
    }

    /// Inverse transform.
    Isometry inverse() const {
        Isometry result;
        result.rotation = rotation.conjugate();
        result.translation = result.rotation * (-translation);
        return result;
    }
};

// --- Triangle Mesh ---

struct TriMesh {
    std::vector<Vec3> vertices;
    std::vector<std::array<uint32_t, 3>> indices;
    std::optional<std::vector<Vec3>> normals;

    size_t vertex_count() const { return vertices.size(); }
    size_t triangle_count() const { return indices.size(); }
    bool empty() const { return vertices.empty() || indices.empty(); }

    /// Compute local-space AABB.
    AABB local_aabb() const {
        if (vertices.empty()) return {};
        Vec3 lo = vertices[0], hi = vertices[0];
        for (const auto& v : vertices) {
            lo = lo.cwiseMin(v);
            hi = hi.cwiseMax(v);
        }
        return {lo, hi};
    }

    /// Compute world-space AABB under a transform.
    AABB world_aabb(const Isometry& transform) const {
        if (vertices.empty()) return {};
        Vec3 first = transform.transform_point(vertices[0]);
        Vec3 lo = first, hi = first;
        for (const auto& v : vertices) {
            Vec3 wv = transform.transform_point(v);
            lo = lo.cwiseMin(wv);
            hi = hi.cwiseMax(wv);
        }
        return {lo, hi};
    }
};

// --- Assembly hierarchy types (mirrors cad-common/src/assembly.rs) ---

enum class NodeType { Assembly, Part };

struct AssemblyNodeMetadata {
    std::optional<std::string> material;
    std::optional<std::string> part_number;
    std::optional<std::array<float, 3>> color;
    std::optional<float> mass;
    // BRep-derived fields (populated by brep_analyzer)
    std::optional<float> volume;
    std::optional<float> surface_area;
    std::optional<std::array<float, 3>> center_of_gravity;
    std::optional<BRepAnalysis> brep_analysis;
};

struct AssemblyNode {
    std::string id;
    std::string name;
    std::string original_name;
    NodeType node_type = NodeType::Part;
    Mat4 transform = Mat4::Identity();   // column-major 4x4
    std::optional<AABB> bounding_box;
    std::optional<TriMesh> mesh;         // only for parts
    std::vector<AssemblyNode> children;
    AssemblyNodeMetadata metadata;

    bool is_part() const { return node_type == NodeType::Part; }
    bool is_assembly() const { return node_type == NodeType::Assembly; }

    /// Recursively collect all part nodes.
    void collect_parts(std::vector<const AssemblyNode*>& out) const {
        if (is_part()) {
            out.push_back(this);
        }
        for (const auto& child : children) {
            child.collect_parts(out);
        }
    }

    std::vector<const AssemblyNode*> get_all_parts() const {
        std::vector<const AssemblyNode*> parts;
        collect_parts(parts);
        return parts;
    }

    /// Recursively collect all part nodes with their composed world transforms.
    void collect_parts_world(
        std::vector<std::pair<const AssemblyNode*, Mat4>>& out,
        const Mat4& parent_world = Mat4::Identity()) const {
        Mat4 world = parent_world * transform;
        if (is_part()) {
            out.push_back({this, world});
        }
        for (const auto& child : children) {
            child.collect_parts_world(out, world);
        }
    }

    std::vector<std::pair<const AssemblyNode*, Mat4>> get_all_parts_world() const {
        std::vector<std::pair<const AssemblyNode*, Mat4>> parts;
        collect_parts_world(parts);
        return parts;
    }

    /// Find a node by ID (depth-first).
    const AssemblyNode* find_by_id(const std::string& target_id) const {
        if (id == target_id) return this;
        for (const auto& child : children) {
            if (auto found = child.find_by_id(target_id)) return found;
        }
        return nullptr;
    }
};

// --- Animation types ---

struct AnimationKeyframe {
    float time;          // 0.0 to 1.0
    Mat4 transform;      // column-major 4x4
};

// --- Simulation issue types ---

enum class SimulationIssueKind {
    Overlap,
    Clearance,
    PathNotFound,
    ConstraintConflict
};

enum class SimulationIssueSeverity { Error, Warning };

struct SimulationIssue {
    SimulationIssueKind kind;
    SimulationIssueSeverity severity;
    std::vector<std::string> part_ids;
    std::string message;
    // Optional metrics (stored as JSON string for flexibility)
    std::optional<std::string> metrics_json;
};

// --- Suggested subassembly ---

struct SuggestedSubassembly {
    std::string name;
    std::vector<std::string> part_ids;
    float confidence;
};

// --- Fastener kit ---

struct FastenerKit {
    std::string primary;
    std::vector<std::string> accessories;
};

// --- Planner stats ---

struct PlannerStats {
    size_t contact_edges = 0;
    size_t dependency_edges = 0;
    uint64_t candidate_paths_evaluated = 0;
    uint64_t collision_checks = 0;
    size_t overlap_issue_count = 0;
    uint64_t blocking_matrix_skips = 0;
};

// --- Assembly step ---

struct AssemblyStep {
    uint32_t step_number;
    std::vector<std::string> part_ids;
    std::vector<std::string> part_names;
    std::array<float, 3> assembly_direction;
    std::vector<AnimationKeyframe> animation_path;
    uint32_t suggested_duration_ms;
    std::optional<std::string> motion_type;
    std::optional<float> min_clearance;
    std::optional<float> planner_score;
};

// --- Simulation result ---

struct SimulationResult {
    std::vector<AssemblyStep> steps;
    std::vector<std::string> stuck_parts;
    uint64_t simulation_time_ms = 0;
    bool success = false;
    std::optional<std::string> error;
    std::vector<SimulationIssue> issues;
    std::optional<PlannerStats> planner_stats;
    std::vector<std::vector<std::string>> identical_groups;
    std::vector<SuggestedSubassembly> suggested_subassemblies;
    std::vector<FastenerKit> kits;
};

} // namespace carbon
