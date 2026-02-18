#include "export/glb_writer.h"
#include <nlohmann/json.hpp>
#include <cstring>
#include <algorithm>

using json = nlohmann::json;

namespace carbon {

// --- GLB binary format constants ---

static constexpr uint32_t GLB_MAGIC = 0x46546C67;  // "glTF"
static constexpr uint32_t GLB_VERSION = 2;
static constexpr uint32_t GLB_CHUNK_JSON = 0x4E4F534A;  // "JSON"
static constexpr uint32_t GLB_CHUNK_BIN = 0x004E4942;   // "BIN\0"

// --- Helper: pad to 4-byte alignment ---

static size_t align4(size_t n) {
    return (n + 3) & ~3u;
}

// --- Helper: write little-endian uint32 ---

static void write_u32(std::vector<uint8_t>& buf, uint32_t val) {
    buf.push_back(static_cast<uint8_t>(val));
    buf.push_back(static_cast<uint8_t>(val >> 8));
    buf.push_back(static_cast<uint8_t>(val >> 16));
    buf.push_back(static_cast<uint8_t>(val >> 24));
}

// --- Helper: append raw bytes ---

static void append_bytes(std::vector<uint8_t>& buf, const void* data, size_t size) {
    const auto* p = static_cast<const uint8_t*>(data);
    buf.insert(buf.end(), p, p + size);
}

// --- Helper: pad buffer to 4-byte boundary ---

static void pad_to_4(std::vector<uint8_t>& buf, uint8_t pad_byte) {
    while (buf.size() % 4 != 0) {
        buf.push_back(pad_byte);
    }
}

// --- Recursive mesh collector ---

struct MeshEntry {
    std::string node_id;
    std::string name;
    const TriMesh* mesh;
    std::optional<std::array<float, 3>> color;
    std::array<float, 16> transform;
};

static void collect_meshes(const AssemblyNode& node, std::vector<MeshEntry>& entries) {
    if (node.is_part() && node.mesh && !node.mesh->empty()) {
        MeshEntry entry;
        entry.node_id = node.id;
        entry.name = node.name;
        entry.mesh = &(*node.mesh);
        entry.color = node.metadata.color;
        // Store transform as column-major float[16]
        for (int c = 0; c < 4; c++)
            for (int r = 0; r < 4; r++)
                entry.transform[c * 4 + r] = node.transform(r, c);
        entries.push_back(entry);
    }
    for (const auto& child : node.children) {
        collect_meshes(child, entries);
    }
}

// --- Recursive glTF node builder ---

struct GltfBuildContext {
    json nodes_json = json::array();
    json meshes_json = json::array();
    json accessors_json = json::array();
    json buffer_views_json = json::array();
    json materials_json = json::array();
    std::vector<uint8_t> bin_buffer;

