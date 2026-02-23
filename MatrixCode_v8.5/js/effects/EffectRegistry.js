// =========================================================================
// EFFECT REGISTRY
// =========================================================================

class EffectRegistry {
            constructor(grid, config) { 
                this.grid = grid; 
                this.config = config; 
                this.effects = []; 
            }
            setGrid(grid) {
                this.grid = grid;
                this.effects.forEach(e => { if (e.g !== undefined) e.g = grid; });
            }
            register(effect) { this.effects.push(effect); }
            registerDefaults() {
                // ... (Load dynamically or manually)
            }

            /**
             * Data-Driven Effect Registration
             * Iterates through the ConfigTemplate and registers effects based on their actions.
             * @param {Array<Object>} template - The UI ConfigTemplate.
             */
            autoRegister(template) {
                if (!template) return;

                const CLASS_MAP = {
                    'pulse': PulseEffect,
                    'clearpulse': ClearPulseEffect,
                    'minipulse': MiniPulseEffect,
                    'dejavu': DejaVuEffect,
                    'superman': SupermanEffect,
                    'boot': BootEffect,
                    'crash': CrashEffect,
                    'quantizedPulse': QuantizedPulseEffect,
                    'quantizedAdd': QuantizedAddEffect,
                    'quantizedRetract': QuantizedRetractEffect,
                    'quantizedClimb': QuantizedClimbEffect,
                    'quantizedZoom': QuantizedZoomEffect,
                    'QuantizedBlockGenerator': QuantizedBlockGeneration
                };

                const registeredActions = new Set();

                template.forEach(def => {
                    if (def.type === 'button' && def.action) {
                        const EffectClass = CLASS_MAP[def.action];
                        if (EffectClass && !registeredActions.has(def.action)) {
                            if (EffectClass === CrashEffect || EffectClass === BootEffect) {
                                this.register(new EffectClass(this.grid, this.config, this));
                            } else {
                                this.register(new EffectClass(this.grid, this.config));
                            }
                            registeredActions.add(def.action);
                        }
                    }
                });

                if (this.config.state.logErrors) {
                    console.log(`[EffectRegistry] Auto-registered ${registeredActions.size} effects from template.`);
                }
            }

            get(name) { return this.effects.find(e => e.name === name); }

            isQuantizedActive() {
                return this.effects.some(e => e.active && e.name.startsWith('Quantized'));
            }

            _isEditorActive() {
                if (window.matrix && window.matrix.ui && window.matrix.ui.quantEditor) {
                    return window.matrix.ui.quantEditor.active;
                }
                return false;
            }

            trigger(name, ...args) {
                const fx = this.effects.find(e => e.name === name);
                if (!fx) return false;

                // 1. Prevent running ANY effects while in the editor
                if (this._isEditorActive()) {
                    return false;
                }

                // 2. Prevent two quantized effects from running at the same time
                const isQuantized = name.startsWith('Quantized');
                if (isQuantized) {
                    const activeQuantized = this.effects.find(e => e.active && e.name.startsWith('Quantized'));
                    if (activeQuantized && activeQuantized !== fx) {
                        return false;
                    }
                }

                const result = fx.trigger(...args);
                if (result) {
                    this.grid.overrideOwner = fx;
                }
                return result;
            }
            
            _getEditedEffect() {
                if (window.matrix && window.matrix.ui && window.matrix.ui.quantEditor && window.matrix.ui.quantEditor.active) {
                    return window.matrix.ui.quantEditor.effect;
                }
                return null;
            }

            update() { 
                this.grid.clearAllOverrides(this.grid.overrideOwner);
                this.grid.clearAllEffects();

                const isEditorActive = this._isEditorActive();
                const editedEffect = this._getEditedEffect();

                this.effects.forEach(e => {
                    // If editor is active, only allow the currently edited effect to update
                    if (isEditorActive && e !== editedEffect) {
                        return;
                    }

                    e.update(); 
                    if (!e.active) return;

                    if (typeof e.applyToGrid === 'function') {
                        e.applyToGrid(this.grid);
                    } else if (typeof e.getOverride === 'function') {
                        this._applyLegacyOverride(e);
                    }
                }); 
            }

            _applyLegacyOverride(e) {
                const indices = e.getActiveIndices();
                
                const apply = (i) => {
                    const over = e.getOverride(i);
                    if (over) {
                        if (over.solid) {
                            // Parse Color & Alpha
                            let r=0, g=0, b=0, a=255;
                            if (over.bgColor) {
                                // Try Hex first (Utils handles it)
                                if (over.bgColor.startsWith('#')) {
                                    const rgb = Utils.hexToRgb(over.bgColor);
                                    r=rgb.r; g=rgb.g; b=rgb.b;
                                    // Hex alpha not supported by Utils.hexToRgb currently
                                } else {
                                    // Parse rgba()
                                    const match = over.bgColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                                    if (match) {
                                        r = parseInt(match[1]);
                                        g = parseInt(match[2]);
                                        b = parseInt(match[3]);
                                        if (match[4]) a = Math.floor(parseFloat(match[4]) * 255);
                                    }
                                }
                            }
                            
                            const color = Utils.packAbgr(r, g, b, a);
                            this.grid.setSolidOverride(i, color, a / 255.0);
                            
                        } else {
                            // Char Override
                            let color = 0xFFFFFFFF; 
                            if (over.color) {
                                 const rgb = Utils.hexToRgb(over.color);
                                 // Alpha from property
                                 const a = over.alpha !== undefined ? over.alpha * 255 : 255;
                                 color = Utils.packAbgr(rgb.r, rgb.g, rgb.b, a);
                            }
                            
                            let fontIdx = 0;
                            if (over.font) {
                                 const activeFonts = this.config.derived.activeFonts;
                                 const idx = activeFonts.findIndex(f => f.name === over.font);
                                 if (idx !== -1) fontIdx = idx;
                            }

                            this.grid.setOverride(i, over.char, color, over.alpha || 1.0, fontIdx, over.glow || 0);
                        }
                    }
                };

                if (indices) {
                    for (const idx of indices) apply(idx);
                } else {
                    const total = this.grid.cols * this.grid.rows;
                    for (let i = 0; i < total; i++) apply(i);
                }
            }
            
            render(ctx, derived) {
                const cw = derived.cellWidth;
                const ch = derived.cellHeight;
                
                ctx.save();
                // ctx.translate(-cw, -ch); // Removed: Grid now starts at 0,0 (Snap-to-Fit Refactor)
                
                this.effects.forEach(e => {
                    if (e.active && typeof e.render === 'function') {
                        e.render(ctx, derived);
                    }
                });
                
                ctx.restore();
            }
        }

        class AbstractEffect {
            constructor(g, c) { this.g = g; this.c = c; this.name = "Base"; this.active = false; }
            trigger() { return false; }
            update() {}
            getActiveIndices() { return new Set(); }
        }

