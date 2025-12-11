class DejaVuEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); 
                this.name = "DejaVu"; 
                this.active = false; 
                this.autoTimer = c.state.dejaVuFrequencySeconds * 60; 
                this.map = null;
                // Reusable object to prevent GC thrashing
                this._retObj = { 
                    char: '', color: '', alpha: 0, glow: 0, size: 0 
                }; 
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
                
                // Cache derived values
                const activeFonts = this.c.derived.activeFonts;
                const glitchCount = Math.max(1, Math.floor(this.g.cols * 0.05));
                const cols = this.g.cols;
                const rows = this.g.rows;
                const randomizeColors = s.dejaVuRandomizeColors;
                
                // Single pass for update, map fill, and glitch application
                for(let i=this.bars.length-1; i>=0; i--) {
                    const b = this.bars[i]; 
                    b.age++;
                    
                    if(b.age > b.maxAge) {
                        this.bars.splice(i, 1); 
                        continue;
                    } 
                    
                    const limit = Math.min(rows, b.y + b.h);
                    
                    for(let r=b.y; r < limit; r++) {
                        this.map[r] = 1; 
                        
                        // Apply glitches
                        for(let k=0; k<glitchCount; k++) {
                            // Optimized random integer generation
                            const x = (Math.random() * cols) | 0;
                            const idx = r * cols + x;
                            
                            this.g.rotatorProg[idx] = 0; 
                            
                            // Optimized font/char picking
                            const fontIdx = (Math.random() * activeFonts.length) | 0;
                            const fontData = activeFonts[fontIdx];
                            const chars = fontData.chars;
                            // Ensure chars array is valid
                            if (chars && chars.length > 0) {
                                const char = chars[(Math.random() * chars.length) | 0];
                                this.g.setChar(idx, char);
                                this.g.setFont(idx, fontIdx);
                            }
                            
                            if(randomizeColors) {
                                this.g.complexStyles.set(idx, { h: (Math.random() * 360) | 0, s: 90, l: 70, glitched: true });
                            }
                        }
                    }
                }
            }
            
            getOverride(i) {
                if(!this.active || !this.map) return null;
                
                // Optimization: Map lookup is O(1) array access.
                // Replace Math.floor with bitwise OR for performance
                const y = (i / this.g.cols) | 0;
                
                // Fast rejection
                if(this.map[y] === 0) return null;

                const s = this.c.state; 
                // Fix: Preserve existing alpha for active cells to maintain trail gradients
                const baseAlpha = this.g.alphas[i];
                const alpha = baseAlpha < 0.1 ? s.dejaVuHoleBrightness : baseAlpha; 
                if(alpha < 0.01) return null;
                
                const fontIdx = this.g.getFont(i);
                const fontName = this.c.derived.activeFonts[fontIdx]?.name || s.fontFamily;

                this._retObj.char = this.g.getChar(i);
                this._retObj.font = fontName;
                this._retObj.color = this.c.derived.tracerColorStr;
                this._retObj.alpha = alpha;
                this._retObj.glow = 0;
                this._retObj.size = 2;
                
                return this._retObj;
            }
        }
