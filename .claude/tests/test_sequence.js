const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFiles } = require('./harness');

describe('QuantizedSequence', () => {
    let ctx;

    it('loads QuantizedSequence into VM', () => {
        ctx = loadFiles([
            'js/core/Utils.js',
            'js/config/ConfigurationManager.js',
            'js/data/CellGrid.js',
            'js/effects/EffectRegistry.js',
            'js/effects/QuantizedBaseEffect.js',
            'js/effects/QuantizedSequence.js'
        ]);
        assert.ok(ctx.QuantizedSequence, 'QuantizedSequence should be defined');
    });

    describe('OPS constants', () => {
        it('has expected operation codes', () => {
            const seq = new ctx.QuantizedSequence();
            assert.strictEqual(seq.OPS.ADD, 1);
            assert.strictEqual(seq.OPS.REM, 2);
            assert.strictEqual(seq.OPS.RECT, 3);
            assert.strictEqual(seq.OPS.SMART, 6);
            assert.strictEqual(seq.OPS.REM_BLOCK, 7);
            assert.strictEqual(seq.OPS.ADD_L, 8);
            assert.strictEqual(seq.OPS.RECT_L, 9);
            assert.strictEqual(seq.OPS.SMART_L, 10);
            assert.strictEqual(seq.OPS.REM_L, 11);
            assert.strictEqual(seq.OPS.NUDGE, 12);
            assert.strictEqual(seq.OPS.NUDGE_ML, 13);
            assert.strictEqual(seq.OPS.GROUP, 99);
        });
    });

    describe('FACES bitmask', () => {
        it('has expected face values', () => {
            const seq = new ctx.QuantizedSequence();
            assert.strictEqual(seq.FACES['N'], 1);
            assert.strictEqual(seq.FACES['S'], 2);
            assert.strictEqual(seq.FACES['E'], 4);
            assert.strictEqual(seq.FACES['W'], 8);
        });

        it('FACES_INV is the inverse', () => {
            const seq = new ctx.QuantizedSequence();
            assert.strictEqual(seq.FACES_INV[1], 'N');
            assert.strictEqual(seq.FACES_INV[2], 'S');
            assert.strictEqual(seq.FACES_INV[4], 'E');
            assert.strictEqual(seq.FACES_INV[8], 'W');
        });

        it('faces can be combined as bitmask', () => {
            const seq = new ctx.QuantizedSequence();
            const northSouth = seq.FACES['N'] | seq.FACES['S'];
            assert.strictEqual(northSouth, 3);
            const all = seq.FACES['N'] | seq.FACES['S'] | seq.FACES['E'] | seq.FACES['W'];
            assert.strictEqual(all, 15);
        });
    });

    describe('OPS_INV', () => {
        it('maps codes back to names', () => {
            const seq = new ctx.QuantizedSequence();
            assert.strictEqual(seq.OPS_INV[1], 'add');
            assert.strictEqual(seq.OPS_INV[2], 'rem');
            assert.strictEqual(seq.OPS_INV[3], 'rect');
            assert.strictEqual(seq.OPS_INV[99], 'group');
        });

        it('layered ops use "Layered" suffix', () => {
            const seq = new ctx.QuantizedSequence();
            assert.strictEqual(seq.OPS_INV[8], 'addLayered');
            assert.strictEqual(seq.OPS_INV[9], 'rectLayered');
            assert.strictEqual(seq.OPS_INV[10], 'smartLayered');
            assert.strictEqual(seq.OPS_INV[11], 'remLayered');
        });
    });

    describe('executeStepOps', () => {
        it('does not throw with null step', () => {
            const seq = new ctx.QuantizedSequence();
            // Should silently return
            seq.executeStepOps({}, null, 0);
        });

        it('does not throw with missing logicGridW', () => {
            const seq = new ctx.QuantizedSequence();
            seq.executeStepOps({}, { ops: [[1, 0, 0]] }, 0);
        });
    });
});
