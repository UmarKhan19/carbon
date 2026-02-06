import { useCallback, useRef, useState } from "react";

// Type-only import for xeokit Viewer
type Viewer = import("@xeokit/xeokit-sdk").Viewer;

import type { CameraState, ViewerState } from "~/types/assembly.types";
import { flyToEntity, flyToViewpoint, setViewPreset } from "./XeokitCanvas";

export interface UseXeokitOptions {
  onPartSelected?: (partId: string | null, partName: string | null) => void;
}

export function useXeokit(options: UseXeokitOptions = {}) {
  const viewerRef = useRef<Viewer | null>(null);
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

  const handleViewerReady = useCallback((viewer: Viewer) => {
    viewerRef.current = viewer;
    setIsReady(true);
    setIsModelLoaded(false); // Reset model loaded when viewer changes
  }, []);

  const handleModelLoaded = useCallback(() => {
    setIsModelLoaded(true);
    console.log("[useXeokit] Model loaded, entities ready");
  }, []);

  const handlePartSelected = useCallback(
    (partId: string | null, partName: string | null) => {
      setSelectedPartId(partId);
      options.onPartSelected?.(partId, partName);
    },
    [options]
  );

  // Camera controls
  const flyTo = useCallback((viewpoint: CameraState, duration = 0.5) => {
    if (viewerRef.current) {
      flyToViewpoint(viewerRef.current, viewpoint, duration);
    }
  }, []);

  const flyToObject = useCallback((entityId: string, duration = 0.5) => {
    if (viewerRef.current) {
      flyToEntity(viewerRef.current, entityId, duration);
    }
  }, []);

  const setView = useCallback(
    (
      preset: "front" | "back" | "top" | "bottom" | "left" | "right" | "iso"
    ) => {
      if (viewerRef.current) {
        setViewPreset(viewerRef.current, preset);
      }
    },
    []
  );

  const fitToView = useCallback((duration = 0.5) => {
    if (viewerRef.current) {
      viewerRef.current.cameraFlight.flyTo({
        aabb: viewerRef.current.scene.aabb,
        duration
      });
    }
  }, []);

  // Part visibility
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
    setViewerState((prev) => ({
      ...prev,
      hiddenPartIds: []
    }));
  }, []);

  const clearHighlights = useCallback(() => {
    setViewerState((prev) => ({
      ...prev,
      highlightedPartIds: []
    }));
  }, []);

  // Exploded view
  const setExplodedView = useCallback(
    (enabled: boolean, factor: number = 1.5) => {
      if (!viewerRef.current) return;

      setViewerState((prev) => ({
        ...prev,
        explodedView: enabled,
        explodeFactor: factor
      }));

      // Note: xeokit doesn't have built-in exploded view
      // This would need custom implementation to translate parts outward from center
      // For now, this is a placeholder for the state
    },
    []
  );

  // Step navigation
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

      if (cameraState && viewerRef.current) {
        flyToViewpoint(viewerRef.current, cameraState, duration);
      } else if (partIds.length > 0 && viewerRef.current) {
        // Fly to first part in the step
        flyToEntity(viewerRef.current, partIds[0], duration);
      }
    },
    []
  );

  // Playback controls
  const play = useCallback(() => {
    setViewerState((prev) => ({
      ...prev,
      isPlaying: true
    }));
  }, []);

  const pause = useCallback(() => {
    setViewerState((prev) => ({
      ...prev,
      isPlaying: false
    }));
  }, []);

  const setPlaybackProgress = useCallback((progress: number) => {
    setViewerState((prev) => ({
      ...prev,
      playbackProgress: Math.max(0, Math.min(1, progress))
    }));
  }, []);

  // View mode
  const setViewMode = useCallback((mode: "edit" | "preview") => {
    setViewerState((prev) => ({
      ...prev,
      viewMode: mode
    }));
  }, []);

  // Get current camera state
  const getCameraState = useCallback((): CameraState | null => {
    if (!viewerRef.current) return null;

    const camera = viewerRef.current.camera;
    return {
      eye: { x: camera.eye[0], y: camera.eye[1], z: camera.eye[2] },
      center: { x: camera.look[0], y: camera.look[1], z: camera.look[2] },
      up: { x: camera.up[0], y: camera.up[1], z: camera.up[2] }
    };
  }, []);

  // Screenshot
  const takeScreenshot = useCallback((): string | null => {
    if (!viewerRef.current) return null;

    const canvas = viewerRef.current.scene.canvas.canvas;
    return canvas.toDataURL("image/png");
  }, []);

  return {
    // Refs
    viewer: viewerRef.current,
    isReady,
    isModelLoaded,
    selectedPartId,
    viewerState,

    // Event handlers for XeokitCanvas
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
