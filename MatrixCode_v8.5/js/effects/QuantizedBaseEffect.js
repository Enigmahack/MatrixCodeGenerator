class QuantizedBaseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        // Default Config Keys (Subclasses should override these or the getters)
        this.configPrefix = "quantizedPulse"; 
        
        // Sequence State
        this.sequence = [[]];
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Grid State
        this.logicGrid = null;
        this.logicGridW = 0;
        this.logicGridH = 0;
        this.renderGrid = null; // Composite Int32Array (Union of all layers)
        this.layerGrids = [];   // Array of Int32Arrays [Layer0, Layer1, Layer2]
        this.removalGrids = []; // Array of Int32Arrays tracking when blocks were removed
        
        // Debug/Editor State
        this.debugMode = false;
        this.manualStep = false;
        this.editorHighlight = false;
        this._boundDebugHandler = this._handleDebugInput.bind(this);
        
        // Render Cache
        this.maskCanvas = null;
        this.maskCtx = null;
        this.scratchCanvas = null;
        this.scratchCtx = null;
        this.gridCacheCanvas = null;
        this.gridCacheCtx = null;
        this._maskDirty = true;
        this.lastGridSeed = -1;
        this.layout = null;
        
        // Logic Grid Scaling (Defaults to 1.0, subclasses can override)
        this.logicScale = 1.0;
        
        // Shadow World Swap State
        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;

        this._edgeCacheDirty = true;
        this._cachedEdgeMaps = []; // Array of Maps, one per layer

        // Optimization: Pre-allocated BFS Queue (Ring Buffer)
        // Max size is logicGridW * logicGridH. Start reasonable, resize if needed.
        this._bfsQueue = new Int32Array(65536); 

        // Line Tracking for Fading and Visibility
        this.lineStates = new Map(); // Key -> { visible: boolean, deathFrame: number }
        this.suppressedFades = new Set(); // Set of Keys to ignore for fading this frame
        this.lastVisibilityChangeFrame = 0;
    }

    _checkDirtiness() {
        if (this._maskDirty) return; // Already dirty, no need to check

        const fadeIn = Math.max(1, this.getConfig('FadeInFrames') || 0);
        const fadeOut = Math.max(1, this.getConfig('FadeFrames') || 0);
        const maxDuration = Math.max(fadeIn, fadeOut) + 2; 

        // 1. Check if any line is still in its fade window
        if (this.animFrame - this.lastVisibilityChangeFrame < fadeOut + 2) {
            this._maskDirty = true;
            return;
        }

        if (this.maskOps) {
            // Optimization: Prune old ops periodically to prevent memory leaks
            if (this.maskOps.length > 2000) {
                this._pruneOps(maxDuration);
            }

            // Check if ANY op is still within the active window
            for (let i = this.maskOps.length - 1; i >= 0; i--) {
                const op = this.maskOps[i];
                const age = this.animFrame - (op.startFrame || 0);
                
                if (age < maxDuration) {
                    this._maskDirty = true;
                    return;
                }
                
                // Since ops are roughly chronological, if the newest is too old, we can stop.
                if (age >= maxDuration) break; 
            }
        }
    }

    _pruneOps(maxDuration) {
        const cutoff = this.animFrame - (maxDuration + 100); // Generous buffer
        const newOps = [];
        let pruned = 0;
        const processedLimit = this._lastProcessedOpIndex || 0;

        for (let i = 0; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            
            // Keep future/unprocessed ops
            if (i >= processedLimit) {
                newOps.push(op);
                continue;
            }

            // Keep Line ops (needed for Edge Cache reconstruction)
            if (op.type === 'addLine' || op.type === 'removeLine' || op.type === 'remLine') {
                newOps.push(op);
                continue;
            }

            // Prune old Raster ops (add, removeBlock, etc.)
            if ((op.startFrame || 0) > cutoff) {
                newOps.push(op);
            } else {
                pruned++;
            }
        }

        if (pruned > 0) {
            this.maskOps = newOps;
            this._lastProcessedOpIndex = Math.max(0, processedLimit - pruned);
        }
    }

    _handleDebugInput(e) {
        if (e.key === '.') {
            this.manualStep = true;
        } else if (e.key === 'Escape') {
            this.active = false;
            this.state = 'IDLE';
            this.alpha = 0.0;
            window.removeEventListener('keydown', this._boundDebugHandler);
        }
    }

    getConfig(keySuffix) {
        // e.g. 'FadeInFrames' -> this.c.state.quantizedPulseFadeInFrames
        const key = this.configPrefix + keySuffix;
        return this.c.state[key];
    }

    getBlockSize() {
        // Try specific config first (e.g. quantizedClimbBlockWidthCells)
        let w = this.c.state[this.configPrefix + 'BlockWidthCells'];
        let h = this.c.state[this.configPrefix + 'BlockHeightCells'];

        // Fallback to legacy/global 'quantized' keys (used by Pulse originally)
        if (w === undefined) w = this.c.state.quantizedBlockWidthCells;
        if (h === undefined) h = this.c.state.quantizedBlockHeightCells;

        // Final Default
        w = w || 4;
        h = h || 4;
        
        return { w, h };
    }

    _initLogicGrid() {
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        
        // Use logicScale for expanded grid (e.g. for Zoom/Generate off-screen expansion)
        const blocksX = Math.ceil((this.g.cols * this.logicScale) / cellPitchX);
        const blocksY = Math.ceil((this.g.rows * this.logicScale) / cellPitchY);
        
        if (!this.logicGrid || this.logicGrid.length !== blocksX * blocksY) {
            this.logicGrid = new Uint8Array(blocksX * blocksY);
        } else {
            this.logicGrid.fill(0);
        }
        this.logicGridW = blocksX;
        this.logicGridH = blocksY;

        if (!this.renderGrid || this.renderGrid.length !== blocksX * blocksY) {
            this.renderGrid = new Int32Array(blocksX * blocksY);
            this.renderGrid.fill(-1);
        }
        
        // Initialize 3 Layers
        for (let i = 0; i < 3; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== blocksX * blocksY) {
                this.layerGrids[i] = new Int32Array(blocksX * blocksY);
                this.layerGrids[i].fill(-1);
            } else {
                this.layerGrids[i].fill(-1);
            }
            if (!this.removalGrids[i] || this.removalGrids[i].length !== blocksX * blocksY) {
                this.removalGrids[i] = new Int32Array(blocksX * blocksY);
            } else {
                this.removalGrids[i].fill(-1);
            }
        }
    }

    trigger(force = false) {
        // Base trigger logic for Editor compatibility
        // Subclasses should call super.trigger(force) or implement similar logic
        if (this.active && !force) return false;
        
        const enabled = this.getConfig('Enabled');
        if (!enabled && !force) return false;

        // Load Pattern if available
        if (window.matrixPatterns && window.matrixPatterns[this.name]) {
            this.sequence = window.matrixPatterns[this.name];
            // Ensure no more than 1000 steps
            if (this.sequence.length > 1000) {
                this.sequence = this.sequence.slice(0, 1000);
            }
        }

        this.active = true;
        
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this._lastProcessedOpIndex = 0;
        this.animFrame = 0;
        this._maskDirty = true;
        this._edgeCacheDirty = true;
        this._distMapDirty = true;
        this._outsideMapDirty = true;
        
        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;
        
        this._initLogicGrid();

        if (this.debugMode) {
            window.removeEventListener('keydown', this._boundDebugHandler);
            window.addEventListener('keydown', this._boundDebugHandler);
        }

        return true;
    }

    _processAnimationStep() {
        if (this.expansionPhase < this.sequence.length) {
            const step = this.sequence[this.expansionPhase];
            if (step) this._executeStepOps(step);
            this.expansionPhase++;
            this._maskDirty = true;
        }
    }

    hitTest(x, y, options = {}) {
        if (!this.layout) return null;
        const l = this.layout;
        
        // Editor offsets if provided
        const offX = options.editorOffX || 0;
        const offY = options.editorOffY || 0;

        // 1. Normalize to Cell Space
        const cellX = (x - offX - l.screenOriginX - l.pixelOffX) / l.screenStepX;
        const cellY = (y - offY - l.screenOriginY - l.pixelOffY) / l.screenStepY;
        
        // 2. Normalize to Block Space
        // We floor the cell coordinates first to get the integer cell index,
        // matching the discrete nature of the screen grid.
        const bx_screen = Math.floor(cellX);
        const by_screen = Math.floor(cellY);

        const rawBx = (bx_screen / l.cellPitchX) + l.offX - l.userBlockOffX;
        const rawBy = (by_screen / l.cellPitchY) + l.offY - l.userBlockOffY;
        
        // 3. Floor to get Logic Index
        const bx = Math.floor(rawBx + 0.001); // Epsilon for float stability
        const by = Math.floor(rawBy + 0.001);
        
        // Relativize to Center
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        // Check bounds roughly
        if (bx >= -10 && bx <= blocksX + 10 && by >= -10 && by <= blocksY + 10) {
            return { x: bx - cx, y: by - cy, absX: bx, absY: by };
        }
        return null;
    }

    jumpToStep(stepIndex) {
        this.maskOps = [];
        this._initLogicGrid();
        this.renderGrid.fill(-1);
        for (let i = 0; i < 3; i++) {
            if (this.layerGrids[i]) this.layerGrids[i].fill(-1);
        }
        this._lastProcessedOpIndex = 0;
        
        const framesPerStep = 1000; // Use large buffer to ensure step isolation

        for (let i = 0; i <= stepIndex; i++) {
            this.expansionPhase = i; // Set phase for op tagging
            const step = this.sequence[i];
            if (step) {
                const simFrame = i * framesPerStep;
                this._executeStepOps(step, simFrame); 
            }
        }
        this.expansionPhase = stepIndex; // Restore target phase
        
        // Sync animation frame to the current step's time so recent ops are "fresh"
        this.animFrame = stepIndex * framesPerStep;

        this._maskDirty = true;
        this._edgeCacheDirty = true;
        this._distMapDirty = true;
        this._outsideMapDirty = true;
    }

    refreshStep() {
        this.jumpToStep(this.expansionPhase);
    }
    
    _executeStepOps(step, startFrameOverride) {
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const now = startFrameOverride !== undefined ? startFrameOverride : this.animFrame;
        
        const getIdx = (bx, by) => {
            if (bx < 0 || bx >= this.logicGridW || by < 0 || by >= this.logicGridH) return -1;
            return by * this.logicGridW + bx;
        };
        const isActive = (dx, dy) => {
            const idx = getIdx(cx + dx, cy + dy);
            return (idx >= 0 && this.logicGrid[idx] === 1);
        };
        const setLocalActive = (dx, dy) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) this.logicGrid[idx] = 1;
        };
        const setLocalInactive = (dx, dy) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) this.logicGrid[idx] = 0;
        };
        const setLayerActive = (dx, dy, l, frame) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0 && this.layerGrids[l]) this.layerGrids[l][idx] = frame;
        };
        const setLayerInactive = (dx, dy, l) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 if (l !== undefined && this.layerGrids[l]) {
                     this.layerGrids[l][idx] = -1;
                 } else {
                     for(let i=0; i<3; i++) if (this.layerGrids[i]) this.layerGrids[i][idx] = -1;
                 }
             }
        };

        // --- COMPRESSED FORMAT DECODER ---
        if (step && step.length > 0 && typeof step[0] === 'number') {
            let i = 0;
            while (i < step.length) {
                const opCode = step[i++];
                
                if (opCode === 1) { // add(x, y)
                    const dx = step[i++];
                    const dy = step[i++];
                    if (isActive(dx, dy)) {
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now, startPhase: this.expansionPhase });
                    } else {
                        this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
                        setLocalActive(dx, dy);
                    }
                } else if (opCode === 2) { // rem(x, y, mask)
                    const dx = step[i++];
                    const dy = step[i++];
                    const mask = step[i++];
                    if (mask === 0) {
                        const nN = isActive(dx, dy - 1);
                        const nS = isActive(dx, dy + 1);
                        const nE = isActive(dx + 1, dy);
                        const nW = isActive(dx - 1, dy);
                        if (nN && nS && nE && nW) {
                            this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now });
                            this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now });
                            this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now });
                            this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now });
                        } else {
                            this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now });
                            setLocalInactive(dx, dy);
                        }
                    } else {
                        if (mask & 1) this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now });
                        if (mask & 2) this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now });
                        if (mask & 4) this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now });
                        if (mask & 8) this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now });
                    }
                } else if (opCode === 3) { // addRect(x1, y1, x2, y2)
                    const dx1 = step[i++];
                    const dy1 = step[i++];
                    const dx2 = step[i++];
                    const dy2 = step[i++];
                    this.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now });
                    const minX = Math.min(cx + dx1, cx + dx2);
                    const maxX = Math.max(cx + dx1, cx + dx2);
                    const minY = Math.min(cy + dy1, cy + dy2);
                    const maxY = Math.max(cy + dy1, cy + dy2);
                    for (let y = minY; y <= maxY; y++) {
                        for (let x = minX; x <= maxX; x++) {
                            const idx = getIdx(x, y);
                            if (idx >= 0) this.logicGrid[idx] = 1;
                        }
                    }
                } else if (opCode === 4) { // addLine(x, y, mask)
                    const dx = step[i++];
                    const dy = step[i++];
                    const mask = step[i++];
                    if (mask & 1) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now, startPhase: this.expansionPhase });
                    if (mask & 2) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now, startPhase: this.expansionPhase });
                    if (mask & 4) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now, startPhase: this.expansionPhase });
                    if (mask & 8) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now, startPhase: this.expansionPhase });
                } else if (opCode === 5) { // remLine(x, y, mask)
                    const dx = step[i++];
                    const dy = step[i++];
                    const mask = step[i++];
                    if (mask & 1) this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now });
                    if (mask & 2) this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now });
                    if (mask & 4) this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now });
                    if (mask & 8) this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now });
                } else if (opCode === 12) { // nudge(x, y, w, h, layer)
                    const dx = step[i++];
                    const dy = step[i++];
                    const w = step[i++];
                    const h = step[i++];
                    const l = step[i++];
                    
                    // 1. Determine Axis and Direction
                    // If dx=0, dy=0 -> No effect
                    if (dx === 0 && dy === 0) continue;
                    // Strictly Diagonal Check: Do nothing
                    if (Math.abs(dx) === Math.abs(dy)) continue;
                    
                    let axis = 'X';
                    let dir = 1;
                    if (Math.abs(dy) > Math.abs(dx)) {
                        axis = 'Y';
                        dir = Math.sign(dy);
                    } else {
                        axis = 'X';
                        dir = Math.sign(dx);
                    }
                    
                    // 2. Identify Blocks to Shift (ALL layers)
                    // We need to scan the grid.
                    const rangeW = this.logicGridW;
                    const rangeH = this.logicGridH;
                    
                    // Helper to get relative coord
                    const toRelX = (bx) => bx - cx;
                    const toRelY = (by) => by - cy;
                    
                    for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
                        const grid = this.layerGrids[layerIdx];
                        const edgeMap = (this._cachedEdgeMaps && this._cachedEdgeMaps[layerIdx]) ? this._cachedEdgeMaps[layerIdx] : null;
                        if (!grid) continue;
                        
                        // We must iterate and collect moves first to avoid double-moving
                        const moves = [];
                        
                        for (let by = 0; by < rangeH; by++) {
                            for (let bx = 0; bx < rangeW; bx++) {
                                const idx = by * rangeW + bx;
                                if (grid[idx] !== -1) {
                                    const rx = toRelX(bx);
                                    const ry = toRelY(by);
                                    
                                    let shouldMove = false;
                                    
                                    if (axis === 'X') {
                                        // Check if block is in the "lane" of the new block
                                        // New block Y range: [dy, dy + h - 1] (assuming dy is top-left of insertion?)
                                        // Editor usually passes center-relative coords.
                                        // Let's assume standard 'add' logic: dx,dy is top-left of the block?
                                        // Actually `add` uses dx,dy as single block. `addRect` uses bounds.
                                        // Editor `add` tool passes `dx, dy`.
                                        // If `w, h` are passed, it's a rect insertion.
                                        
                                        const laneMatch = (ry >= dy && ry < dy + h);
                                        // Check if block is "outward" from insertion
                                        // If dir > 0 (East): rx >= dx
                                        // If dir < 0 (West): rx <= dx
                                        // Actually, if we insert at dx, we push everything AT and AFTER dx.
                                        
                                        const posMatch = (dir > 0) ? (rx >= dx) : (rx <= dx + w - 1); 
                                        // Note: if dir < 0 (West), say insertion at -5. Blocks at -6 should move. 
                                        // Blocks at -5 should move? Yes.
                                        // If insertion is width 1 at -5.
                                        // We push to -6.
                                        
                                        if (laneMatch && posMatch) shouldMove = true;
                                    } else { // Axis Y
                                        const laneMatch = (rx >= dx && rx < dx + w);
                                        const posMatch = (dir > 0) ? (ry >= dy) : (ry <= dy + h - 1);
                                        if (laneMatch && posMatch) shouldMove = true;
                                    }
                                    
                                    if (shouldMove) {
                                        moves.push({ x: rx, y: ry, start: grid[idx], bx, by });
                                    }
                                }
                            }
                        }
                        
                        // 3. Generate Shift Ops
                        if (axis === 'X') {
                            if (dir > 0) moves.sort((a, b) => b.x - a.x);
                            else moves.sort((a, b) => a.x - b.x);
                        } else {
                            if (dir > 0) moves.sort((a, b) => b.y - a.y);
                            else moves.sort((a, b) => a.y - b.y);
                        }

                        for (const m of moves) {
                            if (edgeMap) {
                                const copyLineOp = (face, key) => {
                                    if (edgeMap.has(key)) {
                                        const entry = edgeMap.get(key);
                                        let nx = m.x, ny = m.y;
                                        if (axis === 'X') nx += (dir * w); else ny += (dir * h);
                                        const type = (entry.type === 'add') ? 'addLine' : 'removeLine';
                                        this.maskOps.push({ 
                                            type: type, x1: nx, y1: ny, x2: nx, y2: ny, face: face, force: true, startFrame: now, startPhase: this.expansionPhase, layer: layerIdx 
                                        });
                                    }
                                };
                                copyLineOp('N', `H_${m.bx}_${m.by}`);
                                copyLineOp('S', `H_${m.bx}_${m.by+1}`);
                                copyLineOp('W', `V_${m.bx}_${m.by}`);
                                                            copyLineOp('E', `V_${m.bx+1}_${m.by}`);
                                                        }
                                                        
                                                        // Remove Old
                                                        this.maskOps.push({ type: 'removeBlock', x1: m.x, y1: m.y, x2: m.x, y2: m.y, startFrame: now, startPhase: this.expansionPhase, layer: layerIdx, fade: false });
                                                        setLayerInactive(m.x, m.y, layerIdx);
                                                        
                                                        // Add New (Shifted)
                        let nx = m.x;
                        let ny = m.y;
                            if (axis === 'X') nx += (dir * w);
                            else ny += (dir * h);
                            
                            this.maskOps.push({ type: 'add', x1: nx, y1: ny, x2: nx, y2: ny, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layerIdx });
                            setLayerActive(nx, ny, layerIdx, m.start);
                        }
                    }
                    
                    // 4. Add the Insertion Block
                    this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx + w - 1, y2: dy + h - 1, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: l });
                    
                    // Update Local State (for subsequent ops in this step to see the new block)
                    // Note: 'setLocalActive' only updates simple boolean grid. 
                    // `moves` logic used `layerGrids` which reflects PRE-STEP state + processed ops?
                    // No, `layerGrids` is populated by `_updateRenderGridLogic` which runs BEFORE this loop.
                    // `_executeStepOps` populates `maskOps`. `_updateRenderGridLogic` consumes `maskOps` to build grid.
                    // So `this.layerGrids` contains state from PREVIOUS steps.
                    // This is correct. "Nudge" applies to existing structure.
                    // However, if we have multiple nudges in one step?
                    // The second nudge will see the grid *before* the first nudge.
                    // This might be acceptable, or we might need to update a temp grid.
                    // Given "simple cross structure", overlapping nudges are edge cases.
                    
                    // Update logicGrid for connectivity checks (used by addLine etc)
                    for (let y = dy; y < dy + h; y++) {
                        for (let x = dx; x < dx + w; x++) {
                            setLocalActive(x, y);
                            setLayerActive(x, y, l, now);
                        }
                    }
                } else if (opCode === 6) { // addSmart(x, y)
                    const dx = step[i++];
                    const dy = step[i++];
                    this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
                    setLocalActive(dx, dy);
                } else if (opCode === 7) { // removeBlock(x, y)
                    const dx = step[i++];
                    const dy = step[i++];
                    this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now });
                    setLocalInactive(dx, dy);
                } else if (opCode === 8) { // addLayered(x, y, layer)
                    const dx = step[i++];
                    const dy = step[i++];
                    const l = step[i++];
                    if (isActive(dx, dy)) {
                         // Fallback logic for existing blocks? 
                         // Usually layers are additive, so we just add it.
                         // But if active, we might want to check lines? 
                         // For simplicity, treat as standard add with layer.
                         // However, if we are stacking, we ignore 'isActive' which checks simple logicGrid.
                         // LogicGrid is 1D (boolean). Layers are 3D.
                         // Should we update LogicGrid? Yes, for connectivity checks.
                    }
                    this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, layer: l });
                    setLocalActive(dx, dy);
                    setLayerActive(dx, dy, l, now);
                } else if (opCode === 9) { // addRectLayered(x1, y1, x2, y2, layer)
                    const dx1 = step[i++];
                    const dy1 = step[i++];
                    const dx2 = step[i++];
                    const dy2 = step[i++];
                    const l = step[i++];
                    this.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: l });
                    const minX = Math.min(cx + dx1, cx + dx2);
                    const maxX = Math.max(cx + dx1, cx + dx2);
                    const minY = Math.min(cy + dy1, cy + dy2);
                    const maxY = Math.max(cy + dy1, cy + dy2);
                    for (let y = minY; y <= maxY; y++) {
                        for (let x = minX; x <= maxX; x++) {
                            const idx = getIdx(x, y);
                            if (idx >= 0) this.logicGrid[idx] = 1;
                            setLayerActive(x - cx, y - cy, l, now);
                        }
                    }
                } else if (opCode === 10) { // addSmartLayered
                    const dx = step[i++];
                    const dy = step[i++];
                    const l = step[i++];
                    this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: l });
                    setLocalActive(dx, dy);
                    setLayerActive(dx, dy, l, now);
                } else if (opCode === 11) { // removeBlockLayered
                    const dx = step[i++];
                    const dy = step[i++];
                    const l = step[i++];
                    this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: this.expansionPhase, layer: l });
                    setLocalInactive(dx, dy);
                }
            }
            return;
        }

        for (const opData of step) {
            let op, args, layer;
            if (Array.isArray(opData)) {
                op = opData[0];
                args = opData.slice(1);
            } else {
                op = opData.op;
                args = opData.args;
                layer = opData.layer;
            }
            
            if (op === 'add') {
                const [dx, dy] = args;
                 if (isActive(dx, dy) && (!layer || layer === 0)) {
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now, startPhase: this.expansionPhase });
                } else {
                    this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                    setLocalActive(dx, dy);
                    setLayerActive(dx, dy, layer !== undefined ? layer : 0, now);
                }
            } else if (op === 'addSmart') {
                const [dx, dy] = args;
                this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                setLocalActive(dx, dy);
                setLayerActive(dx, dy, layer !== undefined ? layer : 0, now);
            } else if (op === 'addRect') {
                const [dx1, dy1, dx2, dy2] = args;
                this.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                const minX = Math.min(cx + dx1, cx + dx2);
                const maxX = Math.max(cx + dx1, cx + dx2);
                const minY = Math.min(cy + dy1, cy + dy2);
                const maxY = Math.max(cy + dy1, cy + dy2);
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const idx = getIdx(x, y);
                        if (idx >= 0) this.logicGrid[idx] = 1;
                        setLayerActive(x - cx, y - cy, layer !== undefined ? layer : 0, now);
                    }
                }
            } else if (op === 'rem') {
                const [dx, dy, face] = args;
                 if (face) {
                    this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now, startPhase: this.expansionPhase });
                } else {
                    const nN = isActive(dx, dy - 1);
                    const nS = isActive(dx, dy + 1);
                    const nE = isActive(dx + 1, dy);
                    const nW = isActive(dx - 1, dy);
                    if (nN && nS && nE && nW) {
                        this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now, startPhase: this.expansionPhase });
                        this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now, startPhase: this.expansionPhase });
                    } else {
                        this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                        setLocalInactive(dx, dy);
                        setLayerInactive(dx, dy, layer);
                    }
                }
            } else if (op === 'removeBlock') {
                const [dx, dy] = args;
                this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                setLocalInactive(dx, dy);
                setLayerInactive(dx, dy, layer);
            } else if (op === 'addLine') {
                const [dx, dy, face] = args;
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, startFrame: now, startPhase: this.expansionPhase, layer: layer });
            } else if (op === 'remLine') {
                const [dx, dy, face] = args;
                this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now, startPhase: this.expansionPhase, layer: layer });
            } else if (op === 'addSmartLayered') {
                const [dx, dy] = args; // layer is in 'layer' var
                this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                setLocalActive(dx, dy);
                setLayerActive(dx, dy, layer !== undefined ? layer : 0, now);
            } else if (op === 'removeBlockLayered') {
                const [dx, dy] = args;
                this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: this.expansionPhase, layer: layer });
                setLocalInactive(dx, dy);
                setLayerInactive(dx, dy, layer);
            } else if (op === 'nudge') {
                const [dx, dy, w, h] = args;
                const l = layer || 0;
                
                if (dx === 0 && dy === 0) continue;
                if (Math.abs(dx) === Math.abs(dy)) continue;
                
                let axis = 'X';
                let dir = 1;
                if (Math.abs(dy) > Math.abs(dx)) { axis = 'Y'; dir = Math.sign(dy); }
                else { axis = 'X'; dir = Math.sign(dx); }
                
                const rangeW = this.logicGridW;
                const rangeH = this.logicGridH;
                const toRelX = (bx) => bx - cx;
                const toRelY = (by) => by - cy;
                
                for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
                    const grid = this.layerGrids[layerIdx];
                    const edgeMap = (this._cachedEdgeMaps && this._cachedEdgeMaps[layerIdx]) ? this._cachedEdgeMaps[layerIdx] : null;
                    
                    if (!grid) continue;
                    const moves = [];
                    for (let by = 0; by < rangeH; by++) {
                        for (let bx = 0; bx < rangeW; bx++) {
                            const idx = by * rangeW + bx;
                            if (grid[idx] !== -1) {
                                const rx = toRelX(bx);
                                const ry = toRelY(by);
                                let shouldMove = false;
                                if (axis === 'X') {
                                    const laneMatch = (ry >= dy && ry < dy + h);
                                    const posMatch = (dir > 0) ? (rx >= dx) : (rx <= dx + w - 1); 
                                    if (laneMatch && posMatch) shouldMove = true;
                                } else { 
                                    const laneMatch = (rx >= dx && rx < dx + w);
                                    const posMatch = (dir > 0) ? (ry >= dy) : (ry <= dy + h - 1);
                                    if (laneMatch && posMatch) shouldMove = true;
                                }
                                if (shouldMove) moves.push({ x: rx, y: ry, start: grid[idx], bx, by });
                            }
                        }
                    }
                    
                    // Sort moves
                    if (axis === 'X') {
                        if (dir > 0) moves.sort((a, b) => b.x - a.x);
                        else moves.sort((a, b) => a.x - b.x);
                    } else {
                        if (dir > 0) moves.sort((a, b) => b.y - a.y);
                        else moves.sort((a, b) => a.y - b.y);
                    }

                    for (const m of moves) {
                        // Move Lines Logic
                        if (edgeMap) {
                            const copyLineOp = (face, key) => {
                                if (edgeMap.has(key)) {
                                    const entry = edgeMap.get(key);
                                    // entry.op has type 'addLine'/'remLine' etc.
                                    // We create a NEW op at destination
                                    let nx = m.x, ny = m.y;
                                    if (axis === 'X') nx += (dir * w); else ny += (dir * h);
                                    
                                    // entry.type is 'add' or 'rem' (from rebuildEdgeCache)
                                    // We need to map back to maskOps types: 'addLine', 'removeLine'
                                    const type = (entry.type === 'add') ? 'addLine' : 'removeLine';
                                    
                                    // Check if we already moved this line? 
                                    // No, maskOps are cleared every frame. We just push.
                                    this.maskOps.push({ 
                                        type: type, 
                                        x1: nx, y1: ny, x2: nx, y2: ny, 
                                        face: face, 
                                        force: true, 
                                        startFrame: now, 
                                        startPhase: this.expansionPhase, 
                                        layer: layerIdx,
                                        fade: false
                                    });
                                }
                            };
                            
                            // Check all 4 faces of SOURCE block
                            copyLineOp('N', `H_${m.bx}_${m.by}`);
                            copyLineOp('S', `H_${m.bx}_${m.by+1}`);
                            copyLineOp('W', `V_${m.bx}_${m.by}`);
                            copyLineOp('E', `V_${m.bx+1}_${m.by}`);
                        }

                        this.maskOps.push({ type: 'removeBlock', x1: m.x, y1: m.y, x2: m.x, y2: m.y, startFrame: now, startPhase: this.expansionPhase, layer: layerIdx, fade: false });
                        setLayerInactive(m.x, m.y, layerIdx); 
                        
                        let nx = m.x, ny = m.y;
                        if (axis === 'X') nx += (dir * w); else ny += (dir * h);
                        this.maskOps.push({ type: 'add', x1: nx, y1: ny, x2: nx, y2: ny, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layerIdx });
                        setLayerActive(nx, ny, layerIdx, m.start);
                    }
                }
                this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx + w - 1, y2: dy + h - 1, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: l });
                for (let y = dy; y < dy + h; y++) {
                    for (let x = dx; x < dx + w; x++) {
                        setLocalActive(x, y);
                        setLayerActive(x, y, l, now);
                    }
                }
            }
        }
    }

    _lerpColor(c1, c2, t) {
        if (!c1 || !c2) return c1 || c2 || '#FFFFFF';
        
        // Ensure t is clamped 0..1
        t = Math.max(0, Math.min(1, t));
        
        // Parse hex to rgb
        const parse = (c) => {
            const hex = c.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return {r, g, b};
        };
        
        const rgb1 = parse(c1);
        const rgb2 = parse(c2);
        
        const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * t);
        const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * t);
        const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * t);
        
        return `rgb(${r},${g},${b})`;
    }

    isLineVisible(bx, by, face) {
        const f = face.toUpperCase();
        let key = '';
        if (f === 'N') key = `H_${bx}_${by}`;
        else if (f === 'S') key = `H_${bx}_${by+1}`;
        else if (f === 'W') key = `V_${bx}_${by}`;
        else if (f === 'E') key = `V_${bx+1}_${by}`;
        
        const state = this.lineStates.get(key);
        return state ? state.visible : false;
    }

    isLineFading(bx, by, face) {
        const f = face.toUpperCase();
        let key = '';
        if (f === 'N') key = `H_${bx}_${by}`;
        else if (f === 'S') key = `H_${bx}_${by+1}`;
        else if (f === 'W') key = `V_${bx}_${by}`;
        else if (f === 'E') key = `V_${bx+1}_${by}`;
        
        const state = this.lineStates.get(key);
        if (!state || state.visible || state.deathFrame === -1) return false;
        
        const fadeOutFrames = this.getConfig('FadeFrames') || 0;
        if (fadeOutFrames <= 0) return false;
        
        const age = this.animFrame - state.deathFrame;
        return age >= 0 && age < fadeOutFrames;
    }

    _ensureBfsQueueSize(size) {
        if (!this._bfsQueue || this._bfsQueue.length < size) {
            this._bfsQueue = new Int32Array(size);
        }
    }

    _computeDistanceField(blocksX, blocksY) {
        if (this._distMap && this._distMapWidth === blocksX && this._distMapHeight === blocksY && !this._distMapDirty) {
            return this._distMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        if (!this._distMap || this._distMap.length !== size) {
            this._distMap = new Uint16Array(size);
        }
        const dist = this._distMap;
        const maxDist = 999;
        dist.fill(maxDist);

        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;
        
        for (let i = 0; i < size; i++) {
            if (this.renderGrid[i] === -1) {
                dist[i] = 0;
                queue[tail++] = i;
            }
        }

        while(head < tail) {
            const idx = queue[head++];
            const d = dist[idx];
            
            const cx = idx % blocksX;
            const cy = (idx / blocksX) | 0;

            if (cy > 0) {
                const nIdx = idx - blocksX;
                if (dist[nIdx] === maxDist) {
                    dist[nIdx] = d + 1;
                    queue[tail++] = nIdx;
                }
            }
            if (cy < blocksY - 1) {
                const nIdx = idx + blocksX;
                if (dist[nIdx] === maxDist) {
                    dist[nIdx] = d + 1;
                    queue[tail++] = nIdx;
                }
            }
            if (cx > 0) {
                const nIdx = idx - 1;
                if (dist[nIdx] === maxDist) {
                    dist[nIdx] = d + 1;
                    queue[tail++] = nIdx;
                }
            }
            if (cx < blocksX - 1) {
                const nIdx = idx + 1;
                if (dist[nIdx] === maxDist) {
                    dist[nIdx] = d + 1;
                    queue[tail++] = nIdx;
                }
            }
        }

        this._distMapWidth = blocksX;
        this._distMapHeight = blocksY;
        this._distMapDirty = false;
        
        return dist;
    }

    _computeTrueOutside(blocksX, blocksY) {
        if (this._outsideMap && this._outsideMapWidth === blocksX && this._outsideMapHeight === blocksY && !this._outsideMapDirty) {
            return this._outsideMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        if (!this._outsideMap || this._outsideMap.length !== size) {
            this._outsideMap = new Uint8Array(size);
        }
        const status = this._outsideMap;
        status.fill(0); // Reset for new computation

        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && this.renderGrid[idx] === -1) { 
                status[idx] = 1;
                queue[tail++] = idx;
            }
        };

        for (let x = 0; x < blocksX; x++) { 
            add(x); 
            add((blocksY - 1) * blocksX + x); 
        }
        for (let y = 1; y < blocksY - 1; y++) {
            add(y * blocksX); 
            add(y * blocksX + (blocksX - 1)); 
        }

        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % blocksX;
            const cy = (idx / blocksX) | 0;
            
            if (cy > 0) add(idx - blocksX);
            if (cy < blocksY - 1) add(idx + blocksX);
            if (cx > 0) add(idx - 1);
            if (cx < blocksX - 1) add(idx + 1);
        }
        
        this._outsideMapWidth = blocksX;
        this._outsideMapHeight = blocksY;
        this._outsideMapDirty = false;

        return status;
    }

    updateTransition(deactivate = true) {
        if (!this.isSwapping) return false;

        // Keep applying overrides during swap transition buffer
        this._updateShadowSim();
        
        this.swapTimer--;
        if (this.swapTimer <= 0) {
            // Transition Complete
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            
            this.isSwapping = false;
            this.hasSwapped = true;
            
            // Cleanup
            this.shadowGrid = null;
            this.shadowSim = null;
            
            if (deactivate) {
                this.active = false;
                this.state = 'IDLE';
                window.removeEventListener('keydown', this._boundDebugHandler);
            }
            return true;
        }
        return false;
    }

    _swapStates() {
        if (this.hasSwapped || this.isSwapping) return;
        
        const result = this._commitShadowState();
        
        if (result === 'ASYNC') {
            this.isSwapping = true;
            this.swapTimer = 5; 
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            this.hasSwapped = true;
        } else {
            this.g.clearAllOverrides();
            this.active = false;
        }
    }

    _ensureCanvases(w, h) {
        if (!this.maskCanvas) {
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d');
            this._maskDirty = true;
        }
        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCtx = this.scratchCanvas.getContext('2d');
        }
        if (!this.gridCacheCanvas) {
            this.gridCacheCanvas = document.createElement('canvas');
            this.gridCacheCtx = this.gridCacheCanvas.getContext('2d');
        }
        if (!this.perimeterMaskCanvas) {
            this.perimeterMaskCanvas = document.createElement('canvas');
            this.perimeterMaskCtx = this.perimeterMaskCanvas.getContext('2d');
        }
        if (!this.lineMaskCanvas) {
            this.lineMaskCanvas = document.createElement('canvas');
            this.lineMaskCtx = this.lineMaskCanvas.getContext('2d');
        }

        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
            this.maskCanvas.width = w;
            this.maskCanvas.height = h;
            this._maskDirty = true;
        }
        if (this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
            this.scratchCanvas.width = w;
            this.scratchCanvas.height = h;
        }
        if (this.gridCacheCanvas.width !== w || this.gridCacheCanvas.height !== h) {
            this.gridCacheCanvas.width = w;
            this.gridCacheCanvas.height = h;
            this.lastGridSeed = -1; 
        }
        if (this.perimeterMaskCanvas.width !== w || this.perimeterMaskCanvas.height !== h) {
            this.perimeterMaskCanvas.width = w;
            this.perimeterMaskCanvas.height = h;
        }
        if (this.lineMaskCanvas.width !== w || this.lineMaskCanvas.height !== h) {
            this.lineMaskCanvas.width = w;
            this.lineMaskCanvas.height = h;
        }
        
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        
        if (blocksX && blocksY) {
            const requiredSize = blocksX * blocksY;
            if (!this.renderGrid || this.renderGrid.length !== requiredSize) {
                 this.renderGrid = new Int32Array(requiredSize);
                 this.renderGrid.fill(-1);
            }
            for (let i = 0; i < 3; i++) {
                if (!this.layerGrids[i] || this.layerGrids[i].length !== requiredSize) {
                    this.layerGrids[i] = new Int32Array(requiredSize);
                    this.layerGrids[i].fill(-1);
                }
            }
        }
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const s = this.c.state;
        const d = this.c.derived;

        // --- Robust Warmup (Fast Forward) ---
        // Instead of manually injecting streams (which is error-prone and misses erasers),
        // we simply run the simulation at max speed without rendering until it reaches a steady state.
        
        // Calculate how many frames are needed for a stream to cross the screen
        // tickInterval approx = 21 - speed. 
        const avgTickInterval = Math.max(1, 21 - (s.streamSpeed || 10));
        const rows = this.shadowGrid.rows;
        
        // We want enough time for:
        // 1. Initial streams to spawn and fall (1x traversal)
        // 2. Initial streams to die and spawn erasers
        // 3. New streams to replace them (Steady State)
        // Factor 2.5 ensures complete turnover and density stabilization.
        let warmupFrames = Math.floor(rows * avgTickInterval * 2.5);
        
        // Safety Clamps
        warmupFrames = Math.max(200, warmupFrames); // Minimum 200 frames
        warmupFrames = Math.min(5000, warmupFrames); // Cap at 5000 to prevent freeze on very slow settings
        
        // Run the simulation loop
        // Since useWorker is false and we aren't rendering, this is just array math and is very fast.
        for (let i = 0; i < warmupFrames; i++) {
            this.shadowSim.update(i);
        }
        
        this.shadowSimFrame = warmupFrames;
    }

    _initShadowWorldBase(workerEnabled = false) {
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        // Fix: Match Main Grid dimensions exactly to prevent StreamManager array mismatch
        // (which triggers auto-resize/wipe on swap). Buffer logic moved to render offset.
        const w = this.g.cols * d.cellWidth; 
        const h = this.g.rows * d.cellHeight;
        this.shadowGrid.resize(w, h);
        
        this.shadowSim = new SimulationSystem(this.shadowGrid, this.c, false);
        this.shadowSim.useWorker = workerEnabled;

        if (!workerEnabled && this.shadowSim.worker) {
            this.shadowSim.worker.terminate();
            this.shadowSim.worker = null;
        }
        
        const sm = this.shadowSim.streamManager;
        sm.resize(this.shadowGrid.cols);
        this.shadowSim.timeScale = 1.0;
        
        return this.shadowSim;
    }

    _commitShadowState() {
        if (!this.shadowGrid || !this.shadowSim) return false;
        
        try {
            const g = this.g;
            const sg = this.shadowGrid;
            this._copyGridBuffers(g, sg);
            
            if (window.matrix && window.matrix.simulation) {
                const mainSim = window.matrix.simulation;
                const shadowMgr = this.shadowSim.streamManager;
                
                const streamsToSerialize = new Set(shadowMgr.activeStreams);
                const addRefs = (arr) => { for (const s of arr) { if (s) streamsToSerialize.add(s); } };
                addRefs(shadowMgr.lastStreamInColumn);
                addRefs(shadowMgr.lastEraserInColumn);
                addRefs(shadowMgr.lastUpwardTracerInColumn);

                const streamMap = new Map();
                const serializedActiveStreams = [];

                for (const s of streamsToSerialize) {
                    const copy = {...s};
                    if (copy.holes instanceof Set) copy.holes = Array.from(copy.holes);
                    streamMap.set(s, copy);
                    if (shadowMgr.activeStreams.includes(s)) serializedActiveStreams.push(copy);
                }

                const serializeRefArray = (arr) => arr.map(s => (s && streamMap.has(s)) ? streamMap.get(s) : null);
                
                const state = {
                    activeStreams: serializedActiveStreams, 
                    columnSpeeds: shadowMgr.columnSpeeds,
                    streamsPerColumn: shadowMgr.streamsPerColumn,   
                    lastStreamInColumn: serializeRefArray(shadowMgr.lastStreamInColumn),
                    lastEraserInColumn: serializeRefArray(shadowMgr.lastEraserInColumn),
                    lastUpwardTracerInColumn: serializeRefArray(shadowMgr.lastUpwardTracerInColumn),
                    nextSpawnFrame: shadowMgr.nextSpawnFrame,
                    overlapInitialized: this.shadowSim.overlapInitialized,
                    _lastOverlapDensity: this.shadowSim._lastOverlapDensity,
                    activeIndices: Array.from(sg.activeIndices)
                };
                
                const frameOffset = mainSim.frame || 0; 
                const shadowFrame = (this.shadowSimFrame !== undefined) ? this.shadowSimFrame : (this.localFrame || 0);
                const delta = frameOffset - shadowFrame;
                state.nextSpawnFrame = shadowMgr.nextSpawnFrame + delta;

                if (mainSim.useWorker && mainSim.worker) {
                    mainSim.worker.postMessage({ type: 'replace_state', state: state });
                    mainSim.worker.postMessage({ type: 'config', config: { state: JSON.parse(JSON.stringify(this.c.state)), derived: this.c.derived } });
                    return 'ASYNC';
                } else {
                    state.activeStreams.forEach(s => { if (Array.isArray(s.holes)) s.holes = new Set(s.holes); });
                    const mainMgr = mainSim.streamManager;
                    mainMgr.activeStreams = state.activeStreams;
                    mainMgr.columnSpeeds.set(state.columnSpeeds);
                    if (mainMgr.streamsPerColumn && state.streamsPerColumn) mainMgr.streamsPerColumn.set(state.streamsPerColumn);
                    mainMgr.lastStreamInColumn = state.lastStreamInColumn;
                    mainMgr.lastEraserInColumn = state.lastEraserInColumn;
                    mainMgr.lastUpwardTracerInColumn = state.lastUpwardTracerInColumn;
                    mainMgr.nextSpawnFrame = state.nextSpawnFrame;
                    mainSim.overlapInitialized = state.overlapInitialized;
                    mainSim._lastOverlapDensity = state._lastOverlapDensity;
                    if (state.activeIndices) {
                        mainSim.grid.activeIndices.clear();
                        state.activeIndices.forEach(idx => mainSim.grid.activeIndices.add(idx));
                    }
                    return 'SYNC';
                }
            }
            return 'SYNC';
        } catch (e) {
            console.error("[QuantizedEffect] Swap failed:", e);
            return false;
        }
    }

    _copyGridBuffers(g, sg) {
        const copyData = (target, source) => {
            if (!target || !source) return;
            if (source.length === target.length && sg.cols === g.cols) {
                target.set(source);
            } else {
                const rows = Math.min(sg.rows, g.rows);
                const cols = Math.min(sg.cols, g.cols);
                            for (let y = 0; y < rows; y++) {
                                const srcOff = y * sg.cols;
                                const dstOff = y * g.cols;
                                target.set(source.subarray(srcOff, srcOff + cols), dstOff);
                            }            }
        };

        copyData(g.state, sg.state); 
        copyData(g.chars, sg.chars);
        copyData(g.colors, sg.colors);
        copyData(g.baseColors, sg.baseColors); 
        copyData(g.alphas, sg.alphas);
        copyData(g.glows, sg.glows);
        copyData(g.fontIndices, sg.fontIndices);
        copyData(g.renderMode, sg.renderMode); 
        
        copyData(g.types, sg.types);
        copyData(g.decays, sg.decays);
        copyData(g.maxDecays, sg.maxDecays);
        copyData(g.ages, sg.ages);
        copyData(g.brightness, sg.brightness);
        copyData(g.rotatorOffsets, sg.rotatorOffsets);
        copyData(g.cellLocks, sg.cellLocks);
        
        copyData(g.nextChars, sg.nextChars);
        copyData(g.nextOverlapChars, sg.nextOverlapChars);
        
        copyData(g.secondaryChars, sg.secondaryChars);
        copyData(g.secondaryColors, sg.secondaryColors);
        copyData(g.secondaryAlphas, sg.secondaryAlphas);
        copyData(g.secondaryGlows, sg.secondaryGlows);
        copyData(g.secondaryFontIndices, sg.secondaryFontIndices);
        
        copyData(g.mix, sg.mix);
        
        if (sg.activeIndices.size > 0) {
            g.activeIndices.clear();
            for (const idx of sg.activeIndices) {
                const x = idx % sg.cols;
                const y = Math.floor(idx / sg.cols);
                if (x < g.cols && y < g.rows) {
                    const newIdx = y * g.cols + x;
                    g.activeIndices.add(newIdx);
                }
            }
        }
        
        g.complexStyles.clear();
        for (const [key, value] of sg.complexStyles) {
            const x = key % sg.cols;
            const y = Math.floor(key / sg.cols);
            if (x < g.cols && y < g.rows) {
                const newKey = y * g.cols + x;
                g.complexStyles.set(newKey, {...value});
            }
        }
    }

    _updateGridCache(w, h, s, d) {
        const rotatorCycle = d.rotatorCycleFrames || 20;
        const timeSeed = Math.floor(this.animFrame / rotatorCycle);
        
        if (timeSeed === this.lastGridSeed && !this._gridCacheDirty) return; 
        this.lastGridSeed = timeSeed;
        this._gridCacheDirty = false;
        
        const ctx = this.gridCacheCtx;
        ctx.clearRect(0, 0, w, h);
        
        const glowStrength = this.getConfig('BorderIllumination') || 0;
        const t = Math.min(1.0, glowStrength / 10.0);
        const charR = 255;
        const charG = Math.floor(204 + (255 - 204) * t);
        const charB = Math.floor(0 + (255 - 0) * t);
        const charColor = `rgb(${charR}, ${charG}, ${charB})`;
        
        const visualFontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        ctx.font = `${style}${weight} ${visualFontSize}px ${family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = charColor;
        
        const grid = this.g;
        const shadowGrid = this.shadowGrid;
        
        // Halo Logic Params
        const distMap = this._distMap;
        const distW = this._distMapWidth;
        const distH = this._distMapHeight;
        const l = this.layout;
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        
        const screenOriginX = ((s.fontOffsetX - (grid.cols * d.cellWidth * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (grid.rows * d.cellHeight * 0.5)) * s.stretchY) + (h * 0.5);
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;

        const drawChar = (x, y) => {
            // DEBUG COUNT
            this._debugCharCount = (this._debugCharCount || 0) + 1;

            let charCode = 32;
            let i = -1;
            
            // Halo Check: Prefer Shadow Code near active blocks to support full-width perimeter lines
            let useShadow = false;
            if (shadowGrid && distMap && l) {
                // Map Cell to Logic Block
                // bx = (x - offX + userOff) / pitch ?? No.
                // _updateShadowSim: destBx = bx - offX + userBlockOffX
                // So bx (Logic) = destBx + offX - userBlockOffX
                // Cell x is destBx * pitch. So destBx = x / pitch.
                // bx = (x / l.cellPitchX) + l.offX - l.userBlockOffX
                // Note: l.offX is ALREADY calculated as (LogicCenter - ScreenCenter).
                // So Screen = Logic - Off. Logic = Screen + Off.
                const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                const by = Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY);
                
                if (bx >= 0 && bx < distW && by >= 0 && by < distH) {
                    const dIdx = by * distW + bx;
                    // Distance 0 = Inside. Distance 1 = Adjacent (Boundary).
                    // We want Shadow Code in both to ensure the boundary line sees code.
                    if (distMap[dIdx] <= 1) useShadow = true;
                }
            }

            if (x >= 0 && x < cols && y >= 0 && y < rows) {
                i = (y * cols) + x;
                
                if (useShadow && shadowGrid.chars) {
                    // Force Shadow Code (Static)
                    charCode = shadowGrid.chars[i];
                } else if (grid.overrideActive && grid.overrideActive[i] > 0) {
                    // Standard Override (likely same as Shadow if inside, but allows other fx)
                    charCode = grid.overrideChars[i];
                } else {
                    // Rain
                    charCode = chars[i];
                }
            } else {
                i = (y * 10000) + x; 
                charCode = 0; 
            }

            if (charCode <= 32) {
                const activeFonts = d.activeFonts;
                const fontData = activeFonts[0] || { chars: "01" };
                const charSet = fontData.chars;
                
                const seed = i * 12.9898 + timeSeed * 78.233;
                const hash = Math.abs(Math.sin(seed) * 43758.5453) % 1;
                
                const char = charSet[Math.floor(hash * charSet.length)];
                charCode = (char) ? char.charCodeAt(0) : 32;
            }
            
            const cx = screenOriginX + ((x + 0.5) * screenStepX);
            const cy = screenOriginY + ((y + 0.5) * screenStepY);
            
            if (s.stretchX !== 1 || s.stretchY !== 1) {
                ctx.setTransform(s.stretchX, 0, 0, s.stretchY, cx, cy);
                ctx.fillText(String.fromCharCode(charCode), 0, 0);
            } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillText(String.fromCharCode(charCode), cx, cy);
            }
        };

        // Render entire grid with padding
        const padding = 5;
        for (let y = -padding; y < rows + padding; y++) {
            for (let x = -padding; x < cols + padding; x++) {
                drawChar(x, y);
            }
        }
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    _updateRenderGridLogic() {
        if (!this.logicGridW || !this.logicGridH) return;

        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const totalBlocks = blocksX * blocksY;

        // Ensure buffers exist
        if (!this.renderGrid || this.renderGrid.length !== totalBlocks) {
            this.renderGrid = new Int32Array(totalBlocks);
            this.renderGrid.fill(-1);
        }
        for (let i = 0; i < 3; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== totalBlocks) {
                this.layerGrids[i] = new Int32Array(totalBlocks);
                this.layerGrids[i].fill(-1);
            }
        }

        if (!this.maskOps) return;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        
        // Ensure grids are clean if we are starting fresh
        if (startIndex === 0) {
            this.renderGrid.fill(-1);
            for (let i = 0; i < 3; i++) {
                this.layerGrids[i].fill(-1);
            }
        }
        
        let processed = 0;
        let i = startIndex;
        for (; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            if (op.startFrame && this.animFrame < op.startFrame) {
                // Op is in the future. Stop processing and resume here next time.
                break;
            }

            processed++;
            const layerIdx = (op.layer !== undefined && op.layer >= 0 && op.layer <= 2) ? op.layer : 0;
            const targetGrid = this.layerGrids[layerIdx];

            if (op.type === 'add' || op.type === 'addSmart') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.max(0, Math.min(start.x, end.x));
                const maxX = Math.min(blocksX - 1, Math.max(start.x, end.x));
                const minY = Math.max(0, Math.min(start.y, end.y));
                const maxY = Math.min(blocksY - 1, Math.max(start.y, end.y));
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = by * blocksX + bx;
                        targetGrid[idx] = op.startFrame || 0;
                        if (this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = -1;
                    }
                }
            } else if (op.type === 'removeBlock') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.max(0, Math.min(start.x, end.x));
                const maxX = Math.min(blocksX - 1, Math.max(start.x, end.x));
                const minY = Math.max(0, Math.min(start.y, end.y));
                const maxY = Math.min(blocksY - 1, Math.max(start.y, end.y));
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = by * blocksX + bx;
                        const remFrame = op.startFrame || 0;
                        if (op.layer !== undefined) {
                            targetGrid[idx] = -1;
                            if (op.fade !== false && this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = remFrame;
                        } else {
                            for (let l = 0; l < 3; l++) {
                                this.layerGrids[l][idx] = -1;
                                if (op.fade !== false && this.removalGrids[l]) this.removalGrids[l][idx] = remFrame;
                            }
                        }
                    }
                }
            }
        }
        
        // Flatten Layers to Composite renderGrid (Union for Shadow World)
        // Also used for distance field calculation
        // Priority: Top layer (2) > 1 > 0
        for (let idx = 0; idx < totalBlocks; idx++) {
            let val = -1;
            if (this.layerGrids[2][idx] !== -1) val = this.layerGrids[2][idx];
            else if (this.layerGrids[1][idx] !== -1) val = this.layerGrids[1][idx];
            else if (this.layerGrids[0][idx] !== -1) val = this.layerGrids[0][idx];
            
            this.renderGrid[idx] = val;
        }

        this._lastProcessedOpIndex = i;
        
        this._lastBlocksX = blocksX;
        this._lastBlocksY = blocksY;
        this._lastPitchX = cellPitchX;
        this._lastPitchY = cellPitchY;
        
        if (processed > 0) {
            // Flatten Layers to Composite renderGrid (Union for Shadow World)
            // Also used for distance field calculation
            // Priority: Top layer (2) > 1 > 0
            for (let idx = 0; idx < totalBlocks; idx++) {
                let val = -1;
                if (this.layerGrids[2][idx] !== -1) val = this.layerGrids[2][idx];
                else if (this.layerGrids[1][idx] !== -1) val = this.layerGrids[1][idx];
                else if (this.layerGrids[0][idx] !== -1) val = this.layerGrids[0][idx];
                
                this.renderGrid[idx] = val;
            }

            this._distMapDirty = true;
            this._outsideMapDirty = true;
            this._maskDirty = true;
            this._gridCacheDirty = true;
            this._edgeCacheDirty = true;
        }
    }

    _computeCenteredOffset(blocksX, blocksY, pitchX, pitchY) {
        // Calculate offset in CELLS to align the center of the Logic Grid 
        // with the center of the Main Grid (Screen).
        // This ensures consistent alignment regardless of grid size or block parity.
        
        const logicCellsX = blocksX * pitchX;
        const logicCellsY = blocksY * pitchY;
        
        const screenCellsX = this.g.cols;
        const screenCellsY = this.g.rows;
        
        // We want: LogicCenter = ScreenCenter
        // Offset = (LogicCells - ScreenCells) / 2
        // We use floating point to allow sub-cell precision (perfect centering)
        const cellOffX = (logicCellsX - screenCellsX) / 2.0;
        const cellOffY = (logicCellsY - screenCellsY) / 2.0;
        
        // Convert back to blocks (fractional) for the rendering logic
        const offX = cellOffX / pitchX;
        const offY = cellOffY / pitchY;
        
        return { offX, offY };
    }

    _updateShadowSim() {
        if (!this.shadowSim) return;
        
        this.shadowSim.update(++this.shadowSimFrame);
        
        if (!this.renderGrid || !this._lastBlocksX) return;

        const blocksX = this._lastBlocksX;
        const blocksY = this._lastBlocksY;
        const pitchX = this._lastPitchX;
        const pitchY = this._lastPitchY;
        
        const outsideMask = this._computeTrueOutside(blocksX, blocksY);
        
        const sg = this.shadowGrid;
        const g = this.g;
        
        // Use centered offset logic
        const { offX, offY } = this._computeCenteredOffset(blocksX, blocksY, pitchX, pitchY);
        const screenBlocksX = Math.ceil(g.cols / pitchX);
        const screenBlocksY = Math.ceil(g.rows / pitchY);

        const bs = this.getBlockSize();
        // Reset offset
        const oddShiftY = 0.0; 
        
        // User Offsets
        const userShadowOffsetX = this.c.state.quantizedShadowOffsetX || 0;
        const userShadowOffsetY = this.c.state.quantizedShadowOffsetY || 0;
        // Convert pixels to blocks (approximate, assuming resolution scale 1 for logic)
        // Note: cellWidth/Height in 'derived' are pixels. 
        const userBlockOffX = userShadowOffsetX / (this.c.derived.cellWidth * pitchX);
        const userBlockOffY = userShadowOffsetY / (this.c.derived.cellHeight * pitchY);

        // PASS 1: Clear Outside (Void) areas
        // We run this first so that if an 'Inside' block overlaps an 'Outside' block, 
        // the 'Inside' block (Pass 2) will overwrite the clear, ensuring expanded borders 
        // aren't clipped by neighbors.
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                if (outsideMask[idx] !== 1) continue; // Skip Inside

                const destBx = bx - offX + userBlockOffX;
                const destBy = by - offY + userBlockOffY;
                
                // Allow slightly out of bounds due to shifts
                // Since offX/offY can be fractional, we use a slightly wider tolerance
                if (destBx < -1.5 || destBx > screenBlocksX + 0.5 || destBy < -1.5 || destBy > screenBlocksY + 0.5) continue;
                
                        // Robust Coverage: Use Round to snap to the nearest cell boundary, matching the visual mask/lines.
                        // This ensures strict alignment with _renderEdges and prevents "leaking" characters.
                        const startCellX = Math.round(destBx * pitchX);
                        const startCellY = Math.round(destBy * pitchY);
                        const endCellX = Math.round((destBx + 1) * pitchX);
                        const endCellY = Math.round((destBy + 1) * pitchY);                
                for (let cy = startCellY; cy < endCellY; cy++) {
                    if (cy >= g.rows || cy < 0) continue;
                    for (let cx = startCellX; cx < endCellX; cx++) {
                        if (cx >= g.cols || cx < 0) continue;
                        
                        const destIdx = cy * g.cols + cx;
                        if (g.overrideActive[destIdx] === 3) {
                            g.overrideActive[destIdx] = 0;
                        }
                    }
                }
            }
        }

        // PASS 2: Draw Inside (Shadow) areas
        if (this.c.state.layerEnableShadowWorld !== false) {
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    const idx = by * blocksX + bx;
                    if (outsideMask[idx] === 1) continue; // Skip Outside

                    const destBx = bx - offX + userBlockOffX;
                    const destBy = by - offY + userBlockOffY;
                    
                    if (destBx < -1.5 || destBx > screenBlocksX + 0.5 || destBy < -1.5 || destBy > screenBlocksY + 0.5) continue;
                    
                            // Robust Coverage: Use Round to snap to the nearest cell boundary, matching the visual mask/lines.
                            // This ensures strict alignment with _renderEdges and prevents "leaking" characters.
                            const startCellX = Math.round(destBx * pitchX);
                            const startCellY = Math.round(destBy * pitchY);
                            const endCellX = Math.round((destBx + 1) * pitchX);
                            const endCellY = Math.round((destBy + 1) * pitchY);                    
                    for (let cy = startCellY; cy < endCellY; cy++) {
                        if (cy >= g.rows || cy < 0) continue;
                        for (let cx = startCellX; cx < endCellX; cx++) {
                            if (cx >= g.cols || cx < 0) continue;
                            
                            const destIdx = cy * g.cols + cx;
                            // Source reads from Shadow Grid (aligned 0,0)
                            const srcIdx = cy * sg.cols + cx;
                            
                            if (sg && sg.chars && srcIdx < sg.chars.length) {
                                g.overrideActive[destIdx] = 3; 
                                g.overrideChars[destIdx] = sg.chars[srcIdx];
                                g.overrideColors[destIdx] = sg.colors[srcIdx];
                                
                                let finalAlpha = sg.alphas[srcIdx];
                                const innerFadeFrames = this.getConfig('InnerFadeFrames') || 0;
                                if (innerFadeFrames > 0) {
                                    const bIdx = by * blocksX + bx;
                                    const startFrame = this.renderGrid[bIdx];
                                    if (startFrame !== -1) {
                                        const age = this.animFrame - startFrame;
                                        const blockAlpha = Math.min(1.0, Math.max(0, age / innerFadeFrames));
                                        finalAlpha *= blockAlpha;
                                    }
                                }
                                g.overrideAlphas[destIdx] = finalAlpha;

                                g.overrideGlows[destIdx] = sg.glows[srcIdx];
                                g.overrideMix[destIdx] = sg.mix[srcIdx];
                                g.overrideNextChars[destIdx] = sg.nextChars[srcIdx];
                                g.overrideFontIndices[destIdx] = sg.fontIndices[srcIdx];
                            }
                        }
                    }
                }
            }
        }
    }

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;

        // Ensure passive animations (like line fades) keep the mask dirty
        this._checkDirtiness();

        // Ensure Grid Logic is up to date for this frame
        this._updateRenderGridLogic();

        const s = this.c.state;
        const glowStrength = this.getConfig('BorderIllumination') || 0;
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); 

        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height || this.debugMode) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        const showLines = (this.c.state.layerEnableQuantizedLines !== false);
        const showSource = (this.c.state.layerEnableQuantizedGridCache === true);

        if ((glowStrength > 0 && showLines) || showSource) {
            const isSolid = this.c.state.quantizedSolidPerimeter || false;
            this._updateGridCache(width, height, s, d);
            
            // Draw Source Grid (Debug Layer)
            if (showSource) {
                const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (d.cellWidth * 0.5);
                const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (d.cellHeight * 0.5);
                ctx.save();
                ctx.globalAlpha = 0.3; // Reduced to 30% opacity
                ctx.globalCompositeOperation = 'source-over';
                ctx.translate(srcOffX, srcOffY);
                ctx.drawImage(this.gridCacheCanvas, 0, 0);
                ctx.restore();
            }

            if (showLines && glowStrength > 0) {
                const scratchCtx = this.scratchCtx;
                const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (d.cellWidth * 0.5);
                const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (d.cellHeight * 0.5);

                scratchCtx.globalCompositeOperation = 'source-over';
                scratchCtx.clearRect(0, 0, width, height);

                if (isSolid) {
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.drawImage(this.perimeterMaskCanvas, 0, 0);
                } else {
                    scratchCtx.globalAlpha = 1.0; 
                    scratchCtx.save();
                    scratchCtx.translate(srcOffX, srcOffY);
                    scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
                    scratchCtx.restore();
                    
                    scratchCtx.globalCompositeOperation = 'source-in';
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.drawImage(this.perimeterMaskCanvas, 0, 0);
                }
                
                ctx.save();
                ctx.globalCompositeOperation = 'lighter'; 
                ctx.globalAlpha = 1.0;
                ctx.drawImage(this.scratchCanvas, 0, 0);
                ctx.restore();
            }
        }
    }

    renderDebug(ctx, derived) {
        if (!this.debugMode) return;
        
        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        if (!this.layout || this.maskCanvas.width !== width || this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }

        this._updateGridCache(width, height, s, derived);
        
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        scratchCtx.globalAlpha = 1.0; 
        const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (derived.cellWidth * 0.5);
        const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (derived.cellHeight * 0.5);
        scratchCtx.save();
        scratchCtx.translate(srcOffX, srcOffY);
        scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
        scratchCtx.restore();

        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(this.maskCanvas, 0, 0);

        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        
        const glowStrength = this.getConfig('BorderIllumination') || 4.0;
        const t = Math.min(1.0, glowStrength / 10.0);
        const glowR = 255;
        const glowG = Math.floor(215 + (255 - 215) * t);
        const glowB = Math.floor(0 + (255 - 0) * t);
        const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;
        
        ctx.globalAlpha = 1.0;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = (glowStrength * 4.0);
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();
    }

    renderEditorPreview(ctx, derived, previewOp) {
        const opHash = previewOp ? JSON.stringify(previewOp) : "";
        const stateHash = `${this.maskOps.length}_${this.expansionPhase}_${opHash}`;
        
        if (stateHash !== this._lastPreviewStateHash) {
            const savedLogicGrid = new Uint8Array(this.logicGrid);
            const savedMaskOpsLen = this.maskOps.length;
            
            if (previewOp) {
                this._executeStepOps([previewOp]);
            }
            
            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
            
            this._maskDirty = true; 
            
            this._lastPreviewSavedLogic = savedLogicGrid;
            this._lastPreviewSavedOpsLen = savedMaskOpsLen;
            this._lastPreviewStateHash = stateHash;
            this._previewActive = true;
        }

        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        // ALWAYS check dirtiness to support fading lines
        this._checkDirtiness();

        if (this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }
        
        const isSolid = this.c.state.quantizedSolidPerimeter || false;
        
        // Draw Source Grid (Debug Layer) - IF enabled
        if (this.c.state.layerEnableQuantizedGridCache === true) {
            this._updateGridCache(width, height, s, derived);
            const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (derived.cellWidth * 0.5);
            const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (derived.cellHeight * 0.5);
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }

        // Render the actual effect components from the pre-updated canvases
        const scratchCtx = this.scratchCtx;
        const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (derived.cellWidth * 0.5);
        const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (derived.cellHeight * 0.5);

        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        if (isSolid) {
            scratchCtx.globalAlpha = 1.0;
            scratchCtx.drawImage(this.perimeterMaskCanvas, 0, 0);
        } else {
            this._updateGridCache(width, height, s, derived);
            scratchCtx.globalAlpha = 1.0;
            scratchCtx.save();
            scratchCtx.translate(srcOffX, srcOffY);
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            scratchCtx.restore();
            
            scratchCtx.globalCompositeOperation = 'source-in';
            scratchCtx.drawImage(this.perimeterMaskCanvas, 0, 0);
        }
        
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; 
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();

        if (this._previewActive) {
            this.maskOps.length = this._lastPreviewSavedOpsLen;
            this.logicGrid.set(this._lastPreviewSavedLogic);
            
            // Full Reset of Render Grid to clear preview artifacts
            this.renderGrid.fill(-1);
            for (let i = 0; i < 3; i++) {
                 if (this.layerGrids[i]) this.layerGrids[i].fill(-1);
            }
            this._lastProcessedOpIndex = 0;

            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
            this._previewActive = false;
        }
    }

    renderEditorGrid(ctx) {
        if (!this.layout) return;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const l = this.layout;
        
        // Respect Global Toggle 
        if (this.c.state.layerEnableEditorGrid === false) return;

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        // User Editor Offsets
        const gridOffX = this.c.state.quantizedEditorGridOffsetX || 0;
        const gridOffY = this.c.state.quantizedEditorGridOffsetY || 0;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; 
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        // Draw verticals
        for (let bx = 0; bx <= blocksX; bx++) {
            // Snapped X
            const cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
            const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + gridOffX;
            
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        // Draw horizontals
        for (let by = 0; by <= blocksY; by++) {
            // Snapped Y
            const cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
            const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + gridOffY;
            
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
        
        // Highlight Center Block
        const centerCellX = Math.round((cx - l.offX + l.userBlockOffX) * l.cellPitchX);
        const centerCellY = Math.round((cy - l.offY + l.userBlockOffY) * l.cellPitchY);
        
        const centerX = l.screenOriginX + (centerCellX * l.screenStepX) + l.pixelOffX + gridOffX;
        const centerY = l.screenOriginY + (centerCellY * l.screenStepY) + l.pixelOffY + gridOffY;
        
        const bW = Math.round(l.cellPitchX) * l.screenStepX; // Approx width for stroke
        const bH = Math.round(l.cellPitchY) * l.screenStepY;

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
        ctx.strokeRect(centerX, centerY, bW, bH);

        ctx.restore();
    }

    renderEditorOverlay(ctx) {
         if (!this.layout) return;
         const l = this.layout;
         
         if (this.c.state.layerEnableEditorOverlay === false) return;

         const blocksX = this.logicGridW;
         const blocksY = this.logicGridH; // Fix: Use H for Y
         const cx = Math.floor(blocksX / 2);
         const cy = Math.floor(this.logicGridH / 2);
         
         const changesOffX = this.c.state.quantizedEditorChangesOffsetX || 0;
         const changesOffY = this.c.state.quantizedEditorChangesOffsetY || 0;
         
         ctx.save();
            
        // A. Draw Active Blocks (FILLS ONLY)
        const layerColors = ['rgba(0, 255, 0, 0.15)', 'rgba(0, 200, 255, 0.15)', 'rgba(255, 0, 200, 0.15)'];
        // Solid colors for lines
        const layerLines = ['rgba(0, 255, 0, 0.8)', 'rgba(0, 200, 255, 0.8)', 'rgba(255, 0, 200, 0.8)'];
        const layerInternal = ['rgba(0, 255, 0, 0.3)', 'rgba(0, 200, 255, 0.3)', 'rgba(255, 0, 200, 0.3)'];
        
        for (let i = 0; i < 3; i++) {
            const rGrid = this.layerGrids[i];
            if (rGrid) {
                ctx.fillStyle = layerColors[i];

                for (let idx = 0; idx < rGrid.length; idx++) {
                    if (rGrid[idx] !== -1) {
                        const bx = idx % blocksX;
                        const by = Math.floor(idx / blocksX);
                        
                        const cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                        
                        const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                        const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                        
                        const nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const w = (nextCellX - cellX) * l.screenStepX;
                        const h = (nextCellY - cellY) * l.screenStepY;
                        
                        ctx.fillRect(x, y, w, h); // Fill full cell, no inset
                    }
                }
            }
        }

        // B. Draw Shared Edges (Grid-Based Lines)
        // Iterate geometric edges: Vertical 0..W, Horizontal 0..H
        ctx.lineWidth = 1;
        
        const getVal = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return -1;
            return grid[by * blocksX + bx];
        };

        // Draw Layer by Layer (0 -> 1 -> 2)
        for (let i = 0; i < 3; i++) {
            const rGrid = this.layerGrids[i];
            if (!rGrid) continue;
            
            ctx.beginPath(); // Batch paths per layer for performance
            
            // Vertical Edges
            for (let x = 0; x <= blocksX; x++) {
                for (let y = 0; y < blocksY; y++) {
                    const activeL = (getVal(rGrid, x - 1, y) !== -1);
                    const activeR = (getVal(rGrid, x, y) !== -1);
                    
                    if (activeL || activeR) {
                        const cellX = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                        // Y range
                        const cellY1 = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const cellY2 = Math.round((y + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        
                        const px = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                        const py1 = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
                        const py2 = l.screenOriginY + (cellY2 * l.screenStepY) + l.pixelOffY + changesOffY;
                        
                        // Decide color/style based on boundary type
                        // We can't change style mid-path in a batch. 
                        // So we either break batch or just draw lines immediately.
                        // Drawing immediately is safer for logic.
                        ctx.moveTo(px, py1);
                        ctx.lineTo(px, py2);
                        
                        // Stroke immediately to apply correct style?
                        // Actually, let's just push to two separate paths: Solid and Faint.
                    }
                }
            }
            // Horizontal Edges
            // ... Logic duplicated ...
            // Optimization: Use two-pass approach (Solid Path, Internal Path) per layer.
        }
        
        // Revised Loop: Per-Layer, Split Paths
        for (let i = 0; i < 3; i++) {
            const rGrid = this.layerGrids[i];
            if (!rGrid) continue;
            
            // Path 1: Boundary (Solid)
            // Internal lines removed per user request (Silhouette/Perimeter only)
            const pSolid = new Path2D();
            
            // Vertical
            for (let x = 0; x <= blocksX; x++) {
                for (let y = 0; y < blocksY; y++) {
                    const activeL = (getVal(rGrid, x - 1, y) !== -1);
                    const activeR = (getVal(rGrid, x, y) !== -1);
                    if (!activeL && !activeR) continue;
                    
                    if (activeL !== activeR) {
                        const cellX = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const cellY1 = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const cellY2 = Math.round((y + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        
                        const px = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                        const py1 = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
                        const py2 = l.screenOriginY + (cellY2 * l.screenStepY) + l.pixelOffY + changesOffY;

                        pSolid.moveTo(px, py1);
                        pSolid.lineTo(px, py2);
                    }
                }
            }
            
            // Horizontal
            for (let y = 0; y <= blocksY; y++) {
                for (let x = 0; x < blocksX; x++) {
                    const activeT = (getVal(rGrid, x, y - 1) !== -1);
                    const activeB = (getVal(rGrid, x, y) !== -1);
                    if (!activeT && !activeB) continue;
                    
                    if (activeT !== activeB) {
                        const cellY = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const cellX1 = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const cellX2 = Math.round((x + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        
                        const py = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                        const px1 = l.screenOriginX + (cellX1 * l.screenStepX) + l.pixelOffX + changesOffX;
                        const px2 = l.screenOriginX + (cellX2 * l.screenStepX) + l.pixelOffX + changesOffX;

                        pSolid.moveTo(px1, py);
                        pSolid.lineTo(px2, py);
                    }
                }
            }
            
            ctx.strokeStyle = layerLines[i];
            ctx.stroke(pSolid);
        }

        // C. Draw Operations (Removals) - Remained mostly the same, but remove stroke
        const ops = this.maskOps;
        if (ops && this.c.state.layerEnableEditorRemovals !== false) {
            for (const op of ops) {
                if (op.type === 'removeBlock') {
                    if (op.startPhase !== this.expansionPhase) continue;
                    
                    const bx = cx + op.x1;
                    const by = cy + op.y1;
                    
                    const cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                    
                    const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                    const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                    
                    const nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                    const w = (nextCellX - cellX) * l.screenStepX;
                    const h = (nextCellY - cellY) * l.screenStepY;

                    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
                }
            }
        }
        ctx.restore();
    }

    flattenLayers(targetLayers, selectionRect, stepIndex) {
        if (!this.sequence) return 0;
        
        // Default: Merge all > 0 into 0 if no target specified (legacy support)
        const layers = targetLayers || [1, 2];
        const layerSet = new Set(layers);
        
        let count = 0;
        
        // Helper to process a single step
        const processStep = (step) => {
            if (!step || !Array.isArray(step)) return;
            for (const opObj of step) {
                let op, args;
                if (Array.isArray(opObj)) {
                    continue; 
                } else {
                    op = opObj;
                    args = op.args;
                }
                
                // Check Layer
                if (op.layer && layerSet.has(op.layer)) {
                    // Check Selection Constraint
                    if (selectionRect) {
                        const cx = Math.floor(this.logicGridW / 2);
                        const cy = Math.floor(this.logicGridH / 2);
                        
                        let opX1, opY1, opX2, opY2;
                        
                        if (op.op === 'add' || op.op === 'removeBlock' || op.op === 'addSmart') {
                            opX1 = cx + args[0]; opY1 = cy + args[1];
                            opX2 = opX1; opY2 = opY1;
                        } else if (op.op === 'addRect') {
                            opX1 = cx + args[0]; opY1 = cy + args[1];
                            opX2 = cx + args[2]; opY2 = cy + args[3];
                        } else {
                            continue; 
                        }
                        
                        // Normalize op bounds
                        const minX = Math.min(opX1, opX2);
                        const maxX = Math.max(opX1, opX2);
                        const minY = Math.min(opY1, opY2);
                        const maxY = Math.max(opY1, opY2);
                        
                        // Selection Bounds (Selection is top-left based 0..W)
                        const sMinX = selectionRect.x;
                        const sMaxX = selectionRect.x + selectionRect.w;
                        const sMinY = selectionRect.y;
                        const sMaxY = selectionRect.y + selectionRect.h;
                        
                        // Check Intersection
                        if (maxX < sMinX || minX > sMaxX || maxY < sMinY || minY > sMaxY) {
                            continue; 
                        }
                    }

                    op.layer = 0;
                    count++;
                }
            }
        };

        if (stepIndex !== undefined && stepIndex >= 0) {
            // Process Single Step
            if (stepIndex < this.sequence.length) {
                processStep(this.sequence[stepIndex]);
            }
        } else {
            // Process All Steps (Legacy/Global behavior)
            for (const step of this.sequence) {
                processStep(step);
            }
        }
        
        return count;
    }

    mergeSelectionAtStep(selectionRect, stepIndex) {
        if (!this.sequence || stepIndex < 0 || stepIndex >= this.sequence.length) return 0;
        if (!selectionRect) return 0;
        
        const step = this.sequence[stepIndex];
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        
        // Absolute Coords
        const r = selectionRect;
        const w = this.logicGridW;
        
        let count = 0;
        
        // Iterate selection
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                if (x < 0 || x >= this.logicGridW || y < 0 || y >= this.logicGridH) continue;
                
                const idx = y * w + x;
                
                // Check Layers 1 and 2
                for (let l = 1; l <= 2; l++) {
                    const grid = this.layerGrids[l];
                    if (grid && grid[idx] !== -1) {
                        // Found active block on Layer l
                        // Relative Coords for Op
                        const rx = x - cx;
                        const ry = y - cy;
                        
                        // Add Transition Ops
                        // 1. Remove from L(l)
                        step.push({ op: 'removeBlock', args: [rx, ry], layer: l });
                        // 2. Add to L0
                        step.push({ op: 'add', args: [rx, ry], layer: 0 });
                        
                        count++;
                    }
                }
            }
        }
        return count;
    }

    stop() {
        this.active = false;
        this.state = 'IDLE';
        this.alpha = 0.0;
        this.expansionPhase = 0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        window.removeEventListener('keydown', this._boundDebugHandler);
        
        if (this.g) this.g.clearAllOverrides();
        
        if (this.blocks) this.blocks = [];
        if (this.lines) this.lines = [];
        if (this.frontier) this.frontier = [];
        if (this.tendrils) this.tendrils = [];
        if (this.map) this.map.fill(0);
        if (this.activeFlashes) this.activeFlashes.clear();
        if (this.flashIntensity) this.flashIntensity.fill(0);
        
        this.shadowGrid = null;
        this.shadowSim = null;
    }

    _getSnap(val, axis) {
        if (!this._snapSettings) return val;
        const s = this._snapSettings;
        const max = (axis === 'x') ? s.w : s.h;
        const thresh = (axis === 'x') ? s.tx : s.ty;
        
        // Check near 0
        if (val < thresh) return 0;
        // Check near max
        if (val > max - thresh) return max;
        
        return val;
    }

    _updateMask(w, h, s, d) {
        if (!this.maskCtx || !this.lineMaskCanvas) {
            console.warn("[Quantized] Canvas Context missing in _updateMask. Re-initializing.", w, h);
            this._ensureCanvases(w, h);
        }

        const ctx = this.maskCtx;
        const colorLayerCtx = this.perimeterMaskCanvas.getContext('2d'); // Reuse perimeter mask as the Color Layer
        const lineCtx = this.lineMaskCanvas.getContext('2d');
        const grid = this.g;

        if (!ctx) {
            console.error("[Quantized] Mask Context is STILL NULL after init!", w, h);
            return;
        }

        ctx.clearRect(0, 0, w, h);
        colorLayerCtx.clearRect(0, 0, w, h);
        lineCtx.clearRect(0, 0, w, h);

        if (!this.renderGrid) {
                console.error("[Quantized] renderGrid is null!");
                return;
        }

        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = this.getConfig('PerimeterThickness') !== undefined ? this.getConfig('PerimeterThickness') : 1.0;
        const innerThickness = this.getConfig('InnerThickness') !== undefined ? this.getConfig('InnerThickness') : thickness;

        const baseStep = Math.min(screenStepX, screenStepY);
        
        const unifiedWidth = baseStep * 0.25 * thickness;
        const lineWidthX = unifiedWidth;
        const lineWidthY = unifiedWidth;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        
        const innerUnifiedWidth = baseStep * 0.25 * innerThickness;
        const innerLineWidthX = innerUnifiedWidth;
        const innerLineWidthY = innerUnifiedWidth;
        
        const gridPixW = this.g.cols * d.cellWidth; 
        const gridPixH = this.g.rows * d.cellHeight;

        const bs = this.getBlockSize();
        const oddShiftY = 0.0; 
        
        const userPerimeterOffsetX = s.quantizedPerimeterOffsetX || 0;
        const userPerimeterOffsetY = s.quantizedPerimeterOffsetY || 0;

        const userShadowOffsetX = s.quantizedShadowOffsetX || 0;
        const userShadowOffsetY = s.quantizedShadowOffsetY || 0;

        const screenOriginX = ((s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        const userBlockOffX = userShadowOffsetX / (d.cellWidth * cellPitchX);
        const userBlockOffY = userShadowOffsetY / (d.cellHeight * cellPitchY);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            innerLineWidthX, innerLineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY,
            userBlockOffX, userBlockOffY,
            pixelOffX: userPerimeterOffsetX,
            pixelOffY: userPerimeterOffsetY
        };
        const l = this.layout;

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const { offX, offY } = this._computeCenteredOffset(blocksX, blocksY, cellPitchX, cellPitchY);
        this.layout.offX = offX;
        this.layout.offY = offY;

        const snapThreshX = screenStepX * 1.0; 
        const snapThreshY = screenStepY * 1.0;
        this._snapSettings = { w, h, tx: snapThreshX, ty: snapThreshY };

        if (!this.maskOps || this.maskOps.length === 0) {
            this._snapSettings = null;
            return;
        }
        
        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);

        // Populate Suppressed Fades (Keys to ignore for fading this frame)
        this.suppressedFades.clear();
        if (this.maskOps) {
            const cx = Math.floor(this.logicGridW / 2);
            const cy = Math.floor(this.logicGridH / 2);
            for (const op of this.maskOps) {
                if (op.fade === false && op.startFrame === now) {
                    if (op.type === 'removeBlock') {
                        const minX = Math.min(cx + op.x1, cx + op.x2);
                        const maxX = Math.max(cx + op.x1, cx + op.x2);
                        const minY = Math.min(cy + op.y1, cy + op.y2);
                        const maxY = Math.max(cy + op.y1, cy + op.y2);
                        for (let y = minY; y <= maxY; y++) {
                            for (let x = minX; x <= maxX; x++) {
                                this.suppressedFades.add(`H_${x}_${y}`);
                                this.suppressedFades.add(`H_${x}_${y+1}`);
                                this.suppressedFades.add(`V_${x}_${y}`);
                                this.suppressedFades.add(`V_${x+1}_${y}`);
                            }
                        }
                    } else if (op.type === 'removeLine' || op.type === 'remove' || op.type === 'remLine') {
                         const bx = cx + op.x1;
                         const by = cy + op.y1;
                         if (op.face) {
                             const f = op.face.toUpperCase();
                             if (f === 'N') this.suppressedFades.add(`H_${bx}_${by}`);
                             else if (f === 'S') this.suppressedFades.add(`H_${bx}_${by+1}`);
                             else if (f === 'W') this.suppressedFades.add(`V_${bx}_${by}`);
                             else if (f === 'E') this.suppressedFades.add(`V_${bx+1}_${by}`);
                         }
                    }
                }
            }
        }
        
        // Render Interiors (Blocks) to Color Layer
        const iColor = this.getConfig('InnerColor') || "#FFD700";
        colorLayerCtx.fillStyle = iColor;
        // DISABLED to prevent "character-filled blocks":
        // this._renderInteriorPass(colorLayerCtx, now, addDuration);

        // Block Erasure Pass
        colorLayerCtx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;
            let opacity = 1.0;
            if (now > op.startFrame && !this.debugMode) {
                const fadeOutFrames = this.getConfig('FadeFrames') || 0;
                if (fadeOutFrames > 0) {
                    opacity = Math.min(1.0, (now - op.startFrame) / fadeOutFrames);
                } 
            }
            colorLayerCtx.globalAlpha = opacity;
            const cx = Math.floor(this.logicGridW / 2);
            const cy = Math.floor(this.logicGridH / 2);
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Manually invoke logic similar to _addBlock but using passed context (via override)
            // or just use a helper. I'll swap this.maskCtx temporarily as planned.
            const oldCtx = this.maskCtx;
            this.maskCtx = colorLayerCtx;
            this._addBlock(start, end, false, false);
            this.maskCtx = oldCtx;
        }
        colorLayerCtx.globalCompositeOperation = 'destination-out';
        const fadeOutFr = this.getConfig('FadeFrames') || 0;
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                if (this.renderGrid[idx] === -1) {
                    let isFading = false;
                    if (fadeOutFr > 0) {
                        for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
                            const rGrid = this.removalGrids[layerIdx];
                            if (rGrid && rGrid[idx] !== -1 && now < rGrid[idx] + fadeOutFr) {
                                isFading = true; break;
                            }
                        }
                    }
                    if (!isFading) {
                        const sx = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const ex = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const sy = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const ey = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const x = l.screenOriginX + (sx * l.screenStepX) + l.pixelOffX;
                        const y = l.screenOriginY + (sy * l.screenStepY) + l.pixelOffY;
                        const w = (ex - sx) * l.screenStepX;
                        const h = (ey - sy) * l.screenStepY;
                        colorLayerCtx.fillRect(x - 0.5, y - 0.5, w + 1.0, h + 1.0);
                    }
                }
            }
        }
        colorLayerCtx.globalCompositeOperation = 'source-over';

        // Unified Shared Edge Rendering to Color Layer
        // MUST happen after VOID CLEANUP to prevent clipping centered lines on boundaries
        this._renderEdges(colorLayerCtx, colorLayerCtx, now, blocksX, blocksY, offX, offY);
        
        this._snapSettings = null;
    }

            _renderInteriorPass(ctx, now, addDuration) {
                const cx = Math.floor(this.logicGridW / 2);
                const cy = Math.floor(this.logicGridH / 2);

                for (const op of this.maskOps) {
                    if (op.type !== 'add') continue;
                    let opacity = 1.0;

                    if (addDuration > 1 && op.startFrame && !this.debugMode) {
                        opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                    }
                    ctx.globalAlpha = opacity;
                    const start = { x: cx + op.x1, y: cy + op.y1 };
                    const end = { x: cx + op.x2, y: cy + op.y2 };
                    
                    const l = this.layout;
                    const offX = l.offX || 0;
                    const offY = l.offY || 0;
                    const startX = Math.round((start.x - offX + l.userBlockOffX) * l.cellPitchX);
                    const endX = Math.round((end.x + 1 - offX + l.userBlockOffX) * l.cellPitchX);
                    const startY = Math.round((start.y - offY + l.userBlockOffY) * l.cellPitchY);
                    const endY = Math.round((end.y + 1 - offY + l.userBlockOffY) * l.cellPitchY);

                    ctx.beginPath();
                    const xPos = l.screenOriginX + (startX) * l.screenStepX + l.pixelOffX;
                    const yPos = l.screenOriginY + (startY) * l.screenStepY + l.pixelOffY;
                    const w = (endX - startX) * l.screenStepX;
                    const h = (endY - startY) * l.screenStepY;
                    
                    const sLeft = this._getSnap(xPos, 'x');
                    const sTop = this._getSnap(yPos, 'y');
                    const sRight = this._getSnap(xPos + w, 'x');
                    const sBottom = this._getSnap(yPos + h, 'y');
                    
                    ctx.rect(sLeft - 0.5, sTop - 0.5, (sRight - sLeft) + 1.0, (sBottom - sTop) + 1.0);
                    ctx.fill();
                }
            }

    _rebuildEdgeCache(scaledW, scaledH) {
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const distMap = this._computeDistanceField(scaledW, scaledH);
        const cleanDistVal = this.getConfig('CleanInnerDistance');
        const cleanDist = (cleanDistVal !== undefined) ? cleanDistVal : 4;

        this._cachedEdgeMaps = [];

        for (let layer = 0; layer < 3; layer++) {
            const edgeMap = new Map();
            const currentGrid = this.layerGrids[layer];

            const isRenderActive = (bx, by) => {
                if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
                const idx = by * scaledW + bx;
                return (currentGrid && currentGrid[idx] !== -1);
            };

            if (this.maskOps) {
                for (const op of this.maskOps) {
                    if (op.type !== 'addLine' && op.type !== 'removeLine') continue;
                    
                    const opLayer = (op.layer !== undefined) ? op.layer : 0;
                    if (opLayer !== layer) continue;

                    const start = { x: cx + op.x1, y: cy + op.y1 };
                    const end = { x: cx + op.x2, y: cy + op.y2 };
                    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
                    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
                    const f = op.face ? op.face.toUpperCase() : 'N';
                    
                    const type = (op.type === 'addLine' ? 'add' : 'rem');

                    for (let by = minY; by <= maxY; by++) {
                        for (let bx = minX; bx <= maxX; bx++) {
                            const idx = by * scaledW + bx;
                            if (type === 'add' && !isRenderActive(bx, by)) continue;
                            if (type === 'add' && distMap[idx] > cleanDist) continue;
                            
                            let key = '';
                            if (f === 'N') key = `H_${bx}_${by}`;     
                            else if (f === 'S') key = `H_${bx}_${by+1}`; 
                            else if (f === 'W') key = `V_${bx}_${by}`;   
                            else if (f === 'E') key = `V_${bx+1}_${by}`; 
                            
                            edgeMap.set(key, { type, op });
                        }
                    }
                }
            }
            this._cachedEdgeMaps.push(edgeMap);
        }
    }

    _getBlock(bx, by) {
        if (bx < 0 || bx >= this.logicGridW || by < 0 || by >= this.logicGridH) return -1;
        return this.renderGrid[by * this.logicGridW + bx];
    }

    _getLayerForBlock(bx, by) {
        const idx = by * this.logicGridW + bx;
        if (bx < 0 || bx >= this.logicGridW || by < 0 || by >= this.logicGridH) return 0;
        // Return highest active layer
        for (let i = 2; i >= 0; i--) {
            if (this.layerGrids[i] && this.layerGrids[i][idx] !== -1) return i;
        }
        return 0; // Fallback
    }

    getEdgeVisibility(bx, by, face) {
        if (this._edgeCacheDirty || !this._cachedEdgeMaps || this._cachedEdgeMaps.length === 0) {
            this._rebuildEdgeCache(this.logicGridW, this.logicGridH);
            this._edgeCacheDirty = false;
        }

        const f = face.toUpperCase();
        let x = bx, y = by, type = '';
        if (f === 'N') { type = 'H'; }
        else if (f === 'S') { type = 'H'; y++; }
        else if (f === 'W') { type = 'V'; }
        else if (f === 'E') { type = 'V'; x++; }
        
        const key = `${type}_${x}_${y}`;
        
        // 1. Manual Overrides (Highest Layer Wins)
        for (let i = 2; i >= 0; i--) {
            const em = this._cachedEdgeMaps[i];
            if (em && em.has(key)) {
                return (em.get(key).type === 'add');
            }
        }
        
        // 2. Procedural / Silhouette Logic
        let ax, ay, bbx, bby; 
        if (type === 'V') {
            ax = x - 1; ay = y;
            bbx = x;     bby = y;
        } else {
            ax = x;     ay = y - 1;
            bbx = x;     bby = y;
        }

        const activeA = (this._getBlock(ax, ay) !== -1);
        const activeB = (this._getBlock(bbx, bby) !== -1);

        if (activeA && activeB) {
            const layerA = this._getLayerForBlock(ax, ay);
            const layerB = this._getLayerForBlock(bbx, bby);
            return (layerA !== layerB);
        } 
        return (activeA !== activeB);
    }

    _renderEdges(ctx, ignoredCtx, now, blocksX, blocksY, offX, offY) {
        const scaledW = blocksX;
        const scaledH = blocksY;

        if (this._edgeCacheDirty || !this._cachedEdgeMaps || this._cachedEdgeMaps.length === 0) {
            this._rebuildEdgeCache(scaledW, scaledH);
            this._edgeCacheDirty = false;
        }
        
        const color = this.getConfig('PerimeterColor') || "#FFD700";
        const fadeColor = this.getConfig('PerimeterFadeColor') || (this.getConfig('InnerColor') || "#FFD700");
        const fadeOutFrames = this.getConfig('FadeFrames') || 0;

        const getBlock = (grid, bx, by) => {
            if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return -1;
            return grid[by * scaledW + bx];
        };

        const getLayerForBlock = (bx, by) => {
            const idx = by * scaledW + bx;
            // Return highest active layer
            for (let i = 2; i >= 0; i--) {
                if (this.layerGrids[i] && this.layerGrids[i][idx] !== -1) return i;
            }
            return 0; // Fallback
        };

        const getFadeState = (deathFrame) => {
             if (fadeOutFrames <= 0 || deathFrame === -1) return null;
             const progress = (now - deathFrame) / fadeOutFrames;
             if (progress < 0 || progress >= 1) return null;
             
             const colorPhase = 0.25;  
             if (progress < colorPhase) {
                 const t = progress / colorPhase;
                 return { c: this._lerpColor(color, fadeColor, t), o: 1.0 };
             } else {
                 const t = (progress - colorPhase) / (1.0 - colorPhase);
                 return { c: fadeColor, o: 1.0 - t };
             }
        };

        const resolveEdge = (x, y, type) => {
            // A = Left/Top, B = Right/Bottom
            let ax, ay, bx, by; 
            if (type === 'V') {
                ax = x - 1; ay = y;
                bx = x;     by = y;
            } else {
                ax = x;     ay = y - 1;
                bx = x;     by = y;
            }

            const activeA = (getBlock(this.renderGrid, ax, ay) !== -1);
            const activeB = (getBlock(this.renderGrid, bx, by) !== -1);

            let isVisibleNow = false;

            // 1. Manual Line Overrides (from edgeMap)
            const key = `${type}_${x}_${y}`;
            let manualOp = null;
            for (let i = 2; i >= 0; i--) {
                const em = this._cachedEdgeMaps[i];
                if (em && em.has(key)) {
                    manualOp = em.get(key);
                    break;
                }
            }

            if (manualOp) {
                if (manualOp.type === 'add') {
                    isVisibleNow = true;
                } else if (manualOp.type === 'rem') {
                    // Manual removal overrides procedural visibility
                    isVisibleNow = false;
                }
            }

            // 2. SILHOUETTE LOGIC (Composite)
            let isLayerMerge = false;
            if (!manualOp) {
                if (activeA && activeB) {
                    // Internal Edge - Check if layers differ
                    const layerA = getLayerForBlock(ax, ay);
                    const layerB = getLayerForBlock(bx, by);
                    
                    if (layerA !== layerB) {
                        // Boundary between DIFFERENT layers -> DRAW
                        isVisibleNow = true;
                    } else {
                        // Both active on SAME layer -> Check for Merge Transition
                        isLayerMerge = true;
                    }
                } 
                else if (activeA !== activeB) {
                    // Active Boundary (External Perimeter)
                    isVisibleNow = true;
                }
            }

            // 3. State Management & Fading Interception
            let state = this.lineStates.get(key);
            if (!state) {
                state = { visible: false, deathFrame: -1 };
                this.lineStates.set(key, state);
            }

            if (isVisibleNow) {
                state.visible = true;
                state.deathFrame = -1;
            } else {
                if (state.visible) {
                    // Just died! (Either block removed OR layer merge)
                    state.visible = false;
                    this.lastVisibilityChangeFrame = now;
                    
                    // Nudge suppression only applies to block removals, not merges
                    const isNudged = !isLayerMerge && this.suppressedFades.has(key);
                    
                    if (!isNudged) {
                        state.deathFrame = now;
                    }
                }
            }

            // 4. Rendering
            if (state.visible) {
                const face = (type === 'V') ? 'W' : 'N';
                this._drawExteriorLine(ctx, x, y, face, { color: color, opacity: 1.0 });
            } else if (state.deathFrame !== -1) {
                const fade = getFadeState(state.deathFrame);
                if (fade) {
                    const face = (type === 'V') ? 'W' : 'N';
                    this._drawExteriorLine(ctx, x, y, face, { color: fade.c, opacity: fade.o });
                } else {
                    state.deathFrame = -1; // Fade finished
                }
            }
        };

        // 1. Vertical Edges
        for (let x = 0; x <= scaledW; x++) {
            for (let y = 0; y < scaledH; y++) {
                resolveEdge(x, y, 'V');
            }
        }

        // 2. Horizontal Edges
        for (let y = 0; y <= scaledH; y++) {
            for (let x = 0; x < scaledW; x++) {
                resolveEdge(x, y, 'H');
            }
        }
    }

    _drawExteriorLine(ctx, bx, by, face, options) {
        const l = this.layout;
        const color = options.color || "#FFFFFF";
        const opacity = options.opacity !== undefined ? options.opacity : 1.0;
        const scale = options.scale !== undefined ? options.scale : 1.0;
        
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;
        
        ctx.beginPath();
        // Use 1.0 multiplier for correct thickness
        const lwX = l.lineWidthX * 1.0 * scale;
        const lwY = l.lineWidthY * 1.0 * scale;
        const faceObj = (typeof face === 'string') ? {dir: face} : face;
        
        this._addPerimeterFacePath(ctx, bx, by, faceObj, lwX, lwY);
        ctx.fill();
    }

    _drawInteriorLine(ctx, bx, by, face, options) {
        const l = this.layout;
        const color = options.color || "#FFFFFF";
        const opacity = options.opacity !== undefined ? options.opacity : 1.0;
        
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;

        ctx.beginPath();
        // Use 1.0 multiplier for correct thickness
        const lwX = l.innerLineWidthX * 1.0;
        const lwY = l.innerLineWidthY * 1.0;
        
        const faceObj = (typeof face === 'string') ? {dir: face} : face;
        
        this._addPerimeterFacePath(ctx, bx, by, faceObj, lwX, lwY);
        ctx.fill();
    }

    _renderCornerCleanup(ctx, now) {
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const cornerMap = new Map(); 
        const activeRemovals = this.maskOps.filter(op => {
            if (op.type !== 'remove' && op.type !== 'removeLine') return false;
            if (!op.startFrame) return false;
            return (now >= op.startFrame);
        });

        if (activeRemovals.length === 0) return;

        for (const op of activeRemovals) {
            if (!op.face) continue;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            const f = op.face.toUpperCase();
            const force = op.force;

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (!force) {
                        if (f === 'N' && by === minY) continue;
                        if (f === 'S' && by === maxY) continue;
                        if (f === 'W' && bx === minX) continue;
                        if (f === 'E' && bx === maxX) continue;
                    }
                    
                    const idx = by * blocksX + bx;
                    let mask = cornerMap.get(idx) || 0;
                    if (f === 'N') mask |= 1;
                    else if (f === 'S') mask |= 2;
                    else if (f === 'E') mask |= 4;
                    else if (f === 'W') mask |= 8;
                    cornerMap.set(idx, mask);
                }
            }
        }

        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1.0; 
        
        for (const [idx, mask] of cornerMap) {
            const bx = idx % blocksX;
            const by = (idx / blocksX) | 0;
            
            if ((mask & 1) && (mask & 8)) this._removeBlockCorner(bx, by, 'NW');
            if ((mask & 1) && (mask & 4)) this._removeBlockCorner(bx, by, 'NE');
            if ((mask & 2) && (mask & 8)) this._removeBlockCorner(bx, by, 'SW');
            if ((mask & 2) && (mask & 4)) this._removeBlockCorner(bx, by, 'SE');
        }
        
        ctx.globalCompositeOperation = 'source-over';
    }

    _removeBlockCorner(bx, by, corner) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;

        const s = this.c.state;
        // const lineOffset = s.quantizedLineOffset || 0;
        const lineOffset = 0;

        // Snap Cell Indices
        const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
        const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
        const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);
        
        let cx, cy;
        if (corner === 'NW') {
            cx = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'NE') {
            cx = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SW') {
            cx = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SE') {
            cx = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
        }
        
        // Apply Snapping
        cx = this._getSnap(cx, 'x');
        cy = this._getSnap(cy, 'y');

        const inflate = 1.0; 
        ctx.beginPath();
        ctx.rect(cx - l.halfLineX - inflate, cy - l.halfLineY - inflate, l.lineWidthX + (inflate*2), l.lineWidthY + (inflate*2));
        ctx.fill();
    }

    _addPerimeterFacePath(ctx, bx, by, faceObj, widthX, widthY) {
        // ctx is passed in now!
        const l = this.layout;
        if (!l) return;

        const offX = l.offX || 0;
        const offY = l.offY || 0;

        // Force strictly centered lines on the border (no inset/offset)
        const lineOffset = 0; 
        
        const s = this.c.state;
        const lineLengthMult = s.quantizedLineLength !== undefined ? s.quantizedLineLength : 1.0;
        
        // Snap Cell Indices
        const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
        const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
        const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);

        const face = faceObj.dir;
        const rS = faceObj.rS;
        const rE = faceObj.rE;

        let drawX, drawY, drawW, drawH;

        if (face === 'N') {
            // Top Edge
            let cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            let rightX = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;

            // Snap
            cy = this._getSnap(cy, 'y');
            leftX = this._getSnap(leftX, 'x');
            rightX = this._getSnap(rightX, 'x');

            if (lineLengthMult !== 1.0) {
                const midX = (leftX + rightX) * 0.5;
                const halfW = (rightX - leftX) * 0.5 * lineLengthMult;
                leftX = midX - halfW;
                rightX = midX + halfW;
            }

            // Center line on edge (Vertical)
            drawY = cy - (widthY * 0.5); 
            drawH = widthY; 
            
            // Extend horizontally to cover corners (Center on Grid intersections)
            drawX = leftX - (widthX * 0.5);
            drawW = (rightX - leftX) + widthX;
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'S') {
            // Bottom Edge
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            let rightX = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;

            // Snap
            bottomY = this._getSnap(bottomY, 'y');
            leftX = this._getSnap(leftX, 'x');
            rightX = this._getSnap(rightX, 'x');

            if (lineLengthMult !== 1.0) {
                const midX = (leftX + rightX) * 0.5;
                const halfW = (rightX - leftX) * 0.5 * lineLengthMult;
                leftX = midX - halfW;
                rightX = midX + halfW;
            }

            // Center line on edge
            drawY = bottomY - (widthY * 0.5); 
            drawH = widthY; 
            
            // Extend horizontally
            drawX = leftX - (widthX * 0.5);
            drawW = (rightX - leftX) + widthX;
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'W') {
            // Left Edge
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;

            // Snap
            topY = this._getSnap(topY, 'y');
            bottomY = this._getSnap(bottomY, 'y');
            leftX = this._getSnap(leftX, 'x');

            if (lineLengthMult !== 1.0) {
                const midY = (topY + bottomY) * 0.5;
                const halfH = (bottomY - topY) * 0.5 * lineLengthMult;
                topY = midY - halfH;
                bottomY = midY + halfH;
            }

            // Center line on edge
            drawX = leftX - (widthX * 0.5); 
            drawW = widthX; 
            
            // Extend vertically
            drawY = topY - (widthY * 0.5);
            drawH = (bottomY - topY) + widthY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
        } else if (face === 'E') {
            // Right Edge
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let rightX = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;

            // Snap
            topY = this._getSnap(topY, 'y');
            bottomY = this._getSnap(bottomY, 'y');
            rightX = this._getSnap(rightX, 'x');

            if (lineLengthMult !== 1.0) {
                const midY = (topY + bottomY) * 0.5;
                const halfH = (bottomY - topY) * 0.5 * lineLengthMult;
                topY = midY - halfH;
                bottomY = midY + halfH;
            }

            // Center line on edge
            drawX = rightX - (widthX * 0.5); 
            drawW = widthX; 
            
            // Extend vertically
            drawY = topY - (widthY * 0.5);
            drawH = (bottomY - topY) + widthY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
        }
        
        ctx.rect(drawX, drawY, drawW, drawH);
    }
    
    _addBlock(blockStart, blockEnd, isExtending, visibilityCheck) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;

        // Snap Cell Indices
        const startX = Math.round((blockStart.x - offX + l.userBlockOffX) * l.cellPitchX);
        const endX = Math.round((blockEnd.x + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startY = Math.round((blockStart.y - offY + l.userBlockOffY) * l.cellPitchY);
        const endY = Math.round((blockEnd.y + 1 - offY + l.userBlockOffY) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        
        const xPos = l.screenOriginX + (startX) * l.screenStepX + l.pixelOffX;
        const yPos = l.screenOriginY + (startY) * l.screenStepY + l.pixelOffY;
        const w = (endX - startX) * l.screenStepX;
        const h = (endY - startY) * l.screenStepY;
        
        // Apply Snapping
        const sLeft = this._getSnap(xPos, 'x');
        const sTop = this._getSnap(yPos, 'y');
        const sRight = this._getSnap(xPos + w, 'x');
        const sBottom = this._getSnap(yPos + h, 'y');
        
        const sW = sRight - sLeft;
        const sH = sBottom - sTop;

        ctx.rect(sLeft - 0.5, sTop - 0.5, sW + 1.0, sH + 1.0);
        ctx.fill();
    }
    
    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;
        const f = face.toUpperCase();
        
        const s = this.c.state;
        // const lineOffset = s.quantizedLineOffset || 0;
        const lineOffset = 0;

        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();

        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                if (!force) {
                    if (f === 'N' && by === minY) continue;
                    if (f === 'S' && by === maxY) continue;
                    if (f === 'W' && bx === minX) continue;
                    if (f === 'E' && bx === maxX) continue;
                }
                
                // Snap Cell Indices
                const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
                const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
                const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
                const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);

                const safety = 0.5;
                const safeX = l.halfLineX + safety; 
                const safeY = l.halfLineY + safety; 
                const inflate = 0.5; 

                if (f === 'N') {
                    let cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
                    let baseLeft = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
                    let baseRight = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
                    
                    // Snap
                    cy = this._getSnap(cy, 'y');
                    baseLeft = this._getSnap(baseLeft, 'x');
                    baseRight = this._getSnap(baseRight, 'x');
                    
                    const left = baseLeft + safeX;
                    const width = (baseRight - baseLeft) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'S') {
                    let cy = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
                    let baseLeft = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
                    let baseRight = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
                    
                    // Snap
                    cy = this._getSnap(cy, 'y');
                    baseLeft = this._getSnap(baseLeft, 'x');
                    baseRight = this._getSnap(baseRight, 'x');

                    const left = baseLeft + safeX;
                    const width = (baseRight - baseLeft) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'W') {
                    let cx = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
                    let baseTop = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
                    let baseBottom = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
                    
                    // Snap
                    cx = this._getSnap(cx, 'x');
                    baseTop = this._getSnap(baseTop, 'y');
                    baseBottom = this._getSnap(baseBottom, 'y');

                    const top = baseTop + safeY;
                    const height = (baseBottom - baseTop) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                } else if (f === 'E') {
                    let cx = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
                    let baseTop = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
                    let baseBottom = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
                    
                    // Snap
                    cx = this._getSnap(cx, 'x');
                    baseTop = this._getSnap(baseTop, 'y');
                    baseBottom = this._getSnap(baseBottom, 'y');
                    
                    const top = baseTop + safeY;
                    const height = (baseBottom - baseTop) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                }
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
}