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
        if (!this.active || this.alpha <= 0.01) return;

        const s = this.c.state;
        const d = this.c.derived;
        const total = grid.cols * grid.rows;

        // 1. Grid Properties
        // "Grid lines will be 1/4 the width of the current font px height"
        // lineWidth = fontSize * 0.25
        const lineWidth = s.fontSize * 0.25;
        const halfLine = lineWidth / 2;

        // Pitch in pixels
        // 4x4 characters
        const pitchX = 4 * d.cellWidth * s.stretchX;
        const pitchY = 4 * d.cellHeight * s.stretchY;

        // Offsets in pixels
        // "offset slightly". 
        // Let's use the 0.5 fraction established in trigger, converted to pixels.
        // Actually, to ensure overlap, we want the line to pass through the *center* of some cells.
        // If we offset by 0, lines are at 0, 4, 8... (Left edge of col 0, 4, 8).
        // Center of Col 0 is at 0.5 * cellWidth.
        // If we want the line to overlap characters, we should align it with cell centers?
        // Let's try aligning to the center of the 4x4 block boundary + a slight shift.
        // Let's just use a fixed small pixel offset + the grid logic.
        // Let's stick to the prompt: "Grid lines will be offset slightly".
        // We'll calculate intersection based on cell centers.
        
        // We will define the grid lines in screen space.
        // Vertical lines at: X = (k * pitchX) + pixelOffsetX
        // Horizontal lines at: Y = (k * pitchY) + pixelOffsetY
        const pixelOffsetX = d.cellWidth * 0.5; 
        const pixelOffsetY = d.cellHeight * 0.5;

        // 2. Color
        // Gold: #FFD700
        // We need it in ABGR for setHighPriorityEffect (which expects Uint32)
        // Utils.packAbgr(r, g, b, a)
        // Gold RGB: 255, 215, 0
        const goldColor = Utils.packAbgr(255, 215, 0); 
        const glowAmount = s.quantizedPulseBorderIllumination;

        // Iterate all cells
        for (let i = 0; i < total; i++) {
            // Optimization: Skip empty cells ("Black space will remain black space")
            // Check current alpha in grid
            const currentAlpha = grid.alphas[i];
            if (currentAlpha <= 0.05) continue;

            const x = i % grid.cols;
            const y = Math.floor(i / grid.cols);

            // Calculate Center of this cell in pixels
            const cx = (x * d.cellWidth * s.stretchX) + (d.cellWidth * s.stretchX * 0.5);
            const cy = (y * d.cellHeight * s.stretchY) + (d.cellHeight * s.stretchY * 0.5);

            // Check distance to nearest vertical line
            // X relative to grid
            const relX = (cx - pixelOffsetX) % pitchX;
            // Distance is min(relX, pitchX - relX)
            // But % can be negative if offset > cx, so use Math.abs or ensure positive
            // Since we start from 0, cx is usually > offset.
            // (a % n + n) % n handles negatives
            const distX = Math.min(
                Math.abs((cx - pixelOffsetX) % pitchX),
                Math.abs(pitchX - ((cx - pixelOffsetX) % pitchX))
            );

            // Check distance to nearest horizontal line
            const distY = Math.min(
                Math.abs((cy - pixelOffsetY) % pitchY),
                Math.abs(pitchY - ((cy - pixelOffsetY) % pitchY))
            );

            // Intersect if distance < halfLine
            const intersectsX = distX < halfLine;
            const intersectsY = distY < halfLine;

            if (intersectsX || intersectsY) {
                // Apply Effect
                // We want to overlay Gold, but preserve the char.
                // grid.chars[i] is the code.
                // We assume we want to override the color.
                
                // Existing char
                const charCode = grid.chars[i];
                const char = String.fromCharCode(charCode);
                const fontIdx = grid.fontIndices[i];
                
                // Calculate final alpha based on effect alpha * cell alpha (don't make invisible cells visible, but we already skipped them)
                // Actually, if we want "Black space remains black", we multiply by currentAlpha?
                // The prompt says "Glow only where the characters intersect".
                // We typically use the Grid's mechanism.
                // setHighPriorityEffect overrides everything.
                
                // If we want to blend or just replace?
                // "Glow should make the character illumination that intersects with the line a gold color."
                // Implies replacement of color.
                
                grid.setHighPriorityEffect(i, char, goldColor, currentAlpha * this.alpha, fontIdx, glowAmount * this.alpha);
            }
        }
    }
}
