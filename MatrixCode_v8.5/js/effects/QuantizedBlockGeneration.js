class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0; // Allow expansion 200% past screen edges to prevent border stalls
        this.persistentCycleIndex = 0;
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        if (!super.trigger(force)) return false;

        this.alpha = 1.0;
        this.state = 'GENERATING';
        this.persistentCycleIndex = 0;
        
        this._initShadowWorld(); 
        this._initProceduralState(true);
        this._updateRenderGridLogic();

        return true;
    }

    // Uses QuantizedBaseEffect._attemptGrowth() which now includes the advanced engine.
    _attemptGrowth() {
        super._attemptGrowth();
    }

    stop() {
        super.stop();
    }
}