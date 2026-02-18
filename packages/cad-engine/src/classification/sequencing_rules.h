#pragma once

/// Keyword patterns for part classification.
/// Port of SequencingRules from sequence.rs.

#include <regex>
#include <string>
#include <vector>

namespace carbon {

struct SequencingRules {
    // Fastener patterns (bolts, screws, nuts, washers, rivets)
    std::vector<std::regex> fastener_patterns = {
        std::regex("bolt", std::regex_constants::icase),
        std::regex("screw", std::regex_constants::icase),
        std::regex("nut\\b", std::regex_constants::icase),
        std::regex("washer", std::regex_constants::icase),
        std::regex("rivet", std::regex_constants::icase),
        std::regex("pin\\b", std::regex_constants::icase),
        std::regex("fastener", std::regex_constants::icase),
        std::regex("m[0-9]+(x[0-9]+)?", std::regex_constants::icase),  // M6, M8x20
    };

    // Structural/base patterns
    std::vector<std::regex> structural_patterns = {
        std::regex("frame", std::regex_constants::icase),
        std::regex("base", std::regex_constants::icase),
        std::regex("housing", std::regex_constants::icase),
        std::regex("body", std::regex_constants::icase),
        std::regex("chassis", std::regex_constants::icase),
        std::regex("bracket", std::regex_constants::icase),
        std::regex("mount", std::regex_constants::icase),
    };

    // Panel patterns
    std::vector<std::regex> panel_patterns = {
        std::regex("plate", std::regex_constants::icase),
        std::regex("cover", std::regex_constants::icase),
        std::regex("panel", std::regex_constants::icase),
        std::regex("shield", std::regex_constants::icase),
        std::regex("lid", std::regex_constants::icase),
        std::regex("door", std::regex_constants::icase),
    };

    bool matches_fastener(const std::string& name) const {
        for (const auto& pat : fastener_patterns) {
            if (std::regex_search(name, pat)) return true;
        }
        return false;
    }

    bool matches_structural(const std::string& name) const {
        for (const auto& pat : structural_patterns) {
            if (std::regex_search(name, pat)) return true;
        }
        return false;
    }

    bool matches_panel(const std::string& name) const {
        for (const auto& pat : panel_patterns) {
            if (std::regex_search(name, pat)) return true;
        }
        return false;
    }
};

} // namespace carbon
