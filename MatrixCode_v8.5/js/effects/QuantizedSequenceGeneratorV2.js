/**
 * QuantizedSequenceGeneratorV2.js
 * Headless generator for Quantized Block Generator (v2) sequences.
 */
class QuantizedSequenceGeneratorV2 {
    constructor(cols, rows, configState) {
        this.cols = cols;
        this.rows = rows;
        this.config = configState;

        this.logicScale = 3.0;
        this.logicGridW = Math.ceil(cols * this.logicScale);
        this.logicGridH = Math.ceil(rows * this.logicScale);
        this.gridCX = Math.floor(this.logicGridW / 2);
        this.gridCY = Math.floor(this.logicGridH / 2);

        this.layerGrids = [];
        const layerCount = (this._getConfig('LayerCount') ?? 2) + 2;
        for (let l = 0; l < layerCount; l++) {
            this.layerGrids[l] = new Int32Array(this.logicGridW * this.logicGridH).fill(-1);
        }

        this.strips = new Map();
        this._stripNextId = 0;
        this.activeBlocks = [];
        this.maskOps = [];
        this.actionBuffer = [];
        this.actionQueues = new Map();
        this.growthPool = new Map();

        this.behaviorState = {
            step: 0,
            growTimer: 0,
            scx: 0,
            scy: 0,
            hitEdge: false,
            lastActionTime: 0,
            fillRatio: 0,
            insideOutWave: 1,
            deferredCols: new Map(),
            deferredRows: new Map(),
            layerMaxDist: {},
            ribOrigins: new Set(),
            pendingDeletions: [],
            pendingExpansions: [],
            spawnSpreaderSymmetryQueue: []
        };

        this.currentStepOps = [];
        this._init();
    }

    _log(...args) { if (this.config && this.config.logErrors) console.log(...args); }
    _warn(...args) { if (this.config && this.config.logErrors) console.warn(...args); }
    _error(...args) { if (this.config && this.config.logErrors) console.error(...args); }

    _getConfig(keySuffix) {
        const prefix = 'quantizedGenerateV2';
        const overrideDefaults = this.config[prefix + 'OverrideDefaults'];
        
        // Settings that all Quantized effects share and can inherit from Quantized Defaults.
        const inheritable = [
            'ShadowWorldFadeSpeed', 'GlassBloom', 'GlassBloomScaleToSize', 'GlassCompressionThreshold',
            'LineGfxColor', 'LineGfxBrightness', 'LineGfxIntensity', 'LineGfxGlow', 'LineGfxPersistence',
            'GlassRefractionEnabled', 'GlassRefractionWidth', 'GlassRefractionBrightness', 'GlassRefractionSaturation',
            'GlassRefractionCompression', 'GlassRefractionOffset', 'GlassRefractionGlow',
            'LineGfxTintOffset', 'LineGfxSaturation', 'LineGfxAdditiveStrength', 'LineGfxSharpness',
            'LineGfxRoundness', 'LineGfxGlowFalloff', 'LineGfxSampleOffsetX', 'LineGfxSampleOffsetY',
            'LineGfxMaskSoftness', 'LineGfxOffsetX', 'LineGfxOffsetY', 'Speed', 'BlockWidthCells', 'BlockHeightCells'
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
            const startDelay = gen._getConfig('NudgeStartDelay') ?? 4;
            if (s.step < startDelay) return;
            const spawnChance = gen._getConfig('NudgeChance') ?? 0.3;
            if (Math.random() > spawnChance) return;
            const maxStrips = gen._getConfig('MaxNudgeStrips') ?? 8;
            const minSpacing = gen._getConfig('NudgeSpacing') ?? 3;
            const axisBias   = gen._getConfig('NudgeAxisBias') ?? 0.5;

            const useHAxis = Math.random() < axisBias;
            const maxLayer = gen._getConfig('LayerCount') ?? 0;
            let candidates;
            if (useHAxis) {
                candidates = gen.activeBlocks.filter(b => b.layer <= maxLayer && b.y <= s.scy && s.scy <= b.y + b.h - 1);
            } else {
                candidates = gen.activeBlocks.filter(b => b.layer <= maxLayer && b.x <= s.scx && s.scx <= b.x + b.w - 1);
            }
            if (candidates.length === 0) return;

            const processCandidate = (block) => {
                const layer = block.layer;
                const allowed = gen._getAllowedDirs(layer);
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
                const edge = gen.checkScreenEdge(nx, ny);
                if (edge) return;

                for (const strip of gen.strips.values()) {
                    if (!strip.isNudge) continue;
                    if (Math.abs(strip.originX - nx) + Math.abs(strip.originY - ny) < minSpacing) return;
                }
                let nudgeCount = 0;
                for (const st of gen.strips.values()) if (st.isNudge && st.active) nudgeCount++;
                if (nudgeCount >= maxStrips) return;
                const strip = gen._createStrip(layer, dir, nx, ny);
                strip.isNudge = true;
                strip.stepPhase = Math.floor(Math.random() * 6);
            };

            const block = candidates[Math.floor(Math.random() * candidates.length)];
            gen.actionBuffer.push({ layer: block.layer, fn: () => processCandidate(block) });
        });

