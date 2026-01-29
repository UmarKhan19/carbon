//! Application state management.

use cad_parser::ParseConfig;
use cad_simulator::SimulatorConfig;
use std::sync::RwLock;
use uuid::Uuid;

/// Shared application state.
pub struct AppState {
    /// Parser configuration.
    pub parse_config: ParseConfig,
    /// Simulator configuration.
    pub simulator_config: SimulatorConfig,
    /// Job ID counter (for tracking async jobs).
    job_counter: RwLock<u64>,
}

impl AppState {
    /// Create new application state with default configurations.
    pub fn new() -> Self {
        Self {
            parse_config: ParseConfig::default(),
            simulator_config: SimulatorConfig::default(),
            job_counter: RwLock::new(0),
        }
    }

    /// Generate a new job ID.
    pub fn new_job_id(&self) -> String {
        let mut counter = self.job_counter.write().unwrap();
        *counter += 1;
        format!("job-{}-{}", *counter, Uuid::new_v4())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
