// =========================================================================
// STREAM MANAGER
// =========================================================================

class StreamManager {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this._activeStreams = []; // Backing field
        this.lastStreamInColumn = new Array(grid.cols).fill(null);
        this.lastEraserInColumn = new Array(grid.cols).fill(null);
        this.columnSpeeds = new Float32Array(grid.cols);
        this.streamsPerColumn = new Int16Array(grid.cols); // Track active streams count
        this.modes = this._initializeModes(config);
        this.nextSpawnFrame = 0;
        this._isBootSpawn = true; // First spawn cycle flag for stagger logic

        // Reusable columns pool to avoid per-spawn allocation
        this._columnsPool = new Array(this.grid.cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;
    }

    get activeStreams() {
        return this._activeStreams;
    }

    set activeStreams(val) {
        const oldLen = this._activeStreams ? this._activeStreams.length : 0;
        const newLen = val ? val.length : 0;
        
        // Critical Log: Catch assignment-based wipe
        if (oldLen > 20 && newLen === 0 && this.config.state.logErrors) {
            console.error(`[StreamManager] ActiveStreams REPLACED! Count dropped from ${oldLen} to ${newLen}.`);
            console.trace();
        }
        this._activeStreams = val;
    }

    _initializeModes(config) {
        return {
            'STANDARD': new StandardMode(config),
            'STAR_POWER': new StarPowerMode(config),
            'RAINBOW': new RainbowMode(config)
        };
    }

    cloneState(other) {
        if (!other || other.grid.cols !== this.grid.cols) return;

        const streamMap = new Map();
        this.activeStreams = other.activeStreams.map(s => {
            const clone = { ...s };
            if (s.holes instanceof Set) {
                clone.holes = new Set(s.holes);
            }
            streamMap.set(s, clone);
            return clone;
        });

        this.lastStreamInColumn = other.lastStreamInColumn.map(s => streamMap.get(s) || null);
        this.lastEraserInColumn = other.lastEraserInColumn.map(s => streamMap.get(s) || null);

        if (this.columnSpeeds.length !== other.columnSpeeds.length) {
            this.columnSpeeds = new Float32Array(other.columnSpeeds.length);
        }
        if (this.streamsPerColumn.length !== other.streamsPerColumn.length) {
            this.streamsPerColumn = new Int16Array(other.streamsPerColumn.length);
        }

        if (this.columnSpeeds && other.columnSpeeds) this.columnSpeeds.set(other.columnSpeeds);
        if (this.streamsPerColumn && other.streamsPerColumn) this.streamsPerColumn.set(other.streamsPerColumn);

        this.nextSpawnFrame = other.nextSpawnFrame;
    }

