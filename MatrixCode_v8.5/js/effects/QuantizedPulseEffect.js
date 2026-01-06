class QuantizedPulseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedPulse";
        this.active = false;
        
        // Configuration defaults are handled in ConfigurationManager, 
        // but we init our internal state here.
        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.gridPitchChars = 4;
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation State
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this.animFrame = 0;
    }

    trigger() {
        if (this.active) return false;
        
        const s = this.c.state;
        if (!s.quantizedPulseEnabled) return false;

        this.active = true;
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        
        // Reset Animation State
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this.animFrame = 0;
        this._maskDirty = true;
        
        // Offset slightly (1/2 cell to overlap characters effectively)
        this.offsetX = 0.5; // Fraction of cell width
        this.offsetY = 0.5; // Fraction of cell height

        return true;
    }

    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        this.animFrame++;

        // 1. Lifecycle State Machine (Alpha Fading)
        const fadeInFrames = Math.max(1, s.quantizedPulseFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedPulseFadeFrames);
        const durationFrames = s.quantizedPulseDurationSeconds * fps;
        
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
            if (this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
            }
        } else if (this.state === 'FADE_OUT') {
            this.timer++;
            setAlpha(1.0 - (this.timer / fadeOutFrames));
            if (this.timer >= fadeOutFrames) {
                this.active = false;
                this.state = 'IDLE';
                this.alpha = 0.0;
            }
        }

        // 2. Animation Cycle (Grid Expansion)
        const cycleDuration = Math.max(1, this.c.derived.cycleDuration);
        this.cycleTimer++;

        if (this.cycleTimer >= cycleDuration) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            const delayCycles = Math.max(1, s.quantizedPulseSpeed || 1);
            if (this.cyclesCompleted >= delayCycles) {
                this.cyclesCompleted = 0;
                this._processAnimationStep();
            }
        }

        // 3. Animation Transition Management
        // Use config values for internal transitions
        const addDuration = Math.max(1, s.quantizedPulseFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedPulseFadeFrames || 0);

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
        // Animation Sequence
        const p = this.expansionPhase;
        const now = this.animFrame;

        // Helper to push relative ops with timestamp
        const add = (dx, dy) => {
            this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
        };
        const addRect = (dx1, dy1, dx2, dy2) => {
            this.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now });
        };
        const rem = (dx, dy, face) => {
            this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
        };

        if (p === 0) {
            add(0, 0); // Center
        } else if (p === 1) {
            add(1, 0); // East
        } else if (p === 2) {
            add(0, -1); // North
            add(0, 1);  // South
            rem(0, 0, 'E'); // Fade Center East
        } else if (p === 3) {
            add(-1, 0); // West
            rem(0, 0, 'N'); // Fade Center North
            rem(0, 0, 'S'); // Fade Center South
        } else if (p === 4) {
            add(0, -2); // North of North
            add(0, 2);  // South of South
        } else if (p === 5) {
            rem(0, 0, 'W'); // Fade Center West
            add(-2, 0); // West of West
            add(2, 0);  // East of East
            // Add 2x2 overlap South-East of Center (0,0 to 1,1)
            addRect(0, 0, 1, 1);
        }

        this.expansionPhase++;
        this._maskDirty = true;
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }

    render(ctx, d) {
        if (!this.active || this.alpha <= 0.01) return;

        const s = this.c.state;
        const glowStrength = s.quantizedPulseBorderIllumination || 0;
        if (glowStrength <= 0) return;

        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
            this._updateMask(width, height, s, d);
            this._maskDirty = false;
        }

        // 1. Render Text to Scratch Canvas
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        const visualFontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        scratchCtx.font = `${style}${weight} ${visualFontSize}px ${family}`;
        scratchCtx.textAlign = 'center';
        scratchCtx.textBaseline = 'middle';

        // Colors
        const t = Math.min(1.0, glowStrength / 10.0);
        const charR = 255;
        const charG = Math.floor(204 + (255 - 204) * t);
        const charB = Math.floor(0 + (255 - 0) * t);
        const charColor = `rgb(${charR}, ${charG}, ${charB})`;
        const glowR = 255;
        const glowG = Math.floor(215 + (255 - 215) * t);
        const glowB = Math.floor(0 + (255 - 0) * t);
        const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;

        scratchCtx.fillStyle = charColor;
        
        const grid = this.g;
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (width * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (height * 0.5);

        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);

        scratchCtx.globalAlpha = this.alpha; 

        const drawChar = (x, y) => {
            if (x >= cols || y >= rows) return;
            const i = (y * cols) + x;
            let charCode = chars[i];
            if (charCode <= 32) {
                const rotatorCycle = d.rotatorCycleFrames || 20;
                const timeSeed = Math.floor(this.animFrame / rotatorCycle);
                const hash = (i * 12345 + timeSeed * 67890);
                charCode = 0x30A0 + (hash % 96); 
            }
            const cx = screenOriginX + (x * screenStepX);
            const cy = screenOriginY + (y * screenStepY);
            scratchCtx.setTransform(s.stretchX, 0, 0, s.stretchY, cx, cy);
            scratchCtx.fillText(String.fromCharCode(charCode), 0, 0);
        };

        // Standard Grid Loop (Sparse)
        for (let by = 0; by <= blocksY; by++) {
            const y = Math.floor(by * cellPitchY);
            if (y >= rows) continue; 
            for (let x = 0; x < cols; x++) drawChar(x, y);
        }
        for (let bx = 0; bx <= blocksX; bx++) {
            const x = Math.floor(bx * cellPitchX);
            if (x >= cols) continue;
            for (let y = 0; y < rows; y++) drawChar(x, y);
        }
        
        scratchCtx.setTransform(1, 0, 0, 1, 0, 0);

        // 2. Apply Mask
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.globalAlpha = 1.0; 
        scratchCtx.drawImage(this.maskCanvas, 0, 0);

        // 3. Composite
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1.0;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();
    }

    _ensureCanvases(w, h) {
        if (!this.maskCanvas) {
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d');
            this._maskDirty = true;
        }
        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCtx = this.scratchCanvas.getContext('2d');
        }
        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
            this.maskCanvas.width = w;
            this.maskCanvas.height = h;
            this._maskDirty = true;
        }
        if (this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
            this.scratchCanvas.width = w;
            this.scratchCanvas.height = h;
        }
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const lineWidthX = screenStepX * 0.25;
        const lineWidthY = screenStepY * 0.25;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);

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
        const addDuration = Math.max(1, s.quantizedPulseFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedPulseFadeFrames || 0);

        // --- PASS 1: Base Grid (Active Blocks) ---
        // Build map of active blocks for Perimeter pass later
        const activeBlockMap = new Map(); // key "x,y" -> startFrame

        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;

            // Calculate Opacity based on age
            let opacity = 1.0;
            // If configured duration is 0, instant 1.0 (handled by max(1, 0) and age check)
            // If fade in frames is 0, addDuration is 1. age will be >= 0.
            // If age 0, 0/1 = 0. We want instant if 0.
            
            if (s.quantizedPulseFadeInFrames === 0) {
                opacity = 1.0;
            } else if (op.startFrame) {
                const age = now - op.startFrame;
                opacity = Math.min(1.0, age / addDuration);
            }
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, op.ext);

            // Register blocks for Perimeter Pass
             const minX = Math.min(start.x, end.x);
             const maxX = Math.max(start.x, end.x);
             const minY = Math.min(start.y, end.y);
             const maxY = Math.max(start.y, end.y);
             
             for (let by = minY; by <= maxY; by++) {
                 for (let bx = minX; bx <= maxX; bx++) {
                     const key = `${bx},${by}`;
                     if (!activeBlockMap.has(key)) {
                         activeBlockMap.set(key, op.startFrame || 0);
                     }
                 }
             }
        }

        // --- PASS 2: Erasures (Internal Walls) ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'remove') continue;

            let opacity = 1.0;
            if (s.quantizedPulseFadeFrames === 0) {
                opacity = 1.0;
            } else if (op.startFrame) {
                const age = now - op.startFrame;
                opacity = Math.min(1.0, age / removeDuration);
            }
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._removeBlockFace(start, end, op.face, op.force);
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 3: Perimeter (Bold Outer Barrier) ---
        // Iterate all active blocks and check neighbors
        // Bold line width
        const boldLineWidthX = lineWidthX * 2.0; 
        const boldLineWidthY = lineWidthY * 2.0;
        
        for (const [key, startFrame] of activeBlockMap) {
            const [bxStr, byStr] = key.split(',');
            const bx = parseInt(bxStr);
            const by = parseInt(byStr);

            // Fade in the perimeter just like the block
            let opacity = 1.0;
            if (s.quantizedPulseFadeInFrames === 0) {
                opacity = 1.0;
            } else if (startFrame) {
                const age = now - startFrame;
                opacity = Math.min(1.0, age / addDuration);
            }
            ctx.globalAlpha = opacity;

            // Check Neighbors
            const nN = activeBlockMap.has(`${bx},${by-1}`);
            const nS = activeBlockMap.has(`${bx},${by+1}`);
            const nW = activeBlockMap.has(`${bx-1},${by}`);
            const nE = activeBlockMap.has(`${bx+1},${by}`);

            // Draw Face if Neighbor is Missing
            if (!nN) this._drawPerimeterFace(bx, by, 'N', boldLineWidthX, boldLineWidthY);
            if (!nS) this._drawPerimeterFace(bx, by, 'S', boldLineWidthX, boldLineWidthY);
            if (!nW) this._drawPerimeterFace(bx, by, 'W', boldLineWidthX, boldLineWidthY);
            if (!nE) this._drawPerimeterFace(bx, by, 'E', boldLineWidthX, boldLineWidthY);
        }
        
        ctx.globalAlpha = 1.0;
    }

    _drawPerimeterFace(bx, by, face, widthX, widthY) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startCellX = Math.floor(bx * l.cellPitchX);
        const startCellY = Math.floor(by * l.cellPitchY);
        const endCellX = Math.floor((bx + 1) * l.cellPitchX);
        const endCellY = Math.floor((by + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        
        const hx = widthX / 2;
        const hy = widthY / 2;

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'S') {
            const cy = l.screenOriginY + (endCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'W') {
            const cx = l.screenOriginX + (startCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        } else if (face === 'E') {
            const cx = l.screenOriginX + (endCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        }
        ctx.fill();
    }

    /**
     * Dynamically adds a grid block region to the mask.
     */
    _addBlock(blockStart, blockEnd, isExtending) {
        if (!this.maskCtx || !this.layout) return;

        const ctx = this.maskCtx;
        const l = this.layout;

        const startX = Math.floor(blockStart.x * l.cellPitchX);
        const endX = Math.floor((blockEnd.x + 1) * l.cellPitchX);
        const startY = Math.floor(blockStart.y * l.cellPitchY);
        const endY = Math.floor((blockEnd.y + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

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
        ctx.fill();
    }

    /**
     * Removes the specified face (border line) from blocks in the given range.
     */
    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        if (!this.maskCtx || !this.layout) return;

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
                const safeX = l.lineWidthX; 
                const safeY = l.lineWidthY; 

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY, width, l.lineWidthY);
                }
                else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY, width, l.lineWidthY);
                }
                else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX, top, l.lineWidthX, height);
                }
                else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX, top, l.lineWidthX, height);
                }
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
}