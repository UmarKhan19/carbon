//! Exploded view calculations for assembly visualization.

use nalgebra::{Point3, Vector3};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Configuration for exploded view generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct ExplodedViewConfig {
    /// Explosion factor (1.0 = no explosion, 2.0 = double spacing).
    factor: f32,
    /// Center point for explosion (parts move away from this point).
    center: [f32; 3],
    /// Whether to use axis-aligned explosion (parts move along X, Y, or Z only).
    axis_aligned: bool,
}

#[wasm_bindgen]
impl ExplodedViewConfig {
    /// Create a new exploded view configuration.
    #[wasm_bindgen(constructor)]
    pub fn new(factor: f32, center_x: f32, center_y: f32, center_z: f32, axis_aligned: bool) -> Self {
        Self {
            factor,
            center: [center_x, center_y, center_z],
            axis_aligned,
        }
    }

    /// Get the explosion factor.
    #[wasm_bindgen(getter)]
    pub fn factor(&self) -> f32 {
        self.factor
    }

    /// Set the explosion factor.
    #[wasm_bindgen(setter)]
    pub fn set_factor(&mut self, factor: f32) {
        self.factor = factor;
    }
}

/// Part data for exploded view calculation.
#[derive(Debug, Clone)]
#[wasm_bindgen]
pub struct PartPosition {
    /// Part ID.
    id: String,
    /// Original position (x, y, z).
    position: [f32; 3],
    /// Bounding box center (for better explosion direction).
    bbox_center: [f32; 3],
}

#[wasm_bindgen]
impl PartPosition {
    /// Create a new part position.
    #[wasm_bindgen(constructor)]
    pub fn new(id: &str, position: &[f32], bbox_center: &[f32]) -> Self {
        Self {
            id: id.to_string(),
            position: [
                position.get(0).copied().unwrap_or(0.0),
                position.get(1).copied().unwrap_or(0.0),
                position.get(2).copied().unwrap_or(0.0),
            ],
            bbox_center: [
                bbox_center.get(0).copied().unwrap_or(0.0),
                bbox_center.get(1).copied().unwrap_or(0.0),
                bbox_center.get(2).copied().unwrap_or(0.0),
            ],
        }
    }

    /// Get the part ID.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }
}

/// Calculate exploded position for a single part.
#[wasm_bindgen]
pub fn calculate_exploded_position(
    part: &PartPosition,
    config: &ExplodedViewConfig,
) -> Vec<f32> {
    let center = Point3::new(config.center[0], config.center[1], config.center[2]);
    let part_center = Point3::new(
        part.bbox_center[0],
        part.bbox_center[1],
        part.bbox_center[2],
    );

    // Direction from explosion center to part
    let mut direction = part_center - center;

    if config.axis_aligned {
        // Use only the dominant axis
        let abs_x = direction.x.abs();
        let abs_y = direction.y.abs();
        let abs_z = direction.z.abs();

        if abs_x >= abs_y && abs_x >= abs_z {
            direction = Vector3::new(direction.x.signum(), 0.0, 0.0);
        } else if abs_y >= abs_x && abs_y >= abs_z {
            direction = Vector3::new(0.0, direction.y.signum(), 0.0);
        } else {
            direction = Vector3::new(0.0, 0.0, direction.z.signum());
        }
    }

    // Normalize direction
    let distance = direction.norm();
    if distance < 0.001 {
        // Part is at the center, don't move it
        return vec![part.position[0], part.position[1], part.position[2]];
    }

    let direction = direction.normalize();

    // Calculate offset
    let offset = direction * distance * (config.factor - 1.0);

    vec![
        part.position[0] + offset.x,
        part.position[1] + offset.y,
        part.position[2] + offset.z,
    ]
}

/// Calculate the center point for explosion based on all part positions.
#[wasm_bindgen]
pub fn calculate_explosion_center(positions: Vec<f32>) -> Vec<f32> {
    if positions.is_empty() || positions.len() % 3 != 0 {
        return vec![0.0, 0.0, 0.0];
    }

    let num_parts = positions.len() / 3;
    let mut sum = [0.0f32; 3];

    for i in 0..num_parts {
        sum[0] += positions[i * 3];
        sum[1] += positions[i * 3 + 1];
        sum[2] += positions[i * 3 + 2];
    }

    vec![
        sum[0] / num_parts as f32,
        sum[1] / num_parts as f32,
        sum[2] / num_parts as f32,
    ]
}
