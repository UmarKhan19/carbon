//! WASM module for client-side CAD operations.
//!
//! Provides:
//! - Transform interpolation for animations
//! - Exploded view calculations
//! - Basic collision detection for UI feedback

pub mod animation;
pub mod exploded;

use wasm_bindgen::prelude::*;

/// Initialize the WASM module.
#[wasm_bindgen(start)]
pub fn init() {
    // Set panic hook for better error messages in browser console
    #[cfg(feature = "panic_hook")]
    console_error_panic_hook::set_once();
}

/// Get the version of the WASM module.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
