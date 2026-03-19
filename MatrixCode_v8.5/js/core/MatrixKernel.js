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
        this._lastResetReason = "Startup"; // Track last reset
        this._justResumed = false; // Flag to suppress catch-up warnings on first frame after resume

        // Resize guard state (initialized so first resize always proceeds)
        this._lastWindowW = 0;
        this._lastWindowH = 0;
        this._wasOverlayActive = false;

        // Idle Detection State
        this.isIdle = false;
        this._idleTimer = null;
        this._setupIdleDetection();

        this._setupResizeListener();
        this._setupInputListener();
        this._setupTapToSpawn();

        // FPS tracking variables
        this.lastFrameTime = 0; // Tracks time of the previous frame
        this._fpsBuffer    = new Float32Array(30); // Circular buffer — avoids push/shift/reduce per frame
        this._fpsBufferIdx = 0;
        this._fpsBufferSum = 0;
        this._fpsBufferCount = 0;
        this.fpsDisplayElement = null; // Holds reference to the HTML element
        this._lastDebugUpdateTime = 0;
        this._cachedDebugText = "";

        // Pre-bind the animation loop to avoid per-frame closure allocation
        this._boundLoop = (time) => this._loop(time);

        // Configuration subscription for dynamic updates
        this._setupConfigSubscriptions();
    }

    async initAsync() {
        // Asynchronous initialization steps (Patterns are needed for editor too)
        await this._loadPatterns();

        // Detect Editor-Only Mode
        const params = new URLSearchParams(window.location.search);
        this.isEditorWindow = params.get('mode') === 'editor';
        
        if (this.isEditorWindow) {
            // Remove loading screen immediately in editor mode
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) loadingOverlay.remove();

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
        // Delay initialization slightly to ensure the DOM and WebGL context are ready (Safari fix)
        // Increased delay to 500ms for Safari stability
        await new Promise(resolve => setTimeout(resolve, 500));

        // Hide loading overlay immediately when Skip Intro is enabled,
        // before any heavy init work makes it visible for frames.
        if (this.config.get('skipIntro')) {
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        }

        // Ensure canvas has dimensions before context acquisition
        const mainCanvas = document.getElementById('matrixCanvas');
        if (mainCanvas) {
            mainCanvas.width = window.innerWidth;
            mainCanvas.height = window.innerHeight;
        }

        await this._initializeRendererAndUI();

        // Perform the initial resize setup and start the loop
        this._resize();

        // --- GPU SHADER WARM-UP (GUARANTEED) ---
        // Force-compile all WebGL shader programs immediately after resize so
        // FBOs are configured.  This eliminates 186-243ms per-program GPU stalls
        // on the first draw call, regardless of whether chunked preallocation
        // succeeds or fails.
        if (this.renderer && typeof this.renderer.warmUpGPU === 'function') {
            const gpuT0 = performance.now();
            this.renderer.warmUpGPU();
            console.log(`[MatrixKernel] GPU warm-up took ${(performance.now() - gpuT0).toFixed(1)}ms`);
        } else {
            console.warn('[MatrixKernel] No renderer.warmUpGPU available — GPU warm-up skipped');
        }

        this.fpsDisplayElement = document.getElementById('fps-counter');

        // --- DETERMINISTIC CHUNKED PREALLOCATION ---
        // Instead of racing requestIdleCallback against the first trigger, we run
        // preallocation in small chunks across multiple rAF frames BEFORE starting
        // the simulation loop.  The loading screen stays visible until complete.
        await this._chunkedPreallocate();

        // Preallocation complete — transition loading screen and start loop
        if (this.config.get('skipIntro')) {
            this._removeLoadingScreen();
        } else {
            this._transitionLoadingScreen();
        }

        requestAnimationFrame(this._boundLoop);

        // Cleanup WebGL on unload to help Safari free up context slots
        window.addEventListener('beforeunload', () => {
            if (this.renderer && typeof this.renderer.dispose === 'function') {
                this.renderer.dispose();
            }
        });

        // Handle Page Visibility to prevent catch-up delays when returning from background
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // Reset timing to prevent "catch-up" hang
                this.lastTime = performance.now();
                this.lastFrameTime = performance.now();
                this.accumulator = 0;
                this._justResumed = true; // Flag to suppress warning on first frame back
                if (this.config.state.logErrors) console.log("[MatrixKernel] Tab visible. Timing reset to prevent hang.");
            }
        });

        // Trigger Boot Sequence on startup if enabled (skip when Skip Intro is on)
        if (this.config.get('bootSequenceEnabled') && !this.config.get('skipIntro')) {
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
        const sim1 = new SimulationSystem(grid1, this.config, true); // Enable worker for shadow too
        
        this.worlds = [
            { grid: grid0, sim: sim0 },
            { grid: grid1, sim: sim1 }
        ];
        
        this.activeWorldIndex = 0;
        this.grid = grid0;
        this.simulation = sim0;

        this.effectRegistry = new EffectRegistry(this.grid, this.config);
    }

    _logError(...args) {
        if (this.config.state.logErrors) console.error(...args);
    }

    get activeWorld() { return this.worlds[this.activeWorldIndex]; }
    get inactiveWorld() { return this.worlds[1 - this.activeWorldIndex]; }

    /**
     * Instantly swaps the Primary and Secondary worlds.
     * Used by Quantized effects to commit their reveal.
     */
    swapWorlds() {
        this.activeWorldIndex = (this.activeWorldIndex + 1) % 2;
        const active = this.worlds[this.activeWorldIndex];

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
            this._logError("ConfigTemplate not found. Cannot auto-register effects.");
        }
    }

    /**
     * Initializes the CanvasRenderer, FontManager, and UIManager.
     * @private
     */
    async _initializeRendererAndUI() {
        if (typeof WebGLRenderer !== 'undefined') {
            let success = false;
            let retries = 0;
            const maxRetries = 3;
            
            while (retries < maxRetries && !success) {
                try {
                    // Vary options on retries
                    const options = {
                        alpha: (retries % 2 === 0), // Toggle alpha
                        antialias: false,
                        depth: false,
                        stencil: false,
                        preserveDrawingBuffer: false
                    };
                    
                    if (this.config.state.logErrors) console.log(`[MatrixKernel] WebGL Initialization attempt ${retries + 1}/${maxRetries}...`);
                    
                    this.renderer = new WebGLRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry, options);
                    
                    if (this.effectRegistry) {
                        this.effectRegistry.setRenderer(this.renderer);
                    }
                    success = true;
                    if (this.config.state.logErrors) console.log(`[MatrixKernel] WebGL Renderer initialized successfully on attempt ${retries + 1}.`);
                } catch (e) {
                    retries++;
                    this._logError(`[MatrixKernel] WebGL attempt ${retries} failed:`, e.message);

                    if (retries < maxRetries) {
                        // Wait longer between retries
                        await new Promise(resolve => setTimeout(resolve, 500 * retries));
                    } else {
                        this._logError("[MatrixKernel] All WebGL initialization attempts failed.");
                        if (this.notifications) {
                            this.notifications.show("Critical Error: WebGL failed to initialize. Your browser may not support the required features.", "error");
                        }
                        this.renderer = null;
                    }
                }
            }
        } else {
             this._logError("WebGLRenderer not found. Application cannot start.");
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
            resizeTimer = setTimeout(() => {
                // Guard: skip if dimensions haven't actually changed (e.g. color picker popup firing spurious resize events)
                const w = window.innerWidth;
                const h = window.innerHeight;
                if (w === this._lastWindowW && h === this._lastWindowH) return;
                this._resize();
            }, 100);
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
     * Sets up Tap to Spawn: click/touch on canvas triggers quantized effects at that location.
     * @private
     */
    _setupTapToSpawn() {
        this._tapToSpawnIndex = 0;

        // Static list — reused on every tap to avoid per-tap array allocation
        const quantizedEffects = [
            { name: 'QuantizedPulse', prefix: 'quantizedPulse' },
            { name: 'QuantizedAdd', prefix: 'quantizedAdd' },
            { name: 'QuantizedRetract', prefix: 'quantizedRetract' },
            { name: 'QuantizedClimb', prefix: 'quantizedClimb' },
            { name: 'QuantizedZoom', prefix: 'quantizedZoom' },
            { name: 'QuantizedBlockGenerator', prefix: 'quantizedGenerateV2' }
        ];

        const handleTap = (clientX, clientY) => {
            if (!this.config.state.tapToSpawnEnabled) return;

            const eligible = quantizedEffects.filter(e =>
                this.config.state[e.prefix + 'Enabled'] &&
                this.config.state[e.prefix + 'TapToSpawn']
            );
            if (eligible.length === 0) return;

            // Cycle through eligible effects
            this._tapToSpawnIndex = this._tapToSpawnIndex % eligible.length;
            const chosen = eligible[this._tapToSpawnIndex];
            this._tapToSpawnIndex = (this._tapToSpawnIndex + 1) % eligible.length;

            // Convert screen coordinates to block-grid position
            const d = this.config.derived;
            const s = this.config.state;
            const bs = this.effectRegistry.get(chosen.name);
            if (!bs) return;
            const blockSize = bs.getBlockSize ? bs.getBlockSize() : { w: 4, h: 4 };
            const cellW = d.cellWidth || 14;
            const cellH = d.cellHeight || 28;

            // Convert viewport pixel position to block-grid coordinates
            // cellW/cellH are in logical (post-stretch) space, so divide by stretch to convert
            const bx = clientX / (cellW * blockSize.w * s.stretchX);
            const by = clientY / (cellH * blockSize.h * s.stretchY);

            this.effectRegistry.trigger(chosen.name, true, { bx, by, x: clientX, y: clientY });
        };

        // Click handler on the canvas
        document.addEventListener('click', (e) => {
            // Don't trigger if clicking on UI elements
            if (e.target.closest('#settingsPanel') || e.target.closest('#menuToggle') || e.target.closest('.ui-overlay') || e.target.closest('button')) return;
            handleTap(e.clientX, e.clientY);
        });

        // Touch handler
        document.addEventListener('touchend', (e) => {
            if (e.target.closest('#settingsPanel') || e.target.closest('#menuToggle') || e.target.closest('.ui-overlay') || e.target.closest('button')) return;
            if (e.changedTouches && e.changedTouches.length > 0) {
                const touch = e.changedTouches[0];
                handleTap(touch.clientX, touch.clientY);
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
                    for (let i = 0; i < this.worlds.length; i++) {
                        const w = this.worlds[i];
                        if (w.sim && w.sim.streamManager) w.sim.streamManager.recalculateSpeeds();
                    }
                }
            }

            // Update renderer when smoothing settings change
            if ((smoothingTriggers.has(key) || key === 'ALL') && this.renderer) {
                this.renderer.updateSmoothing();
            }

            // Update Atlas if appearance changes (WebGL optimization)
            if ((atlasTriggers.has(key) || key === 'ALL') && this.renderer && this.renderer.handleAppearanceChange) {
                this.renderer.handleAppearanceChange();
            }
        });
    }

    /**
     * Resizes the grid and renderer dimensions based on current window size and configuration.
     * @private
     */
    _resize() {
        this._lastWindowW = window.innerWidth;
        this._lastWindowH = window.innerHeight;
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
        this.worlds[0].grid.resize(logicalW, logicalH);
        this.worlds[1].grid.resize(logicalW, logicalH);
        
        if (this.renderer) {
            this.renderer.resize();
        }

        if (this.overlayCanvas) {
            this.overlayCanvas.width = window.innerWidth;
            this.overlayCanvas.height = window.innerHeight;
        }
    }

    /**
     * Runs effect preallocation in chunked steps across rAF frames to avoid
     * blocking the main thread.  Returns a Promise that resolves when all
     * chunks are complete.  The loading overlay dot animation runs in parallel.
     * @private
     */
    async _chunkedPreallocate() {
        const overlay = document.getElementById('loadingOverlay');

        // Skip Intro: hide the overlay immediately so "The Matrix Has You" is never visible
        if (this.config.get('skipIntro')) {
            if (overlay) overlay.style.display = 'none';
        } else if (overlay) {
            // Tint loading screen to match the user's configured stream color
            const streamColor = this.config.state.streamColor || '#65d778';
            overlay.style.color = streamColor;
            overlay.style.textShadow = `0 0 8px ${streamColor}44, 0 0 20px ${streamColor}44`;
            // Start the ellipsis animation on the loading overlay
            this._startLoadingDots();
        }

        // Yield a frame so the loading screen paints before we start heavy work
        await new Promise(r => requestAnimationFrame(r));

        const log = this.config.state.logErrors;
        const t0 = performance.now();

        // Find the first QuantizedBaseEffect instance via duck-typing
        let qfx = null;
        if (this.effectRegistry && this.effectRegistry.effects) {
            const effects = this.effectRegistry.effects;
            for (let i = 0; i < effects.length; i++) {
                if (typeof effects[i]._initLogicGrid === 'function') {
                    qfx = effects[i];
                    break;
                }
            }
        }

        if (log) console.log(`[MatrixKernel] Prealloc guard: qfx=${!!qfx}, grid.cols=${this.grid.cols}, effects.length=${this.effectRegistry ? this.effectRegistry.effects.length : 'N/A'}`);

        if (!qfx) {
            if (log) console.warn('[MatrixKernel] No QuantizedBaseEffect found, skipping chunked preallocation.');
            return;
        }
        if (!this.grid.cols) {
            if (log) console.warn('[MatrixKernel] Grid cols=0 after resize, skipping chunked preallocation.');
            return;
        }

        // Helper: run a chunk and yield a frame for the loading animation to update
        const chunk = async (label, fn) => {
            try { fn(); }
            catch (e) { if (log) console.warn(`[MatrixKernel] Prealloc ${label} error:`, e.message); }
            if (log) console.log(`[MatrixKernel] Prealloc ${label} ${(performance.now() - t0).toFixed(1)}ms`);
            await new Promise(r => requestAnimationFrame(r));
        };

        const w = window.innerWidth;
        const h = window.innerHeight;
        const s = this.config.state;
        const d = this.config.derived;

        if (log) console.log(`[MatrixKernel] Prealloc starting: qfx.g.cols=${qfx.g ? qfx.g.cols : 'no grid'}, w=${w}, h=${h}`);

        // Chunk 1: Logic grids + canvases
        await chunk('grids+canvases', () => {
            qfx._initLogicGrid();
            if (typeof qfx._ensureCanvases === 'function') qfx._ensureCanvases(w, h);
        });

        // Chunk 2: Render grid logic (shared buffers)
        await chunk('renderGridLogic', () => {
            if (typeof qfx._updateRenderGridLogic === 'function') qfx._updateRenderGridLogic();
        });

        // Chunk 3: Shadow world buffers
        await chunk('shadow', () => {
            if (qfx.shadowController && typeof qfx.shadowController.initShadowWorldBase === 'function') {
                qfx.shadowController.initShadowWorldBase(qfx);
            }
        });

        // Chunk 4: GlyphAtlas pre-warm
        await chunk('glyphAtlas', () => {
            if (typeof GlyphAtlas !== 'undefined') {
                if (!QuantizedBaseEffect.sharedAtlas) {
                    QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.config);
                }
                QuantizedBaseEffect.sharedAtlas.update();
            }
        });

        // Chunk 5: Layout + grid cache warm-up
        await chunk('layout', () => {
            if (qfx.renderer && typeof qfx.renderer._computeLayoutOnly === 'function') {
                qfx.renderer._computeLayoutOnly(qfx, w, h, s, d);
            }
        });
        await chunk('gridCache', () => qfx._updateGridCache(w, h, s, d));

        // Chunk 6: WebGL renderer buffers + GPU shader warm-up
        await chunk('webglBuffers', () => {
            const renderer = this.renderer;
            if (renderer && typeof renderer.preallocate === 'function') {
                renderer.preallocate(
                    qfx.logicGridW, qfx.logicGridH,
                    s.renderingEngine !== 'webgl' ? qfx.gridCacheCanvas : null
                );
            }
        });

        // Mark preallocation complete so trigger() never re-runs it
        QuantizedBaseEffect._preallocated = true;

        // Chunk 7: Hidden render pass — exercises the FULL quantized GPU pipeline
        // behind the loading screen.  This forces ALL first-time initialization:
        // Metal PSO compilation, JIT compilation of render methods, texture format
        // conversions, buffer layout validation, etc.  Without this, the first
        // REAL trigger causes a 500-700ms stall because the GPU encounters these
        // code paths for the first time.
        await chunk('hiddenRender', () => {
            const renderer = this.renderer;
            if (!renderer || !renderer.gl || !renderer._renderQuantizedLineGfx) return;

            const gl = renderer.gl;

            // Temporarily mark the effect as active so the render path finds it
            qfx.active = true;

            // Run the quantized render pipeline once (draws to FBOs behind loading overlay)
            renderer._renderQuantizedLineGfx(s, d, renderer.texA, renderer.fboA2);

            // Force GPU to complete ALL queued work (PSO compilation, texture uploads, etc.)
            gl.finish();

            // Clean up: clear every FBO the quantized pipeline wrote to
            gl.clearColor(0, 0, 0, 0);
            const fbos = [renderer.fboLinePersist, renderer.fboEchoLinePersist,
                          renderer.fboA2, renderer.fboCodeProcessed];
            for (const fbo of fbos) {
                if (!fbo) continue;
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // Reset renderer tracking so the first real render starts clean
            renderer.lastRenderedFx = null;
            renderer.lastLogicGridWidth = 0;
            renderer.lastLogicGridHeight = 0;
            renderer.lastEchoGridWidth = 0;
            renderer.lastEchoGridHeight = 0;
            renderer.lastEchoStepCaptured = -1;
            renderer._quantizedRenderCalled = false; // Reset so profiling captures first REAL render
            if (typeof renderer._clearEchoHistory === 'function') renderer._clearEchoHistory();

            // Deactivate the effect
            qfx.active = false;
        });

        if (log) console.log(`[MatrixKernel] Chunked preallocation complete in ${(performance.now() - t0).toFixed(1)}ms`);
    }

    /**
     * Animates the loading overlay ellipsis (1 dot, 2 dots, 3 dots, repeat).
     * @private
     */
    _startLoadingDots() {
        const dotsEl = document.getElementById('loadingDots');
        if (!dotsEl) return;
        let count = 0;
        this._dotsInterval = setInterval(() => {
            count = (count + 1) % 4;
            dotsEl.textContent = '.'.repeat(count);
        }, 400);
    }

    /**
     * Immediately removes the loading screen without any transition.
     * Used when Skip Intro is enabled.
     * @private
     */
    _removeLoadingScreen() {
        clearInterval(this._dotsInterval);
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.remove();
    }

    /**
     * Transitions the loading screen: swap text to "Knock Knock, Neo",
     * then fade out the overlay while the first code starts falling.
     * @private
     */
    _transitionLoadingScreen() {
        const overlay = document.getElementById('loadingOverlay');
        const textEl = document.getElementById('loadingText');
        const dotsEl = document.getElementById('loadingDots');
        if (!overlay) return;

        // Hold the Loading... message briefly, then fade out
        setTimeout(() => {
            overlay.classList.add('fade-out');
            // Remove from DOM after transition completes
            overlay.addEventListener('transitionend', () => {
                // Stop dot animation and remove overlay
                clearInterval(this._dotsInterval);
                overlay.remove();
            }, { once: true });
            // Fallback removal if transitionend doesn't fire
            setTimeout(() => { 
                if (overlay.parentNode) {
                    clearInterval(this._dotsInterval);
                    overlay.remove();
                }
            }, 2000);
        }, 900);
    }

    /**
     * The main animation loop, handling updates and rendering.
     * Uses a fixed timestep for consistent simulation speed.
     * @private
     * @param {DOMHighResTimeStamp} time - The current time provided by requestAnimationFrame.
     */
    _loop(time) {
        const loopStartTime = performance.now();
        // Handle optional pausing
        const shouldPause = (document.hidden && this.config.state.pauseWhenHidden) ||
                            (this.isIdle && this.config.state.pauseWhenIdle);

        if (shouldPause) {
            this.lastTime = time;
            this.lastFrameTime = time;
            requestAnimationFrame(this._boundLoop);
            return;
        }

        // 1. Calculate Delta and FPS (use rAF time consistently to avoid clock skew)
        const deltaFPS = time - this.lastFrameTime;
        this.lastFrameTime = time;

        if (deltaFPS > 0 && this.config.state.showFpsCounter) {
            const fps = 1000 / deltaFPS;
            const slot = this._fpsBufferIdx % 30;
            this._fpsBufferSum -= this._fpsBuffer[slot];
            this._fpsBuffer[slot] = fps;
            this._fpsBufferSum += fps;
            this._fpsBufferIdx++;
            if (this._fpsBufferCount < 30) this._fpsBufferCount++;

            // Correct floating-point drift every 900 frames (30 full buffer cycles)
            if (this._fpsBufferIdx % 900 === 0) {
                let sum = 0;
                const len = Math.min(this._fpsBufferCount, 30);
                for (let i = 0; i < len; i++) sum += this._fpsBuffer[i];
                this._fpsBufferSum = sum;
            }

            const smoothedFps = this._fpsBufferSum / this._fpsBufferCount;

            // 2. Update Display
            if (this.fpsDisplayElement) {
                // Throttled Debug Metrics: Only recalculate heavy metrics every 30 frames
                // This eliminates per-frame iteration over activeIndices.
                const shouldUpdateDebug = this.config.state.debugEnabled && (this.frame % 30 === 0 || !this._cachedDebugText);

                if (shouldUpdateDebug) {
                    let debugText = "";
                    if (performance.memory) {
                        const used = Math.round(performance.memory.usedJSHeapSize / 1048576);
                        debugText += ` | Mem: ${used}MB`;
                    }
                    if (this.grid && this.grid.activeIndices) {
                        const cellCount = this.grid.activeIndices.size;
                        const sm = this.simulation.streamManager;
                        const streams = sm ? sm.activeStreams : [];

                        // Single-pass stream counting (avoids two filter() calls)
                        let tracers = 0, erasers = 0;
                        for (let i = 0; i < streams.length; i++) {
                            if (streams[i].isEraser) erasers++;
                            else if (!streams[i].isUpward) tracers++;
                        }

                        let rotators = 0;
                        for (const idx of this.grid.activeIndices) {
                            if ((this.grid.types[idx] & CELL_TYPE_MASK) === CELL_TYPE.ROTATOR) rotators++;
                        }
                        const shimmers = this.grid.complexStyles.size;

                        debugText += ` | Cells: ${cellCount}`;
                        debugText += ` | Tracers: ${tracers}`;
                        debugText += ` | Erasers: ${erasers}`;
                        debugText += ` | Rotators: ${rotators}`;
                        debugText += ` | Shimmers: ${shimmers}`;

                        const qGenV2 = this.effectRegistry.get('QuantizedBlockGenerator');
                        if (qGenV2 && qGenV2.active && qGenV2.debugInternalCount !== undefined) {
                            debugText += ` | IntLines: ${qGenV2.debugInternalCount}`;
                        }
                        debugText += ` | Reset: ${this._lastResetReason}`;
                    }
                    this._cachedDebugText = debugText;
                }

                this.fpsDisplayElement.textContent = `FPS: ${Math.round(smoothedFps)}${this.config.state.debugEnabled ? this._cachedDebugText : ""}`;
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
            // ONLY warn if NOT hidden and NOT just unhidden (Safari/Mobile backgrounding noise)
            if (this.config.state.logErrors && !document.hidden && !this._justResumed) {
                console.warn(`[MatrixKernel] Large frame delta detected (${Math.round(delta)}ms). Capping to prevent hang.`);
            }
            delta = this.timestep; // Reset to a single frame's worth of time
        }
        this._justResumed = false; // Reset flag after first check

        this.accumulator += delta;
        
        // LIMIT CATCH-UP to prevent thread-blocking cascades
        // Even if we are behind, we only run a maximum of 3 frames per loop.
        // This ensures the browser has a chance to render and process input.
        let framesToRun = Math.floor(this.accumulator / this.timestep);
        if (framesToRun > 3) framesToRun = 3; 

        const updateT0 = performance.now();
        for (let i = 0; i < framesToRun; i++) {
            this._updateFrame();
            this.accumulator -= this.timestep;
        }
        const updateTime = performance.now() - updateT0;

        // If we are still very far behind, cap the accumulator to avoid future stalls
        if (this.accumulator > this.timestep * 10) {
            this.accumulator = this.timestep;
        }

        const renderT0 = performance.now();
        if (this.renderer) {
            this.renderer.render(this.frame);
        }
        const renderTime = performance.now() - renderT0;

        // Render Overlay Effects (skip if no effects are active to avoid wasted clearRect)
        if (this.overlayCtx) {
            const hasActive = this.effectRegistry.hasActiveOverlay;
            // Always clear if something was active last frame (to wipe it out) or if currently active
            if (hasActive || this._wasOverlayActive) {
                this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                if (hasActive) {
                    this.effectRegistry.render(this.overlayCtx, this.config.derived);
                }
            }
            this._wasOverlayActive = hasActive;
        }

        if (this.config.state.logErrors) {
            const loopTime = performance.now() - loopStartTime;
            if (loopTime > 50) {
                console.log(`[MatrixKernel] Slow frame: ${loopTime.toFixed(1)}ms (update: ${updateTime.toFixed(1)}ms, render: ${renderTime.toFixed(1)}ms)`);
            }
        }

        requestAnimationFrame(this._boundLoop);
    }

    /**
     * Updates the simulation logic for a single frame.
     * @private
     */
    _updateFrame() {
        this.frame++;
        this.effectRegistry.update();

        // Update both worlds independently (unrolled to avoid per-frame closure)
        this.worlds[0].sim.update(this.frame);
        this.worlds[1].sim.update(this.frame);

        // Final application of visual overrides AFTER simulation
        this.effectRegistry.postUpdate();
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

