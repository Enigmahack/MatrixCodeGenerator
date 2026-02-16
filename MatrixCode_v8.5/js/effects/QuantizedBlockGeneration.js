class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 1.5; // Allow expansion 50% past screen edges to prevent border stalls
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        
        const cols = this.shadowGrid.cols;
        const rows = this.shadowGrid.rows;
        const targetStreamCount = Math.floor(cols * 0.5); 
        
        const totalSpawns = (s.streamSpawnCount || 0) + (s.eraserSpawnCount || 0);
        const eraserChance = totalSpawns > 0 ? (s.eraserSpawnCount / totalSpawns) : 0;

        const columns = Array.from({length: cols}, (_, i) => i);
        Utils.shuffle(columns);

        let spawned = 0;
        let colIdx = 0;
        const maxAttempts = targetStreamCount * 3; 
        let attempts = 0;

        while (spawned < targetStreamCount && attempts < maxAttempts) {
            attempts++;
            const col = columns[colIdx % columns.length];
            colIdx++;
            
            const isEraser = Math.random() < eraserChance;
            const stream = sm._initializeStream(col, isEraser, s);
            
            const totalSteps = stream.visibleLen;
            const fallSteps = rows;
            const currentAge = Math.floor(Math.random() * totalSteps);
            
            if (currentAge < fallSteps) {
                stream.y = currentAge;
                stream.age = currentAge;
            } else {
                stream.y = rows + 1; 
                stream.age = currentAge;
                
                if (!stream.isEraser) {
                    const eraserAge = currentAge - fallSteps;
                    if (eraserAge > 0) {
                        const eraser = sm._initializeStream(col, true, s);
                        eraser.y = Math.min(eraserAge, rows + 5);
                        eraser.age = eraserAge;
                        eraser.tickInterval = stream.tickInterval; 
                        sm.addActiveStream(eraser);
                    }
                }
            }
            
            stream.visibleLen += Math.floor(Math.random() * 300);
            
            if (stream.age < stream.visibleLen) {
                sm.addActiveStream(stream);
                spawned++;
            }
        }
    
        const warmupFrames = 60; 
        this.warmupRemaining = warmupFrames;
        this.shadowSimFrame = 0;
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        if (!super.trigger(force)) return false;

        this._log("QuantizedBlockGenerator: Triggered");
        this.timer = 0;
        this.genTimer = 0;
        this.animFrame = 0;
        this.expansionPhase = 0;
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.alpha = 1.0;
        this.state = 'GENERATING';
        
        // Custom state for startup sequence
        this.usedCardinalIndices = [];
        this.nudgeAxisBalance = 0; // Negative = more X, Positive = more Y

        this._initShadowWorld(); 
        
        const bs = this.getBlockSize();
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);

        this._initProceduralState();
        return true;
    }

    _initProceduralState() {
        super._initProceduralState();
        const total = this.logicGridW * this.logicGridH;
        if (!this._sharedGrid || this._sharedGrid.length !== total) {
            this._sharedGrid = new Uint8Array(total);
            this._sharedVisited = new Uint8Array(total);
        }
    }

    update() {
        if (!this.active) return;

        // 0. Update Shadow Simulation & Warmup
        if (!this.hasSwapped && !this.isSwapping) {
            if (super._updateShadowSim()) return;
        } else if (this.isSwapping) {
            super.updateTransition(false);
        }

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;
        this.timer++;

        // Perform cleanup of expired ops
        const fadeOutFrames = this.getConfig('FadeFrames') || 0;
        if (this.maskOps.length > 0 && this.animFrame % 60 === 0) {
             const oldLen = this.maskOps.length;
             this.maskOps = this.maskOps.filter(op => {
                 if (op.expireFrame && this.animFrame >= op.expireFrame + fadeOutFrames) return false;
                 return true;
             });
             if (this.maskOps.length !== oldLen) {
                 this._lastProcessedOpIndex = 0; 
             }
        }

        const durationFrames = (s.quantizedGenerateV2DurationSeconds || 5) * fps;
        
        if (this.state === 'GENERATING') {
            const baseDuration = Math.max(1, this.c.derived.cycleDuration);
            const userSpeed = (s.quantizedGenerateV2Speed !== undefined) ? s.quantizedGenerateV2Speed : 5;
            const delayMult = 11 - userSpeed;
            
            const getGenConfig = (key) => {
                const val = this.getConfig(key);
                if (val !== undefined) return val;
                return s['quantizedGenerateV2' + key];
            };

            const enNudge = (this.getConfig('EnableNudge') === true);
            const intervalMult = enNudge ? 0.15 : 0.25; 
            const interval = Math.max(1, baseDuration * (delayMult * intervalMult));
            
            if (!this.debugMode) {
                this.genTimer++;
                if (this.genTimer >= interval) {
                    this.genTimer = 0;
                    const maxLayer = getGenConfig('LayerCount') || 1;
                    const targetLayer = this.proceduralLayerIndex;
                    this._processActiveStatefulBehaviors(targetLayer);
                    this._attemptGrowth();
                    this.expansionPhase++;
                }
            }
            
            this._updateRenderGridLogic();

            const isCovered = this._isCanvasFullyCovered();
            const timedOut = this.timer >= durationFrames;

            if (!this.debugMode && (timedOut || isCovered)) {
                this._log(`QuantizedBlockGenerator: Ending generation. Reason: ${isCovered ? 'FULL COVERAGE' : 'TIMEOUT (' + (this.timer/fps).toFixed(1) + 's)'}`);
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            const fadeFrames = s.quantizedGenerateV2FadeFrames || 60;
            this.alpha = Math.max(0, 1.0 - (this.timer / fadeFrames));
            if (this.timer >= fadeFrames) {
                this._log("QuantizedBlockGenerator: Effect complete.");
                this.active = false;
                this.state = 'IDLE';
                this.g.clearAllOverrides();
            }
        }
        
        this._checkDirtiness();
    }

    _attemptGrowth() {
        this._initProceduralState(); 

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enUnfold = getGenConfig('EnableUnfold') === true;
        const enCrawler = getGenConfig('EnableCrawler') === true;
        const enPulse = getGenConfig('EnablePulseGrowth') === true;
        const enNudge = getGenConfig('EnableNudge') === true;
        const enRearrange = getGenConfig('EnableRearrange') === true;
        const enRNGGrowth = getGenConfig('EnableRNGGrowth') === true;
        const quota = getGenConfig('SimultaneousSpawns') || 1;
        const maxLayer = getGenConfig('LayerCount') || 1;

        // Determine target layer for THIS step (Sequential Rotation)
        const targetLayer = this.proceduralLayerIndex;

        const pool = [];
        if (enUnfold) pool.push(() => this._attemptUnfoldGrowth());
        if (enCrawler) pool.push(() => this._attemptCrawlerGrowth());
        if (enRearrange) pool.push(() => this._attemptRearrangeGrowth());
        if (enRNGGrowth) pool.push(() => this._attemptRNGGenerativeGrowth());
        
        const addSizedBehavior = (behaviorFunc) => {
            pool.push(() => {
                const minW = getGenConfig('MinBlockWidth') || 1;
                const maxW = getGenConfig('MaxBlockWidth') || 3;
                const minH = getGenConfig('MinBlockHeight') || 1;
                const maxH = getGenConfig('MaxBlockHeight') || 3;
                const w = Math.floor(Math.random() * (maxW - minW + 1)) + minW;
                const h = Math.floor(Math.random() * (maxH - minH + 1)) + minH;
                return behaviorFunc(targetLayer, w, h);
            });
        };

        if (enPulse) addSizedBehavior((l, w, h) => this._attemptPulseGrowthWithParams(l, w, h));
        if (enNudge) addSizedBehavior((l, w, h) => this._attemptNudgeGrowthWithParams(l, w, h));

        let success = false;
        let actionsPerformed = 0;
        const maxAttempts = quota * 2;
        let attempts = 0;

        while (actionsPerformed < quota && attempts < maxAttempts) {
            attempts++;
            let attemptSuccess = false;
            if (pool.length > 0) {
                const behavior = pool[Math.floor(Math.random() * pool.length)];
                if (behavior()) attemptSuccess = true;
            }
            
            if (!attemptSuccess) {
                if (this._attemptSubstituteGrowthWithLayer(targetLayer)) attemptSuccess = true;
            }

            if (attemptSuccess) {
                success = true;
                actionsPerformed++;
            }
        }

        // Rotate layer for NEXT step
        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);

        // Emergency "Force Fill" if primary behaviors and substitutes stalled but canvas isn't covered
        if (!success) {
            if (this._attemptForceFill()) {
                success = true;
            }
        }

        if (!success && !this._isCanvasFullyCovered()) {
            this._warn("QuantizedBlockGenerator: Growth stalled - no safe move found for enabled behaviors.");
        }

        this._performAutoActions();
        
        // Global behavior: Sync Layer 0 blocks to all sub-layers
        this._syncSubLayers(maxLayer);

        // Final Logic Grid Sync
        const w = this.logicGridW, h = this.logicGridH;
        this.logicGrid.fill(0);
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
            const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
            for (let gy = y1; gy <= y2; gy++) {
                const rowOff = gy * w;
                for (let gx = x1; gx <= x2; gx++) {
                    // Consider logic grid active if ANY layer has a block there
                    this.logicGrid[rowOff + gx] = 1;
                }
            }
        }
    }

    _syncSubLayers(maxLayer) {
        if (maxLayer < 1) return;

        // 1. Identify all blocks in Layer 0
        const l0Blocks = this.activeBlocks.filter(b => b.layer === 0);
        if (l0Blocks.length === 0) return;

        // 2. Identify blocks in sub-layers for quick lookup
        const subLayerBlocks = new Array(maxLayer + 1).fill(0).map(() => new Set());
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            if (b.layer > 0 && b.layer <= maxLayer) {
                // Key format: x,y,w,h
                subLayerBlocks[b.layer].add(`${b.x},${b.y},${b.w},${b.h}`);
            }
        }

        // 3. Sync Layer 0 blocks to sub-layers
        for (let i = 0; i < l0Blocks.length; i++) {
            const b0 = l0Blocks[i];
            for (let l = 1; l <= maxLayer; l++) {
                const key = `${b0.x},${b0.y},${b0.w},${b0.h}`;
                if (!subLayerBlocks[l].has(key)) {
                    // Spawn the block in sub-layer l
                    // Use skipConnectivity=true, allowInternal=true, suppressFades=true as this is a sync operation
                    this._spawnBlock(b0.x, b0.y, b0.w, b0.h, l, true, false, 0, true, true, true);
                }
            }
        }
    }


    stop() {
        super.stop();
    }
}
