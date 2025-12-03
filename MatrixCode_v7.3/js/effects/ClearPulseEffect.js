class ClearPulseEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); this.name = "ClearPulse"; 
                this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
                this.snap = null; this.autoTimer = c.state.clearPulseFrequencySeconds * 60;
                this.renderData = null;
            }
            trigger() {
                if(this.active) return false;
                const total = this.g.cols * this.g.rows;
                this.snap = { fillChars: new Uint16Array(total) };
                for(let i=0; i<total; i++) this.snap.fillChars[i] = Utils.getRandomChar().charCodeAt(0);
                
                const s = this.c.state;
                const d = this.c.derived;

                let ox, oy;
                if (s.clearPulseRandomPosition) {
                    ox = Utils.randomInt(this.g.cols*0.2, this.g.cols*0.8);
                    oy = Utils.randomInt(this.g.rows*0.2, this.g.rows*0.8);
                    const cx = Math.floor(this.g.cols / 2);
                    const cy = Math.floor(this.g.rows / 2);
                    const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
                    const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
                    if (pxDistX < s.clearPulseWidth && pxDistY < s.clearPulseWidth) { ox = cx; oy = cy; }
                } else {
                    ox = Math.floor(this.g.cols/2);
                    oy = Math.floor(this.g.rows/2);
                }
                this.origin = {x: ox, y: oy};

                this.active = true; 
                this.radius = s.clearPulseInstantStart ? s.clearPulseWidth * 2 : 0;
                const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                this.speed = (maxDim + 200) / Math.max(1, s.clearPulseDurationSeconds * 60);
                return true; 
            }
            
            update() {
                const s = this.c.state;
                if(!this.active && s.clearPulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.clearPulseFrequencySeconds * 60; }
                if(!this.active) { this.renderData = null; return; }
                
                this.radius += this.speed; 
                const d = this.c.derived; 
                const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                
                if(this.radius > maxDim + 400) { this.active = false; this.snap = null; this.renderData = null; return; }

                // Pre-calc for ClearPulse
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

                // AABB
                let minX, maxX, minY, maxY;
                if (s.clearPulseCircular) {
                    minX = ox - this.radius; maxX = ox + this.radius;
                    minY = oy - this.radius; maxY = oy + this.radius;
                } else {
                    minX = ox - this.radius; maxX = ox + this.radius;
                    const rY = this.radius / ratio;
                    minY = oy - rY; maxY = oy + rY;
                }
                
                // Inner Hole AABB (Optimization: If point is inside this, we skip it)
                let holeMinX, holeMaxX, holeMinY, holeMaxY;
                if (innerEdge > 0) {
                    if (s.clearPulseCircular) {
                        holeMinX = ox - innerEdge; holeMaxX = ox + innerEdge;
                        holeMinY = oy - innerEdge; holeMaxY = oy + innerEdge;
                    } else {
                        const rY = innerEdge / ratio;
                        holeMinX = ox - innerEdge; holeMaxX = ox + innerEdge;
                        holeMinY = oy - rY; holeMaxY = oy + rY;
                    }
                }

                this.renderData = {
                    ox, oy,
                    radius: this.radius,
                    radiusSq: this.radius * this.radius,
                    innerEdge,
                    innerEdgeSq: innerEdge * innerEdge,
                    width,
                    ratio,
                    minX, maxX, minY, maxY,
                    holeMinX, holeMaxX, holeMinY, holeMaxY
                };
            }
            
            getOverride(i) {
                if(!this.active || !this.snap || !this.renderData) return null;
                const s = this.c.state; const d = this.c.derived;
                const rd = this.renderData;

                const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                const cy = Math.floor(y * d.cellHeight * s.stretchY);
                
                // 1. Outer AABB Check (Optimization)
                if (cx < rd.minX || cx > rd.maxX || cy < rd.minY || cy > rd.maxY) return null;

                // 2. Inner Hole AABB Check (Optimization)
                // If inside hole bounds, verify distance and skip
                if (rd.innerEdge > 0 && cx > rd.holeMinX && cx < rd.holeMaxX && cy > rd.holeMinY && cy < rd.holeMaxY) {
                    if (s.clearPulseCircular) {
                        const dx = cx - rd.ox; const dy = cy - rd.oy;
                        if ((dx*dx + dy*dy) < rd.innerEdgeSq) return null;
                    } else {
                        return null; // Rect hole is exact
                    }
                }

                // 3. Precise Distance
                let dist;
                if (s.clearPulseCircular) {
                    dist = Math.sqrt(Math.pow(cx - rd.ox, 2) + Math.pow(cy - rd.oy, 2));
                } else {
                    const dx = Math.abs(cx - rd.ox);
                    const dy = Math.abs(cy - rd.oy);
                    dist = Math.max(dx, dy * rd.ratio);
                }

                if (dist < rd.innerEdge || dist > rd.radius) return null;

                // --- Logic continues ---
                const alpha = this.g.alphas[i];
                const isGap = (alpha <= 0.01);
                let char = this.g.getChar(i);
                
                const isLeadingEdge = (dist > rd.radius - 10); 

                if (isLeadingEdge) {
                    if (isGap) char = String.fromCharCode(this.snap.fillChars[i]);
                    const tRgb = d.tracerRgb;
                    return { char, color: `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`, alpha: 1.0, glow: Math.max(s.tracerGlow, 30), size: s.tracerSizeIncrease, solid: true, bgColor: '#000000' };
                }

                if (isGap) {
                    if (!s.clearPulsePreserveSpaces) char = String.fromCharCode(this.snap.fillChars[i]);
                    else return null; 
                }

                const tRgb = d.tracerRgb;
                const rel = Math.max(0, Math.min(1, (rd.radius - dist) / rd.width));
                let finalColor = `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`;
                
                if (s.clearPulseBlend && !isGap) {
                    let baseRgb = d.streamRgb;
                    const style = this.g.complexStyles.get(i);
                    if(style) baseRgb = Utils.hslToRgb(style.h, style.s, style.l);
                    const bR = baseRgb.r; const bG = baseRgb.g; const bB = baseRgb.b;
                    const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel); 
                    const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); 
                    const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
                    finalColor = `rgb(${mR},${mG},${mB})`;
                }

                if (s.clearPulseIgnoreTracers) {
                     const type = this.g.types[i];
                     if (type === CELL_TYPE.TRACER) return null;
                }

                return { char, color: finalColor, alpha: 1.0, glow: Math.max(s.tracerGlow, 30 * (1.0 - rel)), size: s.tracerSizeIncrease, solid: true, bgColor: '#000000' };
            }
        }