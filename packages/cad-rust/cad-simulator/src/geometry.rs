//! Geometry signature detection for identifying identical parts.
//!
//! Parts with identical geometry (same mesh shape, different positions/orientations)
//! produce identical signatures. This enables step clustering: instead of
//! "Install washer" x14, the UI can show "Install washer (×14)".

use parry3d::shape::TriMesh;
use std::collections::HashMap;
use tracing::debug;

/// Quantized geometry fingerprint — identical parts produce identical signatures.
///
/// Uses quantization (multiply by 1000, round to integer) to handle floating-point
/// noise that can arise from STEP→mesh conversion. Two meshes that differ only in
/// position/orientation in world space will have identical local-frame signatures.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct GeometrySignature {
    /// Number of vertices in the mesh.
    pub vertex_count: usize,
    /// Number of triangles in the mesh.
    pub tri_count: usize,
    /// AABB volume in local frame, quantized to integer (× 1000).
    pub volume_quantized: i64,
    /// AABB extents in local frame, sorted ascending, quantized (× 1000).
    /// Sorting makes the signature rotation-invariant for axis-aligned meshes.
    pub sorted_obb_dims: [i64; 3],
}

impl GeometrySignature {
    /// Compute a geometry signature from a TriMesh in its local frame.
    ///
    /// The signature is position/orientation-independent because it uses
    /// the mesh's local AABB (before any world transform is applied).
    pub fn from_mesh(mesh: &TriMesh) -> Self {
        let vertex_count = mesh.vertices().len();
        let tri_count = mesh.indices().len();

        // Local AABB extents — identical meshes have identical local AABBs
        let aabb = mesh.local_aabb();
        let extents = aabb.extents();
        let mut dims = [
            (extents.x * 1000.0).round() as i64,
            (extents.y * 1000.0).round() as i64,
            (extents.z * 1000.0).round() as i64,
        ];
        dims.sort();

        // AABB volume as a fingerprint component
        let volume = extents.x * extents.y * extents.z;

        GeometrySignature {
            vertex_count,
            tri_count,
            volume_quantized: (volume * 1000.0).round() as i64,
            sorted_obb_dims: dims,
        }
    }
}

