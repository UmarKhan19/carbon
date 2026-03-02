#include "physics/contact_solver.h"

namespace carbon::physics {

// ---------------------------------------------------------------------------
// Contact detection
// ---------------------------------------------------------------------------

std::vector<BodyContact> detect_contacts(
    const std::vector<RigidBody>& bodies) {
    std::vector<BodyContact> contacts;
    int n = static_cast<int>(bodies.size());

    for (int i = 0; i < n; ++i) {
        if (!bodies[i].mesh || bodies[i].sdf.empty()) continue;

        for (int j = i + 1; j < n; ++j) {
            if (!bodies[j].mesh) continue;

            // AABB broad phase
            AABB aabb_i = bodies[i].world_aabb();
            AABB aabb_j = bodies[j].world_aabb();
            if (!aabb_i.overlaps(aabb_j, 0.001f)) continue;

            // Sample vertices of body j against SDF of body i
            Isometry iso_i = bodies[i].state.to_isometry();
            Isometry iso_i_inv = iso_i.inverse();

            for (const auto& v : bodies[j].mesh->vertices) {
                Vec3 world_v = bodies[j].state.to_world(v);
                // Transform to body i's local space (where the SDF is defined)
                Vec3 local_v = iso_i_inv.transform_point(world_v);
                float dist = bodies[i].sdf.query(local_v);

                if (dist < 0.0f) {
                    Vec3 local_grad = bodies[i].sdf.gradient(local_v);
                    Vec3 world_normal = iso_i.transform_direction(local_grad);
                    float mag = world_normal.norm();
                    if (mag > 1e-8f) world_normal /= mag;
                    else world_normal = Vec3(0, 1, 0);

                    BodyContact c;
                    c.body_a = i;
                    c.body_b = j;
                    c.position = world_v;
                    c.normal = world_normal; // Points outward from body i
                    c.depth = -dist;
                    contacts.push_back(c);
                }
            }

            // Also sample vertices of body i against SDF of body j
            if (!bodies[j].sdf.empty()) {
                Isometry iso_j = bodies[j].state.to_isometry();
                Isometry iso_j_inv = iso_j.inverse();

                for (const auto& v : bodies[i].mesh->vertices) {
                    Vec3 world_v = bodies[i].state.to_world(v);
                    Vec3 local_v = iso_j_inv.transform_point(world_v);
                    float dist = bodies[j].sdf.query(local_v);

                    if (dist < 0.0f) {
                        Vec3 local_grad = bodies[j].sdf.gradient(local_v);
                        Vec3 world_normal = iso_j.transform_direction(local_grad);
                        float mag = world_normal.norm();
                        if (mag > 1e-8f) world_normal /= mag;
                        else world_normal = Vec3(0, 1, 0);

                        BodyContact c;
                        c.body_a = j; // SDF owner
                        c.body_b = i; // Penetrating body
                        c.position = world_v;
                        c.normal = world_normal;
                        c.depth = -dist;
                        contacts.push_back(c);
                    }
                }
            }
        }
    }
    return contacts;
}

std::vector<BodyContact> detect_ground_contacts(
    const std::vector<RigidBody>& bodies,
    const Vec3& ground_point,
    const Vec3& ground_normal) {
    std::vector<BodyContact> contacts;

    Vec3 n = ground_normal.normalized();
    float d = n.dot(ground_point);

    for (int i = 0; i < static_cast<int>(bodies.size()); ++i) {
        if (bodies[i].is_static || !bodies[i].mesh) continue;

        for (const auto& v : bodies[i].mesh->vertices) {
            Vec3 world_v = bodies[i].state.to_world(v);
            float signed_dist = n.dot(world_v) - d;

            if (signed_dist < 0.0f) {
                BodyContact c;
                c.body_a = -1; // Ground
                c.body_b = i;
                c.position = world_v;
                c.normal = n;
                c.depth = -signed_dist;
                contacts.push_back(c);
            }
        }
    }
    return contacts;
}

// ---------------------------------------------------------------------------
// Contact force application (penalty method)
// ---------------------------------------------------------------------------

void apply_contact_forces(
    std::vector<RigidBody>& bodies,
    const std::vector<BodyContact>& contacts,
    const ContactConfig& config) {

    for (const auto& c : contacts) {
        // Penalty force: F = k * depth * normal + d * v_rel_n * normal
        Vec3 force_dir = c.normal;
        float spring_force = config.contact_stiffness * c.depth;

        // Compute relative velocity at contact point
        float v_rel_n = 0.0f;
        if (c.body_b >= 0 && c.body_b < static_cast<int>(bodies.size())) {
            const auto& b = bodies[c.body_b];
            Vec3 r = c.position - b.state.position;
            Vec3 v_point = b.state.linear_velocity + b.state.angular_velocity.cross(r);
            v_rel_n = v_point.dot(c.normal);
        }

        float damping_force = -config.contact_damping * v_rel_n;
        float total_force_mag = spring_force + damping_force;
        if (total_force_mag < 0.0f) total_force_mag = 0.0f; // No pull
        // Clamp to prevent explosion from deep penetration
        float max_force = config.contact_stiffness * 10.0f;
        if (total_force_mag > max_force) total_force_mag = max_force;

        Vec3 contact_force = total_force_mag * force_dir;

        // Apply to body B (the penetrating body)
        if (c.body_b >= 0 && c.body_b < static_cast<int>(bodies.size())) {
            auto& b = bodies[c.body_b];
            if (!b.is_static) {
                b.apply_force_at(contact_force, c.position);
            }
        }

        // Apply reaction to body A (if not ground)
        if (c.body_a >= 0 && c.body_a < static_cast<int>(bodies.size())) {
            auto& a = bodies[c.body_a];
            if (!a.is_static) {
                a.apply_force_at(-contact_force, c.position);
            }
        }

        // Friction force (Coulomb model)
        if (c.body_b >= 0 && c.body_b < static_cast<int>(bodies.size())) {
            auto& b = bodies[c.body_b];
            if (!b.is_static) {
                Vec3 r = c.position - b.state.position;
                Vec3 v_point = b.state.linear_velocity + b.state.angular_velocity.cross(r);
                Vec3 v_tangent = v_point - v_point.dot(c.normal) * c.normal;
                float v_tan_mag = v_tangent.norm();

                if (v_tan_mag > 1e-6f) {
                    float friction_mag = config.friction_coeff * total_force_mag;
                    Vec3 friction_force = -friction_mag * (v_tangent / v_tan_mag);
                    b.apply_force_at(friction_force, c.position);

                    if (c.body_a >= 0 && c.body_a < static_cast<int>(bodies.size())) {
                        auto& a = bodies[c.body_a];
                        if (!a.is_static) {
                            a.apply_force_at(-friction_force, c.position);
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Impulse-based contact resolution
// ---------------------------------------------------------------------------

void resolve_contacts_impulse(
    std::vector<RigidBody>& bodies,
    const std::vector<BodyContact>& contacts,
    const ContactConfig& config) {

    // Sequential impulse solver: iterate a few times for convergence
    for (int iter = 0; iter < 4; ++iter) {
        for (const auto& c : contacts) {
            if (c.body_b < 0 || c.body_b >= static_cast<int>(bodies.size())) continue;
            auto& b = bodies[c.body_b];
            if (b.is_static) continue;

            // Compute velocity at contact point
            Vec3 r_b = c.position - b.state.position;
            Vec3 v_b = b.state.linear_velocity + b.state.angular_velocity.cross(r_b);

            Vec3 v_a{0, 0, 0};
            Vec3 r_a{0, 0, 0};
            if (c.body_a >= 0 && c.body_a < static_cast<int>(bodies.size())) {
                const auto& a = bodies[c.body_a];
                r_a = c.position - a.state.position;
                v_a = a.state.linear_velocity + a.state.angular_velocity.cross(r_a);
            }

            Vec3 v_rel = v_b - v_a;
            float v_rel_n = v_rel.dot(c.normal);

            // Only resolve if closing velocity (moving into the contact)
            if (v_rel_n >= 0.0f) continue;

            // Effective mass
            float inv_mass_b = b.is_static ? 0.0f : 1.0f / b.mass;
            float inv_mass_a = 0.0f;
            Eigen::Matrix3f inv_I_a = Eigen::Matrix3f::Zero();

            if (c.body_a >= 0 && c.body_a < static_cast<int>(bodies.size())) {
                const auto& a = bodies[c.body_a];
                if (!a.is_static) {
                    inv_mass_a = 1.0f / a.mass;
                    inv_I_a = a.world_inertia_inv();
                }
            }

            Eigen::Matrix3f inv_I_b = b.world_inertia_inv();
            Vec3 rn_a = r_a.cross(c.normal);
            Vec3 rn_b = r_b.cross(c.normal);
            float eff_mass = inv_mass_a + inv_mass_b +
                             rn_a.dot(inv_I_a * rn_a) +
                             rn_b.dot(inv_I_b * rn_b);

            if (eff_mass < 1e-10f) continue;

            // Impulse magnitude (with Baumgarte stabilization)
            float bias = config.baumgarte_factor * c.depth / 0.01f; // Assume dt~0.01
            float j = -(1.0f + config.restitution) * v_rel_n + bias;
            j /= eff_mass;
            if (j < 0.0f) j = 0.0f;

            Vec3 impulse = j * c.normal;

            // Apply impulse
            b.state.linear_velocity += impulse * inv_mass_b;
            b.state.angular_velocity += inv_I_b * r_b.cross(impulse);

            if (c.body_a >= 0 && c.body_a < static_cast<int>(bodies.size())) {
                auto& a = bodies[c.body_a];
                if (!a.is_static) {
                    a.state.linear_velocity -= impulse * inv_mass_a;
                    a.state.angular_velocity -= inv_I_a * r_a.cross(impulse);
                }
            }
        }
    }
}

} // namespace carbon::physics
