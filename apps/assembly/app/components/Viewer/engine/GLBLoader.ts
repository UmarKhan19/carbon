/**
 * GLB/glTF model loader using Three.js GLTFLoader.
 * Replaces xeokit GLTFLoaderPlugin from XeokitCanvas.tsx.
 *
 * Maps glTF node names → Three.js Object3D instances for part selection,
 * highlighting, and visibility control. Node names are UUIDs matching
 * the assembly tree node IDs.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface LoadedModel {
  /** Root object added to the scene. */
  root: THREE.Group;
  /** Map of entity ID (UUID) → Object3D for part manipulation. */
  parts: Map<string, THREE.Object3D>;
  /** Map of entity ID → original materials (for highlight/restore). */
  originalMaterials: Map<string, THREE.Material | THREE.Material[]>;
}

/**
 * Load a GLB/glTF model and index all named nodes.
 */
export async function loadGLB(
  scene: THREE.Scene,
  url: string,
  onProgress?: (pct: number) => void
): Promise<LoadedModel> {
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        const parts = new Map<string, THREE.Object3D>();
        const originalMaterials = new Map<
          string,
          THREE.Material | THREE.Material[]
        >();

        // Walk the scene graph, index every named node
        root.traverse((child) => {
          if (child.name) {
            parts.set(child.name, child);

            // Store original materials for highlight/restore
            if (child instanceof THREE.Mesh && child.material) {
              originalMaterials.set(
                child.name,
                Array.isArray(child.material)
                  ? child.material.map((m) => m.clone())
                  : child.material.clone()
              );
            }
          }

          // Apply PBR metallic settings (matching xeokit: metallic=0.3, roughness=0.35)
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const mat of mats) {
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.metalness = 0.3;
                mat.roughness = 0.35;
              }
            }
          }
        });

        scene.add(root);
        resolve({ root, parts, originalMaterials });
      },
      (event) => {
        if (event.total > 0 && onProgress) {
          onProgress((event.loaded / event.total) * 100);
        }
      },
      (error) => {
        reject(error);
      }
    );
  });
}

/**
 * Remove a loaded model from the scene and dispose resources.
 */
export function unloadModel(scene: THREE.Scene, model: LoadedModel) {
  scene.remove(model.root);
  model.root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach((m) => m.dispose());
    }
  });
  model.parts.clear();
  model.originalMaterials.clear();
}
