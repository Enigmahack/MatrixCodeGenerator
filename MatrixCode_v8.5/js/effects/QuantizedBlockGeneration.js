class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedGenerateV2"; 
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
        this.alpha = 1.0;
        this.state = 'GENERATING';
        
        this.maskOps = [];
        this.blockMap.clear();
        this.activeBlocks = [];
        this._lastProcessedOpIndex = 0; // Reset base class incremental tracker
        
        this._initLogicGrid();
        // Init Shadow World (Invisible background sim)
        this._initShadowWorldBase(false);
        this._populateShadowWorld(); // Custom dense population
        
        if (this.renderGrid) this.renderGrid.fill(-1);
        
        // Seed
        this._addBlock(0, 0, 2, 2); 
        
        // Notify
        if (this.c.notifications) {
            this.c.notifications.show("Quantized Block Generation Started", "info");
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
    
    _attemptGrowth() {
        if (this.activeBlocks.length === 0) return;
        
        // 1. Pick Source
        const source = this.activeBlocks[Math.floor(Math.random() * this.activeBlocks.length)];
        
        // 2. Pick Direction
        const dirs = [
            { dx: 0, dy: -1, face: 'N' },
            { dx: 0, dy: 1, face: 'S' },
            { dx: -1, dy: 0, face: 'W' },
            { dx: 1, dy: 0, face: 'E' }
        ];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        
        // 3. New Block Size (Random 1x1 to 3x3)
        const w = Math.floor(Math.random() * 3) + 1;
        const h = Math.floor(Math.random() * 3) + 1;
        
        // 4. Calculate Proposed Position
        // Align center or edge? Let's align edge.
        let targetX = source.x; 
        let targetY = source.y;
        
        if (dir.dx !== 0) {
            targetX = (dir.dx > 0) ? (source.x + source.w) : (source.x - w);
            // Randomize Y alignment
            const range = (source.h + h) - 1; // Overlap range
            targetY = source.y + Math.floor(Math.random() * range) - (h - 1);
        } else {
            targetY = (dir.dy > 0) ? (source.y + source.h) : (source.y - h);
            // Randomize X alignment
            const range = (source.w + w) - 1;
            targetX = source.x + Math.floor(Math.random() * range) - (w - 1);
        }
        
        // 5. Check Collision & Shove
        const colliding = this._findCollisions(targetX, targetY, w, h);
        
        if (colliding.length > 0) {
            // SHOVE LOGIC
            // Push colliding blocks in the growth direction
            this._applyShove(colliding, dir.dx, dir.dy);
        }
        
        // 6. Add Block
        this._addBlock(targetX, targetY, w, h);
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
        
        while(stack.length > 0) {
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
    
    _addBlock(x, y, w, h) {
        const b = { x, y, w, h, startFrame: this.animFrame };
        this.activeBlocks.push(b);
        
        // Add Op for base class Line Rendering (Interior Lines)
        // We push 'add' so lines are drawn around it.
        // Base class uses maskOps for Lines.
        this.maskOps.push({
            type: 'add',
            x1: x, y1: y, x2: x + w - 1, y2: y + h - 1,
            startFrame: this.animFrame,
            layer: 0
        });
        
        // Write to Grid (Fill)
        this._writeToGrid(x, y, w, h, this.animFrame);
    }
    
    _writeToGrid(x, y, w, h, value) {
        if (!this.renderGrid) return;
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        // Logic Coords are centered relative to 0,0
        // Grid Coords are absolute 0..blocksX
        
        const startX = cx + x;
        const startY = cy + y;
        
        const minX = Math.max(0, startX);
        const maxX = Math.min(blocksX - 1, startX + w - 1);
        const minY = Math.max(0, startY);
        const maxY = Math.min(blocksY - 1, startY + h - 1);
        
        for (let gy = minY; gy <= maxY; gy++) {
            for (let gx = minX; gx <= maxX; gx++) {
                this.renderGrid[gy * blocksX + gx] = value;
            }
        }
    }
}