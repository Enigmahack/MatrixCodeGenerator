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
        this.crawlers = [];
        this.unfoldSequences = [];
        this.visibleLayers = [true, true, true, true, true];
        this.layerOrder = [0, 1, 2, 3, 4];
        this.proceduralLayerIndex = 0;
        this.nextBlockId = 0;
        this.spineState = null;
        this.overlapState = { step: 0 };
        this.cycleState = null;
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
            if (this.maskOps.length > 2000) {
                this._pruneOps(maxDuration);
            }
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

    _pruneOps(maxDuration) {
        const cutoff = this.animFrame - (maxDuration + 100); 
        const newOps = [];
        let pruned = 0;
        const processedLimit = this._lastProcessedOpIndex || 0;

        for (let i = 0; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            
            // Never prune ops that haven't been processed yet
            if (i >= processedLimit) {
                newOps.push(op);
                continue;
            }

            // Never prune permanent structural ops (needed for Editor reconstruction)
            if (op.type === 'add' || op.type === 'addSmart' || op.type === 'removeBlock') {
                if (!op.expireFrame) {
                    newOps.push(op);
                    continue;
                }
            }

            // Always keep line ops (they handle their own fading)
            if (op.type === 'addLine' || op.type === 'removeLine' || op.type === 'remLine') {
                newOps.push(op);
                continue;
            }

            // Prune transient ops if they are old enough
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

    _log(...args) { if (this.c.state.logErrors) console.log(...args); }
    _warn(...args) { if (this.c.state.logErrors) console.warn(...args); }
    _error(...args) { if (this.c.state.logErrors) console.error(...args); }

    getConfig(keySuffix) {
        const key = this.configPrefix + keySuffix;
        return this.c.state[key];
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

        if (!this.renderGrid || this.renderGrid.length !== blocksX * blocksY) {
            this.renderGrid = new Int32Array(blocksX * blocksY);
        }
        this.renderGrid.fill(-1);
        
        for (let i = 0; i < 5; i++) {
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
        
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this._lastProcessedOpIndex = 0;
        this.animFrame = 0;
        this._maskDirty = true;
        
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
        this.crawlers = [];
        this.unfoldSequences = [];
        this.nextBlockId = 0;
        this.spineState = null;
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
        this.maskOps = [];
        this.activeBlocks = []; // Reset activeBlocks to prevent state desync during jumps
        this.nextBlockId = 0;
        this.proceduralInitiated = false;
        this._initLogicGrid();
        if (this.renderGrid) this.renderGrid.fill(-1);
        for (let i = 0; i < 5; i++) {
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
    }

    refreshStep() {
        this.jumpToStep(this.expansionPhase);
    }
    
    // Proxy for SequenceManager
    _executeStepOps(step, startFrameOverride) {
        this.sequenceManager.executeStepOps(this, step, startFrameOverride);
    }

    _lerpColor(c1, c2, t) { return this.renderer._lerpColor(c1, c2, t); }

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
            for (let i = 0; i < 5; i++) {
                if (!this.layerGrids[i] || this.layerGrids[i].length !== requiredSize) {
                    this.layerGrids[i] = new Int32Array(requiredSize);
                    this.layerGrids[i].fill(-1);
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
        }
        for (let i = 0; i < 5; i++) {
            if (!this.layerGrids[i] || this.layerGrids[i].length !== totalBlocks) {
                this.layerGrids[i] = new Int32Array(totalBlocks);
                this.layerGrids[i].fill(-1);
            }
        }
        if (!this.maskOps) return;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const startIndex = this._lastProcessedOpIndex || 0;
        let processed = 0;
        let i = startIndex;
        for (; i < this.maskOps.length; i++) {
            const op = this.maskOps[i];
            if (op.startFrame && this.animFrame < op.startFrame) break;
            processed++;
            const layerIdx = (op.layer !== undefined && op.layer >= 0 && op.layer <= 4) ? op.layer : 0;
            const targetGrid = this.layerGrids[layerIdx];
            
            if (layerIdx !== 0 && (op.type === 'add' || op.type === 'addSmart' || op.type === 'removeBlock')) {
                this._updateLayerOrder(layerIdx);
            }

            if (op.type === 'add' || op.type === 'addSmart') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.max(0, Math.min(start.x, end.x));
                const maxX = Math.min(this.logicGridW - 1, Math.max(start.x, end.x));
                const minY = Math.max(0, Math.min(start.y, end.y));
                const maxY = Math.min(this.logicGridH - 1, Math.max(start.y, end.y));
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = by * this.logicGridW + bx;
                        targetGrid[idx] = op.startFrame || 0;
                        if (this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = -1;
                    }
                }
            } else if (op.type === 'removeBlock') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.max(0, Math.min(start.x, end.x));
                const maxX = Math.min(this.logicGridW - 1, Math.max(start.x, end.x));
                const minY = Math.max(0, Math.min(start.y, end.y));
                const maxY = Math.min(this.logicGridH - 1, Math.max(start.y, end.y));
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = by * this.logicGridW + bx;
                        const remFrame = op.startFrame || 0;
                        if (op.layer !== undefined) {
                            targetGrid[idx] = -1;
                            if (op.fade !== false && this.removalGrids[layerIdx]) this.removalGrids[layerIdx][idx] = remFrame;
                        } else {
                            for (let l = 0; l < 5; l++) {
                                this.layerGrids[l][idx] = -1;
                                if (op.fade !== false && this.removalGrids[l]) this.removalGrids[l][idx] = remFrame;
                            }
                        }
                    }
                }
            }
        }
        for (let idx = 0; idx < totalBlocks; idx++) {
            let val = -1;
            const last3or4 = this.layerOrder.find(l => l === 3 || l === 4);
            const visibleIndices = this.layerOrder.filter(l => l <= 2 || l === last3or4);

            for (const lIdx of visibleIndices) {
                if (this.layerGrids[lIdx] && this.layerGrids[lIdx][idx] !== -1) {
                    val = this.layerGrids[lIdx][idx];
                    break;
                }
            }
            this.renderGrid[idx] = val;
        }
        this._lastProcessedOpIndex = i;
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        const bs = this.getBlockSize();
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);
        if (processed > 0) {
            this.renderer._distMapDirty = true;
            this._outsideMapDirty = true;
            this._maskDirty = true;
            this._gridCacheDirty = true;
            this.renderer._edgeCacheDirty = true;
        }
    }

    _computeCenteredOffset(blocksX, blocksY, pitchX, pitchY) {
        const logicCellsX = blocksX * pitchX;
        const logicCellsY = blocksY * pitchY;
        const screenCellsX = this.g.cols;
        const screenCellsY = this.g.rows;
        const cellOffX = (logicCellsX - screenCellsX) / 2.0;
        const cellOffY = (logicCellsY - screenCellsY) / 2.0;
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
    _renderEdges(ctx, ignoredCtx, now, blocksX, blocksY, offX, offY) {
        this.renderer.renderEdges(this, ctx, now, blocksX, blocksY, offX, offY);
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
        const showLines = (this.c.state.layerEnableQuantizedLines !== false);
        const showSource = (this.c.state.layerEnableQuantizedGridCache === true);
        if ((glowStrength > 0 && showLines) || showSource) {
            const isSolid = this.c.state.quantizedSolidPerimeter || false;
            
            if (showSource) {
                this._updateGridCache(width, height, s, d);
                const srcOffX = (0) + (d.cellWidth * 0.5);
                const srcOffY = (0) + (d.cellHeight * 0.5);
                ctx.save();
                ctx.globalAlpha = 0.3; 
                ctx.globalCompositeOperation = 'source-over';
                ctx.translate(srcOffX, srcOffY);
                ctx.drawImage(this.gridCacheCanvas, 0, 0);
                ctx.restore();
            }
            if (showLines && glowStrength > 0) {
                const scratchCtx = this.scratchCtx;
                const srcOffX = (0) + (d.cellWidth * 0.5);
                const srcOffY = (0) + (d.cellHeight * 0.5);
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
        const srcOffX = (0) + (derived.cellWidth * 0.5);
        const srcOffY = (0) + (derived.cellHeight * 0.5);
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
        const isSolid = this.c.state.quantizedSolidPerimeter || false;
        if (this.c.state.layerEnableQuantizedGridCache === true) {
            this._updateGridCache(width, height, s, derived);
            const srcOffX = (0) + (derived.cellWidth * 0.5);
            const srcOffY = (0) + (derived.cellHeight * 0.5);
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.translate(srcOffX, srcOffY);
            ctx.drawImage(this.gridCacheCanvas, 0, 0);
            ctx.restore();
        }
        const scratchCtx = this.scratchCtx;
        const srcOffX = (0) + (derived.cellWidth * 0.5);
        const srcOffY = (0) + (derived.cellHeight * 0.5);
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
            for (let i = 0; i < 5; i++) {
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
        const layerColors = ['rgba(0, 255, 0, 0.15)', 'rgba(0, 200, 255, 0.15)', 'rgba(255, 0, 200, 0.15)', 'rgba(255, 255, 0, 0.15)', 'rgba(255, 128, 0, 0.15)'];
        const layerLines = ['rgba(0, 255, 0, 0.8)', 'rgba(0, 200, 255, 0.8)', 'rgba(255, 0, 200, 0.8)', 'rgba(255, 255, 0, 0.8)', 'rgba(255, 128, 0, 0.8)'];
        // Draw Fills in reverse layer order (back-to-front), but only top 3 + alternating visible
        const last3or4 = this.layerOrder.find(l => l === 3 || l === 4);
        const visibleIndices = this.layerOrder.filter(l => l <= 2 || l === last3or4);

        for (let i = visibleIndices.length - 1; i >= 0; i--) {
            const lIdx = visibleIndices[i];
            if (this.visibleLayers && this.visibleLayers[lIdx] === false) continue;
            const rGrid = this.layerGrids[lIdx];
            if (rGrid) {
                ctx.fillStyle = layerColors[lIdx];
                for (let idx = 0; idx < rGrid.length; idx++) {
                    if (rGrid[idx] !== -1) {
                        const bx = idx % blocksX;
                        const by = Math.floor(idx / blocksX);
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
                    }
                }
            }
        }
        const getVal = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return -1;
            return grid[by * blocksX + bx];
        };

        // Draw Lines in reverse layer order (back-to-front), but only top 3 + alternating visible
        for (let i = visibleIndices.length - 1; i >= 0; i--) {
            const lIdx = visibleIndices[i];
            if (this.visibleLayers && this.visibleLayers[lIdx] === false) continue;
            const rGrid = this.layerGrids[lIdx];
            if (!rGrid) continue;
            const pSolid = new Path2D();
            for (let x = 0; x <= blocksX; x++) {
                for (let y = 0; y < blocksY; y++) {
                    const activeL = (getVal(rGrid, x - 1, y) !== -1);
                    const activeR = (getVal(rGrid, x, y) !== -1);
                    if (activeL !== activeR) {
                        // Perimeter of Layer lIdx. Is it obscured by any higher layer in the order?
                        let obscured = false;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            // Only obscure if the higher layer is also VISIBLE in the editor
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], x - 1, y) !== -1 || getVal(this.layerGrids[higherLIdx], x, y) !== -1) {
                                obscured = true;
                                break;
                            }
                        }
                        if (!obscured) {
                            let cellX = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                            cellX = Math.max(0, Math.min(this.g.cols, cellX));
                            let cellY1 = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                            let cellY2 = Math.round((y + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                            cellY1 = Math.max(0, Math.min(this.g.rows, cellY1));
                            cellY2 = Math.max(0, Math.min(this.g.rows, cellY2));

                            const px = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                            const py1 = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
                            const py2 = l.screenOriginY + (cellY2 * l.screenStepY) + l.pixelOffY + changesOffY;
                            pSolid.moveTo(px, py1);
                            pSolid.lineTo(px, py2);
                        }
                    }
                }
            }
            for (let y = 0; y <= blocksY; y++) {
                for (let x = 0; x < blocksX; x++) {
                    const activeT = (getVal(rGrid, x, y - 1) !== -1);
                    const activeB = (getVal(rGrid, x, y) !== -1);
                    if (activeT !== activeB) {
                        // Perimeter of Layer lIdx. Is it obscured by any higher layer in the order?
                        let obscured = false;
                        for (let j = 0; j < i; j++) {
                            const higherLIdx = visibleIndices[j];
                            // Only obscure if the higher layer is also VISIBLE in the editor
                            if (this.visibleLayers && this.visibleLayers[higherLIdx] === false) continue;
                            if (getVal(this.layerGrids[higherLIdx], x, y - 1) !== -1 || getVal(this.layerGrids[higherLIdx], x, y) !== -1) {
                                obscured = true;
                                break;
                            }
                        }
                        if (!obscured) {
                            let cellY = Math.round((y - l.offY + l.userBlockOffY) * l.cellPitchY);
                            cellY = Math.max(0, Math.min(this.g.rows, cellY));
                            let cellX1 = Math.round((x - l.offX + l.userBlockOffX) * l.cellPitchX);
                            let cellX2 = Math.round((x + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                            cellX1 = Math.max(0, Math.min(this.g.cols, cellX1));
                            cellX2 = Math.max(0, Math.min(this.g.cols, cellX2));

                            const py = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                            const px1 = l.screenOriginX + (cellX1 * l.screenStepX) + l.pixelOffX + changesOffX;
                            const px2 = l.screenOriginX + (cellX2 * l.screenStepX) + l.pixelOffX + changesOffX;
                            pSolid.moveTo(px1, py);
                            pSolid.lineTo(px2, py);
                        }
                    }
                }
            }
            ctx.strokeStyle = layerLines[lIdx];
            ctx.stroke(pSolid);
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
        this.spineState = {
            N: { l0Len: 0, l1Len: 0, finished: false },
            S: { l0Len: 0, l1Len: 0, finished: false },
            E: { l0Len: 0, l1Len: 0, finished: false },
            W: { l0Len: 0, l1Len: 0, finished: false }
        };
        this.nudgeState = {
            dirCounts: { N: 0, S: 0, E: 0, W: 0 },
            lanes: new Map() // Tracks {0: count, 1: count} per lane
        };
        this.overlapState = { step: 0 };
        this.crawlers = [];
        this.unfoldSequences = [];
        this.cycleState = { step: 0, step1Block: null };

        // Ensure we have at least one anchor if starting fresh
        if (this.activeBlocks.length === 0) {
            for (let i = 0; i < 5; i++) {
                this._spawnBlock(0, 0, 1, 1, i, false, false, 0, true, true);
                // Explicitly set the seed blocks to addSmart type in maskOps
                if (this.maskOps.length > 0) {
                    this.maskOps[this.maskOps.length - 1].type = 'addSmart';
                }
            }
        }
    }

    _processActiveStatefulBehaviors(targetLayer) {
        let crawlerUpdated = false;
        if (this.crawlers) {
            for (let i = this.crawlers.length - 1; i >= 0; i--) {
                const crawler = this.crawlers[i];
                if (crawler.active) {
                    this._attemptCrawlerGrowth(crawler, targetLayer);
                    crawlerUpdated = true;
                } else {
                    this.crawlers.splice(i, 1);
                }
            }
        }

        if (this.unfoldSequences) {
            for (let i = this.unfoldSequences.length - 1; i >= 0; i--) {
                const seq = this.unfoldSequences[i];
                if (seq.active) {
                    this._attemptUnfoldGrowth(seq);
                } else {
                    this.unfoldSequences.splice(i, 1);
                }
            }
        }
        return crawlerUpdated;
    }

    _attemptGrowth() {
        this._initProceduralState();

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enUnfold = getGenConfig('EnableUnfold') === true;
        const enCrawler = getGenConfig('EnableCrawler') === true;
        const enPulse = getGenConfig('EnablePulseGrowth') === true;
        const enNudge = getGenConfig('EnableNudge') === true;
        const quota = getGenConfig('SimultaneousSpawns') || 1;
        const maxLayer = getGenConfig('LayerCount') || 1; // 1 means Layer 0 and 1

        // Determine target layer for THIS step (Sequential Rotation)
        const targetLayer = this.proceduralLayerIndex;
        
        const pool = [];
        if (enUnfold) pool.push(() => this._attemptUnfoldGrowth());
        if (enCrawler) pool.push(() => this._attemptCrawlerGrowth());
        if (enPulse) {
            pool.push(() => {
                const minW = getGenConfig('MinBlockWidth') || 1;
                const maxW = getGenConfig('MaxBlockWidth') || 3;
                const minH = getGenConfig('MinBlockHeight') || 1;
                const maxH = getGenConfig('MaxBlockHeight') || 3;
                const w = Math.floor(Math.random() * (maxW - minW + 1)) + minW;
                const h = Math.floor(Math.random() * (maxH - minH + 1)) + minH;
                return this._attemptPulseGrowthWithParams(targetLayer, w, h);
            });
        }
        if (enNudge) {
            pool.push(() => {
                const minW = getGenConfig('MinBlockWidth') || 1;
                const maxW = getGenConfig('MaxBlockWidth') || 3;
                const minH = getGenConfig('MinBlockHeight') || 1;
                const maxH = getGenConfig('MaxBlockHeight') || 3;
                const w = Math.floor(Math.random() * (maxW - minW + 1)) + minW;
                const h = Math.floor(Math.random() * (maxH - minH + 1)) + minH;
                return this._attemptNudgeGrowthWithParams(targetLayer, w, h);
            });
        }

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
            
            if (!success) {
                if (this._attemptSubstituteGrowthWithLayer(targetLayer)) success = true;
            }

            if (success) actionsPerformed++;
        }

        // Rotate layer for NEXT step
        this.proceduralLayerIndex = (this.proceduralLayerIndex + 1) % (maxLayer + 1);

        this._performHoleCleanup();
    }

    _attemptSubstituteGrowthWithLayer(targetLayer) {
        if (!this.activeBlocks || this.activeBlocks.length === 0) return false;

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };
        const minW = getGenConfig('MinBlockWidth') || 1;
        const maxW = getGenConfig('MaxBlockWidth') || 3;
        const minH = getGenConfig('MinBlockHeight') || 1;
        const maxH = getGenConfig('MaxBlockHeight') || 3;

        const w = Math.floor(Math.random() * (maxW - minW + 1)) + minW;
        const h = Math.floor(Math.random() * (maxH - minH + 1)) + minH;

        // Attempt to spawn a block adjacent to a random existing block IN THE TARGET LAYER
        const anchors = this.activeBlocks.filter(b => b.layer === targetLayer);
        if (anchors.length === 0) return false;
        
        Utils.shuffle(anchors);
        
        for (let i = 0; i < Math.min(anchors.length, 10); i++) {
            const anchor = anchors[i];
            const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
            Utils.shuffle(dirs);
            for (const dir of dirs) {
                let tx, ty;
                if (dir.dx === 1) { tx = anchor.x + anchor.w; ty = anchor.y; }
                else if (dir.dx === -1) { tx = anchor.x - w; ty = anchor.y; }
                else if (dir.dy === 1) { tx = anchor.x; ty = anchor.y + anchor.h; }
                else { tx = anchor.x; ty = anchor.y - h; }
                
                if (this._spawnBlock(tx, ty, w, h, targetLayer, true, false, 0, false, false) !== -1) {
                    return true;
                }
            }
        }
        return false;
    }

    _attemptPulseGrowthWithParams(targetLayer, w, h) {
        if (!this.logicGridW || !this.logicGridH) return false;
        
        const blocks = this.activeBlocks.filter(b => b.layer === targetLayer);
        if (blocks.length === 0) return false;

        let maxDist = 0;
        for (const b of blocks) {
            const d = Math.abs(b.x) + Math.abs(b.y);
            if (d > maxDist) maxDist = d;
        }

        const anchors = blocks.filter(b => (Math.abs(b.x) + Math.abs(b.y)) >= maxDist - 2);
        Utils.shuffle(anchors);

        for (let i = 0; i < Math.min(anchors.length, 10); i++) {
            const anchor = anchors[i];
            const dirs = [];
            if (anchor.x >= 0) dirs.push({dx: 1, dy: 0}); else dirs.push({dx: -1, dy: 0});
            if (anchor.y >= 0) dirs.push({dx: 0, dy: 1}); else dirs.push({dx: 0, dy: -1});
            
            const others = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}].filter(d => !dirs.some(pd => pd.dx === d.dx && pd.dy === d.dy));
            Utils.shuffle(others);
            dirs.push(...others);

            for (const dir of dirs) {
                let tx, ty;
                if (dir.dx === 1) { tx = anchor.x + anchor.w; ty = anchor.y; }
                else if (dir.dx === -1) { tx = anchor.x - w; ty = anchor.y; }
                else if (dir.dy === 1) { tx = anchor.x; ty = anchor.y + anchor.h; }
                else { tx = anchor.x; ty = anchor.y - h; }

                if (this._spawnBlock(tx, ty, w, h, targetLayer, false, false, 0, false, false) !== -1) {
                    return true;
                }
            }
        }

        return false;
    }

    _attemptNudgeGrowthWithParams(targetLayer, wInput, hInput) {
        if (!this.logicGridW || !this.logicGridH) return false;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const minLX = -cx, maxLX = this.logicGridW - 1 - cx;
        const minLY = -cy, maxLY = this.logicGridH - 1 - cy;

        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(this.logicGridW, this.logicGridH, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const pStatus = this._getPerimeterStatus(offX, offY, visibleW, visibleH);

        // Optimization: Pre-allocate lane bounds to avoid object creation in loop
        if (!this._laneMin0 || this._laneMin0.length < 16) {
            this._laneMin0 = new Float32Array(16); this._laneMax0 = new Float32Array(16);
            this._laneMin1 = new Float32Array(16); this._laneMax1 = new Float32Array(16);
        }

        for (let attempt = 0; attempt < 50; attempt++) {
            const axis = Math.random() < 0.5 ? 'X' : 'Y';
            const otherLayer = (targetLayer === 0) ? 1 : 0; 
            
            let x, y, w, h, dir, units;
            if (axis === 'X') {
                w = wInput; h = hInput;
                x = this._getBiasedCoordinate(minLX, maxLX, w, pStatus, 'X');
                y = 0;
                dir = Math.random() < 0.5 ? 'N' : 'S'; units = w;
            } else {
                w = wInput; h = hInput;
                x = 0;
                y = this._getBiasedCoordinate(minLY, maxLY, h, pStatus, 'Y');
                dir = Math.random() < 0.5 ? 'E' : 'W'; units = h;
            }

            if (units > 16) continue;

            this._laneMin0.fill(Infinity); this._laneMax0.fill(-Infinity);
            this._laneMin1.fill(Infinity); this._laneMax1.fill(-Infinity);

            for (let i = 0; i < this.activeBlocks.length; i++) {
                const b = this.activeBlocks[i];
                const overlapStart = Math.max(axis === 'X' ? x : y, axis === 'X' ? b.x : b.y);
                const overlapEnd = Math.min((axis === 'X' ? x + w : y + h), (axis === 'X' ? b.x + b.w : b.y + b.h));
                if (overlapStart < overlapEnd) {
                    const lMin = b.layer === targetLayer ? this._laneMin0 : (b.layer === otherLayer ? this._laneMin1 : null);
                    const lMax = b.layer === targetLayer ? this._laneMax0 : (b.layer === otherLayer ? this._laneMax1 : null);
                    if (!lMin) continue;
                    for (let k = overlapStart; k < overlapEnd; k++) {
                        const idx = k - (axis === 'X' ? x : y);
                        const valMin = axis === 'X' ? b.y : b.x;
                        const valMax = axis === 'X' ? (b.y + b.h - 1) : (b.x + b.w - 1);
                        lMin[idx] = Math.min(lMin[idx], valMin);
                        lMax[idx] = Math.max(lMax[idx], valMax);
                    }
                }
            }

            const checkLane = (lane) => {
                const minArr = (lane === 0) ? this._laneMin0 : this._laneMin1;
                for (let i = 0; i < units; i++) if (minArr[i] !== Infinity) return true;
                return false;
            };
            if (!checkLane(0)) continue;

            const tLaneMin = this._laneMin0;
            const tLaneMax = this._laneMax0;
            const oLaneMin = this._laneMin1;
            const oLaneMax = this._laneMax1;

            let pullOther = false;
            for (let i = 0; i < units; i++) {
                const tm = tLaneMin[i];
                const om = oLaneMin[i];
                const oM = oLaneMax[i];
                if (om === Infinity) continue;
                if (dir === 'N' || dir === 'W') { if (tm <= om - 2) pullOther = true; }
                else { 
                    const tM = tLaneMax[i];
                    if (tM >= oM + 2) pullOther = true; 
                }
                if (pullOther) break;
            }

            const minBound = (axis === 'X') ? minLY : minLX;
            const maxBound = (axis === 'X') ? maxLY : maxLX;

            const checkBound = (mMin, mMax, d) => {
                if (d === 'N' || d === 'W') {
                    for (let i = 0; i < units; i++) if (mMin[i] !== Infinity && mMin[i] <= minBound) return false;
                } else {
                    for (let i = 0; i < units; i++) if (mMax[i] !== -Infinity && mMax[i] >= maxBound) return false;
                }
                return true;
            };

            let canNudge = checkBound(tLaneMin, tLaneMax, dir);
            if (canNudge && pullOther && !checkBound(oLaneMin, oLaneMax, dir)) canNudge = false;

            if (canNudge) {
                this._nudge(x, y, w, h, dir, targetLayer);
                if (pullOther) this._nudge(x, y, w, h, dir, otherLayer);
                return true;
            }
        }
        return false;
    }

    _spawnBlock(x, y, w, h, layer = 0, suppressLines = false, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false) {
        if (!skipConnectivity && this.activeBlocks.length > 0) {
             let connected = false;
             let layerOverlap = 0;
             const area = w * h;

             for (const b of this.activeBlocks) {
                 const xOverlap = (x <= b.x + b.w) && (x + w >= b.x);
                 const yOverlap = (y <= b.y + b.h) && (y + h >= b.y);
                 
                 if (xOverlap && yOverlap) {
                     // Only count overlap and connectivity for the SAME layer
                     if (b.layer === layer) {
                         connected = true;
                         const ix = Math.max(x, b.x);
                         const iy = Math.max(y, b.y);
                         const iw = Math.min(x + w, b.x + b.w) - ix;
                         const ih = Math.min(y + h, b.y + b.h) - iy;
                         if (iw > 0 && ih > 0) {
                             layerOverlap += (iw * ih);
                         }
                     }
                 }
             }
             if (!connected) return -1;
             if (!isShifter && !allowInternal && layerOverlap >= area) return -1; 
        }

        const id = this.nextBlockId++;
        const b = { x, y, w, h, startFrame: this.animFrame, startPhase: this.expansionPhase, layer, id, isShifter };
        if (expireFrames > 0) b.expireFrame = this.animFrame + expireFrames;
        this.activeBlocks.push(b);
        
        const op = {
            type: 'add',
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            expireFrame: (expireFrames > 0) ? this.animFrame + expireFrames : null,
            layer: layer,
            blockId: id,
            isShifter: isShifter
        };
        this.maskOps.push(op);

        // Record to sequence for Editor/Step support
        if (this.manualStep && this.sequence) {
            if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
            const seqOp = {
                op: (w === 1 && h === 1) ? 'add' : 'addRect',
                args: (w === 1 && h === 1) ? [x, y] : [x, y, x + w - 1, y + h - 1],
                layer: layer
            };
            this.sequence[this.expansionPhase].push(seqOp);
        }
        
        if (suppressLines) {
            this._writeToGrid(x, y, w, h, this.animFrame, layer);
            return id;
        }
        
        const durationSteps = this.c.state.quantizedGenerateV2InnerLineDuration || 1;
        const speed = this.getConfig('Speed') || 5;
        const framesPerStep = Math.max(1, 10 / speed);
        const durationFrames = durationSteps * framesPerStep;

        const addLine = (lx, ly, face) => {
            const op = { 
                type: 'addLine', 
                x1: lx, y1: ly, x2: lx, y2: ly, 
                face: face, 
                startFrame: this.animFrame,
                expireFrame: this.animFrame + durationFrames, 
                startPhase: this.expansionPhase,
                layer: layer,
                blockId: id
            };
            this.maskOps.push(op);

            if (this.manualStep && this.sequence) {
                if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
                this.sequence[this.expansionPhase].push({
                    op: 'addLine',
                    args: [lx, ly, face],
                    layer: layer
                });
            }
        };
        
        for(let i=0; i<w; i++) addLine(x+i, y, 'N');
        for(let i=0; i<w; i++) addLine(x+i, y+h-1, 'S');
        for(let i=0; i<h; i++) addLine(x, y+i, 'W');
        for(let i=0; i<h; i++) addLine(x+w-1, y+i, 'E');
        
        this._writeToGrid(x, y, w, h, this.animFrame, layer);

        // Update logic grid occupancy
        if (this.logicGrid) {
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
                    this.logicGrid[gy * blocksX + gx] = 1;
                }
            }
        }

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
                if (layer === 0) {
                    if (this.layerGrids[0]) this.layerGrids[0][idx] = value;
                } else if (layer === 1) {
                    if (this.layerGrids[1]) this.layerGrids[1][idx] = value;
                } else if (layer === 2) {
                    if (this.layerGrids[2]) this.layerGrids[2][idx] = value;
                }
                
                const l0 = this.layerGrids[0] ? this.layerGrids[0][idx] : -1;
                const l1 = this.layerGrids[1] ? this.layerGrids[1][idx] : -1;
                const l2 = this.layerGrids[2] ? this.layerGrids[2][idx] : -1;
                this.renderGrid[idx] = (l0 !== -1) ? l0 : (l1 !== -1 ? l1 : l2);
            }
        }
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
                            this.maskOps.push({ type: 'remLine', x1: lx, y1: ly, x2: lx, y2: ly, face: face, force: true, startFrame: this.animFrame });
                            if (this.manualStep && this.sequence) {
                                if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
                                this.sequence[this.expansionPhase].push({ op: 'remLine', args: [lx, ly, face] });
                            }
                        }
                    }
                }
            }
        }
        this.cycleState.step++;
    }
    */

    /*
    _attemptLayerOverlap() {
        if (this.overlapState.step % 4 === 0) this._mergeLayers();
        const l1Blocks = this.activeBlocks.filter(b => b.layer === 1);
        const anchor = (l1Blocks.length > 0 && Math.random() < 0.7) 
            ? l1Blocks[Math.floor(Math.random() * l1Blocks.length)]
            : this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        if (!anchor) return;
        const range = 6 + Math.floor(this.overlapState.step / 3);
        let tx, ty, tw, th, success = false;
        for (let i = 0; i < 5; i++) {
            tw = Math.floor(Math.random() * 3) + 1; th = Math.floor(Math.random() * 3) + 1;
            const ox = Math.floor(Math.random() * (anchor.w + tw + 1)) - tw;
            const oy = Math.floor(Math.random() * (anchor.h + th + 1)) - th;
            tx = anchor.x + ox; ty = anchor.y + oy;
            if (Math.abs(tx) <= range && Math.abs(ty) <= range) { success = true; break; }
        }
        if (!success) {
            tx = Math.floor(Math.random() * range * 2) - range;
            ty = Math.floor(Math.random() * range * 2) - range;
            tw = Math.floor(Math.random() * 2) + 1; th = Math.floor(Math.random() * 2) + 1;
        }
        this._spawnBlock(tx, ty, tw, th, 1);
        if (Math.random() < 0.2) this._spawnBlock(tx + Math.floor(Math.random() * 5) - 2, ty + Math.floor(Math.random() * 5) - 2, 1, 1, 0);
        this.overlapState.step++;
    }

    _mergeLayers() {
        if (this.maskOps) {
            for (const op of this.maskOps) if (op.layer === 1) op.layer = 0;
        }
        for (const b of this.activeBlocks) if (b.layer === 1) b.layer = 0;
        if (!this.layerGrids[1] || !this.layerGrids[0]) return;
        for(let i=0; i<this.layerGrids[1].length; i++) {
            const val = this.layerGrids[1][i];
            if (val !== -1) { this.layerGrids[0][i] = val; this.layerGrids[1][i] = -1; }
        }
    }
    */

    _nudge(x, y, w, h, face, layer = 0) {
        const now = this.animFrame;
        const op = { type: 'addSmart', x1: x, y1: y, x2: x + w - 1, y2: y + h - 1, ext: false, startFrame: now, startPhase: this.expansionPhase, layer: layer };
        this.maskOps.push(op);

        if (this.manualStep && this.sequence) {
            if (!this.sequence[this.expansionPhase]) this.sequence[this.expansionPhase] = [];
            this.sequence[this.expansionPhase].push({ 
                op: 'nudge', 
                args: [x, y, w, h, face], 
                layer: layer 
            });
        }

        // 1. Update activeBlocks coordinates (Shift logic)
        let axis = 'X', dir = 1;
        if (face) {
            const f = face.toUpperCase();
            if (f === 'N') { axis = 'Y'; dir = -1; }
            else if (f === 'S') { axis = 'Y'; dir = 1; }
            else if (f === 'E') { axis = 'X'; dir = 1; }
            else if (f === 'W') { axis = 'X'; dir = -1; }
        }

        const shiftAmt = (axis === 'X' ? w : h);
        for (const b of this.activeBlocks) {
            if (b.layer !== layer) continue;
            let shouldMove = false;
            if (axis === 'X') {
                const laneMatch = (b.y >= y && b.y < y + h);
                const posMatch = (dir > 0) ? (b.x >= x) : (b.x <= x + w - 1);
                if (laneMatch && posMatch) shouldMove = true;
            } else {
                const laneMatch = (b.x >= x && b.x < x + w);
                const posMatch = (dir > 0) ? (b.y >= y) : (b.y <= y + h - 1);
                if (laneMatch && posMatch) shouldMove = true;
            }
            if (shouldMove) {
                if (axis === 'X') b.x += (dir * shiftAmt);
                else b.y += (dir * shiftAmt);
            }
        }

        // 2. Add the new nudge block to activeBlocks
        const id = this.nextBlockId++;
        this.activeBlocks.push({ x, y, w, h, startFrame: now, startPhase: this.expansionPhase, layer, id });

        // Update logic grid for the new block
        if (this.logicGrid) {
            const bx = this.logicGridW, by = this.logicGridH;
            const cx = Math.floor(bx / 2), cy = Math.floor(by / 2);
            for (let ly = 0; ly < h; ly++) {
                for (let lx = 0; lx < w; lx++) {
                    const gx = cx + x + lx, gy = cy + y + ly;
                    if (gx >= 0 && gx < bx && gy >= 0 && gy < by) {
                        this.logicGrid[gy * bx + gx] = 1;
                    }
                }
            }
        }

        // 3. Execute Grid/Visual Nudge
        const ctx = {
            cx: Math.floor(this.logicGridW / 2),
            cy: Math.floor(this.logicGridH / 2),
            now: now,
            isActive: (dx, dy) => {
                const gx = Math.floor(this.logicGridW / 2) + dx;
                const gy = Math.floor(this.logicGridH / 2) + dy;
                if (gx < 0 || gx >= this.logicGridW || gy < 0 || gy >= this.logicGridH) return false;
                return this.logicGrid[gy * this.logicGridW + gx] !== 0;
            },
            setLocalActive: (dx, dy) => {
                const gx = Math.floor(this.logicGridW / 2) + dx;
                const gy = Math.floor(this.logicGridH / 2) + dy;
                if (gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH) {
                    this.logicGrid[gy * this.logicGridW + gx] = 1;
                }
            },
            setLocalInactive: (dx, dy) => {
                const gx = Math.floor(this.logicGridW / 2) + dx;
                const gy = Math.floor(this.logicGridH / 2) + dy;
                if (gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH) {
                    this.logicGrid[gy * this.logicGridW + gx] = 0;
                }
            },
            setLayerActive: (dx, dy, l, frame) => {
                const gx = Math.floor(this.logicGridW / 2) + dx;
                const gy = Math.floor(this.logicGridH / 2) + dy;
                if (gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH && this.layerGrids[l]) {
                    this.layerGrids[l][gy * this.logicGridW + gx] = frame;
                }
            },
            setLayerInactive: (dx, dy, l) => {
                const gx = Math.floor(this.logicGridW / 2) + dx;
                const gy = Math.floor(this.logicGridH / 2) + dy;
                if (gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH && this.layerGrids[l]) {
                    this.layerGrids[l][gy * this.logicGridW + gx] = -1;
                }
            }
        };
        
        if (this.sequenceManager && this.sequenceManager._executeNudge) {
            this.sequenceManager._executeNudge(this, x, y, w, h, face, layer, ctx);
        }
        return true;
    }

    _attemptCrawlerGrowth(existingState, targetLayerInput) {
        let s = existingState;
        if (!s) {
            if (this.crawlers.length >= 2 || this.activeBlocks.length === 0) return false;
            let bestX, bestY, bestDX, bestDY, found = false;
            const targetLayer = targetLayerInput !== undefined ? targetLayerInput : 0;

            for (let i = 0; i < 20; i++) {
                const anchors = this.activeBlocks.filter(b => b.layer === targetLayer);
                if (anchors.length === 0) break;
                const anchor = anchors[Math.floor(Math.random() * anchors.length)];
                const dirs = [{dx:0, dy:-1}, {dx:0, dy:1}, {dx:1, dy:0}, {dx:-1, dy:0}];
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                let tx = anchor.x, ty = anchor.y;
                if (dir.dx === 1) tx = anchor.x + anchor.w;
                else if (dir.dx === -1) tx = anchor.x - 1;
                else if (dir.dy === 1) ty = anchor.y + anchor.h;
                else if (dir.dy === -1) ty = anchor.y - 1;
                const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
                if (tx + cx < 4 || tx + cx >= this.logicGridW - 4 || ty + cy < 4 || ty + cy >= this.logicGridH - 4) continue;
                
                const tw = (dir.dx !== 0) ? 2 : 1;
                const th = (dir.dy !== 0) ? 2 : 1;
                let overlap = 0;
                for (const b of this.activeBlocks) {
                    if (b.layer !== targetLayer) continue;
                    const ix = Math.max(tx, b.x), iy = Math.max(ty, b.y);
                    const iw = Math.min(tx + tw, b.x + b.w) - ix, ih = Math.min(ty + th, b.y + b.h) - iy;
                    if (iw > 0 && ih > 0) overlap += (iw * ih);
                }
                if (overlap < (tw * th)) { bestX = tx; bestY = ty; bestDX = dir.dx; bestDY = dir.dy; found = true; break; }
            }
            if (!found) return false;
            s = { active: true, step: 0, x: bestX, y: bestY, dx: bestDX, dy: bestDY, lastBlockIds: [], layer: targetLayer };
            this.crawlers.push(s); return true;
        }
        
        const cycle = (s.step % 6), now = this.animFrame;
        const dx = s.dx, dy = s.dy;
        const layer = s.layer !== undefined ? s.layer : 1;

        // Helper to rotate local coordinates based on direction
        const rotate = (lx, ly) => {
            if (dy === -1) return { rx: s.x + lx, ry: s.y + ly }; // N
            if (dy === 1)  return { rx: s.x - lx, ry: s.y - ly }; // S
            if (dx === 1)  return { rx: s.x - ly, ry: s.y + lx }; // E
            if (dx === -1) return { rx: s.x + ly, ry: s.y - lx }; // W
            return { rx: s.x + lx, ry: s.y + ly };
        };

        const addL1 = (lx, ly) => {
            const { rx, ry } = rotate(lx, ly);
            const id = this._spawnBlock(rx, ry, 1, 1, layer, false, false, 0, true, true);
            if (id !== -1) s.lastBlockIds.push(id);
        };

        const mergeL1ToL0 = (lx, ly) => {
            const { rx, ry } = rotate(lx, ly);
            const block = this.activeBlocks.find(b => b.x === rx && b.y === ry && b.layer === layer);
            if (block) {
                // Remove from current Layer
                this.maskOps.push({ type: 'removeBlock', x1: rx, y1: ry, x2: rx, y2: ry, startFrame: now, layer: layer });
                this._writeToGrid(rx, ry, 1, 1, -1, layer);
                this.activeBlocks = this.activeBlocks.filter(b => b.id !== block.id);
                s.lastBlockIds = s.lastBlockIds.filter(id => id !== block.id);
                // Permanent Merge to Layer 0
                this._spawnBlock(rx, ry, 1, 1, 0, true, false, 0, true, true);
            }
        };

        const addRectL1 = (lx1, ly1, lx2, ly2) => {
            const minX = Math.min(lx1, lx2), maxX = Math.max(lx1, lx2);
            const minY = Math.min(ly1, ly2), maxY = Math.max(ly1, ly2);
            for (let ly = minY; ly <= maxY; ly++) {
                for (let lx = minX; lx <= maxX; lx++) {
                    addL1(lx, ly);
                }
            }
        };

        const remL1 = (lx, ly) => {
            const { rx, ry } = rotate(lx, ly);
            const block = this.activeBlocks.find(b => b.x === rx && b.y === ry && b.layer === layer);
            if (block) {
                this.maskOps.push({ type: 'removeBlock', x1: rx, y1: ry, x2: rx, y2: ry, startFrame: now, layer: layer });
                this._writeToGrid(rx, ry, 1, 1, -1, layer);
                this.activeBlocks = this.activeBlocks.filter(b => b.id !== block.id);
                s.lastBlockIds = s.lastBlockIds.filter(id => id !== block.id);
            }
        };

        const nudgeAction = (lx, ly, lw, lh, face) => {
            const { rx, ry } = rotate(lx, ly);
            let rFace = face;
            const faces = ['N', 'E', 'S', 'W'];
            let fIdx = faces.indexOf(face);
            if (fIdx !== -1) {
                let rot = 0;
                if (dx === 1) rot = 1; else if (dy === 1) rot = 2; else if (dx === -1) rot = 3;
                rFace = faces[(fIdx + rot) % 4];
            }
            let rw = lw, rh = lh;
            if (dx !== 0) { rw = lh; rh = lw; }
            this._nudge(rx, ry, rw, rh, rFace, layer);
        };

        // Pattern Mapping (6-step cycle)
        if (cycle === 0) {
            // [9,0,-1,0,0,1]
            addRectL1(0, -1, 0, 0);
        } else if (cycle === 1) {
            // [9,0,-1,0,-1,1, 11,0,-1,1, 8,1,0,1]
            remL1(0, -1);
            addL1(1, 0);
        } else if (cycle === 2) {
            // [12,0,0,2,1,0,1, 11,1,-1,1, 11,0,-1,1]
            // Cumulative Merge
            mergeL1ToL0(0, 0);
            mergeL1ToL0(1, 0);
            nudgeAction(0, 0, 2, 1, 'N');
            // Pattern cleanup (already handled by merge if we are cumulative)
            remL1(1, -1);
            remL1(0, -1);
        } else if (cycle === 3) {
            // [9,0,-2,0,-1,1]
            addRectL1(0, -2, 0, -1);
        } else if (cycle === 4) {
            // [11,0,-2,1, 8,1,-1,1]
            remL1(0, -2);
            addL1(1, -1);
        } else if (cycle === 5) {
            // Final Merge
            mergeL1ToL0(0, -1);
            mergeL1ToL0(1, -1);
            // Move origin for next loop
            s.x += dx * 2; s.y += dy * 2;
        }

        s.step++;
        return true;
    }

    _attemptShiftGrowth() {
        if (this.activeBlocks.length === 0) return;
        const anchor = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        const dirs = ['N', 'S', 'E', 'W'], dir = dirs[Math.floor(Math.random() * dirs.length)];
        const amount = Math.floor(Math.random() * 2) + 1;
        let startCoords = (dir === 'N' || dir === 'S') ? { x: anchor.x, y: 0 } : { x: 0, y: anchor.y };
        this._blockShift(dir, amount, startCoords);
    }

    _blockShift(direction, amount, startCoords) {
        if (!this.renderGrid) return;
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
            if (this.renderGrid[idx] !== -1) furthestDist = d;
            else potentialGaps.push({x: tx, y: ty, d: d});
        }
        for (const gap of potentialGaps) if (gap.d < furthestDist) this._spawnBlock(gap.x, gap.y, 1, 1, 0, false, false, 0, false, true); 
        let startExt = furthestDist + 1;
        for (let i = 0; i < amount; i++) {
            const d = startExt + i, tx = currentRelX + (scanX ? d * dx : 0), ty = currentRelY + (scanX ? 0 : d * dy);
            const gx = cx + tx, gy = cy + ty;
            if (gx >= 0 && gx < w && gy >= 0 && gy < h) this._spawnBlock(tx, ty, 1, 1, 0);
        }
    }

    _attemptClusterGrowth() {
        if (this.activeBlocks.length === 0) return;
        const anchor = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        const axis = Math.random() < 0.5 ? 'V' : 'H';
        let dir, startCoords;
        if (axis === 'V') { dir = Math.random() < 0.5 ? 'N' : 'S'; startCoords = { x: anchor.x, y: 0 }; }
        else { dir = Math.random() < 0.5 ? 'E' : 'W'; startCoords = { x: 0, y: anchor.y }; }
        this._blockShift(dir, Math.floor(Math.random() * 2) + 2, startCoords);
    }

    _performHoleCleanup() {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (let l = 0; l < 5; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            for (let gy = 1; gy < h - 1; gy++) {
                for (let gx = 1; gx < w - 1; gx++) {
                    const idx = gy * w + gx;
                    if (grid[idx] === -1) {
                        const n = grid[(gy - 1) * w + gx] !== -1;
                        const s = grid[(gy + 1) * w + gx] !== -1;
                        const e = grid[gy * w + gx + 1] !== -1;
                        const w_ = grid[gy * w + gx - 1] !== -1;
                        if (n && s && e && w_) this._spawnBlock(gx - cx, gy - cy, 1, 1, l, true, false, 0, true, true);
                    }
                }
            }
        }
    }

    flattenLayers(targetLayers, selectionRect, stepIndex) {
        if (!this.sequence) return 0;
        const layers = targetLayers || [1, 2, 3, 4];
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
            for (let l = 1; l <= 4; l++) {
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
                for (let l = 1; l <= 4; l++) {
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

        return hitN && hitS && hitW && hitE;
    }

    _attemptNudgeGrowth() {
        if (!this.logicGridW || !this.logicGridH) return false;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const minLX = -cx, maxLX = this.logicGridW - 1 - cx;
        const minLY = -cy, maxLY = this.logicGridH - 1 - cy;

        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(this.logicGridW, this.logicGridH, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const pStatus = this._getPerimeterStatus(offX, offY, visibleW, visibleH);

        // Optimization: Pre-allocate lane bounds to avoid object creation in loop
        if (!this._laneMin0 || this._laneMin0.length < 8) {
            this._laneMin0 = new Float32Array(8); this._laneMax0 = new Float32Array(8);
            this._laneMin1 = new Float32Array(8); this._laneMax1 = new Float32Array(8);
        }

        for (let attempt = 0; attempt < 50; attempt++) {
            const axis = Math.random() < 0.5 ? 'X' : 'Y';
            const size = Math.floor(Math.random() * 3) + 1;
            const targetLayer = Math.random() < 0.5 ? 0 : 1;
            const otherLayer = 1 - targetLayer;
            
            let x, y, w, h, dir, units;
            if (axis === 'X') {
                w = size; h = 1;
                x = this._getBiasedCoordinate(minLX, maxLX, w, pStatus, 'X');
                y = 0;
                dir = Math.random() < 0.5 ? 'N' : 'S'; units = w;
            } else {
                w = 1; h = size;
                x = 0;
                y = this._getBiasedCoordinate(minLY, maxLY, h, pStatus, 'Y');
                dir = Math.random() < 0.5 ? 'E' : 'W'; units = h;
            }

            this._laneMin0.fill(Infinity); this._laneMax0.fill(-Infinity);
            this._laneMin1.fill(Infinity); this._laneMax1.fill(-Infinity);

            for (let i = 0; i < this.activeBlocks.length; i++) {
                const b = this.activeBlocks[i];
                const overlapStart = Math.max(axis === 'X' ? x : y, axis === 'X' ? b.x : b.y);
                const overlapEnd = Math.min((axis === 'X' ? x + w : y + h), (axis === 'X' ? b.x + b.w : b.y + b.h));
                if (overlapStart < overlapEnd) {
                    const lMin = b.layer === 0 ? this._laneMin0 : this._laneMin1;
                    const lMax = b.layer === 0 ? this._laneMax0 : this._laneMax1;
                    for (let k = overlapStart; k < overlapEnd; k++) {
                        const idx = k - (axis === 'X' ? x : y);
                        const valMin = axis === 'X' ? b.y : b.x;
                        const valMax = axis === 'X' ? (b.y + b.h - 1) : (b.x + b.w - 1);
                        lMin[idx] = Math.min(lMin[idx], valMin);
                        lMax[idx] = Math.max(lMax[idx], valMax);
                    }
                }
            }

            const checkLane = (layer) => {
                const minArr = layer === 0 ? this._laneMin0 : this._laneMin1;
                for (let i = 0; i < units; i++) if (minArr[i] !== Infinity) return true;
                return false;
            };
            if (!checkLane(targetLayer)) continue;

            const tLaneMin = targetLayer === 0 ? this._laneMin0 : this._laneMin1;
            const tLaneMax = targetLayer === 0 ? this._laneMax0 : this._laneMax1;
            const oLaneMin = otherLayer === 0 ? this._laneMin0 : this._laneMin1;
            const oLaneMax = otherLayer === 0 ? this._laneMax0 : this._laneMax1;

            let pullOther = false;
            for (let i = 0; i < units; i++) {
                const tm = tLaneMin[i];
                const om = oLaneMin[i];
                const oM = oLaneMax[i];
                if (om === Infinity) continue;
                if (dir === 'N' || dir === 'W') { if (tm <= om - 2) pullOther = true; }
                else { 
                    const tM = tLaneMax[i];
                    if (tM >= oM + 2) pullOther = true; 
                }
                if (pullOther) break;
            }

            const minBound = (axis === 'X') ? minLY : minLX;
            const maxBound = (axis === 'X') ? maxLY : maxLX;

            const checkBound = (mMin, mMax, d) => {
                if (d === 'N' || d === 'W') {
                    for (let i = 0; i < units; i++) if (mMin[i] !== Infinity && mMin[i] <= minBound) return false;
                } else {
                    for (let i = 0; i < units; i++) if (mMax[i] !== -Infinity && mMax[i] >= maxBound) return false;
                }
                return true;
            };

            let canNudge = checkBound(tLaneMin, tLaneMax, dir);
            if (canNudge && pullOther && !checkBound(oLaneMin, oLaneMax, dir)) canNudge = false;

            if (canNudge) {
                this._nudge(x, y, w, h, dir, targetLayer);
                if (pullOther) this._nudge(x, y, w, h, dir, otherLayer);
                return true;
            }
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
        for (let i = 0; i < 5; i++) check(i);
        return status;
    }

    _validateNudgeSafety(x, y, w, h, face, targetLayer, pullOther) {
        if (!this.activeBlocks || this.activeBlocks.length === 0) return true;
        const nextBlocks = this.activeBlocks.map(b => ({...b}));
        const uf = face.toUpperCase();
        const axis = (uf === 'N' || uf === 'S') ? 'Y' : 'X';
        const dSign = (uf === 'N' || uf === 'W') ? -1 : 1;
        const shiftAmt = (axis === 'X' ? w : h);
        const apply = (l) => {
            for (let i = 0; i < nextBlocks.length; i++) {
                const b = nextBlocks[i];
                if (b.layer !== l) continue;
                let move = false;
                if (axis === 'X') { if (b.y >= y && b.y < y + h && ((dSign > 0 && b.x >= x) || (dSign < 0 && b.x <= x + w - 1))) move = true; }
                else { if (b.x >= x && b.x < x + w && ((dSign > 0 && b.y >= y) || (dSign < 0 && b.y <= y + h - 1))) move = true; }
                if (move) { if (axis === 'X') b.x += (dSign * shiftAmt); else b.y += (dSign * shiftAmt); }
            }
            nextBlocks.push({ x, y, w, h, layer: l });
        };
        apply(targetLayer);
        if (pullOther) apply(1 - targetLayer);
        return this._checkEnvelopeDrift(nextBlocks);
    }

    _checkEnvelopeDrift(blocks) {
        const lgW = this.logicGridW, lgH = this.logicGridH;
        const cx = Math.floor(lgW / 2), cy = Math.floor(lgH / 2);
        const colMin0 = new Int32Array(lgW).fill(10000), colMax0 = new Int32Array(lgW).fill(-10000);
        const colMin1 = new Int32Array(lgW).fill(10000), colMax1 = new Int32Array(lgW).fill(-10000);
        const rowMin0 = new Int32Array(lgH).fill(10000), rowMax0 = new Int32Array(lgH).fill(-10000);
        const rowMin1 = new Int32Array(lgH).fill(10000), rowMax1 = new Int32Array(lgH).fill(-10000);
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const bx1 = cx + b.x, by1 = cy + b.y, bx2 = bx1 + b.w - 1, by2 = by1 + b.h - 1;
            const targetMinCol = b.layer === 0 ? colMin0 : colMin1, targetMaxCol = b.layer === 0 ? colMax0 : colMax1;
            const targetMinRow = b.layer === 0 ? rowMin0 : rowMin1, targetMaxRow = b.layer === 0 ? rowMax0 : rowMax1;
            for (let x = Math.max(0, bx1); x <= Math.min(lgW - 1, bx2); x++) { targetMinCol[x] = Math.min(targetMinCol[x], by1); targetMaxCol[x] = Math.max(targetMaxCol[x], by2); }
            for (let y = Math.max(0, by1); y <= Math.min(lgH - 1, by2); y++) { targetMinRow[y] = Math.min(targetMinRow[y], bx1); targetMaxRow[y] = Math.max(targetMaxRow[y], bx2); }
        }
        for (let x = 0; x < lgW; x++) if (colMin0[x] !== 10000 && colMin1[x] !== 10000) if (Math.abs(colMin0[x] - colMin1[x]) > 3 || Math.abs(colMax0[x] - colMax1[x]) > 3) return false;
        for (let y = 0; y < lgH; y++) if (rowMin0[y] !== 10000 && rowMin1[y] !== 10000) if (Math.abs(rowMin0[y] - rowMin1[y]) > 3 || Math.abs(rowMax0[y] - rowMax1[y]) > 3) return false;
        return true;
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

    _checkNoOverlap(x, y, w, h) {
        for (const b of this.activeBlocks) {
            const ix = Math.max(x, b.x);
            const iy = Math.max(y, b.y);
            const iw = Math.min(x + w, b.x + b.w) - ix;
            const ih = Math.min(y + h, b.y + b.h) - iy;
            if (iw > 0 && ih > 0) return false;
        }
        const bs = this.getBlockSize();
        const xLimit = (this.g.cols / bs.w / 2) + 5;
        const yLimit = (this.g.rows / bs.h / 2) + 5;
        if (x + w < -xLimit || x > xLimit || y + h < -yLimit || y > yLimit) return false;
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        if (x + cx < 0 || x + cx + w > this.logicGridW || y + cy < 0 || y + cy + h > this.logicGridH) return false;
        return true;
    }

    _checkNoHole(tx, ty, tw, th) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const candidates = [];
        for (let x = tx - 1; x <= tx + tw; x++) { candidates.push([x, ty - 1], [x, ty + th]); }
        for (let y = ty; y < ty + th; y++) { candidates.push([tx - 1, y], [tx + tw, y]); }
        for (const [nx, ny] of candidates) {
            const gx = nx + cx, gy = ny + cy;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
            if (this.logicGrid[gy * w + gx] !== 0) continue;
            if (nx >= tx && nx < tx + tw && ny >= ty && ny < ty + th) continue;
            if (!this._canReachBoundary(nx, ny, tx, ty, tw, th)) return false;
        }
        return true;
    }

    _canReachBoundary(startX, startY, px, py, pw, ph) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const stack = [[startX, startY]], visited = new Set([`${startX},${startY}`]);
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            if (x + cx <= 0 || x + cx >= w - 1 || y + cy <= 0 || y + cy >= h - 1) return true;
            const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
            for (const [nx, ny] of neighbors) {
                const gx = nx + cx, gy = ny + cy;
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                const key = `${nx},${ny}`;
                if (visited.has(key) || (nx >= px && nx < px + pw && ny >= py && ny < py + ph) || this.logicGrid[gy * w + gx] !== 0) continue;
                visited.add(key); stack.push([nx, ny]);
                if (visited.size > 2000) return true; 
            }
        }
        return false;
    }

    _attemptUnfoldGrowth(sequence = null) {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        if (sequence) {
            if (sequence.step === 0) { sequence.step = 1; } 
            else if (sequence.step === 1) {
                const { x, y, bw, bh, dir } = sequence;
                let tx = x, ty = y;
                if (dir === 'N') ty -= bh; else if (dir === 'S') ty += bh;
                else if (dir === 'E') tx += bw; else if (dir === 'W') tx -= bw;
                this._spawnBlock(tx, ty, bw, bh, 1, false, false, 0, true, true);
                sequence.active = false;
                return true;
            }
            return false;
        }
        if (this.unfoldSequences.length > 0) return false;
        const l0 = this.layerGrids[0], l1 = this.layerGrids[1];
        if (!l0 || !l1) return false;
        const anchors = this.activeBlocks.filter(b => b.layer === 0);
        if (anchors.length === 0) return false;
        Utils.shuffle(anchors);
        for (const anchor of anchors) {
            const faces = ['N', 'S', 'E', 'W'];
            Utils.shuffle(faces);
            for (const unfoldDir of faces) {
                let edgeX, edgeY;
                if (unfoldDir === 'N') { edgeX = anchor.x + Math.floor(anchor.w / 2); edgeY = anchor.y; }
                else if (unfoldDir === 'S') { edgeX = anchor.x + Math.floor(anchor.w / 2); edgeY = anchor.y + anchor.h - 1; }
                else if (unfoldDir === 'W') { edgeX = anchor.x; edgeY = anchor.y + Math.floor(anchor.h / 2); }
                else if (unfoldDir === 'E') { edgeX = anchor.x + anchor.w - 1; edgeY = anchor.y + Math.floor(anchor.h / 2); }
                const gx = cx + edgeX, gy = cy + edgeY;
                const neighbors = [{ nx: gx, ny: gy - 1, dir: 'N' }, { nx: gx, ny: gy + 1, dir: 'S' }, { nx: gx + 1, ny: gy, dir: 'E' }, { nx: gx - 1, ny: gy, dir: 'W' }];
                const n = neighbors.find(nb => nb.dir === unfoldDir);
                if (n && n.nx >= 0 && n.nx < w && n.ny >= 0 && n.ny < h && l0[n.ny * w + n.nx] === -1) {
                    const rx = edgeX, ry = edgeY;
                    let isOutwards = false;
                    if (unfoldDir === 'N' && ry <= 0) isOutwards = true; else if (unfoldDir === 'S' && ry >= 0) isOutwards = true;
                    else if (unfoldDir === 'W' && rx <= 0) isOutwards = true; else if (unfoldDir === 'E' && rx >= 0) isOutwards = true;
                    if (!isOutwards) continue;
                    const nSize = Math.floor(Math.random() * 5) + 1;
                    let bw = 1, bh = 1, startX = gx, startY = gy;
                    if (unfoldDir === 'N' || unfoldDir === 'S') { bh = nSize; if (unfoldDir === 'N') startY = gy; else startY = gy - bh + 1; } 
                    else { bw = nSize; if (unfoldDir === 'W') startX = gx; else startX = gx - bw + 1; }
                    let valid = true;
                    if (startX < 0 || startY < 0 || startX + bw > w || startY + bh > h) { valid = false; } 
                    else {
                        for (let ly = 0; ly < bh; ly++) {
                            for (let lx = 0; lx < bw; lx++) {
                                const tidx = (startY + ly) * w + (startX + lx);
                                if (l0[tidx] === -1 || l1[tidx] !== -1) { valid = false; break; }
                            }
                            if (!valid) break;
                        }
                    }
                    if (valid) {
                        let t2x = startX - cx, t2y = startY - cy;
                        if (unfoldDir === 'N') t2y -= bh; else if (unfoldDir === 'S') t2y += bh;
                        else if (unfoldDir === 'E') t2x += bw; else if (unfoldDir === 'W') t2x -= bw;
                        if (this._checkNoOverlap(t2x, t2y, bw, bh) && this._checkNoHole(t2x, t2y, bw, bh)) {
                            this.unfoldSequences.push({ active: true, step: 0, x: startX - cx, y: startY - cy, bw, bh, dir: unfoldDir });
                            this._spawnBlock(startX - cx, startY - cy, bw, bh, 1, false, false, 0, true, true);
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    _attemptRearrangeGrowth() {
        if (this.expansionPhase < 1) return false;
        const prevPhase = this.expansionPhase - 1;
        const candidates = this.activeBlocks.filter(b => b.layer === 1 && b.startPhase === prevPhase && !b.isRearranged);
        if (candidates.length === 0) return false;
        const validShapes = candidates.filter(b => (b.w === 3 && b.h === 1) || (b.w === 4 && b.h === 1) || (b.w === 1 && b.h === 3) || (b.w === 1 && b.h === 4));
        if (validShapes.length === 0) return false;
        const stickingOut = validShapes.filter(b => {
            let outCount = 0;
            const w = this.logicGridW, cx = Math.floor(w / 2), cy = Math.floor(this.logicGridH / 2);
            for (let ly = 0; ly < b.h; ly++) {
                for (let lx = 0; lx < b.w; lx++) {
                    const gx = cx + b.x + lx, gy = cy + b.y + ly;
                    if (this.layerGrids[0] && this.layerGrids[0][gy * w + gx] === -1) { outCount++; }
                }
            }
            return outCount >= 2 && outCount <= 3;
        });
        if (stickingOut.length === 0) return false;
        if (Math.random() < 0.5) return false;
        Utils.shuffle(stickingOut);
        const toRearrange = stickingOut.slice(0, 2);
        let success = false;
        for (const b of toRearrange) {
            const replacements = [{w: 2, h: 2}, {w: 3, h: 2}, {w: 2, h: 3}];
            const rep = replacements[Math.floor(Math.random() * replacements.length)];
            this.maskOps.push({ type: 'removeBlock', x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, startFrame: this.animFrame, layer: 1, fade: false });
            this._clearAreaLines(b.x, b.y, b.w, b.h, this.animFrame);
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);
            b.isRearranged = true; 
            const idx = this.activeBlocks.indexOf(b);
            if (idx !== -1) this.activeBlocks.splice(idx, 1);
            this._spawnBlock(b.x, b.y, rep.w, rep.h, 1, false, false, 0, true, true);
            success = true;
        }
        return success;
    }

    _performAutoActions() {
        for (let i = 0; i < 5; i++) this._fillHoles(i);
        this._connectIslands();
    }

    _fillHoles(layer) {
        const w = this.logicGridW, h = this.logicGridH;
        const grid = this.layerGrids[layer];
        if (!grid) return;
        const outsideMap = new Uint8Array(w * h);
        const queue = new Int32Array(w * h);
        let head = 0, tail = 0;
        const add = (gx, gy) => {
            const idx = gy * w + gx;
            if (outsideMap[idx] === 0 && grid[idx] === -1) { outsideMap[idx] = 1; queue[tail++] = idx; }
        };
        for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
        for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % w, cy = (idx / w) | 0;
            if (cy > 0) add(cx, cy - 1); if (cy < h - 1) add(cx, cy + 1);
            if (cx > 0) add(cx - 1, cy); if (cx < w - 1) add(cx + 1, cy);
        }
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (let i = 0; i < w * h; i++) {
            if (grid[i] === -1 && outsideMap[i] === 0) {
                const gx = i % w, gy = (i / w) | 0;
                this._spawnBlock(gx - cx, gy - cy, 1, 1, layer, true, false, 0, true, true);
            }
        }
    }

    _connectIslands() {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const combined = new Int8Array(w * h).fill(-1);
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { combined[gy * w + gx] = 1; }
            }
        }
        const connectedMap = new Uint8Array(w * h);
        const queue = new Int32Array(w * h);
        let head = 0, tail = 0;
        const startIdx = cy * w + cx;
        if (combined[startIdx] === 1) { connectedMap[startIdx] = 1; queue[tail++] = startIdx; }
        while (head < tail) {
            const idx = queue[head++];
            const gx = idx % w, gy = (idx / w) | 0;
            const neighbors = [idx - w, idx + w, idx - 1, idx + 1];
            for (let i = 0; i < 4; i++) {
                const nIdx = neighbors[i];
                if (nIdx >= 0 && nIdx < w * h && connectedMap[nIdx] === 0 && combined[nIdx] === 1) {
                    if (i === 2 && gx === 0) continue;
                    if (i === 3 && gx === w - 1) continue;
                    connectedMap[nIdx] = 1; queue[tail++] = nIdx;
                }
            }
        }
        const islands = this.activeBlocks.filter(b => {
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { if (connectedMap[gy * w + gx] === 1) return false; }
            }
            return true;
        });
        if (islands.length === 0) return;
        for (const island of islands) {
            let bestDist = Infinity, bestIslandPt = null, bestTargetPt = null;
            const ix1 = cx + island.x, iy1 = cy + island.y, ix2 = ix1 + island.w - 1, iy2 = iy1 + island.h - 1;
            for (let igy = Math.max(0, iy1); igy <= Math.min(h - 1, iy2); igy++) {
                for (let igx = Math.max(0, ix1); igx <= Math.min(w - 1, ix2); igx++) {
                    for (let ty = 0; ty < h; ty++) {
                        for (let tx = 0; tx < w; tx++) {
                            if (connectedMap[ty * w + tx] === 1) {
                                const d = Math.abs(tx - igx) + Math.abs(ty - igy);
                                if (d < bestDist) { bestDist = d; bestIslandPt = { x: igx, y: igy }; bestTargetPt = { x: tx, y: ty }; }
                            }
                        }
                    }
                }
            }
            if (bestIslandPt && bestTargetPt) {
                let curX = bestIslandPt.x, curY = bestIslandPt.y;
                while (curX !== bestTargetPt.x || curY !== bestTargetPt.y) {
                    if (curX < bestTargetPt.x) curX++; else if (curX > bestTargetPt.x) curX--;
                    else if (curY < bestTargetPt.y) curY++; else if (curY > bestTargetPt.y) curY--;
                    if (combined[curY * w + curX] === -1) {
                        this._spawnBlock(curX - cx, curY - cy, 1, 1, island.layer, true, false, 0, true, true);
                        combined[curY * w + curX] = 1;
                    }
                }
            }
        }
    }

    _clearAreaLines(x, y, w, h, startFrame) {
        for (let ly = 0; ly < h; ly++) {
            for (let lx = 0; lx < w; lx++) {
                const fx = x + lx, fy = y + ly;
                const faces = ['N', 'S', 'E', 'W'];
                for (const face of faces) {
                    this.maskOps.push({ 
                        type: 'remLine', 
                        x1: fx, y1: fy, x2: fx, y2: fy, 
                        face: face, 
                        force: true, 
                        startFrame: startFrame 
                    });
                }
            }
        }
    }

    _attemptForceFill() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (let l = 0; l < 5; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    const idx = gy * w + gx;
                    if (grid[idx] === -1) {
                        const hasNeighbor = 
                            (gx > 0 && grid[idx - 1] !== -1) ||
                            (gx < w - 1 && grid[idx + 1] !== -1) ||
                            (gy > 0 && grid[idx - w] !== -1) ||
                            (gy < h - 1 && grid[idx + w] !== -1);
                        if (hasNeighbor) {
                            const bx = gx - cx, by = gy - cy;
                            if (this._validateAdditionSafety(bx, by, l)) {
                                this._spawnBlock(bx, by, 1, 1, l, true, false, 0, true, true);
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    _validateAdditionSafety(bx, by, layer) {
        const nextBlocks = this.activeBlocks.map(b => ({...b}));
        nextBlocks.push({ x: bx, y: by, w: 1, h: 1, layer });
        return this._checkEnvelopeDrift(nextBlocks);
    }

    _isCanvasFullyCovered() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(w, h, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);
        for (let l = 0; l < 5; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            for (let gy = startY; gy < endY; gy++) {
                const rowOff = gy * w;
                for (let gx = startX; gx < endX; gx++) {
                    if (grid[rowOff + gx] === -1) return false;
                }
            }
        }
        return true;
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