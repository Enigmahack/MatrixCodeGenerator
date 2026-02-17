class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0; // Allow expansion 200% past screen edges to prevent border stalls

        // --- 1. Growth Behaviors (Proposers) ---
        // These behaviors simply calculate coordinates and call _spawnBlock.
        // The new Controller Logic in _spawnBlock ensures they all adhere to the Rule Stack.
        this.GROWTH_BEHAVIORS = [
            { id: 'Spine', method: '_attemptSpineGrowth' },
            { id: 'Unfold', method: '_attemptUnfoldGrowth' },
            { id: 'Crawler', method: '_attemptCrawlerGrowth' },
            { id: 'Nudge', method: '_executeNudgeGrowth' },
            { id: 'Cluster', method: '_attemptClusterGrowth' },
            { id: 'Shift', method: '_attemptShiftGrowth' },
            { id: 'Cyclic', method: '_attemptCyclicGrowth' }
        ];

        // --- 2. Global Maintenance Behaviors ---
        this.GLOBAL_BEHAVIORS = [
            { id: 'Rearrange', method: '_attemptRearrangeGrowth', perLayer: true },
            { id: 'AutoFillHoles', method: '_fillHoles', perLayer: true },
            { id: 'AutoConnectIslands', method: '_connectIslands' },
            { id: 'AutoPruneIslands', method: '_pruneIslands', perLayer: true }
        ];

        // --- 3. Rule Stack (Validation) ---
        // Centralized configuration of all constraints.
        this.RULES = {
            // A. Bounds Check
            bounds: (c) => {
                if (this.getConfig('PreventOffscreen') !== true) return true;
                const bs = this.getBlockSize();
                const xLimit = (this.g.cols / bs.w / 2);
                const yLimit = (this.g.rows / bs.h / 2);
                // Allow 0.5 buffer for partial blocks
                if (c.x < -xLimit - 0.5 || c.x + c.w > xLimit + 0.5 || 
                    c.y < -yLimit - 0.5 || c.y + c.h > yLimit + 0.5) return false;
                return true;
            },

            // B. Step Occupancy (Prevent stacking in one frame)
            occupancy: (c) => {
                if (c.bypassOccupancy || !this._stepOccupancy) return true;
                const w = this.logicGridW;
                const cx = Math.floor(w / 2);
                const cy = Math.floor(this.logicGridH / 2);
                const x1 = Math.max(0, cx + c.x);
                const y1 = Math.max(0, cy + c.y);
                const x2 = Math.min(w - 1, x1 + c.w - 1);
                const y2 = Math.min(this.logicGridH - 1, y1 + c.h - 1);

                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) {
                        if (this._stepOccupancy[rowOff + gx] === 1) return false;
                    }
                }
                return true;
            },

            // C. Connectivity (Adherence to layer)
            connectivity: (c) => {
                if (c.skipConnectivity) return true;
                
                const grid = this.layerGrids[c.layer];
                if (!grid) return false;

                const w = this.logicGridW;
                const h = this.logicGridH;
                const cx = Math.floor(w / 2);
                const cy = Math.floor(h / 2);
                const x1 = Math.max(0, cx + c.x);
                const y1 = Math.max(0, cy + c.y);
                const x2 = Math.min(w - 1, x1 + c.w - 1);
                const y2 = Math.min(h - 1, y1 + c.h - 1);
                
                let connected = false;
                let overlapCount = 0;
                const area = c.w * c.h;

                // 1. Check Overlap (Internal)
                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) {
                        if (grid[rowOff + gx] !== -1) {
                            overlapCount++;
                            connected = true;
                        }
                    }
                }
                
                // Prevent full internal stacking unless allowed
                if (!c.isShifter && !c.allowInternal && overlapCount >= area) return false;
                
                if (connected) return true;

                // 2. Check Adjacency (Perimeter)
                // Top
                if (y1 > 0) {
                    const rowOff = (y1 - 1) * w;
                    for (let gx = x1; gx <= x2; gx++) { if (grid[rowOff + gx] !== -1) return true; }
                }
                // Bottom
                if (y2 < h - 1) {
                    const rowOff = (y2 + 1) * w;
                    for (let gx = x1; gx <= x2; gx++) { if (grid[rowOff + gx] !== -1) return true; }
                }
                // Left
                if (x1 > 0) {
                    for (let gy = y1; gy <= y2; gy++) { if (grid[gy * w + x1 - 1] !== -1) return true; }
                }
                // Right
                if (x2 < w - 1) {
                    for (let gy = y1; gy <= y2; gy++) { if (grid[gy * w + x2 + 1] !== -1) return true; }
                }

                return false;
            },

            // D. Anchoring (Optional sub-layer constraint)
            anchoring: (c) => {
                 return this._isAnchored(c.x, c.y, c.w, c.h, c.layer);
            }
        };
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
        
        this.usedCardinalIndices = [];
        this.nudgeAxisBalance = 0; 

        this._initShadowWorld(); 
        
        const bs = this.getBlockSize();
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);

        this._initProceduralState();
        this._updateRenderGridLogic();

        return true;
    }

    update() {
        if (!this.active) return;

        if (!this.hasSwapped && !this.isSwapping) {
            if (super._updateShadowSim()) return;
        } else if (this.isSwapping) {
            super.updateTransition(false);
        }

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;
        this.timer++;

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
            
            const enNudge = (this.getConfig('EnableNudge') === true);
            const intervalMult = enNudge ? 0.15 : 0.25; 
            const interval = Math.max(1, baseDuration * (delayMult * intervalMult));
            
            if (!this.debugMode) {
                this.genTimer++;
                if (this.genTimer >= interval) {
                    this.genTimer = 0;
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

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        // 1. Sync Logic Grid
        this.logicGrid.fill(0);
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
            const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
            for (let gy = y1; gy <= y2; gy++) {
                const rowOff = gy * w;
                for (let gx = x1; gx <= x2; gx++) {
                    this.logicGrid[rowOff + gx] = 1;
                }
            }
        }

        // 2. Initialize Step Occupancy
        if (!this._stepOccupancy || this._stepOccupancy.length !== this.logicGrid.length) {
            this._stepOccupancy = new Uint8Array(this.logicGrid.length);
        }
        this._stepOccupancy.fill(0);

        // 3. Preparation
        let quota = getGenConfig('SimultaneousSpawns') || 1;
        if (getGenConfig('EnableEventScaling')) {
            const minQuota = getGenConfig('EventScalingMin') || 1;
            let filled = 0;
            for (let i = 0; i < this.logicGrid.length; i++) if (this.logicGrid[i] === 1) filled++;
            const massPercent = filled / this.logicGrid.length;
            const t = Math.min(1.0, massPercent / 0.5); 
            quota = Math.round(minQuota + (quota - minQuota) * t);
        }

        const maxLayer = getGenConfig('LayerCount') || 1;
        const targetLayer = (getGenConfig('EnableSyncSubLayers') === true) ? 0 : this.proceduralLayerIndex;

        // 4. Phase A: Stateful Behaviors
        this._processActiveStatefulBehaviors(targetLayer);

        let actionsPerformed = 0;
        let success = false;

        // 5. Phase B: Nudge Priority
        const enNudge = getGenConfig('EnableNudge') === true;
        if (enNudge && actionsPerformed < quota) {
            if (this._executeNudgeGrowth(null, targetLayer)) {
                actionsPerformed++;
                success = true;
            }
        }

        // 6. Phase C: Growth Behaviors
        const enabledGrowth = this.GROWTH_BEHAVIORS.filter(b => 
            b.id !== 'Nudge' && getGenConfig('Enable' + b.id) === true
        );
        
        const maxAttempts = Math.max(20, quota * 4);
        let attempts = 0;

        while (actionsPerformed < quota && attempts < maxAttempts && enabledGrowth.length > 0) {
            attempts++;
            const behavior = enabledGrowth[Math.floor(Math.random() * enabledGrowth.length)];
            
            if (typeof this[behavior.method] === 'function') {
                if (this[behavior.method](null, targetLayer)) {
                    success = true;
                    actionsPerformed++;
                }
            }
        }

        // 7. Phase D: Fallback
        if (!success && getGenConfig('EnableFallback') === true) {
            if (this._attemptSubstituteGrowthWithLayer(targetLayer)) success = true;
            else if (this._attemptForceFill()) success = true;
        }

        // 8. Global Behaviors
        for (const behavior of this.GLOBAL_BEHAVIORS) {
            const configKey = 'Enable' + behavior.id;
            const isEnabled = getGenConfig(configKey) === true;
            if (isEnabled) {
                if (behavior.perLayer) {
                    for (let l = 0; l <= maxLayer; l++) this[behavior.method](l);
                } else {
                    this[behavior.method]();
                }
            }
        }

        // 9. Phase E: Final Mirroring/Synchronization Pass
        this._syncSubLayers();

        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);

        if (!success && !this._isCanvasFullyCovered()) {
            this._warn("QuantizedBlockGenerator: Growth stalled - no safe move found.");
        }

        // Final Logic Grid Sync (for rendering)
        this.logicGrid.fill(0);
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
            const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
            for (let gy = y1; gy <= y2; gy++) {
                const rowOff = gy * w;
                for (let gx = x1; gx <= x2; gx++) {
                    this.logicGrid[rowOff + gx] = 1;
                }
            }
        }
    }

    _executeNudgeGrowth(ignored, targetLayer) {
        const sw = this._getScaledConfig('MinBlockWidth', 1);
        const mw = this._getScaledConfig('MaxBlockWidth', 3);
        const sh = this._getScaledConfig('MinBlockHeight', 1);
        const mh = this._getScaledConfig('MaxBlockHeight', 3);

        const bw = Math.floor(Math.random() * (mw - sw + 1)) + sw;
        const bh = Math.floor(Math.random() * (mh - sh + 1)) + sh;

        return this._attemptNudgeGrowthWithParams(targetLayer, bw, bh);
    }

    // --- CONTROLLER LOGIC ---

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy
        };
        
        return this._proposeCandidate(candidate);
    }

    _proposeCandidate(c) {
        // 1. Validate
        if (!this._validateCandidate(c)) return -1;

        // 2. Commit
        const id = this._commitCandidate(c);
        if (id === -1) return -1;

        // 3. Side Effects (Axis Balancing)
        if (!c.isShifter && !c.isMirroredSpawn && this.getConfig('EnableAxisBalancing')) {
            this._handleAxisBalancing(c);
        }

        return id;
    }

    _validateCandidate(c) {
        if (!this.RULES.bounds(c)) return false;
        if (!this.RULES.occupancy(c)) return false;
        if (!this.RULES.anchoring(c)) return false;
        if (!this.RULES.connectivity(c)) return false;
        return true;
    }

    _commitCandidate(c) {
        // Bypass checks in super that we already performed
        return super._spawnBlock(
            c.x, c.y, c.w, c.h, c.layer,
            c.isShifter, c.expireFrames,
            true, // Skip super's connectivity/overlap check
            c.allowInternal, c.suppressFades, c.isMirroredSpawn, c.bypassOccupancy
        );
    }

    _handleAxisBalancing(c) {
        const mirrorType = Math.floor(Math.random() * 3); // 0: X, 1: Y, 2: Both
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        let targetXRange = null; // [min, max]
        let targetYRange = null;

        // X-Axis Balancing
        if (mirrorType === 0 || mirrorType === 2) {
            if (c.x < 0) { targetXRange = [0, cx - c.w]; } // West -> East
            else { targetXRange = [-cx, -c.w]; } // East -> West
        } else {
            targetXRange = [c.x, c.x]; // Keep same X
        }

        // Y-Axis Balancing
        if (mirrorType === 1 || mirrorType === 2) {
            if (c.y < 0) { targetYRange = [0, cy - c.h]; } // North -> South
            else { targetYRange = [-cy, -c.h]; } // South -> North
        } else {
            targetYRange = [c.y, c.y]; // Keep same Y
        }

        let mx = c.x, my = c.y;
        
        if (targetXRange) {
            const minX = targetXRange[0], maxX = targetXRange[1];
            if (minX <= maxX) mx = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
        }
        if (targetYRange) {
            const minY = targetYRange[0], maxY = targetYRange[1];
            if (minY <= maxY) my = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
        }

        // Create balanced candidate
        const balanced = { ...c, x: mx, y: my, isMirroredSpawn: true };
        this._proposeCandidate(balanced);
    }

    _executeStepOps(step, startFrameOverride) {
        super._executeStepOps(step, startFrameOverride);
        this._syncSubLayers();
    }

    _syncSubLayers() {
        const s = this.c.state;
        if (!s.quantizedGenerateV2EnableSyncSubLayers) return;

        const maxLayer = s.quantizedGenerateV2LayerCount || 1;
        if (maxLayer < 1) return;

        const w = this.logicGridW;
        const h = this.logicGridH;
        const l0Grid = this.layerGrids[0];
        if (!l0Grid) return;

        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        // 1. Identify all active cells in Layer 0 to sync.
        // We remove the 4-way neighbor check to ensure sub-layers match the L0 perimeter exactly.
        const syncGrid = new Uint8Array(w * h);
        for (let i = 0; i < l0Grid.length; i++) {
            if (l0Grid[i] !== -1) syncGrid[i] = 1;
        }

        // 2. Extract rectangles from syncGrid (Greedy Fill) for Editor visibility and efficiency
        const rects = [];
        for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
                if (syncGrid[gy * w + gx] === 1) {
                    let rw = 0;
                    while (gx + rw < w && syncGrid[gy * w + gx + rw] === 1) rw++;
                    let rh = 1;
                    while (gy + rh < h) {
                        let lineFull = true;
                        for (let ix = 0; ix < rw; ix++) {
                            if (syncGrid[(gy + rh) * w + gx + ix] !== 1) { lineFull = false; break; }
                        }
                        if (!lineFull) break;
                        rh++;
                    }
                    rects.push({ x: gx - cx, y: gy - cy, w: rw, h: rh });
                    // Mark as processed
                    for (let iy = 0; iy < rh; iy++) {
                        for (let ix = 0; ix < rw; ix++) syncGrid[(gy + iy) * w + gx + ix] = 0;
                    }
                }
            }
        }

        // 3. Commit these rectangles to sub-layers if they aren't already covered
        for (const r of rects) {
            for (let l = 1; l <= maxLayer; l++) {
                const targetGrid = this.layerGrids[l];
                let fullyCovered = true;
                const rx = cx + r.x, ry = cy + r.y;
                for (let iy = 0; iy < r.h; iy++) {
                    const rowOff = (ry + iy) * w;
                    for (let ix = 0; ix < r.w; ix++) {
                        if (targetGrid[rowOff + rx + ix] === -1) { 
                            fullyCovered = false; 
                            break; 
                        }
                    }
                    if (!fullyCovered) break;
                }

                if (!fullyCovered) {
                    // Use _spawnBlock to ensure visibility in Editor schematic (maskOps)
                    // bypassOccupancy=true ensures mirroring succeeds even if other behaviors touched the spot.
                    this._spawnBlock(r.x, r.y, r.w, r.h, l, false, 0, true, true, true, true, true);
                }
            }
        }
    }

    stop() {
        super.stop();
    }
}