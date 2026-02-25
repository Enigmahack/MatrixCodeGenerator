# Generative Algorithm: Quantized Telescoping Growth

## 1. Movement Philosophy: "No Holes"
The animation does not "move" a single object. It performs **Additive Extrusion**. When a block shifts from Point A to Point B:
*   **Point A** remains active (Static).
*   **Point B** is a new pane that fades in over `fadingDuration`. This will instantaneously reveal the shadow world but will fade out the current code background. If removed, the code background is instantly revealed and the shadow world fades at the same rate as 'fadingDuration'.
*   **Result:** A trail of "panes of glass" is left behind, creating a solid mass with no holes.

## 2. The Telescoping Algorithm (Placement Logic)
To replicate the "Outwards Shifting" pattern:
1.  **Hierarchy:** Every block has a `Parent` and an `Axis`.
2.  **Axis Alternation:** 
    *   If Parent = **Vertical** (Spine), the Child must be **Horizontal** (Rib).
    *   If Parent = **Horizontal** (Rib), the Child must be **Vertical** (Extension).
3.  **Centered Snapping:**
    *   Children are always centered on the mid-point of the Parent's length.
    *   Children "snap" to the grid columns/rows defined by the Grid Management class.
4.  **The "Slide Out" Animation:**
    *   Initialize Child `width/height` to be equal to the Parent (Invisible overlap).
    *   Interpolate `size` toward the `TargetSize` over `N` frames.
    *   This creates the sensation of the block "sliding out" from the interior of the previous one.

## 3. Layering & Boldness
*   **Additive Density:** The "Bold Lines" seen in source images are the result of **Mathematical Overlap**.
*   **Spine Priority:** Layer 0 (The Vertical Spine) is the primary anchor.
*   **Rib Property:** Layer 1 (Horizontal Ribs) often has lower opacity (~50%).
*   **Behavior:** When Layer 1 overlaps Layer 0, the total opacity in the intersection exceeds 100%, causing the shader to "blow out" into white/yellow. 
*   **Observation:** Areas with 3+ overlapping panes create the "Brilliant" core of the effect.

## 4. Invisible / Ghost Layers
The "appearing out of nowhere" block islands effect is explained by **Threshold Intersections**:
*   A "Ghost Layer" (Layer 3) exists with very low visibility (0 - 5%).
*   It moves diagonally or at a different speed than the primary Spine.
*   When this ghost layer intersects with a primary layer, the additive sum crosses the "Visibility Threshold" in the shader, suddenly revealing a section of code from the shadow world.

## 5. Summary of Observation-Based Rules
*   **Vertical Bias:** Initial generation (Steps 1-10) is 80% biased toward Vertical Spines.
*   **Lateral Buds:** Horizontal Ribs have a higher probability of spawning as the Spine height increases.
*   **Nudge Logic:** If a new block is spawned in a dense area, existing children are "Nudged" (shifted) by 1 grid unit outward to maintain structural spacing.

## 6. Randomness & Connectivity (The "Island" Logic)
To prevent the shape from looking like a simple solid block, the following randomness rules apply:

### A. Non-Adjacent Spawning ("Jumps")
*   **The Rule:** A Child pane is algorithmically tied to a Parent but is not required to touch its edge.
*   **The Math:** `Child.Position = Parent.Edge + Offset`.
*   **Offset:** Typically a random choice between `0` (Touching), `1` (1-unit gap), or `2` (2-unit gap).
*   **Result:** This creates "Floating Islands" of code that move in perfect synchronization with the main mass, confirming they belong to the same logical "Glass Pane" layer.

### B. Growth Termination (The "Volume" Cap)
The algorithm does not fill the screen. It operates in three phases:
1.  **Explosion Phase (Steps 1-8):** High branching probability (1 Parent -> 2+ Children). Focuses on reaching the screen boundaries.
2.  **Consolidation Phase (Steps 9-15):** Medium branching (1 Parent -> 1 Child). Focuses on filling internal gaps and adding "Ribs."
3.  **Detail Phase (Steps 16+):** Low branching. Adds small 1x1 or 1x2 "bits" to the perimeter to increase visual complexity.
4.  **Stop Condition:** Growth stops when a `Max_Block_Count` is reached or the "Reveal" transition is complete.

### C. Dimensional Variety
*   **Panes are never uniform.** 
*   Spines (Vertical) vary in height between 4 and 12 units.
*   Ribs (Horizontal) vary in width between 2 and 6 units.
*   Small "Noise Blocks" (1x1) are peppered in during the Detail Phase to break up long straight lines.