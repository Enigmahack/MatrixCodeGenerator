class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedBlockGenerator";
        this.configPrefix = "quantizedGenerateV2";
    }

    trigger(force = false) {
        // super.trigger(force = false) now handles scx/scy adjustment and sequence loading
        if (!super.trigger(force)) return false;
        
        // If we have no sequence, start generating immediately.
        // Otherwise, super.trigger(force = false) put us in FADE_IN which transitions to SUSTAIN (PLAYBACK).
        // The takeover logic in update() will switch us to GENERATING after the sequence.
        const hasSequence = this.sequence && this.sequence.length > 0 && !(this.sequence.length === 1 && this.sequence[0].length === 0);
        
        if (!hasSequence) {
            this.state = 'GENERATING';
            this.alpha = 1.0; 
            this.timer = 0;
            this.expansionPhase = 0;
        }

        this._initShadowWorld();
        if (this.state === 'GENERATING') {
            this._initProceduralState(true);
        } else {
            this._initProceduralState(false);
        }
        
        return true;
    }
}

if (typeof window !== 'undefined') window.QuantizedBlockGeneration = QuantizedBlockGeneration;
