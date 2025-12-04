class SimulationSystem {
            constructor(grid, config) {
                this.grid = grid;
                this.config = config;
                this.activeStreams = [];
                this.lastStreamInColumn = new Array(grid.cols).fill(null);
                this.modes = {
                    'STANDARD': new StandardMode(config),
                    'STAR_POWER': new StarPowerMode(config),
                    'RAINBOW': new RainbowMode(config)
                };
            }

            update(frame) {
                if (this.lastStreamInColumn.length !== this.grid.cols) {
                    this.lastStreamInColumn = new Array(this.grid.cols).fill(null);
                    this.activeStreams = [];
                }
                this._manageStreams(frame);
                this._updateCells(frame);
            }

            _manageStreams(frame) {
                const s = this.config.state;
                const d = this.config.derived;
                
                const period = Math.max(1, Math.floor(d.cycleDuration * s.releaseInterval));

                if (frame % period === 0) {
                    const cols = new Array(this.grid.cols);
                    for(let i=0; i<cols.length; i++) cols[i] = i;
                    for (let i = cols.length - 1; i > 0; i--) { 
                        const j = Math.floor(Math.random() * (i + 1)); 
                        [cols[i], cols[j]] = [cols[j], cols[i]]; 
                    }

                    let tCount = s.streamSpawnCount;
                    let eCount = s.eraserSpawnCount;

                    for (const col of cols) {
                        if (tCount <= 0 && eCount <= 0) break;

                        let hasContent = false;
                        for(let y=0; y < Math.min(this.grid.rows, 40); y++) { 
                            if(this.grid.decays[this.grid.getIndex(col, y)] > 0) { hasContent = true; break; } 
                        }

                        const last = this.lastStreamInColumn[col];

                        if (hasContent) {
                            if (eCount > 0) {
                                const gapOk = !last || !last.active || last.y > s.minEraserGap;
                                if (gapOk) {
                                    this._spawnStreamAt(col, true);
                                    eCount--;
                                }
                            } 
                        } else {
                            if (tCount > 0) {
                                const gapOk = !last || !last.active || last.y > s.minStreamGap;
                                if (gapOk) {
                                    this._spawnStreamAt(col, false);
                                    tCount--;
                                }
                            }
                        }
                    }
                }

                if(frame % d.cycleDuration !== 0) return;

                for (let i = this.activeStreams.length - 1; i >= 0; i--) {
                    const st = this.activeStreams[i];
                    if (!st.active) {
                        this.activeStreams.splice(i, 1);
                        continue;
                    }
                    if (st.delay > 0) { st.delay--; continue; }
                    
                    st.age++;
                    
                    if (st.age >= st.visibleLen) {
                        if (!st.isEraser) {
                            st.active = false; 
                            this._spawnStreamAt(st.x, true); 
                        } else {
                            st.active = false; 
                        }
                        continue;
                    }
                    
                    if (st.y < st.len) { st.y++; this._writeHead(st, frame); }
                }
            }

            _spawnStreamAt(x, forceEraser) {
                const s = this.config.state;
                const st = { x, y: -1, active: true, delay: 0, len: 0, holes: new Set(), decayY: -1, decayStarted: false, age: 0, visibleLen: 0, mode: 'STANDARD', baseHue: 0, isInverted: false, isEraser: false };
                
                if (forceEraser) {
                    st.isEraser = true;
                    st.isInverted = false;
                    st.len = this.grid.rows + 5;
                } else {
                    st.isEraser = false;
                    st.isInverted = s.invertedTracerEnabled && Math.random() < s.invertedTracerChance;
                    st.len = Utils.randomInt(4, this.grid.rows * 3);
                    for(let i=0; i<st.len; i++) if(Math.random() < s.holeRate) st.holes.add(i);
                    st.holes.delete(0);
                }

                let lifeFrames = Math.floor(Utils.randomFloat(s.ttlMinSeconds, s.ttlMaxSeconds) * 60);
                lifeFrames = Math.max(60, lifeFrames); 
                if (st.isEraser) lifeFrames = Math.max(lifeFrames, this.grid.rows + 20);
                st.visibleLen = lifeFrames;

                st.mode = 'STANDARD';
                if (s.starPowerEnabled && Math.random() < (s.starPowerFreq / 100)) st.mode = 'STAR_POWER';
                else if (s.rainbowStreamEnabled && Math.random() < s.rainbowStreamChance) st.mode = 'RAINBOW';
                this.modes[st.mode].spawn(st);
                
                st.y = -1; 
                this.activeStreams.push(st);
                this.lastStreamInColumn[x] = st;
            }

            _writeHead(st, frame) {
                const idx = this.grid.getIndex(st.x, st.y);
                if (idx === -1) return;
                
                let shouldWrite = false;
                if (st.isEraser) shouldWrite = false;
                else if (st.isInverted) shouldWrite = st.holes.has(st.y);
                else shouldWrite = !st.holes.has(st.y);

                if (shouldWrite) {
                    const s = this.config.state;
                    this.grid.types[idx] = (s.rotatorEnabled && Math.random() < s.rotatorChance) ? CELL_TYPE.ROTATOR : CELL_TYPE.TRACER;
                    this.grid.ages[idx] = 1; this.grid.decays[idx] = 1; this.grid.rotatorProg[idx] = 0;
                    
                    this.grid.activeIndices.add(idx);
                    
                    const char = Utils.getRandomChar();
                    this.grid.setChar(idx, char);
                    if(this.grid.types[idx] === CELL_TYPE.ROTATOR) this.grid.nextChars.set(idx, Utils.getUniqueChar(char));
                    this.grid.brightness[idx] = s.variableBrightnessEnabled ? Utils.randomFloat(this.config.derived.varianceMin, 1.0) : 1.0;
                    this.grid.alphas[idx] = this.grid.brightness[idx];
                    const style = this.modes[st.mode].style(st, frame, s);
                    if(style) this.grid.complexStyles.set(idx, style); else this.grid.complexStyles.delete(idx);
                } else {
                    if (st.isEraser) {
                        if (this.grid.decays[idx] > 0 && this.grid.types[idx] !== CELL_TYPE.EMPTY) {
                            this.grid.ages[idx] = 0;
                            this.grid.decays[idx] = 2;
                        } else {
                            this._clearCell(idx);
                        }
                    } else {
                        this._clearCell(idx);
                    }
                }
            }

            _clearCell(idx) {
                this.grid.types[idx] = CELL_TYPE.EMPTY; this.grid.ages[idx] = 0; this.grid.decays[idx] = 0;
                this.grid.alphas[idx] = 0; this.grid.complexStyles.delete(idx); this.grid.nextChars.delete(idx);
                
                // Performance: Remove from active tracking when cell becomes empty.
                this.grid.activeIndices.delete(idx);
            }

            _updateCells(frame) {
                const s = this.config.state; const d = this.config.derived;
                for(const i of this.grid.activeIndices) {
                    const decay = this.grid.decays[i]; if(decay === 0) continue;
                    let age = this.grid.ages[i];
                    if (age > 0) { age++; if (age > d.maxState) age = 0; this.grid.ages[i] = age; }
                    if (s.rotatorEnabled && this.grid.types[i] === CELL_TYPE.ROTATOR) {
                        const prog = this.grid.rotatorProg[i];
                        if (prog > 0) {
                            this.grid.rotatorProg[i]++;
                            if (this.grid.rotatorProg[i] > s.rotatorCrossfadeFrames) {
                                const next = this.grid.nextChars.get(i); if(next) this.grid.setChar(i, next); this.grid.rotatorProg[i] = 0;
                            }
                        } else if (decay === 1) {
                            const cyclePhase = frame % d.rotatorCycleFrames;
                            if (s.rotatorCrossfadeFrames <= 2) { if (cyclePhase === 0) this.grid.setChar(i, Utils.getUniqueChar(this.grid.getChar(i))); }
                            else { if (cyclePhase === 0) { this.grid.rotatorProg[i] = 1; this.grid.nextChars.set(i, Utils.getUniqueChar(this.grid.getChar(i))); } }
                        }
                    }
                    if (decay >= 2) { this.grid.decays[i]++; if (this.grid.decays[i] > s.decayFadeDurationFrames + 2) { this._clearCell(i); continue; } }
                    let alpha = 0;
                    if (age > 0) alpha = 1.0; 
                    else if (decay === 1) alpha = 0.95 * this.grid.brightness[i]; 
                    else if (decay >= 2) { const p = (decay - 2) / s.decayFadeDurationFrames; alpha = (0.95 * (1 - p)) * this.grid.brightness[i]; }
                    this.grid.alphas[i] = alpha;
                }
            }
        }

        // =========================================================================
        // 5. EFFECT SYSTEM
        // =========================================================================
