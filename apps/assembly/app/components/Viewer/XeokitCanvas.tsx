import { useEffect, useRef, useState } from "react";
import type { CameraState } from "~/types/assembly.types";

// Dynamic import types - these will be loaded client-side only
type XeokitViewer = import("@xeokit/xeokit-sdk").Viewer;
type XeokitXKTLoaderPlugin = import("@xeokit/xeokit-sdk").XKTLoaderPlugin;
type XeokitGLTFLoaderPlugin = import("@xeokit/xeokit-sdk").GLTFLoaderPlugin;
type XeokitNavCubePlugin = import("@xeokit/xeokit-sdk").NavCubePlugin;
type XeokitSectionPlanesPlugin =
  import("@xeokit/xeokit-sdk").SectionPlanesPlugin;
type XeokitDistanceMeasurementsPlugin =
  import("@xeokit/xeokit-sdk").DistanceMeasurementsPlugin;
type XeokitAnnotationsPlugin = import("@xeokit/xeokit-sdk").AnnotationsPlugin;

export interface XeokitCanvasProps {
  canvasId?: string;
  navCubeCanvasId?: string;
  modelUrl?: string;
  modelFormat?: "xkt" | "gltf";
  onViewerReady?: (viewer: Viewer) => void;
  onModelLoaded?: () => void;
  onPartSelected?: (partId: string | null, partName: string | null) => void;
  highlightedPartIds?: string[];
  hiddenPartIds?: string[];
  className?: string;
}

