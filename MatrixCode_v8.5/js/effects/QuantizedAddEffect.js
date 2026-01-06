class QuantizedAddEffect extends AbstractEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedAdd";
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
        this.tendrilHistory = []; // {x, y, axis, length, widthLevel}
        
        // Cardinal Direction Tracking
        this.cardinalStatus = {
            reachedN: false, reachedS: false,
            reachedE: false, reachedW: false,
            allReached: false
        };

        // Catch/Stall State
        this.catchTimer = 0;   
        
        // Timing
        this.nextExpandTime = 0;
        this.currentDelay = 0;
        this.blockSize = 2;
        this.timeoutId = null;
        
        // Fade State
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.fadeInAlpha = 0.0;
        
        this.isExpanding = false; // Tracks if the effect is actively growing
        this.isFinishing = false; // Legacy flag, replaced by isExpanding logic

        // Flash State
        this.flashIntensity = null; 
        this.activeFlashes = new Set();
        
        // Cycle State
        this.cycleState = {
            lastPhase: null, // 'V', 'H', 'T' (Thicken)
            repeatCount: 0
        };
        
        // Manual Step State (Debug)
        this.manualStep = false;
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    _getEffectiveState() {
        const s = this.c.state;
        const fadeFrames = s.quantizedAddFadeFrames !== undefined ? s.quantizedAddFadeFrames : 15;
        const fadeInFrames = s.quantizedAddFadeInFrames !== undefined ? s.quantizedAddFadeInFrames : 5;
        // If fadeFrames is 0 (Off), fade is instant (speed 1.0)
        const lineSpeed = fadeFrames > 0 ? (1.0 / fadeFrames) : 1.0;
        
        // Linear Expansion Timing
        const duration = s.quantizedAddDurationSeconds || 2.0;
        // 2x Speed: Map 2.0s -> ~2 frames, 10.0s -> ~10 frames
        const cycleInterval = Math.max(1, Math.floor(duration * 1));

        return {
            enabled: s.quantizedAddEnabled,
            freq: s.quantizedAddFrequencySeconds,
            duration: duration,
            initialSpeed: 2,   // Hard-coded
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            cycleInterval: cycleInterval, // Unified cycle timer
            blockSize: 2,
            lineFadeSpeed: lineSpeed 
        };
    }
    
    stop() {
        document.removeEventListener('keydown', this._onKeyDown);
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
        document.removeEventListener('keydown', this._onKeyDown);
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
        document.addEventListener('keydown', this._onKeyDown);
        this.manualStep = false;
        
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
        this.frame = 0;
        this.swapTimer = 0;
        this.swapped = false;
        this.phase15Offset = 12; // Start for Fractal Expansion Phase
        this.phase15LoopCounter = 0; // Counter for Phase 15 Animation Loop
        
        const cx = (Math.floor((this.g.cols / 2) / 2) * 2) + 6; // Shifted right by 3 blocks
        const cy = Math.floor((this.g.rows / 2) / 2) * 2;
        
        // Phase 0: Initial 4x6 Block (Centered)
        const b = 2; // Block size
        for(let by = -3; by < 3; by++) {
            for(let bx = -2; bx < 2; bx++) {
                this._addBlock(cx + bx * b, cy + by * b);
            }
        }
        
        this.origin = {x: cx, y: cy};
        this.blocksAdded = 4 * 6; 
        
        this.nextExpandTime = s.cycleInterval;
        
        // Initialize RNG Buffer for fast deterministic dashes
        this.rngBuffer = new Float32Array(1024);
        for(let i=0; i<1024; i++) this.rngBuffer[i] = Math.random();

        return true;
    }
    
    _onKeyDown(e) {
        if (e.key === '.' || e.code === 'Period') {
            this.manualStep = true;
        }
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

            // 20% chance for Eraser, 80% for Tracer
            const isEraser = Math.random() < 0.2;
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
        // console.log("[QuantizedAdd] Finishing Expansion...");
        
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
            console.error("[QuantizedAdd] Swap failed:", e);
            this.g.clearAllOverrides();
            this.stop();
        }
    }

    _addBlock(x, y, burstId = 0, merge = false) {
        // Prevent duplicate adds
        if (this._isOccupied(x, y)) return;

        this.blocks.push({x, y});

        // Update Cardinal Progress
        if (!this.cardinalStatus.allReached) {
            if (y <= 0) this.cardinalStatus.reachedN = true;
            if (y >= this.g.rows - 2) this.cardinalStatus.reachedS = true;
            if (x <= 0) this.cardinalStatus.reachedW = true;
            if (x >= this.g.cols - 2) this.cardinalStatus.reachedE = true;
            
            if (this.cardinalStatus.reachedN && this.cardinalStatus.reachedS && 
                this.cardinalStatus.reachedW && this.cardinalStatus.reachedE) {
                this.cardinalStatus.allReached = true;
            }
        }
        
        // Update Map: Set Occupied (Bit 0) and BurstID (Bits 2-15)
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        
        if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
            const idx = my * this.mapCols + mx;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            // REVEAL: Set Override Active (Show New World) - On-screen only
            if (x >= -2 && y >= -2 && x < this.g.cols && y < this.g.rows) {
                const centerX = this.g.cols / 2;
                const centerY = this.g.rows / 2;
                const maxDist = Math.sqrt(centerX*centerX + centerY*centerY);
                
                // Calculate Scale for this block (center of 2x2)
                const bx = x + 1;
                const by = y + 1;
                const dx = bx - centerX;
                const dy = by - centerY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                let scale = Math.max(0, 1.0 - (dist / maxDist));
                scale = Math.pow(scale, 1.5);
                
                const bs = 2;
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

        // As the pulse expands, randomly spawn tracers in the revealed area.
        if (this.shadowSim && this.shadowSim.streamManager) {
            const sm = this.shadowSim.streamManager;
            if (Math.random() < 0.2) {
                const spawnX = x + Math.floor(Math.random() * 2);
                const spawnY = y + Math.floor(Math.random() * 2);
                if (spawnX >= 0 && spawnX < this.shadowGrid.cols && 
                    spawnY >= 0 && spawnY < this.shadowGrid.rows) {
                    const isEraser = Math.random() < 0.7;
                    const stream = sm._initializeStream(spawnX, isEraser, this.c.state);
                    stream.y = spawnY;
                    stream.age = spawnY; 
                    sm.addActiveStream(stream);
                }
            }
        }

        const bs = 2;
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
                
                // If merge is requested, FORCE isSameBurst to true to prevent lines
                if (merge) isSameBurst = true;
                
                // If different bursts (or one is start/old), draw a boundary line
                if (!isSameBurst) {
                    let lx, ly, lw, lh;
                    if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }      // Top Edge
                    else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; } // Right Edge
                    else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; } // Bottom Edge
                    else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }      // Left Edge
                    
                    const s = this._getEffectiveState();
                    // Treat these internal boundary lines immediately as "Old" (Green/Trails).
                    this.lines.push({
                        x: lx, y: ly, w: lw, h: lh, 
                        alpha: 1.0, 
                        persistence: 0, 
                        isNew: false 
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

    _isValidBoundary(x, y) {
        return x >= 0 && x < this.g.cols && y >= 0 && y < this.g.rows;
    }

    _applyMask() {
        // Re-apply override flags for ALL active blocks
        // This is necessary because EffectRegistry clears overrides every frame.
        const bs = 2;
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
        
        this.frame++;
        
        // 1. Expansion Logic
        if (this.isExpanding) {
            const s = this._getEffectiveState();
            
            // --- VISUAL UPDATES (Every Frame to prevent flicker) ---
            this._applyMask();
            this._updateBorderIllumination(); 
            
            if (this.fadeInAlpha < 1.0) {
                this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
                if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
            }
            
            this._updateLines(s);

            // --- HEAVY SIMULATION (Full 60 FPS) ---
            this.localFrame++; 
            
            this._updateShadowWorld();
            
            // Time-Based Expansion Control
            const elapsed = Date.now() - this.startTime;
            const durationMs = s.duration * 1000; 
            
            if (elapsed > durationMs + 1000) {
                this._finishExpansion();
            }
            else if (this.localFrame % 10 === 0 && this.frontier.length > 0) {
                let allOffScreen = true;
                const b = 2;
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
                }
            }
            
            if (this.isExpanding) { 
                const b = 2; // Blocks are 2 characters wide/high. 

                    // Manual Step Logic: Advance phase ONLY on key press
                    if (this.manualStep) {
                        this.manualStep = false; // Consume the key press
                        
                        if (this.growthPhase === 0) {
                            // Initial Block already done. Move to next.
                            this.growthPhase = 1;
                        }
                        
                        if (this.growthPhase === 1) {
                            // Phase 1: Second 4x6 Block (North)
                            const cx = this.origin.x;
                            const cy = this.origin.y - (6 * b); 
                            for(let by = -3; by < 3; by++) {
                                for(let bx = -2; bx < 2; bx++) {
                                    this._addBlock(cx + bx * b, cy + by * b, this.burstCounter);
                                }
                            }

                            this.growthPhase = 2;
                        }
                        else if (this.growthPhase === 2) {
                            // Phase 2: Wings
                            const wingY = this.origin.y - (4 * b); 
                            const wingLen = 4 + Math.floor(Math.random() * 2); 
                            const startX_West = this.origin.x - (2 * b);
                            for(let k=1; k<=wingLen; k++) this._addBlock(startX_West - (k * b), wingY, this.burstCounter);
                            const startX_East = this.origin.x + (1 * b); 
                            for(let k=1; k<=wingLen; k++) this._addBlock(startX_East + (k * b), wingY, this.burstCounter);
                            this.growthPhase = 3;
                        }
                        else if (this.growthPhase === 3) {
                            // Phase 3: Vertical Cross Bars on Wings AND Long N/S Bars
                            const wingY = this.origin.y - (4 * b);
                            
                            // 1. West (3 blocks high)
                            const startX_West = this.origin.x - (2 * b);
                            const tx_West = startX_West - (3 * b);
                            for(let k=1; k<=3; k++) {
                                this._addBlock(tx_West, wingY + (k * b), this.burstCounter);
                                this._addBlock(tx_West, wingY - (k * b), this.burstCounter);
                            }
                            
                            // 2. East (2 blocks high - Shorter, NO South tendril)
                            const startX_East = this.origin.x + (1 * b);
                            const tx_East = startX_East + (3 * b); 
                            for(let k=1; k<=3; k++) {
                                this._addBlock(tx_East, wingY - (k * b), this.burstCounter);
                            }

                            // 3. South Bar (Longer, 1x12)
                            const barX = this.origin.x - (1 * b);
                            const startY_SouthBar = this.origin.y + (3 * b); 
                            for(let k=0; k<12; k++) {
                                this._addBlock(barX, startY_SouthBar + (k * b), this.burstCounter);
                            }

                            this._addBlock(barX + (1 * b), startY_SouthBar + (5 * b), this.burstCounter);
    
                            // 4. North Bar (Longer, 1x10)
                            const startY_NorthBar = this.origin.y - (10 * b);
                            for(let k=0; k<10; k++) {
                                this._addBlock(barX, startY_NorthBar - (k * b), this.burstCounter);
                            }

                            this.growthPhase = 4;
                        }
                        else if (this.growthPhase === 4) {
                            // Phase 4: West Clusters
                            const wingY = this.origin.y - (4 * b);
                            const startX_West = this.origin.x - (2 * b);                    
                            const t1_x = startX_West - (1 * b);
                            const t2_x = startX_West - (2 * b);
                            const barX = this.origin.x - (1 * b);
                            const startY_SouthBar = this.origin.y + (3 * b); 
                            
                            // North Side (Above) - 2x3 Cluster
                            for(let k=1; k<=3; k++) {
                                this._addBlock(t1_x, wingY - (k * b), this.burstCounter);
                                this._addBlock(t2_x, wingY - (k * b), this.burstCounter);
                            }
        
                            // South Side (Below) - 2x3 Cluster
                            for(let k=1; k<=3; k++) {
                                this._addBlock(t1_x, wingY + (k * b), this.burstCounter);
                                this._addBlock(t2_x, wingY + (k * b), this.burstCounter);
                            }

                            this._addBlock(barX + (1 * b), startY_SouthBar + (6 * b), this.burstCounter);
        
                            this.growthPhase = 5;
                        }
                        else if (this.growthPhase === 5) {
                            // Phase 5: South Thickening, West Cluster Extension, Wing Thickening
                            // 1. South Thickening (Existing)
                            const barX = this.origin.x - (1 * b);
                            const startX_Block = barX + (1 * b); 
                            const startY_SouthBar = this.origin.y + (1 * b);
                            const bottomY = startY_SouthBar + (12 * b); 
                            
                            for(let by=0; by<2; by++) {
                                for(let bx=0; bx<2; bx++) {
                                    this._addBlock(startX_Block + (bx * b), (bottomY - 8) - (by * b), this.burstCounter);
                                }
                            }

                            for(let k=0; k<2; k++) {
                                this._addBlock(barX, bottomY + (k * b), this.burstCounter);
                            }
                            
                            // 2. Extend West Clusters (To match central mass)
                            const wingY = this.origin.y - (4 * b);
                            const startX_West = this.origin.x - (2 * b);                    
                            const t1_x = startX_West - (1 * b);
                            const t2_x = startX_West - (2 * b); // -4b
                            
                            // Extend North 
                            for(let k=4; k<=5; k++) {
                                for(let j=0; j<=2; j++){
                                    this._addBlock(t1_x - (j * b), wingY - (k * b), this.burstCounter);
                                }
                            }
                            
                            // Extend South (Down to align with Phase 0 bottom)
                            for(let k=4; k<=6; k++) {
                                this._addBlock(t1_x, wingY + (k * b), this.burstCounter);
                                this._addBlock(t2_x, wingY + (k * b), this.burstCounter);
                            }

                            // Add column at t2_x - b. Matches South Cluster height (k=1..6 relative to wingY)
                            const t3_x = t2_x - b;
                            for(let k=1; k<=6; k++) {
                                this._addBlock(t3_x, wingY + (k * b), this.burstCounter);
                            }
                            
                            // 3. East Upwards Extension & Fill
                            const startX_East = this.origin.x + (1 * b); 
                            const tx_East = startX_East + (3 * b); // +4b
                            
                            // Extend Up 3 more blocks (Phase 3 went to k=2). So k=3,4,5.
                            for(let k=2; k<=5; k++) {
                                for(let j=0; j<=2; j++){
                                    this._addBlock(tx_East - (j * b), wingY - (k * b), this.burstCounter);
                                }
                            }
                            
                            // Fill West 2 blocks from the top (k=5 level)
                            // "To fill in the rectangle east of the phase 1 block"
                            const topY = wingY - (5 * b);
                            this._addBlock(tx_East - b, topY, this.burstCounter);
                            this._addBlock(tx_East - (2*b), topY, this.burstCounter);

                            // 4. Thicken West/East Tendrils (Make them 4 blocks thick)
                            // West Wing
                            const wingLen = 4; 
                            for(let k=1; k<=wingLen; k++) {
                                const wx = startX_West - (k * b);
                                this._addBlock(wx, wingY - b, this.burstCounter); // Top
                                this._addBlock(wx, wingY - (2*b), this.burstCounter); // Top 2
                                this._addBlock(wx, wingY + b, this.burstCounter); // Bottom
                            }
                            
                            // East Wing
                            for(let k=1; k<=wingLen; k++) {
                                const ex = startX_East + (k * b);
                                this._addBlock(ex, wingY - b, this.burstCounter); // Top
                                this._addBlock(ex, wingY - (2*b), this.burstCounter); // Top 2
                                this._addBlock(ex, wingY + b, this.burstCounter); // Bottom
                            }

                            // Start southern strip
                            this._addBlock(barX, bottomY + (6 * b), this.burstCounter);
        
                            this.growthPhase = 6;
                        }                    
                        else if (this.growthPhase === 6) { 
                            // Phase 6: Wing extension, new north extension, fill/broad

                            // --- WEST SIDE ---
                            const startX_West = this.origin.x - (2 * b);
                            const westClusterEnd = startX_West - (2 * b); 
                            const westBarStart = westClusterEnd - (1 * b);
                            const wingY = this.origin.y - (4 * b);
                            
                            // --- EAST SIDE ---
                            const startX_East = this.origin.x + (1 * b);
                            const t3_x = startX_East + (3 * b);
                            const t4_x = startX_East + (4 * b);


                            // 1. West 6x2 Bar
                            for(let k=0; k<9; k++) {
                                for(let j=0; j<2; j++){
                                    this._addBlock(westBarStart - (k * b), wingY - (j * b), this.burstCounter);
                                }
                            }
                            this._addBlock(startX_West - (6 * b), wingY + (1 * b), this.burstCounter)

                            
                            // 2. East 6x2 Bar
                            for(let k=0; k<12; k++) {
                                for(let j=0; j<2; j++){
                                    this._addBlock(startX_East + (k * b), wingY - (j * b), this.burstCounter);
                                }
                            }
                            this._addBlock(t4_x, wingY - (5 * b), this.burstCounter)
                            
                    

                            // 2. NE Vertical Tendril
                            for(let k=0; k<8; k++){
                                this._addBlock(t3_x -2, 12 + (k * b), this.burstCounter);
                            }

                            // South Side (Below)
                            for(let k=1; k<=3; k++) {
                                for(let j=0; j<12; j++){
                                    this._addBlock((t3_x + (1 * b) - (j * b)), wingY + (k * b), this.burstCounter);
                                }
                            }

                            // Expand southern strip
                            const bottomY = this.origin.y + (12 * b);
                            const barX = this.origin.x - (1 * b);
                            this._addBlock(barX, bottomY + (8 * b), this.burstCounter);
                            this._addBlock(barX, bottomY + (6 * b), this.burstCounter);
        
                            this.growthPhase = 7;
                        }
                        else if (this.growthPhase === 7) {
                            const wingY = this.origin.y - (4 * b);
                            const startX_East = this.origin.x + (1 * b); 
                            const t3_x = startX_East + (3 * b);
                            const t4_x = startX_East + (4 * b);
        
                            for(let k=1; k<=3; k++) {
                                this._addBlock(t3_x, wingY - (k * b), this.burstCounter);
                                this._addBlock(t4_x, wingY - (k * b), this.burstCounter);
                            }
                            for(let k=1; k<=3; k++) {
                                this._addBlock(t3_x, wingY + (k * b), this.burstCounter);
                                this._addBlock(t4_x, wingY + (k * b), this.burstCounter);
                            }
        
                            const barX = this.origin.x - (1 * b);
                            const startY_SouthBar = this.origin.y + (3 * b);
                            const currentBottom = startY_SouthBar + (16 * b);

                            for(let k=0; k<5; k++) {
                                this._addBlock(barX, currentBottom + (k * b), this.burstCounter);
                            }
        
                            // North Bar Extension
                            const currentTop = this.origin.y - (19 * b);
                            for(let k=1; k<=4; k++) {
                                this._addBlock(barX, currentTop - (k * b), this.burstCounter);
                            }
                            
                            this.growthPhase = 8; 

                        } else if (this.growthPhase === 8) {
                        // Phase 8: 4x1 Horizontal Bars & Detail Blocks
                        const wingY = this.origin.y - (4 * b);
                        
                        // --- WEST SIDE ---
                        const startX_West = this.origin.x - (2 * b);
                        const westClusterEnd = startX_West - (2 * b); // t2_x from Phase 4
                        
                        // 1. West 4x1 Bar (Horizontal, 4 blocks wide)
                        // Extending LEFT from the West Cluster
                        const westBarStart = westClusterEnd - (1 * b);
                        for(let k=0; k<4; k++) {
                            this._addBlock(westBarStart - (k * b), wingY, this.burstCounter);
                        }
                        
                        // 2. West Detail Block
                        // "1x1 block on the south of the new west-most tendril, 1 block away from the end"
                        // End is at k=3 (westBarStart - 3*b). 1 block away is k=2 (westBarStart - 2*b).
                        // South = wingY + b.
                        this._addBlock(westBarStart - (2 * b), wingY + b, this.burstCounter);

                        // --- EAST SIDE ---
                        const startX_East = this.origin.x + (1 * b);
                        const eastClusterEnd = startX_East + (4 * b); // t4_x from Phase 6
                        
                        // 3. East 4x1 Bar (Horizontal)
                        // Extending RIGHT from the East Cluster
                        const eastBarStart = eastClusterEnd + (1 * b);
                        for(let k=0; k<4; k++) {
                            this._addBlock(eastBarStart + (k * b), wingY, this.burstCounter);
                        }
                        
                        // 4. Northeast Detail Block
                        // "1x1 block in the northeast most corner of the existing blob"
                        // The NE corner of the blob is the top of the Phase 6 East Cluster.
                        // Phase 6 Cluster Top is at wingY - 3*b.
                        // We'll place this detail block just above it at wingY - 4*b, aligned with the outer edge (eastClusterEnd).
                        this._addBlock(eastClusterEnd, wingY - (4 * b), this.burstCounter);

                        this.growthPhase = 9;
                    }
                    else if (this.growthPhase === 9) {
                        // Phase 8: Thicken Verticals, Extensions, & Center Corners
                        const b = 2;
                        const barX = this.origin.x - (1 * b);
                        const thickenX = this.origin.x; // Right side of existing bar

                        // 1. Thicken South Bar (Right Side)
                        // Original: origin.y + 3*b to +13*b (10 blocks long).
                        const startY_South = this.origin.y + (3 * b);
                        for(let k=0; k<10; k++) {
                            this._addBlock(thickenX, startY_South + (k * b), this.burstCounter);
                        }

                        // 2. Thicken North Bar (Right Side)
                        // Original: origin.y - 10*b to -4*b (6 blocks) + ext 1x4 = 10 blocks.
                        // Start from top down.
                        const startY_North = this.origin.y - (10 * b);
                        for(let k=0; k<10; k++) {
                            this._addBlock(thickenX, startY_North + (k * b), this.burstCounter);
                        }

                        // 3. West Vertical Extension (1x3 Down)
                        // West Tip from Phase 7 (westBarStart = -5b). Length 4 -> Ends at -8b.
                        // Wait, West Cluster ends at -4b (t2_x). Bar starts -5b, length 4. Ends -8b.
                        // Tip X: origin.x - 2b - 2b - 1b - 3b = origin.x - 8b.
                        const tipX_West = (this.origin.x - (2 * b)) - (2 * b) - (1 * b) - (3 * b);
                        const wingY = this.origin.y - (4 * b);
                        for(let k=1; k<=3; k++) {
                            this._addBlock(tipX_West, wingY + (k * b), this.burstCounter);
                        }

                        // 4. East Vertical Extension (1x3 Up)
                        // East Tip X: origin.x + 1b + 4b + 1b + 3b = origin.x + 9b.
                        const tipX_East = (this.origin.x + (1 * b)) + (4 * b) + (1 * b) + (3 * b);
                        for(let k=1; k<=3; k++) {
                            this._addBlock(tipX_East, wingY - (k * b), this.burstCounter);
                        }

                        // 5. Center Mass Corners (3x3)
                        // NW
                        const nwX = this.origin.x - (4 * b);
                        const nwY = this.origin.y - (7 * b); // Aligned with top block bottom (-4b) or top (-6b)? Top of Phase 0 is -3b. Top of Phase 1 is -9b.
                        // Let's place it at the intersection.
                        for(let by=0; by<3; by++) { for(let bx=0; bx<3; bx++) { this._addBlock(nwX + bx*b, nwY + by*b, this.burstCounter); }}

                        // NE
                        const neX = this.origin.x + (1 * b);
                        const neY = this.origin.y - (7 * b);
                        for(let by=0; by<3; by++) { for(let bx=0; bx<3; bx++) { this._addBlock(neX + bx*b, neY + by*b, this.burstCounter); }}
                        
                        // SW
                        const swX = this.origin.x - (4 * b);
                        const swY = this.origin.y + (0 * b); // Near center Y
                        for(let by=0; by<3; by++) { for(let bx=0; bx<3; bx++) { this._addBlock(swX + bx*b, swY + by*b, this.burstCounter); }}
                        
                        // SE
                        const seX = this.origin.x + (1 * b);
                        const seY = this.origin.y + (0 * b);
                        for(let by=0; by<3; by++) { for(let bx=0; bx<3; bx++) { this._addBlock(seX + bx*b, seY + by*b, this.burstCounter); }}

                        this.growthPhase = 9;
                    }
                    else if (this.growthPhase === 9) {
                        // Phase 9: Further Extensions & Vertical Thickening
                        const b = 2;
                        const wingY = this.origin.y - (4 * b);

                        // 1. West Extension (4 blocks)
                        // Previous West Tip was -8b. New range: -9b to -12b.
                        const westExtStart = this.origin.x - (9 * b);
                        for(let k=0; k<4; k++) {
                            this._addBlock(westExtStart - (k * b), wingY, this.burstCounter);
                        }

                        // 2. East Extension (4 blocks)
                        // Previous East Tip was +9b. New range: +10b to +13b.
                        const eastExtStart = this.origin.x + (10 * b);
                        for(let k=0; k<4; k++) {
                            this._addBlock(eastExtStart + (k * b), wingY, this.burstCounter);
                        }

                        // 3. Thicken South Bar (Left Side)
                        // Phase 8 thickened Right side (+0b). Original was -1b.
                        // Now thicken Left side (-2b).
                        const thickenX_Left = this.origin.x - (2 * b);
                        const startY_South = this.origin.y + (3 * b);
                        for(let k=0; k<10; k++) {
                            this._addBlock(thickenX_Left, startY_South + (k * b), this.burstCounter);
                        }

                        // 4. Thicken North Bar (Left Side)
                        const startY_North = this.origin.y - (10 * b);
                        for(let k=0; k<10; k++) {
                            this._addBlock(thickenX_Left, startY_North + (k * b), this.burstCounter);
                        }

                        this.growthPhase = 10;
                    }
                    else if (this.growthPhase === 10) {
                        // Phase 10: Vertical Bars on Tendrils & Wing Thickening
                        const b = 2;
                        const wingY = this.origin.y - (4 * b);

                        // 1. Vertical Bars on West Tendril (at -11b)
                        const westVertX = this.origin.x - (11 * b);
                        for(let k=1; k<=4; k++) {
                            this._addBlock(westVertX, wingY - (k * b), this.burstCounter); // Up
                            this._addBlock(westVertX, wingY + (k * b), this.burstCounter); // Down
                        }

                        // 2. Vertical Bars on East Tendril (at +12b)
                        const eastVertX = this.origin.x + (12 * b);
                        for(let k=1; k<=4; k++) {
                            this._addBlock(eastVertX, wingY - (k * b), this.burstCounter); // Up
                            this._addBlock(eastVertX, wingY + (k * b), this.burstCounter); // Down
                        }

                        // 3. Thicken West Wing (Add row above at wingY - 1b)
                        // Sweep from center to tip. _isOccupied will skip clusters.
                        for(let k=1; k<=12; k++) {
                            this._addBlock(this.origin.x - (k * b), wingY - b, this.burstCounter);
                        }

                        // 4. Thicken East Wing (Add row above at wingY - 1b)
                        for(let k=1; k<=13; k++) {
                            this._addBlock(this.origin.x + (k * b), wingY - b, this.burstCounter);
                        }

                        this.growthPhase = 11;
                    }
                    else if (this.growthPhase === 11) {
                        // Phase 11: Long Horizontal Branches from N/S Tendrils
                        const b = 2;
                        // North Branch Y: Near top of N-Bar (origin.y - 10b). Let's go at -9b.
                        // South Branch Y: Near bottom of S-Bar (origin.y + 13b). Let's go at +10b.
                        const northBranchY = this.origin.y - (9 * b);
                        const southBranchY = this.origin.y + (10 * b);
                        const centerX = this.origin.x - (1 * b); // Center of the bar (roughly)

                        // North Branches (7x1)
                        for(let k=1; k<=7; k++) {
                            this._addBlock(centerX - (k * b), northBranchY, this.burstCounter); // Westward
                            this._addBlock(centerX + (k * b), northBranchY, this.burstCounter); // Eastward
                        }
                        
                        // South Branches (7x1)
                        for(let k=1; k<=7; k++) {
                            this._addBlock(centerX - (k * b), southBranchY, this.burstCounter); // Westward
                            this._addBlock(centerX + (k * b), southBranchY, this.burstCounter); // Eastward
                        }

                        this.growthPhase = 12;
                    }
                    else if (this.growthPhase === 12) {
                        // Phase 12: Thicken thin tendrils (excluding Phase 11 branches)
                        // Targets: Phase 10 Vertical Bars (-11b, +12b) and extensions
                        const b = 2;
                        const wingY = this.origin.y - (4 * b);

                        // 1. Thicken Phase 10 West Verticals (-11b) - Add column at -12b
                        const westVertX = this.origin.x - (12 * b); 
                        for(let k=1; k<=4; k++) {
                            this._addBlock(westVertX, wingY - (k * b), this.burstCounter); 
                            this._addBlock(westVertX, wingY + (k * b), this.burstCounter); 
                        }

                        // 2. Thicken Phase 10 East Verticals (+12b) - Add column at +13b
                        const eastVertX = this.origin.x + (13 * b);
                        for(let k=1; k<=4; k++) {
                            this._addBlock(eastVertX, wingY - (k * b), this.burstCounter); 
                            this._addBlock(eastVertX, wingY + (k * b), this.burstCounter); 
                        }
                        
                        // 3. Thicken Phase 8 Vertical Tips (West @ -8b, East @ +9b)
                        // West (-8b): Add column at -9b. Length 3.
                        const wTipX = (this.origin.x - (2 * b)) - (2 * b) - (1 * b) - (3 * b) - (1 * b);
                        for(let k=1; k<=3; k++) {
                            this._addBlock(wTipX, wingY + (k * b), this.burstCounter);
                        }
                        
                        // East (+9b): Add column at +10b. Length 3.
                        const eTipX = (this.origin.x + (1 * b)) + (4 * b) + (1 * b) + (3 * b) + (1 * b);
                        for(let k=1; k<=3; k++) {
                            this._addBlock(eTipX, wingY - (k * b), this.burstCounter);
                        }

                        this.growthPhase = 13;
                    }
                    else if (this.growthPhase === 13) {
                        // Phase 13: Mass Expansion & Branch Extension/Thickening
                        const b = 2;
                        
                        // 1. Extend Main Mass Vertically (Fill corners towards center)
                        // Add 2x2 blocks in the "inner corners" of the cross
                        const cX = this.origin.x - b;
                        const cY = this.origin.y;
                        
                        // NW Inner
                        this._addBlock(cX - b, cY - 2*b, this.burstCounter);
                        this._addBlock(cX - 2*b, cY - b, this.burstCounter);
                        
                        // NE Inner
                        this._addBlock(cX + 2*b, cY - 2*b, this.burstCounter);
                        this._addBlock(cX + 3*b, cY - b, this.burstCounter);
                        
                        // SW Inner
                        this._addBlock(cX - b, cY + 2*b, this.burstCounter);
                        this._addBlock(cX - 2*b, cY + b, this.burstCounter);
                        
                        // SE Inner
                        this._addBlock(cX + 2*b, cY + 2*b, this.burstCounter);
                        this._addBlock(cX + 3*b, cY + b, this.burstCounter);

                        // 2. Thicken Phase 11 Branches (Add row above/below)
                        const northBranchY = this.origin.y - (9 * b);
                        const southBranchY = this.origin.y + (10 * b);
                        const centerX = this.origin.x - (1 * b);

                        for(let k=1; k<=7; k++) {
                            // Thicken North (Above)
                            this._addBlock(centerX - (k * b), northBranchY - b, this.burstCounter);
                            this._addBlock(centerX + (k * b), northBranchY - b, this.burstCounter);
                            
                            // Thicken South (Below)
                            this._addBlock(centerX - (k * b), southBranchY + b, this.burstCounter);
                            this._addBlock(centerX + (k * b), southBranchY + b, this.burstCounter);
                        }

                        // 3. Extend Phase 11 Branches (Towards Edges)
                        // Current length 7. Add 2 more (8..9).
                        for(let k=8; k<=9; k++) {
                            this._addBlock(centerX - (k * b), northBranchY, this.burstCounter);
                            this._addBlock(centerX + (k * b), northBranchY, this.burstCounter);
                            this._addBlock(centerX - (k * b), southBranchY, this.burstCounter);
                            this._addBlock(centerX + (k * b), southBranchY, this.burstCounter);
                        }

                        this.growthPhase = 14;
                    }
                    else if (this.growthPhase === 14) {
                        // Phase 14: Fill Internal Holes (Main Mass)
                        // Aggressively fill gaps within the central 16x16 block area
                        const range = 8; // Reduced from 15 to 8 to prevent quadrant filling
                        const cx = this.origin.x;
                        const cy = this.origin.y;
                        
                        // Scan the bounding box
                        for(let by = -range; by <= range; by++) {
                            for(let bx = -range; bx <= range; bx++) {
                                const tx = cx + (bx * 2);
                                const ty = cy + (by * 2);
                                
                                // If empty...
                                if (!this._isOccupied(tx, ty)) {
                                    // Check neighbors (mass adjacency)
                                    let neighbors = 0;
                                    if (this._isOccupied(tx, ty - 2)) neighbors++;
                                    if (this._isOccupied(tx + 2, ty)) neighbors++;
                                    if (this._isOccupied(tx, ty + 2)) neighbors++;
                                    if (this._isOccupied(tx - 2, ty)) neighbors++;
                                    
                                    // If enclosed or next to mass (>= 2 neighbors), fill it
                                    if (neighbors >= 2) {
                                        this._addBlock(tx, ty, this.burstCounter);
                                    }
                                }
                            }
                        }
                        this.growthPhase = 15;
                    }
                    else if (this.growthPhase === 15) {
                        // Phase 15: Fractal Expansion (2x1 -> 3x3 -> 5x5 -> 1x3) - ANIMATED (3 Loops)
                        const b = 2;
                        const centerX = this.origin.x - (1 * b);
                        const northBranchY = this.origin.y - (9 * b);
                        const southBranchY = this.origin.y + (10 * b);
                        
                        if (this.phase15LoopCounter < 3) {
                            // Add 1 Pattern Set per loop, moving outward
                            // Start closer (2) and expand out (3 per step)
                            const off = (2 + (this.phase15LoopCounter * 3)) * b;
                            
                            // 1. Add 2x1 (Horizontal)
                            this._addPhase15Cluster(centerX - off, northBranchY, 2, 1);
                            this._addPhase15Cluster(centerX + off, northBranchY, 2, 1);
                            this._addPhase15Cluster(centerX - off, southBranchY, 2, 1);
                            this._addPhase15Cluster(centerX + off, southBranchY, 2, 1);
                            
                            // 2. Add 3x3 (Centered)
                            this._addPhase15Cluster(centerX - (off + 2*b), northBranchY, 3, 3, true);
                            this._addPhase15Cluster(centerX + (off + 2*b), northBranchY, 3, 3, true);
                            this._addPhase15Cluster(centerX - (off + 2*b), southBranchY, 3, 3, true);
                            this._addPhase15Cluster(centerX + (off + 2*b), southBranchY, 3, 3, true);
                            
                            // 3. Add 5x5 (Centered)
                            this._addPhase15Cluster(centerX - (off + 5*b), northBranchY, 5, 5, true);
                            this._addPhase15Cluster(centerX + (off + 5*b), northBranchY, 5, 5, true);
                            this._addPhase15Cluster(centerX - (off + 5*b), southBranchY, 5, 5, true);
                            this._addPhase15Cluster(centerX + (off + 5*b), southBranchY, 5, 5, true);

                            // 4. Add 1x3 (Vertical Strip) - Thinner edge block
                            // Attached to the outside of the 5x5.
                            // 5x5 was at off + 5b (center). Edge is at off + 5b + 2b = off + 7b.
                            this._addPhase15Cluster(centerX - (off + 8*b), northBranchY, 1, 3, true);
                            this._addPhase15Cluster(centerX + (off + 8*b), northBranchY, 1, 3, true);
                            this._addPhase15Cluster(centerX - (off + 8*b), southBranchY, 1, 3, true);
                            this._addPhase15Cluster(centerX + (off + 8*b), southBranchY, 1, 3, true);

                            // 5. Add 1x1 Tip (Arrow Point)
                            this._addPhase15Cluster(centerX - (off + 9*b), northBranchY, 1, 1, true);
                            this._addPhase15Cluster(centerX + (off + 9*b), northBranchY, 1, 1, true);
                            this._addPhase15Cluster(centerX - (off + 9*b), southBranchY, 1, 1, true);
                            this._addPhase15Cluster(centerX + (off + 9*b), southBranchY, 1, 1, true);
                            
                            this.phase15LoopCounter++;
                            
                        }
                        else {
                            // End Expansion after 3 loops of Phase 15
                            this.growthPhase = 16;
                        }
                } else if (this.growthPhase === 16) {
                    const b = 2;

                    // Outward growth from phase 15 tendrils
                    const centerX = Math.floor(this.origin.x / b) * b;
                    const centerY = Math.floor(this.origin.y / b) * b;
                    
                    // Tendrils extension logic
                    for (let t of this.tendrilHistory) {
                        let maxLength = Math.min(t.length + 2, 10); // Extend each tendril up to 10 blocks long
                        let isBlocked = false;

                        for (let step = 1; step <= maxLength; step++) {
                            if (isBlocked) break;

                            const nextX = t.x + step * t.dx;
                            const nextY = t.y + step * t.dy;

                            // Stop if an obstacle or boundary is encountered
                            if (this._isOccupied(nextX, nextY) || nextX < 0 || nextY < 0 || nextX >= this.g.cols || nextY >= this.g.rows) {
                                isBlocked = true;
                                continue;
                            }

                            // Add the extended tendril block
                            this._addBlock(nextX, nextY, this.burstCounter);
                        }
                    }

                    // Fill remaining gaps
                    const maxFillCount = 50; // Budget of points to attempt filling
                    for (let fillAttempt = 0; fillAttempt < maxFillCount; fillAttempt++) {
                        const candidates = [];
                        
                        // Check for neighboring unfilled gaps
                        for (let b of this.blocks) {
                            const potentialGaps = [
                                {x: b.x, y: b.y - b}, // Up
                                {x: b.x + b, y: b.y}, // Right
                                {x: b.x, y: b.y + b}, // Down
                                {x: b.x - b, y: b.y}  // Left
                            ];

                            for (let gap of potentialGaps) {
                                if (!this._isOccupied(gap.x, gap.y)) {
                                    candidates.push(gap);
                                }
                            }
                        }

                        // Randomly fill an eligible gap
                        if (candidates.length > 0) {
                            const gap = candidates[Math.floor(Math.random() * candidates.length)];
                            this._addBlock(gap.x, gap.y, this.burstCounter);
                        }
                    }

                    // Widen borders and crevices
                    const horizontalBias = this.g.cols > this.g.rows ? 2 : 1; // Adjust for grid aspect ratio
                    const verticalBias = this.g.rows > this.g.cols ? 2 : 1;
                    const edgeCandidates = [];

                    for (let b of this.blocks) {
                        const offScreen = (b.x < 0 || b.y < 0 || b.x >= this.g.cols || b.y >= this.g.rows);
                        if (offScreen) continue;

                        // Push rows/columns outward from edges
                        for (let offset of [[-b, 0], [b, 0], [0, -b], [0, b]]) {
                            const newX = b.x + offset[0] * horizontalBias;
                            const newY = b.y + offset[1] * verticalBias;

                            if (!this._isOccupied(newX, newY) && this._isValidBoundary(newX, newY)) {
                                edgeCandidates.push({x: newX, y: newY});
                            }
                        }
                    }

                    // Randomly add new blocks at valid edges
                    const edgeFillCount = Math.min(30, edgeCandidates.length); // Limit to 30 edge blocks
                    for (let i = 0; i < edgeFillCount; i++) {
                        const edge = edgeCandidates.splice(Math.floor(Math.random() * edgeCandidates.length), 1);

                        if (edge && edge[0]) {
                            this._addBlock(edge[0].x, edge[0].y, this.burstCounter);
                        }
                    }

                    // Finalize Phase 16 expansion
                    this.growthPhase = 17; // Move to the next phase
                }
            }

            // Move line updates OUTSIDE isExpanding but INSIDE active
            // This ensures they continue to fade after expansion finishes
            this._updateLines(s);
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
    }

    _waterFill(count) {
        let processed = 0;
        
        // --- PASS 1: INTERNAL HOLE FILLING (60% of Budget) ---
        // This pass ensures the "center mass" is solid and has no holes.
        const holeBudget = Math.floor(count * 0.6);
        const candidates = [];
        
        // We scan a random subset of existing blocks to find holes (empty neighbors with >= 2 adjacent blocks)
        const scanSize = Math.min(this.blocks.length, 400);
        const seen = new Set();

        for(let i=0; i<scanSize; i++) {
            const bIdx = Math.floor(Math.random() * this.blocks.length);
            const b = this.blocks[bIdx];
            if (!b) continue;

            const neighbors = [
                {x: b.x, y: b.y - 2}, {x: b.x + 2, y: b.y},
                {x: b.x, y: b.y + 2}, {x: b.x - 2, y: b.y}
            ];

            for(const n of neighbors) {
                const key = `${n.x},${n.y}`;
                if (seen.has(key) || this._isOccupied(n.x, n.y)) continue;
                seen.add(key);

                // Count how many neighbors this empty spot has
                let massAdjacency = 0;
                if (this._isOccupied(n.x, n.y - 2)) massAdjacency++;
                if (this._isOccupied(n.x + 2, n.y)) massAdjacency++;
                if (this._isOccupied(n.x, n.y + 2)) massAdjacency++;
                if (this._isOccupied(n.x - 2, n.y)) massAdjacency++;

                if (massAdjacency >= 2) {
                    // It's a hole or a deep nook!
                    // Weight by distance to origin (prefer filling center holes)
                    const dist = Math.sqrt((n.x - this.origin.x)**2 + (n.y - this.origin.y)**2);
                    candidates.push({x: n.x, y: n.y, w: 1000 - dist});
                }
            }
        }

        candidates.sort((a, b) => b.w - a.w);
        const fillLimit = Math.min(holeBudget, candidates.length);
        for(let i=0; i<fillLimit; i++) {
            this._addBlock(candidates[i].x, candidates[i].y, this.burstCounter, true); // Merge!
            processed++;
        }

        // --- PASS 2: RIVER WIDENING (Remaining Budget) ---
        if (this.tendrilHistory.length === 0) return;
        
        const remainingBudget = count - processed;
        let attempts = 0;
        const maxAttempts = remainingBudget * 5;
        
        while (processed < count && attempts < maxAttempts) {
            attempts++;
            
            // Pick a random tendril history entry
            const idx = Math.floor(Math.random() * this.tendrilHistory.length);
            const t = this.tendrilHistory[idx];
            
            let wx = 0, wy = 0;
            if (t.axis === 'y') wx = 2; else wy = 2;
            
            const side = Math.random() < 0.5 ? 1 : -1;
            const offX = wx * side;
            const offY = wy * side;
            
            if (t.widthLevel >= 4) continue;
            
            let addedAny = false;
            for (let k = 0; k < t.length; k++) {
                const sx = t.x + (t.dx * k);
                const sy = t.y + (t.dy * k);
                
                let cx = sx + offX;
                let cy = sy + offY;
                
                if (!this._isOccupied(cx, cy)) {
                    this._addBlock(cx, cy, this.burstCounter, true); // Merge
                    addedAny = true;
                    processed++;
                } else if (t.widthLevel >= 2) {
                    cx += offX;
                    cy += offY;
                    if (!this._isOccupied(cx, cy)) {
                        this._addBlock(cx, cy, this.burstCounter, true); // Merge
                        addedAny = true;
                        processed++;
                    }
                }
                if (processed >= count) break;
            }
            if (addedAny) t.widthLevel++;
        }
    }
    
    _updateBorderIllumination() {
        const bs = 2;
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
                const isTopOccupied = this._isOccupied(l.x, l.y - 2);
                const isBottomOccupied = this._isOccupied(l.x, l.y);
                
                if (isTopOccupied && !isBottomOccupied) {
                    this._illuminateSpan(l.x, l.y - 1, 2, 1, scale);
                }
                else if (isBottomOccupied && !isTopOccupied) {
                    this._illuminateSpan(l.x, l.y, 2, 1, scale);
                }
            } else {
                const isLeftOccupied = this._isOccupied(l.x - 2, l.y);
                const isRightOccupied = this._isOccupied(l.x, l.y);
                
                if (isLeftOccupied && !isRightOccupied) {
                    this._illuminateSpan(l.x - 1, l.y, 1, 2, scale);
                }
                else if (isRightOccupied && !isLeftOccupied) {
                    this._illuminateSpan(l.x, l.y, 1, 2, scale);
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

    _growTendrils(axis, length) {
        // This method now iterates backwards through a portion of the frontier
        // to avoid unstable sampling while still being performant.
        let candidates = this.frontier.length;
        let attempts = 0;
        const maxAttempts = Math.min(this.frontier.length, 12); // Process up to 12 candidates per frame

        // Backwards loop is safe for synchronous removal (splice)
        for(let i = this.frontier.length - 1; i >= 0 && attempts < maxAttempts; i--) {
            attempts++;
            const f = this.frontier[i];

            if (!f || this._isOccupied(f.x, f.y)) {
                this.frontier.splice(i, 1);
                continue;
            }

            // Probability check based on cardinal axis weight
            let weight = 0.1; // Base probability to grow
            if (axis === 'y') {
                const off = Math.abs(f.x - this.origin.x);
                weight += 500 / (off + 1); // Heavily prioritize being on the axis
            } else {
                const off = Math.abs(f.y - this.origin.y);
                weight += 500 / (off + 1);
            }
            // Normalize weight to a probability
            const probability = Math.max(0.05, Math.min(weight, 0.95));

            if (Math.random() > probability) {
                continue; // Probabilistically skip this frontier point
            }
            
            // --- 3. DIRECTION VALIDATION ---
            const validDirs = [];
            if (axis === 'y') {
                if (this._isOccupied(f.x, f.y - 2)) validDirs.push({x:0, y:2});  
                if (this._isOccupied(f.x, f.y + 2)) validDirs.push({x:0, y:-2}); 
            } 
            else {
                if (this._isOccupied(f.x - 2, f.y)) validDirs.push({x:2, y:0});  
                if (this._isOccupied(f.x + 2, f.y)) validDirs.push({x:-2, y:0}); 
            }
            
            if (validDirs.length === 0) continue;
            
            // If we've decided to grow, we consume the frontier point
            this.frontier.splice(i, 1);
            
            const d = validDirs[Math.floor(Math.random() * validDirs.length)];
            
            // --- 4. BUILD ---
            const tEntry = { x: f.x, y: f.y, dx: d.x, dy: d.y, axis: axis, length: 0, widthLevel: 1 };
            
            for (let k = 0; k < length; k++) {
                const tx = f.x + (d.x * k);
                const ty = f.y + (d.y * k);
                
                if (this._isOccupied(tx, ty) && k > 0) break; 
                
                this._addBlock(tx, ty, this.burstCounter);
                tEntry.length++;
            }
            
            if (tEntry.length > 0) {
                this.tendrilHistory.push(tEntry);
            }
        }
    }

    _hasCode(x, y) {
        // Check center of the 2x2 block
        const gx = x + 1;
        const gy = y + 1;
        if (gx < 0 || gy < 0 || gx >= this.g.cols || gy >= this.g.rows) return false;
        
        const idx = this.g.getIndex(gx, gy);
        return (this.g.state && this.g.state[idx] === 1);
    }
    
    // _hardenTendril removed


    _updateLines(s) {
        const duration = 0.5;
        const speed = (duration <= 0.01) ? 1.0 : (1.0 / (duration * 60));

        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].persistence > 0) {
                this.lines[i].persistence--;
            } else {
                // If duration is 0, new lines (outer border) should stay fully visible (alpha 1.0)
                // until they are either converted to old (and removed) or expansion finishes.
                if (this.lines[i].isNew && duration <= 0.01) {
                    this.lines[i].alpha = 1.0;
                    continue;
                }

                this.lines[i].alpha -= speed;
                if (this.lines[i].alpha <= 0) this.lines.splice(i, 1);
            }
        }
    }

    _updateStart(s) {
        const neighbors = [
            {x: this.origin.x, y: this.origin.y - 2},
            {x: this.origin.x + 2, y: this.origin.y},
            {x: this.origin.x, y: this.origin.y + 2},
            {x: this.origin.x - 2, y: this.origin.y}
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

    _rebuildFrontier() {
        this.frontier = [];
        const seen = new Set();
        // Sampling approach for performance
        const step = Math.ceil(this.blocks.length / 200); 
        for(let i=0; i<this.blocks.length; i+=step) {
            const b = this.blocks[i];
            const neighbors = [
                {x: b.x, y: b.y - 2}, {x: b.x + 2, y: b.y},
                {x: b.x, y: b.y + 2}, {x: b.x - 2, y: b.y}
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

    _addPhase15Cluster(startX, startY, w, h, centered = false, merge = false) {
        const b = 2;
        // If centered, shift start X/Y back by half width/height
        const xOff = centered ? -Math.floor(w/2) * b : 0;
        const yOff = centered ? -Math.floor(h/2) * b : 0;

        for(let by=0; by<h; by++) {
            for(let bx=0; bx<w; bx++) {
                // Direction of expansion matters for StartX. 
                // If we are passing negative offset for West, startX is correct.
                // We just draw w*h block at startX + bx*b.
                this._addBlock(startX + xOff + (bx * b), startY + yOff + (by * b), this.burstCounter, merge);
            }
        }
    }

    _updateExpansionBurst(count) {
        // CYCLE START: Merge previous new lines (turn them green)
        const greenDuration = 0.5;
        
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
        let processed = 0;
        
        // --- PHASE 1: WEIGHTED EXPANSION ---
        // We removed the Priority Fill (holes) here because it is now handled by _waterFill.
        // This ensures the budget for this method is spent strictly on adding complex block clusters.
        let attempts = 0;
        const maxAttempts = burstCount * 8 + 50; 

        while (processed < burstCount && this.frontier.length > 0 && attempts < maxAttempts) {
            attempts++;
            
            // Standard expansion (K=10 is sufficient)
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
            
            // Remove winner from frontier
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
                // INCREMENT BURST PER WINNER: Ensures this cluster and its neighbors stay distinct
                this.burstCounter = (this.burstCounter + 1) & 0x3FFF;
                if (this.burstCounter === 0) this.burstCounter = 1;

                this._addBlock(winner.x, winner.y, this.burstCounter);
                processed++;
                
                // Only do Group Additions if we aren't filling a hole
                let winnerNeighbors = 0;
                if (this._isOccupied(winner.x, winner.y - 2)) winnerNeighbors++;
                if (this._isOccupied(winner.x + 2, winner.y)) winnerNeighbors++;
                if (this._isOccupied(winner.x, winner.y + 2)) winnerNeighbors++;
                if (this._isOccupied(winner.x - 2, winner.y)) winnerNeighbors++;
                
                if (winnerNeighbors < 3) {
                    // GROUP ADDITION LOGIC (Weighted for ~90% Groups)
                    const rand = Math.random();
                    
                    // 15% chance for 2x3 or 3x2 (Large Rectangles)
                    if (rand < 0.15) {
                        const candidates = [
                            [{x:2,y:0}, {x:0,y:2}, {x:2,y:2}, {x:0,y:4}, {x:2,y:4}],
                            [{x:-2,y:0}, {x:0,y:2}, {x:-2,y:2}, {x:0,y:4}, {x:-2,y:4}],
                            [{x:2,y:0}, {x:4,y:0}, {x:0,y:2}, {x:2,y:2}, {x:4,y:2}],
                            [{x:2,y:0}, {x:4,y:0}, {x:0,y:-2}, {x:2,y:-2}, {x:4,y:-2}]
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
                            [{x:2,y:0}, {x:0,y:2}, {x:2,y:2}],    
                            [{x:-2,y:0}, {x:0,y:2}, {x:-2,y:2}],  
                            [{x:2,y:0}, {x:0,y:-2}, {x:2,y:-2}],  
                            [{x:-2,y:0}, {x:0,y:-2}, {x:-2,y:-2}] 
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
                            [{x:2,y:0}, {x:4,y:0}],      
                            [{x:-2,y:0}, {x:-4,y:0}],    
                            [{x:-2,y:0}, {x:2,y:0}],     
                            [{x:0,y:2}, {x:0,y:4}],      
                            [{x:0,y:-2}, {x:0,y:-4}],    
                            [{x:0,y:-2}, {x:0,y:2}]      
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
                    else if (rand < 0.80) {
                        const type = Math.random() < 0.5 ? 'h' : 'v';
                        let extra = null;
                        if (type === 'h') {
                            if (!this._isOccupied(winner.x + 2, winner.y)) extra = {x: winner.x + 2, y: winner.y};
                            else if (!this._isOccupied(winner.x - 2, winner.y)) extra = {x: winner.x - 2, y: winner.y};
                        } 
                        if (!extra) { 
                            if (!this._isOccupied(winner.x, winner.y + 2)) extra = {x: winner.x, y: winner.y + 2};
                            else if (!this._isOccupied(winner.x, winner.y - 2)) extra = {x: winner.x, y: winner.y - 2};
                        }
                        if (extra) {
                            this._addBlock(extra.x, extra.y, this.burstCounter);
                            const emx = extra.x + this.mapPad;
                            const emy = extra.y + this.mapPad;
                            if (emx >= 0 && emy >= 0 && emx < this.mapCols && emy < this.mapRows) this.map[emy * this.mapCols + emx] &= ~2;
                        }
                    }
                    // Remaining 20%: Single (winner only)
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
                // NOTE: If it's already Mode 3 (Full Reveal), we KEEP it Mode 3.
                // Mode 3 supports overrides just like Mode 1, but includes mix states.
                if (g.overrideActive[idx] !== 3) {
                     g.overrideActive[idx] = 1; 
                }

                // Apply Flash to Glow (Visual Brightness)
                // This adds brightness in the character's OWN color in the shader
                // Use configurable Border Illumination setting
                const illumination = this.c.state.quantizedAddBorderIllumination !== undefined ? this.c.state.quantizedAddBorderIllumination : 4.0;
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
        const colorStr = derived.streamColorStr;
        
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
            const nTop = this._isOccupied(b.x, b.y - 2);
            const nRight = this._isOccupied(b.x + 2, b.y);
            const nBottom = this._isOccupied(b.x, b.y + 2);
            const nLeft = this._isOccupied(b.x - 2, b.y);
            
            const bx = b.x * cw;
            const by = b.y * ch;
            const bw = 2 * cw;
            const bh = 2 * ch;
            
            // Seed based on block coordinate to ensure stability per frame
            // Multipliers 13 and 29 scatter the seeds
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
            
                        // Two-Cycle Logic: New lines are Green (Perimeter), Old are Green (Code)
                        if (l.isNew) {
                            ctx.strokeStyle = colorStr; 
                            ctx.shadowBlur = 25;
                            ctx.shadowColor = colorStr; // Match Shadow to Green
                            
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