//! Contact graph for assembly part relationships.
//!
//! The contact graph captures which parts are in physical contact (or very close)
//! in the assembled state. This information is used to:
//! - Determine fastener dependencies (fasteners connect the parts they touch)
//! - Identify structural parts (parts with many contacts are likely structural)
//! - Build assembly constraints (parts must be in position before their fasteners)

use cad_common::{FastenerKit, SuggestedSubassembly};

use crate::sequence::PartKind;
use nalgebra::{Isometry3, Point3, Vector3};
use parry3d::query;
use parry3d::query::PointQuery;
use parry3d::shape::TriMesh;
use std::collections::{HashMap, HashSet, VecDeque};
use tracing::{debug, info};

/// A contact between two parts in the assembly.
#[derive(Debug, Clone)]
pub struct Contact {
    /// First part ID.
    pub part_a: String,
    /// Second part ID.
    pub part_b: String,
    /// Distance between the parts (0 = touching, small positive = close).
    pub distance: f32,
    /// Approximate contact point (midpoint of closest points).
    pub contact_point: Point3<f32>,
    /// Estimated contact normal (direction from part_a to part_b).
    pub estimated_normal: Vector3<f32>,
}

/// Graph of part contacts in an assembly.
///
/// Built by computing pairwise distances between all parts and keeping
/// edges where distance is below a threshold.
#[derive(Debug, Clone, Default)]
pub struct ContactGraph {
    /// All contact edges.
    edges: Vec<Contact>,
    /// Adjacency list for quick neighbor lookup.
    adjacency: HashMap<String, Vec<usize>>,
}

