//! Assembly tree and step types.

use crate::types::{BoundingBox, Transform4x4, TriangleMesh};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Node type in the assembly tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    /// An assembly containing other assemblies or parts.
    Assembly,
    /// A leaf part with geometry.
    Part,
}

/// Returns identity matrix as default transform.
fn default_transform() -> Transform4x4 {
    Transform4x4::identity()
}

/// Deserialize transform, treating null as identity matrix.
fn deserialize_transform_or_identity<'de, D>(deserializer: D) -> Result<Transform4x4, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Try to deserialize as Option<Transform4x4>, convert None to identity
    let opt: Option<Transform4x4> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_else(Transform4x4::identity))
}

/// A node in the assembly tree hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyNode {
    /// Unique identifier.
    pub id: String,
    /// Display name (can be modified by user).
    pub name: String,
    /// Original name from the STEP file.
    pub original_name: String,
    /// Node type (assembly or part).
    pub node_type: NodeType,
    /// Transformation relative to parent.
    /// Defaults to identity matrix if not provided or null in JSON.
    #[serde(default = "default_transform", deserialize_with = "deserialize_transform_or_identity")]
    pub transform: Transform4x4,
    /// Bounding box in local coordinates.
    pub bounding_box: Option<BoundingBox>,
    /// Triangle mesh (only for parts).
    #[serde(skip)]
    pub mesh: Option<TriangleMesh>,
    /// Child nodes (only for assemblies).
    #[serde(default)]
    pub children: Vec<AssemblyNode>,
    /// Metadata from STEP file.
    #[serde(default)]
    pub metadata: AssemblyNodeMetadata,
}

/// Additional metadata for an assembly node.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AssemblyNodeMetadata {
    /// Material name.
    pub material: Option<String>,
    /// Part number.
    pub part_number: Option<String>,
    /// Color (RGB).
    pub color: Option<[f32; 3]>,
    /// Mass in kg.
    pub mass: Option<f32>,
}

impl AssemblyNode {
    /// Create a new assembly node.
    pub fn new_assembly(name: String, original_name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            original_name,
            node_type: NodeType::Assembly,
            transform: Transform4x4::identity(),
            bounding_box: None,
            mesh: None,
            children: Vec::new(),
            metadata: AssemblyNodeMetadata::default(),
        }
    }

    /// Create a new part node.
    pub fn new_part(name: String, original_name: String, mesh: TriangleMesh) -> Self {
        let bounding_box = mesh.bounding_box();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            original_name,
            node_type: NodeType::Part,
            transform: Transform4x4::identity(),
            bounding_box,
            mesh: Some(mesh),
            children: Vec::new(),
            metadata: AssemblyNodeMetadata::default(),
        }
    }

    /// Check if this node is a part.
    pub fn is_part(&self) -> bool {
        self.node_type == NodeType::Part
    }

    /// Check if this node is an assembly.
    pub fn is_assembly(&self) -> bool {
        self.node_type == NodeType::Assembly
    }

    /// Get all part nodes recursively.
    pub fn get_all_parts(&self) -> Vec<&AssemblyNode> {
        let mut parts = Vec::new();
        self.collect_parts(&mut parts);
        parts
    }

    fn collect_parts<'a>(&'a self, parts: &mut Vec<&'a AssemblyNode>) {
        if self.is_part() {
            parts.push(self);
        }
        for child in &self.children {
            child.collect_parts(parts);
        }
    }

    /// Find a node by ID.
    pub fn find_by_id(&self, id: &str) -> Option<&AssemblyNode> {
        if self.id == id {
            return Some(self);
        }
        for child in &self.children {
            if let Some(found) = child.find_by_id(id) {
                return Some(found);
            }
        }
        None
    }
}

/// An assembly step in the generated sequence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyStep {
    /// Step number (1-indexed).
    pub step_number: u32,
    /// Part IDs involved in this step.
    pub part_ids: Vec<String>,
    /// Display names for the parts.
    pub part_names: Vec<String>,
    /// Direction the part(s) move in for assembly.
    pub assembly_direction: [f32; 3],
    /// Animation keyframes (transforms at different times).
    pub animation_path: Vec<AnimationKeyframe>,
    /// Suggested duration in milliseconds.
    pub suggested_duration_ms: u32,
    /// Motion archetype used by the planner (optional metadata).
    #[serde(default)]
    pub motion_type: Option<String>,
    /// Minimum observed clearance along the path, in model units.
    #[serde(default)]
    pub min_clearance: Option<f32>,
    /// Planner quality score for this step (higher is better).
    #[serde(default)]
    pub planner_score: Option<f32>,
    /// Distance the part travels along assembly_direction (model units).
    #[serde(default)]
    pub motion_distance: Option<f32>,
}

/// A keyframe in an assembly animation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimationKeyframe {
    /// Time in the animation (0.0 to 1.0).
    pub time: f32,
    /// Transform at this keyframe.
    pub transform: Transform4x4,
}

/// Simulation issue category.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimulationIssueKind {
    Overlap,
    Clearance,
    PathNotFound,
    ConstraintConflict,
}

/// Simulation issue severity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SimulationIssueSeverity {
    Error,
    Warning,
}

/// Structured issue emitted by the simulator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationIssue {
    /// Category of issue.
    pub kind: SimulationIssueKind,
    /// Severity of issue.
    pub severity: SimulationIssueSeverity,
    /// Involved part IDs.
    pub part_ids: Vec<String>,
    /// Human-readable explanation.
    pub message: String,
    /// Optional issue-specific numeric/debug metrics.
    #[serde(default)]
    pub metrics: Option<Value>,
}

/// Planner statistics for debugging and monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerStats {
    /// Contact graph edge count.
    pub contact_edges: usize,
    /// Dependency graph edge count.
    pub dependency_edges: usize,
    /// Number of candidate paths evaluated.
    pub candidate_paths_evaluated: u64,
    /// Number of collision checks performed.
    pub collision_checks: u64,
    /// Number of overlap issues detected in the assembled state.
    pub overlap_issue_count: usize,
}

/// Result of running the assembly sequence simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    /// Generated assembly steps.
    pub steps: Vec<AssemblyStep>,
    /// Parts that couldn't be sequenced (stuck).
    pub stuck_parts: Vec<String>,
    /// Total simulation time in milliseconds.
    pub simulation_time_ms: u64,
    /// Whether the simulation completed successfully.
    pub success: bool,
    /// Error message if simulation failed.
    pub error: Option<String>,
    /// Structured issues discovered by the planner.
    #[serde(default)]
    pub issues: Vec<SimulationIssue>,
    /// Planner statistics for observability.
    #[serde(default)]
    pub planner_stats: Option<PlannerStats>,
}
