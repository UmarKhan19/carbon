//! STEP file parser for assembly extraction.
//!
//! This crate provides functionality to:
//! - Parse STEP (ISO 10303) files
//! - Extract assembly hierarchy
//! - Convert B-Rep geometry to triangle meshes

pub mod mesh_converter;
pub mod step_parser;

pub use mesh_converter::*;
pub use step_parser::*;
