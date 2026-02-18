#include "collision/contact_graph.h"
#include "collision/collision_utils.h"
#include "classification/part_classifier.h"

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/AABB_tree.h>
#include <CGAL/AABB_traits_3.h>
#include <CGAL/AABB_face_graph_triangle_primitive.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <numeric>
#include <queue>

namespace carbon {

// --- CGAL type aliases (for area-weighted normal computation) ---

using CK = CGAL::Exact_predicates_inexact_constructions_kernel;
using CPoint3 = CK::Point_3;
using CSMesh = CGAL::Surface_mesh<CPoint3>;
using CPrimitive = CGAL::AABB_face_graph_triangle_primitive<CSMesh>;
using CTraits = CGAL::AABB_traits_3<CK, CPrimitive>;
using CAABBTree = CGAL::AABB_tree<CTraits>;

static CSMesh to_cgal_surface_mesh(const TriMesh& mesh, const Isometry& transform) {
    CSMesh sm;
    std::vector<CSMesh::Vertex_index> vi_map;
    vi_map.reserve(mesh.vertices.size());
    for (const auto& v : mesh.vertices) {
        Vec3 wv = transform.transform_point(v);
        vi_map.push_back(sm.add_vertex(CPoint3(wv.x(), wv.y(), wv.z())));
    }
    for (const auto& tri : mesh.indices) {
        sm.add_face(vi_map[tri[0]], vi_map[tri[1]], vi_map[tri[2]]);
    }
    return sm;
}

// --- Area-weighted contact normal voting ---
// Ports the 2-pass algorithm from Rust contact_graph.rs:202-358.
// For each triangle centroid on the source mesh, finds the closest point on
// the target mesh and votes with direction weighted by triangle area × closeness.

static constexpr size_t MAX_VOTING_TRIANGLES = 500;

static void vote_normals_pass(
    const TriMesh& source_mesh, const Isometry& source_xf,
    const CAABBTree& target_tree, const AABB& target_aabb,
    float proximity, float sign,
    Vec3& weighted_normal, Vec3& weighted_center, float& total_weight) {

    size_t step = std::max<size_t>(1, source_mesh.indices.size() / MAX_VOTING_TRIANGLES);

    for (size_t i = 0; i < source_mesh.indices.size(); i += step) {
        const auto& tri = source_mesh.indices[i];
        Vec3 v0 = source_xf.transform_point(source_mesh.vertices[tri[0]]);
        Vec3 v1 = source_xf.transform_point(source_mesh.vertices[tri[1]]);
        Vec3 v2 = source_xf.transform_point(source_mesh.vertices[tri[2]]);
        Vec3 centroid = (v0 + v1 + v2) / 3.0f;

        // Broad-phase: skip if centroid is outside target's expanded AABB
        if (centroid.x() < target_aabb.min.x() - proximity ||
            centroid.x() > target_aabb.max.x() + proximity ||
            centroid.y() < target_aabb.min.y() - proximity ||
            centroid.y() > target_aabb.max.y() + proximity ||
            centroid.z() < target_aabb.min.z() - proximity ||
            centroid.z() > target_aabb.max.z() + proximity)
            continue;

        // Find closest point on target mesh
        CPoint3 query(centroid.x(), centroid.y(), centroid.z());
        CPoint3 closest = target_tree.closest_point(query);
        Vec3 closest_vec(static_cast<float>(closest.x()),
                         static_cast<float>(closest.y()),
                         static_cast<float>(closest.z()));

        Vec3 dir = closest_vec - centroid;
        float dist = dir.norm();

        if (dist < proximity && dist > 1e-10f) {
            Vec3 edge1 = v1 - v0;
            Vec3 edge2 = v2 - v0;
            float area = edge1.cross(edge2).norm() * 0.5f;

            float closeness = 1.0f - (dist / proximity);
            float weight = area * closeness;

            weighted_normal += sign * (dir / dist) * weight;
            weighted_center += centroid * weight;
            total_weight += weight;
        }
    }
}

static void compute_area_weighted_normal(
    const TriMesh& mesh_a, const Isometry& ta,
    const TriMesh& mesh_b, const Isometry& tb,
    float threshold,
    Vec3& contact_point_out,
    Vec3& normal_out) {

    float proximity = threshold * 5.0f;
    Vec3 weighted_normal = Vec3::Zero();
    Vec3 weighted_center = Vec3::Zero();
    float total_weight = 0.0f;

    // Build CGAL meshes and AABB trees
    CSMesh sm_a = to_cgal_surface_mesh(mesh_a, ta);
    CAABBTree tree_a(faces(sm_a).first, faces(sm_a).second, sm_a);
    tree_a.accelerate_distance_queries();

    CSMesh sm_b = to_cgal_surface_mesh(mesh_b, tb);
    CAABBTree tree_b(faces(sm_b).first, faces(sm_b).second, sm_b);
    tree_b.accelerate_distance_queries();

    AABB aabb_a = mesh_a.world_aabb(ta);
    AABB aabb_b = mesh_b.world_aabb(tb);

    // Pass 1: mesh_a triangles → mesh_b surface (a→b direction, sign = +1)
    vote_normals_pass(mesh_a, ta, tree_b, aabb_b, proximity, +1.0f,
                      weighted_normal, weighted_center, total_weight);

    // Pass 2: mesh_b triangles → mesh_a surface (b→a direction, negated → sign = -1)
    vote_normals_pass(mesh_b, tb, tree_a, aabb_a, proximity, -1.0f,
                      weighted_normal, weighted_center, total_weight);

    // Finalize: normalize or fallback to center-to-center
    if (total_weight > 1e-10f && weighted_normal.squaredNorm() > 1e-10f) {
        contact_point_out = weighted_center / total_weight;
        normal_out = weighted_normal.normalized();
    } else {
        Vec3 center_a = ta.transform_point(mesh_a.local_aabb().center());
        Vec3 center_b = tb.transform_point(mesh_b.local_aabb().center());
        contact_point_out = (center_a + center_b) * 0.5f;
        Vec3 diff = center_b - center_a;
        float diff_len = diff.norm();
        normal_out = (diff_len > 1e-8f) ? diff / diff_len : Vec3(0, 0, 1);
    }
}

// --- Sweep-and-prune contact graph builder ---

ContactGraph ContactGraph::build(
    const std::vector<std::tuple<std::string, const TriMesh*, const Isometry*>>& parts,
    float threshold) {
    ContactGraph graph;
    size_t n = parts.size();
    if (n < 2) return graph;

    // 1. Compute world-space AABBs (loosened by threshold)
    struct PartAABB {
        size_t idx;
        AABB aabb;
    };
    std::vector<PartAABB> world_aabbs(n);

    for (size_t i = 0; i < n; ++i) {
        const auto& [id, mesh, transform] = parts[i];
        AABB waabb = mesh->world_aabb(*transform);
        // Loosen by threshold
        waabb.min -= Vec3(threshold, threshold, threshold);
        waabb.max += Vec3(threshold, threshold, threshold);
        world_aabbs[i] = {i, waabb};
    }

    // 2. Sort by AABB min-x for sweep
    std::vector<size_t> sorted_indices(n);
    std::iota(sorted_indices.begin(), sorted_indices.end(), 0);
    std::sort(sorted_indices.begin(), sorted_indices.end(),
        [&](size_t a, size_t b) {
            return world_aabbs[a].aabb.min.x() < world_aabbs[b].aabb.min.x();
        });

    // 3. Sweep-and-prune
    size_t narrow_phase_pairs = 0;

    for (size_t si = 0; si < n; ++si) {
        size_t i = sorted_indices[si];
        const auto& [id_a, mesh_a, transform_a] = parts[i];
        const AABB& aabb_a = world_aabbs[i].aabb;

        for (size_t sj = si + 1; sj < n; ++sj) {
            size_t j = sorted_indices[sj];
            const AABB& aabb_b = world_aabbs[j].aabb;

            // Early exit: if B's min-x > A's max-x, no further overlaps on X
            if (aabb_b.min.x() > aabb_a.max.x()) break;

            // Check Y and Z overlap
            if (aabb_a.min.y() > aabb_b.max.y() || aabb_b.min.y() > aabb_a.max.y()) continue;
            if (aabb_a.min.z() > aabb_b.max.z() || aabb_b.min.z() > aabb_a.max.z()) continue;

            // AABBs overlap on all 3 axes → narrow-phase distance check
            narrow_phase_pairs++;

            const auto& [id_b, mesh_b, transform_b] = parts[j];
            float dist = mesh_distance(*mesh_a, *transform_a, *mesh_b, *transform_b);

            if (dist < threshold) {
                // Area-weighted contact normal voting (2-pass)
                Vec3 contact_pt, normal;
                compute_area_weighted_normal(
                    *mesh_a, *transform_a, *mesh_b, *transform_b,
                    threshold, contact_pt, normal);

                Contact contact;
                contact.part_a = id_a;
                contact.part_b = id_b;
                contact.distance = dist;
                contact.contact_point = contact_pt;
                contact.estimated_normal = normal;

                size_t edge_idx = graph.edges_.size();
                graph.edges_.push_back(contact);
                graph.adjacency_[id_a].push_back(edge_idx);
                graph.adjacency_[id_b].push_back(edge_idx);
            }
        }
    }

    std::cout << "[contact_graph] Built: " << graph.edges_.size() << " contacts from "
              << n << " parts (" << narrow_phase_pairs << " narrow-phase checks)" << std::endl;

    return graph;
}

std::vector<std::string> ContactGraph::neighbors(const std::string& part_id) const {
    std::vector<std::string> result;
    auto it = adjacency_.find(part_id);
    if (it == adjacency_.end()) return result;
    for (size_t idx : it->second) {
        const auto& edge = edges_[idx];
        result.push_back(edge.part_a == part_id ? edge.part_b : edge.part_a);
    }
    return result;
}

int ContactGraph::degree(const std::string& part_id) const {
    auto it = adjacency_.find(part_id);
    return it == adjacency_.end() ? 0 : static_cast<int>(it->second.size());
}

// --- Label propagation community detection ---

std::vector<SuggestedSubassembly> ContactGraph::detect_subassemblies(
    const std::unordered_map<std::string, PartKind>& kinds) const {

    if (edges_.empty()) return {};

    // Collect all unique part IDs
    std::vector<std::string> all_parts;
    std::unordered_map<std::string, int> part_to_idx;
    for (const auto& [part_id, _] : adjacency_) {
        part_to_idx[part_id] = static_cast<int>(all_parts.size());
        all_parts.push_back(part_id);
    }
    int n = static_cast<int>(all_parts.size());
    if (n < 2) return {};

    // Build weighted adjacency list
    // High weight for functional↔functional, low for fastener edges
    struct WeightedEdge { int neighbor; float weight; };
    std::vector<std::vector<WeightedEdge>> adj(n);

    for (const auto& edge : edges_) {
        auto it_a = part_to_idx.find(edge.part_a);
        auto it_b = part_to_idx.find(edge.part_b);
        if (it_a == part_to_idx.end() || it_b == part_to_idx.end()) continue;

        int ia = it_a->second;
        int ib = it_b->second;

        auto kind_a = kinds.count(edge.part_a) ? kinds.at(edge.part_a) : PartKind::Unknown;
        auto kind_b = kinds.count(edge.part_b) ? kinds.at(edge.part_b) : PartKind::Unknown;

        // Low weight if either is a fastener (fasteners connect subassemblies)
        float weight = (kind_a == PartKind::Fastener || kind_b == PartKind::Fastener) ? 0.1f : 1.0f;

        adj[ia].push_back({ib, weight});
        adj[ib].push_back({ia, weight});
    }

    // Initialize labels: each node has unique label
    std::vector<int> labels(n);
    std::iota(labels.begin(), labels.end(), 0);

    // Iterate label propagation (max 50 iterations)
    for (int iter = 0; iter < 50; ++iter) {
        bool changed = false;

        for (int i = 0; i < n; ++i) {
            // Sum weights per neighbor label
            std::unordered_map<int, float> label_weights;
            for (const auto& we : adj[i]) {
                label_weights[labels[we.neighbor]] += we.weight;
            }

            // Find label with highest total weight
            int best_label = labels[i];
            float best_weight = -1.0f;
            for (const auto& [lbl, w] : label_weights) {
                if (w > best_weight || (w == best_weight && lbl < best_label)) {
                    best_weight = w;
                    best_label = lbl;
                }
            }

            if (best_label != labels[i]) {
                labels[i] = best_label;
                changed = true;
            }
        }

        if (!changed) break;
    }

    // Group nodes by final label → communities
    std::unordered_map<int, std::vector<int>> communities;
    for (int i = 0; i < n; ++i) {
        communities[labels[i]].push_back(i);
    }

    // Filter: keep communities with >= 2 functional (non-fastener) parts
    std::vector<SuggestedSubassembly> result;
    for (const auto& [label, members] : communities) {
        int functional_count = 0;
        for (int idx : members) {
            auto kind = kinds.count(all_parts[idx])
                ? kinds.at(all_parts[idx]) : PartKind::Unknown;
            if (kind != PartKind::Fastener) functional_count++;
        }
        if (functional_count < 2) continue;

        SuggestedSubassembly sub;
        // Name by highest-degree member
        int best_idx = members[0];
        int best_degree = 0;
        for (int idx : members) {
            int deg = static_cast<int>(adj[idx].size());
            if (deg > best_degree) {
                best_degree = deg;
                best_idx = idx;
            }
            sub.part_ids.push_back(all_parts[idx]);
        }
        sub.name = "Subassembly_" + all_parts[best_idx];

        // Confidence: internal_weight / total_weight
        float internal_weight = 0, total_weight = 0;
        std::unordered_set<int> member_set(members.begin(), members.end());
        for (int idx : members) {
            for (const auto& we : adj[idx]) {
                total_weight += we.weight;
                if (member_set.count(we.neighbor)) {
                    internal_weight += we.weight;
                }
            }
        }
        sub.confidence = (total_weight > 0) ? internal_weight / total_weight : 0.5f;

        result.push_back(std::move(sub));
    }

    return result;
}

// --- BFS fastener kit detection ---

std::vector<FastenerKit> ContactGraph::detect_kits(
    const std::unordered_map<std::string, PartKind>& kinds) const {

    // Find primary fasteners (bolts/screws)
    std::vector<std::string> primaries;
    for (const auto& [part_id, kind] : kinds) {
        if (kind == PartKind::Fastener) {
            // Primary fasteners are typically bolts/screws (could refine with name matching)
            primaries.push_back(part_id);
        }
    }

    std::unordered_set<std::string> claimed;
    std::vector<FastenerKit> kits;

    for (const auto& bolt : primaries) {
        if (claimed.count(bolt)) continue;

        // BFS through fastener neighbors
        FastenerKit kit;
        kit.primary = bolt;
        claimed.insert(bolt);

        std::queue<std::string> bfs;
        auto bolt_neighbors = neighbors(bolt);
        for (const auto& nb : bolt_neighbors) {
            auto it = kinds.find(nb);
            if (it != kinds.end() && it->second == PartKind::Fastener && !claimed.count(nb)) {
                bfs.push(nb);
            }
        }

        while (!bfs.empty()) {
            std::string curr = bfs.front();
            bfs.pop();
            if (claimed.count(curr)) continue;
            claimed.insert(curr);
            kit.accessories.push_back(curr);

            // Continue BFS through fastener neighbors
            auto curr_neighbors = neighbors(curr);
            for (const auto& nb : curr_neighbors) {
                auto it = kinds.find(nb);
                if (it != kinds.end() && it->second == PartKind::Fastener && !claimed.count(nb)) {
                    bfs.push(nb);
                }
            }
        }

        // Only add kits with accessories
        if (!kit.accessories.empty()) {
            kits.push_back(std::move(kit));
        }
    }

    return kits;
}

} // namespace carbon
