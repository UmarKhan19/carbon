#include <gtest/gtest.h>
#include "classification/part_classifier.h"
#include "parsing/brep_analysis_types.h"
#include "test_helpers.h"

using namespace carbon;

// --- Port of sequence.rs tests ---

TEST(Classifier, FastenerClassificationByName) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "M6x20_Socket_Head_Screw";
    input.bbox_dims = Vec3(0.006f, 0.006f, 0.020f);
    input.relative_volume = 0.001f;
    input.contact_degree = 2;

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.fastener_score, 0.5f);  // name match alone gives exactly 0.5
    EXPECT_EQ(cls.dominant(), PartKind::Fastener);
}

TEST(Classifier, StructuralClassificationByName) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "Main_Frame_Assembly";
    input.bbox_dims = Vec3(100.0f, 50.0f, 200.0f);
    input.relative_volume = 0.6f;
    input.contact_degree = 8;

    auto cls = classify_part(input, rules);
    EXPECT_GT(cls.structural_score, 0.5f);
    EXPECT_EQ(cls.dominant(), PartKind::Structural);
}

TEST(Classifier, GeometricClassificationWithoutName) {
    SequencingRules rules;

    // Small elongated part → fastener-like
    ClassificationInput small_input;
    small_input.name = "Part_001";
    small_input.bbox_dims = Vec3(0.004f, 0.004f, 0.02f);
    small_input.relative_volume = 0.001f;
    small_input.contact_degree = 1;

    // Large high-contact → structural-like
    ClassificationInput large_input;
    large_input.name = "Part_002";
    large_input.bbox_dims = Vec3(80.0f, 40.0f, 100.0f);
    large_input.relative_volume = 0.5f;
    large_input.contact_degree = 6;

    auto fast_cls = classify_part(small_input, rules);
    auto struct_cls = classify_part(large_input, rules);

    EXPECT_GT(fast_cls.fastener_score, struct_cls.fastener_score);
    EXPECT_GT(struct_cls.structural_score, fast_cls.structural_score);
}

TEST(Classifier, PanelClassification) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "Cover_Plate";
    input.bbox_dims = Vec3(100.0f, 100.0f, 2.0f);
    input.relative_volume = 0.05f;
    input.contact_degree = 3;

    auto cls = classify_part(input, rules);
    EXPECT_GT(cls.panel_score, 0.4f);
}

TEST(Classifier, InferPartKindByName) {
    SequencingRules rules;

    ClassificationInput bolt_input;
    bolt_input.name = "M6_BOLT";
    bolt_input.bbox_dims = Vec3(0.006f, 0.006f, 0.02f);
    bolt_input.relative_volume = 0.001f;
    auto bolt_cls = classify_part(bolt_input, rules);
    EXPECT_EQ(infer_part_kind("M6_BOLT", bolt_cls, rules), PartKind::Fastener);

    ClassificationInput frame_input;
    frame_input.name = "MAIN_FRAME";
    frame_input.bbox_dims = Vec3(100.0f, 50.0f, 200.0f);
    frame_input.relative_volume = 0.6f;
    frame_input.contact_degree = 8;
    auto frame_cls = classify_part(frame_input, rules);
    EXPECT_EQ(infer_part_kind("MAIN_FRAME", frame_cls, rules), PartKind::Structural);

    ClassificationInput panel_input;
    panel_input.name = "BACK_PANEL";
    panel_input.bbox_dims = Vec3(100.0f, 100.0f, 2.0f);
    panel_input.relative_volume = 0.05f;
    auto panel_cls = classify_part(panel_input, rules);
    EXPECT_EQ(infer_part_kind("BACK_PANEL", panel_cls, rules), PartKind::Panel);
}

TEST(Classifier, IsFastenerThresholdInclusive) {
    // A name match gives 0.5 → at threshold 0.5 should be dominant
    SequencingRules rules;
    ClassificationInput input;
    input.name = "bolt_generic";
    input.bbox_dims = Vec3(1, 1, 1);
    input.relative_volume = 0.1f;

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.fastener_score, 0.5f);
    EXPECT_EQ(cls.dominant(), PartKind::Fastener);
}

