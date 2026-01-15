class QuantizedSequenceGenerator {
    constructor() {
        this.sequence = [];
        this.grid = null; 
        this.width = 0;
        this.height = 0;
        this.cx = 0;
        this.cy = 0;
        this.scheduledOps = new Map();
    }

    generate(width, height, maxSteps = 2000, params = {}) {
        this.width = width;
        this.height = height;
        this.cx = Math.floor(width / 2);
        this.cy = Math.floor(height / 2);
        this.grid = new Uint8Array(width * height).fill(0);
        this.sequence = [];
        this.scheduledOps = new Map(); // Reset scheduled ops

        // Seed: Default to center, but allow override
        const seedX = (params.seedX !== undefined) ? params.seedX : this.cx;
        const seedY = (params.seedY !== undefined) ? params.seedY : this.cy;

        // Seed the grid
        const centerIdx = this._idx(seedX, seedY);
        if (centerIdx !== -1) {
            this.grid[centerIdx] = 1;
            // Initial step: Add seed relative to geometric center
            this.sequence.push([['add', seedX - this.cx, seedY - this.cy]]);
        } else {
            console.warn("QuantizedSequenceGenerator: Invalid seed position", seedX, seedY);
            // Fallback
            const fallbackIdx = this._idx(this.cx, this.cy);
            this.grid[fallbackIdx] = 1;
            this.sequence.push([['add', 0, 0]]);
        }

        const config = {
            blocksPerStep: 2,           // Start count (min)
            maxBlocksPerStep: 12,       // Peak count (mid-expansion)
            redistributeChance: 0.3,    // Chance to convert lines to rects
            thickenChance: 0.4,         // Chance to thicken existing thin lines
            erosionRate: 0.2,           // Default erosion rate if not passed
            innerLineDuration: 1,       // Default duration
            
            // Shape Probabilities (Normalized)
            shapeWeights: {
                rect1x1: 0.05,
                rect2x1: 0.1, 
                rect3x1: 0.1,
                rect4x1: 0.1,
                rect5x1: 0.05,
                rect6x1: 0.05,
                rect2x2: 0.2,
                rect2x3: 0.15, 
                rect2x4: 0.1,  
                rect4x2: 0.05, 
                rect3x2: 0.05
            },
            ...params
        };

        const totalCells = width * height;
        let filledCells = 1;

        for (let s = 1; s < maxSteps; s++) {
            const stepOps = [];
            
            // Apply scheduled operations for this step
            if (this.scheduledOps.has(s)) {
                const ops = this.scheduledOps.get(s);
                stepOps.push(...ops);
                this.scheduledOps.delete(s); // Clean up
            }
            
            const isFull = (filledCells >= totalCells);
            
            // Loop Termination: 
            // Continue if not full OR if we still have scheduled ops pending.
            if (isFull && this.scheduledOps.size === 0) {
                break;
            }

            // Only run expansion logic if grid isn't full
            if (!isFull) {
                // 1. Redistribution (Mutation of existing structure)
                if (Math.random() < config.redistributeChance) {
                    this._attemptRedistribution(stepOps);
                }

                // 2. Thickening (Reinforcing existing structure)
                if (Math.random() < config.thickenChance) {
                    const added = this._attemptThickening(stepOps);
                    filledCells += added;
                }
                
                // 2.2 Line Thickening (Specific parallel spawning for long thin blocks)
                if (Math.random() < 0.15) { 
                    const added = this._attemptLineThickening(stepOps);
                    filledCells += added;
                }

                // 2.3 Tendril Generation (Perpendicular shots from cardinal arms)
                if (Math.random() < 0.20) { // 20% chance
                    const added = this._attemptTendril(s, stepOps, config.innerLineDuration); 
                    filledCells += added;
                }

                // 2.5 Erosion (Deleting blocks from frontier)
                if (Math.random() < config.erosionRate) { 
                     const eroded = this._attemptErosion(stepOps);
                     filledCells -= eroded;
                }

                // 3. Expansion (Water Filling)
                const occupancyProgress = filledCells / totalCells;
                
                // Sinusoidal Growth: Start slow, speed up, slow down
                const curve = Math.sin(occupancyProgress * Math.PI); 
                const dynamicCount = config.blocksPerStep + (config.maxBlocksPerStep - config.blocksPerStep) * curve;
                const currentBlocksPerStep = Math.max(1, Math.floor(dynamicCount));
                
                let massAdded = 0;
                let attempts = 0;
                while (massAdded < currentBlocksPerStep && attempts < 20) {
                    attempts++;
                    const added = this._attemptExpansion(s, stepOps, config.shapeWeights, config.innerLineDuration); 
                    if (added > 0) {
                        massAdded++; 
                        filledCells += added;
                    }
                }
            }

            if (stepOps.length > 0) {
                this.sequence.push(stepOps);
            } else {
                // If not full but stalled, force expansion to ensure completion
                if (!isFull) {
                    let added = this._attemptExpansion(s, stepOps, config.shapeWeights, config.innerLineDuration);
                    
                    // If weighted expansion fails, force a 1x1 placement (guaranteed progress)
                    if (added === 0) {
                        added = this._forceExpansion(stepOps);
                    }

                    if (added > 0) {
                        filledCells += added;
                        this.sequence.push(stepOps);
                    } else {
                        // Truly stuck (frontier empty? should not happen if !isFull)
                        if (this.scheduledOps.size === 0) break;
                        this.sequence.push([]); 
                    }
                } else {
                    // Full, just pumping empty frames for scheduled ops
                    this.sequence.push([]);
                }
            }
        }

        return this.sequence;
    }

    _forceExpansion(stepOps) {
        // Fallback: Pick ANY frontier block uniformly and fill it with 1x1
        // This bypasses the axis weighting and shape sizing that might cause stalls at the corners.
        const frontier = this._getFrontier();
        if (frontier.length === 0) return 0;
        
        const idx = Math.floor(Math.random() * frontier.length);
        const origin = frontier[idx];
        
        this.grid[this._idx(origin.x, origin.y)] = 1;
        stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
        return 1;
    }

    _idx(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        return y * this.width + x;
    }

    _addPerimeterLines(s, x, y, w, h, duration) {
        if (duration <= 0) return;

        const allFaces = ['N', 'S', 'E', 'W'];
        for (let i = allFaces.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allFaces[i], allFaces[j]] = [allFaces[j], allFaces[i]];
        }
        
        const count = Math.floor(Math.random() * 4) + 1; 
        const selectedFaces = allFaces.slice(0, count);
        
        const delay = Math.floor(Math.random() * 2) + 3; // 3 or 4 steps delay
        
        const startStep = s + delay;
        const endStep = startStep + duration;
        
        const schedule = (step, op) => {
            if (!this.scheduledOps.has(step)) this.scheduledOps.set(step, []);
            this.scheduledOps.get(step).push(op);
        };

        for (const f of selectedFaces) {
            if (f === 'N') {
                for (let bx = 0; bx < w; bx++) {
                    schedule(startStep, ['addLine', (x + bx) - this.cx, y - this.cy, 'N']);
                    schedule(endStep, ['remLine', (x + bx) - this.cx, y - this.cy, 'N']);
                }
            } else if (f === 'S') {
                for (let bx = 0; bx < w; bx++) {
                    schedule(startStep, ['addLine', (x + bx) - this.cx, (y + h - 1) - this.cy, 'S']);
                    schedule(endStep, ['remLine', (x + bx) - this.cx, (y + h - 1) - this.cy, 'S']);
                }
            } else if (f === 'W') {
                for (let by = 0; by < h; by++) {
                    schedule(startStep, ['addLine', x - this.cx, (y + by) - this.cy, 'W']);
                    schedule(endStep, ['remLine', x - this.cx, (y + by) - this.cy, 'W']);
                }
            } else if (f === 'E') {
                for (let by = 0; by < h; by++) {
                    schedule(startStep, ['addLine', (x + w - 1) - this.cx, (y + by) - this.cy, 'E']);
                    schedule(endStep, ['remLine', (x + w - 1) - this.cx, (y + by) - this.cy, 'E']);
                }
            }
        }
    }

    _getFrontier() {
        const frontier = [];
        const visited = new Uint8Array(this.width * this.height);
        
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                if (this.grid[idx] === 1) {
                    const neighbors = [
                        {x:x, y:y-1}, {x:x, y:y+1}, {x:x-1, y:y}, {x:x+1, y:y}
                    ];
                    for (const n of neighbors) {
                        const nIdx = this._idx(n.x, n.y);
                        if (nIdx !== -1 && this.grid[nIdx] === 0 && visited[nIdx] === 0) {
                            visited[nIdx] = 1;
                            frontier.push(n);
                        }
                    }
                }
            }
        }
        return frontier;
    }

    _getExposedBlocks() {
        const exposed = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                if (this.grid[idx] === 1) {
                    const neighbors = [
                        {x:x, y:y-1}, {x:x, y:y+1}, {x:x-1, y:y}, {x:x+1, y:y}
                    ];
                    let isExposed = false;
                    for (const n of neighbors) {
                        const nIdx = this._idx(n.x, n.y);
                        if (nIdx === -1 || this.grid[nIdx] === 0) {
                            isExposed = true;
                            break;
                        }
                    }
                    if (isExposed) {
                        exposed.push({x, y});
                    }
                }
            }
        }
        return exposed;
    }

    _attemptErosion(stepOps) {
        const exposed = this._getExposedBlocks();
        if (exposed.length === 0) return 0;

        const idx = Math.floor(Math.random() * exposed.length);
        const origin = exposed[idx];

        const shapes = ['1x1', '1x2', '2x1'];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        let w = 1, h = 1;
        if (shape === '1x2') h = 2;
        if (shape === '2x1') w = 2;

        let valid = true;
        if (origin.x + w > this.width || origin.y + h > this.height) valid = false;
        else {
            for(let by=0; by<h; by++) {
                for(let bx=0; bx<w; bx++) {
                    if (this.grid[this._idx(origin.x+bx, origin.y+by)] === 0) {
                        valid = false;
                        break;
                    }
                }
            }
        }

        if (valid) {
             for(let by=0; by<h; by++) {
                for(let bx=0; bx<w; bx++) {
                    this.grid[this._idx(origin.x+bx, origin.y+by)] = 0;
                }
            }
            stepOps.push(['removeBlock', 
                origin.x - this.cx, 
                origin.y - this.cy, 
                (origin.x + w - 1) - this.cx, 
                (origin.y + h - 1) - this.cy
            ]);
            
            if (Math.random() < 0.5) {
                for (let bx=0; bx<w; bx++) stepOps.push(['remLine', (origin.x + bx) - this.cx, origin.y - this.cy, 'N']);
            }
            if (Math.random() < 0.5) {
                for (let bx=0; bx<w; bx++) stepOps.push(['remLine', (origin.x + bx) - this.cx, (origin.y + h - 1) - this.cy, 'S']);
            }
            if (Math.random() < 0.5) {
                for (let by=0; by<h; by++) stepOps.push(['remLine', origin.x - this.cx, (origin.y + by) - this.cy, 'W']);
            }
            if (Math.random() < 0.5) {
                for (let by=0; by<h; by++) stepOps.push(['remLine', (origin.x + w - 1) - this.cx, (origin.y + by) - this.cy, 'E']);
            }

            return w * h;
        }
        return 0;
    }

    _attemptThickening(stepOps) {
        const frontier = this._getFrontier();
        if (frontier.length === 0) return 0;

        for (let i = frontier.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [frontier[i], frontier[j]] = [frontier[j], frontier[i]];
        }

        for (const pt of frontier) {
            let neighbors = 0;
            const dirs = [{x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0}];
            for(const d of dirs) {
                const idx = this._idx(pt.x + d.x, pt.y + d.y);
                if (idx !== -1 && this.grid[idx] === 1) neighbors++;
            }

            if (neighbors >= 2) {
                this.grid[this._idx(pt.x, pt.y)] = 1;
                stepOps.push(['add', pt.x - this.cx, pt.y - this.cy]);
                return 1;
            }
        }
        return 0;
    }

    _attemptLineThickening(stepOps) {
        const candidates = [];
        const startX = Math.floor(Math.random() * this.width);
        const startY = Math.floor(Math.random() * this.height);
        
        for (let i = 0; i < this.width * this.height; i++) {
            const rawIdx = (startY * this.width + startX + i) % (this.width * this.height);
            const x = rawIdx % this.width;
            const y = Math.floor(rawIdx / this.width);
            if (this.grid[rawIdx] === 0) continue;
            for(let len of [6, 5, 4]) {
                if (this._checkLine(x, y, len, 1)) {
                    candidates.push({x, y, len, dir: 'H'});
                    if (candidates.length > 5) break; 
                }
            }
            for(let len of [6, 5, 4]) {
                if (this._checkLine(x, y, 1, len)) {
                    candidates.push({x, y, len, dir: 'V'});
                    if (candidates.length > 5) break;
                }
            }
            if (candidates.length > 5) break;
        }
        if (candidates.length === 0) return 0;
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const {x, y, len, dir} = target;
        const sides = (dir === 'H') ? [y-1, y+1] : [x-1, x+1];
        const side = sides[Math.floor(Math.random() * sides.length)];
        const offset = Math.floor(Math.random() * 3) - 1; 
        let nx, ny, nw, nh;
        if (dir === 'H') { nx = x + offset; ny = side; nw = len; nh = 1; }
        else { nx = side; ny = y + offset; nw = 1; nh = len; }
        let valid = true;
        if (nx < 0 || ny < 0 || nx + nw > this.width || ny + nh > this.height) { valid = false; }
        else {
            for(let by=0; by<nh; by++) {
                for(let bx=0; bx<nw; bx++) {
                    if (this.grid[this._idx(nx+bx, ny+by)] !== 0) { valid = false; break; }
                }
            }
        }
        if (valid) {
            for(let by=0; by<nh; by++) {
                for(let bx=0; bx<nw; bx++) { this.grid[this._idx(nx+bx, ny+by)] = 1; }
            }
            stepOps.push(['addRect', nx - this.cx, ny - this.cy, (nx + nw - 1) - this.cx, (ny + nh - 1) - this.cy]);
            return nw * nh;
        }
        return 0;
    }

    _attemptTendril(s, stepOps, innerDuration) {
        const len = Math.random() < 0.5 ? 6 : 7;
        const arm = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
        let anchorX, anchorY, dx, dy;
        
        const dist = Math.floor(Math.random() * (Math.min(this.width, this.height) / 2));
        
        if (arm === 'N') { anchorX = this.cx; anchorY = this.cy - dist; dx = 1; dy = 0; } 
        else if (arm === 'S') { anchorX = this.cx; anchorY = this.cy + dist; dx = 1; dy = 0; }
        else if (arm === 'E') { anchorX = this.cx + dist; anchorY = this.cy; dx = 0; dy = 1; } 
        else if (arm === 'W') { anchorX = this.cx - dist; anchorY = this.cy; dx = 0; dy = 1; }
        
        const sign = Math.random() < 0.5 ? 1 : -1;
        const doPair = Math.random() < 0.5;
        const sides = doPair ? [1, -1] : [sign];
        
        let totalAdded = 0;
        
        for (const side of sides) {
            let tx, ty, tw, th;
            if (dx !== 0) { 
                tx = (side === 1) ? anchorX + 1 : anchorX - len;
                ty = anchorY;
                tw = len;
                th = 1;
            } else { 
                tx = anchorX;
                ty = (side === 1) ? anchorY + 1 : anchorY - len;
                tw = 1;
                th = len;
            }
            
            if (tx < 0 || ty < 0 || tx + tw > this.width || ty + th > this.height) continue;
            
            let valid = true;
            let overwriteCount = 0;
            if (this.grid[this._idx(anchorX, anchorY)] === 0) valid = false;

            if (valid) {
                for(let by=0; by<th; by++) {
                    for(let bx=0; bx<tw; bx++) { 
                        if (this.grid[this._idx(tx+bx, ty+by)] === 1) overwriteCount++;
                        this.grid[this._idx(tx+bx, ty+by)] = 1; 
                    }
                }
                stepOps.push(['addRect', tx - this.cx, ty - this.cy, (tx + tw - 1) - this.cx, (ty + th - 1) - this.cy]);
                
                if (overwriteCount > 0) {
                    this._addPerimeterLines(s, tx, ty, tw, th, innerDuration);
                }
                
                totalAdded += (tw * th) - overwriteCount;
            }
        }
        return totalAdded;
    }

    _attemptRedistribution(stepOps) {
        const startX = Math.floor(Math.random() * this.width);
        const startY = Math.floor(Math.random() * this.height);
        for (let i = 0; i < this.width * this.height; i++) { 
            const rawIdx = (startY * this.width + startX + i) % (this.width * this.height);
            const x = rawIdx % this.width;
            const y = Math.floor(rawIdx / this.width);
            if (this.grid[rawIdx] === 0) continue;
            if (this._checkLine(x, y, 6, 1)) {
                for(let k=0; k<6; k++) {
                    this.grid[this._idx(x+k, y)] = 0;
                    stepOps.push(['removeBlock', (x+k)-this.cx, y-this.cy, (x+k)-this.cx, y-this.cy]);
                }
                const nx = x + 1;
                const ny = Math.max(0, y - 1); 
                if (nx + 3 <= this.width && ny + 2 <= this.height) {
                    for(let by=0; by<2; by++) {
                        for(let bx=0; bx<3; bx++) {
                            this.grid[this._idx(nx+bx, ny+by)] = 1;
                        }
                    }
                    stepOps.push(['addRect', nx-this.cx, ny-this.cy, (nx+2)-this.cx, (ny+1)-this.cy]);
                }
                return; 
            }
            if (this._checkLine(x, y, 1, 6)) {
                for(let k=0; k<6; k++) {
                    this.grid[this._idx(x, y+k)] = 0;
                    stepOps.push(['removeBlock', x-this.cx, (y+k)-this.cy, x-this.cx, (y+k)-this.cy]);
                }
                const nx = Math.max(0, x - 1);
                const ny = y + 1;
                if (nx + 2 <= this.width && ny + 3 <= this.height) {
                    for(let by=0; by<3; by++) {
                        for(let bx=0; bx<2; bx++) {
                            this.grid[this._idx(nx+bx, ny+by)] = 1;
                        }
                    }
                    stepOps.push(['addRect', nx-this.cx, ny-this.cy, (nx+1)-this.cx, (ny+2)-this.cy]);
                }
                return;
            }
        }
    }

    _checkLine(x, y, w, h) {
        if (x + w > this.width || y + h > this.height) return false;
        for(let by=0; by<h; by++) {
            for(let bx=0; bx<w; bx++) {
                if (this.grid[this._idx(x+bx, y+by)] === 0) return false;
            }
        }
        return true;
    }

    _attemptExpansion(s, stepOps, weights, innerDuration) {
        const frontier = this._getFrontier();
        if (frontier.length === 0) return 0;
        let bestIdx = -1;
        const frontierWeights = new Float32Array(frontier.length);
        let totalWeight = 0;
        for (let i = 0; i < frontier.length; i++) {
            const pt = frontier[i];
            const dx = Math.abs(pt.x - this.cx);
            const dy = Math.abs(pt.y - this.cy);
            const weight = Math.pow(100 / (Math.min(dx, dy) + 1), 3);
            frontierWeights[i] = weight;
            totalWeight += weight;
        }
        let r = Math.random() * totalWeight;
        for (let i = 0; i < frontier.length; i++) {
            r -= frontierWeights[i];
            if (r <= 0) { bestIdx = i; break; }
        }
        if (bestIdx === -1) bestIdx = frontier.length - 1;
        const origin = frontier[bestIdx];
        const shapeKeys = Object.keys(weights);
        let wSum = 0;
        for(const k of shapeKeys) wSum += weights[k];
        let rw = Math.random() * wSum;
        let selectedShape = shapeKeys[shapeKeys.length-1];
        for(const k of shapeKeys) {
            rw -= weights[k];
            if (rw <= 0) { selectedShape = k; break; }
        }
        let w = 1, h = 1;
        if (selectedShape.startsWith('rect')) {
            const dims = selectedShape.substring(4).split('x').map(Number);
            if (dims.length === 2) { w = dims[0]; h = dims[1]; }
        }
        if (w !== h && Math.random() < 0.5) { [w, h] = [h, w]; }
        
        if (origin.x + w <= this.width && origin.y + h <= this.height) {
            let actualAdded = 0;
            let overwriteCount = 0;
            for(let by=0; by<h; by++) {
                for(let bx=0; bx<w; bx++) {
                    const idx = this._idx(origin.x+bx, origin.y+by);
                    if (this.grid[idx] === 1) overwriteCount++;
                    else {
                        this.grid[idx] = 1;
                        actualAdded++;
                    }
                }
            }
            if (w === 1 && h === 1) {
                stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
            } else {
                stepOps.push(['addRect', 
                    origin.x - this.cx, 
                    origin.y - this.cy, 
                    (origin.x + w - 1) - this.cx, 
                    (origin.y + h - 1) - this.cy
                ]);
            }
            
            // Draw lines if overwrite occurred
            if (overwriteCount > 0 && (w > 1 || h > 1)) {
                this._addPerimeterLines(s, origin.x, origin.y, w, h, innerDuration);
            }
            
            return actualAdded;
        }
        
        const idx = this._idx(origin.x, origin.y);
        if (this.grid[idx] === 0) {
            this.grid[idx] = 1;
            stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
            return 1;
        }
        return 0;
    }
}