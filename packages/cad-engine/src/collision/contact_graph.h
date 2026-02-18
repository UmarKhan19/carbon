#pragma once

/// Contact graph for assembly part relationships.
/// Port of cad-simulator/src/contact_graph.rs.

#include "geometry/types.h"
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace carbon {

enum class PartKind;  // Forward declaration from part_classifier.h

struct Contact {
    std::string part_a;
    std::string part_b;
    float distance = 0.0f;
    Vec3 contact_point{0, 0, 0};
    Vec3 estimated_normal{0, 0, 0};
};

class ContactGraph {
public:
    /// Build contact graph using sweep-and-prune broad-phase + CGAL narrow-phase.
    static ContactGraph build(
        const std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>>& parts,
        float threshold);

    const std::vector<Contact>& edges() const { return edges_; }
    std::vector<std::string> neighbors(const std::string& part_id) const;
    int degree(const std::string& part_id) const;
    size_t edge_count() const { return edges_.size(); }

    /// Detect subassemblies via label propagation community detection.
    std::vector<SuggestedSubassembly> detect_subassemblies(
        const std::unordered_map<std::string, PartKind>& kinds) const;

    /// Detect fastener kits (bolt + washer + nut groups) via BFS.
    std::vector<FastenerKit> detect_kits(
        const std::unordered_map<std::string, PartKind>& kinds) const;

private:
    std::vector<Contact> edges_;
    std::unordered_map<std::string, std::vector<size_t>> adjacency_;
};

} // namespace carbon
