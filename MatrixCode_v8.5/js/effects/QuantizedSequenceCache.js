class QuantizedSequenceCache {
    constructor() {
        this.cache = new Map(); // Key: Config String, Value: Array of Sequences
        this.maxCacheSize = 3; 
        this.generating = new Set(); // Keys currently being generated
        this.config = null;
        this.cols = 0;
        this.rows = 0;
        this._cachedKey = null;
        this._cachedKeyConfig = "";
        this._activeGenerator = null;
    }

    init(config, cols, rows) {
        this.config = config;
        this.cols = cols;
        this.rows = rows;

        console.log(`[QuantizedSequenceCache] Initialized with ${cols}x${rows}`);

        // Flush cache when generation settings change
        this.config.subscribe((key) => {
            if (key.startsWith('quantized')) {
                this._cachedKey = null; // Invalidate key cache
                
                if (key.endsWith('EnableAnimationCache')) {
                    if (this.config.get(key)) {
                        console.log("[QuantizedSequenceCache] Cache toggled ON. Starting fill.");
                        this.ensureReady(this.generateConfigKey('quantizedGenerateV2'));
                    } else {
                        console.log("[QuantizedSequenceCache] Cache toggled OFF. Clearing pool.");
                        this.clear();
                    }
                } else {
                    // Potential logical setting change (Specific or Default)
                    console.log(`[QuantizedSequenceCache] Settings changed (${key}), flushing cache.`);
                    this.clear();
                    this.ensureReady(this.generateConfigKey('quantizedGenerateV2'));
                }
            }
        });

        // Proactive initialization
        setTimeout(() => {
            if (this.config.get('quantizedGenerateV2EnableAnimationCache')) {
                console.log("[QuantizedSequenceCache] Startup proactive fill check...");
                this.ensureReady(this.generateConfigKey('quantizedGenerateV2'));
            }
        }, 3000); 

        // Idle Refill Loop: Periodically check if we need to refill when system is idle
        setInterval(() => {
            if (this.config.get('quantizedGenerateV2EnableAnimationCache')) {
                const configKey = this.generateConfigKey('quantizedGenerateV2');
                if (!this.isFull(configKey) && !this.generating.has(configKey)) {
                    this.ensureReady(configKey);
                }
            }
        }, 15000); // Check every 15s
    }

    updateDimensions(cols, rows) {
        if (this.cols !== cols || this.rows !== rows) {
            console.log(`[QuantizedSequenceCache] Resized: ${this.cols}x${this.rows} -> ${cols}x${rows}. flushing cache.`);
            this.cols = cols;
            this.rows = rows;
            this._cachedKey = null;
            this.clear();
            if (this.config.get('quantizedGenerateV2EnableAnimationCache')) {
                this.ensureReady(this.generateConfigKey('quantizedGenerateV2'));
            }
        }
    }

    get(configKey, autoRefill = false) {
        const sequences = this.cache.get(configKey);
        if (sequences && sequences.length > 0) {
            const seq = sequences.shift();
            console.log(`[QuantizedSequenceCache] Serving cached sequence. Pool remaining: ${sequences.length}`);
            if (autoRefill) {
                this.ensureReady(configKey);
            }
            return seq;
        }
        return null;
    }

    isFull(configKey) {
        const sequences = this.cache.get(configKey);
        return sequences && sequences.length >= this.maxCacheSize;
    }

    isAnyEffectActive() {
        if (!window.matrix || !window.matrix.effectRegistry) return false;
        const active = window.matrix.effectRegistry.getActiveEffects();
        // Ignore the BootSequence for cache purposes after first 5 seconds
        const filtered = active.filter(e => {
            if (e.name === "BootSequence" && performance.now() - e.startTime > 5000) return false;
            return true;
        });
        return filtered.length > 0;
    }

    ensureReady(configKey) {
        const prefix = configKey.split('|')[0];
        if (!this.config.state[prefix + 'EnableAnimationCache'] || this.isAnyEffectActive()) {
            // If we have an active generator, we keep it but stop scheduling chunks
            if (this.generating.has(configKey)) {
                console.log("[QuantizedSequenceCache] Effect active. Suspending background generation.");
                this.generating.delete(configKey);
            }
            return;
        }

        if (this.generating.has(configKey)) return;
        if (this.isFull(configKey)) return;

        // Resume or Start new
        if (this._activeGenerator && this._activeGenerator.configKey === configKey) {
            console.log("[QuantizedSequenceCache] Resuming suspended generation...");
            this.generating.add(configKey);
            this._scheduleChunk(configKey);
        } else {
            this.generateInBackground(configKey);
        }
    }

    generateInBackground(configKey) {
        if (this.generating.has(configKey)) return;
        console.log(`[QuantizedSequenceCache] Starting background fill for ${configKey.split('|')[0]}...`);
        this.generating.add(configKey);
        
        // If there was an old stale generator, clear it
        if (this._activeGenerator && this._activeGenerator.configKey !== configKey) {
            this._activeGenerator = null;
        }
        
        this._scheduleChunk(configKey);
    }

    _scheduleChunk(configKey) {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback((deadline) => this._doGenerateChunk(configKey, deadline));
        } else {
            setTimeout(() => this._doGenerateChunk(configKey, null), 50);
        }
    }

    _doGenerateChunk(configKey, deadline) {
        const prefix = configKey.split('|')[0];
        
        // Pause check (instead of abort)
        if (!this.config.state[prefix + 'EnableAnimationCache'] || this.isAnyEffectActive()) {
            this.generating.delete(configKey);
            // We do NOT null this._activeGenerator here so we can resume
            return;
        }

        try {
            if (!this._activeGenerator || this._activeGenerator.configKey !== configKey) {
                this._activeGenerator = {
                    configKey: configKey,
                    gen: new QuantizedSequenceGeneratorV2(this.cols, this.rows, this.config.state),
                    sequence: [],
                    startTime: performance.now()
                };

                // Initial step (mirrors generate()'s seed via shared method)
                this._activeGenerator.sequence.push(this._activeGenerator.gen.seedOriginStep());
            }

            const g = this._activeGenerator;
            const MAX_SEQUENCE_STEPS = 300;
            const chunkStartTime = performance.now();

            // Run steps until deadline or chunk budget (15ms)
            while (true) {
                const done = g.gen.generateStep();
                g.sequence.push(g.gen.currentStepOps); // always push, even if empty, to preserve timing parity with live path

                if (done || g.gen.behaviorState.step >= MAX_SEQUENCE_STEPS) {
                    if (!this.cache.has(configKey)) this.cache.set(configKey, []);
                    this.cache.get(configKey).push(g.sequence);
                    
                    const duration = (performance.now() - g.startTime).toFixed(0);
                    const status = done ? "Complete" : "MaxSteps";
                    console.log(`[QuantizedSequenceCache] Sequence Cached (${this.cache.get(configKey).length}/${this.maxCacheSize}). Steps: ${g.sequence.length}. Reason: ${status}. Took ${duration}ms`);
                    
                    this.generating.delete(configKey);
                    this._activeGenerator = null;

                    // Chain next sequence if needed
                    if (!this.isFull(configKey)) {
                        this.ensureReady(configKey);
                    }
                    return;
                }

                const elapsed = performance.now() - chunkStartTime;
                if (deadline) {
                    if (deadline.timeRemaining() < 1) { this._scheduleChunk(configKey); return; }
                } else if (elapsed > 15) { 
                    this._scheduleChunk(configKey); return; 
                }
            }

        } catch (e) {
            console.error("[QuantizedSequenceCache] Background generation failed", e);
            this.generating.delete(configKey);
            this._activeGenerator = null;
        }
    }

    clear() {
        this.cache.clear();
        this.generating.clear();
        this._activeGenerator = null;
    }

    generateConfigKey(prefix) {
        const overrideDefaults = this.config.get(prefix + 'OverrideDefaults');
        
        const keys = [
            'LayerCount', 'QuadrantCount', 'GenerativeScaling', 'RandomStart', 'SpineBoost',
            'SimultaneousSpawns', 'AllowAsymmetry',
            'EnableNudge', 'NudgeChance', 'MaxNudgeStrips', 'NudgeSpacing', 'NudgeAxisBias', 'NudgeStartDelay',
            'InvisibleEnabled', 'InvisibleL2Chance', 'InvisibleL3Chance', 'MaxInvisibleL2Strips',
            'MaxInvisibleL3Strips', 'InvisibleL2Spacing', 'InvisibleL3Spacing', 'InvisibleStartDelay',
            'L2LockEnabled', 'L2LockOffset', 'L3LockEnabled', 'L3LockOffset', 'L3AllowNudges',
            'L3FlickerChance', 'L3QuadrantWipeEnabled', 'FillThreshold', 'MaxBlockScale',
            'InsideOutEnabled', 'InsideOutDelay', 'InsideOutPeriod', 'IntersectionPause',
            'IntersectionPauseChance', 'CleanInnerDistance',
            'Speed', 'BlockWidthCells', 'BlockHeightCells', 'OverrideDefaults'
        ];

        const inheritable = ['Speed', 'BlockWidthCells', 'BlockHeightCells'];

        let str = prefix;
        for (const k of keys) {
            let val;
            const isInheritable = inheritable.includes(k);
            
            if (!overrideDefaults && isInheritable) {
                val = this.config.get('quantizedDefault' + k);
                // Fallbacks matching QuantizedBaseEffect
                if (val === undefined || val === null) {
                    if (k === 'BlockWidthCells') val = this.config.get('quantizedBlockWidthCells') ?? 4;
                    else if (k === 'BlockHeightCells') val = this.config.get('quantizedBlockHeightCells') ?? 4;
                }
            } else {
                val = this.config.get(prefix + k);
                if (val === undefined || val === null || val === "") {
                    // Final fallback
                    if (k === 'BlockWidthCells') val = this.config.get('quantizedBlockWidthCells') ?? 4;
                    else if (k === 'BlockHeightCells') val = this.config.get('quantizedBlockHeightCells') ?? 4;
                }
            }
            str += `|${k}:${val}`;
        }
        str += `|res:${this.cols}x${this.rows}`;
        
        return str;
    }

    has(configKey) {
        const sequences = this.cache.get(configKey);
        return sequences && sequences.length > 0;
    }
}

// Global Instance
window.sequenceCache = new QuantizedSequenceCache();
