"""Planner core tests over synthetic geometry (no STEP/OCCT required)."""

import numpy as np
import pytest

trimesh = pytest.importorskip("trimesh")
pytest.importorskip("fcl")

from app.plan import _greedy_disassembly, _Part, _plan_parts  # noqa: E402


def _box_part(node_id: str, extents, center, name: str | None = None) -> _Part:
    mesh = trimesh.creation.box(extents=extents)
    mesh.apply_translation(center)
    bounds = mesh.bounds
    return _Part(
        node_id=node_id,
        name=name or node_id,
        mesh=mesh,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )


def _mesh_part(node_id: str, mesh, name: str | None = None) -> _Part:
    bounds = mesh.bounds
    return _Part(
        node_id=node_id,
        name=name or node_id,
        mesh=mesh,
        bbox_min=np.array(bounds[0]),
        bbox_max=np.array(bounds[1]),
        is_proxy=False,
    )


def _plan(parts):
    return _greedy_disassembly(parts, trimesh, clearance=0.5, path_samples=40)


def _plan_full(parts):
    """Full pipeline: classification + rigid merge + greedy disassembly."""
    warnings: list[str] = []
    outcome = _plan_parts(
        parts, trimesh, clearance=0.5, path_samples=40, warnings=warnings
    )
    return outcome, warnings


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


def test_captive_parts_merge_or_flag_never_forced():
    # A box captive inside a shell can never separate from it: with exactly
    # one blocker, the pair is one rigid unit by definition — merged, not
    # flagged, never given a fabricated motion. With MULTIPLE blockers
    # (nested shells), the captive part is flagged and fades in.
    def hollow(outer_extent, cavity_extent, name):
        outer = trimesh.creation.box(
            extents=(outer_extent, outer_extent, outer_extent)
        )
        cavity = trimesh.creation.box(
            extents=(cavity_extent, cavity_extent, cavity_extent)
        )
        return _mesh_part(name, outer.difference(cavity))

    # Single blocker: inner merges into its shell
    outcome, warnings = _plan_full(
        [hollow(50, 40, "shell"), _box_part("inner", (30, 30, 30), (0, 0, 0))]
    )
    assert outcome.tiers["forced"] == 0
    assert outcome.tiers["flagged"] == 0
    assert outcome.merged_into.get("inner") == "shell"
    assert outcome.sequence == ["shell"]
    assert any("rigid unit" in warning for warning in warnings)

    # Multiple blockers: the innermost part flags (fades in), and the
    # inner shell — left with a single blocker — merges into the outer
    outcome, warnings = _plan_full(
        [
            hollow(70, 60, "outer-shell"),
            hollow(50, 40, "inner-shell"),
            _box_part("core", (30, 30, 30), (0, 0, 0)),
        ]
    )
    by_id = {entry.node_id: entry for entry in outcome.planned}
    assert outcome.tiers["forced"] == 0
    assert by_id["core"].tier == "flagged"
    assert by_id["core"].motion["type"] == "none"
    assert len(by_id["core"].blocked_by) >= 2
    assert outcome.merged_into.get("inner-shell") == "outer-shell"


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


def test_screw_unscrews_through_its_threaded_mate():
    # Solid thread model: screw shaft r5.0 in a plate bore r4.6 — a real
    # 0.4mm interference. The plate is detected as the screw's threaded
    # mate, so travel along the screw's own axis tolerates that steady
    # interference and the screw exits through its bore instead of being
    # flagged. No blanket allowance exists for any other contact.
    plate = trimesh.creation.box(extents=(40, 40, 10))
    plate.apply_translation((0, 0, 5))
    bore = trimesh.creation.cylinder(radius=4.6, height=20)
    bore.apply_translation((0, 0, 5))
    plate = plate.difference(bore)
    plate_part = _mesh_part("plate", plate)

    shaft = trimesh.creation.cylinder(radius=5.0, height=24)
    shaft.apply_translation((0, 0, 4))
    head = trimesh.creation.cylinder(radius=8.0, height=4)
    head.apply_translation((0, 0, 18))
    screw = shaft.union(head)
    screw_part = _mesh_part("screw", screw, name="Screw M5x30")

    outcome, _warnings = _plan_full([plate_part, screw_part])
    by_id = {entry.node_id: entry for entry in outcome.planned}

    assert outcome.tiers["flagged"] == 0
    assert by_id["screw"].motion["type"] == "linear"
    direction = by_id["screw"].removal_direction
    assert direction is not None
    # Out through the bore: the head side (+Z); -Z is blocked because the
    # head cannot pass through its own mate beyond the thread interference
    assert direction[2] > 0.9
    assert outcome.sequence == ["plate", "screw"]