    // Track unique colors → material index
    std::map<uint32_t, int> color_to_material;
    int next_mesh_idx = 0;
};

static uint32_t color_key(const std::array<float, 3>& c) {
    uint32_t r = static_cast<uint32_t>(c[0] * 255) & 0xFF;
    uint32_t g = static_cast<uint32_t>(c[1] * 255) & 0xFF;
    uint32_t b = static_cast<uint32_t>(c[2] * 255) & 0xFF;
    return (r << 16) | (g << 8) | b;
}

static int get_or_create_material(GltfBuildContext& ctx, const std::optional<std::array<float, 3>>& color) {
    std::array<float, 3> c = color.value_or(std::array<float, 3>{0.8f, 0.8f, 0.8f});
    uint32_t key = color_key(c);

    auto it = ctx.color_to_material.find(key);
    if (it != ctx.color_to_material.end()) return it->second;

    int idx = static_cast<int>(ctx.materials_json.size());
    ctx.materials_json.push_back({
        {"name", "material_" + std::to_string(idx)},
        {"pbrMetallicRoughness", {
            {"baseColorFactor", {c[0], c[1], c[2], 1.0}},
            {"metallicFactor", 0.3},
            {"roughnessFactor", 0.35}
        }}
    });
    ctx.color_to_material[key] = idx;
    return idx;
}

static int add_mesh(GltfBuildContext& ctx, const TriMesh& mesh,
                    const std::optional<std::array<float, 3>>& color) {
    int meshIdx = ctx.next_mesh_idx++;
    int materialIdx = get_or_create_material(ctx, color);

    // --- Positions buffer view ---
    size_t posOffset = ctx.bin_buffer.size();
    float posMin[3] = {1e30f, 1e30f, 1e30f};
    float posMax[3] = {-1e30f, -1e30f, -1e30f};

    for (const auto& v : mesh.vertices) {
        float xyz[3] = {v.x(), v.y(), v.z()};
        append_bytes(ctx.bin_buffer, xyz, sizeof(xyz));
        for (int i = 0; i < 3; i++) {
            posMin[i] = std::min(posMin[i], xyz[i]);
            posMax[i] = std::max(posMax[i], xyz[i]);
        }
    }
    pad_to_4(ctx.bin_buffer, 0);
    size_t posSize = ctx.bin_buffer.size() - posOffset;

    int posBvIdx = static_cast<int>(ctx.buffer_views_json.size());
    ctx.buffer_views_json.push_back({
        {"buffer", 0},
        {"byteOffset", posOffset},
        {"byteLength", posSize},
        {"target", 34962}  // ARRAY_BUFFER
    });

    int posAccIdx = static_cast<int>(ctx.accessors_json.size());
    ctx.accessors_json.push_back({
        {"bufferView", posBvIdx},
        {"componentType", 5126},  // FLOAT
        {"count", mesh.vertices.size()},
        {"type", "VEC3"},
        {"min", {posMin[0], posMin[1], posMin[2]}},
        {"max", {posMax[0], posMax[1], posMax[2]}}
    });

    // --- Normals buffer view ---
    int normAccIdx = -1;
    if (mesh.normals && !mesh.normals->empty()) {
        size_t normOffset = ctx.bin_buffer.size();
        for (const auto& n : *mesh.normals) {
            float xyz[3] = {n.x(), n.y(), n.z()};
            append_bytes(ctx.bin_buffer, xyz, sizeof(xyz));
        }
        pad_to_4(ctx.bin_buffer, 0);
        size_t normSize = ctx.bin_buffer.size() - normOffset;

        int normBvIdx = static_cast<int>(ctx.buffer_views_json.size());
        ctx.buffer_views_json.push_back({
            {"buffer", 0},
            {"byteOffset", normOffset},
            {"byteLength", normSize},
            {"target", 34962}
        });

        normAccIdx = static_cast<int>(ctx.accessors_json.size());
        ctx.accessors_json.push_back({
            {"bufferView", normBvIdx},
            {"componentType", 5126},
            {"count", mesh.normals->size()},
            {"type", "VEC3"}
        });
    }

    // --- Indices buffer view ---
    size_t idxOffset = ctx.bin_buffer.size();
    uint32_t maxIdx = 0;
    for (const auto& tri : mesh.indices) {
        append_bytes(ctx.bin_buffer, tri.data(), sizeof(uint32_t) * 3);
        for (uint32_t idx : tri) maxIdx = std::max(maxIdx, idx);
    }
    pad_to_4(ctx.bin_buffer, 0);
    size_t idxSize = ctx.bin_buffer.size() - idxOffset;

    int idxBvIdx = static_cast<int>(ctx.buffer_views_json.size());
    ctx.buffer_views_json.push_back({
        {"buffer", 0},
        {"byteOffset", idxOffset},
        {"byteLength", idxSize},
        {"target", 34963}  // ELEMENT_ARRAY_BUFFER
    });

    int idxAccIdx = static_cast<int>(ctx.accessors_json.size());
    ctx.accessors_json.push_back({
        {"bufferView", idxBvIdx},
        {"componentType", 5125},  // UNSIGNED_INT
        {"count", mesh.indices.size() * 3},
        {"type", "SCALAR"},
        {"min", {0}},
        {"max", {maxIdx}}
    });

    // --- Mesh primitive ---
    json attributes = {{"POSITION", posAccIdx}};
    if (normAccIdx >= 0) attributes["NORMAL"] = normAccIdx;

    ctx.meshes_json.push_back({
        {"primitives", json::array({
            {
                {"attributes", attributes},
                {"indices", idxAccIdx},
                {"material", materialIdx}
            }
        })}
    });

    return meshIdx;
}

// Build glTF nodes recursively, matching assembly hierarchy.
// Node names use the hierarchy IDs so viewer entity IDs match.
static int build_gltf_nodes(GltfBuildContext& ctx, const AssemblyNode& node) {
    int nodeIdx = static_cast<int>(ctx.nodes_json.size());

    // Use node ID as the glTF node name (for viewer entity selection sync)
    json nodeJson = {{"name", node.id}};

    // Apply transform if not identity
    bool hasTransform = false;
    for (int i = 0; i < 4; i++)
        for (int j = 0; j < 4; j++)
            if (std::abs(node.transform(i, j) - (i == j ? 1.0f : 0.0f)) > 1e-6f)
                hasTransform = true;

    if (hasTransform) {
        // glTF expects column-major matrix
        json matrix = json::array();
        for (int c = 0; c < 4; c++)
            for (int r = 0; r < 4; r++)
                matrix.push_back(node.transform(r, c));
        nodeJson["matrix"] = matrix;
    }

    ctx.nodes_json.push_back(nodeJson);  // Reserve slot

    // Add mesh if this is a part
    if (node.is_part() && node.mesh && !node.mesh->empty()) {
        int meshIdx = add_mesh(ctx, *node.mesh, node.metadata.color);
        ctx.nodes_json[nodeIdx]["mesh"] = meshIdx;
    }

    // Recurse children
    if (!node.children.empty()) {
        json childIndices = json::array();
        for (const auto& child : node.children) {
            int childIdx = build_gltf_nodes(ctx, child);
            childIndices.push_back(childIdx);
        }
        ctx.nodes_json[nodeIdx]["children"] = childIndices;
    }

    return nodeIdx;
}

// --- Public entry point ---

std::vector<uint8_t> write_glb(const AssemblyNode& hierarchy) {
    GltfBuildContext ctx;

    // Build glTF node hierarchy
    int rootNodeIdx = build_gltf_nodes(ctx, hierarchy);

    // Assemble glTF JSON
    json gltf = {
        {"asset", {
            {"version", "2.0"},
            {"generator", "carbon-cad-engine"}
        }},
        {"scene", 0},
        {"scenes", json::array({
            {{"nodes", json::array({rootNodeIdx})}}
        })},
        {"nodes", ctx.nodes_json},
        {"meshes", ctx.meshes_json},
        {"accessors", ctx.accessors_json},
        {"bufferViews", ctx.buffer_views_json},
        {"materials", ctx.materials_json}
    };

    // Only add buffers if we have binary data
    if (!ctx.bin_buffer.empty()) {
        gltf["buffers"] = json::array({
            {{"byteLength", ctx.bin_buffer.size()}}
        });
    }

    // Serialize JSON to string
    std::string jsonStr = gltf.dump();

    // Pad JSON to 4-byte alignment (with spaces)
    while (jsonStr.size() % 4 != 0) jsonStr += ' ';

    // Build GLB binary
    std::vector<uint8_t> glb;
    size_t totalSize = 12 +                        // GLB header
                       8 + jsonStr.size() +         // JSON chunk
                       (ctx.bin_buffer.empty() ? 0 :
                       8 + align4(ctx.bin_buffer.size()));  // BIN chunk

    glb.reserve(totalSize);

    // GLB header
    write_u32(glb, GLB_MAGIC);
    write_u32(glb, GLB_VERSION);
    write_u32(glb, static_cast<uint32_t>(totalSize));

    // JSON chunk
    write_u32(glb, static_cast<uint32_t>(jsonStr.size()));
    write_u32(glb, GLB_CHUNK_JSON);
    append_bytes(glb, jsonStr.data(), jsonStr.size());

    // BIN chunk
    if (!ctx.bin_buffer.empty()) {
        size_t binPadded = align4(ctx.bin_buffer.size());
        write_u32(glb, static_cast<uint32_t>(binPadded));
        write_u32(glb, GLB_CHUNK_BIN);
        append_bytes(glb, ctx.bin_buffer.data(), ctx.bin_buffer.size());
        // Pad to 4-byte alignment with zeros
        while (glb.size() % 4 != 0) glb.push_back(0);
    }

    return glb;
}

// --- base64 encoder ---

static const char BASE64_CHARS[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const std::vector<uint8_t>& data) {
    std::string result;
    result.reserve(((data.size() + 2) / 3) * 4);

    size_t i = 0;
    while (i < data.size()) {
        uint32_t octet_a = i < data.size() ? data[i++] : 0;
        uint32_t octet_b = i < data.size() ? data[i++] : 0;
        uint32_t octet_c = i < data.size() ? data[i++] : 0;
        uint32_t triple = (octet_a << 16) | (octet_b << 8) | octet_c;

        result += BASE64_CHARS[(triple >> 18) & 0x3F];
        result += BASE64_CHARS[(triple >> 12) & 0x3F];
        result += (i > data.size() + 1) ? '=' : BASE64_CHARS[(triple >> 6) & 0x3F];
        result += (i > data.size()) ? '=' : BASE64_CHARS[triple & 0x3F];
    }

    return result;
}

} // namespace carbon
