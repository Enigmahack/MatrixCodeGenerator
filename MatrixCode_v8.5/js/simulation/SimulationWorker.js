// =========================================================================
// SIMULATION WORKER
// =========================================================================

// Handles physics/simulation logic in a separate thread.

// 1. Import Dependencies (Synchronous in Workers)
importScripts('../core/Utils.js');
importScripts('../data/CellGrid.js');
importScripts('../effects/GlowSystem.js');
importScripts('../simulation/StreamModes.js');
importScripts('../simulation/StreamManager.js');

// 2. Global State
let grid = null;
let streamManager = null;
let glowSystem = null;
let config = { 
    state: {}, 
    derived: {} 
}; 

// Mock ConfigurationManager interface for StreamManager
const configManagerMock = {
    get state() { return config.state; },
    get derived() { return config.derived; }
};

// 3. Simulation System (Simplified for Worker)
class WorkerSimulationSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.streamManager = new StreamManager(grid, config);
        this.glowSystem = new GlowSystem(grid);
        this.grid.glowSystem = this.glowSystem;
        
        this.overlapInitialized = false;
        this._lastOverlapDensity = null;
        this.timeScale = 1.0;

        this.rotatorSpeedMap = new Float32Array(60);
        for (let i = 0; i < 60; i++) {
            this.rotatorSpeedMap[i] = 0.5 + Math.random() * 2.5; 
        }
    }

    update(frame) {
        this.streamManager.update(frame, this.timeScale);
        this._manageOverlapGrid(frame);
        this._updateCells(frame, this.timeScale);
        
        // Glimmer Lifecycles (Refactored to method)
        this._updateGlimmerLifecycle();

        // Apply Glows
        if (this.grid.envGlows) this.grid.envGlows.fill(0);
        this.glowSystem.update();
        this.glowSystem.apply();

        if (this.grid.cellLocks) {
            this.grid.cellLocks.fill(0);
        }
    }

    _updateGlimmerLifecycle() {
        const s = this.config.state;
        const d = this.config.derived;
        
        // Glimmer Speed now controls the shader animation (blink/shimmer), not character rotation.

        // We iterate over a copy of keys to safely mutate the map during iteration (for movement)
        const indices = Array.from(this.grid.complexStyles.keys());

        for (const idx of indices) {
            const style = this.grid.complexStyles.get(idx);
            if (!style || style.type !== 'glimmer') continue;

            // Pause Glimmer updates if cell is frozen by an effect (e.g. Pulse Pause)
            // EXCEPTION: Mode 3 (FULL) and Mode 5 (DUAL) are masking modes, let them run.
            const ov = this.grid.overrideActive[idx];
            if (this.grid.effectActive[idx] !== 0 || (ov !== 0 && ov !== 3 && ov !== 5)) continue;

            // Initialize Mobility (One-time)
            if (style.mobile === undefined) {
                // 20% chance to be a "Moving" glimmer
                if (Math.random() < 0.2) {
                    style.mobile = true;
                    // Move every 4-8 frames
                    style.moveInterval = Utils.randomInt(4, 8);
                    style.nextMove = style.age + style.moveInterval;
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
                    
                    if (!this.grid.complexStyles.has(nextIdx)) {
                        // Move State
                        this.grid.complexStyles.set(nextIdx, style);
                        this.grid.complexStyles.delete(currentIdx);
                        
                        // Move Mix Value
                        this.grid.mix[nextIdx] = this.grid.mix[currentIdx];
                        this.grid.mix[currentIdx] = 0;
                        
                        // Move Effect Char
                        this.grid.effectChars[nextIdx] = this.grid.effectChars[currentIdx];
                        this.grid.effectChars[currentIdx] = 0;
                        
                        currentIdx = nextIdx;
                        style.nextMove = activeAge + style.moveInterval;
                    }
                }
            }
            
            // Ensure we use the underlying character
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
                this.grid.mix[currentIdx] = 30.0 + alpha;
            } else {
                this.grid.mix[currentIdx] = 0;
                this.grid.complexStyles.delete(currentIdx);
            }
        }
    }

    // Copied from SimulationSystem.js (Logic is identical)
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
                // EXCEPTION: Mode 3 (FULL) and Mode 5 (DUAL) are masking modes, let them run.
                const ov = this.grid.overrideActive[i];
                if (ov !== 0 && ov !== 3 && ov !== 5) continue;
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
        if (timeScale <= 0) return;
        if (timeScale < 1.0) {
            if (Math.random() > timeScale) return;
        }

        const s = this.config.state;
        const d = this.config.derived;
        const grid = this.grid;
        const activeFlag = grid.activeFlag;
        const total = grid.cols * grid.rows;

        if (activeFlag) {
            for (let i = 0; i < total; i++) {
                if (activeFlag[i] === 1) {
                    this._updateCell(i, frame, s, d);
                }
            }
        } else {
            // Fallback
            for (const idx of grid.activeIndices) {
                this._updateCell(idx, frame, s, d);
            }
        }
    }

    _updateCell(idx, frame, s, d) {
        const grid = this.grid;

        if (grid.cellLocks && grid.cellLocks[idx] === 1) return;
        // If an effect is overriding this cell, pause simulation updates (Freeze)
        // EXCEPTION: Mode 3 (FULL) and Mode 5 (DUAL) are masking modes, let them run.
        const ov = grid.overrideActive[idx];
        if (ov !== 0 && ov !== 3 && ov !== 5) return;

        const decay = grid.decays[idx];
        if (decay === 0) return;

        let age = grid.ages[idx];
        if (age > 0) {
            age = age + 1;
            grid.ages[idx] = age;
        }

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

            let ratio = 0; 
            const activeAge = age - 1;
            
            if (isGradual && !isUpward) {
                const fadeStart = attack + hold;
                const fadeLen = 45.0; 
                if (activeAge > fadeStart) {
                    ratio = Math.min(1.0, (activeAge - fadeStart) / fadeLen);
                }
            } else {
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
                grid.glows[idx] = 0; 
                if (grid.mix[idx] >= 2.0) grid.mix[idx] = 0; 
            } else if (ratio > 0) {
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
                grid.colors[idx] = tracerColor;
                grid.glows[idx] = targetGlow;
            }
        }

        if ((s.rotatorEnabled || grid.mix[idx] > 0) && baseType === CELL_TYPE.ROTATOR) {
            this._handleRotator(idx, frame, s, d);
        }

        if (grid.complexStyles.has(idx)) {
            const style = grid.complexStyles.get(idx);
            if (style.cycle) {
                const newHue = (style.h + style.speed) % 360;
                style.h = newHue; 
                const rgb = Utils.hslToRgb(newHue, style.s, style.l);
                grid.colors[idx] = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
            }
        }

        if (decay >= 2) {
            let useBase = true;
            if (grid.complexStyles.has(idx)) {
                const style = grid.complexStyles.get(idx);
                if (style.cycle) useBase = false;
            }
            if (useBase) {
                 grid.colors[idx] = grid.baseColors[idx];
                 grid.glows[idx] = 0;
            } else {
                grid.glows[idx] = 0;
            }
            grid.decays[idx]++;
            const newDecay = grid.decays[idx];
            
            // Use per-cell max decay if set, otherwise use global config
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;

            if (newDecay > maxFade + 2) {
                grid.clearCell(idx);
                return;
            }
            grid.alphas[idx] = this._calculateAlpha(idx, age, newDecay, maxFade);
        } else {
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
            grid.alphas[idx] = this._calculateAlpha(idx, age, decay, maxFade);
        }
    }
    
    _handleRotator(idx, frame, s, d) {
        const grid = this.grid;
        const mix = grid.mix[idx]; 
        const decay = grid.decays[idx];

        if (mix > 0) {
            const step = 1.0 / Math.max(1, s.rotatorCrossfadeFrames);
            const newMix = mix + step;
            if (newMix >= 1.0) {
                const target = grid.getRotatorTarget(idx, false); 
                if (target) {
                    grid.chars[idx] = target.charCodeAt(0);
                    if (s.overlapEnabled) {
                        const ovTarget = grid.getRotatorTarget(idx, true);
                        if (ovTarget) grid.secondaryChars[idx] = ovTarget.charCodeAt(0);
                    }
                }
                grid.mix[idx] = 0;
                grid.nextChars[idx] = 0;
                grid.nextOverlapChars[idx] = 0;
            } else {
                grid.mix[idx] = newMix;
            }
        } else if (s.rotatorEnabled && (decay === 1 || (s.rotateDuringFade && decay > 1))) {
            let effectiveCycle = d.rotatorCycleFrames;
            if (s.rotatorRandomSpeedEnabled) {
                const approxRotationCount = Math.floor(frame / (d.rotatorCycleFrames * 1.5));
                const speedIdx = (approxRotationCount + grid.rotatorOffsets[idx]) % 60;
                effectiveCycle = Math.round(d.rotatorCycleFrames * this.rotatorSpeedMap[speedIdx]);
            } else if (s.rotatorDesyncEnabled) {
                const variancePercent = s.rotatorDesyncVariance / 100;
                const maxVariance = d.rotatorCycleFrames * variancePercent;
                const offsetNorm = (grid.rotatorOffsets[idx] / 127.5) - 1.0;
                effectiveCycle = Math.max(1, Math.round(d.rotatorCycleFrames + (offsetNorm * maxVariance)));
            }
            
            effectiveCycle = Math.max(1, effectiveCycle);

            if (frame % effectiveCycle === 0) {
                const fontIdx = grid.fontIndices[idx];
                const activeFonts = this.config.derived.activeFonts;
                const fontData = activeFonts[fontIdx] || activeFonts[0];
                const charSet = fontData.chars;
                
                const nextChar = Utils.getUniqueChar(grid.getChar(idx), charSet); // Use Utils directly
                // Note: Utils.getUniqueChar takes (exclude, charSet) but Utils signature is (exclude) because Utils.CHARS is default.
                
                let nextCode = 32;
                if (nextChar) nextCode = nextChar.charCodeAt(0);
                else {
                    // Fallback
                     const r = Math.floor(Math.random() * charSet.length);
                     nextCode = charSet[r].charCodeAt(0);
                }
                
                let nextOvCode = 0;
                if (s.overlapEnabled) {
                    const r2 = Math.floor(Math.random() * charSet.length);
                    nextOvCode = charSet[r2].charCodeAt(0);
                }

                if (s.rotatorCrossfadeFrames <= 1) {
                    grid.chars[idx] = nextCode;
                    if (nextOvCode) grid.secondaryChars[idx] = nextOvCode;
                } else {
                    grid.mix[idx] = 0.01; 
                    grid.setRotatorTarget(idx, String.fromCharCode(nextCode), false);
                    if (nextOvCode) {
                        grid.setRotatorTarget(idx, String.fromCharCode(nextOvCode), true);
                    }
                }
            }
        }
    }

    _calculateAlpha(idx, age, decay, fadeDurationFrames) {
        const s = this.config.state;
        const b = this.grid.brightness[idx];
        
        if (decay >= 2) {
            const ratio = (decay - 2) / fadeDurationFrames;
            const fade = Math.pow(Math.max(0, 1.0 - ratio), 2.0);
            return 0.95 * fade * b;
        }
        
        let attack = s.tracerAttackFrames;
        if ((this.grid.types[idx] & CELL_TYPE_MASK) === CELL_TYPE.UPWARD_TRACER) {
            attack = s.upwardTracerAttackFrames;
        }

        if (age <= attack && attack > 0) {
            return 0.95 * (age / attack) * b;
        }
        return 0.95 * b;
    }
}

