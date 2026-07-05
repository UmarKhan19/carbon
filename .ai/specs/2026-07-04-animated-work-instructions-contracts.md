# Animated Work Instructions — Shared Contracts (Phase 0)

These contracts bind three components: the geometry service (`services/geometry`,
Python), the viewer (`packages/viewer`, TypeScript), and the ERP/Inngest layer.
Change them only by updating all three.

## 1. Stable node IDs

Every part instance in the assembly gets a stable `nodeId`:

```
nodeId = sha1(geometryHash : parentPath : siblingOrdinal)[:16]
```

- `geometryHash`: sha1 of the part's tessellated geometry (vertex positions quantized
  to 1e-3 mm, triangle indices), independent of placement.
- `parentPath`: '/'-joined product names from root to parent.
- `siblingOrdinal`: 0-based index among siblings sharing the same geometryHash and
  parent (disambiguates 4 identical brackets).

The `nodeId` appears in (a) glTF node `extras.nodeId`, (b) `graph.json` nodes,
(c) `assemblyInstructionStep.partNodeIds`.

## 2. graph.json (written by /convert)

```jsonc
{
  "version": 1,
  "unit": "mm",                  // normalized output unit (always mm in Phase 0)
  "sourceUnit": "inch",          // unit declared in the STEP file
  "partCount": 42,               // count of leaf instances
  "root": {                      // assembly tree, root has no geometry
    "nodeId": "a1b2c3d4e5f60718",
    "name": "MAIN-ASSY",
    "isAssembly": true,
    "geometryHash": null,        // null for assemblies
    "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], // local, column-major 4x4
    "bbox": { "min": [0,0,0], "max": [100,50,25] },     // world-space, mm
    "volume": 1234.5,            // mm^3, leaf nodes only (null for assemblies)
    "color": [0.5, 0.5, 0.5, 1], // RGBA 0-1 or null
    "children": [ /* same shape */ ]
  }
}
```

## 3. Geometry service API

Auth: `Authorization: Bearer <GEOMETRY_SERVICE_API_KEY>` (shared secret env var on
both sides).

### POST /convert
```jsonc
// request
{
  "jobId": "string",                  // assemblyPlanJob.id, used in logs
  "source": { "url": "https://signed-get-url", "format": "step" },
  "outputs": {
    "glb":   { "url": "https://signed-put-url" },
    "graph": { "url": "https://signed-put-url" }
  },
  "options": { "linearDeflection": 0.1, "angularDeflection": 0.5 } // optional
}
// response 200 (synchronous in Phase 0; Inngest applies its own timeout/retries)
{ "ok": true, "partCount": 42, "unit": "mm", "stats": { "convertMs": 1234, "meshTriangles": 100000 } }
// response 4xx/5xx
{ "ok": false, "error": "human-readable message", "code": "READ_FAILED" | "TESSELLATION_FAILED" | "UPLOAD_FAILED" | "INVALID_INPUT" | "LIMIT_EXCEEDED" | "BUSY" }
// status mapping: 400 INVALID_INPUT (incl. URL policy violations), 413
// LIMIT_EXCEEDED (source size / part count), 422 READ_FAILED, 429 BUSY (no
// conversion slot free — caller should retry with backoff), 500
// TESSELLATION_FAILED, 502 UPLOAD_FAILED.
```

### GET /health → `{ "ok": true, "version": "x.y.z" }`

### POST /plan

Computes a collision-free insertion motion for every leaf part plus a
constraint-consistent assembly sequence. Re-tessellates the same STEP source
with the same nodeId derivation as /convert, so plan.json keys join against
graph.json and GLB extras.

Pipeline (v2): classify named fasteners (symmetry axis + threaded mates — the
parts they deeply interpenetrate when seated) → rigid-merge pairs that can
never separate (deep non-threaded interpenetration, or full containment such
as embedded logo/text solids) → greedy disassembly for motions → precedence
DAG + preference topo sort for the order → forward verification.

```jsonc
// request
{
  "jobId": "string",
  "source": { "url": "https://signed-get-url", "format": "step" },
  // `outputs` is OPTIONAL and normally omitted. The planner can run for
  // minutes — longer than a pre-signed upload URL's 60s TTL — so the caller
  // persists the plan from the response body instead. When supplied, the
  // service also uploads plan.json to outputs.plan.url (best-effort).
  "outputs": { "plan": { "url": "https://signed-put-url" } },
  "options": {                       // all optional
    "linearDeflection": 0.1,
    "angularDeflection": 0.5,
    "clearance": 0.5,                // mm of required clearance along the path
    "pathSamples": 60                // collision checks per candidate path
  }
}
// response 200 — `plan` is the plan.json document, returned inline for the
// caller to persist.
{ "ok": true, "partCount": 31, "plannedCount": 30,
  "plan": { "version": 2, "unit": "mm", "sequence": ["..."], "parts": { } },
  "stats": { "planMs": 8000, "verifiedCount": 30,
             "tiers": { "linear": 25, "l": 2, "escape": 1, "group": 1, "flagged": 1, "forced": 0, "unplanned": 0 },
             "warnings": [] } }
// errors: same codes/status mapping as /convert
```

