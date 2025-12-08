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
                // Optimization: Use cached active fonts list
                const activeFonts = this.c.derived.activeFonts;
                
                for (const b of this.bars) {
                    const limit = Math.min(this.g.rows, b.y + b.h);
                    const glitchCount = Math.max(1, Math.floor(this.g.cols * 0.05)); // Reduced density for perf

                    for(let y=b.y; y < limit; y++) {
                        for(let k=0; k<glitchCount; k++) {
                            const x = Utils.randomInt(0, this.g.cols - 1);
                            const i = y * this.g.cols + x; // Direct index calculation
                            
                            // Apply glitch
                            this.g.rotatorProg[i] = 0; 
                            
                            // Pick from active fonts
                            const fontData = activeFonts[Utils.randomInt(0, activeFonts.length - 1)];
                            const char = fontData.chars[Utils.randomInt(0, fontData.chars.length - 1)];
                            
                            this.g.setChar(i, char);
                            // We don't strictly need to setFont here as we want the glitch to look like a raw data error, 
                            // but setting it ensures the char renders correctly if using a custom font.
                            // However, MatrixGrid doesn't easily support setting font by object ref, we need index.
                            // Finding index of `fontData` in `activeFonts`...
                            // Optimization: just pick random index first.
                            
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
                const y = Math.floor(i / this.g.cols);
                
                // Fast rejection
                if(this.map[y] === 0) return null;

                const s = this.c.state; 
                // Fix: Preserve existing alpha for active cells to maintain trail gradients
                const baseAlpha = this.g.alphas[i];
                const alpha = baseAlpha < 0.1 ? s.dejaVuHoleBrightness : baseAlpha; 
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