    resize(cols) {
        if (this._activeStreams && this._activeStreams.length > 0 && this.config.state.logErrors) {
            console.warn(`[StreamManager] Resize triggered (cols: ${cols}). Clearing ${this._activeStreams.length} streams.`);
            console.trace();
        }

        this.lastStreamInColumn = new Array(cols).fill(null);
        this.lastEraserInColumn = new Array(cols).fill(null);
        this.columnSpeeds = new Float32Array(cols);
        this.streamsPerColumn = new Int16Array(cols);
        this.activeStreams = [];
        
        this._columnsPool = new Array(cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;
    }

    update(frame, timeScale) {
        if (this.lastStreamInColumn.length !== this.grid.cols) {
            if (this.config.state.logErrors) console.warn(`[StreamManager] Auto-resize triggered. Old: ${this.lastStreamInColumn.length}, New: ${this.grid.cols}`);
            this.resize(this.grid.cols);
        }

        if (timeScale > 0) {
            this._manageStreams(frame, timeScale);
        } else if (timeScale < 0) {
            this._processActiveStreams(frame, timeScale);
        }
    }

    _manageStreams(frame, timeScale) {
        const { state: s, derived: d } = this.config;

        if (frame >= this.nextSpawnFrame) {
            this._spawnStreams(s, d);
            
            const baseInterval = Math.max(1, Math.floor(d.cycleDuration * s.releaseInterval));
            let nextDelay = baseInterval;
            
            if (s.desyncIntensity > 0) {
                const variance = baseInterval * s.desyncIntensity * 2;
                const offset = Utils.randomInt(-variance/2, variance/2);
                nextDelay = Math.max(1, baseInterval + offset);
            }
            
            this.nextSpawnFrame = frame + nextDelay;
        }

        this._processActiveStreams(frame, timeScale);
    }

    _spawnStreams(s, d) {
        // On boot for small/mobile screens, stagger the initial tracer release
        // to prevent a wall of tracers appearing simultaneously
        const staggerBoot = this._isBootSpawn && this.grid.cols <= 60;
        if (this._isBootSpawn) this._isBootSpawn = false;

        const columns = this._columnsPool;
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = columns[i]; columns[i] = columns[j]; columns[j] = tmp;
        }

        let streamCount = s.streamSpawnCount;
        let eraserCount = s.eraserSpawnCount;
        let spawnedIdx = 0; // Track spawn order for stagger delay

        for (let k = 0; k < columns.length; k++) {
            const col = columns[k];
            if (streamCount <= 0 && eraserCount <= 0) break;

            const spawnIdx = this.grid.getIndex(col, 0);
            if (spawnIdx !== -1 && this.grid.cellLocks && this.grid.cellLocks[spawnIdx] === 1) {
                continue;
            }

            const lastStream = this.lastStreamInColumn[col];

            let colSpeed = this.columnSpeeds[col];
            if (this.streamsPerColumn[col] === 0) {
                colSpeed = this._generateSpeed(s);
                this.columnSpeeds[col] = colSpeed;
            }

            if (eraserCount > 0 && this._canSpawnEraser(col, s.minEraserGap, s.minGapTypes)) {
                this._spawnStreamAt(col, true, colSpeed);
                eraserCount--;
                continue;
            }

            if (streamCount > 0 && this._canSpawnTracer(lastStream, s.minStreamGap, s.minGapTypes)) {
                this._spawnStreamAt(col, false, colSpeed);
                // Stagger: assign increasing delays so tracers drip in one by one
                if (staggerBoot && spawnedIdx > 0) {
                    const stream = this.activeStreams[this.activeStreams.length - 1];
                    const baseInterval = Math.max(1, Math.floor((d.cycleDuration || 30) * (s.releaseInterval || 3)));
                    stream.delay = Math.floor(spawnedIdx * (baseInterval * 0.4 + Math.random() * baseInterval * 0.3));
                }
                spawnedIdx++;
                streamCount--;

                if (s.preferClusters && streamCount > 0 && Math.random() < 0.15) {
                    const neighbor = col + 1;
                    if (neighbor < this.grid.cols) {
                        const idxN = this.grid.getIndex(neighbor, 0);
                        let blockedN = false;
                        if (idxN !== -1 && this.grid.decays[idxN] > 0) blockedN = true;

                        const lastStreamN = this.lastStreamInColumn[neighbor];

                        let neighborSpeed = this.columnSpeeds[neighbor];
                        if (!lastStreamN || !lastStreamN.active) {
                            neighborSpeed = this._generateSpeed(s);
                            this.columnSpeeds[neighbor] = neighborSpeed;
                        }

                        if (!blockedN && this._canSpawnTracer(lastStreamN, s.minStreamGap, s.minGapTypes)) {
                            this._spawnStreamAt(neighbor, false, neighborSpeed);
                            if (staggerBoot) {
                                const ns = this.activeStreams[this.activeStreams.length - 1];
                                const bi = Math.max(1, Math.floor((d.cycleDuration || 30) * (s.releaseInterval || 3)));
                                ns.delay = Math.floor(spawnedIdx * (bi * 0.4 + Math.random() * bi * 0.3));
                            }
                            spawnedIdx++;
                            streamCount--;
                        }
                    }
                }
                continue;
            }
        }
    }

    _canSpawnTracer(lastStream, minGap, minGapTypes) {
        if (!lastStream || !lastStream.active) return true;
        if (lastStream.isEraser) {
            return lastStream.y > minGapTypes;
        }
        return lastStream.y > minGap;
    }
    
    _canSpawnEraser(col, minGap, minGapTypes) {
        const lastStream = this.lastStreamInColumn[col];
        if (!lastStream || lastStream.isEraser) return false;

        const lastEraser = this.lastEraserInColumn[col];
        if (lastEraser && lastEraser.active && lastEraser.y <= minGap) return false;

        if (lastStream.active && lastStream.y <= minGapTypes) return false;
        
        return true;
    }

