#pragma once

/// Physics simulation engine (RedMax-inspired).
/// Manages rigid bodies, forces, contact detection/resolution, and time stepping.

#include "physics/contact_solver.h"
#include "physics/integrator.h"
#include "physics/rigid_body.h"
#include <functional>
#include <vector>

namespace carbon::physics {

/// Configuration for the physics simulation.
struct PhysicsConfig {
    float dt = 0.01f;                   ///< Time step (seconds).
    int max_steps = 1000;               ///< Maximum simulation steps.
    Vec3 gravity{0, -9.81f, 0};         ///< Gravity acceleration.
    IntegrationMethod integrator = IntegrationMethod::SemiImplicitEuler;
    ContactConfig contact;              ///< Contact solving parameters.
    bool enable_ground = true;          ///< Enable ground plane at y=0.
    Vec3 ground_point{0, 0, 0};         ///< Ground plane point.
    Vec3 ground_normal{0, 1, 0};        ///< Ground plane normal.
};

/// Result of a physics simulation run.
struct PhysicsResult {
    int steps_taken = 0;
    float total_time = 0.0f;
    bool converged = false;              ///< True if all bodies came to rest.
    std::vector<BodyState> final_states; ///< Final state of each body.
    float max_displacement = 0.0f;       ///< Maximum displacement of any body.
};

/// Main physics simulation engine.
class PhysicsSimulation {
public:
    explicit PhysicsSimulation(const PhysicsConfig& config = {});

    /// Add a rigid body to the simulation. Returns its index.
    int add_body(RigidBody body);

    /// Get a body by index.
    RigidBody& body(int index) { return bodies_[index]; }
    const RigidBody& body(int index) const { return bodies_[index]; }

    /// Get all bodies.
    std::vector<RigidBody>& bodies() { return bodies_; }
    const std::vector<RigidBody>& bodies() const { return bodies_; }

    /// Number of bodies.
    size_t num_bodies() const { return bodies_.size(); }

    /// Step the simulation forward by one time step.
    /// Returns the contacts detected during this step.
    std::vector<BodyContact> step();

    /// Run the simulation for the configured number of steps.
    /// Optionally provide a callback invoked after each step.
    /// The callback receives (step_index, contacts) and can return false to stop.
    PhysicsResult run(
        std::function<bool(int, const std::vector<BodyContact>&)> callback = nullptr);

    /// Check if all non-static bodies have come to rest.
    bool is_at_rest(float velocity_threshold = 0.01f,
                    float angular_threshold = 0.01f) const;

    /// Get current simulation time.
    float current_time() const { return current_time_; }

    /// Reset the simulation to initial states.
    void reset();

    /// Access config.
    const PhysicsConfig& config() const { return config_; }

private:
    PhysicsConfig config_;
    std::vector<RigidBody> bodies_;
    std::vector<BodyState> initial_states_;
    float current_time_ = 0.0f;
    int step_count_ = 0;
};

} // namespace carbon::physics
