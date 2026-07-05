"""Assembly-by-disassembly motion planner.

Computes a collision-free removal motion for every leaf part plus a greedy
assembly sequence (see docs/specs/animated-work-instructions-contracts.md,
POST /plan). The same STEP source is re-tessellated with the same nodeId
derivation as /convert, so plan.json keys join against graph.json and the
GLB extras.

Algorithm (per llm/research/animated-work-instructions.md):
- Tier 1: greedy disassembly testing straight-line candidate directions
  (world axes + the part's principal axis). A part is removable when the
  densely sampled removal path is collision-free against the remaining
  parts (small penetration tolerance allows sliding fits).
- Tier 2: two-segment "L" motions (lift then slide) for tier-1 failures.
- Tier 3: adaptive multi-segment escape search (BFS over axis-aligned
  hops, each hop as far as the free space allows) for parts tiers 1-2
  cannot solve. Emits a multi-segment "L" motion.
- Tier 4: best-effort forced removal along the least-obstructed direction
  when no collision-free escape exists, with the blocking parts recorded
  and a warning emitted. Every part except the base gets SOME motion so
  the animation never silently pops parts into place.

Only the base part (the last one standing in the greedy disassembly, the
first in the assembly sequence) keeps motion "none" — it is placed, not
inserted.

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

PLAN_VERSION = 1
OUTPUT_UNIT = "mm"

# Allowed surface penetration (mm) along a removal path. Parts in contact at
# the seated pose report hairline collisions; sliding fits (pin in bore)
# stay in surface contact for most of their travel.
PENETRATION_TOLERANCE_MM = 0.15

# Margin (mm) past the assembly bounds before a part counts as "out".
EXIT_MARGIN_MM = 5.0

# Densify sampling on long paths: never step more than this between
# collision checks, or thin features (washers, flanges) slip between
# samples and produce false "removable" results that scramble the sequence.
MAX_SAMPLE_SPACING_MM = 2.0
MAX_PATH_SAMPLES = 400

# Threaded fasteners are modeled as solid cylinders in CAD, so they
# geometrically interfere with their nuts/tapped holes even though they
# unscrew in reality. Along their own axis they get a thread-depth
# penetration allowance instead of the strict tolerance.
THREAD_PENETRATION_MM = 1.5
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


@dataclass
class PlannedPart:
    node_id: str
    motion: dict
    confidence: str | None  # "high" | "low" | None for unplanned
    removal_direction: list[float] | None
    blocked_by: list[str] = field(default_factory=list)


@dataclass
class PlanResult:
    plan: dict
    part_count: int
    planned_count: int
    tiers: dict
    warnings: list[str]


def plan_step(
    step_path: Path,
    linear_deflection: float = 0.1,
    angular_deflection: float = 0.5,
    clearance: float = 0.5,
    path_samples: int = 60,
    max_parts: int | None = None,
) -> PlanResult:
    """Plan removal motions and an assembly sequence for a STEP file."""
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

    planned, sequence, tiers = _greedy_disassembly(
        parts,
        trimesh,
        clearance=clearance,
        path_samples=path_samples,
        warnings=warnings,
    )

    plan = {
        "version": PLAN_VERSION,
        "unit": OUTPUT_UNIT,
        "sequence": sequence,
        "parts": {
            entry.node_id: _part_to_dict(entry) for entry in planned
        },
        "warnings": warnings,
    }
    planned_count = sum(
        1 for entry in planned if entry.motion.get("type") != "none"
    )
    return PlanResult(
        plan=plan,
        part_count=len(parts),
        planned_count=planned_count,
        tiers=tiers,
        warnings=warnings,
    )


def _part_to_dict(entry: PlannedPart) -> dict:
    payload: dict = {"motion": entry.motion}
    if entry.confidence is not None:
        payload["confidence"] = entry.confidence
    if entry.removal_direction is not None:
        payload["removalDirection"] = entry.removal_direction
    if entry.blocked_by:
        payload["blockedBy"] = entry.blocked_by
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


def _symmetry_axis(part: _Part) -> np.ndarray | None:
    """The natural insertion axis of a fastener-like part.

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
        axis = basis[0]  # rod: dominant extent is the axis
    elif s3 > 1e-9 and s2 > 1.4 * s3 and s1 < 1.25 * s2:
        axis = basis[2]  # disc: the normal is the smallest extent
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
            return world.copy()
    return axis


