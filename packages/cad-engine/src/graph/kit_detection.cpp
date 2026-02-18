#include "graph/kit_detection.h"

namespace carbon {

std::vector<FastenerKit> detect_fastener_kits(
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds) {
    // TODO: Port BFS kit detection from contact_graph.rs
    // 1. Find all bolt/screw parts (PartKind::Fastener with bolt/screw name)
    // 2. BFS from each bolt through fastener-classified neighbors
    // 3. Group: primary = bolt, accessories = washers + nuts found via BFS
    return {};
}

} // namespace carbon
