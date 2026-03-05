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
            pendingExpansions: []
        };

        this.currentStepOps = [];
        this._init();
    }

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
            const scalingEnabled = gen._getConfig('GenerativeScaling');

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
                if (layer === 2 && !useHAxis) return;
                if (layer === 3 && useHAxis) return;
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

            if (scalingEnabled) {
                for (const block of candidates) {
                    gen.actionBuffer.push({ layer: block.layer, fn: () => processCandidate(block) });
                }
            } else {
                const block = candidates[Math.floor(Math.random() * candidates.length)];
                gen.actionBuffer.push({ layer: block.layer, fn: () => processCandidate(block) });
            }
        });

        this.registerBehavior('spine_rib_seeding', function(s) {
            const maxLayer = gen._getConfig('LayerCount') ?? 0;
            if (maxLayer < 2) return;
            const startDelay = gen._getConfig('InvisibleStartDelay') ?? 4;
            if (s.step < startDelay) return;
            const l2Chance = gen._getConfig('InvisibleL2Chance') ?? 1.0;
            const l3Chance = gen._getConfig('InvisibleL3Chance') ?? 1.0;
            const l2Max = gen._getConfig('MaxInvisibleL2Strips') ?? 100;
            const l3Max = gen._getConfig('MaxInvisibleL3Strips') ?? 100;
            const l2Spacing = gen._getConfig('InvisibleL2Spacing') ?? 1;
            const l3Spacing = gen._getConfig('InvisibleL3Spacing') ?? 1;

            if (!s.ribOrigins) s.ribOrigins = new Set();
            for (const block of gen.activeBlocks) {
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
                    for (const st of gen.strips.values()) if (st.layer === l && st.isInvisible && st.active) currentCount++;
                    if (currentCount >= maxStrips) return;
                    const allowed = gen._getAllowedDirs(l);
                    if (Math.random() < spawnChance) {
                        for (const rDir of ribs) {
                            if (allowed && !allowed.has(rDir)) continue;
                            let nx = block.x, ny = block.y;
                            if (l === 2) { 
                                const jitter = Math.floor(Math.random() * block.w);
                                nx = block.x + jitter;
                                ny = s.scy;
                            } else { 
                                const jitter = Math.floor(Math.random() * block.h);
                                nx = s.scx;
                                ny = block.y + jitter;
                            }
                            const idKey = `${l}_${rDir}_${nx}_${ny}`;
                            if (s.ribOrigins.has(idKey)) continue;
                            let tooClose = false;
                            for (const st of gen.strips.values()) {
                                if (st.layer === l && st.isInvisible && st.active) {
                                    if (Math.abs(st.originX - nx) + Math.abs(st.originY - ny) < spacing) {
                                        tooClose = true; break;
                                    }
                                }
                            }
                            if (tooClose) continue;
                            s.ribOrigins.add(idKey);
                            gen.actionBuffer.push({ layer: l, isSpine: false, fn: () => {
                                const rStrip = gen._createStrip(l, rDir, nx, ny);
                                rStrip.isInvisible = true;
                                rStrip.stepPhase = Math.floor(Math.random() * 6);
                            }});
                        }
                    }
                };
                if (onHAxis) processLayer(2, ['N', 'S']);
                if (onVAxis) processLayer(3, ['E', 'W']);
            }
        });

        this.registerBehavior('layer_collision_interference', function(s) {
            const flickerChance = gen._getConfig('L3FlickerChance') ?? 0.15;
            if (flickerChance <= 0) return;
            if (!s.pendingDeletions) s.pendingDeletions = [];
            for (const b of gen.activeBlocks) {
                if (b.layer === 3 && Math.random() < flickerChance) {
                    s.pendingDeletions.push({ x: b.x, y: b.y, w: b.w, h: b.h, layer: 3 });
                }
            }
        });

        this.registerBehavior('l3_spine_randomness', function(s) {
            const maxLayer = gen._getConfig('LayerCount') ?? 0;
            if (maxLayer < 3) return;
            const l0md = (s.layerMaxDist || {})[0] || { N: 0, S: 0, E: 0, W: 0 };
            const l3Chance = gen._getConfig('InvisibleL3Chance') ?? 1.0;
            const rangeN = l0md.N + 2;
            const rangeS = l0md.S + 2;
            const spawnCount = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < spawnCount; i++) {
                const ry = Math.floor(Math.random() * (rangeN + rangeS + 1)) - rangeN;
                gen.actionBuffer.push({ layer: 3, isSpine: true, fn: () => {
                    gen._spawnBlock(s.scx, s.scy + ry, 1, 1, 3);
                }});
            }
            if (Math.random() < l3Chance) {
                const ry = Math.floor(Math.random() * (rangeN + rangeS + 1)) - rangeN;
                gen.actionBuffer.push({ layer: 3, isSpine: false, fn: () => {
                    const dir = Math.random() < 0.5 ? 'E' : 'W';
                    const rStrip = gen._createStrip(3, dir, s.scx, s.scy + ry);
                    rStrip.isInvisible = true;
                    rStrip.stepPhase = Math.floor(Math.random() * 6);
                }});
            }
        });

        this.registerBehavior('l3_quadrant_wipe', function(s) {
            if (!gen._getConfig('L3QuadrantWipeEnabled')) return;
            const l0md = (s.layerMaxDist || {})[0] || { N: 0, S: 0, E: 0, W: 0 };
            for (const b of gen.activeBlocks) {
                if (b.layer !== 3) continue;
                const rx = b.x - s.scx;
                const ry = b.y - s.scy;
                if (-ry > l0md.N + 2 || ry > l0md.S + 2 || rx > l0md.E + 2 || -rx > l0md.W + 2) {
                    gen._removeBlock(b.x, b.y, b.w, b.h, 3);
                }
            }
        });
    }

    registerBehavior(id, fn) {
        this.growthPool.set(id, { fn, enabled: true });
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
        const maxLayer = this._getConfig('LayerCount') ?? 0;
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
        if (maxLayer >= 2) ['E', 'W'].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(2, d, [0, 1, 2]));
        if (maxLayer >= 3) ['N', 'S'].sort(() => Math.random() - 0.5).forEach(d => addToSchedule(3, d, [0, 1, 2]));
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
        const boost = this._getConfig('SpineBoost') ?? 4;
        for (const { layer, dir, originX, originY } of scheduled) {
            this.actionBuffer.push({ layer, fn: () => {
                const strip = this._createStrip(layer, dir, originX, originY);
                strip.isSpine = true;
                strip.boostSteps = boost;
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
        let { bw, bh } = this._calcBlockSize(strip, s.fillRatio);
        if (strip.layer >= 2 && Math.random() < 0.5) {
            const burst = 1 + Math.floor(Math.random() * 2);
            if (dx !== 0) bw += burst; else if (dy !== 0) bh += burst;
        }
        const lmd = s.layerMaxDist[strip.layer] || { N: 0, S: 0, E: 0, W: 0 };
        const l0md = s.layerMaxDist[0] || { N: 0, S: 0, E: 0, W: 0 };
        const headRX = strip.headX - s.scx, headRY = strip.headY - s.scy;
        const limit = strip.layer === 2 ? 1 : 2;
        if (!strip.isSpine && strip.layer >= 2) {
            const exceeds = (strip.direction === 'N' && -headRY > l0md.N + limit) || (strip.direction === 'S' && headRY > l0md.S + limit) ||
                            (strip.direction === 'E' && headRX > l0md.E + limit) || (strip.direction === 'W' && -headRY > l0md.W + limit);
            if (exceeds) { strip.active = false; this.strips.delete(strip.id); return; }
        }
        if (strip.layer < 3 && this._isOccupied(strip.headX + dx, strip.headY + dy, 3)) this._removeBlock(strip.headX + dx, strip.headY + dy, bw, bh, 3);
        const newHeadX = strip.headX + dx * bw, newHeadY = strip.headY + dy * bh;
        if (this.checkScreenEdge(newHeadX, newHeadY)) { strip.active = false; this.strips.delete(strip.id); return; }
        const id = this._spawnBlock(dx > 0 ? strip.headX + 1 : newHeadX, dy > 0 ? strip.headY + 1 : newHeadY, bw, bh, strip.layer);
        if (id !== -1) { strip.headX = newHeadX; strip.headY = newHeadY; strip.growCount++; if (strip.layer === 2 && !!this._getConfig('L3AllowNudges')) this._nudgeLayer3(strip.direction, s); }
    }

    _dirDelta(dir) { return dir === 'N' ? [0,-1] : (dir === 'S' ? [0,1] : (dir === 'E' ? [1,0] : (dir === 'W' ? [-1,0] : [0,0]))); }

    _calcBlockSize(strip, fillRatio) {
        const fillThreshold = this._getConfig('FillThreshold') ?? 0.33;
        if (fillRatio < fillThreshold) return { bw: 1, bh: 1 };
        const maxScale = this._getConfig('MaxBlockScale') ?? 3;
        const bs = this._getBlockSize();
        const visW = Math.max(1, Math.floor(this.cols / bs.w)), visH = Math.max(1, Math.floor(this.rows / bs.h));
        const halfW = Math.floor(visW / 2), halfH = Math.floor(visH / 2);
        const ox = strip.originX, oy = strip.originY, dir = strip.direction;
        let distFactor, axisRatio;
        if (dir === 'N') { distFactor = halfH > 0 ? (oy + halfH) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'S') { distFactor = halfH > 0 ? (halfH - oy) / halfH : 1; axisRatio = visH / Math.max(1, visW); }
        else if (dir === 'E') { distFactor = halfW > 0 ? (halfW - ox) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        else { distFactor = halfW > 0 ? (ox + halfW) / halfW : 1; axisRatio = visW / Math.max(1, visH); }
        const size = Math.min(maxScale, Math.max(1, Math.round(Math.max(0, Math.min(2, distFactor)) * axisRatio)));
        return (dir === 'N' || dir === 'S') ? { bw: 1, bh: size } : { bw: size, bh: 1 };
    }

    _spawnBlock(x, y, w, h, layer) {
        const x1 = x, y1 = y, x2 = x + w - 1, y2 = y + h - 1;
        const gx1 = this.gridCX + x1, gy1 = this.gridCY + y1, gx2 = this.gridCX + x2, gy2 = this.gridCY + y2;
        if (gx1 < 0 || gx2 >= this.logicGridW || gy1 < 0 || gy2 >= this.logicGridH) return -1;
        const grid = this.layerGrids[layer];
        for (let gy = gy1; gy <= gy2; gy++) {
            for (let gx = gx1; gx <= gx2; gx++) {
                if (grid[gy * this.logicGridW + gx] !== -1) return -1;
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

    _nudgeLayer3(dir, s) {
        const dy = dir === 'N' ? -1 : (dir === 'S' ? 1 : 0);
        if (dy === 0) return;
        for (const b of this.activeBlocks) if (b.layer === 3) { const ry = b.y - s.scy; if ((dir === 'N' && ry < 0) || (dir === 'S' && ry > 0)) b.y += dy; }
        for (const st of this.strips.values()) if (st.layer === 3 && st.active) { const sry = st.headY - s.scy; if ((dir === 'N' && sry < 0) || (dir === 'S' && sry > 0)) { st.headY += dy; st.originY += dy; } }
        this.currentStepOps.push(['shiftBlocks', 3, dir, 0, dy, s.scx, s.scy]);
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
        const bs = this._getBlockSize(), halfW = Math.floor(this.cols / bs.w / 2), halfH = Math.floor(this.rows / bs.h / 2), maxLayer = this._getConfig('LayerCount') ?? 0;
        const l0md = s.layerMaxDist[0] || { N: 0, S: 0, E: 0, W: 0 };
        
        if (!s.pendingExpansions) s.pendingExpansions = [];
        const stillPending = [];
        for (const pe of s.pendingExpansions) {
            if (pe.l === 3) { const rx = pe.ox - s.scx, ry = pe.oy - s.scy; if ((pe.dir === 'N' && -ry > l0md.N + 2) || (pe.dir === 'S' && ry > l0md.S + 2) || (pe.dir === 'E' && rx > l0md.E + 2) || (pe.dir === 'W' && -rx > l0md.W + 2)) continue; }
            const allowed = this._getAllowedDirs(pe.l);
            if (!allowed || allowed.has(pe.dir)) this.actionBuffer.push({ layer: pe.l, fn: () => { this._createStrip(pe.l, pe.dir, pe.ox, pe.oy).isExpansion = true; } });
            else stillPending.push(pe);
        }
        s.pendingExpansions = stillPending;

        const wave = s.insideOutWave, edgeBuf = 2;
        if (wave > halfW + edgeBuf && wave > halfH + edgeBuf) return;
        const axisAdj = (wave <= 1);
        for (let l = 0; l <= maxLayer; l++) {
            const allowed = axisAdj ? null : this._getAllowedDirs(l);
            for (const dy of [wave, -wave]) {
                const oy = s.scy + dy;
                if (oy >= -(halfH + edgeBuf) && oy <= halfH + edgeBuf) {
                    if (l === 2) continue;
                    if (l === 3 && ((dy < 0 && -dy > l0md.N + 2) || (dy > 0 && dy > l0md.S + 2))) continue;
                    const eOk = !allowed || allowed.has('E'), wOk = !allowed || allowed.has('W');
                    if (eOk || wOk) this.actionBuffer.push({ layer: l, fn: () => { if (eOk) this._createStrip(l, 'E', s.scx, oy).isExpansion = true; if (wOk) this._createStrip(l, 'W', s.scx, oy).isExpansion = true; } });
                    if (!eOk) s.pendingExpansions.push({ l, dir: 'E', ox: s.scx, oy }); if (!wOk) s.pendingExpansions.push({ l, dir: 'W', ox: s.scx, oy });
                }
            }
            for (const dx of [wave, -wave]) {
                const ox = s.scx + dx;
                if (ox >= -(halfW + edgeBuf) && ox <= halfW + edgeBuf) {
                    if (l === 3) continue;
                    const nOk = !allowed || allowed.has('N'), sOk = !allowed || allowed.has('S');
                    if (nOk || sOk) this.actionBuffer.push({ layer: l, fn: () => { if (nOk) this._createStrip(l, 'N', ox, s.scy).isExpansion = true; if (sOk) this._createStrip(l, 'S', ox, s.scy).isExpansion = true; } });
                    if (!nOk) s.pendingExpansions.push({ l, dir: 'N', ox, oy: s.scy }); if (!sOk) s.pendingExpansions.push({ l, dir: 'S', ox, oy: s.scy });
                }
            }
        }
        s.insideOutWave++;
    }

    _checkIntersections() {
        if (!this._getConfig('IntersectionPause')) return;
        const vStrips = [], hStrips = [];
        for (const st of this.strips.values()) if (st.active) { if (st.direction === 'N' || st.direction === 'S') vStrips.push(st); else hStrips.push(st); }
        const check = (g) => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (g[i].growCount > 0 && g[i].growCount === g[j].growCount) { if (Math.random() < 0.5) g[i].paused = !g[i].paused; if (Math.random() < 0.5) g[j].paused = !g[j].paused; } };
        check(vStrips); check(hStrips);
    }

    _processIntents() {
        const scaling = !!this._getConfig('GenerativeScaling');
        for (const intent of this.actionBuffer) { if (!this.actionQueues.has(intent.layer)) this.actionQueues.set(intent.layer, []); this.actionQueues.get(intent.layer).push(intent); }
        this.actionBuffer = [];
        for (const [layer, queue] of this.actionQueues.entries()) {
            if (scaling) {
                const spines = [], others = [];
                while (queue.length > 0) { const it = queue.shift(); if (it.isSpine) spines.push(it); else others.push(it); }
                for (const it of spines) if (it.fn) it.fn();
                const budget = others.length > 0 ? Math.max(1, Math.round(others.length * 0.4)) : 0;
                for (let i = 0; i < Math.min(budget, others.length); i++) { const it = others.shift(); if (it && it.fn) it.fn(); }
                if (others.length > 0) this.actionQueues.set(layer, others); else this.actionQueues.delete(layer);
            } else { while (queue.length > 0) { const it = queue.shift(); if (it && it.fn) it.fn(); } }
        }
    }

    _isOccupied(x, y, layer) {
        const gx = this.gridCX + x, gy = this.gridCY + y;
        const grid = this.layerGrids[layer];
        return !!grid && gx >= 0 && gx < this.logicGridW && gy >= 0 && gy < this.logicGridH && grid[gy * this.logicGridW + gx] !== -1;
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
                this.actionBuffer = [];
                this._tickLayerDirs(s);
                this._updateFillRatio(s);
                this._seedStrips(s);
                this._tickStrips(s);
                this._checkIntersections();
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
        this.currentStepOps = [];
        const maxLayer = this._getConfig('LayerCount') ?? 0;
        const ox = s.scx, oy = s.scy;
        for (let l = 0; l <= maxLayer; l++) {
            this._spawnBlock(ox, oy, 1, 1, l);
        }
        sequence.push(this.currentStepOps);

        while (s.step < maxSteps) {
            // Check if we should abort because an effect started during background generation
            if (cache && cache.isAnyEffectActive()) {
                console.log("[QuantizedSequenceGeneratorV2] Aborting background generation: Effect detected.");
                return null; 
            }

            const done = this.generateStep();
            if (this.currentStepOps.length > 0) {
                sequence.push(this.currentStepOps);
            }
            
            if (done) break;
        }
        return sequence;
    }
}

if (typeof window !== 'undefined') window.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
else if (typeof self !== 'undefined') self.QuantizedSequenceGeneratorV2 = QuantizedSequenceGeneratorV2;
