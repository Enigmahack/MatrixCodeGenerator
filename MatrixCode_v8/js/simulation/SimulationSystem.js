class SimulationSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.streamManager = new StreamManager(grid, config);
        this.overlapInitialized = false;
        this._lastOverlapDensity = null;
        this.timeScale = 1.0;
    }

    update(frame) {
        this.streamManager.update(frame, this.timeScale);
        this._manageOverlapGrid(frame);
        this._updateCells(frame);
        
        if (this.grid.cellLocks) {
            this.grid.cellLocks.fill(0);
        }
    }

    _manageOverlapGrid(frame) {
        const s = this.config.state;

        if (!s.overlapEnabled) {
            if (this.overlapInitialized) {
                this.overlapInitialized = false;
                if (this.grid.secondaryChars && typeof this.grid.secondaryChars.fill === 'function') {
                    this.grid.secondaryChars.fill(32); 
                }
            }
            return;
        }
        
        const activeFonts = this.config.derived.activeFonts;
        const numFonts = activeFonts.length;
        const currentDensity = s.overlapDensity;
        
        const ovRgb = Utils.hexToRgb(s.overlapColor);
        const ovColor = Utils.packAbgr(ovRgb.r, ovRgb.g, ovRgb.b);

        const setOverlapChar = (i) => {
            let fIdx;
            if (this.grid.types[i] === CELL_TYPE.EMPTY) {
                fIdx = Math.floor(Math.random() * numFonts);
            } else {
                fIdx = this.grid.fontIndices[i];
            }
            
            const fontData = activeFonts[fIdx] || activeFonts[0];
            const chars = fontData.chars;
            let code = 32;
            if (chars && chars.length > 0) {
                const r = Math.floor(Math.random() * chars.length);
                code = chars[r].charCodeAt(0);
            }
            
            this.grid.secondaryChars[i] = code;
            this.grid.secondaryColors[i] = ovColor;
        };

        if (!this.overlapInitialized || this._lastOverlapDensity !== currentDensity) {
            const N = this.grid.secondaryChars.length;
            for (let i = 0; i < N; i++) {
                if (Math.random() < currentDensity) {
                    setOverlapChar(i);
                } else {
                    this.grid.secondaryChars[i] = 32; 
                }
            }
            this.overlapInitialized = true;
            this._lastOverlapDensity = currentDensity;
        }
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

        if (grid.cellLocks && grid.cellLocks[idx] === 1) return;

        const decay = grid.decays[idx];
        if (decay === 0) return;

        let age = grid.ages[idx];
        if (age > 0) {
            age = this._incrementAge(age, d.maxState);
            grid.ages[idx] = age;
        }

        // --- TRACER COLOR FADE ---
        // Transitions from Tracer Color -> Stream Color based on Age
        if (grid.types[idx] === CELL_TYPE.TRACER || grid.types[idx] === CELL_TYPE.ROTATOR) {
            const attack = s.tracerAttackFrames;
            const hold = s.tracerHoldFrames;
            const release = s.tracerReleaseFrames;
            const tracerColor = d.tracerColorUint32;
            const baseColor = grid.baseColors[idx];

            let ratio = 0; // 0 = Tracer, 1 = Base
            
            // Age 1..Attack: Fade In (Alpha handles this, color stays Tracer)
            // Attack..Attack+Hold: Hold Tracer Color
            // Attack+Hold..End: Fade to Stream Color
            
            const activeAge = age - 1;
            if (activeAge > attack + hold) {
                if (release > 0) {
                    ratio = Math.min(1.0, (activeAge - (attack + hold)) / release);
                } else {
                    ratio = 1.0;
                }
            }
            
            if (ratio >= 1.0) {
                grid.colors[idx] = baseColor;
                grid.glows[idx] = 0; // Remove glow after transition
            } else if (ratio > 0) {
                // Blend
                const tR = tracerColor & 0xFF;
                const tG = (tracerColor >> 8) & 0xFF;
                const tB = (tracerColor >> 16) & 0xFF;
                
                const bR = baseColor & 0xFF;
                const bG = (baseColor >> 8) & 0xFF;
                const bB = (baseColor >> 16) & 0xFF;
                
                const mR = Math.floor(tR + (bR - tR) * ratio);
                const mG = Math.floor(tG + (bG - tG) * ratio);
                const mB = Math.floor(tB + (bB - tB) * ratio);
                
                grid.colors[idx] = Utils.packAbgr(mR, mG, mB);
                grid.glows[idx] = s.tracerGlow * (1.0 - ratio);
            } else {
                // Hold Tracer
                grid.colors[idx] = tracerColor;
                grid.glows[idx] = s.tracerGlow;
            }
        }

        // Handle Rotator
        if (s.rotatorEnabled && grid.types[idx] === CELL_TYPE.ROTATOR) {
            this._handleRotator(idx, frame, s, d);
        }

        // Handle Dynamic Colors (Effects)
        if (grid.complexStyles.has(idx)) {
            const style = grid.complexStyles.get(idx);
            if (style.cycle) {
                const newHue = (style.h + style.speed) % 360;
                style.h = newHue; 
                const rgb = Utils.hslToRgb(newHue, style.s, style.l);
                grid.colors[idx] = Utils.packAbgr(rgb.r, rgb.g, rgb.b);
            }
        }

        // Handle Decay / Alpha
        if (decay >= 2) {
            // Ensure trails are Stream Color, not Tracer Color
            if (decay === 2) { // First frame of decay
                grid.colors[idx] = grid.baseColors[idx];
                grid.glows[idx] = 0;
            } else {
                // Also enforce it in case we missed frame 2 (unlikely but safe)
                grid.colors[idx] = grid.baseColors[idx];
            }
            
            grid.decays[idx]++;
            const newDecay = grid.decays[idx];
            if (this._shouldDecay(idx, newDecay, s.decayFadeDurationFrames)) {
                grid.clearCell(idx);
                return;
            }
            grid.alphas[idx] = this._calculateAlpha(idx, age, newDecay, s.decayFadeDurationFrames);
        } else {
            grid.alphas[idx] = this._calculateAlpha(idx, age, decay, s.decayFadeDurationFrames);
        }
    }

    _incrementAge(age, maxState) {
        return age + 1;
    }

    _handleRotator(idx, frame, s, d) {
        const grid = this.grid;
        const mix = grid.mix[idx]; 
        const decay = grid.decays[idx];

        if (mix > 0) {
            this._progressRotator(idx, mix, s.rotatorCrossfadeFrames);
        } else if (decay === 1 || (s.rotateDuringFade && decay > 1)) {
            this._cycleRotator(idx, frame, s.rotatorCrossfadeFrames, d.rotatorCycleFrames, s);
        }
    }

    _progressRotator(idx, currentMix, crossfadeFrames) {
        const grid = this.grid;
        const step = 1.0 / Math.max(1, crossfadeFrames);
        const newMix = currentMix + step;

        if (newMix >= 1.0) {
            const target = grid.getRotatorTarget(idx, false); 
            if (target) {
                grid.chars[idx] = target;
                if (this.config.state.overlapEnabled) {
                    const ovTarget = grid.getRotatorTarget(idx, true);
                    if (ovTarget) {
                        grid.secondaryChars[idx] = ovTarget;
                    }
                }
            }
            grid.mix[idx] = 0;
            grid.nextChars.delete(idx);
            grid.nextOverlapChars.delete(idx);
        } else {
            grid.mix[idx] = newMix;
        }
    }

    _cycleRotator(idx, frame, crossfadeFrames, cycleFrames, s) {
        const grid = this.grid;
        let effectiveCycle = cycleFrames;
        
        if (s.rotatorDesyncEnabled) {
            const variancePercent = s.rotatorDesyncVariance / 100;
            const maxVariance = cycleFrames * variancePercent;
            const offsetNorm = (grid.rotatorOffsets[idx] / 127.5) - 1.0;
            effectiveCycle = Math.max(1, Math.round(cycleFrames + (offsetNorm * maxVariance)));
        }

        if (frame % effectiveCycle === 0) {
            const fontIdx = grid.fontIndices[idx];
            const activeFonts = this.config.derived.activeFonts;
            const fontData = activeFonts[fontIdx] || activeFonts[0];
            const charSet = fontData.chars;
            
            const nextChar = this._getUniqueChar(grid.getChar(idx), charSet);
            const nextCode = nextChar.charCodeAt(0);
            
            let nextOvCode = 0;
            if (this.config.state.overlapEnabled) {
                const curOv = String.fromCharCode(grid.secondaryChars[idx]);
                const nextOv = this._getUniqueChar(curOv, charSet);
                nextOvCode = nextOv.charCodeAt(0);
            }

            if (crossfadeFrames <= 1) {
                grid.chars[idx] = nextCode;
                if (nextOvCode) grid.secondaryChars[idx] = nextOvCode;
            } else {
                grid.mix[idx] = 0.01; 
                grid.setRotatorTarget(idx, nextChar, false);
                if (nextOvCode) {
                    grid.setRotatorTarget(idx, String.fromCharCode(nextOvCode), true);
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