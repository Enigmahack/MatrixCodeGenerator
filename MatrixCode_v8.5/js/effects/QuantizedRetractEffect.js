class QuantizedRetractEffect extends QuantizedSequenceEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedRetract";
        this.active = false;
        this.configPrefix = "quantizedRetract";
        this.sequence = [[]]; // Editor support
        
        // Simulation State
        this.blocks = [];      // {x, y}
        this.lines = [];       // {x, y, w, h, alpha, persistence}
        this.frontier = [];    // {x, y}
        
        // Bitmask Map: Bit 0 = Occupied, Bit 1 = Frontier, Bits 2-15 = BurstID
        this.map = null;       // Uint16Array
        this.mapCols = 0;
        this.burstCounter = 0;
        
        this.blocksAdded = 0;
        this.tendrils = [];    // [{x,y}, {x,y}...]
        
        // Timing
        this.nextExpandTime = 0;
        this.currentDelay = 0;
        this.blockSize = 4;
        this.timeoutId = null;
        
        // Fade State
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.fadeInAlpha = 0.0;
        
        this.isExpanding = false; 

        // Flash State
        this.flashIntensity = null; 
        this.activeFlashes = new Set();
    }

    getBlockSize() {
        return { w: 4, h: 4 };
    }

    _getEffectiveState() {
        const s = this.c.state;
        const fadeFrames = s.quantizedRetractFadeFrames !== undefined ? s.quantizedRetractFadeFrames : 15;
        const fadeInFrames = s.quantizedRetractFadeInFrames !== undefined ? s.quantizedRetractFadeInFrames : 5;
        // If fadeFrames is 0 (Off), fade is instant (speed 1.0)
        const lineSpeed = fadeFrames > 0 ? (1.0 / fadeFrames) : 1.0;

        return {
            enabled: s.quantizedRetractEnabled,
            freq: s.quantizedRetractFrequencySeconds,
            duration: s.quantizedRetractDurationSeconds || 2.0,
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            baseDelay: 1.0,     
            minDelay: 0.5,      
            blockSize: 4,
            lineFadeSpeed: lineSpeed 
        };
    }
    
    stop() {
        this.active = false;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        if (this.map) this.map.fill(0);
        this.activeFlashes.clear();
        if (this.flashIntensity) this.flashIntensity.fill(0);
        this.g.clearAllOverrides();
    }
    
    resetExpansion() {
        this.isExpanding = false;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        if (this.map) this.map.fill(0);
    }

    trigger(force = false) {
        // Interruption Logic: Force-commit and stop other Quantized effects
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedExpansion"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    if (typeof eff._swapStates === 'function') {
                        // Pulse/Add style
                        if (!eff.hasSwapped) eff._swapStates();
                        eff.active = false;
                        eff.state = 'IDLE';
                    } else if (typeof eff._finishExpansion === 'function') {
                        // Retract/Expansion style
                        eff._finishExpansion();
                    } else {
                        eff.active = false;
                    }
                }
            }
        }

        if (!super.trigger(force)) return false;

        if (this.isExpanding) this.resetExpansion();
        
        this.isExpanding = true;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.startTime = Date.now();
        
        const s = this._getEffectiveState();
        this.fadeInAlpha = (s.fadeInFrames > 0) ? 0.0 : 1.0;

        // INIT SHADOW WORLD
        this._initShadowWorld();

        this.timeoutId = setTimeout(() => {
            this._finishExpansion(); // Force finish
        }, 60000); 
        
        // Resize map
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
        
        // Editor Sequence State
        this.sequencePhase = 0;
        this.isSequencePlaying = (this.sequence && this.sequence.length > 0 && 
                                 (this.sequence.length > 1 || this.sequence[0].length > 0));

        if (this.isSequencePlaying) {
            this.isExpanding = false; 
        } else {
            this.isExpanding = true;
            // INITIALIZATION: Start from Edges (Default)
            this._initEdges();
        }
        
        this.currentDelay = s.baseDelay;
        this.nextExpandTime = this.currentDelay;
        
        // Initialize RNG Buffer for fast deterministic dashes
        this.rngBuffer = new Float32Array(1024);
        for(let i=0; i<1024; i++) this.rngBuffer[i] = Math.random();

        return true;
    }

    _dashedLine(path, x1, y1, x2, y2, seed, ch) {
        // Deterministic start index based on seed
        let rngIdx = Math.abs(Math.floor(seed)) % 1024;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len <= 0) return;
        
        const ux = dx / len;
        const uy = dy / len;
        
        let dist = 0;
        const minLen = 2.0; // Minimum 2px
        const maxLen = Math.max(minLen + 1, ch); 
        
        while (dist < len) {
            // Pick random dash length
            const r1 = this.rngBuffer[rngIdx];
            rngIdx = (rngIdx + 1) & 1023; // Wrap
            const dash = minLen + r1 * (maxLen - minLen);
            
            // Pick random gap length
            const r2 = this.rngBuffer[rngIdx];
            rngIdx = (rngIdx + 1) & 1023;
            const gap = minLen + r2 * (maxLen - minLen);
            
            // Draw Dash
            const dEnd = Math.min(dist + dash, len);
            if (dEnd > dist) {
                path.moveTo(x1 + ux * dist, y1 + uy * dist);
                path.lineTo(x1 + ux * dEnd, y1 + uy * dEnd);
            }
            
            dist += dash + gap;
        }
    }

    _initEdges() {
        const bs = 4;
        const cols = this.g.cols;
        const rows = this.g.rows;
        
        // Add blocks along the perimeter, aligned to 4x4 grid
        const startX = Math.floor((cols / 2) / 4) * 4;
        const startY = Math.floor((rows / 2) / 4) * 4;
        // Not center, but edges. We align to 4x4 relative to 0,0 usually.
        
        // Top & Bottom
        for (let x = -4; x < cols + 4; x += 4) {
            this._addBlock(x, -4); // Just off-screen top
            this._addBlock(x, rows); // Just off-screen bottom
        }
        
        // Left & Right (exclude corners already added)
        for (let y = 0; y < rows; y += 4) {
            this._addBlock(-4, y); // Left
            this._addBlock(cols, y); // Right
        }
        
        this.blocksAdded = this.blocks.length;
    }

    _initShadowWorld() {
        // Reuse same logic as Pulse
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        const w = this.g.cols * d.cellWidth;
        const h = this.g.rows * d.cellHeight;
        this.shadowGrid.resize(w, h);
        
        // Pass false to disable worker initialization for shadow sim
        this.shadowSim = new SimulationSystem(this.shadowGrid, this.c, false);
        this.shadowSim.useWorker = false;
        if (this.shadowSim.worker) {
            this.shadowSim.worker.terminate();
            this.shadowSim.worker = null;
        }
        
        this.shadowSim.timeScale = 1.0;
        const s = this.c.state;
        const avgSpeed = Math.max(1, 21 - (s.streamSpeed || 10)); 
        const framesNeeded = Math.ceil(this.g.rows * avgSpeed * 1.5);
        const warmupFrames = Math.max(400, Math.min(3000, framesNeeded));

        for (let i = 0; i < warmupFrames; i++) {
            this.shadowSim.update(i);
        }
        this.localFrame = warmupFrames;
    }

    _updateShadowWorld() {
        if (!this.shadowSim || !this.shadowGrid) return;
        this.localFrame++;
        this.shadowSim.update(this.localFrame);
        
        // Copy Overrides (Same as Pulse)
        const g = this.g;
        const sg = this.shadowGrid;
        
        g.overrideChars.set(sg.chars);
        g.overrideColors.set(sg.colors);
        g.overrideAlphas.set(sg.alphas);
        g.overrideGlows.set(sg.glows);
        g.overrideNextChars.set(sg.nextChars);
    }

    _finishExpansion() {
        try {
            const g = this.g;
            const sg = this.shadowGrid;
            
            if (sg) {
                // Commit Buffer State (Same as Pulse)
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
            
            this.resetExpansion(); 
            this.g.clearAllOverrides(); 
            this._updateFlashes(); 
            this.shadowGrid = null;
            this.shadowSim = null;
            
        } catch (e) {
            console.error("[QuantizedRetract] Swap failed:", e);
            this.g.clearAllOverrides();
            this.stop();
        }
    }

    _addBlock(x, y, burstId = 0) {
        if (this._isOccupied(x, y)) return;

        this.blocks.push({x, y});
        
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        
        if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
            const idx = my * this.mapCols + mx;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            // Retract Reveal Scale:
            // 1.0 at Edge, 0.0 at Center? 
            // Pulse was 1.0 at center, 0.0 at edge.
            // For Retract, we want intensity highest at the leading edge (inner edge).
            // But visually, maintaining standard intensity is fine.
            
            // On-Screen Check
            if (x >= -4 && y >= -4 && x < this.g.cols && y < this.g.rows) {
                // Calculate distance from center
                const centerX = this.g.cols / 2;
                const centerY = this.g.rows / 2;
                const maxDist = Math.sqrt(centerX*centerX + centerY*centerY);
                
                const bx = x + 2;
                const by = y + 2;
                const dx = bx - centerX;
                const dy = by - centerY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Scale increases as we get closer to center? Or stays high?
                // Let's keep it similar to Pulse: Brighter near origin?
                // Origin here is "Everywhere outside".
                // Let's just use dist/maxDist (1.0 at edge, 0.0 at center)
                let scale = (dist / maxDist);
                scale = Math.pow(scale, 0.5); // Bias towards 1.0
                
                const bs = 4;
                for(let by=0; by<bs; by++) {
                    for(let bx=0; bx<bs; bx++) {
                         const gx = x + bx;
                         const gy = y + by;
                         if (gx >= 0 && gy >= 0 && gx < this.g.cols && gy < this.g.rows) {
                             const cellIdx = gy * this.g.cols + gx;
                             this.g.overrideActive[cellIdx] = 3; 
                             if (this.shadowGrid) {
                                 this.g.overrideMix[cellIdx] = this.shadowGrid.mix[cellIdx];
                             }
                             this.flashIntensity[cellIdx] = 1.0 * scale;
                             this.activeFlashes.add(cellIdx);
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
                
                if (!isSameBurst) {
                    let lx, ly, lw, lh;
                    if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }     
                    else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; } 
                    else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; } 
                    else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }      
                    
                    const s = this._getEffectiveState();
                    const persistence = s.fadeFrames > 0 ? (10 + Math.random() * 10) : 10;
                    
                    this.lines.push({
                        x: lx, y: ly, w: lw, h: lh, 
                        alpha: 1.0, 
                        persistence: persistence, 
                        isNew: true 
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

    _applyMask() {
        const bs = 4;
        const g = this.g;
        const sg = this.shadowGrid;
        
        for (const b of this.blocks) {
            for(let by=0; by<bs; by++) {
                const gy = b.y + by;
                if (gy >= this.g.rows) continue;
                const rowOffset = gy * this.g.cols;
                for(let bx=0; bx<bs; bx++) {
                     const gx = b.x + bx;
                     if (gx < this.g.cols) {
                         const idx = rowOffset + gx;
                         g.overrideActive[idx] = 3; 
                         if (sg) {
                             g.overrideMix[idx] = sg.mix[idx];
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
                    this._rebuildFrontier();
                }
            }
        }
        // 1. Expansion Logic
        else if (this.isExpanding) {
            this.localFrame++;
            const s = this._getEffectiveState();
            
            this._updateShadowWorld();
            this._applyMask();
            this._updateBorderIllumination(); 
            
            if (this.fadeInAlpha < 1.0) {
                this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
                if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
            }
            
            const elapsed = Date.now() - this.startTime;
            const durationMs = s.duration * 1000; 
            
            if (elapsed > durationMs + 2000) {
                this._finishExpansion();
            }
            // Check if full (Frontier Empty AND Center Covered)
            // Or just check frame count?
            // Heuristic: If frontier is empty, we are done (screen filled)
            else if (this.localFrame % 10 === 0 && this.frontier.length === 0 && this.blocksAdded > 100) {
                this._finishExpansion();
            }
            
            if (this.isExpanding) {
                // Growth Logic - Inwards
                const progress = Math.min(1.0, elapsed / durationMs);
                
                // Target Blocks matches Expansion logic, but applied to filling the screen
                const totalBlocks = (this.g.cols * this.g.rows) / 16; 
                // We want to reach roughly totalBlocks by end of duration
                const targetBlocks = Math.floor(totalBlocks * Math.pow(progress, 1.5)); // Slower start, fast finish? 
                // Retract starts fast (large perimeter) and slows down (small center)?
                // Actually perimeter is large, so we add many blocks per burst.
                
                // Let's target a linear fill rate relative to area
                
                let needed = targetBlocks - this.blocksAdded;
                // Since we start with perimeter, blocksAdded is already non-zero.
                
                const tendrilFreq = Math.max(2, Math.floor(s.duration * 2));
                if (needed > 0 && this.localFrame % tendrilFreq === 0) {
                    this._updateTendrils(s);
                }

                if (needed > 0 || this.localFrame < 10) { // Always force start
                     const burstCap = 800; // Higher cap for large perimeter
                     let burst = Math.min(needed, burstCap);
                     if (burst < 5) burst = 5; 
                     this._updateExpansionBurst(burst);
                }
                
                this._updateLines(s);
            }
        }
        
        this._updateFlashes();

        if (!this.isExpanding && this.activeFlashes.size === 0) {
            this.stop(); 
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

    _updateBorderIllumination() {
        const centerX = this.g.cols / 2;
        const centerY = this.g.rows / 2;
        const maxDist = Math.sqrt(centerX*centerX + centerY*centerY);
        
        for (const l of this.lines) {
            if (!l.isNew) continue; 
            
            const dx = (l.x + (l.w > 0 ? l.w/2 : 0)) - centerX;
            const dy = (l.y + (l.h > 0 ? l.h/2 : 0)) - centerY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Retract: Brightest near center (End of effect)? 
            // Or Brightest at edge (Start of effect)?
            // Visual preference: Leading edge should be bright.
            // As it moves inwards, distance decreases.
            // So we want scale to be high regardless?
            // Let's use 1.0 constant for now, maybe pulsate?
            let scale = 1.0;

            let isHorizontal = (l.w > 0);
            
            if (isHorizontal) {
                const isTopOccupied = this._isOccupied(l.x, l.y - 4);
                const isBottomOccupied = this._isOccupied(l.x, l.y);
                if (isTopOccupied && !isBottomOccupied) this._illuminateSpan(l.x, l.y - 1, 4, 1, scale);
                else if (isBottomOccupied && !isTopOccupied) this._illuminateSpan(l.x, l.y, 4, 1, scale);
            } else {
                const isLeftOccupied = this._isOccupied(l.x - 4, l.y);
                const isRightOccupied = this._isOccupied(l.x, l.y);
                if (isLeftOccupied && !isRightOccupied) this._illuminateSpan(l.x - 1, l.y, 1, 4, scale);
                else if (isRightOccupied && !isLeftOccupied) this._illuminateSpan(l.x, l.y, 1, 4, scale);
            }
        }
    }
    
    _illuminateSpan(x, y, w, h, scale = 1.0) {
        if (!this.shadowGrid) return;
        for(let py = y; py < y + h; py++) {
            if (py < 0 || py >= this.g.rows) continue;
            for(let px = x; px < x + w; px++) {
                if (px < 0 || px >= this.g.cols) continue;
                const idx = py * this.g.cols + px;
                if (this.shadowGrid.chars[idx] !== 0) {
                     this.flashIntensity[idx] = 1.0 * scale; 
                     this.activeFlashes.add(idx);
                }
            }
        }
    }

    _updateLines(s) {
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].persistence > 0) {
                this.lines[i].persistence--;
            } else {
                let speed;
                if (this.lines[i].isNew) {
                    speed = s.lineFadeSpeed; 
                } else {
                    const duration = 0.5;
                    speed = (duration <= 0.01) ? 1.0 : (1.0 / (duration * 60));
                }
                
                this.lines[i].alpha -= speed;
                if (this.lines[i].alpha <= 0) this.lines.splice(i, 1);
            }
        }
    }

    _updateExpansionBurst(count) {
        // Merge Lines
        const duration = 0.5;
        
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const l = this.lines[i];
            if (l.isNew) {
                if (duration <= 0.01) {
                    this.lines.splice(i, 1);
                } else {
                    l.isNew = false;
                    l.persistence = 0; 
                    l.alpha = 1.0;
                }
            }
        }

        let burstCount = count;
        this.burstCounter = (this.burstCounter + 1) & 0x3FFF; 
        if (this.burstCounter === 0) this.burstCounter = 1;

        let processed = 0;
        let attempts = 0;
        const maxAttempts = burstCount * 8 + 50; 
        
        // Retract Logic: Grow Inwards from Frontier
        // The frontier is the inner edge of the ring.
        // We want to pick blocks that move CLOSER to center.

        const cx = this.g.cols / 2;
        const cy = this.g.rows / 2;

        while (processed < burstCount && this.frontier.length > 0 && attempts < maxAttempts) {
            attempts++;
            
            const K = 5; 
            let bestIdx = -1;
            let bestDist = 999999; 

            // Scan K random frontier points, pick one closest to center
            // (Since we want to fill INWARDS)
            for (let k = 0; k < K; k++) {
                const idx = Math.floor(Math.random() * this.frontier.length);
                const f = this.frontier[idx];
                
                const mx = f.x + this.mapPad;
                const my = f.y + this.mapPad;
                
                // Validate
                if (mx < 0 || my < 0 || mx >= this.mapCols || my >= this.mapRows ||
                    (this.map[my * this.mapCols + mx] & 1) !== 0) { // Occupied
                     // Cleanup invalid
                     const last = this.frontier.pop();
                     if (idx < this.frontier.length) {
                         this.frontier[idx] = last;
                         // Fix pointer if we moved the best candidate
                         if (bestIdx === this.frontier.length) {
                             bestIdx = idx;
                         }
                     }
                     k--; 
                     if (this.frontier.length === 0) break;
                     continue;
                }

                const dx = f.x - cx;
                const dy = f.y - cy;
                const dist = dx*dx + dy*dy;
                
                // We want smallest distance (closest to center)
                // Add noise to prevent perfect circle
                const score = dist + (Math.random() * 500);
                
                if (score < bestDist) {
                    bestDist = score;
                    bestIdx = idx;
                }
            }
            
            if (bestIdx === -1) continue;
            
            const winner = this.frontier[bestIdx];
            
            // Mark non-frontier
            const wmx = winner.x + this.mapPad;
            const wmy = winner.y + this.mapPad;
            this.map[wmy * this.mapCols + wmx] &= ~2; 
            
            const last = this.frontier.pop();
            if (bestIdx < this.frontier.length) this.frontier[bestIdx] = last;
            
            if (!this._isOccupied(winner.x, winner.y)) {
                this._addBlock(winner.x, winner.y, this.burstCounter);
                processed++;
                
                // Optional: Cluster fills (2x2, etc) to make it blocky
                // Cluster logic from Expansion but keep it simple for now
                if (Math.random() < 0.5) {
                    // Try to add a neighbor closer to center
                    const dx = winner.x - cx;
                    const dy = winner.y - cy;
                    let tx = winner.x, ty = winner.y;
                    
                    if (Math.abs(dx) > Math.abs(dy)) {
                        tx += (dx > 0 ? -4 : 4); // Move towards X center
                    } else {
                        ty += (dy > 0 ? -4 : 4); // Move towards Y center
                    }
                    
                    if (!this._isOccupied(tx, ty)) {
                        this._addBlock(tx, ty, this.burstCounter);
                        processed++;
                    }
                }
            }
        }
    }

    _updateFlashes() {
        if (this.activeFlashes.size === 0) return;
        const g = this.g;
        const decay = 1.0 / 30.0; 
        const toRemove = [];
        
        for (const idx of this.activeFlashes) {
            let intensity = this.flashIntensity[idx];
            if (intensity <= 0) {
                toRemove.push(idx);
                continue;
            }
            intensity -= decay;
            this.flashIntensity[idx] = intensity;
            
            if (intensity > 0) {
                if (g.overrideActive[idx] !== 3) {
                     g.overrideActive[idx] = 1; 
                }
                const illumination = this.c.state.quantizedRetractBorderIllumination !== undefined ? this.c.state.quantizedRetractBorderIllumination : 4.0;
                g.overrideGlows[idx] += illumination * intensity;
                
                const col = g.overrideColors[idx];
                const r = col & 0xFF;
                const gVal = (col >> 8) & 0xFF;
                const b = (col >> 16) & 0xFF;
                const a = (col >> 24) & 0xFF;
                
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
        const colorStr = '#FFFF6E'; // Gold
        
        const masterAlpha = this.fadeAlpha * this.fadeInAlpha;
        
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, cw * 0.15); 
        
        ctx.strokeStyle = colorStr;
        ctx.shadowBlur = 25; 
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
        
        ctx.strokeStyle = derived.streamColorStr; 
        ctx.setLineDash([cw * 0.25, cw * 0.25, cw * 0.5, cw * 0.25]);
        
        for (const l of this.lines) {
            let lineAlpha = l.alpha * masterAlpha;
            if (l.isNew) {
                ctx.strokeStyle = colorStr; 
                ctx.shadowBlur = 25;
                ctx.shadowColor = colorStr; 
                if (Math.random() < 0.4) {
                    lineAlpha *= (0.1 + Math.random() * 0.5);
                }
            } else {
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