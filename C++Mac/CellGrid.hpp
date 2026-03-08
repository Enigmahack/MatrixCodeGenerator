#pragma once

#include "Types.hpp"
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <memory>

namespace Matrix {

struct ComplexStyle {
    std::string type;
    int age = 0;
    bool mobile = false;
    int moveInterval = 0;
    int nextMove = 0;
    int moveDir = 0;
    float seed = 0.0f;
    bool cycle = false;
    float h = 0.0f;
    float s = 0.0f;
    float l = 0.0f;
    float speed = 0.0f;
};

class CellGrid {
public:
    CellGrid();
    ~CellGrid();

    void Resize(int cols, int rows);
    void Clear();
    void ClearCell(int idx);

    int GetIndex(int x, int y) const;
    uint16_t GetCharCode(int idx) const;

    // Grid dimensions
    int cols = 0;
    int rows = 0;

    // --- Core State ---
    std::unordered_set<int> activeIndices;
    std::vector<uint8_t> activeFlag; // 0/1
    std::vector<CellState> state;

    // --- Primary Layer ---
    std::vector<uint16_t> chars;
    std::vector<uint32_t> colors;
    std::vector<uint32_t> baseColors;
    std::vector<float> alphas;
    std::vector<float> glows;
    std::vector<uint8_t> fontIndices;

    // --- Secondary Layer ---
    std::vector<uint16_t> secondaryChars;
    std::vector<uint32_t> secondaryColors;
    std::vector<float> secondaryAlphas;
    std::vector<float> secondaryGlows;
    std::vector<uint8_t> secondaryFontIndices;

    // --- Mixing & Rendering ---
    std::vector<float> mix;
    std::vector<RenderMode> renderMode;

    // --- Override Layer ---
    std::vector<OverrideMode> overrideActive;
    std::vector<uint16_t> overrideChars;
    std::vector<uint32_t> overrideColors;
    std::vector<float> overrideAlphas;
    std::vector<float> overrideGlows;
    std::vector<float> overrideMix;
    std::vector<uint16_t> overrideNextChars;
    std::vector<uint8_t> overrideFontIndices;

    // --- Passive Layer (Effects) ---
    std::vector<uint8_t> effectActive;
    std::vector<uint16_t> effectChars;
    std::vector<uint32_t> effectColors;
    std::vector<float> effectAlphas;
    std::vector<float> effectGlows;
    std::vector<uint8_t> effectFontIndices;

    // --- Simulation Logic Storage ---
    std::vector<uint8_t> types;
    std::vector<uint16_t> decays;
    std::vector<uint16_t> maxDecays;
    std::vector<int32_t> ages;
    std::vector<float> brightness;
    std::vector<uint8_t> streamSeeds;
    std::vector<uint8_t> rotatorOffsets;
    std::vector<uint8_t> cellLocks;

    // --- Sparse Data ---
    std::unordered_map<int, ComplexStyle> complexStyles;

    // --- Rotator Targets ---
    std::vector<uint16_t> nextChars;
    std::vector<uint16_t> nextOverlapChars;

    // --- Environmental Glows ---
    std::vector<float> envGlows;

    // --- Optimized Effects Data ---
    std::vector<float> genericParams; // 4 floats per cell
};

} // namespace Matrix
