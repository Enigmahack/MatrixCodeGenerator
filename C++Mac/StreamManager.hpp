#pragma once

#include "CellGrid.hpp"
#include "Configuration.hpp"
#include "Utils.hpp"
#include <vector>
#include <unordered_set>
#include <memory>

namespace Matrix {

struct Stream {
    int x = 0;
    int y = -1;
    bool active = true;
    int delay = 0;
    int age = 0;
    int len = 0;
    std::unordered_set<int> holes;
    int decayY = -1;
    bool decayStarted = false;
    float visibleLen = 0.0f;
    std::string mode = "STANDARD";
    float baseHue = 0.0f;
    bool isInverted = false;
    bool isEraser = false;
    bool isUpward = false;
    bool isGradual = false;
    int pIdx = 0;
    int fontIndex = 0;
    uint8_t brightnessSeed = 0;
    float tickInterval = 0.0f;
    float tickTimer = 0.0f;
    uint16_t maxDecay = 0;
};

class StreamManager {
public:
    StreamManager(CellGrid& grid, Configuration& config, DerivedConfig& dConfig);
    ~StreamManager();

    void Update(int frame, float timeScale);
    void Resize(int cols);

    const std::vector<std::unique_ptr<Stream>>& GetActiveStreams() const { return activeStreams; }

private:
    void ManageStreams(int frame, float timeScale);
    void ManageGlimmer(const Configuration& s);
    void SpawnStreams(const Configuration& s, const DerivedConfig& d);
    void ProcessActiveStreams(int frame, float timeScale);
    
    void SpawnStreamAt(int x, bool forceEraser, float forcedSpeed);
    void SpawnUpwardTracerAt(int x);
    
    float GenerateSpeed(const Configuration& s);
    void WriteHead(Stream& stream, int frame);
    void HandleEraserHead(int idx);
    void HandleTracerHead(Stream& stream, int idx, int frame);
    void HandleUpwardHead(int idx);
    void HandleStreamCompletion(Stream& stream);

    CellGrid& grid;
    Configuration& config;
    DerivedConfig& dConfig;

    std::vector<std::unique_ptr<Stream>> activeStreams;
    std::vector<Stream*> lastStreamInColumn;
    std::vector<Stream*> lastEraserInColumn;
    std::vector<Stream*> lastUpwardTracerInColumn;
    std::vector<float> columnSpeeds;
    std::vector<int> streamsPerColumn;
    
    int nextSpawnFrame = 0;
    std::vector<int> columnsPool;
    std::vector<uint8_t> glimmerColCounts;
};

} // namespace Matrix
