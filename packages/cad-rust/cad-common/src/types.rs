//! Core geometric types used throughout the CAD system.

use nalgebra::{Matrix4, Point3, UnitQuaternion, Vector3};
use serde::{Deserialize, Serialize};

/// A 3D position in world space.
pub type Position3D = Point3<f32>;

/// A 3D direction vector.
pub type Direction3D = Vector3<f32>;

/// A 4x4 transformation matrix.
pub type Transform4x4 = Matrix4<f32>;

/// A rotation represented as a unit quaternion.
pub type Rotation3D = UnitQuaternion<f32>;

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoundingBox {
    pub min: Position3D,
    pub max: Position3D,
}

impl BoundingBox {
    /// Create a new bounding box from min and max points.
    pub fn new(min: Position3D, max: Position3D) -> Self {
        Self { min, max }
    }

    /// Get the center of the bounding box.
    pub fn center(&self) -> Position3D {
        Point3::new(
            (self.min.x + self.max.x) / 2.0,
            (self.min.y + self.max.y) / 2.0,
            (self.min.z + self.max.z) / 2.0,
        )
    }

    /// Get the size of the bounding box.
    pub fn size(&self) -> Vector3<f32> {
        self.max - self.min
    }

    /// Check if a point is inside the bounding box.
    pub fn contains(&self, point: &Position3D) -> bool {
        point.x >= self.min.x
            && point.x <= self.max.x
            && point.y >= self.min.y
            && point.y <= self.max.y
            && point.z >= self.min.z
            && point.z <= self.max.z
    }

    /// Merge two bounding boxes.
    pub fn merge(&self, other: &BoundingBox) -> BoundingBox {
        BoundingBox {
            min: Point3::new(
                self.min.x.min(other.min.x),
                self.min.y.min(other.min.y),
                self.min.z.min(other.min.z),
            ),
            max: Point3::new(
                self.max.x.max(other.max.x),
                self.max.y.max(other.max.y),
                self.max.z.max(other.max.z),
            ),
        }
    }
}

/// Triangle mesh for collision detection and rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriangleMesh {
    /// Vertex positions.
    pub vertices: Vec<Position3D>,
    /// Triangle indices (triplets of vertex indices).
    pub indices: Vec<[u32; 3]>,
    /// Vertex normals (optional).
    pub normals: Option<Vec<Direction3D>>,
}

impl TriangleMesh {
    /// Create a new empty mesh.
    pub fn new() -> Self {
        Self {
            vertices: Vec::new(),
            indices: Vec::new(),
            normals: None,
        }
    }

    /// Get the number of triangles.
    pub fn triangle_count(&self) -> usize {
        self.indices.len()
    }

    /// Get the number of vertices.
    pub fn vertex_count(&self) -> usize {
        self.vertices.len()
    }

    /// Compute the bounding box of the mesh.
    pub fn bounding_box(&self) -> Option<BoundingBox> {
        if self.vertices.is_empty() {
            return None;
        }

        let mut min = self.vertices[0];
        let mut max = self.vertices[0];

        for v in &self.vertices {
            min.x = min.x.min(v.x);
            min.y = min.y.min(v.y);
            min.z = min.z.min(v.z);
            max.x = max.x.max(v.x);
            max.y = max.y.max(v.y);
            max.z = max.z.max(v.z);
        }

        Some(BoundingBox::new(min, max))
    }
}

impl Default for TriangleMesh {
    fn default() -> Self {
        Self::new()
    }
}
