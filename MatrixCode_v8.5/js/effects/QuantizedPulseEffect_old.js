class QuantizedPulseEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedPulse";
        this.active = false;
        
        // Configuration defaults are handled in ConfigurationManager, 
        // but we init our internal state here.
        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.gridPitchChars = 4;
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation State
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this.animFrame = 0;
        
        // Debug
        this.debugMode = true; 
        this.manualStep = false;
        this._boundDebugHandler = this._handleDebugInput.bind(this);
    }

    trigger() {
        if (this.active) return false;
        
        const s = this.c.state;
        if (!s.quantizedPulseEnabled) return false;

        this.active = true;
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        
        // Reset Animation State
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.expansionPhase = 0;
        this.maskOps = [];
        this.animFrame = 0;
        this._maskDirty = true;
        
        // Offset slightly (1/2 cell to overlap characters effectively)
        this.offsetX = 0.5; // Fraction of cell width
        this.offsetY = 0.5; // Fraction of cell height

        if (this.debugMode) {
            window.addEventListener('keydown', this._boundDebugHandler);
        }

        return true;
    }
    
    _handleDebugInput(e) {
        if (e.key === '.') {
            this.manualStep = true;
        } else if (e.key === 'Escape') {
            this.active = false;
            this.state = 'IDLE';
            this.alpha = 0.0;
            window.removeEventListener('keydown', this._boundDebugHandler);
        }
    }

    update() {
        const s = this.c.state;
        const fps = 60;

        if (!this.active) return;

        this.animFrame++;

        // 1. Lifecycle State Machine (Alpha Fading)
        const fadeInFrames = Math.max(1, s.quantizedPulseFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedPulseFadeFrames);
        const durationFrames = s.quantizedPulseDurationSeconds * fps;
        
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
            // Infinite duration in debug mode
            if (!this.debugMode && this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
            }
        } else if (this.state === 'FADE_OUT') {
            this.timer++;
            setAlpha(1.0 - (this.timer / fadeOutFrames));
            if (this.timer >= fadeOutFrames) {
                this.active = false;
                this.state = 'IDLE';
                this.alpha = 0.0;
                window.removeEventListener('keydown', this._boundDebugHandler);
            }
        }

        // 2. Animation Cycle (Grid Expansion)
        const cycleDuration = Math.max(1, this.c.derived.cycleDuration);
        this.cycleTimer++;

        if (this.cycleTimer >= cycleDuration) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            const delayCycles = Math.max(1, s.quantizedPulseSpeed || 1);
            if (this.cyclesCompleted >= delayCycles) {
                this.cyclesCompleted = 0;
                
                // Debug stepping gate
                if (!this.debugMode || this.manualStep) {
                    this._processAnimationStep();
                    this.manualStep = false;
                }
            }
        }

        // 3. Animation Transition Management
        // Use config values for internal transitions
        const addDuration = Math.max(1, s.quantizedPulseFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedPulseFadeFrames || 0);

        if (this.maskOps) {
            for (const op of this.maskOps) {
                const age = this.animFrame - op.startFrame;
                const duration = (op.type === 'remove') ? removeDuration : addDuration;
                
                if (age < duration) {
                    this._maskDirty = true;
                    break;
                }
            }
        }
    }

    _processAnimationStep() {
        // Animation Sequence
        const p = this.expansionPhase;
        const now = this.animFrame;

        // --- Build State Snapshot ---
        const s = this.c.state;
        const grid = this.g;
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);

        const activeMap = new Set();
        // Replay history to determine current state
        for (const op of this.maskOps) {
            if (op.startFrame > now) continue;

            if (op.type === 'add' || op.type === 'addSmart') {
                const minX = Math.min(cx + op.x1, cx + op.x2);
                const maxX = Math.max(cx + op.x1, cx + op.x2);
                const minY = Math.min(cy + op.y1, cy + op.y2);
                const maxY = Math.max(cy + op.y1, cy + op.y2);
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        activeMap.add(`${x},${y}`);
                    }
                }
            } else if (op.type === 'removeBlock') {
                if (op.startFrame && now < op.startFrame) continue; 
                const minX = Math.min(cx + op.x1, cx + op.x2);
                const maxX = Math.max(cx + op.x1, cx + op.x2);
                const minY = Math.min(cy + op.y1, cy + op.y2);
                const maxY = Math.max(cy + op.y1, cy + op.y2);
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        activeMap.delete(`${x},${y}`);
                    }
                }
            }
        }

        // Helper to push relative ops with timestamp
        const add = (dx, dy) => {
            const bx = cx + dx;
            const by = cy + dy;
            if (activeMap.has(`${bx},${by}`)) {
                // If already full/active, ensure lines are added (Force Border)
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now });
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now });
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now });
                this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now });
            } else {
                this.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
                activeMap.add(`${bx},${by}`);
            }
        };
        const addPerimeter = (dx, dy) => {
            this.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now });
            activeMap.add(`${cx+dx},${cy+dy}`);
        };
        const addRect = (dx1, dy1, dx2, dy2) => {
            this.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now });
            // Update map
            const minX = Math.min(cx + dx1, cx + dx2);
            const maxX = Math.max(cx + dx1, cx + dx2);
            const minY = Math.min(cy + dy1, cy + dy2);
            const maxY = Math.max(cy + dy1, cy + dy2);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) activeMap.add(`${x},${y}`);
            }
        };
        const rem = (dx, dy, face) => {
            if (face) {
                this.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
            } else {
                const bx = cx + dx;
                const by = cy + dy;
                // Check neighbors in current active map
                const nN = activeMap.has(`${bx},${by-1}`);
                const nS = activeMap.has(`${bx},${by+1}`);
                const nE = activeMap.has(`${bx+1},${by}`);
                const nW = activeMap.has(`${bx-1},${by}`);
                
                if (nN && nS && nE && nW) {
                    // Internal: Simply remove lines
                    this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now });
                    this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now });
                    this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now });
                    this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now });
                } else {
                    // External: Standard remove
                    this.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now });
                    activeMap.delete(`${bx},${by}`);
                }
            }
        };
        const addLine = (dx, dy, face) => {
            this.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, startFrame: now });
        };
        const remLine = (dx, dy, face) => {
            this.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now });
        };


        // add(+E -W, -N +S)
        // addRect(From x, From -y, To x, To -y)
        if (p === 0) {
            add(0, 0); // Center
        } else if (p === 1) {
            add(1, 0); // East
        } else if (p === 2) {
            add(0, -1); // North
            add(0, 1);  // South
            rem(0, 0, 'E'); // Fade Center East
        } else if (p === 3) {
            add(-1, 0); // West
            rem(0, 0, 'N'); // Fade Center North
            rem(0, 0, 'S'); // Fade Center South
        } else if (p === 4) {
            add(0, -2); // North of North
            add(0, 2);  // South of South
        } else if (p === 5) {
            rem(0, 0, 'W'); // Fade Center West
            rem(-1, 0, 'W'); // Fade West of Center Left
            add(-2, 0); // West of West
            add(2, 0);  // East of East
            add(0, 3); // South of South

            // Add 2x2 overlap South-East of Center (0,0 to 1,1)
            addRect(0, 0, 1, 1);
            rem(0, 2, 'S');
            rem(0, 0, 'N');
            rem(0, 0, 'E');
            rem(0, 0, 'S');

        } else if (p === 6) {
            add(-1, -1); 
            add(1, -1);  
        } else if (p === 7) {
            add(-1, 1);              
            add(3, 0);
            add(-3, 0);
            rem(-3, 0, 'E');
            rem(0, 1, 'S');
            rem(0, 3, 'S'); 
            rem(0, -1,'N');
            rem(2, 0, 'E');
            addRect(0, 2, 0, 4);
            addLine(0, 2,'S');

        } else if (p === 8) {
            addRect(0,-3, 0, -4);
            add(1, -2);
            add(0, 5);
            add(1, 2);
            addLine(3, 0, 'W');
            rem(1, -1, 'N');
            rem(0, -1, 'S');
            rem(1, 1, 'N');
            rem(1, 1, 'W');
            rem(0, 4, 'S');
            rem(0, -3, 'N');
            addLine(0, 3, 'S');
            remLine(0, 2, 'S');

        } else if (p === 9) {
            add(1, 3);
            remLine(1, 3, 'N');
            add(-1, -2);
            remLine(-1, -1, 'E');
            remLine(-1, -1, 'S');
            add(-2, -1);
            add(1, -3);
            rem(-1, -1, 'E');
            rem(-1, -1, 'S');
            rem(-1, 1);
            remLine(1, 0, 'E');            
            rem(1, -1, 'W');
            rem(1, -1, 'S');
            rem(1, -3, 'S')
            rem(1, -3, 'W');
            addLine(1, -2, 'S');

        } else if (p === 10) {
            addLine(-1, 1, 'W');
            addLine(-1, 1, 'S');
            add(1, 5);
            add(0, 6);
            remLine(0, 3, 'S');
            addRect(3, 0, 6, 0);
            remLine(2, 0, 'E');
            rem(3, 0, 'E');
            rem(4, 0, 'E');
            rem(5, 0, 'E');
            rem(0, 5, 'S');
            addRect(0, -3, 1, -5);
            rem(0, -3, 'N');
            rem(0, -3, 'E');
            rem(1, -2, 'N');
            rem(1, -4, 'W');
            rem(1, -4, 'S');
            add(-1, 1,);
            addLine(0, 4, 'S');

        } else if (p === 11) {
            addRect(2, 2, 1, 4);
            addRect(-1, 2, -1, 5);
            addRect(-4, 0, -4, 1);
            rem(-4, 0, 'S');
            add(-2, 2);
            add(-2, -2);
            rem(-2, -2, 'E');
            rem(-2, -2, 'S');
            add(1, 6);
            add(0, 7);
            addRect(0, -6, 0, -8);
            addLine(1, -3, 'S');
            addLine(1, -3, 'W');
            addLine(1, -4, 'W');
            addLine(1, -4, 'N');
            addLine(1, 2, 'S');
            rem(1, 2, 'W');
            rem(1, 2, 'N');
            rem(0, -2, 'E');
            rem(0, -2, 'N');
            remLine(1, -1, 'N');
            remLine(1, -5, 'S');
            addLine(1, -5, 'W');
            rem(1, 5);
            rem(1, 4, 'E');
            rem(1, 4, 'N');
            rem(1, 3, 'E');
            rem(-1, 2, 'W');
            rem(-1, 2, 'S');
            rem(-1, 3, 'S');
            rem(-1, 4, 'S');
            rem(0, 5, 'S');
            remLine(0, 5, 'N');
            rem(0, 6, 'S');
            rem(0, 6, 'E');
            addLine(0, 5, 'S');
            remLine(-1, 3, 'W')
            remLine(-1, 4, 'W')
            remLine(-1, 5, 'W')

        } else if (p === 12) {
            // Stopping here, start validating from this point. 
            add(-1, -4);
            add(1, -3);
            add(3, 2);
            addRect(-1, 2, -2, 5);
            addRect(0, 8, 0, 9);
            addRect(-3, -1, -3, -2);
            add(1, 3);
            add(1, 4);
            addLine(-2, 4, 'N');
            rem(2, 3);
            rem(2, 4);
            rem(1, 6);
            rem(-1, 5);
            rem(-2, 5);
            rem(-4, 1);
            remLine(-4, 1, 'W');
            remLine(-4, 1, 'S');
            remLine(-4, 1, 'E');
            rem(-2, 3, 'N');
            rem(-2, 3, 'E');
            rem(-2, 4, 'E');
            rem(-1, -2, 'E');
            rem(-1, -2, 'S');
            rem(-2, -1, 'E');
            rem(-2, -1, 'S');
            rem(-3, -2, 'S');
            rem(0, 8, 'S');
            rem(2, 2, 'E');
            remLine(0, 3, 'E');
            remLine(1, 3, 'N');
            remLine(-1, 3, 'N');
            remLine(-1, 3, 'S');
            
        } else if (p === 13){
            addRect(2, -1, 3, -1);
            rem(-3, -1);
            remLine(2, -1, 'E');
            remLine(-3, 0, 'W');
            remLine(-2, -2, 'W');
            remLine(1, -3, 'S');
            remLine(1, -3, 'W');
            remLine(-1, 1, 'S');
            remLine(-1, 2, 'W');
            remLine(-4, -2, 'S');
            addLine(-4, -1, 'E');
            addLine(-3, -2, 'S');
            add(-5, 0);
            rem(-1, 1);
            rem(0, 5, 'S');
            remLine(-2, 1, 'S');
            remLine(-1, 1, 'W');
            remLine(-2, 2, 'W');
            remLine(-2, 3, 'W');
            addRect(2, 1, 2, 2);
            addRect(0, -9, 0, -12);
            addRect(0, 10, 0, 13);
            add(-1, -3);
            add(-4, -2);
            add(-5, -1);

            rem(3, 2);
            remLine(2, 2, 'N');
            remLine(2, 2, 'S');
            remLine(0, 7, 'S');
            rem(0, 8, 'S');
            rem(0, 9, 'S');
            rem(0, 11, 'S');
            rem(0, 12, 'S');
            rem(-5, 0, 'N');
            remLine(-1, -3, 'N');
            remLine(1, -4, 'S');
            remLine(1, -4, 'W');
            remLine(1, -5, 'W');

        } else if (p === 14) {
            add(2, 3);
            add(-1, 1);
            add(-1, -4);
            add(-5, -1);
            addLine(0, -10, 'S');
            addLine(1, 5, 'E');
            rem(3, 2);
            remLine(2, 2, 'N');
            remLine(2, 2, 'S');
            remLine(0, 7, 'S');
            rem(0, 8, 'S');
            rem(0, 9, 'S');
            rem(0, 11, 'S');
            rem(0, 12, 'S');
            rem(-5, 0, 'N');
            remLine(-1, -3, 'N');
            remLine(1, -4, 'S');
            remLine(1, -4, 'W');
            remLine(1, -5, 'W');

        } else if (p === 15){
            add(-5, 1);
            addRect(-2, 5, -1, 5);
            addRect(2, -2, 3, -2);
            add(-2, -4);
            addRect(7, 0, 9, 0);
            addLine(2, 4, 'E');
            addRect(-6, 0, -6, -1);
            rem(2, -2, 'S');
            rem(2, -2, 'E');
            rem(3, -2, 'S');
            rem(2, 1, 'W');
            rem(2, 2, 'W');
            remLine(0, 4, 'E');
            rem(1, 3);
            remLine(0, 5, 'S');
            remLine(1, 5, 'E');
            addLine(1, 5, 'S');
            addLine(1, 6, 'S');
            addLine(0, 7, 'S');
            addRect(0, 14, 0, 15);
            rem(0, 10, 'S');
            rem(0, 14, 'S');
            rem(1, 6);
            rem(8, 0, 'W');
            rem(8, 0, 'E');
            remLine(-1, -4, 'W');
            add(-2, 2);
            remLine(-2, 2, 'E');
            add(-2, 1);
            remLine(-2, 1, 'E');
            remLine(-2, 1, 'W');
            remLine(0, 2, 'W');
            remLine(0, 3, 'W');
            remLine(0, 4, 'W');
            remLine(-3, -2, 'S');
            rem(-6, 0, 'N');
            remLine(-5, -1, 'W');
            remLine(-5, -1, 'E');
            rem(-5, 0, 'E');
            addLine(-5, 0, 'N');
            addLine(-4, -2, 'E');
            add(-5, 1);

        } else if (p === 16){
            rem(-6, -1);
            add(-5, -2);
            rem(-5, -2, 'E')
            rem(-5, -2, 'S');
            addLine(-5, -1, 'W');
            rem(-5, 1);
            remLine(-5, 1, 'S');
            remLine(-5, 1, 'E');
            remLine(-5, 1, 'W');
            remLine(-2, 1, 'S');
            remLine(-1, 1, 'S');
            remLine(-2, -2, 'S');
            rem(0, 1);
            rem(-1, 1);
            remLine(0, -4, 'W');
            add(-1, 4);
            add(-4, -2);
            add(4, -1);
            remLine(-4, -2, 'E');
            remLine(-4, -2, 'S');
            rem(-4, -1, 'S');
            rem(-3, -1);
            addRect(-5, -1, -5, -2);
            addRect(-1, 4, -2, 6);
            remLine(-1, 4, 'W');
            remLine(-1, 4, 'S');
            addLine(0, 5, 'W');
            remLine(-1, 6, 'W');
            remLine(0, 7, 'S');
            addLine(0, 9, 'S');
            remLine(0, 13, 'S');
            addLine(0, 15, 'S');
            addRect(0, 16, 0, 25);
            remLine(0, -9, 'N');
            addLine(0, -11, 'N');
            addRect(0, -13, 0, -18);
            addRect(2, 3, 2, 4);
            addRect(2, -2, 3, -3);
            addLine(-2, 4, 'S');
            addLine(-1, 4, 'S');
            remLine(-2, 3, 'S');
            remLine(-1, 3, 'S');
            remLine(0, 4, 'W');
            rem(2, -2);
            rem(2, -1);
            rem(3, -2, 'N');
            rem(3, -2, 'S');
            remLine(1, -3, 'E');
            addRect(3, 1, 3, 2);
            remLine(2, 0, 'S');
            remLine(3, -1, 'E');
            addRect(4, 1, 4, 2);
            remLine(3, 1, 'W');
            remLine(3, 1, 'E');
            remLine(1, 6, 'N');
            remLine(1, 6, 'S');
            addLine(2, 3, 'W');
            remLine(3, 2, 'N');
            addLine(2, 2, 'S');

        } else if (p === 17){

            remLine(0, 9, 'S');
            addLine(0, 11, 'S');
            remLine(0, 15, 'S');
            add(-2, -3);
            add(-5, 2);
            rem(-1, -3);
            rem(-2, -3, 'N');
            rem(-5, -1, 'E');
            remLine(-5, 0, 'N');
            add(1, 6);
            remLine(-1, 5, 'W');
            remLine(-1, 5, 'S');
            rem(-1, 6);
            rem(-2, 5);
            rem(-2, 6);
        }

        this.expansionPhase++;
        this._maskDirty = true;
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }

    render(ctx, d) {
        if (!this.active || this.alpha <= 0.01) return;

        const s = this.c.state;
        const glowStrength = s.quantizedPulseBorderIllumination || 0;
        if (glowStrength <= 0) return;

        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height);

        if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
            this._updateMask(width, height, s, d);
            this._maskDirty = false;
        }

        // 1. Render Text to Scratch Canvas
        const scratchCtx = this.scratchCtx;
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.clearRect(0, 0, width, height);

        const visualFontSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const weight = s.fontWeight;
        const family = s.fontFamily;
        scratchCtx.font = `${style}${weight} ${visualFontSize}px ${family}`;
        scratchCtx.textAlign = 'center';
        scratchCtx.textBaseline = 'middle';

        // Colors
        const t = Math.min(1.0, glowStrength / 10.0);
        const charR = 255;
        const charG = Math.floor(204 + (255 - 204) * t);
        const charB = Math.floor(0 + (255 - 0) * t);
        const charColor = `rgb(${charR}, ${charG}, ${charB})`;
        const glowR = 255;
        const glowG = Math.floor(215 + (255 - 215) * t);
        const glowB = Math.floor(0 + (255 - 0) * t);
        const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;

        scratchCtx.fillStyle = charColor;
        
        const grid = this.g;
        const screenStepX = d.cellWidth * s.stretchX;
        const screenStepY = d.cellHeight * s.stretchY;
        const gridPixW = grid.cols * d.cellWidth; 
        const gridPixH = grid.rows * d.cellHeight;
        const screenOriginX = ((d.cellWidth * 0.5 + s.fontOffsetX - (gridPixW * 0.5)) * s.stretchX) + (width * 0.5);
        const screenOriginY = ((d.cellHeight * 0.5 + s.fontOffsetY - (gridPixH * 0.5)) * s.stretchY) + (height * 0.5);

        const cols = grid.cols;
        const rows = grid.rows;
        const chars = grid.chars;
        
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);
        const blocksX = Math.ceil(grid.cols / cellPitchX);
        const blocksY = Math.ceil(grid.rows / cellPitchY);

        scratchCtx.globalAlpha = this.alpha; 

        const drawChar = (x, y) => {
            if (x >= cols || y >= rows) return;
            const i = (y * cols) + x;
            let charCode = chars[i];
            if (charCode <= 32) {
                const activeFonts = d.activeFonts;
                const fontData = activeFonts[0] || { chars: "01" };
                const charSet = fontData.chars;
                
                const rotatorCycle = d.rotatorCycleFrames || 20;
                const timeSeed = Math.floor(this.animFrame / rotatorCycle);
                
                // Use a more robust pseudo-random hash to prevent patterns
                // (Standard sin-based hash common in shaders)
                const seed = i * 12.9898 + timeSeed * 78.233;
                const hash = Math.abs(Math.sin(seed) * 43758.5453) % 1;
                
                const char = charSet[Math.floor(hash * charSet.length)];
                charCode = char.charCodeAt(0);
            }
            const cx = screenOriginX + (x * screenStepX);
            const cy = screenOriginY + (y * screenStepY);
            scratchCtx.setTransform(s.stretchX, 0, 0, s.stretchY, cx, cy);
            scratchCtx.fillText(String.fromCharCode(charCode), 0, 0);
        };

        // Standard Grid Loop (Sparse)
        for (let by = 0; by <= blocksY; by++) {
            const y = Math.floor(by * cellPitchY);
            if (y >= rows) continue; 
            for (let x = 0; x < cols; x++) drawChar(x, y);
        }
        for (let bx = 0; bx <= blocksX; bx++) {
            const x = Math.floor(bx * cellPitchX);
            if (x >= cols) continue;
            for (let y = 0; y < rows; y++) drawChar(x, y);
        }
        
        scratchCtx.setTransform(1, 0, 0, 1, 0, 0);

        // 2. Apply Mask
        scratchCtx.globalCompositeOperation = 'destination-in';
        scratchCtx.globalAlpha = 1.0; 
        scratchCtx.drawImage(this.maskCanvas, 0, 0);

        // 3. Composite
        ctx.save();
        if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
            ctx.canvas.style.mixBlendMode = 'plus-lighter';
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1.0;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
        ctx.drawImage(this.scratchCanvas, 0, 0);
        ctx.restore();
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
        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
            this.maskCanvas.width = w;
            this.maskCanvas.height = h;
            this._maskDirty = true;
        }
        if (this.scratchCanvas.width !== w || this.scratchCanvas.height !== h) {
            this.scratchCanvas.width = w;
            this.scratchCanvas.height = h;
        }
    }

    _updateMask(w, h, s, d) {
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
        const cellPitchX = Math.max(1, s.quantizedBlockWidthCells || 4);
        const cellPitchY = Math.max(1, s.quantizedBlockHeightCells || 4);

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
        const addDuration = Math.max(1, s.quantizedPulseFadeInFrames || 0);
        const removeDuration = Math.max(1, s.quantizedPulseFadeFrames || 0);

        // --- PRE-PASS: Build Active Block Map ---
        // We need to know ALL active blocks (from add and addSmart) to determine connectivity
        // Iterate sequentially to respect order of operations (Add -> Remove -> Add)
        const activeBlockMap = new Map(); // key "x,y" -> startFrame
        
        // Helper: Check if location is covered by a LATER add op
        const isLocationCoveredByLaterAdd = (bx, by, time) => {
             for (const subOp of this.maskOps) {
                 if (subOp.type !== 'add' && subOp.type !== 'addSmart') continue;
                 if (!subOp.startFrame || subOp.startFrame <= time) continue; 
                 if (subOp.startFrame > now) continue; 
                 
                 const s = { x: cx + subOp.x1, y: cy + subOp.y1 };
                 const e = { x: cx + subOp.x2, y: cy + subOp.y2 };
                 const mx = Math.min(s.x, e.x), Mx = Math.max(s.x, e.x);
                 const my = Math.min(s.y, e.y), My = Math.max(s.y, e.y);
                 
                 if (bx >= mx && bx <= Mx && by >= my && by <= My) return true;
             }
             return false;
        };

        for (const op of this.maskOps) {
            // Only process if operation has started
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
                        activeBlockMap.set(`${bx},${by}`, op.startFrame || 0);
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
                        activeBlockMap.delete(`${bx},${by}`);
                    }
                }
            }
        }

        // --- PASS 1: Base Grid (Standard Add) ---
        for (const op of this.maskOps) {
            if (op.type !== 'add') continue;

            let opacity = 1.0;
            if (s.quantizedPulseFadeInFrames === 0) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            this._addBlock(start, end, op.ext);
        }

        // --- PASS 1.5: Smart Perimeter (addSmart) ---
        for (const op of this.maskOps) {
            if (op.type !== 'addSmart') continue;

            let opacity = 1.0;
            if (s.quantizedPulseFadeInFrames === 0) opacity = 1.0;
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
                    // Check connectivity to any active block (including neighbors from same op)
                    const nN = activeBlockMap.has(`${bx},${by-1}`);
                    const nS = activeBlockMap.has(`${bx},${by+1}`);
                    const nW = activeBlockMap.has(`${bx-1},${by}`);
                    const nE = activeBlockMap.has(`${bx+1},${by}`);
                    
                    const isConnected = nN || nS || nW || nE;
                    
                    // Connected -> Perimeter Only (true), Isolated -> Full Grid (false)
                    this._addBlock({x:bx, y:by}, {x:bx, y:by}, isConnected);
                }
            }
        }
        
        // --- PASS 1.9: Block Erasure (removeBlock) ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'removeBlock') continue;

            let opacity = 1.0;
            if (s.quantizedPulseFadeFrames === 0) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            
            // Use _addBlock logic (drawing the rect) but with destination-out to erase
            // We pass 'false' for isExtending to erase the full block content
            this._addBlock(start, end, false);
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 2: Erasures (Internal Walls) ---
        ctx.globalCompositeOperation = 'destination-out';
        for (const op of this.maskOps) {
            if (op.type !== 'remove') continue;

            let opacity = 1.0;
            if (s.quantizedPulseFadeFrames === 0) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / removeDuration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            
            // Iterate blocks to check if erasure is overridden
            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                     if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue;
                     this._removeBlockFace({x:bx, y:by}, {x:bx, y:by}, op.face, op.force);
                }
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        // --- PASS 3: Perimeter (Bold Outer Barrier) ---
        const boldLineWidthX = lineWidthX * 2.0; 
        const boldLineWidthY = lineWidthY * 2.0;
        
        for (const [key, startFrame] of activeBlockMap) {
            const [bxStr, byStr] = key.split(',');
            const bx = parseInt(bxStr);
            const by = parseInt(byStr);

            let opacity = 1.0;
            if (s.quantizedPulseFadeInFrames === 0) opacity = 1.0;
            else if (startFrame) opacity = Math.min(1.0, (now - startFrame) / addDuration);
            ctx.globalAlpha = opacity;

            const nN = activeBlockMap.has(`${bx},${by-1}`);
            const nS = activeBlockMap.has(`${bx},${by+1}`);
            const nW = activeBlockMap.has(`${bx-1},${by}`);
            const nE = activeBlockMap.has(`${bx+1},${by}`);

            if (!nN) this._drawPerimeterFace(bx, by, 'N', boldLineWidthX, boldLineWidthY);
            if (!nS) this._drawPerimeterFace(bx, by, 'S', boldLineWidthX, boldLineWidthY);
            if (!nW) this._drawPerimeterFace(bx, by, 'W', boldLineWidthX, boldLineWidthY);
            if (!nE) this._drawPerimeterFace(bx, by, 'E', boldLineWidthX, boldLineWidthY);
        }

        // --- PASS 4: Line Operations (Sorted by Time) ---
        // Combine addLine and removeLine ops to respect temporal order
        const lineOps = this.maskOps.filter(op => op.type === 'addLine' || op.type === 'removeLine');
        lineOps.sort((a, b) => (a.startFrame - b.startFrame));

        for (const op of lineOps) {
            let opacity = 1.0;
            const duration = (op.type === 'addLine') ? addDuration : removeDuration;
            
            if (op.type === 'addLine' && s.quantizedPulseFadeInFrames === 0) opacity = 1.0;
            else if (op.type === 'removeLine' && s.quantizedPulseFadeFrames === 0) opacity = 1.0;
            else if (op.startFrame) opacity = Math.min(1.0, (now - op.startFrame) / duration);
            ctx.globalAlpha = opacity;

            const start = { x: cx + op.x1, y: cy + op.y1 };
            const end = { x: cx + op.x2, y: cy + op.y2 };

            if (op.type === 'addLine') {
                ctx.globalCompositeOperation = 'source-over';
                this._addBlockFace(start, end, op.face);
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
        const removed = new Map(); // key "x,y" -> {N,S,E,W}
        const getRem = (x, y) => {
            let r = removed.get(`${x},${y}`);
            if (!r) { r = {N:0,S:0,E:0,W:0}; removed.set(`${x},${y}`, r); }
            return r;
        };

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
                    if (isLocationCoveredByLaterAdd(bx, by, op.startFrame)) continue; // Also skip corners!
                    if (!force) {
                        if (f === 'N' && by === minY) continue;
                        if (f === 'S' && by === maxY) continue;
                        if (f === 'W' && bx === minX) continue;
                        if (f === 'E' && bx === maxX) continue;
                    }
                    const r = getRem(bx, by);
                    if (f === 'N') r.N = 1;
                    else if (f === 'S') r.S = 1;
                    else if (f === 'W') r.W = 1;
                    else if (f === 'E') r.E = 1;
                }
            }
        }

        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1.0; 
        for (const [key, r] of removed) {
            const [bx, by] = key.split(',').map(Number);
            if (r.N && r.W) this._removeBlockCorner(bx, by, 'NW');
            if (r.N && r.E) this._removeBlockCorner(bx, by, 'NE');
            if (r.S && r.W) this._removeBlockCorner(bx, by, 'SW');
            if (r.S && r.E) this._removeBlockCorner(bx, by, 'SE');
        }
        
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
    }

    _removeBlockCorner(bx, by, corner) {
        const ctx = this.maskCtx;
        const l = this.layout;
        
        const cellX = Math.floor(bx * l.cellPitchX);
        const cellY = Math.floor(by * l.cellPitchY);
        // North-West corner of the block is (cellX, cellY) in screen logic terms of lines
        // N Line is at y = screenOriginY + cellY*stepY
        // W Line is at x = screenOriginX + cellX*stepX
        
        // Wait, cellY is top row of block.
        // N face is at top of block.
        // S face is at bottom of block (cellY + pitchY).
        
        let cx, cy;
        
        if (corner === 'NW') {
            cx = l.screenOriginX + (cellX * l.screenStepX);
            cy = l.screenOriginY + (cellY * l.screenStepY);
        } else if (corner === 'NE') {
            const endCellX = Math.floor((bx + 1) * l.cellPitchX);
            cx = l.screenOriginX + (endCellX * l.screenStepX);
            cy = l.screenOriginY + (cellY * l.screenStepY);
        } else if (corner === 'SW') {
            const endCellY = Math.floor((by + 1) * l.cellPitchY);
            cx = l.screenOriginX + (cellX * l.screenStepX);
            cy = l.screenOriginY + (endCellY * l.screenStepY);
        } else if (corner === 'SE') {
            const endCellX = Math.floor((bx + 1) * l.cellPitchX);
            const endCellY = Math.floor((by + 1) * l.cellPitchY);
            cx = l.screenOriginX + (endCellX * l.screenStepX);
            cy = l.screenOriginY + (endCellY * l.screenStepY);
        }
        
        // Clear a box the size of the line width centered at intersection
        // Inflate slightly to ensure full coverage
        const inflate = 1.0; 
        ctx.beginPath();
        ctx.rect(cx - l.halfLineX - inflate, cy - l.halfLineY - inflate, l.lineWidthX + (inflate*2), l.lineWidthY + (inflate*2));
        ctx.fill();
    }

    /**
     * Adds the specified face (border line) to blocks in the given range.
     */
    _addBlockFace(blockStart, blockEnd, face) {
        if (!this.maskCtx || !this.layout) return;

        const ctx = this.maskCtx;
        const l = this.layout;
        const f = face.toUpperCase();

        const minX = Math.min(blockStart.x, blockEnd.x);
        const maxX = Math.max(blockStart.x, blockEnd.x);
        const minY = Math.min(blockStart.y, blockEnd.y);
        const maxY = Math.max(blockStart.y, blockEnd.y);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

        for (let by = minY; by <= maxY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
                
                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);

                const hx = l.lineWidthX / 2;
                const hy = l.lineWidthY / 2;

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
                    const w = ((endCellX - startCellX) * l.screenStepX) + l.lineWidthX;
                    ctx.rect(x, cy - hy, w, l.lineWidthY);
                } else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
                    const w = ((endCellX - startCellX) * l.screenStepX) + l.lineWidthX;
                    ctx.rect(x, cy - hy, w, l.lineWidthY);
                } else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
                    const h = ((endCellY - startCellY) * l.screenStepY) + l.lineWidthY;
                    ctx.rect(cx - hx, y, l.lineWidthX, h);
                } else if (f === 'E') {
                    const cx = l.screenOriginX + (endCellX * l.screenStepX);
                    const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
                    const h = ((endCellY - startCellY) * l.screenStepY) + l.lineWidthY;
                    ctx.rect(cx - hx, y, l.lineWidthX, h);
                }
            }
        }
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    _drawPerimeterFace(bx, by, face, widthX, widthY) {
        const ctx = this.maskCtx;
        const l = this.layout;
        const startCellX = Math.floor(bx * l.cellPitchX);
        const startCellY = Math.floor(by * l.cellPitchY);
        const endCellX = Math.floor((bx + 1) * l.cellPitchX);
        const endCellY = Math.floor((by + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        
        const hx = widthX / 2;
        const hy = widthY / 2;

        if (face === 'N') {
            const cy = l.screenOriginY + (startCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'S') {
            const cy = l.screenOriginY + (endCellY * l.screenStepY);
            const x = l.screenOriginX + (startCellX * l.screenStepX) - hx;
            const w = ((endCellX - startCellX) * l.screenStepX) + widthX;
            ctx.rect(x, cy - hy, w, widthY);
        } else if (face === 'W') {
            const cx = l.screenOriginX + (startCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        } else if (face === 'E') {
            const cx = l.screenOriginX + (endCellX * l.screenStepX);
            const y = l.screenOriginY + (startCellY * l.screenStepY) - hy;
            const h = ((endCellY - startCellY) * l.screenStepY) + widthY;
            ctx.rect(cx - hx, y, widthX, h);
        }
        ctx.fill();
    }

    /**
     * Dynamically adds a grid block region to the mask.
     */
    _addBlock(blockStart, blockEnd, isExtending) {
        if (!this.maskCtx || !this.layout) return;

        const ctx = this.maskCtx;
        const l = this.layout;

        const startX = Math.floor(blockStart.x * l.cellPitchX);
        const endX = Math.floor((blockEnd.x + 1) * l.cellPitchX);
        const startY = Math.floor(blockStart.y * l.cellPitchY);
        const endY = Math.floor((blockEnd.y + 1) * l.cellPitchY);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();

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
            const rangeMinBx = blockStart.x;
            const rangeMaxBx = blockEnd.x;
            const rangeMinBy = blockStart.y;
            const rangeMaxBy = blockEnd.y;

            for (let bx = rangeMinBx; bx <= rangeMaxBx + 1; bx++) {
                const cellX = Math.floor(bx * l.cellPitchX);
                const cx = l.screenOriginX + (cellX * l.screenStepX);
                const yPos = l.screenOriginY + (startY * l.screenStepY);
                const h = (endY - startY) * l.screenStepY;
                ctx.rect(cx - l.halfLineX, yPos - l.halfLineY, l.lineWidthX, h + l.lineWidthY);
            }

            for (let by = rangeMinBy; by <= rangeMaxBy + 1; by++) {
                const cellY = Math.floor(by * l.cellPitchY);
                const cy = l.screenOriginY + (cellY * l.screenStepY);
                const xPos = l.screenOriginX + (startX * l.screenStepX);
                const w = (endX - startX) * l.screenStepX;
                ctx.rect(xPos - l.halfLineX, cy - l.halfLineY, w + l.lineWidthX, l.lineWidthY);
            }
        }
        ctx.fill();
    }

    /**
     * Removes the specified face (border line) from blocks in the given range.
     */
    _removeBlockFace(blockStart, blockEnd, face, force = false) {
        if (!this.maskCtx || !this.layout) return;

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

                const startCellX = Math.floor(bx * l.cellPitchX);
                const startCellY = Math.floor(by * l.cellPitchY);
                const endCellX = Math.floor((bx + 1) * l.cellPitchX);
                const endCellY = Math.floor((by + 1) * l.cellPitchY);
                // Use halfLine for safe inset to align exactly with the perpendicular line edge
                // Add a tiny safety margin to prevent cutting into the perpendicular line due to AA
                const safety = 0.5;
                const safeX = l.halfLineX + safety; 
                const safeY = l.halfLineY + safety; 
                
                // Inflate the erasure rectangle slightly to fully clear anti-aliased edges
                const inflate = 0.5; 

                if (f === 'N') {
                    const cy = l.screenOriginY + (startCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                }
                else if (f === 'S') {
                    const cy = l.screenOriginY + (endCellY * l.screenStepY);
                    const left = l.screenOriginX + (startCellX * l.screenStepX) + safeX;
                    const width = ((endCellX - startCellX) * l.screenStepX) - (safeX * 2);
                    ctx.rect(left, cy - l.halfLineY - inflate, width, l.lineWidthY + (inflate * 2));
                }
                else if (f === 'W') {
                    const cx = l.screenOriginX + (startCellX * l.screenStepX);
                    const top = l.screenOriginY + (startCellY * l.screenStepY) + safeY;
                    const height = ((endCellY - startCellY) * l.screenStepY) - (safeY * 2);
                    ctx.rect(cx - l.halfLineX - inflate, top, l.lineWidthX + (inflate * 2), height);
                }
                else if (f === 'E') {
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
}