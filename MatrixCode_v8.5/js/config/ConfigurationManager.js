
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
            'keyBindings',
            'hideMenuIcon',
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
            "backgroundColor": "#000000",
            "streamPalette": [
              "#0de761",
              "#1fd64d",
              "#19b81c"
            ],
            "paletteBias": 0,
            "colorMixType": 0.45,
            "tracerColor": "#c2f5f5",
            "fontSize": 24,
            "streamSpeed": 16,
            "releaseInterval": 3,
            "resolution": 0.8,
            "enableGlyphAtlas": true,
            "smoothingEnabled": false,
            "smoothingAmount": 0.1,
            "showFpsCounter": true,
            "debugEnabled": false,
            "fontFamily": "MatrixEmbedded",
            "fontWeight": "normal",
            "italicEnabled": false,
            "mirrorEnabled": false,
            "variableBrightnessEnabled": true,
            "brightnessVariance": 20,
            "overlapEnabled": false,
            "overlapColor": "#FFD700",
            "overlapDensity": 0.2,
            "overlapTarget": "all",
            "overlapShimmer": false,
            "dissolveEnabled": true,
            "dissolveScalePercent": -20,
            "deteriorationEnabled": true,
            "deteriorationStrength": 4,
            "enableBloom": true,
            "bloomStrength": 1,
            "bloomOpacity": 0.25,
            "tracerGlow": 5,
            "clearAlpha": 0.82,
            "horizontalSpacingFactor": 0.7,
            "verticalSpacingFactor": 1,
            "fontOffsetX": 0,
            "fontOffsetY": 0,
            "stretchX": 1,
            "stretchY": 1.1,
            "decayFadeDurationFrames": 24,
            "streamSpawnCount": 2,
            "eraserSpawnCount": 2,
            "minStreamGap": 30,
            "minEraserGap": 30,
            "minGapTypes": 29,
            "allowTinyStreams": true,
            "gradualColorStreams": false,
            "holeRate": 0.1,
            "desyncIntensity": 0,
            "preferClusters": true,
            "eraserStopChance": 1,
            "tracerStopChance": 1,
            "tracerAttackFrames": 4,
            "tracerHoldFrames": 0,
            "tracerReleaseFrames": 4,
            "invertedTracerEnabled": true,
            "invertedTracerChance": 0.1,
                                            "upwardTracerEnabled": false,
                                            "upwardTracerChance": 0.02,
                                            "upwardTracerAttackFrames": 2,
                                            "upwardTracerHoldFrames": 10,
                                            "upwardTracerReleaseFrames": 10,
                                            "upwardTracerGlow": 8.0,                                "upwardTracerSpeedMult": 1.0,
                                "upwardTracerGlimmerSpeed": 2.0,            "upwardTracerGlimmerSize": 3, // Grid Size (2x2 to 6x6)
            "upwardTracerGlimmerFill": 3, // Number of blocks to light up
            "upwardTracerGlimmerGlow": 10.0,
            
            "rotatorEnabled": true,
            "rotatorChance": 0.13,
            "rotatorSyncToTracer": true,
            "rotatorSyncMultiplier": 0.5,
            "rotatorCycleFactor": 20,
            "rotatorCrossfadeFrames": 5,
            "rotateDuringFade": false,
            "rotatorDesyncEnabled": false,
            "rotatorDesyncVariance": 0,
            "shaderEnabled": false,
            "customShader": null,
            "effectShader": null,
            "shaderParameter": 0.39,
            "effectParameter": 0,
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
            "starPowerGlitter": true,
            "starPowerColorCycle": true,
            "starPowerCycleSpeed": 3,
            "rainbowStreamEnabled": false,
            "rainbowStreamChance": 0.5,
            "rainbowStreamIntensity": 50,
            "bootSequenceEnabled": false,
            "crashEnabled": true,
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
            "keyBindings": {
              "Pulse": "p",
              "ClearPulse": "w",
              "MiniPulse": "e",
              "DejaVu": "r",
              "Superman": "t",
              "ToggleUI": " ",
              "BootSequence": "b",
              "CrashSequence": "x",
              "BootCrashSequence": "c",
              "ReverseTime": "u"
            },
            "hideMenuIcon": true,
            "fontSettings": {
              "MatrixEmbedded": {
                "active": true,
                "useCustomChars": false,
                "customCharacters": ""
              }
            },
            "deteriorationType": "ghost",
            "tracerSizeIncrease": 1,
            "supermanProb": 4,
            "dejaVuAutoMode": true,
            "clearPulseIgnoreTracers": true,
            "dejaVuPerformanceMode": false,
            "pulseDelayFrames": 60,
            "suppressToasts": false,
            "ttlMinSeconds": 1,
            "ttlMaxSeconds": 8,
            "supermanIncludeColors": true,
            "renderingEngine": "canvas",
            "dissolveMinSize": 19,
            "crashMovieFps": true
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
        try {
            const storedSlots = localStorage.getItem(this.slotsKey);
            if (storedSlots) {
                return JSON.parse(storedSlots);
            }
        } catch (e) {
            console.warn('Failed to load slots:', e);
        }

        // Default slots if not found or error occurs
        return [
            { name: "Trilogy", data: this._deepClone(this.defaults) },
            {
                name: "Neo Code",
                data: {
                    "streamColor": "#65d778",
                    "streamPalette": ["#1cc427", "#20a73b", "#5ddf3a"],
                    "tracerColor": "#aadaa9",
                    "fontSize": 17,
                    "streamSpeed": 15,
                    "releaseInterval": 1,
                    "resolution": 1,
                    "fontFamily": "CustomFont_5e2697679380fc43",
                    "variableBrightnessEnabled": false,
                    "brightnessVariance": 0,
                    "overlapEnabled": false,
                    "dissolveScalePercent": -4,
                    "deteriorationStrength": 2,
                    "bloomStrength": 3,
                    "bloomOpacity": 0.75,
                    "tracerGlow": 17,
                    "clearAlpha": 0.34,
                    "horizontalSpacingFactor": 0.85,
                    "verticalSpacingFactor": 0.95,
                    "stretchX": 0.9,
                    "stretchY": 0.9,
                    "decayFadeDurationFrames": 126,
                    "streamSpawnCount": 1,
                    "eraserSpawnCount": 5,
                    "minStreamGap": 6,
                    "minEraserGap": 6,
                    "minGapTypes": 1,
                    "holeRate": 0,
                    "desyncIntensity": 0.2,
                    "eraserStopChance": 0,
                    "tracerStopChance": 0,
                    "tracerAttackFrames": 2,
                    "tracerHoldFrames": 0,
                    "tracerReleaseFrames": 7,
                    "invertedTracerEnabled": false,
                    "rotatorEnabled": true,
                    "rotatorChance": 1,
                    "rotatorSyncToTracer": true,
                    "rotatorSyncMultiplier": 0.1,
                    "rotatorCycleFactor": 20,
                    "rotatorCrossfadeFrames": 2,
                    "rotateDuringFade": true,
                    "rotatorDesyncEnabled": true,
                    "rotatorDesyncVariance": 60,
                    "shaderEnabled": false,
                    "shaderParameter": 0.94,
                    "fontSettings": {
                        "MatrixEmbedded": { "active": false },
                        "CustomFont_5e2697679380fc43": {
                            "active": true,
                            "useCustomChars": true,
                            "customCharacters": "'()*+-./0123456789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZ\\^_`cfgnt!\"#$%&,;?@[]abmxlkjihedopqrsuvw~}{zy",
                            "useAllChars": false
                        }
                    }
                }
            },
            {
                name: "Trinity Code",
                data: {
                    "streamColor": "#65d778",
                    "streamPalette": ["#3eea88", "#37e68c"],
                    "tracerColor": "#aadaa9",
                    "fontSize": 24,
                    "streamSpeed": 16,
                    "releaseInterval": 1,
                    "resolution": 1,
                    "fontFamily": "CustomFont_5e2697679380fc43",
                    "variableBrightnessEnabled": true,
                    "brightnessVariance": 69,
                    "overlapEnabled": true,
                    "overlapColor": "#f4df57",
                    "overlapDensity": 0.3,
                    "overlapTarget": "stream",
                    "dissolveScalePercent": -4,
                    "deteriorationStrength": 3,
                    "bloomStrength": 2,
                    "bloomOpacity": 0.9,
                    "tracerGlow": 10,
                    "clearAlpha": 0.34,
                    "horizontalSpacingFactor": 0.85,
                    "verticalSpacingFactor": 0.95,
                    "stretchX": 0.9,
                    "stretchY": 0.9,
                    "decayFadeDurationFrames": 126,
                    "streamSpawnCount": 1,
                    "eraserSpawnCount": 4,
                    "minStreamGap": 2,
                    "minEraserGap": 2,
                    "minGapTypes": 1,
                    "holeRate": 0,
                    "desyncIntensity": 0.15,
                    "eraserStopChance": 0,
                    "tracerStopChance": 0,
                    "tracerAttackFrames": 2,
                    "tracerHoldFrames": 0,
                    "tracerReleaseFrames": 5,
                    "invertedTracerEnabled": false,
                    "rotatorEnabled": true,
                    "rotatorChance": 1,
                    "rotatorSyncToTracer": true,
                    "rotatorSyncMultiplier": 0.1,
                    "rotatorCycleFactor": 20,
                    "rotatorCrossfadeFrames": 2,
                    "rotateDuringFade": true,
                    "rotatorDesyncEnabled": true,
                    "rotatorDesyncVariance": 60,
                    "shaderEnabled": true,
                    "customShader": "// Name: Static Grain\nprecision mediump float;\nuniform sampler2D uTexture;\nuniform float uParameter;\nvarying vec2 vTexCoord;\nconst float GRAIN_AMOUNT = 0.05;\nfloat random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }\nvoid main() {\n    vec4 color = texture2D(uTexture, vTexCoord);\n    float noiseValue = random(vTexCoord);\n    float finalNoise = (noiseValue - 0.5) * 2.0;\n    color.rgb += finalNoise * (uParameter * 0.5);\n    gl_FragColor = color;\n}",
                    "shaderParameter": 0.16,
                    "fontSettings": {
                        "MatrixEmbedded": { "active": false },
                        "CustomFont_5e2697679380fc43": {
                            "active": true,
                            "useCustomChars": true,
                            "customCharacters": "'()*+-./0123456789:<=>ABCDEFGHIJKLMNOPQRSTUVWXYZ\\^_`cfgnt!\"#$%&,;?@[]abmxlkjihedopqrsuvw~}{zy",
                            "useAllChars": false
                        }
                    }
                }
            }
        ];
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
                // We'll mutate deeper objects but clone the top level to be safe/clean
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
        // The loadFromSlot method already calls updateDerivedValues(), save(), and notify('ALL')
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
        } else {
            console.warn(`Attempted to save to non-existent slot index: ${index}`);
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
        } else {
            console.warn(`Attempted to rename non-existent slot index: ${index}`);
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
}


// =========================================================================
// 3.0 MATRIX GRID
// =========================================================================
