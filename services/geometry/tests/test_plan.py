"""Planner core tests over synthetic geometry (no STEP/OCCT required)."""

import numpy as np
import pytest

trimesh = pytest.importorskip("trimesh")
pytest.importorskip("fcl")

from app.plan import _greedy_disassembly, _Part  # noqa: E402


def _box_part(node_id: str, extents, center) -> _Part:
    mesh = trimesh.creation.box(extents=extents)
    mesh.apply_translation(center)
    bounds = mesh.bounds
    return _Part(
        node_id=node_id,
        name=node_id,
        mesh=mesh,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )


def _plan(parts):
    return _greedy_disassembly(parts, trimesh, clearance=0.5, path_samples=40)


def test_stacked_boxes_disassemble_top_down():
    base = _box_part("base", (100, 100, 10), (0, 0, 5))
    top = _box_part("top", (40, 40, 10), (0, 0, 15.05))

    planned, sequence, tiers = _plan([base, top])

    by_id = {entry.node_id: entry for entry in planned}
    # The top box lifts straight up; the base is placed (no motion)
    assert by_id["top"].motion["type"] == "linear"
    assert by_id["top"].removal_direction == [0.0, 0.0, 1.0]
    # Insertion direction is the reverse of removal
    assert by_id["top"].motion["direction"] == [-0.0, -0.0, -1.0]
    assert by_id["top"].motion["distance"] > 0
    assert by_id["base"].motion["type"] == "none"

    # Assembly order: base first, then the top box
    assert sequence == ["base", "top"]
    assert tiers["unplanned"] == 0


def test_pin_in_bore_slides_out_along_axis():
    # A plate with a clearance hole and a pin through it: the pin's only
    # straight-line escape is +/-Z along the bore.
    plate = trimesh.creation.box(extents=(60, 60, 20))
    cylinder = trimesh.creation.cylinder(radius=5.2, height=30)
    plate = plate.difference(cylinder)
    bounds = plate.bounds
    plate_part = _Part(
        node_id="plate",
        name="plate",
        mesh=plate,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )

    pin = trimesh.creation.cylinder(radius=5.0, height=40)
    pin_bounds = pin.bounds
    pin_part = _Part(
        node_id="pin",
        name="pin",
        mesh=pin,
        bbox_min=np.array(pin_bounds[0]),
        bbox_max=np.array(pin_bounds[1]),
        is_proxy=False,
    )

    planned, sequence, _tiers = _plan([plate_part, pin_part])
    by_id = {entry.node_id: entry for entry in planned}

    assert by_id["pin"].motion["type"] == "linear"
    direction = by_id["pin"].removal_direction
    assert abs(direction[2]) == 1.0 and direction[0] == 0.0 and direction[1] == 0.0
    assert sequence[0] == "plate"


def test_enclosed_box_forces_best_effort_motion():
    # A box fully enclosed in a hollow shell cannot translate out. Tier 4
    # still animates it: the shell gets a forced best-effort linear motion
    # (with blockers + a warning) and the inner box becomes the base.
    outer = trimesh.creation.box(extents=(50, 50, 50))
    cavity = trimesh.creation.box(extents=(40, 40, 40))
    shell = outer.difference(cavity)
    bounds = shell.bounds
    shell_part = _Part(
        node_id="shell",
        name="shell",
        mesh=shell,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )

    inner = _box_part("inner", (30, 30, 30), (0, 0, 0))

    warnings: list[str] = []
    planned, sequence, tiers = _greedy_disassembly(
        [shell_part, inner],
        trimesh,
        clearance=0.5,
        path_samples=40,
        warnings=warnings,
    )
    by_id = {entry.node_id: entry for entry in planned}

    assert tiers["unplanned"] == 0
    assert tiers["forced"] >= 1
    # Only the base (first in sequence) may keep motion "none"
    for entry in planned:
        if entry.node_id == sequence[0]:
            assert entry.motion["type"] == "none"
        else:
            assert entry.motion["type"] != "none"
    assert by_id["shell"].motion["type"] == "linear"
    assert by_id["shell"].confidence == "low"
    assert "inner" in by_id["shell"].blocked_by
    assert any("shell" in warning for warning in warnings)


def test_rod_prefers_its_own_axis():
    # A rod lying diagonally on a plate can exit +Z too, but its natural
    # removal is along its own axis — fasteners must leave through their bores
    base = _box_part("base", (200, 200, 10), (0, 0, 5))
    rod = trimesh.creation.cylinder(radius=4, height=80)
    # lay the rod along +X, floating just above the plate
    rotate = trimesh.transformations.rotation_matrix(np.pi / 2, (0, 1, 0))
    rod.apply_transform(rotate)
    rod.apply_translation((0, 0, 14.2))
    bounds = rod.bounds
    rod_part = _Part(
        node_id="rod",
        name="rod",
        mesh=rod,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )

    planned, _sequence, _tiers = _plan([base, rod_part])
    by_id = {entry.node_id: entry for entry in planned}

    direction = by_id["rod"].removal_direction
    assert direction is not None
    # Axis-first: the rod leaves along ±X (its own axis), not +Z
    assert abs(direction[0]) == 1.0
    assert direction[1] == 0.0 and direction[2] == 0.0


