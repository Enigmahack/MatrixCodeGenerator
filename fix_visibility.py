import os

file_path = r'C:\\Users\\Gamer-PC\\Documents\\MatrixCodeGenerator\\MatrixCode_v8.5\\js\\effects\\QuantizedBaseEffect.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_composition_logic = """        const visibleIndices = [0]; // ONLY Layer 0 reveals code fills by default
        const layerGrids = this.layerGrids;

        if (this._gridsDirty) {
            // Full re-composite
            if (!this._lastCoverageRect) {
                this._updateVisibleEmptyCount();
            }
            let emptyCount = 0;
            const r = this._lastCoverageRect;
            
            for (let idx = 0; idx < totalBlocks; idx++) {
                let finalVal = -1;
                let anyActive = false;
                
                // Track LOGIC for all layers
                for (let l = 0; l < 3; l++) {
                    if (layerGrids[l] && layerGrids[l][idx] !== -1) anyActive = true;
                }

                // But RENDER only Layer 0
                if (layerGrids[0] && layerGrids[0][idx] !== -1) {
                    finalVal = layerGrids[0][idx];
                }

                this.renderGrid[idx] = finalVal;
                if (this.logicGrid) this.logicGrid[idx] = anyActive ? 1 : 0;
                
                // Track empty cells in visible area
                const bx = idx % this.logicGridW;
                const by = (idx / this.logicGridW) | 0;
                if (finalVal === -1 && bx >= r.startX && bx < r.endX && by >= r.startY && by < r.endY) {
                    emptyCount++;
                }
            }
            this._visibleEmptyCount = emptyCount;
            this._gridsDirty = false;
        } else if (dirtyRects.length > 0) {
            // Incremental re-composite for affected areas
            const r = this._lastCoverageRect;
            if (!r || this._visibleEmptyCount === -1) {
                this._updateVisibleEmptyCount();
            }

            for (const rect of dirtyRects) {
                const minX = Math.max(0, cx + rect.x1);
                const maxX = Math.min(this.logicGridW - 1, cx + rect.x2);
                const minY = Math.max(0, cy + rect.y1);
                const maxY = Math.min(this.logicGridH - 1, cy + rect.y2);

                for (let by = minY; by <= maxY; by++) {
                    const rowOff = by * this.logicGridW;
                    for (let gx = minX; gx <= maxX; gx++) {
                        const idx = rowOff + gx;
                        const wasEmpty = (this.renderGrid[idx] === -1);
                        const isVisible = (r && bx >= r.startX && bx < r.endX && by >= r.startY && by < r.endY);

                        let finalVal = -1;
                        let anyActive = false;
                        for (let l = 0; l < 3; l++) {
                            if (layerGrids[l] && layerGrids[l][idx] !== -1) anyActive = true;
                        }
                        if (layerGrids[0] && layerGrids[0][idx] !== -1) {
                            finalVal = layerGrids[0][idx];
                        }

                        this.renderGrid[idx] = finalVal;
                        if (this.logicGrid) this.logicGrid[idx] = anyActive ? 1 : 0;

                        const isEmpty = (finalVal === -1);
                        if (isVisible) {
                            if (wasEmpty && !isEmpty) this._visibleEmptyCount--;
                            else if (!wasEmpty && isEmpty) this._visibleEmptyCount++;
                        }
                    }
                }
            }
        }
"""

start_tag = "const visibleIndices = this.layerOrder.filter(l => l >= 0 && l <= 2);"
end_tag = "this._lastBlocksX = this.logicGridW;"

start_idx = -1
end_idx = -1

for i in range(len(lines)):
    if start_tag in lines[i]:
        start_idx = i
    if end_tag in lines[i] and start_idx != -1:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    final_lines = lines[:start_idx] + [new_composition_logic] + [lines[end_idx]] + lines[end_idx+1:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
    print("Success")
else:
    print(f"Failed: start={start_idx}, end={end_idx}")
