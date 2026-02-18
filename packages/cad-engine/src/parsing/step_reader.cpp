#include "parsing/step_reader.h"
#include "parsing/tessellator.h"

// OCCT XCAF / XDE
#include <STEPCAFControl_Reader.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_Location.hxx>
#include <TDocStd_Document.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDataStd_Name.hxx>

// OCCT Fallback
#include <STEPControl_Reader.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Solid.hxx>

// OCCT geometry
#include <gp_Trsf.hxx>
#include <TopLoc_Location.hxx>
#include <Quantity_Color.hxx>

#include <algorithm>
#include <chrono>
#include <iostream>
#include <random>
#include <set>
#include <sstream>

namespace carbon {

// --- UUID generator (simple v4-like) ---

static std::string generate_uuid() {
    static std::mt19937 rng(std::random_device{}());
    static std::uniform_int_distribution<int> hex_dist(0, 15);
    static const char hex_chars[] = "0123456789abcdef";

    std::string uuid(36, '0');
    for (size_t i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            uuid[i] = '-';
        } else if (i == 14) {
            uuid[i] = '4'; // version 4
        } else if (i == 19) {
            uuid[i] = hex_chars[(hex_dist(rng) & 0x3) | 0x8]; // variant
        } else {
            uuid[i] = hex_chars[hex_dist(rng)];
        }
    }
    return uuid;
}

// --- Convert gp_Trsf to column-major Mat4 ---

static Mat4 trsf_to_mat4(const gp_Trsf& trsf) {
    Mat4 m = Mat4::Identity();
    for (int r = 0; r < 3; r++) {
        for (int c = 0; c < 3; c++) {
            m(r, c) = static_cast<float>(trsf.Value(r + 1, c + 1));
        }
    }
    m(0, 3) = static_cast<float>(trsf.TranslationPart().X());
    m(1, 3) = static_cast<float>(trsf.TranslationPart().Y());
    m(2, 3) = static_cast<float>(trsf.TranslationPart().Z());
    return m;
}

// --- Extract name from TDF_Label ---

static std::string get_label_name(const TDF_Label& label) {
    Handle(TDataStd_Name) nameAttr;
    if (label.FindAttribute(TDataStd_Name::GetID(), nameAttr)) {
        TCollection_ExtendedString ext = nameAttr->Get();
        std::string name;
        for (int i = 1; i <= ext.Length(); i++) {
            char c = static_cast<char>(ext.Value(i));
            name += c;
        }
        if (!name.empty()) return name;
    }
    return "";
}

// --- Extract color from XDE document ---

static std::optional<std::array<float, 3>> get_label_color(
    const Handle(XCAFDoc_ColorTool)& colorTool,
    const TDF_Label& label
) {
    Quantity_Color color;
    // Try surface color first, then generic color
    if (colorTool->GetColor(label, XCAFDoc_ColorSurf, color) ||
        colorTool->GetColor(label, XCAFDoc_ColorGen, color)) {
        return std::array<float, 3>{
            static_cast<float>(color.Red()),
            static_cast<float>(color.Green()),
            static_cast<float>(color.Blue())
        };
    }
    return std::nullopt;
}

// --- XCAF recursive tree builder ---

