#pragma once

#include "QuantizedTypes.hpp"
#include <vector>

namespace Matrix {

class QuantizedBaseEffect;

class QuantizedSequence {
public:
    static void ExecuteStepOps(QuantizedBaseEffect* fx, const std::vector<int>& step, int frameOverride = -1);

private:
    static int HandleOp(QuantizedBaseEffect* fx, OpType type, const std::vector<int>& args, int layer, int now, int nextIdx);
    static void ExecuteNudge(QuantizedBaseEffect* fx, int dx, int dy, int w, int h, char face, int layer, bool multiLayer, int now);
};

} // namespace Matrix