def test_fastener_never_tunnels_a_thin_unmated_cover():
    # A 1mm cover floats just above the screw head. It is NOT a mate, so
    # the strict tolerance applies: the old blanket thread allowance
    # (1.5mm) let the screw tunnel straight up through it whenever its
    # axis was tried head-first. Now the screw must exit the open way
    # (down, -Z) — never through the cover.
    shaft = trimesh.creation.cylinder(radius=5.0, height=30)
    shaft.apply_translation((0, 0, 15))
    head = trimesh.creation.cylinder(radius=8.0, height=4)
    head.apply_translation((0, 0, 32))
    screw = shaft.union(head)
    screw_part = _mesh_part("screw", screw, name="Screw M5x40")

    cover = trimesh.creation.box(extents=(40, 40, 1))
    cover.apply_translation((0, 0, 35.2))
    cover_part = _mesh_part("cover", cover)

    outcome, _warnings = _plan_full([screw_part, cover_part])
    by_id = {entry.node_id: entry for entry in outcome.planned}

    assert outcome.tiers["flagged"] == 0
    screw_direction = by_id["screw"].removal_direction
    assert screw_direction is not None
    assert screw_direction[2] < -0.9


def test_embedded_logo_merges_into_its_host():
    # A logo/text solid fully inside its host produces no surface contacts
    # at all — containment testing must catch it and plan the pair as one
    # rigid unit under the host's nodeId.
    base = _box_part("base", (80, 80, 10), (0, 0, 5))
    host = _box_part("host", (40, 40, 20), (0, 0, 20.05))
    logo = _box_part("logo", (10, 10, 2), (0, 0, 20.05), name="3D LOGO")

    outcome, warnings = _plan_full([base, host, logo])

    assert outcome.merged_into == {"logo": "host"}
    assert "logo" not in outcome.sequence
    assert set(outcome.sequence) == {"base", "host"}
    by_id = {entry.node_id: entry for entry in outcome.planned}
    assert by_id["host"].motion["type"] == "linear"
    assert outcome.tiers["flagged"] == 0
    assert any("rigid unit" in warning for warning in warnings)


def test_captive_washer_ordering_with_real_fastener_names():
    # Same captive-washer fixture as the legacy test, but through the full
    # pipeline with realistic catalog names — classification (axis-only
    # candidates for both fasteners) must preserve plate -> washer -> bolt.
    plate = trimesh.creation.box(extents=(60, 60, 20))
    plate.apply_translation((0, 0, 10))
    hole = trimesh.creation.cylinder(radius=5.2, height=30)
    hole.apply_translation((0, 0, 10))
    plate = plate.difference(hole)
    plate_part = _mesh_part("plate", plate)

    washer = trimesh.creation.annulus(r_min=4.4, r_max=9.0, height=1.5)
    washer.apply_translation((0, 0, 20.85))
    washer_part = _mesh_part("washer", washer, name="Washer DIN 125")

    shaft = trimesh.creation.cylinder(radius=4.0, height=22)
    shaft.apply_translation((0, 0, 11))
    head = trimesh.creation.cylinder(radius=8.0, height=5)
    head.apply_translation((0, 0, 24.2))
    bolt = shaft.union(head)
    bolt_part = _mesh_part("bolt", bolt, name="Hex Bolt M8")

    outcome, _warnings = _plan_full([plate_part, washer_part, bolt_part])

    assert outcome.tiers["flagged"] == 0
    assert outcome.sequence.index("plate") < outcome.sequence.index("washer")
    assert outcome.sequence.index("washer") < outcome.sequence.index("bolt")
    by_id = {entry.node_id: entry for entry in outcome.planned}
    assert by_id["bolt"].motion["type"] == "linear"
    direction = by_id["bolt"].removal_direction
    assert direction is not None
    assert abs(direction[2]) > 0.9


