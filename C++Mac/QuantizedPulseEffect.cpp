#include "QuantizedPulseEffect.hpp"
#include "QuantizedSequence.hpp"
#include "QuantizedPatterns.hpp"

namespace Matrix {

QuantizedPulseEffect::QuantizedPulseEffect(CellGrid& g, Configuration& c, DerivedConfig& d)
    : QuantizedBaseEffect(g, c, d) {
    auto& patterns = GetPatterns();
    if (patterns.count("QuantizedPulse")) {
        pattern = &patterns.at("QuantizedPulse");
    }
}

bool QuantizedPulseEffect::Trigger(bool force) {
    if (!QuantizedBaseEffect::Trigger(force)) return false;
    // Specific initialization for Pulse
    return true;
}

void QuantizedPulseEffect::Update(int frame) {
    if (!active) return;

    QuantizedBaseEffect::Update(frame);
    
    if (state != "IDLE" && pattern) {
        cycleTimer++;
        if (cycleTimer >= 5) { // Fixed speed for now
            cycleTimer = 0;
            if (expansionPhase < (int)pattern->size()) {
                QuantizedSequence::ExecuteStepOps(this, (*pattern)[expansionPhase]);
                expansionPhase++;
            }
        }
    }
}

} // namespace Matrix
