class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedBlockGenerator";
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;

        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0;
        this.persistentCycleIndex = 0;

        // The Growth Pool: registered sub-behaviors (user-defined, sortable)
        this.growthPool = new Map();

        // Behavioral State shared across all systems
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            snapshots: [],
            lastActionTime: 0,
            fillRatio: 0
        };

        // Strip system state
        this.strips = new Map();
        this._stripNextId = 0;

        // Intent buffer for generative scaling
        this.actionBuffer = [];
        this.actionQueues = new Map(); // layer -> intent[] (persistent queue)
    }

    // =========================================================
    // BEHAVIOR POOL API
    // =========================================================

    /**
     * Registers a sub-behavior into the growth pool.
     * @param {string} id - Unique identifier.
     * @param {Function} fn - Called each active tick with (behaviorState).
     * @param {Object} [options]
     * @param {boolean} [options.enabled=true]
     * @param {string} [options.label] - Display name for the UI.
     */
    registerBehavior(id, fn, options = {}) {
        const existing = this.growthPool.get(id);
        this.growthPool.set(id, {
            fn: fn,
            // Preserve live enabled state if already registered (survives re-triggers)
            enabled: existing !== undefined ? existing.enabled : (options.enabled ?? true),
            label: options.label || id
        });
    }

    /** Enables or disables a registered sub-behavior. */
    setBehaviorFlag(id, enabled) {
        const behavior = this.growthPool.get(id);
        if (behavior) behavior.enabled = enabled;
    }

    // =========================================================
    // TRIGGER / INIT
    // =========================================================

    trigger(force = false) {
        if (this.active && !force) return false;
        
        // Reset ALL generative state BEFORE super.trigger calls _initLogicGrid
        this.timer = 0;
        this.genTimer = 0;
        this.persistentCycleIndex = 0;
        this.strips.clear();
        this._stripNextId = 0;
        this.actionBuffer = [];
        this.actionQueues.clear();
        this.activeBlocks = [];
        this.maskOps = [];
        
        // Shared state reset
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            scx: 0,
            scy: 0,
            hitEdge: false,
            snapshots: [],
            lastActionTime: 0,
            fillRatio: 0,
            insideOutWave: 1,
            deferredCols: new Map(),
            deferredRows: new Map()
        };

        if (!super.trigger(force)) return false;

        this.alpha = 1.0;
        this.state = 'GENERATING';

        const randomStart = !!this.c.get('quantizedGenerateV2RandomStart');
        let scx = 0;
        let scy = 0;

        if (randomStart) {
            const bs = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2) - 5;
            const halfH = Math.floor(this.g.rows / bs.h / 2) - 5;
            scx = Math.floor((Math.random() * 2 - 1) * halfW);
            scy = Math.floor((Math.random() * 2 - 1) * halfH);
        }

        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;

        // Generate random step patterns for this run (not user-configurable)
        this.behaviorState.pattern = this._generateRandomPattern();
        this.behaviorState.pausePattern = this._generateDistinctPattern(this.behaviorState.pattern);

        // Assign per-layer allowed growth directions with life timers.
        // Timers are staggered by layer so updates don't all coincide on the same step.
        const quadrantCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);
        const _maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
        const _baseLife = 4 + Math.floor(Math.random() * 3); // 4–6 steps before first re-roll
        this.behaviorState.layerDirs = {};
        this.behaviorState.layerDirLife = {};
        for (let l = 0; l <= _maxLayer + 1; l++) {
            this.behaviorState.layerDirs[l] = this._pickLayerDirs(quadrantCount);
            // Each layer offset by 1 step so they expire in sequence, not all at once
            this.behaviorState.layerDirLife[l] = _baseLife + l;
        }

        // Build the strip seeding schedule (spread across first 6 steps)
        this.behaviorState.seedSchedule = this._generateSeedSchedule(scx, scy);

        console.log(`QuantizedBlockGenerator: Starting at ${randomStart ? `random (${scx}, ${scy})` : 'center'}`);

        this._initShadowWorld();

        // Seed origin block(s)
        if (randomStart && (scx !== 0 || scy !== 0)) {
            this._initProceduralState(false); 
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            for (let l = 0; l <= maxLayer; l++) {
                this._spawnBlock(scx, scy, 1, 1, l, false, 0, true, true, true, false, true);
            }
        } else {
            this._initProceduralState(true); 
        }

        this._initBehaviors();
        this._updateRenderGridLogic();

        return true;
    }

    _initBehaviors() {
        const self = this;

        // ─────────────────────────────────────────────────────
        // Behavior 1: Main Nudge Growth
        // ─────────────────────────────────────────────────────
        this.registerBehavior('main_nudge_growth', function(s) {
            const startDelay = this.c.get('quantizedGenerateV2NudgeStartDelay') ?? 4;
            if (s.step < startDelay) return;

            const spawnChance = this.c.get('quantizedGenerateV2NudgeChance') ?? 0.3;
            if (Math.random() > spawnChance) return;

            const maxStrips = this.c.get('quantizedGenerateV2MaxNudgeStrips') ?? 8;
            const minSpacing = this.c.get('quantizedGenerateV2NudgeSpacing') ?? 3;
            const axisBias   = this.c.get('quantizedGenerateV2NudgeAxisBias') ?? 0.5;
            const scalingEnabled = this.c.get('quantizedGenerateV2GenerativeScaling');

            const useHAxis = Math.random() < axisBias;
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            let candidates;
            if (useHAxis) {
                candidates = this.activeBlocks.filter(b => b.layer <= maxLayer && b.y <= s.scy && s.scy <= b.y + b.h - 1);
            } else {
                candidates = this.activeBlocks.filter(b => b.layer <= maxLayer && b.x <= s.scx && s.scx <= b.x + b.w - 1);
            }

            if (candidates.length === 0) return;

            const processCandidate = (block) => {
                const layer = block.layer;

                // Restrict L2/L3 to their designated axis origins
                if (layer === 2 && !useHAxis) return;
                if (layer === 3 && useHAxis) return;

                const allowed = this._getAllowedDirs(layer);
                let nx, ny, dir;
                if (useHAxis) {
                    const validDirs = ['N', 'S'].filter(d => !allowed || allowed.has(d));
                    if (validDirs.length === 0) return;
                    nx = block.x + Math.floor(Math.random() * block.w);
                    ny = s.scy;
                    dir = validDirs[Math.floor(Math.random() * validDirs.length)];
                } else {
                    const validDirs = ['E', 'W'].filter(d => !allowed || allowed.has(d));
                    if (validDirs.length === 0) return;
                    nx = s.scx;
                    ny = block.y + Math.floor(Math.random() * block.h);
                    dir = validDirs[Math.floor(Math.random() * validDirs.length)];
                }

                if (this.checkScreenEdge(nx, ny)) return;

                // Spacing check
                for (const strip of this.strips.values()) {
                    if (!strip.isNudge) continue;
                    if (Math.abs(strip.originX - nx) + Math.abs(strip.originY - ny) < minSpacing) return;
                }

                let nudgeCount = 0;
                for (const st of this.strips.values()) if (st.isNudge && st.active) nudgeCount++;
                if (nudgeCount >= maxStrips) return;

                const strip = this._createStrip(layer, dir, nx, ny);
                strip.isNudge = true;
                strip.stepPhase = Math.floor(Math.random() * 6);
            };

            if (scalingEnabled) {
                // In scaling mode, every candidate is a possible event
                for (const block of candidates) {
                    this.actionBuffer.push({ layer: block.layer, fn: () => processCandidate(block) });
                }
            } else {
                // Default mode: pick one
                const block = candidates[Math.floor(Math.random() * candidates.length)];
                this.actionBuffer.push({ layer: block.layer, fn: () => processCandidate(block) });
            }

        }, {
            enabled: this.c.get('quantizedGenerateV2NudgeEnabled') ?? true,
            label: 'Main Nudge Growth'
        });
    

        // ─────────────────────────────────────────────────────
        // Behavior 2: Spine Rib Seeding (L2/L3)
        // ─────────────────────────────────────────────────────
        this.registerBehavior('spine_rib_seeding', function(s) {
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            if (maxLayer < 2) return;

            const now = this.animFrame;
            const startDelay = this.c.get('quantizedGenerateV2InvisibleStartDelay') ?? 4;
            if (now < startDelay) return;

            const l2Chance = this.c.get('quantizedGenerateV2InvisibleL2Chance') ?? 1.0;
            const l3Chance = this.c.get('quantizedGenerateV2InvisibleL3Chance') ?? 1.0;
            const l2Max = this.c.get('quantizedGenerateV2MaxInvisibleL2Strips') ?? 100;
            const l3Max = this.c.get('quantizedGenerateV2MaxInvisibleL3Strips') ?? 100;
            const l2Spacing = this.c.get('quantizedGenerateV2InvisibleL2Spacing') ?? 1;
            const l3Spacing = this.c.get('quantizedGenerateV2InvisibleL3Spacing') ?? 1;

            if (!s.ribOrigins) s.ribOrigins = new Set();

            for (const block of this.activeBlocks) {
                // Ribs for L2/L3 can spawn from ANY axis block of a foundation layer (0,1) 
                // or their own respective axis layer (2,3). This breaks the sequential dependency.
                if (block.layer > 3) continue;

                const onHAxis = (block.y <= s.scy && s.scy <= block.y + block.h - 1);
                const onVAxis = (block.x <= s.scx && s.scx <= block.x + block.w - 1);
                if (!onHAxis && !onVAxis) continue;

                const processLayer = (l, ribs) => {
                    if (maxLayer < l) return;
                    
                    const spawnChance = (l === 2) ? l2Chance : l3Chance;
                    const maxStrips = (l === 2) ? l2Max : l3Max;
                    const spacing = (l === 2) ? l2Spacing : l3Spacing;

                    let currentCount = 0;
                    for (const st of this.strips.values()) if (st.layer === l && st.isInvisible && st.active) currentCount++;
                    if (currentCount >= maxStrips) return;

                    const allowed = this._getAllowedDirs(l);
                    
                    if (Math.random() < spawnChance) {
                        for (const rDir of ribs) {
                            if (allowed && !allowed.has(rDir)) continue;

                            let nx = block.x, ny = block.y;
                            if (l === 2) { // H-Axis
                                const jitter = Math.floor(Math.random() * block.w);
                                nx = block.x + jitter;
                                ny = s.scy;
                            } else { // V-Axis
                                const jitter = Math.floor(Math.random() * block.h);
                                nx = s.scx;
                                ny = block.y + jitter;
                            }

                            const idKey = `${l}_${rDir}_${nx}_${ny}`;
                            if (s.ribOrigins.has(idKey)) continue;
                            
                            let tooClose = false;
                            for (const st of this.strips.values()) {
                                if (st.layer === l && st.isInvisible && st.active) {
                                    if (Math.abs(st.originX - nx) + Math.abs(st.originY - ny) < spacing) {
                                        tooClose = true; break;
                                    }
                                }
                            }
                            if (tooClose) continue;

                            s.ribOrigins.add(idKey);

                            this.actionBuffer.push({ 
                                layer: l, 
                                isSpine: false,
                                fn: () => {
                                    const rStrip = this._createStrip(l, rDir, nx, ny);
                                    rStrip.isInvisible = true;
                                    rStrip.stepPhase = Math.floor(Math.random() * 6);
                                }
                            });
                        }
                    }
                };

                if (onHAxis) processLayer(2, ['N', 'S']);
                if (onVAxis) processLayer(3, ['E', 'W']);
            }
        }, {
            enabled: true,
            label: 'Spine Rib Seeding (L2/L3)'
        });

        // ─────────────────────────────────────────────────────
        // Behavior 3: Layer Collision Interference (Foundation vs L3)
        // ─────────────────────────────────────────────────────
        this.registerBehavior('layer_collision_interference', function(s) {
            const flickerChance = this.c.get('quantizedGenerateV2L3FlickerChance') ?? 0.15;
            if (flickerChance <= 0) return;
            if (!s.pendingDeletions) s.pendingDeletions = [];
            for (const b of this.activeBlocks) {
                if (b.layer === 3 && Math.random() < flickerChance) {
                    s.pendingDeletions.push({ x: b.x, y: b.y, w: b.w, h: b.h, layer: 3 });
                }
            }
        }, {
            enabled: true,
            label: 'L3 Collision Interference'
        });

        // ─────────────────────────────────────────────────────
        // Behavior 4: Layer 3 Axis Spawning & Randomness
        // ─────────────────────────────────────────────────────
        this.registerBehavior('l3_spine_randomness', function(s) {
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            if (maxLayer < 3) return;

            const l0md = (s.layerMaxDist || {})[0] || { N: 0, S: 0, E: 0, W: 0 };
            const l3Chance = this.c.get('quantizedGenerateV2InvisibleL3Chance') ?? 1.0;
            const rangeN = l0md.N + 2;
            const rangeS = l0md.S + 2;

            const spawnCount = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < spawnCount; i++) {
                const ry = Math.floor(Math.random() * (rangeN + rangeS + 1)) - rangeN;
                this.actionBuffer.push({ layer: 3, isSpine: true, fn: () => {
                    this._spawnBlock(s.scx, s.scy + ry, 1, 1, 3, false, 0, true, true, true, false, true);
                }});
            }

            if (Math.random() < l3Chance) {
                const ry = Math.floor(Math.random() * (rangeN + rangeS + 1)) - rangeN;
                this.actionBuffer.push({ layer: 3, isSpine: false, fn: () => {
                    const dir = Math.random() < 0.5 ? 'E' : 'W';
                    const rStrip = this._createStrip(3, dir, s.scx, s.scy + ry);
                    rStrip.isInvisible = true;
                    rStrip.stepPhase = Math.floor(Math.random() * 6);
                }});
            }
        }, {
            enabled: true,
            label: 'L3 Spine Randomness'
        });

        // ─────────────────────────────────────────────────────
        // Behavior 5: Layer 3 Quadrant Wipe
        // ─────────────────────────────────────────────────────
        this.registerBehavior('l3_quadrant_wipe', function(s) {
            if (!this.c.get('quantizedGenerateV2L3QuadrantWipeEnabled')) return;

            const l0md = (s.layerMaxDist || {})[0] || { N: 0, S: 0, E: 0, W: 0 };
            let removed = false;

            for (const b of this.activeBlocks) {
                if (b.layer !== 3) continue;
                const rx = b.x - s.scx;
                const ry = b.y - s.scy;
                if (-ry > l0md.N + 2 || ry > l0md.S + 2 || rx > l0md.E + 2 || -rx > l0md.W + 2) {
                    this._removeBlock(b.x, b.y, b.w, b.h, 3);
                    removed = true;
                }
            }

            if (removed) this._gridsDirty = true;
        }, {
            enabled: true,
            label: 'L3 Quadrant Wipe'
        });
    }

    // =========================================================
    // QUADRANT RESTRICTION HELPERS
    // =========================================================

    _pickLayerDirs(count) {
        if (count >= 4) return null;
        const all = ['N', 'S', 'E', 'W'];
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        return new Set(shuffled.slice(0, Math.max(1, count)));
    }

    _getAllowedDirs(layer) {
        if (layer >= 2) return null; 
        const dirs = this.behaviorState?.layerDirs;
        if (!dirs) return null;
        return dirs[layer] ?? null;
    }

    _tickLayerDirs(s) {
        const quadrantCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);

        if (!s.layerDirs) return;
        if (!s.layerDirLife) s.layerDirLife = {};

        if (quadrantCount >= 4) {
            for (const layer in s.layerDirs) {
                if (s.layerDirs[layer] !== null) {
                    const l = parseInt(layer);
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[layer] = null; } });
                }
            }
            return;
        }

        for (const layer in s.layerDirs) {
            if (parseInt(layer) >= 2) continue;

            s.layerDirLife[layer] = (s.layerDirLife[layer] ?? 1) - 1;
            if (s.layerDirLife[layer] <= 0) {
                const newDirs = this._pickLayerDirs(quadrantCount);
                const l = parseInt(layer);
                this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[layer] = newDirs; } });
                s.layerDirLife[layer] = 4 + Math.floor(Math.random() * 4);
            }
        }
    }

    // =========================================================
    // GLOBAL BEHAVIOR 1: Step Pattern
    // =========================================================

    _generateRandomPattern() {
        const arr = [true, true, true, false, false, false];
        for (let i = 5; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    _generateDistinctPattern(existing) {
        let attempt;
        do {
            attempt = this._generateRandomPattern();
        } while (attempt.join() === existing.join());
        return attempt;
    }

    _getStepPattern() {
        return this.behaviorState.pattern || [true, false, false, true, true, false];
    }

    _getPausePattern() {
        return this.behaviorState.pausePattern || [true, true, false, true, false, false];
    }

    // =========================================================
    // GLOBAL BEHAVIOR 4: Strip seeding
    // =========================================================

    _generateSeedSchedule(scx, scy) {
        const schedule = {};
        const dirs = ['N', 'S', 'E', 'W'];
        const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;

        const addToSchedule = (layer, dir, stepPool) => {
            const step = stepPool[Math.floor(Math.random() * stepPool.length)];
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer, dir, originX: scx, originY: scy });
        };

        if (maxLayer >= 1) {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(1, d, [0, 1, 2]));
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [3, 4, 5]));
        } else {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [0, 1, 2, 3, 4, 5]));
        }

        if (maxLayer >= 2) {
            ['E', 'W'].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(2, d, [0, 1, 2]));
        }
        if (maxLayer >= 3) {
            ['N', 'S'].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(3, d, [0, 1, 2]));
        }

        return schedule;
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        const boost = this.c.get('quantizedGenerateV2SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY } of scheduled) {
            this.actionBuffer.push({
                layer,
                fn: () => {
                    const strip = this._createStrip(layer, dir, originX, originY);
                    strip.isSpine = true;
                    strip.boostSteps = boost;
                }
            });
        }
    }

    _deactivateStrip(strip) {
        strip.active = false;
        this.strips.delete(strip.id);
    }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = {
            id,
            layer,
            direction: dir,
            originX,
            originY,
            headX: originX,
            headY: originY,
            pattern: this._getStepPattern(),
            pausePattern: this._getPausePattern(),
            stepPhase: 0,
            growCount: 0,
            paused: false,
            active: true,
            blockIds: []
        };
        this.strips.set(id, strip);
        return strip;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 1 + 4: Strip tick
    // =========================================================

    _tickStrips(s) {
        const allowAsymmetry = !!this.c.get('quantizedGenerateV2AllowAsymmetry');

        if (allowAsymmetry) {
            if (!s.deferredCols) s.deferredCols = new Map();
            if (!s.deferredRows) s.deferredRows = new Map();

            for (const [col, ticks] of s.deferredCols.entries()) {
                if (ticks <= 1) s.deferredCols.delete(col);
                else s.deferredCols.set(col, ticks - 1);
            }
            for (const [row, ticks] of s.deferredRows.entries()) {
                if (ticks <= 1) s.deferredRows.delete(row);
                else s.deferredRows.set(row, ticks - 1);
            }

            if (Math.random() < 0.2) {
                const bs = this.getBlockSize();
                const halfW = Math.floor(this.g.cols / bs.w / 2);
                const halfH = Math.floor(this.g.rows / bs.h / 2);

                const isCol = Math.random() < 0.5;
                if (isCol) {
                    const colOffset = Math.floor((Math.random() * 2 - 1) * (halfW + 5));
                    s.deferredCols.set(s.scx + colOffset, 1 + Math.floor(Math.random() * 2));
                } else {
                    const rowOffset = Math.floor((Math.random() * 2 - 1) * (halfH + 5));
                    s.deferredRows.set(s.scy + rowOffset, 1 + Math.floor(Math.random() * 2));
                }
            }
        }

        const gridCX = Math.floor(this.logicGridW / 2);
        const gridCY = Math.floor(this.logicGridH / 2);
        s.allowNudges = !!this.c.get('quantizedGenerateV2L3AllowNudges');

        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            if (allowAsymmetry && strip.layer < 2) {
                if (s.deferredCols?.has(strip.headX) || s.deferredRows?.has(strip.headY)) {
                    continue;
                }
            }

            const grid = this.layerGrids?.[strip.layer];
            const gx = gridCX + strip.headX;
            const gy = gridCY + strip.headY;
            const headOnBlock = !!grid && gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH
                && grid[gy * this.logicGridW + gx] !== -1;
            if (!headOnBlock) continue;

            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                strip.pattern = this._generateRandomPattern();
                strip.pausePattern = this._generateDistinctPattern(strip.pattern);
            }

            let shouldGrow;
            if (strip.boostSteps > 0) {
                shouldGrow = true;
                strip.boostSteps--;
            } else {
                const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                shouldGrow = pattern[strip.stepPhase];
            }

            if (shouldGrow) {
                this.actionBuffer.push({
                    layer: strip.layer,
                    isSpine: !!strip.isSpine,
                    fn: () => this._growStrip(strip, s)
                });
            }

            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _dirDelta(dir) {
        switch (dir) {
            case 'N': return [0, -1];
            case 'S': return [0,  1];
            case 'E': return [1,  0];
            case 'W': return [-1, 0];
        }
        return [0, 0];
    }

    // =========================================================
    // GLOBAL BEHAVIOR 2 + 3: Block sizing
    // =========================================================

    _calcBlockSize(strip, fillRatio) {
        const fillThreshold = this.c.get('quantizedGenerateV2FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };

        const maxScale = this.c.get('quantizedGenerateV2MaxBlockScale') ?? 3;
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const halfW = Math.floor(visW / 2);
        const halfH = Math.floor(visH / 2);

        const ox = strip.originX;
        const oy = strip.originY;
        const dir = strip.direction;

        let distFactor, axisRatio;
        if (dir === 'N') {
            distFactor = halfH > 0 ? (oy + halfH) / halfH : 1;
            axisRatio = visH / Math.max(1, visW);
        } else if (dir === 'S') {
            distFactor = halfH > 0 ? (halfH - oy) / halfH : 1;
            axisRatio = visH / Math.max(1, visW);
        } else if (dir === 'E') {
            distFactor = halfW > 0 ? (halfW - ox) / halfW : 1;
            axisRatio = visW / Math.max(1, visH);
        } else { // W
            distFactor = halfW > 0 ? (ox + halfW) / halfW : 1;
            axisRatio = visW / Math.max(1, visH);
        }

        distFactor = Math.max(0, Math.min(2, distFactor));
        const size = Math.min(maxScale, Math.max(1, Math.round(distFactor * axisRatio)));

        return (dir === 'N' || dir === 'S')
            ? { bw: 1, bh: size }
            : { bw: size, bh: 1 };
    }

    // =========================================================
    // GLOBAL BEHAVIOR 4: Strip growth
    // =========================================================

    _spawnBlock(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false) {
        const id = super._spawnBlock(x, y, w, h, layer, isShifter, expireFrames, skipConnectivity, allowInternal, suppressFades, isMirroredSpawn, bypassOccupancy);
        if (id !== -1) {
            const s = this.behaviorState;
            if (!s.layerMaxDist) s.layerMaxDist = {};
            if (!s.layerMaxDist[layer]) s.layerMaxDist[layer] = { N: 0, S: 0, E: 0, W: 0 };
            
            const md = s.layerMaxDist[layer];
            const rx = x - s.scx;
            const ry = y - s.scy;
            
            if (ry < 0) md.N = Math.max(md.N, -ry);
            if (ry > 0) md.S = Math.max(md.S, ry + h - 1);
            if (rx > 0) md.E = Math.max(md.E, rx + w - 1);
            if (rx < 0) md.W = Math.max(md.W, -rx);
        }
        return id;
    }

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);
        let { bw, bh } = strip.fixedSize ? { bw: 1, bh: 1 } : this._calcBlockSize(strip, s.fillRatio);

        if (strip.layer >= 2 && !strip.fixedSize && Math.random() < 0.5) {
            const burst = 1 + Math.floor(Math.random() * 2);
            if (dx !== 0) bw += burst;
            if (dy !== 0) bh += burst;
        }

        const lmd = s.layerMaxDist || {};
        const l0md = lmd[0] || { N: 0, S: 0, E: 0, W: 0 };

        if (strip.layer === 2) {
            if (!strip.isSpine) {
                const headRX = strip.headX - s.scx;
                const headRY = strip.headY - s.scy;
                const exceeds =
                    (strip.direction === 'N' && -headRY > l0md.N + 1) ||
                    (strip.direction === 'S' &&  headRY > l0md.S + 1) ||
                    (strip.direction === 'E' &&  headRX > l0md.E + 1) ||
                    (strip.direction === 'W' && -headRX > l0md.W + 1);
                if (exceeds) { this._deactivateStrip(strip); return; }
            }
        } else if (strip.layer === 3) {
            if (!strip.isSpine) {
                const headRX = strip.headX - s.scx;
                const headRY = strip.headY - s.scy;
                const exceeds =
                    (strip.direction === 'N' && -headRY > l0md.N + 2) ||
                    (strip.direction === 'S' &&  headRY > l0md.S + 2) ||
                    (strip.direction === 'E' &&  headRX > l0md.E + 2) ||
                    (strip.direction === 'W' && -headRX > l0md.W + 2);
                if (exceeds) { this._deactivateStrip(strip); return; }
            }
        }

        if (strip.layer < 3) {
            const otherLayer = 3;
            if (this._isOccupied(strip.headX + dx, strip.headY + dy, otherLayer)) {
                this._removeBlock(strip.headX + dx, strip.headY + dy, bw, bh, otherLayer);
            }
        }

        const newHeadX = strip.headX + dx * bw;
        const newHeadY = strip.headY + dy * bh;

        if (this.checkScreenEdge(newHeadX, newHeadY)) {
            this._deactivateStrip(strip);
            return;
        }

        const spawnX = dx > 0 ? strip.headX + 1 : newHeadX;
        const spawnY = dy > 0 ? strip.headY + 1 : newHeadY;

        const id = this._spawnBlock(
            spawnX, spawnY, bw, bh, strip.layer,
            false, 0, true, true, true, false, true
        );

        if (id !== -1) {
            strip.blockIds.push(id);
            strip.headX = newHeadX;
            strip.headY = newHeadY;
            strip.growCount++;
            this._gridsDirty = true;

            // Layer Nudge Logic: L2 moves shift L3 blocks
            if (strip.layer === 2 && s.allowNudges) {
                this._nudgeLayer3(strip.direction, s);
            }
        }
    }

    _nudgeLayer3(direction, s) {
        const dx = 0;
        const dy = direction === 'N' ? -1 : (direction === 'S' ? 1 : 0);
        if (dx === 0 && dy === 0) return;

        const scx = s.scx;
        const scy = s.scy;

        for (const b of this.activeBlocks) {
            if (b.layer === 3) {
                const ry = b.y - scy;
                if ((direction === 'N' && ry < 0) || (direction === 'S' && ry > 0)) {
                    b.y += dy;
                }
            }
        }

        for (const strip of this.strips.values()) {
            if (strip.layer === 3 && strip.active) {
                const sry = strip.headY - scy;
                if ((direction === 'N' && sry < 0) || (direction === 'S' && sry > 0)) {
                    strip.headY += dy;
                    strip.originY += dy;
                }
            }
        }

        this.maskOps.push({
            type: 'shiftBlocks',
            layer: 3,
            quadrant: direction,
            dx: dx,
            dy: dy,
            scx: scx,
            scy: scy
        });

        this._gridsDirty = true;
        this._maskDirty = true;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 2: Fill ratio tracking
    // =========================================================

    _updateFillRatio(s) {
        const bs = this.getBlockSize();
        const visW = Math.max(1, Math.floor(this.g.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.g.rows / bs.h));
        const halfW = Math.floor(visW / 2);
        const halfH = Math.floor(visH / 2);
        const totalCells = visW * visH;

        let filledCells = 0;
        for (const b of this.activeBlocks) {
            const bx1 = Math.max(-halfW, b.x);
            const bx2 = Math.min(halfW - 1, b.x + b.w - 1);
            const by1 = Math.max(-halfH, b.y);
            const by2 = Math.min(halfH - 1, b.y + b.h - 1);
            if (bx2 >= bx1 && by2 >= by1) {
                filledCells += (bx2 - bx1 + 1) * (by2 - by1 + 1);
            }
        }

        s.fillRatio = Math.min(1, filledCells / totalCells);
        this.behaviorState.fillRatio = s.fillRatio;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 4b: Inside-out expansion
    // =========================================================

    _expandInsideOut(s) {
        if (!this.c.get('quantizedGenerateV2InsideOutEnabled')) return;

        const delay  = this.c.get('quantizedGenerateV2InsideOutDelay')  ?? 6;
        const period = Math.max(1, this.c.get('quantizedGenerateV2InsideOutPeriod') ?? 3);

        if (s.step < delay) return;
        if ((s.step - delay) % period !== 0) return;

        const bs    = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2);
        const halfH = Math.floor(this.g.rows / bs.h / 2);
        const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;

        const l0md = (s.layerMaxDist || {})[0] || { N: 0, S: 0, E: 0, W: 0 };

        if (!s.pendingExpansions) s.pendingExpansions = [];
        const stillPending = [];
        for (const pe of s.pendingExpansions) {
            if (pe.l === 3) {
                const rx = pe.ox - s.scx;
                const ry = pe.oy - s.scy;
                if (pe.dir === 'N' && -ry > l0md.N + 2) continue;
                if (pe.dir === 'S' &&  ry > l0md.S + 2) continue;
                if (pe.dir === 'E' &&  rx > l0md.E + 2) continue;
                if (pe.dir === 'W' && -rx > l0md.W + 2) continue;
            }

            const allowed = this._getAllowedDirs(pe.l);
            if (!allowed || allowed.has(pe.dir)) {
                const { l, dir, ox, oy } = pe;
                this.actionBuffer.push({ layer: l, fn: () => {
                    this._createStrip(l, dir, ox, oy).isExpansion = true;
                }});
            } else {
                stillPending.push(pe);
            }
        }
        s.pendingExpansions = stillPending;

        const wave = s.insideOutWave;
        const edgeBuf = 2; // match checkScreenEdge extension — seed strips up to 2 blocks past screen edge
        if (wave > halfW + edgeBuf && wave > halfH + edgeBuf) return;

        const axisAdjacent = (wave <= 1);

        for (let l = 0; l <= maxLayer; l++) {
            const allowed = axisAdjacent ? null : this._getAllowedDirs(l);

            for (const dy of [wave, -wave]) {
                const oy = s.scy + dy;
                if (oy >= -(halfH + edgeBuf) && oy <= halfH + edgeBuf) {
                    if (l === 2) continue;
                    if (l === 3) {
                        if (dy < 0 && -dy > l0md.N + 2) continue;
                        if (dy > 0 &&  dy > l0md.S + 2) continue;
                    }

                    const eOk = !allowed || allowed.has('E');
                    const wOk = !allowed || allowed.has('W');
                    if (eOk || wOk) {
                        this.actionBuffer.push({ layer: l, fn: () => {
                            if (eOk) this._createStrip(l, 'E', s.scx, oy).isExpansion = true;
                            if (wOk) this._createStrip(l, 'W', s.scx, oy).isExpansion = true;
                        }});
                    }
                    if (!eOk) s.pendingExpansions.push({ l, dir: 'E', ox: s.scx, oy });
                    if (!wOk) s.pendingExpansions.push({ l, dir: 'W', ox: s.scx, oy });
                }
            }

            for (const dx of [wave, -wave]) {
                const ox = s.scx + dx;
                if (ox >= -(halfW + edgeBuf) && ox <= halfW + edgeBuf) {
                    if (l === 3) continue;

                    const nOk = !allowed || allowed.has('N');
                    const sOk = !allowed || allowed.has('S');
                    if (nOk || sOk) {
                        this.actionBuffer.push({ layer: l, fn: () => {
                            if (nOk) this._createStrip(l, 'N', ox, s.scy).isExpansion = true;
                            if (sOk) this._createStrip(l, 'S', ox, s.scy).isExpansion = true;
                        }});
                    }
                    if (!nOk) s.pendingExpansions.push({ l, dir: 'N', ox, oy: s.scy });
                    if (!sOk) s.pendingExpansions.push({ l, dir: 'S', ox, oy: s.scy });
                }
            }
        }

        s.insideOutWave++;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 5: Intersection detection
    // =========================================================

    _checkIntersections() {
        if (!this.c.get('quantizedGenerateV2IntersectionPause')) return;
        const pauseChance = this.c.get('quantizedGenerateV2IntersectionPauseChance') ?? 0.5;

        const vStrips = [], hStrips = [];
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;
            if (strip.direction === 'N' || strip.direction === 'S') vStrips.push(strip);
            else hStrips.push(strip);
        }

        const checkGroup = (group) => {
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    if (group[i].growCount > 0 && group[i].growCount === group[j].growCount) {
                        if (Math.random() < pauseChance) group[i].paused = !group[i].paused;
                        if (Math.random() < pauseChance) group[j].paused = !group[j].paused;
                    }
                }
            }
        };

        checkGroup(vStrips);
        checkGroup(hStrips);
    }

    // =========================================================
    // GENERATIVE SCALING
    // =========================================================

    _processIntents() {
        const scalingEnabled = this.c.get('quantizedGenerateV2GenerativeScaling');

        for (const intent of this.actionBuffer) {
            if (!this.actionQueues.has(intent.layer)) {
                this.actionQueues.set(intent.layer, []);
            }
            this.actionQueues.get(intent.layer).push(intent);
        }
        this.actionBuffer = [];

        for (const [layer, queue] of this.actionQueues.entries()) {
            if (scalingEnabled) {
                const spines = [];
                const others = [];
                while (queue.length > 0) {
                    const intent = queue.shift();
                    if (intent.isSpine) spines.push(intent);
                    else others.push(intent);
                }

                for (const spineIntent of spines) {
                    if (spineIntent.fn) spineIntent.fn();
                }

                let budget = 0;
                if (others.length > 0) {
                    budget = Math.max(1, Math.round(others.length * 0.4));
                }

                const toProcess = Math.min(budget, others.length);
                for (let i = 0; i < toProcess; i++) {
                    const intent = others.shift();
                    if (intent && intent.fn) intent.fn();
                }

                if (others.length > 0) {
                    this.actionQueues.set(layer, others);
                } else {
                    this.actionQueues.delete(layer);
                }
            } else {
                while (queue.length > 0) {
                    const intent = queue.shift();
                    if (intent && intent.fn) intent.fn();
                }
            }
        }
    }

    // =========================================================
    // CORE GROWTH LOOP
    // =========================================================

    _attemptGrowth() {
        if (this.expansionComplete && !this.manualStep) return;

        const s = this.behaviorState;

        if (s.pendingDeletions && s.pendingDeletions.length > 0) {
            for (const d of s.pendingDeletions) {
                this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
            }
            s.pendingDeletions = [];
        }

        if (!s.seedSchedule) {
            s.pattern      = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            if (!s.layerDirs) {
                const qCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);
                const qMaxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
                const qBaseLife = 4 + Math.floor(Math.random() * 3);
                s.layerDirs = {};
                s.layerDirLife = {};
                for (let l = 0; l <= qMaxLayer + 1; l++) {
                    s.layerDirs[l] = this._pickLayerDirs(qCount);
                    s.layerDirLife[l] = qBaseLife + l;
                }
            }
            s.seedSchedule = this._generateSeedSchedule(s.scx ?? 0, s.scy ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }

        if (this.activeBlocks.length === 0) {
            const ox = s.scx ?? 0;
            const oy = s.scy ?? 0;
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            for (let l = 0; l <= maxLayer; l++) {
                this._spawnBlock(ox, oy, 1, 1, l, false, 0, true, true, true, false, true);
            }
        }

        s.growTimer++;

        const speed = this.c.get('quantizedGenerateV2Speed') || 1;
        const delay = Math.max(1, Math.floor(11 - speed));
        if (!this.manualStep && s.growTimer % delay !== 0) return;

        this.actionBuffer = [];

        this._tickLayerDirs(s);
        this._updateFillRatio(s);
        this._seedStrips(s);
        this._tickStrips(s);
        this._checkIntersections();
        this._expandInsideOut(s);

        for (const behavior of this.growthPool.values()) {
            if (behavior.fn && behavior.enabled) {
                behavior.fn.call(this, s);
            }
        }

        this._processIntents();

        s.step++;
        this._updateRenderGridLogic();
    }

    // =========================================================
    // HELPERS
    // =========================================================

    _isOccupied(x, y, layer) {
        return this.maskOps.some(op =>
            op.layer === layer &&
            op.type === 'addBlock' &&
            x >= op.x1 && x <= op.x2 &&
            y >= op.y1 && y <= op.y2
        );
    }

    checkScreenEdge(bx, by) {
        const bs = this.getBlockSize();
        const halfVisibleW = Math.floor(this.g.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.g.rows / bs.h / 2);
        const extension = 2;
        const limitW = halfVisibleW + extension;
        const limitH = halfVisibleH + extension;

        const edges = {
            left: bx <= -limitW,
            right: bx >= limitW,
            top: by <= -limitH,
            bottom: by >= limitH
        };

        return (edges.left || edges.right || edges.top || edges.bottom) ? edges : false;
    }

    _removeBlock(x, y, w, h, layer) {
        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        
        this.maskOps.push({
            type: 'removeBlock',
            x1, y1, x2, y2,
            layer: layer, startFrame: this.animFrame, fade: true
        });

        this.activeBlocks = this.activeBlocks.filter(b => 
            !(b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h)
        );

        this._writeToGrid(x, y, w, h, -1, layer);

        this._gridsDirty = true;
        this._maskDirty = true;
    }

    stop() {
        super.stop();
    }
}
