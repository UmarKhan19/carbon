# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### C++ CAD Engine (`packages/cad-engine/`)
- **Unified C++ service replacing both PythonOCC and Rust simulator** — single service handles STEP parsing, GLB export, BRep analysis, and assembly simulation using OpenCascade 7.9 + CGAL 6.1
- **BRep analysis (NEW)** — face type classification (planar, cylindrical, conical, spherical, toroidal), volume/surface area/center of gravity via `BRepGProp`, thread detection via helical edge patterns, and insertion axis inference from cylindrical/conical faces (`parsing/brep_analyzer.cpp`)
- **CGAL mesh collision** — replaced parry3d with `PMP::do_intersect()` for mesh-mesh intersection, `AABB_tree::squared_distance()` for distance queries, and discrete CCD sampling with binary search refinement (`collision/collision_utils.cpp`)
- **Full assembly simulator port** — 10-step disassembly pipeline: contact graph (sweep-and-prune + CGAL), part classification (name + geometry + BRep), dependency graph (3 assembly rules), blocking matrix (6-direction discrete CCD), main disassembly loop with priority sorting, and step reversal for assembly order (`simulator/simulator.cpp`)
- **61 GoogleTest unit tests** covering geometry signatures, contact graph, classifier, dependency graph, blocking matrix, collision, path planner, animation, and full simulation integration
- **HTTP API** — `/health`, `/parse` (multipart STEP upload), `/simulate` (JSON assembly tree + GLB), `/parse-and-simulate` (unified endpoint) via cpp-httplib
- **Live HTTP handlers** — `/simulate` and `/parse-and-simulate` endpoints fully wired to `AssemblySimulator`, including JSON→AssemblyNode deserialization, GLB mesh reader (extracts vertex/index data from binary glTF by node ID), `SimulationResult→JSON` serializer, and base64 decode. Tested end-to-end with `as1_pe_203.stp` (18 parts, 18 steps, 0 stuck)
- **Improved simulation sequence quality** — ported 4 algorithms from Rust simulator to match output quality:
  - Area-weighted contact normal voting (2-pass triangle centroid projection via CGAL AABB_tree, replaces center-to-center approximation) for accurate bolt-axis detection
  - Combined diagonal candidate directions (pairs of primary directions with dot < 0.7) for narrow-gap removal paths
  - Fastener preferred direction alignment bonus (sum of away-from-neighbor normals, `(alignment+1)×0.025` quality boost)
  - Multi-part batch removal per iteration (collect all independently-removable parts, sort by quality, remove together)

#### Three.js Viewer (`apps/assembly/app/components/Viewer/`)
- **Replaced xeokit with Three.js** — full TRS keyframe animation support (position + rotation + scale decomposition from 4x4 matrices), enabling helix/screw-in animations that xeokit couldn't render
- Five engine modules: `ThreeEngine.ts` (scene/renderer/camera), `GLBLoader.ts` (GLTF loader + node map), `SelectionManager.ts` (raycaster picking + ghost materials), `AnimationEngine.ts` (matrix decomposition keyframe interpolation), `NavCube.ts` (orientation widget)
- `ThreeCanvas.tsx` + `useThree.ts` hook with same public API as previous xeokit integration

### Changed

#### Job Pipeline (`packages/jobs/`)
- Updated `step-parser-occ.ts` and `assembly-simulate.ts` to point to unified C++ CAD Engine (`CAD_ENGINE_URL`, port 8080)
- Updated `sst.config.ts` deployment: replaced `CarbonCADService` (PythonOCC) with `CarbonCADEngine` (C++)

### Fixed

#### Assembly App (`apps/assembly/`)
- Fixed race condition where CAD model wouldn't load on page refresh/navigation. Added `isViewerReady` state to ensure model loads only after xeokit viewer is initialized (`Viewer/XeokitCanvas.tsx`)
- **Fixed model disappearing on zoom out** - Extended camera far clipping plane to 100000 (`XeokitCanvas.tsx`)
- Added custom 3-point lighting setup for better metallic shine (key, fill, rim lights)
- Fixed animation playback to respect full sampled keyframe trajectories instead of only first/last keyframes (`components/Viewer/useAnimationPlayback.ts`)
- Fixed animation path conversion to preserve rotation metadata and handle both Rust matrix keyframes and previously saved frontend keyframes (`routes/x+/projects.$id.edit.tsx`)