static void build_tree_xcaf(
    const Handle(XCAFDoc_ShapeTool)& shapeTool,
    const Handle(XCAFDoc_ColorTool)& colorTool,
    const TDF_Label& label,
    AssemblyNode& node,
    const ParseConfig& config,
    int depth,
    int& part_count,
    std::set<int>& visited
) {
    if (depth > config.max_depth) return;

    // Cycle detection via label tag
    int tag = label.Tag();
    if (visited.count(tag)) return;
    visited.insert(tag);

    node.id = generate_uuid();
    node.name = get_label_name(label);
    node.original_name = node.name;

    // Extract transform
    TopLoc_Location loc = shapeTool->GetLocation(label);
    if (!loc.IsIdentity()) {
        node.transform = trsf_to_mat4(loc.Transformation());
    }

    // Extract color
    if (config.extract_colors) {
        node.metadata.color = get_label_color(colorTool, label);
    }

    if (shapeTool->IsAssembly(label)) {
        node.node_type = NodeType::Assembly;

        TDF_LabelSequence components;
        shapeTool->GetComponents(label, components);

        for (int i = 1; i <= components.Length(); i++) {
            TDF_Label compLabel = components.Value(i);

            // Resolve reference to get the actual shape label
            TDF_Label refLabel;
            if (shapeTool->GetReferredShape(compLabel, refLabel)) {
                AssemblyNode child;

                // Instance name comes from the component (reference) label
                std::string instName = get_label_name(compLabel);
                // Shape name comes from the referred label
                std::string shapeName = get_label_name(refLabel);

                // Prefer instance name, fall back to shape name
                child.name = instName.empty() ? shapeName : instName;
                child.original_name = child.name;

                // Instance transform
                TopLoc_Location compLoc = shapeTool->GetLocation(compLabel);
                if (!compLoc.IsIdentity()) {
                    child.transform = trsf_to_mat4(compLoc.Transformation());
                }

                // Instance color (may override shape color)
                if (config.extract_colors) {
                    auto instColor = get_label_color(colorTool, compLabel);
                    if (instColor) {
                        child.metadata.color = instColor;
                    } else {
                        child.metadata.color = get_label_color(colorTool, refLabel);
                    }
                }

                // Recurse into the referred shape
                if (shapeTool->IsAssembly(refLabel)) {
                    child.node_type = NodeType::Assembly;
                    child.id = generate_uuid();

                    TDF_LabelSequence subComponents;
                    shapeTool->GetComponents(refLabel, subComponents);
                    for (int j = 1; j <= subComponents.Length(); j++) {
                        TDF_Label subLabel = subComponents.Value(j);
                        TDF_Label subRef;
                        AssemblyNode grandChild;
                        if (shapeTool->GetReferredShape(subLabel, subRef)) {
                            build_tree_xcaf(shapeTool, colorTool, subRef,
                                          grandChild, config, depth + 1,
                                          part_count, visited);
                            // Apply instance transform
                            TopLoc_Location subLoc = shapeTool->GetLocation(subLabel);
                            if (!subLoc.IsIdentity()) {
                                grandChild.transform = trsf_to_mat4(subLoc.Transformation());
                            }
                            std::string subInstName = get_label_name(subLabel);
                            if (!subInstName.empty()) {
                                grandChild.name = subInstName;
                                grandChild.original_name = subInstName;
                            }
                        } else {
                            build_tree_xcaf(shapeTool, colorTool, subLabel,
                                          grandChild, config, depth + 1,
                                          part_count, visited);
                        }
                        child.children.push_back(std::move(grandChild));
                    }
                } else {
                    // It's a part — tessellate
                    child.node_type = NodeType::Part;
                    child.id = generate_uuid();
                    TopoDS_Shape shape = shapeTool->GetShape(refLabel);
                    if (!shape.IsNull()) {
                        child.mesh = tessellate_shape(shape,
                                                      config.linear_deflection,
                                                      config.angular_deflection);
                        if (child.mesh && !child.mesh->empty()) {
                            child.bounding_box = child.mesh->local_aabb();
                            part_count++;
                        }
                    }
                }

                // Flatten single-child assemblies (XCAF often wraps each instance)
                if (child.is_assembly() && child.children.size() == 1) {
                    auto& only = child.children[0];
                    // Preserve the instance name but adopt the child's content
                    std::string savedName = child.name;
                    Mat4 savedTransform = child.transform;
                    auto savedColor = child.metadata.color;
                    child = std::move(only);
                    if (!savedName.empty()) {
                        child.name = savedName;
                        child.original_name = savedName;
                    }
                    // Compose transforms
                    child.transform = savedTransform * child.transform;
                    if (!child.metadata.color && savedColor) {
                        child.metadata.color = savedColor;
                    }
                }

                node.children.push_back(std::move(child));
            } else {
                // No reference — direct child
                AssemblyNode child;
                build_tree_xcaf(shapeTool, colorTool, compLabel,
                              child, config, depth + 1, part_count, visited);
                node.children.push_back(std::move(child));
            }
        }

        // Give unnamed assembly a default name
        if (node.name.empty()) {
            node.name = "Assembly";
        }
    } else {
        // Part (leaf shape)
        node.node_type = NodeType::Part;
        TopoDS_Shape shape = shapeTool->GetShape(label);
        if (!shape.IsNull()) {
            node.mesh = tessellate_shape(shape,
                                         config.linear_deflection,
                                         config.angular_deflection);
            if (node.mesh && !node.mesh->empty()) {
                node.bounding_box = node.mesh->local_aabb();
                part_count++;
            }
        }
        if (node.name.empty()) {
            node.name = "Part_" + std::to_string(part_count);
        }
    }

    visited.erase(tag);
}

// --- Stage 1: XCAF parsing ---

