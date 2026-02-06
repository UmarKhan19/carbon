//! Contact graph for assembly part relationships.
//!
//! The contact graph captures which parts are in physical contact (or very close)
//! in the assembled state. This information is used to:
//! - Determine fastener dependencies (fasteners connect the parts they touch)
//! - Identify structural parts (parts with many contacts are likely structural)
//! - Build assembly constraints (parts must be in position before their fasteners)

use nalgebra::{Isometry3, Point3, Vector3};
use parry3d::query;
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
                let dist = query::distance(transform_a, mesh_a, transform_b, mesh_b)
                    .unwrap_or(f32::MAX);

                if dist < threshold {
                    // Get closest points for contact location and normal
                    let (contact_point, normal) =
                        Self::compute_contact_info(mesh_a, transform_a, mesh_b, transform_b);

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

                    debug!(
                        "Contact: {} <-> {} (dist={:.4})",
                        id_a, id_b, dist
                    );
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

    /// Compute contact point and normal between two meshes.
    fn compute_contact_info(
        mesh_a: &TriMesh,
        transform_a: &Isometry3<f32>,
        mesh_b: &TriMesh,
        transform_b: &Isometry3<f32>,
    ) -> (Point3<f32>, Vector3<f32>) {
        // Use closest_points query to get contact location
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
                // Meshes are intersecting, use centroids as fallback
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
            _ => {
                // Fallback: origin and unit Z
                (Point3::origin(), Vector3::z())
            }
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
            [0, 2, 1], [0, 3, 2], // front
            [4, 5, 6], [4, 6, 7], // back
            [0, 1, 5], [0, 5, 4], // bottom
            [2, 3, 7], [2, 7, 6], // top
            [0, 4, 7], [0, 7, 3], // left
            [1, 2, 6], [1, 6, 5], // right
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
}
