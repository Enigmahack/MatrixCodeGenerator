class SimulationSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.activeStreams = [];
        this.lastStreamInColumn = new Array(grid.cols).fill(null);
        this.lastEraserInColumn = new Array(grid.cols).fill(null);
        this.modes = this._initializeModes(config);
        this.overlapInitialized = false;
        this._lastOverlapDensity = null;
        this._activeFontList = []; 
        this.nextSpawnFrame = 0; // Track next spawn time
    }

    _initializeModes(config) {
        return {
            'STANDARD': new StandardMode(config),
            'STAR_POWER': new StarPowerMode(config),
            'RAINBOW': new RainbowMode(config)
        };
    }

    update(frame) {
        if (this.lastStreamInColumn.length !== this.grid.cols) {
            this._resetColumns();
        }
        this._manageStreams(frame);
        this._manageOverlapGrid(frame);
        this._updateCells(frame);
        
        // Clear locks for the next frame (locks are set during rendering)
        if (this.grid.cellLocks) {
            this.grid.cellLocks.fill(0);
        }
    }

    _refreshActiveFonts() {
        // Deprecated
    }

    _manageOverlapGrid(frame) {
        if (!this.config.state.overlapEnabled) {
            // Reset initialization state when disabled
            if (this.overlapInitialized) {
                this.overlapInitialized = false;
                // Clear all overlap chars when disabled
                for(let i=0; i<this.grid.overlapChars.length; i++) {
                    this.grid.overlapChars[i] = 0;
                }
            }
            return;
        }
        
        const activeFonts = this.config.derived.activeFonts;
        const numFonts = activeFonts.length;
        const currentDensity = this.config.state.overlapDensity;

        // Helper to get random char for a cell
        const setOverlapChar = (i) => {
            let fIdx;
            if (this.grid.types[i] === CELL_TYPE.EMPTY) {
                // If empty, we can choose any active font
                fIdx = Math.floor(Math.random() * numFonts);
                this.grid.setFont(i, fIdx);
            } else {
                // If occupied, MUST use the existing font to match the stream/renderer
                fIdx = this.grid.getFont(i);
            }
            
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            if (chars && chars.length > 0) {
                this.grid.overlapChars[i] = chars[Math.floor(Math.random() * chars.length)].charCodeAt(0);
            } else {
                this.grid.overlapChars[i] = 32; // Space if empty
            }
        };

        // Check if we need to reinitialize (density changed or first time)
        if (!this.overlapInitialized || this._lastOverlapDensity !== currentDensity) {
            for(let i=0; i<this.grid.overlapChars.length; i++) {
                if (Math.random() < currentDensity) {
                    setOverlapChar(i);
                } else {
                    this.grid.overlapChars[i] = 0; // Empty
                }
            }
            this.overlapInitialized = true;
            this._lastOverlapDensity = currentDensity;
            this.grid.noiseDirty = true;
        }

        // Slowly churn the noise if shimmer is enabled
        if (this.config.state.overlapShimmer) {
             const updates = Math.ceil(this.grid.overlapChars.length * 0.005); 
             for(let k=0; k<updates; k++) {
                const idx = Math.floor(Math.random() * this.grid.overlapChars.length);
                
                // Check lock (Pulse Effect Pause)
                if (this.grid.cellLocks && this.grid.cellLocks[idx] === 1) continue;

                if (Math.random() < currentDensity) {
                    setOverlapChar(idx);
                } else {
                    this.grid.overlapChars[idx] = 0;
                }
            }
            this.grid.noiseDirty = true;
        }
    }

    _resetColumns() {
        this.lastStreamInColumn = new Array(this.grid.cols).fill(null);
        this.lastEraserInColumn = new Array(this.grid.cols).fill(null);
        this.activeStreams = [];
        // Reset overlap initialization when grid resizes
        this.overlapInitialized = false;
    }

    _manageStreams(frame) {
        const { state: s, derived: d } = this.config;
        
        // Spawn Logic
        if (frame >= this.nextSpawnFrame) {
            this._spawnStreams(s, d);
            
            // Calculate next spawn time
            const baseInterval = Math.max(1, Math.floor(d.cycleDuration * s.releaseInterval));
            let nextDelay = baseInterval;
            
            // Apply Desync to spawn interval
            if (s.desyncIntensity > 0) {
                const variance = baseInterval * s.desyncIntensity * 2; // Up to 200% variance
                const offset = Utils.randomInt(-variance/2, variance/2);
                nextDelay = Math.max(1, baseInterval + offset);
            }
            
            this.nextSpawnFrame = frame + nextDelay;
        }

        // Processing Logic - Run every frame, individual streams handle their own timing
        this._processActiveStreams(frame);
    }

    _spawnStreams(s, d) {
        const columns = this._shuffleArray([...Array(this.grid.cols).keys()]);
        let streamCount = s.streamSpawnCount;
        let eraserCount = s.eraserSpawnCount;

        for (const col of columns) {
            if (streamCount <= 0 && eraserCount <= 0) break;

            const spawnIdx = this.grid.getIndex(col, 0);
            let isTopBlocked = false;
            
            if (spawnIdx !== -1) {
                // Global lock check (Effect freeze) - applies to everything
                if (this.grid.cellLocks && this.grid.cellLocks[spawnIdx] === 1) continue;
                
                // Check if top is occupied by active content
                if (this.grid.decays[spawnIdx] > 0) {
                    isTopBlocked = true;
                }
            }

            const lastStream = this.lastStreamInColumn[col];

            // Erasers can spawn even if top is blocked (they clear content).
            // Gap check prevents them from spawning on top of themselves.
            if (eraserCount > 0 && this._canSpawnEraser(col, s.minEraserGap)) {
                this._spawnStreamAt(col, true);
                eraserCount--;
                continue; // Spawned eraser, move to next column
            } 
            
            // Tracers CANNOT spawn if top is blocked (collision).
            else if (!isTopBlocked && streamCount > 0 && this._canSpawnTracer(lastStream, s.minStreamGap)) {
                this._spawnStreamAt(col, false);
                streamCount--;
                continue; // Spawned tracer, move to next column
            }
        }
    }

    _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    _columnHasContent(col, maxRows) {
        for (let y = 0; y < maxRows; y++) {
            if (this.grid.decays[this.grid.getIndex(col, y)] > 0) return true;
        }
        return false;
    }

    _canSpawn(lastStream, minGap) {
        // Deprecated, use _canSpawnTracer
        return !lastStream || !lastStream.active || lastStream.y > minGap;
    }

    _canSpawnTracer(lastStream, minGap) {
        // If no last stream, or it's finished, we can spawn
        if (!lastStream || !lastStream.active) return true;
        
        // If last stream was an Eraser, we can spawn a tracer immediately behind it (it clears the path)
        if (lastStream.isEraser) return true;

        // Otherwise (last was Tracer), respect the gap
        return lastStream.y > minGap;
    }
    
    _canSpawnEraser(col, minGap) {
        const lastEraser = this.lastEraserInColumn[col];
        return !lastEraser || !lastEraser.active || lastEraser.y > minGap;
    }

    _processActiveStreams(frame) {
        for (let i = this.activeStreams.length - 1; i >= 0; i--) {
            const stream = this.activeStreams[i];
            if (!stream.active) {
                this.activeStreams.splice(i, 1);
                continue;
            }

            // Check if stream is currently frozen by an effect
            const headIdx = this.grid.getIndex(stream.x, Math.max(0, stream.y));
            if (headIdx !== -1 && this.grid.cellLocks && this.grid.cellLocks[headIdx] === 1) {
                continue;
            }

            if (stream.delay > 0) {
                stream.delay--;
                continue;
            }

            // Decrement tick timer for movement
            stream.tickTimer--;
            if (stream.tickTimer > 0) {
                continue; // Not time to move yet
            }
            
            // Reset timer
            stream.tickTimer = stream.tickInterval;

            // Eraser Random Drop-off
            if (stream.isEraser) {
                if (this.config.state.eraserStopChance > 0 && Math.random() < (this.config.state.eraserStopChance / 100)) {
                    stream.active = false;
                    continue;
                }
            // Tracer Random Drop-off
            } else if (!stream.isEraser) {
                if (this.config.state.tracerStopChance > 0 && Math.random() < (this.config.state.tracerStopChance / 100)) {
                    stream.active = false;
                    continue;
                }
            } else {
                // Tracer Collision Detection
                // Check the cell we are about to move into (y+1)
                // Actually, we check if the *next* move would hit something.
                // If stream.y is currently at Y, next write is Y+1.
                const nextY = stream.y + 1;
                if (nextY < this.grid.rows) {
                    const nextIdx = this.grid.getIndex(stream.x, nextY);
                    // If next cell is occupied (decay > 0)
                    if (nextIdx !== -1 && this.grid.decays[nextIdx] > 0) {
                        // Collision! Stop stream.
                        // We don't write to nextY, effectively stopping "on top" of the existing block.
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
        // Pick a font for this stream
        const activeFonts = this.config.derived.activeFonts || [{name:'MatrixEmbedded', chars: Utils.CHARS}];
        const fontIdx = Math.floor(Math.random() * activeFonts.length);
        
        // Calculate individual speed
        // Base speed tick interval: 21 - s.streamSpeed
        // Higher streamSpeed = lower interval = faster
        const baseTick = Math.max(1, 21 - s.streamSpeed);
        let tickInterval = baseTick;
        
        if (s.desyncIntensity > 0) {
            // Variance: +/- 50% of baseTick * intensity
            // e.g. if tick=5, int=1.0, var= +/- 2.5. Range 2.5 to 7.5.
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
            pIdx: Math.floor(Math.random() * (this.config.derived.paletteColorsStr?.length || 1)),
            fontIndex: fontIdx,
            tickInterval: tickInterval, // How many frames per move
            tickTimer: 0 // Counter
        };

        if (forceEraser) {
            return this._initializeEraserStream(baseStream, s);
        } else {
            return this._initializeTracerStream(baseStream, s);
        }
    }

    _initializeEraserStream(stream, s) {
        stream.len = this.grid.rows + 5;
        stream.visibleLen = this.grid.rows + 20; // Default to run full screen length
        return stream;
    }

    _initializeTracerStream(stream, s) {
        stream.len = Utils.randomInt(4, this.grid.rows * 3);
        stream.visibleLen = this.grid.rows * 4; // Default to run full screen length
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
        if (this.grid.decays[idx] > 0 && this.grid.types[idx] !== CELL_TYPE.EMPTY) {
            this.grid.ages[idx] = 0;
            this.grid.decays[idx] = 2;
        } else {
            this._clearCell(idx);
        }
    }

    _handleTracerHead(stream, idx, frame) {
        const shouldWrite = stream.isInverted
            ? stream.holes.has(stream.y)
            : !stream.holes.has(stream.y);

        if (shouldWrite) {
            const { state: s, derived: d } = this.config;
            const cellType = s.rotatorEnabled && Math.random() < s.rotatorChance
                ? CELL_TYPE.ROTATOR
                : CELL_TYPE.TRACER;

            this.grid.types[idx] = cellType;
            this.grid.ages[idx] = 1;
            this.grid.decays[idx] = 1;
            this.grid.rotatorProg[idx] = 0;
            
            // Set font
            this.grid.setFont(idx, stream.fontIndex);
            
            if (Math.random() < s.paletteBias) {
                this.grid.paletteIndices[idx] = Math.floor(Math.random() * (d.paletteColorsStr?.length || 1));
            } else {
                this.grid.paletteIndices[idx] = stream.pIdx;
            }
            
            this.grid.activeIndices.add(idx);

            // Get char from active font set
            const activeFonts = this.config.derived.activeFonts;
            const fontData = activeFonts[stream.fontIndex] || activeFonts[0];
            const charSet = fontData.chars;
            const char = charSet[Math.floor(Math.random() * charSet.length)];
            this.grid.setChar(idx, char);

            if (s.overlapEnabled && Math.random() < s.overlapDensity) {
                // Use same charset for overlap to match font
                this.grid.overlapChars[idx] = charSet[Math.floor(Math.random() * charSet.length)].charCodeAt(0);
            }
            
            this.grid.brightness[idx] = s.variableBrightnessEnabled
                ? Utils.randomFloat(d.varianceMin, 1.0)
                : 1.0;

            this.grid.alphas[idx] = this.grid.brightness[idx];
            const style = this.modes[stream.mode].style(stream, frame, s);
            if (style) {
                this.grid.complexStyles.set(idx, style);
            } else {
                this.grid.complexStyles.delete(idx);
            }
        } else {
            this._clearCell(idx);
        }
    }

    _clearCell(idx) {
        this.grid.types[idx] = CELL_TYPE.EMPTY;
        this.grid.ages[idx] = 0;
        this.grid.decays[idx] = 0;
        this.grid.alphas[idx] = 0;
        this.grid.overlapChars[idx] = 0;

        this.grid.complexStyles.delete(idx);
        this.grid.nextChars.delete(idx);
        this.grid.activeIndices.delete(idx); // Improves performance
    }

    _updateCells(frame) {
        const { state: s, derived: d } = this.config;

        for (const idx of this.grid.activeIndices) {
            this._updateCell(idx, frame, s, d);
        }
    }

    _updateCell(idx, frame, s, d) {
        // Check if cell is locked by an effect (e.g. Pulse)
        if (this.grid.cellLocks && this.grid.cellLocks[idx] === 1) return;

        const decay = this.grid.decays[idx];
        if (decay === 0) return;

        let age = this.grid.ages[idx];
        if (age > 0) {
            age = this._incrementAge(age, d.maxState);
            this.grid.ages[idx] = age;
        }

        if (s.rotatorEnabled && this.grid.types[idx] === CELL_TYPE.ROTATOR) {
            this._handleRotator(idx, frame, s, d);
        }

        if (decay >= 2) {
            this.grid.decays[idx]++;
            const newDecay = this.grid.decays[idx];
            if (this._shouldDecay(idx, newDecay, s.decayFadeDurationFrames)) {
                this._clearCell(idx);
                return;
            }
            this.grid.alphas[idx] = this._calculateAlpha(idx, age, newDecay, s.decayFadeDurationFrames);
        } else {
            this.grid.alphas[idx] = this._calculateAlpha(idx, age, decay, s.decayFadeDurationFrames);
        }
    }

    _incrementAge(age, maxState) {
        return age < maxState ? age + 1 : 0;
    }

    _handleRotator(idx, frame, s, d) {
        const prog = this.grid.rotatorProg[idx];

        if (prog > 0) {
            this._progressRotator(idx, prog, s.rotatorCrossfadeFrames);
        } else if (this.grid.decays[idx] === 1) {
            this._cycleRotator(idx, frame, s.rotatorCrossfadeFrames, d.rotatorCycleFrames);
        }
    }

    _progressRotator(idx, prog, crossfadeFrames) {
        if (prog >= crossfadeFrames) {
            const nextChar = this.grid.nextChars.get(idx);
            if (nextChar) {
                this.grid.setChar(idx, nextChar);
                if (this.config.state.overlapEnabled) {
                    const nextOverlap = this.grid.nextOverlapChars.get(idx);
                    if (nextOverlap) {
                        this.grid.overlapChars[idx] = nextOverlap;
                        this.grid.noiseDirty = true;
                    }
                }
            }
            this.grid.rotatorProg[idx] = 0;
        } else {
            this.grid.rotatorProg[idx] = prog + 1;
        }
    }

    _cycleRotator(idx, frame, crossfadeFrames, cycleFrames) {
        if (frame % cycleFrames === 0) {
            // Get correct font charset
            const fontIdx = this.grid.getFont(idx);
            const activeFonts = this.config.derived.activeFonts;
            const fontData = activeFonts[fontIdx] || activeFonts[0];
            const charSet = fontData.chars;
            
            if (crossfadeFrames <= 2) {
                this.grid.setChar(idx, this._getUniqueChar(this.grid.getChar(idx), charSet));
                if (this.config.state.overlapEnabled) {
                    const currentOverlap = String.fromCharCode(this.grid.overlapChars[idx]);
                    this.grid.overlapChars[idx] = this._getUniqueChar(currentOverlap, charSet).charCodeAt(0);
                }
            } else {
                this.grid.rotatorProg[idx] = 1;
                this.grid.nextChars.set(idx, this._getUniqueChar(this.grid.getChar(idx), charSet));
                if (this.config.state.overlapEnabled) {
                    const currentOverlap = String.fromCharCode(this.grid.overlapChars[idx]);
                    this.grid.nextOverlapChars.set(idx, this._getUniqueChar(currentOverlap, charSet).charCodeAt(0));
                }
            }
        }
    }
    
    _getUniqueChar(exclude, charSet) {
        if (!charSet) charSet = Utils.CHARS;
        if (charSet.length <= 1) return charSet[0];
        let char;
        let attempts = 0;
        do {
            char = charSet[Math.floor(Math.random() * charSet.length)];
            attempts++;
        } while (char === exclude && attempts < 10);
        return char;
    }

    _shouldDecay(idx, decay, fadeDurationFrames) {
        return decay > fadeDurationFrames + 2;
    }

    _calculateAlpha(idx, age, decay, fadeDurationFrames) {
        if (age > 0) {
            return 1.0;
        } else if (decay === 1) {
            return 0.95 * this.grid.brightness[idx];
        } else if (decay >= 2) {
            const ratio = (decay - 2) / fadeDurationFrames;
            return 0.95 * (1 - ratio) * this.grid.brightness[idx];
        }
        return 0;
    }
}
