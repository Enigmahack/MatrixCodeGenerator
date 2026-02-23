/**
 * GlobalShadowWorld.js - Persistent background simulation for Quantized Effects.
 */
class GlobalShadowWorld {
    constructor(config) {
        this.config = config;
        this.grid = new CellGrid(config);
        this.simulation = new SimulationSystem(this.grid, config, false); 
        this.frame = 0;
        this.initialized = false;
    }

    init(width, height, frame = 0) {
        this.frame = frame;
        this.grid.resize(width, height);
        this.grid.isShadow = true; 
        
        const sm = this.simulation.streamManager;
        sm.resize(this.grid.cols);
        
        sm.nextSpawnFrame = frame;
        this.initialized = true;
    }

    update(mainFrame) {
        if (!this.initialized || this.config.state.simulationPaused) return;
        
        // Sync frame with main simulation to ensure logic parity
        this.frame = mainFrame;
        this.simulation.update(this.frame);
    }

    resize(width, height) {
        this.grid.resize(width, height);
        if (this.simulation.streamManager) {
            this.simulation.streamManager.resize(this.grid.cols);
        }
    }
}

// Global instance
window.globalShadowWorld = null;
