// =========================================================================
// EFFECT REGISTRY
// =========================================================================

class EffectRegistry {
            constructor(grid, config) { 
                this.grid = grid; 
                this.config = config; 
                this.effects = []; 
            }
            register(effect) { this.effects.push(effect); }
            registerDefaults() {
                // ... (Load dynamically or manually)
            }
            get(name) { return this.effects.find(e => e.name === name); }
            trigger(name, ...args) { const fx = this.effects.find(e => e.name === name); if(fx) return fx.trigger(...args); return false; }
            
            update() { 
                this.grid.clearAllOverrides();
                this.grid.clearAllEffects();
                this.effects.forEach(e => {
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

