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
                
                // We only want to process the LAST matching pulse for this pixel (topmost), 
                // or handle blending. For simplicity and perf, taking the last one that hits.
                for (let k = this.pulses.length - 1; k >= 0; k--) {
                    const p = this.pulses[k];
                    const ox = (p.x * d.cellWidth * s.stretchX); const oy = (p.y * d.cellHeight * s.stretchY);
                    let dist = s.pulseCircular ? Math.sqrt(Math.pow(cx - ox, 2) + Math.pow(cy - oy, 2)) : Math.max(Math.abs(cx - ox), Math.abs(cy - oy));
                    
                    const innerEdge = p.r - s.miniPulseThickness;
                    
                    if (dist <= p.r && dist >= innerEdge) {
                        // Calculate lifecycle fade (fading out at end of life)
                        let lifeFade = 1.0;
                        if(p.r > p.maxR) lifeFade = Math.max(0, 1.0 - ((p.r - p.maxR) / 100));
                        
                        // Calculate spatial fade (soft edges?) - Optional but looks nicer
                        // let spatialFade = 1.0; 
                        // const edgeDist = Math.min(dist - innerEdge, p.r - dist);
                        // if (edgeDist < 10) spatialFade = edgeDist / 10;
                        
                        const combinedAlpha = lifeFade; // * spatialFade;

                        if (combinedAlpha <= 0.01) continue; // Too faint

                        let char = this.g.getChar(i);
                        let isGap = (this.g.alphas[i] <= 0.05);

                        if (isGap) {
                            if (s.miniPulsePreserveSpaces) {
                                // If preserving spaces, we return null so background handles it (invisible)
                                // BUT if we want to blend, we can't return null if we are partially transparent?
                                // If we return null, standard render loop runs.
                                // Standard render loop draws nothing for gaps.
                                // So returning null is correct for gaps if preserving spaces.
                                return null; 
                            }
                            const glitchIndex = (i + Math.floor(p.r)) % Utils.CHARS.length; 
                            char = Utils.CHARS[glitchIndex]; 
                        }
                        
                        // To fix "glitch when ends", we need to blend.
                        // CanvasRenderer supports 'blend: true'.
                        // If blend is true, it draws the standard char (if any) underneath.
                        // If isGap and !preserveSpaces, there is NO standard char underneath (it's empty).
                        // So blending doesn't help gaps. But fading alpha helps gaps.
                        
                        // If NOT gap (it's a live char), we want to blend smoothly back to it.
                        // So we set blend: true.
                        
                        return { 
                            char: char, 
                            color: d.tracerColorStr, 
                            alpha: combinedAlpha, 
                            glow: s.tracerGlow * combinedAlpha, 
                            size: s.tracerSizeIncrease, 
                            solid: false,
                            blend: true 
                        };
                    }
                }
                return null;
            }
        }