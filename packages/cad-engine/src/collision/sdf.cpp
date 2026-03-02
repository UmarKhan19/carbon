#include "collision/sdf.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace carbon {

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

namespace {

/// Closest point on triangle (a, b, c) to point p.
/// Algorithm from "Real-Time Collision Detection" by Christer Ericson.
Vec3 closest_point_on_triangle(const Vec3& p,
                               const Vec3& a, const Vec3& b, const Vec3& c) {
    Vec3 ab = b - a, ac = c - a, ap = p - a;
    float d1 = ab.dot(ap), d2 = ac.dot(ap);
    if (d1 <= 0.0f && d2 <= 0.0f) return a; // vertex A region

    Vec3 bp = p - b;
    float d3 = ab.dot(bp), d4 = ac.dot(bp);
    if (d3 >= 0.0f && d4 <= d3) return b; // vertex B region

    float vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0f && d1 >= 0.0f && d3 <= 0.0f) {
        float v = d1 / (d1 - d3);
        return a + v * ab; // edge AB
    }

    Vec3 cp = p - c;
    float d5 = ab.dot(cp), d6 = ac.dot(cp);
    if (d6 >= 0.0f && d5 <= d6) return c; // vertex C region

    float vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0f && d2 >= 0.0f && d6 <= 0.0f) {
        float w = d2 / (d2 - d6);
        return a + w * ac; // edge AC
    }

    float va = d3 * d6 - d5 * d4;
    if (va <= 0.0f && (d4 - d3) >= 0.0f && (d5 - d6) >= 0.0f) {
        float w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return b + w * (c - b); // edge BC
    }

    // Inside the triangle face
    float denom = 1.0f / (va + vb + vc);
    float v = vb * denom;
    float w = vc * denom;
    return a + v * ab + w * ac;
}

/// Distance from point p to triangle (a, b, c).
float point_triangle_dist(const Vec3& p,
                          const Vec3& a, const Vec3& b, const Vec3& c) {
    return (p - closest_point_on_triangle(p, a, b, c)).norm();
}

/// Test if a ray along +X through (y, z) intersects triangle (a, b, c).
/// If so, returns the x-coordinate of the intersection in x_hit.
bool ray_intersect_x(float y, float z,
                     const Vec3& a, const Vec3& b, const Vec3& c,
                     float& x_hit) {
    // Solve barycentric coordinates in YZ projection
    float dy1 = b.y() - a.y(), dz1 = b.z() - a.z();
    float dy2 = c.y() - a.y(), dz2 = c.z() - a.z();
    float dy0 = y - a.y(),     dz0 = z - a.z();

    float det = dy1 * dz2 - dy2 * dz1;
    if (std::abs(det) < 1e-10f) return false; // degenerate in YZ

    float inv = 1.0f / det;
    float u = (dy0 * dz2 - dy2 * dz0) * inv;
    float v = (dy1 * dz0 - dy0 * dz1) * inv;

    if (u < 0.0f || v < 0.0f || u + v > 1.0f) return false;

    x_hit = a.x() + u * (b.x() - a.x()) + v * (c.x() - a.x());
    return true;
}

/// Test if a ray along +Y through (x, z) intersects triangle (a, b, c).
bool ray_intersect_y(float x, float z,
                     const Vec3& a, const Vec3& b, const Vec3& c,
                     float& y_hit) {
    float dx1 = b.x() - a.x(), dz1 = b.z() - a.z();
    float dx2 = c.x() - a.x(), dz2 = c.z() - a.z();
    float dx0 = x - a.x(),     dz0 = z - a.z();

    float det = dx1 * dz2 - dx2 * dz1;
    if (std::abs(det) < 1e-10f) return false;

    float inv = 1.0f / det;
    float u = (dx0 * dz2 - dx2 * dz0) * inv;
    float v = (dx1 * dz0 - dx0 * dz1) * inv;

    if (u < 0.0f || v < 0.0f || u + v > 1.0f) return false;

    y_hit = a.y() + u * (b.y() - a.y()) + v * (c.y() - a.y());
    return true;
}

/// Test if a ray along +Z through (x, y) intersects triangle (a, b, c).
bool ray_intersect_z(float x, float y,
                     const Vec3& a, const Vec3& b, const Vec3& c,
                     float& z_hit) {
    float dx1 = b.x() - a.x(), dy1 = b.y() - a.y();
    float dx2 = c.x() - a.x(), dy2 = c.y() - a.y();
    float dx0 = x - a.x(),     dy0 = y - a.y();

    float det = dx1 * dy2 - dx2 * dy1;
    if (std::abs(det) < 1e-10f) return false;

    float inv = 1.0f / det;
    float u = (dx0 * dy2 - dx2 * dy0) * inv;
    float v = (dx1 * dy0 - dx0 * dy1) * inv;

    if (u < 0.0f || v < 0.0f || u + v > 1.0f) return false;

    z_hit = a.z() + u * (b.z() - a.z()) + v * (c.z() - a.z());
    return true;
}

