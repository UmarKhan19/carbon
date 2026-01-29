//! Collision detection helpers.

use nalgebra::{Isometry3, Vector3};
use parry3d::query;
use parry3d::shape::TriMesh;

/// Result of a collision query.
#[derive(Debug, Clone)]
pub struct CollisionResult {
    /// Whether collision was detected.
    pub colliding: bool,
    /// Penetration depth (if colliding).
    pub penetration_depth: Option<f32>,
    /// Contact normal (if colliding).
    pub contact_normal: Option<Vector3<f32>>,
}

/// Check for collision between two meshes.
pub fn check_mesh_collision(
    mesh_a: &TriMesh,
    transform_a: &Isometry3<f32>,
    mesh_b: &TriMesh,
    transform_b: &Isometry3<f32>,
) -> CollisionResult {
    let colliding = query::intersection_test(transform_a, mesh_a, transform_b, mesh_b)
        .unwrap_or(false);

    CollisionResult {
        colliding,
        penetration_depth: None, // Could be computed with contact query
        contact_normal: None,
    }
}

/// Check if a mesh can be moved along a path without collision.
pub fn check_path_collision(
    mesh: &TriMesh,
    start_transform: &Isometry3<f32>,
    direction: &Vector3<f32>,
    distance: f32,
    steps: u32,
    obstacles: &[(TriMesh, Isometry3<f32>)],
) -> bool {
    use nalgebra::Translation3;

    let step_distance = distance / steps as f32;

    for step in 0..=steps {
        let offset = direction * (step as f32 * step_distance);
        let test_transform = Translation3::from(offset) * start_transform;

        for (obstacle_mesh, obstacle_transform) in obstacles {
            if query::intersection_test(&test_transform, mesh, obstacle_transform, obstacle_mesh)
                .unwrap_or(false)
            {
                return true; // Collision detected
            }
        }
    }

    false // No collision along path
}

/// Find the minimum distance between two meshes.
pub fn mesh_distance(
    mesh_a: &TriMesh,
    transform_a: &Isometry3<f32>,
    mesh_b: &TriMesh,
    transform_b: &Isometry3<f32>,
) -> f32 {
    query::distance(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(f32::MAX)
}
