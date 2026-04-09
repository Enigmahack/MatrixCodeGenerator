/**
 * QuantizedBaseEffect.js - Version 10.0.0
 */
class QuantizedBaseEffect extends AbstractEffect {
    static sharedRenderer = null;
    static sharedCharCache = new Map();
    static lastGridSeed = -1;
    static _preallocated = false;
    static isAnyQuantizedSwapping = false;
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
        this.logicScale = 1.5;
        
        // Shadow World Swap State
        this.hasSwapped = false;
        this.isSwapping = false;
        this.swapTimer = 0;
        this._savedBrightness = null; // Brightness saved by effects that modify it (e.g. Zoom); null = not active

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
                const s = this.behaviorState;
                const ox = s?.genOriginX || 0, oy = s?.genOriginY || 0;
                const nx = c.x + c.w / 2 - ox, ny = c.y + c.h / 2 - oy, newDistSq = nx * nx + ny * ny;
                if (c._foundAnchorIdx !== undefined) {
                    const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
                    const ax_abs = c._foundAnchorIdx % this.logicGridW, ay_abs = Math.floor(c._foundAnchorIdx / this.logicGridW);
                    const ax = ax_abs - cx - ox + 0.5, ay = ay_abs - cy - oy + 0.5, anchorDistSq = ax * ax + ay * ay;
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
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        // If promotion is active, we strictly only use Layer 1
        if (usePromotion) return 1;

        let val = this.getConfig('LayerCount');
        // If LayerCount is explicitly 1, we only want Layer 0.
        // If LayerCount is missing or 2, we default to 2 layers (maxLayer 1).
        if (val === 1) return 0;
        
        // Default to 2 layers (maxLayer 1)
        return 1;
    }