def _candidate_directions(part: _Part) -> list[np.ndarray]:
    """Removal directions to try, most natural first.

    A part's own symmetry axis comes before the world axes so fasteners
    leave through their own bores instead of the first free world
    direction. Deduplication is sign-sensitive: +X and -X are different
    removal directions (a part boxed in on one side exits the other), so
    only same-direction duplicates of the symmetry axis are dropped.
    """
    candidates: list[np.ndarray] = []
    axis = _symmetry_axis(part)
    if axis is not None:
        candidates.extend([axis, -axis])

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
) -> tuple[list[PlannedPart], list[str], dict]:
    from trimesh.collision import CollisionManager

    if warnings is None:
        warnings = []

    by_id = {part.node_id: part for part in parts}
    remaining: dict[str, _Part] = dict(by_id)

    manager = CollisionManager()
    for part in parts:
        manager.add_object(part.node_id, part.mesh)

    removal_order: list[PlannedPart] = []
    # "unplanned" stays for stats compatibility; tiers 3-4 guarantee every
    # non-base part gets a motion, so it is always 0 now
    tiers = {"linear": 0, "l": 0, "escape": 0, "forced": 0, "unplanned": 0}

    def top_down(pool: dict[str, _Part]) -> list[_Part]:
        # Outer parts first: removing top-most parts first reads naturally
        return sorted(
            pool.values(), key=lambda p: float(p.bbox_max[2]), reverse=True
        )

    progressed = True
    while remaining and progressed:
        progressed = False
        for part in top_down(remaining):
            if len(remaining) == 1:
                # The last part is the base: it "assembles" by being placed
                remaining.pop(part.node_id)
                removal_order.append(
                    PlannedPart(
                        node_id=part.node_id,
                        motion={"type": "none"},
                        confidence="high",
                        removal_direction=None,
                    )
                )
                progressed = True
                break

            manager.remove_object(part.node_id)
            planned = None
            try:
                planned = _plan_removal(
                    part, remaining, manager, clearance, path_samples
                )
            finally:
                if planned is None:
                    manager.add_object(part.node_id, part.mesh)

            if planned is not None:
                tiers["linear" if planned.confidence == "high" else "l"] += 1
                removal_order.append(planned)
                remaining.pop(part.node_id)
                progressed = True

        if not progressed and len(remaining) > 1:
            # Tier 3: adaptive multi-segment escape for interlocked parts
            for part in top_down(remaining):
                manager.remove_object(part.node_id)
                planned = None
                try:
                    planned = _plan_escape(part, remaining, manager, path_samples)
                finally:
                    if planned is None:
                        manager.add_object(part.node_id, part.mesh)

                if planned is not None:
                    tiers["escape"] += 1
                    removal_order.append(planned)
                    remaining.pop(part.node_id)
                    progressed = True
                    # Resume the cheap greedy scan: freeing one part often
                    # unlocks straight-line removals for its neighbors
                    break

        if not progressed and len(remaining) > 1:
            # Tier 4: no collision-free escape exists — force a best-effort
            # motion so the part still animates instead of popping in
            part = top_down(remaining)[0]
            manager.remove_object(part.node_id)
            planned = _forced_removal(
                part, remaining, manager, trimesh_mod, path_samples, warnings
            )
            tiers["forced"] += 1
            removal_order.append(planned)
            remaining.pop(part.node_id)
            progressed = True

    # Assembly order = removal order reversed (base out last -> placed first)
    sequence = [entry.node_id for entry in reversed(removal_order)]
    return removal_order, sequence, tiers