        this.registerBehavior('block_spawner', function(s) {
            if (!gen._getConfig('BlockSpawnerEnabled')) return;
            const startDelay = gen._getConfig('BlockSpawnerStartDelay') ?? 10;
            if (s.step < startDelay) return;
            const randomness = gen._getConfig('BlockSpawnerRandomness') ?? 0.5;
            const maxSpawn = gen._getConfig('BlockSpawnerCount') ?? 2;

            // 1. Collect potential targets
            const targets = [];
            
            // Expansion strips
            for (const strip of gen.strips.values()) {
                if (!strip.active) continue;
                targets.push({ type: 'strip', obj: strip });
            }

            // Main nudge growth points
            const faces = ['N', 'S', 'E', 'W'];
            const w = gen.logicGridW, h = gen.logicGridH;
            const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
            const layer = 1;
            const grid = gen.layerGrids[layer];
            if (grid) {
                for (const dir of faces) {
                    let headX = 0, headY = 0;
                    if (dir === 'N' || dir === 'S') {
                        const step = (dir === 'N') ? -1 : 1;
                        for (let gy = cy + step; (dir === 'N' ? gy >= 0 : gy < h); gy += step) {
                            if (grid[gy * w + cx] === -1) { headX = 0; headY = gy - cy - step; break; }
                        }
                    } else {
                        const step = (dir === 'W') ? -1 : 1;
                        for (let gx = cx + step; (dir === 'W' ? gx >= 0 : gx < w); gx += step) {
                            if (grid[cy * w + gx] === -1) { headX = gx - cx - step; headY = 0; break; }
                        }
                    }
                    targets.push({ type: 'nudge', dir, x: headX, y: headY, layer });
                }
            }

            if (targets.length === 0) return;

            // 2. Shuffle and pick up to maxSpawn
            const shuffled = targets.sort(() => Math.random() - 0.5);
            let spawnedCount = 0;

            for (const target of shuffled) {
                if (spawnedCount >= maxSpawn) break;
                if (Math.random() > randomness) continue;

                let aheadX, aheadY;
                const layer = 1; // Force Layer 1 for all spawner blocks
                const dir = target.type === 'strip' ? target.obj.direction : target.dir;
                const [dx, dy] = gen._dirDelta(dir);
                const dist = 3 + Math.floor(Math.random() * 6);

                if (target.type === 'strip') {
                    aheadX = target.obj.headX + dx * dist;
                    aheadY = target.obj.headY + dy * dist;
                } else {
                    aheadX = target.x + dx * dist;
                    aheadY = target.y + dy * dist;
                }

                if (gen.checkScreenEdge(aheadX, aheadY)) continue;
                if (!gen._isOccupied(aheadX, aheadY, layer)) {
                    gen.actionBuffer.push({ layer: layer, fn: () => gen._spawnBlock(aheadX, aheadY, 1, 1, layer, true) });
                    spawnedCount++;
                }
            }
        }, { enabled: this._getConfig('BlockSpawnerEnabled') ?? false, label: 'Block Spawner' });

