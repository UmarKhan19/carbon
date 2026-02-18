#include "geometry/aabb.h"
#include <algorithm>
#include <cmath>

namespace carbon {

float aabb_overlap_volume(const AABB& a, const AABB& b) {
    float ox = std::max(0.0f, std::min(a.max.x(), b.max.x()) - std::max(a.min.x(), b.min.x()));
    float oy = std::max(0.0f, std::min(a.max.y(), b.max.y()) - std::max(a.min.y(), b.min.y()));
    float oz = std::max(0.0f, std::min(a.max.z(), b.max.z()) - std::max(a.min.z(), b.min.z()));
    return ox * oy * oz;
}

AABB swept_aabb(const AABB& start, const Vec3& displacement) {
    AABB end_aabb{start.min + displacement, start.max + displacement};
    return start.merged(end_aabb);
}

bool swept_aabb_could_overlap(const AABB& moving_start, const Vec3& displacement,
                               const AABB& obstacle, float margin) {
    AABB sweep = swept_aabb(moving_start, displacement);
    return sweep.overlaps(obstacle, margin);
}

std::optional<float> swept_aabb_entry_time(const AABB& moving_start, const Vec3& displacement,
                                            const AABB& obstacle) {
    // Slab-based ray-AABB intersection for swept motion.
    float t_enter = 0.0f;
    float t_exit = 1.0f;

    for (int axis = 0; axis < 3; ++axis) {
        float d = displacement[axis];
        float lo = moving_start.min[axis];
        float hi = moving_start.max[axis];
        float obs_lo = obstacle.min[axis];
        float obs_hi = obstacle.max[axis];

        if (std::abs(d) < 1e-8f) {
            // No motion along this axis — check static overlap
            if (hi < obs_lo || lo > obs_hi) return std::nullopt;
        } else {
            float inv_d = 1.0f / d;
            float t1 = (obs_lo - hi) * inv_d;  // time when trailing edge reaches obstacle leading edge
            float t2 = (obs_hi - lo) * inv_d;  // time when leading edge passes obstacle trailing edge
            if (t1 > t2) std::swap(t1, t2);
            t_enter = std::max(t_enter, t1);
            t_exit = std::min(t_exit, t2);
            if (t_enter > t_exit) return std::nullopt;
        }
    }

    if (t_enter >= 0.0f && t_enter <= 1.0f) {
        return t_enter;
    }
    if (t_enter < 0.0f && t_exit > 0.0f) {
        return 0.0f;  // Already overlapping at start
    }
    return std::nullopt;
}

} // namespace carbon
