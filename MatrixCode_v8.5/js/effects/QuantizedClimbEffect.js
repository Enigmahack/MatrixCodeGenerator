class QuantizedClimbEffect extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
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

        this._initShadowWorld();

        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }
}