#### Rust Physics Simulator (`packages/cad-rust/`)
- Improved sequencing accuracy with panel-aware dependency rules, name/score-based part kinds, and disassembly prioritization
- Improved removal feasibility by using contact-normal candidate directions and adaptive step sizing with clearance checks
- Added helix-style removal paths for fasteners to better match screw/bolt insertions
- Prevented zero-length contact normals from producing NaNs in the contact graph
- Improved collision-free motion selection with swept AABB prefiltering, clearance ratio scoring, and higher-resolution path sampling
- Added AABB-based broad-phase filtering and new unit test coverage for swept overlap timing
- Added structured simulator diagnostics (`overlap`, `clearance`, `path_not_found`, `constraint_conflict`) and planner stats to simulation output (`cad-common`, `cad-simulator`)
- Added assembled-state overlap detection and issue emission before sequence generation (`cad-simulator/src/simulator.rs`)
- Tightened collision-safe path planning by requiring high removal completion ratio, generating dense validated keyframes per step, and adding in-loop timeout guards to avoid long-running planner stalls (`cad-simulator/src/simulator.rs`)
- **105x performance improvement** - Enabled swept AABB pre-filter to skip collision sampling until first potential intersection, reduced sampling density, and tuned binary search early exit (`cad-simulator/src/simulator.rs`)
- **Fixed assembly clipping** - Path planning now checks collisions against ALL parts (not just remaining), ensuring paths are valid for assembly in any order (`cad-simulator/src/simulator.rs`)
- **Multi-segment assembly paths** - Parts now enter from outside the global assembly bounding box via a two-segment path (staging → approach → insertion), eliminating visual clipping at animation start. Includes collision-checked approach segments with automatic fallback directions (`cad-simulator/src/simulator.rs`)
- **Fixed assembly insertion direction** - Replaced single closest-point contact normal with area-weighted contact patch normal voting. Radial normals from cylindrical contacts (bolt-in-hole) now cancel out, letting axial normals dominate. Fastener axis directions are also prioritized in candidate direction selection (`cad-simulator/src/contact_graph.rs`, `cad-simulator/src/simulator.rs`)
- **Eliminated assembly clipping via continuous collision detection** - Replaced discrete sampling in path planning with `parry3d::query::cast_shapes` (time-of-impact queries) for exact collision boundaries with no tunneling through thin walls. Tightened baseline overlap tolerance from 20% to 1% to prevent paths that slide through mating geometry. Added diagonal fallback paths for narrow-passage removal (`cad-simulator/src/simulator.rs`)
- **Step intelligence: identical geometry detection** - Added geometry signature hashing (vertex count, triangle count, quantized AABB volume/dims) to detect parts with identical mesh shapes across different positions/orientations. Enables step clustering (e.g., "Install washer ×14") (`cad-simulator/src/geometry.rs`)
- **Step intelligence: subassembly detection** - Added label propagation community detection on the contact graph (functional↔functional=1.0 weight, fastener=0.1) to identify natural subassemblies. Returns suggested groupings with confidence scores (`cad-simulator/src/contact_graph.rs`)
- **Step intelligence: fastener kit detection** - BFS from bolts/screws through fastener-classified neighbors to group bolt+washer+nut chains into kits for combined assembly steps (`cad-simulator/src/contact_graph.rs`)
- **O(n log n) contact graph broad-phase** - Replaced O(n²) pairwise distance loop with sweep-and-prune on world-space AABBs. Reduces contact graph construction from ~125k checks to ~2-5k for 500-part assemblies (`cad-simulator/src/contact_graph.rs`)
- **Per-step direction constraint** - Added optional 45° cone filter to `candidate_directions_for_part()`, enabling per-step approach direction override from the frontend (`cad-simulator/src/simulator.rs`)
- **Adaptive step duration** - Replaced fixed 1500ms with distance-proportional timing (300-3000ms). Short moves like washers get ~500ms, long panel moves get up to 3000ms (`cad-simulator/src/simulator.rs`)
- **Extended SimulationResult** - Added `identical_groups`, `suggested_subassemblies`, and `kits` fields to simulation output for downstream step clustering in the job pipeline (`cad-common/src/assembly.rs`)
- **Correctness fix: removed-parts filtering** - `evaluate_removal_path()` now checks collisions only against remaining parts instead of all parts. In disassembly, removed parts are gone; in assembly (reversed), earlier-removed parts are placed later and absent when intermediate parts are placed. Eliminates false "stuck" verdicts from over-conservative collision checks (`cad-simulator/src/simulator.rs`)
- **Blocking matrix pre-filter** - Precomputes 6-direction blocking relationships using CCD (`cast_shapes`) at startup. Parts blocked in all 6 canonical directions by remaining parts are skipped in the main loop, avoiding expensive full CCD evaluation. Includes AABB pre-filter and baseline-intersection exclusion. Tracks skip count via `blocking_matrix_skips` in `PlannerStats` (`cad-simulator/src/simulator.rs`, `cad-common/src/assembly.rs`)

