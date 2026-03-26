const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadEffects, loadFiles } = require('./harness');

describe('API Contracts', () => {
    describe('Utils API', () => {
        let ctx;
        it('loads', () => { ctx = loadFiles(['js/core/Utils.js']); });

        it('Utils has expected methods', () => {
            const methods = [
                'randomInt', 'randomFloat', 'hexToRgb', 'packRgb', 'unpackRgb',
                'packAbgr', 'hslToRgb', 'calculateCharBrightness', 'createRGBString',
                'getRandomChar', 'getRandomKatakanaChar', 'getUniqueChar',
                'shuffle', 'generateGlyphSVG', 'downloadJson'
            ];
            for (const m of methods) {
                assert.ok(typeof ctx.Utils[m] === 'function', `Utils.${m} should be a function`);
            }
        });

        it('Utils has expected constants', () => {
            assert.ok(ctx.Utils.CELL_TYPE, 'CELL_TYPE');
            assert.ok(ctx.Utils.CELL_FLAGS, 'CELL_FLAGS');
            assert.ok(typeof ctx.Utils.CELL_TYPE_MASK === 'number', 'CELL_TYPE_MASK');
            assert.ok(typeof ctx.Utils.CHARS === 'string', 'CHARS');
            assert.ok(typeof ctx.Utils.KATAKANA_CHARS === 'string', 'KATAKANA_CHARS');
        });
    });

    describe('CellGrid API', () => {
        let ctx;
        it('loads', () => {
            ctx = loadFiles(['js/core/Utils.js', 'js/data/CellGrid.js']);
        });

        it('CellGrid.prototype has expected methods', () => {
            const methods = [
                'copyFrom', 'resize', 'getIndex',
                'setPrimary', 'setSecondary', 'setOverride', 'setSolidOverride',
                'setEffectOverride', 'setEffectOverlay', 'setEffectShadow', 'setHighPriorityEffect',
                'clearCell', 'clearOverride', 'clearAllOverrides',
                'clearEffectOverride', 'clearAllEffects',
                'setRotatorTarget', 'getRotatorTarget', 'getChar', 'getState'
            ];
            for (const m of methods) {
                assert.ok(typeof ctx.CellGrid.prototype[m] === 'function', `CellGrid.${m} should be a function`);
            }
        });
    });

    describe('ConfigurationManager API', () => {
        let ctx;
        it('loads', () => {
            ctx = loadFiles(['js/core/Utils.js', 'js/config/ConfigurationManager.js']);
        });

        it('ConfigurationManager.prototype has expected methods', () => {
            const methods = ['get', 'set', 'subscribe', 'notify'];
            for (const m of methods) {
                assert.ok(typeof ctx.ConfigurationManager.prototype[m] === 'function', `ConfigurationManager.${m} should be a function`);
            }
        });
    });

    describe('EffectRegistry API', () => {
        let ctx;
        it('loads', () => { ctx = loadEffects(); });

        it('EffectRegistry.prototype has expected methods', () => {
            const methods = [
                'register', 'get', 'trigger', 'getActiveEffects',
                'requestShaderSlot', 'releaseShaderSlot',
                'update', 'postUpdate', 'preallocateAll', 'render',
                'setGrid', 'setRenderer', 'isQuantizedActive'
            ];
            for (const m of methods) {
                assert.ok(typeof ctx.EffectRegistry.prototype[m] === 'function', `EffectRegistry.${m} should be a function`);
            }
        });

        it('AbstractEffect.prototype has expected methods', () => {
            const methods = ['trigger', 'stop', 'update', 'preallocate', 'getActiveIndices'];
            for (const m of methods) {
                assert.ok(typeof ctx.AbstractEffect.prototype[m] === 'function', `AbstractEffect.${m} should be a function`);
            }
        });
    });

    describe('StreamModes API', () => {
        let ctx;
        it('loads', () => {
            ctx = loadFiles(['js/core/Utils.js', 'js/simulation/StreamModes.js']);
        });

        it('all mode classes exist', () => {
            assert.ok(ctx.StreamMode);
            assert.ok(ctx.StandardMode);
            assert.ok(ctx.StarPowerMode);
            assert.ok(ctx.RainbowMode);
        });

        it('mode classes have style/spawn methods', () => {
            for (const Cls of [ctx.StreamMode, ctx.StandardMode, ctx.StarPowerMode, ctx.RainbowMode]) {
                assert.ok(typeof Cls.prototype.style === 'function', `${Cls.name || 'Mode'}.style`);
                assert.ok(typeof Cls.prototype.spawn === 'function', `${Cls.name || 'Mode'}.spawn`);
            }
        });
    });

    describe('Quantized Effect Classes', () => {
        let ctx;
        it('loads full effects stack', () => {
            ctx = loadFiles([
                'js/core/Utils.js',
                'js/config/ConfigurationManager.js',
                'js/data/CellGrid.js',
                'js/effects/EffectRegistry.js',
                'js/effects/QuantizedBaseEffect.js',
                'js/effects/QuantizedProceduralEngine.js',
                'js/effects/QuantizedSequence.js',
                'js/effects/QuantizedSequenceGeneratorV2.js',
                'js/effects/QuantizedPulseEffect.js',
                'js/effects/QuantizedAddEffect.js',
                'js/effects/QuantizedRetractEffect.js',
                'js/effects/QuantizedClimbEffect.js',
                'js/effects/QuantizedZoomEffect.js',
                'js/effects/QuantizedBlockGeneration.js'
            ]);
        });

        it('QuantizedBaseEffect exists', () => {
            assert.ok(ctx.QuantizedBaseEffect);
        });

        it('QuantizedPulseEffect exists and extends chain', () => {
            assert.ok(ctx.QuantizedPulseEffect);
        });

        it('QuantizedAddEffect exists', () => {
            assert.ok(ctx.QuantizedAddEffect);
        });

        it('QuantizedRetractEffect exists', () => {
            assert.ok(ctx.QuantizedRetractEffect);
        });

        it('QuantizedClimbEffect exists', () => {
            assert.ok(ctx.QuantizedClimbEffect);
        });

        it('QuantizedZoomEffect exists', () => {
            assert.ok(ctx.QuantizedZoomEffect);
        });

        it('QuantizedBlockGeneration exists', () => {
            assert.ok(ctx.QuantizedBlockGeneration);
        });

        it('QuantizedSequence exists', () => {
            assert.ok(ctx.QuantizedSequence);
        });
    });
});
