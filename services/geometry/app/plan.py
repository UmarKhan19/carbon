"""Assembly-by-disassembly motion planner.

Computes a collision-free removal motion for every leaf part plus a greedy
assembly sequence (see docs/specs/animated-work-instructions-contracts.md,
POST /plan). The same STEP source is re-tessellated with the same nodeId
derivation as /convert, so plan.json keys join against graph.json and the
GLB extras.

Pipeline (per .ai/research/animated-work-instructions.md):
- Classify: named fasteners get their symmetry axis and their threaded
  mates (parts they deeply interpenetrate at the seated pose — a solid
  screw model geometrically interferes with its nut/tapped hole even
  though it unscrews in reality). Collision checks along the fastener's
  own axis ignore contacts with those mates ONLY — there is no blanket
  penetration allowance, so thin blockers can never be tunneled through.
- Merge: non-threaded pairs that deeply interpenetrate when seated
  (embedded logo solids, press fits) can never separate by rigid motion;
  they plan as one rigid unit and members record `mergedInto`.
- Tier 1: greedy disassembly testing straight-line candidate directions
  (the part's symmetry axis first, then world axes; named fasteners only
  ever exit along their bore axis). A path is clear when densely sampled
  collision checks stay within a small surface-contact tolerance.
- Tier 2: two-segment "L" motions (lift then slide) for tier-1 failures.
- Tier 3: adaptive multi-segment escape search (BFS over axis-aligned
  hops, each hop as far as the free space allows). Emits a multi-segment
  "L" motion.
- Flagged: when no collision-free escape exists the part keeps motion
  "none" with its blockers recorded — the viewer fades it in at the
  seated pose. The planner never fabricates a motion through geometry.

Only the base part (the last one standing in the greedy disassembly, the
first in the assembly sequence) keeps motion "none" with no flag — it is
placed, not inserted.

The recorded motion is the INSERTION motion (removal reversed), matching
the viewer contract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.convert import (
    AssemblyNode,
    _assign_node_ids,
    _build_tree,
    _compute_world_bboxes,
    _read_step,
)
from app.errors import ConvertError

PLAN_VERSION = 3
OUTPUT_UNIT = "mm"

# Allowed surface penetration (mm) along a removal path. Parts in contact at
# the seated pose report hairline collisions; sliding fits (pin in bore)
# stay in surface contact for most of their travel. Collision truth is only
# as sharp as the mesh: two mating curved surfaces tessellated at linear
# deflection d can read up to ~2d of phantom penetration, so the effective
# tolerance scales with the deflection used to mesh the model.
PENETRATION_TOLERANCE_MM = 0.15


def _mesh_tolerance(linear_deflection: float) -> float:
    return max(PENETRATION_TOLERANCE_MM, 2.5 * float(linear_deflection))

# Margin (mm) past the assembly bounds before a part counts as "out".
EXIT_MARGIN_MM = 5.0

# Densify sampling on long paths: never step more than this between
# collision checks, or thin features (washers, flanges) slip between
# samples and produce false "removable" results that scramble the sequence.
MAX_SAMPLE_SPACING_MM = 2.0
MAX_PATH_SAMPLES = 400

# Seated interpenetration deeper than this marks a threaded mate for a
# fastener: solid screw models interfere with their nuts/tapped holes by
# roughly the thread depth. While the fastener travels along its own axis,
# contacts with the mate are allowed up to the seated depth plus a margin
# (the steady thread interference); every other contact is judged by the
# strict tolerance, so nothing can tunnel through thin blockers.
MATE_MIN_DEPTH_MM = 0.2
MATE_DEPTH_MARGIN_MM = 0.3

# Rigid merging is evidence-based, never depth-based: coincident duplicate
# shells (containment-grade bbox overlap + full-rank contact-normal tensor)
# and fully-embedded solids (containment test — they produce NO surface
# contacts). Deep local interpenetration alone is NOT a merge signal: a
# spring plunger embeds millimeters into its detent yet must stay separate.

FASTENER_NAME_RE = re.compile(
    r"(?i)\b(screw|bolt|nut|washer|rivet|stud|dowel|pin)\b"
    r"|\bM\d+(x[\d.]+)?\b"
    r"|\bDIN ?\d+|\bISO ?\d+"
)

# Tier-3 escape search bounds: BFS over axis-aligned hops. Each expansion
# costs dense collision sampling, so the search is tightly capped.
MAX_ESCAPE_SEGMENTS = 3
MAX_ESCAPE_EXPANSIONS = 24
# A hop must move the part at least this fraction of its own diagonal to
# count as progress (avoids micro-hops that explode the search space).
MIN_HOP_FRACTION = 0.25

# Subassembly extraction bounds (stuck states only): interlocked parts —
# a keyed hub, a slider with its captive lock — often remove cleanly as a
# unit. Candidate groups grow from a seed part through a PROXIMITY graph
# (inflated bboxes): clearance fits produce no surface contacts, so a
# contact graph would miss exactly the relationships that interlock.
MAX_GROUP_SIZE = 4
MAX_GROUP_TESTS = 40
GROUP_PROXIMITY_MM = 2.0


def _is_fastener(part: "_Part") -> bool:
    return bool(FASTENER_NAME_RE.search(part.name or ""))

WORLD_AXES = [
    np.array([0.0, 0.0, 1.0]),
    np.array([0.0, 0.0, -1.0]),
    np.array([1.0, 0.0, 0.0]),
    np.array([-1.0, 0.0, 0.0]),
    np.array([0.0, 1.0, 0.0]),
    np.array([0.0, -1.0, 0.0]),
]


@dataclass
class _Part:
    node_id: str
    name: str
    mesh: "object"  # trimesh.Trimesh, world space
    bbox_min: np.ndarray
    bbox_max: np.ndarray
    is_proxy: bool
    # Seated contact normals with neighbors — the natural separation
    # directions (filled by _plan_parts from the seated broadphase pass)
    contact_normals: list = field(default_factory=list)


@dataclass
class _FastenerInfo:
    """A classified fastener: its insertion axis and its threaded mates.

    `mates` maps mate nodeId → seated interpenetration depth (mm), the
    steady thread interference a travelling fastener is allowed to keep.
    `kind` distinguishes rod-like (bolts, screws, pins) from disc-like
    (nuts, washers) — it decides which side of a threaded pair installs
    first (bolt before nut).
    """

    axis: np.ndarray
    mates: dict[str, float] = field(default_factory=dict)
    kind: str | None = None  # "rod" | "disc" | None
    # Shank radius (mm) — thread radius from mate contacts, else the thin
    # radial band of the part's own vertices. Drives joint detection.
    shank_radius: float | None = None
    # Joint through-parts (clearance holes, counterbores): while travelling
    # along its own axis the fastener may keep sliding contact with them —
    # a snug counterbore reads as shallow phantom penetration on a
    # tessellated mesh. Allowance value, like mates, is depth before the
    # shared margin applies.
    sliding: dict[str, float] = field(default_factory=dict)


@dataclass
class PlannedPart:
    node_id: str
    motion: dict
    confidence: str | None  # "high" | "low" | None for unplanned
    removal_direction: list[float] | None
    blocked_by: list[str] = field(default_factory=list)
    # "linear" | "L" | "escape" | "group" | "flagged" | "base"
    tier: str | None = None
    # Forward-verified: the insertion path is collision-free against the
    # parts present at that point in the final sequence
    verified: bool = False
    # Members of a subassembly unit share a groupId (one step, one motion)
    group_id: str | None = None


@dataclass
class PlanResult:
    plan: dict
    part_count: int
    planned_count: int
    tiers: dict
    warnings: list[str]
    verified_count: int = 0


def plan_step(
    step_path: Path,
    linear_deflection: float = 0.1,
    angular_deflection: float = 0.5,
    clearance: float = 0.5,
    path_samples: int = 60,
    max_parts: int | None = None,
    units: list[dict] | None = None,
) -> PlanResult:
    """Plan removal motions and an assembly sequence for a STEP file.

    ``units`` pre-groups leaf nodeIds (e.g. a purchased PCB's hundreds of tiny
    solids) into single rigid bodies: each multi-member unit is merged into one
    collision mesh for planning, then expanded back to its member leaves at
    emission (they share one step and one motion). This is what keeps a 400-part
    model — really ~7 assembled units — from being planned as 400 loose bodies.
    """
    try:
        import trimesh
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise ConvertError(
            "TESSELLATION_FAILED", f"collision libraries unavailable: {exc}"
        ) from exc

    warnings: list[str] = []
    doc = _read_step(step_path)
    root = _build_tree(doc, linear_deflection, angular_deflection, warnings)
    _assign_node_ids(root)
    _compute_world_bboxes(root, np.eye(4))

    parts = _collect_world_parts(root, trimesh)
    leaf_count = len(parts)
    expansion: dict[str, dict] = {}
    if units:
        parts, expansion = _merge_units(parts, units, trimesh)

    # The limit applies to the bodies actually planned (post-merge), not the raw
    # leaf count — a PCB's 300 internal solids collapse to one body.
    if max_parts is not None and len(parts) > max_parts:
        raise ConvertError(
            "LIMIT_EXCEEDED",
            f"assembly has {len(parts)} part instances; the limit is {max_parts}",
            413,
        )
    if any(part.is_proxy for part in parts):
        warnings.append(
            "some parts use bounding-box proxy meshes; their motions are low confidence"
        )

    outcome = _plan_parts(
        parts,
        trimesh,
        clearance=clearance,
        path_samples=path_samples,
        warnings=warnings,
        tolerance=_mesh_tolerance(linear_deflection),
    )

    # Expand merged units back to their member leaves: each member carries the
    # unit's motion + groupId, and the unit is one entry in `groups` (with its
    # name) so the viewer/step generator render it as a single step.
    groups: dict = dict(outcome.groups)
    plan_parts_payload: dict = {}
    for entry in outcome.planned:
        unit = expansion.get(entry.node_id)
        if unit is None:
            plan_parts_payload[entry.node_id] = _part_to_dict(entry)
            continue
        member_payload = _part_to_dict(entry)
        member_payload["groupId"] = entry.node_id
        for member in unit["members"]:
            plan_parts_payload[member] = dict(member_payload)
        group_payload: dict = {
            "partNodeIds": unit["members"],
            "motion": entry.motion,
        }
        if unit.get("name"):
            group_payload["name"] = unit["name"]
        groups[entry.node_id] = group_payload

    for member, rep in outcome.merged_into.items():
        plan_parts_payload[member] = {
            "motion": {"type": "none"},
            "mergedInto": rep,
        }

    sequence: list[str] = []
    for node_id in outcome.sequence:
        unit = expansion.get(node_id)
        if unit is None:
            sequence.append(node_id)
        else:
            sequence.extend(unit["members"])

    plan = {
        "version": PLAN_VERSION,
        "unit": OUTPUT_UNIT,
        "sequence": sequence,
        "parts": plan_parts_payload,
        "warnings": warnings,
    }
    if groups:
        plan["groups"] = groups
    planned_count = sum(
        1 for entry in outcome.planned if entry.motion.get("type") != "none"
    )
    return PlanResult(
        plan=plan,
        part_count=leaf_count,
        planned_count=planned_count,
        tiers=outcome.tiers,
        warnings=warnings,
        verified_count=outcome.verified_count,
    )


def _merge_units(
    parts: list[_Part], units: list[dict], trimesh_mod
) -> tuple[list[_Part], dict[str, dict]]:
    """Merge each multi-member unit's leaf meshes into one rigid collision body.

    Returns the reduced parts list (unit bodies replace their members) plus an
    expansion map ``unit_id -> {"members": [...], "name": str | None}`` used to
    re-expand the plan afterward. Single-member units are left untouched.
    """
    by_id = {p.node_id: p for p in parts}
    expansion: dict[str, dict] = {}
    consumed: set[str] = set()
    merged: list[_Part] = []

    for unit in units:
        unit_id = unit.get("id")
        node_ids = unit.get("nodeIds") or []
        members = [
            nid for nid in node_ids if nid in by_id and nid not in consumed
        ]
        if not unit_id or len(members) <= 1:
            continue  # nothing to merge; the single leaf plans as itself

        combined = trimesh_mod.util.concatenate([by_id[nid].mesh for nid in members])
        bbox_min = np.min([by_id[nid].bbox_min for nid in members], axis=0)
        bbox_max = np.max([by_id[nid].bbox_max for nid in members], axis=0)
        merged.append(
            _Part(
                node_id=unit_id,
                name=unit.get("name") or by_id[members[0]].name,
                mesh=combined,
                bbox_min=bbox_min,
                bbox_max=bbox_max,
                is_proxy=any(by_id[nid].is_proxy for nid in members),
            )
        )
        expansion[unit_id] = {"members": members, "name": unit.get("name")}
        consumed.update(members)

    remaining = [p for p in parts if p.node_id not in consumed]
    return remaining + merged, expansion


@dataclass
class _PlanOutcome:
    planned: list[PlannedPart]
    sequence: list[str]
    tiers: dict
    merged_into: dict[str, str]
    # groupId → { partNodeIds, motion } for subassembly units
    groups: dict = field(default_factory=dict)
    verified_count: int = 0
    # U → set of X meaning U must assemble before X (diagnostics)
    edges: dict = field(default_factory=dict)


def _plan_parts(
    parts: list[_Part],
    trimesh_mod,
    clearance: float,
    path_samples: int,
    warnings: list[str] | None = None,
    tolerance: float = PENETRATION_TOLERANCE_MM,
    debug_trace: list | None = None,
) -> _PlanOutcome:
    """The full pipeline over world-space parts.

    Classification → rigid merge → greedy disassembly (motions) →
    precedence DAG + preference topo sort (order) → forward verification.
    Greedy alone yields a valid but arbitrary-reading order; the topo sort
    re-orders freely within the collision constraints derived from the
    final motions (bottom-up, fasteners right after the parts they secure,
    identical parts adjacent).
    """
    if warnings is None:
        warnings = []

    pair_depths = _seated_pair_depths(parts, trimesh_mod)
    parts_by_id = {part.node_id: part for part in parts}
    for _pair, (_depth, _points, normals, _tensor, _bounds) in pair_depths.items():
        for node_id in _pair:
            part = parts_by_id.get(node_id)
            if part is None or len(part.contact_normals) >= 128:
                continue
            part.contact_normals.extend(normals)
    fasteners = _classify_fasteners(parts, pair_depths)
    units, merged_into = _merge_rigid_groups(
        parts, pair_depths, fasteners, trimesh_mod, warnings
    )

    # Joints run over the original parts (merged meshes are soups that
    # break containment tests), then remap members through the merges.
    # Known BEFORE motion planning: a fastener travelling its bore axis is
    # allowed sliding engagement with its joint members.
    joints = _fastener_joints(parts, fasteners)
    if merged_into:
        remapped: dict[str, dict[str, float]] = {}
        for fastener_id, members in joints.items():
            if fastener_id in merged_into:
                continue
            entry: dict[str, float] = {}
            for member, projection in members.items():
                unit = merged_into.get(member, member)
                if unit == fastener_id:
                    continue
                if unit not in entry or abs(projection) < abs(entry[unit]):
                    entry[unit] = projection
            remapped[fastener_id] = entry
        joints = remapped
    for fastener_id, members in joints.items():
        info = fasteners.get(fastener_id)
        if info is None:
            continue
        for member in members:
            if member not in info.mates:
                info.sliding[member] = tolerance

    # Parts with a deep external bite (embedded collars, interference
    # beyond thread scale) poison any group they join — deprioritize them
    # as group members so clean pairs get tried first
    deep_bitten: set[str] = set()
    for pair, (depth, _p, _n, _t, _b) in pair_depths.items():
        if depth > 1.0:
            for node_id in pair:
                info = fasteners.get(node_id)
                (other,) = pair - {node_id}
                if info is not None and other in info.mates:
                    continue
                deep_bitten.add(node_id)

    group_units: dict[str, tuple[_Part, list[str]]] = {}
    late_merges: dict[str, str] = {}
    planned, greedy_sequence, _greedy_tiers = _greedy_disassembly(
        units,
        trimesh_mod,
        clearance=clearance,
        path_samples=path_samples,
        warnings=warnings,
        fasteners=fasteners,
        group_units=group_units,
        tolerance=tolerance,
        late_merges=late_merges,
        deep_bitten=deep_bitten,
    )
    if late_merges:
        # Chase chains (A merged into B, B later merged into C)
        for member, host in list(late_merges.items()):
            while host in late_merges:
                host = late_merges[host]
            late_merges[member] = host
        merged_into = {**merged_into, **late_merges}

    # Subassembly units replace their members for ordering/verification:
    # the combined mesh moves as one body under the representative's id
    units_by_id = {unit.node_id: unit for unit in units}
    for member in late_merges:
        units_by_id.pop(member, None)
    for rep_id, (combined, members) in group_units.items():
        units_by_id[rep_id] = combined
        for member_id in members:
            if member_id != rep_id:
                units_by_id.pop(member_id, None)

    planned_by_id = {entry.node_id: entry for entry in planned}

    edges = _derive_precedence(
        planned, units_by_id, trimesh_mod, fasteners, path_samples, tolerance
    )
    _add_joint_edges(fasteners, joints, units_by_id, edges, warnings)
    _add_support_edges(parts, pair_depths, fasteners, merged_into, edges, warnings)
    sequence = _preference_topo_sort(
        planned,
        units_by_id,
        edges,
        fasteners,
        joints,
        greedy_sequence,
        warnings,
        group_members={
            rep_id: members
            for rep_id, (_combined, members) in group_units.items()
        },
        debug_trace=debug_trace,
    )
    _verify_sequence(
        sequence,
        planned_by_id,
        units_by_id,
        trimesh_mod,
        fasteners,
        path_samples,
        warnings,
        tolerance,
    )

    # Expand subassembly units: every member appears in the sequence and in
    # the parts payload with the shared motion and groupId
    groups_payload: dict = {}
    if group_units:
        group_ids = {
            rep_id: f"g{index + 1}"
            for index, rep_id in enumerate(
                rep_id for rep_id in sequence if rep_id in group_units
            )
        }
        expanded_sequence: list[str] = []
        for node_id in sequence:
            if node_id in group_units:
                _combined, members = group_units[node_id]
                expanded_sequence.extend(members)
            else:
                expanded_sequence.append(node_id)
        sequence = expanded_sequence

        for rep_id, (_combined, members) in group_units.items():
            rep_entry = planned_by_id[rep_id]
            group_id = group_ids[rep_id]
            rep_entry.group_id = group_id
            groups_payload[group_id] = {
                "partNodeIds": members,
                "motion": rep_entry.motion,
            }
            for member_id in members:
                if member_id == rep_id:
                    continue
                planned.append(
                    PlannedPart(
                        node_id=member_id,
                        motion=rep_entry.motion,
                        confidence=rep_entry.confidence,
                        removal_direction=rep_entry.removal_direction,
                        blocked_by=list(rep_entry.blocked_by),
                        tier=rep_entry.tier,
                        verified=rep_entry.verified,
                        group_id=group_id,
                    )
                )

    return _PlanOutcome(
        planned=planned,
        sequence=sequence,
        tiers=_tally_tiers(planned),
        merged_into=merged_into,
        groups=groups_payload,
        verified_count=sum(1 for entry in planned if entry.verified),
        edges=edges,
    )


def _tally_tiers(planned: list[PlannedPart]) -> dict:
    """Tier stats from the final planned entries (post-verification)."""
    tiers = {
        "linear": 0,
        "l": 0,
        "escape": 0,
        "group": 0,
        "flagged": 0,
        "forced": 0,
        "unplanned": 0,
    }
    counted_groups: set[str] = set()
    for entry in planned:
        if entry.tier == "linear":
            tiers["linear"] += 1
        elif entry.tier == "L":
            tiers["l"] += 1
        elif entry.tier == "escape":
            tiers["escape"] += 1
        elif entry.tier == "flagged":
            tiers["flagged"] += 1
        elif entry.tier == "group":
            # One count per subassembly unit, not per member
            if entry.group_id is None or entry.group_id not in counted_groups:
                tiers["group"] += 1
                if entry.group_id is not None:
                    counted_groups.add(entry.group_id)
    return tiers


def _part_volume(part: _Part) -> float:
    """Material volume (mm³): mesh volume when watertight, else bbox.

    Bbox volume lies for tilted parts (a 45° bolt inflates 5×) and for
    wrap-around parts (a thin clamp spanning the rail reads as huge).
    """
    cached = getattr(part.mesh, "_carbon_volume", None)
    if cached is not None:
        return cached
    volume = 0.0
    try:
        if part.mesh.is_watertight:
            volume = float(abs(part.mesh.volume))
        else:
            # Multi-body soups (embossed text, concatenated hardware):
            # sum the watertight bodies instead of trusting the bbox
            bodies = part.mesh.split(only_watertight=True)
            if len(bodies) > 0:
                volume = float(sum(abs(body.volume) for body in bodies))
    except Exception:
        volume = 0.0
    if volume <= 1e-9:
        extents = np.abs(part.bbox_max - part.bbox_min)
        volume = float(max(abs(np.prod(extents)), 1e-9))
    part.mesh._carbon_volume = volume
    return volume


def _structural_key(
    part: _Part, centroid: np.ndarray, diagonal: float
) -> tuple[float, float]:
    """Big first (ascending key).

    Material volume descending, then horizontal proximity to the assembly
    centroid in coarse buckets as the tiebreak: the skeleton and major
    components assemble before brackets, hardware, and cosmetics. In
    reverse (negated), disassembly strips small parts first so the biggest
    part survives to become the base.
    """
    center = (part.bbox_min + part.bbox_max) / 2.0
    offset = center - centroid
    distance = float(np.hypot(float(offset[0]), float(offset[1])))
    bucket = round(distance / max(diagonal, 1e-6) * 20.0) / 20.0
    return (-_part_volume(part), bucket)


def _assembly_centroid(parts) -> np.ndarray:
    bbox_min = np.min([part.bbox_min for part in parts], axis=0)
    bbox_max = np.max([part.bbox_max for part in parts], axis=0)
    return (bbox_min + bbox_max) / 2.0


def _removal_segments(motion: dict) -> list[tuple[np.ndarray, float]] | None:
    """A stored INSERTION motion as removal segments (reverse order/sense)."""
    if motion.get("type") == "linear":
        direction = -np.asarray(motion["direction"], dtype=np.float64)
        norm = float(np.linalg.norm(direction)) or 1.0
        return [(direction / norm, float(motion["distance"]))]
    if motion.get("type") == "L":
        segments: list[tuple[np.ndarray, float]] = []
        for segment in reversed(motion["segments"]):
            direction = -np.asarray(segment["direction"], dtype=np.float64)
            norm = float(np.linalg.norm(direction)) or 1.0
            segments.append((direction / norm, float(segment["distance"])))
        return segments
    return None


def _path_blockers(
    part: _Part,
    manager,
    segments: list[tuple[np.ndarray, float]],
    samples: int,
    fasteners: dict[str, _FastenerInfo],
    extra_exempt: dict[str, float] | None = None,
    tolerance: float = PENETRATION_TOLERANCE_MM,
) -> set[str]:
    """Every present unit the part's removal path cuts through.

    Same sampling and mate allowances as `_path_is_clear`, but collects
    all offending partners instead of failing fast. `extra_exempt`
    typically carries the moving part's own registered copy.
    """
    blockers: set[str] = set()
    offset = np.zeros(3)
    for direction, distance in segments:
        exempt = _mate_exempt(part, direction, fasteners)
        if extra_exempt:
            exempt = {**(exempt or {}), **extra_exempt}
        count = min(
            max(samples, int(distance / MAX_SAMPLE_SPACING_MM) + 1),
            MAX_PATH_SAMPLES,
        )
        for s in np.linspace(0.0, distance, count, endpoint=True)[1:]:
            translation = offset + direction * float(s)
            for other, depth in _contacts_at(manager, part, translation):
                if other is None:
                    continue
                if exempt is not None and other in exempt:
                    if depth <= exempt[other] + MATE_DEPTH_MARGIN_MM:
                        continue
                if depth > tolerance:
                    blockers.add(other)
        offset = offset + direction * distance
    return blockers


def _derive_precedence(
    planned: list[PlannedPart],
    units_by_id: dict[str, _Part],
    trimesh_mod,
    fasteners: dict[str, _FastenerInfo],
    path_samples: int,
    tolerance: float = PENETRATION_TOLERANCE_MM,
) -> dict[str, set[str]]:
    """U → X edges: X's seated body blocks U's insertion path, so U must
    be assembled while X is absent (U before X).

    Greedy's own order satisfies every derivable edge — each removal was
    validated against exactly the parts assembled before it — so this
    graph is acyclic with the greedy order as a witness topo order. Any
    other topo order is equally collision-consistent.
    """
    from trimesh.collision import CollisionManager

    manager = CollisionManager()
    for unit in units_by_id.values():
        manager.add_object(unit.node_id, unit.mesh)

    samples_segment = max(12, path_samples // 3)
    edges: dict[str, set[str]] = {entry.node_id: set() for entry in planned}
    for entry in planned:
        segments = _removal_segments(entry.motion)
        if not segments:
            continue
        part = units_by_id[entry.node_id]
        edges[entry.node_id] |= _path_blockers(
            part,
            manager,
            segments,
            samples_segment,
            fasteners,
            extra_exempt={part.node_id: float("inf")},
            tolerance=tolerance,
        )
    return edges


def _add_joint_edges(
    fasteners: dict[str, _FastenerInfo],
    joints: dict[str, dict[str, float]],
    units_by_id: dict[str, _Part],
    edges: dict[str, set[str]],
    warnings: list[str],
) -> None:
    """Everything a fastener joins installs before the fastener.

    Hard edges from the joint sets (through-parts + threaded mates), which
    the collision constraints cannot fully express — a bolt passes through
    clearance holes without touching, so nothing else forces its clamped
    parts to precede it. One exception: a disc mate (nut) installs after
    its rod fastener. Skipped with a warning if an edge would contradict
    the collision DAG.
    """

    def reaches(source: str, target: str) -> bool:
        stack, seen = [source], set()
        while stack:
            node = stack.pop()
            if node == target:
                return True
            if node in seen:
                continue
            seen.add(node)
            stack.extend(edges.get(node, ()))
        return False

    def add_edge(before: str, after: str, label: str) -> None:
        if after in edges[before]:
            return
        if reaches(after, before):
            warnings.append(
                f"{label} preference between '{before}' and "
                f"'{after}' conflicts with collision constraints; skipped"
            )
            return
        edges[before].add(after)

    for fastener_id, info in fasteners.items():
        if fastener_id not in edges:
            continue
        chain: list[str] = []
        for member in joints.get(fastener_id, ()):
            if member not in edges:
                continue
            member_info = fasteners.get(member)
            if (
                member in info.mates
                and member_info is not None
                and info.kind == "rod"
                and member_info.kind == "disc"
            ):
                add_edge(fastener_id, member, "joint-order")  # bolt, then nut
            else:
                add_edge(member, fastener_id, "joint-order")  # joint, then f
                chain.append(member)

        # The joint's members stack tip → head along the fastener's axis:
        # the bolt clamps the head-side part ONTO the tip-side part, so the
        # tip side assembles first (a bracket after the carriage it bolts
        # to, even when their CAD surfaces never touch).
        fastener_part = units_by_id.get(fastener_id)
        if fastener_part is None or len(chain) < 2:
            continue
        head_dir = _head_direction(fastener_part, info, units_by_id)
        # joints store projections along info.axis; orient tip → head
        sign = 1.0 if float(head_dir @ info.axis) >= 0 else -1.0
        member_projection = joints.get(fastener_id, {})

        def head_projection(member: str) -> float:
            return sign * member_projection.get(member, 0.0)

        chain.sort(key=lambda member: (head_projection(member), member))
        for tip_side, head_side in zip(chain, chain[1:]):
            if abs(head_projection(head_side) - head_projection(tip_side)) < 0.5:
                continue
            add_edge(tip_side, head_side, "joint-stack")


def _motion_travel(motion: dict) -> float:
    if motion.get("type") == "linear":
        return float(motion.get("distance", 0.0))
    if motion.get("type") == "L":
        return sum(
            float(segment.get("distance", 0.0))
            for segment in motion.get("segments", [])
        )
    return 0.0


def _add_support_edges(
    parts: list[_Part],
    pair_depths: dict[frozenset, tuple[float, list, list, np.ndarray, np.ndarray]],
    fasteners: dict[str, _FastenerInfo],
    merged_into: dict[str, str],
    edges: dict[str, set[str]],
    warnings: list[str],
) -> None:
    """A part assembles after the parts it rests on.

    For every seated structure-structure contact whose mean normal is
    mostly vertical, the upper part follows the lower one — gravity
    stacking (a bracket after the carriages it sits on, a badge after its
    housing). Fastener pairs are excluded: their order is governed by
    joint edges (a nut hangs BELOW its plate but still installs last).
    Skipped with a warning when an edge would contradict the DAG.
    """
    by_id = {part.node_id: part for part in parts}

    def reaches(source: str, target: str) -> bool:
        stack, seen = [source], set()
        while stack:
            node = stack.pop()
            if node == target:
                return True
            if node in seen:
                continue
            seen.add(node)
            stack.extend(edges.get(node, ()))
        return False

    for pair, (_depth, _points, normals, _tensor, _bounds) in pair_depths.items():
        a, b = tuple(pair)
        if a in fasteners or b in fasteners:
            continue
        unit_a = merged_into.get(a, a)
        unit_b = merged_into.get(b, b)
        if unit_a == unit_b or unit_a not in edges or unit_b not in edges:
            continue
        if not normals:
            continue
        # fcl normal signs follow triangle winding — align to one
        # hemisphere before averaging or opposing windings cancel out
        aligned = np.asarray(normals, dtype=np.float64)
        flip = np.sign(aligned[:, 2:3])
        flip[flip == 0] = 1.0
        mean = np.mean(aligned * flip, axis=0)
        length = float(np.linalg.norm(mean))
        if length <= 1e-9 or abs(float(mean[2] / length)) < 0.5:
            continue
        part_a, part_b = by_id.get(a), by_id.get(b)
        if part_a is None or part_b is None:
            continue
        center_a = float((part_a.bbox_min[2] + part_a.bbox_max[2]) / 2.0)
        center_b = float((part_b.bbox_min[2] + part_b.bbox_max[2]) / 2.0)
        if abs(center_a - center_b) < 1e-6:
            continue
        lower, upper = (
            (unit_a, unit_b) if center_a < center_b else (unit_b, unit_a)
        )
        if upper in edges[lower]:
            continue
        if reaches(upper, lower):
            warnings.append(
                f"support-order preference between '{lower}' and "
                f"'{upper}' conflicts with collision constraints; skipped"
            )
            continue
        edges[lower].add(upper)


def _preference_topo_sort(
    planned: list[PlannedPart],
    units_by_id: dict[str, _Part],
    edges: dict[str, set[str]],
    fasteners: dict[str, _FastenerInfo],
    joints: dict[str, dict[str, float]],
    fallback_order: list[str],
    warnings: list[str],
    group_members: dict[str, list[str]] | None = None,
    debug_trace: list | None = None,
) -> list[str]:
    """Deterministic scored Kahn's sort over the precedence DAG.

    Preferences, in order: the base first; keep runs of identical parts
    together; SECURING fasteners (they pass through the parts they clamp)
    install the moment their joint is complete; corridor-sweepers (long
    insertion travel relative to the assembly) go while their path is
    still open; then big-and-central structure before small/peripheral;
    then bottom-up; nodeId breaks ties. Accessory fasteners — threaded
    mates only, clamping nothing (knobs, set screws) — take no priority
    jump and schedule like small structure.
    """
    units = list(units_by_id.values())
    centroid = _assembly_centroid(units)
    assembly_min = np.min([unit.bbox_min for unit in units], axis=0)
    assembly_max = np.max([unit.bbox_max for unit in units], axis=0)
    diagonal = float(np.linalg.norm(assembly_max - assembly_min)) or 1.0

    # Subassembly units act like fasteners when any member is one (a
    # washer+screw pair is a fastener stack, not a corridor part)
    group_members = group_members or {}
    fastener_units = set(fasteners)
    for rep_id, members in group_members.items():
        if any(member in fasteners for member in members):
            fastener_units.add(rep_id)

    base_id = next(
        (entry.node_id for entry in planned if entry.tier == "base"), None
    )

    def is_securing(node_id: str) -> bool:
        # Securing = clamps a COMPONENT onto the structure (a through-part
        # that is neither its threaded mate nor the base). Anchor bolts
        # whose only through-part is the base itself don't jump the queue.
        for candidate in (node_id, *group_members.get(node_id, ())):
            info = fasteners.get(candidate)
            if info is None:
                continue
            if any(
                member not in info.mates and member != base_id
                for member in joints.get(candidate, ())
            ):
                return True
        return False

    by_id = {entry.node_id: entry for entry in planned}
    predecessors: dict[str, set[str]] = {node_id: set() for node_id in edges}
    for before, afters in edges.items():
        for after in afters:
            predecessors[after].add(before)

    placed: list[str] = []
    placed_set: set[str] = set()
    pending = set(edges.keys())
    previous_identity: tuple | None = None

    def identity(node_id: str) -> tuple:
        entry = by_id[node_id]
        unit = units_by_id[node_id]
        motion = entry.motion
        if motion.get("type") == "linear":
            motion_key = (
                "linear",
                tuple(round(float(c), 3) for c in motion["direction"]),
            )
        elif motion.get("type") == "L":
            motion_key = (
                "L",
                tuple(
                    tuple(round(float(c), 3) for c in segment["direction"])
                    for segment in motion["segments"]
                ),
            )
        else:
            motion_key = (str(motion.get("type")),)
        return (unit.name, motion_key)

    while pending:
        available = [
            node_id
            for node_id in pending
            if predecessors[node_id] <= placed_set
        ]
        if not available:  # cycle — cannot happen for greedy-derived edges
            warnings.append(
                "precedence cycle detected; keeping the greedy order for "
                "the remaining parts"
            )
            placed.extend(
                node_id for node_id in fallback_order if node_id in pending
            )
            break

        def sort_key(node_id: str) -> tuple:
            entry = by_id[node_id]
            unit = units_by_id[node_id]
            return (
                0 if entry.tier == "base" else 1,
                0
                if previous_identity is not None
                and identity(node_id) == previous_identity
                else 1,
                0 if is_securing(node_id) else 1,
                _structural_key(unit, centroid, diagonal),
                float(unit.bbox_min[2]),
                node_id,
            )

        chosen = min(available, key=sort_key)
        if debug_trace is not None:
            ranked = sorted(available, key=sort_key)
            debug_trace.append(
                [(node_id, sort_key(node_id)) for node_id in ranked[:4]]
            )
        placed.append(chosen)
        placed_set.add(chosen)
        pending.remove(chosen)
        previous_identity = identity(chosen)

    return placed


def _verify_sequence(
    sequence: list[str],
    planned_by_id: dict[str, PlannedPart],
    units_by_id: dict[str, _Part],
    trimesh_mod,
    fasteners: dict[str, _FastenerInfo],
    path_samples: int,
    warnings: list[str],
    tolerance: float = PENETRATION_TOLERANCE_MM,
) -> None:
    """Forward replay: each unit's insertion is re-checked against exactly
    the units already present in the final sequence. By construction this
    passes; a failure (numerical edge) demotes the part to flagged rather
    than ever shipping a colliding motion.
    """
    from trimesh.collision import CollisionManager

    manager = CollisionManager()
    samples_segment = max(12, path_samples // 3)
    for node_id in sequence:
        entry = planned_by_id[node_id]
        part = units_by_id[node_id]
        segments = _removal_segments(entry.motion)
        if segments is None:
            entry.verified = entry.tier == "base"
        else:
            blockers = _path_blockers(
                part,
                manager,
                segments,
                samples_segment,
                fasteners,
                tolerance=tolerance,
            )
            if blockers:
                warnings.append(
                    f"'{part.name or node_id}' failed forward verification; "
                    "flagged for review — it fades in during playback"
                )
                entry.motion = {"type": "none"}
                entry.tier = "flagged"
                entry.confidence = "low"
                entry.removal_direction = None
                entry.blocked_by = sorted(blockers)[:8]
                entry.verified = False
            else:
                entry.verified = True
        manager.add_object(node_id, part.mesh)


def _part_to_dict(entry: PlannedPart) -> dict:
    payload: dict = {"motion": entry.motion}
    if entry.confidence is not None:
        payload["confidence"] = entry.confidence
    if entry.removal_direction is not None:
        payload["removalDirection"] = entry.removal_direction
    if entry.blocked_by:
        payload["blockedBy"] = entry.blocked_by
    if entry.tier is not None:
        payload["tier"] = entry.tier
    if entry.group_id is not None:
        payload["groupId"] = entry.group_id
    payload["verified"] = entry.verified
    return payload


def _collect_world_parts(root: AssemblyNode, trimesh_mod) -> list[_Part]:
    parts: list[_Part] = []

    def visit(node: AssemblyNode, parent_world: np.ndarray) -> None:
        local = np.asarray(node.transform, dtype=np.float64).reshape(4, 4).T
        world = parent_world @ local
        if node.mesh is not None and len(node.mesh.positions) > 0:
            positions = node.mesh.positions.astype(np.float64)
            transformed = positions @ world[:3, :3].T + world[:3, 3]
            mesh = trimesh_mod.Trimesh(
                vertices=transformed,
                faces=node.mesh.indices.astype(np.int64),
                process=False,
            )
            parts.append(
                _Part(
                    node_id=node.node_id,
                    name=node.name,
                    mesh=mesh,
                    bbox_min=transformed.min(axis=0),
                    bbox_max=transformed.max(axis=0),
                    is_proxy=node.mesh.is_proxy,
                )
            )
        for child in node.children:
            visit(child, world)

    visit(root, np.eye(4))
    return parts


def _seated_pair_depths(
    parts: list[_Part], trimesh_mod
) -> dict[frozenset, tuple[float, list, list]]:
    """Max depth + contact points + contact normals per touching pair.

    One internal broadphase pass over the whole assembly. Feeds fastener
    mate detection (threaded interference), rigid-group merging, the
    contact-ring axis estimate for stubby fasteners, and the contact-normal
    separation candidates (the mating surfaces say how a part comes apart).
    """
    from trimesh.collision import CollisionManager

    manager = CollisionManager()
    for part in parts:
        manager.add_object(part.node_id, part.mesh)

    pairs: dict[frozenset, tuple[float, list, list, np.ndarray, np.ndarray]] = {}
    is_colliding, _names, contacts = manager.in_collision_internal(
        return_names=True, return_data=True
    )
    if not is_colliding:
        return pairs
    for contact in contacts:
        pair = frozenset(contact.names)
        if len(pair) != 2:
            continue
        depth, points, normals, tensor, bounds = pairs.get(
            pair,
            (
                0.0,
                [],
                [],
                np.zeros((3, 3)),
                np.array([[np.inf] * 3, [-np.inf] * 3]),
            ),
        )
        point = np.asarray(contact.point, dtype=np.float64)
        bounds = np.array(
            [np.minimum(bounds[0], point), np.maximum(bounds[1], point)]
        )
        if len(points) < 64:
            points.append(np.asarray(contact.point, dtype=np.float64))
            normals.append(np.asarray(contact.normal, dtype=np.float64))
        # Uncapped structure tensor over ALL contact normals: the capped
        # lists above fill from one contact region and go rank-deficient;
        # n·nᵀ is also winding-sign invariant
        normal = np.asarray(contact.normal, dtype=np.float64)
        length = float(np.linalg.norm(normal))
        if length > 1e-9:
            unit = normal / length
            tensor = tensor + np.outer(unit, unit)
        pairs[pair] = (
            max(depth, float(contact.depth)),
            points,
            normals,
            tensor,
            bounds,
        )
    return pairs


def _classify_fasteners(
    parts: list[_Part], pair_depths: dict[frozenset, tuple[float, list]]
) -> dict[str, _FastenerInfo]:
    """Symmetry axis + threaded mates for every part with a fastener name.

    A mate is a part the fastener deeply interpenetrates while seated —
    solid-cylinder thread models overlap their nut/tapped hole by roughly
    the thread depth. Contacts with mates are exempt only while the
    fastener travels along its own axis.

    Axis detection is a three-step fallback: SVD symmetry (clean rods and
    discs) → bbox shape (stubby screws) → the mate-contact ring (flange
    heads and knobs whose overall shape hides the bore axis — the thread
    contact points form a cylindrical band whose axis IS the bore).
    """
    fasteners: dict[str, _FastenerInfo] = {}
    for part in parts:
        if not _is_fastener(part):
            continue

        mates: dict[str, float] = {}
        mate_points: list = []
        all_points: list = []
        for pair, (depth, points, _normals, _tensor, _bounds) in pair_depths.items():
            if part.node_id not in pair:
                continue
            all_points.extend(points)
            if depth > MATE_MIN_DEPTH_MM:
                (other,) = pair - {part.node_id}
                mates[other] = depth
                mate_points.extend(points)

        # Axis cascade, strongest evidence first: own shape (SVD, bbox),
        # thread-mate contact band, the FULL seated contact cloud (a knob
        # with clearance threads still seats on a coaxial boss), and
        # finally the dominant contact normal.
        axis_kind = _symmetry_axis_kind(part)
        if axis_kind is None:
            axis_kind = _bbox_axis_kind(part)
        if axis_kind is not None:
            axis, kind = axis_kind
        else:
            ring_axis = _axis_from_contacts(mate_points)
            if ring_axis is None:
                ring_axis = _axis_from_contacts(all_points)
            if ring_axis is None:
                clusters = _normal_clusters(part.contact_normals, top=1)
                ring_axis = clusters[0] if clusters else None
            if ring_axis is None:
                continue
            axis, kind = ring_axis, None

        fasteners[part.node_id] = _FastenerInfo(
            axis=axis,
            mates=mates,
            kind=kind,
            shank_radius=_shank_radius(part, axis, mate_points),
        )
    return fasteners


def _shank_radius(
    part: _Part, axis: np.ndarray, mate_points: list
) -> float | None:
    """The fastener's shank radius around its axis.

    Threaded-mate contact points sit ON the thread surface — their mean
    radial distance IS the thread radius. Without mates, the 25th
    percentile of the part's own radial vertex distances approximates the
    thin band (the shank) below the head.
    """
    center = (part.bbox_min + part.bbox_max) / 2.0
    if len(mate_points) >= 8:
        points = np.asarray(mate_points, dtype=np.float64) - center
        radial = points - np.outer(points @ axis, axis)
        radius = float(np.linalg.norm(radial, axis=1).mean())
    else:
        vertices = np.asarray(part.mesh.vertices, dtype=np.float64)
        if len(vertices) < 8:
            return None
        rel = vertices - center
        radial = rel - np.outer(rel @ axis, axis)
        radius = float(np.percentile(np.linalg.norm(radial, axis=1), 25))
    if radius <= 0.2:
        return None
    return radius


def _fastener_joints(
    parts: list[_Part],
    fasteners: dict[str, _FastenerInfo],
) -> dict[str, dict[str, float]]:
    """The parts each fastener joins → their position along its axis.

    Members are threaded mates plus every part whose material radially
    surrounds the shank (clearance through-holes), each mapped to the
    projection (mm, along info.axis from the fastener center) of WHERE it
    engages the shank — the physical stacking order of the joint.

    Ring-containment test: 8 points on a circle of shankRadius × 1.3
    around the fastener's axis, at three heights across the overlap of the
    fastener's axis span with the candidate's span. A candidate that
    surrounds ≥ 6/8 points at any height is part of the joint — it must be
    installed before the fastener that passes through it.
    """
    by_id = {part.node_id: part for part in parts}
    joints: dict[str, dict[str, float]] = {}

    for fastener_id, info in fasteners.items():
        part = by_id.get(fastener_id)
        if part is None:
            continue
        center0 = (part.bbox_min + part.bbox_max) / 2.0
        joint: dict[str, float] = {}
        for mate in info.mates:
            mate_part = by_id.get(mate)
            if mate_part is None:
                continue
            mate_center = (mate_part.bbox_min + mate_part.bbox_max) / 2.0
            joint[mate] = float((mate_center - center0) @ info.axis)
        radius = info.shank_radius
        if radius is not None:
            axis = info.axis
            center = (part.bbox_min + part.bbox_max) / 2.0
            seed = (
                WORLD_AXES[0]
                if abs(float(axis @ WORLD_AXES[0])) < 0.9
                else WORLD_AXES[2]
            )
            u = np.cross(axis, seed)
            u = u / (float(np.linalg.norm(u)) or 1.0)
            v = np.cross(axis, u)
            # Two probe radii: just outside the shank, and past a generous
            # clearance hole — surrounding at either radius counts
            ring_radii = (radius * 1.2, radius * 1.2 + 2.0)
            angles = np.linspace(0.0, 2.0 * np.pi, 8, endpoint=False)
            ring_offsets = np.array(
                [np.cos(a) * u + np.sin(a) * v for a in angles]
            )
            f_lo, f_hi = _axis_span(part, axis, center)

            # Cap adaptive probes at a few head-widths: beyond that a "hole"
            # is an opening, not a fastener bore
            own = np.asarray(part.mesh.vertices) - center
            own_radial = own - np.outer(own @ axis, axis)
            max_radial = float(np.linalg.norm(own_radial, axis=1).max())
            probe_cap = max_radial * 5.0 + 5.0

            for other in parts:
                if other.node_id == fastener_id or other.node_id in joint:
                    continue
                inflate = probe_cap + 2.0
                if not (
                    np.all(part.bbox_min - inflate <= other.bbox_max)
                    and np.all(other.bbox_min - inflate <= part.bbox_max)
                ):
                    continue
                o_lo, o_hi = _axis_span(other, axis, center)
                lo, hi = max(f_lo, o_lo), min(f_hi, o_hi)
                if hi - lo < 0.5:
                    continue

                # Candidate-adaptive probe: just outside the candidate's own
                # bore, so slip-fit clearances (an oversize washer) still read
                # as "the fastener passes through me"
                probe_radii = list(ring_radii)
                probe_heights = [
                    lo + (hi - lo) * fraction
                    for fraction in (0.5, 0.25, 0.75)
                ]
                vertices = np.asarray(other.mesh.vertices)
                projected = (vertices - center) @ axis
                span_mask = (projected >= lo) & (projected <= hi)
                in_span = vertices[span_mask]
                if len(in_span) >= 3:
                    rel = in_span - center
                    radial = np.linalg.norm(
                        rel - np.outer(rel @ axis, axis), axis=1
                    )
                    adaptive = float(radial.min()) * 1.05 + 0.5
                    if adaptive <= probe_cap:
                        probe_radii.append(adaptive)
                        # The bore-rim vertex marks WHERE the candidate's
                        # material actually surrounds the shank (a wide
                        # bracket may only engage in one thin slice that
                        # fixed fractions miss)
                        rim_t = float(
                            projected[span_mask][int(np.argmin(radial))]
                        )
                        probe_heights.append(
                            min(max(rim_t, lo + 0.25), hi - 0.25)
                        )

                surrounded = False
                surround_t = 0.0
                for t in probe_heights:
                    for ring_radius in probe_radii:
                        ring = (
                            center + axis * t + ring_offsets * ring_radius
                        )
                        try:
                            inside = other.mesh.contains(ring)
                        except Exception:  # non-watertight candidate
                            inside = None
                        if (
                            inside is not None
                            and len(inside) > 0
                            and float(np.mean(inside)) >= 0.75
                        ):
                            surrounded = True
                            surround_t = t
                            break
                    if surrounded:
                        break
                if surrounded:
                    joint[other.node_id] = float(surround_t)
        joints[fastener_id] = joint
    return joints


def _axis_span(
    part: _Part, axis: np.ndarray, origin: np.ndarray
) -> tuple[float, float]:
    """The part's bbox extent projected onto an axis line through origin."""
    corners = np.array(
        [
            [
                part.bbox_min[0] if x == 0 else part.bbox_max[0],
                part.bbox_min[1] if y == 0 else part.bbox_max[1],
                part.bbox_min[2] if z == 0 else part.bbox_max[2],
            ]
            for x in (0, 1)
            for y in (0, 1)
            for z in (0, 1)
        ]
    )
    projected = (corners - origin) @ axis
    return float(projected.min()), float(projected.max())


