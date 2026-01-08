class QuantizedPulseEffect extends QuantizedSequenceEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedPulse";
        this.active = false;
        
        this.configPrefix = "quantizedPulse";

        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Grid properties
        this.gridPitchChars = 4;
        this.offsetX = 0;
        this.offsetY = 0;

        // Animation Sequence Data
        this.sequence = [
            [{ op: 'add', args: [0, 0] }], // 0
            [{ op: 'add', args: [1, 0] }], // 1
            [{ op: 'add', args: [0, -1] }, { op: 'add', args: [0, 1] }, { op: 'rem', args: [0, 0, 'E'] }], // 2
            [{ op: 'add', args: [-1, 0] }, { op: 'rem', args: [0, 0, 'N'] }, { op: 'rem', args: [0, 0, 'S'] }], // 3
            [{ op: 'add', args: [0, -2] }, { op: 'add', args: [0, 2] }], // 4
            [{ op: 'rem', args: [0, 0, 'W'] }, { op: 'rem', args: [-1, 0, 'W'] }, { op: 'add', args: [-2, 0] }, { op: 'add', args: [2, 0] }, { op: 'add', args: [0, 3] }, { op: 'addRect', args: [0, 0, 1, 1] }, { op: 'rem', args: [0, 2, 'S'] }, { op: 'rem', args: [0, 0, 'N'] }, { op: 'rem', args: [0, 0, 'E'] }, { op: 'rem', args: [0, 0, 'S'] }], // 5
            [{ op: 'add', args: [-1, -1] }, { op: 'add', args: [1, -1] }], // 6
            [{ op: 'add', args: [-1, 1] }, { op: 'add', args: [3, 0] }, { op: 'add', args: [-3, 0] }, { op: 'rem', args: [-3, 0, 'E'] }, { op: 'rem', args: [0, 1, 'S'] }, { op: 'rem', args: [0, 3, 'S'] }, { op: 'rem', args: [0, -1, 'N'] }, { op: 'rem', args: [2, 0, 'E'] }, { op: 'addRect', args: [0, 2, 0, 4] }, { op: 'addLine', args: [0, 2, 'S'] }], // 7
            [{ op: 'addRect', args: [0, -3, 0, -4] }, { op: 'add', args: [1, -2] }, { op: 'add', args: [0, 5] }, { op: 'add', args: [1, 2] }, { op: 'addLine', args: [3, 0, 'W'] }, { op: 'rem', args: [1, -1, 'N'] }, { op: 'rem', args: [0, -1, 'S'] }, { op: 'rem', args: [1, 1, 'N'] }, { op: 'rem', args: [1, 1, 'W'] }, { op: 'rem', args: [0, 4, 'S'] }, { op: 'rem', args: [0, -3, 'N'] }, { op: 'addLine', args: [0, 3, 'S'] }, { op: 'remLine', args: [0, 2, 'S'] }], // 8
            [{ op: 'add', args: [1, 3] }, { op: 'remLine', args: [1, 3, 'N'] }, { op: 'add', args: [-1, -2] }, { op: 'remLine', args: [-1, -1, 'E'] }, { op: 'remLine', args: [-1, -1, 'S'] }, { op: 'add', args: [-2, -1] }, { op: 'add', args: [1, -3] }, { op: 'rem', args: [-1, -1, 'E'] }, { op: 'rem', args: [-1, -1, 'S'] }, { op: 'rem', args: [-1, 1] }, { op: 'remLine', args: [1, 0, 'E'] }, { op: 'rem', args: [1, -1, 'W'] }, { op: 'rem', args: [1, -1, 'S'] }, { op: 'rem', args: [1, -3, 'S'] }, { op: 'rem', args: [1, -3, 'W'] }, { op: 'addLine', args: [1, -2, 'S'] }], // 9
            [{ op: 'addLine', args: [-1, 1, 'W'] }, { op: 'addLine', args: [-1, 1, 'S'] }, { op: 'add', args: [1, 5] }, { op: 'add', args: [0, 6] }, { op: 'remLine', args: [0, 3, 'S'] }, { op: 'addRect', args: [3, 0, 6, 0] }, { op: 'remLine', args: [2, 0, 'E'] }, { op: 'rem', args: [3, 0, 'E'] }, { op: 'rem', args: [4, 0, 'E'] }, { op: 'rem', args: [5, 0, 'E'] }, { op: 'rem', args: [0, 5, 'S'] }, { op: 'addRect', args: [0, -3, 1, -5] }, { op: 'rem', args: [0, -3, 'N'] }, { op: 'rem', args: [0, -3, 'E'] }, { op: 'rem', args: [1, -2, 'N'] }, { op: 'rem', args: [1, -4, 'W'] }, { op: 'rem', args: [1, -4, 'S'] }, { op: 'add', args: [-1, 1] }, { op: 'addLine', args: [0, 4, 'S'] }], // 10
            [
                { op: 'addRect', args: [2, 2, 1, 4] }, { op: 'addRect', args: [-1, 2, -1, 5] }, { op: 'addRect', args: [-4, 0, -4, 1] }, { op: 'rem', args: [-4, 0, 'S'] }, { op: 'add', args: [-2, 2] }, { op: 'add', args: [-2, -2] }, { op: 'rem', args: [-2, -2, 'E'] }, { op: 'rem', args: [-2, -2, 'S'] }, { op: 'add', args: [1, 6] }, { op: 'add', args: [0, 7] }, { op: 'addRect', args: [0, -6, 0, -8] }, 
                { op: 'addLine', args: [1, -3, 'S'] }, { op: 'addLine', args: [1, -3, 'W'] }, { op: 'addLine', args: [1, -4, 'W'] }, { op: 'addLine', args: [1, -4, 'N'] }, { op: 'addLine', args: [1, 2, 'S'] }, 
                { op: 'rem', args: [1, 2, 'W'] }, { op: 'rem', args: [1, 2, 'N'] }, { op: 'rem', args: [0, -2, 'E'] }, { op: 'rem', args: [0, -2, 'N'] }, 
                { op: 'remLine', args: [1, -1, 'N'] }, { op: 'remLine', args: [1, -5, 'S'] }, { op: 'addLine', args: [1, -5, 'W'] }, 
                { op: 'rem', args: [1, 5] }, { op: 'rem', args: [1, 4, 'E'] }, { op: 'rem', args: [1, 4, 'N'] }, { op: 'rem', args: [1, 3, 'E'] }, 
                { op: 'rem', args: [-1, 2, 'W'] }, { op: 'rem', args: [-1, 2, 'S'] }, { op: 'rem', args: [-1, 3, 'S'] }, { op: 'rem', args: [-1, 4, 'S'] }, 
                { op: 'rem', args: [0, 5, 'S'] }, { op: 'remLine', args: [0, 5, 'N'] }, { op: 'rem', args: [0, 6, 'S'] }, { op: 'rem', args: [0, 6, 'E'] }, 
                { op: 'addLine', args: [0, 5, 'S'] }, { op: 'remLine', args: [-1, 3, 'W'] }, { op: 'remLine', args: [-1, 4, 'W'] }, { op: 'remLine', args: [-1, 5, 'W'] }
            ], // 11
            [
                { op: 'add', args: [-1, -4] }, { op: 'add', args: [1, -3] }, { op: 'add', args: [3, 2] }, { op: 'addRect', args: [-1, 2, -2, 5] }, { op: 'addRect', args: [0, 8, 0, 9] }, { op: 'addRect', args: [-3, -1, -3, -2] }, { op: 'add', args: [1, 3] }, { op: 'add', args: [1, 4] }, 
                { op: 'addLine', args: [-2, 4, 'N'] }, 
                { op: 'rem', args: [2, 3] }, { op: 'rem', args: [2, 4] }, { op: 'rem', args: [1, 6] }, { op: 'rem', args: [-1, 5] }, { op: 'rem', args: [-2, 5] }, { op: 'rem', args: [-4, 1] }, 
                { op: 'remLine', args: [-4, 1, 'W'] }, { op: 'remLine', args: [-4, 1, 'S'] }, { op: 'remLine', args: [-4, 1, 'E'] }, 
                { op: 'rem', args: [-2, 3, 'N'] }, { op: 'rem', args: [-2, 3, 'E'] }, { op: 'rem', args: [-2, 4, 'E'] }, 
                { op: 'rem', args: [-1, -2, 'E'] }, { op: 'rem', args: [-1, -2, 'S'] }, { op: 'rem', args: [-2, -1, 'E'] }, { op: 'rem', args: [-2, -1, 'S'] }, { op: 'rem', args: [-3, -2, 'S'] }, 
                { op: 'rem', args: [0, 8, 'S'] }, { op: 'rem', args: [2, 2, 'E'] }, 
                { op: 'remLine', args: [0, 3, 'E'] }, { op: 'remLine', args: [1, 3, 'N'] }, { op: 'remLine', args: [-1, 3, 'N'] }, { op: 'remLine', args: [-1, 3, 'S'] }
            ], // 12
            [
                { op: 'addRect', args: [2, -1, 3, -1] }, { op: 'rem', args: [-3, -1] }, { op: 'remLine', args: [2, -1, 'E'] }, { op: 'remLine', args: [-3, 0, 'W'] }, { op: 'remLine', args: [-2, -2, 'W'] }, 
                { op: 'remLine', args: [1, -3, 'S'] }, { op: 'remLine', args: [1, -3, 'W'] }, { op: 'remLine', args: [-1, 1, 'S'] }, { op: 'remLine', args: [-1, 2, 'W'] }, { op: 'remLine', args: [-4, -2, 'S'] }, 
                { op: 'addLine', args: [-4, -1, 'E'] }, { op: 'addLine', args: [-3, -2, 'S'] }, { op: 'add', args: [-5, 0] }, 
                { op: 'rem', args: [-1, 1] }, { op: 'rem', args: [0, 5, 'S'] }, { op: 'remLine', args: [-2, 1, 'S'] }, { op: 'remLine', args: [-1, 1, 'W'] }, { op: 'remLine', args: [-2, 2, 'W'] }, { op: 'remLine', args: [-2, 3, 'W'] }, 
                { op: 'addRect', args: [2, 1, 2, 2] }, { op: 'addRect', args: [0, -9, 0, -12] }, { op: 'addRect', args: [0, 10, 0, 13] }, { op: 'add', args: [-1, -3] }, { op: 'add', args: [-4, -2] }, { op: 'add', args: [-5, -1] }, 
                { op: 'rem', args: [3, 2] }, { op: 'remLine', args: [2, 2, 'N'] }, { op: 'remLine', args: [2, 2, 'S'] }, 
                { op: 'remLine', args: [0, 7, 'S'] }, { op: 'rem', args: [0, 8, 'S'] }, { op: 'rem', args: [0, 9, 'S'] }, { op: 'rem', args: [0, 11, 'S'] }, { op: 'rem', args: [0, 12, 'S'] }, 
                { op: 'rem', args: [-5, 0, 'N'] }, { op: 'remLine', args: [-1, -3, 'N'] }, { op: 'remLine', args: [1, -4, 'S'] }, { op: 'remLine', args: [1, -4, 'W'] }, { op: 'remLine', args: [1, -5, 'W'] }
            ], // 13
            [
                { op: 'add', args: [2, 3] }, { op: 'add', args: [-1, 1] }, { op: 'add', args: [-1, -4] }, { op: 'add', args: [-5, -1] }, 
                { op: 'addLine', args: [0, -10, 'S'] }, { op: 'addLine', args: [1, 5, 'E'] }, 
                { op: 'rem', args: [3, 2] }, { op: 'remLine', args: [2, 2, 'N'] }, { op: 'remLine', args: [2, 2, 'S'] }, 
                { op: 'remLine', args: [0, 7, 'S'] }, { op: 'rem', args: [0, 8, 'S'] }, { op: 'rem', args: [0, 9, 'S'] }, { op: 'rem', args: [0, 11, 'S'] }, { op: 'rem', args: [0, 12, 'S'] }, 
                { op: 'rem', args: [-5, 0, 'N'] }, { op: 'remLine', args: [-1, -3, 'N'] }, { op: 'remLine', args: [1, -4, 'S'] }, { op: 'remLine', args: [1, -4, 'W'] }, { op: 'remLine', args: [1, -5, 'W'] }
            ], // 14
            [
                { op: 'add', args: [-5, 1] }, { op: 'addRect', args: [-2, 5, -1, 5] }, { op: 'addRect', args: [2, -2, 3, -2] }, { op: 'add', args: [-2, -4] }, { op: 'addRect', args: [7, 0, 9, 0] }, 
                { op: 'addLine', args: [2, 4, 'E'] }, { op: 'addRect', args: [-6, 0, -6, -1] }, 
                { op: 'rem', args: [2, -2, 'S'] }, { op: 'rem', args: [2, -2, 'E'] }, { op: 'rem', args: [3, -2, 'S'] }, { op: 'rem', args: [2, 1, 'W'] }, { op: 'rem', args: [2, 2, 'W'] }, 
                { op: 'remLine', args: [0, 4, 'E'] }, { op: 'rem', args: [1, 3] }, { op: 'remLine', args: [0, 5, 'S'] }, { op: 'remLine', args: [1, 5, 'E'] }, 
                { op: 'addLine', args: [1, 5, 'S'] }, { op: 'addLine', args: [1, 6, 'S'] }, { op: 'addLine', args: [0, 7, 'S'] }, 
                { op: 'addRect', args: [0, 14, 0, 15] }, { op: 'rem', args: [0, 10, 'S'] }, { op: 'rem', args: [0, 14, 'S'] }, 
                { op: 'rem', args: [1, 6] }, { op: 'rem', args: [8, 0, 'W'] }, { op: 'rem', args: [8, 0, 'E'] }, 
                { op: 'remLine', args: [-1, -4, 'W'] }, { op: 'add', args: [-2, 2] }, { op: 'remLine', args: [-2, 2, 'E'] }, { op: 'add', args: [-2, 1] }, { op: 'remLine', args: [-2, 1, 'E'] }, { op: 'remLine', args: [-2, 1, 'W'] }, 
                { op: 'remLine', args: [0, 2, 'W'] }, { op: 'remLine', args: [0, 3, 'W'] }, { op: 'remLine', args: [0, 4, 'W'] }, { op: 'remLine', args: [-3, -2, 'S'] }, 
                { op: 'rem', args: [-6, 0, 'N'] }, { op: 'remLine', args: [-5, -1, 'W'] }, { op: 'remLine', args: [-5, -1, 'E'] }, { op: 'rem', args: [-5, 0, 'E'] }, 
                { op: 'addLine', args: [-5, 0, 'N'] }, { op: 'addLine', args: [-4, -2, 'E'] }, { op: 'add', args: [-5, 1] }
            ], // 15
            [
                { op: 'rem', args: [-6, -1] }, { op: 'add', args: [-5, -2] }, { op: 'rem', args: [-5, -2, 'E'] }, { op: 'rem', args: [-5, -2, 'S'] }, { op: 'addLine', args: [-5, -1, 'W'] }, 
                { op: 'rem', args: [-5, 1] }, { op: 'remLine', args: [-5, 1, 'S'] }, { op: 'remLine', args: [-5, 1, 'E'] }, { op: 'remLine', args: [-5, 1, 'W'] }, 
                { op: 'remLine', args: [-2, 1, 'S'] }, { op: 'remLine', args: [-1, 1, 'S'] }, { op: 'remLine', args: [-2, -2, 'S'] }, 
                { op: 'rem', args: [0, 1] }, { op: 'rem', args: [-1, 1] }, { op: 'remLine', args: [0, -4, 'W'] }, 
                { op: 'add', args: [-1, 4] }, { op: 'add', args: [-4, -2] }, { op: 'add', args: [4, -1] }, 
                { op: 'remLine', args: [-4, -2, 'E'] }, { op: 'remLine', args: [-4, -2, 'S'] }, { op: 'rem', args: [-4, -1, 'S'] }, { op: 'rem', args: [-3, -1] }, 
                { op: 'addRect', args: [-5, -1, -5, -2] }, { op: 'addRect', args: [-1, 4, -2, 6] }, 
                { op: 'remLine', args: [-1, 4, 'W'] }, { op: 'remLine', args: [-1, 4, 'S'] }, { op: 'addLine', args: [0, 5, 'W'] }, { op: 'remLine', args: [-1, 6, 'W'] }, 
                { op: 'remLine', args: [0, 7, 'S'] }, { op: 'addLine', args: [0, 9, 'S'] }, { op: 'remLine', args: [0, 13, 'S'] }, { op: 'addLine', args: [0, 15, 'S'] }, 
                { op: 'addRect', args: [0, 16, 0, 25] }, { op: 'remLine', args: [0, -9, 'N'] }, { op: 'addLine', args: [0, -11, 'N'] }, { op: 'addRect', args: [0, -13, 0, -18] }, 
                { op: 'addRect', args: [2, 3, 2, 4] }, { op: 'addRect', args: [2, -2, 3, -3] }, 
                { op: 'addLine', args: [-2, 4, 'S'] }, { op: 'addLine', args: [-1, 4, 'S'] }, { op: 'remLine', args: [-2, 3, 'S'] }, { op: 'remLine', args: [-1, 3, 'S'] }, { op: 'remLine', args: [0, 4, 'W'] }, 
                { op: 'rem', args: [2, -2] }, { op: 'rem', args: [2, -1] }, { op: 'rem', args: [3, -2, 'N'] }, { op: 'rem', args: [3, -2, 'S'] }, { op: 'remLine', args: [1, -3, 'E'] }, 
                { op: 'addRect', args: [3, 1, 3, 2] }, { op: 'remLine', args: [2, 0, 'S'] }, { op: 'remLine', args: [3, -1, 'E'] }, { op: 'addRect', args: [4, 1, 4, 2] }, 
                { op: 'remLine', args: [3, 1, 'W'] }, { op: 'remLine', args: [3, 1, 'E'] }, { op: 'remLine', args: [1, 6, 'N'] }, { op: 'remLine', args: [1, 6, 'S'] }, 
                { op: 'addLine', args: [2, 3, 'W'] }, { op: 'remLine', args: [3, 2, 'N'] }, { op: 'addLine', args: [2, 2, 'S'] }
            ], // 16
            [
                { op: 'remLine', args: [0, 9, 'S'] }, { op: 'addLine', args: [0, 11, 'S'] }, { op: 'remLine', args: [0, 15, 'S'] }, 
                { op: 'add', args: [-2, -3] }, { op: 'add', args: [-5, 2] }, 
                { op: 'rem', args: [-1, -3] }, { op: 'rem', args: [-2, -3, 'N'] }, { op: 'rem', args: [-5, -1, 'E'] }, { op: 'remLine', args: [-5, 0, 'N'] }, 
                { op: 'add', args: [1, 6] }, { op: 'remLine', args: [-1, 5, 'W'] }, { op: 'remLine', args: [-1, 5, 'S'] }, 
                { op: 'rem', args: [-1, 6] }, { op: 'rem', args: [-2, 5] }, { op: 'rem', args: [-2, 6] }
            ] // 17
        ];
        this.editorHighlight = false;
    }

    trigger(force = false) {
        if (!super.trigger(force)) return false;
        
        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.offsetX = 0.5; // Fraction of cell width
        this.offsetY = 0.5; // Fraction of cell height

        return true;
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
                // window.removeEventListener('keydown', this._boundDebugHandler); // Handled by super or state transition? 
                // Super removes it in _handleDebugInput on Escape.
                // But if animation finishes naturally, we should remove it?
                // Super doesn't track natural finish. 
                // Let's remove it here to be safe.
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
        if (this.expansionPhase < this.sequence.length) {
            const step = this.sequence[this.expansionPhase];
            if (step) this._executeStepOps(step);
            this.expansionPhase++;
            this._maskDirty = true;
        }
    }

    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }

    render(ctx, d) {
        if (!this.active || (this.alpha <= 0.01 && !this.debugMode)) return;

        const s = this.c.state;
        const glowStrength = s.quantizedPulseBorderIllumination || 0;
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        this._ensureCanvases(width, height); // Call super (generic args)

        // Ensure layout is calculated for debug mode even if glow is off
        if (this.debugMode && (!this.layout || this.maskCanvas.width !== width || this._maskDirty)) {
             this._updateMask(width, height, s, d);
             this._maskDirty = false;
        }

        if (glowStrength > 0) {
            if (this._maskDirty || this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
                this._updateMask(width, height, s, d);
                this._maskDirty = false;
            }

            // 1. Render Text to Scratch Canvas
            this._updateGridCache(width, height, s, d);
            
            const scratchCtx = this.scratchCtx;
            scratchCtx.globalCompositeOperation = 'source-over';
            scratchCtx.clearRect(0, 0, width, height);

            // Draw cached grid
            scratchCtx.globalAlpha = this.alpha; 
            scratchCtx.drawImage(this.gridCacheCanvas, 0, 0);
            scratchCtx.globalAlpha = 1.0;

            // 2. Apply Mask
            scratchCtx.globalCompositeOperation = 'destination-in';
            scratchCtx.drawImage(this.maskCanvas, 0, 0);

            // 3. Composite
            ctx.save();
            if (ctx.canvas.style.mixBlendMode !== 'plus-lighter') {
                ctx.canvas.style.mixBlendMode = 'plus-lighter';
            }
            ctx.globalCompositeOperation = 'lighter';
            
            // Colors
            const t = Math.min(1.0, glowStrength / 10.0);
            const glowR = 255;
            const glowG = Math.floor(215 + (255 - 215) * t);
            const glowB = Math.floor(0 + (255 - 0) * t);
            const glowColor = `rgb(${glowR}, ${glowG}, ${glowB})`;
            
            ctx.globalAlpha = 1.0;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = (glowStrength * 4.0) * this.alpha;
            ctx.drawImage(this.scratchCanvas, 0, 0);
            ctx.restore();
        }
    }
}