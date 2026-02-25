#include "parsing/tessellator.h"

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <Poly_Triangulation.hxx>
#include <TopLoc_Location.hxx>
#include <gp_Pnt.hxx>
#include <chrono>
#include <iostream>
#include <unordered_map>

namespace carbon {

TriMesh tessellate_shape(const TopoDS_Shape& shape,
                         double linear_deflection,
                         double angular_deflection) {
    TriMesh result;

    if (shape.IsNull()) return result;

    auto t0 = std::chrono::steady_clock::now();

    // Heal shape before tessellation (matches Python OCC behavior).
    // Fixes bad geometry that can cause BRepMesh to hang or produce degenerate results.
    TopoDS_Shape working_shape = shape;
    ShapeFix_Shape fixer(working_shape);
    fixer.Perform();
    TopoDS_Shape fixed = fixer.Shape();
    if (!fixed.IsNull()) working_shape = fixed;

    // Tessellate with BRepMesh. Try coarse deflection first for speed,
    // fall back to finer values if no triangulation is produced.
    // This matches Python OCC's order: [1.0, 0.5, 0.1].
    double deflections[] = {1.0, 0.5, linear_deflection};
    for (double defl : deflections) {
        BRepMesh_IncrementalMesh mesher(working_shape, defl, false,
                                        angular_deflection);  // already in radians
        mesher.Perform();
        if (mesher.IsDone()) break;
    }

    // Accumulate vertices and triangles from all faces.
    // Each face may produce its own Poly_Triangulation with local indices,
    // so we need to offset indices when merging.

    // For smooth normals: accumulate face normals per vertex position
    std::vector<Vec3> normal_accum;

    for (TopExp_Explorer exp(working_shape, TopAbs_FACE); exp.More(); exp.Next()) {
        const TopoDS_Face& face = TopoDS::Face(exp.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);

        if (tri.IsNull() || tri->NbTriangles() == 0) continue;

        const gp_Trsf& trsf = loc.Transformation();
        bool hasTransform = !loc.IsIdentity();

        // Face orientation (reversed faces need flipped normals and winding)
        bool reversed = (face.Orientation() == TopAbs_REVERSED);

        uint32_t vertexOffset = static_cast<uint32_t>(result.vertices.size());

        // Copy vertices (transformed to world space)
        for (int i = 1; i <= tri->NbNodes(); i++) {
            gp_Pnt p = tri->Node(i);
            if (hasTransform) p.Transform(trsf);
            result.vertices.push_back(Vec3(
                static_cast<float>(p.X()),
                static_cast<float>(p.Y()),
                static_cast<float>(p.Z())
            ));
            normal_accum.push_back(Vec3::Zero());
        }

        // Copy triangles (with vertex offset and correct winding)
        for (int i = 1; i <= tri->NbTriangles(); i++) {
            int n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);

            // Convert 1-based to 0-based and add offset
            uint32_t a = vertexOffset + static_cast<uint32_t>(n1 - 1);
            uint32_t b = vertexOffset + static_cast<uint32_t>(n2 - 1);
            uint32_t c = vertexOffset + static_cast<uint32_t>(n3 - 1);

            // Reverse winding for reversed faces
            if (reversed) std::swap(b, c);

            result.indices.push_back({a, b, c});

            // Accumulate area-weighted face normal
            const Vec3& va = result.vertices[a];
            const Vec3& vb = result.vertices[b];
            const Vec3& vc = result.vertices[c];
            Vec3 edge1 = vb - va;
            Vec3 edge2 = vc - va;
            Vec3 faceNormal = edge1.cross(edge2); // area-weighted (not normalized)

            normal_accum[a] += faceNormal;
            normal_accum[b] += faceNormal;
            normal_accum[c] += faceNormal;
        }
    }

    // Normalize accumulated normals
    if (!result.vertices.empty()) {
        std::vector<Vec3> normals(result.vertices.size());
        for (size_t i = 0; i < normal_accum.size(); i++) {
            float len = normal_accum[i].norm();
            normals[i] = (len > 1e-8f)
                ? normal_accum[i] / len
                : Vec3(0, 1, 0); // fallback up vector
        }
        result.normals = std::move(normals);
    }

    auto dt = std::chrono::duration<double, std::milli>(
        std::chrono::steady_clock::now() - t0).count();
    std::cout << "[tessellator] " << result.vertices.size() << " verts, "
              << result.indices.size() << " tris in " << dt << "ms" << std::endl;

    return result;
}

} // namespace carbon
