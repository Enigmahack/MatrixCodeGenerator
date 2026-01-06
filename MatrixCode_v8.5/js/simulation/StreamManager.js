class StreamManager {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.activeStreams = [];
        this.lastStreamInColumn = new Array(grid.cols).fill(null);
        this.lastEraserInColumn = new Array(grid.cols).fill(null);
        this.lastUpwardTracerInColumn = new Array(grid.cols).fill(null);
        this.columnSpeeds = new Float32Array(grid.cols);
        this.streamsPerColumn = new Int16Array(grid.cols); // Track active streams count
        this.modes = this._initializeModes(config);
        this.nextSpawnFrame = 0;

        // Reusable columns pool to avoid per-spawn allocation
        this._columnsPool = new Array(this.grid.cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;
    }

    _initializeModes(config) {
        return {
            'STANDARD': new StandardMode(config),
            'STAR_POWER': new StarPowerMode(config),
            'RAINBOW': new RainbowMode(config)
        };
    }

    resize(cols) {
        this.lastStreamInColumn = new Array(cols).fill(null);
        this.lastEraserInColumn = new Array(cols).fill(null);
        this.lastUpwardTracerInColumn = new Array(cols).fill(null);
        this.columnSpeeds = new Float32Array(cols);
        this.streamsPerColumn = new Int16Array(cols);
        this.activeStreams = [];
        
        // Rebuild columns pool
        this._columnsPool = new Array(cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;
    }

    update(frame, timeScale) {
        // Keep columns arrays in sync with grid size if changed (safety check)
        if (this.lastStreamInColumn.length !== this.grid.cols) {
            this.resize(this.grid.cols);
        }

        if (timeScale > 0) {
            this._manageStreams(frame, timeScale);
        } else if (timeScale < 0) {
            this._processActiveStreams(frame, timeScale);
        }
        // If timeScale == 0, pause
    }

    _manageStreams(frame, timeScale) {
        const { state: s, derived: d } = this.config;
        
        // Independent Glimmer Management (Runs every frame)
        this._manageGlimmer(s);

        // Spawn Logic
        if (frame >= this.nextSpawnFrame) {
            this._spawnStreams(s, d);
            
            // Calculate next spawn time
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

    _manageGlimmer(s) {
        if (!s.upwardTracerEnabled || s.upwardTracerChance <= 0) return;

        // 1. Calculate Active Density per Column
        const colCounts = new Uint8Array(this.grid.cols);
        for (let i = 0; i < this.activeStreams.length; i++) {
            const stream = this.activeStreams[i];
            if (stream.isUpward && stream.active) {
                colCounts[stream.x]++;
            }
        }

        // 2. Determine Density Limit (1, 2, or 3)
        const limit = Math.ceil(s.upwardTracerChance * 3.0);
        
        // 3. Spawn Logic
        // Since this runs every frame, we use a low probability to fill gaps organically.
        const spawnChance = 0.05; 
        const columns = this._columnsPool;
        
        // Shuffle for random distribution
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = columns[i]; columns[i] = columns[j]; columns[j] = tmp;
        }

        for (let k = 0; k < columns.length; k++) {
            const col = columns[k];
            if (colCounts[col] < limit) {
                if (Math.random() < spawnChance) {
                    this._spawnUpwardTracerAt(col);
                    return; // Prevent clustering: Max 1 spawn per frame
                }
            }
        }
    }

    _spawnStreams(s, d) {
        const columns = this._columnsPool;
        // Fisher-Yates Shuffle
        for (let i = columns.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = columns[i]; columns[i] = columns[j]; columns[j] = tmp;
        }

        let streamCount = s.streamSpawnCount;
        let eraserCount = s.eraserSpawnCount;

        for (let k = 0; k < columns.length; k++) {
            const col = columns[k];
            if (streamCount <= 0 && eraserCount <= 0) break;

            const spawnIdx = this.grid.getIndex(col, 0);
            let isTopBlocked = false;
            
            if (spawnIdx !== -1) {
                if (this.grid.cellLocks && this.grid.cellLocks[spawnIdx] === 1) continue;
            }

            const lastStream = this.lastStreamInColumn[col];

            // Resolve Speed for this column (Chain Consistency)
            let colSpeed = this.columnSpeeds[col];
            // Only generate a new speed if the column is completely empty of active streams
            if (this.streamsPerColumn[col] === 0) {
                // New chain, new random speed
                colSpeed = this._generateSpeed(s);
                this.columnSpeeds[col] = colSpeed;
            }

            if (eraserCount > 0 && this._canSpawnEraser(col, s.minEraserGap, s.minGapTypes)) {
                this._spawnStreamAt(col, true, colSpeed);
                eraserCount--;
                continue; 
            } 
            
            if (!isTopBlocked && streamCount > 0 && this._canSpawnTracer(lastStream, s.minStreamGap, s.minGapTypes)) {
                this._spawnStreamAt(col, false, colSpeed);
                streamCount--;
                
                // Cluster Logic: 10-20% chance to spawn a neighbor
                if (s.preferClusters && streamCount > 0 && Math.random() < 0.15) {
                    // Try Right Neighbor (wrapping handled by modulo if needed, but here we just clamp)
                    const neighbor = col + 1;
                    if (neighbor < this.grid.cols) {
                        const idxN = this.grid.getIndex(neighbor, 0);
                        let blockedN = false;
                        if (idxN !== -1 && this.grid.decays[idxN] > 0) blockedN = true;
                        
                        const lastStreamN = this.lastStreamInColumn[neighbor];
                        
                        // Resolve Neighbor Speed
                        let neighborSpeed = this.columnSpeeds[neighbor];
                        if (!lastStreamN || !lastStreamN.active) {
                            neighborSpeed = this._generateSpeed(s);
                            this.columnSpeeds[neighbor] = neighborSpeed;
                        }
                        
                        if (!blockedN && this._canSpawnTracer(lastStreamN, s.minStreamGap, s.minGapTypes)) {
                            this._spawnStreamAt(neighbor, false, neighborSpeed);
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

        // Prevent spawning an eraser if the column is empty or the last spawn was already an eraser.
        if (!lastStream || lastStream.isEraser) return false;

        const lastEraser = this.lastEraserInColumn[col];
        if (lastEraser && lastEraser.active && lastEraser.y <= minGap) return false;

        if (lastStream.active) {
            if (this.config.state.allowTinyStreams) {
                const s = this.config.state;
                const tinyGap = s.tracerAttackFrames + s.tracerHoldFrames + s.tracerReleaseFrames + 3;
                if (lastStream.y <= tinyGap) return false;
            } else {
                if (lastStream.y <= minGapTypes) return false;
            }
        }
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
            if (headIdx !== -1 && cellLocks && cellLocks[headIdx] === 1) {
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

            // Handle Upward Tracers (Scanners)
            if (stream.isUpward) {
                if (isReverse) {
                    stream.y++; // Move down in reverse
                    if (stream.y > rows + 5) {
                        stream.active = false;
                        continue;
                    }
                } else {
                    stream.y--; // Move up in forward
                    if (stream.y < -5) {
                        stream.active = false;
                        continue;
                    }
                }
                this._writeHead(stream, frame);
                continue; 
            }

            if (isReverse) {
                stream.y--;
                
                // REWIND LOGIC: Clear the "future" (the cell we just left, which was stream.y + 1)
                // This creates the effect of the stream being sucked back up.
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
                // Drop-off logic
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

                    // In 3D mode, ignore collision with existing trails to allow high density
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
                    // Debug: Clean up previous eraser position to prevent trails
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

        // Prevent auto-eraser if an eraser is already running in this column
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
        
        // Update active streams to match new column speeds immediately
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
        
        // Enforce Column Speed Consistency
        // If the column has an assigned speed, strictly use it to ensure Tracers and Erasers remain synchronized
        if (this.columnSpeeds[x] > 0) {
            tickInterval = this.columnSpeeds[x];
        }

        if (!tickInterval) {
            tickInterval = this._generateSpeed(s);
            // Ensure this new speed is recorded for the column
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
        stream.visibleLen = this.grid.rows + 20; 
        return stream;
    }

    _initializeTracerStream(stream, s) {
        stream.len = this.grid.rows; 
        
        // Variable Fade Duration Logic
        // Calculate a specific fade-out duration for this stream's cells
        stream.maxDecay = 0; 

        if (s.trailLengthVarianceEnabled) {
            // "increase the length by a value between the Fade Out Speed and the Length Variance amount"
            const baseFade = s.decayFadeDurationFrames || 24;
            const varianceVal = s.trailLengthVariance || 0;
            
            // The additional length is random between [FadeSpeed, Variance]
            // Ensure bounds are valid (min <= max)
            const minAdd = baseFade;
            const maxAdd = Math.max(baseFade, varianceVal);
            
            const additional = Utils.randomInt(minAdd, maxAdd);
            
            stream.maxDecay = baseFade + additional;
        }

        const travelDuration = stream.len // * stream.tickInterval;
        stream.visibleLen = travelDuration + (this.grid.rows * 4);

        stream.isInverted = s.invertedTracerEnabled && Math.random() < s.invertedTracerChance;

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

        if (stream.isUpward) {
            this._handleUpwardHead(idx, this.config.state);
            return;
        }

        if (stream.isEraser) {
            this._handleEraserHead(idx);
        } else {
            this._handleTracerHead(stream, idx, frame);
        }
    }

    _handleEraserHead(idx) {
        const decays = this.grid.decays;
        if (decays[idx] >= 2) return;

        if (decays[idx] > 0 && this.grid.types[idx] !== CELL_TYPE.EMPTY) {
            this.grid.ages[idx] = 0;
            decays[idx] = 2;
        } else {
            this.grid.clearCell(idx);
        }

        if (this.config.state.highlightErasers) {
            // Debug: Show Eraser as Red 'E' using High Priority Effect layer (0xFF0000FF = Red)
            // This overlays the 'E' without destroying the underlying simulation state (decay/clear)
            this.grid.setHighPriorityEffect(idx, 'E', 0xFF0000FF, 1.0, 0, 0);
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

            const cellType = s.rotatorEnabled && Math.random() < s.rotatorChance
                ? CELL_TYPE.ROTATOR
                : CELL_TYPE.TRACER;

            grid.types[idx] = cellType;
            grid.ages[idx] = 1;
            grid.decays[idx] = 1;
            // Store per-stream max decay (fade duration)
            if (grid.maxDecays) {
                grid.maxDecays[idx] = stream.maxDecay || 0; 
            }
            grid.mix[idx] = 0; // Reset Rotator/Mix Progress
            grid.renderMode[idx] = RENDER_MODE.STANDARD;
            
            grid.activeIndices.add(idx);

            // Get char from active font set
            const activeFonts = d.activeFonts;
            const fontData = activeFonts[stream.fontIndex] || activeFonts[0];
            const charSet = fontData.chars;
            const charStr = charSet[Math.floor(Math.random() * charSet.length)];
            
            // Resolve Color
            let colorUint32;
            const style = this.modes[stream.mode].style(stream, frame, s);
            
            if (style) {
                // Complex Style (Effect)
                grid.complexStyles.set(idx, style);
                // Convert style to color immediately
                if (style.h !== undefined) {
                    const rgb = Utils.hslToRgb(style.h, style.s, style.l);
                    colorUint32 = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
                } else {
                     // Fallback
                     colorUint32 = d.tracerColorUint32;
                }
            } else {
                grid.complexStyles.delete(idx);
                // Standard Color
                // colorMixType: 0 = Stream, 1 = Character
                const isPerChar = Math.random() < s.colorMixType;
                
                if (isPerChar || Math.random() < s.paletteBias) {
                    const pLen = d.paletteColorsUint32?.length || 1;
                    colorUint32 = d.paletteColorsUint32[Math.floor(Math.random() * pLen)];
                } else {
                    colorUint32 = d.paletteColorsUint32[stream.pIdx] || d.paletteColorsUint32[0];
                }
            }
            
            // Brightness / Alpha
            const b = s.variableBrightnessEnabled
                ? Utils.randomFloat(d.varianceMin, 1.0)
                : 1.0;
            grid.brightness[idx] = b;
            
            // Set Primary (Visual = Tracer Color initially)
            const tracerColor = d.tracerColorUint32;
            grid.setPrimary(idx, charStr, tracerColor, b, stream.fontIndex, s.tracerGlow);
            grid.baseColors[idx] = colorUint32; // Store Stream Color for fade target
            
            // Handle Overlap (Secondary)
            if (s.overlapEnabled && Math.random() < s.overlapDensity) {
                const overlapChar = charSet[Math.floor(Math.random() * charSet.length)];
                // For overlaps, we usually use the same color? Or Overlap Color?
                // Previously, renderer used `overlapColor` from config for overlaps.
                // But now CellGrid stores the color.
                // We should resolve Overlap Color here.
                const ovRgb = Utils.hexToRgb(s.overlapColor);
                const ovColor = Utils.packAbgr(ovRgb.r, ovRgb.g, ovRgb.b);
                
                grid.setSecondary(idx, overlapChar, ovColor, b, stream.fontIndex, s.tracerGlow);
                grid.renderMode[idx] = RENDER_MODE.OVERLAP;
            }

        } else {
            this.grid.clearCell(idx);
        }
    }

    _spawnUpwardTracerAt(x) {
        const s = this.config.state;
        const stream = this._initializeUpwardTracerStream(x, s);
        this.activeStreams.push(stream);
        this.streamsPerColumn[x]++;
        this.lastUpwardTracerInColumn[x] = stream;
    }

    _initializeUpwardTracerStream(x, s) {
        const baseTick = Math.max(1, 21 - s.streamSpeed);
        // Apply speed multiplier (faster scanners look better)
        const speedMult = s.upwardTracerSpeedMult || 1.5; 
        const tickInterval = Math.max(1, baseTick / speedMult);

        return {
            x,
            // Random start position: throughout screen or delayed from bottom
            y: Utils.randomInt(0, this.grid.rows + 15), 
            active: true,
            delay: 0, // Remove delay for immediate feedback
            age: 0,
            len: 1, // Conceptually length 1 head
            isUpward: true,
            visibleLen: 1000, // Long life
            mode: 'STANDARD',
            tickInterval: tickInterval,
            tickTimer: 0
        };
    }

    addActiveStream(stream) {
        if (!stream) return;
        this.activeStreams.push(stream);
        this.streamsPerColumn[stream.x]++;
        this.lastStreamInColumn[stream.x] = stream;
        if (stream.isEraser) {
            this.lastEraserInColumn[stream.x] = stream;
        } else if (stream.isUpward) {
            this.lastUpwardTracerInColumn[stream.x] = stream;
        }
    }

    _handleUpwardHead(idx, s) {
        // Only interact if the cell is ACTIVE (has a character) AND visible
        // Prevents "resurrecting" fully faded characters which looks like spawning new ones
        if (this.grid.state[idx] === CELL_STATE.ACTIVE && this.grid.alphas[idx] > 0.1) {
            
            // 25% chance to leave a "blank" (gap) in the glimmer trail
            if (Math.random() < 0.25) return;

            // Mark as Glimmering immediately and store lifecycle state in complexStyles
            this.grid.mix[idx] = 30.0; 
            this.grid.complexStyles.set(idx, { type: 'glimmer', age: 1 });
        }
    }
}