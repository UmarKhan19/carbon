//! Main assembly simulator implementation.

use cad_common::{
    AnimationKeyframe, AssemblyNode, AssemblyStep, PlannerStats, SimulationIssue,
    SimulationIssueKind, SimulationIssueSeverity, SimulationResult,
};

use crate::geometry::find_identical_groups;
use nalgebra::Unit;
use nalgebra::{Isometry3, Matrix4, Point3, Translation3, UnitQuaternion, Vector3};
use parry3d::shape::TriMesh;
use serde_json::json;
use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::contact_graph::ContactGraph;
use crate::dependency_graph::{
    DependencyGraph, DEFAULT_FASTENER_THRESHOLD, DEFAULT_STRUCTURAL_THRESHOLD,
};
use crate::sequence::{
    classify_all_parts, disassembly_priority, infer_part_kind, PartClassification, PartKind,
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
            timeout_ms: 300_000,
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
    collision_checks: Cell<u64>,
    path_evaluations: Cell<u64>,
}

/// Internal representation of a part for simulation.
struct PartData {
    id: String,
    name: String,
    mesh: TriMesh,
    transform: Isometry3<f32>,
    bounding_box_size: Vector3<f32>,
    bbox_min: Point3<f32>,
    bbox_max: Point3<f32>,
    world_aabb_min: Point3<f32>,
    world_aabb_max: Point3<f32>,
}

#[derive(Debug, Clone)]
enum RemovalMotion {
    Linear,
    Helix { axis: Vector3<f32>, turns: f32 },
}

impl RemovalMotion {
    fn label(&self) -> &'static str {
        match self {
            RemovalMotion::Linear => "linear",
            RemovalMotion::Helix { .. } => "helix",
        }
    }
}

#[derive(Debug, Clone)]
struct RemovalPath {
    direction: Vector3<f32>,
    motion: RemovalMotion,
    travel_distance: f32,
}

#[derive(Debug, Clone)]
struct PathEvaluation {
    travel_distance: f32,
    required_distance: f32,
    min_clearance: Option<f32>,
    animation_path: Vec<AnimationKeyframe>,
}

#[derive(Debug, Clone)]
struct RemovableCandidate {
    part_id: String,
    path: RemovalPath,
    evaluation: PathEvaluation,
}

struct NeighborState<'a> {
    part: &'a PartData,
    baseline_intersecting: bool,
    baseline_overlap_volume: f32,
    relaxed_clearance: f32,
}

struct MotionTrace {
    travel_distance: f32,
    min_clearance: Option<f32>,
    sampled_distances: Vec<f32>,
}

const MIN_REMOVAL_RATIO: f32 = 0.90;
const MAX_MOTION_SAMPLING_STEPS: f32 = 100.0;

/// The 6 canonical axis-aligned directions for blocking analysis.
const CANONICAL_DIRECTIONS: [Vector3<f32>; 6] = [
    Vector3::new(1.0, 0.0, 0.0),
    Vector3::new(-1.0, 0.0, 0.0),
    Vector3::new(0.0, 1.0, 0.0),
    Vector3::new(0.0, -1.0, 0.0),
    Vector3::new(0.0, 0.0, 1.0),
    Vector3::new(0.0, 0.0, -1.0),
];
const NUM_CANONICAL_DIRS: usize = 6;

/// Pre-computed directional blocking relationships between assembly parts.
///
/// For each part and each of 6 canonical directions, stores which other parts
/// block removal in that direction. Built once using CCD (`cast_shapes`), then
/// queried each iteration of the disassembly loop as a pre-filter: parts blocked
/// in ALL 6 directions by remaining parts are skipped, avoiding expensive full
/// CCD path evaluation.
///
/// This is a **pre-filter**, not a replacement for CCD. Carbon's path evaluator
/// also tests diagonal and contact-normal-guided directions that the 6-direction
/// matrix doesn't cover — a part that passes the pre-filter still gets full
/// CCD evaluation.
struct BlockingMatrix {
    /// blockers[part_id][dir_index] = set of part IDs blocking that direction.
    blockers: HashMap<String, [HashSet<String>; 6]>,
}

impl BlockingMatrix {
    /// Build the blocking matrix by sweeping each part in 6 canonical directions.
    ///
    /// For each part P × direction × other part Q:
    /// 1. AABB pre-filter: skip if swept AABBs don't overlap
    /// 2. Baseline intersection check: if P and Q already overlap at rest,
    ///    do NOT record Q as a blocker (full evaluator handles these specially)
    /// 3. CCD check: `cast_shapes` → if hit, Q blocks P in this direction
    fn build(parts: &[PartData], sweep_distance: f32, clearance: f32) -> Self {
        let mut blockers: HashMap<String, [HashSet<String>; 6]> = HashMap::new();

        for part in parts {
            blockers.insert(part.id.clone(), Default::default());
        }

        let zero_vel = Vector3::zeros();
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.0,
            target_distance: clearance,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: false,
        };

        for (i, part) in parts.iter().enumerate() {
            for (dir_idx, dir) in CANONICAL_DIRECTIONS.iter().enumerate() {
                let velocity = *dir * sweep_distance;

                for (j, other) in parts.iter().enumerate() {
                    if i == j {
                        continue;
                    }

                    // AABB pre-filter: skip if swept AABB can't overlap other's AABB
                    if !swept_aabb_could_overlap(part, other, dir, sweep_distance, clearance) {
                        continue;
                    }

                    // Skip baseline-intersecting pairs: the full evaluator has special
                    // handling (monotonic overlap reduction). Recording them as blockers
                    // would cause false "trapped" verdicts for overlapping parts.
                    let baseline_intersecting =
                        parry3d::query::intersection_test(
                            &part.transform,
                            &part.mesh,
                            &other.transform,
                            &other.mesh,
                        )
                        .unwrap_or(false);
                    if baseline_intersecting {
                        continue;
                    }

                    // CCD: does `other` block `part` in this direction?
                    match rapier3d::parry::query::cast_shapes(
                        &part.transform,
                        &velocity,
                        &part.mesh,
                        &other.transform,
                        &zero_vel,
                        &other.mesh,
                        options,
                    ) {
                        Ok(Some(_)) => {
                            blockers.get_mut(&part.id).unwrap()[dir_idx]
                                .insert(other.id.clone());
                        }
                        Ok(None) => {} // No collision — not blocking
                        Err(_) => {
                            // Unsupported shape combo — conservatively assume blocking
                            blockers.get_mut(&part.id).unwrap()[dir_idx]
                                .insert(other.id.clone());
                        }
                    }
                }
            }
        }

        BlockingMatrix { blockers }
    }

    /// Check if a part is blocked in ALL 6 canonical directions by remaining parts.
    ///
    /// Returns `true` if every direction has at least one non-removed blocker,
    /// meaning the part cannot be removed along any axis-aligned path.
    /// This is conservative: `true` → definitely skip, `false` → might be removable.
    fn is_blocked_in_all_directions(&self, part_id: &str, removed: &HashSet<String>) -> bool {
        let Some(dir_blockers) = self.blockers.get(part_id) else {
            return false;
        };

        for dir_idx in 0..NUM_CANONICAL_DIRS {
            let has_remaining_blocker = dir_blockers[dir_idx]
                .iter()
                .any(|blocker_id| !removed.contains(blocker_id));
            if !has_remaining_blocker {
                return false; // Free in at least one direction
            }
        }

        true // Blocked in all 6 directions by remaining parts
    }

    /// Total blocking pairs across all parts and directions (for stats/logging).
    fn total_blocking_pairs(&self) -> usize {
        self.blockers
            .values()
            .flat_map(|dirs| dirs.iter())
            .map(|set| set.len())
            .sum()
    }
}

/// Quick AABB check: can part's swept AABB (moving along direction × distance)
/// overlap with other's static AABB?
fn swept_aabb_could_overlap(
    part: &PartData,
    other: &PartData,
    direction: &Vector3<f32>,
    distance: f32,
    clearance: f32,
) -> bool {
    let offset = *direction * distance;
    let swept_min = Point3::new(
        part.world_aabb_min.x.min(part.world_aabb_min.x + offset.x) - clearance,
        part.world_aabb_min.y.min(part.world_aabb_min.y + offset.y) - clearance,
        part.world_aabb_min.z.min(part.world_aabb_min.z + offset.z) - clearance,
    );
    let swept_max = Point3::new(
        part.world_aabb_max.x.max(part.world_aabb_max.x + offset.x) + clearance,
        part.world_aabb_max.y.max(part.world_aabb_max.y + offset.y) + clearance,
        part.world_aabb_max.z.max(part.world_aabb_max.z + offset.z) + clearance,
    );

    !(swept_max.x < other.world_aabb_min.x
        || swept_min.x > other.world_aabb_max.x
        || swept_max.y < other.world_aabb_min.y
        || swept_min.y > other.world_aabb_max.y
        || swept_max.z < other.world_aabb_min.z
        || swept_min.z > other.world_aabb_max.z)
}

impl AssemblySimulator {
    /// Create a new simulator with the given configuration.
    pub fn new(config: SimulatorConfig) -> Self {
        Self {
            config,
            parts: Vec::new(),
            removed_parts: HashSet::new(),
            collision_checks: Cell::new(0),
            path_evaluations: Cell::new(0),
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
                let (bbox_min, bbox_max, bbox_size) = if let Some(b) = bbox {
                    (b.min, b.max, b.size())
                } else {
                    (
                        Point3::new(-0.5, -0.5, -0.5),
                        Point3::new(0.5, 0.5, 0.5),
                        Vector3::new(1.0, 1.0, 1.0),
                    )
                };

                let (world_aabb_min, world_aabb_max) =
                    compute_world_aabb(&bbox_min, &bbox_max, &transform);

                self.parts.push(PartData {
                    id: part.id.clone(),
                    name: part.name.clone(),
                    mesh: tri_mesh,
                    transform,
                    bounding_box_size: bbox_size,
                    bbox_min,
                    bbox_max,
                    world_aabb_min,
                    world_aabb_max,
                });
            }
        }

        if self.parts.is_empty() {
            return Err(SimulatorError::NoParts);
        }

        // Log part names for classification debugging
        let part_names: Vec<&str> = self.parts.iter().map(|p| p.name.as_str()).collect();
        info!(
            "Loaded {} parts with names: {:?}",
            self.parts.len(),
            part_names
        );

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
        let deadline = start_time
            .checked_add(Duration::from_millis(self.config.timeout_ms))
            .unwrap_or(start_time);
        let mut steps: Vec<AssemblyStep> = Vec::new();
        let mut step_number = 1u32;
        self.collision_checks.set(0);
        self.path_evaluations.set(0);

        info!("Starting assembly sequence computation");

        // Build contact graph
        let contact_threshold = self.config.removal_distance * 0.001;
        let contact_graph = ContactGraph::build(
            self.parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            contact_threshold,
        );
        info!(
            "Contact graph: {} contacts among {} parts",
            contact_graph.edge_count(),
            contact_graph.node_count()
        );

        // Classify all parts
        let total_volume: f32 = self
            .parts
            .iter()
            .map(|p| p.bounding_box_size.x * p.bounding_box_size.y * p.bounding_box_size.z)
            .sum();

