const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFiles } = require('./harness');

describe('ConfigurationManager', () => {
    let ctx;

    it('loads ConfigurationManager into VM', () => {
        ctx = loadFiles([
            'js/core/Utils.js',
            'js/config/ConfigurationManager.js'
        ]);
        assert.ok(ctx.ConfigurationManager, 'ConfigurationManager should be defined');
    });

    describe('Construction & Defaults', () => {
        it('constructs without error', () => {
            const cm = new ctx.ConfigurationManager();
            assert.ok(cm);
            assert.ok(cm.state);
            assert.ok(cm.defaults);
        });

        it('has expected default keys', () => {
            const cm = new ctx.ConfigurationManager();
            const expectedKeys = [
                'streamColor', 'backgroundColor', 'streamPalette', 'brightness',
                'tracerColor', 'fontSize', 'streamSpeed', 'resolution',
                'showFpsCounter', 'debugEnabled', 'logErrors',
                'rotatorEnabled', 'rotatorChance', 'rotatorCycleFactor',
                'enableBloom', 'bloomStrength', 'bloomOpacity',
                'dissolveEnabled', 'deteriorationEnabled',
                'pulseEnabled', 'clearPulseEnabled',
                'quantizedPulseEnabled', 'quantizedAddEnabled',
                'activeQuantizedEffect'
            ];
            for (const key of expectedKeys) {
                assert.ok(key in cm.defaults, `Missing default: ${key}`);
            }
        });

        it('default types are correct', () => {
            const cm = new ctx.ConfigurationManager();
            assert.strictEqual(typeof cm.defaults.streamColor, 'string');
            assert.strictEqual(typeof cm.defaults.brightness, 'number');
            assert.strictEqual(typeof cm.defaults.fontSize, 'number');
            assert.strictEqual(typeof cm.defaults.showFpsCounter, 'boolean');
            assert.strictEqual(typeof cm.defaults.rotatorEnabled, 'boolean');
            assert.ok(Array.isArray(cm.defaults.streamPalette));
        });

        it('default values are sane', () => {
            const cm = new ctx.ConfigurationManager();
            assert.ok(cm.defaults.fontSize > 0, 'fontSize should be positive');
            assert.ok(cm.defaults.brightness >= 0 && cm.defaults.brightness <= 10, 'brightness should be 0-10');
            assert.ok(cm.defaults.streamSpeed > 0, 'streamSpeed should be positive');
            assert.ok(cm.defaults.resolution > 0, 'resolution should be positive');
        });
    });

    describe('get / set', () => {
        it('get returns default value', () => {
            const cm = new ctx.ConfigurationManager();
            assert.strictEqual(cm.get('fontSize'), cm.defaults.fontSize);
        });

        it('set changes the value', () => {
            const cm = new ctx.ConfigurationManager();
            cm.set('fontSize', 42);
            assert.strictEqual(cm.get('fontSize'), 42);
        });

        it('set with same value is a no-op', () => {
            const cm = new ctx.ConfigurationManager();
            let notified = false;
            cm.subscribe(() => { notified = true; });
            const original = cm.get('fontSize');
            cm.set('fontSize', original);
            assert.ok(!notified, 'Should not notify on no-change');
        });

        it('get returns undefined for unknown key', () => {
            const cm = new ctx.ConfigurationManager();
            assert.strictEqual(cm.get('nonExistentKey12345'), undefined);
        });
    });

    describe('subscribe / notify', () => {
        it('subscribe callback fires on set()', () => {
            const cm = new ctx.ConfigurationManager();
            let receivedKey = null;
            cm.subscribe((key) => { receivedKey = key; });
            cm.set('brightness', 0.5);
            assert.strictEqual(receivedKey, 'brightness');
        });

        it('multiple subscribers all fire', () => {
            const cm = new ctx.ConfigurationManager();
            let count = 0;
            cm.subscribe(() => { count++; });
            cm.subscribe(() => { count++; });
            cm.set('brightness', 0.7);
            assert.strictEqual(count, 2);
        });

        it('notify does not throw with no subscribers', () => {
            const cm = new ctx.ConfigurationManager();
            cm.subscribers = [];
            // Should not throw
            cm.notify('test');
        });
    });

    describe('SHARED_KEYS', () => {
        it('is a Set', () => {
            const cm = new ctx.ConfigurationManager();
            assert.ok(cm.SHARED_KEYS instanceof Set);
        });

        it('contains expected global keys', () => {
            const cm = new ctx.ConfigurationManager();
            const expected = [
                'showFpsCounter', 'debugEnabled', 'logErrors',
                'enableKeybinds', 'hideMenuIcon', 'activeQuantizedEffect'
            ];
            for (const key of expected) {
                assert.ok(cm.SHARED_KEYS.has(key), `SHARED_KEYS missing: ${key}`);
            }
        });
    });
});
