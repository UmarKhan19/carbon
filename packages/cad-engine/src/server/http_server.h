#pragma once

/// HTTP server setup and route registration.
/// Uses cpp-httplib (single header, zero-dependency HTTP server).

#include <string>
#include <cstdint>

namespace carbon {

/// Start the HTTP server on the given port.
/// Blocks until the server is shut down.
void start_server(uint16_t port);

} // namespace carbon
