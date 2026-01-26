class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        // Generation State
        this.blockMap = new Map(); // "x,y" -> {x, y, w, h, id}
        this.activeBlocks = [];    // List for random selection
        this.timer = 0;
        this.genTimer = 0;
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        
        this.active = true;
        this.timer = 0;
        this.genTimer = 0;
        this.stepCount = 0;
        this.animFrame = 0; // Fix: Initialize animFrame
        this.alpha = 1.0;
        this.state = 'GENERATING';
        
        this.maskOps = [];
        this.blockMap.clear();
        this.activeBlocks = [];
        this.crawlers = [];
        this.unfoldSequences = [];
        this.nextBlockId = 0;
        this._lastProcessedOpIndex = 0; 
        
        this._initLogicGrid();
        
        // Force reset of cache flags to prevent stale map usage
        this._outsideMapDirty = true;
        this._distMapDirty = true;
        this._gridCacheDirty = true;
        
        // Manually set _last dimensions to ensure updateShadowSim runs correctly on frame 0
        const bs = this.getBlockSize();
        this._lastBlocksX = this.logicGridW;
        this._lastBlocksY = this.logicGridH;
        this._lastPitchX = Math.max(1, bs.w);
        this._lastPitchY = Math.max(1, bs.h);
        
        // Init Shadow World (Invisible background sim)
        this._initShadowWorldBase(false);
        this._populateShadowWorld(); // Custom dense population
        
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
            if (!this.renderGridL1 || this.renderGridL1.length !== this.renderGrid.length) this.renderGridL1 = new Int32Array(this.renderGrid.length);
            if (!this.renderGridL2 || this.renderGridL2.length !== this.renderGrid.length) this.renderGridL2 = new Int32Array(this.renderGrid.length);
            this.renderGridL1.fill(-1);
            this.renderGridL2.fill(-1);
        }
        
        this.overlapState = { step: 0 };
        this.pendingShifts = 0;
        this.spineState = {
            N: { len: 0, finished: false },
            S: { len: 0, finished: false },
            E: { len: 0, finished: false },
            W: { len: 0, finished: false }
        };
        this.unfoldState = null;
        
        // Seed (L1)
        this._spawnBlock(0, 0, 1, 1, 0); 
        
        return true;
    }
    
    _populateShadowWorld() {
        // High density fill for background
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        const d = this.c.derived;
        
        const cols = this.shadowGrid.cols;
        const rows = this.shadowGrid.rows;
        
        // Fill 50% of columns with streams
        for(let i=0; i<cols; i++) {
            if (Math.random() < 0.5) {
                const stream = sm._initializeStream(i, false, s);
                stream.y = Math.floor(Math.random() * rows);
                sm.addActiveStream(stream);
            }
        }
        
        // Warmup
        for(let i=0; i<60; i++) this.shadowSim.update(i);
        this.shadowSimFrame = 60;
    }

    _removeBlockFromActiveList(id) {
        this.activeBlocks = this.activeBlocks.filter(b => b.id !== id);
    }

    _attemptCrawlerGrowth(existingState) {
        let s = existingState;
        
        // Initialization (Starting a new crawler instance)
        if (!s) {
            // Limit to two crawlers at a time
            if (this.crawlers && this.crawlers.length >= 2) return;
            if (this.activeBlocks.length === 0) return;

            // Try several times to find a good starting point on the perimeter
            let bestX, bestY, bestDX, bestDY;
            let found = false;
            
            for (let i = 0; i < 20; i++) {
                const anchor = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
                const dirs = [{dx:0, dy:-1}, {dx:0, dy:1}, {dx:1, dy:0}, {dx:-1, dy:0}];
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                
                let tx = anchor.x;
                let ty = anchor.y;
                if (dir.dx === 1) tx = anchor.x + anchor.w;
                else if (dir.dx === -1) tx = anchor.x - 2;
                else if (dir.dy === 1) ty = anchor.y + anchor.h;
                else if (dir.dy === -1) ty = anchor.y - 1;

                // Check bounds
                const cx = Math.floor(this.logicGridW / 2);
                const cy = Math.floor(this.logicGridH / 2);
                if (tx + cx < 2 || tx + cx >= this.logicGridW - 2 || ty + cy < 2 || ty + cy >= this.logicGridH - 2) continue;

                // Check if this 2x1 at (tx, ty) would be fully internal
                let overlap = 0;
                for (const b of this.activeBlocks) {
                    const ix = Math.max(tx, b.x);
                    const iy = Math.max(ty, b.y);
                    const iw = Math.min(tx + 2, b.x + b.w) - ix;
                    const ih = Math.min(ty + 1, b.y + b.h) - iy;
                    if (iw > 0 && ih > 0) overlap += (iw * ih);
                }
                
                if (overlap < 2) { 
                    bestX = tx; bestY = ty; bestDX = dir.dx; bestDY = dir.dy;
                    found = true;
                    break;
                }
            }

            if (!found) return;

            s = {
                active: true,
                step: 0,
                x: bestX,
                y: bestY,
                dx: bestDX,
                dy: bestDY,
                lastBlockId: -1
            };
            this.crawlers.push(s);
            return;
        }
        
        const cycle = (s.step % 3);
        const now = this.animFrame;
        
        // --- Directional Sequence Logic ---
        // Rotated relative to East (1,0)
        let steps = [];

        if (s.dx === 1) { // East
             steps = [
                 { x: 0, y: 0, w: 2, h: 1 }, // Step 0: 2x1
                 { x: 0, y: 0, w: 1, h: 2 }, // Step 1: 1x2
                 { x: 0, y: 0, w: 2, h: 2 }  // Step 2: 2x2
             ];
        } else if (s.dy === 1) { // South
             steps = [
                 { x: 0, y: 0, w: 1, h: 2 }, // Step 0: 1x2
                 { x: -1, y: 0, w: 2, h: 1 }, // Step 1: 2x1
                 { x: -1, y: 0, w: 2, h: 2 }  // Step 2: 2x2
             ];
        } else if (s.dx === -1) { // West
             steps = [
                 { x: -1, y: 0, w: 2, h: 1 }, // Step 0: 2x1
                 { x: 0, y: -1, w: 1, h: 2 }, // Step 1: 1x2
                 { x: -1, y: -1, w: 2, h: 2 } // Step 2: 2x2
             ];
        } else if (s.dy === -1) { // North
             steps = [
                 { x: 0, y: -1, w: 1, h: 2 }, // Step 0: 1x2
                 { x: 0, y: 0, w: 2, h: 1 },  // Step 1: 2x1
                 { x: 0, y: -1, w: 2, h: 2 }  // Step 2: 2x2
             ];
        }

        const cfg = steps[cycle];

        // --- Collision Check ---
        // Ensure the target area doesn't overlap with any existing blocks (excluding our own tail)
        const targetX = s.x + cfg.x;
        const targetY = s.y + cfg.y;
        const targetW = cfg.w;
        const targetH = cfg.h;

        let collision = false;
        for (const b of this.activeBlocks) {
            if (b.id === s.lastBlockId) continue; // Ignore self/tail
            
            const ix = Math.max(targetX, b.x);
            const iy = Math.max(targetY, b.y);
            const iw = Math.min(targetX + targetW, b.x + b.w) - ix;
            const ih = Math.min(targetY + targetH, b.y + b.h) - iy;
            
            if (iw > 0 && ih > 0) {
                collision = true;
                break;
            }
        }
        
        if (collision) {
            s.active = false;
            return;
        }

        if (cycle === 0) {
            // Step 1 - MUST BE CONNECTED.
            s.lastBlockId = this._spawnBlock(s.x + cfg.x, s.y + cfg.y, cfg.w, cfg.h, 0, false, false, 0, false, true);
            if (s.lastBlockId === -1) {
                s.active = false;
                return;
            }
        } else if (cycle === 1) {
            // Step 2 - Remove block 1, spawn block 2.
            if (s.lastBlockId !== -1) {
                 const prev = steps[0];
                 this.maskOps.push({ type: 'removeBlock', x1: s.x + prev.x, y1: s.y + prev.y, x2: s.x + prev.x + prev.w - 1, y2: s.y + prev.y + prev.h - 1, startFrame: now });
                 this._writeToGrid(s.x + prev.x, s.y + prev.y, prev.w, prev.h, -1);
                 this._removeBlockFromActiveList(s.lastBlockId);
            }
            s.lastBlockId = this._spawnBlock(s.x + cfg.x, s.y + cfg.y, cfg.w, cfg.h, 0, false, false, 0, true, true);
        } else if (cycle === 2) {
            // Step 3 - Remove block 2 and replace with a 2x2 block.
            if (s.lastBlockId !== -1) {
                 const prev = steps[1];
                 this.maskOps.push({ type: 'removeBlock', x1: s.x + prev.x, y1: s.y + prev.y, x2: s.x + prev.x + prev.w - 1, y2: s.y + prev.y + prev.h - 1, startFrame: now });
                 this._writeToGrid(s.x + prev.x, s.y + prev.y, prev.w, prev.h, -1);
                 this._removeBlockFromActiveList(s.lastBlockId);
            }
            s.lastBlockId = this._spawnBlock(s.x + cfg.x, s.y + cfg.y, cfg.w, cfg.h, 0, false, false, 0, true, true);

            // Step 4 - Move 2 steps in current direction
            s.x += s.dx * 2;
            s.y += s.dy * 2;
        }         
        s.step++;
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;
        this.timer++;
        
        // Shadow Sim Update (Always run to keep code rain moving)
        if (!this.hasSwapped && !this.isSwapping) {
            this._updateShadowSim();
        } else if (this.isSwapping) {
            // Keep applying overrides during swap transition buffer
            this._updateShadowSim();
            
            this.swapTimer--;
            if (this.swapTimer <= 0) {
                // Transition Complete
                this.g.clearAllOverrides();
                this.isSwapping = false;
                this.hasSwapped = true;
                this.active = false;
                this.state = 'IDLE';
                
                // Cleanup
                this.shadowGrid = null;
                this.shadowSim = null;
            }
        }

        // Perform cleanup of expired ops (e.g. inner lines)
        const fadeOutFrames = this.getConfig('FadeFrames') || 0;
        if (this.maskOps.length > 0) {
             const oldLen = this.maskOps.length;
             this.maskOps = this.maskOps.filter(op => {
                 if (op.expireFrame && this.animFrame >= op.expireFrame + fadeOutFrames) return false;
                 return true;
             });
             if (this.maskOps.length !== oldLen) {
                 this._lastProcessedOpIndex = 0; // Trigger full re-process
             }
        }

        const durationFrames = (s.quantizedGenerateV2DurationSeconds || 5) * fps;
        
        if (this.state === 'GENERATING') {
            const speed = s.quantizedGenerateV2Speed || 1; 
            const interval = Math.max(1, 10 / speed); // Higher speed = lower interval
            
            this.genTimer++;
            if (this.genTimer >= interval) {
                this.genTimer = 0;
                this.stepCount++;
                // Attempt Growth
                this._attemptGrowth();
            }
            
            // Perform Hole Cleanup EVERY frame to ensure solidity
            this._performHoleCleanup();
            
            // Check if all spines hit the edge
            if (this.spineState && this.spineState.N.finished && this.spineState.S.finished && 
                this.spineState.E.finished && this.spineState.W.finished) {
                
                if (!this.hasSwapped && !this.isSwapping) {
                    this.state = 'FADE_OUT';
                    this.timer = 0;
                    this._swapStates();
                }
            }

            if (this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
            }
        } else if (this.state === 'FADE_OUT') {
            const fadeFrames = s.quantizedGenerateV2FadeFrames || 60;
            this.alpha = Math.max(0, 1.0 - (this.timer / fadeFrames));
            if (this.timer >= fadeFrames) {
                this.active = false;
                this.state = 'IDLE';
                this.g.clearAllOverrides();
            }
        }
        
        // Base class renders based on maskOps and renderGrid
        // We manually update renderGrid in _addBlock / _shiftBlocks, so we don't rely on base class logic loop
        // But we MUST set _maskDirty to trigger redraw
        this._maskDirty = true;
    }
    




    _attemptCyclicGrowth() {
        if (!this.cycleState) {
            this.cycleState = { step: 0, step1Block: null };
            // Ensure we have a base if starting fresh
            if (this.activeBlocks.length === 0) {
                 this._spawnBlock(0, 0, 2, 2, 0);
            }
        }

        const phase = this.cycleState.step % 3;
        
        // Helper: Find a spot that overlaps existing blocks but extends outwards
        const spawnSmart = (layer, mustOverlap, mustProtrude) => {
            const anchors = this.activeBlocks.filter(b => b.layer === 0); // Always grow from main mass (Layer 0)
            if (anchors.length === 0) return null;

            const attempts = 40; // Increased attempts for strict logic

            // Strict Area <= 6 Shapes
            // Prioritizing interesting shapes (strips, small rects)
            // 4x2 is 8, so it is excluded.
            const validShapes = [
                {w:1, h:2}, {w:2, h:1}, // Area 2
                {w:1, h:3}, {w:3, h:1}, // Area 3
                {w:2, h:2},             // Area 4
                {w:1, h:4}, {w:4, h:1}, // Area 4
                {w:1, h:5}, {w:5, h:1}, // Area 5
                {w:2, h:3}, {w:3, h:2}, // Area 6
                {w:1, h:6}, {w:6, h:1}  // Area 6
            ];

            for (let i = 0; i < attempts; i++) {
                const anchor = anchors[Math.floor(Math.random() * anchors.length)];
                
                // Select Random Shape from valid list
                const shape = validShapes[Math.floor(Math.random() * validShapes.length)];
                const w = shape.w;
                const h = shape.h;
                
                // Random Position near anchor
                // Allowed range includes strict touching (adjacent edges)
                // Range for x: [anchor.x - w, anchor.x + anchor.w]
                const ox = Math.floor(Math.random() * (anchor.w + w + 1)) - w;
                const oy = Math.floor(Math.random() * (anchor.h + h + 1)) - h;
                
                const tx = anchor.x + ox;
                const ty = anchor.y + oy;
                
                // Analyze Connectivity and Overlap with Layer 0 (Precedence Layer)
                let intersectArea = 0;
                let isTouching = false;

                for (const b of this.activeBlocks) {
                    if (b.layer !== 0) continue; 
                    
                    // Intersection
                    const ix = Math.max(tx, b.x);
                    const iy = Math.max(ty, b.y);
                    const iw = Math.min(tx + w, b.x + b.w) - ix;
                    const ih = Math.min(ty + h, b.y + b.h) - iy;
                    
                    if (iw > 0 && ih > 0) {
                        intersectArea += (iw * ih);
                    } else {
                        // Check Adjacency (Touching Edges)
                        // If no intersection, check if sharing an edge
                        const touchX = (tx === b.x + b.w) || (tx + w === b.x);
                        const overlapY = (ty < b.y + b.h) && (ty + h > b.y);
                        
                        const touchY = (ty === b.y + b.h) || (ty + h === b.y);
                        const overlapX = (tx < b.x + b.w) && (tx + w > b.x);
                        
                        if ((touchX && overlapY) || (touchY && overlapX)) {
                            isTouching = true;
                        }
                    }
                }
                
                const totalArea = w * h;
                const protrudeArea = totalArea - intersectArea;

                // Validation Logic
                // mustOverlap (Connectivity): Valid if intersection > 0 OR strictly touching
                const isConnected = (intersectArea > 0 || isTouching);
                
                // mustProtrude (Growth): Valid if it adds new area to the blob
                const isProtruding = (protrudeArea > 0);

                let valid = true;
                if (mustOverlap && !isConnected) valid = false;
                if (mustProtrude && !isProtruding) valid = false;
                
                if (valid) {
                    this._spawnBlock(tx, ty, w, h, layer);
                    return { x: tx, y: ty, w, h };
                }
            }
            return null;
        };

        if (phase === 0) { 
            // Step 1: Layer 0 spawns something.
            const b = spawnSmart(0, true, true);
            if (b) this.cycleState.step1Block = b;
            
        } else if (phase === 1) { 
            // Step 2: Layer 1 spawns something.
            spawnSmart(1, true, true);

        } else if (phase === 2) { 
            // Step 3: Layer 0 spawns ... attached to outside perimeter ... not entirely inside/outside.
            spawnSmart(0, true, true);
            
            // "Interior lines start fading out that were placed in the very first step"
            if (this.cycleState.step1Block) {
                const b = this.cycleState.step1Block;
                for (let iy = 0; iy < b.h; iy++) {
                    for (let ix = 0; ix < b.w; ix++) {
                        const lx = b.x + ix;
                        const ly = b.y + iy;
                        this.maskOps.push({ type: 'remLine', x1: lx, y1: ly, x2: lx, y2: ly, face: 'N', force: true, startFrame: this.animFrame });
                        this.maskOps.push({ type: 'remLine', x1: lx, y1: ly, x2: lx, y2: ly, face: 'S', force: true, startFrame: this.animFrame });
                        this.maskOps.push({ type: 'remLine', x1: lx, y1: ly, x2: lx, y2: ly, face: 'W', force: true, startFrame: this.animFrame });
                        this.maskOps.push({ type: 'remLine', x1: lx, y1: ly, x2: lx, y2: ly, face: 'E', force: true, startFrame: this.animFrame });
                    }
                }
            }
        }

        this.cycleState.step++;
    }

    _attemptGrowth() {
        // 1. Execute Ramped Count of Random Behaviors
        let totalTarget;
        if (this.stepCount < 3) {
            totalTarget = Math.floor(Math.random() * 2) + 1; // 1-2
        } else if (this.stepCount < 6) {
            totalTarget = Math.floor(Math.random() * 3) + 3; // 3-5
        } else {
            totalTarget = 10;
        }

        // 2. Define Random Behavior Pool based on Config
        const pool = [];
        const s = this.c.state;

        // Default to true if undefined (backward compatibility)
        const enCyclic = (s.quantizedGenerateV2EnableCyclic !== undefined) ? s.quantizedGenerateV2EnableCyclic : true;
        const enSpine = (s.quantizedGenerateV2EnableSpine !== undefined) ? s.quantizedGenerateV2EnableSpine : true;
        const enOverlap = (s.quantizedGenerateV2EnableOverlap !== undefined) ? s.quantizedGenerateV2EnableOverlap : true;
        const enUnfold = (s.quantizedGenerateV2EnableUnfold !== undefined) ? s.quantizedGenerateV2EnableUnfold : true;
        const enCrawler = (s.quantizedGenerateV2EnableCrawler !== undefined) ? s.quantizedGenerateV2EnableCrawler : true;
        const enShift = (s.quantizedGenerateV2EnableShift !== undefined) ? s.quantizedGenerateV2EnableShift : false;
        const enCluster = (s.quantizedGenerateV2EnableCluster !== undefined) ? s.quantizedGenerateV2EnableCluster : false;

        if (enCyclic) pool.push(this._attemptCyclicGrowth.bind(this));
        if (enSpine) pool.push(this._attemptSpineGrowth.bind(this));
        if (enOverlap) pool.push(this._attemptLayerOverlap.bind(this));
        if (enUnfold) pool.push(this._attemptUnfoldGrowth.bind(this));
        if (enCrawler) pool.push(this._attemptCrawlerGrowth.bind(this));
        if (enShift) pool.push(this._attemptShiftGrowth.bind(this));
        if (enCluster) pool.push(this._attemptClusterGrowth.bind(this));

        // If all disabled, do nothing (or fallback to overlap/cyclic to ensure SOMETHING happens?)
        // User requested ability to turn them off/isolate. So if all off, nothing grows.
        if (pool.length === 0) return;

        // 3. Shuffle Pool
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        // 4. Process Existing Active Crawlers
        if (this.crawlers) {
            for (let i = this.crawlers.length - 1; i >= 0; i--) {
                const crawler = this.crawlers[i];
                if (crawler.active) {
                    this._attemptCrawlerGrowth(crawler);
                } else {
                    this.crawlers.splice(i, 1);
                }
            }
        }

        // Process Unfold Sequences
        if (this.unfoldSequences) {
            for (let i = this.unfoldSequences.length - 1; i >= 0; i--) {
                const seq = this.unfoldSequences[i];
                if (seq.active) {
                    this._attemptUnfoldGrowth(seq);
                } else {
                    this.unfoldSequences.splice(i, 1);
                }
            }
        }

        // 5. Execute Remaining Quota
        for (let i = 0; i < totalTarget; i++) {
            const behavior = pool[i % pool.length];
            behavior();
        }
    }
    
    _blockShift(direction, amount, startCoords) {
        if (!this.renderGrid) return;

        const w = this.logicGridW;
        const h = this.logicGridH;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        let dx = 0, dy = 0;
        let scanX = false; // true if scanning X axis (East/West)

        if (direction === 'N') { dy = -1; scanX = false; }
        else if (direction === 'S') { dy = 1; scanX = false; }
        else if (direction === 'E') { dx = 1; scanX = true; }
        else if (direction === 'W') { dx = -1; scanX = true; }

        // Determine fixed row/col from startCoords
        const rowY = startCoords.y;
        const colX = startCoords.x;

        let currentRelX = 0;
        let currentRelY = 0;

        if (scanX) {
            currentRelY = rowY;
        } else {
            currentRelX = colX;
        }

        // 1. Find the "Perimeter" (furthest occupied cell from center)
        let furthestDist = -1;
        const potentialGaps = [];

        // Scan safe upper bound
        const maxDist = Math.max(w, h);

        for (let d = 0; d < maxDist; d++) {
            const tx = currentRelX + (scanX ? d * dx : 0);
            const ty = currentRelY + (scanX ? 0 : d * dy);

            const gx = cx + tx;
            const gy = cy + ty;

            // Bounds check
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) break;

            const idx = gy * w + gx;
            // Check if occupied (value !== -1)
            const occupied = (this.renderGrid[idx] !== -1);

            if (occupied) {
                furthestDist = d;
            } else {
                potentialGaps.push({x: tx, y: ty, d: d});
            }
        }

        // 2. Fill Gaps up to furthestDist
        // We filter potentialGaps to only those BEFORE the furthest occupied block
        for (const gap of potentialGaps) {
            if (gap.d < furthestDist) {
                // Gap Fill: allowInternal=true to ensure we can fill holes
                this._spawnBlock(gap.x, gap.y, 1, 1, 0, false, false, 0, false, true); 
            }
        }

        // 3. Add 'amount' blocks after furthestDist
        // If furthestDist was -1 (empty ray), we start at 0 (center axis)
        let startExt = furthestDist + 1;

        for (let i = 0; i < amount; i++) {
            const d = startExt + i;
            const tx = currentRelX + (scanX ? d * dx : 0);
            const ty = currentRelY + (scanX ? 0 : d * dy);
            
            // Check bounds
            const gx = cx + tx;
            const gy = cy + ty;
            if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                // Extension: Standard spawn
                this._spawnBlock(tx, ty, 1, 1, 0);
            }
        }
    }

    _spawnNeighbor(anchor) {
        // Directions: N, S, E, W
        const dirs = ['N', 'S', 'E', 'W'];
        // Try random order
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }

        for (const dir of dirs) {
            // Determine random size
            const w = Math.floor(Math.random() * 2) + 1; // 1 or 2
            const h = Math.floor(Math.random() * 2) + 1; // 1 or 2
            
            let tx, ty;
            
            if (dir === 'N') {
                // North: y = anchor.y - h
                // x aligned with anchor x? overlap range
                // x range: [anchor.x - w + 1, anchor.x + anchor.w - 1] to ensure overlap
                const minX = anchor.x - w + 1;
                const maxX = anchor.x + anchor.w - 1;
                const range = maxX - minX;
                tx = minX + (range > 0 ? Math.floor(Math.random() * (range + 1)) : 0);
                ty = anchor.y - h;
            } else if (dir === 'S') {
                // South: y = anchor.y + anchor.h
                const minX = anchor.x - w + 1;
                const maxX = anchor.x + anchor.w - 1;
                const range = maxX - minX;
                tx = minX + (range > 0 ? Math.floor(Math.random() * (range + 1)) : 0);
                ty = anchor.y + anchor.h;
            } else if (dir === 'E') {
                // East: x = anchor.x + anchor.w
                const minY = anchor.y - h + 1;
                const maxY = anchor.y + anchor.h - 1;
                const range = maxY - minY;
                tx = anchor.x + anchor.w;
                ty = minY + (range > 0 ? Math.floor(Math.random() * (range + 1)) : 0);
            } else if (dir === 'W') {
                // West: x = anchor.x - w
                const minY = anchor.y - h + 1;
                const maxY = anchor.y + anchor.h - 1;
                const range = maxY - minY;
                tx = anchor.x - w;
                ty = minY + (range > 0 ? Math.floor(Math.random() * (range + 1)) : 0);
            }
            
            // Attempt spawn
            // allowInternal = false (default) enforces that it must not be fully inside.
            // But we want it strictly OUTSIDE. 
            // _spawnBlock checks connectivity (must touch) and collision.
            const id = this._spawnBlock(tx, ty, w, h);
            if (id !== -1) return id;
        }
        return -1;
    }

    _attemptShiftGrowth() {
        if (this.activeBlocks.length === 0) return;

        // Pick a random edge block
        const anchor = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        const dirs = ['N', 'S', 'E', 'W'];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        
        // Growth amount: 1-2 blocks
        const amount = Math.floor(Math.random() * 2) + 1;
        
        // Targeted Shift:
        // If North/South: scan from horizontal center (x=0) at anchor.y
        // If East/West: scan from vertical center (y=0) at anchor.x
        let startCoords;
        if (dir === 'N' || dir === 'S') {
            startCoords = { x: anchor.x, y: 0 };
        } else {
            startCoords = { x: 0, y: anchor.y };
        }

        this._blockShift(dir, amount, startCoords);
    }

    _attemptUnfoldGrowth(sequence = null) {
        // If updating an existing sequence
        if (sequence && sequence.lastBlockId !== undefined) {
             if (sequence.count <= 0) { sequence.active = false; return; }
             
             // Find last block
             const lastBlock = this.activeBlocks.find(b => b.id === sequence.lastBlockId);
             if (!lastBlock) { sequence.active = false; return; }
             
             // Attempt to spawn attached to lastBlock
             const newId = this._spawnNeighbor(lastBlock);
             if (newId !== -1) {
                 sequence.lastBlockId = newId;
                 sequence.count--;
                 if (sequence.count <= 0) sequence.active = false;
             } else {
                 // Blocked? Abort
                 sequence.active = false;
             }
             return;
        }

        // STARTING NEW SEQUENCE (From Pool)
        if (this.activeBlocks.length === 0) return;
        
        // Try random blocks to find a valid seed
        for(let i=0; i<10; i++) {
            const b = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
            const newId = this._spawnNeighbor(b);
            if (newId !== -1) {
                // Success: Start sequence
                // We spawned 1 block. We need 2 more. count = 2.
                const seq = { active: true, count: 2, lastBlockId: newId };
                this.unfoldSequences.push(seq);
                return;
            }
        }
    }
    
    _performHoleCleanup() {
        if (!this.renderGrid) return;
        const w = this.logicGridW;
        const h = this.logicGridH;
        
        // 1. Flood Fill from Outside
        const visited = new Uint8Array(w * h); // 0=Unvisited(Potential Hole), 1=Outside
        const stack = [];
        
        // Init Stack with Border Empty Cells
        const add = (x, y) => {
            const idx = y * w + x;
            if (this.renderGrid[idx] === -1 && visited[idx] === 0) {
                visited[idx] = 1;
                stack.push(idx);
            }
        };
        
        for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
        for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
        
        while (stack.length > 0) {
            const idx = stack.pop();
            const cx = idx % w;
            const cy = Math.floor(idx / w);
            
            // Neighbors
            const neighbors = [
                { x: cx, y: cy - 1 },
                { x: cx, y: cy + 1 },
                { x: cx - 1, y: cy },
                { x: cx + 1, y: cy }
            ];
            
            for (const n of neighbors) {
                if (n.x >= 0 && n.x < w && n.y >= 0 && n.y < h) {
                    add(n.x, n.y);
                }
            }
        }
        
        // 2. Identify Holes (Internal Empty Cells)
        // We map them to a temporary 'isHole' array to allow pattern matching
        const isHole = new Uint8Array(w * h);
        for(let i=0; i<w*h; i++) {
            if (this.renderGrid[i] === -1 && visited[i] === 0) {
                isHole[i] = 1;
            }
        }

        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        // 3. Priority Fill: 2x2 Blocks
        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                const i = y * w + x;
                // Check 2x2 area
                if (isHole[i] && isHole[i+1] && isHole[i+w] && isHole[i+w+1]) {
                    // Spawn 2x2 with suppressed lines (Hole Filler)
                    this._spawnBlock(x - cx, y - cy, 2, 2, 0, true);
                    // Mark as filled
                    isHole[i] = 0; isHole[i+1] = 0;
                    isHole[i+w] = 0; isHole[i+w+1] = 0;
                }
            }
        }
        
        // 4. Fallback Fill: 1x1 Blocks
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (isHole[idx]) {
                    // Spawn 1x1 with suppressed lines (Hole Filler)
                    this._spawnBlock(x - cx, y - cy, 1, 1, 0, true);
                    isHole[idx] = 0; 
                }
            }
        }
    }

    _attemptSpineGrowth() {
        if (!this.spineState) return;
        
        const s = this.spineState;
        const arms = ['N', 'S', 'E', 'W'];
        
        // Pick an arm that isn't finished
        const candidates = arms.filter(a => !s[a].finished);
        if (candidates.length === 0) return;
        
        const arm = candidates[Math.floor(Math.random() * candidates.length)];
        const data = s[arm];
        
        // Growth parameters
        const breadth = Math.random() < 0.3 ? 2 : 1; // Occasional thickness
        let length;

        if (breadth === 1) {
            // Single bars: length 3 only 25% of the time, otherwise length 2
            length = (Math.random() < 0.25) ? 3 : 2;
        } else {
            // Breadth 2: Max area 3 means length must be 1
            length = 1;
        }
        
        // Grid Dimensions
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        let tx = 0, ty = 0;
        let w = 0, h = 0;
        
        // Calculate tentative position & Clamp to Edge
        if (arm === 'N') {
            w = breadth;
            tx = -Math.floor(breadth/2);
            // Current top is at -data.len. We want to extend up by length.
            // New top will be -(data.len + length).
            // Absolute Y of new top: cy - (data.len + length)
            // Must be >= 0.
            const absTop = cy - (data.len + length);
            if (absTop < 0) {
                // Clamp length
                const over = -absTop;
                length -= over;
                data.finished = true; // Will hit edge this step
            }
            if (length <= 0) { data.finished = true; return; }
            
            ty = -(data.len + length);
            h = length;
            
        } else if (arm === 'S') {
            w = breadth;
            tx = -Math.floor(breadth/2);
            // Current bottom is data.len. Start of new block is data.len + 1.
            // Absolute Y of bottom: cy + (data.len + 1) + length - 1 = cy + data.len + length
            // Must be < blocksY.
            const startRel = data.len + 1;
            const absBottom = cy + startRel + length;
            if (absBottom > blocksY) {
                const over = absBottom - blocksY;
                length -= over;
                data.finished = true;
            }
            if (length <= 0) { data.finished = true; return; }
            
            ty = startRel;
            h = length;
            
        } else if (arm === 'E') {
            h = breadth;
            ty = -Math.floor(breadth/2);
            // Start rel x: data.len + 1
            const startRel = data.len + 1;
            const absRight = cx + startRel + length;
            if (absRight > blocksX) {
                const over = absRight - blocksX;
                length -= over;
                data.finished = true;
            }
            if (length <= 0) { data.finished = true; return; }
            
            tx = startRel;
            w = length;
            
        } else if (arm === 'W') {
            h = breadth;
            ty = -Math.floor(breadth/2);
            // New left: -(data.len + length)
            const absLeft = cx - (data.len + length);
            if (absLeft < 0) {
                const over = -absLeft;
                length -= over;
                data.finished = true;
            }
            if (length <= 0) { data.finished = true; return; }
            
            tx = -(data.len + length);
            w = length;
        }
        
        // Final sanity check (should be covered by clamping logic)
        if (cx + tx < 0 || cx + tx + w > blocksX || 
            cy + ty < 0 || cy + ty + h > blocksY) {
            data.finished = true;
            return;
        }
        
        // Spawn
        this._spawnBlock(tx, ty, w, h, 0); // Layer 0 for spine
        
        // Update State
        data.len += length;
    }

    _attemptClusterGrowth() {
        if (this.activeBlocks.length === 0) return;

        // "In clusters of 2 or 3, a spine location will be determined."
        // We interpret this as: Pick a spine, and shift 2-3 blocks along it.
        
        // 1. Determine Spine Location (Row or Column)
        // We pick a random block to define the axis coordinate.
        const anchor = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        
        // 2. Determine Axis/Direction
        // 50% chance of Vertical Spine (N/S) at anchor.x
        // 50% chance of Horizontal Spine (E/W) at anchor.y
        const axis = Math.random() < 0.5 ? 'V' : 'H';
        
        let dir;
        let startCoords;
        
        if (axis === 'V') {
            // Vertical Spine: Grow North or South
            dir = Math.random() < 0.5 ? 'N' : 'S';
            startCoords = { x: anchor.x, y: 0 }; // Scan col from center y=0
        } else {
            // Horizontal Spine: Grow East or West
            dir = Math.random() < 0.5 ? 'E' : 'W';
            startCoords = { x: 0, y: anchor.y }; // Scan row from center x=0
        }
        
        // 3. Amount "Cluster of 2 or 3"
        const amount = Math.floor(Math.random() * 2) + 2; // 2 or 3
        
        // 4. Execute Shift
        this._blockShift(dir, amount, startCoords);
    }

    _attemptLayerOverlap() {
        const s = this.overlapState;
        
        if (s.step === 0) {
            // Step 1: L1 1x2 Center
            this._spawnBlock(0, 0, 1, 2, 0); 
        } else if (s.step === 1) {
            // Step 2: L2 3x1 Across center
            this._spawnBlock(-1, 0, 3, 1, 1); 
        } else if (s.step === 2) {
            // Step 3: Add L1 1x1 left + Merge
            this._mergeLayers();
            this._spawnBlock(-2, 0, 1, 1, 0); 
        } else if (s.step === 3) {
            // Step 4: Add L2 intersecting + Merge
            this._mergeLayers();
            this._spawnBlock(0, -1, 1, 3, 1); 
        } else {
            // DYNAMIC CLOUD GROWTH
            // Merge Layer 1 into Layer 0 every few steps to solidify the "cloud"
            if (s.step % 4 === 0) {
                this._mergeLayers();
            }

            // Pick an anchor block, preferring Layer 1 (active) blocks
            const l1Blocks = this.activeBlocks.filter(b => b.layer === 1);
            const anchor = (l1Blocks.length > 0 && Math.random() < 0.7) 
                ? l1Blocks[Math.floor(Math.random() * l1Blocks.length)]
                : this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];

            if (!anchor) return;

            const range = 6 + Math.floor(s.step / 3);
            let tx, ty, tw, th;
            
            // Attempt to place a new block that partially overlaps or touches the anchor
            const attempts = 5;
            let success = false;
            for (let i = 0; i < attempts; i++) {
                tw = Math.floor(Math.random() * 3) + 1;
                th = Math.floor(Math.random() * 3) + 1;
                
                // Random offset that likely results in overlap or adjacency
                const ox = Math.floor(Math.random() * (anchor.w + tw + 1)) - tw;
                const oy = Math.floor(Math.random() * (anchor.h + th + 1)) - th;
                
                tx = anchor.x + ox;
                ty = anchor.y + oy;

                // Boundary check
                if (Math.abs(tx) <= range && Math.abs(ty) <= range) {
                    success = true;
                    break;
                }
            }
            
            if (!success) {
                // Fallback: random scatter near center
                tx = Math.floor(Math.random() * range * 2) - range;
                ty = Math.floor(Math.random() * range * 2) - range;
                tw = Math.floor(Math.random() * 2) + 1;
                th = Math.floor(Math.random() * 2) + 1;
            }

            // Spawn on Layer 1 to represent "active" growth
            this._spawnBlock(tx, ty, tw, th, 1);
            
            // Occasional small detail block on Layer 0 to fill gaps
            if (Math.random() < 0.2) {
                const dx = Math.floor(Math.random() * 5) - 2;
                const dy = Math.floor(Math.random() * 5) - 2;
                this._spawnBlock(tx + dx, ty + dy, 1, 1, 0);
            }
        }
        s.step++;
    }

    _attemptBlockShift() {
        if (this.activeBlocks.length < 5) return false;
        
        const validShapes = [
            {w:1, h:1}, 
            {w:1, h:2}, {w:2, h:1}, // Area 2
            {w:1, h:3}, {w:3, h:1}  // Area 3
        ];
        
        if (!this.renderGrid) return false;
        const w = this.logicGridW;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(this.logicGridH / 2);
        
        // Axis-Driven Placement
        let useYAxis = Math.random() < 0.5; // True: Vertical Spine (X=0)
        
        const shape = validShapes[Math.floor(Math.random() * validShapes.length)];
        const tw = shape.w;
        const th = shape.h;
        
        let tx, ty;
        if (useYAxis) {
            // Vertical Spine (X=0)
            tx = -Math.floor(tw / 2); 
            const candidates = this.activeBlocks.filter(b => b.x <= 0 && b.x + b.w > 0);
            if (candidates.length === 0) return false;
            const anchor = candidates[Math.floor(Math.random() * candidates.length)];
            ty = anchor.y + Math.floor((anchor.h - th) / 2);
        } else {
            // Horizontal Spine (Y=0)
            ty = -Math.floor(th / 2);
            const candidates = this.activeBlocks.filter(b => b.y <= 0 && b.y + b.h > 0);
            if (candidates.length === 0) return false;
            const anchor = candidates[Math.floor(Math.random() * candidates.length)];
            tx = anchor.x + Math.floor((anchor.w - tw) / 2);
        }
        
        // Verify Internal
        let isInternal = true;
        for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
                const gx = cx + tx + x;
                const gy = cy + ty + y;
                const idx = gy * w + gx;
                if (gx < 0 || gx >= w || gy < 0 || gy >= this.logicGridH || this.renderGrid[idx] === -1) {
                    isInternal = false;
                    break;
                }
            }
            if (!isInternal) break;
        }
        
        if (!isInternal) return false;

        // 4. Determine Direction (Nudge logic)
        // Center of shifter relative to grid center (0,0)
        const sx = tx + tw / 2;
        const sy = ty + th / 2;
        
        let shiftX = 0;
        let shiftY = 0;
        
        // Standard Behavior (Dominant Axis)
        if (Math.abs(sy) > Math.abs(sx)) {
            // Vertical Dominance
            if (sy < 0) shiftY = -th; // North
            else shiftY = th;         // South
        } else {
            // Horizontal Dominance
            if (sx > 0) shiftX = tw;  // East
            else shiftX = -tw;        // West
        }

        if (shiftX === 0 && shiftY === 0) return false;

        // 5. Nudge existing blocks
        // Filter blocks that are "downstream"
        // Downstream means:
        // - They overlap the channel (orthogonal axis overlap)
        // - Their center is further in the shift direction than the shifter center
        
        const movingBlocks = [];
        
        for (const b of this.activeBlocks) {
            let inChannel = false;
            let isDownstream = false;
            
            if (shiftX !== 0) {
                // Horizontal Shift
                // Overlaps Y range
                const startY = Math.max(ty, b.y);
                const endY = Math.min(ty + th, b.y + b.h);
                if (endY > startY) inChannel = true;
                
                // Downstream check
                const bCenter = b.x + b.w / 2;
                if (shiftX > 0) isDownstream = (bCenter >= sx); // East
                else isDownstream = (bCenter <= sx);            // West
                
            } else {
                // Vertical Shift
                // Overlaps X range
                const startX = Math.max(tx, b.x);
                const endX = Math.min(tx + tw, b.x + b.w);
                if (endX > startX) inChannel = true;
                
                // Downstream check
                const bCenter = b.y + b.h / 2;
                if (shiftY < 0) isDownstream = (bCenter <= sy); // North (sy is neg)
                else isDownstream = (bCenter >= sy);            // South
            }
            
            if (inChannel && isDownstream) {
                movingBlocks.push(b);
            }
        }

        if (movingBlocks.length === 0) return false;

        // Execute Shift via "Move" (Update Position)
        // We move the existing blocks to create space, rather than cloning them (which caused exponential growth).
        // The Shifter block (spawned below) fills the primary gap, and _performHoleCleanup handles any shearing gaps.
        for (const b of movingBlocks) {
            this._updateBlockPosition(b, b.x + shiftX, b.y + shiftY);
        }

        // 6. Spawn "Invisible" Shifter Block (Solid Fill, No Lines)
        // This takes up the space vacated by the shift, ensuring no holes.
        // Marked as isShifter=true for visualization.
        this._spawnBlock(tx, ty, tw, th, 0, true, true);
        
        return true;
    }

    render(ctx, d) {
        // 1. Call base render (handles normal layers like Perimeter and Inner lines)
        super.render(ctx, d);
        
        if (!this.active) return;

        // 2. Debug: Draw Shifter blocks as Blue on the overlay
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);
        const l = this.layout;
        if (!l) return;

        ctx.fillStyle = 'rgba(0, 100, 255, 0.6)'; // Blue
        for (const op of this.maskOps) {
            if (op.isShifter) {
                const sBx = (cx + op.x1) - l.offX;
                const sBy = (cy + op.y1) - l.offY;
                const eBx = (cx + op.x2) - l.offX;
                const eBy = (cy + op.y2) - l.offY;

                const startX = Math.floor(sBx * l.cellPitchX);
                const endX = Math.floor((eBx + 1) * l.cellPitchX);
                const startY = Math.floor(sBy * l.cellPitchY);
                const endY = Math.floor((eBy + 1) * l.cellPitchY);

                const xPos = l.screenOriginX + (startX * l.screenStepX);
                const yPos = l.screenOriginY + (startY * l.screenStepY);
                const w = (endX - startX) * l.screenStepX;
                const h = (endY - startY) * l.screenStepY;

                ctx.fillRect(xPos, yPos, w, h);
            }
        }
    }

    _renderInteriorPass(ctx, now, addDuration) {
        const cx = Math.floor(this.logicGridW / 2);
        const cy = Math.floor(this.logicGridH / 2);

        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            let opacity = 1.0;

            if (addDuration > 1 && op.startFrame && !this.debugMode) {
                opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            }
            
            // Layer 1 distinction: Subtle pulse
            if (op.layer === 1) {
                const pulse = 0.85 + 0.15 * Math.sin(now * 0.15);
                opacity *= pulse;
            }
            
            ctx.globalAlpha = opacity;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            this._addBlock(start, end, op.ext, false);
        }
    }

    _mergeLayers() {
        // Persist merge by updating Ops
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (op.layer === 1) {
                    op.layer = 0;
                }
            }
        }

        // Fix: Update Active Blocks layer so subsequent filters are correct
        for (const b of this.activeBlocks) {
            if (b.layer === 1) {
                b.layer = 0;
            }
        }
        
        // Also update manual grids for immediate feedback (though Base will overwrite)
        if (!this.renderGridL2 || !this.renderGridL1) return;
        for(let i=0; i<this.renderGridL2.length; i++) {
            const val = this.renderGridL2[i];
            if (val !== -1) {
                this.renderGridL1[i] = val; 
                this.renderGridL2[i] = -1; 
            }
        }
    }
    
    _findCollisions(x, y, w, h) {
        const hits = [];
        // Naive check: Iterate all active blocks (Optimization: Spatial Hash later)
        for (const b of this.activeBlocks) {
            if (x < b.x + b.w && x + w > b.x &&
                y < b.y + b.h && y + h > b.y) {
                hits.push(b);
            }
        }
        return hits;
    }
    
    _applyShove(blocks, dx, dy) {
        // Recursive Shove? Or just push the immediate ones?
        // Recursive is better for "solid" feel.
        // Stack-based push.
        
        const toPush = new Set(blocks);
        const stack = [...blocks];
        let loopCount = 0;
        
        while(stack.length > 0) {
            loopCount++;
            if (loopCount > 50000) {
                console.error("[QBlockGen] Infinite Loop detected in Shove! Aborting shove.");
                break;
            }

            const b = stack.pop();
            
            // Hypothetical new position
            const nx = b.x + dx;
            const ny = b.y + dy;
            
            // Check what IT collides with (excluding already pushing blocks)
            for (const other of this.activeBlocks) {
                if (toPush.has(other)) continue;
                
                if (nx < other.x + other.w && nx + b.w > other.x &&
                    ny < other.y + other.h && ny + b.h > other.y) {
                    
                    toPush.add(other);
                    stack.push(other);
                }
            }
        }
        
        // Execute Push
        for (const b of toPush) {
            this._updateBlockPosition(b, b.x + dx, b.y + dy);
        }
    }
    
    _updateBlockPosition(b, newX, newY) {
        // 1. Clear old grid pixels
        this._writeToGrid(b.x, b.y, b.w, b.h, -1);
        
        // Offset Calculation for MaskOps
        const dx = newX - b.x;
        const dy = newY - b.y;
        
        // 2. Update coords
        b.x = newX;
        b.y = newY;
        
        // 3. Write new grid pixels
        // Use b.startFrame to preserve age (color/fade)
        this._writeToGrid(b.x, b.y, b.w, b.h, b.startFrame);
        
        // 4. Update associated MaskOps (Lines/Fill)
        if (this.maskOps) {
             for (const op of this.maskOps) {
                 if (op.blockId === b.id) {
                     op.x1 += dx;
                     op.x2 += dx;
                     op.y1 += dy;
                     op.y2 += dy;
                 }
             }
        }
    }
    
    _spawnBlock(x, y, w, h, layer = 0, suppressLines = false, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false) {
        // Strict Connectivity Check (Perimeter Containment)
        // Ensure new block touches or overlaps at least one existing block.
        if (!skipConnectivity && this.activeBlocks.length > 0) {
             let connected = false;
             let totalOverlap = 0;
             const area = w * h;

             for (const b of this.activeBlocks) {
                 const xOverlap = (x <= b.x + b.w) && (x + w >= b.x);
                 const yOverlap = (y <= b.y + b.h) && (y + h >= b.y);
                 
                 if (xOverlap && yOverlap) {
                     connected = true;
                     
                     // Calculate Area Overlap
                     const ix = Math.max(x, b.x);
                     const iy = Math.max(y, b.y);
                     const iw = Math.min(x + w, b.x + b.w) - ix;
                     const ih = Math.min(y + h, b.y + b.h) - iy;
                     if (iw > 0 && ih > 0) {
                         totalOverlap += (iw * ih);
                     }
                 }
             }
             
             if (!connected) {
                 return -1; // Reject disconnected spawn
             }
             
             // Reject Fully Internal Spawns (Must protrude to be 'on perimeter')
             // Unless it's a Shifter or allowInternal is true
             if (!isShifter && !allowInternal && totalOverlap >= area) {
                 return -1; 
             }
        }

        const id = this.nextBlockId++;
        const b = { x, y, w, h, startFrame: this.animFrame, layer, id, isShifter };
        if (expireFrames > 0) b.expireFrame = this.animFrame + expireFrames;
        this.activeBlocks.push(b);
        
        // Add Op for base class Line Rendering (Interior Lines)
        this.maskOps.push({
            type: 'add',
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            expireFrame: (expireFrames > 0) ? this.animFrame + expireFrames : null,
            layer: layer,
            blockId: id,
            isShifter: isShifter
        });
        
        if (suppressLines) {
            // Write to Grid only (Solid fill)
            this._writeToGrid(x, y, w, h, this.animFrame, layer);
            return id;
        }
        
        // Calculate Line Duration
        const durationSteps = this.c.state.quantizedGenerateV2InnerLineDuration || 1;
        const speed = this.c.state.quantizedGenerateV2Speed || 1;
        const framesPerStep = Math.max(1, 10 / speed);
        const durationFrames = durationSteps * framesPerStep;

        // Add Interior Lines
        const addLine = (lx, ly, face) => {
            this.maskOps.push({ 
                type: 'addLine', 
                x1: lx, y1: ly, x2: lx, y2: ly, 
                face: face, 
                startFrame: this.animFrame,
                expireFrame: this.animFrame + durationFrames, 
                startPhase: this.stepCount,
                layer: layer,
                blockId: id
            });
        };
        
        for(let i=0; i<w; i++) addLine(x+i, y, 'N');
        for(let i=0; i<w; i++) addLine(x+i, y+h-1, 'S');
        for(let i=0; i<h; i++) addLine(x, y+i, 'W');
        for(let i=0; i<h; i++) addLine(x+w-1, y+i, 'E');
        
        // Write to Grid
        this._writeToGrid(x, y, w, h, this.animFrame, layer);
        return id;
    }
    
    _writeToGrid(x, y, w, h, value, layer = 0) {
        if (!this.renderGrid) return;
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const startX = cx + x;
        const startY = cy + y;
        
        const minX = Math.max(0, startX);
        const maxX = Math.min(blocksX - 1, startX + w - 1);
        const minY = Math.max(0, startY);
        const maxY = Math.min(blocksY - 1, startY + h - 1);
        
        for (let gy = minY; gy <= maxY; gy++) {
            for (let gx = minX; gx <= maxX; gx++) {
                const idx = gy * blocksX + gx;
                
                // Write to specific layer
                if (layer === 0 && this.renderGridL1) this.renderGridL1[idx] = value;
                else if (layer === 1 && this.renderGridL2) this.renderGridL2[idx] = value;
                
                // Update Union
                const l1 = this.renderGridL1 ? this.renderGridL1[idx] : -1;
                const l2 = this.renderGridL2 ? this.renderGridL2[idx] : -1;
                this.renderGrid[idx] = (l2 !== -1) ? l2 : l1;
            }
        }
    }
}