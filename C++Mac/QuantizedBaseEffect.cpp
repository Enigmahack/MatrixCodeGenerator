#include "QuantizedBaseEffect.hpp"
#include <cmath>
#include <algorithm>

namespace Matrix {

QuantizedBaseEffect::QuantizedBaseEffect(CellGrid& g, Configuration& c, DerivedConfig& d)
    : grid(g), config(c), dConfig(d) {
}

QuantizedBaseEffect::~QuantizedBaseEffect() = default;

void QuantizedBaseEffect::InitLogicGrid() {
    int bsW = 4; // Default block width
    int bsH = 4; // Default block height
    
    int blocksX = std::ceil(grid.cols / (float)bsW);
    int blocksY = std::ceil(grid.rows / (float)bsH);

    // Padding for center-alignment
    if ((blocksX * bsW - grid.cols) % 2 != 0) blocksX++;
    if ((blocksY * bsH - grid.rows) % 2 != 0) blocksY++;

    logicGrid.Resize(blocksX, blocksY);
}

bool QuantizedBaseEffect::Trigger(bool force) {
    if (active && !force) return false;

    active = true;
    animFrame = 0;
    timer = 0;
    expansionPhase = 0;
    cycleTimer = 0;
    cyclesCompleted = 0;
    alpha = 0.0f;
    state = "FADE_IN";

    maskOps.clear();
    activeBlocks.clear();
    InitLogicGrid();

    return true;
}

void QuantizedBaseEffect::Update(int frame) {
    if (!active) return;

    animFrame++;
    
    // Lifecycle
    int fadeInFrames = 30; // Simplified
    int fadeOutFrames = 30;
    int durationFrames = 300; // 5 seconds at 60fps

    if (state == "FADE_IN") {
        timer++;
        alpha = std::min(1.0f, timer / (float)fadeInFrames);
        if (timer >= fadeInFrames) {
            state = "SUSTAIN";
            timer = 0;
            alpha = 1.0f;
        }
    } else if (state == "SUSTAIN") {
        timer++;
        if (timer >= durationFrames) {
            state = "FADE_OUT";
            timer = 0;
        }
    } else if (state == "FADE_OUT") {
        timer++;
        alpha = std::max(0.0f, 1.0f - timer / (float)fadeOutFrames);
        if (timer >= fadeOutFrames) {
            Terminate();
        }
    }
}

void QuantizedBaseEffect::Terminate() {
    active = false;
    state = "IDLE";
    alpha = 0.0f;
}

} // namespace Matrix
