/**
 * QuantizedBaseEffect.js - Version 8.5.1
 */
class QuantizedBaseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.configPrefix = "quantizedPulse"; 
        
        // Components
        this.sequenceManager = new QuantizedSequence();
        this.shadowController = new QuantizedShadow();
        this.renderer = new QuantizedRenderer();

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
        this.unfoldSequences = [];
        this.visibleLayers = [true, true, true];
        this.layerOrder = [0, 1, 2];
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
    }

    _getBuffer(key, length, type = Uint8Array) {
        if (!this._bufferPool[key] || this._bufferPool[key].length !== length) {
            this._bufferPool[key] = new type(length);
        }
        return this._bufferPool[key];
    }

    _checkDirtiness() {
        if (this._maskDirty || this._previewActive) return; 

        const fadeIn = Math.max(1, this.getConfig('FadeInFrames') || 0);
        const fadeOut = Math.max(1, this.getConfig('FadeFrames') || 0);
        const maxDuration = Math.max(fadeIn, fadeOut) + 2; 

        if (this.animFrame - this.lastVisibilityChangeFrame < fadeOut + 2) {
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
        const key = this.configPrefix + keySuffix;
        return this.c.state[key];
    }

    getLineGfxValue(suffix) {
        const useOverride = this.getConfig('LineGfxOverride');
        if (useOverride) {
            const override = this.getConfig('LineGfx' + suffix);
            if (override !== undefined && override !== null && override !== "") {
                return override;
            }
        }
        const globalVal = this.c.state['quantizedLineGfx' + suffix];
        return (globalVal !== undefined) ? globalVal : null;
    }

    getBlockSize() {
        let w = this.c.state[this.configPrefix + 'BlockWidthCells'];
        let h = this.c.state[this.configPrefix + 'BlockHeightCells'];
        if (w === undefined) w = this.c.state.quantizedBlockWidthCells;
        if (h === undefined) h = this.c.state.quantizedBlockHeightCells;
        w = w || 4;
        h = h || 4;
        return { w, h };
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

        // Initialize coverage counter
        this._visibleEmptyCount = -1; // Force recalculation
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
        this._visibleEmptyCount = count;
        this._lastCoverageRect = { startX, endX, startY, endY };
    }

    _isCanvasFullyCovered() {
        if (this._visibleEmptyCount === -1) {
            this._updateVisibleEmptyCount();
        }
        return this._visibleEmptyCount <= 0;
    }

    _updateLayerOrder(updatedLayer) {
        if (updatedLayer === undefined || updatedLayer === 0) return;
        
        // Remove the updated layer from its current position (if it's not 0)
        const idx = this.layerOrder.indexOf(updatedLayer);
        if (idx !== -1) {
            this.layerOrder.splice(idx, 1);
            // Insert it at index 1 (right behind Layer 0)
            this.layerOrder.splice(1, 0, updatedLayer);
        }
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

    trigger(force = false) {
        if (this.active && !force) return false;
        
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
        this.unfoldSequences = [];
        this.nextBlockId = 0;
        this.nudgeState = null;
        this.overlapState = { step: 0 };
        this.cycleState = null;
        this.proceduralInitiated = false;
        
        this._initLogicGrid();

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
        this.isReconstructing = true;
        this.maskOps = [];
        this.activeBlocks = []; 
        this.nextBlockId = 0;
        this.proceduralInitiated = false;
        
        // Fully reset procedural state machine
        this.unfoldSequences = Array.from({ length: 3 }, () => []);
        this.nudgeState = null;
        this.cycleState = null;
        this.centeredState = null;

        this._initLogicGrid();
        if (this.renderGrid) this.renderGrid.fill(-1);
        for (let i = 0; i < 3; i++) {
            if (this.layerGrids[i]) this.layerGrids[i].fill(-1);
        }
        this._lastProcessedOpIndex = 0;
        
        const framesPerStep = 60; // Standardize to 60 frames per step for consistent internal timing
        const jumpTime = targetStepsCompleted * framesPerStep;
        for (const [key, state] of this.lineStates) {
            if (state.visible) {
                state.visible = false;
                state.deathFrame = jumpTime;
                state.birthFrame = -1;
            } else if (state.deathFrame !== -1 && jumpTime > state.deathFrame + (this.getConfig('FadeFrames') || 60)) {
                this.lineStates.delete(key);
            }
        }
        
        for (let i = 0; i < targetStepsCompleted; i++) {
            this.expansionPhase = i; 
            const step = this.sequence[i];
            if (step) {
                const simFrame = i * framesPerStep;
                this._executeStepOps(step, simFrame); 
            }
        }
        
        // Re-seed initial blocks or reconstruct from maskOps
        this._initProceduralState();

        this.expansionPhase = targetStepsCompleted; 
        this.animFrame = targetStepsCompleted * framesPerStep;

        this._maskDirty = true;
        this.renderer._edgeCacheDirty = true;
        this.renderer._distMapDirty = true;
        this._outsideMapDirty = true;
        
        this.isReconstructing = false;
    }

    refreshStep() {
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
            let useShadow = false;
            
            // Only use shadow world for characters within the actual grid
            const isInsideGrid = (x >= 0 && x < cols && y >= 0 && y < rows);
            
            if (isInsideGrid && shadowGrid && distMap && l) {
                const bx = Math.floor((x / l.cellPitchX) + l.offX - l.userBlockOffX);
                const by = Math.floor((y / l.cellPitchY) + l.offY - l.userBlockOffY);
                if (bx >= 0 && bx < distW && by >= 0 && by < distH) {
                    const dIdx = by * distW + bx;
                    if (distMap[dIdx] <= 1) useShadow = true;
                }
            }
            if (isInsideGrid) {
                i = (y * cols) + x;
                if (useShadow && shadowGrid.chars) {
                    charCode = shadowGrid.chars[i];
                } else if (grid.overrideActive && grid.overrideActive[i] > 0) {
                    charCode = grid.overrideChars[i];
                } else {
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
        for (let i = 0; i < 3; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== totalBlocks) {
                this.layerGrids[i] = new Int32Array(totalBlocks);
                this.layerGrids[i].fill(-1);
                this._gridsDirty = true;
            }
        }
        if (!this.maskOps) return;

        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        let processed = 0;
        let i = startIndex;
        
        // Track areas that need re-compositing
        const dirtyRects = [];

        for (; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            if (op.startFrame && this.animFrame < op.startFrame) break;
            processed++;
            const layerIdx = (op.layer !== undefined && op.layer >= 0 && op.layer <= 2) ? op.layer : 0;
            const targetGrid = this.layerGrids[layerIdx];
            
            if (layerIdx !== 0 && (op.type === 'add' || op.type === 'addSmart' || op.type === 'removeBlock')) {
                const oldOrder = this.layerOrder.join(',');
                this._updateLayerOrder(layerIdx);
                if (this.layerOrder.join(',') !== oldOrder) {
                    this._gridsDirty = true;
                }
            }

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
                        targetGrid[idx] = (op.fade === false) ? -1000 : (op.startFrame || 0);
                        if (this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = -1;
                    }
                }
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
                            targetGrid[idx] = -1;
                            if (op.fade !== false && this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = this.expansionPhase;
                        } else {
                            for (let l = 0; l < 3; l++) {
                                this.layerGrids[l][idx] = -1;
                                if (op.fade !== false && this.removalGrids[l]) this.removalGrids[l][idx] = this.expansionPhase;
                            }
                        }
                    }
                }
            }
        }
        
        this._lastProcessedOpIndex = i;

        // Skip full re-composite if nothing changed and not globally dirty
        if (processed === 0 && !this._gridsDirty) {
            return;
        }

        const visibleIndices = this.layerOrder.filter(l => l >= 0 && l <= 2);
        const layerGrids = this.layerGrids;

        if (this._gridsDirty) {
            // Full re-composite
            let emptyCount = 0;
            const r = this._lastCoverageRect || { startX: 0, endX: 0, startY: 0, endY: 0 };
            
            for (let idx = 0; idx < totalBlocks; idx++) {
                let finalVal = -1;
                let anyActive = false;
                for (let j = 0; j < visibleIndices.length; j++) {
                    const lIdx = visibleIndices[j];
                    const grid = layerGrids[lIdx];
                    if (grid && grid[idx] !== -1) {
                        if (finalVal === -1) finalVal = grid[idx];
                        anyActive = true;
                    }
                }
                this.renderGrid[idx] = finalVal;
                if (this.logicGrid) this.logicGrid[idx] = anyActive ? 1 : 0;
                
                // Track empty cells in visible area
                const bx = idx % this.logicGridW;
                const by = (idx / this.logicGridW) | 0;
                if (finalVal === -1 && bx >= r.startX && bx < r.endX && by >= r.startY && by < r.endY) {
                    emptyCount++;
                }
            }
            this._visibleEmptyCount = emptyCount;
            this._gridsDirty = false;
        } else if (dirtyRects.length > 0) {
            // Incremental re-composite for affected areas
            const r = this._lastCoverageRect;
            if (!r || this._visibleEmptyCount === -1) {
                this._updateVisibleEmptyCount();
            }

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

                        let finalVal = -1;
                        let anyActive = false;
                        for (let j = 0; j < visibleIndices.length; j++) {
                            const lIdx = visibleIndices[j];
                            const grid = layerGrids[lIdx];
                            if (grid && grid[idx] !== -1) {
                                if (finalVal === -1) finalVal = grid[idx];
                                anyActive = true;
                            }
                        }
                        this.renderGrid[idx] = finalVal;
                        if (this.logicGrid) this.logicGrid[idx] = anyActive ? 1 : 0;

                        const isEmpty = (finalVal === -1);
                        if (isVisible) {
                            if (wasEmpty && !isEmpty) this._visibleEmptyCount--;
                            else if (!wasEmpty && isEmpty) this._visibleEmptyCount++;
                        }
                    }
                }
            }
        }

        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        const bs = this.getBlockSize();
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);
        if (processed > 0 || this._gridsDirty) {
            this.renderer._distMapDirty = true;
            this._outsideMapDirty = true;
            this._maskDirty = true;
            this._gridCacheDirty = true;
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
        this.renderer._addBlockToCtx(this.maskCtx, this.layout, start, end);
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

        // Definitive disable for 2D line rendering in WebGL mode
        if (s.renderingEngine === 'webgl') {
            return;
        }

        const showLines = (this.c.state.layerEnableQuantizedLines !== false);
        const showSource = (this.c.state.layerEnableQuantizedGridCache === true);
        if ((glowStrength > 0 && showLines) || showSource) {
            const isSolid = this.c.state.quantizedSolidPerimeter || false;
            
            if (showSource) {
                this._updateGridCache(width, height, s, d);
                const srcOffX = (0) + (d.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0);
                const srcOffY = (0) + (d.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0);
                ctx.save();
                ctx.globalAlpha = 0.3; 
                ctx.globalCompositeOperation = 'source-over';
                ctx.translate(srcOffX, srcOffY);
                ctx.drawImage(this.gridCacheCanvas, 0, 0);
                ctx.restore();
            }
            if (showLines && glowStrength > 0) {
                const scratchCtx = this.scratchCtx;
                const srcOffX = (0) + (d.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0);
                const srcOffY = (0) + (d.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0);
                scratchCtx.globalCompositeOperation = 'source-over';
                scratchCtx.clearRect(0, 0, width, height);
                if (isSolid) {
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.drawImage(this.lineMaskCanvas, 0, 0);
                } else {
                    this._updateGridCache(width, height, s, d);
                    scratchCtx.globalAlpha = 1.0; 
                    scratchCtx.save();
                    scratchCtx.translate(srcOffX, srcOffY);
                    scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
                    scratchCtx.restore();
                    
                    // Mask the characters with the colored fading lines
                    // Using source-in ensures characters take the line colors and alpha
                    scratchCtx.globalCompositeOperation = 'source-in';
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.drawImage(this.lineMaskCanvas, 0, 0);
                }
                ctx.save();
                ctx.globalCompositeOperation = 'lighter'; 
                const alphaMult = Math.min(1.0, glowStrength / 4.0); 
                ctx.globalAlpha = alphaMult;
                ctx.drawImage(this.scratchCanvas, 0, 0);
                ctx.restore();
            }
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

        if (s.renderingEngine === 'webgl') return;

        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);
        scratchCtx.globalAlpha = 1.0; 
        const srcOffX = (0) + (derived.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0);
        const srcOffY = (0) + (derived.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0);
        scratchCtx.save();
        scratchCtx.translate(srcOffX, srcOffY);
        scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
        scratchCtx.restore();
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(this.lineMaskCanvas, 0, 0);
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        const glowStrength = this.getConfig('BorderIllumination') || 4.0;
        ctx.globalAlpha = 1.0;
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
                this._executeStepOps([previewOp], this.animFrame);
            }
            
            const opsAdded = this.maskOps.length - savedMaskOpsLen;
            if (typeof this._updateRenderGridLogic === 'function') {
                this._updateRenderGridLogic();
            }
            this._maskDirty = true; 
            this._lastPreviewSavedLogic = savedLogicGrid;
            this._lastPreviewSavedOpsLen = savedMaskOpsLen;
            this._lastPreviewOpsAddedCount = opsAdded;
            this._lastPreviewStateHash = stateHash;
            this._previewActive = true;
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

        if (s.renderingEngine === 'webgl') {
            // Clean up preview state ONLY IF we are done with the frame.
            // Note: In WebGL, the actual drawing happens after this call returns.
            // So we delay cleanup until the NEXT frame or use a flag.
            // For now, let's let the preview op stay in maskOps until the next trigger.
            if (this._previewActive && !previewOp) {
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
            return;
        }

        const isSolid = this.c.state.quantizedSolidPerimeter || false;
        if (this.c.state.layerEnableQuantizedGridCache === true) {
            this._updateGridCache(width, height, s, derived);
            const srcOffX = (0) + (derived.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0);
            const srcOffY = (0) + (derived.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0);
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }
        const scratchCtx = this.scratchCtx;
        const srcOffX = (0) + (derived.cellWidth * 0.5) + (this.c.state.quantizedSourceGridOffsetX || 0);
        const srcOffY = (0) + (derived.cellHeight * 0.5) + (this.c.state.quantizedSourceGridOffsetY || 0);
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);
        if (isSolid) {
            scratchCtx.globalAlpha = this.alpha;
            scratchCtx.drawImage(this.lineMaskCanvas, 0, 0);
        } else {
            this._updateGridCache(width, height, s, derived);
            scratchCtx.globalAlpha = 1.0;
            scratchCtx.save();
            scratchCtx.translate(srcOffX, srcOffY);
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            scratchCtx.restore();
            scratchCtx.globalCompositeOperation = 'source-in';
            scratchCtx.globalAlpha = this.alpha;
            scratchCtx.drawImage(this.lineMaskCanvas, 0, 0);
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; 
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();
        if (this._previewActive) {
            // Surgically remove exactly the number of ops we added for the preview
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
        if (!this.layout) return;
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
        const layerColors = ['rgba(0, 255, 0, 0.15)', 'rgba(0, 200, 255, 0.15)', 'rgba(255, 0, 200, 0.15)'];
        const layerLines = ['rgba(0, 255, 0, 0.8)', 'rgba(0, 200, 255, 0.8)', 'rgba(255, 0, 200, 0.8)'];
        const getVal = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return -1;
            return grid[by * blocksX + bx];
        };

        // Draw Fills in reverse layer order (back-to-front), but only show if obscureCount < 2
        const visibleIndices = this.layerOrder.filter(l => l >= 0 && l <= 2);

        for (let i = visibleIndices.length - 1; i >= 0; i--) {
            const lIdx = visibleIndices[i];
            if (this.visibleLayers && this.visibleLayers[lIdx] === false) continue;
            const rGrid = this.layerGrids[lIdx];
            if (rGrid) {
                for (let idx = 0; idx < rGrid.length; idx++) {
                    if (rGrid[idx] !== -1) {
                        const bx = idx % blocksX;
                        const by = Math.floor(idx / blocksX);

                        // Only show if obscureCount < 2 (Top 2 layers at this spot)
                        let obscureCount = 0;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], bx, by) !== -1) {
                                obscureCount++;
                            }
                        }
                        
                        ctx.save();
                        if (obscureCount >= 2) {
                            ctx.globalAlpha = 0.05; // Dim fill for 3rd layer
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

        // Draw Lines in reverse layer order (back-to-front), respecting obscureCount rules
        for (let i = visibleIndices.length - 1; i >= 0; i--) {
            const lIdx = visibleIndices[i];
            if (this.visibleLayers && this.visibleLayers[lIdx] === false) continue;
            const rGrid = this.layerGrids[lIdx];
            if (!rGrid) continue;
            
            const pNormal = new Path2D();
            const pDim = new Path2D();

            for (let x = 0; x <= blocksX; x++) {
                for (let y = 0; y < blocksY; y++) {
                    const activeL = (getVal(rGrid, x - 1, y) !== -1);
                    const activeR = (getVal(rGrid, x, y) !== -1);
                    if (activeL !== activeR) {
                        // Perimeter of Layer lIdx. Is it obscured?
                        let obscureCount = 0;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], x - 1, y) !== -1 || getVal(this.layerGrids[higherLIdx], x, y) !== -1) {
                                obscureCount++;
                            }
                        }
                        if (obscureCount < 2) {
                            let cellX = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                            cellX = Math.max(0, Math.min(this.g.cols, cellX));
                            let cellY1 = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                            let cellY2 = Math.round((y + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                            cellY1 = Math.max(0, Math.min(this.g.rows, cellY1));
                            cellY2 = Math.max(0, Math.min(this.g.rows, cellY2));

                            const px = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                            const py1 = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
                            const py2 = l.screenOriginY + (cellY2 * l.screenStepY) + l.pixelOffY + changesOffY;
                            pNormal.moveTo(px, py1);
                            pNormal.lineTo(px, py2);
                        }
                        // obscureCount === 2 is hidden for V-lines
                    }
                }
            }
            for (let y = 0; y <= blocksY; y++) {
                for (let x = 0; x < blocksX; x++) {
                    const activeT = (getVal(rGrid, x, y - 1) !== -1);
                    const activeB = (getVal(rGrid, x, y) !== -1);
                    if (activeT !== activeB) {
                        // Perimeter of Layer lIdx. Is it obscured?
                        let obscureCount = 0;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], x, y - 1) !== -1 || getVal(this.layerGrids[higherLIdx], x, y) !== -1) {
                                obscureCount++;
                            }
                        }

                        let cellY = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                        cellY = Math.max(0, Math.min(this.g.rows, cellY));
                        let cellX1 = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                        let cellX2 = Math.round((x + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        cellX1 = Math.max(0, Math.min(this.g.cols, cellX1));
                        cellX2 = Math.max(0, Math.min(this.g.cols, cellX2));

                        const py = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                        const px1 = l.screenOriginX + (cellX1 * l.screenStepX) + l.pixelOffX + changesOffX;
                        const px2 = l.screenOriginX + (cellX2 * l.screenStepX) + l.pixelOffX + changesOffX;

                        if (obscureCount < 2) {
                            pNormal.moveTo(px1, py);
                            pNormal.lineTo(px2, py);
                        } else if (obscureCount === 2) {
                            pDim.moveTo(px1, py);
                            pDim.lineTo(px2, py);
                        }
                    }
                }
            }
            ctx.strokeStyle = layerLines[lIdx];
            ctx.stroke(pNormal);
            ctx.save();
            ctx.globalAlpha *= 0.3;
            ctx.stroke(pDim);
            ctx.restore();
        }
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

    _initProceduralState() {
        if (this.proceduralInitiated) return;
        this.proceduralInitiated = true;
        console.log("[QuantizedBaseEffect] Initializing Procedural State");

        // Initialize activeBlocks from current maskOps (manual steps)
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (op.type === 'add' || op.type === 'addSmart') {
                    // Reconstruct block object
                    const id = this.nextBlockId++;
                    this.activeBlocks.push({
                        x: op.x1, y: op.y1, 
                        w: Math.abs(op.x2 - op.x1) + 1, 
                        h: Math.abs(op.y2 - op.y1) + 1,
                        startFrame: op.startFrame || this.animFrame,
                        layer: op.layer || 0,
                        id: id
                    });
                } else if (op.type === 'removeBlock') {
                    const bx1 = op.x1, by1 = op.y1;
                    const bx2 = (op.x2 !== undefined) ? op.x2 : bx1;
                    const by2 = (op.y2 !== undefined) ? op.y2 : by1;
                    const layer = op.layer; // can be undefined

                    this.activeBlocks = this.activeBlocks.filter(b => {
                        // If layer is specified, only remove from that layer
                        if (layer !== undefined && b.layer !== layer) return true;
                        
                        // Check if block b is within or overlaps with removal rect (bx1, by1) to (bx2, by2)
                        // For structural blocks, we usually want to remove it if its anchor (top-left) matches,
                        // or if it's fully contained. Let's use anchor match for simplicity as most ops are 1x1 removals of larger blocks.
                        // Actually, let's check if the block's area overlaps with the removal area.
                        const b_x2 = b.x + b.w - 1;
                        const b_y2 = b.y + b.h - 1;
                        
                        const overlap = !(b.x > bx2 || b_x2 < bx1 || b.y > by2 || b_y2 < by1);
                        return !overlap;
                    });
                }
            }
        }

        // Initialize growth states
        this.unfoldSequences = Array.from({ length: 3 }, () => []);
        this.nudgeState = {
            dirCounts: { N: 0, S: 0, E: 0, W: 0 },
            fieldExpansion: { N: 0, S: 0, E: 0, W: 0 },
            lanes: new Map() // Tracks {0: count, 1: count} per lane
        };
        this.overlapState = { step: 0 };
        this.cycleState = { step: 0, step1Block: null };
        this.centeredState = null;
        this.rearrangePool = Array.from({ length: 3 }, () => 0);

        // Ensure we have at least one anchor if starting fresh
        if (this.activeBlocks.length === 0) {
            // Principle #3: Adhere to LayerCount setting. 
            // Seed the center block on all active layers to ensure they have an initial anchor.
            const maxLayer = this.getConfig('LayerCount') || 0;
            for (let l = 0; l <= maxLayer; l++) {
                // Use skipConnectivity=true and bypassOccupancy=true for the initial seeds
                this._spawnBlock(0, 0, 1, 1, l, false, 0, true, true, true, false, true);
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

    _attemptGrowth() {
        if (this._isCanvasFullyCovered()) return;
        this._initProceduralState();

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enUnfold = getGenConfig('EnableUnfold');
        const enNudge = getGenConfig('EnableNudge');
        const enCluster = getGenConfig('EnableCluster');
        const enShift = getGenConfig('EnableShift');
        const enCentered = getGenConfig('EnableCentered');
        
        // Default behaviors if nothing is explicitly configured for this effect
        // Most effects should at least Nudge and Cluster to ensure coverage.
        const useUnfold = (enUnfold === true);
        const useNudge = (enNudge === true || enNudge === undefined);
        const useCluster = (enCluster === true || enCluster === undefined);
        const useShift = (enShift === true);
        const useCentered = (enCentered === true);

        const quota = getGenConfig('SimultaneousSpawns') || 1;
        const maxLayer = getGenConfig('LayerCount') || 0; 

        // Determine target layer for THIS step (Sequential Rotation)
        const targetLayer = this.proceduralLayerIndex;
        
        const pool = [];
        if (useUnfold) pool.push(() => this._attemptUnfoldGrowth(null, targetLayer));
        if (useNudge) {
            pool.push(() => {
                const sw = getGenConfig('MinBlockWidth') || 1;
                const mw = getGenConfig('MaxBlockWidth') || 3;
                const sh = getGenConfig('MinBlockHeight') || 1;
                const mh = getGenConfig('MaxBlockHeight') || 3;
                const bw = Math.floor(Math.random() * (mw - sw + 1)) + sw;
                const bh = Math.floor(Math.random() * (mh - sh + 1)) + sh;
                return this._attemptNudgeGrowthWithParams(targetLayer, bw, bh);
            });
        }
        if (useCluster) pool.push(() => this._attemptClusterGrowth(null, targetLayer));
        if (useShift) {
            pool.push(() => this._attemptSpokeShiftGrowth(null, targetLayer));
            pool.push(() => this._attemptQuadrantShiftGrowth(null, targetLayer));
        }
        if (useCentered) pool.push(() => this._attemptCenteredGrowth(null, targetLayer));

        // Execute total quota of actions
        let actionsPerformed = 0;
        const maxAttempts = quota * 2; 
        let attempts = 0;

        while (actionsPerformed < quota && attempts < maxAttempts) {
            attempts++;
            let success = false;
            if (pool.length > 0) {
                const behavior = pool[Math.floor(Math.random() * pool.length)];
                if (behavior()) success = true;
            }

            if (success) actionsPerformed++;
        }

        // Rotate layer for NEXT step
        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);
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

    _attemptNudgeGrowthWithParams(targetLayer, bw, bh) {
        if (!this.logicGridW || !this.logicGridH) return false;

        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const grid = this.layerGrids[targetLayer];
        if (!grid) return false;

        // 1. Pick a Cardinal Face (Direction) - Biased by Aspect Ratio
        const faces = this._getBiasedDirections();

        for (const dir of faces) {
            // Calculate extension ratio for THIS direction's main spoke (offset 0)
            let spokeBlocks = 0;
            let spokeMax = 0;
            if (dir === 'N' || dir === 'S') {
                spokeMax = (dir === 'N') ? cy : h - 1 - cy;
                const step = (dir === 'N') ? -1 : 1;
                for (let gy = cy + step; (dir === 'N' ? gy >= 0 : gy < h); gy += step) {
                    if (grid[gy * w + cx] !== -1) spokeBlocks++; else break;
                }
            } else {
                spokeMax = (dir === 'W') ? cx : w - 1 - cx;
                const step = (dir === 'W') ? -1 : 1;
                for (let gx = cx + step; (dir === 'W' ? gx >= 0 : gx < w); gx += step) {
                    if (grid[cy * w + gx] !== -1) spokeBlocks++; else break;
                }
            }
            const extRatio = spokeMax > 0 ? spokeBlocks / spokeMax : 1.0;

            // Offsets from axis: 0, 1, -1, 2, -2, 3, -3...
            const maxOffset = Math.max(cx, cy);
            for (let offset = 0; offset <= maxOffset; offset++) {
                // Rule: only one line (offset 0) until > 33% extension
                if (offset > 0 && extRatio <= 0.33) break;

                // Rule: force 1-wide (single line) until > 33% extension
                let currentBw = bw, currentBh = bh;
                if (extRatio <= 0.33) {
                    if (dir === 'N' || dir === 'S') currentBw = 1;
                    else currentBh = 1;
                }

                // Try both sides of the axis for this offset
                const dxs = (offset === 0) ? [0] : [offset, -offset];
                for (const dAxis of dxs) {
                    let isContinuous = true;
                    let firstEmpty = null;

                    if (dir === 'N' || dir === 'S') {
                        // Check Vertical Spoke at x = cx + dAxis
                        const gx = cx + dAxis;
                        if (gx < 0 || gx >= w) continue;

                        const startY = (dir === 'N') ? cy - 1 : cy + 1;
                        const endY = (dir === 'N') ? 0 : h - 1;
                        const step = (dir === 'N') ? -1 : 1;

                        for (let gy = startY; (dir === 'N' ? gy >= endY : gy <= endY); gy += step) {
                            if (grid[gy * w + gx] === -1) {
                                isContinuous = false;
                                if (firstEmpty === null) firstEmpty = { x: dAxis, y: gy - cy };
                            }
                        }
                    } else {
                        // Check Horizontal Spoke at y = cy + dAxis
                        const gy = cy + dAxis;
                        if (gy < 0 || gy >= h) continue;

                        const startX = (dir === 'W') ? cx - 1 : cx + 1;
                        const endX = (dir === 'W') ? 0 : w - 1;
                        const step = (dir === 'W') ? -1 : 1;

                        for (let gx = startX; (dir === 'W' ? gx >= endX : gx <= endX); gx += step) {
                            if (grid[gy * w + gx] === -1) {
                                isContinuous = false;
                                if (firstEmpty === null) firstEmpty = { x: gx - cx, y: dAxis };
                            }
                        }
                    }

                    // If the spoke isn't full, fill the gap closest to center
                    if (!isContinuous && firstEmpty) {
                        let spawnX = firstEmpty.x;
                        let spawnY = firstEmpty.y;

                        // Align requested dimensions
                        if (dir === 'N') { spawnY = firstEmpty.y - currentBh + 1; spawnX = firstEmpty.x - Math.floor(currentBw / 2); }
                        else if (dir === 'S') { spawnY = firstEmpty.y; spawnX = firstEmpty.x - Math.floor(currentBw / 2); }
                        else if (dir === 'W') { spawnX = firstEmpty.x - currentBw + 1; spawnY = firstEmpty.y - Math.floor(currentBh / 2); }
                        else if (dir === 'E') { spawnX = firstEmpty.x; spawnY = firstEmpty.y - Math.floor(currentBh / 2); }

                        // Override Rule Stack to ensure continuity
                        if (this._spawnBlock(spawnX, spawnY, currentBw, currentBh, targetLayer, false, 0, true, true, true, false, true) !== -1) {
                            return true;
                        }
                    }
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

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const bs = this.getBlockSize();
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        if (!blocksX || !blocksY) return -1;

        // 0. Safety Limits
        if (this.maskOps.length > 50000 || this.activeBlocks.length > 50000) {
            this._warn("QuantizedBlockGenerator: maskOps/activeBlocks limit reached, stopping growth.");
            return -1;
        }

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        // 1. Grid Boundary Constraint: Canvas + 1 block
        // Visible width in blocks
        const visW = Math.ceil(this.g.cols / bs.w);
        const visH = Math.ceil(this.g.rows / bs.h);
        const xLimit = Math.floor(visW / 2) + 1;
        const yLimit = Math.floor(visH / 2) + 1;

        if (x < -xLimit || x + w > xLimit || y < -yLimit || y + h > yLimit) {
            // Allow nudge/mirror to push things slightly further, but restrict procedural growth
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
        if (!skipConnectivity) {
             let connected = false;
             let overlapArea = 0;
             const targetGrid = this.layerGrids[layer];
             
             if (targetGrid) {
                 // Check overlap and adjacency in one pass (O(area) instead of O(N_blocks))
                 // Expand search by 1 unit for adjacency
                 search: for (let gy = minY - 1; gy <= maxY + 1; gy++) {
                     if (gy < 0 || gy >= blocksY) continue;
                     const rowOff = gy * blocksX;
                     const isEdgeY = (gy < minY || gy > maxY);
                     
                     for (let gx = minX - 1; gx <= maxX + 1; gx++) {
                         if (gx < 0 || gx >= blocksX) continue;
                         const isEdgeX = (gx < minX || gx > maxX);
                         
                         if (targetGrid[rowOff + gx] !== -1) {
                             if (isEdgeX || isEdgeY) {
                                 connected = true;
                             } else {
                                 overlapArea++;
                                 connected = true; // Overlap also implies connectivity
                             }
                             // If we found connectivity and don't need accurate overlapArea yet, we could break
                             // But we need overlapArea for the internal stacking check
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

        const id = this.nextBlockId++;
        const b = { 
            x, y, w, h, 
            startFrame: this.animFrame, 
            startPhase: this.expansionPhase, 
            layer, id, isShifter,
            dist: Math.abs(x) + Math.abs(y)
        };
        if (expireFrames > 0) b.expireFrame = this.animFrame + expireFrames;
        this.activeBlocks.push(b);
        
        if (layer !== 0) this._updateLayerOrder(layer);

        const op = {
            type: 'addSmart', 
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            expireFrame: (expireFrames > 0) ? this.animFrame + expireFrames : null,
            layer: layer,
            blockId: id,
            isShifter: isShifter,
            fade: !suppressFades
        };
        this.maskOps.push(op);
        this._gridsDirty = true;

        // Record to sequence for Editor/Step support
        if (this.manualStep && this.sequence && !this.isReconstructing) {
            if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
            const seqOp = {
                op: (w === 1 && h === 1) ? 'addSmart' : 'addRect',
                args: (w === 1 && h === 1) ? [x, y] : [x, y, x + w - 1, y + h - 1],
                layer: layer
            };
            this.sequence[this.expansionPhase].push(seqOp);
        }
        
        this._writeToGrid(x, y, w, h, (op.fade === false ? -1000 : this.animFrame), layer);

        return id;
    }

    _writeToGrid(x, y, w, h, value, layer = 0) {
        if (!this.renderGrid) return;
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const startX = cx + x;
        const startY = cy + y;
        
        const minX = Math.max(0, startX);
        const maxX = Math.min(blocksX - 1, startX + w - 1);
        const minY = Math.max(0, startY);
        const maxY = Math.min(blocksY - 1, startY + h - 1);
        
        for (let gy = minY; gy <= maxY; gy++) {
            for (let gx = minX; gx <= maxX; gx++) {
                const idx = gy * blocksX + gx;
                
                // Update specific layer
                if (this.layerGrids[layer]) {
                    this.layerGrids[layer][idx] = value;
                }
                
                // Composite to renderGrid using current layerOrder priority
                let finalValue = -1;
                const visibleIndices = this.layerOrder.filter(l => l >= 0 && l <= 2);
                for (let j = 0; j < visibleIndices.length; j++) {
                    const lIdx = visibleIndices[j];
                    if (this.layerGrids[lIdx] && this.layerGrids[lIdx][idx] !== -1) {
                        finalValue = this.layerGrids[lIdx][idx];
                        break;
                    }
                }
                this.renderGrid[idx] = finalValue;
            }
        }
        this._outsideMapDirty = true;
    }

    /*
    _attemptCyclicGrowth() {
        const phase = this.cycleState.step % 3;
        const spawnSmart = (layer, mustOverlap, mustProtrude) => {
            const anchors = this.activeBlocks.filter(b => b.layer === 0);
            if (anchors.length === 0) return null;
            const attempts = 40;
            const validShapes = [
                {w:1, h:2}, {w:2, h:1}, {w:1, h:3}, {w:3, h:1},
                {w:2, h:2}, {w:1, h:4}, {w:4, h:1}, {w:1, h:5},
                {w:5, h:1}, {w:2, h:3}, {w:3, h:2}, {w:1, h:6}, {w:6, h:1}
            ];
            for (let i = 0; i < attempts; i++) {
                const anchor = anchors[Math.floor(Math.random() * anchors.length)];
                const shape = validShapes[Math.floor(Math.random() * validShapes.length)];
                const w = shape.w, h = shape.h;
                const ox = Math.floor(Math.random() * (anchor.w + w + 1)) - w;
                const oy = Math.floor(Math.random() * (anchor.h + h + 1)) - h;
                const tx = anchor.x + ox, ty = anchor.y + oy;
                let intersectArea = 0, isTouching = false;
                for (const b of this.activeBlocks) {
                    if (b.layer !== 0) continue; 
                    const ix = Math.max(tx, b.x), iy = Math.max(ty, b.y);
                    const iw = Math.min(tx + w, b.x + b.w) - ix, ih = Math.min(ty + h, b.y + b.h) - iy;
                    if (iw > 0 && ih > 0) intersectArea += (iw * ih);
                    else {
                        const touchX = (tx === b.x + b.w) || (tx + w === b.x);
                        const overlapY = (ty < b.y + b.h) && (ty + h > b.y);
                        const touchY = (ty === b.y + b.h) || (ty + h === b.y);
                        const overlapX = (tx < b.x + b.w) && (tx + w > b.x);
                        if ((touchX && overlapY) || (touchY && overlapX)) isTouching = true;
                    }
                }
                const totalArea = w * h;
                const protrudeArea = totalArea - intersectArea;
                const isConnected = (intersectArea > 0 || isTouching);
                const isProtruding = (protrudeArea > 0);
                if ((!mustOverlap || isConnected) && (!mustProtrude || isProtruding)) {
                    this._spawnBlock(tx, ty, w, h, layer);
                    return { x: tx, y: ty, w, h };
                }
            }
            return null;
        };
        if (phase === 0) { 
            const b = spawnSmart(0, true, true);
            if (b) this.cycleState.step1Block = b;
        } else if (phase === 1) { 
            spawnSmart(1, true, true);
        } else if (phase === 2) { 
            spawnSmart(0, true, true);
            if (this.cycleState.step1Block) {
                const b = this.cycleState.step1Block;
                for (let iy = 0; iy < b.h; iy++) {
                    for (let ix = 0; ix < b.w; ix++) {
                        const lx = b.x + ix, ly = b.y + iy;
                        const faces = ['N', 'S', 'W', 'E'];
                        for (const face of faces) {
                            if (this.manualStep && this.sequence) {
                                if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
                            }
                        }
                    }
                }
            }
        }
        this.cycleState.step++;
    }
    */

    _nudge(x, y, w, h, face, layer = 0) {
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
        const shiftAmt = (axis === 'X' ? w : h);

        // 1. Identify and Shift blocks
        const shiftedBlocks = [];
        for (const b of this.activeBlocks) {
            if (b.layer !== layer) continue;

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
                shiftedBlocks.push({ b, oldX: b.x, oldY: b.y, oldW: b.w, oldH: b.h, start: b.startFrame });
                if (axis === 'X') b.x += (dir * shiftAmt);
                else b.y += (dir * shiftAmt);
            }
        }

        // 2. Synchronize shifts with maskOps (Addition-Only for continuous structure)
        for (const m of shiftedBlocks) {
            // Keep the old position filled in maskOps (don't add a removeBlock op)
            
            // Record addition at new position
            this.maskOps.push({ 
                type: 'addSmart', 
                x1: m.b.x, y1: m.b.y, x2: m.b.x + m.b.w - 1, y2: m.b.y + m.b.h - 1, 
                startFrame: m.start, startPhase: this.expansionPhase, 
                layer: layer,
                fade: false
            });

            // IMPORTANT: Add a NEW block to activeBlocks at the OLD position 
            // This ensures the simulation matches the physics grid (no holes in collision logic)
            this._spawnBlock(m.oldX, m.oldY, m.oldW, m.oldH, layer, false, 0, true, true, true, false, true);
        }

        // 3. Add the SOURCE REPLACEMENT block at the original origin (x, y)
        if (this._spawnBlock(x, y, w, h, layer, false, 0, true, true, true, false, true) !== -1) {
            // Record to sequence for Editor/Step support (ONLY if not currently reconstructing)
            if (this.manualStep && this.sequence && !this.isReconstructing) {
                if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
                this.sequence[this.expansionPhase].push({ 
                    op: 'nudge', 
                    args: [x, y, w, h, face], 
                    layer: layer 
                });
            }

            this._log(`Nudge: Solid Shifted ${shiftedBlocks.length} blocks, continuous mass preserved.`);
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
        return this._nudge(block.x, block.y, block.w, block.h, face, block.layer);
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