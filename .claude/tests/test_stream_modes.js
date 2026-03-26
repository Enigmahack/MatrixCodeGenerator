const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFiles } = require('./harness');

describe('StreamModes', () => {
    let ctx;

    it('loads StreamModes into VM', () => {
        ctx = loadFiles([
            'js/core/Utils.js',
            'js/simulation/StreamModes.js'
        ]);
        assert.ok(ctx.StreamMode, 'StreamMode should be defined');
        assert.ok(ctx.StandardMode, 'StandardMode should be defined');
        assert.ok(ctx.StarPowerMode, 'StarPowerMode should be defined');
        assert.ok(ctx.RainbowMode, 'RainbowMode should be defined');
    });

    describe('StreamMode base', () => {
        it('constructs with config', () => {
            const mode = new ctx.StreamMode({ some: 'config' });
            assert.ok(mode.config);
        });

        it('style() returns null by default', () => {
            const mode = new ctx.StreamMode({});
            assert.strictEqual(mode.style({}, 0, {}), null);
        });
    });

    describe('StandardMode', () => {
        it('inherits from StreamMode', () => {
            const mode = new ctx.StandardMode({});
            assert.ok(mode instanceof ctx.StreamMode);
        });

        it('style() returns null', () => {
            const mode = new ctx.StandardMode({});
            assert.strictEqual(mode.style({}, 0, {}), null);
        });
    });

    describe('StarPowerMode', () => {
        it('inherits from StreamMode', () => {
            const mode = new ctx.StarPowerMode({});
            assert.ok(mode instanceof ctx.StreamMode);
        });

        it('spawn sets baseHue on stream', () => {
            const mode = new ctx.StarPowerMode({});
            const stream = {};
            mode.spawn(stream);
            assert.ok(typeof stream.baseHue === 'number');
            assert.ok(stream.baseHue >= 0 && stream.baseHue <= 360);
        });

        it('style() returns object with expected shape (char mode)', () => {
            const mode = new ctx.StarPowerMode({});
            const stream = { x: 5, baseHue: 180 };
            const state = {
                starPowerRainbowMode: 'char',
                starPowerSaturation: 100,
                starPowerIntensity: 50,
                starPowerColorCycle: false,
                starPowerCycleSpeed: 1
            };
            const style = mode.style(stream, 100, state);
            assert.ok(style);
            assert.ok('h' in style);
            assert.ok('s' in style);
            assert.ok('l' in style);
            assert.ok('isEffect' in style);
            assert.strictEqual(style.isEffect, true);
        });

        it('style() returns object with expected shape (stream mode)', () => {
            const mode = new ctx.StarPowerMode({});
            const stream = { x: 5, baseHue: 90 };
            const state = {
                starPowerRainbowMode: 'stream',
                starPowerSaturation: 80,
                starPowerIntensity: 60,
                starPowerColorCycle: true,
                starPowerCycleSpeed: 2
            };
            const style = mode.style(stream, 50, state);
            assert.ok(style);
            assert.strictEqual(style.s, 80);
            assert.strictEqual(style.l, 60);
            assert.strictEqual(style.cycle, true);
            assert.strictEqual(style.speed, 2);
            assert.strictEqual(style.type, 'star_glimmer');
        });
    });

    describe('RainbowMode', () => {
        it('inherits from StreamMode', () => {
            const mode = new ctx.RainbowMode({});
            assert.ok(mode instanceof ctx.StreamMode);
        });

        it('spawn sets baseHue on stream', () => {
            const mode = new ctx.RainbowMode({});
            const stream = {};
            mode.spawn(stream);
            assert.ok(typeof stream.baseHue === 'number');
        });

        it('style() returns hue-based style', () => {
            const mode = new ctx.RainbowMode({});
            const stream = { baseHue: 120 };
            const state = { rainbowStreamIntensity: 50 };
            const style = mode.style(stream, 0, state);
            assert.ok(style);
            assert.strictEqual(style.h, 120);
            assert.strictEqual(style.s, 100);
            assert.strictEqual(style.l, 50);
            assert.strictEqual(style.isEffect, true);
            assert.strictEqual(style.cycle, false);
        });
    });
});
