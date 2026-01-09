import re

source_path = 'MatrixCode_v8.5/js/effects/QuantizedPulseEffect.js'

# Simple Distance Field (Edges are MaxDist)
new_compute_dist = r"""    _computeDistanceField(blocksX, blocksY) {
        const size = blocksX * blocksY;
        const dist = new Uint16Array(size); // 0 = Inactive/Boundary
        const maxDist = 999;
        
        // Initialize: Active = maxDist, Inactive = 0
        for (let i = 0; i < size; i++) {
            dist[i] = (this.renderGrid[i] !== -1) ? maxDist : 0;
        }

        // Forward Pass (Top-Left to Bottom-Right)
        for (let y = 0; y < blocksY; y++) {
            for (let x = 0; x < blocksX; x++) {
                const i = y * blocksX + x;
                if (dist[i] === 0) continue; 

                let minVal = maxDist;
                // West
                if (x > 0) minVal = Math.min(minVal, dist[i - 1]);
                
                // North
                if (y > 0) minVal = Math.min(minVal, dist[i - blocksX]);
                
                if (minVal < maxDist) dist[i] = minVal + 1;
            }
        }

        // Backward Pass (Bottom-Right to Top-Left)
        for (let y = blocksY - 1; y >= 0; y--) {
            for (let x = blocksX - 1; x >= 0; x--) {
                const i = y * blocksX + x;
                if (dist[i] === 0) continue;

                let minVal = dist[i];
                // East
                if (x < blocksX - 1) minVal = Math.min(minVal, dist[i + 1] + 1);
                
                // South
                if (y < blocksY - 1) minVal = Math.min(minVal, dist[i + blocksX] + 1);
                
                dist[i] = minVal;
            }
        }
        
        return dist;
    }"

# Update Mask with isBlockPresent logic
new_update_mask = r"""    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const lineWidthX = screenStepX * 0.25;
        const lineWidthY = screenStepY * 0.25;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY
        };

        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const fadeFrames = this.getConfig('FadeFrames') || 0;
        const addDuration = Math.max(1, fadeInFrames);
        const removeDuration = Math.max(1, fadeFrames);

        this.renderGrid.fill(-1);
        
        for (const op of this.maskOps) {
            if (op.startFrame && now < op.startFrame) continue;

            if (op.type === 'add' || op.type === 'addSmart') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = op.startFrame || 0;
                        }
                    }
                }
            } else if (op.type === 'removeBlock') {
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const end = { x: cx + op.x2, y: cy + op.y2 };
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                         if (bx >= 0 && bx < blocksX && by >= 0 && by < blocksY) {
                            this.renderGrid[by * blocksX + bx] = -1;
                        }
                    }
                }
            }
        }

        // --- Distance Field ---
        const distMap = this._computeDistanceField(blocksX, blocksY);
        
        // Check if block should be drawn (Visible)
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            const idx = by * blocksX + bx;
            if (this.renderGrid[idx] === -1) return false;
            // Trail Cleanup Rule: Distance > 4 is hidden
            if (distMap[idx] > 4) return false;
            return true;
        };

        // Check if block exists (Physically Present), even if hidden
        const isBlockPresent = (bx, by) => {
            if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
            const idx = by * blocksX + bx;
            return this.renderGrid[idx] !== -1;
        };
        
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             if (bx < 0 || bx >= blocksX || by < 0 || by >= blocksY) return false;
             const activeStart = this.renderGrid[by * blocksX + bx];
             if (activeStart !== -1 && activeStart > time) return true;
             return false;
        };

        // --- PASS 1: Base Grid ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, op.ext, isRenderActive);
        }

        // --- PASS 1.5: Smart Perimeter ---
        for (const op of this.maskOps) {
            if (op.type !== 'addSmart') continue;

            let opacity = 1.0;
            if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    // Check visibility of SELF
                    if (!isRenderActive(bx, by)) continue;

                    const nN = isRenderActive(bx, by - 1);
                    const nS = isRenderActive(bx, by + 1);
                    const nW = isRenderActive(bx - 1, by);
                    const nE = isRenderActive(bx + 1, by);
                    
                    const isConnected = nN || nS || nW || nE;
                    this._addBlock({x:bx, y:by}, {x:bx, y:by}, isConnected);
                }
            }
        }
        
        // --- PASS 1.9: Block Erasure ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, false); 
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 2: Erasures (Faces) ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'remove') continue;

            let opacity = 1.0;
            if (fadeFrames === 0 || this.debugMode) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            
            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                     if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                     this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                }
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 3: Perimeter ---
        const boldLineWidthX = lineWidthX * 2.0; 
        const boldLineWidthY = lineWidthY * 2.0;
        
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                if (!isRenderActive(bx, by)) continue; // Must be Visible

                const idx = by * blocksX + bx;
                const startFrame = this.renderGrid[idx];
                
                let opacity = 1.0;
                if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
                else if (startFrame !== -1) opacity = Math.min(1.0, (now - startFrame) / addDuration);
                ctx.globalAlpha = opacity;

                // Check neighbors for PRESENCE (not Visibility) to prevent inner borders
                const nN = isBlockPresent(bx, by - 1);
                const nS = isBlockPresent(bx, by + 1);
                const nW = isBlockPresent(bx - 1, by);
                const nE = isBlockPresent(bx + 1, by);

                if (!nN) this._drawPerimeterFace(bx, by, 'N', boldLineWidthX, boldLineWidthY);
                if (!nS) this._drawPerimeterFace(bx, by, 'S', boldLineWidthX, boldLineWidthY);
                if (!nW) this._drawPerimeterFace(bx, by, 'W', boldLineWidthX, boldLineWidthY);
                if (!nE) this._drawPerimeterFace(bx, by, 'E', boldLineWidthX, boldLineWidthY);
            }
        }

        // --- PASS 4: Line Operations ---
        const lineOps = this.maskOps.filter(op => op.type === 'addLine' || op.type === 'removeLine');
        lineOps.sort((a, b) => (a.startFrame - b.startFrame));

        for (const op of lineOps) {
            let opacity = 1.0;
            const duration = (op.type === 'addLine') ? addDuration : removeDuration;
            
            if (op.type === 'addLine' && (fadeInFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.type === 'removeLine' && (fadeFrames === 0 || this.debugMode)) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / duration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };

            if (op.type === 'addLine') {
                ctx.globalCompositeOperation = 'source-over';
                
                // Only draw line if block is visible
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isRenderActive(bx, by)) {
                            this._addBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face);
                        }
                    }
                }
            } else {
                ctx.globalCompositeOperation = 'destination-out';
                const minX = Math.min(start.x, end.x);
                const maxX = Math.max(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxY = Math.max(start.y, end.y);
                
                for (let by = minY; by <= maxY; by++) {
                    for (let bx = minX; bx <= maxX; bx++) {
                        if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                        this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                    }
                }
            }
        }
        
        // --- PASS 6: Corner Cleanup ---
        const cornerMap = new Map(); 
        const activeRemovals = this.maskOps.filter(op => {
            if (op.type !== 'remove' && op.type !== 'removeLine') return false;
            if (!op.startFrame) return false;
            return (now >= op.startFrame);
        });

        for (const op of activeRemovals) {
            if (!op.face) continue;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            const f = op.face.toUpperCase();
            const force = op.force;

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue; 
                    if (!force) {
                        if (f === 'N' && by === minY) continue;
                        if (f === 'S' && by === maxY) continue;
                        if (f === 'W' && bx === minX) continue;
                        if (f === 'E' && bx === maxX) continue;
                    }
                    
                    const idx = by * blocksX + bx;
                    let mask = cornerMap.get(idx) || 0;
                    if (f === 'N') mask |= 1;
                    else if (f === 'S') mask |= 2;
                    else if (f === 'E') mask |= 4;
                    else if (f === 'W') mask |= 8;
                    cornerMap.set(idx, mask);
                }
            }
        }

        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1.0; 
        for (const [idx, mask] of cornerMap) {
            const bx = idx % blocksX;
            const by = Math.floor(idx / blocksX);
            
            if ((mask & 1) && (mask & 8)) this._removeBlockCorner(bx, by, 'NW');
            if ((mask & 1) && (mask & 4)) this._removeBlockCorner(bx, by, 'NE');
            if ((mask & 2) && (mask & 8)) this._removeBlockCorner(bx, by, 'SW');
            if ((mask & 2) && (mask & 4)) this._removeBlockCorner(bx, by, 'SE');
        }
        
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
    }"

def update_file():
    with open(source_path, 'r', encoding='utf-8') as f:
        content = f.read()

    start_marker = "_computeDistanceField(blocksX, blocksY) {"
    end_marker = "_addBlock(blockStart"
    
    idx_start = content.find(start_marker)
    idx_end = content.find(end_marker)
    
    if idx_start == -1 or idx_end == -1:
        print("Error: Could not find markers.")
        return
        
    prefix = content[:idx_start]
    suffix = content[idx_end:]
    
    new_content = prefix + new_compute_dist + "\n\n" + new_update_mask + "\n\n    " + suffix
    
    with open(source_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("Successfully updated QuantizedPulseEffect.js")

if __name__ == '__main__':
    update_file()