    _processActiveStreams(frame, timeScale) {
        const grid = this.grid;
        const rows = grid.rows;
        const cellLocks = grid.cellLocks;
        const decays = grid.decays;

        if (Math.abs(timeScale) < 0.01) return;

        const isReverse = timeScale < 0;
        const speedMult = Math.abs(timeScale);

        for (let i = this.activeStreams.length - 1; i >= 0; i--) {
            const stream = this.activeStreams[i];
            if (!stream.active) {
                if (this.streamsPerColumn[stream.x] > 0) this.streamsPerColumn[stream.x]--;
                this.activeStreams.splice(i, 1);
                continue;
            }
            
            const headIdx = grid.getIndex(stream.x, Math.max(0, stream.y));
            const isEffectActive = headIdx !== -1 && grid.effectActive[headIdx] !== 0;
            if (headIdx !== -1 && (cellLocks && cellLocks[headIdx] === 1 || isEffectActive)) {
                continue;
            }

            if (stream.delay > 0) {
                stream.delay--;
                continue;
            }

            stream.tickTimer -= speedMult;
            
            if (stream.tickTimer > 0) {
                continue; 
            }
            
            stream.tickTimer = stream.tickInterval;

            if (isReverse) {
                stream.y--;
                const oldHeadY = stream.y + 1;
                if (oldHeadY < rows) {
                    const oldIdx = grid.getIndex(stream.x, oldHeadY);
                    if (oldIdx !== -1) {
                         grid.clearCell(oldIdx);
                    }
                }
                if (stream.y < -5) {
                    stream.active = false;
                    continue;
                }
                this._writeHead(stream, frame);
            } else {
                if (stream.isEraser) {
                    const stopChance = this.config.state.eraserStopChance;
                    if (stopChance > 0 && Math.random() < (stopChance / 100)) {
                        stream.active = false;
                        continue;
                    }
                } else {                    
                    const stopChance = this.config.state.tracerStopChance;
                    if (stopChance > 0 && Math.random() < (stopChance / 100)) {
                        stream.active = false;
                        continue;
                    }

                    const nextY = stream.y + 1;
                    if (nextY < rows) {
                        const nextIdx = grid.getIndex(stream.x, nextY);
                        if (nextIdx !== -1 && decays[nextIdx] > 0) {
                            stream.active = false;
                            continue; 
                        }
                    }
                } 

                stream.age++;

                if (stream.age >= stream.visibleLen) {
                    this._handleStreamCompletion(stream);
                    continue;
                }

                if (stream.y < stream.len) {
                    if (stream.isEraser && this.config.state.highlightErasers) {
                        const prevIdx = grid.getIndex(stream.x, stream.y);
                        if (prevIdx !== -1) grid.clearEffectOverride(prevIdx);
                    }
                    stream.y++;
                    this._writeHead(stream, frame);
                }
            }
        }
    }

    _handleStreamCompletion(stream) {
        stream.active = false;
        const autoErase = this.config.state.autoEraserEnabled !== false;

        const last = this.lastStreamInColumn[stream.x];
        const isBlocked = last && last !== stream && last.active && last.isEraser;

        if (!stream.isEraser && autoErase && !isBlocked) {
            this._spawnStreamAt(stream.x, true, stream.tickInterval);
        }
    }

    _spawnStreamAt(x, forceEraser, forcedSpeed) {
        const s = this.config.state;
        const stream = this._initializeStream(x, forceEraser, s, forcedSpeed);

        this.modes[stream.mode].spawn(stream);
        this.activeStreams.push(stream);
        this.streamsPerColumn[x]++;
        this.lastStreamInColumn[x] = stream;
        if (forceEraser) {
            this.lastEraserInColumn[x] = stream;
        }
    }

    _generateSpeed(s) {
        const baseTick = Math.max(1, 21 - s.streamSpeed);
        if (s.desyncIntensity > 0) {
            const variance = baseTick * s.desyncIntensity * 0.8;
            const offset = (Math.random() * variance * 2) - variance;
            return Math.max(1, baseTick + offset);
        }
        return baseTick;
    }

