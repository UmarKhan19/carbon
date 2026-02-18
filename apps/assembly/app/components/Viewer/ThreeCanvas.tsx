/**
 * Three.js 3D viewer canvas component.
 * Drop-in replacement for XeokitCanvas.tsx.
 *
 * Creates ThreeEngine, loads GLB model, handles part picking via raycaster,
 * and syncs highlighting/visibility state from parent. SSR-safe via
 * dynamic imports — Three.js modules are only loaded on the client.
 */

import { useEffect, useRef, useState } from "react";
import type { LoadedModel } from "./engine/GLBLoader";
import type { NavCube } from "./engine/NavCube";
import type { SelectionManager } from "./engine/SelectionManager";
// Type-only imports — safe for SSR (erased at runtime)
import type { ThreeEngine } from "./engine/ThreeEngine";

export interface ThreeContext {
  engine: ThreeEngine;
  selection: SelectionManager;
}

export interface ThreeCanvasProps {
  modelUrl?: string;
  modelFormat?: "xkt" | "gltf";
  onViewerReady?: (ctx: ThreeContext) => void;
  onModelLoaded?: (model: LoadedModel) => void;
  onPartSelected?: (partId: string | null, partName: string | null) => void;
  highlightedPartIds?: string[];
  hiddenPartIds?: string[];
  className?: string;
}

export function ThreeCanvas({
  modelUrl,
  modelFormat = "gltf",
  onViewerReady,
  onModelLoaded,
  onPartSelected,
  highlightedPartIds = [],
  hiddenPartIds = [],
  className
}: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navCubeContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ThreeEngine | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const selectionRef = useRef<SelectionManager | null>(null);
  const navCubeRef = useRef<NavCube | null>(null);
  const navCubeTickRef = useRef<((delta: number) => void) | null>(null);

  const [isClient, setIsClient] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  // Stable refs for callbacks (avoid re-creating engine on every render)
  const onViewerReadyRef = useRef(onViewerReady);
  onViewerReadyRef.current = onViewerReady;
  const onModelLoadedRef = useRef(onModelLoaded);
  onModelLoadedRef.current = onModelLoaded;
  const onPartSelectedRef = useRef(onPartSelected);
  onPartSelectedRef.current = onPartSelected;

  // Client-side check for SSR safety
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize engine (client-only, runs once)
  useEffect(() => {
    if (!isClient || !containerRef.current) return;
    if (engineRef.current) return;

    let cancelled = false;

    // Dynamic import — Three.js modules loaded only on client
    Promise.all([
      import("./engine/ThreeEngine"),
      import("./engine/SelectionManager"),
      import("./engine/NavCube")
    ]).then(([{ ThreeEngine }, { SelectionManager }, { NavCube }]) => {
      if (cancelled || !containerRef.current) return;

      const engine = new ThreeEngine(containerRef.current);
      engineRef.current = engine;

      // Selection manager for raycaster picking
      const selection = new SelectionManager(
        engine.renderer,
        engine.camera,
        engine.scene
      );
      selectionRef.current = selection;

      selection.setOnPartClick((partId, partName) => {
        onPartSelectedRef.current?.(partId, partName);
      });

      // NavCube orientation widget
      if (navCubeContainerRef.current) {
        const navCube = new NavCube(
          navCubeContainerRef.current,
          engine.camera,
          {
            onViewChange: (preset) => engine.setViewPreset(preset)
          }
        );
        navCubeRef.current = navCube;

        // Sync NavCube orientation per frame
        const tickCb = () => navCube.update();
        navCubeTickRef.current = tickCb;
        engine.onTick(tickCb);
      }

      setIsEngineReady(true);
      onViewerReadyRef.current?.({ engine, selection });
    });

    return () => {
      cancelled = true;
      if (navCubeTickRef.current && engineRef.current) {
        engineRef.current.offTick(navCubeTickRef.current);
      }
      navCubeRef.current?.dispose();
      navCubeRef.current = null;
      selectionRef.current?.dispose();
      selectionRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      modelRef.current = null;
      setIsEngineReady(false);
      setIsModelLoaded(false);
    };
  }, [isClient]);

  // Load model when URL changes or engine becomes ready
  useEffect(() => {
    if (!modelUrl || !isEngineReady || !engineRef.current) return;

    const engine = engineRef.current;
    let cancelled = false;
    setIsModelLoaded(false);

    (async () => {
      const { loadGLB, unloadModel } = await import("./engine/GLBLoader");
      const THREE = await import("three");
      if (cancelled) return;

      // Clear existing model
      if (modelRef.current) {
        unloadModel(engine.scene, modelRef.current);
        modelRef.current = null;
      }

      try {
        const model = await loadGLB(engine.scene, modelUrl);
        if (cancelled) return;

        // Store rest transforms for animation offset support
        model.parts.forEach((obj) => {
          obj.userData._restPosition = obj.position.clone();
          obj.userData._restQuaternion = obj.quaternion.clone();
          obj.userData._restScale = obj.scale.clone();
        });

        modelRef.current = model;
        selectionRef.current?.setModel(model);
        setIsModelLoaded(true);
        onModelLoadedRef.current?.(model);

        // Fit to view after load
        const box = new THREE.Box3().setFromObject(model.root);
        engine.flyToAABB(box, 500);
      } catch (err) {
        console.error("[ThreeCanvas] Model load error:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, modelFormat, isEngineReady]);

  // Sync highlighted parts
  useEffect(() => {
    if (!isModelLoaded || !selectionRef.current) return;

    if (highlightedPartIds.length > 0) {
      selectionRef.current.highlightParts(highlightedPartIds);
    } else {
      selectionRef.current.clearHighlights();
    }
  }, [highlightedPartIds, isModelLoaded]);

  // Sync hidden parts (differential update to avoid flash)
  const prevHiddenRef = useRef<string[]>([]);
  useEffect(() => {
    if (!isModelLoaded || !selectionRef.current) return;
    const selection = selectionRef.current;

    const nowHidden = new Set(hiddenPartIds);

    // Show parts that were hidden but are now visible
    const toShow = prevHiddenRef.current.filter((id) => !nowHidden.has(id));
    if (toShow.length > 0) {
      selection.setPartsVisible(toShow, true);
    }

    // Hide parts that are now hidden
    if (hiddenPartIds.length > 0) {
      selection.setPartsVisible(hiddenPartIds, false);
    }

    prevHiddenRef.current = hiddenPartIds;
  }, [hiddenPartIds, isModelLoaded]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      {/* Main 3D canvas — ThreeEngine attaches its renderer here */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: "#1a1a2e" }}
      />

      {/* NavCube overlay — positioned top-right like BuildOS */}
      <div
        ref={navCubeContainerRef}
        className="absolute top-4 right-4 w-[120px] h-[120px] pointer-events-auto"
      />
    </div>
  );
}
