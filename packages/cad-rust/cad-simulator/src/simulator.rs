//! Main assembly simulator implementation.

use cad_common::{AssemblyNode, AssemblyStep, AnimationKeyframe, SimulationResult};
use nalgebra::{Isometry3, Matrix4, Point3, Translation3, UnitQuaternion, Vector3};
use parry3d::shape::TriMesh;
use rapier3d::prelude::*;
use std::collections::HashSet;
use std::time::Instant;
use thiserror::Error;
use tracing::{debug, info, warn};

/// Errors that can occur during simulation.
#[derive(Debug, Error)]
pub enum SimulatorError {
    #[error("No parts found in assembly")]
    NoParts,
    #[error("Invalid mesh data for part {0}")]
    InvalidMesh(String),
    #[error("Simulation timeout after {0}ms")]
    Timeout(u64),
    #[error("All remaining parts are stuck: {0:?}")]
    AllPartsStuck(Vec<String>),
}

/// Configuration for the assembly simulator.
#[derive(Debug, Clone)]
pub struct SimulatorConfig {
    /// Maximum simulation time in milliseconds.
    pub timeout_ms: u64,
    /// Distance to test for part removal (in model units).
    pub removal_distance: f32,
    /// Number of steps to test for collision-free removal.
    pub removal_steps: u32,
    /// Whether to check gravitational stability.
    pub check_stability: bool,
    /// Gravity direction (usually negative Y).
    pub gravity: Vector3<f32>,
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 60_000,
            removal_distance: 100.0,
            removal_steps: 50,
            check_stability: true,
            gravity: Vector3::new(0.0, -9.81, 0.0),
        }
    }
}

/// The main assembly simulator.
pub struct AssemblySimulator {
    config: SimulatorConfig,
    parts: Vec<PartData>,
    removed_parts: HashSet<String>,
}

/// Internal representation of a part for simulation.
struct PartData {
    id: String,
    name: String,
    mesh: TriMesh,
    transform: Isometry3<f32>,
    bounding_box_size: Vector3<f32>,
}

impl AssemblySimulator {
    /// Create a new simulator with the given configuration.
    pub fn new(config: SimulatorConfig) -> Self {
        Self {
            config,
            parts: Vec::new(),
            removed_parts: HashSet::new(),
        }
    }

    /// Load an assembly tree into the simulator.
    ///
    /// After loading, auto-scales `removal_distance` to 2x the assembly
    /// bounding box diagonal so the sweep is always large enough to clear
    /// any part, regardless of model units (mm, inches, etc.).
    pub fn load_assembly(&mut self, root: &AssemblyNode) -> Result<(), SimulatorError> {
        self.parts.clear();
        self.removed_parts.clear();

        // Collect all parts from the tree
        let parts = root.get_all_parts();
        if parts.is_empty() {
            return Err(SimulatorError::NoParts);
        }

        // Track global bounding box to auto-scale removal distance
        let mut global_min = Point3::new(f32::MAX, f32::MAX, f32::MAX);
        let mut global_max = Point3::new(f32::MIN, f32::MIN, f32::MIN);

        for part in parts {
            if let Some(mesh) = &part.mesh {
                // Convert our mesh format to parry3d TriMesh
                let vertices: Vec<Point3<f32>> = mesh.vertices.clone();
                let indices: Vec<[u32; 3]> = mesh.indices.clone();

                if vertices.is_empty() || indices.is_empty() {
                    warn!("Skipping part {} with empty mesh", part.id);
                    continue;
                }

                // Update global bounding box from mesh vertices + transform
                let transform = matrix4_to_isometry(&part.transform);
                for v in &vertices {
                    let world_pt = transform * v;
                    global_min.x = global_min.x.min(world_pt.x);
                    global_min.y = global_min.y.min(world_pt.y);
                    global_min.z = global_min.z.min(world_pt.z);
                    global_max.x = global_max.x.max(world_pt.x);
                    global_max.y = global_max.y.max(world_pt.y);
                    global_max.z = global_max.z.max(world_pt.z);
                }

                let tri_mesh = TriMesh::new(vertices, indices);

                // Compute bounding box size
                let bbox = mesh.bounding_box();
                let bbox_size = bbox
                    .map(|b| b.size())
                    .unwrap_or_else(|| Vector3::new(1.0, 1.0, 1.0));

                self.parts.push(PartData {
                    id: part.id.clone(),
                    name: part.name.clone(),
                    mesh: tri_mesh,
                    transform,
                    bounding_box_size: bbox_size,
                });
            }
        }

        if self.parts.is_empty() {
            return Err(SimulatorError::NoParts);
        }

        // Auto-scale removal distance to 2x the assembly diagonal
        let diagonal = (global_max - global_min).magnitude();
        if diagonal > 0.0 {
            self.config.removal_distance = diagonal * 2.0;
            info!(
                "Assembly bounding box: min={:?}, max={:?}, diagonal={:.1}, removal_distance={:.1}",
                global_min, global_max, diagonal, self.config.removal_distance
            );
        }

        info!("Loaded {} parts into simulator", self.parts.len());
        Ok(())
    }

