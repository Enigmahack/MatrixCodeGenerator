
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
            "customShader": `
// Name: CRT Monitor

precision mediump float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uParameter;
varying vec2 vTexCoord;

// Change this value to make the lines denser!
// It represents the WIDTH/HEIGHT of one grid cell in pixels.
const float GRID_CELL_SIZE = 2.0; // Lower numbers = lines closer together, but line thickness is proportional
const float LINE_THICKNESS = 0.3;
const vec3 GRID_COLOR = vec3(0.0, 0.0, 0.0);
const float GRID_OPACITY = 0.5;

// CRT Color Shift (Chromatic Aberration) Settings
const float SHIFT_AMOUNT = 0.01;       // Magnitude of the color fringe (very small)

// Brightness Boost (Thresholding/Glow) Settings
const float BRIGHTNESS_THRESHOLD = 0.3;  // Only pixels brighter than this will be boosted
const float BRIGHTNESS_BOOST = 1.6;      // How much to multiply bright colors by

// --- Barrel Distortion Settings ---
const float BARREL_DISTORTION_AMOUNT = 1.0; // Controls the bulge magnitude (0.0 to 1.0)

void main() {
    
    // --- 1. CRT Barrel Distortion (Warp) ---
    
    // A. Center coordinates: shifts vTexCoord from [0.0, 1.0] to [-0.5, 0.5]
    vec2 centeredCoord = vTexCoord - 0.5;
    
    // B. Calculate distance squared from center
    // The distortion effect should be stronger in the corners than in the middle.
    // dot(v, v) is a fast way to get length squared (r*r).
    float r2 = dot(centeredCoord, centeredCoord); 
    
    // C. Calculate the distortion factor
    // The factor must be > 1.0 for a convex (bulging) look. 
    // It's calculated by adding a fraction of the distance (r2) to 1.0.
    float factor = 1.0 + r2 * (BARREL_DISTORTION_AMOUNT * uParameter * 0.25);

    // D. Apply the factor and shift back to 0.0-1.0 range
    // This coordinate will be our base for sampling the warped image.
    vec2 warpedTexCoord = centeredCoord * factor + 0.5;

    // --- Boundary Check ---
    // If the warped coordinate is outside [0.0, 1.0], it's smeared/clipped.
    // The 'any' function checks if any component (x or y) of the boolean vector is true.
    if (any(lessThan(warpedTexCoord, vec2(0.0))) || any(greaterThan(warpedTexCoord, vec2(1.0)))) {
        // If the coordinate is outside the bounds, output black (or transparent)
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return; // Exit the shader immediately to skip all further calculations
    }

    // --- 2. CRT Chromatic Shift (Red/Blue Fringing) ---
    
    // The centerBias calculation remains based on the original vTexCoord 
    // to keep the color shift aligned with the screen's surface.
    vec2 pixelCoord = vTexCoord * uResolution.xy;
    vec2 scaledCoord = pixelCoord / GRID_CELL_SIZE;
    vec2 fractionalPart = fract(scaledCoord);
    
    float centerBias = fractionalPart.x - 0.5; 
    float shiftMagnitude = sin(centerBias * 3.14159265); 

    // Sample the texture three times using the **warpedTexCoord** as the base
    vec2 redCoord   = warpedTexCoord + vec2(-shiftMagnitude * SHIFT_AMOUNT * uParameter, 0.0);
    vec2 blueCoord  = warpedTexCoord + vec2( shiftMagnitude * SHIFT_AMOUNT * uParameter, 0.0);
    
    // Use the base warped coordinate for the green channel
    float red   = texture2D(uTexture, redCoord).r;
    float green = texture2D(uTexture, warpedTexCoord).g; 
    float blue  = texture2D(uTexture, blueCoord).b;
    
    vec4 finalColor = vec4(red, green, blue, 1.0);

    // --- 3. Static Grid Overlay ---

    // The grid lines are calculated using the original screen coordinate (vTexCoord)
    // which simulates the grid being painted onto the curved glass.
    float verticalLine = step(fractionalPart.x, LINE_THICKNESS);
    float horizontalLine = step(fractionalPart.y, LINE_THICKNESS);
    float gridMask = min(verticalLine + horizontalLine, 1.0);

    // Apply the grid
    vec3 blendedColor = mix(finalColor.rgb, GRID_COLOR, gridMask);
    finalColor.rgb = mix(finalColor.rgb, blendedColor, GRID_OPACITY);


    // --- 4. Brightness Boost (Thresholding/Glow Effect) ---

    float brightness = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float boostFactor = step(BRIGHTNESS_THRESHOLD, brightness);
    float finalMultiplier = mix(1.0, BRIGHTNESS_BOOST, boostFactor);
    finalColor.rgb *= finalMultiplier;

    
    // 5. Output Final Color
    gl_FragColor = finalColor;
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
                "customCharacters": "~}|{z!\"#$%&amp;'()*43210.-,+56789:;&lt;=&gt;HGFEDCBA@?IJKLMNOPQR\\[ZYXWVUTS]^_`abcdefpoyxnmwvlkutjisrhgq/"
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
                if (storedState) {
                    // console.log("Migrating configuration from v7.5");
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
            tracerRgb,
            streamColorStr: Utils.createRGBString(streamRgb),
            paletteRgbs,
            paletteColorsStr,
            tracerColorStr: Utils.createRGBString(tracerRgb),
            fontBaseStr: `${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
        };

        // Active Fonts Logic (avoid allocations where possible)
        const fontSettings = s.fontSettings || {};
        const activeFonts = [];
        for (const name in fontSettings) {
            if (!Object.prototype.hasOwnProperty.call(fontSettings, name)) continue;
            const conf = fontSettings[name];
            if (conf && conf.active) {
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