Motion tiers: 1 = straight-line removal (the part's symmetry axis first, then
the six world axes; **named fasteners only ever exit along their bore axis**,
with contacts against their threaded mate allowed up to the seated
interference — there is no blanket penetration allowance, so thin blockers
can never be tunneled), 2 = fixed lift-then-slide "L", 3 = adaptive
multi-segment escape (BFS over axis-aligned hops), group = subassembly
extraction in stuck states (mutually interlocked parts that remove as one
unit — members share one step and one motion), flagged = **no collision-free
escape exists: motion stays "none"**, blockers are recorded, and the viewer
fades the parts in at the seated pose. The planner never fabricates a motion
through geometry; `tiers.forced` is always 0 and remains only for stats
compatibility.

Sequence: after motions are chosen (per part: the least-entangling clear
direction — fewest full-assembly sweep blockers, natural-axis order as the
tiebreak; recorded travel is "reach free space", not exit-the-bounding-box),
the order comes from a precedence DAG topologically sorted with
preferences.

Hard edges, all cycle-guarded:
- **Derived**: U before X when X's seated body blocks U's insertion sweep.
- **Joint**: everything a fastener joins — threaded mates plus every part
  whose material radially surrounds its shank (ring-containment probes at
  the shank radius, just outside the candidate's own bore, and at the
  bore-rim height) — installs before it; the one inversion is a disc mate
  (nut) after its rod fastener. Washer-before-bolt is therefore
  unconditional, slip fits and counterbores included.
