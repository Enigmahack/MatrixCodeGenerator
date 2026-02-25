class QuantizedBlockGeneration extends QuantizedBaseEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "QuantizedBlockGenerator"; 
        this.configPrefix = "quantizedGenerateV2";
        this.active = false;
        
        this.timer = 0;
        this.genTimer = 0;
        this.logicScale = 3.0; // Allow expansion 200% past screen edges to prevent border stalls
        this.persistentCycleIndex = 0;

        // The Growth Pool: Stores behaviors and their layer assignments
        this.growthPool = new Map();
        
        // Behavioral State
        this.behaviorState = {
            step: 0,
            growTimer: 0
        };
    }

    /**
     * Registers a behavior into the growth pool.
     */
    registerBehavior(id, fn, layers = [0, 1, 2], enabled = true) {
        this.growthPool.set(id, {
            fn: fn,
            layers: new Set(layers),
            enabled: enabled
        });
    }

    /**
     * Enables or disables a specific behavior.
     */
    setBehaviorFlag(id, enabled) {
        const b = this.growthPool.get(id);
        if (b) b.enabled = enabled;
    }

    /**
     * Updates the layer assignments for a behavior.
     */
    setBehaviorLayers(id, layers) {
        const b = this.growthPool.get(id);
        if (b) b.layers = new Set(layers);
    }

    trigger(force = false) {
        if (this.active && !force) return false;
        if (!super.trigger(force)) return false;

        this.alpha = 1.0;
        this.state = 'GENERATING';
        this.persistentCycleIndex = 0;
        
        // Random Start Position within visible area
        const bs = this.getBlockSize();
        const halfW = Math.floor(this.g.cols / bs.w / 2) - 5;
        const halfH = Math.floor(this.g.rows / bs.h / 2) - 5;
        
        const scx = Math.floor((Math.random() * 2 - 1) * halfW);
        const scy = Math.floor((Math.random() * 2 - 1) * halfH);

        // Reset state for clean start
        this.behaviorState.step = 0;
        this.behaviorState.growTimer = 0;
        this.behaviorState.scx = scx;
        this.behaviorState.scy = scy;
        this.behaviorState.hitEdge = false;

        console.log(`QuantizedBlockGenerator: Starting at random center (${scx}, ${scy})`);

        this._initShadowWorld(); 
        this._initProceduralState(true);
        
        // Register test behaviors
        this._initTestBehaviors();

        this._updateRenderGridLogic();

        return true;
    }

    _initTestBehaviors() {
        // Behavior 1: Simple square add
        this.registerBehavior('test_square_add', (layers, s) => {
            if (s.hitEdge) return;

            const layerArray = Array.from(layers);
            if (layerArray.length === 0) return;
            
            const currentLayer = layerArray[s.step % layerArray.length];
            const d = s.step; 
            const { scx, scy } = s;

            // Edge Detection relative to start position
            const hit = this.checkScreenEdge(scx + d, scy + d) || 
                        this.checkScreenEdge(scx - d, scy - d) ||
                        this.checkScreenEdge(scx + d, scy - d) ||
                        this.checkScreenEdge(scx - d, scy + d);

            if (hit) {
                s.hitEdge = true;
                console.log("QuantizedBlockGenerator: HIT SCREEN EDGE:", hit);
                return;
            }

            if (d === 0) {
                this._spawnBlock(scx, scy, 1, 1, currentLayer, false, 0, true, true, true, false, true);
            } else {
                this._spawnBlock(scx - d, scy - d, (2 * d + 1), 1, currentLayer, false, 0, true, true, true, false, true); // Top
                this._spawnBlock(scx - d, scy + d, (2 * d + 1), 1, currentLayer, false, 0, true, true, true, false, true);  // Bottom
                this._spawnBlock(scx - d, scy - d + 1, 1, (2 * d - 1), currentLayer, false, 0, true, true, true, false, true); // Left
                this._spawnBlock(scx + d, scy - d + 1, 1, (2 * d - 1), currentLayer, false, 0, true, true, true, false, true);  // Right
            }
        }, [0, 1, 2], true);

        // Behavior 2: Simple square remove
        this.registerBehavior('test_square_remove', (layers, s) => {
            const layerArray = Array.from(layers);
            if (layerArray.length === 0 || s.step < 15) return; 
            
            const offsetStep = s.step - 15;
            const currentLayer = layerArray[offsetStep % layerArray.length];
            const d = offsetStep;
            const { scx, scy } = s;

            if (d === 0) {
                this._removeBlock(scx, scy, 1, 1, currentLayer);
            } else {
                this._removeBlock(scx - d, scy - d, (2 * d + 1), 1, currentLayer);
                this._removeBlock(scx - d, scy + d, (2 * d + 1), 1, currentLayer);
                this._removeBlock(scx - d, scy - d + 1, 1, (2 * d - 1), currentLayer);
                this._removeBlock(scx + d, scy - d + 1, 1, (2 * d - 1), currentLayer);
            }
        }, [0, 1, 2], true);
    }

    /**
     * Detects if a relative block coordinate (bx, by) is at or beyond the visible screen perimeter.
     * Adjusted to allow growth to reach the full visible area, compensating for previous early stopping.
     * @returns {Object|boolean} Returns an object with edge flags if hit, otherwise false.
     */
    checkScreenEdge(bx, by) {
        const bs = this.getBlockSize();
        // Visible blocks on each side of center
        const halfVisibleW = Math.floor(this.g.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.g.rows / bs.h / 2);

        // Increase limits to allow expansion to reach the actual visible edges
        const extension = 2;
        const limitW = halfVisibleW + extension;
        const limitH = halfVisibleH + extension;

        const edges = {
            left: bx <= -limitW,
            right: bx >= limitW,
            top: by <= -limitH, // North
            bottom: by >= limitH  // South
        };

        if (edges.left || edges.right || edges.top || edges.bottom) {
            return edges;
        }
        return false;
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
        if (s.growTimer % 3 !== 0) return;
        
        // Execute all enabled behaviors in the pool
        for (const [id, behavior] of this.growthPool) {
            if (behavior.enabled && behavior.fn) {
                behavior.fn.call(this, behavior.layers, s);
            }
        }

        s.step++;
        this._updateRenderGridLogic();
    }

    stop() {
        super.stop();
    }
}
