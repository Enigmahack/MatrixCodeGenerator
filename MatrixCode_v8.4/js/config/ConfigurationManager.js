
class ConfigurationManager {
    constructor() {
        this.storageKey = 'matrix_config_v8.4';
        this.slotsKey = 'matrix_slots_v8.4';
        this.defaults = this._initializeDefaults();

        this.state = { ...this.defaults };
        this.derived = {};
        this.slots = this._loadSlots();
        this.subscribers = [];
        this._previousSmoothingEnabled = undefined;
        this._previousSmoothingAmount = undefined;

        // Define keys that are shared across all profiles (Global Settings)
        this.SHARED_KEYS = new Set([
            'renderMode3D', // The switcher itself
            'showFpsCounter',
            'debugEnabled',
            'keyBindings',
            'hideMenuIcon',
            'suppressToasts',
            'renderingEngine',
            // 'savedPresets' is handled by this.slots
        ]);

        // Initialize Profiles
        this.profiles = {
            '2D': {},
            '3D': {}
        };

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
                    "upwardTracerGlow": 8.0,
            "upwardTracerSpeedMult": 1.0,
            "upwardTracerGlimmerChance": 0.5,
            "upwardTracerGlimmerSpeed": 2.0,
            "upwardTracerGlimmerSize": 0.4, // Portion of character to illuminate
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
            "firewallEnabled": false,
            "firewallFrequencySeconds": 150,
            "firewallRandomColorEnabled": true,
            "firewallColor": "#00ff00",
            "firewallReverseDurationFrames": 20,
            "firewallEraseDurationFrames": 50,
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
              "Firewall": "y",
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
            "renderMode3D": false,
            "flySpeed": 15.0,
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
            { name: "Save Slot 2", data: null },
            { name: "Save Slot 3", data: null }
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
                    this.profiles = parsed.profiles;
                    this.state = { ...this.defaults, ...parsed.state };
                } else {
                    // Migration: Treat existing flat state as the initial state for BOTH profiles
                    // This ensures a smooth transition without losing settings
                    const migrated = { ...this.defaults, ...parsed };
                    
                    // Populate initial profiles with migrated data (filtering out non-specifics is optional but cleaner)
                    // For safety, we clone the full migrated state into both.
                    this.profiles['2D'] = this._deepClone(migrated);
                    this.profiles['3D'] = this._deepClone(migrated);
                    
                    this.state = migrated;
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
                // First run: Clone defaults to profiles
                this.profiles['2D'] = this._deepClone(this.defaults);
                this.profiles['3D'] = this._deepClone(this.defaults);
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
            // Save state AND profiles
            const data = {
                state: this.state,
                profiles: this.profiles
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

        // Special handling for renderMode3D (Profile Switching)
        if (key === 'renderMode3D') {
            this._handleModeSwitch(value);
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

        // Sync with Current Profile if Specific
        if (!this.SHARED_KEYS.has(key)) {
            const currentMode = (this.state.renderMode3D === true || this.state.renderMode3D === 'true') ? '3D' : '2D';
            this.profiles[currentMode][key] = value;
        }

        // Only recompute derived values when relevant keys change (preserves behavior, improves perf)
        if (this._derivedKeys.has(key) || key === 'ALL') {
            this.updateDerivedValues();
        }

        this.save();
        this.notify(key);
    }

    /**
     * Handles switching between 2D and 3D profiles.
     * @private
     * @param {boolean|string} newModeValue - The new value for renderMode3D.
     */
    _handleModeSwitch(newModeValue) {
        const isNew3D = (newModeValue === true || newModeValue === 'true');
        const isOld3D = (this.state.renderMode3D === true || this.state.renderMode3D === 'true');
        
        if (isNew3D === isOld3D) return;

        const oldMode = isOld3D ? '3D' : '2D';
        const newMode = isNew3D ? '3D' : '2D';

        // 1. Save current specific settings to Old Profile
        // (This is redundant if we sync on set(), but safe for bulk changes or init)
        for (const k in this.state) {
            if (!this.SHARED_KEYS.has(k)) {
                this.profiles[oldMode][k] = this.state[k];
            }
        }

        // 2. Load settings from New Profile
        const targetProfile = this.profiles[newMode];
        // Merge target profile into state, but respect Shared Keys (don't overwrite them from profile if they exist there by mistake)
        // Actually, we overwrite specific keys in state with profile keys.
        // If a key is missing in profile (e.g. new feature), we keep current state or default?
        // Let's assume profile has valid data or fallback to current state.
        
        for (const k in targetProfile) {
            if (!this.SHARED_KEYS.has(k)) {
                this.state[k] = targetProfile[k];
            }
        }

        // 3. Update the switch itself
        this.state.renderMode3D = newModeValue;

        // 4. Finalize
        this.updateDerivedValues();
        this.save();
        this.notify('ALL'); // Trigger full UI and Renderer refresh
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
