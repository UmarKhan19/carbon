#pragma once

/// Signed Distance Field generation and queries.
/// Provides O(1) collision queries via trilinear interpolation of a precomputed
/// voxel grid. Based on the approach from Batty's sdfgen library (as used in
/// Assemble-Them-All, SIGGRAPH Asia 2022).

#include "geometry/types.h"
#include <vector>

namespace carbon {

/// Configuration for SDF generation.
struct SDFConfig {
    float dx = 0.0f;          ///< Voxel spacing. 0 = auto from min_resolution.
    int min_resolution = 20;   ///< Minimum voxels per axis (when dx is auto).
    int padding = 1;           ///< Voxel padding around mesh bounding box.
    int exact_band = 1;        ///< Exact distance band around each triangle (in voxels).
};

/// A 3D signed distance field stored as a regular voxel grid.
/// Negative values = inside the mesh, positive = outside, zero = on the surface.
struct SDFGrid {
    std::vector<float> data;   ///< Flat 3D array (i varies fastest, then j, then k).
    Vec3 origin;               ///< World-space position of grid cell (0,0,0).
    float dx = 0.0f;           ///< Voxel spacing (uniform in all axes).
    int ni = 0, nj = 0, nk = 0; ///< Grid dimensions.

    /// Flat index from (i, j, k).
    int index(int i, int j, int k) const { return (k * nj + j) * ni + i; }

    /// Mutable voxel access.
    float& operator()(int i, int j, int k) { return data[index(i, j, k)]; }

    /// Const voxel access.
    float operator()(int i, int j, int k) const { return data[index(i, j, k)]; }

    /// Query the SDF at an arbitrary world-space point via trilinear interpolation.
    /// Points outside the grid are clamped to the nearest boundary cell.
    float query(const Vec3& point) const;

    /// Compute the SDF gradient at a world-space point via central differences.
    /// The gradient points away from the surface (outward direction).
    Vec3 gradient(const Vec3& point) const;

    /// Check if a point is inside the mesh (negative SDF value).
    bool is_inside(const Vec3& point) const { return query(point) < 0.0f; }

    /// World-space AABB of the entire grid.
    AABB grid_aabb() const {
        return {origin, origin + Vec3((ni - 1) * dx, (nj - 1) * dx, (nk - 1) * dx)};
    }

    /// Total number of voxels.
    size_t total_cells() const { return static_cast<size_t>(ni) * nj * nk; }

    /// Check if grid has been initialized.
    bool empty() const { return data.empty(); }
};

/// Generate an SDF from a triangle mesh in local space.
/// The grid covers the mesh bounding box plus padding.
SDFGrid generate_sdf(const TriMesh& mesh, const SDFConfig& config = {});

/// Generate an SDF from a triangle mesh transformed to world space.
SDFGrid generate_sdf(const TriMesh& mesh, const Isometry& transform,
                     const SDFConfig& config = {});

} // namespace carbon
