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

    _spawnBlock(x, y, w, h, layer = 0, suppressLines = false, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false) {
        const enNudge = (this.getConfig('EnableNudge') === true);
        const useStaging = (this.expansionPhase < 4) || enNudge;

        // Redirect Layer 0 spawns to Layer 1 for the staggered cycle (after initial seed)
        if (useStaging && layer === 0 && this.expansionPhase >= 1) {
            layer = 1;
        }

        const id = super._spawnBlock(x, y, w, h, layer, suppressLines, isShifter, expireFrames, skipConnectivity, allowInternal);
        
        if (id !== -1 && layer === 1) {
            const b = this.activeBlocks.find(block => block.id === id);
            if (b) b.spawnCycle = this.expansionPhase;
        }
        return id;
    }

    _nudge(x, y, w, h, face, layer = 0) {
        const enNudge = (this.getConfig('EnableNudge') === true);
        const useStaging = (this.expansionPhase < 4) || enNudge;

        // For Nudge Growth, we force Layer 1 staging to satisfy the Stage -> Merge cycle requirement
        if (useStaging && layer === 0 && this.expansionPhase >= 1) {
            layer = 1;
        }
        super._nudge(x, y, w, h, face, layer);
        
        const b = this.activeBlocks[this.activeBlocks.length - 1];
        if (b && b.layer === 1) b.spawnCycle = this.expansionPhase;
    }

    _attemptClusterGrowth() {
        const enNudge = (this.getConfig('EnableNudge') === true);
        if (enNudge) {
            // Respect the 1-2 block staggered rhythm for Nudge mode
            if (this.activeBlocks.length === 0) return;
            const anchors = this.activeBlocks.filter(b => b.layer === 0);
            if (anchors.length === 0) return;
            const anchor = anchors[Math.floor(Math.random() * anchors.length)];
            const axis = Math.random() < 0.5 ? 'V' : 'H';
            let dir, startCoords;
            if (axis === 'V') { 
                dir = Math.random() < 0.5 ? 'N' : 'S'; 
                startCoords = { x: anchor.x, y: 0 }; 
            } else { 
                dir = Math.random() < 0.5 ? 'E' : 'W'; 
                startCoords = { x: 0, y: anchor.y }; 
            }
            this._blockShift(dir, Math.random() < 0.5 ? 1 : 2, startCoords);
        } else {
            super._attemptClusterGrowth();
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
            const interval = baseDuration * (delayMult / 4.0);
            
            this.genTimer++;
            if (this.genTimer >= interval) {
                if (!this.debugMode || this.manualStep) {
                    this.genTimer = 0;
                    this._attemptGrowth();
                    this.expansionPhase++;
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
        const s = this.c.state;

        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return s['quantizedGenerateV2' + key];
        };

        const enNudge = getGenConfig('EnableNudge') === true;
        const useStaging = (this.expansionPhase < 4) || enNudge;

        // Delayed Merge Logic: Stage L1 -> Merge L0
        if (useStaging) {
            this._mergeLayer1(this.expansionPhase - 1);
        } else {
            this._mergeLayer1(-1); // Commit any remaining L1 blocks instantly
        }

        // --- Startup Sequence (Phases 0-3) ---
        if (this.expansionPhase === 0) {
            this._spawnBlock(0, 0, 1, 1, 0, false, false, 0, true, true);
            return;
        }

        const cardinals = [{x:0, y:-1}, {x:0, y:1}, {x:1, y:0}, {x:-1, y:0}];

        if (this.expansionPhase === 1) {
            const idx = Math.floor(Math.random() * 4);
            this._spawnBlock(cardinals[idx].x, cardinals[idx].y, 1, 1, 1, false, false, 0, true, true);
            this.usedCardinalIndices = [idx];
            return;
        }

        if (this.expansionPhase === 2) {
            const available = [0, 1, 2, 3].filter(i => !this.usedCardinalIndices.includes(i));
            for (let i = available.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [available[i], available[j]] = [available[j], available[i]];
            }
            const toAdd = available.slice(0, 2);
            for (const idx of toAdd) {
                this._spawnBlock(cardinals[idx].x, cardinals[idx].y, 1, 1, 1, false, false, 0, true, true);
                this.usedCardinalIndices.push(idx);
            }
            return;
        }

        if (this.expansionPhase === 3) {
            const idx = [0, 1, 2, 3].find(i => !this.usedCardinalIndices.includes(i));
            if (idx !== undefined) {
                this._spawnBlock(cardinals[idx].x, cardinals[idx].y, 1, 1, 1, false, false, 0, true, true);
            }
            return;
        }

        // --- Step 5+ (Phase 4+): Procedural Generation ---

        const enCyclic = getGenConfig('EnableCyclic') === true;
        const enSpine = getGenConfig('EnableSpine') === true;
        const enOverlap = getGenConfig('EnableOverlap') === true;
        const enUnfold = getGenConfig('EnableUnfold') === true;
        const enCrawler = getGenConfig('EnableCrawler') === true;
        const enShift = getGenConfig('EnableShift') === true;
        const enCluster = getGenConfig('EnableCluster') === true;

        if (enNudge) {
            // Nudge Growth behavior: 1-2 strips per step, Stage -> Merge cycle
            const count = Math.random() < 0.5 ? 1 : 2;
            for (let i = 0; i < count; i++) this._attemptNudgeGrowth();
        } else {
            // Standard Growth behaviors: Original logic, instant L0
            switch (mode) {
                case 'unfold': if (enUnfold) this._attemptUnfoldPerimeterGrowth(); break;
                case 'cyclic': if (enCyclic) this._attemptCyclicGrowth(); break;
                case 'spine': if (enSpine) this._attemptSpineGrowth(); break;
                case 'shift': if (enShift) this._attemptShiftGrowth(); break;
                case 'cluster': if (enCluster) super._attemptClusterGrowth(); break;
                case 'overlap': if (enOverlap) this._attemptLayerOverlap(); break;
                case 'unfold_legacy': if (enUnfold) this._attemptUnfoldGrowth(); break;
                case 'crawler': super._attemptGrowth(); break;
                default: super._attemptGrowth(); break;
            }
        }

        // 3. Post-growth cleanup
        if (enCyclic || enSpine || enUnfold || enCrawler || enShift || enCluster || enOverlap || enNudge) {
            this._performHoleCleanup();
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
            this._writeToGrid(b.x, b.y, b.w, b.h, now, 0); // Write to L0
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);  // Clear from L1
        }

        this._lastProcessedOpIndex = 0;
        this._maskDirty = true;
    }

    _attemptNudgeGrowth() {
        this._initProceduralState();
        const targetBlocks = this.activeBlocks.filter(b => b.layer === 0);
        if (targetBlocks.length === 0) return;

        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w/2), cy = Math.floor(h/2);

        // 1. Enforce Distribution: Decide target axis (X or Y)
        let axis = 'X';
        if (this.nudgeAxisBalance < 0) axis = 'Y';
        else if (this.nudgeAxisBalance > 0) axis = 'X';
        else axis = Math.random() < 0.5 ? 'X' : 'Y';

        // 2. Check edges for the axes to determine if perpendicular growth is allowed
        const reached = { N: false, S: false, E: false, W: false };
        for (const b of targetBlocks) {
            if (b.y + cy <= 0) reached.N = true;
            if (b.y + cy + b.h >= h) reached.S = true;
            if (b.x + cx + b.w >= w) reached.E = true;
            if (b.x + cx <= 0) reached.W = true;
        }

        const xReached = reached.E || reached.W;
        const yReached = reached.N || reached.S;

        // 3. Select anchor and direction
        let anchor = { x: 0, y: 0, w: 1, h: 1 };
        let face = '';
        let nw = 1, nh = 1;

        // Logic: Prioritize growing the spine from the center outward.
        // If an axis has reached the perimeter, allow perpendicular growth from its spine.
        if (axis === 'X') {
            // Growing horizontal strips or pushing the horizontal spine
            if (yReached && Math.random() < 0.6) {
                // Perpendicular: Nudge East/West from the vertical spine
                const verticalSpine = targetBlocks.filter(b => Math.abs(b.x) <= 1);
                if (verticalSpine.length > 0) anchor = verticalSpine[Math.floor(Math.random() * verticalSpine.length)];
            }
            face = (anchor.x >= 0) ? 'E' : 'W';
            nw = [1, 2, 3][Math.floor(Math.random() * 3)];
            nh = 1;
            this.nudgeAxisBalance++;
        } else {
            // Growing vertical strips or pushing the vertical spine
            if (xReached && Math.random() < 0.6) {
                // Perpendicular: Nudge North/South from the horizontal spine
                const horizontalSpine = targetBlocks.filter(b => Math.abs(b.y) <= 1);
                if (horizontalSpine.length > 0) anchor = horizontalSpine[Math.floor(Math.random() * horizontalSpine.length)];
            }
            face = (anchor.y >= 0) ? 'S' : 'N';
            nw = 1;
            nh = [1, 2, 3][Math.floor(Math.random() * 3)];
            this.nudgeAxisBalance--;
        }

        // Perform the actual nudge. Targeting (anchor.x, anchor.y) with direction 'face'
        // will push the entire arm/segment outward and insert the new blocks at the origin.
        // This repeatedly happens at the source, pushing blocks toward the perimeter.
        this._nudge(anchor.x, anchor.y, nw, nh, face, 0);
    }

    _attemptUnfoldPerimeterGrowth() {
        this._initProceduralState();
        const l0Blocks = this.activeBlocks.filter(b => b.layer === 0);
        if (l0Blocks.length === 0) return;

        const totalTarget = Math.random() < 0.5 ? 1 : 2;
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
                    targetBlock = this._findValidBlockForCell(frontier[i].tx, frontier[i].ty, shapes);
                    if (targetBlock) break;
                }
            } else {
                const f = frontier[Math.floor(Math.random() * frontier.length)];
                targetBlock = this._findValidBlockForCell(f.tx, f.ty, shapes);
            }
            if (targetBlock) {
                const id = this._spawnBlock(targetBlock.tx, targetBlock.ty, targetBlock.w, targetBlock.h, 0);
                if (id !== -1) { spawnedCount++; frontier = this._getFrontier(); }
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