TEST(Classifier, PriorityOrder) {
    SequencingRules rules;

    // Fastener
    PartClassification fast_cls;
    fast_cls.fastener_score = 0.8f;
    float fast_priority = disassembly_priority(PartKind::Fastener, fast_cls);

    // Unknown (neutral)
    PartClassification unknown_cls;
    float unknown_priority = disassembly_priority(PartKind::Unknown, unknown_cls);

    // Structural (remove last)
    PartClassification struct_cls;
    struct_cls.structural_score = 0.8f;
    float struct_priority = disassembly_priority(PartKind::Structural, struct_cls);

    // Fastener > Unknown > Structural
    EXPECT_GT(fast_priority, unknown_priority);
    EXPECT_GT(unknown_priority, struct_priority);
}

TEST(Classifier, ClassifyAllPartsBatch) {
    SequencingRules rules;
    std::vector<std::pair<std::string, ClassificationInput>> parts;

    ClassificationInput bolt;
    bolt.name = "M8_Bolt";
    bolt.bbox_dims = Vec3(0.008f, 0.008f, 0.025f);
    bolt.relative_volume = 0.001f;
    parts.push_back({"bolt_1", bolt});

    ClassificationInput frame;
    frame.name = "Base_Frame";
    frame.bbox_dims = Vec3(100.0f, 50.0f, 200.0f);
    frame.relative_volume = 0.6f;
    frame.contact_degree = 6;
    parts.push_back({"frame_1", frame});

    auto results = classify_all_parts(parts, rules);
    EXPECT_EQ(results.size(), 2u);
    EXPECT_GT(results["bolt_1"].fastener_score, 0.3f);
    EXPECT_GT(results["frame_1"].structural_score, 0.3f);
}

// ===========================================================================
// BRep-based classification tests (opaque STEP names)
// ===========================================================================

TEST(Classifier, BRepFastenerWithThreads) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "=>[0:1:1:5]";  // opaque STEP name — no name match
    input.bbox_dims = Vec3(6.0f, 6.0f, 20.0f);
    input.relative_volume = 0.001f;
    input.contact_degree = 2;

    BRepAnalysis brep;
    brep.has_threads = true;
    brep.cylindrical_surface_ratio = 0.7;
    brep.planar_surface_ratio = 0.1;
    brep.total_faces = 8;
    brep.cylindrical_faces = 5;
    brep.planar_faces = 3;
    brep.volume = 500.0;
    input.brep = brep;

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.fastener_score, 0.5f);
    EXPECT_EQ(cls.dominant(), PartKind::Fastener);
}

TEST(Classifier, BRepStructuralLargeVolume) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "=>[0:1:1:1]";  // opaque name
    input.bbox_dims = Vec3(100.0f, 50.0f, 200.0f);
    input.relative_volume = 0.40f;
    input.contact_degree = 5;

    BRepAnalysis brep;
    brep.volume = 500000.0;
    brep.planar_surface_ratio = 0.6;
    brep.total_faces = 30;
    brep.planar_faces = 18;
    brep.cylindrical_faces = 8;
    brep.conical_faces = 2;
    brep.freeform_faces = 2;
    input.brep = brep;

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.structural_score, 0.4f);
    EXPECT_EQ(cls.dominant(), PartKind::Structural);
}

TEST(Classifier, BRepPanelFlatPlanar) {
    SequencingRules rules;
    ClassificationInput input;
    input.name = "=>[0:1:1:10]";  // opaque name
    input.bbox_dims = Vec3(100.0f, 100.0f, 2.0f);
    input.relative_volume = 0.05f;
    input.contact_degree = 3;

    BRepAnalysis brep;
    brep.planar_surface_ratio = 0.85;
    brep.planar_faces = 10;
    brep.total_faces = 12;
    brep.cylindrical_faces = 2;
    input.brep = brep;

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.panel_score, 0.4f);
    EXPECT_EQ(cls.dominant(), PartKind::Panel);
}

TEST(Classifier, NoBRepFallsBackGracefully) {
    // Name-based classification still works when brep is nullopt
    SequencingRules rules;
    ClassificationInput input;
    input.name = "M6x20_Socket_Head_Screw";
    input.bbox_dims = Vec3(6.0f, 6.0f, 20.0f);
    input.relative_volume = 0.001f;
    input.contact_degree = 2;
    // brep stays std::nullopt

    auto cls = classify_part(input, rules);
    EXPECT_GE(cls.fastener_score, 0.5f);
    EXPECT_EQ(cls.dominant(), PartKind::Fastener);
}
