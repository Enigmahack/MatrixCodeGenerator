class QuantizedClimbEffect extends QuantizedSequenceEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedClimb";
        this.active = false;
        this.configPrefix = "quantizedClimb";
        
        // Simulation State
        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Sequence State
        this.sequence = [[]]; 
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Flicker Fix
        this.isSwapping = false;
        this.swapTimer = 0;
    }

    trigger(force = false) {
        if (this.active && !this.hasSwapped) {
            this._swapStates();
        }

        // Interruption Logic
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    if (typeof eff._swapStates === 'function') {
                        if (!eff.hasSwapped) eff._swapStates();
                        eff.active = false;
                        eff.state = 'IDLE';
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
        this.hasSwapped = false;
        this.isSwapping = false;

        // Initialize Shadow World
        this._initShadowWorldBase(false);
        
        // Climb-specific injection (High Density)
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        
        const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        // Shuffle
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }
        
        // 75% Fill
        const injectionCount = Math.floor(this.shadowGrid.cols * 0.75);
        for (let k = 0; k < injectionCount; k++) {
            const col = columns[k];
            const startY = Math.floor(Math.random() * this.shadowGrid.rows);
            const isEraser = Math.random() < 0.2;
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            if (startY < stream.visibleLen) {
                stream.age = startY;
                sm.addActiveStream(stream);
            }
        }

        // Warmup
        for (let i = 0; i < 400; i++) this.shadowSim.update(i);
        this.shadowSimFrame = 400;

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedClimbSpeed !== undefined) ? s.quantizedClimbSpeed : 1;
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

        this._updateRenderGridLogic();

        // 2. Shadow Simulation
        if (!this.hasSwapped && !this.isSwapping) {
            this._updateShadowSim();
        } else if (this.isSwapping) {
            this._updateShadowSim();
            this.swapTimer--;
            if (this.swapTimer <= 0) {
                this.g.clearAllOverrides();
                this.isSwapping = false;
                this.hasSwapped = true;
                this.active = false;
                this.state = 'IDLE';
                this.shadowGrid = null;
                this.shadowSim = null;
                window.removeEventListener('keydown', this._boundDebugHandler);
            }
        }

        // 3. Lifecycle
        const fadeInFrames = Math.max(1, (s.quantizedClimbFadeInFrames !== undefined) ? s.quantizedClimbFadeInFrames : 60);
        const fadeOutFrames = Math.max(1, (s.quantizedClimbFadeFrames !== undefined) ? s.quantizedClimbFadeFrames : 60);
        const durationFrames = (s.quantizedClimbDurationSeconds || 2) * fps;

        if (this.state === 'FADE_IN') {
            this.timer++;
            this.alpha = Math.min(1.0, this.timer / fadeInFrames);
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
                this.alpha = Math.max(0.0, 1.0 - (this.timer / fadeOutFrames));
                if (this.timer >= fadeOutFrames) {
                    this.active = false;
                    this.state = 'IDLE';
                    window.removeEventListener('keydown', this._boundDebugHandler);
                    this.g.clearAllOverrides();
                    this.shadowGrid = null;
                    this.shadowSim = null;
                }
            }
        }

        // 4. Dirtiness Check
        const addDuration = Math.max(1, s.quantizedClimbFadeInFrames || 0);
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (this.animFrame - op.startFrame < addDuration) {
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
        }
    }

    _updateRenderGridLogic() {
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        
        const blocksX = Math.ceil(this.g.cols / cellPitchX);
        const blocksY = Math.ceil(this.g.rows / cellPitchY);
        const totalBlocks = blocksX * blocksY;

        if (!this.renderGrid || this.renderGrid.length !== totalBlocks) {
            this.renderGrid = new Int32Array(totalBlocks);
        }
        this.renderGrid.fill(-1);

        if (!this.maskOps) return;

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
        
        this._lastBlocksX = blocksX;
        this._lastBlocksY = blocksY;
        this._lastPitchX = cellPitchX;
        this._lastPitchY = cellPitchY;
        this._distMapDirty = true;
    }

    _ensureCanvases(w, h) {
        super._ensureCanvases(w, h);
        if (!this.perimeterMaskCanvas) {
            this.perimeterMaskCanvas = document.createElement('canvas');
            this.perimeterMaskCtx = this.perimeterMaskCanvas.getContext('2d');
        }
        if (this.perimeterMaskCanvas.width !== w || this.perimeterMaskCanvas.height !== h) {
            this.perimeterMaskCanvas.width = w;
            this.perimeterMaskCanvas.height = h;
        }
        if (!this.lineMaskCanvas) {
            this.lineMaskCanvas = document.createElement('canvas');
            this.lineMaskCtx = this.lineMaskCanvas.getContext('2d');
        }
        if (this.lineMaskCanvas.width !== w || this.lineMaskCanvas.height !== h) {
            this.lineMaskCanvas.width = w;
            this.lineMaskCanvas.height = h;
        }
    }

    _updateMask(w, h, s, d) {
        // Use Pulse-style rendering for borders/lines
        // We reuse the logic from Pulse by copy-pasting or ensuring we call the same helpers
        // Since we can't easily inherit from Pulse, we duplicate the Pulse mask logic here.
        // This ensures the visuals match (Gold/Inner Lines).
        
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedClimbPerimeterThickness !== undefined) ? s.quantizedClimbPerimeterThickness : 1.0;
        const lineWidthX = screenStepX * 0.25 * thickness;
        const lineWidthY = screenStepY * 0.25 * thickness;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = this.g.cols * d.cellWidth; 
        const gridPixH = this.g.rows * d.cellHeight;
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

        const blocksX = Math.ceil(this.g.cols / cellPitchX);
        const blocksY = Math.ceil(this.g.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        if (!this.maskOps) return;

        const now = this.animFrame;
        const fadeInFrames = s.quantizedClimbFadeInFrames || 0;
        const addDuration = Math.max(1, fadeInFrames);

        const distMap = this._computeDistanceField(blocksX, blocksY);
        const outsideMap = this._computeTrueOutside(blocksX, blocksY);
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= blocksX || ny < 0 || ny >= blocksY) return false; 
            return outsideMap[ny * blocksX + nx] === 1;
        };
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            const idx = by * blocksX + bx;
            return this.renderGrid && this.renderGrid[idx] !== -1;
        };

        // PASS 1: Base Grid (Interior)
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;
            if (fadeInFrames > 0 && op.startFrame && !this.debugMode) {
                opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            }
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Using base _addBlock but logic is same as Pulse (solid rect)
            this._addBlock(start, end, op.ext, false); 
        }

        // PASS 3: Perimeter
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx; 
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;
            
            const batches = new Map();
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    if (!isRenderActive(bx, by)) continue; 
                    const idx = by * blocksX + bx;
                    const startFrame = this.renderGrid[idx];
                    
                    const outN = isTrueOutside(bx, by - 1);
                    const outS = isTrueOutside(bx, by + 1);
                    const outW = isTrueOutside(bx - 1, by);
                    const outE = isTrueOutside(bx + 1, by);

                    if (!outN && !outS && !outW && !outE) continue; 

                    let list = batches.get(startFrame);
                    if (!list) { list = []; batches.set(startFrame, list); }
                    
                    const faces = [];
                    if (outN) faces.push({dir: 'N', rS: outW, rE: outE});
                    if (outS) faces.push({dir: 'S', rS: outW, rE: outE});
                    if (outW) faces.push({dir: 'W', rS: outN, rE: outS});
                    if (outE) faces.push({dir: 'E', rS: outN, rE: outS});
                    
                    list.push({bx, by, faces});
                }
            }

            for (const [startFrame, items] of batches) {
                let opacity = 1.0;
                if (fadeInFrames > 0 && startFrame !== -1 && !this.debugMode) {
                    opacity = Math.min(1.0, (now - startFrame) / addDuration);
                }
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

            // Void Cleanup
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
                        pCtx.rect(x - 0.1, y - 0.1, w + 0.2, h + 0.2); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
            this.maskCtx = originalCtx; 
        }

        // PASS 4: Lines
        if (lCtx) {
            const activeLines = new Map();
            for (const op of this.maskOps) {
                if (op.type !== 'addLine') continue;
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isRenderActive(bx, by)) {
                            const idx = by * blocksX + bx;
                            if (distMap[idx] > 4) continue;
                            let nx = bx, ny = by;
                            const f = op.face ? op.face.toUpperCase() : '';
                            if (f === 'N') ny--; else if (f === 'S') ny++; else if (f === 'W') nx--; else if (f === 'E') nx++;
                            if (isTrueOutside(nx, ny)) continue;

                            let cell = activeLines.get(idx);
                            if (!cell) { cell = {}; activeLines.set(idx, cell); }
                            cell[f] = op;
                        }
                    }
                }
            }

            const originalCtx = this.maskCtx;
            this.maskCtx = lCtx;
            lCtx.fillStyle = '#FFFFFF';

            for (const [idx, cell] of activeLines) {
                const bx = idx % blocksX;
                const by = Math.floor(idx / blocksX);
                
                const drawLine = (face, rS, rE) => {
                    const op = cell[face];
                    if (!op) return;
                    let opacity = 1.0;
                    if (fadeInFrames > 0 && op.startFrame && !this.debugMode) {
                        opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                    }
                    if (opacity <= 0.001) return;
                    lCtx.globalAlpha = opacity;
                    lCtx.beginPath();
                    this._addPerimeterFacePath(bx, by, {dir: face, rS, rE}, lineWidthX, lineWidthY);
                    lCtx.fill();
                };

                const hasN_Border = isTrueOutside(bx, by - 1);
                const hasS_Border = isTrueOutside(bx, by + 1);
                const hasN = !!cell['N'] || hasN_Border;
                const hasS = !!cell['S'] || hasS_Border;

                drawLine('N', false, false);
                drawLine('S', false, false);
                drawLine('W', hasN, hasS);
                drawLine('E', hasN, hasS);
            }
            this.maskCtx = originalCtx;
        }
    }

    // Helper from Pulse (copied to ensure independence from base if base changes)
    _addPerimeterFacePath(bx, by, faceObj, widthX, widthY) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startCellX = Math.floor(bx * l.cellPitchX);
        const startCellY = Math.floor(by * l.cellPitchY);
        const endCellX = Math.floor((bx + 1) * l.cellPitchX);
        const endCellY = Math.floor((by + 1) * l.cellPitchY);

        const face = faceObj.dir;
        const rS = faceObj.rS;
        const rE = faceObj.rE;

        let drawX, drawY, drawW, drawH;

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);
            drawY = cy; drawH = widthY; drawX = leftX; drawW = rightX - leftX;
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'S') {
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);
            drawY = bottomY - widthY; drawH = widthY; drawX = leftX; drawW = rightX - leftX;
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
        } else if (face === 'W') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            drawX = leftX; drawW = widthX; drawY = topY; drawH = bottomY - topY;
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
        } else if (face === 'E') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);
            drawX = rightX - widthX; drawW = widthX; drawY = topY; drawH = bottomY - topY;
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
        }
        ctx.rect(drawX, drawY, drawW, drawH);
    }
}