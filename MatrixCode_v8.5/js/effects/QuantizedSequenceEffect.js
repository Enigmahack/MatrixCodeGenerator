class QuantizedSequenceEffect extends AbstractEffect {
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
        // Default to config if available, otherwise 4
        // Subclasses can override
        const w = this.c.state.quantizedBlockWidthCells || 4;
        const h = this.c.state.quantizedBlockHeightCells || 4;
        return { w, h };
    }

    _initLogicGrid() {
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        const blocksX = Math.ceil(this.g.cols / cellPitchX);
        const blocksY = Math.ceil(this.g.rows / cellPitchY);
        
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
        this.animFrame = 0;
        this._maskDirty = true;
        
        this._initLogicGrid();

        if (this.debugMode) {
            window.removeEventListener('keydown', this._boundDebugHandler);
            window.addEventListener('keydown', this._boundDebugHandler);
        }

        return true;
    }

    hitTest(x, y) {
        if (!this.layout) return null;
        const l = this.layout;
        const blockScreenW = l.cellPitchX * l.screenStepX;
        const blockScreenH = l.cellPitchY * l.screenStepY;
        
        const bx = Math.floor((x - l.screenOriginX) / blockScreenW);
        const by = Math.floor((y - l.screenOriginY) / blockScreenH);
        
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
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now });
                        this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now });
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
                    if (mask & 1) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now });
                    if (mask & 2) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now });
                    if (mask & 4) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now });
                    if (mask & 8) this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now });
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
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now });
                    this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now });
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
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, startFrame: now });
            } else if (op === 'remLine') {
                const [dx, dy, face] = args;
                this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
            }
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
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        const blocksX = Math.ceil(this.g.cols / cellPitchX);
        const blocksY = Math.ceil(this.g.rows / cellPitchY);
        const requiredSize = blocksX * blocksY;
        
        if (!this.renderGrid || this.renderGrid.length !== requiredSize) {
             this.renderGrid = new Int32Array(requiredSize);
        }
    }

    _initShadowWorldBase(workerEnabled = false) {
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        // Add padding to ensure floor() doesn't drop a column due to precision
        const w = (this.g.cols * d.cellWidth) + (d.cellWidth * 0.5);
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
            
            // 1. Copy Grid Buffers
            this._copyGridBuffers(g, sg);
            
            // 2. Swap Stream Manager
            if (window.matrix && window.matrix.simulation) {
                const mainSim = window.matrix.simulation;
                const shadowMgr = this.shadowSim.streamManager;
                
                // Serialize Streams
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
                
                // Adjust Spawn Frame
                const frameOffset = mainSim.frame || 0; 
                // We use this.shadowSimFrame (if set) or this.localFrame (if set) to calc delta
                const shadowFrame = (this.shadowSimFrame !== undefined) ? this.shadowSimFrame : (this.localFrame || 0);
                const delta = frameOffset - shadowFrame;
                state.nextSpawnFrame = shadowMgr.nextSpawnFrame + delta;

                if (mainSim.useWorker && mainSim.worker) {
                    mainSim.worker.postMessage({ type: 'replace_state', state: state });
                    mainSim.worker.postMessage({ type: 'config', config: { state: JSON.parse(JSON.stringify(this.c.state)), derived: this.c.derived } });
                    return 'ASYNC'; // Signal that we are entering async transition
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
                    return 'SYNC'; // Signal immediate success
                }
            }
            return 'SYNC';
        } catch (e) {
            console.error("[QuantizedEffect] Swap failed:", e);
            return false;
        }
    }

    _copyGridBuffers(g, sg) {
        // Robust Buffer Copy (Handles stride/dimension mismatch)
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
        
        // Remap Active Indices
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
        
        // Remap Complex Styles
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
        
        if (timeSeed === this.lastGridSeed) return; 
        this.lastGridSeed = timeSeed;
        
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
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        
        const drawChar = (x, y) => {
            if (x >= cols || y >= rows) return;
            const i = (y * cols) + x;
            let charCode = chars[i];
            if (charCode <= 32) {
                const activeFonts = d.activeFonts;
                const fontData = activeFonts[0] || { chars: "01" };
                const charSet = fontData.chars;
                
                const seed = i * 12.9898 + timeSeed * 78.233;
                const hash = Math.abs(Math.sin(seed) * 43758.5453) % 1;
                
                const char = charSet[Math.floor(hash * charSet.length)];
                charCode = char.charCodeAt(0);
            }
            const cx = screenOriginX + (x * screenStepX);
            const cy = screenOriginY + (y * screenStepY);
            ctx.setTransform(s.stretchX, 0, 0, s.stretchY, cx, cy);
            ctx.fillText(String.fromCharCode(charCode), 0, 0);
        };

        for (let by = 0; by <= blocksY; by++) {
            const y = Math.floor(by * cellPitchY);
            if (y >= rows) continue; 
            for (let x = 0; x < cols; x++) drawChar(x, y);
        }
        for (let bx = 0; bx <= blocksX; bx++) {
            const x = Math.floor(bx * cellPitchX);
            if (x >= cols) continue;
            for (let y = 0; y < rows; y++) drawChar(x, y);
        }
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const lineWidthX = screenStepX * 0.25;
        const lineWidthY = screenStepY * 0.25;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY
        };

        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const fadeFrames = this.getConfig('FadeFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);
        const removeDuration = Math.max(1, fadeFrames);

        this.renderGrid.fill(-1);
        
        for (const op of this.maskOps) {
            if (op.startFrame && now < op.startFrame) continue;

            if (op.type === 'add' || op.type === 'addSmart') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = op.startFrame || 0;
                        }
                    }
                }
            } else if (op.type === 'removeBlock') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                         if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = -1;
                        }
                    }
                }
            }
        }

        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            return this.renderGrid[by * blocksX + bx] !== -1;
        };
        
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
             const activeStart = this.renderGrid[by * blocksX + bx];
             if (activeStart !== -1 && activeStart > time) return true;
             return false;
        };

        // --- PASS 1: Base Grid ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, op.ext);
        }

        // --- PASS 1.5: Smart Perimeter ---
        for (const op of this.maskOps) {
            if (op.type !== 'addSmart') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    const nN = isRenderActive(bx, by - 1);
                    const nS = isRenderActive(bx, by + 1);
                    const nW = isRenderActive(bx - 1, by);
                    const nE = isRenderActive(bx + 1, by);
                    
                    const isConnected = nN || nS || nW || nE;
                    this._addBlock({x:bx, y:by}, {x:bx, y:by}, isConnected);
                }
            }
        }
        
        // --- PASS 1.9: Block Erasure ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, false);
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 2: Erasures ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'remove') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            
            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                     if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                     this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                }
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 3: Perimeter ---
        const boldLineWidthX = lineWidthX * 2.0; 
        const boldLineWidthY = lineWidthY * 2.0;
        
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const startFrame = this.renderGrid[by * blocksX + bx];
                if (startFrame === -1) continue;

                let opacity = 1.0;
                if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
                else if (startFrame) opacity = Math.min(1.0, (now - startFrame) / addDuration);
                ctx.globalAlpha = opacity;

                const nN = isRenderActive(bx, by - 1);
                const nS = isRenderActive(bx, by + 1);
                const nW = isRenderActive(bx - 1, by);
                const nE = isRenderActive(bx + 1, by);

                if (!nN) this._drawPerimeterFace(bx, by, 'N', boldLineWidthX, boldLineWidthY);
                if (!nS) this._drawPerimeterFace(bx, by, 'S', boldLineWidthX, boldLineWidthY);
                if (!nW) this._drawPerimeterFace(bx, by, 'W', boldLineWidthX, boldLineWidthY);
                if (!nE) this._drawPerimeterFace(bx, by, 'E', boldLineWidthX, boldLineWidthY);
            }
        }

        // --- PASS 4: Line Operations ---
        const lineOps = this.maskOps.filter(op => op.type === 'addLine' || op.type === 'removeLine');
        lineOps.sort((a, b) => (a.startFrame - b.startFrame));

        for (const op of lineOps) {
            let opacity = 1.0;
            const duration = (op.type === 'addLine') ? addDuration : removeDuration;
            
            if (op.type === 'addLine' && (fadeInFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.type === 'removeLine' && (fadeFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / duration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };

            if (op.type === 'addLine') {
                ctx.globalCompositeOperation = 'source-over';
                this._addBlockFace(start, end, op.face);
            } else {
                ctx.globalCompositeOperation = 'destination-out';
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                        this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                    }
                }
            }
        }
        
        // --- PASS 6: Corner Cleanup ---
        const cornerMap = new Map(); 
        const activeRemovals = this.maskOps.filter(op => {
            if (op.type !== 'remove' && op.type !== 'removeLine') return false;
            if (!op.startFrame) return false;
            return (now >= op.startFrame);
        });

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
                    if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue; 
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
            const by = Math.floor(idx / blocksX);
            
            if ((mask & 1) && (mask & 8)) this._removeBlockCorner(bx, by, 'NW');
            if ((mask & 1) && (mask & 4)) this._removeBlockCorner(bx, by, 'NE');
            if ((mask & 2) && (mask & 8)) this._removeBlockCorner(bx, by, 'SW');
            if ((mask & 2) && (mask & 4)) this._removeBlockCorner(bx, by, 'SE');
        }
        
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
    }

    _removeBlockCorner(bx, by, corner) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const cellX = Math.floor(bx * l.cellPitchX);
        const cellY = Math.floor(by * l.cellPitchY);
        let cx, cy;
        
        if (corner === 'NW') {
            cx = l.screenOriginX + (cellX * l.screenStepX);
            cy = l.screenOriginY + (cellY * l.screenStepY);
        } else if (corner === 'NE') {
            const endCellX = Math.floor((bx + 1) * l.cellPitchX);
            cx = l.screenOriginX + (endCellX * l.screenStepX);
            cy = l.screenOriginY + (cellY * l.screenStepY);
        } else if (corner === 'SW') {
            const endCellY = Math.floor((by + 1) * l.cellPitchY);
            cx = l.screenOriginX + (cellX * l.screenStepX);
            cy = l.screenOriginY + (endCellY * l.screenStepY);
        } else if (corner === 'SE') {
            const endCellX = Math.floor((bx + 1) * l.cellPitchX);
            const endCellY = Math.floor((by + 1) * l.cellPitchY);
            cx = l.screenOriginX + (endCellX * l.screenStepX);
            cy = l.screenOriginY + (endCellY * l.screenStepY);
        }
        
        const inflate = 1.0; 
        ctx.beginPath();
        ctx.rect(cx - l.halfLineX - inflate, cy - l.halfLineY - inflate, l.lineWidthX + (inflate*2), l.lineWidthY + (inflate*2));
        ctx.fill();
    }

    _addBlockFace(blockStart, blockEnd, face) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();
        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);
                const hx = l.lineWidthX / 2;
                const hy = l.lineWidthY / 2;

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
                    const w = ((endCellX - startCellX) * l.screenStepX) + l.lineWidthX;
                    ctx.rect(x, cy - hy, w, l.lineWidthY);
                } else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
                    const w = ((endCellX - startCellX) * l.screenStepX) + l.lineWidthX;
                    ctx.rect(x, cy - hy, w, l.lineWidthY);
                } else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
                    const h = ((endCellY - startCellY) * l.screenStepY) + l.lineWidthY;
                    ctx.rect(cx - hx, y, l.lineWidthX, h);
                } else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
                    const h = ((endCellY - startCellY) * l.screenStepY) + l.lineWidthY;
                    ctx.rect(cx - hx, y, l.lineWidthX, h);
                }
            }
        }
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    _drawPerimeterFace(bx, by, face, widthX, widthY) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startCellX = Math.floor(bx * l.cellPitchX);
        const startCellY = Math.floor(by * l.cellPitchY);
        const endCellX = Math.floor((bx + 1) * l.cellPitchX);
        const endCellY = Math.floor((by + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        const hx = widthX / 2;
        const hy = widthY / 2;

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'S') {
            const cy = l.screenOriginY + (endCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'W') {
            const cx = l.screenOriginX + (startCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        } else if (face === 'E') {
            const cx = l.screenOriginX + (endCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        }
        ctx.fill();
    }

    _addBlock(blockStart, blockEnd, isExtending) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startX = Math.floor(blockStart.x * l.cellPitchX);
        const endX = Math.floor((blockEnd.x + 1) * l.cellPitchX);
        const startY = Math.floor(blockStart.y * l.cellPitchY);
        const endY = Math.floor((blockEnd.y + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        if (isExtending) {
            let cy = l.screenOriginY + (startY * l.screenStepY);
            ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
            cy = l.screenOriginY + (endY * l.screenStepY);
            ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
            let cx = l.screenOriginX + (startX * l.screenStepX);
            ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
            cx = l.screenOriginX + (endX * l.screenStepX);
            ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
        } else {
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;
            for (let bx = rangeMinBx; bx <= rangeMaxBx + 1; bx++) {
                const cellX = Math.floor(bx * l.cellPitchX);
                const cx = l.screenOriginX + (cellX * l.screenStepX);
                const yPos = l.screenOriginY + (startY * l.screenStepY);
                const h = (endY - startY) * l.screenStepY;
                ctx.rect(cx - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
            }
            for (let by = rangeMinBy; by <= rangeMaxBy + 1; by++) {
                const cellY = Math.floor(by * l.cellPitchY);
                const cy = l.screenOriginY + (cellY * l.screenStepY);
                const xPos = l.screenOriginX + (startX * l.screenStepX);
                const w = (endX - startX) * l.screenStepX;
                ctx.rect(xPos - l.halfLineX, cy - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
            }
        }
        ctx.fill();
    }

    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();
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
                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);
                const safety = 0.5;
                const safeX = l.halfLineX + safety; 
                const safeY = l.halfLineY + safety; 
                const inflate = 0.5; 

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                } else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                }
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    renderDebug(ctx, derived) {
        if (!this.debugMode) return;
        
        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        // Ensure layout is calculated for debug mode
        if (!this.layout || this.maskCanvas.width !== width || this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }

        // Draw Debug View (Gold Grid)
        // 1. Render Text to Scratch Canvas
        this._updateGridCache(width, height, s, derived);
        
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        // Draw cached grid
        scratchCtx.globalAlpha = 1.0; 
        scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);

        // 2. Apply Mask
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(this.maskCanvas, 0, 0);

        // 3. Composite
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        
        // Colors
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
        // 1. Save State
        const savedLogicGrid = new Uint8Array(this.logicGrid);
        const savedMaskOpsLen = this.maskOps.length;
        
        // 2. Apply Preview Op
        if (previewOp) {
            // previewOp is in format {op: 'add', args: [...]} or array
            // _executeStepOps expects an array of ops (a step)
            this._executeStepOps([previewOp]);
        }
        
        // 3. Update Derived Grids (RenderGrid) if method exists
        // This is crucial for subclasses like QuantizedPulseEffect/QuantizedAddEffect
        // that rely on renderGrid for visibility checks in _updateMask
        if (typeof this._updateRenderGridLogic === 'function') {
            this._updateRenderGridLogic();
        }

        // 4. Render using the standard Debug pipeline
        this.renderDebug(ctx, derived);

        // 5. Restore State
        if (previewOp) {
            this.maskOps.length = savedMaskOpsLen;
            this.logicGrid.set(savedLogicGrid);
             // Restore RenderGrid to original state
            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
        }
    }
}