class QuantizedClimbEffect extends QuantizedBaseEffect {
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
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedZoom"];
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
        this.expansionPhase = 0;
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.manualStep = false;

        this._initShadowWorld();

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    update() {
        if (!this.active) return;

        // 0. Update Shadow Simulation & Warmup
        if (!this.hasSwapped && !this.isSwapping) {
            if (super._updateShadowSim()) return;
        } else if (this.isSwapping) {
            super.updateTransition(true);
        }

        const s = this.c.state;
        const fps = 60;
        this.animFrame++;

        // 1. Animation Cycle
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const userSpeed = (s.quantizedClimbSpeed !== undefined) ? s.quantizedClimbSpeed : 5;

        // Map 1 (Slowest) -> 10 (Fastest) to internal delayMult 10 -> 1
        const delayMult = 11 - userSpeed;
        const effectiveInterval = baseDuration * (delayMult / 4.0);

            this.cycleTimer++;

            if (this.cycleTimer >= effectiveInterval) {
                if (!this.debugMode || this.manualStep) {
                    this.cycleTimer = 0;
                    this.cyclesCompleted++;

                    if (this.expansionPhase < this.sequence.length) {
                        this._processAnimationStep();
                    } else if (this.getConfig('AutoGenerateRemaining')) {
                        this._attemptGrowth();
                    }
                    this.manualStep = false;
                }
            }
        this._updateRenderGridLogic();

        // 2. Lifecycle
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
            const isFinished = (this.timer >= durationFrames);
            const procFinished = this.getConfig('AutoGenerateRemaining') && this._isProceduralFinished();

            if (!this.debugMode && (isFinished || procFinished)) {
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

        // 4. Animation Transition Management (Dirtiness)
        this._checkDirtiness();
    }
}