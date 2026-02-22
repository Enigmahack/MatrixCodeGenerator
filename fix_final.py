import os

file_path = r'C:\\Users\\Gamer-PC\\Documents\\MatrixCodeGenerator\\MatrixCode_v8.5\\js\\effects\\QuantizedBlockGeneration.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_procedural_logic = """    _initProceduralState() {
        if (this.proceduralInitiated) return;
        super._initProceduralState(); 
        
        // Tracks columns (wings) or axes that have reached the finish limit
        this.finishedBranches = new Set();

        // Ensure center block is seeded on all key layers to provide full coverage
        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (let l = 0; l <= 2; l++) {
            if (this.layerGrids[l] && this.layerGrids[l][cy * w + cx] === -1) {
                this._spawnBlock(0, 0, 1, 1, l, false, 0, true, true, true, false, true);
            }
        }
    }

    /**
     * Aggressively maintains structural integrity using flood-fill reachability.
     * Prevents holes of any size (1x1, 2x2, etc.) and prunes isolated islands.
     */
    _maintainStructuralIntegrity() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        const bs = this.getBlockSize();
        const xVisible = Math.ceil(this.g.cols / bs.w / 2);
        const yVisible = Math.ceil(this.g.rows / bs.h / 2);

        // --- 1. Robust Hole Detection (BFS Reachability) ---
        // We find all cells that can reach the "Outside Void"
        // Any empty cell that CANNOT reach the outside is a hole.
        
        const minX = -xVisible - 2, maxX = 2;
        const minY = -yVisible - 2, maxY = 2;
        const scanW = maxX - minX + 1;
        const scanH = maxY - minY + 1;
        
        const reachGrid = new Uint8Array(scanW * scanH); // 0: unknown, 1: outside, 2: block
        const getIdx = (bx, by) => (by - minY) * scanW + (bx - minX);

        // Mark existing blocks (Union of L1 and L2)
        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                const gx = cx + bx, gy = cy + by;
                if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
                if (this.layerGrids[1][gy * w + gx] !== -1 || this.layerGrids[2][gy * w + gx] !== -1) {
                    reachGrid[getIdx(bx, by)] = 2;
                }
            }
        }

        // BFS from the outer perimeter of the scan box to find "Outside"
        const queue = [];
        const pushIfOutside = (bx, by) => {
            if (bx < minX || bx > maxX || by < minY || by > maxY) return;
            const idx = getIdx(bx, by);
            if (reachGrid[idx] === 0) {
                reachGrid[idx] = 1;
                queue.push({x: bx, y: by});
            }
        };

        // Seed BFS from the edges
        for (let x = minX; x <= maxX; x++) { pushIfOutside(x, minY); pushIfOutside(x, maxY); }
        for (let y = minY; y <= maxY; y++) { pushIfOutside(minX, y); pushIfOutside(maxX, y); }

        while (queue.length > 0) {
            const curr = queue.shift();
            const ds = [[1,0], [-1,0], [0,1], [0,-1]];
            for (const [dx, dy] of ds) {
                pushIfOutside(curr.x + dx, curr.y + dy);
            }
        }

        // Any cell in the NW quadrant that is 0 (unknown/enclosed) is a hole.
        for (let bx = -xVisible - 1; bx <= 0; bx++) {
            for (let by = -yVisible - 1; by <= 0; by++) {
                const idx = getIdx(bx, by);
                if (reachGrid[idx] === 0) {
                    // HOLE DETECTED: Weld it shut permanently.
                    for (let l = 0; l <= 2; l++) {
                        const gx = cx + bx, gy = cy + by;
                        if (gx >= 0 && gx < w && gy >= 0 && gy < h && this.layerGrids[l][gy * w + gx] === -1) {
                            this._spawnBlock(bx, by, 1, 1, l, false, 0, true, true, true, false, true);
                        }
                    }
                }
            }
        }

        // --- 2. Island Detection & Pruning ---
        for (let l = 1; l <= 2; l++) {
            for (let bx = -xVisible - 1; bx <= 0; bx++) {
                for (let by = -yVisible - 1; by <= 0; by++) {
                    if (bx === 0 && by === 0) continue;
                    const gx = cx + bx, gy = cy + by;
                    if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;

                    if (this.layerGrids[l][gy * w + gx] !== -1) {
                        let neighbors = 0;
                        const ds = [[1,0], [-1,0], [0,1], [0,-1]];
                        for (const [dx, dy] of ds) {
                            const nx = gx + dx, ny = gy + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                if (this.layerGrids[l][ny * w + nx] !== -1) neighbors++;
                            }
                        }
                        if (neighbors === 0) {
                            // Isolated island: Prune it.
                            this.maskOps.push({ type: 'removeBlock', x1: bx, y1: by, x2: bx, y2: by, layer: l, startFrame: this.animFrame, fade: false });
                            this.activeBlocks = this.activeBlocks.filter(b => !(b.x === bx && b.y === by && b.layer === l));
                            this.layerGrids[l][gy * w + gx] = -1;
                            this._gridsDirty = true;
                        }
                    }
                }
            }
        }
    }

    /**
     * Finds the last occupied block (tip) of a branch and occasionally removes it.
     */
    _revertFrontier(ox, oy, dx, dy, layer, chance, branchId) {
        if (this.finishedBranches.has(branchId)) return false;
        if (layer === 0) return false;
        if (Math.random() > chance) return false;

        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

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
            this._gridsDirty = true; return true;
        }
        return false;
    }

    _attemptGrowth() {
        if (this.expansionComplete) return;
        this._initProceduralState(); 
        this._updateInternalLogicGrid();

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const chance = 0.66;
        const reversionChance = 0.15;

        const bs = this.getBlockSize();
        const xVisible = Math.ceil(this.g.cols / bs.w / 2);
        const yVisible = Math.ceil(this.g.rows / bs.h / 2);
        const xGrowthLimit = xVisible + 3;
        const yGrowthLimit = yVisible + 3;
        const xFinishLimit = xVisible + 1;
        const yFinishLimit = yVisible + 1;

        const ratio = this.g.cols / this.g.rows;
        const xBias = Math.max(1.0, ratio);
        const yBias = Math.max(1.0, 1.0 / ratio);

        const getBurst = (bias) => {
            let b = 1;
            if (bias > 1.2) {
                if (Math.random() < (bias - 1.0) * 0.8) b = 2;
                if (b === 2 && Math.random() < (bias - 2.0) * 0.5) b = 3;
            }
            return b;
        };

        const xBurst = getBurst(xBias);
        const yBurst = getBurst(yBias);

        const getGridVal = (layer, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2; 
            return this.layerGrids[layer][gy * w + gx];
        };

        // --- 1. X-Axis Spine Growth (West) ---
        const spineWestId = 'spine_west';
        let swFinished = this.finishedBranches.has(spineWestId);
        if (!swFinished) {
            for (let l = 1; l <= 2; l++) {
                let freeX = -1;
                while (true) {
                    const val = getGridVal(l, freeX, 0);
                    if (val === -2 || Math.abs(freeX) >= xFinishLimit) { if (l === 2) swFinished = true; break; }
                    if (val === -1) break;
                    freeX--;
                }
                if (Math.abs(freeX) < xFinishLimit && Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = freeX - b;
                        if (getGridVal(l, tx, 0) === -1 && Math.abs(tx) <= xGrowthLimit) {
                            this._spawnBlock(tx, 0, 1, 1, l, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
            }
            if (swFinished) this.finishedBranches.add(spineWestId);
        }

        // --- 2. Y-Axis Spine Growth (North) ---
        const spineNorthId = 'spine_north';
        let snFinished = this.finishedBranches.has(spineNorthId);
        if (!snFinished) {
            for (let l = 1; l <= 2; l++) {
                let freeY = -1;
                while (true) {
                    const val = getGridVal(l, 0, freeY);
                    if (val === -2 || Math.abs(freeY) >= yFinishLimit) { if (l === 1) snFinished = true; break; }
                    if (val === -1) break;
                    freeY--;
                }
                if (Math.abs(freeY) < yFinishLimit && Math.random() < chance) {
                    for (let b = 0; b < yBurst; b++) {
                        const ty = freeY - b;
                        if (getGridVal(l, 0, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                            this._spawnBlock(0, ty, 1, 1, l, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
            }
            if (snFinished) this.finishedBranches.add(spineNorthId);
        }

        // --- 3. Follower Foundations for Spines ---
        for (let x = -1; x >= -xGrowthLimit; x--) {
            if (getGridVal(0, x, 0) === -1 && (getGridVal(1, x, 0) !== -1 || getGridVal(2, x, 0) !== -1)) {
                if (Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = x - b;
                        if (getGridVal(0, tx, 0) === -1 && (getGridVal(1, tx, 0) !== -1 || getGridVal(2, tx, 0) !== -1)) {
                            this._spawnBlock(tx, 0, 1, 1, 0, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                break;
            }
        }
        for (let y = -1; y >= -yGrowthLimit; y--) {
            if (getGridVal(0, 0, y) === -1 && (getGridVal(1, 0, y) !== -1 || getGridVal(2, 0, y) !== -1)) {
                if (Math.random() < chance) {
                    for (let b = 0; b < yBurst; b++) {
                        const ty = y - b;
                        if (getGridVal(0, 0, ty) === -1 && (getGridVal(1, 0, ty) !== -1 || getGridVal(2, 0, ty) !== -1)) {
                            this._spawnBlock(0, ty, 1, 1, 0, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                break;
            }
        }

        // --- 4. Wings from Spines ---
        for (let x = -1; ; x--) {
            if ((getGridVal(1, x, 0) === -1 && getGridVal(2, x, 0) === -1) || getGridVal(1, x, 0) === -2) break;
            const branchId = `wing_n_${x}`;
            let wingFinished = this.finishedBranches.has(branchId), wingFreeY = -1;
            if (!wingFinished) {
                while (true) {
                    const val = getGridVal(1, x, wingFreeY);
                    if (val === -2 || Math.abs(wingFreeY) >= yFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                    if (val === -1) break;
                    wingFreeY--;
                }
            }
            if (!wingFinished) {
                if (Math.random() < chance) {
                    for (let b = 0; b < yBurst; b++) {
                        const ty = wingFreeY - b;
                        if (getGridVal(1, x, ty) === -1 && Math.abs(ty) <= yGrowthLimit) { this._spawnBlock(x, ty, 1, 1, 1, false, 0, true, true, true, false, true); }
                        else break;
                    }
                }
                this._revertFrontier(x, 0, 0, -1, 1, reversionChance, branchId);
            }
            const wLimit = wingFinished ? yGrowthLimit : Math.abs(wingFreeY);
            for (let y = -1; Math.abs(y) <= wLimit; y--) {
                if (getGridVal(0, x, y) === -1 && getGridVal(1, x, y) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = y - b;
                            if (getGridVal(0, x, ty) === -1 && getGridVal(1, x, ty) !== -1) { this._spawnBlock(x, ty, 1, 1, 0, false, 0, true, true, true, false, true); }
                            else break;
                        }
                    }
                    break;
                }
            }
        }

        for (let y = -1; ; y--) {
            if ((getGridVal(1, 0, y) === -1 && getGridVal(2, 0, y) === -1) || getGridVal(1, 0, y) === -2) break;
            const branchId = `wing_w_${y}`;
            let wingFinished = this.finishedBranches.has(branchId), wingFreeX = -1;
            if (!wingFinished) {
                while (true) {
                    const val = getGridVal(2, wingFreeX, y);
                    if (val === -2 || Math.abs(wingFreeX) >= xFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                    if (val === -1) break;
                    wingFreeX--;
                }
            }
            if (!wingFinished) {
                if (Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = wingFreeX - b;
                        if (getGridVal(2, tx, y) === -1 && Math.abs(tx) <= xGrowthLimit) { this._spawnBlock(tx, y, 1, 1, 2, false, 0, true, true, true, false, true); }
                        else break;
                    }
                }
                this._revertFrontier(0, y, -1, 0, 2, reversionChance, branchId);
            }
            const wLimit = wingFinished ? xGrowthLimit : Math.abs(wingFreeX);
            for (let x = -1; Math.abs(x) <= wLimit; x--) {
                if (getGridVal(0, x, y) === -1 && getGridVal(2, x, y) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x - b;
                            if (getGridVal(0, tx, y) === -1 && getGridVal(2, tx, y) !== -1) { this._spawnBlock(tx, y, 1, 1, 0, false, 0, true, true, true, false, true); }
                            else break;
                        }
                    }
                    break;
                }
            }
        }

        // --- 5. Aggressive Structural Integrity (Flood-Fill BFS) ---
        this._maintainStructuralIntegrity();

        this._updateInternalLogicGrid();
    }
"""

# Find indices for replacement
start_tag = "_initProceduralState() {"
end_tag = "this._updateInternalLogicGrid();"

start_idx = -1
end_idx = -1

for i in range(len(lines)):
    if start_tag in lines[i]:
        start_idx = i
        break

if start_idx != -1:
    current_idx = start_idx
    while current_idx < len(lines):
        if end_tag in lines[current_idx]:
            for j in range(current_idx + 1, len(lines)):
                if '}' in lines[j]:
                    end_idx = j
                    current_idx = j
                    break
            else:
                break
        else:
            current_idx += 1

if start_idx != -1 and end_idx != -1:
    final_lines = lines[:start_idx] + [new_procedural_logic] + lines[end_idx+1:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
    print("Success")
else:
    print(f"Failed: start={start_idx}, end={end_idx}")
