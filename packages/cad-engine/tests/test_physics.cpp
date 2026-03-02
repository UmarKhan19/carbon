#include <gtest/gtest.h>
#include "physics/simulation.h"
#include "test_helpers.h"

using namespace carbon;
using namespace carbon::physics;
using namespace carbon::test;

// ---------------------------------------------------------------------------
// Helper: create a physics body from a cube mesh at a position
// ---------------------------------------------------------------------------

static RigidBody make_physics_cube(const std::string& id, const TriMesh& mesh,
                                    const Vec3& pos, float mass = 1.0f,
                                    bool is_static = false) {
    RigidBody body;
    body.id = id;
    body.name = id;
    body.mass = mass;
    body.mesh = &mesh;
    body.state.position = pos;
    body.is_static = is_static;

    // Box inertia for 1x1x1 cube
    body.inertia = RigidBody::box_inertia(mass, Vec3(0.5f, 0.5f, 0.5f));
    body.inertia_inv = body.inertia.inverse();

    // Generate local-space SDF
    SDFConfig sdf_cfg;
    sdf_cfg.min_resolution = 20;
    body.sdf = generate_sdf(mesh, sdf_cfg);

    return body;
}

// ---------------------------------------------------------------------------
// RigidBody tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, BodyStateToWorld) {
    BodyState state;
    state.position = Vec3(1, 2, 3);
    state.orientation = Quat::Identity();

    Vec3 result = state.to_world(Vec3(1, 0, 0));
    EXPECT_NEAR(result.x(), 2.0f, 1e-6f);
    EXPECT_NEAR(result.y(), 2.0f, 1e-6f);
    EXPECT_NEAR(result.z(), 3.0f, 1e-6f);
}

TEST(PhysicsTest, BoxInertia) {
    Eigen::Matrix3f I = RigidBody::box_inertia(1.0f, Vec3(0.5f, 0.5f, 0.5f));
    // For unit cube, mass=1: I_xx = 1/3 * (0.25 + 0.25) = 1/6
    float expected = 1.0f / 6.0f;
    EXPECT_NEAR(I(0, 0), expected, 1e-6f);
    EXPECT_NEAR(I(1, 1), expected, 1e-6f);
    EXPECT_NEAR(I(2, 2), expected, 1e-6f);
}

// ---------------------------------------------------------------------------
// Free fall tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, FreeFallUnderGravity) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.01f;
    cfg.max_steps = 100;
    cfg.gravity = Vec3(0, -9.81f, 0);
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);
    sim.add_body(make_physics_cube("cube1", cube, Vec3(0, 10, 0)));

    auto result = sim.run();

    // After 1 second of free fall: y = y0 + 0.5 * g * t^2 = 10 - 0.5 * 9.81 * 1.0 = 5.095
    float expected_y = 10.0f - 0.5f * 9.81f * 1.0f;
    float actual_y = result.final_states[0].position.y();
    EXPECT_NEAR(actual_y, expected_y, 0.5f)
        << "After 1s of free fall, expected y~" << expected_y << " got " << actual_y;

    // Should have fallen
    EXPECT_LT(actual_y, 10.0f) << "Body should have fallen";
}

TEST(PhysicsTest, StaticBodyDoesNotMove) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.01f;
    cfg.max_steps = 50;
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);

    auto body = make_physics_cube("static", cube, Vec3(0, 0, 0));
    body.is_static = true;
    sim.add_body(std::move(body));

    auto result = sim.run();

    EXPECT_NEAR(result.final_states[0].position.x(), 0.0f, 1e-6f);
    EXPECT_NEAR(result.final_states[0].position.y(), 0.0f, 1e-6f);
    EXPECT_NEAR(result.final_states[0].position.z(), 0.0f, 1e-6f);
}