        this.registerBehavior('spawn_spreader', function(s) {
            if (!gen._getConfig('SpawnSpreaderEnabled')) return;
            const startDelay = gen._getConfig('SpawnSpreaderStartDelay') ?? 20;
            if (s.step < startDelay) return;

            // Handle Symmetry Queue
            // Strips are seeded at the axis point (item.x, item.y) which should be occupied,
            // ensuring headOnBlock is true so _tickStrips will fire the strip.
            if (s.spawnSpreaderSymmetryQueue && s.spawnSpreaderSymmetryQueue.length > 0) {
                const pending = [];
                for (const item of s.spawnSpreaderSymmetryQueue) {
                    if (s.step >= item.stepToSpawn) {
                        const strip = gen._createStrip(item.layer, item.dir, item.x, item.y);
                        strip.isNudge = true;
                        strip.stepPhase = Math.floor(Math.random() * 6);
                    } else {
                        pending.push(item);
                    }
                }
                s.spawnSpreaderSymmetryQueue = pending;
            }

            const spawnsPerStep = gen._getConfig('SpawnSpreaderCount') ?? 1;
            const lockToAxis = gen._getConfig('SpawnSpreaderLockToAxis') ?? true;
            const preferCenter = gen._getConfig('SpawnSpreaderPreferCenter') ?? true;
            const randomness = gen._getConfig('SpawnSpreaderRandomness') ?? 0.5;
            const preferSymmetry = gen._getConfig('SpawnSpreaderSymmetry') ?? true;

            const bs = gen._getBlockSize();
            const halfW = Math.floor(gen.cols / bs.w / 2);
            const halfH = Math.floor(gen.rows / bs.h / 2);

            for (let i = 0; i < spawnsPerStep; i++) {
                // useVerticalAxis means we search along the Y axis (varying Y, X=scx)
                const useVerticalAxis = Math.random() < 0.5;
                const maxSteps = useVerticalAxis ? halfH : halfW;

                let axisX = 0, axisY = 0, found = false, dir;

                // Try both sides of center independently, in random order
                const sides = Math.random() < 0.5 ? [1, -1] : [-1, 1];

                for (const side of sides) {
                    let distancesToTry;

                    if (preferCenter) {
                        // In-out enforcement: compute the consecutive-occupancy frontier.
                        // The spreader cannot use axis distance D until all of 1..D-1 are occupied —
                        // i.e., the axis must be filled continuously outward from center with no gaps.
                        let frontier = 0;
                        for (let d = 1; d <= maxSteps; d++) {
                            const pos = d * side;
                            const ax = useVerticalAxis ? s.scx : s.scx + pos;
                            const ay = useVerticalAxis ? s.scy + pos : s.scy;
                            if (gen._isOccupied(ax, ay, 0) || gen._isOccupied(ax, ay, 1)) {
                                frontier = d;
                            } else {
                                break; // Gap found — stop; can't cross it
                            }
                        }
                        if (frontier === 0) continue; // Axis not yet started on this side

                        // Randomness slider: pick randomly from the first X% of reachable positions.
                        // At 50%: frontier=10 → pick from 1..5. At 30%: → 1..3. At 100%: → 1..10.
                        const candidateMax = Math.max(1, Math.round(frontier * randomness));

                        distancesToTry = [];
                        for (let d = 1; d <= candidateMax; d++) distancesToTry.push(d);
                        distancesToTry.sort(() => Math.random() - 0.5); // random within allowed range
                    } else {
                        // Non-preferCenter: random window offset within full range
                        const searchRange = Math.max(2, Math.floor(maxSteps * randomness));
                        const startOff = Math.floor(Math.random() * Math.max(1, maxSteps - searchRange));
                        distancesToTry = [];
                        for (let d = startOff + 1; d <= startOff + searchRange; d++) distancesToTry.push(d);
                        distancesToTry.sort(() => Math.random() - 0.5);
                    }

                    for (const dist of distancesToTry) {
                        const pos = dist * side;
                        const ax = useVerticalAxis ? s.scx : s.scx + pos;
                        const ay = useVerticalAxis ? s.scy + pos : s.scy;

                        // Rule: Only spawn if the block ON the axis already exists
                        if (gen._isOccupied(ax, ay, 0) || gen._isOccupied(ax, ay, 1)) {
                            const perpSides = Math.random() < 0.5 ? [1, -1] : [-1, 1];
                            for (const pSide of perpSides) {
                                const tx = useVerticalAxis ? ax + pSide : ax;
                                const ty = useVerticalAxis ? ay : ay + pSide;

                                if (gen.checkScreenEdge(tx, ty)) continue;
                                if (!gen._isOccupied(tx, ty, 0) && !gen._isOccupied(tx, ty, 1)) {
                                    // Record the axis point (occupied), not the perp target (empty).
                                    // Strips must be seeded at an occupied cell so headOnBlock is true.
                                    axisX = ax; axisY = ay;
                                    dir = useVerticalAxis ? (pSide > 0 ? 'E' : 'W') : (pSide > 0 ? 'S' : 'N');
                                    found = true; break;
                                }
                            }
                        }
                        if (found) break;
                    }
                    if (found) break;
                }

                if (!found) continue;

                const layer = Math.floor(Math.random() * (gen._getConfig('LayerCount') ?? 2));
                // Seed at the axis point (occupied) so headOnBlock is true in _tickStrips.
                // The first _growStrip call will spawn the block into the free perpendicular cell.
                const strip = gen._createStrip(layer, dir, axisX, axisY);
                strip.isNudge = true;
                strip.stepPhase = Math.floor(Math.random() * 6);

                if (preferSymmetry) {
                    // Mirror the axis point around the spawn center
                    const mirX = useVerticalAxis ? axisX : s.scx - (axisX - s.scx);
                    const mirY = useVerticalAxis ? s.scy - (axisY - s.scy) : axisY;
                    const mirDir = dir === 'N' ? 'S' : (dir === 'S' ? 'N' : (dir === 'E' ? 'W' : 'E'));

                    s.spawnSpreaderSymmetryQueue.push({
                        x: mirX,
                        y: mirY,
                        layer,
                        dir: mirDir,
                        stepToSpawn: s.step + 1 + Math.floor(Math.random() * 3)
                    });
                }
            }
        });

