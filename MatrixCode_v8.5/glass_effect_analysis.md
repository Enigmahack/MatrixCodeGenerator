# Glass Effect Analysis & Shader Implementation Guide

Based on the visual analysis of the "real_step" and "real_vert_step" sequences, the "Glass" effect can be modeled as a **multi-stage post-processing shader** that treats the quantized blocks as volumetric lenses.

To accurately recreate the refraction, layer overlapping, and border glows, use the following technical breakdown:

## 1. The Core Refraction Model
The "glass" isn't just a window; it's a **coordinate displacement**.

*   **Coordinate Warp:** For every pixel inside a quantized block, don't sample the "Shadow World" at its current `(u, v)`. Instead, sample at `(u + offset_x, v + offset_y)`.
*   **Quantized Lens:** Calculate the `offset` based on the distance from the block's center. This creates a "pillow" or "barrel" distortion within each individual block, making them look like separate physical panes of glass.
*   **Chromatic Aberration:** Disperse the refraction. Sample the Red, Green, and Blue channels of the Shadow World with slightly different offsets (e.g., `R` at 105% displacement, `G` at 100%, `B` at 95%). This creates the "rainbow" edges seen where the code is most refracted.

## 2. Modeling the "Refraction Lines"
The lines that appear to "trap" or "bend" the code are the result of the transition between coordinate systems at the block boundaries.

*   **Edge Highlight (Fresnel):** Implement a "Fresnel" effect on the inner perimeter of each block. As the view vector approaches the edge of the glass (the boundary of the block), increase the additive brightness.
*   **Specular Bevel:** Add a 1-pixel wide, high-intensity line (White/Cyan) on the **Top** and **Left** edges of the blocks, and a 1-pixel dark "shadow" on the **Bottom** and **Right**. This gives the quantized blocks a 3D beveled appearance.

## 3. Layer Overlapping & Border Glow
To handle the "multiple overlapping layers" and the resulting glow:

*   **Additive Masking:** Use a floating-point buffer for your mask. If two blocks overlap, the pixel value becomes `2.0` instead of `1.0`.
*   **Intensity Scaling:** In your shader, use this value to scale the effect:
    *   `Refraction Magnitude = base_refraction * maskValue`
    *   `Glow Intensity = base_glow * pow(maskValue, 2.0)`
*   This ensures that where blocks "stack," the refraction becomes more chaotic and the edges "burn" with a brighter cyan/white glow, exactly as seen in `real_step (20).png`.

## 4. Shadow World Interaction
The "Shadow World" should be rendered at a lower brightness and with a slight blur *unless* it is being viewed through the glass.

*   **Reveal Logic:** The Glass blocks act as a "Clear" and "Brighten" filter.
*   **Code "Trapping":** As a stream of code enters a block, apply a momentary **Temporal Warp**. Stretch the characters vertically for the first few frames they are inside the glass to simulate the "entry" refraction.

## Recommended Shader Prompt Strategy
If you are prompting an AI or writing the GLSL logic, use these specific technical descriptors:

> "Implement a 2D Glass Refraction Shader using a quantized grid mask.
> 1. **Displacement:** Perform a texture lookup on the 'Shadow World' buffer using a coordinate offset mapped to the local center of each grid block.
> 2. **Dispersion:** Apply chromatic aberration by shifting RGB sample offsets proportionally to the displacement magnitude.
> 3. **Volumetrics:** Use an additive mask buffer to track overlapping glass layers. Scale the refractive index and the 'Edge Glow' brightness using a quadratic curve based on the mask density.
> 4. **Aesthetics:** Render a dashed yellow perimeter (the grid) with an underlying Cyan-White Fresnel glow. Add a specular bevel highlight on the top-left axes of the blocks to simulate physical depth.
> 5. **Transmission:** Brighten and sharpen the background code simulation only where the mask is active, applying a subtle 'bloom' to the green characters."
