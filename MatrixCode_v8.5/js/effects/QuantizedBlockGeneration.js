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

    _attemptLayerOverlap() {
        // 1. Initial State: Start with a center square if unwritten (handled by _attemptGrowth seed)
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        if (this.logicGrid[cy * this.logicGridW + cx] === 0) return;

        // Refresh outside map to ensure we know what is "external" vs "hole"
        this.renderer.computeTrueOutside(this, this.logicGridW, this.logicGridH);

        // 2. Loop Logic: Write, Write, Deletion?, Merge
        const step = this.overlapState.step;
        const cycleIndex = Math.floor(step / 4);
        const cycleStep = step % 4;

        // Scaling block count: 1 to 2 based on mass (activeBlocks.length)
        const blockCount = Math.min(2, Math.max(1, Math.floor(this.activeBlocks.length / 50) + 1));

        if (cycleStep === 0) {
            // a) Write a Layer 1 block (or multiple)
            for (let i = 0; i < blockCount; i++) {
                this._spawnOnPerimeter(1, cycleIndex);
            }
        } else if (cycleStep === 1) {
            // b) Write a Layer 0 block (or multiple)
            for (let i = 0; i < blockCount; i++) {
                this._spawnOnPerimeter(0);
            }
        } else if (cycleStep === 2) {
            // c) Single 1x1 block deletion (1/3 of the time)
            if (Math.random() < 0.33) {
                this._deletePerimeterL1();
            }
        } else if (cycleStep === 3) {
            // d) Merge the Layer 1 block
            // merge automatically if after 2 complete cycles have passed
            this._mergeLayer1(cycleIndex - 2);
        }

        this.overlapState.step++;
    }

    _deletePerimeterL1() {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const candidates = [];

        for (let gy = 1; gy < h - 1; gy++) {
            for (let gx = 1; gx < w - 1; gx++) {
                const idx = gy * w + gx;
                // Must be part of Layer 1
                if (!this.layerGrids[1] || this.layerGrids[1][idx] === -1) continue;
                // Must NOT be covered by Layer 0 (only visible Layer 1)
                if (this.layerGrids[0] && this.layerGrids[0][idx] !== -1) continue;

                // Must be on the outside perimeter (strictly at least 2 empty neighbors to avoid holes/pockets)
                const emptyN = this.logicGrid[(gy - 1) * w + gx] === 0 ? 1 : 0;
                const emptyS = this.logicGrid[(gy + 1) * w + gx] === 0 ? 1 : 0;
                const emptyE = this.logicGrid[gy * w + gx + 1] === 0 ? 1 : 0;
                const emptyW = this.logicGrid[gy * w + gx - 1] === 0 ? 1 : 0;
                const totalEmpty = emptyN + emptyS + emptyE + emptyW;

                if (totalEmpty >= 2) {
                    // Exclude "bridges" or "thin lines" where only opposing edges touch (N/S or E/W)
                    if (totalEmpty === 2) {
                        const touchingOnlyNS = (emptyE === 1 && emptyW === 1); 
                        const touchingOnlyEW = (emptyN === 1 && emptyS === 1);
                        if (touchingOnlyNS || touchingOnlyEW) continue;
                    }
                    candidates.push({gx, gy});
                }
            }
        }

        if (candidates.length > 0) {
            const target = candidates[Math.floor(Math.random() * candidates.length)];
            const tx = target.gx - cx;
            const ty = target.gy - cy;
            const now = this.animFrame;

            this.maskOps.push({
                type: 'removeBlock',
                x1: tx, y1: ty, x2: tx, y2: ty,
                startFrame: now,
                layer: 1,
                fade: true
            });

            // Update grids
            const idx = target.gy * w + target.gx;
            if (this.layerGrids[1]) this.layerGrids[1][idx] = -1;
            
            // Clear logicGrid if no other layers are present
            const l0 = this.layerGrids[0] && this.layerGrids[0][idx] !== -1;
            const l2 = this.layerGrids[2] && this.layerGrids[2][idx] !== -1;
            if (!l0 && !l2) {
                this.logicGrid[idx] = 0;
            }

            this._lastProcessedOpIndex = 0;
            this._maskDirty = true;
        }
    }

    _findHoles() {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const holes = [];
        if (!this._outsideMap) return holes;

        for (let i = 0; i < w * h; i++) {
            // A hole is a non-occupied cell that isn't reachable from the outside boundary
            if (this.logicGrid[i] === 0 && this._outsideMap[i] === 0) {
                const gx = i % w;
                const gy = Math.floor(i / w);
                const tx = gx - cx;
                const ty = gy - cy;
                holes.push({ tx, ty, d2: tx * tx + ty * ty });
            }
        }
        return holes;
    }

    _spawnOnPerimeter(layer, spawnCycle = null) {
        const blocks = this.activeBlocks;
        if (blocks.length === 0) return;

        const count = blocks.length;
        const allShapes = [
            {w:1, h:2}, {w:2, h:1}, // Rank 0
            {w:1, h:3}, {w:3, h:1}, {w:2, h:2}, // Rank 1
            {w:1, h:4}, {w:4, h:1} // Rank 2
        ];

        // Scaling: increase size as blob grows
        let maxRank = 0;
        if (count > 60) maxRank = 1;
        if (count > 150) maxRank = 2;

        const allowedShapes = [];
        if (maxRank >= 0) allowedShapes.push(allShapes[0], allShapes[1]);
        if (maxRank >= 1) allowedShapes.push(allShapes[2], allShapes[3], allShapes[4]);
        if (maxRank >= 2) allowedShapes.push(allShapes[5], allShapes[6]);

        // 1. Hole Filling Preference (Center-Outwards)
        const holes = this._findHoles();
        if (holes.length > 0) {
            holes.sort((a, b) => a.d2 - b.d2);
            for (let i = 0; i < Math.min(holes.length, 20); i++) {
                const hole = holes[i];
                const targetBlock = this._findValidBlockForCell(hole.tx, hole.ty, allowedShapes);
                if (targetBlock) {
                    if (this._isValidPerimeterPlacement(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, layer)) {
                        const id = this._spawnBlock(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, layer, false, false, 0, true, true);
                        if (id !== -1 && spawnCycle !== null) {
                            const b = this.activeBlocks.find(block => block.id === id);
                            if (b) b.spawnCycle = spawnCycle;
                        }
                        this._updateLocalLogicGrid(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, 1);
                        this._outsideMapDirty = true;
                        return true;
                    }
                }
            }
        }

        // 2. Normal Growth
        const maxAttempts = 100;
        for (let i = 0; i < maxAttempts; i++) {
            const shape = allowedShapes[Math.floor(Math.random() * allowedShapes.length)];
            const anchor = blocks[Math.floor(Math.random() * blocks.length)];
            
            const w = shape.w;
            const h = shape.h;
            
            // Random offset relative to anchor
            const tx = anchor.x + Math.floor(Math.random() * (anchor.w + w + 1)) - w;
            const ty = anchor.y + Math.floor(Math.random() * (anchor.h + h + 1)) - h;
            
            if (this._isValidPerimeterPlacement(tx, ty, w, h, layer)) {
                const id = this._spawnBlock(tx, ty, w, h, layer, false, false, 0, true, true);
                if (id !== -1 && spawnCycle !== null) {
                    const b = this.activeBlocks.find(block => block.id === id);
                    if (b) b.spawnCycle = spawnCycle;
                }
                this._updateLocalLogicGrid(tx, ty, w, h, 1);
                this._outsideMapDirty = true;
                return true;
            }
        }
        return false;
    }

    _isValidPerimeterPlacement(tx, ty, tw, th, targetLayer = 0) {
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        // Bounds check
        if (tx + cx < 0 || tx + cx + tw > w || ty + cy < 0 || ty + cy + th > h) return false;

        let occupiedByL0 = 0;
        let emptyCount = 0;
        let isTouching = false;
        let totalOccupied = 0;
        let hasOutsideCell = false;

        for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
                const gx = tx + cx + x;
                const gy = ty + cy + y;
                const idx = gy * w + gx;

                const isL0 = (this.layerGrids[0] && this.layerGrids[0][idx] !== -1);
                const isOccupied = (this.logicGrid[idx] === 1);
                const isOutside = (this._outsideMap && this._outsideMap[idx] === 1);

                if (isL0) occupiedByL0++;
                if (isOccupied) totalOccupied++;

                if (!isOccupied) {
                    emptyCount++;
                    if (isOutside) hasOutsideCell = true;

                    // Adjacency check for cells that are empty
                    if (!isTouching) {
                        if (gx > 0 && this.logicGrid[gy * w + gx - 1] === 1) isTouching = true;
                        else if (gx < w - 1 && this.logicGrid[gy * w + gx + 1] === 1) isTouching = true;
                        else if (gy > 0 && this.logicGrid[(gy - 1) * w + gx] === 1) isTouching = true;
                        else if (gy < h - 1 && this.logicGrid[(gy + 1) * w + gx] === 1) isTouching = true;
                    }
                }
            }
        }

        const totalArea = tw * th;

        // 1. Must add to the structure (emptyCount > 0)
        if (emptyCount === 0) return false;

        // 2. Must touch or add to the structure
        if (totalOccupied === 0 && !isTouching) return false;

        // 3. Ensure no new holes are created
        // We only need to verify this if the proposed block connects to the external outside area.
        // Filling existing holes (hasOutsideCell === false) does not create new ones.
        if (hasOutsideCell && !this._checkNoHole(tx, ty, tw, th)) return false;

        // 4. For L1 blocks: "never fully overlap existing L0 blocks"
        if (targetLayer === 1 && occupiedByL0 === totalArea) {
            return false;
        }

        return true;
    }

    _mergeLayer1(maxCycle = -1) {
        const now = this.animFrame;
        const blocksToMerge = this.activeBlocks.filter(b => 
            b.layer === 1 && (maxCycle === -1 || b.spawnCycle === undefined || b.spawnCycle <= maxCycle)
        );
        
        if (blocksToMerge.length === 0) return;

        for (const b of blocksToMerge) {
            // Add operations to transition visually
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
            this._writeToGrid(b.x, b.y, b.w, b.h, now, 0); // Write to L0
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);  // Clear from L1
        }

        this._lastProcessedOpIndex = 0;
        this._maskDirty = true;
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