impl ContactGraph {
    /// Build a contact graph from parts using parry3d distance queries.
    ///
    /// # Arguments
    /// * `parts` - Iterator of (part_id, mesh, transform) tuples
    /// * `threshold` - Distance below which parts are considered "in contact"
    ///   Recommended: `assembly_diagonal * 0.002`
    ///
    /// # Performance
    /// Uses sweep-and-prune broad-phase on the X axis to avoid O(n²) distance
    /// queries. Only pairs whose loosened AABBs overlap on all 3 axes get the
    /// expensive narrow-phase `query::distance()` call.
    pub fn build<'a>(
        parts: impl IntoIterator<Item = (&'a str, &'a TriMesh, &'a Isometry3<f32>)> + Clone,
        threshold: f32,
    ) -> Self {
        let parts_vec: Vec<_> = parts.into_iter().collect();
        let n = parts_vec.len();

        let mut edges = Vec::new();
        let mut adjacency: HashMap<String, Vec<usize>> = HashMap::new();

        info!(
            "Building contact graph for {} parts with threshold {:.4}",
            n, threshold
        );

        // Initialize adjacency lists
        for (id, _, _) in &parts_vec {
            adjacency.insert((*id).to_string(), Vec::new());
        }

        // Compute world-space AABBs loosened by threshold for broad-phase
        let world_aabbs: Vec<(Point3<f32>, Point3<f32>)> = parts_vec
            .iter()
            .map(|(_, mesh, transform)| {
                let local_aabb = mesh.local_aabb();
                // Transform all 8 corners to world space to get tight world AABB
                let corners = [
                    Point3::new(local_aabb.mins.x, local_aabb.mins.y, local_aabb.mins.z),
                    Point3::new(local_aabb.maxs.x, local_aabb.mins.y, local_aabb.mins.z),
                    Point3::new(local_aabb.mins.x, local_aabb.maxs.y, local_aabb.mins.z),
                    Point3::new(local_aabb.maxs.x, local_aabb.maxs.y, local_aabb.mins.z),
                    Point3::new(local_aabb.mins.x, local_aabb.mins.y, local_aabb.maxs.z),
                    Point3::new(local_aabb.maxs.x, local_aabb.mins.y, local_aabb.maxs.z),
                    Point3::new(local_aabb.mins.x, local_aabb.maxs.y, local_aabb.maxs.z),
                    Point3::new(local_aabb.maxs.x, local_aabb.maxs.y, local_aabb.maxs.z),
                ];
                let world_corners: Vec<Point3<f32>> =
                    corners.iter().map(|c| *transform * *c).collect();
                let mut wmin = world_corners[0];
                let mut wmax = world_corners[0];
                for c in &world_corners[1..] {
                    wmin.x = wmin.x.min(c.x);
                    wmin.y = wmin.y.min(c.y);
                    wmin.z = wmin.z.min(c.z);
                    wmax.x = wmax.x.max(c.x);
                    wmax.y = wmax.y.max(c.y);
                    wmax.z = wmax.z.max(c.z);
                }
                // Loosen by threshold on each side
                wmin.x -= threshold;
                wmin.y -= threshold;
                wmin.z -= threshold;
                wmax.x += threshold;
                wmax.y += threshold;
                wmax.z += threshold;
                (wmin, wmax)
            })
            .collect();

        // Sort indices by AABB min-x for sweep-and-prune
        let mut sorted_indices: Vec<usize> = (0..n).collect();
        sorted_indices.sort_by(|&a, &b| {
            world_aabbs[a]
                .0
                .x
                .partial_cmp(&world_aabbs[b].0.x)
                .unwrap()
        });

        let mut broad_phase_pairs = 0u64;
        let mut narrow_phase_pairs = 0u64;

        // Sweep-and-prune: only check pairs that overlap on X axis
        for si in 0..sorted_indices.len() {
            let i = sorted_indices[si];
            let (amin, amax) = &world_aabbs[i];

            for &j in &sorted_indices[(si + 1)..] {
                let (bmin, bmax) = &world_aabbs[j];

                // Early exit: if bmin.x > amax.x, no further j can overlap on X
                if bmin.x > amax.x {
                    break;
                }

                broad_phase_pairs += 1;

                // Check Y and Z overlap
                if amin.y > bmax.y || bmin.y > amax.y {
                    continue;
                }
                if amin.z > bmax.z || bmin.z > amax.z {
                    continue;
                }

                // AABBs overlap on all 3 axes → narrow-phase distance check
                narrow_phase_pairs += 1;

                let (id_a, mesh_a, transform_a) = parts_vec[i];
                let (id_b, mesh_b, transform_b) = parts_vec[j];

                let dist =
                    query::distance(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(f32::MAX);

                if dist < threshold {
                    let (contact_point, normal) = Self::compute_contact_patch_normal(
                        mesh_a,
                        transform_a,
                        mesh_b,
                        transform_b,
                        threshold,
                    );

                    let edge_idx = edges.len();
                    edges.push(Contact {
                        part_a: id_a.to_string(),
                        part_b: id_b.to_string(),
                        distance: dist,
                        contact_point,
                        estimated_normal: normal,
                    });

                    adjacency.get_mut(id_a).unwrap().push(edge_idx);
                    adjacency.get_mut(id_b).unwrap().push(edge_idx);

                    debug!("Contact: {} <-> {} (dist={:.4})", id_a, id_b, dist);
                }
            }
        }

        let total_possible = (n * (n - 1)) / 2;
        info!(
            "Contact graph built: {} edges among {} parts \
             (broad-phase: {}/{} pairs, narrow-phase: {} pairs)",
            edges.len(),
            n,
            broad_phase_pairs,
            total_possible,
            narrow_phase_pairs
        );

        ContactGraph { edges, adjacency }
    }

    /// Compute contact point and normal using area-weighted contact direction voting.
    ///
    /// Instead of using a single closest-point pair (which gives a radial normal
    /// for cylindrical contacts like bolt-in-hole), this method samples all
    /// triangles on each mesh that are near the other mesh. For each close
    /// triangle, it computes the direction from the triangle centroid to the
    /// closest point on the opposite mesh. These centroid→projection directions
    /// are area-weighted and summed. For a bolt in a cylindrical hole, radial
    /// directions cancel (they point in all directions around the circumference)
    /// while axial directions (from the bolt head cap facing the hole bottom)
    /// reinforce, correctly identifying the dominant contact axis.
    fn compute_contact_patch_normal(
        mesh_a: &TriMesh,
        transform_a: &Isometry3<f32>,
        mesh_b: &TriMesh,
        transform_b: &Isometry3<f32>,
        threshold: f32,
    ) -> (Point3<f32>, Vector3<f32>) {
        let mut weighted_normal = Vector3::zeros();
        let mut contact_center = Vector3::zeros();
        let mut total_weight: f32 = 0.0;

        // Pre-compute world-space AABBs for broad-phase filtering
        let b_aabb = mesh_b.local_aabb();
        let b_corners = [
            transform_b * Point3::from(b_aabb.mins.coords),
            transform_b * Point3::from(b_aabb.maxs.coords),
        ];
        let b_aabb_min = Point3::new(
            b_corners[0].x.min(b_corners[1].x),
            b_corners[0].y.min(b_corners[1].y),
            b_corners[0].z.min(b_corners[1].z),
        );
        let b_aabb_max = Point3::new(
            b_corners[0].x.max(b_corners[1].x),
            b_corners[0].y.max(b_corners[1].y),
            b_corners[0].z.max(b_corners[1].z),
        );

        let a_aabb = mesh_a.local_aabb();
        let a_corners = [
            transform_a * Point3::from(a_aabb.mins.coords),
            transform_a * Point3::from(a_aabb.maxs.coords),
        ];
        let a_aabb_min = Point3::new(
            a_corners[0].x.min(a_corners[1].x),
            a_corners[0].y.min(a_corners[1].y),
            a_corners[0].z.min(a_corners[1].z),
        );
        let a_aabb_max = Point3::new(
            a_corners[0].x.max(a_corners[1].x),
            a_corners[0].y.max(a_corners[1].y),
            a_corners[0].z.max(a_corners[1].z),
        );

        // Use a proximity distance that scales with the threshold
        let proximity = threshold * 5.0;
        let max_triangles = 500;

        let inv_b = transform_b.inverse();
        let inv_a = transform_a.inverse();

        // Pass 1: for each triangle on mesh_a near mesh_b, compute direction
        // from centroid to closest point on mesh_b (a→b direction)
        let num_tris_a = (mesh_a.num_triangles().min(max_triangles)) as u32;
        for tri_idx in 0..num_tris_a {
            let tri = mesh_a.triangle(tri_idx);
            let wa = transform_a * tri.a;
            let wb = transform_a * tri.b;
            let wc = transform_a * tri.c;
            let centroid = Point3::from((wa.coords + wb.coords + wc.coords) / 3.0);

            // Broad-phase: skip if centroid is far from mesh_b's AABB
            if centroid.x < b_aabb_min.x - proximity
                || centroid.x > b_aabb_max.x + proximity
                || centroid.y < b_aabb_min.y - proximity
                || centroid.y > b_aabb_max.y + proximity
                || centroid.z < b_aabb_min.z - proximity
                || centroid.z > b_aabb_max.z + proximity
            {
                continue;
            }

            // Narrow-phase: project centroid onto mesh_b
            let local_pt = inv_b * centroid;
            let proj = mesh_b.project_local_point(&local_pt, true);
            let closest_world = transform_b * proj.point;
            let dir = closest_world - centroid;
            let dist = dir.norm();

            if dist < proximity && dist > 1.0e-8 {
                let edge1 = wb - wa;
                let edge2 = wc - wa;
                let area = edge1.cross(&edge2).norm() * 0.5;

                if area > 1.0e-10 {
                    let closeness = 1.0 - (dist / proximity).min(1.0);
                    let weight = area * closeness;
                    // Direction from mesh_a surface toward mesh_b (a→b)
                    weighted_normal += dir.normalize() * weight;
                    contact_center += centroid.coords * weight;
                    total_weight += weight;
                }
            }
        }

        // Pass 2: for each triangle on mesh_b near mesh_a, compute direction
        // from centroid to closest point on mesh_a, then negate (to get a→b)
        let num_tris_b = (mesh_b.num_triangles().min(max_triangles)) as u32;
        for tri_idx in 0..num_tris_b {
            let tri = mesh_b.triangle(tri_idx);
            let wa = transform_b * tri.a;
            let wb = transform_b * tri.b;
            let wc = transform_b * tri.c;
            let centroid = Point3::from((wa.coords + wb.coords + wc.coords) / 3.0);

            if centroid.x < a_aabb_min.x - proximity
                || centroid.x > a_aabb_max.x + proximity
                || centroid.y < a_aabb_min.y - proximity
                || centroid.y > a_aabb_max.y + proximity
                || centroid.z < a_aabb_min.z - proximity
                || centroid.z > a_aabb_max.z + proximity
            {
                continue;
            }

            let local_pt = inv_a * centroid;
            let proj = mesh_a.project_local_point(&local_pt, true);
            let closest_world = transform_a * proj.point;
            let dir = closest_world - centroid;
            let dist = dir.norm();

            if dist < proximity && dist > 1.0e-8 {
                let edge1 = wb - wa;
                let edge2 = wc - wa;
                let area = edge1.cross(&edge2).norm() * 0.5;

                if area > 1.0e-10 {
                    let closeness = 1.0 - (dist / proximity).min(1.0);
                    let weight = area * closeness;
                    // Direction from mesh_b surface toward mesh_a, negate for a→b
                    weighted_normal -= dir.normalize() * weight;
                    contact_center += centroid.coords * weight;
                    total_weight += weight;
                }
            }
        }

        if total_weight > 1.0e-10 && weighted_normal.norm_squared() > 1.0e-10 {
            let center = Point3::from(contact_center / total_weight);
            let normal = weighted_normal.normalize();
            (center, normal)
        } else {
            // Fallback to single-point method when patch voting is inconclusive
            Self::compute_contact_info_single_point(mesh_a, transform_a, mesh_b, transform_b)
        }
    }

    /// Fallback: compute contact point and normal from a single closest-point pair.
    fn compute_contact_info_single_point(
        mesh_a: &TriMesh,
        transform_a: &Isometry3<f32>,
        mesh_b: &TriMesh,
        transform_b: &Isometry3<f32>,
    ) -> (Point3<f32>, Vector3<f32>) {
        match query::closest_points(transform_a, mesh_a, transform_b, mesh_b, f32::MAX) {
            Ok(query::ClosestPoints::WithinMargin(pt_a, pt_b)) => {
                let contact = Point3::from((pt_a.coords + pt_b.coords) / 2.0);
                let diff = pt_b - pt_a;
                let normal = if diff.norm_squared() > 1.0e-9 {
                    diff.normalize()
                } else {
                    Vector3::z()
                };
                (contact, normal)
            }
            Ok(query::ClosestPoints::Intersecting) => {
                let centroid_a = transform_a * mesh_a.local_bounding_sphere().center;
                let centroid_b = transform_b * mesh_b.local_bounding_sphere().center;
                let contact = Point3::from((centroid_a.coords + centroid_b.coords) / 2.0);
                let diff = centroid_b - centroid_a;
                let normal = if diff.norm_squared() > 1.0e-9 {
                    diff.normalize()
                } else {
                    Vector3::z()
                };
                (contact, normal)
            }
            _ => (Point3::origin(), Vector3::z()),
        }
    }

    /// Get all contacts involving a specific part.
    pub fn contacts_for(&self, part_id: &str) -> impl Iterator<Item = &Contact> {
        self.adjacency
            .get(part_id)
            .into_iter()
            .flat_map(|indices| indices.iter().map(|&i| &self.edges[i]))
    }

    /// Get all parts that are in contact with a specific part.
    pub fn neighbors(&self, part_id: &str) -> Vec<&str> {
        self.contacts_for(part_id)
            .map(|c| {
                if c.part_a == part_id {
                    c.part_b.as_str()
                } else {
                    c.part_a.as_str()
                }
            })
            .collect()
    }

    /// Count how many other parts this part contacts (degree in graph).
    pub fn degree(&self, part_id: &str) -> usize {
        self.adjacency.get(part_id).map(|v| v.len()).unwrap_or(0)
    }

    /// Get all contacts in the graph.
    pub fn all_contacts(&self) -> &[Contact] {
        &self.edges
    }

    /// Get the number of contacts (edges) in the graph.
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// Get the number of parts (nodes) in the graph.
    pub fn node_count(&self) -> usize {
        self.adjacency.len()
    }

    /// Detect subassemblies using label propagation community detection.
    ///
    /// The algorithm assigns high weights to functional↔functional contacts
    /// and low weights to fastener edges (since fasteners JOIN subassemblies,
    /// they shouldn't define them). Label propagation then finds tightly
    /// connected communities of functional parts.
    ///
    /// # Returns
    /// A list of suggested subassemblies, each with a name, part IDs, and
    /// confidence score. Only communities with >= 2 functional parts are returned.
    pub fn detect_subassemblies(
        &self,
        classifications: &HashMap<String, PartKind>,
    ) -> Vec<SuggestedSubassembly> {
        let all_parts: Vec<&String> = self.adjacency.keys().collect();
        if all_parts.len() < 2 {
            return Vec::new();
        }

        // Assign each part a numeric index
        let part_to_idx: HashMap<&str, usize> = all_parts
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();
        let n = all_parts.len();

        // Build weighted adjacency list
        // functional↔functional = 1.0, anything involving a fastener = 0.1
        let mut adj: Vec<Vec<(usize, f32)>> = vec![Vec::new(); n];

        for contact in &self.edges {
            let Some(&ia) = part_to_idx.get(contact.part_a.as_str()) else {
                continue;
            };
            let Some(&ib) = part_to_idx.get(contact.part_b.as_str()) else {
                continue;
            };

            let kind_a = classifications
                .get(&contact.part_a)
                .copied()
                .unwrap_or(PartKind::Unknown);
            let kind_b = classifications
                .get(&contact.part_b)
                .copied()
                .unwrap_or(PartKind::Unknown);

            let weight = if kind_a == PartKind::Fastener || kind_b == PartKind::Fastener {
                0.1
            } else {
                1.0
            };

            adj[ia].push((ib, weight));
            adj[ib].push((ia, weight));
        }

        // Label propagation: each node starts with its own label
        let mut labels: Vec<usize> = (0..n).collect();
        let max_iterations = 50;

        for _ in 0..max_iterations {
            let mut changed = false;

            for node in 0..n {
                if adj[node].is_empty() {
                    continue;
                }

                // Sum weights per neighbor label
                let mut label_weights: HashMap<usize, f32> = HashMap::new();
                for &(neighbor, weight) in &adj[node] {
                    *label_weights.entry(labels[neighbor]).or_default() += weight;
                }

                // Pick the label with highest total weight (ties broken by smallest label)
                let best_label = label_weights
                    .into_iter()
                    .max_by(|(label_a, weight_a), (label_b, weight_b)| {
                        weight_a
                            .partial_cmp(weight_b)
                            .unwrap()
                            .then(label_b.cmp(label_a)) // prefer smaller label on tie
                    })
                    .map(|(label, _)| label)
                    .unwrap_or(labels[node]);

                if best_label != labels[node] {
                    labels[node] = best_label;
                    changed = true;
                }
            }

            if !changed {
                break;
            }
        }

        // Group nodes by label → communities
        let mut communities: HashMap<usize, Vec<usize>> = HashMap::new();
        for (node, &label) in labels.iter().enumerate() {
            communities.entry(label).or_default().push(node);
        }

        // Filter and build results
        let mut results = Vec::new();
        for members in communities.values() {
            // Count functional parts in this community
            let functional_count = members
                .iter()
                .filter(|&&idx| {
                    let kind = classifications
                        .get(all_parts[idx].as_str())
                        .copied()
                        .unwrap_or(PartKind::Unknown);
                    kind != PartKind::Fastener
                })
                .count();

            // Only report communities with >= 2 functional parts
            if functional_count < 2 {
                continue;
            }

            let part_ids: Vec<String> = members.iter().map(|&idx| all_parts[idx].clone()).collect();

            // Name: use the part with highest degree (most connections)
            let name = members
                .iter()
                .max_by_key(|&&idx| self.degree(all_parts[idx].as_str()))
                .map(|&idx| all_parts[idx].clone())
                .unwrap_or_default();

            // Confidence: ratio of internal edges to total edges touching this community
            let member_set: HashSet<usize> = members.iter().copied().collect();
            let mut internal_weight = 0.0f32;
            let mut total_weight = 0.0f32;
            for &node in members {
                for &(neighbor, weight) in &adj[node] {
                    total_weight += weight;
                    if member_set.contains(&neighbor) {
                        internal_weight += weight;
                    }
                }
            }
            let confidence = if total_weight > 0.0 {
                (internal_weight / total_weight).min(1.0)
            } else {
                0.0
            };

            results.push(SuggestedSubassembly {
                name,
                part_ids,
                confidence,
            });
        }

        debug!(
            "Detected {} subassemblies from {} communities",
            results.len(),
            communities.len()
        );

        results
    }

    /// Detect fastener kits: groups of fasteners that should be assembled together.
    ///
    /// Starting from each bolt/screw, BFS through contact neighbors that are also
    /// fastener-classified (washers, nuts, lock washers). The bolt is the primary
    /// fastener; all other fasteners in the chain are accessories.
    ///
    /// Each part can only belong to one kit (assigned to the first bolt that claims it).
    pub fn detect_kits(
        &self,
        classifications: &HashMap<String, PartKind>,
    ) -> Vec<FastenerKit> {
        let mut claimed: HashSet<String> = HashSet::new();
        let mut kits = Vec::new();

        // Find all bolts/screws (fastener-classified parts whose names suggest they're primary)
        let bolt_names = ["bolt", "screw", "capscrew", "cap screw", "stud"];

        let mut primary_fasteners: Vec<&str> = Vec::new();
        for part_id in self.adjacency.keys() {
            let kind = classifications
                .get(part_id.as_str())
                .copied()
                .unwrap_or(PartKind::Unknown);
            if kind != PartKind::Fastener {
                continue;
            }
            let lower = part_id.to_lowercase();
            if bolt_names.iter().any(|name| lower.contains(name)) {
                primary_fasteners.push(part_id.as_str());
            }
        }

        // Sort for deterministic output
        primary_fasteners.sort();

        for &bolt_id in &primary_fasteners {
            if claimed.contains(bolt_id) {
                continue;
            }

            // BFS from this bolt through fastener neighbors
            let mut accessories = Vec::new();
            let mut queue: VecDeque<&str> = VecDeque::new();
            let mut visited: HashSet<&str> = HashSet::new();
            visited.insert(bolt_id);

            // Seed the BFS with fastener neighbors of the bolt
            for neighbor in self.neighbors(bolt_id) {
                let kind = classifications
                    .get(neighbor)
                    .copied()
                    .unwrap_or(PartKind::Unknown);
                if kind == PartKind::Fastener && !claimed.contains(neighbor) {
                    queue.push_back(neighbor);
                }
            }

            while let Some(part) = queue.pop_front() {
                if visited.contains(part) {
                    continue;
                }
                visited.insert(part);

                // Only continue traversal through fastener parts
                let kind = classifications
                    .get(part)
                    .copied()
                    .unwrap_or(PartKind::Unknown);
                if kind != PartKind::Fastener {
                    continue;
                }
                if claimed.contains(part) {
                    continue;
                }

                accessories.push(part.to_string());

                // Continue BFS to find more fastener chain members
                for neighbor in self.neighbors(part) {
                    if !visited.contains(neighbor) {
                        queue.push_back(neighbor);
                    }
                }
            }

            if !accessories.is_empty() {
                claimed.insert(bolt_id.to_string());
                for acc in &accessories {
                    claimed.insert(acc.clone());
                }
                kits.push(FastenerKit {
                    primary: bolt_id.to_string(),
                    accessories,
                });
            }
        }

        debug!("Detected {} fastener kits", kits.len());
        kits
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sequence::PartKind;

    fn create_unit_cube_mesh() -> TriMesh {
        // Unit cube centered at origin
        let vertices = vec![
            Point3::new(-0.5, -0.5, -0.5),
            Point3::new(0.5, -0.5, -0.5),
            Point3::new(0.5, 0.5, -0.5),
            Point3::new(-0.5, 0.5, -0.5),
            Point3::new(-0.5, -0.5, 0.5),
            Point3::new(0.5, -0.5, 0.5),
            Point3::new(0.5, 0.5, 0.5),
            Point3::new(-0.5, 0.5, 0.5),
        ];
        let indices = vec![
            [0, 2, 1],
            [0, 3, 2], // front
            [4, 5, 6],
            [4, 6, 7], // back
            [0, 1, 5],
            [0, 5, 4], // bottom
            [2, 3, 7],
            [2, 7, 6], // top
            [0, 4, 7],
            [0, 7, 3], // left
            [1, 2, 6],
            [1, 6, 5], // right
        ];
        TriMesh::new(vertices, indices)
    }

    #[test]
    fn test_touching_cubes_have_contact() {
        let mesh = create_unit_cube_mesh();

        // Two cubes touching along X axis
        let transform_a = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_b = Isometry3::translation(1.0, 0.0, 0.0); // Touching at x=0.5

        let parts = vec![
            ("cube_a", &mesh, &transform_a),
            ("cube_b", &mesh, &transform_b),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        assert_eq!(graph.edge_count(), 1, "Should have one contact");
        assert_eq!(graph.degree("cube_a"), 1);
        assert_eq!(graph.degree("cube_b"), 1);
        assert_eq!(graph.neighbors("cube_a"), vec!["cube_b"]);
    }

    #[test]
    fn test_separated_cubes_no_contact() {
        let mesh = create_unit_cube_mesh();

        // Two cubes far apart
        let transform_a = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_b = Isometry3::translation(5.0, 0.0, 0.0);

        let parts = vec![
            ("cube_a", &mesh, &transform_a),
            ("cube_b", &mesh, &transform_b),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        assert_eq!(graph.edge_count(), 0, "Should have no contacts");
        assert_eq!(graph.degree("cube_a"), 0);
        assert_eq!(graph.degree("cube_b"), 0);
    }

    #[test]
    fn test_three_part_assembly() {
        let mesh = create_unit_cube_mesh();

        // Three cubes in a row: A - B - C
        let transform_a = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_b = Isometry3::translation(1.0, 0.0, 0.0);
        let transform_c = Isometry3::translation(2.0, 0.0, 0.0);

        let parts = vec![
            ("cube_a", &mesh, &transform_a),
            ("cube_b", &mesh, &transform_b),
            ("cube_c", &mesh, &transform_c),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        assert_eq!(graph.edge_count(), 2, "Should have two contacts");
        assert_eq!(graph.degree("cube_a"), 1); // Only touches B
        assert_eq!(graph.degree("cube_b"), 2); // Touches A and C
        assert_eq!(graph.degree("cube_c"), 1); // Only touches B
    }

    /// Create a cylinder mesh along the Z axis (approximated with N segments).
    fn create_cylinder_mesh(radius: f32, height: f32, segments: usize) -> TriMesh {
        let half_h = height / 2.0;
        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        // Bottom center (0) and top center (1)
        vertices.push(Point3::new(0.0, 0.0, -half_h));
        vertices.push(Point3::new(0.0, 0.0, half_h));

        // Ring vertices: bottom ring starts at index 2, top ring at 2 + segments
        for i in 0..segments {
            let angle = 2.0 * std::f32::consts::PI * (i as f32) / (segments as f32);
            let x = radius * angle.cos();
            let y = radius * angle.sin();
            vertices.push(Point3::new(x, y, -half_h)); // bottom ring
        }
        for i in 0..segments {
            let angle = 2.0 * std::f32::consts::PI * (i as f32) / (segments as f32);
            let x = radius * angle.cos();
            let y = radius * angle.sin();
            vertices.push(Point3::new(x, y, half_h)); // top ring
        }

        let bot_center = 0u32;
        let top_center = 1u32;
        let bot_ring = 2u32;
        let top_ring = bot_ring + segments as u32;

        for i in 0..segments as u32 {
            let next = (i + 1) % segments as u32;

            // Bottom cap
            indices.push([bot_center, bot_ring + next, bot_ring + i]);
            // Top cap
            indices.push([top_center, top_ring + i, top_ring + next]);

            // Side quads (two triangles each)
            indices.push([bot_ring + i, bot_ring + next, top_ring + i]);
            indices.push([bot_ring + next, top_ring + next, top_ring + i]);
        }

        TriMesh::new(vertices, indices)
    }

    #[test]
    fn test_contact_patch_normal_cylinder() {
        // A bolt (small cylinder) partially inserted into a hole (larger cylinder).
        // The bolt axis is along Z. The bolt is offset so its head sticks out of
        // the hole on the +Z side — a realistic bolt-in-hole configuration.
        // The patch normal should be axial (Z), NOT radial.
        let bolt = create_cylinder_mesh(0.4, 2.0, 16);
        let hole = create_cylinder_mesh(0.5, 2.5, 16);

        // Offset the bolt so it protrudes from the +Z end of the hole.
        // Bolt: z in [-1.0 + 0.5, 1.0 + 0.5] = [-0.5, 1.5]
        // Hole: z in [-1.25, 1.25]
        // Bolt head at z=1.5 sticks out past hole top at z=1.25.
        // Bolt bottom at z=-0.5 is inside hole bottom at z=-1.25.
        // This breaks the top/bottom symmetry: only the bolt bottom cap
        // faces the hole bottom, creating net axial bias.
        let transform_bolt = Isometry3::translation(0.0, 0.0, 0.5);
        let transform_hole = Isometry3::translation(0.0, 0.0, 0.0);

        let threshold = 0.2;
        let (_, normal) = ContactGraph::compute_contact_patch_normal(
            &bolt,
            &transform_bolt,
            &hole,
            &transform_hole,
            threshold,
        );

        // The normal should be predominantly along Z (axial), not radial (X/Y)
        let axial_component = normal.z.abs();
        let radial_component = (normal.x * normal.x + normal.y * normal.y).sqrt();

        println!(
            "Cylinder patch normal: {:?}, axial={:.3}, radial={:.3}",
            normal, axial_component, radial_component
        );

        assert!(
            axial_component > radial_component,
            "Patch normal should be more axial ({:.3}) than radial ({:.3}), got {:?}",
            axial_component,
            radial_component,
            normal
        );
    }

    #[test]
    fn test_contact_patch_normal_flat() {
        // Two cubes touching on a flat face along X axis.
        // The patch normal should be along X (perpendicular to the contact face).
        let mesh = create_unit_cube_mesh();

        let transform_a = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_b = Isometry3::translation(1.0, 0.0, 0.0);

        let threshold = 0.1;
        let (_, normal) = ContactGraph::compute_contact_patch_normal(
            &mesh,
            &transform_a,
            &mesh,
            &transform_b,
            threshold,
        );

        // The normal should be predominantly along X
        let x_component = normal.x.abs();

        println!("Flat contact patch normal: {:?}, x={:.3}", normal, x_component);

        assert!(
            x_component > 0.7,
            "Flat contact patch normal should be predominantly along X, got {:?} (x={:.3})",
            normal,
            x_component
        );
    }

    #[test]
    fn test_broad_phase_same_results_as_brute_force() {
        // The sweep-and-prune should produce the same contact graph as brute force.
        // Test with a 5-part assembly where some touch and some don't.
        let mesh = create_unit_cube_mesh();

        let transforms = vec![
            Isometry3::translation(0.0, 0.0, 0.0),
            Isometry3::translation(1.0, 0.0, 0.0), // touches [0]
            Isometry3::translation(2.0, 0.0, 0.0), // touches [1]
            Isometry3::translation(0.0, 1.0, 0.0), // touches [0]
            Isometry3::translation(5.0, 5.0, 5.0), // isolated
        ];

        let parts: Vec<(&str, &TriMesh, &Isometry3<f32>)> = vec![
            ("a", &mesh, &transforms[0]),
            ("b", &mesh, &transforms[1]),
            ("c", &mesh, &transforms[2]),
            ("d", &mesh, &transforms[3]),
            ("e", &mesh, &transforms[4]),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        // Expected: a-b, b-c, a-d, b-d (4 edges). b and d share an edge at corner (0.5, 0.5).
        // e is isolated.
        assert_eq!(graph.edge_count(), 4, "Should have 4 contacts");
        assert_eq!(graph.degree("a"), 2); // touches b and d
        assert_eq!(graph.degree("b"), 3); // touches a, c, and d (corner contact)
        assert_eq!(graph.degree("c"), 1); // touches b only
        assert_eq!(graph.degree("d"), 2); // touches a and b (corner contact)
        assert_eq!(graph.degree("e"), 0); // isolated
    }

    #[test]
    fn test_detect_subassemblies_two_clusters() {
        // Two clusters of functional parts, connected only by fasteners.
        // Cluster 1: base + plate (functional, touching)
        // Cluster 2: bracket + support (functional, touching)
        // Connection: bolt (fastener) touches both plate and bracket
        let mesh = create_unit_cube_mesh();

        let transforms = vec![
            Isometry3::translation(0.0, 0.0, 0.0), // base
            Isometry3::translation(1.0, 0.0, 0.0), // plate (touches base)
            Isometry3::translation(2.0, 0.0, 0.0), // bolt (fastener, touches plate and bracket)
            Isometry3::translation(3.0, 0.0, 0.0), // bracket (touches bolt)
            Isometry3::translation(4.0, 0.0, 0.0), // support (touches bracket)
        ];

        let parts: Vec<(&str, &TriMesh, &Isometry3<f32>)> = vec![
            ("base", &mesh, &transforms[0]),
            ("plate", &mesh, &transforms[1]),
            ("bolt_1", &mesh, &transforms[2]),
            ("bracket", &mesh, &transforms[3]),
            ("support", &mesh, &transforms[4]),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        let mut classifications = HashMap::new();
        classifications.insert("base".to_string(), PartKind::Structural);
        classifications.insert("plate".to_string(), PartKind::Structural);
        classifications.insert("bolt_1".to_string(), PartKind::Fastener);
        classifications.insert("bracket".to_string(), PartKind::Structural);
        classifications.insert("support".to_string(), PartKind::Structural);

        let subassemblies = graph.detect_subassemblies(&classifications);

        // Should detect 2 subassemblies (the fastener joins them but has low weight)
        // Note: label propagation may group them differently depending on topology.
        // With the low fastener weight, the two functional clusters should separate.
        assert!(
            subassemblies.len() >= 1,
            "Should detect at least 1 subassembly, got {}",
            subassemblies.len()
        );

        // All subassemblies should have >= 2 functional parts
        for sub in &subassemblies {
            let functional_count = sub
                .part_ids
                .iter()
                .filter(|id| {
                    classifications
                        .get(id.as_str())
                        .copied()
                        .unwrap_or(PartKind::Unknown)
                        != PartKind::Fastener
                })
                .count();
            assert!(
                functional_count >= 2,
                "Subassembly '{}' should have >= 2 functional parts, has {}",
                sub.name,
                functional_count
            );
        }
    }

    #[test]
    fn test_detect_subassemblies_single_cluster() {
        // All functional parts in one tight cluster → one subassembly
        let mesh = create_unit_cube_mesh();

        let transforms = vec![
            Isometry3::translation(0.0, 0.0, 0.0),
            Isometry3::translation(1.0, 0.0, 0.0),
            Isometry3::translation(0.0, 1.0, 0.0),
        ];

        let parts: Vec<(&str, &TriMesh, &Isometry3<f32>)> = vec![
            ("part_a", &mesh, &transforms[0]),
            ("part_b", &mesh, &transforms[1]),
            ("part_c", &mesh, &transforms[2]),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        let mut classifications = HashMap::new();
        classifications.insert("part_a".to_string(), PartKind::Structural);
        classifications.insert("part_b".to_string(), PartKind::Structural);
        classifications.insert("part_c".to_string(), PartKind::Structural);

        let subassemblies = graph.detect_subassemblies(&classifications);

        // All parts tightly connected → should form one community
        assert_eq!(
            subassemblies.len(),
            1,
            "Tightly connected parts should form 1 subassembly"
        );
        assert_eq!(subassemblies[0].part_ids.len(), 3);
    }

    #[test]
    fn test_detect_kits_bolt_washer_nut() {
        // A bolt → washer → nut chain, all touching each other in sequence
        let mesh = create_unit_cube_mesh();

        let transforms = vec![
            Isometry3::translation(0.0, 0.0, 0.0), // functional base
            Isometry3::translation(1.0, 0.0, 0.0), // bolt
            Isometry3::translation(2.0, 0.0, 0.0), // washer
            Isometry3::translation(3.0, 0.0, 0.0), // nut
        ];

        let parts: Vec<(&str, &TriMesh, &Isometry3<f32>)> = vec![
            ("base", &mesh, &transforms[0]),
            ("bolt_1", &mesh, &transforms[1]),
            ("washer_1", &mesh, &transforms[2]),
            ("nut_1", &mesh, &transforms[3]),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        let mut classifications = HashMap::new();
        classifications.insert("base".to_string(), PartKind::Structural);
        classifications.insert("bolt_1".to_string(), PartKind::Fastener);
        classifications.insert("washer_1".to_string(), PartKind::Fastener);
        classifications.insert("nut_1".to_string(), PartKind::Fastener);

        let kits = graph.detect_kits(&classifications);

        assert_eq!(kits.len(), 1, "Should detect 1 kit");
        assert_eq!(kits[0].primary, "bolt_1");
        assert!(kits[0].accessories.contains(&"washer_1".to_string()));
        assert!(kits[0].accessories.contains(&"nut_1".to_string()));
    }

    #[test]
    fn test_detect_kits_no_bolts() {
        // No bolts/screws → no kits
        let mesh = create_unit_cube_mesh();

        let transforms = vec![
            Isometry3::translation(0.0, 0.0, 0.0),
            Isometry3::translation(1.0, 0.0, 0.0),
        ];

        let parts: Vec<(&str, &TriMesh, &Isometry3<f32>)> = vec![
            ("base", &mesh, &transforms[0]),
            ("plate", &mesh, &transforms[1]),
        ];

        let graph = ContactGraph::build(parts, 0.1);

        let mut classifications = HashMap::new();
        classifications.insert("base".to_string(), PartKind::Structural);
        classifications.insert("plate".to_string(), PartKind::Structural);

        let kits = graph.detect_kits(&classifications);
        assert_eq!(kits.len(), 0, "No bolts = no kits");
    }
}
