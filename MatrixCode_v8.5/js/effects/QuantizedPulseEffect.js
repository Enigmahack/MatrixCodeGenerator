class QuantizedPulseEffect extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedPulse";
        this.active = false;
        
        this.configPrefix = "quantizedPulse";

        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation Sequence Data
        this.sequence = [[]]; 
        
        this.expansionPhase = 0;
        this.maskOps = [];
        this.editorHighlight = false;
        
        // Flicker Fix: Swap Transition State
        this.isSwapping = false;
        this.swapTimer = 0;
    }

    trigger(force = false) {
        // 1. Strict Active Check
        if (this.active) return false;

        // 2. Mutually Exclusive Lock
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedGenerate", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    return false;
                }
            }
        }

        if (!super.trigger(force)) return false;
        
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.offsetX = 0.5; 
        this.offsetY = 0.5;

        this._initShadowWorld();
        this.hasSwapped = false;
        this.isSwapping = false;

        // Ensure renderGrid is initialized
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }



    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        this.animFrame++;

        // 1. Animation Cycle (Grid Expansion) - Logic Update
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedPulseSpeed !== undefined) ? s.quantizedPulseSpeed : 1;
        const effectiveInterval = baseDuration * (delayMult / 4.0);

        this.cycleTimer++;

        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        // NEW: Update Render Grid Logic immediately (fixes 1-frame lag)
        this._updateRenderGridLogic();

        // 2. Update Shadow Simulation & Apply Overrides
        if (!this.hasSwapped && !this.isSwapping) {
            super._updateShadowSim();
        } else if (this.isSwapping) {
            super.updateTransition(true);
        }

        // 3. Lifecycle State Machine
        const fadeInFrames = Math.max(1, s.quantizedPulseFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedPulseFadeFrames);
        const durationFrames = s.quantizedPulseDurationSeconds * fps;
        
        const setAlpha = (val) => { this.alpha = Math.max(0, Math.min(1, val)); };

        if (this.state === 'FADE_IN') {
            this.timer++;
            setAlpha(this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.timer = 0;
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++;
            if (!this.debugMode && this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            // If swapping, we handle termination in swap logic.
            // If just fading out (e.g. cancelled), handle standard fade.
            if (!this.isSwapping) {
                this.timer++;
                setAlpha(1.0 - (this.timer / fadeOutFrames));
                if (this.timer >= fadeOutFrames) {
                    this.active = false;
                    this.state = 'IDLE';
                    this.alpha = 0.0;
                    window.removeEventListener('keydown', this._boundDebugHandler);
                    this.g.clearAllOverrides();
                    this.shadowGrid = null;
                    this.shadowSim = null;
                }
            }
        }

        // 4. Animation Transition Management (Dirtiness)
        const addDuration = Math.max(1, s.quantizedPulseFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedPulseFadeFrames || 0);

        if (this.maskOps) {
            for (const op of this.maskOps) {
                const age = this.animFrame - op.startFrame;
                const duration = (op.type === 'remove') ? removeDuration : addDuration;
                if (age < duration) {
                    this._maskDirty = true;
                    break;
                }
            }
        }
    }


    _updateMask(w, h, s, d) {
        if (!this.maskCtx) this._ensureCanvases(w, h);
        
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        const grid = this.g;
        
        if (!ctx) return; // Safety exit if init failed

        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedPulsePerimeterThickness !== undefined) ? s.quantizedPulsePerimeterThickness : 1.0;
        const lineWidthX = screenStepX * 0.25 * thickness;
        const lineWidthY = screenStepY * 0.25 * thickness;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        // User Perimeter Offsets (Pixel Nudge)
        const userPerimeterOffsetX = s.quantizedPerimeterOffsetX || 0;
        const userPerimeterOffsetY = s.quantizedPerimeterOffsetY || 0;

        // User Shadow Offsets (Grid Snap)
        const userShadowOffsetX = s.quantizedShadowOffsetX || 0;
        const userShadowOffsetY = s.quantizedShadowOffsetY || 0;

        // Calculate Block Offsets for Snapping
        const userBlockOffX = userShadowOffsetX / (d.cellWidth * cellPitchX);
        const userBlockOffY = userShadowOffsetY / (d.cellHeight * cellPitchY);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY,
            userBlockOffX, userBlockOffY,
            pixelOffX: userPerimeterOffsetX,
            pixelOffY: userPerimeterOffsetY
        };

        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        // --- SCALED GRID LOGIC ---
        const scaledW = this.logicGridW || blocksX;
        const scaledH = this.logicGridH || blocksY;
        
        // Use centered offset logic (Float)
        const { offX, offY } = this._computeCenteredOffset(scaledW, scaledH, cellPitchX, cellPitchY);
        this.layout.offX = offX;
        this.layout.offY = offY;

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const fadeFrames = this.getConfig('FadeFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);
        const removeDuration = Math.max(1, fadeFrames);

        // Helper for active/outside checks
        // Note: For AddEffect, logic grid matches screen grid logicBlocks, so no scaling offset needed for index lookup.
        // But for consistency with Base, we use the Base helper which uses renderGrid.
        // And we use the Base `_computeTrueOutside` which operates on renderGrid.
        const outsideMap = this._computeTrueOutside(scaledW, scaledH);
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= scaledW || ny < 0 || ny >= scaledH) return false; 
            const idx = ny * scaledW + nx;
            return outsideMap[idx] === 1;
        };
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
            const idx = by * scaledW + bx;
            if (!this.renderGrid || idx < 0 || idx >= this.renderGrid.length || this.renderGrid[idx] === -1) return false;
            return true;
        };

        // --- PASS 1: Base Grid (Interior) ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            this._addBlock(start, end, op.ext); 
        }

        // --- PASS 3: Perimeter (Border) ---
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx; 
            
            const color = this.getConfig('PerimeterColor') || "#FFD700";
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;
            
            pCtx.fillStyle = '#FFFFFF';

            // PART A: Standard Rendering
            for (let by = 0; by < scaledH; by++) {
                for (let bx = 0; bx < scaledW; bx++) {
                    if (!isRenderActive(bx, by)) continue; 
                    
                    const idx = by * scaledW + bx;
                    const startFrame = this.renderGrid[idx];
                    
                    const faces = ['N', 'S', 'W', 'E'];
                    for (const f of faces) {
                        let nx = bx, ny = by;
                        if (f === 'N') ny--; else if (f === 'S') ny++; else if (f === 'W') nx--; else if (f === 'E') nx++;
                        
                        // Use base isTrueOutside
                        const isVoid = isTrueOutside(nx, ny);
                        
                        let draw = isVoid;
                        let opacity = 1.0;
                        
                        if (draw) {
                            if (addDuration > 1 && startFrame !== -1 && !this.debugMode) {
                                opacity = Math.min(1.0, (now - startFrame) / addDuration);
                            }
                        } 
                        
                        if (draw && opacity > 0.001) {
                            pCtx.globalAlpha = opacity;
                            pCtx.beginPath();
                            this._addPerimeterFacePath(pCtx, bx, by, {dir: f, rS: false, rE: false}, boldLineWidthX, boldLineWidthY);
                            pCtx.fill();
                        }
                    }
                }
            }
            
            // --- PASS 3.5: VOID CLEANUP ---
            pCtx.globalCompositeOperation = 'destination-out';
            pCtx.fillStyle = '#FFFFFF';
            pCtx.beginPath();
            
            const l = this.layout;
            
            for (let by = 0; by < scaledH; by++) {
                for (let bx = 0; bx < scaledW; bx++) {
                    if (isTrueOutside(bx, by)) {
                        // FIX: Apply offX/offY subtraction to align with visual grid center
                        const cellX = Math.round((bx - offX) * l.cellPitchX);
                        const cellY = Math.round((by - offY) * l.cellPitchY);
                        
                        const x = l.screenOriginX + (cellX * l.screenStepX);
                        const y = l.screenOriginY + (cellY * l.screenStepY);
                        const w = l.cellPitchX * l.screenStepX;
                        const h = l.cellPitchY * l.screenStepY;
                        
                        // Inflate slightly to ensure full coverage
                        // FIX: Do NOT inflate. Inflation causes bleed into adjacent blocks when sub-pixel alignment is critical.
                        // Rely on strict integer rounding from cellPitch/screenStep which should be exact.
                        pCtx.rect(x, y, w, h); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
            
            this.maskCtx = originalCtx; 
        }

        // --- PASS 4: Add Lines (Interior) ---
        if (lCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = lCtx;
            const iColor = this.getConfig('InnerColor') || "#FFD700";

            // Draw Lines Logic (Simplified for AddEffect compared to Generate)
            for (const op of this.maskOps) {
                if (op.type !== 'addLine') continue;
                
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                
                // Draw line logic here if needed, or rely on base implementation via maskOps
                // For QuantizedAdd, usually lines are added via 'addLine' ops in sequence
                // For brevity, we can reuse the generic line drawer or re-implement if specific logic needed.
                // Assuming standard behavior for now.
                
                // Note: The previous implementation had complex line drawing logic. 
                // Since I am restoring the method, I should include basic line drawing or assume it's handled.
                // However, without the complex logic from Generate, 'addLine' ops won't render.
                // Let's perform a simple iteration for 'addLine' ops.
                
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                const f = op.face ? op.face.toUpperCase() : '';
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        let opacity = 1.0;
                        if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                        
                        // Use Base Class Helper
                        // Note: Internal lines don't need isTrueOutside check usually
                        this._drawInteriorLine(lCtx, bx, by, {dir: f, rS: false, rE: false}, { color: iColor, opacity });
                    }
                }
            }
            this.maskCtx = originalCtx;
        }
    }



    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }
}