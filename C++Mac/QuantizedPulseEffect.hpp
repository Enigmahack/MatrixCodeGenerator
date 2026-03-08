#pragma once

#include "QuantizedBaseEffect.hpp"
#include "QuantizedPatterns.hpp"

namespace Matrix {

class QuantizedPulseEffect : public QuantizedBaseEffect {
public:
    QuantizedPulseEffect(CellGrid& grid, Configuration& config, DerivedConfig& dConfig);
    
    bool Trigger(bool force = false) override;
    void Update(int frame) override;

private:
    const PatternData* pattern = nullptr;
};

} // namespace Matrix
