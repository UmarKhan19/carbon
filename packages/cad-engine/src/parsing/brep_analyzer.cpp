#include "parsing/brep_analyzer.h"

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAbs_CurveType.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>

#include <cmath>
#include <algorithm>
#include <iostream>

namespace carbon {

// --- Axis deduplication helpers ---

static bool axes_parallel(const std::array<double, 3>& a, const std::array<double, 3>& b, double tol = 0.98) {
    double dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    return std::abs(dot) > tol;
}

static bool axis_exists(const std::vector<std::array<double, 3>>& axes,
                        const std::array<double, 3>& candidate, double tol = 0.98) {
    for (const auto& ax : axes) {
        if (axes_parallel(ax, candidate, tol)) return true;
    }
    return false;
}

static std::array<double, 3> normalize_axis(double x, double y, double z) {
    double len = std::sqrt(x*x + y*y + z*z);
    if (len < 1e-12) return {0, 0, 1};
    return {x/len, y/len, z/len};
}

// --- Main BRep analysis ---

BRepAnalysis analyze_shape(const TopoDS_Shape& shape) {
    BRepAnalysis result;
    if (shape.IsNull()) return result;

    // --- 1. Mass properties (volume, surface area, center of gravity) ---
    try {
        GProp_GProps vprops;
        BRepGProp::VolumeProperties(shape, vprops);
        result.volume = vprops.Mass();
        gp_Pnt cog = vprops.CentreOfMass();
        result.center_of_gravity = {cog.X(), cog.Y(), cog.Z()};
    } catch (...) {
        result.volume = 0.0;
    }

    try {
        GProp_GProps sprops;
        BRepGProp::SurfaceProperties(shape, sprops);
        result.surface_area = sprops.Mass();
    } catch (...) {
        result.surface_area = 0.0;
    }

    // --- 2. Face type classification ---
    double cylindrical_area = 0.0;
    double planar_area = 0.0;

    for (TopExp_Explorer faceExp(shape, TopAbs_FACE); faceExp.More(); faceExp.Next()) {
        const TopoDS_Face& face = TopoDS::Face(faceExp.Current());
        result.total_faces++;

        double face_area = 0.0;
        try {
            GProp_GProps fprops;
            BRepGProp::SurfaceProperties(face, fprops);
            face_area = std::abs(fprops.Mass());
        } catch (...) {}

        try {
            BRepAdaptor_Surface adaptor(face);
            GeomAbs_SurfaceType stype = adaptor.GetType();

            switch (stype) {
                case GeomAbs_Plane:
                    result.planar_faces++;
                    planar_area += face_area;
                    break;

                case GeomAbs_Cylinder: {
                    result.cylindrical_faces++;
                    cylindrical_area += face_area;

                    // Extract cylinder axis for hole/insertion detection
                    gp_Cylinder cyl = adaptor.Cylinder();
                    gp_Dir dir = cyl.Axis().Direction();
                    auto ax = normalize_axis(dir.X(), dir.Y(), dir.Z());

                    if (!axis_exists(result.hole_axes, ax)) {
                        result.hole_axes.push_back(ax);
                    }
                    break;
                }

                case GeomAbs_Cone: {
                    result.conical_faces++;
                    // Cone axis also useful for insertion
                    gp_Cone cone = adaptor.Cone();
                    gp_Dir dir = cone.Axis().Direction();
                    auto ax = normalize_axis(dir.X(), dir.Y(), dir.Z());
                    if (!axis_exists(result.hole_axes, ax)) {
                        result.hole_axes.push_back(ax);
                    }
                    break;
                }

                case GeomAbs_Sphere:
                    result.spherical_faces++;
                    break;

                case GeomAbs_Torus:
                    result.toroidal_faces++;
                    break;

                default:
                    result.freeform_faces++;
                    break;
            }
        } catch (...) {
            result.freeform_faces++;
        }
    }

    // Compute ratios
    if (result.surface_area > 1e-12) {
        result.cylindrical_surface_ratio = cylindrical_area / result.surface_area;
        result.planar_surface_ratio = planar_area / result.surface_area;
    }

    // --- 3. Thread detection via helical edge patterns ---
    // Helical edges (BSpline curves with monotonic Z and circular XY) indicate threads.
    // Also check for very small-radius cylindrical faces wrapping around a shaft.
    for (TopExp_Explorer edgeExp(shape, TopAbs_EDGE); edgeExp.More(); edgeExp.Next()) {
        const TopoDS_Edge& edge = TopoDS::Edge(edgeExp.Current());

        try {
            BRepAdaptor_Curve curve(edge);
            GeomAbs_CurveType ctype = curve.GetType();

            if (ctype == GeomAbs_BSplineCurve || ctype == GeomAbs_OtherCurve) {
                double u0 = curve.FirstParameter();
                double u1 = curve.LastParameter();
                if (u1 - u0 < 1e-6) continue;

                // Sample points to detect helical pattern
                constexpr int N = 12;
                double total_z_delta = 0;
                double total_angle = 0;
                bool z_monotonic = true;
                double prev_dz_sign = 0;

                gp_Pnt p0 = curve.Value(u0);
                gp_Pnt prev = p0;

                for (int i = 1; i <= N; ++i) {
                    double t = u0 + (u1 - u0) * i / N;
                    gp_Pnt pt = curve.Value(t);

                    double dz = pt.Z() - prev.Z();
                    total_z_delta += std::abs(dz);

                    // Check monotonicity
                    if (std::abs(dz) > 1e-6) {
                        double sign = dz > 0 ? 1.0 : -1.0;
                        if (prev_dz_sign != 0 && sign != prev_dz_sign) {
                            z_monotonic = false;
                        }
                        prev_dz_sign = sign;
                    }

                    // Estimate angular change in XY plane
                    double dx = pt.X() - prev.X();
                    double dy = pt.Y() - prev.Y();
                    double xy_dist = std::sqrt(dx*dx + dy*dy);
                    double r_avg = 0.5 * (std::sqrt(pt.X()*pt.X() + pt.Y()*pt.Y()) +
                                          std::sqrt(prev.X()*prev.X() + prev.Y()*prev.Y()));
                    if (r_avg > 1e-6) {
                        total_angle += xy_dist / r_avg;  // arc_length / radius ≈ angle
                    }

                    prev = pt;
                }

                // Helix heuristic: wraps >180 degrees and Z progresses monotonically
                if (z_monotonic && total_angle > M_PI && total_z_delta > 1e-3) {
                    result.has_threads = true;
                    result.thread_count++;
                }
            }
        } catch (...) {}
    }

    // --- 4. Infer insertion axes from cylinder/cone axes ---
    for (const auto& ax : result.hole_axes) {
        if (!axis_exists(result.insertion_axes, ax)) {
            result.insertion_axes.push_back(ax);
        }
    }

    return result;
}

} // namespace carbon
