class EffectRegistry {
            constructor(grid, config) { this.grid = grid; this.config = config; this.effects = []; }
            register(effect) { this.effects.push(effect); }
            trigger(name) { const fx = this.effects.find(e => e.name === name); if(fx) return fx.trigger(); return false; }
            update() { this.effects.forEach(e => e.update()); }
            getOverride(i) { for(const fx of this.effects) { const o = fx.getOverride(i); if(o) return o; } return null; }
            hasActiveEffects() { return this.effects.some(e => e.active); }

            getActiveIndices() {
                if (!this.hasActiveEffects()) return new Set();
                const combined = new Set();
                for (const fx of this.effects) {
                    if (fx.active) {
                        const indices = fx.getActiveIndices();
                        if (indices === null) return null;
                        for (const idx of indices) combined.add(idx);
                    }
                }
                return combined;
            }
        }

        class AbstractEffect {
            constructor(g, c) { this.g = g; this.c = c; this.name = "Base"; }
            trigger() { return false; }
            update() {}
            getOverride(i) { return null; }
            getActiveIndices() { return null; }
        }
