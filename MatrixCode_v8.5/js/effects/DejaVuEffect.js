class DejaVuEffect extends AbstractEffect {
    constructor(g, c, r) { 
        super(g, c, r); 
        this.name = "DejaVu"; 
        this.active = false; 
        this.map = null;
        this.bars = [];
        this.timer = 0;
        
        // Sub-effect states
        this.vertGlitch = { active: false, timer: 0, srcX: 0, width: 4 };
        this.doubleGlitch = { active: false, timer: 0, startY: 0, h: 0, shiftX: 0 };
        this.horizGlitch = { active: false, timer: 0, rows: [], shift: 0, flash: false };
    }
    
    trigger(durationSeconds = null) { 
        if(this.active) return false; 
        this.active = true; 
        
        // Handle case where durationSeconds might be a boolean (e.g. true from UI/Keybinds)
        let seconds = (typeof durationSeconds === 'number') ? durationSeconds : this.c.state.dejaVuDurationSeconds;
        if (!seconds || seconds === true) seconds = 5; // Final fallback

        this.timer = Math.round(seconds * 60); 

        // Safety: ensure timer is at least 300 frames (5s) if somehow misconfigured
        if (this.timer < 60) this.timer = 300;
        
        if (this.c.get('logEffects')) {
            console.log(`[DejaVuEffect] Triggered. Config: ${this.c.state.dejaVuDurationSeconds}s, Passed: ${durationSeconds}, Final: ${seconds}s (${this.timer} frames)`);
        }
        
        this.bars = []; 
        this.map = new Uint8Array(this.g.rows); 
        
        // Reset sub-effects
        this.vertGlitch = { active: false, timer: 0, srcX: 0, width: 4 };
        this.doubleGlitch = { active: false, timer: 0, startY: 0, h: 0, shiftX: 0 };
        this.horizGlitch = { active: false, timer: 0, rows: [], shift: 0, flash: false };
        
        // Enable Glitch Shader via Orchestrator
        this._enableShader();

        return true; 
    }

    _enableShader() {
        if (this.shaderSlot) return;
        
        const glitchShader = `
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
varying vec2 vTexCoord;

float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }

void main() {
    vec2 uv = vTexCoord;
    vec4 color = texture2D(uTexture, uv);
    float t = floor(uTime * 15.0);
    
    if (rand(vec2(t, 1.0)) > 0.95) {
        float ry = rand(vec2(t, 2.0));
        float rh = rand(vec2(t, 3.0)) * 0.15; 
        
        if (uv.y > ry && uv.y < ry + rh) {
             float shift = (rand(vec2(t, 4.0)) - 0.5) * 0.02;
             float r = texture2D(uTexture, vec2(uv.x + shift + 0.003, uv.y)).r;
             float g = texture2D(uTexture, vec2(uv.x + shift, uv.y)).g;
             float b = texture2D(uTexture, vec2(uv.x + shift - 0.003, uv.y)).b;
             float a = texture2D(uTexture, vec2(uv.x + shift, uv.y)).a;
             color = vec4(r, g, b, a);
             if (rand(vec2(t, 5.0)) > 0.8) {
                float dir = (rand(vec2(t, 6.0)) > 0.5) ? 1.0 : -1.0;
                float jump = dir * (0.03 + rand(vec2(t, 7.0)) * 0.04);
                color = texture2D(uTexture, vec2(uv.x + jump, uv.y));
             }
        }
    }
    gl_FragColor = color;
}
`;
        this.shaderSlot = this.r.requestShaderSlot(this, glitchShader, 0.03);
    }

    _disableShader() {
        if (!this.shaderSlot) return;
        this.r.releaseShaderSlot(this);
        this.shaderSlot = null;
    }
    
    update() {
        if(!this.active) return;

        const s = this.c.state;
        const d = this.c.derived;

        this.timer--;
        if(this.timer <= 0) { 
            if (this.c.get('logEffects')) {
                console.log(`[DejaVuEffect] Timer finished. Deactivating.`);
            }
            this.active = false; 
            this.bars = []; 
            this.map = null; 
            this._disableShader();
            return; 
        }
        
        this.map.fill(0);
        
        const tracerColor = d.tracerColorUint32;
        
        if(Math.random() < s.dejaVuIntensity) {
            const h = Utils.randomInt(s.dejaVuMinRectHeight, s.dejaVuMaxRectHeight); 
            const y = Utils.randomInt(0, Math.max(0, this.g.rows - h));
            const duration = s.dejaVuBarDurationFrames + Utils.randomInt(-10, 10);
            
            this.bars.push({ y, h, age: 0, maxAge: duration });

            if (this.g.glowSystem) {
                // Use tracerColor for the glow instead of streamColor to match the "white" bars
                this.g.glowSystem.addRect(
                    this.g.cols / 2, y + (h / 2), this.g.cols, h, 2.5, tracerColor, duration, 'linear', 4
                );
            }
        }
        
        const rows = this.g.rows;
        for(let i=this.bars.length-1; i>=0; i--) {
            const b = this.bars[i]; 
            b.age++;
            if(b.age > b.maxAge) { this.bars.splice(i, 1); continue; } 
            const limit = Math.min(rows, b.y + b.h);
            for(let r=b.y; r < limit; r++) {
                this.map[r] = 1; 
            }
        }

        if (this.vertGlitch.active) {
            this.vertGlitch.timer--;
            if (this.vertGlitch.timer <= 0) this.vertGlitch.active = false;
        } else {
            if (Math.random() < 0.005) {
                this.vertGlitch.active = true;
                this.vertGlitch.timer = 15; 
                this.vertGlitch.width = Utils.randomInt(4, 7);
                this.vertGlitch.srcX = Utils.randomInt(0, this.g.cols - this.vertGlitch.width);
            }
        }

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

        if (this.horizGlitch.active) {
            this.horizGlitch.timer--;
            if (this.horizGlitch.timer <= 0) this.horizGlitch.active = false;
        } else {
            if (Math.random() < 0.005) {
                this.horizGlitch.active = true;
                this.horizGlitch.timer = Utils.randomInt(5, 10);
                this.horizGlitch.shift = Utils.randomInt(3, 10) * (Math.random() < 0.5 ? 1 : -1);
                this.horizGlitch.flash = Math.random() < 0.5;
                this.horizGlitch.rows = [];
                const count = Utils.randomInt(5, 20);
                for(let i=0; i<count; i++) {
                    this.horizGlitch.rows.push(Utils.randomInt(0, this.g.rows-1));
                }
            }
        }
    }
    
    applyToGrid(grid) {
        if(!this.active) return;
        if (!this.map) return;

        const s = this.c.state; 
        const d = this.c.derived;
        const cols = grid.cols;
        const tracerColor = d.tracerColorUint32;
        // holeBrightness is labeled 'Intensity' in UI, but 0.02 is too low for a "hidden map" look.
        // We boost it and ensure a minimum visibility for the "white" rectangles.
        const holeAlpha = Math.max(0.2, s.dejaVuHoleBrightness * 5.0);
        const activeFonts = d.activeFonts;
        const fallbackFontIdx = 0;
        const fallbackChars = activeFonts[0].chars;
        const timeSeed = Math.floor(Date.now() / 150);
        const randomizeColors = s.dejaVuRandomizeColors;

        for (let y = 0; y < grid.rows; y++) {
            if (this.map[y] === 1) {
                const rowOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    const baseAlpha = grid.alphas[i];
                    const fontIdx = grid.fontIndices[i];
                    
                    // Always scramble characters within the bars to show the "hidden character map"
                    const hash = (i ^ timeSeed) * 2654435761;
                    const rndIdx = (hash & 0x7FFFFFFF) % fallbackChars.length;
                    const char = fallbackChars[rndIdx];
                    
                    let finalAlpha = Math.max(holeAlpha, baseAlpha);
                    let color = tracerColor;

                    if (randomizeColors) {
                        const h = (hash % 360);
                        const rgb = Utils.hslToRgb(h, 90, 70);
                        color = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
                    }

                    // Use setHighPriorityEffect to ensure these blocks stand out against the simulation
                    grid.setHighPriorityEffect(i, char, color, finalAlpha, fallbackFontIdx, 0.5);
                }
            }
        }

        if (this.vertGlitch.active) {
            const { srcX, width } = this.vertGlitch;
            for (let y = 0; y < grid.rows; y++) {
                if (this.map[y] !== 1) continue;
                const rowOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const i = rowOffset + x;
                    const readX = srcX + (x % width);
                    if (readX >= cols) continue;
                    const readIdx = rowOffset + readX;
                    const char = grid.getChar(readIdx);
                    const alpha = grid.alphas[readIdx];
                    const fontIdx = grid.fontIndices[readIdx];
                    const color = tracerColor; 
                    grid.setHighPriorityEffect(i, char, color, alpha, fontIdx, grid.glows[readIdx]);
                }
            }
        }

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
                    const color = tracerColor;
                    grid.setHighPriorityEffect(i, char, color, alpha, fontIdx, grid.glows[readIdx]);
                }
            }
        }
        
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
                    
                    let char = grid.getChar(readIdx);
                    let alpha = grid.alphas[readIdx];
                    const fontIdx = grid.fontIndices[readIdx];
                    let color = grid.colors[readIdx];
                    let glow = grid.glows[readIdx];

                    const needsRandom = flash || (alpha < 0.1);

                    if (needsRandom && fallbackChars && fallbackChars.length > 0) {
                         const rndIdx = (Math.random() * fallbackChars.length) | 0;
                         char = fallbackChars[rndIdx];
                    }

                    if (flash) {
                        color = 0xFFFFFFFF; 
                        alpha = 1.0;
                        glow = 5.0; 
                    } else {
                         color = tracerColor;
                    }
                    
                    grid.setHighPriorityEffect(i, char, color, alpha, fontIdx, glow);
                }
            }
        }
    }
}


