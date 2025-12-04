class CanvasRenderer {
            constructor(canvasId, grid, config, effects) {
                this.cvs = document.getElementById(canvasId); this.ctx = this.cvs.getContext('2d', { alpha: false });
                this.bloomCvs = document.getElementById('bloomCanvas'); this.bloomCtx = this.bloomCvs.getContext('2d', { alpha: true });
                this.grid = grid; this.config = config; this.effects = effects; this.w = 0; this.h = 0;
            }
            resize() {
                const s = this.config.state; this.w = window.innerWidth; this.h = window.innerHeight; const scale = s.resolution;
                this.cvs.width = this.w * scale; this.cvs.height = this.h * scale; this.cvs.style.width = this.w + "px"; this.cvs.style.height = this.h + "px";
                this.bloomCvs.width = (this.w * scale) * 0.25; this.bloomCvs.height = (this.h * scale) * 0.25; this.bloomCtx.scale(0.25, 0.25);
                this.updateSmoothing();
            }
            updateSmoothing() { const s = this.config.state; const blur = s.smoothingEnabled ? `${s.smoothingAmount}px` : '0px'; this.cvs.style.filter = `blur(${blur})`; }
            _getTracerState(i, s) {
                const age = this.grid.ages[i]; if (age <= 0 || this.grid.decays[i] >= 2) return { alpha: 0, phase: 'none' };
                const type = this.grid.types[i]; const isTracerCandidate = (type === CELL_TYPE.TRACER || type === CELL_TYPE.ROTATOR);
                if (!isTracerCandidate) return { alpha: 0, phase: 'none' };
                const activeTime = age - 1; const attack = s.tracerAttackFrames; const hold = s.tracerHoldFrames; const release = s.tracerReleaseFrames;
                if (activeTime < attack) return { alpha: (attack > 0) ? (activeTime / attack) : 1.0, phase: 'attack' };
                else if (activeTime < attack + hold) return { alpha: 1.0, phase: 'hold' };
                else if (activeTime < attack + hold + release) { const relTime = activeTime - (attack + hold); return { alpha: 1.0 - (relTime / release), phase: 'release' }; }
                return { alpha: 0, phase: 'none' };
            }
            render(frame) {
                const s = this.config.state; const d = this.config.derived; const scale = s.resolution; const bloom = s.enableBloom;
                this.ctx.save(); this.ctx.scale(scale * s.stretchX, scale * s.stretchY);
                this.ctx.fillStyle = `rgba(0,0,0,${s.clearAlpha})`; this.ctx.fillRect(0, 0, this.w / s.stretchX, this.h / s.stretchY);
                if(bloom) this.bloomCtx.clearRect(0, 0, this.w * scale, this.h * scale);
                const fontBase = d.fontBaseStr; this.ctx.font = fontBase; this.ctx.textBaseline = 'middle'; this.ctx.textAlign = 'center';
                if(s.mirrorEnabled) { this.ctx.scale(-1, 1); this.ctx.translate(-(this.w / s.stretchX), 0); }
                if(bloom) { this.bloomCtx.font = fontBase; this.bloomCtx.textBaseline = 'middle'; this.bloomCtx.textAlign = 'center'; this.bloomCtx.save(); this.bloomCtx.scale(scale * s.stretchX, scale * s.stretchY); if(s.mirrorEnabled) { this.bloomCtx.scale(-1, 1); this.bloomCtx.translate(-(this.w / s.stretchX), 0); } }
                
                const defaultColor = d.streamColorStr; let lastColor = defaultColor;
                this.ctx.fillStyle = defaultColor; this.ctx.shadowBlur = 0; this.ctx.shadowColor = 'transparent';
                if(bloom) this.bloomCtx.fillStyle = defaultColor;
                const xOff = s.fontOffsetX; const yOff = s.fontOffsetY; const total = this.grid.cols * this.grid.rows;

                const useActiveSet = !this.effects.hasActiveEffects();

                if (useActiveSet) {
                    for(const i of this.grid.activeIndices) {
                        // Copied Body for Optimization
                        const override = this.effects.getOverride(i);
                        if(override && !override.blend) { this._drawOverride(i, override, d, s, bloom); lastColor = null; this.ctx.shadowBlur = 0; this.ctx.shadowColor = 'transparent'; continue; }
                        let gridAlpha = this.grid.alphas[i]; if(gridAlpha <= 0.01) continue;
                        const tState = this._getTracerState(i, s); if (tState.phase === 'attack' || tState.phase === 'hold') gridAlpha = 0.0; 
                        if(gridAlpha <= 0.01) continue;
                        const decay = this.grid.decays[i];
                        const x = i % this.grid.cols; const y = Math.floor(i / this.grid.cols);
                        const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff; const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;
                        let color = defaultColor; const style = this.grid.complexStyles.get(i);
                        if(style) { if(style.glitter && Math.random() < 0.02) color = '#ffffff'; else { let h = style.h; if(style.cycle) h = (h + (frame * style.speed)) % 360; color = Utils.hslToRgb(h|0, style.s, style.l); color = `rgb(${color.r},${color.g},${color.b})`; } }
                        if(color !== lastColor) { this.ctx.fillStyle = color; if(bloom) this.bloomCtx.fillStyle = color; lastColor = color; }
                        const rotProg = this.grid.rotatorProg[i]; const char = this.grid.getChar(i);
                        if(rotProg > 0 && s.rotatorCrossfadeFrames > 2) {
                            const p = rotProg / s.rotatorCrossfadeFrames; this.ctx.globalAlpha = gridAlpha * (1 - p); this.ctx.fillText(char, px, py);
                            const next = this.grid.nextChars.get(i); if(next) { this.ctx.globalAlpha = gridAlpha * p; this.ctx.fillText(next, px, py); }
                        } else if(s.dissolveEnabled && decay >= 2) {
                            const prog = (decay - 2) / s.decayFadeDurationFrames; const size = Math.max(1, s.fontSize - ((s.fontSize - s.dissolveMinSize) * prog));
                            const font = `${s.italicEnabled?'italic':''} ${s.fontWeight} ${size}px ${s.fontFamily}`; this.ctx.font = font; 
                            if(s.deteriorationEnabled) { const off = s.deteriorationStrength * prog; this.ctx.globalAlpha = gridAlpha * 0.4 * prog; this.ctx.fillText(char, px, py - off); this.ctx.fillText(char, px, py + off); }
                            this.ctx.globalAlpha = gridAlpha; this.ctx.fillText(char, px, py);
                            if(bloom) { this.bloomCtx.globalAlpha = gridAlpha; this.bloomCtx.fillText(char, px, py); }
                            this.ctx.font = fontBase; 
                        } else { this.ctx.globalAlpha = gridAlpha; this.ctx.fillText(char, px, py); if(bloom) { this.bloomCtx.globalAlpha = gridAlpha; this.bloomCtx.fillText(char, px, py); } }

                        if (override && override.blend) {
                             this._drawOverride(i, override, d, s, bloom);
                             lastColor = null; this.ctx.shadowBlur = 0; this.ctx.shadowColor = 'transparent';
                        }
                    }
                } else {
                    for(let i=0; i<total; i++) {
                        // Original Body
                        const override = this.effects.getOverride(i);
                        if(override && !override.blend) { this._drawOverride(i, override, d, s, bloom); lastColor = null; this.ctx.shadowBlur = 0; this.ctx.shadowColor = 'transparent'; continue; }
                        let gridAlpha = this.grid.alphas[i]; if(gridAlpha <= 0.01) continue;
                        const tState = this._getTracerState(i, s); if (tState.phase === 'attack' || tState.phase === 'hold') gridAlpha = 0.0; 
                        if(gridAlpha <= 0.01) continue;
                        const decay = this.grid.decays[i];
                        const x = i % this.grid.cols; const y = Math.floor(i / this.grid.cols);
                        const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff; const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;
                        let color = defaultColor; const style = this.grid.complexStyles.get(i);
                        if(style) { if(style.glitter && Math.random() < 0.02) color = '#ffffff'; else { let h = style.h; if(style.cycle) h = (h + (frame * style.speed)) % 360; color = Utils.hslToRgb(h|0, style.s, style.l); color = `rgb(${color.r},${color.g},${color.b})`; } }
                        if(color !== lastColor) { this.ctx.fillStyle = color; if(bloom) this.bloomCtx.fillStyle = color; lastColor = color; }
                        const rotProg = this.grid.rotatorProg[i]; const char = this.grid.getChar(i);
                        if(rotProg > 0 && s.rotatorCrossfadeFrames > 2) {
                            const p = rotProg / s.rotatorCrossfadeFrames; this.ctx.globalAlpha = gridAlpha * (1 - p); this.ctx.fillText(char, px, py);
                            const next = this.grid.nextChars.get(i); if(next) { this.ctx.globalAlpha = gridAlpha * p; this.ctx.fillText(next, px, py); }
                        } else if(s.dissolveEnabled && decay >= 2) {
                            const prog = (decay - 2) / s.decayFadeDurationFrames; const size = Math.max(1, s.fontSize - ((s.fontSize - s.dissolveMinSize) * prog));
                            const font = `${s.italicEnabled?'italic':''} ${s.fontWeight} ${size}px ${s.fontFamily}`; this.ctx.font = font; 
                            if(s.deteriorationEnabled) { const off = s.deteriorationStrength * prog; this.ctx.globalAlpha = gridAlpha * 0.4 * prog; this.ctx.fillText(char, px, py - off); this.ctx.fillText(char, px, py + off); }
                            this.ctx.globalAlpha = gridAlpha; this.ctx.fillText(char, px, py);
                            if(bloom) { this.bloomCtx.globalAlpha = gridAlpha; this.bloomCtx.fillText(char, px, py); }
                            this.ctx.font = fontBase; 
                        } else { this.ctx.globalAlpha = gridAlpha; this.ctx.fillText(char, px, py); if(bloom) { this.bloomCtx.globalAlpha = gridAlpha; this.bloomCtx.fillText(char, px, py); } }

                        if (override && override.blend) {
                             this._drawOverride(i, override, d, s, bloom);
                             lastColor = null; this.ctx.shadowBlur = 0; this.ctx.shadowColor = 'transparent';
                        }
                    }
                }

                const tStr = d.tracerColorStr; this.ctx.shadowBlur = s.tracerGlow; this.ctx.shadowColor = tStr;
                const tFont = `${s.italicEnabled?'italic':''} ${s.fontWeight} ${s.fontSize + s.tracerSizeIncrease}px ${s.fontFamily}`;
                this.ctx.font = tFont; if(bloom) this.bloomCtx.font = tFont;

                for(const i of this.grid.activeIndices) {
                    if(this.effects.getOverride(i)) continue;
                    const tState = this._getTracerState(i, s);
                    if (tState.alpha > 0.01) {
                        const x = i % this.grid.cols; const y = Math.floor(i / this.grid.cols);
                        const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff; const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;
                        const style = this.grid.complexStyles.get(i);
                        let cStr = tStr;
                        if (style) { let h = style.h; if(style.cycle) h = (h + (frame * style.speed)) % 360; let tc = Utils.hslToRgb(h|0, 100, 90); cStr = `rgb(${tc.r},${tc.g},${tc.b})`; }
                        this.ctx.fillStyle = cStr; this.ctx.shadowColor = cStr; if(bloom) this.bloomCtx.fillStyle = cStr;
                        this.ctx.globalAlpha = tState.alpha; this.ctx.fillText(this.grid.getChar(i), px, py);
                        if(bloom) { this.bloomCtx.globalAlpha = tState.alpha; this.bloomCtx.fillText(this.grid.getChar(i), px, py); }
                    }
                }
                this.ctx.restore(); 
                if(bloom) { this.bloomCtx.restore(); this.ctx.save(); this.ctx.globalCompositeOperation = 'lighter'; this.ctx.filter = `blur(${s.bloomStrength * 4}px)`; this.ctx.globalAlpha = s.bloomOpacity; this.ctx.drawImage(this.bloomCvs, 0, 0, this.w * scale, this.h * scale); this.ctx.restore(); }
            }

            _drawOverride(i, o, d, s, bloom) {
                const x = i % this.grid.cols; const y = Math.floor(i / this.grid.cols);
                const cx = (x * d.cellWidth) + s.fontOffsetX; const cy = (y * d.cellHeight) + s.fontOffsetY;
                const px = cx + (d.cellWidth * 0.5); const py = cy + (d.cellHeight * 0.5);
                if (o.solid) { const bg = o.bgColor || '#000000'; this.ctx.fillStyle = bg; const w = Math.ceil(d.cellWidth) + 1; const h = Math.ceil(d.cellHeight) + 1; this.ctx.fillRect(Math.floor(cx), Math.floor(cy), w, h); }
                if(o.char && o.alpha > 0.01) {
                    this.ctx.fillStyle = o.color; this.ctx.shadowColor = o.color; this.ctx.shadowBlur = o.glow || 0;
                    const font = `${s.italicEnabled?'italic':''} ${s.fontWeight} ${s.fontSize + (o.size || 0)}px ${s.fontFamily}`;
                    this.ctx.font = font; this.ctx.globalAlpha = o.alpha; this.ctx.fillText(o.char, px, py);
                    if(bloom) { this.bloomCtx.save(); this.bloomCtx.fillStyle = o.color; this.bloomCtx.font = font; this.bloomCtx.globalAlpha = o.alpha; this.bloomCtx.fillText(o.char, px, py); this.bloomCtx.restore(); }
                    this.ctx.font = d.fontBaseStr; 
                }
            }
        }

        // =========================================================================
        // 7. FONT MANAGER
        // =========================================================================
