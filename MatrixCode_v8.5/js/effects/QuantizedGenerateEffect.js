class QuantizedGenerateEffect extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedGenerate";
        this.active = false;
        
        this.configPrefix = "quantizedGenerate";

        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation Sequence Data
        this.sequence = [[]]; 
        
        this.expansionPhase = 0;
        this.maskOps = [];
        this.editorHighlight = false;
        
        // Flicker Fix: Swap Transition State
        this.isSwapping = false;
        this.swapTimer = 0;
        
        this._renderGridDirty = true;
        
        // Logic Grid Scaling
        this.logicScale = 1.2;
    }

    trigger(force = false) {
        // 1. Strict Active Check: Do not allow restart if already running.
        if (this.active) return false;

        // 2. Mutually Exclusive Lock: Do not start if ANY other Quantized effect is running.
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    // console.log(`[QuantizedGenerate] Trigger ignored: ${name} is active.`);
                    return false;
                }
            }
        }

        if (!super.trigger(force)) return false;
        
        // Use the generator to create a fresh sequence
        if (typeof QuantizedSequenceGenerator !== 'undefined') {
            const generator = new QuantizedSequenceGenerator();
            // logicGridW and logicGridH are now 120% of screen size due to overridden _initLogicGrid
            const erosionRate = (this.c.state.quantizedGenerateErosionRate !== undefined) ? this.c.state.quantizedGenerateErosionRate : 0.2;
            const innerLineDuration = (this.c.state.quantizedGenerateInnerLineDuration !== undefined) ? this.c.state.quantizedGenerateInnerLineDuration : 1;
            this.sequence = generator.generate(this.logicGridW, this.logicGridH, 1000, { erosionRate, innerLineDuration });
        }

        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.offsetX = 0.5; 
        this.offsetY = 0.5;

        this._initShadowWorld();
        this.hasSwapped = false;
        this.isSwapping = false;
        this._renderGridDirty = true;

        // Ensure renderGrid is initialized
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }



    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        this.animFrame++;

        // 1. Animation Cycle (Grid Expansion) - Logic Update
        // Speed setting represents frames per step (Consistent Timer)
        const effectiveInterval = Math.max(1, (s.quantizedGenerateSpeed !== undefined) ? s.quantizedGenerateSpeed : 10);

        this.cycleTimer++;

        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        // Optimization: Update Render Grid Logic only when necessary
        if (this._renderGridDirty) {
            this._updateRenderGridLogic();
            this._renderGridDirty = false;
        }

        // 2. Update Shadow Simulation & Apply Overrides
        if (!this.hasSwapped && !this.isSwapping) {
            this._updateShadowSim();
        } else if (this.isSwapping) {
            super.updateTransition(false);
        }

        // 3. Lifecycle State Machine
        const fadeInFrames = Math.max(1, s.quantizedGenerateFadeInFrames || 0);
        const fadeOutFrames = Math.max(1, s.quantizedGenerateFadeFrames || 0);
        const durationFrames = (s.quantizedGenerateDurationSeconds || 0) * fps;
        
        const setAlpha = (val) => { this.alpha = Math.max(0, Math.min(1, val)); };

        if (this.state === 'FADE_IN') {
            this.timer++;
            setAlpha(this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.timer = 0;
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++;
            const sequenceComplete = (this.expansionPhase >= this.sequence.length);
            
            if (!this.debugMode && (sequenceComplete || this.timer >= durationFrames * 2)) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            // If swapping, we handle termination in swap logic.
            // If just fading out (e.g. cancelled), handle standard fade.
            if (!this.isSwapping) {
                this.timer++;
                setAlpha(1.0 - (this.timer / fadeOutFrames));
                if (this.timer >= fadeOutFrames) {
                    this.active = false;
                    this.state = 'IDLE';
                    this.alpha = 0.0;
                    window.removeEventListener('keydown', this._boundDebugHandler);
                    this.g.clearAllOverrides();
                    this.shadowGrid = null;
                    this.shadowSim = null;
                }
            }
        }

        // 4. Animation Transition Management (Dirtiness)
        this._checkDirtiness();
    }

    _processAnimationStep() {
        if (this.expansionPhase < this.sequence.length) {
            const step = this.sequence[this.expansionPhase];
            if (step) this._executeStepOps(step);
            this.expansionPhase++;
            this._maskDirty = true;
            this._renderGridDirty = true;
        }
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }

    _updateMask(w, h, s, d) {
        const ctx = this.maskCtx;
        const pCtx = this.perimeterMaskCtx;
        const lCtx = this.lineMaskCtx;
        const grid = this.g;
        
        ctx.clearRect(0, 0, w, h);
        if (pCtx) pCtx.clearRect(0, 0, w, h);
        if (lCtx) lCtx.clearRect(0, 0, w, h);
        
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const thickness = (s.quantizedGeneratePerimeterThickness !== undefined) ? s.quantizedGeneratePerimeterThickness : 1.0;
        const lineWidthX = screenStepX * 0.25 * thickness;
        const lineWidthY = screenStepY * 0.25 * thickness;
        const halfLineX = lineWidthX / 2;
        const halfLineY = lineWidthY / 2;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (w * 0.5);
        const screenOriginY = ((s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (h * 0.5);
        
        const bs = this.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        // User Perimeter Offsets (Pixel Nudge)
        const userPerimeterOffsetX = s.quantizedPerimeterOffsetX || 0;
        const userPerimeterOffsetY = s.quantizedPerimeterOffsetY || 0;

        // User Shadow Offsets (Grid Snap)
        const userShadowOffsetX = s.quantizedShadowOffsetX || 0;
        const userShadowOffsetY = s.quantizedShadowOffsetY || 0;

        // Calculate Block Offsets for Snapping
        const userBlockOffX = userShadowOffsetX / (d.cellWidth * cellPitchX);
        const userBlockOffY = userShadowOffsetY / (d.cellHeight * cellPitchY);

        this.layout = {
            screenStepX, screenStepY,
            lineWidthX, lineWidthY,
            halfLineX, halfLineY,
            screenOriginX, screenOriginY,
            gridPixW, gridPixH,
            cellPitchX, cellPitchY,
            userBlockOffX, userBlockOffY,
            pixelOffX: userPerimeterOffsetX,
            pixelOffY: userPerimeterOffsetY
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

        // --- SCALED GRID LOGIC ---
        const scaledW = this.logicGridW || blocksX;
        const scaledH = this.logicGridH || blocksY;
        
        // Use centered offset logic (Float)
        const { offX, offY } = this._computeCenteredOffset(scaledW, scaledH, cellPitchX, cellPitchY);
        this.layout.offX = offX;
        this.layout.offY = offY;

        // Compute maps on the SCALED grid
        const distMap = this._computeDistanceField(scaledW, scaledH);
        const outsideMap = this._computeTrueOutside(scaledW, scaledH);
        
        const isTrueOutside = (nx, ny) => {
            if (nx < 0 || nx >= scaledW || ny < 0 || ny >= scaledH) return false; 
            const idx = ny * scaledW + nx;
            return outsideMap[idx] === 1;
        };
        
        const isRenderActive = (bx, by) => {
            if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
            const idx = by * scaledW + bx;
            if (!this.renderGrid || idx < 0 || idx >= this.renderGrid.length || this.renderGrid[idx] === -1) return false;
            return true;
        };
        
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             if (bx < 0 || bx >= scaledW || by < 0 || by >= scaledH) return false;
             const idx = by * scaledW + bx;
             if (!this.renderGrid) return false;
             const activeStart = this.renderGrid[idx];
             if (activeStart !== -1 && activeStart > time) return true;
             return false;
        };


        // --- PASS 1: Base Grid (Interior) ---
        // Draws Solid Blocks to ctx (maskCanvas) for Black Fill
        // Force Opacity 1.0 to ensure "falling code" is fully revealed immediately, per user request.
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;
            ctx.globalAlpha = 1.0;
            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            // Increased inflate to +1.0 to ensure solid overlap without gaps
            this._addBlock(start, end, op.ext, isRenderActive); 
        }

        // --- PASS 3: Perimeter (Border) ---
        if (pCtx) {
            const originalCtx = this.maskCtx;
            this.maskCtx = pCtx; 
            
            const boldLineWidthX = lineWidthX * 2.0; 
            const boldLineWidthY = lineWidthY * 2.0;
            const color = this.getConfig('PerimeterColor') || "#FFD700";
            const fadeOutFrames = this.getConfig('FadeFrames') || 60;
            
            pCtx.fillStyle = '#FFFFFF';

            // Pre-calculate Removed Edges for Perimeter
            const removedEdges = new Set();
            if (this.maskOps) {
                for (const op of this.maskOps) {
                    if (op.type === 'removeLine') {
                        const start = { x: cx + op.x1, y: cy + op.y1 };
                        const end = { x: cx + op.x2, y: cy + op.y2 };
                        const minX = Math.min(start.x, end.x);
                        const maxX = Math.max(start.x, end.x);
                        const minY = Math.min(start.y, end.y);
                        const maxY = Math.max(start.y, end.y);
                        
                        const faces = op.face ? [op.face.toUpperCase()] : ['N', 'S', 'E', 'W'];
                        
                        for (let by = minY; by <= maxY; by++) {
                            for (let bx = minX; bx <= maxX; bx++) {
                                const idx = by * scaledW + bx;
                                for (const f of faces) {
                                    removedEdges.add(`${idx}_${f}`);
                                }
                            }
                        }
                    }
                }
            }

            // PART A: Standard Rendering + Internalizing Fade Out & PART B: Vanishing Fade Out
            // REPLACED with Base Class _renderEdges to ensure grid-based shared edge rendering
            this._renderEdges(pCtx, null, now, scaledW, scaledH, offX, offY);

            // --- PASS 3.5: VOID CLEANUP ---
            pCtx.globalCompositeOperation = 'destination-out';
            pCtx.fillStyle = '#FFFFFF';
            pCtx.beginPath();
            
            const l = this.layout;

            for (let by = 0; by < blocksY; by++) {
                for (let bx = 0; bx < blocksX; bx++) {
                    // Logic Index is directly bx, by (since we iterate logic grid dimensions)
                    if (isTrueOutside(bx, by)) {
                        // FIX: Apply offX/offY subtraction to align with visual grid center
                        const cellX = Math.round((bx - offX) * l.cellPitchX);
                        const cellY = Math.round((by - offY) * l.cellPitchY);
                        
                        const x = l.screenOriginX + (cellX * l.screenStepX);
                        const y = l.screenOriginY + (cellY * l.screenStepY);
                        const w = l.cellPitchX * l.screenStepX;
                        const h = l.cellPitchY * l.screenStepY;
                        pCtx.rect(x, y, w, h); 
                    }
                }
            }
            pCtx.fill();
            pCtx.globalCompositeOperation = 'source-over';
            
            this.maskCtx = originalCtx; 
        }

        // --- PASS 4: Add Lines (Interior) - Draws to lCtx (Blue) ---
        if (lCtx) {
            try {
                // Restore animation-based line adding logic
                const activeLines = new Map();
                const cleanDist = (s.quantizedGenerateCleanInnerDistance !== undefined) ? s.quantizedGenerateCleanInnerDistance : 4;
                const durationSteps = (s.quantizedGenerateInnerLineDuration !== undefined) ? s.quantizedGenerateInnerLineDuration : 1;

                // 1. Collect Lines from Animation Ops (Process strictly in order)
                for (const op of this.maskOps) {
                    const start = { x: cx + op.x1, y: cy + op.y1 };
                    const end = { x: cx + op.x2, y: cy + op.y2 };
                    const minX = Math.min(start.x, end.x);
                    const maxX = Math.max(start.x, end.x);
                    const minY = Math.min(start.y, end.y);
                    const maxY = Math.max(start.y, end.y);

                    if (op.type === 'addLine') {
                        for (let by = minY; by <= maxY; by++) {
                            for (let bx = minX; bx <= maxX; bx++) {
                                // Distance Check (Scaled)
                                const distIdx = (by + offY) * scaledW + (bx + offX);
                                if (distIdx >= 0 && distIdx < distMap.length && distMap[distIdx] > cleanDist) continue;

                                const idx = by * blocksX + bx;
                                let nx = bx, ny = by;
                                const f = op.face ? op.face.toUpperCase() : '';
                                if (f === 'N') ny--;
                                else if (f === 'S') ny++;
                                else if (f === 'W') nx--;
                                else if (f === 'E') nx++;
                                
                                // REMOVED: isTrueOutside check. 
                                // We WANT to draw on the perimeter so the line acts as a "remnant" underneath.
                                // if (isTrueOutside(nx, ny)) continue; 

                                let cell = activeLines.get(idx);
                                if (!cell) { cell = {}; activeLines.set(idx, cell); }
                                cell[f] = op;
                            }
                        }
                    } else if (op.type === 'removeLine') {
                        for (let by = minY; by <= maxY; by++) {
                            for (let bx = minX; bx <= maxX; bx++) {
                                const idx = by * blocksX + bx;
                                const f = op.face ? op.face.toUpperCase() : '';
                                const cell = activeLines.get(idx);
                                if (cell) {
                                    delete cell[f];
                                    if (Object.keys(cell).length === 0) activeLines.delete(idx);
                                }
                            }
                        }
                    } else if (op.type === 'removeBlock' || op.type === 'remove') {
                        for (let by = minY; by <= maxY; by++) {
                            for (let bx = minX; bx <= maxX; bx++) {
                                const idx = by * blocksX + bx;
                                activeLines.delete(idx);
                            }
                        }
                    }
                }

                // 1b. Connectivity Filter (Tier 0/1 Logic)
                // ----------------------------------------------------------------
                // Data Structures for Segments
                const hSegs = new Map(); // y -> [{x1, x2, id, tier}]
                const vSegs = new Map(); // x -> [{y1, y2, id, tier}]
                const lineToSeg = new Map(); // "idx_face" -> segmentObj

                const getSegList = (map, key) => {
                    let list = map.get(key);
                    if (!list) { list = []; map.set(key, list); }
                    return list;
                };

                // Step A: Parse Raw Lines into Unit Segments
                for (const [idx, cell] of activeLines) {
                    const bx = idx % blocksX;
                    const by = Math.floor(idx / blocksX);
                    
                    // N: H at y, x..x+1
                    if (cell['N']) {
                        const list = getSegList(hSegs, by);
                        const seg = { x1: bx, x2: bx + 1, id: `H_${by}_${bx}`, tier: -1, type: 'H', key: by };
                        list.push(seg);
                        lineToSeg.set(`${idx}_N`, seg);
                    }
                    // S: H at y+1, x..x+1
                    if (cell['S']) {
                        const list = getSegList(hSegs, by + 1);
                        const seg = { x1: bx, x2: bx + 1, id: `H_${by+1}_${bx}`, tier: -1, type: 'H', key: by + 1 };
                        list.push(seg);
                        lineToSeg.set(`${idx}_S`, seg);
                    }
                    // W: V at x, y..y+1
                    if (cell['W']) {
                        const list = getSegList(vSegs, bx);
                        const seg = { y1: by, y2: by + 1, id: `V_${bx}_${by}`, tier: -1, type: 'V', key: bx };
                        list.push(seg);
                        lineToSeg.set(`${idx}_W`, seg);
                    }
                    // E: V at x+1, y..y+1
                    if (cell['E']) {
                        const list = getSegList(vSegs, bx + 1);
                        const seg = { y1: by, y2: by + 1, id: `V_${bx+1}_${by}`, tier: -1, type: 'V', key: bx + 1 };
                        list.push(seg);
                        lineToSeg.set(`${idx}_E`, seg);
                    }
                }

                // Step B: Merge Contiguous Segments
                const allSegments = [];
                
                const mergeList = (list, isH) => {
                    if (list.length === 0) return;
                    // Sort by coordinate (x1 for H, y1 for V)
                    list.sort((a, b) => isH ? (a.x1 - b.x1) : (a.y1 - b.y1));
                    
                    const merged = [];
                    let curr = list[0];
                    
                    // Remap initial lookup to the merged master
                    const constituentKeys = [curr]; 

                    for (let i = 1; i < list.length; i++) {
                        const next = list[i];
                        // Check continuity: next.start == curr.end
                        const isContiguous = isH ? (next.x1 === curr.x2) : (next.y1 === curr.y2);
                        
                        if (isContiguous) {
                            // Merge
                            if (isH) curr.x2 = next.x2;
                            else curr.y2 = next.y2;
                            constituentKeys.push(next);
                        } else {
                            // Finalize current
                            merged.push(curr);
                            allSegments.push(curr);
                            curr.constituents = constituentKeys.slice();
                            
                            // Start new
                            curr = next;
                            constituentKeys.length = 0;
                            constituentKeys.push(curr);
                        }
                    }
                    merged.push(curr);
                    allSegments.push(curr);
                    curr.constituents = constituentKeys.slice();
                    
                    return merged;
                };

                for (const [y, list] of hSegs) hSegs.set(y, mergeList(list, true));
                for (const [x, list] of vSegs) vSegs.set(x, mergeList(list, false));

                // Remap lookups to merged objects
                for (const seg of allSegments) {
                    if (seg.constituents) {
                        for (const part of seg.constituents) {
                            part.master = seg; // Link part to master
                        }
                    }
                }
                
                // Helper to get master segment
                const getMaster = (seg) => seg.master || seg;

                // Step C: Mark Tier 0 (Perimeter Touching)
                for (const seg of allSegments) {
                    let isTier0 = false;
                    if (seg.type === 'H') {
                        const y = seg.key; // Vertex Y. Cell Y is y (below) or y-1 (above).
                        for (let x = seg.x1; x < seg.x2; x++) {
                            // Check cells (x, y-1) and (x, y)
                            const outAbove = isTrueOutside(x, y - 1);
                            const outBelow = isTrueOutside(x, y);
                            // If one is out and one is in, it's a border.
                            if (outAbove !== outBelow) { isTier0 = true; break; }
                        }
                    } else { // V
                        const x = seg.key; // Vertex X.
                        for (let y = seg.y1; y < seg.y2; y++) {
                            // Check cells (x-1, y) and (x, y)
                            const outLeft = isTrueOutside(x - 1, y);
                            const outRight = isTrueOutside(x, y);
                            if (outLeft !== outRight) { isTier0 = true; break; }
                        }
                    }
                    if (isTier0) seg.tier = 0;
                }

                // Step D: Propagate Tier 1 (Connectivity)
                const tier0Segs = allSegments.filter(s => s.tier === 0);
                
                for (const t0 of tier0Segs) {
                    // Find all intersecting/touching segments
                    if (t0.type === 'H') {
                        for (let x = t0.x1; x <= t0.x2; x++) { // Include endpoints
                            const vList = vSegs.get(x);
                            if (vList) {
                                for (const vSeg of vList) {
                                    if (vSeg.tier === -1) {
                                        // Check overlap
                                        if (t0.key >= vSeg.y1 && t0.key <= vSeg.y2) {
                                            vSeg.tier = 1;
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // t0 is V. Check against all H segments.
                        for (let y = t0.y1; y <= t0.y2; y++) {
                            const hList = hSegs.get(y);
                            if (hList) {
                                for (const hSeg of hList) {
                                    if (hSeg.tier === -1) {
                                        if (t0.key >= hSeg.x1 && t0.key <= hSeg.x2) {
                                            hSeg.tier = 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Step E: Filter ActiveLines
                const keysToRemove = [];
                for (const [idx, cell] of activeLines) {
                    const faces = Object.keys(cell);
                    let hasValidFace = false;
                    
                    for (const f of faces) {
                        const rawSeg = lineToSeg.get(`${idx}_${f}`);
                        if (!rawSeg) continue;
                        const master = getMaster(rawSeg);
                        
                        if (master.tier === 0 || master.tier === 1) {
                            hasValidFace = true;
                        } else {
                            // Remove invalid face
                            delete cell[f];
                        }
                    }
                    
                    if (Object.keys(cell).length === 0) {
                        keysToRemove.push(idx);
                    }
                }
                for (const k of keysToRemove) activeLines.delete(k);

                // 2. Draw Collected Lines
                const originalCtx = this.maskCtx;
                this.maskCtx = lCtx;
                lCtx.fillStyle = '#FFFFFF';

                for (const [idx, cell] of activeLines) {
                    const bx = idx % blocksX;
                    const by = Math.floor(idx / blocksX);
                    
                    const gridCx = blocksX / 2;
                    const gridCy = blocksY / 2;
                    
                    const drawLine = (face, rS, rE) => {
                        const op = cell[face];
                        if (!op) return;
                        
                        // Determine if face is facing the center
                        let isFacingCenter = false;
                        if (face === 'N') isFacingCenter = (by > gridCy);
                        else if (face === 'S') isFacingCenter = (by < gridCy);
                        else if (face === 'W') isFacingCenter = (bx > gridCx);
                        else if (face === 'E') isFacingCenter = (bx < gridCx);
                        
                        // LIFETIME CHECK: Configurable Limit
                        // Ensure no internal lines persist longer than config duration.
                        if (op.startPhase !== undefined) {
                            const age = this.expansionPhase - op.startPhase;
                            if (age > durationSteps) return;
                        }
                        
                        let opacity = 1.0;
                        if (fadeInFrames === 0 || this.debugMode) opacity = 1.0;
                        else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
                        
                        if (opacity <= 0.001) return;

                        lCtx.globalAlpha = opacity;
                        lCtx.beginPath();
                        // Reuse the Perimeter Logic which handles Inner Stroke & Retraction
                        this._addPerimeterFacePath(bx, by, {dir: face, rS, rE}, lineWidthX, lineWidthY);
                        lCtx.fill();
                    };

                    const hasN_Border = isTrueOutside(bx, by - 1);
                    const hasS_Border = isTrueOutside(bx, by + 1);
                    const hasN = !!cell['N'] || hasN_Border;
                    const hasS = !!cell['S'] || hasS_Border;

                    drawLine('N', false, false);
                    drawLine('S', false, false);
                    drawLine('W', hasN, hasS);
                    drawLine('E', hasN, hasS);
                }
                this.maskCtx = originalCtx;
            } catch(e) {
                console.error("[QuantizedGenerate] Line Pass Failed:", e);
            }
        }
    }

    _addBlock(blockStart, blockEnd, isExtending, visibilityCheck) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const offX = l.offX || 0;
        const offY = l.offY || 0;
        const startX = Math.round((blockStart.x - offX + l.userBlockOffX) * l.cellPitchX);
        const endX = Math.round((blockEnd.x + 1 - offX + l.userBlockOffX) * l.cellPitchX);
        const startY = Math.round((blockStart.y - offY + l.userBlockOffY) * l.cellPitchY);
        const endY = Math.round((blockEnd.y + 1 - offY + l.userBlockOffY) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        if (visibilityCheck) {
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;
            
            for (let by = rangeMinBy; by <= rangeMaxBy; by++) {
                for (let bx = rangeMinBx; bx <= rangeMaxBx; bx++) {
                    if (!visibilityCheck(bx, by)) continue;
                    
                    const cellX = Math.round((bx - offX) * l.cellPitchX);
                    const cellY = Math.round((by - offY) * l.cellPitchY);
                    const xPos = l.screenOriginX + (cellX * l.screenStepX);
                    const yPos = l.screenOriginY + (cellY * l.screenStepY);
                    
                    const w = l.screenStepX * l.cellPitchX;
                    const h = l.screenStepY * l.cellPitchY;
                    
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
                    ctx.rect(xPos - l.halfLineX, yPos - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
                }
            }
        } else {
            if (isExtending) {
                let cy = l.screenOriginY + (startY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                cy = l.screenOriginY + (endY * l.screenStepY);
                ctx.rect(l.screenOriginX + (startX * l.screenStepX) - l.halfLineX, cy - l.halfLineY, (endX - startX) * l.screenStepX + l.lineWidthX, l.lineWidthY);
                let cx = l.screenOriginX + (startX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
                cx = l.screenOriginX + (endX * l.screenStepX);
                ctx.rect(cx - l.halfLineX, l.screenOriginY + (startY * l.screenStepY) - l.halfLineY, l.lineWidthX, (endY - startY) * l.screenStepY + l.lineWidthY);
            } else {
                // FIXED: Draw SOLID rectangle for filled blocks (Pass 1 - Interior)
                const rangeMinBx = blockStart.x;
                const rangeMaxBx = blockEnd.x;
                const rangeMinBy = blockStart.y;
                const rangeMaxBy = blockEnd.y;
                
                // Calculate total bounds for the block(s)
                const sCellX = Math.floor(rangeMinBx * l.cellPitchX);
                const sCellY = Math.floor(rangeMinBy * l.cellPitchY);
                const eCellX = Math.floor((rangeMaxBx + 1) * l.cellPitchX);
                const eCellY = Math.floor((rangeMaxBy + 1) * l.cellPitchY);
                
                const xPos = l.screenOriginX + (sCellX * l.screenStepX);
                const yPos = l.screenOriginY + (sCellY * l.screenStepY);
                const w = (eCellX - sCellX) * l.screenStepX;
                const h = (eCellY - sCellY) * l.screenStepY;
                
                // Draw single solid rect covering everything (with slight inflate for overlap)
                // Use 1.0 inflate to guarantee no gaps
                ctx.rect(xPos - 0.5, yPos - 0.5, w + 1.0, h + 1.0);
            }
        }
        ctx.fill();
    }

    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();
        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();

        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                if (!force) {
                    if (f === 'N' && by === minY) continue;
                    if (f === 'S' && by === maxY) continue;
                    if (f === 'W' && bx === minX) continue;
                    if (f === 'E' && bx === maxX) continue;
                }
                const startCellX = Math.round((bx - offX + l.userBlockOffX) * l.cellPitchX);
                const startCellY = Math.round((by - offY + l.userBlockOffY) * l.cellPitchY);
                const endCellX = Math.round((bx + 1 - offX + l.userBlockOffX) * l.cellPitchX);
                const endCellY = Math.round((by + 1 - offY + l.userBlockOffY) * l.cellPitchY);
                const safety = 0.5;
                const safeX = l.halfLineX + safety; 
                const safeY = l.halfLineY + safety; 
                const inflate = 0.5; 

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                } else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                } else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                }
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    _swapStates() {
        if (this.hasSwapped || this.isSwapping) return;
        
        const result = this._commitShadowState();
        
        if (result === 'ASYNC') {
            this.isSwapping = true;
            this.swapTimer = 5; 
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
            this.hasSwapped = true;
            // Do not set active = false here; let FADE_OUT handle it.
        } else {
            // Failed
            this.g.clearAllOverrides();
            this.active = false;
        }
    }

    _ensureCanvases(w, h) {
        if (!this.maskCanvas) {
            this.maskCanvas = document.createElement('canvas');
            this.maskCtx = this.maskCanvas.getContext('2d');
            this._maskDirty = true;
        }
        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCtx = this.scratchCanvas.getContext('2d');
        }
        if (!this.gridCacheCanvas) {
            this.gridCacheCanvas = document.createElement('canvas');
            this.gridCacheCtx = this.gridCacheCanvas.getContext('2d');
        }
        if (!this.perimeterMaskCanvas) {
            this.perimeterMaskCanvas = document.createElement('canvas');
            this.perimeterMaskCtx = this.perimeterMaskCanvas.getContext('2d');
        }
        if (!this.lineMaskCanvas) {
            this.lineMaskCanvas = document.createElement('canvas');
            this.lineMaskCtx = this.lineMaskCanvas.getContext('2d');
        }

        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
            this.maskCanvas.width = w;
            this.maskCanvas.height = h;
            this._maskDirty = true;
        }
        if (this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
            this.scratchCanvas.width = w;
            this.scratchCanvas.height = h;
        }
        if (this.gridCacheCanvas.width !== w || this.gridCacheCanvas.height !== h) {
            this.gridCacheCanvas.width = w;
            this.gridCacheCanvas.height = h;
            this.lastGridSeed = -1; 
        }
        if (this.perimeterMaskCanvas.width !== w || this.perimeterMaskCanvas.height !== h) {
            this.perimeterMaskCanvas.width = w;
            this.perimeterMaskCanvas.height = h;
        }
        if (this.lineMaskCanvas.width !== w || this.lineMaskCanvas.height !== h) {
            this.lineMaskCanvas.width = w;
            this.lineMaskCanvas.height = h;
        }
        
        // RenderGrid Sizing (SCALED)
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        
        if (blocksX && blocksY) {
            const requiredSize = blocksX * blocksY;
            if (!this.renderGrid || this.renderGrid.length !== requiredSize) {
                 this.renderGrid = new Int32Array(requiredSize);
                 this.renderGrid.fill(-1);
                 this._renderGridDirty = true;
            }
        }
    }




}