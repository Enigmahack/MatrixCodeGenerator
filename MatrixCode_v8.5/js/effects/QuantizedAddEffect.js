class QuantizedAddEffect extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedAdd";
        this.active = false;
        
        this.configPrefix = "quantizedAdd";

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
    }

    trigger(force = false) {
        // 1. Strict Active Check
        if (this.active) return false;

        // 2. Mutually Exclusive Lock
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom"];
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
        this.offsetX = 0.5; 
        this.offsetY = 0.5;

                this.expansionPhase = 0;
        this.cycleTimer = 0;
        this.cyclesCompleted = 0;
        this.manualStep = false;

        this._initShadowWorld();
        this.hasSwapped = false;
        this.isSwapping = false;

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

        // 0. Update Shadow Simulation & Warmup
        if (!this.hasSwapped && !this.isSwapping) {
            if (super._updateShadowSim()) return;
        } else if (this.isSwapping) {
            super.updateTransition(true);
        }

        this.animFrame++;

        // 1. Animation Cycle (Grid Expansion) - Logic Update
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const userSpeed = (s.quantizedAddSpeed !== undefined) ? s.quantizedAddSpeed : 5;
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

        // 3. Lifecycle State Machine
        const fadeInFrames = Math.max(1, s.quantizedAddFadeInFrames);
        const fadeOutFrames = Math.max(1, s.quantizedAddFadeFrames);
        const durationFrames = s.quantizedAddDurationSeconds * fps;
        
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
    applyToGrid(grid) {
    }
}





