class QuantizedShadow {
    constructor() {
        this.shadowGrid = null;
        this.shadowSim = null;
        this.shadowSimFrame = 0;
        this.shadowFade = null; 
        this.oldWorldFade = null; 
    }

    initShadowWorld(fx) {
        this.initShadowWorldBase(fx);
    }

    initShadowWorldBase(fx) {
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
        }
        this.shadowFade.fill(0);
        this.oldWorldFade.fill(1.0); 

        const sm = this.shadowSim.streamManager;
        // Wiping the streams every time an effect is triggered causes an "empty top" and 
        // resets mature tracers. Only resize if the dimensions have actually changed.
        const needsResize = sm.lastStreamInColumn.length !== this.shadowGrid.cols;
        if (needsResize) {
            sm.resize(this.shadowGrid.cols);
        }

        this.shadowSim.timeScale = 1.0;
        
        fx.shadowGrid = this.shadowGrid;
        fx.shadowSim = this.shadowSim;
        fx.warmupRemaining = 0;
        fx.shadowSimFrame = 0;

        return this.shadowSim;
    }

    updateShadowSim(fx) {
        if (!this.shadowSim) return false;
        
        // Sync with kernel frame
        this.shadowSimFrame = (window.matrix) ? window.matrix.frame : (this.shadowSimFrame + 1);
        fx.shadowSimFrame = this.shadowSimFrame;

        // The Kernel now handles updating BOTH worlds in its main loop, 
        // so we don't need to manually update the shadow simulation here anymore.
        // If we are in local fallback mode (no kernel), we still update.
        if (!window.matrix) {
            this.shadowSim.update(this.shadowSimFrame);
        }
        
        if (!fx.renderGrid || !fx._lastBlocksX) return false;

        const blocksX = fx._lastBlocksX;
        const blocksY = fx._lastBlocksY;
        const pitchX = fx._lastPitchX;
        const pitchY = fx._lastPitchY;
        
        const outsideMask = fx.renderer.computeTrueOutside(fx, blocksX, blocksY);
        
        const sg = this.shadowGrid;
        const g = fx.g;
        
        const { offX, offY } = fx._computeCenteredOffset(blocksX, blocksY, pitchX, pitchY);
        const screenBlocksX = Math.ceil(g.cols / pitchX);
        const screenBlocksY = Math.ceil(g.rows / pitchY);

        const userBlockOffX = 0;
        const userBlockOffY = 0;

        const totalCells = g.cols * g.rows;
        if (!this._targetActive || this._targetActive.length !== totalCells) {
            this._targetActive = new Uint8Array(totalCells);
        }
        this._targetActive.fill(0);

        if (fx.c.state.layerEnableShadowWorld !== false) {
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    const idx = by * blocksX + bx;
                    if (outsideMask[idx] === 1) continue; 

                    const destBx = bx - offX + userBlockOffX;
                    const destBy = by - offY + userBlockOffY;
                    
                    if (destBx < -1.5 || destBx > screenBlocksX + 1.5 || destBy < -1.5 || destBy > screenBlocksY + 1.5) continue;
                    
                    const startCellX = Math.round(destBx * pitchX);
                    const startCellY = Math.round(destBy * pitchY);
                    const endCellX = Math.round((destBx + 1) * pitchX);
                    const endCellY = Math.round((destBy + 1) * pitchY);                    
                    for (let cy = startCellY; cy < endCellY; cy++) {
                        if (cy >= g.rows || cy < 0) continue;
                        for (let cx = startCellX; cx < endCellX; cx++) {
                            if (cx >= g.cols || cx < 0) continue;
                            const destIdx = cy * g.cols + cx;
                            this._targetActive[destIdx] = 1;
                        }
                    }
                }
            }
        }

        const fadeSpeedSec = fx.c.state.quantizedShadowWorldFadeSpeed !== undefined ? fx.c.state.quantizedShadowWorldFadeSpeed : 0.5;
        const fadeDelta = (fadeSpeedSec <= 0) ? 1.0 : (1.0 / (fadeSpeedSec * 60)); 

        for (let i = 0; i < totalCells; i++) {
            const target = this._targetActive[i];
            let sFade = this.shadowFade[i];
            let oFade = this.oldWorldFade[i];

            if (target === 1) {
                sFade = 1.0;
                oFade = Math.max(0.0, oFade - fadeDelta);
            } else {
                oFade = 1.0;
                sFade = Math.max(0.0, sFade - fadeDelta);
            }
            this.shadowFade[i] = sFade;
            this.oldWorldFade[i] = oFade;

            if (sFade > 0 && oFade > 0) {
                const srcIdx = i; 
                if (sg && sg.chars && srcIdx < sg.chars.length) {
                    g.overrideActive[i] = 5; 
                    g.overrideChars[i] = sg.chars[srcIdx];
                    g.overrideColors[i] = sg.colors[srcIdx];
                    g.overrideAlphas[i] = g.alphas[i] * oFade; 
                    g.overrideGlows[i] = sg.alphas[srcIdx] * sFade; 
                    g.overrideMix[i] = sg.mix[srcIdx]; 
                    g.overrideNextChars[i] = sg.nextChars[srcIdx];
                    g.overrideFontIndices[i] = sg.fontIndices[srcIdx];
                }
            } else if (sFade > 0) {
                const srcIdx = i;
                if (sg && sg.chars && srcIdx < sg.chars.length) {
                    g.overrideActive[i] = 3; 
                    g.overrideChars[i] = sg.chars[srcIdx];
                    g.overrideColors[i] = sg.colors[srcIdx];
                    g.overrideAlphas[i] = sg.alphas[srcIdx] * sFade; 
                    g.overrideGlows[i] = sg.glows[srcIdx];
                    g.overrideMix[i] = sg.mix[srcIdx];
                    g.overrideNextChars[i] = sg.nextChars[srcIdx];
                    g.overrideFontIndices[i] = sg.fontIndices[srcIdx];
                }
            } else {
                if (g.overrideActive[i] !== 0) {
                    g.overrideActive[i] = 0;
                }
            }
        }
        
        return false;
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