class QuantizedSequenceGeneratorV2 {
    constructor() {
        this.sequence = [];
        this.width = 0;
        this.height = 0;
        // Track blocks per layer: { layerId: [ {x, y, w, h, locked} ] }
        this.layers = { 0: [], 1: [] };
        this.occupancy = new Set();
        this.interiorLinesMap = new Map();
        this.shoveCounter = 0; 
    }

    generate(width, height, maxSteps = 500, params = {}) {
        this.width = width;
        this.height = height;
        this.sequence = [];
        this.layers = { 0: [], 1: [] }; 
        this.occupancy.clear();
        this.interiorLinesMap.clear();
        this.shoveCounter = 0;

        const config = {
            minBlockSize: 2,
            maxBlockSize: 6,
            innerLineDuration: 1,
            blockWidth: 1,
            blockHeight: 1,
            ...params
        };

        const unitW = config.blockWidth;
        const unitH = config.blockHeight;

        // Updated Shapes
        const shapes = [
            {w: 2, h: 3}, {w: 3, h: 2},
            {w: 2, h: 2},
            {w: 2, h: 1}, {w: 1, h: 2},
            {w: 1, h: 1},
            {w: 1, h: 3}, {w: 3, h: 1},
            {w: 1, h: 4}, {w: 4, h: 1},
            {w: 1, h: 5}, {w: 5, h: 1}
        ];

        const markOccupied = (b) => {
            for(let iy=0; iy<b.h; iy++) {
                for(let ix=0; ix<b.w; ix++) {
                    this.occupancy.add(`${b.x+ix},${b.y+iy}`);
                }
            }
        };

        // --- STEP 1: INITIAL SEED ---
        {
            const w = unitW; 
            const h = unitH;
            const x = -Math.floor(w / 2);
            const y = -Math.floor(h / 2);
            const seedLayer = 0;

            const stepOps = [];
            const x2 = x + w - 1;
            const y2 = y + h - 1;
            stepOps.push(['addRect', x, y, x2, y2, seedLayer]);
            
            const newBlock = { x, y, w, h, locked: true };
            this.layers[seedLayer].push(newBlock); 
            markOccupied(newBlock);
            
            this._addPerimeterLines(x, y, w, h, config.innerLineDuration, stepOps, seedLayer);
            this.sequence.push(stepOps);
        }

        // --- MAIN LOOP ---
        let logicStep = 2; 

        while (logicStep <= maxSteps) {
            const stepOpsCombined = [];
            
            const isOdd = (logicStep % 2 !== 0);
            const targetLayer = isOdd ? 0 : 1;
            
            const dirtyL0 = [];
            const dirtyL1 = [];
            
            // A. MERGE
            if (targetLayer === 0) {
                 if (this.layers[1].length > 0) {
                    stepOpsCombined.push(['mergeLayers', 1, 0]);
                    for (const b of this.layers[1]) {
                        b.locked = true; 
                        this.layers[0].push(b);
                        dirtyL0.push(b);
                    }
                    this.layers[1] = [];
                }
            }
            
            // B. ADD BLOCKS
            // "Max of 6 blocks at the same time after the first two main phases"
            // Phases: 1 (Seed), 2 (First additions). So from Step 3 onwards.
            const maxBlocksThisStep = (logicStep >= 3) ? 6 : 3;
            const blocksToPlace = (logicStep === 2) ? 1 : (Math.floor(Math.random() * maxBlocksThisStep) + 1);
            
            if (targetLayer === 1) {
                if (this.shoveCounter > 0) {
                    this.shoveCounter--;
                } else {
                    if (Math.random() < 0.2) this.shoveCounter = 1; 
                }
            }

            for (let i = 0; i < blocksToPlace; i++) {
                let newBlocks = [];
                
                if (targetLayer === 1 && this.shoveCounter > 0) {
                    const res = this._addBlockWithExtrusion(shapes, unitW, unitH, config, stepOpsCombined);
                    if (res) newBlocks = res;
                } else {
                    const b = this._addRandomBlock(shapes, unitW, unitH, targetLayer, config, stepOpsCombined, true);
                    if (b) newBlocks = [b];
                }

                for (const b of newBlocks) {
                    markOccupied(b);
                    if (b.locked || targetLayer === 0) dirtyL0.push(b);
                    else dirtyL1.push(b);
                }
            }
            
            // C. IDENTIFY NEW INTERIOR LINES
            if (dirtyL0.length > 0) {
                const hitLines = [];
                this._findInteriorLines(dirtyL0, 0, hitLines);
                for (const hit of hitLines) this._registerInteriorLine(hit);
            }
            if (dirtyL1.length > 0) {
                const hitLines = [];
                this._findInteriorLines(dirtyL1, 1, hitLines);
                for (const hit of hitLines) this._registerInteriorLine(hit);
            }
            
            // D. PROCESS LIFETIMES & DESPAWN
            for (const [key, life] of this.interiorLinesMap.entries()) {
                const newLife = life - 1;
                if (newLife <= 0) {
                    const parts = key.split(',');
                    const x = parseInt(parts[0]);
                    const y = parseInt(parts[1]);
                    const face = parts[2];
                    const layer = parseInt(parts[3]);
                    stepOpsCombined.push(['removeLine', x, y, face, layer]);
                    this.interiorLinesMap.delete(key);
                } else {
                    this.interiorLinesMap.set(key, newLife);
                }
            }
            
            stepOpsCombined.push(['debugInternalCount', this.interiorLinesMap.size]);
            this.sequence.push(stepOpsCombined);
            logicStep++;
            
            if (this.layers[0].length > 2000) break;
        }
        
        return this.sequence;
    }
    
