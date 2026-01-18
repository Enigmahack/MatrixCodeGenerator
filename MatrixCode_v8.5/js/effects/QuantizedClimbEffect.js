class QuantizedClimbEffect extends QuantizedSequenceEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedClimb";
        this.active = false;
        this.configPrefix = "quantizedClimb";
        
        // Simulation State
        this.timer = 0;
        this.state = 'IDLE'; // IDLE, FADE_IN, SUSTAIN, FADE_OUT
        this.alpha = 0.0;
        
        // Sequence State
        this.sequence = [[]]; 
        this.expansionPhase = 0;
        this.maskOps = [];
        
        // Flicker Fix
        this.isSwapping = false;
        this.swapTimer = 0;
    }

    trigger(force = false) {
        // 1. Strict Active Check
        if (this.active) return false;

        // 2. Mutually Exclusive Lock
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedGenerate", "QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedZoom"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) {
                    return false;
                }
            }
        }

        if (!super.trigger(force)) return false;

        this.state = 'FADE_IN';
        this.timer = 0;
        this.alpha = 0.0;
        this.hasSwapped = false;
        this.isSwapping = false;

        // Initialize Shadow World
        this._initShadowWorldBase(false);
        
        // Climb-specific injection (High Density)
        const sm = this.shadowSim.streamManager;
        const s = this.c.state;
        
        const columns = Array.from({length: this.shadowGrid.cols}, (_, i) => i);
        // Shuffle
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [columns[i], columns[j]] = [columns[j], columns[i]];
        }
        
        // 75% Fill
        const injectionCount = Math.floor(this.shadowGrid.cols * 0.75);
        for (let k = 0; k < injectionCount; k++) {
            const col = columns[k];
            const startY = Math.floor(Math.random() * this.shadowGrid.rows);
            const isEraser = Math.random() < 0.2;
            const stream = sm._initializeStream(col, isEraser, s);
            stream.y = startY;
            if (startY < stream.visibleLen) {
                stream.age = startY;
                sm.addActiveStream(stream);
            }
        }

        // Warmup
        for (let i = 0; i < 400; i++) this.shadowSim.update(i);
        this.shadowSimFrame = 400;

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    update() {
        if (!this.active) return;

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedClimbSpeed !== undefined) ? s.quantizedClimbSpeed : 1;
        const effectiveInterval = baseDuration * (delayMult / 4.0);

        this.cycleTimer++;
        if (this.cycleTimer >= effectiveInterval) {
            this.cycleTimer = 0;
            this.cyclesCompleted++;
            
            if (!this.debugMode || this.manualStep) {
                this._processAnimationStep();
                this.manualStep = false;
            }
        }

        this._updateRenderGridLogic();

        // 2. Shadow Simulation
        if (!this.hasSwapped && !this.isSwapping) {
            super._updateShadowSim();
        } else if (this.isSwapping) {
            super._updateShadowSim();
            this.swapTimer--;
            if (this.swapTimer <= 0) {
                this.g.clearAllOverrides();
                this.isSwapping = false;
                this.hasSwapped = true;
                this.active = false;
                this.state = 'IDLE';
                this.shadowGrid = null;
                this.shadowSim = null;
                window.removeEventListener('keydown', this._boundDebugHandler);
            }
        }

        // 3. Lifecycle
        const fadeInFrames = Math.max(1, (s.quantizedClimbFadeInFrames !== undefined) ? s.quantizedClimbFadeInFrames : 60);
        const fadeOutFrames = Math.max(1, (s.quantizedClimbFadeFrames !== undefined) ? s.quantizedClimbFadeFrames : 60);
        const durationFrames = (s.quantizedClimbDurationSeconds || 2) * fps;

        if (this.state === 'FADE_IN') {
            this.timer++;
            this.alpha = Math.min(1.0, this.timer / fadeInFrames);
            if (this.timer >= fadeInFrames) {
                this.state = 'SUSTAIN';
                this.timer = 0;
                this.alpha = 1.0;
            }
        } else if (this.state === 'SUSTAIN') {
            this.timer++;
            if (!this.debugMode && this.timer >= durationFrames) {
                this.state = 'FADE_OUT';
                this.timer = 0;
                if (!this.hasSwapped && !this.isSwapping) {
                    this._swapStates();
                }
            }
        } else if (this.state === 'FADE_OUT') {
            if (!this.isSwapping) {
                this.timer++;
                this.alpha = Math.max(0.0, 1.0 - (this.timer / fadeOutFrames));
                if (this.timer >= fadeOutFrames) {
                    this.active = false;
                    this.state = 'IDLE';
                    window.removeEventListener('keydown', this._boundDebugHandler);
                    this.g.clearAllOverrides();
                    this.shadowGrid = null;
                    this.shadowSim = null;
                }
            }
        }

        // 4. Dirtiness Check
        const addDuration = Math.max(1, s.quantizedClimbFadeInFrames || 0);
        if (this.maskOps) {
            for (const op of this.maskOps) {
                if (this.animFrame - op.startFrame < addDuration) {
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
}