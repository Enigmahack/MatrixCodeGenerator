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
        this.renderGrid = null; // Int32Array
        
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

        // Optimization: Pre-allocated BFS Queue (Ring Buffer)
        // Max size is logicGridW * logicGridH. Start reasonable, resize if needed.
        this._bfsQueue = new Int32Array(65536); 
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
        }

        this.active = true;
        
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this._lastProcessedOpIndex = 0;
        this.animFrame = 0;
        this._maskDirty = true;
        
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

    hitTest(x, y) {
        if (!this.layout) return;
        const l = this.layout;
        // const blockScreenW = l.cellPitchX * l.screenStepX; // Unused
        // const blockScreenH = l.cellPitchY * l.screenStepY; // Unused
        
        // Inverse of the render equation:
        // ScreenX = Origin + PixelOff + (CellIndex * Step)
        // CellIndex ~= (Block - Off + UserOff) * Pitch
        
        // 1. Normalize to Cell Space
        const cellX = (x - l.screenOriginX - l.pixelOffX) / l.screenStepX;
        const cellY = (y - l.screenOriginY - l.pixelOffY) / l.screenStepY;
        
        // 2. Normalize to Block Space
        const rawBx = (cellX / l.cellPitchX) + l.offX - l.userBlockOffX;
        const rawBy = (cellY / l.cellPitchY) + l.offY - l.userBlockOffY;
        
        // 3. Floor to get Index
        // Note: Due to rounding/snapping in render, edge clicks might be slightly off ( < 0.5 cell),
        // but this is sufficient for UI interaction.
        const bx = Math.floor(rawBx);
        const by = Math.floor(rawBy);
        
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
        this.expansionPhase = stepIndex;
        this.maskOps = [];
        this._initLogicGrid();
        this.renderGrid.fill(-1);
        if (this.renderGridL1) this.renderGridL1.fill(-1);
        if (this.renderGridL2) this.renderGridL2.fill(-1);
        this._lastProcessedOpIndex = 0;
        
        for (let i = 0; i <= stepIndex; i++) {
            const step = this.sequence[i];
            if (step) {
                this._executeStepOps(step, 0); 
            }
        }
        this._maskDirty = true;
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
                }
            }
            return;
        }

        for (const opData of step) {
            let op, args;
            if (Array.isArray(opData)) {
                op = opData[0];
                args = opData.slice(1);
            } else {
                op = opData.op;
                args = opData.args;
            }
            
            if (op === 'add') {
                const [dx, dy] = args;
                 if (isActive(dx, dy)) {
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now, startPhase: this.expansionPhase });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now, startPhase: this.expansionPhase });
                } else {
                    this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
                    setLocalActive(dx, dy);
                }
            } else if (op === 'addSmart') {
                const [dx, dy] = args;
                this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
                setLocalActive(dx, dy);
            } else if (op === 'addRect') {
                const [dx1, dy1, dx2, dy2] = args;
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
            } else if (op === 'rem') {
                const [dx, dy, face] = args;
                 if (face) {
                    this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
                } else {
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
                }
            } else if (op === 'removeBlock') {
                const [dx, dy] = args;
                this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now });
                setLocalInactive(dx, dy);
            } else if (op === 'addLine') {
                const [dx, dy, face] = args;
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, startFrame: now, startPhase: this.expansionPhase });
            } else if (op === 'remLine') {
                const [dx, dy, face] = args;
                this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
            }
        }
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

    _swapStates() {
        if (this.hasSwapped || this.isSwapping) return;
        
        const result = this._commitShadowState();
        
        if (result === 'ASYNC') {
            this.isSwapping = true;
            this.swapTimer = 5; 
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
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
                 this._renderGridDirty = true;
            }
        }
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const sm = this.shadowSim.streamManager;
        
        const warmupFrames = 60; 
        this.shadowSimFrame = warmupFrames;
        
        for (let i = 0; i < warmupFrames; i++) {
            this.shadowSim.update(i);
        }
    }

    _initShadowWorldBase(workerEnabled = false) {
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        // Add 1.0 cell buffer to width and height for N/W faces
        const w = (this.g.cols * d.cellWidth) + (d.cellWidth * 1.5); 
        const h = (this.g.rows * d.cellHeight) + (d.cellHeight * 1.0);
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
                }
            }
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
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        
        const bs = this.getBlockSize();
        // Reset offsets: No oddShiftY needed if we align to Top-Left
        const oddShiftY = 0.0; 
        
        const screenOriginX = ((s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;

        const drawChar = (x, y) => {
            // DEBUG COUNT
            this._debugCharCount = (this._debugCharCount || 0) + 1;

            let charCode = 32;
            let i = -1;

            if (x >= 0 && x < cols && y >= 0 && y < rows) {
                i = (y * cols) + x;
                if (grid.overrideActive && grid.overrideActive[i] > 0) {
                    charCode = grid.overrideChars[i];
                } else {
                    charCode = chars[i];
                }
            } else {
                // Procedural index for out-of-bounds
                // Offset to ensure positive seeds or just use raw coords
                i = (y * 10000) + x; 
                charCode = 0; // Force procedural generation
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
            // Add 0.5 offset for text centering within the cell
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

        if (!this.renderGrid || this.renderGrid.length !== totalBlocks ||
            !this.renderGridL1 || this.renderGridL1.length !== totalBlocks ||
            !this.renderGridL2 || this.renderGridL2.length !== totalBlocks) {
            
            this.renderGrid = new Int32Array(totalBlocks);
            this.renderGridL1 = new Int32Array(totalBlocks);
            this.renderGridL2 = new Int32Array(totalBlocks);
            this.renderGrid.fill(-1);
            this.renderGridL1.fill(-1);
            this.renderGridL2.fill(-1);
            this._lastProcessedOpIndex = 0;
        }

        if (!this.maskOps) return;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        
        // Ensure grids are clean if we are starting fresh
        if (startIndex === 0) {
            this.renderGrid.fill(-1);
            this.renderGridL1.fill(-1);
            this.renderGridL2.fill(-1);
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
                        
                        if (op.layer === 1) this.renderGridL2[idx] = op.startFrame || 0;
                        else this.renderGridL1[idx] = op.startFrame || 0;
                        
                        const l1 = this.renderGridL1[idx];
                        const l2 = this.renderGridL2[idx];
                        this.renderGrid[idx] = (l2 !== -1) ? l2 : l1;
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
                        this.renderGrid[idx] = -1;
                        this.renderGridL1[idx] = -1;
                        this.renderGridL2[idx] = -1;
                    }
                }
            }
        }
        
        this._lastProcessedOpIndex = i;
        
        this._lastBlocksX = blocksX;
        this._lastBlocksY = blocksY;
        this._lastPitchX = cellPitchX;
        this._lastPitchY = cellPitchY;
        
        if (processed > 0) {
            this._distMapDirty = true;
            this._outsideMapDirty = true;
            this._maskDirty = true;
            this._gridCacheDirty = true;
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
                
                // Alignment: Reset to standard Grid + 1 character shift
                const startCellX = Math.round(destBx * pitchX) + 1;
                const startCellY = Math.round(destBy * pitchY) + 1;
                const endCellX = Math.round((destBx + 1) * pitchX) + 1;
                const endCellY = Math.round((destBy + 1) * pitchY) + 1;
                
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
                    
                    // Alignment: Reset to standard Grid + 1 character shift
                    const startCellX = Math.round(destBx * pitchX) + 1;
                    const startCellY = Math.round(destBy * pitchY) + 1;
                    const endCellX = Math.round((destBx + 1) * pitchX) + 1;
                    const endCellY = Math.round((destBy + 1) * pitchY) + 1;
                    
                    for (let cy = startCellY; cy < endCellY; cy++) {
                        if (cy >= g.rows || cy < 0) continue;
                        for (let cx = startCellX; cx < endCellX; cx++) {
                            if (cx >= g.cols || cx < 0) continue;
                            
                            const destIdx = cy * g.cols + cx;
                            // Source reads from Shadow Grid (includes N/W buffer, so cx+1, cy+1)
                            const srcIdx = (cy + 1) * sg.cols + (cx + 1);
                            
                            if (sg && sg.chars && srcIdx < sg.chars.length) {
                                g.overrideActive[destIdx] = 3; 
                                g.overrideChars[destIdx] = sg.chars[srcIdx];
                                g.overrideColors[destIdx] = sg.colors[srcIdx];
                                g.overrideAlphas[destIdx] = sg.alphas[srcIdx];
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

        // Ensure Grid Logic is up to date for this frame
        this._updateRenderGridLogic();

        const s = this.c.state;
        const glowStrength = this.getConfig('BorderIllumination') || 0;
        
        const borderColor = this.getConfig('PerimeterColor') || "#FFD700";
        const interiorColor = this.getConfig('InnerColor') || "#FFD700";
        
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
                
                const renderLayer = (maskCanvas, color, solid = false, compositeOp = 'lighter', srcOffX = 0, srcOffY = 0) => {
                if (!maskCanvas) return;
                
                scratchCtx.globalCompositeOperation = 'source-over';
                scratchCtx.clearRect(0, 0, width, height);

                if (solid) {
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.fillStyle = color;
                    scratchCtx.fillRect(0, 0, width, height);
                } else {
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.save();
                    scratchCtx.translate(srcOffX, srcOffY); // Apply Source Offset here
                    scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
                    scratchCtx.restore();
                    
                    scratchCtx.globalCompositeOperation = 'source-in';
                    scratchCtx.fillStyle = color;
                    scratchCtx.fillRect(0, 0, width, height);
                }
                
                scratchCtx.globalCompositeOperation = 'destination-in';
                scratchCtx.globalAlpha = 1.0;
                scratchCtx.drawImage(maskCanvas, 0, 0);
                
                ctx.save();
                if (ctx.canvas.style.mixBlendMode !== 'normal') {
                    ctx.canvas.style.mixBlendMode = 'normal';
                }
                ctx.globalCompositeOperation = compositeOp; 
                ctx.globalAlpha = 1.0;
                
                ctx.drawImage(this.scratchCanvas, 0, 0);
                ctx.restore();
            };

            if (this.lineMaskCanvas) {
                const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (d.cellWidth * 0.5);
                const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (d.cellHeight * 0.5);
                renderLayer(this.lineMaskCanvas, interiorColor, isSolid, 'source-over', srcOffX, srcOffY);
            }

            if (this.perimeterMaskCanvas) {
                const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (d.cellWidth * 0.5);
                const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (d.cellHeight * 0.5);
                renderLayer(this.perimeterMaskCanvas, borderColor, isSolid, 'source-over', srcOffX, srcOffY);
            }
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

        if (this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }
        
        const borderColor = this.getConfig('PerimeterColor') || "#FFD700";
        const interiorColor = this.getConfig('InnerColor') || "#FFD700";
        
        this._updateGridCache(width, height, s, derived);
        const scratchCtx = this.scratchCtx;
        const isSolid = this.c.state.quantizedSolidPerimeter || false;
        
        // Draw Source Grid (Debug Layer)
        if (this.c.state.layerEnableQuantizedGridCache === true) {
            const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (derived.cellWidth * 0.5);
            const srcOffY = (this.c.state.quantizedSourceGridOffsetY || 0) + (derived.cellHeight * 0.5);
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }

        const renderLayer = (maskCanvas, color) => {
            if (!maskCanvas) return;
            
            const srcOffX = (this.c.state.quantizedSourceGridOffsetX || 0) + (derived.cellWidth * 0.5);
            const srcOffY = this.c.state.quantizedSourceGridOffsetY || 0;

            scratchCtx.globalCompositeOperation = 'source-over';
            scratchCtx.clearRect(0, 0, width, height);

            if (isSolid) {
                scratchCtx.globalAlpha = 1.0;
                scratchCtx.fillStyle = color;
                scratchCtx.fillRect(0, 0, width, height);
            } else {
                scratchCtx.globalAlpha = 1.0;
                scratchCtx.save();
                scratchCtx.translate(srcOffX, srcOffY);
                scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
                scratchCtx.restore();
                
                scratchCtx.globalCompositeOperation = 'source-in';
                scratchCtx.fillStyle = color;
                scratchCtx.fillRect(0, 0, width, height);
            }
            
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(maskCanvas, 0, 0);
            
            ctx.save();
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.drawImage(this.scratchCanvas, 0, 0);
            ctx.restore();
        };

        if (this.lineMaskCanvas) {
            renderLayer(this.lineMaskCanvas, interiorColor);
        }

        if (this.perimeterMaskCanvas) {
            renderLayer(this.perimeterMaskCanvas, borderColor);
        }

        if (this._previewActive) {
            this.maskOps.length = this._lastPreviewSavedOpsLen;
            this.logicGrid.set(this._lastPreviewSavedLogic);
            
            // Full Reset of Render Grid to clear preview artifacts
            this.renderGrid.fill(-1);
            if (this.renderGridL1) this.renderGridL1.fill(-1);
            if (this.renderGridL2) this.renderGridL2.fill(-1);
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
         const cx = Math.floor(blocksX / 2);
         const cy = Math.floor(this.logicGridH / 2);
         
         const changesOffX = this.c.state.quantizedEditorChangesOffsetX || 0;
         const changesOffY = this.c.state.quantizedEditorChangesOffsetY || 0;
         
         ctx.save();
            
        // A. Draw Active Blocks
        const rGrid = this.renderGrid;
        if (rGrid) {
            ctx.fillStyle = 'rgba(0, 255, 0, 0.15)'; 
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)'; 
            ctx.lineWidth = 1;

            for (let i = 0; i < rGrid.length; i++) {
                if (rGrid[i] !== -1) {
                    const bx = i % blocksX;
                    const by = Math.floor(i / blocksX);
                    
                    // Snapped Coordinates
                    const cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                    
                    const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                    const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                    
                    // Use snapped dimensions for width/height
                    const nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                    const w = (nextCellX - cellX) * l.screenStepX;
                    const h = (nextCellY - cellY) * l.screenStepY;
                    
                    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
                }
            }
        }

        // B. Draw Operations (Lines, Removals)
        const ops = this.maskOps;
        if (ops && this.c.state.layerEnableEditorRemovals !== false) {
            for (const op of ops) {
                if (op.type === 'removeBlock') {
                    const bx = cx + op.x1;
                    const by = cy + op.y1;
                    
                    // Snapped Coordinates
                    const cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                    
                    const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                    const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                    
                    const nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                    const nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                    const w = (nextCellX - cellX) * l.screenStepX;
                    const h = (nextCellY - cellY) * l.screenStepY;

                    // Draw as Red Filled Block
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
                }
            }
        }
        ctx.restore();
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
        if (!this.maskCtx) {
            console.warn("[Quantized] Mask Context missing in _updateMask. Re-initializing.", w, h);
            this._ensureCanvases(w, h);
        }

        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;

        if (!ctx) {
            console.error("[Quantized] Mask Context is STILL NULL after init!", w, h);
            return;
        }

        ctx.clearRect(0, 0, w, h);

        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        if (!this.renderGrid) {
                console.error("[Quantized] renderGrid is null!");
                return;
        }

        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = this.getConfig('PerimeterThickness') !== undefined ? this.getConfig('PerimeterThickness') : 1.0;

        // Unified thickness based on the smaller dimension to ensure square lines
        const baseStep = Math.min(screenStepX, screenStepY);
        const unifiedWidth = baseStep * 0.25 * thickness;
        const lineWidthX = unifiedWidth;
        const lineWidthY = unifiedWidth;
        const gridPixW = this.g.cols * d.cellWidth; 
        const gridPixH = this.g.rows * d.cellHeight;

        const bs = this.getBlockSize();
        // Reset offsets: No oddShiftY needed
        const oddShiftY = 0.0; 
        
        // User Perimeter Offsets (Pixel Nudge)
        const userPerimeterOffsetX = s.quantizedPerimeterOffsetX || 0;
        const userPerimeterOffsetY = s.quantizedPerimeterOffsetY || 0;

        // User Shadow Offsets (Grid Snap)
        const userShadowOffsetX = s.quantizedShadowOffsetX || 0;
        const userShadowOffsetY = s.quantizedShadowOffsetY || 0;

        // Reset: Remove 0.5 and oddShiftY offsets. Align to Grid Top-Left.
        // Note: userPerimeterOffset is applied later as a post-snap nudge.
        const screenOriginX = ((s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        // Calculate Block Offsets for Snapping (matches _updateShadowSim)
        const userBlockOffX = userShadowOffsetX / (d.cellWidth * cellPitchX);
        const userBlockOffY = userShadowOffsetY / (d.cellHeight * cellPitchY);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY,
            userBlockOffX, userBlockOffY,
            pixelOffX: userPerimeterOffsetX,
            pixelOffY: userPerimeterOffsetY
        };

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const { offX, offY } = this._computeCenteredOffset(blocksX, blocksY, cellPitchX, cellPitchY);
        this.layout.offX = offX;
        this.layout.offY = offY;

        // Snapping Settings
        // "within 1 cell's distance" -> 1.0 * step
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
        this._renderInteriorPass(ctx, now, addDuration);

        // Block Erasure Pass (Handles explicit removal requested by effects)
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;
            let opacity = 1.0;
            if (now > op.startFrame && !this.debugMode) {
                const fadeOutFrames = this.getConfig('FadeFrames') || 0;
                if (fadeOutFrames > 0) {
                    opacity = Math.min(1.0, (now - op.startFrame) / fadeOutFrames);
                }
            }
            ctx.globalAlpha = opacity;
            const cx = Math.floor(this.logicGridW / 2);
            const cy = Math.floor(this.logicGridH / 2);
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            this._addBlock(start, end, false, false);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;

        // Unified Shared Edge Rendering
        this._renderEdges(pCtx, lCtx, now, blocksX, blocksY, offX, offY);
        
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
                    this._addBlock(start, end, op.ext, false);
                }
            }

            _renderEdges(pCtx, lCtx, now, blocksX, blocksY, offX, offY) {
                const l = this.layout;
                const bw = l.cellPitchX;
                const bh = l.cellPitchY;
                const fadeInFrames = this.getConfig('FadeInFrames') || 0;
                const fadeOutFrames = this.getConfig('FadeFrames') || 0;
                const cx_off = Math.floor(this.logicGridW / 2);
                const cy_off = Math.floor(this.logicGridH / 2);

                const s = this.c.state;
                const lineLengthMult = s.quantizedLineLength !== undefined ? s.quantizedLineLength : 1.0;
                const lineOffset = s.quantizedLineOffset || 0;

                // 1. Pre-rasterize Ops
                const opMap = new Map();
                for (const op of this.maskOps) {
                    if ((op.type === 'addLine' || op.type === 'removeLine') && op.face) {
                        const minX = Math.max(0, cx_off + Math.min(op.x1, op.x2));
                        const maxX = Math.min(blocksX - 1, cx_off + Math.max(op.x1, op.x2));
                        const minY = Math.max(0, cy_off + Math.min(op.y1, op.y2));
                        const maxY = Math.min(blocksY - 1, cy_off + Math.max(op.y1, op.y2));
                        const f = op.face.toUpperCase();

                        for (let by = minY; by <= maxY; by++) {
                            for (let bx = minX; bx <= maxX; bx++) {
                                const idx = by * blocksX + bx;
                                if (!opMap.has(idx)) opMap.set(idx, {});
                                opMap.get(idx)[f] = op;
                            }
                        }
                    }
                }

                const getBlockEdgeState = (bx, by, face) => {
                    if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return { active: false, time: -1, op: null };
                    const idx = by * blocksX + bx;
                    const t = this.renderGrid[idx];
                    const active = (t !== -1);
                    let op = null;

                    if (active && opMap.has(idx)) {
                        const ops = opMap.get(idx);
                        if (ops[face]) op = ops[face];
                    }
                    return { active, time: t, op };
                };

                // 2. Compute Edge States
                // No shifts or clipping needed for pure grid alignment
                const groups = new Map(); 

                // Process Vertical Edges (Cols 0 to blocksX)
                for (let by = 0; by < blocksY; by++) {
                    for (let bx = 0; bx <= blocksX; bx++) {
                        const b1 = getBlockEdgeState(bx - 1, by, 'E');
                        const b2 = getBlockEdgeState(bx, by, 'W');
                        
                        let wantLine = false;
                        if (b1.active || b2.active) {
                            const winner = (b1.time >= b2.time) ? b1 : b2;
                            wantLine = (b1.active !== b2.active);
                            if (winner.op) wantLine = (winner.op.type === 'addLine');
                            
                            const isInner = (b1.active && b2.active);
                            
                            if (wantLine) {
                                const data = { bx, by, t: winner.time, exp: winner.op ? winner.op.expireFrame : null };
                                const targetCtx = isInner ? lCtx : pCtx;
                                if (targetCtx) {
                                    const key = `${data.t}_${data.exp}_${isInner}`;
                                    if (!groups.has(key)) groups.set(key, { V: [], H: [], ctx: targetCtx, t: data.t, exp: data.exp });
                                    groups.get(key).V.push(data);
                                }
                            }
                        }
                    }
                }

                // Process Horizontal Edges (Rows 0 to blocksY)
                for (let by = 0; by <= blocksY; by++) {
                    for (let bx = 0; bx < blocksX; bx++) {
                        const b1 = getBlockEdgeState(bx, by - 1, 'S');
                        const b2 = getBlockEdgeState(bx, by, 'N');
                        
                        let wantLine = false;
                        if (b1.active || b2.active) {
                            const winner = (b1.time >= b2.time) ? b1 : b2;
                            wantLine = (b1.active !== b2.active);
                            if (winner.op) wantLine = (winner.op.type === 'addLine');
                            
                            const isInner = (b1.active && b2.active);
                            
                            if (wantLine) {
                                const data = { bx, by, t: winner.time, exp: winner.op ? winner.op.expireFrame : null };
                                const targetCtx = isInner ? lCtx : pCtx;
                                if (targetCtx) {
                                    const key = `${data.t}_${data.exp}_${isInner}`;
                                    if (!groups.has(key)) groups.set(key, { V: [], H: [], ctx: targetCtx, t: data.t, exp: data.exp });
                                    groups.get(key).H.push(data);
                                }
                            }
                        }
                    }
                }

                const lwX = l.lineWidthX * 2.0;
                const lwY = l.lineWidthY * 2.0;
                
                // 3. Draw
                for (const group of groups.values()) {
                    let opacity = 1.0;
                    if (!this.debugMode) {
                        if (fadeInFrames > 0 && group.t > 0) opacity = Math.min(opacity, (now - group.t) / fadeInFrames);
                        if (group.exp && fadeOutFrames > 0) opacity = Math.min(opacity, 1.0 - (now - group.exp) / fadeOutFrames);
                    }

                    if (opacity <= 0.001) continue;
                    
                    const ctx = group.ctx;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.globalAlpha = opacity;
                    ctx.beginPath();

                    for (const seg of group.V) {
                        // Snap X (Vertical Line Position)
                        const cellX = Math.round((seg.bx - offX + l.userBlockOffX) * bw);
                        const screenX = l.screenOriginX + (cellX + lineOffset) * l.screenStepX + l.pixelOffX;
                        
                        // Snap Y Start/End (Segment Height)
                        const cellY1 = Math.round((seg.by - offY + l.userBlockOffY) * bh);
                        const cellY2 = Math.round((seg.by + 1 - offY + l.userBlockOffY) * bh);
                        
                        let y1 = l.screenOriginY + (cellY1) * l.screenStepY + l.pixelOffY;
                        let y2 = l.screenOriginY + (cellY2) * l.screenStepY + l.pixelOffY;
                        
                        // Apply lineLengthMult
                        if (lineLengthMult !== 1.0) {
                            const midY = (y1 + y2) * 0.5;
                            const halfH = (y2 - y1) * 0.5 * lineLengthMult;
                            y1 = midY - halfH;
                            y2 = midY + halfH;
                        }

                        // Apply Snapping (Screen Pixel Snapping)
                        const sX = this._getSnap(screenX, 'x');
                        const sY1 = this._getSnap(y1, 'y');
                        const sY2 = this._getSnap(y2, 'y');

                        ctx.rect(sX - lwX/2, sY1, lwX, sY2 - sY1);
                    }

                    for (const seg of group.H) {
                        // Snap Y (Horizontal Line Position)
                        const cellY = Math.round((seg.by - offY + l.userBlockOffY) * bh);
                        const screenY = l.screenOriginY + (cellY + lineOffset) * l.screenStepY + l.pixelOffY;
                        
                        // Snap X Start/End (Segment Width)
                        const cellX1 = Math.round((seg.bx - offX + l.userBlockOffX) * bw);
                        const cellX2 = Math.round((seg.bx + 1 - offX + l.userBlockOffX) * bw);
                        
                        let x1 = l.screenOriginX + (cellX1) * l.screenStepX + l.pixelOffX;
                        let x2 = l.screenOriginX + (cellX2) * l.screenStepX + l.pixelOffX;
                        
                        // Apply lineLengthMult
                        if (lineLengthMult !== 1.0) {
                            const midX = (x1 + x2) * 0.5;
                            const halfW = (x2 - x1) * 0.5 * lineLengthMult;
                            x1 = midX - halfW;
                            x2 = midX + halfW;
                        }

                        // Apply Snapping (Screen Pixel Snapping)
                        const sY = this._getSnap(screenY, 'y');
                        const sX1 = this._getSnap(x1, 'x');
                        const sX2 = this._getSnap(x2, 'x');

                        ctx.rect(sX1, sY - lwY/2, sX2 - sX1, lwY);
                    }
                    ctx.fill();    
                }
            }

    _drawExteriorLine(ctx, bx, by, face, options) {
        const l = this.layout;
        const color = options.color || "#FFFFFF";
        const opacity = options.opacity !== undefined ? options.opacity : 1.0;
        
        ctx.globalAlpha = opacity;
        
        // Setup fill style if needed, though usually handled by layer tinting.
        // If we are drawing to a mask, alpha is what matters.
        
        ctx.beginPath();
                                                const lwX = l.lineWidthX * 2.0;
                                                const lwY = l.lineWidthY * 2.0;        // Handle face as String or Object
        const faceObj = (typeof face === 'string') ? {dir: face} : face;
        
        this._addPerimeterFacePath(ctx, bx, by, faceObj, lwX, lwY);
        ctx.fill();
    }

    _drawInteriorLine(ctx, bx, by, face, options) {
        const l = this.layout;
        const opacity = options.opacity !== undefined ? options.opacity : 1.0;
        
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        const lwX = l.lineWidthX;
        const lwY = l.lineWidthY;
        
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
        const lineOffset = s.quantizedLineOffset || 0;

        // Snap Cell Indices
        const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
        const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
        const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);
        
        let cx, cy;
        if (corner === 'NW') {
            cx = l.screenOriginX + ((startCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'NE') {
            cx = l.screenOriginX + ((endCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SW') {
            cx = l.screenOriginX + ((startCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SE') {
            cx = l.screenOriginX + ((endCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
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
        const offX = l.offX || 0;
        const offY = l.offY || 0;

        const s = this.c.state;
        const lineLengthMult = s.quantizedLineLength !== undefined ? s.quantizedLineLength : 1.0;
        const lineOffset = s.quantizedLineOffset || 0;
        
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
            let cy = l.screenOriginY + ((startCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
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

            drawY = cy; drawH = widthY; drawX = leftX; drawW = rightX - leftX;
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'S') {
            let bottomY = l.screenOriginY + ((endCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
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

            drawY = bottomY - widthY; drawH = widthY; drawX = leftX; drawW = rightX - leftX;
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'W') {
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX + lineOffset) * l.screenStepX) + l.pixelOffX;

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

            drawX = leftX; drawW = widthX; drawY = topY; drawH = bottomY - topY;
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
        } else if (face === 'E') {
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let rightX = l.screenOriginX + ((endCellX + lineOffset) * l.screenStepX) + l.pixelOffX;

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

            drawX = rightX - widthX; drawW = widthX; drawY = topY; drawH = bottomY - topY;
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
        const lineOffset = s.quantizedLineOffset || 0;

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
                    let cy = l.screenOriginY + ((startCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
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
                    let cy = l.screenOriginY + ((endCellY + lineOffset) * l.screenStepY) + l.pixelOffY;
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
                    let cx = l.screenOriginX + ((startCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
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
                    let cx = l.screenOriginX + ((endCellX + lineOffset) * l.screenStepX) + l.pixelOffX;
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