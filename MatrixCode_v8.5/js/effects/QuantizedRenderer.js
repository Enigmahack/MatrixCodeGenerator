class QuantizedRenderer {
    static instance = null;

    constructor() {
        if (QuantizedRenderer.instance) return QuantizedRenderer.instance;
        
        this._bfsQueue = new Int32Array(1048576);
        this._distMap = null;
        this._distMapWidth = 0;
        this._distMapHeight = 0;
        this._distMapDirty = true;
        this._edgeBatches = new Map();
        this._edgeMaskBatches = new Map();
        this._cachedEdgeMaps = [];
        this._edgeCacheDirty = true;

        QuantizedRenderer.instance = this;
    }

    // --- Core Rendering ---

    updateMask(fx, w, h, s, d) {
        if (!fx.maskCtx || !fx.lineMaskCanvas) {
            fx._ensureCanvases(w, h);
        }

        const ctx = fx.maskCtx;
        const colorLayerCtx = fx.perimeterMaskCanvas.getContext('2d');
        const lineCtx = fx.lineMaskCanvas.getContext('2d');

        ctx.clearRect(0, 0, w, h);
        colorLayerCtx.clearRect(0, 0, w, h);
        lineCtx.clearRect(0, 0, w, h);
        if (fx.echoCtx) fx.echoCtx.clearRect(0, 0, w, h);

        if (!fx.renderGrid) return;

        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = fx.getLineGfxValue('Thickness') || 1.0;
        const echoThickness = fx.getEchoGfxValue('Thickness') || 1.0;

        const baseStep = Math.min(screenStepX, screenStepY);
        
        const lineWidthX = baseStep * 0.1 * thickness;
        const lineWidthY = lineWidthX;
        const halfLineX = lineWidthX * 0.5;
        const halfLineY = halfLineX;

        const echoLineWidthX = baseStep * 0.1 * echoThickness;
        const echoLineWidthY = echoLineWidthX;
        const echoHalfLineX = echoLineWidthX * 0.5;
        const echoHalfLineY = echoHalfLineX;
        
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
            halfLineX, halfLineY,
            echoLineWidthX, echoLineWidthY,
            echoHalfLineX, echoHalfLineY,
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
        for (const op of fx.maskOps) {
            if (op.startFrame > fx.lastMaskUpdateFrame && op.startFrame <= fx.animFrame && op.fade === false) {
                const cx = Math.floor(blocksX / 2);
                const cy = Math.floor(blocksY / 2);
                const x1 = Math.min(op.x1, op.x2);
                const x2 = Math.max(op.x1, op.x2);
                const y1 = Math.min(op.y1, op.y2);
                const y2 = Math.max(op.y1, op.y2);
                
                for (let y = y1; y <= y2; y++) {
                    for (let x = x1; x <= x2; x++) {
                        const gx = cx + x;
                        const gy = cy + y;
                        // North edge
                        fx.suppressedFades.add(1 + gx * 2 + gy * 4000);
                        // South edge
                        fx.suppressedFades.add(2 + gx * 2 + gy * 4000);
                        // East edge
                        fx.suppressedFades.add(4 + gx * 2 + gy * 4000);
                        // West edge
                        fx.suppressedFades.add(8 + gx * 2 + gy * 4000);
                    }
                }
            }
        }

        // --- Edge Rendering ---
        this.renderEdges(fx, ctx, colorLayerCtx, fx.animFrame, blocksX, blocksY, offX, offY);

        fx.lastMaskUpdateFrame = fx.animFrame;
    }

    renderEdges(fx, ctx, colorCtx, now, blocksX, blocksY, offX, offY) {
        const l = fx.layout;
        const grid = fx.renderGrid;
        if (!grid) return;

        const currentStep = fx.cyclesCompleted || 0;
        const perimeterColor = fx.getLineGfxValue('Color') || "#ffffff";
        const innerColor = fx.getInnerLineGfxValue('Color') || "#00FF00";
        
        const delay = fx.getEchoGfxValue('Delay') || 3;
        const showEcho = (fx.c.state.layerEnablePerimeterEcho !== false);

        // 1. Process Echos if enabled
        if (showEcho && fx.echoCtx) {
            this._renderEchoEdges(fx, fx.echoCtx, currentStep, delay, blocksX, blocksY, perimeterColor);
        }

        // 2. Build Path Batches for current frame
        this._edgeBatches.clear();
        this._edgeMaskBatches.clear();

        const getBatch = (map, color, opacity) => {
            const key = `${color}|${opacity.toFixed(3)}`;
            if (!map.has(key)) map.set(key, new Path2D());
            return map.get(key);
        };

        const outside = this.computeTrueOutside(fx, blocksX, blocksY);
        
        // --- EDGE SCAN ---
        for (let y = 0; y <= blocksY; y++) {
            for (let x = 0; x <= blocksX; x++) {
                // Vertical edge (West face of block x,y)
                if (x > 0 && x < blocksX && y < blocksY) {
                    const idxA = y * blocksX + (x - 1);
                    const idxB = y * blocksX + x;
                    const valA = grid[idxA];
                    const valB = grid[idxB];
                    if ((valA !== -1) !== (valB !== -1)) {
                        const isExterior = (valA === -1 && outside[idxA]) || (valB === -1 && outside[idxB]);
                        const birth = Math.max(valA, valB);
                        const age = now - birth;
                        const opacity = this._getEdgeOpacity(fx, age, isExterior);
                        if (opacity > 0.001) {
                            const color = isExterior ? perimeterColor : innerColor;
                            this._addFaceToPath(getBatch(this._edgeBatches, color, opacity), fx, x, y, 'W');
                        }
                    }
                }
                // Horizontal edge (North face of block x,y)
                if (y > 0 && y < blocksY && x < blocksX) {
                    const idxA = (y - 1) * blocksX + x;
                    const idxB = y * blocksX + x;
                    const valA = grid[idxA];
                    const valB = grid[idxB];
                    if ((valA !== -1) !== (valB !== -1)) {
                        const isExterior = (valA === -1 && outside[idxA]) || (valB === -1 && outside[idxB]);
                        const birth = Math.max(valA, valB);
                        const age = now - birth;
                        const opacity = this._getEdgeOpacity(fx, age, isExterior);
                        if (opacity > 0.001) {
                            const color = isExterior ? perimeterColor : innerColor;
                            this._addFaceToPath(getBatch(this._edgeBatches, color, opacity), fx, x, y, 'N');
                        }
                    }
                }
            }
        }

        // --- DRAW BATCHES ---
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        this._edgeBatches.forEach((path, key) => {
            const [color, opacity] = key.split('|');
            ctx.strokeStyle = color;
            ctx.globalAlpha = parseFloat(opacity);
            ctx.lineWidth = l.lineWidthX;
            ctx.stroke(path);
        });

        // 3. Distance Field for Glow
        if (fx.c.state.layerEnableQuantizedGlow !== false) {
            this.computeDistanceField(fx, blocksX, blocksY);
        }
    }

    _getEdgeOpacity(fx, age, isExterior) {
        if (age < 0) return 1.0; // Immediate appearance
        const duration = isExterior ? (fx.getLineGfxValue('Duration') || 15) : (fx.getInnerLineGfxValue('Duration') || 10);
        if (age >= duration) return 0;
        return 1.0 - (age / duration);
    }

    _addFaceToPath(path, fx, bx, by, face, isEcho = false) {
        const l = fx.layout;
        const px = l.screenOriginX + (bx * l.screenStepX);
        const py = l.screenOriginY + (by * l.screenStepY);
        
        if (face === 'W') {
            path.moveTo(px, py);
            path.lineTo(px, py + l.screenStepY);
        } else if (face === 'N') {
            path.moveTo(px, py);
            path.lineTo(px + l.screenStepX, py);
        }
    }

    _renderEchoEdges(fx, echoCtx, currentStep, delay, blocksX, blocksY, echoColor) {
        if (!fx.echoEdgeMap) fx.echoEdgeMap = new Map();
        
        const getVariance = (coord, axis) => {
            const seed = (axis === 'V') ? coord * 1.5 : coord * 2.3;
            return 0.4 + (Math.sin(seed + currentStep * 0.1) * 0.3);
        };

        // Every frame, check the "ghost" grids from the past
        if (fx.perimeterHistory && fx.perimeterHistory.length >= delay) {
            const echoGrid = fx.perimeterHistory[0]; // The oldest snapshot
            const echoOpacity = fx.getEchoGfxValue('Opacity') || 0.5;
            
            if (echoGrid) {
                const outside = this.computeTrueOutside(fx, blocksX, blocksY, echoGrid);

                // Refresh lastSeen for all edges currently in the live perimeter
                for (let y = 0; y <= blocksY; y++) {
                    for (let x = 0; x <= blocksX; x++) {
                        // Vertical edge (W face)
                        if (x > 0 && x < blocksX && y < blocksY) {
                            const idxA = y * blocksX + (x - 1);
                            const idxB = y * blocksX + x;
                            if ((echoGrid[idxA] !== -1) !== (echoGrid[idxB] !== -1)) {
                                if ((echoGrid[idxA] === -1 && outside[idxA]) || (echoGrid[idxB] === -1 && outside[idxB])) {
                                    fx.echoEdgeMap.set(`${x}|${y}|W`, { x, y, face: 'W', lastSeen: currentStep });
                                }
                            }
                        }
                        // Horizontal edge (N face)
                        if (y > 0 && y < blocksY && x < blocksX) {
                            const idxA = (y - 1) * blocksX + x;
                            const idxB = y * blocksX + x;
                            if ((echoGrid[idxA] !== -1) !== (echoGrid[idxB] !== -1)) {
                                if ((echoGrid[idxA] === -1 && outside[idxA]) || (echoGrid[idxB] === -1 && outside[idxB])) {
                                    fx.echoEdgeMap.set(`${x}|${y}|N`, { x, y, face: 'N', lastSeen: currentStep });
                                }
                            }
                        }
                    }
                }

                // Evict entries that have fully faded (older than hold + fade window)
                const maxAge = delay * 2;
                for (const [key, entry] of fx.echoEdgeMap) {
                    if (currentStep - entry.lastSeen > maxAge) fx.echoEdgeMap.delete(key);
                }
            }
        }

        if (!fx.echoEdgeMap || !fx.echoEdgeMap.size) return;

        // Build draw batches keyed by opacity so we can multi-pass for values > 1.0
        const echoBatches = new Map();
        for (const entry of fx.echoEdgeMap.values()) {
            const age = currentStep - entry.lastSeen;
            let ageOpacity;
            if (age <= delay) {
                ageOpacity = 1.0;                          // hold phase
            } else {
                ageOpacity = 1.0 - (age - delay) / delay; // fade phase
            }
            if (ageOpacity <= 0.001) continue;

            const variance = getVariance(entry.face === 'W' ? entry.x : entry.y, entry.face === 'W' ? 'V' : 'H');
            const finalOpacity = ageOpacity * variance * (fx.getEchoGfxValue('Opacity') || 0.5);
            
            const key = `${echoColor}|${finalOpacity.toFixed(3)}`;
            if (!echoBatches.has(key)) echoBatches.set(key, new Path2D());
            this._addFaceToPath(echoBatches.get(key), fx, entry.x, entry.y, entry.face, true);
        }

        echoCtx.save();
        const saturation = fx.getEchoGfxValue('Saturation') ?? 1.0;
        if (saturation !== 1.0) {
            echoCtx.filter = `saturate(${saturation * 100}%)`;
        }

        echoBatches.forEach((path, key) => {
            const [c, oStr] = key.split('|');
            echoCtx.strokeStyle = c;
            echoCtx.globalAlpha = parseFloat(oStr);
            echoCtx.lineWidth = fx.layout.echoLineWidthX;
            echoCtx.stroke(path);
        });
        echoCtx.restore();
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
        
        if (!gridOverride) {
            fx._outsideMapWidth = blocksX;
            fx._outsideMapHeight = blocksY;
            fx._outsideMapDirty = false;
        }

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