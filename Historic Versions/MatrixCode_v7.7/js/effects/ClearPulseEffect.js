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
    }

    trigger() {
        if (this.active) return false;
        
        const total = this.g.cols * this.g.rows;
        const s = this.c.state;
        const d = this.c.derived;
        const activeFonts = d.activeFonts;
        const numFonts = activeFonts.length;
        const fallbackChars = "MATRIX";

        // Snapshot colors and fill chars to avoid per-frame calculations
        this.snap = { 
            fillChars: new Uint16Array(total),
            fillFonts: new Uint8Array(total),
            colors: new Uint32Array(total),
            fonts: new Uint8Array(this.g.fonts)
        };

        for (let i = 0; i < total; i++) {
            // Snapshot Fill Char
            const fIdx = Math.floor(Math.random() * numFonts);
            this.snap.fillFonts[i] = fIdx;
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            if(chars && chars.length > 0) {
                 this.snap.fillChars[i] = chars[Math.floor(Math.random() * chars.length)].charCodeAt(0);
            } else {
                 this.snap.fillChars[i] = fallbackChars.charCodeAt(Math.floor(Math.random() * fallbackChars.length));
            }
            
            // Snapshot Color (Simulating the logic that was previously in getOverride)
            let rgb;
            const style = this.g.complexStyles.get(i);
            if(style) {
                rgb = Utils.hslToRgb(style.h, style.s, style.l);
            } else {
                rgb = d.streamRgb;
            }
            this.snap.colors[i] = Utils.packRgb(rgb.r, rgb.g, rgb.b);
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

        if (this.radius > maxDim + 400) { this.active = false; this.snap = null; this.renderData = null; return; }

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

        this.renderData = {
            ox, oy,
            radius: this.radius,
            radiusSq: this.radius * this.radius,
            innerEdge,
            innerEdgeSq: innerEdge * innerEdge,
            width,
            ratio,
            minX, maxX, minY, maxY
        };
    }

    getOverride(i) {
        if (!this.active || !this.snap || !this.renderData) return null;
        
        const s = this.c.state;
        const d = this.c.derived;
        const rd = this.renderData;

        const x = i % this.g.cols; 
        const y = Math.floor(i / this.g.cols);
        const cx = Math.floor(x * d.cellWidth * s.stretchX);
        const cy = Math.floor(y * d.cellHeight * s.stretchY);

        // 1. Outer AABB (Optimization)
        if (cx < rd.minX || cx > rd.maxX || cy < rd.minY || cy > rd.maxY) return null;

        // 2. Inner Hole Check (Optimization)
        if (rd.innerEdge > 0) {
            if (s.clearPulseCircular) {
                if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                    cy > rd.oy - rd.innerEdge && cy < rd.oy + rd.innerEdge) {
                    const dx = cx - rd.ox; const dy = cy - rd.oy;
                    if ((dx * dx + dy * dy) < rd.innerEdgeSq) return null;
                }
            } else {
                const rY = rd.innerEdge / rd.ratio;
                if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                    cy > rd.oy - rY && cy < rd.oy + rY) {
                    return null;
                }
            }
        }

        // 3. Distance Calculation
        let dist;
        if (s.clearPulseCircular) {
            const dx = cx - rd.ox; const dy = cy - rd.oy;
            dist = Math.sqrt(dx * dx + dy * dy);
        } else {
            const dx = Math.abs(cx - rd.ox);
            const dy = Math.abs(cy - rd.oy);
            dist = Math.max(dx, dy * rd.ratio);
        }

        // 4. Wave Bounds Check
        if (dist < rd.innerEdge || dist > rd.radius) return null;


        // Check Live Alpha to determine if cell is empty
        const alpha = this.g.alphas[i];
        const isGap = (alpha <= 0.01);

        if (s.clearPulsePreserveSpaces && isGap) return null;

        let char;
        let fontIdx;
        
        if (isGap) {
            // Fill the gap (Reveal effect) using snapshot
            char = String.fromCharCode(this.snap.fillChars[i]);
            fontIdx = this.snap.fillFonts[i];
        } else {
            // Use LIVE character (Flow continues)
            char = this.g.getChar(i);
            fontIdx = this.snap.fonts[i];
        }
        
        const activeFonts = this.c.derived.activeFonts;
        const fontData = activeFonts[fontIdx] || activeFonts[0];
        const fontName = fontData.name;

        // Color Calculation
        const tRgb = d.tracerRgb;
        const rel = Math.max(0, Math.min(1, (rd.radius - dist) / rd.width));
        
        let finalColor = `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`; 
        
        if (s.clearPulseBlend) { 
            // Use snapshot color which is pre-calculated for all cells (Stream or Style)
            const baseInt = this.snap.colors[i];
            const bR = (baseInt >> 16) & 0xFF; 
            const bG = (baseInt >> 8) & 0xFF; 
            const bB = baseInt & 0xFF;
            
            const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel);
            const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); 
            const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
            finalColor = `rgb(${mR},${mG},${mB})`;
        }

        const useSolid = isGap; 
        const useBlend = !isGap && s.clearPulseBlend;

        return { 
            char, 
            font: fontName,
            color: finalColor, 
            alpha: 1.0, 
            glow: Math.max(s.tracerGlow, 30 * (1.0 - rel)), 
            size: s.tracerSizeIncrease, 
            solid: useSolid, 
            blend: useBlend, 
            bgColor: '#000000' 
        };
    }
}
