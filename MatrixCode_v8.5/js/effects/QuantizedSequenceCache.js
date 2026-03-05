class QuantizedSequenceCache {
    constructor() {
        this.cache = new Map(); // Key: Config String, Value: Array of Sequences
        this.maxCacheSize = 3; 
        this.generating = new Set(); // Keys currently being generated
        this.config = null;
        this.cols = 0;
        this.rows = 0;
    }

    init(config, cols, rows) {
        this.config = config;
        this.cols = cols;
        this.rows = rows;

        // Flush cache when generation settings change
        this.config.subscribe((key) => {
            if (key.startsWith('quantizedGenerateV2')) {
                if (this.config.state.logErrors) console.log("QuantizedSequenceCache: Settings changed, flushing cache.");
                this.clear();
            }
        });
    }

    get(configKey) {
        const sequences = this.cache.get(configKey);
        if (sequences && sequences.length > 0) {
            const seq = sequences.shift();
            // Start regenerating next one in background
            this.ensureReady(configKey);
            return seq;
        }
        return null;
    }

    ensureReady(configKey) {
        if (this.generating.has(configKey)) return;
        
        const sequences = this.cache.get(configKey) || [];
        if (sequences.length < this.maxCacheSize) {
            this.generateInBackground(configKey);
        }
    }

    generateInBackground(configKey) {
        if (this.generating.has(configKey)) return;
        this.generating.add(configKey);

        // Low priority background generation
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => this._doGenerate(configKey));
        } else {
            setTimeout(() => this._doGenerate(configKey), 100);
        }
    }

    _doGenerate(configKey) {
        const startTime = performance.now();
        try {
            if (this.config.state.logErrors) console.log(`QuantizedSequenceCache: Generating background sequence for ${configKey}`);
            const generator = new QuantizedSequenceGeneratorV2(this.cols, this.rows, this.config.state);
            const sequence = generator.generate(500); // Max 500 steps

            if (!this.cache.has(configKey)) {
                this.cache.set(configKey, []);
            }
            this.cache.get(configKey).push(sequence);
            
            if (this.config.state.logErrors) {
                const duration = (performance.now() - startTime).toFixed(2);
                console.log(`QuantizedSequenceCache: Cached sequence for ${configKey}. Pool size: ${this.cache.get(configKey).length}. Took ${duration}ms`);
            }
        } catch (e) {
            console.error("QuantizedSequenceCache: Background generation failed", e);
        } finally {
            this.generating.delete(configKey);
            // If still low, schedule next
            this.ensureReady(configKey);
        }
    }

    has(configKey) {
        const sequences = this.cache.get(configKey);
        return sequences && sequences.length > 0;
    }

    clear() {
        this.cache.clear();
        this.generating.clear();
    }

    generateConfigKey(prefix) {
        // Only include settings that affect generation logic
        const keys = [
            'LayerCount', 'QuadrantCount', 'GenerativeScaling', 'RandomStart', 'SpineBoost',
            'NudgeEnabled', 'NudgeChance', 'MaxNudgeStrips', 'NudgeSpacing', 'NudgeAxisBias',
            'InvisibleEnabled', 'InvisibleL2Chance', 'InvisibleL3Chance', 'MaxInvisibleL2Strips',
            'MaxInvisibleL3Strips', 'InvisibleL2Spacing', 'InvisibleL3Spacing',
            'L3FlickerChance', 'L3QuadrantWipeEnabled', 'FillThreshold', 'MaxBlockScale',
            'InsideOutEnabled', 'InsideOutDelay', 'InsideOutPeriod', 'IntersectionPause',
            'IntersectionPauseChance', 'Speed', 'BlockWidthCells', 'BlockHeightCells'
        ];

        let str = prefix;
        for (const k of keys) {
            const val = this.config.get(prefix + k);
            str += `|${k}:${val}`;
        }
        // Also include screen dimensions as they affect edge detection
        str += `|res:${this.cols}x${this.rows}`;
        return str;
    }
}

// Global Instance
window.sequenceCache = new QuantizedSequenceCache();
