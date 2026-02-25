# Writing Growth Algorithms for Quantized Block Generation

This guide outlines how to implement new procedural growth behaviors compatible with the 3-layer quantized system.

## 1. The 3-Layer Architecture

*   **Layer 0 (Structural):** The foundation. Blocks here determine the "Skeleton" and the Green Wireframe in the editor. Growth should prioritize connectivity and "filling the gaps" to ensure a solid mass.
*   **Layer 1 (Detail):** Used for bulk and secondary shapes. These can overlap Layer 0 to create visual density or extend from it to create "wings" or "limbs."
*   **Layer 2 (Accent):** The "Noise" layer. Used for sparse blocks, "floating" elements, or high-frequency details.

## 2. The Internal API Toolbox

Growth algorithms should reside in `QuantizedBaseEffect.js` (or a subclass) and utilize these core helpers:

### `_spawnBlock(x, y, w, h, layer, ...flags)`
The primary method for adding blocks. 
*   **Default Behavior:** Checks for connectivity (must touch another block on the same layer) and prevents internal stacking.
*   **`skipConnectivity: true`**: Allows placing "floating" blocks (useful for Layer 2).
*   **`bypassOccupancy: true`**: Allows placing multiple blocks in the same step at the same coordinate.

### `_getLooselyCentralAnchors(layer, sampleSize)`
Returns a list of existing blocks on a specific layer, sorted by their distance from the center. Perfect for "Expanding" algorithms.

### `_getEdgeAnchors(layer, sampleSize)`
Returns blocks furthest from the center. Ideal for "Exploring" or "Tendril" algorithms.

### `_getBiasedDirections()`
Returns `['N', 'S', 'E', 'W']` in a randomized order, weighted by the screen's aspect ratio (e.g., favoring East/West on wide screens).

## 3. Implementation Boilerplate

To write a new algorithm (e.g., a "Drunken Brancher"), follow this structure:

```javascript
_attemptBranchGrowth(targetLayer) {
    // 1. Pick a starting point (Anchor)
    const anchors = this._getEdgeAnchors(targetLayer, 10);
    if (anchors.length === 0) return false;
    const base = anchors[Math.floor(Math.random() * anchors.length)];

    // 2. Determine growth direction
    const dirs = this._getBiasedDirections();
    const dir = dirs[0]; // Take the most "preferred" direction

    // 3. Calculate new coordinates
    let nx = base.x, ny = base.y;
    if (dir === 'N') ny -= 1;
    else if (dir === 'S') ny += 1;
    else if (dir === 'E') nx += 1;
    else if (dir === 'W') nx -= 1;

    // 4. Spawn the block
    // We use allowInternal: false to ensure we are actually growing outward
    return this._spawnBlock(nx, ny, 1, 1, targetLayer, false, 0, false, false) !== -1;
}
```

## 4. Integration

Add your algorithm to the `_attemptGrowth` pool in `QuantizedBaseEffect.js`:

```javascript
_attemptGrowth() {
    // ... setup logic ...
    const pool = [];
    
    // Add your new behavior to the weighted pool
    pool.push(() => this._attemptBranchGrowth(targetLayer));
    
    // ... execution logic ...
}
```

## 5. Best Practices

1.  **Connectivity is King:** Always try to grow from existing blocks. "Floating" blocks should be rare and primarily on Layer 2.
2.  **Aspect Awareness:** Use `this._getBiasedDirections()` to ensure the pattern fills the screen naturally regardless of resolution.
3.  **Layer Rotation:** The system automatically rotates `targetLayer` per step. Your algorithm should respect the passed `targetLayer` to maintain the 3-layer balance.
4.  **Step Occupancy:** The system uses `_stepOccupancy` to prevent two algorithms from spawning in the same spot during a single step. Do not bypass this unless implementing a "Stacking" specific effect.
