class QuantizedSequence {
    constructor() {
        this.OPS_INV = { 1: 'add', 2: 'rem', 3: 'addRect', 4: 'addLine', 5: 'remLine', 6: 'addSmart', 7: 'removeBlock', 12: 'nudge' };
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
                 // Mark as revealed in the past during jumps so edges render
                 if (fx.renderGrid && startFrameOverride !== undefined) {
                     if (fx.renderGrid[idx] === -1) fx.renderGrid[idx] = now;
                 }
             }
        };
        const setLocalInactive = (dx, dy) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 let stillActive = false;
                 for (let i = 0; i < 3; i++) {
                     if (fx.layerGrids[i] && fx.layerGrids[i][idx] !== -1) { stillActive = true; break; }
                 }
                 if (!stillActive) {
                     fx.logicGrid[idx] = 0;
                     // We don't clear renderGrid here because removal triggers a fade in New World
                 }
             }
        };
        const setLayerActive = (dx, dy, l, frame) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0 && fx.layerGrids[l]) fx.layerGrids[l][idx] = frame;
        };
        const setLayerInactive = (dx, dy, l) => {
             const idx = getIdx(cx + dx, cy + dy);
             if (idx >= 0) {
                 if (l !== undefined && fx.layerGrids[l]) {
                     fx.layerGrids[l][idx] = -1;
                 } else {
                     for(let i=0; i<3; i++) if (fx.layerGrids[i]) fx.layerGrids[i][idx] = -1;
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
            
            // State MUST always be updated for transitions/merges
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, 0, now);

            fx.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase });
        } else if (opCode === 2) { // rem(x, y, mask)
            // ... (rest of numeric decoder remains the same)
            const dx = step[i++];
            const dy = step[i++];
            const mask = step[i++];
            if (mask === 0) {
                const nN = ctx.isActive(dx, dy - 1);
                const nS = ctx.isActive(dx, dy + 1);
                const nE = ctx.isActive(dx + 1, dy);
                const nW = ctx.isActive(dx - 1, dy);
                if (nN && nS && nE && nW) {
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                } else {
                    fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                    ctx.setLayerInactive(dx, dy);
                    ctx.setLocalInactive(dx, dy);
                }
            } else {
                if (mask & 1) fx.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                if (mask & 2) fx.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                if (mask & 4) fx.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
                if (mask & 8) fx.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
            }
        } else if (opCode === 3) { // addRect(x1, y1, x2, y2)
            const dx1 = step[i++];
            const dy1 = step[i++];
            const dx2 = step[i++];
            const dy2 = step[i++];
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase });
            const minX = Math.min(ctx.cx + dx1, ctx.cx + dx2);
            const maxX = Math.max(ctx.cx + dx1, ctx.cx + dx2);
            const minY = Math.min(ctx.cy + dy1, ctx.cy + dy2);
            const maxY = Math.max(ctx.cy + dy1, ctx.cy + dy2);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    ctx.setLocalActive(x - ctx.cx, y - ctx.cy);
                    ctx.setLayerActive(x - ctx.cx, y - ctx.cy, 0, now);
                }
            }
        } else if (opCode === 4) { // addLine(x, y, mask)
            const dx = step[i++];
            const dy = step[i++];
            const mask = step[i++];
            if (mask & 1) fx.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 2) fx.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 4) fx.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 8) fx.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', startFrame: now, startPhase: fx.expansionPhase });
        } else if (opCode === 5) { // remLine(x, y, mask)
            const dx = step[i++];
            const dy = step[i++];
            const mask = step[i++];
            if (mask & 1) fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 2) fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 4) fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now, startPhase: fx.expansionPhase });
            if (mask & 8) fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now, startPhase: fx.expansionPhase });
        } else if (opCode === 6) { // addSmart(x, y)
            const dx = step[i++];
            const dy = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, 0, now);
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase });
        } else if (opCode === 7) { // removeBlock(x, y)
            const dx = step[i++];
            const dy = step[i++];
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, fade: undefined });
            ctx.setLayerInactive(dx, dy);
            ctx.setLocalInactive(dx, dy);
        } else if (opCode === 8) { // addLayered(x, y, layer)
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, l, now);
            fx.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
        } else if (opCode === 9) { // addRectLayered(x1, y1, x2, y2, layer)
            const dx1 = step[i++];
            const dy1 = step[i++];
            const dx2 = step[i++];
            const dy2 = step[i++];
            const l = step[i++];
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
            const minX = Math.min(ctx.cx + dx1, ctx.cx + dx2);
            const maxX = Math.max(ctx.cx + dx1, ctx.cx + dx2);
            const minY = Math.min(ctx.cy + dy1, ctx.cy + dy2);
            const maxY = Math.max(ctx.cy + dy1, ctx.cy + dy2);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    ctx.setLocalActive(x - ctx.cx, y - ctx.cy);
                    ctx.setLayerActive(x - ctx.cx, y - ctx.cy, l, now);
                }
            }
        } else if (opCode === 10) { // addSmartLayered
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            ctx.setLocalActive(dx, dy);
            ctx.setLayerActive(dx, dy, l, now);
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: l });
        } else if (opCode === 11) { // removeBlockLayered
            const dx = step[i++];
            const dy = step[i++];
            const l = step[i++];
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: l, fade: undefined });
            ctx.setLayerInactive(dx, dy, l);
            ctx.setLocalInactive(dx, dy);
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
        const { cx, cy, now, getIdx, isActive, setLocalActive, setLocalInactive, setLayerActive, setLayerInactive } = ctx;

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

        if (op === 'add') {
            const [dx, dy] = args;
            const targetLayer = layer !== undefined ? layer : 0;
            
            // State MUST always be updated
            setLocalActive(dx, dy);
            setLayerActive(dx, dy, targetLayer, now);

            fx.maskOps.push({ type: 'add', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayer });
        } else if (op === 'addSmart') {
            const [dx, dy] = args;
            const targetLayer = layer !== undefined ? layer : 0;
            setLocalActive(dx, dy);
            setLayerActive(dx, dy, targetLayer, now);
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: layer });
        } else if (op === 'addRect') {
            const [dx1, dy1, dx2, dy2] = args;
            fx.maskOps.push({ type: 'add', x1: dx1, y1: dy1, x2: dx2, y2: dy2, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: layer });
            const minX = Math.min(cx + dx1, cx + dx2);
            const maxX = Math.max(cx + dx1, cx + dx2);
            const minY = Math.min(cy + dy1, cy + dy2);
            const maxY = Math.max(cy + dy1, cy + dy2);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    setLocalActive(x - cx, y - cy);
                    setLayerActive(x - cx, y - cy, layer !== undefined ? layer : 0, now);
                }
            }
        } else if (op === 'rem') {
            const [dx, dy, face] = args;
            if (face) {
                fx.maskOps.push({ type: 'remove', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now, startPhase: fx.expansionPhase, fade: opData.fade });
            } else {
                const nN = isActive(dx, dy - 1);
                const nS = isActive(dx, dy + 1);
                const nE = isActive(dx + 1, dy);
                const nW = isActive(dx - 1, dy);
                if (nN && nS && nE && nW) {
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'N', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: opData.fade });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'S', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: opData.fade });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'E', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: opData.fade });
                    fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: 'W', force: true, startFrame: now, startPhase: fx.expansionPhase, fade: opData.fade });
                } else {
                    fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: layer, fade: opData.fade });
                    setLayerInactive(dx, dy, layer);
                    setLocalInactive(dx, dy);
                }
            }
        } else if (op === 'removeBlock') {
            const [dx, dy] = args;
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: layer, fade: opData.fade });
            setLayerInactive(dx, dy, layer);
            setLocalInactive(dx, dy);
        } else if (op === 'addLine') {
            const [dx, dy, face] = args;
            fx.maskOps.push({ type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, startFrame: now, startPhase: fx.expansionPhase, layer: layer });
        } else if (op === 'remLine') {
            const [dx, dy, face] = args;
            fx.maskOps.push({ type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: face, force: true, startFrame: now, startPhase: fx.expansionPhase, layer: layer, fade: opData.fade });
        } else if (op === 'addSmartLayered') {
            const [dx, dy] = args;
            fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx, y2: dy, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: layer });
            setLocalActive(dx, dy);
            setLayerActive(dx, dy, layer !== undefined ? layer : 0, now);
        } else if (op === 'removeBlockLayered') {
            const [dx, dy] = args;
            fx.maskOps.push({ type: 'removeBlock', x1: dx, y1: dy, x2: dx, y2: dy, startFrame: now, startPhase: fx.expansionPhase, layer: layer, fade: opData.fade });
            setLayerInactive(dx, dy, layer);
            setLocalInactive(dx, dy);
        } else if (op === 'nudge') {
            const [dx, dy, w, h, face] = args;
            this._executeNudge(fx, dx, dy, w, h, face, layer, ctx);
        }
    }

    _executeNudge(fx, dx, dy, w, h, face, layer, ctx) {
        const { cx, cy, now, getIdx, isActive, setLocalActive, setLocalInactive, setLayerActive, setLayerInactive } = ctx;

        let axis = 'X';
        let dir = 1;

        if (face) {
            const f = face.toUpperCase();
            if (f === 'N') { axis = 'Y'; dir = -1; }
            else if (f === 'S') { axis = 'Y'; dir = 1; }
            else if (f === 'E') { axis = 'X'; dir = 1; }
            else if (f === 'W') { axis = 'X'; dir = -1; }
        } else {
            // Fallback to "away from center"
            if (dx === 0 && dy === 0) return;
            if (Math.abs(dx) === Math.abs(dy)) return;
            if (Math.abs(dy) > Math.abs(dx)) { axis = 'Y'; dir = Math.sign(dy); }
            else { axis = 'X'; dir = Math.sign(dx); }
        }

        const rangeW = fx.logicGridW;
        const rangeH = fx.logicGridH;
        const toRelX = (bx) => bx - cx;
        const toRelY = (by) => by - cy;

        const targetLayerIdx = (layer !== undefined) ? layer : 0;
        const grid = fx.layerGrids[targetLayerIdx];
        const edgeMap = (fx._cachedEdgeMaps && fx._cachedEdgeMaps[targetLayerIdx]) ? fx._cachedEdgeMaps[targetLayerIdx] : null;

        if (grid) {
            const moves = [];
            for (let by = 0; by < rangeH; by++) {
                for (let bx = 0; bx < rangeW; bx++) {
                    const idx = by * rangeW + bx;
                    if (grid[idx] !== -1) {
                        const rx = toRelX(bx);
                        const ry = toRelY(by);
                        let shouldMove = false;
                        if (axis === 'X') {
                            const laneMatch = (ry >= dy && ry < dy + h);
                            const posMatch = (dir > 0) ? (rx >= dx) : (rx <= dx + w - 1);
                            if (laneMatch && posMatch) shouldMove = true;
                        } else {
                            const laneMatch = (rx >= dx && rx < dx + w);
                            const posMatch = (dir > 0) ? (ry >= dy) : (ry <= dy + h - 1);
                            if (laneMatch && posMatch) shouldMove = true;
                        }
                        if (shouldMove) moves.push({ x: rx, y: ry, start: grid[idx], bx, by });
                    }
                }
            }

            if (axis === 'X') {
                if (dir > 0) moves.sort((a, b) => b.x - a.x);
                else moves.sort((a, b) => a.x - b.x);
            } else {
                if (dir > 0) moves.sort((a, b) => b.y - a.y);
                else moves.sort((a, b) => a.y - b.y);
            }

            for (const m of moves) {
                if (edgeMap) {
                    const copyLineOp = (face, key) => {
                        if (edgeMap.has(key)) {
                            const entry = edgeMap.get(key);
                            let nx = m.x, ny = m.y;
                            if (axis === 'X') nx += (dir * w); else ny += (dir * h);
                            const type = (entry.type === 'add') ? 'addLine' : 'removeLine';
                            fx.maskOps.push({
                                type: type, x1: nx, y1: ny, x2: nx, y2: ny, face: face, force: true, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayerIdx
                            });
                        }
                    };
                    copyLineOp('N', `H_${m.bx}_${m.by}`);
                    copyLineOp('S', `H_${m.bx}_${m.by + 1}`);
                    copyLineOp('W', `V_${m.bx}_${m.by}`);
                    copyLineOp('E', `V_${m.bx + 1}_${m.by}`);
                }

                fx.maskOps.push({ type: 'removeBlock', x1: m.x, y1: m.y, x2: m.x, y2: m.y, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayerIdx });
                setLayerInactive(m.x, m.y, targetLayerIdx);

                let nx = m.x, ny = m.y;
                if (axis === 'X') nx += (dir * w); else ny += (dir * h);
                fx.maskOps.push({ type: 'addSmart', x1: nx, y1: ny, x2: nx, y2: ny, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayerIdx });
                setLayerActive(nx, ny, targetLayerIdx, m.start);
            }
        }

        fx.maskOps.push({ type: 'addSmart', x1: dx, y1: dy, x2: dx + w - 1, y2: dy + h - 1, ext: false, startFrame: now, startPhase: fx.expansionPhase, layer: targetLayerIdx });
        for (let y = dy; y < dy + h; y++) {
            for (let x = dx; x < dx + w; x++) {
                setLocalActive(x, y);
                setLayerActive(x, y, targetLayerIdx, now);
            }
        }
    }
}