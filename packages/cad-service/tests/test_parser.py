"""
Tests for the STEP parser using PythonOCC

These tests verify:
1. Health check endpoint works
2. STEP files are parsed correctly
3. GLB output is valid
4. Assembly hierarchy is extracted
"""

import base64
import io
import struct
import pytest
from fastapi.testclient import TestClient


def test_health_check():
    """Test that the health check endpoint returns OK"""
    from src.main import app

    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "opencascade_version" in data


def test_root_endpoint():
    """Test root endpoint returns API info"""
    from src.main import app

    client = TestClient(app)
    response = client.get("/")

    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Carbon CAD Service"
    assert "endpoints" in data


def test_parse_invalid_extension():
    """Test that non-STEP files are rejected"""
    from src.main import app

    client = TestClient(app)

    # Create a fake file with wrong extension
    files = {"file": ("model.obj", b"some content", "application/octet-stream")}

    response = client.post("/parse", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Invalid file type" in data["error"]


def test_gltf_writer_creates_valid_glb():
    """Test that the GLB writer creates valid binary glTF"""
    import numpy as np
    from src.gltf_writer import GltfWriter
    from src.parser import Mesh

    # Create a simple mesh (triangle)
    mesh = Mesh(
        id="test-part",
        name="TestPart",
        vertices=np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32),
        normals=np.array([[0, 0, 1], [0, 0, 1], [0, 0, 1]], dtype=np.float32),
        indices=np.array([[0, 1, 2]], dtype=np.uint32),
        color=[1.0, 0.0, 0.0, 1.0],
    )

    hierarchy = {
        "id": "root",
        "name": "Root",
        "type": "assembly",
        "children": [
            {"id": "test-part", "name": "TestPart", "type": "part", "children": []}
        ],
    }

    writer = GltfWriter()
    glb_bytes = writer.write_glb([mesh], hierarchy)

    # Verify GLB header
    assert len(glb_bytes) > 12
    magic, version, length = struct.unpack("<4sII", glb_bytes[:12])
    assert magic == b"glTF"
    assert version == 2
    assert length == len(glb_bytes)


def test_hierarchy_to_dict():
    """Test hierarchy conversion to dictionary"""
    from src.parser import HierarchyNode, StepParser

    parser = StepParser()

    node = HierarchyNode(
        id="root",
        name="Assembly",
        type="assembly",
        children=[
            HierarchyNode(
                id="part1",
                name="Part 1",
                type="part",
                color=[1.0, 0.0, 0.0, 1.0],
            )
        ],
    )

    result = parser._hierarchy_to_dict(node)

    assert result["id"] == "root"
    assert result["name"] == "Assembly"
    assert result["type"] == "assembly"
    assert len(result["children"]) == 1
    assert result["children"][0]["name"] == "Part 1"
    assert result["children"][0]["color"] == [1.0, 0.0, 0.0, 1.0]


def test_calculate_normals():
    """Test normal calculation for a simple triangle"""
    import numpy as np
    from src.parser import StepParser

    parser = StepParser()

    # Simple right triangle in XY plane
    vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32)
    indices = np.array([[0, 1, 2]], dtype=np.uint32)

    normals = parser._calculate_normals(vertices, indices)

    # Normal should point in +Z direction
    assert normals.shape == (3, 3)
    # All vertices should have same normal for this simple case
    for n in normals:
        assert abs(n[2] - 1.0) < 0.01  # Z component ~= 1
        assert abs(n[0]) < 0.01  # X component ~= 0
        assert abs(n[1]) < 0.01  # Y component ~= 0


# Integration test - requires actual STEP file
@pytest.mark.skip(reason="Requires sample STEP file")
def test_parse_sample_step_file():
    """Integration test with a real STEP file"""
    from src.main import app

    client = TestClient(app)

    with open("tests/fixtures/sample.step", "rb") as f:
        files = {"file": ("sample.step", f, "application/octet-stream")}
        response = client.post("/parse", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["part_count"] > 0
    assert data["glb_base64"] is not None
    assert data["hierarchy"] is not None

    # Verify GLB can be decoded
    glb_bytes = base64.b64decode(data["glb_base64"])
    assert len(glb_bytes) > 12
