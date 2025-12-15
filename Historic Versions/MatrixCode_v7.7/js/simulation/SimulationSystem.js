
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
        this.nextSpawnFrame = 0; // Track next spawn time

        // Reusable columns pool to avoid per-spawn allocation
        this._columnsPool = new Array(this.grid.cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;

        // Global Time Dilation (1.0 = normal, 0.0 = pause, <0 = reverse)
        this.timeScale = 1.0;
    }

    _initializeModes(config) {
        return {
            'STANDARD': new StandardMode(config),
            'STAR_POWER': new StarPowerMode(config),
            'RAINBOW': new RainbowMode(config)
        };
    }

    update(frame) {
        // Keep columns arrays in sync with grid size
        if (this.lastStreamInColumn.length !== this.grid.cols) {
            this._resetColumns();
        }

        // Only spawn new streams if time is moving forward normally
        // (Or we could allow spawning in reverse? Nah, simpler to stop.)
        if (this.timeScale > 0) {
            this._manageStreams(frame);
        } else if (this.timeScale < 0) {
            // In reverse, we just process existing streams backwards
            this._processActiveStreams(frame);
        }
        // If timeScale == 0, we pause (no updates to streams)

        this._manageOverlapGrid(frame);
        this._updateCells(frame);
        
        // Clear locks for the next frame (locks are set during rendering)
        if (this.grid.cellLocks) {
            this.grid.cellLocks.fill(0);
        }
    }

    _manageOverlapGrid(frame) {
        const s = this.config.state;

        if (!s.overlapEnabled) {
            // Reset initialization state when disabled
            if (this.overlapInitialized) {
                this.overlapInitialized = false;
                // Clear all overlap chars when disabled (faster than manual loop)
                if (this.grid.overlapChars && typeof this.grid.overlapChars.fill === 'function') {
                    this.grid.overlapChars.fill(0);
                } else {
                    for (let i = 0; i < this.grid.overlapChars.length; i++) {
                        this.grid.overlapChars[i] = 0;
                    }
                }
            }
            return;
        }
        
        const activeFonts = this.config.derived.activeFonts;
        const numFonts = activeFonts.length;
        const currentDensity = s.overlapDensity;

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
                const r = Math.floor(Math.random() * chars.length);
                this.grid.overlapChars[i] = chars[r].charCodeAt(0);
            } else {
                this.grid.overlapChars[i] = 32; // Space if empty
            }
        };

        // Check if we need to reinitialize (density changed or first time)
        if (!this.overlapInitialized || this._lastOverlapDensity !== currentDensity) {
            const N = this.grid.overlapChars.length;
            for (let i = 0; i < N; i++) {
                if (Math.random() < currentDensity) {
                    setOverlapChar(i);
                } else {
                    this.grid.overlapChars[i] = 0; // Empty
                }
            }
            this.overlapInitialized = true;
            this._lastOverlapDensity = currentDensity;
        }
    }

    _resetColumns() {
        this.lastStreamInColumn = new Array(this.grid.cols).fill(null);
        this.lastEraserInColumn = new Array(this.grid.cols).fill(null);
        this.activeStreams = [];
        // Reset overlap initialization when grid resizes
        this.overlapInitialized = false;

        // Rebuild columns pool to match new grid size
        this._columnsPool = new Array(this.grid.cols);
        for (let i = 0; i < this._columnsPool.length; i++) this._columnsPool[i] = i;
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
        // Shuffle columns pool in place (Fisher–Yates), avoid per-spawn allocation
        const columns = this._columnsPool;
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
            if (eraserCount > 0 && this._canSpawnEraser(col, s.minEraserGap, s.minGapTypes)) {
                this._spawnStreamAt(col, true);
                eraserCount--;
                continue; // Spawned eraser, move to next column
            } 
            
            // Tracers CANNOT spawn if top is blocked (collision).
            else if (!isTopBlocked && streamCount > 0 && this._canSpawnTracer(lastStream, s.minStreamGap, s.minGapTypes)) {
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

    _canSpawnTracer(lastStream, minGap, minGapTypes) {
        // If no last stream, or it's finished, we can spawn
        if (!lastStream || !lastStream.active) return true;
        
        // If last stream was an Eraser, check the Type Gap
        if (lastStream.isEraser) {
            return lastStream.y > minGapTypes;
        }

        // Otherwise (last was Tracer), respect the standard gap
        return lastStream.y > minGap;
    }
    
    _canSpawnEraser(col, minGap, minGapTypes) {
        const lastEraser = this.lastEraserInColumn[col];
        if (lastEraser && lastEraser.active && lastEraser.y <= minGap) return false;
        
        // Also check the absolute last stream (could be a tracer)
        const lastStream = this.lastStreamInColumn[col];
        if (lastStream && lastStream.active && !lastStream.isEraser) {
            if (lastStream.y <= minGapTypes) return false;
        }
        
        return true;
    }

    _processActiveStreams(frame) {
        const grid = this.grid;
        const rows = grid.rows;
        const cellLocks = grid.cellLocks;
        const decays = grid.decays;

        // Apply global time scale to probability of movement
        // We use probabilistic movement for partial speeds (e.g. 0.5)
        // For reverse, we treat magnitude as speed.
        
        // Skip if paused
        if (Math.abs(this.timeScale) < 0.01) return;

        const isReverse = this.timeScale < 0;
        const speedMult = Math.abs(this.timeScale);

        for (let i = this.activeStreams.length - 1; i >= 0; i--) {
            const stream = this.activeStreams[i];
            if (!stream.active) {
                // remove inactive stream (keep order; backwards + splice is OK)
                this.activeStreams.splice(i, 1);
                continue;
            }

            // Check if stream is currently frozen by an effect
            const headIdx = grid.getIndex(stream.x, Math.max(0, stream.y));
            if (headIdx !== -1 && cellLocks && cellLocks[headIdx] === 1) {
                continue;
            }

            if (stream.delay > 0) {
                stream.delay--;
                continue;
            }

            // Decrement tick timer for movement
            // Adjust decrement based on speedMult
            stream.tickTimer -= speedMult;
            
            if (stream.tickTimer > 0) {
                continue; // Not time to move yet
            }
            
            // Reset timer (accumulate remainder for smooth speed changes?)
            // Simple reset for now:
            stream.tickTimer = stream.tickInterval;

            if (isReverse) {
                // --- REVERSE LOGIC ---
                // Move Head UP
                stream.y--;
                
                // If head goes off screen top (or becomes too "young"?)
                // Actually, just moving head up is enough. 
                // We write a NEW head at the new Y. 
                // The old head (at Y+1) is abandoned and starts decaying naturally via _updateCell.
                // Boundaries:
                if (stream.y < -5) { // Arbitrary buffer
                    stream.active = false;
                    continue;
                }
                
                this._writeHead(stream, frame);

            } else {
                // --- FORWARD LOGIC ---

                // Eraser Random Drop-off
                if (stream.isEraser) {
                    const stopChance = this.config.state.eraserStopChance;
                    if (stopChance > 0 && Math.random() < (stopChance / 100)) {
                        stream.active = false;
                        continue;
                    }
                } else {                    
                    // Tracer Random Drop-Off
                    const stopChance = this.config.state.tracerStopChance;
                    if (stopChance > 0 && Math.random() < (stopChance / 100)) {
                        stream.active = false;
                        continue;
                    }

                    // Tracer Collision Detection
                    const nextY = stream.y + 1;
                    if (nextY < rows) {
                        const nextIdx = grid.getIndex(stream.x, nextY);
                        // If next cell is occupied (decay > 0)
                        if (nextIdx !== -1 && decays[nextIdx] > 0) {
                            // Collision! Stop stream.
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
        // Pick a font for this stream
        const activeFonts = this.config.derived.activeFonts || [{name:'MatrixEmbedded', chars: Utils.CHARS}];
        const fontIdx = Math.floor(Math.random() * activeFonts.length);
        
        // Calculate individual speed
        const baseTick = Math.max(1, 21 - s.streamSpeed);
        let tickInterval = baseTick;
        
        if (s.desyncIntensity > 0) {
            // Variance: +/- 50% of baseTick * intensity
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
            tickInterval: tickInterval, // How many frames per move (can be float; preserved)
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
        // Tracers run full screen length by default.
        stream.len = this.grid.rows + 10; 
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
        const decays = this.grid.decays;
        // If already fading, let it continue fading to respect current brightness
        if (decays[idx] >= 2) return;

        if (decays[idx] > 0 && this.grid.types[idx] !== CELL_TYPE.EMPTY) {
            this.grid.ages[idx] = 0;
            decays[idx] = 2;
        } else {
            this._clearCell(idx);
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
            grid.rotatorProg[idx] = 0;
            
            // Set font
            grid.setFont(idx, stream.fontIndex);
            
            if (Math.random() < s.paletteBias) {
                grid.paletteIndices[idx] = Math.floor(Math.random() * (d.paletteColorsStr?.length || 1));
            } else {
                grid.paletteIndices[idx] = stream.pIdx;
            }
            
            grid.activeIndices.add(idx);

            // Get char from active font set
            const activeFonts = d.activeFonts;
            const fontData = activeFonts[stream.fontIndex] || activeFonts[0];
            const charSet = fontData.chars;
            const char = charSet[Math.floor(Math.random() * charSet.length)];
            grid.setChar(idx, char);

            if (s.overlapEnabled && Math.random() < s.overlapDensity) {
                // Use same charset for overlap to match font
                grid.overlapChars[idx] = charSet[Math.floor(Math.random() * charSet.length)].charCodeAt(0);
            }
            
            const b = s.variableBrightnessEnabled
                ? Utils.randomFloat(d.varianceMin, 1.0)
                : 1.0;

            grid.brightness[idx] = b;
            grid.alphas[idx] = b;

            const style = this.modes[stream.mode].style(stream, frame, s);
            if (style) {
                grid.complexStyles.set(idx, style);
            } else {
                grid.complexStyles.delete(idx);
            }
        } else {
            this._clearCell(idx);
        }
    }

    _clearCell(idx) {
        const grid = this.grid;
        grid.types[idx] = CELL_TYPE.EMPTY;
        grid.ages[idx] = 0;
        grid.decays[idx] = 0;
        grid.alphas[idx] = 0;
        grid.overlapChars[idx] = 0;

        grid.complexStyles.delete(idx);
        grid.nextChars.delete(idx);
        grid.activeIndices.delete(idx); // Improves performance
    }

    _updateCells(frame) {
        const s = this.config.state;
        const d = this.config.derived;
        const grid = this.grid;

        for (const idx of grid.activeIndices) {
            this._updateCell(idx, frame, s, d);
        }
    }

    _updateCell(idx, frame, s, d) {
        const grid = this.grid;

        // Check if cell is locked by an effect (e.g. Pulse)
        if (grid.cellLocks && grid.cellLocks[idx] === 1) return;

        const decay = grid.decays[idx];
        if (decay === 0) return;

        let age = grid.ages[idx];
        if (age > 0) {
            age = this._incrementAge(age, d.maxState);
            grid.ages[idx] = age;
        }

        if (s.rotatorEnabled && grid.types[idx] === CELL_TYPE.ROTATOR) {
            this._handleRotator(idx, frame, s, d);
        }

        if (decay >= 2) {
            grid.decays[idx]++;
            const newDecay = grid.decays[idx];
            if (this._shouldDecay(idx, newDecay, s.decayFadeDurationFrames)) {
                this._clearCell(idx);
                return;
            }
            grid.alphas[idx] = this._calculateAlpha(idx, age, newDecay, s.decayFadeDurationFrames);
        } else {
            grid.alphas[idx] = this._calculateAlpha(idx, age, decay, s.decayFadeDurationFrames);
        }
    }

    _incrementAge(age, maxState) {
        return age < maxState ? age + 1 : 0;
    }

    _handleRotator(idx, frame, s, d) {
        const grid = this.grid;
        const prog = grid.rotatorProg[idx];
        const decay = grid.decays[idx];

        if (prog > 0) {
            this._progressRotator(idx, prog, s.rotatorCrossfadeFrames);
        } else if (decay === 1 || (s.rotateDuringFade && decay > 1)) {
            this._cycleRotator(idx, frame, s.rotatorCrossfadeFrames, d.rotatorCycleFrames, s);
        }
    }

    _progressRotator(idx, prog, crossfadeFrames) {
        const grid = this.grid;

        if (prog >= crossfadeFrames) {
            const nextChar = grid.nextChars.get(idx);
            if (nextChar) {
                grid.setChar(idx, nextChar);
                if (this.config.state.overlapEnabled) {
                    const nextOverlap = grid.nextOverlapChars.get(idx);
                    if (nextOverlap) {
                        grid.overlapChars[idx] = nextOverlap;
                        grid.noiseDirty = true;
                    }
                }
            }
            grid.rotatorProg[idx] = 0;
        } else {
            grid.rotatorProg[idx] = prog + 1;
        }
    }

    _cycleRotator(idx, frame, crossfadeFrames, cycleFrames, s) {
        const grid = this.grid;
        let effectiveCycle = cycleFrames;
        
        if (s.rotatorDesyncEnabled) {
            // "Different speeds... with variance"
            const variancePercent = s.rotatorDesyncVariance / 100; // 0.0 to 1.0
            const maxVariance = cycleFrames * variancePercent;
            
            // Map 0..255 to -1..1
            const offsetNorm = (grid.rotatorOffsets[idx] / 127.5) - 1.0;
            
            // Apply variance
            effectiveCycle = Math.max(1, Math.round(cycleFrames + (offsetNorm * maxVariance)));
        }

        if (frame % effectiveCycle === 0) {
            // Get correct font charset
            const fontIdx = grid.getFont(idx);
            const activeFonts = this.config.derived.activeFonts;
            const fontData = activeFonts[fontIdx] || activeFonts[0];
            const charSet = fontData.chars;
            
            if (crossfadeFrames <= 2) {
                grid.setChar(idx, this._getUniqueChar(grid.getChar(idx), charSet));
                if (this.config.state.overlapEnabled) {
                    const currentOverlap = String.fromCharCode(grid.overlapChars[idx]);
                    grid.overlapChars[idx] = this._getUniqueChar(currentOverlap, charSet).charCodeAt(0);
                }
            } else {
                grid.rotatorProg[idx] = 1;
                grid.nextChars.set(idx, this._getUniqueChar(grid.getChar(idx), charSet));
                if (this.config.state.overlapEnabled) {
                    const currentOverlap = String.fromCharCode(grid.overlapChars[idx]);
                    grid.nextOverlapChars.set(idx, this._getUniqueChar(currentOverlap, charSet).charCodeAt(0));
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
        const b = this.grid.brightness[idx];
        if (age > 0 || decay === 1) {
            return 0.95 * b;
        } else if (decay >= 2) {
            const ratio = (decay - 2) / fadeDurationFrames;
            return 0.95 * (1 - ratio) * b;
        }
        return 0;
    }
}