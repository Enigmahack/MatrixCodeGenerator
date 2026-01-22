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
    
    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (this.getConfig('PerimeterThickness') !== undefined) ? this.getConfig('PerimeterThickness') : 1.0;
        const lineWidthX = screenStepX * 0.25 * thickness;
        const lineWidthY = screenStepY * 0.25 * thickness;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = this.g.cols * d.cellWidth; 
        const gridPixH = this.g.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 1.0 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
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

        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        const offX = Math.floor((blocksX - Math.ceil(this.g.cols/cellPitchX)) / 2);
        const offY = Math.floor((blocksY - Math.ceil(this.g.rows/cellPitchY)) / 2);
        this.layout.offX = offX;
        this.layout.offY = offY;

        if (!this.maskOps || this.maskOps.length === 0) return;

        const now = this.animFrame;
        const fadeInFrames = this.getConfig('FadeInFrames') || 0;
        const fadeOutFrames = this.getConfig('FadeFrames') || 60;
        const addDuration = Math.max(1, fadeInFrames);

        const distMap = this._computeDistanceField(blocksX, blocksY);
        const outsideMap = this._computeTrueOutside(blocksX, blocksY);
        
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= blocksX || ny < 0 || ny >= blocksY) return true; 
            return outsideMap[ny * blocksX + nx] === 1;
        };

        // --- PASS 1: Base Grid (Interior) ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            ctx.globalAlpha = 1.0; 
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            this._addBlock(start, end, false, null);
        }

        // --- PASS 3: Perimeter (Border) ---
        if (pCtx) {
            pCtx.fillStyle = '#FFFFFF';
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;

            const checkFaceL1 = (bx, by, f) => {
                let nx = bx, ny = by;
                if (f === 'N') ny--; else if (f === 'S') ny++; else if (f === 'W') nx--; else if (f === 'E') nx++;
                return isTrueOutside(nx, ny);
            };
            
            const checkFaceL2 = (bx, by, f) => {
                let nx = bx, ny = by;
                if (f === 'N') ny--; else if (f === 'S') ny++; else if (f === 'W') nx--; else if (f === 'E') nx++;
                return isTrueOutside(nx, ny);
            };

            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    const idx = by * blocksX + bx;
                    const l1 = this.renderGridL1[idx];
                    const l2 = this.renderGridL2[idx];
                    const faces = ['N', 'S', 'W', 'E'];
                    
                    if (l1 !== -1) {
                        for (const f of faces) {
                            if (checkFaceL1(bx, by, f)) {
                                let opacity = 1.0;
                                if (addDuration > 1) opacity = Math.min(1.0, (now - l1) / addDuration);
                                if (opacity > 0.001) {
                                    pCtx.globalAlpha = opacity;
                                    pCtx.beginPath();
                                    this._addPerimeterFacePath(pCtx, bx, by, {dir: f}, boldLineWidthX, boldLineWidthY);
                                    pCtx.fill();
                                }
                            }
                        }
                    } else if (l2 !== -1) {
                        for (const f of faces) {
                            if (checkFaceL2(bx, by, f)) {
                                let opacity = 1.0;
                                if (addDuration > 1) opacity = Math.min(1.0, (now - l2) / addDuration);
                                if (opacity > 0.001) {
                                    pCtx.globalAlpha = opacity;
                                    pCtx.beginPath();
                                    this._addPerimeterFacePath(pCtx, bx, by, {dir: f}, boldLineWidthX, boldLineWidthY);
                                    pCtx.fill();
                                }
                            }
                        }
                    }
                }
            }

            // VOID CLEANUP
            pCtx.globalCompositeOperation = 'destination-out';
            pCtx.fillStyle = '#FFFFFF';
            pCtx.beginPath();
            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    if (isTrueOutside(bx, by)) {
                        const drawBx = bx - offX;
                        const drawBy = by - offY;
                        const x = this.layout.screenOriginX + (drawBx * this.layout.cellPitchX * this.layout.screenStepX);
                        const y = this.layout.screenOriginY + (drawBy * this.layout.cellPitchY * this.layout.screenStepY);
                        const w = this.layout.cellPitchX * this.layout.screenStepX;
                        const h = this.layout.cellPitchY * this.layout.screenStepY;
                        pCtx.rect(x - 0.1, y - 0.1, w + 0.2, h + 0.2); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
        }

        // --- PASS 4: Lines ---
        if (lCtx) {
            const cleanDist = this.c.state.quantizedGenerateV2CleanInnerDistance || 4;
            const durationSteps = (this.c.state.quantizedGenerateV2InnerLineDuration !== undefined) ? this.c.state.quantizedGenerateV2InnerLineDuration : 1;
            lCtx.fillStyle = '#FFFFFF';
            for (const op of this.maskOps) {
                if (op.type !== 'addLine') continue;
                const start = { x: cx + op.x1, y: cy + op.y1 };
                const idx = start.y * blocksX + start.x;
                
                let nx = start.x, ny = start.y;
                const f = op.face.toUpperCase();
                if (f === 'N') ny--;
                else if (f === 'S') ny++;
                else if (f === 'W') nx--;
                else if (f === 'E') nx++;
                
                const isInternal = !isTrueOutside(nx, ny);
                const age = this.stepCount - op.startPhase;

                // 1. Immediate Cleanup for very deep lines
                if (idx >= 0 && idx < distMap.length && distMap[idx] > cleanDist) continue;
                
                // 2. Timed Cleanup for internal lines
                if (isInternal && age > durationSteps) continue;

                let opacity = 1.0;
                if (addDuration > 1) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                if (opacity > 0.001) {
                    lCtx.globalAlpha = opacity;
                    lCtx.beginPath();
                    this._addPerimeterFacePath(lCtx, start.x, start.y, {dir: op.face}, lineWidthX, lineWidthY);
                    lCtx.fill();
                }
            }
        }
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
        // this._attemptCrawlerGrowth();
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
            const layer = (s.step % 2);
            const w = Math.floor(Math.random()*3)+1;
            const h = Math.floor(Math.random()*3)+1;
            const x = Math.floor(Math.random()*9)-4;
            const y = Math.floor(Math.random()*9)-4;
            this._spawnBlock(x, y, w, h, layer);
        }
        s.step++;
    }

    _mergeLayers() {
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