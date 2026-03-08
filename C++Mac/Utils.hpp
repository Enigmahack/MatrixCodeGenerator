#pragma once

#include <random>
#include <string>
#include <algorithm>
#include "Types.hpp"

namespace Matrix {

class Utils {
public:
    static int RandomInt(int min, int max) {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(min, max);
        return dis(gen);
    }

    static float RandomFloat(float min, float max) {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        std::uniform_real_distribution<float> dis(min, max);
        return dis(gen);
    }

    static uint32_t PackAbgr(uint8_t r, uint8_t g, uint8_t b, uint8_t a = 255) {
        return (static_cast<uint32_t>(a) << 24) |
               (static_cast<uint32_t>(b) << 16) |
               (static_cast<uint32_t>(g) << 8) |
               static_cast<uint32_t>(r);
    }

    static float CalculateCharBrightness(uint16_t charCode, uint8_t seed, float varianceMin) {
        // Deterministic hash based on charCode and seed
        float h = std::fmod(static_cast<float>(charCode) * 12.9898f + static_cast<float>(seed) * 78.233f, 1.0f);
        float hash = std::fmod(std::abs(std::sin(h) * 43758.5453f), 1.0f);
        return varianceMin + hash * (1.0f - varianceMin);
    }

    // Basic HSL to RGB conversion
    static Color HslToRgb(float h, float s, float l) {
        s /= 100.0f;
        l /= 100.0f;

        float chroma = (1.0f - std::abs(2.0f * l - 1.0f)) * s;
        float x = chroma * (1.0f - std::abs(std::fmod(h / 60.0f, 2.0f) - 1.0f));
        float m = l - chroma / 2.0f;

        float r = 0, g = 0, b = 0;
        if (h >= 0 && h < 60) { r = chroma; g = x; b = 0; }
        else if (h >= 60 && h < 120) { r = x; g = chroma; b = 0; }
        else if (h >= 120 && h < 180) { r = 0; g = chroma; b = x; }
        else if (h >= 180 && h < 240) { r = 0; g = x; b = chroma; }
        else if (h >= 240 && h < 300) { r = x; g = 0; b = chroma; }
        else if (h >= 300 && h < 360) { r = chroma; g = 0; b = x; }

        return {
            static_cast<uint8_t>((r + m) * 255),
            static_cast<uint8_t>((g + m) * 255),
            static_cast<uint8_t>((b + m) * 255),
            255
        };
    }
};

} // namespace Matrix
