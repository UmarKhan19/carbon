//! Assembly sequence generation algorithms.
//!
//! Provides part classification and sequencing rules for intelligent
//! assembly ordering. Parts are classified by combining:
//! - Name-based heuristics (pattern matching for "bolt", "screw", etc.)
//! - Geometric heuristics (size, aspect ratio, relative volume)
//! - Contact-based heuristics (number of adjacent parts)

use cad_common::{AssemblyNode, AssemblyStep};
use nalgebra::Vector3;
use std::collections::HashMap;

use crate::contact_graph::ContactGraph;

/// Priority rules for ordering parts during disassembly.
#[derive(Debug, Clone)]
pub struct SequencingRules {
    /// Parts that should be removed first (e.g., fasteners).
    pub priority_patterns: Vec<String>,
    /// Parts that should be removed last (e.g., base plates).
    pub base_patterns: Vec<String>,
    /// Parts that are typically panels or covers.
    pub panel_patterns: Vec<String>,
}

impl Default for SequencingRules {
    fn default() -> Self {
        Self {
            priority_patterns: vec![
                "screw".to_string(),
                "bolt".to_string(),
                "nut".to_string(),
                "washer".to_string(),
                "fastener".to_string(),
                "pin".to_string(),
                "rivet".to_string(),
                "clip".to_string(),
                "dowel".to_string(),
                "stud".to_string(),
                "spacer".to_string(),
            ],
            base_patterns: vec![
                "base".to_string(),
                "frame".to_string(),
                "housing".to_string(),
                "chassis".to_string(),
                "body".to_string(),
                "bracket".to_string(),
                "support".to_string(),
                "mount".to_string(),
                "beam".to_string(),
            ],
            panel_patterns: vec![
                "plate".to_string(),
                "panel".to_string(),
                "cover".to_string(),
                "door".to_string(),
                "lid".to_string(),
                "sheet".to_string(),
            ],
        }
    }
}

/// Calculate the priority of a part for sequencing.
pub fn calculate_part_priority(name: &str, rules: &SequencingRules) -> i32 {
    let name_lower = name.to_lowercase();

    // High priority (remove first in disassembly, last in assembly)
    for pattern in &rules.priority_patterns {
        if name_lower.contains(pattern) {
            return 100;
        }
    }

    // Low priority (remove last in disassembly, first in assembly)
    for pattern in &rules.base_patterns {
        if name_lower.contains(pattern) {
            return -100;
        }
    }

    0 // Normal priority
}

// ============================================================================
// Part Classification System
// ============================================================================

/// Classification scores for a part.
///
/// Each score is 0.0 to 1.0, representing confidence that the part
/// belongs to that category. A part can have multiple non-zero scores
/// (e.g., a bracket might score moderately on both structural and panel).
#[derive(Debug, Clone, Default)]
pub struct PartClassification {
    /// Likelihood this part is a fastener (screw, bolt, nut, washer, pin).
    /// High score means the part should be assembled last.
    pub fastener_score: f32,

    /// Likelihood this part is structural (base, frame, housing, chassis).
    /// High score means the part should be assembled first.
    pub structural_score: f32,

    /// Likelihood this part is a panel or cover (plate, door, lid).
    /// These typically go after structural but before fasteners.
    pub panel_score: f32,
}

impl PartClassification {
    /// Returns the dominant category (highest score).
    pub fn dominant_category(&self) -> &'static str {
        if self.fastener_score >= self.structural_score && self.fastener_score >= self.panel_score {
            "fastener"
        } else if self.structural_score >= self.panel_score {
            "structural"
        } else {
            "panel"
        }
    }

    /// Returns true if the part is likely a fastener (score > threshold).
    pub fn is_fastener(&self, threshold: f32) -> bool {
        self.fastener_score >= threshold
    }

    /// Returns true if the part is likely structural (score > threshold).
    pub fn is_structural(&self, threshold: f32) -> bool {
        self.structural_score >= threshold
    }

    /// Returns true if the part is likely a panel (score > threshold).
    pub fn is_panel(&self, threshold: f32) -> bool {
        self.panel_score >= threshold
    }
}

/// Coarse part category used for sequencing rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartKind {
    Fastener,
    Structural,
    Panel,
    Unknown,
}