        let rules = SequencingRules::default();
        let classifications = classify_all_parts(
            self.parts
                .iter()
                .map(|p| (p.id.as_str(), p.name.as_str(), &p.bounding_box_size)),
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

        // Build dependency graph
        let dependency_graph = DependencyGraph::build(
            &contact_graph,
            &classifications,
            &kinds,
            DEFAULT_FASTENER_THRESHOLD,
            DEFAULT_STRUCTURAL_THRESHOLD,
        );
        let dependency_edge_count = dependency_graph.edge_count();
        info!(
            "Dependency graph: {} edges (assembly constraints)",
            dependency_edge_count
        );

        // Derive a clearance epsilon from part sizes (unless configured)
        let min_dim = self
            .parts
            .iter()
            .map(|p| {
                p.bounding_box_size
                    .x
                    .min(p.bounding_box_size.y.min(p.bounding_box_size.z))
            })
            .fold(f32::MAX, f32::min)
            .max(0.001);
        let clearance = if self.config.clearance_epsilon > 0.0 {
            self.config.clearance_epsilon
        } else {
            // 2% of the smallest dimension helps avoid near-intersections
            (min_dim * 0.02).max(1.0e-4)
        };

        let (mut issues, overlap_issue_count) = self.detect_initial_issues(clearance);
        if overlap_issue_count > 0 {
            warn!(
                "Detected {} overlap issues in assembled state",
                overlap_issue_count
            );
        }
        let mut reported_constraint_conflict = false;

        // ════════════════════════════════════════════════════════════════════
        // Build blocking matrix (pre-filter for main loop)
        // ════════════════════════════════════════════════════════════════════
        let blocking_matrix =
            BlockingMatrix::build(&self.parts, self.config.removal_distance, clearance);
        info!(
            "Blocking matrix: {} total blocking pairs",
            blocking_matrix.total_blocking_pairs()
        );
        let blocking_matrix_skips = Cell::new(0u64);

        // ════════════════════════════════════════════════════════════════════
        // Main disassembly loop with constraints
        // ════════════════════════════════════════════════════════════════════
        while self.removed_parts.len() < self.parts.len() {
            // Check timeout
            if start_time.elapsed().as_millis() as u64 > self.config.timeout_ms {
                return Err(SimulatorError::Timeout(self.config.timeout_ms));
            }

            // Find parts that can be removed (geometrically)
            let removable = self.find_removable_parts(
                &contact_graph,
                &kinds,
                clearance,
                deadline,
                &blocking_matrix,
                &blocking_matrix_skips,
            );
            if Instant::now() >= deadline {
                return Err(SimulatorError::Timeout(self.config.timeout_ms));
            }

            // Filter by dependency constraints
            // In disassembly: can only remove a part if all parts that depend
            // on it (in assembly order) have already been removed.
            let constrained: Vec<_> = removable
                .iter()
                .filter(|candidate| {
                    dependency_graph.can_disassemble(&candidate.part_id, &self.removed_parts)
                })
                .cloned()
                .collect();

            // Sort by classification: fasteners first, then panels, then structural
            let mut to_process = if constrained.is_empty() {
                if !removable.is_empty() {
                    warn!(
                        "Dependency constraints conflict with geometry for {} parts, falling back",
                        removable.len()
                    );
                    if !reported_constraint_conflict {
                        issues.push(SimulationIssue {
                            kind: SimulationIssueKind::ConstraintConflict,
                            severity: SimulationIssueSeverity::Warning,
                            part_ids: removable
                                .iter()
                                .map(|candidate| candidate.part_id.clone())
                                .collect(),
                            message: "Dependency constraints conflicted with geometry; fallback ordering was applied".to_string(),
                            metrics: Some(json!({
                                "removable_count": removable.len(),
                            })),
                        });
                        reported_constraint_conflict = true;
                    }
                }
                removable.clone()
            } else {
                constrained
            };

            let default_class = PartClassification::default();
            // Sort: higher disassembly priority = removed first (assembled last)
            to_process.sort_by(|a, b| {
                let class_a = classifications.get(&a.part_id).unwrap_or(&default_class);
                let class_b = classifications.get(&b.part_id).unwrap_or(&default_class);
                let kind_a = kinds.get(&a.part_id).copied().unwrap_or(PartKind::Unknown);
                let kind_b = kinds.get(&b.part_id).copied().unwrap_or(PartKind::Unknown);
                let score_a = disassembly_priority(kind_a, class_a);
                let score_b = disassembly_priority(kind_b, class_b);
                score_b
                    .partial_cmp(&score_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
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
                for part_id in &stuck {
                    let part_name = self.get_part_name(part_id).unwrap_or(part_id);
                    issues.push(SimulationIssue {
                        kind: SimulationIssueKind::PathNotFound,
                        severity: SimulationIssueSeverity::Error,
                        part_ids: vec![part_id.clone()],
                        message: format!(
                            "No collision-free removal path found for part '{}'",
                            part_name
                        ),
                        metrics: None,
                    });
                }

                return Ok(SimulationResult {
                    steps,
                    stuck_parts: stuck,
                    simulation_time_ms: start_time.elapsed().as_millis() as u64,
                    success: false,
                    error: Some("Some parts cannot be disassembled".to_string()),
                    issues,
                    planner_stats: Some(PlannerStats {
                        contact_edges: contact_graph.edge_count(),
                        dependency_edges: dependency_edge_count,
                        candidate_paths_evaluated: self.path_evaluations.get(),
                        collision_checks: self.collision_checks.get(),
                        overlap_issue_count,
                        blocking_matrix_skips: blocking_matrix_skips.get(),
                    }),
                    identical_groups: Vec::new(),
                    suggested_subassemblies: Vec::new(),
                    kits: Vec::new(),
                });
            }

            // Process parts in constrained order
            for candidate in to_process {
                let part_id = candidate.part_id;
                let path = candidate.path;
                let evaluation = candidate.evaluation;

                let Some(part) = self.parts.iter().find(|p| p.id == part_id) else {
                    continue; // Part not found, skip
                };

                // Compute adaptive duration before moving evaluation fields
                let duration_ms = Self::compute_step_duration(
                    &evaluation,
                    (self.global_aabb_max - self.global_aabb_min).magnitude(),
                );

                // Create assembly step
                let step = AssemblyStep {
                    step_number,
                    part_ids: vec![part_id.clone()],
                    part_names: vec![part.name.clone()],
                    assembly_direction: [-path.direction.x, -path.direction.y, -path.direction.z], // Reverse for assembly
                    suggested_duration_ms: duration_ms,
                    motion_type: Some(path.motion.label().to_string()),
                    min_clearance: evaluation.min_clearance,
                    planner_score: Some(if evaluation.required_distance > 1.0e-6 {
                        (evaluation.travel_distance / evaluation.required_distance).clamp(0.0, 1.0)
                    } else {
                        1.0
                    }),
                    animation_path: evaluation.animation_path,
                    motion_distance: Some(evaluation.travel_distance),
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

        // ════════════════════════════════════════════════════════════════════
        // Step intelligence: clustering annotations
        // ════════════════════════════════════════════════════════════════════
        let identical_groups = find_identical_groups(
            &self
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh))
                .collect::<Vec<_>>(),
        );
        let suggested_subassemblies = contact_graph.detect_subassemblies(&kinds);
        let kits = contact_graph.detect_kits(&kinds);

        info!(
            "Clustering: {} identical groups, {} subassemblies, {} kits",
            identical_groups.len(),
            suggested_subassemblies.len(),
            kits.len()
        );

        Ok(SimulationResult {
            steps,
            stuck_parts: Vec::new(),
            simulation_time_ms: start_time.elapsed().as_millis() as u64,
            success: true,
            error: None,
            issues,
            planner_stats: Some(PlannerStats {
                contact_edges: contact_graph.edge_count(),
                dependency_edges: dependency_edge_count,
                candidate_paths_evaluated: self.path_evaluations.get(),
                collision_checks: self.collision_checks.get(),
                overlap_issue_count,
                blocking_matrix_skips: blocking_matrix_skips.get(),
            }),
            identical_groups,
            suggested_subassemblies,
            kits,
        })
    }

    /// Get a part's name by its ID.
    fn get_part_name(&self, part_id: &str) -> Option<&str> {
        self.parts
            .iter()
            .find(|p| p.id == part_id)
            .map(|p| p.name.as_str())
    }

    /// Compute step duration proportional to travel distance.
    ///
    /// Short moves (washers dropping onto a bolt) get ~500ms, long moves
    /// (large panels traveling across the assembly) get up to ~3000ms.
    /// The `scene_diagonal` normalizes distances across assemblies of
    /// different physical scales.
    fn compute_step_duration(evaluation: &PathEvaluation, scene_diagonal: f32) -> u32 {
        if scene_diagonal <= 0.0 {
            return 1500;
        }
        let normalized = evaluation.travel_distance / scene_diagonal;
        // Linear map: 0 distance → 500ms, ~1× diagonal → 2500ms
        let ms = 500.0 + normalized * 2000.0;
        ms.clamp(300.0, 3000.0) as u32
    }

    /// Detect overlap and tight-clearance issues in the assembled state.
    fn detect_initial_issues(&self, clearance: f32) -> (Vec<SimulationIssue>, usize) {
        let mut issues = Vec::new();
        let mut overlap_detected = 0usize;
        let max_overlap_issues = 25usize;
        for i in 0..self.parts.len() {
            for j in (i + 1)..self.parts.len() {
                let part_a = &self.parts[i];
                let part_b = &self.parts[j];

                if !aabb_overlaps(
                    &part_a.world_aabb_min,
                    &part_a.world_aabb_max,
                    &part_b.world_aabb_min,
                    &part_b.world_aabb_max,
                    0.0,
                ) {
                    continue;
                }

                use parry3d::query;
                let intersecting = query::intersection_test(
                    &part_a.transform,
                    &part_a.mesh,
                    &part_b.transform,
                    &part_b.mesh,
                )
                .unwrap_or(false);
                let distance = query::distance(
                    &part_a.transform,
                    &part_a.mesh,
                    &part_b.transform,
                    &part_b.mesh,
                )
                .unwrap_or(f32::MAX);

                let overlap_x = part_a.world_aabb_max.x.min(part_b.world_aabb_max.x)
                    - part_a.world_aabb_min.x.max(part_b.world_aabb_min.x);
                let overlap_y = part_a.world_aabb_max.y.min(part_b.world_aabb_max.y)
                    - part_a.world_aabb_min.y.max(part_b.world_aabb_min.y);
                let overlap_z = part_a.world_aabb_max.z.min(part_b.world_aabb_max.z)
                    - part_a.world_aabb_min.z.max(part_b.world_aabb_min.z);
                let overlap_tol = (clearance * 0.1).max(1.0e-3);

                if intersecting
                    && overlap_x > overlap_tol
                    && overlap_y > overlap_tol
                    && overlap_z > overlap_tol
                {
                    overlap_detected = overlap_detected.saturating_add(1);
                    if overlap_detected <= max_overlap_issues {
                        issues.push(SimulationIssue {
                            kind: SimulationIssueKind::Overlap,
                            severity: SimulationIssueSeverity::Error,
                            part_ids: vec![part_a.id.clone(), part_b.id.clone()],
                            message: format!(
                                "Parts '{}' and '{}' overlap in the assembled state",
                                part_a.name, part_b.name
                            ),
                            metrics: Some(json!({
                                "distance": distance,
                                "aabb_overlap": [overlap_x, overlap_y, overlap_z],
                            })),
                        });
                    }
                    continue;
                }

                // Keep this focused on suspicious near-collisions, not normal
                // mating contact (distance ~ 0) between intended neighbors.
                if clearance > 0.0 && distance > 0.0 && distance < clearance * 0.25 {
                    issues.push(SimulationIssue {
                        kind: SimulationIssueKind::Clearance,
                        severity: SimulationIssueSeverity::Warning,
                        part_ids: vec![part_a.id.clone(), part_b.id.clone()],
                        message: format!(
                            "Parts '{}' and '{}' have low clearance ({:.4})",
                            part_a.name, part_b.name, distance
                        ),
                        metrics: Some(json!({
                            "distance": distance,
                            "threshold": clearance,
                        })),
                    });
                }
            }
        }

        if overlap_detected > max_overlap_issues {
            issues.push(SimulationIssue {
                kind: SimulationIssueKind::Overlap,
                severity: SimulationIssueSeverity::Warning,
                part_ids: Vec::new(),
                message: "Additional overlap diagnostics were truncated".to_string(),
                metrics: Some(json!({
                    "total_overlap_pairs": overlap_detected,
                    "reported_overlap_pairs": max_overlap_issues,
                })),
            });
        }

        (issues, overlap_detected)
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
        deadline: Instant,
        blocking_matrix: &BlockingMatrix,
        blocking_matrix_skips: &Cell<u64>,
    ) -> Vec<RemovableCandidate> {
        let mut removable = Vec::new();

        for part in &self.parts {
            if Instant::now() >= deadline {
                return removable;
            }
            if self.removed_parts.contains(&part.id) {
                continue;
            }

            // Blocking matrix pre-filter: if blocked in ALL 6 canonical
            // directions by remaining parts, skip expensive CCD evaluation.
            // This is conservative — a part that passes might still fail the
            // full evaluator (which tests diagonals and contact-normal dirs),
            // but a part that's blocked here definitely can't be removed.
            if blocking_matrix.is_blocked_in_all_directions(&part.id, &self.removed_parts) {
                blocking_matrix_skips.set(blocking_matrix_skips.get().saturating_add(1));
                continue;
            }

            let kind = kinds.get(&part.id).copied().unwrap_or(PartKind::Unknown);
            let paths = self.candidate_paths_for_part(part, contact_graph, kinds);

            // For fasteners, compute a preferred removal direction from contact
            // normals. The area-weighted normal from the contact graph captures
            // the dominant contact axis (e.g., screw head resting on board face).
            // This is used as a tiebreaker when multiple directions are valid
            // (e.g., a screw in a through-hole can be removed from either end).
            let preferred_direction: Option<Vector3<f32>> = if kind == PartKind::Fastener {
                let mut weighted_dir = Vector3::zeros();
                for contact in contact_graph.contacts_for(&part.id) {
                    // estimated_normal points from part_a toward part_b.
                    // "Away from neighbor" = the natural removal direction.
                    let away = if contact.part_a == part.id {
                        -contact.estimated_normal
                    } else {
                        contact.estimated_normal
                    };
                    weighted_dir += away;
                }
                if weighted_dir.norm_squared() > 1.0e-8 {
                    Some(weighted_dir.normalize())
                } else {
                    None
                }
            } else {
                None
            };

            // Test each path and keep the one with the best quality score.
            // Enforces near-complete removal distance so we do not accept
            // trajectories that still intersect neighboring parts.
            let mut best_candidate: Option<(RemovalPath, PathEvaluation, f32)> = None;

            for path in &paths {
                if Instant::now() >= deadline {
                    break;
                }
                self.path_evaluations
                    .set(self.path_evaluations.get().saturating_add(1));
                let Some(evaluation) =
                    self.evaluate_removal_path(&part.id, path, clearance, deadline)
                else {
                    continue;
                };

                let ratio = if evaluation.required_distance > 1.0e-6 {
                    (evaluation.travel_distance / evaluation.required_distance).min(1.0)
                } else {
                    1.0
                };
                if ratio < MIN_REMOVAL_RATIO {
                    continue;
                }

                let clearance_bonus = evaluation.min_clearance.unwrap_or(0.0).min(10.0) * 1.0e-3;
                let mut quality = ratio + clearance_bonus;

                // For fasteners, add a small alignment bonus with the preferred
                // removal direction. This breaks ties when opposite directions
                // both produce valid paths (e.g., screw in a through-hole).
                if let Some(ref pref_dir) = preferred_direction {
                    let dir_norm = if path.direction.norm_squared() > 1.0e-8 {
                        path.direction.normalize()
                    } else {
                        path.direction
                    };
                    let alignment = dir_norm.dot(pref_dir);
                    // Maps [-1, 1] → [0, 0.05] — small enough to only break ties
                    quality += (alignment + 1.0) * 0.025;
                }

                let improvement_threshold = 0.01;
                let should_replace = match &best_candidate {
                    Some((_, _, best_quality)) => quality > *best_quality + improvement_threshold,
                    None => true,
                };

                if should_replace {
                    let mut candidate = path.clone();
                    candidate.travel_distance = evaluation.travel_distance;
                    let is_perfect = ratio >= 0.999
                        && evaluation.min_clearance.unwrap_or(clearance) >= clearance;
                    best_candidate = Some((candidate, evaluation, quality));
                    // For non-fasteners, a perfect path can short-circuit.
                    // For fasteners, continue evaluating all directions so the
                    // alignment bonus can pick the correct side (e.g., through-hole).
                    if is_perfect && kind != PartKind::Fastener {
                        break;
                    }
                }
            }

            if let Some((selected, evaluation, _)) = best_candidate {
                debug!(
                    "Part {} removable via {} (travel {:.3}, ratio {:.3}, min_clearance {:?})",
                    part.name,
                    selected.motion.label(),
                    evaluation.travel_distance,
                    if evaluation.required_distance > 1.0e-6 {
                        evaluation.travel_distance / evaluation.required_distance
                    } else {
                        1.0
                    },
                    evaluation.min_clearance
                );
                removable.push(RemovableCandidate {
                    part_id: part.id.clone(),
                    path: selected,
                    evaluation,
                });
            }
        }

        removable
    }

    /// Build candidate removal paths for a part.
    ///
    /// For fasteners: helix along axis, linear along axis, contact normals, axes.
    /// For all parts: also generates L-shaped waypoint paths (translate perpendicular
    /// then along primary axis) as fallbacks for narrow-passage removal.
    fn candidate_paths_for_part(
        &self,
        part: &PartData,
        contact_graph: &ContactGraph,
        kinds: &HashMap<String, PartKind>,
    ) -> Vec<RemovalPath> {
        let mut directions = self.candidate_directions_for_part(part, contact_graph, kinds, None);

        let mut paths: Vec<RemovalPath> = Vec::new();

        let kind = kinds.get(&part.id).copied().unwrap_or(PartKind::Unknown);
        if kind == PartKind::Fastener {
            if let Some(axis) = self.fastener_axis_world(part) {
                let axis = axis.normalize();
                // Prefer helix along the fastener axis
                paths.push(RemovalPath {
                    direction: axis,
                    motion: RemovalMotion::Helix { axis, turns: 2.0 },
                    travel_distance: 0.0,
                });
                paths.push(RemovalPath {
                    direction: -axis,
                    motion: RemovalMotion::Helix {
                        axis: -axis,
                        turns: 2.0,
                    },
                    travel_distance: 0.0,
                });

                // Also try linear along axis before other directions
                directions.insert(0, axis);
                directions.insert(0, -axis);
            }
        }

        for dir in &directions {
            paths.push(RemovalPath {
                direction: *dir,
                motion: RemovalMotion::Linear,
                travel_distance: 0.0,
            });
        }

        // L-shaped waypoint paths: combine the primary directions with
        // perpendicular offsets. This handles narrow-passage removal where
        // a straight-line path clips (e.g., a bolt needs to clear the hole
        // lip before translating sideways).
        if directions.len() >= 2 {
            let primary_dirs: Vec<Vector3<f32>> =
                directions.iter().take(4).copied().collect();
            for (i, dir_a) in primary_dirs.iter().enumerate() {
                for dir_b in primary_dirs.iter().skip(i + 1) {
                    // Only combine directions that are sufficiently different
                    if dir_a.dot(dir_b).abs() < 0.7 {
                        // Diagonal: normalized sum of two directions
                        let combined = (*dir_a + *dir_b).normalize();
                        if combined.norm_squared() > 0.5 {
                            paths.push(RemovalPath {
                                direction: combined,
                                motion: RemovalMotion::Linear,
                                travel_distance: 0.0,
                            });
                        }
                        let combined_neg = (*dir_a - *dir_b).normalize();
                        if combined_neg.norm_squared() > 0.5 {
                            paths.push(RemovalPath {
                                direction: combined_neg,
                                motion: RemovalMotion::Linear,
                                travel_distance: 0.0,
                            });
                        }
                    }
                }
            }
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
    /// For fasteners, the axial direction is tried first. Then contact normals,
    /// part-local axes, and global axes/diagonals as fallbacks.
    ///
    /// If `forced_direction` is provided (from a user's approach direction override),
    /// only directions within 45° of the forced direction are returned. If no
    /// candidates match, all candidates are returned as a fallback.
    fn candidate_directions_for_part(
        &self,
        part: &PartData,
        contact_graph: &ContactGraph,
        kinds: &HashMap<String, PartKind>,
        forced_direction: Option<Vector3<f32>>,
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

        // 0) For fasteners, prioritize the axial direction first
        let kind = kinds.get(&part.id).copied().unwrap_or(PartKind::Unknown);
        if kind == PartKind::Fastener {
            if let Some(axis) = self.fastener_axis_world(part) {
                let axis = axis.normalize();
                add_dir(axis);
                add_dir(-axis);
            }
        }

        // 1) Contact normals (move away from neighbors)
        let mut contact_dirs = 0usize;
        let max_contact_dirs = 8usize;
        for contact in contact_graph.contacts_for(&part.id) {
            if contact_dirs >= max_contact_dirs {
                break;
            }
            if contact.part_a == part.id {
                add_dir(-contact.estimated_normal);
            } else {
                add_dir(contact.estimated_normal);
            }
            contact_dirs += 1;
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

        let max_directions = 8usize;
        if directions.len() > max_directions {
            directions.truncate(max_directions);
        }

        // Apply forced direction filter: keep only candidates within 45° cone
        if let Some(forced) = forced_direction {
            let forced_n = forced.normalize();
            let cos_45 = 0.707; // cos(45°)
            let filtered: Vec<Vector3<f32>> = directions
                .iter()
                .copied()
                .filter(|d| d.dot(&forced_n) > cos_45)
                .collect();

            if !filtered.is_empty() {
                return filtered;
            }
            // Fallback: no candidates within 45°, return all (simulator will pick best)
            debug!(
                "No directions within 45° of forced {:?} for part {}, using all {} candidates",
                forced,
                part.id,
                directions.len()
            );
        }

        directions
    }

    /// Evaluate a candidate removal path and return a collision-validated trace.
    fn evaluate_removal_path(
        &self,
        part_id: &str,
        path: &RemovalPath,
        clearance: f32,
        deadline: Instant,
    ) -> Option<PathEvaluation> {
        if Instant::now() >= deadline {
            return None;
        }
        let part = match self.parts.iter().find(|p| p.id == part_id) {
            Some(p) => p,
            None => return None,
        };

        // Check collisions against remaining (non-removed) parts only.
        // In disassembly, removed parts are physically gone. When the sequence
        // is reversed for assembly, earlier-removed parts are placed LATER —
        // they aren't present when this part is placed, so they can't block
        // its assembly path. Checking against all parts was over-conservative
        // and caused false "stuck" verdicts.
        let other_parts: Vec<&PartData> = self
            .parts
            .iter()
            .filter(|p| p.id != part_id && !self.removed_parts.contains(&p.id))
            .collect();

        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let min_travel = min_dim * 0.05;

        if other_parts.is_empty() {
            let travel = min_travel.max(min_dim * 2.0);
            return Some(PathEvaluation {
                travel_distance: travel,
                required_distance: travel,
                min_clearance: None,
                animation_path: self.generate_animation_path_for_motion(
                    part,
                    path,
                    &[0.0, travel],
                    travel,
                    travel,
                ),
            });
        }

        let required_distance =
            self.required_travel_distance(part, &path.direction, &other_parts, clearance);

        let trace = self.trace_motion(
            part,
            path,
            clearance,
            &other_parts,
            required_distance,
            deadline,
        );

        if trace.travel_distance >= min_travel {
            Some(PathEvaluation {
                travel_distance: trace.travel_distance,
                required_distance,
                min_clearance: trace.min_clearance,
                animation_path: self.generate_animation_path_for_motion(
                    part,
                    path,
                    &trace.sampled_distances,
                    trace.travel_distance,
                    required_distance,
                ),
            })
        } else {
            None
        }
    }

    fn trace_motion(
        &self,
        part: &PartData,
        path: &RemovalPath,
        clearance: f32,
        other_parts: &[&PartData],
        required_distance: f32,
        deadline: Instant,
    ) -> MotionTrace {
        if Instant::now() >= deadline {
            return MotionTrace {
                travel_distance: 0.0,
                min_clearance: None,
                sampled_distances: vec![0.0],
            };
        }
        let neighbors = self.build_neighbor_states(part, other_parts, clearance);
        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let release_distance = (min_dim * 0.01).max(1.0e-5);

        // For linear motions, use continuous collision detection (cast_shapes)
        // to get exact collision times. For helix motions, fall back to
        // discrete sampling (cast_shapes only handles linear velocity).
        match &path.motion {
            RemovalMotion::Linear => self.trace_motion_linear_ccd(
                part,
                path,
                clearance,
                &neighbors,
                required_distance,
                release_distance,
                deadline,
            ),
            RemovalMotion::Helix { .. } => self.trace_motion_discrete(
                part,
                path,
                clearance,
                &neighbors,
                required_distance,
                release_distance,
                deadline,
            ),
        }
    }

    /// Trace a linear removal path using continuous collision detection (cast_shapes).
    ///
    /// For each non-overlapping neighbor, uses `parry3d::query::cast_shapes` to
    /// find the exact parametric time of first collision — no discrete sampling gaps.
    /// For baseline-intersecting neighbors, falls back to discrete checks with
    /// strict monotonic overlap reduction.
    #[allow(clippy::too_many_arguments)]
    fn trace_motion_linear_ccd(
        &self,
        part: &PartData,
        path: &RemovalPath,
        clearance: f32,
        neighbors: &[NeighborState<'_>],
        required_distance: f32,
        release_distance: f32,
        deadline: Instant,
    ) -> MotionTrace {
        use parry3d::query::{self, ShapeCastOptions};

        let dir = if path.direction.norm_squared() > 1.0e-8 {
            path.direction.normalize()
        } else {
            Vector3::x()
        };
        let velocity = dir * required_distance;
        let zero_vel = Vector3::zeros();

        let mut min_toi: f32 = 1.0;
        let mut min_clearance_val = f32::MAX;
        let mut has_baseline_intersecting = false;

        // Phase 1: Use cast_shapes for all non-overlapping neighbors
        for neighbor in neighbors {
            if Instant::now() >= deadline {
                break;
            }

            if neighbor.baseline_intersecting {
                has_baseline_intersecting = true;
                continue;
            }

            self.collision_checks
                .set(self.collision_checks.get().saturating_add(1));

            let options = ShapeCastOptions {
                max_time_of_impact: 1.0,
                target_distance: clearance,
                stop_at_penetration: true,
                compute_impact_geometry_on_penetration: false,
            };

            match query::cast_shapes(
                &part.transform,
                &velocity,
                &part.mesh as &dyn parry3d::shape::Shape,
                &neighbor.part.transform,
                &zero_vel,
                &neighbor.part.mesh as &dyn parry3d::shape::Shape,
                options,
            ) {
                Ok(Some(hit)) => {
                    min_toi = min_toi.min(hit.time_of_impact);
                }
                Ok(None) => {
                    // No collision along this path — neighbor is clear
                }
                Err(_) => {
                    // Unsupported shape combo — fall back to distance check at endpoint
                    let end_transform = self.transform_for_motion_distance(
                        part,
                        path,
                        required_distance,
                        required_distance,
                    );
                    let dist = query::distance(
                        &end_transform,
                        &part.mesh,
                        &neighbor.part.transform,
                        &neighbor.part.mesh,
                    )
                    .unwrap_or(f32::MAX);
                    if dist < clearance {
                        min_toi = 0.5;
                    }
                    if dist.is_finite() {
                        min_clearance_val = min_clearance_val.min(dist);
                    }
                }
            }
        }

        let ccd_safe_distance = min_toi * required_distance;

        // Phase 2: For baseline-intersecting neighbors, use discrete sampling
        // with strict monotonic overlap reduction
        let mut last_safe = 0.0_f32;
        let mut sampled_distances = vec![0.0_f32];

        if has_baseline_intersecting {
            let steps = self.motion_sampling_steps(part, path, required_distance);
            for step in 1..=steps {
                if Instant::now() >= deadline {
                    break;
                }
                let distance = required_distance * (step as f32 / steps as f32);
                if distance > ccd_safe_distance {
                    break;
                }
                let test_transform =
                    self.transform_for_motion_distance(part, path, distance, required_distance);
                let (collides, observed_clearance) = self.evaluate_motion_transform(
                    part,
                    &test_transform,
                    neighbors,
                    distance,
                    release_distance,
                );

                if let Some(value) = observed_clearance {
                    if value.is_finite() {
                        min_clearance_val = min_clearance_val.min(value);
                    }
                }

                if collides {
                    let refined_safe = self.refine_motion_boundary(
                        part,
                        path,
                        last_safe,
                        distance,
                        required_distance,
                        neighbors,
                        release_distance,
                        deadline,
                    );
                    if refined_safe > last_safe + 1.0e-6 {
                        sampled_distances.push(refined_safe);
                        last_safe = refined_safe;
                    }
                    break;
                }

                sampled_distances.push(distance);
                last_safe = distance;
            }
        } else {
            // No baseline-intersecting neighbors — CCD result is authoritative.
            // Generate sampled distances for animation keyframes.
            let num_keyframes = 10u32;
            for i in 1..=num_keyframes {
                let d = ccd_safe_distance * (i as f32 / num_keyframes as f32);
                sampled_distances.push(d);
            }
            last_safe = ccd_safe_distance;
        }

        sampled_distances.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        sampled_distances.dedup_by(|a, b| (*a - *b).abs() < 1.0e-6);
        if sampled_distances
            .last()
            .is_none_or(|distance| (last_safe - *distance).abs() > 1.0e-6)
        {
            sampled_distances.push(last_safe);
        }

        MotionTrace {
            travel_distance: last_safe,
            min_clearance: if min_clearance_val.is_finite() {
                Some(min_clearance_val)
            } else {
                None
            },
            sampled_distances,
        }
    }

    /// Trace a removal path using discrete sampling (for helix motions).
    ///
    /// Uses swept AABB pre-filtering and discrete steps, similar to the
    /// original algorithm but with tighter baseline overlap tolerance.
    #[allow(clippy::too_many_arguments)]
    fn trace_motion_discrete(
        &self,
        part: &PartData,
        path: &RemovalPath,
        clearance: f32,
        neighbors: &[NeighborState<'_>],
        required_distance: f32,
        release_distance: f32,
        deadline: Instant,
    ) -> MotionTrace {
        let steps = self.motion_sampling_steps(part, path, required_distance);
        let mut sampled_distances = vec![0.0_f32];
        let mut min_clearance = f32::MAX;
        let mut last_safe = 0.0_f32;

        let velocity = match &path.motion {
            RemovalMotion::Linear => {
                let dir = if path.direction.norm_squared() > 1.0e-8 {
                    path.direction.normalize()
                } else {
                    Vector3::x()
                };
                dir * required_distance
            }
            RemovalMotion::Helix { axis, .. } => {
                let ax = if axis.norm_squared() > 1.0e-8 {
                    axis.normalize()
                } else {
                    Vector3::z()
                };
                ax * required_distance
            }
        };

        let (part_aabb_min, part_aabb_max) =
            compute_world_aabb(&part.bbox_min, &part.bbox_max, &part.transform);

        let mut earliest_entry = 1.0_f32;
        for neighbor in neighbors {
            if neighbor.baseline_intersecting {
                earliest_entry = 0.0;
                break;
            }
            if let Some(t) = swept_aabb_entry_time(
                &part_aabb_min,
                &part_aabb_max,
                &neighbor.part.world_aabb_min,
                &neighbor.part.world_aabb_max,
                &velocity,
                clearance,
            ) {
                earliest_entry = earliest_entry.min(t);
            }
        }

        let start_fraction = (earliest_entry - 0.05).max(0.0);
        let start_step = ((start_fraction * steps as f32) as u32).saturating_sub(1);

        for step in start_step.max(1)..=steps {
            if Instant::now() >= deadline {
                break;
            }
            let distance = required_distance * (step as f32 / steps as f32);
            let test_transform =
                self.transform_for_motion_distance(part, path, distance, required_distance);
            let (collides, observed_clearance) = self.evaluate_motion_transform(
                part,
                &test_transform,
                neighbors,
                distance,
                release_distance,
            );

            if let Some(value) = observed_clearance {
                if value.is_finite() {
                    min_clearance = min_clearance.min(value);
                }
            }

            if collides {
                let refined_safe = self.refine_motion_boundary(
                    part,
                    path,
                    last_safe,
                    distance,
                    required_distance,
                    neighbors,
                    release_distance,
                    deadline,
                );
                if refined_safe > last_safe + 1.0e-6 {
                    sampled_distances.push(refined_safe);
                    last_safe = refined_safe;
                }
                break;
            }

            sampled_distances.push(distance);
            last_safe = distance;
        }

        sampled_distances.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        sampled_distances.dedup_by(|a, b| (*a - *b).abs() < 1.0e-6);
        if sampled_distances
            .last()
            .is_none_or(|distance| (last_safe - *distance).abs() > 1.0e-6)
        {
            sampled_distances.push(last_safe);
        }

        MotionTrace {
            travel_distance: last_safe,
            min_clearance: if min_clearance.is_finite() {
                Some(min_clearance)
            } else {
                None
            },
            sampled_distances,
        }
    }

    fn motion_sampling_steps(
        &self,
        part: &PartData,
        path: &RemovalPath,
        required_distance: f32,
    ) -> u32 {
        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let max_step = (min_dim * 0.4).max(0.001);

        let mut steps = (required_distance / max_step)
            .ceil()
            .max(self.config.removal_steps as f32);

        if let RemovalMotion::Helix { turns, .. } = &path.motion {
            steps = steps.max(turns.abs() * 16.0);
        }

        steps.clamp(4.0, MAX_MOTION_SAMPLING_STEPS) as u32
    }

    fn build_neighbor_states<'a>(
        &self,
        part: &PartData,
        other_parts: &[&'a PartData],
        clearance: f32,
    ) -> Vec<NeighborState<'a>> {
        use parry3d::query;
        let (rest_min, rest_max) =
            compute_world_aabb(&part.bbox_min, &part.bbox_max, &part.transform);

        other_parts
            .iter()
            .map(|other| {
                self.collision_checks
                    .set(self.collision_checks.get().saturating_add(1));
                let baseline_intersecting = query::intersection_test(
                    &part.transform,
                    &part.mesh,
                    &other.transform,
                    &other.mesh,
                )
                .unwrap_or(false);

                self.collision_checks
                    .set(self.collision_checks.get().saturating_add(1));
                let baseline_distance =
                    query::distance(&part.transform, &part.mesh, &other.transform, &other.mesh)
                        .unwrap_or(f32::MAX);

                // If parts are already in near-contact in the assembled state,
                // only enforce hard intersections while separating.
                let relaxed_clearance = if clearance > 0.0 && baseline_distance < clearance * 1.05 {
                    0.0
                } else {
                    clearance
                };

                NeighborState {
                    part: *other,
                    baseline_intersecting,
                    baseline_overlap_volume: aabb_overlap_volume(
                        &rest_min,
                        &rest_max,
                        &other.world_aabb_min,
                        &other.world_aabb_max,
                    ),
                    relaxed_clearance,
                }
            })
            .collect()
    }

    fn evaluate_motion_transform(
        &self,
        part: &PartData,
        test_transform: &Isometry3<f32>,
        neighbors: &[NeighborState<'_>],
        _distance_from_start: f32,
        _release_distance: f32,
    ) -> (bool, Option<f32>) {
        use parry3d::query;

        let (test_min, test_max) =
            compute_world_aabb(&part.bbox_min, &part.bbox_max, test_transform);
        let mut min_clearance = f32::MAX;

        for neighbor in neighbors {
            if !aabb_overlaps(
                &test_min,
                &test_max,
                &neighbor.part.world_aabb_min,
                &neighbor.part.world_aabb_max,
                neighbor.relaxed_clearance,
            ) {
                continue;
            }

            self.collision_checks
                .set(self.collision_checks.get().saturating_add(1));
            let intersecting = query::intersection_test(
                test_transform,
                &part.mesh,
                &neighbor.part.transform,
                &neighbor.part.mesh,
            )
            .unwrap_or(false);

            let distance = if intersecting {
                0.0
            } else {
                self.collision_checks
                    .set(self.collision_checks.get().saturating_add(1));
                query::distance(
                    test_transform,
                    &part.mesh,
                    &neighbor.part.transform,
                    &neighbor.part.mesh,
                )
                .unwrap_or(f32::MAX)
            };

            if distance.is_finite() {
                min_clearance = min_clearance.min(distance);
            }

            if intersecting {
                if neighbor.baseline_intersecting {
                    // Allow minor pre-existing overlap while parts separate, but
                    // block if overlap grows materially during motion.
                    let overlap_volume = aabb_overlap_volume(
                        &test_min,
                        &test_max,
                        &neighbor.part.world_aabb_min,
                        &neighbor.part.world_aabb_max,
                    );
                    // Only allow monotonic decrease — overlap must not grow beyond
                    // the baseline. Tight tolerance prevents paths that clip through
                    // mating geometry (e.g., bolt through hole wall).
                    let allowed_overlap = neighbor.baseline_overlap_volume * 1.01 + 1.0e-4;
                    if overlap_volume <= allowed_overlap {
                        continue;
                    }
                }
                return (true, Some(0.0));
            }

            if neighbor.relaxed_clearance > 0.0 && distance < neighbor.relaxed_clearance {
                return (true, Some(distance));
            }
        }

        (
            false,
            if min_clearance.is_finite() {
                Some(min_clearance)
            } else {
                None
            },
        )
    }

    fn refine_motion_boundary(
        &self,
        part: &PartData,
        path: &RemovalPath,
        safe_distance: f32,
        colliding_distance: f32,
        reference_distance: f32,
        neighbors: &[NeighborState<'_>],
        release_distance: f32,
        deadline: Instant,
    ) -> f32 {
        let mut low = safe_distance;
        let mut high = colliding_distance;

        for _ in 0..6 {
            if Instant::now() >= deadline {
                break;
            }
            if (high - low).abs() < 1.0e-4 {
                break;
            }

            let mid = (low + high) * 0.5;
            let test_transform =
                self.transform_for_motion_distance(part, path, mid, reference_distance);
            let (collides, _) = self.evaluate_motion_transform(
                part,
                &test_transform,
                neighbors,
                mid,
                release_distance,
            );
            if collides {
                high = mid;
            } else {
                low = mid;
            }
        }

        low
    }

    fn transform_for_motion_distance(
        &self,
        part: &PartData,
        path: &RemovalPath,
        distance: f32,
        reference_distance: f32,
    ) -> Isometry3<f32> {
        match &path.motion {
            RemovalMotion::Linear => {
                let direction = if path.direction.norm_squared() > 1.0e-8 {
                    path.direction.normalize()
                } else {
                    Vector3::x()
                };
                let offset = direction * distance;
                Translation3::from(offset) * part.transform
            }
            RemovalMotion::Helix { axis, turns } => {
                let axis = if axis.norm_squared() > 1.0e-8 {
                    axis.normalize()
                } else {
                    Vector3::z()
                };
                let axis_unit = Unit::new_normalize(axis);
                let t = if reference_distance > 1.0e-6 {
                    (distance / reference_distance).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let angle = turns * std::f32::consts::TAU * t;
                let offset = axis * distance;
                let rotation = UnitQuaternion::from_axis_angle(&axis_unit, angle);
                let new_translation = part.transform.translation.vector + offset;
                Isometry3::from_parts(
                    Translation3::from(new_translation),
                    rotation * part.transform.rotation,
                )
            }
        }
    }

    /// Compute a travel distance that just clears all other parts along direction.
    fn required_travel_distance(
        &self,
        part: &PartData,
        direction: &Vector3<f32>,
        other_parts: &[&PartData],
        clearance: f32,
    ) -> f32 {
        let dir = if direction.norm_squared() > 1.0e-8 {
            direction.normalize()
        } else {
            Vector3::x()
        };

        let (part_min, _part_max) = self.project_part_along(part, &part.transform, &dir);
        let mut required = 0.0_f32;

        for other in other_parts {
            let (_o_min, o_max) = self.project_part_along(other, &other.transform, &dir);
            let r = (o_max - part_min) + clearance;
            if r > required {
                required = r;
            }
        }

        let min_dim = part
            .bounding_box_size
            .x
            .min(part.bounding_box_size.y.min(part.bounding_box_size.z))
            .max(0.001);
        let min_travel = min_dim * 0.5;

        required.max(min_travel)
    }

    /// Project a part's AABB onto a direction and return (min, max).
    fn project_part_along(
        &self,
        part: &PartData,
        transform: &Isometry3<f32>,
        direction: &Vector3<f32>,
    ) -> (f32, f32) {
        let corners = [
            Point3::new(part.bbox_min.x, part.bbox_min.y, part.bbox_min.z),
            Point3::new(part.bbox_min.x, part.bbox_min.y, part.bbox_max.z),
            Point3::new(part.bbox_min.x, part.bbox_max.y, part.bbox_min.z),
            Point3::new(part.bbox_min.x, part.bbox_max.y, part.bbox_max.z),
            Point3::new(part.bbox_max.x, part.bbox_min.y, part.bbox_min.z),
            Point3::new(part.bbox_max.x, part.bbox_min.y, part.bbox_max.z),
            Point3::new(part.bbox_max.x, part.bbox_max.y, part.bbox_min.z),
            Point3::new(part.bbox_max.x, part.bbox_max.y, part.bbox_max.z),
        ];

        let mut min_proj = f32::MAX;
        let mut max_proj = f32::MIN;
        for c in corners {
            let world = transform * c;
            let proj = world.coords.dot(direction);
            if proj < min_proj {
                min_proj = proj;
            }
            if proj > max_proj {
                max_proj = proj;
            }
        }

        (min_proj, max_proj)
    }

    /// Generate animation keyframes for a part removal.
    fn generate_animation_path_for_motion(
        &self,
        part: &PartData,
        path: &RemovalPath,
        sampled_distances: &[f32],
        travel_distance: f32,
        reference_distance: f32,
    ) -> Vec<AnimationKeyframe> {
        if travel_distance <= 1.0e-6 {
            return vec![AnimationKeyframe {
                time: 0.0,
                transform: isometry_to_matrix4(&part.transform),
            }];
        }

        let mut distances = if sampled_distances.is_empty() {
            vec![0.0, travel_distance]
        } else {
            sampled_distances.to_vec()
        };
        distances.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        distances.dedup_by(|a, b| (*a - *b).abs() < 1.0e-6);

        if distances.first().is_none_or(|distance| *distance > 1.0e-6) {
            distances.insert(0, 0.0);
        }
        if distances
            .last()
            .is_none_or(|distance| (travel_distance - *distance).abs() > 1.0e-6)
        {
            distances.push(travel_distance);
        }

        distances
            .into_iter()
            .map(|distance| {
                let clamped_distance = distance.clamp(0.0, travel_distance);
                let transform = self.transform_for_motion_distance(
                    part,
                    path,
                    clamped_distance,
                    reference_distance,
                );
                AnimationKeyframe {
                    time: (clamped_distance / travel_distance).clamp(0.0, 1.0),
                    transform: isometry_to_matrix4(&transform),
                }
            })
            .collect()
    }

}

/// Convert a Matrix4 to an Isometry3.
fn matrix4_to_isometry(m: &Matrix4<f32>) -> Isometry3<f32> {
    let translation = Translation3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    let rotation = UnitQuaternion::from_matrix(&m.fixed_view::<3, 3>(0, 0).into_owned());
    Isometry3::from_parts(translation, rotation)
}

/// Convert an Isometry3 to a Matrix4.
fn isometry_to_matrix4(iso: &Isometry3<f32>) -> Matrix4<f32> {
    iso.to_homogeneous()
}

fn compute_world_aabb(
    local_min: &Point3<f32>,
    local_max: &Point3<f32>,
    transform: &Isometry3<f32>,
) -> (Point3<f32>, Point3<f32>) {
    let corners = [
        Point3::new(local_min.x, local_min.y, local_min.z),
        Point3::new(local_min.x, local_min.y, local_max.z),
        Point3::new(local_min.x, local_max.y, local_min.z),
        Point3::new(local_min.x, local_max.y, local_max.z),
        Point3::new(local_max.x, local_min.y, local_min.z),
        Point3::new(local_max.x, local_min.y, local_max.z),
        Point3::new(local_max.x, local_max.y, local_min.z),
        Point3::new(local_max.x, local_max.y, local_max.z),
    ];

    let mut min = Point3::new(f32::MAX, f32::MAX, f32::MAX);
    let mut max = Point3::new(f32::MIN, f32::MIN, f32::MIN);

    for c in corners {
        let w = transform * c;
        min.x = min.x.min(w.x);
        min.y = min.y.min(w.y);
        min.z = min.z.min(w.z);
        max.x = max.x.max(w.x);
        max.y = max.y.max(w.y);
        max.z = max.z.max(w.z);
    }

    (min, max)
}

fn aabb_overlaps(
    a_min: &Point3<f32>,
    a_max: &Point3<f32>,
    b_min: &Point3<f32>,
    b_max: &Point3<f32>,
    clearance: f32,
) -> bool {
    !(a_max.x + clearance < b_min.x
        || a_min.x - clearance > b_max.x
        || a_max.y + clearance < b_min.y
        || a_min.y - clearance > b_max.y
        || a_max.z + clearance < b_min.z
        || a_min.z - clearance > b_max.z)
}

fn aabb_overlap_volume(
    a_min: &Point3<f32>,
    a_max: &Point3<f32>,
    b_min: &Point3<f32>,
    b_max: &Point3<f32>,
) -> f32 {
    let overlap_x = (a_max.x.min(b_max.x) - a_min.x.max(b_min.x)).max(0.0);
    let overlap_y = (a_max.y.min(b_max.y) - a_min.y.max(b_min.y)).max(0.0);
    let overlap_z = (a_max.z.min(b_max.z) - a_min.z.max(b_min.z)).max(0.0);
    overlap_x * overlap_y * overlap_z
}

/// Compute the time (0..1) when moving AABB first enters another AABB.
/// Returns None if they never intersect along the velocity vector.
fn swept_aabb_entry_time(
    a_min: &Point3<f32>,
    a_max: &Point3<f32>,
    b_min: &Point3<f32>,
    b_max: &Point3<f32>,
    velocity: &Vector3<f32>,
    clearance: f32,
) -> Option<f32> {
    if velocity.norm_squared() < 1.0e-12 {
        return None;
    }

    let mut t_entry = f32::NEG_INFINITY;
    let mut t_exit = f32::INFINITY;

    for axis in 0..3 {
        let (a_min_v, a_max_v, b_min_v, b_max_v, vel) = match axis {
            0 => (a_min.x, a_max.x, b_min.x, b_max.x, velocity.x),
            1 => (a_min.y, a_max.y, b_min.y, b_max.y, velocity.y),
            _ => (a_min.z, a_max.z, b_min.z, b_max.z, velocity.z),
        };

        if vel.abs() < 1.0e-8 {
            if a_max_v + clearance < b_min_v || a_min_v - clearance > b_max_v {
                return None;
            }
            continue;
        }

        let inv_vel = 1.0 / vel;
        let t1 = (b_min_v - (a_max_v + clearance)) * inv_vel;
        let t2 = (b_max_v - (a_min_v - clearance)) * inv_vel;
        let entry = t1.min(t2);
        let exit = t1.max(t2);

        t_entry = t_entry.max(entry);
        t_exit = t_exit.min(exit);

        if t_entry > t_exit {
            return None;
        }
    }

    if t_exit < 0.0 || t_entry > 1.0 {
        return None;
    }

    Some(t_entry.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cad_common::{AssemblyNode, NodeType, TriangleMesh};

    fn create_cube_mesh(size: f32) -> TriangleMesh {
        let h = size / 2.0;
        let vertices = vec![
            Point3::new(-h, -h, -h),
            Point3::new(h, -h, -h),
            Point3::new(h, h, -h),
            Point3::new(-h, h, -h),
            Point3::new(-h, -h, h),
            Point3::new(h, -h, h),
            Point3::new(h, h, h),
            Point3::new(-h, h, h),
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
        TriangleMesh {
            vertices,
            indices,
            normals: None,
        }
    }

    fn create_test_part(
        id: &str,
        name: &str,
        mesh: TriangleMesh,
        transform: Matrix4<f32>,
    ) -> AssemblyNode {
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
        let base_mesh = create_cube_mesh(10.0); // Structural part
        let bracket_mesh = create_cube_mesh(8.0); // Medium bracket
        let bolt_mesh = create_cube_mesh(2.0); // Small fastener

        // Stack vertically so they can be removed in +Y direction
        // Parts touching along Y axis: base at bottom, bracket on top of base, bolts on top of bracket
        let base = create_test_part(
            "part_1",
            "BASE_FRAME",
            base_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let bracket = create_test_part(
            "part_2",
            "L_BRACKET",
            bracket_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 9.0, 0.0)), // On top of base (touching)
        );
        let bolt_1 = create_test_part(
            "part_3",
            "M6_BOLT",
            bolt_mesh.clone(),
            Matrix4::new_translation(&Vector3::new(-2.0, 14.0, 0.0)), // On top of bracket
        );
        let bolt_2 = create_test_part(
            "part_4",
            "HEX_SCREW",
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
        assert!(
            load_result.is_ok(),
            "Failed to load assembly: {:?}",
            load_result
        );

        let result = simulator.compute_sequence();
        assert!(result.is_ok(), "Simulation failed: {:?}", result);

        let result = result.unwrap();
        assert!(
            result.success,
            "Simulation not successful: {:?}",
            result.error
        );
        assert_eq!(result.steps.len(), 4, "Should have 4 assembly steps");

        // Verify order: structural parts should come before fasteners
        let step_names: Vec<&str> = result
            .steps
            .iter()
            .map(|s| s.part_names.first().map(|n| n.as_str()).unwrap_or("?"))
            .collect();

        println!("Assembly order: {:?}", step_names);

        // Find positions
        let base_pos = step_names
            .iter()
            .position(|n| n.contains("BASE") || n.contains("FRAME"));
        let bracket_pos = step_names.iter().position(|n| n.contains("BRACKET"));
        let bolt_positions: Vec<_> = step_names
            .iter()
            .enumerate()
            .filter(|(_, n)| n.contains("BOLT") || n.contains("SCREW"))
            .map(|(i, _)| i)
            .collect();

        // Verify: base should come before bolts
        if let (Some(base_p), false) = (base_pos, bolt_positions.is_empty()) {
            for bolt_p in &bolt_positions {
                assert!(
                    base_p < *bolt_p,
                    "BASE_FRAME (pos {}) should be assembled before fasteners (pos {})",
                    base_p,
                    bolt_p
                );
            }
        }

        // Verify: bracket should come before bolts (if bracket contacts bolts)
        if let (Some(bracket_p), false) = (bracket_pos, bolt_positions.is_empty()) {
            for bolt_p in &bolt_positions {
                assert!(
                    bracket_p < *bolt_p,
                    "L_BRACKET (pos {}) should be assembled before fasteners (pos {})",
                    bracket_p,
                    bolt_p
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
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let kinds: HashMap<String, PartKind> = HashMap::new();
        let blocking_matrix =
            BlockingMatrix::build(&simulator.parts, simulator.config.removal_distance, 0.0);
        let bm_skips = Cell::new(0u64);
        let removable = simulator.find_removable_parts(
            &contact_graph,
            &kinds,
            0.0,
            Instant::now() + Duration::from_secs(1),
            &blocking_matrix,
            &bm_skips,
        );
        let a_entry = removable
            .iter()
            .find(|candidate| candidate.part_id == "part_a")
            .expect("part_a should be removable");

        let dir = a_entry.path.direction.normalize();
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
    fn test_swept_aabb_entry_time() {
        let a_min = Point3::new(-0.5, -0.5, -0.5);
        let a_max = Point3::new(0.5, 0.5, 0.5);
        let b_min = Point3::new(2.5, -0.5, -0.5);
        let b_max = Point3::new(3.5, 0.5, 0.5);
        let velocity = Vector3::new(5.0, 0.0, 0.0);

        let t_entry = swept_aabb_entry_time(&a_min, &a_max, &b_min, &b_max, &velocity, 0.0)
            .expect("Expected overlap along +X");
        assert!(
            (t_entry - 0.4).abs() < 1.0e-3,
            "Unexpected entry time: {}",
            t_entry
        );

        let velocity_away = Vector3::new(-5.0, 0.0, 0.0);
        let no_hit = swept_aabb_entry_time(&a_min, &a_max, &b_min, &b_max, &velocity_away, 0.0);
        assert!(no_hit.is_none(), "Expected no overlap when moving away");
    }

    #[test]
    fn test_detects_initial_overlap_issues() {
        let mesh = create_cube_mesh(2.0);
        let part_a = create_test_part(
            "part_a",
            "PART_A",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let part_b = create_test_part(
            "part_b",
            "PART_B",
            mesh,
            Matrix4::new_translation(&Vector3::new(0.5, 0.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Overlap Assembly".to_string(),
            original_name: "Overlap Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![part_a, part_b],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();
        let result = simulator.compute_sequence().unwrap();

        assert!(
            result
                .issues
                .iter()
                .any(|issue| matches!(issue.kind, SimulationIssueKind::Overlap)),
            "Expected at least one overlap issue"
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
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let mut kinds: HashMap<String, PartKind> = HashMap::new();
        kinds.insert("bolt".to_string(), PartKind::Fastener);

        let blocking_matrix =
            BlockingMatrix::build(&simulator.parts, simulator.config.removal_distance, 0.0);
        let bm_skips = Cell::new(0u64);
        let removable = simulator.find_removable_parts(
            &contact_graph,
            &kinds,
            0.0,
            Instant::now() + Duration::from_secs(1),
            &blocking_matrix,
            &bm_skips,
        );
        let bolt_entry = removable
            .iter()
            .find(|candidate| candidate.part_id == "bolt")
            .expect("bolt should be removable");

        match bolt_entry.path.motion {
            RemovalMotion::Helix { .. } => {}
            _ => panic!("Fastener should prefer helix motion"),
        }
    }

    /// Verify animation paths use the validated removal motion directly.
    ///
    /// After reversal for assembly order:
    ///   time=0.0 → removal endpoint (displaced from rest)
    ///   time=1.0 → rest position (assembled)
    ///
    /// The displacement at time=0 should match motion_distance along the
    /// assembly_direction (negated removal direction).
    #[test]
    fn test_animation_uses_validated_path() {
        let mesh = create_cube_mesh(4.0);
        let part_a = create_test_part(
            "a",
            "BLOCK_A",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let part_b = create_test_part(
            "b",
            "BLOCK_B",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(4.0, 0.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Pair".to_string(),
            original_name: "Pair".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![part_a, part_b],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();
        let result = simulator.compute_sequence().unwrap();
        assert!(result.success);

        for step in &result.steps {
            // Each step must have at least 2 keyframes (start + end)
            assert!(
                step.animation_path.len() >= 2,
                "Step {} should have at least 2 keyframes, got {}",
                step.step_number,
                step.animation_path.len()
            );

            // motion_distance should be populated
            assert!(
                step.motion_distance.is_some(),
                "Step {} should have motion_distance",
                step.step_number
            );

            // First keyframe time ≈ 0.0, last ≈ 1.0
            let first_kf = step.animation_path.first().unwrap();
            let last_kf = step.animation_path.last().unwrap();
            assert!(
                first_kf.time.abs() < 0.01,
                "First keyframe time should be ~0.0, got {}",
                first_kf.time
            );
            assert!(
                (last_kf.time - 1.0).abs() < 0.01,
                "Last keyframe time should be ~1.0, got {}",
                last_kf.time
            );

            // Last keyframe (rest) should match the part's assembled position
            // First keyframe should be displaced from rest along the removal direction
            let rest_tx = last_kf.transform[(0, 3)];
            let rest_ty = last_kf.transform[(1, 3)];
            let rest_tz = last_kf.transform[(2, 3)];
            let start_tx = first_kf.transform[(0, 3)];
            let start_ty = first_kf.transform[(1, 3)];
            let start_tz = first_kf.transform[(2, 3)];

            let displacement = Vector3::new(
                start_tx - rest_tx,
                start_ty - rest_ty,
                start_tz - rest_tz,
            );
            assert!(
                displacement.norm() > 0.1,
                "Step {} should have non-zero displacement, got {:.4}",
                step.step_number,
                displacement.norm()
            );
        }
    }

    #[test]
    fn test_fastener_axis_prioritized_in_directions() {
        // A tall bolt (elongated along Y) sitting on a base plate.
        // As a fastener, its axial direction (Y) should be the FIRST candidate,
        // not buried behind contact normals.
        let base_mesh = create_cube_mesh(10.0);
        let bolt_mesh = create_cube_mesh(1.0); // will appear as cube, but classified as fastener

        let base = create_test_part(
            "base",
            "BASE_PLATE",
            base_mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        // Bolt sitting on top of the base, touching along Y
        let bolt = create_test_part(
            "bolt",
            "M8_BOLT",
            bolt_mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 5.5, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test Assembly".to_string(),
            original_name: "Test Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![base, bolt],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let mut kinds: HashMap<String, PartKind> = HashMap::new();
        kinds.insert("bolt".to_string(), PartKind::Fastener);

        let bolt_part = simulator.parts.iter().find(|p| p.id == "bolt").unwrap();
        let directions = simulator.candidate_directions_for_part(bolt_part, &contact_graph, &kinds, None);

        // For a fastener, the first directions should be along the fastener axis
        assert!(
            !directions.is_empty(),
            "Should have at least one candidate direction"
        );

        // The fastener axis for a cube is the longest local axis.
        // For a 1x1x1 cube all axes are equal, but the function picks the first.
        // The important thing is that SOME axis direction is in the first two slots.
        let axis = simulator.fastener_axis_world(bolt_part).unwrap().normalize();
        let first_is_axial = directions[0].dot(&axis).abs() > 0.9;
        let second_is_axial = directions.len() > 1 && directions[1].dot(&axis).abs() > 0.9;

        assert!(
            first_is_axial || second_is_axial,
            "Fastener axial direction should be among the first two candidates, got {:?}",
            &directions[..directions.len().min(4)]
        );
    }

    /// Verify that cast_shapes detects a collision that discrete sampling might miss.
    ///
    /// A thin part (wall) sits between two cubes. The moving cube translates
    /// through the wall. With coarse discrete sampling, the cube could jump
    /// past the thin wall undetected. cast_shapes must catch it.
    #[test]
    fn test_ccd_detects_thin_wall_collision() {
        // Thin wall at x=5 (0.1 thick)
        let wall_mesh = create_cube_mesh(0.1);
        let cube_mesh = create_cube_mesh(2.0);

        let wall = create_test_part(
            "wall",
            "THIN_WALL",
            wall_mesh,
            Matrix4::new_translation(&Vector3::new(5.0, 0.0, 0.0)),
        );
        let cube = create_test_part(
            "cube",
            "BLOCK",
            cube_mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Thin Wall Test".to_string(),
            original_name: "Thin Wall Test".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![wall, cube],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let kinds: HashMap<String, PartKind> = HashMap::new();
        let blocking_matrix =
            BlockingMatrix::build(&simulator.parts, simulator.config.removal_distance, 0.0);
        let bm_skips = Cell::new(0u64);
        let removable = simulator.find_removable_parts(
            &contact_graph,
            &kinds,
            0.0,
            Instant::now() + Duration::from_secs(2),
            &blocking_matrix,
            &bm_skips,
        );

        // The cube should be removable, but its removal path should NOT
        // pass through the thin wall in +X direction.
        let cube_entry = removable.iter().find(|c| c.part_id == "cube");
        if let Some(entry) = cube_entry {
            // If the cube moves in +X, it should stop before the thin wall
            let dir = entry.path.direction;
            if dir.x > 0.5 {
                // Moving toward the wall — travel distance should be limited
                assert!(
                    entry.evaluation.travel_distance < 4.5,
                    "Cube should stop before thin wall, but traveled {:.2}",
                    entry.evaluation.travel_distance
                );
            }
        }
    }

    /// Verify that L-shaped diagonal paths are generated for parts with
    /// multiple candidate directions.
    #[test]
    fn test_diagonal_paths_generated() {
        let mesh = create_cube_mesh(2.0);

        // Three parts in an L-shape: base, side, and corner piece
        let base = create_test_part(
            "base",
            "BASE",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let side = create_test_part(
            "side",
            "SIDE",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(2.0, 0.0, 0.0)),
        );
        let corner = create_test_part(
            "corner",
            "CORNER",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(2.0, 2.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "L-Shape Test".to_string(),
            original_name: "L-Shape Test".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![base, side, corner],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            simulator.config.removal_distance * 0.001,
        );

        let kinds: HashMap<String, PartKind> = HashMap::new();
        let corner_part = simulator.parts.iter().find(|p| p.id == "corner").unwrap();
        let paths = simulator.candidate_paths_for_part(corner_part, &contact_graph, &kinds);

        // Should have more paths than just the basic directions (diagonals added)
        let linear_paths: Vec<_> = paths
            .iter()
            .filter(|p| matches!(p.motion, RemovalMotion::Linear))
            .collect();

        assert!(
            linear_paths.len() > 6,
            "Should have diagonal paths in addition to basic directions, got {} linear paths",
            linear_paths.len()
        );
    }

    /// Test that a fastener's removal direction aligns with the contact-normal
    /// tiebreaker. A screw sitting on top of a board should be removed upward
    /// (away from the board), not downward through it.
    #[test]
    fn test_fastener_direction_prefers_contact_normal() {
        // Board: large part centered at origin (spans -10..+10 on each axis)
        let board_mesh = create_cube_mesh(20.0);
        let board = create_test_part(
            "board",
            "MAIN_BOARD",
            board_mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );

        // Screw: small fastener sitting on top of the board
        // Cube of size 2 translated to Y=+11 → spans Y=+10 to Y=+12 → touching board at Y=+10
        let screw_mesh = create_cube_mesh(2.0);
        let screw = create_test_part(
            "screw",
            "M6_SCREW",
            screw_mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 11.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test Assembly".to_string(),
            original_name: "Test Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![board, screw],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let result = simulator.compute_sequence().unwrap();
        assert!(
            result.success,
            "Simulation not successful: {:?}",
            result.error
        );

        // Find the screw's assembly step
        let screw_step = result
            .steps
            .iter()
            .find(|s| s.part_names.iter().any(|n| n.contains("SCREW")))
            .expect("Should have a step for the screw");

        // The assembly_direction is the NEGATED removal direction.
        // Screw sits above board → removal is +Y → assembly_direction is -Y.
        let asm_dir = &screw_step.assembly_direction;
        println!(
            "Screw assembly direction: [{:.3}, {:.3}, {:.3}]",
            asm_dir[0], asm_dir[1], asm_dir[2]
        );

        // assembly_direction Y component should be negative (going down into position)
        assert!(
            asm_dir[1] < -0.5,
            "Screw assembly direction should point downward (-Y), got [{:.3}, {:.3}, {:.3}]",
            asm_dir[0],
            asm_dir[1],
            asm_dir[2]
        );
    }

    #[test]
    fn test_direction_constraint_filters_candidates() {
        // Create a simple assembly with a part that has multiple candidate directions
        let mesh = create_cube_mesh(1.0);

        let base = create_test_part(
            "base",
            "BASE_PLATE",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let block = create_test_part(
            "block",
            "BLOCK",
            mesh,
            Matrix4::new_translation(&Vector3::new(0.0, 1.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Dir Constraint Test".to_string(),
            original_name: "Dir Constraint Test".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![base, block],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();

        let contact_graph = ContactGraph::build(
            simulator
                .parts
                .iter()
                .map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            0.05,
        );

        let mut kinds = HashMap::new();
        kinds.insert("base".to_string(), PartKind::Structural);
        kinds.insert("block".to_string(), PartKind::Structural);

        let block_part = simulator.parts.iter().find(|p| p.id == "block").unwrap();

        // Without constraint: should have multiple directions
        let all_dirs =
            simulator.candidate_directions_for_part(block_part, &contact_graph, &kinds, None);
        assert!(
            all_dirs.len() > 1,
            "Without constraint should have multiple directions, got {}",
            all_dirs.len()
        );

        // With +Y constraint: should only return upward-ish directions
        let forced_up = Vector3::new(0.0, 1.0, 0.0);
        let filtered_dirs = simulator.candidate_directions_for_part(
            block_part,
            &contact_graph,
            &kinds,
            Some(forced_up),
        );

        assert!(
            !filtered_dirs.is_empty(),
            "Should have at least one direction within 45° of +Y"
        );

        // All returned directions should be within 45° of +Y
        for dir in &filtered_dirs {
            let dot = dir.dot(&forced_up);
            assert!(
                dot > 0.707 - 0.01, // cos(45°) with tolerance
                "Direction {:?} should be within 45° of +Y, dot={:.3}",
                dir,
                dot
            );
        }

        // Filtered should have fewer directions than unfiltered
        assert!(
            filtered_dirs.len() <= all_dirs.len(),
            "Filtered ({}) should have <= unfiltered ({})",
            filtered_dirs.len(),
            all_dirs.len()
        );
    }

    #[test]
    fn test_adaptive_duration_scales_with_distance() {
        let scene_diagonal = 10.0;

        // Short move: ~5% of diagonal → should be near minimum
        let short_eval = PathEvaluation {
            travel_distance: 0.5,
            required_distance: 0.5,
            min_clearance: None,
            animation_path: vec![],
        };
        let short_ms = AssemblySimulator::compute_step_duration(&short_eval, scene_diagonal);

        // Long move: ~80% of diagonal → should be near maximum
        let long_eval = PathEvaluation {
            travel_distance: 8.0,
            required_distance: 8.0,
            min_clearance: None,
            animation_path: vec![],
        };
        let long_ms = AssemblySimulator::compute_step_duration(&long_eval, scene_diagonal);

        assert!(
            short_ms >= 300 && short_ms <= 700,
            "Short move duration {} should be 300-700ms",
            short_ms
        );
        assert!(
            long_ms >= 1500 && long_ms <= 3000,
            "Long move duration {} should be 1500-3000ms",
            long_ms
        );
        assert!(
            long_ms > short_ms,
            "Long moves ({}) should take longer than short moves ({})",
            long_ms,
            short_ms
        );
    }

    #[test]
    fn test_adaptive_duration_zero_diagonal_fallback() {
        let eval = PathEvaluation {
            travel_distance: 5.0,
            required_distance: 5.0,
            min_clearance: None,
            animation_path: vec![],
        };
        let ms = AssemblySimulator::compute_step_duration(&eval, 0.0);
        assert_eq!(ms, 1500, "Zero diagonal should fallback to 1500ms");
    }

    #[test]
    fn test_simulation_result_has_clustering_fields() {
        // Build a simple assembly with identical parts (same size cubes)
        let mesh = create_cube_mesh(2.0);
        let part_a = create_test_part(
            "washer_1",
            "WASHER",
            mesh.clone(),
            Matrix4::identity(),
        );
        let part_b = create_test_part(
            "washer_2",
            "WASHER",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(5.0, 0.0, 0.0)),
        );
        let part_c = create_test_part(
            "bracket",
            "BRACKET",
            create_cube_mesh(2.0), // same mesh shape → identical geometry
            Matrix4::new_translation(&Vector3::new(0.0, 5.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Test".to_string(),
            original_name: "Test".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![part_a, part_b, part_c],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();
        let result = simulator.compute_sequence().unwrap();

        assert!(result.success, "Simulation failed: {:?}", result.error);

        // All three parts use the same mesh → should have at least one identical group
        assert!(
            !result.identical_groups.is_empty(),
            "Should detect identical geometry groups for same-mesh parts"
        );
        // The group should contain all three since they all use unit cubes
        let total_grouped: usize = result.identical_groups.iter().map(|g| g.len()).sum();
        assert!(
            total_grouped >= 2,
            "At least 2 parts should be in identical groups, got {}",
            total_grouped
        );

        // Subassemblies and kits may or may not be detected depending on
        // contact graph structure, but the fields should exist
        // (just verifying they're populated without error)
        let _ = &result.suggested_subassemblies;
        let _ = &result.kits;
    }

    #[test]
    fn test_removal_path_respects_removed_parts() {
        // Three cubes stacked vertically: A at bottom, B in middle, C on top.
        // C blocks B in +Y, and B blocks A in +Y.
        // After removing C (first in disassembly), B should be removable in +Y
        // because C is no longer in the collision set.
        let mesh = create_cube_mesh(2.0);
        let part_a = create_test_part(
            "a",
            "BASE",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0)),
        );
        let part_b = create_test_part(
            "b",
            "MIDDLE",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 2.0, 0.0)),
        );
        let part_c = create_test_part(
            "c",
            "TOP",
            mesh.clone(),
            Matrix4::new_translation(&Vector3::new(0.0, 4.0, 0.0)),
        );

        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Stack".to_string(),
            original_name: "Stack".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children: vec![part_a, part_b, part_c],
            metadata: Default::default(),
        };

        let mut simulator = AssemblySimulator::new(SimulatorConfig::default());
        simulator.load_assembly(&root).unwrap();
        let result = simulator.compute_sequence().unwrap();

        assert!(result.success, "Simulation should succeed: {:?}", result.error);
        assert_eq!(result.stuck_parts.len(), 0, "No parts should be stuck");
        assert_eq!(result.steps.len(), 3, "All 3 parts should be sequenced");
    }

    // ════════════════════════════════════════════════════════════════════
    // Blocking matrix tests
    // ════════════════════════════════════════════════════════════════════

    /// Helper: load parts into a simulator and return it (for BlockingMatrix tests).
    fn load_sim(children: Vec<AssemblyNode>) -> AssemblySimulator {
        let root = AssemblyNode {
            id: "root".to_string(),
            name: "Assembly".to_string(),
            original_name: "Assembly".to_string(),
            node_type: NodeType::Assembly,
            transform: Matrix4::identity(),
            bounding_box: None,
            mesh: None,
            children,
            metadata: Default::default(),
        };
        let mut sim = AssemblySimulator::new(SimulatorConfig::default());
        sim.load_assembly(&root).unwrap();
        sim
    }

    #[test]
    fn test_blocking_matrix_free_part() {
        // Three cubes in a row along X: left(-4,0,0), center(0,0,0), right(4,0,0).
        // Cubes are 2×2×2 with 2-unit gaps between them.
        // Center is blocked in ±X by neighbors, but free in ±Y and ±Z.
        let mesh = create_cube_mesh(2.0);
        let sim = load_sim(vec![
            create_test_part("left", "L", mesh.clone(), Matrix4::new_translation(&Vector3::new(-4.0, 0.0, 0.0))),
            create_test_part("center", "C", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("right", "R", mesh.clone(), Matrix4::new_translation(&Vector3::new(4.0, 0.0, 0.0))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);
        let removed = HashSet::new();

        // Center has free directions (Y, Z) so should NOT be blocked in all dirs
        assert!(
            !bm.is_blocked_in_all_directions("center", &removed),
            "Center should not be blocked — it has free Y and Z directions"
        );
        // Left is only blocked in +X direction, free in all others
        assert!(
            !bm.is_blocked_in_all_directions("left", &removed),
            "Left should not be fully blocked"
        );
    }

    #[test]
    fn test_blocking_matrix_trapped_part() {
        // Center cube at origin surrounded by 6 cubes on all faces.
        // Center should be blocked in ALL 6 canonical directions.
        // Gap of 0.1 between cubes so they are NOT baseline-intersecting
        // (parry3d intersection_test returns true for touching faces).
        let mesh = create_cube_mesh(2.0);
        let gap = 2.1; // half-extent(1.0) + half-extent(1.0) + 0.1 gap
        let sim = load_sim(vec![
            create_test_part("center", "C", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("px", "+X", mesh.clone(), Matrix4::new_translation(&Vector3::new(gap, 0.0, 0.0))),
            create_test_part("nx", "-X", mesh.clone(), Matrix4::new_translation(&Vector3::new(-gap, 0.0, 0.0))),
            create_test_part("py", "+Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, gap, 0.0))),
            create_test_part("ny", "-Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, -gap, 0.0))),
            create_test_part("pz", "+Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, gap))),
            create_test_part("nz", "-Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, -gap))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);
        let removed = HashSet::new();

        assert!(
            bm.is_blocked_in_all_directions("center", &removed),
            "Center cube should be blocked in all 6 directions by surrounding cubes"
        );
    }

    #[test]
    fn test_blocking_matrix_after_removal() {
        // Same trapped setup as above. After removing the +Y neighbor,
        // center should no longer be blocked in all directions.
        let mesh = create_cube_mesh(2.0);
        let gap = 2.1;
        let sim = load_sim(vec![
            create_test_part("center", "C", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("px", "+X", mesh.clone(), Matrix4::new_translation(&Vector3::new(gap, 0.0, 0.0))),
            create_test_part("nx", "-X", mesh.clone(), Matrix4::new_translation(&Vector3::new(-gap, 0.0, 0.0))),
            create_test_part("py", "+Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, gap, 0.0))),
            create_test_part("ny", "-Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, -gap, 0.0))),
            create_test_part("pz", "+Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, gap))),
            create_test_part("nz", "-Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, -gap))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);

        // Before removal: blocked
        let removed = HashSet::new();
        assert!(bm.is_blocked_in_all_directions("center", &removed));

        // After removing py: center is free in +Y
        let mut removed = HashSet::new();
        removed.insert("py".to_string());
        assert!(
            !bm.is_blocked_in_all_directions("center", &removed),
            "After removing +Y neighbor, center should be free in +Y direction"
        );
    }

    #[test]
    fn test_blocking_matrix_baseline_intersecting() {
        // Two cubes that overlap at rest (touching faces at origin).
        // Baseline-intersecting parts should NOT be recorded as mutual blockers.
        let mesh = create_cube_mesh(2.0);
        let sim = load_sim(vec![
            create_test_part("a", "A", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("b", "B", mesh.clone(), Matrix4::new_translation(&Vector3::new(1.5, 0.0, 0.0))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);
        let removed = HashSet::new();

        // Both parts overlap at rest, so neither should consider the other a blocker.
        // With only 2 overlapping parts and no other geometry, neither is fully blocked.
        assert!(
            !bm.is_blocked_in_all_directions("a", &removed),
            "Part A should not be blocked — overlapping part B is excluded from blockers"
        );
        assert!(
            !bm.is_blocked_in_all_directions("b", &removed),
            "Part B should not be blocked — overlapping part A is excluded from blockers"
        );

        // Verify total blocking pairs is 0 (since the only pair is baseline-intersecting)
        assert_eq!(
            bm.total_blocking_pairs(),
            0,
            "Baseline-intersecting parts should not appear as blocking pairs"
        );
    }

    #[test]
    fn test_blocking_matrix_isolated_part() {
        // A single cube far from anything else.
        // Should be free in all directions (no blockers at all).
        let mesh = create_cube_mesh(2.0);
        let sim = load_sim(vec![
            create_test_part("alone", "ALONE", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("far", "FAR", mesh.clone(), Matrix4::new_translation(&Vector3::new(500.0, 500.0, 500.0))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);
        let removed = HashSet::new();

        assert!(
            !bm.is_blocked_in_all_directions("alone", &removed),
            "Isolated part should be completely free"
        );
        assert!(
            !bm.is_blocked_in_all_directions("far", &removed),
            "Distant part should also be completely free"
        );
    }

    #[test]
    fn test_blocking_matrix_skips_counter() {
        // Verify that the blocking matrix skip counter increments when
        // a trapped part is skipped in find_removable_parts.
        // Surrounded center (trapped) + six exposed neighbor parts (free).
        let mesh = create_cube_mesh(2.0);
        let gap = 2.1;
        let sim = load_sim(vec![
            create_test_part("center", "C", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, 0.0))),
            create_test_part("px", "+X", mesh.clone(), Matrix4::new_translation(&Vector3::new(gap, 0.0, 0.0))),
            create_test_part("nx", "-X", mesh.clone(), Matrix4::new_translation(&Vector3::new(-gap, 0.0, 0.0))),
            create_test_part("py", "+Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, gap, 0.0))),
            create_test_part("ny", "-Y", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, -gap, 0.0))),
            create_test_part("pz", "+Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, gap))),
            create_test_part("nz", "-Z", mesh.clone(), Matrix4::new_translation(&Vector3::new(0.0, 0.0, -gap))),
        ]);

        let bm = BlockingMatrix::build(&sim.parts, sim.config.removal_distance, 0.0);
        let bm_skips = Cell::new(0u64);

        // Build a minimal contact graph for the call
        let contact_graph = ContactGraph::build(
            sim.parts.iter().map(|p| (p.id.as_str(), &p.mesh, &p.transform)),
            sim.config.removal_distance * 0.001,
        );
        let kinds: HashMap<String, PartKind> = HashMap::new();

        let _removable = sim.find_removable_parts(
            &contact_graph,
            &kinds,
            0.0,
            Instant::now() + Duration::from_secs(5),
            &bm,
            &bm_skips,
        );

        // The center part is surrounded and should be skipped by the blocking matrix.
        // Exact skip count depends on geometry, but should be >= 1 (center is trapped).
        assert!(
            bm_skips.get() >= 1,
            "Expected at least 1 blocking matrix skip for the trapped center part, got {}",
            bm_skips.get()
        );
    }
}
