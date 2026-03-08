#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace Matrix {

enum class CellState : uint8_t {
    INACTIVE = 0,
    ACTIVE = 1
};

enum class RenderMode : uint8_t {
    STANDARD = 0,
    OVERLAP = 1,
    ADDITIVE = 2
};

enum class OverrideMode : uint8_t {
    NONE = 0,
    CHAR = 1,
    SOLID = 2,
    FULL = 3,
    DUAL = 5
};

enum class CellType : uint8_t {
    EMPTY = 0,
    TRAIL = 1,
    TRACER = 2,
    ROTATOR = 3,
    UPWARD_TRACER = 4
};

const uint8_t CELL_TYPE_MASK = 0x7F;
const uint8_t CELL_FLAG_GRADUAL = 0x80;

struct Color {
    uint8_t r, g, b, a;

    static uint32_t PackABGR(uint8_t r, uint8_t g, uint8_t b, uint8_t a = 255) {
        return (static_cast<uint32_t>(a) << 24) |
               (static_cast<uint32_t>(b) << 16) |
               (static_cast<uint32_t>(g) << 8) |
               static_cast<uint32_t>(r);
    }

    static Color UnpackABGR(uint32_t packed) {
        return {
            static_cast<uint8_t>(packed & 0xFF),
            static_cast<uint8_t>((packed >> 8) & 0xFF),
            static_cast<uint8_t>((packed >> 16) & 0xFF),
            static_cast<uint8_t>((packed >> 24) & 0xFF)
        };
    }
};

} // namespace Matrix
