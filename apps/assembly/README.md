# Assembly Work Instructions

Automatic generation of assembly/disassembly work instructions from CAD files. Upload a STEP file, get an animated step-by-step assembly plan with collision-validated motion paths.

## How It Works

```
STEP file upload
      |
      v
[step-parser-occ]  ── Python + OpenCascade ── extracts assembly tree + GLB mesh
      |
      v
[assembly-simulate] ── Rust (parry3d) ── finds disassembly sequence + animation paths
      |
      v
[project editor]   ── React + xeokit ── 3D viewer with animated work instructions
```

### 1. Parsing (`step-parser-occ` job)

- Reads STEP AP203/AP214 files using OpenCascade (via `cadquery`)
- Builds an assembly tree: assemblies contain sub-assemblies and parts
- Tessellates each part into triangle meshes and exports a single GLB file
- Stores the assembly tree (JSON) and GLB (S3) in the project record

### 2. Simulation (`assembly-simulate` job)

The Rust simulator at `packages/cad-rust/` finds how to take the assembly apart, then reverses it into assembly order. It runs a 10-step pipeline:

1. **Contact graph** -- sweep-and-prune broad phase + parry3d narrow phase to find which parts touch
2. **Classification** -- labels parts as structural, fastener, panel, or standard based on geometry
3. **Dependency graph** -- fasteners go after their neighbors, structural parts go before panels
4. **Blocking matrix** -- swept-AABB pre-filter to check which parts block which in 6 axis directions
5. **Disassembly loop** -- iteratively removes unblocked parts, evaluating collision-free removal paths
6. **Path evaluation** -- discrete CCD sampling with binary search refinement to find exact clearance distance
7. **Reversal** -- flips disassembly order into assembly order
8. **Identical groups** -- merges repeated parts into groups (e.g. "8x M6 bolt")
9. **Subassemblies** -- detects sub-assemblies that can be pre-assembled offline
10. **Animation keyframes** -- generates time-stamped 4x4 transform keyframes for each step

Each step includes: part IDs, direction, travel distance, duration, and animation keyframes.

### 3. Viewer (`apps/assembly/app/components/Viewer/`)

- **XeokitCanvas** -- loads the GLB model into a xeokit 3D scene
- **useAnimationPlayback** -- interpolates keyframes and applies positional offsets to animate parts
- **useXeokit** -- manages the xeokit viewer lifecycle, highlighting, and camera

## Project Structure

```
apps/assembly/
  app/
    routes/x+/
      _index.tsx          # Dashboard -- project list, upload STEP
      projects.$id.edit   # Editor -- work instruction editing + 3D viewer
      projects.$id.prep   # Prep view
      projects.new        # New project wizard
      settings.*          # Tool library, torque specs, associations
    components/
      Viewer/             # xeokit 3D viewer + animation engine
      WorkInstructions/   # Step editor, panels, export modal
      Home/               # Dashboard cards

packages/cad-rust/
  cad-common/             # Shared types (AssemblyNode, AssemblyStep, etc.)
  cad-simulator/          # Assembly-by-disassembly solver (parry3d collision)
  cad-server/             # Axum HTTP server (/health, /parse, /simulate)
  cad-parser/             # Rust STEP parser (truck-stepio, limited)
  cad-wasm/               # WASM build for browser-side use

packages/jobs/trigger/
  step-parser-occ.ts      # Trigger.dev job: STEP → assembly tree + GLB
  assembly-simulate.ts    # Trigger.dev job: tree + GLB → simulation result
```

## Running Locally

### Frontend

```bash
cd apps/assembly
pnpm dev            # starts React Router dev server
```

### Rust CAD Server

```bash
cd packages/cad-rust
cargo build --release
./target/release/cad-server              # listens on :8080
```

The `assembly-simulate` job calls `CAD_SERVER_URL` (default `http://localhost:8080`).

### Running Simulation Jobs

Jobs run via [Trigger.dev](https://trigger.dev). With the dev CLI running (`npx trigger dev`), uploading a STEP file triggers the parse job, which auto-chains to the simulation job.

To re-run simulation on an existing project, use the "Re-run Simulation" button in the project editor.

## Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CAD_SERVER_URL` | `http://localhost:8080` | Rust simulation server URL |
| `PORT` | `8080` | Port for the Rust CAD server |

## Tests

```bash
cd packages/cad-rust
cargo test           # runs 31 tests (simulator, parser, common)
```
