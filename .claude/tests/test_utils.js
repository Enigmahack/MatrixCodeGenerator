const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadUtils, normalize } = require('./harness');

describe('Utils', () => {
    let ctx;

    // Fresh context for all tests in this suite
    it('loads Utils into VM', () => {
        ctx = loadUtils();
        assert.ok(ctx.Utils, 'Utils should be defined');
    });

    describe('hexToRgb', () => {
        it('parses 6-digit hex with #', () => {
            const c = ctx.Utils.hexToRgb('#FF0000');
            assert.deepStrictEqual(normalize(c), { r: 255, g: 0, b: 0 });
        });

        it('parses 6-digit hex without #', () => {
            const c = ctx.Utils.hexToRgb('00FF00');
            assert.deepStrictEqual(normalize(c), { r: 0, g: 255, b: 0 });
        });

        it('parses lowercase hex', () => {
            const c = ctx.Utils.hexToRgb('#0000ff');
            assert.deepStrictEqual(normalize(c), { r: 0, g: 0, b: 255 });
        });

        it('parses rgb() string', () => {
            const c = ctx.Utils.hexToRgb('rgb(128, 64, 32)');
            assert.deepStrictEqual(normalize(c), { r: 128, g: 64, b: 32 });
        });

        it('parses rgba() string', () => {
            const c = ctx.Utils.hexToRgb('rgba(10, 20, 30, 0.5)');
            assert.deepStrictEqual(normalize(c), { r: 10, g: 20, b: 30 });
        });

        it('returns fallback green for invalid input', () => {
            const c = ctx.Utils.hexToRgb('not-a-color');
            assert.deepStrictEqual(normalize(c), { r: 0, g: 255, b: 0 });
        });

        it('returns fallback green for non-string', () => {
            const c = ctx.Utils.hexToRgb(42);
            assert.deepStrictEqual(normalize(c), { r: 0, g: 255, b: 0 });
        });

        it('returns fallback green for null', () => {
            const c = ctx.Utils.hexToRgb(null);
            assert.deepStrictEqual(normalize(c), { r: 0, g: 255, b: 0 });
        });
    });

    describe('packRgb / unpackRgb', () => {
        it('round-trips pure red', () => {
            const packed = ctx.Utils.packRgb(255, 0, 0);
            const unpacked = ctx.Utils.unpackRgb(packed);
            assert.deepStrictEqual(normalize(unpacked), { r: 255, g: 0, b: 0 });
        });

        it('round-trips pure green', () => {
            const packed = ctx.Utils.packRgb(0, 255, 0);
            const unpacked = ctx.Utils.unpackRgb(packed);
            assert.deepStrictEqual(normalize(unpacked), { r: 0, g: 255, b: 0 });
        });

        it('round-trips pure blue', () => {
            const packed = ctx.Utils.packRgb(0, 0, 255);
            const unpacked = ctx.Utils.unpackRgb(packed);
            assert.deepStrictEqual(normalize(unpacked), { r: 0, g: 0, b: 255 });
        });

        it('round-trips arbitrary color', () => {
            const packed = ctx.Utils.packRgb(123, 45, 67);
            const unpacked = ctx.Utils.unpackRgb(packed);
            assert.deepStrictEqual(normalize(unpacked), { r: 123, g: 45, b: 67 });
        });

        it('masks overflow values to 8-bit', () => {
            const packed = ctx.Utils.packRgb(256, -1, 300);
            const unpacked = ctx.Utils.unpackRgb(packed);
            // 256 & 0xFF = 0, -1 & 0xFF = 255, 300 & 0xFF = 44
            assert.deepStrictEqual(normalize(unpacked), { r: 0, g: 255, b: 44 });
        });
    });

    describe('packAbgr', () => {
        it('packs with default alpha', () => {
            const val = ctx.Utils.packAbgr(255, 0, 0);
            // Expected: (255 << 24) | (0 << 16) | (0 << 8) | 255
            // In unsigned: 0xFF0000FF
            assert.strictEqual(val >>> 0, 0xFF0000FF);
        });

        it('packs with custom alpha', () => {
            const val = ctx.Utils.packAbgr(0, 255, 0, 128);
            // (128 << 24) | (0 << 16) | (255 << 8) | 0
            assert.strictEqual(val >>> 0, 0x8000FF00);
        });
    });

    describe('hslToRgb', () => {
        it('converts red (0, 100, 50)', () => {
            const c = ctx.Utils.hslToRgb(0, 100, 50);
            assert.deepStrictEqual(normalize(c), { r: 255, g: 0, b: 0 });
        });

        it('converts green (120, 100, 50)', () => {
            const c = ctx.Utils.hslToRgb(120, 100, 50);
            assert.deepStrictEqual(normalize(c), { r: 0, g: 255, b: 0 });
        });

        it('converts blue (240, 100, 50)', () => {
            const c = ctx.Utils.hslToRgb(240, 100, 50);
            assert.deepStrictEqual(normalize(c), { r: 0, g: 0, b: 255 });
        });

        it('converts white (0, 0, 100)', () => {
            const c = ctx.Utils.hslToRgb(0, 0, 100);
            assert.deepStrictEqual(normalize(c), { r: 255, g: 255, b: 255 });
        });

        it('converts black (0, 0, 0)', () => {
            const c = ctx.Utils.hslToRgb(0, 0, 0);
            assert.deepStrictEqual(normalize(c), { r: 0, g: 0, b: 0 });
        });

        it('converts grey (0, 0, 50) — zero saturation', () => {
            const c = ctx.Utils.hslToRgb(0, 0, 50);
            assert.deepStrictEqual(normalize(c), { r: 128, g: 128, b: 128 });
        });
    });

    describe('calculateCharBrightness', () => {
        it('returns a number in [varianceMin, 1.0]', () => {
            const min = 0.3;
            for (let i = 0; i < 100; i++) {
                const b = ctx.Utils.calculateCharBrightness(i, i % 256, min);
                assert.ok(b >= min - 0.001, `brightness ${b} below min ${min}`);
                assert.ok(b <= 1.001, `brightness ${b} above 1.0`);
            }
        });

        it('is deterministic for same inputs', () => {
            const a = ctx.Utils.calculateCharBrightness(65, 42, 0.5);
            const b = ctx.Utils.calculateCharBrightness(65, 42, 0.5);
            assert.strictEqual(a, b);
        });

        it('varies with different charCode', () => {
            const a = ctx.Utils.calculateCharBrightness(65, 42, 0.0);
            const b = ctx.Utils.calculateCharBrightness(66, 42, 0.0);
            // Unlikely to be exactly equal with different inputs
            assert.notStrictEqual(a, b);
        });
    });

    describe('createRGBString', () => {
        it('creates correct format', () => {
            const s = ctx.Utils.createRGBString({ r: 255, g: 128, b: 0 });
            assert.strictEqual(s, 'rgb(255,128,0)');
        });
    });

    describe('CELL_TYPE / CELL_FLAGS', () => {
        it('has expected CELL_TYPE values', () => {
            assert.strictEqual(ctx.Utils.CELL_TYPE.EMPTY, 0);
            assert.strictEqual(ctx.Utils.CELL_TYPE.TRAIL, 1);
            assert.strictEqual(ctx.Utils.CELL_TYPE.TRACER, 2);
            assert.strictEqual(ctx.Utils.CELL_TYPE.ROTATOR, 3);
            assert.strictEqual(ctx.Utils.CELL_TYPE.UPWARD_TRACER, 4);
        });

        it('has CELL_TYPE_MASK', () => {
            assert.strictEqual(ctx.Utils.CELL_TYPE_MASK, 0x7F);
        });

        it('has CELL_FLAGS.GRADUAL', () => {
            assert.strictEqual(ctx.Utils.CELL_FLAGS.GRADUAL, 0x80);
        });
    });

    describe('shuffle', () => {
        it('preserves array length', () => {
            const arr = [1, 2, 3, 4, 5];
            const result = ctx.Utils.shuffle([...arr]);
            assert.strictEqual(result.length, arr.length);
        });

        it('preserves all elements', () => {
            const arr = [10, 20, 30, 40, 50];
            const result = ctx.Utils.shuffle([...arr]);
            assert.deepStrictEqual([...result].sort((a, b) => a - b), arr);
        });

        it('returns the same array reference (in-place)', () => {
            const arr = [1, 2, 3];
            const result = ctx.Utils.shuffle(arr);
            assert.strictEqual(result, arr);
        });
    });

    describe('CHARS / KATAKANA_CHARS', () => {
        it('CHARS is a non-empty string', () => {
            assert.ok(typeof ctx.Utils.CHARS === 'string');
            assert.ok(ctx.Utils.CHARS.length > 10);
        });

        it('KATAKANA_CHARS is a non-empty string', () => {
            assert.ok(typeof ctx.Utils.KATAKANA_CHARS === 'string');
            assert.ok(ctx.Utils.KATAKANA_CHARS.length > 5);
        });
    });

    describe('APP_VERSION', () => {
        it('is defined as "8.5"', () => {
            assert.strictEqual(ctx.APP_VERSION, '8.5');
        });
    });
});
