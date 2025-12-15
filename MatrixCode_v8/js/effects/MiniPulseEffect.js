class MiniPulseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "MiniPulse";
        this.active = false;
        this.sessionTimer = 0;
        this.autoTimer = c.state.miniPulseFrequencySeconds * 60;
        this.pulses = [];
        this.renderPulses = [];
    }

    trigger() {
        if (this.active) return false;
        this.active = true;
        this.sessionTimer = this.c.state.miniPulseDurationSeconds * 60;
        this.pulses = [];
        return true;
    }

    update() {
        const s = this.c.state;
        const d = this.c.derived;

        if (!this.active && s.miniPulseEnabled && this.autoTimer-- <= 0) {
            this.trigger();
            this.autoTimer = s.miniPulseFrequencySeconds * 60;
        }

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

        for (const p of this.renderPulses) {
            const startCol = Math.max(0, Math.floor(p.minX / cW));
            const endCol = Math.min(grid.cols, Math.ceil(p.maxX / cW));
            const startRow = Math.max(0, Math.floor(p.minY / cH));
            const endRow = Math.min(grid.rows, Math.ceil(p.maxY / cH));

            for (let y = startRow; y < endRow; y++) {
                const rowOffset = y * grid.cols;
                for (let x = startCol; x < endCol; x++) {
                    const i = rowOffset + x;
                    
                    // Skip empty cells (No scrambling)
                    const baseAlpha = grid.alphas[i];
                    if (baseAlpha <= 0.01) continue;

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

                    // Blend Tracer Color -> Stream Color
                    // Ratio: lifeFade. 1.0 = Tracer. 0.0 = Stream.
                    const streamColor = grid.colors[i];
                    const sR = streamColor & 0xFF;
                    const sG = (streamColor >> 8) & 0xFF;
                    const sB = (streamColor >> 16) & 0xFF;
                    
                    const mR = Math.floor(sR + (tR - sR) * lifeFade);
                    const mG = Math.floor(sG + (tG - sG) * lifeFade);
                    const mB = Math.floor(sB + (tB - sB) * lifeFade);
                    
                    const finalColor = Utils.packAbgr(mR, mG, mB);
                    const glow = s.tracerGlow * lifeFade;
                    
                    // Override acts as a "Lighting" layer here.
                    // We use existing char and font.
                    // We use existing alpha to preserve fade state.
                    grid.setOverride(i, grid.getChar(i), finalColor, baseAlpha, grid.fontIndices[i], glow);
                }
            }
        }
    }
}
