class QuantizedAddEffect extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
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
        
        this.offsetX = 0.0; 
        this.offsetY = 0.0;

        this._initShadowWorld();

        // Ensure renderGrid is initialized
        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }

    applyToGrid(grid) {
    }
}





