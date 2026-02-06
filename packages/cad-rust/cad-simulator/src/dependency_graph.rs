//! Dependency graph for assembly sequencing constraints.
//!
//! Converts contact relationships and part classifications into assembly
//! constraints. The dependency graph encodes:
//! - "A must be assembled before B" relationships
//! - Sub-assembly groups (cycles in the dependency graph)
//!
//! Key rules:
//! 1. Fasteners are assembled after the parts they connect
//! 2. Structural parts are assembled before the parts that attach to them
//! 3. Cycles indicate sub-assemblies that must be built together

use std::collections::{HashMap, HashSet, VecDeque};
use tracing::{debug, info, warn};

use crate::contact_graph::ContactGraph;
use crate::sequence::{PartClassification, PartKind};

/// Default threshold for fastener classification.
pub const DEFAULT_FASTENER_THRESHOLD: f32 = 0.5;

/// Default threshold for structural classification.
pub const DEFAULT_STRUCTURAL_THRESHOLD: f32 = 0.7;

/// Assembly dependency graph.
///
/// Edges represent "must be assembled before" relationships.
/// If A → B exists, then A must be assembled before B.
#[derive(Debug, Clone, Default)]
pub struct DependencyGraph {
    /// Forward edges: part_id → list of parts that depend on it
    /// (i.e., must be assembled after this part)
    forward: HashMap<String, Vec<String>>,

    /// Reverse edges: part_id → list of parts it depends on
    /// (i.e., must be assembled before this part)
    reverse: HashMap<String, Vec<String>>,

    /// All part IDs in the graph.
    parts: HashSet<String>,
}

impl DependencyGraph {
    /// Create a new empty dependency graph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a dependency graph from contact and classification data.
    ///
    /// # Arguments
    /// * `contact_graph` - Graph of which parts are in contact
    /// * `classifications` - Classification scores for each part
    /// * `fastener_threshold` - Score above which a part is treated as fastener
    /// * `structural_threshold` - Score above which a part is treated as structural
    ///
    /// # Rules Applied
    /// 1. If F is a fastener contacting parts A, B, C then A, B, C → F
    ///    (A, B, C must be assembled before F)
    /// 2. If S is structural contacting non-fasteners A, B then S → A, S → B
    ///    (S must be assembled before A, B)
    pub fn build(
        contact_graph: &ContactGraph,
        classifications: &HashMap<String, PartClassification>,
        kinds: &HashMap<String, PartKind>,
        fastener_threshold: f32,
        structural_threshold: f32,
    ) -> Self {
        let mut graph = DependencyGraph::new();

        // Initialize all parts
        for part_id in classifications.keys() {
            graph.parts.insert(part_id.clone());
            graph.forward.entry(part_id.clone()).or_default();
            graph.reverse.entry(part_id.clone()).or_default();
        }

        let kind_for = |part_id: &str| -> PartKind {
            kinds.get(part_id).copied().unwrap_or(PartKind::Unknown)
        };
        let is_fastener = |part_id: &str| -> bool {
            match kind_for(part_id) {
                PartKind::Fastener => true,
                PartKind::Structural | PartKind::Panel => false,
                PartKind::Unknown => classifications
                    .get(part_id)
                    .map(|c| c.fastener_score >= fastener_threshold)
                    .unwrap_or(false),
            }
        };
        let is_structural = |part_id: &str| -> bool {
            match kind_for(part_id) {
                PartKind::Structural => true,
                PartKind::Fastener | PartKind::Panel => false,
                PartKind::Unknown => classifications
                    .get(part_id)
                    .map(|c| c.structural_score >= structural_threshold)
                    .unwrap_or(false),
            }
        };
        let is_panel = |part_id: &str| -> bool {
            match kind_for(part_id) {
                PartKind::Panel => true,
                PartKind::Fastener | PartKind::Structural => false,
                PartKind::Unknown => classifications
                    .get(part_id)
                    .map(|c| c.panel_score >= 0.35)
                    .unwrap_or(false),
            }
        };

        // Rule 1: Fasteners come after their neighbors
        for (part_id, class) in classifications {
            if is_fastener(part_id) || class.fastener_score >= fastener_threshold {
                for neighbor in contact_graph.neighbors(part_id) {
                    // Skip if neighbor is also a fastener (avoid mutual dependencies)
                    if is_fastener(neighbor) {
                        continue;
                    }

                    // neighbor must be assembled BEFORE this fastener
                    graph.add_edge(neighbor, part_id);
                    debug!("Dependency: {} → {} (fastener rule)", neighbor, part_id);
                }
            }
        }

        // Rule 2: Structural parts come before their non-fastener neighbors
        for (part_id, class) in classifications {
            if is_structural(part_id) || class.structural_score >= structural_threshold {
                for neighbor in contact_graph.neighbors(part_id) {
                    // Skip fasteners (already handled by Rule 1)
                    if is_fastener(neighbor) {
                        continue;
                    }

                    // This structural part must be assembled BEFORE its neighbor
                    graph.add_edge(part_id, neighbor);
                    debug!("Dependency: {} → {} (structural rule)", part_id, neighbor);
                }
            }
        }

        // Rule 3: Panels sit between structural parts and fasteners.
        for (part_id, class) in classifications {
            if is_panel(part_id) || class.panel_score >= 0.35 {
                for neighbor in contact_graph.neighbors(part_id) {
                    if is_fastener(neighbor) {
                        // Panels should be assembled before fasteners.
                        graph.add_edge(part_id, neighbor);
                        debug!("Dependency: {} → {} (panel → fastener)", part_id, neighbor);
                    } else if is_structural(neighbor) {
                        // Structural parts should be assembled before panels.
                        graph.add_edge(neighbor, part_id);
                        debug!(
                            "Dependency: {} → {} (structural → panel)",
                            neighbor, part_id
                        );
                    }
                }
            }
        }

        let edge_count: usize = graph.forward.values().map(|v| v.len()).sum();
        info!(
            "Dependency graph built: {} parts, {} edges",
            graph.parts.len(),
            edge_count
        );

        graph
    }

