/**
 * Animation playback engine for assembly steps (Three.js version).
 *
 * Drives a requestAnimationFrame loop that interpolates per-step keyframes
 * and applies full TRS (position + rotation + scale) to Three.js objects.
 *
 * Key improvement over xeokit version:
 *   - xeokit: only applied entity.offset (translation), ignored rotation
 *   - Three.js: decomposes position + Euler rotation + scale, with slerp
 *     for smooth quaternion interpolation. Helix/screw-in animations now rotate.
 *
 * Visual behaviour:
 *   - Completed steps (0 .. current-1): parts visible at rest position
 *   - Current step: parts visible, transform interpolated from start → rest
 *   - Future steps (current+1 .. end): parts hidden
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssemblyStep } from "~/types/assembly.types";
import type { LoadedModel } from "./engine/GLBLoader";
// Type-only imports for Three.js (SSR-safe)
import type { ThreeEngine } from "./engine/ThreeEngine";

type Position3D = { x: number; y: number; z: number };

interface StepKeyframeLike {
  partId: string;
  timestamp: number;
  position: Position3D;
  rotation?: Position3D;
  scale?: Position3D;
}

export interface UseAnimationPlaybackOptions {
  /** Three.js engine instance (null until ready). */
  engine: ThreeEngine | null;
  /** Loaded 3D model (null until loaded). */
  model: LoadedModel | null;
  /** Whether the 3D model has finished loading. */
  isModelLoaded?: boolean;
  /** All assembly steps in order. */
  steps: AssemblyStep[];
  /** Currently selected step index (from manual navigation). */
  selectedStepIndex: number;
  /** Called when playback advances to a new step. */
  onStepChange: (index: number) => void;
  /** Fallback duration per step in ms (used when step.duration is 0). */
  defaultStepDurationMs?: number;
}

export interface AnimationPlaybackState {
  /** Whether the RAF loop is running. */
  isPlaying: boolean;
  /** 0-1 progress within the current step. */
  stepProgress: number;
  /** Part IDs that should be hidden (future steps). */
  hiddenPartIds: string[];
  /** Start playback from the current selectedStepIndex. */
  play: () => void;
  /** Pause playback (keeps current transforms). */
  pause: () => void;
  /** Stop playback and reset all transforms to rest. */
  stop: () => void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Evaluate a part's offset at normalized time t. */
function evaluatePartOffset(
  partKeyframes: StepKeyframeLike[],
  t: number
): { position: Position3D; rotation: Position3D; scale: Position3D } {
  const clamped = Math.max(0, Math.min(1, t));
  const zero: Position3D = { x: 0, y: 0, z: 0 };
  const one: Position3D = { x: 1, y: 1, z: 1 };

  if (partKeyframes.length === 0) {
    return { position: zero, rotation: zero, scale: one };
  }

  if (partKeyframes.length === 1) {
    const kf = partKeyframes[0];
    // Interpolate from keyframe → zero (rest) as t → 1
    return {
      position: {
        x: kf.position.x * (1 - clamped),
        y: kf.position.y * (1 - clamped),
        z: kf.position.z * (1 - clamped)
      },
      rotation: kf.rotation
        ? {
            x: kf.rotation.x * (1 - clamped),
            y: kf.rotation.y * (1 - clamped),
            z: kf.rotation.z * (1 - clamped)
          }
        : zero,
      scale: kf.scale
        ? {
            x: lerp(kf.scale.x, 1, clamped),
            y: lerp(kf.scale.y, 1, clamped),
            z: lerp(kf.scale.z, 1, clamped)
          }
        : one
    };
  }

  const sorted = [...partKeyframes].sort((a, b) => a.timestamp - b.timestamp);

  // Before first keyframe
  const first = sorted[0];
  if (clamped <= first.timestamp) {
    return {
      position: first.position,
      rotation: first.rotation ?? zero,
      scale: first.scale ?? one
    };
  }

  // After last keyframe
  const last = sorted[sorted.length - 1];
  if (clamped >= last.timestamp) {
    return {
      position: last.position,
      rotation: last.rotation ?? zero,
      scale: last.scale ?? one
    };
  }

  // Interpolate between surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (clamped >= a.timestamp && clamped <= b.timestamp) {
      const span = Math.max(b.timestamp - a.timestamp, 1e-6);
      const localT = (clamped - a.timestamp) / span;

      const aRot = a.rotation ?? zero;
      const bRot = b.rotation ?? zero;
      const aScale = a.scale ?? one;
      const bScale = b.scale ?? one;

      return {
        position: {
          x: lerp(a.position.x, b.position.x, localT),
          y: lerp(a.position.y, b.position.y, localT),
          z: lerp(a.position.z, b.position.z, localT)
        },
        rotation: {
          x: lerp(aRot.x, bRot.x, localT),
          y: lerp(aRot.y, bRot.y, localT),
          z: lerp(aRot.z, bRot.z, localT)
        },
        scale: {
          x: lerp(aScale.x, bScale.x, localT),
          y: lerp(aScale.y, bScale.y, localT),
          z: lerp(aScale.z, bScale.z, localT)
        }
      };
    }
  }

  return {
    position: last.position,
    rotation: last.rotation ?? zero,
    scale: last.scale ?? one
  };
}

