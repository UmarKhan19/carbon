//! CAD Server - HTTP API for assembly simulation.

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod glb_loader;
mod handlers;
mod state;

use state::AppState;

#[tokio::main]
async fn main() {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("Failed to set tracing subscriber");

    info!("[cad-server] Carbon CAD Server (Rust) v{}", env!("CARGO_PKG_VERSION"));
    info!("[cad-server] parry3d + truck-stepio + gltf");

    // Create application state
    let state = Arc::new(AppState::new());

    // Build router
    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/parse", post(handlers::parse_step))
        .route("/simulate", post(handlers::run_simulation))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(256 * 1024 * 1024)); // 256 MB

    // Start server
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse::<u16>()
        .expect("Invalid PORT");

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[cad-server] Starting server on port {}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| {
        eprintln!("[cad-server] Failed to bind to port {}: {}", port, e);
        eprintln!("[cad-server] Is another service already running on this port?");
        eprintln!("[cad-server] Set PORT env var to use a different port (default: 8081)");
        std::process::exit(1);
    });

    info!("[cad-server] Listening on {}", addr);
    axum::serve(listener, app).await.unwrap();
}
