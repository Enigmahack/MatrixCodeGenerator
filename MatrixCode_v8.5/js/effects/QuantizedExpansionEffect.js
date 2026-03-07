class QuantizedExpansionEffect extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedExpansion";
        this.active = false;
        
        this.configPrefix = "quantizedExpansion";

        this.timer = 0;
        this.state = 'IDLE'; 
        this.alpha = 0.0;
        
        this.offsetX = 0;
        this.offsetY = 0;

        this.sequence = [[]]; 
        
        this.expansionPhase = 0;
        this.maskOps = [];
        this.editorHighlight = false;
        
        this.isSwapping = false;
        this.swapTimer = 0;
    }

    trigger(force = false) {
        if (this.active) return false;

        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb", "QuantizedZoom", "QuantizedCrawler"];
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

        if (this.renderGrid) {
            this.renderGrid.fill(-1);
        }

        return true;
    }

    applyToGrid(grid) {
    }
}
