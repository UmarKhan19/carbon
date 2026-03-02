#pragma once

/// Rigid body representation for physics simulation.
/// Stores mass, inertia, state (position, orientation, velocities), and mesh/SDF.

#include "collision/sdf.h"
#include "geometry/types.h"
#include <string>

namespace carbon::physics {

/// State of a rigid body at a point in time.
struct BodyState {
    Vec3 position{0, 0, 0};
    Quat orientation = Quat::Identity();
    Vec3 linear_velocity{0, 0, 0};
    Vec3 angular_velocity{0, 0, 0};

    /// Transform a point from body-local to world space.
    Vec3 to_world(const Vec3& local) const {
        return orientation * local + position;
    }

    /// Build an Isometry from this state.
    Isometry to_isometry() const {
        Isometry iso;
        iso.rotation = orientation;
        iso.translation = position;
        return iso;
    }
};

/// A rigid body in the physics simulation.
struct RigidBody {
    std::string id;
    std::string name;

    // Mass properties
    float mass = 1.0f;
    Eigen::Matrix3f inertia = Eigen::Matrix3f::Identity();
    Eigen::Matrix3f inertia_inv = Eigen::Matrix3f::Identity();

    // Current state
    BodyState state;

    // Accumulated forces/torques for the current step
    Vec3 force{0, 0, 0};
    Vec3 torque{0, 0, 0};

    // Geometry
    const TriMesh* mesh = nullptr;    ///< Borrowed pointer to mesh data.
    SDFGrid sdf;                       ///< Precomputed SDF in body-local space.

    // Flags
    bool is_static = false;            ///< Static bodies don't move.

    /// Compute inertia tensor for a box with given half-extents and mass.
    static Eigen::Matrix3f box_inertia(float mass, const Vec3& half_extents) {
        float x2 = half_extents.x() * half_extents.x();
        float y2 = half_extents.y() * half_extents.y();
        float z2 = half_extents.z() * half_extents.z();
        Eigen::Matrix3f I = Eigen::Matrix3f::Zero();
        I(0, 0) = mass / 3.0f * (y2 + z2);
        I(1, 1) = mass / 3.0f * (x2 + z2);
        I(2, 2) = mass / 3.0f * (x2 + y2);
        return I;
    }

    /// Compute world-space inertia tensor from body-space inertia.
    Eigen::Matrix3f world_inertia() const {
        Eigen::Matrix3f R = state.orientation.toRotationMatrix();
        return R * inertia * R.transpose();
    }

    /// Compute world-space inverse inertia tensor.
    Eigen::Matrix3f world_inertia_inv() const {
        Eigen::Matrix3f R = state.orientation.toRotationMatrix();
        return R * inertia_inv * R.transpose();
    }

    /// Clear accumulated forces and torques.
    void clear_forces() {
        force.setZero();
        torque.setZero();
    }

    /// Apply a force at the center of mass.
    void apply_force(const Vec3& f) { force += f; }

    /// Apply a torque.
    void apply_torque(const Vec3& t) { torque += t; }

    /// Apply a force at a world-space point (generates torque).
    void apply_force_at(const Vec3& f, const Vec3& world_point) {
        force += f;
        torque += (world_point - state.position).cross(f);
    }

    /// Get the world-space AABB of this body.
    AABB world_aabb() const {
        if (!mesh) return {};
        return mesh->world_aabb(state.to_isometry());
    }
};

} // namespace carbon::physics
