/**
 * QuantizedBaseEffect.js - Version 8.5.1
 */
class QuantizedBaseEffect extends AbstractEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.configPrefix = "quantizedPulse"; 
        
        // Components
        this.sequenceManager = new QuantizedSequence();
        this.shadowController = new QuantizedShadow();
        this.renderer = new QuantizedRenderer();
        this.stateCache = new QuantizedStateCache();

        // Sequence State
        this.sequence = [[]];
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Grid State
        this.logicGrid = null;
        this.logicGridW = 0;
        this.logicGridH = 0;
        this.renderGrid = null; 
        this.layerGrids = [];   
        this.removalGrids = []; 
        this.perimeterHistory = []; // Capture history for Perimeter Echo        
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

        this._outsideMap = null;
        this._outsideMapWidth = 0;
        this._outsideMapHeight = 0;
        this._outsideMapDirty = true;
        this._gridCacheDirty = true;
        
        // Logic Grid Scaling
        this.logicScale = 1.0;
        
        // Shadow World Swap State
        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;

        // Line Tracking
        this.lineStates = new Map(); 
        this.suppressedFades = new Set(); 
        this.lastVisibilityChangeFrame = 0;
        this.lastMaskUpdateFrame = 0;
        this.warmupRemaining = 0;

        // Procedural Generation State
        this.blockMap = new Map();
        this.activeBlocks = [];
        this.unfoldSequences = [[], [], [], []];
        this.visibleLayers = [true, true, true, true];
        this.layerOrder = [0, 1, 2, 3];
        this.proceduralLayerIndex = 0;
        this.nextBlockId = 0;
        this.overlapState = { step: 0 };
        this.cycleState = null;
        this.isReconstructing = false;
        this.expansionComplete = false;

        // Buffer Pool for high-frequency operations
        this._bufferPool = {
            combined: null,
            connectedMap: null,
            queue: null,
            syncGrid: null,
            stepOccupancy: null
        };
        this._gridsDirty = true;
        this._lastRendererOpIndex = 0;

        // --- V2 GENERATIVE ENGINE ---
        this.growthPool = new Map();
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            snapshots: [],
            lastActionTime: 0,
            fillRatio: 0,
            scx: 0,
            scy: 0,
            hitEdge: false,
            insideOutWave: 1,
            deferredRows: new Map(),
            spreadingNudgeSymmetryQueue: []
        };
        this.strips = new Map();
        this._stripNextId = 0;
        this.actionBuffer = [];
        this.actionQueues = new Map();

        // --- ADVANCED PROCEDURAL ENGINE ---
        this.finishedBranches = new Set();
        this.nudgeAxisBalance = 0;
        this.usedCardinalIndices = [];
        
        this.RULES = {
            bounds: (c) => {
                const w = this.logicGridW, h = this.logicGridH;
                const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
                if (cx + c.x < 0 || cx + c.x + c.w > w || cy + c.y < 0 || cy + c.y + c.h > h) return false;
                return true;
            },
            occupancy: (c) => {
                if (c.bypassOccupancy || !this._stepOccupancy) return true;
                const w = this.logicGridW, h = this.logicGridH;
                const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
                const x1 = Math.max(0, cx + c.x), y1 = Math.max(0, cy + c.y);
                const x2 = Math.min(w - 1, x1 + c.w - 1), y2 = Math.min(h - 1, y1 + c.h - 1);
                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) {
                        if (this._stepOccupancy[rowOff + gx] === 1) return false;
                    }
                }
                return true;
            },
            connectivity: (c) => {
                if (c.skipConnectivity || this.debugMode) return true;
                const grid = this.layerGrids[c.layer];
                if (!grid) return false;
                const w = this.logicGridW, h = this.logicGridH;
                const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
                const x1 = Math.max(0, cx + c.x), y1 = Math.max(0, cy + c.y);
                const x2 = Math.min(w - 1, x1 + c.w - 1), y2 = Math.min(h - 1, y1 + c.h - 1);
                let connected = false, overlapCount = 0, area = c.w * c.h;
                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) {
                        const idx = rowOff + gx;
                        if (grid[idx] !== -1) { overlapCount++; connected = true; c._foundAnchorIdx = idx; }
                    }
                }
                if (!c.isShifter && !c.allowInternal && overlapCount >= area) return false;
                if (connected) return true;
                if (y1 > 0) {
                    const rowOff = (y1 - 1) * w;
                    for (let gx = x1; gx <= x2; gx++) if (grid[rowOff + gx] !== -1) { c._foundAnchorIdx = rowOff + gx; return true; }
                }
                if (y2 < h - 1) {
                    const rowOff = (y2 + 1) * w;
                    for (let gx = x1; gx <= x2; gx++) if (grid[rowOff + gx] !== -1) { c._foundAnchorIdx = rowOff + gx; return true; }
                }
                if (x1 > 0) {
                    for (let gy = y1; gy <= y2; gy++) if (grid[gy * w + x1 - 1] !== -1) { c._foundAnchorIdx = gy * w + x1 - 1; return true; }
                }
                if (x2 < w - 1) {
                    for (let gy = y1; gy <= y2; gy++) if (grid[gy * w + x2 + 1] !== -1) { c._foundAnchorIdx = gy * w + x2 + 1; return true; }
                }
                return false;
            },
            direction: (c) => {
                if (c.isShifter || c.isMirroredSpawn || c.skipConnectivity || this.debugMode) return true;
                const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
                const nx = c.x + c.w / 2, ny = c.y + c.h / 2, newDistSq = nx * nx + ny * ny;
                if (c._foundAnchorIdx !== undefined) {
                    const ax_abs = c._foundAnchorIdx % this.logicGridW, ay_abs = Math.floor(c._foundAnchorIdx / this.logicGridW);
                    const ax = ax_abs - cx + 0.5, ay = ay_abs - cy + 0.5, anchorDistSq = ax * ax + ay * ay;
                    if (newDistSq < anchorDistSq - 0.01) return false;
                }
                return true;
            },
            spatial: (c) => {
                if (c.isMirroredSpawn || c.isShifter || c.bypassSpatial || this.debugMode) return true;
                if (!this._currentStepActions || this._currentStepActions.length === 0) return true;
                const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
                const bs = this.getBlockSize(), screenW = Math.ceil(this.g.cols / bs.w), screenH = Math.ceil(this.g.rows / bs.h);
                const minDistance = Math.max(1, Math.floor(Math.max(screenW, screenH) * 0.05));
                for (const action of this._currentStepActions) {
                    if (action.x === c.x && action.y === c.y) return false;
                    const ax = action.x + action.w / 2, ay = action.y + action.h / 2, dist = Math.abs(cx - ax) + Math.abs(cy - ay);
                    if (dist < minDistance) return false;
                }
                return true;
            },
            vacated: (c) => {
                if (c.bypassOccupancy) return true;
                const grid = this.removalGrids[c.layer];
                if (!grid) return true;
                return true;
            }
        };
    }

    _getBuffer(key, length, type = Uint8Array) {
        if (!this._bufferPool[key] || this._bufferPool[key].length !== length) {
            this._bufferPool[key] = new type(length);
        }
        return this._bufferPool[key];
    }

    _checkDirtiness() {
        if (this._maskDirty || this._previewActive) return; 

        // Monitor Quantized Defaults
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        if (!overrideDefaults) {
            for (const setting of QuantizedInheritableSettings) {
                const defaultKey = 'quantizedDefault' + setting.id;
                const currentVal = this.c.state[defaultKey];
                const cachedKey = '_lastDefault_' + setting.id;
                
                if (currentVal !== this[cachedKey]) {
                    this._maskDirty = true;
                    this._gridCacheDirty = true;
                    this[cachedKey] = currentVal;
                }
            }
        }

        const fadeIn = Math.max(1, this.getConfig('FadeInFrames') || 0);
        const fadeOut = Math.max(1, this.getConfig('FadeFrames') || 0);
        const lineFade = Math.max(1, this.getLineGfxValue('Persistence') || 0);
        const maxDuration = Math.max(fadeIn, fadeOut, lineFade) + 2; 

        if (this.animFrame - this.lastVisibilityChangeFrame < maxDuration) {
            this._maskDirty = true;
            return;
        }

        if (this.maskOps) {
            for (let i = this.maskOps.length - 1; i >= 0; i--) {
                const op = this.maskOps[i];
                const age = this.animFrame - (op.startFrame || 0);
                if (age < maxDuration) {
                    this._maskDirty = true;
                    return;
                }
                if (age >= maxDuration) break; 
            }
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

    _log(...args) { if (this.c.state.logErrors) console.log(...args); }
    _warn(...args) { if (this.c.state.logErrors) console.warn(...args); }
    _error(...args) { if (this.c.state.logErrors) console.error(...args); }

    getConfig(keySuffix) {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettings.some(s => s.id === keySuffix);
        
        const key = this.configPrefix + keySuffix;
        const val = this.c.state[key];

        // 1. If we are NOT overriding, AND this is an inheritable setting, use the default.
        if (!overrideDefaults && isInheritable) {
            const defaultKey = 'quantizedDefault' + keySuffix;
            const defaultVal = this.c.state[defaultKey];
            if (defaultVal !== undefined && defaultVal !== null) return defaultVal;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        return (val !== undefined && val !== null && val !== "") ? val : null;
    }

    _getMaxLayer() {
        let maxLayer = this.getConfig('LayerCount');
        if (maxLayer === undefined || maxLayer === null) maxLayer = 0;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
        if (usePromotion && (maxLayer === undefined || maxLayer === null || maxLayer < 1)) return 1;
        return maxLayer;
    }

    getLineGfxValue(suffix) {
        // Special case for Thickness: prioritze the 'PerimeterThickness' slider in the effect UI
        if (suffix === 'Thickness') {
            const effectThick = this.getConfig('PerimeterThickness');
            if (effectThick !== undefined && effectThick !== null) {
                return effectThick;
            }
        }

        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettings.some(s => s.id === 'LineGfx' + suffix);

        const key = this.configPrefix + 'LineGfx' + suffix;
        const val = this.c.state[key];

        // 1. If we are NOT overriding, AND this is an inheritable setting, use the default.
        if (!overrideDefaults && isInheritable) {
            const defaultKey = 'quantizedDefaultLineGfx' + suffix;
            const defaultVal = this.c.state[defaultKey];
            if (defaultVal !== undefined && defaultVal !== null) return defaultVal;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        return (val !== undefined && val !== null && val !== "") ? val : null;
    }

    getEchoGfxValue(suffix) {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettings.some(s => s.id === 'EchoGfx' + suffix);

        const key = this.configPrefix + 'EchoGfx' + suffix;
        const val = this.c.state[key];

        // 1. If we are NOT overriding, AND this is an inheritable setting, use the default.
        if (!overrideDefaults && isInheritable) {
            const defaultKey = 'quantizedDefaultEchoGfx' + suffix;
            const defaultVal = this.c.state[defaultKey];
            if (defaultVal !== undefined && defaultVal !== null) return defaultVal;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        return (val !== undefined && val !== null && val !== "") ? val : null;
    }

    getBlockSize() {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        let w, h;
        if (!overrideDefaults) {
            w = this.c.state['quantizedDefaultBlockWidthCells'];
            h = this.c.state['quantizedDefaultBlockHeightCells'];
        }
        if (w == null) w = this.c.state[this.configPrefix + 'BlockWidthCells'];
        if (h == null) h = this.c.state[this.configPrefix + 'BlockHeightCells'];
        if (w == null) w = this.c.state.quantizedBlockWidthCells;
        if (h == null) h = this.c.state.quantizedBlockHeightCells;
        return { w: w || 4, h: h || 4 };
    }

    _initLogicGrid() {
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        
        let blocksX = Math.ceil((this.g.cols * this.logicScale) / cellPitchX);
        let blocksY = Math.ceil((this.g.rows * this.logicScale) / cellPitchY);

        // Ensure integer cell offsets by making (blocks * pitch - screenCells) even
        if ((blocksX * cellPitchX - this.g.cols) % 2 !== 0) blocksX++;
        if ((blocksY * cellPitchY - this.g.rows) % 2 !== 0) blocksY++;
        
        if (!this.logicGrid || this.logicGrid.length !== blocksX * blocksY) {
            this.logicGrid = new Uint8Array(blocksX * blocksY);
        } else {
            this.logicGrid.fill(0);
        }
        this.logicGridW = blocksX;
        this.logicGridH = blocksY;
        this._gridsDirty = true;

        if (!this.renderGrid || this.renderGrid.length !== blocksX * blocksY) {
            this.renderGrid = new Int32Array(blocksX * blocksY);
        }
        this.renderGrid.fill(-1);

        if (!this.promotionGrid || this.promotionGrid.length !== blocksX * blocksY) {
            this.promotionGrid = new Uint8Array(blocksX * blocksY);
        }
        this.promotionGrid.fill(0);

        if (!this.shadowRevealGrid || this.shadowRevealGrid.length !== blocksX * blocksY) {
            this.shadowRevealGrid = new Uint8Array(blocksX * blocksY);
        }
        this.shadowRevealGrid.fill(0);
        
        for (let i = 0; i < 4; i++) {
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

        // Initialize coverage counter
        this._visibleEmptyCount = -1; // Force recalculation
        this._lastCoverageRect = null;
    }

    _updateVisibleEmptyCount() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h || !this.renderGrid) return;
        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(w, h, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);

        let count = 0;
        for (let gy = startY; gy < endY; gy++) {
            const rowOff = gy * w;
            for (let gx = startX; gx < endX; gx++) {
                if (this.renderGrid[rowOff + gx] === -1) count++;
            }
        }
        
        if (this.name === "QuantizedBlockGenerator" && this.animFrame % 60 === 0) {
            this._log(`[${this.name}] _updateVisibleEmptyCount: w=${w}, h=${h}, offX=${offX.toFixed(2)}, offY=${offY.toFixed(2)}, startX=${startX}, endX=${endX}, startY=${startY}, endY=${endY}, visibleW=${visibleW}, visibleH=${visibleH}, count=${count}`);
        }

        this._visibleEmptyCount = count;
        this._lastCoverageRect = { startX, endX, startY, endY };
    }

    _isCanvasFullyCovered() {
        if (this._visibleEmptyCount === -1) {
            this._updateVisibleEmptyCount();
        }
        return this._visibleEmptyCount <= 0;
    }

    _getLooselyCentralAnchors(targetLayer, sampleSize = 30) {
        const anchors = this.activeBlocks.filter(b => b.layer === targetLayer);
        if (anchors.length === 0) return [];
        
        if (anchors.length <= sampleSize) {
            return anchors.sort((a, b) => a.dist - b.dist);
        }

        const sample = [];
        for (let i = 0; i < sampleSize; i++) {
            sample.push(anchors[Math.floor(Math.random() * anchors.length)]);
        }
        return sample.sort((a, b) => a.dist - b.dist);
    }

    _getEdgeAnchors(targetLayer, sampleSize = 30) {
        const anchors = this.activeBlocks.filter(b => b.layer === targetLayer);
        if (anchors.length === 0) return [];
        
        if (anchors.length <= sampleSize) {
            return anchors.sort((a, b) => b.dist - a.dist);
        }

        const sample = [];
        for (let i = 0; i < sampleSize; i++) {
            sample.push(anchors[Math.floor(Math.random() * anchors.length)]);
        }
        return sample.sort((a, b) => b.dist - a.dist);
    }

    _resetV2Engine() {
        this.strips.clear();
        this._stripNextId = 0;
        this.actionBuffer = [];
        this.actionQueues.clear();
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            snapshots: [],
            lastActionTime: 0,
            fillRatio: 0,
            scx: 0,
            scy: 0,
            hitEdge: false,
            insideOutWave: 1,
            deferredCols: new Map(),
            deferredRows: new Map(),
            seedSchedule: null,
            ribOrigins: new Set(),
            pendingDeletions: [],
            pendingExpansions: [],
            spreadingNudgeSymmetryQueue: []
        };
        // Re-init behaviors to refresh their closure state if needed
        this._initBehaviors();
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        
        // Reset V2 engine state for a clean slate
        this._resetV2Engine();

        const enabled = this.getConfig('Enabled');
        if (!enabled && !force) return false;

        if (window.matrixPatterns && window.matrixPatterns[this.name]) {
            this.sequence = window.matrixPatterns[this.name];
            if (this.sequence.length > 1000) {
                this.sequence = this.sequence.slice(0, 1000);
            }
        }

        this.active = true;
        this.expansionComplete = false;
        
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this._lastProcessedOpIndex = 0;
        this._lastRendererOpIndex = 0;
        this.animFrame = 0;
        this._maskDirty = true;
        this._gridsDirty = true;
        this._outsideMapDirty = true;
        
        // Reset Render Cache
        this.renderer._edgeCacheDirty = true;
        this.renderer._distMapDirty = true;
        this.renderer._cachedEdgeMaps = [];
        this._outsideMapDirty = true;
        this._gridCacheDirty = true;
        this.lastGridSeed = -1;
        
        this.lineStates = new Map();
        this.suppressedFades.clear();
        this.lastVisibilityChangeFrame = 0;
        this.lastMaskUpdateFrame = 0;
        
        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;
        
        this.blockMap.clear();
        this.activeBlocks = [];
        this.unfoldSequences = [[], [], [], []];
        this.nextBlockId = 0;
        this.proceduralInitiated = false;
        this.finishedBranches.clear();
        this.nudgeAxisBalance = 0;
        this.usedCardinalIndices = [];
        this._syncFrame = -1;
        this._lastSyncOpCount = -1;
        this._currentStepActions = [];
        
        this._initLogicGrid();
        this.stateCache.clear();

        this.state = 'FADE_IN';
        this.timer = 0;
        this.step = 0;
        this.lastCapturedStep = -1;
        this.perimeterHistory = [];
        this.alpha = 0.0;

        if (this.debugMode) {
            // Keydown handling for stepping is managed by the Editor when active
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
        const offX = options.editorOffX || 0;
        const offY = options.editorOffY || 0;
        const cellX = (x - offX - l.screenOriginX - l.pixelOffX) / l.screenStepX;
        const cellY = (y - offY - l.screenOriginY - l.pixelOffY) / l.screenStepY;
        const bx_screen = Math.floor(cellX);
        const by_screen = Math.floor(cellY);
        const rawBx = (bx_screen / l.cellPitchX) + l.offX - l.userBlockOffX;
        const rawBy = (by_screen / l.cellPitchY) + l.offY - l.userBlockOffY;
        const bx = Math.floor(rawBx + 0.001);
        const by = Math.floor(rawBy + 0.001);
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        if (bx >= -10 && bx <= blocksX + 10 && by >= -10 && by <= blocksY + 10) {
            return { x: bx - cx, y: by - cy, absX: bx, absY: by };
        }
        return null;
    }

    jumpToStep(targetStepsCompleted) {
        // Optimization: If we are already at the target step and not dirty, skip
        if (targetStepsCompleted === this.expansionPhase && !this._gridsDirty && !this.isReconstructing) {
            return;
        }

        const framesPerStep = 60;
        
        // --- 1. Fast State Restore from Cache ---
        const snapshot = this.stateCache.getNearest(targetStepsCompleted);
        let startStep = 0;

        if (snapshot && (targetStepsCompleted < this.expansionPhase || snapshot.stepIndex > this.expansionPhase)) {
            // If jumping backwards OR jumping forward past a snapshot, restore it
            this.isReconstructing = true;
            this.stateCache.restore(this, snapshot);
            startStep = snapshot.stepIndex;
            this.isReconstructing = false;
        } else if (targetStepsCompleted >= this.expansionPhase && !this.isReconstructing && this.logicGrid) {
            // Standard Incremental Forward Jump
            startStep = this.expansionPhase;
        } else {
            // Full Reconstruction from Step 0 (No snapshot found)
            this.isReconstructing = true;
            this.maskOps = [];
            this.activeBlocks = []; 
            this.nextBlockId = 0;
            this.proceduralInitiated = false;
            this._initProceduralState(false); 
            this._initLogicGrid();
            this._lastProcessedOpIndex = 0;
            startStep = 0;
            this.isReconstructing = false;
        }

        // --- 2. Process Remaining Steps ---
        for (let i = startStep; i < targetStepsCompleted; i++) {
            const isLastStep = (i === targetStepsCompleted - 1);
            const simFrame = isLastStep ? (targetStepsCompleted * framesPerStep) : (i * framesPerStep);
            
            this.expansionPhase = i; 
            const step = this.sequence[i];
            if (step) {
                // Ensure logic is up to date before processing the next step's ops
                // especially important for nudges and smart-adds
                this._updateRenderGridLogic();
                this._executeStepOps(step, simFrame); 
            }

            // Capture snapshots periodically (e.g. every 5 steps)
            if (this.debugMode) {
                this.stateCache.capture(this, i + 1);
            }
        }
        
        this.expansionPhase = targetStepsCompleted;
        this.step = targetStepsCompleted;
        this.animFrame = targetStepsCompleted * framesPerStep;
        this.isReconstructing = false; // Reconstruction complete

        // --- CLEAR REMOVALS AFTER JUMP ---
        // When teleporting to a new step, we don't want to see "ghost" fades 
        // from all the removals that happened during the fast-forward.
        for (let l = 0; l < 4; l++) {
            if (this.removalGrids[l]) this.removalGrids[l].fill(-1);
        }

        this._updateRenderGridLogic(); // Final logic update for the current state

        this._maskDirty = true;
        this.renderer._edgeCacheDirty = true;
        this.renderer._distMapDirty = true;
        this._outsideMapDirty = true;
    }

    refreshStep() {
        // Force full reconstruction for refresh to ensure sequence parity
        this.invalidateCache(this.expansionPhase);
        this.isReconstructing = true;
        this.jumpToStep(this.expansionPhase);
    }

    invalidateCache(fromStep = 0) {
        if (this.stateCache) {
            this.stateCache.invalidate(fromStep);
        }
    }
    
    // Proxy for SequenceManager
    _executeStepOps(step, startFrameOverride) {
        this.sequenceManager.executeStepOps(this, step, startFrameOverride);
    }

    _lerpColor(c1, c2, t) { return this.renderer._lerpColor(c1, c2, t); }

    _getBiasedDirections() {
        const ratio = (this.g.cols / this.g.rows) || 1.0;
        const faces = ['N', 'S', 'E', 'W'];
        
        // Weights: 1.0 is neutral. 
        // If ratio > 1.0 (Horizontal), E/W are preferred.
        // If ratio < 1.0 (Vertical), N/S are preferred.
        const horizWeight = Math.max(1.0, ratio);
        const vertWeight = Math.max(1.0, 1.0 / ratio);

        const weightedPool = [
            { id: 'N', w: vertWeight },
            { id: 'S', w: vertWeight },
            { id: 'E', w: horizWeight },
            { id: 'W', w: horizWeight }
        ];

        // Weighted Shuffle
        const result = [];
        const pool = [...weightedPool];
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
        return result;
    }

    _capturePerimeterEcho() {
        if (!this.getConfig('PerimeterEchoEnabled')) {
            this.perimeterHistory = [];
            this.echoEdgeMap = null;
            return;
        }

        if (this.getConfig('SingleLayerMode')) {
            const compositeGrid = this.renderGrid;
            if (!compositeGrid || !this.logicGridW || !this.logicGridH) return;

            const delay = this.getEchoGfxValue('Delay') || 3;

            if (this.getConfig('SingleLayerModeRetainState')) {
                // Retain Original State: exact delayed copy — capture every step, same ring buffer
                // as the standard echo. The oldest entry is always exactly `delay` steps behind.
                this.echoHoldEntries = null;
                this.echoEdgeMap = null;

                const snapshot = new Int32Array(compositeGrid.length);
                snapshot.set(compositeGrid);
                this.perimeterHistory.push(snapshot);
                const maxHistory = delay + 1;
                if (this.perimeterHistory.length > maxHistory) {
                    this.perimeterHistory.shift();
                }
            } else {
                // Hold mode: per-edge tracking handled inside renderEchoEdges.
                this.echoHoldEntries = null;
                this.perimeterHistory = [];
            }

            this._maskDirty = true;
            return;
        }

        const compositeGrid = this.renderGrid;
        if (!compositeGrid || !this.logicGridW || !this.logicGridH) return;

        // Standard trailing echo: ring buffer of renderGrid snapshots
        const snapshot = new Int32Array(compositeGrid.length);
        snapshot.set(compositeGrid);
        this.perimeterHistory.push(snapshot);

        const delay = this.getEchoGfxValue('Delay') || 3;
        const maxHistory = delay + 1;
        if (this.perimeterHistory.length > maxHistory) {
            this.perimeterHistory.shift();
        }

        this._maskDirty = true;
    }

    _getEffectiveInterval() {
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        let userSpeed = !overrideDefaults ? this.c.state['quantizedDefaultSpeed'] : null;
        if (userSpeed == null) userSpeed = this.c.state[this.configPrefix + 'Speed'];
        userSpeed = userSpeed || 5;
        const delayMult = 11 - userSpeed;
        const enNudge = (this.getConfig('EnableNudge') === true);
        const intervalMult = enNudge ? 0.15 : 0.25;
        return Math.max(1, baseDuration * (delayMult * intervalMult));
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;

        // 1. Update master clock (Visuals/Fades)
        this.animFrame++;

        // 2. Update Shadow Simulation & Warmup
        if (!this.hasSwapped && !this.isSwapping) {
            if (this._updateShadowSim()) return;
        } else if (this.isSwapping) {
            this.updateTransition(true);
        }

        // 1. WAITING State (Delay Start)
        if (this.state === 'WAITING') {
            this.timer--;
            if (this.timer <= 0) {
                this.state = 'FADE_IN';
                this.timer = 0;
                this.alpha = 0.0;
            }
            return;
        }

        // Periodic maintenance (Pruning expired ops)
        if (this.animFrame % 60 === 0 && this.maskOps && this.maskOps.length > 0) {
            const fadeOut = this.getConfig('FadeFrames') || 0;
            const oldLen = this.maskOps.length;
            this.maskOps = this.maskOps.filter(op => {
                if (op.expireFrame && this.animFrame >= op.expireFrame + fadeOut) return false;
                return true;
            });
            if (this.maskOps.length !== oldLen) {
                this._lastProcessedOpIndex = 0; 
                this._gridsDirty = true;
            }
        }

        // 2. Animation Cycle (Grid Expansion) - Logic Update
        const effectiveInterval = this._getEffectiveInterval();

        if (!this.debugMode || this.manualStep) {
            this.cycleTimer++;
            // If manual step is requested, force it to happen this frame regardless of interval
            if (this.manualStep && this.cycleTimer < effectiveInterval) {
                this.cycleTimer = effectiveInterval;
            }
        }

        if (this.cycleTimer >= effectiveInterval) {
            if (!this.debugMode || this.manualStep) {
                this.cycleTimer = 0;
                this.cyclesCompleted++;
                this.step++;

                // Clear step-local state
                this._currentStepActions = [];
                if (this.logicGridW && this.logicGridH) {
                    const needed = this.logicGridW * this.logicGridH;
                    if (this._stepOccupancy?.length === needed) {
                        this._stepOccupancy.fill(0);
                    } else {
                        this._stepOccupancy = new Uint8Array(needed);
                    }
                }
                
                // Allow immediate transition to procedural growth if state is already GENERATING (e.g. BlockGenerator)
                if (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode')) {
                    this._promoteLayer1Blocks();
                }

                if (this.state === 'GENERATING') {
                    this._attemptGrowth();
                    this.expansionPhase++;
                } else if (this.expansionPhase < this.sequence.length) {
                    this._processAnimationStep();
                } else if (this.getConfig('EnableAnimationCache') || this.getConfig('GeneratorTakeover')) {
                    if (this.getConfig('GeneratorTakeover')) {
                        this.state = 'GENERATING';
                        this._initProceduralState(true);
                    }
                    this._attemptGrowth();
                    this.expansionPhase++;
                }
                this.manualStep = false;
            }
        }

        // Update Render Grid Logic immediately
        this._updateRenderGridLogic();

        if (this.lastCapturedStep !== this.step) {
            this._capturePerimeterEcho();
            this.lastCapturedStep = this.step;
        }

        // 3. Lifecycle State Machine
        const fadeInFrames = Math.max(1, this.getConfig('FadeInFrames') || 0);
        const fadeOutFrames = Math.max(1, this.getConfig('FadeFrames') || 0);
        const durationFrames = (this.getConfig('DurationSeconds') || 5) * fps;
        
        const setAlpha = (val) => { this.alpha = Math.max(0, Math.min(1, val)); };

        if (this.state === 'FADE_IN') {
            this.timer++;
            if (fadeInFrames <= 1) {
                this.alpha = 1.0;
                this.state = 'SUSTAIN';
                this.timer = 0;
            } else {
                setAlpha(this.timer / fadeInFrames);
                if (this.timer >= fadeInFrames) {
                    this.state = 'SUSTAIN';
                    this.timer = 0;
                    this.alpha = 1.0;
                }
            }
        } else if (this.state === 'SUSTAIN' || this.state === 'GENERATING') {
            this.timer++;
            const isFinished = (this.timer >= durationFrames);
            const procFinished = (this.getConfig('EnableAnimationCache') || this.state === 'GENERATING') && this._isProceduralFinished();

            if (!this.debugMode && (isFinished || procFinished)) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            // If swapping, we handle termination in swap logic.
            // If just fading out (e.g. cancelled), handle standard fade.
            if (!this.isSwapping) {
                this.timer++;
                if (fadeOutFrames <= 1) {
                    this._terminate();
                } else {
                    setAlpha(1.0 - (this.timer / fadeOutFrames));
                    if (this.timer >= fadeOutFrames) {
                        this._terminate();
                    }
                }
            }
        }

        // 4. Animation Transition Management (Dirtiness)
        this._checkDirtiness();
    }

    _terminate() {
        this.active = false;
        this.state = 'IDLE';
        this.alpha = 0.0;
        window.removeEventListener('keydown', this._boundDebugHandler);
        if (this.g) {
            this.g.clearAllOverrides();
            if (this.g.effectActive) this.g.effectActive.fill(0);
            if (this.g.effectAlphas) this.g.effectAlphas.fill(0);
        }
        this.shadowGrid = null;
        this.shadowSim = null;
    }

    updateTransition(deactivate = true) {
        if (!this.isSwapping) return false;
        this._updateShadowSim();
        this.swapTimer--;
        if (this.swapTimer <= 0) {
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            this.isSwapping = false;
            this.hasSwapped = true;
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
            this.alpha = 0.0; // Reset alpha to prevent any lingering screen effects

            // PING-PONG TERMINATION:
            // Since the swap is now instantaneous, we can immediately deactivate the effect
            this.active = false;
            this.state = 'IDLE';
            window.removeEventListener('keydown', this._boundDebugHandler);
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
        if (!this.echoCanvas) {
            this.echoCanvas = document.createElement('canvas');
            this.echoCtx = this.echoCanvas.getContext('2d');
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
        if (this.echoCanvas.width !== w || this.echoCanvas.height !== h) {
            this.echoCanvas.width = w;
            this.echoCanvas.height = h;
        }
        if (this.lineMaskCanvas.width !== w || this.lineMaskCanvas.height !== h) {
            this.lineMaskCanvas.width = w;
            this.lineMaskCanvas.height = h;
        }
        if (this.echoCanvas.width !== w || this.echoCanvas.height !== h) {
            this.echoCanvas.width = w;
            this.echoCanvas.height = h;
        }
        
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        
        if (blocksX && blocksY) {
            const requiredSize = blocksX * blocksY;
            if (!this.renderGrid || this.renderGrid.length !== requiredSize) {
                 this.renderGrid = new Int32Array(requiredSize);
                 this.renderGrid.fill(-1);
            }
            for (let i = 0; i < 4; i++) {
                if (!this.layerGrids[i] || this.layerGrids[i].length !== requiredSize) {
                    this.layerGrids[i] = new Int32Array(requiredSize);
                    this.layerGrids[i].fill(-1);
                }
                if (!this.removalGrids[i] || this.removalGrids[i].length !== requiredSize) {
                    this.removalGrids[i] = new Int32Array(requiredSize);
                    this.removalGrids[i].fill(-1);
                }
            }
        }
    }

    // Proxy for ShadowController
    _initShadowWorld() {
        this.shadowController.initShadowWorld(this);
    }
    _initShadowWorldBase(workerEnabled) {
        return this.shadowController.initShadowWorldBase(this, workerEnabled);
    }
    _commitShadowState() {
        return this.shadowController.commitShadowState(this);
    }
    _updateShadowSim() {
        return this.shadowController.updateShadowSim(this);
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
        const intensity = Math.min(1.0, glowStrength / 1.0); 
        const charColor = '#FFFFFF';
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
        const distMap = this.renderer._distMap;
        const distW = this.renderer._distMapWidth;
        const distH = this.renderer._distMapHeight;
        const l = this.layout;
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const screenOriginX = ((0 - (grid.cols * d.cellWidth * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((0 - (grid.rows * d.cellHeight * 0.5)) * s.stretchY) + (h * 0.5);
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        const drawChar = (x, y) => {
            let charCode = 32;
            let i = -1;
            
            // Only use shadow world for characters within the actual grid
            const isInsideGrid = (x >= 0 && x < cols && y >= 0 && y < rows);
            
            if (isInsideGrid) {
                i = (y * cols) + x;
                
                // Tag cell for high-quality Shadow World rendering in the main pass
                const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                const by = Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY);
                let isInsideBlock = false;
                if (bx >= 0 && bx < distW && by >= 0 && by < distH) {
                    const bIdx = by * distW + bx;
                    // REVEAL MODE: Use the consolidated shadowRevealGrid (Layers 0 & 1 Perimeter)
                    if (this.shadowRevealGrid && this.shadowRevealGrid[bIdx] === 1) {
                        isInsideBlock = true;
                    }
                }
                
                // Shadow reveal is handled by updateShadowSim via overrideActive=5 (PRIORITY 2),
                // which provides a gradual sFade/oFade crossfade and disables the glow boost.
                // Setting effectActive=3 here (PRIORITY 1) would bypass that fade entirely,
                // showing raw sg.alphas with glow boost enabled â†’ brightness flash on start.
                if (!isInsideBlock && grid.effectActive[i] === 3) {
                    grid.effectActive[i] = 0;
                }

                if (shadowGrid && shadowGrid.chars) {
                    charCode = shadowGrid.chars[i];
                    
                    // If the simulation cell is empty, provide a random character for the line mask
                    if (charCode <= 32) {
                        const charSet = d.activeFonts[0].chars;
                        const hash = Math.abs(Math.sin(i * 12.9898 + this.lastGridSeed * 78.233) * 43758.5453) % 1;
                        charCode = charSet.charCodeAt(Math.floor(hash * charSet.length));
                    }
                    
                    // The source grid is used as a mask for lines; it must be full intensity
                    ctx.globalAlpha = 1.0; 
                } else if (grid.overrideActive && grid.overrideActive[i] > 0) {
                    charCode = grid.overrideChars[i];
                    ctx.globalAlpha = 1.0;
                } else {
                    charCode = chars[i];
                    ctx.globalAlpha = 1.0;
                }
            } else {
                i = (y * 10000) + x; 
                charCode = 0; 
                ctx.globalAlpha = 0.0;
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
        
        const totalBlocks = this.logicGridW * this.logicGridH;
        if (!this.renderGrid || this.renderGrid.length !== totalBlocks) {
            this.renderGrid = new Int32Array(totalBlocks);
            this.renderGrid.fill(-1);
            this._gridsDirty = true;
        }

        for (let i = 0; i < 4; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== totalBlocks) {
                this.layerGrids[i] = new Int32Array(totalBlocks);
                this.layerGrids[i].fill(-1);
                this._gridsDirty = true;
            }
            if (!this.layerInvisibleGrids) this.layerInvisibleGrids = [];
            if (!this.layerInvisibleGrids[i] || this.layerInvisibleGrids[i].length !== totalBlocks) {
                this.layerInvisibleGrids[i] = new Int8Array(totalBlocks);
                this.layerInvisibleGrids[i].fill(0);
                this._gridsDirty = true;
            }
        }
        if (!this.maskOps) return;

        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        let opsProcessed = 0;
        let i = startIndex;

        // Snapshot pre-operation occupancy â€” only needed when there are ops to process.
        // Allocating before the early-exit guards was wasting 4Ã—Uint8Array every render frame.
        let establishedMasks = null;
        if (startIndex < this.maskOps.length) {
            establishedMasks = [new Uint8Array(totalBlocks), new Uint8Array(totalBlocks), new Uint8Array(totalBlocks), new Uint8Array(totalBlocks)];
            for (let l = 0; l < 4; l++) {
                if (this.layerGrids[l]) {
                    for (let idx = 0; idx < totalBlocks; idx++) {
                        if (this.layerGrids[l][idx] !== -1) establishedMasks[l][idx] = 1;
                    }
                }
            }
        }
        
        const dirtyRects = [];

        for (; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            
            // If the op is in the future, we skip it but DON'T break,
            // as subsequent ops might be from a reconstruction or jump that are ready.
            if (op.startFrame && this.animFrame < op.startFrame) continue;
            
            // Catch up: If we are catching up from a long pause, mark this op as processed
            if (i === this._lastProcessedOpIndex) {
                this._lastProcessedOpIndex++;
            }

            opsProcessed++;
            const layerIdx = (op.layer !== undefined && op.layer >= 0 && op.layer <= 3) ? op.layer : 0;
            const targetGrid = this.layerGrids[layerIdx];
            const invGrid = this.layerInvisibleGrids[layerIdx];
            
            const x1 = Math.min(op.x1, op.x2);
            const x2 = Math.max(op.x1, op.x2);
            const y1 = Math.min(op.y1, op.y2);
            const y2 = Math.max(op.y1, op.y2);
            
            dirtyRects.push({ x1, y1, x2, y2 });

            if (op.type === 'add' || op.type === 'addSmart') {
                const minX = Math.max(0, cx + x1);
                const maxX = Math.min(this.logicGridW - 1, cx + x2);
                const minY = Math.max(0, cy + y1);
                const maxY = Math.min(this.logicGridH - 1, cy + y2);
                for (let by = minY; by <= maxY; by++) {
                    const rowOff = by * this.logicGridW;
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = rowOff + bx;
                        
                        // IDEMPOTENT ADD: Only set birth frame if the block isn't already active
                        if (targetGrid[idx] === -1) {
                            targetGrid[idx] = (op.fade === false) ? -1000 : (op.startFrame || 0);
                        }
                        
                        if (invGrid) invGrid[idx] = op.invisible ? 1 : 0;
                        if (this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = -1;
                    }
                }
            } else if (op.type === 'shiftBlocks') {
                const layer = op.layer;
                const dx = op.dx || 0;
                const dy = op.dy || 0;
                const quadrant = op.quadrant; // 'N', 'S', 'E', 'W'
                const scx = op.scx || 0;
                const scy = op.scy || 0;

                const grid = this.layerGrids[layer];
                const inv = this.layerInvisibleGrids[layer];
                const rem = this.removalGrids[layer];
                if (!grid) continue;

                // Shift logic: Create a temp grid for the quadrant
                const tempGrid = new Int32Array(grid.length).fill(-1);
                const tempInv = inv ? new Int8Array(inv.length).fill(0) : null;
                const tempRem = rem ? new Int32Array(rem.length).fill(-1) : null;

                for (let by = 0; by < this.logicGridH; by++) {
                    const gry = by - cy - scy;
                    for (let bx = 0; bx < this.logicGridW; bx++) {
                        const idx = by * this.logicGridW + bx;
                        if (grid[idx] === -1) continue;

                        const grx = bx - cx - scx;
                        let shouldShift = false;
                        if (quadrant === 'N' && gry < 0) shouldShift = true;
                        if (quadrant === 'S' && gry > 0) shouldShift = true;
                        if (quadrant === 'E' && grx > 0) shouldShift = true;
                        if (quadrant === 'W' && grx < 0) shouldShift = true;

                        if (shouldShift) {
                            const nbx = bx + dx;
                            const nby = by + dy;
                            if (nbx >= 0 && nbx < this.logicGridW && nby >= 0 && nby < this.logicGridH) {
                                const nidx = nby * this.logicGridW + nbx;
                                tempGrid[nidx] = grid[idx];
                                if (tempInv) tempInv[nidx] = inv[idx];
                                if (tempRem) tempRem[nidx] = rem[idx];
                            }
                        } else {
                            // If not in quadrant, keep it where it is in temp grid if not already written to
                            if (tempGrid[idx] === -1) {
                                tempGrid[idx] = grid[idx];
                                if (tempInv) tempInv[idx] = inv[idx];
                                if (tempRem) tempRem[idx] = rem[idx];
                            }
                        }
                    }
                }
                grid.set(tempGrid);
                if (inv) inv.set(tempInv);
                if (rem) rem.set(tempRem);

                this._gridsDirty = true;

            } else if (op.type === 'removeBlock') {
                const minX = Math.max(0, cx + x1);
                const maxX = Math.min(this.logicGridW - 1, cx + x2);
                const minY = Math.max(0, cy + y1);
                const maxY = Math.min(this.logicGridH - 1, cy + y2);
                for (let by = minY; by <= maxY; by++) {
                    const rowOff = by * this.logicGridW;
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = rowOff + bx;
                        if (op.layer !== undefined) {
                            const wasEstablished = (establishedMasks[layerIdx][idx] === 1);

                            targetGrid[idx] = -1;
                            if (invGrid) invGrid[idx] = 0;
                            if (this.removalGrids[layerIdx]) {
                                // IDEMPOTENT REMOVE: Don't overwrite an existing fade animation
                                if (this.removalGrids[layerIdx][idx] === -1) {
                                    this.removalGrids[layerIdx][idx] = (op.fade !== false && wasEstablished) ? this.animFrame : -1;
                                }
                            }
                        } else {
                            for (let l = 0; l < 4; l++) {
                                const wasEstablished = (establishedMasks[l][idx] === 1);

                                this.layerGrids[l][idx] = -1;
                                if (this.layerInvisibleGrids[l]) this.layerInvisibleGrids[l][idx] = 0;
                                if (this.removalGrids[l]) {
                                    if (this.removalGrids[l][idx] === -1) {
                                        this.removalGrids[l][idx] = (op.fade !== false && wasEstablished) ? this.animFrame : -1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        this._lastProcessedOpIndex = i;

        if (opsProcessed === 0 && !this._gridsDirty) return;

        const layerGrids = this.layerGrids;
        const foundationIdx = 0; // Layer 0 is foundation

        const compositeCell = (idx) => {
            let finalVal = -1;
            let anyActive = false;
            
            for (let l = 0; l < 4; l++) {
                if (layerGrids[l] && layerGrids[l][idx] !== -1) {
                    anyActive = true;
                }
            }

            const l0Active = (layerGrids[0] && layerGrids[0][idx] !== -1);
            const l1Active = (layerGrids[1] && layerGrids[1][idx] !== -1);
            const l2Active = (layerGrids[2] && layerGrids[2][idx] !== -1);
            const l3Active = (layerGrids[3] && layerGrids[3][idx] !== -1);

            // Calculate finalVal using fixed layer priority: Layer 0 > 1
            // We no longer favor the "most recent" frame; this prevents activation time from affecting layering.
            let bestFrame = -1;
            if (l0Active) {
                bestFrame = layerGrids[0][idx];
            } else if (l1Active) {
                bestFrame = layerGrids[1][idx];
            }
            finalVal = bestFrame;

            this.renderGrid[idx] = finalVal;
            if (this.logicGrid) this.logicGrid[idx] = anyActive ? 1 : 0;
            return finalVal;
        };

        if (this._gridsDirty) {
            if (!this._lastCoverageRect) this._updateVisibleEmptyCount();
            let emptyCount = 0;
            const r = this._lastCoverageRect;
            
            for (let idx = 0; idx < totalBlocks; idx++) {
                const finalVal = compositeCell(idx);
                const bx = idx % this.logicGridW;
                const by = (idx / this.logicGridW) | 0;
                if (finalVal === -1 && bx >= r.startX && bx < r.endX && by >= r.startY && by < r.endY) {
                    emptyCount++;
                }
            }
            this._visibleEmptyCount = emptyCount;
            this._gridsDirty = false;
        } else if (dirtyRects.length > 0) {
            const r = this._lastCoverageRect;
            if (!r || this._visibleEmptyCount === -1) this._updateVisibleEmptyCount();

            for (const rect of dirtyRects) {
                const minX = Math.max(0, cx + rect.x1);
                const maxX = Math.min(this.logicGridW - 1, cx + rect.x2);
                const minY = Math.max(0, cy + rect.y1);
                const maxY = Math.min(this.logicGridH - 1, cy + rect.y2);

                for (let by = minY; by <= maxY; by++) {
                    const rowOff = by * this.logicGridW;
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = rowOff + bx;
                        const wasEmpty = (this.renderGrid[idx] === -1);
                        const isVisible = (r && bx >= r.startX && bx < r.endX && by >= r.startY && by < r.endY);

                        const finalVal = compositeCell(idx);
                        const isEmpty = (finalVal === -1);
                        if (isVisible) {
                            if (wasEmpty && !isEmpty) this._visibleEmptyCount--;
                            else if (!wasEmpty && isEmpty) this._visibleEmptyCount++;
                        }
                    }
                }
            }
        }

        this.renderer._distMapDirty = true;
        this._outsideMapDirty = true;
        this._maskDirty = true;
        this._gridCacheDirty = true;

        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        const bs = this.getBlockSize();
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);

        this._updateExpansionStatus();
        this._updateShadowRevealGrid();
    }

    _updateShadowRevealGrid() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h || !this.shadowRevealGrid) return;

        // 1. Create a temporary "Main Mass" grid for Layers 0, 1, and (2 & 3 overlap)
        const mainMass = new Int32Array(w * h);
        mainMass.fill(-1);
        const g0 = this.layerGrids[0], g1 = this.layerGrids[1];
        const g2 = this.layerGrids[2], g3 = this.layerGrids[3];

        for (let i = 0; i < w * h; i++) {
            const l0Active = (g0 && g0[i] !== -1);
            const l1Active = (g1 && g1[i] !== -1);

            // Shadow Reveal Rules: Layer 0 OR Layer 1
            if (l0Active || l1Active) {
                mainMass[i] = 1;
            }
        }

        // 2. Compute "Outside" area for this specific mass
        const outside = this.renderer.computeTrueOutside(this, w, h, mainMass);

        // 3. Shadow Reveal = Everything that is NOT outside (Blocks + Enclosed Holes)
        for (let i = 0; i < w * h; i++) {
            this.shadowRevealGrid[i] = (outside[i] === 0) ? 1 : 0;
        }
    }

    _computeCenteredOffset(blocksX, blocksY, pitchX, pitchY) {
        const logicCellsX = blocksX * pitchX;
        const logicCellsY = blocksY * pitchY;
        const screenCellsX = this.g.cols;
        const screenCellsY = this.g.rows;
        const cellOffX = Math.floor((logicCellsX - screenCellsX) / 2.0);
        const cellOffY = Math.floor((logicCellsY - screenCellsY) / 2.0);
        const offX = cellOffX / pitchX;
        const offY = cellOffY / pitchY;
        return { offX, offY };
    }

    _computeTrueOutside(blocksX, blocksY) {
        return this.renderer.computeTrueOutside(this, blocksX, blocksY);
    }
    _rebuildEdgeCache(w, h) {
        this.renderer.rebuildEdgeCache(this, w, h);
    }

    // Proxy for Renderer
    _updateMask(w, h, s, d) {
        this.renderer.updateMask(this, w, h, s, d);
    }
    _renderEdges(ctx, colorCtx, now, blocksX, blocksY, offX, offY) {
        this.renderer.renderEdges(this, ctx, colorCtx, now, blocksX, blocksY, offX, offY);
    }
    _removeBlockCorner(bx, by, corner) {
        this.renderer._removeBlockCorner(this, this.maskCtx, bx, by, corner);
    }
    _addBlock(start, end, ext, check) {
        this.renderer._addBlock(this, this.maskCtx, this.layout, start, end, ext, check);
    }

    /**
     * Provides a standardized state object for WebGL rendering.
     * Following the Dependency Inversion Principle, this allows the renderer to 
     * depend on a normalized data structure rather than the effect's internal state.
     */
    getWebGLRenderState(s, d) {
        const gw = this.logicGridW;
        const gh = this.logicGridH;
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        const { offX, offY } = this._computeCenteredOffset(gw, gh, cellPitchX, cellPitchY);
        const scale = s.resolution || 1.0;

        const col = Utils.hexToRgb(this.getLineGfxValue('Color') || "#ffffff");

        // Glass Bloom / Reveal logic
        const fillRatio = (() => {
            if (!this.renderGrid || gw * gh === 0) return 0;
            let occupied = 0;
            for (let i = 0; i < this.renderGrid.length; i++) {
                if (this.renderGrid[i] !== -1) occupied++;
            }
            return occupied / (gw * gh);
        })();

        const rawGlassBloom = this.getConfig('GlassBloom') ?? 1.2;
        const glassBloomScaleToSize = this.getConfig('GlassBloomScaleToSize') === true;
        const bloomScale = glassBloomScaleToSize
            ? Math.max(0, 1.0 - Math.log1p(Math.min(fillRatio * 2.0, 1.0) * (Math.E - 1)))
            : 1.0;
        const finalGlassBloom = 1.0 + (rawGlassBloom - 1.0) * bloomScale * this.alpha;

        return {
            logicGridSize: [gw, gh],
            cellPitch: [cellPitchX, cellPitchY],
            blockOffset: [offX, offY],
            userBlockOffset: [this.userBlockOffX || 0, this.userBlockOffY || 0],
            layerOrder: new Int32Array(this.layerOrder || [0, 1, 2, 3]),
            showInterior: this.getConfig('ShowInterior') !== false,
            intensity: (this.getLineGfxValue('Intensity') ?? 1.0) * (this.getLineGfxValue('Opacity') ?? 1.0) * this.alpha,
            thickness: this.getLineGfxValue('Thickness') ?? 1.0,
            tintOffset: this.getLineGfxValue('TintOffset') ?? 0.0,
            sharpness: this.getLineGfxValue('Sharpness') ?? 0.05,
            glowFalloff: this.getLineGfxValue('GlowFalloff') ?? 2.0,
            roundness: this.getLineGfxValue('Roundness') ?? 0.0,
            maskSoftness: this.getLineGfxValue('MaskSoftness') ?? 0.0,
            brightness: (this.getLineGfxValue('Brightness') ?? 1.0) * (s.brightness ?? 1.0),
            saturation: this.getLineGfxValue('Saturation') ?? 1.0,
            additiveStrength: this.getLineGfxValue('AdditiveStrength') ?? 1.0,
            glow: this.getLineGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0),
            varianceEnabled: this.getLineGfxValue('BrightnessVarianceEnabled') ? 1.0 : 0.0,
            varianceAmount: this.getLineGfxValue('BrightnessVarianceAmount') ?? 0.5,
            varianceCoverage: this.getLineGfxValue('BrightnessVarianceCoverage') ?? 100,
            varianceDirection: this.getLineGfxValue('BrightnessVarianceDirection') ?? 1,
            color: [col.r / 255, col.g / 255, col.b / 255],
            persistence: (() => {
                const frames = this.getLineGfxValue('Persistence') || 0;
                if (frames <= 0) return 0.0;
                return 1.0 / frames;
            })(),
            sampleOffset: [this.getLineGfxValue('SampleOffsetX') * scale, this.getLineGfxValue('SampleOffsetY') * scale],
            lineOffset: [this.getLineGfxValue('OffsetX') * scale, this.getLineGfxValue('OffsetY') * scale],
            fillRatio: fillRatio,
            
            // Glass / Refraction
            glassBloom: finalGlassBloom,
            refractionEnabled: this.getConfig('GlassRefractionEnabled') ? 1 : 0,
            refractionWidth: this.getConfig('GlassRefractionWidth') ?? 0.25,
            refractionBrightness: 1.0 + ((this.getConfig('GlassRefractionBrightness') ?? 1.5) - 1.0) * this.alpha,
            refractionSaturation: 1.0 + ((this.getConfig('GlassRefractionSaturation') ?? 1.5) - 1.0) * this.alpha,
            refractionCompression: this.getConfig('GlassRefractionCompression') ?? 1.0,
            refractionOffset: this.getConfig('GlassRefractionOffset') ?? 0.0,
            refractionGlow: (this.getConfig('GlassRefractionGlow') ?? 0.0) * this.alpha,
            compressionThreshold: this.getConfig('GlassCompressionThreshold') ?? 0.0,
            shadowWorldFadeSpeed: this.getConfig('ShadowWorldFadeSpeed') ?? 0.5
        };
    }

    _drawMaskedLines(ctx, maskCanvas, width, height, s, d, alphaMult, isEcho = false) {
        const scratchCtx = this.scratchCtx;
        const isSolid = this.c.state.quantizedSolidPerimeter || false;
        
        // Retrieve independent offsets based on the line type
        const sampX = isEcho ? this.getEchoGfxValue('SampleOffsetX') : this.getLineGfxValue('SampleOffsetX');
        const sampY = isEcho ? this.getEchoGfxValue('SampleOffsetY') : this.getLineGfxValue('SampleOffsetY');
        const offX = isEcho ? this.getEchoGfxValue('OffsetX') : this.getLineGfxValue('OffsetX');
        const offY = isEcho ? this.getEchoGfxValue('OffsetY') : this.getLineGfxValue('OffsetY');

        const srcOffX = (0) + (d.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0) + (sampX || 0);
        const srcOffY = (0) + (d.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0) + (sampY || 0);

        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);
        
        if (isSolid) {
            scratchCtx.globalAlpha = this.alpha;
            scratchCtx.save();
            scratchCtx.translate(offX || 0, offY || 0);
            scratchCtx.drawImage(maskCanvas, 0, 0);
            scratchCtx.restore();
        } else {
            this._updateGridCache(width, height, s, d);
            scratchCtx.globalAlpha = 1.0;
            scratchCtx.save();
            scratchCtx.translate(srcOffX, srcOffY);
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            scratchCtx.restore();
            scratchCtx.globalCompositeOperation = 'source-in';
            scratchCtx.globalAlpha = this.alpha;
            scratchCtx.save();
            scratchCtx.translate(offX || 0, offY || 0);
            scratchCtx.drawImage(maskCanvas, 0, 0);
            scratchCtx.restore();
        }

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        let remainingAlpha = alphaMult;
        // Multi-pass draw for extra punchy lines if alphaMult > 1.0
        while (remainingAlpha > 0.001) {
            ctx.globalAlpha = Math.min(1.0, remainingAlpha);
            ctx.drawImage(this.scratchCanvas, 0, 0);
            remainingAlpha -= 1.0;
        }
        ctx.restore();
    }

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;
        this._checkDirtiness();
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

        // Update Grid Cache (needed for both 2D and GPU rendering)
        this._updateGridCache(width, height, s, d);

        const showLines = (this.c.state.layerEnableQuantizedLines !== false);
        const showEcho = (s.layerEnablePerimeterEcho !== false);
        const showSource = (this.c.state.layerEnableQuantizedGridCache === true);
        
        const lineGlow = this.getLineGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
        const alphaMult = lineGlow / 4.0;

        const echoGlow = this.getEchoGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
        const echoAlphaMult = echoGlow / 4.0;

        // WebGL mode - lines in GLSL, Echo in 2D overlay
        if (s.renderingEngine === 'webgl') {
            if (showEcho && this.getConfig('PerimeterEchoEnabled') && this.echoCanvas) {
                this._drawMaskedLines(ctx, this.echoCanvas, width, height, s, d, echoAlphaMult, true);
            }
            return;
        }

        // 2D canvas mode - both lines and echo use the same masking pipeline.
        const srcOffX = (0) + (d.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0) + (this.getLineGfxValue('SampleOffsetX') || 0);
        const srcOffY = (0) + (d.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0) + (this.getLineGfxValue('SampleOffsetY') || 0);

        if (showSource) {
            this._updateGridCache(width, height, s, d);
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }

        if (lineGlow > 0 && showLines) {
            this._drawMaskedLines(ctx, this.lineMaskCanvas, width, height, s, d, alphaMult, false);
        }
        if (showEcho && this.getConfig('PerimeterEchoEnabled') && this.echoCanvas) {
            this._drawMaskedLines(ctx, this.echoCanvas, width, height, s, d, echoAlphaMult, true);
        }
    }

    renderDebug(ctx, derived) {
        if (!this.debugMode) return;
        const s = this.c.state;
        if (s.renderingEngine === 'webgl') return;

        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);
        if (!this.layout || this.maskCanvas.width !== width || this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }
        this._updateGridCache(width, height, s, derived);

        const lineGlow = this.getLineGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
        const alphaMult = Math.min(1.0, lineGlow / 4.0);

        this._drawMaskedLines(ctx, this.lineMaskCanvas, width, height, s, derived, alphaMult, false);

        // Echo with character masking in debug mode - same pipeline as canvas lines
        const showEchoDebug = (s.layerEnablePerimeterEcho !== false);
        if (showEchoDebug && this.getConfig('PerimeterEchoEnabled') && this.echoCanvas) {
            const echoGlow = this.getEchoGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
            const echoAlphaMult = Math.min(1.0, echoGlow / 4.0);
            this._drawMaskedLines(ctx, this.echoCanvas, width, height, s, derived, echoAlphaMult, true);
        }
    }

    renderEditorPreview(ctx, derived, previewOp) {
        const opHash = previewOp ? JSON.stringify(previewOp) : "";
        const baseOpsLen = this.maskOps.length - (this._previewActive ? this._lastPreviewOpsAddedCount : 0);
        const stateHash = `${baseOpsLen}_${this.expansionPhase}_${opHash}`;

        if (stateHash !== this._lastPreviewStateHash) {
            if (!this._previewActive || (this._lastPreviewSavedLogic && this._lastPreviewSavedLogic.length !== this.logicGrid.length)) {
                this._lastPreviewSavedLogic = new Uint8Array(this.logicGrid);
                if (this.promotionGrid) this._lastPreviewSavedPromotion = new Uint8Array(this.promotionGrid);
                this._lastPreviewSavedOpsLen = this.maskOps.length;
            } else {
                if (this._lastPreviewSavedLogic && this._lastPreviewSavedLogic.length === this.logicGrid.length) {
                    this.logicGrid.set(this._lastPreviewSavedLogic);
                }
                if (this.promotionGrid && this._lastPreviewSavedPromotion && this._lastPreviewSavedPromotion.length === this.promotionGrid.length) {
                    this.promotionGrid.set(this._lastPreviewSavedPromotion);
                }
                this.maskOps.splice(this._lastPreviewSavedOpsLen, this.maskOps.length - this._lastPreviewSavedOpsLen);
            }

            if (previewOp) {
                const startOpsLen = this.maskOps.length;
                this._executeStepOps([previewOp], this.animFrame);
                this._lastPreviewOpsAddedCount = this.maskOps.length - startOpsLen;
            } else {
                this._lastPreviewOpsAddedCount = 0;
            }
            
            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
            this._maskDirty = true; 
            this._lastPreviewStateHash = stateHash;
            this._previewActive = !!previewOp;
        }

        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);
        this._checkDirtiness();
        if (this._maskDirty) {
             this._updateMask(width, height, s, derived);
             this._maskDirty = false;
        }
        
        this._updateGridCache(width, height, s, derived);

        const lineGlow = this.getLineGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
        const alphaMult = Math.min(1.0, lineGlow / 4.0);

        if (s.renderingEngine === 'webgl') {
            const showEchoPreview = (s.layerEnablePerimeterEcho !== false);
            if (showEchoPreview && this.getConfig('PerimeterEchoEnabled') && this.echoCanvas) {
                const echoGlow = this.getEchoGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
                const echoAlphaMult = Math.min(1.0, echoGlow / 4.0);
                this._drawMaskedLines(ctx, this.echoCanvas, width, height, s, derived, echoAlphaMult, true);
            }
            return;
        }

        const srcOffX = (0) + (derived.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0) + (this.getLineGfxValue('SampleOffsetX') || 0);
        const srcOffY = (0) + (derived.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0) + (this.getLineGfxValue('SampleOffsetY') || 0);

        if (this.c.state.layerEnableQuantizedGridCache === true) {
            this._updateGridCache(width, height, s, derived);
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }

        this._drawMaskedLines(ctx, this.lineMaskCanvas, width, height, s, derived, alphaMult, false);

        // Echo with character masking - same pipeline as canvas lines
        const showEchoPreview = (s.layerEnablePerimeterEcho !== false);
        if (showEchoPreview && this.getConfig('PerimeterEchoEnabled') && this.echoCanvas) {
            const echoGlow = this.getEchoGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
            const echoAlphaMult = Math.min(1.0, echoGlow / 4.0);
            this._drawMaskedLines(ctx, this.echoCanvas, width, height, s, derived, echoAlphaMult, true);
        }

        if (this._previewActive) {
            if (this._lastPreviewOpsAddedCount > 0) {
                this.maskOps.splice(this._lastPreviewSavedOpsLen, this._lastPreviewOpsAddedCount);
            }
            this.logicGrid.set(this._lastPreviewSavedLogic);
            this.renderGrid.fill(-1);
            for (let i = 0; i < 3; i++) {
                 if (this.layerGrids[i]) this.layerGrids[i].fill(-1);
            }
            this._lastProcessedOpIndex = 0;
            this._gridsDirty = true;
            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
            this._maskDirty = true;
            this._previewActive = false;
        }
    }

    renderEditorGrid(ctx) {
        // if (!this.layout) return;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const l = this.layout;
        if (this.c.state.layerEnableEditorGrid === false) return;
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        const gridOffX = 0;
        const gridOffY = 0;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; 
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let bx = 0; bx <= blocksX; bx++) {
            let cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
            cellX = Math.max(0, Math.min(this.g.cols, cellX));
            const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + gridOffX;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        for (let by = 0; by <= blocksY; by++) {
            let cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
            cellY = Math.max(0, Math.min(this.g.rows, cellY));
            const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + gridOffY;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
        let centerCellX = Math.round((cx - l.offX + l.userBlockOffX) * l.cellPitchX);
        centerCellX = Math.max(0, Math.min(this.g.cols, centerCellX));
        let centerCellY = Math.round((cy - l.offY + l.userBlockOffY) * l.cellPitchY);
        centerCellY = Math.max(0, Math.min(this.g.rows, centerCellY));
        const centerX = l.screenOriginX + (centerCellX * l.screenStepX) + l.pixelOffX + gridOffX;
        const centerY = l.screenOriginY + (centerCellY * l.screenStepY) + l.pixelOffY + gridOffY;
        const bW = Math.round(l.cellPitchX) * l.screenStepX; 
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
         const blocksY = this.logicGridH;
         const cx = Math.floor(blocksX / 2);
         const cy = Math.floor(this.logicGridH / 2);
         const changesOffX = 0;
         const changesOffY = 0;
         ctx.save();
        const layerColors = ['rgba(0, 255, 0, 0.15)', 'rgba(0, 200, 255, 0.15)', 'rgba(255, 0, 200, 0.15)', 'rgba(255, 255, 0, 0.15)'];
        const layerLines = ['rgba(0, 255, 0, 0.8)', 'rgba(0, 200, 255, 0.8)', 'rgba(255, 0, 200, 0.8)', 'rgba(255, 255, 0, 0.8)'];
        const getVal = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return -1;
            return grid[by * blocksX + bx];
        };

        const visibleIndices = [0, 1, 2, 3];

        for (let i = visibleIndices.length - 1; i >= 0; i--) {
            const lIdx = visibleIndices[i];
            if (this.visibleLayers && this.visibleLayers[lIdx] === false) continue;
            const rGrid = this.layerGrids[lIdx];
            if (rGrid) {
                for (let idx = 0; idx < rGrid.length; idx++) {
                    if (rGrid[idx] !== -1) {
                        const bx = idx % blocksX;
                        const by = Math.floor(idx / blocksX);

                        let obscureCount = 0;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], bx, by) !== -1) {
                                obscureCount++;
                            }
                        }
                        
                        ctx.save();
                        if (obscureCount >= 1) {
                            ctx.globalAlpha = 0.05; 
                        }
                        ctx.fillStyle = layerColors[lIdx];

                        let cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                        let cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                        cellX = Math.max(0, Math.min(this.g.cols, cellX));
                        cellY = Math.max(0, Math.min(this.g.rows, cellY));
                        const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                        const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                        
                        let nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        let nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        nextCellX = Math.max(0, Math.min(this.g.cols, nextCellX));
                        nextCellY = Math.max(0, Math.min(this.g.rows, nextCellY));

                        const w = (nextCellX - cellX) * l.screenStepX;
                        const h = (nextCellY - cellY) * l.screenStepY;
                        ctx.fillRect(x, y, w, h); 
                        ctx.restore();
                    }
                }
            }
        }

        const pNormal = new Path2D();
        const pDim = new Path2D();

        const grid0 = this.layerGrids[0];
        const grid1 = this.layerGrids[1];
        const grid2 = this.layerGrids[2];
        const grid3 = this.layerGrids[3];

        const isOcc = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY || !grid) return false;
            return grid[by * blocksX + bx] !== -1;
        };

        const isMain = (bx, by) => {
            const l0 = isOcc(grid0, bx, by);
            const l1 = isOcc(grid1, bx, by);
            const l2 = isOcc(grid2, bx, by);
            const l3 = isOcc(grid3, bx, by);
            return l0 || l1 || (l2 && l3);
        };

        const addEdgeToPath = (path, x, y, isV) => {
            let cellX = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
            cellX = Math.max(0, Math.min(this.g.cols, cellX));
            const px = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
            
            if (isV) {
                let cellY1 = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                let cellY2 = Math.round((y + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                cellY1 = Math.max(0, Math.min(this.g.rows, cellY1));
                cellY2 = Math.max(0, Math.min(this.g.rows, cellY2));
                const py1 = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
                const py2 = l.screenOriginY + (cellY2 * l.screenStepY) + l.pixelOffY + changesOffY;
                path.moveTo(px, py1); path.lineTo(px, py2);
            } else {
                let cellY = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                cellY = Math.max(0, Math.min(this.g.rows, cellY));
                const py = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                let cellX1 = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                let cellX2 = Math.round((x + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                cellX1 = Math.max(0, Math.min(this.g.cols, cellX1));
                cellX2 = Math.max(0, Math.min(this.g.cols, cellX2));
                const px1 = l.screenOriginX + (cellX1 * l.screenStepX) + l.pixelOffX + changesOffX;
                const px2 = l.screenOriginX + (cellX2 * l.screenStepX) + l.pixelOffX + changesOffX;
                path.moveTo(px1, py); path.lineTo(px2, py);
            }
        };

        // Vertical Edges
        for (let x = 0; x <= blocksX; x++) {
            for (let y = 0; y < blocksY; y++) {
                const a0 = isOcc(grid0, x-1, y), b0 = isOcc(grid0, x, y);
                const a1 = isOcc(grid1, x-1, y), b1 = isOcc(grid1, x, y);
                const a2 = isOcc(grid2, x-1, y), b2 = isOcc(grid2, x, y);
                const a3 = isOcc(grid3, x-1, y), b3 = isOcc(grid3, x, y);
                const a23 = a2 && a3, b23 = b2 && b3;
                const aL123 = a1 || a23, bL123 = b1 || b23;

                let isNorm = false;
                let isDim = false;

                // 1. L0 boundary always normal
                if (a0 !== b0) isNorm = true;

                // 2. L1 & L2+3 combined perimeter
                if (aL123 !== bL123) {
                    if (a0 && b0) isDim = true;
                    else isNorm = true;
                }

                if (isNorm) addEdgeToPath(pNormal, x, y, true);
                if (isDim) addEdgeToPath(pDim, x, y, true);
            }
        }
        // Horizontal Edges
        for (let y = 0; y <= blocksY; y++) {
            for (let x = 0; x < blocksX; x++) {
                const a0 = isOcc(grid0, x, y-1), b0 = isOcc(grid0, x, y);
                const a1 = isOcc(grid1, x, y-1), b1 = isOcc(grid1, x, y);
                const a2 = isOcc(grid2, x, y-1), b2 = isOcc(grid2, x, y);
                const a3 = isOcc(grid3, x, y-1), b3 = isOcc(grid3, x, y);
                const a23 = a2 && a3, b23 = b2 && b3;
                const aL123 = a1 || a23, bL123 = b1 || b23;

                let isNorm = false;
                let isDim = false;

                // 1. L0 boundary always normal
                if (a0 !== b0) isNorm = true;

                // 2. L1 & L2+3 combined perimeter
                if (aL123 !== bL123) {
                    if (a0 && b0) isDim = true;
                    else isNorm = true;
                }

                if (isNorm) addEdgeToPath(pNormal, x, y, false);
                if (isDim) addEdgeToPath(pDim, x, y, false);
            }
        }

        ctx.lineWidth = 2;
        ctx.strokeStyle = layerLines[0]; 
        ctx.stroke(pNormal);
        
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.stroke(pDim);
        ctx.restore();
        const ops = this.maskOps;
        if (ops && this.c.state.layerEnableEditorRemovals !== false) {
            for (const op of ops) {
                if (op.type === 'removeBlock') {
                    if (op.startPhase !== this.expansionPhase) continue;
                    const bx = cx + op.x1;
                    const by = cy + op.y1;
                    let cellX = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                    let cellY = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                    cellX = Math.max(0, Math.min(this.g.cols, cellX));
                    cellY = Math.max(0, Math.min(this.g.rows, cellY));
                    const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                    const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                    
                    let nextCellX = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                    let nextCellY = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                    nextCellX = Math.max(0, Math.min(this.g.cols, nextCellX));
                    nextCellY = Math.max(0, Math.min(this.g.rows, nextCellY));

                    const w = (nextCellX - cellX) * l.screenStepX;
                    const h = (nextCellY - cellY) * l.screenStepY;
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
                }
            }
        }
        ctx.restore();
    }

    // =========================================================================
    // PROCEDURAL GENERATION (from BlockGenerator)
    // =========================================================================

    _initProceduralState(forceSeed = false) {
        if (this.proceduralInitiated && !forceSeed) return;
        this.proceduralInitiated = true;

        // Initialize growth states if not already present
        if (!this.unfoldSequences) this.unfoldSequences = Array.from({ length: 3 }, () => []);
        if (!this.behaviorState.nudgeState) {
            this.behaviorState.nudgeState = {
                dirCounts: { N: 0, S: 0, E: 0, W: 0 },
                fieldExpansion: { N: 0, S: 0, E: 0, W: 0 },
                lanes: new Map(), // Tracks {0: count, 1: count} per lane
                cycle: {
                    step: 0, // 0: Expansion, 1: Retract/Pause, 2: Retract/Pause
                    lastTempBlock: null
                }
            };
        }
        if (!this.behaviorState.spreadingNudgeCycles) {
            this.behaviorState.spreadingNudgeCycles = {
                'V1':  { step: 0, lastTempBlock: null },
                'V-1': { step: 0, lastTempBlock: null },
                'H1':  { step: 0, lastTempBlock: null },
                'H-1': { step: 0, lastTempBlock: null }
            };
        }
        if (!this.behaviorState.spreadingNudgeNextSpawnStep) {
            this.behaviorState.spreadingNudgeNextSpawnStep = { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
        }
        if (!this.behaviorState.spreadingNudgeSymmetryQueue) {
            this.behaviorState.spreadingNudgeSymmetryQueue = [];
        }
        if (!this.overlapState) this.overlapState = { step: 0 };
        if (!this.cycleState) this.cycleState = { step: 0, step1Block: null };
        if (!this.rearrangePool) this.rearrangePool = Array.from({ length: 3 }, () => 0);

        // Ensure we have at least one anchor if starting fresh and requested
        if (forceSeed && (!this.activeBlocks || this.activeBlocks.length === 0)) {
            if (!this.activeBlocks) this.activeBlocks = [];
            // Principle #3: Adhere to LayerCount setting.
            // Seed the center block on all active layers to ensure they have an initial anchor.
            const maxLayer = this._getMaxLayer();
            const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
            // Use the current spawn center so Random Start Location is respected.
            const ox = this.behaviorState?.scx ?? 0;
            const oy = this.behaviorState?.scy ?? 0;

            for (let l = 0; l <= maxLayer; l++) {                // If promotion is active, only seed Layer 1 as the initial discovery anchor.
                if (usePromotion && l !== 1) continue;

                // Use skipConnectivity=true and bypassOccupancy=true for the initial seeds
                this._spawnBlock(ox, oy, 1, 1, l, false, 0, true, true, true, false, true);
            }
        }
    }

    _processActiveStatefulBehaviors(targetLayer) {
        let updated = false;
        if (this.unfoldSequences && this.unfoldSequences[targetLayer]) {
            for (let i = this.unfoldSequences[targetLayer].length - 1; i >= 0; i--) {
                const seq = this.unfoldSequences[targetLayer][i];
                if (seq.active) {
                    if (this._attemptUnfoldGrowth(seq, targetLayer)) updated = true;
                } else {
                    this.unfoldSequences[targetLayer].splice(i, 1);
                }
            }
        }
        return updated;
    }

    _promoteLayer1Blocks() {
        // Single Layer Mode: no promotion, Layer 1 is the only permanent layer
        if (this.getConfig('SingleLayerMode')) return;
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;
        
        // Ensure promotionGrid exists and is the correct size for the current logic grid
        if (!this.promotionGrid || this.promotionGrid.length !== w * h) {
            this.promotionGrid = new Uint8Array(w * h);
        }
        
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const l1 = this.layerGrids[1], l0 = this.layerGrids[0];
        if (!l1 || !l0) return;

        let promotedCount = 0;
        let candidatesCount = 0;

        for (let gy = 0; gy < h; gy++) {
            const rowOff = gy * w;
            for (let gx = 0; gx < w; gx++) {
                const idx = rowOff + gx;
                const isL1 = l1[idx] !== -1;
                const isL0 = l0[idx] !== -1;

                if (isL1 && !isL0) {
                    candidatesCount++;
                    this.promotionGrid[idx]++;
                    if (this.promotionGrid[idx] >= 3) {
                        const bx = gx - cx, by = gy - cy;
                        
                        // Promotion Event: Spawn L0 (1x1)
                        // bypassOccupancy=true is CRITICAL here to bypass the Layer 0 spawning guard
                        const id = this._spawnBlock(bx, by, 1, 1, 0, false, 0, true, true, true, false, true);
                        if (id !== -1) {
                            // Layer 1 is preserved (discovery layer stays intact)
                            this.promotionGrid[idx] = 0; 
                            this._gridsDirty = true;
                            promotedCount++;
                        }
                    }
                } else {
                    this.promotionGrid[idx] = 0;
                }
            }
        }
        
        if (this.c.state.logErrors && this.animFrame % 60 === 0) {
            this._log(`[Promotion] Loop: candidates=${candidatesCount}, promotedInStep=${promotedCount}, logicW=${w}, logicH=${h}`);
        }

        if (promotedCount > 0) {
            // Prune Layer 1 activeBlocks that are fully promoted/removed
            this.activeBlocks = this.activeBlocks.filter(b => {
                if (b.layer !== 1) return true;
                
                // Check if any part of this block still exists in Layer 1 grid
                for (let iy = 0; iy < b.h; iy++) {
                    for (let ix = 0; ix < b.w; ix++) {
                        const gx = cx + b.x + ix, gy = cy + b.y + iy;
                        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                            if (l1[gy * w + gx] !== -1) return true;
                        }
                    }
                }
                return false; // Fully superseded
            });
        }
    }

    _attemptGrowth() {
        if (this._isCanvasFullyCovered()) return;
        this._initProceduralState(true);

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const mode = getGenConfig('Mode') || 'default';
        
        // Use V2 generator logic if mode is 'v2', if takeover is active, or if it's the BlockGenerator effect
        if (mode === 'v2' || this.state === 'GENERATING' || this.name === "QuantizedBlockGenerator") {
            return this._attemptV2Growth();
        }

        // If mode is 'advanced' (Spines/Wings), use advanced logic
        if (mode === 'advanced') {
            return this._attemptAdvancedGrowth();
        }

        const enUnfold = getGenConfig('EnableUnfold');
        const enNudge = getGenConfig('EnableNudge');
        const enCluster = getGenConfig('EnableCluster');
        const enShift = getGenConfig('EnableShift');
        const enCentered = getGenConfig('EnableCentered');
        
        const useUnfold = (enUnfold === true);
        const useNudge = (enNudge === true || enNudge === undefined);
        const useCluster = (enCluster === true || enCluster === undefined);
        const useShift = (enShift === true);
        const useCentered = (enCentered === true);

        const quota = getGenConfig('SimultaneousSpawns') || 1;
        const maxLayer = this._getMaxLayer();
        const targetLayer = this.proceduralLayerIndex;        
        const pool = [];
        if (useUnfold) pool.push({ name: 'Unfold', fn: () => this._attemptUnfoldGrowth(null, targetLayer) });
        if (useNudge) {
            pool.push({ name: 'Nudge', fn: () => {
                const sw = getGenConfig('MinBlockWidth') || 1;
                const mw = getGenConfig('MaxBlockWidth') * 1.5 || 3;
                const sh = getGenConfig('MinBlockHeight') || 1;
                const mh = getGenConfig('MaxBlockHeight') * 1.5 || 3;
                const bw = Math.floor(Math.random() * (mw - sw + 1)) + sw;
                const bh = Math.floor(Math.random() * (mh - sh + 1)) + sh;
                return this._attemptNudgeGrowthWithParams(targetLayer, bw, bh);
            }});
        }
        if (useCluster) pool.push({ name: 'Cluster', fn: () => this._attemptClusterGrowth(null, targetLayer) });
        if (useShift) {
            pool.push({ name: 'SpokeShift', fn: () => this._attemptSpokeShiftGrowth(null, targetLayer) });
            pool.push({ name: 'QuadShift', fn: () => this._attemptQuadrantShiftGrowth(null, targetLayer) });
        }
        if (useCentered) pool.push({ name: 'Centered', fn: () => this._attemptCenteredGrowth(null, targetLayer) });

        let actionsPerformed = 0;
        const maxAttempts = quota * 3; 
        let attempts = 0;

        while (actionsPerformed < quota && attempts < maxAttempts) {
            attempts++;
            let success = false;
            if (pool.length > 0) {
                const behavior = pool[Math.floor(Math.random() * pool.length)];
                if (behavior.fn()) success = true;
            }
            if (success) actionsPerformed++;
        }

        // If Behavior Pool stalled but screen isn't full, fallback to Advanced Growth
        if (actionsPerformed === 0 && attempts >= maxAttempts) {
            return this._attemptAdvancedGrowth();
        }

        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);
        if (this.proceduralLayerIndex === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode')) && maxLayer >= 1) {
            this.proceduralLayerIndex = 1;
        }
    }

    _attemptAdvancedGrowth() {
        if (this.expansionComplete) return;
        this._initProceduralState(false); 
        this._syncSubLayers();
        this._updateInternalLogicGrid();

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const chance = 0.66, reversionChance = 0.15;
        const maxLayer = this._getMaxLayer();

        const bs = this.getBlockSize();
        const xVisible = Math.ceil(this.g.cols / bs.w / 2), yVisible = Math.ceil(this.g.rows / bs.h / 2);
        const xGrowthLimit = xVisible + 3, yGrowthLimit = yVisible + 3;
        const xFinishLimit = xVisible + 1, yFinishLimit = yVisible + 1;

        const ratio = this.g.cols / this.g.rows;
        const xBias = Math.max(1.0, ratio), yBias = Math.max(1.0, 1.0 / ratio);
        const getBurst = (bias) => {
            let b = 1; if (bias > 1.2) { if (Math.random() < (bias - 1.0) * 0.8) b = 2; if (b === 2 && Math.random() < (bias - 2.0) * 0.5) b = 3; }
            return b;
        };
        const xBurst = getBurst(xBias), yBurst = getBurst(yBias);

        const getGridVal = (layer, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2; 
            return this.layerGrids[layer][gy * w + gx];
        };

        let successInStep = false;
        const xSpines = [{id: 'spine_west', dx: -1}, {id: 'spine_east', dx: 1}];
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));

        for (const spine of xSpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeX = spine.dx;
                    while (true) {
                        const val = getGridVal(l, freeX, 0);
                        if (val === -2 || Math.abs(freeX) >= xFinishLimit) { if (l === maxLayer) finished = true; break; }
                        if (val === -1) break;
                        freeX += spine.dx;
                    }
                    if (Math.abs(freeX) < xFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = freeX + (b * spine.dx);
                            if (getGridVal(l, tx, 0) === -1 && Math.abs(tx) <= xGrowthLimit) {
                                if (this._spawnBlock(tx, 0, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }
        const ySpines = [{id: 'spine_north', dy: -1}, {id: 'spine_south', dy: 1}];
        for (const spine of ySpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeY = spine.dy;
                    while (true) {
                        const val = getGridVal(l, 0, freeY);
                        if (val === -2 || Math.abs(freeY) >= yFinishLimit) { if (l === 1) finished = true; break; }
                        if (val === -1) break;
                        freeY += spine.dy;
                    }
                    if (Math.abs(freeY) < yFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = freeY + (b * spine.dy);
                            if (getGridVal(l, 0, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                                if (this._spawnBlock(0, ty, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }

        // --- Core Spines Logic: Catch up Layer 0/1 to follow leading layers ---
        for (const spine of xSpines) {
            for (let x = spine.dx; Math.abs(x) <= xGrowthLimit; x += spine.dx) {
                let anyLeading = false;
                for (let l = 1; l <= maxLayer; l++) if (getGridVal(l, x, 0) !== -1) anyLeading = true;
                
                // If promotion is enabled, Layer 1 must follow any leading sub-layers
                // Layer 0 is ignored here as it follows Layer 1 via promotion.
                const targetL = usePromotion ? 1 : 0;
                if (getGridVal(targetL, x, 0) === -1 && anyLeading) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x + (b * spine.dx);
                            if (getGridVal(targetL, tx, 0) === -1) { 
                                if (this._spawnBlock(tx, 0, 1, 1, targetL, false, 0, true, true, true, false, true) !== -1) successInStep = true; 
                            } else break;
                        }
                    }
                    break;
                }
            }
        }
        let minX = 0, maxX = 0;
        for (let x = -1; ; x--) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { minX = x + 1; break; } }
        for (let x = 1; ; x++) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { maxX = x - 1; break; } }
        for (let x = minX; x <= maxX; x++) {
            const directions = [{ id: 'n', dy: -1 }, { id: 's', dy: 1 }];
            for (const d of directions) {
                const branchId = `wing_${d.id}_${x}`;
                let wingFinished = this.finishedBranches.has(branchId), wingFreeY = d.dy;
                if (!wingFinished) {
                    while (true) {
                        const val = getGridVal(maxLayer, x, wingFreeY);
                        if (val === -2 || Math.abs(wingFreeY) >= yFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                        if (val === -1) break; wingFreeY += d.dy;
                    }
                }
                if (!wingFinished) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = wingFreeY + (b * d.dy);
                            if (getGridVal(maxLayer, x, ty) === -1 && Math.abs(ty) <= yGrowthLimit) { if (this._spawnBlock(x, ty, 1, 1, maxLayer, false, 0, true, true, true, false, true) !== -1) successInStep = true; } else break;
                        }
                    }
                    this._revertFrontier(x, 0, 0, d.dy, maxLayer, reversionChance, branchId);
                }
                const searchLimitY = wingFinished ? yGrowthLimit : Math.abs(wingFreeY);
                for (let y = d.dy; Math.abs(y) <= searchLimitY; y += d.dy) {
                    const targetL = usePromotion ? 1 : 0;
                    if (getGridVal(targetL, x, y) === -1 && getGridVal(maxLayer, x, y) !== -1) {
                        if (Math.random() < chance) {
                            for (let b = 0; b < yBurst; b++) {
                                const ty = y + (b * d.dy);
                                if (getGridVal(targetL, x, ty) === -1 && getGridVal(maxLayer, x, ty) !== -1) { 
                                    if (this._spawnBlock(x, ty, 1, 1, targetL, false, 0, true, true, true, false, true) !== -1) successInStep = true; 
                                } else break;
                            }
                        }
                        break;
                    }
                }
            }
        }
        if (this.getConfig('EnableAutoFillHoles')) this._maintainStructuralIntegrity();
        this._updateInternalLogicGrid();
    }

    _isNudgePathFull(x, y, w, h, face, layer) {
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const bx = this.logicGridW, by = this.logicGridH;
        const cx = Math.floor(bx / 2), cy = Math.floor(by / 2);

        // Visible boundary limits (Canvas + 1 block)
        const bs = this.getBlockSize();
        const visW = Math.ceil(this.g.cols / bs.w);
        const visH = Math.ceil(this.g.rows / bs.h);
        const xLimit = Math.floor(visW / 2) + 1;
        const yLimit = Math.floor(visH / 2) + 1;

        const isLaneFull = (rx, ry, dx, dy) => {
            // Check if the chain is unbroken from current point to the VISIBLE boundary
            let tx = rx, ty = ry;
            while (true) {
                // If we hit the boundary of the visible area, this lane is "full"
                if (tx < -xLimit || tx > xLimit || ty < -yLimit || ty > yLimit) break;
                
                const gx = cx + tx, gy = cy + ty;
                if (gx < 0 || gx >= bx || gy < 0 || gy >= by) break;
                
                if (grid[gy * bx + gx] === -1) return false; // Gap found, not full
                
                tx += dx; ty += dy;
                if (Math.abs(tx) > bx || Math.abs(ty) > by) break; // Safety
            }
            return true;
        };

        // Check each row/column in the nudge span
        for (let ly = 0; ly < h; ly++) {
            for (let lx = 0; lx < w; lx++) {
                const tx = x + lx, ty = y + ly;
                let full = false;
                if (face === 'E') full = isLaneFull(tx, ty, 1, 0);
                else if (face === 'W') full = isLaneFull(tx, ty, -1, 0);
                else if (face === 'S') full = isLaneFull(tx, ty, 0, 1);
                else if (face === 'N') full = isLaneFull(tx, ty, 0, -1);
                if (full) return true;
            }
        }
        return false;
    }

    _attemptNudgeGrowthWithParams(targetLayer, bw, bh, originX = null, originY = null, cycleState = null, chance = null) {
        // Force focus on Layer 1 and 1x1 blocks as per instructions
        const layer = 1;
        const forcedBw = 1;
        const forcedBh = 1;

        const cycle = cycleState || (this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : null);
        if (!cycle) return false;

        // "Randomness" controls probability:
        // 0.05 (Min) -> 5% chance of temp blocks / 5% chance of retraction
        // 1.0 (Max) -> 100% chance of temp blocks / 100% chance of retraction
        const randomness = chance ?? (this.c.get('quantizedGenerateV2NudgeChance') ?? 0.8);

        if (cycle.step === 0) {
            // STEP 0: EXPANSION
            // We always try to place the Permanent block. 
            // Randomness controls if we also get a Temporary block.
            const success = this._executeExpansionStep(layer, forcedBw, forcedBh, randomness, originX, originY);
            if (success) {
                cycle.step = 1;
                return true;
            }
            return false;
        } else {
            // STEP 1 or 2: RETRACT or PAUSE
            // Randomness controls probability of retraction vs pause
            const isRetract = Math.random() < randomness; 
            let success = false;

            if (isRetract && cycle.lastTempBlock) {
                const b = cycle.lastTempBlock;
                this._removeBlock(b.x, b.y, b.w, b.h, layer, true);
                cycle.lastTempBlock = null;
                success = true;
            } else {
                // Pause (Action performed but no grid change)
                success = true;
            }

            // Advance step: 1 -> 2, 2 -> 0
            cycle.step = (cycle.step + 1) % 3;
            return success;
        }
    }

    _executeExpansionStep(layer, bw, bh, randomness = 0.8, originX = null, originY = null) {
        if (!this.logicGridW || !this.logicGridH) return false;
        const w = this.logicGridW, h = this.logicGridH;
        const cx = (originX !== null) ? (Math.floor(w / 2) + originX) : Math.floor(w / 2);
        const cy = (originY !== null) ? (Math.floor(h / 2) + originY) : Math.floor(h / 2);
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const faces = this._getBiasedDirections();
        for (const dir of faces) {
            // Compute how far the center spoke has grown in this direction (extRatio).
            // This gates lateral expansion: nudge only widens once the spine is >33% grown.
            const stepDir = (dir === 'N' || dir === 'W') ? -1 : 1;
            let spokeBlocks = 0;
            if (dir === 'N' || dir === 'S') {
                for (let gy = cy + stepDir; dir === 'N' ? gy >= 0 : gy < h; gy += stepDir) {
                    if (grid[gy * w + cx] !== -1) spokeBlocks++; else break;
                }
            } else {
                for (let gx = cx + stepDir; dir === 'W' ? gx >= 0 : gx < w; gx += stepDir) {
                    if (grid[cy * w + gx] !== -1) spokeBlocks++; else break;
                }
            }
            const spokeHalf = (dir === 'N') ? cy : (dir === 'S') ? h - 1 - cy : (dir === 'W') ? cx : w - 1 - cx;
            const extRatio = spokeHalf > 0 ? spokeBlocks / spokeHalf : 1.0;
            // Allow up to 3 cells of lateral spread once the spoke is >33% grown
            const maxOffset = extRatio > 0.33 ? Math.min(3, Math.ceil(extRatio * 3)) : 0;

            // Find first empty gap along this direction's spoke, starting at center axis
            // and expanding laterally (offset ±1, ±2, ...) as the structure grows wider.
            let firstEmpty = null;
            offSearch:
            for (let off = 0; off <= maxOffset; off++) {
                const offVals = off === 0 ? [0] : [off, -off];
                for (const dAxis of offVals) {
                    if (dir === 'N' || dir === 'S') {
                        const gx = cx + dAxis;
                        if (gx < 0 || gx >= w) continue;
                        const startY = (dir === 'N') ? cy - 1 : cy + 1;
                        const endY = (dir === 'N') ? 0 : h - 1;
                        for (let gy = startY; (dir === 'N' ? gy >= endY : gy <= endY); gy += stepDir) {
                            if (grid[gy * w + gx] === -1) {
                                firstEmpty = { x: gx - Math.floor(w / 2), y: gy - Math.floor(h / 2) };
                                break offSearch;
                            }
                        }
                    } else {
                        const gy = cy + dAxis;
                        if (gy < 0 || gy >= h) continue;
                        const startX = (dir === 'W') ? cx - 1 : cx + 1;
                        const endX = (dir === 'W') ? 0 : w - 1;
                        for (let gx = startX; (dir === 'W' ? gx >= endX : gx <= endX); gx += stepDir) {
                            if (grid[gy * w + gx] === -1) {
                                firstEmpty = { x: gx - Math.floor(w / 2), y: gy - Math.floor(h / 2) };
                                break offSearch;
                            }
                        }
                    }
                }
            }

            if (firstEmpty) {
                // 1. PLACE PERMANENT BLOCK (Forward)
                let px = firstEmpty.x, py = firstEmpty.y;
                if (dir === 'N') { py = firstEmpty.y - bh + 1; px = firstEmpty.x - Math.floor(bw / 2); }
                else if (dir === 'S') { py = firstEmpty.y; px = firstEmpty.x - Math.floor(bw / 2); }
                else if (dir === 'W') { px = firstEmpty.x - bw + 1; py = firstEmpty.y - Math.floor(bh / 2); }
                else if (dir === 'E') { px = firstEmpty.x; py = firstEmpty.y - Math.floor(bh / 2); }

                const permId = this._spawnBlock(px, py, bw, bh, layer, false, 0, true, true, true, false, true);
                if (permId !== -1) {
                    // 2. OPTIONALLY PLACE TEMPORARY BLOCK (Scaled by Randomness)
                    if (Math.random() < randomness) {
                        const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
                        const opp = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
                        const spawnDirs = shuffle(['N', 'S', 'E', 'W'].filter(d => d !== opp[dir]));
                        
                        let tempId = -1;
                        for (const tempDir of spawnDirs) {
                            let tx = px, ty = py;
                            if (tempDir === 'N') ty -= bh;
                            else if (tempDir === 'S') ty += bh;
                            else if (tempDir === 'W') tx -= bw;
                            else if (tempDir === 'E') tx += bw;

                            tempId = this._spawnBlock(tx, ty, bw, bh, layer, false, 0, true, true, true, false, true);
                            if (tempId !== -1) {
                                this.behaviorState.nudgeState.cycle.lastTempBlock = { x: tx, y: ty, w: bw, h: bh };
                                break; 
                            }
                        }

                        if (tempId === -1) {
                            this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                        }
                    } else {
                        this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                    }
                    return true;
                }
            }
        }
        return false;
    }

    _attemptQuadrantShiftGrowth(ignored, targetLayer) {
        if (targetLayer === 0) return false; // Sub-layers only

        const s = this.c.state;
        const freq = s.quantizedGenerateV2ShiftFrequency || 5;
        if (Math.random() * 10 > freq) return false;

        const w = this.logicGridW;
        const h = this.logicGridH;
        if (!w || !h) return false;

        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;

        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        // 1. Pick a Quadrant
        const quads = ['NW', 'NE', 'SW', 'SE'];
        Utils.shuffle(quads);
        
        for (const q of quads) {
            let xStart, xEnd, yStart, yEnd;
            if (q === 'NW') { xStart = 0; xEnd = cx - 1; yStart = 0; yEnd = cy - 1; }
            else if (q === 'NE') { xStart = cx; xEnd = w - 1; yStart = 0; yEnd = cy - 1; }
            else if (q === 'SW') { xStart = 0; xEnd = cx - 1; yStart = cy; yEnd = h - 1; }
            else { xStart = cx; xEnd = w - 1; yStart = cy; yEnd = h - 1; }

            // 2. Thickness Check
            let maxThickness = 0;
            if (q === 'NW' || q === 'SW') { // West side
                for (let gy = yStart; gy <= yEnd; gy++) {
                    let thick = 0;
                    for (let gx = xStart; gx <= xEnd; gx++) if (grid[gy * w + gx] !== -1) thick++;
                    maxThickness = Math.max(maxThickness, thick);
                }
            } else { // East side
                for (let gy = yStart; gy <= yEnd; gy++) {
                    let thick = 0;
                    for (let gx = xEnd; gx >= xStart; gx--) if (grid[gy * w + gx] !== -1) thick++;
                    maxThickness = Math.max(maxThickness, thick);
                }
            }
            if (maxThickness >= (s.quantizedGenerateV2ShiftMaxThickness || 5)) continue;

            // 3. Find a Group (3x3, 3x2, etc.)
            const sizes = [{w:3, h:3}, {w:3, h:2}, {w:2, h:3}, {w:4, h:3}, {w:3, h:4}];
            Utils.shuffle(sizes);
            
            for (const sz of sizes) {
                const candidates = [];
                for (let gy = yStart; gy <= yEnd - sz.h + 1; gy++) {
                    for (let gx = xStart; gx <= xEnd - sz.w + 1; gx++) {
                        let count = 0;
                        for (let iy = 0; iy < sz.h; iy++) {
                            for (let ix = 0; ix < sz.w; ix++) {
                                if (grid[(gy + iy) * w + (gx + ix)] !== -1) count++;
                            }
                        }
                        // Accept cluster if at least 50% populated
                        if (count >= (sz.w * sz.h) * 0.5) candidates.push({gx, gy});
                    }
                }

                if (candidates.length > 0) {
                    const best = candidates[Math.floor(Math.random() * candidates.length)];
                    
                    // 4. Shift Direction (Away from center axis)
                    let dx = 0, dy = 0;
                    if (q === 'NW') { dx = -1; dy = -1; }
                    else if (q === 'NE') { dx = 1; dy = -1; }
                    else if (q === 'SW') { dx = -1; dy = 1; }
                    else { dx = 1; dy = 1; }
                    
                    const bias = this._getBiasedDirections();
                    if (bias[0] === 'N' || bias[0] === 'S') dx = 0;
                    else dy = 0;

                    // 5. "Never leave holes behind" check:
                    // Ensure the NEW position is still connected to the mass (not an island).
                    const nx = best.gx + dx, ny = best.gy + dy;
                    if (nx < 0 || nx + sz.w > w || ny < 0 || ny + sz.h > h) continue;

                    let connectedAtTarget = false;
                    for (let iy = -1; iy <= sz.h; iy++) {
                        for (let ix = -1; ix <= sz.w; ix++) {
                            if (ix >= 0 && ix < sz.w && iy >= 0 && iy < sz.h) continue; // Skip self
                            const tx = nx + ix, ty = ny + iy;
                            if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
                                if (grid[ty * w + tx] !== -1) { connectedAtTarget = true; break; }
                            }
                        }
                        if (connectedAtTarget) break;
                    }
                    if (!connectedAtTarget) continue;

                    // 6. Execute True Shift (Remove Source, Add Target)
                    const lx = best.gx - cx, ly = best.gy - cy;
                    
                    // Add REM operations for the source area
                    for (let iy = 0; iy < sz.h; iy++) {
                        for (let ix = 0; ix < sz.w; ix++) {
                            const tx = best.gx + ix, ty = best.gy + iy;
                            // Only REM if it was actually occupied
                            if (grid[ty * w + tx] === -1) continue; 

                            const inNew = (tx >= nx && tx < nx + sz.w && ty >= ny && ty < ny + sz.h);
                            if (!inNew) {
                                this._executeStepOps([{ op: 'rem', args: [tx - cx, ty - cy], layer: targetLayer }], this.animFrame);
                            }
                        }
                    }

                    // Spawn at new location
                    if (this._spawnBlock(lx + dx, ly + dy, sz.w, sz.h, targetLayer, true, 0, true, true, true, false, true) !== -1) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    _proposeCandidate(c) {
        if (!this.RULES.bounds(c)) {
            if (!this._redirectOffscreen(c)) return -1;
        }
        if (!this._validateCandidate(c)) return -1;
        const id = this._commitCandidate(c);
        if (id === -1) return -1;
        if (!c.isShifter && !c.isMirroredSpawn && this.getConfig('EnableAxisBalancing')) {
            this._handleAxisBalancing(c);
        }
        return id;
    }

    _redirectOffscreen(c) {
        if (c.skipConnectivity) return false;
        const bs = this.getBlockSize(), xLimit = Math.floor((this.g.cols / bs.w) / 2), yLimit = Math.floor((this.g.rows / bs.h) / 2);
        const total = this.activeBlocks.length;
        if (total === 0) return false;
        const sampleSize = Math.min(total, 50), candidates = [], tx = c.x, ty = c.y;
        for (let i = total - 1; i >= 0 && candidates.length < sampleSize; i--) {
            const b = this.activeBlocks[i];
            if (b.layer !== c.layer) continue;
            if (!(b.x < -xLimit || b.x > xLimit || b.y < -yLimit || b.y > yLimit)) {
                const dist = Math.abs(b.x - tx) + Math.abs(b.y - ty);
                candidates.push({ b, dist });
            }
        }
        if (candidates.length === 0) return false;
        candidates.sort((a, b) => a.dist - b.dist);
        const dirs = this._getBiasedDirections();
        for (let i = 0; i < Math.min(10, candidates.length); i++) {
            const a = candidates[i].b;
            for (const dir of dirs) {
                let nx = a.x, ny = a.y;
                if (dir === 'N') ny = a.y - c.h;
                else if (dir === 'S') ny = a.y + a.h;
                else if (dir === 'E') nx = a.x + a.w;
                else if (dir === 'W') nx = a.x - c.w;
                if (nx >= -xLimit && nx + c.w - 1 <= xLimit && ny >= -yLimit && ny + c.h - 1 <= yLimit) {
                    c.x = nx; c.y = ny; return true;
                }
            }
        }
        return false;
    }

    _validateCandidate(c) {
        if (!this.RULES.bounds(c)) return false;
        if (!this.RULES.occupancy(c)) return false;
        if (!this.RULES.vacated(c)) return false;
        if (c.isShifter) return true;
        
        // If skipping connectivity (e.g. forced promotion/anchor), we skip relative checks too
        if (c.skipConnectivity) return true;

        if (!this.RULES.connectivity(c)) return false;
        if (!this.RULES.direction(c)) return false;
        if (!this.RULES.spatial(c)) return false;
        return true;
    }

    _commitCandidate(c) {
        const id = this._spawnBlockCore(
            c.x, c.y, c.w, c.h, c.layer,
            c.isShifter, c.expireFrames,
            true, 
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
        let flipX = (mirrorType === 0 || mirrorType === 2), flipY = (mirrorType === 1 || mirrorType === 2);
        let targetX = flipX ? -c.x - c.w : c.x, targetY = flipY ? -c.y - c.h : c.y;
        const candidate = { ...c, x: targetX, y: targetY, isMirroredSpawn: true };
        if (this._validateCandidate(candidate)) { this._commitCandidate(candidate); return; }
        const searchRange = 5, attempts = [];
        for (let dy = -searchRange; dy <= searchRange; dy++) {
            for (let dx = -searchRange; dx <= searchRange; dx++) {
                if (dx === 0 && dy === 0) continue;
                attempts.push({ x: targetX + dx, y: targetY + dy, dist: Math.abs(dx) + Math.abs(dy) });
            }
        }
        attempts.sort((a, b) => a.dist - b.dist);
        for (const att of attempts) {
            const searchCandidate = { ...candidate, x: att.x, y: att.y };
            if (this._validateCandidate(searchCandidate)) { this._commitCandidate(searchCandidate); return; }
        }
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
                    if (this._validateCandidate(finalAttempt)) { this._commitCandidate(finalAttempt); return; }
                }
            }
        }
    }

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy,
            bypassSpatial: skipConnectivity
        };
        return this._proposeCandidate(candidate);
    }

    _maintainStructuralIntegrity() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const bs = this.getBlockSize(), xVisible = Math.ceil(this.g.cols / bs.w / 2), yVisible = Math.ceil(this.g.rows / bs.h / 2);
        const minX = -xVisible - 2, maxX = xVisible + 2, minY = -yVisible - 2, maxY = yVisible + 2;
        const scanW = maxX - minX + 1, scanH = maxY - minY + 1;
        const reachGrid = new Uint8Array(scanW * scanH);
        const getIdx = (bx, by) => (by - minY) * scanW + (bx - minX);
        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                const gx = cx + bx, gy = cy + by;
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                if (this.renderGrid[gy * w + gx] !== -1) reachGrid[getIdx(bx, by)] = 2;
            }
        }
        const queue = [];
        const pushIfOutside = (bx, by) => {
            if (bx < minX || bx > maxX || by < minY || by > maxY) return;
            const idx = getIdx(bx, by);
            if (reachGrid[idx] === 0) { reachGrid[idx] = 1; queue.push({x: bx, y: by}); }
        };
        for (let x = minX; x <= maxX; x++) { pushIfOutside(x, minY); pushIfOutside(x, maxY); }
        for (let y = minY; y <= maxY; y++) { pushIfOutside(minX, y); pushIfOutside(maxX, y); }
        while (queue.length > 0) {
            const curr = queue.shift();
            const ds = [[1,0], [-1,0], [0,1], [0,-1]];
            for (const [dx, dy] of ds) pushIfOutside(curr.x + dx, curr.y + dy);
            }
            const maxLayer = this._getMaxLayer();
            const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
            const startL = usePromotion ? 1 : 0;

            for (let bx = minX; bx <= maxX; bx++) {            for (let by = minY; by <= maxY; by++) {
                const idx = getIdx(bx, by);
                if (reachGrid[idx] === 0) {
                    for (let l = startL; l <= maxLayer; l++) this._spawnBlock(bx, by, 1, 1, l, false, 0, true, true, true, false, true);
                }
            }
        }
    }

    _revertFrontier(ox, oy, dx, dy, layer, chance, branchId) {
        if (this.finishedBranches.has(branchId)) return false;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;
        if (layer <= minL || Math.random() > chance) return false;
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        let tx = ox, ty = oy, lastOccupied = null;
        const isOcc = (l, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return false;
            return this.layerGrids[l][gy * w + gx] !== -1;
        };
        while (true) {
            const ntx = tx + dx, nty = ty + dy;
            if (!isOcc(layer, ntx, nty)) break;
            tx = ntx; ty = nty; lastOccupied = { x: tx, y: ty };
            if (Math.abs(tx) > w || Math.abs(ty) > h) break;
        }
        if (lastOccupied && (lastOccupied.x !== 0 || lastOccupied.y !== 0)) {
            if (isOcc(0, lastOccupied.x, lastOccupied.y)) return false;
            this.maskOps.push({ type: 'removeBlock', x1: lastOccupied.x, y1: lastOccupied.y, x2: lastOccupied.x, y2: lastOccupied.y, layer: layer, startFrame: this.animFrame, fade: false });
            this.activeBlocks = this.activeBlocks.filter(b => !(b.x === lastOccupied.x && b.y === lastOccupied.y && b.layer === layer));
            this.layerGrids[layer][(cy + lastOccupied.y) * w + (cx + lastOccupied.x)] = -1;
            this._gridsDirty = true;
            return true;
        }
        return false;
    }

    _syncSubLayers() {
        const s = this.c.state;
        const pref = this.configPrefix;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
        
        if (!s[pref + 'EnableSyncSubLayers'] && !s.quantizedGenerateV2EnableSyncSubLayers && !usePromotion) return;
        if (this._syncFrame === this.animFrame) return;
        if (this._lastSyncOpCount === this.maskOps.length) return;
        this._lastSyncOpCount = this.maskOps.length;
        this._syncFrame = this.animFrame;
        const maxLayer = this._getMaxLayer();
        if (maxLayer < 1) return;
        const w = this.logicGridW, h = this.logicGridH, l0Grid = this.layerGrids[0];
        if (!l0Grid) return;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const syncGrid = this._getBuffer('syncGrid', w * h, Uint8Array);
        syncGrid.fill(0);
        for (let i = 0; i < l0Grid.length; i++) if (l0Grid[i] !== -1) syncGrid[i] = 1;
        const rects = [];
        for (let gy = 0; gy < h; gy++) {
            const rowOffBase = gy * w;
            for (let gx = 0; gx < w; gx++) {
                if (syncGrid[rowOffBase + gx] === 1) {
                    let rw = 0; while (gx + rw < w && syncGrid[rowOffBase + gx + rw] === 1) rw++;
                    let rh = 1;
                    while (gy + rh < h) {
                        let lineFull = true;
                        const targetRowOff = (gy + rh) * w;
                        for (let ix = 0; ix < rw; ix++) if (syncGrid[targetRowOff + gx + ix] !== 1) { lineFull = false; break; }
                        if (!lineFull) break;
                        rh++;
                    }
                    rects.push({ x: gx - cx, y: gy - cy, w: rw, h: rh });
                    for (let iy = 0; iy < rh; iy++) {
                        const markRowOff = (gy + iy) * w;
                        for (let ix = 0; ix < rw; ix++) syncGrid[markRowOff + gx + ix] = 0;
                    }
                }
            }
        }
        for (const r of rects) {
            const rx = cx + r.x, ry = cy + r.y;
            for (let l = 1; l <= maxLayer; l++) {
                const targetGrid = this.layerGrids[l];
                let fullyCovered = true;
                for (let iy = 0; iy < r.h; iy++) {
                    const rowOff = (ry + iy) * w;
                    for (let ix = 0; ix < r.w; ix++) if (targetGrid[rowOff + rx + ix] === -1) { fullyCovered = false; break; }
                    if (!fullyCovered) break;
                }
                if (!fullyCovered) this._spawnBlock(r.x, r.y, r.w, r.h, l, false, 0, true, true, true, true, true);
            }
        }
    }

    _updateInternalLogicGrid() {
        if (!this.logicGridW || !this.logicGridH) return;
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
                    for (let gx = x1; gx <= x2; gx++) this.logicGrid[rowOff + gx] = 1;
                }
            }
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
                        for (let gx = x1; gx <= x2; gx++) this.logicGrid[rowOff + gx] = 1;
                    }
                }
                this._lastProcessedBlockCount = this.activeBlocks.length;
            }
        }
    }

    _spawnBlockCore(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, invisible = false) {
        const bs = this.getBlockSize();
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        if (!blocksX || !blocksY) return -1;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        // 1. Grid Boundary Constraint: Logic Grid Bounds
        const wLimit = Math.floor(blocksX / 2);
        const hLimit = Math.floor(blocksY / 2);

        if (cx + x < 0 || cx + x + w > blocksX || cy + y < 0 || cy + y + h > blocksY) {
            // Allow nudge/mirror to push things slightly further if logic grid allows, 
            // but generally restrict to logic grid boundaries.
            if (!isShifter && !isMirroredSpawn) return -1;
        }

        const startX = cx + x;
        const startY = cy + y;
        const minX = Math.max(0, startX);
        const maxX = Math.min(blocksX - 1, startX + w - 1);
        const minY = Math.max(0, startY);
        const maxY = Math.min(blocksY - 1, startY + h - 1);

        if (minX > maxX || minY > maxY) return -1; // Out of logic grid entirely

        // 2. Enforce Strict Layer-Specific Connectivity (Grid-Based Optimization)
        if (!skipConnectivity && !this.debugMode) {
             let connected = false;
             let overlapArea = 0;
             const targetGrid = this.layerGrids[layer];
             
             if (targetGrid) {
                 // Check overlap and orthogonal adjacency in one pass (O(area) instead of O(N_blocks))
                 // Expand search by 1 unit for adjacency
                 search: for (let gy = minY - 1; gy <= maxY + 1; gy++) {
                     if (gy < 0 || gy >= blocksY) continue;
                     const rowOff = gy * blocksX;
                     const isEdgeY = (gy < minY || gy > maxY);
                     
                     for (let gx = minX - 1; gx <= maxX + 1; gx++) {
                         if (gx < 0 || gx >= blocksX) continue;
                         const isEdgeX = (gx < minX || gx > maxX);
                         
                         if (targetGrid[rowOff + gx] !== -1) {
                             if (isEdgeX && isEdgeY) {
                                 // Diagonal neighbor - skip corner connections
                                 continue;
                             }

                             if (isEdgeX || isEdgeY) {
                                 // Edge neighbor - valid connection
                                 connected = true;
                             } else {
                                 // Interior overlap - valid connection
                                 overlapArea++;
                                 connected = true; 
                             }
                         }
                     }
                 }
             }

             if (!connected) return -1; 
             
             // Prevent internal stacking if not allowed
             if (!isShifter && !allowInternal && overlapArea >= (w * h)) return -1; 
        }

        // 4. Occupancy and Logic Grid Update (Merged Loops)
        if (this._stepOccupancy && !bypassOccupancy) {
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    if (this._stepOccupancy[rowOff + gx] === 1) return -1;
                }
            }
            // Mark occupancy
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    this._stepOccupancy[rowOff + gx] = 1;
                }
            }
        }

        if (this.logicGrid) {
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    this.logicGrid[rowOff + gx] = 1;
                }
            }
        }

        // Principle #4: Disable spawning on Layer 0 if promotion is enabled
        // EXCEPT if it's a promotion/forced spawn (indicated by bypassOccupancy)
        if (!bypassOccupancy && layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'))) {
             return -1;
        }

        const id = this.nextBlockId++;
        const b = { 
            x, y, w, h, 
            startFrame: this.animFrame, 
            startPhase: this.expansionPhase, 
            layer, id, isShifter,
            dist: Math.abs(x) + Math.abs(y),
            invisible: invisible, // Record for local state
            stepAge: 0
        };
        if (expireFrames > 0) b.expireFrame = this.animFrame + expireFrames;
        this.activeBlocks.push(b);
        
        const op = {
            type: 'addSmart', 
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            expireFrame: (expireFrames > 0) ? this.animFrame + expireFrames : null,
            layer: layer,
            blockId: id,
            isShifter: isShifter,
            fade: !suppressFades,
            invisible: invisible // NEW: Record invisibility in op
        };
        this.maskOps.push(op);
        this._gridsDirty = true;

        // Record to sequence for Editor/Step support
        if (this.manualStep && this.sequence && !this.isReconstructing) {
            const targetIdx = Math.max(0, this.expansionPhase - 1);
            if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
            const seqOp = {
                op: (w === 1 && h === 1) ? 'addSmart' : 'addRect',
                args: (w === 1 && h === 1) ? [x, y] : [x, y, x + w - 1, y + h - 1],
                layer: layer,
                invisible: invisible // Record in sequence too
            };
            this.sequence[targetIdx].push(seqOp);
        }
        
        this._writeToGrid(x, y, w, h, (op.fade === false ? -1000 : this.animFrame), layer);

        return id;
        }
    _writeToGrid(x, y, w, h, value, layer = 0) {
        if (!this.renderGrid || !this.layerGrids[layer]) return;
        
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const minX = Math.max(0, cx + x);
        const maxX = Math.min(blocksX - 1, cx + x + w - 1);
        const minY = Math.max(0, cy + y);
        const maxY = Math.min(blocksY - 1, cy + y + h - 1);
        
        if (minX > maxX || minY > maxY) return;

        // Optimization: During reconstruction, we don't need to write to the grid 
        // cell-by-cell because _updateRenderGridLogic will perform a full 
        // composition pass at the end of the jump.
        if (this.isReconstructing) {
            this._gridsDirty = true;
            return;
        }

        const targetGrid = this.layerGrids[layer];
        for (let gy = minY; gy <= maxY; gy++) {
            const rowOff = gy * blocksX;
            for (let bx = minX; bx <= maxX; bx++) {
                targetGrid[rowOff + bx] = value;
            }
        }
        
        this._gridsDirty = true;
        this._outsideMapDirty = true;
    }

    _nudge(x, y, w, h, face, layer = 0, multiLayer = false) {
        const bs = this.getBlockSize();
        const now = this.animFrame;
        const bx = this.logicGridW, by = this.logicGridH;
        const cx = Math.floor(bx / 2), cy = Math.floor(by / 2);

        let axis = 'X', dir = 1;
        if (face) {
            const f = face.toUpperCase();
            if (f === 'N') { axis = 'Y'; dir = -1; }
            else if (f === 'S') { axis = 'Y'; dir = 1; }
            else if (f === 'E') { axis = 'X'; dir = 1; }
            else if (f === 'W') { axis = 'X'; dir = -1; }
        }
        // Principle #5: Disable starting nudges for Layer 0 when promotion is enabled
        if (layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'))) {
             return false;
        }

        const shiftAmt = (axis === 'X' ? w : h);

        // Determine which layers are affected.
        // ML Nudge affects 0, 1, and 2 if multiLayer is true.
        const targetLayers = (multiLayer) ? [0, 1, 2] : [layer];
        const targetLayersSet = new Set(targetLayers);

        // 1. Identify and Shift blocks across all target layers
        const shiftedBlocks = [];
        for (const b of this.activeBlocks) {
            if (!targetLayersSet.has(b.layer)) continue;

            let shouldMove = false;
            if (axis === 'X') {
                const laneMatch = (b.y >= y && b.y < y + h);
                const posMatch = (dir > 0) ? (b.x >= x) : (b.x + b.w - 1 <= x + w - 1);
                if (laneMatch && posMatch) shouldMove = true;
            } else {
                const laneMatch = (b.x >= x && b.x < x + w);
                const posMatch = (dir > 0) ? (b.y >= y) : (b.y + b.h - 1 <= y + h - 1);
                if (laneMatch && posMatch) shouldMove = true;
            }
            if (shouldMove) {
                shiftedBlocks.push({ b, oldX: b.x, oldY: b.y, oldW: b.w, oldH: b.h, start: b.startFrame, layer: b.layer });
                if (axis === 'X') b.x += (dir * shiftAmt);
                else b.y += (dir * shiftAmt);
            }
        }

        // 2. Synchronize shifts with maskOps (Addition-Only for continuous structure)
        for (const m of shiftedBlocks) {
            // Record addition at new position
            this.maskOps.push({ 
                type: 'addSmart', 
                x1: m.b.x, y1: m.b.y, x2: m.b.x + m.b.w - 1, y2: m.b.y + m.b.h - 1, 
                startFrame: m.start, startPhase: this.expansionPhase, 
                layer: m.layer,
                fade: false
            });

            // Fix: Check if old position is already covered on this layer before spawning replacement
            // This prevents exponential growth of activeBlocks/maskOps during repeated nudges
            const oldIdx = (cy + m.oldY) * bx + (cx + m.oldX);
            if (this.layerGrids[m.layer] && this.layerGrids[m.layer][oldIdx] === -1) {
                this._spawnBlock(m.oldX, m.oldY, m.oldW, m.oldH, m.layer, false, 0, true, true, true, false, true);
            }
        }

        // 3. Add the SOURCE REPLACEMENT blocks at the original origin (x, y) for all target layers
        let success = false;
        for (const l of targetLayers) {
            if (this._spawnBlock(x, y, w, h, l, false, 0, true, true, true, false, true) !== -1) {
                success = true;
            }
        }

        if (success) {
            // Record to sequence for Editor/Step support (ONLY if not currently reconstructing)
            if (this.manualStep && this.sequence && !this.isReconstructing) {
                const targetIdx = Math.max(0, this.expansionPhase - 1);
                if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
                this.sequence[targetIdx].push({ 
                    op: multiLayer ? 'nudgeML' : 'nudge', 
                    args: [x, y, w, h, face], 
                    layer: layer 
                });
            }

            this._log(`Nudge: Solid Shifted ${shiftedBlocks.length} blocks across layers [${targetLayers.join(',')}], continuous mass preserved.`);
            this._gridsDirty = true;
            this._maskDirty = true;
            return true;
        }
        return false;
    }

    _nudgeBlock(block, dx, dy) {
        if (!block) return false;
        let face = 'N';
        if (dx === 1) face = 'E';
        else if (dx === -1) face = 'W';
        else if (dy === 1) face = 'S';
        else if (dy === -1) face = 'N';
        
        // _nudge already contains anchoring and occupancy checks
        // Default behavior: ML nudge for layer 0, SL nudge for others
        return this._nudge(block.x, block.y, block.w, block.h, face, block.layer, block.layer === 0);
    }

    _attemptSpokeShiftGrowth(ignored, targetLayer = 0) {
        const anchors = this.activeBlocks.filter(b => b.layer === targetLayer);
        if (anchors.length === 0) return false;
        const anchor = anchors[Math.floor(Math.random() * anchors.length)];
        const dirs = this._getBiasedDirections(), dir = dirs[0];
        const amount = Math.floor(Math.random() * 2) + 1;
        let startCoords = (dir === 'N' || dir === 'S') ? { x: anchor.x, y: 0 } : { x: 0, y: anchor.y };
        return this._blockShift(dir, amount, startCoords, targetLayer);
    }

    _blockShift(direction, amount, startCoords, targetLayer = 0) {
        if (!this.renderGrid) return false;
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        let dx = 0, dy = 0, scanX = false;
        if (direction === 'N') { dy = -1; scanX = false; }
        else if (direction === 'S') { dy = 1; scanX = false; }
        else if (direction === 'E') { dx = 1; scanX = true; }
        else if (direction === 'W') { dx = -1; scanX = true; }
        const rowY = startCoords.y, colX = startCoords.x;
        let currentRelX = scanX ? 0 : colX, currentRelY = scanX ? rowY : 0;
        let furthestDist = -1; const potentialGaps = [];
        const maxDist = Math.max(w, h);
        for (let d = 0; d < maxDist; d++) {
            const tx = currentRelX + (scanX ? d * dx : 0), ty = currentRelY + (scanX ? 0 : d * dy);
            const gx = cx + tx, gy = cy + ty;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) break;
            const idx = gy * w + gx;
            if (this.layerGrids[targetLayer] && this.layerGrids[targetLayer][idx] !== -1) furthestDist = d;
            else potentialGaps.push({x: tx, y: ty, d: d});
        }
        let success = false;
        for (const gap of potentialGaps) {
            if (gap.d < furthestDist) {
                if (this._spawnBlock(gap.x, gap.y, 1, 1, targetLayer, false, 0, false, true, true) !== -1) success = true; 
            }
        }
        let startExt = furthestDist + 1;
        for (let i = 0; i < amount; i++) {
            const d = startExt + i, tx = currentRelX + (scanX ? d * dx : 0), ty = currentRelY + (scanX ? 0 : d * dy);
            const gx = cx + tx, gy = cy + ty;
            if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                if (this._spawnBlock(tx, ty, 1, 1, targetLayer, false, 0, false, false, true) !== -1) success = true;
            }
        }
        return success;
    }

    _attemptClusterGrowth(ignored, targetLayer = 0) {
        const anchors = this._getLooselyCentralAnchors(targetLayer);
        if (anchors.length === 0) return false;

        for (const anchor of anchors) {
            const dirs = this._getBiasedDirections();
            for (const dir of dirs) {
                const axis = (dir === 'N' || dir === 'S') ? 'V' : 'H';

                let startCoords;
                if (axis === 'V') { startCoords = { x: anchor.x, y: 0 }; }
                else { startCoords = { x: 0, y: anchor.y }; }
                
                if (this._blockShift(dir, Math.floor(Math.random() * 2) + 2, startCoords, targetLayer)) {
                    return true;
                }
            }
        }
        return false;
    }

    flattenLayers(targetLayers, selectionRect, stepIndex) {
        if (!this.sequence) return 0;
        const layers = targetLayers || [1, 2];
        const layerSet = new Set(layers);
        let count = 0;
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
                if (op.layer && layerSet.has(op.layer)) {
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
                        const minX = Math.min(opX1, opX2);
                        const maxX = Math.max(opX1, opX2);
                        const minY = Math.min(opY1, opY2);
                        const maxY = Math.max(opY1, opY2);
                        const sMinX = selectionRect.x;
                        const sMaxX = selectionRect.x + selectionRect.w;
                        const sMinY = selectionRect.y;
                        const sMaxY = selectionRect.y + selectionRect.h;
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
            if (stepIndex < this.sequence.length) {
                processStep(this.sequence[stepIndex]);
            }
        } else {
            for (const step of this.sequence) {
                processStep(step);
            }
        }
        return count;
    }

    mergeBlocksAtStep(blocks, stepIndex) {
        if (!this.sequence || stepIndex < 0 || stepIndex >= this.sequence.length) return 0;
        if (!blocks || blocks.length === 0) return 0;
        const step = this.sequence[stepIndex];
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const w = this.logicGridW;
        let count = 0;
        for (const pt of blocks) {
            const x = pt.x;
            const y = pt.y;
            if (x < 0 || x >= this.logicGridW || y < 0 || y >= this.logicGridH) continue;
            const idx = y * w + x;
            for (let l = 1; l <= 2; l++) {
                const grid = this.layerGrids[l];
                if (grid && grid[idx] !== -1) {
                    const rx = x - cx;
                    const ry = y - cy;
                    step.push({ op: 'removeBlock', args: [rx, ry], layer: l });
                    step.push({ op: 'add', args: [rx, ry], layer: 0 });
                    count++;
                }
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
        const r = selectionRect;
        const w = this.logicGridW;
        let count = 0;
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                if (x < 0 || x >= this.logicGridW || y < 0 || y >= this.logicGridH) continue;
                const idx = y * w + x;
                for (let l = 1; l <= 2; l++) {
                    const grid = this.layerGrids[l];
                    if (grid && grid[idx] !== -1) {
                        const rx = x - cx;
                        const ry = y - cy;
                        step.push({ op: 'removeBlock', args: [rx, ry], layer: l });
                        step.push({ op: 'add', args: [rx, ry], layer: 0 });
                        count++;
                    }
                }
            }
        }
        return count;
    }

    _isProceduralFinished() {
        if (!this.renderGrid) return true;
        
        // 1. Check axis points (fast)
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        
        const check = (x, y) => {
            if (x < 0 || x >= w || y < 0 || y >= h) return true;
            return this.renderGrid[y * w + x] !== -1;
        };

        const hitN = check(cx, 0);
        const hitS = check(cx, h - 1);
        const hitW = check(0, cy);
        const hitE = check(w - 1, cy);

        // 2. If axes reached, perform full visible coverage check
        if (hitN && hitS && hitW && hitE) {
            return this._isCanvasFullyCovered();
        }
        
        return false;
    }

    _getBiasedCoordinate(minL, maxL, size, pStatus, axis) {
        const centerReached = (axis === 'X') ? (pStatus.E && pStatus.W) : (pStatus.N && pStatus.S);
        if (!centerReached && Math.random() < 0.8) {
            const range = 2;
            const low = Math.max(minL, -range);
            const high = Math.min(maxL - size, range);
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }
        return Math.floor(Math.random() * (maxL - size - minL + 1)) + minL;
    }

    _getPerimeterStatus(offX, offY, visibleW, visibleH) {
        const w = this.logicGridW, h = this.logicGridH;
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);
        const status = { N: true, S: true, E: true, W: true };
        const check = (layer) => {
            const grid = this.layerGrids[layer];
            if (!grid) return;
            for (let x = startX; x < endX; x++) if (grid[startY * w + x] === -1) status.N = false;
            const lastY = endY - 1;
            for (let x = startX; x < endX; x++) if (grid[lastY * w + x] === -1) status.S = false;
            for (let y = startY; y < endY; y++) if (grid[y * w + startX] === -1) status.W = false;
            const lastX = endX - 1;
            for (let y = startY; y < endY; y++) if (grid[y * w + lastX] === -1) status.E = false;
        };
        for (let i = 0; i < 3; i++) check(i);
        return status;
    }

    _mergeLayer1(maxCycle = -1) {
        const now = this.animFrame;
        const blocksToMerge = this.activeBlocks.filter(b => 
            b.layer === 1 && (maxCycle === -1 || b.spawnCycle === undefined || b.spawnCycle <= maxCycle)
        );
        if (blocksToMerge.length === 0) return;
        for (const b of blocksToMerge) {
            this.maskOps.push({ type: 'removeBlock', x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, startFrame: now, layer: 1, fade: false });
            this.maskOps.push({ type: 'add', x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, startFrame: now, layer: 0, blockId: b.id });
            b.layer = 0;
            this._writeToGrid(b.x, b.y, b.w, b.h, now, 0); 
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);  
        }
        this._lastProcessedOpIndex = 0;
        this._maskDirty = true;
    }

    _getScaledConfig(key, defaultValue) {
        const val = this.getConfig(key);
        const finalVal = (val !== undefined) ? val : defaultValue;

        if (this.getConfig('EnableScaledGrowth') === true) {
            // Calculate current mass percentage
            let filled = 0;
            const lg = this.logicGrid;
            if (lg) {
                for (let i = 0; i < lg.length; i++) if (lg[i] === 1) filled++;
                const massPercent = filled / lg.length;

                const isMin = key === 'MinBlockWidth' || key === 'MinBlockHeight';
                const isMax = key === 'MaxBlockWidth' || key === 'MaxBlockHeight';

                if (isMin || isMax) {
                    // Initial Phase (Mass < 5%): Max 2, Min 1
                    if (massPercent < 0.05) {
                        return isMax ? Math.min(finalVal, 2) : Math.min(finalVal, 1);
                    } 
                    // Growth Phase (5% - 25%): Interpolate
                    else if (massPercent < 0.25) {
                        const t = (massPercent - 0.05) / 0.20;
                        if (isMax) return Math.min(finalVal, Math.round(2 + (finalVal - 2) * t));
                        return Math.min(finalVal, Math.round(1 + (finalVal - 1) * t));
                    }
                }
            }
        }
        return finalVal;
    }

    _checkNoOverlap(x, y, w, h, layer = 0, checkVacated = true) {
        if (!this.logicGridW || !this.logicGridH || !this.logicGrid) return false;
        
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        const gx1 = cx + x, gy1 = cy + y;
        const gx2 = gx1 + w - 1, gy2 = gy1 + h - 1;

        // Bounds check
        if (gx1 < 0 || gx2 >= this.logicGridW || gy1 < 0 || gy2 >= this.logicGridH) return false;

        // Grid-based overlap check (All Layers via logicGrid)
        const remGrid = checkVacated ? this.removalGrids[layer] : null;
        const cooldown = 3;

        for (let gy = gy1; gy <= gy2; gy++) {
            const rowOff = gy * this.logicGridW;
            for (let gx = gx1; gx <= gx2; gx++) {
                if (this.logicGrid[rowOff + gx] === 1) return false;
                if (remGrid) {
                    const remPhase = remGrid[rowOff + gx];
                    if (remPhase !== -1 && this.expansionPhase - remPhase < cooldown) return false;
                }
            }
        }

        return true;
    }

    _updateOutsideMap() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;

        const size = w * h;
        if (!this._outsideMap || this._outsideMap.length !== size) {
            this._outsideMap = new Uint8Array(size);
        }
        const status = this._outsideMap;
        status.fill(0);

        if (!this._bfsQueue || this._bfsQueue.length < size) {
            this._bfsQueue = new Int32Array(size);
        }
        const queue = this._bfsQueue;
        let head = 0, tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && this.logicGrid[idx] === 0) { 
                status[idx] = 1;
                queue[tail++] = idx;
            }
        };

        // Seed BFS from logic grid boundaries
        for (let x = 0; x < w; x++) { 
            add(x); 
            add((h - 1) * w + x); 
        }
        for (let y = 1; y < h - 1; y++) {
            add(y * w); 
            add(y * w + (w - 1)); 
        }

        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % w, cy = (idx / w) | 0;
            if (cy > 0) add(idx - w); 
            if (cy < h - 1) add(idx + w);
            if (cx > 0) add(idx - 1); 
            if (cx < w - 1) add(idx + 1);
        }
    }

    _checkNoHole(tx, ty, tw, th) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        if (this._outsideMapDirty || !this._outsideMap) {
            this._updateOutsideMap();
            this._outsideMapDirty = false;
        }
        const status = this._outsideMap;

        const candidates = [];
        for (let x = tx - 1; x <= tx + tw; x++) { candidates.push([x, ty - 1], [x, ty + th]); }
        for (let y = ty; y < ty + th; y++) { candidates.push([tx - 1, y], [tx + tw, y]); }
        
        for (const [nx, ny] of candidates) {
            const gx = nx + cx, gy = ny + cy;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
            
            // If the cell is empty and NOT reachable from the boundary (outside), it is an enclosed hole
            if (this.logicGrid[gy * w + gx] === 0 && status[gy * w + gx] === 0) {
                return false;
            }
        }
        return true;
    }

    _attemptUnfoldGrowth(sequence = null, targetLayerInput = 0) {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const targetLayer = targetLayerInput;

        if (sequence) {
            if (sequence.step === 0) { sequence.step = 1; } 
            else if (sequence.step === 1) {
                const { x, y, dir } = sequence;
                let tx = x, ty = y;
                if (dir === 'N') ty -= 1; else if (dir === 'S') ty += 1;
                else if (dir === 'E') tx += 1; else if (dir === 'W') tx -= 1;
                
                // Spawn individual 1x1 block
                const result = this._spawnBlock(tx, ty, 1, 1, targetLayer, false, 0, false, true, true);
                sequence.active = false;
                return (result !== -1);
            }
            return false;
        }

        // Local throttle per layer
        if (!this.unfoldSequences[targetLayer]) this.unfoldSequences[targetLayer] = [];
        if (this.unfoldSequences[targetLayer].length >= 5) return false;
        
        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;

        // 1. Anchor Selection: Use individual 1x1 edge blocks
        const layerBlocks = this.activeBlocks.filter(b => b.layer === targetLayer && b.w === 1 && b.h === 1);
        if (layerBlocks.length === 0) return false;
        
        Utils.shuffle(layerBlocks);
        const anchors = layerBlocks.slice(0, 40);

        for (const anchor of anchors) {
            const gx = cx + anchor.x, gy = cy + anchor.y;
            
            // Check for edge-ness (at least one free neighbor)
            const hasN = (gy > 0 && grid[(gy - 1) * w + gx] !== -1);
            const hasS = (gy < h - 1 && grid[(gy + 1) * w + gx] !== -1);
            const hasE = (gx < w - 1 && grid[gy * w + gx + 1] !== -1);
            const hasW = (gx > 0 && grid[gy * w + gx - 1] !== -1);
            if (hasN && hasS && hasE && hasW) continue; 

            const faces = this._getBiasedDirections();
            const candidates = [];

            for (const unfoldDir of faces) {
                let tx = anchor.x, ty = anchor.y;
                if (unfoldDir === 'N') ty -= 1; else if (unfoldDir === 'S') ty += 1;
                else if (unfoldDir === 'E') tx += 1; else if (unfoldDir === 'W') tx -= 1;

                const dSourceSq = anchor.x * anchor.x + anchor.y * anchor.y;
                const dTargetSq = tx * tx + ty * ty;
                
                let score = 0;
                
                // Reward growing OUTWARD
                if (dTargetSq > dSourceSq) score += 40;
                
                // Reward staying near core
                if (dSourceSq < 225) score += 60;

                // L-Shape / Corner Bonus: VERY high to encourage Rearranging
                let createsCorner = false;
                if ((unfoldDir === 'E' || unfoldDir === 'W') && (hasN || hasS)) createsCorner = true;
                if ((unfoldDir === 'N' || unfoldDir === 'S') && (hasE || hasW)) createsCorner = true;
                if (createsCorner) score += 100;

                // Axis Fins (Perpendicular growth)
                const distToXAxis = Math.abs(anchor.y);
                const distToYAxis = Math.abs(anchor.x);
                if (distToXAxis < distToYAxis) {
                    if (unfoldDir === 'N' || unfoldDir === 'S') score += 50;
                } else {
                    if (unfoldDir === 'E' || unfoldDir === 'W') score += 50;
                }
                
                score += Math.random() * 20;
                candidates.push({ dir: unfoldDir, score, tx, ty });
            }

            candidates.sort((a, b) => b.score - a.score);

            for (const c of candidates) {
                if (this._checkNoOverlap(c.tx, c.ty, 1, 1, targetLayer) && this._checkNoHole(c.tx, c.ty, 1, 1)) {
                    this.unfoldSequences[targetLayer].push({ active: true, step: 0, x: anchor.x, y: anchor.y, dir: c.dir, layer: targetLayer });
                    // Snapshot source
                    this._spawnBlock(anchor.x, anchor.y, 1, 1, targetLayer, false, 0, true, true, true, false, true);
                    return true;
                }
            }
        }
        return false;
    }

    _attemptRearrangeGrowth(targetLayerInput) {
        if (!this.rearrangePool || this.expansionPhase < 10) return false;
        const targetLayer = targetLayerInput !== undefined ? targetLayerInput : 0;
        
        // Interpreted as 'Actions per Step' (1-5)
        const quota = Math.max(1, Math.floor(this.getConfig('RearrangeFrequency') || 1));

        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        let actionsPerformed = 0;

        // Phase 1: Redistribution (Place blocks from pool into holes near axes)
        // This is a "free" action that doesn't count against deletion quota as it ADDS blocks.
        if (this.rearrangePool[targetLayer] > 0) {
            const range = 25; 
            const holes = [];
            
            const maxHoleAttempts = 100;
            for (let i = 0; i < maxHoleAttempts; i++) {
                const dx = Math.floor(Math.random() * (range * 2 + 1)) - range;
                const dy = Math.floor(Math.random() * (range * 2 + 1)) - range;
                if (this._checkNoOverlap(dx, dy, 1, 1, targetLayer)) {
                    const axisDist = Math.min(Math.abs(dx), Math.abs(dy));
                    holes.push({x: dx, y: dy, axisDist, distSq: dx*dx + dy*dy});
                }
                if (holes.length >= 15) break;
            }
            
            if (holes.length > 0) {
                holes.sort((a, b) => a.axisDist - b.axisDist || a.distSq - b.distSq);
                const hole = holes[0];
                const poolSize = this.rearrangePool[targetLayer];
                const sizes = [];
                if (poolSize >= 3) sizes.push({w:3,h:1}, {w:1,h:3});
                if (poolSize >= 2) sizes.push({w:2,h:1}, {w:1,h:2}, {w:2,h:2});
                sizes.push({w:1,h:1});
                
                for (const sz of sizes) {
                    if (this._spawnBlock(hole.x, hole.y, sz.w, sz.h, targetLayer, false, 0, false, true, true, false, true) !== -1) {
                        this.rearrangePool[targetLayer] -= (sz.w * sz.h);
                        // this._log(`[Rearrange] Redistributed ${sz.w}x${sz.h} to (${hole.x}, ${hole.y}) on L${targetLayer}.`);
                        break; 
                    }
                }
            }
        }

        // Phase 2: Maintenance (Rotation, Pruning, L-Shape) - Counts against Quota
        const subLayersOnly = this.getConfig('RearrangeSubLayersOnly') === true;
        if (subLayersOnly && targetLayer === 0) return actionsPerformed > 0;

        while (actionsPerformed < quota) {
            const grid = this.layerGrids[targetLayer];
            if (!grid) break;

            const layerBlocks = this.activeBlocks.filter(b => b.layer === targetLayer);
            if (layerBlocks.length === 0) break;

            const posMap = new Map();
            for (const b of layerBlocks) posMap.set(b.x + ',' + b.y, b);

            Utils.shuffle(layerBlocks);
            const sample = layerBlocks.slice(0, 50);
            let actionTakenInLoop = false;

            for (const b of sample) {
                if (!this.activeBlocks.includes(b)) continue;

                // --- 1. Rotation Check (Axis Alignment) ---
                if (b.w !== b.h) {
                    const distX = Math.abs(b.x), distY = Math.abs(b.y);
                    const onHorizArm = distX > (distY * 1.5) + 2; 
                    const onVertArm = distY > (distX * 1.5) + 2;

                    let needsRotation = false;
                    if (b.h > b.w && onHorizArm) needsRotation = true; 
                    if (b.w > b.h && onVertArm) needsRotation = true; 

                    if (needsRotation) {
                        const idx = this.activeBlocks.indexOf(b);
                        if (idx !== -1) {
                            this.activeBlocks.splice(idx, 1);
                            this.maskOps.push({ 
                                type: 'removeBlock', 
                                x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, 
                                startFrame: this.animFrame, layer: b.layer, fade: false 
                            });
                            this._writeToGrid(b.x, b.y, b.w, b.h, -1, b.layer);

                            const spawnedId = this._spawnBlock(b.x, b.y, b.h, b.w, targetLayer, false, 0, true, true, true, false, true);
                            if (spawnedId === -1) this.rearrangePool[targetLayer] += (b.w * b.h);
                            
                            this._gridsDirty = true; this._maskDirty = true;
                            actionsPerformed++; actionTakenInLoop = true;
                            break; 
                        }
                    }
                }

                // --- 2. Dangling Pruning (1x1 only) ---
                if (b.w === 1 && b.h === 1) {
                    const gx = cx + b.x, gy = cy + b.y;
                    let nCnt = 0;
                    if (gy > 0 && grid[(gy - 1) * w + gx] !== -1) nCnt++;
                    if (gy < h - 1 && grid[(gy + 1) * w + gx] !== -1) nCnt++;
                    if (gx < w - 1 && grid[gy * w + gx + 1] !== -1) nCnt++;
                    if (gx > 0 && grid[gy * w + gx - 1] !== -1) nCnt++;

                    if (nCnt <= 1) {
                        const idx = this.activeBlocks.indexOf(b);
                        if (idx !== -1) {
                            this.activeBlocks.splice(idx, 1);
                            this.rearrangePool[targetLayer]++;
                            this.maskOps.push({ type: 'removeBlock', x1: b.x, y1: b.y, x2: b.x, y2: b.y, startFrame: this.animFrame, layer: b.layer, fade: false });
                            this._writeToGrid(b.x, b.y, 1, 1, -1, b.layer);
                            this._gridsDirty = true; this._maskDirty = true;
                            actionsPerformed++; actionTakenInLoop = true;
                            break;
                        }
                    }
                }

                // --- 3. L-Shape Extrusion Removal (1x1 only) ---
                if (b.w === 1 && b.h === 1) {
                    const gx = cx + b.x, gy = cy + b.y;
                    const hasN = (gy > 0 && grid[(gy - 1) * w + gx] !== -1);
                    const hasS = (gy < h - 1 && grid[(gy + 1) * w + gx] !== -1);
                    const hasE = (gx < w - 1 && grid[gy * w + gx + 1] !== -1);
                    const hasW = (gx > 0 && grid[gy * w + gx - 1] !== -1);

                    let armDX = 0, armDY = 0;
                    if (hasN && hasE) { armDX = 1; armDY = -1; } 
                    else if (hasN && hasW) { armDX = -1; armDY = -1; } 
                    else if (hasS && hasE) { armDX = 1; armDY = 1; } 
                    else if (hasS && hasW) { armDX = -1; armDY = 1; }

                    if (armDX !== 0) {
                        let remX = null, remY = null;
                        if (Math.abs(b.x) < Math.abs(b.y)) {
                            if (Math.abs(b.x + armDX) > Math.abs(b.x)) { remX = b.x + armDX; remY = b.y; }
                        } else {
                            if (Math.abs(b.y + armDY) > Math.abs(b.y)) { remX = b.x; remY = b.y + armDY; }
                        }

                        if (remX !== null) {
                            const targetBlock = posMap.get(`${remX},${remY}`);
                            if (targetBlock) {
                                const idx = this.activeBlocks.indexOf(targetBlock);
                                if (idx !== -1) {
                                    this.activeBlocks.splice(idx, 1);
                                    this.rearrangePool[targetLayer]++;
                                    this.maskOps.push({ type: 'removeBlock', x1: targetBlock.x, y1: targetBlock.y, x2: targetBlock.x, y2: targetBlock.y, startFrame: this.animFrame, layer: targetBlock.layer, fade: false });
                                    this._writeToGrid(targetBlock.x, targetBlock.y, 1, 1, -1, targetBlock.layer);
                                    this._gridsDirty = true; this._maskDirty = true;
                                    actionsPerformed++; actionTakenInLoop = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (!actionTakenInLoop) break; // No more actions can be taken
        }

        return actionsPerformed > 0;
    }

    _attemptCenteredGrowth(ignored, targetLayer = 0) {
        if (!this.centeredState || !this.centeredState[targetLayer]) {
            if (!this.centeredState) this.centeredState = [];
            this.centeredState[targetLayer] = { currentMaxRadius: 0 };
        }
        
        const state = this.centeredState[targetLayer];
        
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;
        
        const sizes = [
            {w:1, h:1}, {w:1, h:2}, {w:2, h:1}, {w:2, h:2}
        ];

        // Search from r=0 outwards to find the first available innermost gap.
        // This ensures the core remains solid even if nudge shifts blocks away.
        // We limit search radius to currentMaxRadius + buffer for performance.
        const maxR = Math.min(Math.max(w, h), state.currentMaxRadius + 5);
        
        for (let r = 0; r <= maxR; r++) {
            const points = [];
            if (r === 0) {
                points.push({x: 0, y: 0});
            } else {
                // Sample the ring
                const samples = Math.min(16, r * 4); 
                for (let i = 0; i < samples; i++) {
                    const side = Math.floor(Math.random() * 4);
                    const pos = Math.floor(Math.random() * (r * 2 + 1)) - r;
                    if (side === 0) points.push({x: -r, y: pos});
                    else if (side === 1) points.push({x: r, y: pos});
                    else if (side === 2) points.push({x: pos, y: -r});
                    else points.push({x: pos, y: r});
                }
            }

            for (const pt of points) {
                const gx = cx + pt.x, gy = cy + pt.y;
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;

                // If this spot is empty on the target layer, try to fill it
                if (grid[gy * w + gx] === -1) {
                    const sz = sizes[Math.floor(Math.random() * sizes.length)];
                    const ox = pt.x - Math.floor(sz.w / 2);
                    const oy = pt.y - Math.floor(sz.h / 2);

                    // Must be anchored to existing mass OR be the center seed
                    const isCenter = (pt.x === 0 && pt.y === 0);
                    // Use skipConnectivity=true ONLY for the center seed to allow it to start,
                    // but enforce connectivity for all subsequent blocks to ensure outward expansion.
                    if (this._spawnBlock(ox, oy, sz.w, sz.h, targetLayer, false, 0, isCenter, true, true, false, true) !== -1) {
                        // Update max radius if we spawned at the frontier
                        if (r >= state.currentMaxRadius) {
                            state.currentMaxRadius = r + 1;
                        }
                        return true; 
                    }
                }
            }
        }

        return false;
    }

    _performCenterBiasedGrowth(maxLen, layer, isVertical) {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const candidates = [];
        const searchRange = 10; 

        for (let gy = cy - searchRange; gy <= cy + searchRange; gy++) {
            for (let gx = cx - searchRange; gx <= cx + searchRange; gx++) {
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                if (grid[gy * w + gx] !== -1) continue;

                const lx = gx - cx, ly = gy - cy;
                
                // Strict Cardinal Axis focus: only spawn ON the center lines
                const onNS = Math.abs(lx) <= 0;
                const onEW = Math.abs(ly) <= 0;
                
                if (isVertical && !onNS) continue;
                if (!isVertical && !onEW) continue;

                const hasNeighbor = 
                    (gy > 0 && grid[(gy-1)*w+gx] !== -1) || (gy < h-1 && grid[(gy+1)*w+gx] !== -1) ||
                    (gx > 0 && grid[gy*w+gx-1] !== -1) || (gx < w-1 && grid[gy*w+gx+1] !== -1);
                
                if (hasNeighbor || (lx === 0 && ly === 0)) {
                    candidates.push({ gx, gy, dist: Math.abs(lx) + Math.abs(ly) });
                }
            }
        }

        if (candidates.length === 0) return false;
        
        candidates.sort((a, b) => a.dist - b.dist);
        const best = candidates.slice(0, 3);
        const winner = best[Math.floor(Math.random() * best.length)];

        // Force thin strips (max width 2 for vertical, max height 2 for horizontal)
        let bw = 1, bh = 1;
        if (isVertical) {
            bh = Math.min(maxLen, 2 + Math.floor(Math.random() * 3));
            bw = (Math.random() < 0.15) ? 2 : 1; 
        } else {
            bw = Math.min(maxLen, 2 + Math.floor(Math.random() * 3));
            bh = (Math.random() < 0.15) ? 2 : 1;
        }

        const bx = winner.gx - cx, by = winner.gy - cy;
        let fx = bx, fy = by;
        if (bw > 1) fx -= Math.floor(bw / 2);
        if (bh > 1) fy -= Math.floor(bh / 2);

        if (this._checkNoOverlap(fx, fy, bw, bh, layer)) {
            // Use suppressFades=true to prevent accumulation of persistent internal lines
            this._spawnBlock(fx, fy, bw, bh, layer, false, 0, true, true, true);
            return true;
        }
        return false;
    }

    _checkCardinalCompletion() {
        const w = this.logicGridW, h = this.logicGridH;
        const grid = this.layerGrids[0];
        if (!grid) return { ns: false, ew: false };

        let n = false, s = false, e = false, w_ = false;
        // North/South check (Top/Bottom rows of logic grid)
        for (let x = 0; x < w; x++) {
            if (grid[x] !== -1) n = true;
            if (grid[(h - 1) * w + x] !== -1) s = true;
        }
        // East/West check (Left/Right columns)
        for (let y = 0; y < h; y++) {
            if (grid[y * w] !== -1) w_ = true;
            if (grid[y * w + (w - 1)] !== -1) e = true;
        }
        return { ns: n && s, ew: e && w_ };
    }

    _performAxisNudging(completion) {
        const targetLayer = this.proceduralLayerIndex || 0;
        const candidates = this.activeBlocks.filter(b => b.layer === targetLayer && b.isPerimeter);
        if (candidates.length === 0) return false;

        Utils.shuffle(candidates);
        for (const b of candidates) {
            let dx = 0, dy = 0;
            
            // 10% Special case: expansion nudge towards nearest canvas edge
            if (Math.random() < 0.1) {
                const distN = b.y + (this.logicGridH / 2);
                const distS = (this.logicGridH / 2) - b.y;
                const distW = b.x + (this.logicGridW / 2);
                const distE = (this.logicGridW / 2) - b.x;
                const minDist = Math.min(distN, distS, distW, distE);
                
                if (minDist === distN) dy = -1;
                else if (minDist === distS) dy = 1;
                else if (minDist === distW) dx = -1;
                else if (minDist === distE) dx = 1;
            } else {
                // Nudge along axis of completion
                if (completion.ns) {
                    // N/S reached -> Nudge E/W to fill width
                    dx = b.x >= 0 ? 1 : -1;
                } else if (completion.ew) {
                    // E/W reached -> Nudge N/S to fill height
                    dy = b.y >= 0 ? 1 : -1;
                } else {
                    // Expanding away from center
                    dx = b.x === 0 ? 0 : (b.x > 0 ? 1 : -1);
                    dy = b.y === 0 ? 0 : (b.y > 0 ? 1 : -1);
                }
            }

            if ((dx !== 0 || dy !== 0) && this._nudgeBlock(b, dx, dy)) {
                b.age = 0;
                return true;
            }
        }
        return false;
    }

    _checkIsPerimeter(b) {
        const w = this.logicGridW, cx = Math.floor(w / 2), cy = Math.floor(this.logicGridH / 2);
        const grid = this.layerGrids[b.layer];
        if (!grid) return false;

        let openSides = 0;
        const checks = [
            {x: b.x - 1, y: b.y, w: 1, h: b.h}, // West
            {x: b.x + b.w, y: b.y, w: 1, h: b.h}, // East
            {x: b.x, y: b.y - 1, w: b.w, h: 1}, // North
            {x: b.x, y: b.y + b.h, w: b.w, h: 1}  // South
        ];

        for (const c of checks) {
            let occupied = false;
            for (let ly = 0; ly < c.h; ly++) {
                for (let lx = 0; lx < c.w; lx++) {
                    const gx = cx + c.x + lx, gy = cy + c.y + ly;
                    if (gx >= 0 && gx < w && gy >= 0 && gy < this.logicGridH && grid[gy * w + gx] !== -1) {
                        occupied = true;
                        break;
                    }
                }
                if (occupied) break;
            }
            if (!occupied) openSides++;
        }
        return openSides >= 1;
    }

    _performBlockMaintenance(block, maxLen) {
        const action = Math.random();
        if (action < 0.3) {
            // Transformation: Flip 5x1 to 1x5 or similar
            this.maskOps.push({ type: 'removeBlock', x1: block.x, y1: block.y, x2: block.x + block.w - 1, y2: block.y + block.h - 1, startFrame: this.animFrame, layer: block.layer, fade: false });
            this._writeToGrid(block.x, block.y, block.w, block.h, -1, block.layer);
            
            const nw = block.h, nh = block.w; 
            if (this._checkNoOverlap(block.x, block.y, nw, nh, block.layer)) {
                this._spawnBlock(block.x, block.y, nw, nh, block.layer, false, 0, true, true, true);
                const idx = this.activeBlocks.indexOf(block);
                if (idx !== -1) this.activeBlocks.splice(idx, 1);
                return true;
            }
        } else {
            // Nudge outwards
            const dx = block.x === 0 ? 0 : (block.x > 0 ? 1 : -1);
            const dy = block.y === 0 ? 0 : (block.y > 0 ? 1 : -1);
            if (this._nudgeBlock(block, dx, dy)) {
                block.age = 0;
                return true;
            }
        }
        return false;
    }

    _performBlockExpansion(maxLen, prioritizeLength = true) {
        if (this.activeBlocks.length === 0) return false;
        
        // Expansion logic now favors creating strips (e.g. 1x5)
        const candidates = this.activeBlocks.filter(b => b.isPerimeter && (b.w < maxLen || b.h < maxLen));
        if (prioritizeLength) {
            // Prefer expanding blocks that are already thin strips
            candidates.sort((a, b) => {
                const aRatio = Math.max(a.w, a.h);
                const bRatio = Math.max(b.w, b.h);
                return bRatio - aRatio;
            });
        }
        
        if (candidates.length === 0) return false;
        
        for (const b of candidates) {
            const dirs = ['N', 'S', 'E', 'W'];
            Utils.shuffle(dirs);
            
            for (const dir of dirs) {
                let nw = b.w, nh = b.h, nx = b.x, ny = b.y;
                // Strict strip growth: only expand in the dimension that is already dominant
                // or if it's a 1x1 block.
                const isVertical = b.h > b.w;
                const isHorizontal = b.w > b.h;

                if (isVertical && (dir === 'E' || dir === 'W')) continue;
                if (isHorizontal && (dir === 'N' || dir === 'S')) continue;
                
                if ((dir === 'N' || dir === 'S') && b.h >= maxLen) continue;
                if ((dir === 'E' || dir === 'W') && b.w >= maxLen) continue;

                if (dir === 'N') { ny--; nh++; }
                else if (dir === 'S') { nh++; }
                else if (dir === 'W') { nx--; nw++; }
                else if (dir === 'E') { nw++; }

                let extX = b.x, extY = b.y, extW = 1, extH = 1;
                if (dir === 'N') { extX = b.x; extY = b.y - 1; extW = b.w; extH = 1; }
                else if (dir === 'S') { extX = b.x; extY = b.y + b.h; extW = b.w; extH = 1; }
                else if (dir === 'W') { extX = b.x - 1; extY = b.y; extW = 1; extH = b.h; }
                else if (dir === 'E') { extX = b.x + b.w; extY = b.y; extW = 1; extH = b.h; }

                if (this._checkNoOverlap(extX, extY, extW, extH, b.layer) && this._checkNoHole(extX, extY, extW, extH)) {
                    // Use suppressLines=true for clean unfold expansion
                    this._spawnBlock(extX, extY, extW, extH, b.layer, false, 0, true, true, true);
                    b.x = nx; b.y = ny; b.w = nw; b.h = nh; b.age = 0;
                    this._writeToGrid(nx, ny, nw, nh, 1, b.layer);
                    return true;
                }
            }
        }
        return false;
    }

    _performCardinalGrowth(maxLen, mode = 'ANY') {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const targetLayer = this.proceduralLayerIndex || 0;
        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;

        const frontier = [];
        for (let gy = 1; gy < h - 1; gy++) {
            for (let gx = 1; gx < w - 1; gx++) {
                if (grid[gy * w + gx] !== -1) continue;
                const hasNeighbor = grid[(gy - 1) * w + gx] !== -1 || grid[(gy + 1) * w + gx] !== -1 || grid[gy * w + gx - 1] !== -1 || grid[gy * w + gx + 1] !== -1;
                if (hasNeighbor) {
                    const lx = gx - cx, ly = gy - cy;
                    const dist = Math.sqrt(lx * lx + ly * ly);
                    const isNS = Math.abs(lx) <= 1;
                    const isEW = Math.abs(ly) <= 1;
                    
                    let score = 100 - dist;
                    if (mode === 'VERTICAL' && isNS) score += 200;
                    else if (mode === 'HORIZONTAL' && isEW) score += 200;
                    
                    // Prioritize frontier cells that are already at the "tips" of the arms
                    if (isNS && Math.abs(ly) > 5) score += 50;
                    if (isEW && Math.abs(lx) > 5) score += 50;

                    let neighbors = 0;
                    if (grid[(gy-1)*w+gx] !== -1) neighbors++;
                    if (grid[(gy+1)*w+gx] !== -1) neighbors++;
                    if (grid[gy*w+gx-1] !== -1) neighbors++;
                    if (grid[gy*w+gx+1] !== -1) neighbors++;
                    if (neighbors >= 3) score -= 400; // Penalize filling inward, keep it branching

                    frontier.push({ gx, gy, score });
                }
            }
        }

        if (frontier.length === 0) {
            if (grid[cy * w + cx] === -1) {
                this._spawnBlock(0, 0, 1, 1, targetLayer, false, 0, true, true, true);
                return true;
            }
            return false;
        }

        frontier.sort((a, b) => b.score - a.score);
        const winners = frontier.slice(0, 3);
        const winner = winners[Math.floor(Math.random() * winners.length)];

        // Favor 1xN strips for cardinal growth
        let bw = 1, bh = 1;
        if (mode === 'VERTICAL') { 
            bh = Math.min(maxLen, 2 + Math.floor(Math.random() * 4)); 
            bw = 1;
        } else if (mode === 'HORIZONTAL') { 
            bw = Math.min(maxLen, 2 + Math.floor(Math.random() * 4)); 
            bh = 1;
        }

        let bx = winner.gx - cx, by = winner.gy - cy;
        if (bw > 1) bx -= Math.floor(bw / 2);
        if (bh > 1) by -= Math.floor(bh / 2);

        if (this._checkNoOverlap(bx, by, bw, bh, targetLayer)) {
            const enShoving = this.getConfig('EnableLayerShoving') === true;
            if (targetLayer === 0 && enShoving) this._shoveOtherLayers(bx, by, bw, bh);
            // Use suppressLines=true for clean expansion
            this._spawnBlock(bx, by, bw, bh, targetLayer, false, 0, true, true, true);
            return true;
        }
        return false;
    }

    _shoveOtherLayers(x, y, w, h) {
        // Simple shoving: if a block in Layer 1 overlaps, nudge it
        const l1 = this.layerGrids[1];
        if (!l1) return;

        const lgW = this.logicGridW;
        const cx = Math.floor(lgW / 2), cy = Math.floor(this.logicGridH / 2);

        for (let ly = 0; ly < h; ly++) {
            for (let lx = 0; lx < w; lx++) {
                const gx = cx + x + lx, gy = cy + y + ly;
                if (l1[gy * lgW + gx] !== -1) {
                    // Conflict found. Find the block in Layer 1 and nudge it.
                    const block = this.activeBlocks.find(b => b.layer === 1 && 
                        gx >= cx + b.x && gx < cx + b.x + b.w && 
                        gy >= cy + b.y && gy < cy + b.y + b.h);
                    
                    if (block) {
                        // Nudge outwards from center
                        const dx = block.x > 0 ? 1 : -1;
                        const dy = block.y > 0 ? 1 : -1;
                        
                        // Pick the axis with more momentum
                        if (Math.abs(block.x) > Math.abs(block.y)) {
                            this._nudgeBlock(block, dx, 0);
                        } else {
                            this._nudgeBlock(block, 0, dy);
                        }
                    }
                }
            }
        }
    }

    _performAutoActions() {
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return this.c.state['quantizedGenerateV2' + key];
        };

        const now = this.animFrame;
        const interval = 30; 

        if (getGenConfig('EnableAutoFillHoles') === true && now % interval === 0) {
            for (let i = 0; i < 3; i++) this._fillHoles(i);
        }
        
        if (getGenConfig('EnableAutoConnectIslands') === true && now % interval === 15) {
            this._connectIslands();
        }
    }

    _fillHoles(layer) {
        if (!this._gridsDirty && this.activeBlocks.length > 0) return;
        if (!this.logicGridW || !this.logicGridH) return;

        const w = this.logicGridW, h = this.logicGridH;
        const grid = this.layerGrids[layer];
        if (!grid) return;

        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const bs = this.getBlockSize();
        
        // 1. Define Visible Boundary (with a 2-block safety buffer)
        const visW = Math.ceil(this.g.cols / bs.w);
        const visH = Math.ceil(this.g.rows / bs.h);
        const xLim = Math.floor(visW / 2) + 2;
        const yLim = Math.floor(visH / 2) + 2;

        const minGX = Math.max(0, cx - xLim), maxGX = Math.min(w - 1, cx + xLim);
        const minGY = Math.max(0, cy - yLim), maxGY = Math.min(h - 1, cy + yLim);

        // 2. BFS from the Visibility Perimeter to find "Outside"
        const outsideMap = this._getBuffer('connectedMap', w * h, Uint8Array);
        outsideMap.fill(0);
        const queue = this._getBuffer('queue', w * h, Int32Array);
        let head = 0, tail = 0;

        const add = (gx, gy) => {
            const idx = gy * w + gx;
            if (outsideMap[idx] === 0 && grid[idx] === -1) { 
                outsideMap[idx] = 1; 
                queue[tail++] = idx; 
            }
        };

        // Seed BFS from any empty cell on or outside the visible boundary
        for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
                const isOutsideVis = (gx <= minGX || gx >= maxGX || gy <= minGY || gy >= maxGY);
                if (isOutsideVis) add(gx, gy);
            }
        }

        while (head < tail) {
            const idx = queue[head++];
            const cgx = idx % w, cgy = (idx / w) | 0;
            if (cgy > 0) add(cgx, cgy - 1); if (cgy < h - 1) add(cgx, cgy + 1);
            if (cgx > 0) add(cgx - 1, cgy); if (cgx < w - 1) add(cgx + 1, cgy);
        }

        // 3. Fill holes inside the visible area
        let filledCount = 0;
        for (let gy = minGY + 1; gy < maxGY; gy++) {
            for (let gx = minGX + 1; gx < maxGX; gx++) {
                const i = gy * w + gx;
                if (grid[i] === -1) {
                    // Case A: Enclosed Hole (Cannot reach visible boundary)
                    const isEnclosed = (outsideMap[i] === 0);
                    
                    // Case B: Aggressive Infill (3 or 4 cardinal neighbors are full)
                    // This catches inlets and dead-ends that are connected to the outside.
                    let neighborCount = 0;
                    if (grid[i - 1] !== -1) neighborCount++;
                    if (grid[i + 1] !== -1) neighborCount++;
                    if (grid[i - w] !== -1) neighborCount++;
                    if (grid[i + w] !== -1) neighborCount++;
                    
                    const isSmallGap = (neighborCount >= 3);

                    if (isEnclosed || isSmallGap) {
                        this._spawnBlock(gx - cx, gy - cy, 1, 1, layer, false, 0, true, true, true);
                        this._gridsDirty = true;
                        filledCount++;
                    }
                }
            }
        }
        if (filledCount > 0) this._log(`[AutoFill] Layer ${layer}: Filled ${filledCount} holes/gaps.`);
    }

    _connectIslands() {
        if (!this._gridsDirty && this.activeBlocks.length > 0) return;
        if (!this.logicGridW || !this.logicGridH) return;

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        const combined = this._getBuffer('combined', w * h, Int8Array);
        combined.fill(-1);

        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                const rowOff = gy * w;
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { 
                    combined[rowOff + gx] = 1; 
                }
            }
        }

        const connectedMap = this._getBuffer('connectedMap', w * h, Uint8Array);
        connectedMap.fill(0);
        const queue = this._getBuffer('queue', w * h, Int32Array);
        let head = 0, tail = 0;
        
        const startIdx = cy * w + cx;
        if (combined[startIdx] === 1) { 
            connectedMap[startIdx] = 1; 
            queue[tail++] = startIdx; 
        } else {
            // Find any mainland cell if center isn't covered
            for(let i=0; i<w*h; i++) {
                if(combined[i] === 1) {
                    connectedMap[i] = 1;
                    queue[tail++] = i;
                    break;
                }
            }
        }

        while (head < tail) {
            const idx = queue[head++];
            const gx = idx % w, gy = (idx / w) | 0;
            const neighbors = [idx - w, idx + w, idx - 1, idx + 1];
            for (let i = 0; i < 4; i++) {
                const nIdx = neighbors[i];
                if (nIdx >= 0 && nIdx < w * h && connectedMap[nIdx] === 0 && combined[nIdx] === 1) {
                    if (i === 2 && gx === 0) continue;
                    if (i === 3 && gx === w - 1) continue;
                    connectedMap[nIdx] = 1; 
                    queue[tail++] = nIdx;
                }
            }
        }

        const islands = this.activeBlocks.filter(b => {
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                const rowOff = gy * w;
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { 
                    if (connectedMap[rowOff + gx] === 1) return false; 
                }
            }
            return true;
        });

        if (islands.length === 0) return;

        // Optimized Connection: Find nearest mainland point via BFS per island
        for (const island of islands) {
            let bestIslandPt = { x: cx + island.x, y: cy + island.y };
            let bestTargetPt = null;
            
            // Per-island BFS to find nearest connectedMap === 1
            const iQueue = new Int32Array(w * h); // Local small queue if possible, but reused buffer is better
            const iVisited = new Uint8Array(w * h);
            let iHead = 0, iTail = 0;
            
            const iStartIdx = bestIslandPt.y * w + bestIslandPt.x;
            iQueue[iTail++] = iStartIdx;
            iVisited[iStartIdx] = 1;
            
            while(iHead < iTail) {
                const idx = iQueue[iHead++];
                if (connectedMap[idx] === 1) {
                    bestTargetPt = { x: idx % w, y: (idx / w) | 0 };
                    break;
                }
                
                const gx = idx % w, gy = (idx / w) | 0;
                const neighbors = [idx - w, idx + w, idx - 1, idx + 1];
                for (let i = 0; i < 4; i++) {
                    const nIdx = neighbors[i];
                    if (nIdx >= 0 && nIdx < w * h && iVisited[nIdx] === 0) {
                        if (i === 2 && gx === 0) continue;
                        if (i === 3 && gx === w - 1) continue;
                        iVisited[nIdx] = 1;
                        iQueue[iTail++] = nIdx;
                    }
                }
                if (iTail > 2000) break; // Safety break
            }

            if (bestTargetPt) {
                let curX = bestIslandPt.x, curY = bestIslandPt.y;
                while (curX !== bestTargetPt.x || curY !== bestTargetPt.y) {
                    if (curX < bestTargetPt.x) curX++; else if (curX > bestTargetPt.x) curX--;
                    else if (curY < bestTargetPt.y) curY++; else if (curY > bestTargetPt.y) curY--;
                    
                    if (combined[curY * w + curX] === -1) {
                        this._spawnBlock(curX - cx, curY - cy, 1, 1, island.layer, false, 0, true, true, true);
                        combined[curY * w + curX] = 1;
                    }
                }
            }
        }
    }

    _isCanvasFullyCovered() {
        if (this._visibleEmptyCount === -1) {
            this._updateVisibleEmptyCount();
        }
        return this._visibleEmptyCount <= 0;
    }

    _updateExpansionStatus() {
        if (this.expansionComplete) return true;
        
        if (this._isCanvasFullyCovered()) {
            this.expansionComplete = true;
            this.onExpansionComplete();
            return true;
        }
        return false;
    }

    // =========================================================
    // V2 GENERATIVE ENGINE (Ported from BlockGenerator)
    // =========================================================

    /** Registers a sub-behavior into the growth pool. */
    registerBehavior(id, fn, options = {}) {
        this.growthPool.set(id, {
            fn: fn,
            enabled: options.enabled ?? true,
            label: options.label || id
        });
    }

    /** Enables or disables a registered sub-behavior. */
    setBehaviorFlag(id, enabled) {
        const behavior = this.growthPool.get(id);
        if (behavior) behavior.enabled = enabled;
    }

    _initBehaviors() {
        const self = this;

        // Behavior 1: Main Nudge Growth (3-Step Cycle)
        this.registerBehavior('main_nudge_growth', function(s) {
            const startDelay = this.c.get('quantizedGenerateV2NudgeStartDelay') ?? 2;
            if (s.step < startDelay) return;

            const spawnChance = this.c.get('quantizedGenerateV2NudgeChance') ?? 0.8;
            if (Math.random() > spawnChance) return;

            // Execute the stateful 3-step cycle logic, now using the dynamic spawn center
            this._attemptNudgeGrowthWithParams(1, 1, 1, s.scx, s.scy);
        }, { enabled: this.c.get('quantizedGenerateV2NudgeEnabled') ?? true, label: 'Main Nudge Growth' });

        // Behavior 2: Block Spawner (Anticipatory Growth)
        this.registerBehavior('block_spawner', function(s) {
            const startDelay = this.c.get('quantizedGenerateV2BlockSpawnerStartDelay') ?? 10;
            const spawnRate  = Math.max(1, this.c.get('quantizedGenerateV2BlockSpawnerRate') ?? 4);
            if (s.step < startDelay || (s.step - startDelay) % spawnRate !== 0) return;

            const maxSpawn = this.c.get('quantizedGenerateV2BlockSpawnerCount') ?? 5;
            const layer = 1;

            // 1. Collect perimeter blocks (blocks that have at least one free neighbor)
            const perimeterBlocks = this.activeBlocks.filter(b => {
                if (b.layer !== layer) return false;
                // Check neighbors in logic grid units
                const neighbors = [
                    {x: b.x, y: b.y - 1}, {x: b.x, y: b.y + b.h}, // N, S
                    {x: b.x - 1, y: b.y}, {x: b.x + b.w, y: b.y}  // W, E
                ];
                return neighbors.some(n => !this._isOccupied(n.x, n.y, layer));
            });

            if (perimeterBlocks.length === 0) return;

            const sizes = [
                {w: 1, h: 1}, {w: 1, h: 2}, {w: 2, h: 1}, 
                {w: 1, h: 3}, {w: 3, h: 1}
            ];

            let spawnedCount = 0;
            for (let i = 0; i < maxSpawn * 2 && spawnedCount < maxSpawn; i++) {
                const parent = perimeterBlocks[Math.floor(Math.random() * perimeterBlocks.length)];
                const size = sizes[Math.floor(Math.random() * sizes.length)];
                
                // Pick a side of the parent to attach to
                const side = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
                let nx, ny;

                // "Allow slight overlap": shift the new block 1 unit into the parent's area
                // Normally, if parent is at (px, py) with size (pw, ph)
                // North: ny = py - size.h (flush). Overlap: ny = py - size.h + 1
                if (side === 'N') {
                    nx = parent.x + Math.floor(Math.random() * parent.w) - Math.floor(size.w / 2);
                    ny = parent.y - size.h + 1;
                } else if (side === 'S') {
                    nx = parent.x + Math.floor(Math.random() * parent.w) - Math.floor(size.w / 2);
                    ny = parent.y + parent.h - 1;
                } else if (side === 'W') {
                    nx = parent.x - size.w + 1;
                    ny = parent.y + Math.floor(Math.random() * parent.h) - Math.floor(size.h / 2);
                } else { // E
                    nx = parent.x + parent.w - 1;
                    ny = parent.y + Math.floor(Math.random() * parent.h) - Math.floor(size.h / 2);
                }

                if (this.checkScreenEdge(nx, ny) || this.checkScreenEdge(nx + size.w - 1, ny + size.h - 1)) continue;

                // Check occupancy (excluding the 1-unit overlap area is complex, so we just spawn if the majority is free)
                // For simplicity, we just check the "new" area not including the overlap edge if possible, 
                // but _spawnBlock handles overlaps anyway.
                this.actionBuffer.push({ layer: layer, fn: () => {
                    this._spawnBlock(nx, ny, size.w, size.h, layer, false, 0, true, true, true, false, true);
                }});
                spawnedCount++;
            }
        }, { enabled: this.c.get('quantizedGenerateV2BlockSpawnerEnabled') ?? false, label: 'Block Spawner' });

        this.registerBehavior('spreading_nudge', function(s) {
            const startDelay = this.c.get(this.configPrefix + 'SpreadingNudgeStartDelay') ?? 20;
            if (s.step < startDelay) return;

            // State Initialization
            if (!s.spreadingNudgeNextDist) {
                s.spreadingNudgeNextDist = { 'V1': 1, 'V-1': 1, 'H1': 1, 'H-1': 1 };
                s.spreadingNudgeNextSpawnStep = s.spreadingNudgeNextSpawnStep || { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
            }

            const spawnSpeed   = this.c.get(this.configPrefix + 'SpreadingNudgeSpawnSpeed') ?? 1;
            const spreadDensity = this.c.get(this.configPrefix + 'SpreadingNudgeRange') ?? 0.5;
            const growthChance  = this.c.get(this.configPrefix + 'SpreadingNudgeChance') ?? 0.8;
            const maxInstances  = this.c.get(this.configPrefix + 'SpreadingNudgeMaxInstances') ?? 20;
            const preferSymmetry = this.c.get(this.configPrefix + 'SpreadingNudgeSymmetry') ?? true;
            const targetLayer = 1;

            const arms = [
                { key: 'V1',  vert: true,  side: 1,  perp: ['E', 'W'] }, // South Axis -> Spawns E/W
                { key: 'V-1', vert: true,  side: -1, perp: ['E', 'W'] }, // North Axis -> Spawns E/W
                { key: 'H1',  vert: false, side: 1,  perp: ['N', 'S'] }, // East Axis -> Spawns N/S
                { key: 'H-1', vert: false, side: -1, perp: ['N', 'S'] }  // West Axis -> Spawns N/S
            ];

            // 1. Process Symmetry Queue
            if (s.spreadingNudgeSymmetryQueue && s.spreadingNudgeSymmetryQueue.length > 0) {
                const pending = [];
                for (const item of s.spreadingNudgeSymmetryQueue) {
                    if (s.step >= item.stepToSpawn) {
                        const strip = this._createStrip(item.layer, item.dir, item.x, item.y);
                        strip.isNudge = item.isNudge || false;
                        strip.bypassOccupancy = item.bypassOccupancy || false;
                        strip.stepPhase = Math.floor(Math.random() * 6);
                    } else {
                        pending.push(item);
                    }
                }
                s.spreadingNudgeSymmetryQueue = pending;
            }

            // 2. Perform Nudge Growth at Spreading Origins
            const bs = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2);
            const halfH = Math.floor(this.g.rows / bs.h / 2);

            // Count current active perpendicular "solid" strips for instance limiting
            let activePerpStrips = 0;
            for (const strip of this.strips.values()) {
                if (strip.active && strip.bypassOccupancy && !strip.isNudge) activePerpStrips++;
            }

            arms.sort(() => Math.random() - 0.5);

            for (const arm of arms) {
                // Check if it's time for this arm to advance
                if (s.step >= (s.spreadingNudgeNextSpawnStep[arm.key] || 0)) {
                    let d = s.spreadingNudgeNextDist[arm.key];
                    const ax = arm.vert ? s.scx : s.scx + d * arm.side;
                    const ay = arm.vert ? s.scy + d * arm.side : s.scy;

                    // Boundary check
                    if (Math.abs(ax - s.scx) > halfW || Math.abs(ay - s.scy) > halfH) {
                        // Reach edge, stop this arm
                        s.spreadingNudgeNextSpawnStep[arm.key] = Infinity;
                        continue;
                    }

                    // Axial point growth (Harden/Nudge logic at the spreader head)
                    const cycle = s.spreadingNudgeCycles[arm.key];
                    this._attemptNudgeGrowthWithParams(targetLayer, 1, 1, ax - s.scx, ay - s.scy, cycle, growthChance);

                    // Spawn perpendicular "solid" strips to fill the area
                    if (activePerpStrips < maxInstances && Math.random() < spreadDensity) {
                        for (const dir of arm.perp) {
                            if (activePerpStrips >= maxInstances) break;
                            const strip = this._createStrip(targetLayer, dir, ax, ay);
                            strip.isNudge = false; // Solid growth
                            strip.bypassOccupancy = true; // No holes, uninterrupted
                            strip.growCount = 0;
                            activePerpStrips++;

                            if (preferSymmetry) {
                                const mirX = arm.vert ? ax : s.scx - (ax - s.scx);
                                const mirY = arm.vert ? s.scy - (ay - s.scy) : ay;
                                const mirDir = dir === 'N' ? 'S' : (dir === 'S' ? 'N' : (dir === 'E' ? 'W' : 'E'));
                                s.spreadingNudgeSymmetryQueue.push({
                                    x: mirX, y: mirY, layer: targetLayer, dir: mirDir,
                                    isNudge: false, bypassOccupancy: true,
                                    stepToSpawn: s.step + 1 + Math.floor(Math.random() * 3)
                                });
                            }
                        }
                    }

                    // Move the origin outward and schedule next spawn
                    s.spreadingNudgeNextDist[arm.key]++;
                    const delay = 1 + Math.floor(Math.random() * spawnSpeed);
                    s.spreadingNudgeNextSpawnStep[arm.key] = s.step + delay;
                }
            }
        }, { enabled: this.c.get(this.configPrefix + 'SpreadingNudgeEnabled') ?? false, label: 'Spreading Nudge' });

        // ── Shove Fill ─────────────────────────────────────────────────────────
        this.registerBehavior('shove_fill', function(s) {
            const startDelay = this.c.get('quantizedGenerateV2ShoveFillStartDelay') ?? 20;
            const fillRate   = Math.max(1, this.c.get('quantizedGenerateV2ShoveFillRate') ?? 4);
            if (s.step < startDelay || (s.step - startDelay) % fillRate !== 0) return;

            const allBlocks = this.activeBlocks;
            if (allBlocks.length === 0) return;

            // Pick a direction, never repeating the previous one
            const allDirs = ['N', 'S', 'E', 'W'];
            const availDirs = allDirs.filter(d => d !== s.lastShoveFillDir);
            const dir = availDirs[Math.floor(Math.random() * availDirs.length)];
            s.lastShoveFillDir = dir;

            const bs    = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2);
            const halfH = Math.floor(this.g.rows / bs.h / 2);

            // 1–3 random lanes (columns for N/S, rows for E/W) get pushed outward by 1 block
            const laneCount = 1 + Math.floor(Math.random() * 3);

            if (dir === 'N' || dir === 'S') {
                const delta = dir === 'N' ? -1 : 1;
                const occupiedCols = [...new Set(allBlocks.map(b => b.x))];
                if (occupiedCols.length === 0) return;
                const cols = occupiedCols.sort(() => Math.random() - 0.5).slice(0, laneCount);

                for (const col of cols) {
                    // Sort outward-most first to avoid conflicts during sequential remove+respawn
                    const colBlocks = allBlocks
                        .filter(b => b.x === col)
                        .sort((a, b) => dir === 'N' ? a.y - b.y : b.y - a.y);

                    for (const block of colBlocks) {
                        const newY = block.y + delta;
                        if (newY < -(halfH + 1) || newY > halfH + 1) continue;
                        const bx = block.x, by = block.y, bw = block.w, bh = block.h, bl = block.layer;
                        this.actionBuffer.push({ layer: bl, fn: () => {
                            this._removeBlock(bx, by, bw, bh, bl, false);
                            this._spawnBlock(bx, newY, 1, 1, bl, false, 0, true, true, true, false, true);
                        }});
                    }

                    // Backfill the trailing vacancy (innermost position left empty after the shift)
                    if (colBlocks.length > 0) {
                        const last = colBlocks[colBlocks.length - 1];
                        const fillX = last.x, fillY = last.y;
                        this.actionBuffer.push({ layer: 1, fn: () => {
                            this._spawnBlock(fillX, fillY, 1, 1, 1, false, 0, true, true, true, false, true);
                        }});
                    }
                }
            } else {
                const delta = dir === 'E' ? 1 : -1;
                const occupiedRows = [...new Set(allBlocks.map(b => b.y))];
                if (occupiedRows.length === 0) return;
                const rows = occupiedRows.sort(() => Math.random() - 0.5).slice(0, laneCount);

                for (const row of rows) {
                    // Sort outward-most first to avoid conflicts during sequential remove+respawn
                    const rowBlocks = allBlocks
                        .filter(b => b.y === row)
                        .sort((a, b) => dir === 'E' ? b.x - a.x : a.x - b.x);

                    for (const block of rowBlocks) {
                        const newX = block.x + delta;
                        if (newX < -(halfW + 1) || newX > halfW + 1) continue;
                        const bx = block.x, by = block.y, bw = block.w, bh = block.h, bl = block.layer;
                        this.actionBuffer.push({ layer: bl, fn: () => {
                            this._removeBlock(bx, by, bw, bh, bl, false);
                            this._spawnBlock(newX, by, 1, 1, bl, false, 0, true, true, true, false, true);
                        }});
                    }

                    // Backfill the trailing vacancy (innermost position left empty after the shift)
                    if (rowBlocks.length > 0) {
                        const last = rowBlocks[rowBlocks.length - 1];
                        const fillX = last.x, fillY = last.y;
                        this.actionBuffer.push({ layer: 1, fn: () => {
                            this._spawnBlock(fillX, fillY, 1, 1, 1, false, 0, true, true, true, false, true);
                        }});
                    }
                }
            }
        }, { enabled: this.c.get('quantizedGenerateV2ShoveFillEnabled') ?? false, label: 'Shove Fill' });
    }

    _pickLayerDirs(count) {
        if (count >= 4) return null;
        const all = ['N', 'S', 'E', 'W'];
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        return new Set(shuffled.slice(0, Math.max(1, count)));
    }

    _getAllowedDirs(layer) {
        if (layer >= 2) return null; 
        const dirs = this.behaviorState?.layerDirs;
        if (!dirs) return null;
        return dirs[layer] ?? null;
    }

    _tickLayerDirs(s) {
        const quadrantCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);
        if (!s.layerDirs) return;
        if (!s.layerDirLife) s.layerDirLife = {};
        if (quadrantCount >= 4) {
            for (const layer in s.layerDirs) {
                const l = parseInt(layer);
                if (l >= 2) continue;
                if (s.layerDirs[layer] !== null) {
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[layer] = null; } });
                }
            }
            return;
        }
        for (const layer in s.layerDirs) {
            if (parseInt(layer) >= 2) continue;
            s.layerDirLife[layer] = (s.layerDirLife[layer] ?? 1) - 1;
            if (s.layerDirLife[layer] <= 0) {
                const newDirs = this._pickLayerDirs(quadrantCount);
                const l = parseInt(layer);
                this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = newDirs; } });
                s.layerDirLife[layer] = 4 + Math.floor(Math.random() * 4);
            }
        }
    }

    _generateRandomPattern() {
        const arr = [true, true, true, false, false, false];
        for (let i = 5; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    _generateDistinctPattern(existing) {
        let attempt;
        do { attempt = this._generateRandomPattern(); } while (attempt.join() === existing.join());
        return attempt;
    }

    _getStepPattern() { return this.behaviorState.pattern || [true, false, false, true, true, false]; }
    _getPausePattern() { return this.behaviorState.pausePattern || [true, true, false, true, false, false]; }

    _generateSeedSchedule(scx, scy) {
        const schedule = {};
        const dirs = ['N', 'S', 'E', 'W'];
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;

        // Compute per-direction boost based on canvas aspect ratio
        const baseBoost = this.c.get('quantizedGenerateV2SpineBoost') ?? 4;
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const aspect = visW / visH;
        const hBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(aspect)));
        const vBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(1 / aspect)));
        const dirBoost = { N: vBoost, S: vBoost, E: hBoost, W: hBoost };

        const addToSchedule = (layer, dir, stepPool) => {
            const step = stepPool[Math.floor(Math.random() * stepPool.length)];
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer: Math.max(minL, layer), dir, originX: scx, originY: scy, boost: dirBoost[dir] });
        };

        const maxLayer = this._getMaxLayer();
        if (maxLayer >= 1) {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(1, d, [0, 1, 2]));
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(minL, d, [3, 4, 5]));
        } else {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(minL, d, [0, 1, 2, 3, 4, 5]));
        }
        return schedule;
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        const globalBoost = this.c.get('quantizedGenerateV2SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY, boost } of scheduled) {
            this.actionBuffer.push({ layer, fn: () => {
                const strip = this._createStrip(layer, dir, originX, originY);
                strip.isSpine = true;
                strip.boostSteps = boost ?? globalBoost;
            }});
        }
    }

    _deactivateStrip(strip) { strip.active = false; this.strips.delete(strip.id); }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = {
            id, layer, direction: dir, originX, originY, headX: originX, headY: originY,
            pattern: this._getStepPattern(), pausePattern: this._getPausePattern(),
            stepPhase: 0, growCount: 0, paused: false, active: true, blockIds: []
        };
        this.strips.set(id, strip);
        return strip;
    }

    _tickStrips(s) {
        const allowAsymmetry = !!this.c.get('quantizedGenerateV2AllowAsymmetry');
        if (allowAsymmetry) {
            if (!s.deferredCols) s.deferredCols = new Map();
            if (!s.deferredRows) s.deferredRows = new Map();
            for (const [col, ticks] of s.deferredCols.entries()) {
                if (ticks <= 1) s.deferredCols.delete(col); else s.deferredCols.set(col, ticks - 1);
            }
            for (const [row, ticks] of s.deferredRows.entries()) {
                if (ticks <= 1) s.deferredRows.delete(row); else s.deferredRows.set(row, ticks - 1);
            }
            if (Math.random() < 0.2) {
                const bs = this.getBlockSize();
                const halfW = Math.floor(this.g.cols / bs.w / 2);
                const halfH = Math.floor(this.g.rows / bs.h / 2);
                const isCol = Math.random() < 0.5;
                if (isCol) {
                    const colOffset = Math.floor((Math.random() * 2 - 1) * (halfW + 5));
                    s.deferredCols.set(s.scx + colOffset, 1 + Math.floor(Math.random() * 2));
                } else {
                    const rowOffset = Math.floor((Math.random() * 2 - 1) * (halfH + 5));
                    s.deferredRows.set(s.scy + rowOffset, 1 + Math.floor(Math.random() * 2));
                }
            }
        }
        const gridCX = Math.floor(this.logicGridW / 2);
        const gridCY = Math.floor(this.logicGridH / 2);
        s.allowNudges = !!this.c.get('quantizedGenerateV2L3AllowNudges');
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;
            if (allowAsymmetry && strip.layer < 2) {
                if (s.deferredCols?.has(strip.headX) || s.deferredRows?.has(strip.headY)) continue;
            }
            
            // INDEPENDENCE FIX: Removed the 'headOnBlock' requirement. 
            // Strips should continue their path even if the underlying block was removed or shifted,
            // as they "carry" their own state and will simply add new blocks as they go.
            
            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                strip.pattern = this._generateRandomPattern();
                strip.pausePattern = this._generateDistinctPattern(strip.pattern);
            }
            let shouldGrow;
            if (strip.boostSteps > 0) { shouldGrow = true; strip.boostSteps--; }
            else {
                const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                shouldGrow = pattern[strip.stepPhase];
            }
            if (shouldGrow) {
                this.actionBuffer.push({ layer: strip.layer, isSpine: !!strip.isSpine, fn: () => this._growStrip(strip, s) });
            }
            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _dirDelta(dir) {
        switch (dir) {
            case 'N': return [0, -1]; case 'S': return [0, 1];
            case 'E': return [1, 0]; case 'W': return [-1, 0];
        }
        return [0, 0];
    }

    _calcBlockSize(strip, fillRatio) {
        const fillThreshold = this.c.get('quantizedGenerateV2FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };
        const maxScale = this.c.get('quantizedGenerateV2MaxBlockScale') ?? 3;
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const halfW = Math.floor(visW / 2);
        const halfH = Math.floor(visH / 2);
        const ox = strip.originX, oy = strip.originY, dir = strip.direction;
        let distFactor, axisRatio;
        if (dir === 'N') { distFactor = halfH > 0 ? (oy + halfH) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'S') { distFactor = halfH > 0 ? (halfH - oy) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'E') { distFactor = halfW > 0 ? (halfW - ox) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        else { distFactor = halfW > 0 ? (ox + halfW) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        distFactor = Math.max(0, Math.min(2, distFactor));
        const size = Math.min(maxScale, Math.max(1, Math.round(distFactor * axisRatio)));
        return (dir === 'N' || dir === 'S') ? { bw: 1, bh: size } : { bw: size, bh: 1 };
    }

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);
        
        // Force 1×1 on the very first growth step so new strips always begin with a single block.
        // Otherwise, use _calcBlockSize to adhere to size scaling settings.
        let { bw, bh } = (strip.growCount === 0) ? { bw: 1, bh: 1 } : this._calcBlockSize(strip, s.fillRatio);
        
        const newHeadX = strip.headX + dx * bw, newHeadY = strip.headY + dy * bh;
        if (this.checkScreenEdge(newHeadX, newHeadY)) { this._deactivateStrip(strip); return; }
        const spawnX = dx > 0 ? strip.headX + 1 : (dx < 0 ? newHeadX : strip.headX);
        const spawnY = dy > 0 ? strip.headY + 1 : (dy < 0 ? newHeadY : strip.headY);

        const canPassThrough = (strip.isNudge || strip.layer === 1 || strip.bypassOccupancy);

        if (strip.isNudge) {
            // Use _nudge for actual nudge growth effect
            const success = this._nudge(spawnX, spawnY, bw, bh, strip.direction, strip.layer, strip.layer === 0);
            if (success || canPassThrough) {
                strip.blockIds.push(null);
                strip.headX = newHeadX;
                strip.headY = newHeadY;
                strip.growCount++;
                this._gridsDirty = true;
            }
        } else {
            // Check occupancy for standard growth unless it's layer 1 or bypassing
            if (canPassThrough || (!this._isOccupied(spawnX, spawnY, 0) && !this._isOccupied(spawnX, spawnY, 1))) {
                const id = this._spawnBlock(spawnX, spawnY, bw, bh, strip.layer, strip.bypassOccupancy || false, 0, true, true, true, false, true);
                if (id !== -1 || canPassThrough) {
                    strip.blockIds.push(id === -1 ? null : id);
                    strip.headX = newHeadX;
                    strip.headY = newHeadY;
                    strip.growCount++;
                    this._gridsDirty = true;
                }
            }
        }
    }

    _updateFillRatio(s) {
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w)), visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);
        const totalCells = visW * visH;
        let filledCells = 0;
        for (const b of this.activeBlocks) {
            const bx1 = Math.max(-halfW, b.x), bx2 = Math.min(halfW - 1, b.x + b.w - 1);
            const by1 = Math.max(-halfH, b.y), by2 = Math.min(halfH - 1, b.y + b.h - 1);
            if (bx2 >= bx1 && by2 >= by1) filledCells += (bx2 - bx1 + 1) * (by2 - by1 + 1);
        }
        s.fillRatio = Math.min(1, filledCells / totalCells);
        this.behaviorState.fillRatio = s.fillRatio;
    }

    _expandInsideOut(s) {
        if (!this.c.get('quantizedGenerateV2InsideOutEnabled')) return;
        const delay = this.c.get('quantizedGenerateV2InsideOutDelay') ?? 6, period = Math.max(1, this.c.get('quantizedGenerateV2InsideOutPeriod') ?? 3);
        if (s.step < delay || (s.step - delay) % period !== 0) return;

        const genScaling = !!this.c.get('quantizedGenerateV2GenerativeScaling');
        const bs = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2), halfH = Math.floor(this.g.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = this._getMaxLayer();
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;
        const endL = Math.min(1, maxLayer);

        // Per-arm wave counters — ignore asymmetry, all arms start at Wave 1
        if (!s.insideOutArmWaves) {
            s.insideOutArmWaves = { 'N': 1, 'S': 1, 'E': 1, 'W': 1 };
        }

        const maxWave = Math.max(s.insideOutArmWaves['N'], s.insideOutArmWaves['S'], s.insideOutArmWaves['E'], s.insideOutArmWaves['W']);
        if (maxWave > halfW + edgeBuf && maxWave > halfH + edgeBuf) return;

        // Helper: Check if previous wave on this arm has placed at least one block
        const prevWaveStarted = (arm, wave) => {
            if (wave <= 1) return true;
            for (const strip of this.strips.values()) {
                if (strip.isExpansion && strip.arm === arm && strip.wave === wave - 1) {
                    if (strip.growCount > 0) return true;
                }
            }
            return false;
        };

        const armsToIncrement = new Set();
        for (let l = minL; l <= endL; l++) {
            const allowed = this._getAllowedDirs(l);

            for (const arm of ['N', 'S', 'E', 'W']) {
                const wave = s.insideOutArmWaves[arm];
                const [dx, dy] = this._dirDelta(arm);
                const ox = s.scx + dx * wave, oy = s.scy + dy * wave;

                // 1. Quadrant Restriction: Only X quadrants updated at a time.
                // If count < 4, only allow arms currently in the rotation.
                if (allowed && !allowed.has(arm)) continue;

                // 2. Progression Check: Don't spawn wave N until wave N-1 has actually started growing
                if (!prevWaveStarted(arm, wave)) continue;

                // INDEPENDENCE FIX: Removed Spine Gating.
                // Expansion should proceed based on wave progression even if the 'axis' block 
                // was removed or shifted by another behavior.

                // 4. Boundary Check
                if (Math.abs(ox - s.scx) > halfW + edgeBuf || Math.abs(oy - s.scy) > halfH + edgeBuf) continue;

                // 5. Generative Scaling: Limit density by capping active expansion strips
                if (genScaling) {
                    let activeExp = 0;
                    for (const st of this.strips.values()) if (st.isExpansion && st.active) activeExp++;
                    if (activeExp > (8 * (l + 1))) continue; 
                }

                // If all checks pass, spawn the perpendicular strips
                const perp1 = (arm === 'N' || arm === 'S') ? 'E' : 'N';
                const perp2 = (arm === 'N' || arm === 'S') ? 'W' : 'S';

                this.actionBuffer.push({ layer: l, fn: () => {
                    const s1 = this._createStrip(l, perp1, ox, oy);
                    s1.isExpansion = true; s1.arm = arm; s1.wave = wave;
                    const s2 = this._createStrip(l, perp2, ox, oy);
                    s2.isExpansion = true; s2.arm = arm; s2.wave = wave;
                }});

                armsToIncrement.add(arm);
            }
        }

        for (const arm of armsToIncrement) s.insideOutArmWaves[arm]++;
        s.insideOutWave++;
    }

    _processIntents() {
        for (const intent of this.actionBuffer) {
            if (!this.actionQueues.has(intent.layer)) this.actionQueues.set(intent.layer, []);
            this.actionQueues.get(intent.layer).push(intent);
        }
        this.actionBuffer = [];
        for (const [layer, queue] of this.actionQueues.entries()) {
            while (queue.length > 0) { const intent = queue.shift(); if (intent && intent.fn) intent.fn(); }
        }
    }

    checkScreenEdge(bx, by) {
        const bs = this.getBlockSize();
        const halfVisibleW = Math.floor(this.g.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.g.rows / bs.h / 2);
        const extension = 2;
        const limitW = halfVisibleW + extension;
        const limitH = halfVisibleH + extension;

        const edges = {
            left: bx <= -limitW,
            right: bx >= limitW,
            top: by <= -limitH,
            bottom: by >= limitH
        };

        return (edges.left || edges.right || edges.top || edges.bottom) ? edges : false;
    }

    _updateLayerMaxDist(s) {
        if (!s.layerMaxDist) s.layerMaxDist = {};
        const scx = s.scx || 0, scy = s.scy || 0;

        // Reset for 0 and 1 only
        s.layerMaxDist[0] = { N: 0, S: 0, E: 0, W: 0 };
        s.layerMaxDist[1] = { N: 0, S: 0, E: 0, W: 0 };

        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const l = b.layer;
            if (l > 1) continue;
            
            const md = s.layerMaxDist[l];
            const rx = b.x - scx, ry = b.y - scy;

            if (ry < 0) md.N = Math.max(md.N, -ry);
            if (ry + b.h - 1 > 0) md.S = Math.max(md.S, ry + b.h - 1);
            if (rx < 0) md.W = Math.max(md.W, -rx);
            if (rx + b.w - 1 > 0) md.E = Math.max(md.E, rx + b.w - 1);
        }
    }

    _attemptV2Growth() {
        if (this.expansionComplete && !this.manualStep) return;
        
        // Ensure sub-layers (especially discovery layer 1) are synced with foundation (layer 0)
        this._syncSubLayers();
        
        const s = this.behaviorState;
        this._updateLayerMaxDist(s);

        if (s.pendingDeletions && s.pendingDeletions.length > 0) {
            for (const d of s.pendingDeletions) this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
            s.pendingDeletions = [];
        }
        if (!s.seedSchedule) {
            s.pattern = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            if (!s.layerDirs) {
                const qCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);
                const qMaxLayer = this._getMaxLayer();
                const qBaseLife = 4 + Math.floor(Math.random() * 3);
                const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
                const minL = usePromotion ? 1 : 0;

                s.layerDirs = {}; s.layerDirLife = {};
                for (let l = minL; l <= qMaxLayer + 1; l++) { 
                    s.layerDirs[l] = this._pickLayerDirs(qCount); 
                    s.layerDirLife[l] = qBaseLife + l; 
                }
            }
            s.seedSchedule = this._generateSeedSchedule(s.scx ?? 0, s.scy ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }
        if (this.activeBlocks.length === 0) {
            const ox = s.scx ?? 0, oy = s.scy ?? 0;
            const maxLayer = this._getMaxLayer();
            const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('LayerPromotionEnabled') || this.getConfig('SingleLayerMode'));
            for (let l = 0; l <= maxLayer; l++) {
                if (usePromotion && l !== 1) continue;
                this._spawnBlock(ox, oy, 1, 1, l, false, 0, true, true, true, false, true);
            }
        }
        s.growTimer++;
        this.actionBuffer = [];
        this._tickLayerDirs(s);
        this._updateFillRatio(s);
        this._seedStrips(s);
        this._tickStrips(s);
        this._expandInsideOut(s);
        for (const behavior of this.growthPool.values()) if (behavior.fn && behavior.enabled) behavior.fn.call(this, s);
        this._processIntents();
        s.step++;
        this._updateRenderGridLogic();
        if (s.fillRatio > 0.98 && this.strips.size === 0) this.expansionComplete = true;
    }

    _isOccupied(x, y, layer) {
        const gridCX = Math.floor(this.logicGridW / 2), gridCY = Math.floor(this.logicGridH / 2);
        const gx = gridCX + x, gy = gridCY + y;
        if (gx < 0 || gx >= this.logicGridW || gy < 0 || gy >= this.logicGridH) return false;
        const grid = this.layerGrids[layer];
        return !!grid && grid[gy * this.logicGridW + gx] !== -1;
    }

    _isUnderLayer(b, layer) {
        const gridCX = Math.floor(this.logicGridW / 2), gridCY = Math.floor(this.logicGridH / 2);
        const gx1 = gridCX + b.x, gy1 = gridCY + b.y, gx2 = gridCX + b.x + b.w - 1, gy2 = gridCY + b.y + b.h - 1;
        const grid = this.layerGrids[layer];
        if (!grid) return false;
        for (let gy = gy1; gy <= gy2; gy++) {
            for (let gx = gx1; gx <= gx2; gx++) {
                if (gy >= 0 && gy < this.logicGridH && gx >= 0 && gx < this.logicGridW) {
                    if (grid[gy * this.logicGridW + gx] !== -1) return true;
                }
            }
        }
        return false;
    }

    _removeBlock(x, y, w, h, layer, fade = true) {
        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        this.maskOps.push({ type: 'removeBlock', x1, y1, x2, y2, layer: layer, startFrame: this.animFrame, fade: fade });
        this.activeBlocks = this.activeBlocks.filter(b => !(b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h));
        this._writeToGrid(x, y, w, h, -1, layer);
        this._gridsDirty = true; this._maskDirty = true;
    }

    onExpansionComplete() {
        this._log(`[${this.name}] Expansion complete: canvas covered.`);
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
        this.shadowGrid = null;
        this.shadowSim = null;
    }

}
console.log('QuantizedBaseEffect loaded');
