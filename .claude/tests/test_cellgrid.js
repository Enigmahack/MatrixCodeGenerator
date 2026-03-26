const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadCellGrid } = require('./harness');

describe('CellGrid', () => {
    let ctx;

    it('loads CellGrid into VM', () => {
        ctx = loadCellGrid();
        assert.ok(ctx.CellGrid, 'CellGrid should be defined');
    });

    describe('Enum Constants', () => {
        it('CELL_STATE values', () => {
            assert.strictEqual(ctx.CELL_STATE.INACTIVE, 0);
            assert.strictEqual(ctx.CELL_STATE.ACTIVE, 1);
        });

        it('RENDER_MODE values', () => {
            assert.strictEqual(ctx.RENDER_MODE.STANDARD, 0);
            assert.strictEqual(ctx.RENDER_MODE.OVERLAP, 1);
            assert.strictEqual(ctx.RENDER_MODE.ADDITIVE, 2);
        });

        it('OVERRIDE_MODE values', () => {
            assert.strictEqual(ctx.OVERRIDE_MODE.NONE, 0);
            assert.strictEqual(ctx.OVERRIDE_MODE.CHAR, 1);
            assert.strictEqual(ctx.OVERRIDE_MODE.SOLID, 2);
            assert.strictEqual(ctx.OVERRIDE_MODE.FULL, 3);
            assert.strictEqual(ctx.OVERRIDE_MODE.DUAL, 5);
        });
    });

    describe('Construction & Resize', () => {
        it('constructs with mock config', () => {
            const grid = new ctx.CellGrid({ derived: { cellWidth: 20, cellHeight: 20, activeFonts: [] } });
            assert.ok(grid);
            assert.strictEqual(grid.cols, 0);
            assert.strictEqual(grid.rows, 0);
        });

        it('resizes and allocates typed arrays', () => {
            const config = { derived: { cellWidth: 20, cellHeight: 20, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(200, 100);

            assert.strictEqual(grid.cols, 10);  // 200 / 20 = 10
            assert.strictEqual(grid.rows, 5);   // 100 / 20 = 5

            const total = 10 * 5;
            assert.strictEqual(grid.chars.length, total);
            assert.strictEqual(grid.colors.length, total);
            assert.strictEqual(grid.alphas.length, total);
            assert.strictEqual(grid.state.length, total);
            assert.strictEqual(grid.overrideActive.length, total);
            assert.strictEqual(grid.effectActive.length, total);
            assert.strictEqual(grid.types.length, total);
            assert.strictEqual(grid.genericParams.length, total * 4);
        });
    });

    describe('getIndex', () => {
        it('computes correct index', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(50, 30);
            // 5 cols, 3 rows
            assert.strictEqual(grid.getIndex(0, 0), 0);
            assert.strictEqual(grid.getIndex(1, 0), 1);
            assert.strictEqual(grid.getIndex(0, 1), 5);
            assert.strictEqual(grid.getIndex(4, 2), 14);
        });

        it('returns -1 for out-of-bounds', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(50, 30);
            assert.strictEqual(grid.getIndex(-1, 0), -1);
            assert.strictEqual(grid.getIndex(0, -1), -1);
            assert.strictEqual(grid.getIndex(5, 0), -1);
            assert.strictEqual(grid.getIndex(0, 3), -1);
        });
    });

    describe('setPrimary / clearCell', () => {
        it('sets primary cell data and marks active', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            const idx = grid.getIndex(1, 0);
            const color = ctx.Utils.packAbgr(255, 0, 0);
            grid.setPrimary(idx, 'A', color, 0.8, 0, 0.5);

            assert.strictEqual(grid.chars[idx], 'A'.charCodeAt(0));
            // Uint32Array stores as unsigned, packAbgr may return signed — compare unsigned
            assert.strictEqual(grid.colors[idx] >>> 0, color >>> 0);
            assert.strictEqual(grid.alphas[idx], 0.800000011920929); // Float32 precision
            assert.strictEqual(grid.state[idx], ctx.CELL_STATE.ACTIVE);
            assert.ok(grid.activeIndices.has(idx));
        });

        it('clearCell resets state', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            const idx = grid.getIndex(1, 0);
            grid.setPrimary(idx, 'A', 0xFFFFFFFF, 1.0);
            grid.clearCell(idx);

            assert.strictEqual(grid.state[idx], ctx.CELL_STATE.INACTIVE);
            assert.strictEqual(grid.chars[idx], 32); // space
            assert.strictEqual(grid.alphas[idx], 0);
            assert.ok(!grid.activeIndices.has(idx));
        });
    });

    describe('Override operations', () => {
        it('setOverride sets CHAR mode', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            const idx = 0;
            grid.setOverride(idx, 'X', 0xFFFFFFFF, 1.0);
            assert.strictEqual(grid.overrideActive[idx], ctx.OVERRIDE_MODE.CHAR);
            assert.strictEqual(grid.overrideChars[idx], 'X'.charCodeAt(0));
        });

        it('setSolidOverride sets SOLID mode', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            const idx = 0;
            grid.setSolidOverride(idx, 0xFF000000, 0.5);
            assert.strictEqual(grid.overrideActive[idx], ctx.OVERRIDE_MODE.SOLID);
        });

        it('clearOverride resets to NONE', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            const idx = 0;
            grid.setOverride(idx, 'X', 0xFFFFFFFF, 1.0);
            grid.clearOverride(idx);
            assert.strictEqual(grid.overrideActive[idx], ctx.OVERRIDE_MODE.NONE);
        });

        it('clearAllOverrides fills with 0', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setOverride(0, 'A', 0xFFFFFFFF, 1.0);
            grid.setOverride(1, 'B', 0xFFFFFFFF, 1.0);
            grid.clearAllOverrides();

            assert.strictEqual(grid.overrideActive[0], 0);
            assert.strictEqual(grid.overrideActive[1], 0);
        });
    });

    describe('Effect layer operations', () => {
        it('setEffectOverride sets effectActive=1', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setEffectOverride(0, 'E', 0xFF00FF00, 0.9);
            assert.strictEqual(grid.effectActive[0], 1);
        });

        it('setEffectOverlay sets effectActive=2', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setEffectOverlay(0, 'O', 0xFFFF0000, 0.7);
            assert.strictEqual(grid.effectActive[0], 2);
        });

        it('setEffectShadow sets effectActive=3', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setEffectShadow(0, 0.5);
            assert.strictEqual(grid.effectActive[0], 3);
        });

        it('setHighPriorityEffect sets effectActive=4', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setHighPriorityEffect(0, 'H', 0xFFFFFFFF, 1.0);
            assert.strictEqual(grid.effectActive[0], 4);
        });

        it('clearAllEffects resets effectActive', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(30, 10);

            grid.setEffectOverride(0, 'E', 0xFF00FF00, 1.0);
            grid.setEffectShadow(1, 0.5);
            grid.clearAllEffects();

            assert.strictEqual(grid.effectActive[0], 0);
            assert.strictEqual(grid.effectActive[1], 0);
        });
    });

    describe('copyFrom', () => {
        it('deep-clones typed arrays', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const gridA = new ctx.CellGrid(config);
            const gridB = new ctx.CellGrid(config);
            gridA.resize(20, 10);
            gridB.resize(20, 10);

            gridA.setPrimary(0, 'Z', 0xFF00FF00, 1.0);
            gridA.state[0] = ctx.CELL_STATE.ACTIVE;
            gridB.copyFrom(gridA);

            assert.strictEqual(gridB.chars[0], 'Z'.charCodeAt(0));
            assert.strictEqual(gridB.state[0], ctx.CELL_STATE.ACTIVE);

            // Verify independence — modifying A shouldn't affect B
            gridA.chars[0] = 0;
            assert.strictEqual(gridB.chars[0], 'Z'.charCodeAt(0));
        });

        it('rejects copy from different-sized grid', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const gridA = new ctx.CellGrid(config);
            const gridB = new ctx.CellGrid(config);
            gridA.resize(20, 10);
            gridB.resize(30, 10);

            // Different cols — should silently return
            const originalChar = gridB.chars[0];
            gridB.copyFrom(gridA);
            // chars[0] should be unchanged
            assert.strictEqual(gridB.chars[0], originalChar);
        });
    });

    describe('Rotator targets', () => {
        it('setRotatorTarget / getRotatorTarget round-trip', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(20, 10);

            grid.setRotatorTarget(0, 'R');
            assert.strictEqual(grid.getRotatorTarget(0), 'R');
        });

        it('returns null for unset target', () => {
            const config = { derived: { cellWidth: 10, cellHeight: 10, activeFonts: [] } };
            const grid = new ctx.CellGrid(config);
            grid.resize(20, 10);

            grid.nextChars[0] = 0;
            assert.strictEqual(grid.getRotatorTarget(0), null);
        });
    });
});
