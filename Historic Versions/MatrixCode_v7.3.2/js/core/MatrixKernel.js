class MatrixKernel {
    constructor() {
        // Initialize core components
        this._initializeManagers();
        this._initializeEffects();
        
        // Frame handling and rendering variables
        this.frame = 0;
        this.lastTime = 0;
        this.accumulator = 0;
        this.timestep = 1000 / 60;

        // Window resize handling
        this._setupResizeListener();

        // Configuration subscription for dynamic updates
        this._setupConfigSubscriptions();
    }

    async initAsync() {
        // Asynchronous initialization steps
        await this._initializeRendererAndUI();

        // Perform the initial resize setup and start the loop
        this._resize();
        requestAnimationFrame((time) => this._loop(time));
    }

    /**
     * Initializes core managers (Notification, Config, Grid, Simulation, EffectRegistry).
     * @private
     */
    _initializeManagers() {
        this.notifications = new NotificationManager();
        this.config = new ConfigurationManager();
        this.grid = new MatrixGrid(this.config);
        this.simulation = new SimulationSystem(this.grid, this.config);
        this.effectRegistry = new EffectRegistry(this.grid, this.config);
    }

    /**
     * Registers all active visual effects with the EffectRegistry.
     * @private
     */
    _initializeEffects() {
        const effects = [
            PulseEffect,
            ClearPulseEffect,
            MiniPulseEffect,
            DejaVuEffect,
            SupermanEffect,
            FirewallEffect
        ];
        effects.forEach((EffectClass) => this.effectRegistry.register(new EffectClass(this.grid, this.config)));
    }

    /**
     * Initializes the CanvasRenderer, FontManager, and UIManager.
     * @private
     */
    async _initializeRendererAndUI() {
        this.renderer = new CanvasRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry);
        this.fontMgr = new FontManager(this.config, this.notifications);
        this.ui = new UIManager(this.config, this.effectRegistry, this.fontMgr, this.notifications);

        // Initialize font manager and await its completion
        await this.fontMgr.init();
    }

    /**
     * Sets up a debounced window resize listener.
     * @private
     */
    _setupResizeListener() {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._resize(), 100); // Debounce resize events
        });
    }

    /**
     * Sets up subscriptions to configuration changes that trigger UI or rendering updates.
     * @private
     */
    _setupConfigSubscriptions() {
        const resizeTriggers = new Set([
            'resolution',
            'stretchX',
            'stretchY',
            'fontSize',
            'horizontalSpacingFactor'
        ]);

        const smoothingTriggers = new Set([
            'smoothingEnabled',
            'smoothingAmount'
        ]);

        this.config.subscribe((key) => {
            // Resize the canvas and grid on resolution-related changes
            if (resizeTriggers.has(key) || key === 'ALL') {
                this._resize();
            }

            // Update renderer when smoothing settings change
            if (smoothingTriggers.has(key)) {
                this.renderer.updateSmoothing();
            }
        });
    }

    /**
     * Resizes the grid and renderer dimensions based on current window size and configuration.
     * @private
     */
    _resize() {
        this.renderer.resize();
        this.grid.resize(
            window.innerWidth / this.config.state.stretchX,
            window.innerHeight / this.config.state.stretchY
        );
    }

    /**
     * The main animation loop, handling updates and rendering.
     * Uses a fixed timestep for consistent simulation speed.
     * @private
     * @param {DOMHighResTimeStamp} time - The current time provided by requestAnimationFrame.
     */
    _loop(time) {
        if (!this.lastTime) this.lastTime = time;
        const delta = time - this.lastTime;
        this.lastTime = time;

        this.accumulator += delta;
        while (this.accumulator >= this.timestep) {
            this._updateFrame();
            this.accumulator -= this.timestep;
        }

        this.renderer.render(this.frame);
        requestAnimationFrame((nextTime) => this._loop(nextTime));
    }

    /**
     * Updates the simulation logic for a single frame.
     * @private
     */
    _updateFrame() {
        this.frame++;
        this.effectRegistry.update();
        this.simulation.update(this.frame);
    }
}

// Initialize the MatrixKernel on DOMContentLoaded
window.addEventListener('DOMContentLoaded', async () => {
    const kernel = new MatrixKernel();
    await kernel.initAsync();
});
