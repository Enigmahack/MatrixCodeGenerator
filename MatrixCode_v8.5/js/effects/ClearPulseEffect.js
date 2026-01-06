class ClearPulseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "ClearPulse";
        this.active = false;
        this.origin = { x: 0, y: 0 };
        this.radius = 0;
        this.snap = null;
        const s = this._getEffectiveState();
        const fps = s.clearPulseMovieAccurate ? 30 : 60;
        this.autoTimer = s.clearPulseFrequencySeconds * fps;
        this.renderData = null;
        this.chunks = []; // For Movie Accurate Lag
        this.frameAccumulator = 0;
    }

    _getEffectiveState() {
        const s = this.c.state;
        if (!s.clearPulseMovieAccurate) return s;

        // Movie Accurate Overrides
        return {
            ...s,
            clearPulseFrequencySeconds: 235, 
            clearPulseDurationSeconds: 1.4,
            clearPulseWidth: 80, // Approx 7 chars width (depending on font size)
            clearPulseRandomPosition: false,
            clearPulseInstantStart: false,
            clearPulseCircular: false,
            clearPulsePreserveSpaces: false,
            clearPulseUseTracerGlow: false, 
            clearPulseBlend: true
        };
    }

    trigger() {
        if (this.active) return false;

        const total = this.g.cols * this.g.rows;
        const d = this.c.derived;
        const s = this._getEffectiveState();
        const activeFonts = d.activeFonts;
        const numFonts = activeFonts.length;
        const fallbackChars = "MATRIX";

        // Snapshot colors and fill chars
        this.snap = { 
            fillChars: new Uint16Array(total),
            fillFonts: new Uint8Array(total),
            colors: new Uint32Array(this.g.colors),
            tracers: new Uint8Array(total) // Track tracers for center finding
        };

        const holdEnd = d.cycleDuration + d.holdFrames;

        for (let i = 0; i < total; i++) {
            // Identify Tracer State (for center finding)
            const type = this.g.types[i] & CELL_TYPE_MASK; 
            const age = this.g.ages[i];
            let isTracer = false;
            
            if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { 
                const at = age - 1; 
                if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { 
                    isTracer = true;
                } 
            }
            this.snap.tracers[i] = isTracer ? 1 : 0;

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
        if (s.clearPulseMovieAccurate) {
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
        } else if (s.clearPulseRandomPosition) {
            ox = Utils.randomInt(this.g.cols * 0.2, this.g.cols * 0.8);
            oy = Utils.randomInt(this.g.rows * 0.2, this.g.rows * 0.8);
            const cx = Math.floor(this.g.cols / 2);
            const cy = Math.floor(this.g.rows / 2);
            const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
            const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
            if (pxDistX < s.clearPulseWidth && pxDistY < s.clearPulseWidth) { ox = cx; oy = cy; }
        } else {
            ox = Math.floor(this.g.cols / 2);
            oy = Math.floor(this.g.rows / 2);
        }
        this.origin = { x: ox, y: oy };

        this.active = true;
        const fps = s.clearPulseMovieAccurate ? 30 : 60;
        
        // Radius Init
        if (s.clearPulseMovieAccurate) {
            this.radius = 2 * d.cellWidth * s.stretchX; 
        } else {
            this.radius = s.clearPulseInstantStart ? s.clearPulseWidth * 2 : 0;
        }

        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.clearPulseDurationSeconds * fps);
        
        // Reset Chunks
        this.chunks = [];
        this.spawnedCount = 0;
        this.spawnCooldown = 0;

        return true;
    }

    update() {
        const s = this._getEffectiveState();
        const fps = s.clearPulseMovieAccurate ? 30 : 60;

        if (s.clearPulseMovieAccurate) {
             this.frameAccumulator++;
             if (this.frameAccumulator < 2) return;
             this.frameAccumulator = 0;
        } else {
             this.frameAccumulator = 0;
        }

        if (!this.active && s.clearPulseEnabled && this.autoTimer-- <= 0) {
            this.trigger();
            this.autoTimer = s.clearPulseFrequencySeconds * fps;
        }
        if (!this.active) { this.renderData = null; return; }

        const d = this.c.derived;
        const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
        this.speed = (maxDim + 200) / Math.max(1, s.clearPulseDurationSeconds * fps);
        
        this.radius += this.speed;

        if (this.radius > maxDim + 400) { 
            this.active = false; 
            this.snap = null; 
            this.renderData = null; 
            return; 
        }

        // --- Chunk Lifecycle & Spawning (Movie Accurate) ---
        if (s.clearPulseMovieAccurate) {
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
                const w = Utils.randomInt(Math.floor(this.g.cols * 0.5), this.g.cols);
                let h = Utils.randomInt(6, 13);
                let y = Utils.randomInt(Math.floor(this.g.rows * 0.2), Math.floor(this.g.rows * 0.8));
                const x = Utils.randomInt(0, this.g.cols - w);
                
                y = Math.max(0, Math.min(this.g.rows - h, y));

                const delayPixels = 4 * d.cellWidth * s.stretchX; 
                const oneCharTime = (d.cellWidth * s.stretchX) / this.speed;
                const duration = Math.ceil(delayPixels / this.speed) + Math.ceil(oneCharTime) + 2;

                this.chunks.push({
                    x, y, w, h,
                    lag: delayPixels,
                    life: duration
                });

                this.spawnedCount++;
                this.spawnCooldown = duration + 5; 
            }
        }

        // --- Optimization Pre-calc ---
        const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX);
        const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
        const width = s.clearPulseWidth * 2;
        const innerEdge = this.radius - width;

        let ratio = 1;
        if (s.clearPulseMovieAccurate) {
             ratio = 1.0; // Locked 1:1 for Movie Accurate
        } else if (!s.clearPulseCircular) {
            const canvasW = this.g.cols * d.cellWidth * s.stretchX;
            const canvasH = this.g.rows * d.cellHeight * s.stretchY;
            ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
        }

        let minX, maxX, minY, maxY;
        if (s.clearPulseCircular) {
            minX = ox - this.radius; maxX = ox + this.radius;
            minY = oy - this.radius; maxY = oy + this.radius;
        } else {
            minX = ox - this.radius; maxX = ox + this.radius;
            const rY = this.radius / ratio;
            minY = oy - rY; maxY = oy + rY;
        }

        this.renderData = { ox, oy, radius: this.radius, radiusSq: this.radius*this.radius, innerEdge, innerEdgeSq: innerEdge*innerEdge, width, ratio, minX, maxX, minY, maxY };
    }

    applyToGrid(grid) {
        if (!this.active || !this.snap || !this.renderData) return;
        
        const s = this._getEffectiveState();
        const d = this.c.derived;
        const rd = this.renderData;
        const total = grid.cols * grid.rows;
        const aspect = 1.0; 
        
        const tColorInt = d.tracerColorUint32;
        const tR = tColorInt & 0xFF;
        const tG = (tColorInt >> 8) & 0xFF;
        const tB = (tColorInt >> 16) & 0xFF;

        for (let i = 0; i < total; i++) {
            // Optimization: AABB Check (Skip if definitely outside)
            const x = i % grid.cols; 
            const y = Math.floor(i / grid.cols);
            const cx = Math.floor(x * d.cellWidth * s.stretchX);
            const cy = Math.floor(y * d.cellHeight * s.stretchY);

            if (cx < rd.minX || cx > rd.maxX || cy < rd.minY || cy > rd.maxY) continue;

            // Apply Catching Lag (Movie Accurate)
            let curLag = 0;
            if (s.clearPulseMovieAccurate && this.chunks) {
                for (const chunk of this.chunks) {
                    if (x >= chunk.x && x < chunk.x + chunk.w &&
                        y >= chunk.y && y < chunk.y + chunk.h) {
                        curLag = chunk.lag;
                        break;
                    }
                }
            }

            // Effective Radius for this cell
            const localRadius = Math.max(0, rd.radius - curLag);
            const localInnerEdge = Math.max(0, rd.innerEdge - curLag);

            // Distance Calc
            let dist;
            if (s.clearPulseCircular) {
                const dx = cx - rd.ox; const dy = cy - rd.oy;
                dist = Math.sqrt(dx * dx + dy * dy);
            } else {
                const dx = Math.abs(cx - rd.ox);
                const dy = Math.abs(cy - rd.oy);
                dist = Math.max(dx, dy * rd.ratio);
            }

            if (dist < localInnerEdge || dist > localRadius) continue;

            // --- Apply Override ---
            const alpha = grid.alphas[i];
            const isGap = (alpha <= 0.01);

            if (s.clearPulsePreserveSpaces && isGap) continue;

            let charCode, fontIdx, color;
            
            // Use LIVE grid data to prevent freezing
            if (isGap) {
                charCode = this.snap.fillChars[i];
                fontIdx = this.snap.fillFonts[i];
                color = d.streamColorUint32;
            } else {
                charCode = grid.chars[i];
                fontIdx = grid.fontIndices[i];
                color = grid.colors[i];
            }

            const rel = Math.max(0, Math.min(1, (localRadius - dist) / rd.width));
            
            // Apply Glow Toggle
            const baseGlow = Math.max(s.tracerGlow, 30 * (1.0 - rel));
            const actualGlow = (s.clearPulseUseTracerGlow) ? baseGlow : 0;
            
            let finalColor;

            if (!s.clearPulseBlend) {
                // Blend OFF: Solid Tracer Color & Glow
                finalColor = tColorInt;
            } else {
                // Blend ON: Linear fade across the entire wave
                const bR = color & 0xFF;
                const bG = (color >> 8) & 0xFF;
                const bB = (color >> 16) & 0xFF;
                
                const mR = Math.floor(tR + (bR - tR) * rel);
                const mG = Math.floor(tG + (bG - tG) * rel);
                const mB = Math.floor(tB + (bB - tB) * rel);
                finalColor = Utils.packAbgr(mR, mG, mB);
            }

            // For lagged chunks in Movie Accurate mode, dim the wave slightly
            let finalAlpha = 1.0;
            
            if (s.clearPulseMovieAccurate) {
                // Movie Accurate Edge Fading, Variance & Holes
                
                // 1. Holes (10% chance to skip rendering the wave for this cell)
                const holeHash = Math.abs((Math.sin(i * 13.1234) * 43758.5453) % 1);
                if (holeHash < 0.1) {
                    grid.clearEffectOverride(i);
                    continue;
                }

                // 2. Brightness Variance (80% full, 20% vary)
                const varHash = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
                if (varHash < 0.8) {
                    finalAlpha = 1.0;
                } else {
                    // Vary between 0.4 and 0.8
                    finalAlpha = 0.4 + ((varHash - 0.8) / 0.2) * 0.4;
                }
                
                // 3. Edge Fading (Outer 20% and Inner 20%)
                if (rel < 0.2) {
                    // Outer Edge
                    finalAlpha *= (rel / 0.2);
                } else if (rel > 0.8) {
                    // Inner Edge
                    finalAlpha *= ((1.0 - rel) / 0.2);
                }

                if (curLag > 0) {
                    finalAlpha *= 0.6; // Additional dimming for lag
                }
            } else {
                // Standard mode solid alpha
                finalAlpha = 1.0;
            }

            // Use Overlay Mode to preserve background simulation movement
            grid.setEffectOverlay(i, String.fromCharCode(charCode), finalColor, finalAlpha, fontIdx, actualGlow);
        }
    }
}
