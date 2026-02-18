/**
 * Full TRS (Translation + Rotation + Scale) animation engine.
 * Replaces the WASM module (cad-wasm) and the offset-only xeokit animation.
 *
 * Key improvement over xeokit: the simulator produces 4x4 matrix keyframes
 * with rotation data. xeokit could only apply entity.offset (translation).
 * Three.js enables full position + quaternion decomposition from the matrix.
 */

import * as THREE from "three";
import type { LoadedModel } from "./GLBLoader";

interface MatrixKeyframe {
  time: number; // 0.0 - 1.0
  transform: number[]; // 16-element column-major 4x4 matrix
}

interface DecomposedKeyframe {
  time: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

/**
 * Decompose a column-major 4x4 matrix into position, quaternion, scale.
 */
function decomposeMatrix(transform: number[]): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
} {
  const mat = new THREE.Matrix4();
  // Three.js Matrix4.fromArray expects column-major (same as our format)
  mat.fromArray(transform);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mat.decompose(position, quaternion, scale);

  return { position, quaternion, scale };
}

/**
 * Pre-decompose all keyframes for a step's animation.
 */
function decomposeKeyframes(keyframes: MatrixKeyframe[]): DecomposedKeyframe[] {
  return keyframes.map((kf) => {
    const { position, quaternion, scale } = decomposeMatrix(kf.transform);
    return { time: kf.time, position, quaternion, scale };
  });
}

/**
 * Interpolate between decomposed keyframes at normalized time t.
 */
function interpolateKeyframes(
  keyframes: DecomposedKeyframe[],
  t: number
): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
} {
  const clamped = Math.max(0, Math.min(1, t));

  if (keyframes.length === 0) {
    return {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1)
    };
  }

  if (keyframes.length === 1 || clamped <= keyframes[0].time) {
    const kf = keyframes[0];
    return {
      position: kf.position.clone(),
      quaternion: kf.quaternion.clone(),
      scale: kf.scale.clone()
    };
  }

  const last = keyframes[keyframes.length - 1];
  if (clamped >= last.time) {
    return {
      position: last.position.clone(),
      quaternion: last.quaternion.clone(),
      scale: last.scale.clone()
    };
  }

  // Find the two surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (clamped >= a.time && clamped <= b.time) {
      const span = Math.max(b.time - a.time, 1e-6);
      const localT = (clamped - a.time) / span;

      return {
        position: new THREE.Vector3().lerpVectors(
          a.position,
          b.position,
          localT
        ),
        quaternion: new THREE.Quaternion().slerpQuaternions(
          a.quaternion,
          b.quaternion,
          localT
        ),
        scale: new THREE.Vector3().lerpVectors(a.scale, b.scale, localT)
      };
    }
  }

  return {
    position: last.position.clone(),
    quaternion: last.quaternion.clone(),
    scale: last.scale.clone()
  };
}

export interface StepAnimationData {
  partId: string;
  keyframes: DecomposedKeyframe[];
  /** The rest (final assembly) transform for this part. */
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
  restScale: THREE.Vector3;
}

export class AnimationEngine {
  private model: LoadedModel | null = null;
  private currentAnimations: StepAnimationData[] = [];

  setModel(model: LoadedModel) {
    this.model = model;
  }

  /**
   * Prepare animation data for a step.
   * Decomposes the 4x4 matrix keyframes into TRS components.
   */
  prepareStepAnimation(
    partIds: string[],
    keyframesByPart: Map<string, MatrixKeyframe[]>
  ): StepAnimationData[] {
    const animations: StepAnimationData[] = [];

    for (const partId of partIds) {
      const matKeyframes = keyframesByPart.get(partId) ?? [];
      const decomposed = decomposeKeyframes(matKeyframes);

      // The rest transform is the last keyframe (t=1.0, part at assembly position)
      const lastKf =
        decomposed.length > 0
          ? decomposed[decomposed.length - 1]
          : {
              position: new THREE.Vector3(),
              quaternion: new THREE.Quaternion(),
              scale: new THREE.Vector3(1, 1, 1)
            };

      animations.push({
        partId,
        keyframes: decomposed,
        restPosition: lastKf.position.clone(),
        restQuaternion: lastKf.quaternion.clone(),
        restScale: lastKf.scale.clone()
      });
    }

    this.currentAnimations = animations;
    return animations;
  }

  /**
   * Apply animation at normalized time t (0-1) for the current step.
   * This is called from the RAF loop — no React state changes.
   */
  applyAtTime(t: number) {
    if (!this.model) return;

    for (const anim of this.currentAnimations) {
      const obj = this.model.parts.get(anim.partId);
      if (!obj) continue;

      const { position, quaternion, scale } = interpolateKeyframes(
        anim.keyframes,
        t
      );
      obj.position.copy(position);
      obj.quaternion.copy(quaternion);
      obj.scale.copy(scale);
    }
  }

  /**
   * Snap all animated parts to their rest (assembly) position.
   */
  snapToRest() {
    if (!this.model) return;
    for (const anim of this.currentAnimations) {
      const obj = this.model.parts.get(anim.partId);
      if (!obj) continue;
      obj.position.copy(anim.restPosition);
      obj.quaternion.copy(anim.restQuaternion);
      obj.scale.copy(anim.restScale);
    }
  }

  /**
   * Reset all parts to their original loaded transforms.
   */
  resetAll(partIds: string[]) {
    if (!this.model) return;
    for (const partId of partIds) {
      const obj = this.model.parts.get(partId);
      if (!obj) continue;
      // Reset to identity-ish (position from original load)
      // The actual rest transforms come from the GLB node transforms
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.scale.set(1, 1, 1);
    }
  }
}
