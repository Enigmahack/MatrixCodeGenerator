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
        this._echoBatches = new Map();
        this._edgeMaskBatches = new Map();
        this._cachedEdgeMaps = [];
        this._edgeCacheDirty = true;

        // Pooled coordinate arrays to replace Path2D
        this._coordPool = [];
        for (let i = 0; i < 20; i++) {
            this._coordPool.push(new Float32Array(65536)); // Pool of arrays for different styles
        }
        this._batchMeta = new Map(); // Store [array, count] per batch key

        // --- BFS Worker (offloads computeTrueOutside + computeDistanceField) ---
        this._bfsWorker = null;
        this._bfsRequestId = 0;
        this._bfsPending = false;
        // Cached async results — used while a new computation is in flight
        this._asyncOutsideMap = null;
        this._asyncDistMap = null;
        this._asyncBlocksX = 0;
        this._asyncBlocksY = 0;
        this._initBFSWorker();

        QuantizedRenderer.instance = this;
    }

    /**
     * Initialise the BFS worker.  Falls back to synchronous computation
     * if workers are unavailable (e.g. file:// protocol, worker script 404).
     */
    _initBFSWorker() {
        try {
            // Determine the correct relative path from the page to the worker script.
            // The page may be served from a parent directory, so we resolve relative
            // to the current script's location when possible.
            let workerUrl = 'js/effects/QuantizedBFSWorker.js';
            // If running inside a worker ourselves (QuantizedWorker), skip.
            if (typeof document === 'undefined') return;

            this._bfsWorker = new Worker(workerUrl);
            this._bfsWorker.onmessage = (e) => this._onBFSResult(e.data);
            this._bfsWorker.onerror = (err) => {
                console.warn('[QuantizedRenderer] BFS Worker failed, falling back to sync.', err);
                this._bfsWorker = null;
            };
        } catch (ex) {
            // Workers not available — fall back to synchronous path
            this._bfsWorker = null;
        }
    }

    /**
     * Dispatch a BFS computation to the worker thread.
     * While the result is in flight, renderEdges() uses the last cached
     * outsideMap/distMap so rendering is never blocked.
     */
    dispatchBFS(fx) {
        if (!this._bfsWorker || this._bfsPending) return;
        if (!fx.renderGrid || !fx.logicGridW || !fx.logicGridH) return;

        const blocksX = fx.logicGridW;
        const blocksY = fx.logicGridH;
        const size = blocksX * blocksY;

        // Copy renderGrid so we can transfer ownership without losing main-thread data
        const gridCopy = new Int32Array(size);
        gridCopy.set(fx.renderGrid.subarray(0, size));

        this._bfsPending = true;
        this._bfsRequestId++;
        this._bfsWorker.postMessage({
            type: 'compute',
            id: this._bfsRequestId,
            blocksX,
            blocksY,
            renderGrid: gridCopy.buffer
        }, [gridCopy.buffer]);
    }

    /** Handle results coming back from the BFS worker. */
    _onBFSResult(msg) {
        if (msg.type !== 'result') return;
        this._bfsPending = false;
        this._asyncOutsideMap = new Uint8Array(msg.outsideMap);
        this._asyncDistMap = new Uint16Array(msg.distMap);
        this._asyncBlocksX = msg.blocksX;
        this._asyncBlocksY = msg.blocksY;
        // Returned renderGrid buffer is discarded (we still hold the original)
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

        // Reuse existing layout object to avoid per-frame allocation/GC
        if (!fx.layout) {
            fx.layout = {
                screenStepX: 0, screenStepY: 0,
                lineWidthX: 0, lineWidthY: 0,
                halfLineX: 0, halfLineY: 0,
                echoLineWidthX: 0, echoLineWidthY: 0,
                echoHalfLineX: 0, echoHalfLineY: 0,
                screenOriginX: 0, screenOriginY: 0,
                gridPixW: 0, gridPixH: 0,
                cellPitchX: 0, cellPitchY: 0,
                userBlockOffX: 0, userBlockOffY: 0,
                pixelOffX: 0, pixelOffY: 0
            };
        }
        const l = fx.layout;
        l.screenStepX = screenStepX; l.screenStepY = screenStepY;
        l.lineWidthX = lineWidthX; l.lineWidthY = lineWidthY;
        l.halfLineX = halfLineX; l.halfLineY = halfLineY;
        l.echoLineWidthX = echoLineWidthX; l.echoLineWidthY = echoLineWidthY;
        l.echoHalfLineX = echoHalfLineX; l.echoHalfLineY = echoHalfLineY;
        l.screenOriginX = screenOriginX; l.screenOriginY = screenOriginY;
        l.gridPixW = gridPixW; l.gridPixH = gridPixH;
        l.cellPitchX = cellPitchX; l.cellPitchY = cellPitchY;
        l.userBlockOffX = 0; l.userBlockOffY = 0;
        l.pixelOffX = 0; l.pixelOffY = 0;

        const blocksX = fx.logicGridW;
        const blocksY = fx.logicGridH;
        const { offX, offY } = fx._computeCenteredOffset(blocksX, blocksY, cellPitchX, cellPitchY);
        fx.layout.offX = offX;
        fx.layout.offY = offY;

        const snapThreshX = screenStepX * 1.0;
        const snapThreshY = screenStepY * 1.0;
        if (!fx._snapSettings) fx._snapSettings = { w: 0, h: 0, tx: 0, ty: 0 };
        fx._snapSettings.w = w; fx._snapSettings.h = h;
        fx._snapSettings.tx = snapThreshX; fx._snapSettings.ty = snapThreshY;

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

    /**
     * Lightweight layout computation for WebGL mode — populates fx.layout
     * without running BFS, edge scanning, or canvas drawing. This is all
     * that _renderQuantizedLineGfx / getWebGLRenderState need.
     */
    _computeLayoutOnly(fx, w, h, s, d) {
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const gridPixW = fx.g.cols * d.cellWidth;
        const gridPixH = fx.g.rows * d.cellHeight;
        const bs = fx.getBlockSize();
        const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        if (!fx.layout) {
            fx.layout = {
                screenStepX: 0, screenStepY: 0,
                lineWidthX: 0, lineWidthY: 0,
                halfLineX: 0, halfLineY: 0,
                echoLineWidthX: 0, echoLineWidthY: 0,
                echoHalfLineX: 0, echoHalfLineY: 0,
                screenOriginX: 0, screenOriginY: 0,
                gridPixW: 0, gridPixH: 0,
                cellPitchX: 0, cellPitchY: 0,
                userBlockOffX: 0, userBlockOffY: 0,
                pixelOffX: 0, pixelOffY: 0
            };
        }
        const l = fx.layout;
        l.screenStepX = screenStepX; l.screenStepY = screenStepY;
        l.screenOriginX = screenOriginX; l.screenOriginY = screenOriginY;
        l.gridPixW = gridPixW; l.gridPixH = gridPixH;
        l.cellPitchX = cellPitchX; l.cellPitchY = cellPitchY;

        const blocksX = fx.logicGridW;
        const blocksY = fx.logicGridH;
        const { offX, offY } = fx._computeCenteredOffset(blocksX, blocksY, cellPitchX, cellPitchY);
        l.offX = offX;
        l.offY = offY;
    }

    rebuildEdgeCache(fx, blocksX, blocksY) {
        this._edgeCacheDirty = true;
        this._cachedEdgeMaps.length = 0;
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

        // 2. Build Coordinate Batches for current frame
        this._batchMeta.clear();
        let poolIdx = 0;

        const getBatch = (key) => {
            if (!this._batchMeta.has(key)) {
                let arr = this._coordPool[poolIdx++];
                if (!arr) {
                    arr = new Float32Array(65536);
                    this._coordPool.push(arr);
                }
                this._batchMeta.set(key, { arr, count: 0 });
            }
            return this._batchMeta.get(key);
        };

        const addEdge = (key, x1, y1, x2, y2) => {
            const batch = getBatch(key);
            if (batch.count + 4 > batch.arr.length) {
                const newArr = new Float32Array(batch.arr.length * 2);
                newArr.set(batch.arr);
                batch.arr = newArr;
                // Update pool if it was a pooled array
                const pIdx = this._coordPool.indexOf(batch.arr);
                if (pIdx !== -1) this._coordPool[pIdx] = newArr;
            }
            const a = batch.arr;
            const c = batch.count;
            a[c] = x1; a[c+1] = y1; a[c+2] = x2; a[c+3] = y2;
            batch.count += 4;
        };

        // --- ASYNC BFS: use worker results when available, else fall back to sync ---
        let outside;
        if (this._bfsWorker && this._asyncOutsideMap &&
            this._asyncBlocksX === blocksX && this._asyncBlocksY === blocksY) {
            // Use the latest worker result (may be 1-2 frames behind — visually fine)
            outside = this._asyncOutsideMap;
        } else {
            // First frame or worker not ready — compute synchronously once
            outside = this.computeTrueOutside(fx, blocksX, blocksY);
        }
        // Dispatch a fresh BFS for the NEXT frame (non-blocking)
        if (fx._outsideMapDirty || this._distMapDirty) {
            this.dispatchBFS(fx);
        }

        // --- EDGE SCAN ---
        for (let y = 0; y <= blocksY; y++) {
            const py = l.screenOriginY + (y * l.screenStepY);
            const pyNext = py + l.screenStepY;
            
            for (let x = 0; x <= blocksX; x++) {
                const px = l.screenOriginX + (x * l.screenStepX);
                const pxNext = px + l.screenStepX;

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
                            const key = `${color}|${opacity.toFixed(3)}`;
                            addEdge(key, px, py, px, pyNext);
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
                            const key = `${color}|${opacity.toFixed(3)}`;
                            addEdge(key, px, py, pxNext, py);
                        }
                    }
                }
            }
        }

        // --- DRAW BATCHES ---

        // 3. Distance Field for Glow — prefer async worker result
        if (fx.c.state.layerEnableQuantizedGlow !== false) {
            if (this._bfsWorker && this._asyncDistMap &&
                this._asyncBlocksX === blocksX && this._asyncBlocksY === blocksY) {
                // Use worker-computed distance field
                this._distMap = this._asyncDistMap;
                this._distMapWidth = blocksX;
                this._distMapHeight = blocksY;
                this._distMapDirty = false;
            } else {
                this.computeDistanceField(fx, blocksX, blocksY);
            }
        }
    }

    _getEdgeOpacity(fx, age, isExterior) {
        if (age < 0) return 1.0; // Immediate appearance
        const duration = isExterior ? (fx.getLineGfxValue('Persistence') ?? 15) : (fx.getInnerLineGfxValue('Persistence') ?? 10);
        if (duration === 0) return 0.0; // Off
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

        // Build coordinate batches
        const echoBatches = new Map();
        const l = fx.layout;

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
            if (!echoBatches.has(key)) echoBatches.set(key, []);
            
            const px = l.screenOriginX + (entry.x * l.screenStepX);
            const py = l.screenOriginY + (entry.y * l.screenStepY);
            if (entry.face === 'W') {
                echoBatches.get(key).push(px, py, px, py + l.screenStepY);
            } else {
                echoBatches.get(key).push(px, py, px + l.screenStepX, py);
            }
        }
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