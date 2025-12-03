class MiniPulseEffect extends AbstractEffect {
            constructor(g, c) {
                super(g, c); this.name = "MiniPulse"; this.active = false; this.sessionTimer = 0; this.autoTimer = c.state.miniPulseFrequencySeconds * 60; this.pulses = []; 
            }
            trigger() { if(this.active) return false; this.active = true; this.sessionTimer = this.c.state.miniPulseDurationSeconds * 60; this.pulses = []; return true; }
            update() {
                const s = this.c.state;
                if (!this.active && s.miniPulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.miniPulseFrequencySeconds * 60; }
                if (this.active) {
                    this.sessionTimer--;
                    if (Math.random() < s.miniPulseSpawnChance) { this.pulses.push({ x: Utils.randomInt(0, this.g.cols), y: Utils.randomInt(0, this.g.rows), r: 0, maxR: s.miniPulseSize, speed: s.miniPulseSpeed }); }
                    if (this.sessionTimer <= 0 && this.pulses.length === 0) this.active = false;
                }
                for (let i = this.pulses.length - 1; i >= 0; i--) { const p = this.pulses[i]; p.r += p.speed; if (p.r > p.maxR + 100) this.pulses.splice(i, 1); }
            }
            getOverride(i) {
                if (this.pulses.length === 0) return null;
                const s = this.c.state; const d = this.c.derived;
                const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                const cx = (x * d.cellWidth * s.stretchX); const cy = (y * d.cellHeight * s.stretchY);
                for (const p of this.pulses) {
                    const ox = (p.x * d.cellWidth * s.stretchX); const oy = (p.y * d.cellHeight * s.stretchY);
                    let dist = s.pulseCircular ? Math.sqrt(Math.pow(cx - ox, 2) + Math.pow(cy - oy, 2)) : Math.max(Math.abs(cx - ox), Math.abs(cy - oy));
                    const innerEdge = p.r - s.miniPulseThickness;
                    if (dist <= p.r && dist >= innerEdge) {
                        let fade = 1.0;
                        if(p.r > p.maxR) fade = Math.max(0, 1.0 - ((p.r - p.maxR) / 100));
                        let char = this.g.getChar(i);
                        if (this.g.alphas[i] <= 0.05) { const glitchIndex = (i + Math.floor(p.r)) % Utils.CHARS.length; char = Utils.CHARS[glitchIndex]; }
                        return { char: char, color: d.tracerColorStr, alpha: fade, glow: s.tracerGlow * fade, size: s.tracerSizeIncrease, solid: false };
                    }
                }
                return null;
            }
        }
