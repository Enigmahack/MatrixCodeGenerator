#include "QuantizedSequence.hpp"
#include "QuantizedBaseEffect.hpp"
#include <cmath>
#include <algorithm>

namespace Matrix {

void QuantizedSequence::ExecuteStepOps(QuantizedBaseEffect* fx, const std::vector<int>& step, int frameOverride) {
    if (step.empty()) return;

    int now = (frameOverride != -1) ? frameOverride : fx->animFrame;
    int i = 0;
    while (i < (int)step.size()) {
        int opCode = step[i++];
        
        switch (opCode) {
            case 1: { // ADD (x, y)
                int dx = step[i++];
                int dy = step[i++];
                HandleOp(fx, OpType::ADD, {dx, dy}, 0, now, i);
                break;
            }
            case 2: { // REM (x, y, mask)
                int dx = step[i++];
                int dy = step[i++];
                int mask = step[i++];
                int layer = (mask >> 4) & 0x7;
                HandleOp(fx, OpType::REM, {dx, dy}, layer, now, i);
                break;
            }
            case 3: { // RECT (x1, y1, x2, y2)
                int x1 = step[i++];
                int y1 = step[i++];
                int x2 = step[i++];
                int y2 = step[i++];
                HandleOp(fx, OpType::RECT, {x1, y1, x2, y2}, 0, now, i);
                break;
            }
            case 6: { // SMART (x, y)
                int dx = step[i++];
                int dy = step[i++];
                HandleOp(fx, OpType::SMART, {dx, dy}, 0, now, i);
                break;
            }
            case 7: { // REM_BLOCK (x, y)
                int dx = step[i++];
                int dy = step[i++];
                HandleOp(fx, OpType::REM_BLOCK, {dx, dy}, 0, now, i);
                break;
            }
            case 8: { // ADD_L (x, y, l)
                int dx = step[i++];
                int dy = step[i++];
                int l = step[i++];
                HandleOp(fx, OpType::ADD, {dx, dy}, l, now, i);
                break;
            }
            case 9: { // RECT_L (x1, y1, x2, y2, l)
                int x1 = step[i++];
                int y1 = step[i++];
                int x2 = step[i++];
                int y2 = step[i++];
                int l = step[i++];
                HandleOp(fx, OpType::RECT, {x1, y1, x2, y2}, l, now, i);
                break;
            }
            case 10: { // SMART_L
                int dx = step[i++];
                int dy = step[i++];
                int l = step[i++];
                HandleOp(fx, OpType::SMART, {dx, dy}, l, now, i);
                break;
            }
            case 11: { // REM_L
                int dx = step[i++];
                int dy = step[i++];
                int l = step[i++];
                HandleOp(fx, OpType::REM_BLOCK, {dx, dy}, l, now, i);
                break;
            }
            case 12:   // NUDGE
            case 13: { // NUDGE_ML
                int dx = step[i++];
                int dy = step[i++];
                int w = step[i++];
                int h = step[i++];
                int l = step[i++];
                int fMask = step[i++];
                char face = 'N';
                if (fMask == 1) face = 'N';
                else if (fMask == 2) face = 'S';
                else if (fMask == 4) face = 'E';
                else if (fMask == 8) face = 'W';
                ExecuteNudge(fx, dx, dy, w, h, face, l, opCode == 13, now);
                break;
            }
            default:
                break;
        }
    }
}

int QuantizedSequence::HandleOp(QuantizedBaseEffect* fx, OpType type, const std::vector<int>& args, int layer, int now, int nextIdx) {
    auto& lg = const_cast<LogicGrid&>(fx->GetLogicGrid());
    int cx = lg.width / 2;
    int cy = lg.height / 2;

    auto setLocalActive = [&](int dx, int dy) {
        int gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < lg.width && gy >= 0 && gy < lg.height) {
            lg.occupancy[gy * lg.width + gx] = 1;
            if (lg.renderGrid[gy * lg.width + gx] == -1) {
                lg.renderGrid[gy * lg.width + gx] = now;
            }
        }
    };

    auto setLayerActive = [&](int dx, int dy, int l, int frame) {
        int gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < lg.width && gy >= 0 && gy < lg.height) {
            lg.layerGrids[l][gy * lg.width + gx] = frame;
        }
    };

    auto setLayerInactive = [&](int dx, int dy, int l) {
        int gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < lg.width && gy >= 0 && gy < lg.height) {
            if (l != -1) lg.layerGrids[l][gy * lg.width + gx] = -1;
            else {
                for(int j=0; j<4; j++) lg.layerGrids[j][gy * lg.width + gx] = -1;
            }
            
            bool stillActive = false;
            for(int j=0; j<4; j++) if(lg.layerGrids[j][gy * lg.width + gx] != -1) { stillActive = true; break; }
            if(!stillActive) lg.occupancy[gy * lg.width + gx] = 0;
        }
    };

    if (type == OpType::ADD || type == OpType::SMART) {
        int dx = args[0], dy = args[1];
        setLocalActive(dx, dy);
        setLayerActive(dx, dy, layer, now);
        const_cast<std::vector<MaskOp>&>(fx->GetMaskOps()).push_back({type, dx, dy, dx, dy, layer, now, 0, false, true});
    } else if (type == OpType::RECT) {
        int dx1 = args[0], dy1 = args[1], dx2 = args[2], dy2 = args[3];
        int xMin = std::min(dx1, dx2), xMax = std::max(dx1, dx2);
        int yMin = std::min(dy1, dy2), yMax = std::max(dy1, dy2);
        for(int gy=yMin; gy<=yMax; gy++) {
            for(int gx=xMin; gx<=xMax; gx++) {
                setLocalActive(gx, gy);
                setLayerActive(gx, gy, layer, now);
            }
        }
        const_cast<std::vector<MaskOp>&>(fx->GetMaskOps()).push_back({type, dx1, dy1, dx2, dy2, layer, now, 0, false, true});
    } else if (type == OpType::REM_BLOCK || type == OpType::REM) {
        int dx1 = args[0], dy1 = args[1];
        int dx2 = (args.size() >= 4) ? args[2] : dx1;
        int dy2 = (args.size() >= 4) ? args[3] : dy1;
        int xMin = std::min(dx1, dx2), xMax = std::max(dx1, dx2);
        int yMin = std::min(dy1, dy2), yMax = std::max(dy1, dy2);
        for(int gy=yMin; gy<=yMax; gy++) {
            for(int gx=xMin; gx<=xMax; gx++) {
                setLayerInactive(gx, gy, layer);
            }
        }
        const_cast<std::vector<MaskOp>&>(fx->GetMaskOps()).push_back({OpType::REM_BLOCK, dx1, dy1, dx2, dy2, layer, now, 0, false, true});
    }

    return nextIdx;
}

void QuantizedSequence::ExecuteNudge(QuantizedBaseEffect* fx, int dx, int dy, int w, int h, char face, int layer, bool multiLayer, int now) {
    // Nudge is complex, simplified for now
}

} // namespace Matrix
