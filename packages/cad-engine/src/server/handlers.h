#pragma once

/// HTTP request handlers for the CAD engine API.
/// Matches the JSON contracts of the existing Rust (cad-server) and Python (cad-service) APIs.

#include <httplib.h>

namespace carbon {

/// Add CORS headers to a response.
void add_cors_headers(httplib::Response& res);

/// GET /health — returns { status: "ok", version: "1.0.0" }
void handle_health(httplib::Response& res);

/// POST /parse — accepts multipart form with STEP file.
/// Returns { success, hierarchy, glb_base64, part_count, error }.
void handle_parse(const httplib::Request& req, httplib::Response& res);

/// POST /simulate — accepts JSON { assembly_tree, glb_base64 }.
/// Returns { success, result: SimulationResult, error }.
void handle_simulate(const httplib::Request& req, httplib::Response& res);

/// POST /parse-and-simulate — accepts multipart form with STEP file.
/// Returns { success, hierarchy, glb_base64, simulation_result, error }.
void handle_parse_and_simulate(const httplib::Request& req, httplib::Response& res);

} // namespace carbon
