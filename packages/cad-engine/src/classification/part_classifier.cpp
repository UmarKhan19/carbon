#include "classification/part_classifier.h"
#include <algorithm>
#include <cmath>
#include <iostream>

namespace carbon {

PartClassification classify_part(const ClassificationInput& input,
                                  const SequencingRules& rules) {
    PartClassification cls;

    // --- Name-based signals (50% weight, same as Rust) ---
    if (rules.matches_fastener(input.name)) cls.fastener_score += 0.5f;
    if (rules.matches_structural(input.name)) cls.structural_score += 0.5f;
    if (rules.matches_panel(input.name)) cls.panel_score += 0.5f;

    // --- Geometry-based signals (35% weight) ---
    float sorted_dims[3] = {input.bbox_dims.x(), input.bbox_dims.y(), input.bbox_dims.z()};
    std::sort(sorted_dims, sorted_dims + 3);
    float aspect = (sorted_dims[2] > 1e-6f) ? sorted_dims[0] / sorted_dims[2] : 1.0f;

    // Small, elongated → fastener
    if (input.relative_volume < 0.02f && aspect < 0.3f) {
        cls.fastener_score += 0.2f;
    }
    // Flat → panel
    if (aspect < 0.15f && input.relative_volume < 0.15f) {
        cls.panel_score += 0.2f;
    }
    // Large → structural
    if (input.relative_volume > 0.15f) {
        cls.structural_score += 0.15f;
    }

    // Contact degree: high contact → structural
    if (input.contact_degree >= 4) {
        cls.structural_score += 0.15f;
    }

    // --- BRep-based signals (adds to above) ---
    if (input.brep.has_value()) {
        const auto& brep = *input.brep;
        std::cout << "[classifier_brep] ENTERED for '" << input.name << "'"
                  << " vol=" << brep.volume
                  << " threads=" << brep.has_threads
                  << " cyl_ratio=" << brep.cylindrical_surface_ratio
                  << " planar_ratio=" << brep.planar_surface_ratio
                  << " rel_vol=" << input.relative_volume
                  << " total_faces=" << brep.total_faces
                  << " aspect=" << ((sorted_dims[2] > 1e-6f) ? sorted_dims[0] / sorted_dims[2] : 1.0f)
                  << std::endl;

        // Thread detection → very strong fastener signal
        if (brep.has_threads) {
            cls.fastener_score += 0.4f;
        }

        // High cylindrical surface ratio → fastener
        if (brep.cylindrical_surface_ratio > 0.6) {
            cls.fastener_score += 0.3f;
        }

        // Small part with clear insertion axis + moderate cylindrical → fastener
        if (brep.cylindrical_surface_ratio > 0.3 && input.relative_volume < 0.05f
            && brep.insertion_axes.size() <= 2) {
            cls.fastener_score += 0.15f;
        }

        // Large volume + many faces → structural housing/frame
        if (brep.volume > 0 && input.relative_volume > 0.10f) {
            cls.structural_score += 0.15f;
        }
        // High planar area ratio + large volume → structural
        if (brep.planar_surface_ratio > 0.5 && input.relative_volume > 0.10f) {
            cls.structural_score += 0.10f;
        }
        // Many total faces → complex geometry → likely structural
        if (brep.total_faces > 20) {
            cls.structural_score += 0.05f;
        }

        // High planar ratio + thin → panel (face count based)
        int total_faces = brep.planar_faces + brep.cylindrical_faces +
                          brep.conical_faces + brep.spherical_faces +
                          brep.toroidal_faces + brep.freeform_faces;
        if (total_faces > 0) {
            double planar_ratio = static_cast<double>(brep.planar_faces) / total_faces;
            if (planar_ratio > 0.8 && aspect < 0.15) {
                cls.panel_score += 0.2f;
            }
        }

        // Medium planar surface ratio + moderate aspect → panel
        if (brep.planar_surface_ratio > 0.6 && aspect < 0.25f) {
            cls.panel_score += 0.15f;
        }
    }

    // Clamp to [0, 1]
    cls.fastener_score = std::clamp(cls.fastener_score, 0.0f, 1.0f);
    cls.structural_score = std::clamp(cls.structural_score, 0.0f, 1.0f);
    cls.panel_score = std::clamp(cls.panel_score, 0.0f, 1.0f);

    return cls;
}

PartKind infer_part_kind(const std::string& name,
                          const PartClassification& cls,
                          const SequencingRules& rules) {
    return cls.dominant();
}

float disassembly_priority(PartKind kind, const PartClassification& cls) {
    // Higher priority = remove first in disassembly
    switch (kind) {
        case PartKind::Fastener:   return 100.0f + cls.fastener_score * 10.0f;
        case PartKind::Panel:      return 50.0f + cls.panel_score * 10.0f;
        case PartKind::Unknown:    return 30.0f;
        case PartKind::Structural: return 10.0f - cls.structural_score * 5.0f;
    }
    return 30.0f;
}

std::unordered_map<std::string, PartClassification> classify_all_parts(
    const std::vector<std::pair<std::string, ClassificationInput>>& parts,
    const SequencingRules& rules) {
    std::unordered_map<std::string, PartClassification> result;
    for (const auto& [id, input] : parts) {
        result[id] = classify_part(input, rules);
    }
    return result;
}

} // namespace carbon
