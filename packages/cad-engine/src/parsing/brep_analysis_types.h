#pragma once

/// Lightweight BRep analysis result types (no OpenCascade dependency).
/// Used by brep_analyzer.h and included by types.h for metadata storage.

#include <array>
#include <vector>

namespace carbon {

struct BRepAnalysis {
    double volume = 0.0;
    double surface_area = 0.0;
    std::array<double, 3> center_of_gravity = {0, 0, 0};

    // Face type counts
    int planar_faces = 0;
    int cylindrical_faces = 0;
    int conical_faces = 0;
    int spherical_faces = 0;
    int toroidal_faces = 0;
    int freeform_faces = 0;
    int total_faces = 0;

    // Derived ratios
    double cylindrical_surface_ratio = 0.0;  // cylindrical area / total area
    double planar_surface_ratio = 0.0;       // planar area / total area

    // Feature detection
    bool has_threads = false;
    int thread_count = 0;

    // Axes extracted from cylindrical faces and threads
    std::vector<std::array<double, 3>> hole_axes;
    std::vector<std::array<double, 3>> insertion_axes;
};

} // namespace carbon
