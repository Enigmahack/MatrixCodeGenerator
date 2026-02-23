/**
 * QuantizedStateCache.js
 * Specialized caching system for the Quantized Effect Editor to support fast backward scrubbing.
 * Caches full snapshots of the simulation state at regular step intervals.
 */
class QuantizedStateCache {
    constructor() {
        this.snapshots = new Map(); // StepIndex -> Snapshot Object
        this.maxSnapshots = 100;    // Adjust based on memory
        this.interval = 5;          // Cache every N steps
    }

    /**
     * Captures a snapshot of the current state of a Quantized effect.
     */
    capture(fx, stepIndex) {
        if (stepIndex % this.interval !== 0) return;
        if (this.snapshots.has(stepIndex)) return;

        // Cleanup oldest if limit reached
        if (this.snapshots.size >= this.maxSnapshots) {
            const oldest = Math.min(...this.snapshots.keys());
            this.snapshots.delete(oldest);
        }

        const snapshot = {
            stepIndex,
            animFrame: fx.animFrame,
            nextBlockId: fx.nextBlockId,
            proceduralLayerIndex: fx.proceduralLayerIndex,
            
            // Grids
            logicGrid: new Uint8Array(fx.logicGrid),
            renderGrid: new Int32Array(fx.renderGrid),
            layerGrids: fx.layerGrids.map(g => new Int32Array(g)),
            removalGrids: fx.removalGrids.map(g => new Int32Array(g)),
            
            // Ops & Blocks (Full copies to ensure isolation)
            maskOps: JSON.parse(JSON.stringify(fx.maskOps)),
            activeBlocks: JSON.parse(JSON.stringify(fx.activeBlocks)),
            
            // Line States
            lineStates: new Map(fx.lineStates),
            
            // Procedural (Optional based on effect type)
            unfoldSequences: fx.unfoldSequences ? JSON.parse(JSON.stringify(fx.unfoldSequences)) : null,
            finishedBranches: fx.finishedBranches ? new Set(fx.finishedBranches) : null,
            rearrangePool: fx.rearrangePool ? [...fx.rearrangePool] : null
        };

        this.snapshots.set(stepIndex, snapshot);
    }

    /**
     * Finds the nearest snapshot at or before the target step.
     */
    getNearest(targetStep) {
        let bestStep = -1;
        for (const step of this.snapshots.keys()) {
            if (step <= targetStep && step > bestStep) {
                bestStep = step;
            }
        }
        return bestStep !== -1 ? this.snapshots.get(bestStep) : null;
    }

    /**
     * Restores an effect's state from a snapshot.
     */
    restore(fx, snapshot) {
        fx.animFrame = snapshot.animFrame;
        fx.nextBlockId = snapshot.nextBlockId;
        fx.proceduralLayerIndex = snapshot.proceduralLayerIndex;
        fx.expansionPhase = snapshot.stepIndex;

        fx.logicGrid.set(snapshot.logicGrid);
        fx.renderGrid.set(snapshot.renderGrid);
        
        snapshot.layerGrids.forEach((g, i) => fx.layerGrids[i].set(g));
        snapshot.removalGrids.forEach((g, i) => fx.removalGrids[i].set(g));

        fx.maskOps = JSON.parse(JSON.stringify(snapshot.maskOps));
        fx.activeBlocks = JSON.parse(JSON.stringify(snapshot.activeBlocks));
        
        fx.lineStates = new Map(snapshot.lineStates);
        
        if (snapshot.unfoldSequences) fx.unfoldSequences = JSON.parse(JSON.stringify(snapshot.unfoldSequences));
        if (snapshot.finishedBranches) fx.finishedBranches = new Set(snapshot.finishedBranches);
        if (snapshot.rearrangePool) fx.rearrangePool = [...snapshot.rearrangePool];

        fx._lastProcessedOpIndex = fx.maskOps.length;
        fx._lastRendererOpIndex = fx.maskOps.length;
        fx._gridsDirty = true;
        fx._maskDirty = true;
    }

    invalidate(fromStep = 0) {
        for (const step of this.snapshots.keys()) {
            if (step >= fromStep) {
                this.snapshots.delete(step);
            }
        }
    }

    clear() {
        this.snapshots.clear();
    }
}
