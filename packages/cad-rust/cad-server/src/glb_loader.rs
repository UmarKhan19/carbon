//! GLB/glTF mesh extraction for simulation.
//!
//! This module loads mesh data from GLB files and matches them
//! to assembly tree nodes by name, enabling collision detection.

use cad_common::{AssemblyNode, TriangleMesh};
use nalgebra::Point3;
use std::collections::HashMap;
use thiserror::Error;
use tracing::{debug, info, warn};

/// Errors that can occur during GLB loading.
#[derive(Debug, Error)]
pub enum GlbLoaderError {
    #[error("Failed to parse GLB data: {0}")]
    ParseError(String),
    #[error("No meshes found in GLB")]
    NoMeshes,
    #[error("Failed to read mesh data: {0}")]
    MeshReadError(String),
}

/// Load meshes from GLB binary data.
///
/// Returns a HashMap mapping NODE name to TriangleMesh.
/// We use node names (not mesh names) because they match the assembly tree hierarchy.
pub fn load_meshes_from_glb(glb_data: &[u8]) -> Result<HashMap<String, TriangleMesh>, GlbLoaderError> {
    let gltf = gltf::Gltf::from_slice(glb_data)
        .map_err(|e| GlbLoaderError::ParseError(e.to_string()))?;

    // Get the binary blob
    let blob = gltf
        .blob
        .as_ref()
        .ok_or_else(|| GlbLoaderError::ParseError("GLB has no binary data".to_string()))?;

    // First, load all meshes by index
    let mut mesh_data: HashMap<usize, TriangleMesh> = HashMap::new();

    for mesh in gltf.meshes() {
        let mesh_index = mesh.index();
        let mesh_name = mesh.name().unwrap_or("Unnamed");
        debug!("Loading mesh index {}: {}", mesh_index, mesh_name);

        let mut all_vertices = Vec::new();
        let mut all_indices = Vec::new();
        let mut vertex_offset = 0u32;

        for primitive in mesh.primitives() {
            // Get position accessor
            let positions = primitive.get(&gltf::Semantic::Positions);
            let indices_accessor = primitive.indices();

            if let Some(pos_accessor) = positions {
                // Read vertex positions
                let view = pos_accessor.view().ok_or_else(|| {
                    GlbLoaderError::MeshReadError("No buffer view for positions".to_string())
                })?;

                let offset = view.offset() + pos_accessor.offset();
                let count = pos_accessor.count();

                // Read positions (assuming float32 vec3)
                for i in 0..count {
                    let start = offset + i * 12; // 3 * 4 bytes
                    if start + 12 <= blob.len() {
                        let x = f32::from_le_bytes([
                            blob[start],
                            blob[start + 1],
                            blob[start + 2],
                            blob[start + 3],
                        ]);
                        let y = f32::from_le_bytes([
                            blob[start + 4],
                            blob[start + 5],
                            blob[start + 6],
                            blob[start + 7],
                        ]);
                        let z = f32::from_le_bytes([
                            blob[start + 8],
                            blob[start + 9],
                            blob[start + 10],
                            blob[start + 11],
                        ]);
                        all_vertices.push(Point3::new(x, y, z));
                    }
                }

                // Read indices
                if let Some(idx_accessor) = indices_accessor {
                    let idx_view = idx_accessor.view().ok_or_else(|| {
                        GlbLoaderError::MeshReadError("No buffer view for indices".to_string())
                    })?;

                    let idx_offset = idx_view.offset() + idx_accessor.offset();
                    let idx_count = idx_accessor.count();

                    // Read all indices first, then group into triangles
                    let mut raw_indices: Vec<u32> = Vec::with_capacity(idx_count);

                    match idx_accessor.data_type() {
                        gltf::accessor::DataType::U16 => {
                            for i in 0..idx_count {
                                let start = idx_offset + i * 2;
                                if start + 2 <= blob.len() {
                                    let idx = u16::from_le_bytes([blob[start], blob[start + 1]]) as u32;
                                    raw_indices.push(idx);
                                }
                            }
                        }
                        gltf::accessor::DataType::U32 => {
                            for i in 0..idx_count {
                                let start = idx_offset + i * 4;
                                if start + 4 <= blob.len() {
                                    let idx = u32::from_le_bytes([
                                        blob[start],
                                        blob[start + 1],
                                        blob[start + 2],
                                        blob[start + 3],
                                    ]);
                                    raw_indices.push(idx);
                                }
                            }
                        }
                        _ => {
                            warn!("Unsupported index type for mesh {}", mesh_name);
                        }
                    }

                    // Group indices into triangles
                    for chunk in raw_indices.chunks(3) {
                        if chunk.len() == 3 {
                            all_indices.push([
                                vertex_offset + chunk[0],
                                vertex_offset + chunk[1],
                                vertex_offset + chunk[2],
                            ]);
                        }
                    }
                }

                vertex_offset = all_vertices.len() as u32;
            }
        }

        if !all_vertices.is_empty() && !all_indices.is_empty() {
            let tri_mesh = TriangleMesh {
                vertices: all_vertices,
                indices: all_indices,
                normals: None,
            };
            debug!(
                "Loaded mesh index {}: {} vertices, {} triangles",
                mesh_index,
                tri_mesh.vertices.len(),
                tri_mesh.indices.len()
            );
            mesh_data.insert(mesh_index, tri_mesh);
        }
    }

    // Now iterate over NODES and map node names to meshes
    // This is critical: node names match the assembly tree, not mesh names
    let mut meshes: HashMap<String, TriangleMesh> = HashMap::new();

    for node in gltf.nodes() {
        let node_name = node.name().unwrap_or("Unnamed").to_string();

        if let Some(mesh) = node.mesh() {
            let mesh_index = mesh.index();
            if let Some(tri_mesh) = mesh_data.get(&mesh_index) {
                debug!("Mapping node '{}' to mesh index {}", node_name, mesh_index);
                meshes.insert(node_name.clone(), tri_mesh.clone());
            }
        }
    }

    // Also add mesh names as fallback (in case node names don't match)
    for mesh in gltf.meshes() {
        let mesh_name = mesh.name().unwrap_or("Unnamed").to_string();
        let mesh_index = mesh.index();
        if !meshes.contains_key(&mesh_name) {
            if let Some(tri_mesh) = mesh_data.get(&mesh_index) {
                debug!("Adding mesh name '{}' as fallback", mesh_name);
                meshes.insert(mesh_name, tri_mesh.clone());
            }
        }
    }

    if meshes.is_empty() {
        return Err(GlbLoaderError::NoMeshes);
    }

    info!("Loaded {} meshes from GLB (via nodes)", meshes.len());

    // Log all available mesh names for debugging
    let names: Vec<&str> = meshes.keys().map(|s| s.as_str()).collect();
    info!("Available mesh names: {:?}", names);

    Ok(meshes)
}

