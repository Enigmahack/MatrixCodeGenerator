/**
 * QuantizedSequence.js
 * Manages the execution and modular decoding of animation operations.
 * Refactored to use a command-based pattern for SOLID extensibility.
 */
class QuantizedSequence {
    constructor() {
        // Operation Code Mapping
        this.OPS = {
            ADD: 1, REM: 2, RECT: 3, SMART: 6, REM_BLOCK: 7,
            ADD_L: 8, RECT_L: 9, SMART_L: 10, REM_L: 11,
            NUDGE: 12, NUDGE_ML: 13,
            GROUP: 99
        };

        this.OPS_INV = Object.fromEntries(Object.entries(this.OPS).map(([k, v]) => [v, k.toLowerCase().replace('_l', 'Layered')]));
        
        // Face Mask Mapping
        this.FACES = { 'N': 1, 'S': 2, 'E': 4, 'W': 8 };
        this.FACES_INV = { 1: 'N', 2: 'S', 4: 'E', 8: 'W' };
    }

    /**
     * Executes a step's operations against an effect instance.
     */
    executeStepOps(fx, step, startFrameOverride) {
        if (!step || !fx.logicGridW) return;

        const cx = Math.floor(fx.logicGridW / 2);
        const cy = Math.floor(fx.logicGridH / 2);
        const now = startFrameOverride !== undefined ? startFrameOverride : fx.animFrame;
        
        const ctx = {
            cx, cy, now,
            getIdx: (bx, by) => {
                if (bx < 0 || bx >= fx.logicGridW || by < 0 || by >= fx.logicGridH) return -1;
                return by * fx.logicGridW + bx;
            },
            isActive: (dx, dy) => {
                const idx = ctx.getIdx(cx + dx, cy + dy);
                return (idx >= 0 && fx.logicGrid[idx] === 1);
            },
            setLocalActive: (dx, dy) => {
                const idx = ctx.getIdx(cx + dx, cy + dy);
                if (idx >= 0) {
                    fx.logicGrid[idx] = 1;
                    if (fx.renderGrid && startFrameOverride !== undefined) {
                        if (fx.renderGrid[idx] === -1) fx.renderGrid[idx] = now;
                    }
                }
            },
            setLocalInactive: (dx, dy) => {
                const idx = ctx.getIdx(cx + dx, cy + dy);
                if (idx >= 0) {
                    let stillActive = false;
                    for (let i = 0; i < 4; i++) {
                        if (fx.layerGrids[i] && fx.layerGrids[i][idx] !== -1) { stillActive = true; break; }
                    }
                    if (!stillActive) fx.logicGrid[idx] = 0;
                }
            },
            setLayerActive: (dx, dy, l, frame) => {
                const idx = ctx.getIdx(cx + dx, cy + dy);
                if (idx >= 0 && fx.layerGrids[l]) {
                    fx.layerGrids[l][idx] = frame;
                    if (l !== 0 && fx._updateLayerOrder) fx._updateLayerOrder(l);
                }
            },
            setLayerInactive: (dx, dy, l) => {
                const idx = ctx.getIdx(cx + dx, cy + dy);
                if (idx >= 0) {
                    if (l !== undefined && fx.layerGrids[l]) {
                        fx.layerGrids[l][idx] = -1;
                    } else {
                        for (let i = 0; i < 4; i++) if (fx.layerGrids[i]) fx.layerGrids[i][idx] = -1;
                    }
                }
            }
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
        const opCode = step[i++];
        const { now } = ctx;

        switch (opCode) {
            case 1: // ADD (x, y)
                return this._handleOp(fx, 'add', [step[i++], step[i++]], 0, now, i, ctx);
            case 2: { // REM (x, y, mask)
                const dx = step[i++];
                const dy = step[i++];
                const mask = step[i++];
                const layer = (mask >> 4) & 0x7;
                return this._handleOp(fx, 'rem', [dx, dy], layer, now, i, ctx);
            }
            case 3: // RECT (x1, y1, x2, y2)
                return this._handleOp(fx, 'addRect', [step[i++], step[i++], step[i++], step[i++]], 0, now, i, ctx);
            case 6: // SMART (x, y)
                return this._handleOp(fx, 'addSmart', [step[i++], step[i++]], 0, now, i, ctx);
            case 7: // REM_BLOCK (x, y)
                return this._handleOp(fx, 'removeBlock', [step[i++], step[i++]], undefined, now, i, ctx);
            case 8: // ADD_L (x, y, l)
                return this._handleOp(fx, 'add', [step[i++], step[i++]], step[i++], now, i, ctx);
            case 9: // RECT_L (x1, y1, x2, y2, l)
                return this._handleOp(fx, 'addRect', [step[i++], step[i++], step[i++], step[i++]], step[i++], now, i, ctx);
            case 10: // SMART_L
                return this._handleOp(fx, 'addSmart', [step[i++], step[i++]], step[i++], now, i, ctx);
            case 11: // REM_L
                return this._handleOp(fx, 'removeBlock', [step[i++], step[i++]], step[i++], now, i, ctx);
            case 12: // NUDGE
            case 13: { // NUDGE_ML
                const args = [step[i++], step[i++], step[i++], step[i++]]; // dx, dy, w, h
                const l = step[i++];
                const fMask = step[i++];
                const face = this.FACES_INV[fMask] || 'N';
                this._executeNudge(fx, args[0], args[1], args[2], args[3], face, l, ctx, opCode === 13);
                return i;
            }
            default:
                return i;
        }
    }

    _executeSingleOp(fx, opData, ctx) {
        if (opData.op === 'group' && opData.ops) {
            this._executeOps(fx, opData.ops, ctx);
            return;
        }

        const op = opData.op || opData[0];
        const args = opData.args || (Array.isArray(opData) ? opData.slice(1) : []);
        const layer = opData.layer !== undefined ? opData.layer : 0;
        
        this._handleOp(fx, op, args, layer, ctx.now, 0, ctx);
    }

    /**
     * Centralized Operation Handler
     */
    _handleOp(fx, op, args, layer, now, nextIdx, ctx) {
        const { setLocalActive, setLocalInactive, setLayerActive, setLayerInactive } = ctx;

        if (op === 'add' || op === 'addSmart') {
            const [dx, dy] = args;
            setLocalActive(dx, dy);
            setLayerActive(dx, dy, layer, now);
            fx.maskOps.push({ type: op, x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer });
            if (fx.activeBlocks) fx.activeBlocks.push({ x: dx, y: dy, w: 1, h: 1, layer, startFrame: now, id: fx.nextBlockId++, dist: Math.abs(dx) + Math.abs(dy) });
        } else if (op === 'addRect') {
            const [dx1, dy1, dx2, dy2] = args;
            const x = Math.min(dx1, dx2), y = Math.min(dy1, dy2);
            const w = Math.abs(dx2 - dx1) + 1, h = Math.abs(dy2 - dy1) + 1;
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer });
            if (fx.activeBlocks) fx.activeBlocks.push({ x, y, w, h, layer, startFrame: now, id: fx.nextBlockId++, dist: Math.abs(x) + Math.abs(y) });
            for (let gy = 0; gy < h; gy++) {
                for (let gx = 0; gx < w; gx++) {
                    setLocalActive(x + gx, y + gy);
                    setLayerActive(x + gx, y + gy, layer, now);
                }
            }
        } else if (op === 'removeBlock' || op === 'rem') {
            let x1, y1, x2, y2;
            if (args.length >= 4) { [x1, y1, x2, y2] = args; } 
            else { [x1, y1] = args; x2 = x1; y2 = y1; }
            
            fx.maskOps.push({ type: 'removeBlock', x1, y1, x2, y2, startFrame: now, startPhase: fx.expansionPhase, layer, fade: args[4] });
            const rx1 = Math.min(x1, x2), ry1 = Math.min(y1, y2);
            const rx2 = Math.max(x1, x2), ry2 = Math.max(y1, y2);

            for (let gy = ry1; gy <= ry2; gy++) {
                for (let gx = rx1; gx <= rx2; gx++) {
                    setLayerInactive(gx, gy, layer);
                    setLocalInactive(gx, gy);
                }
            }
            if (fx.activeBlocks) {
                fx.activeBlocks = fx.activeBlocks.filter(b => {
                    if (layer !== undefined && b.layer !== layer) return true;
                    const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w - 1, by2 = b.y + b.h - 1;
                    return (bx1 > rx2 || bx2 < rx1 || by1 > ry2 || by2 < ry1);
                });
            }
        } else if (op === 'nudge' || op === 'nudgeML') {
            const [dx, dy, w, h, face] = args;
            this._executeNudge(fx, dx, dy, w, h, face, layer, ctx, op === 'nudgeML');
        }

