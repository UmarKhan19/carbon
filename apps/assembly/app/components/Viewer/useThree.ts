/**
 * React hook for Three.js viewer state management.
 * Drop-in replacement for useXeokit.ts — same public API shape.
 *
 * Stores refs to ThreeEngine, SelectionManager, and LoadedModel.
 * All camera/part operations delegate to the engine modules.
 */

import { useCallback, useRef, useState } from "react";
import type { CameraState, ViewerState } from "~/types/assembly.types";
import type { LoadedModel } from "./engine/GLBLoader";
import type { SelectionManager } from "./engine/SelectionManager";
// Type-only imports (SSR-safe)
import type { ThreeEngine } from "./engine/ThreeEngine";
import type { ThreeContext } from "./ThreeCanvas";

export interface UseThreeOptions {
  onPartSelected?: (partId: string | null, partName: string | null) => void;
}

export function useThree(options: UseThreeOptions = {}) {
  const engineRef = useRef<ThreeEngine | null>(null);
  const selectionRef = useRef<SelectionManager | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>({
    selectedStepId: null,
    highlightedPartIds: [],
    hiddenPartIds: [],
    explodedView: false,
    explodeFactor: 1,
    isPlaying: false,
    playbackProgress: 0,
    viewMode: "edit"
  });

  // ── Event handlers for ThreeCanvas ────────────────────────────────────

  const handleViewerReady = useCallback((ctx: ThreeContext) => {
    engineRef.current = ctx.engine;
    selectionRef.current = ctx.selection;
    setIsReady(true);
    setIsModelLoaded(false);
  }, []);

  const handleModelLoaded = useCallback((model: LoadedModel) => {
    modelRef.current = model;
    setIsModelLoaded(true);
    console.log("[useThree] Model loaded, parts:", model.parts.size);
  }, []);

  const handlePartSelected = useCallback(
    (partId: string | null, partName: string | null) => {
      setSelectedPartId(partId);
      options.onPartSelected?.(partId, partName);
    },
    [options]
  );

  // ── Camera controls ───────────────────────────────────────────────────

  const flyTo = useCallback((viewpoint: CameraState, duration = 0.5) => {
    engineRef.current?.flyToViewpoint(viewpoint, duration * 1000);
  }, []);

  const flyToObject = useCallback((entityId: string, duration = 0.5) => {
    if (!engineRef.current || !modelRef.current) return;
    const obj = modelRef.current.parts.get(entityId);
    if (obj) {
      engineRef.current.flyToObject(obj, duration * 1000);
    }
  }, []);

  const setView = useCallback(
    (
      preset: "front" | "back" | "top" | "bottom" | "left" | "right" | "iso"
    ) => {
      engineRef.current?.setViewPreset(preset);
    },
    []
  );

  const fitToView = useCallback((duration = 0.5) => {
    if (!engineRef.current) return;
    // Compute scene AABB and fly to it
    import("three").then((THREE) => {
      const box = new THREE.Box3().setFromObject(engineRef.current!.scene);
      engineRef.current!.flyToAABB(box, duration * 1000);
    });
  }, []);

  const getCameraState = useCallback((): CameraState | null => {
    return engineRef.current?.getCameraState() ?? null;
  }, []);

  // ── Part visibility ───────────────────────────────────────────────────

  const highlightParts = useCallback((partIds: string[]) => {
    setViewerState((prev) => ({
      ...prev,
      highlightedPartIds: partIds
    }));
  }, []);

  const hideParts = useCallback((partIds: string[]) => {
    setViewerState((prev) => ({
      ...prev,
      hiddenPartIds: partIds
    }));
  }, []);

  const showAllParts = useCallback(() => {
    selectionRef.current?.showAll();
    setViewerState((prev) => ({
      ...prev,
      hiddenPartIds: []
    }));
  }, []);

  const clearHighlights = useCallback(() => {
    selectionRef.current?.clearHighlights();
    setViewerState((prev) => ({
      ...prev,
      highlightedPartIds: []
    }));
  }, []);

  // ── Exploded view ─────────────────────────────────────────────────────

  const setExplodedView = useCallback(
    (enabled: boolean, factor: number = 1.5) => {
      setViewerState((prev) => ({
        ...prev,
        explodedView: enabled,
        explodeFactor: factor
      }));

      if (!modelRef.current || !engineRef.current) return;

      if (enabled) {
        // Compute scene center, push each part outward
        import("three").then((THREE) => {
          const box = new THREE.Box3().setFromObject(engineRef.current!.scene);
          const center = new THREE.Vector3();
          box.getCenter(center);

          modelRef.current!.parts.forEach((obj) => {
            const partCenter = new THREE.Vector3();
            new THREE.Box3().setFromObject(obj).getCenter(partCenter);
            const dir = partCenter.sub(center);
            obj.position.add(dir.multiplyScalar(factor - 1));
          });
        });
      } else {
        // Restore rest positions
        modelRef.current.parts.forEach((obj) => {
          const rest = obj.userData._restPosition;
          if (rest) obj.position.copy(rest);
        });
      }
    },
    []
  );

  // ── Step navigation ───────────────────────────────────────────────────

  const goToStep = useCallback(
    (
      stepId: string,
      partIds: string[],
      cameraState?: CameraState,
      duration = 0.5
    ) => {
      setViewerState((prev) => ({
        ...prev,
        selectedStepId: stepId,
        highlightedPartIds: partIds
      }));

      if (cameraState && engineRef.current) {
        engineRef.current.flyToViewpoint(cameraState, duration * 1000);
      } else if (partIds.length > 0 && engineRef.current && modelRef.current) {
        const obj = modelRef.current.parts.get(partIds[0]);
        if (obj) {
          engineRef.current.flyToObject(obj, duration * 1000);
        }
      }
    },
    []
  );

  // ── Playback state ────────────────────────────────────────────────────

  const play = useCallback(() => {
    setViewerState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    setViewerState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const setPlaybackProgress = useCallback((progress: number) => {
    setViewerState((prev) => ({
      ...prev,
      playbackProgress: Math.max(0, Math.min(1, progress))
    }));
  }, []);

  // ── View mode ─────────────────────────────────────────────────────────

  const setViewMode = useCallback((mode: "edit" | "preview") => {
    setViewerState((prev) => ({ ...prev, viewMode: mode }));
  }, []);

  // ── Screenshot ────────────────────────────────────────────────────────

  const takeScreenshot = useCallback((): string | null => {
    return engineRef.current?.takeScreenshot() ?? null;
  }, []);

  return {
    // Refs
    engine: engineRef.current,
    model: modelRef.current,
    isReady,
    isModelLoaded,
    selectedPartId,
    viewerState,

    // Event handlers for ThreeCanvas
    handleViewerReady,
    handleModelLoaded,
    handlePartSelected,

    // Camera controls
    flyTo,
    flyToObject,
    setView,
    fitToView,
    getCameraState,

    // Part visibility
    highlightParts,
    hideParts,
    showAllParts,
    clearHighlights,

    // Exploded view
    setExplodedView,

    // Step navigation
    goToStep,

    // Playback
    play,
    pause,
    setPlaybackProgress,

    // View mode
    setViewMode,

    // Utils
    takeScreenshot
  };
}
