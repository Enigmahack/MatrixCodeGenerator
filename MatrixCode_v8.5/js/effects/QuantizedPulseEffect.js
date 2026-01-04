class QuantizedPulseEffect extends AbstractEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedPulse";
        this.active = false;
        
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
        
        this.isExpanding = false; // Tracks if the pulse is actively growing
        this.isFinishing = false; // Legacy flag, replaced by isExpanding logic

        // Flash State
        this.flashIntensity = null; 
        this.activeFlashes = new Set();
    }

    _getEffectiveState() {
        const s = this.c.state;
        const fadeFrames = s.quantizedPulseFadeFrames !== undefined ? s.quantizedPulseFadeFrames : 15;
        const fadeInFrames = s.quantizedPulseFadeInFrames !== undefined ? s.quantizedPulseFadeInFrames : 5;
        // If fadeFrames is 0 (Off), fade is instant (speed 1.0)
        const lineSpeed = fadeFrames > 0 ? (1.0 / fadeFrames) : 1.0;

        return {
            enabled: s.quantizedPulseEnabled,
            freq: s.quantizedPulseFrequencySeconds,
            duration: s.quantizedPulseDurationSeconds || 2.0,
            initialSpeed: 10,   // Hard-coded as requested (was s.quantizedPulseSpeed || 10)
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            baseDelay: 1.0,     // Much faster start (was 8)
            acceleration: 1, // Very subtle acceleration (was 0.94)
            minDelay: 0.5,      // Keep top speed cap same
            blockSize: 4,
            lineFadeSpeed: lineSpeed,
            simultaneousSpawns: s.quantizedPulseSimultaneousSpawns !== undefined ? s.quantizedPulseSimultaneousSpawns : 3
        };
    }
    
    stop() {
        this.active = false;
        this.isFading = false;
        this.isFinishing = false;
        this.fadeAlpha = 1.0;
        this.swapped = false;
        this.swapTimer = 0;
        this.growthPhase = 0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        // Immediate cleanup
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
    
    beginFade() {
        const s = this._getEffectiveState();
        if (s.fadeFrames > 0) {
            this.isFading = true;
            this.fadeAlpha = 1.0;
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        } else {
            this.stop();
        }
    }

    resetExpansion() {
        this.isExpanding = false;
        this.swapped = false;
        this.swapTimer = 0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        // Clear Expansion State ONLY
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        if (this.map) this.map.fill(0);
        // Do NOT clear flashes or overrides here
    }

    trigger() {
        // If already expanding, reset the expansion part but keep flashes
        if (this.isExpanding) this.resetExpansion();
        
        this.active = true;
        this.isExpanding = true;
        this.isFading = false;
        this.isFinishing = false;
        this.fadeAlpha = 1.0;
        this.startTime = Date.now();
        this.growthPhase = 0; // 0: Start, 1: NSEW, 2: NS, 3: Full
        
        const s = this._getEffectiveState();
        this.fadeInAlpha = (s.fadeInFrames > 0) ? 0.0 : 1.0;

        // INIT SHADOW WORLD (Full Simulation)
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

        // Resize Flash Intensity (Preserve existing if size matches)
        const totalGrid = this.g.cols * this.g.rows;
        if (!this.flashIntensity || this.flashIntensity.length !== totalGrid) {
            this.flashIntensity = new Float32Array(totalGrid);
            this.activeFlashes.clear();
        }
        // Do NOT clear activeFlashes or flashIntensity here to allow persistence

        this.burstCounter = 0;

        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        this.catchTimer = 0;
        this.localFrame = 0;
        this.swapTimer = 0;
        this.swapped = false;
        
        const cx = Math.floor((this.g.cols / 2) / 4) * 4;
        const cy = Math.floor((this.g.rows / 2) / 4) * 4;
        
        this._addBlock(cx, cy);
        
        this.origin = {x: cx, y: cy};
        this.blocksAdded = 1; 
        
        this.phase3StartTime = 0;
        this.phase3StartBlocks = 0;
        this.cleanupCycle = 0;
        
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

    // ... (unchanged methods: _initShadowWorld, _updateShadowWorld, _finishExpansion, _addBlock, _isOccupied, _applyMask) ...
    _initShadowWorld() {
        // Create a Shadow Grid and Simulation to run the "New World"
        // This ensures settings match exactly and allows for a state swap later.
        
        // 1. Setup Shadow Grid
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        // Resize to match main grid dimensions
        const w = this.g.cols * d.cellWidth;
        const h = this.g.rows * d.cellHeight;
        this.shadowGrid.resize(w, h);
        
                // 2. Setup Shadow Simulation
        
                // We force main thread execution for simplicity of buffer access
        
                this.shadowSim = new SimulationSystem(this.shadowGrid, this.c);
        
                this.shadowSim.useWorker = false;
        
                if (this.shadowSim.worker) {
        
                    this.shadowSim.worker.terminate();
        
                    this.shadowSim.worker = null;
        
                }
        
        
        
                // 2b. PRE-WARMUP INJECTION (Immediate Population)
        
                // This guarantees density and eliminates the need for long warmup delays.
        
                const sm = this.shadowSim.streamManager;
        
                const s = this.c.state;
        
                
        
                // Ensure StreamManager has correct dimensions
        
                sm.resize(this.shadowGrid.cols);
        
        
        
                // Shuffled columns to guarantee distribution
        
                const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        
                for (let i = columns.length - 1; i > 0; i--) {
        
                    const j = Math.floor(Math.random() * (i + 1));
        
                    [columns[i], columns[j]] = [columns[j], columns[i]];
        
                }
        
                
        
                // Target 75% of columns to be populated initially
        
                const injectionCount = Math.floor(this.shadowGrid.cols * 0.75);
        
        
        
                for (let k = 0; k < injectionCount; k++) {
        
                    const col = columns[k];
        
                    
        
                    // Random Start Y (Full Height Distribution)
        
                    const startY = Math.floor(Math.random() * this.shadowGrid.rows);
        
                    
        
                                        // 70% chance for Eraser, 30% for Tracer
        
                    
        
                                        const isEraser = Math.random() < 0.7;
        
                    
        
                                        const stream = sm._initializeStream(col, isEraser, s);
        
                    stream.y = startY;
        
                    stream.age = startY; // Match age to position
        
                    
        
                    sm.addActiveStream(stream);
        
                }
        
                
        
                // 3. Warm Up (Faster)
        
                // 400 frames is enough to generate trails for injected streams
        
                this.shadowSim.timeScale = 1.0;
        
                const warmupFrames = 400;
        
        
        
                for (let i = 0; i < warmupFrames; i++) {
        
                    this.shadowSim.update(i);
        
                }
        
        
        
                // 4. Quick Density Check (Safety Only)
        
                let extraFrames = 0;
        
                const maxExtra = 200; 
        
                const totalCells = this.shadowGrid.cols * this.shadowGrid.rows;
        
                const targetActive = Math.floor(totalCells * 0.015);
        
                
        
                while (extraFrames < maxExtra) {
        
                     let activeCount = 0;
        
                     for(let k=0; k<totalCells; k+=10) {
        
                         if (this.shadowGrid.state[k] === 1) activeCount++;
        
                     }
        
                     if ((activeCount * 10) > targetActive) break;
        
                     this.shadowSim.update(warmupFrames + extraFrames);
        
                     extraFrames++;
        
                }
        
                
        
                        this.localFrame = warmupFrames + extraFrames;
        
                
        
                    }
        
                
        
                
        
                
        
                    _updateShadowWorld() {
        if (!this.shadowSim || !this.shadowGrid) return;
        
        // 1. Advance Shadow Simulation
        this.shadowSim.update(this.localFrame);
        
        // 2. Copy Shadow State to Main Grid's OVERRIDE Layer
        // This effectively projects the "New World" onto the "Old World"
        // where overrideActive is set (inside the pulse).
        const g = this.g;
        const sg = this.shadowGrid;
        
        g.overrideChars.set(sg.chars);
        g.overrideColors.set(sg.colors);
        g.overrideAlphas.set(sg.alphas);
        g.overrideGlows.set(sg.glows);
        g.overrideNextChars.set(sg.nextChars);
        
        // Note: We do NOT copy 'types', 'decays' etc to Override, 
        // because Override is purely visual. Logic state stays in shadowSim.
    }

    _finishExpansion() {
        // console.log("[QuantizedPulse] Finishing Expansion...");
        
        try {
            const g = this.g;
            const sg = this.shadowGrid;
            
            if (sg) {
                // ... (Buffer Commit logic same as before, simplified for brevity in thought, but full copy in code)
                // 1. Commit Buffer State
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
                
                // Copy Secondary Layer
                g.secondaryChars.set(sg.secondaryChars);
                g.secondaryColors.set(sg.secondaryColors);
                g.secondaryAlphas.set(sg.secondaryAlphas);
                g.secondaryGlows.set(sg.secondaryGlows);
                g.secondaryFontIndices.set(sg.secondaryFontIndices);
                
                // Copy Mix State
                g.mix.set(sg.mix);
                
                // 2. Commit Active Indices
                if (sg.activeIndices.size > 0) {
                    g.activeIndices.clear();
                    for (const idx of sg.activeIndices) {
                        g.activeIndices.add(idx);
                    }
                }
                
                // 3. Commit Complex Objects
                g.complexStyles.clear();
                for (const [key, value] of sg.complexStyles) {
                    g.complexStyles.set(key, {...value});
                }
                
                // 4. SWAP STREAM MANAGER STATE
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
            
            // 5. End Expansion Phase
            this.resetExpansion(); // Stops expanding, keeps active for flashes
            this.g.clearAllOverrides(); // Clear overrides (except what updateFlashes restores)
            this._updateFlashes(); // Re-apply flashes on the NEW grid state to prevent 1-frame snap
            this.shadowGrid = null;
            this.shadowSim = null;
            
        } catch (e) {
            console.error("[QuantizedPulse] Swap failed:", e);
            this.g.clearAllOverrides();
            this.stop();
        }
    }

    _addBlock(x, y, burstId = 0) {
        // Prevent duplicate adds
        if (this._isOccupied(x, y)) return;

        this.blocks.push({x, y});
        this.blocksAdded++;
        
        // Update Map: Set Occupied (Bit 0) and BurstID (Bits 2-15)
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        
        if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
            const idx = my * this.mapCols + mx;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            // REVEAL: Set Override Active (Show New World) - On-screen only
            if (x >= -4 && y >= -4 && x < this.g.cols && y < this.g.rows) {
                const centerX = this.g.cols / 2;
                const centerY = this.g.rows / 2;
                const maxDist = Math.sqrt(centerX*centerX + centerY*centerY);
                
                // Calculate Scale for this block (center of 4x4)
                const bx = x + 2;
                const by = y + 2;
                const dx = bx - centerX;
                const dy = by - centerY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                let scale = Math.max(0, 1.0 - (dist / maxDist));
                scale = Math.pow(scale, 1.5);
                
                const bs = 4;
                for(let by=0; by<bs; by++) {
                    for(let bx=0; bx<bs; bx++) {
                         const gx = x + bx;
                         const gy = y + by;
                         if (gx >= 0 && gy >= 0 && gx < this.g.cols && gy < this.g.rows) {
                             const cellIdx = gy * this.g.cols + gx;
                             // Enable CHAR override (Mode 3 = FULL, allows overrideMix)
                             this.g.overrideActive[cellIdx] = 3; 
                             // Sync Mix State (Glimmer/Rotator) for the Reveal
                             if (this.shadowGrid) {
                                 this.g.overrideMix[cellIdx] = this.shadowGrid.mix[cellIdx];
                             }
                             
                             // Initial Flash
                             this.flashIntensity[cellIdx] = 1.0 * scale;
                             this.activeFlashes.add(cellIdx);
                         }
                    }
                }
            }
        }

        // --- NEW: Active Spawn Logic ---
        // As the pulse expands, randomly spawn tracers in the revealed area.
        // This ensures the effect doesn't just reveal empty space.
        if (this.shadowSim && this.shadowSim.streamManager) {
            const sm = this.shadowSim.streamManager;
            // 30% chance to spawn a stream in this new block
            if (Math.random() < 0.3) {
                const spawnX = x + Math.floor(Math.random() * 4);
                const spawnY = y + Math.floor(Math.random() * 4);
                
                if (spawnX >= 0 && spawnX < this.shadowGrid.cols && 
                    spawnY >= 0 && spawnY < this.shadowGrid.rows) {
                    
                    // 70% chance for Eraser, 30% for Tracer
                    const isEraser = Math.random() < 0.7;
                    const stream = sm._initializeStream(spawnX, isEraser, this.c.state);
                    stream.y = spawnY;
                    stream.age = spawnY; 
                    
                    sm.addActiveStream(stream);
                }
            }
        }

        const bs = 4;
        const neighbors = [
            {x: x, y: y - bs, side: 0}, // Top
            {x: x + bs, y: y, side: 1}, // Right
            {x: x, y: y + bs, side: 2}, // Bottom
            {x: x - bs, y: y, side: 3}  // Left
        ];

        for (const pn of neighbors) {
            // Check if neighbor exists and is occupied
            if (this._isOccupied(pn.x, pn.y)) {
                
                // Determine if this is a "merged" neighbor (same burst) or "boundary" neighbor (old burst)
                let isSameBurst = false;
                const nmx = pn.x + this.mapPad;
                const nmy = pn.y + this.mapPad;
                
                if (nmx >= 0 && nmy >= 0 && nmx < this.mapCols && nmy < this.mapRows) {
                     const nbVal = this.map[nmy * this.mapCols + nmx];
                     const nbBurst = nbVal >> 2;
                     if (burstId > 0 && nbBurst === burstId) isSameBurst = true;
                }
                
                // If different bursts (or one is start/old), draw a boundary line
                if (!isSameBurst) {
                    let lx, ly, lw, lh;
                    if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }      // Top Edge
                    else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; } // Right Edge
                    else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; } // Bottom Edge
                    else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }      // Left Edge
                    
                    const s = this._getEffectiveState();
                    const persistence = s.fadeFrames > 0 ? (10 + Math.random() * 10) : 10;
                    
                    this.lines.push({
                        x: lx, y: ly, w: lw, h: lh, 
                        alpha: 1.0, 
                        persistence: persistence, 
                        isNew: true,
                        mergeDelay: 3 // Delay merging for 3 cycles for visual overlap
                    });
                }
            } else {
                // Neighbor is empty -> Add to frontier
                const nmx = pn.x + this.mapPad;
                const nmy = pn.y + this.mapPad;
                
                if (nmx >= 0 && nmy >= 0 && nmx < this.mapCols && nmy < this.mapRows) {
                    const pIdx = nmy * this.mapCols + nmx;
                    // If not occupied (Bit 0) and not already frontier (Bit 1)
                    if ((this.map[pIdx] & 3) === 0) {
                        this.frontier.push({x: pn.x, y: pn.y});
                        this.map[pIdx] |= 2; // Set Frontier Bit
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
        // Re-apply override flags for ALL active blocks
        // This is necessary because EffectRegistry clears overrides every frame.
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
                         // Sync Mix State (Glimmer/Rotator) for the Reveal
                         // This allows the New World to show advanced visual states
                         if (sg) {
                             g.overrideMix[idx] = sg.mix[idx];
                         }
                     }
                }
            }
        }
    }

    update() {
        if (!this.active) return;
        
        // 1. Expansion Logic (If active)
        if (this.isExpanding) {
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
                        this.phase3StartTime = Date.now();
                        this.phase3StartBlocks = this.blocksAdded;
                    }
                }
                else {
                    // Phase 3: Standard Expansion
                    if (!this.phase3StartTime) {
                         this.phase3StartTime = Date.now();
                         this.phase3StartBlocks = this.blocksAdded;
                    }

                    const p3Elapsed = Date.now() - this.phase3StartTime;
                    const timeSpentSoFar = this.phase3StartTime - this.startTime;
                    const remainingDuration = Math.max(1000, durationMs - timeSpentSoFar);
                    
                    const progress = Math.min(1.0, p3Elapsed / remainingDuration);
                    const totalVisibleBlocks = (this.g.cols * this.g.rows) / 16; 
                    const remainingBlocks = (totalVisibleBlocks * 1.5) - this.phase3StartBlocks;
                    
                    const exponent = Math.max(1.0, 3.0 - (10 / 10)); 
                    const targetBlocks = this.phase3StartBlocks + Math.floor(remainingBlocks * Math.pow(progress, exponent));
                    
                    let needed = targetBlocks - this.blocksAdded;
                    
                    // Dynamic Tendril Frequency: Slower duration = Slower tendrils
                    // Example: 2s -> every 4 frames. 10s -> every 20 frames.
                    const tendrilFreq = Math.max(2, Math.floor(s.duration * 2));
                    
                    if (needed > 0 && this.localFrame % tendrilFreq === 0) {
                        this._updateTendrils(s);
                    }
                    if (this.localFrame % 3 === 0) {
                        this.cleanupCycle++;
                        if (this.cleanupCycle % 2 === 0) {
                             this._performHoleCleanup();
                        }

                        if (needed > 0 || (this.blocksAdded < 10 && this.frontier.length > 0)) {
                             // Use configured simultaneous spawn rate
                             let burst = s.simultaneousSpawns;
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
                    // Use configurable fade for Green lines
                    // If setting is 0, fade is instant (speed = 1.0)
                    const duration = this.c.state.quantizedPulseGreenFadeSeconds !== undefined ? this.c.state.quantizedPulseGreenFadeSeconds : 0.5;
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

    _performHoleCleanup() {
        // CASCADING SMART HOLE FILL
        // 1. Scan frontier for "Holes" (>=3 occupied neighbors).
        // 2. Fill them.
        // 3. Add their neighbors to a queue to check if they BECAME holes.
        // This recursively fills pockets without expanding the convex hull.
        
        let limit = 20; // Budget per frame
        let filledCount = 0;
        
        // Queue for cascading checks: {x, y}
        const queue = [];
        
        // 1. Initial Scan of Frontier
        // We iterate backwards to allow safe removal if needed (though we don't remove here directly)
        for (let i = this.frontier.length - 1; i >= 0; i--) {
            if (filledCount >= limit) break;
            const f = this.frontier[i];
            
            if (this._countOccupiedNeighbors(f.x, f.y) >= 3) {
                 queue.push(f);
            }
        }
        
        // 2. Process Queue
        while(queue.length > 0 && filledCount < limit) {
            const cur = queue.shift();
            
            // Double check: Is it still empty? Is it still a hole?
            if (!this._isOccupied(cur.x, cur.y) && this._countOccupiedNeighbors(cur.x, cur.y) >= 3) {
                // FILL IT
                this._addBlock(cur.x, cur.y, this.burstCounter);
                this.blocksAdded++; // Tracking fix
                filledCount++;
                
                // Clear frontier bit for this filled block
                const mx = cur.x + this.mapPad;
                const my = cur.y + this.mapPad;
                if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
                    this.map[my * this.mapCols + mx] &= ~2; 
                }
                
                // Add neighbors to queue for checking
                const nbs = [
                    {x: cur.x, y: cur.y - 4},
                    {x: cur.x + 4, y: cur.y},
                    {x: cur.x, y: cur.y + 4},
                    {x: cur.x - 4, y: cur.y}
                ];
                
                for(const n of nbs) {
                    if (!this._isOccupied(n.x, n.y)) {
                         queue.push(n);
                    }
                }
            }
        }
    }

    _countOccupiedNeighbors(x, y) {
        let n = 0;
        if (this._isOccupied(x, y - 4)) n++;
        if (this._isOccupied(x + 4, y)) n++;
        if (this._isOccupied(x, y + 4)) n++;
        if (this._isOccupied(x - 4, y)) n++;
        return n;
    }

    _updateExpansionBurst(count) {
        // CYCLE START: Merge previous new lines (turn them green)
        const greenDuration = this.c.state.quantizedPulseGreenFadeSeconds !== undefined ? this.c.state.quantizedPulseGreenFadeSeconds : 0.5;
        
        // Use a loop that allows removal (iterate backwards or filter)
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const l = this.lines[i];
            if (l.isNew) {
                // Check Merge Delay
                if (l.mergeDelay > 0) {
                    l.mergeDelay--;
                    continue; // Skip merging this cycle
                }

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
        
        // --- PHASE 2: ASPECT RATIO DRIVEN CROSS EXPANSION ---
        let attempts = 0;
        const maxAttempts = burstCount * 8 + 50; 
        
        // Probability of Horizontal Expansion based on Aspect Ratio
        // Wider grid -> Higher chance of Horizontal
        const probH = this.g.cols / (this.g.cols + this.g.rows);

        while (processed < burstCount && this.frontier.length > 0 && attempts < maxAttempts) {
            attempts++;
            
            // 1. Determine Target Axis for this specific block add
            const wantHorizontal = Math.random() < probH;
            
            // 2. Tournament Selection with Axis Bias
            const K = 15; // Sample size
            let bestIdx = -1;
            let bestScore = -Infinity;

            for (let k = 0; k < K; k++) {
                const idx = Math.floor(Math.random() * this.frontier.length);
                const f = this.frontier[idx];
                
                // Validation (Check bounds & stale entries)
                const mx = f.x + this.mapPad;
                const my = f.y + this.mapPad;
                if (mx < 0 || my < 0 || mx >= this.mapCols || my >= this.mapRows || 
                   (this.map[my * this.mapCols + mx] & 1) !== 0 || (this.map[my * this.mapCols + mx] & 2) === 0) {
                     const last = this.frontier.pop();
                     if (idx < this.frontier.length) {
                         this.frontier[idx] = last;
                         if (bestIdx === this.frontier.length) bestIdx = idx;
                     }
                     k--; 
                     if (this.frontier.length === 0) break;
                     continue;
                }

                // Geometric Check: Is this block on an axis?
                // Allow a thickness of ~8 units (2 blocks) around the center lines
                const isH = Math.abs(f.y - this.origin.y) <= 8; 
                const isV = Math.abs(f.x - this.origin.x) <= 8;
                
                // Scoring
                let score = Math.random() * 10; // Base organic noise
                
                if (wantHorizontal) {
                    if (isH) score += 1000;      // Primary Goal
                    else if (isV) score += 500;  // Fallback to Cross Shape
                } else {
                    if (isV) score += 1000;      // Primary Goal
                    else if (isH) score += 500;  // Fallback to Cross Shape
                }
                
                // Tie-breaker: Prefer further out? No, random is better for filling width.
                
                if (score > bestScore) {
                    bestScore = score;
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
                    // GROUP ADDITION LOGIC
                    // Distribution:
                    // 20% 3x3 (Huge)
                    // 20% 2x3/3x2 (Large Rects)
                    // 20% 2x2 (Squares)
                    // 15% 1x3/3x1 (Long Strips)
                    // 20% 1x2/2x1 (Small Rects)
                    // 5%  Single (1x1) - Reduced significantly
                    
                    const rand = Math.random();
                    
                    // 20% chance for 3x3
                    if (rand < 0.20) {
                         const candidates = [
                            // 3x3 centered around winner (or offset)
                            // 8 neighbors
                            [{x:4,y:0}, {x:-4,y:0}, {x:0,y:4}, {x:0,y:-4}, {x:4,y:4}, {x:-4,y:-4}, {x:4,y:-4}, {x:-4,y:4}],
                            // 3x3 Top-Left corner is winner
                            [{x:4,y:0}, {x:8,y:0}, {x:0,y:4}, {x:4,y:4}, {x:8,y:4}, {x:0,y:8}, {x:4,y:8}, {x:8,y:8}],
                            // 3x3 Bottom-Right corner is winner
                            [{x:-4,y:0}, {x:-8,y:0}, {x:0,y:-4}, {x:-4,y:-4}, {x:-8,y:-4}, {x:0,y:-8}, {x:-4,y:-8}, {x:-8,y:-8}]
                         ];
                         const cluster = candidates[Math.floor(Math.random() * candidates.length)];
                         cluster.forEach(offset => {
                            const tx = winner.x + offset.x;
                            const ty = winner.y + offset.y;
                            if (!this._isOccupied(tx, ty)) {
                                this._addBlock(tx, ty, this.burstCounter);
                                this.blocksAdded++;
                                const tmx = tx + this.mapPad;
                                const tmy = ty + this.mapPad;
                                if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                            }
                         });
                    }
                    // 20% chance for 2x3 or 3x2 (Large Rectangles)
                    else if (rand < 0.40) {
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
                                this.blocksAdded++;
                                const tmx = tx + this.mapPad;
                                const tmy = ty + this.mapPad;
                                if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                            }
                         });
                    }
                    // 20% chance for 2x2 (Square)
                    else if (rand < 0.60) {
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
                                this.blocksAdded++;
                                const tmx = tx + this.mapPad;
                                const tmy = ty + this.mapPad;
                                if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                            }
                        });
                    }
                    // 15% chance for 1x3 or 3x1 (Long Strips)
                    else if (rand < 0.75) {
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
                                this.blocksAdded++;
                                const tmx = tx + this.mapPad;
                                const tmy = ty + this.mapPad;
                                if (tmx >= 0 && tmy >= 0 && tmx < this.mapCols && tmy < this.mapRows) this.map[tmy * this.mapCols + tmx] &= ~2;
                            }
                        });
                    }
                    // 20% chance for 1x2 or 2x1 (Small Rects)
                    else if (rand < 0.95) {
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
                            this.blocksAdded++;
                            const emx = extra.x + this.mapPad;
                            const emy = extra.y + this.mapPad;
                            if (emx >= 0 && emy >= 0 && emx < this.mapCols && emy < this.mapRows) this.map[emy * this.mapCols + emx] &= ~2;
                        }
                    }
                    // Remaining 5%: Single (winner only) - Do nothing extra

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
                // NOTE: If it's already Mode 3 (Pulse Reveal), we KEEP it Mode 3.
                // Mode 3 supports overrides just like Mode 1, but includes mix states.
                if (g.overrideActive[idx] !== 3) {
                     g.overrideActive[idx] = 1; 
                }

                // Apply Flash to Glow (Visual Brightness)
                // This adds brightness in the character's OWN color in the shader
                // Use configurable Border Illumination setting
                const illumination = this.c.state.quantizedPulseBorderIllumination !== undefined ? this.c.state.quantizedPulseBorderIllumination : 4.0;
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