def test_sequence_orders_fasteners_right_after_their_stack():
    # Structure assembles bottom-up and a fastener installs as soon as the
    # parts it secures are present — not scattered to the end. The screw's
    # clearance hole through the bracket derives no constraint, but the
    # bracket's own insertion sweep collides with the seated screw head,
    # which forces bracket-before-screw; the tapped plate precedes the
    # screw via the stack preference.
    plate = trimesh.creation.box(extents=(80, 80, 10))
    plate.apply_translation((0, 0, 5))
    tapped = trimesh.creation.cylinder(radius=4.6, height=20)
    tapped.apply_translation((0, 0, 5))
    plate = plate.difference(tapped)
    plate_part = _mesh_part("plate", plate)

    bracket = trimesh.creation.box(extents=(30, 30, 8))
    bracket.apply_translation((0, 0, 14))
    clearance = trimesh.creation.cylinder(radius=5.4, height=20)
    clearance.apply_translation((0, 0, 14))
    bracket = bracket.difference(clearance)
    bracket_part = _mesh_part("bracket", bracket)

    shaft = trimesh.creation.cylinder(radius=5.0, height=18)
    shaft.apply_translation((0, 0, 11))
    head = trimesh.creation.cylinder(radius=8.0, height=4)
    head.apply_translation((0, 0, 22))
    screw = shaft.union(head)
    screw_part = _mesh_part("screw", screw, name="Screw M6x20")

    block = _box_part("block", (20, 20, 20), (30, 0, 22))

    outcome, _warnings = _plan_full(
        [plate_part, bracket_part, screw_part, block]
    )

    assert outcome.sequence[0] == "plate"
    assert outcome.sequence.index("bracket") < outcome.sequence.index("screw")
    # Securing fastener fires the moment its joint completes
    assert (
        outcome.sequence.index("screw")
        == outcome.sequence.index("bracket") + 1
    )
    assert outcome.tiers["flagged"] == 0
    assert all(entry.verified for entry in outcome.planned)


def test_bolt_precedes_nut_in_assembly():
    # The threaded pair is contact-exempt during planning, so no collision
    # edge derives between bolt and nut — the explicit stack preference
    # must order the bolt (rod) before its nut (disc), never a nut
    # floating in air waiting for its bolt.
    plate = trimesh.creation.box(extents=(60, 60, 10))
    plate.apply_translation((0, 0, 5))
    bore = trimesh.creation.cylinder(radius=5.4, height=20)
    bore.apply_translation((0, 0, 5))
    plate = plate.difference(bore)
    plate_part = _mesh_part("plate", plate)

    shaft = trimesh.creation.cylinder(radius=5.0, height=22)
    shaft.apply_translation((0, 0, 3))
    head = trimesh.creation.cylinder(radius=9.0, height=4)
    head.apply_translation((0, 0, 16))
    bolt = shaft.union(head)
    bolt_part = _mesh_part("bolt", bolt, name="Hex Bolt M10")

    nut = trimesh.creation.annulus(r_min=4.6, r_max=9.0, height=5)
    nut.apply_translation((0, 0, -4.5))
    nut_part = _mesh_part("nut", nut, name="Hex Nut M10")

    outcome, _warnings = _plan_full([plate_part, bolt_part, nut_part])

    assert outcome.sequence.index("plate") < outcome.sequence.index("bolt")
    assert outcome.sequence.index("bolt") < outcome.sequence.index("nut")
    assert outcome.tiers["flagged"] == 0
    assert all(entry.verified for entry in outcome.planned)
    assert outcome.verified_count == 3


