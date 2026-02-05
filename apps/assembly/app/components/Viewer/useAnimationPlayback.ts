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

export interface UseAnimationPlaybackOptions {
  /** xeokit Viewer instance (null until ready). */
  viewer: Viewer | null;
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

/** Safely get a xeokit entity with offset/visible support. */
function getEntity(viewer: Viewer | null, partId: string): XeokitEntity | null {
  if (!viewer) return null;
  return (viewer.scene.objects[partId] as unknown as XeokitEntity) ?? null;
}

export function useAnimationPlayback({
  viewer,
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
        if (partKfs && partKfs.length >= 2) {
          const start = partKfs[0];
          const end = partKfs[partKfs.length - 1];
          entity.offset = [
            start.position.x * (1 - t) + end.position.x * t,
            start.position.y * (1 - t) + end.position.y * t,
            start.position.z * (1 - t) + end.position.z * t
          ];
        } else if (partKfs && partKfs.length === 1) {
          // Single keyframe → just use its offset scaled by (1-t)
          entity.offset = [
            partKfs[0].position.x * (1 - t),
            partKfs[0].position.y * (1 - t),
            partKfs[0].position.z * (1 - t)
          ];
        } else {
          entity.offset = [0, 0, 0];
        }
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
        Math.abs(progress - (rafRef.current ? 0 : 1)) > 0.05 ||
        progress >= 1
      ) {
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

    playingStepRef.current = selectedStepIndex;
    startTimeRef.current = 0;

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
        const partKf = kfs?.find((kf) => kf.partId === partId);
        if (partKf) {
          entity.offset = [
            partKf.position.x,
            partKf.position.y,
            partKf.position.z
          ];
        }
      }
    }

    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [viewer, steps, selectedStepIndex, collectPartIds, tick]);

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
    if (!isPlaying && viewer) {
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
