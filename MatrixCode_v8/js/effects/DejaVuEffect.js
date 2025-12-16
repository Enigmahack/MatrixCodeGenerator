class DejaVuEffect extends AbstractEffect {
    constructor(g, c) { 
        super(g, c); 
        this.name = "DejaVu"; 
        this.active = false; 
        this.autoTimer = c.state.dejaVuFrequencySeconds * 60; 
        this.map = null;
        this.bars = [];
    }
    
    trigger() { 
        if(this.active) return false; 
        this.active = true; 
        this.timer = this.c.state.dejaVuDurationSeconds * 60; 
        this.bars = []; 
        this.map = new Uint8Array(this.g.rows); 
        return true; 
    }
    
    update() {
        const s = this.c.state;
        if(!this.active && s.dejaVuEnabled && s.dejaVuAutoMode && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.dejaVuFrequencySeconds * 60; }
        if(!this.active) return;
        if(this.timer-- <= 0) { this.active = false; this.bars = []; this.map = null; return; }
        
        this.map.fill(0);
        
        // Spawn bars
        if(Math.random() < s.dejaVuIntensity) {
            const h = Utils.randomInt(s.dejaVuMinRectHeight, s.dejaVuMaxRectHeight); 
            const y = Utils.randomInt(0, Math.max(0, this.g.rows - h));
            const duration = s.dejaVuBarDurationFrames + Utils.randomInt(-10, 10);
            
            this.bars.push({ y, h, age: 0, maxAge: duration });

            // Add Glow Effect
            if (this.g.glowSystem) {
                this.g.glowSystem.addRect(
                    this.g.cols / 2, // Center X
                    y + (h / 2),     // Center Y
                    this.g.cols,     // Width
                    h,               // Height
                    2.0,             // Intensity
                    0xFF00FF00,      // Green (0xAABBGGRR) -> 00(R) FF(G) 00(B) FF(A) -> 0xFF00FF00
                    duration,
                    'linear',
                    4                // Soft Edge
                );
            }
        }
        
        const activeFonts = this.c.derived.activeFonts;
        const glitchCount = Math.max(1, Math.floor(this.g.cols * 0.05));
        const cols = this.g.cols;
        const rows = this.g.rows;
        const randomizeColors = s.dejaVuRandomizeColors;
        
        for(let i=this.bars.length-1; i>=0; i--) {
            const b = this.bars[i]; 
            b.age++;
            
            if(b.age > b.maxAge) {
                this.bars.splice(i, 1); 
                continue;
            } 
            
            const limit = Math.min(rows, b.y + b.h);
            
            for(let r=b.y; r < limit; r++) {
                this.map[r] = 1; 
                
                // Apply glitches (Randomly change content of cells in the bar)
                for(let k=0; k<glitchCount; k++) {
                    const x = (Math.random() * cols) | 0;
                    const idx = r * cols + x;
                    
                    this.g.mix[idx] = 0; 
                    
                    const fontIdx = (Math.random() * activeFonts.length) | 0;
                    const fontData = activeFonts[fontIdx];
                    const chars = fontData.chars;
                    
                    if (chars && chars.length > 0) {
                        const char = chars[(Math.random() * chars.length) | 0];
                        
                        // Preserve existing color/alpha/glow unless randomizing
                        let color = this.g.colors[idx];
                        const alpha = this.g.alphas[idx];
                        const glow = this.g.glows[idx];
                        
                        if(randomizeColors) {
                            const h = (Math.random() * 360) | 0;
                            const rgb = Utils.hslToRgb(h, 90, 70);
                            color = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
                            // Set complex style so SimulationSystem can maintain it (if desired)
                            this.g.complexStyles.set(idx, { h, s: 90, l: 70, glitched: true });
                            
                            // Fix: Update baseColors so SimulationSystem doesn't overwrite it
                            this.g.baseColors[idx] = color;
                        }
                        
                        this.g.setPrimary(idx, char, color, alpha, fontIdx, glow);
                    }
                }
            }
        }
    }
    
    applyToGrid(grid) {
        if(!this.active || !this.map) return;
        
        const s = this.c.state; 
        const d = this.c.derived;
        const cols = grid.cols;
        const tracerColor = d.tracerColorUint32;
        const holeBrightness = s.dejaVuHoleBrightness; // UI Label: "Intensity"

        // For filling gaps, we need a fallback char
        // We can use a random char from the first active font
        const activeFonts = d.activeFonts;
        const fallbackFontIdx = 0;
        const fallbackChars = activeFonts[0].chars;

        for (let y = 0; y < grid.rows; y++) {
            if (this.map[y] === 1) {
                const rowOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    
                    const baseAlpha = grid.alphas[i];
                    const char = grid.getChar(i);
                    const fontIdx = grid.fontIndices[i];
                    
                    if (baseAlpha < 0.01) {
                        // INACTIVE CELL (Space)
                        // Light up based on Intensity (HoleBrightness)
                        if (holeBrightness > 0.01) {
                            // Use a random character instead of the fallback/empty one
                            if (fallbackChars && fallbackChars.length > 0) {
                                const rndIdx = (Math.random() * fallbackChars.length) | 0;
                                grid.setOverride(i, fallbackChars[rndIdx], tracerColor, holeBrightness, fallbackFontIdx, 0);
                            } else {
                                grid.setOverride(i, char, tracerColor, holeBrightness, fallbackFontIdx, 0);
                            }
                        }
                    } else {
                        // ACTIVE CELL (Stream)
                        // Light up based on Tracer Color
                        grid.setOverride(i, char, tracerColor, baseAlpha, fontIdx, 0);
                    }
                }
            }
        }
    }
}