    /// Run the assembly sequence simulation.
    pub fn compute_sequence(&mut self) -> Result<SimulationResult, SimulatorError> {
        let start_time = Instant::now();
        let mut steps: Vec<AssemblyStep> = Vec::new();
        let mut step_number = 1u32;

        info!("Starting assembly sequence computation");

        while self.removed_parts.len() < self.parts.len() {
            // Check timeout
            if start_time.elapsed().as_millis() as u64 > self.config.timeout_ms {
                return Err(SimulatorError::Timeout(self.config.timeout_ms));
            }

            // Find parts that can be removed
            let removable = self.find_removable_parts();

            if removable.is_empty() {
                // No more parts can be removed - some are stuck
                let stuck: Vec<String> = self
                    .parts
                    .iter()
                    .filter(|p| !self.removed_parts.contains(&p.id))
                    .map(|p| p.id.clone())
                    .collect();

                warn!("Stuck parts: {:?}", stuck);

                return Ok(SimulationResult {
                    steps,
                    stuck_parts: stuck,
                    simulation_time_ms: start_time.elapsed().as_millis() as u64,
                    success: false,
                    error: Some("Some parts cannot be disassembled".to_string()),
                });
            }

            // Process removable parts
            for (part_id, direction) in removable {
                let Some(part) = self.parts.iter().find(|p| p.id == part_id) else {
                    continue; // Part not found, skip
                };

                // Generate animation keyframes
                let animation_path = self.generate_animation_path(part, &direction);

                // Create assembly step
                let step = AssemblyStep {
                    step_number,
                    part_ids: vec![part_id.clone()],
                    part_names: vec![part.name.clone()],
                    assembly_direction: [-direction.x, -direction.y, -direction.z], // Reverse for assembly
                    animation_path,
                    suggested_duration_ms: 1500,
                };

                steps.push(step);
                self.removed_parts.insert(part_id);
                step_number += 1;
            }
        }

        // Reverse steps for assembly order
        steps.reverse();
        for (i, step) in steps.iter_mut().enumerate() {
            step.step_number = (i + 1) as u32;
            // Reverse animation keyframes
            step.animation_path.reverse();
            for kf in &mut step.animation_path {
                kf.time = 1.0 - kf.time;
            }
        }

        info!(
            "Computed {} assembly steps in {}ms",
            steps.len(),
            start_time.elapsed().as_millis()
        );

        Ok(SimulationResult {
            steps,
            stuck_parts: Vec::new(),
            simulation_time_ms: start_time.elapsed().as_millis() as u64,
            success: true,
            error: None,
        })
    }

