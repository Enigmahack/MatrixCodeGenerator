
class ConfigurationManager {
    constructor() {
        this.storageKey = 'matrix_config_v8.5';
        this.slotsKey = 'matrix_slots_v8.5';
        this.defaults = this._initializeDefaults();

        this.state = { ...this.defaults };
        this.derived = {};
        this.slots = this._loadSlots();
        this.subscribers = [];
        this._previousSmoothingEnabled = undefined;
        this._previousSmoothingAmount = undefined;

        // Define keys that are shared across all profiles (Global Settings)
        this.SHARED_KEYS = new Set([
            'showFpsCounter',
            'debugEnabled',
            'highlightErasers',
            'logErrors',
            'enableKeybinds',
            'keyBindings',
            'hideMenuIcon',
            'doubleClickToReset',
            'suppressToasts',
            'renderingEngine',
            // 'savedPresets' is handled by this.slots
        ]);

        // Keys that affect derived values (safe superset to ensure correctness)
        this._derivedKeys = new Set([
            'streamSpeed',
            'horizontalSpacingFactor',
            'verticalSpacingFactor',
            'rotatorSyncToTracer',
            'rotatorSyncMultiplier',
            'rotatorCycleFactor',
            'tracerAttackFrames',
            'tracerReleaseFrames',
            'tracerHoldFrames',
            'fontSize',
            'brightnessVariance',
            'backgroundColor',
            'streamColor',
            'tracerColor',
            'streamPalette',
            'fontFamily',
            'fontWeight',
            'italicEnabled',
            'fontSettings'
        ]);

        this._loadState();
        this.updateDerivedValues();
    }

    // ====================
    // Initialization Helpers
    // ====================

    /**
     * Initializes the default configuration settings.
     * @private
     * @returns {Object} An object containing all default configuration properties.
     */
        _initializeDefaults() {
        return {
            "streamColor": "#65d778",
            "backgroundColor": "#020509",
            "streamPalette": ["#00e004", "#75ff1a"],
            "paletteBias": 0,
            "colorMixType": 0,
            "tracerColor": "#d7ffd7",
            "fontSize": 22,
            "streamSpeed": 17,
            "releaseInterval": 2,
            "resolution": 1,
            "enableGlyphAtlas": true,
            "smoothingEnabled": false,
            "smoothingAmount": 0.1,
            "showFpsCounter": false,
            "performanceMode": false,
            "debugTabEnabled": false,
            "debugEnabled": false,
            "highlightErasers": false,
            "simulationPaused": false,
            "logErrors": false,
            "fontFamily": "CustomFont_5e2697679380fc43",
            "fontWeight": "normal",
            "italicEnabled": false,
            "mirrorEnabled": false,
            "variableBrightnessEnabled": true,
            "brightnessVariance": 15,
            "overlapEnabled": false,
            "overlapColor": "#fff5b8",
            "overlapDensity": 0.3,
            "overlapTarget": "stream",
            "overlapShimmer": false,
            "dissolveEnabled": true,
            "dissolveScalePercent": -2,
            "deteriorationEnabled": true,
            "deteriorationStrength": 4,
            "enableBloom": true,
            "bloomStrength": 1,
            "bloomOpacity": 0.6,
            "tracerGlow": 6,
            "clearAlpha": 1,
            "horizontalSpacingFactor": 0.95,
            "verticalSpacingFactor": 0.95,
            "fontOffsetX": 0,
            "fontOffsetY": 0,
            "stretchX": 1,
            "stretchY": 1,
            "decayFadeDurationFrames": 25,
            "trailLengthVarianceEnabled": true,
            "trailLengthVariance": 151,
            "streamSpawnCount": 3,
            "eraserSpawnCount": 2,
            "minStreamGap": 2,
            "minEraserGap": 2,
            "minGapTypes": 30,
            "allowTinyStreams": true,
            "gradualColorStreams": true,
            "gradualColorStreamsFrequency": 60,
            "holeRate": 0,
            "desyncIntensity": 0.35,
            "preferClusters": true,
            "eraserStopChance": 0,
            "tracerStopChance": 0,
            "tracerAttackFrames": 4,
            "tracerHoldFrames": 0,
            "tracerReleaseFrames": 4,
            "invertedTracerEnabled": false,
            "invertedTracerChance": 0.1,
            "upwardTracerEnabled": false,
            "upwardTracerChance": 0.81,
            "upwardTracerAttackFrames": 2,
            "upwardTracerHoldFrames": 4,
            "upwardTracerReleaseFrames": 30,
            "upwardTracerGlow": 8,
            "upwardTracerSpeedMult": 1.3,
            "upwardTracerGlimmerSpeed": 3.15,
            "upwardTracerGlimmerSize": 5,
            "upwardTracerGlimmerFill": 5,
            "upwardTracerGlimmerGlow": 6,
            "upwardTracerGlimmerFlicker": 0.45,
            "rotatorEnabled": true,
            "rotatorChance": 1,
            "rotatorSyncToTracer": false,
            "rotatorSyncMultiplier": 0.3,
            "rotatorCycleFactor": 16,
            "rotatorCrossfadeFrames": 4,
            "rotateDuringFade": true,
            "rotatorDesyncEnabled": true,
            "rotatorDesyncVariance": 41,
            "shaderEnabled": false,
            "customShader": null,
            "effectShader": null,
            "shaderParameter": 0.03,
            "effectParameter": 0,
            "pulseEnabled": false,
            "pulseUseTracerGlow": true,
            "pulseMovieAccurate": false,
            "pulseFrequencySeconds": 300,
            "pulseDelaySeconds": 0.7,
            "pulseDurationSeconds": 1.2,
            "pulsePreserveSpaces": true,
            "pulseIgnoreTracers": true,
            "pulseDimming": 0.2,
            "pulseBlend": false,
            "pulseWidth": 130,
            "pulseRandomPosition": true,
            "pulseInstantStart": false,
            "pulseCircular": false,
            "clearPulseEnabled": false,
            "clearPulseMovieAccurate": true,
            "clearPulseUseTracerGlow": true,
            "clearPulseFrequencySeconds": 235,
            "clearPulseDurationSeconds": 0.7,
            "clearPulsePreserveSpaces": true,
            "clearPulseBlend": false,
            "clearPulseWidth": 190,
            "clearPulseRandomPosition": true,
            "clearPulseInstantStart": false,
            "clearPulseCircular": false,
            "miniPulseEnabled": false,
            "miniPulseUseTracerGlow": true,
            "miniPulseFrequencySeconds": 450,
            "miniPulseDurationSeconds": 5,
            "miniPulsePreserveSpaces": true,
            "miniPulseThickness": 100,
            "miniPulseSpawnChance": 0.06,
            "miniPulseSpeed": 16,
            "miniPulseSize": 360,
            "quantizedPulseEnabled": false,
            "quantizedPulseFrequencySeconds": 300,
            "quantizedPulseDurationSeconds": 10,
            "quantizedPulseSpeed": 5,
            "quantizedBlockWidthCells": 3,
            "quantizedBlockHeightCells": 3,
            "quantizedPulseBorderIllumination": 1.1,
            "quantizedPulsePerimeterThickness": 0.6,
            "quantizedPulseInnerThickness": 0.6,
            "quantizedPulsePerimeterColor": "#eeff00",
            "quantizedPulseInnerColor": "#0cd709",
            "quantizedPulseInnerFadeFrames": 0,
            "quantizedPulseFadeInFrames": 0,
            "quantizedPulseFadeFrames": 0,
            "quantizedAddEnabled": false,
            "quantizedAddFrequencySeconds": 280,
            "quantizedAddDurationSeconds": 3.7,
            "quantizedAddBorderIllumination": 5.6,
            "quantizedAddSpeed": 5,
            "quantizedAddBlockWidthCells": 3,
            "quantizedAddBlockHeightCells": 3,
            "quantizedAddPerimeterThickness": 0.7,
            "quantizedAddInnerThickness": 0.7,
            "quantizedAddPerimeterColor": "#d4ff00",
            "quantizedAddInnerColor": "#000000",
            "quantizedAddInnerFadeFrames": 0,
            "quantizedAddFadeInFrames": 0,
            "quantizedAddFadeFrames": 0,
            "quantizedRetractEnabled": false,
            "quantizedRetractFrequencySeconds": 250,
            "quantizedRetractDurationSeconds": 5,
            "quantizedRetractSpeed": 4.3,
            "quantizedRetractBlockWidthCells": 4,
            "quantizedRetractBlockHeightCells": 4,
            "quantizedRetractFadeInFrames": 0,
            "quantizedRetractFadeFrames": 0,
            "quantizedRetractBorderIllumination": 5.7,
            "quantizedRetractPerimeterThickness": 0.6,
            "quantizedRetractInnerThickness": 0.6,
            "quantizedRetractPerimeterColor": "#FFD700",
            "quantizedRetractInnerColor": "#0011ff",
            "quantizedRetractInnerFadeFrames": 0,
            "quantizedClimbEnabled": false,
            "quantizedClimbFrequencySeconds": 265,
            "quantizedClimbDurationSeconds": 3.6,
            "quantizedClimbSpeed": 5,
            "quantizedClimbBlockWidthCells": 3,
            "quantizedClimbBlockHeightCells": 3,
            "quantizedClimbFadeInFrames": 0,
            "quantizedClimbFadeFrames": 0,
            "quantizedClimbBorderIllumination": 5.4,
            "quantizedClimbPerimeterThickness": 0.5,
            "quantizedClimbInnerThickness": 0.5,
            "quantizedClimbPerimeterColor": "#e1ff00",
            "quantizedClimbInnerColor": "#027a00",
            "quantizedClimbInnerFadeFrames": 0,
            "quantizedZoomEnabled": false,
            "quantizedZoomFrequencySeconds": 60,
            "quantizedZoomDurationSeconds": 5,
            "quantizedZoomSpeed": 1,
            "quantizedZoomExpansionRate": 1,
            "quantizedZoomZoomRate": 1,
            "quantizedZoomDelay": 0,
            "quantizedZoomHoldSeconds": 2,
            "quantizedZoomFadeInFrames": 60,
            "quantizedZoomFadeFrames": 15,
            "quantizedZoomBorderIllumination": 4,
            "quantizedZoomPerimeterThickness": 1,
            "quantizedZoomInnerThickness": 1,
            "quantizedZoomPerimeterColor": "#FFD700",
            "quantizedZoomInnerColor": "#FFD700",
            "quantizedZoomInnerFadeFrames": 0,
            "quantizedGenerateEnabled": false,
            "quantizedGenerateFrequencySeconds": 240,
            "quantizedGenerateDurationSeconds": 7.6,
            "quantizedGenerateSpeed": 1,
            "quantizedGenerateBlockWidthCells": 4,
            "quantizedGenerateBlockHeightCells": 4,
            "quantizedGenerateBorderIllumination": 4,
            "quantizedGeneratePerimeterThickness": 1,
            "quantizedGenerateInnerThickness": 1,
            "quantizedGeneratePerimeterColor": "#FFD700",
            "quantizedGenerateInnerColor": "#FFD700",
            "quantizedGenerateInnerFadeFrames": 0,
            "quantizedGenerateFadeInFrames": 0,
            "quantizedGenerateFadeFrames": 0,
            "quantizedGenerateSimultaneousSpawns": 3,
            "quantizedGenerateErosionRate": 0.2,
            "quantizedGenerateInnerLineDuration": 1,
            "quantizedGenerateGreenFadeSeconds": 0.1,
            "quantizedGenerateMergeDelay": true,
            "quantizedGenerateV2Enabled": false,
            "quantizedGenerateV2FrequencySeconds": 240,
            "quantizedGenerateV2DurationSeconds": 7.6,
            "quantizedGenerateV2Speed": 1,
            "quantizedGenerateV2BlockWidthCells": 4,
            "quantizedGenerateV2BlockHeightCells": 4,
            "quantizedGenerateV2BorderIllumination": 4,
            "quantizedGenerateV2PerimeterThickness": 1,
            "quantizedGenerateV2InnerThickness": 1,
            "quantizedGenerateV2PerimeterColor": "#FFD700",
            "quantizedGenerateV2InnerColor": "#FFD700",
            "quantizedGenerateV2InnerFadeFrames": 0,
            "quantizedGenerateV2FadeInFrames": 0,
            "quantizedGenerateV2FadeFrames": 0,
            "quantizedGenerateV2SimultaneousSpawns": 3,
            "quantizedGenerateV2InnerLineDuration": 1,
            "quantizedGenerateV2GreenFadeSeconds": 0.1,
            "quantizedGenerateV2MergeDelay": true,
            "quantizedPulseCleanInnerDistance": 4,
            "quantizedAddCleanInnerDistance": 4,
            "quantizedRetractCleanInnerDistance": 4,
            "quantizedClimbCleanInnerDistance": 4,
            "quantizedZoomCleanInnerDistance": 4,
            "quantizedGenerateCleanInnerDistance": 4,
            "quantizedGenerateV2CleanInnerDistance": 4,
            "quantizedPerimeterOffsetX": 0,
            "quantizedPerimeterOffsetY": 0,
            "quantizedShadowOffsetX": 0,
            "quantizedShadowOffsetY": 0,
            "quantizedSourceGridOffsetX": 0,
            "quantizedSourceGridOffsetY": 0,
            "quantizedEditorGridOffsetX": 0,
            "quantizedEditorGridOffsetY": 0,
            "quantizedEditorChangesOffsetX": 0,
            "quantizedEditorChangesOffsetY": 0,
            "quantizedLineLength": 1,
            "quantizedLineOffset": 0,
            "quantizedOffsetProfiles": {},
            "quantizedAutoAlign": true,
            "layerEnableBackground": true,
            "layerEnablePrimaryCode": true,
            "layerEnableShadowWorld": true,
            "layerEnableQuantizedLines": true,
            "layerEnableQuantizedGridCache": false,
            "layerEnableEditorGrid": true,
            "layerEnableEditorOverlay": true,
            "quantizedSolidPerimeter": false,
            "dejaVuEnabled": false,
            "dejaVuFrequencySeconds": 350,
            "dejaVuDurationSeconds": 5,
            "dejaVuMinRectHeight": 1,
            "dejaVuMaxRectHeight": 10,
            "dejaVuHoleBrightness": 0.02,
            "dejaVuRandomizeColors": false,
            "dejaVuIntensity": 0.1,
            "dejaVuBarDurationFrames": 28,
            "dejaVuVarianceFrames": 43,
            "supermanEnabled": false,
            "supermanFrequencySeconds": 290,
            "supermanDurationSeconds": 6,
            "supermanFadeSpeed": 6,
            "supermanGlow": 4,
            "supermanBoltThickness": 5,
            "supermanFlickerRate": 2,
            "supermanWidth": 4,
            "supermanSpawnSpeed": 69,
            "starPowerEnabled": false,
            "starPowerFreq": 100,
            "starPowerRainbowMode": "char",
            "starPowerSaturation": 100,
            "starPowerIntensity": 51,
            "starPowerColorCycle": true,
            "starPowerCycleSpeed": 5,
            "rainbowStreamEnabled": false,
            "rainbowStreamChance": 0.5,
            "rainbowStreamIntensity": 50,
            "bootSequenceEnabled": false,
            "crashEnabled": false,
            "crashFrequencySeconds": 600,
            "crashDurationSeconds": 30,
            "crashSheetCount": 25,
            "crashSheetSpeed": 1,
            "crashSheetOpacity": 0.5,
            "crashStationaryChance": 20,
            "crashFlashDelayMin": 3,
            "crashFlashDelayMax": 6,
            "crashEnableSmith": true,
            "crashEnableSuperman": true,
            "crashEnableFlash": true,
            "runBothInOrder": false,
            "enableKeybinds": true,
            "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "v", "BootCrashSequence": "b", "QuantizedPulse": "q", "QuantizedAdd": "a", "QuantizedRetract": "z", "QuantizedClimb": "c"},
            "hideMenuIcon": true,
            "doubleClickToReset": true,
            "fontSettings": {"MatrixEmbedded": {"active": false, "useCustomChars": false, "customCharacters": "!\"*+-.012345789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi|"}, "CustomFont_5e2697679380fc43": {"active": true, "useCustomChars": true, "customCharacters": "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", "useAllChars": false}},
            "deteriorationType": "ghost",
            "tracerSizeIncrease": 1,
            "supermanProb": 4,
            "dejaVuAutoMode": true,
            "clearPulseIgnoreTracers": true,
            "dejaVuPerformanceMode": false,
            "pulseDelayFrames": 60,
            "suppressToasts": false,
            "supermanIncludeColors": true,
            "renderingEngine": "canvas",
            "dissolveMinSize": 18,
            "crashMovieFps": true,
            "quantizedPulseSimultaneousSpawns": 1,
            "quantizedPulseGreenFadeSeconds": 0,
            "quantizedAddGreenFadeSeconds": 0.5,
            "quantizedRetractGreenFadeSeconds": 0.5,
            "starPowerGlitter": false,
            "firewallEnabled": false,
            "firewallFrequencySeconds": 150,
            "firewallRandomColorEnabled": true,
            "firewallColor": "#00ff00",
            "firewallReverseDurationFrames": 20,
            "firewallEraseDurationFrames": 50,
            "ttlMinSeconds": 1,
            "ttlMaxSeconds": 8,
            "renderMode3D": false,
            "flySpeed": 15,
            "performanceBackup": null,
            "quantizedPulseShowInterior": true,
            "quantizedPulseBorderColor": "#FFCC00",
            "quantizedPulseInteriorColor": "#0fe628",
            "quantizedAddShowInterior": true,
            "quantizedAddBorderColor": "#002aff",
            "quantizedAddInteriorColor": "#ff0000",
            "quantizedRetractShowInterior": true,
            "quantizedRetractBorderColor": "#FFCC00",
            "quantizedRetractInteriorColor": "#FFCC00",
            "quantizedExpansionEnabled": false,
            "quantizedExpansionFrequencySeconds": 120,
            "quantizedExpansionDurationSeconds": 3,
            "quantizedExpansionFadeInFrames": 10,
            "quantizedExpansionFadeFrames": 20,
            "quantizedExpansionBorderIllumination": 4,
            "quantizedExpansionShowInterior": true,
            "quantizedExpansionBorderColor": "#FFCC00",
            "quantizedExpansionInteriorColor": "#001eff",
            "quantizedBlockGridWidth": 10,
            "quantizedBlockGridHeight": 10,
            "upwardTracerGlimmerChance": 0,
            "quantEditorEnabled": false,
            "streamVisibleLengthScale": 1.2
        };
    }

