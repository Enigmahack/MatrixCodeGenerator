#include "CellGrid.hpp"
#include <random>
#include <algorithm>

namespace Matrix {

CellGrid::CellGrid() = default;
CellGrid::~CellGrid() = default;

void CellGrid::Resize(int newCols, int newRows) {
    if (newCols == cols && newRows == rows) return;

    cols = newCols;
    rows = newRows;
    int total = cols * rows;

    activeIndices.clear();
    activeFlag.assign(total, 0);
    state.assign(total, CellState::INACTIVE);

    chars.assign(total, 32);
    colors.assign(total, 0);
    baseColors.assign(total, 0);
    alphas.assign(total, 0.0f);
    glows.assign(total, 0.0f);
    fontIndices.assign(total, 0);

    secondaryChars.assign(total, 32);
    secondaryColors.assign(total, 0);
    secondaryAlphas.assign(total, 0.0f);
    secondaryGlows.assign(total, 0.0f);
    secondaryFontIndices.assign(total, 0);

    mix.assign(total, 0.0f);
    renderMode.assign(total, RenderMode::STANDARD);

    overrideActive.assign(total, OverrideMode::NONE);
    overrideChars.assign(total, 32);
    overrideColors.assign(total, 0);
    overrideAlphas.assign(total, 0.0f);
    overrideGlows.assign(total, 0.0f);
    overrideMix.assign(total, 0.0f);
    overrideNextChars.assign(total, 0);
    overrideFontIndices.assign(total, 0);

    effectActive.assign(total, 0);
    effectChars.assign(total, 32);
    effectColors.assign(total, 0);
    effectAlphas.assign(total, 0.0f);
    effectGlows.assign(total, 0.0f);
    effectFontIndices.assign(total, 0);

    types.assign(total, 0);
    decays.assign(total, 0);
    maxDecays.assign(total, 0);
    ages.assign(total, 0);
    brightness.assign(total, 0.0f);
    streamSeeds.assign(total, 0);
    rotatorOffsets.assign(total, 0);
    cellLocks.assign(total, 0);

    nextChars.assign(total, 0);
    nextOverlapChars.assign(total, 0);

    envGlows.assign(total, 0.0f);
    genericParams.assign(total * 4, 0.0f);

    complexStyles.clear();

    // Randomize offsets and chars
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> offsetDist(0, 255);
    
    // Minimal fallback characters (similar to JS implementation)
    std::string fallback = "0123456789Z:<=>\"*+-._!|";
    std::uniform_int_distribution<> charDist(0, fallback.length() - 1);

    for (int i = 0; i < total; ++i) {
        rotatorOffsets[i] = static_cast<uint8_t>(offsetDist(gen));
        chars[i] = static_cast<uint16_t>(fallback[charDist(gen)]);
    }
}

void CellGrid::Clear() {
    int total = cols * rows;
    std::fill(activeFlag.begin(), activeFlag.end(), 0);
    std::fill(state.begin(), state.end(), CellState::INACTIVE);
    activeIndices.clear();
    // Resetting other buffers if needed, but usually SimulationSystem handles cell deaths
}

void CellGrid::ClearCell(int idx) {
    if (idx < 0 || idx >= (int)state.size()) return;

    state[idx] = CellState::INACTIVE;
    activeFlag[idx] = 0;
    chars[idx] = 32;
    alphas[idx] = 0.0f;
    glows[idx] = 0.0f;
    mix[idx] = 0.0f;
    renderMode[idx] = RenderMode::STANDARD;

    types[idx] = 0;
    ages[idx] = 0;
    decays[idx] = 0;
    maxDecays[idx] = 0;

    secondaryChars[idx] = 32;
    secondaryAlphas[idx] = 0.0f;

    activeIndices.erase(idx);
    complexStyles.erase(idx);
    nextChars[idx] = 0;
    nextOverlapChars[idx] = 0;

    int gOff = idx * 4;
    genericParams[gOff] = 0.0f;
    genericParams[gOff + 1] = 0.0f;
    genericParams[gOff + 2] = 0.0f;
    genericParams[gOff + 3] = 0.0f;
}

int CellGrid::GetIndex(int x, int y) const {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    return y * cols + x;
}

uint16_t CellGrid::GetCharCode(int idx) const {
    if (idx < 0 || idx >= (int)chars.size()) return 32;
    return chars[idx];
}

} // namespace Matrix
