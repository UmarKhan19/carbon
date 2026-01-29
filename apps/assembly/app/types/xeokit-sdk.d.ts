// Type declarations for @xeokit/xeokit-sdk
// These are minimal declarations to support our usage

declare module "@xeokit/xeokit-sdk" {
  export class Viewer {
    constructor(cfg: ViewerConfig);
    scene: Scene;
    camera: Camera;
    cameraFlight: CameraFlightAnimation;
    destroy(): void;
  }

  export interface ViewerConfig {
    canvasId: string;
    transparent?: boolean;
  }

  export class Scene {
    canvas: {
      canvas: HTMLCanvasElement;
    };
    aabb: number[];
    models: Record<string, SceneModel>;
    objects: Record<string, Entity>;
    objectIds: string[];
    input: Input;
    setObjectsHighlighted(ids: string[], highlighted: boolean): void;
    setObjectsVisible(ids: string[], visible: boolean): void;
    pick(params: PickParams): PickResult | null;
  }

  export interface PickParams {
    canvasPos: number[];
    pickSurface?: boolean;
  }

  export interface PickResult {
    entity: Entity;
  }

  export class Entity {
    id: string;
    aabb: number[];
  }

  export class SceneModel {
    destroy(): void;
  }

  export class Input {
    on(event: string, callback: (coords: number[]) => void): void;
  }

  export class Camera {
    eye: number[];
    look: number[];
    up: number[];
  }

  export class CameraFlightAnimation {
    flyTo(params: FlyToParams): void;
  }

  export interface FlyToParams {
    aabb?: number[];
    eye?: number[];
    look?: number[];
    up?: number[];
    duration?: number;
  }

  export class NavCubePlugin {
    constructor(viewer: Viewer, cfg: NavCubeConfig);
  }

  export interface NavCubeConfig {
    canvasId: string;
    visible?: boolean;
    cameraFly?: boolean;
    cameraFlyDuration?: number;
    fitVisible?: boolean;
    synchProjection?: boolean;
  }

  export class SectionPlanesPlugin {
    constructor(viewer: Viewer, cfg?: SectionPlanesConfig);
  }

  export interface SectionPlanesConfig {
    overviewVisible?: boolean;
  }

  export class DistanceMeasurementsPlugin {
    constructor(viewer: Viewer, cfg?: DistanceMeasurementsConfig);
  }

  export interface DistanceMeasurementsConfig {
    defaultVisible?: boolean;
    defaultOriginVisible?: boolean;
    defaultTargetVisible?: boolean;
    defaultWireVisible?: boolean;
    defaultAxisVisible?: boolean;
  }

  export class AnnotationsPlugin {
    constructor(viewer: Viewer, cfg?: AnnotationsConfig);
  }

  export interface AnnotationsConfig {
    markerHTML?: string;
    labelHTML?: string;
  }

  export class TreeViewPlugin {
    constructor(viewer: Viewer, cfg?: TreeViewConfig);
  }

  export interface TreeViewConfig {
    containerElement?: HTMLElement;
  }

  export class XKTLoaderPlugin {
    constructor(viewer: Viewer);
    load(params: XKTLoadParams): SceneModel;
  }

  export interface XKTLoadParams {
    id: string;
    src: string;
    edges?: boolean;
  }

  export class GLTFLoaderPlugin {
    constructor(viewer: Viewer);
    load(params: GLTFLoadParams): SceneModel;
  }

  export interface GLTFLoadParams {
    id: string;
    src: string;
    edges?: boolean;
  }
}
