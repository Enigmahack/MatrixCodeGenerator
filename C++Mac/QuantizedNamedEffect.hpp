#include "QuantizedBaseEffect.hpp"
#include "QuantizedPatterns.hpp"
#include "QuantizedSequence.hpp"

namespace Matrix {

class QuantizedNamedEffect : public QuantizedBaseEffect {
public:
    QuantizedNamedEffect(CellGrid& grid, Configuration& config, DerivedConfig& dConfig, const std::string& patternName)
        : QuantizedBaseEffect(grid, config, dConfig), name(patternName) {
        auto& patterns = GetPatterns();
        if (patterns.count(patternName)) {
            pattern = &patterns.at(patternName);
        }
    }
    
    bool Trigger(bool force = false) override {
        return QuantizedBaseEffect::Trigger(force);
    }

    void Update(int frame) override {
        if (!active) return;
        QuantizedBaseEffect::Update(frame);
        if (state != "IDLE" && pattern) {
            cycleTimer++;
            if (cycleTimer >= 5) {
                cycleTimer = 0;
                if (expansionPhase < (int)pattern->size()) {
                    QuantizedSequence::ExecuteStepOps(this, (*pattern)[expansionPhase]);
                    expansionPhase++;
                }
            }
        }
    }

private:
    std::string name;
    const PatternData* pattern = nullptr;
};

} // namespace Matrix
