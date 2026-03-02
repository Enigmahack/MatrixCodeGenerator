/**
 * QuantizedAnimationOptimizer.js
 * 
 * Provides functions for optimizing quantized animation sequences by removing redundant operations.
 */

class QuantizedAnimationOptimizer {
    constructor() {
        // Using Maps for sparse grids is more memory-efficient than large arrays
        // The key is a string "x,y" for easy access.
        this.layerGrids = [
            new Set(), // Layer 0
            new Set(), // Layer 1
            new Set(), // Layer 2
            new Set()  // Layer 3
        ];
    }

    _isOccupied(x, y, layer) {
        if (layer < 0 || layer >= this.layerGrids.length) return false;
        return this.layerGrids[layer].has(`${x},${y}`);
    }

    _setOccupied(x, y, layer, isOccupied) {
        if (layer < 0 || layer >= this.layerGrids.length) return;
        const key = `${x},${y}`;
        if (isOccupied) {
            this.layerGrids[layer].add(key);
        } else {
            this.layerGrids[layer].delete(key);
        }
    }
    
    /**
     * Optimizes a full animation sequence.
     * @param {Array} sequence - The raw animation sequence.
     * @returns {Array} The optimized animation sequence.
     */
    optimize(sequence) {
        const optimizedSequence = [];

        // Reset grid state for each new sequence
        this.layerGrids.forEach(grid => grid.clear());

        for (const step of sequence) {
            const optimizedStep = this._optimizeStep(step);
            optimizedSequence.push(optimizedStep);
        }
        
        return optimizedSequence;
    }

    /**
     * Optimizes a single step in the sequence.
     * @param {Array} step - A list of operation objects.
     * @returns {Array} The optimized list of operations for the step.
     */
    _optimizeStep(step) {
        const effectiveOps = [];
        // A temporary grid to track changes within THIS step
        const stepGridChanges = new Map(); // key: "x,y,layer", value: 'add' or 'rem'

        for (const opObj of step) {
            const opName = opObj.op || opObj[0];
            const layer = opObj.layer !== undefined ? opObj.layer : 0;
            
            // Per user instructions, nudges are never optimized out
            if (opName === 'nudge' || opName === 'nudgeML') {
                effectiveOps.push(opObj);
                continue;
            }

            const args = opObj.args || (Array.isArray(opObj) ? opObj.slice(1) : []);
            let coords = [];
            if (opName === 'add' || opName === 'removeBlock' || opName === 'addSmart' || opName === 'rem') {
                coords.push({ x: args[0], y: args[1] });
            } else if (opName === 'addRect') {
                const [x1, y1, x2, y2] = args;
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                        coords.push({ x, y });
                    }
                }
            }

            if (coords.length === 0) continue;

            let isRedundant = true;
            
            if (opName.startsWith('add')) {
                // An 'add' is redundant if ALL its target cells are already occupied.
                for (const { x, y } of coords) {
                    if (!this._isOccupied(x, y, layer)) {
                        isRedundant = false;
                        break;
                    }
                }
            } else if (opName.startsWith('rem')) {
                // A 'remove' is redundant if ALL its target cells are already empty.
                for (const { x, y } of coords) {
                    if (this._isOccupied(x, y, layer)) {
                        isRedundant = false;
                        break;
                    }
                }
            }

            if (!isRedundant) {
                // Intra-step optimization: check for `add` then `remove` on the same cell
                let cancelOp = false;
                for (const { x, y } of coords) {
                    const changeKey = `${x},${y},${layer}`;
                    const pendingChange = stepGridChanges.get(changeKey);

                    if (opName.startsWith('add') && pendingChange === 'rem') {
                        // Pattern: rem -> add. This is a valid "blink". We keep the 'add' and remove the 'rem'.
                        // We find the original 'rem' op and remove it.
                        const opToRemoveIndex = effectiveOps.findIndex(op => 
                            op.args[0] === x && op.args[1] === y && op.layer === layer && op.op.startsWith('rem')
                        );
                        if (opToRemoveIndex > -1) {
                            effectiveOps.splice(opToRemoveIndex, 1);
                        }
                        stepGridChanges.delete(changeKey); // Clear the history for this cell
                    } else if (opName.startsWith('rem') && pendingChange === 'add') {
                        // Pattern: add -> rem. The 'add' is redundant.
                        // We find the original 'add' op and remove it.
                        const opToRemoveIndex = effectiveOps.findIndex(op => 
                            op.args[0] === x && op.args[1] === y && op.layer === layer && op.op.startsWith('add')
                        );
                        if (opToRemoveIndex > -1) {
                            effectiveOps.splice(opToRemoveIndex, 1);
                        }
                        // The current 'rem' is also redundant because the cell was empty before the 'add'. So we cancel this op.
                        cancelOp = true;
                        stepGridChanges.delete(changeKey);
                    }
                }

                if (!cancelOp) {
                    effectiveOps.push(opObj);
                    // Log the change for this step
                    for (const { x, y } of coords) {
                        const changeKey = `${x},${y},${layer}`;
                        stepGridChanges.set(changeKey, opName.startsWith('add') ? 'add' : 'rem');
                    }
                }
            }
        }

        // Apply the effective operations to the main grid state for the next step
        for (const opObj of effectiveOps) {
            const opName = opObj.op || opObj[0];
            const layer = opObj.layer !== undefined ? opObj.layer : 0;
            const args = opObj.args || (Array.isArray(opObj) ? opObj.slice(1) : []);
            
            let coords = [];
             if (opName === 'add' || opName === 'removeBlock' || opName === 'addSmart' || opName === 'rem') {
                coords.push({ x: args[0], y: args[1] });
            } else if (opName === 'addRect') {
                const [x1, y1, x2, y2] = args;
                for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                        coords.push({ x, y });
                    }
                }
            }

            for (const { x, y } of coords) {
                this._setOccupied(x, y, layer, opName.startsWith('add'));
            }
        }

        return effectiveOps;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuantizedAnimationOptimizer;
}
