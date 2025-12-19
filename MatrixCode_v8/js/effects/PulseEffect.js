class PulseEffect extends AbstractEffect {
    constructor(g, c) { 
        super(g, c); this.name = "Pulse"; 
        this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
        this.snap = null; 
        const s = this._getEffectiveState();
        this.autoTimer = s.pulseFrequencySeconds * 60;
        this.renderData = null; 
    }

    _getEffectiveState() {
        const s = this.c.state;
        if (!s.pulseMovieAccurate) return s;

        // Movie Accurate Overrides
        return {
            ...s,
            pulseFrequencySeconds: 300, 
            pulseDelaySeconds: 1.0,      // Dark delay of 1 second
            pulseDurationSeconds: 1.3,   // Wave expands for 1.3 seconds
            pulseWidth: 150,             // Ignored in MA custom logic but kept for safety
            pulseRandomPosition: false,  // We calculate specific start
            pulseInstantStart: false,
            pulseCircular: false,        // Rectangular
            pulseAspectRatio: 1.6,       // 16:10 Aspect Ratio (Width / Height)
            pulsePreserveSpaces: true,
            pulseIgnoreTracers: true,
            pulseDimming: 0.2,
            pulseBlend: false
        };
    }
    
    trigger() {
        if(this.active) return false;

        const total = this.g.cols * this.g.rows;
        
        // Snapshot the current grid state
        this.snap = { 
            chars: new Uint16Array(this.g.chars), 
            fontIndices: new Uint8Array(this.g.fontIndices),
            alphas: new Float32Array(this.g.alphas), 
            colors: new Uint32Array(this.g.colors), 
            tracers: new Uint8Array(total), 
            fillChars: new Uint16Array(total),
            fillFonts: new Uint8Array(total)
        };
        
        const d = this.c.derived; const s = this._getEffectiveState(); const holdEnd = d.cycleDuration + d.holdFrames;
        const activeFonts = d.activeFonts;
        const numFonts = activeFonts.length;
        const fallbackChars = Utils.CHARS;

        for(let i=0; i<total; i++) {
            // Identify Tracer State
            const type = this.g.types[i]; 
            const age = this.g.ages[i];
            let isTracer = false;
            
            if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { 
                const at = age - 1; 
                if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { 
                    isTracer = true;
                } 
            }
            this.snap.tracers[i] = isTracer ? 1 : 0; 
            
            // Generate Fill Char/Font for gaps
            const fIdx = Math.floor(Math.random() * numFonts);
            this.snap.fillFonts[i] = fIdx;
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            if(chars && chars.length > 0) {
                this.snap.fillChars[i] = chars[Math.floor(Math.random() * chars.length)].charCodeAt(0);
            } else {
                this.snap.fillChars[i] = fallbackChars.charCodeAt(Math.floor(Math.random() * fallbackChars.length));
            }
        }
        
        let ox, oy;
        if (s.pulseMovieAccurate) {
             // Find Tracer closest to center
             const cx = Math.floor(this.g.cols / 2);
             const cy = Math.floor(this.g.rows / 2);
             let minDist = 99999999;
             let bestX = cx; 
             let bestY = cy;
             
             for(let i=0; i<total; i++) {
                 if (this.snap.tracers[i] === 1) {
                     const x = i % this.g.cols;
                     const y = Math.floor(i / this.g.cols);
                     const dx = (x - cx);
                     const dy = (y - cy);
                     const dist = dx*dx + dy*dy;
                     if (dist < minDist) {
                         minDist = dist;
                         bestX = x;
                         bestY = y;
                     }
                 }
             }
             ox = bestX;
             oy = bestY;
        } else if (s.pulseRandomPosition) {
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

        this.active = true; this.state = 'WAITING'; this.timer = s.pulseDelaySeconds * 60; 
        
        // Radius Init
        if (s.pulseMovieAccurate) {
            // Start very small, allowing Latch logic to handle expansion
            // Inner Hole: 4 wide (2 rad), 3 tall (1.5 rad)
            // Initial Radius must cover at least this hole
            this.radius = 2 * d.cellWidth * s.stretchX; 
        } else {
            this.radius = s.pulseInstantStart ? s.pulseWidth * 2 : 0; 
        }
        
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);
        
        return true; 
    }
    
    update() {
        const s = this._getEffectiveState();
        if(!this.active && s.pulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.pulseFrequencySeconds * 60; }
        if(!this.active) { this.renderData = null; return; }
        
        const d = this.c.derived;
        
        if(this.state === 'WAITING') { 
            if(--this.timer <= 0) { this.state = 'EXPANDING'; }
        } else {
            const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
            this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);
            this.radius += this.speed; 
            if(this.radius > maxDim + 400) { this.active = false; this.snap = null; this.renderData = null; return; }
        }

        // --- Pre-calc ---
        const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX); 
        const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
        
        // Effective ratio for calculation
        let ratio = 1;
        if (s.pulseMovieAccurate) {
             ratio = 1.6; // Locked 16:10
        } else if (!s.pulseCircular) {
            const canvasW = this.g.cols * d.cellWidth * s.stretchX;
            const canvasH = this.g.rows * d.cellHeight * s.stretchY;
            ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
        }

        const width = s.pulseWidth * 2; 
        const innerEdge = this.radius - width;
        let minX, maxX, minY, maxY;
        if (s.pulseCircular) {
            minX = ox - this.radius; maxX = ox + this.radius;
            minY = oy - this.radius; maxY = oy + this.radius;
        } else {
            minX = ox - this.radius; maxX = ox + this.radius;
            const rY = this.radius / ratio;
            minY = oy - rY; maxY = oy + rY;
        }

        this.renderData = { ox, oy, radius: this.radius, innerEdge, width, ratio, minX, maxX, minY, maxY };
    }

    applyToGrid(grid) {
        if (!this.active || !this.snap || !this.renderData) return;
        
        const s = this._getEffectiveState(); 
        const d = this.c.derived;
        const rd = this.renderData;
        const total = grid.cols * grid.rows;
        
        // ===========================================
        // MOVIE ACCURATE RENDER PATH
        // ===========================================
        if (s.pulseMovieAccurate) {
             const aspect = 1.0; 
             const sideWidth = 7 * d.cellWidth * s.stretchX; 
             const vertWidth = 5 * d.cellHeight * s.stretchY; 
             const fadeSizeSide = 0.5 * d.cellWidth * s.stretchX;
             const fadeSizeVert = 0.5 * d.cellHeight * s.stretchY;
             const initHoleRad = 2 * d.cellWidth * s.stretchX; 
             const maxWaveWidth = sideWidth; 
             
             let innerB = Math.max(initHoleRad, this.radius - maxWaveWidth);
             let outerB = this.radius;

             const revealFadeLenSide = 2 * d.cellWidth * s.stretchX;
             const revealFadeLenVert = 2 * d.cellHeight * s.stretchY;
             const maxRad = Math.max(grid.cols * d.cellWidth * s.stretchX, grid.rows * d.cellHeight * s.stretchY);
             
             const delayDist = 3 * d.cellWidth * s.stretchX;
             const r30 = maxRad * 0.30;
             const r40 = maxRad * 0.40; 
             const rHalfRow = Math.floor(grid.rows / 2);

             const progress = this.radius / maxRad;
             
             for (let i = 0; i < total; i++) {
                 // Common Data Fetch
                 const snAlpha = this.snap.alphas[i];
                 let charCode = this.snap.chars[i];
                 let color = this.snap.colors[i];
                 let fontIdx = this.snap.fontIndices[i];
                 const isTracer = (this.snap.tracers[i] === 1);
                 
                 // Fill gaps from snapshot
                 const isGap = (snAlpha <= 0.01);
                 if (isGap) {
                     charCode = this.snap.fillChars[i];
                     color = d.streamColorUint32;
                     fontIdx = this.snap.fillFonts[i];
                 }

                 if (this.state === 'WAITING') {
                     // 1. Darken Everything
                     if (isTracer) {
                         const glow = (s.pulseUseTracerGlow) ? s.tracerGlow : 0;
                         grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, glow);
                     } else {
                         grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0);
                     }
                     continue;
                 }
                 
                 // EXPANDING
                 const x = i % grid.cols; 
                 const y = Math.floor(i / grid.cols);
                 const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                 const cy = Math.floor(y * d.cellHeight * s.stretchY);

                 let curLag = 0;
                 if (this.radius >= r30 && this.radius < r30 + delayDist) {
                     if (y >= rHalfRow) {
                         if (y < rHalfRow + 7) {
                             curLag = this.radius - r30;
                         } else if (y >= rHalfRow + 10) {
                             curLag = this.radius - r30;
                         }
                     }
                 }
                 else if (this.radius >= r40 && this.radius < r40 + delayDist) {
                     if (y >= rHalfRow) {
                         curLag = this.radius - r40;
                     }
                 }
                 
                 const localOuter = Math.max(0, outerB - curLag);
                 const localInner = Math.max(0, innerB - curLag);
                 const dx = Math.abs(cx - rd.ox);
                 const dy = Math.abs(cy - rd.oy);
                 const dyScaled = dy * aspect;
                 const dist = Math.max(dx, dyScaled);
                 const isSide = (dx > dyScaled);
                 const fadeSize = isSide ? fadeSizeSide : fadeSizeVert;
                 
                 if (dist > localOuter) {
                     // --- OUTSIDE ---
                     if (curLag > 0 && dist < outerB) {
                         const gapColor = Utils.packAbgr(255, 255, 255); 
                         grid.setHighPriorityEffect(i, String.fromCharCode(charCode), gapColor, 0.3, fontIdx, 0);
                     } else {
                         if (isTracer) {
                             const glow = (s.pulseUseTracerGlow) ? s.tracerGlow : 0;
                             grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, glow);
                         } else {
                             grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0);
                         }
                     }
                 } 
                 else if (dist > localInner) {
                     // --- INSIDE WAVE BAND ---
                     const chaos = Math.sin(i * 12.9898) * 43758.5453;
                     const rndVal = chaos - Math.floor(chaos); 
                     
                     if (rndVal < 0.10) {
                         grid.setHighPriorityEffect(i, ' ', 0, 0, 0, 0);
                     } else {
                         // WAVE
                         
                         // 1. Alpha Variance (20% spread: 0.6 +/- 0.1)
                         const chaos2 = Math.sin(i * 78.233) * 43758.5453;
                         const rnd2 = chaos2 - Math.floor(chaos2);
                         const variance = (rnd2 - 0.5) * 0.2; // -0.1 to 0.1
                         let waveAlpha = 0.7 + variance; // Increased base alpha

                         const distFromOuter = localOuter - dist;
                         if (distFromOuter < fadeSize) {
                             waveAlpha *= (distFromOuter / fadeSize);
                         } else if (dist - localInner < fadeSize) {
                             waveAlpha = Math.min(waveAlpha, waveAlpha * ((dist - localInner) / fadeSize));
                         }

                         const liveAlpha = grid.alphas[i];
                         let displayChar, displayFont;
                         let lColor;

                         if (liveAlpha > 0.01) {
                             displayChar = String.fromCharCode(grid.chars[i]);
                             displayFont = grid.fontIndices[i];
                             lColor = grid.colors[i];
                         } else {
                             // Flash in together: Always fill with snapshot char
                             displayChar = String.fromCharCode(this.snap.fillChars[i]);
                             displayFont = this.snap.fillFonts[i];
                             lColor = 0; 
                         }

                         // 2. Bright White Blending (0.8 weight for white)
                         const blendWeight = 0.8;
                         const lR = lColor & 0xFF; const lG = (lColor >> 8) & 0xFF; const lB = (lColor >> 16) & 0xFF;
                         
                         const mR = Math.floor(lR + (255 - lR) * blendWeight);
                         const mG = Math.floor(lG + (255 - lG) * blendWeight);
                         const mB = Math.floor(lB + (255 - lB) * blendWeight);
                         
                         const finalColor = Utils.packAbgr(mR, mG, mB);
                         const glow = (s.pulseUseTracerGlow) ? s.tracerGlow * waveAlpha * 1.5 : 0; 
                         
                         grid.setHighPriorityEffect(i, displayChar, finalColor, 1.0, displayFont, glow);
                     }
                 } 
                 else {
                     grid.clearEffectOverride(i);
                 }
             }
             return; // End MA path
        }

        // ===========================================
        // STANDARD PATH (Original Logic)
        // ===========================================
        const tColorInt = d.tracerColorUint32;
        const tR = tColorInt & 0xFF;
        const tG = (tColorInt >> 8) & 0xFF;
        const tB = (tColorInt >> 16) & 0xFF;

        for (let i = 0; i < total; i++) {
            // Optimization: Skip if we are waiting (Override whole screen efficiently)
            let dist = 0;
            if (this.state === 'EXPANDING') {
                const x = i % grid.cols; 
                const y = Math.floor(i / grid.cols);
                const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                const cy = Math.floor(y * d.cellHeight * s.stretchY);

                if (s.pulseCircular) {
                    const dx = cx - rd.ox; const dy = cy - rd.oy;
                    dist = Math.sqrt(dx*dx + dy*dy);
                } else {
                    const dx = Math.abs(cx - rd.ox);
                    const dy = Math.abs(cy - rd.oy);
                    dist = Math.max(dx, dy * rd.ratio);
                }
                
                // 1. HOLE (Inner Edge): Instant Reveal
                if (dist < rd.innerEdge) {
                    grid.clearEffectOverride(i); 
                    continue;
                }
            } else {
                dist = 999999; // Waiting state: effectively infinite distance
            }

            // --- Common Data Fetch ---
            const snAlpha = this.snap.alphas[i];
            let charCode = this.snap.chars[i];
            let fontIdx = this.snap.fontIndices[i];
            let color = this.snap.colors[i];
            
            const isTracer = (this.snap.tracers[i] === 1);
            const isGap = (snAlpha <= 0.01);

            // Apply Gap Filling (Global)
            if (isGap && !s.pulsePreserveSpaces) {
                charCode = this.snap.fillChars[i];
                fontIdx = this.snap.fillFonts[i];
            }

            // 2. BACKGROUND (Dimmed)
            // Condition: Waiting OR Outside Radius
            if (this.state === 'WAITING' || dist > rd.radius) {
                if (s.pulsePreserveSpaces && isGap) {
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0)
                } else if (isTracer && s.pulseIgnoreTracers) {
                    // Keep original tracer
                    const glow = (s.pulseUseTracerGlow) ? s.tracerGlow : 0;
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, glow);
                } else {
                    // Dimmed Snapshot
                    if (snAlpha > 0.01 || !s.pulsePreserveSpaces) {
                        grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0);
                    } else {
                        grid.clearEffectOverride(i);
                    }
                }
            } 
            // 3. WAVE BAND (Bright)
            // Condition: We are here because dist >= innerEdge AND dist <= radius
            else {
                if (s.pulsePreserveSpaces && isGap) {
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0)
                } else {
                    // Calculate relative position (0.0 at outer edge, 1.0 at inner edge)
                    // (radius - dist) is small at edge, large at inner
                    const rel = Math.max(0, Math.min(1, (rd.radius - dist) / (s.pulseWidth * 1.25)));
                    
                    let finalColor = tColorInt;
                    if (s.pulseBlend) {
                        const bR = color & 0xFF;
                        const bG = (color >> 8) & 0xFF;
                        const bB = (color >> 16) & 0xFF;
                        
                        const mR = Math.floor(tR + (bR - tR) * rel);
                        const mG = Math.floor(tG + (bG - tG) * rel);
                        const mB = Math.floor(tB + (bB - tB) * rel);
                        finalColor = Utils.packAbgr(mR, mG, mB);
                    }
                    
                    const glowAmount = (s.pulseUseTracerGlow) ? Math.max(s.tracerGlow, 30 * (1.0 - rel)) : 0;
                    
                    // Force alpha 1.0 for the wave
                    grid.setEffectOverride(i, String.fromCharCode(charCode), finalColor, 1.0 , fontIdx, glowAmount);
                }
            }
        }
    }
}