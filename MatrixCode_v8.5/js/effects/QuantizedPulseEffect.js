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
        this.activeBlocks = [];
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
        this.activeBlocks = [];
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
        // Synced to simulation speed (cycleDuration)
        const cycleDuration = Math.max(1, this.c.derived.cycleDuration);
        this.cycleTimer++;

        if (this.cycleTimer >= cycleDuration) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;

            // Speed Check: 1 = Every cycle (Fast), 10 = Every 10 cycles (Slow)
            const delayCycles = Math.max(1, s.quantizedPulseSpeed || 1);
            
            if (this.cyclesCompleted >= delayCycles) {
                this.cyclesCompleted = 0;
                this._processAnimationStep();
            }
        }
    }

    _processAnimationStep() {
        // Placeholder Logic: Expand from center every cycle
        const grid = this.g;
        const s = this.c.state;
        if (!grid) return;

        // "Cells per Block" Logic
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);

        // Calculate total blocks covering the screen
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);

        const centerBlockX = Math.floor(blocksX / 2);
        const centerBlockY = Math.floor(blocksY / 2);
        
        // Phase 0: Center Block
        // Phase 1: 3x3 Block
        // Phase 2: 5x5 Block ...
        
        const radius = this.expansionPhase;
        const start = { x: centerBlockX - radius, y: centerBlockY - radius };
        const end = { x: centerBlockX + radius, y: centerBlockY + radius };

        // Determine if we are just extending the perimeter or filling
        // For this test, let's just add the new perimeter
        const isExtending = (this.expansionPhase > 0);
        
        // Add to active blocks list
        this.activeBlocks.push({ start, end, isExtending });
        
        // If extending, we might want to remove the inner face of the previous block
        // to merge them? For now, just layering perimeters.

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

        // Ensure offscreen canvases exist and are sized correctly
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        // Update the mask if necessary (resize or first run)
        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
            this._updateMask(width, height, s, d);
            this._maskDirty = false;
        }

        // 1. Render Text to Scratch Canvas (Always Active)
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        // Setup Text Style
        const visualFontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        scratchCtx.font = `${style}${weight} ${visualFontSize}px ${family}`;
        scratchCtx.textAlign = 'center';
        scratchCtx.textBaseline = 'middle';

        // Colors & Glow - Dynamic Saturation
        // Map glowStrength (0-10) to t (0.0-1.0)
        const t = Math.min(1.0, glowStrength / 10.0);
        
        // Interpolate Fill Color: Gold (255, 204, 0) -> White (255, 255, 255)
        const charR = 255;
        const charG = Math.floor(204 + (255 - 204) * t);
        const charB = Math.floor(0 + (255 - 0) * t);
        const charColor = `rgb(${charR}, ${charG}, ${charB})`;

        // Interpolate Glow Color: Pure Gold (#FFD700) -> White (#FFFFFF)
        // #FFD700 is rgb(255, 215, 0)
        const glowR = 255;
        const glowG = Math.floor(215 + (255 - 215) * t);
        const glowB = Math.floor(0 + (255 - 0) * t);
        const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;

        scratchCtx.fillStyle = charColor;
        
        // Loop Constants
        const grid = this.g;
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (width * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (height * 0.5);

        // Sparse Loop - Optimized for Dynamic Grid
        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        
        // Use "Cells per Block" settings directly for pitch
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);
        
        // Calculate total blocks based on grid size and pitch
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);

        // Set common drawing state
        // Alpha is purely based on the effect's fade, ignoring grid alpha
        scratchCtx.globalAlpha = this.alpha; 

        // Helper to draw a single character
        const drawChar = (x, y) => {
            if (x >= cols || y >= rows) return;
            const i = (y * cols) + x;
            
            let charCode = chars[i];
            // If empty, generate a RANDOM character (Matrix Static)
            if (charCode <= 32) {
                // Match Rotator Frequency
                const rotatorCycle = d.rotatorCycleFrames || 20;
                const timeSeed = Math.floor(this.animFrame / rotatorCycle);
                
                // Stable hash per cell per cycle
                const hash = (i * 12345 + timeSeed * 67890);
                charCode = 0x30A0 + (hash % 96); 
            }

            const cx = screenOriginX + (x * screenStepX);
            const cy = screenOriginY + (y * screenStepY);
            
            scratchCtx.setTransform(s.stretchX, 0, 0, s.stretchY, cx, cy);
            scratchCtx.fillText(String.fromCharCode(charCode), 0, 0);
        };

        // 1. Draw Horizontal Lines (Rows)
        // We iterate block boundaries (0 to blocksY)
        for (let by = 0; by <= blocksY; by++) {
            const y = Math.floor(by * cellPitchY);
            if (y >= rows) continue; // Skip if off-grid
            
            for (let x = 0; x < cols; x++) {
                drawChar(x, y);
            }
        }

        // 2. Draw Vertical Lines (Cols)
        // Avoid re-drawing intersections if possible, but overdraw is cheap here
        for (let bx = 0; bx <= blocksX; bx++) {
            const x = Math.floor(bx * cellPitchX);
            if (x >= cols) continue;

            for (let y = 0; y < rows; y++) {
                // Optimization: Don't redraw intersections we just drew in Horizontal loop
                // Intersection happens when y is also a block boundary
                // Checking float equality with tolerance or just re-drawing. 
                // Re-drawing is faster than math check in JS usually.
                drawChar(x, y);
            }
        }
        
        // Reset Transform
        scratchCtx.setTransform(1, 0, 0, 1, 0, 0);

        // 2. Apply Mask (Keep only what overlaps the grid lines)
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.globalAlpha = 1.0; // Reset alpha for masking
        scratchCtx.drawImage(this.maskCanvas, 0, 0);

        // 3. Composite to Main Canvas
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1.0;
        
        // Apply Outer Glow here
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
        ctx.fillStyle = '#FFFFFF'; // Opaque mask
        
        // Calculate screen steps (visible cell dimensions)
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;

        // Line thickness is 1/4 of the cell size
        const lineWidthX = screenStepX * 0.25;
        const lineWidthY = screenStepY * 0.25;
        
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;

        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);

        // Dynamic Grid Calculation
        // User specifies how many cells wide/high each block is.
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);
        
        // Note: Layout no longer needs blocksX/blocksY for drawing, only pitch.
        // But we store pitch for the helper functions.

        // Store layout for dynamic block addition
        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY
        };

        // Render Active Blocks
        if (this.activeBlocks && this.activeBlocks.length > 0) {
            for (const b of this.activeBlocks) {
                this._addBlock(b.start, b.end, b.isExtending);
            }
        }
    }

    /**
     * Dynamically adds a grid block region to the mask.
     * @param {Object} blockStart - {x, y} grid block indices
     * @param {Object} blockEnd - {x, y} grid block indices
     * @param {boolean} isExtending - If true, draws only the perimeter (hollow). If false, draws full grid.
     */
    _addBlock(blockStart, blockEnd, isExtending) {
        if (!this.maskCtx || !this.layout) return;

        const ctx = this.maskCtx;
        const l = this.layout;

        // Calculate Loop Ranges (in grid cell units)
        // We use Math.floor/ceil to map block index -> cell index
        // This distributes rounding errors reasonably well
        const startX = Math.floor(blockStart.x * l.cellPitchX);
        const endX = Math.floor((blockEnd.x + 1) * l.cellPitchX);
        const startY = Math.floor(blockStart.y * l.cellPitchY);
        const endY = Math.floor((blockEnd.y + 1) * l.cellPitchY);
        
        // Determine "Block Pitch" for internal grid lines (sub-blocks?)
        // The user request implies the "Block" IS the grid unit.
        // So we draw lines at the block boundaries.
        // If we want lines *inside* the blocks, that's different.
        // Assuming the user wants to see the grid OF these blocks.
        
        // However, the original code drew a grid of cells. 
        // If the block is 10x10 cells, do we draw 100 squares or 1 big square?
        // "Quantized Pulse" usually implies large chunky blocks.
        // Let's assume we draw the border of the block, and maybe the internal lines?
        // Original code: pitch=4, drew rects.
        // "Make the grid 5x4" -> The *visible* grid is 5x4.
        // So we only draw lines at the block boundaries.
        
        const blockStepX = l.cellPitchX; // In cells
        const blockStepY = l.cellPitchY; // In cells

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        if (isExtending) {
            // PERIMETER ONLY (Draw outer box)
            // Top Line
            let cy = l.screenOriginY + (startY * l.screenStepY);
            ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
            
            // Bottom Line
            cy = l.screenOriginY + (endY * l.screenStepY);
            ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);

            // Left Line
            let cx = l.screenOriginX + (startX * l.screenStepX);
            ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);

            // Right Line
            cx = l.screenOriginX + (endX * l.screenStepX);
            ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
        } else {
            // FULL GRID (Draw all block boundaries within range)
            
            // Note: We iterate by BLOCK index, not cell index, to match the visual grid
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;

            // Verticals
            for (let bx = rangeMinBx; bx <= rangeMaxBx + 1; bx++) {
                const cellX = Math.floor(bx * l.cellPitchX);
                const cx = l.screenOriginX + (cellX * l.screenStepX);
                const yPos = l.screenOriginY + (startY * l.screenStepY);
                const h = (endY - startY) * l.screenStepY;
                ctx.rect(cx - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
            }

            // Horizontals
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
     * Removes the specified face (border line) from blocks in the given range,
     * BUT strictly preserves the outer boundary of the range itself.
     * Effectively merges internal blocks by removing shared edges.
     * 
     * @param {Object} blockStart - {x, y}
     * @param {Object} blockEnd - {x, y}
     * @param {string} face - 'N', 'S', 'E', 'W'
     */
    _removeBlockFace(blockStart, blockEnd, face) {
        if (!this.maskCtx || !this.layout) return;

        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();

        // Normalize Range
        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();

        // Iterate through all blocks in range
        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                
                // VALIDATION: Skip if this face is the Exterior Border of the Range
                if (f === 'N' && by === minY) continue;
                if (f === 'S' && by === maxY) continue;
                if (f === 'W' && bx === minX) continue;
                if (f === 'E' && bx === maxX) continue;

                // Calculate Coordinates for this block
                // Block Grid Coords -> Pixel Coords
                // North Line: at by*pitch
                // South Line: at (by+1)*pitch
                // West Line: at bx*pitch
                // East Line: at (bx+1)*pitch

                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);

                // Corners (Perpendicular line overlap safety)
                // We shrink the erase rect by lineWidth so we don't cut the corners
                const safeX = l.lineWidthX; 
                const safeY = l.lineWidthY; 

                if (f === 'N') {
                    // Remove Top Line of this block
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX; // Skip left corner
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2); // Skip right corner
                    ctx.rect(left, cy - l.halfLineY, width, l.lineWidthY);
                }
                else if (f === 'S') {
                    // Remove Bottom Line
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY, width, l.lineWidthY);
                }
                else if (f === 'W') {
                    // Remove Left Line
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY; // Skip top corner
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2); // Skip bottom corner
                    ctx.rect(cx - l.halfLineX, top, l.lineWidthX, height);
                }
                else if (f === 'E') {
                    // Remove Right Line
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX, top, l.lineWidthX, height);
                }
            }
        }

        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }}