/// Propagate closest-triangle info from a neighbor cell to the current cell.
void check_neighbor(std::vector<float>& phi,
                    std::vector<int>& closest_tri,
                    int ni, int nj, int nk,
                    const Vec3& origin, float dx,
                    const std::vector<Vec3>& ta,
                    const std::vector<Vec3>& tb,
                    const std::vector<Vec3>& tc,
                    int i0, int j0, int k0,
                    int i1, int j1, int k1) {
    if (i1 < 0 || i1 >= ni || j1 < 0 || j1 >= nj || k1 < 0 || k1 >= nk) return;

    int idx1 = (k1 * nj + j1) * ni + i1;
    if (closest_tri[idx1] < 0) return;

    int t = closest_tri[idx1];
    Vec3 p(origin.x() + i0 * dx, origin.y() + j0 * dx, origin.z() + k0 * dx);
    float d = point_triangle_dist(p, ta[t], tb[t], tc[t]);

    int idx0 = (k0 * nj + j0) * ni + i0;
    if (d < phi[idx0]) {
        phi[idx0] = d;
        closest_tri[idx0] = t;
    }
}

/// Run one directional sweep to propagate closest-triangle information.
/// di, dj, dk are each +1 or -1 indicating the sweep direction.
void sweep(std::vector<float>& phi,
           std::vector<int>& closest_tri,
           int ni, int nj, int nk,
           const Vec3& origin, float dx,
           const std::vector<Vec3>& ta,
           const std::vector<Vec3>& tb,
           const std::vector<Vec3>& tc,
           int di, int dj, int dk) {
    int i0 = (di > 0) ? 1 : ni - 2;
    int i1 = (di > 0) ? ni : -1;
    int j0 = (dj > 0) ? 1 : nj - 2;
    int j1 = (dj > 0) ? nj : -1;
    int k0 = (dk > 0) ? 1 : nk - 2;
    int k1 = (dk > 0) ? nk : -1;

    for (int k = k0; k != k1; k += dk) {
        for (int j = j0; j != j1; j += dj) {
            for (int i = i0; i != i1; i += di) {
                // Check 7 "behind" neighbors: 3 face + 3 edge + 1 corner
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i - di, j, k);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i, j - dj, k);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i, j, k - dk);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i - di, j - dj, k);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i - di, j, k - dk);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i, j - dj, k - dk);
                check_neighbor(phi, closest_tri, ni, nj, nk, origin, dx,
                               ta, tb, tc, i, j, k, i - di, j - dj, k - dk);
            }
        }
    }
}

