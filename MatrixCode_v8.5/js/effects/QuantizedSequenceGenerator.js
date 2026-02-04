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

    generate(width, height, maxSteps = 500, params = {}) {
        // console.log("QuantizedSequenceGenerator: generate() called. Mode: ISOLATED CROSS");
        this.width = width;
        this.height = height;
        this.cx = Math.floor(width / 2);
        this.cy = Math.floor(height / 2);
        this.grid = new Uint8Array(width * height).fill(0);
        this.sequence = [];
        this.scheduledOps = new Map(); // Reset scheduled ops

        const config = {
            blocksPerStep: 2,           // Start count (min)
            maxBlocksPerStep: 6,       // Peak count (mid-expansion) - STRICT LIMIT
            redistributeChance: 0.3,    // Chance to convert lines to rects
            thickenChance: 0.2,         // Chance to thicken existing thin lines
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

        // Seed: Default to center, but allow override
        const seedX = (params.seedX !== undefined) ? params.seedX : this.cx;
        const seedY = (params.seedY !== undefined) ? params.seedY : this.cy;

        const totalCells = width * height;
        let filledCells = 0;
        let startStep = 1;

        // 1. Handle Initial Sequence (if provided)
        if (params.initialSequence && Array.isArray(params.initialSequence) && params.initialSequence.length > 0) {
            // Copy existing sequence
            this.sequence = [...params.initialSequence];
            startStep = this.sequence.length;

            // Replay state to populate grid
            for (const step of this.sequence) {
                if (!step) continue;
                
                // Handle Compressed Steps (Number Array) - Simple skip or basic bounding box? 
                // We assume Raw Ops for now as Generator produces Raw Ops.
                // If we encounter compressed, we might need to skip or implement decoder. 
                // For safety, only process Arrays of Arrays (Raw Ops).
                
                for (const opData of step) {
                    if (!Array.isArray(opData)) continue;
                    const op = opData[0];
                    
                    if (op === 'add') {
                        const dx = opData[1];
                        const dy = opData[2];
                        const idx = this._idx(this.cx + dx, this.cy + dy);
                        if (idx !== -1 && this.grid[idx] === 0) {
                            this.grid[idx] = 1;
                            filledCells++;
                        }
                    } else if (op === 'addRect') {
                        const x1 = this.cx + opData[1];
                        const y1 = this.cy + opData[2];
                        const x2 = this.cx + opData[3];
                        const y2 = this.cy + opData[4];
                        const minX = Math.min(x1, x2);
                        const maxX = Math.max(x1, x2);
                        const minY = Math.min(y1, y2);
                        const maxY = Math.max(y1, y2);
                        
                        for(let y=minY; y<=maxY; y++) {
                            for(let x=minX; x<=maxX; x++) {
                                const idx = this._idx(x, y);
                                if (idx !== -1 && this.grid[idx] === 0) {
                                    this.grid[idx] = 1;
                                    filledCells++;
                                }
                            }
                        }
                    } else if (op === 'removeBlock') {
                        const x1 = this.cx + opData[1];
                        const y1 = this.cy + opData[2];
                        const x2 = this.cx + opData[3];
                        const y2 = this.cy + opData[4];
                        const minX = Math.min(x1, x2);
                        const maxX = Math.max(x1, x2);
                        const minY = Math.min(y1, y2);
                        const maxY = Math.max(y1, y2);
                        
                        for(let y=minY; y<=maxY; y++) {
                            for(let x=minX; x<=maxX; x++) {
                                const idx = this._idx(x, y);
                                if (idx !== -1 && this.grid[idx] === 1) {
                                    this.grid[idx] = 0;
                                    filledCells--;
                                }
                            }
                        }
                        /* Note: Line removal should be handled by explicit 'remLine' ops in the sequence.
                    }   else if (op === 'remLine') {
                        const x1 = this.cx + opData[1];
                        const y1 = this.cy + opData[2];
                        const x2 = this.cx + opData[3];
                        const y2 = this.cy + opData[4];
                        const minX = Math.min(x1, x2);
                        const maxX = Math.max(x1, x2);
                        const minY = Math.min(y1, y2);
                        const maxY = Math.max(y1, y2);
                        
                        for(let y=minY; y<=maxY; y++) {
                            for(let x=minX; x<=maxX; x++) {
                                const idx = this._idx(x, y);
                                if (idx !== -1 && this.grid[idx] === 1) {
                                    this.grid[idx] = 0;


                                    
                                    filledCells--;
                                }
                            }
                        }*/
                    }
                }
            }
            // console.log(`[Generator] Resuming from step ${startStep}, filled: ${filledCells}`);
        } else {
            // 2. Default Seeding
            const centerIdx = this._idx(seedX, seedY);
            if (centerIdx !== -1) {
                this.grid[centerIdx] = 1;
                filledCells = 1;
                // Initial step: Add seed relative to geometric center
                const seedStepOps = [['add', seedX - this.cx, seedY - this.cy]];
                // Add lines for the seed block so it matches the rest
                this._addPerimeterLines(0, seedX, seedY, 1, 1, config.innerLineDuration, seedStepOps);
                this.sequence.push(seedStepOps);
            } else {
                console.warn("QuantizedSequenceGenerator: Invalid seed position", seedX, seedY);
                // Fallback
                const fallbackIdx = this._idx(this.cx, this.cy);
                this.grid[fallbackIdx] = 1;
                filledCells = 1;
                const seedStepOps = [['add', 0, 0]];
                this._addPerimeterLines(0, this.cx, this.cy, 1, 1, config.innerLineDuration, seedStepOps);
                this.sequence.push(seedStepOps);
            }
        }

        let crossComplete = false;
        
        // Hoist buffer allocation to reduce GC pressure
        const stepOccupancy = new Uint8Array(totalCells);

        for (let s = startStep; s < maxSteps; s++) {
            const stepOps = [];
            
            // Reset step occupancy
            stepOccupancy.fill(0);
            
            // Check Cross Completion (if not yet complete)
            if (!crossComplete) {
                crossComplete = this._checkCrossCompletion();
                
                // If still not complete, run startCross logic (isolated behavior)
                if (!crossComplete) {
                    const added = this._startCross(s, stepOps, stepOccupancy, config.innerLineDuration);
                    filledCells += added;
                }
            }
            
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
                /*
                if (Math.random() < config.redistributeChance) {
                    this._attemptRedistribution(stepOps, stepOccupancy);
                }
                */

                // 2. Thickening (Reinforcing existing structure)
                /*
                if (Math.random() < config.thickenChance) {
                    const added = this._attemptThickening(stepOps, stepOccupancy);
                    filledCells += added;
                }
                */
                
                // 2.2 Line Thickening (Specific parallel spawning for long thin blocks)
                /*
                if (Math.random() < 0.15) { 
                    const added = this._attemptLineThickening(stepOps, stepOccupancy);
                    filledCells += added;
                }
                */

                // 2.3 Tendril Generation (Perpendicular shots from cardinal arms)
                // Boost probability significantly if the main cross is complete to fill quadrants
                /*
                const tendrilProb = crossComplete ? 0.60 : 0.20;
                if (Math.random() < tendrilProb) { 
                    const added = this._attemptTendril(s, stepOps, config.innerLineDuration, stepOccupancy); 
                    filledCells += added;
                }
                */

                // 2.4 Multi-Block Move (Perimeter Expansion Copy)
                // Boost probability during fill phase to help progress general expansion
                /*
                const moveProb = crossComplete ? 0.70 : 0.35;
                if (Math.random() < moveProb) {
                     const added = this._attemptMultiBlockMove(s, stepOps, config.innerLineDuration, stepOccupancy);
                     filledCells += added;
                }
                */

                // 2.5 Erosion (Deleting blocks from frontier)
                /*
                if (Math.random() < config.erosionRate) { 
                     const eroded = this._attemptErosion(stepOps, filledCells);
                     filledCells -= eroded;
                }
                */

                // 3. Expansion (Water Filling)
                // const occupancyProgress = filledCells / totalCells;
                
                // Linear Growth Ramp: Start at 1, +1 per step, max 10
                let currentBlocksPerStep = Math.min(7, Math.max(1, s));
                
                // Constraint: Until cross is complete, limit growth to maintain consistent cross formation
                if (!crossComplete) {
                    currentBlocksPerStep = Math.min(4, Math.max(2, currentBlocksPerStep));
                }
                
                // DYNAMIC BLOCK SIZING: Vary weights based on step 's'
                // Stage 1: Initial Growth (1x1 Only) - Steps 1-5
                // Stage 2: Early Expansion (Small Blocks) - Steps 6-15
                // Stage 3: Late Expansion (Full Variety) - Steps 16+
                let dynamicWeights = config.shapeWeights; 
                
                if (s <= 4) {
                    dynamicWeights = { rect1x1: 1.0 };
                } else if (s <= 12) {
                    dynamicWeights = {
                        rect1x1: 0.2,
                        rect2x1: 0.3, 
                        rect1x2: 0.3, 
                        rect2x1: 0.4, 
                        rect2x2: 0.4
                    };
                }

                let massAdded = 0;
                let attempts = 0;
                /*
                while (massAdded < currentBlocksPerStep && attempts < 20) {
                    attempts++;
                    let added = this._attemptExpansion(s, stepOps, dynamicWeights, config.innerLineDuration, stepOccupancy, crossComplete); 
                    
                    // RESOLUTION 2: Fallback Mechanism
                    // If weighted expansion fails (e.g. strict occupancy), force a single block to ensure forward progress.
                    if (added === 0) {
                        added = this._forceExpansion(s, stepOps, stepOccupancy, config.innerLineDuration);
                    }

                    if (added > 0) {
                        massAdded++; 
                        filledCells += added;
                    }
                }
                */
            }

            if (stepOps.length > 0) {
                this.sequence.push(stepOps);
            } else {
                // If not full but stalled, force expansion to ensure completion
                if (!isFull) {
                    // Force expansion needs a temp stepOccupancy if one wasn't created (rare case logic flow)
                    const fallbackOccupancy = new Uint8Array(totalCells).fill(0);

                    /*
                    // Always add perimeter lines to ensure internal lines are generated
                    let added = this._attemptExpansion(s, stepOps, config.shapeWeights, config.innerLineDuration, fallbackOccupancy, crossComplete);
                    
                    // If weighted expansion fails, force a 1x1 placement (guaranteed progress)
                    if (added === 0) {
                        added = this._forceExpansion(s, stepOps, fallbackOccupancy, config.innerLineDuration);
                    }

                    if (added > 0) {
                        filledCells += added;
                        this.sequence.push(stepOps);
                    } else {
                        // Truly stuck (frontier empty? should not happen if !isFull)
                        if (this.scheduledOps.size === 0) break;
                        this.sequence.push([]); 
                    }
                    */
                    this.sequence.push([]); 
                } else {
                    // Full, just pumping empty frames for scheduled ops
                    this.sequence.push([]);
                }
            }
        }

        return this.sequence;
    }

    _forceExpansion(s, stepOps, stepOccupancy, innerDuration) {
        // Fallback: Pick ANY frontier block uniformly and fill it with 1x1
        // This bypasses the axis weighting and shape sizing that might cause stalls at the corners.
        const frontier = this._getFrontier();
        if (frontier.length === 0) return 0;
        
        // Shuffle or pick random
        const idx = Math.floor(Math.random() * frontier.length);
        const origin = frontier[idx];
        const gridIdx = this._idx(origin.x, origin.y);

        // Check step occupancy
        if (stepOccupancy && stepOccupancy[gridIdx] === 1) return 0;
        
        this.grid[gridIdx] = 1;
        if (stepOccupancy) stepOccupancy[gridIdx] = 1;

        stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
        this._addPerimeterLines(s, origin.x, origin.y, 1, 1, innerDuration, stepOps);
        return 1;
    }

    _computeOutsideMap() {
        const w = this.width;
        const h = this.height;
        const map = new Uint8Array(w * h); // 0 = Inside/Filled, 1 = True Outside
        const queue = [];

        // Seed edges
        for (let x = 0; x < w; x++) {
            const i1 = this._idx(x, 0);
            if (i1 !== -1 && this.grid[i1] === 0) { map[i1] = 1; queue.push(i1); }
            const i2 = this._idx(x, h - 1);
            if (i2 !== -1 && this.grid[i2] === 0) { map[i2] = 1; queue.push(i2); }
        }
        for (let y = 1; y < h - 1; y++) {
            const i1 = this._idx(0, y);
            if (i1 !== -1 && this.grid[i1] === 0) { map[i1] = 1; queue.push(i1); }
            const i2 = this._idx(w - 1, y);
            if (i2 !== -1 && this.grid[i2] === 0) { map[i2] = 1; queue.push(i2); }
        }

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const cx = idx % w;
            const cy = Math.floor(idx / w);

            const neighbors = [
                {x: cx, y: cy - 1}, {x: cx, y: cy + 1},
                {x: cx - 1, y: cy}, {x: cx + 1, y: cy}
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.x < w && n.y >= 0 && n.y < h) {
                    const nIdx = n.y * w + n.x;
                    if (this.grid[nIdx] === 0 && map[nIdx] === 0) {
                        map[nIdx] = 1;
                        queue.push(nIdx);
                    }
                }
            }
        }
        return map;
    }

    _idx(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        return y * this.width + x;
    }

    _clearAreaLines(x, y, w, h, stepOps) {
        for (let by = 0; by < h; by++) {
            for (let bx = 0; bx < w; bx++) {
                const dx = x + bx - this.cx;
                const dy = y + by - this.cy;
                stepOps.push(['remLine', dx, dy, 'N']);
                stepOps.push(['remLine', dx, dy, 'S']);
                stepOps.push(['remLine', dx, dy, 'E']);
                stepOps.push(['remLine', dx, dy, 'W']);
            }
        }
    }

    _addPerimeterLines(s, x, y, w, h, duration, stepOps) {
        if (duration <= 0) return;

        // Force ALL faces to ensure internal lines are always drawn at boundaries
        const selectedFaces = ['N', 'S', 'E', 'W'];
        
        // Ensure lines appear immediately (co-located with block)
        const delay = 0; 
        
        const startStep = s + delay;
        // const endStep = startStep + duration; // Lifetime now handled by renderer
        
        const schedule = (step, op) => {
            if (delay === 0 && stepOps) {
                stepOps.push(op);
            } else {
                if (!this.scheduledOps.has(step)) this.scheduledOps.set(step, []);
                this.scheduledOps.get(step).push(op);
            }
        };

        for (const f of selectedFaces) {
            if (f === 'N') {
                for (let bx = 0; bx < w; bx++) {
                    schedule(startStep, ['addLine', (x + bx) - this.cx, y - this.cy, 'N']);
                }
            } else if (f === 'S') {
                for (let bx = 0; bx < w; bx++) {
                    schedule(startStep, ['addLine', (x + bx) - this.cx, (y + h - 1) - this.cy, 'S']);
                }
            } else if (f === 'W') {
                for (let by = 0; by < h; by++) {
                    schedule(startStep, ['addLine', x - this.cx, (y + by) - this.cy, 'W']);
                }
            } else if (f === 'E') {
                for (let by = 0; by < h; by++) {
                    schedule(startStep, ['addLine', (x + w - 1) - this.cx, (y + by) - this.cy, 'E']);
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

    _attemptErosion(stepOps, currentMass) {
        // Guard: Do not erode if mass is too low (protect the seed)
        // This prevents the generator from deleting the initial seed block and terminating early.
        if (currentMass <= 10) return 0;

        // 1. Compute Outside Map to identify True Perimeter
        // We only want to erode blocks that touch the "True Outside", ensuring we peel from the outside in.
        // This prevents "internal" erosion (drilling holes inside the main blob).
        const outsideMap = this._computeOutsideMap();
        
        const perimeterCandidates = [];
        for(let y=0; y<this.height; y++) {
            for(let x=0; x<this.width; x++) {
                const idx = this._idx(x, y);
                if (this.grid[idx] === 1) {
                    // Check if any neighbor is True Outside
                    const neighbors = [{x:x, y:y-1}, {x:x, y:y+1}, {x:x-1, y:y}, {x:x+1, y:y}];
                    let isExposed = false;
                    for(const n of neighbors) {
                        const nIdx = this._idx(n.x, n.y);
                        // If neighbor is out of bounds, it's outside. 
                        // If neighbor is in bounds and outsideMap is 1, it's outside.
                        if (nIdx === -1 || outsideMap[nIdx] === 1) {
                            isExposed = true;
                            break;
                        }
                    }
                    if (isExposed) perimeterCandidates.push({x, y});
                }
            }
        }
        
        if (perimeterCandidates.length === 0) return 0;

        // Shuffle candidates to avoid bias
        for (let i = perimeterCandidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [perimeterCandidates[i], perimeterCandidates[j]] = [perimeterCandidates[j], perimeterCandidates[i]];
        }

        // 2. Shape Matching: Prefer deleting larger "written blocks" (2x2) over single pixels
        // We iterate candidates and try to fit the largest shape first.
        const shapes = [
            {w:3, h:1},
            {w:1, h:3},
            {w:2, h:2}, // Priority 1: 2x2 Block
            {w:2, h:1}, // Priority 2: 2x1 Horizontal
            {w:1, h:2}, // Priority 2: 1x2 Vertical
            {w:1, h:1}  // Fallback: Single block (only if nothing else fits)
        ];

        for (const origin of perimeterCandidates) {
            for (const shape of shapes) {
                // To delete a shape at 'origin', 'origin' must be part of it.
                // But simply placing the shape at 'origin' (top-left) covers it.
                // We should check if the shape fits entirely within FILLED cells.
                
                let fits = true;
                if (origin.x + shape.w > this.width || origin.y + shape.h > this.height) {
                    fits = false;
                } else {
                    for(let by=0; by<shape.h; by++) {
                        for(let bx=0; bx<shape.w; bx++) {
                            const idx = this._idx(origin.x+bx, origin.y+by);
                            if (this.grid[idx] === 0) {
                                fits = false;
                                break;
                            }
                        }
                        if (!fits) break;
                    }
                }

                if (fits) {
                    // Execute Deletion
                    for(let by=0; by<shape.h; by++) {
                        for(let bx=0; bx<shape.w; bx++) {
                            this.grid[this._idx(origin.x+bx, origin.y+by)] = 0;
                        }
                    }
                    
                    if (shape.w === 1 && shape.h === 1) {
                         stepOps.push(['removeBlock', origin.x - this.cx, origin.y - this.cy, origin.x - this.cx, origin.y - this.cy]);
                    } else {
                         stepOps.push(['removeBlock', 
                            origin.x - this.cx, 
                            origin.y - this.cy, 
                            (origin.x + shape.w - 1) - this.cx, 
                            (origin.y + shape.h - 1) - this.cy
                        ]);
                    }
                    
                    // Clean line removal: Ensure no ghost lines remain
                    this._clearAreaLines(origin.x, origin.y, shape.w, shape.h, stepOps);

                    return shape.w * shape.h;
                }
            }
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
            this._clearAreaLines(nx, ny, nw, nh, stepOps); // Clear existing lines before placing

            for(let by=0; by<nh; by++) {
                for(let bx=0; bx<nw; bx++) { this.grid[this._idx(nx+bx, ny+by)] = 1; }
            }
            stepOps.push(['addRect', nx - this.cx, ny - this.cy, (nx + nw - 1) - this.cx, (ny + nh - 1) - this.cy]);
            return nw * nh;
        }
        return 0;
    }

    _attemptTendril(s, stepOps, innerDuration, stepOccupancy) {
        const len = Math.random() < 0.5 ? 6 : 7;
        const arm = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
        let anchorX, anchorY, dx, dy;
        
        // Calculate max distance based on the chosen arm's axis
        const maxDist = (arm === 'N' || arm === 'S') ? (this.height / 2) : (this.width / 2);
        const dist = Math.floor(Math.random() * maxDist);
        
        if (arm === 'N') { anchorX = this.cx; anchorY = this.cy - dist; dx = 1; dy = 0; } 
        else if (arm === 'S') { anchorX = this.cx; anchorY = this.cy + dist; dx = 1; dy = 0; }
        else if (arm === 'E') { anchorX = this.cx + dist; anchorY = this.cy; dx = 0; dy = 1; } 
        else if (arm === 'W') { anchorX = this.cx - dist; anchorY = this.cy; dx = 0; dy = 1; }
        
        const sign = Math.random() < 0.5 ? 1 : -1;
        const doPair = Math.random() < 0.5;
        const sides = doPair ? [1, -1] : [sign];
        
        let totalAdded = 0;
        
        // Compute outside map once for this step
        const outsideMap = this._computeOutsideMap();

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
            
            // Check Exposure
            let isExposed = false;
            for(let by=0; by<th; by++) {
                for(let bx=0; bx<tw; bx++) {
                    const idx = this._idx(tx+bx, ty+by);
                    if (outsideMap[idx] === 1) {
                        isExposed = true;
                        break;
                    }
                }
                if (isExposed) break;
            }

            let valid = true;
            let overwriteCount = 0;
            if (this.grid[this._idx(anchorX, anchorY)] === 0) valid = false;

            if (valid) {
                this._clearAreaLines(tx, ty, tw, th, stepOps); // Clear existing lines before placing

                for(let by=0; by<th; by++) {
                    for(let bx=0; bx<tw; bx++) { 
                        if (this.grid[this._idx(tx+bx, ty+by)] === 1) overwriteCount++;
                        this.grid[this._idx(tx+bx, ty+by)] = 1; 
                    }
                }
                stepOps.push(['addRect', tx - this.cx, ty - this.cy, (tx + tw - 1) - this.cx, (ty + th - 1) - this.cy]);
                
                this._addPerimeterLines(s, tx, ty, tw, th, innerDuration, stepOps);
                
                totalAdded += (tw * th) - overwriteCount;
            }
        }
        return totalAdded;
    }

    _attemptMultiBlockMove(s, stepOps, innerDuration, stepOccupancy) {
        const exposed = this._getExposedBlocks();
        if (exposed.length === 0) return 0;
        
        // Pick random exposed block
        const origin = exposed[Math.floor(Math.random() * exposed.length)];
        
        const dx = origin.x - this.cx;
        const dy = origin.y - this.cy;
        
        // Determine Axis and Direction
        let moveX = 0, moveY = 0;
        if (Math.abs(dx) < Math.abs(dy)) {
            moveY = (dy < 0) ? -1 : 1; 
        } else {
            moveX = (dx < 0) ? -1 : 1;
        }
        if (moveX === 0 && moveY === 0) return 0; 
        
        // Multi-step animation parameters
        const steps = 3; 
        
        // Define shape to copy (Chunk) - 3-4 blocks
        const shapes = [
            {w:3, h:1}, {w:1, h:3},
            {w:4, h:1}, {w:1, h:4},
            {w:2, h:2} 
        ];
        
        // Filter shapes valid at origin
        const validShapes = [];
        for(const sh of shapes) {
            let matches = true;
            if (origin.x + sh.w > this.width || origin.y + sh.h > this.height) matches = false;
            else {
                for(let by=0; by<sh.h; by++) {
                    for(let bx=0; bx<sh.w; bx++) {
                        if (this.grid[this._idx(origin.x+bx, origin.y+by)] === 0) { matches = false; break; }
                    }
                }
            }
            if (matches) validShapes.push(sh);
        }
        
        if (validShapes.length === 0) return 0;
        const shape = validShapes[Math.floor(Math.random() * validShapes.length)];

        // Targets: Original + 3 Mirrors
        const candidates = [
            { rx: dx, ry: dy, rmx: moveX, rmy: moveY },
            { rx: -dx, ry: dy, rmx: -moveX, rmy: moveY },
            { rx: dx, ry: -dy, rmx: moveX, rmy: -moveY },
            { rx: -dx, ry: -dy, rmx: -moveX, rmy: -moveY }
        ];
        
        const uniqueCandidates = [];
        const seen = new Set();
        for (const c of candidates) {
            const ax = this.cx + c.rx;
            const ay = this.cy + c.ry;
            const key = `${ax},${ay}`;
            if (seen.has(key)) continue;
            seen.add(key);
            
            // Validate Source Existence
            let sourceValid = true;
            if (ax < 0 || ay < 0 || ax + shape.w > this.width || ay + shape.h > this.height) sourceValid = false;
            else {
                for(let by=0; by<shape.h; by++) {
                    for(let bx=0; bx<shape.w; bx++) {
                        if (this.grid[this._idx(ax+bx, ay+by)] === 0) { sourceValid = false; break; }
                    }
                }
            }
            if (sourceValid) uniqueCandidates.push(c);
        }

        // Validate the entire 3-step path for all candidates
        let validSteps = 0;
        for (let k = 1; k <= steps; k++) {
            let allValid = true;
            for (const c of uniqueCandidates) {
                const ax = this.cx + c.rx;
                const ay = this.cy + c.ry;
                const tx = ax + (c.rmx * k);
                const ty = ay + (c.rmy * k);
                
                if (tx < 0 || ty < 0 || tx + shape.w > this.width || ty + shape.h > this.height) {
                    allValid = false; break; 
                }
                
                // Collision with current step's NEW blocks (only relevant for k=1)
                if (k === 1) {
                    for(let by=0; by<shape.h; by++) {
                        for(let bx=0; bx<shape.w; bx++) {
                            const idx = this._idx(tx+bx, ty+by);
                            if (stepOccupancy[idx] === 1) { allValid = false; break; }
                        }
                        if (!allValid) break;
                    }
                }
                if (!allValid) break;
            }
            
            if (allValid) validSteps = k;
            else break;
        }
        
        if (validSteps === 0) return 0;
        
        let totalAdded = 0;
        
        // Execute Valid Steps
        for (let k = 1; k <= validSteps; k++) {
            const targetStep = s + (k - 1);
            
            // Recompute outside map to ensure correct exposure for each step of the animation
            const outsideMap = this._computeOutsideMap(); 
            
            for (const c of uniqueCandidates) {
                const ax = this.cx + c.rx;
                const ay = this.cy + c.ry;
                const tx = ax + (c.rmx * k);
                const ty = ay + (c.rmy * k);
                
                // Determine Ops Array (Current or Future)
                let currentOps = null;
                if (k === 1) {
                    currentOps = stepOps;
                } else {
                    if (!this.scheduledOps.has(targetStep)) this.scheduledOps.set(targetStep, []);
                    currentOps = this.scheduledOps.get(targetStep);
                }
                
                // Check Exposure (Lines)
                let isExposed = false;
                for(let by=0; by<shape.h; by++) {
                    for(let bx=0; bx<shape.w; bx++) {
                        const idx = this._idx(tx+bx, ty+by);
                        if (outsideMap[idx] === 1) {
                            isExposed = true;
                            break;
                        }
                    }
                    if (isExposed) break;
                }

                // Clear Old Lines
                this._clearAreaLines(tx, ty, shape.w, shape.h, currentOps);
                
                // Add Blocks & Update Grid Immediately
                let addedHere = 0;
                for(let by=0; by<shape.h; by++) {
                    for(let bx=0; bx<shape.w; bx++) {
                        const idx = this._idx(tx+bx, ty+by);
                        if (this.grid[idx] === 0) addedHere++;
                        this.grid[idx] = 1;
                        if (k === 1) stepOccupancy[idx] = 1; // Mark collision for current frame
                    }
                }
                totalAdded += addedHere;
                
                // Add Ops
                if (shape.w === 1 && shape.h === 1) {
                     currentOps.push(['add', tx - this.cx, ty - this.cy]);
                } else {
                     currentOps.push(['addRect', tx - this.cx, ty - this.cy, (tx + shape.w - 1) - this.cx, (ty + shape.h - 1) - this.cy]);
                }
                
                this._addPerimeterLines(targetStep, tx, ty, shape.w, shape.h, innerDuration, currentOps);
            }
        }
        
        return totalAdded;
    }

    _attemptRedistribution(stepOps, stepOccupancy) {
        const startX = Math.floor(Math.random() * this.width);
        const startY = Math.floor(Math.random() * this.height);
        for (let i = 0; i < this.width * this.height; i++) { 
            const rawIdx = (startY * this.width + startX + i) % (this.width * this.height);
            const x = rawIdx % this.width;
            const y = Math.floor(rawIdx / this.width);
            if (this.grid[rawIdx] === 0) continue;
            if (this._checkLine(x, y, 6, 1)) {
                // Check if target area for new rect is free in stepOccupancy
                const nx = x + 1;
                const ny = Math.max(0, y - 1); 
                let valid = true;
                if (nx + 3 <= this.width && ny + 2 <= this.height) {
                     for(let by=0; by<2; by++) {
                        for(let bx=0; bx<3; bx++) {
                            const idx = this._idx(nx+bx, ny+by);
                            if (stepOccupancy[idx] === 1) { valid = false; break; }
                        }
                        if (!valid) break;
                    }
                } else { valid = false; }

                if (valid) {
                    for(let k=0; k<6; k++) {
                        this.grid[this._idx(x+k, y)] = 0;
                        stepOps.push(['removeBlock', (x+k)-this.cx, y-this.cy, (x+k)-this.cx, y-this.cy]);
                    }
                    for(let by=0; by<2; by++) {
                        for(let bx=0; bx<3; bx++) {
                            const idx = this._idx(nx+bx, ny+by);
                            this.grid[idx] = 1;
                            stepOccupancy[idx] = 1;
                        }
                    }
                    stepOps.push(['addRect', nx-this.cx, ny-this.cy, (nx+2)-this.cx, (ny+1)-this.cy]);
                    return;
                }
            }
            if (this._checkLine(x, y, 1, 6)) {
                 // Check if target area for new rect is free in stepOccupancy
                const nx = Math.max(0, x - 1);
                const ny = y + 1;
                let valid = true;
                if (nx + 2 <= this.width && ny + 3 <= this.height) {
                     for(let by=0; by<3; by++) {
                        for(let bx=0; bx<2; bx++) {
                            const idx = this._idx(nx+bx, ny+by);
                            if (stepOccupancy[idx] === 1) { valid = false; break; }
                        }
                        if (!valid) break;
                    }
                } else { valid = false; }

                if (valid) {
                    for(let k=0; k<6; k++) {
                        this.grid[this._idx(x, y+k)] = 0;
                        stepOps.push(['removeBlock', x-this.cx, (y+k)-this.cy, x-this.cx, (y+k)-this.cy]);
                    }
                    for(let by=0; by<3; by++) {
                        for(let bx=0; bx<2; bx++) {
                             const idx = this._idx(nx+bx, ny+by);
                            this.grid[idx] = 1;
                            stepOccupancy[idx] = 1;
                        }
                    }
                    stepOps.push(['addRect', nx-this.cx, ny-this.cy, (nx+1)-this.cx, (ny+2)-this.cy]);
                    return;
                }
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

    _attemptExpansion(s, stepOps, weights, innerDuration, stepOccupancy, crossComplete) {
        const frontier = this._getFrontier();
        if (frontier.length === 0) return 0;
        let bestIdx = -1;
        
        // Calculate current extents for balancing during Phase 1
        let extN = 0, extS = 0, extW = 0, extE = 0;
        if (!crossComplete) {
            for (let i = 0; i < this.grid.length; i++) {
                if (this.grid[i] === 1) {
                    const rx = (i % this.width) - this.cx;
                    const ry = Math.floor(i / this.width) - this.cy;
                    if (ry < 0) extN = Math.max(extN, -ry);
                    else if (ry > 0) extS = Math.max(extS, ry);
                    if (rx < 0) extW = Math.max(extW, -rx);
                    else if (rx > 0) extE = Math.max(extE, rx);
                }
            }
        }

        const frontierWeights = new Float32Array(frontier.length);
        let totalWeight = 0;
        
        for (let i = 0; i < frontier.length; i++) {
            const pt = frontier[i];
            const rx = pt.x - this.cx;
            const ry = pt.y - this.cy;
            const arx = Math.abs(rx);
            const ary = Math.abs(ry);
            
            // 1. Determine Axis Bias (Aspect Ratio) - This is the "Meta" consideration
            // Use arx and ary to determine which arm this block belongs to
            const isVertical = (ary > arx);
            const axisBias = isVertical ? this.height : this.width;
            
            // 2. Base Weighting Logic (Density vs Distance)
            let baseWeight;
            if (crossComplete) {
                // Phase 2: Expansive bias
                baseWeight = Math.pow(Math.sqrt(arx*arx + ary*ary) + 1, 1.5);
            } else {
                // Phase 1: Density bias
                baseWeight = Math.pow(100 / (Math.min(arx, ary) + 1), 3);
            }
            
            // 3. Opposite-Arm Balancing (Isolated Pair Synchronization)
            let balanceWeight = 1.0;
            if (!crossComplete) {
                // Only throttle if one arm is leading its OPPOSITE by more than 3 blocks
                if (isVertical) {
                    // North/South Pair
                    if (ry < 0 && extN > extS + 3) balanceWeight = 0.3;
                    else if (ry > 0 && extS > extN + 3) balanceWeight = 0.3;
                } else if (arx > ary) {
                    // East/West Pair
                    if (rx < 0 && extW > extE + 3) balanceWeight = 0.3;
                    else if (rx > 0 && extE > extW + 3) balanceWeight = 0.3;
                }
            }
            
            // 4. Phase 0: Cardinal Constraint (Steps 1-6)
            // Restrict expansion strictly to the central cross axes.
            // We use a tolerance of 1 to allow for even-width center lines (2px wide).
            if (s <= 6) {
                if (Math.abs(rx) > 1 && Math.abs(ry) > 1) {
                    balanceWeight = 0; // Disable diagonal growth
                }
            }
            
            const weight = baseWeight * axisBias * balanceWeight;
            
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
        
        // Calculate Outside Map to determine exposure
        const outsideMap = this._computeOutsideMap();

        // RESOLUTION 1: Boundary Clamping
        // Instead of rejecting shapes that hit the edge, clamp them to fit.
        // This fixes the South/East bias where large shapes were impossible to place at the boundary.
        const safeW = Math.min(w, this.width - origin.x);
        const safeH = Math.min(h, this.height - origin.y);

        if (safeW > 0 && safeH > 0) {
            // Check Step Occupancy using clamped dimensions
            for(let by=0; by<safeH; by++) {
                for(let bx=0; bx<safeW; bx++) {
                    const idx = this._idx(origin.x+bx, origin.y+by);
                    if (stepOccupancy[idx] === 1) return 0; // Abort if overlaps new
                }
            }

            // Check if target area touches the True Outside
            let isExposed = false;
            for(let by=0; by<safeH; by++) {
                for(let bx=0; bx<safeW; bx++) {
                    const idx = this._idx(origin.x+bx, origin.y+by);
                    if (outsideMap[idx] === 1) {
                        isExposed = true;
                        break;
                    }
                }
                if (isExposed) break;
            }

            let actualAdded = 0;
            let overwriteCount = 0;
            for(let by=0; by<safeH; by++) {
                for(let bx=0; bx<safeW; bx++) {
                    const idx = this._idx(origin.x+bx, origin.y+by);
                    if (this.grid[idx] === 1) overwriteCount++;
                    else {
                        this.grid[idx] = 1;
                        actualAdded++;
                    }
                    stepOccupancy[idx] = 1;
                }
            }

            this._clearAreaLines(origin.x, origin.y, safeW, safeH, stepOps); // Clear existing lines before placing

            if (safeW === 1 && safeH === 1) {
                stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
            } else {
                stepOps.push(['addRect', 
                    origin.x - this.cx, 
                    origin.y - this.cy, 
                    (origin.x + safeW - 1) - this.cx, 
                    (origin.y + safeH - 1) - this.cy
                ]);
            }
            
            // Always add perimeter lines to ensure internal lines are generated
            this._addPerimeterLines(s, origin.x, origin.y, safeW, safeH, innerDuration, stepOps);
            
            return actualAdded;
        }
        
        const idx = this._idx(origin.x, origin.y);
        if (this.grid[idx] === 0) {
            if (stepOccupancy[idx] === 1) return 0;
            
            this.grid[idx] = 1;
            stepOccupancy[idx] = 1;
            
            this._clearAreaLines(origin.x, origin.y, 1, 1, stepOps); // Clear existing lines before placing
            stepOps.push(['add', origin.x - this.cx, origin.y - this.cy]);
            return 1;
        }
        return 0;
    }

    _checkAxisComplete(axis) {
        // Axis: 'X' or 'Y'
        const w = this.width;
        const h = this.height;
        const range = 5; // Scan width/height around center
        const depth = 2; // Depth from edge
        
        const checkRegion = (x, y, rw, rh) => {
            for(let i=0; i<rw; i++) {
                for(let j=0; j<rh; j++) {
                    const idx = this._idx(x+i, y+j);
                    if (idx !== -1 && this.grid[idx] === 1) return true;
                }
            }
            return false;
        };
        
        if (axis === 'Y') {
            const top = checkRegion(this.cx - Math.floor(range/2), 0, range, depth);
            const bottom = checkRegion(this.cx - Math.floor(range/2), h - depth, range, depth);
            return (top && bottom);
        } else if (axis === 'X') {
            const left = checkRegion(0, this.cy - Math.floor(range/2), depth, range);
            const right = checkRegion(w - depth, this.cy - Math.floor(range/2), depth, range);
            return (left && right);
        }
        return false;
    }

    _checkCrossCompletion() {
        return this._checkAxisComplete('X') && this._checkAxisComplete('Y');
    }

    _startCross(s, stepOps, stepOccupancy, innerDuration) {
        const arms = ['N', 'S', 'E', 'W'];
        const armLens = {};
        
        for (const arm of arms) {
            let len = 0;
            let dx = 0, dy = 0;
            if (arm === 'N') dy = -1;
            else if (arm === 'S') dy = 1;
            else if (arm === 'E') dx = 1;
            else if (arm === 'W') dx = -1;
            
            while (true) {
                const tx = this.cx + (dx * (len + 1));
                const ty = this.cy + (dy * (len + 1));
                if (this._idx(tx, ty) === -1 || this.grid[this._idx(tx, ty)] === 0) break;
                len++;
            }
            armLens[arm] = len;
        }
        
        const maxN = this.cy;
        const maxS = this.height - 1 - this.cy;
        const maxE = this.width - 1 - this.cx;
        const maxW = this.cx;
        
        const progress = {};
        progress['N'] = maxN > 0 ? armLens['N'] / maxN : 1;
        progress['S'] = maxS > 0 ? armLens['S'] / maxS : 1;
        progress['E'] = maxE > 0 ? armLens['E'] / maxE : 1;
        progress['W'] = maxW > 0 ? armLens['W'] / maxW : 1;
        
        let minP = 2.0;
        for (const p of Object.values(progress)) if (p < minP) minP = p;
        
        const candidates = [];
        const tolerance = 0.05; 
        for (const arm of arms) {
            if (progress[arm] <= minP + tolerance && progress[arm] < 1.0) {
                candidates.push(arm);
            }
        }
        
        if (candidates.length === 0) return 0;
        
        const arm = candidates[Math.floor(Math.random() * candidates.length)];
        
        let dx = 0, dy = 0;
        if (arm === 'N') dy = -1;
        else if (arm === 'S') dy = 1;
        else if (arm === 'E') dx = 1;
        else if (arm === 'W') dx = -1;
        
        const len = armLens[arm];
        const tx = this.cx + (dx * (len + 1));
        const ty = this.cy + (dy * (len + 1));
        
        const idx = this._idx(tx, ty);
        if (idx !== -1 && this.grid[idx] === 0 && stepOccupancy[idx] === 0) {
            this.grid[idx] = 1;
            stepOccupancy[idx] = 1;
            
            this._clearAreaLines(tx, ty, 1, 1, stepOps);
            // console.log(`[QGen] StartCross Adding at ${tx}, ${ty}. Step: ${s}`);
            stepOps.push(['add', tx - this.cx, ty - this.cy]);
            this._addPerimeterLines(s, tx, ty, 1, 1, innerDuration, stepOps);
            return 1;
        }
        
        return 0;
    }
}



