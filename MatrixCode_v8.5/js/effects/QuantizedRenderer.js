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
        const thickness = fx.getConfig('PerimeterThickness') !== undefined ? fx.getConfig('PerimeterThickness') : 1.0;
        const innerThickness = fx.getConfig('InnerThickness') !== undefined ? fx.getConfig('InnerThickness') : thickness;

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
        
        // Block Erasure Pass
        colorLayerCtx.globalCompositeOperation = 'destination-out';
        const now = fx.animFrame;
        const fadeOutFrames = fx.getConfig('FadeFrames') || 0;

        for (const op of fx.maskOps) {
            if (op.type !== 'removeBlock') continue;
            let opacity = 1.0;
            if (now > op.startFrame && fadeOutFrames > 0) {
                opacity = Math.min(1.0, (now - op.startFrame) / fadeOutFrames);
            }
            colorLayerCtx.globalAlpha = opacity;
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
                    // Only erase if this cell is NOT occupied by ANY visible layer in the final composition
                    if (fx.renderGrid[idx] === -1) {
                        this._addBlockToCtx(fx, colorLayerCtx, l, {x: gx, y: gy}, {x: gx, y: gy});
                    }
                }
            }
        }

        // Global Fade Check for Removal Grids
        colorLayerCtx.globalCompositeOperation = 'destination-out';
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                const idx = by * blocksX + bx;
                if (fx.renderGrid[idx] === -1) {
                    let isFading = false;
                    if (fadeOutFrames > 0) {
                        for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
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
                        colorLayerCtx.fillRect(x - 0.5, y - 0.5, w + 1.0, h + 1.0);
                    }
                }
            }
        }
        colorLayerCtx.globalCompositeOperation = 'source-over';

        // Unified Shared Edge Rendering (Legacy 2D path)
        if (s.renderingEngine !== 'webgl') {
            this.renderEdges(fx, ctx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);
            this.renderEdges(fx, colorLayerCtx, lineCtx, now, blocksX, blocksY, l.offX, l.offY);
        }
        
        // Corner Cleanup
        this._renderCornerCleanup(fx, colorLayerCtx, now);
        
        fx.lastMaskUpdateFrame = now;
        fx._snapSettings = null;
    }

    _addBlockToCtx(fx, ctx, l, blockStart, blockEnd) {
        const offX = l.offX || 0;
        const offY = l.offY || 0;

        let startX = Math.round((blockStart.x - offX + l.userBlockOffX) * l.cellPitchX);
        let endX = Math.round((blockEnd.x + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        let startY = Math.round((blockStart.y - offY + l.userBlockOffY) * l.cellPitchY);
        let endY = Math.round((blockEnd.y + 1 - offY + l.userBlockOffY) * l.cellPitchY);

        startX = Math.max(0, Math.min(fx.g.cols, startX));
        endX = Math.max(0, Math.min(fx.g.cols, endX));
        startY = Math.max(0, Math.min(fx.g.rows, startY));
        endY = Math.max(0, Math.min(fx.g.rows, endY));

        ctx.beginPath();
        const xPos = l.screenOriginX + (startX) * l.screenStepX + l.pixelOffX;
        const yPos = l.screenOriginY + (startY) * l.screenStepY + l.pixelOffY;
        const w = (endX - startX) * l.screenStepX;
        const h = (endY - startY) * l.screenStepY;
        
        const sLeft = this._getSnap(fx, xPos, 'x');
        const sTop = this._getSnap(fx, yPos, 'y');
        const sRight = this._getSnap(fx, xPos + w, 'x');
        const sBottom = this._getSnap(fx, yPos + h, 'y');
        
        ctx.rect(sLeft - 0.5, sTop - 0.5, (sRight - sLeft) + 1.0, (sBottom - sTop) + 1.0);
        ctx.fill();
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
        const fadeOutFrames = fx.getConfig('FadeFrames') || 0;
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
            if (fadeInFrames <= 0 || birthFrame === -1) return { c: color, o: 1.0 };
            const progress = (now - birthFrame) / fadeInFrames;
            if (progress < 0) return null;
            if (progress >= 1) return { c: color, o: 1.0 };
            return { c: color, o: progress };
        };

        const resolveEdge = (x, y, type) => {
            let ax, ay, bx, by; 
            if (type === 'V') {
                ax = x - 1; ay = y;
                bx = x;     by = y;
            } else {
                ax = x;     ay = y - 1;
                bx = x;     by = y;
            }

            let isVisibleNormally = false;
            let isVisibleDimly = false;
            let edgeBirthFrame = -1;
            let dimBirthFrame = -1;

            const key = `${type}_${x}_${y}`;
            
            // Layering Logic: Layers 0, 1, 2 determine stacking.
            const visibleLayerIndices = fx.layerOrder.filter(l => l <= 2);

            for (let iOrder = 0; iOrder < visibleLayerIndices.length; iOrder++) {
                const L = visibleLayerIndices[iOrder];
                const grid = fx.layerGrids[L];
                if (!grid) continue;
                
                const aL = (getBlock(grid, ax, ay) !== -1);
                const bL = (getBlock(grid, bx, by) !== -1);

                if (aL !== bL) {
                    // Perimeter of Layer L. How many layers are ABOVE it in Z-order at this edge?
                    let obscureCount = 0;
                    for (let m = 0; m < iOrder; m++) {
                        const M = visibleLayerIndices[m];
                        if (getBlock(fx.layerGrids[M], ax, ay) !== -1 || getBlock(fx.layerGrids[M], bx, by) !== -1) {
                            obscureCount++;
                        }
                    }

                    const birth = Math.max(getBlock(grid, ax, ay), getBlock(grid, bx, by));

                    if (obscureCount < 2) {
                        isVisibleNormally = true;
                        if (birth > edgeBirthFrame) edgeBirthFrame = birth;
                    } else if (obscureCount === 2) {
                        // 3rd layer special rule: Dimmer, North/South face only (H-lines)
                        if (type === 'H') {
                            isVisibleDimly = true;
                            if (birth > dimBirthFrame) dimBirthFrame = birth;
                        }
                    }
                }
            }

            // Normal visibility takes precedence
            if (isVisibleNormally) isVisibleDimly = false;

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
                    state.birthFrame = (edgeBirthFrame === now) ? now : -1;
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
                    state.dimBirthFrame = (dimBirthFrame === now) ? now : -1;
                }
            } else {
                if (state.dimVisible) {
                    state.dimVisible = false;
                    fx.lastVisibilityChangeFrame = now;
                    state.dimBirthFrame = -1;
                    if (state.dimDeathFrame === -1) state.dimDeathFrame = now;
                }
            }

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

            // Draw Dim state (3rd layer)
            if (state.dimVisible) {
                const birth = getBirthState(state.dimBirthFrame);
                if (birth) {
                    const dimOpacity = birth.o * 0.4;
                    const path = getBatch(birth.c, dimOpacity);
                    const mPath = getMaskBatch(dimOpacity);
                    this._addFaceToPath(path, fx, x, y, face);
                    this._addFaceToPath(mPath, fx, x, y, face);
                }
            } else if (state.dimDeathFrame !== -1) {
                const fade = getFadeState(state.dimDeathFrame);
                if (fade) {
                    const dimOpacity = fade.o * 0.4;
                    const path = getBatch(fade.c, dimOpacity);
                    const mPath = getMaskBatch(dimOpacity);
                    this._addFaceToPath(path, fx, x, y, face);
                    this._addFaceToPath(mPath, fx, x, y, face);
                } else {
                    state.dimDeathFrame = -1;
                }
            }
        };

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

        batches.forEach((path, key) => {
            const [c, oStr] = key.split('|');
            colorCtx.fillStyle = c;
            colorCtx.globalAlpha = parseFloat(oStr);
            colorCtx.fill(path);
        });

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
        
        if (face === 'N') {
            let cy = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            let rightX = l.screenOriginX + ((endCellX) * l.screenStepX) + l.pixelOffX;
            cy = this._getSnap(fx, cy, 'y');
            leftX = this._getSnap(fx, leftX, 'x');
            rightX = this._getSnap(fx, rightX, 'x');
            drawY = cy - (lwY * 0.5); 
            drawH = lwY; 
            drawX = leftX - (lwX * 0.5);
            drawW = (rightX - leftX) + lwX;
        } else if (face === 'W') {
            let topY = l.screenOriginY + ((startCellY) * l.screenStepY) + l.pixelOffY;
            let bottomY = l.screenOriginY + ((endCellY) * l.screenStepY) + l.pixelOffY;
            let leftX = l.screenOriginX + ((startCellX) * l.screenStepX) + l.pixelOffX;
            topY = this._getSnap(fx, topY, 'y');
            bottomY = this._getSnap(fx, bottomY, 'y');
            leftX = this._getSnap(fx, leftX, 'x');
            drawX = leftX - (lwX * 0.5); 
            drawW = lwX; 
            drawY = topY - (lwY * 0.5);
            drawH = (bottomY - topY) + lwY;
        }
        
        path.rect(drawX, drawY, drawW, drawH);
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

    computeTrueOutside(fx, blocksX, blocksY) {
        if (fx._outsideMap && fx._outsideMapWidth === blocksX && fx._outsideMapHeight === blocksY && !fx._outsideMapDirty) {
            return fx._outsideMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);
        
        if (!fx._outsideMap || fx._outsideMap.length !== size) {
            fx._outsideMap = new Uint8Array(size);
        }
        const status = fx._outsideMap;
        status.fill(0);

        const queue = this._bfsQueue;
        let head = 0;
        let tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && fx.renderGrid[idx] === -1) { 
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