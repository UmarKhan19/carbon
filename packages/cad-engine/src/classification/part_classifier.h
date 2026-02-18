#pragma once

/// Part classification using name heuristics + geometry + BRep analysis.
/// Enhanced port of sequence.rs — adds BRep-derived signals.

#include "classification/sequencing_rules.h"
#include "geometry/types.h"
#include "parsing/brep_analyzer.h"
#include <optional>
#include <string>
#include <unordered_map>

namespace carbon {

enum class PartKind { Fastener, Structural, Panel, Unknown };

struct PartClassification {
    float fastener_score = 0.0f;
    float structural_score = 0.0f;
    float panel_score = 0.0f;

    PartKind dominant() const {
        if (fastener_score >= structural_score && fastener_score >= panel_score && fastener_score > 0.3f)
            return PartKind::Fastener;
        if (structural_score >= fastener_score && structural_score >= panel_score && structural_score > 0.3f)
            return PartKind::Structural;
        if (panel_score >= fastener_score && panel_score >= structural_score && panel_score > 0.3f)
            return PartKind::Panel;
        return PartKind::Unknown;
    }
};

struct ClassificationInput {
    std::string name;
    Vec3 bbox_dims{0, 0, 0};
    float relative_volume = 0.0f;
    int contact_degree = 0;
    std::optional<BRepAnalysis> brep;  // NEW: BRep data if available
};

/// Classify a single part.
PartClassification classify_part(const ClassificationInput& input,
                                  const SequencingRules& rules);

/// Infer part kind from classification.
PartKind infer_part_kind(const std::string& name,
                          const PartClassification& cls,
                          const SequencingRules& rules);

/// Compute disassembly priority (higher = remove first).
float disassembly_priority(PartKind kind, const PartClassification& cls);

/// Classify all parts in batch.
std::unordered_map<std::string, PartClassification> classify_all_parts(
    const std::vector<std::pair<std::string, ClassificationInput>>& parts,
    const SequencingRules& rules);

} // namespace carbon
