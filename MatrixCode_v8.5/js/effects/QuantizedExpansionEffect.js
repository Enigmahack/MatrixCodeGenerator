class QuantizedExpansionEffect extends QuantizedSequenceEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedExpansion";
        this.active = false;
        this.configPrefix = "quantizedExpansion";
        this.sequence = [[]]; // Editor support
        
        // Simulation State
        this.blocks = [];      // {x, y}
        this.lines = [];       // {x, y, w, h, alpha, persistence}
        this.frontier = [];    // {x, y}
        
        // Bitmask Map: Bit 0 = Occupied, Bit 1 = Frontier, Bits 2-15 = BurstID
        this.map = null;       // Uint16Array
        this.mapCols = 0;
        this.burstCounter = 0;
        
        this.origin = null;    // {x, y} center of plus
        this.blocksAdded = 0;
        this.tendrils = [];    // [{x,y}, {x,y}...]
        
        // Catch/Stall State
        this.catchTimer = 0;   
        
        // Timing
        this.nextExpandTime = 0;
        this.currentDelay = 0;
        this.blockSize = 4;
        this.timeoutId = null;
        
        // Fade State
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.fadeInAlpha = 0.0;
        
        this.isExpanding = false; // Tracks if the effect is actively growing
        this.isFinishing = false; 

        // Flash State
        this.flashIntensity = null; 
        this.activeFlashes = new Set();
        
        // Manual Step State (Debug)
        this.manualStep = false;
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    getBlockSize() {
        return { w: 4, h: 4 };
    }
    
    _onKeyDown(e) {
        if (e.key === '.' || e.code === 'Period') {
            this.manualStep = true;
        }
    }

    trigger(force = false) {
        if (!super.trigger(force)) return false;

        document.addEventListener('keydown', this._onKeyDown);
        
        // Editor Sequence State
        this.sequencePhase = 0;
        this.isSequencePlaying = (this.sequence && this.sequence.length > 0 && 
                                 (this.sequence.length > 1 || this.sequence[0].length > 0));

        if (this.isSequencePlaying) {
            this.isExpanding = false; 
        } else {
            this.isExpanding = true;
            this.growthPhase = 0; 
        }
        
        this.isFading = false;
        this.isFinishing = false;
        this.fadeAlpha = 1.0;
        this.startTime = Date.now();
        
        const s = this._getEffectiveState();
        this.fadeInAlpha = (s.fadeInFrames > 0) ? 0.0 : 1.0;

        this._initShadowWorld();
        
        this.mapPad = 60; 
        this.mapCols = this.g.cols + this.mapPad * 2;
        this.mapRows = this.g.rows + this.mapPad * 2;
        const total = this.mapCols * this.mapRows;
        if (!this.map || this.map.length !== total) {
            this.map = new Uint16Array(total);
        } else {
            this.map.fill(0);
        }
        
        const totalGrid = this.g.cols * this.g.rows;
        if (!this.flashIntensity || this.flashIntensity.length !== totalGrid) {
            this.flashIntensity = new Float32Array(totalGrid);
            this.activeFlashes.clear();
        }
        
        this.burstCounter = 0;
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        this.localFrame = 0;
        
        const cx = Math.floor((this.g.cols / 2) / 4) * 4;
        const cy = Math.floor((this.g.rows / 2) / 4) * 4;
        this.origin = {x: cx, y: cy};

        if (!this.isSequencePlaying) {
             this._addBlock(cx, cy);
             this._addBlock(cx-4, cy);
             this._addBlock(cx, cy-4);
             this._addBlock(cx-4, cy-4);
             this.blocksAdded = 4;
        }
        
        this.nextExpandTime = 0;
        
        this.rngBuffer = new Float32Array(1024);
        for(let i=0; i<1024; i++) this.rngBuffer[i] = Math.random();

        return true;
    }

    _getEffectiveState() {
        const s = this.c.state;
        const fadeFrames = s.quantizedExpansionFadeFrames !== undefined ? s.quantizedExpansionFadeFrames : 15;
        const fadeInFrames = s.quantizedExpansionFadeInFrames !== undefined ? s.quantizedExpansionFadeInFrames : 5;
        const lineSpeed = fadeFrames > 0 ? (1.0 / fadeFrames) : 1.0;

        return {
            enabled: s.quantizedExpansionEnabled, 
            freq: s.quantizedExpansionFrequencySeconds,
            duration: s.quantizedExpansionDurationSeconds || 2.0,
            initialSpeed: 10,   
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            baseDelay: 1.0,     
            acceleration: 1, 
            minDelay: 0.5,      
            blockSize: 4,
            lineFadeSpeed: lineSpeed 
        };
    }
    
    resetExpansion() {
        this.isExpanding = false;
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        if (this.map) this.map.fill(0);
    }

    _initShadowWorld() {
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        const w = this.g.cols * d.cellWidth;
        const h = this.g.rows * d.cellHeight;
        this.shadowGrid.resize(w, h);
        
        this.shadowSim = new SimulationSystem(this.shadowGrid, this.c);
        this.shadowSim.useWorker = false;

        if (this.shadowSim.worker) {
            this.shadowSim.worker.terminate();
            this.shadowSim.worker = null;
        }
        
        // Pre-warm / Populate
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        sm.resize(this.shadowGrid.cols);

        // Shuffled columns to guarantee distribution
        const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }

        const injectionCount = Math.floor(this.shadowGrid.cols * 0.75);

        for (let k = 0; k < injectionCount; k++) {
            const col = columns[k];
            const startY = Math.floor(Math.random() * this.shadowGrid.rows);
            const isEraser = Math.random() < 0.2;
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            stream.age = startY; 
            sm.addActiveStream(stream);
        }
    
        this.shadowSim.timeScale = 1.0;
        const warmupFrames = 400;
        for (let i = 0; i < warmupFrames; i++) {
            this.shadowSim.update(i);
        }
        this.localFrame = warmupFrames;
    }

    _finishExpansion() {
        try {
            const g = this.g;
            const sg = this.shadowGrid;
            
            if (sg) {
                // Commit Buffer State
                g.state.set(sg.state); 
                g.chars.set(sg.chars);
                g.colors.set(sg.colors);
                g.baseColors.set(sg.baseColors); 
                g.alphas.set(sg.alphas);
                g.glows.set(sg.glows);
                g.fontIndices.set(sg.fontIndices);
                g.renderMode.set(sg.renderMode); 
                
                g.types.set(sg.types);
                g.decays.set(sg.decays);
                g.ages.set(sg.ages);
                g.brightness.set(sg.brightness);
                g.rotatorOffsets.set(sg.rotatorOffsets);
                g.cellLocks.set(sg.cellLocks);
                
                g.nextChars.set(sg.nextChars);
                g.nextOverlapChars.set(sg.nextOverlapChars);
                
                g.secondaryChars.set(sg.secondaryChars);
                g.secondaryColors.set(sg.secondaryColors);
                g.secondaryAlphas.set(sg.secondaryAlphas);
                g.secondaryGlows.set(sg.secondaryGlows);
                g.secondaryFontIndices.set(sg.secondaryFontIndices);
                
                g.mix.set(sg.mix);
                
                if (sg.activeIndices.size > 0) {
                    g.activeIndices.clear();
                    for (const idx of sg.activeIndices) {
                        g.activeIndices.add(idx);
                    }
                }
                
                g.complexStyles.clear();
                for (const [key, value] of sg.complexStyles) {
                    g.complexStyles.set(key, {...value});
                }
                
                // Swap Stream Manager
                if (window.matrix && window.matrix.simulation) {
                    const mainSim = window.matrix.simulation;
                    const shadowMgr = this.shadowSim.streamManager;
                    
                    const streamMap = new Map();
                    const serializedStreams = shadowMgr.activeStreams.map(s => {
                        const copy = {...s};
                        if (copy.holes instanceof Set) copy.holes = Array.from(copy.holes);
                        streamMap.set(s, copy);
                        return copy;
                    });
                    const serializeRefArray = (arr) => arr.map(s => (s && streamMap.has(s)) ? streamMap.get(s) : null);
                    
                    const state = {
                        activeStreams: serializedStreams, 
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
                    state.nextSpawnFrame = frameOffset + (state.nextSpawnFrame - this.localFrame);

                    if (mainSim.useWorker && mainSim.worker) {
                        mainSim.worker.postMessage({ type: 'replace_state', state: state });
                        mainSim.worker.postMessage({ type: 'config', config: { state: JSON.parse(JSON.stringify(this.c.state)), derived: this.c.derived } });
                    } else {
                        state.activeStreams.forEach(s => { if (Array.isArray(s.holes)) s.holes = new Set(s.holes); });
                        const mainMgr = mainSim.streamManager;
                        mainMgr.activeStreams = state.activeStreams;
                        mainMgr.columnSpeeds.set(state.columnSpeeds);
                        mainMgr.streamsPerColumn.set(state.streamsPerColumn);
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
                    }
                }
            }
            
            // End Expansion
            if (this.isExpanding) this.resetExpansion();
            this.isSequencePlaying = false; 
            this.g.clearAllOverrides(); 
            this._updateFlashes(); 
            this.shadowGrid = null;
            this.shadowSim = null;
            
        } catch (e) {
            console.error("[QuantizedExpansion] Swap failed:", e);
            this.g.clearAllOverrides();
            this.active = false;
        }
    }

    _addBlock(x, y, burstId = 0, merge = false) {
        if (this._isOccupied(x, y)) return;

        this.blocks.push({x, y});
        
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        
        if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
            const idx = my * this.mapCols + mx;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            if (x >= -4 && y >= -4 && x < this.g.cols && y < this.g.rows) {
                 const bs = 4;
                 for(let by=0; by<bs; by++) {
                    for(let bx=0; bx<bs; bx++) {
                         const gx = x + bx;
                         const gy = y + by;
                         if (gx >= 0 && gy >= 0 && gx < this.g.cols && gy < this.g.rows) {
                             const ci = gy * this.g.cols + gx;
                             this.flashIntensity[ci] = 1.0;
                             this.activeFlashes.add(ci);
                         }
                    }
                 }
            }
        }

        const bs = 4;
        const neighbors = [
            {x: x, y: y - bs, side: 0}, 
            {x: x + bs, y: y, side: 1}, 
            {x: x, y: y + bs, side: 2}, 
            {x: x - bs, y: y, side: 3}  
        ];

        for (const pn of neighbors) {
            if (this._isOccupied(pn.x, pn.y)) {
                let isSameBurst = false;
                const nmx = pn.x + this.mapPad;
                const nmy = pn.y + this.mapPad;
                
                if (nmx >= 0 && nmy >= 0 && nmx < this.mapCols && nmy < this.mapRows) {
                     const nbVal = this.map[nmy * this.mapCols + nmx];
                     const nbBurst = nbVal >> 2;
                     if (burstId > 0 && nbBurst === burstId) isSameBurst = true;
                }
                
                if (merge) isSameBurst = true;
                
                if (!isSameBurst) {
                    let lx, ly, lw, lh;
                    if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }      
                    else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; } 
                    else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; } 
                    else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }      
                    
                    this.lines.push({
                        x: lx, y: ly, w: lw, h: lh, 
                        alpha: 1.0, 
                        persistence: 0, 
                        isNew: false 
                    });
                }
            } else {
                const nmx = pn.x + this.mapPad;
                const nmy = pn.y + this.mapPad;
                
                if (nmx >= 0 && nmy >= 0 && nmx < this.mapCols && nmy < this.mapRows) {
                    const pIdx = nmy * this.mapCols + nmx;
                    if ((this.map[pIdx] & 3) === 0) {
                        this.frontier.push({x: pn.x, y: pn.y});
                        this.map[pIdx] |= 2; 
                    }
                }
            }
        }
    }

    _isOccupied(x, y) {
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        if (mx < 0 || my < 0 || mx >= this.mapCols || my >= this.mapRows) return false;
        return (this.map[my * this.mapCols + mx] & 1) !== 0;
    }

    _isValidBoundary(x, y) {
        return x >= 0 && x < this.g.cols && y >= 0 && y < this.g.rows;
    }

    _updateShadowWorld() {
        // FREEZE: Do not update simulation. We want a "Screenshot".
        // Just maintain localFrame count for reference if needed
        this.localFrame++;
    }

    _applyMask() {
        const bs = 4;
        const g = this.g;
        const sg = this.shadowGrid;
        const s = this._getEffectiveState();
        
        if (!sg) return;

        // Calculate Expansion Progress (0.0 to 1.0)
        // Based on time or size? Size is safer.
        // Max Radius approx: sqrt(cols^2 + rows^2) / 2
        const cx = this.g.cols / 2;
        const cy = this.g.rows / 2;
        const maxDist = Math.sqrt(cx*cx + cy*cy);
        
        // Estimate current radius based on furthest block?
        // Or simpler: Progress = Time / Duration
        const elapsed = Date.now() - this.startTime;
        const durationMs = s.duration * 1000;
        // Clamp to 0.01 to prevent divide by zero, up to 1.0
        let progress = Math.max(0.01, Math.min(1.0, elapsed / durationMs));
        
        // Nonlinear expansion visual (starts fast, slows down? or starts slow?)
        // Expansion moves linearly.
        // Let's use progress directly for mapping.
        
        for (const b of this.blocks) {
            for(let by=0; by<bs; by++) {
                const gy = b.y + by;
                if (gy >= this.g.rows) continue;
                const rowOffset = gy * this.g.cols;
                
                for(let bx=0; bx<bs; bx++) {
                     const gx = b.x + bx;
                     if (gx < this.g.cols) {
                         const idx = rowOffset + gx;
                         
                         // STRETCH MAPPING
                         // Map Screen(gx, gy) -> Shadow(sx, sy)
                         // sx = cx + (gx - cx) / progress
                         
                         const sx = Math.floor(cx + (gx - cx) / progress);
                         const sy = Math.floor(cy + (gy - cy) / progress);
                         
                         if (sx >= 0 && sx < this.g.cols && sy >= 0 && sy < this.g.rows) {
                             const sIdx = sy * this.g.cols + sx;
                             
                             // Apply from Shadow Grid
                             g.overrideActive[idx] = 3; // Full Override
                             g.overrideChars[idx] = sg.chars[sIdx];
                             g.overrideColors[idx] = sg.colors[sIdx];
                             g.overrideAlphas[idx] = sg.alphas[sIdx];
                             g.overrideGlows[idx] = sg.glows[sIdx];
                             g.overrideMix[idx] = sg.mix[sIdx];
                             g.overrideNextChars[idx] = sg.nextChars[sIdx];
                         } else {
                             // Out of bounds (Zoomed in view looking past edge)
                             // Black / Empty
                             g.overrideActive[idx] = 2; // Solid
                             g.overrideColors[idx] = 0; // Black
                             g.overrideAlphas[idx] = 1.0;
                         }
                     }
                }
            }
        }
    }


    _executeSequenceStep(step) {
        if (!step) return;
        for (const op of step) {
            if (op.op === 'add' || op.op === 'addSmart') {
                this._addBlock(op.args[0], op.args[1], this.burstCounter);
            } else if (op.op === 'addRect') {
                const [x1, y1, x2, y2] = op.args;
                const minX = Math.min(x1, x2);
                const maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                for(let y=minY; y<=maxY; y++) {
                    for(let x=minX; x<=maxX; x++) {
                        this._addBlock(x, y, this.burstCounter);
                    }
                }
            } else if (op.op === 'removeBlock' || op.op === 'rem') {
                 const [x, y] = op.args;
                 const idx = this.blocks.findIndex(b => b.x === x && b.y === y);
                 if (idx !== -1) {
                     this.blocks.splice(idx, 1);
                     const mx = x + this.mapPad;
                     const my = y + this.mapPad;
                     if (mx >= 0 && mx < this.mapCols && my >= 0 && my < this.mapRows) {
                         this.map[my * this.mapCols + mx] &= ~1;
                     }
                 }
            }
        }
    }

    _rebuildFrontier() {
        this.frontier = [];
        const seen = new Set();
        const step = Math.max(1, Math.ceil(this.blocks.length / 200)); 
        for(let i=0; i<this.blocks.length; i+=step) {
            const b = this.blocks[i];
            const neighbors = [
                {x: b.x, y: b.y - 4}, {x: b.x + 4, y: b.y},
                {x: b.x, y: b.y + 4}, {x: b.x - 4, y: b.y}
            ];
            for (const n of neighbors) {
                if (!this._isOccupied(n.x, n.y)) {
                    const k = `${n.x},${n.y}`;
                    if (!seen.has(k)) {
                        this.frontier.push(n);
                        seen.add(k);
                    }
                }
            }
        }
    }

    update() {
        if (!this.active) return;

        if (this.debugMode) {
            super.update();
            return;
        }
        
        // 0. Sequence Playback
        if (this.isSequencePlaying) {
            this.localFrame++;
            const s = this._getEffectiveState();
            
            this._updateShadowWorld();
            this._applyMask();
            this._updateBorderIllumination(); 
            
            if (this.fadeInAlpha < 1.0) {
                this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
                if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
            }
            
            this._updateLines(s);
            this._updateFlashes();

            const freq = Math.max(1, Math.floor(s.duration * 2)); 
            if (this.localFrame % freq === 0) {
                if (this.sequencePhase < this.sequence.length) {
                    const step = this.sequence[this.sequencePhase];
                    this._executeSequenceStep(step);
                    this.sequencePhase++;
                } else {
                    this.isSequencePlaying = false;
                    this.isExpanding = true;
                    this.growthPhase = 1; 
                    this.nextExpandTime = this.localFrame + 10;
                    this._rebuildFrontier();
                }
            }
        }
        // 1. Expansion Logic (If active)
        else if (this.isExpanding) {
            this.localFrame++;
            const s = this._getEffectiveState();
            
            // Run Shadow Sim & Update Overrides
            this._updateShadowWorld();
            this._applyMask();
            this._updateBorderIllumination(); // CONTINUOUS BORDER ILLUMINATION
            
            // Handle Fade In
            if (this.fadeInAlpha < 1.0) {
                this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
                if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
            }
            
            // Time-Based Expansion Control
            const elapsed = Date.now() - this.startTime;
            const durationMs = s.duration * 1000; 
            
            // 1. Hard Time Limit (Duration + 1s buffer)
            if (elapsed > durationMs + 1000) {
                this._finishExpansion();
                // Continue to update flashes even after finish
            }
            // 2. Off-Screen Check (Optimization)
            else if (this.localFrame % 10 === 0 && this.frontier.length > 0) {
                let allOffScreen = true;
                const b = 4;
                const minX = -b, maxX = this.g.cols + b;
                const minY = -b, maxY = this.g.rows + b;
                
                for (const f of this.frontier) {
                    if (f.x >= minX && f.x < maxX && f.y >= minY && f.y < maxY) {
                        allOffScreen = false;
                        break;
                    }
                }
                
                if (allOffScreen) {
                    this._finishExpansion();
                    // Continue to update flashes
                }
            }
            
            if (this.isExpanding) {
                // --- SEQUENCED GROWTH LOGIC ---
                if (this.growthPhase === 0) {
                    // Initial Center Quad (Done in trigger)
                    this.growthPhase = 1;
                    this.nextExpandTime = this.localFrame + 10;
                }
                else if (this.growthPhase === 1) {
                    // Phase 1: N, S, E, W
                    if (this.localFrame >= this.nextExpandTime) {
                        const offsets = [{x:0, y:-4}, {x:0, y:4}, {x:-4, y:0}, {x:4, y:0}];
                        for (const o of offsets) {
                            this._addBlock(this.origin.x + o.x, this.origin.y + o.y, this.burstCounter);
                        }
                        this.growthPhase = 2;
                        this.nextExpandTime = this.localFrame + 10;
                    }
                }
                else if (this.growthPhase === 2) {
                    // Phase 2: N, S (Extended)
                    if (this.localFrame >= this.nextExpandTime) {
                        const offsets = [{x:0, y:-8}, {x:0, y:8}];
                        for (const o of offsets) {
                            this._addBlock(this.origin.x + o.x, this.origin.y + o.y, this.burstCounter);
                        }
                        this.growthPhase = 3;
                    }
                }
                else {
                    // Phase 3: Standard Expansion
                    const progress = Math.min(1.0, elapsed / durationMs);
                    const totalVisibleBlocks = (this.g.cols * this.g.rows) / 16; 
                    const exponent = Math.max(1.0, 3.0 - (10 / 10)); 
                    const targetBlocks = Math.floor((totalVisibleBlocks * 1.5) * Math.pow(progress, exponent));
                    
                    let needed = targetBlocks - this.blocksAdded;
                    
                    // Dynamic Tendril Frequency: Slower duration = Slower tendrils
                    // Example: 2s -> every 4 frames. 10s -> every 20 frames.
                    const tendrilFreq = Math.max(2, Math.floor(s.duration * 2));
                    
                    if (needed > 0 && this.localFrame % tendrilFreq === 0) {
                        this._updateTendrils(s);
                    }
                    if (this.localFrame % 3 === 0) {
                        if (needed > 0 || (this.blocksAdded < 10 && this.frontier.length > 0)) {
                             const burstCap = 600;
                             let burst = Math.min(needed, burstCap);
                             if (burst < 1) burst = 1;
                             this._updateExpansionBurst(burst);
                        }
                    }
                }
                
                this._updateLines(s);
            }
        }
        
        // 2. Process Flashes (ALWAYS run this, regardless of expansion state)
        // This ensures flashes decay properly after the swap/finish
        this._updateFlashes();

        // 3. Check for Full Completion
        // Stop ONLY if not expanding AND no active flashes
        if (!this.isExpanding && this.activeFlashes.size === 0) {
            this.stop(); 
        }
    }
    
    _updateBorderIllumination() {
        const bs = 4;
        const centerX = this.g.cols / 2;
        const centerY = this.g.rows / 2;
        // Max distance is corner to center
        const maxDist = Math.sqrt(centerX*centerX + centerY*centerY);
        
        // Iterate only over lines (The visual border)
        for (const l of this.lines) {
            if (!l.isNew) continue; // Skip old/green lines
            
            // Calculate scale based on distance from center
            // 1.0 at center, 0.0 at edge
            const dx = (l.x + (l.w > 0 ? l.w/2 : 0)) - centerX;
            const dy = (l.y + (l.h > 0 ? l.h/2 : 0)) - centerY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Smooth falloff: (1 - dist/max)^1.5
            let scale = Math.max(0, 1.0 - (dist / maxDist));
            scale = Math.pow(scale, 1.5); // Quadratic-ish falloff

            let isHorizontal = (l.w > 0);
            
            if (isHorizontal) {
                const isTopOccupied = this._isOccupied(l.x, l.y - 4);
                const isBottomOccupied = this._isOccupied(l.x, l.y);
                
                if (isTopOccupied && !isBottomOccupied) {
                    this._illuminateSpan(l.x, l.y - 1, 4, 1, scale);
                }
                else if (isBottomOccupied && !isTopOccupied) {
                    this._illuminateSpan(l.x, l.y, 4, 1, scale);
                }
            } else {
                const isLeftOccupied = this._isOccupied(l.x - 4, l.y);
                const isRightOccupied = this._isOccupied(l.x, l.y);
                
                if (isLeftOccupied && !isRightOccupied) {
                    this._illuminateSpan(l.x - 1, l.y, 1, 4, scale);
                }
                else if (isRightOccupied && !isLeftOccupied) {
                    this._illuminateSpan(l.x, l.y, 1, 4, scale);
                }
            }
        }
    }
    
    _illuminateSpan(x, y, w, h, scale = 1.0) {
        // Illuminate a strip of pixels (w x h)
        // Check if they are valid AND contain a character in the New World (ShadowGrid)
        // If so, boost flash.
        
        if (!this.shadowGrid) return;
        
        for(let py = y; py < y + h; py++) {
            if (py < 0 || py >= this.g.rows) continue;
            for(let px = x; px < x + w; px++) {
                if (px < 0 || px >= this.g.cols) continue;
                
                const idx = py * this.g.cols + px;
                
                // Check if Shadow Grid has a character here (New World Stream)
                if (this.shadowGrid.chars[idx] !== 0) {
                     // Found a stream char!
                     // Sustain the flash
                     this.flashIntensity[idx] = 1.0 * scale; 
                     this.activeFlashes.add(idx);
                }
            }
        }
    }

    _updateTendrils(s) {
        // Limit attempts per frame
        const attempts = 6; 
        const maxSearch = 3; // Search up to 4 spots
        const maxBlind = 3;  
        
        for (let i = 0; i < attempts; i++) {
            if (this.frontier.length === 0) break;
            
            // Pick random frontier block
            const idx = Math.floor(Math.random() * this.frontier.length);
            const f = this.frontier[idx];
            
            // Pick ONE random direction to extend (Orthogonal/Edge only)
            const dirs = [{x:0, y:-4}, {x:4, y:0}, {x:0, y:4}, {x:-4, y:0}];
            const d = dirs[Math.floor(Math.random() * dirs.length)];
            
            // 1. Scan Phase (Look Ahead)
            let limit = 0;
            let foundTarget = false;
            
            for (let k = 0; k < maxSearch; k++) {
                const tx = f.x + (d.x * k);
                const ty = f.y + (d.y * k);
                
                // If blocked by existing pulse block, stop scanning
                if (this._isOccupied(tx, ty)) break;
                
                limit++;
                
                // Check for Code (Target)
                if (this._hasCode(tx, ty)) {
                    foundTarget = true;
                    break; // Lock on!
                }
            }
            
            // 2. Constraint Phase
            // If we didn't lock onto code, constrain the extension
            if (!foundTarget) {
                limit = Math.min(limit, maxBlind);
            }
            
            // 3. Build Phase
            // If limit > 0, we can extend
            if (limit > 0) {
                for (let k = 0; k < limit; k++) {
                    const tx = f.x + (d.x * k);
                    const ty = f.y + (d.y * k);
                    this._addBlock(tx, ty, this.burstCounter);
                }
            }
        }
    }

    _hasCode(x, y) {
        // Check center of the 4x4 block
        const gx = x + 2;
        const gy = y + 2;
        if (gx < 0 || gy < 0 || gx >= this.g.cols || gy >= this.g.rows) return false;
        
        const idx = this.g.getIndex(gx, gy);
        return (this.g.state && this.g.state[idx] === 1);
    }
    
    // _hardenTendril removed


    _updateLines(s) {
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].persistence > 0) {
                this.lines[i].persistence--;
            } else {
                let speed;
                if (this.lines[i].isNew) {
                    speed = s.lineFadeSpeed; // Use standard fade for yellow lines
                } else {
                    // Use fixed fade for Green lines
                    const duration = 0.5;
                    speed = (duration <= 0.01) ? 1.0 : (1.0 / (duration * 60));
                }
                
                this.lines[i].alpha -= speed;
                if (this.lines[i].alpha <= 0) this.lines.splice(i, 1);
            }
        }
    }

    _updateStart(s) {
        const neighbors = [
            {x: this.origin.x, y: this.origin.y - 4},
            {x: this.origin.x + 4, y: this.origin.y},
            {x: this.origin.x, y: this.origin.y + 4},
            {x: this.origin.x - 4, y: this.origin.y}
        ];
        
        const next = neighbors.find(n => !this._isOccupied(n.x, n.y));
        if (next) {
            this._addBlock(next.x, next.y);
            this.blocksAdded++;
            const fIdx = this.frontier.findIndex(f => f.x === next.x && f.y === next.y);
            if (fIdx !== -1) {
                const f = this.frontier[fIdx];
                const mx = f.x + this.mapPad;
                const my = f.y + this.mapPad;
                if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
                    this.map[my * this.mapCols + mx] &= ~2;
                }
                const l = this.frontier.pop();
                if (fIdx < this.frontier.length) {
                    this.frontier[fIdx] = l;
                }
            }
        }
    }

    _updateExpansionBurst(count) {
        // CYCLE START: Merge previous new lines (turn them green)
        const greenDuration = this.c.state.quantizedExpansionGreenFadeSeconds !== undefined ? this.c.state.quantizedExpansionGreenFadeSeconds : 0.5;
        
        // Use a loop that allows removal (iterate backwards or filter)
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const l = this.lines[i];
            if (l.isNew) {
                if (greenDuration <= 0.01) {
                    // Immediate removal if fade is 0
                    this.lines.splice(i, 1);
                } else {
                    l.isNew = false;
                    // Start fading immediately (persistence = 0)
                    // The duration is controlled solely by the alpha decay rate
                    l.persistence = 0; 
                    l.alpha = 1.0;
                }
            }
        }

        let burstCount = count;
        
        // Increment Burst Counter (1..16383)
        this.burstCounter = (this.burstCounter + 1) & 0x3FFF; 
        if (this.burstCounter === 0) this.burstCounter = 1;

        let processed = 0;
        
        // --- PHASE 1: PRIORITY FILL (Holes / 1x1 Quads) ---
        // Scan frontier for any nodes with >= 3 neighbors. Fill them immediately.
        
        for (let i = this.frontier.length - 1; i >= 0; i--) {
            if (processed >= burstCount) break;
            
            const f = this.frontier[i];
            
            // Validation
            const mx = f.x + this.mapPad;
            const my = f.y + this.mapPad;
            if (mx < 0 || my < 0 || mx >= this.mapCols || my >= this.mapRows) {
                const last = this.frontier.pop();
                if (i < this.frontier.length) this.frontier[i] = last;
                continue;
            }
            
            const val = this.map[my * this.mapCols + mx];
            if ((val & 1) !== 0 || (val & 2) === 0) {
                 const last = this.frontier.pop();
                 if (i < this.frontier.length) this.frontier[i] = last;
                 continue;
            }
            
            // Check Neighbors
            let neighbors = 0;
            if (this._isOccupied(f.x, f.y - 4)) neighbors++;
            if (this._isOccupied(f.x + 4, f.y)) neighbors++;
            if (this._isOccupied(f.x, f.y + 4)) neighbors++;
            if (this._isOccupied(f.x - 4, f.y)) neighbors++;
            
            // If it's a hole (>=3 neighbors), fill it!
            if (neighbors >= 3) {
                const wmx = f.x + this.mapPad;
                const wmy = f.y + this.mapPad;
                this.map[wmy * this.mapCols + wmx] &= ~2; 
                
                const last = this.frontier.pop();
                if (i < this.frontier.length) this.frontier[i] = last;
                
                if (!this._isOccupied(f.x, f.y)) {
                    this._addBlock(f.x, f.y, this.burstCounter);
                    processed++;
                }
            }
        }
        // --- PHASE 2: WEIGHTED EXPANSION ---
        let attempts = 0;
        const maxAttempts = burstCount * 8 + 50; 

        while (processed < burstCount && this.frontier.length > 0 && attempts < maxAttempts) {
            attempts++;
            
            // Standard expansion (K=10 is sufficient as holes are handled)
            const K = 10; 
            let bestIdx = -1;
            let bestWeight = -1;

            for (let k = 0; k < K; k++) {
                const idx = Math.floor(Math.random() * this.frontier.length);
                const f = this.frontier[idx];
                
                // Validation
                const mx = f.x + this.mapPad;
                const my = f.y + this.mapPad;

                if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
                     const val = this.map[my * this.mapCols + mx];
                     if ((val & 1) !== 0 || (val & 2) === 0) {
                         const last = this.frontier.pop();
                         if (idx < this.frontier.length) {
                             this.frontier[idx] = last;
                             if (bestIdx === this.frontier.length) bestIdx = idx;
                         }
                         k--; 
                         if (this.frontier.length === 0) break;
                         continue;
                     }
                } else {
                    const last = this.frontier.pop();
                     if (idx < this.frontier.length) {
                         this.frontier[idx] = last;
                         if (bestIdx === this.frontier.length) bestIdx = idx;
                     }
                    k--;
                    if (this.frontier.length === 0) break;
                    continue;
                }

                // Calculate Weight (Distance based + Axis Bias)
                // Normalize to Aspect Ratio so we reach edges roughly same time
                const ratio = this.g.cols / Math.max(1, this.g.rows);
                
                const dx = Math.abs(f.x - this.origin.x);
                const dy = Math.abs(f.y - this.origin.y);
                const scaledDy = dy * ratio;
                
                // Elliptical Distance
                const dist = Math.sqrt(dx*dx + scaledDy*scaledDy);
                
                let w = 1.0; 
                w += Math.max(0, 100 - dist);
                
                // Axis Bias: Normalized (0..1) so it doesn't grow with distance
                // Prevents "runaway" edges where being far out makes you MORE attractive.
                // Multiplier 15.0 gives a constant preference for axes vs diagonal.
                const axisBias = Math.abs(dx - scaledDy) / (dist + 1.0);
                w += axisBias * 15.0; 
                
                w += Math.random() * 5.0; 
                
                if (w > bestWeight) {
                    bestWeight = w;
                    bestIdx = idx;
                }
            }

            if (this.frontier.length === 0) break;
            if (bestIdx === -1) continue; 

            const winner = this.frontier[bestIdx];
            
            // Remove winner from frontier (Bit 1 clear + array removal)
            const wmx = winner.x + this.mapPad;
            const wmy = winner.y + this.mapPad;
            if (wmx >= 0 && wmy >= 0 && wmx < this.mapCols && wmy < this.mapRows) {
                this.map[wmy * this.mapCols + wmx] &= ~2; // Clear Frontier Bit
            }
            
            const last = this.frontier.pop();
            if (bestIdx < this.frontier.length) {
                this.frontier[bestIdx] = last;
            }
            
            if (!this._isOccupied(winner.x, winner.y)) {
                this._addBlock(winner.x, winner.y, this.burstCounter);
                processed++;
                
                // Only do Group Additions if we aren't filling a hole
                // If neighbors >= 3, we likely just plugged a gap, so stop.
                let winnerNeighbors = 0;
                if (this._isOccupied(winner.x, winner.y - 4)) winnerNeighbors++;
                if (this._isOccupied(winner.x + 4, winner.y)) winnerNeighbors++;
                if (this._isOccupied(winner.x, winner.y + 4)) winnerNeighbors++;
                if (this._isOccupied(winner.x - 4, winner.y)) winnerNeighbors++;
                
                if (winnerNeighbors < 3) {
                    // GROUP ADDITION LOGIC (Weighted for ~66% Groups, ~33% Singles)
                const rand = Math.random();
                
                // 15% chance for 2x3 or 3x2 (Large Rectangles)
                if (rand < 0.15) {
                     const candidates = [
                        // 2x3 (Vertical)
                        [{x:4,y:0}, {x:0,y:4}, {x:4,y:4}, {x:0,y:8}, {x:4,y:8}],
                        [{x:-4,y:0}, {x:0,y:4}, {x:-4,y:4}, {x:0,y:8}, {x:-4,y:8}],
                        // 3x2 (Horizontal)
                        [{x:4,y:0}, {x:8,y:0}, {x:0,y:4}, {x:4,y:4}, {x:8,y:4}],
                        [{x:4,y:0}, {x:8,y:0}, {x:0,y:-4}, {x:4,y:-4}, {x:8,y:-4}]
                     ];
                     const cluster = candidates[Math.floor(Math.random() * candidates.length)];
                     cluster.forEach(offset => {
                        const tx = winner.x + offset.x;
                        const ty = winner.y + offset.y;
                        if (!this._isOccupied(tx, ty)) {
                            this._addBlock(tx, ty, this.burstCounter);
                            const tmx = tx + this.mapPad;
                            const tmy = ty + this.mapPad;
                            if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                        }
                     });
                }
                // 15% chance for 2x2 (Square)
                else if (rand < 0.30) {
                    const candidates = [
                        [{x:4,y:0}, {x:0,y:4}, {x:4,y:4}],    
                        [{x:-4,y:0}, {x:0,y:4}, {x:-4,y:4}],  
                        [{x:4,y:0}, {x:0,y:-4}, {x:4,y:-4}],  
                        [{x:-4,y:0}, {x:0,y:-4}, {x:-4,y:-4}] 
                    ];
                    const cluster = candidates[Math.floor(Math.random() * candidates.length)];
                    cluster.forEach(offset => {
                        const tx = winner.x + offset.x;
                        const ty = winner.y + offset.y;
                        if (!this._isOccupied(tx, ty)) {
                            this._addBlock(tx, ty, this.burstCounter);
                            const tmx = tx + this.mapPad;
                            const tmy = ty + this.mapPad;
                            if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                        }
                    });
                }
                // 15% chance for 1x3 or 3x1 (Long Strips)
                else if (rand < 0.45) {
                    const candidates = [
                        // 3x1 (Horizontal)
                        [{x:4,y:0}, {x:8,y:0}],      // Right
                        [{x:-4,y:0}, {x:-8,y:0}],    // Left
                        [{x:-4,y:0}, {x:4,y:0}],     // Center
                        // 1x3 (Vertical)
                        [{x:0,y:4}, {x:0,y:8}],      // Down
                        [{x:0,y:-4}, {x:0,y:-8}],    // Up
                        [{x:0,y:-4}, {x:0,y:4}]      // Center
                    ];
                    const cluster = candidates[Math.floor(Math.random() * candidates.length)];
                    cluster.forEach(offset => {
                        const tx = winner.x + offset.x;
                        const ty = winner.y + offset.y;
                        if (!this._isOccupied(tx, ty)) {
                            this._addBlock(tx, ty, this.burstCounter);
                            const tmx = tx + this.mapPad;
                            const tmy = ty + this.mapPad;
                            if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                        }
                    });
                }
                // 35% chance for 1x2 or 2x1 (Small Rects)
                else if (rand < 0.90) {
                    const type = Math.random() < 0.5 ? 'h' : 'v';
                    let extra = null;
                    if (type === 'h') {
                        if (!this._isOccupied(winner.x + 4, winner.y)) extra = {x: winner.x + 4, y: winner.y};
                        else if (!this._isOccupied(winner.x - 4, winner.y)) extra = {x: winner.x - 4, y: winner.y};
                    } 
                    if (!extra) { 
                        if (!this._isOccupied(winner.x, winner.y + 4)) extra = {x: winner.x, y: winner.y + 4};
                        else if (!this._isOccupied(winner.x, winner.y - 4)) extra = {x: winner.x, y: winner.y - 4};
                    }
                    if (extra) {
                        this._addBlock(extra.x, extra.y, this.burstCounter);
                        const emx = extra.x + this.mapPad;
                        const emy = extra.y + this.mapPad;
                        if (emx >= 0 && emy >= 0 && emx < this.mapCols && emy < this.mapRows) this.map[emy * this.mapCols + emx] &= ~2;
                    }
                }
                // Remaining 10%: Single (winner only) - Do nothing extra

            }
        }
    }
    }

    applyToGrid(grid) {
        // No grid overrides
    }

    _updateFlashes() {
        if (this.activeFlashes.size === 0) return;
        
        const g = this.g;
        const decay = 1.0 / 30.0; // Fade over ~0.5 seconds (double speed)
        const toRemove = [];
        
        for (const idx of this.activeFlashes) {
            let intensity = this.flashIntensity[idx];
            if (intensity <= 0) {
                toRemove.push(idx);
                continue;
            }
            
            // Decrease Intensity
            intensity -= decay;
            this.flashIntensity[idx] = intensity;
            
            if (intensity > 0) {
                // Enable Override for this cell (CHAR mode)
                // This allows the Main Sim's 'mix' (Glimmer/Rotator) to show through 
                // while we override the Color/Glow for the flash.
                // NOTE: If it's already Mode 3 (Expansion Reveal), we KEEP it Mode 3.
                // Mode 3 supports overrides just like Mode 1, but includes mix states.
                if (g.overrideActive[idx] !== 3) {
                     g.overrideActive[idx] = 1; 
                }

                // Apply Flash to Glow (Visual Brightness)
                // This adds brightness in the character's OWN color in the shader
                // Use configurable Border Illumination setting
                const illumination = this.c.state.quantizedExpansionBorderIllumination !== undefined ? this.c.state.quantizedExpansionBorderIllumination : 4.0;
                g.overrideGlows[idx] += illumination * intensity;
                
                // Also boost the base color saturation towards its max intensity
                const col = g.overrideColors[idx];
                const r = col & 0xFF;
                const gVal = (col >> 8) & 0xFF;
                const b = (col >> 16) & 0xFF;
                const a = (col >> 24) & 0xFF;
                
                // Scale up towards 255 without shifting hue to white
                const maxVal = Math.max(r, gVal, b, 1);
                const targetScale = 255 / maxVal;
                const scale = 1.0 + (targetScale - 1.0) * intensity;
                
                const rNew = Math.min(255, Math.floor(r * scale));
                const gNew = Math.min(255, Math.floor(gVal * scale));
                const bNew = Math.min(255, Math.floor(b * scale));
                
                g.overrideColors[idx] = (a << 24) | (bNew << 16) | (gNew << 8) | rNew;
            } else {
                toRemove.push(idx);
            }
        }
        
        for (const idx of toRemove) {
            this.activeFlashes.delete(idx);
            this.flashIntensity[idx] = 0;
        }
    }

    render(ctx, derived) {
        if (this.debugMode) {
            super.renderDebug(ctx, derived);
            return;
        }

        if (!this.active || !this.isExpanding) return;
        const s = this.c.state;
        const cw = derived.cellWidth * s.stretchX;
        const ch = derived.cellHeight * s.stretchY;
        const colorStr = '#FFFF6E';
        
        const masterAlpha = this.fadeAlpha * this.fadeInAlpha;
        
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, cw * 0.15); 
        
        ctx.strokeStyle = colorStr;
        ctx.shadowBlur = 25; // Increased illumination
        ctx.shadowColor = colorStr;
        ctx.globalAlpha = masterAlpha;
        
        const hPath = new Path2D();
        const vPath = new Path2D();

        for (const b of this.blocks) {
            const nTop = this._isOccupied(b.x, b.y - 4);
            const nRight = this._isOccupied(b.x + 4, b.y);
            const nBottom = this._isOccupied(b.x, b.y + 4);
            const nLeft = this._isOccupied(b.x - 4, b.y);
            
            const bx = b.x * cw;
            const by = b.y * ch;
            const bw = 4 * cw;
            const bh = 4 * ch;
            
            // Seed based on block coordinate
            const seed = b.x * 13 + b.y * 29;

            if (!nTop) { this._dashedLine(hPath, bx, by, bx + bw, by, seed, ch); }
            if (!nRight) { this._dashedLine(vPath, bx + bw, by, bx + bw, by + bh, seed + 1, ch); }
            if (!nBottom) { this._dashedLine(hPath, bx, by + bh, bx + bw, by + bh, seed + 2, ch); }
            if (!nLeft) { this._dashedLine(vPath, bx, by, bx, by + bh, seed + 3, ch); }
        }
        
        ctx.stroke(hPath);
        ctx.stroke(vPath);

        // Render Tendrils
        if (this.tendrils.length > 0) {
            ctx.globalAlpha = 0.5 * masterAlpha;
            ctx.setLineDash([cw * 0.2, cw * 0.2]); 
            ctx.beginPath();
            for (const t of this.tendrils) {
                for (const b of t.path) {
                    const bx = b.x * cw;
                    const by = b.y * ch;
                    const bw = 4 * cw;
                    const bh = 4 * ch;
                    ctx.rect(bx, by, bw, bh);
                }
            }
            ctx.stroke();
            ctx.globalAlpha = masterAlpha;
        }

        ctx.shadowBlur = 0; 
        
        // Internal Lines (Merge Lines) - Use Code Color (Green)
        ctx.strokeStyle = derived.streamColorStr; // Matrix Green for internal structure
        ctx.setLineDash([cw * 0.25, cw * 0.25, cw * 0.5, cw * 0.25]);
        
        for (const l of this.lines) {
            let lineAlpha = l.alpha * masterAlpha;
            
                        // Two-Cycle Logic: New lines are Yellow (Perimeter), Old are Green (Code)
                        if (l.isNew) {
                            ctx.strokeStyle = colorStr; 
                            ctx.shadowBlur = 25;
                            ctx.shadowColor = colorStr; // Match Shadow to Gold
                            
                            // Flicker Logic: 40% chance to dim (More frequent)                // Range: 0.1 to 0.6 (More noticeable dimming)
                if (Math.random() < 0.4) {
                    lineAlpha *= (0.1 + Math.random() * 0.5);
                }
            } else {
                // Use Primary Stream Color for solidified lines
                const col = derived.streamColorStr;
                ctx.strokeStyle = col; 
                ctx.shadowColor = col; 
            }
            
            ctx.globalAlpha = lineAlpha;
            ctx.beginPath();
            
            const lx = l.x * cw;
            const ly = l.y * ch;
            const lPxW = l.w * cw;
            const lPxH = l.h * ch;
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + lPxW, ly + lPxH);
            ctx.stroke();
        }
        
        ctx.setLineDash([]); 
        ctx.globalAlpha = 1.0; 
        ctx.shadowBlur = 0;
    }
}