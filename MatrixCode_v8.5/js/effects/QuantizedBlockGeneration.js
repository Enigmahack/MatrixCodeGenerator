class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
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

            if (!this.debugMode && this.timer >= durationFrames) {
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
                this.active = false;
                this.state = 'IDLE';
                this.g.clearAllOverrides();
            }
        }
        
        this._checkDirtiness();
    }

    _attemptGrowth() {
        this._initProceduralState(); 

        const enNudge = (this.getConfig('EnableNudge') === true);
        if (enNudge) {
            this._attemptNudgeGrowth();
            this._performHoleCleanup();
            return;
        }

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enSpine = getGenConfig('EnableSpine') === true;
        
        const pool = [];
        if (enSpine) pool.push(this._attemptSpineGrowth.bind(this));

        if (pool.length === 0) {
            super._attemptGrowth();
            return;
        }

        // Shuffle pool
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        let totalTarget = Math.random() < 0.5 ? 1 : 2;
        for (let i = 0; i < totalTarget; i++) {
            const behavior = pool[i % pool.length];
            behavior();
        }

        this._performHoleCleanup();
    }

    _attemptNudgeGrowth() {
        if (!this.logicGridW || !this.logicGridH) return;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const minLX = -cx, maxLX = this.logicGridW - 1 - cx;
        const minLY = -cy, maxLY = this.logicGridH - 1 - cy;

        // Select axis and execute nudge
        for (let attempt = 0; attempt < 40; attempt++) {
            const axis = Math.random() < 0.5 ? 'X' : 'Y';
            const size = Math.floor(Math.random() * 3) + 1;
            const targetLayer = Math.random() < 0.5 ? 0 : 1;
            const otherLayer = 1 - targetLayer;
            
            let x, y, w, h, dir, units;
            if (axis === 'X') {
                w = size; h = 1; x = Math.floor(Math.random() * (this.logicGridW - w + 1)) + minLX; y = 0;
                dir = Math.random() < 0.5 ? 'N' : 'S';
                units = w;
            } else {
                w = 1; h = size; x = 0; y = Math.floor(Math.random() * (this.logicGridH - h + 1)) + minLY;
                dir = Math.random() < 0.5 ? 'E' : 'W';
                units = h;
            }

            const laneEdges = { 
                0: Array(units).fill(null).map(() => ({ min: Infinity, max: -Infinity })),
                1: Array(units).fill(null).map(() => ({ min: Infinity, max: -Infinity }))
            };

            for (const b of this.activeBlocks) {
                const overlapStart = Math.max(axis === 'X' ? x : y, axis === 'X' ? b.x : b.y);
                const overlapEnd = Math.min((axis === 'X' ? x + w : y + h), (axis === 'X' ? b.x + b.w : b.y + b.h));
                if (overlapStart < overlapEnd) {
                    const m = laneEdges[b.layer];
                    for (let k = overlapStart; k < overlapEnd; k++) {
                        const idx = k - (axis === 'X' ? x : y);
                        const valMin = axis === 'X' ? b.y : b.x;
                        const valMax = axis === 'X' ? (b.y + b.h - 1) : (b.x + b.w - 1);
                        m[idx].min = Math.min(m[idx].min, valMin);
                        m[idx].max = Math.max(m[idx].max, valMax);
                    }
                }
            }

            // VALIDATION: Must have blocks in the target lane to nudge
            let laneHasTarget = false;
            for (let i = 0; i < units; i++) {
                if (laneEdges[targetLayer][i].min !== Infinity) {
                    laneHasTarget = true;
                    break;
                }
            }
            if (!laneHasTarget) continue;

            let pullOther = false;
            for (let i = 0; i < units; i++) {
                const t = laneEdges[targetLayer][i], o = laneEdges[otherLayer][i];
                if (o.min === Infinity) continue; // Nothing to pull in this column/row
                if (dir === 'N' || dir === 'W') {
                    if (t.min <= o.min - 2) pullOther = true;
                } else {
                    if (t.max >= o.max + 2) pullOther = true;
                }
                if (pullOther) break;
            }

            const minBound = (axis === 'X') ? minLY : minLX;
            const maxBound = (axis === 'X') ? maxLY : maxLX;
            let canNudge = true;
            const checkBound = (m, d) => {
                if (d === 'N' || d === 'W') return !m.some(e => e.min !== Infinity && e.min <= minBound);
                return !m.some(e => e.max !== -Infinity && e.max >= maxBound);
            };

            if (!checkBound(laneEdges[targetLayer], dir)) canNudge = false;
            if (canNudge && pullOther && !checkBound(laneEdges[otherLayer], dir)) canNudge = false;

            if (canNudge) {
                super._nudge(x, y, w, h, dir, targetLayer);
                if (pullOther) super._nudge(x, y, w, h, dir, otherLayer);
                return;
            }
        }
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