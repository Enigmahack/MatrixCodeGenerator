class PulseEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); this.name = "Pulse"; 
                this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
                this.snap = null; this.autoTimer = c.state.pulseFrequencySeconds * 60;
                this.renderData = null; // Cache for update-calc
            }
            trigger() {
                if(this.active) return false;
                const total = this.g.cols * this.g.rows;
                this.snap = { chars: new Uint16Array(this.g.chars), alphas: new Float32Array(this.g.alphas), colors: new Uint32Array(total), tracers: new Uint8Array(total), fillChars: new Uint16Array(total) };
                const d = this.c.derived; const s = this.c.state; const holdEnd = d.cycleDuration + d.holdFrames;
                for(let i=0; i<total; i++) {
                    let rgb = d.streamRgb; let isTracer = false; const style = this.g.complexStyles.get(i);
                    if(style) rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    else {
                        const type = this.g.types[i]; const age = this.g.ages[i];
                        if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { const at = age - 1; if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { rgb = d.tracerRgb; isTracer = true; } }
                    }
                    this.snap.colors[i] = Utils.packRgb(rgb.r, rgb.g, rgb.b); this.snap.tracers[i] = isTracer ? 1 : 0; this.snap.fillChars[i] = Utils.getRandomChar().charCodeAt(0);
                }
                
                let ox, oy;
                if (s.pulseRandomPosition) {
                    ox = Utils.randomInt(this.g.cols*0.2, this.g.cols*0.8);
                    oy = Utils.randomInt(this.g.rows*0.2, this.g.rows*0.8);
                    const cx = Math.floor(this.g.cols / 2);
                    const cy = Math.floor(this.g.rows / 2);
                    const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
                    const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
                    if (pxDistX < s.pulseWidth && pxDistY < s.pulseWidth) { ox = cx; oy = cy; }
                } else {
                    ox = Math.floor(this.g.cols/2);
                    oy = Math.floor(this.g.rows/2);
                }
                this.origin = {x: ox, y: oy};

                this.active = true; this.state = 'WAITING'; this.timer = s.pulseDelayFrames; this.radius = 0;
                const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);
                return true; 
            }
            
            update() {
                const s = this.c.state;
                if(!this.active && s.pulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.pulseFrequencySeconds * 60; }
                if(!this.active) { this.renderData = null; return; }
                
                const d = this.c.derived;
                
                if(this.state === 'WAITING') { 
                    if(--this.timer <= 0) { this.state = 'EXPANDING'; this.radius = s.pulseInstantStart ? s.pulseWidth * 2 : 0; }
                } else {
                    this.radius += this.speed; const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                    if(this.radius > maxDim + 400) { this.active = false; this.snap = null; this.renderData = null; return; }
                }

                // --- Optimization Pre-calc ---
                const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX); 
                const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
                const width = s.pulseWidth * 2; 
                const innerEdge = this.radius - width;
                
                let ratio = 1;
                if (!s.pulseCircular) {
                    const canvasW = this.g.cols * d.cellWidth * s.stretchX;
                    const canvasH = this.g.rows * d.cellHeight * s.stretchY;
                    ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
                }

                // AABB for the outer radius
                // For circular: standard bounding box.
                // For rect: radius applies to the MAX dimension.
                // Rect dist = max(dx, dy * ratio).
                // So max dx = radius. max dy = radius / ratio.
                
                let minX, maxX, minY, maxY;
                if (s.pulseCircular) {
                    minX = ox - this.radius; maxX = ox + this.radius;
                    minY = oy - this.radius; maxY = oy + this.radius;
                } else {
                    minX = ox - this.radius; maxX = ox + this.radius;
                    const rY = this.radius / ratio;
                    minY = oy - rY; maxY = oy + rY;
                }

                this.renderData = {
                    ox, oy,
                    radius: this.radius,
                    radiusSq: this.radius * this.radius,
                    innerEdge,
                    innerEdgeSq: innerEdge * innerEdge, // innerEdge can be negative, handled
                    width,
                    ratio,
                    minX, maxX, minY, maxY
                };
            }

            getOverride(i) {
                if(!this.active || !this.snap) return null;
                // If WAITING, we cover everything (pause mode), so we cannot skip AABB.
                // Wait, PulseEffect behavior: "While waiting, dim everything".
                // So we MUST process all pixels if state is WAITING.
                
                const s = this.c.state; const d = this.c.derived;
                
                // Use renderData for fast rejection IF expanding
                const rd = this.renderData;
                let dist = 0;
                
                if (this.state === 'WAITING') {
                    // Global dimming, logic applies to everyone. No spatial reject.
                    // But dist is 0 (or effectively infinite from radius 0?) 
                    // Logic says: if (WAITING || dist > radius) -> Dim/Pause look.
                    // So we just fall through to the dimming block.
                } else {
                    // EXPANDING
                    const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                    const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                    const cy = Math.floor(y * d.cellHeight * s.stretchY);

                    // AABB Check
                    // If outside AABB, it is "outside the wave".
                    // In PulseEffect, "outside the wave" means (dist > radius).
                    // And (dist > radius) means DIMMED/PAUSED.
                    // So we CANNOT skip processing. We must return the dimmed override.
                    
                    // HOWEVER, if dist < innerEdge (inside the hole), we return NULL (normal stream).
                    // We can optimize that check.
                    
                    // innerEdge AABB?
                    // If cx,cy is inside the 'inner hole', return null.
                    // Inner hole AABB:
                    // Circular: innerRadius = rd.innerEdge.
                    // Rect: same logic.
                    
                    if (rd.innerEdge > 0) {
                        // Check if definitely inside the hole
                        let inHole = false;
                        if (s.pulseCircular) {
                            // Inner AABB
                            if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                                cy > rd.oy - rd.innerEdge && cy < rd.oy + rd.innerEdge) {
                                // Potential hole match, do precise check
                                const dx = cx - rd.ox; const dy = cy - rd.oy;
                                if ((dx*dx + dy*dy) < rd.innerEdgeSq) return null; // Definitely inside hole
                            }
                        } else {
                            // Rect inner hole is exact AABB
                            const rY = rd.innerEdge / rd.ratio;
                            if (cx > rd.ox - rd.innerEdge && cx < rd.ox + rd.innerEdge &&
                                cy > rd.oy - rY && cy < rd.oy + rY) {
                                return null; // Inside rect hole
                            }
                        }
                    }

                    // Calculate Dist for wave edge
                    if (s.pulseCircular) {
                        const dx = cx - rd.ox; const dy = cy - rd.oy;
                        dist = Math.sqrt(dx*dx + dy*dy); // Sqrt needed for linear interpolation 'rel'
                    } else {
                        const dx = Math.abs(cx - rd.ox);
                        const dy = Math.abs(cy - rd.oy);
                        dist = Math.max(dx, dy * rd.ratio);
                    }
                    
                    if (dist < rd.innerEdge) return null;
                }

                // ... Rest of logic uses 'dist' ...
                
                const snAlpha = this.snap.alphas[i]; let charCode = this.snap.chars[i];
                const tRgb = d.tracerRgb; const targetColor = `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`;
                let baseColorStr = null; let isGap = false;
                if (snAlpha <= 0.01) { isGap = true; if (!s.pulsePreserveSpaces) charCode = this.snap.fillChars[i]; }
                const char = String.fromCharCode(charCode); const isTracer = (this.snap.tracers[i] === 1);
                
                if (this.state === 'WAITING' || dist > this.radius) {
                    if(baseColorStr === null) { const rgb = Utils.unpackRgb(this.snap.colors[i]); baseColorStr = `rgb(${rgb.r},${rgb.g},${rgb.b})`; }
                    if(isTracer && s.pulseIgnoreTracers) return { char, color: targetColor, alpha: 1.0, glow: s.tracerGlow, size: s.tracerSizeIncrease, solid: true, bgColor: '#000000' };
                    if (isGap) return { char: '', color: '#000000', alpha: 0, glow: 0, size: 0, solid: true, bgColor: '#000000' };
                    return { char, color: baseColorStr, alpha: snAlpha * s.pulseDimming, glow: 0, size: 0, solid: true, bgColor: '#000000' };
                }
                if (s.pulsePreserveSpaces && isGap) return { char: '', color: '#000000', alpha: 0, glow: 0, size: 0, solid: true, bgColor: '#000000' };
                
                const rel = Math.max(0, Math.min(1, (this.radius - dist) / (s.pulseWidth * 2)));
                let finalColor = targetColor;
                if (s.pulseBlend) {
                    const baseInt = this.snap.colors[i]; const bR = (baseInt >> 16) & 0xFF; const bG = (baseInt >> 8) & 0xFF; const bB = baseInt & 0xFF;
                    const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel); const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
                    finalColor = `rgb(${mR},${mG},${mB})`;
                }
                return { char, color: finalColor, alpha: 1.0, glow: Math.max(s.tracerGlow, 30 * (1.0 - rel)), size: s.tracerSizeIncrease, solid: true, bgColor: '#000000' };
            }
        }