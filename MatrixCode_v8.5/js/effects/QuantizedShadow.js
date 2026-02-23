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
        if (!window.globalShadowWorld) {
            console.warn("[QuantizedShadow] GlobalShadowWorld not found. Initializing locally as fallback.");
            this.shadowGrid = new CellGrid(fx.c);
            const d = fx.c.derived;
            const w = fx.g.cols * d.cellWidth; 
            const h = fx.g.rows * d.cellHeight;
            this.shadowGrid.resize(w, h);
            this.shadowGrid.isShadow = true;
            this.shadowSim = new SimulationSystem(this.shadowGrid, fx.c, false);
        } else {
            this.shadowGrid = window.globalShadowWorld.grid;
            this.shadowSim = window.globalShadowWorld.simulation;
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

        // POPULATION LOGIC: Ensure the shadow world is populated with tracers before reveal
        // Temporarily disabled for testing
        /*
        const activeCount = sm.activeStreams.length;
        const targetCount = Math.floor(this.shadowGrid.cols * 0.75);
        
        if (needsResize || activeCount < (this.shadowGrid.cols * 0.05)) {
            const columns = [];
            for (let i = 0; i < this.shadowGrid.cols; i++) columns.push(i);
            Utils.shuffle(columns);
            
            const toInject = columns.slice(0, targetCount);
            for (const col of toInject) {
                // Random Y position across the full screen height
                const y = Math.floor(Math.random() * this.shadowGrid.rows);
                // Mix of tracers and erasers
                const isEraser = Math.random() < 0.15;
                sm.injectStream(col, y, isEraser);
            }
        }
        */

        this.shadowSim.timeScale = 1.0;
        
        fx.shadowGrid = this.shadowGrid;
        fx.shadowSim = this.shadowSim;
        fx.warmupRemaining = 0;
        fx.shadowSimFrame = 0;

        return this.shadowSim;
    }

    updateShadowSim(fx) {
        if (!this.shadowSim) return false;
        
        this.shadowSimFrame = window.globalShadowWorld ? window.globalShadowWorld.frame : (this.shadowSimFrame + 1);
        fx.shadowSimFrame = this.shadowSimFrame;

        // If using local fallback, manually update the simulation
        if (!window.globalShadowWorld) {
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
            const g = fx.g;
            const sg = this.shadowGrid;
            
            // --- FULL STATE REPLACEMENT ---
            // Overwrite entire grid memory with shadow world memory
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
                    columnSpeeds: Array.from(shadowMgr.columnSpeeds), 
                    streamsPerColumn: Array.from(shadowMgr.streamsPerColumn),   
                    lastStreamInColumn: serializeRefArray(shadowMgr.lastStreamInColumn),
                    lastEraserInColumn: serializeRefArray(shadowMgr.lastEraserInColumn),
                    lastUpwardTracerInColumn: serializeRefArray(shadowMgr.lastUpwardTracerInColumn),
                    nextSpawnFrame: shadowMgr.nextSpawnFrame,
                    overlapInitialized: this.shadowSim.overlapInitialized,
                    _lastOverlapDensity: this.shadowSim._lastOverlapDensity,
                    activeIndices: Array.from(sg.activeIndices),
                    complexStyles: Array.from(sg.complexStyles.entries())
                };
                
                if (mainSim.useWorker && mainSim.worker) {
                    mainSim.worker.postMessage({ type: 'replace_state', state: state });
                    return 'ASYNC';
                } else {
                    state.activeStreams.forEach(s => { if (Array.isArray(s.holes)) s.holes = new Set(s.holes); });
                    const mainMgr = mainSim.streamManager;
                    
                    // --- FULL REPLACEMENT OF SIMULATION STATE ---
                    // This ensures the main world becomes a exact functional clone of the shadow world.
                    mainMgr.activeStreams = state.activeStreams;
                    mainMgr.columnSpeeds.set(state.columnSpeeds);
                    if (mainMgr.streamsPerColumn && state.streamsPerColumn) {
                        mainMgr.streamsPerColumn.set(state.streamsPerColumn);
                    }
                    mainMgr.lastStreamInColumn = state.lastStreamInColumn;
                    mainMgr.lastEraserInColumn = state.lastEraserInColumn;
                    mainMgr.lastUpwardTracerInColumn = state.lastUpwardTracerInColumn;
                    
                    mainMgr.nextSpawnFrame = state.nextSpawnFrame;
                    mainSim.overlapInitialized = state.overlapInitialized;
                    mainSim._lastOverlapDensity = state._lastOverlapDensity;
                    
                    // Re-sync Global Shadow World for next transition
                    if (window.globalShadowWorld) {
                        window.globalShadowWorld.initialized = false;
                        window.globalShadowWorld.init(fx.g.cols * fx.c.derived.cellWidth, fx.g.rows * fx.c.derived.cellHeight, mainSim.frame);
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
        // Rigorous buffer-by-buffer overwrite. 
        // This ensures the main memory is identical to the shadow universe.
        const copyBuffer = (name) => {
            if (g[name] && sg[name] && g[name].length === sg[name].length) {
                g[name].set(sg[name]);
            }
        };
        
        copyBuffer('state');
        copyBuffer('chars');
        copyBuffer('colors');
        copyBuffer('baseColors');
        copyBuffer('alphas');
        copyBuffer('glows');
        copyBuffer('fontIndices');
        copyBuffer('renderMode');
        copyBuffer('types');
        copyBuffer('decays');
        copyBuffer('maxDecays');
        copyBuffer('ages');
        copyBuffer('brightness');
        copyBuffer('rotatorOffsets');
        copyBuffer('cellLocks');
        copyBuffer('nextChars');
        copyBuffer('nextOverlapChars');
        copyBuffer('secondaryChars');
        copyBuffer('secondaryColors');
        copyBuffer('secondaryAlphas');
        copyBuffer('secondaryGlows');
        copyBuffer('secondaryFontIndices');
        copyBuffer('mix');
        if (g.activeFlag && sg.activeFlag) copyBuffer('activeFlag');

        // Rebuild main active indices set from scratch
        g.activeIndices.clear();
        for (const idx of sg.activeIndices) {
            g.activeIndices.add(idx);
        }

        // Deep copy complex styles (glimmers, etc.)
        g.complexStyles.clear();
        for (const [key, value] of sg.complexStyles) {
            g.complexStyles.set(key, JSON.parse(JSON.stringify(value)));
        }
    }
}