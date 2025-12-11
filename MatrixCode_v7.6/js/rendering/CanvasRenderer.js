class CanvasRenderer {
    constructor(canvasId, grid, config, effects) {
        this.cvs = document.getElementById(canvasId);
        this.ctx = this.cvs.getContext('2d', { alpha: false });
        this.bloomCvs = document.getElementById('bloomCanvas');
        this.bloomCtx = this.bloomCvs.getContext('2d', { alpha: true });
        
        // Off-screen buffer for overlap composition
        this.bufferCvs = document.createElement('canvas');
        this.bufferCtx = this.bufferCvs.getContext('2d', { alpha: true });

        // Scratch canvas for temporary operations
        this.scratchCvs = document.createElement('canvas');
        this.scratchCtx = this.scratchCvs.getContext('2d', { alpha: true });
        
        // Unified Render State Arrays
        this.frameAlphas = null;
        this.frameChars = null;
        this.frameFlags = null; // Bit 0: Active, Bit 1: Overlap Allowed

        this.grid = grid;
        this.config = config;
        this.effects = effects;

        // Initialize Glyph Atlases Map
        // Maps Font Name -> GlyphAtlas instance
        this.glyphAtlases = new Map();

        // Initialize Post Processor
        if (typeof PostProcessor !== 'undefined') {
            this.postProcessor = new PostProcessor(config);
            this.postProcessor.canvas.id = 'shaderCanvas';
            this.postProcessor.canvas.style.position = 'absolute';
            this.postProcessor.canvas.style.top = '0';
            this.postProcessor.canvas.style.left = '0';
            this.postProcessor.canvas.style.zIndex = '2'; // Above 2D canvas
            this.postProcessor.canvas.style.display = 'none'; // Hidden by default
            
            // Insert after main canvas
            this.cvs.parentNode.insertBefore(this.postProcessor.canvas, this.cvs.nextSibling);
        }

        this.w = 0;
        this.h = 0;
        this.lastShaderSource = null;

        // Mouse Tracking for Shader
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this._setupMouseTracking();
        
        // Reusable object for tracer state to avoid allocation in hot loops
        this._tracerStateObj = { alpha: 0, phase: 'none' };

        // State Cache
        this._lastFont = null;
        this._lastFillStyle = null;
        this._lastShadowColor = null;
        this._lastShadowBlur = null;
        this._lastGlobalAlpha = null;

        this._lastBloomFont = null;
        this._lastBloomFillStyle = null;
        this._lastBloomGlobalAlpha = null;
    }

    _resetStateCache() {
        this._lastFont = null;
        this._lastFillStyle = null;
        this._lastShadowColor = null;
        this._lastShadowBlur = null;
        this._lastGlobalAlpha = null;

        this._lastBloomFont = null;
        this._lastBloomFillStyle = null;
        this._lastBloomGlobalAlpha = null;
    }

    _setCtxFont(font, bloomEnabled) {
        if (this._lastFont !== font) {
            this.ctx.font = font;
            this._lastFont = font;
        }
        if (bloomEnabled && this._lastBloomFont !== font) {
            this.bloomCtx.font = font;
            this._lastBloomFont = font;
        }
    }

    _setCtxFillStyle(style, bloomEnabled) {
        if (this._lastFillStyle !== style) {
            this.ctx.fillStyle = style;
            this._lastFillStyle = style;
        }
        if (bloomEnabled && this._lastBloomFillStyle !== style) {
            this.bloomCtx.fillStyle = style;
            this._lastBloomFillStyle = style;
        }
    }

    _setCtxShadow(color, blur) {
        if (this._lastShadowColor !== color) {
            this.ctx.shadowColor = color;
            this._lastShadowColor = color;
        }
        if (this._lastShadowBlur !== blur) {
            this.ctx.shadowBlur = blur;
            this._lastShadowBlur = blur;
        }
    }

    _setCtxGlobalAlpha(alpha, bloomEnabled) {
        if (this._lastGlobalAlpha !== alpha) {
            this.ctx.globalAlpha = alpha;
            this._lastGlobalAlpha = alpha;
        }
        if (bloomEnabled && this._lastBloomGlobalAlpha !== alpha) {
            this.bloomCtx.globalAlpha = alpha;
            this._lastBloomGlobalAlpha = alpha;
        }
    }

    _setupMouseTracking() {
        const updateMouse = (e) => {
            const rect = this.cvs.getBoundingClientRect();
            // Normalize to 0..1
            this.mouseX = (e.clientX - rect.left) / rect.width;
            this.mouseY = 1.0 - ((e.clientY - rect.top) / rect.height); // Flip Y to match WebGL coords
            
            // Clamp
            this.mouseX = Math.max(0, Math.min(1, this.mouseX));
            this.mouseY = Math.max(0, Math.min(1, this.mouseY));
        };

        window.addEventListener('mousemove', updateMouse);
        window.addEventListener('touchmove', (e) => {
            if(e.touches.length > 0) updateMouse(e.touches[0]);
        }, { passive: true });
    }

    resize() {
        const scale = this.config.state.resolution;
        this.w = window.innerWidth;
        this.h = window.innerHeight;

        // 1. Main Display Canvas
        this._resizeCanvas(this.cvs, this.w, this.h, scale);

        // Resize Post Processor
        if (this.postProcessor) {
            this.postProcessor.resize(this.w * scale, this.h * scale);
            this.postProcessor.canvas.style.width = `${this.w}px`;
            this.postProcessor.canvas.style.height = `${this.h}px`;
        }

        // 2. Bloom Canvas (1/4 size)
        this._resizeCanvas(this.bloomCvs, this.w, this.h, scale * 0.25);
        this.bloomCtx.scale(0.25, 0.25);

        // 3. Buffer Canvas (Layer A - Stream Shapes)
        this._resizeCanvas(this.bufferCvs, this.w, this.h, scale);
        // Apply global scale so drawing coordinates match main canvas
        this.bufferCtx.scale(scale * this.config.state.stretchX, scale * this.config.state.stretchY);

        // 4. Scratch Canvas (Layer B - Overlap Shapes) -> NOW FULL SCREEN
        this._resizeCanvas(this.scratchCvs, this.w, this.h, scale);
        // Apply global scale so drawing coordinates match main canvas
        this.scratchCtx.scale(scale * this.config.state.stretchX, scale * this.config.state.stretchY);

        // Allocate Frame Buffers
        if (!this.grid.chars) return;
        const size = this.grid.chars.length;
        this.frameAlphas = new Float32Array(size);
        this.frameChars = new Uint16Array(size);
        this.frameFlags = new Uint8Array(size);

        this.updateSmoothing();
    }

    _resizeCanvas(canvas, width, height, scale) {
        canvas.width = width * scale;
        canvas.height = height * scale;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }

    /**
     * Updates canvas smoothing filters for blur effects.
     * Ensures visual fidelity when smoothing is enabled in settings.
     */
    updateSmoothing() {
        const smoothing = this.config.state.smoothingEnabled ? this.config.state.smoothingAmount : 0;
        this.cvs.style.filter = `blur(${smoothing}px)`;
    }

    /**
     * Calculates the alpha and phase of the tracer based on its age and active state.
     * Optimized logic with early returns and simplified operations.
     * Uses a reusable output object to avoid GC.
     */
    _getTracerState(index, state, out) {
        // Reset defaults
        out.alpha = 0;
        out.phase = 'none';

        const age = this.grid.ages[index];
        const decay = this.grid.decays[index];
        if (age <= 0 || decay >= 2) return out;

        const type = this.grid.types[index];
        if (type !== CELL_TYPE.TRACER && type !== CELL_TYPE.ROTATOR) return out;

        const activeTime = age - 1;
        const attack = state.tracerAttackFrames;
        const hold = state.tracerHoldFrames;
        const release = state.tracerReleaseFrames;

        if (activeTime < attack) {
            out.alpha = (attack > 0) ? (activeTime / attack) : 1.0;
            out.phase = 'attack';
        } else if (activeTime < attack + hold) {
            out.alpha = 1.0;
            out.phase = 'hold';
        } else if (activeTime < attack + hold + release) {
            const relTime = activeTime - (attack + hold);
            out.alpha = 1.0 - (relTime / release);
            out.phase = 'release';
        }
        return out;
    }

    _updateAtlases(s, d) {
        if (!s.enableGlyphAtlas || typeof GlyphAtlas === 'undefined') return;

        const activeFonts = d.activeFonts || [];
        const activeNames = new Set(activeFonts.map(f => f.name));

        // Update or Create Atlases
        for (const font of activeFonts) {
            let atlas = this.glyphAtlases.get(font.name);
            if (!atlas) {
                atlas = new GlyphAtlas(this.config, font.name, font.chars);
                this.glyphAtlases.set(font.name, atlas);
            } else {
                // Update existing atlas properties in case chars changed
                atlas.fontName = font.name;
                atlas.customChars = font.chars;
            }
            atlas.update();
        }

        // Prune unused atlases
        for (const [name, atlas] of this.glyphAtlases) {
            if (!activeNames.has(name)) {
                this.glyphAtlases.delete(name);
            }
        }
    }

    render(frame) {
        if (!this.frameAlphas) return;

        const { state: s, derived: d } = this.config;
        const scale = s.resolution;
        const bloomEnabled = s.enableBloom;

        // Update Glyph Atlases
        this._updateAtlases(s, d);

        this._resetContext(this.ctx, s, scale);
        if (bloomEnabled) this.bloomCtx.clearRect(0, 0, this.w * scale, this.h * scale);

        this._applyMirrorEffect(this.ctx, s, scale);
        if (bloomEnabled) {
            this.bloomCtx.save();
            this.bloomCtx.scale(scale * s.stretchX, scale * s.stretchY);
            this._applyMirrorEffect(this.bloomCtx, s, scale);
        }

        this._drawGrid(d, s, frame, bloomEnabled);
        
        if (s.overlapEnabled) {
            this._drawOverlap(d, s, frame, bloomEnabled, scale);
        }

        if (bloomEnabled) this._applyBloom(s, scale);

        // --- Post Processing ---
        if (this.postProcessor && s.shaderEnabled) {
            // Check if shader source changed
            const currentShader = s.customShader;
            if (currentShader && currentShader !== this.lastShaderSource) {
                this.postProcessor.compileShader(currentShader);
                this.lastShaderSource = currentShader;
            }

            // Render to WebGL
            // We pass the 2D canvas as the texture source
            // Pass Mouse (vec2) and Parameter (float)
            const param = s.shaderParameter !== undefined ? s.shaderParameter : 0.5;
            this.postProcessor.render(this.cvs, performance.now() / 1000, this.mouseX, this.mouseY, param);
            
            // Show WebGL, Hide 2D
            if (this.postProcessor.canvas.style.display === 'none') {
                this.postProcessor.canvas.style.display = 'block';
                this.cvs.style.opacity = '0'; // Hide visual but keep active
            }
        } else {
            // Show 2D, Hide WebGL
            if (this.postProcessor && this.postProcessor.canvas.style.display !== 'none') {
                this.postProcessor.canvas.style.display = 'none';
                this.cvs.style.opacity = '1';
            }
        }
    }

    _drawOverlap(d, s, frame, bloomEnabled, scale) {
        // --- SETUP ---
        const ctxA = this.bufferCtx; // Layer A (Stream Shapes)
        const cvsA = this.bufferCvs;
        const ctxB = this.scratchCtx; // Layer B (Overlap Shapes)
        const cvsB = this.scratchCvs;

        // Clear both layers
        const clearW = this.w / s.stretchX; 
        const clearH = this.h / s.stretchY;
        
        ctxA.clearRect(0, 0, clearW, clearH);
        ctxB.clearRect(0, 0, clearW, clearH);

        // Constants
        const xOff = s.fontOffsetX;
        const yOff = s.fontOffsetY;
        const useAtlas = s.enableGlyphAtlas;
        
        if (!useAtlas) {
            ctxA.fillStyle = '#FFFFFF';
            ctxB.fillStyle = '#FFFFFF';
            ctxA.textBaseline = 'middle';
            ctxA.textAlign = 'center';
            ctxB.textBaseline = 'middle';
            ctxB.textAlign = 'center';
        }

        // --- PASS 1: DRAW SHAPES ---
        const activeFonts = d.activeFonts;

        for (const i of this.grid.activeIndices) {
            // 1. Filter Logic
            const style = this.grid.complexStyles.get(i);
            if (style && style.isEffect) continue;

            const overlapTarget = s.overlapTarget || 'stream';
            if (overlapTarget === 'stream') {
                const cellType = this.grid.types[i];
                if (cellType !== CELL_TYPE.TRACER && cellType !== CELL_TYPE.ROTATOR) continue;
            }

            let gridAlpha = this.grid.alphas[i];
            const tState = this._getTracerState(i, s, this._tracerStateObj);
            if (tState.phase === 'attack' || tState.phase === 'hold') gridAlpha = 0.0;
            const override = this.effects.getOverride(i);
            if (override && typeof override.alpha === 'number') gridAlpha = override.alpha;
            
            if (gridAlpha <= 0.05) continue;

            const code = this.grid.overlapChars[i];
            if (code === 0) continue;

            // 2. Geometry
            const x = i % this.grid.cols;
            const y = Math.floor(i / this.grid.cols);
            const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff;
            const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;

            let streamChar = this.grid.getChar(i);
            if (override && override.char) streamChar = override.char;
            const overlapChar = String.fromCharCode(code);

            // Determine font resources
            let atlas = null;
            let fontName = s.fontFamily;
            
            if (useAtlas) {
                const fontIndex = this.grid.getFont(i);
                const fontData = activeFonts[fontIndex] || activeFonts[0];
                atlas = this.glyphAtlases.get(fontData.name);
            } else {
                const fontIndex = this.grid.getFont(i);
                const fontData = activeFonts[fontIndex] || activeFonts[0];
                fontName = fontData.name;
            }

            // Calculate Effects (Dissolve/Size)
            const decay = this.grid.decays[i];
            let drawScale = 1.0;
            
            if (s.dissolveEnabled && decay >= 2) {
                 const prog = (decay - 2) / s.decayFadeDurationFrames;
                 const minRatio = s.dissolveMinSize / s.fontSize;
                 drawScale = 1.0 - (prog * (1.0 - minRatio));
                 drawScale = Math.max(0.1, drawScale);
            }

            ctxA.globalAlpha = 1.0; 
            ctxB.globalAlpha = gridAlpha; 

            // 3. Draw to Layer A (Stream Base)
            if (useAtlas && atlas) {
                const sprite = atlas.get(streamChar);
                if (sprite) {
                    ctxA.drawImage(atlas.canvas, 
                        sprite.x, sprite.y, sprite.w, sprite.h, 
                        px - (sprite.w * drawScale)/2, py - (sprite.h * drawScale)/2, 
                        sprite.w * drawScale, sprite.h * drawScale
                    );
                }
            } else {
                const fontSize = Math.max(1, s.fontSize * drawScale);
                const font = `${s.italicEnabled ? 'italic' : ''} ${s.fontWeight} ${fontSize}px ${fontName}`;
                ctxA.font = font;
                ctxA.fillText(streamChar, px, py);
            }

            // 4. Draw to Layer B (Overlap Mask)
            if (useAtlas && atlas) {
                const sprite = atlas.get(overlapChar);
                if (sprite) {
                    ctxB.drawImage(atlas.canvas, 
                        sprite.x, sprite.y, sprite.w, sprite.h, 
                        px - (sprite.w * drawScale)/2, py - (sprite.h * drawScale)/2, 
                        sprite.w * drawScale, sprite.h * drawScale
                    );
                }
            } else {
                const fontSize = Math.max(1, s.fontSize * drawScale);
                const font = `${s.italicEnabled ? 'italic' : ''} ${s.fontWeight} ${fontSize}px ${fontName}`;
                ctxB.font = font;
                ctxB.fillText(overlapChar, px, py);
            }
        }

        // --- PASS 2: COMPOSITE ---
        ctxA.save();
        ctxA.setTransform(1, 0, 0, 1, 0, 0); 
        ctxA.globalCompositeOperation = 'source-in';
        ctxA.globalAlpha = 1.0; 
        ctxA.drawImage(cvsB, 0, 0);
        ctxA.globalCompositeOperation = 'source-in';
        ctxA.fillStyle = s.overlapColor;
        ctxA.fillRect(0, 0, cvsA.width, cvsA.height);
        ctxA.restore(); 

        // --- PASS 3: FINAL DRAW ---
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(cvsA, 0, 0);
        this.ctx.restore();
    }

    _resetContext(ctx, s, scale) {
        ctx.save();
        ctx.scale(scale * s.stretchX, scale * s.stretchY);
        ctx.fillStyle = `rgba(0,0,0,${s.clearAlpha})`;
        ctx.fillRect(0, 0, this.w / s.stretchX, this.h / s.stretchY);
    }

    _applyMirrorEffect(ctx, s, scale) {
        if (s.mirrorEnabled) {
            ctx.scale(-1, 1);
            ctx.translate(-(this.w / s.stretchX), 0);
        }
    }

    _applyBloom(s, scale) {
        if (this.bloomCvs.width === 0 || this.bloomCvs.height === 0) return;

        this.bloomCtx.restore();
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';
        this.ctx.filter = `blur(${s.bloomStrength * 4}px)`;
        this.ctx.globalAlpha = s.bloomOpacity;
        this.ctx.drawImage(this.bloomCvs, 0, 0, this.w * scale, this.h * scale);
        this.ctx.restore();
    }

    _drawGrid(d, s, frame, bloomEnabled) {
        this._resetStateCache(); // Reset cache at start of grid draw

        const fontBase = d.fontBaseStr;
        
        // Only set font if NOT using atlas for everything
        this._setCtxFont(fontBase, bloomEnabled);
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';
        
        if (bloomEnabled) {
            this.bloomCtx.textBaseline = 'middle';
            this.bloomCtx.textAlign = 'center';
        }

        const defaultColor = d.streamColorStr;
        let lastColor = defaultColor;
        this._setCtxFillStyle(defaultColor, bloomEnabled);

        const xOff = s.fontOffsetX;
        const yOff = s.fontOffsetY;
        
        const useActiveSet = !this.effects.hasActiveEffects();
        
        // Decide drawing mode once per frame
        const useAtlas = s.enableGlyphAtlas;

        const total = useActiveSet ? 0 : this.grid.cols * this.grid.rows;
        
        const activeFonts = d.activeFonts;

        if (useActiveSet) {
            for (const i of this.grid.activeIndices) {
                this._processCellRender(i, d, s, frame, bloomEnabled, fontBase, defaultColor, xOff, yOff, lastColor, useAtlas, activeFonts);
            }
        } else {
            for (let i = 0; i < total; i++) {
                this._processCellRender(i, d, s, frame, bloomEnabled, fontBase, defaultColor, xOff, yOff, lastColor, useAtlas, activeFonts);
            }
        }

        this._drawTracers(d, s, frame, bloomEnabled, xOff, yOff);
        this.ctx.restore();
    }

    _processCellRender(i, d, s, frame, bloomEnabled, fontBase, defaultColor, xOff, yOff, lastColor, useAtlas, activeFonts) {
            this._setCtxShadow('transparent', 0);

            const override = this.effects.getOverride(i);
            if (override && !override.blend) {
                this._drawOverride(i, override, d, s, bloomEnabled);
                return;
            }

            let gridAlpha = this.grid.alphas[i];
            if (gridAlpha <= 0.01) return;

            const tState = this._getTracerState(i, s, this._tracerStateObj);
            if (tState.phase === 'attack' || tState.phase === 'hold') gridAlpha = 0.0;
            if (gridAlpha <= 0.01) return;

            const x = i % this.grid.cols;
            const y = Math.floor(i / this.grid.cols);
            const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff;
            const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;

            let color = defaultColor;
            let pIdx = this.grid.paletteIndices[i];
            if (pIdx >= d.paletteColorsStr.length) pIdx = 0;
            const paletteColor = d.paletteColorsStr[pIdx] || defaultColor;

            const style = this.grid.complexStyles.get(i);
            if (style) {
                color = this._getCellColor(style, frame);
            } else {
                color = paletteColor;
            }

            const canUseAtlas = useAtlas && (color === paletteColor);

            if (!canUseAtlas && color !== lastColor) {
                this._setCtxFillStyle(color, bloomEnabled);
                lastColor = color;
            }

            // Resolve Font
            const fontIdx = this.grid.getFont(i);
            const fontData = activeFonts[fontIdx] || activeFonts[0];
            const currentFontName = fontData.name;

            if (canUseAtlas) {
                 const atlas = this.glyphAtlases.get(currentFontName);
                 if (atlas) {
                     this._drawCellCharAtlas(i, px, py, gridAlpha, s, bloomEnabled, pIdx, atlas);
                 } else {
                     // Fallback if atlas missing
                     this._drawCellChar(i, px, py, gridAlpha, tState, d, s, bloomEnabled, currentFontName);
                 }
            } else {
                 this._drawCellChar(i, px, py, gridAlpha, tState, d, s, bloomEnabled, currentFontName);
            }

            if (override && override.blend) {
                this._drawOverride(i, override, d, s, bloomEnabled);
            }
    }

    _drawCellCharAtlas(i, px, py, alpha, s, bloomEnabled, pIdx, atlas) {
        const decay = this.grid.decays[i];
        const char = this.grid.getChar(i);
        const sprite = atlas.get(char);
        const yOffset = (pIdx || 0) * atlas.blockHeight;

        if (!sprite) return; 

        const rotProg = this.grid.rotatorProg[i];
        if (rotProg > 0 && s.rotatorCrossfadeFrames > 2) {
             const p = rotProg / s.rotatorCrossfadeFrames;
             const next = this.grid.nextChars.get(i);
             const nextSprite = next ? atlas.get(next) : null;

             this._setCtxGlobalAlpha(alpha * (1 - p), bloomEnabled);
             this.ctx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - sprite.w/2, py - sprite.h/2, sprite.w, sprite.h);
             if(bloomEnabled) {
                 this.bloomCtx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - sprite.w/2, py - sprite.h/2, sprite.w, sprite.h);
             }

             if (nextSprite) {
                 this._setCtxGlobalAlpha(alpha * p, bloomEnabled);
                 this.ctx.drawImage(atlas.canvas, nextSprite.x, nextSprite.y + yOffset, nextSprite.w, nextSprite.h, px - nextSprite.w/2, py - nextSprite.h/2, nextSprite.w, nextSprite.h);
                 if(bloomEnabled) {
                     this.bloomCtx.drawImage(atlas.canvas, nextSprite.x, nextSprite.y + yOffset, nextSprite.w, nextSprite.h, px - nextSprite.w/2, py - nextSprite.h/2, nextSprite.w, nextSprite.h);
                 }
             }
             return;
        }

        let scale = 1.0;
        if (s.dissolveEnabled && decay >= 2) {
             const prog = (decay - 2) / s.decayFadeDurationFrames;
             const minRatio = s.dissolveMinSize / s.fontSize;
             scale = 1.0 - (prog * (1.0 - minRatio));
             scale = Math.max(0.1, scale); 

             if (s.deteriorationEnabled) {
                 const off = s.deteriorationStrength * prog;
                 this._setCtxGlobalAlpha(alpha * 0.4 * prog, false); // Explicitly only ctx for deterioration? Or both? Original code: this.ctx.globalAlpha = ...
                 // Original only set this.ctx.globalAlpha. Bloom wasn't explicitly drawn for deterioration ghosting.
                 this.ctx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - (sprite.w*scale)/2, (py - off) - (sprite.h*scale)/2, sprite.w*scale, sprite.h*scale);
                 this.ctx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - (sprite.w*scale)/2, (py + off) - (sprite.h*scale)/2, sprite.w*scale, sprite.h*scale);
             }
        }

        this._setCtxGlobalAlpha(alpha, bloomEnabled);
        this.ctx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - (sprite.w*scale)/2, py - (sprite.h*scale)/2, sprite.w*scale, sprite.h*scale);
        
        if (bloomEnabled) {
            this.bloomCtx.drawImage(atlas.canvas, sprite.x, sprite.y + yOffset, sprite.w, sprite.h, px - (sprite.w*scale)/2, py - (sprite.h*scale)/2, sprite.w*scale, sprite.h*scale);
        }
    }

    _getCellColor(style, frame) {
        if (style.glitter && Math.random() < 0.02) return '#ffffff';
        let h = style.h;
        if (style.cycle) h = (h + (frame * style.speed)) % 360;
        const rgb = Utils.hslToRgb(h | 0, style.s, style.l);
        return Utils.createRGBString(rgb);
    }

    _drawCellChar(i, px, py, alpha, tState, d, s, bloomEnabled, fontName) {
        const decay = this.grid.decays[i];
        const rotProg = this.grid.rotatorProg[i];
        const char = this.grid.getChar(i);
        
        // Use fontName passed in
        const fontSize = s.fontSize; // Could vary with dissolve
        const fontBase = `${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${fontSize}px ${fontName}`;
        this._setCtxFont(fontBase, bloomEnabled);

        if (rotProg > 0 && s.rotatorCrossfadeFrames > 2) {
            const p = rotProg / s.rotatorCrossfadeFrames;
            
            this._setCtxGlobalAlpha(alpha * (1 - p), bloomEnabled);
            this.ctx.fillText(char, px, py);
            if (bloomEnabled) {
                this.bloomCtx.fillText(char, px, py);
            }

            const next = this.grid.nextChars.get(i);
            if (next) {
                this._setCtxGlobalAlpha(alpha * p, bloomEnabled);
                this.ctx.fillText(next, px, py);
                if (bloomEnabled) {
                    this.bloomCtx.fillText(next, px, py);
                }
            }
        } else if (s.dissolveEnabled && decay >= 2) {
            const prog = (decay - 2) / s.decayFadeDurationFrames;
            const size = Math.max(1, s.fontSize - ((s.fontSize - s.dissolveMinSize) * prog));
            const font = `${s.italicEnabled ? 'italic' : ''} ${s.fontWeight} ${size}px ${fontName}`;
            this._setCtxFont(font, false); // Bloom font handled via base or ignore for dissolve? Original updated this.ctx.font
            // Actually, original updated ctx.font. BloomCtx doesn't seem to be updated for dissolve font size in original logic explicitly unless bloomEnabled was true, but original logic:
            // this.ctx.font = font; ... if(bloomEnabled) this.bloomCtx.fillText...
            // Bloom context uses its current font. If we didn't update bloom font, it might be wrong.
            // Let's assume we should update bloom font if enabled.
            if(bloomEnabled) this.bloomCtx.font = font; 
            // Updating my helper to allow single context update is tricky.
            // I'll manually set for now or assume bloom follows.
            // _setCtxFont updates both if bloomEnabled is true.
            
            if (s.deteriorationEnabled) {
                const off = s.deteriorationStrength * prog;
                this._setCtxGlobalAlpha(alpha * 0.4 * prog, false);
                this.ctx.fillText(char, px, py - off);
                this.ctx.fillText(char, px, py + off);
            }
            
            this._setCtxGlobalAlpha(alpha, bloomEnabled);
            this.ctx.fillText(char, px, py);
            if (bloomEnabled) {
                this.bloomCtx.fillText(char, px, py);
            }
        } else {
            this._setCtxGlobalAlpha(alpha, bloomEnabled);
            this.ctx.fillText(char, px, py);
            if (bloomEnabled) {
                this.bloomCtx.fillText(char, px, py);
            }
        }
    }

    _drawTracers(d, s, frame, bloomEnabled, xOff, yOff) {
        const tStr = d.tracerColorStr;
        this._setCtxShadow(tStr, s.tracerGlow);
        
        const activeFonts = d.activeFonts;

        for (const i of this.grid.activeIndices) {
            if (this.effects.getOverride(i)) continue;
            const tState = this._getTracerState(i, s, this._tracerStateObj);
            if (tState.alpha > 0.01) {
                const x = i % this.grid.cols;
                const y = Math.floor(i / this.grid.cols);
                const px = (x * d.cellWidth + d.cellWidth * 0.5) + xOff;
                const py = (y * d.cellHeight + d.cellHeight * 0.5) + yOff;
                
                // Font Setup
                const fontIdx = this.grid.getFont(i);
                const fontData = activeFonts[fontIdx] || activeFonts[0];
                const tFont = `${s.italicEnabled ? 'italic' : ''} ${s.fontWeight} ${s.fontSize + s.tracerSizeIncrease}px ${fontData.name}`;
                
                this._setCtxFont(tFont, bloomEnabled);

                const style = this.grid.complexStyles.get(i);
                let cStr = tStr;
                if (style && style.isEffect) {
                    let h = style.h;
                    if (style.cycle) h = (h + (frame * style.speed)) % 360;
                    const tc = Utils.hslToRgb(h | 0, 100, 90);
                    cStr = Utils.createRGBString(tc);
                }

                this._setCtxFillStyle(cStr, bloomEnabled);
                // Shadow color tracks fill style for tracers usually? Original code set shadowColor = cStr
                // Yes: this.ctx.shadowColor = cStr;
                // But my helper _setCtxShadow handles color and blur together.
                // I need to update shadow color if it changed.
                if (this._lastShadowColor !== cStr) {
                    this.ctx.shadowColor = cStr;
                    this._lastShadowColor = cStr;
                }

                this._setCtxGlobalAlpha(tState.alpha, bloomEnabled);
                this.ctx.fillText(this.grid.getChar(i), px, py);
                if (bloomEnabled) {
                    this.bloomCtx.fillText(this.grid.getChar(i), px, py);
                }
            }
        }
    }

    _drawOverride(i, o, d, s, bloom) {
        const x = i % this.grid.cols;
        const y = Math.floor(i / this.grid.cols);
        const cx = (x * d.cellWidth) + s.fontOffsetX;
        const cy = (y * d.cellHeight) + s.fontOffsetY;
        
        // Geometry for solid background
        if (o.solid) {
            const bg = o.bgColor || '#000000';
            this._setCtxFillStyle(bg, false); // Backgrounds usually don't bloom? Original code didn't draw bg to bloomCtx.
            // Original: this.ctx.fillStyle = bg; ... fillRect
            const w = Math.ceil(d.cellWidth) + 1;
            const h = Math.ceil(d.cellHeight) + 1;
            this.ctx.fillRect(Math.floor(cx), Math.floor(cy), w, h);
        }

        if (o.char && o.alpha > 0.01) {
            const px = cx + (d.cellWidth * 0.5);
            const py = cy + (d.cellHeight * 0.5);
            
            const fontName = o.font || s.fontFamily;
            
            // FILLTEXT PATH (Unified)
            // Effects require dynamic colors/sizes not supported by simple atlas draw
            this._setCtxFillStyle(o.color, bloom);
            
            if (o.glow > 0) {
                this._setCtxShadow(o.color, o.glow);
            } else {
                this._setCtxShadow('transparent', 0);
            }
            
            const font = `${s.italicEnabled ? 'italic' : ''} ${s.fontWeight} ${s.fontSize + (o.size || 0)}px ${fontName}`;
            this._setCtxFont(font, bloom);
            
            this._setCtxGlobalAlpha(o.alpha, bloom);
            
            this.ctx.fillText(o.char, px, py);
            
            if (bloom) {
                this.bloomCtx.fillText(o.char, px, py);
            }
        }
    }
}