def test_plan_is_deterministic():
    # Same input, same plan — twice through the full pipeline.
    def build():
        base = _box_part("base", (100, 100, 10), (0, 0, 5))
        left = _box_part("left", (20, 20, 20), (-30, 0, 20.05))
        right = _box_part("right", (20, 20, 20), (30, 0, 20.05))
        return [base, left, right]

    first, _ = _plan_full(build())
    second, _ = _plan_full(build())

    assert first.sequence == second.sequence
    assert [entry.motion for entry in first.planned] == [
        entry.motion for entry in second.planned
    ]
    assert [entry.verified for entry in first.planned] == [
        entry.verified for entry in second.planned
    ]


def _keyed_hub_parts():
    """Hub keyed to a shaft: the key is captive in the hub's blind pocket
    and proud into the shaft's full-length slot. Hub and key cannot move
    alone (they drag each other), but hub+key slide off the shaft end as
    one unit."""
    shaft = trimesh.creation.cylinder(radius=10, height=120)
    shaft.apply_transform(
        trimesh.transformations.rotation_matrix(np.pi / 2, (0, 1, 0))
    )
    slot = trimesh.creation.box(extents=(124, 4.4, 6))
    slot.apply_translation((0, 0, 8.5))
    shaft = shaft.difference(slot)
    shaft_part = _mesh_part("shaft", shaft)

    key = trimesh.creation.box(extents=(20, 4, 5))
    key.apply_translation((0, 0, 8.2))
    key_part = _mesh_part("key", key)

    hub = trimesh.creation.cylinder(radius=18, height=30)
    hub.apply_transform(
        trimesh.transformations.rotation_matrix(np.pi / 2, (0, 1, 0))
    )
    bore = trimesh.creation.cylinder(radius=10.2, height=40)
    bore.apply_transform(
        trimesh.transformations.rotation_matrix(np.pi / 2, (0, 1, 0))
    )
    pocket = trimesh.creation.box(extents=(24, 4.8, 2.2))
    pocket.apply_translation((0, 0, 10.0))
    hub = hub.difference(bore).difference(pocket)
    hub_part = _mesh_part("hub", hub)

    return shaft_part, key_part, hub_part


def test_group_search_finds_the_keyed_hub_unit():
    # Direct unit test of the subassembly search on a stuck state: neither
    # hub nor key moves alone, but the pair slides off the shaft end.
    from trimesh.collision import CollisionManager

    from app.plan import _plan_group_removal

    shaft_part, key_part, hub_part = _keyed_hub_parts()
    remaining = {
        part.node_id: part for part in (shaft_part, key_part, hub_part)
    }
    manager = CollisionManager()
    for part in remaining.values():
        manager.add_object(part.node_id, part.mesh)

    group = _plan_group_removal(remaining, manager, 40, {}, trimesh)

    assert group is not None
    members, combined, entry = group
    assert set(members) == {"hub", "key"}
    assert combined.node_id == "hub"  # largest member is the representative
    assert entry.tier == "group"
    assert entry.motion["type"] == "linear"
    assert entry.removal_direction is not None
    assert abs(entry.removal_direction[0]) > 0.9  # off the shaft end


def test_group_unit_flows_through_sequence_and_payload(monkeypatch):
    # Plumbing test for subassembly units: with single-part removals stubbed
    # out (a pure translational fixture always lets the complement slide
    # instead — greedy rightly prefers that), the stuck state must fall
    # through to group extraction, and the unit must flow into the
    # sequence, the groups payload, and per-member entries.
    import app.plan as plan_module

    monkeypatch.setattr(
        plan_module, "_plan_removal", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        plan_module, "_plan_escape", lambda *args, **kwargs: None
    )

    shaft_part, key_part, hub_part = _keyed_hub_parts()
    outcome, _warnings = _plan_full([shaft_part, key_part, hub_part])
    by_id = {entry.node_id: entry for entry in outcome.planned}

    assert outcome.tiers["flagged"] == 0
    assert outcome.tiers["group"] == 1
    assert len(outcome.groups) == 1
    group = next(iter(outcome.groups.values()))
    assert set(group["partNodeIds"]) == {"hub", "key"}
    assert group["motion"]["type"] == "linear"
    # Both members carry the shared motion and groupId
    assert by_id["hub"].group_id == by_id["key"].group_id
    assert by_id["hub"].group_id is not None
    assert by_id["hub"].motion == by_id["key"].motion
    assert by_id["hub"].tier == "group"
    assert by_id["key"].tier == "group"
    # Forward verification runs against the real geometry
    assert by_id["hub"].verified and by_id["key"].verified
    # The unit's members sit adjacently in the sequence, after the shaft
    assert outcome.sequence[0] == "shaft"
    hub_index = outcome.sequence.index("hub")
    key_index = outcome.sequence.index("key")
    assert abs(hub_index - key_index) == 1