    /// Add an edge: `from` must be assembled before `to`.
    fn add_edge(&mut self, from: &str, to: &str) {
        // Avoid self-loops
        if from == to {
            return;
        }

        // Avoid duplicate edges
        if let Some(deps) = self.forward.get(from) {
            if deps.contains(&to.to_string()) {
                return;
            }
        }

        self.forward
            .entry(from.to_string())
            .or_default()
            .push(to.to_string());
        self.reverse
            .entry(to.to_string())
            .or_default()
            .push(from.to_string());
    }

    /// Get parts that must be assembled before this part.
    pub fn dependencies(&self, part_id: &str) -> &[String] {
        self.reverse
            .get(part_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get parts that depend on this part (must be assembled after).
    pub fn dependents(&self, part_id: &str) -> &[String] {
        self.forward
            .get(part_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Check if a part can be assembled given the current set of assembled parts.
    ///
    /// A part can be assembled if all its dependencies have been assembled.
    pub fn can_assemble(&self, part_id: &str, assembled: &HashSet<String>) -> bool {
        self.dependencies(part_id)
            .iter()
            .all(|dep| assembled.contains(dep))
    }

    /// Check if a part can be disassembled given the current set of removed parts.
    ///
    /// A part can be disassembled (removed) if all parts that depend on it
    /// have already been removed.
    pub fn can_disassemble(&self, part_id: &str, removed: &HashSet<String>) -> bool {
        self.dependents(part_id)
            .iter()
            .all(|dep| removed.contains(dep))
    }

    /// Perform topological sort with cycle detection.
    ///
    /// # Returns
    /// * `Ok(order)` - Valid assembly order (no cycles)
    /// * `Err(cycles)` - Cycles detected, each cycle is a sub-assembly group
    pub fn topological_sort(&self) -> Result<Vec<String>, Vec<Vec<String>>> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut result: Vec<String> = Vec::new();

        // Calculate in-degrees
        for part in &self.parts {
            let deps = self.reverse.get(part).map(|v| v.len()).unwrap_or(0);
            in_degree.insert(part.clone(), deps);
            if deps == 0 {
                queue.push_back(part.clone());
            }
        }

        // Kahn's algorithm
        while let Some(part) = queue.pop_front() {
            result.push(part.clone());

            if let Some(dependents) = self.forward.get(&part) {
                for dep in dependents {
                    if let Some(count) = in_degree.get_mut(dep) {
                        *count -= 1;
                        if *count == 0 {
                            queue.push_back(dep.clone());
                        }
                    }
                }
            }
        }

        // Check for cycles
        if result.len() < self.parts.len() {
            // Find cycles using Tarjan's algorithm
            let cycles = self.find_cycles(&result);
            warn!(
                "Dependency graph has {} cycles (sub-assemblies)",
                cycles.len()
            );
            Err(cycles)
        } else {
            Ok(result)
        }
    }

    /// Find strongly connected components (cycles) in the remaining graph.
    fn find_cycles(&self, processed: &[String]) -> Vec<Vec<String>> {
        let processed_set: HashSet<_> = processed.iter().cloned().collect();
        let remaining: Vec<_> = self
            .parts
            .iter()
            .filter(|p| !processed_set.contains(*p))
            .cloned()
            .collect();

        if remaining.is_empty() {
            return Vec::new();
        }

        // Simple cycle detection: find connected components in remaining parts
        let mut visited: HashSet<String> = HashSet::new();
        let mut cycles: Vec<Vec<String>> = Vec::new();

        for start in &remaining {
            if visited.contains(start) {
                continue;
            }

            // BFS to find connected component
            let mut component: Vec<String> = Vec::new();
            let mut queue: VecDeque<String> = VecDeque::new();
            queue.push_back(start.clone());

            while let Some(part) = queue.pop_front() {
                if visited.contains(&part) {
                    continue;
                }
                visited.insert(part.clone());
                component.push(part.clone());

                // Add neighbors (both forward and reverse edges)
                if let Some(deps) = self.forward.get(&part) {
                    for dep in deps {
                        if remaining.contains(dep) && !visited.contains(dep) {
                            queue.push_back(dep.clone());
                        }
                    }
                }
                if let Some(deps) = self.reverse.get(&part) {
                    for dep in deps {
                        if remaining.contains(dep) && !visited.contains(dep) {
                            queue.push_back(dep.clone());
                        }
                    }
                }
            }

            if !component.is_empty() {
                cycles.push(component);
            }
        }

        cycles
    }

    /// Get the number of parts in the graph.
    pub fn part_count(&self) -> usize {
        self.parts.len()
    }

    /// Get the total number of edges in the graph.
    pub fn edge_count(&self) -> usize {
        self.forward.values().map(|v| v.len()).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{Isometry3, Point3};
    use parry3d::shape::TriMesh;

    fn create_unit_cube_mesh() -> TriMesh {
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

    #[test]
    fn test_fastener_depends_on_neighbors() {
        // Setup: Two plates with a bolt between them
        // plate_a -- bolt -- plate_b
        let mesh = create_unit_cube_mesh();
        let transform_a = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_bolt = Isometry3::translation(1.0, 0.0, 0.0);
        let transform_b = Isometry3::translation(2.0, 0.0, 0.0);

        let parts = vec![
            ("plate_a", &mesh, &transform_a),
            ("bolt", &mesh, &transform_bolt),
            ("plate_b", &mesh, &transform_b),
        ];
        let contact_graph = ContactGraph::build(parts, 0.1);

        // Classify: bolt is fastener, plates are structural
        let mut classifications = HashMap::new();
        classifications.insert(
            "plate_a".to_string(),
            PartClassification {
                fastener_score: 0.0,
                structural_score: 0.8,
                panel_score: 0.0,
            },
        );
        classifications.insert(
            "bolt".to_string(),
            PartClassification {
                fastener_score: 0.9,
                structural_score: 0.0,
                panel_score: 0.0,
            },
        );
        classifications.insert(
            "plate_b".to_string(),
            PartClassification {
                fastener_score: 0.0,
                structural_score: 0.8,
                panel_score: 0.0,
            },
        );

        let mut kinds = HashMap::new();
        kinds.insert("plate_a".to_string(), PartKind::Structural);
        kinds.insert("bolt".to_string(), PartKind::Fastener);
        kinds.insert("plate_b".to_string(), PartKind::Structural);

        let dep_graph = DependencyGraph::build(&contact_graph, &classifications, &kinds, 0.5, 0.7);

        // Bolt should depend on its neighbors (plate_a and plate_b)
        let bolt_deps = dep_graph.dependencies("bolt");
        assert!(
            bolt_deps.contains(&"plate_a".to_string()),
            "Bolt should depend on plate_a"
        );
        assert!(
            bolt_deps.contains(&"plate_b".to_string()),
            "Bolt should depend on plate_b"
        );
    }

    #[test]
    fn test_panel_between_structural_and_fastener() {
        let mesh = create_unit_cube_mesh();

        let transform_struct = Isometry3::translation(0.0, 0.0, 0.0);
        let transform_panel = Isometry3::translation(1.0, 0.0, 0.0);
        let transform_fastener = Isometry3::translation(2.0, 0.0, 0.0);

        let parts = vec![
            ("frame", &mesh, &transform_struct),
            ("cover", &mesh, &transform_panel),
            ("bolt", &mesh, &transform_fastener),
        ];
        let contact_graph = ContactGraph::build(parts, 0.1);

        let mut classifications = HashMap::new();
        classifications.insert(
            "frame".to_string(),
            PartClassification {
                fastener_score: 0.0,
                structural_score: 0.9,
                panel_score: 0.0,
            },
        );
        classifications.insert(
            "cover".to_string(),
            PartClassification {
                fastener_score: 0.0,
                structural_score: 0.1,
                panel_score: 0.7,
            },
        );
        classifications.insert(
            "bolt".to_string(),
            PartClassification {
                fastener_score: 0.9,
                structural_score: 0.0,
                panel_score: 0.0,
            },
        );

        let mut kinds = HashMap::new();
        kinds.insert("frame".to_string(), PartKind::Structural);
        kinds.insert("cover".to_string(), PartKind::Panel);
        kinds.insert("bolt".to_string(), PartKind::Fastener);

        let dep_graph = DependencyGraph::build(&contact_graph, &classifications, &kinds, 0.5, 0.7);

        // Structural should come before panel
        assert!(
            dep_graph
                .dependencies("cover")
                .contains(&"frame".to_string()),
            "Panel should depend on structural part"
        );

        // Panel should come before fastener
        assert!(
            dep_graph
                .dependencies("bolt")
                .contains(&"cover".to_string()),
            "Fastener should depend on panel"
        );
    }

    #[test]
    fn test_topological_sort_no_cycles() {
        let mut graph = DependencyGraph::new();
        graph.parts.insert("base".to_string());
        graph.parts.insert("bracket".to_string());
        graph.parts.insert("screw".to_string());

        graph.forward.insert("base".to_string(), vec![]);
        graph.forward.insert("bracket".to_string(), vec![]);
        graph.forward.insert("screw".to_string(), vec![]);
        graph.reverse.insert("base".to_string(), vec![]);
        graph.reverse.insert("bracket".to_string(), vec![]);
        graph.reverse.insert("screw".to_string(), vec![]);

        // base → bracket → screw
        graph.add_edge("base", "bracket");
        graph.add_edge("bracket", "screw");

        let result = graph.topological_sort();
        assert!(result.is_ok(), "Should have valid topological order");

        let order = result.unwrap();
        let base_pos = order.iter().position(|p| p == "base").unwrap();
        let bracket_pos = order.iter().position(|p| p == "bracket").unwrap();
        let screw_pos = order.iter().position(|p| p == "screw").unwrap();

        assert!(base_pos < bracket_pos, "Base should come before bracket");
        assert!(bracket_pos < screw_pos, "Bracket should come before screw");
    }

    #[test]
    fn test_can_assemble() {
        let mut graph = DependencyGraph::new();
        graph.parts.insert("a".to_string());
        graph.parts.insert("b".to_string());
        graph.forward.insert("a".to_string(), vec![]);
        graph.forward.insert("b".to_string(), vec![]);
        graph.reverse.insert("a".to_string(), vec![]);
        graph.reverse.insert("b".to_string(), vec![]);

        graph.add_edge("a", "b"); // a must come before b

        let mut assembled = HashSet::new();

        // Initially, 'a' can be assembled (no dependencies)
        assert!(graph.can_assemble("a", &assembled));
        // 'b' cannot be assembled (depends on 'a')
        assert!(!graph.can_assemble("b", &assembled));

        // After assembling 'a', 'b' can be assembled
        assembled.insert("a".to_string());
        assert!(graph.can_assemble("b", &assembled));
    }

    #[test]
    fn test_can_disassemble() {
        let mut graph = DependencyGraph::new();
        graph.parts.insert("a".to_string());
        graph.parts.insert("b".to_string());
        graph.forward.insert("a".to_string(), vec![]);
        graph.forward.insert("b".to_string(), vec![]);
        graph.reverse.insert("a".to_string(), vec![]);
        graph.reverse.insert("b".to_string(), vec![]);

        graph.add_edge("a", "b"); // a must come before b in assembly
                                  // So in disassembly: b must be removed before a

        let mut removed = HashSet::new();

        // Initially, 'b' can be removed (nothing depends on it)
        assert!(graph.can_disassemble("b", &removed));
        // 'a' cannot be removed ('b' depends on it)
        assert!(!graph.can_disassemble("a", &removed));

        // After removing 'b', 'a' can be removed
        removed.insert("b".to_string());
        assert!(graph.can_disassemble("a", &removed));
    }
}
