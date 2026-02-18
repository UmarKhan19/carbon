#include "graph/community_detect.h"

namespace carbon {

std::vector<SuggestedSubassembly> detect_subassemblies_lpa(
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartKind>& kinds) {
    // TODO: Port label propagation from contact_graph.rs
    // 1. Assign each part its own label
    // 2. Iterate: each part adopts the most-frequent label among weighted neighbors
    // 3. Weight: functional↔functional = 1.0, fastener edges = 0.1
    // 4. Converge after N iterations or stability
    // 5. Group parts by final label, filter groups with 2+ members
    return {};
}

} // namespace carbon
