import os

file_path = r'C:\Users\Gamer-PC\Documents\MatrixCodeGenerator\MatrixCode_v8.5\js\effects\QuantizedBlockGeneration.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_procedural_logic = """    _initProceduralState() {
        if (this.proceduralInitiated) return;
        super._initProceduralState(); 
        
        // Tracks columns (wings) or axes that have reached the finish limit
        this.finishedBranches = new Set();
    }

    /**
     * Finds the last occupied block (tip) of a branch and occasionally removes it.
     */
    _revertFrontier(ox, oy, dx, dy, layer, chance, branchId) {
        // 1. Safeguard: If the branch is finished, it never reverts.
        if (this.finishedBranches.has(branchId)) return false;
        
        // 2. Safeguard: Layer 0 is PERMANENT and can never be reverted.
        if (layer === 0) return false;

        if (Math.random() > chance) return false;

        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return false;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        // Find the last occupied block (tip) along this ray
        let tx = ox, ty = oy;
        let lastOccupied = null;
        
        const isOcc = (l, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return false;
            return this.layerGrids[l][gy * w + gx] !== -1;
        };

        while (true) {
            const ntx = tx + dx, nty = ty + dy;
            if (!isOcc(layer, ntx, nty)) break;
            tx = ntx; ty = nty;
            lastOccupied = { x: tx, y: ty };
            if (Math.abs(tx) > w || Math.abs(ty) > h) break;
        }

        if (lastOccupied && (lastOccupied.x !== 0 || lastOccupied.y !== 0)) {
            // 3. Safeguard: Once a block is written by layer 0, it is permanent.
            if (isOcc(0, lastOccupied.x, lastOccupied.y)) return false;

            this.maskOps.push({
                type: 'removeBlock',
                x1: lastOccupied.x, y1: lastOccupied.y, x2: lastOccupied.x, y2: lastOccupied.y,
                layer: layer,
                startFrame: this.animFrame,
                fade: false
            });
            this.activeBlocks = this.activeBlocks.filter(b => !(b.x === lastOccupied.x && b.y === lastOccupied.y && b.layer === layer));
            this.layerGrids[layer][(cy + lastOccupied.y) * w + (cx + lastOccupied.x)] = -1;
            this._gridsDirty = true;
            return true;
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
        const maxLayer = this.getConfig('LayerCount') || 1;

        // --- Canvas Bounds Safeguard ---
        const bs = this.getBlockSize();
        const xVisible = Math.ceil(this.g.cols / bs.w / 2);
        const yVisible = Math.ceil(this.g.rows / bs.h / 2);
        const xGrowthLimit = xVisible + 3;
        const yGrowthLimit = yVisible + 3;
        const xFinishLimit = xVisible + 1;
        const yFinishLimit = yVisible + 1;

        // --- Aspect Ratio Scaling Logic ---
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
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2; // OOB
            return this.layerGrids[layer][gy * w + gx];
        };

        // --- 1. X-Axis Spine Growth (West) ---
        // Spine West leads with Layer 2 (per request)
        const spineWestId = 'spine_west';
        let swFinished = this.finishedBranches.has(spineWestId);
        let swFreeX = -1;
        if (!swFinished) {
            while (true) {
                const val = getGridVal(2, swFreeX, 0);
                if (val === -2 || Math.abs(swFreeX) >= xFinishLimit) {
                    swFinished = true;
                    this.finishedBranches.add(spineWestId);
                    break;
                }
                if (val === -1) break;
                swFreeX--;
            }
        }
        if (!swFinished) {
            if (Math.random() < chance) {
                for (let b = 0; b < xBurst; b++) {
                    const tx = swFreeX - b;
                    if (getGridVal(2, tx, 0) === -1 && Math.abs(tx) <= xGrowthLimit) {
                        this._spawnBlock(tx, 0, 1, 1, 2, false, 0, true, true, true, false, true);
                    } else break;
                }
            }
        }

        // --- 2. Y-Axis Spine Growth (North) ---
        // Spine North leads with Layer 1
        const spineNorthId = 'spine_north';
        let snFinished = this.finishedBranches.has(spineNorthId);
        let snFreeY = -1;
        if (!snFinished) {
            while (true) {
                const val = getGridVal(snFinished ? 0 : 1, 0, snFreeY);
                if (val === -2 || Math.abs(snFreeY) >= yFinishLimit) {
                    snFinished = true;
                    this.finishedBranches.add(spineNorthId);
                    break;
                }
                if (val === -1) break;
                snFreeY--;
            }
        }
        if (!snFinished) {
            if (Math.random() < chance) {
                for (let b = 0; b < yBurst; b++) {
                    const ty = snFreeY - b;
                    if (getGridVal(1, 0, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                        this._spawnBlock(0, ty, 1, 1, 1, false, 0, true, true, true, false, true);
                    } else break;
                }
            }
        }

        // --- 3. Follower Foundations for Spines ---
        // L0 follows L2 on West Spine
        const swLimit = swFinished ? xGrowthLimit : Math.abs(swFreeX);
        for (let x = -1; Math.abs(x) <= swLimit; x--) {
            if (getGridVal(0, x, 0) === -1 && getGridVal(2, x, 0) !== -1) {
                if (Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = x - b;
                        if (getGridVal(0, tx, 0) === -1 && getGridVal(2, tx, 0) !== -1) {
                            this._spawnBlock(tx, 0, 1, 1, 0, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                break;
            }
        }
        // L0 follows L1 on North Spine
        const snLimit = snFinished ? yGrowthLimit : Math.abs(snFreeY);
        for (let y = -1; Math.abs(y) <= snLimit; y--) {
            if (getGridVal(0, 0, y) === -1 && getGridVal(1, 0, y) !== -1) {
                if (Math.random() < chance) {
                    for (let b = 0; b < yBurst; b++) {
                        const ty = y - b;
                        if (getGridVal(0, 0, ty) === -1 && getGridVal(1, 0, ty) !== -1) {
                            this._spawnBlock(0, ty, 1, 1, 0, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                break;
            }
        }

        // --- 4. Wings from Spines ---
        // North Wings from West Spine (Lead L1)
        for (let x = -1; ; x--) {
            if (getGridVal(2, x, 0) === -1 || getGridVal(2, x, 0) === -2) break;
            const branchId = `wing_n_${x}`;
            let wingFinished = this.finishedBranches.has(branchId);
            let wingFreeY = -1;
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
                        if (getGridVal(1, x, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                            this._spawnBlock(x, ty, 1, 1, 1, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                this._revertFrontier(x, 0, 0, -1, 1, reversionChance, branchId);
            }
            // Follow L1
            const wLimit = wingFinished ? yGrowthLimit : Math.abs(wingFreeY);
            for (let y = -1; Math.abs(y) <= wLimit; y--) {
                if (getGridVal(0, x, y) === -1 && getGridVal(1, x, y) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = y - b;
                            if (getGridVal(0, x, ty) === -1 && getGridVal(1, x, ty) !== -1) {
                                this._spawnBlock(x, ty, 1, 1, 0, false, 0, true, true, true, false, true);
                            } else break;
                        }
                    }
                    break;
                }
            }
        }

        // West Wings from North Spine (Lead L2)
        for (let y = -1; ; y--) {
            if (getGridVal(1, 0, y) === -1 || getGridVal(1, 0, y) === -2) break;
            const branchId = `wing_w_${y}`;
            let wingFinished = this.finishedBranches.has(branchId);
            let wingFreeX = -1;
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
                        if (getGridVal(2, tx, y) === -1 && Math.abs(tx) <= xGrowthLimit) {
                            this._spawnBlock(tx, y, 1, 1, 2, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                this._revertFrontier(0, y, -1, 0, 2, reversionChance, branchId);
            }
            // Follow L2
            const wLimit = wingFinished ? xGrowthLimit : Math.abs(wingFreeX);
            for (let x = -1; Math.abs(x) <= wLimit; x--) {
                if (getGridVal(0, x, y) === -1 && getGridVal(2, x, y) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x - b;
                            if (getGridVal(0, tx, y) === -1 && getGridVal(2, x, y) !== -1) {
                                this._spawnBlock(tx, y, 1, 1, 0, false, 0, true, true, true, false, true);
                            } else break;
                        }
                    }
                    break;
                }
            }
        }

        this._updateInternalLogicGrid();
    }
"""

# Find the indices for replacement
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
