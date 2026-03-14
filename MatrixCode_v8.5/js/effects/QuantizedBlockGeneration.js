class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedBlockGenerator";
        this.configPrefix = "quantizedGenerateV2";
    }

    trigger(force = false) {
        // super.trigger() already calls _resetV2Engine() for a clean slate
        if (!super.trigger(force)) return false;
        
        // Default behavior (no sequence found)
        this.state = 'GENERATING';
        this.alpha = 1.0; // Ensure visibility
        this.timer = 0;
        this.expansionPhase = 0;
        this.sequence = [];

        // Set spawn center BEFORE _initProceduralState so the seed block lands at the right position.
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        
        let scx = 0, scy = 0;
        if (this.getConfig('RandomStart')) {
            scx = Math.floor((Math.random() - 0.5) * (visW - 10));
            scy = Math.floor((Math.random() - 0.5) * (visH - 10));
        }

        // Adjust center point based on the first block of the sequence (if it exists)
        // so that the animation's "seed" lands at our chosen scx/scy.
        const seq = this.sequence && this.sequence.length > 0 ? this.sequence : (window.matrixPatterns && window.matrixPatterns[this.name]);
        if (seq && seq.length > 0) {
            const firstBlock = QuantizedSequence.findFirstBlock(seq);
            if (firstBlock) {
                scx -= firstBlock.x;
                scy -= firstBlock.y;
            }
        }

        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;


        // Procedural initialization — uses behaviorState.scx/scy set above.
        // If we loaded a sequence, _initProceduralState(true) would normally seed the grid,
        // but since we are in PLAYBACK, the grid will be seeded by the first step of the sequence.
        // However, we still need to init the shadow world if required.
        this._initShadowWorld();
        if (this.state === 'GENERATING') {
            this._initProceduralState(true);
        } else {
            this._initProceduralState(false);
        }
        
        // _initBehaviors is already called inside _resetV2Engine via super.trigger

        return true;
    }
}

if (typeof window !== 'undefined') window.QuantizedBlockGeneration = QuantizedBlockGeneration;
