class DejaVuEffect extends AbstractEffect {
            constructor(g, c) { super(g, c); this.name = "DejaVu"; this.active = false; this.autoTimer = c.state.dejaVuFrequencySeconds * 60; this.map = null; }
            trigger() { if(this.active) return false; this.active = true; this.timer = this.c.state.dejaVuDurationSeconds * 60; this.bars = []; this.map = new Uint8Array(this.g.rows); return true; }
            update() {
                const s = this.c.state;
                if(!this.active && s.dejaVuEnabled && s.dejaVuAutoMode && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.dejaVuFrequencySeconds * 60; }
                if(!this.active) return;
                if(this.timer-- <= 0) { this.active = false; this.bars = []; this.map = null; return; }
                this.map.fill(0);
                if(Math.random() < s.dejaVuIntensity) {
                    const h = Utils.randomInt(s.dejaVuMinRectHeight, s.dejaVuMaxRectHeight); const y = Utils.randomInt(0, Math.max(0, this.g.rows - h));
                    this.bars.push({ y, h, age: 0, maxAge: s.dejaVuBarDurationFrames + Utils.randomInt(-10, 10) });
                }
                for(let i=this.bars.length-1; i>=0; i--) {
                    const b = this.bars[i]; b.age++;
                    if(b.age > b.maxAge) this.bars.splice(i, 1); else { for(let r=b.y; r < b.y+b.h && r < this.g.rows; r++) this.map[r] = 1; }
                }
                for(let y=0; y<this.g.rows; y++) {
                    if(this.map[y] === 1) {
                        for(let x=0; x<this.g.cols; x++) {
                            if(Math.random() < 0.1) {
                                const i = this.g.getIndex(x, y); this.g.rotatorProg[i] = 0; const c = Utils.getRandomChar(); this.g.setChar(i, c);
                                if(s.dejaVuRandomizeColors) this.g.complexStyles.set(i, { h: Utils.randomInt(0,360), s: 90, l: 70, glitched: true });
                            }
                        }
                    }
                }
            }
            getOverride(i) {
                if(!this.active || !this.map) return null;
                const y = Math.floor(i / this.g.cols);
                if(this.map[y] === 1) {
                    const s = this.c.state; const alpha = this.g.alphas[i] < 0.1 ? s.dejaVuHoleBrightness : 1.0; if(alpha < 0.01) return null;
                    return { char: this.g.getChar(i), color: this.c.derived.tracerColorStr, alpha, glow: 20 * alpha, size: 2 };
                }
                return null;
            }
        }

        // =========================================================================
        // 6. RENDERER
        // =========================================================================