#### CAD Service (`packages/cad-service/`)
- Fixed STEP file color extraction using official PythonOCC pattern (`GetInstanceColor` before `GetColor`)
- Added recursion depth limit and cycle detection to XCAF parser to prevent hangs
- Changed parsing order to XCAF-first (has names/colors) with simple parser as fallback
- Added comprehensive debug logging throughout XCAF parsing pipeline
- Added part name extraction logging and reference instance name fallback in parser
- Fixed tree-viewer ID matching by using hierarchy ID as GLB node name (`gltf_writer.py`)
- **Fixed part hierarchy flattening** - Single-child assemblies are now unwrapped to show parts correctly (no more folders for single parts)
- Improved material shine with higher metallic (0.3) and lower roughness (0.35) for Autodesk-like appearance



### Changed

#### Assembly App (`apps/assembly/`)
- Improved xeokit CAD viewer rendering quality with anti-aliasing, SAO (ambient occlusion), PBR materials, gamma correction, and edge material tuning (`Viewer/XeokitCanvas.tsx`)
- Added bidirectional selection sync between prep page tree and 3D viewer - click tree node to highlight in viewer, click 3D part to select in tree (`projects.$id.prep.tsx`)

### Added

#### Assembly App (`apps/assembly/`)
A new standalone application for creating animated assembly work instructions from CAD files.

**Core Features:**
- STEP file upload and CAD visualization
- Physics-based assembly sequence simulation
- Two-phase workflow: Preprocessing (tree editing) and Instruction Editing
- Video export (MP4/WebM) and PDF generation
- Shareable links for mobile viewing
- Tribal knowledge capture and learning system

**Routes:**
- `/x/projects` - Project list with search and filter
- `/x/projects/new` - File upload with drag-and-drop
- `/x/projects/:id` - Project overview with workflow progress
- `/x/projects/:id/prep` - Phase 1: Tree editor for part renaming and reordering
- `/x/projects/:id/edit` - Phase 2: Instruction editor with animation controls
- `/x/projects/:id/export` - Video, PDF, and share link export
- `/x/settings` - App settings overview
- `/x/settings/tools` - Tool library management
- `/x/settings/torque` - Torque specification library
- `/x/settings/associations` - Part association rules for tribal knowledge

**Components:**
- `Layout/Topbar.tsx` - Top navigation bar
- `Layout/Sidebar.tsx` - Side navigation with project links

**BuildOS-Style Work Instruction Editor (xeokit-sdk):**
- `Viewer/XeokitCanvas.tsx` - xeokit WebGL viewer with NavCube, section planes, measurements
- `Viewer/useXeokit.ts` - React hook for viewer state and camera controls
- `WorkInstructions/WorkInstructionEditor.tsx` - Main 3-panel layout orchestrator
- `WorkInstructions/LeftPanel/` - Model tree and hierarchical step list (1.1, 1.2.1 numbering)
  - `StepTree.tsx` - Hierarchical step display with grouping
  - `ComponentTree.tsx` - Assembly tree viewer with expand/collapse
  - `GeometriesList.tsx` - Part counts display
- `WorkInstructions/RightPanel/` - Supplement tabs for step editing
  - `SupplementsTab.tsx` - Overview of tools, warnings, notes
  - `ToolsTab.tsx` - Tool assignment with library search
  - `NotesTab.tsx` - Step-specific notes editor
  - `StandardNotesTab.tsx` - Reusable standard notes library
  - `MediaTab.tsx` - Image/video attachments with drag-and-drop
- `WorkInstructions/CenterViewer/` - 3D viewer controls
  - `ViewerToolbar.tsx` - View presets, exploded view, section tools
  - `StepNavigation.tsx` - Step info bar with prev/next
  - `PlaybackControls.tsx` - Play/pause, timeline, step markers

**Type Definitions:**
- `types/assembly.types.ts` - Comprehensive TypeScript types (AssemblyStep, AssemblyTreeNode, ViewerState, PartAssociation with confidence scores)
- `types/xeokit-sdk.d.ts` - Type declarations for xeokit-sdk

#### Database Schema (`packages/database/`)
New migration `20260123120000_assembly-app-standalone.sql` adding:

**Tables:**
- `assemblyProject` - Assembly projects with status tracking, CAD file references, simulation results
- `assemblyStep` - Individual assembly steps with animation data, instructions, annotations
- `assemblyTool` - Tool library (wrenches, screwdrivers, etc.)
- `assemblyTorqueSpec` - Torque specification library with tolerances
- `assemblyStandardNote` - Reusable standard notes library (tribal knowledge, safety warnings)
- `assemblyPartAssociation` - Part matching rules for auto-applying tribal knowledge
- `assemblyAssociationUsage` - Learning system usage tracking
- `assemblyShareLink` - Shareable link tokens with expiration and password protection

