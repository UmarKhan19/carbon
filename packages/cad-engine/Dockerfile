# Multi-stage build for the Carbon CAD Engine.
# Stage 1: Build with full development dependencies.
# Stage 2: Runtime image with only shared libraries.

FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    ninja-build \
    wget \
    # OpenCascade development packages
    libocct-data-exchange-dev \
    libocct-foundation-dev \
    libocct-modeling-algorithms-dev \
    libocct-modeling-data-dev \
    # CGAL
    libcgal-dev \
    # Eigen3
    libeigen3-dev \
    # nlohmann/json
    nlohmann-json3-dev \
    # SSL (optional, for cpp-httplib HTTPS support)
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN cmake -B build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TESTS=OFF \
    && cmake --build build --target cad-engine

# --- Runtime stage ---
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    # OpenCascade runtime libraries
    libocct-data-exchange-7.6 \
    libocct-foundation-7.6 \
    libocct-modeling-algorithms-7.6 \
    libocct-modeling-data-7.6 \
    # CGAL runtime (header-only for most, but some components need libgmp/libmpfr)
    libgmp10 \
    libmpfr6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build/cad-engine /usr/local/bin/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["cad-engine"]
