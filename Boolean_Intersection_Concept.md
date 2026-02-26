# The Boolean Intersection Concept

To replicate the erratic sliding, clipping, and sudden appearances of the quantized blocks, the system must be separated into two distinct logic layers: the **Architecture (The Maze)** and the **Mask (The Spotlight)**. 

The visible result is only the intersection of these two layers.

---

## 1. Layer A: The Hidden Architecture (The Maze)
Imagine an invisible blueprint that covers the screen. This blueprint dictates the exact shape, size, and location of every block. 
*   **Behavior:** It does not "slide" or "shrink". It either exists statically from the start, or slowly grows outward like a crystal. Once a block is mapped here, its coordinates are locked to the grid.

```text
       [THE HIDDEN ARCHITECTURE]
       
  ┌────────┐           ┌──────┐
  │        │           │      │
  │        │           │      │
  └────────┼───────────┤      │
           │           │      │
           └───────────┴──────┘
```

## 2. Layer B: The Illumination Mask (The Spotlight)
Imagine invisible shapes (rectangles, bands, or sweeping squares) moving dynamically across the screen.
*   **Behavior:** These shapes are highly kinetic. They slide, expand, and jump around rapidly. They do not snap to the grid in the same way; their borders can move freely.

```text
         [THE ILLUMINATION MASK]
         
               ░░░░░░░░░░░
               ░         ░
               ░  MASK   ░
               ░         ░
               ░░░░░░░░░░░
```

## 3. The Rendered Result (Visible Output)
The rendering engine checks both layers. It only draws the bright yellow borders of the **Architecture** *if* they fall inside the boundaries of the **Illumination Mask**.

```text
             [THE VISIBLE RESULT]
             
  ┌────────┐   ░░░░░░░░░░░
  │        │   ░       ┌─┼────┐
  │        │   ░       │ ░    │
  └────────┼───░───────┤ ░    │  =>  Only this right section is rendered.
           │   ░       │ ░    │      The left side is hidden in darkness.
           └───░───────┴─░────┘
               ░░░░░░░░░░░
```

---

## How This Explains the Animation Anomalies

### Scenario A: The "Sliding" Block (Frames 13 -> 14)
If the block was an object moving on its own, its borders would remain intact. But if we use the Intersection logic, watch what happens when the Mask simply moves **UP** by one row:

**Frame 1:** Mask covers the whole right block.
```text
               ░░░░░░░░░░░
               ░       ┌─┼────┐
               ░       │ ░    │
               ░       │ ░    │  => Whole block is visible.
               ░       │ ░    │
               ░───────┴─░────┘
               ░░░░░░░░░░░
```

**Frame 2:** Mask moves UP. The Architecture underneath hasn't changed at all.
```text
               ░░░░░░░░░░░
               ░       ┌─┼────┐
               ░       │ ░    │
               ░       │ ░    │  => The bottom is suddenly "severed".
               ░░░░░░░░░░░    │     A ghost line is left where the old bottom was.
                       │      │
                       └──────┘
```
**Visual Effect:** The block instantly "shrunk" perfectly horizontally, leaving a temporal ghost trail. This is the exact behavior seen in Frame 14.

### Scenario B: The Spontaneous Island (Frames 16 -> 17 -> 18)
How does a disconnected block appear and disappear in the void without growing from the center?

1.  **Frame 16:** The Architecture exists in the void, but no Mask covers it. It is invisible.
2.  **Frame 17:** A fast-moving Mask sweeps over that specific quadrant. 
    *   *Result:* The Intersection is true. The block instantly lights up (appears).
3.  **Frame 18:** The Mask continues moving and passes the block.
    *   *Result:* The Intersection is false again. The block instantly vanishes, leaving ghost lines.

### Conclusion
By making the "blocks" static and the "visibility" dynamic, you gain the strict architectural snapping of the matrix aesthetic while retaining the chaotic, glitchy reveal sequence.