/// Groups part IDs by identical geometry. Returns only groups with 2+ members.
///
/// # Arguments
/// * `parts` - Slice of `(part_id, mesh_in_local_frame)` tuples.
///
/// # Returns
/// A vector of groups, where each group contains the IDs of parts with
/// identical geometry signatures.
pub fn find_identical_groups(parts: &[(&str, &TriMesh)]) -> Vec<Vec<String>> {
    let mut sig_map: HashMap<GeometrySignature, Vec<String>> = HashMap::new();

    for (id, mesh) in parts {
        let sig = GeometrySignature::from_mesh(mesh);
        sig_map.entry(sig).or_default().push((*id).to_string());
    }

    let groups: Vec<Vec<String>> = sig_map
        .into_values()
        .filter(|group| group.len() >= 2)
        .collect();

    debug!(
        "Found {} identical geometry groups across {} parts",
        groups.len(),
        parts.len()
    );
    for group in &groups {
        debug!(
            "  Group ({} parts): {:?}",
            group.len(),
            &group[..group.len().min(3)]
        );
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Point3;

    /// Create a unit cube mesh centered at origin.
    fn create_unit_cube() -> TriMesh {
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
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [2, 3, 7],
            [2, 7, 6],
            [0, 4, 7],
            [0, 7, 3],
            [1, 2, 6],
            [1, 6, 5],
        ];
        TriMesh::new(vertices, indices)
    }

    /// Create a small cube (different from unit cube).
    fn create_small_cube() -> TriMesh {
        let vertices = vec![
            Point3::new(-0.1, -0.1, -0.1),
            Point3::new(0.1, -0.1, -0.1),
            Point3::new(0.1, 0.1, -0.1),
            Point3::new(-0.1, 0.1, -0.1),
            Point3::new(-0.1, -0.1, 0.1),
            Point3::new(0.1, -0.1, 0.1),
            Point3::new(0.1, 0.1, 0.1),
            Point3::new(-0.1, 0.1, 0.1),
        ];
        let indices = vec![
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [2, 3, 7],
            [2, 7, 6],
            [0, 4, 7],
            [0, 7, 3],
            [1, 2, 6],
            [1, 6, 5],
        ];
        TriMesh::new(vertices, indices)
    }

    /// Create a cylinder mesh (different topology from cubes).
    fn create_cylinder(radius: f32, height: f32, segments: usize) -> TriMesh {
        let half_h = height / 2.0;
        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        vertices.push(Point3::new(0.0, 0.0, -half_h));
        vertices.push(Point3::new(0.0, 0.0, half_h));

        for i in 0..segments {
            let angle = 2.0 * std::f32::consts::PI * (i as f32) / (segments as f32);
            let x = radius * angle.cos();
            let y = radius * angle.sin();
            vertices.push(Point3::new(x, y, -half_h));
        }
        for i in 0..segments {
            let angle = 2.0 * std::f32::consts::PI * (i as f32) / (segments as f32);
            let x = radius * angle.cos();
            let y = radius * angle.sin();
            vertices.push(Point3::new(x, y, half_h));
        }

        let bot_ring = 2u32;
        let top_ring = bot_ring + segments as u32;

        for i in 0..segments as u32 {
            let next = (i + 1) % segments as u32;
            indices.push([0, bot_ring + next, bot_ring + i]);
            indices.push([1, top_ring + i, top_ring + next]);
            indices.push([bot_ring + i, bot_ring + next, top_ring + i]);
            indices.push([bot_ring + next, top_ring + next, top_ring + i]);
        }

        TriMesh::new(vertices, indices)
    }

    #[test]
    fn test_identical_cubes_grouped() {
        let cube = create_unit_cube();
        let parts: Vec<(&str, &TriMesh)> = vec![
            ("washer_1", &cube),
            ("washer_2", &cube),
            ("washer_3", &cube),
            ("washer_4", &cube),
        ];

        let groups = find_identical_groups(&parts);
        assert_eq!(groups.len(), 1, "All 4 cubes should form one group");
        assert_eq!(groups[0].len(), 4, "Group should have 4 members");
    }

    #[test]
    fn test_different_meshes_not_grouped() {
        let cube = create_unit_cube();
        let small_cube = create_small_cube();
        let cylinder = create_cylinder(0.5, 2.0, 16);

        let parts: Vec<(&str, &TriMesh)> = vec![
            ("cube_a", &cube),
            ("small_cube", &small_cube),
            ("cylinder", &cylinder),
        ];

        let groups = find_identical_groups(&parts);
        assert_eq!(groups.len(), 0, "All different meshes, no groups");
    }

    #[test]
    fn test_mixed_identical_and_different() {
        let cube = create_unit_cube();
        let cylinder = create_cylinder(0.5, 2.0, 16);

        let parts: Vec<(&str, &TriMesh)> = vec![
            ("washer_1", &cube),
            ("bolt_1", &cylinder),
            ("washer_2", &cube),
            ("bolt_2", &cylinder),
            ("washer_3", &cube),
        ];

        let groups = find_identical_groups(&parts);
        assert_eq!(groups.len(), 2, "Should have 2 groups (cubes + cylinders)");

        // Find which group is which
        let cube_group = groups.iter().find(|g| g.len() == 3).unwrap();
        let cyl_group = groups.iter().find(|g| g.len() == 2).unwrap();

        assert!(cube_group.contains(&"washer_1".to_string()));
        assert!(cube_group.contains(&"washer_2".to_string()));
        assert!(cube_group.contains(&"washer_3".to_string()));
        assert!(cyl_group.contains(&"bolt_1".to_string()));
        assert!(cyl_group.contains(&"bolt_2".to_string()));
    }

    #[test]
    fn test_single_part_no_group() {
        let cube = create_unit_cube();
        let parts: Vec<(&str, &TriMesh)> = vec![("only_one", &cube)];

        let groups = find_identical_groups(&parts);
        assert_eq!(groups.len(), 0, "Single part cannot form a group");
    }

    #[test]
    fn test_signature_deterministic() {
        let cube = create_unit_cube();
        let sig1 = GeometrySignature::from_mesh(&cube);
        let sig2 = GeometrySignature::from_mesh(&cube);
        assert_eq!(sig1, sig2, "Same mesh should produce same signature");
    }

    #[test]
    fn test_signature_different_for_different_sizes() {
        let cube = create_unit_cube();
        let small = create_small_cube();
        let sig_cube = GeometrySignature::from_mesh(&cube);
        let sig_small = GeometrySignature::from_mesh(&small);
        assert_ne!(
            sig_cube, sig_small,
            "Different sized cubes should have different signatures"
        );
    }
}
