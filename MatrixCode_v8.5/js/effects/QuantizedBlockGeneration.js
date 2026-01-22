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
        this._lastProcessedOpIndex = 0; 
        
        this.crawlerState = {
            active: false,
            step: 0,
            x: 0, 
            y: 0,
            dx: 0,
            dy: 0,
            prevBlocks: []
        };

        this._initLogicGrid();
        
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
        this.spineState = {
            N: { len: 0, finished: false },
            S: { len: 0, finished: false },
            E: { len: 0, finished: false },
            W: { len: 0, finished: false }
        };
        
        // Seed (L1)
        this._spawnBlock(0, 0, 1, 1, 0); 
        
        // Notify
        if (this.c.notifications) {
            this.c.notifications.show("Quantized Block Generator Started", "info");
        }
        
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

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;
        this.timer++;
        
        // Shadow Sim Update (Always run to keep code rain moving)
        this._updateShadowSim();

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
    


    _attemptCrawlerGrowth() {
        const s = this.crawlerState;
        
        // Initialization
        if (!s.active) {
            const rangeX = Math.floor(this.logicGridW / 2) - 4;
            const rangeY = Math.floor(this.logicGridH / 2) - 4;
            s.x = Math.floor(Math.random() * (rangeX * 2)) - rangeX;
            s.y = Math.floor(Math.random() * (rangeY * 2)) - rangeY;
            
            const isEast = (s.x > 0);
            const isSouth = (s.y > 0);
            
            if (Math.random() < 0.5) {
                s.dx = isEast ? 1 : -1;
                s.dy = 0;
            } else {
                s.dx = 0;
                s.dy = isSouth ? 1 : -1;
            }
            s.step = 0;
            s.active = true;
        }
        
        const cycle = (s.step % 3);
        let w = 1, h = 1;
        
        // Transition Logic: Clear residue from previous shape in this spot
        if (cycle === 1) { // 1x2 -> 2x1
             // Clear (x, y+1) which was part of 1x2 but not 2x1
             this._writeToGrid(s.x, s.y + 1, 1, 1, -1);
             this.maskOps.push({ type: 'removeBlock', x1: s.x, y1: s.y+1, x2: s.x, y2: s.y+1, startFrame: this.animFrame });
        }
        
        if (cycle === 0) { w = 1; h = 2; }
        else if (cycle === 1) { w = 2; h = 1; }
        else { w = 2; h = 2; }
        
        this._spawnBlock(s.x, s.y, w, h);
        
        s.step++;
        
        if (cycle === 2) {
            s.x += s.dx;
            s.y += s.dy;
        }
    }

    _attemptGrowth() {
        this._attemptLayerOverlap();
        this._attemptSpineGrowth();
        this._attemptCrawlerGrowth();
    }

    _attemptSpineGrowth() {
        if (!this.spineState) return;
        
        // Slower update for spine (every 3rd growth step)
        if (this.stepCount % 3 !== 0) return;
        
        const s = this.spineState;
        const arms = ['N', 'S', 'E', 'W'];
        
        // Pick an arm that isn't finished
        const candidates = arms.filter(a => !s[a].finished);
        if (candidates.length === 0) return;
        
        const arm = candidates[Math.floor(Math.random() * candidates.length)];
        const data = s[arm];
        
        // Determine position
        let tx = 0, ty = 0;
        let w = 0, h = 0;
        
        // Growth parameters
        const isVert = (arm === 'N' || arm === 'S');
        const breadth = Math.random() < 0.3 ? 2 : 1; // Occasional thickness
        const length = Math.floor(Math.random() * 3) + 2; // 2 to 4 length
        
        if (arm === 'N') {
            tx = -Math.floor(breadth/2);
            ty = -(data.len + length);
            w = breadth; h = length;
        } else if (arm === 'S') {
            tx = -Math.floor(breadth/2);
            ty = data.len + 1;
            w = breadth; h = length;
        } else if (arm === 'E') {
            tx = data.len + 1;
            ty = -Math.floor(breadth/2);
            w = length; h = breadth;
        } else if (arm === 'W') {
            tx = -(data.len + length);
            ty = -Math.floor(breadth/2);
            w = length; h = breadth;
        }
        
        // Boundary Check (Logic Grid limits)
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        if (cx + tx < 2 || cx + tx + w > blocksX - 2 || 
            cy + ty < 2 || cy + ty + h > blocksY - 2) {
            data.finished = true; // Hit edge
            return;
        }
        
        // Spawn
        this._spawnBlock(tx, ty, w, h, 0); // Layer 0 for spine
        
        // Update State
        data.len += length;
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
            this._mergeLayers();
            // Dynamic Cloud Growth
            // Pick a random existing block to grow from? 
            // For now, random scatter near center
            const range = Math.min(10, 4 + Math.floor(s.step / 5));
            const layer = (s.step % 2);
            
            // Bias towards center for cloud effect
            const r = Math.random();
            let dist = (r * r) * range; // Quadratic bias to center
            const angle = Math.random() * Math.PI * 2;
            
            const x = Math.floor(Math.cos(angle) * dist);
            const y = Math.floor(Math.sin(angle) * dist);
            
            const w = Math.floor(Math.random() * 3) + 1;
            const h = Math.floor(Math.random() * 3) + 1;
            
            this._spawnBlock(x, y, w, h, layer);
        }
        s.step++;
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
        
        // 2. Update coords
        b.x = newX;
        b.y = newY;
        
        // 3. Write new grid pixels
        // Use b.startFrame to preserve age (color/fade)
        this._writeToGrid(b.x, b.y, b.w, b.h, b.startFrame);
        
        // Note: we are NOT adding a 'move' op to maskOps. 
        // We manipulate the renderGrid directly. 
        // Base class renders from renderGrid.
    }
    
    _spawnBlock(x, y, w, h, layer = 0) {
        const b = { x, y, w, h, startFrame: this.animFrame, layer };
        this.activeBlocks.push(b);
        
        // Add Op for base class Line Rendering (Interior Lines)
        this.maskOps.push({
            type: 'add',
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            layer: layer
        });
        
        // Add Interior Lines
        const addLine = (lx, ly, face) => {
            this.maskOps.push({ 
                type: 'addLine', 
                x1: lx, y1: ly, x2: lx, y2: ly, 
                face: face, 
                startFrame: this.animFrame,
                startPhase: this.stepCount,
                layer: layer 
            });
        };
        
        for(let i=0; i<w; i++) addLine(x+i, y, 'N');
        for(let i=0; i<w; i++) addLine(x+i, y+h-1, 'S');
        for(let i=0; i<h; i++) addLine(x, y+i, 'W');
        for(let i=0; i<h; i++) addLine(x+w-1, y+i, 'E');
        
        // Write to Grid
        this._writeToGrid(x, y, w, h, this.animFrame, layer);
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
                this.renderGrid[idx] = (l1 !== -1) ? l1 : l2;
            }
        }
    }
}