    _registerInteriorLine(hit) {
        const key = `${hit.x},${hit.y},${hit.face},${hit.layer}`;
        if (this.interiorLinesMap.has(key)) {
            this.interiorLinesMap.set(key, this.interiorLinesMap.get(key) + 1);
        } else {
            this.interiorLinesMap.set(key, 2);
        }
    }
    
    _addBlockWithExtrusion(shapes, unitW, unitH, config, ops) {
        const shapeDef = shapes[Math.floor(Math.random() * shapes.length)];
        const w = shapeDef.w * unitW;
        const h = shapeDef.h * unitH;
        
        const anchorBlocks = this.layers[0].concat(this.layers[1]); 
        if (anchorBlocks.length === 0) return null;
        
        const anchor = anchorBlocks[Math.floor(Math.random() * anchorBlocks.length)];
        const dirs = ['N', 'S', 'E', 'W'];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        
        let nx = anchor.x, ny = anchor.y;
        let shiftDir = dir; 
        let shiftAmount = 0;
        let rMin = 0, rMax = 0;
        let threshold = 0;

        if (dir === 'N') {
            shiftAmount = Math.max(1, h - 1);
            nx = anchor.x; 
            ny = anchor.y - shiftAmount;
            threshold = ny + h - 1; 
            rMin = nx; rMax = nx + w - 1; 
        } else if (dir === 'S') {
            shiftAmount = Math.max(1, h - 1);
            nx = anchor.x; 
            ny = anchor.y + anchor.h - (h - shiftAmount);
            threshold = ny; 
            rMin = nx; rMax = nx + w - 1;
        } else if (dir === 'W') {
            shiftAmount = Math.max(1, w - 1);
            nx = anchor.x - shiftAmount; 
            ny = anchor.y;
            threshold = nx + w - 1;
            rMin = ny; rMax = ny + h - 1;
        } else if (dir === 'E') {
            shiftAmount = Math.max(1, w - 1);
            nx = anchor.x + anchor.w - (w - shiftAmount);
            ny = anchor.y;
            threshold = nx;
            rMin = ny; rMax = ny + h - 1;
        }
        
        const allBlocks = this.layers[0].concat(this.layers[1]);
        const clones = [];
        const extremes = new Map(); 
        
        for (const b of allBlocks) {
            if (shiftDir === 'N' || shiftDir === 'S') {
                const bMinX = b.x, bMaxX = b.x + b.w - 1;
                const iStart = Math.max(rMin, bMinX);
                const iEnd = Math.min(rMax, bMaxX);
                if (iStart <= iEnd) {
                    for (let cx = iStart; cx <= iEnd; cx++) {
                        const existing = extremes.get(cx);
                        if (shiftDir === 'N') {
                            if (!existing || b.y < existing.y) extremes.set(cx, b);
                        } else { 
                            if (!existing || b.y > existing.y) extremes.set(cx, b);
                        }
                    }
                }
            } else {
                const bMinY = b.y, bMaxY = b.y + b.h - 1;
                const iStart = Math.max(rMin, bMinY);
                const iEnd = Math.min(rMax, bMaxY);
                if (iStart <= iEnd) {
                    for (let cy = iStart; cy <= iEnd; cy++) {
                        const existing = extremes.get(cy);
                        if (shiftDir === 'W') {
                            if (!existing || b.x < existing.x) extremes.set(cy, b);
                        } else { 
                            if (!existing || b.x > existing.x) extremes.set(cy, b);
                        }
                    }
                }
            }
        }
        
        const uniqueBlocks = new Set(extremes.values());
        for (const b of uniqueBlocks) {
            const clone = { ...b };
            clone.locked = false;
            
            if (shiftDir === 'N') clone.y -= shiftAmount;
            else if (shiftDir === 'S') clone.y += shiftAmount;
            else if (shiftDir === 'W') clone.x -= shiftAmount;
            else if (shiftDir === 'E') clone.x += shiftAmount;
            
            clones.push(clone);
        }
        
        for (const c of clones) {
            this.layers[1].push(c);
            ops.push(['addRect', c.x, c.y, c.x + c.w - 1, c.y + c.h - 1, 1]);
            this._addPerimeterLines(c.x, c.y, c.w, c.h, config.innerLineDuration, ops, 1);
        }
        
        ops.push(['addRect', nx, ny, nx + w - 1, ny + h - 1, 1]);
        const newBlock = { x: nx, y: ny, w, h, locked: false };
        this.layers[1].push(newBlock);
        this._addPerimeterLines(nx, ny, w, h, config.innerLineDuration, ops, 1);
        
        this.occupancy.clear();
        for (const b of this.layers[0].concat(this.layers[1])) {
            for(let iy=0; iy<b.h; iy++) {
                for(let ix=0; ix<b.w; ix++) {
                    this.occupancy.add(`${b.x+ix},${b.y+iy}`);
                }
            }
        }
        
        const added = [...clones, newBlock];
        return added;
    }
    
