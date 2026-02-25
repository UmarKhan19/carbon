#pragma once

/// BRep geometry analyzer using OpenCascade.
/// NEW capability — extracts face types, threads, holes, mass properties.
/// Not available in the Rust simulator.

#include "parsing/brep_analysis_types.h"
#include <TopoDS_Shape.hxx>

namespace carbon {

/// Analyze the BRep geometry of a shape.
/// Extracts mass properties, face classifications, thread detection, and insertion axes.
BRepAnalysis analyze_shape(const TopoDS_Shape& shape);

} // namespace carbon