def _plan_removal(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    clearance: float,
    path_samples: int,
) -> PlannedPart | None:
    others = [p for p in remaining.values() if p.node_id != part.node_id]
    if not others:
        return None

    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)

    # Named fasteners get a thread-depth allowance along their own axis —
    # solid-cylinder screw models interfere with their nuts geometrically
    # even though they unscrew in reality
    fastener_axis = _symmetry_axis(part) if _is_fastener(part) else None

    # Tier 1: straight line
    for direction in _candidate_directions(part):
        travel = _exit_travel(part, static_min, static_max, direction)
        if travel <= 0:
            continue
        tolerance = (
            THREAD_PENETRATION_MM
            if fastener_axis is not None
            and abs(float(np.dot(direction, fastener_axis))) > 0.99
            else PENETRATION_TOLERANCE_MM
        )
        if _path_is_clear(
            part, manager, direction, 0.0, travel, path_samples, tolerance
        ):
            confidence = "low" if part.is_proxy else "high"
            return PlannedPart(
                node_id=part.node_id,
                motion={
                    "type": "linear",
                    "direction": [-float(c) for c in direction],
                    "distance": round(float(travel), 3),
                },
                confidence=confidence,
                removal_direction=[float(c) for c in direction],
            )

    # Tier 2: lift then slide ("L"). First segment is a short escape hop,
    # the second exits the assembly.
    part_size = part.bbox_max - part.bbox_min
    hop = float(np.linalg.norm(part_size)) or 1.0
    samples_segment = max(12, path_samples // 3)
    for first in WORLD_AXES:
        if not _path_is_clear(part, manager, first, 0.0, hop, samples_segment):
            continue
        offset = first * hop
        for second in WORLD_AXES:
            if abs(float(np.dot(first, second))) > 0.99:
                continue
            travel = _exit_travel(part, static_min, static_max, second, offset)
            if travel <= 0:
                continue
            if _path_is_clear(
                part,
                manager,
                second,
                0.0,
                travel,
                samples_segment,
                base_offset=offset,
            ):
                # Insertion motion reverses the removal: slide in, then drop
                return PlannedPart(
                    node_id=part.node_id,
                    motion={
                        "type": "L",
                        "segments": [
                            {
                                "direction": [-float(c) for c in second],
                                "distance": round(float(travel), 3),
                            },
                            {
                                "direction": [-float(c) for c in first],
                                "distance": round(hop, 3),
                            },
                        ],
                    },
                    confidence="low",
                    removal_direction=[float(c) for c in first],
                )

    return None


def _plan_escape(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    path_samples: int,
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
    fastener_axis = _symmetry_axis(part) if _is_fastener(part) else None
    directions = _candidate_directions(part)

    def tolerance_for(direction: np.ndarray) -> float:
        if (
            fastener_axis is not None
            and abs(float(np.dot(direction, fastener_axis))) > 0.99
        ):
            return THREAD_PENETRATION_MM
        return PENETRATION_TOLERANCE_MM

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
            tolerance = tolerance_for(direction)

            # Can the part exit straight from here?
            travel = _exit_travel(
                part, static_min, static_max, direction, base_offset=offset
            )
            if travel > 0 and _path_is_clear(
                part,
                manager,
                direction,
                0.0,
                travel,
                samples_segment,
                tolerance,
                base_offset=offset,
            ):
                removal = segments + [(direction, float(travel))]
                return _removal_segments_to_planned(part, removal)

            if len(segments) + 1 >= MAX_ESCAPE_SEGMENTS:
                continue

            # Otherwise hop as far as the free space allows and search on
            free = _free_travel(
                part, manager, direction, offset, hop_cap, samples_segment, tolerance
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
    )


def _forced_removal(
    part: _Part,
    remaining: dict[str, _Part],
    manager,
    trimesh_mod,
    path_samples: int,
    warnings: list[str],
) -> PlannedPart:
    """Tier 4: best-effort linear motion when no collision-free escape exists.

    Picks the direction with the most free travel before contact so the
    animation passes through as little geometry as possible. The blocking
    parts are recorded and a warning surfaces the unresolved collision to
    the author.
    """
    others = [p for p in remaining.values() if p.node_id != part.node_id]
    static_min = np.min([p.bbox_min for p in others], axis=0)
    static_max = np.max([p.bbox_max for p in others], axis=0)
    diagonal = float(np.linalg.norm(static_max - static_min)) or 1.0
    samples_segment = max(12, path_samples // 3)

    best_direction = WORLD_AXES[0]
    best_free = -1.0
    for direction in _candidate_directions(part):
        free = _free_travel(
            part,
            manager,
            direction,
            np.zeros(3),
            diagonal,
            samples_segment,
            PENETRATION_TOLERANCE_MM,
        )
        if free > best_free:
            best_free = free
            best_direction = direction

    travel = _exit_travel(part, static_min, static_max, best_direction)
    warnings.append(
        f"'{part.name or part.node_id}' has no collision-free escape; "
        "using a best-effort linear motion"
    )
    return PlannedPart(
        node_id=part.node_id,
        motion={
            "type": "linear",
            "direction": [-float(c) for c in best_direction],
            "distance": round(float(travel), 3),
        },
        confidence="low",
        removal_direction=[float(c) for c in best_direction],
        blocked_by=_blockers(part, remaining, trimesh_mod),
    )


def _free_travel(
    part: _Part,
    manager,
    direction: np.ndarray,
    base_offset: np.ndarray,
    cap: float,
    samples: int,
    tolerance: float,
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
    transform = np.eye(4)
    clear = 0.0
    for s in offsets:
        translation = direction * float(s) + base_offset
        transform[:3, 3] = translation
        is_colliding, contacts = manager.in_collision_single(
            part.mesh, transform=transform, return_data=True
        )
        if is_colliding:
            depth = max((contact.depth for contact in contacts), default=0.0)
            if depth > tolerance:
                return clear
        clear = float(s)
    return clear


def _exit_travel(
    part: _Part,
    static_min: np.ndarray,
    static_max: np.ndarray,
    direction: np.ndarray,
    base_offset: np.ndarray | None = None,
) -> float:
    """Distance along `direction` until the part's AABB clears the assembly.

    AABB overlap ends as soon as the boxes separate on ANY axis, so the
    travel is the cheapest separating axis (taking the max instead explodes
    for directions with tiny components). Capped at the assembly diagonal
    and never zero: a part already outside still gets an animation travel
    of its own extent plus margin so the insertion reads clearly.
    """
    bbox_min = part.bbox_min + (base_offset if base_offset is not None else 0.0)
    bbox_max = part.bbox_max + (base_offset if base_offset is not None else 0.0)

    travel = float("inf")
    for axis in range(3):
        d = float(direction[axis])
        if d > 1e-6:
            needed = float(static_max[axis] - bbox_min[axis])
            travel = min(travel, max(needed / d, 0.0))
        elif d < -1e-6:
            needed = float(bbox_max[axis] - static_min[axis])
            travel = min(travel, max(needed / -d, 0.0))
    if travel == float("inf"):
        travel = 0.0

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
) -> bool:
    """Densely sample translations of the part and check for collisions.

    Surface contact up to `tolerance` is allowed so sliding fits (pins in
    bores, rails in channels) remain removable; threaded fasteners pass a
    larger thread-depth tolerance along their own axis.
    """
    if end <= start:
        return False
    samples = min(
        max(samples, int((end - start) / MAX_SAMPLE_SPACING_MM) + 1),
        MAX_PATH_SAMPLES,
    )
    offsets = np.linspace(start, end, samples, endpoint=True)[1:]
    transform = np.eye(4)
    for s in offsets:
        translation = direction * float(s)
        if base_offset is not None:
            translation = translation + base_offset
        transform[:3, 3] = translation
        is_colliding, contacts = manager.in_collision_single(
            part.mesh, transform=transform, return_data=True
        )
        if is_colliding:
            depth = max((contact.depth for contact in contacts), default=0.0)
            if depth > tolerance:
                return False
    return True


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