def _axis_from_contacts(points: list) -> np.ndarray | None:
    """Bore axis from threaded-mate contact points (a cylindrical band).

    Tries the band's principal directions plus the world axes and keeps
    the candidate whose perpendicular radii are most uniform — a cylinder
    fit. Returns None when the points don't read as a cylinder.
    """
    if len(points) < 8:
        return None
    pts = np.asarray(points, dtype=np.float64)
    centered = pts - pts.mean(axis=0)
    try:
        basis = np.linalg.svd(centered, full_matrices=False)[2]
    except np.linalg.LinAlgError:  # pragma: no cover - degenerate cloud
        return None

    candidates = [basis[0], basis[2], *WORLD_AXES]
    best_axis: np.ndarray | None = None
    best_spread = float("inf")
    for candidate in candidates:
        norm = float(np.linalg.norm(candidate))
        if norm <= 1e-9:
            continue
        axis = candidate / norm
        radial = centered - np.outer(centered @ axis, axis)
        radii = np.linalg.norm(radial, axis=1)
        mean_radius = float(radii.mean())
        if mean_radius <= 1e-6:
            continue
        spread = float(radii.std())
        if spread < best_spread:
            best_spread = spread
            best_axis = axis
    if best_axis is None or best_spread > 0.5:
        return None
    for world in WORLD_AXES:
        if float(np.dot(best_axis, world)) > 0.999:
            return world.copy()
    return best_axis


