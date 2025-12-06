class MiniPulseEffect extends AbstractEffect {
            constructor(g, c) {
                super(g, c); this.name = "MiniPulse"; this.active = false; this.sessionTimer = 0; this.autoTimer = c.state.miniPulseFrequencySeconds * 60; this.pulses = []; 
                // Optimization: Pre-calculated render objects for the current frame
                this.renderPulses = [];
            }
            trigger() { if(this.active) return false; this.active = true; this.sessionTimer = this.c.state.miniPulseDurationSeconds * 60; this.pulses = []; return true; }
            
            update() {
                const s = this.c.state;
                const d = this.c.derived; // Needed for pre-calc

                if (!this.active && s.miniPulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.miniPulseFrequencySeconds * 60; }
                
                if (this.active) {
                    this.sessionTimer--;
                    if (Math.random() < s.miniPulseSpawnChance) { this.pulses.push({ x: Utils.randomInt(0, this.g.cols), y: Utils.randomInt(0, this.g.rows), r: 0, maxR: s.miniPulseSize, speed: s.miniPulseSpeed }); }
                    if (this.sessionTimer <= 0 && this.pulses.length === 0) this.active = false;
                }
                
                // Clear previous render cache
                this.renderPulses = [];

                for (let i = this.pulses.length - 1; i >= 0; i--) { 
                    const p = this.pulses[i]; 
                    p.r += p.speed; 
                    
                    if (p.r > p.maxR + 100) {
                        this.pulses.splice(i, 1);
                        continue;
                    }

                    // --- OPTIMIZATION START ---
                    // Pre-calculate pixel coordinates (Center of the cell) for this frame
                    const ox = (p.x * d.cellWidth * s.stretchX) + (d.cellWidth * s.stretchX * 0.5);
                    const oy = (p.y * d.cellHeight * s.stretchY) + (d.cellHeight * s.stretchY * 0.5);
                    
                    // Bounding Box (AABB) for fast rejection
                    // p.r is pixel radius (based on s.miniPulseSize which is pixels)
                    const minX = ox - p.r;
                    const maxX = ox + p.r;
                    const minY = oy - p.r;
                    const maxY = oy + p.r;
                    
                    // Radius squared for fast distance check
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

            getOverride(i) {
                if (this.renderPulses.length === 0) return null;
                const s = this.c.state; const d = this.c.derived;
                
                // Pixel coordinates of the current cell (Center)
                const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                const cx = (x * d.cellWidth * s.stretchX) + (d.cellWidth * s.stretchX * 0.5); 
                const cy = (y * d.cellHeight * s.stretchY) + (d.cellHeight * s.stretchY * 0.5);
                
                // Iterate backwards through pre-calculated render objects
                for (let k = this.renderPulses.length - 1; k >= 0; k--) {
                    const p = this.renderPulses[k];
                    
                    // 1. AABB Check (Fast Rejection)
                    if (cx < p.minX || cx > p.maxX || cy < p.minY || cy > p.maxY) continue;

                    // 2. Precise Distance Check
                    let dist;
                    let distSq;

                    if (s.pulseCircular !== false) { // Default to true if undefined
                        const dx = cx - p.ox;
                        const dy = cy - p.oy;
                        distSq = (dx * dx) + (dy * dy);
                        
                        // Check against squared radii
                        if (distSq <= p.rSq && distSq >= p.innerEdgeSq) {
                            dist = Math.sqrt(distSq); // Only calc sqrt if hit, for fading logic
                        } else {
                            continue;
                        }
                    } else {
                        // Rectangular distance (Chebyshev)
                        dist = Math.max(Math.abs(cx - p.ox), Math.abs(cy - p.oy));
                        if (dist > p.r || dist < p.innerEdge) continue;
                    }
                    
                    // Hit! Calculate fade
                    let lifeFade = 1.0;
                    if(p.r > p.maxR) lifeFade = Math.max(0, 1.0 - ((p.r - p.maxR) / 100));
                    
                    const combinedAlpha = lifeFade; 
                    if (combinedAlpha <= 0.01) continue;

                    let char = this.g.getChar(i);
                    // Use CELL_TYPE.EMPTY for robust gap detection
                    // Fallback to alpha check only if type is not reliable (though it should be)
                    let isGap = (this.g.types[i] === CELL_TYPE.EMPTY); 

                    if (isGap) {
                        if (s.miniPulsePreserveSpaces) return null;
                        
                        // Optimization: Utils.CHARS is static, access is fast.
                        // Modulo math is fast.
                        const glitchIndex = (i + Math.floor(p.r)) % Utils.CHARS.length; 
                        char = Utils.CHARS[glitchIndex]; 
                    }
                    
                    // Matches ClearPulse logic for "solid" pops in gaps
                    const useSolid = isGap;
                    const useBlend = !isGap;
                    
                    // Ensure background fades with the effect
                    const bgAlpha = useSolid ? combinedAlpha : 0;
                    
                    return { 
                        char: char, 
                        color: d.tracerColorStr, 
                        alpha: combinedAlpha, 
                        glow: s.tracerGlow * combinedAlpha, 
                        size: s.tracerSizeIncrease, 
                        solid: useSolid, 
                        blend: useBlend,
                        bgColor: `rgba(0,0,0,${bgAlpha})`
                    };
                }
                return null;
            }
        }
