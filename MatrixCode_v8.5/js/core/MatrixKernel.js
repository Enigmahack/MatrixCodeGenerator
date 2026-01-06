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
        this._effectTimers = {}; // Initialize map for effect timers
        this._supermanTimer = 0; // Initialize Superman effect timer (will be managed in _effectTimers)
        this._setupResizeListener();
        this._setupInputListener();
        
        // FPS tracking variables
        this.lastFrameTime = 0; // Tracks time of the previous frame
        this.fpsHistory = []; // Used for simple FPS smoothing
        this.fpsDisplayElement = null; // Holds reference to the HTML element

        // Configuration subscription for dynamic updates
        this._setupConfigSubscriptions();

        // Override console.error based on logErrors setting
        const originalError = console.error;
        console.error = (...args) => {
            if (this.config.state.logErrors) {
                originalError.apply(console, args);
            }
        };
    }

    async initAsync() {
        // Asynchronous initialization steps
        await this._initializeRendererAndUI();

        // Perform the initial resize setup and start the loop
        this._resize();
        requestAnimationFrame((time) => this._loop(time));
        this.fpsDisplayElement = document.getElementById('fps-counter');

        // Trigger Boot Sequence on startup if enabled
        if (this.config.get('bootSequenceEnabled')) {
            // Short delay to ensure everything is ready
            setTimeout(() => {
                this.effectRegistry.trigger('BootSequence');
            }, 100);
        }
    }

    /**
     * Initializes core managers (Notification, Config, Grid, Simulation, EffectRegistry).
     * @private
     */
    _initializeManagers() {
        this.config = new ConfigurationManager();
        this.notifications = new NotificationManager(this.config);
        this.config.setNotificationManager(this.notifications);
        this.grid = new CellGrid(this.config);
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
            ReverseEffect,
            BootEffect,
            CrashEffect,
            QuantizedPulseEffect,
            QuantizedAddEffect,
            QuantizedRetractEffect,
            QuantizedExpansionEffect
        ];
        effects.forEach((EffectClass) => {
            if (EffectClass === CrashEffect || EffectClass === BootEffect || EffectClass === ReverseEffect) {
                this.effectRegistry.register(new EffectClass(this.grid, this.config, this.effectRegistry));
            } else {
                this.effectRegistry.register(new EffectClass(this.grid, this.config));
            }
        });
    }

    /**
     * Initializes the CanvasRenderer, FontManager, and UIManager.
     * @private
     */
    async _initializeRendererAndUI() {
        if (typeof WebGLRenderer !== 'undefined') {
             this.renderer = new WebGLRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry);
        } else {
             console.error("WebGLRenderer not found. Application cannot start.");
             this.notifications.show("Critical Error: WebGL Renderer missing.", "error");
             return;
        }

        this.fontMgr = new FontManager(this.config, this.notifications);
        this.charSelector = new CharacterSelectorModal(this.config, this.fontMgr, this.notifications);
        this.ui = new UIManager(this.config, this.effectRegistry, this.fontMgr, this.notifications, this.charSelector);

        // Overlay Canvas Setup
        this.overlayCanvas = document.getElementById('overlayCanvas');
        if (this.overlayCanvas) {
            this.overlayCtx = this.overlayCanvas.getContext('2d');
        }

        // Subscribe to font changes to invalidate rendering caches
        this.fontMgr.subscribe(() => {
            if (this.renderer) {
                this.renderer.handleFontChange();
            }
        });

        // Initialize font manager and await its completion
        await this.fontMgr.init();

        // Safety: Reset Shader State on Reload
        if (this.config.get('shaderEnabled')) {
            this.config.set('shaderEnabled', false);
            this.config.set('customShader', null);
        }
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
     * Sets up the global input listener for key bindings.
     * @private
     */
    _setupInputListener() {
        window.addEventListener('keydown', (e) => {
            // Ignore if typing in an input field or text area
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Ignore if in key binding mode (Double check flag)
            if (this.ui && this.ui.isKeyBindingActive) return;
            
            // Ignore if modifier keys are pressed (unless we want to support them later)
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const bindings = this.config.state.keyBindings || {};
            const key = e.key.toLowerCase();

            for (const [action, boundKey] of Object.entries(bindings)) {
                if (boundKey && boundKey.toLowerCase() === key) {
                    if (action === 'ToggleUI') {
                        this.ui.togglePanel();
                    } else if (action === 'BootSequence' || action === 'CrashSequence') { 
                        if (action === 'CrashSequence' && !this.config.state.crashEnabled) return;
                        this.effectRegistry.trigger(action);
                        this.notifications.show(`${action} Triggered`, 'success');
                    }
                    else {
                        if (this.effectRegistry.trigger(action)) {
                            this.notifications.show(`${action} Triggered`, 'success');
                        }
                    }
                    // Prevent default action only if we matched a binding
                    e.preventDefault();
                    return;
                }
            }
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
            'horizontalSpacingFactor',
            'verticalSpacingFactor',
            'fontOffsetX',
            'fontOffsetY'
        ]);

        const smoothingTriggers = new Set([
            'smoothingEnabled',
            'smoothingAmount'
        ]);

        const atlasTriggers = new Set([
            'fontWeight',
            'italicEnabled',
            'tracerSizeIncrease',
            'tracerGlow',
            'overlapColor',
            'streamPalette',
            'tracerColor'
        ]);

        const speedTriggers = new Set([
            'streamSpeed',
            'desyncIntensity'
        ]);

        this.config.subscribe((key) => {
            // Resize the canvas and grid on resolution-related changes
            if (resizeTriggers.has(key) || key === 'ALL') {
                this._resize();
            }

            // Recalculate stream speeds when timing settings change
            if ((speedTriggers.has(key) || key === 'ALL') && this.simulation && this.simulation.streamManager) {
                this.simulation.streamManager.recalculateSpeeds();
            }

            // Update renderer when smoothing settings change
            if (smoothingTriggers.has(key)) {
                this.renderer.updateSmoothing();
            }

            // Update Atlas if appearance changes (WebGL optimization)
            if ((atlasTriggers.has(key) || key === 'ALL') && this.renderer && this.renderer.handleAppearanceChange) {
                this.renderer.handleAppearanceChange();
            }

            const autoEffects = [
                { enabledKey: 'pulseEnabled', frequencyKey: 'pulseFrequencySeconds', effectName: 'Pulse' },
                { enabledKey: 'clearPulseEnabled', frequencyKey: 'clearPulseFrequencySeconds', effectName: 'ClearPulse' },
                { enabledKey: 'miniPulseEnabled', frequencyKey: 'miniPulseFrequencySeconds', effectName: 'MiniPulse' },
                { enabledKey: 'dejaVuEnabled', frequencyKey: 'dejaVuFrequencySeconds', effectName: 'DejaVu' },
                { enabledKey: 'supermanEnabled', frequencyKey: 'supermanFrequencySeconds', effectName: 'Superman' },
                { enabledKey: 'quantizedPulseEnabled', frequencyKey: 'quantizedPulseFrequencySeconds', effectName: 'QuantizedPulse' },
                { enabledKey: 'quantizedAddEnabled', frequencyKey: 'quantizedAddFrequencySeconds', effectName: 'QuantizedAdd' },
                { enabledKey: 'quantizedRetractEnabled', frequencyKey: 'quantizedRetractFrequencySeconds', effectName: 'QuantizedRetract' },
                { enabledKey: 'crashEnabled', frequencyKey: 'crashFrequencySeconds', effectName: 'CrashSequence' }
            ];

            autoEffects.forEach(effect => {
                if ((key === effect.enabledKey && this.config.state[effect.enabledKey]) || key === 'ALL') {
                    const minFrequencyFrames = this.config.state[effect.frequencyKey] * 60;
                    const randomOffsetFrames = Utils.randomInt(0, minFrequencyFrames * 0.5); // Up to 50% random offset
                    this._effectTimers[effect.effectName] = minFrequencyFrames + randomOffsetFrames;
                } else if (key === effect.enabledKey && !this.config.state[effect.enabledKey]) {
                    // If an effect is specifically disabled, remove its timer
                    delete this._effectTimers[effect.effectName];
                }
            });
        });
    }

    /**
     * Resizes the grid and renderer dimensions based on current window size and configuration.
     * @private
     */
    _resize() {
        this.grid.resize(
            (window.innerWidth) / this.config.state.stretchX,
            (window.innerHeight) / this.config.state.stretchY
        );
        this.renderer.resize();

        if (this.overlayCanvas) {
            this.overlayCanvas.width = window.innerWidth;
            this.overlayCanvas.height = window.innerHeight;
        }
    }

    /**
     * The main animation loop, handling updates and rendering.
     * Uses a fixed timestep for consistent simulation speed.
     * @private
     * @param {DOMHighResTimeStamp} time - The current time provided by requestAnimationFrame.
     */
    _loop(time) {
    // 1. Calculate Delta and FPS
    const now = performance.now();
    const deltaFPS = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (deltaFPS > 0 && this.config.state.showFpsCounter) {
        const fps = 1000 / deltaFPS;
        
        // Simple 30-frame smoothing
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 30) {
            this.fpsHistory.shift();
        }
        const smoothedFps = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;

            // 2. Update Display
            if (this.fpsDisplayElement) {
                let text = `FPS: ${Math.round(smoothedFps)}`;
                if (this.config.state.debugEnabled) {
                     if (performance.memory) {
                         const used = Math.round(performance.memory.usedJSHeapSize / 1048576);
                         text += ` | Mem: ${used}MB`;
                     }
                     if (this.grid && this.grid.activeIndices) {
                         const cellCount = this.grid.activeIndices.size;
                         const sm = this.simulation.streamManager;
                         // Safety check for streamManager
                         const streams = sm ? sm.activeStreams : [];
                         const tracers = streams.filter(s => !s.isEraser && !s.isUpward).length;
                         const erasers = streams.filter(s => s.isEraser).length;
                         
                         let rotators = 0;
                         for (const idx of this.grid.activeIndices) {
                             if ((this.grid.types[idx] & CELL_TYPE_MASK) === CELL_TYPE.ROTATOR) rotators++;
                         }
                         const shimmers = this.grid.complexStyles.size;

                         text += ` | Cells: ${cellCount}`;
                         text += ` | Tracers: ${tracers}`;
                         text += ` | Erasers: ${erasers}`;
                         text += ` | Rotators: ${rotators}`;
                         text += ` | Shimmers: ${shimmers}`;
                     }
                }
                this.fpsDisplayElement.textContent = text;
                this.fpsDisplayElement.style.display = 'block';
            }
        } else if (this.fpsDisplayElement) {
            // Hide the counter if the setting is disabled
            this.fpsDisplayElement.style.display = 'none';
        }


        // Start main rendering loop
        if (!this.lastTime) this.lastTime = time;
        const delta = time - this.lastTime;
        this.lastTime = time;

        this.accumulator += delta;
        while (this.accumulator >= this.timestep) {
            this._updateFrame();
            this.accumulator -= this.timestep;
        }

        this.renderer.render(this.frame);

        // Render Overlay Effects
        if (this.overlayCtx) {
            this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            this.effectRegistry.render(this.overlayCtx, this.config.derived);
        }

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

        const autoEffects = [
            { enabledKey: 'pulseEnabled', frequencyKey: 'pulseFrequencySeconds', effectName: 'Pulse' },
            { enabledKey: 'clearPulseEnabled', frequencyKey: 'clearPulseFrequencySeconds', effectName: 'ClearPulse' },
            { enabledKey: 'miniPulseEnabled', frequencyKey: 'miniPulseFrequencySeconds', effectName: 'MiniPulse' },
            { enabledKey: 'dejaVuEnabled', frequencyKey: 'dejaVuFrequencySeconds', effectName: 'DejaVu' },
            { enabledKey: 'supermanEnabled', frequencyKey: 'supermanFrequencySeconds', effectName: 'Superman' },
            { enabledKey: 'quantizedPulseEnabled', frequencyKey: 'quantizedPulseFrequencySeconds', effectName: 'QuantizedPulse' },
            { enabledKey: 'quantizedAddEnabled', frequencyKey: 'quantizedAddFrequencySeconds', effectName: 'QuantizedAdd' },
            { enabledKey: 'quantizedRetractEnabled', frequencyKey: 'quantizedRetractFrequencySeconds', effectName: 'QuantizedRetract' },
            { enabledKey: 'quantizedExpansionEnabled', frequencyKey: 'quantizedExpansionFrequencySeconds', effectName: 'QuantizedExpansion' },
            { enabledKey: 'crashEnabled', frequencyKey: 'crashFrequencySeconds', effectName: 'CrashSequence' }
        ];

        autoEffects.forEach(effect => {
            if (this.config.state[effect.enabledKey]) {
                if (!this._effectTimers[effect.effectName]) {
                    // Initialize timer with randomization if not already set
                    const minFrequencyFrames = this.config.state[effect.frequencyKey] * 60;
                    const randomOffsetFrames = Utils.randomInt(0, minFrequencyFrames * 0.5); // Up to 50% random offset
                    this._effectTimers[effect.effectName] = minFrequencyFrames + randomOffsetFrames;
                }

                this._effectTimers[effect.effectName]--;

                if (this._effectTimers[effect.effectName] <= 0) {
                    this.effectRegistry.trigger(effect.effectName);
                    // Reset timer with randomization
                    const minFrequencyFrames = this.config.state[effect.frequencyKey] * 60;
                    const randomOffsetFrames = Utils.randomInt(0, minFrequencyFrames * 0.5);
                    this._effectTimers[effect.effectName] = minFrequencyFrames + randomOffsetFrames;
                }
            } else {
                // If effect is disabled, ensure its timer is reset or cleared
                if (this._effectTimers[effect.effectName]) {
                    delete this._effectTimers[effect.effectName];
                }
            }
        });
    }
}

// Initialize the MatrixKernel on DOMContentLoaded
window.addEventListener('DOMContentLoaded', async () => {
    const kernel = new MatrixKernel();
    // Expose kernel and config globally for debugging/console access
    window.matrix = kernel;
    window.config = kernel.config;
    
    await kernel.initAsync();
    kernel.lastFrameTime = performance.now(); // Set initial time
});