    recalculateSpeeds() {
        const s = this.config.state;
        for (let col = 0; col < this.grid.cols; col++) {
            const newSpeed = this._generateSpeed(s);
            this.columnSpeeds[col] = newSpeed;
        }
        
        for (const stream of this.activeStreams) {
            if (stream.x >= 0 && stream.x < this.columnSpeeds.length) {
                stream.tickInterval = this.columnSpeeds[stream.x];
            }
        }
    }

    _initializeStream(x, forceEraser, s, forcedSpeed) {
        const activeFonts = this.config.derived.activeFonts || [{name:'MatrixEmbedded', chars: Utils.CHARS}];
        const fontIdx = Math.floor(Math.random() * activeFonts.length);
        
        let tickInterval = forcedSpeed;
        
        if (this.columnSpeeds[x] > 0) {
            tickInterval = this.columnSpeeds[x];
        }

        if (!tickInterval) {
            tickInterval = this._generateSpeed(s);
            this.columnSpeeds[x] = tickInterval;
        }

        const baseStream = {
            x,
            y: -1,
            active: true,
            delay: 0,
            age: 0,
            len: 0,
            holes: new Set(),
            decayY: -1,
            decayStarted: false,
            visibleLen: 0,
            mode: 'STANDARD',
            baseHue: 0,
            isInverted: false,
            isEraser: forceEraser,
            pIdx: Math.floor(Math.random() * (this.config.derived.paletteColorsUint32?.length || 1)),
            fontIndex: fontIdx,
            brightnessSeed: Math.floor(Math.random() * 255),
            tickInterval: tickInterval,
            tickTimer: 0
        };

        if (forceEraser) {
            return this._initializeEraserStream(baseStream, s);
        } else {
            return this._initializeTracerStream(baseStream, s);
        }
    }

    _initializeEraserStream(stream, s) {
        stream.len = this.grid.rows + 5;
        stream.visibleLen = (stream.len + 2) * stream.tickInterval; 
        return stream;
    }

    _initializeTracerStream(stream, s) {
        stream.len = this.grid.rows; 
        stream.maxDecay = 0; 

        if (s.trailLengthVarianceEnabled) {
            const baseFade = s.decayFadeDurationFrames || 24;
            const varianceVal = s.trailLengthVariance || 0;
            const minAdd = baseFade;
            const maxAdd = Math.max(baseFade, varianceVal);
            const additional = Utils.randomInt(minAdd, maxAdd);
            stream.maxDecay = baseFade + additional;
        }

        const travelDuration = stream.len * stream.tickInterval;
        const scale = (s.streamVisibleLengthScale !== undefined) ? s.streamVisibleLengthScale : 1.0;
        stream.visibleLen = (travelDuration + (5 * stream.tickInterval)) * scale;

        stream.isInverted = s.invertedTracerEnabled && Math.random() < s.invertedTracerChance;
        stream.isGradual = s.gradualColorStreams && (Math.random() * 100 < s.gradualColorStreamsFrequency);

        for (let i = 0; i < stream.len; i++) {
            if (Math.random() < s.holeRate) stream.holes.add(i);
        }
        stream.holes.delete(0);

        if (s.starPowerEnabled && Math.random() < s.starPowerFreq / 100) {
            stream.mode = 'STAR_POWER';
        } else if (s.rainbowStreamEnabled && Math.random() < s.rainbowStreamChance) {
            stream.mode = 'RAINBOW';
        }
        return stream;
    }

    _writeHead(stream, frame) {
        const idx = this.grid.getIndex(stream.x, stream.y);
        if (idx === -1) return;

        if (stream.isEraser) {
            this._handleEraserHead(idx);
        } else {
            this._handleTracerHead(stream, idx, frame);
        }
    }

    _handleEraserHead(idx) {
        const decays = this.grid.decays;
        if (decays[idx] >= 2) return;

        if (decays[idx] > 0 && (this.grid.types[idx] & Utils.CELL_TYPE_MASK) !== Utils.CELL_TYPE.EMPTY) {
            this.grid.ages[idx] = 0;
            decays[idx] = 2;
        } else {
            this.grid.clearCell(idx);
        }

        if (this.config.state.highlightErasers) {
            this.grid.setHighPriorityEffect(idx, 'W', 0xFF0000FF, 1.0, 0, 0);
        }
    }

