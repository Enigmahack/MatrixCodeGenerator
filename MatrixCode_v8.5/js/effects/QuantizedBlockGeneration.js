class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedBlockGenerator";
        this.configPrefix = "quantizedGenerateV2";
    }

    trigger(force = false) {
        // super.trigger() already calls _resetV2Engine() for a clean slate
        if (!super.trigger(force)) return false;
        
        // Block Generator stays in GENERATING state immediately (after warmup)
        this.state = 'GENERATING';
        this.alpha = 1.0; // Ensure visibility
        this.timer = 0;
        this.expansionPhase = 0;
        this.sequence = [];

        // Set spawn center BEFORE _initProceduralState so the seed block lands at the right position.
        if (this.getConfig('RandomStart')) {
            const bs = this.getBlockSize();
            const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
            const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
            this.behaviorState.scx = Math.floor((Math.random() - 0.5) * (visW - 10));
            this.behaviorState.scy = Math.floor((Math.random() - 0.5) * (visH - 10));
        } else {
            this.behaviorState.scx = 0;
            this.behaviorState.scy = 0;
        }

        // Procedural initialization — uses behaviorState.scx/scy set above.
        this._initShadowWorld();
        this._initProceduralState(true);
        // _initBehaviors is already called inside _resetV2Engine via super.trigger

        // Passively ensure the next sequence is ready in the background
        if (window.sequenceCache) {
            const configKey = window.sequenceCache.generateConfigKey(this.configPrefix);
            setTimeout(() => {
                window.sequenceCache.ensureReady(configKey);
            }, 1500); // 1.5s delay to "settle"
        }

        return true;
    }
}

if (typeof window !== 'undefined') window.QuantizedBlockGeneration = QuantizedBlockGeneration;
