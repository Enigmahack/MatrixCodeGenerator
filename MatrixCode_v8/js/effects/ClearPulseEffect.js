class ClearPulseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "ClearPulse";
        this.active = false;
        this.origin = { x: 0, y: 0 };
        this.radius = 0;
        this.snap = null;
        this.autoTimer = c.state.clearPulseFrequencySeconds * 60;
        this.renderData = null;
        // this.originalFade = 0;
    }

    trigger() {
        if (this.active) return false;
        
        // Override Stream Fade
        // this.originalFade = this.c.get('decayFadeDurationFrames');
        // this.c.set('decayFadeDurationFrames', 0);

        const total = this.g.cols * this.g.rows;
        const s = this.c.state;
        const d = this.c.derived;
        const activeFonts = d.activeFonts;
        const numFonts = activeFonts.length;
        const fallbackChars = "MATRIX";

        // Snapshot colors and fill chars
        this.snap = { 
            fillChars: new Uint16Array(total),
            fillFonts: new Uint8Array(total),
            colors: new Uint32Array(this.g.colors) // Use current grid colors
        };

        for (let i = 0; i < total; i++) {
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
        if (s.clearPulseRandomPosition) {
            ox = Utils.randomInt(this.g.cols * 0.2, this.g.cols * 0.8);
            oy = Utils.randomInt(this.g.rows * 0.2, this.g.rows * 0.8);
            const cx = Math.floor(this.g.cols / 2);
            const cy = Math.floor(this.g.rows / 2);
            const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
            const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
            if (pxDistX < s.clearPulseWidth && pxDistY < s.clearPulseWidth) { ox = cx; oy = cy; }
        } else {
            ox = Math.floor(this.g.cols / 2);
            oy = Math.floor(this.g.rows / 2);
        }
        this.origin = { x: ox, y: oy };

        this.active = true;
        this.radius = s.clearPulseInstantStart ? s.clearPulseWidth * 2 : 0;
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.clearPulseDurationSeconds * 60);
        return true;
    }

    update() {
        const s = this.c.state;
        if (!this.active && s.clearPulseEnabled && this.autoTimer-- <= 0) {
            this.trigger();
            this.autoTimer = s.clearPulseFrequencySeconds * 60;
        }
        if (!this.active) { this.renderData = null; return; }

        this.radius += this.speed;
        const d = this.c.derived;
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);

        if (this.radius > maxDim + 400) { 
            this.active = false; 
            this.snap = null; 
            this.renderData = null; 
            // this.c.set('decayFadeDurationFrames', this.originalFade);
            return; 
        }

        // --- Optimization Pre-calc ---
        const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX);
        const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
        const width = s.clearPulseWidth * 2;
        const innerEdge = this.radius - width;

        let ratio = 1;
        if (!s.clearPulseCircular) {
            const canvasW = this.g.cols * d.cellWidth * s.stretchX;
            const canvasH = this.g.rows * d.cellHeight * s.stretchY;
            ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
        }

        let minX, maxX, minY, maxY;
        if (s.clearPulseCircular) {
            minX = ox - this.radius; maxX = ox + this.radius;
            minY = oy - this.radius; maxY = oy + this.radius;
        } else {
            minX = ox - this.radius; maxX = ox + this.radius;
            const rY = this.radius / ratio;
            minY = oy - rY; maxY = oy + rY;
        }

        this.renderData = { ox, oy, radius: this.radius, radiusSq: this.radius*this.radius, innerEdge, innerEdgeSq: innerEdge*innerEdge, width, ratio, minX, maxX, minY, maxY };
    }

    applyToGrid(grid) {
        if (!this.active || !this.snap || !this.renderData) return;
        
        const s = this.c.state;
        const d = this.c.derived;
        const rd = this.renderData;
        const total = grid.cols * grid.rows;
        
        const tColorInt = d.tracerColorUint32;
        const tR = tColorInt & 0xFF;
        const tG = (tColorInt >> 8) & 0xFF;
        const tB = (tColorInt >> 16) & 0xFF;

        for (let i = 0; i < total; i++) {
            // Optimization: AABB Check
            const x = i % grid.cols; 
            const y = Math.floor(i / grid.cols);
            const cx = Math.floor(x * d.cellWidth * s.stretchX);
            const cy = Math.floor(y * d.cellHeight * s.stretchY);

            if (cx < rd.minX || cx > rd.maxX || cy < rd.minY || cy > rd.maxY) continue;

            // Inner Hole Check
            if (rd.innerEdge > 0) {
                if (s.clearPulseCircular) {
                    if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                        cy > rd.oy - rd.innerEdge && cy < rd.oy + rd.innerEdge) {
                        const dx = cx - rd.ox; const dy = cy - rd.oy;
                        if ((dx * dx + dy * dy) < rd.innerEdgeSq) continue;
                    }
                } else {
                    const rY = rd.innerEdge / rd.ratio;
                    if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                        cy > rd.oy - rY && cy < rd.oy + rY) {
                        continue;
                    }
                }
            }

            // Distance
            let dist;
            if (s.clearPulseCircular) {
                const dx = cx - rd.ox; const dy = cy - rd.oy;
                dist = Math.sqrt(dx * dx + dy * dy);
            } else {
                const dx = Math.abs(cx - rd.ox);
                const dy = Math.abs(cy - rd.oy);
                dist = Math.max(dx, dy * rd.ratio);
            }

            if (dist < rd.innerEdge || dist > rd.radius) continue;

            // --- Apply Override ---
            const alpha = grid.alphas[i];
            const isGap = (alpha <= 0.01);

            if (s.clearPulsePreserveSpaces && isGap) continue;

            let charCode, fontIdx, color;
            
            // Use LIVE grid data to prevent freezing
            if (isGap) {
                // For gaps, use the snapshot fill data (or just random, but snapshot is stable)
                charCode = this.snap.fillChars[i];
                fontIdx = this.snap.fillFonts[i];
                color = d.streamColorUint32;
            } else {
                charCode = grid.chars[i];
                fontIdx = grid.fontIndices[i];
                color = grid.colors[i];
            }

            const rel = Math.max(0, Math.min(1, (rd.radius - dist) / rd.width));
            
            let finalColor, glow;

            if (!s.clearPulseBlend) {
                // Blend OFF: Solid Tracer Color & Glow
                finalColor = tColorInt;
                glow = s.tracerGlow;
            } else {
                // Blend ON: Linear fade across the entire wave
                
                // Color Blend
                const bR = color & 0xFF;
                const bG = (color >> 8) & 0xFF;
                const bB = (color >> 16) & 0xFF;
                
                const mR = Math.floor(tR + (bR - tR) * rel);
                const mG = Math.floor(tG + (bG - tG) * rel);
                const mB = Math.floor(tB + (bB - tB) * rel);
                finalColor = Utils.packAbgr(mR, mG, mB);

                // Glow Fade: Max -> 0
                glow = 30 * (1.0 - rel);
            }
            
            // Solid Alpha 1.0
            grid.setEffectOverride(i, String.fromCharCode(charCode), finalColor, 1.0, fontIdx, glow);
        }
    }
}