    _getMinLayer() {
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        return usePromotion ? 1 : 0;
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
                const fontData = (d.activeFonts && d.activeFonts[0]) || { name: null, chars: null };
                QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c, fontData.name, fontData.chars, 'SHARED');
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
            for (const i of this._savedActiveIndices) {
                if (eA) eA[i] = 0; if (eAl) eAl[i] = 0; if (eCh) eCh[i] = 0; if (eCo) eCo[i] = 0; if (eG) eG[i] = 0;
                if (oC) oC[i] = 0; if (oCo) oCo[i] = 0; if (oA) oA[i] = 0; if (oG) oG[i] = 0; if (oM) oM[i] = 0;
            }
            this._savedActiveIndices = null;
        } else if (this._savedActiveBlocks && this._savedActiveBlocks.length > 0) {
            const bs = this.getBlockSize();
            const cpX = bs.w;
            const cpY = bs.h;

            // Hoist null checks outside the loop
            const eA = g.effectActive, eAl = g.effectAlphas, eCh = g.effectChars, eCo = g.effectColors, eG = g.effectGlows;
            const oC = g.overrideChars, oCo = g.overrideColors, oA = g.overrideAlphas, oG = g.overrideGlows, oM = g.overrideMix;
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
                    }
                }
            }
            this._savedActiveBlocks = null;
        } else {
            // Fallback for first run — fill only OVERLAY buffers (effect + override).
            // Do NOT clear simulation arrays (mix, complexStyles) as they belong to
            // the active world's ongoing simulation and are not effect state.
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
        }

        // Only clear complexStyles for cells that were part of the previous effect run,
        // not the entire map — clearing all styles destroys every stream's color cycling
        // (Rainbow, Star Power, etc.) across the entire grid.
        // The override buffers cleared above are sufficient for the quantized effect's needs.
    }

    trigger(force = false, spawnPosition = null) {
        let startTime = 0;
        const logEnabled = this.c.state.logErrors;
        if (logEnabled) startTime = performance.now();

        // 10.0.2: Strictly prevent re-triggering if already active or swapping.
        // Also prevent triggering if ANY other quantized effect is active or swapping.
        const anyQuantizedActive = this.r && this.r.isQuantizedActive();
        const anyQuantizedSwapping = QuantizedBaseEffect.isAnyQuantizedSwapping;

        if (this.active || this.isSwapping || anyQuantizedActive || anyQuantizedSwapping) {
            if ((this.debugMode || spawnPosition) && force) {
                // Allow re-triggering in Editor/Debug mode OR via Tap to Spawn to facilitate rapid iteration
            } else {
                if (logEnabled) console.log(`[QuantizedBaseEffect] trigger aborted (quantized iteration already running or swapping)`);
                return false;
            }
        }

        if (!force) {
            const isEnabled = this.getConfig('Enabled');
            if (!isEnabled) {
                if (logEnabled) console.log(`[QuantizedBaseEffect] trigger aborted (disabled and not forced)`);
                return false;
            }
        }

        // Safety net: if chunked preallocation didn't complete (e.g. race condition),
        // force it now synchronously so the first frame doesn't hang.
        if (!QuantizedBaseEffect._preallocated && this.g && this.g.cols) {
            if (logEnabled) console.warn('[QuantizedBaseEffect] Preallocation missed — running synchronously in trigger()');
            this.preallocate();
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

            // Only freeze logical animation steps during swell if requested
            if (this.getConfig('IncludeSwellPause')) {
                this.cycleTimer = 0;
            }

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
                    // Lazy-apply procedural engine if not already mixed into this subclass
                    if (typeof this._attemptV2Growth !== 'function' && window._QuantizedProceduralEngine) {
                        window._QuantizedProceduralEngine.mixin(this.constructor);
                    }
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
        this.isSwapping = false;
        QuantizedBaseEffect.isAnyQuantizedSwapping = false;
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
            QuantizedBaseEffect.isAnyQuantizedSwapping = false;
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
            QuantizedBaseEffect.isAnyQuantizedSwapping = true;
            this.swapTimer = 5;
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            this.hasSwapped = true;
            this.isSwapping = false;
            QuantizedBaseEffect.isAnyQuantizedSwapping = false;
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

        // GPU glyph lookup path: build a Uint16Array of atlas glyph IDs
        // instead of drawing 100k+ drawImage calls to a canvas.
        this._buildCharIndexData(w, h, s, d);
    }

    _buildCharIndexData(w, h, s, d) {
        const rotatorCycle = d.rotatorCycleFrames || 20;
        const timeSeed = Math.floor(this.animFrame / rotatorCycle);
        if (timeSeed === this.lastGridSeed && !this._gridCacheDirty && QuantizedBaseEffect.sharedAtlas) return;
        this.lastGridSeed = timeSeed;
        this._gridCacheDirty = false;

        if (!QuantizedBaseEffect.sharedAtlas) {
            const fontData = (d.activeFonts && d.activeFonts[0]) || { name: null, chars: null };
            QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c, fontData.name, fontData.chars, 'SHARED');
        }
        const atlas = QuantizedBaseEffect.sharedAtlas;
        atlas.update();

        const grid = this.g;
        const cols = grid.cols, rows = grid.rows;
        const total = cols * rows;

        if (!this._charIndexArray || this._charIndexArray.length !== total) {
            this._charIndexArray = new Uint16Array(total);
        }
        const arr = this._charIndexArray;
        const codeToId = atlas.codeToId;

        const shadowGrid = this.shadowGrid;
        const distW = this.renderer._distMapWidth;
        const distH = this.renderer._distMapHeight;
        const l = this.layout;
        const chars = grid.chars;
        const shadowChars = shadowGrid ? shadowGrid.chars : null;
        const oActive = grid.overrideActive;
        const oChars = grid.overrideChars;
        const eActive = grid.effectActive;
        const srGrid = this.shadowRevealGrid;
        const rotatorOffsets = grid.rotatorOffsets;
        const fontData = (d.activeFonts && d.activeFonts[0]) || { chars: "01" };
        const charSet = fontData.chars;
        const charSetLen = charSet.length;

        for (let y = 0; y < rows; y++) {
            const rowOff = y * cols;
            const by = Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY);
            const isByValid = (by >= 0 && by < distH);
            const bRowOff = isByValid ? by * distW : -1;

            for (let x = 0; x < cols; x++) {
                const i = rowOff + x;
                let charCode = 0;

                if (isByValid) {
                    const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                    if (bx >= 0 && bx < distW) {
                        if (srGrid && srGrid[bRowOff + bx] === 1) {
                            if (shadowChars) charCode = shadowChars[i];
                        } else {
                            if (eActive[i] === 3) eActive[i] = 0;
                        }
                    }
                }

                if (charCode <= 32) {
                    if (oActive && oActive[i] > 0) charCode = oChars[i];
                    else charCode = chars[i];
                }

                if (charCode <= 32) {
                    const hashIdx = rotatorOffsets ? rotatorOffsets[i] : (i % 256);
                    charCode = charSet.charCodeAt(Math.floor((hashIdx / 256) * charSetLen));
                }

                let id = codeToId[charCode];
                if (id < 0) {
                    const rect = atlas.addChar(String.fromCharCode(charCode));
                    id = rect ? rect.id : 65535;
                }
                arr[i] = id;
            }
        }
    }

    _updateGridCacheLegacy(w, h, s, d) {
        if (!this.layout) {
            this.renderer._computeLayoutOnly(this, w, h, s, d);
        }

        const rotatorCycle = d.rotatorCycleFrames || 20;
        const timeSeed = Math.floor(this.animFrame / rotatorCycle);
        if (timeSeed === this.lastGridSeed && !this._gridCacheDirty && QuantizedBaseEffect.sharedAtlas) return;
        this.lastGridSeed = timeSeed;
        this._gridCacheDirty = false;

        const ctx = this.gridCacheCtx;
        ctx.clearRect(0, 0, w, h);

        if (!QuantizedBaseEffect.sharedAtlas) {
            const fontData = (d.activeFonts && d.activeFonts[0]) || { name: null, chars: null };
            QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c, fontData.name, fontData.chars, 'SHARED');
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

            const by = isInsideY ? Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY) : -1;
            const isByValid = (by >= 0 && by < distH);
            const bRowOff = isByValid ? by * distW : -1;

            for (let x = -padding; x < cols + padding; x++) {
                let charCode = 0;
                let i = -1;

                const isInsideGrid = isInsideY && (x >= 0 && x < cols);

                if (isInsideGrid) {
                    i = rowOff + x;

                    if (isByValid) {
                        const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                        if (bx >= 0 && bx < distW) {
                            if (srGrid && srGrid[bRowOff + bx] === 1) {
                                if (shadowChars) charCode = shadowChars[i];
                            } else {
                                if (eActive[i] === 3) eActive[i] = 0;
                            }
                        }
                    }

                    if (charCode <= 32) {
                        if (oActive && oActive[i] > 0) charCode = oChars[i];
                        else charCode = chars[i];
                    }
                }

                if (charCode <= 32) {
                    const hashIdx = (i !== -1) ? (rotatorOffsets ? rotatorOffsets[i] : (i % 256)) : ((y * 13 + x * 7 + timeSeed) % 256);
                    const hashNorm = hashIdx / 256;
                    charCode = charSet.charCodeAt(Math.floor(hashNorm * charSetLen));
                }

                const cx = (x + 0.5) * cellW;
                const rect = atlas.getByCode(charCode);
                if (rect) {
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
        const lg0 = layerGrids[0], lg1 = layerGrids[1];
        const rGrid = this.renderGrid;
        const lGrid = this.logicGrid;
        const minLayer = this._getMinLayer();
        const maxLayer = this._getMaxLayer();

        const compositeCell = (idx) => {
            // Layer priority: L0 > L1, but respect minLayer/maxLayer bounds
            const v0 = (minLayer <= 0) ? lg0[idx] : -1;
            const v1 = (maxLayer >= 1 && minLayer <= 1) ? lg1[idx] : -1;
            const l0Active = (v0 !== -1);
            const finalVal = l0Active ? v0 : (v1 !== -1 ? v1 : -1);

            rGrid[idx] = finalVal;
            if (lGrid) lGrid[idx] = (l0Active || (v1 !== -1)) ? 1 : 0;
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
        const maxLayer = this._getMaxLayer();

        for (let i = 0; i < w * h; i++) {
            const l0Active = (g0 && g0[i] !== -1);
            const l1Active = (maxLayer >= 1 && g1 && g1[i] !== -1);

            // Shadow Reveal Rules: Layer 0 OR Layer 1 (if active)
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
            ? Math.max(0, 1.0 - Math.min(fillRatio, 1.0))
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

        const maxLayer = this._getMaxLayer();
        const isMain = (bx, by) => {
            return isOcc(grid0, bx, by) || (maxLayer >= 1 && isOcc(grid1, bx, by));
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

    // ── No-op stubs for QuantizedProceduralEngine methods ──
    // These are called by the base update loop / trigger path.
    // The procedural engine mixin overrides them on subclasses that need it
    // (QuantizedBlockGeneration, QuantizedZoomEffect, or any class that
    // opts-in via GeneratorTakeover).
    _initBehaviors() {}
    _initProceduralState() {}
    _attemptGrowth() {}
    _performAutoActions() {}
    _isProceduralFinished() { return false; }
    _updateExpansionStatus() { return false; }

    stop() {
        this.active = false;
        this.state = 'IDLE';
        this.alpha = 0.0;
        this.expansionPhase = 0;
        if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; }
        if (this.g) this.g.clearAllOverrides();
        this.shadowGrid = null;
        this.shadowSim = null;
    }
}
console.log('QuantizedBaseEffect loaded');
