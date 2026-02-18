/**
 * Part selection and highlighting via raycasting.
 * Replaces xeokit's scene.pick() and setObjectsHighlighted/setObjectsVisible.
 */

import * as THREE from "three";
import type { LoadedModel } from "./GLBLoader";

const HIGHLIGHT_COLOR = new THREE.Color(0.5, 0.7, 1.0);
const HIGHLIGHT_OPACITY = 0.3;

export class SelectionManager {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private model: LoadedModel | null = null;
  private highlightMaterial: THREE.MeshBasicMaterial;
  private onPartClick:
    | ((partId: string | null, partName: string | null) => void)
    | null = null;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private handleClick: (event: MouseEvent) => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;

    // Highlight overlay material (matching xeokit: fillColor [0.5, 0.7, 1.0], fillAlpha 0.3)
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: HIGHLIGHT_COLOR,
      transparent: true,
      opacity: HIGHLIGHT_OPACITY,
      depthTest: true,
      side: THREE.FrontSide
    });

    // Click handler
    this.handleClick = (event: MouseEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      if (!this.model) {
        this.onPartClick?.(null, null);
        return;
      }

      // Intersect with all meshes in the model
      const meshes: THREE.Mesh[] = [];
      this.model.root.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });

      const intersects = this.raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        // Walk up to find the named ancestor (entity ID)
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && !this.model.parts.has(obj.name)) {
          obj = obj.parent;
        }
        if (obj && obj.name) {
          this.onPartClick?.(obj.name, obj.name);
          return;
        }
      }

      this.onPartClick?.(null, null);
    };

    this.renderer.domElement.addEventListener("click", this.handleClick);
  }

  setModel(model: LoadedModel) {
    this.model = model;
  }

  setOnPartClick(
    callback: (partId: string | null, partName: string | null) => void
  ) {
    this.onPartClick = callback;
  }

  /** Highlight specific parts by ID. */
  highlightParts(partIds: string[]) {
    if (!this.model) return;
    this.clearHighlights();

    const idSet = new Set(partIds);
    this.model.parts.forEach((obj, id) => {
      if (!idSet.has(id)) return;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.userData._originalMaterial = child.material;
          child.material = this.highlightMaterial;
        }
      });
    });
  }

  /** Clear all highlights, restoring original materials. */
  clearHighlights() {
    if (!this.model) return;
    this.model.parts.forEach((obj) => {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData._originalMaterial) {
          child.material = child.userData._originalMaterial;
          delete child.userData._originalMaterial;
        }
      });
    });
  }

  /** Set visibility of specific parts. */
  setPartsVisible(partIds: string[], visible: boolean) {
    if (!this.model) return;
    const idSet = new Set(partIds);
    this.model.parts.forEach((obj, id) => {
      if (idSet.has(id)) {
        obj.visible = visible;
      }
    });
  }

  /** Show all parts. */
  showAll() {
    if (!this.model) return;
    this.model.parts.forEach((obj) => {
      obj.visible = true;
    });
  }

  /** Ghost all parts except the given IDs (make them semi-transparent). */
  ghostAllExcept(partIds: string[]) {
    if (!this.model) return;
    const keepSet = new Set(partIds);
    this.model.parts.forEach((obj, id) => {
      if (keepSet.has(id)) return;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.transparent = true;
              mat.opacity = 0.15;
            }
          }
        }
      });
    });
  }

  dispose() {
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.highlightMaterial.dispose();
  }
}
