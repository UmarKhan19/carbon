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

  // Check if we're on the client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize viewer - only on client
  useEffect(() => {
    if (!isClient) return;
    if (viewerRef.current) return;

    // Dynamically import xeokit-sdk only on client
    import("@xeokit/xeokit-sdk").then((xeokit) => {
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
        antialias: true,                      // Smooth jagged edges
        logarithmicDepthBufferEnabled: true,  // Better depth precision for large models
        pbrEnabled: true,                     // Physically-based rendering
        preserveDrawingBuffer: true           // Required for screenshots
      });

      // Set dark background
      viewer.scene.canvas.canvas.style.background = "#1a1a2e";

      // Enable SAO (Scalable Ambient Occlusion) for depth/shadow effects
      viewer.scene.sao.enabled = true;
      viewer.scene.sao.intensity = 0.25;      // Subtle shadows
      viewer.scene.sao.bias = 0.5;
      viewer.scene.sao.scale = 500;
      viewer.scene.sao.kernelRadius = 100;

      // Better gamma correction for color accuracy
      viewer.scene.gammaOutput = true;
      viewer.scene.gammaFactor = 2.2;

      // Configure edge material for better visibility
      viewer.scene.edgeMaterial.edgeColor = [0.1, 0.1, 0.1];
      viewer.scene.edgeMaterial.edgeAlpha = 0.5;
      viewer.scene.edgeMaterial.edgeWidth = 1;

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
          onPartSelected?.(entityId, entityId);
        } else {
          console.log("[VIEWER] Clicked empty space");
          onPartSelected?.(null, null);
        }
      });

      viewerRef.current = viewer;
      setIsViewerReady(true);
      onViewerReady?.(viewer);
    });

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setIsViewerReady(false);
      }
    };
  }, [isClient, canvasId, navCubeCanvasId, onViewerReady, onPartSelected]);

  // Load model when URL changes or viewer becomes ready
  useEffect(() => {
    if (!modelUrl || !isViewerReady || !viewerRef.current) return;

    const viewer = viewerRef.current;

    // Clear existing models
    const existingModels = Object.keys(viewer.scene.models);
    existingModels.forEach((modelId) => {
      viewer.scene.models[modelId]?.destroy();
    });

    // Load new model
    if (modelFormat === "xkt" && xktLoaderRef.current) {
      xktLoaderRef.current.load({
        id: "assembly",
        src: modelUrl,
        edges: true
      });
    } else if (modelFormat === "gltf" && gltfLoaderRef.current) {
      gltfLoaderRef.current.load({
        id: "assembly",
        src: modelUrl,
        edges: true
      });
    }

    // Fit to view after load
    setTimeout(() => {
      viewer.cameraFlight.flyTo({
        aabb: viewer.scene.aabb,
        duration: 0.5
      });
    }, 500);
  }, [modelUrl, modelFormat, isViewerReady]);

  // Update highlighted parts
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Reset all highlights
    viewer.scene.setObjectsHighlighted(viewer.scene.objectIds, false);

    // Apply new highlights
    if (highlightedPartIds.length > 0) {
      viewer.scene.setObjectsHighlighted(highlightedPartIds, true);
    }
  }, [highlightedPartIds, isViewerReady]);

  // Update hidden parts
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    // Show all first
    viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);

    // Hide specified parts
    if (hiddenPartIds.length > 0) {
      viewer.scene.setObjectsVisible(hiddenPartIds, false);
    }
  }, [hiddenPartIds, isViewerReady]);

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
