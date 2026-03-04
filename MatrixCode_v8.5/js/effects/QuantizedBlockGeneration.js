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
        if (!super.trigger(force)) return false;

        this.alpha = 1.0;
        this.state = 'GENERATING';
        this.persistentCycleIndex = 0;

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

        // Reset shared state
        this.behaviorState.step = 0;
        this.behaviorState.growTimer = 0;
        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;
        this.behaviorState.hitEdge = false;
        this.behaviorState.snapshots = [];
        this.behaviorState.fillRatio = 0;
        this.behaviorState.insideOutWave = 1;

        // Generate random step patterns for this run (not user-configurable)
        this.behaviorState.pattern = this._generateRandomPattern();
        this.behaviorState.pausePattern = this._generateDistinctPattern(this.behaviorState.pattern);

        // Reset strip system
        this.strips.clear();
        this._stripNextId = 0;

        // Build the strip seeding schedule (spread across first 6 steps)
        this.behaviorState.seedSchedule = this._generateSeedSchedule(scx, scy);

        console.log(`QuantizedBlockGenerator: Starting at ${randomStart ? `random (${scx}, ${scy})` : 'center'}`);

        this._initShadowWorld();

        // Seed origin block(s): at (scx, scy) for random start, or (0,0) for center
        if (randomStart && (scx !== 0 || scy !== 0)) {
            this._initProceduralState(false); // skip the (0,0) default seed
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            for (let l = 0; l <= maxLayer; l++) {
                this._spawnBlock(scx, scy, 1, 1, l, false, 0, true, true, true, false, true);
            }
        } else {
            this._initProceduralState(true); // seeds at (0,0) normally
        }

        this._initBehaviors();
        this._updateRenderGridLogic();

        return true;
    }

    _initBehaviors() {
        // ─────────────────────────────────────────────────────
        // Behavior 1: Main Nudge Growth
        // Spawns perpendicular strips along the two axis lines
        // (horizontal: y=scy, vertical: x=scx), growing outward
        // in the direction perpendicular to that axis.
        // Applies to layers 0 and 1 only.
        // ─────────────────────────────────────────────────────
        this.registerBehavior('main_nudge_growth', function(s) {
            // Respect start delay — let main strips establish first
            const startDelay = this.c.get('quantizedGenerateV2NudgeStartDelay') ?? 4;
            if (s.step < startDelay) return;

            // Probabilistic gate
            const spawnChance = this.c.get('quantizedGenerateV2NudgeChance') ?? 0.3;
            if (Math.random() > spawnChance) return;

            // Cap simultaneous nudge strips
            const maxStrips = this.c.get('quantizedGenerateV2MaxNudgeStrips') ?? 8;
            let nudgeCount = 0;
            for (const strip of this.strips.values()) {
                if (strip.isNudge && strip.active) nudgeCount++;
            }
            if (nudgeCount >= maxStrips) return;

            const minSpacing = this.c.get('quantizedGenerateV2NudgeSpacing') ?? 3;
            const axisBias   = this.c.get('quantizedGenerateV2NudgeAxisBias') ?? 0.5;
            const maxLayer   = Math.min(1, this.c.get('quantizedGenerateV2LayerCount') ?? 0);

            // Choose axis, then find blocks that physically lie on it
            const useHAxis = Math.random() < axisBias;

            let candidates;
            if (useHAxis) {
                // Horizontal axis: y = s.scy
                // Eligible blocks span the scy row (b.y <= scy <= b.y + b.h - 1)
                candidates = this.activeBlocks.filter(b =>
                    b.layer <= 1 &&
                    b.y <= s.scy && s.scy <= b.y + b.h - 1
                );
            } else {
                // Vertical axis: x = s.scx
                // Eligible blocks span the scx column (b.x <= scx <= b.x + b.w - 1)
                candidates = this.activeBlocks.filter(b =>
                    b.layer <= 1 &&
                    b.x <= s.scx && s.scx <= b.x + b.w - 1
                );
            }

            if (candidates.length === 0) return;

            // Pick a random candidate block and anchor the nudge origin within it
            const block = candidates[Math.floor(Math.random() * candidates.length)];
            let nx, ny, dir;

            if (useHAxis) {
                nx  = block.x + Math.floor(Math.random() * block.w);
                ny  = s.scy;
                dir = Math.random() < 0.5 ? 'N' : 'S';
            } else {
                nx  = s.scx;
                ny  = block.y + Math.floor(Math.random() * block.h);
                dir = Math.random() < 0.5 ? 'E' : 'W';
            }

            if (this.checkScreenEdge(nx, ny)) return;

            // Enforce minimum spacing between nudge origins
            for (const strip of this.strips.values()) {
                if (!strip.isNudge) continue;
                if (Math.abs(strip.originX - nx) + Math.abs(strip.originY - ny) < minSpacing) return;
            }

            // Inherit the source block's layer (already clamped to ≤ 1 by filter)
            const layer = Math.min(1, block.layer);

            const strip = this._createStrip(layer, dir, nx, ny);
            strip.isNudge = true;
            strip.stepPhase = Math.floor(Math.random() * 6);

        }, {
            enabled: this.c.get('quantizedGenerateV2NudgeEnabled') ?? true,
            label: 'Main Nudge Growth'
        });

        // ─────────────────────────────────────────────────────
        // Behavior 2: Invisible Layer Growth
        // Mirrors Main Nudge Growth for layers 2 and 3.
        // L2 originates on the X axis (y=scy), grows N or S.
        // L3 originates on the Y axis (x=scx), grows E or W.
        // ─────────────────────────────────────────────────────
        this.registerBehavior('invisible_layer_growth', function(s) {
            // Behavioral rules for Layer 2 and Layer 3 (Invisible Layers)
            // L2: Grows vertically (N/S) from the Horizontal axis (y=scy)
            // L3: Grows horizontally (E/W) from the Vertical axis (x=scx)
            // Growth is "immediate" — as soon as the respective spine exists, nudges can sprout.
            
            const maxLayer = this.c.get('quantizedGenerateV2LayerCount') ?? 0;
            const hasL2 = maxLayer >= 2;
            const hasL3 = maxLayer >= 3;
            if (!hasL2 && !hasL3) return;

            const spawnChance = this.c.get('quantizedGenerateV2InvisibleChance') ?? 0.3;
            const maxStrips = this.c.get('quantizedGenerateV2MaxInvisibleStrips') ?? 8;
            const minSpacing = this.c.get('quantizedGenerateV2InvisibleSpacing') ?? 3;

            // Evaluate both layers independently to allow concurrent immediate growth
            const targetLayers = [];
            if (hasL2) targetLayers.push(2);
            if (hasL3) targetLayers.push(3);

            for (const targetLayer of targetLayers) {
                // Probabilistic gate per layer
                if (Math.random() > spawnChance) continue;

                // Active strip cap check
                let invCount = 0;
                for (const strip of this.strips.values()) {
                    if (strip.isInvisible && strip.active) invCount++;
                }
                if (invCount >= maxStrips) break;

                const useHAxis = (targetLayer === 2);
                let candidates;

                if (useHAxis) {
                    // L2: horizontal axis (y=scy), grow N/S
                    candidates = this.activeBlocks.filter(b =>
                        b.layer === 2 &&
                        b.y <= s.scy && s.scy <= b.y + b.h - 1
                    );
                } else {
                    // L3: vertical axis (x=scx), grow E/W
                    candidates = this.activeBlocks.filter(b =>
                        b.layer === 3 &&
                        b.x <= s.scx && s.scx <= b.x + b.w - 1
                    );
                }

                // "Provided the spine has extended" — meaning spine blocks exist on the axis
                if (candidates.length === 0) continue;

                // Pick a random candidate anchor block from the spine
                const block = candidates[Math.floor(Math.random() * candidates.length)];
                let nx, ny, dir;

                if (useHAxis) {
                    nx  = block.x + Math.floor(Math.random() * block.w);
                    ny  = s.scy;
                    dir = Math.random() < 0.5 ? 'N' : 'S';
                } else {
                    nx  = s.scx;
                    ny  = block.y + Math.floor(Math.random() * block.h);
                    dir = Math.random() < 0.5 ? 'E' : 'W';
                }

                if (this.checkScreenEdge(nx, ny)) continue;

                // Spacing check to avoid origin clumping
                let tooClose = false;
                for (const strip of this.strips.values()) {
                    if (!strip.isInvisible) continue;
                    if (Math.abs(strip.originX - nx) + Math.abs(strip.originY - ny) < minSpacing) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                const strip = this._createStrip(targetLayer, dir, nx, ny);
                strip.isInvisible = true;
                strip.stepPhase   = Math.floor(Math.random() * 6);
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
            const strip = this._createStrip(layer, dir, originX, originY);
            strip.isSpine = true;
            strip.boostSteps = boost; // grow unconditionally for this many ticks first
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
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            // A strip may only tick when a block already exists at its head position.
            // Spine strips always pass (origin block placed at trigger time).
            // Expansion strips wait here until the spine grows into their row/column,
            // enforcing the inside-out ordering without burning step-pattern slots.
            const headOnBlock = this.activeBlocks.some(b =>
                strip.headX >= b.x && strip.headX <= b.x + b.w - 1 &&
                strip.headY >= b.y && strip.headY <= b.y + b.h - 1
            );
            if (!headOnBlock) continue;

            // Spine boost: grow unconditionally for the first N ticks so the
            // cardinal spines establish a visible lead before expansion follows.
            let shouldGrow;
            if (strip.boostSteps > 0) {
                shouldGrow = true;
                strip.boostSteps--;
            } else {
                const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                shouldGrow = pattern[strip.stepPhase];
            }

            if (shouldGrow) {
                this._growStrip(strip, s);
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
        // This is the same regardless of block size.
        const newHeadX = strip.headX + dx * bw;
        const newHeadY = strip.headY + dy * bh;

        // Deactivate strip if growth would leave screen
        if (this.checkScreenEdge(newHeadX, newHeadY)) {
            strip.active = false;
            return;
        }

        // Spawn position (top-left corner of new block).
        // For positive directions (E/S) the block must start one cell beyond the current
        // head so there is no gap — dx*bw would skip (bw-1) cells.
        // For negative directions (W/N) the formula is identical to newHead; the block
        // naturally fills back toward the existing head with no gap.
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
    // After the spines are established, seed parallel rows/columns
    // at increasing perpendicular offsets from both axes:
    //   Wave 1 → rows/cols at ±1 from center axes
    //   Wave 2 → rows/cols at ±2
    //   Wave 3 → rows/cols at ±3  … etc.
    // =========================================================

    _expandInsideOut(s) {
        if (!this.c.get('quantizedGenerateV2InsideOutEnabled')) return;

        const delay  = this.c.get('quantizedGenerateV2InsideOutDelay')  ?? 6;
        const period = Math.max(1, this.c.get('quantizedGenerateV2InsideOutPeriod') ?? 3);

        if (s.step < delay) return;
        if ((s.step - delay) % period !== 0) return;

        const wave = s.insideOutWave;

        const bs    = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2);
        const halfH = Math.floor(this.g.rows / bs.h / 2);

        // Stop once the wave has passed both screen axes
        if (wave > halfW && wave > halfH) return;

        const maxLayer = Math.min(1, this.c.get('quantizedGenerateV2LayerCount') ?? 0);

        for (let l = 0; l <= maxLayer; l++) {
            // Rows perpendicular to the horizontal axis: E + W from (scx, scy ± wave)
            for (const dy of [wave, -wave]) {
                const oy = s.scy + dy;
                if (oy > -halfH && oy < halfH) {
                    const e = this._createStrip(l, 'E', s.scx, oy);
                    const w = this._createStrip(l, 'W', s.scx, oy);
                    e.isExpansion = true;
                    w.isExpansion = true;
                }
            }

            // Columns perpendicular to the vertical axis: N + S from (scx ± wave, scy)
            for (const dx of [wave, -wave]) {
                const ox = s.scx + dx;
                if (ox > -halfW && ox < halfW) {
                    const n = this._createStrip(l, 'N', ox, s.scy);
                    const sv = this._createStrip(l, 'S', ox, s.scy);
                    n.isExpansion = true;
                    sv.isExpansion = true;
                }
            }
        }

        s.insideOutWave++;
    }

    // =========================================================
    // GLOBAL BEHAVIOR 5: Intersection detection + pattern swap
    // =========================================================

    /**
     * When two strips of the same axis reach the same growCount, they are "level" —
     * a common intersection. At that point, toggle the pause pattern probabilistically.
     */
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
    // CORE GROWTH LOOP
    // =========================================================

    _attemptGrowth() {
        // In editor manual-step mode, bypass the expansion-complete gate so the
        // editor can always advance one tick regardless of lifecycle state.
        if (this.expansionComplete && !this.manualStep) return;

        const s = this.behaviorState;

        // Lazy initialisation: when the editor starts a fresh session it calls
        // _initProceduralState() instead of trigger(), so seedSchedule/pattern/
        // growthPool may never have been set up.  Bootstrap them here on first use.
        if (!s.seedSchedule) {
            s.pattern      = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            s.seedSchedule = this._generateSeedSchedule(s.scx ?? 0, s.scy ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }

        // Origin-block healing: after a full editor reconstruction (jumpToStep clears
        // activeBlocks then replays the sequence from scratch), activeBlocks will be
        // empty if the origin blocks were never recorded to sequence[0].  Place them
        // now so the headOnBlock gate in _tickStrips can pass.  When manualStep=true
        // (editor mode) _spawnBlock also writes them into sequence[0] automatically,
        // so future backward-navigation will replay them correctly.
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
        // In manual/editor mode bypass the frame-rate throttle so every
        // "next step" press always produces exactly one growth tick.
        if (!this.manualStep && s.growTimer % delay !== 0) return;

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
