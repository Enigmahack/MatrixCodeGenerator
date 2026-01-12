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
        
        // Flicker Fix: Swap Transition State
        this.isSwapping = false;
        this.swapTimer = 0;
    }

    trigger(force = false) {
        // Fix: If restarting while active and not yet swapped, commit the current state first.
        if (this.active && !this.hasSwapped) {
            this._swapStates();
        }

        // Interruption Logic: Force-commit and stop other Quantized effects
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedRetract", "QuantizedExpansion"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    if (typeof eff._swapStates === 'function') {
                        if (!eff.hasSwapped) eff._swapStates();
                        eff.active = false;
                        eff.state = 'IDLE';
                    } else if (typeof eff._finishExpansion === 'function') {
                        eff._finishExpansion();
                    } else {
                        eff.active = false;
                    }
                }
            }
        }

        if (!super.trigger(force)) return false;
        
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.offsetX = 0.5;
        this.offsetY = 0.5;

        this._initShadowWorld();
        this.hasSwapped = false;
        this.isSwapping = false;

        // Ensure renderGrid is initialized
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        const d = this.c.derived;

        // --- Dynamic Density Injection ---
        const spawnInterval = Math.max(1, Math.floor((d.cycleDuration || 1) * (s.releaseInterval || 1)));
        const spawnRate = (s.streamSpawnCount || 1) / spawnInterval;
        const avgLifeFrames = this.shadowGrid.rows * (d.cycleDuration || 1);
        
        let targetStreamCount = Math.floor(spawnRate * avgLifeFrames);
        targetStreamCount = Math.min(targetStreamCount, this.shadowGrid.cols * 2); 
        targetStreamCount = Math.max(targetStreamCount, 5);
        
        const totalSpawns = (s.streamSpawnCount || 0) + (s.eraserSpawnCount || 0);
        const eraserChance = totalSpawns > 0 ? (s.eraserSpawnCount / totalSpawns) : 0;

        const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }

        let spawned = 0;
        let colIdx = 0;
        const maxAttempts = targetStreamCount * 3; 
        let attempts = 0;

        while (spawned < targetStreamCount && attempts < maxAttempts) {
            attempts++;
            const col = columns[colIdx % columns.length];
            colIdx++;
            
            const startY = Math.floor(Math.random() * this.shadowGrid.rows);
            const isEraser = Math.random() < eraserChance;
            
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            
            if (startY < stream.visibleLen) {
                stream.age = startY;
                sm.addActiveStream(stream);
                spawned++;
            }
        }
    
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

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedAddSpeed !== undefined) ? s.quantizedAddSpeed : 1;
        const effectiveInterval = baseDuration * (delayMult / 4.0);

        this.cycleTimer++;

        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        // NEW: Update Render Grid Logic immediately
        this._updateRenderGridLogic();

        // 2. Update Shadow Simulation & Apply Overrides
        if (!this.hasSwapped && !this.isSwapping) {
            this._updateShadowSim();
        } else if (this.isSwapping) {
            // Keep applying overrides during swap transition buffer
            this._updateShadowSim();
            
            this.swapTimer--;
            if (this.swapTimer <= 0) {
                // Transition Complete
                this.g.clearAllOverrides();
                this.isSwapping = false;
                this.hasSwapped = true;
                this.active = false;
                this.state = 'IDLE';
                
                // Cleanup
                this.shadowGrid = null;
                this.shadowSim = null;
                
                window.removeEventListener('keydown', this._boundDebugHandler);
            }
        }

        // 3. Lifecycle State Machine
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
            if (!this.debugMode && this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            if (!this.isSwapping) {
                this.timer++;
                setAlpha(1.0 - (this.timer / fadeOutFrames));
                if (this.timer >= fadeOutFrames) {
                    this.active = false;
                    this.state = 'IDLE';
                    this.alpha = 0.0;
                    window.removeEventListener('keydown', this._boundDebugHandler);
                    this.g.clearAllOverrides();
                    this.shadowGrid = null;
                    this.shadowSim = null;
                }
            }
        }

        // 4. Animation Transition Management
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

    _updateRenderGridLogic() {
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        
        const blocksX = Math.ceil(this.g.cols / cellPitchX);
        const blocksY = Math.ceil(this.g.rows / cellPitchY);
        const totalBlocks = blocksX * blocksY;

        if (!this.renderGrid || !this.barrierGrid || this.renderGrid.length !== totalBlocks) {
            this.renderGrid = new Int32Array(totalBlocks);
            this.barrierGrid = new Uint8Array(totalBlocks);
            this.renderGrid.fill(-1);
            this.barrierGrid.fill(0);
        } else {
            this.renderGrid.fill(-1);
            this.barrierGrid.fill(0);
        }

        if (!this.maskOps || this.maskOps.length === 0) return;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        for (const op of this.maskOps) {
            if (op.startFrame && this.animFrame < op.startFrame) continue;

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
                            const idx = by * blocksX + bx;
                            this.renderGrid[idx] = op.startFrame || 0;
                            this.barrierGrid[idx] = 1;
                        }
                    }
                }
            } else if (op.type === 'addLine') {
                // Lines are barriers but not render-active for borders
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.barrierGrid[by * blocksX + bx] = 1;
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
                            const idx = by * blocksX + bx;
                            this.renderGrid[idx] = -1;
                            this.barrierGrid[idx] = 0;
                        }
                    }
                }
            }
        }
        
        this._lastBlocksX = blocksX;
        this._lastBlocksY = blocksY;
        this._lastPitchX = cellPitchX;
        this._lastPitchY = cellPitchY;
    }

    _updateShadowSim() {
        if (!this.shadowSim) return;
        
        this.shadowSim.update(++this.shadowSimFrame);
        
        if (!this.renderGrid || !this._lastBlocksX) return;

        const blocksX = this._lastBlocksX;
        const blocksY = this._lastBlocksY;
        const pitchX = this._lastPitchX;
        const pitchY = this._lastPitchY;
        
        const outsideMask = this._computeTrueOutside(blocksX, blocksY);
        
        const sg = this.shadowGrid;
        const g = this.g;
        
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                const isOutside = outsideMask[idx] === 1;
                
                const startCellX = Math.floor(bx * pitchX);
                const startCellY = Math.floor(by * pitchY);
                const endCellX = Math.floor((bx + 1) * pitchX);
                const endCellY = Math.floor((by + 1) * pitchY);
                
                for (let cy = startCellY; cy < endCellY; cy++) {
                    if (cy >= g.rows) continue;
                    for (let cx = startCellX; cx < endCellX; cx++) {
                        if (cx >= g.cols) continue;
                        
                        const destIdx = cy * g.cols + cx;
                        
                        // Safety check for shadow grid bounds
                        if (cy >= sg.rows || cx >= sg.cols) continue;
                        const srcIdx = cy * sg.cols + cx;
                        
                        if (!isOutside) {
                            if (sg && sg.chars && srcIdx < sg.chars.length) {
                                g.overrideActive[destIdx] = 3; 
                                g.overrideChars[destIdx] = sg.chars[srcIdx];
                                g.overrideColors[destIdx] = sg.colors[srcIdx];
                                g.overrideAlphas[destIdx] = sg.alphas[srcIdx];
                                g.overrideGlows[destIdx] = sg.glows[srcIdx];
                                g.overrideMix[destIdx] = sg.mix[srcIdx];
                                g.overrideNextChars[destIdx] = sg.nextChars[srcIdx];
                            }
                        } else {
                            if (g.overrideActive[destIdx] === 3) {
                                g.overrideActive[destIdx] = 0;
                            }
                        }
                    }
                }
            }
        }
    }
    
    _computeTrueOutside(blocksX, blocksY) {
        const status = new Uint8Array(blocksX * blocksY);
        const queue = [];

        const add = (x, y) => {
            if (x < 0 || x >= blocksX || y < 0 || y >= blocksY) return;
            const idx = y * blocksX + x;
            // Check barrierGrid if available, otherwise fallback to renderGrid logic
            const isBarrier = this.barrierGrid ? (this.barrierGrid[idx] !== 0) : (this.renderGrid[idx] !== -1);
            
            if (status[idx] === 0 && !isBarrier) { 
                status[idx] = 1;
                queue.push(idx);
            }
        };

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
        if (this.hasSwapped || this.isSwapping) return;
        
        const result = this._commitShadowState();
        
        if (result === 'ASYNC') {
            this.isSwapping = true;
            this.swapTimer = 5; 
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
            this.hasSwapped = true;
            this.active = false;
        } else {
            // Failed
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
        // No grid overrides
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        
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

        const distMap = this._computeDistanceField(blocksX, blocksY);
        
        // Compute True Outside to mask internal borders (Hoisted)
        const outsideMap = this._computeTrueOutside(blocksX, blocksY);
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= blocksX || ny < 0 || ny >= blocksY) return false; // Screen edge is wall/inside for rendering purposes
            return outsideMap[ny * blocksX + nx] === 1;
        };
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            const idx = by * blocksX + bx;
            if (!this.renderGrid || this.renderGrid[idx] === -1) return false;
            if (distMap[idx] > 3) return false;
            return true;
        };
        
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
             if (!this.renderGrid) return false;
             const activeStart = this.renderGrid[by * blocksX + bx];
             if (activeStart !== -1 && activeStart > time) return true;
             return false;
        };

        const showInterior = (s.quantizedAddShowInterior !== undefined) ? s.quantizedAddShowInterior : false;

        // --- PASS 1: Base Grid (Interior) ---
        if (showInterior) {
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
        }

        // --- PASS 1.5: Smart Perimeter (Interior) ---
        if (showInterior) {
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
                        if (!isRenderActive(bx, by)) continue;
                        const nN = isRenderActive(bx, by - 1);
                        const nS = isRenderActive(bx, by + 1);
                        const nW = isRenderActive(bx - 1, by);
                        const nE = isRenderActive(bx + 1, by);
                        const isConnected = nN || nS || nW || nE;
                        
                        // FIX: Only draw if NOT connected (Isolated).
                        // Connected blocks (Interior) should be empty to prevent "Perimeter characters" inside.
                        if (!isConnected) {
                            this._addBlock({x:bx, y:by}, {x:bx, y:by}, false);
                        }
                    }
                }
            }
        }
        
        // --- ERASURE HELPER ---
        const runErasures = (targetCtx) => {
            const originalCtx = this.maskCtx;
            this.maskCtx = targetCtx;
            targetCtx.globalCompositeOperation = 'destination-out';
            
            // Pass 1.9: Block Erasure
            for (const op of this.maskOps) {
                if (op.type !== 'removeBlock') continue;
                let opacity = 1.0;
                if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
                else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
                targetCtx.globalAlpha = opacity;
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                this._addBlock(start, end, false); 
            }

            // Pass 2: Face Erasure
            for (const op of this.maskOps) {
                if (op.type !== 'remove') continue;
                let opacity = 1.0;
                if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
                else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
                targetCtx.globalAlpha = opacity;
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
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
            
            // Pass 4 (Remove Line)
             for (const op of this.maskOps) {
                if (op.type !== 'removeLine') continue;
                let opacity = 1.0;
                if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
                else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
                targetCtx.globalAlpha = opacity;
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
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
            
             // Pass 6: Corner Cleanup
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
            targetCtx.globalAlpha = 1.0; 
            for (const [idx, mask] of cornerMap) {
                const bx = idx % blocksX;
                const by = Math.floor(idx / blocksX);
                if ((mask & 1) && (mask & 8)) this._removeBlockCorner(bx, by, 'NW');
                if ((mask & 1) && (mask & 4)) this._removeBlockCorner(bx, by, 'NE');
                if ((mask & 2) && (mask & 8)) this._removeBlockCorner(bx, by, 'SW');
                if ((mask & 2) && (mask & 4)) this._removeBlockCorner(bx, by, 'SE');
            }

            targetCtx.globalCompositeOperation = 'source-over';
            this.maskCtx = originalCtx; // Restore
        };

        // Run Erasures on Interior
        runErasures(ctx);

        // --- PASS 3: Perimeter (Border) ---
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx; // Swap for helper
            
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;
            
            const batches = new Map();

            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    if (!isRenderActive(bx, by)) continue; 
                    const idx = by * blocksX + bx;
                    const startFrame = this.renderGrid[idx];
                    
                    // Check neighbors for True Outside status
                    const outN = isTrueOutside(bx, by - 1);
                    const outS = isTrueOutside(bx, by + 1);
                    const outW = isTrueOutside(bx - 1, by);
                    const outE = isTrueOutside(bx + 1, by);

                    if (!outN && !outS && !outW && !outE) continue; // No external border

                    let list = batches.get(startFrame);
                    if (!list) { list = []; batches.set(startFrame, list); }
                    
                    const faces = [];
                    // Retract logic based on Outside neighbors
                    if (outN) faces.push({dir: 'N', rS: outW, rE: outE});
                    if (outS) faces.push({dir: 'S', rS: outW, rE: outE});
                    if (outW) faces.push({dir: 'W', rS: outN, rE: outS});
                    if (outE) faces.push({dir: 'E', rS: outN, rE: outS});
                    
                    list.push({bx, by, faces});
                }
            }

            for (const [startFrame, items] of batches) {
                let opacity = 1.0;
                if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
                else if (startFrame !== -1) opacity = Math.min(1.0, (now - startFrame) / addDuration);
                
                if (opacity <= 0.001) continue;

                pCtx.globalAlpha = opacity;
                pCtx.fillStyle = '#FFFFFF';
                pCtx.beginPath();
                
                for (const item of items) {
                    for (const face of item.faces) {
                        this._addPerimeterFacePath(item.bx, item.by, face, boldLineWidthX, boldLineWidthY);
                    }
                }
                pCtx.fill();
            }

            // --- PASS 3.5: VOID CLEANUP ---
            // Explicitly erase "True Outside" blocks to prevent any spillover artifacts
            pCtx.globalCompositeOperation = 'destination-out';
            pCtx.fillStyle = '#FFFFFF';
            pCtx.beginPath();
            
            const l = this.layout;

            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    if (isTrueOutside(bx, by)) {
                        const x = l.screenOriginX + (bx * l.cellPitchX * l.screenStepX);
                        const y = l.screenOriginY + (by * l.cellPitchY * l.screenStepY);
                        const w = l.cellPitchX * l.screenStepX;
                        const h = l.cellPitchY * l.screenStepY;
                        // Slightly inflate to ensure clean edge clipping
                        pCtx.rect(x - 0.1, y - 0.1, w + 0.2, h + 0.2); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
            
            this.maskCtx = originalCtx; // Restore
            
            // Run Erasures on Perimeter
            runErasures(pCtx);
        }

        // --- PASS 4: Add Lines (Interior) ---
        if (showInterior) {
            for (const op of this.maskOps) {
                if (op.type !== 'addLine') continue;
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
                        if (isRenderActive(bx, by)) {
                            // Check if this face is on the Perimeter (True Outside)
                            let nx = bx, ny = by;
                            const f = op.face ? op.face.toUpperCase() : '';
                            if (f === 'N') ny--;
                            else if (f === 'S') ny++;
                            else if (f === 'W') nx--;
                            else if (f === 'E') nx++;
                            
                            // If neighbor is True Outside, Pass 3 draws a Border here.
                            // Skip Pass 4 (Interior Line) to avoid overlap (Purple/Pink artifacts).
                            if (isTrueOutside(nx, ny)) continue;

                            this._addBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face);
                        }
                    }
                }
            }
        }
    }

    _addPerimeterFacePath(bx, by, faceObj, widthX, widthY) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startCellX = Math.floor(bx * l.cellPitchX);
        const startCellY = Math.floor(by * l.cellPitchY);
        const endCellX = Math.floor((bx + 1) * l.cellPitchX);
        const endCellY = Math.floor((by + 1) * l.cellPitchY);

        const hx = widthX / 2;
        const hy = widthY / 2;
        
        const face = faceObj.dir;
        const rS = faceObj.rS;
        const rE = faceObj.rE;

        // Inner Stroke Offsets: Shift rects so they are fully inside the block
        // This prevents the border mask from spilling into empty neighbors and revealing "ghost" characters (dots).

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            let x = l.screenOriginX + (startCellX * l.screenStepX); // Start at Left Edge (Inner)
            // x was (center - hx). Inner is (center + hx)? No.
            // ScreenX is (startCellX...). This IS the Left Edge.
            // Previous logic: l.screenOriginX + ... - hx. (Centered on edge).
            // Inner logic: Start at edge. No -hx.
            // Wait. We need to handle the stroke width.
            // N face is Horizontal. We draw it at the Top Edge.
            // Y position: cy. We want it to span cy to cy + widthY.
            // X position: Same as before (span of block).
            
            // Re-calc layout for Inner Mode
            const topY = cy; 
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;

            drawY = topY; // Top edge, draw downwards
            drawH = widthY;
            
            // X spans full width, but Retraction modifies it
            drawX = leftX;
            drawW = rightX - leftX; // Full block width
            
            // Retraction Logic (Same as before, but relative to Inner positioning)
            // If rS (West neighbor outside), we retracted from the corner.
            // If Inner, we are already inside. Do we still need retraction?
            // Yes, to avoid overlap with W face at the corner.
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'S') {
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            
            drawY = bottomY - widthY; // Bottom edge, draw upwards (Inner)
            drawH = widthY;
            
            drawX = leftX;
            drawW = rightX - leftX;
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'W') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            
            drawX = leftX; // Left edge, draw rightwards (Inner)
            drawW = widthX;
            
            drawY = topY;
            drawH = bottomY - topY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'E') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            
            drawX = rightX - widthX; // Right edge, draw leftwards (Inner)
            drawW = widthX;
            
            drawY = topY;
            drawH = bottomY - topY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
            
            ctx.rect(drawX, drawY, drawW, drawH);
        }
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
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;
            
            for (let by = rangeMinBy; by <= rangeMaxBy; by++) {
                for (let bx = rangeMinBx; bx <= rangeMaxBx; bx++) {
                    if (!visibilityCheck(bx, by)) continue;
                    
                    const cellX = Math.floor(bx * l.cellPitchX);
                    const cellY = Math.floor(by * l.cellPitchY);
                    // const cx = l.screenOriginX + (cellX * l.screenStepX); // Unused
                    // const cy = l.screenOriginY + (cellY * l.screenStepY); // Unused
                    
                    // ctx.rect(cx - l.halfLineX, cy - l.halfLineY, l.lineWidthX, l.lineWidthY); // REDUNDANT DOT REMOVED
                                        
                    const xPos = l.screenOriginX + (cellX * l.screenStepX);
                    const yPos = l.screenOriginY + (cellY * l.screenStepY);
                    
                    const w = l.screenStepX * l.cellPitchX;
                    const h = l.screenStepY * l.cellPitchY;
                    
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
                }
            }
        } else {
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
        
        // Colors from config (Green Default)
        const showInterior = (s.quantizedAddShowInterior !== undefined) ? s.quantizedAddShowInterior : false;
        const borderColor = s.quantizedAddBorderColor || "#00FF00";
        const interiorColor = s.quantizedAddInteriorColor || "#00FF00";
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); 

        if (this.debugMode && (!this.layout || this.maskCanvas.width !== width || this._maskDirty)) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        if (glowStrength > 0) {
            if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
                this._updateMask(width, height, s, d);
                this._maskDirty = false;
            }

            this._updateGridCache(width, height, s, d); // Draws White
            
            const scratchCtx = this.scratchCtx;
            
            const renderLayer = (maskCanvas, color, solid = false, compositeOp = 'lighter') => {
                if (!maskCanvas) return;
                
                scratchCtx.globalCompositeOperation = 'source-over';
                scratchCtx.clearRect(0, 0, width, height);

                if (solid) {
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.fillStyle = color;
                    scratchCtx.fillRect(0, 0, width, height);
                } else {
                    // 1. Draw Grid Structure (White)
                    scratchCtx.globalAlpha = this.alpha;
                    scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
                    
                    // 2. Colorize (Source-In)
                    scratchCtx.globalCompositeOperation = 'source-in';
                    scratchCtx.fillStyle = color;
                    scratchCtx.fillRect(0, 0, width, height);
                }
                
                // 3. Mask (Destination-In)
                scratchCtx.globalCompositeOperation = 'destination-in';
                scratchCtx.globalAlpha = 1.0;
                scratchCtx.drawImage(maskCanvas, 0, 0);
                
                // 4. Draw to Screen
                ctx.save();
                if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
                    ctx.canvas.style.mixBlendMode = 'plus-lighter';
                }
                ctx.globalCompositeOperation = compositeOp; // Use custom blend mode
                ctx.globalAlpha = 1.0;
                
                // Apply colored glow
                ctx.shadowColor = color;
                ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
                ctx.drawImage(this.scratchCanvas, 0, 0);
                ctx.restore();
            };

            // Render Interior Layer (Text, Additive for Glow)
            renderLayer(this.maskCanvas, interiorColor, false, 'lighter');
            
            // Render Border Layer (Solid, Opaque Overwrite to hide artifacts)
            if (this.perimeterMaskCanvas) {
                renderLayer(this.perimeterMaskCanvas, borderColor, true, 'source-over');
            }
        }
    }

    renderDebug(ctx, d) {
        // Delegate to main render to ensure Green visuals in Editor
        this.render(ctx, d);
    }
}