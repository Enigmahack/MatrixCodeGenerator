#pragma once

#include <vector>
#include <string>
#include <cstdint>

namespace Matrix {

enum class OpType : uint8_t {
    ADD = 1,
    REM = 2,
    RECT = 3,
    SMART = 6,
    REM_BLOCK = 7,
    ADD_L = 8,
    RECT_L = 9,
    SMART_L = 10,
    REM_L = 11,
    NUDGE = 12,
    NUDGE_ML = 13,
    SHIFT = 14,
    GROUP = 99
};

struct MaskOp {
    OpType type;
    int x1, y1, x2, y2;
    int layer = 0;
    int startFrame = 0;
    int startPhase = 0;
    bool invisible = false;
    bool fade = true;
};

struct Block {
    int x, y, w, h;
    int layer = 0;
    int startFrame = 0;
    int id = 0;
    int dist = 0;
    bool invisible = false;
};

struct LogicGrid {
    std::vector<uint8_t> occupancy; // 0/1
    std::vector<int32_t> renderGrid; // frame index or -1
    std::vector<int32_t> layerGrids[4]; // frame index or -1
    int width = 0;
    int height = 0;

    void Resize(int w, int h) {
        width = w;
        height = h;
        int total = w * h;
        occupancy.assign(total, 0);
        renderGrid.assign(total, -1);
        for (int i = 0; i < 4; i++) {
            layerGrids[i].assign(total, -1);
        }
    }

    void Clear() {
        std::fill(occupancy.begin(), occupancy.end(), 0);
        std::fill(renderGrid.begin(), renderGrid.end(), -1);
        for (int i = 0; i < 4; i++) {
            std::fill(layerGrids[i].begin(), layerGrids[i].end(), -1);
        }
    }
};

} // namespace Matrix
