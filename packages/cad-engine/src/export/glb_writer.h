#pragma once

/// GLB (binary glTF) writer for exporting tessellated meshes.
/// Replaces packages/cad-service/src/gltf_writer.py.

#include "geometry/types.h"
#include <string>
#include <vector>

namespace carbon {

/// Write an assembly's meshes to GLB binary format.
/// Node names use hierarchy IDs (UUIDs) so viewer entity IDs match the assembly tree.
std::vector<uint8_t> write_glb(const AssemblyNode& hierarchy);

/// Encode raw bytes to base64 string.
std::string base64_encode(const std::vector<uint8_t>& data);

} // namespace carbon
