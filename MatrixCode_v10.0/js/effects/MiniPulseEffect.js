class MiniPulseEffect extends AbstractEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "MiniPulse";
        this.active = false;
        this.sessionTimer = 0;
        this.pulses = [];
        this.renderPulses = [];
    }

    trigger(force = false) {
        if (this.active && !force) return false;

        const isEnabled = this.c.get('miniPulseEnabled');
        if (!isEnabled && !force) return false;

        this.active = true;
        this.sessionTimer = this.c.state.miniPulseDurationSeconds * 60;
        this.pulses = [];
        return true;
    }

    stop() {
        this.active = false;
        this.pulses = [];
        this.renderPulses = [];
    }

    update() {
        const s = this.c.state;
        const d = this.c.derived;

        if (this.active) {
            this.sessionTimer--;
            if (Math.random() < s.miniPulseSpawnChance) {
                this.pulses.push({
                    x: Utils.randomInt(0, this.g.cols),
                    y: Utils.randomInt(0, this.g.rows),
                    r: 0,
                    maxR: s.miniPulseSize,
                    speed: s.miniPulseSpeed
                });
            }
            if (this.sessionTimer <= 0 && this.pulses.length === 0) this.active = false;
        }

        this.renderPulses = [];

        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i];
            p.r += p.speed;

            if (p.r > p.maxR + 100) {
                this.pulses.splice(i, 1);
                continue;
            }

            const ox = (p.x * d.cellWidth * s.stretchX) + (d.cellWidth * s.stretchX * 0.5);
            const oy = (p.y * d.cellHeight * s.stretchY) + (d.cellHeight * s.stretchY * 0.5);

            const minX = ox - p.r;
            const maxX = ox + p.r;
            const minY = oy - p.r;
            const maxY = oy + p.r;

            const rSq = p.r * p.r;
            const innerEdge = Math.max(0, p.r - s.miniPulseThickness);
            const innerEdgeSq = innerEdge * innerEdge;

            this.renderPulses.push({
                ox, oy,
                minX, maxX, minY, maxY,
                r: p.r,
                rSq,
                innerEdge,
                innerEdgeSq,
                maxR: p.maxR
            });
        }
    }

    applyToGrid(grid) {
        if (!this.active || this.renderPulses.length === 0) return;

        const s = this.c.state;
        const d = this.c.derived;
        const cW = d.cellWidth * s.stretchX;
        const cH = d.cellHeight * s.stretchY;
        const tracerColor = d.tracerColorUint32;
        
        // Unpack Tracer Color for blending
        const tR = tracerColor & 0xFF;
        const tG = (tracerColor >> 8) & 0xFF;
        const tB = (tracerColor >> 16) & 0xFF;

        const activeFonts = d.activeFonts;
        const streamColor = d.streamColorUint32;
        const scR = streamColor & 0xFF;
        const scG = (streamColor >> 8) & 0xFF;
        const scB = (streamColor >> 16) & 0xFF;

        for (const p of this.renderPulses) {
            const startCol = Math.max(0, Math.floor(p.minX / cW));
            const endCol = Math.min(grid.cols, Math.ceil(p.maxX / cW));
            const startRow = Math.max(0, Math.floor(p.minY / cH));
            const endRow = Math.min(grid.rows, Math.ceil(p.maxY / cH));

            for (let y = startRow; y < endRow; y++) {
                const rowOffset = y * grid.cols;
                for (let x = startCol; x < endCol; x++) {
                    const i = rowOffset + x;

                    const baseAlpha = grid.alphas[i];
                    const isGap = (baseAlpha <= 0.01);

                    // Preserve Spaces: skip gaps entirely
                    if (s.miniPulsePreserveSpaces && isGap) continue;

                    const cx = (x * cW) + (cW * 0.5);
                    const cy = (y * cH) + (cH * 0.5);

                    if (s.pulseCircular !== false) {
                        const dx = cx - p.ox;
                        const dy = cy - p.oy;
                        const distSq = (dx * dx) + (dy * dy);
                        if (distSq > p.rSq || distSq < p.innerEdgeSq) continue;
                    } else {
                        const dist = Math.max(Math.abs(cx - p.ox), Math.abs(cy - p.oy));
                        if (dist > p.r || dist < p.innerEdge) continue;
                    }

                    // Hit!
                    let lifeFade = 1.0;
                    if (p.r > p.maxR) lifeFade = Math.max(0, 1.0 - ((p.r - p.maxR) / 100));

                    if (lifeFade <= 0.01) continue;

                    // Determine char/font/color for this cell
                    let charStr, fontIdx, cellColor;
                    if (isGap) {
                        // Fill gap with random character for solid barrier
                        fontIdx = grid.fontIndices[i] || 0;
                        const fontData = activeFonts[fontIdx] || activeFonts[0];
                        charStr = fontData.chars[Math.floor(Math.random() * fontData.chars.length)];
                        cellColor = streamColor;
                    } else {
                        charStr = grid.getChar(i);
                        fontIdx = grid.fontIndices[i];
                        cellColor = grid.colors[i];
                    }

                    // Blend cell color -> tracer color based on lifeFade
                    const cR = cellColor & 0xFF;
                    const cG = (cellColor >> 8) & 0xFF;
                    const cB = (cellColor >> 16) & 0xFF;

                    const mR = Math.floor(cR + (tR - cR) * lifeFade);
                    const mG = Math.floor(cG + (tG - cG) * lifeFade);
                    const mB = Math.floor(cB + (tB - cB) * lifeFade);

                    const finalColor = Utils.packAbgr(mR, mG, mB);
                    const baseGlow = s.tracerGlow * lifeFade;
                    const glow = (s.miniPulseUseTracerGlow) ? baseGlow : 0;

                    if (lifeFade >= 1.0) {
                        // Full strength: solid override
                        grid.setEffectOverride(i, charStr, finalColor, 1.0, fontIdx, glow);
                    } else {
                        // Fading out: overlay so the live grid bleeds through
                        grid.setEffectOverlay(i, charStr, finalColor, lifeFade, fontIdx, glow);
                    }
                }
            }
        }
    }
}


