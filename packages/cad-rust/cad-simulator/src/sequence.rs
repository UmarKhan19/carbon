//! Assembly sequence generation algorithms.

use cad_common::{AssemblyNode, AssemblyStep};
use std::collections::HashMap;

/// Priority rules for ordering parts during disassembly.
#[derive(Debug, Clone)]
pub struct SequencingRules {
    /// Parts that should be removed first (e.g., fasteners).
    pub priority_patterns: Vec<String>,
    /// Parts that should be removed last (e.g., base plates).
    pub base_patterns: Vec<String>,
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
            ],
            base_patterns: vec![
                "base".to_string(),
                "frame".to_string(),
                "housing".to_string(),
                "plate".to_string(),
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
        r"_\d+$",      // _001, _1
        r"\s*x\d+$",   // x4, x 4
        r"\s*\(\d+\)$", // (1), (4)
        r"\s*#\d+$",   // #1, #4
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
