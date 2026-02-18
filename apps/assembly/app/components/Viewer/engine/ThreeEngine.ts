/**
 * Core Three.js engine: scene, camera, renderer, controls, lights.
 * Replaces xeokit Viewer initialization from XeokitCanvas.tsx.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraState } from "~/types/assembly.types";

export interface ThreeEngineOptions {
  antialias?: boolean;
  background?: string;
}

export class ThreeEngine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private container: HTMLDivElement;
  private rafId: number | null = null;
  private disposed = false;
  private onTickCallbacks: Array<(delta: number) => void> = [];
  private clock = new THREE.Clock();

  constructor(container: HTMLDivElement, options: ThreeEngineOptions = {}) {
    this.container = container;
    const { antialias = true, background = "#1a1a2e" } = options;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(background);

    // Camera (matching xeokit: large far plane, small near plane)
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100000);
    this.camera.position.set(100, 100, 100);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias,
      preserveDrawingBuffer: true, // Required for screenshots
      alpha: false
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // OrbitControls (replaces xeokit's built-in camera interaction)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    // Lights (matching XeokitCanvas.tsx 3-point lighting)
    this.setupLights();

    // Start render loop
    this.startLoop();

    // Handle resize
    this.handleResize = this.handleResize.bind(this);
    const observer = new ResizeObserver(this.handleResize);
    observer.observe(container);
    (this as any)._resizeObserver = observer;
  }

  private setupLights() {
    // Key light (matching xeokit: dir [0.8, -0.6, -0.8], intensity 1.0)
    const keyLight = new THREE.DirectionalLight(0xfffff0, 1.0);
    keyLight.position.set(-0.8, 0.6, 0.8); // Negate dir for Three.js position
    this.scene.add(keyLight);

    // Fill light (matching xeokit: dir [-0.8, -0.4, 0.4], intensity 0.6)
    const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.6);
    fillLight.position.set(0.8, 0.4, -0.4);
    this.scene.add(fillLight);

    // Rim light (matching xeokit: dir [-0.2, -0.8, 0.5], intensity 0.4)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0.2, 0.8, -0.5);
    this.scene.add(rimLight);

    // Ambient (matching xeokit: color [0.9, 0.9, 1.0], intensity 0.3)
    const ambient = new THREE.HemisphereLight(0xe6e6ff, 0x444444, 0.3);
    this.scene.add(ambient);
  }

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);

      const delta = this.clock.getDelta();
      this.controls.update();

      for (const cb of this.onTickCallbacks) {
        cb(delta);
      }

      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private handleResize() {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Register a per-frame callback. */
  onTick(callback: (delta: number) => void) {
    this.onTickCallbacks.push(callback);
  }

  /** Remove a per-frame callback. */
  offTick(callback: (delta: number) => void) {
    this.onTickCallbacks = this.onTickCallbacks.filter((cb) => cb !== callback);
  }

  /** Fly camera to frame an AABB. */
  flyToAABB(box: THREE.Box3, duration = 500) {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const targetPos = center.clone().add(direction.multiplyScalar(dist));

    // Animate camera
    this.animateCamera(targetPos, center, duration);
  }

  /** Fly to a specific viewpoint. */
  flyToViewpoint(state: CameraState, duration = 500) {
    const eye = new THREE.Vector3(state.eye.x, state.eye.y, state.eye.z);
    const center = new THREE.Vector3(
      state.center.x,
      state.center.y,
      state.center.z
    );
    this.animateCamera(eye, center, duration);
  }

  /** Set a named camera preset. */
  setViewPreset(
    preset: "front" | "back" | "top" | "bottom" | "left" | "right" | "iso"
  ) {
    const box = new THREE.Box3().setFromObject(this.scene);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const dist = Math.max(size.x, size.y, size.z) * 2;

    const presets: Record<string, { eye: THREE.Vector3; up: THREE.Vector3 }> = {
      front: {
        eye: new THREE.Vector3(center.x, center.y, center.z + dist),
        up: new THREE.Vector3(0, 1, 0)
      },
      back: {
        eye: new THREE.Vector3(center.x, center.y, center.z - dist),
        up: new THREE.Vector3(0, 1, 0)
      },
      top: {
        eye: new THREE.Vector3(center.x, center.y + dist, center.z),
        up: new THREE.Vector3(0, 0, -1)
      },
      bottom: {
        eye: new THREE.Vector3(center.x, center.y - dist, center.z),
        up: new THREE.Vector3(0, 0, 1)
      },
      left: {
        eye: new THREE.Vector3(center.x - dist, center.y, center.z),
        up: new THREE.Vector3(0, 1, 0)
      },
      right: {
        eye: new THREE.Vector3(center.x + dist, center.y, center.z),
        up: new THREE.Vector3(0, 1, 0)
      },
      iso: {
        eye: new THREE.Vector3(
          center.x + dist * 0.7,
          center.y + dist * 0.7,
          center.z + dist * 0.7
        ),
        up: new THREE.Vector3(0, 1, 0)
      }
    };

    const { eye, up } = presets[preset];
    this.camera.up.copy(up);
    this.animateCamera(eye, center, 500);
  }

  /** Get current camera state. */
  getCameraState(): CameraState {
    return {
      eye: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      center: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z
      },
      up: { x: this.camera.up.x, y: this.camera.up.y, z: this.camera.up.z }
    };
  }

  /** Take a screenshot. */
  takeScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Fly camera to frame a specific Object3D. */
  flyToObject(obj: THREE.Object3D, duration = 500) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    this.flyToAABB(box, duration);
  }

  /** Trigger a resize update. */
  resize() {
    this.handleResize();
  }

  /** Destroy the engine and free resources. */
  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    (this as any)._resizeObserver?.disconnect();
    this.scene.clear();
    this.onTickCallbacks = [];
  }

  // -- Private animation helper --

  private animateCamera(
    targetPos: THREE.Vector3,
    targetLook: THREE.Vector3,
    duration: number
  ) {
    const startPos = this.camera.position.clone();
    const startLook = this.controls.target.clone();
    const startTime = performance.now();

    const animate = () => {
      if (this.disposed) return;
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out quad

      this.camera.position.lerpVectors(startPos, targetPos, eased);
      this.controls.target.lerpVectors(startLook, targetLook, eased);
      this.controls.update();

      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
}
