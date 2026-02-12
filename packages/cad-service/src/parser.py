"""
STEP Parser using PythonOCC (OpenCascade)

This module handles:
- Reading STEP files with full assembly structure
- Extracting part hierarchy, names, colors, transforms
- Tessellating B-Rep geometry to triangle meshes

Uses a robust two-stage approach:
1. Simple STEPControl_Reader for reliable shape extraction
2. Optional XCAF enhancement for hierarchy/colors (if available)
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional, List

import numpy as np

# PythonOCC imports - Basic STEP reading
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone

# PythonOCC imports - XCAF for assembly structure (optional)
from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
from OCC.Core.TDF import TDF_LabelSequence, TDF_Label
from OCC.Core.TDataStd import TDataStd_Name
from OCC.Core.TCollection import TCollection_ExtendedString

# PythonOCC imports - Tessellation
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.BRep import BRep_Tool
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_COMPOUND
from OCC.Core.TopoDS import topods
from OCC.Core.Quantity import Quantity_Color
from OCC.Core.XCAFDoc import XCAFDoc_ColorSurf, XCAFDoc_ColorCurv, XCAFDoc_ColorGen
from OCC.Core.gp import gp_Trsf

# PythonOCC imports - Shape fixing/healing
from OCC.Core.ShapeFix import ShapeFix_Shape

logger = logging.getLogger(__name__)

@dataclass
class Mesh:
    """Triangle mesh data for a single part"""

    id: str
    name: str
    vertices: np.ndarray  # Nx3 float32
    normals: np.ndarray  # Nx3 float32
    indices: np.ndarray  # Mx3 uint32
    color: Optional[list[float]] = None  # RGBA
    transform: Optional[list[float]] = None  # 4x4 matrix

@dataclass
class HierarchyNode:
    """Node in assembly hierarchy"""

    id: str
    name: str
    type: str  # "assembly" | "part"
    children: list["HierarchyNode"] = field(default_factory=list)
    transform: Optional[list[float]] = None
    color: Optional[list[float]] = None

class StepParser:
    """
    STEP file parser using PythonOCC

    Uses a two-stage approach for robustness:
    1. STEPControl_Reader for basic shape extraction (more reliable)
    2. STEPCAFControl_Reader for assembly hierarchy (optional enhancement)
    """

    def __init__(
        self,
        linear_deflection: float = 0.1,
        angular_deflection: float = 0.5,
    ):
        """
        Initialize parser with tessellation settings

        Args:
            linear_deflection: Maximum distance from mesh to actual geometry (mm)
            angular_deflection: Maximum angle deviation (degrees)
        """
        self.linear_deflection = linear_deflection
        self.angular_deflection = np.radians(angular_deflection)
        self._meshes: list[Mesh] = []
        self._part_count = 0

    def parse(self, step_path: str) -> dict:
        """
        Parse a STEP file and return hierarchy + meshes

        Tries XCAF first (has names, colors, hierarchy), falls back to simple.
        """
        logger.info(f"Starting parse of: {step_path}")

        # Try XCAF FIRST (preserves hierarchy, colors, names)
        try:
            logger.info("Attempting XCAF parsing for assembly support...")
            result = self._parse_with_xcaf(step_path)
            if result["success"]:
                logger.info(f"XCAF parsing successful: {result['part_count']} parts")
                return result
            logger.debug(f"XCAF parsing failed: {result.get('error')}")
        except Exception as e:
            logger.warning(f"XCAF parsing exception: {e}")

        # Fall back to simple reader (more robust but no names/colors)
        try:
            logger.debug("Attempting simple STEPControl_Reader (robust mode)...")
            result = self._parse_simple(step_path)
            if result["success"]:
                logger.info(f"Simple parsing successful: {result['part_count']} parts")
                return result
            logger.debug(f"Simple parsing failed: {result.get('error')}")
        except Exception as e:
            logger.warning(f"Simple parsing exception: {e}")

        return {
            "success": False,
            "error": "Both XCAF and simple parsing failed",
        }

    def _parse_simple(self, step_path: str) -> dict:
        """
        Parse STEP file using simple STEPControl_Reader

        This is more robust but doesn't preserve assembly hierarchy.
        """
        self._meshes = []
        self._part_count = 0

        reader = STEPControl_Reader()

        # Read the file
        status = reader.ReadFile(step_path)
        if status != IFSelect_RetDone:
            return {
                "success": False,
                "error": f"Failed to read STEP file (status: {status})",
            }

        # Check what we got
        nb_roots = reader.NbRootsForTransfer()
        logger.debug(f"Found {nb_roots} root shapes")

        if nb_roots == 0:
            return {
                "success": False,
                "error": "No shapes found in STEP file",
            }

        # Transfer all roots
        reader.TransferRoots()

        # Get the combined shape
        shape = reader.OneShape()
        if shape is None or shape.IsNull():
            return {
                "success": False,
                "error": "Failed to transfer shapes from STEP file",
            }

        # Process the shape - extract solids
        root_nodes = []
        self._extract_shapes_recursive(shape, root_nodes, "Model")

        if not root_nodes and not self._meshes:
            return {
                "success": False,
                "error": "No valid geometry found in STEP file",
            }

        # Create hierarchy
        if len(root_nodes) == 1:
            hierarchy = root_nodes[0]
        else:
            hierarchy = HierarchyNode(
                id=str(uuid.uuid4()),
                name="Assembly",
                type="assembly",
                children=root_nodes,
            )

        return {
            "success": True,
            "hierarchy": self._hierarchy_to_dict(hierarchy),
            "meshes": self._meshes,
            "part_count": self._part_count,
        }

    def _extract_shapes_recursive(
        self,
        shape,
        nodes: List[HierarchyNode],
        base_name: str,
        depth: int = 0,
    ):
        """Recursively extract shapes from compound/assembly"""
        if depth > 20:  # Prevent infinite recursion
            return

        shape_type = shape.ShapeType()

        # Handle compounds (assemblies)
        if shape_type == TopAbs_COMPOUND:
            children = []
            explorer = TopExp_Explorer(shape, TopAbs_SOLID)
            solid_idx = 0

            while explorer.More():
                try:
                    solid = explorer.Current()
                    if solid and not solid.IsNull():
                        solid_idx += 1
                        name = f"{base_name}_Part{solid_idx}"
                        mesh = self._tessellate_shape(solid, str(uuid.uuid4()), name, None)
                        if mesh:
                            self._meshes.append(mesh)
                            self._part_count += 1
                            children.append(HierarchyNode(
                                id=mesh.id,
                                name=name,
                                type="part",
                            ))
                except Exception as e:
                    logger.debug(f"Error processing solid: {e}")
                explorer.Next()

            # If no solids found, try shells
            if solid_idx == 0:
                explorer = TopExp_Explorer(shape, TopAbs_SHELL)
                shell_idx = 0
                while explorer.More():
                    try:
                        shell = explorer.Current()
                        if shell and not shell.IsNull():
                            shell_idx += 1
                            name = f"{base_name}_Shell{shell_idx}"
                            mesh = self._tessellate_shape(shell, str(uuid.uuid4()), name, None)
                            if mesh:
                                self._meshes.append(mesh)
                                self._part_count += 1
                                children.append(HierarchyNode(
                                    id=mesh.id,
                                    name=name,
                                    type="part",
                                ))
                    except Exception as e:
                        logger.debug(f"Error processing shell: {e}")
                    explorer.Next()

            if children:
                nodes.append(HierarchyNode(
                    id=str(uuid.uuid4()),
                    name=base_name,
                    type="assembly",
                    children=children,
                ))

        # Handle solids directly
        elif shape_type == TopAbs_SOLID:
            name = f"{base_name}_Solid"
            mesh = self._tessellate_shape(shape, str(uuid.uuid4()), name, None)
            if mesh:
                self._meshes.append(mesh)
                self._part_count += 1
                nodes.append(HierarchyNode(
                    id=mesh.id,
                    name=name,
                    type="part",
                ))

        # Handle shells
        elif shape_type == TopAbs_SHELL:
            name = f"{base_name}_Shell"
            mesh = self._tessellate_shape(shape, str(uuid.uuid4()), name, None)
            if mesh:
                self._meshes.append(mesh)
                self._part_count += 1
                nodes.append(HierarchyNode(
                    id=mesh.id,
                    name=name,
                    type="part",
                ))

    def _parse_with_xcaf(self, step_path: str) -> dict:
        """
        Parse STEP file using XCAF reader for full assembly support

        Preserves hierarchy, names, colors, and transforms.
        """
        self._meshes = []
        self._part_count = 0

        # Create XCAF document
        # NOTE: Use plain string, not TCollection_ExtendedString (official PythonOCC pattern)
        try:
            doc = TDocStd_Document("pythonocc-doc-step-import")
        except Exception as doc_err:
            return {"success": False, "error": f"Failed to create document: {doc_err}"}

        # Create STEP reader with extended CAD support
        try:
            reader = STEPCAFControl_Reader()
        except Exception as reader_err:
            return {"success": False, "error": f"Failed to create reader: {reader_err}"}

        reader.SetColorMode(True)
        reader.SetNameMode(True)
        reader.SetLayerMode(True)

        # Read STEP file
        status = reader.ReadFile(step_path)
        if status != IFSelect_RetDone:
            return {
                "success": False,
                "error": f"Failed to read STEP file (status: {status})",
            }

        # Transfer to document
        try:
            transfer_result = reader.Transfer(doc)
        except Exception as transfer_err:
            return {"success": False, "error": f"Transfer failed: {transfer_err}"}

        if not transfer_result:
            return {
                "success": False,
                "error": "Failed to transfer STEP data to document",
            }

        # Get shape and color tools
        try:
            shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
            color_tool = XCAFDoc_DocumentTool.ColorTool(doc.Main())
            if shape_tool is None:
                return {"success": False, "error": "Failed to get shape tool"}
            if color_tool is None:
                logger.warning("color_tool is None, colors will not be extracted")
        except Exception as tool_err:
            return {"success": False, "error": f"Failed to get document tools: {tool_err}"}

        # Get root shapes (top-level assemblies/parts)
        try:
            root_labels = TDF_LabelSequence()
            shape_tool.GetFreeShapes(root_labels)
        except Exception as root_err:
            return {"success": False, "error": f"Failed to get root shapes: {root_err}"}

        num_roots = root_labels.Length()

        if num_roots == 0:
            return {
                "success": False,
                "error": "No shapes found in STEP file",
            }

        # Limit roots for safety
        max_roots = 1000
        if num_roots > max_roots:
            num_roots = max_roots

        # Build hierarchy from root shapes
        root_nodes = []
        for i in range(1, num_roots + 1):
            label = root_labels.Value(i)
            # Fresh visited set per root
            node = self._process_label(label, shape_tool, color_tool, depth=0, visited=set())
            if node:
                root_nodes.append(node)

        if not root_nodes:
            return {
                "success": False,
                "error": "Failed to process any shapes from STEP file",
            }

        # Create root hierarchy
        if len(root_nodes) == 1:
            hierarchy = root_nodes[0]
        else:
            hierarchy = HierarchyNode(
                id=str(uuid.uuid4()),
                name="Assembly",
                type="assembly",
                children=root_nodes,
            )

        return {
            "success": True,
            "hierarchy": self._hierarchy_to_dict(hierarchy),
            "meshes": self._meshes,
            "part_count": self._part_count,
        }

    def _process_label(
        self,
        label: TDF_Label,
        shape_tool,
        color_tool,
        depth: int = 0,
        visited: Optional[set] = None,
    ) -> Optional[HierarchyNode]:
        """Process a label (shape) in the XCAF document"""
        try:
            # Safety: depth limit to prevent infinite recursion
            if depth > 50:
                logger.warning(f"XCAF recursion depth exceeded at {depth}")
                return None

            # Safety: track visited labels to detect cycles
            if visited is None:
                visited = set()

            # Check for null label
            if label is None or label.IsNull():
                return None

            # Try to get a unique identifier for cycle detection
            try:
                label_entry = label.EntryDumpToString()
                if label_entry in visited:
                    return None
                visited.add(label_entry)
            except Exception:
                pass  # If we can't get entry, continue anyway

            # Get shape name
            name = self._get_label_name(label)
            if not name:
                name = f"Part_{self._part_count + 1}"

            node_id = str(uuid.uuid4())

            # Check if this is an assembly or part
            # Wrap in try/except - IsAssembly can throw C++ exceptions
            try:
                is_assembly = shape_tool.IsAssembly(label)
            except Exception as asm_err:
                return None

            if is_assembly:
                # Get child components
                children = []
                child_labels = TDF_LabelSequence()

                try:
                    shape_tool.GetComponents(label, child_labels)
                except Exception as comp_err:
                    # Return empty assembly rather than failing
                    return HierarchyNode(
                        id=node_id,
                        name=name,
                        type="assembly",
                        children=[],
                    )

                num_children = child_labels.Length()

                # Safety: limit children
                max_children = 10000
                if num_children > max_children:
                    num_children = max_children

                for i in range(1, num_children + 1):
                    try:
                        child_label = child_labels.Value(i)
                        if child_label is None:
                            continue

                        # Check IsNull carefully
                        try:
                            if child_label.IsNull():
                                continue
                        except Exception:
                            continue

                        # Get the referred shape (for instances)
                        # Wrap IsReference in try/except
                        try:
                            is_ref = shape_tool.IsReference(child_label)
                        except Exception as ref_err:
                            is_ref = False

                        if is_ref:
                            # Get name from reference label first (instance names are often more meaningful)
                            ref_instance_name = self._get_label_name(child_label)

                            ref_label = TDF_Label()
                            try:
                                shape_tool.GetReferredShape(child_label, ref_label)
                            except Exception as get_ref_err:
                                continue

                            if ref_label is None:
                                continue
                            try:
                                if ref_label.IsNull():
                                    continue
                            except Exception:
                                continue

                            child_node = self._process_label(ref_label, shape_tool, color_tool, depth + 1, visited)

                            # If reference had a name, use it (instance names take priority)
                            if child_node and ref_instance_name:
                                child_node.name = ref_instance_name
                        else:
                            child_node = self._process_label(child_label, shape_tool, color_tool, depth + 1, visited)

                        if child_node:
                            # Apply transformation from this reference
                            transform = self._get_label_transform(child_label, shape_tool)
                            if transform:
                                child_node.transform = transform
                            children.append(child_node)
                    except Exception as child_err:
                        logger.warning(f"Error processing child component: {child_err}")
                        continue

                # IMPORTANT: Flatten single-child assemblies
                # XCAF wraps each part instance in its own assembly - unwrap it
                if len(children) == 1 and children[0].type == "part":
                    # Return the single part directly, using our name if better
                    single_child = children[0]
                    # Use the assembly name if child has generic name
                    if single_child.name.startswith("Part_") and not name.startswith("Part_"):
                        single_child.name = name
                    return single_child

                # Only return assembly if it has multiple children or sub-assemblies
                return HierarchyNode(
                    id=node_id,
                    name=name,
                    type="assembly",
                    children=children,
                )

            else:
                # This is a part - tessellate it
                # Wrap GetShape in try/except - it can throw C++ exceptions
                try:
                    shape = shape_tool.GetShape(label)
                except Exception as shape_err:
                    return None

                # Check shape validity carefully
                if shape is None:
                    return None

                try:
                    if shape.IsNull():
                        return None
                except Exception as null_check_err:
                    return None

                # Get color using the shape (for GetInstanceColor)
                # This is wrapped in defensive code to prevent C++ crashes
                color = self._get_shape_color(label, shape, color_tool)

                # Tessellate the shape
                mesh = self._tessellate_shape(shape, node_id, name, color)
                if mesh:
                    self._meshes.append(mesh)
                    self._part_count += 1

                    return HierarchyNode(
                        id=node_id,
                        name=name,
                        type="part",
                        color=color,
                    )

            return None

        except Exception as e:
            logger.warning(f"Error processing label: {e}")
            return None

    def _get_label_name(self, label: TDF_Label) -> Optional[str]:
        """Get the name from a label"""
        try:
            # Use the static Get method which returns the name directly
            # This is the correct PythonOCC pattern for TDataStd_Name
            name = TDataStd_Name.Get(label)
            if name:
                name_str = name.Get().ToExtString()
                if name_str and name_str.strip():
                    return name_str.strip()
        except Exception as e:
            # Expected when no name attribute exists - don't log every one
            pass

        return None

    def _get_label_transform(self, label: TDF_Label, shape_tool) -> Optional[list[float]]:
        """Get the transformation matrix for a component"""
        try:
            location = shape_tool.GetLocation(label)
            if location.IsIdentity():
                return None

            trsf = location.Transformation()
            return self._trsf_to_matrix(trsf)
        except Exception:
            return None

    def _trsf_to_matrix(self, trsf: gp_Trsf) -> list[float]:
        """Convert OCC transformation to 4x4 matrix (column-major)"""
        mat = []
        for row in range(1, 4):
            for col in range(1, 5):
                mat.append(trsf.Value(row, col))
        mat.extend([0.0, 0.0, 0.0, 1.0])

        matrix_4x4 = np.array(mat).reshape(4, 4)
        return matrix_4x4.T.flatten().tolist()

    def _get_shape_color(self, label: TDF_Label, shape, color_tool) -> Optional[list[float]]:
        """Get the color assigned to a shape via instance color or label fallback."""
        if color_tool is None:
            return None

        try:
            color = Quantity_Color()
            color_set = False

            # Color type enums (properly typed for XCAF API)
            color_types = [
                (XCAFDoc_ColorSurf, "Surface"),
                (XCAFDoc_ColorCurv, "Curve"),
                (XCAFDoc_ColorGen, "Generic"),
            ]

            # FIRST: Try instance colors on the shape (this is where STEP colors often are!)
            # This is the pattern from official PythonOCC DataExchange.py
            # Be VERY careful - GetInstanceColor can throw C++ exceptions
            if shape is not None:
                try:
                    # Extra null check - IsNull() itself might throw if shape is corrupted
                    is_null = shape.IsNull()
                    if not is_null:
                        # Try each color type separately to isolate failures
                        for color_type, type_name in color_types:
                            try:
                                if color_tool.GetInstanceColor(shape, color_type, color):
                                    color_set = True
                                    break
                            except Exception as inner_e:
                                # Don't log every failure - too verbose
                                continue
                except Exception as shape_e:
                    pass

            # SECOND: Fall back to label colors
            if not color_set and label is not None:
                try:
                    is_label_null = label.IsNull()
                    if not is_label_null:
                        for color_type, type_name in color_types:
                            try:
                                if color_tool.GetColor(label, color_type, color):
                                    color_set = True
                                    break
                            except Exception as inner_e:
                                # Don't log every failure - too verbose
                                continue
                except Exception as label_e:
                    pass

            if color_set:
                return [color.Red(), color.Green(), color.Blue(), 1.0]

        except Exception as e:
            pass

        return None

    def _tessellate_shape(
        self,
        shape,
        part_id: str,
        name: str,
        color: Optional[list[float]],
    ) -> Optional[Mesh]:
        """Tessellate a shape to triangle mesh"""
        try:
            if shape is None or shape.IsNull():
                return None

            # Try to fix/heal the shape first (helps prevent crashes)
            try:
                fixer = ShapeFix_Shape(shape)
                fixer.Perform()
                fixed_shape = fixer.Shape()
                if fixed_shape and not fixed_shape.IsNull():
                    shape = fixed_shape
            except Exception:
                pass  # Continue with original shape

            # Perform tessellation - try multiple tolerance levels for robustness
            tolerances = [1.0, 0.5, 0.1]  # Start with larger tolerance
            mesh_done = False

            for tol in tolerances:
                try:
                    mesh_algo = BRepMesh_IncrementalMesh(
                        shape,
                        tol,  # Linear deflection
                        False,  # Relative
                        0.5,  # Angular deflection (larger = fewer triangles, more stable)
                        False,  # No parallel
                    )
                    mesh_algo.Perform()
                    if mesh_algo.IsDone():
                        mesh_done = True
                        break
                except Exception:
                    continue

            if not mesh_done:
                logger.warning(f"Tessellation failed for {name}")
                return None

            # Collect triangles from all faces
            all_vertices = []
            all_indices = []
            vertex_offset = 0

            explorer = TopExp_Explorer(shape, TopAbs_FACE)

            while explorer.More():
                try:
                    face = explorer.Current()
                    if face is None or face.IsNull():
                        explorer.Next()
                        continue

                    location = TopLoc_Location()
                    triangulation = BRep_Tool.Triangulation(face, location)
                    if triangulation is None:
                        explorer.Next()
                        continue

                    trsf = location.Transformation()

                    # Get nodes (vertices)
                    nb_nodes = triangulation.NbNodes()
                    for i in range(1, nb_nodes + 1):
                        try:
                            node = triangulation.Node(i)
                            node = node.Transformed(trsf)
                            all_vertices.append([node.X(), node.Y(), node.Z()])
                        except Exception:
                            continue

                    # Get triangles
                    nb_triangles = triangulation.NbTriangles()
                    for i in range(1, nb_triangles + 1):
                        try:
                            tri = triangulation.Triangle(i)
                            n1, n2, n3 = tri.Get()
                            all_indices.append([
                                vertex_offset + n1 - 1,
                                vertex_offset + n2 - 1,
                                vertex_offset + n3 - 1,
                            ])
                        except Exception:
                            continue

                    vertex_offset += nb_nodes
                except Exception as face_err:
                    logger.debug(f"Error processing face: {face_err}")
                finally:
                    explorer.Next()

            if not all_vertices or not all_indices:
                return None

            vertices = np.array(all_vertices, dtype=np.float32)
            indices = np.array(all_indices, dtype=np.uint32)
            normals = self._calculate_normals(vertices, indices)

            return Mesh(
                id=part_id,
                name=name,
                vertices=vertices,
                normals=normals,
                indices=indices,
                color=color,
            )

        except Exception as e:
            logger.warning(f"Tessellation exception for {name}: {e}")
            return None

    def _calculate_normals(
        self,
        vertices: np.ndarray,
        indices: np.ndarray,
    ) -> np.ndarray:
        """Calculate smooth vertex normals from triangle indices"""
        normals = np.zeros_like(vertices)

        for tri in indices:
            v0 = vertices[tri[0]]
            v1 = vertices[tri[1]]
            v2 = vertices[tri[2]]

            edge1 = v1 - v0
            edge2 = v2 - v0
            face_normal = np.cross(edge1, edge2)

            normals[tri[0]] += face_normal
            normals[tri[1]] += face_normal
            normals[tri[2]] += face_normal

        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        lengths[lengths == 0] = 1
        normals = normals / lengths

        return normals.astype(np.float32)

    def _hierarchy_to_dict(self, node: HierarchyNode) -> dict:
        """Convert HierarchyNode to dictionary for JSON serialization"""
        result = {
            "id": node.id,
            "name": node.name,
            "type": node.type,
            "children": [self._hierarchy_to_dict(c) for c in node.children],
        }
        if node.transform:
            result["transform"] = node.transform
        if node.color:
            result["color"] = node.color
        return result
