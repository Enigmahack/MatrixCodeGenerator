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
    }

    trigger() {
        if (this.active) return false;
        
        const s = this.c.state;
        if (!s.quantizedPulseEnabled) return false;

        this.active = true;
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        
        // Offset slightly (1/2 cell to overlap characters effectively)
        // Fixed offset as per "offset slightly" - avoiding random to keep it structured "Quantized"
        // But "overlaps the current characters" implies it shouldn't be perfectly between them.
        // If we align with cell centers, we maximize overlap.
        // We'll calculate exact pixels in applyToGrid to ensure responsiveness to resize.
        this.offsetX = 0.5; // Fraction of cell width
        this.offsetY = 0.5; // Fraction of cell height

        return true;
    }

    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        // Lifecycle State Machine
        // Frames for Fades
        const fadeInFrames = Math.max(1, s.quantizedPulseFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedPulseFadeFrames);
        const durationFrames = s.quantizedPulseDurationSeconds * fps;
        
        // Helper to clamp alpha
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
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }

    render(ctx, d) {
        if (!this.active || this.alpha <= 0.01) return;

        const s = this.c.state;
        const grid = this.g;
        const total = grid.cols * grid.rows;

        // 1. Grid Properties
        // "Grid lines will be 1/4 the width of the current font px height"
        const fontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const lineWidth = fontSize * 0.25;
        const halfLine = lineWidth / 2;

        const cellW = d.cellWidth * s.stretchX;
        const cellH = d.cellHeight * s.stretchY;

        // Pitch in pixels (4x4 chars)
        const pitchX = 4 * cellW;
        const pitchY = 4 * cellH;

        // Offsets for Line Logic (0.5 cell width/height)
        const pixelOffsetX = cellW * 0.5;
        const pixelOffsetY = cellH * 0.5;

        // Screen Centering Logic (Match WebGL Vertex Shader)
        const canvasW = ctx.canvas.width;
        const canvasH = ctx.canvas.height;
        const gridPixW = grid.cols * d.cellWidth; // Unstretched Grid Size
        const gridPixH = grid.rows * d.cellHeight;
        
        // Font Offsets (Unstretched)
        const fOffX = s.fontOffsetX;
        const fOffY = s.fontOffsetY;

        // 2. Context Setup
        ctx.save();
        
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        ctx.font = `${style}${weight} ${fontSize}px ${family}`;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillStyle = '#FFD700';
        
        const glowStrength = s.quantizedPulseBorderIllumination || 0;
        if (glowStrength > 0) {
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = glowStrength * this.alpha;
        }
        
        ctx.globalAlpha = this.alpha;

        // 3. Render Loop
        for (let i = 0; i < total; i++) {
            if (grid.alphas[i] <= 0.05) continue;
            const charCode = grid.chars[i];
            if (charCode <= 32) continue; 

            const x = i % grid.cols;
            const y = Math.floor(i / grid.cols);

            // --- Coordinate Calculation (Matches WebGL) ---
            // 1. Base Position (Center of Cell in Grid Space)
            const baseCX = (x * d.cellWidth) + (d.cellWidth * 0.5) + fOffX;
            const baseCY = (y * d.cellHeight) + (d.cellHeight * 0.5) + fOffY;
            
            // 2. Center Grid around (0,0)
            const centeredX = baseCX - (gridPixW * 0.5);
            const centeredY = baseCY - (gridPixH * 0.5);
            
            // 3. Stretch and Re-center to Screen
            const cx = (centeredX * s.stretchX) + (canvasW * 0.5);
            const cy = (centeredY * s.stretchY) + (canvasH * 0.5);

            // --- Grid Line Logic (Relative to Screen Cell Position) ---
            // Calculate relative offset from the "start" of the virtual grid on screen.
            // Virtual Grid 0,0 is at Screen (cx for col 0, cy for row 0).
            // But we can just work relative to the current cell center.
            // We want lines at indices 0, 4, 8... 
            // Relative to cell center, the "local grid start" is (cx - pixelOffsetX).
            // We want to find the nearest grid line to THIS cell center.
            
            // Note: The grid lines must be fixed in space relative to the grid structure, 
            // not floating.
            // We treat the "Global Grid" as aligned such that Column 0 is index 0.
            // So for Column X, we look for lines based on X % 4.
            // Actually, we calculated 'pitchX' based on pixel width.
            // It's safer to use Column Indices for "Hit" logic to avoid floating point drift,
            // then map that Hit to screen pixels.

            // Logic Update: Determine hit based on INDEX, draw based on SCREEN PIXELS.
            // Vertical Line: Occurs every 4 columns. 
            // We want lines overlap characters. "Overlaps the current characters".
            // Previous logic: line at center of 4x4 block boundary?
            // "Grid lines will be 1/4 width... grid boxes 4x4".
            // Let's assume lines are at Col 0, 4, 8...
            // If Col % 4 == 0? 
            // Or between Col 3 and 4?
            // "Overlaps the current characters". So the line is ON TOP of a column.
            // Let's say lines are centered on Columns 0, 4, 8...
            
            // Distance Check in Pixels (Screen Space)
            // We need to define where the lines are in Screen Space.
            // If lines are attached to cols 0, 4, 8... they are at center of those cols.
            // So if x % 4 == 0, there is a vertical line at cx.
            // We want to draw if `abs(screenX - lineX) < halfLine`.
            // But if the line is exactly at cx, then `dist = 0`.
            // What if we are at x=1? Distance is `1 * cellW`.
            // So we check `distance to nearest multiple of 4 columns`.
            
            // X Distance
            // Closest multiple of 4 to x
            const nearestColMul4 = Math.round(x / 4) * 4;
            const distInCols = Math.abs(x - nearestColMul4);
            const distInPixelsX = distInCols * cellW;
            const hitV = distInPixelsX < halfLine; // Using 1/4 font size width
            
            // Y Distance
            const nearestRowMul4 = Math.round(y / 4) * 4;
            const distInRows = Math.abs(y - nearestRowMul4);
            const distInPixelsY = distInRows * cellH;
            const hitH = distInPixelsY < halfLine;

            if (hitV || hitH) {
                const char = String.fromCharCode(charCode);

                ctx.save();
                ctx.beginPath();

                // Define Clip Rects
                // Cell Boundary on Screen
                const cellLeft = cx - (cellW * 0.5);
                const cellTop = cy - (cellH * 0.5);
                
                if (hitV) {
                    // Vertical Strip
                    // The line is at the center of the nearest column (nearestColMul4).
                    // We need the screen X of that column.
                    // But simpler: We are checking if THIS cell intersects the line.
                    // If hitV is true, the line is "close enough" to cx.
                    // The line is at `cx + (nearestColMul4 - x) * cellW`.
                    // Example: x=3, nearest=4. Line is at x+1. `cx + cellW`.
                    // Example: x=4, nearest=4. Line is at x. `cx`.
                    
                    const lineScreenX = cx + (nearestColMul4 - x) * cellW;
                    ctx.rect(lineScreenX - halfLine, cellTop, lineWidth, cellH);
                }
                
                if (hitH) {
                    const lineScreenY = cy + (nearestRowMul4 - y) * cellH;
                    ctx.rect(cellLeft, lineScreenY - halfLine, cellW, lineWidth);
                }
                
                ctx.clip();
                
                // Draw
                ctx.globalAlpha = this.alpha * grid.alphas[i];
                ctx.fillText(char, cx, cy);
                
                ctx.restore();
            }
        }
        
        ctx.restore();
    }
}
