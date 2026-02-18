#pragma once

/// Fastener kit detection (bolt + washer + nut groups).
/// Port of detect_kits() from contact_graph.rs.

#include "collision/contact_graph.h"
#include "classification/part_classifier.h"
#include "geometry/types.h"
#include <unordered_map>
#include <vector>

namespace carbon {

/// Detect fastener kits via BFS from fastener-classified parts.
std::vector<FastenerKit> detect_fastener_kits(
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds);

} // namespace carbon
