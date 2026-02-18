#include "geometry/mesh_utils.h"
#include <cmath>
#include <unordered_map>

namespace carbon {

void compute_normals(TriMesh& mesh) {
    std::vector<Vec3> normals(mesh.vertices.size(), Vec3::Zero());

    for (const auto& tri : mesh.indices) {
        const Vec3& v0 = mesh.vertices[tri[0]];
        const Vec3& v1 = mesh.vertices[tri[1]];
        const Vec3& v2 = mesh.vertices[tri[2]];

        Vec3 edge1 = v1 - v0;
        Vec3 edge2 = v2 - v0;
        Vec3 face_normal = edge1.cross(edge2);
        // Area-weighted: don't normalize the face normal before accumulating
        normals[tri[0]] += face_normal;
        normals[tri[1]] += face_normal;
        normals[tri[2]] += face_normal;
    }

    for (auto& n : normals) {
        float len = n.norm();
        if (len > 1e-10f) {
            n /= len;
        } else {
            n = Vec3(0, 1, 0);  // default up
        }
    }

    mesh.normals = std::move(normals);
}

void merge_duplicate_vertices(TriMesh& mesh, float tolerance) {
    // TODO: Implement spatial hashing for vertex welding
    // For now, this is a placeholder
}

} // namespace carbon
