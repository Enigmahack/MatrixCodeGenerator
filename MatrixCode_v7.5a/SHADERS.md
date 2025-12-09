# Matrix Digital Rain - Shader Guide

This guide explains how to create and use custom WebGL fragment shaders in the Matrix Digital Rain application.

## Overview

The application includes a `PostProcessor` system that allows you to apply full-screen visual effects (post-processing) to the rendered Matrix animation. This is done using WebGL fragment shaders.

The system renders the 2D Canvas content into a WebGL texture (`uTexture`) and draws it onto a full-screen quad. Your shader determines how each pixel of that quad is colored.

## Available Uniforms

Your shader will receive the following variables (uniforms) automatically:

| Uniform Name | Type | Description |
| :--- | :--- | :--- |
| `uTexture` | `sampler2D` | The rendered Matrix frame (the source image). |
| `uResolution` | `vec2` | The dimensions of the canvas in pixels (x: width, y: height). |
| `uTime` | `float` | The elapsed time in seconds since the simulation started. |

**Important:** The shader also receives `varying vec2 vTexCoord` from the vertex shader. **Always use this for texture lookups** to ensure the image is oriented correctly.

## Basic Shader Structure

A minimal shader that just displays the image looks like this:

```glsl
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
varying vec2 vTexCoord;

void main() {
    // Sample using vTexCoord to avoid flipping
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // Output the color
    gl_FragColor = color;
}
```

## How to Load a Custom Shader

The application now supports importing `.glsl` files directly through the Settings UI.

1.  Open the **Settings Panel**.
2.  Navigate to the **FX** tab.
3.  Scroll down to the **Post Processing** section.
4.  Enable **Custom Shader**.
5.  Click **Import Fragment Shader (.glsl)**.
6.  Select your shader file (e.g., `shaders/film_grain.glsl`).



**Fixing Orientation:**
The current version uses `vTexCoord` to ensure the correct orientation, if needed.

## Performance Tips

*   **Precision:** Use `mediump float` for better performance on mobile devices.
*   **Complexity:** Avoid heavy loops or complex branching (if/else) inside the shader, as this runs for every single pixel.
*   **Texture Lookups:** Minimize the number of `texture2D` calls if possible.