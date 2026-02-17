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
            { id: 'Centered', method: '_attemptCenteredGrowth' }
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
                const bs = this.getBlockSize();
                const xLimit = (this.g.cols / bs.w / 2) + 1; // Canvas + 1 block
                const yLimit = (this.g.rows / bs.h / 2) + 1;
                
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
                 if (c.skipAnchoring || c.layer === 0) return true;
                 return this._isAnchored(c.x, c.y, c.w, c.h, c.layer);
            },

            // E. Drift Check (Optional sub-layer constraint)
            drift: (c) => {
                if (c.bypassDriftCheck) return true;
                return this._validateAdditionSafety(c.x, c.y, c.layer);
            },

            // F. Spatial Distribution (Prevent clustering in one step)
            spatial: (c) => {
                if (c.isMirroredSpawn || c.isShifter || c.bypassSpatial) return true;
                if (!this._currentStepActions || this._currentStepActions.length === 0) return true;
                
                const cx = c.x + c.w / 2;
                const cy = c.y + c.h / 2;
                
                // Manhattan distance: 20% of max dimension, min 10 blocks
                const minDistance = Math.max(10, Math.floor(Math.max(this.logicGridW, this.logicGridH) * 0.20));

                for (const action of this._currentStepActions) {
                    const ax = action.x + action.w / 2;
                    const ay = action.y + action.h / 2;
                    const dist = Math.abs(cx - ax) + Math.abs(cy - ay);
                    if (dist < minDistance) return false;
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

            // Cache coverage check
            if (this._gridsDirty || this._isCovered === undefined) {
                this._isCovered = this._isCanvasFullyCovered();
            }
            const isCovered = this._isCovered;
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

        // Collect and sort behaviors
        const behaviors = [];
        this.GROWTH_BEHAVIORS.forEach(b => {
            if (getGenConfig('Enable' + b.id)) {
                behaviors.push({
                    id: b.id,
                    method: b.method,
                    order: getGenConfig(b.id + 'Order') || 5,
                    layerOrder: getGenConfig(b.id + 'LayerOrder') || 'primary-first'
                });
            }
        });
        if (getGenConfig('EnableFallback')) {
            behaviors.push({
                id: 'Fallback',
                order: getGenConfig('FallbackOrder') || 10,
                layerOrder: getGenConfig('FallbackLayerOrder') || 'primary-first'
            });
        }
        behaviors.sort((a, b) => a.order - b.order);

        let successInStep = false;

        // 4. Synchronized Layer Growth Loop
        for (let q = 0; q < quota; q++) {
            for (const behavior of behaviors) {
                // Determine layer sequence for this behavior
                let layers = [];
                if (behavior.layerOrder === "primary-first") {
                    for (let l = 0; l <= maxLayer; l++) layers.push(l);
                } else if (behavior.layerOrder === "sub-first") {
                    for (let l = maxLayer; l >= 0; l--) layers.push(l);
                } else if (behavior.layerOrder === "random") {
                    for (let l = 0; l <= maxLayer; l++) layers.push(l);
                    Utils.shuffle(layers);
                }

                for (const targetLayer of layers) {
                    let successForLayer = false;

                    if (behavior.id === 'Fallback') {
                        if (this._attemptSubstituteGrowthWithLayer(targetLayer)) successForLayer = true;
                        else if (this._attemptForceFill(targetLayer)) successForLayer = true;
                    } else if (behavior.id === 'Unfold' || behavior.id === 'Crawler') {
                        if (this._processActiveStatefulBehaviors(targetLayer)) successForLayer = true;
                    } else {
                        if (typeof this[behavior.method] === 'function') {
                            if (this[behavior.method](null, targetLayer)) successForLayer = true;
                        }
                    }

                    if (successForLayer) successInStep = true;
                }
            }
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
        if (!this._gridsDirty && this.logicGrid.some(v => v === 1)) return; // Skip if already synced

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
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

    _attemptForceFill(layer) {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        // Optimized Sampling: Instead of shuffling the entire grid, pick random spots
        // and check neighbors.
        const totalCells = w * h;
        const maxAttempts = Math.min(totalCells, 200); 
        
        for (let i = 0; i < maxAttempts; i++) {
            const gx = Math.floor(Math.random() * w);
            const gy = Math.floor(Math.random() * h);
            const idx = gy * w + gx;
            
            if (grid[idx] === -1) {
                const hasNeighbor = 
                    (gx > 0 && grid[idx - 1] !== -1) ||
                    (gx < w - 1 && grid[idx + 1] !== -1) ||
                    (gy > 0 && grid[idx - w] !== -1) ||
                    (gy < h - 1 && grid[idx + w] !== -1);
                
                if (hasNeighbor) {
                    const bx = gx - cx, by = gy - cy;
                    if (this._spawnBlock(bx, by, 1, 1, layer, false, 0, true, true) !== -1) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // --- CONTROLLER LOGIC ---

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy,
            skipAnchoring: skipConnectivity,
            bypassSpatial: skipConnectivity,
            bypassDriftCheck: skipConnectivity
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
        if (!this.RULES.drift(c)) return false;
        if (!this.RULES.connectivity(c)) return false;
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
        this._syncSubLayers(); // Synchronize existing state first
        super._executeStepOps(step, startFrameOverride);
    }

    _syncSubLayers() {
        const s = this.c.state;
        if (!s.quantizedGenerateV2EnableSyncSubLayers) return;
        if (!this._gridsDirty && this.activeBlocks.length > 0) return; // Only sync if something changed

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