static ParseResult parse_xcaf(const std::string& file_path, const ParseConfig& config) {
    ParseResult result;

    Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
    Handle(TDocStd_Document) doc;
    app->NewDocument("MDTV-XCAF", doc);

    STEPCAFControl_Reader reader;
    reader.SetColorMode(config.extract_colors);
    reader.SetNameMode(true);
    reader.SetLayerMode(false);

    IFSelect_ReturnStatus status = reader.ReadFile(file_path.c_str());
    if (status != IFSelect_RetDone) {
        result.error = "XCAF: Failed to read STEP file (status: " +
                       std::to_string(static_cast<int>(status)) + ")";
        app->Close(doc);
        return result;
    }

    if (!reader.Transfer(doc)) {
        result.error = "XCAF: Transfer failed";
        app->Close(doc);
        return result;
    }

    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(doc->Main());

    TDF_LabelSequence freeShapes;
    shapeTool->GetFreeShapes(freeShapes);

    if (freeShapes.Length() == 0) {
        result.error = "XCAF: No shapes found in STEP file";
        app->Close(doc);
        return result;
    }

    int part_count = 0;
    std::set<int> visited;

    if (freeShapes.Length() == 1) {
        // Single root — use it directly
        build_tree_xcaf(shapeTool, colorTool, freeShapes.Value(1),
                       result.hierarchy, config, 0, part_count, visited);
    } else {
        // Multiple free shapes — wrap in a root assembly
        result.hierarchy.id = generate_uuid();
        result.hierarchy.name = "Assembly";
        result.hierarchy.original_name = "Assembly";
        result.hierarchy.node_type = NodeType::Assembly;

        for (int i = 1; i <= freeShapes.Length(); i++) {
            AssemblyNode child;
            build_tree_xcaf(shapeTool, colorTool, freeShapes.Value(i),
                           child, config, 0, part_count, visited);
            result.hierarchy.children.push_back(std::move(child));
        }
    }

    result.part_count = part_count;
    result.success = (part_count > 0);

    app->Close(doc);
    return result;
}

// --- Stage 2: Simple fallback parser ---

static ParseResult parse_simple(const std::string& file_path, const ParseConfig& config) {
    ParseResult result;

    STEPControl_Reader reader;
    IFSelect_ReturnStatus status = reader.ReadFile(file_path.c_str());
    if (status != IFSelect_RetDone) {
        result.error = "Simple: Failed to read STEP file (status: " +
                       std::to_string(static_cast<int>(status)) + ")";
        return result;
    }

    reader.TransferRoots();
    TopoDS_Shape shape = reader.OneShape();

    if (shape.IsNull()) {
        result.error = "Simple: No shapes transferred";
        return result;
    }

    result.hierarchy.id = generate_uuid();
    result.hierarchy.name = "Assembly";
    result.hierarchy.original_name = "Assembly";
    result.hierarchy.node_type = NodeType::Assembly;

    int part_idx = 0;
    for (TopExp_Explorer exp(shape, TopAbs_SOLID); exp.More(); exp.Next()) {
        const TopoDS_Solid& solid = TopoDS::Solid(exp.Current());
        part_idx++;

        AssemblyNode child;
        child.id = generate_uuid();
        child.name = "Part_" + std::to_string(part_idx);
        child.original_name = child.name;
        child.node_type = NodeType::Part;

        child.mesh = tessellate_shape(solid,
                                      config.linear_deflection,
                                      config.angular_deflection);
        if (child.mesh && !child.mesh->empty()) {
            child.bounding_box = child.mesh->local_aabb();
        }

        result.hierarchy.children.push_back(std::move(child));
    }

    result.part_count = part_idx;
    result.success = (part_idx > 0);

    // If single-child root, flatten
    if (result.hierarchy.children.size() == 1) {
        auto child = std::move(result.hierarchy.children[0]);
        result.hierarchy = std::move(child);
    }

    return result;
}

// --- Public entry point ---

ParseResult parse_step_file(const std::string& file_path, const ParseConfig& config) {
    auto start = std::chrono::high_resolution_clock::now();

    // Stage 1: Try XCAF (full assembly structure, names, colors)
    ParseResult result;
    try {
        result = parse_xcaf(file_path, config);
    } catch (const std::exception& e) {
        std::cerr << "[step_reader] XCAF parsing threw: " << e.what() << std::endl;
        result.success = false;
        result.error = std::string("XCAF exception: ") + e.what();
    } catch (...) {
        std::cerr << "[step_reader] XCAF parsing threw unknown exception" << std::endl;
        result.success = false;
        result.error = "XCAF: unknown exception";
    }

    // Stage 2: Fallback to simple parser if XCAF failed
    if (!result.success) {
        std::cerr << "[step_reader] XCAF failed (" << result.error
                  << "), trying simple parser..." << std::endl;
        try {
            result = parse_simple(file_path, config);
        } catch (const std::exception& e) {
            result.success = false;
            result.error = std::string("Simple parser exception: ") + e.what();
        } catch (...) {
            result.success = false;
            result.error = "Simple parser: unknown exception";
        }
    }

    auto end = std::chrono::high_resolution_clock::now();
    result.parse_time_ms = std::chrono::duration<double, std::milli>(end - start).count();

    std::cout << "[step_reader] Parsed " << file_path
              << " → " << result.part_count << " parts in "
              << result.parse_time_ms << "ms" << std::endl;

    return result;
}

} // namespace carbon
