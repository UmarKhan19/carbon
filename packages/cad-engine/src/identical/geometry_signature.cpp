#include "identical/geometry_signature.h"
#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace carbon {

GeometrySignature compute_signature(const TriMesh& mesh) {
    GeometrySignature sig;
    sig.vertex_count = mesh.vertex_count();
    sig.triangle_count = mesh.triangle_count();

    AABB aabb = mesh.local_aabb();
    Vec3 dims = aabb.size();

    // Quantize volume to reduce floating-point noise
    sig.volume_quantized = static_cast<int64_t>(aabb.volume() * 1000.0f);

    // Sort dimensions for rotation invariance
    std::array<float, 3> d = {dims.x(), dims.y(), dims.z()};
    std::sort(d.begin(), d.end());
    sig.sorted_obb_dims = {
        static_cast<int64_t>(d[0] * 1000.0f),
        static_cast<int64_t>(d[1] * 1000.0f),
        static_cast<int64_t>(d[2] * 1000.0f)
    };

    return sig;
}

// Hash function for GeometrySignature
struct SignatureHash {
    size_t operator()(const GeometrySignature& s) const {
        size_t h = std::hash<size_t>()(s.vertex_count);
        h ^= std::hash<size_t>()(s.triangle_count) << 1;
        h ^= std::hash<int64_t>()(s.volume_quantized) << 2;
        h ^= std::hash<int64_t>()(s.sorted_obb_dims[0]) << 3;
        h ^= std::hash<int64_t>()(s.sorted_obb_dims[1]) << 4;
        h ^= std::hash<int64_t>()(s.sorted_obb_dims[2]) << 5;
        return h;
    }
};

std::vector<std::vector<std::string>> find_identical_groups(
    const std::vector<std::pair<std::string, const TriMesh*>>& parts) {
    std::unordered_map<GeometrySignature, std::vector<std::string>, SignatureHash> groups;

    for (const auto& [id, mesh] : parts) {
        auto sig = compute_signature(*mesh);
        groups[sig].push_back(id);
    }

    std::vector<std::vector<std::string>> result;
    for (auto& [sig, ids] : groups) {
        if (ids.size() >= 2) {
            result.push_back(std::move(ids));
        }
    }
    return result;
}

} // namespace carbon
