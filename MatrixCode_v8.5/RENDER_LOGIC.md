# Rendering Pipeline: Glass Pane Effect

## 1. The Global Architecture
This implementation utilizes a **Texture-Masking** strategy. Instead of drawing characters directly, we generate a "Visibility Mask" that acts as a viewport into the Shadow World.

### The Render Targets (FBOs)
*   **FBO_A (Shadow World):** The continuously running background code simulation (State 2).
*   **FBO_B (Glass Mask):** A grayscale canvas where Brightness = Visibility.
*   **FBO_C (Composed):** The output of the Composition Shader.
*   **FBO_D (Bloom):** The final post-processed result.

## 2. Pass 3: The Composition Shader (GLSL)
This shader is responsible for the "reflection" logic. It binds the Shadow World and the Glass Mask as uniforms.

### Fragment Logic
1.  **Sample Textures:**
    *   `vec4 code = texture2D(u_shadowWorld, v_uv);`
    *   `vec4 mask = texture2D(u_glassMask, v_uv);`
2.  **Define Thresholds:**
    *   `float glassBody = 0.3;` (Interior transparency)
    *   `float glassEdge = 1.0;` (Glowing border)
3.  **Selective Reveal Math:**
    *   `float isVisible = step(0.1, mask.r);`
    *   `float isEdge = smoothstep(0.4, 1.0, mask.r);`
4.  **The "Reflection" Interaction:**
    *   `vec3 finalColor = code.rgb * isVisible * glassBody;` (Base visibility)
    *   `finalColor += code.rgb * isEdge * 5.0;` (Boosted edge brightness)
    *   *Note:* Multiplying by `code.rgb` ensures the edge is invisible if no code is present.

## 3. Pass 4: High-Performance Bloom
To achieve the "neon" bleed from the edges:
1.  **Downsample:** Take FBO_C and downscale it to 1/4 size.
2.  **High-Pass:** Discard pixels with brightness < 0.8.
3.  **Blur:** Apply a dual-pass Gaussian blur (Horizontal then Vertical).
4.  **Additive Composite:** Add the blurred result back onto FBO_C.

## 4. Javascript Integration (The Canvas 2D Mask)
The `u_glassMask` texture is updated every frame from a hidden 2D canvas:
1.  **Clear:** Fill with `rgba(0,0,0,1)`.
2.  **Draw Body:** Use `globalAlpha` to draw filled rectangles at `rgb(76,76,76)` (30%).
3.  **Draw Edges:** Use the existing line drawing class to draw strokes at `rgb(255,255,255)` (100%).
4.  **Transition:** Use the `fadingDuration` property to decrement the alpha of specific panes as they move or expire.