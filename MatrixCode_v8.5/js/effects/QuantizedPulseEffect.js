class QuantizedPulseEffect extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedPulse";
        this.active = false;
        
        this.configPrefix = "quantizedPulse";

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
            const siblings = ["QuantizedGenerate", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom"];
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

        this.animFrame++;

        // 1. Animation Cycle (Grid Expansion) - Logic Update
        const baseDuration = Math.max(1, this.c.derived.cycleDuration);
        const delayMult = (s.quantizedPulseSpeed !== undefined) ? s.quantizedPulseSpeed : 1;
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

        // NEW: Update Render Grid Logic immediately (fixes 1-frame lag)
        this._updateRenderGridLogic();

        // 2. Update Shadow Simulation & Apply Overrides
        if (!this.hasSwapped && !this.isSwapping) {
            super._updateShadowSim();
        } else if (this.isSwapping) {
            super.updateTransition(true);
        }

        // 3. Lifecycle State Machine
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
            if (!this.debugMode && this.timer >= durationFrames) {
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


    // _updateMask removed to use Base implementation



    applyToGrid(grid) {
        // No grid overrides - we render directly to overlayCanvas
    }
}