/// Input data for classifying a part.
pub struct PartClassificationInput<'a> {
    /// Part name (from STEP/GLB).
    pub name: &'a str,
    /// Bounding box dimensions (smallest to largest).
    pub bbox_dims: Vector3<f32>,
    /// Part's volume relative to total assembly volume (0.0 to 1.0).
    pub relative_volume: f32,
    /// Number of other parts this part contacts.
    pub contact_degree: usize,
}

/// Classify a part using name patterns, geometric features, and contact info.
///
/// # Arguments
/// * `input` - Part data for classification
/// * `rules` - Name pattern rules
///
/// # Returns
/// Classification scores for fastener, structural, and panel categories.
pub fn classify_part(
    input: &PartClassificationInput,
    rules: &SequencingRules,
) -> PartClassification {
    let name_lower = input.name.to_lowercase();

    // Sort bbox dimensions to get [min, mid, max]
    let mut dims = [input.bbox_dims.x, input.bbox_dims.y, input.bbox_dims.z];
    dims.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let [dim_min, _dim_mid, dim_max] = dims;

    // Geometric features
    let aspect_ratio = dim_max / dim_min.max(0.001);
    let relative_volume = input.relative_volume;
    let contact_degree = input.contact_degree;

    // ═══════════════════════════════════════════════════════════════════════
    // Fastener scoring
    // ═══════════════════════════════════════════════════════════════════════
    let fastener_score = weighted_sum(&[
        // Name contains fastener keywords (strongest signal)
        (name_matches(&name_lower, &rules.priority_patterns), 0.5),
        // Small relative volume (< 2% of assembly)
        (relative_volume < 0.02, 0.2),
        // High aspect ratio (elongated, like a screw shaft)
        (aspect_ratio > 4.0, 0.15),
        // Few contacts (fasteners typically touch 2-3 parts)
        (contact_degree <= 3, 0.1),
        // Very small volume (< 0.5% - likely a small fastener)
        (relative_volume < 0.005, 0.05),
    ]);

    // ═══════════════════════════════════════════════════════════════════════
    // Structural scoring
    // ═══════════════════════════════════════════════════════════════════════
    let structural_score = weighted_sum(&[
        // Name contains structural keywords (strongest signal)
        (name_matches(&name_lower, &rules.base_patterns), 0.5),
        // Large relative volume (> 15% of assembly)
        (relative_volume > 0.15, 0.2),
        // Many contacts (structural parts support many other parts)
        (contact_degree > 4, 0.15),
        // Very large volume (> 30% - almost certainly structural)
        (relative_volume > 0.30, 0.1),
        // High contact count (> 6 - hub of the assembly)
        (contact_degree > 6, 0.05),
    ]);

    // ═══════════════════════════════════════════════════════════════════════
    // Panel scoring
    // ═══════════════════════════════════════════════════════════════════════
    let panel_score = weighted_sum(&[
        // Name contains panel keywords
        (name_matches(&name_lower, &rules.panel_patterns), 0.5),
        // Flat aspect (one dimension much smaller than others)
        (dim_min / dim_max.max(0.001) < 0.2, 0.25),
        // Medium relative volume (5-20%)
        (relative_volume > 0.05 && relative_volume < 0.20, 0.15),
        // Moderate contacts (panels typically touch structural + fasteners)
        (contact_degree >= 2 && contact_degree <= 5, 0.1),
    ]);

    PartClassification {
        fastener_score,
        structural_score,
        panel_score,
    }
}

/// Infer a coarse part kind using names and scores.
///
/// Name patterns are treated as strong signals. If no names match, score-based
/// inference is used with small margins to avoid oscillation on close scores.
pub fn infer_part_kind(
    name: &str,
    classification: &PartClassification,
    rules: &SequencingRules,
) -> PartKind {
    let name_lower = name.to_lowercase();

    if name_matches(&name_lower, &rules.priority_patterns) {
        return PartKind::Fastener;
    }
    if name_matches(&name_lower, &rules.base_patterns) {
        return PartKind::Structural;
    }
    if name_matches(&name_lower, &rules.panel_patterns) {
        return PartKind::Panel;
    }

    let max_score = classification.fastener_score.max(
        classification
            .structural_score
            .max(classification.panel_score),
    );

    if max_score < 0.35 {
        return PartKind::Unknown;
    }

    let margin = 0.05;
    if classification.fastener_score >= 0.45 && classification.fastener_score >= max_score - margin
    {
        return PartKind::Fastener;
    }
    if classification.structural_score >= 0.45
        && classification.structural_score >= max_score - margin
    {
        return PartKind::Structural;
    }
    if classification.panel_score >= 0.35 && classification.panel_score >= max_score - margin {
        return PartKind::Panel;
    }

    PartKind::Unknown
}

