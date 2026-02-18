#pragma once

/// Blocking matrix: precomputes 6-direction blocking using discrete CCD.
/// Port of BlockingMatrix from simulator.rs.

#include "geometry/types.h"
#include <array>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace carbon {

/// Internal part data for blocking matrix computation.
struct BlockingPartData {
    std::string id;
    const TriMesh* mesh;
    Isometry transform;
    AABB world_aabb;
};

class BlockingMatrix {
public:
    /// Build the blocking matrix by testing 6 canonical directions via discrete CCD.
    static BlockingMatrix build(
        const std::vector<BlockingPartData>& parts,
        float sweep_distance,
        float clearance);

    /// Check if a part is blocked in all 6 directions by non-removed parts.
    bool is_blocked_in_all_directions(
        const std::string& part_id,
        const std::unordered_set<std::string>& removed_parts) const;

    /// Total number of blocking pairs (for logging).
    size_t total_blocking_pairs() const;

private:
    // blockers_[part_id][dir_index] = set of part IDs that block it in that direction
    std::unordered_map<std::string, std::array<std::unordered_set<std::string>, 6>> blockers_;
};

/// The 6 canonical directions: +X, -X, +Y, -Y, +Z, -Z.
extern const std::array<Vec3, 6> CANONICAL_DIRECTIONS;

} // namespace carbon
