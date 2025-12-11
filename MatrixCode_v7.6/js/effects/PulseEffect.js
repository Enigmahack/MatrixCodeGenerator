class PulseEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); this.name = "Pulse"; 
                this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
                this.snap = null; this.autoTimer = c.state.pulseFrequencySeconds * 60;
                this.renderData = null; // Cache for update-calc
                
                // Reusable object to prevent GC thrashing during render loop
                this._retObj = { 
                    char: '', font: null, color: '', alpha: 0, glow: 0, size: 0, solid: false, blend: false, bgColor: '' 
                };
            }
            trigger() {
                if(this.active) return false;
                const total = this.g.cols * this.g.rows;
                // Add fonts and fillFonts to snapshot
                this.snap = { 
                    chars: new Uint16Array(this.g.chars), 
                    fonts: new Uint8Array(this.g.fonts),
                    alphas: new Float32Array(this.g.alphas), 
                    colors: new Uint32Array(total), 
                    tracers: new Uint8Array(total), 
                    fillChars: new Uint16Array(total),
                    fillFonts: new Uint8Array(total)
                };
                const d = this.c.derived; const s = this.c.state; const holdEnd = d.cycleDuration + d.holdFrames;
                const activeFonts = d.activeFonts;
                const numFonts = activeFonts.length;

                for(let i=0; i<total; i++) {
                    let rgb = d.streamRgb; 
                    let isTracer = false; 
                    const style = this.g.complexStyles.get(i);
                    
                    // 1. Determine Color
                    if(style) {
                        rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    } else {
                        // FIX: Use palette color if available
                        const pIdx = this.g.paletteIndices[i];
                        if (d.paletteRgbs && d.paletteRgbs[pIdx]) {
                            rgb = d.paletteRgbs[pIdx];
                        }
                    }

                    // 2. Identify Tracer State (Independent of Style)
                    const type = this.g.types[i]; 
                    const age = this.g.ages[i];
                    if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { 
                        const at = age - 1; 
                        if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { 
                             isTracer = true;
                             // If it IS a tracer, we generally want the snapshot color to be the Tracer Color
                             // UNLESS the style dictates a specific color (like Rainbow).
                             // However, StandardMode style returns GREEN. 
                             // Real visual tracer is WHITE.
                             // So we must Override 'rgb' if it is a tracer and NOT Rainbow mode?
                             // How to distinguish Rainbow vs Standard style?
                             // Rainbow has 'cycle:false' usually but so does Standard.
                             // Standard style color is Green. Tracer is White.
                             // If we capture Green into snapshot, 'Ignore Tracers' will show Green.
                             // We want White.
                             rgb = d.tracerRgb; 
                        } 
                    }

                    // Store packed color for all cells
                    this.snap.colors[i] = Utils.packRgb(rgb.r, rgb.g, rgb.b); 
                    this.snap.tracers[i] = isTracer ? 1 : 0; 
                    
                    // Generate Fill Char/Font for gaps
                    const fIdx = Math.floor(Math.random() * numFonts);
                    this.snap.fillFonts[i] = fIdx;
                    const fontData = activeFonts[fIdx] || activeFonts[0];
                    const chars = fontData.chars;
                    if(chars && chars.length > 0) {
                        this.snap.fillChars[i] = chars[Math.floor(Math.random() * chars.length)].charCodeAt(0);
                    } else {
                        this.snap.fillChars[i] = 32;
                    }
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

                this.active = true; this.state = 'WAITING'; this.timer = s.pulseDelaySeconds * 60; this.radius = 0;
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

                // --- Global Simulation Locking ---
                // Freeze the simulation for any cell that is waiting or outside the pulse
                if (this.g.cellLocks) {
                    if (this.state === 'WAITING') {
                         this.g.cellLocks.fill(1);
                    } else if (this.state === 'EXPANDING') {
                        // 1. Lock everything by default (frozen background)
                        this.g.cellLocks.fill(1);

                        // 2. Unlock cells inside the expanding pulse
                        // Convert pixel AABB to Grid Coordinates
                        const cW = d.cellWidth * s.stretchX;
                        const cH = d.cellHeight * s.stretchY;
                        
                        // Bounds clamped to grid
                        const startCol = Math.max(0, Math.floor(minX / cW));
                        const endCol = Math.min(this.g.cols, Math.ceil(maxX / cW));
                        const startRow = Math.max(0, Math.floor(minY / cH));
                        const endRow = Math.min(this.g.rows, Math.ceil(maxY / cH));

                        const ox = this.renderData.ox;
                        const oy = this.renderData.oy;
                        const radius = this.radius;
                        const radiusSq = this.renderData.radiusSq;
                        const innerEdge = this.renderData.innerEdge;
                        const ratio = this.renderData.ratio;

                        for (let y = startRow; y < endRow; y++) {
                            const cy = Math.floor(y * cH);
                            // Optimization: Check row bounds against Y-range of pulse first? 
                            // AABB handles it mostly.

                            for (let x = startCol; x < endCol; x++) {
                                const cx = Math.floor(x * cW);
                                
                                // Exact Check: Is this cell inside the pulse radius?
                                let dist = 0;
                                if (s.pulseCircular) {
                                    const dx = cx - ox; 
                                    const dy = cy - oy;
                                    // Optimization: Check squared distance first
                                    const dSq = dx*dx + dy*dy;
                                    if (dSq > radiusSq) continue; // Outside outer radius (keep locked)
                                    
                                    // Wait, logic inversion:
                                    // If dist < radius, it is INSIDE the wave or the hole.
                                    // If inside the hole (dist < innerEdge), it is effectively 'passed' and should be normal grid again?
                                    // NO. The hole reveals the original grid, so simulation should RESUME (unlocked).
                                    // The wave itself replaces the grid (visual override). Simulation *could* run underneath, but locked is safer?
                                    // Actually, if we want to "pause" the background, we pause it until the wave PASSES.
                                    // Once the wave passes (dist < innerEdge), the cell is back to normal simulation?
                                    // "The imposition layer needs to pause completely." -> Implies while faded out.
                                    // Faded out = Waiting OR Outside Radius.
                                    // Inside Radius = Wave (Override) + Hole (Normal).
                                    // So anything where dist < radius is UNLOCKED.
                                    
                                    // Using sqrt for precise check against innerEdge/Radius logic consistency
                                    dist = Math.sqrt(dSq);
                                } else {
                                    const dx = Math.abs(cx - ox);
                                    const dy = Math.abs(cy - oy);
                                    dist = Math.max(dx, dy * ratio);
                                }

                                if (dist < innerEdge) {
                                    // Inside the hole -> Simulation Active
                                    const idx = y * this.g.cols + x;
                                    this.g.cellLocks[idx] = 0;
                                }
                            }
                        }
                    }
                }
            }

            getOverride(i) {
                if(!this.active || !this.snap || !this.renderData) return null;            
                const s = this.c.state; const d = this.c.derived;
                
                // Use renderData for fast rejection IF expanding
                const rd = this.renderData;
                let dist = 0;
                
                // Reset pooled object properties
                this._retObj.char = '';
                this._retObj.font = null;
                this._retObj.color = '';
                this._retObj.alpha = 0;
                this._retObj.glow = 0;
                this._retObj.size = 0;
                this._retObj.solid = false;
                this._retObj.blend = false;
                this._retObj.bgColor = '';

                if (this.state === 'WAITING') {

                } else {
                    // EXPANDING
                    const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                    const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                    const cy = Math.floor(y * d.cellHeight * s.stretchY);

                    // AABB Check                    
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
                
                const snAlpha = this.snap.alphas[i]; 
                let charCode = this.snap.chars[i];
                let fontIdx = this.snap.fonts[i]; // Default to captured font

                const tRgb = d.tracerRgb; const targetColor = `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`;
                let baseColorStr = null; let isGap = false;
                if (snAlpha <= 0.01) { 
                    isGap = true; 
                    if (!s.pulsePreserveSpaces) {
                         charCode = this.snap.fillChars[i];
                         fontIdx = this.snap.fillFonts[i]; // Use fill font
                    }
                }
                const char = String.fromCharCode(charCode); const isTracer = (this.snap.tracers[i] === 1);
                
                // Resolve Font Name
                const activeFonts = this.c.derived.activeFonts;
                const fontData = activeFonts[fontIdx] || activeFonts[0];
                const fontName = fontData.name;

                // Common Gap Return
                const gapReturn = this._retObj; // Use pooled object for gapReturn
                gapReturn.char = '';
                gapReturn.font = null;
                gapReturn.color = '#000000';
                gapReturn.alpha = 0;
                gapReturn.glow = 0;
                gapReturn.size = 0;
                gapReturn.solid = true;
                gapReturn.bgColor = '#000000';

                let result = this._retObj; // Use pooled object for result

                if (this.state === 'WAITING' || dist > this.radius) {
                    if(baseColorStr === null) { const rgb = Utils.unpackRgb(this.snap.colors[i]); baseColorStr = `rgb(${rgb.r},${rgb.g},${rgb.b})`; }
                    // FIX: If ignoring tracers, return them with their ORIGINAL snapshot alpha/color, do not dim or force white.
                    if(isTracer && s.pulseIgnoreTracers) {
                         result.char = char;
                         result.font = fontName;
                         result.color = baseColorStr;
                         result.alpha = snAlpha;
                         result.glow = s.tracerGlow;
                         result.size = s.tracerSizeIncrease;
                         result.solid = true;
                         result.bgColor = '#000000';
                    } else if (isGap) {
                         result = gapReturn;
                    } else {
                         result.char = char;
                         result.font = fontName;
                         result.color = baseColorStr;
                         result.alpha = snAlpha * s.pulseDimming;
                         result.glow = 0;
                         result.size = 0;
                         result.solid = true;
                         result.bgColor = '#000000';
                    }
                } else {
                    if (s.pulsePreserveSpaces && isGap) {
                         result = gapReturn;
                    } else {
                        const rel = Math.max(0, Math.min(1, (this.radius - dist) / (s.pulseWidth * 2)));
                        
                        let actualCharAlpha = 1.0;
                        let actualBgAlpha = 1.0;
                        let actualSolid = true; 
                        let actualBlend = false; // Default: Don't blend (draws opaque over grid)
                        let actualGlow = Math.max(s.tracerGlow, 30 * (1.0 - rel));
        
                        // Calculate where the inner edge of the fade zone begins
                        // Fade out over approximately 1 character cell width at the inner boundary
                        const fadePixelWidth = d.cellWidth; // One character cell width for fade
                        const innerBoundaryDist = rd.innerEdge; // Exact inner edge of the main wave
                        const fadeStartDist = innerBoundaryDist + fadePixelWidth; // Distance where fade begins
        
                        if (dist < fadeStartDist && dist > innerBoundaryDist) {
                            // We are in the fade-out zone at the inner edge
                            const fadeProgress = (dist - innerBoundaryDist) / fadePixelWidth; // 0 at innerBoundaryDist, 1 at fadeStartDist
                            
                            // FIX: Fade IN the snapshot from 0 (inner edge) to 1 (wave body).
                            actualCharAlpha = fadeProgress;
                            actualBgAlpha = fadeProgress; 
                            
                            actualSolid = true;             // Draw the background rect (which will be semi-transparent)
                            actualBlend = true;             // ENABLE BLEND: Draw standard grid underneath so we crossfade
                            
                            actualGlow *= actualCharAlpha;  
                        } else if (dist <= innerBoundaryDist) {
                            // Past the inner edge, no override.
                            return null;
                        }
                        
                        // Existing color blending
                        let finalColor = targetColor;
                        if (s.pulseBlend) {
                            const baseInt = this.snap.colors[i]; 
                            const bR = (baseInt >> 16) & 0xFF; 
                            const bG = (baseInt >> 8) & 0xFF; 
                            const bB = baseInt & 0xFF;
                            const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel); 
                            const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); 
                            const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
                            finalColor = `rgb(${mR},${mG},${mB})`;
                        }
                        
                        // Populate pooled object
                        result.char = char; 
                        result.font = fontName;
                        result.color = finalColor; 
                        result.alpha = Math.max(0, actualCharAlpha); 
                        result.glow = actualGlow; 
                        result.size = s.tracerSizeIncrease; 
                        result.solid = actualSolid; 
                        result.blend = actualBlend;
                        result.bgColor = `rgba(0,0,0,${Math.max(0, actualBgAlpha)})`; 
                    }
                }
                
                return result;
            }
        }