        // ── Flood Fill ─────────────────────────────────────────────────────────
        this.registerBehavior('flood_fill', function(s) {
            if (!gen._getConfig('FloodFillEnabled')) return;
            const startDelay = gen._getConfig('FloodFillStartDelay') ?? 15;
            const fillRate   = Math.max(1, gen._getConfig('FloodFillRate') ?? 5);
            if (s.step < startDelay || (s.step - startDelay) % fillRate !== 0) return;

            const layer1Blocks = gen.activeBlocks.filter(b => b.layer === 1);
            if (layer1Blocks.length === 0) return;

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const b of layer1Blocks) {
                if (b.x         < minX) minX = b.x;
                if (b.x + b.w - 1 > maxX) maxX = b.x + b.w - 1;
                if (b.y         < minY) minY = b.y;
                if (b.y + b.h - 1 > maxY) maxY = b.y + b.h - 1;
            }

            const dirs = ['N', 'S', 'E', 'W'];
            const dir  = dirs[Math.floor(Math.random() * 4)];
            const bs   = gen._getBlockSize();
            const halfW = Math.floor(gen.cols / bs.w / 2);
            const halfH = Math.floor(gen.rows / bs.h / 2);

            const trySpawn = (x, y) => {
                if (!gen._isOccupied(x, y, 1))
                    gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(x, y, 1, 1, 1, true) });
            };

            if (dir === 'N' || dir === 'S') {
                const colEdge = new Map();
                for (const b of layer1Blocks) {
                    for (let bx = b.x; bx <= b.x + b.w - 1; bx++) {
                        for (let by = b.y; by <= b.y + b.h - 1; by++) {
                            const cur = colEdge.get(bx);
                            if (dir === 'N') { if (cur === undefined || by < cur) colEdge.set(bx, by); }
                            else             { if (cur === undefined || by > cur) colEdge.set(bx, by); }
                        }
                    }
                }
                for (const [x, edge] of colEdge) {
                    const f1 = dir === 'N' ? edge - 1 : edge + 1;
                    const f2 = dir === 'N' ? edge - 2 : edge + 2;
                    if (f1 >= -halfH && f1 <= halfH) trySpawn(x, f1);
                    if (f2 >= -halfH && f2 <= halfH) trySpawn(x, f2);
                }
            } else {
                const rowEdge = new Map();
                for (const b of layer1Blocks) {
                    for (let bx = b.x; bx <= b.x + b.w - 1; bx++) {
                        for (let by = b.y; by <= b.y + b.h - 1; by++) {
                            const cur = rowEdge.get(by);
                            if (dir === 'E') { if (cur === undefined || bx > cur) rowEdge.set(by, bx); }
                            else             { if (cur === undefined || bx < cur) rowEdge.set(by, bx); }
                        }
                    }
                }
                for (const [y, edge] of rowEdge) {
                    const f1 = dir === 'E' ? edge + 1 : edge - 1;
                    const f2 = dir === 'E' ? edge + 2 : edge - 2;
                    if (f1 >= -halfW && f1 <= halfW) trySpawn(f1, y);
                    if (f2 >= -halfW && f2 <= halfW) trySpawn(f2, y);
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
                    if (isEW) {
                        const perpMid = s.scy + Math.round((Math.random() * 2 - 1) * proxH);
                        s.shoveStrips.push({ dir, perpStart: perpMid - 1, perpEnd: perpMid + 1, leadPos: s.scx + (dir === 'E' ? 1 : -1), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
                    } else {
                        const width     = 1 + Math.floor(Math.random() * 3);
                        const perpMid   = s.scx + Math.round((Math.random() * 2 - 1) * proxW);
                        const perpStart = perpMid - Math.floor((width - 1) / 2);
                        s.shoveStrips.push({ dir, perpStart, perpEnd: perpStart + width - 1, leadPos: s.scy + (dir === 'S' ? 1 : -1), active: true, phaseOff: allowAsymmetry ? Math.floor(Math.random() * 3) : 0 });
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

                if (isEW) {
                    for (let py = strip.perpStart; py <= strip.perpEnd; py++) {
                        if (!gen._isOccupied(lp, py, 1))
                            gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(lp, py, 1, 1, 1, true) });
                        if (!gen._isOccupied(bp, py, 1))
                            gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(bp, py, 1, 1, 1, true) });
                    }
                } else {
                    for (let px = strip.perpStart; px <= strip.perpEnd; px++) {
                        if (!gen._isOccupied(px, lp, 1))
                            gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(px, lp, 1, 1, 1, true) });
                        if (!gen._isOccupied(px, bp, 1))
                            gen.actionBuffer.push({ layer: 1, fn: () => gen._spawnBlock(px, bp, 1, 1, 1, true) });
                    }
                }

                strip.leadPos += step;
            }
        });
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
            stepPhase: 0, growCount: 0, paused: false, active: true, blockIds: [] };
        this.strips.set(id, strip);
        return strip;
    }

    _tickStrips(s) {
        const allowAsymmetry = !!this._getConfig('AllowAsymmetry');
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
            if (allowAsymmetry && strip.layer < 2 && (s.deferredCols.has(strip.headX) || s.deferredRows.has(strip.headY))) continue;
            const gx = this.gridCX + strip.headX, gy = this.gridCY + strip.headY;
            const grid = this.layerGrids[strip.layer];
            if (!grid || gx < 0 || gx >= this.logicGridW || gy < 0 || gy >= this.logicGridH || grid[gy * this.logicGridW + gx] === -1) continue;
            if (allowAsymmetry && strip.stepPhase === 0 && strip.boostSteps <= 0) {
                strip.pattern = this._generateRandomPattern();
                strip.pausePattern = this._generateDistinctPattern(strip.pattern);
            }
            let shouldGrow = strip.boostSteps > 0 ? (strip.boostSteps--, true) : (strip.paused ? strip.pausePattern : strip.pattern)[strip.stepPhase];
            if (shouldGrow) this.actionBuffer.push({ layer: strip.layer, isSpine: !!strip.isSpine, fn: () => this._growStrip(strip, s) });
            strip.stepPhase = (strip.stepPhase + 1) % 6;
        }
    }

    _growStrip(strip, s) {
        const [dx, dy] = this._dirDelta(strip.direction);
        const bw = 1, bh = 1;

        const newHeadX = strip.headX + dx * bw, newHeadY = strip.headY + dy * bh;
        if (this.checkScreenEdge(newHeadX, newHeadY)) { strip.active = false; this.strips.delete(strip.id); return; }
        const id = this._spawnBlock(dx > 0 ? strip.headX + 1 : newHeadX, dy > 0 ? strip.headY + 1 : newHeadY, bw, bh, strip.layer, true);
        if (id !== -1) { strip.headX = newHeadX; strip.headY = newHeadY; strip.growCount++; }
    }

    _dirDelta(dir) { return dir === 'N' ? [0,-1] : (dir === 'S' ? [0,1] : (dir === 'E' ? [1,0] : (dir === 'W' ? [-1,0] : [0,0]))); }

    _spawnBlock(x, y, w, h, layer, bypassOccupancy = false) {
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
        this.activeBlocks.push({ x, y, w, h, layer, id });
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
        const allowAsymmetry = !!this._getConfig('AllowAsymmetry');
        const bs = this._getBlockSize(), halfW = Math.floor(this.cols / bs.w / 2), halfH = Math.floor(this.rows / bs.h / 2);
        const edgeBuf = 2;
        const maxLayer = Math.min(1, this._getConfig('LayerCount') ?? 0);

        // Per-arm wave counters — asymmetry staggers arms by 0-2 waves at init
        if (!s.insideOutArmWaves) {
            s.insideOutArmWaves = {};
            for (const arm of ['N', 'S', 'E', 'W'])
                s.insideOutArmWaves[arm] = 1 + (allowAsymmetry ? Math.floor(Math.random() * 3) : 0);
        }

        const maxWave = Math.max(s.insideOutArmWaves['N'], s.insideOutArmWaves['S'], s.insideOutArmWaves['E'], s.insideOutArmWaves['W']);
        if (maxWave > halfW + edgeBuf && maxWave > halfH + edgeBuf) return;

        for (let l = 0; l <= maxLayer; l++) {
            const allowed = this._getAllowedDirs(l);

            // N arm (row above origin) — seeds E+W strips; bypass restriction on wave 1
            const wN = s.insideOutArmWaves['N'];
            if ((wN <= 1 || !allowed || allowed.has('N')) && s.scy - wN >= -(halfH + edgeBuf)) {
                const oy = s.scy - wN;
                this.actionBuffer.push({ layer: l, fn: () => {
                    this._createStrip(l, 'E', s.scx, oy).isExpansion = true;
                    this._createStrip(l, 'W', s.scx, oy).isExpansion = true;
                }});
            }

            // S arm (row below origin) — seeds E+W strips
            const wS = s.insideOutArmWaves['S'];
            if ((wS <= 1 || !allowed || allowed.has('S')) && s.scy + wS <= halfH + edgeBuf) {
                const oy = s.scy + wS;
                this.actionBuffer.push({ layer: l, fn: () => {
                    this._createStrip(l, 'E', s.scx, oy).isExpansion = true;
                    this._createStrip(l, 'W', s.scx, oy).isExpansion = true;
                }});
            }

            // E arm (column right of origin) — seeds N+S strips
            const wE = s.insideOutArmWaves['E'];
            if ((wE <= 1 || !allowed || allowed.has('E')) && s.scx + wE <= halfW + edgeBuf) {
                const ox = s.scx + wE;
                this.actionBuffer.push({ layer: l, fn: () => {
                    this._createStrip(l, 'N', ox, s.scy).isExpansion = true;
                    this._createStrip(l, 'S', ox, s.scy).isExpansion = true;
                }});
            }

            // W arm (column left of origin) — seeds N+S strips
            const wW = s.insideOutArmWaves['W'];
            if ((wW <= 1 || !allowed || allowed.has('W')) && s.scx - wW >= -(halfW + edgeBuf)) {
                const ox = s.scx - wW;
                this.actionBuffer.push({ layer: l, fn: () => {
                    this._createStrip(l, 'N', ox, s.scy).isExpansion = true;
                    this._createStrip(l, 'S', ox, s.scy).isExpansion = true;
                }});
            }
        }

        for (const arm of ['N', 'S', 'E', 'W']) s.insideOutArmWaves[arm]++;
        s.insideOutWave++;
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
                for (const b of this.growthPool.values()) if (b.fn && b.enabled) b.fn.call(this, s);
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
        const maxLayer = this._getConfig('LayerCount') ?? 0;
        for (let l = 0; l <= maxLayer; l++) {
            this._spawnBlock(s.scx, s.scy, 1, 1, l);
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
