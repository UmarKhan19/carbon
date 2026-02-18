#pragma once

/// Community detection for subassembly identification.
/// Port of detect_subassemblies() from contact_graph.rs.

#include "collision/contact_graph.h"
#include "classification/part_classifier.h"
#include "geometry/types.h"
#include <unordered_map>
#include <vector>

namespace carbon {

/// Detect subassemblies via label propagation on the contact graph.
/// Functional-to-functional edges weight 1.0, fastener edges weight 0.1.
std::vector<SuggestedSubassembly> detect_subassemblies_lpa(
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds);

} // namespace carbon
