/**
 * QuantizedBaseEffect.js - Version 8.5.1
 */
class QuantizedBaseEffect extends AbstractEffect {
    static sharedRenderer = null;
    static sharedCharCache = new Map();
    static lastGridSeed = -1;
    static _preallocated = false;
    static sharedCanvases = {
        mask: null,
        scratch: null,
        gridCache: null,
        perimeterMask: null,
        lineMask: null,
        echo: null
    };
    static sharedBuffers = {
        renderGrid: null,
        logicGrid: null,
        shadowRevealGrid: null,
        layerGrids: [],
        removalGrids: [],
        layerInvisibleGrids: [],
        establishedMasksPool: null,
        tempInt32: null,
        tempInt8: null,
        tempRem: null,
        dirtyRects: [],
        totalBlocks: 0
    };

    constructor(g, c, r) {
        super(g, c, r);
        this.configPrefix = "quantizedPulse"; 
        
        // Components
        this.sequenceManager = new QuantizedSequence();
        this.shadowController = new QuantizedShadow();
        
        if (!QuantizedBaseEffect.sharedRenderer) {
            QuantizedBaseEffect.sharedRenderer = new QuantizedRenderer();
        }
        this.renderer = QuantizedBaseEffect.sharedRenderer;

        // Sequence State
        this.sequence = [[]];
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Grid State (Shared)
        this.logicGridW = 0;
        this.logicGridH = 0;
        this._gridCX = 0;
        this._gridCY = 0;
        this.perimeterHistory = []; // Capture history for Perimeter Echo        
        // Debug/Editor State
        this.debugMode = false;
        this.manualStep = false;
        this.editorHighlight = false;
        this._boundDebugHandler = this._handleDebugInput.bind(this);
        
        // Render Cache (Shared Buffers)
        this.maskCanvas = null;
        this.maskCtx = null;
        this.scratchCanvas = null;
        this.scratchCtx = null;
        this.gridCacheCanvas = null;
        this.gridCacheCtx = null;
        this.perimeterMaskCanvas = null;
        this.perimeterMaskCtx = null;
        this.lineMaskCanvas = null;
        this.lineMaskCtx = null;
        this.echoCanvas = null;
        this.echoCtx = null;
        this._maskDirty = true;
        this.layout = null;

        this._outsideMap = null;
        this._outsideMapWidth = 0;
        this._outsideMapHeight = 0;
        this._outsideMapDirty = true;
        this._gridCacheDirty = true;
        
        // Logic Grid Scaling
        this.logicScale = 1.2;
        
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
        this.activeIndices = new Set();
        this.unfoldSequences = [[], []];
        this.visibleLayers = [true, true];
        this.layerOrder = [0, 1, 0, 1];
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

        // Deferred init flags — spread heavy work across frames to reduce GC pressure
        this._pendingGridClear = false;
        this._behaviorsInitialized = false;

        // Proxy properties to shared buffers
        Object.defineProperties(this, {
            renderGrid: { get: () => QuantizedBaseEffect.sharedBuffers.renderGrid, set: (v) => { QuantizedBaseEffect.sharedBuffers.renderGrid = v; } },
            logicGrid: { get: () => QuantizedBaseEffect.sharedBuffers.logicGrid, set: (v) => { QuantizedBaseEffect.sharedBuffers.logicGrid = v; } },
            shadowRevealGrid: { get: () => QuantizedBaseEffect.sharedBuffers.shadowRevealGrid, set: (v) => { QuantizedBaseEffect.sharedBuffers.shadowRevealGrid = v; } },
            layerGrids: { get: () => QuantizedBaseEffect.sharedBuffers.layerGrids },
            removalGrids: { get: () => QuantizedBaseEffect.sharedBuffers.removalGrids },
            layerInvisibleGrids: { get: () => QuantizedBaseEffect.sharedBuffers.layerInvisibleGrids },
            _establishedMasksPool: { get: () => QuantizedBaseEffect.sharedBuffers.establishedMasksPool, set: (v) => { QuantizedBaseEffect.sharedBuffers.establishedMasksPool = v; } }
        });

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
            genOriginX: 0,
            genOriginY: 0,
            hitEdge: { N: false, S: false, E: false, W: false },
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
        this._syncFrame = -1;
        this._lastSyncOpCount = -1;
        this._currentStepActions = [];
        
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


    _getGenConfig(keySuffix) {
        const val = this.getConfig(keySuffix);
        if (val !== null && val !== undefined && val !== "") return val;
        
        if (this.configPrefix !== 'quantizedGenerateV2') {
            const genKey = 'quantizedGenerateV2' + keySuffix;
            const genVal = this.c.state[genKey];
            if (genVal !== undefined && genVal !== null && genVal !== "") return genVal;
        }
        
        return null;
    }

    getConfig(keySuffix) {
        // Prevent infinite recursion if getConfig('TriggerBrightnessSwell') calls getConfig internally
        if (keySuffix === 'FadeInFrames' && !this._inGetConfigSwellCheck) {
            this._inGetConfigSwellCheck = true;
            if (this.getConfig('TriggerBrightnessSwell')) {
                const fadeOutFrames = this.getConfig('FadeFrames') || 0;
                this._inGetConfigSwellCheck = false;
                return fadeOutFrames * 2;
            }
            this._inGetConfigSwellCheck = false;
        }

        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettingIds.has(keySuffix);

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
        maxLayer = Math.min(maxLayer, 1);
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        if (usePromotion && (maxLayer === undefined || maxLayer === null || maxLayer < 1)) return 1;
        return maxLayer;
    }

    getLineGfxValue(suffix) {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettingIds.has('LineGfx' + suffix);

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

    getInnerLineGfxValue(suffix) {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettingIds.has('InnerLineGfx' + suffix);

        const key = this.configPrefix + 'InnerLineGfx' + suffix;
        const val = this.c.state[key];

        // 1. If we are NOT overriding, AND this is an inheritable setting, use the default.
        if (!overrideDefaults && isInheritable) {
            const defaultKey = 'quantizedDefaultInnerLineGfx' + suffix;
            const defaultVal = this.c.state[defaultKey];
            if (defaultVal !== undefined && defaultVal !== null) return defaultVal;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        return (val !== undefined && val !== null && val !== "") ? val : null;
    }

    getEchoGfxValue(suffix) {
        const overrideDefaults = this.c.state[this.configPrefix + 'OverrideDefaults'];
        const isInheritable = QuantizedInheritableSettingIds.has('EchoGfx' + suffix);

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

    _getCharFromCache(charStr, s, d) {
        const cache = QuantizedBaseEffect.sharedCharCache;
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight || 'normal';
        const family = s.fontFamily || 'monospace';
        const fontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        
        const key = `${charStr}|${family}|${fontSize}|${weight}|${style}`;
        if (cache.has(key)) return cache.get(key);
        
        const canvas = document.createElement('canvas');
        const padding = 10;
        canvas.width = Math.ceil(d.cellWidth + padding * 2);
        canvas.height = Math.ceil(d.cellHeight + padding * 2);
        const ctx = canvas.getContext('2d');
        
        ctx.font = `${style}${weight} ${fontSize}px ${family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(charStr, canvas.width / 2, canvas.height / 2);
        
        cache.set(key, canvas);
        return canvas;
    }

    get lastGridSeed() { return QuantizedBaseEffect.lastGridSeed; }
    set lastGridSeed(val) { QuantizedBaseEffect.lastGridSeed = val; }

    getBlockSize() {
        // Per-frame cache: avoids repeated state lookups (called 20+ times per frame)
        if (this._cachedBlockSizeFrame === this.animFrame && this._cachedBlockSize) {
            return this._cachedBlockSize;
        }
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
        if (!this._cachedBlockSize) this._cachedBlockSize = { w: 4, h: 4 };
        this._cachedBlockSize.w = w || 4;
        this._cachedBlockSize.h = h || 4;
        this._cachedBlockSizeFrame = this.animFrame;
        return this._cachedBlockSize;
    }

    preallocate() {
        if (!this.g || !this.g.cols) return;
        let startTime = 0;
        const logEnabled = this.c.state.logErrors;
        if (logEnabled) startTime = performance.now();
        
        // Static lock: only preallocate the shared resources ONCE
        if (QuantizedBaseEffect._preallocated) {
            if (logEnabled) console.log(`[QuantizedBaseEffect] preallocate skipped (already done)`);
            return;
        }
        QuantizedBaseEffect._preallocated = true;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const s = this.c.state;
        const d = this.c.derived;

        // 1. Initialize Grid Dimensions
        this._initLogicGrid();
        this._ensureCanvases(w, h);
        
        // 2. Force Allocation of Shared Memory Pool (Logic Grids)
        // This moves ~120 million memory operations to the startup sequence.
        this._updateRenderGridLogic();

        // 3. Force Allocation of Shadow World Buffers
        // This moves another ~30 million memory operations to startup.
        if (this.shadowController) {
            this.shadowController.initShadowWorldBase(this);
        }

        // 4. Pre-warm GlyphAtlas (font texture)
        if (typeof GlyphAtlas !== 'undefined') {
            if (!QuantizedBaseEffect.sharedAtlas) {
                QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c);
            }
            QuantizedBaseEffect.sharedAtlas.update();
        }

        // 5. Warm up layout (needed for grid cache in both modes)
        this.renderer._computeLayoutOnly(this, w, h, s, d);

        // 6. Warm up Grid Cache (needed in both modes — WebGL uploads it as a GPU texture)
        this._updateGridCache(w, h, s, d);

        // 7. Warm up Renderer Buffers (GPU)
        if (this.r && this.r.r && typeof this.r.r.preallocate === 'function') {
            this.r.r.preallocate(this.logicGridW, this.logicGridH, this.gridCacheCanvas);
        }

        if (logEnabled) {
            const endTime = performance.now();
            console.log(`[QuantizedBaseEffect] preallocate took ${(endTime - startTime).toFixed(2)}ms`);
        }
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
        
        const totalBlocks = blocksX * blocksY;
        
        // Optimization: new typed arrays are already zero-initialized by the engine.
        // Skip redundant .fill(0) on fresh allocations. Only fill on reuse.
        let isNewAlloc = false;

        if (!this.logicGrid || this.logicGrid.length !== totalBlocks) {
            this.logicGrid = new Uint8Array(totalBlocks); // zero-initialized
            isNewAlloc = true;
        } else {
            this.logicGrid.fill(0);
        }
        this.logicGridW = blocksX;
        this.logicGridH = blocksY;
        // Cache center offsets to avoid repeated Math.floor in _isOccupied (called 100s of times/step)
        this._gridCX = Math.floor(blocksX / 2);
        this._gridCY = Math.floor(blocksY / 2);
        this._gridsDirty = true;

        if (!this.renderGrid || this.renderGrid.length !== totalBlocks) {
            this.renderGrid = new Int32Array(totalBlocks); // zero-initialized
            // Must fill -1 even on new alloc since default is 0, not -1
        }
        this.renderGrid.fill(-1);


        if (!this.shadowRevealGrid || this.shadowRevealGrid.length !== totalBlocks) {
            this.shadowRevealGrid = new Uint8Array(totalBlocks); // zero-initialized, skip fill
        } else {
            this.shadowRevealGrid.fill(0);
        }

        for (let i = 0; i < 2; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== totalBlocks) {
                this.layerGrids[i] = new Int32Array(totalBlocks);
            }
            this.layerGrids[i].fill(-1);

            if (!this.removalGrids[i] || this.removalGrids[i].length !== totalBlocks) {
                this.removalGrids[i] = new Int32Array(totalBlocks);
            }
            this.removalGrids[i].fill(-1);
        }

        // Initialize coverage counter
        // O(1) Optimization: Pre-calculate coverage based on dimensions instead of scanning
        // millions of empty cells.
        this._calculateInitialCoverage();
    }

    _calculateInitialCoverage() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;
        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(w, h, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);

        // Since renderGrid was just filled with -1, all visible blocks are empty.
        const totalVisible = (endX - startX) * (endY - startY);
        this._visibleEmptyCount = totalVisible;
        if (!this._lastCoverageRect) this._lastCoverageRect = { startX: 0, endX: 0, startY: 0, endY: 0 };
        this._lastCoverageRect.startX = startX; this._lastCoverageRect.endX = endX;
        this._lastCoverageRect.startY = startY; this._lastCoverageRect.endY = endY;
        this._visibleFillRatio = 0;
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
        if (!this._lastCoverageRect) this._lastCoverageRect = { startX: 0, endX: 0, startY: 0, endY: 0 };
        this._lastCoverageRect.startX = startX; this._lastCoverageRect.endX = endX;
        this._lastCoverageRect.startY = startY; this._lastCoverageRect.endY = endY;
        this._updateVisibleFillRatio();
    }

    _updateVisibleFillRatio() {
        const r = this._lastCoverageRect;
        if (!r || this._visibleEmptyCount === -1) {
            this._visibleFillRatio = 0;
            return;
        }
        const totalVisible = (r.endX - r.startX) * (r.endY - r.startY);
        if (totalVisible <= 0) {
            this._visibleFillRatio = 0;
        } else {
            const occupied = totalVisible - this._visibleEmptyCount;
            this._visibleFillRatio = occupied / totalVisible;
        }
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

        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;
        const getDist = (b) => Math.abs(b.x - ox) + Math.abs(b.y - oy);

        if (anchors.length <= sampleSize) {
            return anchors.sort((a, b) => getDist(a) - getDist(b));
        }

        const sample = [];
        for (let i = 0; i < sampleSize; i++) {
            sample.push(anchors[Math.floor(Math.random() * anchors.length)]);
        }
        return sample.sort((a, b) => getDist(a) - getDist(b));
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
        this.actionBuffer.length = 0;
        this.actionQueues.clear();
        this.sequence = [[]];

        // Replace behaviorState with a fresh object to guarantee no stale
        // dynamic fields survive between triggers.  A plain object with ~12
        // primitive properties is trivially cheap for the GC — the expensive
        // items (Maps, Sets, large arrays) were the original concern and those
        // are already reused via .clear() / .length = 0 elsewhere.
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            snapshots: [],
            lastActionTime: 0,
            fillRatio: 0,
            scx: 0,
            scy: 0,
            genOriginX: 0,
            genOriginY: 0,
            hitEdge: { N: false, S: false, E: false, W: false },
            insideOutWave: 1,
            deferredCols: new Map(),
            deferredRows: new Map(),
            seedSchedule: null,
            ribOrigins: new Set(),
            pendingDeletions: [],
            pendingExpansions: [],
            spreadingNudgeSymmetryQueue: []
        };

        this._initBehaviors();
    }

    /**
     * Deferred grid overlay clearing — runs on first update() frame instead of
     * blocking the trigger event handler. Effect is invisible (alpha=0) so this
     * is visually seamless.
     */
    _executeDeferredGridClear() {
        this._pendingGridClear = false;
        if (!this.g) return;

        this.g.clearAllOverrides();
        this.g.clearAllEffects();

        const g = this.g;
        if (this._savedActiveIndices && this._savedActiveIndices.size > 0) {
            // Hoist null checks outside the loop — these don't change per-iteration
            const eA = g.effectActive, eAl = g.effectAlphas, eCh = g.effectChars, eCo = g.effectColors, eG = g.effectGlows;
            const oC = g.overrideChars, oCo = g.overrideColors, oA = g.overrideAlphas, oG = g.overrideGlows, oM = g.overrideMix;
            const sA = g.secondaryActive, sCh = g.secondaryChars, sCo = g.secondaryColors, sAl = g.secondaryAlphas, sG = g.secondaryGlows;
            const mx = g.mix;
            for (const i of this._savedActiveIndices) {
                if (eA) eA[i] = 0; if (eAl) eAl[i] = 0; if (eCh) eCh[i] = 0; if (eCo) eCo[i] = 0; if (eG) eG[i] = 0;
                if (oC) oC[i] = 0; if (oCo) oCo[i] = 0; if (oA) oA[i] = 0; if (oG) oG[i] = 0; if (oM) oM[i] = 0;
                if (sA) sA[i] = 0; if (sCh) sCh[i] = 0; if (sCo) sCo[i] = 0; if (sAl) sAl[i] = 0; if (sG) sG[i] = 0;
                if (mx) mx[i] = 0;
            }
            this._savedActiveIndices = null;
        } else if (this._savedActiveBlocks && this._savedActiveBlocks.length > 0) {
            const bs = this.getBlockSize();
            const cpX = bs.w;
            const cpY = bs.h;

            // Hoist null checks outside the loop
            const eA = g.effectActive, eAl = g.effectAlphas, eCh = g.effectChars, eCo = g.effectColors, eG = g.effectGlows;
            const oC = g.overrideChars, oCo = g.overrideColors, oA = g.overrideAlphas, oG = g.overrideGlows, oM = g.overrideMix;
            const sA = g.secondaryActive, sCh = g.secondaryChars, sCo = g.secondaryColors, sAl = g.secondaryAlphas, sG = g.secondaryGlows;
            const mx = g.mix;
            for (const b of this._savedActiveBlocks) {
                const x1 = Math.max(0, Math.round(b.x * cpX));
                const y1 = Math.max(0, Math.round(b.y * cpY));
                const x2 = Math.min(g.cols, x1 + Math.round(b.w * cpX));
                const y2 = Math.min(g.rows, y1 + Math.round(b.h * cpY));

                for (let cy = y1; cy < y2; cy++) {
                    const rowOff = cy * g.cols;
                    for (let cx = x1; cx < x2; cx++) {
                        const i = rowOff + cx;
                        if (eA) eA[i] = 0; if (eAl) eAl[i] = 0; if (eCh) eCh[i] = 0; if (eCo) eCo[i] = 0; if (eG) eG[i] = 0;
                        if (oC) oC[i] = 0; if (oCo) oCo[i] = 0; if (oA) oA[i] = 0; if (oG) oG[i] = 0; if (oM) oM[i] = 0;
                        if (sA) sA[i] = 0; if (sCh) sCh[i] = 0; if (sCo) sCo[i] = 0; if (sAl) sAl[i] = 0; if (sG) sG[i] = 0;
                        if (mx) mx[i] = 0;
                    }
                }
            }
            this._savedActiveBlocks = null;
        } else {
            // Fallback for first run — fill all 16 grid overlay buffers
            if (g.effectActive) g.effectActive.fill(0);
            if (g.effectAlphas) g.effectAlphas.fill(0);
            if (g.effectChars) g.effectChars.fill(0);
            if (g.effectColors) g.effectColors.fill(0);
            if (g.effectGlows) g.effectGlows.fill(0);
            if (g.overrideChars) g.overrideChars.fill(0);
            if (g.overrideColors) g.overrideColors.fill(0);
            if (g.overrideAlphas) g.overrideAlphas.fill(0);
            if (g.overrideGlows) g.overrideGlows.fill(0);
            if (g.overrideMix) g.overrideMix.fill(0);
            if (g.secondaryActive) g.secondaryActive.fill(0);
            if (g.secondaryChars) g.secondaryChars.fill(0);
            if (g.secondaryColors) g.secondaryColors.fill(0);
            if (g.secondaryAlphas) g.secondaryAlphas.fill(0);
            if (g.secondaryGlows) g.secondaryGlows.fill(0);
            if (g.mix) g.mix.fill(0);
        }

        if (g.complexStyles) g.complexStyles.clear();
    }

    trigger(force = false, spawnPosition = null) {
        let startTime = 0;
        const logEnabled = this.c.state.logErrors;
        if (logEnabled) startTime = performance.now();

        // Safety net: if chunked preallocation didn't complete (e.g. race condition),
        // force it now synchronously so the first frame doesn't hang.
        if (!QuantizedBaseEffect._preallocated && this.g && this.g.cols) {
            if (logEnabled) console.warn('[QuantizedBaseEffect] Preallocation missed — running synchronously in trigger()');
            this.preallocate();
        }

        if (this.active && !force) {
            if (logEnabled) console.log(`[QuantizedBaseEffect] trigger aborted (already active)`);
            return false;
        }

        // Ensure shared canvases are synced and properly initialized for this instance.
        // We call this even if _preallocated is true to ensure instance property pointers are set.
        if (this.g && this.g.cols) {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this._ensureCanvases(w, h);
        }

        // --- DEFERRED GRID CLEARING ---
        // On re-triggers, snapshot current active indices/blocks for deferred
        // clearing in the first update() frame.  On first-ever trigger the grid
        // overlay buffers are already zeroed from allocation, so we can skip
        // the clear entirely — this eliminates the first-run delay caused by
        // filling 16+ large typed arrays synchronously.
        if (this._hasTriggeredOnce) {
            if (this.activeIndices && this.activeIndices.size > 0) {
                this._savedActiveIndices = new Set(this.activeIndices);
                this.activeIndices.clear();
            } else if (this.activeBlocks && this.activeBlocks.length > 0) {
                this._savedActiveBlocks = this.activeBlocks.slice();
            } else {
                this._savedActiveIndices = null;
                this._savedActiveBlocks = null;
            }
            this._pendingGridClear = true;
        } else {
            this._hasTriggeredOnce = true;
            this._pendingGridClear = false;
        }

        // Reset V2 engine state for a clean slate
        this._resetV2Engine();

        const enabled = this.getConfig('Enabled');
        if (!enabled && !force) return false;

        // Load sequence from global patterns if not already set (e.g. by editor)
        // CRITICAL: If we are a generator and being FORCED to re-trigger, we should NOT load the old sequence.
        const isGenerator = (this.name === "QuantizedBlockGenerator");
        const shouldLoadPattern = !isGenerator || !force;

        if (shouldLoadPattern &&
             (!this.sequence || this.sequence.length === 0 || (this.sequence.length === 1 && this.sequence[0].length === 0)) &&
             window.matrixPatterns && window.matrixPatterns[this.name]) {
            this.sequence = window.matrixPatterns[this.name];
            if (this.sequence && this.sequence.length > 1000) {
                this.sequence = this.sequence.slice(0, 1000);
            }
        }

        this.active = true;
        this.expansionComplete = false;

        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps.length = 0;
        this._lastProcessedOpIndex = 0;
        this._lastRendererOpIndex = 0;
        this.animFrame = 0;
        this.state = 'FADE_IN';
        this.timer = 0;
        this._maskDirty = true;
        this._gridsDirty = true;
        this._outsideMapDirty = true;
        this._runGeneration = (this._runGeneration || 0) + 1; // Monotonic counter for WebGL to detect re-triggers

        // Reset Render Cache
        this.renderer._edgeCacheDirty = true;
        this.renderer._distMapDirty = true;
        this.renderer._cachedEdgeMaps.length = 0;
        this.renderer._edgeBatches.clear();
        this.renderer._echoBatches.clear();
        this.renderer._edgeMaskBatches.clear();
        this.renderer._batchMeta.clear();
        this.renderer._asyncOutsideMap = null;
        this.renderer._asyncDistMap = null;
        this.renderer._asyncBlocksX = 0;
        this.renderer._asyncBlocksY = 0;
        this._outsideMapDirty = true;
        this._outsideMap = null;
        this._gridCacheDirty = true;
        this.lastGridSeed = -1;
        this._cachedBlockSizeFrame = -1;

        this.lineStates.clear();
        this.suppressedFades.clear();
        for (let l = 0; l < 4; l++) {
            if (this.removalGrids[l]) this.removalGrids[l].fill(-1);
        }
        this.lastVisibilityChangeFrame = 0;
        this.lastMaskUpdateFrame = 0;

        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;

        // Reset growth/overlap/cycle state from previous run
        this.growthPool.clear();
        this._behaviorsInitialized = false;
        this.overlapState = { step: 0 };
        this.cycleState = null;
        this.isReconstructing = false;
        this._visibleEmptyCount = -1;
        this._visibleFillRatio = 0;
        this.echoHoldEntries = null;
        this._cachedLayerOrderI32 = null;
        this._lastBlocksX = 0;
        this._lastBlocksY = 0;
        this._lastPitchX = 0;
        this._lastPitchY = 0;

        this.blockMap.clear();
        this.activeBlocks.length = 0;
        for (let i = 0; i < 4; i++) {
            if (this.unfoldSequences[i]) this.unfoldSequences[i].length = 0;
            else this.unfoldSequences[i] = [];
        }
        this.nextBlockId = 0;
        this.proceduralInitiated = false;
        this.finishedBranches.clear();
        this.nudgeAxisBalance = 0;
        this.usedCardinalIndices.length = 0;
        this._syncFrame = -1;
        this._lastSyncOpCount = -1;
        this._currentStepActions.length = 0;

        // Reset shadow controller state for a clean run
        if (this.shadowController) {
            this.shadowController.shadowFade = null;
            this.shadowController.oldWorldFade = null;
            this.shadowController._targetActive = null;
            this.shadowController._lastTargetIndices = null;
            this.shadowController.activeIndices.clear();
        }

        this._initLogicGrid();

        // --- NEW ALIGNMENT LOGIC ---
        // Set spawn center BEFORE _initProceduralState so the seed block lands at the right position.
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));

        let scx = 0, scy = 0;
        if (spawnPosition) {
            // Tap-to-spawn: convert pixel coordinates to block-grid offset from center
            scx = Math.floor(spawnPosition.bx - visW / 2);
            scy = Math.floor(spawnPosition.by - visH / 2);
        } else if (this.getConfig('RandomStart')) {
            scx = Math.floor((Math.random() - 0.5) * (visW - 10));
            scy = Math.floor((Math.random() - 0.5) * (visH - 10));
        }

        // Adjust center point based on the first block of the sequence (if it exists)
        // so that the animation's "seed" lands at our chosen scx/scy.
        let genOriginX = 0, genOriginY = 0;
        const hasSequence = this.sequence && this.sequence.length > 0 &&
            !(this.sequence.length === 1 && this.sequence[0].length === 0);
        if (hasSequence) {
            const firstBlock = QuantizedSequence.findFirstBlock(this.sequence);
            if (firstBlock) {
                // Alignment logic: only shift the coordinate system if spawn is offset from center.
                if (spawnPosition || this.getConfig('RandomStart')) {
                    scx -= firstBlock.x;
                    scy -= firstBlock.y;
                }
                // genOrigin must be the absolute grid coordinate relative to center where growth starts.
                // When tapped, this is scx + firstBlock.x (which equals the original tap-to-center offset).
                genOriginX = scx + firstBlock.x;
                genOriginY = scy + firstBlock.y;
            }
        } else if (spawnPosition || this.getConfig('RandomStart')) {
            // No sequence — the seed block must land at the tap/random position.
            // Set genOrigin to match scx/scy so _initProceduralState seeds there.
            genOriginX = scx;
            genOriginY = scy;
        }
        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;
        this.behaviorState.genOriginX = genOriginX;
        this.behaviorState.genOriginY = genOriginY;
        // ---------------------------

        this.state = 'FADE_IN';
        this.timer = 0;
        this.step = 0;
        this.lastCapturedStep = -1;
        this.perimeterHistory.length = 0;
        this.echoEdgeMap = null;
        this.echoLastEdgeStep = -1;
        this.alpha = 0.0;

        // Initialize Brightness Swell state
        if (this.getConfig('TriggerBrightnessSwell')) {
            this._swelling = true;
            this._swellTimer = 0;
            // Swell duration = equivalent of 8 logical steps
            const interval = this._getEffectiveInterval ? this._getEffectiveInterval() : 10;
            this._swellDurationFrames = 8 * interval;
        } else {
            this._swelling = false;
        }

        if (this.debugMode) {
            // Keydown handling for stepping is managed by the Editor when active
        }

        if (logEnabled) {
            const endTime = performance.now();
            console.log(`[QuantizedBaseEffect] trigger setup took ${(endTime - startTime).toFixed(2)}ms`);
        }

        return true;
    }

    _processAnimationStep() {
        const stepIdx = this.cyclesCompleted - 1;
        if (stepIdx >= 0 && stepIdx < this.sequence.length) {
            const step = this.sequence[stepIdx];
            if (step) this._executeStepOps(step);
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
        
        // --- 1. Reconstruction from Step 0 ---
        this.isReconstructing = true;
        this.maskOps.length = 0;
        this.activeBlocks = []; 
        this.nextBlockId = 0;
        this.proceduralInitiated = false;
        this._initProceduralState(false); 
        this._initLogicGrid();
        this._lastProcessedOpIndex = 0;
        this.isReconstructing = false;

        // --- 2. Process Remaining Steps ---
        for (let i = 0; i < targetStepsCompleted; i++) {
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
        }
        
        this.expansionPhase = targetStepsCompleted;
        this.step = targetStepsCompleted;
        this.cyclesCompleted = targetStepsCompleted;
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
        this.isReconstructing = true;
        this.jumpToStep(this.expansionPhase);
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
        let horizWeight = Math.max(1.0, ratio);
        let vertWeight = Math.max(1.0, 1.0 / ratio);

        // Axis-Hit Bias: If N/S hit edges, boost E/W weights (and vice-versa)
        const s = this.behaviorState;
        if (s && s.hitEdge) {
            const hitNS = s.hitEdge.N || s.hitEdge.S;
            const hitEW = s.hitEdge.E || s.hitEdge.W;
            if (hitNS && !hitEW) horizWeight *= 1.5;
            if (hitEW && !hitNS) vertWeight *= 1.5;
        }

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
            this.perimeterHistory.length = 0;
            this.echoEdgeMap = null;
            return;
        }

        // WebGL Echo Path Optimization:
        // When using WebGL, we implement history pooling directly on the GPU.
        // We skip massive Int32Array allocations/snapshots on the CPU.
        if (this.c.state.renderingEngine === 'webgl') {
            if (this.perimeterHistory.length > 0) this.perimeterHistory.length = 0;
            this.echoHoldEntries = null;
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

                const maxHistory = delay + 1;
                // Pool snapshot buffers: recycle evicted entry instead of allocating new Int32Array
                let snapshot;
                if (this.perimeterHistory.length >= maxHistory) {
                    snapshot = this.perimeterHistory.shift(); // recycle oldest buffer
                } else {
                    snapshot = new Int32Array(compositeGrid.length);
                }
                snapshot.set(compositeGrid);
                this.perimeterHistory.push(snapshot);
            } else {
                // Hold mode: per-edge tracking handled inside renderEchoEdges.
                this.echoHoldEntries = null;
                this.perimeterHistory.length = 0;
            }

            this._maskDirty = true;
            return;
        }

        const compositeGrid = this.renderGrid;
        if (!compositeGrid || !this.logicGridW || !this.logicGridH) return;

        // Standard trailing echo: ring buffer of renderGrid snapshots
        // Pool snapshot buffers: recycle evicted entry instead of allocating new Int32Array
        const delay = this.getEchoGfxValue('Delay') || 3;
        const maxHistory = delay + 1;
        let snapshot;
        if (this.perimeterHistory.length >= maxHistory) {
            snapshot = this.perimeterHistory.shift(); // recycle oldest buffer
        } else {
            snapshot = new Int32Array(compositeGrid.length);
        }
        snapshot.set(compositeGrid);
        this.perimeterHistory.push(snapshot);

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
        let updateStart = 0;
        if (this.c.state.logErrors) updateStart = performance.now();

        const s = this.c.state;
        const fps = 60;

        // Execute deferred grid clearing from trigger() — runs once on first update frame.
        // This moves the heavy clearing work out of the trigger event handler so the
        // browser can paint between the user action and the initialization work.
        if (this._pendingGridClear) {
            this._executeDeferredGridClear();
        }

        // Handle trigger swell logic before animation step progression
        if (this._swelling) {
            this._swellTimer++;
            this.cycleTimer = 0; // Freeze logical animation steps during swell
            if (this._swellTimer >= this._swellDurationFrames) {
                this._swelling = false;
                // Capture the frame when the swell finishes to start duration calculations
                this.startFrame = this.animFrame;
            }
        } else if (this.startFrame === undefined) {
            this.startFrame = this.animFrame;
        }

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

        // Periodic maintenance (Pruning expired ops) — in-place to avoid GC from .filter()
        if (this.animFrame % 60 === 0 && this.maskOps && this.maskOps.length > 0) {
            const fadeOut = this.getConfig('FadeFrames') || 0;
            const oldLen = this.maskOps.length;
            let writeIdx = 0;
            for (let ri = 0; ri < this.maskOps.length; ri++) {
                const op = this.maskOps[ri];
                if (op.expireFrame && this.animFrame >= op.expireFrame + fadeOut) continue;
                this.maskOps[writeIdx++] = op;
            }
            this.maskOps.length = writeIdx;
            if (writeIdx !== oldLen) {
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
                this.expansionPhase = this.cyclesCompleted;

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
                // Promotion logic removed - no layers should promote.
                /*
                const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
                if (usePromotion && this.state !== 'PLAYBACK') {
                    this._promoteLayer1Blocks();
                }
                */

                if (this.state === 'GENERATING') {
                    this._attemptGrowth();
                } else if (this.cyclesCompleted <= this.sequence.length) {
                    this._processAnimationStep();
                } else if (this.getConfig('GeneratorTakeover') || this.name === "QuantizedBlockGenerator") {
                    this.state = 'GENERATING';
                    this._initProceduralState(true);
                    this._attemptGrowth();
                }

                // Perform Auto Actions (Filling holes, etc.) every logic step if enabled
                this._performAutoActions();

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
        } else if (this.state === 'SUSTAIN' || this.state === 'GENERATING' || this.state === 'PLAYBACK') {
            this.timer++;
            const isFinished = (this.timer >= durationFrames);
            const procFinished = (this.state === 'GENERATING') && this._isProceduralFinished();

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

        if (this.c.state.logErrors) {
            const updateTime = performance.now() - updateStart;
            if (updateTime > 10) {
                console.log(`[QuantizedBaseEffect] update took ${updateTime.toFixed(2)}ms (animFrame: ${this.animFrame}, cyclesCompleted: ${this.cyclesCompleted})`);
            }
        }
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
        const sc = QuantizedBaseEffect.sharedCanvases;

        if (!sc.mask) {
            sc.mask = document.createElement('canvas');
            sc.maskCtx = sc.mask.getContext('2d');
        }
        if (!sc.scratch) {
            sc.scratch = document.createElement('canvas');
            sc.scratchCtx = sc.scratch.getContext('2d');
        }
        if (!sc.gridCache) {
            sc.gridCache = document.createElement('canvas');
            sc.gridCacheCtx = sc.gridCache.getContext('2d');
        }
        if (!sc.perimeterMask) {
            sc.perimeterMask = document.createElement('canvas');
            sc.perimeterMaskCtx = sc.perimeterMask.getContext('2d');
        }
        if (!sc.lineMask) {
            sc.lineMask = document.createElement('canvas');
            sc.lineMaskCtx = sc.lineMask.getContext('2d');
        }
        if (!sc.echo) {
            sc.echo = document.createElement('canvas');
            sc.echoCtx = sc.echo.getContext('2d');
        }

        // Sync instance properties to shared canvases
        this.maskCanvas = sc.mask;
        this.maskCtx = sc.maskCtx;
        this.scratchCanvas = sc.scratch;
        this.scratchCtx = sc.scratchCtx;
        this.gridCacheCanvas = sc.gridCache;
        this.gridCacheCtx = sc.gridCacheCtx;
        this.perimeterMaskCanvas = sc.perimeterMask;
        this.perimeterMaskCtx = sc.perimeterMaskCtx;
        this.lineMaskCanvas = sc.lineMask;
        this.lineMaskCtx = sc.lineMaskCtx;
        this.echoCanvas = sc.echo;
        this.echoCtx = sc.echoCtx;

        // Resize shared canvases if needed
        if (sc.mask.width !== w || sc.mask.height !== h) {
            sc.mask.width = w;
            sc.mask.height = h;
            this._maskDirty = true;
        }
        if (sc.scratch.width !== w || sc.scratch.height !== h) {
            sc.scratch.width = w;
            sc.scratch.height = h;
        }
        if (sc.gridCache.width !== w || sc.gridCache.height !== h) {
            sc.gridCache.width = w;
            sc.gridCache.height = h;
            this.lastGridSeed = -1; 
        }
        if (sc.perimeterMask.width !== w || sc.perimeterMask.height !== h) {
            sc.perimeterMask.width = w;
            sc.perimeterMask.height = h;
        }
        if (sc.lineMask.width !== w || sc.lineMask.height !== h) {
            sc.lineMask.width = w;
            sc.lineMask.height = h;
        }
        if (sc.echo.width !== w || sc.echo.height !== h) {
            sc.echo.width = w;
            sc.echo.height = h;
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
        if (!this.layout) {
            this.renderer._computeLayoutOnly(this, w, h, s, d);
        }
        
        const rotatorCycle = d.rotatorCycleFrames || 20;
        const timeSeed = Math.floor(this.animFrame / rotatorCycle);
        if (timeSeed === this.lastGridSeed && !this._gridCacheDirty) return;
        this.lastGridSeed = timeSeed;
        this._gridCacheDirty = false;

        const ctx = this.gridCacheCtx;
        ctx.clearRect(0, 0, w, h);

        // Ensure shared Atlas is ready and using current font settings
        if (!QuantizedBaseEffect.sharedAtlas) {
            QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c);
        }
        const atlas = QuantizedBaseEffect.sharedAtlas;
        atlas.update();

        const grid = this.g;
        const shadowGrid = this.shadowGrid;
        const distW = this.renderer._distMapWidth;
        const distH = this.renderer._distMapHeight;
        const l = this.layout;
        const screenOriginX = ((0 - (grid.cols * d.cellWidth * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((0 - (grid.rows * d.cellHeight * 0.5)) * s.stretchY) + (h * 0.5);
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        
        const activeFonts = d.activeFonts;
        const fontData = activeFonts[0] || { chars: "01" };
        const charSet = fontData.chars;
        const charSetLen = charSet.length;
        
        ctx.save();
        ctx.translate(screenOriginX, screenOriginY);
        if (s.stretchX !== 1 || s.stretchY !== 1) {
            ctx.scale(s.stretchX, s.stretchY);
        }

        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const padding = 5;

        // O(1) Performance Optimization: Move static calculations outside the hot loops.
        // We also replace expensive Math.sin hashing with fast lookups into rotatorOffsets.
        const rotatorOffsets = grid.rotatorOffsets;
        const shadowChars = shadowGrid ? shadowGrid.chars : null;
        const oActive = grid.overrideActive;
        const oChars = grid.overrideChars;
        const eActive = grid.effectActive;
        const srGrid = this.shadowRevealGrid;

        for (let y = -padding; y < rows + padding; y++) {
            const cy = (y + 0.5) * cellH;
            const isInsideY = (y >= 0 && y < rows);
            const rowOff = y * cols;
            
            // Logic block Y mapping (O(1) outside X loop)
            const by = isInsideY ? Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY) : -1;
            const isByValid = (by >= 0 && by < distH);
            const bRowOff = isByValid ? by * distW : -1;

            for (let x = -padding; x < cols + padding; x++) {
                let charCode = 0;
                let i = -1;
                
                const isInsideGrid = isInsideY && (x >= 0 && x < cols);
                
                if (isInsideGrid) {
                    i = rowOff + x;
                    
                    // Sparse logic-to-render check
                    if (isByValid) {
                        const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                        if (bx >= 0 && bx < distW) {
                            if (srGrid && srGrid[bRowOff + bx] === 1) {
                                // Inside Block: Shadow Logic
                                if (shadowChars) charCode = shadowChars[i];
                            } else {
                                // Outside Block: Cleanup stale shadow status
                                if (eActive[i] === 3) eActive[i] = 0;
                            }
                        }
                    }

                    if (charCode <= 32) {
                        if (oActive && oActive[i] > 0) charCode = oChars[i];
                        else charCode = chars[i];
                    }
                }
                
                // --- FAST GHOST CHARACTER HASHING ---
                // If cell is empty, generate a ghost character using pre-calculated offsets.
                // This eliminates Math.sin calls which were previously locking the CPU.
                if (charCode <= 32) {
                    const hashIdx = (i !== -1) ? (rotatorOffsets ? rotatorOffsets[i] : (i % 256)) : ((y * 13 + x * 7 + timeSeed) % 256);
                    const hashNorm = hashIdx / 256;
                    charCode = charSet.charCodeAt(Math.floor(hashNorm * charSetLen));
                }
                
                const cx = (x + 0.5) * cellW;
                const rect = atlas.getByCode(charCode);
                if (rect) {
                    // Draw from Atlas with middle/center alignment
                    ctx.drawImage(atlas.canvas, rect.x, rect.y, rect.w, rect.h,
                                  cx - rect.w * 0.5, cy - rect.h * 0.5, rect.w, rect.h);
                }
            }
        }
        
        ctx.restore();
    }

    _updateRenderGridLogic() {
        if (!this.logicGridW || !this.logicGridH) return;
        
        const totalBlocks = this.logicGridW * this.logicGridH;
        const sb = QuantizedBaseEffect.sharedBuffers;

        if (!sb.renderGrid || sb.renderGrid.length !== totalBlocks) {
            sb.renderGrid = new Int32Array(totalBlocks);
            sb.renderGrid.fill(-1);
            sb.logicGrid = new Uint8Array(totalBlocks);
            
            for (let i = 0; i < 4; i++) {
                sb.layerGrids[i] = new Int32Array(totalBlocks);
                sb.layerGrids[i].fill(-1);
                sb.removalGrids[i] = new Int32Array(totalBlocks);
                sb.removalGrids[i].fill(-1);
                sb.layerInvisibleGrids[i] = new Int8Array(totalBlocks);
                sb.layerInvisibleGrids[i].fill(0);
            }
            sb.totalBlocks = totalBlocks;
            this._gridsDirty = true;
        }

        if (!this.maskOps) return;

        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        let opsProcessed = 0;
        let i = startIndex;

        // Snapshot pre-operation occupancy — only needed when there are ops to process.
        let establishedMasks = null;
        if (startIndex < this.maskOps.length) {
            // Use pooled buffers for established masks
            if (!sb.establishedMasksPool) {
                sb.establishedMasksPool = [
                    new Uint8Array(totalBlocks), new Uint8Array(totalBlocks), 
                    new Uint8Array(totalBlocks), new Uint8Array(totalBlocks)
                ];
            }
            
            establishedMasks = sb.establishedMasksPool;
            for (let l = 0; l < 4; l++) {
                if (establishedMasks[l].length !== totalBlocks) {
                    establishedMasks[l] = new Uint8Array(totalBlocks);
                }
                establishedMasks[l].fill(0);
            }

            // Single-pass over ops (instead of 4 passes, one per layer)
            const gridW = this.logicGridW;
            for (let opIdx = 0; opIdx < startIndex; opIdx++) {
                const op = this.maskOps[opIdx];
                if (op.type === 'removeBlock' || op.type === 'rem') continue;
                const ol = (op.layer !== undefined && op.layer >= 0 && op.layer <= 3) ? op.layer : 0;

                const minX = Math.max(0, cx + Math.min(op.x1, op.x2));
                const maxX = Math.min(gridW - 1, cx + Math.max(op.x1, op.x2));
                const minY = Math.max(0, cy + Math.min(op.y1, op.y2));
                const maxY = Math.min(this.logicGridH - 1, cy + Math.max(op.y1, op.y2));

                const mask = establishedMasks[ol];
                for (let gy = minY; gy <= maxY; gy++) {
                    const rowOff = gy * gridW;
                    for (let gx = minX; gx <= maxX; gx++) {
                        mask[rowOff + gx] = 1;
                    }
                }
            }
        }
        
        const dirtyRects = sb.dirtyRects;
        dirtyRects.length = 0;

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

                // Shift logic: Use persistent shared buffers for temp grids
                if (!sb.tempInt32 || sb.tempInt32.length !== grid.length) {
                    sb.tempInt32 = new Int32Array(grid.length);
                    sb.tempInt8 = new Int8Array(grid.length);
                    sb.tempRem = new Int32Array(grid.length);
                }
                const tempGrid = sb.tempInt32.fill(-1);
                const tempInv = inv ? sb.tempInt8.fill(0) : null;
                const tempRem = rem ? sb.tempRem.fill(-1) : null;

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

        // Pre-cache grid references outside the closure for faster access
        const lg0 = layerGrids[0], lg1 = layerGrids[1];
        const rGrid = this.renderGrid;
        const lGrid = this.logicGrid;

        const compositeCell = (idx) => {
            // Layer priority: L0 > L1
            const v0 = lg0[idx], v1 = lg1[idx];
            const l0Active = (v0 !== -1);
            const finalVal = l0Active ? v0 : (v1 !== -1 ? v1 : -1);

            rGrid[idx] = finalVal;
            if (lGrid) lGrid[idx] = (l0Active || v1 !== -1) ? 1 : 0;
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
            this._updateVisibleFillRatio();
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
            this._updateVisibleFillRatio();
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
        // Reuse pooled buffer to avoid per-call allocation + GC
        const size = w * h;
        if (!this._mainMassBuffer || this._mainMassBuffer.length !== size) {
            this._mainMassBuffer = new Int32Array(size);
        }
        const mainMass = this._mainMassBuffer;
        mainMass.fill(-1);
        const g0 = this.layerGrids[0], g1 = this.layerGrids[1];

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
        // Per-frame cache: same inputs produce same outputs, called 3-5x per frame
        const cco = this._cachedCenteredOffset;
        if (cco && cco._bx === blocksX && cco._by === blocksY && cco._px === pitchX && cco._py === pitchY && cco._sc === this.g.cols && cco._sr === this.g.rows) {
            return cco;
        }
        const logicCellsX = blocksX * pitchX;
        const logicCellsY = blocksY * pitchY;
        const screenCellsX = this.g.cols;
        const screenCellsY = this.g.rows;
        const cellOffX = Math.floor((logicCellsX - screenCellsX) / 2.0);
        const cellOffY = Math.floor((logicCellsY - screenCellsY) / 2.0);
        const offX = cellOffX / pitchX;
        const offY = cellOffY / pitchY;
        if (!this._cachedCenteredOffset) {
            this._cachedCenteredOffset = { offX: 0, offY: 0, _bx: 0, _by: 0, _px: 0, _py: 0, _sc: 0, _sr: 0 };
        }
        const r = this._cachedCenteredOffset;
        r.offX = offX; r.offY = offY;
        r._bx = blocksX; r._by = blocksY; r._px = pitchX; r._py = pitchY;
        r._sc = screenCellsX; r._sr = screenCellsY;
        return r;
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

        // Glass Bloom / Reveal logic: Use pre-calculated fill ratio for performance.
        if (this._visibleEmptyCount === -1) {
            this._updateVisibleEmptyCount();
        }
        const fillRatio = this._visibleFillRatio;

        const rawGlassBloom = this.getConfig('GlassBloom') ?? 1.2;
        const glassBloomScaleToSize = this.getConfig('GlassBloomScaleToSize') === true;
        const bloomScale = glassBloomScaleToSize
            ? Math.max(0, 1.0 - Math.log1p(Math.min(fillRatio * 2.0, 1.0) * (Math.E - 1)))
            : 1.0;
        const finalGlassBloom = 1.0 + (rawGlassBloom - 1.0) * bloomScale * this.alpha;

        const persistFrames = this.getLineGfxValue('Persistence') || 0;

        // Reuse cached render state object to eliminate per-frame GC pressure
        // from creating ~30-property objects + sub-arrays at 60fps
        if (!this._cachedWebGLState) {
            this._cachedWebGLState = {
                logicGridSize: [0, 0], cellPitch: [0, 0], blockOffset: [0, 0],
                userBlockOffset: [0, 0], layerOrder: null, showInterior: true,
                intensity: 1.0, thickness: 0, tintOffset: 0, sharpness: 0,
                glowFalloff: 0, roundness: 0, maskSoftness: 0, brightness: 1.0,
                saturation: 1.0, additiveStrength: 0, glow: 0, varianceEnabled: 0,
                varianceAmount: 0, varianceCoverage: 0, varianceDirection: 0,
                color: [0, 0, 0], persistence: 0, persistFrames: 0, sampleOffset: [0, 0],
                lineOffset: [0, 0], fillRatio: 0, glassBloom: 0,
                refractionEnabled: 0, refractionWidth: 0, refractionBrightness: 0,
                refractionSaturation: 0, refractionCompression: 0, refractionOffset: 0,
                refractionGlow: 0, refractionOpacity: 1, refractionMaskZoom: 1.0,
                refraction3DEnabled: 0, refraction3DStrength: 0.3,
                compressionThreshold: 0, shadowWorldFadeSpeed: 0,
                singleBlockFill: 0
            };
        }
        const st = this._cachedWebGLState;
        st.logicGridSize[0] = gw; st.logicGridSize[1] = gh;
        st.cellPitch[0] = cellPitchX; st.cellPitch[1] = cellPitchY;
        st.blockOffset[0] = offX; st.blockOffset[1] = offY;
        st.userBlockOffset[0] = this.userBlockOffX || 0; st.userBlockOffset[1] = this.userBlockOffY || 0;
        st.layerOrder = this._cachedLayerOrderI32 || (this._cachedLayerOrderI32 = new Int32Array(this.layerOrder || [0, 1, 2, 3]));
        st.showInterior = this.getConfig('ShowInterior') !== false;

        st.intensity = this.alpha * (this.getLineGfxValue('Opacity') ?? 1.0); 
        st.thickness = this.getLineGfxValue('Thickness') ?? 1.0;
        st.tintOffset = this.getLineGfxValue('TintOffset') ?? 0.0;
        st.sharpness = this.getLineGfxValue('Sharpness') ?? 0.05;
        st.glowFalloff = this.getLineGfxValue('GlowFalloff') ?? 2.0;
        st.roundness = this.getLineGfxValue('Roundness') ?? 0.0;
        st.maskSoftness = this.getLineGfxValue('MaskSoftness') ?? 0.0;
        // st.brightness = (this.getLineGfxValue('Brightness') ?? 1.0) * (s.brightness ?? 1.0);
        st.brightness = (s.brightness ?? 1.0);
        // st.saturation = this.getLineGfxValue('Saturation') ?? 1.0;
        st.saturation = 1.0;
        st.additiveStrength = this.getLineGfxValue('AdditiveStrength') ?? 1.0;
        // st.glow = this.getLineGfxValue('Glow') ?? (this.getConfig('BorderIllumination') ?? 4.0);
        st.glow = (this.getConfig('BorderIllumination') ?? 4.0);
        st.varianceEnabled = this.getLineGfxValue('BrightnessVarianceEnabled') ? 1.0 : 0.0;
        st.varianceAmount = this.getLineGfxValue('BrightnessVarianceAmount') ?? 0.5;
        st.varianceCoverage = this.getLineGfxValue('BrightnessVarianceCoverage') ?? 100;
        st.varianceDirection = this.getLineGfxValue('BrightnessVarianceDirection') ?? 1;
        st.color[0] = col.r / 255; st.color[1] = col.g / 255; st.color[2] = col.b / 255;
        st.persistence = persistFrames <= 0 ? 0.0 : 1.0 / persistFrames;
        st.persistFrames = persistFrames;
        st.sampleOffset[0] = this.getLineGfxValue('SampleOffsetX') * scale;
        st.sampleOffset[1] = this.getLineGfxValue('SampleOffsetY') * scale;
        st.lineOffset[0] = this.getLineGfxValue('OffsetX') * scale;
        st.lineOffset[1] = this.getLineGfxValue('OffsetY') * scale;
        st.fillRatio = fillRatio;
        st.glassBloom = finalGlassBloom;
        st.refractionEnabled = this.getConfig('GlassRefractionEnabled') ? 1 : 0;
        st.refractionWidth = this.getConfig('GlassRefractionWidth') ?? 0.25;

        // Brightness Interpolation and Swell Logic
        const startBrightness = this.getConfig('GlassRefractionBrightness') ?? 1.5;
        let currentBrightnessTarget = startBrightness;

        if (this._swelling) {
            const progress = this._swellTimer / Math.max(1, this._swellDurationFrames);
            const swellAmount = Math.sin(progress * Math.PI); // 0 -> 1 -> 0 curve
            currentBrightnessTarget = startBrightness + (swellAmount * 1.5);
        } else if (this.startFrame !== undefined) {
            const durationFrames = (this.getConfig('DurationSeconds') || 5) * 60;
            const totalFrames = Math.max(1, durationFrames);
            const elapsed = this.animFrame - this.startFrame;
            const progress = Math.max(0, Math.min(1.0, elapsed / totalFrames));

            const endBrightness = this.getConfig('GlassRefractionBrightnessEnd') ?? startBrightness;
            currentBrightnessTarget = startBrightness + (endBrightness - startBrightness) * progress;
        }

        st.refractionBrightness = 1.0 + (currentBrightnessTarget - 1.0) * this.alpha;

        st.refractionSaturation = 1.0 + ((this.getConfig('GlassRefractionSaturation') ?? 1.5) - 1.0) * this.alpha;
        st.refractionCompression = this.getConfig('GlassRefractionCompression') ?? 1.0;
        st.refractionOffset = this.getConfig('GlassRefractionOffset') ?? 0.0;
        st.refractionGlow = (this.getConfig('GlassRefractionGlow') ?? 0.0) * this.alpha;
        st.refractionOpacity = (this.getConfig('GlassRefractionOpacity') ?? 1.0) * this.alpha;
        st.refractionUnwrap = this.getConfig('GlassRefractionUnwrap') ? 1 : 0;
        st.refractionMaskScale = this.getConfig('GlassRefractionMaskScale') ?? 1.0;
        st.refractionMaskZoom = this.getConfig('GlassRefractionMaskZoom') ?? 1.0;
        st.refraction3DEnabled = this.getConfig('GlassRefraction3DEnabled') ? 1 : 0;
        st.refraction3DStrength = this.getConfig('GlassRefraction3DStrength') ?? 0.3;
        st.compressionThreshold = this.getConfig('GlassCompressionThreshold') ?? 0.0;
        st.shadowWorldFadeSpeed = this.getConfig('ShadowWorldFadeSpeed') ?? 0.5;
        st.singleBlockFill = this.getConfig('SingleBlockFillEnabled') ? 1 : 0;
        return st;
    }

    // _drawMaskedLines removed — Canvas2D line rendering pipeline replaced by
    // GPU-only Natural Refraction path (_renderQuantizedLineGfx).

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;
        const s = this.c.state;

        // Lines and echo are rendered exclusively by the GPU via
        // _renderQuantizedLineGfx (Natural Refraction). The shader needs
        // gridCacheCanvas as a source texture for the character-masked
        // perimeter line reveal, so we keep _ensureCanvases +
        // _updateGridCache alive but skip all Canvas2D line drawing.
        this._checkDirtiness();
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);
        if (this._maskDirty) {
            this.renderer._computeLayoutOnly(this, width, height, s, d);
            this._maskDirty = false;
        }
        this._updateGridCache(width, height, s, d);
    }

    renderEditorPreview(ctx, derived, previewOp) {
        const opHash = previewOp ? JSON.stringify(previewOp) : "";
        const baseOpsLen = this.maskOps.length - (this._previewActive ? this._lastPreviewOpsAddedCount : 0);
        const stateHash = `${baseOpsLen}_${this.expansionPhase}_${opHash}`;

        if (stateHash !== this._lastPreviewStateHash) {
            if (!this._previewActive || (this._lastPreviewSavedLogic && this._lastPreviewSavedLogic.length !== this.logicGrid.length)) {
                this._lastPreviewSavedLogic = new Uint8Array(this.logicGrid);
                this._lastPreviewSavedOpsLen = this.maskOps.length;
            } else {
                if (this._lastPreviewSavedLogic && this._lastPreviewSavedLogic.length === this.logicGrid.length) {
                    this.logicGrid.set(this._lastPreviewSavedLogic);
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
            this.renderer._computeLayoutOnly(this, width, height, s, derived);
            this._maskDirty = false;
        }

        // Line rendering is handled exclusively by the GPU (Natural Refraction).
        // No Canvas2D line drawing in editor preview.

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

        const isOcc = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY || !grid) return false;
            return grid[by * blocksX + bx] !== -1;
        };

        const isMain = (bx, by) => {
            return isOcc(grid0, bx, by) || isOcc(grid1, bx, by);
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

                let isNorm = false;
                let isDim = false;

                // 1. L0 boundary always normal
                if (a0 !== b0) isNorm = true;

                // 2. L1 perimeter
                if (a1 !== b1) {
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

                let isNorm = false;
                let isDim = false;

                // 1. L0 boundary always normal
                if (a0 !== b0) isNorm = true;

                // 2. L1 perimeter
                if (a1 !== b1) {
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
        if (forceSeed) {
            const manualOnly = !!this.getConfig('ManualSeedOnly');
            if (manualOnly) return; // Explicit bypass for effects that manage their own seeding (like Zoom)

            const maxLayer = this._getMaxLayer();
            const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
            
            // Fix: check if ANY blocks exist across ANY layer before spawning a seed.
            // This prevents the 'center block' spawn if a tap-to-spawn sequence has already placed a block on Layer 1.
            let needsSeed = true;
            if (this.activeBlocks && this.activeBlocks.length > 0) {
                needsSeed = false;
            }

            if (needsSeed) {
                if (!this.activeBlocks) this.activeBlocks = [];
                // Principle #3: Adhere to LayerCount setting.
                // Seed the focal point block on all active layers to ensure they have an initial anchor.
                // Use the current generator focal point so manual placement is respected.
                const ox = this.behaviorState?.genOriginX ?? 0;
                const oy = this.behaviorState?.genOriginY ?? 0;

                for (let l = 0; l <= maxLayer; l++) {
                    // If promotion is active, only seed Layer 1 as the initial discovery anchor.
                    if (usePromotion && l !== 1) continue;

                    // Use skipConnectivity=true and bypassOccupancy=true for the initial seeds
                    this._spawnBlock(ox, oy, 1, 1, l, false, 0, true, true, true, false, true);
                }
            }
        }
    }

    _attemptGrowth() {
        if (this._isCanvasFullyCovered()) return;
        this._initProceduralState(true);

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return this._getGenConfig(key);
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

        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;

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
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));

        for (const spine of xSpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeX = ox + spine.dx;
                    while (true) {
                        const val = getGridVal(l, freeX, oy);
                        if (val === -2 || Math.abs(freeX - ox) >= xFinishLimit) { if (l === maxLayer) finished = true; break; }
                        if (val === -1) break;
                        freeX += spine.dx;
                    }
                    if (Math.abs(freeX - ox) < xFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = freeX + (b * spine.dx);
                            if (getGridVal(l, tx, oy) === -1 && Math.abs(tx - ox) <= xGrowthLimit) {
                                if (this._spawnBlock(tx, oy, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
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
                    let freeY = oy + spine.dy;
                    while (true) {
                        const val = getGridVal(l, ox, freeY);
                        if (val === -2 || Math.abs(freeY - oy) >= yFinishLimit) { if (l === 1) finished = true; break; }
                        if (val === -1) break;
                        freeY += spine.dy;
                    }
                    if (Math.abs(freeY - oy) < yFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = freeY + (b * spine.dy);
                            if (getGridVal(l, ox, ty) === -1 && Math.abs(ty - oy) <= yGrowthLimit) {
                                if (this._spawnBlock(ox, ty, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }

        // --- Core Spines Logic: Catch up Layer 0/1 to follow leading layers ---
        for (const spine of xSpines) {
            for (let x = ox + spine.dx; Math.abs(x - ox) <= xGrowthLimit; x += spine.dx) {
                let anyLeading = false;
                for (let l = 1; l <= maxLayer; l++) if (getGridVal(l, x, oy) !== -1) anyLeading = true;
                
                const targetL = usePromotion ? 1 : 0;
                if (getGridVal(targetL, x, oy) === -1 && anyLeading) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x + (b * spine.dx);
                            if (getGridVal(targetL, tx, oy) === -1) { 
                                if (this._spawnBlock(tx, oy, 1, 1, targetL, false, 0, true, true, true, false, true) !== -1) successInStep = true; 
                            } else break;
                        }
                    }
                    break;
                }
            }
        }
        let minX = ox, maxX = ox;
        for (let x = ox - 1; ; x--) { if (getGridVal(maxLayer, x, oy) === -1 || getGridVal(maxLayer, x, oy) === -2) { minX = x + 1; break; } }
        for (let x = ox + 1; ; x++) { if (getGridVal(maxLayer, x, oy) === -1 || getGridVal(maxLayer, x, oy) === -2) { maxX = x - 1; break; } }
        for (let x = minX; x <= maxX; x++) {
            const directions = [{ id: 'n', dy: -1 }, { id: 's', dy: 1 }];
            for (const d of directions) {
                const branchId = `wing_${d.id}_${x}`;
                let wingFinished = this.finishedBranches.has(branchId), wingFreeY = oy + d.dy;
                if (!wingFinished) {
                    while (true) {
                        const val = getGridVal(maxLayer, x, wingFreeY);
                        if (val === -2 || Math.abs(wingFreeY - oy) >= yFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                        if (val === -1) break; wingFreeY += d.dy;
                    }
                }
                if (!wingFinished) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = wingFreeY + (b * d.dy);
                            if (getGridVal(maxLayer, x, ty) === -1 && Math.abs(ty - oy) <= yGrowthLimit) { if (this._spawnBlock(x, ty, 1, 1, maxLayer, false, 0, true, true, true, false, true) !== -1) successInStep = true; } else break;
                        }
                    }
                    this._revertFrontier(x, oy, 0, d.dy, maxLayer, reversionChance, branchId);
                }
                const searchLimitY = wingFinished ? yGrowthLimit : Math.abs(wingFreeY - oy);
                for (let y = oy + d.dy; Math.abs(y - oy) <= searchLimitY; y += d.dy) {
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
        // Force focus on Layer 1 as per instructions
        const layer = 1;

        const cycle = cycleState || (this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : null);
        if (!cycle) return false;

        // "Randomness" controls probability:
        // 0.05 (Min) -> 5% chance of temp blocks / 5% chance of retraction
        // 1.0 (Max) -> 100% chance of temp blocks / 100% chance of retraction
        const randomness = chance ?? (this._getGenConfig('NudgeChance') ?? 0.8);

        if (cycle.step === 0) {
            // STEP 0: EXPANSION
            // We always try to place the Permanent block. 
            // Randomness controls if we also get a Temporary block.
            const success = this._executeExpansionStep(layer, bw, bh, randomness, originX, originY);
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

        const allowed = this._getAllowedDirs(layer);
        const faces = this._getBiasedDirections().filter(f => !allowed || allowed.has(f));
        if (faces.length === 0) return false;

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
                // Growth Variance: Up to 20% chance of consecutive steps (streak)
                let bonusSteps = (Math.random() < 0.2) ? 1 + Math.floor(Math.random() * 2) : 0;
                
                // NEW: Use the scale as the base number of steps for the nudge
                const scale = Math.max(bw, bh);
                let totalSteps = scale + bonusSteps;
                
                // Force 1x1 blocks for the actual nudge spawn steps
                const spawnW = 1;
                const spawnH = 1;

                let currentPos = { x: firstEmpty.x, y: firstEmpty.y };
                let lastSpawnedId = -1;

                for (let sIdx = 0; sIdx < totalSteps; sIdx++) {
                    // 1. PLACE PERMANENT BLOCK (Forward)
                    let px = currentPos.x, py = currentPos.y;
                    if (dir === 'N') { py = currentPos.y - spawnH + 1; px = currentPos.x - Math.floor(spawnW / 2); }
                    else if (dir === 'S') { py = currentPos.y; px = currentPos.x - Math.floor(spawnW / 2); }
                    else if (dir === 'W') { px = currentPos.x - spawnW + 1; py = currentPos.y - Math.floor(spawnH / 2); }
                    else if (dir === 'E') { px = currentPos.x; py = currentPos.y - Math.floor(spawnH / 2); }

                    // Bug Fix: If L1 already exists here, skip (prevents hole-making on retraction)
                    if (this._isOccupied(px, py, layer)) break;

                    const permId = this._spawnBlock(px, py, spawnW, spawnH, layer, false, 0, true, true, true, false, true);
                    if (permId !== -1) {
                        lastSpawnedId = permId;
                        
                        // 2. OPTIONALLY PLACE TEMPORARY BLOCK (Scaled by Randomness)
                        // Only place temp block for the LAST step of the streak to avoid over-crowding
                        if (sIdx === totalSteps - 1 && Math.random() < randomness) {
                            const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
                            const opp = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
                            const spawnDirs = shuffle(['N', 'S', 'E', 'W'].filter(d => d !== opp[dir]));
                            
                            let tempId = -1;
                            for (const tempDir of spawnDirs) {
                                let tx = px, ty = py;
                                if (tempDir === 'N') ty -= spawnH;
                                else if (tempDir === 'S') ty += spawnH;
                                else if (tempDir === 'W') tx -= spawnW;
                                else if (tempDir === 'E') tx += spawnW;

                                // Bug Fix: If L1 already exists here, skip (prevents hole-making on retraction)
                                if (this._isOccupied(tx, ty, layer)) continue;

                                tempId = this._spawnBlock(tx, ty, spawnW, spawnH, layer, false, 0, true, true, true, false, true);
                                if (tempId !== -1) {
                                    const cycle = this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : null;
                                    if (cycle) cycle.lastTempBlock = { x: tx, y: ty, w: spawnW, h: spawnH };
                                    break; 
                                }
                            }
                            if (tempId === -1 && this.behaviorState.nudgeState?.cycle) this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                        } else if (sIdx === totalSteps - 1 && this.behaviorState.nudgeState?.cycle) {
                            this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                        }

                        // If we have more steps, find the next empty in the same lane
                        if (sIdx < totalSteps - 1) {
                            let nextEmpty = null;
                            const curGX = cx + currentPos.x, curGY = cy + currentPos.y;
                            for (let gy = curGY + stepDir, gx = curGX + stepDir; (dir === 'N' ? gy >= 0 : dir === 'S' ? gy < h : dir === 'W' ? gx >= 0 : gx < w); (dir === 'N' || dir === 'S' ? gy += stepDir : gx += stepDir)) {
                                const tx = (dir === 'N' || dir === 'S') ? curGX : gx;
                                const ty = (dir === 'N' || dir === 'S') ? gy : curGY;
                                if (grid[ty * w + tx] === -1) {
                                    nextEmpty = { x: tx - cx, y: ty - cy };
                                    break;
                                }
                            }
                            if (nextEmpty) {
                                currentPos = nextEmpty;
                            } else {
                                break; // No more space in this lane
                            }
                        }
                    } else {
                        break; // Failed to spawn
                    }
                }
                
                if (lastSpawnedId !== -1) return true;
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
            c.allowInternal, c.suppressFades, c.isMirroredSpawn, c.bypassOccupancy,
            false, c.source || null
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

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, source = null) {
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy,
            bypassSpatial: skipConnectivity,
            source: source
        };
        return this._proposeCandidate(candidate);
    }

    _revertFrontier(ox, oy, dx, dy, layer, chance, branchId) {
        if (this.finishedBranches.has(branchId)) return false;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
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
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        
        if (!this._getGenConfig('EnableSyncSubLayers') && !usePromotion) return;
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

    _spawnBlockCore(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, invisible = false, source = null) {
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
                 // Check overlap and orthogonal adjacency in one pass (O(area))
                 for (let gy = minY; gy <= maxY; gy++) {
                     const rowOff = gy * blocksX;
                     for (let gx = minX; gx <= maxX; gx++) {
                         if (targetGrid[rowOff + gx] !== -1) {
                             overlapArea++;
                             connected = true; 
                         }
                     }
                 }
                 
                 // If no overlap, check orthogonal neighbors (N,S,E,W)
                 if (!connected) {
                     // North
                     if (minY > 0) {
                         const rowOff = (minY - 1) * blocksX;
                         for (let gx = minX; gx <= maxX; gx++) if (targetGrid[rowOff + gx] !== -1) { connected = true; break; }
                     }
                     // South
                     if (!connected && maxY < blocksY - 1) {
                         const rowOff = (maxY + 1) * blocksX;
                         for (let gx = minX; gx <= maxX; gx++) if (targetGrid[rowOff + gx] !== -1) { connected = true; break; }
                     }
                     // West
                     if (!connected && minX > 0) {
                         for (let gy = minY; gy <= maxY; gy++) if (targetGrid[gy * blocksX + (minX - 1)] !== -1) { connected = true; break; }
                     }
                     // East
                     if (!connected && maxX < blocksX - 1) {
                         for (let gy = minY; gy <= maxY; gy++) if (targetGrid[gy * blocksX + (maxX + 1)] !== -1) { connected = true; break; }
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
        if (!bypassOccupancy && layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'))) {
             return -1;
        }

        const id = this.nextBlockId++;
        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;
        const b = { 
            x, y, w, h, 
            startFrame: this.animFrame, 
            startPhase: this.expansionPhase, 
            layer, id, isShifter,
            dist: Math.abs(x - ox) + Math.abs(y - oy),
            invisible: invisible, // Record for local state
            stepAge: 0,
            source: source
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
            invisible: invisible, // NEW: Record invisibility in op
            source: source
        };
        this.maskOps.push(op);

        // Record to sequence for Editor/Step support
        const isRecording = (this.manualStep) && this.sequence && !this.isReconstructing;
        if (isRecording) {
            // Update Generator Origin to follow manual placement for this effect type
            if (this.name === "QuantizedBlockGenerator" || this.getConfig('GeneratorTakeover')) {
                this.behaviorState.genOriginX = x;
                this.behaviorState.genOriginY = y;
                // Clear seed schedule to force re-alignment to new focal point
                this.behaviorState.seedSchedule = null;
            }

            const targetIdx = Math.max(0, this.expansionPhase - 1);
            if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
            const seqOp = {
                op: (w === 1 && h === 1) ? 'addSmart' : 'addRect',
                args: (w === 1 && h === 1) ? [x, y, x, y, layer, 0, !op.fade] : [x, y, x + w - 1, y + h - 1, layer, 0, !op.fade],
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
                const idx = rowOff + bx;
                targetGrid[idx] = value;
                
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
        if (layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'))) {
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

    getActiveIndices() {
        return this.activeIndices;
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
            return this.c.state[this.configPrefix + key];
        };

        const now = this.animFrame;
        const interval = 30;

        // Perform hole filler every logic step if enabled
        if (getGenConfig('HoleFillerEnabled') === true) {
            this._performHoleCleanup();
        }

        // Maintain structural integrity and connect islands on an interval or every few steps
        if (getGenConfig('EnableAutoConnectIslands') === true && now % interval === 15) {
            this._connectIslands();
        }
    }

    /**
     * More robust and aggressive hole filling logic that handles all active layers simultaneously.
     * Seeds BFS from the edges of the logic grid (edges of the world) to find enclosed spaces.
     */
    _performHoleCleanup() {
        if (!this.logicGridW || !this.logicGridH) return;

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        // Build composite occupancy map across all layers
        const compositeMap = this._getBuffer('compositeMap', w * h, Int8Array);
        compositeMap.fill(-1);
        for (let l = 0; l < this.layerGrids.length; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            for (let i = 0; i < grid.length; i++) if (grid[i] !== -1) compositeMap[i] = 1;
        }

        // 1. BFS from the LOGIC GRID Perimeter to find the "Outside" empty area
        const outsideMap = this._getBuffer('connectedMap', w * h, Uint8Array);
        outsideMap.fill(0);
        const queue = this._getBuffer('queue', w * h, Int32Array);
        let head = 0, tail = 0;

        const add = (gx, gy) => {
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return;
            const idx = gy * w + gx;
            if (outsideMap[idx] === 0 && compositeMap[idx] === -1) {
                outsideMap[idx] = 1;
                queue[tail++] = idx;
            }
        };

        // Seed BFS from the 4 edges of the world
        for (let gx = 0; gx < w; gx++) { add(gx, 0); add(gx, h - 1); }
        for (let gy = 0; gy < h; gy++) { add(0, gy); add(w - 1, gy); }

        while (head < tail) {
            const idx = queue[head++];
            const cgx = idx % w, cgy = (idx / w) | 0;
            if (cgy > 0) add(cgx, cgy - 1); if (cgy < h - 1) add(cgx, cgy + 1);
            if (cgx > 0) add(cgx - 1, cgy); if (cgx < w - 1) add(cgx + 1, cgy);
        }

        // 2. Fill every enclosed empty cell (any hole of any size)
        //    Also fill "small gap" cells (3+ cardinal neighbors occupied) as inlets/dead-ends.
        let filledCount = 0;
        const maxLayer = this._getMaxLayer();
        const startL = this.getConfig('SingleLayerMode') ? 1 : 0;

        for (let gy = 1; gy < h - 1; gy++) {
            for (let gx = 1; gx < w - 1; gx++) {
                const i = gy * w + gx;
                if (compositeMap[i] !== -1) continue;

                // Enclosed: not reachable from grid boundary via empty cells
                const isEnclosed = (outsideMap[i] === 0);

                // Small gap: 3 or 4 cardinal neighbors occupied (inlets/dead-ends)
                let neighborCount = 0;
                if (compositeMap[i - 1] !== -1) neighborCount++;
                if (compositeMap[i + 1] !== -1) neighborCount++;
                if (compositeMap[i - w] !== -1) neighborCount++;
                if (compositeMap[i + w] !== -1) neighborCount++;

                if (isEnclosed || neighborCount >= 3) {
                    for (let l = startL; l <= maxLayer; l++) {
                        this._spawnBlock(gx - cx, gy - cy, 1, 1, l, false, 0, true, true, true, false, true, 'hole_filler');
                    }
                    compositeMap[i] = 1; // Mark filled so subsequent neighbor checks see it
                    filledCount++;
                }
            }
        }

        if (filledCount > 0) {
            this._gridsDirty = true;
            this._maskDirty = true;
            if (this.c.state.logErrors) this._log(`[HoleCleanup] Filled ${filledCount} cells across layers ${startL}-${maxLayer}.`);
        }
    }

    _maintainStructuralIntegrity() {
        // Now redirects to the more robust _performHoleCleanup
        this._performHoleCleanup();
    }

    _connectIslands() {
        if (!this.logicGridW || !this.logicGridH) return;
        if (this.activeBlocks.length === 0) return;

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

        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;
        const seedGx = cx + ox, seedGy = cy + oy;
        const startIdx = seedGy * w + seedGx;

        if (seedGx >= 0 && seedGx < w && seedGy >= 0 && seedGy < h && combined[startIdx] === 1) {
            connectedMap[startIdx] = 1;
            queue[tail++] = startIdx;
        } else {
            // Find any mainland cell if focal point isn't covered
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

        // Reuse pooled buffers for per-island BFS instead of allocating per iteration
        const iQueue = this._getBuffer('islandQueue', w * h, Int32Array);
        const iVisited = this._getBuffer('islandVisited', w * h, Uint8Array);

        for (const island of islands) {
            let bestIslandPt = { x: cx + island.x, y: cy + island.y };
            let bestTargetPt = null;

            iVisited.fill(0);
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
        // Cache behavior closures — only create them once to avoid GC pressure
        // from recreating 4 large closures on every trigger. Closures capture 'this'
        // via 'self' so they remain valid across triggers.
        if (this._behaviorsInitialized) {
            // Just refresh enabled flags from current config
            const bsd = this.growthPool.get('block_spawner_despawner');
            if (bsd) bsd.enabled = this._getGenConfig('BlockSpawnerEnabled') ?? false;
            const sn = this.growthPool.get('spreading_nudge');
            if (sn) sn.enabled = this._getGenConfig('SpreadingNudgeEnabled') ?? false;
            const sf = this.growthPool.get('shove_fill');
            if (sf) sf.enabled = this._getGenConfig('ShoveFillEnabled') ?? false;
            const hf = this.growthPool.get('hole_filler');
            if (hf) hf.enabled = true;
            const bt = this.growthPool.get('block_thicken');
            if (bt) bt.enabled = this._getGenConfig('BlockThickenEnabled') ?? false;
            const as = this.growthPool.get('axis_shift');
            if (as) as.enabled = this._getGenConfig('AxisShiftEnabled') ?? false;
            return;
        }
        this._behaviorsInitialized = true;
        this.growthPool.clear();
        const self = this;

        // Behavior 2: Block Spawner/Despawner (Anticipatory Growth + Volatility)
        this.registerBehavior('block_spawner_despawner', function(s) {
            const startDelay = this._getGenConfig('BlockSpawnerStartDelay') ?? 10;
            const spawnRate  = Math.max(1, this._getGenConfig('BlockSpawnerRate') ?? 4);
            const layer = 1;

            const allowed = this._getAllowedDirs(layer);

            // 1. Spawning Logic
            if (s.step >= startDelay && (s.step - startDelay) % spawnRate === 0) {
                const maxSpawn = this._getGenConfig('BlockSpawnerCount') ?? 5;

                // Collect perimeter blocks
                const perimeterBlocks = this.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;

                    // NEW: Ensure seed parents are connected to the spines (X or Y axis)
                    const onYSpine = (b.x <= s.genOriginX && b.x + b.w - 1 >= s.genOriginX);
                    const onXSpine = (b.y <= s.genOriginY && b.y + b.h - 1 >= s.genOriginY);
                    if (!onXSpine && !onYSpine) return false;

                    const neighbors = [
                        {x: b.x, y: b.y - 1, dir: 'N'}, {x: b.x, y: b.y + b.h, dir: 'S'}, // N, S
                        {x: b.x - 1, y: b.y, dir: 'W'}, {x: b.x + b.w, y: b.y, dir: 'E'}  // W, E
                    ];
                    // RELAXATION: A block is a candidate if it has ANY free neighbor, 
                    // and we'll filter the spawn side later based on quadrants.
                    return neighbors.some(n => !this._isOccupied(n.x, n.y, layer));
                });

                if (perimeterBlocks.length > 0) {
                    // NEW: Strict restriction - Prefer empty blocks closer to the initial spawn block first
                    perimeterBlocks.sort((a, b) => {
                        const distA = Math.abs(a.x + a.w/2 - s.genOriginX) + Math.abs(a.y + a.h/2 - s.genOriginY);
                        const distB = Math.abs(b.x + b.w/2 - s.genOriginX) + Math.abs(b.y + b.h/2 - s.genOriginY);
                        return distA - distB;
                    });

                    const sizes = [
                        {w: 1, h: 1}, {w: 1, h: 2}, {w: 2, h: 1}, 
                        {w: 1, h: 3}, {w: 3, h: 1}
                    ];

                    let spawnedCount = 0;
                    for (let i = 0; i < maxSpawn * 2 && spawnedCount < maxSpawn; i++) {
                        // Strict preference: Iterate through sorted parents. Try up to 2 attempts per parent before moving on.
                        const parent = perimeterBlocks[Math.floor(i / 2) % perimeterBlocks.length];
                        
                        // Determine parent's quadrant relative to spawn center
                        const pdx = parent.x - s.genOriginX, pdy = parent.y - s.genOriginY;
                        const parentQuad = Math.abs(pdx) > Math.abs(pdy) ? (pdx > 0 ? 'E' : 'W') : (pdy > 0 ? 'S' : 'N');

                        const size = sizes[Math.floor(Math.random() * sizes.length)];
                        
                        // RELAXATION: Allow any side if it's allowed OR if the parent is in an allowed quadrant (branching)
                        const availSides = ['N', 'S', 'E', 'W'].filter(d => {
                            if (!allowed) return true;
                            if (allowed.has(d)) return true;
                            if (allowed.has(parentQuad)) return true; // Branching within allowed quadrant
                            return false;
                        });

                        if (availSides.length === 0) continue;
                        const side = availSides[Math.floor(Math.random() * availSides.length)];
                        let nx, ny;

                        if (side === 'N') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y - size.h;
                        } else if (side === 'S') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y + parent.h;
                        } else if (side === 'W') {
                            nx = parent.x - size.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        } else { // E
                            nx = parent.x + parent.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        }

                        if (this.checkScreenEdge(nx, ny) || this.checkScreenEdge(nx + size.w - 1, ny + size.h - 1)) continue;

                        // NEW: Occupancy Check (Only check layers 0 and 1 to prevent decorative layers from blocking discovery)
                        let isAreaFree = true;
                        for (let ly = 0; ly <= 1; ly++) {
                            for (let gy = ny; gy < ny + size.h; gy++) {
                                for (let gx = nx; gx < nx + size.w; gx++) {
                                    if (this._isOccupied(gx, gy, ly)) { isAreaFree = false; break; }
                                }
                                if (!isAreaFree) break;
                            }
                            if (!isAreaFree) break;
                        }
                        if (!isAreaFree) continue;

                        this.actionBuffer.push({ layer: layer, fn: () => {
                            // Set skipConnectivity (8th arg) to false to enforce strict placement
                            this._spawnBlock(nx, ny, size.w, size.h, layer, false, 0, false, true, true, false, false, 'block_spawner');
                        }});
                        spawnedCount++;
                    }
                }
            }

            // 2. Despawning Logic
            const despawnRate = Math.max(1, this._getGenConfig('BlockSpawnerDespawnRate') ?? 8);
            if (s.step >= startDelay && (s.step - startDelay) % despawnRate === 0) {
                const despawnCount = this._getGenConfig('BlockSpawnerDespawnCount') ?? 2;
                
                // Select blocks that are connected by 2 or less edges (directions)
                // RULE: Do not remove if two opposite edges are connected (e.g. N and S).
                // NEW: Do not remove if block overlaps the spine (X or Y axis) or age > 3 steps.
                const candidates = this.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;
                    
                    // --- PROTECTED BLOCKS ---
                    const overlapsYSpine = (b.x <= s.genOriginX && b.x + b.w - 1 >= s.genOriginX);
                    const overlapsXSpine = (b.y <= s.genOriginY && b.y + b.h - 1 >= s.genOriginY);
                    if (overlapsXSpine || overlapsYSpine) return false;

                    if (b.stepAge > 3) return false;

                    // --- CONNECTIVITY RULES ---
                    let north = false, south = false, west = false, east = false;
                    // North Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (this._isOccupied(x, b.y - 1, layer)) { north = true; break; } }
                    // South Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (this._isOccupied(x, b.y + b.h, layer)) { south = true; break; } }
                    // West Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (this._isOccupied(b.x - 1, y, layer)) { west = true; break; } }
                    // East Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (this._isOccupied(b.x + b.w, y, layer)) { east = true; break; } }
                    
                    const count = (north?1:0) + (south?1:0) + (west?1:0) + (east?1:0);
                    if (count > 2) return false;
                    if (count === 2) {
                        if ((north && south) || (west && east)) return false; // Opposite edges (bridge/line)
                    }
                    return true;
                });
                
                if (candidates.length > 0) {
                    Utils.shuffle(candidates);
                    const toRemove = candidates.slice(0, despawnCount);
                    for (const b of toRemove) {
                        this.actionBuffer.push({ layer: layer, fn: () => {
                            this._removeBlock(b.x, b.y, b.w, b.h, b.layer, true);
                        }});
                    }
                }
            }
        }, { enabled: this._getGenConfig('BlockSpawnerEnabled') ?? false, label: 'Block Spawner/Despawner' });

        this.registerBehavior('spreading_nudge', function(s) {
            const startDelay = this._getGenConfig('SpreadingNudgeStartDelay') ?? 20;
            if (s.step < startDelay) return;

            const targetLayer = 1;
            const allowed = this._getAllowedDirs(targetLayer);

            // State Initialization
            if (!s.spreadingNudgeNextDist) {
                s.spreadingNudgeNextDist = { 'V1': 1, 'V-1': 1, 'H1': 1, 'H-1': 1 };
                s.spreadingNudgeNextSpawnStep = s.spreadingNudgeNextSpawnStep || { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
            }

            const spawnSpeed   = this._getGenConfig('SpreadingNudgeSpawnSpeed') ?? 1;
            const spreadDensity = this._getGenConfig('SpreadingNudgeRange') ?? 0.5;
            const growthChance  = this._getGenConfig('SpreadingNudgeChance') ?? 0.8;
            const maxInstances  = this._getGenConfig('SpreadingNudgeMaxInstances') ?? 20;
            const preferSymmetry = this._getGenConfig('SpreadingNudgeSymmetry') ?? true;

            const arms = [
                { key: 'V1',  vert: true,  side: 1,  perp: ['E', 'W'], dir: 'S' }, // South Axis -> Spawns E/W
                { key: 'V-1', vert: true,  side: -1, perp: ['E', 'W'], dir: 'N' }, // North Axis -> Spawns E/W
                { key: 'H1',  vert: false, side: 1,  perp: ['N', 'S'], dir: 'E' }, // East Axis -> Spawns N/S
                { key: 'H-1', vert: false, side: -1, perp: ['N', 'S'], dir: 'W' }  // West Axis -> Spawns N/S
            ];

            // 1. Process Symmetry Queue
            if (s.spreadingNudgeSymmetryQueue && s.spreadingNudgeSymmetryQueue.length > 0) {
                const pending = [];
                for (const item of s.spreadingNudgeSymmetryQueue) {
                    if (s.step >= item.stepToSpawn) {
                        if (!allowed || allowed.has(item.dir) || (item.arm && allowed.has(item.arm))) {
                            const strip = this._createStrip(item.layer, item.dir, item.x, item.y);
                            strip.isNudge = item.isNudge || false;
                            strip.bypassOccupancy = item.bypassOccupancy || false;
                            strip.arm = item.arm;
                            strip.stepPhase = Math.floor(Math.random() * 6);
                        }
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
                // QUADRANT CHECK
                if (allowed && !allowed.has(arm.dir)) continue;

                // Check if it's time for this arm to advance
                if (s.step >= (s.spreadingNudgeNextSpawnStep[arm.key] || 0)) {
                    let d = s.spreadingNudgeNextDist[arm.key];
                    const ax = arm.vert ? s.genOriginX : s.genOriginX + d * arm.side;
                    const ay = arm.vert ? s.genOriginY + d * arm.side : s.genOriginY;

                    // Boundary check
                    if (Math.abs(ax - s.genOriginX) > halfW || Math.abs(ay - s.genOriginY) > halfH) {
                        // Reach edge, stop this arm
                        s.spreadingNudgeNextSpawnStep[arm.key] = Infinity;
                        continue;
                    }

                    // Axial point growth (Harden/Nudge logic at the spreader head)
                    const cycle = s.spreadingNudgeCycles[arm.key];
                    const { bw, bh } = this._calcBlockSize({ originX: ax, originY: ay, direction: arm.dir }, s.fillRatio);
                    this._attemptNudgeGrowthWithParams(targetLayer, bw, bh, ax, ay, cycle, growthChance);

                    if (preferSymmetry) {
                        const mirAx = arm.vert ? ax : s.genOriginX - (ax - s.genOriginX);
                        const mirAy = arm.vert ? s.genOriginY - (ay - s.genOriginY) : ay;
                        const mirCycle = s.spreadingNudgeCycles[arm.key + '_mir'] || { step: 0, lastTempBlock: null };
                        s.spreadingNudgeCycles[arm.key + '_mir'] = mirCycle;
                        this._attemptNudgeGrowthWithParams(targetLayer, bw, bh, mirAx, mirAy, mirCycle, growthChance);
                    }

                    // Spawn perpendicular "solid" strips to fill the area
                    if (activePerpStrips < maxInstances && Math.random() < spreadDensity) {
                        for (const dir of arm.perp) {
                            if (activePerpStrips >= maxInstances) break;
                            // RELAXATION: Allow spawning perp strips if the parent arm is allowed
                            if (allowed && !allowed.has(dir) && !allowed.has(arm.dir)) continue;

                            const strip = this._createStrip(targetLayer, dir, ax, ay);
                            strip.isNudge = false; // Solid growth
                            strip.bypassOccupancy = true; // No holes, uninterrupted
                            strip.growCount = 0;
                            strip.arm = arm.dir; // Mark as branch of this arm
                            activePerpStrips++;

                            if (preferSymmetry) {
                                const mirX = arm.vert ? ax : s.genOriginX - (ax - s.genOriginX);
                                const mirY = arm.vert ? s.genOriginY - (ay - s.genOriginY) : ay;
                                const mirDir = dir === 'N' ? 'S' : (dir === 'S' ? 'N' : (dir === 'E' ? 'W' : 'E'));
                                s.spreadingNudgeSymmetryQueue.push({
                                    x: mirX, y: mirY, layer: targetLayer, dir: mirDir,
                                    isNudge: false, bypassOccupancy: true, arm: arm.dir,
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
        }, { enabled: this._getGenConfig('SpreadingNudgeEnabled') ?? false, label: 'Spreading Nudge' });

        // ── Shove Fill ─────────────────────────────────────────────────────────
        this.registerBehavior('shove_fill', function(s) {
            if (!this._getGenConfig('ShoveFillEnabled')) return;
            const startDelay = this._getGenConfig('ShoveFillStartDelay') ?? 20;
            const fillRate   = Math.max(1, this._getGenConfig('ShoveFillRate') ?? 4);
            if (s.step < startDelay || (s.step - startDelay) % fillRate !== 0) return;

            const targetLayer = 1;
            const allowed = this._getAllowedDirs(targetLayer);
            const allowAsymmetry = !!this._getGenConfig('AllowAsymmetry');
            const bs    = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2);
            const halfH = Math.floor(this.g.rows / bs.h / 2);
            const proxW = Math.max(2, Math.floor(halfW * 0.25));
            const proxH = Math.max(2, Math.floor(halfH * 0.25));
            const shoveAmount = Math.max(1, this._getGenConfig('ShoveFillAmount') ?? 1);

            if (!s.shoveStrips) s.shoveStrips = [];
            s.shoveStrips = s.shoveStrips.filter(st => st.active);

            if (s.shoveStrips.length === 0) {
                const qCount    = Math.min(4, parseInt(this._getGenConfig('QuadrantCount') ?? 4));
                const availDirs = ['N', 'S', 'E', 'W'].filter(d => !allowed || allowed.has(d));
                if (availDirs.length === 0) return;
                const count = Math.min(qCount, availDirs.length);
                const chosen = [...availDirs].sort(() => Math.random() - 0.5).slice(0, count);

                for (const dir of chosen) {
                    const isEW = dir === 'E' || dir === 'W';
                    const width = 1 + Math.floor(Math.random() * 3);
                    if (isEW) {
                        const perpMid   = s.genOriginY + Math.round((Math.random() * 2 - 1) * proxH);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStrips.push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.genOriginX + (dir === 'E' ? 2 : -2), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
                    } else {
                        const perpMid   = s.genOriginX + Math.round((Math.random() * 2 - 1) * proxW);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStrips.push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.genOriginY + (dir === 'S' ? 2 : -2), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
                    }
                }
            }

            for (const strip of s.shoveStrips) {
                if (!strip.active) continue;
                if (allowed && !allowed.has(strip.dir)) continue; // QUADRANT CHECK
                if (allowAsymmetry && ((s.step - startDelay + strip.phaseOff) % Math.max(2, fillRate)) !== 0) continue;

                const isEW = strip.dir === 'E' || strip.dir === 'W';
                const step = (strip.dir === 'E' || strip.dir === 'S') ? 1 : -1;
                const rangeSize = strip.perpEnd - strip.perpStart + 1;

                const numSteps = 1 + Math.floor(Math.random() * shoveAmount);

                for (let i = 0; i < numSteps; i++) {
                    const lp = strip.leadPos;
                    if (isEW ? (strip.dir === 'E' ? lp > halfW : lp < -halfW)
                             : (strip.dir === 'S' ? lp > halfH : lp < -halfH)) {
                        strip.active = false;
                        break;
                    }

                    const bp = lp - step;
                    if (isEW) {
                        // Vertical strip (X=fixed, Y=range) -> 1x1, 1x2, or 1x3 block
                        this.actionBuffer.push({ layer: targetLayer, fn: () => this._spawnBlock(lp, strip.perpStart, 1, rangeSize, targetLayer, false, 0, true, true, true, false, true) });
                        this.actionBuffer.push({ layer: targetLayer, fn: () => this._spawnBlock(bp, strip.perpStart, 1, rangeSize, targetLayer, false, 0, true, true, true, false, true) });
                    } else {
                        // Horizontal strip (Y=fixed, X=range) -> 1x1, 2x1, or 3x1 block
                        this.actionBuffer.push({ layer: targetLayer, fn: () => this._spawnBlock(strip.perpStart, lp, rangeSize, 1, targetLayer, false, 0, true, true, true, false, true) });
                        this.actionBuffer.push({ layer: targetLayer, fn: () => this._spawnBlock(strip.perpStart, bp, rangeSize, 1, targetLayer, false, 0, true, true, true, false, true) });
                    }

                    strip.leadPos += step;
                }
            }
        }, { enabled: this._getGenConfig('ShoveFillEnabled') ?? false, label: 'Shove Fill' });

        // Behavior: Block Thicken — picks a random axis line and thickens blocks along it
        this.registerBehavior('block_thicken', function(s) {
            const startDelay = this._getGenConfig('BlockThickenStartDelay') ?? 10;
            const spawnFreq  = Math.max(1, this._getGenConfig('BlockThickenSpawnFrequency') ?? 5);
            const spawnChance = (this._getGenConfig('BlockThickenSpawnChance') ?? 50) / 100;
            const layer = 1;

            // Timing gate
            if (s.step < startDelay) return;
            if ((s.step - startDelay) % spawnFreq !== 0) return;

            // Chance gate
            if (Math.random() > spawnChance) return;

            const bs = this.getBlockSize();
            const xVis = Math.ceil(this.g.cols / bs.w / 2) + 2;
            const yVis = Math.ceil(this.g.rows / bs.h / 2) + 2;

            // Pick a random axis: 0 = X (vertical line), 1 = Y (horizontal line)
            const axis = Math.random() < 0.5 ? 0 : 1;

            // Collect all occupied coordinates on the chosen axis to pick from
            const occupiedLines = new Set();
            const blocks = this.activeBlocks.filter(b => b.layer === layer);
            for (const b of blocks) {
                if (axis === 0) {
                    // X axis — collect all unique x values covered by this block
                    for (let x = b.x; x < b.x + b.w; x++) occupiedLines.add(x);
                } else {
                    // Y axis — collect all unique y values covered by this block
                    for (let y = b.y; y < b.y + b.h; y++) occupiedLines.add(y);
                }
            }

            if (occupiedLines.size === 0) return;

            // Pick a random line from the occupied set
            const lineArr = [...occupiedLines];
            const chosenLine = lineArr[Math.floor(Math.random() * lineArr.length)];

            // Find all blocks that intersect this line
            const lineBlocks = blocks.filter(b => {
                if (axis === 0) {
                    return b.x <= chosenLine && b.x + b.w - 1 >= chosenLine;
                } else {
                    return b.y <= chosenLine && b.y + b.h - 1 >= chosenLine;
                }
            });

            if (lineBlocks.length === 0) return;

            // For each block on this line, try to add blocks on both sides along the perpendicular axis
            for (const b of lineBlocks) {
                if (axis === 0) {
                    // Line is vertical (X = chosenLine), thicken along X (add columns left and right)
                    // Walk left (x-1, x-2, ...) and right (x+w, x+w+1, ...) adding 1-wide columns
                    // as long as there are adjacent occupied cells on the perpendicular axis (Y)
                    const thickenSide = (startX, dx) => {
                        let tx = startX;
                        while (Math.abs(tx) <= xVis) {
                            // Check: does this column have any adjacent occupied neighbor on Y that connects?
                            let hasAdjacentEdge = false;
                            for (let ty = b.y; ty < b.y + b.h; ty++) {
                                if (this._isOccupied(tx, ty, layer)) { hasAdjacentEdge = false; break; }
                                // Check if there's a block above or below connecting
                                if (this._isOccupied(tx, ty - 1, layer) || this._isOccupied(tx, ty + 1, layer)) {
                                    hasAdjacentEdge = true;
                                }
                            }
                            if (!hasAdjacentEdge) break;
                            // Spawn a column of blocks at tx covering the same Y span
                            for (let ty = b.y; ty < b.y + b.h; ty++) {
                                if (!this._isOccupied(tx, ty, layer)) {
                                    const ftx = tx, fty = ty;
                                    this.actionBuffer.push({ layer, fn: () => {
                                        this._spawnBlock(ftx, fty, 1, 1, layer, false, 0, true, true, true, false, true, 'block_thicken');
                                    }});
                                }
                            }
                            tx += dx;
                        }
                    };
                    thickenSide(b.x - 1, -1); // Thicken left
                    thickenSide(b.x + b.w, 1); // Thicken right
                } else {
                    // Line is horizontal (Y = chosenLine), thicken along Y (add rows above and below)
                    const thickenSide = (startY, dy) => {
                        let ty = startY;
                        while (Math.abs(ty) <= yVis) {
                            let hasAdjacentEdge = false;
                            for (let tx = b.x; tx < b.x + b.w; tx++) {
                                if (this._isOccupied(tx, ty, layer)) { hasAdjacentEdge = false; break; }
                                if (this._isOccupied(tx - 1, ty, layer) || this._isOccupied(tx + 1, ty, layer)) {
                                    hasAdjacentEdge = true;
                                }
                            }
                            if (!hasAdjacentEdge) break;
                            for (let tx = b.x; tx < b.x + b.w; tx++) {
                                if (!this._isOccupied(tx, ty, layer)) {
                                    const ftx = tx, fty = ty;
                                    this.actionBuffer.push({ layer, fn: () => {
                                        this._spawnBlock(ftx, fty, 1, 1, layer, false, 0, true, true, true, false, true, 'block_thicken');
                                    }});
                                }
                            }
                            ty += dy;
                        }
                    };
                    thickenSide(b.y - 1, -1); // Thicken above
                    thickenSide(b.y + b.h, 1); // Thicken below
                }
            }
        }, { enabled: this._getGenConfig('BlockThickenEnabled') ?? false, label: 'Block Thicken' });

        this.registerBehavior('hole_filler', function(s) {
            if (!this._getGenConfig('HoleFillerEnabled')) return;
            const fillRate = Math.max(1, this._getGenConfig('HoleFillerRate') ?? 1);
            if (s.step % fillRate !== 0) return;

            const layer = 1;
            const w = this.logicGridW, h = this.logicGridH;
            const grid = this.layerGrids[layer];
            if (!grid) return;

            const bs = this.getBlockSize();
            const xVis = Math.ceil(this.g.cols / bs.w / 2) + 2;
            const yVis = Math.ceil(this.g.rows / bs.h / 2) + 2;

            if (s.holeQIdx === undefined) s.holeQIdx = 0;
            const q = s.holeQIdx;
            s.holeQIdx = (s.holeQIdx + 1) % 4;

            let minX = (q === 0 || q === 3) ? -xVis : 0;
            let maxX = (q === 0 || q === 3) ? 0 : xVis;
            let minY = (q === 0 || q === 1) ? -yVis : 0;
            let maxY = (q === 0 || q === 1) ? 0 : yVis;

            const scanMinX = -xVis, scanMaxX = xVis;
            const scanMinY = -yVis, scanMaxY = yVis;
            const scanW = scanMaxX - scanMinX + 1, scanH = scanMaxY - scanMinY + 1;
            const outsideMap = this._getBuffer('hfOutside', scanW * scanH, Uint8Array);
            outsideMap.fill(0);
            const getIdx = (bx, by) => (by - scanMinY) * scanW + (bx - scanMinX);

            const maxLayerCheck = this._getMaxLayer();
            const isOccupiedAny = (bx, by) => {
                for (let l = 0; l <= maxLayerCheck; l++) {
                    if (this._isOccupied(bx, by, l)) return true;
                }
                return false;
            };

            const queue = this._getBuffer('hfQueue', scanW * scanH, Int32Array);
            let head = 0, tail = 0;

            const add = (bx, by) => {
                if (bx < scanMinX || bx > scanMaxX || by < scanMinY || by > scanMaxY) return;
                const idx = getIdx(bx, by);
                if (outsideMap[idx] === 0 && !isOccupiedAny(bx, by)) {
                    outsideMap[idx] = 1;
                    queue[tail++] = idx;
                }
            };

            for (let bx = scanMinX; bx <= scanMaxX; bx++) { add(bx, scanMinY); add(bx, scanMaxY); }
            for (let by = scanMinY; by <= scanMaxY; by++) { add(scanMinX, by); add(scanMaxX, by); }

            while (head < tail) {
                const idx = queue[head++];
                const bx = scanMinX + (idx % scanW);
                const by = scanMinY + Math.floor(idx / scanW);
                add(bx + 1, by); add(bx - 1, by); add(bx, by + 1); add(bx, by - 1);
            }

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (!this._isOccupied(bx, by, layer)) {
                        const isEnclosed = outsideMap[getIdx(bx, by)] === 0;
                        
                        // Also check for "Small Gaps" (3 or 4 cardinal neighbors are full on any layer)
                        let neighborCount = 0;
                        if (isOccupiedAny(bx - 1, by)) neighborCount++;
                        if (isOccupiedAny(bx + 1, by)) neighborCount++;
                        if (isOccupiedAny(bx, by - 1)) neighborCount++;
                        if (isOccupiedAny(bx, by + 1)) neighborCount++;
                        const isSmallGap = (neighborCount >= 3);

                        if (isEnclosed || isSmallGap) {
                            this.actionBuffer.push({ layer, fn: () => {
                                this._spawnBlock(bx, by, 1, 1, layer, false, 0, true, true, true, false, true);
                            }});
                        }
                    }
                }
            }
        }, { enabled: true, label: 'Aggressive Hole Filler' });

        // ── Axis Shift ───────────────────────────────────────────────────────
        // Treats newly placed lines of blocks as sub-axes, spawning strips
        // in all 4 directions from a point along the line — exactly like the
        // main seed-schedule creates spine strips from the primary origin.
        // NOTE: This behavior is ticked deterministically every step (not via
        // the random behavior pool) because it must track strip growth over
        // time — strips are deleted when deactivated, so we snapshot them as
        // they qualify.
        this.registerBehavior('axis_shift', function(s) {
            const startDelay = this._getGenConfig('AxisShiftStartDelay') ?? 15;
            const rate = Math.max(1, this._getGenConfig('AxisShiftRate') ?? 5);
            const maxAxes = this._getGenConfig('AxisShiftMaxAxes') ?? 10;
            const minLength = this._getGenConfig('AxisShiftMinLength') ?? 3;
            const layer = 1;

            // Initialize state
            if (!s.axisShiftAxes) s.axisShiftAxes = [];
            if (!s.axisShiftUsedStrips) s.axisShiftUsedStrips = new Set();
            if (!s.axisShiftCandidates) s.axisShiftCandidates = [];

            // Continuously snapshot strips that have grown enough — they may
            // become inactive (and get deleted from this.strips) before we
            // get around to using them, so capture their info now.
            for (const strip of this.strips.values()) {
                if (s.axisShiftUsedStrips.has(strip.id)) continue;
                if (strip.growCount >= minLength) {
                    s.axisShiftUsedStrips.add(strip.id);
                    s.axisShiftCandidates.push({
                        id: strip.id,
                        direction: strip.direction,
                        originX: strip.originX,
                        originY: strip.originY,
                        growCount: strip.growCount
                    });
                }
            }

            if (s.step < startDelay) return;
            if ((s.step - startDelay) % rate !== 0) return;

            // Cap check
            if (s.axisShiftAxes.length >= maxAxes) return;
            if (s.axisShiftCandidates.length === 0) return;

            const allowed = this._getAllowedDirs(layer);

            // Pick a random candidate from the snapshot pool
            const idx = Math.floor(Math.random() * s.axisShiftCandidates.length);
            const candidate = s.axisShiftCandidates.splice(idx, 1)[0];

            // Pick a point along the line as the new sub-origin
            const [dx, dy] = this._dirDelta(candidate.direction);
            const offset = 1 + Math.floor(Math.random() * Math.max(1, candidate.growCount - 1));
            const subOriginX = candidate.originX + dx * offset;
            const subOriginY = candidate.originY + dy * offset;

            // Create spine-like strips from the sub-origin
            const boost = this._getGenConfig('SpineBoost') ?? 4;
            const subBoost = Math.max(1, Math.floor(boost / 2));
            const spawnAmount = Math.min(4, Math.max(1, this._getGenConfig('AxisShiftSpawnAmount') ?? 4));
            const dirs = ['N', 'S', 'E', 'W'];
            Utils.shuffle(dirs);

            let spawned = 0;
            for (const dir of dirs) {
                if (spawned >= spawnAmount) break;
                // Relaxed quadrant check: allow if direction OR parent arm is allowed
                if (allowed && !allowed.has(dir) && !allowed.has(candidate.direction)) continue;

                spawned++;
                this.actionBuffer.push({ layer, fn: () => {
                    const strip = this._createStrip(layer, dir, subOriginX, subOriginY);
                    strip.isSpine = true;
                    strip.boostSteps = subBoost;
                    strip.pattern = this._generateInsideOutPattern();
                    strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
                    strip.arm = candidate.direction;
                }});
            }

            s.axisShiftAxes.push({
                x: subOriginX, y: subOriginY,
                step: s.step, parentDir: candidate.direction
            });
        }, { enabled: this._getGenConfig('AxisShiftEnabled') ?? false, label: 'Axis Shift' });
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
        const genScaling = !!this._getGenConfig('GenerativeScaling');
        let userMax = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
        
        // 1. Determine Min/Max Counts based on Fill Ratio (as per instructions)
        let minCount = 1, maxCount = userMax;
        if (genScaling) {
            if (s.fillRatio < 0.15) { maxCount = Math.min(userMax, 2); minCount = 1; }
            else if (s.fillRatio < 0.30) { maxCount = Math.min(userMax, 3); minCount = 2; }
            else { maxCount = userMax; minCount = userMax; }
        } else {
            minCount = userMax; maxCount = userMax;
        }

        if (!s.dirPools) s.dirPools = { 0: [], 1: [] };
        if (!s.lastLayerDirs) s.lastLayerDirs = { 0: null, 1: null };

        const all = ['N', 'S', 'E', 'W'];

        for (let l = 0; l <= 1; l++) {
            // Pick a random count for this step within the allowed range
            let count = (minCount === maxCount) ? minCount : Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
            
            // If 4 directions are allowed, we set to null (all active)
            if (count >= 4) {
                if (s.layerDirs[l] !== null) {
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = null; } });
                    s.lastLayerDirs[l] = null;
                }
                continue;
            }

            let pool = s.dirPools[l];
            let selected = new Set();
            
            // Fairness and Variation Logic: "Different than previous" + "Each gets a turn"
            for (let attempt = 0; attempt < 5; attempt++) {
                selected.clear();
                // Ensure the pool has enough directions for this turn
                if (pool.length < count) {
                    const fresh = [...all];
                    Utils.shuffle(fresh);
                    s.dirPools[l] = pool = [...pool, ...fresh];
                }
                
                // Peek at the first 'count' directions
                const candidates = pool.slice(0, count);
                for (const d of candidates) selected.add(d);

                // Verify "Different than previous step"
                const last = s.lastLayerDirs[l];
                let isSame = false;
                if (last && last.size === selected.size) {
                    isSame = true;
                    for (const d of selected) {
                        if (!last.has(d)) { isSame = false; break; }
                    }
                }

                // If it's unique or we've exhausted attempts, commit this choice
                if (!isSame || attempt === 4) {
                    pool.splice(0, count);
                    break;
                } else {
                    // If it was the same, reshuffle the pool to ensure variation
                    Utils.shuffle(pool);
                }
            }

            this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = selected; } });
            s.lastLayerDirs[l] = selected;
        }
    }

    _generateInsideOutPattern() {
        const p = [true, true, true];
        const p1 = Math.floor(Math.random() * 3);
        p[p1] = false;
        // 50% chance for a second pause in the 3-step segment
        if (Math.random() < 0.5) {
            let p2;
            do { p2 = Math.floor(Math.random() * 3); } while (p2 === p1);
            p[p2] = false;
        }
        return p;
    }

    _generateInsideOutDistinctPattern(existing) {
        let attempt;
        do { attempt = this._generateInsideOutPattern(); } while (attempt.join() === existing.join());
        return attempt;
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
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;

        // Compute per-direction boost based on canvas aspect ratio
        const baseBoost = this._getGenConfig('SpineBoost') ?? 4;
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
        // Seed all layers in the schedule to ensure they start connected to the spines
        for (let l = minL; l <= maxLayer; l++) {
            const stepOffset = (l === minL || l === 1) ? 0 : (l * 2);
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => {
                addToSchedule(l, d, [stepOffset, stepOffset + 1, stepOffset + 2]);
            });
        }
        return schedule;
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        const globalBoost = this._getGenConfig('SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY, boost } of scheduled) {
            this.actionBuffer.push({ layer, fn: () => {
                const strip = this._createStrip(layer, dir, originX, originY);
                strip.isSpine = true;
                strip.boostSteps = boost ?? globalBoost;
                strip.pattern = this._generateInsideOutPattern();
                strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
            }});
        }
    }

    _deactivateStrip(strip) { strip.active = false; this.strips.delete(strip.id); }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = {
            id, layer, direction: dir, originX, originY, headX: originX, headY: originY,
            pattern: this._getStepPattern(), pausePattern: this._getPausePattern(),
            stepPhase: 0, growCount: 0, stepsSinceLastGrowth: 0, paused: false, active: true, blockIds: [],
            startDelay: 0
        };
        this.strips.set(id, strip);
        return strip;
    }

    _tickStrips(s) {
        const allowAsymmetry = !!this._getGenConfig('AllowAsymmetry');
        const useGenerativeScaling = !!this._getGenConfig('GenerativeScaling');

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
                    s.deferredCols.set(s.genOriginX + colOffset, 1 + Math.floor(Math.random() * 2));
                } else {
                    const rowOffset = Math.floor((Math.random() * 2 - 1) * (halfH + 5));
                    s.deferredRows.set(s.genOriginY + rowOffset, 1 + Math.floor(Math.random() * 2));
                }
            }
        }
        
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            if (strip.startDelay > 0) {
                strip.startDelay--;
                continue;
            }

            const allowed = this._getAllowedDirs(strip.layer);
            // RELAXATION: Allow growth if the direction IS allowed OR if the strip belongs to an allowed ARM (quadrant branch).
            const isBranchOfAllowedArm = strip.arm && allowed && allowed.has(strip.arm);
            if (allowed && !allowed.has(strip.direction) && !isBranchOfAllowedArm) continue; // QUADRANT RESTRICTION

            strip.stepsSinceLastGrowth = (strip.stepsSinceLastGrowth || 0) + 1;

            if (allowAsymmetry && strip.layer < 2) {
                if (s.deferredCols?.has(strip.headX) || s.deferredRows?.has(strip.headY)) continue;
            }
            
            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                if (strip.isExpansion || strip.isSpine) {
                    strip.pattern = this._generateInsideOutPattern();
                    strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
                } else {
                    strip.pattern = this._generateRandomPattern();
                    strip.pausePattern = this._generateDistinctPattern(strip.pattern);
                }
            }

            let shouldGrow = false;
            // Spine boost takes precedence, but Generative Scaling overrides frequency if enabled
            // If it's a spine, we now force it to follow the rhythmic behavior.
            if (strip.boostSteps > 0 && !useGenerativeScaling && !strip.isSpine) { 
                shouldGrow = true; 
                strip.boostSteps--; 
            } else {
                if (useGenerativeScaling && strip.growCount < 7 && !strip.isExpansion && !strip.isSpine) {
                    // Stage 1-2: 1 block taking 3 steps (gc 0,1)
                    // Stage 3-4: 1-2 blocks taking 2 steps (gc 2,3)
                    // Stage 5+: 1 block per step (gc 4+)
                    const gc = strip.growCount;
                    const requiredSteps = (gc < 2) ? 3 : (gc < 4) ? 2 : 1;
                    if (strip.stepsSinceLastGrowth >= requiredSteps) {
                        shouldGrow = true;
                    }
                } else {
                    const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                    const phase = (strip.isExpansion || strip.isSpine) ? (strip.stepPhase % 3) : (strip.stepPhase % pattern.length);
                    shouldGrow = pattern[phase];
                    if (shouldGrow && strip.isSpine && strip.boostSteps > 0) strip.boostSteps--;
                }
            }

            if (shouldGrow && strip.isExpansion) {
                const [dx, dy] = this._dirDelta(strip.direction);
                const { bw, bh } = this._calcBlockSize(strip, s.fillRatio);
                const nextX = strip.headX + dx * bw, nextY = strip.headY + dy * bh;
                const scx = s.genOriginX || 0, scy = s.genOriginY || 0;
                const limitN = s.axisMaxDist.N - 2, limitS = s.axisMaxDist.S - 2;
                const limitE = s.axisMaxDist.E - 2, limitW = s.axisMaxDist.W - 2;

                if (!s.hitEdge?.N && dy < 0 && (scy - nextY) > limitN) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.S && dy > 0 && (nextY - scy) > limitS) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.E && dx > 0 && (nextX - scx) > limitE) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.W && dx < 0 && (scx - nextX) > limitW) {
                    shouldGrow = false;
                }
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
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));

        if (this._getGenConfig('GenerativeScaling')) {
            if (strip.isExpansion || strip.isSpine) {
                const ratio = visW / visH;
                // Double-growth based on aspect ratio to ensure expansion reaches all edges roughly together.
                if (ratio > 1.05 && (strip.direction === 'E' || strip.direction === 'W')) {
                    const baseSize = Math.floor(ratio);
                    const chance = ratio - baseSize;
                    const size = Math.random() < chance ? baseSize + 1 : baseSize;
                    return { bw: size, bh: 1 };
                }
                if (ratio < 0.95 && (strip.direction === 'N' || strip.direction === 'S')) {
                    const invRatio = 1.0 / ratio;
                    const baseSize = Math.floor(invRatio);
                    const chance = invRatio - baseSize;
                    const size = Math.random() < chance ? baseSize + 1 : baseSize;
                    return { bw: 1, bh: size };
                }
            }
            return { bw: 1, bh: 1 };
        }

        const fillThreshold = this._getGenConfig('FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };
        const maxScale = this._getGenConfig('MaxBlockScale') ?? 3;
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
        const edges = this.checkScreenEdge(newHeadX, newHeadY);
        if (edges) {
            if (s.hitEdge) {
                if (edges.top) s.hitEdge.N = true;
                if (edges.bottom) s.hitEdge.S = true;
                if (edges.left) s.hitEdge.W = true;
                if (edges.right) s.hitEdge.E = true;
            }
            this._deactivateStrip(strip);
            return;
        }
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
                strip.stepsSinceLastGrowth = 0;
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
                    strip.stepsSinceLastGrowth = 0;
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
        if (!this._getGenConfig('InsideOutEnabled')) return;
        const delay = this._getGenConfig('InsideOutDelay') ?? 6;
        let bucketPeriod = Math.max(1, this._getGenConfig('InsideOutStepsBetweenBuckets') ?? 3);

        const genScaling = !!this._getGenConfig('GenerativeScaling');
        if (genScaling) {
            // Adjust density by reducing steps between buckets instead of increasing block size.
            // Reduce period by 1-2 steps based on current fill ratio to increase density.
            const reduction = s.fillRatio < 0.4 ? 2 : (s.fillRatio < 0.7 ? 1 : 0);
            bucketPeriod = Math.max(1, bucketPeriod - reduction);
        }

        if (s.step < delay || (s.step - delay) % bucketPeriod !== 0) return;

        const bucketSize = Math.max(1, this._getGenConfig('InsideOutBucketSize') ?? 3);
        const bs = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2), halfH = Math.floor(this.g.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = this._getMaxLayer();
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;
        const endL = Math.min(1, maxLayer);

        if (!s.insideOutProgression) s.insideOutProgression = {};

        // Helper: Check if the dependency wave (last wave of previous bucket) has started growing
        const prevBucketStarted = (arm, baseWave) => {
            if (baseWave <= 1) return true;
            const depWave = baseWave - 1;
            let foundAny = false;
            for (const strip of this.strips.values()) {
                if (strip.isExpansion && strip.arm === arm && strip.wave === depWave) {
                    foundAny = true;
                    if (strip.growCount > 0) return true;
                }
            }
            return !foundAny;
        };

        for (const arm of ['N', 'S', 'E', 'W']) {
            if (!s.insideOutProgression[arm]) {
                s.insideOutProgression[arm] = { nextWave: 1 };
            }
            const prog = s.insideOutProgression[arm];
            const baseWave = prog.nextWave;

            // 1. Boundary Check for the base wave
            const [dx, dy] = this._dirDelta(arm);
            const bx = s.genOriginX + dx * baseWave, by = s.genOriginY + dy * baseWave;
            if (Math.abs(bx - s.genOriginX) > halfW + edgeBuf || Math.abs(by - s.genOriginY) > halfH + edgeBuf) continue;

            // 2. Progression Check: Wait for previous bucket to establish
            if (!prevBucketStarted(arm, baseWave)) continue;

            // 3. Spine Connectivity Gate: Only spawn bucket if the first wave's origin is established
            if (!this._isOccupied(bx, by, 0) && !this._isOccupied(bx, by, 1)) continue;

            // Prepare waves for this bucket
            const waves = [];
            for (let i = 0; i < bucketSize; i++) waves.push(baseWave + i);
            
            // Shuffled variance within the bucket (if > 1, and not the first wave)
            if (bucketSize > 1 && baseWave > 1) {
                Utils.shuffle(waves);
            }

            let spawnedAnyInBucket = false;
            for (let l = minL; l <= endL; l++) {
                const allowed = this._getAllowedDirs(l);
                if (allowed && !allowed.has(arm)) continue;

                for (const wave of waves) {
                    const ox = s.genOriginX + dx * wave, oy = s.genOriginY + dy * wave;

                    // Wave-specific boundary check
                    if (Math.abs(ox - s.genOriginX) > halfW + edgeBuf || Math.abs(oy - s.genOriginY) > halfH + edgeBuf) continue;

                    // Generative Scaling
                    if (genScaling) {
                        let activeExp = 0;
                        for (const st of this.strips.values()) if (st.isExpansion && st.active) activeExp++;
                        if (activeExp > (8 * (l + 1))) continue; 
                    }

                    const perp1 = (arm === 'N' || arm === 'S') ? 'E' : 'N';
                    const perp2 = (arm === 'N' || arm === 'S') ? 'W' : 'S';

                    const startDelay = Math.floor(Math.random() * bucketSize);
                    const ioPattern = this._generateInsideOutPattern();
                    const ioPausePattern = this._generateInsideOutDistinctPattern(ioPattern);
                    this.actionBuffer.push({ layer: l, fn: () => {
                        const s1 = this._createStrip(l, perp1, ox, oy);
                        s1.isExpansion = true; s1.arm = arm; s1.wave = wave;
                        s1.startDelay = startDelay;
                        s1.pattern = ioPattern;
                        s1.pausePattern = ioPausePattern;
                        const s2 = this._createStrip(l, perp2, ox, oy);
                        s2.isExpansion = true; s2.arm = arm; s2.wave = wave;
                        s2.startDelay = startDelay;
                        s2.pattern = ioPattern;
                        s2.pausePattern = ioPausePattern;
                    }});
                    spawnedAnyInBucket = true;
                }
            }

            // Only advance to the next bucket if we successfully attempted to spawn this one
            if (spawnedAnyInBucket) {
                prog.nextWave += bucketSize;
            }
        }
    }

    _processIntents() {
        for (const intent of this.actionBuffer) {
            if (!this.actionQueues.has(intent.layer)) this.actionQueues.set(intent.layer, []);
            this.actionQueues.get(intent.layer).push(intent);
        }
        this.actionBuffer = [];
        for (const [layer, queue] of this.actionQueues.entries()) {
            // Iterate instead of shift() to avoid O(n^2) array reindexing
            for (let i = 0; i < queue.length; i++) {
                const intent = queue[i];
                if (intent && intent.fn) intent.fn();
            }
            queue.length = 0;
        }
    }

    checkScreenEdge(bx, by) {
        const bs = this.getBlockSize();
        const halfVisibleW = Math.floor(this.g.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.g.rows / bs.h / 2);
        const extension = 2;
        const limitW = halfVisibleW + extension;
        const limitH = halfVisibleH + extension;

        const left = bx <= -limitW, right = bx >= limitW;
        const top = by <= -limitH, bottom = by >= limitH;

        // Reuse a single cached object to avoid GC pressure in the hot strip-growth path
        if (left || right || top || bottom) {
            if (!this._edgeResult) this._edgeResult = { left: false, right: false, top: false, bottom: false };
            this._edgeResult.left = left; this._edgeResult.right = right;
            this._edgeResult.top = top; this._edgeResult.bottom = bottom;
            return this._edgeResult;
        }
        return false;
    }

    _updateAxisMaxDist(s) {
        if (!s.axisMaxDist) s.axisMaxDist = { N: 0, S: 0, E: 0, W: 0 };
        else { s.axisMaxDist.N = 0; s.axisMaxDist.S = 0; s.axisMaxDist.E = 0; s.axisMaxDist.W = 0; }
        
        const scx = s.genOriginX || 0, scy = s.genOriginY || 0;
        for (const strip of this.strips.values()) {
            if (!strip.isSpine || !strip.active) continue;
            const dx = strip.headX - scx, dy = strip.headY - scy;
            if (strip.direction === 'N') s.axisMaxDist.N = Math.max(s.axisMaxDist.N, -dy);
            else if (strip.direction === 'S') s.axisMaxDist.S = Math.max(s.axisMaxDist.S, dy);
            else if (strip.direction === 'E') s.axisMaxDist.E = Math.max(s.axisMaxDist.E, dx);
            else if (strip.direction === 'W') s.axisMaxDist.W = Math.max(s.axisMaxDist.W, -dx);
        }
    }

    _updateLayerMaxDist(s) {
        if (!s.layerMaxDist) s.layerMaxDist = {};
        const scx = s.genOriginX || 0, scy = s.genOriginY || 0;

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
        this._updateAxisMaxDist(s);
        this._updateLayerMaxDist(s);

        if (s.pendingDeletions && s.pendingDeletions.length > 0) {
            for (const d of s.pendingDeletions) this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
            s.pendingDeletions = [];
        }
        if (!s.seedSchedule) {
            s.pattern = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            if (!s.layerDirs) {
                const qCount = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
                const qMaxLayer = this._getMaxLayer();
                const qBaseLife = 4 + Math.floor(Math.random() * 3);
                const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
                const minL = usePromotion ? 1 : 0;

                s.layerDirs = {}; s.layerDirLife = {};
                for (let l = minL; l <= qMaxLayer + 1; l++) { 
                    s.layerDirs[l] = this._pickLayerDirs(qCount); 
                    s.layerDirLife[l] = qBaseLife + l; 
                }
            }
            s.seedSchedule = this._generateSeedSchedule(s.genOriginX ?? 0, s.genOriginY ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }
        s.growTimer++;
        this.actionBuffer = [];
        this._tickLayerDirs(s);
        this._updateFillRatio(s);
        this._seedStrips(s);

        // PERMANENT CORE BEHAVIOR: Main Nudge Growth
        if (this._getGenConfig('NudgeEnabled') !== false) {
            const nudgeStartDelay = this._getGenConfig('NudgeStartDelay') ?? 2;
            if (s.step >= nudgeStartDelay) {
                const nudgeChance = this._getGenConfig('NudgeChance') ?? 0.8;
                if (Math.random() <= nudgeChance) {
                    const { bw, bh } = this._calcBlockSize({ originX: s.genOriginX, originY: s.genOriginY, direction: 'N' }, s.fillRatio);
                    this._attemptNudgeGrowthWithParams(1, bw, bh, s.genOriginX, s.genOriginY);
                }
            }
        }

        this._tickStrips(s);
        this._expandInsideOut(s);

        // Axis Shift: tick deterministically every step (needs to snapshot
        // strips before they are deactivated/deleted by other behaviors).
        const axisShift = this.growthPool.get('axis_shift');
        if (axisShift && axisShift.enabled) {
            axisShift.fn.call(this, s);
        }

        // INCREMENT AGE OF ALL ACTIVE BLOCKS
        for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

        const quota = this.getConfig('SimultaneousSpawns') || 1;
        // Build enabled list without spread+filter allocation: reuse a scratch array
        if (!this._enabledBehaviorsBuf) this._enabledBehaviorsBuf = [];
        const enabledBehaviors = this._enabledBehaviorsBuf;
        enabledBehaviors.length = 0;
        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled && b !== axisShift) enabledBehaviors.push(b);
        }
        if (enabledBehaviors.length > 0) {
            for (let q = 0; q < quota; q++) {
                const b = enabledBehaviors[Math.floor(Math.random() * enabledBehaviors.length)];
                b.fn.call(this, s);
            }
        }

        this._processIntents();
        s.step++;
        this._updateRenderGridLogic();
        if (s.fillRatio > 0.98 && this.strips.size === 0) this.expansionComplete = true;
    }

    _isOccupied(x, y, layer) {
        const gx = this._gridCX + x, gy = this._gridCY + y;
        if (gx < 0 || gx >= this.logicGridW || gy < 0 || gy >= this.logicGridH) return false;
        const grid = this.layerGrids[layer];
        return !!grid && grid[gy * this.logicGridW + gx] !== -1;
    }

    _removeBlock(x, y, w, h, layer, fade = true) {
        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        this.maskOps.push({ type: 'removeBlock', x1, y1, x2, y2, layer: layer, startFrame: this.animFrame, fade: fade });
        
        // Record to sequence for Editor/Step support
        const isRecording = (this.manualStep) && this.sequence && !this.isReconstructing;
        if (isRecording) {
            const targetIdx = Math.max(0, this.expansionPhase - 1);
            if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
            this.sequence[targetIdx].push({
                op: 'removeBlock',
                args: [x1, y1, x2, y2, layer, 0, !fade],
                layer: layer
            });
        }

        // Splice instead of .filter() to avoid creating a new array each removal
        for (let i = this.activeBlocks.length - 1; i >= 0; i--) {
            const b = this.activeBlocks[i];
            if (b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h) {
                this.activeBlocks.splice(i, 1);
                break;
            }
        }
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
