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
        const fallbackChars = "MATRIX";

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
        const tColorInt = d.tracerColorUint32;
        const total = grid.cols * grid.rows;
        
        // ===========================================
        // MOVIE ACCURATE RENDER PATH
        // ===========================================
        if (s.pulseMovieAccurate) {
             const aspect = s.pulseAspectRatio || 1.6;
             // Widths
             const sideWidth = 9 * d.cellWidth * s.stretchX; 
             const vertWidth = 7 * d.cellHeight * s.stretchY; 
             const fadeSizeSide = 0.5 * d.cellWidth * s.stretchX;
             const fadeSizeVert = 0.5 * d.cellHeight * s.stretchY;

             // Latching Logic (Inner waits for Outer)
             // Inner Hole Size: 4 chars wide (2 radius), 3 chars tall (1.5 radius)
             const initHoleRad = 2 * d.cellWidth * s.stretchX; 
             // Note: Vertical hole will be initHoleRad / aspect = 2 / 1.6 = 1.25 (close to 1.5)
             
             // Dynamic Inner Edge
             // Max Wave Width is when the wave is fully formed
             const maxWaveWidth = sideWidth; 
             
             // innerB latches to initHoleRad until outerB exceeds (initHoleRad + maxWaveWidth)
             // Effectively, the wave grows in thickness until it hits max width, then moves.
             // BUT, we want inner to be OPEN (revealed).
             // If innerB < initHoleRad, we clamp it?
             // No, "start at normal center and expand... inner rectangle should 'latch'".
             // Means Inner Edge stays at center until Outer Edge goes far enough.
             let innerB = Math.max(initHoleRad, this.radius - maxWaveWidth);
             let outerB = this.radius;

             // Expansion Tearing Params
             const chunkHeightChars = Math.max(15, Math.floor(grid.rows / 4)); 
             const lagAmplitude = 100 * s.stretchY; 

             // Reveal Layer Params (2 Char width)
             const revealFadeLenSide = 2 * d.cellWidth * s.stretchX;
             const revealFadeLenVert = 2 * d.cellHeight * s.stretchY;
             
             // Glitch Trigger Thresholds
             const maxRad = Math.max(grid.cols * d.cellWidth * s.stretchX, grid.rows * d.cellHeight * s.stretchY);
             const glitchStart = maxRad * 0.55; 
             const glitchEnd = maxRad * 0.85; 

             for (let i = 0; i < total; i++) {
                 // Common Data Fetch
                 const snAlpha = this.snap.alphas[i];
                 let charCode = this.snap.chars[i];
                 let color = this.snap.colors[i];
                 const isTracer = (this.snap.tracers[i] === 1);
                 
                 // Fill gaps from snapshot
                 const isGap = (snAlpha <= 0.01);
                 if (isGap) {
                     charCode = this.snap.fillChars[i];
                     color = d.streamColorUint32; 
                 }

                 if (this.state === 'WAITING') {
                     // 1. Darken Everything
                     if (isTracer) {
                         grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha, s.tracerGlow);
                     } else {
                         grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, 0);
                     }
                     continue;
                 }
                 
                 // EXPANDING
                 const x = i % grid.cols; 
                 const y = Math.floor(i / grid.cols);
                 const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                 const cy = Math.floor(y * d.cellHeight * s.stretchY);

                 // --- Large Block Tearing Logic ---
                 let curLag = 0;
                 if (this.radius > glitchStart && this.radius < glitchEnd) {
                     if (y > grid.rows * 0.5 && y < grid.rows - 5) {
                         const chunkIdx = Math.floor(y / chunkHeightChars);
                         const myStart = glitchStart + (chunkIdx % 2) * (maxRad * 0.15);
                         const myEnd = myStart + (maxRad * 0.10); 
                         if (this.radius > myStart && this.radius < myEnd) {
                             curLag = lagAmplitude;
                         }
                     }
                 }
                 
                 // Apply Lag to both edges
                 const localOuter = Math.max(0, outerB - curLag);
                 const localInner = Math.max(0, innerB - curLag);
                 
                 // Distance Calculation (Rectangular 16:10)
                 const dx = Math.abs(cx - rd.ox);
                 const dy = Math.abs(cy - rd.oy);
                 const dyScaled = dy * aspect;
                 const dist = Math.max(dx, dyScaled);
                 
                 // Determine Zone Properties
                 const isSide = (dx > dyScaled);
                 const waveThick = isSide ? sideWidth : vertWidth; // Used for scale calcs if needed
                 const fadeSize = isSide ? fadeSizeSide : fadeSizeVert;
                 
                 if (dist > localOuter) {
                     // --- OUTSIDE: Dimmed/Frozen ---
                     // Tear Gap Logic: Filled with Faint White
                     // If we are lagging, and dist < unlagged outer, we are in the "gap".
                     // Note: We use 'outerB' (unlagged) for comparison
                     if (curLag > 0 && dist < outerB) {
                         // Tear Gap (White Fade)
                         grid.setEffectOverride(i, String.fromCharCode(charCode), Utils.packAbgr(255,255,255), 0.3, 0);
                     } else {
                         // Normal Outside
                         if (isTracer) {
                             grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha, s.tracerGlow);
                         } else {
                             grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, 0);
                         }
                     }
                 } 
                 else if (dist > localInner) {
                     // --- INSIDE WAVE BAND ---
                     
                     // 1. Base Layer (Reveal) - Visible through holes/transparency
                     const revealLen = isSide ? revealFadeLenSide : revealFadeLenVert;
                     const distFromOuter = localOuter - dist; 
                     
                     let baseAlphaFactor = s.pulseDimming; 
                     if (distFromOuter < revealLen) {
                         const p = distFromOuter / revealLen;
                         baseAlphaFactor = s.pulseDimming + (1.0 - s.pulseDimming) * p;
                     } else {
                         baseAlphaFactor = 1.0;
                     }
                     
                     // HOLES (10%)
                     const chaos = Math.sin(i * 12.9898) * 43758.5453;
                     const rndVal = chaos - Math.floor(chaos); 
                     const isHole = rndVal < 0.10;
                     
                     if (isHole) {
                         // HOLE: BLACK (Negative Space)
                         // "Block out the green code" -> Empty cell
                         grid.setEffectOverride(i, ' ', 0, 0, 0);
                     } else {
                         // WAVE: White Overlay on top of Green Code
                         // Calculate Wave Alpha
                         let waveAlpha = 0.85; 
                         
                         // Edge Fades
                         if (distFromOuter < fadeSize) {
                             waveAlpha *= (distFromOuter / fadeSize);
                         } else if (dist - localInner < fadeSize) {
                             waveAlpha = Math.min(waveAlpha, waveAlpha * ((dist - localInner) / fadeSize));
                         }
                         
                         // Use setEffectOverlay to blend White over Sim
                         const waveChar = String.fromCharCode(this.snap.fillChars[i]);
                         grid.setEffectOverlay(i, waveChar, waveAlpha, 0);
                     }
                 } 
                 else {
                     // --- INSIDE HOLE: Fully Revealed ---
                     grid.clearEffectOverride(i);
                 }
             }
             return; // End MA path
        }

        // ===========================================
        // STANDARD PATH (Original Logic)
        // ===========================================
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
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, 0)
                } else if (isTracer && s.pulseIgnoreTracers) {
                    // Keep original tracer
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha, s.tracerGlow);
                } else {
                    // Dimmed Snapshot
                    if (snAlpha > 0.01 || !s.pulsePreserveSpaces) {
                        grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, 0);
                    } else {
                        grid.clearEffectOverride(i);
                    }
                }
            } 
            // 3. WAVE BAND (Bright)
            // Condition: We are here because dist >= innerEdge AND dist <= radius
            else {
                if (s.pulsePreserveSpaces && isGap) {
                    grid.setEffectOverride(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, 0)
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
                    
                    const actualGlow = Math.max(s.tracerGlow, 30 * (1.0 - rel));
                    
                    // Force alpha 1.0 for the wave
                    grid.setEffectOverride(i, String.fromCharCode(charCode), finalColor, 1.0 , actualGlow);
                }
            }
        }
    }
}