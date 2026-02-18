#include "graph/dependency_graph.h"
#include <algorithm>
#include <queue>

namespace carbon {

void DependencyGraph::add_edge(const std::string& before, const std::string& after) {
    if (before == after) return;  // No self-loops
    // Check for duplicates
    auto& deps = forward_[before];
    if (std::find(deps.begin(), deps.end(), after) != deps.end()) return;
    deps.push_back(after);
    reverse_[after].push_back(before);
}

DependencyGraph DependencyGraph::build(
    const ContactGraph& contacts,
    const std::unordered_map<std::string, PartClassification>& classifications,
    const std::unordered_map<std::string, PartKind>& kinds,
    float fastener_threshold,
    float structural_threshold) {
    DependencyGraph graph;

    // Initialize all parts
    for (const auto& [part_id, _] : classifications) {
        graph.parts_.insert(part_id);
        graph.forward_[part_id];  // ensure entry exists
        graph.reverse_[part_id];
    }

    // Classification helpers
    auto is_fastener = [&](const std::string& id) -> bool {
        auto kit = kinds.find(id);
        if (kit != kinds.end()) {
            if (kit->second == PartKind::Fastener) return true;
            if (kit->second == PartKind::Structural || kit->second == PartKind::Panel) return false;
        }
        auto cls = classifications.find(id);
        return cls != classifications.end() && cls->second.fastener_score >= fastener_threshold;
    };

    auto is_structural = [&](const std::string& id) -> bool {
        auto kit = kinds.find(id);
        if (kit != kinds.end()) {
            if (kit->second == PartKind::Structural) return true;
            if (kit->second == PartKind::Fastener || kit->second == PartKind::Panel) return false;
        }
        auto cls = classifications.find(id);
        return cls != classifications.end() && cls->second.structural_score >= structural_threshold;
    };

    auto is_panel = [&](const std::string& id) -> bool {
        auto kit = kinds.find(id);
        if (kit != kinds.end()) {
            if (kit->second == PartKind::Panel) return true;
            if (kit->second == PartKind::Fastener || kit->second == PartKind::Structural) return false;
        }
        auto cls = classifications.find(id);
        return cls != classifications.end() && cls->second.panel_score >= 0.35f;
    };

    // Rule 1: Fasteners assemble after all their non-fastener contact neighbors
    for (const auto& [part_id, _] : classifications) {
        if (!is_fastener(part_id)) continue;
        for (const auto& neighbor : contacts.neighbors(part_id)) {
            if (is_fastener(neighbor)) continue;  // Skip fastener-to-fastener
            graph.add_edge(neighbor, part_id);     // neighbor before fastener
        }
    }

    // Rule 2: Structural parts assemble before their non-fastener contact neighbors
    for (const auto& [part_id, _] : classifications) {
        if (!is_structural(part_id)) continue;
        for (const auto& neighbor : contacts.neighbors(part_id)) {
            if (is_fastener(neighbor)) continue;  // Handled by Rule 1
            graph.add_edge(part_id, neighbor);     // structural before neighbor
        }
    }

    // Rule 3: Panels sit between structural and fasteners
    for (const auto& [part_id, _] : classifications) {
        if (!is_panel(part_id)) continue;
        for (const auto& neighbor : contacts.neighbors(part_id)) {
            if (is_fastener(neighbor)) {
                graph.add_edge(part_id, neighbor);     // panel before fastener
            } else if (is_structural(neighbor)) {
                graph.add_edge(neighbor, part_id);     // structural before panel
            }
        }
    }

    return graph;
}

bool DependencyGraph::can_disassemble(const std::string& part_id,
                                       const std::unordered_set<std::string>& removed) const {
    // A part can be disassembled if all parts that depend on it (forward edges)
    // have already been removed.
    auto it = forward_.find(part_id);
    if (it == forward_.end()) return true;
    for (const auto& dep : it->second) {
        if (removed.find(dep) == removed.end()) return false;
    }
    return true;
}

DependencyGraph::TopoResult DependencyGraph::topological_sort() const {
    // Kahn's algorithm with cycle detection
    std::unordered_map<std::string, int> in_degree;
    for (const auto& part : parts_) in_degree[part] = 0;
    for (const auto& [from, tos] : forward_) {
        for (const auto& to : tos) {
            in_degree[to]++;
        }
    }

    std::queue<std::string> queue;
    for (const auto& [part, deg] : in_degree) {
        if (deg == 0) queue.push(part);
    }

    std::vector<std::string> sorted;
    while (!queue.empty()) {
        auto part = queue.front();
        queue.pop();
        sorted.push_back(part);

        auto it = forward_.find(part);
        if (it != forward_.end()) {
            for (const auto& next : it->second) {
                if (--in_degree[next] == 0) {
                    queue.push(next);
                }
            }
        }
    }

    if (sorted.size() == parts_.size()) {
        return sorted;
    }

    // Cycle detected — return remaining parts as SCC
    std::vector<std::vector<std::string>> cycles;
    std::vector<std::string> cycle_parts;
    for (const auto& [part, deg] : in_degree) {
        if (deg > 0) cycle_parts.push_back(part);
    }
    if (!cycle_parts.empty()) cycles.push_back(std::move(cycle_parts));
    return cycles;
}

size_t DependencyGraph::edge_count() const {
    size_t count = 0;
    for (const auto& [_, edges] : forward_) {
        count += edges.size();
    }
    return count;
}

} // namespace carbon
