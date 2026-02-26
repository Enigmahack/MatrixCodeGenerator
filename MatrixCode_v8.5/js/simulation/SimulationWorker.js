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
        
        this._updateGlimmerLifecycle();

        if (this.grid.envGlows) this.grid.envGlows.fill(0);
        this.glowSystem.update();
        this.glowSystem.apply();

        if (this.grid.cellLocks) {
            this.grid.cellLocks.fill(0);
        }
    }

    _updateGlimmerLifecycle() {
        const s = this.config.state;
        const indices = Array.from(this.grid.complexStyles.keys());

        for (const idx of indices) {
            const style = this.grid.complexStyles.get(idx);
            if (!style || style.type !== 'glimmer') continue;

            const ov = this.grid.overrideActive[idx];
            if (this.grid.effectActive[idx] !== 0 || (ov !== 0 && ov !== 5)) continue;

            if (style.mobile === undefined) {
                if (Math.random() < 0.2) {
                    style.mobile = true;
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
            
            let currentIdx = idx;
            if (style.mobile && activeAge >= style.nextMove && activeAge < totalDuration) {
                const col = currentIdx % this.grid.cols;
                const row = Math.floor(currentIdx / this.grid.cols);
                const nextRow = row + style.moveDir;
                
                if (nextRow >= 0 && nextRow < this.grid.rows) {
                    const nextIdx = currentIdx + (style.moveDir * this.grid.cols);
                    
                    if (!this.grid.complexStyles.has(nextIdx)) {
                        this.grid.complexStyles.set(nextIdx, style);
                        this.grid.complexStyles.delete(currentIdx);
                        this.grid.mix[nextIdx] = this.grid.mix[currentIdx];
                        this.grid.mix[currentIdx] = 0;
                        this.grid.effectChars[nextIdx] = this.grid.effectChars[currentIdx];
                        this.grid.effectChars[currentIdx] = 0;
                        currentIdx = nextIdx;
                        style.nextMove = activeAge + style.moveInterval;
                    }
                }
            }
            
            this.grid.effectChars[currentIdx] = 0;

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
        const currentDensity = s.overlapDensity;
        const ovRgb = Utils.hexToRgb(s.overlapColor);
        const ovColor = Utils.packAbgr(ovRgb.r, ovRgb.g, ovRgb.b);

        if (!this.overlapInitialized || this._lastOverlapDensity !== currentDensity) {
            const N = this.grid.secondaryChars.length;
            for (let i = 0; i < N; i++) {
                const ov = this.grid.overrideActive[i];
                if (ov !== 0 && ov !== 5) continue;
                if (Math.random() < currentDensity) {
                    const fontIdx = this.grid.fontIndices[i];
                    const charSet = (activeFonts[fontIdx] || activeFonts[0]).chars;
                    this.grid.secondaryChars[i] = charSet[Math.floor(Math.random() * charSet.length)].charCodeAt(0);
                    this.grid.secondaryColors[i] = ovColor;
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
        const total = this.grid.cols * this.grid.rows;
        if (this.grid.activeFlag) {
            for (let i = 0; i < total; i++) {
                if (this.grid.activeFlag[i] === 1) this._updateCell(i, frame, config.state, config.derived);
            }
        } else {
            for (const idx of this.grid.activeIndices) this._updateCell(idx, frame, config.state, config.derived);
        }
    }

    _updateCell(idx, frame, s, d) {
        const grid = this.grid;
        if (grid.cellLocks && grid.cellLocks[idx] === 1) return;
        const ov = grid.overrideActive[idx];
        if (ov !== 0 && ov !== 3 && ov !== 5) return;

        const decay = grid.decays[idx];
        if (decay === 0) return;

        grid.ages[idx]++;
        const age = grid.ages[idx];
        const type = grid.types[idx];
        const baseType = type & CELL_TYPE_MASK;
        const isTracer = (baseType === CELL_TYPE.TRACER || baseType === CELL_TYPE.ROTATOR);

        if (decay < 2 && isTracer) {
            const ratio = this._getColorRatio(age, s);
            if (ratio >= 1.0) {
                grid.colors[idx] = grid.baseColors[idx];
                grid.glows[idx] = 0; 
                if (grid.mix[idx] >= 2.0) grid.mix[idx] = 0; 
            } else if (ratio > 0) {
                grid.colors[idx] = this._lerpPackColor(d.tracerColorUint32, grid.baseColors[idx], ratio);
                grid.glows[idx] = s.tracerGlow * (1.0 - ratio);
            } else {
                grid.colors[idx] = d.tracerColorUint32;
                grid.glows[idx] = s.tracerGlow;
            }
        }

        if ((s.rotatorEnabled || grid.mix[idx] > 0) && baseType === CELL_TYPE.ROTATOR) this._handleRotator(idx, frame, s, d);

        if (decay >= 2) {
            grid.colors[idx] = grid.baseColors[idx];
            grid.glows[idx] = 0;
            grid.decays[idx]++;
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
            if (grid.decays[idx] > maxFade + 2) {
                grid.clearCell(idx);
                return;
            }
            grid.alphas[idx] = this._calculateAlpha(idx, age, grid.decays[idx], maxFade);
        } else {
            const maxFade = (grid.maxDecays && grid.maxDecays[idx] > 0) ? grid.maxDecays[idx] : s.decayFadeDurationFrames;
            grid.alphas[idx] = this._calculateAlpha(idx, age, decay, maxFade);
        }
    }

    _getColorRatio(age, s) {
        const activeAge = age - 1;
        const attackHold = s.tracerAttackFrames + s.tracerHoldFrames;
        if (activeAge <= attackHold) return 0;
        return s.tracerReleaseFrames > 0 ? Math.min(1.0, (activeAge - attackHold) / s.tracerReleaseFrames) : 1.0;
    }

    _lerpPackColor(c1, c2, t) {
        const r1=c1&0xFF, g1=(c1>>8)&0xFF, b1=(c1>>16)&0xFF;
        const r2=c2&0xFF, g2=(c2>>8)&0xFF, b2=(c2>>16)&0xFF;
        return (r1+(r2-r1)*t)|((g1+(g2-g1)*t)<<8)|((b1+(b2-b1)*t)<<16)|0xFF000000;
    }

    _handleRotator(idx, frame, s, d) {
        const grid = this.grid;
        if (grid.mix[idx] > 0) {
            grid.mix[idx] += 1.0 / Math.max(1, s.rotatorCrossfadeFrames);
            if (grid.mix[idx] >= 1.0) {
                const target = grid.getRotatorTarget(idx, false); 
                if (target) {
                    grid.chars[idx] = target.charCodeAt(0);
                    if (s.lockBrightnessToCharacters) grid.brightness[idx] = Utils.calculateCharBrightness(grid.chars[idx], grid.streamSeeds[idx], d.varianceMin);
                }
                grid.mix[idx] = 0; grid.nextChars[idx] = 0;
            }
        } else if (frame % d.rotatorCycleFrames === 0) {
            const charSet = (this.config.derived.activeFonts[grid.fontIndices[idx]] || this.config.derived.activeFonts[0]).chars;
            const next = Utils.getUniqueChar(grid.getChar(idx), charSet);
            if (s.rotatorCrossfadeFrames <= 1) {
                grid.chars[idx] = next.charCodeAt(0);
            } else {
                grid.mix[idx] = 0.01; grid.setRotatorTarget(idx, next, false);
            }
        }
    }

    _calculateAlpha(idx, age, decay, maxFade) {
        const b = this.grid.brightness[idx];
        if (decay >= 2) return 0.95 * Math.pow(Math.max(0, 1.0 - (decay - 2) / maxFade), 2.0) * b;
        const attack = (this.grid.types[idx] & CELL_TYPE_MASK) === CELL_TYPE.UPWARD_TRACER ? config.state.upwardTracerAttackFrames : config.state.tracerAttackFrames;
        return 0.95 * (age <= attack && attack > 0 ? (age / attack) : 1.0) * b;
    }
}

let simSystem = null;

self.onmessage = function(e) {
    const msg = e.data;
    switch(msg.type) {
        case 'init':
            config.state = msg.config.state; config.derived = msg.config.derived;
            grid = new CellGrid(configManagerMock);
            grid.resize(msg.width, msg.height, msg.buffers);
            simSystem = new WorkerSimulationSystem(grid, configManagerMock);
            break;
        case 'config':
            if (msg.key === 'ALL') {
                config.state = msg.config.state;
            } else if (msg.key) {
                config.state[msg.key] = msg.value;
            }
            if (msg.config.derived) {
                config.derived = msg.config.derived;
            }
            break;
        case 'resize':
            if (grid) {
                config.state = msg.config.state; config.derived = msg.config.derived;
                grid.resize(msg.width, msg.height, msg.buffers);
                if (simSystem) simSystem.streamManager.resize(grid.cols);
            }
            break;
        case 'replace_state':
            if (simSystem && msg.state) {
                const sm = simSystem.streamManager;
                const s = msg.state;
                sm.activeStreams = (s.activeStreams || []).map(st => {
                    if (Array.isArray(st.holes)) st.holes = new Set(st.holes);
                    return st;
                });
                sm.nextSpawnFrame = s.nextSpawnFrame || 0;
                if (s.columnSpeeds) sm.columnSpeeds.set(s.columnSpeeds);
                if (s.streamsPerColumn) sm.streamsPerColumn.set(s.streamsPerColumn);
                sm.lastStreamInColumn = s.lastStreamInColumn;
                sm.lastEraserInColumn = s.lastEraserInColumn;
                sm.lastUpwardTracerInColumn = s.lastUpwardTracerInColumn;
                
                if (grid) {
                    grid.activeIndices.clear();
                    if (s.activeIndices) s.activeIndices.forEach(idx => { grid.activeIndices.add(idx); if (grid.activeFlag) grid.activeFlag[idx] = 1; });
                    grid.complexStyles.clear();
                    if (s.complexStyles) s.complexStyles.forEach(([k, v]) => grid.complexStyles.set(k, v));
                    if (grid.cellLocks) grid.cellLocks.fill(0);
                }
            }
            break;
        case 'update':
            if (simSystem) simSystem.update(msg.frame);
            break;
    }
};