**RLS Policies:**
- All tables protected by company-based RLS using `get_companies_with_employee_permission()`
- Permission scopes: `assembly_view`, `assembly_create`, `assembly_update`, `assembly_delete`

#### Rust Physics Simulator (`packages/cad-rust/`)
New Rust workspace for CAD processing and physics simulation:

**Crates:**
- `cad-common` - Shared types (Position3D, BoundingBox, Transform4x4, AssemblyNode, SimulationResult)
- `cad-parser` - STEP file parsing (placeholder for truck-stepio integration)
- `cad-simulator` - Assembly-by-disassembly physics simulation using rapier3d/parry3d
- `cad-server` - HTTP API server (Axum) with `/health`, `/parse`, and `/simulate` endpoints
- `cad-wasm` - Browser WASM module for client-side animation interpolation

**Physics Simulation:**
- Assembly-by-disassembly algorithm for sequence generation
- 6-direction removal testing (+X, -X, +Y, -Y, +Z, -Z)
- Collision detection using parry3d
- Gravitational stability checking
- AABB-based bounding box calculations

**WASM Module:**
- `Keyframe` struct for animation data
- `interpolate_keyframes()` - Slerp for rotation, lerp for position/scale
- `to_matrix4()` - Convert transforms to 4x4 matrix (WebGL format)
- `ease_in_out()` - Smooth animation easing
- `ExplodedViewConfig` - Exploded view generation
- `calculate_exploded_position()` - Part explosion calculations

#### CAD Service - OpenCascade Integration (`packages/cad-service/`)
Python microservice using PythonOCC (OpenCascade) for production-grade STEP file parsing:

**Architecture:**
- FastAPI application with `/parse` and `/health` endpoints
- Docker container with conda-based PythonOCC installation
- Deployed as internal ECS service (called by Trigger.dev jobs)

**Core Features:**
- STEP file parsing using XCAF reader (full assembly support)
- B-Rep to triangle mesh tessellation (BRepMesh_IncrementalMesh)
- glTF/GLB export for browser viewing (xeokit GLTFLoaderPlugin)
- Assembly hierarchy extraction with colors and transforms
- Configurable tessellation tolerance (linear/angular)

**Files:**
- `src/main.py` - FastAPI application
- `src/parser.py` - PythonOCC STEP parsing with STEPCAFControl_Reader
- `src/gltf_writer.py` - GLB binary format export
- `Dockerfile` - conda-based container with pythonocc-core 7.7.2
- `docker-compose.yml` - Local development setup

**Trigger.dev Integration:**
- `step-parser-occ.ts` - New task for OpenCascade parsing workflow
  - Progress tracking with `metadata.set()` (0-100%)
  - Downloads STEP from Supabase Storage
  - Uploads GLB to `{companyId}/assembly/{projectId}/model.glb`
  - Updates `assemblyProject` with hierarchy and modelPath
- `assembly-simulate.ts` - New task for physics simulation
  - Fetches assemblyProject's assemblyTree
  - Calls Rust cad-server `/simulate` endpoint
  - Creates `assemblyStep` records from simulation result
  - Updates project status to "editing"

**Database Migration:**
- `20260125131824_assembly-project-opencascade.sql` - Adds `modelPath`, `parsingProgress`, `parsingError` columns

**Deployment:**
- Added `CarbonCADService` to `sst.config.ts`
- 1 vCPU, 4 GB memory (CAD processing requirements)
- Auto-scaling 1-5 instances

**Instruction Editor (`projects.$id.edit.tsx`):**
- Implemented step saving with action function
- Upserts assemblyStep records to database
- Updates project timestamp on save
- Loading state indicator on Save button

### Changed

#### Root `package.json`
- Added `dev:assembly` script for running the assembly app on port 3002

### Fixed

#### Rust Physics Simulator (`packages/cad-rust/`)
- Fixed unsafe `.unwrap()` calls in `cad-simulator/src/simulator.rs`
- Fixed unsafe `.unwrap()` calls in `cad-parser/src/mesh_converter.rs`
- Replaced with safe pattern matching and error handling

---

## How to Use

### Development

```bash
# Start assembly app
npm run dev:assembly

# Build Rust components
cd packages/cad-rust
cargo build --release

# Build WASM module
wasm-pack build packages/cad-rust/cad-wasm --target web
```

### Database

```bash
# Apply migrations
npm run db:migrate
```
