class DejaVuEffect extends AbstractEffect {
    constructor(g, c) { 
        super(g, c); 
        this.name = "DejaVu"; 
        this.active = false; 
        this.autoTimer = c.state.dejaVuFrequencySeconds * 60; 
        this.map = null;
        this.bars = [];
        
        // Sub-effect states
        this.vertGlitch = { active: false, timer: 0, srcX: 0, width: 4 };
        this.doubleGlitch = { active: false, timer: 0, startY: 0, h: 0, shiftX: 0 };
        this.horizGlitch = { active: false, timer: 0, rows: [], shift: 0, flash: false };
    }
    
    trigger() { 
        if(this.active) return false; 
        this.active = true; 
        this.timer = this.c.state.dejaVuDurationSeconds * 60; 
        this.bars = []; 
        this.map = new Uint8Array(this.g.rows); 
        
        // Reset sub-effects
        this.vertGlitch = { active: false, timer: 0, srcX: 0, width: 4 };
        this.doubleGlitch = { active: false, timer: 0, startY: 0, h: 0, shiftX: 0 };
        this.horizGlitch = { active: false, timer: 0, rows: [], shift: 0, flash: false };
        
        return true; 
    }
    
    update() {
        const s = this.c.state;
        if(!this.active && s.dejaVuEnabled && s.dejaVuAutoMode && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.dejaVuFrequencySeconds * 60; }
        if(!this.active) return;
        if(this.timer-- <= 0) { this.active = false; this.bars = []; this.map = null; return; }
        
        this.map.fill(0);
        
        // --- 1. Update Existing Bars Logic ---
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

        // --- 2. Update Sub-Effects ---
        
        // Vertical Glitch (Stripes)
        if (this.vertGlitch.active) {
            this.vertGlitch.timer--;
            if (this.vertGlitch.timer <= 0) this.vertGlitch.active = false;
        } else {
            // Random Trigger: Slightly less often (was 0.01)
            if (Math.random() < 0.005) {
                this.vertGlitch.active = true;
                this.vertGlitch.timer = 15; // 0.25s at 60fps
                this.vertGlitch.width = Utils.randomInt(4, 7); // Wider stripes (was 4-5)
                this.vertGlitch.srcX = Utils.randomInt(0, this.g.cols - this.vertGlitch.width);
            }
        }

        // Doubling Effect
        if (this.doubleGlitch.active) {
            this.doubleGlitch.timer--;
            if (this.doubleGlitch.timer <= 0) this.doubleGlitch.active = false;
        } else {
            if (Math.random() < 0.015) {
                this.doubleGlitch.active = true;
                this.doubleGlitch.timer = Utils.randomInt(5, 15);
                this.doubleGlitch.h = Math.floor(this.g.rows / 3);
                this.doubleGlitch.startY = Utils.randomInt(0, this.g.rows - this.doubleGlitch.h);
                this.doubleGlitch.shiftX = Utils.randomInt(5, 20) * (Math.random() < 0.5 ? 1 : -1);
            }
        }

        // Horizontal Glitch (Flashy)
        if (this.horizGlitch.active) {
            this.horizGlitch.timer--;
            if (this.horizGlitch.timer <= 0) this.horizGlitch.active = false;
        } else {
            if (Math.random() < 0.01) {
                this.horizGlitch.active = true;
                this.horizGlitch.timer = Utils.randomInt(5, 10);
                this.horizGlitch.shift = Utils.randomInt(3, 10) * (Math.random() < 0.5 ? 1 : -1);
                this.horizGlitch.flash = Math.random() < 0.5; // "Not all flashes"
                
                // Pick random rows (scattered)
                this.horizGlitch.rows = [];
                const count = Utils.randomInt(5, 20);
                for(let i=0; i<count; i++) {
                    this.horizGlitch.rows.push(Utils.randomInt(0, this.g.rows-1));
                }
            }
        }
    }
    
    applyToGrid(grid) {
        if(!this.active) return; // map is valid if active (or cleared)
        if (!this.map) return;

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

        // Use a stable time seed for slower updates (approx 6 updates/sec)
        const timeSeed = Math.floor(Date.now() / 150);

        // 1. Standard Deja Vu Bars (The main effect)
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
                                // Stable pseudo-random selection based on index and time window
                                const hash = (i ^ timeSeed) * 2654435761;
                                const rndIdx = (hash & 0x7FFFFFFF) % fallbackChars.length;
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

        // 2. Global Glitches (Overrides on top)
        
        // Vertical Glitch (Stripes)
        if (this.vertGlitch.active) {
            const { srcX, width } = this.vertGlitch;
            for (let y = 0; y < grid.rows; y++) {
                const rowOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    const readX = srcX + (x % width);
                    if (readX >= cols) continue;
                    const readIdx = rowOffset + readX;
                    
                    const char = grid.getChar(readIdx);
                    const alpha = grid.alphas[readIdx];
                    const fontIdx = grid.fontIndices[readIdx];
                    
                    // Impose Deja Vu Color (Tracer Color) to show "rewriting"
                    const color = tracerColor; 
                    
                    grid.setOverride(i, char, color, alpha, fontIdx, grid.glows[readIdx]);
                }
            }
        }

        // Doubling Glitch
        if (this.doubleGlitch.active) {
            const { startY, h, shiftX } = this.doubleGlitch;
            const endY = Math.min(grid.rows, startY + h);
            for (let y = startY; y < endY; y++) {
                const rowOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    let readX = x - shiftX;
                    if (readX < 0) readX += cols;
                    if (readX >= cols) readX -= cols;
                    const readIdx = rowOffset + readX;
                    
                    const char = grid.getChar(readIdx);
                    const alpha = grid.alphas[readIdx];
                    const fontIdx = grid.fontIndices[readIdx];
                    
                    // Impose Deja Vu Color (Tracer Color)
                    const color = tracerColor;

                    grid.setOverride(i, char, color, alpha, fontIdx, grid.glows[readIdx]);
                }
            }
        }
        
        // Horizontal Glitch
        if (this.horizGlitch.active) {
            const { rows, shift, flash } = this.horizGlitch;
            for (const r of rows) {
                if (r >= grid.rows) continue;
                const rowOffset = r * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    let readX = x - shift;
                    if (readX < 0) readX += cols;
                    if (readX >= cols) readX -= cols;
                    const readIdx = rowOffset + readX;
                    const char = grid.getChar(readIdx);
                    let alpha = grid.alphas[readIdx];
                    const fontIdx = grid.fontIndices[readIdx];
                    let color = grid.colors[readIdx];
                    let glow = grid.glows[readIdx];

                    if (flash) {
                        color = 0xFFFFFFFF; // White
                        alpha = 1.0;
                        glow = 5.0; 
                    } else {
                         // Optional: Impose Tracer Color here too for non-flashes?
                         // "the deja vu block color should also impose across some effects"
                         // I'll leave horizontal as-is (Crash style) or tint it slightly.
                         // Let's force tracerColor for non-flash horizontal glitches too.
                         color = tracerColor;
                    }
                    
                    grid.setOverride(i, char, color, alpha, fontIdx, glow);
                }
            }
        }
    }
}
