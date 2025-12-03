class ConfigurationManager {
            constructor() {
                this.storageKey = 'matrix_config_v7.3'; 
                this.slotsKey = 'matrix_slots_v7.3';
                
                this.defaults = {
                    // --- GLOBAL ---
                    streamColor: "#65d778", 
                    streamSpeed: 15,
                    clearAlpha: 0.6,
                    enableBloom: true, 
                    bloomStrength: 2, 
                    bloomOpacity: 0.45,
                    resolution: 1, 
                    smoothingEnabled: true, 
                    smoothingAmount: 0.4, 
                    stretchX: 1, 
                    stretchY: 1.1,

                    // --- STREAMS ---
                    streamSpawnCount: 4,
                    eraserSpawnCount: 4, 
                    releaseInterval: 4,
                    minStreamGap: 15,
                    minEraserGap: 15,
                    holeRate: 0.15,
                    ttlMinSeconds: 2, 
                    ttlMaxSeconds: 5.5, 
                    decayFadeDurationFrames: 24,
                    dissolveEnabled: true, 
                    dissolveMinSize: 19, 
                    deteriorationEnabled: true, 
                    deteriorationType: 'ghost', 
                    deteriorationStrength: 2,
                    invertedTracerEnabled: true, 
                    invertedTracerChance: 0.1,

                    // --- FONT & GLYPHS ---
                    fontFamily: 'MatrixEmbedded', 
                    fontSize: 26, 
                    fontWeight: 'normal', 
                    italicEnabled: false,
                    mirrorEnabled: false, 
                    fontOffsetY: 0, 
                    fontOffsetX: 0,
                    horizontalSpacingFactor: 0.7, 
                    verticalSpacingFactor: 0.95,
                    variableBrightnessEnabled: true, 
                    brightnessVariance: 20,

                    // --- MUTATORS (TRACERS) ---
                    tracerColor: "#d9f2f2", 
                    tracerSizeIncrease: 1, 
                    tracerGlow: 15,
                    tracerAttackFrames: 8, 
                    tracerHoldFrames: 0, 
                    tracerReleaseFrames: 6,

                    // --- MUTATORS (ROTATORS) ---
                    rotatorEnabled: true, 
                    rotatorChance: 0.13, 
                    rotatorSyncToTracer: true, 
                    rotatorSyncMultiplier: 0.5,
                    rotatorCycleFactor: 11, 
                    rotatorCrossfadeFrames: 6,

                    // --- GLYPH FX (STAR POWER) ---
                    starPowerEnabled: false, 
                    starPowerFreq: 100, 
                    starPowerRainbowMode: 'char',
                    starPowerColorCycle: false, 
                    starPowerCycleSpeed: 14, 
                    starPowerSaturation: 100, 
                    starPowerIntensity: 51, 
                    starPowerGlitter: false,

                    // --- GLYPH FX (RAINBOW) ---
                    rainbowStreamEnabled: false, 
                    rainbowStreamChance: 1, 
                    rainbowStreamIntensity: 50,

                    // --- EVENTS (PULSE) ---
                    pulseEnabled: true, 
                    pulseFrequencySeconds: 180, 
                    pulseDelayFrames: 60, 
                    pulseDurationSeconds: 2.2, 
                    pulsePreserveSpaces: true, 
                    pulseRandomPosition: true, 
                    pulseWidth: 130, 
                    pulseDimming: 0.2, 
                    pulseIgnoreTracers: true,
                    pulseCircular: false,
                    pulseBlend: true,
                    pulseInstantStart: false,

                    // --- EVENTS (CLEAR PULSE) ---
                    clearPulseEnabled: true, 
                    clearPulseFrequencySeconds: 240, 
                    clearPulseDurationSeconds: 2.2, 
                    clearPulsePreserveSpaces: true, 
                    clearPulseRandomPosition: true, 
                    clearPulseWidth: 130, 
                    clearPulseIgnoreTracers: true,
                    clearPulseCircular: false,
                    clearPulseBlend: true,
                    clearPulseInstantStart: false,

                    // --- EVENTS (MINI PULSE) ---
                    miniPulseEnabled: true,
                    miniPulseFrequencySeconds: 450,
                    miniPulseDurationSeconds: 5,
                    miniPulseSpawnChance: 0.03,
                    miniPulseSize: 140,
                    miniPulseThickness: 64,
                    miniPulseSpeed: 14,
                    miniPulsePreserveSpaces: true,

                    // --- EVENTS (DEJA VU) ---
                    dejaVuEnabled: true, 
                    dejaVuAutoMode: true,
                    dejaVuFrequencySeconds: 300, 
                    dejaVuDurationSeconds: 5,
                    dejaVuBarDurationFrames: 30, 
                    dejaVuVarianceFrames: 60, 
                    dejaVuIntensity: 0.06,
                    dejaVuHoleBrightness: 0.02, 
                    dejaVuMinRectHeight: 1, 
                    dejaVuMaxRectHeight: 10, 
                    dejaVuRandomizeColors: true, 

                    // --- EVENTS (SUPERMAN) ---
                    supermanEnabled: true,
                    supermanDurationSeconds: 5,
                    supermanFlickerRate: 3, // How many frames between shape changes (lower is faster)
                    supermanWidth: 4, // Vertical spread (amplitude) / Jitter
                    supermanSpawnSpeed: 40, // Multiplier for how fast it crosses the screen
                    supermanFadeSpeed: 20, // Fade out divisor (higher = slower fade)
                    supermanIncludeColors: false, // If true, keeps original color but super-bright
                    supermanGlow: 4, 
                    supermanBoltThickness: 4,
                };

                this.state = { ...this.defaults };
                this.derived = {};
                this.slots = this._loadSlots();
                this.subscribers = [];
                this.load();
                this.updateDerivedValues();
            }

            _loadSlots() { try { const s = localStorage.getItem(this.slotsKey); if (s) return JSON.parse(s); } catch (e) {} return Array(3).fill(null).map((_, i) => ({ name: `Save Slot ${i + 1}`, data: null })); }
            saveSlots() { try { localStorage.setItem(this.slotsKey, JSON.stringify(this.slots)); } catch (e) {} }
            load() { try { const s = localStorage.getItem(this.storageKey); if (s) { const parsed = JSON.parse(s); if(parsed.customFonts) delete parsed.customFonts; this.state = { ...this.defaults, ...parsed }; } } catch (e) {} }
            save() { try { localStorage.setItem(this.storageKey, JSON.stringify(this.state)); } catch (e) {} }
            
            get(key) { return this.state[key]; }
            
            set(key, value) {
                this.state[key] = value;
                if (key === 'streamMinLength') this.state.streamMaxLength = Math.max(this.state.streamMaxLength, value);
                if (key === 'streamMaxLength') this.state.streamMinLength = Math.min(this.state.streamMinLength, value);
                this.updateDerivedValues(); 
                this.save(); 
                this.notify(key);
            }
            
            reset() { this.state = { ...this.defaults }; this.updateDerivedValues(); this.save(); this.notify('ALL'); }
            saveToSlot(i) { this.slots[i] = { name: this.slots[i].name, data: JSON.parse(JSON.stringify(this.state)) }; this.saveSlots(); }
            loadFromSlot(i) { if(!this.slots[i].data) return false; this.state = { ...this.defaults, ...this.slots[i].data }; this.updateDerivedValues(); this.save(); this.notify('ALL'); return true; }
            renameSlot(i, n) { this.slots[i].name = n; this.saveSlots(); }
            subscribe(cb) { this.subscribers.push(cb); }
            notify(k) { this.subscribers.forEach(cb => cb(k, this.state)); }
            
            updateDerivedValues() {
                const s = this.state;
                const cycleDur = 21 - s.streamSpeed;
                const hFactor = Math.max(0.5, s.horizontalSpacingFactor);
                const vFactor = Math.max(0.5, s.verticalSpacingFactor);
                
                let rotFrames;
                if (s.rotatorSyncToTracer) {
                    rotFrames = Math.max(1, Math.floor(cycleDur / s.rotatorSyncMultiplier));
                } else {
                    rotFrames = Math.max(10, Math.round(60 - (s.rotatorCycleFactor * 2.5)));
                }

                this.derived = {
                    cycleDuration: cycleDur,
                    safeAttack: Math.max(1, Math.min(s.tracerAttackFrames, cycleDur)),
                    safeRelease: Math.min(s.tracerReleaseFrames, cycleDur),
                    holdFrames: Math.max(0, s.tracerHoldFrames),
                    maxState: cycleDur + Math.max(0, s.tracerHoldFrames) + cycleDur,
                    rotatorCycleFrames: rotFrames,
                    cellWidth: s.fontSize * hFactor, 
                    cellHeight: s.fontSize * vFactor,
                    varianceMin: 1.0 - (s.brightnessVariance / 100),
                    streamRgb: Utils.hexToRgb(s.streamColor), 
                    tracerRgb: Utils.hexToRgb(s.tracerColor),
                    streamColorStr: `rgb(${Utils.hexToRgb(s.streamColor).r},${Utils.hexToRgb(s.streamColor).g},${Utils.hexToRgb(s.streamColor).b})`,
                    tracerColorStr: `rgb(${Utils.hexToRgb(s.tracerColor).r},${Utils.hexToRgb(s.tracerColor).g},${Utils.hexToRgb(s.tracerColor).b})`,
                    fontBaseStr: `${s.italicEnabled?'italic':''} ${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
                };
            }
        }

        // =========================================================================
        // 3. DATA LAYER
        // =========================================================================