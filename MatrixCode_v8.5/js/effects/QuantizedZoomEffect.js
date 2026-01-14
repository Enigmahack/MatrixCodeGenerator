class QuantizedZoomEffect extends QuantizedSequenceEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedZoom";
        this.active = false;
        this.configPrefix = "quantizedZoom";
        
        // Simulation State
        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Sequence State
        this.sequence = [[]]; 
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Zoom Effect State
        this.snapshotCanvas = null;
        this.snapshotCtx = null;
        this.zoomScale = 0.5;
        this.hasCaptured = false;
    }

    trigger(force = false) {
        console.log("[QuantizedZoom] Trigger called. Force:", force, "Active:", this.active);
        if (this.active) return false;

        // Interruption Logic
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb"];
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
        this.hasCaptured = false;
        this.zoomScale = 0.5;

        // 1. Capture 3x Resolution Snapshot
        this._captureHighResSnapshot();

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    _captureHighResSnapshot() {
        const d = this.c.derived;
        const s = this.c.state;
        
        // 3x Grid Size
        const factor = 3;
        const cols = this.g.cols * factor;
        const rows = this.g.rows * factor;
        
        // Create Temp Grid & Sim
        const tempGrid = new CellGrid(this.c);
        
        // Calculate exact pixel dimensions for 3x
        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const pixelW = cols * cellW;
        const pixelH = rows * cellH;
        
        tempGrid.resize(pixelW, pixelH); // This sets tempGrid.cols/rows based on cell size
        
        const tempSim = new SimulationSystem(tempGrid, this.c, false);
        tempSim.useWorker = false;
        
        // Initialize Stream Manager
        const sm = tempSim.streamManager;
        sm.resize(tempGrid.cols);
        tempSim.timeScale = 1.0;
        
        // Populate Simulation (Fast Warmup)
        // High density injection similar to QuantizedClimb
        const injectionCount = Math.floor(tempGrid.cols * 0.75);
        for (let k = 0; k < injectionCount; k++) {
            const col = Math.floor(Math.random() * tempGrid.cols);
            const startY = Math.floor(Math.random() * tempGrid.rows);
            const isEraser = Math.random() < 0.2;
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            if (startY < stream.visibleLen) {
                stream.age = startY;
                sm.addActiveStream(stream);
            }
        }
        
        // Run Warmup
        const warmupFrames = 100;
        for (let i = 0; i < warmupFrames; i++) {
            tempSim.update(i);
        }
        
        // Render to Canvas
        if (!this.snapshotCanvas) {
            this.snapshotCanvas = document.createElement('canvas');
            this.snapshotCtx = this.snapshotCanvas.getContext('2d');
        }
        this.snapshotCanvas.width = pixelW;
        this.snapshotCanvas.height = pixelH;
        
        console.log(`[QuantizedZoom] Snapshot Canvas: ${pixelW}x${pixelH}. Cols: ${tempGrid.cols}, Rows: ${tempGrid.rows}`);

        // Use a high-res rendering helper
        this._renderSnapshot(this.snapshotCtx, tempGrid, d, s);
        
        this.hasCaptured = true;
        
        // Cleanup
        tempSim.grid = null;
        // tempSim.destroy(); // if method existed
    }

    _renderSnapshot(ctx, grid, d, s) {
        ctx.fillStyle = s.backgroundColor;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        const charR = 255; // Use max brightness for snapshot, will be dimmed/tinted later if needed
        const charG = 255;
        const charB = 255;
        const charColor = `rgb(${charR}, ${charG}, ${charB})`;
        
        const fontSize = s.fontSize; // Keep original font size, but grid is 3x larger so it looks dense?
        // Wait, if we use same font size but 3x cols/rows, the canvas is 3x bigger.
        // When we draw it scaled down to 0.5x screen size, it will look super high res/dense.
        
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        ctx.font = `${style}${weight} ${fontSize}px ${family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const cols = grid.cols;
        const rows = grid.rows;
        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        
        let charsDrawn = 0;

        // Helper to draw
        const drawChar = (x, y, charCode, alpha, color) => {
            if (alpha <= 0.01) return;
            const cx = (x * cellW) + (cellW * 0.5);
            const cy = (y * cellH) + (cellH * 0.5);
            
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color || charColor;
            
            // Simple render without complex effects for static snapshot
            ctx.fillText(String.fromCharCode(charCode), cx, cy);
            charsDrawn++;
        };

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = y * cols + x;
                const char = grid.chars[idx];
                if (char > 32) {
                    // Unpack Uint32 Color (0xAABBGGRR)
                    const colorVal = grid.colors[idx];
                    const r = colorVal & 0xFF;
                    const g = (colorVal >> 8) & 0xFF;
                    const b = (colorVal >> 16) & 0xFF;
                    
                    const a = grid.alphas[idx];
                    const col = `rgb(${r},${g},${b})`;
                    drawChar(x, y, char, a, col);
                }
            }
        }
        console.log(`[QuantizedZoom] Rendered ${charsDrawn} characters to snapshot.`);
        ctx.globalAlpha = 1.0;
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedZoomSpeed !== undefined) ? s.quantizedZoomSpeed : 1;
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

        // 2. Zoom Logic
        const totalSteps = this.sequence.length;
        const currentStep = this.expansionPhase;
        const progress = Math.min(1.0, currentStep / Math.max(1, totalSteps));
        
        if (progress < 0.5) {
            this.zoomScale = 0.5;
        } else {
            // Scale from 0.5 to 1.0 during the second half
            const t = (progress - 0.5) * 2.0; // 0.0 to 1.0
            // Smooth step?
            const smoothT = t * t * (3 - 2 * t);
            this.zoomScale = 0.5 + (0.5 * smoothT);
        }

        // 3. Lifecycle
        const fadeInFrames = Math.max(1, (s.quantizedZoomFadeInFrames !== undefined) ? s.quantizedZoomFadeInFrames : 60);
        const fadeOutFrames = Math.max(1, (s.quantizedZoomFadeFrames !== undefined) ? s.quantizedZoomFadeFrames : 60);
        // Note: Duration logic in Zoom effect is driven by Steps completion primarily, but we respect max duration too
        const durationFrames = (s.quantizedZoomDurationSeconds || 5) * fps;

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
            
            // End condition: When steps are done OR duration is met
            const stepsDone = (this.expansionPhase >= totalSteps);
            const timeDone = (!this.debugMode && this.timer >= durationFrames);
            
            if (stepsDone || timeDone) {
                this.state = 'FADE_OUT';
                this.timer = 0;
            }
        } else if (this.state === 'FADE_OUT') {
            this.timer++;
            this.alpha = Math.max(0.0, 1.0 - (this.timer / fadeOutFrames));
            if (this.timer >= fadeOutFrames) {
                this.active = false;
                this.state = 'IDLE';
                window.removeEventListener('keydown', this._boundDebugHandler);
                this.snapshotCanvas = null; // Release memory
            }
        }

        // 4. Dirtiness Check
        const addDuration = Math.max(1, s.quantizedZoomFadeInFrames || 0);
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (this.animFrame - op.startFrame < addDuration) {
                    this._maskDirty = true;
                    break;
                }
            }
        }
        
        // Always dirty mask if zooming (scale changed)
        if (this.state === 'SUSTAIN' && progress >= 0.5) {
            this._maskDirty = true; // Force redraw to handle scale change if rendering embedded
        }
    }

    // Override Render to draw the snapshot
    render(ctx, d) {
        // Debugging render state
        if (this.active && this.alpha > 0.01) {
             // console.log(`[QuantizedZoom] Render. Alpha: ${this.alpha.toFixed(2)}, Captured: ${this.hasCaptured}, MaskOps: ${this.maskOps.length}, Zoom: ${this.zoomScale.toFixed(2)}`);
        }

        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;
        if (!this.hasCaptured || !this.snapshotCanvas) return;

        const s = this.c.state;
        const glowStrength = this.getConfig('BorderIllumination') || 0;
        
        const borderColor = this.getConfig('PerimeterColor') || "#FFD700";
        const interiorColor = this.getConfig('InnerColor') || "#FFD700";
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); 

        // Always update mask layout/drawing for current frame
        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height || this.debugMode) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        // --- Render Composition ---
        
        // 1. Draw Snapshot masked by MaskCanvas
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);
        
        // Draw Snapshot Scaled & Centered
        const snapW = this.snapshotCanvas.width;
        const snapH = this.snapshotCanvas.height;
        
        // Target Size: If scale = 1.0, it fills screen. If 0.5, it is 1/2 screen size.
        // Wait, snap is 3x res.
        // 1.0 scale should match screen size (fit).
        const targetW = width * this.zoomScale;
        const targetH = height * this.zoomScale;
        const targetX = (width - targetW) / 2;
        const targetY = (height - targetH) / 2;
        
        scratchCtx.globalAlpha = 1.0;
        scratchCtx.drawImage(this.snapshotCanvas, targetX, targetY, targetW, targetH);
        
        // Apply Mask (Destination-In)
        // The mask defines the "Active" blocks. We want the snapshot ONLY in the active blocks.
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(this.maskCanvas, 0, 0);
        
        // Draw to Main Context (Effect Layer)
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'normal') {
            // Ensure visibility over normal code
            // Normally Quantized effects use 'normal' or 'lighter'.
            // Here we are overlaying an image. 'source-over' is best.
        }
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = this.alpha;
        
        // Draw the masked snapshot
        ctx.drawImage(this.scratchCanvas, 0, 0);
        
        // 2. Render Internal Lines Layer (Blue/Configured) - ADDITIVE or OVER?
        // Lines usually look best with 'lighter' or 'source-over' depending on style.
        // Let's stick to base logic for borders.
        
        if (glowStrength > 0) {
            const renderLayer = (maskCanvas, color) => {
                if (!maskCanvas) return;
                scratchCtx.globalCompositeOperation = 'source-over';
                scratchCtx.clearRect(0, 0, width, height);
                
                // Solid Color fill for borders
                scratchCtx.fillStyle = color;
                scratchCtx.fillRect(0, 0, width, height);
                
                // Mask
                scratchCtx.globalCompositeOperation = 'destination-in';
                scratchCtx.drawImage(maskCanvas, 0, 0);
                
                // Draw to Screen
                ctx.globalCompositeOperation = 'source-over'; // Opaque borders on top of image
                
                // Apply glow
                ctx.shadowColor = color;
                ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
                ctx.drawImage(this.scratchCanvas, 0, 0);
                ctx.shadowBlur = 0; // Reset
            };

            // Internal Lines
            if (this.lineMaskCanvas) {
                renderLayer(this.lineMaskCanvas, interiorColor);
            }

            // Perimeter Border
            if (this.perimeterMaskCanvas) {
                renderLayer(this.perimeterMaskCanvas, borderColor);
            }
        }
        
        ctx.restore();
    }
    
    // Re-implement _updateMask (copied from Climb/Pulse) to ensure correct border rendering
    // Logic is identical to Climb/Pulse, just ensuring we use local props
    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedZoomPerimeterThickness !== undefined) ? s.quantizedZoomPerimeterThickness : 1.0;
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
        const fadeInFrames = s.quantizedZoomFadeInFrames || 0;
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

        // PASS 1: Base Grid (Interior) - Solid Rects for Masking Image
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;
            if (fadeInFrames > 0 && op.startFrame && !this.debugMode) {
                opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            }
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Using base _addBlock but with Pulse logic (false = solid rect)
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
    
    _addPerimeterFacePath(bx, by, faceObj, widthX, widthY) {
        // ... Reusing logic from Climb/Pulse ...
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
    
    // Override _updateShadowSim to DO NOTHING (since we use snapshot)
    _updateShadowSim() {
        // No-op. We don't want the sequence logic to try updating a null shadowSim or using it.
    }
    
    // Override _swapStates to DO NOTHING (no swap at end)
    _swapStates() {
        // No-op
    }
    
    // Helper needed for _updateRenderGridLogic
    _updateRenderGridLogic() {
        // ... (Copy from Climb/Pulse as it's not in Sequence base but needed for logic) ...
        // Actually, I can call super if I add it to Sequence?
        // Wait, I saw _updateRenderGridLogic in Pulse/Climb but not Sequence base in previous reads?
        // Let's implement it here to be safe.
        
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
        this._distMapDirty = true;
    }
}
