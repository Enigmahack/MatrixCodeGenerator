class PulseEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); this.name = "Pulse"; 
                this.active = false; this.origin = {x:0, y:0}; this.radius = 0;
                this.snap = null; this.autoTimer = c.state.pulseFrequencySeconds * 60;
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
                
                // Position Logic
                let ox, oy;
                if (s.pulseRandomPosition) {
                    ox = Utils.randomInt(this.g.cols*0.2, this.g.cols*0.8);
                    oy = Utils.randomInt(this.g.rows*0.2, this.g.rows*0.8);
                    
                    // Snapping Logic
                    const cx = Math.floor(this.g.cols / 2);
                    const cy = Math.floor(this.g.rows / 2);
                    
                    // Calculate pixel distance from center
                    const pxDistX = Math.abs(ox - cx) * d.cellWidth * s.stretchX;
                    const pxDistY = Math.abs(oy - cy) * d.cellHeight * s.stretchY;
                    
                    // If within pulse width (approx), snap to center
                    if (pxDistX < s.pulseWidth && pxDistY < s.pulseWidth) {
                        ox = cx;
                        oy = cy;
                    }
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
                if(!this.active) return;
                if(this.state === 'WAITING') { 
                    if(--this.timer <= 0) { this.state = 'EXPANDING'; this.radius = s.pulseInstantStart ? s.pulseWidth * 2 : 0; }
                } else {
                    this.radius += this.speed; const d = this.c.derived; const maxDim = Math.max(this.g.cols * d.cellWidth * s.stretchX, this.g.rows * d.cellHeight * s.stretchY);
                    if(this.radius > maxDim + 400) { this.active = false; this.snap = null; }
                }
            }
            getOverride(i) {
                if(!this.active || !this.snap) return null;
                const s = this.c.state; const d = this.c.derived;
                const x = i % this.g.cols; const y = Math.floor(i / this.g.cols);
                const cx = Math.floor(x * d.cellWidth * s.stretchX); const cy = Math.floor(y * d.cellHeight * s.stretchY);
                const ox = Math.floor(this.origin.x * d.cellWidth * s.stretchX); const oy = Math.floor(this.origin.y * d.cellHeight * s.stretchY);
                
                let dist;
                if (s.pulseCircular) {
                    dist = Math.sqrt(Math.pow(cx - ox, 2) + Math.pow(cy - oy, 2));
                } else {
                    // Aspect Ratio Pulse
                    const canvasW = this.g.cols * d.cellWidth * s.stretchX;
                    const canvasH = this.g.rows * d.cellHeight * s.stretchY;
                    // Avoid division by zero
                    const ratio = (canvasH > 0) ? (canvasW / canvasH) : 1;
                    
                    const dx = Math.abs(cx - ox);
                    const dy = Math.abs(cy - oy);
                    
                    // Scale Y distance by aspect ratio so it "grows" slower/faster to match width
                    // If W > H (Ratio > 1), we want dy to count 'more' so it reaches H boundary when dx reaches W boundary?
                    // Wait. If W=1000, H=500. Ratio=2.
                    // Edge X=500, Edge Y=250.
                    // max(500, 250 * 2) = 500. Equal.
                    // So dist = max(dx, dy * ratio).
                    
                    dist = Math.max(dx, dy * ratio);
                }

                const width = s.pulseWidth * 2; const innerEdge = this.radius - width;
                if (this.state !== 'WAITING' && dist < innerEdge) return null; 
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
                const rel = Math.max(0, Math.min(1, (this.radius - dist) / width));
                let finalColor = targetColor;
                if (s.pulseBlend) {
                    const baseInt = this.snap.colors[i]; const bR = (baseInt >> 16) & 0xFF; const bG = (baseInt >> 8) & 0xFF; const bB = baseInt & 0xFF;
                    const mR = Math.floor(tRgb.r + (bR - tRgb.r) * rel); const mG = Math.floor(tRgb.g + (bG - tRgb.g) * rel); const mB = Math.floor(tRgb.b + (bB - tRgb.b) * rel);
                    finalColor = `rgb(${mR},${mG},${mB})`;
                }
                return { char, color: finalColor, alpha: 1.0, glow: Math.max(s.tracerGlow, 30 * (1.0 - rel)), size: s.tracerSizeIncrease, solid: true, bgColor: '#000000' };
            }
        }