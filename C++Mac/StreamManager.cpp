#include "StreamManager.hpp"
#include <cmath>
#include <algorithm>
#include <random>

namespace Matrix {

StreamManager::StreamManager(CellGrid& g, Configuration& c, DerivedConfig& d)
    : grid(g), config(c), dConfig(d) {
    Resize(grid.cols);
}

StreamManager::~StreamManager() = default;

void StreamManager::Resize(int cols) {
    lastStreamInColumn.assign(cols, nullptr);
    lastEraserInColumn.assign(cols, nullptr);
    lastUpwardTracerInColumn.assign(cols, nullptr);
    columnSpeeds.assign(cols, 0.0f);
    streamsPerColumn.assign(cols, 0);
    activeStreams.clear();
    
    columnsPool.assign(cols, 0);
    for (int i = 0; i < cols; ++i) columnsPool[i] = i;

    glimmerColCounts.assign(cols, 0);
}

void StreamManager::Update(int frame, float timeScale) {
    if (std::abs(timeScale) < 0.01f) return;

    if (timeScale > 0.0f) {
        ManageStreams(frame, timeScale);
    } else {
        ProcessActiveStreams(frame, timeScale);
    }
}

void StreamManager::ManageStreams(int frame, float timeScale) {
    ManageGlimmer(config);

    if (frame >= nextSpawnFrame) {
        SpawnStreams(config, dConfig);
        
        int baseInterval = std::max(1, static_cast<int>(20.0f * config.releaseInterval)); // 20 frames per unit
        int nextDelay = baseInterval;
        
        if (config.desyncIntensity > 0.0f) {
            int variance = static_cast<int>(baseInterval * config.desyncIntensity * 2.0f);
            int offset = Utils::RandomInt(-variance / 2, variance / 2);
            nextDelay = std::max(1, baseInterval + offset);
        }
        
        nextSpawnFrame = frame + nextDelay;
    }

    ProcessActiveStreams(frame, timeScale);
}

void StreamManager::ManageGlimmer(const Configuration& s) {
    // Basic glimmer management (simplified)
}

void StreamManager::SpawnStreams(const Configuration& s, const DerivedConfig& d) {
    std::shuffle(columnsPool.begin(), columnsPool.end(), std::mt19937(std::random_device()()));

    int streamCount = s.streamSpawnCount;
    int eraserCount = s.eraserSpawnCount;

    for (int col : columnsPool) {
        if (streamCount <= 0 && eraserCount <= 0) break;

        float colSpeed = columnSpeeds[col];
        if (streamsPerColumn[col] == 0) {
            colSpeed = GenerateSpeed(s);
            columnSpeeds[col] = colSpeed;
        }

        // Simplified spawn checks
        if (eraserCount > 0 && streamsPerColumn[col] > 0) {
             SpawnStreamAt(col, true, colSpeed);
             eraserCount--;
        } else if (streamCount > 0 && streamsPerColumn[col] == 0) {
             SpawnStreamAt(col, false, colSpeed);
             streamCount--;
        }
    }
}

void StreamManager::ProcessActiveStreams(int frame, float timeScale) {
    float speedMult = std::abs(timeScale);
    bool isReverse = timeScale < 0.0f;

    for (auto it = activeStreams.begin(); it != activeStreams.end();) {
        Stream& stream = *(*it);
        
        if (!stream.active) {
            streamsPerColumn[stream.x]--;
            it = activeStreams.erase(it);
            continue;
        }

        if (stream.delay > 0) {
            stream.delay--;
            ++it;
            continue;
        }

        stream.tickTimer -= speedMult;
        if (stream.tickTimer > 0.0f) {
            ++it;
            continue;
        }
        stream.tickTimer = stream.tickInterval;

        if (isReverse) {
            stream.y--;
            if (stream.y < -5) {
                stream.active = false;
            } else {
                WriteHead(stream, frame);
            }
        } else {
            // Drop-off logic
            float stopChance = stream.isEraser ? config.eraserStopChance : config.tracerStopChance;
            if (stopChance > 0.0f && Utils::RandomFloat(0.0f, 100.0f) < stopChance) {
                stream.active = false;
                ++it;
                continue;
            }

            stream.age++;
            if (stream.age >= static_cast<int>(stream.visibleLen)) {
                HandleStreamCompletion(stream);
                ++it;
                continue;
            }

            if (stream.y < stream.len) {
                stream.y++;
                WriteHead(stream, frame);
            }
        }
        ++it;
    }
}

void StreamManager::SpawnStreamAt(int x, bool forceEraser, float forcedSpeed) {
    auto stream = std::make_unique<Stream>();
    stream->x = x;
    stream->y = -1;
    stream->isEraser = forceEraser;
    stream->tickInterval = forcedSpeed;
    stream->tickTimer = 0.0f;
    stream->len = grid.rows;
    stream->visibleLen = (stream->len * stream->tickInterval + 100.0f) * config.streamVisibleLengthScale;
    
    // Trail variance
    if (!forceEraser && config.trailLengthVarianceEnabled) {
        stream->maxDecay = static_cast<uint16_t>(config.decayFadeDurationFrames + Utils::RandomInt(0, config.trailLengthVariance));
    }

    lastStreamInColumn[x] = stream.get();
    if (forceEraser) lastEraserInColumn[x] = stream.get();
    
    activeStreams.push_back(std::move(stream));
    streamsPerColumn[x]++;
}

float StreamManager::GenerateSpeed(const Configuration& s) {
    float baseTick = static_cast<float>(std::max(1, 21 - s.streamSpeed));
    if (s.desyncIntensity > 0.0f) {
        float variance = baseTick * s.desyncIntensity * 0.8f;
        float offset = Utils::RandomFloat(-variance, variance);
        return std::max(1.0f, baseTick + offset);
    }
    return baseTick;
}

void StreamManager::WriteHead(Stream& stream, int frame) {
    int idx = grid.GetIndex(stream.x, stream.y);
    if (idx == -1) return;

    if (stream.isEraser) {
        HandleEraserHead(idx);
    } else {
        HandleTracerHead(stream, idx, frame);
    }
}

void StreamManager::HandleEraserHead(int idx) {
    if (grid.decays[idx] >= 2) return;

    if (grid.decays[idx] > 0 && (grid.types[idx] & CELL_TYPE_MASK) != static_cast<uint8_t>(CellType::EMPTY)) {
        grid.ages[idx] = 0;
        grid.decays[idx] = 2;
    } else {
        grid.ClearCell(idx);
    }
}

void StreamManager::HandleTracerHead(Stream& stream, int idx, int frame) {
    // Simplified tracer head (standard mode only)
    uint8_t cellType = static_cast<uint8_t>(CellType::TRACER);
    grid.types[idx] = cellType;
    grid.ages[idx] = 1;
    grid.decays[idx] = 1;
    grid.maxDecays[idx] = stream.maxDecay;
    grid.mix[idx] = 0.0f;
    grid.renderMode[idx] = RenderMode::STANDARD;
    grid.activeIndices.insert(idx);

    // Get random char
    std::string fallback = "0123456789Z:<=>\"*+-._!|";
    uint16_t charCode = static_cast<uint16_t>(fallback[Utils::RandomInt(0, fallback.length() - 1)]);

    uint32_t streamColor = config.streamPalette[0]; // Simplified to first color
    float b = config.variableBrightnessEnabled ? Utils::RandomFloat(dConfig.varianceMin, 1.0f) : 1.0f;
    grid.brightness[idx] = b;

    // Set Primary
    grid.chars[idx] = charCode;
    grid.colors[idx] = dConfig.tracerColorUint32;
    grid.alphas[idx] = b;
    grid.glows[idx] = config.tracerGlow;
    grid.baseColors[idx] = streamColor;
    grid.state[idx] = CellState::ACTIVE;
    grid.activeFlag[idx] = 1;
}

void StreamManager::HandleStreamCompletion(Stream& stream) {
    stream.active = false;
    // Auto-eraser logic (simplified)
    if (!stream.isEraser) {
        SpawnStreamAt(stream.x, true, stream.tickInterval);
    }
}

} // namespace Matrix
