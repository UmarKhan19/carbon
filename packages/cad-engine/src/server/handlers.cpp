#include "server/handlers.h"
#include "geometry/types.h"
#include "parsing/step_reader.h"
#include "export/glb_writer.h"
#include "simulator/simulator.h"

#include <nlohmann/json.hpp>
#include <iostream>
#include <chrono>
#include <fstream>
#include <filesystem>
#include <unordered_map>

using json = nlohmann::json;

namespace carbon {

// --- AssemblyNode → JSON serialization ---

static json node_to_json(const AssemblyNode& node) {
    json j;
    j["id"] = node.id;
    j["name"] = node.name;
    j["original_name"] = node.original_name;
    j["node_type"] = node.is_part() ? "Part" : "Assembly";

    // Transform as column-major 16-float array
    json transform = json::array();
    for (int c = 0; c < 4; c++)
        for (int r = 0; r < 4; r++)
            transform.push_back(node.transform(r, c));
    j["transform"] = transform;

    // Bounding box
    if (node.bounding_box) {
        j["bounding_box"] = {
            {"min", {node.bounding_box->min.x(), node.bounding_box->min.y(), node.bounding_box->min.z()}},
            {"max", {node.bounding_box->max.x(), node.bounding_box->max.y(), node.bounding_box->max.z()}}
        };
    }

    // Mesh stats (don't send raw mesh data over JSON)
    if (node.mesh && !node.mesh->empty()) {
        j["mesh_stats"] = {
            {"vertices", node.mesh->vertex_count()},
            {"triangles", node.mesh->triangle_count()}
        };
    }

    // Metadata
    json meta;
    if (node.metadata.color) {
        meta["color"] = {(*node.metadata.color)[0], (*node.metadata.color)[1], (*node.metadata.color)[2]};
    }
    if (node.metadata.material) meta["material"] = *node.metadata.material;
    if (node.metadata.part_number) meta["part_number"] = *node.metadata.part_number;
    if (node.metadata.mass) meta["mass"] = *node.metadata.mass;
    if (node.metadata.volume) meta["volume"] = *node.metadata.volume;
    if (node.metadata.surface_area) meta["surface_area"] = *node.metadata.surface_area;
    if (node.metadata.center_of_gravity) {
        auto& cog = *node.metadata.center_of_gravity;
        meta["center_of_gravity"] = {cog[0], cog[1], cog[2]};
    }
    j["metadata"] = meta;

    // Children
    json children_arr = json::array();
    for (const auto& child : node.children) {
        children_arr.push_back(node_to_json(child));
    }
    j["children"] = children_arr;

    return j;
}

// --- SimulationResult → JSON serialization ---

static json simulation_result_to_json(const SimulationResult& result) {
    json steps_arr = json::array();
    for (const auto& step : result.steps) {
        json step_json;
        step_json["step_number"] = step.step_number;
        step_json["part_ids"] = step.part_ids;
        step_json["part_names"] = step.part_names;
        step_json["assembly_direction"] = step.assembly_direction;
        step_json["suggested_duration_ms"] = step.suggested_duration_ms;

        if (step.motion_type) step_json["motion_type"] = *step.motion_type;
        if (step.min_clearance) step_json["min_clearance"] = *step.min_clearance;
        if (step.planner_score) step_json["planner_score"] = *step.planner_score;

        // Animation path: array of keyframes with column-major 4x4 transform
        json anim = json::array();
        for (const auto& kf : step.animation_path) {
            json transform = json::array();
            for (int c = 0; c < 4; c++)
                for (int r = 0; r < 4; r++)
                    transform.push_back(kf.transform(r, c));
            anim.push_back({{"time", kf.time}, {"transform", transform}});
        }
        step_json["animation_path"] = anim;

        steps_arr.push_back(step_json);
    }

    json issues_arr = json::array();
    for (const auto& issue : result.issues) {
        json issue_json;
        switch (issue.kind) {
            case SimulationIssueKind::Overlap:            issue_json["kind"] = "overlap"; break;
            case SimulationIssueKind::Clearance:          issue_json["kind"] = "clearance"; break;
            case SimulationIssueKind::PathNotFound:       issue_json["kind"] = "path_not_found"; break;
            case SimulationIssueKind::ConstraintConflict: issue_json["kind"] = "constraint_conflict"; break;
        }
        issue_json["severity"] = (issue.severity == SimulationIssueSeverity::Error) ? "error" : "warning";
        issue_json["part_ids"] = issue.part_ids;
        issue_json["message"] = issue.message;
        if (issue.metrics_json) {
            try { issue_json["metrics"] = json::parse(*issue.metrics_json); }
            catch (...) { issue_json["metrics"] = nullptr; }
        }
        issues_arr.push_back(issue_json);
    }

    json j;
    j["steps"] = steps_arr;
    j["stuck_parts"] = result.stuck_parts;
    j["simulation_time_ms"] = result.simulation_time_ms;
    j["success"] = result.success;
    j["error"] = result.error ? json(*result.error) : json(nullptr);
    j["issues"] = issues_arr;

    if (result.planner_stats) {
        j["planner_stats"] = {
            {"contact_edges", result.planner_stats->contact_edges},
            {"dependency_edges", result.planner_stats->dependency_edges},
            {"candidate_paths_evaluated", result.planner_stats->candidate_paths_evaluated},
            {"collision_checks", result.planner_stats->collision_checks},
            {"overlap_issue_count", result.planner_stats->overlap_issue_count},
            {"blocking_matrix_skips", result.planner_stats->blocking_matrix_skips}
        };
    }

    // Identical geometry groups
    json groups = json::array();
    for (const auto& group : result.identical_groups) groups.push_back(group);
    j["identical_groups"] = groups;

    // Suggested subassemblies
    json subs = json::array();
    for (const auto& sub : result.suggested_subassemblies) {
        subs.push_back({{"name", sub.name}, {"part_ids", sub.part_ids}, {"confidence", sub.confidence}});
    }
    j["suggested_subassemblies"] = subs;

    // Fastener kits
    json kits = json::array();
    for (const auto& kit : result.kits) {
        kits.push_back({{"primary", kit.primary}, {"accessories", kit.accessories}});
    }
    j["kits"] = kits;

    return j;
}

// --- JSON → AssemblyNode deserialization ---

static AssemblyNode json_to_assembly_node(const json& j) {
    AssemblyNode node;
    node.id = j.value("id", "");
    node.name = j.value("name", "");
    node.original_name = j.value("original_name", node.name);

    std::string nt = j.value("node_type", "part");
    if (nt == "assembly" || nt == "Assembly") {
        node.node_type = NodeType::Assembly;
    } else {
        node.node_type = NodeType::Part;
    }

    // Transform: 16-element column-major array
    if (j.contains("transform") && j["transform"].is_array() && j["transform"].size() == 16) {
        for (int c = 0; c < 4; c++)
            for (int r = 0; r < 4; r++)
                node.transform(r, c) = j["transform"][c * 4 + r].get<float>();
    }

    // Children
    if (j.contains("children") && j["children"].is_array()) {
        for (const auto& child : j["children"]) {
            node.children.push_back(json_to_assembly_node(child));
        }
    }

    return node;
}

// --- base64 decode ---

static std::vector<uint8_t> base64_decode(const std::string& encoded) {
    static const int DECODE_TABLE[256] = {
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
        52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,
        -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
        15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
        -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
        41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    };

    std::vector<uint8_t> result;
    result.reserve(encoded.size() * 3 / 4);

    uint32_t buf = 0;
    int bits = 0;
    for (char c : encoded) {
        if (c == '=' || c == '\n' || c == '\r' || c == ' ') continue;
        int val = DECODE_TABLE[static_cast<uint8_t>(c)];
        if (val < 0) continue;
        buf = (buf << 6) | val;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result.push_back(static_cast<uint8_t>((buf >> bits) & 0xFF));
        }
    }
    return result;
}

