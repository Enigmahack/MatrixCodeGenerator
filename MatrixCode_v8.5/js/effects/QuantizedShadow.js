class QuantizedShadow {
    constructor() {
        this.shadowGrid = null;
        this.shadowSim = null;
        this.warmupRemaining = 0;
        this.shadowSimFrame = 0;
        this.shadowFade = null; // Float32Array for shadow world alpha tracking
        this.oldWorldFade = null; // Float32Array for old world (simulation) alpha tracking
    }

    initShadowWorld(fx) {
        this.initShadowWorldBase(fx, false);
        const s = fx.c.state;
        const d = fx.c.derived;

        const sm = this.shadowSim.streamManager;
        const cols = this.shadowGrid.cols;
        const rows = this.shadowGrid.rows;

        // --- Stream Injection (Pre-population) ---
        for (let x = 0; x < cols; x++) {
            if (Math.random() < 0.30) {
                const y = Math.floor(Math.random() * (rows + 10));
                sm.injectStream(x, y, false);
                if (Math.random() < 0.15) {
                    const ey = Math.floor(Math.random() * (y - 5));
                    sm.injectStream(x, ey, true);
                }
            } else if (Math.random() < 0.15) {
                const y = Math.floor(Math.random() * (rows + 10));
                sm.injectStream(x, y, true);
            }
        }

        const avgTickInterval = Math.max(1, 21 - (s.streamSpeed || 10));
        let warmupFrames = Math.floor(rows * avgTickInterval * 2.5);
        warmupFrames = Math.max(200, warmupFrames);
        warmupFrames = Math.min(5000, warmupFrames);
        
        this.warmupRemaining = warmupFrames;
        fx.warmupRemaining = warmupFrames;
        this.shadowSimFrame = 0;
        fx.shadowSimFrame = 0;
    }

    initShadowWorldBase(fx, workerEnabled = false) {
        this.shadowGrid = new CellGrid(fx.c);
        const d = fx.c.derived;
        const w = fx.g.cols * d.cellWidth; 
        const h = fx.g.rows * d.cellHeight;
        this.shadowGrid.resize(w, h);
        
        this.shadowSim = new SimulationSystem(this.shadowGrid, fx.c, false);
        this.shadowSim.useWorker = workerEnabled;

        const totalCells = fx.g.cols * fx.g.rows;
        this.shadowFade = new Float32Array(totalCells);
        this.shadowFade.fill(0);
        this.oldWorldFade = new Float32Array(totalCells);
        this.oldWorldFade.fill(1.0); // Initially old world is fully visible

        if (!workerEnabled && this.shadowSim.worker) {
            this.shadowSim.worker.terminate();
            this.shadowSim.worker = null;
        }
        
        const sm = this.shadowSim.streamManager;
        sm.resize(this.shadowGrid.cols);
        this.shadowSim.timeScale = 1.0;
        
        fx.shadowGrid = this.shadowGrid;
        fx.shadowSim = this.shadowSim;
        fx.warmupRemaining = 0;
        fx.shadowSimFrame = 0;

        return this.shadowSim;
    }

    updateShadowSim(fx) {
        if (!this.shadowSim) return false;
        
        if (fx.warmupRemaining !== undefined && fx.warmupRemaining !== this.warmupRemaining) {
            this.warmupRemaining = fx.warmupRemaining;
        }

        if (this.warmupRemaining > 0) {
            const batch = 50; 
            const toRun = Math.min(this.warmupRemaining, batch);
            for (let i = 0; i < toRun; i++) {
                this.shadowSim.update(++this.shadowSimFrame);
            }
            this.warmupRemaining -= toRun;
            fx.warmupRemaining = this.warmupRemaining; 
            fx.shadowSimFrame = this.shadowSimFrame;
            return true; 
        }

        this.shadowSim.update(++this.shadowSimFrame);
        fx.shadowSimFrame = this.shadowSimFrame;
        
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

        // Track intended shadow world occupancy for this frame
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

        // Apply fading logic
        const fadeSpeedSec = fx.c.state.quantizedShadowWorldFadeSpeed !== undefined ? fx.c.state.quantizedShadowWorldFadeSpeed : 0.5;
        const fadeDelta = (fadeSpeedSec <= 0) ? 1.0 : (1.0 / (fadeSpeedSec * 60)); // Assuming 60fps

        for (let i = 0; i < totalCells; i++) {
            const target = this._targetActive[i];
            let sFade = this.shadowFade[i];
            let oFade = this.oldWorldFade[i];

            if (target === 1) {
                // ACTIVATION: Shadow World appears instantly, Old World fades out
                sFade = 1.0;
                oFade = Math.max(0.0, oFade - fadeDelta);
            } else {
                // DEACTIVATION: Old World appears instantly, Shadow World fades out
                oFade = 1.0;
                sFade = Math.max(0.0, sFade - fadeDelta);
            }
            this.shadowFade[i] = sFade;
            this.oldWorldFade[i] = oFade;

            if (sFade > 0 && oFade > 0) {
                // DUAL WORLD (Transition overlap)
                const srcIdx = i; 
                if (sg && sg.chars && srcIdx < sg.chars.length) {
                    g.overrideActive[i] = 5; // DUAL MODE
                    g.overrideChars[i] = sg.chars[srcIdx];
                    g.overrideColors[i] = sg.colors[srcIdx];
                    g.overrideAlphas[i] = g.alphas[i] * oFade; // OW Combined Alpha
                    
                    // We use overrideGlows to pass the New World transition alpha (nwA)
                    // This NW alpha combines shadow world sim alpha and world-level fade
                    g.overrideGlows[i] = sg.alphas[srcIdx] * sFade; 
                    
                    // Now overrideMix can stay as the Shadow World's rotator mix!
                    g.overrideMix[i] = sg.mix[srcIdx]; 
                    
                    g.overrideNextChars[i] = sg.nextChars[srcIdx];
                    g.overrideFontIndices[i] = sg.fontIndices[srcIdx];
                }
            } else if (sFade > 0) {
                // FULL SHADOW WORLD (Mode 3)
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
                // COMPLETELY BACK TO OLD WORLD
                if (g.overrideActive[i] !== 0) {
                    g.overrideActive[i] = 0;
                }
            }
        }
    }

    commitShadowState(fx) {
        if (!this.shadowGrid || !this.shadowSim) return false;
        try {
            const g = fx.g;
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
                const shadowFrame = (this.shadowSimFrame !== undefined) ? this.shadowSimFrame : (fx.localFrame || 0);
                const delta = frameOffset - shadowFrame;
                state.nextSpawnFrame = shadowMgr.nextSpawnFrame + delta;
                if (mainSim.useWorker && mainSim.worker) {
                    mainSim.worker.postMessage({ type: 'replace_state', state: state });
                    mainSim.worker.postMessage({ type: 'config', config: { state: JSON.parse(JSON.stringify(fx.c.state)), derived: fx.c.derived } });
                    return 'ASYNC';
                } else {
                    state.activeStreams.forEach(s => { if (Array.isArray(s.holes)) s.holes = new Set(s.holes); });
                    const mainMgr = mainSim.streamManager;
                    // Merge shadow streams into main mgr (don't overwrite)
                    mainMgr.activeStreams = mainMgr.activeStreams.concat(state.activeStreams);
                    mainMgr.columnSpeeds.set(state.columnSpeeds);
                    if (mainMgr.streamsPerColumn && state.streamsPerColumn) mainMgr.streamsPerColumn.set(state.streamsPerColumn);
                    mainMgr.lastStreamInColumn = state.lastStreamInColumn;
                    mainMgr.lastEraserInColumn = state.lastEraserInColumn;
                    mainMgr.lastUpwardTracerInColumn = state.lastUpwardTracerInColumn;
                    mainMgr.nextSpawnFrame = Math.min(mainMgr.nextSpawnFrame, state.nextSpawnFrame);
                    mainSim.overlapInitialized = state.overlapInitialized;
                    mainSim._lastOverlapDensity = state._lastOverlapDensity;
                    if (state.activeIndices) {
                        // Merge active indices (don't clear)
                        state.activeIndices.forEach(idx => mainSim.grid.activeIndices.add(idx));
                    }
                    return 'SYNC';
                }
            }
            return 'SYNC';
        } catch (e) {
            console.error("[QuantizedShadow] Swap failed:", e);
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
        
        // --- Merge activeIndices and update activeFlag ---
        if (g.activeFlag) {
            // If using SAB, update main grid's activeFlag
            for (let i = 0; i < g.activeFlag.length; i++) {
                if (sg.activeFlag && sg.activeFlag[i] === 1) {
                    g.activeFlag[i] = 1;
                }
            }
        }

        // Add shadow's active cells to main grid's activeIndices (Merge, don't clear)
        if (sg.activeIndices.size > 0) {
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
}