    _addRandomBlock(shapes, unitW, unitH, targetLayer, config, ops, requireOverlap = true) {
        const shapeDef = shapes[Math.floor(Math.random() * shapes.length)];
        const w = shapeDef.w * unitW;
        const h = shapeDef.h * unitH;
        
        const anchorBlocks = this.layers[0].concat(this.layers[1]); 
        if (anchorBlocks.length === 0) return null;
        
        const checkCoverage = (bx, by, bw, bh) => {
            let occupiedCount = 0;
            const totalCells = bw * bh;
            for(let iy=0; iy<bh; iy++) {
                for(let ix=0; ix<bw; ix++) {
                    if (this.occupancy.has(`${bx+ix},${by+iy}`)) occupiedCount++;
                }
            }
            return { inside: occupiedCount, outside: totalCells - occupiedCount };
        };
        
        const isEnclosed = (bx, by, bw, bh) => {
            for (let x = bx - 1; x <= bx + bw; x++) {
                if (!this.occupancy.has(`${x},${by-1}`)) return false; 
                if (!this.occupancy.has(`${x},${by+bh}`)) return false; 
            }
            for (let y = by; y < by + bh; y++) {
                if (!this.occupancy.has(`${bx-1},${y}`)) return false; 
                if (!this.occupancy.has(`${bx+bw},${y}`)) return false; 
            }
            return true;
        };

        // NEW: Cardinal Bias
        // Try Cardinal axes first (N, S, E, W relative to Center of Mass)
        // Then random.
        
        // Calculate COM
        let comX = 0, comY = 0;
        let count = 0;
        for(const b of anchorBlocks) {
            comX += b.x + b.w/2;
            comY += b.y + b.h/2;
            count++;
        }
        comX /= count; comY /= count;

        let bestCand = null;
        
        // Phase 1: Try Cardinal Axes
        // We scan for anchors that are close to the axes
        for(let attempt = 0; attempt < 30; attempt++) {
            const anchor = anchorBlocks[Math.floor(Math.random() * anchorBlocks.length)];
            
            // Check if anchor is near an axis
            const ax = anchor.x + anchor.w/2;
            const ay = anchor.y + anchor.h/2;
            const onAxisX = Math.abs(ax - comX) < 4; // Vertical Axis
            const onAxisY = Math.abs(ay - comY) < 4; // Horizontal Axis
            
            if (!onAxisX && !onAxisY) continue; // Skip off-axis
            
            // Try placement
            const dirs = ['N', 'S', 'E', 'W'];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            
            let nx = anchor.x, ny = anchor.y;
            // Similar overlap logic as before
            const minX = anchor.x - w + 1;
            const maxX = anchor.x + anchor.w - 1;
            const minY = anchor.y - h + 1;
            const maxY = anchor.y + anchor.h - 1;
            
            nx = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
            ny = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
            
            const coverage = checkCoverage(nx, ny, w, h);
            if (coverage.inside > 0 && coverage.outside > 0) {
                if (!isEnclosed(nx, ny, w, h)) {
                    bestCand = { x: nx, y: ny };
                    break;
                }
            }
        }
        
        // Phase 2: Fallback (Anywhere)
        if (!bestCand) {
            for (let i = 0; i < 50; i++) {
                const anchor = anchorBlocks[Math.floor(Math.random() * anchorBlocks.length)];
                const minX = anchor.x - w + 1;
                const maxX = anchor.x + anchor.w - 1;
                const minY = anchor.y - h + 1;
                const maxY = anchor.y + anchor.h - 1;
                
                const nx = Math.floor(Math.random() * (maxX - minX + 1)) + minX;
                const ny = Math.floor(Math.random() * (maxY - minY + 1)) + minY;
                
                const coverage = checkCoverage(nx, ny, w, h);
                if (coverage.inside > 0 && coverage.outside > 0) {
                    if (!isEnclosed(nx, ny, w, h)) {
                        bestCand = { x: nx, y: ny };
                        break;
                    }
                }
            }
        }
        
        if (bestCand) {
            const { x, y } = bestCand;
            ops.push(['addRect', x, y, x + w - 1, y + h - 1, targetLayer]);
            const newBlock = { x, y, w, h, locked: (targetLayer === 0) };
            this.layers[targetLayer].push(newBlock);
            this._addPerimeterLines(x, y, w, h, config.innerLineDuration, ops, targetLayer);
            return newBlock;
        }
        return null;
    }