/// Compute a disassembly priority score (higher = removed earlier).
pub fn disassembly_priority(kind: PartKind, classification: &PartClassification) -> f32 {
    let base = match kind {
        PartKind::Fastener => 3.0,
        PartKind::Panel => 2.0,
        PartKind::Structural => 1.0,
        PartKind::Unknown => 1.5,
    };

    base * 10.0 + classification.fastener_score * 2.0 + classification.panel_score
        - classification.structural_score
}

/// Check if a name matches any of the patterns.
fn name_matches(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| name.contains(p))
}

/// Compute weighted sum of boolean conditions.
///
/// Each tuple is (condition, weight). Returns sum of weights where condition is true.
fn weighted_sum(conditions: &[(bool, f32)]) -> f32 {
    conditions
        .iter()
        .filter(|(cond, _)| *cond)
        .map(|(_, weight)| weight)
        .sum()
}

/// Classify all parts in an assembly.
///
/// # Arguments
/// * `parts` - Iterator of (part_id, part_name, bbox_size) tuples
/// * `contact_graph` - Pre-built contact graph
/// * `total_volume` - Sum of all part volumes (for relative volume calculation)
/// * `rules` - Sequencing rules with name patterns
///
/// # Returns
/// Map from part ID to classification.
pub fn classify_all_parts<'a>(
    parts: impl IntoIterator<Item = (&'a str, &'a str, &'a Vector3<f32>)>,
    contact_graph: &ContactGraph,
    total_volume: f32,
    rules: &SequencingRules,
) -> HashMap<String, PartClassification> {
    let total_volume = total_volume.max(0.001); // Avoid division by zero

    parts
        .into_iter()
        .map(|(id, name, bbox_size)| {
            let part_volume = bbox_size.x * bbox_size.y * bbox_size.z;
            let input = PartClassificationInput {
                name,
                bbox_dims: *bbox_size,
                relative_volume: part_volume / total_volume,
                contact_degree: contact_graph.degree(id),
            };
            (id.to_string(), classify_part(&input, rules))
        })
        .collect()
}

/// Group parts that can be assembled together (e.g., bolt + washer + nut).
pub fn identify_part_groups(parts: &[AssemblyNode]) -> HashMap<String, Vec<String>> {
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();

    // Simple heuristic: group parts with similar names
    for part in parts {
        let base_name = extract_base_name(&part.name);
        groups
            .entry(base_name)
            .or_insert_with(Vec::new)
            .push(part.id.clone());
    }

    // Filter out single-part groups
    groups.retain(|_, v| v.len() > 1);

    groups
}

/// Extract the base name from a part name (removes suffixes like _001, x4, etc.)
fn extract_base_name(name: &str) -> String {
    let name = name.trim();

    // Remove common suffixes
    let patterns = [
        r"_\d+$",       // _001, _1
        r"\s*x\d+$",    // x4, x 4
        r"\s*\(\d+\)$", // (1), (4)
        r"\s*#\d+$",    // #1, #4
    ];

    let mut result = name.to_string();
    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            result = re.replace_all(&result, "").into_owned();
        }
    }

    result.trim().to_string()
}

