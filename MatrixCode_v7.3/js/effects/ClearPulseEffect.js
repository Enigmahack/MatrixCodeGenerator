class ClearPulseEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); this.name = "ClearPulse"; 
                this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
                this.snap = null; this.autoTimer = c.state.clearPulseFrequencySeconds * 60;
            }
            trigger() {
                if(this.active) return false;
                const total = this.g.cols * this.g.rows;
                // Snapshot is still needed for gaps (fillChars) and potentially for tracers if "Ignore Tracers" logic depends on it.
                // However, user wants "Identical to pulse but no pause".
                // Standard pulse pauses NATURALLY because it overrides EVERYTHING with a static snapshot.
                // To NOT pause, we must override with LIVE data where possible, OR just tint the live data.
                
                this.snap = { chars: new Uint16Array(this.g.chars), alphas: new Float32Array(this.g.alphas), colors: new Uint32Array(total), tracers: new Uint8Array(total), fillChars: new Uint16Array(total) };
                const d = this.c.derived; const s = this.c.state; const holdEnd = d.cycleDuration + d.holdFrames;
                
                // Snapshot logic from PulseEffect
                for(let i=0; i<total; i++) {
                    let rgb = d.streamRgb; let isTracer = false; const style = this.g.complexStyles.get(i);
                    if(style) rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    else {
                        const type = this.g.types[i]; const age = this.g.ages[i];
                        if(type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && age > 0)) { const at = age - 1; if(at >= 0 && at < holdEnd + s.tracerReleaseFrames) { rgb = d.tracerRgb; isTracer = true; } }
                    }
                    this.snap.colors[i] = Utils.packRgb(rgb.r, rgb.g, rgb.b); this.snap.tracers[i] = isTracer ? 1 : 0; this.snap.fillChars[i] = Utils.getRandomChar().charCodeAt(0);
                }
                
                // Position Logic
                let ox, oy;
                if (s.clearPulseRandomPosition) {
                    ox = Utils.randomInt(this.g.cols*0.2, this.g.cols*0.8);
                    oy = Utils.randomInt(this.g.rows*0.2, this.g.rows*0.8);
                    
                    const cx = Math.floor(this.g.cols / 2);
                    const cy = Math.floor(this.g.rows / 2);
                    
                    const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
                    const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
                    
                    if (pxDistX < s.clearPulseWidth && pxDistY < s.clearPulseWidth) {
                        ox = cx;
                        oy = cy;
                    }
                } else {
                    ox = Math.floor(this.g.cols/2);
                    oy = Math.floor(this.g.rows/2);
                }
                this.origin = {x: ox, y: oy};

                this.active = true; this.state = 'WAITING'; this.timer = s.pulseDelayFrames; this.radius = 0; // No delay for ClearPulse usually? user said "identical". Pulse has delay.
                // If user said "no pause", usually they mean "start immediately" or "background keeps moving".
                // PulseEffect has a WAIT state where it flashes or something? No, it just waits.
                // Let's keep the delay if user said "Identical... except pause/fade".
                // Pulse settings has `pulseDelayFrames`. ClearPulse doesn't have `clearPulseDelayFrames` in the config I made.
                // So I will skip the WAIT state or use a default.
                this.state = 'EXPANDING'; 
                
                const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                this.speed = (maxDim + 200) / Math.max(1, s.clearPulseDurationSeconds * 60);
                return true; 
            }

            update() {
                const s = this.c.state;
                if(!this.active && s.clearPulseEnabled && this.autoTimer-- <= 0) { this.trigger(); this.autoTimer = s.clearPulseFrequencySeconds * 60; }
                if(!this.active) return;
                // No WAIT state logic needed if we skip it.
                this.radius += this.speed; 
                const d = this.c.derived; 
                const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                if(this.radius > maxDim + 400) { this.active = false; this.snap = null; }
            }

            getOverride(i) {
                if(!this.active || !this.snap) return null;
                const s = this.c.state; const d = this.c.derived;
                const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                const cx = Math.floor(x * d.cellWidth * s.stretchX); const cy = Math.floor(y * d.cellHeight * s.stretchY);
                const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX); const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
                
                let dist;
                if (s.clearPulseCircular) {
                    dist = Math.sqrt(Math.pow(cx - ox, 2) + Math.pow(cy - oy, 2));
                } else {
                    const canvasW = this.g.cols * d.cellWidth * s.stretchX;
                    const canvasH = this.g.rows * d.cellHeight * s.stretchY;
                    const ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
                    const dx = Math.abs(cx - ox);
                    const dy = Math.abs(cy - oy);
                    dist = Math.max(dx, dy * ratio);
                }

                const width = s.clearPulseWidth * 2; 
                const innerEdge = this.radius - width;
                
                // OUTSIDE THE PULSE: Return null so LIVE grid shows (NO PAUSE/NO DIM)
                if (dist > this.radius || dist < innerEdge) return null; 
                
                // INSIDE THE PULSE:
                // Here is where we duplicate Pulse logic but apply it to what?
                // If we use `this.snap`, we show static chars (visual pause INSIDE pulse).
                // If we use `this.g`, we show live chars (no pause).
                // User said: "The lit-up characters should all be connected"
                // This implies using `fillChars` for gaps.
                // If we use `fillChars` for gaps, those chars are static (from snapshot).
                // If we use live chars for non-gaps, they move.
                // This hybrid approach creates a "window" of connected code where the gaps are filled with static code and the lines are moving.
                
                const snAlpha = this.g.alphas[i]; // LIVE ALPHA
                let charCode = this.g.chars[i];   // LIVE CHAR
                
                // Gap Logic
                const isGap = (snAlpha <= 0.01);
                if (isGap) { 
                    if (!s.clearPulsePreserveSpaces) {
                        // FILL THE GAP
                        charCode = this.snap.fillChars[i];
                    } else {
                        // Keep it a gap
                        return null; 
                    }
                }
                
                const char = String.fromCharCode(charCode); 
                
                // Tracer Logic (Use LIVE tracer status?)
                // PulseEffect uses snapshot tracer status.
                // Let's use live check.
                // We don't have easy access to "isTracer" from just `g.chars`.
                // We can check `g.types`.
                const type = this.g.types[i];
                const isTracer = (type === CELL_TYPE.TRACER || (type === CELL_TYPE.ROTATOR && this.g.ages[i] > 0)); // Approx check

                const tRgb = d.tracerRgb; 
                const targetColor = `rgb(${tRgb.r},${tRgb.g},${tRgb.b})`;
                let baseColorStr = null; // We need to determine base color if blending

                // Pulse Effect Logic:
                const rel = Math.max(0, Math.min(1, (this.radius - dist) / width));
                let finalColor = targetColor;
                
                if (s.clearPulseBlend) {
                    // We need a base color to blend AGAINST.
                    // Live color?
                    let rgb = d.streamRgb; 
                    const style = this.g.complexStyles.get(i);
                    if(style) rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    else if (isTracer) rgb = d.tracerRgb;
                    
                    const bR = rgb.r; const bG = rgb.g; const bB = rgb.b;
                    const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel); 
                    const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); 
                    const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
                    finalColor = `rgb(${mR},${mG},${mB})`;
                }
                
                // Determine Glow/Alpha
                // PulseEffect: alpha 1.0, glow based on rel.
                return { 
                    char, 
                    color: finalColor, 
                    alpha: 1.0, 
                    glow: Math.max(s.tracerGlow, 30 * (1.0 - rel)), 
                    size: s.tracerSizeIncrease, 
                    solid: true, 
                    bgColor: '#000000' 
                };
            }
        }