// --- GLB reader: extract meshes by node ID ---

static uint32_t read_u32_le(const uint8_t* p) {
    return static_cast<uint32_t>(p[0])
         | (static_cast<uint32_t>(p[1]) << 8)
         | (static_cast<uint32_t>(p[2]) << 16)
         | (static_cast<uint32_t>(p[3]) << 24);
}

static std::unordered_map<std::string, TriMesh> read_glb_meshes(const std::vector<uint8_t>& glb) {
    std::unordered_map<std::string, TriMesh> meshes;

    if (glb.size() < 12) return meshes;

    // GLB header: magic(4) + version(4) + length(4)
    uint32_t magic = read_u32_le(&glb[0]);
    if (magic != 0x46546C67) return meshes;  // "glTF"

    // JSON chunk
    if (glb.size() < 20) return meshes;
    uint32_t json_len = read_u32_le(&glb[12]);
    uint32_t json_type = read_u32_le(&glb[16]);
    if (json_type != 0x4E4F534A) return meshes;  // "JSON"
    if (glb.size() < 20 + json_len) return meshes;

    std::string json_str(reinterpret_cast<const char*>(&glb[20]), json_len);
    auto gltf = json::parse(json_str);

    // BIN chunk
    const uint8_t* bin_data = nullptr;
    size_t bin_size = 0;
    size_t bin_offset = 20 + json_len;
    if (glb.size() >= bin_offset + 8) {
        uint32_t bin_len = read_u32_le(&glb[bin_offset]);
        uint32_t bin_type = read_u32_le(&glb[bin_offset + 4]);
        if (bin_type == 0x004E4942 && glb.size() >= bin_offset + 8 + bin_len) {  // "BIN\0"
            bin_data = &glb[bin_offset + 8];
            bin_size = bin_len;
        }
    }

    if (!bin_data || !gltf.contains("nodes")) return meshes;

    auto& nodes = gltf["nodes"];
    auto gltf_meshes = gltf.value("meshes", json::array());
    auto accessors = gltf.value("accessors", json::array());
    auto buffer_views = gltf.value("bufferViews", json::array());

    for (const auto& node : nodes) {
        if (!node.contains("name") || !node.contains("mesh")) continue;

        std::string node_id = node["name"].get<std::string>();
        int mesh_idx = node["mesh"].get<int>();
        if (mesh_idx < 0 || mesh_idx >= static_cast<int>(gltf_meshes.size())) continue;

        auto& primitives = gltf_meshes[mesh_idx]["primitives"];
        if (primitives.empty()) continue;
        auto& prim = primitives[0];

        TriMesh tri;

        // Read POSITION accessor
        if (prim.contains("attributes") && prim["attributes"].contains("POSITION")) {
            int pos_acc_idx = prim["attributes"]["POSITION"].get<int>();
            if (pos_acc_idx >= 0 && pos_acc_idx < static_cast<int>(accessors.size())) {
                auto& acc = accessors[pos_acc_idx];
                int bv_idx = acc["bufferView"].get<int>();
                size_t count = acc["count"].get<size_t>();

                if (bv_idx >= 0 && bv_idx < static_cast<int>(buffer_views.size())) {
                    auto& bv = buffer_views[bv_idx];
                    size_t offset = bv["byteOffset"].get<size_t>();
                    if (offset + count * 12 <= bin_size) {
                        const float* pos = reinterpret_cast<const float*>(bin_data + offset);
                        tri.vertices.reserve(count);
                        for (size_t i = 0; i < count; i++) {
                            tri.vertices.emplace_back(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
                        }
                    }
                }
            }
        }

        // Read INDICES accessor
        if (prim.contains("indices")) {
            int idx_acc_idx = prim["indices"].get<int>();
            if (idx_acc_idx >= 0 && idx_acc_idx < static_cast<int>(accessors.size())) {
                auto& acc = accessors[idx_acc_idx];
                int bv_idx = acc["bufferView"].get<int>();
                size_t count = acc["count"].get<size_t>();

                if (bv_idx >= 0 && bv_idx < static_cast<int>(buffer_views.size())) {
                    auto& bv = buffer_views[bv_idx];
                    size_t offset = bv["byteOffset"].get<size_t>();
                    size_t tri_count = count / 3;
                    if (offset + count * 4 <= bin_size) {
                        const uint32_t* idx = reinterpret_cast<const uint32_t*>(bin_data + offset);
                        tri.indices.reserve(tri_count);
                        for (size_t i = 0; i < tri_count; i++) {
                            tri.indices.push_back({idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2]});
                        }
                    }
                }
            }
        }

        if (!tri.empty()) {
            meshes[node_id] = std::move(tri);
        }
    }

    return meshes;
}

