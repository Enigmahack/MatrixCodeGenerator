// =========================================================================
// EFFECT REGISTRY
// =========================================================================

class EffectRegistry {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.effects = [];
        this._managedTimers = new Map();

        // Shader Slot Orchestrator
        this.shaderSlots = [
            { id: 'effectShader1', content: 'effectShader1Content', param: 'effect1Parameter', enabled: 'effectShader1Enabled', name: 'effectShader1Name', owner: null },
            { id: 'effectShader2', content: 'effectShader2Content', param: 'effect2Parameter', enabled: 'effectShader2Enabled', name: 'effectShader2Name', owner: null },
            { id: 'totalFX1', content: 'totalFX1ShaderContent', param: 'totalFX1Parameter', enabled: 'totalFX1Enabled', name: 'totalFX1Name', owner: null },
            { id: 'totalFX2', content: 'totalFX2ShaderContent', param: 'totalFX2Parameter', enabled: 'totalFX2Enabled', name: 'totalFX2Name', owner: null }
        ];
    }

    /**
     * Requests a shader slot for an effect.
     * @param {AbstractEffect} effect - The effect requesting the slot.
     * @param {string} source - GLSL shader source.
     * @param {number} parameter - Parameter value (0.0 - 1.0).
     * @returns {Object|null} The assigned slot or null if none available.
     */
    requestShaderSlot(effect, source, parameter = 0.5) {
        // 1. Check if already has a slot
        let slot = this.shaderSlots.find(s => s.owner === effect);
        
        if (!slot) {
            // 2. Find an empty slot
            slot = this.shaderSlots.find(s => s.owner === null);
            
            if (!slot) {
                // 3. Rotation: Steal a slot if all are full
                this._slotRotationCounter = (this._slotRotationCounter || 0) % this.shaderSlots.length;
                slot = this.shaderSlots[this._slotRotationCounter];
                
                // Clear old owner's reference
                if (slot.owner) {
                    slot.owner.shaderSlot = null;
                }
                
                this._slotRotationCounter++;
            }
        }

        slot.owner = effect;
        this.config.set(slot.content, source);
        this.config.set(slot.param, parameter);
        this.config.set(slot.enabled, true);
        this.config.set(slot.name, `FX: ${effect.name}`);
        
        return slot;
    }

    /**
     * Releases a shader slot held by an effect.
     * @param {AbstractEffect} effect - The effect releasing the slot.
     */
    releaseShaderSlot(effect) {
        const slot = this.shaderSlots.find(s => s.owner === effect);
        if (slot) {
            this.config.set(slot.content, null);
            this.config.set(slot.enabled, false);
            this.config.set(slot.name, 'none');
            slot.owner = null;
        }
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
                    // All effects now receive the registry for shader slot orchestration
                    const fx = new EffectClass(this.grid, this.config, this);

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
        });
    }

    /**
     * Final visual application pass. 
     * Executed AFTER simulation to ensure effects can mask simulation activity.
     */
    postUpdate() {
        const isEditorActive = this._isEditorActive();
        const editedEffect = this._getEditedEffect();

        this.effects.forEach(e => {
            if (!e.active) return;
            if (isEditorActive && e !== editedEffect) return;

            // Lifecycle 3: Apply to Grid
            if (typeof e.applyToGrid === 'function') {
                this.grid.overrideOwner = e;
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
    constructor(g, c, r) {
        this.g = g;
        this.c = c;
        this.r = r; // Registry for orchestrating shader slots
        this.name = "Base";
        this.active = false;
        this.enabledKey = null;   // Config key for "Enabled" toggle
        this.frequencyKey = null; // Config key for "FrequencySeconds" range
        this.shaderSlot = null;   // Reference to the currently assigned shader slot
    }
    trigger() { return false; }
    update() { }
    getActiveIndices() { return new Set(); }
}

