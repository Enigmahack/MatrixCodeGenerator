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
            
            const enNudge = (this.getConfig('EnableNudge') === true);
            const intervalMult = enNudge ? 0.15 : 0.25; // Nudge mode runs faster (0.15 vs 0.25)
            const interval = Math.max(1, baseDuration * (delayMult * intervalMult));
            
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

        if (enNudge) {
            // --- Nudge Growth Startup Sequence ---
            if (this.expansionPhase === 0) {
                // Step 1: Central block on Layer 0
                this._spawnBlock(0, 0, 1, 1, 0, false, false, 0, true, true);
                return;
            }
            if (this.expansionPhase === 1) {
                // Step 2: Opposing wings on Layer 1 (N/S or E/W)
                const axis = Math.random() < 0.5 ? 'V' : 'H';
                this.nudgeStartupAxis = axis; 
                if (axis === 'V') {
                    this._spawnBlock(0, -1, 1, 1, 1, false, false, 0, true, true); // N
                    this._spawnBlock(0, 1, 1, 1, 1, false, false, 0, true, true);  // S
                } else {
                    this._spawnBlock(-1, 0, 1, 1, 1, false, false, 0, true, true); // W
                    this._spawnBlock(1, 0, 1, 1, 1, false, false, 0, true, true);  // E
                }
                return;
            }
            if (this.expansionPhase === 2) {
                // Step 3: Opposite wings on Layer 1
                // (Previous pair merges automatically via 'Delayed Merge Logic' above)
                const prevAxis = this.nudgeStartupAxis || 'V';
                const newAxis = (prevAxis === 'V') ? 'H' : 'V';
                if (newAxis === 'V') {
                    this._spawnBlock(0, -1, 1, 1, 1, false, false, 0, true, true);
                    this._spawnBlock(0, 1, 1, 1, 1, false, false, 0, true, true);
                } else {
                    this._spawnBlock(-1, 0, 1, 1, 1, false, false, 0, true, true);
                    this._spawnBlock(1, 0, 1, 1, 1, false, false, 0, true, true);
                }
                return;
            }
            if (this.expansionPhase === 3) {
                // Step 4: Allow remaining Layer 1 blocks to merge (via Delayed Merge Logic in next step or now?)
                // Actually Delayed Merge runs at START of step.
                // So at start of Phase 3, it merges Phase 2 blocks (Cycle 2).
                // We do nothing here to complete the startup.
                return;
            }

            // Step 5+: Nudge Loop
            this._attemptNudgeGrowth();
            return;
        }

        // --- Standard Growth Behaviors ---
        const enCyclic = getGenConfig('EnableCyclic') === true;
        const enSpine = getGenConfig('EnableSpine') === true;
        const enOverlap = getGenConfig('EnableOverlap') === true;
        const enUnfold = getGenConfig('EnableUnfold') === true;
        const enCrawler = getGenConfig('EnableCrawler') === true;
        const enShift = getGenConfig('EnableShift') === true;
        const enCluster = getGenConfig('EnableCluster') === true;

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

        // 3. Post-growth cleanup
        if (enCyclic || enSpine || enUnfold || enCrawler || enShift || enCluster || enOverlap) {
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

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const ratio = (h > 0) ? w / h : 1;

        // 1. Check if axes reached perimeter unbroken using activeBlocks positions
        const isReached = (axis) => {
            if (axis === 'X') {
                let minX = 0, maxX = 0;
                for (const b of targetBlocks) {
                    if (b.y <= 0 && b.y + b.h > 0) { // Touching/spanning X-axis
                        minX = Math.min(minX, b.x);
                        maxX = Math.max(maxX, b.x + b.w - 1);
                    }
                }
                return (minX <= -cx && maxX >= w - cx - 1);
            }
            if (axis === 'Y') {
                let minY = 0, maxY = 0;
                for (const b of targetBlocks) {
                    if (b.x <= 0 && b.x + b.w > 0) { // Touching/spanning Y-axis
                        minY = Math.min(minY, b.y);
                        maxY = Math.max(maxY, b.y + b.h - 1);
                    }
                }
                return (minY <= -cy && maxY >= h - cy - 1);
            }
            return false;
        };

        const xReached = isReached('X');
        const yReached = isReached('Y');

        // 2. Determine Preference based on Aspect Ratio
        let preferredSpawn = 'equal';
        if (ratio > 1.2) preferredSpawn = 'Y';
        else if (ratio < 0.8) preferredSpawn = 'X';

        let spawnAxis = Math.random() < 0.5 ? 'X' : 'Y';
        if (preferredSpawn === 'Y' && Math.random() < 0.75) spawnAxis = 'Y';
        if (preferredSpawn === 'X' && Math.random() < 0.75) spawnAxis = 'X';

        // 3. Select Shape Length (1, 2, or 3)
        const rand = Math.random();
        let len = 1;
        if (rand > 0.35) len = (Math.random() < 0.5) ? 2 : 3;

        // Step 5a: 1x1 Preference (spawn at center)
        if (len === 1) {
            const face = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
            this._nudge(0, 0, 1, 1, face, 0);
            return;
        }

        // Steps 5b, 5c, 7: 2x1/3x1 or 1x2/1x3
        let tx = 0, ty = 0;
        let wBlock = 1, hBlock = 1;
        let face = '';

        if (spawnAxis === 'X') {
            wBlock = len; hBlock = 1;
            face = Math.random() < 0.5 ? 'N' : 'S';

            if (xReached) {
                // Step 7: Spawn along remainder of axis
                tx = Math.floor(Math.random() * w) - cx;
                ty = 0;
            } else {
                // Step 5b/5c: Connect to center block
                const shift = Math.floor(Math.random() * len);
                tx = -shift;
                ty = 0;
            }
        } else {
            wBlock = 1; hBlock = len;
            face = Math.random() < 0.5 ? 'E' : 'W';

            if (yReached) {
                // Step 7: Spawn along remainder of axis
                ty = Math.floor(Math.random() * h) - cy;
                tx = 0;
            } else {
                // Connect to center
                const shift = Math.floor(Math.random() * len);
                ty = -shift;
                tx = 0;
            }
        }

        this._nudge(tx, ty, wBlock, hBlock, face, 0);
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