#pragma once

/// Tessellation of BRep shapes to triangle meshes.
/// Uses OpenCascade BRepMesh_IncrementalMesh.

#include "geometry/types.h"
#include <TopoDS_Shape.hxx>

namespace carbon {

/// Tessellate a BRep shape into a triangle mesh.
/// Attempts multiple deflection values for robustness:
/// tries coarse (1.0mm) first for speed, then falls back to finer values.
/// Applies ShapeFix_Shape healing before tessellation.
TriMesh tessellate_shape(const TopoDS_Shape& shape,
                         double linear_deflection = 0.1,
                         double angular_deflection = 0.5);  // radians (~28.6 degrees)

} // namespace carbon
