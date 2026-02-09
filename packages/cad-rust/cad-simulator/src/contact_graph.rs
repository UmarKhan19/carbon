//! Contact graph for assembly part relationships.
//!
//! The contact graph captures which parts are in physical contact (or very close)
//! in the assembled state. This information is used to:
//! - Determine fastener dependencies (fasteners connect the parts they touch)
//! - Identify structural parts (parts with many contacts are likely structural)
//! - Build assembly constraints (parts must be in position before their fasteners)

use nalgebra::{Isometry3, Point3, Vector3};
use parry3d::query;
use parry3d::query::PointQuery;
use parry3d::shape::TriMesh;
use std::collections::HashMap;
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
    /// O(n²) in number of parts. For assemblies with >500 parts, consider
    /// adding a broad-phase filter using bounding box overlap.
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

        // Pairwise distance computation
        for i in 0..n {
            for j in (i + 1)..n {
                let (id_a, mesh_a, transform_a) = parts_vec[i];
                let (id_b, mesh_b, transform_b) = parts_vec[j];

                // Compute minimum distance between meshes
                let dist =
                    query::distance(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(f32::MAX);

                if dist < threshold {
                    // Area-weighted triangle normal voting for robust contact direction
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

                    // Add to adjacency lists
                    adjacency.get_mut(id_a).unwrap().push(edge_idx);
                    adjacency.get_mut(id_b).unwrap().push(edge_idx);

                    debug!("Contact: {} <-> {} (dist={:.4})", id_a, id_b, dist);
                }
            }
        }

        info!(
            "Contact graph built: {} edges among {} parts",
            edges.len(),
            n
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
