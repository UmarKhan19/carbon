/**
 * Orientation NavCube widget.
 * Replaces xeokit's NavCubePlugin.
 *
 * Renders a small orientation cube in an overlay canvas.
 * Clicking a face rotates the main camera to that view preset.
 */

import * as THREE from "three";

export interface NavCubeOptions {
  /** Size in pixels (default 120, matching xeokit's NavCubePlugin). */
  size?: number;
  /** Callback when user clicks a face to change view. */
  onViewChange?: (
    preset: "front" | "back" | "top" | "bottom" | "left" | "right"
  ) => void;
}

export class NavCube {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private cube: THREE.Mesh;
  private container: HTMLDivElement;
  private mainCamera: THREE.PerspectiveCamera;
  private disposed = false;
  private onViewChange: NavCubeOptions["onViewChange"];

  constructor(
    container: HTMLDivElement,
    mainCamera: THREE.PerspectiveCamera,
    options: NavCubeOptions = {}
  ) {
    const { size = 120, onViewChange } = options;
    this.mainCamera = mainCamera;
    this.onViewChange = onViewChange;
    this.container = container;

    // Create NavCube renderer
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.pointerEvents = "auto";
    container.appendChild(this.renderer.domElement);

    // Scene for the NavCube
    this.scene = new THREE.Scene();

    // Orthographic camera
    this.camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
    this.camera.position.set(2, 2, 2);
    this.camera.lookAt(0, 0, 0);

    // Create the cube with labeled faces
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = [
      this.makeFaceMaterial("R", 0x4488cc), // +X = Right
      this.makeFaceMaterial("L", 0x4488cc), // -X = Left
      this.makeFaceMaterial("T", 0x44aa44), // +Y = Top
      this.makeFaceMaterial("B", 0x44aa44), // -Y = Bottom
      this.makeFaceMaterial("F", 0xcc6644), // +Z = Front
      this.makeFaceMaterial("Bk", 0xcc6644) // -Z = Back
    ];
    this.cube = new THREE.Mesh(geometry, materials);
    this.scene.add(this.cube);

    // Light
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 2, 2);
    this.scene.add(dirLight);

    // Click handling
    this.renderer.domElement.addEventListener(
      "click",
      this.handleClick.bind(this)
    );
  }

  private makeFaceMaterial(
    label: string,
    color: number
  ): THREE.MeshLambertMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.MeshLambertMaterial({ map: texture });
  }

  private handleClick(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const intersects = raycaster.intersectObject(this.cube);

    if (intersects.length > 0 && intersects[0].face) {
      const faceIndex = Math.floor(intersects[0].faceIndex! / 2);
      const presets: Array<
        "right" | "left" | "top" | "bottom" | "front" | "back"
      > = ["right", "left", "top", "bottom", "front", "back"];
      this.onViewChange?.(presets[faceIndex]);
    }
  }

  /** Sync the NavCube orientation with the main camera. Called per frame. */
  update() {
    if (this.disposed) return;
    // Mirror main camera's rotation onto the NavCube camera
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.mainCamera.quaternion
    );
    this.camera.position.copy(dir.negate().multiplyScalar(3));
    this.camera.lookAt(0, 0, 0);
    this.camera.up.copy(this.mainCamera.up);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