/// Optimize the assembly sequence for efficiency.
pub fn optimize_sequence(steps: &mut Vec<AssemblyStep>, rules: &SequencingRules) {
    // Sort by priority
    steps.sort_by(|a, b| {
        let priority_a = a
            .part_names
            .iter()
            .map(|n| calculate_part_priority(n, rules))
            .sum::<i32>();
        let priority_b = b
            .part_names
            .iter()
            .map(|n| calculate_part_priority(n, rules))
            .sum::<i32>();

        priority_b.cmp(&priority_a) // Higher priority first
    });

    // Renumber steps
    for (i, step) in steps.iter_mut().enumerate() {
        step.step_number = (i + 1) as u32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fastener_classification_by_name() {
        let rules = SequencingRules::default();
        let input = PartClassificationInput {
            name: "M6x20_Socket_Head_Screw",
            bbox_dims: Vector3::new(0.006, 0.006, 0.020), // Small screw-like dims
            relative_volume: 0.001,                       // Very small
            contact_degree: 2,
        };

        let class = classify_part(&input, &rules);

        assert!(
            class.fastener_score > 0.5,
            "Screw should score high as fastener"
        );
        assert!(class.is_fastener(0.5), "Should be classified as fastener");
        assert_eq!(class.dominant_category(), "fastener");
    }

    #[test]
    fn test_structural_classification_by_name() {
        let rules = SequencingRules::default();
        let input = PartClassificationInput {
            name: "Main_Frame_Assembly",
            bbox_dims: Vector3::new(100.0, 50.0, 200.0), // Large structural dims
            relative_volume: 0.35,                       // 35% of assembly
            contact_degree: 8,                           // Many parts attach to it
        };

        let class = classify_part(&input, &rules);

        assert!(
            class.structural_score > 0.5,
            "Frame should score high as structural"
        );
        assert!(
            class.is_structural(0.5),
            "Should be classified as structural"
        );
        assert_eq!(class.dominant_category(), "structural");
    }

    #[test]
    fn test_geometric_classification_without_name() {
        let rules = SequencingRules::default();

        // Small, elongated part with few contacts (fastener-like)
        let fastener_input = PartClassificationInput {
            name: "Part_001",                             // Generic name, no keywords
            bbox_dims: Vector3::new(0.005, 0.005, 0.025), // 5:1 aspect ratio
            relative_volume: 0.001,
            contact_degree: 2,
        };
        let fastener_class = classify_part(&fastener_input, &rules);

        // Large part with many contacts (structural-like)
        let structural_input = PartClassificationInput {
            name: "Part_002", // Generic name
            bbox_dims: Vector3::new(100.0, 80.0, 120.0),
            relative_volume: 0.40, // 40% of assembly
            contact_degree: 7,
        };
        let structural_class = classify_part(&structural_input, &rules);

        assert!(
            fastener_class.fastener_score > structural_class.fastener_score,
            "Small elongated part should score higher as fastener"
        );
        assert!(
            structural_class.structural_score > fastener_class.structural_score,
            "Large high-contact part should score higher as structural"
        );
    }

    #[test]
    fn test_panel_classification() {
        let rules = SequencingRules::default();
        let input = PartClassificationInput {
            name: "Cover_Plate",
            bbox_dims: Vector3::new(100.0, 100.0, 2.0), // Flat plate
            relative_volume: 0.08,                      // Medium volume
            contact_degree: 4,
        };

        let class = classify_part(&input, &rules);

        assert!(class.panel_score > 0.4, "Cover plate should score as panel");
    }

    #[test]
    fn test_infer_part_kind_by_name() {
        let rules = SequencingRules::default();
        let class = PartClassification {
            fastener_score: 0.0,
            structural_score: 0.0,
            panel_score: 0.0,
        };

        assert_eq!(
            infer_part_kind("M6_BOLT", &class, &rules),
            PartKind::Fastener
        );
        assert_eq!(
            infer_part_kind("MAIN_FRAME", &class, &rules),
            PartKind::Structural
        );
        assert_eq!(
            infer_part_kind("BACK_PANEL", &class, &rules),
            PartKind::Panel
        );
    }

    #[test]
    fn test_is_fastener_threshold_inclusive() {
        let class = PartClassification {
            fastener_score: 0.5,
            structural_score: 0.1,
            panel_score: 0.1,
        };
        assert!(class.is_fastener(0.5));
    }

    #[test]
    fn test_priority_order() {
        let rules = SequencingRules::default();

        // Verify fasteners have high priority (removed first in disassembly)
        assert_eq!(calculate_part_priority("M6_bolt", &rules), 100);
        assert_eq!(calculate_part_priority("hex_nut", &rules), 100);
        assert_eq!(calculate_part_priority("washer_flat", &rules), 100);

        // Verify structural parts have low priority (removed last in disassembly)
        assert_eq!(calculate_part_priority("base_frame", &rules), -100);
        assert_eq!(calculate_part_priority("housing_main", &rules), -100);

        // Generic parts have normal priority
        assert_eq!(calculate_part_priority("link_arm", &rules), 0);
    }
}
