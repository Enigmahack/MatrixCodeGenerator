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
        this.growthPool.set(id, {
            fn: fn,
            enabled: options.enabled ?? true,
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
        // Sub-behavior pool is empty by default — define behaviors here using registerBehavior().
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
        //       // this._gridsDirty = true after any structural change
        //   }, { label: 'My Behavior' });
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

        const addToSchedule = (layer, dir) => {
            const step = Math.floor(Math.random() * 6);
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer, dir, originX: scx, originY: scy });
        };

        // L0 always gets all 4 directions
        [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d));

        // L1 also gets all 4 directions if layer count >= 1
        if (maxLayer >= 1) {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(1, d));
        }

        return schedule;
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        for (const { layer, dir, originX, originY } of scheduled) {
            this._createStrip(layer, dir, originX, originY);
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

            const pattern = strip.paused ? strip.pausePattern : strip.pattern;

            // Hard gate: only grow if this step position is active (1)
            if (pattern[strip.stepPhase]) {
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
        const { bw, bh } = this._calcBlockSize(strip, s.fillRatio);

        // Next head position: advance by block size in growth direction
        const nextX = strip.headX + dx * bw;
        const nextY = strip.headY + dy * bh;

        // Deactivate strip if head has reached screen edge
        if (this.checkScreenEdge(nextX, nextY)) {
            strip.active = false;
            return;
        }

        const id = this._spawnBlock(
            nextX, nextY, bw, bh, strip.layer,
            false, 0, true, true, true, false, true
        );

        if (id !== -1) {
            strip.blockIds.push(id);
            strip.headX = nextX;
            strip.headY = nextY;
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
        if (this.expansionComplete) return;

        const s = this.behaviorState;
        s.growTimer++;

        const speed = this.c.get('quantizedGenerateV2Speed') || 1;
        const delay = Math.max(1, Math.floor(11 - speed));
        if (s.growTimer % delay !== 0) return;

        // 1. Compute visible fill ratio (for Behaviors 2 & 3)
        this._updateFillRatio(s);

        // 2. Seed any strips scheduled for this step (Behavior 4)
        this._seedStrips(s);

        // 3. Advance each strip through its 6-step gate (Behaviors 1 & 4)
        this._tickStrips(s);

        // 4. Detect intersection events and toggle patterns (Behavior 5)
        this._checkIntersections();

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
