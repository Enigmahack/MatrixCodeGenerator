/**
 * QuantizedSequenceGeneratorV2.js
 * Headless generator for Quantized Block Generator (v2) sequences.
 */
class QuantizedSequenceGeneratorV2 {
    constructor(cols, rows, configState, configPrefix = 'quantizedGenerateV2') {
        this.cols = cols;
        this.rows = rows;
        this.config = configState;
        this.configPrefix = configPrefix;

        this.logicScale = 1.2;
        
        const bs = this._getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);

        let blocksX = Math.ceil((cols * this.logicScale) / cellPitchX);
        let blocksY = Math.ceil((rows * this.logicScale) / cellPitchY);

        // Ensure integer cell offsets by making (blocks * pitch - screenCells) even
        if ((blocksX * cellPitchX - cols) % 2 !== 0) blocksX++;
        if ((blocksY * cellPitchY - rows) % 2 !== 0) blocksY++;

        this.logicGridW = blocksX;
        this.logicGridH = blocksY;
        this.gridCX = Math.floor(this.logicGridW / 2);
        this.gridCY = Math.floor(this.logicGridH / 2);

        this.layerGrids = [];
        for (let l = 0; l < 4; l++) {
            this.layerGrids[l] = new Int32Array(this.logicGridW * this.logicGridH).fill(-1);
        }


        this.strips = new Map();
        this.finishedBranches = new Set();
        this._stripNextId = 0;
        this._blockNextId = 0;
        this.activeBlocks = [];
        this.maskOps = [];
        this.actionBuffer = [];
        this.actionQueues = new Map();
        this.growthPool = new Map();
        this._currentStepActions = [];
        this._bufferPool = {};

        this.behaviorState = {
            step: 0,
            growTimer: 0,
            scx: 0,
            scy: 0,
            hitEdge: { N: false, S: false, E: false, W: false },
            lastActionTime: 0,
            fillRatio: 0,
            insideOutWave: 1,
            deferredCols: new Map(),
            deferredRows: new Map(),
            layerMaxDist: {},
            ribOrigins: new Set(),
            pendingDeletions: [],
            pendingExpansions: [],
            dirPools: { 0: [], 1: [] },
            lastLayerDirs: { 0: null, 1: null },
            nudgeState: {
                cycle: { step: 0, lastTempBlock: null }
            },
            spreadingNudgeCycles: {
                'V1':  { step: 0, lastTempBlock: null },
                'V-1': { step: 0, lastTempBlock: null },
                'H1':  { step: 0, lastTempBlock: null },
                'H-1': { step: 0, lastTempBlock: null }
            },
            spreadingNudgeNextSpawnStep: { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 },
            spreadingNudgeSymmetryQueue: []
        };

