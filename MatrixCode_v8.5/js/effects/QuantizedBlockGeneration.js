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
            let candidates;
            if (useHAxis) {
                candidates = this.activeBlocks.filter(b => b.layer <= 1 && b.y <= s.scy && s.scy <= b.y + b.h - 1);
            } else {
                candidates = this.activeBlocks.filter(b => b.layer <= 1 && b.x <= s.scx && s.scx <= b.x + b.w - 1);
            }

            if (candidates.length === 0) return;

            const processCandidate = (block) => {
                const layer = Math.min(1, block.layer);
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

                const nudgeCount = Array.from(this.strips.values()).filter(st => st.isNudge && st.active).length;
                if (nudgeCount >= maxStrips) return;

                const strip = this._createStrip(layer, dir, nx, ny);
                strip.isNudge = true;
                strip.stepPhase = Math.floor(Math.random() * 6);
            };

            if (scalingEnabled) {
                // In scaling mode, every candidate is a possible event
                for (const block of candidates) {
                    this.actionBuffer.push({ layer: Math.min(1, block.layer), fn: () => processCandidate(block) });
                }
            } else {
                // Default mode: pick one
                const block = candidates[Math.floor(Math.random() * candidates.length)];
                this.actionBuffer.push({ layer: Math.min(1, block.layer), fn: () => processCandidate(block) });
            }

        }, {
            enabled: this.c.get('quantizedGenerateV2NudgeEnabled') ?? true,
            label: 'Main Nudge Growth'
        });

        // ─────────────────────────────────────────────────────
        // Behavior 2: Invisible Layer Growth
        // ─────────────────────────────────────────────────────
        this.registerBehavior('invisible_layer_growth', function(s) {
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            const hasL2 = maxLayer >= 2;
            const hasL3 = maxLayer >= 3;
            if (!hasL2 && !hasL3) return;

            const spawnChance = this.c.get('quantizedGenerateV2InvisibleChance') ?? 0.3;
            const maxStrips = this.c.get('quantizedGenerateV2MaxInvisibleStrips') ?? 8;
            const minSpacing = this.c.get('quantizedGenerateV2InvisibleSpacing') ?? 3;
            const scalingEnabled = this.c.get('quantizedGenerateV2GenerativeScaling');

            const targetLayers = [];
            if (hasL2) targetLayers.push(2);
            if (hasL3) targetLayers.push(3);

            for (const targetLayer of targetLayers) {
                if (Math.random() > spawnChance) continue;

                const useHAxis = (targetLayer === 2);
                let candidates;
                if (useHAxis) {
                    candidates = this.activeBlocks.filter(b => b.layer === 2 && b.y <= s.scy && s.scy <= b.y + b.h - 1);
                } else {
                    candidates = this.activeBlocks.filter(b => b.layer === 3 && b.x <= s.scx && s.scx <= b.x + b.w - 1);
                }

                if (candidates.length === 0) continue;

                const processCandidate = (block) => {
                    let invCount = Array.from(this.strips.values()).filter(st => st.isInvisible && st.active).length;
                    if (invCount >= maxStrips) return;

                    const allowed = this._getAllowedDirs(targetLayer);
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

                    for (const strip of this.strips.values()) {
                        if (!strip.isInvisible) continue;
                        if (Math.abs(strip.originX - nx) + Math.abs(strip.originY - ny) < minSpacing) return;
                    }

                    const strip = this._createStrip(targetLayer, dir, nx, ny);
                    strip.isInvisible = true;
                    strip.stepPhase = Math.floor(Math.random() * 6);
                };

                if (scalingEnabled) {
                    for (const block of candidates) {
                        this.actionBuffer.push({ layer: targetLayer, fn: () => processCandidate(block) });
                    }
                } else {
                    const block = candidates[Math.floor(Math.random() * candidates.length)];
                    this.actionBuffer.push({ layer: targetLayer, fn: () => processCandidate(block) });
                }
            }

        }, {
            enabled: this.c.get('quantizedGenerateV2InvisibleEnabled') ?? true,
            label: 'Invisible Layer Growth'
        });
    

        // ─────────────────────────────────────────────────────
        // Future sub-behaviors go here.
        //
        // Template:
        //   this.registerBehavior('my_behavior', function(s) {
        //       const chance = 0.1;
        //       if (Math.random() > chance) return;
        //       // s.scx / s.scy  — center origin (logical coords)
        //       // s.step         — global tick count
        //       // s.fillRatio    — current fill fraction (0–1)
        //       // this.strips    — Map of all active strip objects
        //       // this._spawnBlock(x, y, w, h, layer, false, 0, true, true, true, false, true)
        //       // this.checkScreenEdge(x, y)  — returns false or edges object
        //   }, { label: 'My Behavior' });
        // ─────────────────────────────────────────────────────
    }

    // =========================================================
    // QUADRANT RESTRICTION HELPERS
    // =========================================================

    /**
     * Returns a random Set of `count` cardinal directions for a layer.
     * Returns null if count >= 4 (no restriction).
     * @param {number} count
     * @returns {Set<string>|null}
     */
    _pickLayerDirs(count) {
        if (count >= 4) return null;
        const all = ['N', 'S', 'E', 'W'];
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        return new Set(shuffled.slice(0, Math.max(1, count)));
    }

    /**
     * Returns the allowed direction Set for a layer, or null if unrestricted.
     * @param {number} layer
     * @returns {Set<string>|null}
     */
    _getAllowedDirs(layer) {
        const dirs = this.behaviorState?.layerDirs;
        if (!dirs) return null;
        return dirs[layer] ?? null;
    }

    /**
     * Ticks per-layer direction life timers each growth step.
     * Expired layers queue a direction-change intent through actionBuffer (same as strip growth)
     * so updates are ordered alongside other growth events rather than applied immediately.
     */
    _tickLayerDirs(s) {
        const quadrantCount = parseInt(this.c.get('quantizedGenerateV2QuadrantCount') ?? 4);

        if (!s.layerDirs) return;
        if (!s.layerDirLife) s.layerDirLife = {};

        if (quadrantCount >= 4) {
            // Unrestricted — clear any lingering restrictions so switching to "All" mid-run works
            for (const layer in s.layerDirs) {
                if (s.layerDirs[layer] !== null) {
                    const l = parseInt(layer);
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[layer] = null; } });
                }
            }
            return;
        }

        for (const layer in s.layerDirs) {
            s.layerDirLife[layer] = (s.layerDirLife[layer] ?? 1) - 1;
            if (s.layerDirLife[layer] <= 0) {
                const newDirs = this._pickLayerDirs(quadrantCount);
                const l = parseInt(layer);
                // Queue the change through actionBuffer — applied in order with strip growth
                this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[layer] = newDirs; } });
                // Re-arm timer immediately (4–7 steps) so the next cycle is already scheduled
                s.layerDirLife[layer] = 4 + Math.floor(Math.random() * 4);
            }
        }
    }

    // =========================================================
    // GLOBAL BEHAVIOR 1: Step Pattern (6-step hard gate)
    // =========================================================

    /**
     * Generates a random valid 6-step pattern with exactly 3 active steps.
     * @returns {boolean[]}
     */
    _generateRandomPattern() {
        const arr = [true, true, true, false, false, false];
        for (let i = 5; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Generates a random pattern that is different from the provided one.
     * @param {boolean[]} existing
     * @returns {boolean[]}
     */
    _generateDistinctPattern(existing) {
        let attempt;
        do {
            attempt = this._generateRandomPattern();
        } while (attempt.join() === existing.join());
        return attempt;
    }

    /** Returns the step pattern generated at trigger time. */
    _getStepPattern() {
        return this.behaviorState.pattern || [true, false, false, true, true, false];
    }

    /** Returns the pause pattern generated at trigger time. */
    _getPausePattern() {
        return this.behaviorState.pausePattern || [true, true, false, true, false, false];
    }

    // =========================================================
    // GLOBAL BEHAVIOR 4: Strip seeding
    // =========================================================

    /**
     * Generates a schedule mapping step numbers → [{layer, dir, originX, originY}].
     * L0 and L1 each get all 4 cardinal directions spread randomly across steps 0–5.
     */
    _generateSeedSchedule(scx, scy) {
        const schedule = {};
        const dirs = ['N', 'S', 'E', 'W'];
        const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;

        const addToSchedule = (layer, dir, stepPool) => {
            // Spine strips are always seeded in all 4 directions regardless of quadrant restriction.
            // The restriction only applies to secondary growth (nudge, invisible, inside-out),
            // ensuring the backbone grows normally from center out.
            const step = stepPool[Math.floor(Math.random() * stepPool.length)];
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer, dir, originX: scx, originY: scy });
        };

        if (maxLayer >= 1) {
            // L1 seeds first (steps 0–2) so it starts growing before L0
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(1, d, [0, 1, 2]));
            // L0 seeds second (steps 3–5)
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [3, 4, 5]));
        } else {
            // Only L0 — spread across full range
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [0, 1, 2, 3, 4, 5]));
        }

        // L2: E and W spines along the horizontal axis (y=scy)
        if (maxLayer >= 2) {
            ['E', 'W'].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(2, d, [0, 1, 2]));
        }
        // L3: N and S spines along the vertical axis (x=scx)
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

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = {
            id,
            layer,
            direction: dir,
            originX,
            originY,
            headX: originX,  // current head position (furthest placed block)
            headY: originY,
            pattern: this._getStepPattern(),
            pausePattern: this._getPausePattern(),
            stepPhase: 0,    // current position in the 6-step cycle (0–5)
            growCount: 0,    // number of active growth steps that fired
            paused: false,   // true = using pausePattern instead of main pattern
            active: true,
            blockIds: []     // IDs of all spawned blocks in this strip
        };
        this.strips.set(id, strip);
        return strip;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 1 + 4: Strip tick (per-strip 6-step gate)
    // =========================================================

    _tickStrips(s) {
        const allowAsymmetry = !!this.c.get('quantizedGenerateV2AllowAsymmetry');

        // Update deferred states
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

            // Probability to defer a new column or row this step
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

        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            // Check if strip is in a deferred column or row
            if (allowAsymmetry) {
                if (s.deferredCols?.has(strip.headX) || s.deferredRows?.has(strip.headY)) {
                    continue;
                }
            }

            const headOnBlock = this.activeBlocks.some(b =>
                b.layer === strip.layer &&
                strip.headX >= b.x && strip.headX <= b.x + b.w - 1 &&
                strip.headY >= b.y && strip.headY <= b.y + b.h - 1
            );
            if (!headOnBlock) continue;

            // Randomize pattern on cycle reset if asymmetry is enabled
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
                    fn: () => this._growStrip(strip, s)
                });
            }

            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    /** Returns [dx, dy] unit delta for a cardinal direction. */
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
    // GLOBAL BEHAVIOR 2 + 3: Block sizing (fill threshold + aspect ratio)
    // =========================================================

    /**
     * Computes the block size for a strip's next growth step.
     * - Below fill threshold: always 1×1.
     * - Above fill threshold: size scales with aspect ratio × distance-from-edge factor.
     * @returns {{ bw: number, bh: number }}
     */
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

        // Distance factor: how far the origin is from the target edge (0=close, 2=far)
        let distFactor, axisRatio;
        if (dir === 'N') {
            distFactor = halfH > 0 ? (oy + halfH) / halfH : 1; // north edge is at -halfH
            axisRatio = visH / Math.max(1, visW);
        } else if (dir === 'S') {
            distFactor = halfH > 0 ? (halfH - oy) / halfH : 1; // south edge is at +halfH
            axisRatio = visH / Math.max(1, visW);
        } else if (dir === 'E') {
            distFactor = halfW > 0 ? (halfW - ox) / halfW : 1; // east edge is at +halfW
            axisRatio = visW / Math.max(1, visH);
        } else { // W
            distFactor = halfW > 0 ? (ox + halfW) / halfW : 1; // west edge is at -halfW
            axisRatio = visW / Math.max(1, visH);
        }

        distFactor = Math.max(0, Math.min(2, distFactor));
        const size = Math.min(maxScale, Math.max(1, Math.round(distFactor * axisRatio)));

        // Size applies along the strip's growth axis only (Behavior 2: spines only)
        return (dir === 'N' || dir === 'S')
            ? { bw: 1, bh: size }
            : { bw: size, bh: 1 };
    }

    // =========================================================
    // GLOBAL BEHAVIOR 4: Strip growth (spawn next block at head)
    // =========================================================

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);
        const { bw, bh } = strip.fixedSize ? { bw: 1, bh: 1 } : this._calcBlockSize(strip, s.fillRatio);

        // New head = leading edge of the block in growth direction (used for edge check + head advance).
        const newHeadX = strip.headX + dx * bw;
        const newHeadY = strip.headY + dy * bh;

        if (this.checkScreenEdge(newHeadX, newHeadY)) {
            strip.active = false;
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
        }
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
            // Intersect block bounds with visible area
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
        const maxLayer = Math.min(1, this.c.get('quantizedGenerateV2LayerCount') ?? 0);

        // Retry expansions that were blocked in previous waves.
        // This runs every wave period regardless of wave bounds so pending
        // strips always get a chance to fire once their direction rotates in.
        if (!s.pendingExpansions) s.pendingExpansions = [];
        const stillPending = [];
        for (const pe of s.pendingExpansions) {
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

        // Wave counter bounds check — after retrying pending so those still fire.
        const wave = s.insideOutWave;
        if (wave > halfW && wave > halfH) return;

        // Wave 1 rows/columns sit immediately beside each axis and are structurally
        // critical — always seed them unconditionally regardless of the restriction.
        const axisAdjacent = (wave <= 1);

        for (let l = 0; l <= maxLayer; l++) {
            const allowed = axisAdjacent ? null : this._getAllowedDirs(l);

            for (const dy of [wave, -wave]) {
                const oy = s.scy + dy;
                if (oy > -halfH && oy < halfH) {
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
                if (ox > -halfW && ox < halfW) {
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
    // GLOBAL BEHAVIOR 5: Intersection detection + pattern swap
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

        // 1. Move everything from actionBuffer into persistent actionQueues
        const newCounts = new Map(); // layer -> count
        for (const intent of this.actionBuffer) {
            if (!this.actionQueues.has(intent.layer)) {
                this.actionQueues.set(intent.layer, []);
            }
            this.actionQueues.get(intent.layer).push(intent);
            newCounts.set(intent.layer, (newCounts.get(intent.layer) || 0) + 1);
        }
        this.actionBuffer = [];

        // 2. Process per layer independently
        for (const [layer, queue] of this.actionQueues.entries()) {
            if (scalingEnabled) {
                const newCount = newCounts.get(layer) || 0;
                let budget = 0;

                if (newCount > 0) {
                    // Scale based on the number of NEW events possible this step
                    // 4 events -> ~1.6 budget (rounds to 2).
                    // 1 event -> ~0.4 budget (rounds to 1).
                    budget = Math.max(1, Math.round(newCount * 0.4));
                } else if (queue.length > 0) {
                    // If there's a backlog but no new triggers, drain slowly
                    budget = 1;
                }

                // Process exactly the budget from the front of the queue (FIFO)
                // This ensures order is preserved (e.g., cross growth before branching)
                const toProcess = Math.min(budget, queue.length);
                for (let i = 0; i < toProcess; i++) {
                    const intent = queue.shift();
                    if (intent && intent.fn) intent.fn();
                }
            } else {
                // Scaling disabled: flush the entire queue immediately
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

        // Reset buffer for this step
        this.actionBuffer = [];

        // 0. Tick per-layer direction life timers (Quadrant Restriction)
        this._tickLayerDirs(s);

        // 1. Compute visible fill ratio (for Behaviors 2 & 3)
        this._updateFillRatio(s);

        // 2. Seed any strips scheduled for this step (Behavior 4)
        this._seedStrips(s);

        // 3. Advance each strip through its 6-step gate (Behaviors 1 & 4)
        this._tickStrips(s);

        // 4. Detect intersection events and toggle patterns (Behavior 5)
        this._checkIntersections();

        // 4b. Seed inside-out expansion waves (parallel rows/cols at ±1, ±2, ±3…)
        this._expandInsideOut(s);

        // 5. Execute sub-behaviors from the growth pool
        for (const behavior of this.growthPool.values()) {
            if (behavior.fn && behavior.enabled) {
                behavior.fn.call(this, s);
            }
        }

        // 6. Process all intents (Generative Scaling happens here)
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
        this._gridsDirty = true;
    }

    stop() {
        super.stop();
    }
}
