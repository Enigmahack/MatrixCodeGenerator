class QuantizedGenerateEffectV2 extends QuantizedSequenceEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedGenerateV2";
        this.active = false;
        
        this.configPrefix = "quantizedGenerateV2";

        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation Sequence Data
        this.sequence = [[]]; 
        
        this.expansionPhase = 0;
        this.maskOps = [];
        this.editorHighlight = false;
        
        // Layer Grids
        this.renderGridL1 = null;
        this.renderGridL2 = null;
        
        // Flicker Fix: Swap Transition State
        this.isSwapping = false;
        this.swapTimer = 0;
        
        this._renderGridDirty = true;
        
        // Logic Grid Scaling
        this.logicScale = 1.2;
    }

    trigger(force = false) {
        if (this.active) {
            if (this.c.notifications) {
                this.c.notifications.show("Quantized Generate V2 is already running.", "info");
            }
            return false;
        }

        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom", "QuantizedGenerate"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    return false;
                }
            }
        }

        if (!super.trigger(force)) return false;
        
        if (typeof QuantizedSequenceGeneratorV2 !== 'undefined') {
            const generator = new QuantizedSequenceGeneratorV2();
            const bs = this.getBlockSize();
            const innerLineDuration = (this.c.state.quantizedGenerateV2InnerLineDuration !== undefined) ? this.c.state.quantizedGenerateV2InnerLineDuration : 1;
            // Reduced maxSteps from 20000 to 2000 to prevent generation lag
            this.sequence = generator.generate(this.logicGridW, this.logicGridH, 2000, { 
                innerLineDuration,
                blockWidth: bs.w,
                blockHeight: bs.h
            });
        } else {
            console.error("QuantizedSequenceGeneratorV2 is not defined!");
            return false;
        }

        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 1.0; // Start visible
        this.offsetX = 0.5; 
        this.offsetY = 0.5;
        
        // Force immediate first step execution
        if (this.sequence.length > 0) {
            this._executeStepOps(this.sequence[0]);
            this.expansionPhase = 1;
        }

        this._initShadowWorld();
        this.hasSwapped = false;
        this.isSwapping = false;
        this._renderGridDirty = true;

        if (this.renderGrid) this.renderGrid.fill(-1);
        
        // Ensure Layer Grids are initialized
        if (this.logicGridW && this.logicGridH) {
             const size = this.logicGridW * this.logicGridH;
             if (!this.renderGridL1 || this.renderGridL1.length !== size) {
                 this.renderGridL1 = new Int32Array(size);
             }
             if (!this.renderGridL2 || this.renderGridL2.length !== size) {
                 this.renderGridL2 = new Int32Array(size);
             }
        }
        
        if (this.renderGridL1) this.renderGridL1.fill(-1);
        if (this.renderGridL2) this.renderGridL2.fill(-1);

        return true;
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        const d = this.c.derived;

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
    
        const warmupFrames = 0; 
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

        // Speed = Frames between steps
        const speedFrames = (s.quantizedGenerateV2Speed !== undefined) ? Math.max(1, Math.round(s.quantizedGenerateV2Speed)) : 1;

        this.cycleTimer++;

        if (this.cycleTimer >= speedFrames) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        if (this._renderGridDirty) {
            this._updateRenderGridLogic();
            this._renderGridDirty = false;
        }

        if (!this.hasSwapped && !this.isSwapping) {
            this._updateShadowSim();
        } else if (this.isSwapping) {
            this._updateShadowSim();
            
            this.swapTimer--;
            if (this.swapTimer <= 0) {
                this.g.clearAllOverrides();
                this.isSwapping = false;
                this.hasSwapped = true;
                this.shadowGrid = null;
                this.shadowSim = null;
            }
        }

        const fadeInFrames = Math.max(1, s.quantizedGenerateV2FadeInFrames || 0);
        const fadeOutFrames = Math.max(1, s.quantizedGenerateV2FadeFrames || 0);
        const durationFrames = (s.quantizedGenerateV2DurationSeconds || 0) * fps;
        
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
            const sequenceComplete = (this.expansionPhase >= this.sequence.length);
            
            // STRICT DURATION ENFORCEMENT
            // Do not end early just because sequence is complete. 
            // Hold the state until the configured duration expires.
            if (this.timer >= durationFrames) {
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

        const addDuration = Math.max(1, s.quantizedGenerateV2FadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedGenerateV2FadeFrames || 0);

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

    _processAnimationStep() {
        if (this.expansionPhase < this.sequence.length) {
            const step = this.sequence[this.expansionPhase];
            if (step) this._executeStepOps(step);
            this.expansionPhase++;
            this._maskDirty = true;
            this._renderGridDirty = true;
        }
    }

    _executeStepOps(step) {
        // Custom execution for Shift + Layer logic
        const now = this.animFrame;
        
        for (const opData of step) {
            const op = opData[0];
            const args = opData.slice(1);
            
            if (op === 'shift') {
                const [dir, layer, rMin, rMax, amount, threshold] = args;
                // Shift existing ops
                for (const mOp of this.maskOps) {
                    // Check Layer and Lock Status
                    if (mOp.layer !== layer) continue;
                    if (mOp.locked) continue; // Locked blocks do not move
                    
                    // Check Range and Direction
                    let intersects = false;
                    let onPushSide = false;
                    
                    if (dir === 'N' || dir === 'S') {
                        // Vertical Push. Range is X.
                        // Overlap Check
                        const opMinX = Math.min(mOp.x1, mOp.x2);
                        const opMaxX = Math.max(mOp.x1, mOp.x2);
                        intersects = (opMaxX >= rMin && opMinX <= rMax);
                        
                        if (dir === 'N') onPushSide = (Math.max(mOp.y1, mOp.y2) <= threshold); 
                        else onPushSide = (Math.min(mOp.y1, mOp.y2) >= threshold);
                        
                        if (intersects && onPushSide) {
                            const delta = (dir === 'N') ? -amount : amount;
                            mOp.y1 += delta;
                            mOp.y2 += delta;
                        }
                    } else {
                        // Horizontal Push. Range is Y.
                        const opMinY = Math.min(mOp.y1, mOp.y2);
                        const opMaxY = Math.max(mOp.y1, mOp.y2);
                        intersects = (opMaxY >= rMin && opMinY <= rMax);
                        
                        if (dir === 'W') onPushSide = (Math.max(mOp.x1, mOp.x2) <= threshold);
                        else onPushSide = (Math.min(mOp.x1, mOp.x2) >= threshold);
                        
                        if (intersects && onPushSide) {
                            const delta = (dir === 'W') ? -amount : amount;
                            mOp.x1 += delta;
                            mOp.x2 += delta;
                        }
                    }
                }
            } else if (op === 'mergeLayers') {
                const [srcLayer, destLayer] = args;
                const srcGrid = (srcLayer === 1) ? this.renderGridL2 : this.renderGridL1;
                const destGrid = (destLayer === 1) ? this.renderGridL2 : this.renderGridL1;
                
                if (srcGrid && destGrid) {
                    for (let i = 0; i < srcGrid.length; i++) {
                        if (srcGrid[i] !== -1) {
                            destGrid[i] = srcGrid[i]; // Copy timestamp
                            srcGrid[i] = -1; // Clear source
                        }
                    }
                }
                
                // Update active maskOps: Move to new layer and LOCK
                for (const mOp of this.maskOps) {
                    if (mOp.layer === srcLayer) {
                        mOp.layer = destLayer;
                        mOp.locked = true; // Lock position after merge
                    }
                }
            } else if (op === 'addRect') {
                const [x, y, x2, y2, layer] = args;
                this.maskOps.push({
                    type: 'add',
                    x1: x, y1: y, x2: x2, y2: y2,
                    layer: layer,
                    ext: false,
                    startFrame: now
                });
            } else if (op === 'addLine') {
                const [x, y, face, layer] = args;
                this.maskOps.push({
                    type: 'addLine',
                    x1: x, y1: y, x2: x, y2: y,
                    face: face,
                    layer: layer,
                    startFrame: now,
                    startPhase: this.expansionPhase,
                    fading: false
                });
            } else if (op === 'removeLine') {
                const [x, y, face, layer] = args;
                
                // Trigger Fade Out
                for (const mOp of this.maskOps) {
                    if (mOp.type === 'addLine' && 
                        mOp.layer === layer &&
                        mOp.face === face &&
                        mOp.x1 === x && mOp.y1 === y &&
                        !mOp.fading) {
                        
                        mOp.fading = true;
                        mOp.fadeStart = now;
                    }
                }
            } else if (op === 'debugInternalCount') {
                this.debugInternalCount = args[0];
            }
        }
    }

    _updateRenderGridLogic() {
        if (!this.logicGridW || !this.logicGridH) return;

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const totalBlocks = blocksX * blocksY;

        // Init/Reset Grids
        if (!this.renderGrid || this.renderGrid.length !== totalBlocks || 
            !this.renderGridL1 || this.renderGridL1.length !== totalBlocks ||
            !this.renderGridL2 || this.renderGridL2.length !== totalBlocks) {
            
            this.renderGrid = new Int32Array(totalBlocks);
            this.renderGridL1 = new Int32Array(totalBlocks);
            this.renderGridL2 = new Int32Array(totalBlocks);
        }
        
        this.renderGrid.fill(-1);
        this.renderGridL1.fill(-1);
        this.renderGridL2.fill(-1);

        if (!this.maskOps || this.maskOps.length === 0) return;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        for (const op of this.maskOps) {
            if (op.startFrame && this.animFrame < op.startFrame) continue;

            if (op.type === 'add') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.max(0, Math.min(start.x, end.x));
                const maxX = Math.min(blocksX - 1, Math.max(start.x, end.x));
                const minY = Math.max(0, Math.min(start.y, end.y));
                const maxY = Math.min(blocksY - 1, Math.max(start.y, end.y));
                
                const gridToUpdate = (op.layer === 1) ? this.renderGridL2 : this.renderGridL1; 
                // Default to L1 if layer undefined
                // Wait, logic says: "One of them will always be on top".
                // Let's say layer 0 = Top, layer 1 = Bottom.
                // Or user defined.
                // Assuming op.layer is 0 or 1.
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        const idx = by * blocksX + bx;
                        gridToUpdate[idx] = op.startFrame || 0;
                        this.renderGrid[idx] = op.startFrame || 0; // Union Grid
                    }
                }
            }
        }
        
        this._lastBlocksX = blocksX;
        this._lastBlocksY = blocksY;
    }

    _computeTrueOutsideForGrid(blocksX, blocksY, grid) {
        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        const status = new Uint8Array(size);
        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && grid[idx] === -1) { 
                status[idx] = 1;
                queue[tail++] = idx;
            }
        };

        for (let x = 0; x < blocksX; x++) { 
            add(x); 
            add((blocksY - 1) * blocksX + x); 
        }
        for (let y = 1; y < blocksY - 1; y++) {
            add(y * blocksX); 
            add(y * blocksX + (blocksX - 1)); 
        }

        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % blocksX;
            const cy = (idx / blocksX) | 0;
            
            if (cy > 0) add(idx - blocksX);
            if (cy < blocksY - 1) add(idx + blocksX);
            if (cx > 0) add(idx - 1);
            if (cx < blocksX - 1) add(idx + 1);
        }
        return status;
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedGenerateV2PerimeterThickness !== undefined) ? s.quantizedGenerateV2PerimeterThickness : 1.0;
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
        const addDuration = Math.max(1, fadeInFrames);

        const scaledW = this.logicGridW || blocksX;
        const scaledH = this.logicGridH || blocksY;
        const offX = Math.floor((scaledW - blocksX) / 2);
        const offY = Math.floor((scaledH - blocksY) / 2);
        this.layout.offX = offX;
        this.layout.offY = offY;

        // Compute Outside Maps for Each Layer
        const outsideMapL1 = this._computeTrueOutsideForGrid(scaledW, scaledH, this.renderGridL1);
        const outsideMapL2 = this._computeTrueOutsideForGrid(scaledW, scaledH, this.renderGridL2);
        const outsideMapUnion = this._computeTrueOutsideForGrid(scaledW, scaledH, this.renderGrid);
        
        const isTrueOutsideL1 = (nx, ny) => {
            if (nx < 0 || nx >= scaledW || ny < 0 || ny >= scaledH) return true;
            return outsideMapL1[ny * scaledW + nx] === 1;
        };
        const isTrueOutsideL2 = (nx, ny) => {
             if (nx < 0 || nx >= scaledW || ny < 0 || ny >= scaledH) return true;
             return outsideMapL2[ny * scaledW + nx] === 1;
        };
        
        const isRenderActiveL1 = (bx, by) => {
            if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
            return this.renderGridL1[by * scaledW + bx] !== -1;
        };
        const isRenderActiveL2 = (bx, by) => {
             if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
             return this.renderGridL2[by * scaledW + bx] !== -1;
        };


        // --- PASS 1: Base Grid (Interior) ---
        // Union for masking logic
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Draw Union mask
            this._addBlock(start, end, op.ext, null); 
        }

        // --- PASS 3: Perimeter (Border) ---
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx; 
            
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;
            
            // Draw L2 Borders (Bottom Layer)
            this._renderPerimeterLayer(pCtx, this.renderGridL2, isRenderActiveL2, isTrueOutsideL2, scaledW, scaledH, offX, offY, boldLineWidthX, boldLineWidthY, now, addDuration);

            // Draw L1 Borders (Top Layer)
            this._renderPerimeterLayer(pCtx, this.renderGridL1, isRenderActiveL1, isTrueOutsideL1, scaledW, scaledH, offX, offY, boldLineWidthX, boldLineWidthY, now, addDuration);
            
            this.maskCtx = originalCtx; 
        }

        // --- PASS 4: Add Lines (Interior) ---
        if (lCtx) {
             const originalCtx = this.maskCtx;
             this.maskCtx = lCtx;
             lCtx.fillStyle = '#FFFFFF';
             
             // For Lines, we need to respect their layer
             this._renderLinesLayer(lCtx, this.renderGridL1, isRenderActiveL1, isTrueOutsideL1, 0, scaledW, scaledH, offX, offY, now, addDuration);
             this._renderLinesLayer(lCtx, this.renderGridL2, isRenderActiveL2, isTrueOutsideL2, 1, scaledW, scaledH, offX, offY, now, addDuration);
             
             this.maskCtx = originalCtx;
        }
        
        // --- PASS 3.5: VOID CLEANUP ---
        // Clean up using Union Map to ensure edges are sharp against void
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx;
            pCtx.globalCompositeOperation = 'destination-out';
            pCtx.fillStyle = '#FFFFFF';
            pCtx.beginPath();
            
            const l = this.layout;
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    const idx = (by + offY) * scaledW + (bx + offX);
                    if (outsideMapUnion[idx] === 1) {
                         const x = l.screenOriginX + (bx * l.cellPitchX * l.screenStepX);
                         const y = l.screenOriginY + (by * l.cellPitchY * l.screenStepY);
                         const w = l.cellPitchX * l.screenStepX;
                         const h = l.cellPitchY * l.screenStepY;
                         pCtx.rect(x - 0.1, y - 0.1, w + 0.2, h + 0.2); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
            this.maskCtx = originalCtx;
        }
    }
    
    _renderPerimeterLayer(ctx, grid, isActive, isOutside, blocksX, blocksY, offX, offY, lwX, lwY, now, addDuration) {
         // Merge Delay Logic
         const s = this.c.state;
         const d = this.c.derived;
         const mergeDelayEnabled = s.quantizedGenerateV2MergeDelay;
         
         const speedFrames = (s.quantizedGenerateV2Speed !== undefined) ? Math.max(1, Math.round(s.quantizedGenerateV2Speed)) : 1;
         
         // Wait 1.5 Steps before merging
         const mergeHorizon = mergeDelayEnabled ? (speedFrames * 1.5) : 0;

         const batches = new Map();
         
         for(let by = 0; by < blocksY; by++) {
             for(let bx = 0; bx < blocksX; bx++) {
                 if (!isActive(bx, by)) continue;
                 
                 const idx = by * blocksX + bx;
                 const startFrame = grid[idx];
                 const isUnmerged = mergeDelayEnabled && ((now - startFrame) < mergeHorizon);

                 const checkFace = (nx, ny) => {
                     // 1. If neighbor is Void, we ALWAYS have a border.
                     if (isOutside(nx, ny)) return true;
                     
                     // 2. If merge delay is disabled, internal borders are gone.
                     if (!mergeDelayEnabled) return false;
                     
                     // 3. If I am already "Merged" (Old), I only show border to Void.
                     if (!isUnmerged) return false;
                     
                     // 4. I am "New". Check Neighbor.
                     // If neighbor is not active (handled by isOutside check above usually, but just in case)
                     if (!isActive(nx, ny)) return true;
                     
                     // Neighbor is Active.
                     const nIdx = ny * blocksX + nx;
                     const nStart = grid[nIdx];
                     
                     // Draw border if neighbor is OLDER or NEWER (Different Batch)
                     // Actually, usually we only draw against OLDER to avoid double drawing?
                     // Or just draw if they are different.
                     // User said: "New block... merges with their neighbor".
                     // If I am New, I draw border against Old.
                     return (nStart !== startFrame);
                 };

                 // Check 4 faces
                 const outN = checkFace(bx, by - 1);
                 const outS = checkFace(bx, by + 1);
                 const outW = checkFace(bx - 1, by);
                 const outE = checkFace(bx + 1, by);
                 
                 if (!outN && !outS && !outW && !outE) continue;
                 
                 // For corner/endcap connectivity (rS, rE), we need to know if perpendicular neighbors are "bordering"
                 // Simplification: Use isOutside for corner caps to keep it clean, or use checkFace recursively?
                 // Using checkFace recursively might be expensive/complex.
                 // Let's stick to physical outside for corner caps to ensure outline continuity, 
                 // and just draw the straight segments for internal divides.
                 
                 const rS_N = isOutside(bx - 1, by); // West neighbor is void?
                 const rE_N = isOutside(bx + 1, by); // East neighbor is void?
                 
                 // Actually, for internal borders, we usually want flat ends, not corners.
                 // So maybe strict isOutside is better for rS/rE.
                 
                 let list = batches.get(startFrame);
                 if (!list) { list = []; batches.set(startFrame, list); }
                 
                 const faces = [];
                 if (outN) faces.push({dir: 'N', rS: isOutside(bx-1, by), rE: isOutside(bx+1, by)});
                 if (outS) faces.push({dir: 'S', rS: isOutside(bx-1, by), rE: isOutside(bx+1, by)});
                 if (outW) faces.push({dir: 'W', rS: isOutside(bx, by-1), rE: isOutside(bx, by+1)});
                 if (outE) faces.push({dir: 'E', rS: isOutside(bx, by-1), rE: isOutside(bx, by+1)});
                 
                 list.push({bx, by, faces});
             }
         }
         
         for (const [startFrame, items] of batches) {
             let opacity = 1.0;
             if (addDuration > 1 && startFrame !== -1) opacity = Math.min(1.0, (now - startFrame) / addDuration);
             ctx.globalAlpha = opacity;
             ctx.beginPath();
             for(const item of items) {
                 for(const face of item.faces) {
                     this._addPerimeterFacePath(ctx, item.bx, item.by, face, lwX, lwY);
                 }
             }
             ctx.fill();
         }
    }

    _renderLinesLayer(ctx, grid, isActive, isOutside, targetLayer, blocksX, blocksY, offX, offY, now, addDuration) {
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        const l = this.layout;
        const fadeOutDuration = addDuration; // Symmetry
        
        // Lazy cleanup
        for (let i = this.maskOps.length - 1; i >= 0; i--) {
            const op = this.maskOps[i];
            if (op.fading && (now - op.fadeStart > fadeOutDuration)) {
                this.maskOps.splice(i, 1);
            }
        }
        
        for (const op of this.maskOps) {
             if (op.type !== 'addLine') continue;
             if (op.layer !== targetLayer && op.layer !== undefined) continue;
             
             // ... Op rendering logic ...
             // Simplified: just render active lines for this layer
             const start = { x: cx + op.x1, y: cy + op.y1 };
             const end = { x: cx + op.x2, y: cy + op.y2 };
             const minX = Math.min(start.x, end.x);
             const maxX = Math.max(start.x, end.x);
             const minY = Math.min(start.y, end.y);
             const maxY = Math.max(start.y, end.y);
             
             for (let by = minY; by <= maxY; by++) {
                 for (let bx = minX; bx <= maxX; bx++) {
                     if (!isActive(bx, by)) continue;
                     
                     // Skip lines on perimeter (already handled by border)
                     // Check neighbors in THIS layer
                     let nx = bx, ny = by;
                     const f = op.face ? op.face.toUpperCase() : '';
                     if (f === 'N') ny--; else if (f === 'S') ny++; else if (f === 'W') nx--; else if (f === 'E') nx++;
                     
                     if (isOutside(nx, ny)) continue;
                     
                     let opacity = 1.0;
                     if (op.fading) {
                         opacity = Math.max(0, 1.0 - (now - op.fadeStart) / fadeOutDuration);
                     } else if (addDuration > 1 && op.startFrame) {
                         opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                     }
                     
                     if (opacity <= 0.01) continue;
                     
                     ctx.globalAlpha = opacity;
                     ctx.beginPath();
                     this._addPerimeterFacePath(ctx, bx, by, {dir: f}, l.lineWidthX, l.lineWidthY);
                     ctx.fill();
                 }
             }
        }
    }

    _ensureCanvases(w, h) {
        super._ensureCanvases(w, h);
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        
        if (blocksX && blocksY) {
            const requiredSize = blocksX * blocksY;
            if (!this.renderGridL1 || this.renderGridL1.length !== requiredSize) {
                 this.renderGridL1 = new Int32Array(requiredSize);
                 this.renderGridL1.fill(-1);
                 this.renderGridL2 = new Int32Array(requiredSize);
                 this.renderGridL2.fill(-1);
                 this._renderGridDirty = true;
            }
        }
    }
}