class ConfigurationManager {
    constructor() {
        this.storageKey = 'matrix_config_v7.6';
        this.slotsKey = 'matrix_slots_v7.6';
        this.defaults = this._initializeDefaults();

        this.state = { ...this.defaults };
        this.derived = {};
        this.slots = this._loadSlots();
        this.subscribers = [];
        this._previousSmoothingEnabled = undefined;
        this._previousSmoothingAmount = undefined;

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
            "streamPalette": [
              "#65d778",
              "#169825",
              "#3fab79"
            ],
            "paletteBias": 0,
            "tracerColor": "#a2ecec",
            "fontSize": 24,
            "streamSpeed": 18,
            "releaseInterval": 4,
            "resolution": 1.6,
            "enableGlyphAtlas": true,
            "smoothingEnabled": true,
            "smoothingAmount": 0.6,
            "showFpsCounter": true,
            "fontFamily": "MatrixEmbedded",
            "fontWeight": "normal",
            "italicEnabled": false,
            "mirrorEnabled": false,
            "variableBrightnessEnabled": true,
            "brightnessVariance": 54,
            "overlapEnabled": true,
            "overlapColor": "#f2df73",
            "overlapDensity": 0.4,
            "overlapTarget": "all",
            "overlapShimmer": false,
            "dissolveEnabled": true,
            "dissolveMinSize": 18,
            "deteriorationEnabled": true,
            "deteriorationStrength": 4,
            "enableBloom": true,
            "bloomStrength": 3,
            "bloomOpacity": 0.8,
            "tracerGlow": 6,
            "clearAlpha": 0.6,
            "horizontalSpacingFactor": 0.8,
            "verticalSpacingFactor": 0.9,
            "fontOffsetX": 0,
            "fontOffsetY": 0,
            "stretchX": 1,
            "stretchY": 1.2,
            "decayFadeDurationFrames": 70,
            "streamSpawnCount": 5,
            "eraserSpawnCount": 6,
            "minStreamGap": 10,
            "minEraserGap": 15,
            "holeRate": 0,
            "desyncIntensity": 0,
            "eraserStopChance": 0,
            "tracerStopChance": 1,
            "tracerAttackFrames": 3,
            "tracerHoldFrames": 0,
            "tracerReleaseFrames": 5,
            "invertedTracerEnabled": false,
            "invertedTracerChance": 0.1,
            "rotatorEnabled": true,
            "rotatorChance": 0.13,
            "rotatorSyncToTracer": true,
            "rotatorSyncMultiplier": 0.3,
            "rotatorCycleFactor": 17,
            "rotatorCrossfadeFrames": 4,
            "shaderEnabled": true,
            "customShader": `/**
 * Film Grain Shader for Matrix Digital Rain
 * 
 * Features:
 * - Adds dynamic film grain noise
 * - Animated over time
 * - Respects texture orientation
 */

precision mediump float;

// Uniforms provided by PostProcessor.js
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;

// Use vTexCoord from Vertex Shader for correct orientation
varying vec2 vTexCoord;

// Shader Configuration
const float GRAIN_AMOUNT = 0.05; // Intensity of the grain (0.0 to 1.0)
const bool ANIMATED = true;      // Whether the grain dances (true) or is static (false)
const float SPEED = 2.5;         // Speed of grain animation

// Random function
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // Sample the original texture using standard texture coordinates
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // Calculate noise
    // We can use gl_FragCoord or vTexCoord for noise seed
    float t = ANIMATED ? uTime * SPEED : 0.0;
    
    // Generate random noise value [-1.0, 1.0]
    float noise = (random(vTexCoord + t) - 0.5) * 2.0;
    
    // Apply grain
    color.rgb += noise * GRAIN_AMOUNT;
    
    // Output final color
    gl_FragColor = color;
}
`,
            "pulseEnabled": false,
            "pulseFrequencySeconds": 300,
            "pulseDurationSeconds": 1.8,
            "pulsePreserveSpaces": true,
            "pulseIgnoreTracers": true,
            "pulseDimming": 0.2,
            "pulseBlend": false,
            "pulseWidth": 130,
            "pulseRandomPosition": true,
            "pulseInstantStart": false,
            "pulseCircular": false,
            "clearPulseEnabled": false,
            "clearPulseFrequencySeconds": 235,
            "clearPulseDurationSeconds": 1,
            "clearPulsePreserveSpaces": true,
            "clearPulseBlend": false,
            "clearPulseWidth": 280,
            "clearPulseRandomPosition": true,
            "clearPulseInstantStart": false,
            "clearPulseCircular": false,
            "miniPulseEnabled": false,
            "miniPulseFrequencySeconds": 450,
            "miniPulseDurationSeconds": 5,
            "miniPulsePreserveSpaces": true,
            "miniPulseThickness": 100,
            "miniPulseSpawnChance": 0.06,
            "miniPulseSpeed": 16,
            "miniPulseSize": 360,
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
            "supermanIncludeColors": true,
            "supermanFadeSpeed": 6,
            "supermanGlow": 4,
            "supermanBoltThickness": 5,
            "supermanFlickerRate": 2,
            "supermanWidth": 4,
            "supermanSpawnSpeed": 69,
            "starPowerEnabled": false,
            "starPowerRainbowMode": "char",
            "starPowerSaturation": 100,
            "starPowerIntensity": 51,
            "starPowerGlitter": false,
            "starPowerColorCycle": true,
            "starPowerCycleSpeed": 5,
            "rainbowStreamEnabled": false,
            "rainbowStreamChance": 1,
            "rainbowStreamIntensity": 50,
            "firewallEnabled": false,
            "firewallFrequencySeconds": 150,
            "firewallRandomColorEnabled": true,
            "firewallColor": "#00ff00",
            "firewallReverseDurationFrames": 20,
            "firewallEraseDurationFrames": 50,
            "bootSequenceEnabled": false,
            "crashEnabled": false,
            "crashFrequencySeconds": 600,
            "runBothInOrder": true,
            "keyBindings": {
              "Pulse": "q",
              "ClearPulse": "w",
              "MiniPulse": "e",
              "DejaVu": "r",
              "Superman": "t",
              "Firewall": "y",
              "ToggleUI": "h",
              "BootSequence": "b",
              "CrashSequence": "x",
              "BootCrashSequence": "c"
            },
            "hideMenuIcon": true,
            "fontSettings": {
              "MatrixEmbedded": {
                "active": false,
                "useCustomChars": false,
                "customCharacters": ""
              },
              "CustomFont_5e2697679380fc43": {
                "active": true,
                "useCustomChars": true,
                "customCharacters": "~}|{z!\"#$%&'()*43210.-,+56789:;<=>HGFEDCBA@?IJKLMNOPQR\\[ZYXWVUTS]^_`abcdefpoyxnmwvlkutjisrhgq/"
              }
            },
            "deteriorationType": "ghost",
            "tracerSizeIncrease": 1,
            "supermanProb": 4,
            "dejaVuAutoMode": true,
            "clearPulseIgnoreTracers": true,
            "clearPulseCircular": false,
            "clearPulseInstantStart": false,
            "dejaVuPerformanceMode": false,
            "pulseDelayFrames": 60,
            "overlapShimmer": false,
            "minGapTypes": 20,
            "rotateDuringFade": false,
            "rotatorDesyncEnabled": false,
            "rotatorDesyncVariance": 0,
            "suppressToasts": false,
            "ttlMinSeconds": 1,
            "ttlMaxSeconds": 8
          };
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
            { name: "Trilogy", data: JSON.parse(JSON.stringify(this.defaults)) },
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
                if (storedState) {
                    // console.log("Migrating configuration from v7.5");
                    // Optionally notify user here, but we can't access notifications yet.
                }
            }

            if (storedState) {
                const parsed = JSON.parse(storedState);
                delete parsed.customFonts; // Remove unsupported keys if present
                this.state = { ...this.defaults, ...parsed };
                
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
            localStorage.setItem(this.storageKey, JSON.stringify(this.state));
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
        
        this.state[key] = value; // Update the actual key's value

        this.updateDerivedValues();
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
                data: JSON.parse(JSON.stringify(this.state)) // Deep clone state
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
        this.subscribers.forEach((callback) => callback(key, this.state));
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
            streamRgb: Utils.hexToRgb(s.streamColor),
            tracerRgb: Utils.hexToRgb(s.tracerColor),
            streamColorStr: Utils.createRGBString(Utils.hexToRgb(s.streamColor)),
            paletteRgbs: (s.streamPalette || [s.streamColor]).map(c => Utils.hexToRgb(c)),
            paletteColorsStr: (s.streamPalette || [s.streamColor]).map(c => Utils.createRGBString(Utils.hexToRgb(c))),
            tracerColorStr: Utils.createRGBString(Utils.hexToRgb(s.tracerColor)),
            fontBaseStr: `${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
        };

        // Active Fonts Logic
        const fontSettings = s.fontSettings || {};
        const activeFonts = [];
        for (const [name, conf] of Object.entries(fontSettings)) {
            if (conf.active) {
                let chars = Utils.CHARS;
                if (conf.useCustomChars && conf.customCharacters) {
                    const clean = conf.customCharacters.replace(/\s+/g, '');
                    if (clean.length > 0) chars = clean;
                }
                activeFonts.push({ name, chars });
            }
        }
        if (activeFonts.length === 0) activeFonts.push({ name: 'MatrixEmbedded', chars: Utils.CHARS });
        
        this.derived.activeFonts = activeFonts;
    }
}


    // =========================================================================
    // 3.0 MATRIX GRID
    // =========================================================================
