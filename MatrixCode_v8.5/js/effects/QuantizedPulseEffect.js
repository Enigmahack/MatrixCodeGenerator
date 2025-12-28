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
        
        // Resize map
        const total = this.g.cols * this.g.rows;
        if (!this.map || this.map.length !== total) {
            this.map = new Uint16Array(total);
        } else {
            this.map.fill(0);
        }
        this.mapCols = this.g.cols;
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
        if (x >= 0 && y >= 0 && x < this.mapCols && y < this.g.rows) {
            const idx = y * this.mapCols + x;
            this.map[idx] = (this.map[idx] & ~2) | 1 | (burstId << 2);
            
            // REVEAL: Set Override Active (Show New World)
            const bs = 4;
            for(let by=0; by<bs; by++) {
                for(let bx=0; bx<bs; bx++) {
                     const gx = x + bx;
                     const gy = y + by;
                     if (gx < this.g.cols && gy < this.g.rows) {
                         const cellIdx = gy * this.g.cols + gx;
                         // Enable CHAR override (Mode 1)
                         // This forces the renderer to use overrideChars/Colors instead of Primary
                         this.g.overrideActive[cellIdx] = 1; 
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
                if (pn.x >= 0 && pn.x < this.mapCols && pn.y >= 0 && pn.y < this.g.rows) {
                     const nbVal = this.map[pn.y * this.mapCols + pn.x];
                     const nbBurst = nbVal >> 2;
                     // If both are part of the SAME non-zero burst, they are merged (no line)
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
                    const persistence = s.fadeFrames > 0 ? (10 + Math.random() * 10) : 10; // Increased persistence
                    
                    // Add Line: marked as 'isNew' for the yellow-flash effect
                    this.lines.push({
                        x: lx, y: ly, w: lw, h: lh, 
                        alpha: 1.0, 
                        persistence: persistence, 
                        isNew: true 
                    });
                }
            } else {
                // Neighbor is empty -> Add to frontier
                if (pn.x >= 0 && pn.x < this.g.cols && pn.y >= 0 && pn.y < this.g.rows) {
                    const pIdx = pn.y * this.mapCols + pn.x;
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
        if (x < 0 || y < 0 || x >= this.mapCols) return false; // Bounds check (y check implied by index range but safer to be explicit if rows needed)
        // Actually simple bounds check is good
        if (y >= this.g.rows) return false;
        
        return (this.map[y * this.mapCols + x] & 1) !== 0;
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
                         g.overrideActive[idx] = 1; 
                         // Sync Mix State (Glimmer/Rotator) for the Reveal
                         // This allows the New World to show advanced visual states
                         if (sg) {
                             g.mix[idx] = sg.mix[idx];
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

        const s = this._getEffectiveState();
        
        // 1. Run Shadow Sim & Update Overrides
        this._updateShadowWorld();
        
        // Re-apply Mask (Crucial: EffectRegistry clears it)
        this._applyMask();
        
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
        
        // Duration Check REMOVED: Effect must run until expansion completes to trigger Swap.
        // if (s.duration > 0 && (Date.now() - this.startTime) > s.duration * 1000) {
        //    this.beginFade();
        //    return;
        // }

        // Removed catchTimer logic for consistent speed

        // Fix: Explicitly track startup vs expansion phases to prevent stalling
        const isStartup = this.blocksAdded < 5;
        const hasFrontier = this.frontier.length > 0;

        if (isStartup || hasFrontier) {
            if (--this.nextExpandTime <= 0) {
                
                if (isStartup) {
                    this._updateStart(s);
                } else {
                    this._updateExpansion(s);
                }

                this.currentDelay = Math.max(s.minDelay, this.currentDelay * s.acceleration);
                this.nextExpandTime = Math.max(1, Math.floor(this.currentDelay));
            }
        }

        this._updateLines(s);
        this._updateTendrils(s);

        // Check for completion
        if (this.frontier.length === 0 && this.lines.length === 0 && this.tendrils.length === 0) {
            this._swapAndStop();
            return;
        } 
        
        if (this.blocks.length > 8000) {
            this._swapAndStop();
            return;
        }
    }

    _updateTendrils(s) {
        // TENDRILS DISABLED
        // Use of tendrils caused blocks to spawn outside the main perimeter and corrupted the frontier
        // with stale entries, causing the expansion loop to stall.
        // This method is intentionally left empty to disable the feature.
        return;
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
                this.lines[i].alpha -= s.lineFadeSpeed;
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
                if (f.x >= 0 && f.y >= 0 && f.x < this.mapCols && f.y < this.g.rows) {
                    this.map[f.y * this.mapCols + f.x] &= ~2;
                }
                const l = this.frontier.pop();
                if (fIdx < this.frontier.length) {
                    this.frontier[fIdx] = l;
                }
            }
        }
    }

    _updateExpansion(s) {
        // CYCLE START: Merge previous new lines (turn them green)
        this.lines.forEach(l => l.isNew = false);

        // SCALING FIX: Burst count scales with frontier size to maintain visual speed
        // Tuned to 2.5% to provide a controlled but consistent expansion speed.
        let burstCount = Math.max(2, Math.ceil(this.frontier.length * 0.025));
        if (burstCount > 100) burstCount = 100; // Safety Cap
        
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
                if (f.x >= 0 && f.x < this.mapCols && f.y >= 0 && f.y < this.g.rows) {
                     const val = this.map[f.y * this.mapCols + f.x];
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
            if (winner.x >= 0 && winner.y >= 0 && winner.x < this.mapCols && winner.y < this.g.rows) {
                this.map[winner.y * this.mapCols + winner.x] &= ~2; // Clear Frontier Bit
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
                            if (tx >= 0 && ty >= 0 && tx < this.mapCols && ty < this.g.rows) this.map[ty * this.mapCols + tx] &= ~2;
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
                            if (tx >= 0 && ty >= 0 && tx < this.mapCols && ty < this.g.rows) this.map[ty * this.mapCols + tx] &= ~2;
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
                            if (tx >= 0 && ty >= 0 && tx < this.mapCols && ty < this.g.rows) this.map[ty * this.mapCols + tx] &= ~2;
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
                        if (extra.x >= 0 && extra.y >= 0 && extra.x < this.mapCols && extra.y < this.g.rows) this.map[extra.y * this.mapCols + extra.x] &= ~2;
                    }
                }
                // Remaining 20%: Single (winner only) - Do nothing extra

            }
        }
    }

    applyToGrid(grid) {
        // No grid overrides
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
            ctx.globalAlpha = l.alpha * masterAlpha;
            ctx.beginPath();
            
            // Two-Cycle Logic: New lines are Yellow (Perimeter), Old are Green (Code)
            if (l.isNew) {
                ctx.strokeStyle = '#FFFF00'; 
            } else {
                ctx.strokeStyle = '#00FF00'; 
            }
            
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