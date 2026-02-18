#include "server/http_server.h"

#include <cstdlib>
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    // Port from environment variable (default 8080, matching Rust cad-server)
    uint16_t port = 8080;
    if (const char* port_env = std::getenv("PORT")) {
        try {
            port = static_cast<uint16_t>(std::stoi(port_env));
        } catch (...) {
            std::cerr << "[cad-engine] Invalid PORT value, using default 8080" << std::endl;
        }
    }

    // Command-line override: --port <N>
    for (int i = 1; i < argc - 1; ++i) {
        if (std::string(argv[i]) == "--port") {
            try {
                port = static_cast<uint16_t>(std::stoi(argv[i + 1]));
            } catch (...) {
                std::cerr << "[cad-engine] Invalid --port value" << std::endl;
                return 1;
            }
        }
    }

    std::cout << "[cad-engine] Carbon CAD Engine v1.0.0" << std::endl;
    std::cout << "[cad-engine] OpenCascade + CGAL + cpp-httplib" << std::endl;

    carbon::start_server(port);

    return 0;
}
