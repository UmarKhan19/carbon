cmake_minimum_required(VERSION 3.20)
project(carbon_cad_engine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# --- Dependencies ---

# OpenCascade
find_package(OpenCASCADE REQUIRED)

# CGAL
find_package(CGAL REQUIRED)

# Eigen3 (accepts Eigen 3.x or 5.x — Homebrew ships Eigen 5)
find_package(Eigen3 REQUIRED NO_MODULE)

# nlohmann/json (header-only, try find_package first, fallback to FetchContent)
find_package(nlohmann_json 3.11 QUIET)
if(NOT nlohmann_json_FOUND)
    include(FetchContent)
    FetchContent_Declare(
        nlohmann_json
        GIT_REPOSITORY https://github.com/nlohmann/json.git
        GIT_TAG v3.11.3
    )
    FetchContent_MakeAvailable(nlohmann_json)
endif()

# cpp-httplib (header-only, downloaded into third_party/)
if(NOT EXISTS "${CMAKE_SOURCE_DIR}/third_party/httplib.h")
    file(DOWNLOAD
        "https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.18.3/httplib.h"
        "${CMAKE_SOURCE_DIR}/third_party/httplib.h"
        STATUS DOWNLOAD_STATUS
    )
    list(GET DOWNLOAD_STATUS 0 STATUS_CODE)
    if(NOT STATUS_CODE EQUAL 0)
        message(WARNING "Failed to download cpp-httplib. Please manually place httplib.h in third_party/")
    endif()
endif()

# --- Engine library (shared between main exe and tests) ---

set(ENGINE_LIB_SOURCES
    src/server/http_server.cpp
    src/server/handlers.cpp
    src/parsing/step_reader.cpp
    src/parsing/brep_analyzer.cpp
    src/parsing/tessellator.cpp
    src/export/glb_writer.cpp
    src/geometry/aabb.cpp
    src/geometry/mesh_utils.cpp
    src/collision/collision_utils.cpp
    src/collision/contact_graph.cpp
    src/collision/blocking_matrix.cpp
    src/classification/part_classifier.cpp
    src/graph/dependency_graph.cpp
    src/graph/community_detect.cpp
    src/graph/kit_detection.cpp
    src/simulator/simulator.cpp
    src/simulator/path_planner.cpp
    src/simulator/animation_gen.cpp
    src/identical/geometry_signature.cpp
)

# OpenCascade libraries (OCCT 7.9 naming):
# TKernel, TKMath           — foundation
# TKBRep, TKTopAlgo         — BRep topology
# TKGeomAlgo, TKGeomBase    — geometric algorithms
# TKDESTEP, TKDE, TKXSBase  — STEP import (7.9 renamed from TKSTEP)
# TKDECascade               — cascade data exchange
# TKXCAF, TKLCAF, TKVCAF, TKCAF, TKCDF — XCAF framework
# TKMesh                    — tessellation
# TKShHealing               — shape healing
# TKG3d                     — 3D geometry
set(OCCT_LIBS
    TKernel TKMath
    TKBRep TKTopAlgo TKGeomAlgo TKGeomBase TKG3d
    TKDESTEP TKDE TKDECascade TKXSBase
    TKXCAF TKLCAF TKVCAF TKCAF TKCDF
    TKMesh
    TKShHealing
)

add_library(cad-engine-lib STATIC ${ENGINE_LIB_SOURCES})
target_include_directories(cad-engine-lib PUBLIC
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party
    ${OpenCASCADE_INCLUDE_DIR}
)
target_link_libraries(cad-engine-lib PUBLIC
    ${OCCT_LIBS}
    CGAL::CGAL
    Eigen3::Eigen
    nlohmann_json::nlohmann_json
)

# --- Main executable ---

add_executable(cad-engine src/main.cpp)
target_link_libraries(cad-engine PRIVATE cad-engine-lib)

# --- Tests (optional) ---

option(BUILD_TESTS "Build unit tests" ON)
if(BUILD_TESTS)
    include(FetchContent)
    FetchContent_Declare(
        googletest
        GIT_REPOSITORY https://github.com/google/googletest.git
        GIT_TAG v1.15.2
    )
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)

    enable_testing()

    add_executable(cad-engine-tests
        tests/test_geometry_signature.cpp
        tests/test_contact_graph.cpp
        tests/test_classifier.cpp
        tests/test_dependency_graph.cpp
        tests/test_simulator.cpp
    )
    target_include_directories(cad-engine-tests PRIVATE
        ${CMAKE_SOURCE_DIR}/tests
    )
    target_link_libraries(cad-engine-tests PRIVATE
        GTest::gtest_main
        cad-engine-lib
    )
    include(GoogleTest)
    gtest_discover_tests(cad-engine-tests)
endif()