def _bbox_axis_kind(part: _Part) -> tuple[np.ndarray, str] | None:
    """Rod/disc axis from bbox extents when SVD is inconclusive.

    Rod: clearly longest extent is the axis. Disc: clearly thinnest extent
    is the normal. Near-cubic parts return None (no natural axis).
    """
    extents = np.abs(part.bbox_max - part.bbox_min)
    order = np.argsort(extents)  # ascending
    smallest, mid, largest = (float(extents[i]) for i in order)
    if mid <= 1e-9:
        return None
    axis = np.zeros(3)
    if largest > 1.4 * mid:
        axis[order[2]] = 1.0  # rod: along the longest extent
        return axis, "rod"
    if smallest < 0.6 * mid:
        axis[order[0]] = 1.0  # disc: along the thinnest extent
        return axis, "disc"
    return None


def _embedded_pairs(parts: list[_Part]) -> list[tuple[str, str]]:
    """(inner, outer) pairs where one part sits fully inside another.

    Fully-embedded solids (logo/text bodies inside their parent) produce
    NO surface contacts — FCL's mesh collision only sees intersecting
    surfaces — so containment is tested directly: bbox containment first,
    then ray-cast `contains` on a sample of the inner part's vertices.
    """
    pairs: list[tuple[str, str]] = []
    epsilon = 0.01
    for inner in parts:
        for outer in parts:
            if inner.node_id == outer.node_id:
                continue
            if not (
                np.all(inner.bbox_min >= outer.bbox_min - epsilon)
                and np.all(inner.bbox_max <= outer.bbox_max + epsilon)
            ):
                continue
            vertices = np.asarray(inner.mesh.vertices)
            if len(vertices) == 0:
                continue
            sample = vertices[:: max(1, len(vertices) // 24)][:24]
            try:
                inside = outer.mesh.contains(sample)
            except Exception:  # non-watertight outer mesh — skip
                continue
            if len(inside) > 0 and float(np.mean(inside)) > 0.8:
                pairs.append((inner.node_id, outer.node_id))
    return pairs


def _merge_rigid_groups(
    parts: list[_Part],
    pair_depths: dict[frozenset, tuple[float, list, list, np.ndarray, np.ndarray]],
    fasteners: dict[str, _FastenerInfo],
    trimesh_mod,
    warnings: list[str],
) -> tuple[list[_Part], dict[str, str]]:
    """Union-find over rigidly bound pairs.

    Two ways a pair can never separate by a rigid motion: deep seated
    surface interpenetration (press fits) and full containment (embedded
    logo/text solids). Each cluster plans as one unit — the combined mesh
    under the largest member's nodeId. Returns the reduced part list plus
    member nodeId → representative nodeId.
    """
    parent: dict[str, str] = {part.node_id: part.node_id for part in parts}

    def find(node_id: str) -> str:
        while parent[node_id] != node_id:
            parent[node_id] = parent[parent[node_id]]
            node_id = parent[node_id]
        return node_id

    def union(a: str, b: str) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for inner, outer in _embedded_pairs(parts):
        union(inner, outer)

    clusters: dict[str, list[_Part]] = {}
    for part in parts:
        clusters.setdefault(find(part.node_id), []).append(part)

    def bbox_volume(part: _Part) -> float:
        extents = part.bbox_max - part.bbox_min
        return float(abs(extents[0] * extents[1] * extents[2]))

    units: list[_Part] = []
    merged_into: dict[str, str] = {}
    for members in clusters.values():
        if len(members) == 1:
            units.append(members[0])
            continue
        # A fastener member becomes the representative so the unit keeps
        # its bore axis and mate exemptions (a knob merged with its
        # coincident variant must still unscrew)
        rep = max(
            members,
            key=lambda member: (
                1 if member.node_id in fasteners else 0,
                bbox_volume(member),
            ),
        )
        combined = trimesh_mod.util.concatenate(
            [member.mesh for member in members]
        )
        # Concatenated soups are not watertight — carry the honest volume
        combined._carbon_volume = sum(
            _part_volume(member) for member in members
        )
        units.append(
            _Part(
                node_id=rep.node_id,
                name=rep.name,
                mesh=combined,
                bbox_min=np.min([m.bbox_min for m in members], axis=0),
                bbox_max=np.max([m.bbox_max for m in members], axis=0),
                is_proxy=any(m.is_proxy for m in members),
            )
        )
        for member in members:
            if member.node_id != rep.node_id:
                merged_into[member.node_id] = rep.node_id
        names = ", ".join(
            f"'{member.name or member.node_id}'" for member in members
        )
        warnings.append(
            f"{names} interpenetrate when seated; planned as one rigid unit"
        )
    return units, merged_into


def _symmetry_axis_kind(part: _Part) -> tuple[np.ndarray, str] | None:
    """The natural insertion axis of a fastener-like part, with its kind.

    Rod-like parts (bolts, pins, screws: one dominant extent) insert along
    their long axis; disc-like parts (washers, nuts: two equal dominant
    extents) insert along their normal. Returns None for parts without a
    clear axis.
    """
    vertices = np.asarray(part.mesh.vertices)
    if len(vertices) < 3:
        return None
    centered = vertices - vertices.mean(axis=0)
    try:
        singular, basis = np.linalg.svd(centered, full_matrices=False)[1:]
    except np.linalg.LinAlgError:  # pragma: no cover - degenerate mesh
        return None
    s1, s2, s3 = (float(s) for s in singular[:3])
    if s2 <= 1e-9:
        return None
    if s1 > 1.4 * s2:
        axis, kind = basis[0], "rod"  # rod: dominant extent is the axis
    elif s3 > 1e-9 and s2 > 1.4 * s3 and s1 < 1.25 * s2:
        axis, kind = basis[2], "disc"  # disc: the normal is the smallest extent
    else:
        return None
    norm = np.linalg.norm(axis)
    if norm <= 1e-9:
        return None
    axis = axis / norm
    # Snap near-axis-aligned directions to clean world axes (stable plan
    # output, and identical fasteners group on exact direction matches)
    for world in WORLD_AXES:
        if float(np.dot(axis, world)) > 0.999:
            return world.copy(), kind
    return axis, kind


def _symmetry_axis(part: _Part) -> np.ndarray | None:
    result = _symmetry_axis_kind(part)
    return result[0] if result is not None else None


def _normal_clusters(normals: list, top: int = 3) -> list[np.ndarray]:
    """Dominant contact-normal directions (greedy clustering by support)."""
    clusters: list[tuple[np.ndarray, int]] = []
    for normal in normals:
        length = float(np.linalg.norm(normal))
        if length <= 1e-9:
            continue
        unit = np.asarray(normal, dtype=np.float64) / length
        for index, (center, count) in enumerate(clusters):
            if abs(float(center @ unit)) > 0.95:
                clusters[index] = (center, count + 1)
                break
        else:
            clusters.append((unit, 1))
    clusters.sort(key=lambda entry: -entry[1])
    results: list[np.ndarray] = []
    for center, _count in clusters[:top]:
        snapped = center
        for world in WORLD_AXES:
            if abs(float(center @ world)) > 0.999:
                snapped = world.copy() if float(center @ world) > 0 else -world
                break
        results.append(snapped)
    return results


def _candidate_directions(part: _Part) -> list[np.ndarray]:
    """Removal directions to try, most natural first.

    A part's own symmetry axis comes first, then the dominant seated
    CONTACT NORMALS (the mating surfaces say how the part separates — a
    plate on a tilted plane offers the tilted lift no world axis can),
    then the world axes. Deduplication is sign-sensitive: +X and -X are
    different removal directions (a part boxed in on one side exits the
    other), so only same-direction duplicates are dropped.
    """
    candidates: list[np.ndarray] = []
    axis = _symmetry_axis(part)
    if axis is not None:
        candidates.extend([axis, -axis])

    for normal in _normal_clusters(part.contact_normals):
        for candidate in (normal, -normal):
            if all(float(np.dot(candidate, c)) < 0.999 for c in candidates):
                candidates.append(candidate)

    for world in WORLD_AXES:
        if all(float(np.dot(world, c)) < 0.999 for c in candidates):
            candidates.append(world)
    return candidates


def _greedy_disassembly(
    parts: list[_Part],
    trimesh_mod,
    clearance: float,
    path_samples: int,
    warnings: list[str] | None = None,
    fasteners: dict[str, _FastenerInfo] | None = None,
    group_units: dict[str, tuple[_Part, list[str]]] | None = None,
    tolerance: float = PENETRATION_TOLERANCE_MM,
    late_merges: dict[str, str] | None = None,
    deep_bitten: set[str] | None = None,
) -> tuple[list[PlannedPart], list[str], dict]:
    from trimesh.collision import CollisionManager

    if warnings is None:
        warnings = []
    if fasteners is None:
        fasteners = {}

    by_id = {part.node_id: part for part in parts}
    remaining: dict[str, _Part] = dict(by_id)

    manager = CollisionManager()
    full_manager = CollisionManager()
    for part in parts:
        manager.add_object(part.node_id, part.mesh)
        full_manager.add_object(part.node_id, part.mesh)

    removal_order: list[PlannedPart] = []
    group_mesh_cache: dict = {}
    stuck_blockers_cache: dict[str, list[str]] = {}
    # "forced" and "unplanned" stay at 0 for stats compatibility: the
    # planner no longer fabricates motions — unsolvable parts are "flagged".
    # "group" counts subassembly units (each covering 2+ parts).
    tiers = {
        "linear": 0,
        "l": 0,
        "escape": 0,
        "group": 0,
        "flagged": 0,
        "forced": 0,
        "unplanned": 0,
    }

    centroid = _assembly_centroid(parts)
    _amin = np.min([p.bbox_min for p in parts], axis=0)
    _amax = np.max([p.bbox_max for p in parts], axis=0)
    assembly_diagonal = float(np.linalg.norm(_amax - _amin)) or 1.0

    def removal_priority(pool: dict[str, _Part]) -> list[_Part]:
        # Fasteners come off first (so they assemble last, after the parts
        # they secure), then small/peripheral structure — the biggest, most
        # central part survives to become the base; nodeId keeps ties stable
        return sorted(
            pool.values(),
            key=lambda p: (
                0 if p.node_id in fasteners else 1,
                tuple(
                    -component
                    for component in _structural_key(
                        p, centroid, assembly_diagonal
                    )
                ),
                p.node_id,
            ),
        )

    progressed = True
    while remaining and progressed:
        progressed = False
        for part in removal_priority(remaining):
            if len(remaining) == 1:
                # The last part is the base: it "assembles" by being placed
                remaining.pop(part.node_id)
                removal_order.append(
                    PlannedPart(
                        node_id=part.node_id,
                        motion={"type": "none"},
                        confidence="high",
                        removal_direction=None,
                        tier="base",
                    )
                )
                progressed = True
                break

            # The part stays registered in the manager during its own tests
            # (its contacts are name-exempt): removing and re-adding per
            # attempt rebuilds its BVH and dominated planning time
            planned = _plan_removal(
                part,
                remaining,
                manager,
                clearance,
                path_samples,
                fasteners,
                tolerance,
                full_manager=full_manager,
            )

            if planned is not None:
                manager.remove_object(part.node_id)
                tiers["linear" if planned.tier == "linear" else "l"] += 1
                removal_order.append(planned)
                remaining.pop(part.node_id)
                progressed = True
                # Restart the scan: every removal changes what the priority
                # order should try next (a freed fastener, a newly exposed
                # peripheral part) — continuing down the stale list lets the
                # wrong part slip out first
                break

        if not progressed and len(remaining) > 1:
            # Tier 3: adaptive multi-segment escape for interlocked parts
            for part in removal_priority(remaining):
                planned = _plan_escape(
                    part, remaining, manager, path_samples, fasteners, tolerance
                )

                if planned is not None:
                    manager.remove_object(part.node_id)
                    tiers["escape"] += 1
                    removal_order.append(planned)
                    remaining.pop(part.node_id)
                    progressed = True
                    # Resume the cheap greedy scan: freeing one part often
                    # unlocks straight-line removals for its neighbors
                    break

        if not progressed and len(remaining) > 1:
            # Removability-evidence merge: a stuck part whose bbox overlaps
            # exactly ONE remaining neighbor can never separate from it (a
            # captive SEMS washer on its screw, coincident CAD variants of
            # one knob) — they are one rigid unit, by definition. The pair
            # continues as the neighbor.
            merged_here = False
            for part in removal_priority(remaining)[:8]:
                cached = stuck_blockers_cache.get(part.node_id)
                if cached is not None and all(
                    blocker in remaining for blocker in cached
                ):
                    blockers = cached
                else:
                    blockers = _escape_blockers(
                        part,
                        remaining,
                        manager,
                        fasteners,
                        tolerance,
                        path_samples,
                    )
                    stuck_blockers_cache[part.node_id] = blockers
                if len(blockers) != 1:
                    continue
                host_id = blockers[0]
                host = remaining.get(host_id)
                if host is None:
                    continue
                combined_mesh = trimesh_mod.util.concatenate(
                    [host.mesh, part.mesh]
                )
                combined_mesh._carbon_volume = _part_volume(
                    host
                ) + _part_volume(part)
                combined = _Part(
                    node_id=host.node_id,
                    name=host.name,
                    mesh=combined_mesh,
                    bbox_min=np.minimum(host.bbox_min, part.bbox_min),
                    bbox_max=np.maximum(host.bbox_max, part.bbox_max),
                    is_proxy=host.is_proxy or part.is_proxy,
                )
                warnings.append(
                    f"'{part.name or part.node_id}' cannot separate from "
                    f"'{host.name or host_id}'; planned as one rigid unit"
                )
                manager.remove_object(part.node_id)
                manager.remove_object(host_id)
                manager.add_object(host_id, combined.mesh)
                remaining.pop(part.node_id)
                remaining[host_id] = combined
                if late_merges is not None:
                    late_merges[part.node_id] = host_id
                progressed = True
                merged_here = True
                break
            if merged_here:
                continue

        if not progressed and len(remaining) > 2:
            # Subassembly extraction: mutually interlocked parts (a keyed
            # hub, a slider with its captive lock) often remove cleanly as
            # one unit. Members animate together as a single step.
            group = _plan_group_removal(
                remaining,
                manager,
                path_samples,
                fasteners,
                trimesh_mod,
                combined_cache=group_mesh_cache,
                tolerance=tolerance,
                deep_bitten=deep_bitten,
            )
            if group is not None:
                members, combined, entry = group
                for member_id in members:
                    manager.remove_object(member_id)
                    remaining.pop(member_id)
                removal_order.append(entry)
                if group_units is not None:
                    group_units[entry.node_id] = (combined, members)
                tiers["group"] = tiers.get("group", 0) + 1
                progressed = True
                continue

        if not progressed and len(remaining) > 1:
            # No collision-free escape exists. Flag the part — motion "none",
            # blockers recorded, the viewer fades it in. Never fabricate a
            # motion through geometry. Removing it from the working set gives
            # its neighbors another chance at a clean removal.
            part = removal_priority(remaining)[0]
            manager.remove_object(part.node_id)
            warnings.append(
                f"'{part.name or part.node_id}' has no collision-free escape; "
                "flagged for review — it fades in during playback"
            )
            removal_order.append(
                PlannedPart(
                    node_id=part.node_id,
                    motion={"type": "none"},
                    confidence="low",
                    removal_direction=None,
                    blocked_by=_escape_blockers(
                        part,
                        remaining,
                        manager,
                        fasteners,
                        tolerance,
                        path_samples,
                    )
                    or _blockers(part, remaining, trimesh_mod),
                    tier="flagged",
                )
            )
            tiers["flagged"] += 1
            remaining.pop(part.node_id)
            progressed = True

    # Assembly order = removal order reversed (base out last -> placed first)
    sequence = [entry.node_id for entry in reversed(removal_order)]
    return removal_order, sequence, tiers


def _mesh_bvh(mesh):
    """FCL BVH for a mesh, built once and cached on the mesh object.

    trimesh's `in_collision_single` rebuilds the BVH on every call, which
    dominated planning time (hours on real assemblies); caching turns each
    path sample into a pure narrowphase query.
    """
    bvh = getattr(mesh, "_carbon_bvh", None)
    if bvh is None:
        from trimesh.collision import mesh_to_BVH

        bvh = mesh_to_BVH(mesh)
        mesh._carbon_bvh = bvh
    return bvh


def _contacts_at(
    manager, part: _Part, translation: np.ndarray
) -> list[tuple[str | None, float]]:
    """(otherName, depth) contacts of `part` translated by `translation`
    against the manager's objects.

    The moving part may still be registered in the manager — callers
    exempt it by name (its own geometry reports name None here).
    """
    import fcl

    bvh = _mesh_bvh(part.mesh)
    obj = fcl.CollisionObject(bvh, fcl.Transform(np.eye(3), translation))
    cdata = fcl.CollisionData(
        request=fcl.CollisionRequest(
            num_max_contacts=100000, enable_contact=True
        )
    )
    manager._manager.collide(obj, cdata, fcl.defaultCollisionCallback)
    if not cdata.result.is_collision:
        return []
    contacts: list[tuple[str | None, float]] = []
    for contact in cdata.result.contacts:
        geometry = contact.o1 if contact.o1 != bvh else contact.o2
        contacts.append(
            (
                manager._names.get(id(geometry)),
                float(contact.penetration_depth),
            )
        )
    return contacts


def _self_exempt(
    exempt: dict[str, float] | None, self_ids
) -> dict[str, float]:
    """Merge an infinite allowance for the moving part(s) into `exempt`.

    The moving part stays registered in the manager (removing and
    re-adding it rebuilds its BVH), so its contacts against its own seated
    copy are filtered here by name instead.
    """
    merged = dict(exempt) if exempt else {}
    ids = [self_ids] if isinstance(self_ids, str) else self_ids
    for node_id in ids:
        merged[node_id] = float("inf")
    return merged


def _head_direction(
    part: _Part,
    info: _FastenerInfo,
    units_by_id: dict[str, _Part] | None = None,
) -> np.ndarray:
    """Tip → head sense of a fastener's axis.

    The head end is the fastener's widest end (flange, hex, button) — an
    intrinsic property immune to mate misclassification (a snug
    counterbore can read as thread-deep interference). Symmetric parts
    (studs, pins) fall back to pointing away from their mates.
    """
    axis = info.axis
    vertices = np.asarray(part.mesh.vertices, dtype=np.float64)
    if len(vertices) >= 8:
        center = (part.bbox_min + part.bbox_max) / 2.0
        rel = vertices - center
        proj = rel @ axis
        radial = np.linalg.norm(rel - np.outer(proj, axis), axis=1)
        span = float(proj.max() - proj.min())
        if span > 1e-6:
            head_side = proj > span * 0.25
            tip_side = proj < -span * 0.25
            hi = float(radial[head_side].max()) if np.any(head_side) else 0.0
            lo = float(radial[tip_side].max()) if np.any(tip_side) else 0.0
            if abs(hi - lo) > 0.2:
                return axis if hi > lo else -axis

    if units_by_id and info.mates:
        mate_centers = [
            (units_by_id[m].bbox_min + units_by_id[m].bbox_max) / 2.0
            for m in info.mates
            if m in units_by_id
        ]
        if mate_centers:
            f_center = (part.bbox_min + part.bbox_max) / 2.0
            away = f_center - np.mean(mate_centers, axis=0)
            if float(away @ axis) < 0:
                return -axis
    return axis


def _mate_exempt(
    part: _Part,
    direction: np.ndarray,
    fasteners: dict[str, _FastenerInfo],
) -> dict[str, float] | None:
    """Bore-engagement allowances for this part along this direction.

    Only a fastener travelling along its own axis unscrews through its
    mate and slides through its joint's holes/counterbores; any other
    part/direction is judged strictly against everything.
    """
    info = fasteners.get(part.node_id)
    if info is None or (not info.mates and not info.sliding):
        return None
    if abs(float(np.dot(direction, info.axis))) > 0.99:
        return {**info.sliding, **info.mates}
    return None


def _plan_removal(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    clearance: float,
    path_samples: int,
    fasteners: dict[str, _FastenerInfo],
    tolerance: float = PENETRATION_TOLERANCE_MM,
    full_manager=None,
) -> PlannedPart | None:
    others = [p for p in remaining.values() if p.node_id != part.node_id]
    if not others:
        return None

    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)

    # Named fasteners only ever exit through their bore: their axis, both
    # senses — the sense pointing AWAY from their threaded mates first, so
    # a screw backs out of its hole instead of tunneling deeper through the
    # threads. Everything else tries its symmetry axis then the world axes.
    info = fasteners.get(part.node_id)
    if _is_fastener(part) and info is not None:
        head = _head_direction(part, info, remaining)
        directions = [head, -head]
    else:
        directions = _candidate_directions(part)

    # Tier 1: straight line. Collect EVERY clear direction, then pick the
    # least entangling one: the sweep with the fewest blockers against the
    # FULL seated assembly (parts already removed in disassembly assemble
    # later — a sweep through their seats manufactures precedence edges
    # that drag this part early in the sequence for no reason).
    clear: list[tuple[int, np.ndarray, float]] = []
    for index, direction in enumerate(directions):
        travel = _exit_travel(part, static_min, static_max, direction)
        if travel <= 0:
            continue
        separation = _separation_distance(
            part.bbox_min, part.bbox_max, static_min, static_max, direction
        )
        last_touch = _path_is_clear(
            part,
            manager,
            direction,
            0.0,
            travel,
            path_samples,
            tolerance,
            exempt=_self_exempt(
                _mate_exempt(part, direction, fasteners), part.node_id
            ),
            check_until=separation + 2 * MAX_SAMPLE_SPACING_MM,
        )
        if last_touch is not None:
            clear.append(
                (
                    index,
                    direction,
                    _recorded_travel(part, direction, travel, last_touch),
                )
            )

    if clear:
        if len(clear) == 1 or full_manager is None:
            _index, direction, recorded = clear[0]
        else:
            samples_segment = max(12, path_samples // 3)

            def entanglement(candidate: tuple[int, np.ndarray, float]) -> tuple:
                index, direction, recorded = candidate
                blockers = _path_blockers(
                    part,
                    full_manager,
                    [(direction, recorded)],
                    samples_segment,
                    fasteners,
                    extra_exempt={part.node_id: float("inf")},
                    tolerance=tolerance,
                )
                # Tie-break by candidate order, NOT travel: the direction
                # list already ranks natural exits first (own axis /
                # away-from-mate before world axes)
                return (len(blockers), index)

            _index, direction, recorded = min(clear, key=entanglement)
        confidence = "low" if part.is_proxy else "high"
        return PlannedPart(
            node_id=part.node_id,
            motion={
                "type": "linear",
                "direction": [-float(c) for c in direction],
                "distance": recorded,
            },
            confidence=confidence,
            removal_direction=[float(c) for c in direction],
            tier="linear",
        )

    # Tier 2: lift then slide ("L"). First segment is a short escape hop,
    # the second exits the assembly.
    part_size = part.bbox_max - part.bbox_min
    hop = float(np.linalg.norm(part_size)) or 1.0
    samples_segment = max(12, path_samples // 3)
    for first in WORLD_AXES:
        if (
            _path_is_clear(
                part,
                manager,
                first,
                0.0,
                hop,
                samples_segment,
                tolerance,
                exempt=_self_exempt(
                    _mate_exempt(part, first, fasteners), part.node_id
                ),
            )
            is None
        ):
            continue
        offset = first * hop
        for second in WORLD_AXES:
            if abs(float(np.dot(first, second))) > 0.99:
                continue
            travel = _exit_travel(part, static_min, static_max, second, offset)
            if travel <= 0:
                continue
            separation = _separation_distance(
                part.bbox_min + offset,
                part.bbox_max + offset,
                static_min,
                static_max,
                second,
            )
            second_touch = _path_is_clear(
                part,
                manager,
                second,
                0.0,
                travel,
                samples_segment,
                tolerance,
                base_offset=offset,
                exempt=_self_exempt(
                    _mate_exempt(part, second, fasteners), part.node_id
                ),
                check_until=separation + 2 * MAX_SAMPLE_SPACING_MM,
            )
            if second_touch is not None:
                # Insertion motion reverses the removal: slide in, then drop
                return PlannedPart(
                    node_id=part.node_id,
                    motion={
                        "type": "L",
                        "segments": [
                            {
                                "direction": [-float(c) for c in second],
                                "distance": _recorded_travel(
                                    part, second, travel, second_touch
                                ),
                            },
                            {
                                "direction": [-float(c) for c in first],
                                "distance": round(hop, 3),
                            },
                        ],
                    },
                    confidence="low",
                    removal_direction=[float(c) for c in first],
                    tier="L",
                )

    return None


def _plan_escape(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    path_samples: int,
    fasteners: dict[str, _FastenerInfo],
    tolerance: float = PENETRATION_TOLERANCE_MM,
) -> PlannedPart | None:
    """Tier 3: BFS over axis-aligned hops until the part clears the assembly.

    Unlike tier 2's fixed lift-then-slide, each hop travels as far as the
    free space allows (a blind slot needs "slide to the end, lift, slide
    out" — hop lengths the fixed search cannot guess). The removal segments
    reverse into a multi-segment "L" insertion motion, which the viewer
    already interpolates for any segment count.
    """
    from collections import deque

    others = [p for p in remaining.values() if p.node_id != part.node_id]
    if not others:
        return None

    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)

    part_diagonal = float(np.linalg.norm(part.bbox_max - part.bbox_min)) or 1.0
    min_hop = max(part_diagonal * MIN_HOP_FRACTION, 2.0)
    hop_cap = part_diagonal * 1.5
    samples_segment = max(12, path_samples // 3)
    directions = _candidate_directions(part)

    queue: deque[tuple[np.ndarray, list[tuple[np.ndarray, float]]]] = deque(
        [(np.zeros(3), [])]
    )
    visited = {(0, 0, 0)}
    expansions = 0

    while queue and expansions < MAX_ESCAPE_EXPANSIONS:
        offset, segments = queue.popleft()
        expansions += 1
        for direction in directions:
            # Never double back along the previous hop
            if segments and abs(float(np.dot(direction, segments[-1][0]))) > 0.99:
                continue
            exempt = _self_exempt(
                _mate_exempt(part, direction, fasteners), part.node_id
            )

            # Can the part exit straight from here?
            travel = _exit_travel(
                part, static_min, static_max, direction, base_offset=offset
            )
            separation = _separation_distance(
                part.bbox_min + offset,
                part.bbox_max + offset,
                static_min,
                static_max,
                direction,
            )
            if travel > 0:
                exit_touch = _path_is_clear(
                    part,
                    manager,
                    direction,
                    0.0,
                    travel,
                    samples_segment,
                    tolerance,
                    base_offset=offset,
                    exempt=exempt,
                    check_until=separation + 2 * MAX_SAMPLE_SPACING_MM,
                )
                if exit_touch is not None:
                    removal = segments + [
                        (
                            direction,
                            _recorded_travel(part, direction, travel, exit_touch),
                        )
                    ]
                    return _removal_segments_to_planned(part, removal)

            if len(segments) + 1 >= MAX_ESCAPE_SEGMENTS:
                continue

            # Otherwise hop as far as the free space allows and search on
            free = _free_travel(
                part,
                manager,
                direction,
                offset,
                hop_cap,
                samples_segment,
                exempt=exempt,
                tolerance=tolerance,
            )
            if free < min_hop:
                continue
            new_offset = offset + direction * free
            key = tuple(int(round(float(c) / min_hop)) for c in new_offset)
            if key in visited:
                continue
            visited.add(key)
            queue.append((new_offset, segments + [(direction, float(free))]))

    return None


def _group_exempt(
    members: list[_Part],
    direction: np.ndarray,
    fasteners: dict[str, _FastenerInfo],
    member_ids: set[str],
) -> dict[str, float] | None:
    """Merged threaded-mate allowances for a group moving along `direction`.

    A member fastener aligned with the travel keeps its mate allowance
    (the group can unscrew off an external mate); mates inside the group
    are irrelevant — members are absent from the manager during the test.
    """
    merged: dict[str, float] = {}
    for member in members:
        exempt = _mate_exempt(member, direction, fasteners)
        if not exempt:
            continue
        # Mates AND sliding joints: a knob pair leaving through the opening
        # of the bracket it threads through keeps its sliding engagement
        for mate, depth in exempt.items():
            if mate in member_ids:
                continue
            if depth > merged.get(mate, 0.0):
                merged[mate] = depth
    return merged or None


def _plan_group_removal(
    remaining: dict[str, _Part],
    manager,
    path_samples: int,
    fasteners: dict[str, _FastenerInfo],
    trimesh_mod,
    combined_cache: dict | None = None,
    tolerance: float = PENETRATION_TOLERANCE_MM,
    deep_bitten: set[str] | None = None,
) -> tuple[list[str], _Part, PlannedPart] | None:
    """Find a connected subassembly that removes as one unit.

    Candidate groups grow from a seed part through a proximity graph
    (bboxes inflated by GROUP_PROXIMITY_MM — clearance fits produce no
    surface contacts), adding the smallest neighbor first (attachments —
    keys, locks, knobs — are small). Members translate together; the
    combined unit is registered under the largest member's nodeId.
    """
    parts = list(remaining.values())
    if len(parts) <= 2:
        return None

    adjacency: dict[str, set[str]] = {part.node_id: set() for part in parts}
    for index, a in enumerate(parts):
        for b in parts[index + 1 :]:
            if np.all(
                a.bbox_min - GROUP_PROXIMITY_MM <= b.bbox_max
            ) and np.all(b.bbox_min - GROUP_PROXIMITY_MM <= a.bbox_max):
                adjacency[a.node_id].add(b.node_id)
                adjacency[b.node_id].add(a.node_id)

    def diagonal(part: _Part) -> float:
        return float(np.linalg.norm(part.bbox_max - part.bbox_min))

    samples_segment = max(12, path_samples // 3)
    tests = 0
    seeds = sorted(parts, key=lambda p: (-float(p.bbox_max[2]), p.node_id))
    for seed in seeds:
        if tests >= MAX_GROUP_TESTS:
            break
        members = [seed]
        member_ids = {seed.node_id}
        bitten = deep_bitten or set()
        while len(members) < MAX_GROUP_SIZE and tests < MAX_GROUP_TESTS:
            neighbors = sorted(
                (
                    remaining[node_id]
                    for member in members
                    for node_id in adjacency.get(member.node_id, ())
                    if node_id not in member_ids and node_id in remaining
                ),
                key=lambda p: (
                    1 if p.node_id in bitten else 0,
                    diagonal(p),
                    p.node_id,
                ),
            )
            if not neighbors:
                break
            members.append(neighbors[0])
            member_ids.add(neighbors[0].node_id)
            # The whole remaining set is not a removal
            if len(members) >= len(remaining):
                break

            others = [
                part for part in parts if part.node_id not in member_ids
            ]
            static_min = np.min([p.bbox_min for p in others], axis=0)
            static_max = np.max([p.bbox_max for p in others], axis=0)

            # Concatenating big meshes and building their BVH is expensive;
            # the same candidate sets recur across stuck rounds
            cache_key = frozenset(member_ids)
            combined = (
                combined_cache.get(cache_key)
                if combined_cache is not None
                else None
            )
            if combined is None:
                combined_mesh = trimesh_mod.util.concatenate(
                    [member.mesh for member in members]
                )
                combined_mesh._carbon_volume = sum(
                    _part_volume(member) for member in members
                )
                combined = _Part(
                    node_id=max(
                        members,
                        key=lambda p: float(
                            abs(np.prod(p.bbox_max - p.bbox_min))
                        ),
                    ).node_id,
                    name=" + ".join(member.name for member in members),
                    mesh=combined_mesh,
                    bbox_min=np.min([m.bbox_min for m in members], axis=0),
                    bbox_max=np.max([m.bbox_max for m in members], axis=0),
                    is_proxy=any(m.is_proxy for m in members),
                )
                if combined_cache is not None:
                    combined_cache[cache_key] = combined

            directions: list[np.ndarray] = []
            for member in members:
                member_info = fasteners.get(member.node_id)
                axes = []
                if member_info is not None:
                    axes.append(member_info.axis)
                axis = _symmetry_axis(member)
                if axis is not None:
                    axes.append(axis)
                for base_axis in axes:
                    for candidate in (base_axis, -base_axis):
                        if all(
                            float(np.dot(candidate, d)) < 0.999
                            for d in directions
                        ):
                            directions.append(candidate)
            for world in WORLD_AXES:
                if all(float(np.dot(world, d)) < 0.999 for d in directions):
                    directions.append(world)

            # Members stay registered in the manager: their contacts are
            # name-exempt during the group's own tests
            for direction in directions:
                tests += 1
                travel = _exit_travel(
                    combined, static_min, static_max, direction
                )
                if travel <= 0:
                    continue
                separation = _separation_distance(
                    combined.bbox_min,
                    combined.bbox_max,
                    static_min,
                    static_max,
                    direction,
                )
                group_touch = _path_is_clear(
                    combined,
                    manager,
                    direction,
                    0.0,
                    travel,
                    samples_segment,
                    tolerance,
                    exempt=_self_exempt(
                        _group_exempt(members, direction, fasteners, member_ids),
                        list(member_ids),
                    ),
                    check_until=separation + 2 * MAX_SAMPLE_SPACING_MM,
                )
                if group_touch is not None:
                    entry = PlannedPart(
                        node_id=combined.node_id,
                        motion={
                            "type": "linear",
                            "direction": [-float(c) for c in direction],
                            "distance": _recorded_travel(
                                combined, direction, travel, group_touch
                            ),
                        },
                        confidence="low",
                        removal_direction=[float(c) for c in direction],
                        tier="group",
                    )
                    ordered = [member.node_id for member in members]
                    return ordered, combined, entry
                if tests >= MAX_GROUP_TESTS:
                    break

    return None


def _removal_segments_to_planned(
    part: _Part, removal: list[tuple[np.ndarray, float]]
) -> PlannedPart:
    """Reverse a removal segment chain into an insertion motion."""
    first_direction = removal[0][0]
    if len(removal) == 1:
        direction, distance = removal[0]
        motion = {
            "type": "linear",
            "direction": [-float(c) for c in direction],
            "distance": round(float(distance), 3),
        }
    else:
        motion = {
            "type": "L",
            "segments": [
                {
                    "direction": [-float(c) for c in direction],
                    "distance": round(float(distance), 3),
                }
                for direction, distance in reversed(removal)
            ],
        }
    return PlannedPart(
        node_id=part.node_id,
        motion=motion,
        confidence="low",
        removal_direction=[float(c) for c in first_direction],
        tier="escape",
    )


def _blocking_depth(
    contacts: list[tuple[str | None, float]],
    exempt: dict[str, float] | None,
) -> float:
    """Max blocking penetration depth over a sample's contacts.

    Contacts with an exempt partner (a fastener's threaded mate, or the
    moving part's own registered copy) are allowed up to that allowance
    plus a margin — the steady thread interference — and count as blocking
    beyond it.
    """
    depth = 0.0
    for other, contact_depth in contacts:
        if other is not None and exempt is not None and other in exempt:
            if contact_depth <= exempt[other] + MATE_DEPTH_MARGIN_MM:
                continue
        if contact_depth > depth:
            depth = contact_depth
    return depth


def _free_travel(
    part: _Part,
    manager,
    direction: np.ndarray,
    base_offset: np.ndarray,
    cap: float,
    samples: int,
    exempt: dict[str, float] | None = None,
    tolerance: float = PENETRATION_TOLERANCE_MM,
) -> float:
    """Furthest clear translation along `direction` from `base_offset`.

    Samples forward like `_path_is_clear` but returns the last clear
    distance before the first blocking contact instead of a boolean.
    """
    if cap <= 0:
        return 0.0
    samples = min(
        max(samples, int(cap / MAX_SAMPLE_SPACING_MM) + 1),
        MAX_PATH_SAMPLES,
    )
    offsets = np.linspace(0.0, cap, samples, endpoint=True)[1:]
    clear = 0.0
    for s in offsets:
        translation = direction * float(s) + base_offset
        contacts = _contacts_at(manager, part, translation)
        if contacts:
            depth = _blocking_depth(contacts, exempt)
            if depth > tolerance:
                return clear
        clear = float(s)
    return clear


def _recorded_travel(
    part: _Part,
    direction: np.ndarray,
    full_travel: float,
    last_touch: float,
) -> float:
    """The travel to record for the animation: reach free space, then one
    own-extent of clearance so the exit reads visually — never more than
    the full AABB-exit travel (whose tail was verified clear)."""
    extent = float(np.abs(direction) @ (part.bbox_max - part.bbox_min))
    return round(min(float(full_travel), last_touch + extent + EXIT_MARGIN_MM), 3)


def _separation_distance(
    bbox_min: np.ndarray,
    bbox_max: np.ndarray,
    static_min: np.ndarray,
    static_max: np.ndarray,
    direction: np.ndarray,
) -> float:
    """Translation along `direction` until the AABBs separate.

    AABB overlap ends as soon as the boxes separate on ANY axis, so this
    is the cheapest separating axis (taking the max instead explodes for
    directions with tiny components). Beyond this distance the moving box
    is disjoint from the whole static set — no collision checks needed.
    """
    travel = float("inf")
    for axis in range(3):
        d = float(direction[axis])
        if d > 1e-6:
            needed = float(static_max[axis] - bbox_min[axis])
            travel = min(travel, max(needed / d, 0.0))
        elif d < -1e-6:
            needed = float(bbox_max[axis] - static_min[axis])
            travel = min(travel, max(needed / -d, 0.0))
    return 0.0 if travel == float("inf") else travel


def _exit_travel(
    part: _Part,
    static_min: np.ndarray,
    static_max: np.ndarray,
    direction: np.ndarray,
    base_offset: np.ndarray | None = None,
) -> float:
    """Distance along `direction` until the part's AABB clears the assembly.

    Capped at the assembly diagonal and never zero: a part already outside
    still gets an animation travel of its own extent plus margin so the
    insertion reads clearly.
    """
    bbox_min = part.bbox_min + (base_offset if base_offset is not None else 0.0)
    bbox_max = part.bbox_max + (base_offset if base_offset is not None else 0.0)

    travel = _separation_distance(
        bbox_min, bbox_max, static_min, static_max, direction
    )

    diagonal = float(np.linalg.norm(static_max - static_min))
    travel = min(travel, diagonal * 1.5)

    extent = float(np.abs(direction) @ (bbox_max - bbox_min))
    return max(travel, extent) + EXIT_MARGIN_MM


def _path_is_clear(
    part: _Part,
    manager,
    direction: np.ndarray,
    start: float,
    end: float,
    samples: int,
    tolerance: float = PENETRATION_TOLERANCE_MM,
    base_offset: np.ndarray | None = None,
    exempt: dict[str, float] | None = None,
    check_until: float | None = None,
) -> float | None:
    """Densely sample translations of the part and check for collisions.

    Returns None when the path is blocked; otherwise the LAST distance at
    which the part was still touching something (0.0 for a free flight) —
    the "reach free space" point that callers record as the motion travel
    instead of the AABB-exit distance (a screw backs out of its hole in
    ~20mm; it does not fly to the assembly boundary).

    Surface contact up to `tolerance` is allowed so sliding fits (pins in
    bores, rails in channels) remain removable. Contacts with `exempt`
    partners (a fastener's threaded mate along its own axis, the moving
    part's own registered copy) are allowed up to their recorded
    interference — infinite allowances (self, group members) do not count
    as touching. When a sample presses past half the tolerance, the
    neighborhood is re-checked at half spacing so thin blockers cannot
    slip between samples. Samples beyond `check_until` (the AABB
    separation distance from everything static) are provably clear and
    skipped.
    """
    if end <= start:
        return None
    samples = min(
        max(samples, int((end - start) / MAX_SAMPLE_SPACING_MM) + 1),
        MAX_PATH_SAMPLES,
    )
    offsets = np.linspace(start, end, samples, endpoint=True)[1:]
    spacing = (end - start) / max(samples - 1, 1)

    def blocked_at(distance: float) -> tuple[bool, bool, bool]:
        """(blocked, near, touching) at a distance along the path."""
        translation = direction * float(distance)
        if base_offset is not None:
            translation = translation + base_offset
        contacts = _contacts_at(manager, part, translation)
        if not contacts:
            return False, False, False
        depth = _blocking_depth(contacts, exempt)
        touching = any(
            other is not None
            and not (
                exempt is not None
                and exempt.get(other, 0.0) == float("inf")
            )
            for other, _depth in contacts
        )
        return depth > tolerance, depth > tolerance * 0.5, touching

    last_touch = 0.0
    for s in offsets:
        if check_until is not None and float(s) > check_until:
            break
        blocked, near, touching = blocked_at(float(s))
        if blocked:
            return None
        if touching:
            last_touch = float(s)
        if near:
            # Refine around near-tolerance contact: a thin flange's blocking
            # window can be narrower than the sample spacing
            half = spacing / 2.0
            for probe in (float(s) - half, float(s) + half):
                if probe <= start or probe >= end:
                    continue
                probe_blocked, _near, _touching = blocked_at(probe)
                if probe_blocked:
                    return None
    return last_touch


def _escape_blockers(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    fasteners: dict[str, _FastenerInfo],
    tolerance: float,
    path_samples: int,
) -> list[str]:
    """The parts that ACTUALLY block every escape: union of sweep blockers
    over the part's candidate directions. Bbox proximity over-counts —
    neighbors that never intersect any escape path are not blockers, and
    the single-blocker rigid-merge decision depends on the difference.
    """
    others = [p for p in remaining.values() if p.node_id != part.node_id]
    if not others:
        return []
    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)
    samples_segment = max(12, path_samples // 3)

    info = fasteners.get(part.node_id)
    if _is_fastener(part) and info is not None:
        head = _head_direction(part, info, remaining)
        directions = [head, -head]
    else:
        directions = _candidate_directions(part)

    blockers: set[str] = set()
    for direction in directions:
        travel = _exit_travel(part, static_min, static_max, direction)
        if travel <= 0:
            continue
        blockers |= _path_blockers(
            part,
            manager,
            [(direction, float(travel))],
            samples_segment,
            fasteners,
            extra_exempt={part.node_id: float("inf")},
            tolerance=tolerance,
        )
    blockers.discard(part.node_id)
    return sorted(blockers)[:8]


def _blockers(part: _Part, remaining: dict[str, _Part], trimesh_mod) -> list[str]:
    """Parts whose bounding boxes overlap this part's (rough blocking set)."""
    blockers: list[str] = []
    for other in remaining.values():
        if other.node_id == part.node_id:
            continue
        overlaps = bool(
            np.all(part.bbox_min <= other.bbox_max)
            and np.all(other.bbox_min <= part.bbox_max)
        )
        if overlaps:
            blockers.append(other.node_id)
    return blockers[:8]
