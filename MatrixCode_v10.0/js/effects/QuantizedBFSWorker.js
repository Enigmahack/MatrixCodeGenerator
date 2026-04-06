/**
 * QuantizedBFSWorker.js
 * Lightweight worker that offloads BFS flood-fill and distance-field
 * computations from the main thread.  These are the two heaviest
 * synchronous operations in the 2D render path (computeTrueOutside +
 * computeDistanceField), each O(blocksX × blocksY).
 *
 * Protocol
 * --------
 * Main → Worker  { type:'compute', id, blocksX, blocksY, renderGrid (transferable) }
 * Worker → Main  { type:'result',  id, outsideMap (transferable), distMap (transferable),
 *                   renderGrid (returned), blocksX, blocksY }
 */

let queue = null;  // reusable Int32Array for BFS

function ensureQueue(size) {
    if (!queue || queue.length < size) {
        queue = new Int32Array(size);
    }
}

function computeTrueOutside(grid, blocksX, blocksY) {
    const size = blocksX * blocksY;
    ensureQueue(size);
    const status = new Uint8Array(size);
    let head = 0, tail = 0;

    const add = (idx) => {
        if (status[idx] === 0 && grid[idx] === -1) {
            status[idx] = 1;
            queue[tail++] = idx;
        }
    };

    // Seed from borders
    for (let x = 0; x < blocksX; x++) {
        add(x);
        add((blocksY - 1) * blocksX + x);
    }
    for (let y = 1; y < blocksY - 1; y++) {
        add(y * blocksX);
        add(y * blocksX + (blocksX - 1));
    }

    // Flood fill
    while (head < tail) {
        const idx = queue[head++];
        const cx = idx % blocksX;
        const cy = (idx / blocksX) | 0;
        if (cy > 0)              add(idx - blocksX);
        if (cy < blocksY - 1)    add(idx + blocksX);
        if (cx > 0)              add(idx - 1);
        if (cx < blocksX - 1)    add(idx + 1);
    }

    return status;
}

function computeDistanceField(grid, blocksX, blocksY) {
    const size = blocksX * blocksY;
    ensureQueue(size);
    const dist = new Uint16Array(size);
    const maxDist = 999;
    dist.fill(maxDist);

    let head = 0, tail = 0;
    for (let i = 0; i < size; i++) {
        if (grid[i] === -1) {
            dist[i] = 0;
            queue[tail++] = i;
        }
    }

    while (head < tail) {
        const idx = queue[head++];
        const d = dist[idx];
        const cx = idx % blocksX;
        const cy = (idx / blocksX) | 0;

        if (cy > 0) {
            const n = idx - blocksX;
            if (dist[n] === maxDist) { dist[n] = d + 1; queue[tail++] = n; }
        }
        if (cy < blocksY - 1) {
            const n = idx + blocksX;
            if (dist[n] === maxDist) { dist[n] = d + 1; queue[tail++] = n; }
        }
        if (cx > 0) {
            const n = idx - 1;
            if (dist[n] === maxDist) { dist[n] = d + 1; queue[tail++] = n; }
        }
        if (cx < blocksX - 1) {
            const n = idx + 1;
            if (dist[n] === maxDist) { dist[n] = d + 1; queue[tail++] = n; }
        }
    }

    return dist;
}

self.onmessage = function(e) {
    const msg = e.data;
    if (msg.type === 'compute') {
        const { id, blocksX, blocksY } = msg;
        // renderGrid arrives as a transferred ArrayBuffer — wrap in Int32Array
        const renderGrid = new Int32Array(msg.renderGrid);

        const outsideMap = computeTrueOutside(renderGrid, blocksX, blocksY);
        const distMap    = computeDistanceField(renderGrid, blocksX, blocksY);

        // Transfer all buffers back to avoid copies
        self.postMessage({
            type: 'result',
            id,
            blocksX,
            blocksY,
            outsideMap: outsideMap.buffer,
            distMap: distMap.buffer,
            renderGrid: renderGrid.buffer
        }, [outsideMap.buffer, distMap.buffer, renderGrid.buffer]);
    }
};
