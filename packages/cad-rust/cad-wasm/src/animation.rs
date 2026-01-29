//! Animation interpolation for smooth assembly playback.

use nalgebra::{Matrix4, Quaternion, UnitQuaternion, Vector3};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A keyframe in an animation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct Keyframe {
    /// Time in the animation (0.0 to 1.0).
    time: f32,
    /// Position (x, y, z).
    position: [f32; 3],
    /// Rotation as quaternion (x, y, z, w).
    rotation: [f32; 4],
    /// Scale (x, y, z).
    scale: [f32; 3],
}

#[wasm_bindgen]
impl Keyframe {
    /// Create a new keyframe.
    #[wasm_bindgen(constructor)]
    pub fn new(time: f32, position: &[f32], rotation: &[f32], scale: &[f32]) -> Keyframe {
        Keyframe {
            time,
            position: [
                position.get(0).copied().unwrap_or(0.0),
                position.get(1).copied().unwrap_or(0.0),
                position.get(2).copied().unwrap_or(0.0),
            ],
            rotation: [
                rotation.get(0).copied().unwrap_or(0.0),
                rotation.get(1).copied().unwrap_or(0.0),
                rotation.get(2).copied().unwrap_or(0.0),
                rotation.get(3).copied().unwrap_or(1.0),
            ],
            scale: [
                scale.get(0).copied().unwrap_or(1.0),
                scale.get(1).copied().unwrap_or(1.0),
                scale.get(2).copied().unwrap_or(1.0),
            ],
        }
    }

    /// Get the time of this keyframe.
    #[wasm_bindgen(getter)]
    pub fn time(&self) -> f32 {
        self.time
    }
}

/// Interpolate between two keyframes.
#[wasm_bindgen]
pub fn interpolate_keyframes(kf1: &Keyframe, kf2: &Keyframe, t: f32) -> Vec<f32> {
    // Clamp t to [0, 1]
    let t = t.clamp(0.0, 1.0);

    // Linear interpolation for position
    let position = [
        lerp(kf1.position[0], kf2.position[0], t),
        lerp(kf1.position[1], kf2.position[1], t),
        lerp(kf1.position[2], kf2.position[2], t),
    ];

    // Spherical interpolation for rotation
    let q1 = Quaternion::new(kf1.rotation[3], kf1.rotation[0], kf1.rotation[1], kf1.rotation[2]);
    let q2 = Quaternion::new(kf2.rotation[3], kf2.rotation[0], kf2.rotation[1], kf2.rotation[2]);
    let q1 = UnitQuaternion::from_quaternion(q1);
    let q2 = UnitQuaternion::from_quaternion(q2);
    let q_interp = q1.slerp(&q2, t);
    let rotation = [
        q_interp.i,
        q_interp.j,
        q_interp.k,
        q_interp.w,
    ];

    // Linear interpolation for scale
    let scale = [
        lerp(kf1.scale[0], kf2.scale[0], t),
        lerp(kf1.scale[1], kf2.scale[1], t),
        lerp(kf1.scale[2], kf2.scale[2], t),
    ];

    // Return as flat array: [px, py, pz, rx, ry, rz, rw, sx, sy, sz]
    vec![
        position[0], position[1], position[2],
        rotation[0], rotation[1], rotation[2], rotation[3],
        scale[0], scale[1], scale[2],
    ]
}

/// Convert position, rotation (quaternion), and scale to a 4x4 matrix.
#[wasm_bindgen]
pub fn to_matrix4(position: &[f32], rotation: &[f32], scale: &[f32]) -> Vec<f32> {
    let p = Vector3::new(
        position.get(0).copied().unwrap_or(0.0),
        position.get(1).copied().unwrap_or(0.0),
        position.get(2).copied().unwrap_or(0.0),
    );

    let q = Quaternion::new(
        rotation.get(3).copied().unwrap_or(1.0),
        rotation.get(0).copied().unwrap_or(0.0),
        rotation.get(1).copied().unwrap_or(0.0),
        rotation.get(2).copied().unwrap_or(0.0),
    );
    let r = UnitQuaternion::from_quaternion(q);

    let s = Vector3::new(
        scale.get(0).copied().unwrap_or(1.0),
        scale.get(1).copied().unwrap_or(1.0),
        scale.get(2).copied().unwrap_or(1.0),
    );

    // Build TRS matrix
    let translation = Matrix4::new_translation(&p);
    let rotation_mat = r.to_homogeneous();
    let scale_mat = Matrix4::new_nonuniform_scaling(&s);

    let result = translation * rotation_mat * scale_mat;

    // Return column-major (WebGL format)
    result.as_slice().to_vec()
}

/// Ease-in-out function for smoother animations.
#[wasm_bindgen]
pub fn ease_in_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}

/// Linear interpolation.
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