    /**
     * Computes auto-alignment offsets based on block size.
     * @private
     */
    _computeAutoOffsets(N) {
        // Algorithm derived from calibration data:
        // 1x1, 2x2, 3x3, 4x4
        
        // 1. Line Length: 1->1.08, 4->1.02
        const lineLen = 1.10 - (0.02 * N);

        // 2. Line Offset: 1->0, 2->0.24, 3->0.66, 4->1.10
        let lineOff = 0;
        if (N > 1) {
            lineOff = 0.24 + 0.43 * (N - 2);
        }

        // 3. Perimeter Offset Y: 1->26, 2->22, 3->14, 4->8. Formula: 32 - 6N.
        const perimY = 32 - (6 * N);
        
        // 4. Perimeter Offset X: Odd->(32-6N), Even->(12-7(N-2))
        let perimX = 0;
        if (N % 2 !== 0) {
            perimX = 32 - (6 * N);
        } else {
            perimX = 12 - (7 * (N - 2));
        }

        // 5. Source Grid
        // 1x1: -26, -26
        // Even: 8, 18
        // Odd > 1: 8, 8
        let srcX = 8;
        let srcY = 8;
        if (N === 1) {
            srcX = -26;
            srcY = -26;
        } else if (N % 2 === 0) {
            srcX = 8;
            srcY = 18;
        }
        
        return {
            'quantizedLineLength': parseFloat(lineLen.toFixed(2)),
            'quantizedLineOffset': parseFloat(lineOff.toFixed(2)),
            'quantizedPerimeterOffsetX': perimX,
            'quantizedPerimeterOffsetY': perimY,
            'quantizedEditorChangesOffsetX': -perimX,
            'quantizedEditorChangesOffsetY': -perimY,
            'quantizedEditorGridOffsetX': -perimX,
            'quantizedEditorGridOffsetY': -perimY,
            'quantizedSourceGridOffsetX': srcX,
            'quantizedSourceGridOffsetY': srcY,
            'quantizedShadowOffsetX': 0,
            'quantizedShadowOffsetY': 0
        };
    }