    _handleTracerHead(stream, idx, frame) {
        const shouldWrite = stream.isInverted
            ? stream.holes.has(stream.y)
            : !stream.holes.has(stream.y);

        if (shouldWrite) {
            const s = this.config.state;
            const d = this.config.derived;
            const grid = this.grid;

            let cellType = s.rotatorEnabled && Math.random() < (s.rotatorChance / 100)
                ? Utils.CELL_TYPE.ROTATOR
                : Utils.CELL_TYPE.TRACER;

            if (stream.isGradual) {
                cellType |= Utils.CELL_FLAGS.GRADUAL;
            }

            grid.types[idx] = cellType;
            grid.ages[idx] = 1;
            grid.decays[idx] = 1;
            if (grid.maxDecays) {
                grid.maxDecays[idx] = stream.maxDecay || 0; 
            }
            grid.mix[idx] = 0; 
            grid.renderMode[idx] = RENDER_MODE.STANDARD;
            
            grid.activeIndices.add(idx);

            const activeFonts = d.activeFonts;
            const fontData = activeFonts[stream.fontIndex] || activeFonts[0];
            const charSet = fontData.chars;
            const charStr = charSet[Math.floor(Math.random() * charSet.length)];
            
            let colorUint32;
            const style = this.modes[stream.mode].style(stream, frame, s);
            
            if (style) {
                grid.complexStyles.set(idx, style);
                if (style.h !== undefined) {
                    const rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    colorUint32 = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
                } else {
                     colorUint32 = d.tracerColorUint32;
                }
            } else {
                grid.complexStyles.delete(idx);
                const isPerChar = Math.random() < s.colorMixType;
                if (isPerChar || Math.random() < s.paletteBias) {
                    const pLen = d.paletteColorsUint32?.length || 1;
                    colorUint32 = d.paletteColorsUint32[Math.floor(Math.random() * pLen)];
                } else {
                    colorUint32 = d.paletteColorsUint32[stream.pIdx] || d.paletteColorsUint32[0];
                }
            }
            
            let b;
            if (s.lockBrightnessToCharacters) {
                b = Utils.calculateCharBrightness(charStr.charCodeAt(0), stream.brightnessSeed || 0, d.varianceMin);
                if (grid.streamSeeds) {
                    grid.streamSeeds[idx] = stream.brightnessSeed || 0;
                }
            } else {
                b = s.variableBrightnessEnabled
                    ? Utils.randomFloat(d.varianceMin, 1.0)
                    : 1.0;
            }
            grid.brightness[idx] = b;
            
            const tracerColor = d.tracerColorUint32;
            grid.setPrimary(idx, charStr, tracerColor, b, stream.fontIndex, s.tracerGlow);
            grid.baseColors[idx] = colorUint32;
            
            if (s.overlapEnabled && Math.random() < s.overlapDensity) {
                const overlapChar = charSet[Math.floor(Math.random() * charSet.length)];
                const ovRgb = Utils.hexToRgb(s.overlapColor);
                const ovColor = Utils.packAbgr(ovRgb.r, ovRgb.g, ovRgb.b);
                
                grid.setSecondary(idx, overlapChar, ovColor, b, stream.fontIndex, s.tracerGlow);
                grid.renderMode[idx] = RENDER_MODE.OVERLAP;
            }

        } else {
            this.grid.clearCell(idx);
        }
    }

    clearStreams() {
        this.activeStreams = [];
        if (this.streamsPerColumn) this.streamsPerColumn.fill(0);
        if (this.lastStreamInColumn) this.lastStreamInColumn.fill(null);
        if (this.lastEraserInColumn) this.lastEraserInColumn.fill(null);
        if (this.lastUpwardTracerInColumn) this.lastUpwardTracerInColumn.fill(null);
        this.nextSpawnFrame = 0; // Allow immediate spawning after clear
        this.recalculateSpeeds();
    }

    addActiveStream(stream) {
        if (!stream) return;
        this.activeStreams.push(stream);
        this.streamsPerColumn[stream.x]++;
        this.lastStreamInColumn[stream.x] = stream;
        if (stream.isEraser) {
            this.lastEraserInColumn[stream.x] = stream;
        }
    }
}
