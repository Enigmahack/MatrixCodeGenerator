#pragma once

#include "Types.hpp"
#include <vector>
#include <string>

namespace Matrix {

struct Configuration {
    // --- Global ---
    uint32_t backgroundColor = Color::PackABGR(0, 0, 0);
    std::vector<uint32_t> streamPalette = { Color::PackABGR(0, 255, 70) };
    float paletteBias = 0.5f;
    float colorMixType = 0.5f;
    float brightness = 1.0f;
    uint32_t tracerColor = Color::PackABGR(220, 255, 230);
    int fontSize = 20;
    int streamSpeed = 10;
    float resolution = 1.0f;
    float brightnessFloor = 0.05f;
    float glowIntensityMultiplier = 0.5f;
    float burnInBoost = 2.0f;
    float maxAlpha = 0.99f;
    float tracerGlow = 20.0f;
    float clearAlpha = 0.95f;

    // --- Appearance ---
    bool variableBrightnessEnabled = true;
    bool lockBrightnessToCharacters = false;
    float brightnessVariance = 0.5f;
    bool gradualColorStreams = false;
    float gradualColorStreamsFrequency = 0.2f;
    int tracerAttackFrames = 5;
    int tracerHoldFrames = 10;
    int tracerReleaseFrames = 20;

    // --- Behavior ---
    int releaseInterval = 4;
    float desyncIntensity = 0.5f;
    int minStreamGap = 5;
    int minEraserGap = 10;
    int minGapTypes = 5;
    int decayFadeDurationFrames = 60;
    bool trailLengthVarianceEnabled = true;
    int trailLengthVariance = 300;
    float streamVisibleLengthScale = 1.0f;
    bool allowTinyStreams = false;
    float holeRate = 0.05f;

    int streamSpawnCount = 8;
    int eraserSpawnCount = 2;
    float tracerStopChance = 0.02f;
    float eraserStopChance = 0.02f;

    // --- Rotators ---
    bool rotatorEnabled = true;
    float rotatorChance = 0.5f;
    bool rotatorSyncToTracer = false;
    float rotatorSyncMultiplier = 1.0f;
    int rotatorCycleFactor = 10;
    int rotatorCrossfadeFrames = 4;
    bool rotateDuringFade = true;
    bool rotatorDesyncEnabled = true;
    float rotatorDesyncVariance = 0.5f;
    bool rotatorRandomSpeedEnabled = true;

    // --- Post-Processing ---
    float crtAmount = 1.0f;
    float scanlineAmount = 0.5f;
    float barrelDistortion = 0.5f;
    float bloomIntensity = 1.0f;

    // --- Shadow World ---
    bool enableShadowWorld = true;
    float shadowWorldFadeSpeed = 0.5f;

    // --- Quantized Zoom ---
    float quantizedZoomDelay = 1.0f;
    float quantizedZoomZoomRate = 1.0f;
    float quantizedZoomErosionRate = 0.2f;
    int quantizedZoomInnerLineDuration = 1;

    // --- System / Internal ---
    bool simulationPaused = false;
    bool logErrors = true;
};

struct DerivedConfig {
    float cellWidth = 12.0f;
    float cellHeight = 20.0f;
    uint32_t tracerColorUint32 = 0xFFE6FFDC;
    float varianceMin = 0.1f;
    int maxState = 1000;
    // In C++, we'll need to handle fonts differently, but for now:
    std::string chars = "0123456789Z:<=>\"*+-._!|⽇゠ウエオカキクコサシスセソツテナニヌネハヒフホマミムメモヤラリワヲン";
};

} // namespace Matrix
