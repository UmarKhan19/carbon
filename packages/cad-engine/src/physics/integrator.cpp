#include "physics/integrator.h"

#include <cmath>

namespace carbon::physics {

// ---------------------------------------------------------------------------
// Semi-implicit Euler
// ---------------------------------------------------------------------------

void integrate_semi_implicit_euler(
    std::vector<RigidBody>& bodies, float dt) {

    for (auto& body : bodies) {
        if (body.is_static) continue;

        // Update linear velocity from force
        Vec3 accel = body.force / body.mass;
        body.state.linear_velocity += accel * dt;

        // Update angular velocity from torque
        Eigen::Matrix3f I_inv = body.world_inertia_inv();
        Vec3 angular_accel = I_inv * (body.torque -
            body.state.angular_velocity.cross(body.world_inertia() * body.state.angular_velocity));
        body.state.angular_velocity += angular_accel * dt;

        // Update position from (updated) velocity
        body.state.position += body.state.linear_velocity * dt;

        // Update orientation from angular velocity (quaternion integration)
        Vec3 w = body.state.angular_velocity;
        float w_mag = w.norm();
        if (w_mag > 1e-8f) {
            float half_angle = w_mag * dt * 0.5f;
            Vec3 axis = w / w_mag;
            Quat dq(std::cos(half_angle),
                     axis.x() * std::sin(half_angle),
                     axis.y() * std::sin(half_angle),
                     axis.z() * std::sin(half_angle));
            body.state.orientation = (dq * body.state.orientation).normalized();
        }
    }
}

// ---------------------------------------------------------------------------
// BDF1 (Backward Euler — simplified linearized version)
// ---------------------------------------------------------------------------

void integrate_bdf1(
    std::vector<RigidBody>& bodies, float dt) {
    // Simplified BDF1: for rigid bodies without joint constraints,
    // this reduces to semi-implicit Euler with damping stabilization.
    // Full implicit solve would require Newton iteration over the coupled system,
    // which we can add if needed for very stiff contacts.

    float damping = 0.999f; // Slight velocity damping for stability

    for (auto& body : bodies) {
        if (body.is_static) continue;

        // Update linear velocity
        Vec3 accel = body.force / body.mass;
        body.state.linear_velocity += accel * dt;
        body.state.linear_velocity *= damping;

        // Update angular velocity
        Eigen::Matrix3f I_inv = body.world_inertia_inv();
        Vec3 gyro = body.state.angular_velocity.cross(
            body.world_inertia() * body.state.angular_velocity);
        Vec3 angular_accel = I_inv * (body.torque - gyro);
        body.state.angular_velocity += angular_accel * dt;
        body.state.angular_velocity *= damping;

        // Update position
        body.state.position += body.state.linear_velocity * dt;

        // Update orientation
        Vec3 w = body.state.angular_velocity;
        float w_mag = w.norm();
        if (w_mag > 1e-8f) {
            float half_angle = w_mag * dt * 0.5f;
            Vec3 axis = w / w_mag;
            Quat dq(std::cos(half_angle),
                     axis.x() * std::sin(half_angle),
                     axis.y() * std::sin(half_angle),
                     axis.z() * std::sin(half_angle));
            body.state.orientation = (dq * body.state.orientation).normalized();
        }
    }
}

} // namespace carbon::physics