- **Joint-stack**: a joint's members order by WHERE they engage the shank,
  tip → head (head = the fastener's geometrically widest end) — the bolt
  clamps the head-side part onto the tip-side part, across CAD air gaps.
- **Support**: for mostly-vertical structure-structure seated contact
  (hemisphere-aligned normals), the lower part precedes the upper.

Preferences, in order: the base first (the biggest part survives greedy
disassembly by design); runs of identical parts kept together; **securing
fasteners** — those whose joint contains a through-part that is neither
their threaded mate nor the base — immediately after their joint
completes (anchor bolts into the skeleton take no jump); then structure
big → small by MATERIAL volume (watertight mesh volume, else the sum of
watertight split bodies, else bbox — bboxes lie for tilted and
wrap-around parts), with horizontal centrality as the tiebreak.

Fastener axes come from an evidence cascade: own symmetry (SVD) → bbox
shape → thread-mate contact band → the full seated contact cloud → the
dominant contact normal; along its bore axis a fastener keeps sliding
engagement with its joint (allowances capped at seated interference /
mesh tolerance). Collision tolerance scales with tessellation:
max(0.15mm, 2.5 × linearDeflection).

Unresolvable geometry is handled by evidence, never fabrication: a stuck
part blocked by exactly ONE other (captive SEMS washers, coincident CAD
variants) rigid-merges into it (`mergedInto`); mutually interlocked sets
that clear together become subassembly `groups`; anything else is flagged
with its real sweep blockers. Finally the whole sequence is
forward-verified: each part's insertion is re-checked against exactly the
parts present at that point; failures demote to flagged
(`verified: false`).

plan.json (returned inline as the response `plan`; the caller persists it):

```jsonc
{
  "version": 2,
  "unit": "mm",
  "sequence": ["nodeId", "..."],     // constraint-consistent assembly order; [0] is the base
  "parts": {
    "<nodeId>": {
      "motion": { /* INSERTION motion per §4 (removal reversed) */ },
      "confidence": "high" | "low",
      "removalDirection": [0, 0, 1], // unit vector, removal sense
      "tier": "linear" | "L" | "escape" | "group" | "flagged" | "base",
      "verified": true,              // forward-verified against its predecessors
      "blockedBy": ["nodeId"],       // flagged parts: what obstructs them
      "groupId": "g1",               // subassembly members (see groups)
      "mergedInto": "nodeId"         // rigidly merged: rides the host's step
    }
  },
  "groups": {                        // subassembly units (optional)
    "g1": { "partNodeIds": ["nodeId", "..."], "motion": { /* shared */ } }
  },
  "warnings": ["..."]                // one entry per flagged part / merge / skipped preference
}
```

All v2 fields are optional additions — version-1 files keep parsing everywhere.

Editor semantics: when a step's `partNodeIds` change, motion is auto-filled
from plan.json (single part → its motion; multiple parts → the shared motion
if all agree, else the first part's motion with confidence low). Parts the
plan flagged are never auto-filled — their recorded motion is "none" and the
editor shows the blockers. When the plan has nothing for the parts,
`synthesizeFallbackMotion` (`@carbon/viewer`) derives an AABB-based motion
from graph.json so the step still animates; the manual motion form is an
override, only shown on demand. `buildAssemblyStepGroups` (`@carbon/viewer`)
turns a plan into draft step groups: sequence order, consecutive identical
parts merged, subassembly units one step, merged parts riding their host's
step, flagged parts stored with motion "none" plus a
`warnings: { flagged, blockedBy }` payload on `assemblyInstructionStep`.
"Generate Steps" refuses while steps exist; `mode=regenerate` replaces them,
guarded against manually authored (`planConfidence: "manual"`) or Done steps.

### Operational limits (service env vars)

- `GEOMETRY_MAX_SOURCE_MB` (default 250) — source download cap
- `GEOMETRY_MAX_PARTS` (default 5000) — leaf instances, checked before meshing
- `GEOMETRY_MAX_CONCURRENCY` (default 2) — conversion slots per worker; excess → 429 BUSY
- `GEOMETRY_ALLOWED_URL_HOSTS` (optional, comma-separated) — allowlist for
  source/output URL hosts (set to the Supabase storage host in production)
- `GEOMETRY_DEV_MODE=true` — permits http URLs and unauthenticated access when
  no API key is set (local dev only)

## 4. Step motion JSON (`assemblyInstructionStep.motion`)

Describes the **insertion** motion of the step's parts into the assembly. The viewer
derives removal (the reverse) and start poses from it. Distances in mm, in the same
world space as the GLB.

```jsonc
// linear insertion along a vector
{ "type": "linear", "direction": [0, 0, -1], "distance": 80 }

// multi-segment (2+, insertion order), e.g. slide then drop; the tier-3
// escape planner emits up to 3 segments and the viewer interpolates any count
{ "type": "L",
  "segments": [
    { "direction": [1, 0, 0], "distance": 60 },
    { "direction": [0, 0, -1], "distance": 20 }
  ] }

// threaded fastener: helix about axis, then it is seated
{ "type": "helix", "axis": [0, 0, -1], "origin": [10, 20, 5],
  "pitch": 0.8, "turns": 6, "approach": 30 } // approach = linear travel before threading

// explicit keyframe path (planner tier 5 / manual freeform)
{ "type": "path", "keyframes": [
    { "t": 0,   "position": [0,0,100], "quaternion": [0,0,0,1] },
    { "t": 1,   "position": [0,0,0],   "quaternion": [0,0,0,1] }
  ] }

// no geometry motion (process-only step: cure, inspect, torque pattern)
{ "type": "none" }
```

`camera` JSON: `{ "position": [x,y,z], "target": [x,y,z], "fov": 45 }` or `null`
(viewer auto-frames the active parts).

`fastener` JSON: `{ "spec": "M5 SHCS", "count": 4, "torqueNm": 8, "tool": "4mm hex" }`
(all fields optional).

## 5. Viewer step shape (props of AssemblyPlayer)

```ts
type AssemblyStep = {
  id: string;
  title: string | null;
  instructionText: string | null; // derived plain-text snapshot of the step's
                                  // rich-text `description` (tiptap JSON)
  partNodeIds: string[];     // parts installed in this step
  motion: Motion;            // section 4
  camera: CameraPose | null;
  fastener: Fastener | null;
};
```

The DB row behind this carries more authoring data than the viewer consumes:
`assemblyInstructionStep` also has the typed-step fields mirrored from
`jobOperationStep` (`type` `procedureStepType`, `description` tiptap JSON,
`required`, `unitOfMeasureCode`, `minValue`/`maxValue`, `listValues`,
`fileTypes`) so steps can eventually be copied into job operations, and
BOM-part associations live in `assemblyInstructionStepMaterial`
(`stepId` → `itemId` + optional quantity; stored by itemId so links survive
make-method re-versioning).

Playback semantics for step k (0-based): parts of steps < k are shown solid in final
pose; parts of step k animate per `motion` (looping); parts of steps > k are hidden
(or ghosted when the "x-ray" toggle is on). Parts in no step are always shown solid
(base/fixture parts).
