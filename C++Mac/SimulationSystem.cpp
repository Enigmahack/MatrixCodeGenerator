#include "SimulationSystem.hpp"
#include "Utils.hpp"
#include <algorithm>
#include <cmath>

namespace Matrix {

SimulationSystem::SimulationSystem(CellGrid& g, Configuration& c, DerivedConfig& d)
    : grid(g), config(c), dConfig(d), streamManager(g, c, d) {
    
    rotatorSpeedMap.assign(60, 1.0f);
    for (int i = 0; i < 60; ++i) {
        rotatorSpeedMap[i] = 0.5f + Utils::RandomFloat(0.0f, 2.5f);
    }
}

SimulationSystem::~SimulationSystem() = default;

void SimulationSystem::Update(int frame) {
    if (config.simulationPaused) return;

    if (timeScale > 0.0f) {
        streamManager.Update(frame, timeScale);
        UpdateCells(frame, timeScale);
    } else if (timeScale < 0.0f) {
        streamManager.Update(frame, timeScale);
    }
}

void SimulationSystem::UpdateCells(int frame, float ts) {
    // Slow motion probabilistic update
    if (ts < 1.0f && Utils::RandomFloat(0.0f, 1.0f) > ts) return;

    // Use a copy of activeIndices to avoid modification during iteration
    std::vector<int> currentActive(grid.activeIndices.begin(), grid.activeIndices.end());
    for (int idx : currentActive) {
        UpdateCell(idx, frame, config, dConfig);
    }
}

void SimulationSystem::UpdateCell(int idx, int frame, const Configuration& s, const DerivedConfig& d) {
    uint8_t decay = grid.decays[idx];
    if (decay == 0) return;

    // Increment age
    int age = grid.ages[idx];
    if (age > 0) {
        age++;
        grid.ages[idx] = age;
    }

    uint8_t type = grid.types[idx];
    uint8_t baseType = type & CELL_TYPE_MASK;
    
    // Tracer Color Fade
    if (decay < 2 && (baseType == static_cast<uint8_t>(CellType::TRACER) || baseType == static_cast<uint8_t>(CellType::ROTATOR))) {
        int attack = s.tracerAttackFrames;
        int hold = s.tracerHoldFrames;
        int release = s.tracerReleaseFrames;
        
        uint32_t tracerColor = d.tracerColorUint32;
        uint32_t baseColor = grid.baseColors[idx];
        float ratio = 0.0f;
        int activeAge = age - 1;

        if (activeAge > (attack + hold)) {
            if (release > 0) {
                ratio = std::min(1.0f, static_cast<float>(activeAge - (attack + hold)) / static_cast<float>(release));
            } else {
                ratio = 1.0f;
            }
        }

        if (ratio >= 1.0f) {
            grid.colors[idx] = baseColor;
            grid.glows[idx] = 0.0f;
        } else if (ratio > 0.0f) {
            Color t = Color::UnpackABGR(tracerColor);
            Color b = Color::UnpackABGR(baseColor);
            uint8_t mR = static_cast<uint8_t>(t.r + (b.r - t.r) * ratio);
            uint8_t mG = static_cast<uint8_t>(t.g + (b.g - t.g) * ratio);
            uint8_t mB = static_cast<uint8_t>(t.b + (b.b - t.b) * ratio);
            grid.colors[idx] = Color::PackABGR(mR, mG, mB);
            grid.glows[idx] = s.tracerGlow * (1.0f - ratio);
        } else {
            grid.colors[idx] = tracerColor;
            grid.glows[idx] = s.tracerGlow;
        }
    }

    // Rotator
    if (baseType == static_cast<uint8_t>(CellType::ROTATOR)) {
        HandleRotator(idx, frame, s, d);
    }

    // Decay / Alpha
    if (decay >= 2) {
        if (decay == 2) {
            grid.colors[idx] = grid.baseColors[idx];
            grid.glows[idx] = 0.0f;
        }
        
        grid.decays[idx]++;
        int newDecay = grid.decays[idx];
        int maxFade = (grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
        
        if (newDecay > (maxFade + 2)) {
            grid.ClearCell(idx);
            return;
        }
        
        grid.alphas[idx] = CalculateAlpha(idx, age, newDecay, maxFade);
    } else {
        int maxFade = (grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
        grid.alphas[idx] = CalculateAlpha(idx, age, decay, maxFade);
    }
}

void SimulationSystem::HandleRotator(int idx, int frame, const Configuration& s, const DerivedConfig& d) {
    float mix = grid.mix[idx];
    if (mix > 0.0f) {
        ProgressRotator(idx, mix, s.rotatorCrossfadeFrames);
    } else if (s.rotatorEnabled) {
        CycleRotator(idx, frame, s.rotatorCrossfadeFrames, 10, s); // Simplified cycle duration
    }
}

void SimulationSystem::ProgressRotator(int idx, float currentMix, int crossfadeFrames) {
    float step = 1.0f / static_cast<float>(std::max(1, crossfadeFrames));
    float newMix = currentMix + step;

    if (newMix >= 1.0f) {
        uint16_t targetCode = grid.nextChars[idx];
        if (targetCode > 0) {
            grid.chars[idx] = targetCode;
        }
        grid.mix[idx] = 0.0f;
        grid.nextChars[idx] = 0;
    } else {
        grid.mix[idx] = newMix;
    }
}

void SimulationSystem::CycleRotator(int idx, int frame, int crossfadeFrames, int cycleFrames, const Configuration& s) {
    if (frame % cycleFrames == 0) {
        uint16_t nextCode = GetUniqueChar(grid.chars[idx]);
        if (crossfadeFrames <= 1) {
            grid.chars[idx] = nextCode;
        } else {
            grid.mix[idx] = 0.01f;
            grid.nextChars[idx] = nextCode;
        }
    }
}

uint16_t SimulationSystem::GetUniqueChar(uint16_t exclude) {
    std::string fallback = "0123456789Z:<=>\"*+-._!|";
    uint16_t c;
    do {
        c = static_cast<uint16_t>(fallback[Utils::RandomInt(0, fallback.length() - 1)]);
    } while (c == exclude);
    return c;
}

float SimulationSystem::CalculateAlpha(int idx, int age, int decay, int fadeDurationFrames) {
    float maxA = config.maxAlpha;
    float b = grid.brightness[idx];

    if (decay >= 2) {
        float ratio = static_cast<float>(decay - 2) / static_cast<float>(fadeDurationFrames);
        float fade = std::pow(std::max(0.0f, 1.0f - ratio), 2.0f);
        return maxA * fade * b;
    }

    int attack = config.tracerAttackFrames;
    if (age <= attack && attack > 0) {
        return maxA * (static_cast<float>(age) / static_cast<float>(attack)) * b;
    }

    return maxA * b;
}

} // namespace Matrix