let simSystem = null;

// 4. Message Handler
self.onmessage = function(e) {
    const msg = e.data;

    switch(msg.type) {
        case 'init':
            // 1. Setup Config
            config.state = msg.config.state;
            config.derived = msg.config.derived;
            
            // 2. Setup Grid with Shared Buffers
            grid = new CellGrid(configManagerMock);
            
            // Reconstruct Views
            grid.resize(msg.width, msg.height, msg.buffers);
            
            // 3. Setup Simulation
            simSystem = new WorkerSimulationSystem(grid, configManagerMock);
            
            // console.log("[SimulationWorker] Initialized");
            break;

        case 'config':
            config.state = msg.config.state;
            config.derived = msg.config.derived;
            // Handle resizes if necessary?
            // Usually init handles resize via buffer swap, but dynamic resize sends 'init' again?
            // If just config tweak, we update state.
            break;

        case 'resize':
             // Re-bind buffers if they changed
             if (grid) {
                 config.state = msg.config.state; // Ensure latest state for resize calc
                 config.derived = msg.config.derived;
                 grid.resize(msg.width, msg.height, msg.buffers);
                 if (simSystem) simSystem.streamManager.resize(grid.cols);
             }
             break;

        case 'replace_state':
            console.log("[SimulationWorker] Received replace_state request");
            if (simSystem && msg.state) {
                const sm = simSystem.streamManager;
                const s = msg.state;
                
                // Rehydrate Active Streams (Array -> Set for holes)
                // Note: The objects in s.activeStreams are clones created by postMessage.
                // We modify them in place to restore functionality.
                const rehydratedStreams = (s.activeStreams || []).map(st => {
                     if (Array.isArray(st.holes)) {
                         st.holes = new Set(st.holes);
                     }
                     return st;
                });

                // Merge active streams (Don't overwrite existing main simulation streams)
                sm.activeStreams = sm.activeStreams.concat(rehydratedStreams);
                sm.nextSpawnFrame = Math.min(sm.nextSpawnFrame, s.nextSpawnFrame || 0);
                
                // Typed Arrays need explicit copy if not shared (passed as ArrayBuffer usually)
                if (s.columnSpeeds) sm.columnSpeeds = new Float32Array(s.columnSpeeds);
                
                // Reconstruct Column References
                if (s.lastStreamInColumn) sm.lastStreamInColumn = s.lastStreamInColumn;
                if (s.lastEraserInColumn) sm.lastEraserInColumn = s.lastEraserInColumn;
                if (s.lastUpwardTracerInColumn) sm.lastUpwardTracerInColumn = s.lastUpwardTracerInColumn;
                
                // Sync Overlap State
                if (s.overlapInitialized !== undefined) simSystem.overlapInitialized = s.overlapInitialized;
                if (s._lastOverlapDensity !== undefined) simSystem._lastOverlapDensity = s._lastOverlapDensity;
                
                // Sync Streams Per Column (Critical for speed logic)
                if (s.streamsPerColumn && sm.streamsPerColumn) {
                    sm.streamsPerColumn.set(s.streamsPerColumn);
                }

                // Clear Cell Locks to prevent stuck streams/rotators from Shadow World blocking Main World
                if (grid.cellLocks) {
                    grid.cellLocks.fill(0);
                }
                
                // Sync Complex Styles (Glimmer/Upward Tracers)
                if (s.complexStyles && Array.isArray(s.complexStyles)) {
                    simSystem.grid.complexStyles.clear();
                    for (const [key, value] of s.complexStyles) {
                        simSystem.grid.complexStyles.set(key, value);
                    }
                }
                
                // Merge shadow world's active cells into main simulation (don't clear)
                if (grid && grid.state) {
                    if (s.activeIndices && Array.isArray(s.activeIndices)) {
                        for (const idx of s.activeIndices) {
                            grid.activeIndices.add(idx);
                            if (grid.activeFlag) grid.activeFlag[idx] = 1;
                        }
                        console.log(`[SimulationWorker] Merged ${s.activeIndices.length} shadow indices into main activeIndices.`);
                    } else {
                        // Fallback: Scan activeFlag or state
                        console.warn("[SimulationWorker] activeIndices missing in replace_state! Scanning...");
                        const total = grid.cols * grid.rows;
                        for(let i=0; i<total; i++) {
                            const isActive = (grid.activeFlag ? grid.activeFlag[i] === 1 : grid.state[i] === 1);
                            if (isActive) {
                                grid.activeIndices.add(i);
                            }
                        }
                    }
                }
                
                console.log("[SimulationWorker] State Swap Complete.");
            }
            break;

        case 'update':
            if (simSystem) {
                simSystem.update(msg.frame);
                // No need to post back data, it's in SharedArrayBuffer
            }
            break;
    }
};
