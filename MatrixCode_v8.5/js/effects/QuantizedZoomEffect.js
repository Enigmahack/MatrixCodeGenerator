class QuantizedZoomEffect extends QuantizedBaseEffect {
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
        this.logicScale = 3.0; 
        
        this.useShadowWorld = false;
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

        // Start in WAITING state to allow screenshot capture to stabilize
        this.state = 'WAITING';
        this.timer = 60; // 1 Second Delay
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
            
            // Use erosion/innerLine logic to match GenerateEffect style
            // Allow Zoom-specific config, fallback to standard Generate defaults (0.2, 1)
            const erosionRate = (this.c.state.quantizedZoomErosionRate !== undefined) ? this.c.state.quantizedZoomErosionRate : 0.2;
            const innerLineDuration = (this.c.state.quantizedZoomInnerLineDuration !== undefined) ? this.c.state.quantizedZoomInnerLineDuration : 1;
            
            // Calculate seed position relative to the screen within the scaled grid
            // logicGridH is 3.0x screen height. We want to start at the bottom of the screen portion.
            const bs = this.getBlockSize();
            const cellPitchY = Math.max(1, bs.h);
            const blocksY = Math.ceil(this.g.rows / cellPitchY); // Screen height in blocks
            const scaledH = this.logicGridH;
            const offY = Math.floor((scaledH - blocksY) / 2); // Top offset
            
            const seedX = Math.floor(this.logicGridW / 2);
            // Start at the bottom of the visible screen area (offY + blocksY)
            const seedY = Math.min(this.logicGridH - 1, offY + blocksY); 
            
            // Check for pre-loaded animation sequence (from super.trigger loading matrixPatterns)
            let initialSequence = null;
            if (this.sequence && this.sequence.length > 1) {
                initialSequence = this.sequence;
            }

                        this.sequence = generator.generate(this.logicGridW, this.logicGridH, 1000, {
                            seedX, 
                            seedY,
                            erosionRate, 
                            innerLineDuration,
                            initialSequence
                        });            console.log(`[QuantizedZoom] Sequence: ${this.sequence.length} steps.`);
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

        // 0. WAITING State (Delay Start)
        if (this.state === 'WAITING') {
            this.timer--;
            if (this.timer <= 0) {
                this.state = 'FADE_IN';
                this.timer = 0;
                this.alpha = 0.0;
            }
            return; // Skip update while waiting
        }

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        // Use quantizedZoomSpeed: Higher value = Faster updates (Lower interval)
        const speed = (s.quantizedZoomSpeed !== undefined) ? s.quantizedZoomSpeed : 1.0;
        const effectiveInterval = Math.max(1, baseDuration / Math.max(0.1, speed)); 

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
                        super.updateTransition(false);
                    }        }

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
        const durationFrames = ((s.quantizedZoomDurationSeconds !== undefined) ? s.quantizedZoomDurationSeconds : 5.0) * fps;
        
        if (this.state === 'FADE_IN') {
            this.timer++;
            this.alpha = Math.min(1.0, this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.timer = 0; // Reset timer for sustain duration
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++;
            this.alpha = 1.0;

            // Run strictly for duration, independent of sequence progress
            if (this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.fadeTimer = 0;
            }
        } else if (this.state === 'HOLD') {
            // Deprecated state, but kept for logic safety if manually set
            this.state = 'FADE_OUT';
            this.fadeTimer = 0;
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

    // _updateMask removed to use Base implementation

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;
        if (!this.hasCaptured || !this.snapshotCanvas) return;

        const s = this.c.state;
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); 

        // Update masks
        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        const scratchCtx = this.scratchCtx;
        
        // --- Layer 1: Interior (Zoom Window) ---
        // 1A. Draw Solid Background (Black/BG Color) masked by Window
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
            scratchCtx.globalAlpha = 1.0; 
            scratchCtx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
            scratchCtx.restore();
            
            if (tintColor) {
                scratchCtx.globalCompositeOperation = 'source-in';
                scratchCtx.fillStyle = tintColor;
                scratchCtx.fillRect(0, 0, width, height);
            }

            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(mask, 0, 0);
            
            ctx.save();
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = this.alpha;
            if (tintColor) ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(this.scratchCanvas, 0, 0);
            ctx.restore();
        };

        // Draw Interior Characters
        drawZoomLayer(this.maskCanvas, this.zoomScale, null, this.snapshotCanvas);
        
        // --- Layer 2: Overlay (Border + Lines) ---
        const pColor = this.getConfig('PerimeterColor') || '#FFD700';
        const iColor = this.getConfig('InnerColor') || '#00FF00';

        // Ensure Grid Cache (Dense Characters) is updated
        this._updateGridCache(width, height, s, d);

        // Helper to draw a masked layer with dense code texture
        const drawCodeLayer = (maskCanvas, color) => {
            if (!maskCanvas) return;
            scratchCtx.globalCompositeOperation = 'source-over';
            scratchCtx.clearRect(0, 0, width, height);
            
            // 1. Draw Dense Code Grid
            scratchCtx.globalAlpha = 1.0;
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            
            // 2. Tint
            scratchCtx.globalCompositeOperation = 'source-in';
            scratchCtx.fillStyle = color;
            scratchCtx.fillRect(0, 0, width, height);
            
            // 3. Mask
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(maskCanvas, 0, 0);

            // 4. Composite to Screen
            ctx.save();
            ctx.globalAlpha = this.alpha;
            
            // Glow
            ctx.globalCompositeOperation = 'screen';
            ctx.shadowColor = color;
            ctx.shadowBlur = 10; 
            ctx.drawImage(this.scratchCanvas, 0, 0);
            
            // Solid
            ctx.globalCompositeOperation = 'source-over';
            ctx.shadowBlur = 0;
            ctx.drawImage(this.scratchCanvas, 0, 0);
            
            ctx.restore();
        };

        // Draw Interior Lines (Green/Cyan)
        if (this.lineMaskCanvas) {
             drawCodeLayer(this.lineMaskCanvas, iColor);
        }

        // Draw Perimeter (Gold)
        if (this.perimeterMaskCanvas) {
             drawCodeLayer(this.perimeterMaskCanvas, pColor);
        }
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
        if (!this.gridCacheCanvas) {
            this.gridCacheCanvas = document.createElement('canvas');
            this.gridCacheCtx = this.gridCacheCanvas.getContext('2d');
        }
        if (!this.perimeterMaskCanvas) {
            this.perimeterMaskCanvas = document.createElement('canvas');
            this.perimeterMaskCtx = this.perimeterMaskCanvas.getContext('2d');
        }
        if (!this.lineMaskCanvas) {
            this.lineMaskCanvas = document.createElement('canvas');
            this.lineMaskCtx = this.lineMaskCanvas.getContext('2d');
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
        if (this.gridCacheCanvas.width !== w || this.gridCacheCanvas.height !== h) {
            this.gridCacheCanvas.width = w;
            this.gridCacheCanvas.height = h;
            this.lastGridSeed = -1; 
        }
        if (this.perimeterMaskCanvas.width !== w || this.perimeterMaskCanvas.height !== h) {
            this.perimeterMaskCanvas.width = w;
            this.perimeterMaskCanvas.height = h;
        }
        if (this.lineMaskCanvas.width !== w || this.lineMaskCanvas.height !== h) {
            this.lineMaskCanvas.width = w;
            this.lineMaskCanvas.height = h;
        }
        
        // RenderGrid Sizing (SCALED)
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        
        if (blocksX && blocksY) {
            const requiredSize = blocksX * blocksY;
            if (!this.renderGrid || this.renderGrid.length !== requiredSize) {
                 this.renderGrid = new Int32Array(requiredSize);
                 this.renderGrid.fill(-1);
                 // We must mark logic dirty so it repopulates if resized
                 // But typically renderGrid is populated by _updateRenderGridLogic
            }
        }
    }
}