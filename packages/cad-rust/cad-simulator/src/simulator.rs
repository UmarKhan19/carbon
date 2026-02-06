//! Main assembly simulator implementation.

use cad_common::{AssemblyNode, AssemblyStep, AnimationKeyframe, SimulationResult};
use nalgebra::{Isometry3, Matrix4, Point3, Translation3, UnitQuaternion, Vector3};
use nalgebra::Unit;
use parry3d::shape::TriMesh;
use rapier3d::prelude::*;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::contact_graph::ContactGraph;
use crate::dependency_graph::{DependencyGraph, DEFAULT_FASTENER_THRESHOLD, DEFAULT_STRUCTURAL_THRESHOLD};
use crate::sequence::{
    classify_all_parts,
    disassembly_priority,
    infer_part_kind,
    PartClassification,
    PartKind,
    SequencingRules,
};

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
    /// Collision clearance epsilon (0 = auto based on part size).
    pub clearance_epsilon: f32,
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 60_000,
            removal_distance: 100.0,
            removal_steps: 50,
            check_stability: true,
            gravity: Vector3::new(0.0, -9.81, 0.0),
            clearance_epsilon: 0.0,
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

#[derive(Debug, Clone)]
enum RemovalMotion {
    Linear,
    Helix { axis: Vector3<f32>, turns: f32 },
}

#[derive(Debug, Clone)]
struct RemovalPath {
    direction: Vector3<f32>,
    motion: RemovalMotion,
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

