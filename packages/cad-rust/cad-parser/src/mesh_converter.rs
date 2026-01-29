//! Mesh conversion utilities for B-Rep to triangle mesh conversion.

use cad_common::TriangleMesh;
use nalgebra::{Point3, Vector3};
use thiserror::Error;

/// Errors that can occur during mesh conversion.
#[derive(Debug, Error)]
pub enum MeshError {
    #[error("Empty geometry")]
    EmptyGeometry,
    #[error("Invalid topology")]
    InvalidTopology,
    #[error("Tessellation failed: {0}")]
    TessellationFailed(String),
}

/// Configuration for mesh tessellation.
#[derive(Debug, Clone)]
pub struct TessellationConfig {
    /// Maximum deviation from the true surface (chord tolerance).
    pub chord_tolerance: f64,
    /// Maximum angle between adjacent facet normals.
    pub angle_tolerance: f64,
    /// Minimum edge length for tessellation.
    pub min_edge_length: f64,
}

impl Default for TessellationConfig {
    fn default() -> Self {
        Self {
            chord_tolerance: 0.1,
            angle_tolerance: 15.0_f64.to_radians(),
            min_edge_length: 0.01,
        }
    }
}

/// Tessellate B-Rep geometry to a triangle mesh.
///
/// Note: This is a placeholder. Real implementation would use truck-polymesh.
pub fn tessellate_brep(
    // In real implementation, this would take a truck Solid or Shell
    _shape: &(),
    _config: &TessellationConfig,
) -> Result<TriangleMesh, MeshError> {
    // Placeholder implementation
    Ok(TriangleMesh::new())
}

/// Compute vertex normals for a triangle mesh.
pub fn compute_normals(mesh: &mut TriangleMesh) {
    let mut normals = vec![Vector3::zeros(); mesh.vertices.len()];
    let mut counts = vec![0u32; mesh.vertices.len()];

    // Accumulate face normals at each vertex
    for [i0, i1, i2] in &mesh.indices {
        let v0 = mesh.vertices[*i0 as usize];
        let v1 = mesh.vertices[*i1 as usize];
        let v2 = mesh.vertices[*i2 as usize];

        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let face_normal = edge1.cross(&edge2);

        for &idx in &[*i0, *i1, *i2] {
            normals[idx as usize] += face_normal;
            counts[idx as usize] += 1;
        }
    }

    // Normalize
    for (normal, count) in normals.iter_mut().zip(counts.iter()) {
        if *count > 0 {
            *normal = normal.normalize();
        }
    }

    mesh.normals = Some(normals);
}

/// Merge duplicate vertices in a mesh.
pub fn merge_duplicate_vertices(mesh: &mut TriangleMesh, tolerance: f32) {
    use std::collections::HashMap;

    let tolerance_sq = tolerance * tolerance;
    let mut vertex_map: HashMap<usize, usize> = HashMap::new();
    let mut new_vertices: Vec<Point3<f32>> = Vec::new();

    for (old_idx, vertex) in mesh.vertices.iter().enumerate() {
        // Check if this vertex is close to any existing new vertex
        let mut found_match = None;
        for (new_idx, new_vertex) in new_vertices.iter().enumerate() {
            let dist_sq = (vertex - new_vertex).norm_squared();
            if dist_sq < tolerance_sq {
                found_match = Some(new_idx);
                break;
            }
        }

        if let Some(new_idx) = found_match {
            vertex_map.insert(old_idx, new_idx);
        } else {
            vertex_map.insert(old_idx, new_vertices.len());
            new_vertices.push(*vertex);
        }
    }

    // Remap indices
    for triangle in &mut mesh.indices {
        for idx in triangle.iter_mut() {
            if let Some(&new_idx) = vertex_map.get(&(*idx as usize)) {
                *idx = new_idx as u32;
            }
            // If index not found, keep original (shouldn't happen with valid mesh data)
        }
    }

    mesh.vertices = new_vertices;
    mesh.normals = None; // Normals need to be recomputed
}

/// Simplify a mesh by reducing triangle count.
pub fn simplify_mesh(_mesh: &mut TriangleMesh, target_ratio: f32) {
    // This would use a mesh decimation algorithm
    // For now, just skip if ratio is 1.0
    if target_ratio >= 1.0 {
        return;
    }

    // Placeholder: In production, use a proper mesh decimation library
    // like meshopt or similar
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tessellation_config_default() {
        let config = TessellationConfig::default();
        assert!((config.chord_tolerance - 0.1).abs() < f64::EPSILON);
    }

    #[test]
    fn test_compute_normals_empty_mesh() {
        let mut mesh = TriangleMesh::new();
        compute_normals(&mut mesh);
        assert!(mesh.normals.is_none() || mesh.normals.as_ref().unwrap().is_empty());
    }
}
