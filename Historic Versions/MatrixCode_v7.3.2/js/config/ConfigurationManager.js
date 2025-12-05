class ConfigurationManager {
    constructor() {
        this.storageKey = 'matrix_config_v7.3.1';
        this.slotsKey = 'matrix_slots_v7.3.1';
        this.defaults = this._initializeDefaults();

        this.state = { ...this.defaults };
        this.derived = {};
        this.slots = this._loadSlots();
        this.subscribers = [];

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
            // --- GLOBAL ---
            streamColor: "#65d778",
            streamSpeed: 15,
            clearAlpha: 0.9,
            enableBloom: true,
            bloomStrength: 2,
            bloomOpacity: 0.45,
            resolution: 1,
            smoothingEnabled: true,
            smoothingAmount: 0.4,
            stretchX: 1,
            stretchY: 1.1,
            enableGlyphAtlas: true,

            // --- STREAMS ---
            streamSpawnCount: 4,
            eraserSpawnCount: 4,
            releaseInterval: 4,
            minStreamGap: 15,
            minEraserGap: 15,
            holeRate: 0.15,
            ttlMinSeconds: 2,
            ttlMaxSeconds: 5.5,
            decayFadeDurationFrames: 24,
            dissolveEnabled: true,
            dissolveMinSize: 19,
            deteriorationEnabled: true,
            deteriorationType: 'ghost',
            deteriorationStrength: 2,
            invertedTracerEnabled: true,
            invertedTracerChance: 0.1,

            // --- FONT & GLYPHS ---
            fontFamily: 'MatrixEmbedded',
            fontSize: 19,
            fontWeight: 'normal',
            italicEnabled: false,
            mirrorEnabled: false,
            fontOffsetY: 0,
            fontOffsetX: 0,
            horizontalSpacingFactor: 0.7,
            verticalSpacingFactor: 0.95,
            variableBrightnessEnabled: true,
            brightnessVariance: 20,

            // --- MUTATORS (TRACERS) ---
            tracerColor: "#d9f2f2",
            tracerSizeIncrease: 1,
            tracerGlow: 15,
            tracerAttackFrames: 8,
            tracerHoldFrames: 0,
            tracerReleaseFrames: 6,

            // --- MUTATORS (ROTATORS) ---
            rotatorEnabled: true,
            rotatorChance: 0.13,
            rotatorSyncToTracer: true,
            rotatorSyncMultiplier: 0.5,
            rotatorCycleFactor: 11,
            rotatorCrossfadeFrames: 6,

            // --- GLYPH FX ---
            starPowerEnabled: false,
            starPowerFreq: 100,
            starPowerRainbowMode: 'char',
            starPowerColorCycle: false,
            starPowerCycleSpeed: 14,
            starPowerSaturation: 100,
            starPowerIntensity: 51,
            starPowerGlitter: false,

            rainbowStreamEnabled: false,
            rainbowStreamChance: 1,
            rainbowStreamIntensity: 50,

            // --- GLYPH FX (FIREWALL ANOMALY) ---
            firewallEnabled: true,
            firewallFrequencySeconds: 150,
            firewallReverseDurationFrames: 100,
            firewallEraseDurationFrames: 100,

            // --- EVENTS (PULSES) ---
            pulseEnabled: true,
            pulseFrequencySeconds: 220,
            pulseDelayFrames: 60,
            pulseDurationSeconds: 1.8,
            pulsePreserveSpaces: true,
            pulseRandomPosition: true,
            pulseWidth: 130,
            pulseDimming: 0.2,
            pulseIgnoreTracers: true,
            pulseCircular: false,
            pulseBlend: false,
            pulseInstantStart: false,

            clearPulseEnabled: true,
            clearPulseFrequencySeconds: 195,
            clearPulseDurationSeconds: 1,
            clearPulsePreserveSpaces: true,
            clearPulseRandomPosition: true,
            clearPulseWidth: 150,
            clearPulseIgnoreTracers: true,
            clearPulseCircular: true,
            clearPulseBlend: true,
            clearPulseInstantStart: false,

            miniPulseEnabled: true,
            miniPulseFrequencySeconds: 450,
            miniPulseDurationSeconds: 5,
            miniPulseSpawnChance: 0.06,
            miniPulseSize: 140,
            miniPulseThickness: 92,
            miniPulseSpeed: 14,
            miniPulsePreserveSpaces: true,

            dejaVuEnabled: true,
            dejaVuAutoMode: true,
            dejaVuFrequencySeconds: 300,
            dejaVuDurationSeconds: 5,
            dejaVuBarDurationFrames: 30,
            dejaVuVarianceFrames: 60,
            dejaVuIntensity: 0.06,
            dejaVuHoleBrightness: 0.02,
            dejaVuMinRectHeight: 1,
            dejaVuMaxRectHeight: 10,
            dejaVuRandomizeColors: false,

            supermanEnabled: true,
            supermanFrequencySeconds: 375,
            supermanDurationSeconds: 6,
            supermanFlickerRate: 2,
            supermanWidth: 2,
            supermanSpawnSpeed: 75,
            supermanFadeSpeed: 6,
            supermanIncludeColors: true,
            supermanGlow: 4,
            supermanBoltThickness: 5,
            supermanProb: 4
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
        return Array(3).fill(null).map((_, i) => ({ name: `Save Slot ${i + 1}`, data: null }));
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
            const storedState = localStorage.getItem(this.storageKey);
            if (storedState) {
                const parsed = JSON.parse(storedState);
                delete parsed.customFonts; // Remove unsupported keys if present
                this.state = { ...this.defaults, ...parsed };
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

        this.state[key] = value;

        // Maintain consistency between related properties
        if (key === 'streamMinLength') {
            this.state.streamMaxLength = Math.max(this.state.streamMaxLength, value);
        } else if (key === 'streamMaxLength') {
            this.state.streamMinLength = Math.min(this.state.streamMinLength, value);
        }

        this.updateDerivedValues();
        this.save();
        this.notify(key);
    }

    /**
     * Resets the application state to its default values.
     */
    reset() {
        this.state = { ...this.defaults };
        this.updateDerivedValues();
        this.save();
        this.notify('ALL');
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
            tracerColorStr: Utils.createRGBString(Utils.hexToRgb(s.tracerColor)),
            fontBaseStr: `${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
        };
    }
}


    // =========================================================================
    // 3.0 MATRIX GRID
    // =========================================================================
