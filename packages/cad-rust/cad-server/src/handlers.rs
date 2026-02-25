//! HTTP request handlers.

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use cad_common::{AssemblyNode, SimulationResult};
use cad_parser::parse_step_file;
use cad_simulator::AssemblySimulator;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tracing::{error, info, warn};

use crate::glb_loader::{attach_meshes_to_assembly, load_meshes_from_glb};
use crate::state::AppState;

/// Health check response.
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

/// Health check endpoint.
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Parse STEP file response.
#[derive(Serialize)]
pub struct ParseResponse {
    pub success: bool,
    pub assembly_tree: Option<AssemblyNode>,
    pub error: Option<String>,
}

/// Parse a STEP file and extract the assembly tree.
pub async fn parse_step(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<ParseResponse>, StatusCode> {
    let start = Instant::now();
    info!("[parse] Received parse request");

    // Extract file from multipart
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("[parse] Multipart error: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        if field.name() == Some("file") {
            file_name = field.file_name().map(|s| s.to_string());
            file_data = Some(field.bytes().await.map_err(|e| {
                error!("[parse] Failed to read file: {}", e);
                StatusCode::BAD_REQUEST
            })?.to_vec());
        }
    }

    let (file_data, file_name) = match (file_data, file_name) {
        (Some(data), Some(name)) => (data, name),
        _ => {
            return Ok(Json(ParseResponse {
                success: false,
                assembly_tree: None,
                error: Some("No file provided".to_string()),
            }));
        }
    };

    let file_size = file_data.len();
    info!("[parse] Parsing STEP file: {} ({} bytes)", file_name, file_size);

    // Write to temp file
    let temp_path = std::env::temp_dir().join(&file_name);
    if let Err(e) = std::fs::write(&temp_path, &file_data) {
        error!("[parse] Failed to write temp file: {}", e);
        return Ok(Json(ParseResponse {
            success: false,
            assembly_tree: None,
            error: Some(format!("Failed to write temp file: {}", e)),
        }));
    }

    info!("[parse] Temp file written, starting truck-stepio parse...");
    let parse_start = Instant::now();

    // Parse the file
    match parse_step_file(&temp_path, &state.parse_config) {
        Ok(tree) => {
            let parse_ms = parse_start.elapsed().as_millis();
            let total_ms = start.elapsed().as_millis();

            // Clean up temp file
            let _ = std::fs::remove_file(&temp_path);

            // Count parts in tree
            fn count_parts(node: &AssemblyNode) -> usize {
                let self_count = if node.is_part() { 1 } else { 0 };
                self_count + node.children.iter().map(count_parts).sum::<usize>()
            }
            let part_count = count_parts(&tree);

            info!(
                "[parse] Parse complete: {} parts, parse={}ms, total={}ms",
                part_count, parse_ms, total_ms
            );
            Ok(Json(ParseResponse {
                success: true,
                assembly_tree: Some(tree),
                error: None,
            }))
        }
        Err(e) => {
            let total_ms = start.elapsed().as_millis();
            // Clean up temp file
            let _ = std::fs::remove_file(&temp_path);

            error!("[parse] Parse failed after {}ms: {}", total_ms, e);
            Ok(Json(ParseResponse {
                success: false,
                assembly_tree: None,
                error: Some(e.to_string()),
            }))
        }
    }
}

/// Simulation request body.
#[derive(Deserialize)]
pub struct SimulateRequest {
    /// The assembly tree hierarchy.
    pub assembly_tree: AssemblyNode,
    /// GLB file data as base64 (required for collision detection).
    pub glb_base64: Option<String>,
    /// Optional timeout in milliseconds (default: 300000 = 5 minutes).
    pub timeout_ms: Option<u64>,
}

/// Simulation response.
#[derive(Serialize)]
pub struct SimulateResponse {
    pub success: bool,
    pub result: Option<SimulationResult>,
    pub error: Option<String>,
}

