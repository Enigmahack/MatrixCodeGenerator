/**
 * QuantizedProceduralEngine.js - Version 8.5.1
 *
 * Procedural generation engine for QuantizedBaseEffect.
 * Contains: growth pool, behavior system, block spawning, nudging,
 * strip management, structural integrity, and expansion logic.
 *
 * Must be loaded AFTER QuantizedBaseEffect.js.
 * Methods are mixed into QuantizedBaseEffect.prototype.
 */
class _QuantizedProceduralEngine {
    _initProceduralState(forceSeed = false) {
        if (this.proceduralInitiated && !forceSeed) return;
        this.proceduralInitiated = true;

        // Initialize growth states if not already present
        if (!this.unfoldSequences) this.unfoldSequences = Array.from({ length: 3 }, () => []);
        if (!this.behaviorState.nudgeState) {
            this.behaviorState.nudgeState = {
                dirCounts: { N: 0, S: 0, E: 0, W: 0 },
                fieldExpansion: { N: 0, S: 0, E: 0, W: 0 },
                lanes: new Map(), // Tracks {0: count, 1: count} per lane
                cycle: {
                    step: 0, // 0: Expansion, 1: Retract/Pause, 2: Retract/Pause
                    lastTempBlock: null
                }
            };
        }
        if (!this.behaviorState.spreadingNudgeCycles) {
            this.behaviorState.spreadingNudgeCycles = {
                'V1':  { step: 0, lastTempBlock: null },
                'V-1': { step: 0, lastTempBlock: null },
                'H1':  { step: 0, lastTempBlock: null },
                'H-1': { step: 0, lastTempBlock: null }
            };
        }
        if (!this.behaviorState.spreadingNudgeNextSpawnStep) {
            this.behaviorState.spreadingNudgeNextSpawnStep = { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
        }
        if (!this.behaviorState.spreadingNudgeSymmetryQueue) {
            this.behaviorState.spreadingNudgeSymmetryQueue = [];
        }
        if (!this.overlapState) this.overlapState = { step: 0 };
        if (!this.cycleState) this.cycleState = { step: 0, step1Block: null };
        if (!this.rearrangePool) this.rearrangePool = Array.from({ length: 3 }, () => 0);

        // Ensure we have at least one anchor if starting fresh and requested
        if (forceSeed) {
            const manualOnly = !!this.getConfig('ManualSeedOnly');
            if (manualOnly) return; // Explicit bypass for effects that manage their own seeding (like Zoom)

            const maxLayer = this._getMaxLayer();
            const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
            
            // Fix: check if ANY blocks exist across ANY layer before spawning a seed.
            // This prevents the 'center block' spawn if a tap-to-spawn sequence has already placed a block on Layer 1.
            let needsSeed = true;
            if (this.activeBlocks && this.activeBlocks.length > 0) {
                needsSeed = false;
            }

            if (needsSeed) {
                if (!this.activeBlocks) this.activeBlocks = [];
                // Principle #3: Adhere to LayerCount setting.
                // Seed the focal point block on all active layers to ensure they have an initial anchor.
                // Use the current generator focal point so manual placement is respected.
                const ox = this.behaviorState?.genOriginX ?? 0;
                const oy = this.behaviorState?.genOriginY ?? 0;

                for (let l = 0; l <= maxLayer; l++) {
                    // If promotion is active, only seed Layer 1 as the initial discovery anchor.
                    if (usePromotion && l !== 1) continue;

                    // Use skipConnectivity=true and bypassOccupancy=true for the initial seeds
                    this._spawnBlock(ox, oy, 1, 1, l, false, 0, true, true, true, false, true);
                }
            }
        }
    }

    _attemptGrowth() {
        if (this._isCanvasFullyCovered()) return;
        this._initProceduralState(true);

        const s = this.c.state;
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return this._getGenConfig(key);
        };

        const mode = getGenConfig('Mode') || 'default';
        
        // Use V2 generator logic if mode is 'v2', if takeover is active, or if it's the BlockGenerator effect
        if (mode === 'v2' || this.state === 'GENERATING' || this.name === "QuantizedBlockGenerator") {
            return this._attemptV2Growth();
        }

        // If mode is 'advanced' (Spines/Wings), use advanced logic
        if (mode === 'advanced') {
            return this._attemptAdvancedGrowth();
        }
    }

