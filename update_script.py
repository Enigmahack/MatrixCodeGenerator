import os

file_path = r'C:\Users\Gamer-PC\Documents\MatrixCodeGenerator\MatrixCode_v8.5\js\effects\QuantizedBlockGeneration.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
in_init = False
in_revert = False
in_attempt = False

# We will rewrite the relevant section completely
procedural_state = """    _initProceduralState() {
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
            // 3. Safeguard: If Layer 0 is present at the tip, it is permanent.
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

        // --- 1. X-Axis Spine Growth (West and East) ---
        const spines = [
            { id: 'spine_west', dx: -1 },
            { id: 'spine_east', dx: 1 }
        ];

        for (const spine of spines) {
            let spineFinished = this.finishedBranches.has(spine.id);
            let spineFreeX = spine.dx;

            if (!spineFinished) {
                while (true) {
                    const val = getGridVal(maxLayer, spineFreeX, 0);
                    if (val === -2 || Math.abs(spineFreeX) >= xFinishLimit) {
                        spineFinished = true;
                        this.finishedBranches.add(spine.id);
                        break;
                    }
                    if (val === -1) break;
                    spineFreeX += spine.dx;
                }
            }

            if (!spineFinished) {
                if (Math.random() < chance) {
                    for (let b = 0; b < xBurst; b++) {
                        const tx = spineFreeX + (b * spine.dx);
                        if (getGridVal(maxLayer, tx, 0) === -1 && Math.abs(tx) <= xGrowthLimit) {
                            this._spawnBlock(tx, 0, 1, 1, maxLayer, false, 0, true, true, true, false, true);
                        } else break;
                    }
                }
                // Spines never revert
            }

            // Layer 0 Spine Follower
            const searchLimitX = spineFinished ? xGrowthLimit : Math.abs(spineFreeX);
            for (let x = spine.dx; Math.abs(x) <= searchLimitX; x += spine.dx) {
                if (getGridVal(0, x, 0) === -1 && getGridVal(maxLayer, x, 0) !== -1) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x + (b * spine.dx);
                            if (getGridVal(0, tx, 0) === -1 && getGridVal(maxLayer, tx, 0) !== -1) {
                                this._spawnBlock(tx, 0, 1, 1, 0, false, 0, true, true, true, false, true);
                            } else break;
                        }
                    }
                    break; 
                }
            }
        }

        // --- 2. Perpendicular Wing Growth (North and South) ---
        // Discover current spine bounds
        let minX = 0, maxX = 0;
        for (let x = -1; ; x--) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { minX = x + 1; break; } }
        for (let x = 1; ; x++) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { maxX = x - 1; break; } }

        for (let x = minX; x <= maxX; x++) {
            const directions = [{ id: 'n', dy: -1 }, { id: 's', dy: 1 }];
            for (const d of directions) {
                const branchId = `wing_${d.id}_${x}`;
                let wingFinished = this.finishedBranches.has(branchId);
                let wingFreeY = d.dy;

                if (!wingFinished) {
                    while (true) {
                        const val = getGridVal(maxLayer, x, wingFreeY);
                        if (val === -2 || Math.abs(wingFreeY) >= yFinishLimit) {
                            wingFinished = true;
                            this.finishedBranches.add(branchId);
                            break;
                        }
                        if (val === -1) break;
                        wingFreeY += d.dy;
                    }
                }

                if (!wingFinished) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = wingFreeY + (b * d.dy);
                            if (getGridVal(maxLayer, x, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                                this._spawnBlock(x, ty, 1, 1, maxLayer, false, 0, true, true, true, false, true);
                            } else break;
                        }
                    }
                    this._revertFrontier(x, 0, 0, d.dy, maxLayer, reversionChance, branchId);
                }

                // Layer 0 Wing Follower
                const searchLimitY = wingFinished ? yGrowthLimit : Math.abs(wingFreeY);
                for (let y = d.dy; Math.abs(y) <= searchLimitY; y += d.dy) {
                    if (getGridVal(0, x, y) === -1 && getGridVal(maxLayer, x, y) !== -1) {
                        if (Math.random() < chance) {
                            for (let b = 0; b < yBurst; b++) {
                                const ty = y + (b * d.dy);
                                if (getGridVal(0, x, ty) === -1 && getGridVal(maxLayer, x, ty) !== -1) {
                                    this._spawnBlock(x, ty, 1, 1, 0, false, 0, true, true, true, false, true);
                                } else break;
                            }
                        }
                        break;
                    }
                }
            }
        }

        this._updateInternalLogicGrid();
    }
"""

# Find the start of _initProceduralState and the end of _attemptGrowth
start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if '_initProceduralState()' in line and start_idx == -1:
        start_idx = i
    if '_updateInternalLogicGrid()' in line and start_idx != -1:
        # We want the SECOND _updateInternalLogicGrid call which is at the end of _attemptGrowth
        # Wait, there might be more. Let's look for the closing brace of _attemptGrowth.
        pass

# Refined search for indices
for i in range(len(lines)):
    if '_initProceduralState()' in lines[i]:
        start_idx = i
    if 'this._updateInternalLogicGrid();' in lines[i] and start_idx != -1:
        # Found end of _attemptGrowth (approx)
        # Scan for the next '}'
        for j in range(i+1, len(lines)):
            if '}' in lines[j]:
                end_idx = j
                break
        break

if start_idx != -1 and end_idx != -1:
    final_lines = lines[:start_idx] + [procedural_state] + lines[end_idx+1:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
    print("Success")
else:
    print(f"Failed to find indices: {start_idx}, {end_idx}")
