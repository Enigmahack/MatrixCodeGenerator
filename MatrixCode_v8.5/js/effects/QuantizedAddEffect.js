class QuantizedAddEffect extends QuantizedSequenceEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedAdd";
        this.active = false;
        
        this.configPrefix = "quantizedAdd";

        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.gridPitchChars = 4;
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation Sequence Data
        this.sequence = [[]];
        
        this.expansionPhase = 0;
        this.maskOps = [];
        this.editorHighlight = false;
    }

    trigger(force = false) {
        // Fix: If restarting while active and not yet swapped, commit the current state first.
        // Otherwise we revert to the pre-effect state because the overrides are cleared.
        if (this.active && !this.hasSwapped) {
            this._swapStates();
        }

        if (!super.trigger(force)) return false;
        
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.offsetX = 0.5; // Fraction of cell width
        this.offsetY = 0.5; // Fraction of cell height

        this._initShadowWorld();
        this.hasSwapped = false;

        // Flicker Prevention: Ensure renderGrid is initialized to 'Inactive' (-1)
        // super.trigger() calls _initLogicGrid which zeroes it (Active).
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }

    _initShadowWorld() {
        this.shadowGrid = new CellGrid(this.c);
        const d = this.c.derived;
        const s = this.c.state;
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
        
        // Pre-warm / Populate
        const sm = this.shadowSim.streamManager;
        sm.resize(this.shadowGrid.cols);

        // --- Dynamic Density Injection ---
        // Calculate target active streams based on configuration to match "Steady State".
        // This prevents the "Wall of Code" (too dense) and "Mass Despawning" (synchronized death) issues.

        // 1. Calculate Target Count
        // Spawn Interval (frames) = releaseInterval * cycleDuration
        const spawnInterval = Math.max(1, Math.floor((d.cycleDuration || 1) * (s.releaseInterval || 1)));
        // Spawn Rate (streams per frame)
        const spawnRate = (s.streamSpawnCount || 1) / spawnInterval;
        
        // Average Life (frames) = Rows * cycleDuration (approx time to traverse screen)
        // We use this to estimate how many streams exist on screen at any moment.
        const avgLifeFrames = this.shadowGrid.rows * (d.cycleDuration || 1);
        
        // Target Count = Rate * Life
        let targetStreamCount = Math.floor(spawnRate * avgLifeFrames);
        
        // Clamp to avoid extreme behaviors
        targetStreamCount = Math.min(targetStreamCount, this.shadowGrid.cols * 2); 
        targetStreamCount = Math.max(targetStreamCount, 5); // Ensure at least some activity
        
        // 2. Eraser Ratio
        const totalSpawns = (s.streamSpawnCount || 0) + (s.eraserSpawnCount || 0);
        const eraserChance = totalSpawns > 0 ? (s.eraserSpawnCount / totalSpawns) : 0;

        // 3. Smart Distribution
        const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        // Shuffle for random column selection
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }

        let spawned = 0;
        let colIdx = 0;
        const maxAttempts = targetStreamCount * 3; // Safety break
        let attempts = 0;

        while (spawned < targetStreamCount && attempts < maxAttempts) {
            attempts++;
            const col = columns[colIdx % columns.length];
            colIdx++;
            
            // Random Y Position
            const startY = Math.floor(Math.random() * this.shadowGrid.rows);
            const isEraser = Math.random() < eraserChance;
            
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            
            // Age Adjustment:
            // "Backward calculate" age as if the stream started at the top and fell to startY.
            // This effectively randomizes the 'remaining life' (visibleLen - age), 
            // preventing synchronized death/despawning.
            // Only add if the stream would still be alive at this position.
            if (startY < stream.visibleLen) {
                stream.age = startY;
                sm.addActiveStream(stream);
                spawned++;
            }
        }
    
        this.shadowSim.timeScale = 1.0;
        const warmupFrames = 400;
        this.shadowSimFrame = warmupFrames;
        
        for (let i = 0; i < warmupFrames; i++) {
            this.shadowSim.update(i);
        }
    }

    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        this.animFrame++;

        // 0. Update Shadow Simulation
        if (!this.hasSwapped) {
            this._updateShadowSim();
        }

        // 1. Lifecycle State Machine (Alpha Fading)
        const fadeInFrames = Math.max(1, s.quantizedAddFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedAddFadeFrames);
        const durationFrames = s.quantizedAddDurationSeconds * fps;
        
        const setAlpha = (val) => { this.alpha = Math.max(0, Math.min(1, val)); };

        if (this.state === 'FADE_IN') {
            this.timer++;
            setAlpha(this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.timer = 0;
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++;
            // Infinite duration in debug mode
            if (!this.debugMode && this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                // Swap State Trigger
                if (!this.hasSwapped) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            this.timer++;
            setAlpha(1.0 - (this.timer / fadeOutFrames));
            if (this.timer >= fadeOutFrames) {
                this.active = false;
                this.state = 'IDLE';
                this.alpha = 0.0;
                // window.removeEventListener('keydown', this._boundDebugHandler); // Handled by super or state transition? 
                // Super removes it in _handleDebugInput on Escape.
                // But if animation finishes naturally, we should remove it?
                // Super doesn't track natural finish. 
                // Let's remove it here to be safe.
                window.removeEventListener('keydown', this._boundDebugHandler);
                
                // Cleanup
                this.g.clearAllOverrides();
                this.shadowGrid = null;
                this.shadowSim = null;
            }
        }

        // 2. Animation Cycle (Grid Expansion)
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedAddSpeed !== undefined) ? s.quantizedAddSpeed : 1;
        // delayMult acts as a delay multiplier. 
        // User requested 1 to be 4x faster (0.25 multiplier) and 4 to be normal (1.0 multiplier).
        const effectiveInterval = baseDuration * (delayMult / 4.0);

        this.cycleTimer++;

        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            // cyclesCompleted is mostly for debug or legacy tracking now, but we keep it
            this.cyclesCompleted++;
            
            // Debug stepping gate
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        // 3. Animation Transition Management
        // Use config values for internal transitions
        const addDuration = Math.max(1, s.quantizedAddFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedAddFadeFrames || 0);

        if (this.maskOps) {
            for (const op of this.maskOps) {
                const age = this.animFrame - op.startFrame;
                const duration = (op.type === 'remove') ? removeDuration : addDuration;
                
                if (age < duration) {
                    this._maskDirty = true;
                    break;
                }
            }
        }
    }

    _updateShadowSim() {
        if (!this.shadowSim) return;
        
        // Flicker Prevention: If mask is dirty, we haven't rendered the new shape yet.
        // The renderGrid might be stale or empty. Skip override update this frame.
        if (this._maskDirty) return;

        // 1. Advance Simulation
        // Increment shadow time to ensure StreamManager continues spawning
        this.shadowSim.update(++this.shadowSimFrame);
        
        // 2. Compute "True Outside" Mask
        // Using renderGrid from the Sequence Effect logic
        // If logicGrid or renderGrid are not initialized yet, skip
        if (!this.renderGrid || !this.layout) return;

        const blocksX = Math.ceil(this.g.cols / this.layout.cellPitchX);
        const blocksY = Math.ceil(this.g.rows / this.layout.cellPitchY);
        
        // Compute True Outside (Flood fill from edges)
        const outsideMask = this._computeTrueOutside(blocksX, blocksY);
        
        // 3. Apply Overrides
        const sg = this.shadowGrid;
        const g = this.g;
        const l = this.layout;
        
        // Helper to check valid block
        const isValid = (bx, by) => (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY);

        // Iterate all blocks
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                const isOutside = outsideMask[idx] === 1;
                
                // Map block to cells
                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);
                
                for (let cy = startCellY; cy < endCellY; cy++) {
                    if (cy >= g.rows) continue;
                    for (let cx = startCellX; cx < endCellX; cx++) {
                        if (cx >= g.cols) continue;
                        
                        const cellIdx = cy * g.cols + cx;
                        
                        if (!isOutside) {
                            // INSIDE: Override with Shadow
                            g.overrideActive[cellIdx] = 3; // Full Override
                            g.overrideChars[cellIdx] = sg.chars[cellIdx];
                            g.overrideColors[cellIdx] = sg.colors[cellIdx];
                            g.overrideAlphas[cellIdx] = sg.alphas[cellIdx];
                            g.overrideGlows[cellIdx] = sg.glows[cellIdx];
                            g.overrideMix[cellIdx] = sg.mix[cellIdx];
                            g.overrideNextChars[cellIdx] = sg.nextChars[cellIdx];
                        } else {
                            // OUTSIDE: Restore Main
                            // Only clear if we were the ones who set it? 
                            // For safety, we just clear it.
                            if (g.overrideActive[cellIdx] === 3) {
                                g.overrideActive[cellIdx] = 0;
                            }
                        }
                    }
                }
            }
        }
    }
    
    _computeTrueOutside(blocksX, blocksY) {
        // 0 = Unknown/Inside, 1 = Outside
        const status = new Uint8Array(blocksX * blocksY);
        const queue = [];

        const add = (x, y) => {
            if (x < 0 || x >= blocksX || y < 0 || y >= blocksY) return;
            const idx = y * blocksX + x;
            // -1 in renderGrid means Inactive/Hole
            if (status[idx] === 0 && this.renderGrid[idx] === -1) { 
                status[idx] = 1;
                queue.push(idx);
            }
        };

        // Seed from borders
        for (let x = 0; x < blocksX; x++) { add(x, 0); add(x, blocksY - 1); }
        for (let y = 0; y < blocksY; y++) { add(0, y); add(blocksX - 1, y); }

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const cx = idx % blocksX;
            const cy = Math.floor(idx / blocksX);
            add(cx - 1, cy);
            add(cx + 1, cy);
            add(cx, cy - 1);
            add(cx, cy + 1);
        }
        return status;
    }

    _swapStates() {
        if (this.hasSwapped) return;
        
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
                g.maxDecays.set(sg.maxDecays);
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
                    
                    // Collect ALL streams that need to be serialized (Active + References)
                    const streamsToSerialize = new Set(shadowMgr.activeStreams);
                    
                    const addRefs = (arr) => {
                        for (const s of arr) {
                            if (s) streamsToSerialize.add(s);
                        }
                    };
                    addRefs(shadowMgr.lastStreamInColumn);
                    addRefs(shadowMgr.lastEraserInColumn);
                    addRefs(shadowMgr.lastUpwardTracerInColumn);

                    const streamMap = new Map();
                    const serializedActiveStreams = [];

                    // Serialize objects
                    for (const s of streamsToSerialize) {
                        const copy = {...s};
                        if (copy.holes instanceof Set) copy.holes = Array.from(copy.holes);
                        
                        streamMap.set(s, copy);
                        
                        // Only add to active list if it was originally active
                        if (shadowMgr.activeStreams.includes(s)) {
                            serializedActiveStreams.push(copy);
                        }
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
                    // Adjust spawn frame to match main sim time relative to shadow sim
                    const delta = frameOffset - (this.shadowSimFrame || 0);
                    state.nextSpawnFrame = shadowMgr.nextSpawnFrame + delta;

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
            
            // Clear overrides after swap (Main grid now HAS the content)
            this.g.clearAllOverrides();
            this.hasSwapped = true;
            
        } catch (e) {
            console.error("[QuantizedAdd] Swap failed:", e);
            this.g.clearAllOverrides();
            this.active = false;
        }
    }

    _processAnimationStep() {
        if (this.expansionPhase < this.sequence.length) {
            const step = this.sequence[this.expansionPhase];
            if (step) this._executeStepOps(step);
            this.expansionPhase++;
            this._maskDirty = true;
        }
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }


    _computeDistanceField(blocksX, blocksY) {
        const size = blocksX * blocksY;
        const dist = new Uint16Array(size);
        const maxDist = 999;
        
        // 1. Initialize
        // -1 in renderGrid means Inactive.
        // We initially assume everything is 'Far' (maxDist).
        // We will 'flood' 0s from the outside.
        dist.fill(maxDist);

        // Queue for BFS (finding Outer Void)
        // Storing indices
        const queue = [];
        const visitedVoid = new Uint8Array(size); // 0=Unvisited, 1=OuterVoid

        // 2. Seed Outer Void ONLY from Internal Holes
        // We do NOT seed from screen boundaries anymore, treating the screen as a window into an infinite grid.
        
        const addSeed = (bx, by) => {
            const idx = by * blocksX + bx;
            if (this.renderGrid[idx] === -1) {
                if (visitedVoid[idx] === 0) {
                    visitedVoid[idx] = 1;
                    dist[idx] = 0; // Outer Void is distance 0
                    queue.push(idx);
                }
            }
        };

        // Scan all blocks for holes
        for (let y = 0; y < blocksY; y++) {
            for (let x = 0; x < blocksX; x++) {
                addSeed(x, y);
            }
        }

        // 3. Flood Fill to find all connected Outer Void
        let head = 0;
        while(head < queue.length) {
            const idx = queue[head++];
            const cx = idx % blocksX;
            const cy = Math.floor(idx / blocksX);

            // Check Neighbors (N, S, E, W)
            const neighbors = [
                { x: cx, y: cy - 1 },
                { x: cx, y: cy + 1 },
                { x: cx - 1, y: cy },
                { x: cx + 1, y: cy }
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.x < blocksX && n.y >= 0 && n.y < blocksY) {
                    const nIdx = n.y * blocksX + n.x;
                    // If neighbor is Inactive and not visited, it's part of Outer Void
                    if (this.renderGrid[nIdx] === -1 && visitedVoid[nIdx] === 0) {
                        visitedVoid[nIdx] = 1;
                        dist[nIdx] = 0;
                        queue.push(nIdx);
                    }
                }
            }
        }

        // 4. Initialize Active Blocks Distance
        // Active blocks adjacent to Outer Void get Dist = 1.
        for (let y = 0; y < blocksY; y++) {
            for (let x = 0; x < blocksX; x++) {
                const idx = y * blocksX + x;
                if (this.renderGrid[idx] === -1) continue; // Skip Inactive

                let isEdge = false;
                
                // Check for adjacent Outer Void
                const nIdxs = [];
                if (x > 0) nIdxs.push(idx - 1);
                if (x < blocksX - 1) nIdxs.push(idx + 1);
                if (y > 0) nIdxs.push(idx - blocksX);
                if (y < blocksY - 1) nIdxs.push(idx + blocksX);
                
                for (const ni of nIdxs) {
                    if (dist[ni] === 0) { // Using dist=0 as marker for Outer Void
                        isEdge = true;
                        break;
                    }
                }
                
                // Note: We do NOT set isEdge=true for screen boundaries anymore.

                if (isEdge) {
                    dist[idx] = 1;
                }
            }
        }

        // 5. Distance Transform (Propagate inwards through Active blocks)
        // Forward Pass
        for (let y = 0; y < blocksY; y++) {
            for (let x = 0; x < blocksX; x++) {
                const i = y * blocksX + x;
                if (this.renderGrid[i] === -1) continue; // Don't propagate through holes
                if (dist[i] === 1) continue; // Already seeded

                let minVal = maxDist;
                if (x > 0 && this.renderGrid[i - 1] !== -1) minVal = Math.min(minVal, dist[i - 1]);
                if (y > 0 && this.renderGrid[i - blocksX] !== -1) minVal = Math.min(minVal, dist[i - blocksX]);

                if (minVal < maxDist) dist[i] = minVal + 1;
            }
        }

        // Backward Pass
        for (let y = blocksY - 1; y >= 0; y--) {
            for (let x = blocksX - 1; x >= 0; x--) {
                const i = y * blocksX + x;
                if (this.renderGrid[i] === -1) continue;
                if (dist[i] === 1) continue;

                let minVal = dist[i];
                if (x < blocksX - 1 && this.renderGrid[i + 1] !== -1) minVal = Math.min(minVal, dist[i + 1] + 1);
                if (y < blocksY - 1 && this.renderGrid[i + blocksX] !== -1) minVal = Math.min(minVal, dist[i + blocksX] + 1);

                dist[i] = minVal;
            }
        }
        
        return dist;
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedAddPerimeterThickness !== undefined) ? s.quantizedAddPerimeterThickness : 1.0;
        const lineWidthX = screenStepX * 0.25 * thickness;
        const lineWidthY = screenStepY * 0.25 * thickness;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY
        };

        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const fadeFrames = this.getConfig('FadeFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);
        const removeDuration = Math.max(1, fadeFrames);

        this.renderGrid.fill(-1);
        
        for (const op of this.maskOps) {
            if (op.startFrame && now < op.startFrame) continue;

            if (op.type === 'add' || op.type === 'addSmart') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = op.startFrame || 0;
                        }
                    }
                }
            } else if (op.type === 'removeBlock') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                         if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = -1;
                        }
                    }
                }
            }
        }

        // --- NEW: Compute Distance Field ---
        const distMap = this._computeDistanceField(blocksX, blocksY);
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            const idx = by * blocksX + bx;
            if (this.renderGrid[idx] === -1) return false;
            // Trail Cleanup Rule: Distance > 3 is hidden
            if (distMap[idx] > 3) return false;
            return true;
        };
        
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
             const activeStart = this.renderGrid[by * blocksX + bx];
             if (activeStart !== -1 && activeStart > time) return true;
             return false;
        };

        // --- PASS 1: Base Grid ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, op.ext, isRenderActive);
        }

        // --- PASS 1.5: Smart Perimeter ---
        for (const op of this.maskOps) {
            if (op.type !== 'addSmart') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    // Check visibility of SELF
                    if (!isRenderActive(bx, by)) continue;

                    const nN = isRenderActive(bx, by - 1);
                    const nS = isRenderActive(bx, by + 1);
                    const nW = isRenderActive(bx - 1, by);
                    const nE = isRenderActive(bx + 1, by);
                    
                    const isConnected = nN || nS || nW || nE;
                    this._addBlock({x:bx, y:by}, {x:bx, y:by}, isConnected);
                    // No need to pass isRenderActive here as we already checked self
                }
            }
        }
        
        // --- PASS 1.9: Block Erasure ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, false); // Erasures don't check visibility
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 2: Erasures (Faces) ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'remove') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            
            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                     if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                     // Only erase if block is actually visible? 
                     // If block is hidden, erasing it is redundant but harmless.
                     this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                }
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 3: Perimeter ---
        const boldLineWidthX = lineWidthX * 2.0; 
        const boldLineWidthY = lineWidthY * 2.0;
        
        // Helper: Returns TRUE if the neighbor is effectively "Active" (Solid).
        // Returns FALSE if the neighbor is "Inactive" (Hole).
        // We only draw a border if the neighbor is FALSE.
        // 1. Off-screen neighbors are treated as TRUE (Active) to keep edges open.
        // 2. Active-but-Hidden neighbors (dist > 3) are treated as TRUE (Active) to hide inner border.
        const hasActiveNeighbor = (nx, ny) => {
            if (nx < 0 || nx >= blocksX || ny < 0 || ny >= blocksY) return true;
            const nIdx = ny * blocksX + nx;
            return (this.renderGrid[nIdx] !== -1);
        };

        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                if (!isRenderActive(bx, by)) continue; // Visibility Check!

                const idx = by * blocksX + bx;
                const startFrame = this.renderGrid[idx];
                
                let opacity = 1.0;
                if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
                else if (startFrame !== -1) opacity = Math.min(1.0, (now - startFrame) / addDuration);
                ctx.globalAlpha = opacity;

                const nN = hasActiveNeighbor(bx, by - 1);
                const nS = hasActiveNeighbor(bx, by + 1);
                const nW = hasActiveNeighbor(bx - 1, by);
                const nE = hasActiveNeighbor(bx + 1, by);

                if (!nN) this._drawPerimeterFace(bx, by, 'N', boldLineWidthX, boldLineWidthY);
                if (!nS) this._drawPerimeterFace(bx, by, 'S', boldLineWidthX, boldLineWidthY);
                if (!nW) this._drawPerimeterFace(bx, by, 'W', boldLineWidthX, boldLineWidthY);
                if (!nE) this._drawPerimeterFace(bx, by, 'E', boldLineWidthX, boldLineWidthY);
            }
        }

        // --- PASS 4: Line Operations ---
        const lineOps = this.maskOps.filter(op => op.type === 'addLine' || op.type === 'removeLine');
        lineOps.sort((a, b) => (a.startFrame - b.startFrame));

        for (const op of lineOps) {
            let opacity = 1.0;
            const duration = (op.type === 'addLine') ? addDuration : removeDuration;
            
            if (op.type === 'addLine' && (fadeInFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.type === 'removeLine' && (fadeFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / duration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };

            if (op.type === 'addLine') {
                ctx.globalCompositeOperation = 'source-over';
                
                // Only draw line if block is visible
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isRenderActive(bx, by)) {
                            this._addBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face);
                        }
                    }
                }
            } else {
                ctx.globalCompositeOperation = 'destination-out';
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                        this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                    }
                }
            }
        }
        
        // --- PASS 6: Corner Cleanup ---
        // (Similar to Pass 2, probably safe to leave as is, or check visibility if strict)
        const cornerMap = new Map(); 
        const activeRemovals = this.maskOps.filter(op => {
            if (op.type !== 'remove' && op.type !== 'removeLine') return false;
            if (!op.startFrame) return false;
            return (now >= op.startFrame);
        });

        for (const op of activeRemovals) {
            if (!op.face) continue;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            const f = op.face.toUpperCase();
            const force = op.force;

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue; 
                    if (!force) {
                        if (f === 'N' && by === minY) continue;
                        if (f === 'S' && by === maxY) continue;
                        if (f === 'W' && bx === minX) continue;
                        if (f === 'E' && bx === maxX) continue;
                    }
                    
                    const idx = by * blocksX + bx;
                    let mask = cornerMap.get(idx) || 0;
                    if (f === 'N') mask |= 1;
                    else if (f === 'S') mask |= 2;
                    else if (f === 'E') mask |= 4;
                    else if (f === 'W') mask |= 8;
                    cornerMap.set(idx, mask);
                }
            }
        }

        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1.0; 
        for (const [idx, mask] of cornerMap) {
            const bx = idx % blocksX;
            const by = Math.floor(idx / blocksX);
            
            // Should check visibility here?
            // If block is invisible, removing its corner is irrelevant.
            
            if ((mask & 1) && (mask & 8)) this._removeBlockCorner(bx, by, 'NW');
            if ((mask & 1) && (mask & 4)) this._removeBlockCorner(bx, by, 'NE');
            if ((mask & 2) && (mask & 8)) this._removeBlockCorner(bx, by, 'SW');
            if ((mask & 2) && (mask & 4)) this._removeBlockCorner(bx, by, 'SE');
        }
        
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
    }

    _addBlock(blockStart, blockEnd, isExtending, visibilityCheck) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startX = Math.floor(blockStart.x * l.cellPitchX);
        const endX = Math.floor((blockEnd.x + 1) * l.cellPitchX);
        const startY = Math.floor(blockStart.y * l.cellPitchY);
        const endY = Math.floor((blockEnd.y + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        if (visibilityCheck) {
            // Checked mode: Draw individually
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;
            
            for (let by = rangeMinBy; by <= rangeMaxBy; by++) {
                for (let bx = rangeMinBx; bx <= rangeMaxBx; bx++) {
                    if (!visibilityCheck(bx, by)) continue;
                    
                    const cellX = Math.floor(bx * l.cellPitchX);
                    const cellY = Math.floor(by * l.cellPitchY);
                    const cx = l.screenOriginX + (cellX * l.screenStepX);
                    const cy = l.screenOriginY + (cellY * l.screenStepY);
                    
                    // Draw Block Rect
                    ctx.rect(cx - l.halfLineX, cy - l.halfLineY, l.lineWidthX, l.lineWidthY);
                                        
                    const xPos = l.screenOriginX + (cellX * l.screenStepX);
                    const yPos = l.screenOriginY + (cellY * l.screenStepY);
                    
                    // Draw Cross
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, l.screenStepY * l.cellPitchY + l.lineWidthY); // Vert
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.screenStepX * l.cellPitchX + l.lineWidthX, l.lineWidthY); // Horiz
                    
                    const w = l.screenStepX * l.cellPitchX;
                    const h = l.screenStepY * l.cellPitchY;
                    
                    // Vert segment
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
                    // Horiz segment
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
                }
            }
        } else {
            // Legacy mode (for Erasures or extending)
            if (isExtending) {
                let cy = l.screenOriginY + (startY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                cy = l.screenOriginY + (endY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                let cx = l.screenOriginX + (startX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
                cx = l.screenOriginX + (endX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
            } else {
                const rangeMinBx = blockStart.x;
                const rangeMaxBx = blockEnd.x;
                const rangeMinBy = blockStart.y;
                const rangeMaxBy = blockEnd.y;
                for (let bx = rangeMinBx; bx <= rangeMaxBx + 1; bx++) {
                    const cellX = Math.floor(bx * l.cellPitchX);
                    const cx = l.screenOriginX + (cellX * l.screenStepX);
                    const yPos = l.screenOriginY + (startY * l.screenStepY);
                    const h = (endY - startY) * l.screenStepY;
                    ctx.rect(cx - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
                }
                for (let by = rangeMinBy; by <= rangeMaxBy + 1; by++) {
                    const cellY = Math.floor(by * l.cellPitchY);
                    const cy = l.screenOriginY + (cellY * l.screenStepY);
                    const xPos = l.screenOriginX + (startX * l.screenStepX);
                    const w = (endX - startX) * l.screenStepX;
                    ctx.rect(xPos - l.halfLineX, cy - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
                }
            }
        }
        ctx.fill();
    }

    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();
        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();

        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                if (!force) {
                    if (f === 'N' && by === minY) continue;
                    if (f === 'S' && by === maxY) continue;
                    if (f === 'W' && bx === minX) continue;
                    if (f === 'E' && bx === maxX) continue;
                }
                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);
                const safety = 0.5;
                const safeX = l.halfLineX + safety; 
                const safeY = l.halfLineY + safety; 
                const inflate = 0.5; 

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                } else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                }
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;

        const s = this.c.state;
        const glowStrength = s.quantizedAddBorderIllumination || 0;
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); // Call super (generic args)

        // Ensure layout is calculated for debug mode even if glow is off
        if (this.debugMode && (!this.layout || this.maskCanvas.width !== width || this._maskDirty)) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        if (glowStrength > 0) {
            if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
                this._updateMask(width, height, s, d);
                this._maskDirty = false;
            }

            // 1. Render Text to Scratch Canvas
            this._updateGridCache(width, height, s, d);
            
            const scratchCtx = this.scratchCtx;
            scratchCtx.globalCompositeOperation = 'source-over';
            scratchCtx.clearRect(0, 0, width, height);

            // Draw cached grid
            scratchCtx.globalAlpha = this.alpha; 
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            scratchCtx.globalAlpha = 1.0;

            // 2. Apply Mask
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(this.maskCanvas, 0, 0);

            // 3. Composite
            ctx.save();
            if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
                ctx.canvas.style.mixBlendMode = 'plus-lighter';
            }
            ctx.globalCompositeOperation = 'lighter';
            
            // Colors
            const t = Math.min(1.0, glowStrength / 10.0);
            
            // Bright Green Logic
            const glowR = Math.floor(0 + (255 - 0) * t);
            const glowG = 255;
            const glowB = Math.floor(0 + (255 - 0) * t);
            const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;
            
            ctx.globalAlpha = 1.0;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
            ctx.drawImage(this.scratchCanvas, 0, 0);
            ctx.restore();
        }
    }
}