    _attemptAdvancedGrowth() {
        if (this.expansionComplete) return;
        this._initProceduralState(false); 
        this._syncSubLayers();
        this._updateInternalLogicGrid();

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const chance = 0.66, reversionChance = 0.15;
        const maxLayer = this._getMaxLayer();

        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;

        const bs = this.getBlockSize();
        const xVisible = Math.ceil(this.g.cols / bs.w / 2), yVisible = Math.ceil(this.g.rows / bs.h / 2);
        const xGrowthLimit = xVisible + 3, yGrowthLimit = yVisible + 3;
        const xFinishLimit = xVisible + 1, yFinishLimit = yVisible + 1;

        const ratio = this.g.cols / this.g.rows;
        const xBias = Math.max(1.0, ratio), yBias = Math.max(1.0, 1.0 / ratio);
        const getBurst = (bias) => {
            let b = 1; if (bias > 1.2) { if (Math.random() < (bias - 1.0) * 0.8) b = 2; if (b === 2 && Math.random() < (bias - 2.0) * 0.5) b = 3; }
            return b;
        };
        const xBurst = getBurst(xBias), yBurst = getBurst(yBias);

        const getGridVal = (layer, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2; 
            return this.layerGrids[layer][gy * w + gx];
        };

        let successInStep = false;
        const xSpines = [{id: 'spine_west', dx: -1}, {id: 'spine_east', dx: 1}];
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));

        for (const spine of xSpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeX = ox + spine.dx;
                    while (true) {
                        const val = getGridVal(l, freeX, oy);
                        if (val === -2 || Math.abs(freeX - ox) >= xFinishLimit) { if (l === maxLayer) finished = true; break; }
                        if (val === -1) break;
                        freeX += spine.dx;
                    }
                    if (Math.abs(freeX - ox) < xFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = freeX + (b * spine.dx);
                            if (getGridVal(l, tx, oy) === -1 && Math.abs(tx - ox) <= xGrowthLimit) {
                                if (this._spawnBlock(tx, oy, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }
        const ySpines = [{id: 'spine_north', dy: -1}, {id: 'spine_south', dy: 1}];
        for (const spine of ySpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeY = oy + spine.dy;
                    while (true) {
                        const val = getGridVal(l, ox, freeY);
                        if (val === -2 || Math.abs(freeY - oy) >= yFinishLimit) { if (l === 1) finished = true; break; }
                        if (val === -1) break;
                        freeY += spine.dy;
                    }
                    if (Math.abs(freeY - oy) < yFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = freeY + (b * spine.dy);
                            if (getGridVal(l, ox, ty) === -1 && Math.abs(ty - oy) <= yGrowthLimit) {
                                if (this._spawnBlock(ox, ty, 1, 1, l, false, 0, true, true, true, false, true) !== -1) successInStep = true;
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }

        // --- Core Spines Logic: Catch up Layer 0/1 to follow leading layers ---
        for (const spine of xSpines) {
            for (let x = ox + spine.dx; Math.abs(x - ox) <= xGrowthLimit; x += spine.dx) {
                let anyLeading = false;
                for (let l = 1; l <= maxLayer; l++) if (getGridVal(l, x, oy) !== -1) anyLeading = true;
                
                const targetL = usePromotion ? 1 : 0;
                if (getGridVal(targetL, x, oy) === -1 && anyLeading) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x + (b * spine.dx);
                            if (getGridVal(targetL, tx, oy) === -1) { 
                                if (this._spawnBlock(tx, oy, 1, 1, targetL, false, 0, true, true, true, false, true) !== -1) successInStep = true; 
                            } else break;
                        }
                    }
                    break;
                }
            }
        }
        let minX = ox, maxX = ox;
        for (let x = ox - 1; ; x--) { if (getGridVal(maxLayer, x, oy) === -1 || getGridVal(maxLayer, x, oy) === -2) { minX = x + 1; break; } }
        for (let x = ox + 1; ; x++) { if (getGridVal(maxLayer, x, oy) === -1 || getGridVal(maxLayer, x, oy) === -2) { maxX = x - 1; break; } }
        for (let x = minX; x <= maxX; x++) {
            const directions = [{ id: 'n', dy: -1 }, { id: 's', dy: 1 }];
            for (const d of directions) {
                const branchId = `wing_${d.id}_${x}`;
                let wingFinished = this.finishedBranches.has(branchId), wingFreeY = oy + d.dy;
                if (!wingFinished) {
                    while (true) {
                        const val = getGridVal(maxLayer, x, wingFreeY);
                        if (val === -2 || Math.abs(wingFreeY - oy) >= yFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                        if (val === -1) break; wingFreeY += d.dy;
                    }
                }
                if (!wingFinished) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = wingFreeY + (b * d.dy);
                            if (getGridVal(maxLayer, x, ty) === -1 && Math.abs(ty - oy) <= yGrowthLimit) { if (this._spawnBlock(x, ty, 1, 1, maxLayer, false, 0, true, true, true, false, true) !== -1) successInStep = true; } else break;
                        }
                    }
                    this._revertFrontier(x, oy, 0, d.dy, maxLayer, reversionChance, branchId);
                }
                const searchLimitY = wingFinished ? yGrowthLimit : Math.abs(wingFreeY - oy);
                for (let y = oy + d.dy; Math.abs(y - oy) <= searchLimitY; y += d.dy) {
                    const targetL = usePromotion ? 1 : 0;
                    if (getGridVal(targetL, x, y) === -1 && getGridVal(maxLayer, x, y) !== -1) {
                        if (Math.random() < chance) {
                            for (let b = 0; b < yBurst; b++) {
                                const ty = y + (b * d.dy);
                                if (getGridVal(targetL, x, ty) === -1 && getGridVal(maxLayer, x, ty) !== -1) { 
                                    if (this._spawnBlock(x, ty, 1, 1, targetL, false, 0, true, true, true, false, true) !== -1) successInStep = true; 
                                } else break;
                            }
                        }
                        break;
                    }
                }
            }
        }
        if (this.getConfig('EnableAutoFillHoles')) this._maintainStructuralIntegrity();
        this._updateInternalLogicGrid();
    }

    _isNudgePathFull(x, y, w, h, face, layer) {
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const bx = this.logicGridW, by = this.logicGridH;
        const cx = Math.floor(bx / 2), cy = Math.floor(by / 2);

        // Visible boundary limits (Canvas + 1 block)
        const bs = this.getBlockSize();
        const visW = Math.ceil(this.g.cols / bs.w);
        const visH = Math.ceil(this.g.rows / bs.h);
        const xLimit = Math.floor(visW / 2) + 1;
        const yLimit = Math.floor(visH / 2) + 1;

        const isLaneFull = (rx, ry, dx, dy) => {
            // Check if the chain is unbroken from current point to the VISIBLE boundary
            let tx = rx, ty = ry;
            while (true) {
                // If we hit the boundary of the visible area, this lane is "full"
                if (tx < -xLimit || tx > xLimit || ty < -yLimit || ty > yLimit) break;
                
                const gx = cx + tx, gy = cy + ty;
                if (gx < 0 || gx >= bx || gy < 0 || gy >= by) break;
                
                if (grid[gy * bx + gx] === -1) return false; // Gap found, not full
                
                tx += dx; ty += dy;
                if (Math.abs(tx) > bx || Math.abs(ty) > by) break; // Safety
            }
            return true;
        };

        // Check each row/column in the nudge span
        for (let ly = 0; ly < h; ly++) {
            for (let lx = 0; lx < w; lx++) {
                const tx = x + lx, ty = y + ly;
                let full = false;
                if (face === 'E') full = isLaneFull(tx, ty, 1, 0);
                else if (face === 'W') full = isLaneFull(tx, ty, -1, 0);
                else if (face === 'S') full = isLaneFull(tx, ty, 0, 1);
                else if (face === 'N') full = isLaneFull(tx, ty, 0, -1);
                if (full) return true;
            }
        }
        return false;
    }

    _attemptNudgeGrowthWithParams(layer, bw, bh, originX = null, originY = null, cycleState = null, chance = null) {
        // Force focus on Layer 1 as per instructions

        const cycle = cycleState || (this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : null);
        if (!cycle) return false;

        // "Randomness" controls probability:
        // 0.05 (Min) -> 5% chance of temp blocks / 5% chance of retraction
        // 1.0 (Max) -> 100% chance of temp blocks / 100% chance of retraction
        const randomness = chance ?? (this._getGenConfig('NudgeChance') ?? 0.8);

        if (cycle.step === 0) {
            // STEP 0: EXPANSION
            // We always try to place the Permanent block. 
            // Randomness controls if we also get a Temporary block.
            const success = this._executeExpansionStep(layer, bw, bh, randomness, originX, originY);
            if (success) {
                cycle.step = 1;
                return true;
            }
            return false;
        } else {
            // STEP 1 or 2: RETRACT or PAUSE
            // Randomness controls probability of retraction vs pause
            const isRetract = Math.random() < randomness; 
            let success = false;

            if (isRetract && cycle.lastTempBlock) {
                const b = cycle.lastTempBlock;
                this._removeBlock(b.x, b.y, b.w, b.h, layer, true);
                cycle.lastTempBlock = null;
                success = true;
            } else {
                // Pause (Action performed but no grid change)
                success = true;
            }

            // Advance step: 1 -> 2, 2 -> 0
            cycle.step = (cycle.step + 1) % 3;
            return success;
        }
    }

    _executeExpansionStep(layer, bw, bh, randomness = 0.8, originX = null, originY = null) {
        if (!this.logicGridW || !this.logicGridH) return false;
        const w = this.logicGridW, h = this.logicGridH;
        const cx = (originX !== null) ? (Math.floor(w / 2) + originX) : Math.floor(w / 2);
        const cy = (originY !== null) ? (Math.floor(h / 2) + originY) : Math.floor(h / 2);
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const allowed = this._getAllowedDirs(layer);
        const faces = this._getBiasedDirections().filter(f => !allowed || allowed.has(f));
        if (faces.length === 0) return false;

        for (const dir of faces) {
            // Compute how far the center spoke has grown in this direction (extRatio).
            // This gates lateral expansion: nudge only widens once the spine is >33% grown.
            const stepDir = (dir === 'N' || dir === 'W') ? -1 : 1;
            let spokeBlocks = 0;
            if (dir === 'N' || dir === 'S') {
                for (let gy = cy + stepDir; dir === 'N' ? gy >= 0 : gy < h; gy += stepDir) {
                    if (grid[gy * w + cx] !== -1) spokeBlocks++; else break;
                }
            } else {
                for (let gx = cx + stepDir; dir === 'W' ? gx >= 0 : gx < w; gx += stepDir) {
                    if (grid[cy * w + gx] !== -1) spokeBlocks++; else break;
                }
            }
            const spokeHalf = (dir === 'N') ? cy : (dir === 'S') ? h - 1 - cy : (dir === 'W') ? cx : w - 1 - cx;
            const extRatio = spokeHalf > 0 ? spokeBlocks / spokeHalf : 1.0;
            // Allow up to 3 cells of lateral spread once the spoke is >33% grown
            const maxOffset = extRatio > 0.33 ? Math.min(3, Math.ceil(extRatio * 3)) : 0;

            // Find first empty gap along this direction's spoke, starting at center axis
            // and expanding laterally (offset ±1, ±2, ...) as the structure grows wider.
            let firstEmpty = null;
            offSearch:
            for (let off = 0; off <= maxOffset; off++) {
                const offVals = off === 0 ? [0] : [off, -off];
                for (const dAxis of offVals) {
                    if (dir === 'N' || dir === 'S') {
                        const gx = cx + dAxis;
                        if (gx < 0 || gx >= w) continue;
                        const startY = (dir === 'N') ? cy - 1 : cy + 1;
                        const endY = (dir === 'N') ? 0 : h - 1;
                        for (let gy = startY; (dir === 'N' ? gy >= endY : gy <= endY); gy += stepDir) {
                            if (grid[gy * w + gx] === -1) {
                                firstEmpty = { x: gx - Math.floor(w / 2), y: gy - Math.floor(h / 2) };
                                break offSearch;
                            }
                        }
                    } else {
                        const gy = cy + dAxis;
                        if (gy < 0 || gy >= h) continue;
                        const startX = (dir === 'W') ? cx - 1 : cx + 1;
                        const endX = (dir === 'W') ? 0 : w - 1;
                        for (let gx = startX; (dir === 'W' ? gx >= endX : gx <= endX); gx += stepDir) {
                            if (grid[gy * w + gx] === -1) {
                                firstEmpty = { x: gx - Math.floor(w / 2), y: gy - Math.floor(h / 2) };
                                break offSearch;
                            }
                        }
                    }
                }
            }

            if (firstEmpty) {
                // Growth Variance: Up to 20% chance of consecutive steps (streak)
                let bonusSteps = (Math.random() < 0.2) ? 1 + Math.floor(Math.random() * 2) : 0;
                
                // NEW: Use the scale as the base number of steps for the nudge
                const scale = Math.max(bw, bh);
                let totalSteps = scale + bonusSteps;
                
                // Force 1x1 blocks for the actual nudge spawn steps
                const spawnW = 1;
                const spawnH = 1;

                let currentPos = { x: firstEmpty.x, y: firstEmpty.y };
                let lastSpawnedId = -1;

                for (let sIdx = 0; sIdx < totalSteps; sIdx++) {
                    // 1. PLACE PERMANENT BLOCK (Forward)
                    let px = currentPos.x, py = currentPos.y;
                    if (dir === 'N') { py = currentPos.y - spawnH + 1; px = currentPos.x - Math.floor(spawnW / 2); }
                    else if (dir === 'S') { py = currentPos.y; px = currentPos.x - Math.floor(spawnW / 2); }
                    else if (dir === 'W') { px = currentPos.x - spawnW + 1; py = currentPos.y - Math.floor(spawnH / 2); }
                    else if (dir === 'E') { px = currentPos.x; py = currentPos.y - Math.floor(spawnH / 2); }

                    // Bug Fix: If L1 already exists here, skip (prevents hole-making on retraction)
                    if (this._isOccupied(px, py, layer)) break;

                    const permId = this._spawnBlock(px, py, spawnW, spawnH, layer, false, 0, true, true, true, false, true);
                    if (permId !== -1) {
                        lastSpawnedId = permId;
                        
                        // 2. OPTIONALLY PLACE TEMPORARY BLOCK (Scaled by Randomness)
                        // Only place temp block for the LAST step of the streak to avoid over-crowding
                        if (sIdx === totalSteps - 1 && Math.random() < randomness) {
                            const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
                            const opp = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
                            const spawnDirs = shuffle(['N', 'S', 'E', 'W'].filter(d => d !== opp[dir]));
                            
                            let tempId = -1;
                            for (const tempDir of spawnDirs) {
                                let tx = px, ty = py;
                                if (tempDir === 'N') ty -= spawnH;
                                else if (tempDir === 'S') ty += spawnH;
                                else if (tempDir === 'W') tx -= spawnW;
                                else if (tempDir === 'E') tx += spawnW;

                                // Bug Fix: If L1 already exists here, skip (prevents hole-making on retraction)
                                if (this._isOccupied(tx, ty, layer)) continue;

                                tempId = this._spawnBlock(tx, ty, spawnW, spawnH, layer, false, 0, true, true, true, false, true);
                                if (tempId !== -1) {
                                    const cycle = this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : null;
                                    if (cycle) cycle.lastTempBlock = { x: tx, y: ty, w: spawnW, h: spawnH };
                                    break; 
                                }
                            }
                            if (tempId === -1 && this.behaviorState.nudgeState?.cycle) this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                        } else if (sIdx === totalSteps - 1 && this.behaviorState.nudgeState?.cycle) {
                            this.behaviorState.nudgeState.cycle.lastTempBlock = null;
                        }

                        // If we have more steps, find the next empty in the same lane
                        if (sIdx < totalSteps - 1) {
                            let nextEmpty = null;
                            const curGX = cx + currentPos.x, curGY = cy + currentPos.y;
                            for (let gy = curGY + stepDir, gx = curGX + stepDir; (dir === 'N' ? gy >= 0 : dir === 'S' ? gy < h : dir === 'W' ? gx >= 0 : gx < w); (dir === 'N' || dir === 'S' ? gy += stepDir : gx += stepDir)) {
                                const tx = (dir === 'N' || dir === 'S') ? curGX : gx;
                                const ty = (dir === 'N' || dir === 'S') ? gy : curGY;
                                if (grid[ty * w + tx] === -1) {
                                    nextEmpty = { x: tx - cx, y: ty - cy };
                                    break;
                                }
                            }
                            if (nextEmpty) {
                                currentPos = nextEmpty;
                            } else {
                                break; // No more space in this lane
                            }
                        }
                    } else {
                        break; // Failed to spawn
                    }
                }
                
                if (lastSpawnedId !== -1) return true;
            }
        }
        return false;
    }

    _proposeCandidate(c) {
        if (!this.RULES.bounds(c)) {
            if (!this._redirectOffscreen(c)) return -1;
        }
        if (!this._validateCandidate(c)) return -1;
        const id = this._commitCandidate(c);
        if (id === -1) return -1;
        if (!c.isShifter && !c.isMirroredSpawn && this.getConfig('EnableAxisBalancing')) {
            this._handleAxisBalancing(c);
        }
        return id;
    }

    _redirectOffscreen(c) {
        if (c.skipConnectivity) return false;
        const bs = this.getBlockSize(), xLimit = Math.floor((this.g.cols / bs.w) / 2), yLimit = Math.floor((this.g.rows / bs.h) / 2);
        const total = this.activeBlocks.length;
        if (total === 0) return false;
        const sampleSize = Math.min(total, 50), candidates = [], tx = c.x, ty = c.y;
        for (let i = total - 1; i >= 0 && candidates.length < sampleSize; i--) {
            const b = this.activeBlocks[i];
            if (b.layer !== c.layer) continue;
            if (!(b.x < -xLimit || b.x > xLimit || b.y < -yLimit || b.y > yLimit)) {
                const dist = Math.abs(b.x - tx) + Math.abs(b.y - ty);
                candidates.push({ b, dist });
            }
        }
        if (candidates.length === 0) return false;
        candidates.sort((a, b) => a.dist - b.dist);
        const dirs = this._getBiasedDirections();
        for (let i = 0; i < Math.min(10, candidates.length); i++) {
            const a = candidates[i].b;
            for (const dir of dirs) {
                let nx = a.x, ny = a.y;
                if (dir === 'N') ny = a.y - c.h;
                else if (dir === 'S') ny = a.y + a.h;
                else if (dir === 'E') nx = a.x + a.w;
                else if (dir === 'W') nx = a.x - c.w;
                if (nx >= -xLimit && nx + c.w - 1 <= xLimit && ny >= -yLimit && ny + c.h - 1 <= yLimit) {
                    c.x = nx; c.y = ny; return true;
                }
            }
        }
        return false;
    }

    _validateCandidate(c) {
        if (!this.RULES.bounds(c)) return false;
        if (!this.RULES.occupancy(c)) return false;
        if (!this.RULES.vacated(c)) return false;
        if (c.isShifter) return true;
        
        // If skipping connectivity (e.g. forced promotion/anchor), we skip relative checks too
        if (c.skipConnectivity) return true;

        if (!this.RULES.connectivity(c)) return false;
        if (!this.RULES.direction(c)) return false;
        if (!this.RULES.spatial(c)) return false;
        return true;
    }

    _commitCandidate(c) {
        const id = this._spawnBlockCore(
            c.x, c.y, c.w, c.h, c.layer,
            c.isShifter, c.expireFrames,
            true, 
            c.allowInternal, c.suppressFades, c.isMirroredSpawn, c.bypassOccupancy,
            false, c.source || null
        );
        if (id !== -1) {
            if (!this._currentStepActions) this._currentStepActions = [];
            this._currentStepActions.push(c);
        }
        return id;
    }

    _handleAxisBalancing(c) {
        const mirrorType = Math.floor(Math.random() * 3); // 0: X, 1: Y, 2: Both
        let flipX = (mirrorType === 0 || mirrorType === 2), flipY = (mirrorType === 1 || mirrorType === 2);
        let targetX = flipX ? -c.x - c.w : c.x, targetY = flipY ? -c.y - c.h : c.y;
        const candidate = { ...c, x: targetX, y: targetY, isMirroredSpawn: true };
        if (this._validateCandidate(candidate)) { this._commitCandidate(candidate); return; }
        const searchRange = 5, attempts = [];
        for (let dy = -searchRange; dy <= searchRange; dy++) {
            for (let dx = -searchRange; dx <= searchRange; dx++) {
                if (dx === 0 && dy === 0) continue;
                attempts.push({ x: targetX + dx, y: targetY + dy, dist: Math.abs(dx) + Math.abs(dy) });
            }
        }
        attempts.sort((a, b) => a.dist - b.dist);
        for (const att of attempts) {
            const searchCandidate = { ...candidate, x: att.x, y: att.y };
            if (this._validateCandidate(searchCandidate)) { this._commitCandidate(searchCandidate); return; }
        }
        const anchors = this.activeBlocks.filter(b => b.layer === c.layer);
        if (anchors.length > 0) {
            Utils.shuffle(anchors);
            for (let i = 0; i < Math.min(10, anchors.length); i++) {
                const a = anchors[i];
                const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
                Utils.shuffle(dirs);
                for (const d of dirs) {
                    let tx = (d.dx === 1) ? a.x + a.w : (d.dx === -1 ? a.x - c.w : a.x);
                    let ty = (d.dy === 1) ? a.y + a.h : (d.dy === -1 ? a.y - c.h : a.y);
                    const finalAttempt = { ...candidate, x: tx, y: ty };
                    if (this._validateCandidate(finalAttempt)) { this._commitCandidate(finalAttempt); return; }
                }
            }
        }
    }

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, source = null) {
        if (source && typeof source === 'string' && this.growthPool) {
            const b = this.growthPool.get(source);
            if (b && b.bias === 'wider') {
                if (w === 1) w = 2 + Math.floor(Math.random() * 2);
                if (h === 1) h = 2 + Math.floor(Math.random() * 2);
            }
        }
        const candidate = {
            x, y, w, h, layer,
            isShifter, expireFrames, skipConnectivity, allowInternal,
            suppressFades, isMirroredSpawn, bypassOccupancy,
            bypassSpatial: skipConnectivity,
            source: source
        };
        return this._proposeCandidate(candidate);
    }

    _revertFrontier(ox, oy, dx, dy, layer, chance, branchId) {
        if (this.finishedBranches.has(branchId)) return false;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;
        if (layer <= minL || Math.random() > chance) return false;
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        let tx = ox, ty = oy, lastOccupied = null;
        const isOcc = (l, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return false;
            return this.layerGrids[l][gy * w + gx] !== -1;
        };
        while (true) {
            const ntx = tx + dx, nty = ty + dy;
            if (!isOcc(layer, ntx, nty)) break;
            tx = ntx; ty = nty; lastOccupied = { x: tx, y: ty };
            if (Math.abs(tx) > w || Math.abs(ty) > h) break;
        }
        if (lastOccupied && (lastOccupied.x !== 0 || lastOccupied.y !== 0)) {
            if (isOcc(0, lastOccupied.x, lastOccupied.y)) return false;
            this.maskOps.push({ type: 'removeBlock', x1: lastOccupied.x, y1: lastOccupied.y, x2: lastOccupied.x, y2: lastOccupied.y, layer: layer, startFrame: this.animFrame, fade: false });
            this.activeBlocks = this.activeBlocks.filter(b => !(b.x === lastOccupied.x && b.y === lastOccupied.y && b.layer === layer));
            this.layerGrids[layer][(cy + lastOccupied.y) * w + (cx + lastOccupied.x)] = -1;
            this._gridsDirty = true;
            return true;
        }
        return false;
    }

    _syncSubLayers() {
        const s = this.c.state;
        const pref = this.configPrefix;
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        
        if (!this._getGenConfig('EnableSyncSubLayers') && !usePromotion) return;
        if (this._syncFrame === this.animFrame) return;
        if (this._lastSyncOpCount === this.maskOps.length) return;
        this._lastSyncOpCount = this.maskOps.length;
        this._syncFrame = this.animFrame;
        const maxLayer = this._getMaxLayer();
        if (maxLayer < 1) return;
        const w = this.logicGridW, h = this.logicGridH, l0Grid = this.layerGrids[0];
        if (!l0Grid) return;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const syncGrid = this._getBuffer('syncGrid', w * h, Uint8Array);
        syncGrid.fill(0);
        for (let i = 0; i < l0Grid.length; i++) if (l0Grid[i] !== -1) syncGrid[i] = 1;
        const rects = [];
        for (let gy = 0; gy < h; gy++) {
            const rowOffBase = gy * w;
            for (let gx = 0; gx < w; gx++) {
                if (syncGrid[rowOffBase + gx] === 1) {
                    let rw = 0; while (gx + rw < w && syncGrid[rowOffBase + gx + rw] === 1) rw++;
                    let rh = 1;
                    while (gy + rh < h) {
                        let lineFull = true;
                        const targetRowOff = (gy + rh) * w;
                        for (let ix = 0; ix < rw; ix++) if (syncGrid[targetRowOff + gx + ix] !== 1) { lineFull = false; break; }
                        if (!lineFull) break;
                        rh++;
                    }
                    rects.push({ x: gx - cx, y: gy - cy, w: rw, h: rh });
                    for (let iy = 0; iy < rh; iy++) {
                        const markRowOff = (gy + iy) * w;
                        for (let ix = 0; ix < rw; ix++) syncGrid[markRowOff + gx + ix] = 0;
                    }
                }
            }
        }
        for (const r of rects) {
            const rx = cx + r.x, ry = cy + r.y;
            for (let l = 1; l <= maxLayer; l++) {
                const targetGrid = this.layerGrids[l];
                let fullyCovered = true;
                for (let iy = 0; iy < r.h; iy++) {
                    const rowOff = (ry + iy) * w;
                    for (let ix = 0; ix < r.w; ix++) if (targetGrid[rowOff + rx + ix] === -1) { fullyCovered = false; break; }
                    if (!fullyCovered) break;
                }
                if (!fullyCovered) this._spawnBlock(r.x, r.y, r.w, r.h, l, false, 0, true, true, true, true, true);
            }
        }
    }

    _updateInternalLogicGrid() {
        if (!this.logicGridW || !this.logicGridH) return;
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        const w = this.logicGridW, h = this.logicGridH;
        if (this._gridsDirty) {
            this.logicGrid.fill(0);
            for (let i = 0; i < this.activeBlocks.length; i++) {
                const b = this.activeBlocks[i];
                const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
                const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
                for (let gy = y1; gy <= y2; gy++) {
                    const rowOff = gy * w;
                    for (let gx = x1; gx <= x2; gx++) this.logicGrid[rowOff + gx] = 1;
                }
            }
            this._lastProcessedBlockCount = this.activeBlocks.length;
        } else {
            const startIdx = this._lastProcessedBlockCount || 0;
            if (startIdx < this.activeBlocks.length) {
                for (let i = startIdx; i < this.activeBlocks.length; i++) {
                    const b = this.activeBlocks[i];
                    const x1 = Math.max(0, cx + b.x), x2 = Math.min(w - 1, cx + b.x + b.w - 1);
                    const y1 = Math.max(0, cy + b.y), y2 = Math.min(h - 1, cy + b.y + b.h - 1);
                    for (let gy = y1; gy <= y2; gy++) {
                        const rowOff = gy * w;
                        for (let gx = x1; gx <= x2; gx++) this.logicGrid[rowOff + gx] = 1;
                    }
                }
                this._lastProcessedBlockCount = this.activeBlocks.length;
            }
        }
    }

    _spawnBlockCore(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, invisible = false, source = null) {
        const bs = this.getBlockSize();
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        if (!blocksX || !blocksY) return -1;

        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        // 1. Grid Boundary Constraint: Logic Grid Bounds
        const wLimit = Math.floor(blocksX / 2);
        const hLimit = Math.floor(blocksY / 2);

        if (cx + x < 0 || cx + x + w > blocksX || cy + y < 0 || cy + y + h > blocksY) {
            // Allow nudge/mirror to push things slightly further if logic grid allows, 
            // but generally restrict to logic grid boundaries.
            if (!isShifter && !isMirroredSpawn) return -1;
        }

        const startX = cx + x;
        const startY = cy + y;
        const minX = Math.max(0, startX);
        const maxX = Math.min(blocksX - 1, startX + w - 1);
        const minY = Math.max(0, startY);
        const maxY = Math.min(blocksY - 1, startY + h - 1);

        if (minX > maxX || minY > maxY) return -1; // Out of logic grid entirely

        // 2. Enforce Strict Layer-Specific Connectivity (Grid-Based Optimization)
        if (!skipConnectivity && !this.debugMode) {
             let connected = false;
             let overlapArea = 0;
             const targetGrid = this.layerGrids[layer];
             
             if (targetGrid) {
                 // Check overlap and orthogonal adjacency in one pass (O(area))
                 for (let gy = minY; gy <= maxY; gy++) {
                     const rowOff = gy * blocksX;
                     for (let gx = minX; gx <= maxX; gx++) {
                         if (targetGrid[rowOff + gx] !== -1) {
                             overlapArea++;
                             connected = true; 
                         }
                     }
                 }
                 
                 // If no overlap, check orthogonal neighbors (N,S,E,W)
                 if (!connected) {
                     // North
                     if (minY > 0) {
                         const rowOff = (minY - 1) * blocksX;
                         for (let gx = minX; gx <= maxX; gx++) if (targetGrid[rowOff + gx] !== -1) { connected = true; break; }
                     }
                     // South
                     if (!connected && maxY < blocksY - 1) {
                         const rowOff = (maxY + 1) * blocksX;
                         for (let gx = minX; gx <= maxX; gx++) if (targetGrid[rowOff + gx] !== -1) { connected = true; break; }
                     }
                     // West
                     if (!connected && minX > 0) {
                         for (let gy = minY; gy <= maxY; gy++) if (targetGrid[gy * blocksX + (minX - 1)] !== -1) { connected = true; break; }
                     }
                     // East
                     if (!connected && maxX < blocksX - 1) {
                         for (let gy = minY; gy <= maxY; gy++) if (targetGrid[gy * blocksX + (maxX + 1)] !== -1) { connected = true; break; }
                     }
                 }
             }

             if (!connected) return -1; 
             
             // Prevent internal stacking if not allowed
             if (!isShifter && !allowInternal && overlapArea >= (w * h)) return -1; 
        }

        // 4. Occupancy and Logic Grid Update (Merged Loops)
        if (this._stepOccupancy && !bypassOccupancy) {
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    if (this._stepOccupancy[rowOff + gx] === 1) return -1;
                }
            }
            // Mark occupancy
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    this._stepOccupancy[rowOff + gx] = 1;
                }
            }
        }

        if (this.logicGrid) {
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    this.logicGrid[rowOff + gx] = 1;
                }
            }
        }

        // Principle #4: Disable spawning on Layer 0 if promotion is enabled
        // EXCEPT if it's a promotion/forced spawn (indicated by bypassOccupancy)
        if (!bypassOccupancy && layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'))) {
             return -1;
        }

        const id = this.nextBlockId++;
        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;

        let isNewTerritory = false;
        const targetGrid = this.layerGrids[layer];
        if (targetGrid) {
            for (let gy = minY; gy <= maxY; gy++) {
                const rowOff = gy * blocksX;
                for (let gx = minX; gx <= maxX; gx++) {
                    if (targetGrid[rowOff + gx] === -1) {
                        isNewTerritory = true;
                        break;
                    }
                }
                if (isNewTerritory) break;
            }
        } else {
            isNewTerritory = true;
        }

        // Define op object early for all code paths that reference it
        const op = {
            type: 'addSmart',
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            expireFrame: (expireFrames > 0) ? this.animFrame + expireFrames : null,
            layer: layer,
            blockId: id,
            isShifter: isShifter,
            fade: !suppressFades,
            invisible: invisible,
            source: source
        };
        if (!isNewTerritory) {
            op.type = 'addRect';
        }

        const b = {
            x, y, w, h,
            startFrame: this.animFrame,
            startPhase: this.expansionPhase,
            layer, id, isShifter,
            dist: Math.abs(x - ox) + Math.abs(y - oy),
            invisible: invisible, // Record for local state
            stepAge: 0,
            source: source
        };
        if (expireFrames > 0) b.expireFrame = this.animFrame + expireFrames;
        this.activeBlocks.push(b);

        if (isNewTerritory) {
            this.maskOps.push(op);
        }

        // Record to sequence for Editor/Step support
        const isRecording = (this.manualStep) && this.sequence && !this.isReconstructing;
        if (isRecording) {
            // Update Generator Origin to follow manual placement for this effect type
            if (this.name === "QuantizedBlockGenerator" || this.getConfig('GeneratorTakeover')) {
                this.behaviorState.genOriginX = x;
                this.behaviorState.genOriginY = y;
                // Clear seed schedule to force re-alignment to new focal point
                this.behaviorState.seedSchedule = null;
            }

            const targetIdx = Math.max(0, this.expansionPhase - 1);
            if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
            const seqOp = {
                op: (w === 1 && h === 1) ? 'addSmart' : 'addRect',
                args: (w === 1 && h === 1) ? [x, y, x, y, layer, 0, !op.fade] : [x, y, x + w - 1, y + h - 1, layer, 0, !op.fade],
                layer: layer,
                invisible: invisible // Record in sequence too
            };
            this.sequence[targetIdx].push(seqOp);
        }
        
        this._writeToGrid(x, y, w, h, (op.fade === false ? -1000 : this.animFrame), layer);

        return id;
        }
    _writeToGrid(x, y, w, h, value, layer = 0) {
        if (!this.renderGrid || !this.layerGrids[layer]) return;
        
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const minX = Math.max(0, cx + x);
        const maxX = Math.min(blocksX - 1, cx + x + w - 1);
        const minY = Math.max(0, cy + y);
        const maxY = Math.min(blocksY - 1, cy + y + h - 1);
        
        if (minX > maxX || minY > maxY) return;

        // Optimization: During reconstruction, we don't need to write to the grid 
        // cell-by-cell because _updateRenderGridLogic will perform a full 
        // composition pass at the end of the jump.
        if (this.isReconstructing) {
            this._gridsDirty = true;
            return;
        }

        const targetGrid = this.layerGrids[layer];
        for (let gy = minY; gy <= maxY; gy++) {
            const rowOff = gy * blocksX;
            for (let bx = minX; bx <= maxX; bx++) {
                const idx = rowOff + bx;
                targetGrid[idx] = value;
                
            }
        }
        
        this._gridsDirty = true;
        this._outsideMapDirty = true;
    }

    _nudge(x, y, w, h, face, layer = 0, multiLayer = false) {
        const bs = this.getBlockSize();
        const now = this.animFrame;
        const bx = this.logicGridW, by = this.logicGridH;
        const cx = Math.floor(bx / 2), cy = Math.floor(by / 2);

        let axis = 'X', dir = 1;
        if (face) {
            const f = face.toUpperCase();
            if (f === 'N') { axis = 'Y'; dir = -1; }
            else if (f === 'S') { axis = 'Y'; dir = 1; }
            else if (f === 'E') { axis = 'X'; dir = 1; }
            else if (f === 'W') { axis = 'X'; dir = -1; }
        }
        // Principle #5: Disable starting nudges for Layer 0 when promotion is enabled
        if (layer === 0 && (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'))) {
             return false;
        }

        const shiftAmt = (axis === 'X' ? w : h);

        // Determine which layers are affected.
        // ML Nudge affects 0, 1, and 2 if multiLayer is true.
        const targetLayers = (multiLayer) ? [0, 1, 2] : [layer];
        const targetLayersSet = new Set(targetLayers);

        // 1. Identify and Shift blocks across all target layers
        const shiftedBlocks = [];
        for (const b of this.activeBlocks) {
            if (!targetLayersSet.has(b.layer)) continue;

            let shouldMove = false;
            if (axis === 'X') {
                const laneMatch = (b.y >= y && b.y < y + h);
                const posMatch = (dir > 0) ? (b.x >= x) : (b.x + b.w - 1 <= x + w - 1);
                if (laneMatch && posMatch) shouldMove = true;
            } else {
                const laneMatch = (b.x >= x && b.x < x + w);
                const posMatch = (dir > 0) ? (b.y >= y) : (b.y + b.h - 1 <= y + h - 1);
                if (laneMatch && posMatch) shouldMove = true;
            }
            if (shouldMove) {
                shiftedBlocks.push({ b, oldX: b.x, oldY: b.y, oldW: b.w, oldH: b.h, start: b.startFrame, layer: b.layer });
                if (axis === 'X') b.x += (dir * shiftAmt);
                else b.y += (dir * shiftAmt);
            }
        }

        // 2. Synchronize shifts with maskOps (Addition-Only for continuous structure)
        for (const m of shiftedBlocks) {
            // Record addition at new position
            this.maskOps.push({ 
                type: 'addSmart', 
                x1: m.b.x, y1: m.b.y, x2: m.b.x + m.b.w - 1, y2: m.b.y + m.b.h - 1, 
                startFrame: m.start, startPhase: this.expansionPhase, 
                layer: m.layer,
                fade: false
            });

            // Fix: Check if old position is already covered on this layer before spawning replacement
            // This prevents exponential growth of activeBlocks/maskOps during repeated nudges
            const oldIdx = (cy + m.oldY) * bx + (cx + m.oldX);
            if (this.layerGrids[m.layer] && this.layerGrids[m.layer][oldIdx] === -1) {
                this._spawnBlock(m.oldX, m.oldY, m.oldW, m.oldH, m.layer, false, 0, true, true, true, false, true);
            }
        }

        // 3. Add the SOURCE REPLACEMENT blocks at the original origin (x, y) for all target layers
        let success = false;
        for (const l of targetLayers) {
            if (this._spawnBlock(x, y, w, h, l, false, 0, true, true, true, false, true) !== -1) {
                success = true;
            }
        }

        if (success) {
            // Record to sequence for Editor/Step support (ONLY if not currently reconstructing)
            if (this.manualStep && this.sequence && !this.isReconstructing) {
                const targetIdx = Math.max(0, this.expansionPhase - 1);
                if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
                this.sequence[targetIdx].push({ 
                    op: multiLayer ? 'nudgeML' : 'nudge', 
                    args: [x, y, w, h, face], 
                    layer: layer 
                });
            }

            this._log(`Nudge: Solid Shifted ${shiftedBlocks.length} blocks across layers [${targetLayers.join(',')}], continuous mass preserved.`);
            this._gridsDirty = true;
            this._maskDirty = true;
            return true;
        }
        return false;
    }

    _nudgeBlock(block, dx, dy) {
        if (!block) return false;
        let face = 'N';
        if (dx === 1) face = 'E';
        else if (dx === -1) face = 'W';
        else if (dy === 1) face = 'S';
        else if (dy === -1) face = 'N';
        
        // _nudge already contains anchoring and occupancy checks
        // Default behavior: ML nudge for layer 0, SL nudge for others
        return this._nudge(block.x, block.y, block.w, block.h, face, block.layer, block.layer === 0);
    }

    _blockShift(direction, amount, startCoords, targetLayer = 0) {
        if (!this.renderGrid) return false;
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        let dx = 0, dy = 0, scanX = false;
        if (direction === 'N') { dy = -1; scanX = false; }
        else if (direction === 'S') { dy = 1; scanX = false; }
        else if (direction === 'E') { dx = 1; scanX = true; }
        else if (direction === 'W') { dx = -1; scanX = true; }
        const rowY = startCoords.y, colX = startCoords.x;
        let currentRelX = scanX ? 0 : colX, currentRelY = scanX ? rowY : 0;
        let furthestDist = -1; const potentialGaps = [];
        const maxDist = Math.max(w, h);
        for (let d = 0; d < maxDist; d++) {
            const tx = currentRelX + (scanX ? d * dx : 0), ty = currentRelY + (scanX ? 0 : d * dy);
            const gx = cx + tx, gy = cy + ty;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) break;
            const idx = gy * w + gx;
            if (this.layerGrids[targetLayer] && this.layerGrids[targetLayer][idx] !== -1) furthestDist = d;
            else potentialGaps.push({x: tx, y: ty, d: d});
        }
        let success = false;
        for (const gap of potentialGaps) {
            if (gap.d < furthestDist) {
                if (this._spawnBlock(gap.x, gap.y, 1, 1, targetLayer, false, 0, false, true, true) !== -1) success = true; 
            }
        }
        let startExt = furthestDist + 1;
        for (let i = 0; i < amount; i++) {
            const d = startExt + i, tx = currentRelX + (scanX ? d * dx : 0), ty = currentRelY + (scanX ? 0 : d * dy);
            const gx = cx + tx, gy = cy + ty;
            if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                if (this._spawnBlock(tx, ty, 1, 1, targetLayer, false, 0, false, false, true) !== -1) success = true;
            }
        }
        return success;
    }

    flattenLayers(targetLayers, selectionRect, stepIndex) {
        if (!this.sequence) return 0;
        const layers = targetLayers || [1, 2];
        const layerSet = new Set(layers);
        let count = 0;
        const processStep = (step) => {
            if (!step || !Array.isArray(step)) return;
            for (const opObj of step) {
                let op, args;
                if (Array.isArray(opObj)) {
                    continue; 
                } else {
                    op = opObj;
                    args = op.args;
                }
                if (op.layer && layerSet.has(op.layer)) {
                    if (selectionRect) {
                        const cx = Math.floor(this.logicGridW / 2);
                        const cy = Math.floor(this.logicGridH / 2);
                        let opX1, opY1, opX2, opY2;
                        if (op.op === 'add' || op.op === 'removeBlock' || op.op === 'addSmart') {
                            opX1 = cx + args[0]; opY1 = cy + args[1];
                            opX2 = opX1; opY2 = opY1;
                        } else if (op.op === 'addRect') {
                            opX1 = cx + args[0]; opY1 = cy + args[1];
                            opX2 = cx + args[2]; opY2 = cy + args[3];
                        } else {
                            continue; 
                        }
                        const minX = Math.min(opX1, opX2);
                        const maxX = Math.max(opX1, opX2);
                        const minY = Math.min(opY1, opY2);
                        const maxY = Math.max(opY1, opY2);
                        const sMinX = selectionRect.x;
                        const sMaxX = selectionRect.x + selectionRect.w;
                        const sMinY = selectionRect.y;
                        const sMaxY = selectionRect.y + selectionRect.h;
                        if (maxX < sMinX || minX > sMaxX || maxY < sMinY || minY > sMaxY) {
                            continue; 
                        }
                    }
                    op.layer = 0;
                    count++;
                }
            }
        };
        if (stepIndex !== undefined && stepIndex >= 0) {
            if (stepIndex < this.sequence.length) {
                processStep(this.sequence[stepIndex]);
            }
        } else {
            for (const step of this.sequence) {
                processStep(step);
            }
        }
        return count;
    }

    mergeBlocksAtStep(blocks, stepIndex) {
        if (!this.sequence || stepIndex < 0 || stepIndex >= this.sequence.length) return 0;
        if (!blocks || blocks.length === 0) return 0;
        const step = this.sequence[stepIndex];
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const w = this.logicGridW;
        let count = 0;
        for (const pt of blocks) {
            const x = pt.x;
            const y = pt.y;
            if (x < 0 || x >= this.logicGridW || y < 0 || y >= this.logicGridH) continue;
            const idx = y * w + x;
            for (let l = 1; l <= 2; l++) {
                const grid = this.layerGrids[l];
                if (grid && grid[idx] !== -1) {
                    const rx = x - cx;
                    const ry = y - cy;
                    step.push({ op: 'removeBlock', args: [rx, ry], layer: l });
                    step.push({ op: 'add', args: [rx, ry], layer: 0 });
                    count++;
                }
            }
        }
        return count;
    }

    mergeSelectionAtStep(selectionRect, stepIndex) {
        if (!this.sequence || stepIndex < 0 || stepIndex >= this.sequence.length) return 0;
        if (!selectionRect) return 0;
        const step = this.sequence[stepIndex];
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const r = selectionRect;
        const w = this.logicGridW;
        let count = 0;
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                if (x < 0 || x >= this.logicGridW || y < 0 || y >= this.logicGridH) continue;
                const idx = y * w + x;
                for (let l = 1; l <= 2; l++) {
                    const grid = this.layerGrids[l];
                    if (grid && grid[idx] !== -1) {
                        const rx = x - cx;
                        const ry = y - cy;
                        step.push({ op: 'removeBlock', args: [rx, ry], layer: l });
                        step.push({ op: 'add', args: [rx, ry], layer: 0 });
                        count++;
                    }
                }
            }
        }
        return count;
    }

    getActiveIndices() {
        return this.activeIndices;
    }

    _isProceduralFinished() {
        if (!this.renderGrid) return true;
        
        // 1. Check axis points (fast)
        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        
        const check = (x, y) => {
            if (x < 0 || x >= w || y < 0 || y >= h) return true;
            return this.renderGrid[y * w + x] !== -1;
        };

        const hitN = check(cx, 0);
        const hitS = check(cx, h - 1);
        const hitW = check(0, cy);
        const hitE = check(w - 1, cy);

        // 2. If axes reached, perform full visible coverage check
        if (hitN && hitS && hitW && hitE) {
            return this._isCanvasFullyCovered();
        }
        
        return false;
    }

    _snapToEdges() {
        const r = this._lastCoverageRect;
        if (!r) return;
        const { startX, endX, startY, endY } = r;
        const visW = endX - startX;
        const visH = endY - startY;
        if (visW <= 0 || visH <= 0) return;

        const w = this.logicGridW, h = this.logicGridH;
        const rg = this.renderGrid;
        if (!rg) return;

        const threshold = 0.6;
        const maxInward = 3;
        const layer = this._getMinLayer();
        const cx = this._gridCX, cy = this._gridCY;

        const isEmpty = (gx, gy) => {
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return false;
            return rg[gy * w + gx] === -1;
        };

        const fillCell = (gx, gy) => {
            const relX = gx - cx, relY = gy - cy;
            this._spawnBlock(relX, relY, 1, 1, layer, false, 0, true, true, true, false, true);
        };

        // North edge, sweeping inward (increasing y)
        for (let d = 0; d < maxInward; d++) {
            const gy = startY + d;
            if (gy >= endY) break;
            let filled = 0, total = 0;
            for (let gx = startX; gx < endX; gx++) {
                total++;
                if (!isEmpty(gx, gy)) filled++;
            }
            if (total === 0 || filled / total < threshold) break;
            for (let gx = startX; gx < endX; gx++) {
                if (isEmpty(gx, gy)) fillCell(gx, gy);
            }
        }

        // South edge, sweeping inward (decreasing y)
        for (let d = 0; d < maxInward; d++) {
            const gy = endY - 1 - d;
            if (gy < startY) break;
            let filled = 0, total = 0;
            for (let gx = startX; gx < endX; gx++) {
                total++;
                if (!isEmpty(gx, gy)) filled++;
            }
            if (total === 0 || filled / total < threshold) break;
            for (let gx = startX; gx < endX; gx++) {
                if (isEmpty(gx, gy)) fillCell(gx, gy);
            }
        }

        // West edge, sweeping inward (increasing x)
        for (let d = 0; d < maxInward; d++) {
            const gx = startX + d;
            if (gx >= endX) break;
            let filled = 0, total = 0;
            for (let gy = startY; gy < endY; gy++) {
                total++;
                if (!isEmpty(gx, gy)) filled++;
            }
            if (total === 0 || filled / total < threshold) break;
            for (let gy = startY; gy < endY; gy++) {
                if (isEmpty(gx, gy)) fillCell(gx, gy);
            }
        }

        // East edge, sweeping inward (decreasing x)
        for (let d = 0; d < maxInward; d++) {
            const gx = endX - 1 - d;
            if (gx < startX) break;
            let filled = 0, total = 0;
            for (let gy = startY; gy < endY; gy++) {
                total++;
                if (!isEmpty(gx, gy)) filled++;
            }
            if (total === 0 || filled / total < threshold) break;
            for (let gy = startY; gy < endY; gy++) {
                if (isEmpty(gx, gy)) fillCell(gx, gy);
            }
        }

        // Corner fill: sweep small corner regions that edge passes may miss
        const cornerSize = Math.min(maxInward, 3);
        for (const [cStartX, cStartY] of [
            [startX, startY],                          // NW
            [endX - cornerSize, startY],               // NE
            [startX, endY - cornerSize],               // SW
            [endX - cornerSize, endY - cornerSize],    // SE
        ]) {
            for (let gy = cStartY; gy < Math.min(cStartY + cornerSize, endY); gy++) {
                for (let gx = Math.max(cStartX, startX); gx < Math.min(cStartX + cornerSize, endX); gx++) {
                    if (isEmpty(gx, gy)) fillCell(gx, gy);
                }
            }
        }
    }

    _getBiasedCoordinate(minL, maxL, size, pStatus, axis) {
        const centerReached = (axis === 'X') ? (pStatus.E && pStatus.W) : (pStatus.N && pStatus.S);
        if (!centerReached && Math.random() < 0.8) {
            const range = 2;
            const low = Math.max(minL, -range);
            const high = Math.min(maxL - size, range);
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }
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
            for (let x = startX; x < endX; x++) if (grid[startY * w + x] === -1) status.N = false;
            const lastY = endY - 1;
            for (let x = startX; x < endX; x++) if (grid[lastY * w + x] === -1) status.S = false;
            for (let y = startY; y < endY; y++) if (grid[y * w + startX] === -1) status.W = false;
            const lastX = endX - 1;
            for (let y = startY; y < endY; y++) if (grid[y * w + lastX] === -1) status.E = false;
        };
        for (let i = 0; i < 3; i++) check(i);
        return status;
    }

    _mergeLayer1(maxCycle = -1) {
        const now = this.animFrame;
        const blocksToMerge = this.activeBlocks.filter(b => 
            b.layer === 1 && (maxCycle === -1 || b.spawnCycle === undefined || b.spawnCycle <= maxCycle)
        );
        if (blocksToMerge.length === 0) return;
        for (const b of blocksToMerge) {
            this.maskOps.push({ type: 'removeBlock', x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, startFrame: now, layer: 1, fade: false });
            this.maskOps.push({ type: 'add', x1: b.x, y1: b.y, x2: b.x + b.w - 1, y2: b.y + b.h - 1, startFrame: now, layer: 0, blockId: b.id });
            b.layer = 0;
            this._writeToGrid(b.x, b.y, b.w, b.h, now, 0); 
            this._writeToGrid(b.x, b.y, b.w, b.h, -1, 1);  
        }
        this._lastProcessedOpIndex = 0;
        this._maskDirty = true;
    }

    _getScaledConfig(key, defaultValue) {
        const val = this.getConfig(key);
        const finalVal = (val !== undefined) ? val : defaultValue;

        if (this.getConfig('EnableScaledGrowth') === true) {
            // Calculate current mass percentage
            let filled = 0;
            const lg = this.logicGrid;
            if (lg) {
                for (let i = 0; i < lg.length; i++) if (lg[i] === 1) filled++;
                const massPercent = filled / lg.length;

                const isMin = key === 'MinBlockWidth' || key === 'MinBlockHeight';
                const isMax = key === 'MaxBlockWidth' || key === 'MaxBlockHeight';

                if (isMin || isMax) {
                    // Initial Phase (Mass < 5%): Max 2, Min 1
                    if (massPercent < 0.05) {
                        return isMax ? Math.min(finalVal, 2) : Math.min(finalVal, 1);
                    } 
                    // Growth Phase (5% - 25%): Interpolate
                    else if (massPercent < 0.25) {
                        const t = (massPercent - 0.05) / 0.20;
                        if (isMax) return Math.min(finalVal, Math.round(2 + (finalVal - 2) * t));
                        return Math.min(finalVal, Math.round(1 + (finalVal - 1) * t));
                    }
                }
            }
        }
        return finalVal;
    }

    _checkNoOverlap(x, y, w, h, layer = 0, checkVacated = true) {
        if (!this.logicGridW || !this.logicGridH || !this.logicGrid) return false;
        
        const cx = Math.floor(this.logicGridW / 2), cy = Math.floor(this.logicGridH / 2);
        const gx1 = cx + x, gy1 = cy + y;
        const gx2 = gx1 + w - 1, gy2 = gy1 + h - 1;

        // Bounds check
        if (gx1 < 0 || gx2 >= this.logicGridW || gy1 < 0 || gy2 >= this.logicGridH) return false;

        // Grid-based overlap check (All Layers via logicGrid)
        const remGrid = checkVacated ? this.removalGrids[layer] : null;
        const cooldown = 3;

        for (let gy = gy1; gy <= gy2; gy++) {
            const rowOff = gy * this.logicGridW;
            for (let gx = gx1; gx <= gx2; gx++) {
                if (this.logicGrid[rowOff + gx] === 1) return false;
                if (remGrid) {
                    const remPhase = remGrid[rowOff + gx];
                    if (remPhase !== -1 && this.expansionPhase - remPhase < cooldown) return false;
                }
            }
        }

        return true;
    }

    _updateOutsideMap() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;

        const size = w * h;
        if (!this._outsideMap || this._outsideMap.length !== size) {
            this._outsideMap = new Uint8Array(size);
        }
        const status = this._outsideMap;
        status.fill(0);

        if (!this._bfsQueue || this._bfsQueue.length < size) {
            this._bfsQueue = new Int32Array(size);
        }
        const queue = this._bfsQueue;
        let head = 0, tail = 0;

        const add = (idx) => {
            if (status[idx] === 0 && this.logicGrid[idx] === 0) { 
                status[idx] = 1;
                queue[tail++] = idx;
            }
        };

        // Seed BFS from logic grid boundaries
        for (let x = 0; x < w; x++) { 
            add(x); 
            add((h - 1) * w + x); 
        }
        for (let y = 1; y < h - 1; y++) {
            add(y * w); 
            add(y * w + (w - 1)); 
        }

        while (head < tail) {
            const idx = queue[head++];
            const cx = idx % w, cy = (idx / w) | 0;
            if (cy > 0) add(idx - w); 
            if (cy < h - 1) add(idx + w);
            if (cx > 0) add(idx - 1); 
            if (cx < w - 1) add(idx + 1);
        }
    }

    _checkNoHole(tx, ty, tw, th) {
        const w = this.logicGridW, h = this.logicGridH, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        if (this._outsideMapDirty || !this._outsideMap) {
            this._updateOutsideMap();
            this._outsideMapDirty = false;
        }
        const status = this._outsideMap;

        const candidates = [];
        for (let x = tx - 1; x <= tx + tw; x++) { candidates.push([x, ty - 1], [x, ty + th]); }
        for (let y = ty; y < ty + th; y++) { candidates.push([tx - 1, y], [tx + tw, y]); }
        
        for (const [nx, ny] of candidates) {
            const gx = nx + cx, gy = ny + cy;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
            
            // If the cell is empty and NOT reachable from the boundary (outside), it is an enclosed hole
            if (this.logicGrid[gy * w + gx] === 0 && status[gy * w + gx] === 0) {
                return false;
            }
        }
        return true;
    }

    _shoveOtherLayers(x, y, w, h) {
        // Simple shoving: if a block in Layer 1 overlaps, nudge it
        const l1 = this.layerGrids[1];
        if (!l1) return;

        const lgW = this.logicGridW;
        const cx = Math.floor(lgW / 2), cy = Math.floor(this.logicGridH / 2);

        for (let ly = 0; ly < h; ly++) {
            for (let lx = 0; lx < w; lx++) {
                const gx = cx + x + lx, gy = cy + y + ly;
                if (l1[gy * lgW + gx] !== -1) {
                    // Conflict found. Find the block in Layer 1 and nudge it.
                    const block = this.activeBlocks.find(b => b.layer === 1 && 
                        gx >= cx + b.x && gx < cx + b.x + b.w && 
                        gy >= cy + b.y && gy < cy + b.y + b.h);
                    
                    if (block) {
                        // Nudge outwards from center
                        const dx = block.x > 0 ? 1 : -1;
                        const dy = block.y > 0 ? 1 : -1;
                        
                        // Pick the axis with more momentum
                        if (Math.abs(block.x) > Math.abs(block.y)) {
                            this._nudgeBlock(block, dx, 0);
                        } else {
                            this._nudgeBlock(block, 0, dy);
                        }
                    }
                }
            }
        }
    }

    _performAutoActions() {
        const getGenConfig = (key) => {
            const val = this.getConfig(key);
            if (val !== undefined) return val;
            return this.c.state[this.configPrefix + key];
        };

        const now = this.animFrame;
        const interval = 30;

        // Perform hole filler every logic step if enabled
        if (getGenConfig('HoleFillerEnabled') === true) {
            this._performHoleCleanup();
        }

        // Maintain structural integrity and connect islands on an interval or every few steps
        if (getGenConfig('EnableAutoConnectIslands') === true && now % interval === 15) {
            this._connectIslands();
        }
    }

    /**
     * More robust and aggressive hole filling logic that handles all active layers simultaneously.
     * Seeds BFS from the edges of the logic grid (edges of the world) to find enclosed spaces.
     */
    _performHoleCleanup() {
        if (!this.logicGridW || !this.logicGridH) return;

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        // Build composite occupancy map across all layers
        const compositeMap = this._getBuffer('compositeMap', w * h, Int8Array);
        compositeMap.fill(-1);
        const minL = this._getMinLayer();
        const maxL = this._getMaxLayer();
        for (let l = minL; l <= maxL; l++) {
            const grid = this.layerGrids[l];
            if (!grid) continue;
            for (let i = 0; i < grid.length; i++) if (grid[i] !== -1) compositeMap[i] = 1;
        }

        // 1. BFS from the LOGIC GRID Perimeter to find the "Outside" empty area
        const outsideMap = this._getBuffer('connectedMap', w * h, Uint8Array);
        outsideMap.fill(0);
        const queue = this._getBuffer('queue', w * h, Int32Array);
        let head = 0, tail = 0;

        const add = (gx, gy) => {
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return;
            const idx = gy * w + gx;
            if (outsideMap[idx] === 0 && compositeMap[idx] === -1) {
                outsideMap[idx] = 1;
                queue[tail++] = idx;
            }
        };

        // Seed BFS from the 4 edges of the world
        for (let gx = 0; gx < w; gx++) { add(gx, 0); add(gx, h - 1); }
        for (let gy = 0; gy < h; gy++) { add(0, gy); add(w - 1, gy); }

        while (head < tail) {
            const idx = queue[head++];
            const cgx = idx % w, cgy = (idx / w) | 0;
            if (cgy > 0) add(cgx, cgy - 1); if (cgy < h - 1) add(cgx, cgy + 1);
            if (cgx > 0) add(cgx - 1, cgy); if (cgx < w - 1) add(cgx + 1, cgy);
        }

        // 2. Fill every enclosed empty cell (any hole of any size)
        //    Also fill "small gap" cells (3+ cardinal neighbors occupied) as inlets/dead-ends.
        let filledCount = 0;
        const maxLayer = this._getMaxLayer();
        const startL = this._getMinLayer();

        for (let gy = 1; gy < h - 1; gy++) {
            for (let gx = 1; gx < w - 1; gx++) {
                const i = gy * w + gx;
                if (compositeMap[i] !== -1) continue;

                // Enclosed: not reachable from grid boundary via empty cells
                const isEnclosed = (outsideMap[i] === 0);

                // Small gap: 3 or 4 cardinal neighbors occupied (inlets/dead-ends)
                let neighborCount = 0;
                if (compositeMap[i - 1] !== -1) neighborCount++;
                if (compositeMap[i + 1] !== -1) neighborCount++;
                if (compositeMap[i - w] !== -1) neighborCount++;
                if (compositeMap[i + w] !== -1) neighborCount++;

                if (isEnclosed || neighborCount >= 3) {
                    for (let l = startL; l <= maxLayer; l++) {
                        this._spawnBlock(gx - cx, gy - cy, 1, 1, l, false, 0, true, true, true, false, true, 'hole_filler');
                    }
                    compositeMap[i] = 1; // Mark filled so subsequent neighbor checks see it
                    filledCount++;
                }
            }
        }

        if (filledCount > 0) {
            this._gridsDirty = true;
            this._maskDirty = true;
            if (this.c.state.logErrors) this._log(`[HoleCleanup] Filled ${filledCount} cells across layers ${startL}-${maxLayer}.`);
        }
    }

    _maintainStructuralIntegrity() {
        // Now redirects to the more robust _performHoleCleanup
        this._performHoleCleanup();
    }

    _connectIslands() {
        if (!this.logicGridW || !this.logicGridH) return;
        if (this.activeBlocks.length === 0) return;

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        
        const combined = this._getBuffer('combined', w * h, Int8Array);
        combined.fill(-1);

        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                const rowOff = gy * w;
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { 
                    combined[rowOff + gx] = 1; 
                }
            }
        }

        const connectedMap = this._getBuffer('connectedMap', w * h, Uint8Array);
        connectedMap.fill(0);
        const queue = this._getBuffer('queue', w * h, Int32Array);
        let head = 0, tail = 0;

        const ox = this.behaviorState?.genOriginX ?? 0;
        const oy = this.behaviorState?.genOriginY ?? 0;
        const seedGx = cx + ox, seedGy = cy + oy;
        const startIdx = seedGy * w + seedGx;

        if (seedGx >= 0 && seedGx < w && seedGy >= 0 && seedGy < h && combined[startIdx] === 1) {
            connectedMap[startIdx] = 1;
            queue[tail++] = startIdx;
        } else {
            // Find any mainland cell if focal point isn't covered
            for(let i=0; i<w*h; i++) {
                if(combined[i] === 1) {
                    connectedMap[i] = 1;
                    queue[tail++] = i;
                    break;
                }
            }
        }
        while (head < tail) {
            const idx = queue[head++];
            const gx = idx % w, gy = (idx / w) | 0;
            const neighbors = [idx - w, idx + w, idx - 1, idx + 1];
            for (let i = 0; i < 4; i++) {
                const nIdx = neighbors[i];
                if (nIdx >= 0 && nIdx < w * h && connectedMap[nIdx] === 0 && combined[nIdx] === 1) {
                    if (i === 2 && gx === 0) continue;
                    if (i === 3 && gx === w - 1) continue;
                    connectedMap[nIdx] = 1; 
                    queue[tail++] = nIdx;
                }
            }
        }

        const islands = this.activeBlocks.filter(b => {
            const x1 = cx + b.x, y1 = cy + b.y, x2 = x1 + b.w - 1, y2 = y1 + b.h - 1;
            for (let gy = Math.max(0, y1); gy <= Math.min(h - 1, y2); gy++) {
                const rowOff = gy * w;
                for (let gx = Math.max(0, x1); gx <= Math.min(w - 1, x2); gx++) { 
                    if (connectedMap[rowOff + gx] === 1) return false; 
                }
            }
            return true;
        });

        if (islands.length === 0) return;

        // Reuse pooled buffers for per-island BFS instead of allocating per iteration
        const iQueue = this._getBuffer('islandQueue', w * h, Int32Array);
        const iVisited = this._getBuffer('islandVisited', w * h, Uint8Array);

        for (const island of islands) {
            let bestIslandPt = { x: cx + island.x, y: cy + island.y };
            let bestTargetPt = null;

            iVisited.fill(0);
            let iHead = 0, iTail = 0;

            const iStartIdx = bestIslandPt.y * w + bestIslandPt.x;
            iQueue[iTail++] = iStartIdx;
            iVisited[iStartIdx] = 1;
            
            while(iHead < iTail) {
                const idx = iQueue[iHead++];
                if (connectedMap[idx] === 1) {
                    bestTargetPt = { x: idx % w, y: (idx / w) | 0 };
                    break;
                }
                
                const gx = idx % w, gy = (idx / w) | 0;
                const neighbors = [idx - w, idx + w, idx - 1, idx + 1];
                for (let i = 0; i < 4; i++) {
                    const nIdx = neighbors[i];
                    if (nIdx >= 0 && nIdx < w * h && iVisited[nIdx] === 0) {
                        if (i === 2 && gx === 0) continue;
                        if (i === 3 && gx === w - 1) continue;
                        iVisited[nIdx] = 1;
                        iQueue[iTail++] = nIdx;
                    }
                }
                if (iTail > 2000) break; // Safety break
            }

            if (bestTargetPt) {
                let curX = bestIslandPt.x, curY = bestIslandPt.y;
                while (curX !== bestTargetPt.x || curY !== bestTargetPt.y) {
                    if (curX < bestTargetPt.x) curX++; else if (curX > bestTargetPt.x) curX--;
                    else if (curY < bestTargetPt.y) curY++; else if (curY > bestTargetPt.y) curY--;
                    
                    if (combined[curY * w + curX] === -1) {
                        this._spawnBlock(curX - cx, curY - cy, 1, 1, island.layer, false, 0, true, true, true);
                        combined[curY * w + curX] = 1;
                    }
                }
            }
        }
    }

    _isCanvasFullyCovered() {
        if (this._visibleEmptyCount === -1) {
            this._updateVisibleEmptyCount();
        }
        return this._visibleEmptyCount <= 0;
    }

    _updateExpansionStatus() {
        if (this.expansionComplete) return true;
        
        if (this._isCanvasFullyCovered()) {
            this.expansionComplete = true;
            this.onExpansionComplete();
            return true;
        }
        return false;
    }

    // =========================================================
    // V2 GENERATIVE ENGINE (Ported from BlockGenerator)
    // =========================================================

    /** Registers a sub-behavior into the growth pool. */
    registerBehavior(id, fn, options = {}) {
        this.growthPool.set(id, {
            fn: fn,
            enabled: options.enabled ?? true,
            type: options.type ?? 'pool',
            growth: options.growth ?? 'edge',
            bias: options.bias ?? 'single',
            label: options.label || id
        });
    }

    /** Enables or disables a registered sub-behavior. */
    setBehaviorFlag(id, enabled) {
        const behavior = this.growthPool.get(id);
        if (behavior) behavior.enabled = enabled;
    }

    _initBehaviors() {
        // Cache behavior closures — only create them once to avoid GC pressure
        // from recreating 4 large closures on every trigger. Closures capture 'this'
        // via 'self' so they remain valid across triggers.
        if (this._behaviorsInitialized) {
            // Refresh enabled/type/growth/bias from current config
            const bsd = this.growthPool.get('block_spawner_despawner');
            if (bsd) {
                bsd.enabled = this._getGenConfig('BlockSpawnerEnabled') ?? false;
                bsd.type = this._getGenConfig('BlockSpawnerBehaviorType') ?? 'pool';
                bsd.growth = this._getGenConfig('BlockSpawnerGrowthMode') ?? 'edge';
                bsd.bias = this._getGenConfig('BlockSpawnerSpawnBias') ?? 'single';
            }
            const sn = this.growthPool.get('spreading_nudge');
            if (sn) {
                sn.enabled = this._getGenConfig('SpreadingNudgeEnabled') ?? false;
                sn.type = this._getGenConfig('SpreadingNudgeBehaviorType') ?? 'pool';
                sn.growth = this._getGenConfig('SpreadingNudgeGrowthMode') ?? 'edge';
                sn.bias = this._getGenConfig('SpreadingNudgeSpawnBias') ?? 'single';
            }
            const sf = this.growthPool.get('shove_fill');
            if (sf) {
                sf.enabled = this._getGenConfig('ShoveFillEnabled') ?? false;
                sf.type = this._getGenConfig('ShoveFillBehaviorType') ?? 'pool';
                sf.growth = this._getGenConfig('ShoveFillGrowthMode') ?? 'edge';
                sf.bias = this._getGenConfig('ShoveFillSpawnBias') ?? 'single';
            }
            const hf = this.growthPool.get('hole_filler');
            if (hf) {
                hf.enabled = true;
                hf.type = this._getGenConfig('HoleFillerBehaviorType') ?? 'pool';
                hf.growth = this._getGenConfig('HoleFillerGrowthMode') ?? 'edge';
                hf.bias = this._getGenConfig('HoleFillerSpawnBias') ?? 'single';
            }
            const bt = this.growthPool.get('block_thicken');
            if (bt) {
                bt.enabled = this._getGenConfig('BlockThickenEnabled') ?? false;
                bt.type = this._getGenConfig('BlockThickenBehaviorType') ?? 'pool';
                bt.growth = this._getGenConfig('BlockThickenGrowthMode') ?? 'edge';
                bt.bias = this._getGenConfig('BlockThickenSpawnBias') ?? 'single';
            }
            const as = this.growthPool.get('axis_shift');
            if (as) {
                as.enabled = this._getGenConfig('AxisShiftEnabled') ?? false;
                as.type = this._getGenConfig('AxisShiftBehaviorType') ?? 'pool';
                as.growth = this._getGenConfig('AxisShiftGrowthMode') ?? 'edge';
                as.bias = this._getGenConfig('AxisShiftSpawnBias') ?? 'single';
            }
            const mn = this.growthPool.get('main_nudge');
            if (mn) {
                mn.enabled = this._getGenConfig('NudgeEnabled') !== false;
                mn.type = this._getGenConfig('NudgeBehaviorType') ?? 'pool';
                mn.growth = this._getGenConfig('NudgeGrowthMode') ?? 'spine';
                mn.bias = this._getGenConfig('NudgeSpawnBias') ?? 'single';
            }
            return;
        }
        this._behaviorsInitialized = true;
        this.growthPool.clear();
        const self = this;

        // Behavior 2: Block Spawner/Despawner (Anticipatory Growth + Volatility)
        this.registerBehavior('block_spawner_despawner', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('BlockSpawnerStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const startDelay = this._getGenConfig('BlockSpawnerStartDelay') ?? 10;
            const spawnRate  = Math.max(1, this._getGenConfig('BlockSpawnerRate') ?? 4);

            const allowed = this._getAllowedDirs(layer);

            // Recent-position tracking to prevent repetitive spawning at same locations
            if (!s.spawnerRecent) s.spawnerRecent = new Map(); // key: "x,y" → step when spawned
            // Cleanup old entries (TTL = 10 steps)
            for (const [k, spawnStep] of s.spawnerRecent) {
                if (s.step - spawnStep > 10) s.spawnerRecent.delete(k);
            }

            // 1. Spawning Logic
            if (s.step >= startDelay && (s.step - startDelay) % spawnRate === 0) {
                const maxSpawn = this._getGenConfig('BlockSpawnerCount') ?? 5;

                const needsEdge = (behavior && behavior.growth === 'edge');
                let outsideMap = null;
                if (needsEdge) {
                    outsideMap = this._computeTrueOutside(this.logicGridW, this.logicGridH);
                }

                // Collect perimeter blocks
                const perimeterBlocks = this.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;

                    // Standard Precondition: Connected to spines
                    const onYSpine = (b.x <= s.genOriginX && b.x + b.w - 1 >= s.genOriginX);
                    const onXSpine = (b.y <= s.genOriginY && b.y + b.h - 1 >= s.genOriginY);
                    const onSpine = onXSpine || onYSpine;
                    if (behavior && behavior.growth === 'spine' && !onSpine) return false;

                    // Option: Spawn from ANY perimeter block
                    let onOuterPerimeter = false;
                    if (needsEdge && outsideMap) {
                        const cx = this._gridCX, cy = this._gridCY, w = this.logicGridW;
                        const neighbors = [];
                        for (let x = b.x; x < b.x + b.w; x++) { neighbors.push({x, y: b.y - 1}, {x, y: b.y + b.h}); }
                        for (let y = b.y; y < b.y + b.h; y++) { neighbors.push({x: b.x - 1, y}, {x: b.x + b.w, y}); }

                        onOuterPerimeter = neighbors.some(n => {
                            const gx = cx + n.x, gy = cy + n.y;
                            if (gx < 0 || gx >= w || gy < 0 || gy >= this.logicGridH) return false;
                            return outsideMap[gy * w + gx] === 1;
                        });
                    }

                    if (behavior && behavior.growth === 'edge' && !onOuterPerimeter) return false;
                    if (!onSpine && !onOuterPerimeter) return false;

                    const neighbors = [
                        {x: b.x, y: b.y - 1, dir: 'N'}, {x: b.x, y: b.y + b.h, dir: 'S'}, // N, S
                        {x: b.x - 1, y: b.y, dir: 'W'}, {x: b.x + b.w, y: b.y, dir: 'E'}  // W, E
                    ];
                    // RELAXATION: A block is a candidate if it has ANY free neighbor,
                    // and we'll filter the spawn side later based on quadrants.
                    return neighbors.some(n => !this._isOccupied(n.x, n.y, layer));
                });

                if (perimeterBlocks.length > 0) {
                    // Shuffle for spawn diversity — prevents always picking the same closest parents
                    Utils.shuffle(perimeterBlocks);

                    const sizes = [
                        {w: 1, h: 1}, {w: 1, h: 2}, {w: 2, h: 1},
                        {w: 1, h: 3}, {w: 3, h: 1}
                    ];

                    let spawnedCount = 0;
                    for (let i = 0; i < maxSpawn * 2 && spawnedCount < maxSpawn; i++) {
                        const parent = perimeterBlocks[Math.floor(i / 2) % perimeterBlocks.length];
                        
                        // Determine parent's quadrant relative to spawn center
                        const pdx = parent.x - s.genOriginX, pdy = parent.y - s.genOriginY;
                        const parentQuad = Math.abs(pdx) > Math.abs(pdy) ? (pdx > 0 ? 'E' : 'W') : (pdy > 0 ? 'S' : 'N');

                        const size = sizes[Math.floor(Math.random() * sizes.length)];
                        
                        // RELAXATION: Allow any side if it's allowed OR if the parent is in an allowed quadrant (branching)
                        const availSides = ['N', 'S', 'E', 'W'].filter(d => {
                            if (!allowed) return true;
                            if (allowed.has(d)) return true;
                            if (allowed.has(parentQuad)) return true; // Branching within allowed quadrant
                            return false;
                        });

                        if (availSides.length === 0) continue;
                        const side = availSides[Math.floor(Math.random() * availSides.length)];
                        let nx, ny;

                        if (side === 'N') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y - size.h;
                        } else if (side === 'S') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y + parent.h;
                        } else if (side === 'W') {
                            nx = parent.x - size.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        } else { // E
                            nx = parent.x + parent.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        }

                        if (this.checkScreenEdge(nx, ny) || this.checkScreenEdge(nx + size.w - 1, ny + size.h - 1)) continue;

                        const minLayerCheck = this._getMinLayer();
                        const maxLayerCheck = this._getMaxLayer();
                        let isAreaFree = true;
                        for (let ly = minLayerCheck; ly <= maxLayerCheck; ly++) {
                            for (let gy = ny; gy < ny + size.h; gy++) {
                                for (let gx = nx; gx < nx + size.w; gx++) {
                                    if (this._isOccupied(gx, gy, ly)) { isAreaFree = false; break; }
                                }
                                if (!isAreaFree) break;
                            }
                            if (!isAreaFree) break;
                        }
                        if (!isAreaFree) continue;

                        // Skip positions that were recently spawned to prevent repetitive clustering
                        const posKey = nx + ',' + ny;
                        if (s.spawnerRecent.has(posKey)) continue;

                        this.actionBuffer.push({ layer: layer, fn: () => {
                            // Set skipConnectivity (8th arg) to false to enforce strict placement
                            this._spawnBlock(nx, ny, size.w, size.h, layer, false, 0, false, true, true, false, false, 'block_spawner');
                        }});
                        s.spawnerRecent.set(posKey, s.step);
                        spawnedCount++;
                    }
                }
            }

            // 2. Despawning Logic
            const despawnRate = Math.max(1, this._getGenConfig('BlockSpawnerDespawnRate') ?? 8);
            if (s.step >= startDelay && (s.step - startDelay) % despawnRate === 0) {
                const despawnCount = this._getGenConfig('BlockSpawnerDespawnCount') ?? 2;

                // Select blocks that are connected by 2 or less edges (directions)
                // RULE: Do not remove if two opposite edges are connected (e.g. N and S).
                // Blocks must be older than 8 steps to be despawn candidates (prevents spawn→despawn thrashing).
                const candidates = this.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;

                    // --- PROTECTED BLOCKS ---
                    const overlapsYSpine = (b.x <= s.genOriginX && b.x + b.w - 1 >= s.genOriginX);
                    const overlapsXSpine = (b.y <= s.genOriginY && b.y + b.h - 1 >= s.genOriginY);
                    if (overlapsXSpine || overlapsYSpine) return false;

                    if (b.stepAge > 8) return false;

                    // --- CONNECTIVITY RULES ---
                    let north = false, south = false, west = false, east = false;
                    // North Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (this._isOccupied(x, b.y - 1, layer)) { north = true; break; } }
                    // South Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (this._isOccupied(x, b.y + b.h, layer)) { south = true; break; } }
                    // West Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (this._isOccupied(b.x - 1, y, layer)) { west = true; break; } }
                    // East Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (this._isOccupied(b.x + b.w, y, layer)) { east = true; break; } }
                    
                    const count = (north?1:0) + (south?1:0) + (west?1:0) + (east?1:0);
                    if (count > 2) return false;
                    if (count === 2) {
                        if ((north && south) || (west && east)) return false; // Opposite edges (bridge/line)
                    }
                    return true;
                });
                
                if (candidates.length > 0) {
                    Utils.shuffle(candidates);
                    const toRemove = candidates.slice(0, despawnCount);
                    for (const b of toRemove) {
                        this.actionBuffer.push({ layer: layer, fn: () => {
                            this._removeBlock(b.x, b.y, b.w, b.h, b.layer, true);
                        }});
                    }
                }
            }
        }, { enabled: this._getGenConfig('BlockSpawnerEnabled') ?? false, type: this._getGenConfig('BlockSpawnerBehaviorType') ?? 'pool', growth: this._getGenConfig('BlockSpawnerGrowthMode') ?? 'edge', bias: this._getGenConfig('BlockSpawnerSpawnBias') ?? 'single', label: 'Block Spawner/Despawner' });

        this.registerBehavior('spreading_nudge', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('SpreadingNudgeStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const startDelay = this._getGenConfig('SpreadingNudgeStartDelay') ?? 20;
            if (s.step < startDelay) return;
            const allowed = this._getAllowedDirs(layer);

            // State Initialization
            const distKey = `spreadingNudgeNextDist_${layer}`;
            const stepKey = `spreadingNudgeNextSpawnStep_${layer}`;
            const cyclesKey = `spreadingNudgeCycles_${layer}`;
            const queueKey = `spreadingNudgeSymmetryQueue_${layer}`;

            if (!s[distKey])   s[distKey] = { 'V1': 1, 'V-1': 1, 'H1': 1, 'H-1': 1 };
            if (!s[stepKey])   s[stepKey] = { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
            if (!s[cyclesKey]) s[cyclesKey] = { 'V1': { step: 0, lastTempBlock: null }, 'V-1': { step: 0, lastTempBlock: null }, 'H1': { step: 0, lastTempBlock: null }, 'H-1': { step: 0, lastTempBlock: null } };
            if (!s[queueKey])  s[queueKey] = [];

            const spawnSpeed   = this._getGenConfig('SpreadingNudgeSpawnSpeed') ?? 1;
            const spreadDensity = this._getGenConfig('SpreadingNudgeRange') ?? 0.5;
            const growthChance  = this._getGenConfig('SpreadingNudgeChance') ?? 0.8;
            const maxInstances  = this._getGenConfig('SpreadingNudgeMaxInstances') ?? 20;
            const preferSymmetry = this._getGenConfig('SpreadingNudgeSymmetry') ?? true;

            const arms = [
                { key: 'V1',  vert: true,  side: 1,  perp: ['E', 'W'], dir: 'S' }, // South Axis -> Spawns E/W
                { key: 'V-1', vert: true,  side: -1, perp: ['E', 'W'], dir: 'N' }, // North Axis -> Spawns E/W
                { key: 'H1',  vert: false, side: 1,  perp: ['N', 'S'], dir: 'E' }, // East Axis -> Spawns N/S
                { key: 'H-1', vert: false, side: -1, perp: ['N', 'S'], dir: 'W' }  // West Axis -> Spawns N/S
            ];

            // 1. Process Symmetry Queue
            if (s[`spreadingNudgeSymmetryQueue_${layer}`] && s[`spreadingNudgeSymmetryQueue_${layer}`].length > 0) {
                const pending = [];
                for (const item of s[`spreadingNudgeSymmetryQueue_${layer}`]) {
                    if (s.step >= item.stepToSpawn) {
                        if (!allowed || allowed.has(item.dir) || (item.arm && allowed.has(item.arm))) {
                            const strip = this._createStrip(item.layer, item.dir, item.x, item.y);
                            strip.isNudge = item.isNudge || false;
                            strip.bypassOccupancy = item.bypassOccupancy || false;
                            strip.arm = item.arm;
                            strip.stepPhase = Math.floor(Math.random() * 6);
                        }
                    } else {
                        pending.push(item);
                    }
                }
                s[`spreadingNudgeSymmetryQueue_${layer}`] = pending;
            }

            // 2. Perform Nudge Growth at Spreading Origins
            const bs = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2);
            const halfH = Math.floor(this.g.rows / bs.h / 2);

            // Count current active perpendicular "solid" strips for instance limiting
            let activePerpStrips = 0;
            for (const strip of this.strips.values()) {
                if (strip.active && strip.bypassOccupancy && !strip.isNudge) activePerpStrips++;
            }

            arms.sort(() => Math.random() - 0.5);

            for (const arm of arms) {
                // QUADRANT CHECK
                if (allowed && !allowed.has(arm.dir)) continue;

                // Check if it's time for this arm to advance
                if (s.step >= (s[`spreadingNudgeNextSpawnStep_${layer}`][arm.key] || 0)) {
                    let d = s[`spreadingNudgeNextDist_${layer}`][arm.key];
                    const ax = arm.vert ? s.genOriginX : s.genOriginX + d * arm.side;
                    const ay = arm.vert ? s.genOriginY + d * arm.side : s.genOriginY;

                    // Boundary check
                    if (Math.abs(ax - s.genOriginX) > halfW || Math.abs(ay - s.genOriginY) > halfH) {
                        // Reach edge, stop this arm
                        s[`spreadingNudgeNextSpawnStep_${layer}`][arm.key] = Infinity;
                        continue;
                    }

                    // Axial point growth (Harden/Nudge logic at the spreader head)
                    const cycle = s[`spreadingNudgeCycles_${layer}`][arm.key];
                    const { bw, bh } = this._calcBlockSize({ originX: ax, originY: ay, direction: arm.dir }, s.fillRatio);
                    this._attemptNudgeGrowthWithParams(layer, bw, bh, ax, ay, cycle, growthChance);

                    if (preferSymmetry) {
                        const mirAx = arm.vert ? ax : s.genOriginX - (ax - s.genOriginX);
                        const mirAy = arm.vert ? s.genOriginY - (ay - s.genOriginY) : ay;
                        const mirCycle = s[`spreadingNudgeCycles_${layer}`][arm.key + '_mir'] || { step: 0, lastTempBlock: null };
                        s[`spreadingNudgeCycles_${layer}`][arm.key + '_mir'] = mirCycle;
                        this._attemptNudgeGrowthWithParams(layer, bw, bh, mirAx, mirAy, mirCycle, growthChance);
                    }

                    // Spawn perpendicular "solid" strips to fill the area
                    if (activePerpStrips < maxInstances && Math.random() < spreadDensity) {
                        for (const dir of arm.perp) {
                            if (activePerpStrips >= maxInstances) break;
                            // RELAXATION: Allow spawning perp strips if the parent arm is allowed
                            if (allowed && !allowed.has(dir) && !allowed.has(arm.dir)) continue;

                            const strip = this._createStrip(layer, dir, ax, ay);
                            strip.isNudge = false; // Solid growth
                            strip.bypassOccupancy = true; // No holes, uninterrupted
                            strip.growCount = 0;
                            strip.arm = arm.dir; // Mark as branch of this arm
                            activePerpStrips++;

                            if (preferSymmetry) {
                                const mirX = arm.vert ? ax : s.genOriginX - (ax - s.genOriginX);
                                const mirY = arm.vert ? s.genOriginY - (ay - s.genOriginY) : ay;
                                const mirDir = dir === 'N' ? 'S' : (dir === 'S' ? 'N' : (dir === 'E' ? 'W' : 'E'));
                                s[`spreadingNudgeSymmetryQueue_${layer}`].push({
                                    x: mirX, y: mirY, layer: layer, dir: mirDir,
                                    isNudge: false, bypassOccupancy: true, arm: arm.dir,
                                    stepToSpawn: s.step + 1 + Math.floor(Math.random() * 3)
                                });
                            }
                        }
                    }

                    // Move the origin outward and schedule next spawn
                    s[`spreadingNudgeNextDist_${layer}`][arm.key]++;
                    const delay = 1 + Math.floor(Math.random() * spawnSpeed);
                    s[`spreadingNudgeNextSpawnStep_${layer}`][arm.key] = s.step + delay;
                }
            }
        }, { enabled: this._getGenConfig('SpreadingNudgeEnabled') ?? false, type: this._getGenConfig('SpreadingNudgeBehaviorType') ?? 'pool', growth: this._getGenConfig('SpreadingNudgeGrowthMode') ?? 'edge', bias: this._getGenConfig('SpreadingNudgeSpawnBias') ?? 'single', label: 'Spreading Nudge' });

        // ── Shove Fill ─────────────────────────────────────────────────────────
        this.registerBehavior('shove_fill', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('ShoveFillStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            if (!this._getGenConfig('ShoveFillEnabled')) return;
            const startDelay = this._getGenConfig('ShoveFillStartDelay') ?? 20;
            const fillRate   = 4; // Hardcoded after UI slider removal
            if (s.step < startDelay || (s.step - startDelay) % fillRate !== 0) return;
            const allowed = this._getAllowedDirs(layer);
            const bs    = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2);
            const halfH = Math.floor(this.g.rows / bs.h / 2);
            const proxW = Math.max(2, Math.floor(halfW * 0.25));
            const proxH = Math.max(2, Math.floor(halfH * 0.25));
            const shoveAmount = Math.max(1, this._getGenConfig('ShoveFillAmount') ?? 1);

            if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];
            s.shoveStripsByLayer[layer] = s.shoveStripsByLayer[layer].filter(st => st.active);

            if (s.shoveStripsByLayer[layer].length === 0) {
                const qCount    = Math.min(4, parseInt(this._getGenConfig('QuadrantCount') ?? 4));
                const availDirs = ['N', 'S', 'E', 'W'].filter(d => !allowed || allowed.has(d));
                if (availDirs.length === 0) return;
                const count = Math.min(qCount, availDirs.length);
                const chosen = [...availDirs].sort(() => Math.random() - 0.5).slice(0, count);

                for (const dir of chosen) {
                    const isEW = dir === 'E' || dir === 'W';
                    const width = 1 + Math.floor(Math.random() * 3);
                    if (isEW) {
                        const perpMid   = s.genOriginY + Math.round((Math.random() * 2 - 1) * proxH);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStripsByLayer[layer].push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.genOriginX + (dir === 'E' ? 2 : -2), active: true, phaseOff: 0 });
                    } else {
                        const perpMid   = s.genOriginX + Math.round((Math.random() * 2 - 1) * proxW);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStripsByLayer[layer].push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.genOriginY + (dir === 'S' ? 2 : -2), active: true, phaseOff: 0 });
                    }
                }
            }

            for (const strip of s.shoveStripsByLayer[layer]) {
                if (!strip.active) continue;
                if (allowed && !allowed.has(strip.dir)) continue; // QUADRANT CHECK

                const isEW = strip.dir === 'E' || strip.dir === 'W';
                const step = (strip.dir === 'E' || strip.dir === 'S') ? 1 : -1;
                const rangeSize = strip.perpEnd - strip.perpStart + 1;

                const numSteps = 1 + Math.floor(Math.random() * shoveAmount);

                for (let i = 0; i < numSteps; i++) {
                    const lp = strip.leadPos;
                    if (isEW ? (strip.dir === 'E' ? lp > halfW : lp < -halfW)
                             : (strip.dir === 'S' ? lp > halfH : lp < -halfH)) {
                        strip.active = false;
                        break;
                    }

                    const bp = lp - step;
                    if (isEW) {
                        // Vertical strip (X=fixed, Y=range) -> 1x1, 1x2, or 1x3 block
                        this.actionBuffer.push({ layer: layer, fn: () => this._spawnBlock(lp, strip.perpStart, 1, rangeSize, layer, false, 0, true, true, true, false, true) });
                        this.actionBuffer.push({ layer: layer, fn: () => this._spawnBlock(bp, strip.perpStart, 1, rangeSize, layer, false, 0, true, true, true, false, true) });
                    } else {
                        // Horizontal strip (Y=fixed, X=range) -> 1x1, 2x1, or 3x1 block
                        this.actionBuffer.push({ layer: layer, fn: () => this._spawnBlock(strip.perpStart, lp, rangeSize, 1, layer, false, 0, true, true, true, false, true) });
                        this.actionBuffer.push({ layer: layer, fn: () => this._spawnBlock(strip.perpStart, bp, rangeSize, 1, layer, false, 0, true, true, true, false, true) });
                    }

                    strip.leadPos += step;
                }
            }
        }, { enabled: this._getGenConfig('ShoveFillEnabled') ?? false, type: this._getGenConfig('ShoveFillBehaviorType') ?? 'pool', growth: this._getGenConfig('ShoveFillGrowthMode') ?? 'edge', bias: this._getGenConfig('ShoveFillSpawnBias') ?? 'single', label: 'Shove Fill' });

        // Behavior: Block Thicken — picks a random axis line and thickens blocks along it
        this.registerBehavior('block_thicken', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('BlockThickenStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const startDelay = this._getGenConfig('BlockThickenStartDelay') ?? 10;
            const spawnFreq  = Math.max(1, this._getGenConfig('BlockThickenSpawnFrequency') ?? 5);
            const spawnChance = (this._getGenConfig('BlockThickenSpawnChance') ?? 50) / 100;

            // Timing gate
            if (s.step < startDelay) return;
            if ((s.step - startDelay) % spawnFreq !== 0) return;

            // Chance gate
            if (Math.random() > spawnChance) return;

            const bs = this.getBlockSize();
            const xVis = Math.ceil(this.g.cols / bs.w / 2) + 2;
            const yVis = Math.ceil(this.g.rows / bs.h / 2) + 2;

            // Pick a random axis: 0 = X (vertical line), 1 = Y (horizontal line)
            const axis = Math.random() < 0.5 ? 0 : 1;

            // Collect all occupied coordinates on the chosen axis to pick from
            const occupiedLines = new Set();
            const blocks = this.activeBlocks.filter(b => b.layer === layer);
            for (const b of blocks) {
                if (axis === 0) {
                    // X axis — collect all unique x values covered by this block
                    for (let x = b.x; x < b.x + b.w; x++) occupiedLines.add(x);
                } else {
                    // Y axis — collect all unique y values covered by this block
                    for (let y = b.y; y < b.y + b.h; y++) occupiedLines.add(y);
                }
            }

            if (occupiedLines.size === 0) return;

            // Pick a random line from the occupied set
            const lineArr = [...occupiedLines];
            const chosenLine = lineArr[Math.floor(Math.random() * lineArr.length)];

            // Find all blocks that intersect this line
            const lineBlocks = blocks.filter(b => {
                if (axis === 0) {
                    return b.x <= chosenLine && b.x + b.w - 1 >= chosenLine;
                } else {
                    return b.y <= chosenLine && b.y + b.h - 1 >= chosenLine;
                }
            });

            if (lineBlocks.length === 0) return;

            // For each block on this line, try to add blocks on both sides along the perpendicular axis
            for (const b of lineBlocks) {
                if (axis === 0) {
                    // Line is vertical (X = chosenLine), thicken along X (add columns left and right)
                    // Walk left (x-1, x-2, ...) and right (x+w, x+w+1, ...) adding 1-wide columns
                    // as long as there are adjacent occupied cells on the perpendicular axis (Y)
                    const thickenSide = (startX, dx) => {
                        let tx = startX;
                        while (Math.abs(tx) <= xVis) {
                            // Check: does this column have any adjacent occupied neighbor on Y that connects?
                            let hasAdjacentEdge = false;
                            for (let ty = b.y; ty < b.y + b.h; ty++) {
                                if (this._isOccupied(tx, ty, layer)) { hasAdjacentEdge = false; break; }
                                // Check if there's a block above or below connecting
                                if (this._isOccupied(tx, ty - 1, layer) || this._isOccupied(tx, ty + 1, layer)) {
                                    hasAdjacentEdge = true;
                                }
                            }
                            if (!hasAdjacentEdge) break;
                            // Spawn a column of blocks at tx covering the same Y span
                            for (let ty = b.y; ty < b.y + b.h; ty++) {
                                if (!this._isOccupied(tx, ty, layer)) {
                                    const ftx = tx, fty = ty;
                                    this.actionBuffer.push({ layer, fn: () => {
                                        this._spawnBlock(ftx, fty, 1, 1, layer, false, 0, true, true, true, false, true, 'block_thicken');
                                    }});
                                }
                            }
                            tx += dx;
                        }
                    };
                    thickenSide(b.x - 1, -1); // Thicken left
                    thickenSide(b.x + b.w, 1); // Thicken right
                } else {
                    // Line is horizontal (Y = chosenLine), thicken along Y (add rows above and below)
                    const thickenSide = (startY, dy) => {
                        let ty = startY;
                        while (Math.abs(ty) <= yVis) {
                            let hasAdjacentEdge = false;
                            for (let tx = b.x; tx < b.x + b.w; tx++) {
                                if (this._isOccupied(tx, ty, layer)) { hasAdjacentEdge = false; break; }
                                if (this._isOccupied(tx - 1, ty, layer) || this._isOccupied(tx + 1, ty, layer)) {
                                    hasAdjacentEdge = true;
                                }
                            }
                            if (!hasAdjacentEdge) break;
                            for (let tx = b.x; tx < b.x + b.w; tx++) {
                                if (!this._isOccupied(tx, ty, layer)) {
                                    const ftx = tx, fty = ty;
                                    this.actionBuffer.push({ layer, fn: () => {
                                        this._spawnBlock(ftx, fty, 1, 1, layer, false, 0, true, true, true, false, true, 'block_thicken');
                                    }});
                                }
                            }
                            ty += dy;
                        }
                    };
                    thickenSide(b.y - 1, -1); // Thicken above
                    thickenSide(b.y + b.h, 1); // Thicken below
                }
            }
        }, { enabled: this._getGenConfig('BlockThickenEnabled') ?? false, type: this._getGenConfig('BlockThickenBehaviorType') ?? 'pool', growth: this._getGenConfig('BlockThickenGrowthMode') ?? 'edge', bias: this._getGenConfig('BlockThickenSpawnBias') ?? 'single', label: 'Block Thicken' });

        this.registerBehavior('hole_filler', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('HoleFillerStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const highFill = (s.fillRatio || 0) > 0.90;
            if (!highFill && !this._getGenConfig('HoleFillerEnabled')) return;
            const startDelay = this._getGenConfig('HoleFillerStartDelay') ?? 0;
            const fillRate = Math.max(1, this._getGenConfig('HoleFillerRate') ?? 1);
            if (!highFill && (s.step < startDelay || s.step % fillRate !== 0)) return;
            const w = this.logicGridW, h = this.logicGridH;
            const grid = this.layerGrids[layer];
            if (!grid) return;

            const bs = this.getBlockSize();
            const xVis = Math.ceil(this.g.cols / bs.w / 2) + 2;
            const yVis = Math.ceil(this.g.rows / bs.h / 2) + 2;

            if (s[`holeQIdx_${layer}`] === undefined) s[`holeQIdx_${layer}`] = 0;
            const q = s[`holeQIdx_${layer}`];
            s[`holeQIdx_${layer}`] = (s[`holeQIdx_${layer}`] + 1) % 4;

            let minX = (q === 0 || q === 3) ? -xVis : 0;
            let maxX = (q === 0 || q === 3) ? 0 : xVis;
            let minY = (q === 0 || q === 1) ? -yVis : 0;
            let maxY = (q === 0 || q === 1) ? 0 : yVis;

            const maxLayerCheck = this._getMaxLayer();
            const isOccupiedAny = (bx, by) => {
                for (let l = 0; l <= maxLayerCheck; l++) {
                    if (this._isOccupied(bx, by, l)) return true;
                }
                return false;
            };

            // Use the globally computed outside map for this step
            if (!s.outsideMap) {
                s.outsideMap = this._computeTrueOutside(this.logicGridW, this.logicGridH);
            }

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (!this._isOccupied(bx, by, layer)) {
                        const gx = this._gridCX + bx;
                        const gy = this._gridCY + by;

                        let isEnclosed = false;
                        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                            isEnclosed = s.outsideMap[gy * w + gx] === 0;
                        }

                        // Also check for "Small Gaps" (3 or 4 cardinal neighbors are full on any layer)
                        let neighborCount = 0;
                        if (isOccupiedAny(bx - 1, by)) neighborCount++;
                        if (isOccupiedAny(bx + 1, by)) neighborCount++;
                        if (isOccupiedAny(bx, by - 1)) neighborCount++;
                        if (isOccupiedAny(bx, by + 1)) neighborCount++;
                        const maxPossibleNeighbors = 4
                            - (bx <= -xVis ? 1 : 0) - (bx >= xVis ? 1 : 0)
                            - (by <= -yVis ? 1 : 0) - (by >= yVis ? 1 : 0);
                        const isSmallGap = (neighborCount >= Math.min(3, maxPossibleNeighbors));

                        if (isEnclosed || isSmallGap) {
                            this.actionBuffer.push({ layer, fn: () => {
                                this._spawnBlock(bx, by, 1, 1, layer, false, 0, true, true, true, false, true);
                            }});
                        }
                    }
                }
            }
        }, { enabled: true, type: this._getGenConfig('HoleFillerBehaviorType') ?? 'pool', growth: this._getGenConfig('HoleFillerGrowthMode') ?? 'edge', bias: this._getGenConfig('HoleFillerSpawnBias') ?? 'single', label: 'Aggressive Hole Filler' });
        // ── Axis Shift ───────────────────────────────────────────────────────
        // Treats newly placed lines of blocks as sub-axes, spawning strips
        // in all 4 directions from a point along the line — exactly like the
        // main seed-schedule creates spine strips from the primary origin.
        // NOTE: This behavior is ticked deterministically every step (not via
        // the random behavior pool) because it must track strip growth over
        // time — strips are deleted when deactivated, so we snapshot them as
        // they qualify.
        this.registerBehavior('axis_shift', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('AxisShiftStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const startDelay = this._getGenConfig('AxisShiftStartDelay') ?? 15;
            const rate = Math.max(1, this._getGenConfig('AxisShiftRate') ?? 5);
            const maxAxes = this._getGenConfig('AxisShiftMaxAxes') ?? 10;
            const minLength = this._getGenConfig('AxisShiftMinLength') ?? 3;

            // Initialize state
            if (!s[`axisShiftAxes_${layer}`]) s[`axisShiftAxes_${layer}`] = [];
            if (!s.axisShiftUsedStrips) s.axisShiftUsedStrips = new Set();
            if (!s[`axisShiftCandidates_${layer}`]) s[`axisShiftCandidates_${layer}`] = [];

            // Continuously snapshot strips that have grown enough — they may
            // become inactive (and get deleted from this.strips) before we
            // get around to using them, so capture their info now.
            for (const strip of this.strips.values()) {
                if (s.axisShiftUsedStrips.has(strip.id)) continue;
                if (strip.growCount >= minLength) {
                    s.axisShiftUsedStrips.add(strip.id);
                    s[`axisShiftCandidates_${layer}`].push({
                        id: strip.id,
                        direction: strip.direction,
                        originX: strip.originX,
                        originY: strip.originY,
                        growCount: strip.growCount
                    });
                }
            }

            if (s.step < startDelay) return;
            if ((s.step - startDelay) % rate !== 0) return;

            // Cap check
            if (s[`axisShiftAxes_${layer}`].length >= maxAxes) return;
            if (s[`axisShiftCandidates_${layer}`].length === 0) return;

            const allowed = this._getAllowedDirs(layer);

            // Pick a random candidate from the snapshot pool
            const idx = Math.floor(Math.random() * s[`axisShiftCandidates_${layer}`].length);
            const candidate = s[`axisShiftCandidates_${layer}`].splice(idx, 1)[0];

            // Pick a point along the line as the new sub-origin
            const [dx, dy] = (candidate.direction === 'ANY') ? [0, 0] : this._dirDelta(candidate.direction);
            const offset = (candidate.direction === 'ANY') ? 0 : (1 + Math.floor(Math.random() * Math.max(1, candidate.growCount - 1)));
            const subOriginX = candidate.originX + dx * offset;
            const subOriginY = candidate.originY + dy * offset;

            // Create spine-like strips from the sub-origin
            const boost = this._getGenConfig('SpineBoost') ?? 4;
            const subBoost = Math.max(1, Math.floor(boost / 2));
            const spawnAmount = Math.min(4, Math.max(1, this._getGenConfig('AxisShiftSpawnAmount') ?? 4));
            const dirs = ['N', 'S', 'E', 'W'];
            Utils.shuffle(dirs);

            let spawned = 0;
            for (const dir of dirs) {
                if (spawned >= spawnAmount) break;
                // Relaxed quadrant check: allow if direction OR parent arm is allowed
                if (allowed && !allowed.has(dir) && candidate.direction !== 'ANY' && !allowed.has(candidate.direction)) continue;

                spawned++;
                this.actionBuffer.push({ layer, fn: () => {
                    const strip = this._createStrip(layer, dir, subOriginX, subOriginY);
                    strip.isSpine = true;
                    strip.boostSteps = subBoost;
                    strip.pattern = this._generateInsideOutPattern();
                    strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
                    strip.arm = (candidate.direction === 'ANY') ? dir : candidate.direction;
                }});
            }

            s[`axisShiftAxes_${layer}`].push({
                x: subOriginX, y: subOriginY,
                step: s.step, parentDir: candidate.direction
            });
        }, { enabled: this._getGenConfig('AxisShiftEnabled') ?? false, type: this._getGenConfig('AxisShiftBehaviorType') ?? 'pool', growth: this._getGenConfig('AxisShiftGrowthMode') ?? 'edge', bias: this._getGenConfig('AxisShiftSpawnBias') ?? 'single', label: 'Axis Shift' });

        // Explorer Growth: moves towards edges, spawning from blocks (edge) or spine
        this.registerBehavior('explorer_growth', function(s, behavior, layer) {
            const stopAfter = this._getGenConfig('NudgeStopAfter') ?? 0;
            if (stopAfter > 0 && s.step >= stopAfter) return;
            const startDelay = this._getGenConfig('NudgeStartDelay') ?? 2;
            if (s.step < startDelay) return;

            const maxExplorers = this._getGenConfig('ExplorerMaxCount') ?? 20;
            const spawnRate = this._getGenConfig('ExplorerSpawnRate') ?? 4;
            
            // Count current active explorers for this layer
            let explorerCount = 0;
            for (const strip of this.strips.values()) {
                if (strip.isExplorer && strip.active && strip.layer === layer) explorerCount++;
            }

            if (explorerCount < maxExplorers && s.step % spawnRate === 0) {
                // Spawn logic
                let ox = this.behaviorState?.scx ?? 0, oy = this.behaviorState?.scy ?? 0, d = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
                
                const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
                const targetL = usePromotion ? 1 : layer;

                if (behavior.growth === 'edge') {
                    // Pick random block from ANY existing blocks in this layer
                    const candidates = this.activeBlocks.filter(b => b.layer === targetL);
                    if (candidates.length > 0) {
                        const b = candidates[Math.floor(Math.random() * candidates.length)];
                        ox = b.x + Math.floor(Math.random() * b.w);
                        oy = b.y + Math.floor(Math.random() * b.h);
                    }
                } else {
                    // Spine mode
                    const axis = Math.random() < 0.5 ? 'X' : 'Y';
                    if (axis === 'X') {
                        ox = (this.behaviorState?.scx ?? 0) + (Math.floor(Math.random() * 41) - 20);
                        oy = (this.behaviorState?.scy ?? 0);
                        d = Math.random() < 0.5 ? 'N' : 'S';
                    } else {
                        ox = (this.behaviorState?.scx ?? 0);
                        oy = (this.behaviorState?.scy ?? 0) + (Math.floor(Math.random() * 41) - 20);
                        d = Math.random() < 0.5 ? 'W' : 'E';
                    }
                }

                const strip = this._createStrip(targetL, d, ox, oy);
                strip.isExplorer = true;
                strip.bypassOccupancy = true;
                strip.pattern = [true];
            }
        }, { enabled: this._getGenConfig('NudgeEnabled') !== false, type: this._getGenConfig('NudgeBehaviorType') ?? 'pool', growth: this._getGenConfig('NudgeGrowthMode') ?? 'spine', label: 'Explorer Growth' });
    }

    _pickLayerDirs(count) {
        if (count >= 4) return null;
        const all = ['N', 'S', 'E', 'W'];
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        return new Set(shuffled.slice(0, Math.max(1, count)));
    }

    _getAllowedDirs(layer) {
        if (layer >= 2) return null; 
        const dirs = this.behaviorState?.layerDirs;
        if (!dirs) return null;
        return dirs[layer] ?? null;
    }

    _tickLayerDirs(s) {
        const genScaling = false;
        let userMax = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
        
        // 1. Determine Min/Max Counts
        let minCount = userMax, maxCount = userMax;

        if (!s.dirPools) s.dirPools = { 0: [], 1: [] };
        if (!s.lastLayerDirs) s.lastLayerDirs = { 0: null, 1: null };

        const all = ['N', 'S', 'E', 'W'];

        const minL = this._getMinLayer();
        const maxL = this._getMaxLayer();

        for (let l = minL; l <= maxL; l++) {
            // Pick a random count for this step within the allowed range
            let count = (minCount === maxCount) ? minCount : Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
            
            // If 4 directions are allowed, we set to null (all active)
            if (count >= 4) {
                if (s.layerDirs[l] !== null) {
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = null; } });
                    s.lastLayerDirs[l] = null;
                }
                continue;
            }

            let pool = s.dirPools[l];
            let selected = new Set();
            
            // Fairness and Variation Logic: "Different than previous" + "Each gets a turn"
            for (let attempt = 0; attempt < 5; attempt++) {
                selected.clear();
                // Ensure the pool has enough directions for this turn
                if (pool.length < count) {
                    const fresh = [...all];
                    Utils.shuffle(fresh);
                    s.dirPools[l] = pool = [...pool, ...fresh];
                }
                
                // Peek at the first 'count' directions
                const candidates = pool.slice(0, count);
                for (const d of candidates) selected.add(d);

                // Verify "Different than previous step"
                const last = s.lastLayerDirs[l];
                let isSame = false;
                if (last && last.size === selected.size) {
                    isSame = true;
                    for (const d of selected) {
                        if (!last.has(d)) { isSame = false; break; }
                    }
                }

                // If it's unique or we've exhausted attempts, commit this choice
                if (!isSame || attempt === 4) {
                    pool.splice(0, count);
                    break;
                } else {
                    // If it was the same, reshuffle the pool to ensure variation
                    Utils.shuffle(pool);
                }
            }

            this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = selected; } });
            s.lastLayerDirs[l] = selected;
        }
    }

    _generateInsideOutPattern() {
        const p = [true, true, true];
        const p1 = Math.floor(Math.random() * 3);
        p[p1] = false;
        // 50% chance for a second pause in the 3-step segment
        if (Math.random() < 0.5) {
            let p2;
            do { p2 = Math.floor(Math.random() * 3); } while (p2 === p1);
            p[p2] = false;
        }
        return p;
    }

    _generateInsideOutDistinctPattern(existing) {
        let attempt;
        do { attempt = this._generateInsideOutPattern(); } while (attempt.join() === existing.join());
        return attempt;
    }

    _generateRandomPattern() {
        const arr = [true, true, true, false, false, false];
        for (let i = 5; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    _generateDistinctPattern(existing) {
        let attempt;
        do { attempt = this._generateRandomPattern(); } while (attempt.join() === existing.join());
        return attempt;
    }

    _getStepPattern() { return this.behaviorState.pattern || [true, false, false, true, true, false]; }
    _getPausePattern() { return this.behaviorState.pausePattern || [true, true, false, true, false, false]; }

    _generateSeedSchedule(scx, scy) {
        const schedule = {};
        const dirs = ['N', 'S', 'E', 'W'];
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;

        // Compute per-direction boost based on canvas aspect ratio
        const baseBoost = this._getGenConfig('SpineBoost') ?? 4;
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const aspect = visW / visH;
        const hBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(aspect)));
        const vBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(1 / aspect)));
        const dirBoost = { N: vBoost, S: vBoost, E: hBoost, W: hBoost };

        const addToSchedule = (layer, dir, stepPool) => {
            const step = stepPool[Math.floor(Math.random() * stepPool.length)];
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer: Math.max(minL, layer), dir, originX: scx, originY: scy, boost: dirBoost[dir] });
        };

        const maxLayer = this._getMaxLayer();
        // Seed all layers in the schedule to ensure they start connected to the spines
        for (let l = minL; l <= maxLayer; l++) {
            const stepOffset = (l === minL || l === 1) ? 0 : (l * 2);
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => {
                addToSchedule(l, d, [stepOffset, stepOffset + 1, stepOffset + 2]);
            });
        }
        return schedule;
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        const globalBoost = this._getGenConfig('SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY, boost } of scheduled) {
            this.actionBuffer.push({ layer, fn: () => {
                const strip = this._createStrip(layer, dir, originX, originY);
                strip.isSpine = true;
                strip.boostSteps = boost ?? globalBoost;
                strip.pattern = this._generateInsideOutPattern();
                strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
            }});
        }
    }

    _deactivateStrip(strip) { strip.active = false; this.strips.delete(strip.id); }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = {
            id, layer, direction: dir, originX, originY, headX: originX, headY: originY,
            pattern: this._getStepPattern(), pausePattern: this._getPausePattern(),
            stepPhase: 0, growCount: 0, stepsSinceLastGrowth: 0, paused: false, active: true, blockIds: [],
            startDelay: 0
        };
        this.strips.set(id, strip);
        return strip;
    }

    _tickStrips(s) {
        const useGenerativeScaling = false;
        
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            if (strip.startDelay > 0) {
                strip.startDelay--;
                continue;
            }

            const allowed = this._getAllowedDirs(strip.layer);
            // RELAXATION: Allow growth if the direction IS allowed OR if the strip belongs to an allowed ARM (quadrant branch).
            const isBranchOfAllowedArm = strip.arm && allowed && allowed.has(strip.arm);
            if (allowed && !allowed.has(strip.direction) && !isBranchOfAllowedArm) continue; // QUADRANT RESTRICTION

            strip.stepsSinceLastGrowth = (strip.stepsSinceLastGrowth || 0) + 1;

            let shouldGrow = false;
            // Spine boost takes precedence
            // If it's a spine, we now force it to follow the rhythmic behavior.
            if (strip.boostSteps > 0 && !strip.isSpine) { 
                shouldGrow = true; 
                strip.boostSteps--; 
            } else {
                const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                const phase = (strip.isExpansion || strip.isSpine) ? (strip.stepPhase % 3) : (strip.stepPhase % pattern.length);
                shouldGrow = pattern[phase];
                if (shouldGrow && strip.isSpine && strip.boostSteps > 0) strip.boostSteps--;
            }

            // Expansion strips are bounded only by screen edges (checkScreenEdge in _growStrip)

            if (shouldGrow) {
                this.actionBuffer.push({ layer: strip.layer, isSpine: !!strip.isSpine, fn: () => this._growStrip(strip, s) });
            }
            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _dirDelta(dir) {
        switch (dir) {
            case 'N': return [0, -1]; case 'S': return [0, 1];
            case 'E': return [1, 0]; case 'W': return [-1, 0];
        }
        return [0, 0];
    }

    _calcBlockSize(strip, fillRatio) {
        return { bw: 1, bh: 1 };
    }

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);

        // Force 1×1 on the very first growth step so new strips always begin with a single block.
        // Otherwise, use _calcBlockSize to adhere to size scaling settings.
        let { bw, bh } = (strip.growCount === 0) ? { bw: 1, bh: 1 } : this._calcBlockSize(strip, s.fillRatio);

        // Inside Out expansion: override with configured IO block dimensions
        if (strip.isExpansion && strip.ioBlockW) {
            bw = strip.ioBlockW;
            bh = strip.ioBlockH;
            // Apply wider spawn bias
            if (strip.ioSpawnBias === 'wider') {
                if (bw === 1) bw = 2 + Math.floor(Math.random() * 2);
                if (bh === 1) bh = 2 + Math.floor(Math.random() * 2);
            }
        }

        const newHeadX = strip.headX + dx * bw, newHeadY = strip.headY + dy * bh;
        const edges = this.checkScreenEdge(newHeadX, newHeadY);
        if (edges) {
            if (s.hitEdge) {
                if (edges.top) s.hitEdge.N = true;
                if (edges.bottom) s.hitEdge.S = true;
                if (edges.left) s.hitEdge.W = true;
                if (edges.right) s.hitEdge.E = true;
            }
            this._deactivateStrip(strip);
            return;
        }
        const spawnX = dx > 0 ? strip.headX + 1 : (dx < 0 ? newHeadX : strip.headX);
        const spawnY = dy > 0 ? strip.headY + 1 : (dy < 0 ? newHeadY : strip.headY);

        const canPassThrough = (strip.isNudge || strip.layer === 1 || strip.bypassOccupancy);

        if (strip.isNudge) {
            // Use _nudge for actual nudge growth effect
            const success = this._nudge(spawnX, spawnY, bw, bh, strip.direction, strip.layer, strip.layer === 0);
            if (success || canPassThrough) {
                strip.blockIds.push(null);
                strip.headX = newHeadX;
                strip.headY = newHeadY;
                strip.growCount++;
                strip.stepsSinceLastGrowth = 0;
                this._gridsDirty = true;
            }
        } else {
            // Check occupancy for standard growth unless it's layer 1 or bypassing
            if (canPassThrough || (!this._isOccupied(spawnX, spawnY, 0) && !this._isOccupied(spawnX, spawnY, 1))) {
                const id = this._spawnBlock(spawnX, spawnY, bw, bh, strip.layer, strip.bypassOccupancy || false, 0, true, true, true, false, true);
                if (id !== -1 || canPassThrough) {
                    strip.blockIds.push(id === -1 ? null : id);
                    strip.headX = newHeadX;
                    strip.headY = newHeadY;
                    strip.growCount++;
                    strip.stepsSinceLastGrowth = 0;
                    this._gridsDirty = true;
                }
            }
        }
    }

    _updateFillRatio(s) {
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w)), visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);
        const totalCells = visW * visH;

        // Use a bitmap to avoid double-counting cells occupied on multiple layers
        if (!this._fillBitmap || this._fillBitmap.length < totalCells) {
            this._fillBitmap = new Uint8Array(totalCells);
        }
        this._fillBitmap.fill(0);

        for (const b of this.activeBlocks) {
            const bx1 = Math.max(-halfW, b.x), bx2 = Math.min(halfW - 1, b.x + b.w - 1);
            const by1 = Math.max(-halfH, b.y), by2 = Math.min(halfH - 1, b.y + b.h - 1);
            if (bx2 < bx1 || by2 < by1) continue;
            for (let by = by1; by <= by2; by++) {
                const rowOff = (by + halfH) * visW;
                for (let bx = bx1; bx <= bx2; bx++) {
                    this._fillBitmap[rowOff + (bx + halfW)] = 1;
                }
            }
        }

        let filledCells = 0;
        for (let i = 0; i < totalCells; i++) {
            if (this._fillBitmap[i]) filledCells++;
        }

        s.fillRatio = Math.min(1, filledCells / totalCells);
        this.behaviorState.fillRatio = s.fillRatio;
    }

    _expandInsideOut(s) {
        const stopAfter = this._getGenConfig('InsideOutStopAfter') ?? 0;
        if (stopAfter > 0 && s.step >= stopAfter) return;
        if (!this._getGenConfig('InsideOutEnabled')) return;
        const delay = this._getGenConfig('InsideOutDelay') ?? 6;
        let bucketPeriod = Math.max(1, this._getGenConfig('InsideOutStepsBetweenBuckets') ?? 3);

        const genScaling = false;

        if (s.step < delay || (s.step - delay) % bucketPeriod !== 0) return;

        const bucketSize = Math.max(1, this._getGenConfig('InsideOutBucketSize') ?? 3);
        const ioBlockW = this._getGenConfig('InsideOutBlockWidth') ?? 1;
        const ioBlockH = this._getGenConfig('InsideOutBlockHeight') ?? 1;
        const ioSpawnBias = this._getGenConfig('InsideOutSpawnBias') ?? 'single';
        const bs = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2), halfH = Math.floor(this.g.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = this._getMaxLayer();
        const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
        const minL = usePromotion ? 1 : 0;
        const endL = Math.min(1, maxLayer);

        if (!s.insideOutProgression) s.insideOutProgression = {};

        // Helper: Check if the dependency wave (last wave of previous bucket) has started growing
        const prevBucketStarted = (arm, baseWave) => {
            if (baseWave <= 1) return true;
            const depWave = baseWave - 1;
            let foundAny = false;
            for (const strip of this.strips.values()) {
                if (strip.isExpansion && strip.arm === arm && strip.wave === depWave) {
                    foundAny = true;
                    if (strip.growCount > 0) return true;
                }
            }
            return !foundAny;
        };

        for (const arm of ['N', 'S', 'E', 'W']) {
            if (!s.insideOutProgression[arm]) {
                s.insideOutProgression[arm] = { nextWave: 1 };
            }
            const prog = s.insideOutProgression[arm];
            const baseWave = prog.nextWave;

            // 1. Boundary Check for the base wave
            const [dx, dy] = this._dirDelta(arm);
            const bx = s.genOriginX + dx * baseWave, by = s.genOriginY + dy * baseWave;
            if (Math.abs(bx - s.genOriginX) > halfW + edgeBuf || Math.abs(by - s.genOriginY) > halfH + edgeBuf) continue;

            // 2. Progression Check: Wait for previous bucket to establish
            if (!prevBucketStarted(arm, baseWave)) continue;

            // 3. Spine Connectivity Gate: Only spawn bucket if the first wave's origin is established
            const spinesEnabled = this._getGenConfig('SpinesFirstEnabled') !== false;
            if (spinesEnabled) {
                const spineEstablished = this._isOccupied(bx, by, 0) || this._isOccupied(bx, by, 1);
                if (!spineEstablished) continue;
            }

            // Prepare waves for this bucket
            const waves = [];
            for (let i = 0; i < bucketSize; i++) waves.push(baseWave + i);
            
            // Shuffled variance within the bucket (if > 1, and not the first wave)
            if (bucketSize > 1 && baseWave > 1) {
                Utils.shuffle(waves);
            }

            let spawnedAnyInBucket = false;
            for (let l = minL; l <= endL; l++) {
                const allowed = this._getAllowedDirs(l);
                if (allowed && !allowed.has(arm)) continue;

                for (const wave of waves) {
                    const ox = s.genOriginX + dx * wave, oy = s.genOriginY + dy * wave;

                    // Wave-specific boundary check
                    if (Math.abs(ox - s.genOriginX) > halfW + edgeBuf || Math.abs(oy - s.genOriginY) > halfH + edgeBuf) continue;

                    // Generative Scaling
                    if (genScaling) {
                        let activeExp = 0;
                        for (const st of this.strips.values()) if (st.isExpansion && st.active) activeExp++;
                        if (activeExp > (8 * (l + 1))) continue; 
                    }

                    const perp1 = (arm === 'N' || arm === 'S') ? 'E' : 'N';
                    const perp2 = (arm === 'N' || arm === 'S') ? 'W' : 'S';

                    const startDelay = Math.floor(Math.random() * bucketSize);
                    const ioPattern = this._generateInsideOutPattern();
                    const ioPausePattern = this._generateInsideOutDistinctPattern(ioPattern);
                    this.actionBuffer.push({ layer: l, fn: () => {
                        const s1 = this._createStrip(l, perp1, ox, oy);
                        s1.isExpansion = true; s1.arm = arm; s1.wave = wave;
                        s1.startDelay = startDelay;
                        s1.pattern = ioPattern;
                        s1.pausePattern = ioPausePattern;
                        s1.ioBlockW = ioBlockW; s1.ioBlockH = ioBlockH; s1.ioSpawnBias = ioSpawnBias;
                        const s2 = this._createStrip(l, perp2, ox, oy);
                        s2.isExpansion = true; s2.arm = arm; s2.wave = wave;
                        s2.startDelay = startDelay;
                        s2.pattern = ioPattern;
                        s2.pausePattern = ioPausePattern;
                        s2.ioBlockW = ioBlockW; s2.ioBlockH = ioBlockH; s2.ioSpawnBias = ioSpawnBias;
                    }});
                    spawnedAnyInBucket = true;
                }
            }

            // Only advance to the next bucket if we successfully attempted to spawn this one
            if (spawnedAnyInBucket) {
                prog.nextWave += bucketSize;
            }
        }
    }

    _processIntents() {
        for (const intent of this.actionBuffer) {
            if (!this.actionQueues.has(intent.layer)) this.actionQueues.set(intent.layer, []);
            this.actionQueues.get(intent.layer).push(intent);
        }
        this.actionBuffer = [];
        for (const [layer, queue] of this.actionQueues.entries()) {
            // Iterate instead of shift() to avoid O(n^2) array reindexing
            for (let i = 0; i < queue.length; i++) {
                const intent = queue[i];
                if (intent && intent.fn) intent.fn();
            }
            queue.length = 0;
        }
    }

    checkScreenEdge(bx, by) {
        const bs = this.getBlockSize();
        const halfVisibleW = Math.floor(this.g.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.g.rows / bs.h / 2);
        const extension = 2;
        const limitW = halfVisibleW + extension;
        const limitH = halfVisibleH + extension;

        const left = bx <= -limitW, right = bx >= limitW;
        const top = by <= -limitH, bottom = by >= limitH;

        // Reuse a single cached object to avoid GC pressure in the hot strip-growth path
        if (left || right || top || bottom) {
            if (!this._edgeResult) this._edgeResult = { left: false, right: false, top: false, bottom: false };
            this._edgeResult.left = left; this._edgeResult.right = right;
            this._edgeResult.top = top; this._edgeResult.bottom = bottom;
            return this._edgeResult;
        }
        return false;
    }

    _updateAxisMaxDist(s) {
        if (!s.axisMaxDist) s.axisMaxDist = { N: 0, S: 0, E: 0, W: 0 };
        else { s.axisMaxDist.N = 0; s.axisMaxDist.S = 0; s.axisMaxDist.E = 0; s.axisMaxDist.W = 0; }
        
        const scx = s.genOriginX || 0, scy = s.genOriginY || 0;
        for (const strip of this.strips.values()) {
            if (!strip.isSpine || !strip.active) continue;
            const dx = strip.headX - scx, dy = strip.headY - scy;
            if (strip.direction === 'N') s.axisMaxDist.N = Math.max(s.axisMaxDist.N, -dy);
            else if (strip.direction === 'S') s.axisMaxDist.S = Math.max(s.axisMaxDist.S, dy);
            else if (strip.direction === 'E') s.axisMaxDist.E = Math.max(s.axisMaxDist.E, dx);
            else if (strip.direction === 'W') s.axisMaxDist.W = Math.max(s.axisMaxDist.W, -dx);
        }
    }

    _updateLayerMaxDist(s) {
        if (!s.layerMaxDist) s.layerMaxDist = {};
        const scx = s.genOriginX || 0, scy = s.genOriginY || 0;

        // Reset for 0 and 1 only
        s.layerMaxDist[0] = { N: 0, S: 0, E: 0, W: 0 };
        s.layerMaxDist[1] = { N: 0, S: 0, E: 0, W: 0 };

        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const l = b.layer;
            if (l > 1) continue;
            
            const md = s.layerMaxDist[l];
            const rx = b.x - scx, ry = b.y - scy;

            if (ry < 0) md.N = Math.max(md.N, -ry);
            if (ry + b.h - 1 > 0) md.S = Math.max(md.S, ry + b.h - 1);
            if (rx < 0) md.W = Math.max(md.W, -rx);
            if (rx + b.w - 1 > 0) md.E = Math.max(md.E, rx + b.w - 1);
        }
    }

    _attemptV2Growth() {
        if (this.expansionComplete && !this.manualStep) return;
        
        // Ensure sub-layers (especially discovery layer 1) are synced with foundation (layer 0)
        this._syncSubLayers();
        
        const s = this.behaviorState;
        this._updateAxisMaxDist(s);
        this._updateLayerMaxDist(s);

        // One-time per step calculation of outsideMap if any edge-mode behavior is active
        s.outsideMap = null;
        const _needsOutside = !!this._getGenConfig('HoleFillerEnabled') ||
            [...this.growthPool.values()].some(b => b.enabled && b.growth === 'edge');
        if (_needsOutside) {
            s.outsideMap = this._computeTrueOutside(this.logicGridW, this.logicGridH);
        }

        if (s.pendingDeletions && s.pendingDeletions.length > 0) {
            for (const d of s.pendingDeletions) this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
            s.pendingDeletions = [];
        }
        if (!s.seedSchedule) {
            s.pattern = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            if (!s.layerDirs) {
                const qCount = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
                const qMaxLayer = this._getMaxLayer();
                const qBaseLife = 4 + Math.floor(Math.random() * 3);
                const usePromotion = (this.name === "QuantizedBlockGenerator" || this.getConfig('SingleLayerMode'));
                const minL = usePromotion ? 1 : 0;

                s.layerDirs = {}; s.layerDirLife = {};
                for (let l = minL; l <= qMaxLayer; l++) { 
                    s.layerDirs[l] = this._pickLayerDirs(qCount); 
                    s.layerDirLife[l] = qBaseLife + l; 
                }
            }
            s.seedSchedule = this._generateSeedSchedule(s.genOriginX ?? 0, s.genOriginY ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }
        s.growTimer++;
        this.actionBuffer = [];
        this._tickLayerDirs(s);
        this._updateFillRatio(s);
        if (this._getGenConfig('SpinesFirstEnabled') !== false) {
            this._seedStrips(s);
            this._tickStrips(s);
        }
        this._expandInsideOut(s);

        // INCREMENT AGE OF ALL ACTIVE BLOCKS
        for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

        // Promote hole_filler to core behavior at high fill ratios so it runs every step
        const hf = this.growthPool.get('hole_filler');
        if (hf) {
            if ((s.fillRatio || 0) > 0.90) {
                hf.type = 'core';
                hf.enabled = true;
            } else {
                hf.type = this._getGenConfig('HoleFillerBehaviorType') ?? 'pool';
            }
        }

        if (!this._enabledPoolBehaviorsBuf) this._enabledPoolBehaviorsBuf = [];
        const poolBehaviors = this._enabledPoolBehaviorsBuf;
        poolBehaviors.length = 0;

        const minL = this._getMinLayer();
        const maxL = this._getMaxLayer();
        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled) {
                if (b.type === 'core') {
                    for (let l = minL; l <= maxL; l++) {
                        b.fn.call(this, s, b, l);
                    }
                } else {
                    poolBehaviors.push(b);
                }
            }
        }

        if (poolBehaviors.length > 0) {
            const b = poolBehaviors[Math.floor(Math.random() * poolBehaviors.length)];
            for (let l = minL; l <= maxL; l++) {
                b.fn.call(this, s, b, l);
            }
        }

        this._processIntents();
        if (this._visibleFillRatio >= 0.5 && this._getGenConfig('InsideOutSnapToEdges') !== false) {
            this._snapToEdges();
        }
        s.step++;
        this._updateRenderGridLogic();
        this._updateVisibleEmptyCount();
        if (this._isCanvasFullyCovered()) this.expansionComplete = true;
    }

    _isOccupied(x, y, layer) {
        const gx = this._gridCX + x, gy = this._gridCY + y;
        if (gx < 0 || gx >= this.logicGridW || gy < 0 || gy >= this.logicGridH) return false;
        const grid = this.layerGrids[layer];
        return !!grid && grid[gy * this.logicGridW + gx] !== -1;
    }

    _removeBlock(x, y, w, h, layer, fade = true) {
        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        this.maskOps.push({ type: 'removeBlock', x1, y1, x2, y2, layer: layer, startFrame: this.animFrame, fade: fade });
        
        // Record to sequence for Editor/Step support
        const isRecording = (this.manualStep) && this.sequence && !this.isReconstructing;
        if (isRecording) {
            const targetIdx = Math.max(0, this.expansionPhase - 1);
            if (!this.sequence[targetIdx]) this.sequence[targetIdx] = [];
            this.sequence[targetIdx].push({
                op: 'removeBlock',
                args: [x1, y1, x2, y2, layer, 0, !fade],
                layer: layer
            });
        }

        // Splice instead of .filter() to avoid creating a new array each removal
        for (let i = this.activeBlocks.length - 1; i >= 0; i--) {
            const b = this.activeBlocks[i];
            if (b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h) {
                this.activeBlocks.splice(i, 1);
                break;
            }
        }
        this._writeToGrid(x, y, w, h, -1, layer);
        this._gridsDirty = true; this._maskDirty = true;
    }

    onExpansionComplete() {
        this._log(`[${this.name}] Expansion complete: canvas covered.`);
    }

    stop() {
        if (this._savedBrightness !== null) {
            this.c.state.brightness = this._savedBrightness;
            this._savedBrightness = null;
        }

        QuantizedBaseEffect.isAnyQuantizedSwapping = false;
        this.active = false;
        this.state = 'IDLE';
        this.alpha = 0.0;
        this.expansionPhase = 0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        window.removeEventListener('keydown', this._boundDebugHandler);
        if (this.g) this.g.clearAllOverrides();
        this.shadowGrid = null;
        this.shadowSim = null;
    }
}

// Mix procedural engine methods into QuantizedBaseEffect
Object.getOwnPropertyNames(_QuantizedProceduralEngine.prototype)
    .filter(name => name !== 'constructor')
    .forEach(name => {
        QuantizedBaseEffect.prototype[name] =
            _QuantizedProceduralEngine.prototype[name];
    });
console.log('QuantizedProceduralEngine loaded');
