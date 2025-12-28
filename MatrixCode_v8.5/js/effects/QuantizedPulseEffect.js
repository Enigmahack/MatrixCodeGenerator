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
            initialSpeed: s.quantizedPulseSpeed || 10,
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            baseDelay: 2.0,     // Much faster start (was 8)
            acceleration: 0.98, // Very subtle acceleration (was 0.94)
            minDelay: 0.5,      // Keep top speed cap same
            blockSize: 4,
            lineFadeSpeed: lineSpeed 
        };
    }
    
    stop() {
        this.active = false;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.swapped = false;
        this.swapTimer = 0;
        
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

    trigger() {
        if (this.active) return false;
        if (this.blocks && this.blocks.length > 0) this.stop();
        
        this.active = true;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.startTime = Date.now();
        
        const s = this._getEffectiveState();
        this.fadeInAlpha = (s.fadeInFrames > 0) ? 0.0 : 1.0;

        // INIT SHADOW WORLD (Full Simulation)
        this._initShadowWorld();

        this.timeoutId = setTimeout(() => {
            this.stop(); // Fail-safe
        }, 60000); // 60 seconds
        
        // Resize map with Padding to allow off-screen expansion
        this.mapPad = 60; // Increased padding for consistent edge behavior
        this.mapCols = this.g.cols + this.mapPad * 2;
        this.mapRows = this.g.rows + this.mapPad * 2;
        const total = this.mapCols * this.mapRows;
        
        if (!this.map || this.map.length !== total) {
            this.map = new Uint16Array(total);
        } else {
            this.map.fill(0);
        }

        // Resize Flash Intensity (On-screen only)
        const totalGrid = this.g.cols * this.g.rows;
        if (!this.flashIntensity || this.flashIntensity.length !== totalGrid) {
            this.flashIntensity = new Float32Array(totalGrid);
        } else {
            this.flashIntensity.fill(0);
        }
        this.activeFlashes.clear();

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
        
        this.currentDelay = s.baseDelay;
        this.nextExpandTime = this.currentDelay;
        
        return true;
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
        
        // 3. Warm Up (Pre-simulate to create density)
        // Run 400 frames to populate the screen (approx 6-7 seconds of sim time)
        // This ensures density matches a long-running state.
        this.shadowSim.timeScale = 1.0;
        for (let i = 0; i < 400; i++) {
            this.shadowSim.update(i);
        }
        this.localFrame = 400;
    }

    _updateShadowWorld() {
        if (!this.shadowSim || !this.shadowGrid) return;
        
        // 1. Advance Shadow Simulation
        this.localFrame++;
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
        
        // Note: We do NOT copy 'types', 'decays' etc to Override, 
        // because Override is purely visual. Logic state stays in shadowSim.
    }

    _swapAndStop() {
        console.log("[QuantizedPulse] Swapping Reality...");
        
        try {
            const g = this.g;
            const sg = this.shadowGrid;
            
            if (!sg) {
                this.stop();
                return;
            }
            
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
            if (sg.activeIndices.size === 0) {
                console.warn("[QuantizedPulse] Shadow World empty! Aborting swap.");
                this.stop();
                return;
            }
            g.activeIndices.clear();
            for (const idx of sg.activeIndices) {
                g.activeIndices.add(idx);
            }
            
            // 3. Commit Complex Objects
            g.complexStyles.clear();
            for (const [key, value] of sg.complexStyles) {
                g.complexStyles.set(key, {...value});
            }
            
            // 4. SWAP STREAM MANAGER STATE (Safe Serialization)
            if (window.matrix && window.matrix.simulation) {
                const mainSim = window.matrix.simulation;
                const shadowMgr = this.shadowSim.streamManager;
                
                // Serialize activeStreams (Convert Sets to Arrays)
                // We map original objects to new serialized objects to preserve references
                const streamMap = new Map();
                const serializedStreams = shadowMgr.activeStreams.map(s => {
                    const copy = {...s};
                    if (copy.holes instanceof Set) {
                        copy.holes = Array.from(copy.holes);
                    }
                    streamMap.set(s, copy);
                    return copy;
                });
                
                // Serialize Reference Arrays using the map
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
                    complexStyles: Array.from(this.shadowGrid.complexStyles.entries()),
                    activeIndices: Array.from(sg.activeIndices) // Explicitly send active indices
                };
                
                // Adjust nextSpawnFrame
                const frameOffset = mainSim.frame || 0; 
                state.nextSpawnFrame = frameOffset + (state.nextSpawnFrame - this.localFrame);

                if (mainSim.useWorker && mainSim.worker) {
                    mainSim.worker.postMessage({
                        type: 'replace_state',
                        state: state
                    });
                    // Force config sync
                    mainSim.worker.postMessage({
                        type: 'config',
                        config: {
                            state: JSON.parse(JSON.stringify(this.c.state)),
                            derived: this.c.derived
                        }
                    });
                } else {
                    // Main Thread Injection (Rehydrate Sets immediately)
                    state.activeStreams.forEach(s => {
                        if (Array.isArray(s.holes)) s.holes = new Set(s.holes);
                    });
                    
                    const mainMgr = mainSim.streamManager;
                    mainMgr.activeStreams = state.activeStreams;
                    mainMgr.columnSpeeds.set(state.columnSpeeds);
                    mainMgr.lastStreamInColumn = state.lastStreamInColumn;
                    mainMgr.lastEraserInColumn = state.lastEraserInColumn;
                    mainMgr.lastUpwardTracerInColumn = state.lastUpwardTracerInColumn;
                    mainMgr.nextSpawnFrame = state.nextSpawnFrame;
                    
                    mainSim.overlapInitialized = state.overlapInitialized;
                    mainSim._lastOverlapDensity = state._lastOverlapDensity;
                    
                    // Inject Active Indices
                    if (state.activeIndices) {
                        mainSim.grid.activeIndices.clear();
                        state.activeIndices.forEach(idx => mainSim.grid.activeIndices.add(idx));
                    }
                }
            }
            
            // 5. Start Transition
            this.swapped = true;
            
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
        
        // Update Map: Set Occupied (Bit 0) and BurstID (Bits 2-15)
        const mx = x + this.mapPad;
        const my = y + this.mapPad;
        
        if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
            const idx = my * this.mapCols + mx;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            // REVEAL: Set Override Active (Show New World) - On-screen only
            if (x >= -4 && y >= -4 && x < this.g.cols && y < this.g.rows) {
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
                             
                             // Trigger Flash
                             this.flashIntensity[cellIdx] = 1.0;
                             this.activeFlashes.add(cellIdx);
                         }
                    }
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
                        isNew: true 
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
        
        // Transition Buffer Logic
        if (this.swapped) {
            this.swapTimer++;
            // Keep applying mask to show Override layer (which holds New World snapshot)
            this._applyMask(); 
            
            if (this.swapTimer > 5) { // Wait 5 frames for Worker sync
                // Cleanup and Finish
                this.g.clearAllOverrides();
                this.stop();
                this.shadowGrid = null;
                this.shadowSim = null;
            }
            return;
        }

        this.localFrame++;
        const s = this._getEffectiveState();
        
        // 1. Run Shadow Sim & Update Overrides
        this._updateShadowWorld();
        
        // Re-apply Mask (Crucial: EffectRegistry clears it)
        this._applyMask();
        
        // Update Flash Brightness
        this._updateFlashes();
        
        // Handle Fade In
        if (this.fadeInAlpha < 1.0) {
            this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
            if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
        }
        
        if (this.isFading) {
            const decay = 1.0 / Math.max(1, s.fadeFrames);
            this.fadeAlpha -= decay;
            if (this.fadeAlpha <= 0) {
                this.stop();
            }
            return;
        }
        
        // Time-Based Expansion Control
        const elapsed = Date.now() - this.startTime;
        const durationMs = s.duration * 1000; 
        
        // 1. Hard Time Limit (Duration + 1s buffer)
        if (elapsed > durationMs + 1000) {
            this._swapAndStop();
            return;
        }

        // 2. Off-Screen Check (If all frontier blocks are outside visible bounds)
        // Only check periodically or if we have enough blocks to be meaningful
        if (this.localFrame % 10 === 0 && this.frontier.length > 0) {
            let allOffScreen = true;
            const b = 4; // Buffer
            const minX = -b, maxX = this.g.cols + b;
            const minY = -b, maxY = this.g.rows + b;
            
            for (const f of this.frontier) {
                if (f.x >= minX && f.x < maxX && f.y >= minY && f.y < maxY) {
                    allOffScreen = false;
                    break;
                }
            }
            
            if (allOffScreen) {
                this._swapAndStop();
                return;
            }
        }

        const progress = Math.min(1.0, elapsed / durationMs);
        
        // Calibrate target to VISIBLE screen area (exclude padding)
        // This ensures the duration setting maps to "Time to fill screen"
        const totalVisibleBlocks = (this.g.cols * this.g.rows) / 16; 
        
        // Initial Speed modulates the exponent: 
        // High Speed (30) -> Exponent 1.0 (Linear)
        // Default (10) -> Exponent 2.5 (Slow Start)
        // Low Speed (5) -> Exponent 3.0 (Very Slow Start)
        const exponent = Math.max(1.0, 3.5 - (s.initialSpeed / 10));
        const targetBlocks = Math.floor(totalVisibleBlocks * Math.pow(progress, exponent));
        
        let needed = targetBlocks - this.blocksAdded;
        
        // 1. Tendrils are the primary expansion driver during tendril phase
        // They run every frame to provide aggressive, prioritised growth
        if (progress > 0.3) {
            this._updateTendrils(s);
        }

        // 2. Throttled Expansion Tick (Every 3 frames)
        // This ensures the main expansion 'blob' fills gaps but doesn't lead the growth.
        // Also allows Yellow (isNew) lines to be visible for a few frames to allow flicker.
        if (this.localFrame % 3 === 0) {
            if (needed > 0 || (this.blocksAdded < 10 && this.frontier.length > 0)) {
                 // During Tendril Phase (>30%), significantly throttle main expansion 
                 // to let tendrils be the primary growth mechanism.
                 const burstCap = (progress > 0.3) ? 10 : 600;
                 let burst = Math.min(needed, burstCap);
                 
                 // Minimum burst to keep animation fluid
                 if (burst < 1) burst = 1;
                 
                 // Run expansion loop
                 this._updateExpansionBurst(burst);
            }
        }

        this._updateLines(s);

    }

    _updateTendrils(s) {
        // Limit attempts per frame to avoid lag and over-spiking
        const attempts = 6; // Increased to be the primary driver
        const maxDist = 3;
        
        for (let i = 0; i < attempts; i++) {
            if (this.frontier.length === 0) break;
            
            // Pick random frontier block
            const idx = Math.floor(Math.random() * this.frontier.length);
            const f = this.frontier[idx];
            
            // Pick ONE random direction to extend
            const dirs = [{x:0, y:-4}, {x:4, y:0}, {x:0, y:4}, {x:-4, y:0}];
            const d = dirs[Math.floor(Math.random() * dirs.length)];
            
            for (let dist = 1; dist <= maxDist; dist++) {
                const tx = f.x + (d.x * dist);
                const ty = f.y + (d.y * dist);
                
                // Don't extend into occupied space
                if (this._isOccupied(tx, ty)) break;
                
                // Add the block ("Lock in")
                this._addBlock(tx, ty, this.burstCounter);
                
                // Check for Code
                if (this._hasCode(tx, ty)) {
                    // Found code! We connected. Stop extending.
                    break; 
                }
                
                // If no code, loop continues to next dist, adding the next block...
                // Until maxDist (3) is reached, at which point loop ends (Automatic Lock).
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

    _updateExpansionBurst(count) {
        // CYCLE START: Merge previous new lines (turn them green)
        const greenDuration = this.c.state.quantizedPulseGreenFadeSeconds !== undefined ? this.c.state.quantizedPulseGreenFadeSeconds : 0.5;
        
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
        let attempts = 0;
        // Scale safety break with burstCount
        const maxAttempts = burstCount * 8 + 50; 

        while (processed < burstCount && this.frontier.length > 0 && attempts < maxAttempts) {
            attempts++;
            
            // 1. TOURNAMENT SELECTION (O(k) vs O(N))
            // Pick K candidates at random, choose the one with the highest weight
            const K = 4; // Sample size
            let bestIdx = -1;
            let bestWeight = -1;

            for (let k = 0; k < K; k++) {
                const idx = Math.floor(Math.random() * this.frontier.length);
                const f = this.frontier[idx];
                
                // Lazy Validation: Check map to see if this frontier node is still valid
                const mx = f.x + this.mapPad;
                const my = f.y + this.mapPad;

                if (mx >= 0 && my >= 0 && mx < this.mapCols && my < this.mapRows) {
                     const val = this.map[my * this.mapCols + mx];
                     // If occupied (Bit 0) or no longer marked as frontier (Bit 1 cleared), it's stale
                     if ((val & 1) !== 0 || (val & 2) === 0) {
                         // Clean up stale entry immediately using O(1) swap-pop
                         const last = this.frontier.pop();
                         
                         // If we didn't just pop the element at 'idx' (i.e. we popped the end, and 'idx' is somewhere else)
                         if (idx < this.frontier.length) {
                             this.frontier[idx] = last;
                             
                             // CRITICAL FIX: If bestIdx pointed to the element that was at the end (which just moved to idx),
                             // we must update bestIdx to point to its new location (idx).
                             if (bestIdx === this.frontier.length) {
                                 bestIdx = idx;
                             }
                         }
                         
                         k--; // Retry this sample
                         if (this.frontier.length === 0) break;
                         continue;
                     }
                } else {
                    // Out of bounds - remove
                    const last = this.frontier.pop();
                     if (idx < this.frontier.length) {
                         this.frontier[idx] = last;
                         if (bestIdx === this.frontier.length) {
                             bestIdx = idx;
                         }
                     }
                    k--;
                    if (this.frontier.length === 0) break;
                    continue;
                }

                // Calculate Weight for this candidate
                let w = 1.0; 
                const dx = Math.abs(f.x - this.origin.x);
                const dy = Math.abs(f.y - this.origin.y);
                
                if (dx < 4 || dy < 4) { w += 80.0; } 
                else if (dx < 12 || dy < 12) { w += 20.0; } 

                let neighbors = 0;
                if (this._isOccupied(f.x, f.y - 4)) neighbors++;
                if (this._isOccupied(f.x + 4, f.y)) neighbors++;
                if (this._isOccupied(f.x, f.y + 4)) neighbors++;
                if (this._isOccupied(f.x - 4, f.y)) neighbors++;
                if (neighbors >= 2) { w += 10.0; }

                w += Math.random() * 5.0; // Random noise
                
                if (w > bestWeight) {
                    bestWeight = w;
                    bestIdx = idx;
                }
            }

            if (this.frontier.length === 0) break;
            if (bestIdx === -1) continue; // Should not happen if frontier has valid items

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
                // 15% chance for 1x3 or 3x1 (Long Strips) - NEW
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
                else if (rand < 0.80) {
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
                // Remaining 20%: Single (winner only) - Do nothing extra

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
                // Apply Flash to Glow (Visual Brightness)
                // This adds brightness in the character's OWN color in the shader
                // A boost of 4.0 is strong enough to trigger significant bloom
                g.overrideGlows[idx] += 4.0 * intensity;
                
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
        if (!this.active) return;
        const s = this.c.state;
        const cw = derived.cellWidth * s.stretchX;
        const ch = derived.cellHeight * s.stretchY;
        const colorStr = '#FFFF00'; 
        
        const masterAlpha = this.fadeAlpha * this.fadeInAlpha;
        
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, cw * 0.15); 
        
        ctx.beginPath();
        ctx.strokeStyle = colorStr;
        ctx.shadowBlur = 15;
        ctx.shadowColor = colorStr;
        ctx.globalAlpha = masterAlpha;
        
        ctx.setLineDash([cw * 0.5, cw * 0.5, cw * 1.5, cw * 0.5]);

        for (const b of this.blocks) {
            const nTop = this._isOccupied(b.x, b.y - 4);
            const nRight = this._isOccupied(b.x + 4, b.y);
            const nBottom = this._isOccupied(b.x, b.y + 4);
            const nLeft = this._isOccupied(b.x - 4, b.y);
            
            const bx = b.x * cw;
            const by = b.y * ch;
            const bw = 4 * cw;
            const bh = 4 * ch;

            if (!nTop) { ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); }
            if (!nRight) { ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); }
            if (!nBottom) { ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); }
            if (!nLeft) { ctx.moveTo(bx, by); ctx.lineTo(bx, by + bh); }
        }
        ctx.stroke();

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
        ctx.strokeStyle = '#00FF00'; // Matrix Green for internal structure
        ctx.setLineDash([cw * 0.25, cw * 0.25, cw * 0.5, cw * 0.25]);
        
        for (const l of this.lines) {
            let lineAlpha = l.alpha * masterAlpha;
            
            // Two-Cycle Logic: New lines are Yellow (Perimeter), Old are Green (Code)
            if (l.isNew) {
                ctx.strokeStyle = '#FFFF00'; 
                ctx.shadowColor = '#FFFF00'; // Match Shadow to Yellow
                
                // Flicker Logic: 40% chance to dim (More frequent)
                // Range: 0.1 to 0.6 (More noticeable dimming)
                if (Math.random() < 0.4) {
                    lineAlpha *= (0.1 + Math.random() * 0.5);
                }
            } else {
                // Use Primary Stream Color for solidified lines
                const col = derived.streamColorStr || '#00FF00';
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