class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0; // Allow expansion 200% past screen edges to prevent border stalls
        this.persistentCycleIndex = 0;

        // --- 1. Growth Behaviors (Proposers) ---
        // These behaviors simply calculate coordinates and call _spawnBlock.
        // The new Controller Logic in _spawnBlock ensures they all adhere to the Rule Stack.
        this.GROWTH_BEHAVIORS = [
            { id: 'Nudge', method: '_executeNudgeGrowth' },
            { id: 'Cluster', method: '_attemptClusterGrowth' },
            { id: 'Shift', method: '_attemptQuadrantShiftGrowth' },
            { id: 'Centered', method: '_attemptCenteredGrowth' },
            { id: 'Thicken', method: '_attemptThickenGrowth' },
            { id: 'Unfold', method: '_attemptUnfoldGrowth' }
        ];

        // --- 2. Global Maintenance Behaviors ---
        this.GLOBAL_BEHAVIORS = [
            { id: 'Rearrange', method: '_attemptRearrangeGrowth', perLayer: true },
            { id: 'AutoFillHoles', method: '_fillHoles', perLayer: true },
            { id: 'AutoConnectIslands', method: '_connectIslands' }
        ];

        // --- 3. Rule Stack (Validation) ---
        // Centralized configuration of all constraints.
        this.RULES = {
            // A. Bounds Check
            bounds: (c) => {
                const bs = this.getBlockSize();
                const xLimit = (this.g.cols / bs.w / 2) + 1; // Canvas + 1 block
                const yLimit = (this.g.rows / bs.h / 2) + 2; // Increased from +1 to +2 to ensure bottom row coverage
                
                if (c.x < -xLimit || c.x + c.w > xLimit || 
                    c.y < -yLimit || c.y + c.h > yLimit) return false;
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
                    for (let gx = x1; gx <= x2; gx++) { 
                        const aIdx = rowOff + gx;
                        if (grid[aIdx] !== -1) {
                            c._foundAnchorIdx = aIdx;
                            return true; 
                        }
                    }
                }
                // Bottom
                if (y2 < h - 1) {
                    const rowOff = (y2 + 1) * w;
                    for (let gx = x1; gx <= x2; gx++) { 
                        const aIdx = rowOff + gx;
                        if (grid[aIdx] !== -1) {
                            c._foundAnchorIdx = aIdx;
                            return true; 
                        }
                    }
                }
                // Left
                if (x1 > 0) {
                    for (let gy = y1; gy <= y2; gy++) { 
                        const aIdx = gy * w + x1 - 1;
                        if (grid[aIdx] !== -1) {
                            c._foundAnchorIdx = aIdx;
                            return true; 
                        }
                    }
                }
                // Right
                if (x2 < w - 1) {
                    for (let gy = y1; gy <= y2; gy++) { 
                        const aIdx = gy * w + x2 + 1;
                        if (grid[aIdx] !== -1) {
                            c._foundAnchorIdx = aIdx;
                            return true; 
                        }
                    }
                }

                return false;
            },

            // D. Outward Growth Check
            direction: (c) => {
                if (c.isShifter || c.isMirroredSpawn || c.skipConnectivity) return true;
                
                // The block must be connecting to an existing anchor further in.
                const cx = Math.floor(this.logicGridW / 2);
                const cy = Math.floor(this.logicGridH / 2);

                const nx = c.x + c.w / 2;
                const ny = c.y + c.h / 2;
                const newDistSq = nx * nx + ny * ny;

                // Use the anchor found during connectivity check
                if (c._foundAnchorIdx !== undefined) {
                    const ax_abs = c._foundAnchorIdx % this.logicGridW;
                    const ay_abs = Math.floor(c._foundAnchorIdx / this.logicGridW);
                    const ax = ax_abs - cx + 0.5;
                    const ay = ay_abs - cy + 0.5;
                    const anchorDistSq = ax * ax + ay * ay;

                    // Allow very slight tolerance for floating point parity, 
                    // but generally must be further out.
                    if (newDistSq < anchorDistSq - 0.01) return false;
                }

                return true;
            },

            // F. Spatial Distribution (Prevent clustering/stacking in one step)
            spatial: (c) => {
                if (c.isMirroredSpawn || c.isShifter || c.bypassSpatial) return true;
                if (!this._currentStepActions || this._currentStepActions.length === 0) return true;
                
                const cx = c.x + c.w / 2;
                const cy = c.y + c.h / 2;
                
                // Manhattan distance: 15% of max SCREEN dimension, min 10 blocks
                const bs = this.getBlockSize();
                const screenW = Math.ceil(this.g.cols / bs.w);
                const screenH = Math.ceil(this.g.rows / bs.h);
                const minDistance = Math.max(10, Math.floor(Math.max(screenW, screenH) * 0.15));

                for (const action of this._currentStepActions) {
                    // Check for EXACT stacking first (center to center) - Regardless of Layer
                    if (action.x === c.x && action.y === c.y) return false;

                    // Then check Manhattan distance
                    const ax = action.x + action.w / 2;
                    const ay = action.y + action.h / 2;
                    const dist = Math.abs(cx - ax) + Math.abs(cy - ay);
                    if (dist < minDistance) return false;
                }
                return true;
            },

            // G. Vacated Cooldown (Prevent flickering)
            vacated: (c) => {
                if (c.bypassOccupancy) return true; // Allow intentional immediate reuse (e.g. rotation)
                
                const grid = this.removalGrids[c.layer];
                if (!grid) return true;

                const w = this.logicGridW;
                const cx = Math.floor(w / 2);
                const cy = Math.floor(this.logicGridH / 2);
                const x1 = Math.max(0, cx + c.x);
                const y1 = Math.max(0, cy + c.y);
                const x2 = Math.min(w - 1, x1 + c.w - 1);
                const y2 = Math.min(this.logicGridH - 1, y1 + c.h - 1);

                const cooldownSteps = 3; 
                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) {
                        const remPhase = grid[rowOff + gx];
                        if (remPhase !== -1 && this.expansionPhase - remPhase < cooldownSteps) return false;
                    }
                }
                return true;
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
        this._isCovered = undefined;
        this.persistentCycleIndex = 0;
        
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
                 this._gridsDirty = true;
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

            // Throttled coverage check using base class method
            const isCovered = this._updateExpansionStatus();
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
        if (this.expansionComplete) return;
        this._initProceduralState(); 
        this._syncSubLayers(); // Synchronize existing state first
        this._currentStepActions = []; // Reset step actions for spatial distribution check

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        // 1. Sync Logic Grid (for connectivity checks)
        this._updateInternalLogicGrid();

        const w = this.logicGridW, h = this.logicGridH;

        // 2. Initialize Step Occupancy
        const stepOccupancy = this._getBuffer('stepOccupancy', this.logicGrid.length, Uint8Array);
        stepOccupancy.fill(0);
        this._stepOccupancy = stepOccupancy;

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

        // Collect behaviors
        const behaviors = [];
        this.GROWTH_BEHAVIORS.forEach(b => {
            if (getGenConfig('Enable' + b.id)) {
                behaviors.push(b);
            }
        });

        let successInStep = false;
        const enCycling = getGenConfig('EnableLayerCycling') === true;

        // 4. Layer Growth Loop
        for (let q = 0; q < quota; q++) {
            // Determine target layers for this action slot
            let layersToTry = [];
            if (enCycling) {
                const cycle = [];
                if (maxLayer >= 1) cycle.push(1);
                if (maxLayer >= 2) cycle.push(2);
                cycle.push(0); 
                
                // Use persistent index to ensure fair distribution across frames
                const target = cycle[(this.persistentCycleIndex + q) % cycle.length];
                layersToTry = [target];
            } else {
                for (let l = 0; l <= maxLayer; l++) layersToTry.push(l);
            }

            let slotSuccess = false;
            for (const behavior of behaviors) {
                for (const targetLayer of layersToTry) {
                    let successForLayer = false;

                    if (behavior.id === 'Unfold') {
                        if (this._processActiveStatefulBehaviors(targetLayer)) successForLayer = true;
                        if (!successForLayer && this._attemptUnfoldGrowth(null, targetLayer)) successForLayer = true;
                    } else {
                        if (typeof this[behavior.method] === 'function') {
                            if (this[behavior.method](null, targetLayer)) successForLayer = true;
                        }
                    }

                    if (successForLayer) {
                        slotSuccess = true;
                        successInStep = true;
                        break; 
                    }
                }
                if (slotSuccess) break; // Slot filled, move to next quota q
            }
        }

        if (enCycling) {
            // Advance the cycle for the next frame
            const cycleLen = (maxLayer >= 2 ? 3 : maxLayer >= 1 ? 2 : 1);
            this.persistentCycleIndex = (this.persistentCycleIndex + quota) % cycleLen;
        }

        // 5. Global Maintenance (Pruning, etc.)
        for (const behavior of this.GLOBAL_BEHAVIORS) {
            const isEnabled = getGenConfig('Enable' + behavior.id) === true;
            if (isEnabled) {
                if (behavior.perLayer) {
                    for (let l = 0; l <= maxLayer; l++) this[behavior.method](l);
                } else {
                    this[behavior.method]();
                }
            }
        }

        // Update Layer Rotation for any behaviors that still use sequential rotation
        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);

        if (!successInStep && !this._isCanvasFullyCovered()) {
            this._warn("QuantizedBlockGenerator: Growth stalled - no safe move found in this step.");
        }

        // Final Logic Grid Sync (for rendering)
        this._updateInternalLogicGrid();
    }

    _updateInternalLogicGrid() {
        if (!this.logicGridW || !this.logicGridH) return;
        
        // If we have many blocks, full re-scan is slow.
        // We only need to scan if logic grid was wiped or if we have new blocks.
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        const w = this.logicGridW, h = this.logicGridH;

        if (this._gridsDirty) {
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
            this._gridsDirty = false;
            this._lastProcessedBlockCount = this.activeBlocks.length;
        } else {
            const startIdx = this._lastProcessedBlockCount || 0;
            if (startIdx < this.activeBlocks.length) {
                for (let i = startIdx; i < this.activeBlocks.length; i++) {
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
                this._lastProcessedBlockCount = this.activeBlocks.length;
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

    _attemptThickenGrowth(ignored, targetLayer) {
        const s = this.c.state;
        const count = s.quantizedGenerateV2ThickenQuadrantCount;
        if (count === 0) return false;

        // Since this is in the quota loop, we only want to trigger the quadrant logic ONCE per step per layer
        // to match the slider's definition of "per step" while allowing it to apply to all layers.
        if (!this._thickenStepFrames) this._thickenStepFrames = {};
        if (this._thickenStepFrames[targetLayer] === this.animFrame) return false;
        this._thickenStepFrames[targetLayer] = this.animFrame;

        const w = this.logicGridW;
        const h = this.logicGridH;
        if (!w || !h) return false;

        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;

        const ratio = (this.g.cols / this.g.rows) || 1.0;
        const horizWeight = Math.max(1.0, ratio);
        const vertWeight = Math.max(1.0, 1.0 / ratio);

        const weightedQuadrants = [
            { id: 'NW', w: vertWeight * horizWeight },
            { id: 'NE', w: vertWeight * horizWeight },
            { id: 'SW', w: vertWeight * horizWeight },
            { id: 'SE', w: vertWeight * horizWeight }
        ];

        // Aspect Ratio Bias: If horizontal, prefer E/W quadrants. If vertical, prefer N/S.
        // Actually, quadrants are combinations. NW is N+W. 
        // If ratio > 1 (Horizontal), W and E are good. All quadrants have W or E.
        // Let's refine: prefer quadrants that align with the longest side's ends.
        
        const result = [];
        const pool = [...weightedQuadrants];
        while (pool.length > 0) {
            let totalW = 0;
            for (const item of pool) totalW += item.w;
            let r = Math.random() * totalW;
            for (let i = 0; i < pool.length; i++) {
                r -= pool[i].w;
                if (r <= 0) {
                    result.push(pool[i].id);
                    pool.splice(i, 1);
                    break;
                }
            }
        }

        const chosen = result.slice(0, count);

        let success = false;
        for (const q of chosen) {
            let xStart, xEnd, yStart, yEnd;
            if (q === 'NW') { xStart = 0; xEnd = cx - 1; yStart = 0; yEnd = cy - 1; }
            else if (q === 'NE') { xStart = cx; xEnd = w - 1; yStart = 0; yEnd = cy - 1; }
            else if (q === 'SW') { xStart = 0; xEnd = cx - 1; yStart = cy; yEnd = h - 1; }
            else { xStart = cx; xEnd = w - 1; yStart = cy; yEnd = h - 1; }

            // Find frontier within this quadrant
            const frontier = [];
            for (let gy = yStart; gy <= yEnd; gy++) {
                const rowOff = gy * w;
                for (let gx = xStart; gx <= xEnd; gx++) {
                    const idx = rowOff + gx;
                    if (grid[idx] === -1) {
                        // Check if any neighbor is active on THIS layer
                        const neighbors = [
                            {x: gx, y: gy - 1}, {x: gx, y: gy + 1},
                            {x: gx - 1, y: gy}, {x: gx + 1, y: gy}
                        ];
                        for (const n of neighbors) {
                            if (n.x >= 0 && n.x < w && n.y >= 0 && n.y < h) {
                                if (grid[n.y * w + n.x] !== -1) {
                                    frontier.push({x: gx, y: gy});
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (frontier.length > 0) {
                // To avoid massive performance hits or visual spikes, 
                // we fill a random portion of the frontier (up to 20 blocks).
                Utils.shuffle(frontier);
                const toFill = frontier.slice(0, 20);
                for (const pt of toFill) {
                    // Use skipConnectivity=false to enforce the 'direction' (outward) rule
                    // and suppressFades=true to prevent flashes
                    if (this._spawnBlock(pt.x - cx, pt.y - cy, 1, 1, targetLayer, false, 0, false, true, true) !== -1) {
                        success = true;
                    }
                }
            }
        }

        return success;
    }

    // --- CONTROLLER LOGIC ---

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy,
            bypassSpatial: skipConnectivity
        };
        
        return this._proposeCandidate(candidate);
    }

    _proposeCandidate(c) {
        // 1. Offscreen Redirection
        if (!this.RULES.bounds(c)) {
            if (!this._redirectOffscreen(c)) return -1; // Abort if no on-screen fallback found
        }

        // 2. Validate
        if (!this._validateCandidate(c)) return -1;

        // 3. Commit
        const id = this._commitCandidate(c);
        if (id === -1) return -1;

        // 4. Side Effects (Axis Balancing)
        if (!c.isShifter && !c.isMirroredSpawn && this.getConfig('EnableAxisBalancing')) {
            this._handleAxisBalancing(c);
        }

        return id;
    }

    _redirectOffscreen(c) {
        if (c.skipConnectivity) return false;

        const bs = this.getBlockSize();
        const xLimit = Math.floor((this.g.cols / bs.w) / 2);
        const yLimit = Math.floor((this.g.rows / bs.h) / 2);

        // OPTIMIZED: Instead of filtering and sorting EVERYTHING (O(N log N)),
        // sample a subset of recently added blocks which are more likely to be relevant.
        const total = this.activeBlocks.length;
        if (total === 0) return false;

        const sampleSize = Math.min(total, 50);
        const candidates = [];
        const tx = c.x, ty = c.y;

        // Walk backwards from most recent blocks
        for (let i = total - 1; i >= 0 && candidates.length < sampleSize; i--) {
            const b = this.activeBlocks[i];
            if (b.layer !== c.layer) continue;
            
            // On-screen check
            if (!(b.x < -xLimit || b.x > xLimit || b.y < -yLimit || b.y > yLimit)) {
                const dist = Math.abs(b.x - tx) + Math.abs(b.y - ty);
                candidates.push({ b, dist });
            }
        }

        if (candidates.length === 0) return false;

        // Sort only the small sample
        candidates.sort((a, b) => a.dist - b.dist);

        // Try to attach the requested shape to the perimeter of the nearest on-screen anchors
        const dirs = this._getBiasedDirections();
        for (let i = 0; i < Math.min(10, candidates.length); i++) {
            const a = candidates[i].b;
            for (const dir of dirs) {
                let nx = a.x, ny = a.y;
                if (dir === 'N') ny = a.y - c.h;
                else if (dir === 'S') ny = a.y + a.h;
                else if (dir === 'E') nx = a.x + a.w;
                else if (dir === 'W') nx = a.x - c.w;

                // Validate new position is on-screen
                if (nx >= -xLimit && nx + c.w - 1 <= xLimit && ny >= -yLimit && ny + c.h - 1 <= yLimit) {
                    // Update candidate coordinates
                    c.x = nx;
                    c.y = ny;
                    return true;
                }
            }
        }

        return false;
    }

    _validateCandidate(c) {
        if (!this.RULES.bounds(c)) return false;
        if (!this.RULES.occupancy(c)) return false;
        if (!this.RULES.vacated(c)) return false;

        // Shifter blocks bypass growth constraints
        if (c.isShifter) return true;

        if (!this.RULES.connectivity(c)) return false;
        if (!this.RULES.direction(c)) return false;
        if (!this.RULES.spatial(c)) return false;
        return true;
    }

    _commitCandidate(c) {
        // Bypass checks in super that we already performed
        const id = super._spawnBlock(
            c.x, c.y, c.w, c.h, c.layer,
            c.isShifter, c.expireFrames,
            true, // Skip super's connectivity/overlap check
            c.allowInternal, c.suppressFades, c.isMirroredSpawn, c.bypassOccupancy
        );

        if (id !== -1) {
            if (!this._currentStepActions) this._currentStepActions = [];
            this._currentStepActions.push(c);
        }

        return id;
    }

    _handleAxisBalancing(c) {
        const mirrorType = Math.floor(Math.random() * 3); // 0: X, 1: Y, 2: Both
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        // Target Quadrant Logic
        let flipX = (mirrorType === 0 || mirrorType === 2);
        let flipY = (mirrorType === 1 || mirrorType === 2);

        let targetX = flipX ? -c.x - c.w : c.x;
        let targetY = flipY ? -c.y - c.h : c.y;

        const candidate = { ...c, x: targetX, y: targetY, isMirroredSpawn: true };

        // 1. Try direct mirror first
        if (this._validateCandidate(candidate)) {
            this._commitCandidate(candidate);
            return;
        }

        // 2. Search for nearest connected spot in target quadrant
        const searchRange = 5;
        const attempts = [];
        for (let dy = -searchRange; dy <= searchRange; dy++) {
            for (let dx = -searchRange; dx <= searchRange; dx++) {
                if (dx === 0 && dy === 0) continue;
                attempts.push({ 
                    x: targetX + dx, 
                    y: targetY + dy, 
                    dist: Math.abs(dx) + Math.abs(dy) 
                });
            }
        }
        attempts.sort((a, b) => a.dist - b.dist);

        for (const att of attempts) {
            const searchCandidate = { ...candidate, x: att.x, y: att.y };
            if (this._validateCandidate(searchCandidate)) {
                this._commitCandidate(searchCandidate);
                return;
            }
        }

        // 3. Last resort: Any connected spot on the target layer
        // This ensures the balancing quota is fulfilled without breaking rules
        const anchors = this.activeBlocks.filter(b => b.layer === c.layer);
        if (anchors.length > 0) {
            Utils.shuffle(anchors);
            for (let i = 0; i < Math.min(10, anchors.length); i++) {
                const a = anchors[i];
                const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
                Utils.shuffle(dirs);
                for (const d of dirs) {
                    let tx = (d.dx === 1) ? a.x + a.w : (d.dx === -1 ? a.x - c.w : a.x);
                    let ty = (d.dy === 1) ? a.y + a.h : (d.dy === -1 ? a.y - c.h : a.y);
                    
                    const finalAttempt = { ...candidate, x: tx, y: ty };
                    if (this._validateCandidate(finalAttempt)) {
                        this._commitCandidate(finalAttempt);
                        return;
                    }
                }
            }
        }
    }

    _executeStepOps(step, startFrameOverride) {
        this._syncSubLayers(); // Synchronize at the start
        super._executeStepOps(step, startFrameOverride);
    }

    _syncSubLayers() {
        const s = this.c.state;
        if (!s.quantizedGenerateV2EnableSyncSubLayers) return;

        // Ensure we only sync once per step (frame-based throttle)
        if (this._syncFrame === this.animFrame) return;
        
        // Only re-sync if Layer 0 might have changed (new maskOps)
        if (this._lastSyncOpCount === this.maskOps.length) return;
        this._lastSyncOpCount = this.maskOps.length;
        
        this._syncFrame = this.animFrame;

        const maxLayer = s.quantizedGenerateV2LayerCount || 1;
        if (maxLayer < 1) return;

        const w = this.logicGridW;
        const h = this.logicGridH;
        const l0Grid = this.layerGrids[0];
        if (!l0Grid) return;

        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        // 1. Identify all active cells in Layer 0 to sync.
        const syncGrid = this._getBuffer('syncGrid', w * h, Uint8Array);
        syncGrid.fill(0);
        for (let i = 0; i < l0Grid.length; i++) {
            if (l0Grid[i] !== -1) syncGrid[i] = 1;
        }

        // 2. Extract rectangles from syncGrid (Greedy Fill)
        const rects = [];
        for (let gy = 0; gy < h; gy++) {
            const rowOffBase = gy * w;
            for (let gx = 0; gx < w; gx++) {
                if (syncGrid[rowOffBase + gx] === 1) {
                    let rw = 0;
                    while (gx + rw < w && syncGrid[rowOffBase + gx + rw] === 1) rw++;
                    let rh = 1;
                    while (gy + rh < h) {
                        let lineFull = true;
                        const targetRowOff = (gy + rh) * w;
                        for (let ix = 0; ix < rw; ix++) {
                            if (syncGrid[targetRowOff + gx + ix] !== 1) { lineFull = false; break; }
                        }
                        if (!lineFull) break;
                        rh++;
                    }
                    rects.push({ x: gx - cx, y: gy - cy, w: rw, h: rh });
                    // Mark as processed
                    for (let iy = 0; iy < rh; iy++) {
                        const markRowOff = (gy + iy) * w;
                        for (let ix = 0; ix < rw; ix++) syncGrid[markRowOff + gx + ix] = 0;
                    }
                }
            }
        }

        // 3. Commit these rectangles to sub-layers if they aren't already covered
        for (const r of rects) {
            const rx = cx + r.x, ry = cy + r.y;
            for (let l = 1; l <= maxLayer; l++) {
                const targetGrid = this.layerGrids[l];
                let fullyCovered = true;
                
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
                    this._spawnBlock(r.x, r.y, r.w, r.h, l, false, 0, true, true, true, true, true);
                }
            }
        }
    }

    stop() {
        super.stop();
    }
}