        return nextIdx;
    }

    _executeNudge(fx, dx, dy, w, h, face, layer, ctx, multiLayer = false) {
        const oldFrame = fx.animFrame;
        fx.animFrame = ctx.now;
        if (fx._nudge) {
            fx._nudge(dx, dy, w, h, face, layer, multiLayer);
        }
        fx.animFrame = oldFrame;
    }

    /**
     * Encodes a sequence into a compact numeric format.
     */
    static encode(sequence) {
        const OPS = { 'add': 1, 'rem': 2, 'addRect': 3, 'addSmart': 6, 'removeBlock': 7, 'nudge': 12, 'nudgeML': 13 };
        const FACES = { 'N': 1, 'S': 2, 'E': 4, 'W': 8 };
        
        const packedSequence = [];
        for (const step of sequence) {
            const stepData = [];
            for (const opObj of step) {
                let opName, args, layer = 0;
                if (Array.isArray(opObj)) {
                    if (typeof opObj[0] === 'number') {
                        stepData.push(...opObj);
                        continue;
                    }
                    opName = opObj[0];
                    args = opObj.slice(1);
                } else {
                    opName = opObj.op;
                    args = opObj.args;
                    layer = opObj.layer || 0;
                }

                const opCode = OPS[opName];
                if (!opCode) {
                    if (opName === 'group' && opObj.ops) {
                        const encodedGroup = { op: 'group', ops: QuantizedSequence.encode([opObj.ops])[0] };
                        stepData.push(encodedGroup);
                    }
                    continue;
                }

                if (opCode === 1) { // add
                    if (layer > 0) stepData.push(8, args[0], args[1], layer); 
                    else stepData.push(1, args[0], args[1]);
                } else if (opCode === 3) { // addRect
                    if (layer > 0) stepData.push(9, args[0], args[1], args[2], args[3], layer); 
                    else stepData.push(3, args[0], args[1], args[2], args[3]);
                } else if (opCode === 6) { // addSmart
                    if (layer > 0) stepData.push(10, args[0], args[1], layer); 
                    else stepData.push(6, args[0], args[1]);
                } else if (opCode === 7) { // removeBlock
                    if (layer > 0) stepData.push(11, args[0], args[1], layer); 
                    else stepData.push(7, args[0], args[1]);
                } else if (opCode === 12 || opCode === 13) { // nudge
                    const dx = args[0], dy = args[1];
                    let face = args[4];
                    if (!face) face = (Math.abs(dy) > Math.abs(dx)) ? (dy > 0 ? 'S' : 'N') : (dx > 0 ? 'E' : 'W');
                    const fMask = FACES[face.toUpperCase()] || 0;
                    stepData.push(opCode, args[0], args[1], args[2], args[3], layer, fMask);
                } else if (opCode === 2) { // rem
                    const mask = (layer << 4);
                    stepData.push(2, args[0], args[1], mask);
                }
            }
            packedSequence.push(stepData);
        }
        return packedSequence;
    }

    /**
     * Decodes a numeric sequence into a descriptive object format.
     */
    static decode(sequence) {
        if (!sequence || sequence.length === 0) return [[]];
        const OPS_INV = { 1: 'add', 2: 'rem', 3: 'addRect', 6: 'addSmart', 7: 'removeBlock' };
        const FACES_INV = { 1: 'N', 2: 'S', 4: 'E', 8: 'W' };
        
        const decodedSeq = [];
        for (const step of sequence) {
            const decodedStep = [];
            if (Array.isArray(step) && step.length > 0 && typeof step[0] === 'number') {
                let i = 0;
                while (i < step.length) {
                    const opCode = step[i++];
                    const opName = OPS_INV[opCode];
                    if (opCode === 1 || opCode === 6 || opCode === 7) decodedStep.push({ op: opName, args: [step[i++], step[i++]], layer: 0 });
                    else if (opCode === 3) decodedStep.push({ op: 'addRect', args: [step[i++], step[i++], step[i++], step[i++]], layer: 0 });
                    else if (opCode === 2) {
                        const dx = step[i++], dy = step[i++], mask = step[i++];
                        decodedStep.push({ op: 'rem', args: [dx, dy], layer: (mask >> 4) & 0x7 });
                    }
                    else if (opCode === 8) decodedStep.push({ op: 'add', args: [step[i++], step[i++]], layer: step[i++] });
                    else if (opCode === 9) decodedStep.push({ op: 'addRect', args: [step[i++], step[i++], step[i++], step[i++]], layer: step[i++] });
                    else if (opCode === 10) decodedStep.push({ op: 'addSmart', args: [step[i++], step[i++]], layer: step[i++] });
                    else if (opCode === 11) decodedStep.push({ op: 'removeBlock', args: [step[i++], step[i++]], layer: step[i++] });
                    else if (opCode === 12 || opCode === 13) {
                        const dx = step[i++], dy = step[i++], w = step[i++], h = step[i++], l = step[i++], fMask = step[i++];
                        decodedStep.push({ 
                            op: opCode === 13 ? 'nudgeML' : 'nudge', 
                            args: [dx, dy, w, h, FACES_INV[fMask] || 'N'], 
                            layer: l 
                        });
                    }
                }
            } else {
                for (const opObj of step) {
                    if (opObj && opObj.op === 'group') decodedStep.push({ op: 'group', ops: QuantizedSequence.decode([opObj.ops])[0] });
                    else decodedStep.push(opObj);
                }
            }
            decodedSeq.push(decodedStep);
        }
        return decodedSeq;
    }
}
