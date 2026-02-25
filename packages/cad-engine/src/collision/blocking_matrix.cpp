#include "collision/blocking_matrix.h"
#include "collision/collision_utils.h"
#include "geometry/aabb.h"

#include <iostream>
#include <unordered_map>

namespace carbon {

const std::array<Vec3, 6> CANONICAL_DIRECTIONS = {{
    Vec3(1, 0, 0), Vec3(-1, 0, 0),
    Vec3(0, 1, 0), Vec3(0, -1, 0),
    Vec3(0, 0, 1), Vec3(0, 0, -1)
}};

// Helper: compute swept AABB along a direction
static AABB swept_aabb(const AABB& aabb, const Vec3& direction, float distance) {
    AABB result = aabb;
    Vec3 displacement = direction * distance;

    // Extend AABB to cover start and end positions
    for (int i = 0; i < 3; ++i) {
        if (displacement[i] > 0) {
            result.max[i] += displacement[i];
        } else {
            result.min[i] += displacement[i];
        }
    }
    return result;
}

BlockingMatrix BlockingMatrix::build(
    const std::vector<BlockingPartData>& parts,
    float sweep_distance,
    float clearance) {
    BlockingMatrix matrix;
    size_t n = parts.size();
    if (n < 2) return matrix;

    // Initialize blockers for each part
    for (const auto& part : parts) {
        matrix.blockers_[part.id] = {};
    }

    // Pre-build cached CGAL meshes for all parts (each part's mesh is static)
    std::vector<std::shared_ptr<CachedCollisionMesh>> cached_meshes(n);
    for (size_t i = 0; i < n; ++i) {
        cached_meshes[i] = build_collision_mesh(*parts[i].mesh, parts[i].transform);
    }

    // Pre-compute baseline intersection results for all pairs (symmetric)
    // Key: min(i,j) * n + max(i,j) → bool
    std::unordered_map<size_t, bool> baseline_cache;

    size_t total_checks = 0;
    size_t skipped_aabb = 0;
    size_t blocked_found = 0;
    size_t baseline_skips = 0;

    for (size_t i = 0; i < n; ++i) {
        const auto& part_i = parts[i];

        for (int dir = 0; dir < 6; ++dir) {
            const Vec3& direction = CANONICAL_DIRECTIONS[dir];

            // Compute swept AABB of part_i along this direction
            AABB swept = swept_aabb(part_i.world_aabb, direction, sweep_distance);

            for (size_t j = 0; j < n; ++j) {
                if (i == j) continue;
                const auto& part_j = parts[j];

                // AABB pre-filter: skip if swept AABB doesn't overlap obstacle
                if (!swept.overlaps(part_j.world_aabb, clearance)) {
                    skipped_aabb++;
                    continue;
                }

                // Check baseline intersection (cached across directions)
                size_t pair_key = std::min(i, j) * n + std::max(i, j);
                auto cache_it = baseline_cache.find(pair_key);
                bool baseline_intersecting;
                if (cache_it != baseline_cache.end()) {
                    baseline_intersecting = cache_it->second;
                } else {
                    baseline_intersecting = mesh_intersects_cached(
                        *part_i.mesh, part_i.transform, *cached_meshes[j]);
                    baseline_cache[pair_key] = baseline_intersecting;
                }

                if (baseline_intersecting) {
                    baseline_skips++;
                    continue;
                }

                total_checks++;

                // Discrete CCD check using pre-built obstacle mesh
                Vec3 velocity = direction * sweep_distance;
                auto toi = cast_shapes_discrete_cached(
                    *part_i.mesh, part_i.transform, velocity,
                    *cached_meshes[j],
                    1.0f,  // max_toi
                    10     // 10 samples (matching Rust)
                );

                if (toi.has_value()) {
                    // part_j blocks part_i in this direction
                    matrix.blockers_[part_i.id][dir].insert(part_j.id);
                    blocked_found++;
                }
            }
        }
    }

    std::cout << "[blocking_matrix] Built: " << blocked_found << " blocking pairs, "
              << total_checks << " CCD checks, " << skipped_aabb << " AABB skips, "
              << baseline_skips << " baseline-intersecting skips"
              << std::endl;

    return matrix;
}

bool BlockingMatrix::is_blocked_in_all_directions(
    const std::string& part_id,
    const std::unordered_set<std::string>& removed_parts) const {
    auto it = blockers_.find(part_id);
    if (it == blockers_.end()) return false;

    for (int dir = 0; dir < 6; ++dir) {
        const auto& blockers_in_dir = it->second[dir];
        bool all_removed = true;
        for (const auto& blocker : blockers_in_dir) {
            if (removed_parts.find(blocker) == removed_parts.end()) {
                all_removed = false;
                break;
            }
        }
        if (blockers_in_dir.empty() || all_removed) {
            return false;  // Free in this direction
        }
    }
    return true;  // Blocked in all 6 directions
}

size_t BlockingMatrix::total_blocking_pairs() const {
    size_t count = 0;
    for (const auto& [part, dirs] : blockers_) {
        for (const auto& blockers_in_dir : dirs) {
            count += blockers_in_dir.size();
        }
    }
    return count;
}

} // namespace carbon
