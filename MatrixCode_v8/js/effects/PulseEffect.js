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
            pulseDurationSeconds: 1.4,   // Wave expands for 1.4 seconds
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
            this.radius = 2 * d.cellWidth * s.stretchX; 
        } else {
            this.radius = s.pulseInstantStart ? s.pulseWidth * 2 : 0; 
        }
        
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.pulseDurationSeconds * 60);

        // --- Dynamic Delay Chunks ---
        this.chunks = [];
        this.spawnedCount = 0;
        this.spawnCooldown = 0;
        
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

            // --- Chunk Lifecycle & Spawning ---
            if (s.pulseMovieAccurate) {
                // 1. Update existing chunks
                for (let i = this.chunks.length - 1; i >= 0; i--) {
                    this.chunks[i].life--;
                    if (this.chunks[i].life <= 0) {
                        this.chunks.splice(i, 1);
                    }
                }

                // 2. Cooldown
                if (this.spawnCooldown > 0) this.spawnCooldown--;

                // 3. Spawn Logic
                const progress = this.radius / maxDim;
                if (progress > 0.15 && this.spawnedCount < 4 && this.spawnCooldown <= 0) {
                    // Spawn new chunk - Select Type
                    const type = Math.floor(Math.random() * 3);
                    const w = Utils.randomInt(Math.floor(this.g.cols * 0.5), this.g.cols);
                    let h, y;

                    if (type === 0) {
                        // Type A: Bottom Half
                        h = Math.floor(this.g.rows / 2);
                        y = Math.floor(this.g.rows / 2);
                    } else if (type === 1) {
                        // Type B: Mid Section (9-10 tall)
                        h = Utils.randomInt(9, 10);
                        // Center near wave edge, but favor middle
                        const rY = this.radius / 1.6;
                        const topEdgeY = (this.origin.y * d.cellHeight * s.stretchY - rY) / (d.cellHeight * s.stretchY);
                        const botEdgeY = (this.origin.y * d.cellHeight * s.stretchY + rY) / (d.cellHeight * s.stretchY);
                        let targetY = (Math.random() < 0.5) ? topEdgeY : botEdgeY;
                        y = Math.floor(targetY - h / 2);
                        // Constrain to "Middle-ish" (20% to 80%)
                        y = Math.max(Math.floor(this.g.rows * 0.2), Math.min(Math.floor(this.g.rows * 0.8) - h, y));
                    } else {
                        // Type C: Thin Strip (4 tall) near bottom
                        h = 4;
                        y = Utils.randomInt(this.g.rows - 15, this.g.rows - 5);
                    }
                    
                    const x = Utils.randomInt(0, this.g.cols - w);
                    
                    // Final Clamp
                    y = Math.max(0, Math.min(this.g.rows - h, y));

                    const delayPixels = 4 * d.cellWidth * s.stretchX; 
                    // Duration: Time to traverse delay + Time to traverse 1 extra char + buffer
                    const oneCharTime = (d.cellWidth * s.stretchX) / this.speed;
                    const duration = Math.ceil(delayPixels / this.speed) + Math.ceil(oneCharTime) + 2;

                    this.chunks.push({
                        x, y, w, h,
                        lag: delayPixels,
                        life: duration
                    });

                    this.spawnedCount++;
                    this.spawnCooldown = duration + 5; // Wait at least 5 frames after despawn
                }
            }
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
             
             const delayDist = 4 * d.cellWidth * s.stretchX;
             const r30 = maxRad * 0.30;
             const r40 = maxRad * 0.40; 
             const rHalfRow = Math.floor(grid.rows / 2);

             const progress = this.radius / maxRad;

             // FADE TO DARK LOGIC
             // Timer counts DOWN. We want to fade OUT in the first 10 frames of the wait.
             // Max timer = s.pulseDelaySeconds * 60
             const maxTimer = s.pulseDelaySeconds * 60;
             const timeElapsed = maxTimer - this.timer;
             const fadeDur = 10; // Frames
             let fadeMult = s.pulseDimming;
             
             if (timeElapsed < fadeDur) {
                 const t = timeElapsed / fadeDur; 
                 // Lerp from 1.0 to s.pulseDimming
                 fadeMult = 1.0 + (s.pulseDimming - 1.0) * t;
             }
             
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
                     // 1. Darken Everything with Fade
                     if (isTracer) {
                         const glow = (s.pulseUseTracerGlow) ? s.tracerGlow : 0;
                         // Tracers REMAIN BRIGHT (Ignore fadeMult)
                         grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, glow);
                     } else {
                         grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha * fadeMult, fontIdx, 0);
                     }
                     continue;
                 }
                 
                 // EXPANDING
                 const x = i % grid.cols; 
                 const y = Math.floor(i / grid.cols);
                 const cx = Math.floor(x * d.cellWidth * s.stretchX); 
                 const cy = Math.floor(y * d.cellHeight * s.stretchY);

                 // --- Apply Catching Lag ---
                 let curLag = 0;
                 // Check active chunks
                 if (this.chunks) {
                     const col = x; 
                     const row = y;
                     for (const chunk of this.chunks) {
                         if (col >= chunk.x && col < chunk.x + chunk.w &&
                             row >= chunk.y && row < chunk.y + chunk.h) {
                             curLag = chunk.lag;
                             break; // Apply first found (or max if we wanted overlap)
                         }
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
                     
                     // Check if this block is "Lagging" (Delayed Chunk)
                     if (curLag > 0 && dist < outerB) {
                         // LAGGED CHUNK: Faded Pulse Character on Dimmed Background
                         // User Req: "characters... empty due to delay be faded characters the color of the pulse wave"
                         // User Req: "green code... should be dark like the background"
                         
                         const displayChar = String.fromCharCode(this.snap.fillChars[i]);
                         const displayFont = this.snap.fillFonts[i];
                         
                         // Dim the underlying green code
                         let baseColor = grid.colors[i];
                         const r = baseColor & 0xFF;
                         const g = (baseColor >> 8) & 0xFF;
                         const b = (baseColor >> 16) & 0xFF;
                         baseColor = Utils.packAbgr(Math.floor(r * s.pulseDimming), Math.floor(g * s.pulseDimming), Math.floor(b * s.pulseDimming));
                         
                         // Faded Pulse Overlay (Alpha 0.4 - Visible but Dim)
                         grid.setEffectOverlay(i, displayChar, baseColor, 0.4, displayFont, 0); // No glow for faded part
                     } else {
                         // NORMAL BACKGROUND
                         if (isTracer) {
                             // Tracers remain bright outside
                             const glow = (s.pulseUseTracerGlow) ? s.tracerGlow : 0;
                             grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha, fontIdx, glow);
                         } else {
                             grid.setHighPriorityEffect(i, String.fromCharCode(charCode), color, snAlpha * s.pulseDimming, fontIdx, 0);
                         }
                     }
                 } 
                 else {
                     // --- INSIDE WAVE FRONT (Revealing Simulation) ---
                     
                     if (dist > localInner) {
                         // --- WAVE BAND OVERLAY ---

                         // 0. Random Glitch "Dead" Characters (2% chance - sparse)
                         if ((i * 13) % 100 < 2) {
                             grid.clearEffectOverride(i); // Show simulation (with its gaps)
                         } else {
                             // Use random char and font
                             const displayChar = String.fromCharCode(this.snap.fillChars[i]);
                             const displayFont = this.snap.fillFonts[i];

                             // 1. Alpha Variance (15% chance to be 20% darker)
                             // Base: 1.0 (Full Bright)
                             // Variance: 0.8 (20% darker)
                             let alpha = 1.0;
                             if ((i * 37) % 100 < 15) {
                                 alpha = 0.8; 
                             }
                             
                             // 2. Delay Dimming
                             // If this part of the wave is delayed (lagged), dim it.
                             if (curLag > 0) {
                                 alpha *= 0.6;
                             }
                             
                             // Slight Glow -> Bold/Thicker (1.5)
                             const waveGlow = 1.5;

                             // Dimming Logic for Leading Edge (First 5 chars)
                             let baseColor = grid.colors[i];
                             // Check distance from leading edge
                             const edgeDist = localOuter - dist;
                             const threshold = 5 * d.cellWidth * s.stretchX;
                             
                             if (edgeDist < threshold) {
                                 const r = baseColor & 0xFF;
                                 const g = (baseColor >> 8) & 0xFF;
                                 const b = (baseColor >> 16) & 0xFF;
                                 // Dim by 50%
                                 baseColor = Utils.packAbgr(Math.floor(r * 0.5), Math.floor(g * 0.5), Math.floor(b * 0.5));
                             }

                             // Use Overlay Mode (2) to see simulation underneath
                             grid.setEffectOverlay(i, displayChar, baseColor, alpha, displayFont, waveGlow);
                         }
                     } else {
                         // --- HOLE (Full Reveal) ---
                         grid.clearEffectOverride(i);
                     }
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