/// Recursively attach meshes from the GLB to assembly tree nodes by ID.
static void attach_glb_meshes(AssemblyNode& node,
                               const std::unordered_map<std::string, TriMesh>& meshes) {
    auto it = meshes.find(node.id);
    if (it != meshes.end()) {
        node.mesh = it->second;
        node.bounding_box = it->second.local_aabb();
    }
    for (auto& child : node.children) {
        attach_glb_meshes(child, meshes);
    }
}

// --- Helper: save uploaded data to temp file ---

static std::string save_to_temp(const std::string& data, const std::string& suffix) {
    auto tmp = std::filesystem::temp_directory_path() /
               ("cad_engine_" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + suffix);
    std::ofstream ofs(tmp, std::ios::binary);
    ofs.write(data.data(), data.size());
    ofs.close();
    return tmp.string();
}

void add_cors_headers(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "*");
}

void handle_health(httplib::Response& res) {
    json response = {
        {"status", "ok"},
        {"version", "1.0.0"},
        {"engine", "carbon-cad-engine-cpp"}
    };
    res.set_content(response.dump(), "application/json");
}

void handle_parse(const httplib::Request& req, httplib::Response& res) {
    auto start = std::chrono::steady_clock::now();

    try {
        // Extract STEP file from multipart form data
        if (!req.has_file("file")) {
            json response = {
                {"success", false},
                {"error", "Missing 'file' in multipart form data"},
                {"hierarchy", nullptr},
                {"glb_base64", nullptr},
                {"part_count", 0}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        auto file = req.get_file_value("file");
        std::string tmp_path = save_to_temp(file.content, ".step");

        std::cout << "[handler] Parsing STEP file: " << file.filename
                  << " (" << file.content.size() << " bytes)" << std::endl;

        // Parse STEP file
        ParseConfig config;
        ParseResult result = parse_step_file(tmp_path, config);

        // Clean up temp file
        std::filesystem::remove(tmp_path);

        if (!result.success) {
            json response = {
                {"success", false},
                {"error", result.error},
                {"hierarchy", nullptr},
                {"glb_base64", nullptr},
                {"part_count", 0},
                {"parse_time_ms", result.parse_time_ms}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        // Generate GLB
        auto glb_data = write_glb(result.hierarchy);
        std::string glb_b64 = base64_encode(glb_data);

        auto elapsed = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - start
        ).count();

        json response = {
            {"success", true},
            {"hierarchy", node_to_json(result.hierarchy)},
            {"glb_base64", glb_b64},
            {"part_count", result.part_count},
            {"parse_time_ms", result.parse_time_ms},
            {"total_time_ms", elapsed},
            {"error", nullptr}
        };
        res.set_content(response.dump(), "application/json");

        std::cout << "[handler] Parse complete: " << result.part_count
                  << " parts, GLB " << (glb_data.size() / 1024) << "KB"
                  << ", " << elapsed << "ms total" << std::endl;

    } catch (const std::exception& e) {
        json response = {
            {"success", false},
            {"error", std::string("Parse exception: ") + e.what()},
            {"hierarchy", nullptr},
            {"glb_base64", nullptr},
            {"part_count", 0}
        };
        res.set_content(response.dump(), "application/json");
    }
}

void handle_simulate(const httplib::Request& req, httplib::Response& res) {
    auto start = std::chrono::steady_clock::now();

    try {
        auto body = json::parse(req.body);

        // Validate required fields
        if (!body.contains("assembly_tree")) {
            json response = {
                {"success", false},
                {"error", "Missing 'assembly_tree' field"},
                {"result", nullptr}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        // 1. Deserialize assembly tree from JSON
        auto tree = json_to_assembly_node(body["assembly_tree"]);

        // 2. Load meshes from GLB (base64-encoded)
        if (!body.contains("glb_base64") || !body["glb_base64"].is_string()) {
            json response = {
                {"success", false},
                {"error", "Missing or invalid 'glb_base64' field"},
                {"result", nullptr}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        auto glb_bytes = base64_decode(body["glb_base64"].get<std::string>());
        auto mesh_map = read_glb_meshes(glb_bytes);
        attach_glb_meshes(tree, mesh_map);

        std::cout << "[handler] /simulate: " << mesh_map.size() << " meshes loaded from GLB" << std::endl;

        // 3. Run simulation
        AssemblySimulator sim;
        sim.load_assembly(tree);
        auto sim_result = sim.simulate();

        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start
        ).count();

        std::cout << "[handler] /simulate complete: " << sim_result.steps.size()
                  << " steps, " << sim_result.stuck_parts.size() << " stuck, "
                  << elapsed << "ms" << std::endl;

        // 4. Serialize result
        json response = {
            {"success", true},
            {"result", simulation_result_to_json(sim_result)},
            {"error", nullptr}
        };
        res.set_content(response.dump(), "application/json");

    } catch (const json::exception& e) {
        json response = {
            {"success", false},
            {"error", std::string("JSON parse error: ") + e.what()},
            {"result", nullptr}
        };
        res.set_content(response.dump(), "application/json");
    } catch (const std::exception& e) {
        json response = {
            {"success", false},
            {"error", std::string("Simulation error: ") + e.what()},
            {"result", nullptr}
        };
        res.set_content(response.dump(), "application/json");
    }
}

void handle_parse_and_simulate(const httplib::Request& req, httplib::Response& res) {
    auto start = std::chrono::steady_clock::now();

    try {
        // Extract STEP file from multipart form data
        if (!req.has_file("file")) {
            json response = {
                {"success", false},
                {"error", "Missing 'file' in multipart form data"},
                {"hierarchy", nullptr},
                {"glb_base64", nullptr},
                {"simulation_result", nullptr}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        auto file = req.get_file_value("file");
        std::string tmp_path = save_to_temp(file.content, ".step");

        // 1. Parse STEP file
        ParseConfig config;
        ParseResult parse_result = parse_step_file(tmp_path, config);
        std::filesystem::remove(tmp_path);

        if (!parse_result.success) {
            json response = {
                {"success", false},
                {"error", parse_result.error},
                {"hierarchy", nullptr},
                {"glb_base64", nullptr},
                {"simulation_result", nullptr}
            };
            res.set_content(response.dump(), "application/json");
            return;
        }

        // 2. Generate GLB
        auto glb_data = write_glb(parse_result.hierarchy);
        std::string glb_b64 = base64_encode(glb_data);

        // 3. Run simulation (parsed hierarchy already has meshes from STEP reader)
        std::cout << "[handler] /parse-and-simulate: running simulator..." << std::endl;
        AssemblySimulator sim;
        sim.load_assembly(parse_result.hierarchy);
        auto sim_result_obj = sim.simulate();
        json sim_result = simulation_result_to_json(sim_result_obj);

        std::cout << "[handler] /parse-and-simulate simulation: "
                  << sim_result_obj.steps.size() << " steps, "
                  << sim_result_obj.stuck_parts.size() << " stuck" << std::endl;

        auto elapsed = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - start
        ).count();

        json response = {
            {"success", true},
            {"hierarchy", node_to_json(parse_result.hierarchy)},
            {"glb_base64", glb_b64},
            {"simulation_result", sim_result},
            {"part_count", parse_result.part_count},
            {"parse_time_ms", parse_result.parse_time_ms},
            {"total_time_ms", elapsed},
            {"error", nullptr}
        };
        res.set_content(response.dump(), "application/json");

    } catch (const std::exception& e) {
        json response = {
            {"success", false},
            {"error", std::string("Parse-and-simulate exception: ") + e.what()},
            {"hierarchy", nullptr},
            {"glb_base64", nullptr},
            {"simulation_result", nullptr}
        };
        res.set_content(response.dump(), "application/json");
    }
}

} // namespace carbon