// ---------------------------------------------------------------------------
// Ground contact tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, BodyComesToRestOnGround) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.001f;
    cfg.max_steps = 5000;
    cfg.gravity = Vec3(0, -9.81f, 0);
    cfg.enable_ground = true;
    cfg.ground_point = Vec3(0, 0, 0);
    cfg.ground_normal = Vec3(0, 1, 0);
    // Moderate stiffness stable with dt=0.001: k*dt^2/m = 1000*1e-6 = 0.001 << 1
    cfg.contact.contact_stiffness = 1e3f;
    cfg.contact.contact_damping = 50.0f;
    cfg.contact.friction_coeff = 0.5f;

    PhysicsSimulation sim(cfg);
    sim.add_body(make_physics_cube("cube1", cube, Vec3(0, 2, 0)));

    auto result = sim.run();

    // Body should have fallen from y=2 toward ground
    float final_y = result.final_states[0].position.y();
    EXPECT_GT(final_y, -1.0f) << "Body should not have fallen far through ground";
    EXPECT_LT(final_y, 2.0f) << "Body should have fallen toward ground";
}

// ---------------------------------------------------------------------------
// Contact detection tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, DetectGroundContacts) {
    TriMesh cube = make_cube(0.5f);

    RigidBody body = make_physics_cube("cube1", cube, Vec3(0, 0.3f, 0));
    std::vector<RigidBody> bodies = {std::move(body)};

    auto contacts = detect_ground_contacts(bodies, Vec3(0, 0, 0), Vec3(0, 1, 0));

    // Cube at y=0.3 with half-size 0.5: bottom vertices at y=-0.2 (below ground)
    EXPECT_GT(contacts.size(), 0u)
        << "Should detect ground penetration for cube at y=0.3";
}

TEST(PhysicsTest, NoGroundContactWhenAbove) {
    TriMesh cube = make_cube(0.5f);

    RigidBody body = make_physics_cube("cube1", cube, Vec3(0, 5.0f, 0));
    std::vector<RigidBody> bodies = {std::move(body)};

    auto contacts = detect_ground_contacts(bodies, Vec3(0, 0, 0), Vec3(0, 1, 0));
    EXPECT_EQ(contacts.size(), 0u) << "No contacts when body is above ground";
}

// ---------------------------------------------------------------------------
// Simulation control tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, ResetRestoresState) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.01f;
    cfg.max_steps = 50;
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);
    sim.add_body(make_physics_cube("cube1", cube, Vec3(0, 10, 0)));

    // Run some steps
    for (int i = 0; i < 10; ++i) sim.step();
    EXPECT_NE(sim.body(0).state.position.y(), 10.0f);

    // Reset
    sim.reset();
    EXPECT_NEAR(sim.body(0).state.position.y(), 10.0f, 1e-6f);
    EXPECT_NEAR(sim.current_time(), 0.0f, 1e-6f);
}

TEST(PhysicsTest, CallbackCanStopSimulation) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.01f;
    cfg.max_steps = 1000;
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);
    sim.add_body(make_physics_cube("cube1", cube, Vec3(0, 10, 0)));

    int steps_seen = 0;
    auto result = sim.run([&](int step, const std::vector<BodyContact>&) {
        steps_seen = step + 1;
        return step < 5; // Stop after 5 steps
    });

    EXPECT_EQ(steps_seen, 6); // 0..5 inclusive, callback returns false at step=5
    EXPECT_LT(result.steps_taken, 1000);
}

TEST(PhysicsTest, IsAtRestDetection) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);
    auto body = make_physics_cube("cube1", cube, Vec3(0, 0, 0));
    body.state.linear_velocity = Vec3(0, 0, 0);
    body.state.angular_velocity = Vec3(0, 0, 0);
    sim.add_body(std::move(body));

    EXPECT_TRUE(sim.is_at_rest()) << "Stationary body should be at rest";

    sim.body(0).state.linear_velocity = Vec3(1, 0, 0);
    EXPECT_FALSE(sim.is_at_rest()) << "Moving body should not be at rest";
}

// ---------------------------------------------------------------------------
// Integration method tests
// ---------------------------------------------------------------------------

TEST(PhysicsTest, BDF1IntegrationWorks) {
    TriMesh cube = make_cube(0.5f);

    PhysicsConfig cfg;
    cfg.dt = 0.01f;
    cfg.max_steps = 100;
    cfg.integrator = IntegrationMethod::BDF1;
    cfg.enable_ground = false;

    PhysicsSimulation sim(cfg);
    sim.add_body(make_physics_cube("cube1", cube, Vec3(0, 10, 0)));

    auto result = sim.run();

    // Should still fall under gravity
    EXPECT_LT(result.final_states[0].position.y(), 10.0f);
}