    _findInteriorLines(newBlocks, layer, hits) {
        const allBlocks = this.layers[layer];
        for (const b1 of newBlocks) {
            for (const b2 of allBlocks) {
                if (b1 === b2) continue; 
                this._checkAdjacency(b1, b2, layer, hits);
            }
        }
    }

    _checkAdjacency(b1, b2, layer, hits) {
        const ix1 = Math.max(b1.x, b2.x);
        const ix2 = Math.min(b1.x + b1.w, b2.x + b2.w);
        const iy1 = Math.max(b1.y, b2.y);
        const iy2 = Math.min(b1.y + b1.h, b2.y + b2.h);
        
        const w = ix2 - ix1;
        const h = iy2 - iy1;
        
        if (w > 0 && h > 0) {
            for (let x = ix1; x < ix2; x++) {
                if (b1.y > b2.y && b1.y < b2.y + b2.h) hits.push({x, y: b1.y, face: 'N', layer});
                if ((b1.y + b1.h - 1) > b2.y && (b1.y + b1.h - 1) < b2.y + b2.h - 1) hits.push({x, y: b1.y + b1.h - 1, face: 'S', layer});
                
                if (b2.y > b1.y && b2.y < b1.y + b1.h) hits.push({x, y: b2.y, face: 'N', layer});
                if ((b2.y + b2.h - 1) > b1.y && (b2.y + b2.h - 1) < b1.y + b1.h - 1) hits.push({x, y: b2.y + b2.h - 1, face: 'S', layer});
            }
            for (let y = iy1; y < iy2; y++) {
                if (b1.x > b2.x && b1.x < b2.x + b2.w) hits.push({x: b1.x, y, face: 'W', layer});
                if ((b1.x + b1.w - 1) > b2.x && (b1.x + b1.w - 1) < b2.x + b2.w - 1) hits.push({x: b1.x + b1.w - 1, y, face: 'E', layer});
                
                if (b2.x > b1.x && b2.x < b1.x + b1.w) hits.push({x: b2.x, y, face: 'W', layer});
                if ((b2.x + b2.w - 1) > b1.x && (b2.x + b2.w - 1) < b1.x + b1.w - 1) hits.push({x: b2.x + b2.w - 1, y, face: 'E', layer});
            }
        }
    }

    _addPerimeterLines(x, y, w, h, duration, ops, layer) {
        const faces = ['N', 'S', 'E', 'W'];
        for (const f of faces) {
            if (f === 'N') {
                for (let bx = 0; bx < w; bx++) ops.push(['addLine', x + bx, y, 'N', layer]);
            } else if (f === 'S') {
                for (let bx = 0; bx < w; bx++) ops.push(['addLine', x + bx, y + h - 1, 'S', layer]);
            } else if (f === 'W') {
                for (let by = 0; by < h; by++) ops.push(['addLine', x, y + by, 'W', layer]);
            } else if (f === 'E') {
                for (let by = 0; by < h; by++) ops.push(['addLine', x + w - 1, y + by, 'E', layer]);
            }
        }
    }
}