/// Core SDF generation from pre-transformed vertices and indices.
SDFGrid generate_sdf_impl(const std::vector<Vec3>& vertices,
                          const std::vector<std::array<uint32_t, 3>>& indices,
                          const SDFConfig& config) {
    if (vertices.empty() || indices.empty()) return {};

    // 1. Compute mesh bounding box
    Vec3 lo = vertices[0], hi = vertices[0];
    for (const auto& v : vertices) {
        lo = lo.cwiseMin(v);
        hi = hi.cwiseMax(v);
    }

    // 2. Determine voxel spacing and grid dimensions
    Vec3 extent = hi - lo;
    float dx = config.dx;
    if (dx <= 0.0f) {
        float max_extent = std::max({extent.x(), extent.y(), extent.z()});
        // Avoid division by zero for degenerate meshes
        if (max_extent < 1e-12f) max_extent = 1.0f;
        dx = max_extent / static_cast<float>(config.min_resolution);
    }

    int pad = config.padding;
    Vec3 origin = lo - Vec3(pad * dx, pad * dx, pad * dx);

    int ni = static_cast<int>(std::ceil(extent.x() / dx)) + 2 * pad + 1;
    int nj = static_cast<int>(std::ceil(extent.y() / dx)) + 2 * pad + 1;
    int nk = static_cast<int>(std::ceil(extent.z() / dx)) + 2 * pad + 1;

    // Enforce minimum resolution per axis
    ni = std::max(ni, config.min_resolution);
    nj = std::max(nj, config.min_resolution);
    nk = std::max(nk, config.min_resolution);

    // 3. Pre-extract triangle vertex arrays (SoA for cache efficiency)
    size_t num_tris = indices.size();
    std::vector<Vec3> tri_a(num_tris), tri_b(num_tris), tri_c(num_tris);
    for (size_t t = 0; t < num_tris; ++t) {
        tri_a[t] = vertices[indices[t][0]];
        tri_b[t] = vertices[indices[t][1]];
        tri_c[t] = vertices[indices[t][2]];
    }

    // 4. Initialize distance grid and closest-triangle tracker
    int total = ni * nj * nk;
    std::vector<float> phi(total, std::numeric_limits<float>::max());
    std::vector<int> closest_tri(total, -1);

    // 5. Compute exact distances for grid cells near each triangle
    int band = config.exact_band;
    for (size_t t = 0; t < num_tris; ++t) {
        Vec3 t_lo = tri_a[t].cwiseMin(tri_b[t]).cwiseMin(tri_c[t]);
        Vec3 t_hi = tri_a[t].cwiseMax(tri_b[t]).cwiseMax(tri_c[t]);

        int gi0 = std::max(0, static_cast<int>(std::floor((t_lo.x() - origin.x()) / dx)) - band);
        int gj0 = std::max(0, static_cast<int>(std::floor((t_lo.y() - origin.y()) / dx)) - band);
        int gk0 = std::max(0, static_cast<int>(std::floor((t_lo.z() - origin.z()) / dx)) - band);
        int gi1 = std::min(ni - 1, static_cast<int>(std::ceil((t_hi.x() - origin.x()) / dx)) + band);
        int gj1 = std::min(nj - 1, static_cast<int>(std::ceil((t_hi.y() - origin.y()) / dx)) + band);
        int gk1 = std::min(nk - 1, static_cast<int>(std::ceil((t_hi.z() - origin.z()) / dx)) + band);

        for (int k = gk0; k <= gk1; ++k) {
            for (int j = gj0; j <= gj1; ++j) {
                for (int i = gi0; i <= gi1; ++i) {
                    Vec3 p(origin.x() + i * dx,
                           origin.y() + j * dx,
                           origin.z() + k * dx);
                    float d = point_triangle_dist(p, tri_a[t], tri_b[t], tri_c[t]);
                    int idx = (k * nj + j) * ni + i;
                    if (d < phi[idx]) {
                        phi[idx] = d;
                        closest_tri[idx] = static_cast<int>(t);
                    }
                }
            }
        }
    }

    // 6. Sweep in 8 directions to propagate closest-triangle info
    for (int dk : {1, -1}) {
        for (int dj : {1, -1}) {
            for (int di : {1, -1}) {
                sweep(phi, closest_tri, ni, nj, nk, origin, dx,
                      tri_a, tri_b, tri_c, di, dj, dk);
            }
        }
    }

    // 7. Sign determination using 3-axis ray intersection counting.
    //    For each axis, cast rays through the grid and toggle inside/outside
    //    at each triangle intersection. Majority vote (>= 2 of 3) = inside.
    std::vector<int> sign_votes(total, 0);

    // --- X-axis rays ---
    {
        std::vector<std::vector<float>> hits(static_cast<size_t>(nj) * nk);

        for (size_t t = 0; t < num_tris; ++t) {
            float min_y = std::min({tri_a[t].y(), tri_b[t].y(), tri_c[t].y()});
            float max_y = std::max({tri_a[t].y(), tri_b[t].y(), tri_c[t].y()});
            float min_z = std::min({tri_a[t].z(), tri_b[t].z(), tri_c[t].z()});
            float max_z = std::max({tri_a[t].z(), tri_b[t].z(), tri_c[t].z()});

            int j0 = std::max(0, static_cast<int>(std::floor((min_y - origin.y()) / dx)));
            int j1 = std::min(nj - 1, static_cast<int>(std::ceil((max_y - origin.y()) / dx)));
            int k0 = std::max(0, static_cast<int>(std::floor((min_z - origin.z()) / dx)));
            int k1 = std::min(nk - 1, static_cast<int>(std::ceil((max_z - origin.z()) / dx)));

            for (int k = k0; k <= k1; ++k) {
                for (int j = j0; j <= j1; ++j) {
                    float y = origin.y() + j * dx;
                    float z = origin.z() + k * dx;
                    float x_hit;
                    if (ray_intersect_x(y, z, tri_a[t], tri_b[t], tri_c[t], x_hit)) {
                        hits[static_cast<size_t>(k) * nj + j].push_back(x_hit);
                    }
                }
            }
        }

        for (int k = 0; k < nk; ++k) {
            for (int j = 0; j < nj; ++j) {
                auto& h = hits[static_cast<size_t>(k) * nj + j];
                if (h.empty()) continue;
                std::sort(h.begin(), h.end());
                // Merge duplicate hits from shared edges/vertices
                float merge_eps = dx * 1e-4f;
                auto new_end = std::unique(h.begin(), h.end(),
                    [merge_eps](float a, float b) { return std::abs(a - b) < merge_eps; });
                h.erase(new_end, h.end());

                int hi_idx = 0;
                bool inside = false;
                for (int i = 0; i < ni; ++i) {
                    float x = origin.x() + i * dx;
                    while (hi_idx < static_cast<int>(h.size()) && h[hi_idx] < x) {
                        inside = !inside;
                        ++hi_idx;
                    }
                    if (inside) sign_votes[(k * nj + j) * ni + i]++;
                }
            }
        }
    }

    // --- Y-axis rays ---
    {
        std::vector<std::vector<float>> hits(static_cast<size_t>(ni) * nk);

        for (size_t t = 0; t < num_tris; ++t) {
            float min_x = std::min({tri_a[t].x(), tri_b[t].x(), tri_c[t].x()});
            float max_x = std::max({tri_a[t].x(), tri_b[t].x(), tri_c[t].x()});
            float min_z = std::min({tri_a[t].z(), tri_b[t].z(), tri_c[t].z()});
            float max_z = std::max({tri_a[t].z(), tri_b[t].z(), tri_c[t].z()});

            int i0 = std::max(0, static_cast<int>(std::floor((min_x - origin.x()) / dx)));
            int i1 = std::min(ni - 1, static_cast<int>(std::ceil((max_x - origin.x()) / dx)));
            int k0 = std::max(0, static_cast<int>(std::floor((min_z - origin.z()) / dx)));
            int k1 = std::min(nk - 1, static_cast<int>(std::ceil((max_z - origin.z()) / dx)));

            for (int k = k0; k <= k1; ++k) {
                for (int i = i0; i <= i1; ++i) {
                    float x = origin.x() + i * dx;
                    float z = origin.z() + k * dx;
                    float y_hit;
                    if (ray_intersect_y(x, z, tri_a[t], tri_b[t], tri_c[t], y_hit)) {
                        hits[static_cast<size_t>(k) * ni + i].push_back(y_hit);
                    }
                }
            }
        }

        for (int k = 0; k < nk; ++k) {
            for (int i = 0; i < ni; ++i) {
                auto& h = hits[static_cast<size_t>(k) * ni + i];
                if (h.empty()) continue;
                std::sort(h.begin(), h.end());
                float merge_eps = dx * 1e-4f;
                auto new_end = std::unique(h.begin(), h.end(),
                    [merge_eps](float a, float b) { return std::abs(a - b) < merge_eps; });
                h.erase(new_end, h.end());

                int hi_idx = 0;
                bool inside = false;
                for (int j = 0; j < nj; ++j) {
                    float y = origin.y() + j * dx;
                    while (hi_idx < static_cast<int>(h.size()) && h[hi_idx] < y) {
                        inside = !inside;
                        ++hi_idx;
                    }
                    if (inside) sign_votes[(k * nj + j) * ni + i]++;
                }
            }
        }
    }

    // --- Z-axis rays ---
    {
        std::vector<std::vector<float>> hits(static_cast<size_t>(ni) * nj);

        for (size_t t = 0; t < num_tris; ++t) {
            float min_x = std::min({tri_a[t].x(), tri_b[t].x(), tri_c[t].x()});
            float max_x = std::max({tri_a[t].x(), tri_b[t].x(), tri_c[t].x()});
            float min_y = std::min({tri_a[t].y(), tri_b[t].y(), tri_c[t].y()});
            float max_y = std::max({tri_a[t].y(), tri_b[t].y(), tri_c[t].y()});

            int i0 = std::max(0, static_cast<int>(std::floor((min_x - origin.x()) / dx)));
            int i1 = std::min(ni - 1, static_cast<int>(std::ceil((max_x - origin.x()) / dx)));
            int j0 = std::max(0, static_cast<int>(std::floor((min_y - origin.y()) / dx)));
            int j1 = std::min(nj - 1, static_cast<int>(std::ceil((max_y - origin.y()) / dx)));

            for (int j = j0; j <= j1; ++j) {
                for (int i = i0; i <= i1; ++i) {
                    float x = origin.x() + i * dx;
                    float y = origin.y() + j * dx;
                    float z_hit;
                    if (ray_intersect_z(x, y, tri_a[t], tri_b[t], tri_c[t], z_hit)) {
                        hits[static_cast<size_t>(j) * ni + i].push_back(z_hit);
                    }
                }
            }
        }

        for (int j = 0; j < nj; ++j) {
            for (int i = 0; i < ni; ++i) {
                auto& h = hits[static_cast<size_t>(j) * ni + i];
                if (h.empty()) continue;
                std::sort(h.begin(), h.end());
                float merge_eps = dx * 1e-4f;
                auto new_end = std::unique(h.begin(), h.end(),
                    [merge_eps](float a, float b) { return std::abs(a - b) < merge_eps; });
                h.erase(new_end, h.end());

                int hi_idx = 0;
                bool inside = false;
                for (int k = 0; k < nk; ++k) {
                    float z = origin.z() + k * dx;
                    while (hi_idx < static_cast<int>(h.size()) && h[hi_idx] < z) {
                        inside = !inside;
                        ++hi_idx;
                    }
                    if (inside) sign_votes[(k * nj + j) * ni + i]++;
                }
            }
        }
    }

    // Apply sign: inside if majority vote (>= 2 of 3 axes) says inside
    for (int idx = 0; idx < total; ++idx) {
        if (sign_votes[idx] >= 2) {
            phi[idx] = -phi[idx];
        }
    }

    // 8. Build result
    SDFGrid grid;
    grid.data = std::move(phi);
    grid.origin = origin;
    grid.dx = dx;
    grid.ni = ni;
    grid.nj = nj;
    grid.nk = nk;
    return grid;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// SDFGrid member functions
// ---------------------------------------------------------------------------

float SDFGrid::query(const Vec3& point) const {
    if (data.empty()) return std::numeric_limits<float>::max();

    // Convert to continuous grid coordinates
    float fi = (point.x() - origin.x()) / dx;
    float fj = (point.y() - origin.y()) / dx;
    float fk = (point.z() - origin.z()) / dx;

    // Clamp to valid interpolation range [0, n-1]
    fi = std::max(0.0f, std::min(fi, static_cast<float>(ni - 1)));
    fj = std::max(0.0f, std::min(fj, static_cast<float>(nj - 1)));
    fk = std::max(0.0f, std::min(fk, static_cast<float>(nk - 1)));

    // Integer cell and fractional offset
    int i = std::min(static_cast<int>(fi), ni - 2);
    int j = std::min(static_cast<int>(fj), nj - 2);
    int k = std::min(static_cast<int>(fk), nk - 2);

    float s = fi - i;
    float t = fj - j;
    float u = fk - k;

    // Trilinear interpolation
    float c000 = (*this)(i,     j,     k);
    float c100 = (*this)(i + 1, j,     k);
    float c010 = (*this)(i,     j + 1, k);
    float c110 = (*this)(i + 1, j + 1, k);
    float c001 = (*this)(i,     j,     k + 1);
    float c101 = (*this)(i + 1, j,     k + 1);
    float c011 = (*this)(i,     j + 1, k + 1);
    float c111 = (*this)(i + 1, j + 1, k + 1);

    return (1 - s) * (1 - t) * (1 - u) * c000 +
           s       * (1 - t) * (1 - u) * c100 +
           (1 - s) * t       * (1 - u) * c010 +
           s       * t       * (1 - u) * c110 +
           (1 - s) * (1 - t) * u       * c001 +
           s       * (1 - t) * u       * c101 +
           (1 - s) * t       * u       * c011 +
           s       * t       * u       * c111;
}

Vec3 SDFGrid::gradient(const Vec3& point) const {
    float eps = dx * 0.5f;
    float dfdx = (query(point + Vec3(eps, 0, 0)) - query(point - Vec3(eps, 0, 0))) / (2.0f * eps);
    float dfdy = (query(point + Vec3(0, eps, 0)) - query(point - Vec3(0, eps, 0))) / (2.0f * eps);
    float dfdz = (query(point + Vec3(0, 0, eps)) - query(point - Vec3(0, 0, eps))) / (2.0f * eps);
    return Vec3(dfdx, dfdy, dfdz);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

SDFGrid generate_sdf(const TriMesh& mesh, const SDFConfig& config) {
    if (mesh.empty()) return {};
    return generate_sdf_impl(mesh.vertices, mesh.indices, config);
}

SDFGrid generate_sdf(const TriMesh& mesh, const Isometry& transform,
                     const SDFConfig& config) {
    if (mesh.empty()) return {};

    // Transform vertices to world space
    std::vector<Vec3> world_verts;
    world_verts.reserve(mesh.vertices.size());
    for (const auto& v : mesh.vertices) {
        world_verts.push_back(transform.transform_point(v));
    }

    return generate_sdf_impl(world_verts, mesh.indices, config);
}

} // namespace carbon
