#include "physics/simulation.h"

namespace carbon::physics {

PhysicsSimulation::PhysicsSimulation(const PhysicsConfig& config)
    : config_(config) {}

int PhysicsSimulation::add_body(RigidBody body) {
    int idx = static_cast<int>(bodies_.size());
    initial_states_.push_back(body.state);
    bodies_.push_back(std::move(body));
    return idx;
}

std::vector<BodyContact> PhysicsSimulation::step() {
    // 1. Clear forces
    for (auto& b : bodies_) {
        b.clear_forces();
    }

    // 2. Apply gravity
    for (auto& b : bodies_) {
        if (!b.is_static) {
            b.apply_force(config_.gravity * b.mass);
        }
    }

    // 3. Detect contacts
    auto contacts = detect_contacts(bodies_);

    // 4. Ground contacts
    if (config_.enable_ground) {
        auto ground = detect_ground_contacts(
            bodies_, config_.ground_point, config_.ground_normal);
        contacts.insert(contacts.end(), ground.begin(), ground.end());
    }

    // 5. Apply contact forces (penalty method)
    apply_contact_forces(bodies_, contacts, config_.contact);

    // 6. Integrate
    switch (config_.integrator) {
    case IntegrationMethod::SemiImplicitEuler:
        integrate_semi_implicit_euler(bodies_, config_.dt);
        break;
    case IntegrationMethod::BDF1:
        integrate_bdf1(bodies_, config_.dt);
        break;
    }

    // 7. Post-step impulse correction
    resolve_contacts_impulse(bodies_, contacts, config_.contact);

    current_time_ += config_.dt;
    step_count_++;
    return contacts;
}

PhysicsResult PhysicsSimulation::run(
    std::function<bool(int, const std::vector<BodyContact>&)> callback) {

    PhysicsResult result;

    // Save initial positions for displacement tracking
    std::vector<Vec3> initial_positions;
    for (const auto& b : bodies_) {
        initial_positions.push_back(b.state.position);
    }

    for (int s = 0; s < config_.max_steps; ++s) {
        auto contacts = step();

        if (callback && !callback(s, contacts)) {
            break;
        }

        // Check for convergence (all at rest), but skip first 10 steps
        // to allow gravity/forces to accelerate bodies from rest
        if (s > 10 && is_at_rest()) {
            result.converged = true;
            break;
        }
    }

    result.steps_taken = step_count_;
    result.total_time = current_time_;

    // Compute final states and max displacement
    result.final_states.reserve(bodies_.size());
    for (size_t i = 0; i < bodies_.size(); ++i) {
        result.final_states.push_back(bodies_[i].state);
        float disp = (bodies_[i].state.position - initial_positions[i]).norm();
        result.max_displacement = std::max(result.max_displacement, disp);
    }

    return result;
}

bool PhysicsSimulation::is_at_rest(float velocity_threshold,
                                    float angular_threshold) const {
    for (const auto& b : bodies_) {
        if (b.is_static) continue;
        if (b.state.linear_velocity.norm() > velocity_threshold) return false;
        if (b.state.angular_velocity.norm() > angular_threshold) return false;
    }
    return true;
}

void PhysicsSimulation::reset() {
    for (size_t i = 0; i < bodies_.size(); ++i) {
        bodies_[i].state = initial_states_[i];
        bodies_[i].clear_forces();
    }
    current_time_ = 0.0f;
    step_count_ = 0;
}

} // namespace carbon::physics
