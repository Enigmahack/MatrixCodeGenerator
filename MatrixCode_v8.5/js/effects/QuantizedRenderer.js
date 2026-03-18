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

        // --- Edge Rendering (Deactivated — Using WebGL Path) ---
        // this.renderEdges(fx, ctx, colorLayerCtx, fx.animFrame, blocksX, blocksY, offX, offY);

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

    computeTrueOutside(fx, blocksX, blocksY, gridOverride = null) {
        if (!gridOverride && fx._outsideMap && fx._outsideMapWidth === blocksX && fx._outsideMapHeight === blocksY && !fx._outsideMapDirty) {
            return fx._outsideMap;
        }

        const size = blocksX * blocksY;
        this._ensureBfsQueueSize(size);

        if (!gridOverride && (!fx._outsideMap || fx._outsideMap.length !== size)) {
            fx._outsideMap = new Uint8Array(size);
        }

        // Pool the override status buffer to avoid per-call allocation
        let status;
        if (gridOverride) {
            if (!this._overrideStatusBuf || this._overrideStatusBuf.length !== size) {
                this._overrideStatusBuf = new Uint8Array(size);
            }
            status = this._overrideStatusBuf;
        } else {
            status = fx._outsideMap;
        }
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