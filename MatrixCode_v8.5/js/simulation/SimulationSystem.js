class SimulationSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        
        // --- Web Worker Support ---
        this.worker = null;
        this.useWorker = false;
        this.workerBuffers = null; // Store current SABs

        // Check for SharedArrayBuffer support
        // Note: functionality requires secure context (HTTPS/localhost) and cross-origin isolation headers.
        if (typeof SharedArrayBuffer !== 'undefined') {
            try {
                // Test creation
                new SharedArrayBuffer(10);
                this.useWorker = true;
                console.log("[SimulationSystem] SharedArrayBuffer supported. Initializing Simulation Worker.");
            } catch (e) {
                console.warn("[SimulationSystem] SharedArrayBuffer defined but creation failed. Fallback to main thread.", e);
            }
        } else {
             console.log("[SimulationSystem] SharedArrayBuffer not supported. Fallback to main thread.");
        }

        if (this.useWorker) {
            this._initWorker();
            
            // Intercept Grid Resize to manage Shared Memory
            // This ensures MatrixKernel calls to grid.resize() trigger our memory management
            const originalResize = this.grid.resize.bind(this.grid);
            
            this.grid.resize = (width, height) => {
                // 1. Calculate Dimensions (Copied logic from CellGrid to know size)
                const d = this.config.derived;
                if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
                
                const cols = Math.max(1, (width / d.cellWidth) | 0);
                const rows = Math.max(1, (height / d.cellHeight) | 0);
                const total = cols * rows;

                // 2. Allocate Shared Buffers
                this.workerBuffers = this._createSharedBuffers(total);

                // 3. Resize Grid using Shared Buffers
                originalResize(width, height, this.workerBuffers);

                // 4. Update Worker
                this.worker.postMessage({
                    type: 'resize',
                    width: width,
                    height: height,
                    buffers: this.workerBuffers,
                    config: {
                        state: JSON.parse(JSON.stringify(this.config.state)),
                        derived: this.config.derived // Derived often has getters, ensure it's serializable or plain object?
                        // ConfigurationManager.derived is usually a proxy or object. 
                        // We might need to extract values if it's a Proxy.
                        // Assuming standard object for now or that structuredClone handles it.
                    }
                });
            };
        }

        this.streamManager = new StreamManager(grid, config);
        this.glowSystem = new GlowSystem(grid);
        this.grid.glowSystem = this.glowSystem; 
        
        this.overlapInitialized = false;
        this._lastOverlapDensity = null;
        this.timeScale = 1.0;
        
        // Subscribe to config changes to keep worker in sync
        if (this.useWorker) {
            this.config.subscribe((key) => {
                // Simple sync: send entire state on change. Optimized? No. Robust? Yes.
                // We avoid sending on 'resolution' changes here because 'resize' handles that.
                if (key !== 'resolution' && key !== 'stretchX' && key !== 'stretchY') {
                    this.worker.postMessage({
                        type: 'config',
                        config: {
                            state: JSON.parse(JSON.stringify(this.config.state)),
                            derived: this.config.derived
                        }
                    });
                }
            });
        }
    }

    _initWorker() {
        const embeddedWorker = document.getElementById('simulation-worker-source');
        
        if (embeddedWorker) {
            console.log("[SimulationSystem] Using embedded worker source.");
            const blob = new Blob([embeddedWorker.textContent], { type: 'text/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(workerUrl);
        } else {
            console.log("[SimulationSystem] Using external worker file.");
            this.worker = new Worker('js/simulation/SimulationWorker.js');
        }
        
        this.worker.onmessage = (e) => {
            // Handle messages from worker (e.g., debug logs, sync ticks)
            if (e.data.type === 'log') console.log('[Worker]', e.data.message);
        };
        
        // Initial setup message will be sent by the first resize() call 
        // which happens immediately in MatrixKernel.initAsync()
    }

    _createSharedBuffers(total) {
        // Helper to create a specific typed array view on a SAB
        const createSAB = (bytes) => new SharedArrayBuffer(bytes);
        
        // Align to 4 bytes for safety/performance
        const uint8Size = total;
        const uint16Size = total * 2;
        const uint32Size = total * 4;
        const float32Size = total * 4;
        const int32Size = total * 4;

        const buffers = {
            state: new Uint8Array(createSAB(uint8Size)),
            
            chars: new Uint16Array(createSAB(uint16Size)),
            colors: new Uint32Array(createSAB(uint32Size)),
            baseColors: new Uint32Array(createSAB(uint32Size)),
            alphas: new Float32Array(createSAB(float32Size)),
            glows: new Float32Array(createSAB(float32Size)),
            fontIndices: new Uint8Array(createSAB(uint8Size)),

            secondaryChars: new Uint16Array(createSAB(uint16Size)),
            secondaryColors: new Uint32Array(createSAB(uint32Size)),
            secondaryAlphas: new Float32Array(createSAB(float32Size)),
            secondaryGlows: new Float32Array(createSAB(float32Size)),
            secondaryFontIndices: new Uint8Array(createSAB(uint8Size)),

            mix: new Float32Array(createSAB(float32Size)),
            renderMode: new Uint8Array(createSAB(uint8Size)),

            overrideActive: new Uint8Array(createSAB(uint8Size)),
            overrideChars: new Uint16Array(createSAB(uint16Size)),
            overrideColors: new Uint32Array(createSAB(uint32Size)),
            overrideAlphas: new Float32Array(createSAB(float32Size)),
            overrideGlows: new Float32Array(createSAB(float32Size)),
            overrideMix: new Float32Array(createSAB(float32Size)),
            overrideNextChars: new Uint16Array(createSAB(uint16Size)),
            overrideFontIndices: new Uint8Array(createSAB(uint8Size)),

            effectActive: new Uint8Array(createSAB(uint8Size)),
            effectChars: new Uint16Array(createSAB(uint16Size)),
            effectColors: new Uint32Array(createSAB(uint32Size)),
            effectAlphas: new Float32Array(createSAB(float32Size)),
            effectFontIndices: new Uint8Array(createSAB(uint8Size)),
            effectGlows: new Float32Array(createSAB(float32Size)),

            types: new Uint8Array(createSAB(uint8Size)),
            decays: new Uint8Array(createSAB(uint8Size)),
            maxDecays: new Uint16Array(createSAB(uint16Size)),
            ages: new Int32Array(createSAB(int32Size)),
            brightness: new Float32Array(createSAB(float32Size)),
            rotatorOffsets: new Uint8Array(createSAB(uint8Size)),
            cellLocks: new Uint8Array(createSAB(uint8Size)),

            nextChars: new Uint16Array(createSAB(uint16Size)),
            nextOverlapChars: new Uint16Array(createSAB(uint16Size)),
            envGlows: new Float32Array(createSAB(float32Size))
        };
        
        return buffers;
    }

    update(frame) {
        if (this.config.state.simulationPaused) return;

        if (this.useWorker && this.worker) {
            // Offload to Worker
            this.worker.postMessage({
                type: 'update',
                frame: frame
            });
            // Main thread does NOTHING for simulation logic
            // It just renders whatever is in the SharedBuffers
        } else {
            // Fallback: Local Logic
            this.streamManager.update(frame, this.timeScale);
            this._manageOverlapGrid(frame);
            this._updateCells(frame, this.timeScale);
            
            // Local Glimmer Lifecycle (Copy-paste logic from Worker/Original)
            this._updateGlimmerLifecycle();

            if (this.grid.envGlows) this.grid.envGlows.fill(0);
            this.glowSystem.update();
            this.glowSystem.apply();

            if (this.grid.cellLocks) this.grid.cellLocks.fill(0);
        }
    }
    
    _updateGlimmerLifecycle() {
        const s = this.config.state;
        const d = this.config.derived;
        
        // We iterate over a copy of keys to safely mutate the map during iteration (for movement)
        const indices = Array.from(this.grid.complexStyles.keys());
        
        for (const idx of indices) {
            const style = this.grid.complexStyles.get(idx);
            if (!style) continue;

            // Pause Glimmer updates if cell is frozen by an effect (e.g. Pulse Pause)
            if (this.grid.effectActive[idx] !== 0 || this.grid.overrideActive[idx] !== 0) continue;

            // --- TYPE 1: STANDARD GLIMMER (Upward Tracers) ---
            if (style.type === 'glimmer') {
                // Initialize Mobility (One-time)
                if (style.mobile === undefined) {
                    // 20% chance to be a "Moving" glimmer
                    if (Math.random() < 0.2) {
                        style.mobile = true;
                        // Move every 4-8 frames
                        style.moveInterval = Utils.randomInt(4, 8);
                        style.nextMove = style.age + style.moveInterval;
                        // Direction: Strictly Up (-1)
                        style.moveDir = -1; 
                    } else {
                        style.mobile = false;
                    }
                }

                const attack = s.upwardTracerAttackFrames;
                const hold = s.upwardTracerHoldFrames;
                const release = s.upwardTracerReleaseFrames;
                const totalDuration = attack + hold + release;
                
                style.age++;
                const activeAge = style.age - 1;
                
                // --- Vertical Movement Logic ---
                let currentIdx = idx;
                if (style.mobile && activeAge >= style.nextMove && activeAge < totalDuration) {
                    const col = currentIdx % this.grid.cols;
                    const row = Math.floor(currentIdx / this.grid.cols);
                    const nextRow = row + style.moveDir;
                    
                    if (nextRow >= 0 && nextRow < this.grid.rows) {
                        const nextIdx = currentIdx + (style.moveDir * this.grid.cols);
                        
                        // Only move if target is not already a glimmer or locked
                        if (!this.grid.complexStyles.has(nextIdx)) {
                            // Move State
                            this.grid.complexStyles.set(nextIdx, style);
                            this.grid.complexStyles.delete(currentIdx);
                            
                            // Move Mix Value
                            this.grid.mix[nextIdx] = this.grid.mix[currentIdx];
                            this.grid.mix[currentIdx] = 0;
                            
                            // Move Effect Char (if any, though we forced 0 below, but good practice)
                            this.grid.effectChars[nextIdx] = this.grid.effectChars[currentIdx];
                            this.grid.effectChars[currentIdx] = 0;
                            
                            currentIdx = nextIdx;
                            style.nextMove = activeAge + style.moveInterval;
                        }
                    }
                }

                // Ensure we use the underlying character (Visual Highlight Only)
                this.grid.effectChars[currentIdx] = 0;

                // --- Lifecycle / Fade Logic ---
                let alpha = 0.0;

                if (activeAge <= attack) {
                    alpha = (attack > 0) ? (activeAge / attack) : 1.0;
                } else if (activeAge <= attack + hold) {
                    alpha = 1.0;
                } else if (activeAge <= totalDuration) {
                    const releaseAge = activeAge - (attack + hold);
                    alpha = (release > 0) ? (1.0 - (releaseAge / release)) : 0.0;
                }

                if (activeAge <= totalDuration) {
                    // Keep alive even if alpha is 0 (start of attack)
                    this.grid.mix[currentIdx] = 30.0 + alpha;
                } else {
                    this.grid.mix[currentIdx] = 0;
                    this.grid.complexStyles.delete(currentIdx);
                }
            }
            
            // --- TYPE 2: STAR POWER GLIMMER ---
            else if (style.type === 'star_glimmer') {
                // Static glimmer effect for Star Power streams.
                // Just force the shader signal (30.0) while the cell is active.
                // The stream lifecycle handles the cell death/cleanup.
                this.grid.mix[idx] = 30.0;
            }


        }
    }

    _manageOverlapGrid(frame) {
        const s = this.config.state;

        if (!s.overlapEnabled) {
            if (this.overlapInitialized) {
                this.overlapInitialized = false;
                if (this.grid.secondaryChars && typeof this.grid.secondaryChars.fill === 'function') {
                    this.grid.secondaryChars.fill(32); 
                }
            }
            return;
        }
        
        const activeFonts = this.config.derived.activeFonts;
        const numFonts = activeFonts.length;
        const currentDensity = s.overlapDensity;
        
        const ovRgb = Utils.hexToRgb(s.overlapColor);
        const ovColor = Utils.packAbgr(ovRgb.r, ovRgb.g, ovRgb.b);

        const setOverlapChar = (i) => {
            let fIdx;
            if ((this.grid.types[i] & CELL_TYPE_MASK) === CELL_TYPE.EMPTY) {
                fIdx = Math.floor(Math.random() * numFonts);
            } else {
                fIdx = this.grid.fontIndices[i];
            }
            
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            let code = 32;
            if (chars && chars.length > 0) {
                const r = Math.floor(Math.random() * chars.length);
                code = chars[r].charCodeAt(0);
            }
            
            this.grid.secondaryChars[i] = code;
            this.grid.secondaryColors[i] = ovColor;
        };

        if (!this.overlapInitialized || this._lastOverlapDensity !== currentDensity) {
            const N = this.grid.secondaryChars.length;
            for (let i = 0; i < N; i++) {
                // If cell is overridden (e.g. Pulse Freeze), do not change secondary char
                if (this.grid.overrideActive[i] !== 0) continue;

                if (Math.random() < currentDensity) {
                    setOverlapChar(i);
                } else {
                    this.grid.secondaryChars[i] = 32; 
                }
            }
            this.overlapInitialized = true;
            this._lastOverlapDensity = currentDensity;
        }
    }

    _updateCells(frame, timeScale = 1.0) {
        // Pause simulation updates if time is stopped or reversed
        if (timeScale <= 0) return;

        // Slow Motion: Probabilistic update for integer-based counters
        if (timeScale < 1.0) {
            if (Math.random() > timeScale) return;
        }

        const s = this.config.state;
        const d = this.config.derived;
        const grid = this.grid;

        for (const idx of grid.activeIndices) {
            this._updateCell(idx, frame, s, d);
        }
    }

    _updateCell(idx, frame, s, d) {
        const grid = this.grid;

        if (grid.cellLocks && grid.cellLocks[idx] === 1) return;
        // If an effect is overriding this cell, pause simulation updates (Freeze)
        if (grid.overrideActive[idx] !== 0) return;

        const decay = grid.decays[idx];
        if (decay === 0) return;

        let age = grid.ages[idx];
        if (age > 0) {
            age = this._incrementAge(age, d.maxState);
            grid.ages[idx] = age;
        }

        // --- TRACER COLOR FADE ---
        // Transitions from Tracer Color -> Stream Color based on Age
        // Only apply if NOT decaying (Erasers trigger decay)
        const type = grid.types[idx];
        const baseType = type & CELL_TYPE_MASK;
        const isGradual = (type & CELL_FLAGS.GRADUAL) !== 0;
        
        const isTracer = (baseType === CELL_TYPE.TRACER || baseType === CELL_TYPE.ROTATOR);
        const isUpward = (baseType === CELL_TYPE.UPWARD_TRACER);

        if (decay < 2 && isTracer) {
            const attack = s.tracerAttackFrames;
            const hold = s.tracerHoldFrames;
            const release = s.tracerReleaseFrames;
            const targetGlow = s.tracerGlow;
            
            const tracerColor = d.tracerColorUint32;
            const baseColor = grid.baseColors[idx];

            let ratio = 0; // 0 = Tracer, 1 = Base
            
            // Age 1..Attack: Fade In (Alpha handles this, color stays Tracer)
            // Attack..Attack+Hold: Hold Tracer Color
            // Attack+Hold..End: Fade to Stream Color
            
            const activeAge = age - 1;
            
            if (isGradual && !isUpward) {
                // Gradual Fade: Linearly interpolate over a long distance (e.g. 45 chars/frames)
                // Starts fading immediately after attack+hold
                const fadeStart = attack + hold;
                const fadeLen = 45.0; 
                
                if (activeAge > fadeStart) {
                    ratio = Math.min(1.0, (activeAge - fadeStart) / fadeLen);
                }
            } else {
                // Standard Logic
                if (activeAge > attack + hold) {
                    if (release > 0) {
                        ratio = Math.min(1.0, (activeAge - (attack + hold)) / release);
                    } else {
                        ratio = 1.0;
                    }
                }
            }
            
            if (ratio >= 1.0) {
                grid.colors[idx] = baseColor;
                grid.glows[idx] = 0; // Remove glow after transition
                // Only clear Glimmer (high mix values)
                // Rotators use mix 0..1, so preserve values < 2.0
                if (grid.mix[idx] >= 2.0) grid.mix[idx] = 0; 
            } else if (ratio > 0) {
                // Blend
                const tR = tracerColor & 0xFF;
                const tG = (tracerColor >> 8) & 0xFF;
                const tB = (tracerColor >> 16) & 0xFF;
                
                const bR = baseColor & 0xFF;
                const bG = (baseColor >> 8) & 0xFF;
                const bB = (baseColor >> 16) & 0xFF;
                
                const mR = Math.floor(tR + (bR - tR) * ratio);
                const mG = Math.floor(tG + (bG - tG) * ratio);
                const mB = Math.floor(tB + (bB - tB) * ratio);
                
                grid.colors[idx] = Utils.packAbgr(mR, mG, mB);
                
                if (isGradual && !isUpward) {
                    grid.glows[idx] = 0;
                } else {
                    grid.glows[idx] = targetGlow * (1.0 - ratio);
                }
            } else {
                // Hold Tracer
                grid.colors[idx] = tracerColor;
                grid.glows[idx] = targetGlow;
            }
        }

        // Handle Rotator
        // Allow rotator to finish its transition (mix > 0) even if subsequently disabled
        if ((s.rotatorEnabled || grid.mix[idx] > 0) && baseType === CELL_TYPE.ROTATOR) {
            this._handleRotator(idx, frame, s, d);
        }

        // Handle Dynamic Colors (Effects)
        if (grid.complexStyles.has(idx)) {
            const style = grid.complexStyles.get(idx);
            if (style.cycle) {
                const newHue = (style.h + style.speed) % 360;
                style.h = newHue; 
                const rgb = Utils.hslToRgb(newHue, style.s, style.l);
                grid.colors[idx] = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
            }
        }

        // Handle Decay / Alpha
        if (decay >= 2) {
            // Ensure trails are Stream Color, not Tracer Color
            let useBase = true;
            if (grid.complexStyles.has(idx)) {
                const style = grid.complexStyles.get(idx);
                if (style.cycle) useBase = false;
            }

            if (useBase) {
                if (decay === 2) { // First frame of decay
                    grid.colors[idx] = grid.baseColors[idx];
                    grid.glows[idx] = 0;
                } else {
                    // Also enforce it in case we missed frame 2 (unlikely but safe)
                    grid.colors[idx] = grid.baseColors[idx];
                    grid.glows[idx] = 0;
                }
            } else {
                // For cycling effects, just kill the glow
                grid.glows[idx] = 0;
            }
            
            grid.decays[idx]++;
            const newDecay = grid.decays[idx];
            // Use per-cell max decay if set (non-zero), otherwise use global config
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
            
            if (this._shouldDecay(idx, newDecay, maxFade)) {
                grid.clearCell(idx);
                return;
            }
            grid.alphas[idx] = this._calculateAlpha(idx, age, newDecay, maxFade);
        } else {
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
            grid.alphas[idx] = this._calculateAlpha(idx, age, decay, maxFade);
        }
    }

    _incrementAge(age, maxState) {
        return age + 1;
    }

    _handleRotator(idx, frame, s, d) {
        const grid = this.grid;
        const mix = grid.mix[idx]; 
        const decay = grid.decays[idx];

        if (mix > 0) {
            this._progressRotator(idx, mix, s.rotatorCrossfadeFrames);
        } else if (s.rotatorEnabled && (decay === 1 || (s.rotateDuringFade && decay > 1))) {
            this._cycleRotator(idx, frame, s.rotatorCrossfadeFrames, d.rotatorCycleFrames, s);
        }
    }

    _progressRotator(idx, currentMix, crossfadeFrames) {
        const grid = this.grid;
        const step = 1.0 / Math.max(1, crossfadeFrames);
        const newMix = currentMix + step;

        if (newMix >= 1.0) {
            const target = grid.getRotatorTarget(idx, false); 
            if (target) {
                grid.chars[idx] = target.charCodeAt(0);
                if (this.config.state.overlapEnabled) {
                    const ovTarget = grid.getRotatorTarget(idx, true);
                    if (ovTarget) {
                        grid.secondaryChars[idx] = ovTarget.charCodeAt(0);
                    }
                }
            }
            grid.mix[idx] = 0;
            // Clear rotator targets
            grid.nextChars[idx] = 0;
            grid.nextOverlapChars[idx] = 0;
        } else {
            grid.mix[idx] = newMix;
        }
    }

    _cycleRotator(idx, frame, crossfadeFrames, cycleFrames, s) {
        const grid = this.grid;
        let effectiveCycle = cycleFrames;
        
        if (s.rotatorDesyncEnabled) {
            const variancePercent = s.rotatorDesyncVariance / 100;
            const maxVariance = cycleFrames * variancePercent;
            const offsetNorm = (grid.rotatorOffsets[idx] / 127.5) - 1.0;
            effectiveCycle = Math.max(1, Math.round(cycleFrames + (offsetNorm * maxVariance)));
        }

        if (frame % effectiveCycle === 0) {
            const fontIdx = grid.fontIndices[idx];
            const activeFonts = this.config.derived.activeFonts;
            const fontData = activeFonts[fontIdx] || activeFonts[0];
            const charSet = fontData.chars;
            
            const nextChar = this._getUniqueChar(grid.getChar(idx), charSet);
            const nextCode = nextChar.charCodeAt(0);
            
            let nextOvCode = 0;
            if (this.config.state.overlapEnabled) {
                const curOv = String.fromCharCode(grid.secondaryChars[idx]);
                const nextOv = this._getUniqueChar(curOv, charSet);
                nextOvCode = nextOv.charCodeAt(0);
            }

            if (crossfadeFrames <= 1) {
                grid.chars[idx] = nextCode;
                if (nextOvCode) grid.secondaryChars[idx] = nextOvCode;
            } else {
                grid.mix[idx] = 0.01; 
                grid.setRotatorTarget(idx, nextChar, false);
                if (nextOvCode) {
                    grid.setRotatorTarget(idx, String.fromCharCode(nextOvCode), true);
                }
            }
        }
    }
    
    _getUniqueChar(exclude, charSet) {
        if (!charSet) charSet = Utils.CHARS;
        if (charSet.length <= 1) return charSet[0];
        let char;
        let attempts = 0;
        do {
            char = charSet[Math.floor(Math.random() * charSet.length)];
            attempts++;
        } while (char === exclude && attempts < 10);
        return char;
    }

    _shouldDecay(idx, decay, fadeDurationFrames) {
        return decay > fadeDurationFrames + 2;
    }

    _calculateAlpha(idx, age, decay, fadeDurationFrames) {
        const s = this.config.state;
        const b = this.grid.brightness[idx];
        
        // Fading OUT
        if (decay >= 2) {
            const ratio = (decay - 2) / fadeDurationFrames;
            // Use power curve for smoother perceived fade (starts fading sooner)
            const fade = Math.pow(Math.max(0, 1.0 - ratio), 2.0);
            return 0.95 * fade * b;
        }
        
        // Fading IN
        let attack = s.tracerAttackFrames;
        if ((this.grid.types[idx] & CELL_TYPE_MASK) === CELL_TYPE.UPWARD_TRACER) {
            attack = s.upwardTracerAttackFrames;
        }

        if (age <= attack && attack > 0) {
            return 0.95 * (age / attack) * b;
        }

        // Standard State
        return 0.95 * b;
    }
}