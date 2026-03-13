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

        this.logicScale = 3.0;
        
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

        this.promotionGrid = new Uint8Array(this.logicGridW * this.logicGridH).fill(0);

        this.strips = new Map();
        this._stripNextId = 0;
        this.activeBlocks = [];
        this.maskOps = [];
        this.actionBuffer = [];
        this.actionQueues = new Map();
        this.growthPool = new Map();
        this._currentStepActions = [];

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
            'LineGfxColor', 'LineGfxBrightness', 'LineGfxIntensity', 'LineGfxGlow', 'LineGfxPersistence',
            'GlassRefractionEnabled', 'GlassRefractionWidth', 'GlassRefractionBrightness', 'GlassRefractionSaturation',
            'GlassRefractionCompression', 'GlassRefractionOffset', 'GlassRefractionGlow',
            'LineGfxTintOffset', 'LineGfxSaturation', 'LineGfxAdditiveStrength', 'LineGfxSharpness',
            'LineGfxRoundness', 'LineGfxGlowFalloff', 'LineGfxSampleOffsetX', 'LineGfxSampleOffsetY',
            'LineGfxMaskSoftness', 'LineGfxOffsetX', 'LineGfxOffsetY', 'Speed', 'BlockWidthCells', 'BlockHeightCells',
            'PerimeterEchoEnabled'
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
            if (keySuffix === 'BlockWidthCells') return this.config['quantizedBlockWidthCells'] ?? 4;
            if (keySuffix === 'BlockHeightCells') return this.config['quantizedBlockHeightCells'] ?? 4;
        }

        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        if (val !== undefined && val !== null && val !== "") return val;

        // Final fallback for non-inheritable but common settings
        if (keySuffix === 'BlockWidthCells') return this.config['quantizedBlockWidthCells'] ?? 4;
        if (keySuffix === 'BlockHeightCells') return this.config['quantizedBlockHeightCells'] ?? 4;

        return null;
    }

    _init() {
        const randomStart = !!this._getConfig('RandomStart');
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
        const gen = this;
        // Ported behaviors from QuantizedBlockGeneration.js
        this.registerBehavior('main_nudge_growth', function(s) {
            const startDelay = gen._getConfig('NudgeStartDelay') ?? 2;
            if (s.step < startDelay) return;
            const spawnChance = gen._getConfig('NudgeChance') ?? 0.8;
            if (Math.random() > spawnChance) return;

            // NEW: Use _calcBlockSize to determine if we should scale up the nudge
            const { bw, bh } = gen._calcBlockSize({ originX: s.scx, originY: s.scy, direction: 'N' }, s.fillRatio);

            // Execute the stateful 3-step cycle logic
            gen._attemptNudgeGrowthWithParams(1, bw, bh, s.scx, s.scy);
        }, { enabled: gen._getConfig('NudgeEnabled') ?? true, label: 'Main Nudge Growth' });

        this.registerBehavior('block_spawner_despawner', function(s) {
            const startDelay = gen._getConfig('BlockSpawnerStartDelay') ?? 10;
            const spawnRate  = Math.max(1, gen._getConfig('BlockSpawnerRate') ?? 4);
            const layer = 1;

            // 1. Spawning Logic
            if (s.step >= startDelay && (s.step - startDelay) % spawnRate === 0) {
                const maxSpawn = gen._getConfig('BlockSpawnerCount') ?? 5;

                const perimeterBlocks = gen.activeBlocks.filter(b => {
                    if (b.layer !== layer) return false;
                    const neighbors = [
                        {x: b.x, y: b.y - 1}, {x: b.x, y: b.y + b.h}, // N, S
                        {x: b.x - 1, y: b.y}, {x: b.x + b.w, y: b.y}  // W, E
                    ];
                    return neighbors.some(n => !gen._isOccupied(n.x, n.y, layer));
                });

                if (perimeterBlocks.length > 0) {
                    const sizes = [
                        {w: 1, h: 1}, {w: 1, h: 2}, {w: 2, h: 1}, 
                        {w: 1, h: 3}, {w: 3, h: 1}
                    ];

                    let spawnedCount = 0;
                    for (let i = 0; i < maxSpawn * 2 && spawnedCount < maxSpawn; i++) {
                        const parent = perimeterBlocks[Math.floor(Math.random() * perimeterBlocks.length)];
                        const size = sizes[Math.floor(Math.random() * sizes.length)];
                        
                        const side = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
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

                        // NEW: Occupancy Check (Only spawn in unoccupied blocks)
                        let isAreaFree = true;
                        for (let ly = 0; ly < gen.layerGrids.length; ly++) {
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
            const targetLayer = 1;

            const arms = [
                { key: 'V1',  vert: true,  side: 1,  perp: ['E', 'W'] }, // South Axis -> Spawns E/W
                { key: 'V-1', vert: true,  side: -1, perp: ['E', 'W'] }, // North Axis -> Spawns E/W
                { key: 'H1',  vert: false, side: 1,  perp: ['N', 'S'] }, // East Axis -> Spawns N/S
                { key: 'H-1', vert: false, side: -1, perp: ['N', 'S'] }  // West Axis -> Spawns N/S
            ];

            // 1. Process Symmetry Queue
            if (s.spreadingNudgeSymmetryQueue && s.spreadingNudgeSymmetryQueue.length > 0) {
                const pending = [];
                for (const item of s.spreadingNudgeSymmetryQueue) {
                    if (s.step >= item.stepToSpawn) {
                        const strip = gen._createStrip(item.layer, item.dir, item.x, item.y);
                        strip.isNudge = item.isNudge || false;
                        strip.bypassOccupancy = item.bypassOccupancy || false;
                        strip.stepPhase = Math.floor(Math.random() * 6);
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

            const allowAsymmetry = !!gen._getConfig('AllowAsymmetry');
            const bs    = gen._getBlockSize();
            const halfW = Math.floor(gen.cols / bs.w / 2);
            const halfH = Math.floor(gen.rows / bs.h / 2);
            const proxW = Math.max(2, Math.floor(halfW * 0.25));
            const proxH = Math.max(2, Math.floor(halfH * 0.25));

            if (!s.shoveStrips) s.shoveStrips = [];
            s.shoveStrips = s.shoveStrips.filter(st => st.active);

            if (s.shoveStrips.length === 0) {
                const qCount    = Math.min(4, parseInt(gen._getConfig('QuadrantCount') ?? 4));
                const allowed   = gen._getAllowedDirs(1);
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
                if (allowAsymmetry && ((s.step - startDelay + strip.phaseOff) % Math.max(2, fillRate)) !== 0) continue;

                const isEW = strip.dir === 'E' || strip.dir === 'W';
                const lp   = strip.leadPos;

                if (isEW ? (strip.dir === 'E' ? lp > halfW : lp < -halfW)
                         : (strip.dir === 'S' ? lp > halfH : lp < -halfH)) {
                    strip.active = false; continue;
                }

                const step = (strip.dir === 'E' || strip.dir === 'S') ? 1 : -1;
                const bp   = lp - step;
                const rangeSize = strip.perpEnd - strip.perpStart + 1;

                if (isEW) {
                    // Vertical strip (X=fixed, Y=range) -> 1x1, 1x2, or 1x3 block
                    gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(lp, strip.perpStart, 1, rangeSize, 1, true) });
                    gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(bp, strip.perpStart, 1, rangeSize, 1, true) });
                } else {
                    // Horizontal strip (Y=fixed, X=range) -> 1x1, 2x1, or 3x1 block
                    gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(strip.perpStart, lp, rangeSize, 1, 1, true) });
                    gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(strip.perpStart, bp, rangeSize, 1, 1, true) });
                }

                strip.leadPos += step;
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

            let minX = (q === 0 || q === 2) ? -xVis : 0;
            let maxX = (q === 0 || q === 2) ? 0 : xVis;
            let minY = (q === 0 || q === 1) ? -yVis : 0;
            let maxY = (q === 0 || q === 1) ? 0 : yVis;

            const scanMinX = -xVis, scanMaxX = xVis;
            const scanMinY = -yVis, scanMaxY = yVis;
            const scanW = scanMaxX - scanMinX + 1, scanH = scanMaxY - scanMinY + 1;
            const outsideMap = new Uint8Array(scanW * scanH);
            const getIdx = (bx, by) => (by - scanMinY) * scanW + (bx - scanMinX);

            const queue = new Int32Array(scanW * scanH);
            let head = 0, tail = 0;

            const add = (bx, by) => {
                if (bx < scanMinX || bx > scanMaxX || by < scanMinY || by > scanMaxY) return;
                const idx = getIdx(bx, by);
                if (outsideMap[idx] === 0 && !gen._isOccupied(bx, by, layer)) {
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
                    if (!gen._isOccupied(bx, by, layer) && outsideMap[getIdx(bx, by)] === 0) {
                        gen.actionBuffer.push({ layer, fn: () => {
                            gen._spawnBlock(bx, by, 1, 1, layer, false, null);
                        }});
                    }
                }
            }
        });
    }

    _getMaxLayer() {
        let maxLayer = this._getConfig('LayerCount');
        if (maxLayer === undefined || maxLayer === null) maxLayer = 0;
        const usePromotion = (this._getConfig('LayerPromotionEnabled') || true);
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

        const faces = this._getBiasedDirections();
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
        if (maxLayer >= 1) {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(1, d, [0, 1, 2]));
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [3, 4, 5]));
        } else {
            [...dirs].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(0, d, [0, 1, 2, 3, 4, 5]));
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
        const quadrantCount = parseInt(this._getConfig('QuadrantCount') ?? 4);
        if (quadrantCount >= 4) {
            for (const layer in s.layerDirs) s.layerDirs[layer] = null;
            return;
        }
        for (const layer in s.layerDirs) {
            if (parseInt(layer) >= 2) continue;
            s.layerDirLife[layer]--;
            if (s.layerDirLife[layer] <= 0) {
                const l = parseInt(layer);
                this.actionBuffer.push({ layer: l, fn: () => { s.layerDirs[l] = this._pickLayerDirs(quadrantCount); } });
                s.layerDirLife[layer] = 4 + Math.floor(Math.random() * 4);
            }
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
            }});
        }
    }

    _createStrip(layer, dir, originX, originY) {
        const id = `strip_${this._stripNextId++}`;
        const strip = { id, layer, direction: dir, originX, originY, headX: originX, headY: originY,
            pattern: this.behaviorState.pattern, pausePattern: this.behaviorState.pausePattern,
            stepPhase: 0, growCount: 0, stepsSinceLastGrowth: 0, paused: false, active: true, blockIds: [] };
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

            strip.stepsSinceLastGrowth = (strip.stepsSinceLastGrowth || 0) + 1;

            if (allowAsymmetry && strip.layer < 2 && (s.deferredCols.has(strip.headX) || s.deferredRows.has(strip.headY))) continue;
            
            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                strip.pattern = this._generateRandomPattern();
                strip.pausePattern = this._generateDistinctPattern(strip.pattern);
            }

            let shouldGrow = false;
            if (strip.boostSteps > 0 && !useGenerativeScaling) {
                shouldGrow = true;
                strip.boostSteps--;
            } else {
                if (useGenerativeScaling && strip.growCount < 7) {
                    const gc = strip.growCount;
                    const requiredSteps = (gc < 2) ? 3 : (gc < 4) ? 2 : 1;
                    if (strip.stepsSinceLastGrowth >= requiredSteps) {
                        shouldGrow = true;
                    }
                } else {
                    shouldGrow = (strip.paused ? strip.pausePattern : strip.pattern)[strip.stepPhase];
                }
            }

            if (shouldGrow) this.actionBuffer.push({ layer: strip.layer, isSpine: !!strip.isSpine, fn: () => this._growStrip(strip, s) });
            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _calcBlockSize(strip, fillRatio) {
        const useGenerativeScaling = !!this._getConfig('GenerativeScaling');
        if (useGenerativeScaling && strip.growCount < 7) {
            const gc = strip.growCount;
            const size = (gc < 2 || gc === 4) ? 1 : 2;
            return (strip.direction === 'N' || strip.direction === 'S') ? { bw: 1, bh: size } : { bw: size, bh: 1 };
        }

        const fillThreshold = this._getConfig('FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };
        const maxScale = this._getConfig('MaxBlockScale') ?? 3;
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w));
        const visH = Math.max(1, Math.floor(this.rows / bs.h));
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
        if (layer === 0 && (this._getConfig('LayerPromotionEnabled'))) {
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
            this.currentStepOps.push(['addBlock', m.b.x, m.b.y, m.b.x + m.b.w - 1, m.b.y + m.b.h - 1, m.layer, 0, true]);
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
        const usePromotion = (this._getConfig('LayerPromotionEnabled') || true);
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
        const id = this.activeBlocks.length;
        const b = { x, y, w, h, layer, id, source: source };
        this.activeBlocks.push(b);
        this._currentStepActions.push(b);

        for (let gy = gy1; gy <= gy2; gy++) {
            for (let gx = gx1; gx <= gx2; gx++) grid[gy * this.logicGridW + gx] = id;
        }
        this.currentStepOps.push(['addBlock', x1, y1, x2, y2, layer, 0, true]);
        const md = this.behaviorState.layerMaxDist[layer] || (this.behaviorState.layerMaxDist[layer] = { N: 0, S: 0, E: 0, W: 0 });
        const rx = x - this.behaviorState.scx, ry = y - this.behaviorState.scy;
        if (ry < 0) md.N = Math.max(md.N, -ry); else if (ry > 0) md.S = Math.max(md.S, ry + h - 1);
        if (rx > 0) md.E = Math.max(md.E, rx + w - 1); else if (rx < 0) md.W = Math.max(md.W, -rx);

        return id;
    }

    _removeBlock(x, y, w, h, layer) {
        this.currentStepOps.push(['removeBlock', x, y, x + w - 1, y + h - 1, layer, 0, true]);
        this.activeBlocks = this.activeBlocks.filter(b => !(b.layer === layer && b.x === x && b.y === y && b.w === w && b.h === h));
        const gx1 = this.gridCX + x, gy1 = this.gridCY + y, gx2 = this.gridCX + x + w - 1, gy2 = this.gridCY + y + h - 1;
        const grid = this.layerGrids[layer];
        for (let gy = gy1; gy <= gy2; gy++) for (let gx = gx1; gx <= gx2; gx++) grid[gy * this.logicGridW + gx] = -1;
    }

    _updateFillRatio(s) {
        const bs = this._getBlockSize(), visW = Math.max(1, Math.floor(this.cols / bs.w)), visH = Math.max(1, Math.floor(this.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);
        let filled = 0;
        for (const b of this.activeBlocks) {
            const bx1 = Math.max(-halfW, b.x), bx2 = Math.min(halfW - 1, b.x + b.w - 1), by1 = Math.max(-halfH, b.y), by2 = Math.min(halfH - 1, b.y + b.h - 1);
            if (bx2 >= bx1 && by2 >= by1) filled += (bx2 - bx1 + 1) * (by2 - by1 + 1);
        }
        s.fillRatio = Math.min(1, filled / (visW * visH));
    }

    _expandInsideOut(s) {
        if (!this._getConfig('InsideOutEnabled')) return;
        const delay = this._getConfig('InsideOutDelay') ?? 6, period = Math.max(1, this._getConfig('InsideOutPeriod') ?? 3);
        if (s.step < delay || (s.step - delay) % period !== 0) return;

        const genScaling = !!this._getConfig('GenerativeScaling');
        const bs = this._getBlockSize(), halfW = Math.floor(this.cols / bs.w / 2), halfH = Math.floor(this.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = Math.min(1, this._getConfig('LayerCount') ?? 0);

        // Per-arm wave counters — ignore asymmetry, all arms start at Wave 1
        if (!s.insideOutArmWaves) {
            s.insideOutArmWaves = { 'N': 1, 'S': 1, 'E': 1, 'W': 1 };
        }

        const maxWave = Math.max(s.insideOutArmWaves['N'], s.insideOutArmWaves['S'], s.insideOutArmWaves['E'], s.insideOutArmWaves['W']);
        if (maxWave > halfW + edgeBuf && maxWave > halfH + edgeBuf) return;

        // Helper: Check if previous wave on this arm has placed at least one block
        const prevWaveStarted = (arm, wave) => {
            if (wave <= 1) return true;
            for (const strip of this.strips.values()) {
                if (strip.isExpansion && strip.arm === arm && strip.wave === wave - 1) {
                    if (strip.growCount > 0) return true;
                }
            }
            return false;
        };

        const armsToIncrement = new Set();
        for (let l = 0; l <= maxLayer; l++) {
            const allowed = this._getAllowedDirs(l);

            for (const arm of ['N', 'S', 'E', 'W']) {
                const wave = s.insideOutArmWaves[arm];
                const [dx, dy] = this._dirDelta(arm);
                const ox = s.scx + dx * wave, oy = s.scy + dy * wave;

                // 1. Quadrant Restriction: Only X quadrants updated at a time.
                // If count < 4, only allow arms currently in the rotation.
                if (allowed && !allowed.has(arm)) continue;

                // 2. Progression Check: Don't spawn wave N until wave N-1 has actually started growing
                if (!prevWaveStarted(arm, wave)) continue;

                // INDEPENDENCE FIX: Removed Spine Gating.
                // Expansion should proceed based on wave progression even if the 'axis' block 
                // was removed or shifted by another behavior.
                
                // 4. Boundary Check
                if (Math.abs(ox - s.scx) > halfW + edgeBuf || Math.abs(oy - s.scy) > halfH + edgeBuf) continue;

                // 5. Generative Scaling: Limit density by capping active expansion strips
                if (genScaling) {
                    let activeExp = 0;
                    for (const st of this.strips.values()) if (st.isExpansion && st.active) activeExp++;
                    if (activeExp > (8 * (l + 1))) continue; 
                }

                // If all checks pass, spawn the perpendicular strips
                const perp1 = (arm === 'N' || arm === 'S') ? 'E' : 'N';
                const perp2 = (arm === 'N' || arm === 'S') ? 'W' : 'S';

                this.actionBuffer.push({ layer: l, fn: () => {
                    const s1 = this._createStrip(l, perp1, ox, oy);
                    s1.isExpansion = true; s1.arm = arm; s1.wave = wave;
                    const s2 = this._createStrip(l, perp2, ox, oy);
                    s2.isExpansion = true; s2.arm = arm; s2.wave = wave;
                }});

                armsToIncrement.add(arm);
            }
        }

        for (const arm of armsToIncrement) s.insideOutArmWaves[arm]++;
        s.insideOutWave++;
    }

    _promoteLayer1Blocks() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h) return;
        
        const cx = this.gridCX, cy = this.gridCY;
        const l1 = this.layerGrids[1], l0 = this.layerGrids[0];
        if (!l1 || !l0) return;

        const maxLayer = this._getMaxLayer();

        for (let gy = 0; gy < h; gy++) {
            const rowOff = gy * w;
            for (let gx = 0; gx < w; gx++) {
                const idx = rowOff + gx;
                const isL1 = l1[idx] !== -1;
                const isL0 = l0[idx] !== -1;

                if (isL1 && !isL0) {
                    this.promotionGrid[idx]++;
                    if (this.promotionGrid[idx] >= 3) {
                        const bx = gx - cx, by = gy - cy;
                        
                        // Promotion Event: Spawn L0 (1x1)
                        const id = this._spawnBlock(bx, by, 1, 1, 0, true, 'promotion');
                        if (id !== -1) {
                            this.promotionGrid[idx] = 0; 
                        }
                    }
                } else {
                    this.promotionGrid[idx] = 0;
                }
            }
        }
    }

    _syncSubLayers() {
        const w = this.logicGridW, h = this.logicGridH;
        if (!w || !h || !this.layerGrids[0]) return;
        const l0 = this.layerGrids[0];
        
        // Target Layer 1 as discovery layer — it must reflect ALL of Layer 0
        const discoveryLayer = this.layerGrids[1];
        if (!discoveryLayer) return;

        for (let i = 0; i < w * h; i++) {
            if (l0[i] !== -1 && discoveryLayer[i] === -1) {
                discoveryLayer[i] = l0[i];
            }
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
                this._updateLayerMaxDist(s);

                // Ensure discovery layer reflects foundation (matches live path)
                this._syncSubLayers();

                // Promotion check (matches live path)
                const usePromotion = (this._getConfig('LayerPromotionEnabled') || true);
                if (usePromotion) {
                    this._promoteLayer1Blocks();
                }

                // Process deferred removals from layer_collision_interference (mirrors _attemptGrowth top-of-step drain)
                if (s.pendingDeletions && s.pendingDeletions.length > 0) {
                    for (const d of s.pendingDeletions) {
                        this._removeBlock(d.x, d.y, d.w, d.h, d.layer);
                    }
                    s.pendingDeletions = [];
                }

                this.actionBuffer = [];
                this._tickLayerDirs(s);
                this._updateFillRatio(s);
                this._seedStrips(s);
                this._tickStrips(s);
                this._expandInsideOut(s);

                // INCREMENT AGE OF ALL ACTIVE BLOCKS
                for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

                const quota = this._getConfig('SimultaneousSpawns') || 1;                const enabledBehaviors = [...this.growthPool.values()].filter(b => b.fn && b.enabled);
                if (enabledBehaviors.length > 0) {
                    for (let q = 0; q < quota; q++) {
                        const b = enabledBehaviors[Math.floor(Math.random() * enabledBehaviors.length)];
                        b.fn.call(this, s);
                    }
                }

                this._processIntents();
                
                s.step++;
                logicalStepPerformed = true;
            }
            s.growTimer++;
            
            // Heuristic for completion
            if (s.fillRatio > 0.98 && this.strips.size === 0) return true;
            
            if (logicalStepPerformed) break;
        }

        return false;
    }

    seedOriginStep() {
        this.currentStepOps = [];
        const s = this.behaviorState;
        const maxLayer = this._getMaxLayer();
        const usePromotion = (this._getConfig('LayerPromotionEnabled') || true);
        for (let l = 0; l <= maxLayer; l++) {
            if (usePromotion && l !== 1) continue;
            this._spawnBlock(s.scx, s.scy, 1, 1, l, true);
        }
        return this.currentStepOps;
    }

    /**
     * Runs the generator until completion or maxSteps.
     * @param {number} maxSteps
     * @param {Object} [cache] - Optional cache instance to check for activity aborts
     * @returns {Array} The generated sequence of operation steps.
     */
    generate(maxSteps = 300, cache = null) {
        const sequence = [];
        const s = this.behaviorState;

        // Seed origin block(s) in Step 0
        sequence.push(this.seedOriginStep());

        while (s.step < maxSteps) {
            // Check if we should abort because an effect started during background generation
            if (cache && cache.isAnyEffectActive()) {
                this._log("[QuantizedSequenceGeneratorV2] Aborting background generation: Effect detected.");
                return null; 
            }

            const done = this.generateStep();
            sequence.push(this.currentStepOps); // always push, even if empty, to preserve timing parity with live path
            
            if (done) break;
        }
        return sequence;
    }
}

if (typeof window !== 'undefined') window.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
else if (typeof self !== 'undefined') self.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