/// Run assembly sequence simulation.
///
/// Requires both assembly_tree (hierarchy) and glb_base64 (mesh data).
/// The GLB is parsed to extract meshes which are matched to parts by name.
///
/// The simulation runs on `spawn_blocking` because collision detection is
/// CPU-intensive and would block the tokio async runtime, starving other
/// requests (health checks, concurrent parses, etc.).
pub async fn run_simulation(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SimulateRequest>,
) -> Json<SimulateResponse> {
    let start = Instant::now();
    info!("[simulate] Received simulation request");

    // Clone the assembly tree so we can modify it
    let mut assembly_tree = request.assembly_tree;

    // Load meshes from GLB if provided
    if let Some(glb_base64) = &request.glb_base64 {
        let b64_len = glb_base64.len();
        info!("[simulate] Decoding GLB data ({} chars base64)", b64_len);

        let decode_start = Instant::now();
        // Decode base64
        let glb_data = match BASE64.decode(glb_base64) {
            Ok(data) => data,
            Err(e) => {
                error!("[simulate] Failed to decode GLB base64: {}", e);
                return Json(SimulateResponse {
                    success: false,
                    result: None,
                    error: Some(format!("Invalid GLB base64: {}", e)),
                });
            }
        };
        let decode_ms = decode_start.elapsed().as_millis();
        let glb_size_kb = glb_data.len() / 1024;
        info!("[simulate] GLB decoded: {}KB, {}ms", glb_size_kb, decode_ms);

        // Load meshes from GLB
        let load_start = Instant::now();
        info!("[simulate] Loading meshes from GLB...");
        let meshes = match load_meshes_from_glb(&glb_data) {
            Ok(m) => m,
            Err(e) => {
                error!("[simulate] Failed to load meshes from GLB: {}", e);
                return Json(SimulateResponse {
                    success: false,
                    result: None,
                    error: Some(format!("Failed to load GLB: {}", e)),
                });
            }
        };
        let load_ms = load_start.elapsed().as_millis();
        info!("[simulate] {} meshes loaded from GLB, {}ms", meshes.len(), load_ms);

        // Attach meshes to assembly tree
        let attach_start = Instant::now();
        let attached = attach_meshes_to_assembly(&mut assembly_tree, &meshes);
        let attach_ms = attach_start.elapsed().as_millis();
        info!("[simulate] Attached {}/{} meshes to assembly tree, {}ms", attached, meshes.len(), attach_ms);

        if attached == 0 {
            warn!("[simulate] No meshes were attached - check that part names match mesh names");
        }
    } else {
        warn!("[simulate] No GLB data provided - simulation may fail if meshes are not pre-loaded");
    }

    let mut simulator_config = state.simulator_config.clone();
    if let Some(timeout) = request.timeout_ms {
        simulator_config.timeout_ms = timeout;
    }

    let prep_ms = start.elapsed().as_millis();
    info!("[simulate] Preparation complete ({}ms), starting simulation on blocking thread...", prep_ms);

    // Run the CPU-intensive simulation on spawn_blocking so we don't
    // block the tokio runtime and starve other async tasks.
    let sim_result = tokio::task::spawn_blocking(move || {
        let sim_start = Instant::now();
        let mut simulator = AssemblySimulator::new(simulator_config);

        if let Err(e) = simulator.load_assembly(&assembly_tree) {
            error!("[simulate] Failed to load assembly: {}", e);
            return SimulateResponse {
                success: false,
                result: None,
                error: Some(e.to_string()),
            };
        }

        info!("[simulate] Assembly loaded, computing disassembly sequence...");

        match simulator.compute_sequence() {
            Ok(result) => {
                let sim_ms = sim_start.elapsed().as_millis();
                info!(
                    "[simulate] Simulation complete: {} steps, {} stuck, success={}, {}ms",
                    result.steps.len(),
                    result.stuck_parts.len(),
                    result.success,
                    sim_ms
                );
                SimulateResponse {
                    success: true,
                    result: Some(result),
                    error: None,
                }
            }
            Err(e) => {
                let sim_ms = sim_start.elapsed().as_millis();
                error!("[simulate] Simulation failed after {}ms: {}", sim_ms, e);
                SimulateResponse {
                    success: false,
                    result: None,
                    error: Some(e.to_string()),
                }
            }
        }
    })
    .await
    .unwrap_or_else(|e| {
        error!("[simulate] Simulation task panicked: {}", e);
        SimulateResponse {
            success: false,
            result: None,
            error: Some(format!("Simulation task panicked: {}", e)),
        }
    });

    let total_ms = start.elapsed().as_millis();
    if sim_result.success {
        if let Some(ref result) = sim_result.result {
            info!(
                "[simulate] Request complete: {} steps, {} stuck, {}ms total",
                result.steps.len(),
                result.stuck_parts.len(),
                total_ms
            );
        }
    } else {
        error!("[simulate] Request failed after {}ms", total_ms);
    }

    Json(sim_result)
}
