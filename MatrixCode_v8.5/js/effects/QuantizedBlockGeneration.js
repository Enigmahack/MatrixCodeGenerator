class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 1.5; // Allow expansion 50% past screen edges to prevent border stalls
    }

    _initShadowWorld() {
        this._initShadowWorldBase(false);
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        
        const cols = this.shadowGrid.cols;
        const rows = this.shadowGrid.rows;
        const targetStreamCount = Math.floor(cols * 0.5); 
        
        const totalSpawns = (s.streamSpawnCount || 0) + (s.eraserSpawnCount || 0);
        const eraserChance = totalSpawns > 0 ? (s.eraserSpawnCount / totalSpawns) : 0;

        const columns = Array.from({length: cols}, (_, i) => i);
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }

        let spawned = 0;
        let colIdx = 0;
        const maxAttempts = targetStreamCount * 3; 
        let attempts = 0;

        while (spawned < targetStreamCount && attempts < maxAttempts) {
            attempts++;
            const col = columns[colIdx % columns.length];
            colIdx++;
            
            const isEraser = Math.random() < eraserChance;
            const stream = sm._initializeStream(col, isEraser, s);
            
            const totalSteps = stream.visibleLen;
            const fallSteps = rows;
            const currentAge = Math.floor(Math.random() * totalSteps);
            
            if (currentAge < fallSteps) {
                stream.y = currentAge;
                stream.age = currentAge;
            } else {
                stream.y = rows + 1; 
                stream.age = currentAge;
                
                if (!stream.isEraser) {
                    const eraserAge = currentAge - fallSteps;
                    if (eraserAge > 0) {
                        const eraser = sm._initializeStream(col, true, s);
                        eraser.y = Math.min(eraserAge, rows + 5);
                        eraser.age = eraserAge;
                        eraser.tickInterval = stream.tickInterval; 
                        sm.addActiveStream(eraser);
                    }
                }
            }
            
            stream.visibleLen += Math.floor(Math.random() * 300);
            
            if (stream.age < stream.visibleLen) {
                sm.addActiveStream(stream);
                spawned++;
            }
        }
    
        const warmupFrames = 60; 
        this.warmupRemaining = warmupFrames;
        this.shadowSimFrame = 0;
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        if (!super.trigger(force)) return false;

        this._log("QuantizedBlockGenerator: Triggered");
        this.timer = 0;
        this.genTimer = 0;
        this.animFrame = 0;
        this.expansionPhase = 0;
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.alpha = 1.0;
        this.state = 'GENERATING';
        
        // Custom state for startup sequence
        this.usedCardinalIndices = [];
        this.nudgeAxisBalance = 0; // Negative = more X, Positive = more Y

        this._initShadowWorld(); 
        
        const bs = this.getBlockSize();
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);

        this._initProceduralState();
        return true;
    }

    _initProceduralState() {
        super._initProceduralState();
        const total = this.logicGridW * this.logicGridH;
        if (!this._sharedGrid || this._sharedGrid.length !== total) {
            this._sharedGrid = new Uint8Array(total);
            this._sharedVisited = new Uint8Array(total);
        }
    }

    update() {
        if (!this.active) return;

        // 0. Update Shadow Simulation & Warmup
        if (!this.hasSwapped && !this.isSwapping) {
            if (super._updateShadowSim()) return;
        } else if (this.isSwapping) {
            super.updateTransition(false);
        }

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;
        this.timer++;

        // Perform cleanup of expired ops
        const fadeOutFrames = this.getConfig('FadeFrames') || 0;
        if (this.maskOps.length > 0) {
             const oldLen = this.maskOps.length;
             this.maskOps = this.maskOps.filter(op => {
                 if (op.expireFrame && this.animFrame >= op.expireFrame + fadeOutFrames) return false;
                 return true;
             });
             if (this.maskOps.length !== oldLen) {
                 this._lastProcessedOpIndex = 0; 
             }
        }

        const durationFrames = (s.quantizedGenerateV2DurationSeconds || 5) * fps;
        
        if (this.state === 'GENERATING') {
            const baseDuration = Math.max(1, this.c.derived.cycleDuration);
            const userSpeed = (s.quantizedGenerateV2Speed !== undefined) ? s.quantizedGenerateV2Speed : 5;
            const delayMult = 11 - userSpeed;
            
            const enNudge = (this.getConfig('EnableNudge') === true);
            const intervalMult = enNudge ? 0.15 : 0.25; 
            const interval = Math.max(1, baseDuration * (delayMult * intervalMult));
            
            if (!this.debugMode) {
                this.genTimer++;
                if (this.genTimer >= interval) {
                    this.genTimer = 0;
                    this._attemptGrowth();
                    this.expansionPhase++;
                }
            }
            
            this._updateRenderGridLogic();

            const isCovered = this._isCanvasFullyCovered();
            const timedOut = this.timer >= durationFrames;

            if (!this.debugMode && (timedOut || isCovered)) {
                this._log(`QuantizedBlockGenerator: Ending generation. Reason: ${isCovered ? 'FULL COVERAGE' : 'TIMEOUT (' + (this.timer/fps).toFixed(1) + 's)'}`);
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            const fadeFrames = s.quantizedGenerateV2FadeFrames || 60;
            this.alpha = Math.max(0, 1.0 - (this.timer / fadeFrames));
            if (this.timer >= fadeFrames) {
                this._log("QuantizedBlockGenerator: Effect complete.");
                this.active = false;
                this.state = 'IDLE';
                this.g.clearAllOverrides();
            }
        }
        
        this._checkDirtiness();
    }

    _attemptGrowth() {
        this._initProceduralState(); 

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enSpine = getGenConfig('EnableSpine') === true;
        const enNudge = getGenConfig('EnableNudge') === true;
        
        const pool = [];
        if (enSpine) pool.push(this._attemptSpineGrowth.bind(this));
        if (enNudge) pool.push(this._attemptNudgeGrowth.bind(this));

        if (pool.length === 0) {
            super._attemptGrowth();
            return;
        }

        // Optimized growth loop: attempt behaviors until success or quota met
        let success = false;
        const maxRetries = 5; 
        for (let r = 0; r < maxRetries; r++) {
            // Reset spine direction frame to allow re-selection per retry if stalled
            this._currentStepDirectionFrame = -1;

            // Shuffle pool
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }

            let totalTarget = Math.random() < 0.5 ? 1 : 2;
            for (let i = 0; i < totalTarget; i++) {
                const behavior = pool[i % pool.length];
                if (behavior()) {
                    success = true;
                }
            }
            if (success) break;
        }

        // Emergency "Force Fill" if primary behaviors stalled but canvas isn't covered
        if (!success) {
            if (this._attemptForceFill()) {
                success = true;
            }
        }

        if (!success && !this._isCanvasFullyCovered()) {
            this._warn("QuantizedBlockGenerator: Growth stalled - no safe move found for either layer.");
        }

        this._performHoleCleanup();

        // Final Logic Grid Sync
        const w = this.logicGridW, h = this.logicGridH;
        this.logicGrid.fill(0);
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (const b of this.activeBlocks) {
            const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
            const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
            for (let gy = y1; gy <= y2; gy++) {
                const rowOff = gy * w;
                for (let gx = x1; gx <= x2; gx++) this.logicGrid[rowOff + gx] = 1;
            }
        }
    }

    _attemptForceFill() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        // Find empty spots in Layer 0 or Layer 1
        for (let l = 0; l <= 1; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            
            // Try to find a cell that's empty but has a neighbor
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    const idx = gy * w + gx;
                    if (grid[idx] === -1) {
                        const hasNeighbor = 
                            (gx > 0 && grid[idx - 1] !== -1) ||
                            (gx < w - 1 && grid[idx + 1] !== -1) ||
                            (gy > 0 && grid[idx - w] !== -1) ||
                            (gy < h - 1 && grid[idx + w] !== -1);
                        
                        if (hasNeighbor) {
                            const bx = gx - cx, by = gy - cy;
                            if (this._validateAdditionSafety(bx, by, l)) {
                                this._spawnBlock(bx, by, 1, 1, l, true, false, 0, true, true);
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    _validateAdditionSafety(bx, by, layer) {
        const nextBlocks = this.activeBlocks.map(b => ({...b}));
        nextBlocks.push({ x: bx, y: by, w: 1, h: 1, layer });
        return this._checkEnvelopeDrift(nextBlocks);
    }

    _isCanvasFullyCovered() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        
        const bs = this.getBlockSize();
        // Compute the visible logic boundaries relative to the oversized logic grid
        const { offX, offY } = this._computeCenteredOffset(w, h, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);

        for (let l = 0; l <= 1; l++) {
            const grid = this.layerGrids[l];
            if (!grid) return false;
            for (let gy = startY; gy < endY; gy++) {
                const rowOff = gy * w;
                for (let gx = startX; gx < endX; gx++) {
                    if (grid[rowOff + gx] === -1) return false;
                }
            }
        }
        return true;
    }

    _attemptNudgeGrowth() {
        if (!this.logicGridW || !this.logicGridH) return false;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const minLX = -cx, maxLX = this.logicGridW - 1 - cx;
        const minLY = -cy, maxLY = this.logicGridH - 1 - cy;

        const bs = this.getBlockSize();
        const { offX, offY } = this._computeCenteredOffset(this.logicGridW, this.logicGridH, bs.w, bs.h);
        const visibleW = Math.ceil(this.g.cols / bs.w);
        const visibleH = Math.ceil(this.g.rows / bs.h);
        const pStatus = this._getPerimeterStatus(offX, offY, visibleW, visibleH);

        // Optimization: Pre-allocate lane bounds to avoid object creation in loop
        if (!this._laneMin0 || this._laneMin0.length < 8) {
            this._laneMin0 = new Float32Array(8); this._laneMax0 = new Float32Array(8);
            this._laneMin1 = new Float32Array(8); this._laneMax1 = new Float32Array(8);
        }

        for (let attempt = 0; attempt < 50; attempt++) {
            const axis = Math.random() < 0.5 ? 'X' : 'Y';
            const size = Math.floor(Math.random() * 3) + 1;
            const targetLayer = Math.random() < 0.5 ? 0 : 1;
            const otherLayer = 1 - targetLayer;
            
            let x, y, w, h, dir, units;
            if (axis === 'X') {
                w = size; h = 1;
                x = this._getBiasedCoordinate(minLX, maxLX, w, pStatus, 'X');
                y = 0;
                dir = Math.random() < 0.5 ? 'N' : 'S'; units = w;
            } else {
                w = 1; h = size;
                x = 0;
                y = this._getBiasedCoordinate(minLY, maxLY, h, pStatus, 'Y');
                dir = Math.random() < 0.5 ? 'E' : 'W'; units = h;
            }

            this._laneMin0.fill(Infinity); this._laneMax0.fill(-Infinity);
            this._laneMin1.fill(Infinity); this._laneMax1.fill(-Infinity);

            for (let i = 0; i < this.activeBlocks.length; i++) {
                const b = this.activeBlocks[i];
                const overlapStart = Math.max(axis === 'X' ? x : y, axis === 'X' ? b.x : b.y);
                const overlapEnd = Math.min((axis === 'X' ? x + w : y + h), (axis === 'X' ? b.x + b.w : b.y + b.h));
                if (overlapStart < overlapEnd) {
                    const lMin = b.layer === 0 ? this._laneMin0 : this._laneMin1;
                    const lMax = b.layer === 0 ? this._laneMax0 : this._laneMax1;
                    for (let k = overlapStart; k < overlapEnd; k++) {
                        const idx = k - (axis === 'X' ? x : y);
                        const valMin = axis === 'X' ? b.y : b.x;
                        const valMax = axis === 'X' ? (b.y + b.h - 1) : (b.x + b.w - 1);
                        lMin[idx] = Math.min(lMin[idx], valMin);
                        lMax[idx] = Math.max(lMax[idx], valMax);
                    }
                }
            }

            const checkLane = (layer) => {
                const minArr = layer === 0 ? this._laneMin0 : this._laneMin1;
                for (let i = 0; i < units; i++) if (minArr[i] !== Infinity) return true;
                return false;
            };
            if (!checkLane(targetLayer)) continue;

            const tLaneMin = targetLayer === 0 ? this._laneMin0 : this._laneMin1;
            const tLaneMax = targetLayer === 0 ? this._laneMax0 : this._laneMax1;
            const oLaneMin = otherLayer === 0 ? this._laneMin0 : this._laneMin1;
            const oLaneMax = otherLayer === 0 ? this._laneMax0 : this._laneMax1;

            let pullOther = false;
            for (let i = 0; i < units; i++) {
                const tm = tLaneMin[i];
                const om = oLaneMin[i];
                const oM = oLaneMax[i];
                if (om === Infinity) continue;
                if (dir === 'N' || dir === 'W') { if (tm <= om - 2) pullOther = true; }
                else { 
                    const tM = tLaneMax[i];
                    if (tM >= oM + 2) pullOther = true; 
                }
                if (pullOther) break;
            }

            const minBound = (axis === 'X') ? minLY : minLX;
            const maxBound = (axis === 'X') ? maxLY : maxLX;

            const checkBound = (mMin, mMax, d) => {
                if (d === 'N' || d === 'W') {
                    for (let i = 0; i < units; i++) if (mMin[i] !== Infinity && mMin[i] <= minBound) return false;
                } else {
                    for (let i = 0; i < units; i++) if (mMax[i] !== -Infinity && mMax[i] >= maxBound) return false;
                }
                return true;
            };

            let canNudge = checkBound(tLaneMin, tLaneMax, dir);
            if (canNudge && pullOther && !checkBound(oLaneMin, oLaneMax, dir)) canNudge = false;

            if (canNudge) {
                super._nudge(x, y, w, h, dir, targetLayer);
                if (pullOther) super._nudge(x, y, w, h, dir, otherLayer);
                return true;
            }
        }
        return false;
    }

    _getBiasedCoordinate(minL, maxL, size, pStatus, axis) {
        // Priority: within 2 blocks of center if perimeter not reached
        const centerReached = (axis === 'X') ? (pStatus.E && pStatus.W) : (pStatus.N && pStatus.S);
        
        if (!centerReached && Math.random() < 0.8) {
            const range = 2;
            const low = Math.max(minL, -range);
            const high = Math.min(maxL - size, range);
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }
        
        // Perimeter reached or 20% random: pick anywhere
        return Math.floor(Math.random() * (maxL - size - minL + 1)) + minL;
    }

    _getPerimeterStatus(offX, offY, visibleW, visibleH) {
        const w = this.logicGridW, h = this.logicGridH;
        const startX = Math.max(0, Math.floor(offX));
        const endX = Math.min(w, startX + visibleW);
        const startY = Math.max(0, Math.floor(offY));
        const endY = Math.min(h, startY + visibleH);

        const status = { N: true, S: true, E: true, W: true };
        
        const check = (layer) => {
            const grid = this.layerGrids[layer];
            if (!grid) return;
            // North perimeter (top row of visible)
            for (let x = startX; x < endX; x++) if (grid[startY * w + x] === -1) status.N = false;
            // South perimeter (bottom row of visible)
            const lastY = endY - 1;
            for (let x = startX; x < endX; x++) if (grid[lastY * w + x] === -1) status.S = false;
            // West perimeter (left col of visible)
            for (let y = startY; y < endY; y++) if (grid[y * w + startX] === -1) status.W = false;
            // East perimeter (right col of visible)
            const lastX = endX - 1;
            for (let y = startY; y < endY; y++) if (grid[y * w + lastX] === -1) status.E = false;
        };

        check(0); check(1);
        return status;
    }

    _validateNudgeSafety(x, y, w, h, face, targetLayer, pullOther) {
        if (!this.activeBlocks || this.activeBlocks.length === 0) return true;
        const nextBlocks = this.activeBlocks.map(b => ({...b}));
        const uf = face.toUpperCase();
        const axis = (uf === 'N' || uf === 'S') ? 'Y' : 'X';
        const dSign = (uf === 'N' || uf === 'W') ? -1 : 1;
        const shiftAmt = (axis === 'X' ? w : h);

        const apply = (l) => {
            for (let i = 0; i < nextBlocks.length; i++) {
                const b = nextBlocks[i];
                if (b.layer !== l) continue;
                let move = false;
                if (axis === 'X') { if (b.y >= y && b.y < y + h && ((dSign > 0 && b.x >= x) || (dSign < 0 && b.x <= x + w - 1))) move = true; }
                else { if (b.x >= x && b.x < x + w && ((dSign > 0 && b.y >= y) || (dSign < 0 && b.y <= y + h - 1))) move = true; }
                if (move) { if (axis === 'X') b.x += (dSign * shiftAmt); else b.y += (dSign * shiftAmt); }
            }
            nextBlocks.push({ x, y, w, h, layer: l });
        };

        apply(targetLayer);
        if (pullOther) apply(1 - targetLayer);

        return this._checkEnvelopeDrift(nextBlocks);
    }

    _checkEnvelopeDrift(blocks) {
        const lgW = this.logicGridW, lgH = this.logicGridH;
        const cx = Math.floor(lgW / 2), cy = Math.floor(lgH / 2);
        const colMin0 = new Int32Array(lgW).fill(10000), colMax0 = new Int32Array(lgW).fill(-10000);
        const colMin1 = new Int32Array(lgW).fill(10000), colMax1 = new Int32Array(lgW).fill(-10000);
        const rowMin0 = new Int32Array(lgH).fill(10000), rowMax0 = new Int32Array(lgH).fill(-10000);
        const rowMin1 = new Int32Array(lgH).fill(10000), rowMax1 = new Int32Array(lgH).fill(-10000);

        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const bx1 = cx + b.x, by1 = cy + b.y, bx2 = bx1 + b.w - 1, by2 = by1 + b.h - 1;
            const targetMinCol = b.layer === 0 ? colMin0 : colMin1, targetMaxCol = b.layer === 0 ? colMax0 : colMax1;
            const targetMinRow = b.layer === 0 ? rowMin0 : rowMin1, targetMaxRow = b.layer === 0 ? rowMax0 : rowMax1;
            for (let x = Math.max(0, bx1); x <= Math.min(lgW - 1, bx2); x++) { targetMinCol[x] = Math.min(targetMinCol[x], by1); targetMaxCol[x] = Math.max(targetMaxCol[x], by2); }
            for (let y = Math.max(0, by1); y <= Math.min(lgH - 1, by2); y++) { targetMinRow[y] = Math.min(targetMinRow[y], bx1); targetMaxRow[y] = Math.max(targetMaxRow[y], bx2); }
        }
        for (let x = 0; x < lgW; x++) if (colMin0[x] !== 10000 && colMin1[x] !== 10000) if (Math.abs(colMin0[x] - colMin1[x]) > 3 || Math.abs(colMax0[x] - colMax1[x]) > 3) return false;
        for (let y = 0; y < lgH; y++) if (rowMin0[y] !== 10000 && rowMin1[y] !== 10000) if (Math.abs(rowMin0[y] - rowMin1[y]) > 3 || Math.abs(rowMax0[y] - rowMax1[y]) > 3) return false;
        return true;
    }

    _mergeLayer1(maxCycle = -1) {
        const now = this.animFrame;
        const blocksToMerge = this.activeBlocks.filter(b => 
            b.layer === 1 && (maxCycle === -1 || b.spawnCycle === undefined || b.spawnCycle <= maxCycle)
        );
        
        if (blocksToMerge.length === 0) return;

        for (const b of blocksToMerge) {
            this.maskOps.push({ 
                type: 'removeBlock', 
                x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, 
                startFrame: now, layer: 1, fade: false 
            });
            this.maskOps.push({ 
                type: 'add', 
                x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, 
                startFrame: now, layer: 0, blockId: b.id 
            });
            
            b.layer = 0;
            this._writeToGrid(b.x, b.y, b.w, b.h, now, 0); 
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);  
        }

        this._lastProcessedOpIndex = 0;
        this._maskDirty = true;
    }

    _checkNoOverlap(x, y, w, h) {
        for (const b of this.activeBlocks) {
            const ix = Math.max(x, b.x);
            const iy = Math.max(y, b.y);
            const iw = Math.min(x + w, b.x + b.w) - ix;
            const ih = Math.min(y + h, b.y + b.h) - iy;
            if (iw > 0 && ih > 0) return false;
        }
        const bs = this.getBlockSize();
        const xLimit = (this.g.cols / bs.w / 2) + 5;
        const yLimit = (this.g.rows / bs.h / 2) + 5;
        if (x + w < -xLimit || x > xLimit || y + h < -yLimit || y > yLimit) return false;
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        if (x + cx < 0 || x + cx + w > this.logicGridW || y + cy < 0 || y + cy + h > this.logicGridH) return false;
        return true;
    }

    _checkNoHole(tx, ty, tw, th) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const candidates = [];
        for (let x = tx - 1; x <= tx + tw; x++) { candidates.push([x, ty - 1], [x, ty + th]); }
        for (let y = ty; y < ty + th; y++) { candidates.push([tx - 1, y], [tx + tw, y]); }
        for (const [nx, ny] of candidates) {
            const gx = nx + cx, gy = ny + cy;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
            if (this.logicGrid[gy * w + gx] !== 0) continue;
            if (nx >= tx && nx < tx + tw && ny >= ty && ny < ty + th) continue;
            if (!this._canReachBoundary(nx, ny, tx, ty, tw, th)) return false;
        }
        return true;
    }

    _canReachBoundary(startX, startY, px, py, pw, ph) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const stack = [[startX, startY]], visited = new Set([`${startX},${startY}`]);
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            if (x + cx <= 0 || x + cx >= w - 1 || y + cy <= 0 || y + cy >= h - 1) return true;
            const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
            for (const [nx, ny] of neighbors) {
                const gx = nx + cx, gy = ny + cy;
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                const key = `${nx},${ny}`;
                if (visited.has(key) || (nx >= px && nx < px + pw && ny >= py && ny < py + ph) || this.logicGrid[gy * w + gx] !== 0) continue;
                visited.add(key); stack.push([nx, ny]);
                if (visited.size > 2000) return true; 
            }
        }
        return false;
    }
}