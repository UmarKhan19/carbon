#pragma once

/// STEP file reader using OpenCascade STEPCAFControl_Reader (XCAF).
/// Replaces packages/cad-service/src/parser.py.
///
/// Two-stage approach for robustness:
/// 1. XCAF reader: preserves assembly structure, names, colors, transforms
/// 2. Fallback: simple STEPControl_Reader (fewer features, more robust)

#include "geometry/types.h"
#include <string>
#include <vector>

namespace carbon {

struct ParseConfig {
    double linear_deflection = 0.1;   // mm — max mesh-to-geometry distance
    double angular_deflection = 0.5;  // degrees — max angular deviation
    bool extract_colors = true;
    int max_depth = 50;               // recursion depth limit
};

struct ParseResult {
    bool success = false;
    AssemblyNode hierarchy;
    int part_count = 0;
    double parse_time_ms = 0;
    std::string error;
};

/// Parse a STEP file and return the assembly hierarchy with tessellated meshes.
ParseResult parse_step_file(const std::string& file_path, const ParseConfig& config = {});

} // namespace carbon
