// =======================================================================
// MATRIX KERNEL
// =========================================================================

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
        this._lastResetReason = "Startup"; // Track last reset
        
        // Idle Detection State
        this.isIdle = false;
        this._idleTimer = null;
        this._setupIdleDetection();

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
        // Asynchronous initialization steps (Patterns are needed for editor too)
        await this._loadPatterns();

        // Detect Editor-Only Mode
        const params = new URLSearchParams(window.location.search);
        this.isEditorWindow = params.get('mode') === 'editor';
        
        if (this.isEditorWindow) {
            document.body.classList.add('editor-window-mode');
            // Hide simulation canvases
            const canvases = ['matrixCanvas', 'overlayCanvas'];
            canvases.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            
            // Minimal UI Init
            this.fontMgr = new FontManager(this.config, this.notifications);
            this.charSelector = new CharacterSelectorModal(this.config, this.fontMgr, this.notifications);
            this.ui = new UIManager(this.config, this.effectRegistry, this.fontMgr, this.notifications, this.charSelector);
            
            await this.fontMgr.init();
            
            // Force open Quantized Editor in standalone mode
            if (this.ui && typeof QuantizedEffectEditor !== 'undefined') {
                this.ui.quantEditor = new QuantizedEffectEditor(this.effectRegistry, this.ui);
                this.ui.quantEditor.isStandalone = true;
                this.ui.quantEditor.toggle(true);
            }

            window.addEventListener('beforeunload', () => {
                if (this.ui && this.ui.quantEditor) {
                    this.ui.quantEditor.channel.postMessage({ type: 'bye' });
                }
            });
            return;
        }

        // Standard Application initialization
        await this._initializeRendererAndUI();

        // Perform the initial resize setup and start the loop
        this._resize();
        requestAnimationFrame((time) => this._loop(time));
        this.fpsDisplayElement = document.getElementById('fps-counter');

        // Handle Page Visibility to prevent catch-up delays when returning from background
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // Reset timing to prevent "catch-up" hang
                this.lastTime = performance.now();
                this.accumulator = 0;
                if (this.config.state.logErrors) console.log("[MatrixKernel] Tab visible. Timing reset to prevent hang.");
            }
        });

        // Trigger Boot Sequence on startup if enabled
        if (this.config.get('bootSequenceEnabled')) {
            // Short delay to ensure everything is ready
            setTimeout(() => {
                this.effectRegistry.trigger('BootSequence');
            }, 100);
        }
    }

    /**
     * Loads external pattern data for effects.
     * @private
     */
    async _loadPatterns() {
        if (window.matrixPatterns) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'js/effects/QuantizedPatterns.js';
            script.onload = () => {
                if (this.config.state.logErrors) console.log("Patterns loaded successfully.");
                resolve();
            };
            script.onerror = () => {
                if (this.config.state.logErrors) console.warn("Failed to load patterns from js/effects/QuantizedPatterns.js");
                resolve(); // Resolve anyway to allow app to start
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Initializes core managers (Notification, Config, Grid, Simulation, EffectRegistry).
     * @private
     */
    _initializeManagers() {
        this.config = new ConfigurationManager();
        this.config.clearShaderState(); // Ensure clean shader state on every load
        this.notifications = new NotificationManager(this.config);
        this.config.setNotificationManager(this.notifications);

        // --- Ping-Pong Architecture: Dual World Setup ---
        // World 0 (Default Primary)
        const grid0 = new CellGrid(this.config);
        const sim0 = new SimulationSystem(grid0, this.config, true); // Enable worker for primary
        
        // World 1 (Default Secondary/Shadow)
        const grid1 = new CellGrid(this.config);
        const sim1 = new SimulationSystem(grid1, this.config, false); // No worker for shadow to save resources
        
        this.worlds = [
            { grid: grid0, sim: sim0 },
            { grid: grid1, sim: sim1 }
        ];
        
        this.activeWorldIndex = 0;
        this.grid = grid0;
        this.simulation = sim0;

        this.effectRegistry = new EffectRegistry(this.grid, this.config);
    }

    get activeWorld() { return this.worlds[this.activeWorldIndex]; }
    get inactiveWorld() { return this.worlds[1 - this.activeWorldIndex]; }

    /**
     * Instantly swaps the Primary and Secondary worlds.
     * Used by Quantized effects to commit their reveal.
     */
    swapWorlds() {
        this.activeWorldIndex = 1 - this.activeWorldIndex;
        const active = this.activeWorld;
        
        this.grid = active.grid;
        this.simulation = active.sim;
        
        // Update components that rely on grid references
        if (this.effectRegistry) this.effectRegistry.setGrid(this.grid);
        if (this.renderer) this.renderer.setGrid(this.grid);
        
        if (this.config.state.logErrors) console.log(`[MatrixKernel] World Swap! New Active Index: ${this.activeWorldIndex}`);
    }

    /**
     * Registers all active visual effects with the EffectRegistry using a data-driven approach.
     * @private
     */
    _initializeEffects() {
        if (typeof ConfigTemplate !== 'undefined') {
            this.effectRegistry.autoRegister(ConfigTemplate);
        } else {
            if (this.config.state.logErrors) console.error("ConfigTemplate not found. Cannot auto-register effects.");
        }
    }

    /**
     * Initializes the CanvasRenderer, FontManager, and UIManager.
     * @private
     */
    async _initializeRendererAndUI() {
        if (typeof WebGLRenderer !== 'undefined') {
            try {
                this.renderer = new WebGLRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry);
            } catch (e) {
                if (this.config.state.logErrors) console.error("[MatrixKernel] WebGLRenderer initialization failed:", e);
                this.renderer = null;
            }
        } else {
             if (this.config.state.logErrors) console.error("WebGLRenderer not found. Application cannot start.");
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
    }

    /**
     * Sets up listeners to detect user inactivity and pause the simulation if configured.
     * @private
     */
    _setupIdleDetection() {
        const resetIdle = () => {
            if (this.isIdle) {
                this.isIdle = false;
                // If we were paused due to idle, reset timing to prevent catch-up
                if (this.config.state.pauseWhenIdle) {
                    this.lastTime = performance.now();
                    this.accumulator = 0;
                }
            }
            clearTimeout(this._idleTimer);
            // Idle after 5 minutes of no input
            this._idleTimer = setTimeout(() => {
                this.isIdle = true;
            }, 5 * 60 * 1000); 
        };

        window.addEventListener('mousemove', resetIdle);
        window.addEventListener('keydown', resetIdle);
        window.addEventListener('mousedown', resetIdle);
        window.addEventListener('touchstart', resetIdle);
        resetIdle();
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

            // Master Switch for Keybinds
            if (!this.config.state.enableKeybinds) return;

            let matched = false;
            for (const [action, boundKey] of Object.entries(bindings)) {
                if (boundKey && boundKey.toLowerCase() === key) {
                    matched = true;
                    if (action === 'ToggleUI') {
                        this.ui.togglePanel();
                    } else if (action === 'BootSequence' || action === 'CrashSequence') { 
                        this.effectRegistry.trigger(action, true);
                        this.notifications.show(`${action} Triggered`, 'success');
                    }
                    else {
                        // Compatibility for renamed effect
                        let targetAction = action;
                        if (action === 'QuantizedGenerateV2' || action === 'quantizedGenerateV2') {
                            targetAction = 'QuantizedBlockGenerator';
                        }

                        // Block quantized effects if editor is active
                        const isQuantized = targetAction.startsWith('Quantized');
                        const editorActive = this.ui && this.ui.quantEditor && this.ui.quantEditor.active;
                        
                        if (!(isQuantized && editorActive)) {
                            // Always force execution via keybind, overriding "Automatic Enabled" toggles
                            if (this.effectRegistry.trigger(targetAction, true)) {
                                const label = targetAction.replace(/([A-Z])/g, ' $1').trim();
                                this.notifications.show(`${label} Triggered`, 'success');
                            }
                        }
                    }
                }
            }
            if (matched) e.preventDefault();
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
            'verticalSpacingFactor'
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
            if (speedTriggers.has(key) || key === 'ALL') {
                if (this.worlds) {
                    this.worlds.forEach(w => {
                        if (w.sim && w.sim.streamManager) w.sim.streamManager.recalculateSpeeds();
                    });
                }
            }

            // Update renderer when smoothing settings change
            if (smoothingTriggers.has(key) && this.renderer) {
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
                { enabledKey: 'quantizedClimbEnabled', frequencyKey: 'quantizedClimbFrequencySeconds', effectName: 'QuantizedClimb' },
                { enabledKey: 'quantizedZoomEnabled', frequencyKey: 'quantizedZoomFrequencySeconds', effectName: 'QuantizedZoom' },
                { enabledKey: 'quantizedGenerateV2Enabled', frequencyKey: 'quantizedGenerateV2FrequencySeconds', effectName: 'QuantizedBlockGenerator' },
                { enabledKey: 'crashEnabled', frequencyKey: 'crashFrequencySeconds', effectName: 'CrashSequence' }
            ];

            autoEffects.forEach(effect => {
                if ((key === effect.enabledKey && this.config.state[effect.enabledKey]) || key === 'ALL') {
                    const minFrequencyFrames = this._getMinFrequencyFrames(effect.effectName, effect.frequencyKey);
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
     * Calculates the minimum frequency in frames, handling the "Random" (500s) special case for Quantized effects.
     * @private
     * @param {string} effectName - The name of the effect.
     * @param {string} frequencyKey - The configuration key for the frequency.
     * @returns {number} The calculated frequency in frames.
     */
    _getMinFrequencyFrames(effectName, frequencyKey) {
        let seconds = this.config.state[frequencyKey];
        if (seconds === 500) {
            seconds = Utils.randomInt(50, 500);
        }
        return seconds * 60;
    }

    /**
     * Resizes the grid and renderer dimensions based on current window size and configuration.
     * @private
     */
    _resize() {
        if (this.config.state.logErrors) console.log("[MatrixKernel] Resize Event Triggered.");
        this._lastResetReason = "Resize: " + new Date().toLocaleTimeString();
        const s = this.config.state;
        const d = this.config.derived;

        // 1. Calculate Logical Dimensions (accounting for Stretch)
        const logicalW = window.innerWidth / s.stretchX;
        const logicalH = window.innerHeight / s.stretchY;

        // 2. Snap Logic: Adjust Derived Cell Size to fit Width perfectly
        // Calculate target Cell Width based on User Settings
        const hFactor = Math.max(0.5, s.horizontalSpacingFactor);
        const targetCellW = s.fontSize * hFactor;
        
        // Calculate number of columns that fit closest to logical width
        // Ensure at least 1 column
        const cols = Math.max(1, Math.round(logicalW / targetCellW));
        
        // Calculate Exact Snapped Cell Width (This ensures Width / CellWidth = Integer)
        const snappedCellW = logicalW / cols;
        
        // Calculate Scale Ratio to maintain Aspect Ratio
        const ratio = snappedCellW / targetCellW;

        // Update Derived Config (Runtime Override)
        // This ensures Grid and Renderer use the snapped values
        d.cellWidth = snappedCellW;
        
        // Adjust Cell Height to maintain Font Aspect Ratio
        const vFactor = Math.max(0.5, s.verticalSpacingFactor);
        const targetCellH = s.fontSize * vFactor;
        d.cellHeight = targetCellH * ratio;

        // 3. Resize All Grids
        this.worlds.forEach(w => w.grid.resize(logicalW, logicalH));
        
        if (this.renderer) {
            this.renderer.resize();
        }

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
        // Handle optional pausing
        const shouldPause = (document.hidden && this.config.state.pauseWhenHidden) || 
                            (this.isIdle && this.config.state.pauseWhenIdle);

        if (shouldPause) {
            requestAnimationFrame((nextTime) => this._loop(nextTime));
            return;
        }

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
                         
                         // Debug: QuantizedBlockGenerator Internal Lines
                         const qGenV2 = this.effectRegistry.get('QuantizedBlockGenerator');
                         if (qGenV2 && qGenV2.active && qGenV2.debugInternalCount !== undefined) {
                             text += ` | IntLines: ${qGenV2.debugInternalCount}`;
                         }
                         text += ` | Reset: ${this._lastResetReason}`;
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
        let delta = time - this.lastTime;
        this.lastTime = time;

        // CAP DELTA to prevent massive catch-up loops (e.g. after backgrounding or system sleep)
        // If the gap is more than 500ms, just reset to avoid a "fast-forward" effect and hang.
        const maxDelta = 500;
        if (delta > maxDelta) {
            if (this.config.state.logErrors) console.warn(`[MatrixKernel] Large frame delta detected (${Math.round(delta)}ms). Capping to prevent hang.`);
            delta = this.timestep; // Reset to a single frame's worth of time
        }

        this.accumulator += delta;
        while (this.accumulator >= this.timestep) {
            this._updateFrame();
            this.accumulator -= this.timestep;
        }

        if (this.renderer) {
            this.renderer.render(this.frame);
        }

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
        
        // Update both worlds independently
        this.worlds.forEach(w => w.sim.update(this.frame));

        const autoEffects = [
            { enabledKey: 'pulseEnabled', frequencyKey: 'pulseFrequencySeconds', effectName: 'Pulse' },
            { enabledKey: 'clearPulseEnabled', frequencyKey: 'clearPulseFrequencySeconds', effectName: 'ClearPulse' },
            { enabledKey: 'miniPulseEnabled', frequencyKey: 'miniPulseFrequencySeconds', effectName: 'MiniPulse' },
            { enabledKey: 'dejaVuEnabled', frequencyKey: 'dejaVuFrequencySeconds', effectName: 'DejaVu' },
            { enabledKey: 'supermanEnabled', frequencyKey: 'supermanFrequencySeconds', effectName: 'Superman' },
            { enabledKey: 'quantizedPulseEnabled', frequencyKey: 'quantizedPulseFrequencySeconds', effectName: 'QuantizedPulse' },
            { enabledKey: 'quantizedAddEnabled', frequencyKey: 'quantizedAddFrequencySeconds', effectName: 'QuantizedAdd' },
            { enabledKey: 'quantizedRetractEnabled', frequencyKey: 'quantizedRetractFrequencySeconds', effectName: 'QuantizedRetract' },
            { enabledKey: 'quantizedClimbEnabled', frequencyKey: 'quantizedClimbFrequencySeconds', effectName: 'QuantizedClimb' },
            { enabledKey: 'quantizedZoomEnabled', frequencyKey: 'quantizedZoomFrequencySeconds', effectName: 'QuantizedZoom' },
            { enabledKey: 'quantizedGenerateV2Enabled', frequencyKey: 'quantizedGenerateV2FrequencySeconds', effectName: 'QuantizedBlockGenerator' },
            { enabledKey: 'crashEnabled', frequencyKey: 'crashFrequencySeconds', effectName: 'CrashSequence' }
        ];

        const isEditorActive = this.config.get('quantEditorEnabled') === true;

        autoEffects.forEach(effect => {
            if (this.config.state[effect.enabledKey]) {
                if (!this._effectTimers[effect.effectName]) {
                    // Initialize timer with randomization if not already set
                    const minFrequencyFrames = this._getMinFrequencyFrames(effect.effectName, effect.frequencyKey);
                    const randomOffsetFrames = Utils.randomInt(0, minFrequencyFrames * 0.5); // Up to 50% random offset
                    this._effectTimers[effect.effectName] = minFrequencyFrames + randomOffsetFrames;
                }

                if (!isEditorActive) {
                    this._effectTimers[effect.effectName]--;

                    if (this._effectTimers[effect.effectName] <= 0) {
                        this.effectRegistry.trigger(effect.effectName);
                        // Reset timer with randomization
                        const minFrequencyFrames = this._getMinFrequencyFrames(effect.effectName, effect.frequencyKey);
                        const randomOffsetFrames = Utils.randomInt(0, minFrequencyFrames * 0.5);
                        this._effectTimers[effect.effectName] = minFrequencyFrames + randomOffsetFrames;
                    }
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

