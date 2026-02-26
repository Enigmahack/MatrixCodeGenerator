// =========================================================================
// EFFECT REGISTRY
// =========================================================================

class EffectRegistry {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.effects = [];
        this._managedTimers = new Map();
    }

    setGrid(grid) {
        this.grid = grid;
        this.effects.forEach(e => { if (e.g !== undefined) e.g = grid; });
    }

    register(effect) {
        this.effects.push(effect);
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
                    let fx;
                    if (EffectClass === CrashEffect || EffectClass === BootEffect) {
                        fx = new EffectClass(this.grid, this.config, this);
                    } else {
                        fx = new EffectClass(this.grid, this.config);
                    }

                    // Discover configuration keys for automated triggering
                    const prefix = this._discoverPrefix(template, def.action);
                    if (prefix) {
                        fx.enabledKey = prefix + "Enabled";
                        fx.frequencyKey = prefix + "FrequencySeconds";
                    }

                    this.register(fx);
                    registeredActions.add(def.action);
                }
            }
        });

        if (this.config.state.logErrors) {
            console.log(`[EffectRegistry] Auto-registered ${registeredActions.size} effects from template.`);
        }
    }

    /**
     * Heuristic to find the configuration prefix for an effect action.
     * @private
     */
    _discoverPrefix(template, action) {
        // Look for the Enable key that co-exists with this action in the template
        // Usually they are in the same block/accordion.
        const buttonIdx = template.findIndex(d => d.type === 'button' && d.action === action);
        if (buttonIdx === -1) return null;

        // Search neighboring entries for an ID ending in "Enabled"
        // Expanded range to handle larger effect blocks (like Crash)
        for (let i = Math.max(0, buttonIdx - 10); i < Math.min(template.length, buttonIdx + 10); i++) {
            const def = template[i];
            if (def.id && def.id.endsWith('Enabled')) {
                const prefix = def.id.replace('Enabled', '');
                
                // Verify that a Frequency key also exists for this prefix
                const hasFreq = template.some(d => d.id === prefix + "FrequencySeconds");
                if (hasFreq) {
                    return prefix;
                }
            }
        }
        return null;
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
            // When triggered, we don't necessarily reset the auto-timer 
            // because the user might want frequent pulses.
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
            // Lifecycle 1: Automated Triggering Logic
            this._updateAutoTrigger(e, isEditorActive);

            // Lifecycle 2: Update Simulation
            // If editor is active, only allow the currently edited effect to update
            if (isEditorActive && e !== editedEffect) {
                return;
            }

            e.update();
            if (!e.active) return;

            // Lifecycle 3: Apply to Grid
            if (typeof e.applyToGrid === 'function') {
                e.applyToGrid(this.grid);
            } else if (typeof e.getOverride === 'function') {
                this._applyLegacyOverride(e);
            }
        });
    }

    /**
     * Manages the countdown and triggering of an effect if configured for automation.
     * @private
     */
    _updateAutoTrigger(fx, isEditorActive) {
        if (!fx.enabledKey || !fx.frequencyKey) return;
        
        const isEnabled = this.config.get(fx.enabledKey);
        if (!isEnabled) {
            this._managedTimers.delete(fx.name);
            return;
        }

        // Initialize timer if missing
        if (!this._managedTimers.has(fx.name)) {
            this._resetTimer(fx);
        }

        // Only count down if NOT in editor
        if (!isEditorActive) {
            let timer = this._managedTimers.get(fx.name);
            timer--;
            
            if (timer <= 0) {
                this.trigger(fx.name);
                this._resetTimer(fx);
            } else {
                this._managedTimers.set(fx.name, timer);
            }
        }
    }

    /**
     * Resets the timer for an automated effect with randomization.
     * @private
     */
    _resetTimer(fx) {
        let seconds = this.config.get(fx.frequencyKey);
        // Handle "Random" (500s) special case
        if (seconds === 500) {
            seconds = Utils.randomInt(50, 500);
        }
        
        const minFrames = seconds * 60;
        const randomOffset = Utils.randomInt(0, minFrames * 0.5); // Up to 50% random offset
        this._managedTimers.set(fx.name, minFrames + randomOffset);
    }

    _applyLegacyOverride(e) {
        const indices = e.getActiveIndices();

        const apply = (i) => {
            const over = e.getOverride(i);
            if (over) {
                if (over.solid) {
                    // Parse Color & Alpha
                    let r = 0, g = 0, b = 0, a = 255;
                    if (over.bgColor) {
                        // Try Hex first (Utils handles it)
                        if (over.bgColor.startsWith('#')) {
                            const rgb = Utils.hexToRgb(over.bgColor);
                            r = rgb.r; g = rgb.g; b = rgb.b;
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
    constructor(g, c) {
        this.g = g;
        this.c = c;
        this.name = "Base";
        this.active = false;
        this.enabledKey = null;   // Config key for "Enabled" toggle
        this.frequencyKey = null; // Config key for "FrequencySeconds" range
    }
    trigger() { return false; }
    update() { }
    getActiveIndices() { return new Set(); }
}

