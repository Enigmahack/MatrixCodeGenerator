class QuantizedRenderer {
    constructor() {
        this._bfsQueue = new Int32Array(65536);
        this._distMap = null;
        this._distMapWidth = 0;
        this._distMapHeight = 0;
        this._distMapDirty = true;
    }

    // --- Core Rendering ---

    updateMask(fx, w, h, s, d) {
        if (!fx.maskCtx || !fx.lineMaskCanvas) {
            fx._warn("[QuantizedRenderer] Canvas Context missing. Re-initializing.");
            fx._ensureCanvases(w, h);
        }

        const ctx = fx.maskCtx;
        const colorLayerCtx = fx.perimeterMaskCanvas.getContext('2d');
        const lineCtx = fx.lineMaskCanvas.getContext('2d');

        ctx.clearRect(0, 0, w, h);
        colorLayerCtx.clearRect(0, 0, w, h);
        lineCtx.clearRect(0, 0, w, h);

        if (!fx.renderGrid) return;

        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = fx.getLineGfxValue('Thickness') || 1.0;
        const innerThickness = fx.getLineGfxValue('InnerThickness') || thickness;

        const baseStep = Math.min(screenStepX, screenStepY);
        
        const unifiedWidth = baseStep * 0.1 * thickness;
        const lineWidthX = unifiedWidth;
        const lineWidthY = unifiedWidth;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        
        const innerUnifiedWidth = baseStep * 0.1 * innerThickness;
        const innerLineWidthX = innerUnifiedWidth;
        const innerLineWidthY = innerUnifiedWidth;
        
        const gridPixW = fx.g.cols * d.cellWidth; 
        const gridPixH = fx.g.rows * d.cellHeight;

        const bs = fx.getBlockSize();
        
        const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        fx.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            innerLineWidthX, innerLineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY,
            userBlockOffX: 0, userBlockOffY: 0,
            pixelOffX: 0,
            pixelOffY: 0
        };
        const l = fx.layout;

        const blocksX = fx.logicGridW;
        const blocksY = fx.logicGridH;
        const { offX, offY } = fx._computeCenteredOffset(blocksX, blocksY, cellPitchX, cellPitchY);
        fx.layout.offX = offX;
        fx.layout.offY = offY;

        const snapThreshX = screenStepX * 1.0; 
        const snapThreshY = screenStepY * 1.0;
        fx._snapSettings = { w, h, tx: snapThreshX, ty: snapThreshY };

        // Populate Suppressed Fades (Keys to ignore for fading this frame)
        fx.suppressedFades.clear();
        
        // Block Erasure Pass - OPTIMIZED: Use a single path for all erasures
        colorLayerCtx.globalCompositeOperation = 'destination-out';
        const now = fx.animFrame;
        const fadeOutFrames = fx.getLineGfxValue('Persistence') || 0;

        colorLayerCtx.beginPath();
        let hasErasures = false;

        for (const op of fx.maskOps) {
            if (op.type !== 'removeBlock') continue;
            
            const cx = Math.floor(blocksX / 2);
            const cy = Math.floor(blocksY / 2);
            
            const x1 = Math.min(op.x1, op.x2);
            const x2 = Math.max(op.x1, op.x2);
            const y1 = Math.min(op.y1, op.y2);
            const y2 = Math.max(op.y1, op.y2);

            for (let by_rel = y1; by_rel <= y2; by_rel++) {
                for (let bx_rel = x1; bx_rel <= x2; bx_rel++) {
                    const gx = cx + bx_rel;
                    const gy = cy + by_rel;
                    if (gx < 0 || gx >= blocksX || gy < 0 || gy >= blocksY) continue;
                    
                    const idx = gy * blocksX + gx;
                    if (fx.renderGrid[idx] === -1) {
                        // Use a private non-filling version of block drawing
                        this._addBlockPath(fx, colorLayerCtx, l, {x: gx, y: gy}, {x: gx, y: gy});
                        hasErasures = true;
                    }
                }
            }
        }
        if (hasErasures) {
            colorLayerCtx.fill();
        }

        // Global Fade Check for Removal Grids
        for (let by = 0; by < blocksY; by++) {
            // Optimization: Only run this if we actually have removal grids
            let hasRemovals = false;
            for(let l=0; l<4; l++) if(fx.removalGrids[l]) { hasRemovals = true; break; }
            if(!hasRemovals) break;

            colorLayerCtx.beginPath();
            let hasPath = false;
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                if (fx.renderGrid[idx] === -1) {
                    let isFading = false;
                    if (fadeOutFrames > 0) {
                        for (let layerIdx = 0; layerIdx < 4; layerIdx++) {
                            const rGrid = fx.removalGrids[layerIdx];
                            if (rGrid && rGrid[idx] !== -1 && now < rGrid[idx] + fadeOutFrames) {
                                isFading = true; break;
                            }
                        }
                    }
                    if (!isFading) {
                        const sx = Math.round((bx - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const ex = Math.round((bx + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                        const sy = Math.round((by - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const ey = Math.round((by + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                        const x = l.screenOriginX + (sx * l.screenStepX) + l.pixelOffX;
                        const y = l.screenOriginY + (sy * l.screenStepY) + l.pixelOffY;
                        const w = (ex - sx) * l.screenStepX;
                        const h = (ey - sy) * l.screenStepY;
                        colorLayerCtx.rect(x - 0.5, y - 0.5, w + 1.0, h + 1.0);
                        hasPath = true;
                    }
                }
            }
            if (hasPath) colorLayerCtx.fill();
        }
        colorLayerCtx.globalCompositeOperation = 'source-over';

        // Unified Shared Edge Rendering (Populate masks for both 2D and WebGL)
        this.renderEdges(fx, ctx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);
        this.renderEdges(fx, colorLayerCtx, null, now, blocksX, blocksY, l.offX, l.offY);

        // Corner Cleanup
        this._renderCornerCleanup(fx, colorLayerCtx, now);
        
        fx.lastMaskUpdateFrame = now;
        fx._snapSettings = null;
    }

    _addBlock(fx, ctx, l, blockStart, blockEnd, isExtending, visibilityCheck) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        this._addBlockPath(fx, ctx, l, blockStart, blockEnd, isExtending, visibilityCheck);
        ctx.fill();
    }

    _addBlockPath(fx, ctx, l, blockStart, blockEnd, isExtending, visibilityCheck) {
        const offX = l.offX || 0;
        const offY = l.offY || 0;
        
        // Apply Offsets to align Logic Grid with Screen
        const sBx = blockStart.x - offX;
        const sBy = blockStart.y - offY;
        const eBx = blockEnd.x - offX;
        const eBy = blockEnd.y - offY;

        const startX = Math.floor(sBx * l.cellPitchX);
        const endX = Math.floor((eBx + 1) * l.cellPitchX);
        const startY = Math.floor(sBy * l.cellPitchY);
        const endY = Math.floor((eBy + 1) * l.cellPitchY);

        if (visibilityCheck) {
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;
            
            for (let by = rangeMinBy; by <= rangeMaxBy; by++) {
                for (let bx = rangeMinBx; bx <= rangeMaxBx; bx++) {
                    if (!visibilityCheck(bx, by)) continue;
                    
                    const drawBx = bx - offX;
                    const drawBy = by - offY;
                    
                    const cellX = Math.floor(drawBx * l.cellPitchX);
                    const cellY = Math.floor(drawBy * l.cellPitchY);
                    const xPos = l.screenOriginX + (cellX * l.screenStepX);
                    const yPos = l.screenOriginY + (cellY * l.screenStepY);
                    
                    const w = l.screenStepX * l.cellPitchX;
                    const h = l.screenStepY * l.cellPitchY;
                    
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
                }
            }
        } else {
            if (isExtending) {
                let cy = l.screenOriginY + (startY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                cy = l.screenOriginY + (endY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                let cx = l.screenOriginX + (startX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
                cx = l.screenOriginX + (endX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
            } else {
                const sCellX = Math.floor(sBx * l.cellPitchX);
                const sCellY = Math.floor(sBy * l.cellPitchY);
                const eCellX = Math.floor((eBx + 1) * l.cellPitchX);
                const eCellY = Math.floor((eBy + 1) * l.cellPitchY);
                
                const xPos = l.screenOriginX + (sCellX * l.screenStepX);
                const yPos = l.screenOriginY + (sCellY * l.screenStepY);
                const w = (eCellX - sCellX) * l.screenStepX;
                const h = (eCellY - sCellY) * l.screenStepY;
                
                ctx.rect(xPos - 0.5, yPos - 0.5, w + 1.0, h + 1.0);
            }
        }
    }

    _addPerimeterFacePath(ctx, l, bx, by, faceObj, widthX, widthY) {
        const offX = l.offX || 0;
        const offY = l.offY || 0;
        
        // Apply Offsets
        const drawBx = bx - offX;
        const drawBy = by - offY;
        
        const startCellX = Math.floor(drawBx * l.cellPitchX);
        const startCellY = Math.floor(drawBy * l.cellPitchY);
        const endCellX = Math.floor((drawBx + 1) * l.cellPitchX);
        const endCellY = Math.floor((drawBy + 1) * l.cellPitchY);

        const face = faceObj.dir;
        const rS = faceObj.rS;
        const rE = faceObj.rE;

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            let drawX, drawY, drawW, drawH;
            const topY = cy; 
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            drawY = topY; 
            drawH = widthY;
            drawX = leftX;
            drawW = rightX - leftX; 
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'S') {
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            drawY = bottomY - widthY; 
            drawH = widthY;
            drawX = leftX;
            drawW = rightX - leftX;
            
            if (rS) { drawX += widthX; drawW -= widthX; }
            if (rE) { drawW -= widthX; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'W') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const leftX = l.screenOriginX + (startCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            drawX = leftX; 
            drawW = widthX;
            drawY = topY;
            drawH = bottomY - topY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
            
            ctx.rect(drawX, drawY, drawW, drawH);

        } else if (face === 'E') {
            const topY = l.screenOriginY + (startCellY * l.screenStepY);
            const bottomY = l.screenOriginY + (endCellY * l.screenStepY);
            const rightX = l.screenOriginX + (endCellX * l.screenStepX);

            let drawX, drawY, drawW, drawH;
            drawX = rightX - widthX; 
            drawW = widthX;
            drawY = topY;
            drawH = bottomY - topY;
            
            if (rS) { drawY += widthY; drawH -= widthY; }
            if (rE) { drawH -= widthY; }
            
            ctx.rect(drawX, drawY, drawW, drawH);
        }
    }

    _getSnap(fx, val, axis) {
        if (!fx._snapSettings) return val;
        const s = fx._snapSettings;
        const max = (axis === 'x') ? s.w : s.h;
        const thresh = (axis === 'x') ? s.tx : s.ty;
        if (val < thresh) return 0;
        if (val > max - thresh) return max;
        return val;
    }

    renderEdges(fx, maskCtx, colorCtx, now, blocksX, blocksY, offX, offY) {
        const color = fx.getConfig('PerimeterColor') || "#FFD700";
        const fadeColor = fx.getConfig('PerimeterFadeColor') || (fx.getConfig('InnerColor') || "#FFD700");
        const fadeOutFrames = fx.getLineGfxValue('Persistence') || 0;
        const fadeInFrames = fx.getConfig('FadeInFrames') || 0;

        const batches = new Map();
        const maskBatches = new Map();
        
        const getBatch = (c, o) => {
            const key = `${c}|${o.toFixed(3)}`;
            if (!batches.has(key)) batches.set(key, new Path2D());
            return batches.get(key);
        };
        const getMaskBatch = (o) => {
            const key = o.toFixed(3);
            if (!maskBatches.has(key)) maskBatches.set(key, new Path2D());
            return maskBatches.get(key);
        };

        const getBlock = (grid, bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return -1;
            return grid[by * blocksX + bx];
        };

        const getFadeState = (deathFrame) => {
             if (fadeOutFrames <= 0 || deathFrame === -1) return null;
             const progress = (now - deathFrame) / fadeOutFrames;
             if (progress < 0 || progress >= 1) return null;
             const colorPhase = 0.25;  
             if (progress < colorPhase) {
                 const t = progress / colorPhase;
                 return { c: this._lerpColor(color, fadeColor, t), o: 1.0 };
             } else {
                 const t = (progress - colorPhase) / (1.0 - colorPhase);
                 return { c: fadeColor, o: 1.0 - t };
             }
        };

        const getBirthState = (birthFrame) => {
            // Birth is always instant in this version.
            // We return a full block if birthFrame is valid (not -1).
            if (birthFrame === -1) return { c: color, o: 1.0 };
            return { c: color, o: 1.0 };
        };

        const resolveEdge = (x, y, type) => {
            let ax, ay, bx, by;
            if (type === 'V') { ax = x - 1; ay = y; bx = x; by = y; }
            else { ax = x; ay = y - 1; bx = x; by = y; }

            const getLVal = (l, tx, ty) => {
                if (tx < 0 || tx >= blocksX || ty < 0 || ty >= blocksY) return -1;
                const idx = ty * blocksX + tx;
                
                // NEW: Respect block invisibility
                if (fx.layerInvisibleGrids && fx.layerInvisibleGrids[l] && fx.layerInvisibleGrids[l][idx] === 1) {
                    return -1;
                }

                return fx.layerGrids[l] ? fx.layerGrids[l][idx] : -1;
            };

            const a0 = getLVal(0, ax, ay), b0 = getLVal(0, bx, by);
            const a1 = getLVal(1, ax, ay), b1 = getLVal(1, bx, by);
            const a2 = getLVal(2, ax, ay), b2 = getLVal(2, bx, by);
            const a3 = getLVal(3, ax, ay), b3 = getLVal(3, bx, by);

            const a23 = (a2 !== -1 && a3 !== -1);
            const b23 = (b2 !== -1 && b3 !== -1);

            let isVisibleNormally = false;
            let isVisibleDimly = false;
            let edgeBirthFrame = -1;
            let dimBirthFrame = -1;

            const key = (type === 'V' ? 0 : 1) + x * 2 + y * 4000;

            // 1. Layer 0 Perimeter: Always Normal
            if ((a0 !== -1) !== (b0 !== -1)) {
                isVisibleNormally = true;
                edgeBirthFrame = Math.max(a0, b0);
            }

            // 2. Layer 1 Perimeter: Normal if not both sides are L0, else Dimmed (Fade Color)
            if ((a1 !== -1) !== (b1 !== -1)) {
                if (a0 !== -1 && b0 !== -1) {
                    isVisibleDimly = true;
                    dimBirthFrame = Math.max(a1, b1);
                } else {
                    isVisibleNormally = true;
                    // Fixed Priority: Only set frame if not already established by a foundation layer (L0)
                    if (edgeBirthFrame === -1) {
                        edgeBirthFrame = Math.max(a1, b1);
                    }
                }
            }

            // 3. Layer 2 & 3 Intersection Perimeter: Normal if not covered by L0 or L1
            if (a23 !== b23) {
                const isCovered = (a0 !== -1 && b0 !== -1) || (a1 !== -1 && b1 !== -1);
                if (!isCovered) {
                    isVisibleNormally = true;
                    if (edgeBirthFrame === -1) {
                        const getB23 = (tx, ty) => {
                            if (tx < 0 || tx >= blocksX || ty < 0 || ty >= blocksY) return -1;
                            const idx = ty * blocksX + tx;
                            if (fx.layerGrids[2] && fx.layerGrids[3] && fx.layerGrids[2][idx] !== -1 && fx.layerGrids[3][idx] !== -1) {
                                return Math.max(fx.layerGrids[2][idx], fx.layerGrids[3][idx]);
                            }
                            return -1;
                        };
                        edgeBirthFrame = Math.max(getB23(ax, ay), getB23(bx, by));
                    }
                }
            }

            let state = fx.lineStates.get(key);
            if (!state) {
                state = {
                    visible: false, deathFrame: -1, birthFrame: -1,
                    dimVisible: false, dimDeathFrame: -1, dimBirthFrame: -1
                };
                fx.lineStates.set(key, state);
            }

            // Normal State Update
            if (isVisibleNormally) {
                if (!state.visible) {
                    state.visible = true;
                    fx.lastVisibilityChangeFrame = now;
                    state.deathFrame = -1;
                    state.birthFrame = edgeBirthFrame;
                }
            } else {
                if (state.visible) {
                    state.visible = false;
                    fx.lastVisibilityChangeFrame = now;
                    state.birthFrame = -1;
                    if (state.deathFrame === -1) state.deathFrame = now;
                }
            }

            // Dim State Update
            if (isVisibleDimly) {
                if (!state.dimVisible) {
                    state.dimVisible = true;
                    fx.lastVisibilityChangeFrame = now;
                    state.dimDeathFrame = -1;
                    state.dimBirthFrame = dimBirthFrame;
                }
            } else {
                if (state.dimVisible) {
                    state.dimVisible = false;
                    fx.lastVisibilityChangeFrame = now;
                    state.dimBirthFrame = -1;
                    if (state.dimDeathFrame === -1) state.dimDeathFrame = now;
                }
            }
        };

        const drawEdge = (x, y, type) => {
            const key = (type === 'V' ? 0 : 1) + x * 2 + y * 4000;
            const state = fx.lineStates.get(key);
            if (!state) return;

            const face = (type === 'V') ? 'W' : 'N';

            // Draw Normal state
            if (state.visible) {
                const birth = getBirthState(state.birthFrame);
                if (birth) {
                    const path = getBatch(birth.c, birth.o);
                    const mPath = getMaskBatch(birth.o);
                    this._addFaceToPath(path, fx, x, y, face);
                    this._addFaceToPath(mPath, fx, x, y, face);
                }
            } else if (state.deathFrame !== -1) {
                const fade = getFadeState(state.deathFrame);
                if (fade) {
                    const path = getBatch(fade.c, fade.o);
                    const mPath = getMaskBatch(fade.o);
                    this._addFaceToPath(path, fx, x, y, face);
                    this._addFaceToPath(mPath, fx, x, y, face);
                } else {
                    state.deathFrame = -1;
                }
            }

            // Draw Dim state (Layer 1 boundary inside Layer 0)
            if (state.dimVisible || state.dimDeathFrame !== -1) {
                const birth = state.dimVisible ? getBirthState(state.dimBirthFrame) : null;
                const fade = state.dimDeathFrame !== -1 ? getFadeState(state.dimDeathFrame) : null;
                const activeState = birth || fade;

                if (activeState) {
                    // Logic for "Layer 0 opacity should change Layer 1 perimeter brightness"
                    // Find Layer 0 opacity at this edge
                    let ax, ay, bx, by;
                    if (type === 'V') { ax = x - 1; ay = y; bx = x; by = y; }
                    else { ax = x; ay = y - 1; bx = x; by = y; }

                    const getL0Opacity = (tx, ty) => {
                        if (tx < 0 || tx >= blocksX || ty < 0 || ty >= blocksY) return 0;
                        const idx = ty * blocksX + tx;
                        const l0Frame = fx.layerGrids[0][idx];
                        const remFrame = fx.removalGrids[0] ? fx.removalGrids[0][idx] : -1;
                        if (l0Frame === -1 && remFrame === -1) return 0;

                        const bState = getBirthState(l0Frame);
                        const fState = getFadeState(remFrame);
                        return (fState ? fState.o : (bState ? bState.o : 0));
                    };

                    const l0Opacity = Math.max(getL0Opacity(ax, ay), getL0Opacity(bx, by));
                    const dimOpacity = activeState.o * l0Opacity;

                    if (dimOpacity > 0.01) {
                        const path = getBatch(fadeColor, dimOpacity);
                        const mPath = getMaskBatch(dimOpacity);
                        this._addFaceToPath(path, fx, x, y, face);
                        this._addFaceToPath(mPath, fx, x, y, face);
                    }
                } else if (state.dimDeathFrame !== -1) {
                    state.dimDeathFrame = -1;
                }
            }
        };
        // Track changes since last frame to only resolve affected edges
        if (fx._lastResolvedFrame !== now) {
            // Check if any blocks were added/removed since LAST RENDER
            const hasNewOps = (fx._lastRendererOpIndex < fx.maskOps.length);
            const orderChanged = fx._gridsDirty;

            if (hasNewOps || orderChanged) {
                // If many changes, do a full scan (simpler for now)
                // In a future optimization, we could use a dirty list.
                for (let x = 0; x <= blocksX; x++) {
                    for (let y = 0; y < blocksY; y++) {
                        resolveEdge(x, y, 'V');
                    }
                }
                for (let y = 0; y <= blocksY; y++) {
                    for (let x = 0; x < blocksX; x++) {
                        resolveEdge(x, y, 'H');
                    }
                }
                fx._lastRendererOpIndex = fx.maskOps.length;

                // Optimization: Periodically purge stale entries from lineStates Map
                // Every 300 frames (5 seconds at 60fps) or when grids changed significantly
                if (now % 300 === 0 || orderChanged) {
                    const maxFade = Math.max(fx.getConfig('FadeFrames') || 0, fx.getLineGfxValue('Persistence') || 0) + 10;
                    for (const [key, state] of fx.lineStates) {
                        const isDead = !state.visible && !state.dimVisible;
                        const normalDone = state.deathFrame === -1 || (now > state.deathFrame + maxFade);
                        const dimDone = state.dimDeathFrame === -1 || (now > state.dimDeathFrame + maxFade);
                        if (isDead && normalDone && dimDone) {
                            fx.lineStates.delete(key);
                        }
                    }
                }
            } else {
                // Only resolve edges that are currently in transition
                // (birthFrame/deathFrame/dimBirthFrame/dimDeathFrame !== -1)
                for (const [key, state] of fx.lineStates) {
                    if (state.birthFrame !== -1 || state.deathFrame !== -1 ||
                        state.dimBirthFrame !== -1 || state.dimDeathFrame !== -1) {
                        
                        const type = (key % 2 === 0) ? 'V' : 'H';
                        const x = Math.floor((key % 4000) / 2);
                        const y = Math.floor(key / 4000);
                        resolveEdge(x, y, type);
                    }
                }
            }
            fx._lastResolvedFrame = now;
        }

        // Always draw active/fading edges
        for (const [key, state] of fx.lineStates) {
            if (state.visible || state.deathFrame !== -1 || state.dimVisible || state.dimDeathFrame !== -1) {
                const type = (key % 2 === 0) ? 'V' : 'H';
                const x = Math.floor((key % 4000) / 2);
                const y = Math.floor(key / 4000);
                drawEdge(x, y, type);
            }
        }

        if (colorCtx) {
            batches.forEach((path, key) => {
                const [c, oStr] = key.split('|');
                colorCtx.fillStyle = c;
                colorCtx.globalAlpha = parseFloat(oStr);
                colorCtx.fill(path);
            });
        }

        maskCtx.fillStyle = "#FFFFFF";
        maskBatches.forEach((path, oStr) => {
            maskCtx.globalAlpha = parseFloat(oStr);
            maskCtx.fill(path);
        });
    }

    _addFaceToPath(path, fx, bx, by, face) {
        const l = fx.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;
        const lwX = l.lineWidthX;
        const lwY = l.lineWidthY;
        
        let startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
        let endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        let startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
        let endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);

        startCellX = Math.max(0, Math.min(fx.g.cols, startCellX));
        endCellX = Math.max(0, Math.min(fx.g.cols, endCellX));
        startCellY = Math.max(0, Math.min(fx.g.rows, startCellY));
        endCellY = Math.max(0, Math.min(fx.g.rows, endCellY));

        let drawX, drawY, drawW, drawH;
        
        const drawR = Math.max(lwX, lwY) * 0.5;

        if (face === 'N') {
            let cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            let rightX = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = this._getSnap(fx, cy, 'y');
            leftX = this._getSnap(fx, leftX, 'x');
            rightX = this._getSnap(fx, rightX, 'x');
            drawY = cy - (lwY * 0.5); 
            drawH = lwY; 
            drawX = leftX;
            drawW = (rightX - leftX);
            
            path.rect(drawX, drawY, drawW, drawH);
            path.arc(drawX, drawY + drawH*0.5, drawR, 0, Math.PI * 2);
            path.arc(drawX + drawW, drawY + drawH*0.5, drawR, 0, Math.PI * 2);
        } else if (face === 'W') {
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            topY = this._getSnap(fx, topY, 'y');
            bottomY = this._getSnap(fx, bottomY, 'y');
            leftX = this._getSnap(fx, leftX, 'x');
            drawX = leftX - (lwX * 0.5); 
            drawW = lwX; 
            drawY = topY;
            drawH = (bottomY - topY);

            path.rect(drawX, drawY, drawW, drawH);
            path.arc(drawX + drawW*0.5, drawY, drawR, 0, Math.PI * 2);
            path.arc(drawX + drawW*0.5, drawY + drawH, drawR, 0, Math.PI * 2);
        }
    }

    _renderCornerCleanup(fx, ctx, now) {
        // Corner cleanup no longer needs manual removal tracking
    }

    _removeBlockCorner(fx, ctx, bx, by, corner) {
        const l = fx.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;

        const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
        const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
        const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);
        
        let cx, cy;
        if (corner === 'NW') {
            cx = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'NE') {
            cx = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SW') {
            cx = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
        } else if (corner === 'SE') {
            cx = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
        }
        
        cx = this._getSnap(fx, cx, 'x');
        cy = this._getSnap(fx, cy, 'y');

        const inflate = 1.0; 
        ctx.beginPath();
        ctx.rect(cx - l.halfLineX - inflate, cy - l.halfLineY - inflate, l.lineWidthX + (inflate*2), l.lineWidthY + (inflate*2));
        ctx.fill();
    }

    computeTrueOutside(fx, blocksX, blocksY, gridOverride = null) {
        if (!gridOverride && fx._outsideMap && fx._outsideMapWidth === blocksX && fx._outsideMapHeight === blocksY && !fx._outsideMapDirty) {
            return fx._outsideMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        if (!gridOverride && (!fx._outsideMap || fx._outsideMap.length !== size)) {
            fx._outsideMap = new Uint8Array(size);
        }
        
        const status = gridOverride ? new Uint8Array(size) : fx._outsideMap;
        status.fill(0);

        const grid = gridOverride || fx.renderGrid;

        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && grid[idx] === -1) { 
                status[idx] = 1;
                queue[tail++] = idx;
            }
        };

        for (let x = 0; x < blocksX; x++) { 
            add(x); 
            add((blocksY - 1) * blocksX + x); 
        }
        for (let y = 1; y < blocksY - 1; y++) {
            add(y * blocksX); 
            add(y * blocksX + (blocksX - 1)); 
        }

        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % blocksX;
            const cy = (idx / blocksX) | 0;
            
            if (cy > 0) add(idx - blocksX);
            if (cy < blocksY - 1) add(idx + blocksX);
            if (cx > 0) add(idx - 1);
            if (cx < blocksX - 1) add(idx + 1);
        }
        
        fx._outsideMapWidth = blocksX;
        fx._outsideMapHeight = blocksY;
        fx._outsideMapDirty = false;

        return status;
    }

    computeDistanceField(fx, blocksX, blocksY) {
        if (this._distMap && this._distMapWidth === blocksX && this._distMapHeight === blocksY && !this._distMapDirty) {
            return this._distMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        if (!this._distMap || this._distMap.length !== size) {
            this._distMap = new Uint16Array(size);
        }
        const dist = this._distMap;
        const maxDist = 999;
        dist.fill(maxDist);

        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;
        
        for (let i = 0; i < size; i++) {
            if (fx.renderGrid[i] === -1) {
                dist[i] = 0;
                queue[tail++] = i;
            }
        }

        while(head < tail) {
            const idx = queue[head++];
            const d = dist[idx];
            
            const cx = idx % blocksX;
            const cy = (idx / blocksX) | 0;

            if (cy > 0) {
                const nIdx = idx - blocksX;
                if (dist[nIdx] === maxDist) { dist[nIdx] = d + 1; queue[tail++] = nIdx; }
            }
            if (cy < blocksY - 1) {
                const nIdx = idx + blocksX;
                if (dist[nIdx] === maxDist) { dist[nIdx] = d + 1; queue[tail++] = nIdx; }
            }
            if (cx > 0) {
                const nIdx = idx - 1;
                if (dist[nIdx] === maxDist) { dist[nIdx] = d + 1; queue[tail++] = nIdx; }
            }
            if (cx < blocksX - 1) {
                const nIdx = idx + 1;
                if (dist[nIdx] === maxDist) { dist[nIdx] = d + 1; queue[tail++] = nIdx; }
            }
        }

        this._distMapWidth = blocksX;
        this._distMapHeight = blocksY;
        this._distMapDirty = false;
        return dist;
    }

    _ensureBfsQueueSize(size) {
        if (!this._bfsQueue || this._bfsQueue.length < size) {
            this._bfsQueue = new Int32Array(size);
        }
    }

    _lerpColor(c1, c2, t) {
        if (!c1 || !c2) return c1 || c2 || '#FFFFFF';
        t = Math.max(0, Math.min(1, t));
        const parse = (c) => {
            const hex = c.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return {r, g, b};
        };
        const rgb1 = parse(c1);
        const rgb2 = parse(c2);
        const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * t);
        const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * t);
        const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * t);
        return `rgb(${r},${g},${b})`;
    }
}