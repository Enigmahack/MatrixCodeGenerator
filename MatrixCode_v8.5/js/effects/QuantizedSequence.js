class QuantizedSequence {
    constructor() {
        this.OPS_INV = { 1: 'add', 2: 'rem', 3: 'addRect', 6: 'addSmart', 7: 'removeBlock', 12: 'nudge' };
    }

    executeStepOps(fx, step, startFrameOverride) {
        const cx = Math.floor(fx.logicGridW / 2);
        const cy = Math.floor(fx.logicGridH / 2);
        const now = startFrameOverride !== undefined ? startFrameOverride : fx.animFrame;
        
        const getIdx = (bx, by) => {
            if (bx < 0 || bx >= fx.logicGridW || by < 0 || by >= fx.logicGridH) return -1;
            return by * fx.logicGridW + bx;
        };
        const isActive = (dx, dy) => {
            const idx = getIdx(cx + dx, cy + dy);
            return (idx >= 0 && fx.logicGrid[idx] === 1);
        };
        const setLocalActive = (dx, dy) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 fx.logicGrid[idx] = 1;
                 if (fx.renderGrid && startFrameOverride !== undefined) {
                     if (fx.renderGrid[idx] === -1) fx.renderGrid[idx] = now;
                 }
             }
        };
        const setLocalInactive = (dx, dy) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 let stillActive = false;
                 for (let i = 0; i < 5; i++) {
                     if (fx.layerGrids[i] && fx.layerGrids[i][idx] !== -1) { stillActive = true; break; }
                 }
                 if (!stillActive) {
                     fx.logicGrid[idx] = 0;
                 }
             }
        };
        const setLayerActive = (dx, dy, l, frame) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0 && fx.layerGrids[l]) {
                 fx.layerGrids[l][idx] = frame;
                 if (l !== 0) fx._updateLayerOrder(l);
             }
        };
        const setLayerInactive = (dx, dy, l) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 if (l !== undefined && fx.layerGrids[l]) {
                     fx.layerGrids[l][idx] = -1;
                 } else {
                     for(let i=0; i<5; i++) if (fx.layerGrids[i]) fx.layerGrids[i][idx] = -1;
                 }
             }
        };

        const ctx = {
            cx, cy, now, getIdx, isActive, setLocalActive, setLocalInactive, setLayerActive, setLayerInactive
        };

        this._executeOps(fx, step, ctx);
    }

    _executeOps(fx, ops, ctx) {
        if (!ops) return;
        let i = 0;
        while (i < ops.length) {
            const opData = ops[i];
            if (typeof opData === 'number') {
                i = this._decodeNumericOp(fx, ops, i, ctx);
            } else {
                this._executeSingleOp(fx, opData, ctx);
                i++;
            }
        }
    }

    _decodeNumericOp(fx, step, i, ctx) {
        const { now } = ctx;
        const opCode = step[i++];
        
        if (opCode === 1) { // add(x, y)
            const dx = step[i++];
            const dy = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, 0, now);
            fx.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: 0 });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer: 0, startFrame: now, id: fx.nextBlockId++ });
        } else if (opCode === 2) { // rem(x, y, mask)
            const dx = step[i++];
            const dy = step[i++];
            let mask = step[i++];
            const layer = (mask >> 4) & 0x7;
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: layer, fade: undefined });
            ctx.setLayerInactive(dx, dy, layer);
            ctx.setLocalInactive(dx, dy);
            if (fx.activeBlocks) fx.activeBlocks = fx.activeBlocks.filter(b => !(b.layer === layer && b.x === dx && b.y === dy && b.w === 1 && b.h === 1));
        } else if (opCode === 3) { // addRect(x1, y1, x2, y2)
            const dx1 = step[i++];
            const dy1 = step[i++];
            const dx2 = step[i++];
            const dy2 = step[i++];
            const layer = 0;
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: layer });
            const x = Math.min(dx1, dx2), y = Math.min(dy1, dy2);
            const w = Math.abs(dx2 - dx1) + 1, h = Math.abs(dy2 - dy1) + 1;
            if (fx.activeBlocks) fx.activeBlocks.push({ x, y, w, h, layer, startFrame: now, id: fx.nextBlockId++ });
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    ctx.setLocalActive(x + gx, y + gy);
                    ctx.setLayerActive(x + gx, y + gy, layer, now);
                }
            }
        } else if (opCode === 6) { // addSmart(x, y)
            const dx = step[i++];
            const dy = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, 0, now);
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: 0 });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer: 0, startFrame: now, id: fx.nextBlockId++ });
        } else if (opCode === 7) { // removeBlock(x, y)
            const dx = step[i++];
            const dy = step[i++];
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
            ctx.setLayerInactive(dx, dy);
            ctx.setLocalInactive(dx, dy);
            if (fx.activeBlocks) fx.activeBlocks = fx.activeBlocks.filter(b => !(b.x === dx && b.y === dy && b.w === 1 && b.h === 1));
        } else if (opCode === 8) { // addLayered(x, y, layer)
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, l, now);
            fx.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer: l, startFrame: now, id: fx.nextBlockId++ });
        } else if (opCode === 9) { // addRectLayered(x1, y1, x2, y2, layer)
            const dx1 = step[i++];
            const dy1 = step[i++];
            const dx2 = step[i++];
            const dy2 = step[i++];
            const l = step[i++];
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
            const x = Math.min(dx1, dx2), y = Math.min(dy1, dy2);
            const w = Math.abs(dx2 - dx1) + 1, h = Math.abs(dy2 - dy1) + 1;
            if (fx.activeBlocks) fx.activeBlocks.push({ x, y, w, h, layer: l, startFrame: now, id: fx.nextBlockId++ });
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    ctx.setLocalActive(x + gx, y + gy);
                    ctx.setLayerActive(x + gx, y + gy, l, now);
                }
            }
        } else if (opCode === 10) { // addSmartLayered
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, l, now);
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer: l, startFrame: now, id: fx.nextBlockId++ });
        } else if (opCode === 11) { // removeBlockLayered
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: l, fade: undefined });
            ctx.setLayerInactive(dx, dy, l);
            ctx.setLocalInactive(dx, dy);
            if (fx.activeBlocks) fx.activeBlocks = fx.activeBlocks.filter(b => !(b.layer === l && b.x === dx && b.y === dy && b.w === 1 && b.h === 1));
        } else if (opCode === 12) { // nudge(dx, dy, w, h, layer, faceMask)
            const dx = step[i++];
            const dy = step[i++];
            const w = step[i++];
            const h = step[i++];
            const l = step[i++];
            const FACES_INV = { 1: 'N', 2: 'S', 4: 'E', 8: 'W' };
            const fMask = step[i++];
            const face = FACES_INV[fMask] || null;
            this._executeNudge(fx, dx, dy, w, h, face, l, ctx);
        }
        return i;
    }

    _executeSingleOp(fx, opData, ctx) {
        const { now, setLocalActive, setLocalInactive, setLayerActive, setLayerInactive } = ctx;

        let op, args, layer;
        if (Array.isArray(opData)) {
            op = opData[0];
            args = opData.slice(1);
        } else {
            op = opData.op;
            args = opData.args;
            layer = opData.layer;
        }

        if (op === 'group' && opData.ops) {
            this._executeOps(fx, opData.ops, ctx);
            return;
        }

        const targetLayer = layer !== undefined ? layer : 0;

        if (op === 'add' || op === 'addSmart') {
            const [dx, dy] = args;
            setLocalActive(dx, dy);
            setLayerActive(dx, dy, targetLayer, now);
            fx.maskOps.push({ type: op, x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayer });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer: targetLayer, startFrame: now, id: fx.nextBlockId++ });
        } else if (op === 'addRect') {
            const [dx1, dy1, dx2, dy2] = args;
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayer });
            const x = Math.min(dx1, dx2), y = Math.min(dy1, dy2);
            const w = Math.abs(dx2 - dx1) + 1, h = Math.abs(dy2 - dy1) + 1;
            if (fx.activeBlocks) fx.activeBlocks.push({ x, y, w, h, layer: targetLayer, startFrame: now, id: fx.nextBlockId++ });
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    setLocalActive(x + gx, y + gy);
                    setLayerActive(x + gx, y + gy, targetLayer, now);
                }
            }
        } else if (op === 'removeBlock' || op === 'rem' || op === 'removeBlockLayered') {
            let x1, y1, x2, y2;
            if (args.length >= 4) { [x1, y1, x2, y2] = args; } 
            else { [x1, y1] = args; x2 = x1; y2 = y1; }
            
            fx.maskOps.push({ type: 'removeBlock', x1: x1, y1: y1, x2: x2, y2: y2, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayer, fade: opData.fade });
            const rx1 = Math.min(x1, x2), ry1 = Math.min(y1, y2);
            const rx2 = Math.max(x1, x2), ry2 = Math.max(y1, y2);

            for (let gy = ry1; gy <= ry2; gy++) {
                for (let gx = rx1; gx <= rx2; gx++) {
                    setLayerInactive(gx, gy, targetLayer);
                    setLocalInactive(gx, gy);
                }
            }
            if (fx.activeBlocks) {
                fx.activeBlocks = fx.activeBlocks.filter(b => {
                    if (b.layer !== targetLayer) return true;
                    const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w - 1, by2 = b.y + b.h - 1;
                    const overlap = !(bx1 > rx2 || bx2 < rx1 || by1 > ry2 || by2 < ry1);
                    return !overlap;
                });
            }
        } else if (op === 'nudge') {
            const [dx, dy, w, h, face] = args;
            this._executeNudge(fx, dx, dy, w, h, face, targetLayer, ctx);
        }
    }

    _executeNudge(fx, dx, dy, w, h, face, layer, ctx) {
        const oldFrame = fx.animFrame;
        fx.animFrame = ctx.now;
        fx._nudge(dx, dy, w, h, face, layer);
        fx.animFrame = oldFrame;
    }
}