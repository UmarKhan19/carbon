//! Gravitational stability checking for assemblies.

use nalgebra::{Isometry3, Point3, Vector3};
use rapier3d::prelude::*;
use std::collections::HashMap;

/// Configuration for stability simulation.
#[derive(Debug, Clone)]
pub struct StabilityConfig {
    /// Gravity vector.
    pub gravity: Vector3<f32>,
    /// Maximum displacement allowed for stability (model units).
    pub max_displacement: f32,
    /// Number of physics steps to simulate.
    pub simulation_steps: u32,
    /// Time step for physics simulation.
    pub dt: f32,
}

impl Default for StabilityConfig {
    fn default() -> Self {
        Self {
            gravity: Vector3::new(0.0, -9.81, 0.0),
            max_displacement: 0.1,
            simulation_steps: 100,
            dt: 1.0 / 60.0,
        }
    }
}

/// Result of a stability check.
#[derive(Debug, Clone)]
pub struct StabilityResult {
    /// Whether the configuration is stable.
    pub is_stable: bool,
    /// Maximum displacement observed.
    pub max_displacement: f32,
    /// Parts that moved significantly.
    pub unstable_parts: Vec<String>,
}

/// Check if an assembly configuration is gravitationally stable.
pub fn check_stability(
    parts: &[(String, ColliderBuilder, Isometry3<f32>)],
    config: &StabilityConfig,
) -> StabilityResult {
    let mut physics_pipeline = PhysicsPipeline::new();
    let mut island_manager = IslandManager::new();
    let mut broad_phase = DefaultBroadPhase::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut impulse_joint_set = ImpulseJointSet::new();
    let mut multibody_joint_set = MultibodyJointSet::new();
    let mut ccd_solver = CCDSolver::new();
    let mut query_pipeline = QueryPipeline::new();

    let gravity = config.gravity;
    let integration_parameters = IntegrationParameters::default();

    let mut rigid_body_set = RigidBodySet::new();
    let mut collider_set = ColliderSet::new();

    // Track initial positions
    let mut initial_positions: HashMap<String, Point3<f32>> = HashMap::new();

    // Create rigid bodies and colliders for each part
    for (part_id, collider_builder, transform) in parts {
        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(transform.translation.vector)
            .rotation(transform.rotation.scaled_axis())
            .build();

        let body_handle = rigid_body_set.insert(rigid_body);
        let collider = collider_builder.clone().build();
        collider_set.insert_with_parent(collider, body_handle, &mut rigid_body_set);

        initial_positions.insert(part_id.clone(), transform.translation.vector.into());
    }

    // Create a ground plane for reference
    let ground_collider = ColliderBuilder::halfspace(Vector3::y_axis()).build();
    collider_set.insert(ground_collider);

    // Run physics simulation
    for _ in 0..config.simulation_steps {
        physics_pipeline.step(
            &gravity,
            &integration_parameters,
            &mut island_manager,
            &mut broad_phase,
            &mut narrow_phase,
            &mut rigid_body_set,
            &mut collider_set,
            &mut impulse_joint_set,
            &mut multibody_joint_set,
            &mut ccd_solver,
            Some(&mut query_pipeline),
            &(),
            &(),
        );
    }

    // Check displacement of each part
    let mut max_displacement = 0.0f32;
    let mut unstable_parts = Vec::new();

    for (i, (part_id, _, _)) in parts.iter().enumerate() {
        if let Some(body_handle) = rigid_body_set.get_mut(RigidBodyHandle::from_raw_parts(i as u32, 0)) {
            let current_pos: Point3<f32> = (*body_handle.translation()).into();
            if let Some(initial_pos) = initial_positions.get(part_id) {
                let displacement = (current_pos - initial_pos).norm();
                max_displacement = max_displacement.max(displacement);

                if displacement > config.max_displacement {
                    unstable_parts.push(part_id.clone());
                }
            }
        }
    }

    StabilityResult {
        is_stable: unstable_parts.is_empty(),
        max_displacement,
        unstable_parts,
    }
}
