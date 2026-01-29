"""
glTF/GLB Writer

Converts parsed mesh data to glTF 2.0 binary format (GLB)
"""

import io
import struct
import json
from typing import Optional
import numpy as np

from .parser import Mesh


class GltfWriter:
    """
    Writes mesh data to glTF 2.0 binary format (GLB)

    Creates a single GLB file with:
    - All meshes as separate mesh primitives
    - Node hierarchy matching the assembly structure
    - Materials with colors from STEP file
    """

    def __init__(self):
        self._buffer = io.BytesIO()
        self._buffer_views = []
        self._accessors = []
        self._meshes = []
        self._nodes = []
        self._materials = []
        self._material_cache = {}

    def write_glb(
        self,
        meshes: list[Mesh],
        hierarchy: dict,
    ) -> bytes:
        """
        Write meshes and hierarchy to GLB format

        Args:
            meshes: List of Mesh objects with vertices, normals, indices
            hierarchy: Assembly hierarchy dict

        Returns:
            GLB file as bytes
        """
        self._buffer = io.BytesIO()
        self._buffer_views = []
        self._accessors = []
        self._meshes = []
        self._nodes = []
        self._materials = []
        self._material_cache = {}

        # Create a map from mesh ID to index
        mesh_id_to_index = {}

        # Process each mesh
        for mesh in meshes:
            mesh_index = self._add_mesh(mesh)
            mesh_id_to_index[mesh.id] = mesh_index

        # Build node hierarchy
        root_node_index = self._build_nodes(hierarchy, mesh_id_to_index)

        # Pad buffer to 4-byte alignment
        while self._buffer.tell() % 4 != 0:
            self._buffer.write(b"\x00")

        # Get buffer data
        buffer_data = self._buffer.getvalue()

        # Create glTF JSON
        gltf = {
            "asset": {
                "version": "2.0",
                "generator": "Carbon CAD Service",
            },
            "scene": 0,
            "scenes": [{"nodes": [root_node_index]}],
            "nodes": self._nodes,
            "meshes": self._meshes,
            "materials": self._materials,
            "accessors": self._accessors,
            "bufferViews": self._buffer_views,
            "buffers": [{"byteLength": len(buffer_data)}],
        }

        # Serialize JSON
        gltf_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")

        # Pad JSON to 4-byte alignment
        while len(gltf_json) % 4 != 0:
            gltf_json += b" "

        # Create GLB
        glb = io.BytesIO()

        # GLB header (12 bytes)
        glb.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(gltf_json) + 8 + len(buffer_data)))

        # JSON chunk
        glb.write(struct.pack("<I4s", len(gltf_json), b"JSON"))
        glb.write(gltf_json)

        # BIN chunk
        glb.write(struct.pack("<I4s", len(buffer_data), b"BIN\x00"))
        glb.write(buffer_data)

        return glb.getvalue()

    def _add_mesh(self, mesh: Mesh) -> int:
        """Add a mesh and return its index"""
        # Get or create material
        material_index = self._get_or_create_material(mesh.color)

        # Add vertex data
        vertices_accessor = self._add_accessor(
            mesh.vertices,
            "VEC3",
            5126,  # FLOAT
            target=34962,  # ARRAY_BUFFER
        )

        # Add normal data
        normals_accessor = self._add_accessor(
            mesh.normals,
            "VEC3",
            5126,  # FLOAT
            target=34962,  # ARRAY_BUFFER
        )

        # Add index data
        indices_accessor = self._add_accessor(
            mesh.indices.flatten(),
            "SCALAR",
            5125,  # UNSIGNED_INT
            target=34963,  # ELEMENT_ARRAY_BUFFER
        )

        # Create mesh primitive
        primitive = {
            "attributes": {
                "POSITION": vertices_accessor,
                "NORMAL": normals_accessor,
            },
            "indices": indices_accessor,
        }

        if material_index is not None:
            primitive["material"] = material_index

        # Add mesh
        mesh_index = len(self._meshes)
        self._meshes.append({
            "name": mesh.name,
            "primitives": [primitive],
        })

        return mesh_index

    def _add_accessor(
        self,
        data: np.ndarray,
        type_str: str,
        component_type: int,
        target: Optional[int] = None,
    ) -> int:
        """Add data to buffer and create accessor"""
        # Ensure correct dtype
        if component_type == 5126:  # FLOAT
            data = data.astype(np.float32)
        elif component_type == 5125:  # UNSIGNED_INT
            data = data.astype(np.uint32)
        elif component_type == 5123:  # UNSIGNED_SHORT
            data = data.astype(np.uint16)

        # Get byte offset
        byte_offset = self._buffer.tell()

        # Write data
        self._buffer.write(data.tobytes())

        # Pad to 4-byte alignment
        while self._buffer.tell() % 4 != 0:
            self._buffer.write(b"\x00")

        byte_length = data.nbytes

        # Create buffer view
        buffer_view = {
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": byte_length,
        }
        if target:
            buffer_view["target"] = target

        buffer_view_index = len(self._buffer_views)
        self._buffer_views.append(buffer_view)

        # Create accessor
        accessor = {
            "bufferView": buffer_view_index,
            "byteOffset": 0,
            "componentType": component_type,
            "count": len(data) if type_str == "SCALAR" else len(data),
            "type": type_str,
        }

        # Add min/max for POSITION
        if type_str == "VEC3":
            accessor["count"] = len(data)
            if data.size > 0:
                accessor["min"] = data.min(axis=0).tolist()
                accessor["max"] = data.max(axis=0).tolist()

        accessor_index = len(self._accessors)
        self._accessors.append(accessor)

        return accessor_index

    def _get_or_create_material(self, color: Optional[list[float]]) -> Optional[int]:
        """Get or create a material with the given color"""
        if color is None:
            # Default gray material
            color = [0.8, 0.8, 0.8, 1.0]

        # Create cache key
        cache_key = tuple(round(c, 3) for c in color)

        if cache_key in self._material_cache:
            return self._material_cache[cache_key]

        # Create new material
        material = {
            "pbrMetallicRoughness": {
                "baseColorFactor": color,
                "metallicFactor": 0.1,
                "roughnessFactor": 0.5,
            },
        }

        material_index = len(self._materials)
        self._materials.append(material)
        self._material_cache[cache_key] = material_index

        return material_index

    def _build_nodes(
        self,
        hierarchy: dict,
        mesh_id_to_index: dict[str, int],
    ) -> int:
        """Recursively build glTF nodes from hierarchy"""
        # Use hierarchy ID as node name so xeokit entity.id matches tree node.id
        # This enables tree<->viewer selection sync
        node = {
            "name": hierarchy.get("id", "Node"),
        }

        # Add mesh reference if this is a part
        if hierarchy.get("type") == "part":
            mesh_index = mesh_id_to_index.get(hierarchy.get("id"))
            if mesh_index is not None:
                node["mesh"] = mesh_index

        # Add transform if present
        transform = hierarchy.get("transform")
        if transform:
            node["matrix"] = transform

        # Process children
        child_indices = []
        for child in hierarchy.get("children", []):
            child_index = self._build_nodes(child, mesh_id_to_index)
            child_indices.append(child_index)

        if child_indices:
            node["children"] = child_indices

        # Add node
        node_index = len(self._nodes)
        self._nodes.append(node)

        return node_index