def test_stud_installs_after_everything_it_clamps():
    # A headless stud through a bracket into a tapped plate: no head means
    # no collision constraint ever derives between bracket and stud — only
    # the joint edge (the bracket's material surrounds the stud's shank)
    # forces the clamped bracket to precede its fastener.
    plate = trimesh.creation.box(extents=(80, 80, 10))
    plate.apply_translation((0, 0, 5))
    tapped = trimesh.creation.cylinder(radius=4.6, height=20)
    tapped.apply_translation((0, 0, 5))
    plate = plate.difference(tapped)
    plate_part = _mesh_part("plate", plate)

    bracket = trimesh.creation.box(extents=(30, 30, 8))
    bracket.apply_translation((0, 0, 14))
    clearance = trimesh.creation.cylinder(radius=5.6, height=20)
    clearance.apply_translation((0, 0, 14))
    bracket = bracket.difference(clearance)
    bracket_part = _mesh_part("bracket", bracket)

    stud = trimesh.creation.cylinder(radius=5.0, height=26)
    stud.apply_translation((0, 0, 15))
    stud_part = _mesh_part("stud", stud, name="Threaded Stud M10")

    outcome, _warnings = _plan_full([plate_part, bracket_part, stud_part])

    assert outcome.tiers["flagged"] == 0
    assert outcome.sequence.index("plate") < outcome.sequence.index("bracket")
    assert outcome.sequence.index("bracket") < outcome.sequence.index("stud")
    assert all(entry.verified for entry in outcome.planned)


def test_slip_fit_washer_still_precedes_its_bolt():
    # A slip-over washer whose bore is WIDER than the bolt head: no
    # collision constraint exists in either direction — only the joint
    # edge (the bolt's shank passes through the washer) orders it before
    # the bolt.
    plate = trimesh.creation.box(extents=(60, 60, 12))
    plate.apply_translation((0, 0, 6))
    tapped = trimesh.creation.cylinder(radius=4.6, height=30)
    tapped.apply_translation((0, 0, 6))
    plate = plate.difference(tapped)
    plate_part = _mesh_part("plate", plate)

    washer = trimesh.creation.annulus(r_min=8.6, r_max=14.0, height=2)
    washer.apply_translation((0, 0, 13.1))
    washer_part = _mesh_part("washer", washer, name="Washer oversize")

    shaft = trimesh.creation.cylinder(radius=5.0, height=18)
    shaft.apply_translation((0, 0, 5))
    head = trimesh.creation.cylinder(radius=8.0, height=4)
    head.apply_translation((0, 0, 16))
    bolt = shaft.union(head)
    bolt_part = _mesh_part("bolt", bolt, name="Hex Bolt M10")

    outcome, _warnings = _plan_full([plate_part, washer_part, bolt_part])

    assert outcome.tiers["flagged"] == 0
    assert outcome.sequence.index("washer") < outcome.sequence.index("bolt")
    assert outcome.sequence.index("plate") < outcome.sequence.index("washer")


def test_big_central_parts_assemble_first():
    # Free choice everywhere (everything lifts straight out): the sequence
    # must open with the big central block, not the small outboard ones.
    slab = _box_part("slab", (200, 200, 10), (0, 0, 5))
    center = _box_part("center", (60, 60, 60), (0, 0, 40.05))
    left = _box_part("left", (15, 15, 15), (-70, 0, 17.55))
    right = _box_part("right", (15, 15, 15), (70, 0, 17.55))

    outcome, _warnings = _plan_full([slab, center, left, right])

    assert outcome.sequence[0] == "slab"
    assert outcome.sequence[1] == "center"
    assert set(outcome.sequence[2:]) == {"left", "right"}
    assert all(entry.verified for entry in outcome.planned)


