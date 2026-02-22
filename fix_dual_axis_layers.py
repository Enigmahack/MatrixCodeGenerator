import os

file_path = r'C:\Users\Gamer-PC\Documents\MatrixCodeGenerator\MatrixCode_v8.5\js\effects\QuantizedBlockGeneration.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_attempt_growth = """    _attemptGrowth() {
        if (this.expansionComplete) return;
        this._initProceduralState(); 
        this._updateInternalLogicGrid();

        const w = this.logicGridW, h = this.logicGridH;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        const chance = 0.66;
        const reversionChance = 0.15;

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
        // Expand both L1 and L2 on the West Spine
        const spineWestId = 'spine_west';
        let swFinished = this.finishedBranches.has(spineWestId);
        
        if (!swFinished) {
            // Check if ANY leading layer has reached the finish limit
            if (Math.abs(-xVisible - 1) >= xFinishLimit) { // Logic check
                // Actually we scan for the furthest West block on L1 or L2
            }
            
            for (let l = 1; l <= 2; l++) {
                let freeX = -1;
                while (true) {
                    const val = getGridVal(l, freeX, 0);
                    if (val === -2 || Math.abs(freeX) >= xFinishLimit) {
                        if (l === 2) swFinished = true; // Use L2 as the master finish signal for West
                        break;
                    }
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
        // Expand both L1 and L2 on the North Spine
        const spineNorthId = 'spine_north';
        let snFinished = this.finishedBranches.has(spineNorthId);

        if (!snFinished) {
            for (let l = 1; l <= 2; l++) {
                let freeY = -1;
                while (true) {
                    const val = getGridVal(l, 0, freeY);
                    if (val === -2 || Math.abs(freeY) >= yFinishLimit) {
                        if (l === 1) snFinished = true; // Use L1 as the master finish signal for North
                        break;
                    }
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
        // L0 follows ANY active leading layer (L1 or L2) on the axes
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
        
        // North Wings from West Spine (Lead L1)
        for (let x = -1; ; x--) {
            // Root trigger: ANY established block on the West spine
            if ((getGridVal(1, x, 0) === -1 && getGridVal(2, x, 0) === -1) || getGridVal(1, x, 0) === -2) break;

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
            // Follower L0 for North Wings
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
            // Root trigger: ANY established block on the North spine
            if ((getGridVal(1, 0, y) === -1 && getGridVal(2, 0, y) === -1) || getGridVal(1, 0, y) === -2) break;

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
            // Follower L0 for West Wings
            const wLimit = wingFinished ? xGrowthLimit : Math.abs(wingFreeX);
            for (let x = -1; Math.abs(x) <= wLimit; x--) {
                if (getGridVal(0, x, y) === -1 && getGridVal(2, x, y) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x - b;
                            if (getGridVal(0, tx, y) === -1 && getGridVal(2, tx, y) !== -1) {
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
start_tag = "_attemptGrowth() {"
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
            # Scan for the very next '}'
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
    final_lines = lines[:start_idx] + [new_attempt_growth] + lines[end_idx+1:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
    print("Success")
else:
    print(f"Failed: start={start_idx}, end={end_idx}")
