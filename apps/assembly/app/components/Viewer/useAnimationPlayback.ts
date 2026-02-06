/**
 * Animation playback engine for assembly steps.
 *
 * Drives a requestAnimationFrame loop that interpolates per-step keyframes
 * and applies entity offsets in the xeokit viewer.
 *
 * Visual behaviour:
 *   - Completed steps (0 .. current-1): parts visible, offset [0,0,0]
 *   - Current step: parts visible, offset interpolated from start → [0,0,0]
 *   - Future steps (current+1 .. end): parts hidden
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssemblyStep } from "~/types/assembly.types";

type Viewer = import("@xeokit/xeokit-sdk").Viewer;

// xeokit's TS definitions are incomplete — offset and visible exist at runtime
interface XeokitEntity {
  offset: number[];
  visible: boolean;
}

type Offset3 = [number, number, number];

interface StepKeyframeLike {
  partId: string;
  timestamp: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export interface UseAnimationPlaybackOptions {
  /** xeokit Viewer instance (null until ready). */
  viewer: Viewer | null;
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
  /** Pause playback (keeps current offsets). */
  pause: () => void;
  /** Stop playback and reset all offsets to zero. */
  stop: () => void;
}

/**
 * Safely get a xeokit entity with offset/visible support.
 * xeokit entity IDs are UUIDs that match the partIds from the database.
 */
function getEntity(viewer: Viewer | null, partId: string): XeokitEntity | null {
  if (!viewer?.scene?.objects) return null;
  // Direct lookup - partId IS the entity ID (both are UUIDs)
  return (viewer.scene.objects[partId] as unknown as XeokitEntity) ?? null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Evaluate a part's sampled offset curve at normalized time t. */
function evaluatePartOffset(
  partKeyframes: StepKeyframeLike[],
  t: number
): Offset3 {
  const clamped = Math.max(0, Math.min(1, t));
  if (partKeyframes.length === 0) return [0, 0, 0];
  if (partKeyframes.length === 1) {
    const kf = partKeyframes[0];
    return [
      kf.position.x * (1 - clamped),
      kf.position.y * (1 - clamped),
      kf.position.z * (1 - clamped)
    ];
  }

  const sorted = [...partKeyframes].sort((a, b) => a.timestamp - b.timestamp);

  const first = sorted[0];
  if (clamped <= first.timestamp) {
    return [first.position.x, first.position.y, first.position.z];
  }

  const last = sorted[sorted.length - 1];
  if (clamped >= last.timestamp) {
    return [last.position.x, last.position.y, last.position.z];
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (clamped >= a.timestamp && clamped <= b.timestamp) {
      const span = Math.max(b.timestamp - a.timestamp, 1.0e-6);
      const localT = (clamped - a.timestamp) / span;
      return [
        lerp(a.position.x, b.position.x, localT),
        lerp(a.position.y, b.position.y, localT),
        lerp(a.position.z, b.position.z, localT)
      ];
    }
  }

  return [last.position.x, last.position.y, last.position.z];
}

export function useAnimationPlayback({
  viewer,
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

  /** Reset every entity offset to [0,0,0]. */
  const resetAllOffsets = useCallback(() => {
    for (const step of steps) {
      for (const partId of step.partIds) {
        const entity = getEntity(viewer, partId);
        if (entity) entity.offset = [0, 0, 0];
      }
    }
  }, [viewer, steps]);

  /** Apply the "assembly so far" snapshot: steps 0..stepIdx complete, rest hidden. */
  const applySnapshot = useCallback(
    (stepIdx: number) => {
      resetAllOffsets();
      setHiddenPartIds(collectPartIds(stepIdx + 1, steps.length));
      setStepProgress(1);
    },
    [resetAllOffsets, collectPartIds, steps.length]
  );

  /**
   * Interpolate offsets for the active step.
   * Only touches entity.offset (no React state changes) → safe inside RAF.
   */
  const interpolateStep = useCallback(
    (stepIdx: number, t: number) => {
      const step = steps[stepIdx];
      if (!step) return;

      const keyframes = step.animationData?.keyframes;

      for (const partId of step.partIds) {
        const entity = getEntity(viewer, partId);
        if (!entity) continue;

        // Find this part's keyframes (there may be one partId or many)
        const partKfs = keyframes?.filter((kf) => kf.partId === partId);
        const offset = partKfs?.length
          ? evaluatePartOffset(partKfs, t)
          : [0, 0, 0];
        entity.offset = offset;
      }
    },
    [viewer, steps]
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

      // Throttle React state update to ~20 fps to avoid excessive re-renders
      if (
        Math.abs(progress - lastProgressRef.current) > 0.05 ||
        progress >= 1
      ) {
        lastProgressRef.current = progress;
        setStepProgress(progress);
      }

      if (progress >= 1) {
        // Snap completed step's parts to rest
        if (step) {
          for (const partId of step.partIds) {
            const entity = getEntity(viewer, partId);
            if (entity) entity.offset = [0, 0, 0];
          }
        }

        // Advance to next step
        if (playingStepRef.current < steps.length - 1) {
          playingStepRef.current += 1;
          startTimeRef.current = 0; // will be set on next tick
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
      viewer,
      onStepChange,
      collectPartIds
    ]
  );

  // ── Controls ─────────────────────────────────────────────────────────

  const play = useCallback(() => {
    if (!viewer || steps.length === 0) return;

    // Wait for model to load
    if (!isModelLoaded) {
      console.warn("[ANIM] Cannot play - model not loaded yet");
      return;
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
        const entity = getEntity(viewer, partId);
        if (!entity) continue;
        entity.visible = true;
        const partKfs = kfs?.filter((kf) => kf.partId === partId) ?? [];
        entity.offset = evaluatePartOffset(partKfs, 0);
      }
    }

    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [viewer, isModelLoaded, steps, selectedStepIndex, collectPartIds, tick]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    pause();
    resetAllOffsets();
    setStepProgress(0);
    applySnapshot(selectedStepIndex);
  }, [pause, resetAllOffsets, selectedStepIndex, applySnapshot]);

  // ── Sync with manual step navigation ─────────────────────────────────

  useEffect(() => {
    // Only apply snapshot when viewer is ready AND has objects loaded
    if (
      !isPlaying &&
      viewer?.scene?.objects &&
      Object.keys(viewer.scene.objects).length > 0
    ) {
      applySnapshot(selectedStepIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepIndex, viewer]);

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
