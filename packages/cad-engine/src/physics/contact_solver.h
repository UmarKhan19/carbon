#pragma once

/// Contact detection and resolution for rigid body physics.
/// Uses SDF-based collision from Phase 1/2 for contact detection,
/// and impulse-based resolution for contact response.

#include "collision/sdf_collision.h"
#include "physics/rigid_body.h"
#include <vector>

namespace carbon::physics {

/// A resolved contact between two rigid bodies.
struct BodyContact {
    int body_a;           ///< Index of first body (-1 for ground).
    int body_b;           ///< Index of second body.
    Vec3 position;        ///< World-space contact position.
    Vec3 normal;          ///< Contact normal (from A toward B).
    float depth;          ///< Penetration depth (positive = penetrating).
};

/// Configuration for contact solving.
struct ContactConfig {
    float friction_coeff = 0.3f;       ///< Coulomb friction coefficient.
    float restitution = 0.0f;          ///< Coefficient of restitution (0 = inelastic).
    float contact_stiffness = 1e4f;    ///< Penalty contact stiffness (N/m).
    float contact_damping = 100.0f;    ///< Penalty contact damping (Ns/m).
    float baumgarte_factor = 0.2f;     ///< Baumgarte stabilization factor.
};

/// Detect contacts between all pairs of bodies using SDF queries.
/// Returns a list of contacts with depth and normal information.
std::vector<BodyContact> detect_contacts(
    const std::vector<RigidBody>& bodies);

/// Detect contacts between a single body and a ground plane.
/// The ground plane is defined by a point and a normal.
std::vector<BodyContact> detect_ground_contacts(
    const std::vector<RigidBody>& bodies,
    const Vec3& ground_point = Vec3(0, 0, 0),
    const Vec3& ground_normal = Vec3(0, 1, 0));

/// Apply penalty-based contact forces to bodies.
/// Modifies the force/torque accumulators on each body.
void apply_contact_forces(
    std::vector<RigidBody>& bodies,
    const std::vector<BodyContact>& contacts,
    const ContactConfig& config = {});

/// Apply impulse-based contact resolution (velocity-level correction).
/// Used after integration to prevent penetration.
void resolve_contacts_impulse(
    std::vector<RigidBody>& bodies,
    const std::vector<BodyContact>& contacts,
    const ContactConfig& config = {});

} // namespace carbon::physics