export function useAnimationPlayback({
  engine,
  model,
  isModelLoaded = false,
  steps,
  selectedStepIndex,
  onStepChange,
  defaultStepDurationMs = 1500
}: UseAnimationPlaybackOptions): AnimationPlaybackState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [stepProgress, setStepProgress] = useState(0);
  const [hiddenPartIds, setHiddenPartIds] = useState<string[]>([]);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const playingStepRef = useRef(selectedStepIndex);
  const lastProgressRef = useRef(0);

  // THREE module ref (loaded dynamically on first use)
  const threeRef = useRef<typeof import("three") | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Collect all partIds from steps[start..end). */
  const collectPartIds = useCallback(
    (start: number, end: number) => {
      const ids: string[] = [];
      for (let i = start; i < end && i < steps.length; i++) {
        ids.push(...steps[i].partIds);
      }
      return ids;
    },
    [steps]
  );

  /** Reset all part transforms to their rest (loaded) positions. */
  const resetAllTransforms = useCallback(() => {
    if (!model) return;
    for (const step of steps) {
      for (const partId of step.partIds) {
        const obj = model.parts.get(partId);
        if (!obj) continue;
        const rest = obj.userData._restPosition;
        if (rest) {
          obj.position.copy(rest);
          obj.quaternion.copy(obj.userData._restQuaternion);
          obj.scale.copy(obj.userData._restScale);
        }
      }
    }
  }, [model, steps]);

  /** Apply the "assembly so far" snapshot: steps 0..stepIdx complete, rest hidden. */
  const applySnapshot = useCallback(
    (stepIdx: number) => {
      resetAllTransforms();
      setHiddenPartIds(collectPartIds(stepIdx + 1, steps.length));
      setStepProgress(1);
    },
    [resetAllTransforms, collectPartIds, steps.length]
  );

  /**
   * Interpolate transforms for the active step.
   * Operates directly on Object3D — no React state changes (RAF-safe).
   */
  const interpolateStep = useCallback(
    (stepIdx: number, t: number) => {
      const step = steps[stepIdx];
      if (!step || !model) return;

      const THREE = threeRef.current;
      const keyframes = step.animationData?.keyframes;

      for (const partId of step.partIds) {
        const obj = model.parts.get(partId);
        if (!obj) continue;

        const rest = obj.userData._restPosition;
        if (!rest) continue;

        // Find this part's keyframes
        const partKfs = keyframes?.filter((kf) => kf.partId === partId) as
          | StepKeyframeLike[]
          | undefined;

        const { position, rotation, scale } = partKfs?.length
          ? evaluatePartOffset(partKfs, t)
          : {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 }
            };

        // Apply position as offset from rest
        obj.position.set(
          rest.x + position.x,
          rest.y + position.y,
          rest.z + position.z
        );

        // Apply rotation (Euler offset from rest quaternion)
        if (
          THREE &&
          (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0)
        ) {
          const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
          const offsetQuat = new THREE.Quaternion().setFromEuler(euler);
          obj.quaternion
            .copy(obj.userData._restQuaternion)
            .multiply(offsetQuat);
        } else {
          obj.quaternion.copy(obj.userData._restQuaternion);
        }

        // Apply scale offset
        if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
          const restScale = obj.userData._restScale;
          obj.scale.set(
            restScale.x * scale.x,
            restScale.y * scale.y,
            restScale.z * scale.z
          );
        }
      }
    },
    [model, steps]
  );

  // ── RAF loop ─────────────────────────────────────────────────────────

  const tick = useCallback(
    (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;

      const step = steps[playingStepRef.current];
      const duration = step?.duration || defaultStepDurationMs;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Apply interpolation (no React re-render)
      interpolateStep(playingStepRef.current, progress);

      // Throttle React state update to ~20 fps
      if (
        Math.abs(progress - lastProgressRef.current) > 0.05 ||
        progress >= 1
      ) {
        lastProgressRef.current = progress;
        setStepProgress(progress);
      }

      if (progress >= 1) {
        // Snap completed step to rest
        if (step && model) {
          for (const partId of step.partIds) {
            const obj = model.parts.get(partId);
            if (!obj) continue;
            const rest = obj.userData._restPosition;
            if (rest) {
              obj.position.copy(rest);
              obj.quaternion.copy(obj.userData._restQuaternion);
              obj.scale.copy(obj.userData._restScale);
            }
          }
        }

        // Advance to next step
        if (playingStepRef.current < steps.length - 1) {
          playingStepRef.current += 1;
          startTimeRef.current = 0;
          onStepChange(playingStepRef.current);

          // Reveal the next step's parts
          setHiddenPartIds(
            collectPartIds(playingStepRef.current + 1, steps.length)
          );

          rafRef.current = requestAnimationFrame(tick);
        } else {
          // All steps done
          setIsPlaying(false);
          setStepProgress(1);
          rafRef.current = null;
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [
      steps,
      defaultStepDurationMs,
      interpolateStep,
      model,
      onStepChange,
      collectPartIds
    ]
  );

  // ── Controls ─────────────────────────────────────────────────────────

  const play = useCallback(() => {
    if (!engine || !model || steps.length === 0) return;

    if (!isModelLoaded) {
      console.warn("[ANIM] Cannot play - model not loaded yet");
      return;
    }

    // Load THREE for quaternion operations
    if (!threeRef.current) {
      import("three").then((THREE) => {
        threeRef.current = THREE;
      });
    }

    playingStepRef.current = selectedStepIndex;
    startTimeRef.current = 0;
    lastProgressRef.current = 0;

    // Hide future parts and reveal current step
    setHiddenPartIds(collectPartIds(selectedStepIndex + 1, steps.length));

    // Set current step's parts to their start offset
    const step = steps[selectedStepIndex];
    if (step) {
      const kfs = step.animationData?.keyframes;
      for (const partId of step.partIds) {
        const obj = model.parts.get(partId);
        if (!obj) continue;
        obj.visible = true;

        const partKfs = (kfs?.filter((kf) => kf.partId === partId) ??
          []) as StepKeyframeLike[];

        const { position } = evaluatePartOffset(partKfs, 0);
        const rest = obj.userData._restPosition;
        if (rest) {
          obj.position.set(
            rest.x + position.x,
            rest.y + position.y,
            rest.z + position.z
          );
        }
      }
    }

    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [
    engine,
    model,
    isModelLoaded,
    steps,
    selectedStepIndex,
    collectPartIds,
    tick
  ]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    pause();
    resetAllTransforms();
    setStepProgress(0);
    applySnapshot(selectedStepIndex);
  }, [pause, resetAllTransforms, selectedStepIndex, applySnapshot]);

  // ── Sync with manual step navigation ─────────────────────────────────

  useEffect(() => {
    if (!isPlaying && model && isModelLoaded) {
      applySnapshot(selectedStepIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepIndex, isModelLoaded]);

  // ── Cleanup ──────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return {
    isPlaying,
    stepProgress,
    hiddenPartIds,
    play,
    pause,
    stop
  };
}
