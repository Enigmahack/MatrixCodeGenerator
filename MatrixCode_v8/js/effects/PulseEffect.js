class PulseEffect extends AbstractEffect {
    constructor(g, c) { 
        super(g, c); this.name = "Pulse"; 
        this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
        this.snap = null; this.autoTimer = c.state.pulseFrequencySeconds * 60;
        this.renderData = null; 
    }
    
    trigger() {
        if(this.active) return false;

        const total = this.g.cols * this.g.rows;
        
        // Snapshot the current grid state
        this.snap = { 
            chars: new Uint16Array(this.g.chars), 
            fontIndices: new Uint8Array(this.g.fontIndices),
            alphas: new Float32Array(this.g.alphas), 
            colors: new Uint32Array(this.g.colors), 
            tracers: new Uint8Array(total), 
            fillChars: new Uint16Array(total),
            fillFonts: new Uint8Array(total)
        };
        
        const d = this.c.derived; const s = this.c.state; const holdEnd = d.cycleDuration + d.holdFrames;
        const activeFonts = d.activeFonts;
        const numFonts = activeFonts.length;
        const fallbackChars = "MATRIX";

        for(let i=0; i<total; i++) {
            // Identify Tracer State
            const type = this.g.types[i]; 
            const age = this.g.ages[i];
            let isTracer = false;
            
            if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { 
                const at = age - 1; 
                if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { 
                    isTracer = true;
                } 
            }
            this.snap.tracers[i] = isTracer ? 1 : 0; 
            
            // Generate Fill Char/Font for gaps
            const fIdx = Math.floor(Math.random() * numFonts);
            this.snap.fillFonts[i] = fIdx;
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            if(chars && chars.length > 0) {
                this.snap.fillChars[i] = chars[Math.floor(Math.random() * chars.length)].charCodeAt(0);
            } else {
                this.snap.fillChars[i] = fallbackChars.charCodeAt(Math.floor(Math.random() * fallbackChars.length));
            }
        }
        
        let ox, oy;
        if (s.pulseRandomPosition) {
            ox = Utils.randomInt(this.g.cols*0.2, this.g.cols*0.8);
            oy = Utils.randomInt(this.g.rows*0.2, this.g.rows*0.8);
            const cx = Math.floor(this.g.cols / 2);
            const cy = Math.floor(this.g.rows / 2);
            const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
            const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
            if (pxDistX < s.pulseWidth && pxDistY < s.pulseWidth) { ox = cx; oy = cy; }
        } else {
            ox = Math.floor(this.g.cols/2);
            oy = Math.floor(this.g.rows/2);
        }
        this.origin = {x: ox, y: oy};

        this.active = true; this.state = 'WAITING'; this.timer = s.pulseDelaySeconds * 60; 
        this.radius = s.pulseInstantStart ? s.pulseWidth * 2 : 0; // Fix: Init radius correctly
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);
        
        return true; 
    }
    
    update() {
        const s = this.c.state;
        if(!this.active && s.pulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.pulseFrequencySeconds * 60; }
        if(!this.active) { this.renderData = null; return; }
        
        const d = this.c.derived;
        
        if(this.state === 'WAITING') { 
            if(--this.timer <= 0) { this.state = 'EXPANDING'; }
        } else {
            const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
            this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);
            this.radius += this.speed; 
            if(this.radius > maxDim + 400) { this.active = false; this.snap = null; this.renderData = null; return; }
        }

        // --- Pre-calc ---
        const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX); 
        const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
        const width = s.pulseWidth * 2; 
        const innerEdge = this.radius - width;
        
        let ratio = 1;
        if (!s.pulseCircular) {
            const canvasW = this.g.cols * d.cellWidth * s.stretchX;
            const canvasH = this.g.rows * d.cellHeight * s.stretchY;
            ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
        }

        let minX, maxX, minY, maxY;
        if (s.pulseCircular) {
            minX = ox - this.radius; maxX = ox + this.radius;
            minY = oy - this.radius; maxY = oy + this.radius;
        } else {
            minX = ox - this.radius; maxX = ox + this.radius;
            const rY = this.radius / ratio;
            minY = oy - rY; maxY = oy + rY;
        }

        this.renderData = { ox, oy, radius: this.radius, innerEdge, width, ratio, minX, maxX, minY, maxY };
    }

    applyToGrid(grid) {
        if (!this.active || !this.snap || !this.renderData) return;
        
        const s = this.c.state; 
        const d = this.c.derived;
        const rd = this.renderData;
        
        const tColorInt = d.tracerColorUint32;
        // Unpack tracer color for blending
        const tR = tColorInt & 0xFF;
        const tG = (tColorInt >> 8) & 0xFF;
        const tB = (tColorInt >> 16) & 0xFF;

        const total = grid.cols * grid.rows;
        
        for (let i = 0; i < total; i++) {
            // Optimization: Skip if we are waiting (Override whole screen efficiently)
            // But we need coordinate check for Expanding.
            
            let dist = 0;
            if (this.state === 'EXPANDING') {
                const x = i % grid.cols; 
                const y = Math.floor(i / grid.cols);
                const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                const cy = Math.floor(y * d.cellHeight * s.stretchY);

                if (s.pulseCircular) {
                    const dx = cx - rd.ox; const dy = cy - rd.oy;
                    dist = Math.sqrt(dx*dx + dy*dy);
                } else {
                    const dx = Math.abs(cx - rd.ox);
                    const dy = Math.abs(cy - rd.oy);
                    dist = Math.max(dx, dy * rd.ratio);
                }
                
                // Inside the hole: Reveal (Do nothing)
                if (dist < rd.innerEdge) continue;
            } else {
                // WAITING: dist is effectively Infinity (outside radius 0)
                dist = 999999;
            }

            // --- Override Logic ---
            const snAlpha = this.snap.alphas[i];
            let charCode = this.snap.chars[i];
            let fontIdx = this.snap.fontIndices[i];
            let color = this.snap.colors[i];
            
            const isTracer = (this.snap.tracers[i] === 1);
            const isGap = (snAlpha <= 0.01);

            if (isGap && !s.pulsePreserveSpaces) {
                charCode = this.snap.fillChars[i];
                fontIdx = this.snap.fillFonts[i];
            }

            if (this.state === 'WAITING' || dist > rd.radius) {
                // DIMMED SNAPSHOT
                if (isTracer && s.pulseIgnoreTracers) {
                    // Keep original tracer
                    grid.setOverride(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, s.tracerGlow);
                } else if (isGap) {
                     // Black gap
                     grid.setOverride(i, '', 0, 0, 0, 0); // Override with empty
                } else {
                    // Dimmed
                    grid.setOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0);
                }
            } else {
                // WAVE EDGE
                if (s.pulsePreserveSpaces && isGap) {
                    grid.setOverride(i, '', 0, 0, 0);
                } else {
                    const rel = Math.max(0, Math.min(1, (rd.radius - dist) / (s.pulseWidth * 2)));
                    
                    // Simple Logic: Bright Wave
                    // We can't easily do the "Fade In" overlay logic without alpha blending.
                    // We'll stick to Replacement.
                    
                    let finalColor = tColorInt;
                    if (s.pulseBlend) {
                        // Blend snapshot color with tracer color
                        const bR = color & 0xFF;
                        const bG = (color >> 8) & 0xFF;
                        const bB = (color >> 16) & 0xFF;
                        
                        const mR = Math.floor(tR + (bR - tR) * rel);
                        const mG = Math.floor(tG + (bG - tG) * rel);
                        const mB = Math.floor(tB + (bB - tB) * rel);
                        finalColor = Utils.packAbgr(mR, mG, mB);
                    }
                    
                    const actualGlow = Math.max(s.tracerGlow, 30 * (1.0 - rel));
                    grid.setOverride(i, String.fromCharCode(charCode), finalColor, 1.0, fontIdx, actualGlow);
                }
            }
        }
    }
}