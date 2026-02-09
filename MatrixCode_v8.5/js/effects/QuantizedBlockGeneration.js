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
        
        // Init Shadow World (Invisible background sim)
        this._initShadowWorld(); 
        
        // Manually set _last dimensions to ensure updateShadowSim runs correctly on frame 0
        const bs = this.getBlockSize();
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);

        // Seed Procedural State
        this._initProceduralState();
        
        return true;
    }

    _updateLocalLogicGrid(tx, ty, tw, th, val) {
        if (!this.logicGrid) return;
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        for (let y = ty; y < ty + th; y++) {
            for (let x = tx; x < tx + tw; x++) {
                const gx = cx + x;
                const gy = cy + y;
                if (gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH) {
                    this.logicGrid[gy * this.logicGridW + gx] = val;
                }
            }
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
            // Map 1 (Slowest) -> 10 (Fastest) to internal delayMult 10 -> 1
            const delayMult = 11 - userSpeed;
            const interval = baseDuration * (delayMult / 4.0);
            
            this.genTimer++;
            if (this.genTimer >= interval) {
                if (!this.debugMode || this.manualStep) {
                    this.genTimer = 0;
                    this.expansionPhase++;
                    
                    if (this.expansionPhase >= 1000) {
                        if (!this.hasSwapped && !this.isSwapping) {
                            this.state = 'FADE_OUT';
                            this.timer = 0;
                            this._swapStates();
                        }
                    } else {
                        this._attemptGrowth();
                    }
                    this.manualStep = false;
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
        const mode = this.getConfig('Mode') || 'default';

        // 1. Check for seed block if empty (required for most modes)
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        if (this.logicGrid[cy * this.logicGridW + cx] === 0) {
             this._spawnBlock(0, 0, 1, 1, 0);
             this._updateLocalLogicGrid(0, 0, 1, 1, 1);
             if (mode !== 'default') return; 
        }

        // 2. Route to specific behavior
        switch (mode) {
            case 'unfold':
                this._attemptUnfoldPerimeterGrowth();
                break;
            case 'cyclic':
                this._attemptCyclicGrowth();
                break;
            case 'spine':
                this._attemptSpineGrowth();
                break;
            case 'crawler':
                this._attemptCrawlerGrowth();
                break;
            case 'shift':
                this._attemptShiftGrowth();
                break;
            case 'cluster':
                this._attemptClusterGrowth();
                break;
            case 'overlap':
                this._attemptLayerOverlap();
                break;
            case 'unfold_legacy':
                this._attemptUnfoldGrowth();
                break;
            default:
                super._attemptGrowth(); 
                break;
        }

        // 3. Post-growth cleanup
        this._performHoleCleanup();
    }

    _getFrontier() {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const frontier = [];
        
        const bs = this.getBlockSize();
        const visibleBlocksW = this.g.cols / bs.w;
        const visibleBlocksH = this.g.rows / bs.h;
        const buffer = 5;
        const xLimit = (visibleBlocksW / 2) + buffer;
        const yLimit = (visibleBlocksH / 2) + buffer;

        for (let gy = 1; gy < h - 1; gy++) {
            const ty = gy - cy;
            if (ty < -yLimit || ty > yLimit) continue;
            
            for (let gx = 1; gx < w - 1; gx++) {
                const tx = gx - cx;
                if (tx < -xLimit || tx > xLimit) continue;

                if (this.logicGrid[gy * w + gx] === 0) {
                    const n = this.logicGrid[(gy - 1) * w + gx] === 1;
                    const s = this.logicGrid[(gy + 1) * w + gx] === 1;
                    const e = this.logicGrid[gy * w + gx + 1] === 1;
                    const w_ = this.logicGrid[gy * w + gx - 1] === 1;
                    
                    if (n || s || e || w_) {
                        frontier.push({ tx, ty, d2: tx*tx + ty*ty });
                    }
                }
            }
        }
        return frontier;
    }

    _findValidBlockForCell(tx, ty, shapes) {
        const shuffledShapes = [...shapes].sort(() => Math.random() - 0.5);
        
        for (const shape of shuffledShapes) {
            const sw = shape.w;
            const sh = shape.h;
            const offsets = [];
            for (let oy = 0; oy < sh; oy++) {
                for (let ox = 0; ox < sw; ox++) {
                    offsets.push({ox, oy});
                }
            }
            offsets.sort(() => Math.random() - 0.5);
            
            for (const offset of offsets) {
                const bx = tx - offset.ox;
                const by = ty - offset.oy;
                
                if (this._checkNoOverlap(bx, by, sw, sh) && this._checkNoHole(bx, by, sw, sh)) {
                    return { tx: bx, ty: by, w: sw, h: sh };
                }
            }
        }
        return null;
    }

    _attemptUnfoldPerimeterGrowth() {
        this._initProceduralState();
        
        const l0Blocks = this.activeBlocks.filter(b => b.layer === 0);
        if (l0Blocks.length === 0) return;

        const totalTarget = Math.min(10, Math.max(1, Math.floor(l0Blocks.length / 8) + 1));
        const shapes = [
            {w: 1, h: 2}, {w: 2, h: 1},
            {w: 1, h: 3}, {w: 3, h: 1},
            {w: 2, h: 2}
        ];

        let spawnedCount = 0;
        let attempts = 0;
        const maxAttempts = totalTarget * 10;
        
        let frontier = this._getFrontier();
        if (frontier.length === 0) return;

        const biasChance = Math.min(0.85, 0.1 + (l0Blocks.length / 800));

        while (spawnedCount < totalTarget && attempts < maxAttempts) {
            attempts++;
            if (frontier.length === 0) break;

            const useCenterBias = (Math.random() < biasChance);
            let targetBlock = null;

            if (useCenterBias) {
                frontier.sort((a, b) => a.d2 - b.d2);
                const limit = Math.min(frontier.length, 100);
                for (let i = 0; i < limit; i++) {
                    const f = frontier[i];
                    targetBlock = this._findValidBlockForCell(f.tx, f.ty, shapes);
                    if (targetBlock) break;
                }
            } else {
                const idx = Math.floor(Math.random() * frontier.length);
                const f = frontier[idx];
                targetBlock = this._findValidBlockForCell(f.tx, f.ty, shapes);
            }

            if (targetBlock) {
                const id = this._spawnBlock(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, 0);
                if (id !== -1) {
                    spawnedCount++;
                    this._updateLocalLogicGrid(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, 1);
                    frontier = this._getFrontier();
                }
            }
        }
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
        const visibleBlocksW = this.g.cols / bs.w;
        const visibleBlocksH = this.g.rows / bs.h;
        const buffer = 5;
        const xLimit = (visibleBlocksW / 2) + buffer;
        const yLimit = (visibleBlocksH / 2) + buffer;

        if (x + w < -xLimit || x > xLimit || y + h < -yLimit || y > yLimit) return false;

        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        if (x + cx < 0 || x + cx + w > this.logicGridW || y + cy < 0 || y + cy + h > this.logicGridH) return false;
        return true;
    }

    _checkNoHole(tx, ty, tw, th) {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        const candidates = [];
        for (let x = tx - 1; x <= tx + tw; x++) {
            candidates.push([x, ty - 1]);
            candidates.push([x, ty + th]);
        }
        for (let y = ty; y < ty + th; y++) {
            candidates.push([tx - 1, y]);
            candidates.push([tx + tw, y]);
        }

        for (const [nx, ny] of candidates) {
            const gx = nx + cx;
            const gy = ny + cy;
            
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
            if (this.logicGrid[gy * w + gx] !== 0) continue;
            if (nx >= tx && nx < tx + tw && ny >= ty && ny < ty + th) continue;

            if (!this._canReachBoundary(nx, ny, tx, ty, tw, th)) {
                return false;
            }
        }
        return true;
    }

    _canReachBoundary(startX, startY, px, py, pw, ph) {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        
        const stack = [[startX, startY]];
        const visited = new Set([`${startX},${startY}`]);
        
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            if (x + cx <= 0 || x + cx >= w - 1 || y + cy <= 0 || y + cy >= h - 1) return true;
            
            const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
            for (const [nx, ny] of neighbors) {
                const gx = nx + cx;
                const gy = ny + cy;
                
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                const key = `${nx},${ny}`;
                if (visited.has(key)) continue;
                if (nx >= px && nx < px + pw && ny >= py && ny < py + ph) continue;
                if (this.logicGrid[gy * w + gx] !== 0) continue;
                
                visited.add(key);
                stack.push([nx, ny]);
                if (visited.size > 2000) return true; 
            }
        }
        return false;
    }
}