        // Log part names for classification debugging
        let part_names: Vec<&str> = self.parts.iter().map(|p| p.name.as_str()).collect();
        info!("Loaded {} parts with names: {:?}", self.parts.len(), part_names);

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
    ///
    /// Uses a constraint-aware disassembly algorithm:
    /// 1. Build contact graph to find which parts touch
    /// 2. Classify parts (fasteners, structural, panels)
    /// 3. Build dependency graph (assembly order constraints)
    /// 4. Find geometrically removable parts
    /// 5. Filter by dependency constraints
    /// 6. Sort by classification (fasteners first in disassembly)
    pub fn compute_sequence(&mut self) -> Result<SimulationResult, SimulatorError> {
        let start_time = Instant::now();
        let mut steps: Vec<AssemblyStep> = Vec::new();
        let mut step_number = 1u32;

        info!("Starting assembly sequence computation");

        // ════════════════════════════════════════════════════════════════════
        // Build contact graph
        // ════════════════════════════════════════════════════════════════════
        let contact_threshold = self.config.removal_distance * 0.001;
        let contact_graph = ContactGraph::build(
            self.parts.iter().map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            contact_threshold,
        );
        info!(
            "Contact graph: {} contacts among {} parts",
            contact_graph.edge_count(),
            contact_graph.node_count()
        );

        // ════════════════════════════════════════════════════════════════════
        // Classify all parts
        // ════════════════════════════════════════════════════════════════════
        let total_volume: f32 = self
            .parts
            .iter()
            .map(|p| p.bounding_box_size.x * p.bounding_box_size.y * p.bounding_box_size.z)
            .sum();

        let rules = SequencingRules::default();
        let classifications = classify_all_parts(
            self.parts.iter().map(|p| (p.id.as_str(), p.name.as_str(), &p.bounding_box_size)),
            &contact_graph,
            total_volume,
            &rules,
        );

        // Infer coarse part kinds (fastener / structural / panel) from names + scores
        let mut kinds: HashMap<String, PartKind> = HashMap::new();
        for part in &self.parts {
            if let Some(class) = classifications.get(&part.id) {
                kinds.insert(part.id.clone(), infer_part_kind(&part.name, class, &rules));
            }
        }

        // Log classifications for debugging
        for (id, class) in &classifications {
            let name = self.get_part_name(id).unwrap_or("?");
            let kind = kinds.get(id).copied().unwrap_or(PartKind::Unknown);
            debug!(
                "Classification: {} ({}) → fastener={:.2}, structural={:.2}, panel={:.2}, kind={:?}",
                name, id, class.fastener_score, class.structural_score, class.panel_score, kind
            );
        }

        // ════════════════════════════════════════════════════════════════════
        // Build dependency graph
        // ════════════════════════════════════════════════════════════════════
        let dependency_graph = DependencyGraph::build(
            &contact_graph,
            &classifications,
            &kinds,
            DEFAULT_FASTENER_THRESHOLD,
            DEFAULT_STRUCTURAL_THRESHOLD,
        );
        info!(
            "Dependency graph: {} edges (assembly constraints)",
            dependency_graph.edge_count()
        );

        // Derive a clearance epsilon from part sizes (unless configured)
        let min_dim = self
            .parts
            .iter()
            .map(|p| p.bounding_box_size.x.min(p.bounding_box_size.y.min(p.bounding_box_size.z)))
            .fold(f32::MAX, f32::min)
            .max(0.001);
        let clearance = if self.config.clearance_epsilon > 0.0 {
            self.config.clearance_epsilon
        } else {
            // 2% of the smallest dimension helps avoid near-intersections
            (min_dim * 0.02).max(1.0e-4)
        };

        // ════════════════════════════════════════════════════════════════════
        // Main disassembly loop with constraints
        // ════════════════════════════════════════════════════════════════════
        while self.removed_parts.len() < self.parts.len() {
            // Check timeout
            if start_time.elapsed().as_millis() as u64 > self.config.timeout_ms {
                return Err(SimulatorError::Timeout(self.config.timeout_ms));
            }

            // Find parts that can be removed (geometrically)
            let removable = self.find_removable_parts(&contact_graph, &kinds, clearance);

            // ════════════════════════════════════════════════════════════════
            // Filter by dependency constraints
            // ════════════════════════════════════════════════════════════════
            // In disassembly: can only remove a part if all parts that depend
            // on it (in assembly order) have already been removed.
            let constrained: Vec<_> = removable
                .iter()
                .filter(|(part_id, _)| dependency_graph.can_disassemble(part_id, &self.removed_parts))
                .cloned()
                .collect();

            // Sort by classification: fasteners first, then panels, then structural
            let mut to_process = if constrained.is_empty() {
                if !removable.is_empty() {
                    warn!(
                        "Dependency constraints conflict with geometry for {} parts, falling back",
                        removable.len()
                    );
                }
                removable.clone()
            } else {
                constrained
            };

            let default_class = PartClassification::default();
            // Sort: higher disassembly priority = removed first (assembled last)
            to_process.sort_by(|(id_a, _), (id_b, _)| {
                let class_a = classifications.get(id_a).unwrap_or(&default_class);
                let class_b = classifications.get(id_b).unwrap_or(&default_class);
                let kind_a = kinds.get(id_a).copied().unwrap_or(PartKind::Unknown);
                let kind_b = kinds.get(id_b).copied().unwrap_or(PartKind::Unknown);
                let score_a = disassembly_priority(kind_a, class_a);
                let score_b = disassembly_priority(kind_b, class_b);
                score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
            });

            if to_process.is_empty() {
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

            // Process parts in constrained order
            for (part_id, path) in to_process {
                let Some(part) = self.parts.iter().find(|p| p.id == part_id) else {
                    continue; // Part not found, skip
                };

                // Generate animation keyframes
                let animation_path = self.generate_animation_path_for_motion(part, &path);

                // Create assembly step
                let step = AssemblyStep {
                    step_number,
                    part_ids: vec![part_id.clone()],
                    part_names: vec![part.name.clone()],
                    assembly_direction: [
                        -path.direction.x,
                        -path.direction.y,
                        -path.direction.z,
                    ], // Reverse for assembly
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

    /// Get a part's name by its ID.
    fn get_part_name(&self, part_id: &str) -> Option<&str> {
        self.parts
            .iter()
            .find(|p| p.id == part_id)
            .map(|p| p.name.as_str())
    }

    /// Find all parts that can be removed in the current state.
    ///
    /// Direction candidates are derived from:
    /// 1. Contact normals (best signal for separation)
    /// 2. Part-local axes (from transform rotation)
    /// 3. Global axes + diagonals (fallback)
    fn find_removable_parts(
        &self,
        contact_graph: &ContactGraph,
        kinds: &HashMap<String, PartKind>,
        clearance: f32,
    ) -> Vec<(String, RemovalPath)> {
        let mut removable = Vec::new();

        for part in &self.parts {
            if self.removed_parts.contains(&part.id) {
                continue;
            }

            let paths = self.candidate_paths_for_part(part, contact_graph, kinds);

            // Test each path (in priority order)
            for path in &paths {
                if self.can_remove_with_motion(&part.id, path, clearance) {
                    debug!(
                        "Part {} can be removed in direction {:?}",
                        part.name, path.direction
                    );
                    removable.push((part.id.clone(), path.clone()));
                    break; // One path is enough
                }
            }
        }

        removable
    }

    /// Build candidate removal paths for a part.
    ///
    /// Contact normals are tried first; axes are used as fallbacks.
    fn candidate_paths_for_part(
        &self,
        part: &PartData,
        contact_graph: &ContactGraph,
        kinds: &HashMap<String, PartKind>,
    ) -> Vec<RemovalPath> {
        let mut directions = self.candidate_directions_for_part(part, contact_graph);

        let mut paths: Vec<RemovalPath> = Vec::new();

        let kind = kinds.get(&part.id).copied().unwrap_or(PartKind::Unknown);
        if kind == PartKind::Fastener {
            if let Some(axis) = self.fastener_axis_world(part) {
                let axis = axis.normalize();
                // Prefer helix along the fastener axis
                paths.push(RemovalPath {
                    direction: axis,
                    motion: RemovalMotion::Helix { axis, turns: 2.0 },
                });
                paths.push(RemovalPath {
                    direction: -axis,
                    motion: RemovalMotion::Helix { axis: -axis, turns: 2.0 },
                });

                // Also try linear along axis before other directions
                directions.insert(0, axis);
                directions.insert(0, -axis);
            }
        }

        for dir in directions {
            paths.push(RemovalPath {
                direction: dir,
                motion: RemovalMotion::Linear,
            });
        }

        paths
    }

    /// Estimate a fastener axis in world space from the part's bounding box.
    fn fastener_axis_world(&self, part: &PartData) -> Option<Vector3<f32>> {
        let dims = part.bounding_box_size;
        let (axis_local, max_dim) = if dims.x >= dims.y && dims.x >= dims.z {
            (Vector3::x(), dims.x)
        } else if dims.y >= dims.x && dims.y >= dims.z {
            (Vector3::y(), dims.y)
        } else {
            (Vector3::z(), dims.z)
        };

        if max_dim <= 0.0 {
            return None;
        }

        Some(part.transform.rotation * axis_local)
    }

    /// Build candidate removal directions for a part.
    ///
    /// Contact normals are tried first; axes are used as fallbacks.
    fn candidate_directions_for_part(
        &self,
        part: &PartData,
        contact_graph: &ContactGraph,
    ) -> Vec<Vector3<f32>> {
        let mut directions: Vec<Vector3<f32>> = Vec::new();

        let mut add_dir = |dir: Vector3<f32>| {
            if dir.norm_squared() < 1.0e-8 {
                return;
            }
            let n = dir.normalize();
            for existing in &directions {
                if existing.dot(&n) > 0.98 {
                    return;
                }
            }
            directions.push(n);
        };

        // 1) Contact normals (move away from neighbors)
        for contact in contact_graph.contacts_for(&part.id) {
            if contact.part_a == part.id {
                add_dir(-contact.estimated_normal);
            } else {
                add_dir(contact.estimated_normal);
            }
        }

        // 2) Part-local axes (from transform rotation)
        let rot = part.transform.rotation;
        add_dir(rot * Vector3::x());
        add_dir(-(rot * Vector3::x()));
        add_dir(rot * Vector3::y());
        add_dir(-(rot * Vector3::y()));
        add_dir(rot * Vector3::z());
        add_dir(-(rot * Vector3::z()));

        // 3) Global axes and diagonals as fallback
        let s = 1.0_f32 / 2.0_f32.sqrt(); // normalized diagonal component
        let fallback = [
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(-1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, -1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            Vector3::new(0.0, 0.0, -1.0),
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
        for dir in fallback {
            add_dir(dir);
        }

        directions
    }

    /// Test if a part can be removed along a motion path without collision.
    ///
    /// Starts the sweep from step 1 (not 0) because assembled parts are
    /// typically in contact at rest. We only care about *new* collisions
    /// that occur as the part moves away, not the initial mating contact.
    fn can_remove_with_motion(&self, part_id: &str, path: &RemovalPath, clearance: f32) -> bool {
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

        match &path.motion {
            RemovalMotion::Linear => {
                self.can_remove_linear(part, &path.direction, clearance, &other_parts)
            }
            RemovalMotion::Helix { axis, turns } => {
                self.can_remove_helix(part, axis, *turns, clearance, &other_parts)
            }
        }
    }

    fn can_remove_linear(
        &self,
        part: &PartData,
        direction: &Vector3<f32>,
        clearance: f32,
        other_parts: &[&PartData],
    ) -> bool {
        // Adaptive step size based on smallest part dimension to reduce
        // tunneling between checks.
        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let max_step = (min_dim * 0.25).max(0.001);
        let adaptive_steps =
            (self.config.removal_distance / max_step).ceil().max(self.config.removal_steps as f32);
        let steps = adaptive_steps as u32;
        let step_distance = self.config.removal_distance / steps as f32;

        for step in 1..=steps {
            let offset = direction * (step as f32 * step_distance);
            let test_transform = Translation3::from(offset) * part.transform;

            // Check collision with each other part
            for other in other_parts {
                if self.check_collision_with_clearance(
                    &part.mesh,
                    &test_transform,
                    &other.mesh,
                    &other.transform,
                    clearance,
                ) {
                    return false;
                }
            }
        }

        true
    }

    fn can_remove_helix(
        &self,
        part: &PartData,
        axis: &Vector3<f32>,
        turns: f32,
        clearance: f32,
        other_parts: &[&PartData],
    ) -> bool {
        let axis_unit = Unit::new_normalize(*axis);

        // Use similar step sizing to linear removal
        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let max_step = (min_dim * 0.25).max(0.001);
        let adaptive_steps =
            (self.config.removal_distance / max_step).ceil().max(self.config.removal_steps as f32);
        let steps = adaptive_steps as u32;

        for step in 1..=steps {
            let t = step as f32 / steps as f32;
            let offset = axis * (self.config.removal_distance * t);
            let angle = turns * std::f32::consts::TAU * t;

            let rotation = UnitQuaternion::from_axis_angle(&axis_unit, angle);
            let new_translation = part.transform.translation.vector + offset;
            let test_transform = Isometry3::from_parts(
                Translation3::from(new_translation),
                rotation * part.transform.rotation,
            );

            for other in other_parts {
                if self.check_collision_with_clearance(
                    &part.mesh,
                    &test_transform,
                    &other.mesh,
                    &other.transform,
                    clearance,
                ) {
                    return false;
                }
            }
        }

        true
    }

    /// Check if two meshes are colliding.
    fn check_collision_with_clearance(
        &self,
        mesh_a: &TriMesh,
        transform_a: &Isometry3<f32>,
        mesh_b: &TriMesh,
        transform_b: &Isometry3<f32>,
        clearance: f32,
    ) -> bool {
        use parry3d::query;

        // Use parry3d intersection test
        if query::intersection_test(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(false) {
            return true;
        }

        if clearance > 0.0 {
            let dist = query::distance(transform_a, mesh_a, transform_b, mesh_b).unwrap_or(f32::MAX);
            return dist < clearance;
        }

        false
    }

    /// Generate animation keyframes for a part removal.
    fn generate_animation_path_for_motion(
        &self,
        part: &PartData,
        path: &RemovalPath,
    ) -> Vec<AnimationKeyframe> {
        match &path.motion {
            RemovalMotion::Linear => {
                let mut keyframes = Vec::new();

                // Start position
                keyframes.push(AnimationKeyframe {
                    time: 0.0,
                    transform: isometry_to_matrix4(&part.transform),
                });

                // End position (removed)
                let end_offset = path.direction * self.config.removal_distance;
                let end_transform = Translation3::from(end_offset) * part.transform;
                keyframes.push(AnimationKeyframe {
                    time: 1.0,
                    transform: isometry_to_matrix4(&end_transform),
                });

                keyframes
            }
            RemovalMotion::Helix { axis, turns } => {
                let axis_unit = Unit::new_normalize(*axis);
                let mut keyframes = Vec::new();
                let steps = 8;

                for i in 0..=steps {
                    let t = i as f32 / steps as f32;
                    let offset = axis * (self.config.removal_distance * t);
                    let angle = turns * std::f32::consts::TAU * t;
                    let rotation = UnitQuaternion::from_axis_angle(&axis_unit, angle);
                    let new_translation = part.transform.translation.vector + offset;
                    let transform = Isometry3::from_parts(
                        Translation3::from(new_translation),
                        rotation * part.transform.rotation,
                    );
                    keyframes.push(AnimationKeyframe {
                        time: t,
                        transform: isometry_to_matrix4(&transform),
                    });
                }

                keyframes
            }
        }
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
    use cad_common::{AssemblyNode, NodeType, TriangleMesh};

    #[test]
    fn test_simulator_config_default() {
        let config = SimulatorConfig::default();
        assert_eq!(config.timeout_ms, 60_000);
        assert_eq!(config.removal_steps, 50);
    }

    fn create_cube_mesh(size: f32) -> TriangleMesh {
        let h = size / 2.0;
        let vertices = vec![
            Point3::new(-h, -h, -h), Point3::new(h, -h, -h),
            Point3::new(h, h, -h), Point3::new(-h, h, -h),
            Point3::new(-h, -h, h), Point3::new(h, -h, h),
            Point3::new(h, h, h), Point3::new(-h, h, h),
        ];
        let indices = vec![
            [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
            [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
        ];
        TriangleMesh { vertices, indices, normals: None }
    }

    fn create_test_part(id: &str, name: &str, mesh: TriangleMesh, transform: Matrix4<f32>) -> AssemblyNode {
        let mut node = AssemblyNode::new_part(name.to_string(), name.to_string(), mesh);
        node.id = id.to_string();
        node.transform = transform;
        node
    }

    /// Integration test: verify fasteners are assembled AFTER structural parts.
    ///
    /// Assembly: base_frame + bracket + 2 bolts
    /// Expected order: base_frame → bracket → bolt_1 → bolt_2
    #[test]
    fn test_realistic_assembly_order() {
        // Create parts with realistic naming
        // Using small dimensions so they can be separated easily
        let base_mesh = create_cube_mesh(10.0);   // Structural part
        let bracket_mesh = create_cube_mesh(8.0); // Medium bracket
        let bolt_mesh = create_cube_mesh(2.0);    // Small fastener

        // Stack vertically so they can be removed in +Y direction
        // Parts touching along Y axis: base at bottom, bracket on top of base, bolts on top of bracket
        let base = create_test_part(
            "part_1", "BASE_FRAME",
            base_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let bracket = create_test_part(
            "part_2", "L_BRACKET",
            bracket_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 9.0, 0.0)), // On top of base (touching)
        );
        let bolt_1 = create_test_part(
            "part_3", "M6_BOLT",
            bolt_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(-2.0, 14.0, 0.0)), // On top of bracket
        );
        let bolt_2 = create_test_part(
            "part_4", "HEX_SCREW",
            bolt_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(2.0, 14.0, 0.0)), // On top of bracket
        );

        // Build assembly tree
        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test Assembly".to_string(),
            original_name: "Test Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![base, bracket, bolt_1, bolt_2],
            metadata: Default::default(),
        };

        // Run simulation
        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        let load_result = simulator.load_assembly(&root);
        assert!(load_result.is_ok(), "Failed to load assembly: {:?}", load_result);

        let result = simulator.compute_sequence();
        assert!(result.is_ok(), "Simulation failed: {:?}", result);

        let result = result.unwrap();
        assert!(result.success, "Simulation not successful: {:?}", result.error);
        assert_eq!(result.steps.len(), 4, "Should have 4 assembly steps");

        // Verify order: structural parts should come before fasteners
        let step_names: Vec<&str> = result.steps.iter()
            .map(|s| s.part_names.first().map(|n| n.as_str()).unwrap_or("?"))
            .collect();

        println!("Assembly order: {:?}", step_names);

        // Find positions
        let base_pos = step_names.iter().position(|n| n.contains("BASE") || n.contains("FRAME"));
        let bracket_pos = step_names.iter().position(|n| n.contains("BRACKET"));
        let bolt_positions: Vec<_> = step_names.iter().enumerate()
            .filter(|(_, n)| n.contains("BOLT") || n.contains("SCREW"))
            .map(|(i, _)| i)
            .collect();

        // Verify: base should come before bolts
        if let (Some(base_p), false) = (base_pos, bolt_positions.is_empty()) {
            for bolt_p in &bolt_positions {
                assert!(
                    base_p < *bolt_p,
                    "BASE_FRAME (pos {}) should be assembled before fasteners (pos {})",
                    base_p, bolt_p
                );
            }
        }

        // Verify: bracket should come before bolts (if bracket contacts bolts)
        if let (Some(bracket_p), false) = (bracket_pos, bolt_positions.is_empty()) {
            for bolt_p in &bolt_positions {
                assert!(
                    bracket_p < *bolt_p,
                    "L_BRACKET (pos {}) should be assembled before fasteners (pos {})",
                    bracket_p, bolt_p
                );
            }
        }

        println!("✓ Assembly order is correct: structural → fasteners");
    }

    #[test]
    fn test_contact_normal_guides_removal_direction() {
        let mesh = create_cube_mesh(2.0);

        // Two cubes touching along +X (B is to the right of A)
        let part_a = create_test_part(
            "part_a",
            "BLOCK_A",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let part_b = create_test_part(
            "part_b",
            "BLOCK_B",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(2.0, 0.0, 0.0)), // touching at x=1
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test Assembly".to_string(),
            original_name: "Test Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![part_a, part_b],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator.parts.iter().map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let kinds: HashMap<String, PartKind> = HashMap::new();
        let removable = simulator.find_removable_parts(&contact_graph, &kinds, 0.0);
        let a_entry = removable
            .iter()
            .find(|(id, _)| id == "part_a")
            .expect("part_a should be removable");

        let dir = a_entry.1.direction.normalize();
        let expected = -Vector3::x();
        let dot = dir.dot(&expected);
        assert!(
            dot > 0.9,
            "Expected removal direction close to -X, got {:?} (dot={})",
            dir,
            dot
        );
    }

    #[test]
    fn test_fastener_prefers_helix_motion() {
        let mesh = create_cube_mesh(1.0);
        let bolt = create_test_part(
            "bolt",
            "M6_BOLT",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test Assembly".to_string(),
            original_name: "Test Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![bolt],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator.parts.iter().map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let mut kinds: HashMap<String, PartKind> = HashMap::new();
        kinds.insert("bolt".to_string(), PartKind::Fastener);

        let removable = simulator.find_removable_parts(&contact_graph, &kinds, 0.0);
        let bolt_entry = removable
            .iter()
            .find(|(id, _)| id == "bolt")
            .expect("bolt should be removable");

        match bolt_entry.1.motion {
            RemovalMotion::Helix { .. } => {}
            _ => panic!("Fastener should prefer helix motion"),
        }
    }
}
