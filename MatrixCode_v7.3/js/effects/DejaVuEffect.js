class DejaVuEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); 
                this.name = "DejaVu"; 
                this.active = false; 
                this.autoTimer = c.state.dejaVuFrequencySeconds * 60; 
                this.map = null; 
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
                
                // Generate new bars
                if(Math.random() < s.dejaVuIntensity) {
                    const h = Utils.randomInt(s.dejaVuMinRectHeight, s.dejaVuMaxRectHeight); 
                    const y = Utils.randomInt(0, Math.max(0, this.g.rows - h));
                    this.bars.push({ y, h, age: 0, maxAge: s.dejaVuBarDurationFrames + Utils.randomInt(-10, 10) });
                }
                
                // Update bars and populate row map
                for(let i=this.bars.length-1; i>=0; i--) {
                    const b = this.bars[i]; b.age++;
                    if(b.age > b.maxAge) {
                        this.bars.splice(i, 1); 
                    } else { 
                        const limit = Math.min(this.g.rows, b.y + b.h);
                        for(let r=b.y; r < limit; r++) this.map[r] = 1; 
                    }
                }
                
                // Apply glitches to active rows (Mutation logic)
                // Optimization: Iterate only active rows instead of full grid scan?
                // Actually the logic below iterates ALL rows. We can optimize this.
                // Iterate only bars.
                for (const b of this.bars) {
                    const limit = Math.min(this.g.rows, b.y + b.h);
                    for(let y=b.y; y < limit; y++) {
                        // Random glitch in this row
                        // Iterate columns? No, just pick random columns.
                        // Original logic: for(x=0 to cols) if(random < 0.1).
                        // This is 10% of the row.
                        // Better: Pick random X (cols * 0.1) times.
                        const glitchCount = Math.floor(this.g.cols * 0.1);
                        for(let k=0; k<glitchCount; k++) {
                            const x = Utils.randomInt(0, this.g.cols);
                            const i = this.g.getIndex(x, y);
                            // Apply glitch
                            this.g.rotatorProg[i] = 0; 
                            const c = Utils.getRandomChar(); 
                            this.g.setChar(i, c);
                            if(s.dejaVuRandomizeColors) {
                                this.g.complexStyles.set(i, { h: Utils.randomInt(0,360), s: 90, l: 70, glitched: true });
                            }
                        }
                    }
                }
            }
            
            getOverride(i) {
                if(!this.active || !this.map) return null;
                
                // Optimization: Map lookup is O(1) array access.
                // However, we need 'y'.
                const y = Math.floor(i / this.g.cols);
                
                // Fast rejection
                if(this.map[y] === 0) return null;

                const s = this.c.state; 
                const alpha = this.g.alphas[i] < 0.1 ? s.dejaVuHoleBrightness : 1.0; 
                if(alpha < 0.01) return null;
                
                return { 
                    char: this.g.getChar(i), 
                    color: this.c.derived.tracerColorStr, 
                    alpha, 
                    glow: 20 * alpha, 
                    size: 2 
                };
            }
        }