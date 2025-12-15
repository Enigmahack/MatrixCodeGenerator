class ReverseEffect extends AbstractEffect {
    constructor(grid, config, effectRegistry) {
        super(grid, config);
        this.name = "Reverse";
        this.effectRegistry = effectRegistry;
        this.active = false;
        
        // Sequence phases
        // 0: Idle
        // 1: Slow Down
        // 2: Stop
        // 3: Reverse (Rewind)
        // 4: Reset (Pulse)
        this.phase = 0;
        this.timer = 0;
        
        // Configuration (Could be moved to ConfigManager later)
        this.durationSlow = 120; // Frames to slow down
        this.durationStop = 60;  // Frames to hold stop
        this.durationRewind = 180; // Frames to rewind
        this.rewindSpeed = -2.0;   // Rewind speed multiplier
        
        // Store original speed to restore later (though we manipulate timeScale directly)
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
        
        // Access Simulation System directly via global or passed reference
        // Ideally EffectRegistry should pass simulation, but currently it passes grid/config.
        // We can access it via window.matrix.simulation as a fallback or hack.
        // Or better: The MatrixKernel passes 'effectRegistry' which has 'grid'.
        // Wait, EffectRegistry doesn't store SimulationSystem.
        // Let's assume window.matrix is available as per MatrixKernel.js: "window.matrix = kernel;"
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
                    // Lerp timeScale from 1.0 to 0.0
                    // Ease out cubic
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
                    const progress = this.timer / this.durationRewind;
                    // Accelerate rewind? Or constant?
                    // Constant is clearer.
                    // Ramp up rewind speed
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

            case 4: // PULSE RESET
                {
                    // Trigger a massive Clear Pulse
                    if (this.timer === 0) {
                        this.sim.timeScale = 0; // Pause during blast init
                        
                        // Force a ClearPulse manually or via registry
                        // We want a fast, strong pulse.
                        const pulse = this.effectRegistry.get('ClearPulse');
                        if (pulse) {
                            // Override pulse settings for this specific blast?
                            // Difficult without dirtying config. 
                            // Just trigger it and restore speed immediately.
                            pulse.trigger();
                        }
                    }
                    
                    // Quickly restore speed
                    if (this.timer > 30) {
                        this.sim.timeScale = 1.0;
                        this.active = false;
                        this.phase = 0;
                    } else {
                        // Ramp up speed from 0 to 1
                        this.sim.timeScale = this.timer / 30;
                    }
                }
                break;
        }
    }
}
