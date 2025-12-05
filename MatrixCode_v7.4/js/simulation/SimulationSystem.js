class SimulationSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.activeStreams = [];
        this.lastStreamInColumn = new Array(grid.cols).fill(null);
        this.modes = this._initializeModes(config);
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
        this._updateCells(frame);
    }

    _resetColumns() {
        this.lastStreamInColumn = new Array(this.grid.cols).fill(null);
        this.activeStreams = [];
    }

    _manageStreams(frame) {
        const { state: s, derived: d } = this.config;
        const period = Math.max(1, Math.floor(d.cycleDuration * s.releaseInterval));

        if (frame % period === 0) {
            this._spawnStreams(s, d);
        }

        if (frame % d.cycleDuration === 0) {
            this._processActiveStreams(frame);
        }
    }

    _spawnStreams(s, d) {
        const columns = this._shuffleArray([...Array(this.grid.cols).keys()]);
        let streamCount = s.streamSpawnCount;
        let eraserCount = s.eraserSpawnCount;

        for (const col of columns) {
            if (streamCount <= 0 && eraserCount <= 0) break;

            const hasContent = this._columnHasContent(col, Math.min(this.grid.rows, 40));
            const lastStream = this.lastStreamInColumn[col];

            if (hasContent && eraserCount > 0 && this._canSpawn(lastStream, s.minEraserGap)) {
                this._spawnStreamAt(col, true);
                eraserCount--;
            } else if (!hasContent && streamCount > 0 && this._canSpawn(lastStream, s.minStreamGap)) {
                this._spawnStreamAt(col, false);
                streamCount--;
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
        return !lastStream || !lastStream.active || lastStream.y > minGap;
    }

    _processActiveStreams(frame) {
        for (let i = this.activeStreams.length - 1; i >= 0; i--) {
            const stream = this.activeStreams[i];
            if (!stream.active) {
                this.activeStreams.splice(i, 1);
                continue;
            }
            if (stream.delay > 0) {
                stream.delay--;
                continue;
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
    }

    _initializeStream(x, forceEraser, s) {
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
            isEraser: forceEraser
        };

        if (forceEraser) {
            return this._initializeEraserStream(baseStream, s);
        } else {
            return this._initializeTracerStream(baseStream, s);
        }
    }

    _initializeEraserStream(stream, s) {
        stream.len = this.grid.rows + 5;
        stream.visibleLen = Math.max(Math.floor(Utils.randomFloat(s.ttlMinSeconds, s.ttlMaxSeconds) * 60), this.grid.rows + 20);
        return stream;
    }

    _initializeTracerStream(stream, s) {
        const lifeFrames = Math.max(Math.floor(Utils.randomFloat(s.ttlMinSeconds, s.ttlMaxSeconds) * 60), 60);

        stream.len = Utils.randomInt(4, this.grid.rows * 3);
        stream.visibleLen = lifeFrames;
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
            this.grid.activeIndices.add(idx);

            this.grid.setChar(idx, Utils.getRandomChar());
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
            }
            this.grid.rotatorProg[idx] = 0;
        } else {
            this.grid.rotatorProg[idx] = prog + 1;
        }
    }

    _cycleRotator(idx, frame, crossfadeFrames, cycleFrames) {
        if (frame % cycleFrames === 0) {
            if (crossfadeFrames <= 2) {
                this.grid.setChar(idx, Utils.getUniqueChar(this.grid.getChar(idx)));
            } else {
                this.grid.rotatorProg[idx] = 1;
                this.grid.nextChars.set(idx, Utils.getUniqueChar(this.grid.getChar(idx)));
            }
        }
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

    // =========================================================================
    // 6.0 EFFECT REGISTRY
    // =========================================================================
