#pragma once

/// Assembly dependency graph (DAG).
/// Port of dependency_graph.rs.

#include "classification/part_classifier.h"
#include "collision/contact_graph.h"
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

namespace carbon {

class DependencyGraph {
public:
    /// Build dependency graph from contact graph + part classifications.
    static DependencyGraph build(
        const ContactGraph& contacts,
        const std::unordered_map<std::string, PartClassification>& classifications,
        const std::unordered_map<std::string, PartKind>& kinds,
        float fastener_threshold = 0.5f,
        float structural_threshold = 0.7f);

    /// Check if a part can be disassembled (all dependents already removed).
    bool can_disassemble(const std::string& part_id,
                          const std::unordered_set<std::string>& removed) const;

    /// Topological sort. Returns ordered IDs or cycles (strongly-connected components).
    using TopoResult = std::variant<std::vector<std::string>, std::vector<std::vector<std::string>>>;
    TopoResult topological_sort() const;

    size_t edge_count() const;

    /// Access forward edges for logging/debugging.
    /// forward[A] = parts that must be assembled AFTER A.
    const std::unordered_map<std::string, std::vector<std::string>>& forward_edges() const {
        return forward_;
    }

private:
    // forward_[A] = parts that must be assembled AFTER A
    std::unordered_map<std::string, std::vector<std::string>> forward_;
    // reverse_[A] = parts that must be assembled BEFORE A
    std::unordered_map<std::string, std::vector<std::string>> reverse_;
    std::unordered_set<std::string> parts_;

    void add_edge(const std::string& before, const std::string& after);
};

} // namespace carbon
