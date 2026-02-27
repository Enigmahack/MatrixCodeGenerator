class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0; // Allow expansion 200% past screen edges to prevent border stalls
        this.persistentCycleIndex = 0;

        // The Growth Pool: Stores behaviors and their settings
        this.growthPool = new Map();
        
        // Behavioral State
        this.behaviorState = {
            step: 0,
            growTimer: 0,
            snapshots: [], // For reversion logic
            lastActionTime: 0
        };
    }

    /**
     * Registers a behavior into the growth pool.
     */
    registerBehavior(id, fn) {
        this.growthPool.set(id, {
            fn: fn
        });
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        if (!super.trigger(force)) return false;

        this.alpha = 1.0;
        this.state = 'GENERATING';
        this.persistentCycleIndex = 0;
        
        let scx = 0;
        let scy = 0;

        if (!this.c.get('quantizedGenerateV2EnableCentered')) {
            // Random Start Position within visible area
            const bs = this.getBlockSize();
            const halfW = Math.floor(this.g.cols / bs.w / 2) - 5;
            const halfH = Math.floor(this.g.rows / bs.h / 2) - 5;
            
            scx = Math.floor((Math.random() * 2 - 1) * halfW);
            scy = Math.floor((Math.random() * 2 - 1) * halfH);
        }

        // Reset state for clean start
        this.behaviorState.step = 0;
        this.behaviorState.growTimer = 0;
        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;
        this.behaviorState.hitEdge = false;
        this.behaviorState.snapshots = [];

        console.log(`QuantizedBlockGenerator: Starting at ${this.c.get('quantizedGenerateV2EnableCentered') ? 'center' : 'random center'} (${scx}, ${scy})`);

        this._initShadowWorld(); 
        this._initProceduralState(true);
        
        // Register all organic behaviors
        this._initBehaviors();

        this._updateRenderGridLogic();

        return true;
    }

    _initBehaviors() {
        // Pool 1: Spawning & Seeding (The start of Spines)
        this.registerBehavior('spine_growth', this._behaviorSpineGrowth.bind(this));
        
        // Pool 2: Structural Aggregator (Frontier Expansion & Branching)
        this.registerBehavior('frontier_expansion', this._behaviorFrontierExpansion.bind(this));
        this.registerBehavior('branching', this._behaviorBranching.bind(this));
        this.registerBehavior('organic_expansion', this._behaviorOrganicExpansion.bind(this));
        this.registerBehavior('tendril_growth', this._behaviorTendrilGrowth.bind(this));
        
        // Pool 3: Temporal Sequencer (Glitch / Destructive / Jumps)
        this.registerBehavior('island_jumps', this._behaviorIslandJumps.bind(this));
        this.registerBehavior('destructive_glitch', this._behaviorDestructiveGlitch.bind(this));
        this.registerBehavior('data_corruption', this._behaviorDataCorruption.bind(this));
        
        // Pool 4: Dynamic Movement (Drift & Shove)
        this.registerBehavior('block_drift', this._behaviorBlockDrift.bind(this));
        this.registerBehavior('neighbor_shove', this._behaviorNeighborShove.bind(this));

        // Pool 5: State Management (Reversion)
        this.registerBehavior('state_reversion', this._behaviorStateReversion.bind(this));
    }

    /**
     * Checks if a behavior is enabled for a specific layer.
     */
    _isLayerEnabled(behaviorId, layer) {
        const enabled = this.c.get(`quantizedGenerateV2Enable_${behaviorId}`);
        if (!enabled) return false;
        
        const layerFlag = this.c.get(`quantizedGenerateV2_${behaviorId}_L${layer}`);
        return !!layerFlag;
    }

    // --- BEHAVIOR IMPLEMENTATIONS ---

    /**
     * Pool 1: Spine Growth
     */
    _behaviorSpineGrowth(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('spine_growth', l)) continue;
            const chance = this.c.get('quantizedGenerateV2SpineChance') || 0.1;
            if (Math.random() > chance) continue;

            const axisBias = this.c.get('quantizedGenerateV2AxisBias') ?? 0.8;
            const isVertical = Math.random() < axisBias;
            const len = Math.floor(Math.random() * 8) + 4;
            const w = isVertical ? 1 : len;
            const h = isVertical ? len : 1;
            const rx = Math.floor((Math.random() * 2 - 1) * 15) + s.scx;
            const ry = Math.floor((Math.random() * 2 - 1) * 15) + s.scy;

            if (this.checkScreenEdge(rx, ry) || this.checkScreenEdge(rx + w, ry + h)) continue;
            this._spawnBlock(rx, ry, w, h, l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 2: Stochastic Frontier Expansion
     */
    _behaviorFrontierExpansion(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('frontier_expansion', l)) continue;
            const chance = this.c.get('quantizedGenerateV2FrontierExpansionChance') || 0.4;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length === 0) continue;

            const parent = active[Math.floor(Math.random() * active.length)];
            const neighbors = [{x: parent.x1, y: parent.y1 - 1}, {x: parent.x1, y: parent.y2 + 1}, {x: parent.x1 - 1, y: parent.y1}, {x: parent.x2 + 1, y: parent.y1}];
            const target = neighbors[Math.floor(Math.random() * neighbors.length)];

            if (this.checkScreenEdge(target.x, target.y) || this._isOccupied(target.x, target.y, l)) continue;

            const minW = this.c.get('quantizedGenerateV2MinBlockWidth') || 1, maxW = this.c.get('quantizedGenerateV2MaxBlockWidth') || 2;
            const minH = this.c.get('quantizedGenerateV2MinBlockHeight') || 1, maxH = this.c.get('quantizedGenerateV2MaxBlockHeight') || 2;
            const w = Math.floor(Math.random() * (maxW - minW + 1)) + minW, h = Math.floor(Math.random() * (maxH - minH + 1)) + minH;

            this._spawnBlock(target.x, target.y, w, h, l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 2: Branching
     */
    _behaviorBranching(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('branching', l)) continue;
            
            const chance = this.c.get('quantizedGenerateV2BranchProbability') || 0.15;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            const spines = active.filter(op => (op.y2 - op.y1) > (op.x2 - op.x1));
            if (spines.length === 0) continue;

            const parent = spines[Math.floor(Math.random() * spines.length)];
            const side = Math.random() > 0.5 ? 1 : -1;
            const branchLen = Math.floor(Math.random() * 5) + 2;
            const branchY = Math.floor(Math.random() * (parent.y2 - parent.y1 + 1)) + parent.y1;
            const branchX = side > 0 ? parent.x2 + 1 : parent.x1 - branchLen;

            if (this.checkScreenEdge(branchX, branchY) || this.checkScreenEdge(branchX + branchLen, branchY)) continue;
            this._spawnBlock(branchX, branchY, branchLen, 1, l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 2: Organic Expansion (Blobs)
     */
    _behaviorOrganicExpansion(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('organic_expansion', l)) continue;
            const chance = this.c.get('quantizedGenerateV2ExpansionChance') || 0.2;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length === 0) continue;

            const target = active[Math.floor(Math.random() * active.length)];
            const w = Math.floor(Math.random() * 2) + 1, h = Math.floor(Math.random() * 2) + 1;
            const dir = Math.floor(Math.random() * 4);
            
            let nx = target.x1, ny = target.y1;
            if (dir === 0) ny -= h; 
            else if (dir === 1) nx += (target.x2 - target.x1 + 1); 
            else if (dir === 2) ny += (target.y2 - target.y1 + 1); 
            else if (dir === 3) nx -= w;

            if (this.checkScreenEdge(nx, ny) || this.checkScreenEdge(nx + w, ny + h)) continue;
            this._spawnBlock(nx, ny, w, h, l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 2: Tendril Growth (Strings)
     */
    _behaviorTendrilGrowth(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('tendril_growth', l)) continue;
            const chance = this.c.get('quantizedGenerateV2TendrilChance') || 0.15;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length === 0) continue;

            const parent = active[Math.floor(Math.random() * active.length)];
            const len = Math.floor(Math.random() * 5) + 3, dir = Math.floor(Math.random() * 4);
            let cx = parent.x1, cy = parent.y1;
            for (let i = 0; i < len; i++) {
                if (dir === 0) cy--; else if (dir === 1) cx++; else if (dir === 2) cy++; else if (dir === 3) cx--;
                if (this.checkScreenEdge(cx, cy)) break;
                if (!this._isOccupied(cx, cy, l)) {
                    this._spawnBlock(cx, cy, 1, 1, l, false, 0, true, true, true, false, true);
                    this._gridsDirty = true;
                }
            }
        }
    }

    /**
     * Pool 3: Island Jumps
     */
    _behaviorIslandJumps(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('island_jumps', l)) continue;
            
            const chance = this.c.get('quantizedGenerateV2IslandJumpProbability') || 0.03;
            if (Math.random() > chance) continue;

            const rx = Math.floor((Math.random() * 2 - 1) * 20) + s.scx;
            const ry = Math.floor((Math.random() * 2 - 1) * 20) + s.scy;

            if (this.checkScreenEdge(rx, ry)) continue;
            this._spawnBlock(rx, ry, 1, 1, l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 3: Destructive Glitch
     */
    _behaviorDestructiveGlitch(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('destructive_glitch', l)) continue;
            
            const ratio = this.c.get('quantizedGenerateV2DestructiveRatio') || 0.1;
            if (Math.random() > ratio) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length < 3) continue;

            const target = active[Math.floor(Math.random() * active.length)];
            const mode = Math.random();

            if (mode < 0.4) {
                target.type = 'removeBlock';
                target.fade = true;
            } else {
                const hx = target.x1 + Math.floor(Math.random() * (target.x2 - target.x1 + 1));
                const hy = target.y1 + Math.floor(Math.random() * (target.y2 - target.y1 + 1));
                this._removeBlock(hx, hy, 1, 1, l);
            }
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 3: Data Corruption
     */
    _behaviorDataCorruption(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('data_corruption', l)) continue;
            const chance = this.c.get('quantizedGenerateV2CorruptionChance') || 0.05;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length < 5) continue;

            const target = active[Math.floor(Math.random() * active.length)];
            target.type = 'removeBlock';
            target.fade = true;
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 4: Block Drift
     */
    _behaviorBlockDrift(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('block_drift', l)) continue;
            if (Math.random() > (this.c.get('quantizedGenerateV2DriftChance') || 0.05)) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length < 2) continue;

            const target = active[Math.floor(Math.random() * active.length)];
            const dx = Math.random() > 0.5 ? 1 : -1, dy = Math.random() > 0.5 ? 1 : -1;
            
            if (this.checkScreenEdge(target.x1 + dx, target.y1 + dy) || this._isOccupied(target.x1 + dx, target.y1 + dy, l)) continue;

            target.type = 'removeBlock';
            this._spawnBlock(target.x1 + dx, target.y1 + dy, (target.x2 - target.x1 + 1), (target.y2 - target.y1 + 1), l, false, 0, true, true, true, false, true);
            this._gridsDirty = true;
        }
    }

    /**
     * Pool 4: Neighbor Shove
     */
    _behaviorNeighborShove(s) {
        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('neighbor_shove', l)) continue;
            const chance = this.c.get('quantizedGenerateV2ShoveChance') || 0.1;
            if (Math.random() > chance) continue;

            const active = this.maskOps.filter(op => op.layer === l && op.type === 'addBlock');
            if (active.length < 5) continue;

            const center = active[Math.floor(Math.random() * active.length)];
            active.forEach(n => {
                if (n === center) return;
                const dist = Math.sqrt(Math.pow(n.x1 - center.x1, 2) + Math.pow(n.y1 - center.y1, 2));
                if (dist < 3) {
                    const dx = Math.sign(n.x1 - center.x1) || (Math.random() > 0.5 ? 1 : -1);
                    const dy = Math.sign(n.y1 - center.y1) || (Math.random() > 0.5 ? 1 : -1);
                    if (!this.checkScreenEdge(n.x1 + dx, n.y1 + dy) && !this._isOccupied(n.x1 + dx, n.y1 + dy, l)) {
                        n.x1 += dx; n.x2 += dx;
                        n.y1 += dy; n.y2 += dy;
                        this._gridsDirty = true;
                    }
                }
            });
        }
    }

    /**
     * Pool 5: State Reversion
     */
    _behaviorStateReversion(s) {
        if (s.step % 15 === 0) {
            s.snapshots.push(this.maskOps.map(op => ({...op})));
            if (s.snapshots.length > 5) s.snapshots.shift();
        }

        for (let l = 0; l <= 2; l++) {
            if (!this._isLayerEnabled('state_reversion', l)) continue;
            const chance = this.c.get('quantizedGenerateV2ReversionChance') || 0.02;
            if (Math.random() > chance || s.snapshots.length < 2) continue;

            const oldState = s.snapshots[Math.floor(Math.random() * (s.snapshots.length - 1))];
            const rx = Math.floor(Math.random() * 20) - 10 + s.scx;
            const ry = Math.floor(Math.random() * 20) - 10 + s.scy;
            const radius = 4;

            this.maskOps = this.maskOps.filter(op => 
                op.layer !== l || (Math.abs(op.x1 - rx) > radius || Math.abs(op.y1 - ry) > radius)
            );
            
            const toRestore = oldState.filter(op => 
                op.layer === l && Math.abs(op.x1 - rx) <= radius && Math.abs(op.y1 - ry) <= radius
            );
            
            this.maskOps.push(...toRestore);
            this._gridsDirty = true;
        }
    }

    // --- HELPERS ---

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

    _attemptGrowth() {
        if (this.expansionComplete) return;

        const s = this.behaviorState;
        s.growTimer++;
        
        const speed = this.c.get('quantizedGenerateV2Speed') || 1;
        const delay = Math.max(1, Math.floor(11 - speed));
        if (s.growTimer % delay !== 0) return;
        
        // Execute all registered behaviors
        for (const behavior of this.growthPool.values()) {
            if (behavior.fn) {
                behavior.fn.call(this, s);
            }
        }

        s.step++;
        this._updateRenderGridLogic();
    }

    stop() {
        super.stop();
    }
}
