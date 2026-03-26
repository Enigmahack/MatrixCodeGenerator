const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadEffects } = require('./harness');

describe('Effects', () => {
    let ctx;

    it('loads Effects stack into VM', () => {
        ctx = loadEffects();
        assert.ok(ctx.AbstractEffect, 'AbstractEffect should be defined');
        assert.ok(ctx.EffectRegistry, 'EffectRegistry should be defined');
    });

    describe('AbstractEffect', () => {
        it('constructs with mock params', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            assert.ok(fx);
        });

        it('has default state', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            assert.strictEqual(fx.active, false);
            assert.strictEqual(fx.name, 'Base');
            assert.strictEqual(fx.enabledKey, null);
            assert.strictEqual(fx.frequencyKey, null);
            assert.strictEqual(fx.shaderSlot, null);
        });

        it('trigger() returns false (base impl)', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            assert.strictEqual(fx.trigger(), false);
        });

        it('stop() sets active=false', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            fx.active = true;
            fx.stop();
            assert.strictEqual(fx.active, false);
        });

        it('getActiveIndices() returns empty Set', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            const indices = fx.getActiveIndices();
            assert.ok(indices instanceof Set);
            assert.strictEqual(indices.size, 0);
        });

        it('update() and preallocate() do not throw', () => {
            const fx = new ctx.AbstractEffect(null, null, null);
            fx.update();
            fx.preallocate();
        });
    });

    describe('EffectRegistry', () => {
        function makeRegistry() {
            const config = new ctx.ConfigurationManager();
            const grid = new ctx.CellGrid({ derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } });
            grid.resize(100, 100);
            return new ctx.EffectRegistry(grid, config);
        }

        it('constructs', () => {
            const reg = makeRegistry();
            assert.ok(reg);
            assert.ok(Array.isArray(reg.effects));
            assert.strictEqual(reg.effects.length, 0);
        });

        it('register() adds effect', () => {
            const reg = makeRegistry();
            const fx = new ctx.AbstractEffect(null, null, reg);
            fx.name = 'TestEffect';
            reg.register(fx);
            assert.strictEqual(reg.effects.length, 1);
        });

        it('get() retrieves by name', () => {
            const reg = makeRegistry();
            const fx = new ctx.AbstractEffect(null, null, reg);
            fx.name = 'TestEffect';
            reg.register(fx);
            assert.strictEqual(reg.get('TestEffect'), fx);
        });

        it('get() returns undefined for unknown name', () => {
            const reg = makeRegistry();
            assert.strictEqual(reg.get('NoSuchEffect'), undefined);
        });

        it('getActiveEffects() returns only active', () => {
            const reg = makeRegistry();
            const fx1 = new ctx.AbstractEffect(null, null, reg);
            fx1.name = 'A'; fx1.active = true;
            const fx2 = new ctx.AbstractEffect(null, null, reg);
            fx2.name = 'B'; fx2.active = false;
            reg.register(fx1);
            reg.register(fx2);
            const active = reg.getActiveEffects();
            assert.strictEqual(active.length, 1);
            assert.strictEqual(active[0].name, 'A');
        });

        it('requestShaderSlot allocates up to 4 slots', () => {
            const reg = makeRegistry();
            const effects = [];
            for (let i = 0; i < 4; i++) {
                const fx = new ctx.AbstractEffect(null, null, reg);
                fx.name = `FX${i}`;
                effects.push(fx);
                const slot = reg.requestShaderSlot(fx, `void main() { /* ${i} */ }`, 0.5);
                assert.ok(slot, `Slot ${i} should be allocated`);
                assert.strictEqual(slot.owner, fx);
            }
            // All 4 slots taken, 5th should steal via rotation
            const fx5 = new ctx.AbstractEffect(null, null, reg);
            fx5.name = 'FX_extra';
            const slot5 = reg.requestShaderSlot(fx5, 'void main() {}', 0.5);
            assert.ok(slot5, 'Should still return a slot (stolen)');
            assert.strictEqual(slot5.owner, fx5);
        });

        it('releaseShaderSlot frees slot', () => {
            const reg = makeRegistry();
            const fx = new ctx.AbstractEffect(null, null, reg);
            fx.name = 'ReleaseFX';
            const slot = reg.requestShaderSlot(fx, 'void main() {}');
            assert.strictEqual(slot.owner, fx);
            reg.releaseShaderSlot(fx);
            assert.strictEqual(slot.owner, null);
        });

        it('has 4 shader slots', () => {
            const reg = makeRegistry();
            assert.strictEqual(reg.shaderSlots.length, 4);
        });
    });
});
