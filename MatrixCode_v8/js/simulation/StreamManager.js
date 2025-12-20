class StreamManager {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.activeStreams = [];
        this.lastStreamInColumn = new Array(grid.cols).fill(null);
        this.lastEraserInColumn = new Array(grid.cols).fill(null);
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
                if (this.grid.decays[spawnIdx] > 0) {
                    isTopBlocked = true;
                }
            }

            const lastStream = this.lastStreamInColumn[col];

            if (eraserCount > 0 && this._canSpawnEraser(col, s.minEraserGap, s.minGapTypes)) {
                this._spawnStreamAt(col, true);
                eraserCount--;
                continue; 
            } 
            else if (!isTopBlocked && streamCount > 0 && this._canSpawnTracer(lastStream, s.minStreamGap, s.minGapTypes)) {
                this._spawnStreamAt(col, false);
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
                        
                        if (!blockedN && this._canSpawnTracer(lastStreamN, s.minStreamGap, s.minGapTypes)) {
                            this._spawnStreamAt(neighbor, false);
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
        const lastEraser = this.lastEraserInColumn[col];
        if (lastEraser && lastEraser.active && lastEraser.y <= minGap) return false;
        
        const lastStream = this.lastStreamInColumn[col];
        if (lastStream && lastStream.active && !lastStream.isEraser) {
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
                    stream.y++;
                    this._writeHead(stream, frame);
                }
            }
        }
    }

    _handleStreamCompletion(stream) {
        stream.active = false;
        if (!stream.isEraser) {
            this._spawnStreamAt(stream.x, true);
        }
    }

    _spawnStreamAt(x, forceEraser) {
        const s = this.config.state;
        const stream = this._initializeStream(x, forceEraser, s);

        this.modes[stream.mode].spawn(stream);
        this.activeStreams.push(stream);
        this.lastStreamInColumn[x] = stream;
        if (forceEraser) {
            this.lastEraserInColumn[x] = stream;
        }
    }

    _initializeStream(x, forceEraser, s) {
        const activeFonts = this.config.derived.activeFonts || [{name:'MatrixEmbedded', chars: Utils.CHARS}];
        const fontIdx = Math.floor(Math.random() * activeFonts.length);
        
        const baseTick = Math.max(1, 21 - s.streamSpeed);
        let tickInterval = baseTick;
        
        if (s.desyncIntensity > 0) {
            const variance = baseTick * s.desyncIntensity * 0.8;
            const offset = (Math.random() * variance * 2) - variance;
            tickInterval = Math.max(1, baseTick + offset);
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
        stream.len = this.grid.rows + 10; 
        stream.visibleLen = this.grid.rows * 4; 
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
}