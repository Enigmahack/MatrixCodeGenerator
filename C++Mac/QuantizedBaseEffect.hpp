#pragma once

#include "QuantizedTypes.hpp"
#include "CellGrid.hpp"
#include "Configuration.hpp"
#include <unordered_map>
#include <memory>

namespace Matrix {

class QuantizedBaseEffect {
public:
    QuantizedBaseEffect(CellGrid& grid, Configuration& config, DerivedConfig& dConfig);
    virtual ~QuantizedBaseEffect();

    virtual bool Trigger(bool force = false);
    virtual void Update(int frame);
    
    bool IsActive() const { return active; }
    float GetAlpha() const { return alpha; }
    int GetAnimFrame() const { return animFrame; }

    const LogicGrid& GetLogicGrid() const { return logicGrid; }
    const std::vector<MaskOp>& GetMaskOps() const { return maskOps; }

    friend class QuantizedSequence;

protected:
    void InitLogicGrid();
    void Terminate();

    CellGrid& grid;
    Configuration& config;
    DerivedConfig& dConfig;

    bool active = false;
    float alpha = 0.0f;
    int animFrame = 0;
    int timer = 0;
    std::string state = "IDLE";

    LogicGrid logicGrid;
    std::vector<MaskOp> maskOps;
    std::vector<Block> activeBlocks;
    
    int expansionPhase = 0;
    int cycleTimer = 0;
    int cyclesCompleted = 0;

    std::string configPrefix = "quantizedPulse";
};

} // namespace Matrix
