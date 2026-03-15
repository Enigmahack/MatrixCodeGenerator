class QuantizedShadow {
    constructor() {
        this.shadowGrid = null;
        this.shadowSim = null;
        this.shadowSimFrame = 0;
        this.shadowFade = null; 
        this.oldWorldFade = null; 
        this.activeIndices = new Set();
        this._targetActive = null;
    }

    initShadowWorld(fx) {
        this.initShadowWorldBase(fx);
    }

    initShadowWorldBase(fx) {
        let startTime = 0;
        const logEnabled = fx.c.state.logErrors;
        if (logEnabled) startTime = performance.now();

        // --- PING-PONG REFACTOR ---
        // Instead of a dedicated GlobalShadowWorld, we use the kernel's inactive world.
        if (window.matrix && window.matrix.inactiveWorld) {
            this.shadowGrid = window.matrix.inactiveWorld.grid;
            this.shadowSim = window.matrix.inactiveWorld.sim;
        } else {
            fx._warn("[QuantizedShadow] Matrix Kernel or Inactive World not found. Initializing locally as fallback.");
            this.shadowGrid = new CellGrid(fx.c);
            const d = fx.c.derived;
            const w = fx.g.cols * d.cellWidth;
            const h = fx.g.rows * d.cellHeight;
            this.shadowGrid.resize(w, h);
            this.shadowGrid.isShadow = true;
            this.shadowSim = new SimulationSystem(this.shadowGrid, fx.c, false);
        }

        const totalCells = fx.g.cols * fx.g.rows;
        if (!this.shadowFade || this.shadowFade.length !== totalCells) {
            this.shadowFade = new Float32Array(totalCells);
            this.oldWorldFade = new Float32Array(totalCells);
            this._targetActive = new Uint8Array(totalCells);
        }
        this.shadowFade.fill(0);
        this.oldWorldFade.fill(1.0);
        this._targetActive.fill(0);

        if (!this.activeIndices) {
            this.activeIndices = new Set();
        } else {
            this.activeIndices.clear();
        }

        this.shadowSim.timeScale = 1.0;

        // --- CLEAN SLATE FOR SHADOW WORLD ---
        if (this.shadowGrid) {
            this.shadowGrid.clearAllOverrides();
            this.shadowGrid.clearAllEffects();
            if (this.shadowGrid.effectActive)  this.shadowGrid.effectActive.fill(0);
            if (this.shadowGrid.effectAlphas)  this.shadowGrid.effectAlphas.fill(0);
            if (this.shadowGrid.overrideMix)   this.shadowGrid.overrideMix.fill(0);
            if (this.shadowGrid.secondaryActive) this.shadowGrid.secondaryActive.fill(0);
        }

        fx.shadowGrid = this.shadowGrid;
        fx.shadowSim = this.shadowSim;
        fx.warmupRemaining = 0;
        fx.shadowSimFrame = 0;

        if (logEnabled) {
            const endTime = performance.now();
            console.log(`[QuantizedShadow] initShadowWorldBase took ${(endTime - startTime).toFixed(2)}ms`);
        }

        return this.shadowSim;
    }
    updateShadowSim(fx) {
        if (!this.shadowSim) return false;
        
        // Sync with kernel frame
        this.shadowSimFrame = (window.matrix) ? window.matrix.frame : (this.shadowSimFrame + 1);
        fx.shadowSimFrame = this.shadowSimFrame;

        if (!window.matrix) {
            this.shadowSim.update(this.shadowSimFrame);
        }
        
        if (!fx.renderGrid || !fx._lastBlocksX) return false;

        const blocksX = fx._lastBlocksX;
        const blocksY = fx._lastBlocksY;
        const pitchX = fx._lastPitchX;
        const pitchY = fx._lastPitchY;
        
        const sg = this.shadowGrid;
        const g = fx.g;
        const totalCells = g.cols * g.rows;

        // Ensure buffers are ready
        if (!this.shadowFade || this.shadowFade.length !== totalCells) {
            this.initShadowWorldBase(fx);
        }

        const { offX, offY } = fx._computeCenteredOffset(blocksX, blocksY, pitchX, pitchY);
        const screenBlocksX = Math.ceil(g.cols / pitchX);
        const screenBlocksY = Math.ceil(g.rows / pitchY);

        // 1. Mark target active cells
        this._targetActive.fill(0);
        let hasActiveTarget = false;
        if (fx.c.state.layerEnableShadowWorld !== false) {
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    const idx = by * blocksX + bx;
                    if (!fx.shadowRevealGrid || fx.shadowRevealGrid[idx] === 0) continue;

                    const destBx = bx - offX;
                    const destBy = by - offY;
                    
                    if (destBx < -1.5 || destBx > screenBlocksX + 1.5 || destBy < -1.5 || destBy > screenBlocksY + 1.5) continue;
                    
                    const startCellX = Math.max(0, Math.round(destBx * pitchX));
                    const startCellY = Math.max(0, Math.round(destBy * pitchY));
                    const endCellX = Math.min(g.cols, Math.round((destBx + 1) * pitchX));
                    const endCellY = Math.min(g.rows, Math.round((destBy + 1) * pitchY));                    
                    
                    for (let cy = startCellY; cy < endCellY; cy++) {
                        const rowOff = cy * g.cols;
                        for (let cx = startCellX; cx < endCellX; cx++) {
                            this._targetActive[rowOff + cx] = 1;
                        }
                    }
                    hasActiveTarget = true;
                }
            }
        }

        let fadeSpeedSec = fx.getConfig('ShadowWorldFadeSpeed') ?? 0.5;
        const fadeDelta = (fadeSpeedSec <= 0) ? 1.0 : (1.0 / (fadeSpeedSec * 60)); 

        // 2. Optimized O(N) Processing (TypedArray scan is much faster than Set overhead)
        for (let i = 0; i < totalCells; i++) {
            const target = this._targetActive[i];
            let sFade = this.shadowFade[i];
            let oFade = this.oldWorldFade[i];

            if (target === 1) {
                if (sFade >= 1.0 && oFade <= 0.0) {
                    // Optimization: Already fully revealed, skip heavy overrides
                    // But we still need to set overrideActive to 5 if not already
                    if (g.overrideActive[i] !== 5) {
                        this._setOverride(g, sg, i, 1.0, 0.0);
                    }
                    continue;
                }
                sFade = Math.min(1.0, sFade + fadeDelta);
                oFade = Math.max(0.0, oFade - fadeDelta);
            } else {
                if (sFade <= 0.0) {
                    if (g.overrideActive[i] !== 0) g.overrideActive[i] = 0;
                    continue;
                }
                sFade = Math.max(0.0, sFade - fadeDelta);
                oFade = Math.min(1.0, oFade + fadeDelta);
            }
            this.shadowFade[i] = sFade;
            this.oldWorldFade[i] = oFade;

            if (sFade > 0) {
                this._setOverride(g, sg, i, sFade, oFade);
            } else {
                if (g.overrideActive[i] !== 0) g.overrideActive[i] = 0;
            }
        }
        
        return false;
    }

    _setOverride(g, sg, i, sFade, oFade) {
        if (sg && sg.chars && i < sg.chars.length) {
            g.overrideActive[i] = 5;
            g.overrideChars[i] = sg.chars[i];
            g.overrideColors[i] = sg.colors[i];
            g.overrideAlphas[i] = oFade;
            g.overrideGlows[i] = sg.alphas[i] * sFade;
            g.overrideMix[i] = sg.mix[i];
            g.overrideNextChars[i] = sg.nextChars[i];
            g.overrideFontIndices[i] = sg.fontIndices[i];
        }
    }

    commitShadowState(fx) {
        if (!this.shadowGrid || !this.shadowSim) return false;
        try {
            // --- PING-PONG REFACTOR ---
            // Instead of copying data between worlds, we simply flip the active index in the kernel.
            if (window.matrix && typeof window.matrix.swapWorlds === 'function') {
                window.matrix.swapWorlds();
                return 'SYNC';
            }
            return 'SYNC';
        } catch (e) {
            fx._error("[QuantizedShadow] Swap failed:", e);
            return false;
        }
    }
}