    /// Find all parts that can be removed in the current state.
    ///
    /// Tests 6 cardinal + 8 diagonal directions. Diagonal directions are
    /// needed for interlocking geometries (e.g. L-brackets) that can't be
    /// separated along any single axis.
    fn find_removable_parts(&self) -> Vec<(String, Vector3<f32>)> {
        let s = 1.0_f32 / 2.0_f32.sqrt(); // normalized diagonal component
        let directions = [
            // Cardinal directions (axis-aligned)
            Vector3::new(1.0, 0.0, 0.0),  // +X
            Vector3::new(-1.0, 0.0, 0.0), // -X
            Vector3::new(0.0, 1.0, 0.0),  // +Y
            Vector3::new(0.0, -1.0, 0.0), // -Y
            Vector3::new(0.0, 0.0, 1.0),  // +Z
            Vector3::new(0.0, 0.0, -1.0), // -Z
            // Diagonal directions (for interlocking geometries)
            Vector3::new(s, s, 0.0),
            Vector3::new(s, -s, 0.0),
            Vector3::new(-s, s, 0.0),
            Vector3::new(-s, -s, 0.0),
            Vector3::new(s, 0.0, s),
            Vector3::new(s, 0.0, -s),
            Vector3::new(-s, 0.0, s),
            Vector3::new(-s, 0.0, -s),
            Vector3::new(0.0, s, s),
            Vector3::new(0.0, s, -s),
            Vector3::new(0.0, -s, s),
            Vector3::new(0.0, -s, -s),
        ];

        let mut removable = Vec::new();

        for part in &self.parts {
            if self.removed_parts.contains(&part.id) {
                continue;
            }

            // Test each direction
            for direction in &directions {
                if self.can_remove_in_direction(&part.id, direction) {
                    debug!("Part {} can be removed in direction {:?}", part.name, direction);
                    removable.push((part.id.clone(), *direction));
                    break; // One direction is enough
                }
            }
        }

        removable
    }

    /// Test if a part can be removed in a given direction without collision.
    ///
    /// Starts the sweep from step 1 (not 0) because assembled parts are
    /// typically in contact at rest. We only care about *new* collisions
    /// that occur as the part moves away, not the initial mating contact.
    fn can_remove_in_direction(&self, part_id: &str, direction: &Vector3<f32>) -> bool {
        let part = match self.parts.iter().find(|p| p.id == part_id) {
            Some(p) => p,
            None => return false,
        };

        // Get other non-removed parts
        let other_parts: Vec<&PartData> = self
            .parts
            .iter()
            .filter(|p| p.id != part_id && !self.removed_parts.contains(&p.id))
            .collect();

        if other_parts.is_empty() {
            return true; // No obstacles
        }

        // Test collision at multiple points along the removal path.
        // Start from step 1 to skip the rest position where parts are
        // in designed contact (mating faces, bolt-in-hole, etc.).
        let step_distance = self.config.removal_distance / self.config.removal_steps as f32;

        for step in 1..=self.config.removal_steps {
            let offset = direction * (step as f32 * step_distance);
            let test_transform = Translation3::from(offset) * part.transform;

            // Check collision with each other part
            for other in &other_parts {
                if self.check_collision(&part.mesh, &test_transform, &other.mesh, &other.transform) {
                    return false;
                }
            }
        }

        true
    }

    /// Check if two meshes are colliding.
    fn check_collision(
        &self,
        mesh_a: &TriMesh,
        transform_a: &Isometry3<f32>,
        mesh_b: &TriMesh,
        transform_b: &Isometry3<f32>,
    ) -> bool {
        use parry3d::query;

        // Use parry3d intersection test
        query::intersection_test(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(false)
    }

    /// Generate animation keyframes for a part removal.
    fn generate_animation_path(&self, part: &PartData, direction: &Vector3<f32>) -> Vec<AnimationKeyframe> {
        let mut keyframes = Vec::new();

        // Start position
        keyframes.push(AnimationKeyframe {
            time: 0.0,
            transform: isometry_to_matrix4(&part.transform),
        });

        // End position (removed)
        let end_offset = direction * self.config.removal_distance;
        let end_transform = Translation3::from(end_offset) * part.transform;
        keyframes.push(AnimationKeyframe {
            time: 1.0,
            transform: isometry_to_matrix4(&end_transform),
        });

        keyframes
    }
}

/// Convert a Matrix4 to an Isometry3.
fn matrix4_to_isometry(m: &Matrix4<f32>) -> Isometry3<f32> {
    let translation = Translation3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    let rotation = UnitQuaternion::from_matrix(
        &m.fixed_view::<3, 3>(0, 0).into_owned(),
    );
    Isometry3::from_parts(translation, rotation)
}

/// Convert an Isometry3 to a Matrix4.
fn isometry_to_matrix4(iso: &Isometry3<f32>) -> Matrix4<f32> {
    iso.to_homogeneous()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simulator_config_default() {
        let config = SimulatorConfig::default();
        assert_eq!(config.timeout_ms, 60_000);
        assert_eq!(config.removal_steps, 50);
    }
}
