#include "server/http_server.h"
#include "server/handlers.h"

#include <httplib.h>
#include <iostream>

namespace carbon {

void start_server(uint16_t port) {
    httplib::Server svr;

    // Allow large uploads (100 MB STEP files, base64 GLB payloads)
    svr.set_payload_max_length(100 * 1024 * 1024); // 100 MB

    // Generous timeouts for large file uploads and long simulations
    svr.set_read_timeout(300);   // 5 minutes — uploading 100 MB can be slow
    svr.set_write_timeout(300);  // 5 minutes — simulation + serialization

    // CORS pre-flight
    svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "*");
        res.status = 204;
    });

    // Routes
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        add_cors_headers(res);
        handle_health(res);
    });

    svr.Post("/parse", [](const httplib::Request& req, httplib::Response& res) {
        add_cors_headers(res);
        handle_parse(req, res);
    });

    svr.Post("/simulate", [](const httplib::Request& req, httplib::Response& res) {
        add_cors_headers(res);
        handle_simulate(req, res);
    });

    svr.Post("/parse-and-simulate", [](const httplib::Request& req, httplib::Response& res) {
        add_cors_headers(res);
        handle_parse_and_simulate(req, res);
    });

    std::cout << "[cad-engine] Starting server on port " << port << std::endl;
    svr.listen("0.0.0.0", port);
}

} // namespace carbon
