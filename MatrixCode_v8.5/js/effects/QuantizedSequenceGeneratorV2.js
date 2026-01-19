class QuantizedSequenceGeneratorV2 {
    constructor() {
        this.sequence = [];
        this.grid = null;
        this.width = 0;
        this.height = 0;
        this.cx = 0;
        this.cy = 0;
    }

    generate(width, height, maxSteps = 500, params = {}) {
        this.width = width;
        this.height = height;
        this.cx = Math.floor(width / 2);
        this.cy = Math.floor(height / 2);
        this.grid = new Uint8Array(width * height).fill(0);
        this.sequence = [];

        const config = {
            minBlockSize: 2,
            maxBlockSize: 6,
            blocksPerStep: 3,
            innerLineDuration: 1,
            ...params
        };

        let filledCells = 0;
        const totalCells = width * height;
        
        // 1. Seed Center
        const seedW = 4;
        const seedH = 4;
        const seedX = this.cx - Math.floor(seedW / 2);
        const seedY = this.cy - Math.floor(seedH / 2);
        
        const seedOps = [];
        this._addBlock(seedX, seedY, seedW, seedH, seedOps, config.innerLineDuration);
        this.sequence.push(seedOps);
        filledCells += seedW * seedH;

        // 2. Main Loop
        for (let s = 1; s < maxSteps; s++) {
            if (filledCells >= totalCells) break;

            const stepOps = [];
            let addedInStep = 0;
            let attempts = 0;
            const maxAttempts = 50;

            while (addedInStep < config.blocksPerStep && attempts < maxAttempts) {
                attempts++;
                
                // Find Frontier candidates (Empty cells touching Filled cells)
                // Optimization: We could maintain this list, but for now scan is okay for these grid sizes (usually < 100x100)
                const candidates = this._getGrowthCandidates();
                
                if (candidates.length === 0) break; // Should be full or isolated

                // Pick random candidate
                const candidate = candidates[Math.floor(Math.random() * candidates.length)];
                
                // Determine direction from neighbor
                // (Candidate is empty. It has a filled neighbor.)
                // We want to grow "away" from the filled mass or "along" it.
                // Simple approach: Try random sizes at this position.
                
                const w = Math.floor(Math.random() * (config.maxBlockSize - config.minBlockSize + 1)) + config.minBlockSize;
                const h = Math.floor(Math.random() * (config.maxBlockSize - config.minBlockSize + 1)) + config.minBlockSize;
                
                // Try to align the block such that 'candidate' is inside it, 
                // and the block is valid (empty).
                // To prioritize "attachment", we should ensure the new block shares an edge with existing mass.
                // Since 'candidate' touches existing mass, placing a block at 'candidate' (overlapping it) guarantees contact.
                
                // We test different offsets for the block relative to the candidate
                // e.g. Candidate could be Top-Left, Bottom-Right, etc. of the new block.
                
                const validPlacements = [];
                
                for (let oy = 0; oy < h; oy++) {
                    for (let ox = 0; ox < w; ox++) {
                        // Top-left of new block would be (candidate.x - ox, candidate.y - oy)
                        const bx = candidate.x - ox;
                        const by = candidate.y - oy;
                        
                        if (this._isValidPlacement(bx, by, w, h)) {
                            validPlacements.push({x: bx, y: by});
                        }
                    }
                }
                
                if (validPlacements.length > 0) {
                    // Pick one
                    const placement = validPlacements[Math.floor(Math.random() * validPlacements.length)];
                    
                    this._addBlock(placement.x, placement.y, w, h, stepOps, config.innerLineDuration);
                    addedInStep++;
                    filledCells += (w * h);
                }
            }

            if (stepOps.length > 0) {
                this.sequence.push(stepOps);
            } else {
                // If stuck, try to force a single pixel fill at a random candidate to unstuck
                const candidates = this._getGrowthCandidates();
                if (candidates.length > 0) {
                    const c = candidates[Math.floor(Math.random() * candidates.length)];
                    const forceOps = [];
                    this._addBlock(c.x, c.y, 1, 1, forceOps, config.innerLineDuration);
                    this.sequence.push(forceOps);
                    filledCells++;
                } else {
                    if (filledCells < totalCells) {
                        // Scan for ANY empty spot (island)
                         const islands = [];
                         for(let i=0; i<totalCells; i++) {
                             if (this.grid[i] === 0) islands.push(i);
                         }
                         if (islands.length > 0) {
                             const idx = islands[Math.floor(Math.random() * islands.length)];
                             const ix = idx % this.width;
                             const iy = Math.floor(idx / this.width);
                             const islandOps = [];
                             this._addBlock(ix, iy, 1, 1, islandOps, config.innerLineDuration);
                             this.sequence.push(islandOps);
                             filledCells++;
                         } else {
                             break; // Truly full
                         }
                    } else {
                        break;
                    }
                }
            }
        }
        
        return this.sequence;
    }

    _idx(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        return y * this.width + x;
    }

    _getGrowthCandidates() {
        const candidates = [];
        // Scan grid for empty cells that have at least 1 filled neighbor
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y * this.width + x] === 0) {
                    // Check neighbors
                    const n = [
                        this._idx(x, y-1),
                        this._idx(x, y+1),
                        this._idx(x-1, y),
                        this._idx(x+1, y)
                    ];
                    let hasNeighbor = false;
                    for (const idx of n) {
                        if (idx !== -1 && this.grid[idx] === 1) {
                            hasNeighbor = true;
                            break;
                        }
                    }
                    if (hasNeighbor) {
                        candidates.push({x, y});
                    }
                }
            }
        }
        return candidates;
    }

    _isValidPlacement(x, y, w, h) {
        if (x < 0 || y < 0 || x + w > this.width || y + h > this.height) return false;
        
        for (let by = 0; by < h; by++) {
            for (let bx = 0; bx < w; bx++) {
                if (this.grid[this._idx(x + bx, y + by)] === 1) return false;
            }
        }
        return true;
    }

    _addBlock(x, y, w, h, ops, innerDuration) {
        // Update Grid
        for (let by = 0; by < h; by++) {
            for (let bx = 0; bx < w; bx++) {
                this.grid[this._idx(x + bx, y + by)] = 1;
            }
        }

        // Add Ops
        const relX = x - this.cx;
        const relY = y - this.cy;

        if (w === 1 && h === 1) {
            ops.push(['add', relX, relY]);
        } else {
            ops.push(['addRect', relX, relY, relX + w - 1, relY + h - 1]);
        }

        // Add Inner Lines (Texture)
        // We add lines to ALL faces of the new block to ensure it has a border
        // The renderer handles merging, but we need to generate the "texture"
        this._addPerimeterLines(x, y, w, h, innerDuration, ops);
    }

    _addPerimeterLines(x, y, w, h, duration, ops) {
        // Add line ops for the perimeter of this block
        const faces = ['N', 'S', 'E', 'W'];
        const relX = x - this.cx;
        const relY = y - this.cy;

        for (const f of faces) {
            if (f === 'N') {
                for (let bx = 0; bx < w; bx++) ops.push(['addLine', relX + bx, relY, 'N']);
            } else if (f === 'S') {
                for (let bx = 0; bx < w; bx++) ops.push(['addLine', relX + bx, relY + h - 1, 'S']);
            } else if (f === 'W') {
                for (let by = 0; by < h; by++) ops.push(['addLine', relX, relY + by, 'W']);
            } else if (f === 'E') {
                for (let by = 0; by < h; by++) ops.push(['addLine', relX + w - 1, relY + by, 'E']);
            }
        }
    }
}