def test_blind_pocket_escapes_with_multi_segment_motion():
    # A part in a walled pocket, seated under an interior lip: it must first
    # slide sideways out from under the lip, then lift through the open top.
    # Tier 2's fixed lift-then-slide cannot solve this (its hop length is the
    # part diagonal, which overshoots into the pocket wall) — the tier-3
    # adaptive escape must find the slide-then-lift and emit a multi-segment
    # "L" motion.
    floor = trimesh.creation.box(extents=(60, 60, 5))
    floor.apply_translation((0, 0, 2.5))
    wall_px = trimesh.creation.box(extents=(10, 60, 40))
    wall_px.apply_translation((25, 0, 20))
    wall_nx = trimesh.creation.box(extents=(10, 60, 40))
    wall_nx.apply_translation((-25, 0, 20))
    wall_py = trimesh.creation.box(extents=(60, 10, 40))
    wall_py.apply_translation((0, 25, 20))
    wall_ny = trimesh.creation.box(extents=(60, 10, 40))
    wall_ny.apply_translation((0, -25, 20))
    lip = trimesh.creation.box(extents=(20, 40, 5))
    lip.apply_translation((10, 0, 37.5))
    container = trimesh.util.concatenate(
        [floor, wall_px, wall_nx, wall_py, wall_ny, lip]
    )
    container_part = _Part(
        node_id="container",
        name="container",
        mesh=container,
        bbox_min=np.array(container.bounds[0]),
        bbox_max=np.array(container.bounds[1]),
        is_proxy=False,
    )

    part = _box_part("part", (18, 18, 10), (8, 0, 10))

    planned, sequence, tiers = _plan([container_part, part])
    by_id = {entry.node_id: entry for entry in planned}

    assert tiers["escape"] >= 1
    assert tiers["unplanned"] == 0
    assert sequence[0] == "container"
    assert by_id["container"].motion["type"] == "none"

    motion = by_id["part"].motion
    assert motion["type"] == "L"
    assert len(motion["segments"]) >= 2
    assert by_id["part"].confidence == "low"
    # Insertion reverses the removal: drop in through the open top, then
    # slide +X under the lip into the seated pose
    first, last = motion["segments"][0], motion["segments"][-1]
    assert first["direction"][2] < -0.9
    assert last["direction"][0] > 0.9


def test_captive_washer_assembles_before_its_bolt():
    # Washer captive between a bolt head and the plate: disassembly must pull
    # the bolt first, so assembly order is plate -> washer -> bolt.
    plate = trimesh.creation.box(extents=(60, 60, 20))
    plate.apply_translation((0, 0, 10))
    hole = trimesh.creation.cylinder(radius=5.2, height=30)
    hole.apply_translation((0, 0, 10))
    plate = plate.difference(hole)
    plate_part = _Part(
        node_id="plate",
        name="plate",
        mesh=plate,
        bbox_min=np.array(plate.bounds[0]),
        bbox_max=np.array(plate.bounds[1]),
        is_proxy=False,
    )

    washer = trimesh.creation.annulus(r_min=4.4, r_max=9.0, height=1.5)
    washer.apply_translation((0, 0, 20.85))
    washer_part = _Part(
        node_id="washer",
        name="washer",
        mesh=washer,
        bbox_min=np.array(washer.bounds[0]),
        bbox_max=np.array(washer.bounds[1]),
        is_proxy=False,
    )

    shaft = trimesh.creation.cylinder(radius=4.0, height=22)
    shaft.apply_translation((0, 0, 11))
    head = trimesh.creation.cylinder(radius=8.0, height=5)
    head.apply_translation((0, 0, 24.2))
    bolt = shaft.union(head)
    bolt_part = _Part(
        node_id="bolt",
        name="bolt",
        mesh=bolt,
        bbox_min=np.array(bolt.bounds[0]),
        bbox_max=np.array(bolt.bounds[1]),
        is_proxy=False,
    )

    planned, sequence, _tiers = _plan([plate_part, washer_part, bolt_part])
    by_id = {entry.node_id: entry for entry in planned}

    # The bolt leaves along its axis; the washer follows once the bolt is out
    assert by_id["bolt"].motion["type"] == "linear"
    assert sequence.index("washer") < sequence.index("bolt")
    assert sequence.index("plate") < sequence.index("washer")
