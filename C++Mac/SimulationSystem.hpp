#pragma once

#include "CellGrid.hpp"
#include "Configuration.hpp"
#include "StreamManager.hpp"
#include <vector>

namespace Matrix {

class SimulationSystem {
public:
    SimulationSystem(CellGrid& grid, Configuration& config, DerivedConfig& dConfig);
    ~SimulationSystem();

    void Update(int frame);
    
    StreamManager& GetStreamManager() { return streamManager; }

private:
    void UpdateCells(int frame, float timeScale);
    void UpdateCell(int idx, int frame, const Configuration& s, const DerivedConfig& d);
    
    void HandleRotator(int idx, int frame, const Configuration& s, const DerivedConfig& d);
    void ProgressRotator(int idx, float currentMix, int crossfadeFrames);
    void CycleRotator(int idx, int frame, int crossfadeFrames, int cycleFrames, const Configuration& s);
    uint16_t GetUniqueChar(uint16_t exclude);

    float CalculateAlpha(int idx, int age, int decay, int fadeDurationFrames);

    CellGrid& grid;
    Configuration& config;
    DerivedConfig& dConfig;
    StreamManager streamManager;
    
    float timeScale = 1.0f;
    std::vector<float> rotatorSpeedMap;
};

} // namespace Matrix
