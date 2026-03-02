#include "simulator/stability_checker.h"

namespace carbon {

StabilityResult check_stability(
    const std::vector<StabilityPart>& parts,
    const StabilityConfig& config) {

    StabilityResult result;
    if (parts.empty()) return result;

    // Set up physics simulation
    physics::PhysicsConfig phys_cfg;
    phys_cfg.dt = config.sim_dt;
    phys_cfg.max_steps = config.max_steps;
    phys_cfg.gravity = config.gravity;
    phys_cfg.enable_ground = config.enable_ground;
    phys_cfg.ground_point = config.ground_point;
    phys_cfg.ground_normal = config.ground_normal;
    phys_cfg.contact.contact_stiffness = 1e3f;
    phys_cfg.contact.contact_damping = 50.0f;
    phys_cfg.contact.friction_coeff = 0.5f;

    physics::PhysicsSimulation sim(phys_cfg);

    // Add parts as rigid bodies
    std::vector<Vec3> initial_positions;
    for (const auto& part : parts) {
        physics::RigidBody body;
        body.id = part.id;
        body.name = part.id;
        body.mass = part.mass;
        body.mesh = part.mesh;
        body.is_static = part.is_grounded;

        body.state.position = part.transform.translation;
        body.state.orientation = part.transform.rotation;

        if (part.mesh) {
            Vec3 half = part.mesh->local_aabb().size() * 0.5f;
            body.inertia = physics::RigidBody::box_inertia(part.mass, half);
            body.inertia_inv = body.inertia.inverse();

            // Generate SDF for inter-body collision
            SDFConfig sdf_cfg;
            sdf_cfg.min_resolution = 15;
            body.sdf = generate_sdf(*part.mesh, sdf_cfg);
        }

        initial_positions.push_back(body.state.position);
        sim.add_body(std::move(body));
    }

    // Run simulation
    auto phys_result = sim.run();
    result.steps_simulated = phys_result.steps_taken;

    // Analyze results
    result.parts.reserve(parts.size());
    for (size_t i = 0; i < parts.size(); ++i) {
        PartStability ps;
        ps.part_id = parts[i].id;
        ps.final_position = phys_result.final_states[i].position;
        ps.max_displacement = (ps.final_position - initial_positions[i]).norm();
        ps.stable = parts[i].is_grounded ||
                    ps.max_displacement < config.displacement_threshold;

        if (!ps.stable) {
            result.assembly_stable = false;
            result.unstable_ids.push_back(ps.part_id);
        }

        result.parts.push_back(ps);
    }

    return result;
}

} // namespace carbon
