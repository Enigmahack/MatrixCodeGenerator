class ReverseEffect extends AbstractEffect {
    constructor(grid, config, effectRegistry) {
        super(grid, config);
        this.name = "ReverseTime";
        this.effectRegistry = effectRegistry;
        this.active = false;
        
        // Sequence phases
        // 0: Idle
        // 1: Slow Down
        // 2: Stop
        // 3: Reverse (Rewind)
        // 4: Reset (Pulse Handoff)
        this.phase = 0;
        this.timer = 0;
        
        // Configuration
        this.durationSlow = 60;  // Frames to slow down (1s)
        this.durationStop = 20;   // Frames to hold stop (~0.3s)
        this.durationRewind = 100; // Frames to rewind (~1.6s)
        this.rewindSpeed = -3.0;   // Rewind speed multiplier
    }

    trigger() {
        return this.start();
    }

    getOverride(i) {
        return null;
    }

    getActiveIndices() {
        return null;
    }

    start() {
        if (this.active) return false;
        this.active = true;
        this.phase = 1;
        this.timer = 0;
        
        this.sim = window.matrix ? window.matrix.simulation : null;
        
        if (!this.sim) {
            console.error("ReverseEffect: SimulationSystem not found.");
            this.active = false;
            return false;
        }

        return true;
    }

    update() {
        if (!this.active || !this.sim) return;

        this.timer++;

        switch (this.phase) {
            case 1: // SLOW DOWN
                {
                    const progress = this.timer / this.durationSlow;
                    const t = 1.0 - Math.pow(1 - progress, 3); 
                    this.sim.timeScale = 1.0 - t;
                    
                    if (this.timer >= this.durationSlow) {
                        this.sim.timeScale = 0;
                        this.phase = 2;
                        this.timer = 0;
                    }
                }
                break;

            case 2: // STOP (HOLD)
                {
                    this.sim.timeScale = 0;
                    if (this.timer >= this.durationStop) {
                        this.phase = 3;
                        this.timer = 0;
                    }
                }
                break;

            case 3: // REWIND
                {
                    if (this.timer < 60) {
                        const t = this.timer / 60;
                        this.sim.timeScale = -t * Math.abs(this.rewindSpeed);
                    } else {
                        this.sim.timeScale = this.rewindSpeed;
                    }

                    if (this.timer >= this.durationRewind) {
                        this.phase = 4;
                        this.timer = 0;
                    }
                }
                break;

            case 4: // PULSE HANDOFF
                {
                    // Resume Normal Simulation
                    this.sim.timeScale = 1.0;
                    
                    // Trigger Standard Pulse Effect (runs correctly with its own freeze/dim)
                    // We assume the user has configured the Pulse effect as desired (e.g. Movie Accurate)
                    this.effectRegistry.trigger('Pulse');
                    
                    // Deactivate Time Control
                    this.active = false;
                    this.phase = 0;
                }
                break;
        }
    }
}
