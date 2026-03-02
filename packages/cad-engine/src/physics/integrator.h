#pragma once

/// Time integration for rigid body dynamics.
/// Provides semi-implicit Euler and BDF1 integrators.

#include "physics/rigid_body.h"
#include <vector>

namespace carbon::physics {

/// Integration method.
enum class IntegrationMethod {
    SemiImplicitEuler,  ///< Fast, first-order, good for real-time.
    BDF1                ///< Backward Euler (implicit), stable for stiff contacts.
};

/// Advance all bodies by one time step using semi-implicit Euler integration.
/// Updates velocity from forces, then updates position from velocity.
void integrate_semi_implicit_euler(
    std::vector<RigidBody>& bodies, float dt);

/// Advance all bodies by one time step using BDF1 (backward Euler).
/// More stable for stiff contact dynamics but requires solving a linear system.
/// Uses a simplified linearized approach for rigid body dynamics.
void integrate_bdf1(
    std::vector<RigidBody>& bodies, float dt);

} // namespace carbon::physics