        this.currentStepOps = [];
        this._init();
    }

    _log(...args) { if (this.config && this.config.logErrors) console.log(...args); }
    _warn(...args) { if (this.config && this.config.logErrors) console.warn(...args); }
    _error(...args) { if (this.config && this.config.logErrors) console.error(...args); }

    _getConfig(keySuffix) {
        const prefix = this.configPrefix;
        const overrideDefaults = this.config[prefix + 'OverrideDefaults'];
        
        // Settings that all Quantized effects share and can inherit from Quantized Defaults.
        const inheritable = [
            'ShadowWorldFadeSpeed', 'GlassBloom', 'GlassBloomScaleToSize', 'GlassCompressionThreshold',
            'LineGfxColor', 'LineGfxPersistence',
            'GlassRefractionEnabled', 'GlassRefractionWidth', 'GlassRefractionBrightness', 'GlassRefractionSaturation',
            'GlassRefractionCompression', 'GlassRefractionOffset', 'GlassRefractionGlow',
            'LineGfxTintOffset', 'LineGfxAdditiveStrength', 'LineGfxSharpness',
            'LineGfxRoundness', 'LineGfxGlowFalloff', 'LineGfxSampleOffsetX', 'LineGfxSampleOffsetY',
            'LineGfxMaskSoftness', 'LineGfxOffsetX', 'LineGfxOffsetY', 'Speed', 'BlockWidthCells', 'BlockHeightCells',
            'PerimeterEchoEnabled', 'SingleLayerMode'
        ];

        const isInheritable = inheritable.includes(keySuffix);
        const key = prefix + keySuffix;
        const val = this.config[key];

        // 1. If we are NOT overriding, AND this is an inheritable setting, use the default.
        if (!overrideDefaults && isInheritable) {
            const defaultKey = 'quantizedDefault' + keySuffix;
            const defaultVal = this.config[defaultKey];
            if (defaultVal !== undefined && defaultVal !== null) return defaultVal;

            // Manual fallbacks for Width/Height if even the default is missing
            if (keySuffix === 'BlockWidthCells') return this.config['quantizedDefaultBlockWidthCells'] ?? 4;
            if (keySuffix === 'BlockHeightCells') return this.config['quantizedDefaultBlockHeightCells'] ?? 4;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        if (val !== undefined && val !== null && val !== "") return val;

        // 3. Fallback to quantizedGenerateV2 for generative settings (if not already the prefix)
        if (prefix !== 'quantizedGenerateV2') {
            const genKey = 'quantizedGenerateV2' + keySuffix;
            const genVal = this.config[genKey];
            if (genVal !== undefined && genVal !== null && genVal !== "") return genVal;
        }

        // Final fallback for non-inheritable but common settings
        if (keySuffix === 'BlockWidthCells') return this.config['quantizedDefaultBlockWidthCells'] ?? 4;
        if (keySuffix === 'BlockHeightCells') return this.config['quantizedDefaultBlockHeightCells'] ?? 4;

        return null;
    }

    _getBuffer(key, length, type = Uint8Array) {
        if (!this._bufferPool[key] || this._bufferPool[key].length !== length) {
            this._bufferPool[key] = new type(length);
        }
        return this._bufferPool[key];
    }

    _init() {
        const randomStart = !!this._getConfig('RandomStart');

        // Preserve scx/scy if already set (e.g. by tap-to-spawn in base trigger)
        const hasSpawnOffset = (this.behaviorState.scx !== 0 || this.behaviorState.scy !== 0);
        if (!hasSpawnOffset) {
            let scx = 0;
            let scy = 0;
            if (randomStart) {
                const bs = this._getBlockSize();
                const halfW = Math.floor(this.cols / bs.w / 2) - 5;
                const halfH = Math.floor(this.rows / bs.h / 2) - 5;
                scx = Math.floor((Math.random() * 2 - 1) * halfW);
                scy = Math.floor((Math.random() * 2 - 1) * halfH);
            }
            this.behaviorState.scx = scx;
            this.behaviorState.scy = scy;
        }

        this.behaviorState.pattern = this._generateRandomPattern();
        this.behaviorState.pausePattern = this._generateDistinctPattern(this.behaviorState.pattern);

        const quadrantCount = parseInt(this._getConfig('QuadrantCount') ?? 4);
        const _maxLayer = this._getConfig('LayerCount') ?? 0;
        const _baseLife = 4 + Math.floor(Math.random() * 3);
        this.behaviorState.layerDirs = {};
        this.behaviorState.layerDirLife = {};
        for (let l = 0; l <= _maxLayer + 1; l++) {
            this.behaviorState.layerDirs[l] = this._pickLayerDirs(quadrantCount);
            this.behaviorState.layerDirLife[l] = _baseLife + l;
        }

        this.behaviorState.seedSchedule = this._generateSeedSchedule(scx, scy);

        this._initBehaviors();
    }

    _getBlockSize() {
        return {
            w: this._getConfig('BlockWidthCells') || 4,
            h: this._getConfig('BlockHeightCells') || 4
        };
    }

    _initBehaviors() {
        this.growthPool.clear();
        const gen = this;
        // Behavior 2: Block Spawner/Despawner (Anticipatory Growth + Volatility)
        this.registerBehavior('block_spawner_despawner', function(s) {
            const startDelay = gen._getConfig('BlockSpawnerStartDelay') ?? 10;
            const spawnRate  = Math.max(1, gen._getConfig('BlockSpawnerRate') ?? 4);
            const layer = 1;

            const allowed = gen._getAllowedDirs(layer);

            // 1. Spawning Logic
            if (s.step >= startDelay && (s.step - startDelay) % spawnRate === 0) {
                const maxSpawn = gen._getConfig('BlockSpawnerCount') ?? 5;

                const perimeterBlocks = gen.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;

                    // NEW: Ensure seed parents are connected to the spines (X or Y axis)
                    const onYSpine = (b.x <= s.scx && b.x + b.w - 1 >= s.scx);
                    const onXSpine = (b.y <= s.scy && b.y + b.h - 1 >= s.scy);
                    if (!onXSpine && !onYSpine) return false;

                    const neighbors = [
                        {x: b.x, y: b.y - 1, dir: 'N'}, {x: b.x, y: b.y + b.h, dir: 'S'}, // N, S
                        {x: b.x - 1, y: b.y, dir: 'W'}, {x: b.x + b.w, dir: 'E'}  // W, E
                    ];
                    // RELAXATION: A block is a candidate if it has ANY free neighbor
                    return neighbors.some(n => !gen._isOccupied(n.x, n.y, layer));
                });

                if (perimeterBlocks.length > 0) {
                    // NEW: Strict restriction - Prefer empty blocks closer to the initial spawn block first
                    perimeterBlocks.sort((a, b) => {
                        const distA = Math.abs(a.x + a.w/2 - s.scx) + Math.abs(a.y + a.h/2 - s.scy);
                        const distB = Math.abs(b.x + b.w/2 - s.scx) + Math.abs(b.y + b.h/2 - s.scy);
                        return distA - distB;
                    });

                    const sizes = [
                        {w: 1, h: 1}, {w: 1, h: 2}, {w: 2, h: 1}, 
                        {w: 1, h: 3}, {w: 3, h: 1}
                    ];

                    let spawnedCount = 0;
                    for (let i = 0; i < maxSpawn * 2 && spawnedCount < maxSpawn; i++) {
                        // Strict preference: Iterate through sorted parents. Try up to 2 attempts per parent before moving on.
                        const parent = perimeterBlocks[Math.floor(i / 2) % perimeterBlocks.length];
                        
                        // Determine parent's quadrant relative to spawn center
                        const pdx = parent.x - s.scx, pdy = parent.y - s.scy;
                        const parentQuad = Math.abs(pdx) > Math.abs(pdy) ? (pdx > 0 ? 'E' : 'W') : (pdy > 0 ? 'S' : 'N');

                        const size = sizes[Math.floor(Math.random() * sizes.length)];
                        
                        // RELAXATION: Allow any side if it's allowed OR if the parent is in an allowed quadrant (branching)
                        const availSides = ['N', 'S', 'E', 'W'].filter(d => {
                            if (!allowed) return true;
                            if (allowed.has(d)) return true;
                            if (allowed.has(parentQuad)) return true; // Branching within allowed quadrant
                            return false;
                        });

                        if (availSides.length === 0) continue;
                        const side = availSides[Math.floor(Math.random() * availSides.length)];
                        let nx, ny;

                        if (side === 'N') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y - size.h;
                        } else if (side === 'S') {
                            nx = parent.x + Math.floor(Math.random() * (parent.w + size.w - 1)) - (size.w - 1);
                            ny = parent.y + parent.h;
                        } else if (side === 'W') {
                            nx = parent.x - size.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        } else { // E
                            nx = parent.x + parent.w;
                            ny = parent.y + Math.floor(Math.random() * (parent.h + size.h - 1)) - (size.h - 1);
                        }

                        if (gen.checkScreenEdge(nx, ny) || gen.checkScreenEdge(nx + size.w - 1, ny + size.h - 1)) continue;

                        // NEW: Occupancy Check (Only check layers 0 and 1 to prevent decorative layers from blocking discovery)
                        let isAreaFree = true;
                        for (let ly = 0; ly <= 1; ly++) {
                            for (let gy = ny; gy < ny + size.h; gy++) {
                                for (let gx = nx; gx < nx + size.w; gx++) {
                                    if (gen._isOccupied(gx, gy, ly)) { isAreaFree = false; break; }
                                }
                                if (!isAreaFree) break;
                            }
                            if (!isAreaFree) break;
                        }
                        if (!isAreaFree) continue;

                        gen.actionBuffer.push({ layer: layer, fn: () => {
                            // Set bypassOccupancy to false to enforce strict placement
                            gen._spawnBlock(nx, ny, size.w, size.h, layer, false, 'block_spawner');
                        }});
                        spawnedCount++;
                    }
                }
            }

            // 2. Despawning Logic
            const despawnRate = Math.max(1, gen._getConfig('BlockSpawnerDespawnRate') ?? 8);
            if (s.step >= startDelay && (s.step - startDelay) % despawnRate === 0) {
                const despawnCount = gen._getConfig('BlockSpawnerDespawnCount') ?? 2;
                
                // Select blocks that are connected by 2 or less edges (directions)
                // RULE: Do not remove if two opposite edges are connected (e.g. N and S).
                // NEW: Do not remove if block overlaps the spine (X or Y axis) or age > 3 steps.
                const candidates = gen.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;
                    
                    // --- PROTECTED BLOCKS ---
                    const overlapsYSpine = (b.x <= s.scx && b.x + b.w - 1 >= s.scx);
                    const overlapsXSpine = (b.y <= s.scy && b.y + b.h - 1 >= s.scy);
                    if (overlapsXSpine || overlapsYSpine) return false;

                    if (b.stepAge > 3) return false;

                    // --- CONNECTIVITY RULES ---
                    let north = false, south = false, west = false, east = false;
                    // North Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (gen._isOccupied(x, b.y - 1, layer)) { north = true; break; } }
                    // South Edge
                    for (let x = b.x; x < b.x + b.w; x++) { if (gen._isOccupied(x, b.y + b.h, layer)) { south = true; break; } }
                    // West Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (gen._isOccupied(b.x - 1, y, layer)) { west = true; break; } }
                    // East Edge
                    for (let y = b.y; y < b.y + b.h; y++) { if (gen._isOccupied(b.x + b.w, y, layer)) { east = true; break; } }
                    
                    const count = (north?1:0) + (south?1:0) + (west?1:0) + (east?1:0);
                    if (count > 2) return false;
                    if (count === 2) {
                        if ((north && south) || (west && east)) return false; // Opposite edges (bridge/line)
                    }
                    return true;
                });
                
                if (candidates.length > 0) {
                    // Headless shuffle helper or simple sort
                    candidates.sort(() => Math.random() - 0.5);
                    const toRemove = candidates.slice(0, despawnCount);
                    for (const b of toRemove) {
                        gen.actionBuffer.push({ layer: layer, fn: () => {
                            gen._removeBlock(b.x, b.y, b.w, b.h, b.layer);
                        }});
                    }
                }
            }
        }, { enabled: gen._getConfig('BlockSpawnerEnabled') ?? false, label: 'Block Spawner/Despawner' });

        this.registerBehavior('spreading_nudge', function(s) {
            if (!gen._getConfig('SpreadingNudgeEnabled')) return;
            const startDelay = gen._getConfig('SpreadingNudgeStartDelay') ?? 20;
            if (s.step < startDelay) return;

            const targetLayer = 1;
            const allowed = gen._getAllowedDirs(targetLayer);

            // State Initialization
            if (!s.spreadingNudgeNextDist) {
                s.spreadingNudgeNextDist = { 'V1': 1, 'V-1': 1, 'H1': 1, 'H-1': 1 };
                s.spreadingNudgeNextSpawnStep = s.spreadingNudgeNextSpawnStep || { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
            }

            const spawnSpeed   = gen._getConfig('SpreadingNudgeSpawnSpeed') ?? 1;
            const spreadDensity = gen._getConfig('SpreadingNudgeRange') ?? 0.5;
            const growthChance  = gen._getConfig('SpreadingNudgeChance') ?? 0.8;
            const maxInstances  = gen._getConfig('SpreadingNudgeMaxInstances') ?? 20;
            const preferSymmetry = gen._getConfig('SpreadingNudgeSymmetry') ?? true;

            const arms = [
                { key: 'V1',  vert: true,  side: 1,  perp: ['E', 'W'], dir: 'S' }, // South Axis -> Spawns E/W
                { key: 'V-1', vert: true,  side: -1, perp: ['E', 'W'], dir: 'N' }, // North Axis -> Spawns E/W
                { key: 'H1',  vert: false, side: 1,  perp: ['N', 'S'], dir: 'E' }, // East Axis -> Spawns N/S
                { key: 'H-1', vert: false, side: -1, perp: ['N', 'S'], dir: 'W' }  // West Axis -> Spawns N/S
            ];

            // 1. Process Symmetry Queue
            if (s.spreadingNudgeSymmetryQueue && s.spreadingNudgeSymmetryQueue.length > 0) {
                const pending = [];
                for (const item of s.spreadingNudgeSymmetryQueue) {
                    if (s.step >= item.stepToSpawn) {
                        if (!allowed || allowed.has(item.dir)) {
                            const strip = gen._createStrip(item.layer, item.dir, item.x, item.y);
                            strip.isNudge = item.isNudge || false;
                            strip.bypassOccupancy = item.bypassOccupancy || false;
                            strip.stepPhase = Math.floor(Math.random() * 6);
                        }
                    } else {
                        pending.push(item);
                    }
                }
                s.spreadingNudgeSymmetryQueue = pending;
            }

            // 2. Perform Nudge Growth at Spreading Origins
            const bs = gen._getBlockSize();
            const halfW = Math.floor(gen.cols / bs.w / 2);
            const halfH = Math.floor(gen.rows / bs.h / 2);

            let activePerpStrips = 0;
            for (const strip of gen.strips.values()) {
                if (strip.active && strip.bypassOccupancy && !strip.isNudge) activePerpStrips++;
            }

            arms.sort(() => Math.random() - 0.5);

            for (const arm of arms) {
                // QUADRANT CHECK
                if (allowed && !allowed.has(arm.dir)) continue;

                if (s.step >= (s.spreadingNudgeNextSpawnStep[arm.key] || 0)) {
                    let d = s.spreadingNudgeNextDist[arm.key];
                    const ax = arm.vert ? s.scx : s.scx + d * arm.side;
                    const ay = arm.vert ? s.scy + d * arm.side : s.scy;

                    if (Math.abs(ax - s.scx) > halfW || Math.abs(ay - s.scy) > halfH) {
                        s.spreadingNudgeNextSpawnStep[arm.key] = Infinity;
                        continue;
                    }

                    const cycle = s.spreadingNudgeCycles[arm.key];
                    const { bw, bh } = gen._calcBlockSize({ originX: ax, originY: ay, direction: 'N' }, s.fillRatio);
                    gen._attemptNudgeGrowthWithParams(targetLayer, bw, bh, ax - s.scx, ay - s.scy, cycle, growthChance);

                    if (activePerpStrips < maxInstances && Math.random() < spreadDensity) {
                        for (const dir of arm.perp) {
                            if (activePerpStrips >= maxInstances) break;
                            const strip = gen._createStrip(targetLayer, dir, ax, ay);
                            strip.isNudge = false;
                            strip.bypassOccupancy = true;
                            strip.growCount = 0;
                            activePerpStrips++;

                            if (preferSymmetry) {
                                const mirX = arm.vert ? ax : s.scx - (ax - s.scx);
                                const mirY = arm.vert ? s.scy - (ay - s.scy) : ay;
                                const mirDir = dir === 'N' ? 'S' : (dir === 'S' ? 'N' : (dir === 'E' ? 'W' : 'E'));
                                s.spreadingNudgeSymmetryQueue.push({
                                    x: mirX, y: mirY, layer: targetLayer, dir: mirDir,
                                    isNudge: false, bypassOccupancy: true,
                                    stepToSpawn: s.step + 1 + Math.floor(Math.random() * 3)
                                });
                            }
                        }
                    }

                    s.spreadingNudgeNextDist[arm.key]++;
                    const delay = 1 + Math.floor(Math.random() * spawnSpeed);
                    s.spreadingNudgeNextSpawnStep[arm.key] = s.step + delay;
                }
            }
        });

        // ── Shove Fill ─────────────────────────────────────────────────────────
        this.registerBehavior('shove_fill', function(s) {
            if (!gen._getConfig('ShoveFillEnabled')) return;
            const startDelay = gen._getConfig('ShoveFillStartDelay') ?? 20;
            const fillRate   = Math.max(1, gen._getConfig('ShoveFillRate') ?? 4);
            if (s.step < startDelay || (s.step - startDelay) % fillRate !== 0) return;

            const targetLayer = 1;
            const allowed = gen._getAllowedDirs(targetLayer);
            const allowAsymmetry = !!gen._getConfig('AllowAsymmetry');
            const bs    = gen._getBlockSize();
            const halfW = Math.floor(gen.cols / bs.w / 2);
            const halfH = Math.floor(gen.rows / bs.h / 2);
            const proxW = Math.max(2, Math.floor(halfW * 0.25));
            const proxH = Math.max(2, Math.floor(halfH * 0.25));
            const shoveAmount = Math.max(1, gen._getConfig('ShoveFillAmount') ?? 1);

            if (!s.shoveStrips) s.shoveStrips = [];
            s.shoveStrips = s.shoveStrips.filter(st => st.active);

            if (s.shoveStrips.length === 0) {
                const qCount    = Math.min(4, parseInt(gen._getConfig('QuadrantCount') ?? 4));
                const availDirs = ['N', 'S', 'E', 'W'].filter(d => !allowed || allowed.has(d));
                if (availDirs.length === 0) return;
                const count = Math.min(qCount, availDirs.length);
                const chosen = [...availDirs].sort(() => Math.random() - 0.5).slice(0, count);

                for (const dir of chosen) {
                    const isEW = dir === 'E' || dir === 'W';
                    const width = 1 + Math.floor(Math.random() * 3);
                    if (isEW) {
                        const perpMid   = s.scy + Math.round((Math.random() * 2 - 1) * proxH);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStrips.push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.scx + (dir === 'E' ? 2 : -2), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
                    } else {
                        const perpMid   = s.scx + Math.round((Math.random() * 2 - 1) * proxW);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStrips.push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.scy + (dir === 'S' ? 2 : -2), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
                    }
                }
            }

            for (const strip of s.shoveStrips) {
                if (!strip.active) continue;
                if (allowed && !allowed.has(strip.dir)) continue; // QUADRANT CHECK
                if (allowAsymmetry && ((s.step - startDelay + strip.phaseOff) % Math.max(2, fillRate)) !== 0) continue;

                const isEW = strip.dir === 'E' || strip.dir === 'W';
                const step = (strip.dir === 'E' || strip.dir === 'S') ? 1 : -1;
                const rangeSize = strip.perpEnd - strip.perpStart + 1;
                
                const numSteps = 1 + Math.floor(Math.random() * shoveAmount);

                for (let i = 0; i < numSteps; i++) {
                    const lp = strip.leadPos;
                    if (isEW ? (strip.dir === 'E' ? lp > halfW : lp < -halfW)
                             : (strip.dir === 'S' ? lp > halfH : lp < -halfH)) {
                        strip.active = false;
                        break;
                    }

                    const bp = lp - step;
                    if (isEW) {
                        // Vertical strip (X=fixed, Y=range) -> 1x1, 1x2, or 1x3 block
                        gen.actionBuffer.push({ layer: targetLayer, fn: () => gen._spawnBlock(lp, strip.perpStart, 1, rangeSize, targetLayer, true) });
                        gen.actionBuffer.push({ layer: targetLayer, fn: () => gen._spawnBlock(bp, strip.perpStart, 1, rangeSize, targetLayer, true) });
                    } else {
                        // Horizontal strip (Y=fixed, X=range) -> 1x1, 2x1, or 3x1 block
                        gen.actionBuffer.push({ layer: targetLayer, fn: () => gen._spawnBlock(strip.perpStart, lp, rangeSize, 1, targetLayer, true) });
                        gen.actionBuffer.push({ layer: targetLayer, fn: () => gen._spawnBlock(strip.perpStart, bp, rangeSize, 1, targetLayer, true) });
                    }

                    strip.leadPos += step;
                }
            }
        });

        this.registerBehavior('hole_filler', function(s) {
            if (!gen._getConfig('HoleFillerEnabled')) return;
            const fillRate = Math.max(1, gen._getConfig('HoleFillerRate') ?? 1);
            if (s.step % fillRate !== 0) return;

            const layer = 1;
            const w = gen.logicGridW, h = gen.logicGridH;
            const grid = gen.layerGrids[layer];
            if (!grid) return;

            const bs = gen._getBlockSize();
            const xVis = Math.ceil(gen.cols / bs.w / 2) + 2;
            const yVis = Math.ceil(gen.rows / bs.h / 2) + 2;

            if (s.holeQIdx === undefined) s.holeQIdx = 0;
            const q = s.holeQIdx;
            s.holeQIdx = (s.holeQIdx + 1) % 4;

            let minX = (q === 0 || q === 3) ? -xVis : 0;
            let maxX = (q === 0 || q === 3) ? 0 : xVis;
            let minY = (q === 0 || q === 1) ? -yVis : 0;
            let maxY = (q === 0 || q === 1) ? 0 : yVis;

            const scanMinX = -xVis, scanMaxX = xVis;
            const scanMinY = -yVis, scanMaxY = yVis;
            const scanW = scanMaxX - scanMinX + 1, scanH = scanMaxY - scanMinY + 1;
            const outsideMap = new Uint8Array(scanW * scanH);
            const getIdx = (bx, by) => (by - scanMinY) * scanW + (bx - scanMinX);

            const isOccupiedAny = (bx, by) => {
                const maxL = gen._getMaxLayer();
                for (let l = 0; l <= maxL; l++) {
                    if (gen._isOccupied(bx, by, l)) return true;
                }
                return false;
            };

            const queue = new Int32Array(scanW * scanH);
            let head = 0, tail = 0;

            const add = (bx, by) => {
                if (bx < scanMinX || bx > scanMaxX || by < scanMinY || by > scanMaxY) return;
                const idx = getIdx(bx, by);
                if (outsideMap[idx] === 0 && !isOccupiedAny(bx, by)) {
                    outsideMap[idx] = 1;
                    queue[tail++] = idx;
                }
            };

            for (let bx = scanMinX; bx <= scanMaxX; bx++) { add(bx, scanMinY); add(bx, scanMaxY); }
            for (let by = scanMinY; by <= scanMaxY; by++) { add(scanMinX, by); add(scanMaxX, by); }

            while (head < tail) {
                const idx = queue[head++];
                const bx = scanMinX + (idx % scanW);
                const by = scanMinY + Math.floor(idx / scanW);
                add(bx + 1, by); add(bx - 1, by); add(bx, by + 1); add(bx, by - 1);
            }

            for (let by = minY; by <= maxY; by++) {
                for (let bx = minX; bx <= maxX; bx++) {
                    if (!gen._isOccupied(bx, by, layer)) {
                        const isEnclosed = (outsideMap[getIdx(bx, by)] === 0);
                        
                        // Also check for "Small Gaps" (3 or 4 cardinal neighbors are full on any layer)
                        let neighborCount = 0;
                        if (isOccupiedAny(bx - 1, by)) neighborCount++;
                        if (isOccupiedAny(bx + 1, by)) neighborCount++;
                        if (isOccupiedAny(bx, by - 1)) neighborCount++;
                        if (isOccupiedAny(bx, by + 1)) neighborCount++;
                        const isSmallGap = (neighborCount >= 3);

                        if (isEnclosed || isSmallGap) {
                            gen.actionBuffer.push({ layer, fn: () => {
                                gen._spawnBlock(bx, by, 1, 1, layer, false, null);
                            }});
                        }
                    }
                }
            }
        });
    }

    _getMaxLayer() {
        let maxLayer = this._getConfig('LayerCount');
        if (maxLayer === undefined || maxLayer === null) maxLayer = 0;
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        if (usePromotion && (maxLayer === undefined || maxLayer === null || maxLayer < 1)) return 1;
        return maxLayer;
    }

    _getBiasedDirections() {
        const ratio = (this.cols / this.rows) || 1.0;
        const faces = ['N', 'S', 'E', 'W'];
        let horizWeight = Math.max(1.0, ratio);
        let vertWeight = Math.max(1.0, 1.0 / ratio);

        // Axis-Hit Bias: If N/S hit edges, boost E/W weights (and vice-versa)
        const s = this.behaviorState;
        if (s && s.hitEdge) {
            const hitNS = s.hitEdge.N || s.hitEdge.S;
            const hitEW = s.hitEdge.E || s.hitEdge.W;
            if (hitNS && !hitEW) horizWeight *= 1.5;
            if (hitEW && !hitNS) vertWeight *= 1.5;
        }

        const weightedPool = [
            { id: 'N', w: vertWeight },
            { id: 'S', w: vertWeight },
            { id: 'E', w: horizWeight },
            { id: 'W', w: horizWeight }
        ];
        const result = [];
        const pool = [...weightedPool];
        while (pool.length > 0) {
            let totalW = 0;
            for (const item of pool) totalW += item.w;
            let r = Math.random() * totalW;
            for (let i = 0; i < pool.length; i++) {
                r -= pool[i].w;
                if (r <= 0) {
                    result.push(pool[i].id);
                    pool.splice(i, 1);
                    break;
                }
            }
        }
        return result;
    }

    _executeExpansionStep(layer, bw, bh, randomness = 0.8, originX = null, originY = null) {
        if (!this.logicGridW || !this.logicGridH) return false;
        const w = this.logicGridW, h = this.logicGridH;
        const cx = (originX !== null) ? (Math.floor(w / 2) + originX) : Math.floor(w / 2);
        const cy = (originY !== null) ? (Math.floor(h / 2) + originY) : Math.floor(h / 2);
        const grid = this.layerGrids[layer];
        if (!grid) return false;

        const allowed = this._getAllowedDirs(layer);
        const faces = this._getBiasedDirections().filter(f => !allowed || allowed.has(f));
        if (faces.length === 0) return false;

        for (const dir of faces) {
            const stepDir = (dir === 'N' || dir === 'W') ? -1 : 1;
            let spokeBlocks = 0;
            if (dir === 'N' || dir === 'S') {
                for (let gy = cy + stepDir; dir === 'N' ? gy >= 0 : gy < h; gy += stepDir) {
                    if (grid[gy * w + cx] !== -1) spokeBlocks++; else break;
                }
            } else {
                for (let gx = cx + stepDir; dir === 'W' ? gx >= 0 : gx < w; gx += stepDir) {
                    if (grid[cy * w + gx] !== -1) spokeBlocks++; else break;
                }
            }
            const spokeHalf = (dir === 'N') ? cy : (dir === 'S') ? h - 1 - cy : (dir === 'W') ? cx : w - 1 - cx;
            const extRatio = spokeHalf > 0 ? spokeBlocks / spokeHalf : 1.0;
            const maxOffset = extRatio > 0.33 ? Math.min(3, Math.ceil(extRatio * 3)) : 0;

            let firstEmpty = null;
            offSearch:
            for (let off = 0; off <= maxOffset; off++) {
                const offVals = off === 0 ? [0] : [off, -off];
                for (const dAxis of offVals) {
                    if (dir === 'N' || dir === 'S') {
                        const gx = cx + dAxis;
                        if (gx < 0 || gx >= w) continue;
                        for (let gy = cy + stepDir; dir === 'N' ? gy >= 0 : gy < h; gy += stepDir) {
                            if (grid[gy * w + gx] === -1) { firstEmpty = { x: gx, y: gy }; break offSearch; }
                        }
                    } else {
                        const gy = cy + dAxis;
                        if (gy < 0 || gy >= h) continue;
                        for (let gx = cx + stepDir; dir === 'W' ? gx >= 0 : gx < w; gx += stepDir) {
                            if (grid[gy * w + gx] === -1) { firstEmpty = { x: gx, y: gy }; break offSearch; }
                        }
                    }
                }
            }

            if (firstEmpty) {
                // Growth Variance: Up to 20% chance of consecutive steps (streak)
                let bonusSteps = (Math.random() < 0.2) ? 1 + Math.floor(Math.random() * 2) : 0;
                
                // NEW: Use the scale as the base number of steps for the nudge
                const scale = Math.max(bw, bh);
                let totalSteps = scale + bonusSteps;
                
                // Force 1x1 blocks for the actual nudge spawn steps
                const spawnW = 1;
                const spawnH = 1;

                let currentPos = { x: firstEmpty.x, y: firstEmpty.y };
                let lastSuccess = false;

                for (let sIdx = 0; sIdx < totalSteps; sIdx++) {
                    const isTemp = (sIdx === totalSteps - 1) && Math.random() < (randomness * 0.8);
                    
                    // Principle: Don't spawn on top of existing Layer 1 blocks (prevents hole-making on retraction)
                    if (this._isOccupied(currentPos.x, currentPos.y, layer)) break;

                    const success = this._nudge(currentPos.x, currentPos.y, spawnW, spawnH, dir, layer, false);
                    
                    if (success) {
                        lastSuccess = true;
                        if (isTemp) {
                            const cycle = this.behaviorState.cycle || (this.behaviorState.cycle = { step: 0, lastTempBlock: null });
                            cycle.lastTempBlock = { x: currentPos.x, y: currentPos.y, w: spawnW, h: spawnH };
                        }

                        // If we have more steps, find the next empty in the same lane
                        if (sIdx < totalSteps - 1) {
                            let nextEmpty = null;
                            const curGX = this.gridCX + currentPos.x, curGY = this.gridCY + currentPos.y;
                            for (let gy = curGY + stepDir, gx = curGX + stepDir; (dir === 'N' ? gy >= 0 : dir === 'S' ? gy < h : dir === 'W' ? gx >= 0 : gx < w); (dir === 'N' || dir === 'S' ? gy += stepDir : gx += stepDir)) {
                                const targetX = (dir === 'N' || dir === 'S') ? curGX : gx;
                                const targetY = (dir === 'N' || dir === 'S') ? gy : curGY;
                                if (grid[targetY * w + targetX] === -1) {
                                    nextEmpty = { x: targetX - this.gridCX, y: targetY - this.gridCY };
                                    break;
                                }
                            }
                            if (nextEmpty) {
                                currentPos = nextEmpty;
                            } else {
                                break;
                            }
                        }
                    } else {
                        break;
                    }
                }
                
                if (lastSuccess) return true;
            }
        }
        return false;
    }

    _attemptNudgeGrowthWithParams(targetLayer, bw, bh, originX = null, originY = null, cycleState = null, chance = null) {
        const layer = 1;
        const cycle = cycleState || (this.behaviorState.nudgeState ? this.behaviorState.nudgeState.cycle : (this.behaviorState.nudgeState = { cycle: { step: 0, lastTempBlock: null } }).cycle);
        const randomness = chance ?? (this._getConfig('NudgeChance') ?? 0.8);

        if (cycle.step === 0) {
            const success = this._executeExpansionStep(layer, bw, bh, randomness, originX, originY);
            if (success) { cycle.step = 1; return true; }
            return false;
        } else {
            const isRetract = Math.random() < randomness;
            let success = false;
            if (isRetract && cycle.lastTempBlock) {
                const b = cycle.lastTempBlock;
                this._removeBlock(b.x, b.y, b.w, b.h, layer);
                cycle.lastTempBlock = null;
                success = true;
            } else {
                success = true;
            }
            cycle.step = (cycle.step + 1) % 3;
            return success;
        }
    }

    registerBehavior(id, fn, options = {}) {
        this.growthPool.set(id, {
            fn,
            enabled: options.enabled ?? true,
            label: options.label ?? id
        });
    }

    _generateInsideOutPattern() {
        const p = [true, true, true];
        const p1 = Math.floor(Math.random() * 3);
        p[p1] = false;
        // 50% chance for a second pause in the 3-step segment
        if (Math.random() < 0.5) {
            let p2;
            do { p2 = Math.floor(Math.random() * 3); } while (p2 === p1);
            p[p2] = false;
        }
        return p;
    }

    _generateInsideOutDistinctPattern(existing) {
        let attempt;
        do { attempt = this._generateInsideOutPattern(); } while (attempt.join() === existing.join());
        return attempt;
    }

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

    _generateSeedSchedule(scx, scy) {
        const schedule = {};
        const dirs = ['N', 'S', 'E', 'W'];
        const maxLayer = Math.min(1, this._getConfig('LayerCount') ?? 0);

        // Compute per-direction boost based on canvas aspect ratio
        const baseBoost = this._getConfig('SpineBoost') ?? 4;
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.rows / bs.h));
        const aspect = visW / visH;
        const hBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(aspect)));
        const vBoost = Math.max(1, Math.round(baseBoost * Math.sqrt(1 / aspect)));
        const dirBoost = { N: vBoost, S: vBoost, E: hBoost, W: hBoost };

        const addToSchedule = (layer, dir, stepPool) => {
            const step = stepPool[Math.floor(Math.random() * stepPool.length)];
            if (!schedule[step]) schedule[step] = [];
            schedule[step].push({ layer, dir, originX: scx, originY: scy, boost: dirBoost[dir] });
        };

        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        const minL = usePromotion ? 1 : 0;
        const endL = Math.min(1, maxLayer);

        // Seed all layers in the schedule to ensure they start connected to the spines
        for (let l = minL; l <= endL; l++) {
            const stepOffset = (l === minL || l === 1) ? 0 : (l * 2);
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => {
                addToSchedule(l, d, [stepOffset, stepOffset + 1, stepOffset + 2]);
            });
        }
        return schedule;
    }

    _pickLayerDirs(count) {
        if (count >= 4) return null;
        const all = ['N', 'S', 'E', 'W'];
        const shuffled = [...all].sort(() => Math.random() - 0.5);
        return new Set(shuffled.slice(0, Math.max(1, count)));
    }

    _getAllowedDirs(layer) {
        if (layer >= 2) return null; 
        return this.behaviorState.layerDirs[layer] ?? null;
    }

    _tickLayerDirs(s) {
        const genScaling = !!this._getConfig('GenerativeScaling');
        let userMax = parseInt(this._getConfig('QuadrantCount') ?? 4);
        
        // 1. Determine Min/Max Counts based on Fill Ratio (0-15%, 15-30%, >30%)
        let minCount = 1, maxCount = userMax;
        if (genScaling) {
            if (s.fillRatio < 0.15) { maxCount = Math.min(userMax, 2); minCount = 1; }
            else if (s.fillRatio < 0.30) { maxCount = Math.min(userMax, 3); minCount = 2; }
            else { maxCount = userMax; minCount = userMax; }
        } else {
            minCount = userMax; maxCount = userMax;
        }

        const all = ['N', 'S', 'E', 'W'];
        if (!s.dirPools) s.dirPools = { 0: [], 1: [] };
        if (!s.lastLayerDirs) s.lastLayerDirs = { 0: null, 1: null };

        for (let l = 0; l <= 1; l++) {
            // Pick a random count for this step within the allowed range
            let count = (minCount === maxCount) ? minCount : Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
            
            // If 4 directions are allowed, we set to null (all active)
            if (count >= 4) {
                if (s.layerDirs[l] !== null) {
                    this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = null; } });
                    s.lastLayerDirs[l] = null;
                }
                continue;
            }

            let pool = s.dirPools[l];
            let selected = new Set();
            
            // Fairness and Variation Logic: "Different than previous step" + "Each gets a turn"
            for (let attempt = 0; attempt < 5; attempt++) {
                selected.clear();
                // Refill pool if it doesn't have enough directions
                if (pool.length < count) {
                    const fresh = [...all];
                    // Simple Fisher-Yates shuffle
                    for (let i = fresh.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
                    }
                    s.dirPools[l] = pool = [...pool, ...fresh];
                }
                
                // Peek at the first 'count' directions
                const candidates = pool.slice(0, count);
                for (const d of candidates) selected.add(d);

                // Verify "Different than previous step"
                const last = s.lastLayerDirs[l];
                let isSame = false;
                if (last && last.size === selected.size) {
                    isSame = true;
                    for (const d of selected) {
                        if (!last.has(d)) { isSame = false; break; }
                    }
                }

                // Commit choice if unique or max attempts reached
                if (!isSame || attempt === 4) {
                    pool.splice(0, count);
                    break;
                } else {
                    // Reshuffle pool to try for a different combination
                    for (let i = pool.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [pool[i], pool[j]] = [pool[j], pool[i]];
                    }
                }
            }

            this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = selected; } });
            s.lastLayerDirs[l] = selected;
        }
    }

    _seedStrips(s) {
        const scheduled = s.seedSchedule ? s.seedSchedule[s.step] : null;
        if (!scheduled) return;
        const globalBoost = this._getConfig('SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY, boost } of scheduled) {
            this.actionBuffer.push({ layer, fn: () => {
                const strip = this._createStrip(layer, dir, originX, originY);
                strip.isSpine = true;
                strip.boostSteps = boost ?? globalBoost;
                strip.pattern = this._generateInsideOutPattern();
                strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
            }});
        }
    }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = { id, layer, direction: dir, originX, originY, headX: originX, headY: originY,
            pattern: this.behaviorState.pattern, pausePattern: this.behaviorState.pausePattern,
            stepPhase: 0, growCount: 0, stepsSinceLastGrowth: 0, paused: false, active: true, blockIds: [],
            startDelay: 0 };
        this.strips.set(id, strip);
        return strip;
    }

    _tickStrips(s) {
        const allowAsymmetry = !!this._getConfig('AllowAsymmetry');
        const useGenerativeScaling = !!this._getConfig('GenerativeScaling');

        if (allowAsymmetry) {
            for (const [col, ticks] of s.deferredCols.entries()) {
                if (ticks <= 1) s.deferredCols.delete(col); else s.deferredCols.set(col, ticks - 1);
            }
            for (const [row, ticks] of s.deferredRows.entries()) {
                if (ticks <= 1) s.deferredRows.delete(row); else s.deferredRows.set(row, ticks - 1);
            }
            if (Math.random() < 0.2) {
                const bs = this._getBlockSize();
                const halfW = Math.floor(this.cols / bs.w / 2), halfH = Math.floor(this.rows / bs.h / 2);
                if (Math.random() < 0.5) s.deferredCols.set(s.scx + Math.floor((Math.random() * 2 - 1) * (halfW + 5)), 1 + Math.floor(Math.random() * 2));
                else s.deferredRows.set(s.scy + Math.floor((Math.random() * 2 - 1) * (halfH + 5)), 1 + Math.floor(Math.random() * 2));
            }
        }
        for (const strip of this.strips.values()) {
            if (!strip.active) continue;

            if (strip.startDelay > 0) {
                strip.startDelay--;
                continue;
            }

            const allowed = this._getAllowedDirs(strip.layer);
            if (allowed && !allowed.has(strip.direction)) continue; // QUADRANT RESTRICTION

            strip.stepsSinceLastGrowth = (strip.stepsSinceLastGrowth || 0) + 1;

            if (allowAsymmetry && strip.layer < 2 && (s.deferredCols.has(strip.headX) || s.deferredRows.has(strip.headY))) continue;
            
            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                if (strip.isExpansion || strip.isSpine) {
                    strip.pattern = this._generateInsideOutPattern();
                    strip.pausePattern = this._generateInsideOutDistinctPattern(strip.pattern);
                } else {
                    strip.pattern = this._generateRandomPattern();
                    strip.pausePattern = this._generateDistinctPattern(strip.pattern);
                }
            }

            let shouldGrow = false;
            // Spine boost takes precedence, but Generative Scaling overrides frequency if enabled
            // If it's a spine, we now force it to follow the rhythmic behavior.
            if (strip.boostSteps > 0 && !useGenerativeScaling && !strip.isSpine) {
                shouldGrow = true;
                strip.boostSteps--;
            } else {
                if (useGenerativeScaling && strip.growCount < 7 && !strip.isExpansion && !strip.isSpine) {
                    const gc = strip.growCount;
                    const requiredSteps = (gc < 2) ? 3 : (gc < 4) ? 2 : 1;
                    if (strip.stepsSinceLastGrowth >= requiredSteps) {
                        shouldGrow = true;
                    }
                } else {
                    const pattern = strip.paused ? strip.pausePattern : strip.pattern;
                    const phase = (strip.isExpansion || strip.isSpine) ? (strip.stepPhase % 3) : (strip.stepPhase % pattern.length);
                    shouldGrow = pattern[phase];
                    if (shouldGrow && strip.isSpine && strip.boostSteps > 0) strip.boostSteps--;
                }
            }

            if (shouldGrow && strip.isExpansion) {
                const [dx, dy] = this._dirDelta(strip.direction);
                const { bw, bh } = this._calcBlockSize(strip, s.fillRatio);
                const nextX = strip.headX + dx * bw, nextY = strip.headY + dy * bh;
                const scx = s.scx || 0, scy = s.scy || 0;
                const limitN = s.axisMaxDist.N - 2, limitS = s.axisMaxDist.S - 2;
                const limitE = s.axisMaxDist.E - 2, limitW = s.axisMaxDist.W - 2;

                if (!s.hitEdge?.N && dy < 0 && (scy - nextY) > limitN) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.S && dy > 0 && (nextY - scy) > limitS) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.E && dx > 0 && (nextX - scx) > limitE) {
                    shouldGrow = false;
                } else if (!s.hitEdge?.W && dx < 0 && (scx - nextX) > limitW) {
                    shouldGrow = false;
                }
            }

            if (shouldGrow) this.actionBuffer.push({ layer: strip.layer, isSpine: !!strip.isSpine, fn: () => this._growStrip(strip, s) });
            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _calcBlockSize(strip, fillRatio) {
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.rows / bs.h));

        if (this._getConfig('GenerativeScaling')) {
            if (strip.isExpansion || strip.isSpine) {
                const ratio = visW / visH;
                if (ratio > 1.05 && (strip.direction === 'E' || strip.direction === 'W')) {
                    const baseSize = Math.floor(ratio);
                    const chance = ratio - baseSize;
                    const size = Math.random() < chance ? baseSize + 1 : baseSize;
                    return { bw: size, bh: 1 };
                }
                if (ratio < 0.95 && (strip.direction === 'N' || strip.direction === 'S')) {
                    const invRatio = 1.0 / ratio;
                    const baseSize = Math.floor(invRatio);
                    const chance = invRatio - baseSize;
                    const size = Math.random() < chance ? baseSize + 1 : baseSize;
                    return { bw: 1, bh: size };
                }
            }
            return { bw: 1, bh: 1 };
        }

        const fillThreshold = this._getConfig('FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };
        const maxScale = this._getConfig('MaxBlockScale') ?? 3;
        const halfW = Math.floor(visW / 2);
        const halfH = Math.floor(visH / 2);
        const ox = strip.originX, oy = strip.originY, dir = strip.direction;
        let distFactor, axisRatio;
        if (dir === 'N') { distFactor = halfH > 0 ? (oy + halfH) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'S') { distFactor = halfH > 0 ? (halfH - oy) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'E') { distFactor = halfW > 0 ? (halfW - ox) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        else { distFactor = halfW > 0 ? (ox + halfW) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        distFactor = Math.max(0, Math.min(2, distFactor));
        const size = Math.min(maxScale, Math.max(1, Math.round(distFactor * axisRatio)));
        return (dir === 'N' || dir === 'S') ? { bw: 1, bh: size } : { bw: size, bh: 1 };
    }

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);
        
        // Force 1×1 on the very first growth step.
        // Otherwise use _calcBlockSize to adhere to size scaling settings.
        let { bw, bh } = (strip.growCount === 0) ? { bw: 1, bh: 1 } : this._calcBlockSize(strip, s.fillRatio);

        const newHeadX = strip.headX + dx * bw, newHeadY = strip.headY + dy * bh;
        const edges = this.checkScreenEdge(newHeadX, newHeadY);
        if (edges) {
            if (s.hitEdge) {
                if (edges.top) s.hitEdge.N = true;
                if (edges.bottom) s.hitEdge.S = true;
                if (edges.left) s.hitEdge.W = true;
                if (edges.right) s.hitEdge.E = true;
            }
            strip.active = false;
            this.strips.delete(strip.id);
            return;
        }
        
        const spawnX = dx > 0 ? strip.headX + 1 : (dx < 0 ? newHeadX : strip.headX);
        const spawnY = dy > 0 ? strip.headY + 1 : (dy < 0 ? newHeadY : strip.headY);

        const canPassThrough = (strip.isNudge || strip.layer === 1 || strip.bypassOccupancy);

        if (strip.isNudge) {
            // Use _nudge for actual nudge growth effect
            const success = this._nudge(spawnX, spawnY, bw, bh, strip.direction, strip.layer, strip.layer === 0);
            if (success || canPassThrough) {
                strip.headX = newHeadX;
                strip.headY = newHeadY;
                strip.growCount++;
                strip.stepsSinceLastGrowth = 0;
            }
        } else {
            // Check occupancy for standard growth unless it's layer 1 (or nudge)
            const id = this._spawnBlock(spawnX, spawnY, bw, bh, strip.layer, strip.bypassOccupancy || canPassThrough);
            if (id !== -1 || canPassThrough) {
                strip.headX = newHeadX;
                strip.headY = newHeadY;
                strip.growCount++;
                strip.stepsSinceLastGrowth = 0;
            }
        }
    }

    _nudge(x, y, w, h, face, layer = 0, multiLayer = false) {
        // Principle #5: Disable starting nudges for Layer 0 when promotion is enabled
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        if (layer === 0 && usePromotion) {
             return false;
        }

        let axis = 'X', dir = 1;
        if (face) {
            const f = face.toUpperCase();
            if (f === 'N') { axis = 'Y'; dir = -1; }
            else if (f === 'S') { axis = 'Y'; dir = 1; }
            else if (f === 'E') { axis = 'X'; dir = 1; }
            else if (f === 'W') { axis = 'X'; dir = -1; }
        }

        const shiftAmt = (axis === 'X' ? w : h);
        const targetLayers = (multiLayer) ? [0, 1, 2] : [layer];
        const targetLayersSet = new Set(targetLayers);

        const shiftedBlocks = [];
        for (const b of this.activeBlocks) {
            if (!targetLayersSet.has(b.layer)) continue;

            let shouldMove = false;
            if (axis === 'X') {
                const laneMatch = (b.y >= y && b.y < y + h);
                const posMatch = (dir > 0) ? (b.x >= x) : (b.x + b.w - 1 <= x + w - 1);
                if (laneMatch && posMatch) shouldMove = true;
            } else {
                const laneMatch = (b.x >= x && b.x < x + w);
                const posMatch = (dir > 0) ? (b.y >= y) : (b.y + b.h - 1 <= y + h - 1);
                if (laneMatch && posMatch) shouldMove = true;
            }
            if (shouldMove) {
                shiftedBlocks.push({ b, oldX: b.x, oldY: b.y, oldW: b.w, oldH: b.h, layer: b.layer });
                if (axis === 'X') b.x += (dir * shiftAmt);
                else b.y += (dir * shiftAmt);
            }
        }

        for (const m of shiftedBlocks) {
            this.currentStepOps.push(['addRect', m.b.x, m.b.y, m.b.x + m.b.w - 1, m.b.y + m.b.h - 1, m.layer, 0, true]);
            if (!this._isOccupied(m.oldX, m.oldY, m.layer)) {
                this._spawnBlock(m.oldX, m.oldY, m.oldW, m.oldH, m.layer, true);
            }
        }

        let success = false;
        for (const l of targetLayers) {
            if (this._spawnBlock(x, y, w, h, l, true) !== -1) {
                success = true;
            }
        }

        return success;
    }

    _dirDelta(dir) { return dir === 'N' ? [0,-1] : (dir === 'S' ? [0,1] : (dir === 'E' ? [1,0] : (dir === 'W' ? [-1,0] : [0,0]))); }

    _spawnBlock(x, y, w, h, layer, bypassOccupancy = false, source = null) {
        // Principle #4: Disable spawning on Layer 0 if promotion is enabled
        // EXCEPT if it's a promotion/forced spawn (indicated by bypassOccupancy)
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        if (!bypassOccupancy && layer === 0 && usePromotion) {
             return -1;
        }

        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        const gx1 = this.gridCX + x1, gy1 = this.gridCY + y1, gx2 = this.gridCX + x2, gy2 = this.gridCY + y2;
        if (gx1 < 0 || gx2 >= this.logicGridW || gy1 < 0 || gy2 >= this.logicGridH) return -1;
        const grid = this.layerGrids[layer];
        if (!bypassOccupancy) {
            for (let gy = gy1; gy <= gy2; gy++) {
                for (let gx = gx1; gx <= gx2; gx++) {
                    if (grid[gy * this.logicGridW + gx] !== -1) return -1;
                }
            }
        }
        
        // BUG FIX: Monotonically increasing ID
        const id = this._blockNextId++;
        const b = { x, y, w, h, layer, id, source: source };
        this.activeBlocks.push(b);
        this._currentStepActions.push(b);

        for (let gy = gy1; gy <= gy2; gy++) {
            const rowOff = gy * this.logicGridW;
            for (let gx = gx1; gx <= gx2; gx++) {
                const idx = rowOff + gx;
                grid[idx] = id;
                
                // Optimized Promotion: Spawn on L0 resets promotion counter
            }
        }
        this.currentStepOps.push(['addRect', x1, y1, x2, y2, layer, 0, true]);
        const md = this.behaviorState.layerMaxDist[layer] || (this.behaviorState.layerMaxDist[layer] = { N: 0, S: 0, E: 0, W: 0 });
        const rx = x - this.behaviorState.scx, ry = y - this.behaviorState.scy;
        if (ry < 0) md.N = Math.max(md.N, -ry); else if (ry > 0) md.S = Math.max(md.S, ry + h - 1);
        if (rx > 0) md.E = Math.max(md.E, rx + w - 1); else if (rx < 0) md.W = Math.max(md.W, -rx);

        return id;
    }

    _removeBlock(x, y, w, h, layer) {
        // Find block for ID reference (needed for sub-layer sync)
        const block = this.activeBlocks.find(b => b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h);
        if (!block) return;
        const bid = block.id;

        this.currentStepOps.push(['removeBlock', x, y, x + w - 1, y + h - 1, layer, 0, true]);
        this.activeBlocks = this.activeBlocks.filter(b => b !== block);
        
        const gx1 = this.gridCX + x, gy1 = this.gridCY + y, gx2 = this.gridCX + x + w - 1, gy2 = this.gridCY + y + h - 1;
        const grid = this.layerGrids[layer];

        for (let gy = gy1; gy <= gy2; gy++) {
            const rowOff = gy * this.logicGridW;
            for (let gx = gx1; gx <= gx2; gx++) {
                const idx = rowOff + gx;
                grid[idx] = -1;

                // Optimized Promotion: If removing from L1, reset promotion counter
            }
        }
    }

    _updateFillRatio(s) {
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);

        // Optimization: Use a smaller visibility bitmask to count unique cells
        if (!this._visCountBuffer || this._visCountBuffer.length !== visW * visH) {
            this._visCountBuffer = new Uint8Array(visW * visH);
        } else {
            this._visCountBuffer.fill(0);
        }

        let uniqueCount = 0;
        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const bx1 = Math.max(-halfW, b.x), bx2 = Math.min(halfW - 1, b.x + b.w - 1);
            const by1 = Math.max(-halfH, b.y), by2 = Math.min(halfH - 1, b.y + b.h - 1);
            
            if (bx2 >= bx1 && by2 >= by1) {
                for (let gy = by1; gy <= by2; gy++) {
                    const rowOff = (gy + halfH) * visW;
                    for (let gx = bx1; gx <= bx2; gx++) {
                        const idx = rowOff + (gx + halfW);
                        if (this._visCountBuffer[idx] === 0) {
                            this._visCountBuffer[idx] = 1;
                            uniqueCount++;
                        }
                    }
                }
            }
        }
        s.fillRatio = Math.min(1, uniqueCount / (visW * visH));
    }

    _expandInsideOut(s) {
        if (!this._getConfig('InsideOutEnabled')) return;
        const delay = this._getConfig('InsideOutDelay') ?? 6;
        let bucketPeriod = Math.max(1, this._getConfig('InsideOutStepsBetweenBuckets') ?? 3);

        const genScaling = !!this._getConfig('GenerativeScaling');
        if (genScaling) {
            // Adjust density by reducing steps between buckets instead of increasing block size.
            // Reduce period by 1-2 steps based on current fill ratio to increase density.
            const reduction = s.fillRatio < 0.4 ? 2 : (s.fillRatio < 0.7 ? 1 : 0);
            bucketPeriod = Math.max(1, bucketPeriod - reduction);
        }

        if (s.step < delay || (s.step - delay) % bucketPeriod !== 0) return;

        const bucketSize = Math.max(1, this._getConfig('InsideOutBucketSize') ?? 3);
        const bs = this._getBlockSize(), halfW = Math.floor(this.cols / bs.w / 2), halfH = Math.floor(this.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = Math.min(1, this._getConfig('LayerCount') ?? 0);

        if (!s.insideOutProgression) s.insideOutProgression = {};

        // Helper: Check if the dependency wave (last wave of previous bucket) has started growing
        const prevBucketStarted = (arm, baseWave) => {
            if (baseWave <= 1) return true;
            const depWave = baseWave - 1;
            let foundAny = false;
            for (const strip of this.strips.values()) {
                if (strip.isExpansion && strip.arm === arm && strip.wave === depWave) {
                    foundAny = true;
                    if (strip.growCount > 0) return true;
                }
            }
            return !foundAny;
        };

        for (const arm of ['N', 'S', 'E', 'W']) {
            if (!s.insideOutProgression[arm]) {
                s.insideOutProgression[arm] = { nextWave: 1 };
            }
            const prog = s.insideOutProgression[arm];
            const baseWave = prog.nextWave;

            // 1. Boundary Check for the base wave (if base is out, arm is likely done)
            const [dx, dy] = this._dirDelta(arm);
            const bx = s.scx + dx * baseWave, by = s.scy + dy * baseWave;
            if (Math.abs(bx - s.scx) > halfW + edgeBuf || Math.abs(by - s.scy) > halfH + edgeBuf) continue;

            // 2. Progression Check: Wait for previous bucket to establish
            if (!prevBucketStarted(arm, baseWave)) continue;

            // 3. Spine Connectivity Gate: Only spawn bucket if the first wave's origin is established
            if (!this._isOccupied(bx, by, 0) && !this._isOccupied(bx, by, 1)) continue;

            // Prepare waves for this bucket
            const waves = [];
            for (let i = 0; i < bucketSize; i++) waves.push(baseWave + i);
            
            // Shuffled variance within the bucket (if > 1, and not the first wave)
            if (bucketSize > 1 && baseWave > 1) {
                for (let i = waves.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [waves[i], waves[j]] = [waves[j], waves[i]];
                }
            }

            let spawnedAnyInBucket = false;
            for (let l = 0; l <= maxLayer; l++) {
                const allowed = this._getAllowedDirs(l);
                if (allowed && !allowed.has(arm)) continue;

                for (const wave of waves) {
                    const ox = s.scx + dx * wave, oy = s.scy + dy * wave;

                    // Wave-specific boundary check
                    if (Math.abs(ox - s.scx) > halfW + edgeBuf || Math.abs(oy - s.scy) > halfH + edgeBuf) continue;

                    // Generative Scaling
                    if (genScaling) {
                        let activeExp = 0;
                        for (const st of this.strips.values()) if (st.isExpansion && st.active) activeExp++;
                        if (activeExp > (8 * (l + 1))) continue; 
                    }

                    const perp1 = (arm === 'N' || arm === 'S') ? 'E' : 'N';
                    const perp2 = (arm === 'N' || arm === 'S') ? 'W' : 'S';

                    const startDelay = Math.floor(Math.random() * bucketSize);
                    const ioPattern = this._generateInsideOutPattern();
                    const ioPausePattern = this._generateInsideOutDistinctPattern(ioPattern);
                    this.actionBuffer.push({ layer: l, fn: () => {
                        const s1 = this._createStrip(l, perp1, ox, oy);
                        s1.isExpansion = true; s1.arm = arm; s1.wave = wave;
                        s1.startDelay = startDelay;
                        s1.pattern = ioPattern;
                        s1.pausePattern = ioPausePattern;
                        const s2 = this._createStrip(l, perp2, ox, oy);
                        s2.isExpansion = true; s2.arm = arm; s2.wave = wave;
                        s2.startDelay = startDelay;
                        s2.pattern = ioPattern;
                        s2.pausePattern = ioPausePattern;
                    }});
                    spawnedAnyInBucket = true;
                }
            }

            // Only advance to the next bucket if we successfully attempted to spawn this one
            if (spawnedAnyInBucket) {
                prog.nextWave += bucketSize;
            }
        }
    }
    _isProceduralFinished() {
        // 1. Check axis points (fast)
        const w = this.logicGridW, h = this.logicGridH;
        const cx = this.gridCX, cy = this.gridCY;

        const check = (bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return true;
            for (let l = 0; l < 4; l++) {
                if (this.layerGrids[l][gy * w + gx] !== -1) return true;
            }
            return false;
        };

        const bs = this._getBlockSize();
        const halfVisibleW = Math.floor(this.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.rows / bs.h / 2);

        const hitN = check(0, -halfVisibleH);
        const hitS = check(0, halfVisibleH);
        const hitW = check(-halfVisibleW, 0);
        const hitE = check(halfVisibleW, 0);

        // 2. If axes reached, perform full visible coverage check
        if (hitN && hitS && hitW && hitE) {
            return this._isCanvasFullyCovered();
        }

        return false;
    }

    _syncSubLayers() {
        const pref = this.configPrefix;
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        
        if (!this._getConfig('EnableSyncSubLayers') && !usePromotion) return;
        
        // Use growTimer as frame equivalent and activeBlocks.length + id for change tracking
        if (this._syncFrame === this.behaviorState.growTimer) return;
        const stateKey = this.activeBlocks.length + '_' + this._blockNextId;
        if (this._lastSyncState === stateKey) return;
        
        this._lastSyncState = stateKey;
        this._syncFrame = this.behaviorState.growTimer;

        const maxLayer = this._getMaxLayer();
        if (maxLayer < 1) return;

        const w = this.logicGridW, h = this.logicGridH, l0Grid = this.layerGrids[0];
        if (!l0Grid) return;

        const cx = this.gridCX, cy = this.gridCY;
        const syncGrid = this._getBuffer('syncGrid', w * h, Uint8Array);
        syncGrid.fill(0);

        for (let i = 0; i < l0Grid.length; i++) if (l0Grid[i] !== -1) syncGrid[i] = 1;

        const rects = [];
        for (let gy = 0; gy < h; gy++) {
            const rowOffBase = gy * w;
            for (let gx = 0; gx < w; gx++) {
                if (syncGrid[rowOffBase + gx] === 1) {
                    let rw = 0; while (gx + rw < w && syncGrid[rowOffBase + gx + rw] === 1) rw++;
                    let rh = 1;
                    while (gy + rh < h) {
                        let lineFull = true;
                        const targetRowOff = (gy + rh) * w;
                        for (let ix = 0; ix < rw; ix++) if (syncGrid[targetRowOff + gx + ix] !== 1) { lineFull = false; break; }
                        if (!lineFull) break;
                        rh++;
                    }
                    rects.push({ x: gx - cx, y: gy - cy, w: rw, h: rh });
                    for (let iy = 0; iy < rh; iy++) {
                        const markRowOff = (gy + iy) * w;
                        for (let ix = 0; ix < rw; ix++) syncGrid[markRowOff + gx + ix] = 0;
                    }
                }
            }
        }

        for (const r of rects) {
            const rx = cx + r.x, ry = cy + r.y;
            for (let l = 1; l <= maxLayer; l++) {
                const targetGrid = this.layerGrids[l];
                let fullyCovered = true;
                for (let iy = 0; iy < r.h; iy++) {
                    const rowOff = (ry + iy) * w;
                    for (let ix = 0; ix < r.w; ix++) if (targetGrid[rowOff + rx + ix] === -1) { fullyCovered = false; break; }
                    if (!fullyCovered) break;
                }
                if (!fullyCovered) this._spawnBlock(r.x, r.y, r.w, r.h, l, true, 'sync');
            }
        }
    }

    _updateAxisMaxDist(s) {
        if (!s.axisMaxDist) s.axisMaxDist = { N: 0, S: 0, E: 0, W: 0 };
        else { s.axisMaxDist.N = 0; s.axisMaxDist.S = 0; s.axisMaxDist.E = 0; s.axisMaxDist.W = 0; }
        
        const scx = s.scx || 0, scy = s.scy || 0;
        for (const strip of this.strips.values()) {
            if (!strip.isSpine || !strip.active) continue;
            const dx = strip.headX - scx, dy = strip.headY - scy;
            if (strip.direction === 'N') s.axisMaxDist.N = Math.max(s.axisMaxDist.N, -dy);
            else if (strip.direction === 'S') s.axisMaxDist.S = Math.max(s.axisMaxDist.S, dy);
            else if (strip.direction === 'E') s.axisMaxDist.E = Math.max(s.axisMaxDist.E, dx);
            else if (strip.direction === 'W') s.axisMaxDist.W = Math.max(s.axisMaxDist.W, -dx);
        }
    }

    _updateLayerMaxDist(s) {
        if (!s.layerMaxDist) s.layerMaxDist = { 0: { N: 0, S: 0, E: 0, W: 0 }, 1: { N: 0, S: 0, E: 0, W: 0 } };
        const scx = s.scx || 0, scy = s.scy || 0;

        // Reset for 0 and 1 only
        s.layerMaxDist[0] = { N: 0, S: 0, E: 0, W: 0 };
        s.layerMaxDist[1] = { N: 0, S: 0, E: 0, W: 0 };

        for (let i = 0; i < this.activeBlocks.length; i++) {
            const b = this.activeBlocks[i];
            const l = b.layer;
            if (l > 1) continue;

            const md = s.layerMaxDist[l];
            const rx = b.x - scx, ry = b.y - scy;

            if (ry < 0) md.N = Math.max(md.N, -ry);
            if (ry + b.h - 1 > 0) md.S = Math.max(md.S, ry + b.h - 1);
            if (rx < 0) md.W = Math.max(md.W, -rx);
            if (rx + b.w - 1 > 0) md.E = Math.max(md.E, rx + b.w - 1);
        }
    }

    _processIntents() {
        for (const intent of this.actionBuffer) { if (!this.actionQueues.has(intent.layer)) this.actionQueues.set(intent.layer, []); this.actionQueues.get(intent.layer).push(intent); }
        this.actionBuffer = [];
        for (const [layer, queue] of this.actionQueues.entries()) {
            while (queue.length > 0) { const it = queue.shift(); if (it && it.fn) it.fn(); }
        }
    }

    _isOccupied(x, y, layer) {
        const gx = this.gridCX + x, gy = this.gridCY + y;
        const grid = this.layerGrids[layer];
        return !!grid && gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH && grid[gy * this.logicGridW + gx] !== -1;
    }

    _isUnderLayer(b, layer) {
        const x1 = b.x, y1 = b.y, x2 = b.x + b.w - 1, y2 = b.y + b.h - 1;
        const gx1 = this.gridCX + x1, gy1 = this.gridCY + y1, gx2 = this.gridCX + x2, gy2 = this.gridCY + y2;
        const grid = this.layerGrids[layer];
        if (!grid) return false;
        for (let gy = gy1; gy <= gy2; gy++) {
            for (let gx = gx1; gx <= gx2; gx++) {
                if (gy >= 0 && gy < this.logicGridH && gx >= 0 && gx < this.logicGridW) {
                    if (grid[gy * this.logicGridW + gx] !== -1) return true;
                }
            }
        }
        return false;
    }

    checkScreenEdge(bx, by) {
        const bs = this._getBlockSize();
        const halfVisibleW = Math.floor(this.cols / bs.w / 2);
        const halfVisibleH = Math.floor(this.rows / bs.h / 2);
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

    /**
     * Executes a single logical growth step.
     * @returns {boolean} True if generation is complete.
     */
    generateStep() {
        if (this._isProceduralFinished()) return true;

        const s = this.behaviorState;
        this.currentStepOps = [];
        
        const speed = this._getConfig('Speed') || 1;
        const delay = Math.max(1, Math.floor(11 - speed));
        
        let logicalStepPerformed = false;
        
        // Loop until we perform one logical step or reach a max iterations per call (safety)
        for (let i = 0; i < 50; i++) {
            if (s.growTimer % delay === 0) {
                this._currentStepActions = [];
                
                // Track max expansion distances (matches live path)
                this._updateAxisMaxDist(s);
                this._updateLayerMaxDist(s);

                // Ensure discovery layer reflects foundation (matches live path)
                this._syncSubLayers();

                // Promotion check (matches live path)
                const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
                // Promotion logic removed - no layers should promote.
                /*
                if (usePromotion) {
                    this._promoteLayer1Blocks();
                }
                */

                // Process deferred removals from layer_collision_interference (mirrors _attemptGrowth top-of-step drain)
                if (s.pendingDeletions && s.pendingDeletions.length > 0) {
                    for (const d of s.pendingDeletions) {
                        this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
                    }
                    s.pendingDeletions = [];
                }

                this.actionBuffer = [];
                this._attemptGrowth();
                
                // INCREMENT AGE OF ALL ACTIVE BLOCKS
                for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

                this._processIntents();
                
                s.step++;
                logicalStepPerformed = true;
            }
            s.growTimer++;
            
            // Completion check (matching live path)
            if (this._isProceduralFinished() && this.strips.size === 0) return true;
            
            if (logicalStepPerformed) break;
        }

        return false;
    }

    _isCanvasFullyCovered() {
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);
        const w = this.logicGridW, h = this.logicGridH;
        const cx = this.gridCX, cy = this.gridCY;

        for (let gy = -halfH; gy <= halfH; gy++) {
            for (let gx = -halfW; gx <= halfW; gx++) {
                const idx = (cy + gy) * w + (cx + gx);
                if (idx < 0 || idx >= w * h) continue;
                
                let occupied = false;
                for (let l = 0; l < 4; l++) {
                    if (this.layerGrids[l][idx] !== -1) {
                        occupied = true;
                        break;
                    }
                }
                if (!occupied) return false;
            }
        }
        return true;
    }

    _attemptGrowth() {
        if (this._isCanvasFullyCovered()) return;

        const mode = this._getConfig('Mode') || 'default';
        if (mode === 'v2' || this.configPrefix === 'quantizedGenerateV2') {
            return this._attemptV2Growth();
        }

        if (mode === 'advanced') {
            return this._attemptAdvancedGrowth();
        }

        // Default behavior pool
        const useNudge = (this._getConfig('EnableNudge') !== false);
        const quota = this._getConfig('SimultaneousSpawns') || 1;
        const maxLayer = this._getMaxLayer();
        const targetLayer = this.behaviorState.proceduralLayerIndex || 0;
        
        let actionsPerformed = 0;
        const maxAttempts = quota * 3;
        let attempts = 0;

        const pool = [];
        if (useNudge) {
            pool.push({ name: 'Nudge', fn: () => {
                const sw = this._getConfig('MinBlockWidth') || 1;
                const mw = (this._getConfig('MaxBlockWidth') || 2) * 1.5;
                const sh = this._getConfig('MinBlockHeight') || 1;
                const mh = (this._getConfig('MaxBlockHeight') || 2) * 1.5;
                const bw = Math.floor(Math.random() * (mw - sw + 1)) + sw;
                const bh = Math.floor(Math.random() * (mh - sh + 1)) + sh;
                return this._attemptNudgeGrowthWithParams(targetLayer, bw, bh);
            }});
        }

        while (actionsPerformed < quota && attempts < maxAttempts) {
            attempts++;
            let success = false;
            if (pool.length > 0) {
                const behavior = pool[Math.floor(Math.random() * pool.length)];
                if (behavior.fn()) success = true;
            }
            if (success) actionsPerformed++;
        }

        if (actionsPerformed === 0 && attempts >= maxAttempts) {
            return this._attemptAdvancedGrowth();
        }

        this.behaviorState.proceduralLayerIndex = (targetLayer + 1) % (maxLayer + 1);
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        if (this.behaviorState.proceduralLayerIndex === 0 && usePromotion && maxLayer >= 1) {
            this.behaviorState.proceduralLayerIndex = 1;
        }
    }

    _attemptAdvancedGrowth() {
        const w = this.logicGridW, h = this.logicGridH;
        const cx = this.gridCX, cy = this.gridCY;
        const chance = 0.66;
        const maxLayer = this._getMaxLayer();

        const bs = this._getBlockSize();
        const xVisible = Math.ceil(this.cols / bs.w / 2), yVisible = Math.ceil(this.rows / bs.h / 2);
        const xGrowthLimit = xVisible + 3, yGrowthLimit = yVisible + 3;
        const xFinishLimit = xVisible + 1, yFinishLimit = yVisible + 1;

        const ratio = this.cols / this.rows;
        const xBias = Math.max(1.0, ratio), yBias = Math.max(1.0, 1.0 / ratio);
        const getBurst = (bias) => {
            let b = 1; if (bias > 1.2) { if (Math.random() < (bias - 1.0) * 0.8) b = 2; if (b === 2 && Math.random() < (bias - 2.0) * 0.5) b = 3; }
            return b;
        };
        const xBurst = getBurst(xBias), yBurst = getBurst(yBias);

        const getGridVal = (layer, bx, by) => {
            const gx = cx + bx, gy = cy + by;
            if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -2;
            return this.layerGrids[layer][gy * w + gx];
        };

        const xSpines = [{id: 'spine_west', dx: -1}, {id: 'spine_east', dx: 1}];
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');

        for (const spine of xSpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeX = spine.dx;
                    while (true) {
                        const val = getGridVal(l, freeX, 0);
                        if (val === -2 || Math.abs(freeX) >= xFinishLimit) { if (l === maxLayer) finished = true; break; }
                        if (val === -1) break;
                        freeX += spine.dx;
                    }
                    if (Math.abs(freeX) < xFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = freeX + (b * spine.dx);
                            if (getGridVal(l, tx, 0) === -1 && Math.abs(tx) <= xGrowthLimit) {
                                this._spawnBlock(tx, 0, 1, 1, l, false, 'advanced');
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }
        
        const ySpines = [{id: 'spine_north', dy: -1}, {id: 'spine_south', dy: 1}];
        for (const spine of ySpines) {
            let finished = this.finishedBranches.has(spine.id);
            if (!finished) {
                for (let l = 1; l <= maxLayer; l++) {
                    let freeY = spine.dy;
                    while (true) {
                        const val = getGridVal(l, 0, freeY);
                        if (val === -2 || Math.abs(freeY) >= yFinishLimit) { if (l === 1) finished = true; break; }
                        if (val === -1) break;
                        freeY += spine.dy;
                    }
                    if (Math.abs(freeY) < yFinishLimit && Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = freeY + (b * spine.dy);
                            if (getGridVal(l, 0, ty) === -1 && Math.abs(ty) <= yGrowthLimit) {
                                this._spawnBlock(0, ty, 1, 1, l, false, 'advanced');
                            } else break;
                        }
                    }
                }
                if (finished) this.finishedBranches.add(spine.id);
            }
        }

        // --- Core Spines Logic ---
        for (const spine of xSpines) {
            for (let x = spine.dx; Math.abs(x) <= xGrowthLimit; x += spine.dx) {
                let anyLeading = false;
                for (let l = 1; l <= maxLayer; l++) if (getGridVal(l, x, 0) !== -1) anyLeading = true;
                
                const targetL = usePromotion ? 1 : 0;
                if (getGridVal(targetL, x, 0) === -1 && anyLeading) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < xBurst; b++) {
                            const tx = x + (b * spine.dx);
                            if (getGridVal(targetL, tx, 0) === -1) { 
                                this._spawnBlock(tx, 0, 1, 1, targetL, false, 'advanced');
                            } else break;
                        }
                    }
                    break;
                }
            }
        }

        let minX = 0, maxX = 0;
        for (let x = -1; ; x--) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { minX = x + 1; break; } }
        for (let x = 1; ; x++) { if (getGridVal(maxLayer, x, 0) === -1 || getGridVal(maxLayer, x, 0) === -2) { maxX = x - 1; break; } }

        for (let x = minX; x <= maxX; x++) {
            const directions = [{ id: 'n', dy: -1 }, { id: 's', dy: 1 }];
            for (const d of directions) {
                const branchId = `wing_${d.id}_${x}`;
                let wingFinished = this.finishedBranches.has(branchId), wingFreeY = d.dy;
                if (!wingFinished) {
                    while (true) {
                        const val = getGridVal(maxLayer, x, wingFreeY);
                        if (val === -2 || Math.abs(wingFreeY) >= yFinishLimit) { wingFinished = true; this.finishedBranches.add(branchId); break; }
                        if (val === -1) break; wingFreeY += d.dy;
                    }
                }
                if (!wingFinished) {
                    if (Math.random() < chance) {
                        for (let b = 0; b < yBurst; b++) {
                            const ty = wingFreeY + (b * d.dy);
                            if (getGridVal(maxLayer, x, ty) === -1 && Math.abs(ty) <= yGrowthLimit) { this._spawnBlock(x, ty, 1, 1, maxLayer, false, 'advanced'); } else break;
                        }
                    }
                }
                const searchLimitY = wingFinished ? yGrowthLimit : Math.abs(wingFreeY);
                for (let y = d.dy; Math.abs(y) <= searchLimitY; y += d.dy) {
                    const targetL = usePromotion ? 1 : 0;
                    if (getGridVal(targetL, x, y) === -1 && getGridVal(maxLayer, x, y) !== -1) {
                        if (Math.random() < chance) {
                            for (let b = 0; b < yBurst; b++) {
                                const ty = y + (b * d.dy);
                                if (getGridVal(targetL, x, ty) === -1 && getGridVal(maxLayer, x, ty) !== -1) { 
                                    this._spawnBlock(x, ty, 1, 1, targetL, false, 'advanced');
                                } else break;
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    _attemptV2Growth() {
        const s = this.behaviorState;
        this._updateAxisMaxDist(s);
        this._updateLayerMaxDist(s);

        if (s.pendingDeletions && s.pendingDeletions.length > 0) {
            for (const d of s.pendingDeletions) this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
            s.pendingDeletions = [];
        }

        if (!s.seedSchedule) {
            s.pattern = this._generateRandomPattern();
            s.pausePattern = this._generateDistinctPattern(s.pattern);
            
            const qCount = parseInt(this._getConfig('QuadrantCount') ?? 4);
            const qMaxLayer = this._getMaxLayer();
            const qBaseLife = 4 + Math.floor(Math.random() * 3);
            const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
            const minL = usePromotion ? 1 : 0;

            s.layerDirs = {}; s.layerDirLife = {};
            for (let l = minL; l <= qMaxLayer + 1; l++) { 
                s.layerDirs[l] = this._pickLayerDirs(qCount); 
                s.layerDirLife[l] = qBaseLife + l; 
            }
            
            s.seedSchedule = this._generateSeedSchedule(s.scx ?? 0, s.scy ?? 0);
            s.insideOutWave = 1;
            if (this.growthPool.size === 0) this._initBehaviors();
        }

        if (this.activeBlocks.length === 0) {
            const ox = s.scx ?? 0, oy = s.scy ?? 0;
            const maxLayer = this._getMaxLayer();
            const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
            for (let l = 0; l <= maxLayer; l++) {
                if (usePromotion && l !== 1) continue;
                this._spawnBlock(ox, oy, 1, 1, l, false, 'reseed');
            }
        }

        this._tickLayerDirs(s);
        this._updateFillRatio(s);
        this._seedStrips(s);

        // PERMANENT CORE BEHAVIOR: Main Nudge Growth
        if (this._getConfig('NudgeEnabled') !== false) {
            const nudgeStartDelay = this._getConfig('NudgeStartDelay') ?? 2;
            if (s.step >= nudgeStartDelay) {
                const nudgeChance = this._getConfig('NudgeChance') ?? 0.8;
                if (Math.random() <= nudgeChance) {
                    const { bw, bh } = this._calcBlockSize({ originX: s.scx, originY: s.scy, direction: 'N' }, s.fillRatio);
                    this._attemptNudgeGrowthWithParams(1, bw, bh, s.scx, s.scy);
                }
            }
        }

        this._tickStrips(s);
        this._expandInsideOut(s);

        const quota = this._getConfig('SimultaneousSpawns') || 1;
        const enabledBehaviors = [...this.growthPool.values()].filter(b => b.fn && b.enabled);
        if (enabledBehaviors.length > 0) {
            for (let q = 0; q < quota; q++) {
                const b = enabledBehaviors[Math.floor(Math.random() * enabledBehaviors.length)];
                b.fn.call(this, s);
            }
        }
    }

    seedOriginStep() {
        this.currentStepOps = [];
        const isRandomStart = !!this._getConfig('RandomStart');
        if (isRandomStart) return this.currentStepOps; // Don't seed Step 0 if random

        const s = this.behaviorState;
        const maxLayer = this._getMaxLayer();
        const usePromotion = (this._getConfig('SingleLayerMode') || this.configPrefix === 'quantizedGenerateV2');
        for (let l = 0; l <= maxLayer; l++) {
            if (usePromotion && l !== 1) continue;
            this._spawnBlock(s.scx, s.scy, 1, 1, l, true);
        }
        return this.currentStepOps;
    }

    /**
     * Runs the generator until completion or maxSteps.
     * @param {number} maxSteps
     * @returns {Array} The generated sequence of operation steps.
     */
    generate(maxSteps = 300) {
        const sequence = [];
        const s = this.behaviorState;

        // Seed origin block(s) in Step 0
        sequence.push(this.seedOriginStep());

        while (s.step < maxSteps) {
            const done = this.generateStep();
            sequence.push(this.currentStepOps); // always push, even if empty, to preserve timing parity with live path

            if (done) break;
        }
        return sequence;
    }

}

if (typeof window !== 'undefined') window.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
else if (typeof self !== 'undefined') self.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