def test_snug_counterbore_bolt_slides_through_its_joint():
    # The bolt's flange head drags through the bracket's counterbore with
    # 0.3mm of interference (a snug fit — on tessellated CAD this is what
    # tight clearances read as). The bracket is in the bolt's JOINT, and
    # along its bore axis a fastener is allowed sliding engagement with
    # its joint members — so the bolt exits through the hole instead of
    # being flagged.
    plate = trimesh.creation.box(extents=(60, 60, 10))
    plate.apply_translation((0, 0, 5))
    tapped = trimesh.creation.cylinder(radius=4.6, height=20)
    tapped.apply_translation((0, 0, 5))
    plate = plate.difference(tapped)
    plate_part = _mesh_part("plate", plate)

    bracket = trimesh.creation.box(extents=(40, 40, 12))
    bracket.apply_translation((0, 0, 16))
    through = trimesh.creation.cylinder(radius=5.6, height=30)
    through.apply_translation((0, 0, 16))
    counterbore = trimesh.creation.cylinder(radius=7.7, height=6)
    counterbore.apply_translation((0, 0, 19.2))
    bracket = bracket.difference(through).difference(counterbore)
    bracket_part = _mesh_part("bracket", bracket)

    shaft = trimesh.creation.cylinder(radius=5.0, height=22)
    shaft.apply_translation((0, 0, 8))
    head = trimesh.creation.cylinder(radius=8.0, height=3.5)
    head.apply_translation((0, 0, 20.75))
    bolt = shaft.union(head)
    bolt_part = _mesh_part("bolt", bolt, name="Bolt M10 Flange")

    outcome, _warnings = _plan_full([plate_part, bracket_part, bolt_part])
    by_id = {entry.node_id: entry for entry in outcome.planned}

    assert outcome.tiers["flagged"] == 0
    assert by_id["bolt"].motion["type"] == "linear"
    direction = by_id["bolt"].removal_direction
    assert direction is not None
    assert direction[2] > 0.9  # out through the counterbore, head side
    assert outcome.sequence.index("plate") < outcome.sequence.index("bracket")
    assert outcome.sequence.index("bracket") < outcome.sequence.index("bolt")
    assert all(entry.verified for entry in outcome.planned)


def test_part_escapes_along_tilted_contact_normal():
    # A block seated flush in a tilted pocket: every world axis digs into a
    # pocket wall, and the block has no rod/disc symmetry. The seated
    # contact normals ARE the pocket's tilt — the planner must offer them
    # as candidate directions and lift the block out along the tilt.
    tilt = trimesh.transformations.rotation_matrix(np.pi / 6, (0, 1, 0))
    normal = np.array(
        [float(np.sin(np.pi / 6)), 0.0, float(np.cos(np.pi / 6))]
    )

    base = trimesh.creation.box(extents=(120, 80, 60))
    base.apply_translation((0, 0, 30))
    pocket_cut = trimesh.creation.box(extents=(40, 40, 40))
    pocket_cut.apply_transform(tilt)
    pocket_cut.apply_translation((0, 0, 58))
    base = base.difference(pocket_cut)
    base_part = _mesh_part("base", base)

    # Seat the block flush on the pocket floor, 0.05mm into it so seated
    # contacts (and their normals) exist:
    # center = cut_center + R·(0, 0, -(20 - 6)) - 0.05·normal
    block = trimesh.creation.box(extents=(39.5, 39.5, 12))
    block.apply_transform(tilt)
    block.apply_translation((-7.025, 0, 45.831))
    block_part = _mesh_part("block", block)

    outcome, _warnings = _plan_full([base_part, block_part])
    by_id = {entry.node_id: entry for entry in outcome.planned}

    assert outcome.tiers["flagged"] == 0
    assert by_id["block"].motion["type"] == "linear"
    direction = by_id["block"].removal_direction
    assert direction is not None
    assert abs(float(np.dot(np.asarray(direction), normal))) > 0.98
    assert by_id["block"].verified
