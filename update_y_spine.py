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
        const xBurst = (ratio > 1.2) ? (Math.random() < 0.8 ? 2 : 3) : 1;
        const yBurst = (ratio < 0.8) ? (Math.random() < 0.8 ? 2 : 3) : 1;

        const getGridVal = (layer, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2; // OOB
            return this.layerGrids[layer][gy * w + gx];
        };

        // --- 1. Y-Axis Spine Growth (North) ---
        // Spine uses Layer 1 as the leader
        const spineId = 'spine_north';
        let spineAtEdge = this.finishedBranches.has(spineId);
        let spineFreeY = -1;

        if (!spineAtEdge) {
            while (true) {
                const val = getGridVal(1, 0, spineFreeY);
                if (val === -2 || Math.abs(spineFreeY) >= yFinishLimit) {
                    spineAtEdge = true;
                    this.finishedBranches.add(spineId);
                    break;
                }
                if (val === -1) break;
                spineFreeY--;
            }
        }

        if (!spineAtEdge) {
            if (Math.random() < chance) {
                for (let b = 0; b < yBurst; b++) {
                    const ty = spineFreeY - b;
                    if (getGridVal(1, 0, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                        this._spawnBlock(0, ty, 1, 1, 1, false, 0, true, true, true, false, true);
                    } else break;
                }
            }
            // Spines never revert
        }

        // Layer 0 Spine Follower (Trails Layer 1)
        const spineSearchLimitY = spineAtEdge ? yGrowthLimit : Math.abs(spineFreeY);
        for (let y = -1; Math.abs(y) <= spineSearchLimitY; y--) {
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

        // --- 2. Perpendicular Wing Growth (West from Spine) ---
        // Wings use Layer 2 as the leader
        for (let y = -1; ; y--) {
            // Stop scanning if we hit the end of the establish North spine (L1)
            if (getGridVal(1, 0, y) === -1 || getGridVal(1, 0, y) === -2) break;

            const branchId = `wing_w_${y}`;
            let wingAtEdge = this.finishedBranches.has(branchId);
            let wingFreeX = -1;

            if (!wingAtEdge) {
                while (true) {
                    const val = getGridVal(2, wingFreeX, y);
                    if (val === -2 || Math.abs(wingFreeX) >= xFinishLimit) {
                        wingAtEdge = true;
                        this.finishedBranches.add(branchId);
                        break;
                    }
                    if (val === -1) break;
                    wingFreeX--;
                }
            }

            if (!wingAtEdge) {
                if (Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = wingFreeX - b;
                        if (getGridVal(2, tx, y) === -1 && Math.abs(tx) <= xGrowthLimit) {
                            this._spawnBlock(tx, y, 1, 1, 2, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                // Wing Reversion (Only if not at edge, targeting Layer 2)
                this._revertFrontier(0, y, -1, 0, 2, reversionChance, branchId);
            }

            // Layer 0 Wing Follower (Trails Layer 2)
            const wingSearchLimitX = wingAtEdge ? xGrowthLimit : Math.abs(wingFreeX);
            for (let x = -1; Math.abs(x) <= wingSearchLimitX; x--) {
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
