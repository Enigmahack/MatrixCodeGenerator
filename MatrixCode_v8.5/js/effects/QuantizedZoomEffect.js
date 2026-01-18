class QuantizedZoomEffect extends QuantizedSequenceEffect {
    constructor(g, c) {
        super(g, c);
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
        this.zoomScale = 1.0;
        this.hasCaptured = false;
        
        // Logic Grid expansion for safety (like GenerateEffect)
        this.logicScale = 1.3; 
        
        this.useShadowWorld = true;
    }

    trigger(force = false) {
        // 1. Strict Active Check
        if (this.active) return false;

        // 2. Mutually Exclusive Lock
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedGenerate", "QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    return false;
                }
            }
        }

        if (!super.trigger(force)) return false;

        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.hasCaptured = false;
        this.zoomScale = 1.0;
        this.zoomProgress = 0;

        // 1. Initialize Grid Dimensions First
        this._initLogicGrid();
        
        if (this.useShadowWorld) {
            this._initShadowWorld();
        }

        // 2. Capture Current State
        this._captureSnapshot();
        
        // 3. Generate Expansion Sequence (Bottom Center)
        if (typeof QuantizedSequenceGenerator !== 'undefined') {
            const generator = new QuantizedSequenceGenerator();
            
            const seedX = Math.floor(this.logicGridW / 2);
            const seedY = this.logicGridH - 1; 
            
            this.sequence = generator.generate(this.logicGridW, this.logicGridH, 20000, { 
                seedX, 
                seedY,
                erosionRate: 0.0,
                blocksPerStep: 2, // Slower start
                maxBlocksPerStep: 8 // Slower peak
            });
            console.log(`[QuantizedZoom] Sequence: ${this.sequence.length} steps.`);
        } else {
            console.error("QuantizedSequenceGenerator not found!");
            this.active = false;
            return false;
        }

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    _captureSnapshot() {
        const d = this.c.derived;
        const s = this.c.state;
        
        // 1. Setup 3x Resolution Grid
        const factor = 3;
        const cols = this.g.cols * factor;
        const rows = this.g.rows * factor;
        
        // Create Temp Grid
        const tempGrid = new CellGrid(this.c);
        
        // Calculate dimensions matching 3x grid
        const pixelW = cols * d.cellWidth;
        const pixelH = rows * d.cellHeight;
        
        tempGrid.resize(pixelW, pixelH); 
        
        // Create Temp Simulation
        const tempSim = new SimulationSystem(tempGrid, this.c, false);
        tempSim.useWorker = false;
        
        // Initialize Stream Manager with high density
        const sm = tempSim.streamManager;
        sm.resize(tempGrid.cols);
        tempSim.timeScale = 1.0;
        
        // Populate Simulation (Fast Warmup)
        // High density injection (300% density - 3 streams per column on average)
        const densityMultiplier = 3.0; 
        const injectionCount = Math.floor(tempGrid.cols * densityMultiplier);
        
        for (let k = 0; k < injectionCount; k++) {
            const col = Math.floor(Math.random() * tempGrid.cols);
            // Distribute startY to create full screen coverage immediately
            const startY = Math.floor(Math.random() * (tempGrid.rows + 20)) - 10; 
            
            const isEraser = Math.random() < 0.15; 
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            
            // Randomize trail length significantly (0.5x to 3.0x) for variety
            stream.visibleLen = Math.floor(stream.visibleLen * (0.5 + Math.random() * 2.5));
            
            // Manually set age to ensure immediate visibility if needed
            sm.addActiveStream(stream);
        }
        
        // Run Warmup
        const warmupFrames = 120;
        for (let i = 0; i < warmupFrames; i++) {
            // Force fade logic to run by updating simulation fully
            tempSim.update(i);
            
            // Inject CONTINUOUS streams during warmup to maintain density
            if (i % 2 === 0) {
                 const refillCount = Math.floor(tempGrid.cols * 0.1); // Refill 10% every other frame
                 for(let r=0; r<refillCount; r++) {
                     const col = Math.floor(Math.random() * tempGrid.cols);
                     const stream = sm._initializeStream(col, Math.random() < 0.15, s);
                     stream.y = 0; 
                     // Apply same variance to refill
                     stream.visibleLen = Math.floor(stream.visibleLen * (0.5 + Math.random() * 2.5));
                     sm.addActiveStream(stream);
                 }
            }
        }
        
        // 2. Render to Snapshot Canvas
        const snapW = tempGrid.cols * d.cellWidth;
        const snapH = tempGrid.rows * d.cellHeight;

        if (!this.snapshotCanvas) {
            this.snapshotCanvas = document.createElement('canvas');
        }
        this.snapshotCanvas.width = snapW;
        this.snapshotCanvas.height = snapH;
        
        const ctx = this.snapshotCanvas.getContext('2d');

        // Fill Background
        ctx.fillStyle = s.backgroundColor;
        ctx.fillRect(0, 0, snapW, snapH);
        
        // Setup Secondary Transparent Canvas for Border Tinting
        if (!this.charSnapshotCanvas) {
            this.charSnapshotCanvas = document.createElement('canvas');
        }
        this.charSnapshotCanvas.width = snapW;
        this.charSnapshotCanvas.height = snapH;
        const charCtx = this.charSnapshotCanvas.getContext('2d');
        charCtx.clearRect(0, 0, snapW, snapH);
        
        // Setup Font
        const visualFontSize = s.fontSize;
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        const fontStr = `${style}${weight} ${visualFontSize}px ${family}`;
        
        ctx.font = fontStr;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        charCtx.font = fontStr;
        charCtx.textAlign = 'center';
        charCtx.textBaseline = 'middle';
        
        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const halfW = cellW / 2;
        const halfH = cellH / 2;
        
        // Render pass: Column-based scanning
        for (let x = 0; x < tempGrid.cols; x++) {
            let currentRun = [];
            
            // Scan from bottom to top to find streams
            for (let y = tempGrid.rows - 1; y >= 0; y--) {
                const idx = y * tempGrid.cols + x;
                const char = tempGrid.chars[idx];
                
                // Check if cell is occupied (char > 32)
                if (char > 32) {
                    currentRun.push({y, idx, char, color: tempGrid.colors[idx]});
                } else {
                    // End of a run (or empty space)
                    if (currentRun.length > 0) {
                        this._drawStreamRun(ctx, currentRun, cellW, cellH, halfW, halfH, x);
                        this._drawStreamRun(charCtx, currentRun, cellW, cellH, halfW, halfH, x);
                        currentRun = [];
                    }
                }
            }
            // Flush remaining run at top
            if (currentRun.length > 0) {
                this._drawStreamRun(ctx, currentRun, cellW, cellH, halfW, halfH, x);
                this._drawStreamRun(charCtx, currentRun, cellW, cellH, halfW, halfH, x);
            }
        }
        
        this.hasCaptured = true;
        // Cleanup
        tempSim.grid = null;
    }

    _drawStreamRun(ctx, run, cellW, cellH, halfW, halfH, colX) {
        const runLen = run.length;
        // Filter: Ignore isolated noise for Tracer logic
        // If run is very short, render it faint and uniform, NO white head.
        const isValidStream = runLen >= 4; 
        
        for (let i = 0; i < runLen; i++) {
            const cell = run[i];
            const isHead = (i === 0);
            
            let r, g, b, alpha;
            
            if (isValidStream && isHead) {
                // White Tracer
                r = 255; g = 255; b = 255;
                alpha = 1.0;
            } else {
                // Tail / Body
                const cVal = cell.color;
                r = cVal & 0xFF;
                g = (cVal >> 8) & 0xFF;
                b = (cVal >> 16) & 0xFF;

                if (!isValidStream) {
                    // Debris: Faint, uniform
                    alpha = 0.3;
                } else {
                    // Fade Calculation
                    // i=1 is right after head. i=runLen-1 is tail tip.
                    // Normalize position 0.0 (near head) to 1.0 (tip)
                    // We exclude the head (i=0) from this range
                    const tailPos = (i - 1) / Math.max(1, runLen - 1);
                    
                    // Quadratic Fade: Starts at 1.0, curves down to 0.0
                    // alpha = (1 - x)^2
                    alpha = Math.pow(1.0 - tailPos, 2);
                    
                    // Boost min alpha slightly so body isn't invisible immediately
                    // But tail tip goes to 0
                    if (alpha < 0.05) alpha = 0; 
                }
            }
            
            if (alpha <= 0.01) continue;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            
            const cx = (colX * cellW) + halfW;
            const cy = (cell.y * cellH) + halfH;
            
            ctx.fillText(String.fromCharCode(cell.char), cx, cy);
        }
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const expansionRate = (s.quantizedZoomExpansionRate !== undefined) ? s.quantizedZoomExpansionRate : 1.0;
        const effectiveInterval = baseDuration * (expansionRate / 8.0);

        this.cycleTimer++;
        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }
        
        // Optimize: Update render logic
        this._updateRenderGridLogic();
        
        // 1.5 Shadow Simulation
        if (this.useShadowWorld) {
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
        }

        // 2. Zoom & Fade Logic
        const totalSteps = this.sequence.length;
        const currentStep = this.expansionPhase;
        const progress = Math.min(1.0, currentStep / Math.max(1, totalSteps));
        
        // Decoupled Zoom Logic
        const zoomDelayFrames = (s.quantizedZoomDelay !== undefined) ? s.quantizedZoomDelay * 60 : 0; // delay in seconds -> frames
        const zoomRate = (s.quantizedZoomZoomRate !== undefined) ? s.quantizedZoomZoomRate : 1.0;
        
        if (this.timer >= zoomDelayFrames) {
             // Actual zoom progress
             if (!this.zoomProgress) this.zoomProgress = 0;
             // Base speed: 0.005 per frame * zoomRate
             this.zoomProgress += 0.005 * zoomRate; 
             const t = Math.min(1.0, this.zoomProgress);
             const smoothT = t * t * (3 - 2 * t);
             this.zoomScale = 1.0 + (3.0 * smoothT);
        } else {
             this.zoomScale = 1.0;
        }

        // 3. Lifecycle & Alpha
        const fadeInFrames = Math.max(1, (s.quantizedZoomFadeInFrames !== undefined) ? s.quantizedZoomFadeInFrames : 60);
        const fadeOutFrames = Math.max(1, (s.quantizedZoomFadeFrames !== undefined) ? s.quantizedZoomFadeFrames : 60);
        
        if (this.state === 'FADE_IN') {
            this.timer++;
            this.alpha = Math.min(1.0, this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++; // Continue timer for zoom delay check
            this.alpha = 1.0;

            if (progress >= 1.0) {
                this.state = 'HOLD';
                this.holdTimer = 0;
            }
        } else if (this.state === 'HOLD') {
            this.timer++; // Keep global timer running for zoom calculation
            this.holdTimer++;
            const holdFrames = ((s.quantizedZoomHoldSeconds !== undefined) ? s.quantizedZoomHoldSeconds : 2.0) * 60;
            
            if (this.holdTimer >= holdFrames) {
                this.state = 'FADE_OUT';
                this.fadeTimer = 0; 
                
                if (this.useShadowWorld && !this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            this.timer++;
            this.fadeTimer++;
            this.alpha = Math.max(0.0, 1.0 - (this.fadeTimer / fadeOutFrames));
            
            if (this.fadeTimer >= fadeOutFrames) {
                this.active = false;
                this.state = 'IDLE';
                window.removeEventListener('keydown', this._boundDebugHandler);
                this.snapshotCanvas = null; 
                this.charSnapshotCanvas = null;
            }
        }

        // 4. Dirtiness
        const addDuration = Math.max(1, s.quantizedZoomFadeInFrames || 0);
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (this.animFrame - op.startFrame < addDuration) {
                    this._maskDirty = true;
                    break;
                }
            }
        }
        if (progress >= 0.5) this._maskDirty = true; 
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
        const thickness = (s.quantizedZoomPerimeterThickness !== undefined) ? s.quantizedZoomPerimeterThickness : 1.0;
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

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);

        // Distance Map for Hollow Masking
        const distMap = this._computeDistanceField(blocksX, blocksY);
        
        const outsideMap = this._computeTrueOutside(blocksX, blocksY);
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= blocksX || ny < 0 || ny >= blocksY) return false; 
            return outsideMap[ny * blocksX + nx] === 1;
        };
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            return this.renderGrid[by * blocksX + bx] !== -1;
        };

        // --- PASS 1: Base Grid (Interior) ---
        // Draws Solid Blocks to ctx (maskCanvas) for Zoom Reveal
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Solid block for mask
            this._addBlock(start, end, op.ext); 
        }

        // --- PASS 3: Perimeter (Border) ---
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

            this.maskCtx = originalCtx; 
        }
    }

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;
        if (!this.hasCaptured || !this.snapshotCanvas) return;

        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); 

        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        const scratchCtx = this.scratchCtx;
        
        // --- Layer 1: Interior (Zoom Window) ---
        // 1A. Draw Solid Background (Black/BG Color) masked by Window
        // This ensures we hide the "Old World" behind the window, even though snapshot is transparent
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);
        
        scratchCtx.fillStyle = s.backgroundColor || '#000000';
        scratchCtx.globalAlpha = 0.6;
        scratchCtx.fillRect(0, 0, width, height);
        
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.drawImage(this.maskCanvas, 0, 0);
        
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = this.alpha;
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();

        // 1B. Draw Zoomed Snapshot (Characters) masked by Window
        const drawZoomLayer = (mask, scale, tintColor = null, sourceCanvas = this.snapshotCanvas) => {
            scratchCtx.globalCompositeOperation = 'source-over';
            scratchCtx.clearRect(0, 0, width, height);
            
            const gridW = this.g.cols * d.cellWidth;
            const gridH = this.g.rows * d.cellHeight;
            
            const drawW = gridW * s.stretchX * scale;
            const drawH = gridH * s.stretchY * scale;
            const drawX = (width - drawW) / 2;
            const drawY = (height - drawH) / 2; 
            
            scratchCtx.save();
            scratchCtx.imageSmoothingEnabled = (scale !== 1.0);
            scratchCtx.globalAlpha = 1.0; // Draw full opacity, alpha applied at end
            scratchCtx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
            scratchCtx.restore();
            
            // Apply Tint (If specified)
            if (tintColor) {
                scratchCtx.globalCompositeOperation = 'source-in';
                scratchCtx.fillStyle = tintColor;
                scratchCtx.fillRect(0, 0, width, height);
            }

            // Apply Mask
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(mask, 0, 0);
            
            // Draw to Main
            ctx.save();
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = this.alpha;
            
            // If tinting (border), maybe boost brightness/glow?
            if (tintColor) {
                ctx.globalCompositeOperation = 'screen'; // Make it pop
            }
            
            ctx.drawImage(this.scratchCanvas, 0, 0);
            ctx.restore();
        };

        // Draw Interior Characters (No tint, normal colors)
        drawZoomLayer(this.maskCanvas, this.zoomScale, null, this.snapshotCanvas);
        
        // --- Layer 2: Perimeter (Border) ---
        // 8x Zoom, Tinted with Perimeter Color, using Transparent Char Snapshot
        const perimeterZoom = 8.0;
        if (this.perimeterMaskCanvas && this.charSnapshotCanvas) {
            const pColor = this.getConfig('PerimeterColor') || '#FFD700';
            drawZoomLayer(this.perimeterMaskCanvas, perimeterZoom, pColor, this.charSnapshotCanvas);
        }
    }

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

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            let drawX, drawY, drawW, drawH;
            const topY = cy; 
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            drawY = topY; 
            drawH = widthY;
            drawX = leftX;
            drawW = rightX - leftX; 
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'S') {
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            drawY = bottomY - widthY; 
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
            drawX = leftX; 
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
            drawX = rightX - widthX; 
            drawW = widthX;
            drawY = topY;
            drawH = bottomY - topY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
            
            ctx.rect(drawX, drawY, drawW, drawH);
        }
    }

    _addBlock(blockStart, blockEnd, isExtending) {
        // Override to draw SOLID rectangles for the mask (Reveal the snapshot fully)
        const ctx = this.maskCtx;
        const l = this.layout;
        if (!l) return;

        const rangeMinBx = blockStart.x;
        const rangeMaxBx = blockEnd.x;
        const rangeMinBy = blockStart.y;
        const rangeMaxBy = blockEnd.y;

        const sCellX = Math.floor(rangeMinBx * l.cellPitchX);
        const sCellY = Math.floor(rangeMinBy * l.cellPitchY);
        const eCellX = Math.floor((rangeMaxBx + 1) * l.cellPitchX);
        const eCellY = Math.floor((rangeMaxBy + 1) * l.cellPitchY);

        const xPos = l.screenOriginX + (sCellX * l.screenStepX);
        const yPos = l.screenOriginY + (sCellY * l.screenStepY);
        const w = (eCellX - sCellX) * l.screenStepX;
        const h = (eCellY - sCellY) * l.screenStepY;

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        // Use slight inflate to ensure no gaps between adjacent blocks
        ctx.rect(xPos - 0.5, yPos - 0.5, w + 1.0, h + 1.0);
        ctx.fill();
    }
}