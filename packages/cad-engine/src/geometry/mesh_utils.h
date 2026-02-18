#pragma once

/// Mesh utility functions: normals, bounding box, vertex welding.
/// Port of cad-parser/src/mesh_converter.rs.

#include "geometry/types.h"

namespace carbon {

/// Compute per-vertex normals via face normal accumulation.
void compute_normals(TriMesh& mesh);

/// Merge duplicate vertices within a distance tolerance.
void merge_duplicate_vertices(TriMesh& mesh, float tolerance = 1e-6f);

} // namespace carbon