/// Attach meshes from GLB to assembly tree nodes.
///
/// Matches meshes to nodes by name (case-insensitive).
/// Modifies the assembly tree in place.
pub fn attach_meshes_to_assembly(
    node: &mut AssemblyNode,
    meshes: &HashMap<String, TriangleMesh>,
) -> usize {
    let mut attached_count = 0;

    // Try to find a matching mesh for this node
    if node.is_part() && node.mesh.is_none() {
        info!(
            "Looking for mesh for part: name='{}', original_name='{}'",
            node.name, node.original_name
        );

        // Try exact match on name first
        if let Some(mesh) = meshes.get(&node.name) {
            node.mesh = Some(mesh.clone());
            attached_count += 1;
            info!("✓ Attached mesh to part '{}' (exact name match)", node.name);
        }
        // Try original name
        else if let Some(mesh) = meshes.get(&node.original_name) {
            node.mesh = Some(mesh.clone());
            attached_count += 1;
            info!(
                "✓ Attached mesh to part '{}' via original_name '{}'",
                node.name, node.original_name
            );
        }
        // Try case-insensitive match on name
        else {
            let name_lower = node.name.to_lowercase();
            let original_lower = node.original_name.to_lowercase();
            let mut found = false;

            for (mesh_name, mesh) in meshes {
                let mesh_lower = mesh_name.to_lowercase();
                if mesh_lower == name_lower || mesh_lower == original_lower {
                    node.mesh = Some(mesh.clone());
                    attached_count += 1;
                    info!(
                        "✓ Attached mesh to part '{}' (case-insensitive match with '{}')",
                        node.name, mesh_name
                    );
                    found = true;
                    break;
                }
            }

            // Try partial/contains match as last resort
            if !found {
                for (mesh_name, mesh) in meshes {
                    let mesh_lower = mesh_name.to_lowercase();
                    if mesh_lower.contains(&name_lower) || name_lower.contains(&mesh_lower) ||
                       mesh_lower.contains(&original_lower) || original_lower.contains(&mesh_lower) {
                        node.mesh = Some(mesh.clone());
                        attached_count += 1;
                        info!(
                            "✓ Attached mesh to part '{}' (partial match with '{}')",
                            node.name, mesh_name
                        );
                        found = true;
                        break;
                    }
                }
            }

            if !found {
                warn!(
                    "✗ No mesh found for part '{}' (original: '{}')",
                    node.name, node.original_name
                );
            }
        }
    }

    // Recursively process children
    for child in &mut node.children {
        attached_count += attach_meshes_to_assembly(child, meshes);
    }

    attached_count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_glb() {
        let result = load_meshes_from_glb(&[]);
        assert!(result.is_err());
    }
}