export function XeokitCanvas({
  canvasId = "xeokit-canvas",
  navCubeCanvasId = "navCube-canvas",
  modelUrl,
  modelFormat = "gltf",
  onViewerReady,
  onModelLoaded,
  onPartSelected,
  highlightedPartIds = [],
  hiddenPartIds = [],
  className
}: XeokitCanvasProps) {
  const viewerRef = useRef<XeokitViewer | null>(null);
  const xktLoaderRef = useRef<XeokitXKTLoaderPlugin | null>(null);
  const gltfLoaderRef = useRef<XeokitGLTFLoaderPlugin | null>(null);
  const navCubeRef = useRef<XeokitNavCubePlugin | null>(null);
  const sectionPlanesRef = useRef<XeokitSectionPlanesPlugin | null>(null);
  const measurementsRef = useRef<XeokitDistanceMeasurementsPlugin | null>(null);
  const annotationsRef = useRef<XeokitAnnotationsPlugin | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);

  // Use refs for callbacks to avoid infinite re-render loops
  const onModelLoadedRef = useRef(onModelLoaded);
  onModelLoadedRef.current = onModelLoaded;
  const onViewerReadyRef = useRef(onViewerReady);
  onViewerReadyRef.current = onViewerReady;
  const onPartSelectedRef = useRef(onPartSelected);
  onPartSelectedRef.current = onPartSelected;

  // Check if we're on the client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize viewer - only on client
  useEffect(() => {
    if (!isClient) return;
    if (viewerRef.current) return;

    // Track if effect was cleaned up (for React Strict Mode double-mount)
    let cancelled = false;

    // Dynamically import xeokit-sdk only on client
    import("@xeokit/xeokit-sdk").then((xeokit) => {
      // Bail out if effect was cleaned up during async import
      if (cancelled) {
        console.log("[VIEWER] Skipping setup - effect was cleaned up");
        return;
      }
      const {
        Viewer,
        NavCubePlugin,
        SectionPlanesPlugin,
        DistanceMeasurementsPlugin,
        AnnotationsPlugin,
        XKTLoaderPlugin,
        GLTFLoaderPlugin
      } = xeokit;

      const viewer = new Viewer({
        canvasId,
        transparent: false,
        // Quality settings
        antialias: true, // Smooth jagged edges
        logarithmicDepthBufferEnabled: true, // Better depth precision for large models
        pbrEnabled: true, // Physically-based rendering
        preserveDrawingBuffer: true, // Required for screenshots
        entityOffsetsEnabled: true // Required for animation (entity.offset = [dx, dy, dz])
      });

      // Set dark background
      viewer.scene.canvas.canvas.style.background = "#1a1a2e";

      // Fix zoom-out clipping: extend camera far plane
      viewer.scene.camera.perspective.far = 100000; // Large far plane to prevent model disappearing
      viewer.scene.camera.perspective.near = 0.1; // Small near plane for close-up views

      // Enable SAO (Scalable Ambient Occlusion) for depth/shadow effects
      viewer.scene.sao.enabled = true;
      viewer.scene.sao.intensity = 0.15; // Subtle shadows (reduced for cleaner look)
      viewer.scene.sao.bias = 0.5;
      viewer.scene.sao.scale = 1000;
      viewer.scene.sao.kernelRadius = 100;

      // Better gamma correction for color accuracy
      viewer.scene.gammaOutput = true;
      viewer.scene.gammaFactor = 2.2;

      // Autodesk-like metallic/shiny appearance
      // Configure default material for imported models
      viewer.scene.pbrEnabled = true;

      // Configure highlight material (when parts are selected)
      viewer.scene.highlightMaterial.fill = true;
      viewer.scene.highlightMaterial.fillColor = [0.5, 0.7, 1.0];
      viewer.scene.highlightMaterial.fillAlpha = 0.3;
      viewer.scene.highlightMaterial.edges = true;
      viewer.scene.highlightMaterial.edgeColor = [0.3, 0.5, 1.0];
      viewer.scene.highlightMaterial.edgeAlpha = 1.0;
      viewer.scene.highlightMaterial.edgeWidth = 2;

      // Configure edge material for better visibility
      viewer.scene.edgeMaterial.edgeColor = [0.2, 0.2, 0.2];
      viewer.scene.edgeMaterial.edgeAlpha = 0.3;
      viewer.scene.edgeMaterial.edgeWidth = 1;

      // Add better lighting for metallic shine effect (Autodesk-like)
      // xeokit uses scene.lights array - clear and add custom lights
      try {
        // Clear default lights
        const lightIds = Object.keys(viewer.scene.lights);
        lightIds.forEach((id) => {
          if (viewer.scene.lights[id]) {
            viewer.scene.lights[id].destroy();
          }
        });

        // Add custom lighting setup using xeokit's Light classes
        const { DirLight, AmbientLight } = xeokit;

        // Key light - main illumination
        new DirLight(viewer.scene, {
          id: "keyLight",
          dir: [0.8, -0.6, -0.8],
          color: [1.0, 1.0, 0.95],
          intensity: 1.0,
          space: "world"
        });

        // Fill light - softer from opposite side
        new DirLight(viewer.scene, {
          id: "fillLight",
          dir: [-0.8, -0.4, 0.4],
          color: [0.9, 0.95, 1.0],
          intensity: 0.6,
          space: "world"
        });

        // Rim light - highlights edges
        new DirLight(viewer.scene, {
          id: "rimLight",
          dir: [-0.2, -0.8, 0.5],
          color: [1.0, 1.0, 1.0],
          intensity: 0.4,
          space: "world"
        });

        // Ambient light
        new AmbientLight(viewer.scene, {
          id: "ambientLight",
          color: [0.9, 0.9, 1.0],
          intensity: 0.3
        });
      } catch (lightErr) {
        console.warn(
          "[VIEWER] Custom lighting setup failed, using defaults:",
          lightErr
        );
      }

      // NavCube - view orientation widget (like BuildOS)
      navCubeRef.current = new NavCubePlugin(viewer, {
        canvasId: navCubeCanvasId,
        visible: true,
        cameraFly: true,
        cameraFlyDuration: 0.5,
        fitVisible: true,
        synchProjection: true
      });

      // Section planes for cutting views
      sectionPlanesRef.current = new SectionPlanesPlugin(viewer, {
        overviewVisible: false
      });

      // Distance measurements
      measurementsRef.current = new DistanceMeasurementsPlugin(viewer, {
        defaultVisible: true,
        defaultOriginVisible: true,
        defaultTargetVisible: true,
        defaultWireVisible: true,
        defaultAxisVisible: true
      });

      // Annotations for callouts
      annotationsRef.current = new AnnotationsPlugin(viewer, {
        markerHTML:
          "<div class='annotation-marker' style='background-color: #FF0000; width: 10px; height: 10px; border-radius: 50%;'></div>",
        labelHTML:
          "<div class='annotation-label' style='background-color: #333; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;'>{{title}}</div>"
      });

      // XKT loader for converted STEP files
      xktLoaderRef.current = new XKTLoaderPlugin(viewer);

      // GLTF loader for standard 3D models
      gltfLoaderRef.current = new GLTFLoaderPlugin(viewer);

      // Click handler for part selection
      viewer.scene.input.on("mouseclicked", (coords: number[]) => {
        const hit = viewer.scene.pick({
          canvasPos: coords,
          pickSurface: true
        });

        if (hit && hit.entity) {
          const entityId = hit.entity.id;
          console.log("[VIEWER] Clicked entity:", entityId);
          onPartSelectedRef.current?.(entityId, entityId);
        } else {
          console.log("[VIEWER] Clicked empty space");
          onPartSelectedRef.current?.(null, null);
        }
      });

      viewerRef.current = viewer;
      setIsViewerReady(true);
      onViewerReadyRef.current?.(viewer);
    });

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setIsViewerReady(false);
        setIsModelLoaded(false);
      }
    };
    // Note: Callbacks use refs to avoid re-creating viewer on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, canvasId, navCubeCanvasId]);

  // Load model when URL changes or viewer becomes ready
  useEffect(() => {
    if (!modelUrl || !isViewerReady || !viewerRef.current) return;

    const viewer = viewerRef.current;
    let cancelled = false;
    setIsModelLoaded(false);

    // Clear existing models
    const existingModels = Object.keys(viewer.scene.models);
    existingModels.forEach((modelId) => {
      viewer.scene.models[modelId]?.destroy();
    });

    // Load new model
    let sceneModel: ReturnType<typeof gltfLoaderRef.current.load> | null = null;

    if (modelFormat === "xkt" && xktLoaderRef.current) {
      sceneModel = xktLoaderRef.current.load({
        id: "assembly",
        src: modelUrl,
        edges: true
      });
    } else if (modelFormat === "gltf" && gltfLoaderRef.current) {
      sceneModel = gltfLoaderRef.current.load({
        id: "assembly",
        src: modelUrl,
        edges: true
      });
    }

    // Wait for model to finish loading
    if (sceneModel) {
      console.log("[VIEWER] Loading model from:", modelUrl);

      sceneModel.on("loaded", () => {
        // Bail out if effect was cleaned up during load
        if (cancelled) {
          console.log(
            "[VIEWER] Model loaded but effect was cleaned up - skipping"
          );
          return;
        }
        const entityCount = Object.keys(viewer.scene.objects).length;
        console.log("[VIEWER] Model loaded with", entityCount, "entities");
        console.log(
          "[VIEWER] Entity IDs:",
          Object.keys(viewer.scene.objects).slice(0, 10)
        );
        setIsModelLoaded(true);
        onModelLoadedRef.current?.();
        // Fit to view after load
        viewer.cameraFlight.flyTo({
          aabb: viewer.scene.aabb,
          duration: 0.5
        });
      });

      sceneModel.on("error", (err: unknown) => {
        console.error("[VIEWER] Model load error:", err);
      });
    }

    return () => {
      cancelled = true;
      // Destroy the model when effect cleans up
      if (sceneModel) {
        try {
          sceneModel.destroy();
        } catch {
          // Ignore errors during cleanup
        }
      }
    };
    // Note: onModelLoaded is intentionally NOT in deps to prevent infinite loops.
    // The callback is captured at effect creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, modelFormat, isViewerReady]);

  // Update highlighted parts
  useEffect(() => {
    if (!isModelLoaded || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Reset all highlights
    viewer.scene.setObjectsHighlighted(viewer.scene.objectIds, false);

    // Apply new highlights
    if (highlightedPartIds.length > 0) {
      viewer.scene.setObjectsHighlighted(highlightedPartIds, true);
    }
  }, [highlightedPartIds, isModelLoaded]);

  // Update hidden parts
  const prevHiddenRef = useRef<string[]>([]);
  useEffect(() => {
    if (!isModelLoaded || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Only update visibility for parts that changed (avoid showing ALL then hiding)
    const nowHidden = new Set(hiddenPartIds);

    // Show parts that were hidden but are now visible
    const toShow = prevHiddenRef.current.filter((id) => !nowHidden.has(id));
    if (toShow.length > 0) {
      viewer.scene.setObjectsVisible(toShow, true);
    }

    // Hide parts that are now hidden
    if (hiddenPartIds.length > 0) {
      viewer.scene.setObjectsVisible(hiddenPartIds, false);
    }

    prevHiddenRef.current = hiddenPartIds;
  }, [hiddenPartIds, isModelLoaded]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      {/* Main 3D canvas */}
      <canvas
        id={canvasId}
        className="w-full h-full block"
        style={{ background: "#1a1a2e" }}
      />

      {/* NavCube canvas - positioned top-right like BuildOS */}
      <canvas
        id={navCubeCanvasId}
        className="absolute top-4 right-4 w-[120px] h-[120px] pointer-events-auto"
        style={{ background: "transparent" }}
      />
    </div>
  );
}

// Utility functions for viewer control
export function flyToViewpoint(
  viewer: XeokitViewer,
  viewpoint: CameraState,
  duration = 0.5
) {
  viewer.cameraFlight.flyTo({
    eye: [viewpoint.eye.x, viewpoint.eye.y, viewpoint.eye.z],
    look: [viewpoint.center.x, viewpoint.center.y, viewpoint.center.z],
    up: [viewpoint.up.x, viewpoint.up.y, viewpoint.up.z],
    duration
  });
}

export function flyToEntity(
  viewer: XeokitViewer,
  entityId: string,
  duration = 0.5
) {
  const entity = viewer.scene.objects[entityId];
  if (entity) {
    viewer.cameraFlight.flyTo({
      aabb: entity.aabb,
      duration
    });
  }
}

export function setViewPreset(
  viewer: Viewer,
  preset: "front" | "back" | "top" | "bottom" | "left" | "right" | "iso"
) {
  const aabb = viewer.scene.aabb;
  const center = [
    (aabb[0] + aabb[3]) / 2,
    (aabb[1] + aabb[4]) / 2,
    (aabb[2] + aabb[5]) / 2
  ];
  const size = Math.max(
    aabb[3] - aabb[0],
    aabb[4] - aabb[1],
    aabb[5] - aabb[2]
  );
  const distance = size * 2;

  const presets: Record<string, { eye: number[]; up: number[] }> = {
    front: { eye: [center[0], center[1], center[2] + distance], up: [0, 1, 0] },
    back: { eye: [center[0], center[1], center[2] - distance], up: [0, 1, 0] },
    top: { eye: [center[0], center[1] + distance, center[2]], up: [0, 0, -1] },
    bottom: {
      eye: [center[0], center[1] - distance, center[2]],
      up: [0, 0, 1]
    },
    left: { eye: [center[0] - distance, center[1], center[2]], up: [0, 1, 0] },
    right: { eye: [center[0] + distance, center[1], center[2]], up: [0, 1, 0] },
    iso: {
      eye: [
        center[0] + distance * 0.7,
        center[1] + distance * 0.7,
        center[2] + distance * 0.7
      ],
      up: [0, 1, 0]
    }
  };

  const { eye, up } = presets[preset];

  viewer.cameraFlight.flyTo({
    eye,
    look: center,
    up,
    duration: 0.5
  });
}
