#pragma once

/// Geometry signature for identical part detection.
/// Port of geometry.rs.

#include "geometry/types.h"
#include <string>
#include <vector>

namespace carbon {

struct GeometrySignature {
    size_t vertex_count = 0;
    size_t triangle_count = 0;
    int64_t volume_quantized = 0;
    std::array<int64_t, 3> sorted_obb_dims = {0, 0, 0};

    bool operator==(const GeometrySignature& other) const {
        return vertex_count == other.vertex_count &&
               triangle_count == other.triangle_count &&
               volume_quantized == other.volume_quantized &&
               sorted_obb_dims == other.sorted_obb_dims;
    }
};

/// Compute geometry signature from a mesh.
GeometrySignature compute_signature(const TriMesh& mesh);

/// Find groups of parts with identical geometry.
/// Returns groups with 2+ members (singletons are excluded).
std::vector<std::vector<std::string>> find_identical_groups(
    const std::vector<std::pair<std::string, const TriMesh*>>& parts);

} // namespace carbon