    /**
     * Deep clone utility to minimize allocations and handle future structuredClone availability.
     * @private
     */
    _deepClone(obj) {
        if (typeof structuredClone === 'function') {
            return structuredClone(obj);
        }
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Loads configuration slots from local storage.
     * @private
     * @returns {Array<Object>} An array of slot data.
     */
    _loadSlots() {
        let loadedSlots = [];
        try {
            const storedSlots = localStorage.getItem(this.slotsKey);
            if (storedSlots) {
                loadedSlots = JSON.parse(storedSlots);
            }
        } catch (e) {
            console.warn('Failed to load slots:', e);
        }

        const defaults = [
            {
                name: "Trilogy",
                data: {
                    "streamColor": "#65d778",
                    "backgroundColor": "#000000",
                    "streamPalette": ["#00ff41"],
                    "paletteBias": 0,
                    "colorMixType": 0.45,
                    "tracerColor": "#ccffcc",
                    "fontSize": 24,
                    "streamSpeed": 17,
                    "releaseInterval": 3,
                    "resolution": 0.9,
                    "enableGlyphAtlas": true,
                    "smoothingEnabled": false,
                    "smoothingAmount": 0.1,
                    "showFpsCounter": false,
                    "debugEnabled": false,
                    "highlightErasers": false,
                    "logErrors": false,
                    "fontFamily": "MatrixEmbedded",
                    "fontWeight": "normal",
                    "italicEnabled": false,
                    "mirrorEnabled": false,
                    "variableBrightnessEnabled": true,
                    "brightnessVariance": 15,
                    "overlapEnabled": false,
                    "overlapColor": "#20cb53",
                    "overlapDensity": 0.2,
                    "overlapTarget": "stream",
                    "overlapShimmer": false,
                    "dissolveEnabled": true,
                    "dissolveScalePercent": -15,
                    "deteriorationEnabled": true,
                    "deteriorationStrength": 6,
                    "enableBloom": true,
                    "bloomStrength": 1,
                    "bloomOpacity": 0.5,
                    "tracerGlow": 5,
                    "clearAlpha": 0.72,
                    "horizontalSpacingFactor": 0.7,
                    "verticalSpacingFactor": 1,
                    "fontOffsetX": 0,
                    "fontOffsetY": 0,
                    "stretchX": 1,
                    "stretchY": 1.1,
                    "decayFadeDurationFrames": 15,
                    "trailLengthVarianceEnabled": false,
                    "trailLengthVariance": 60,
                    "streamSpawnCount": 7,
                    "eraserSpawnCount": 5,
                    "minStreamGap": 2,
                    "minEraserGap": 15,
                    "minGapTypes": 20,
                    "allowTinyStreams": true,
                    "gradualColorStreams": false,
                    "gradualColorStreamsFrequency": 100,
                    "holeRate": 0.1,
                    "desyncIntensity": 0,
                    "preferClusters": true,
                    "eraserStopChance": 1,
                    "tracerStopChance": 1,
                    "tracerAttackFrames": 4,
                    "tracerHoldFrames": 0,
                    "tracerReleaseFrames": 4,
                    "invertedTracerEnabled": true,
                    "invertedTracerChance": 0.07,
                    "upwardTracerEnabled": false,
                    "upwardTracerChance": 0.02,
                    "upwardTracerAttackFrames": 2,
                    "upwardTracerHoldFrames": 30,
                    "upwardTracerReleaseFrames": 30,
                    "upwardTracerGlow": 8,
                    "upwardTracerSpeedMult": 1,
                    "upwardTracerGlimmerSpeed": 2,
                    "upwardTracerGlimmerSize": 3,
                    "upwardTracerGlimmerFill": 3,
                    "upwardTracerGlimmerGlow": 10,
                    "upwardTracerGlimmerFlicker": 0.5,
                    "rotatorEnabled": true,
                    "rotatorChance": 0.25,
                    "rotatorSyncToTracer": true,
                    "rotatorSyncMultiplier": 0.4,
                    "rotatorCycleFactor": 20,
                    "rotatorCrossfadeFrames": 6,
                    "rotateDuringFade": false,
                    "rotatorDesyncEnabled": false,
                    "rotatorDesyncVariance": 0,
                    "shaderEnabled": true,
                    "customShader": `// Name: Matrix Real-World Blue Hue
precision highp float;                    // highp for desktop; switch to mediump for mobile if needed

uniform sampler2D uTexture;
uniform vec2      uResolution;            // (width, height)
uniform float     uTime;                  // seconds
uniform vec2      uMouse;                 // normalized [0..1]
uniform float     uParameter;             // UI slider [0..1]

varying vec2      vTexCoord;

vec3 rgb2hsv(vec3 c){
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.x, p.y, p.w, c.r), vec4(c.r, p.y, p.z, p.x), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 rgb = texture2D(uTexture, vTexCoord).rgb;
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = mix(hsv.x, 0.55, uParameter * 0.25);    // Hue change                                       
    hsv.y = mix(hsv.y, 0.0, uParameter * 0.25);            // Saturation change
    vec3 outc = hsv2rgb(hsv);
    gl_FragColor = vec4(outc, 1.0);
}`,
                    "effectShader": null,
                    "shaderParameter": 0.69,
                    "effectParameter": 2.8,
                    "pulseEnabled": true,
                    "pulseUseTracerGlow": false,
                    "pulseMovieAccurate": true,
                    "pulseFrequencySeconds": 300,
                    "pulseDelaySeconds": 0.7,
                    "pulseDurationSeconds": 1.2,
                    "pulsePreserveSpaces": true,
                    "pulseIgnoreTracers": true,
                    "pulseDimming": 0.2,
                    "pulseBlend": false,
                    "pulseWidth": 130,
                    "pulseRandomPosition": true,
                    "pulseInstantStart": false,
                    "pulseCircular": false,
                    "clearPulseEnabled": true,
                    "clearPulseMovieAccurate": true,
                    "clearPulseUseTracerGlow": true,
                    "clearPulseFrequencySeconds": 235,
                    "clearPulseDurationSeconds": 1.1,
                    "clearPulsePreserveSpaces": true,
                    "clearPulseBlend": true,
                    "clearPulseWidth": 130,
                    "clearPulseRandomPosition": true,
                    "clearPulseInstantStart": false,
                    "clearPulseCircular": false,
                    "miniPulseEnabled": true,
                    "miniPulseUseTracerGlow": true,
                    "miniPulseFrequencySeconds": 450,
                    "miniPulseDurationSeconds": 5,
                    "miniPulsePreserveSpaces": true,
                    "miniPulseThickness": 100,
                    "miniPulseSpawnChance": 0.06,
                    "miniPulseSpeed": 16,
                    "miniPulseSize": 360,
                    "quantizedPulseEnabled": false,
                    "quantizedPulseFrequencySeconds": 240,
                    "quantizedPulseDurationSeconds": 7.6,
                    "quantizedPulseSpeed": 1,
                    "quantizedBlockWidthCells": 4,
                    "quantizedBlockHeightCells": 4,
                    "quantizedPulseBorderIllumination": 4,
                    "quantizedPulsePerimeterThickness": 1.0,
                    "quantizedPulseFadeInFrames": 0,
                    "quantizedPulseFadeFrames": 0,
                    "quantizedAddEnabled": false,
                    "quantizedAddFrequencySeconds": 300,
                    "quantizedAddDurationSeconds": 10,
                    "quantizedAddBorderIllumination": 4,
            "quantizedAddSpeed": 1,
            "quantizedAddPerimeterThickness": 1.0,
                    "quantizedAddFadeInFrames": 0,
                    "quantizedAddFadeFrames": 0,
                    "quantizedRetractEnabled": false,
                    "quantizedRetractFrequencySeconds": 60,
                    "quantizedRetractDurationSeconds": 2,
                    "quantizedRetractFadeInFrames": 5,
                    "quantizedRetractFadeFrames": 15,
                    "quantizedRetractBorderIllumination": 4,
                    "quantizedGenerateEnabled": false,
                    "quantizedGenerateFrequencySeconds": 240,
                    "quantizedGenerateDurationSeconds": 7.6,
                    "quantizedGenerateSpeed": 1,
                    "quantizedGenerateBlockWidthCells": 4,
                    "quantizedGenerateBlockHeightCells": 4,
                    "quantizedGenerateBorderIllumination": 4,
                    "quantizedGeneratePerimeterThickness": 1.0,
                    "quantizedGeneratePerimeterColor": "#FFD700",
                    "quantizedGenerateInnerColor": "#FFD700",
                    "quantizedGenerateFadeInFrames": 0,
                    "quantizedGenerateFadeFrames": 0,
                    "quantizedGenerateSimultaneousSpawns": 3,
                    "quantizedGenerateGreenFadeSeconds": 0.1,
                    "dejaVuEnabled": true,
                    "dejaVuFrequencySeconds": 350,
                    "dejaVuDurationSeconds": 5,
                    "dejaVuMinRectHeight": 1,
                    "dejaVuMaxRectHeight": 10,
                    "dejaVuHoleBrightness": 0.02,
                    "dejaVuRandomizeColors": false,
                    "dejaVuIntensity": 0.07,
                    "dejaVuBarDurationFrames": 21,
                    "dejaVuVarianceFrames": 43,
                    "supermanEnabled": true,
                    "supermanFrequencySeconds": 290,
                    "supermanDurationSeconds": 6,
                    "supermanFadeSpeed": 6,
                    "supermanGlow": 2,
                    "supermanBoltThickness": 5,
                    "supermanFlickerRate": 3,
                    "supermanWidth": 3,
                    "supermanSpawnSpeed": 69,
                    "starPowerEnabled": false,
                    "starPowerFreq": 100,
                    "starPowerRainbowMode": "char",
                    "starPowerSaturation": 100,
                    "starPowerIntensity": 51,
                    "starPowerColorCycle": true,
                    "starPowerCycleSpeed": 3,
                    "rainbowStreamEnabled": false,
                    "rainbowStreamChance": 0.5,
                    "rainbowStreamIntensity": 50,
                    "bootSequenceEnabled": false,
                    "crashEnabled": false,
                    "crashFrequencySeconds": 600,
                    "crashDurationSeconds": 30,
                    "crashSheetCount": 33,
                    "crashSheetSpeed": 1.1,
                    "crashSheetOpacity": 0.96,
                    "crashStationaryChance": 17,
                    "crashFlashDelayMin": 3,
                    "crashFlashDelayMax": 6,
                    "crashEnableSmith": true,
                    "crashEnableSuperman": true,
                    "crashEnableFlash": true,
                    "runBothInOrder": true,
                    "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "x", "BootCrashSequence": "c", "ReverseTime": "u"},
                    "hideMenuIcon": true,
                    "fontSettings": {"MatrixEmbedded": {"active": true, "useCustomChars": false, "customCharacters": ""}, "CustomFont_5e2697679380fc43": {"active": false, "useCustomChars": true, "customCharacters": "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5", "useAllChars": false}},
                    "deteriorationType": "ghost",
                    "tracerSizeIncrease": 1,
                    "supermanProb": 4,
                    "dejaVuAutoMode": true,
                    "clearPulseIgnoreTracers": true,
                    "dejaVuPerformanceMode": false,
                    "pulseDelayFrames": 60,
                    "suppressToasts": false,
                    "supermanIncludeColors": true,
                    "renderingEngine": "canvas",
                    "dissolveMinSize": 19,
                    "crashMovieFps": true,
                    "quantizedPulseSimultaneousSpawns": 3,
                    "quantizedPulseGreenFadeSeconds": 0.1,
                    "quantizedAddGreenFadeSeconds": 0.5,
                    "quantizedRetractGreenFadeSeconds": 0.5,
                    "starPowerGlitter": false,
                    "firewallEnabled": false,
                    "firewallFrequencySeconds": 150,
                    "firewallRandomColorEnabled": true,
                    "firewallColor": "#00ff00",
                    "firewallReverseDurationFrames": 20,
                    "firewallEraseDurationFrames": 50,
                    "ttlMinSeconds": 1,
                    "ttlMaxSeconds": 8,
                    "renderMode3D": false,
                    "flySpeed": 15
                }
            },
            {
                name: "Neo Code",
                data: {
                    "streamColor": "#65d778",
                    "backgroundColor": "#000500",
                    "streamPalette": ["#00cc4e"],
                    "paletteBias": 0.5,
                    "colorMixType": 0.65,
                    "tracerColor": "#90e88d",
                    "fontSize": 28,
                    "streamSpeed": 16,
                    "releaseInterval": 1,
                    "resolution": 1,
                    "enableGlyphAtlas": true,
                    "smoothingEnabled": false,
                    "smoothingAmount": 0.1,
                    "showFpsCounter": true,
                    "debugEnabled": false,
                    "highlightErasers": false,
                    "logErrors": true,
                    "fontFamily": "CustomFont_5e2697679380fc43",
                    "fontWeight": "normal",
                    "italicEnabled": false,
                    "mirrorEnabled": false,
                    "variableBrightnessEnabled": true,
                    "brightnessVariance": 20,
                    "overlapEnabled": false,
                    "overlapColor": "#fff5b8",
                    "overlapDensity": 0.3,
                    "overlapTarget": "stream",
                    "overlapShimmer": false,
                    "dissolveEnabled": true,
                    "dissolveScalePercent": 13,
                    "deteriorationEnabled": true,
                    "deteriorationStrength": 4,
                    "enableBloom": true,
                    "bloomStrength": 2,
                    "bloomOpacity": 0.15,
                    "tracerGlow": 3,
                    "clearAlpha": 1,
                    "horizontalSpacingFactor": 1,
                    "verticalSpacingFactor": 0.95,
                    "fontOffsetX": 0,
                    "fontOffsetY": 0,
                    "stretchX": 0.8,
                    "stretchY": 1,
                    "decayFadeDurationFrames": 20,
                    "trailLengthVarianceEnabled": true,
                    "trailLengthVariance": 135,
                    "streamSpawnCount": 1,
                    "eraserSpawnCount": 3,
                    "minStreamGap": 6,
                    "minEraserGap": 6,
                    "allowTinyStreams": true,
                    "gradualColorStreams": true,
                    "gradualColorStreamsFrequency": 100,
                    "holeRate": 0,
                    "desyncIntensity": 0.45,
                    "preferClusters": false,
                    "eraserStopChance": 0,
                    "tracerStopChance": 0,
                    "tracerAttackFrames": 2,
                    "tracerHoldFrames": 4,
                    "tracerReleaseFrames": 0,
                    "invertedTracerEnabled": false,
                    "invertedTracerChance": 0.1,
                    "upwardTracerEnabled": false,
                    "upwardTracerChance": 0.67,
                    "upwardTracerAttackFrames": 2,
                    "upwardTracerHoldFrames": 4,
                    "upwardTracerReleaseFrames": 20,
                    "upwardTracerGlow": 8,
                    "upwardTracerSpeedMult": 1.2,
                    "upwardTracerGlimmerSpeed": 4.31,
                    "upwardTracerGlimmerSize": 5,
                    "upwardTracerGlimmerFill": 5,
                    "upwardTracerGlimmerGlow": 0,
                    "upwardTracerGlimmerFlicker": 0.5,
                    "rotatorEnabled": true,
                    "rotatorChance": 1,
                    "rotatorSyncToTracer": false,
                    "rotatorSyncMultiplier": 0.3,
                    "rotatorCycleFactor": 16,
                    "rotatorCrossfadeFrames": 2,
                    "rotateDuringFade": true,
                    "rotatorDesyncEnabled": true,
                    "rotatorDesyncVariance": 41,
                    "shaderEnabled": true,
                    "customShader": `// Name: Static Grain
precision mediump float;

// Inputs provided by the application
uniform sampler2D uTexture;
uniform float uParameter;

// uniform float uTime; // NOT needed for static grain
varying vec2 vTexCoord;

// Shader Configuration
const float GRAIN_AMOUNT = 0.05; // Increase this value (0.0 to 1.0) to make the grain more noticeable

// 1. Random function
// Generates a seemingly random float based on the input coordinate 'st'.
float random(vec2 st) {
    // This uses a "magic" dot product and large number to generate noise.
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // 2. Sample the original texture
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // 3. Calculate static noise
    // The key here is to pass only the coordinate (vTexCoord) to the random function.
    // We are NOT using 'uTime', so the result for any given coordinate is always the same.
    float noiseValue = random(vTexCoord);
    
    // Map the random value from [0.0, 1.0] to a useful noise range, e.g., [-1.0, 1.0]
    // (noiseValue - 0.5) shifts the range to [-0.5, 0.5]
    // * 2.0 expands the range to [-1.0, 1.0]
    float finalNoise = (noiseValue - 0.5) * 2.0;

    // 4. Apply grain to the color
    // We only apply the noise to the Red, Green, and Blue channels (.rgb).
    // The noise value is scaled by the GRAIN_AMOUNT.
    // A negative noise makes the pixel darker, a positive noise makes it brighter.
    color.rgb += finalNoise * (uParameter * 0.5);
    
    // 5. Output final color
    gl_FragColor = color;
}`,
                    "effectShader": null,
                    "shaderParameter": 0.07,
                    "effectParameter": 0,
                    "pulseEnabled": false,
                    "pulseUseTracerGlow": true,
                    "pulseMovieAccurate": false,
                    "pulseFrequencySeconds": 300,
                    "pulseDelaySeconds": 0.7,
                    "pulseDurationSeconds": 1.2,
                    "pulsePreserveSpaces": true,
                    "pulseIgnoreTracers": true,
                    "pulseDimming": 0.2,
                    "pulseBlend": false,
                    "pulseWidth": 130,
                    "pulseRandomPosition": true,
                    "pulseInstantStart": false,
                    "pulseCircular": false,
                    "clearPulseEnabled": false,
                    "clearPulseMovieAccurate": true,
                    "clearPulseUseTracerGlow": true,
                    "clearPulseFrequencySeconds": 235,
                    "clearPulseDurationSeconds": 0.7,
                    "clearPulsePreserveSpaces": true,
                    "clearPulseBlend": false,
                    "clearPulseWidth": 190,
                    "clearPulseRandomPosition": true,
                    "clearPulseInstantStart": false,
                    "clearPulseCircular": false,
                    "miniPulseEnabled": false,
                    "miniPulseUseTracerGlow": true,
                    "miniPulseFrequencySeconds": 450,
                    "miniPulseDurationSeconds": 5,
                    "miniPulsePreserveSpaces": true,
                    "miniPulseThickness": 100,
                    "miniPulseSpawnChance": 0.06,
                    "miniPulseSpeed": 16,
                    "miniPulseSize": 360,
                    "quantizedPulseEnabled": false,
                    "quantizedPulseFrequencySeconds": 40,
                    "quantizedPulseDurationSeconds": 6.5,
                    "quantizedPulseSpeed": 1,
                    "quantizedBlockWidthCells": 4,
                    "quantizedBlockHeightCells": 4,
                    "quantizedPulseBorderIllumination": 1.6,
                    "quantizedPulsePerimeterThickness": 1.0,
                    "quantizedPulseFadeInFrames": 0,
                    "quantizedPulseFadeFrames": 0,
                    "quantizedAddEnabled": false,
                    "quantizedAddFrequencySeconds": 40,
                    "quantizedAddDurationSeconds": 2,
                    "quantizedAddBorderIllumination": 4,
            "quantizedAddSpeed": 1,
            "quantizedAddPerimeterThickness": 1.0,
                    "quantizedAddFadeInFrames": 0,
                    "quantizedAddFadeFrames": 0,
                    "quantizedRetractEnabled": false,
                    "quantizedRetractFrequencySeconds": 60,
                    "quantizedRetractDurationSeconds": 2,
                    "quantizedRetractFadeInFrames": 5,
                    "quantizedRetractFadeFrames": 15,
                    "quantizedRetractBorderIllumination": 4,
                    "quantizedGenerateEnabled": false,
                    "quantizedGenerateFrequencySeconds": 240,
                    "quantizedGenerateDurationSeconds": 7.6,
                    "quantizedGenerateSpeed": 1,
                    "quantizedGenerateBlockWidthCells": 4,
                    "quantizedGenerateBlockHeightCells": 4,
                    "quantizedGenerateBorderIllumination": 4,
                    "quantizedGeneratePerimeterThickness": 1.0,
                    "quantizedGeneratePerimeterColor": "#FFD700",
                    "quantizedGenerateInnerColor": "#FFD700",
                    "quantizedGenerateFadeInFrames": 0,
                    "quantizedGenerateFadeFrames": 0,
                    "quantizedGenerateSimultaneousSpawns": 3,
                    "quantizedGenerateGreenFadeSeconds": 0.1,
                    "dejaVuEnabled": false,
                    "dejaVuFrequencySeconds": 350,
                    "dejaVuDurationSeconds": 5,
                    "dejaVuMinRectHeight": 1,
                    "dejaVuMaxRectHeight": 10,
                    "dejaVuHoleBrightness": 0.02,
                    "dejaVuRandomizeColors": false,
                    "dejaVuIntensity": 0.1,
                    "dejaVuBarDurationFrames": 28,
                    "dejaVuVarianceFrames": 43,
                    "supermanEnabled": false,
                    "supermanFrequencySeconds": 290,
                    "supermanDurationSeconds": 6,
                    "supermanFadeSpeed": 6,
                    "supermanGlow": 4,
                    "supermanBoltThickness": 5,
                    "supermanFlickerRate": 2,
                    "supermanWidth": 4,
                    "supermanSpawnSpeed": 69,
                    "starPowerEnabled": false,
                    "starPowerFreq": 100,
                    "starPowerRainbowMode": "char",
                    "starPowerSaturation": 100,
                    "starPowerIntensity": 51,
                    "starPowerColorCycle": true,
                    "starPowerCycleSpeed": 5,
                    "rainbowStreamEnabled": false,
                    "rainbowStreamChance": 0.5,
                    "rainbowStreamIntensity": 50,
                    "bootSequenceEnabled": false,
                    "crashEnabled": false,
                    "crashFrequencySeconds": 600,
                    "crashDurationSeconds": 30,
                    "crashSheetCount": 25,
                    "crashSheetSpeed": 1,
                    "crashSheetOpacity": 0.5,
                    "crashStationaryChance": 20,
                    "crashFlashDelayMin": 3,
                    "crashFlashDelayMax": 6,
                    "crashEnableSmith": true,
                    "crashEnableSuperman": true,
                    "crashEnableFlash": true,
                    "runBothInOrder": false,
                    "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "x", "BootCrashSequence": "c"},
                    "hideMenuIcon": true,
                    "fontSettings": {"MatrixEmbedded": {"active": false, "useCustomChars": false, "customCharacters": "!\"*+-.012345789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi|"}, "CustomFont_5e2697679380fc43": {"active": true, "useCustomChars": true, "customCharacters": "!\"'()*+-.0123456789:<=>ABCDEFGHIJKLNOPQRSTUVWXYZ^_c|Mfg", "useAllChars": false}},
                    "deteriorationType": "ghost",
                    "tracerSizeIncrease": 1,
                    "supermanProb": 4,
                    "dejaVuAutoMode": true,
                    "clearPulseIgnoreTracers": true,
                    "dejaVuPerformanceMode": false,
                    "pulseDelayFrames": 60,
                    "suppressToasts": false,
                    "supermanIncludeColors": true,
                    "renderingEngine": "canvas",
                    "dissolveMinSize": 18,
                    "crashMovieFps": true,
                    "streamLengthVarianceEnabled": true,
                                "streamLengthVariance": 100,
                                "streamVisibleLengthScale": 0.1,
                                "quantizedPulseGreenFadeSeconds": 0.2,                    "starPowerGlitter": false,
                    "firewallEnabled": false,
                    "firewallFrequencySeconds": 150,
                    "firewallRandomColorEnabled": true,
                    "firewallColor": "#00ff00",
                    "firewallReverseDurationFrames": 20,
                    "firewallEraseDurationFrames": 50,
                    "ttlMinSeconds": 1,
                    "ttlMaxSeconds": 8,
                    "renderMode3D": false,
                    "flySpeed": 15,
                    "upwardTracerGlimmerChance": 0
                }
            },
            {
                name: "Trinity",
                data: {
                    "streamColor": "#65d778",
                    "backgroundColor": "#020509",
                    "streamPalette": ["#00e004", "#00ad14", "#33ff70"],
                    "paletteBias": 1,
                    "colorMixType": 1,
                    "tracerColor": "#d7ffd7",
                    "fontSize": 24,
                    "streamSpeed": 17,
                    "releaseInterval": 3,
                    "resolution": 1,
                    "enableGlyphAtlas": true,
                    "smoothingEnabled": false,
                    "smoothingAmount": 0.1,
                    "showFpsCounter": true,
                    "debugEnabled": false,
                    "highlightErasers": false,
                    "logErrors": false,
                    "fontFamily": "CustomFont_5e2697679380fc43",
                    "fontWeight": "normal",
                    "italicEnabled": false,
                    "mirrorEnabled": false,
                    "variableBrightnessEnabled": true,
                    "brightnessVariance": 35,
                    "overlapEnabled": false,
                    "overlapColor": "#fff5b8",
                    "overlapDensity": 0.3,
                    "overlapTarget": "stream",
                    "overlapShimmer": false,
                    "dissolveEnabled": true,
                    "dissolveScalePercent": -2,
                    "deteriorationEnabled": true,
                    "deteriorationStrength": 4,
                    "enableBloom": true,
                    "bloomStrength": 2,
                    "bloomOpacity": 0.4,
                    "tracerGlow": 6,
                    "clearAlpha": 0.89,
                    "horizontalSpacingFactor": 0.95,
                    "verticalSpacingFactor": 0.95,
                    "fontOffsetX": 0,
                    "fontOffsetY": 0,
                    "stretchX": 0.9,
                    "stretchY": 0.9,
                    "decayFadeDurationFrames": 60,
                    "trailLengthVarianceEnabled": true,
                    "trailLengthVariance": 135,
                    "streamSpawnCount": 3,
                    "eraserSpawnCount": 3,
                    "minStreamGap": 2,
                    "minEraserGap": 50,
                    "minGapTypes": 10,
                    "allowTinyStreams": true,
                    "gradualColorStreams": true,
                    "holeRate": 0,
                    "desyncIntensity": 0.45,
                    "preferClusters": true,
                    "eraserStopChance": 0,
                    "tracerStopChance": 0,
                    "tracerAttackFrames": 3,
                    "tracerHoldFrames": 2,
                    "tracerReleaseFrames": 1,
                    "invertedTracerEnabled": false,
                    "invertedTracerChance": 0.1,
                    "upwardTracerEnabled": false,
                    "upwardTracerChance": 0.81,
                    "upwardTracerAttackFrames": 2,
                    "upwardTracerHoldFrames": 4,
                    "upwardTracerReleaseFrames": 30,
                    "upwardTracerGlow": 8,
                    "upwardTracerSpeedMult": 1.3,
                    "upwardTracerGlimmerSpeed": 3.15,
                    "upwardTracerGlimmerSize": 5,
                    "upwardTracerGlimmerFill": 5,
                    "upwardTracerGlimmerGlow": 6,
                    "upwardTracerGlimmerFlicker": 0.45,
                    "rotatorEnabled": true,
                    "rotatorChance": 1,
                    "rotatorSyncToTracer": false,
                    "rotatorSyncMultiplier": 0.3,
                    "rotatorCycleFactor": 16,
                    "rotatorCrossfadeFrames": 4,
                    "rotateDuringFade": true,
                    "rotatorDesyncEnabled": true,
                    "rotatorDesyncVariance": 41,
                    "shaderEnabled": true,
                    "customShader": `// Name: Static Grain
precision mediump float;

// Inputs provided by the application
uniform sampler2D uTexture;
uniform float uParameter;

// uniform float uTime; // NOT needed for static grain
varying vec2 vTexCoord;

// Shader Configuration
const float GRAIN_AMOUNT = 0.05; // Increase this value (0.0 to 1.0) to make the grain more noticeable

// 1. Random function
// Generates a seemingly random float based on the input coordinate 'st'.
float random(vec2 st) {
    // This uses a "magic" dot product and large number to generate noise.
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // 2. Sample the original texture
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // 3. Calculate static noise
    // The key here is to pass only the coordinate (vTexCoord) to the random function.
    // We are NOT using 'uTime', so the result for any given coordinate is always the same.
    float noiseValue = random(vTexCoord);
    
    // Map the random value from [0.0, 1.0] to a useful noise range, e.g., [-1.0, 1.0]
    // (noiseValue - 0.5) shifts the range to [-0.5, 0.5]
    // * 2.0 expands the range to [-1.0, 1.0]
    float finalNoise = (noiseValue - 0.5) * 2.0;

    // 4. Apply grain to the color
    // We only apply the noise to the Red, Green, and Blue channels (.rgb).
    // The noise value is scaled by the GRAIN_AMOUNT.
    // A negative noise makes the pixel darker, a positive noise makes it brighter.
    color.rgb += finalNoise * (uParameter * 0.5);
    
    // 5. Output final color
    gl_FragColor = color;
}`,
                    "effectShader": null,
                    "shaderParameter": 0.03,
                    "effectParameter": 0,
                    "pulseEnabled": false,
                    "pulseUseTracerGlow": true,
                    "pulseMovieAccurate": false,
                    "pulseFrequencySeconds": 300,
                    "pulseDelaySeconds": 0.7,
                    "pulseDurationSeconds": 1.2,
                    "pulsePreserveSpaces": true,
                    "pulseIgnoreTracers": true,
                    "pulseDimming": 0.2,
                    "pulseBlend": false,
                    "pulseWidth": 130,
                    "pulseRandomPosition": true,
                    "pulseInstantStart": false,
                    "pulseCircular": false,
                    "clearPulseEnabled": false,
                    "clearPulseMovieAccurate": true,
                    "clearPulseUseTracerGlow": true,
                    "clearPulseFrequencySeconds": 235,
                    "clearPulseDurationSeconds": 0.7,
                    "clearPulsePreserveSpaces": true,
                    "clearPulseBlend": false,
                    "clearPulseWidth": 190,
                    "clearPulseRandomPosition": true,
                    "clearPulseInstantStart": false,
                    "clearPulseCircular": false,
                    "miniPulseEnabled": false,
                    "miniPulseUseTracerGlow": true,
                    "miniPulseFrequencySeconds": 450,
                    "miniPulseDurationSeconds": 5,
                    "miniPulsePreserveSpaces": true,
                    "miniPulseThickness": 100,
                    "miniPulseSpawnChance": 0.06,
                    "miniPulseSpeed": 16,
                    "miniPulseSize": 360,
                    "quantizedPulseEnabled": true,
                    "quantizedPulseFrequencySeconds": 295,
                    "quantizedPulseDurationSeconds": 10,
                    "quantizedPulseSpeed": 1,
                    "quantizedBlockWidthCells": 5,
                    "quantizedBlockHeightCells": 4,
                    "quantizedPulseBorderIllumination": 6.3,
                    "quantizedPulsePerimeterThickness": 1.0,
                    "quantizedPulseFadeInFrames": 0,
                    "quantizedPulseFadeFrames": 0,
                    "quantizedAddEnabled": false,
                    "quantizedAddFrequencySeconds": 40,
                    "quantizedAddDurationSeconds": 2,
                    "quantizedAddBorderIllumination": 4,
            "quantizedAddSpeed": 1,
            "quantizedAddPerimeterThickness": 1.0,
                    "quantizedAddFadeInFrames": 0,
                    "quantizedAddFadeFrames": 0,
                    "quantizedRetractEnabled": false,
                    "quantizedRetractFrequencySeconds": 60,
                    "quantizedRetractDurationSeconds": 2,
                    "quantizedRetractFadeInFrames": 5,
                    "quantizedRetractFadeFrames": 15,
                    "quantizedRetractBorderIllumination": 4,
                    "quantizedGenerateEnabled": false,
                    "quantizedGenerateFrequencySeconds": 240,
                    "quantizedGenerateDurationSeconds": 7.6,
                    "quantizedGenerateSpeed": 1,
                    "quantizedGenerateBlockWidthCells": 4,
                    "quantizedGenerateBlockHeightCells": 4,
                    "quantizedGenerateBorderIllumination": 4,
                    "quantizedGeneratePerimeterThickness": 1.0,
                    "quantizedGeneratePerimeterColor": "#FFD700",
                    "quantizedGenerateInnerColor": "#FFD700",
                    "quantizedGenerateFadeInFrames": 0,
                    "quantizedGenerateFadeFrames": 0,
                    "quantizedGenerateSimultaneousSpawns": 3,
                    "quantizedGenerateGreenFadeSeconds": 0.1,
                    "dejaVuEnabled": false,
                    "dejaVuFrequencySeconds": 350,
                    "dejaVuDurationSeconds": 5,
                    "dejaVuMinRectHeight": 1,
                    "dejaVuMaxRectHeight": 10,
                    "dejaVuHoleBrightness": 0.02,
                    "dejaVuRandomizeColors": false,
                    "dejaVuIntensity": 0.1,
                    "dejaVuBarDurationFrames": 28,
                    "dejaVuVarianceFrames": 43,
                    "supermanEnabled": false,
                    "supermanFrequencySeconds": 290,
                    "supermanDurationSeconds": 6,
                    "supermanFadeSpeed": 6,
                    "supermanGlow": 4,
                    "supermanBoltThickness": 5,
                    "supermanFlickerRate": 2,
                    "supermanWidth": 4,
                    "supermanSpawnSpeed": 69,
                    "starPowerEnabled": false,
                    "starPowerFreq": 100,
                    "starPowerRainbowMode": "char",
                    "starPowerSaturation": 100,
                    "starPowerIntensity": 51,
                    "starPowerColorCycle": true,
                    "starPowerCycleSpeed": 5,
                    "rainbowStreamEnabled": false,
                    "rainbowStreamChance": 0.5,
                    "rainbowStreamIntensity": 50,
                    "bootSequenceEnabled": false,
                    "crashEnabled": false,
                    "crashFrequencySeconds": 600,
                    "crashDurationSeconds": 30,
                    "crashSheetCount": 25,
                    "crashSheetSpeed": 1,
                    "crashSheetOpacity": 0.5,
                    "crashStationaryChance": 20,
                    "crashFlashDelayMin": 3,
                    "crashFlashDelayMax": 6,
                    "crashEnableSmith": true,
                    "crashEnableSuperman": true,
                    "crashEnableFlash": true,
                    "runBothInOrder": false,
                    "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "x", "BootCrashSequence": "c", "QuantizedPulse": "q", "QuantizedAdd": "a"},
                    "hideMenuIcon": true,
                    "fontSettings": {"MatrixEmbedded": {"active": false, "useCustomChars": false, "customCharacters": "!\"*+-.012345789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi|"}, "CustomFont_5e2697679380fc43": {"active": true, "useCustomChars": true, "customCharacters": "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", "useAllChars": false}},
                    "deteriorationType": "ghost",
                    "tracerSizeIncrease": 1,
                    "supermanProb": 4,
                    "dejaVuAutoMode": true,
                    "clearPulseIgnoreTracers": true,
                    "dejaVuPerformanceMode": false,
                    "pulseDelayFrames": 60,
                    "suppressToasts": true,
                    "supermanIncludeColors": true,
                    "renderingEngine": "canvas",
                    "dissolveMinSize": 18,
                    "crashMovieFps": true,
                    "quantizedPulseSimultaneousSpawns": 1,
                    "quantizedPulseGreenFadeSeconds": 0,
                    "quantizedAddGreenFadeSeconds": 0.5,
                    "quantizedRetractGreenFadeSeconds": 0.5,
                    "quantizedBlockGridWidth": 10,
                    "quantizedBlockGridHeight": 10,
                    "starPowerGlitter": false,
                    "ttlMinSeconds": 1,
                    "ttlMaxSeconds": 8,
                    "firewallEnabled": false,
                    "firewallFrequencySeconds": 150,
                    "firewallRandomColorEnabled": true,
                    "firewallColor": "#00ff00",
                    "firewallReverseDurationFrames": 20,
                    "firewallEraseDurationFrames": 50,
                    "renderMode3D": false,
                    "flySpeed": 15,
                    "upwardTracerGlimmerChance": 0
                }
            },
            {
                name: "PowerTrin",
                data: {
                    "streamColor": "#65d778",
                    "backgroundColor": "#020509",
                    "streamPalette": ["#00e004", "#2db61b", "#33ff70"],
                    "paletteBias": 1,
                    "colorMixType": 0,
                    "tracerColor": "#d7ffd7",
                    "fontSize": 24,
                    "streamSpeed": 17,
                    "releaseInterval": 3,
                    "resolution": 1,
                    "enableGlyphAtlas": true,
                    "smoothingEnabled": false,
                    "smoothingAmount": 0.1,
                    "showFpsCounter": true,
                    "debugEnabled": false,
                    "highlightErasers": false,
                    "logErrors": false,
                    "fontFamily": "CustomFont_5e2697679380fc43",
                    "fontWeight": "normal",
                    "italicEnabled": false,
                    "mirrorEnabled": false,
                    "variableBrightnessEnabled": true,
                    "brightnessVariance": 35,
                    "overlapEnabled": true,
                    "overlapColor": "#fff5b8",
                    "overlapDensity": 0.2,
                    "overlapTarget": "stream",
                    "overlapShimmer": false,
                    "dissolveEnabled": true,
                    "dissolveScalePercent": -2,
                    "deteriorationEnabled": true,
                    "deteriorationStrength": 4,
                    "enableBloom": true,
                    "bloomStrength": 2,
                    "bloomOpacity": 0.4,
                    "tracerGlow": 6,
                    "clearAlpha": 0.89,
                    "horizontalSpacingFactor": 0.95,
                    "verticalSpacingFactor": 0.95,
                    "fontOffsetX": 0,
                    "fontOffsetY": 0,
                    "stretchX": 0.9,
                    "stretchY": 0.9,
                    "decayFadeDurationFrames": 60,
                    "trailLengthVarianceEnabled": true,
                    "trailLengthVariance": 135,
                    "streamSpawnCount": 3,
                    "eraserSpawnCount": 3,
                    "minStreamGap": 2,
                    "minEraserGap": 23,
                    "minGapTypes": 60,
                    "allowTinyStreams": true,
                    "gradualColorStreams": true,
                    "holeRate": 0,
                    "desyncIntensity": 0.2,
                    "preferClusters": true,
                    "eraserStopChance": 0,
                    "tracerStopChance": 0,
                    "tracerAttackFrames": 3,
                    "tracerHoldFrames": 2,
                    "tracerReleaseFrames": 1,
                    "invertedTracerEnabled": false,
                    "invertedTracerChance": 0.1,
                    "upwardTracerEnabled": true,
                    "upwardTracerChance": 1,
                    "upwardTracerAttackFrames": 4,
                    "upwardTracerHoldFrames": 4,
                    "upwardTracerReleaseFrames": 50,
                    "upwardTracerGlow": 8,
                    "upwardTracerSpeedMult": 2.4,
                    "upwardTracerGlimmerSpeed": 5.48,
                    "upwardTracerGlimmerSize": 6,
                    "upwardTracerGlimmerFill": 2,
                    "upwardTracerGlimmerGlow": 3,
                    "upwardTracerGlimmerFlicker": 0.45,
                    "rotatorEnabled": true,
                    "rotatorChance": 1,
                    "rotatorSyncToTracer": false,
                    "rotatorSyncMultiplier": 0.3,
                    "rotatorCycleFactor": 16,
                    "rotatorCrossfadeFrames": 4,
                    "rotateDuringFade": true,
                    "rotatorDesyncEnabled": true,
                    "rotatorDesyncVariance": 41,
                    "shaderEnabled": false,
                    "customShader": null,
                    "effectShader": null,
                    "shaderParameter": 0.03,
                    "effectParameter": 0,
                    "pulseEnabled": false,
                    "pulseUseTracerGlow": true,
                    "pulseMovieAccurate": false,
                    "pulseFrequencySeconds": 300,
                    "pulseDelaySeconds": 0.7,
                    "pulseDurationSeconds": 1.2,
                    "pulsePreserveSpaces": true,
                    "pulseIgnoreTracers": true,
                    "pulseDimming": 0.2,
                    "pulseBlend": false,
                    "pulseWidth": 130,
                    "pulseRandomPosition": true,
                    "pulseInstantStart": false,
                    "pulseCircular": false,
                    "clearPulseEnabled": false,
                    "clearPulseMovieAccurate": true,
                    "clearPulseUseTracerGlow": true,
                    "clearPulseFrequencySeconds": 235,
                    "clearPulseDurationSeconds": 0.7,
                    "clearPulsePreserveSpaces": true,
                    "clearPulseBlend": false,
                    "clearPulseWidth": 190,
                    "clearPulseRandomPosition": true,
                    "clearPulseInstantStart": false,
                    "clearPulseCircular": false,
                    "miniPulseEnabled": false,
                    "miniPulseUseTracerGlow": true,
                    "miniPulseFrequencySeconds": 450,
                    "miniPulseDurationSeconds": 5,
                    "miniPulsePreserveSpaces": true,
                    "miniPulseThickness": 100,
                    "miniPulseSpawnChance": 0.06,
                    "miniPulseSpeed": 16,
                    "miniPulseSize": 360,
                    "quantizedPulseEnabled": true,
                    "quantizedPulseFrequencySeconds": 295,
                    "quantizedPulseDurationSeconds": 10,
                    "quantizedPulseSpeed": 1,
                    "quantizedBlockWidthCells": 5,
                    "quantizedBlockHeightCells": 4,
                    "quantizedPulseBorderIllumination": 6.3,
                    "quantizedPulsePerimeterThickness": 1.0,
                    "quantizedPulseFadeInFrames": 0,
                    "quantizedPulseFadeFrames": 0,
                    "quantizedAddEnabled": false,
                    "quantizedAddFrequencySeconds": 40,
                    "quantizedAddDurationSeconds": 2,
                    "quantizedAddBorderIllumination": 4,
            "quantizedAddSpeed": 1,
            "quantizedAddPerimeterThickness": 1.0,
                    "quantizedAddFadeInFrames": 0,
                    "quantizedAddFadeFrames": 0,
                    "quantizedRetractEnabled": false,
                    "quantizedRetractFrequencySeconds": 60,
                    "quantizedRetractDurationSeconds": 2,
                    "quantizedRetractFadeInFrames": 5,
                    "quantizedRetractFadeFrames": 15,
                    "quantizedRetractBorderIllumination": 4,
                    "quantizedGenerateEnabled": false,
                    "quantizedGenerateFrequencySeconds": 240,
                    "quantizedGenerateDurationSeconds": 7.6,
                    "quantizedGenerateSpeed": 1,
                    "quantizedGenerateBlockWidthCells": 4,
                    "quantizedGenerateBlockHeightCells": 4,
                    "quantizedGenerateBorderIllumination": 4,
                    "quantizedGeneratePerimeterThickness": 1.0,
                    "quantizedGeneratePerimeterColor": "#FFD700",
                    "quantizedGenerateInnerColor": "#FFD700",
                    "quantizedGenerateFadeInFrames": 0,
                    "quantizedGenerateFadeFrames": 0,
                    "quantizedGenerateSimultaneousSpawns": 3,
                    "quantizedGenerateGreenFadeSeconds": 0.1,
                    "dejaVuEnabled": false,
                    "dejaVuFrequencySeconds": 350,
                    "dejaVuDurationSeconds": 5,
                    "dejaVuMinRectHeight": 1,
                    "dejaVuMaxRectHeight": 10,
                    "dejaVuHoleBrightness": 0.02,
                    "dejaVuRandomizeColors": false,
                    "dejaVuIntensity": 0.1,
                    "dejaVuBarDurationFrames": 28,
                    "dejaVuVarianceFrames": 43,
                    "supermanEnabled": false,
                    "supermanFrequencySeconds": 290,
                    "supermanDurationSeconds": 6,
                    "supermanFadeSpeed": 6,
                    "supermanGlow": 4,
                    "supermanBoltThickness": 5,
                    "supermanFlickerRate": 2,
                    "supermanWidth": 4,
                    "supermanSpawnSpeed": 69,
                    "starPowerEnabled": false,
                    "starPowerFreq": 100,
                    "starPowerRainbowMode": "char",
                    "starPowerSaturation": 100,
                    "starPowerIntensity": 51,
                    "starPowerColorCycle": true,
                    "starPowerCycleSpeed": 5,
                    "rainbowStreamEnabled": false,
                    "rainbowStreamChance": 0.5,
                    "rainbowStreamIntensity": 50,
                    "bootSequenceEnabled": false,
                    "crashEnabled": false,
                    "crashFrequencySeconds": 600,
                    "crashDurationSeconds": 30,
                    "crashSheetCount": 25,
                    "crashSheetSpeed": 1,
                    "crashSheetOpacity": 0.5,
                    "crashStationaryChance": 20,
                    "crashFlashDelayMin": 3,
                    "crashFlashDelayMax": 6,
                    "crashEnableSmith": true,
                    "crashEnableSuperman": true,
                    "crashEnableFlash": true,
                    "runBothInOrder": false,
                    "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "x", "BootCrashSequence": "c", "QuantizedPulse": "q", "QuantizedAdd": "a"},
                    "hideMenuIcon": true,
                    "fontSettings": {"MatrixEmbedded": {"active": false, "useCustomChars": false, "customCharacters": "!\"*+-.012345789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi|"}, "CustomFont_5e2697679380fc43": {"active": true, "useCustomChars": true, "customCharacters": "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", "useAllChars": false}},
                    "deteriorationType": "ghost",
                    "tracerSizeIncrease": 1,
                    "supermanProb": 4,
                    "dejaVuAutoMode": true,
                    "clearPulseIgnoreTracers": true,
                    "dejaVuPerformanceMode": false,
                    "pulseDelayFrames": 60,
                    "suppressToasts": true,
                    "supermanIncludeColors": true,
                    "renderingEngine": "canvas",
                    "dissolveMinSize": 18,
                    "crashMovieFps": true,
                    "quantizedPulseSimultaneousSpawns": 1,
                    "quantizedPulseGreenFadeSeconds": 0,
                    "quantizedAddGreenFadeSeconds": 0.5,
                    "quantizedRetractGreenFadeSeconds": 0.5,
                    "quantizedBlockGridWidth": 10,
                    "quantizedBlockGridHeight": 10,
                    "starPowerGlitter": false,
                    "ttlMinSeconds": 1,
                    "ttlMaxSeconds": 8,
                    "firewallEnabled": false,
                    "firewallFrequencySeconds": 150,
                    "firewallRandomColorEnabled": true,
                    "firewallColor": "#00ff00",
                    "firewallReverseDurationFrames": 20,
                    "firewallEraseDurationFrames": 50,
                    "renderMode3D": false,
                    "flySpeed": 15,
                    "upwardTracerGlimmerChance": 0
                }
            },
            {
                name: "RainbowRoad",
                data: {
                    "streamColor": "#65d778",
                    "backgroundColor": "#000000",
                    "streamPalette": ["#00ff41"],
                    "paletteBias": 0,
                    "colorMixType": 0.45,
                    "tracerColor": "#ccffcc",
                    "fontSize": 20,
                    "streamSpeed": 15,
                    "releaseInterval": 3,
                    "resolution": 1,
                    "enableGlyphAtlas": true,
                    "smoothingEnabled": false,
                    "smoothingAmount": 0.1,
                    "showFpsCounter": false,
                    "debugEnabled": false,
                    "highlightErasers": false,
                    "logErrors": false,
                    "fontFamily": "MatrixEmbedded",
                    "fontWeight": "normal",
                    "italicEnabled": false,
                    "mirrorEnabled": false,
                    "variableBrightnessEnabled": false,
                    "brightnessVariance": 15,
                    "overlapEnabled": false,
                    "overlapColor": "#20cb53",
                    "overlapDensity": 0.2,
                    "overlapTarget": "stream",
                    "overlapShimmer": false,
                    "dissolveEnabled": false,
                    "dissolveScalePercent": -15,
                    "deteriorationEnabled": false,
                    "deteriorationStrength": 6,
                    "enableBloom": true,
                    "bloomStrength": 2,
                    "bloomOpacity": 0.2,
                    "tracerGlow": 24,
                    "clearAlpha": 0.7,
                    "horizontalSpacingFactor": 0.75,
                    "verticalSpacingFactor": 1,
                    "fontOffsetX": 0,
                    "fontOffsetY": 0,
                    "stretchX": 1,
                    "stretchY": 1,
                    "decayFadeDurationFrames": 33,
                    "trailLengthVarianceEnabled": false,
                    "trailLengthVariance": 60,
                    "streamSpawnCount": 7,
                    "eraserSpawnCount": 5,
                    "minStreamGap": 2,
                    "minEraserGap": 2,
                    "minGapTypes": 1,
                    "allowTinyStreams": true,
                    "gradualColorStreams": false,
                    "gradualColorStreamsFrequency": 100,
                    "holeRate": 0,
                    "desyncIntensity": 0,
                    "preferClusters": true,
                    "eraserStopChance": 0,
                    "tracerStopChance": 1,
                    "tracerAttackFrames": 3,
                    "tracerHoldFrames": 2,
                    "tracerReleaseFrames": 3,
                    "invertedTracerEnabled": false,
                    "invertedTracerChance": 0.07,
                    "upwardTracerEnabled": true,
                    "upwardTracerChance": 0.02,
                    "upwardTracerAttackFrames": 2,
                    "upwardTracerHoldFrames": 30,
                    "upwardTracerReleaseFrames": 30,
                    "upwardTracerGlow": 8,
                    "upwardTracerSpeedMult": 1,
                    "upwardTracerGlimmerSpeed": 2,
                    "upwardTracerGlimmerSize": 3,
                    "upwardTracerGlimmerFill": 3,
                    "upwardTracerGlimmerGlow": 19,
                    "upwardTracerGlimmerFlicker": 0.5,
                    "rotatorEnabled": true,
                    "rotatorChance": 0.25,
                    "rotatorSyncToTracer": true,
                    "rotatorSyncMultiplier": 0.4,
                    "rotatorCycleFactor": 20,
                    "rotatorCrossfadeFrames": 6,
                    "rotateDuringFade": false,
                    "rotatorDesyncEnabled": false,
                    "rotatorDesyncVariance": 0,
                    "shaderEnabled": false,
                    "customShader": `// Name: Matrix Real-World Blue Hue
precision highp float;                    // highp for desktop; switch to mediump for mobile if needed

uniform sampler2D uTexture;
uniform vec2      uResolution;            // (width, height)
uniform float     uTime;                  // seconds
uniform vec2      uMouse;                 // normalized [0..1]
uniform float     uParameter;             // UI slider [0..1]

varying vec2      vTexCoord;

vec3 rgb2hsv(vec3 c){
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.x, p.y, p.w, c.r), vec4(c.r, p.y, p.z, p.x), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 rgb = texture2D(uTexture, vTexCoord).rgb;
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = mix(hsv.x, 0.55, uParameter * 0.25);    // Hue change                                       
    hsv.y = mix(hsv.y, 0.0, uParameter * 0.25);            // Saturation change
    vec3 outc = hsv2rgb(hsv);
    gl_FragColor = vec4(outc, 1.0);
}`,
                    "effectShader": null,
                    "shaderParameter": 0.69,
                    "effectParameter": 2.8,
                    "pulseEnabled": true,
                    "pulseUseTracerGlow": false,
                    "pulseMovieAccurate": true,
                    "pulseFrequencySeconds": 300,
                    "pulseDelaySeconds": 0.7,
                    "pulseDurationSeconds": 1.2,
                    "pulsePreserveSpaces": true,
                    "pulseIgnoreTracers": true,
                    "pulseDimming": 0.2,
                    "pulseBlend": false,
                    "pulseWidth": 130,
                    "pulseRandomPosition": true,
                    "pulseInstantStart": false,
                    "pulseCircular": false,
                    "clearPulseEnabled": true,
                    "clearPulseMovieAccurate": true,
                    "clearPulseUseTracerGlow": true,
                    "clearPulseFrequencySeconds": 235,
                    "clearPulseDurationSeconds": 1.1,
                    "clearPulsePreserveSpaces": true,
                    "clearPulseBlend": true,
                    "clearPulseWidth": 130,
                    "clearPulseRandomPosition": true,
                    "clearPulseInstantStart": false,
                    "clearPulseCircular": false,
                    "miniPulseEnabled": true,
                    "miniPulseUseTracerGlow": true,
                    "miniPulseFrequencySeconds": 450,
                    "miniPulseDurationSeconds": 5,
                    "miniPulsePreserveSpaces": true,
                    "miniPulseThickness": 100,
                    "miniPulseSpawnChance": 0.06,
                    "miniPulseSpeed": 16,
                    "miniPulseSize": 360,
                    "quantizedPulseEnabled": false,
                    "quantizedPulseFrequencySeconds": 240,
                    "quantizedPulseDurationSeconds": 7.6,
                    "quantizedPulseSpeed": 1,
                    "quantizedBlockWidthCells": 4,
                    "quantizedBlockHeightCells": 4,
                    "quantizedPulseBorderIllumination": 4,
                    "quantizedPulsePerimeterThickness": 1.0,
                    "quantizedPulseFadeInFrames": 0,
                    "quantizedPulseFadeFrames": 0,
                    "quantizedAddEnabled": false,
                    "quantizedAddFrequencySeconds": 300,
                    "quantizedAddDurationSeconds": 10,
                    "quantizedAddBorderIllumination": 4,
            "quantizedAddSpeed": 1,
            "quantizedAddPerimeterThickness": 1.0,
                    "quantizedAddFadeInFrames": 0,
                    "quantizedAddFadeFrames": 0,
                    "quantizedRetractEnabled": false,
                    "quantizedRetractFrequencySeconds": 60,
                    "quantizedRetractDurationSeconds": 2,
                    "quantizedRetractFadeInFrames": 5,
                    "quantizedRetractFadeFrames": 15,
                    "quantizedRetractBorderIllumination": 4,
                    "quantizedGenerateEnabled": false,
                    "quantizedGenerateFrequencySeconds": 240,
                    "quantizedGenerateDurationSeconds": 7.6,
                    "quantizedGenerateSpeed": 1,
                    "quantizedGenerateBlockWidthCells": 4,
                    "quantizedGenerateBlockHeightCells": 4,
                    "quantizedGenerateBorderIllumination": 4,
                    "quantizedGeneratePerimeterThickness": 1.0,
                    "quantizedGeneratePerimeterColor": "#FFD700",
                    "quantizedGenerateInnerColor": "#FFD700",
                    "quantizedGenerateFadeInFrames": 0,
                    "quantizedGenerateFadeFrames": 0,
                    "quantizedGenerateSimultaneousSpawns": 3,
                    "quantizedGenerateGreenFadeSeconds": 0.1,
                    "dejaVuEnabled": true,
                    "dejaVuFrequencySeconds": 350,
                    "dejaVuDurationSeconds": 5,
                    "dejaVuMinRectHeight": 1,
                    "dejaVuMaxRectHeight": 10,
                    "dejaVuHoleBrightness": 0.02,
                    "dejaVuRandomizeColors": false,
                    "dejaVuIntensity": 0.07,
                    "dejaVuBarDurationFrames": 21,
                    "dejaVuVarianceFrames": 43,
                    "supermanEnabled": true,
                    "supermanFrequencySeconds": 290,
                    "supermanDurationSeconds": 6,
                    "supermanFadeSpeed": 6,
                    "supermanGlow": 2,
                    "supermanBoltThickness": 5,
                    "supermanFlickerRate": 3,
                    "supermanWidth": 3,
                    "supermanSpawnSpeed": 69,
                    "starPowerEnabled": true,
                    "starPowerFreq": 100,
                    "starPowerRainbowMode": "char",
                    "starPowerSaturation": 100,
                    "starPowerIntensity": 50,
                    "starPowerColorCycle": true,
                    "starPowerCycleSpeed": 14,
                    "rainbowStreamEnabled": false,
                    "rainbowStreamChance": 0.5,
                    "rainbowStreamIntensity": 50,
                    "bootSequenceEnabled": false,
                    "crashEnabled": false,
                    "crashFrequencySeconds": 600,
                    "crashDurationSeconds": 30,
                    "crashSheetCount": 33,
                    "crashSheetSpeed": 1.1,
                    "crashSheetOpacity": 0.96,
                    "crashStationaryChance": 17,
                    "crashFlashDelayMin": 3,
                    "crashFlashDelayMax": 6,
                    "crashEnableSmith": true,
                    "crashEnableSuperman": true,
                    "crashEnableFlash": true,
                    "runBothInOrder": true,
                    "keyBindings": {"Pulse": "p", "ClearPulse": "w", "MiniPulse": "e", "DejaVu": "r", "Superman": "t", "Firewall": "y", "ToggleUI": " ", "BootSequence": "b", "CrashSequence": "x", "BootCrashSequence": "c", "ReverseTime": "u"},
                    "hideMenuIcon": true,
                    "fontSettings": {"MatrixEmbedded": {"active": true, "useCustomChars": false, "customCharacters": ""}, "CustomFont_5e2697679380fc43": {"active": false, "useCustomChars": true, "customCharacters": "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5", "useAllChars": false}},
                    "deteriorationType": "ghost",
                    "tracerSizeIncrease": 1,
                    "supermanProb": 4,
                    "dejaVuAutoMode": true,
                    "clearPulseIgnoreTracers": true,
                    "dejaVuPerformanceMode": false,
                    "pulseDelayFrames": 60,
                    "suppressToasts": false,
                    "supermanIncludeColors": true,
                    "renderingEngine": "canvas",
                    "dissolveMinSize": 19,
                    "crashMovieFps": true,
                    "quantizedPulseSimultaneousSpawns": 3,
                    "quantizedPulseGreenFadeSeconds": 0.1,
                    "quantizedAddGreenFadeSeconds": 0.5,
                    "quantizedRetractGreenFadeSeconds": 0.5,
                    "starPowerGlitter": false,
                    "firewallEnabled": false,
                    "firewallFrequencySeconds": 150,
                    "firewallRandomColorEnabled": true,
                    "firewallColor": "#00ff00",
                    "firewallReverseDurationFrames": 20,
                    "firewallEraseDurationFrames": 50,
                    "ttlMinSeconds": 1,
                    "ttlMaxSeconds": 8,
                    "renderMode3D": false,
                    "flySpeed": 15
                }
            },
        ];

        // Ensure we have at least the default number of slots (migration for existing users)
        if (!Array.isArray(loadedSlots) || loadedSlots.length === 0) {
            return defaults;
        }

        while (loadedSlots.length < defaults.length) {
            loadedSlots.push(defaults[loadedSlots.length]);
        }

        return loadedSlots;
    }

    /**
     * Saves configuration slots to local storage.
     */
    saveSlots() {
        try {
            localStorage.setItem(this.slotsKey, JSON.stringify(this.slots));
        } catch (e) {
            console.warn('Failed to save slots:', e);
        }
    }

    /**
     * Loads the application state from local storage.
     * @private
     */
    _loadState() {
        try {
            let storedState = localStorage.getItem(this.storageKey);
            
            // Fallback to previous version if current version not found
            if (!storedState) {
                const legacyKey = 'matrix_config_v7.5';
                storedState = localStorage.getItem(legacyKey);
            }

            if (storedState) {
                const parsed = JSON.parse(storedState);
                delete parsed.customFonts; // Remove unsupported keys if present
                
                // Handle new profile structure vs legacy flat structure
                if (parsed.profiles) {
                    // Flatten profiles - prioritize 2D if exists, otherwise take state
                    const p2d = parsed.profiles['2D'] || {};
                    this.state = { ...this.defaults, ...parsed.state, ...p2d };
                } else if (parsed.state) {
                    // Correctly unwrap 'state' property from saved JSON
                    this.state = { ...this.defaults, ...parsed.state };
                } else {
                    // Legacy flat structure
                    this.state = { ...this.defaults, ...parsed };
                }
                
                // Migration: Ensure streamPalette exists
                if (!this.state.streamPalette) {
                    this.state.streamPalette = [this.state.streamColor];
                }
                
                // Migration: Convert eraserStopChance from float to integer if needed
                if (this.state.eraserStopChance > 0 && this.state.eraserStopChance < 1) {
                    this.state.eraserStopChance = Math.round(this.state.eraserStopChance * 100);
                }
                // Clamp to max 25
                if (this.state.eraserStopChance > 25) {
                    this.state.eraserStopChance = 25;
                }

                // Migration: Ensure quantizedOffsetProfiles exists
                if (!this.state.quantizedOffsetProfiles) {
                    this.state.quantizedOffsetProfiles = {};
                }
            } else {
                // First run: Clone defaults
                this.state = this._deepClone(this.defaults);
            }
        } catch (e) {
            console.warn('Failed to load configuration:', e);
        }
    }

    /**
     * Saves the current application state to local storage.
     */
    save() {
        try {
            // Save state
            const data = {
                state: this.state
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save configuration:', e);
        }
    }

    /**
     * Retrieves the value of a specific configuration key.
     * @param {string} key - The key of the configuration setting.
     * @returns {*} The value of the configuration setting.
     */
    get(key) {
        return this.state[key];
    }

    /**
     * Sets the value of a configuration key and triggers updates.
     * @param {string} key - The key of the configuration setting.
     * @param {*} value - The new value for the setting.
     */
    set(key, value) {
        if (this.state[key] === value) return; // Skip if no change in value

        // Special handling for performanceMode
        if (key === 'performanceMode') {
            if (value === true) {
                // Enable Performance Mode - Backup current settings
                this.state.performanceBackup = {
                    fontSize: this.state.fontSize,
                    enableBloom: this.state.enableBloom,
                    shaderEnabled: this.state.shaderEnabled,
                    resolution: this.state.resolution,
                    smoothingEnabled: this.state.smoothingEnabled
                };

                // Apply Performance Settings
                // 1. Min Font Size 24 (Larger font = fewer cells = better performance)
                this.state.fontSize = Math.max(24, this.state.fontSize);
                
                // 2. Disable Effects
                this.state.enableBloom = false;
                this.state.shaderEnabled = false;
                this.state.smoothingEnabled = false;

                // 3. Lower Resolution
                this.state.resolution = 0.75;
                
                this.state.performanceMode = true;
            } else {
                // Disable Performance Mode - Restore settings
                if (this.state.performanceBackup) {
                    const b = this.state.performanceBackup;
                    if (b.fontSize !== undefined) this.state.fontSize = b.fontSize;
                    if (b.enableBloom !== undefined) this.state.enableBloom = b.enableBloom;
                    if (b.shaderEnabled !== undefined) this.state.shaderEnabled = b.shaderEnabled;
                    if (b.resolution !== undefined) this.state.resolution = b.resolution;
                    if (b.smoothingEnabled !== undefined) this.state.smoothingEnabled = b.smoothingEnabled;
                    
                    this.state.performanceBackup = null;
                }
                this.state.performanceMode = false;
            }

            this.updateDerivedValues();
            this.save();
            this.notify('ALL');
            return;
        }

        // Special handling for shaderEnabled
        if (key === 'shaderEnabled') {
            if (value === true) { // Shader is being enabled
                // Store current smoothing values only if they are not already forced
                if (this.state.smoothingEnabled !== false) {
                    this._previousSmoothingEnabled = this.state.smoothingEnabled;
                } else {
                    this._previousSmoothingEnabled = undefined; // No previous value to restore
                }
                if (this.state.smoothingAmount !== 0.1) {
                    this._previousSmoothingAmount = this.state.smoothingAmount;
                } else {
                    this._previousSmoothingAmount = undefined; // No previous value to restore
                }

                // Force smoothing off
                if (this.state.smoothingEnabled !== false) {
                    this.state.smoothingEnabled = false;
                    this.notify('smoothingEnabled');
                }
                if (this.state.smoothingAmount !== 0.1) {
                    this.state.smoothingAmount = 0.1; // Minimum value as per UI definition
                    this.notify('smoothingAmount');
                }
            } else { // Shader is being disabled
                // Restore previous smoothing values if they were stored
                if (this._previousSmoothingEnabled !== undefined && this.state.smoothingEnabled !== this._previousSmoothingEnabled) {
                    this.state.smoothingEnabled = this._previousSmoothingEnabled;
                    this.notify('smoothingEnabled');
                }
                if (this._previousSmoothingAmount !== undefined && this.state.smoothingAmount !== this._previousSmoothingAmount) {
                    this.state.smoothingAmount = this._previousSmoothingAmount;
                    this.notify('smoothingAmount');
                }
                // Clear stored previous values
                this._previousSmoothingEnabled = undefined;
                this._previousSmoothingAmount = undefined;
            }
        }

        // Special handling for fontFamily: Enforce single active font in settings
        if (key === 'fontFamily') {
            const settings = this.state.fontSettings; // Reference current settings
            if (settings && settings[value]) {
                let changed = false;
                // Create a new settings object to trigger reactivity if needed, or mutate copy
                const newSettings = { ...settings };
                
                for (const fName in newSettings) {
                    if (Object.prototype.hasOwnProperty.call(newSettings, fName)) {
                        const isActive = (fName === value);
                        if (newSettings[fName].active !== isActive) {
                            // Clone the specific font config to avoid mutation side-effects
                            newSettings[fName] = { ...newSettings[fName], active: isActive };
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    this.state.fontSettings = newSettings;
                    this.notify('fontSettings');
                }
            }
        }

        // --- QUANTIZED OFFSET PROFILES ---
        const OFFSET_KEYS = [
            'quantizedPerimeterOffsetX', 'quantizedPerimeterOffsetY',
            'quantizedShadowOffsetX', 'quantizedShadowOffsetY',
            'quantizedSourceGridOffsetX', 'quantizedSourceGridOffsetY',
            'quantizedEditorGridOffsetX', 'quantizedEditorGridOffsetY',
            'quantizedEditorChangesOffsetX', 'quantizedEditorChangesOffsetY',
            'quantizedLineLength', 'quantizedLineOffset'
        ];

        const BLOCK_SIZE_KEYS = [
            'quantizedBlockWidthCells', 'quantizedBlockHeightCells',
            'quantizedPulseBlockWidthCells', 'quantizedPulseBlockHeightCells',
            'quantizedAddBlockWidthCells', 'quantizedAddBlockHeightCells',
            'quantizedRetractBlockWidthCells', 'quantizedRetractBlockHeightCells',
            'quantizedClimbBlockWidthCells', 'quantizedClimbBlockHeightCells',
            'quantizedGenerateBlockWidthCells', 'quantizedGenerateBlockHeightCells',
            'quantizedGenerateV2BlockWidthCells', 'quantizedGenerateV2BlockHeightCells'
        ];

        // 1. If an offset is changing, save it to the CURRENT profile
        if (OFFSET_KEYS.includes(key)) {
            // Find current block size (most specific to pulse by default or first valid)
            const w = this.state.quantizedPulseBlockWidthCells || this.state.quantizedBlockWidthCells || 4;
            const h = this.state.quantizedPulseBlockHeightCells || this.state.quantizedBlockHeightCells || 4;
            const profileKey = `${w}x${h}`;
            if (!this.state.quantizedOffsetProfiles) this.state.quantizedOffsetProfiles = {};
            if (!this.state.quantizedOffsetProfiles[profileKey]) this.state.quantizedOffsetProfiles[profileKey] = {};
            this.state.quantizedOffsetProfiles[profileKey][key] = value;
        }

        // 2. If a block size is changing, LOAD the profile for the NEW size
        if (BLOCK_SIZE_KEYS.includes(key)) {
            let newW = this.state.quantizedPulseBlockWidthCells || this.state.quantizedBlockWidthCells || 4;
            let newH = this.state.quantizedPulseBlockHeightCells || this.state.quantizedBlockHeightCells || 4;
            
            // Override with the incoming change
            if (key.includes('Width')) newW = value;
            if (key.includes('Height')) newH = value;

            const profileKey = `${newW}x${newH}`;
            const profile = this.state.quantizedOffsetProfiles ? this.state.quantizedOffsetProfiles[profileKey] : null;

            // Strategy: 
            // 1. If Auto-Align is ON: Calculate new defaults.
            // 2. If Profile exists: Merge it on top (User overrides win? Or Auto-Align wins?)
            //    Request implies "algorithm... to ensure aligned". 
            //    So Auto-Align should be the BASELINE.
            //    But if user manually tweaked a profile, they likely want that.
            //    Let's say: If Profile Exists, use it. If NOT, use Auto-Align.
            //    AND: If Auto-Align is ON, should it overwrite the profile? 
            //    Let's assume Auto-Align provides the *defaults* for a size.
            
            let offsetsToApply = {};
            
            // A. Calculate Auto-Defaults first
            if (this.state.quantizedAutoAlign) {
                offsetsToApply = this._computeAutoOffsets(newW); // Assuming square logic or using Width
            }

            // B. Apply Profile Overrides (if any)
            if (profile) {
                // If the user manually saved this profile, respect it.
                // However, if we want strict enforcement, we might ignore profile.
                // But the profile system saves *every* tweak. 
                // So if we load a profile, we load the last state.
                // If the user wants to re-auto-align, they can toggle AutoAlign off/on?
                // Or maybe we treat AutoAlign as a "Smart Reset".
                // Let's merge: Profile beats Auto.
                offsetsToApply = { ...offsetsToApply, ...profile };
            }

            // Apply
            if (offsetsToApply) {
                // Update the actual key first
                this.state[key] = value;
                
                for (const oKey of OFFSET_KEYS) {
                    if (offsetsToApply[oKey] !== undefined) {
                        this.state[oKey] = offsetsToApply[oKey];
                        this.notify(oKey);
                    }
                }
            }
        }
        
        this.state[key] = value; // Update the actual key's value

        // Only recompute derived values when relevant keys change (preserves behavior, improves perf)
        if (this._derivedKeys.has(key) || key === 'ALL') {
            this.updateDerivedValues();
        }

        this.save();
        this.notify(key);
    }


    /**
     * Resets the application state to its default values.
     */
    reset() {
        // Load the "Trilogy" preset (slot 0) after a factory reset
        // This ensures the desired default configuration is applied consistently.
        this.loadFromSlot(0);
        this._showToast("Configuration Reset", "info");
    }

    /**
     * Saves the current application state to a specific slot.
     * @param {number} index - The index of the slot (0-2).
     */
    saveToSlot(index) {
        if (this.slots[index]) { // Ensure slot exists
            this.slots[index] = {
                name: this.slots[index].name,
                data: this._deepClone(this.state) // Deep clone state
            };
            this.saveSlots();
            this._showToast(`Saved to Slot ${index + 1}: ${this.slots[index].name}`, "success");
        } else {
            console.warn(`Attempted to save to non-existent slot index: ${index}`);
            this._showToast(`Failed to save slot ${index + 1}`, "error");
        }
    }

    /**
     * Loads the application state from a specific slot.
     * @param {number} index - The index of the slot (0-2).
     * @returns {boolean} True if the state was loaded successfully, false otherwise.
     */
    loadFromSlot(index) {
        if (!this.slots[index]?.data) return false; // Use optional chaining for safety

        this.state = { ...this.defaults, ...this.slots[index].data };
        this.updateDerivedValues();
        this.save();
        this.notify('ALL');
        this._showToast(`Loaded Preset: ${this.slots[index].name}`, "success");
        return true;
    }

    /**
     * Renames a specific configuration slot.
     * @param {number} index - The index of the slot (0-2).
     * @param {string} name - The new name for the slot.
     */
    renameSlot(index, name) {
        if (this.slots[index]) { // Ensure slot exists
            this.slots[index].name = name;
            this.saveSlots();
            this._showToast(`Renamed Slot ${index + 1} to "${name}"`, "success");
        } else {
            console.warn(`Attempted to rename non-existent slot index: ${index}`);
            this._showToast(`Failed to rename slot ${index + 1}`, "error");
        }
    }

    /**
     * Subscribes a callback function to configuration changes.
     * @param {Function} callback - The function to call when configuration changes.
     */
    subscribe(callback) {
        if (typeof callback === "function") {
            this.subscribers.push(callback);
        }
    }

    /**
     * Notifies all subscribed listeners about a configuration change.
     * @param {string} key - The key of the changed configuration setting.
     */
    notify(key) {
        // Guard each subscriber to prevent one failing listener from breaking the chain
        for (let i = 0; i < this.subscribers.length; i++) {
            const callback = this.subscribers[i];
            try {
                callback(key, this.state);
            } catch (e) {
                console.warn('Subscriber callback failed:', e);
            }
        }
    }

    /**
     * Updates all derived configuration values based on the current state.
     * These are values calculated from base settings for performance or convenience.
     */
    updateDerivedValues() {
        const s = this.state;
        const cycleDuration = 21 - s.streamSpeed;
        const hFactor = Math.max(0.5, s.horizontalSpacingFactor);
        const vFactor = Math.max(0.5, s.verticalSpacingFactor);
        const rotatorCycleFrames = s.rotatorSyncToTracer
            ? Math.max(1, Math.floor(cycleDuration / s.rotatorSyncMultiplier))
            : Math.max(10, Math.round(60 - s.rotatorCycleFactor * 2.5));

        // Precompute common color conversions only once
        const streamRgb = Utils.hexToRgb(s.streamColor);
        const bgRgb = Utils.hexToRgb(s.backgroundColor);
        const tracerRgb = Utils.hexToRgb(s.tracerColor);

        // Palette conversions done once and reused
        const paletteHexes = (s.streamPalette && s.streamPalette.length > 0)
            ? s.streamPalette
            : [s.streamColor];
        const paletteRgbs = new Array(paletteHexes.length);
        for (let i = 0; i < paletteHexes.length; i++) {
            paletteRgbs[i] = Utils.hexToRgb(paletteHexes[i]);
        }
        const paletteColorsStr = paletteRgbs.map(Utils.createRGBString);
        const paletteColorsUint32 = paletteRgbs.map(c => Utils.packAbgr(c.r, c.g, c.b));

        this.derived = {
            cycleDuration,
            safeAttack: Math.min(Math.max(1, s.tracerAttackFrames), cycleDuration),
            safeRelease: Math.min(s.tracerReleaseFrames, cycleDuration),
            holdFrames: Math.max(0, s.tracerHoldFrames),
            maxState: cycleDuration + Math.max(0, s.tracerHoldFrames) + cycleDuration,
            rotatorCycleFrames,
            cellWidth: s.fontSize * hFactor,
            cellHeight: s.fontSize * vFactor,
            varianceMin: 1.0 - s.brightnessVariance / 100,
            streamRgb,
            bgRgb,
            tracerRgb,
            streamColorStr: Utils.createRGBString(streamRgb),
            paletteRgbs,
            paletteColorsStr,
            paletteColorsUint32,
            streamColorUint32: Utils.packAbgr(streamRgb.r, streamRgb.g, streamRgb.b),
            tracerColorUint32: Utils.packAbgr(tracerRgb.r, tracerRgb.g, tracerRgb.b),
            tracerColorStr: Utils.createRGBString(tracerRgb),
            fontBaseStr: `${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
        };

        // Active Fonts Logic
        const fontSettings = s.fontSettings || {};
        const activeFonts = [];
        for (const name in fontSettings) {
            if (!Object.prototype.hasOwnProperty.call(fontSettings, name)) continue;
            const conf = fontSettings[name];
            if (conf && conf.active) {
                let chars;
                if (conf.useCustomChars) {
                    // Respect user's setting, even if empty (clean slate).
                    // Fallback to " " (space) if effectively empty to prevent simulation errors.
                    const clean = (conf.customCharacters || "").replace(/\s+/g, '');
                    chars = clean.length > 0 ? clean : " ";
                } else {
                    // Use Default
                    chars = Utils.CHARS;
                }
                activeFonts.push({ name, chars });
            }
        }
        
        // Fallback if no fonts are active
        if (activeFonts.length === 0) activeFonts.push({ name: 'MatrixEmbedded', chars: Utils.CHARS });
        
        this.derived.activeFonts = activeFonts;
    }

    /**
     * Sets the NotificationManager instance for toast messages.
     * @param {NotificationManager} notifications 
     */
    setNotificationManager(notifications) {
        this.notifications = notifications;
    }

    /**
     * Helper to show toast messages if NotificationManager is available.
     * @param {string} message 
     * @param {string} type 
     */
    _showToast(message, type = 'info') {
        if (this.notifications) {
            this.notifications.show(message, type);
        }
    }
}
