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
| `uTime` | `float` | The elapsed time in seconds since the simulation started, in milliseconds. |
| `uMouse` | `vec2` | The normalized mouse coordinates (x: 0.0-1.0, y: 0.0-1.0, with y=0.0 at bottom). |
| `uParameter` | `float` | A general-purpose float value (0.0-1.0) controllable via a UI slider. |

**Important:** The shader also receives `varying vec2 vTexCoord` from the vertex shader. **Always use this for texture lookups** to ensure the image is oriented correctly. The `vTexCoord` ranges from (0.0, 0.0) at the bottom-left to (1.0, 1.0) at the top-right of the texture.

## Basic Shader Structure

A minimal shader that just displays the image looks like this:

```glsl
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter;
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
5.  Adjust the **Shader Parameter** slider to control the `uParameter` uniform in your shader.
6.  Click **Import Fragment Shader (.glsl)**.
7.  Select your shader file (e.g., `shaders/film_grain.glsl`).

## Shader Chaining & System Effects

The rendering pipeline consists of two potential shader passes that run in sequence:
1.  **System Effect Pass:** Used by internal effects like "Deja Vu", "Crash Sequence", or "Boot Sequence".
2.  **Custom User Pass:** Your custom shader loaded via the settings.

**Behavior:**
*   If a System Effect is active, it runs first (Pass 1).
*   If a Custom User Shader is active, it runs second (Pass 2), applying your custom look (e.g., CRT, Grain) **on top of** the system effect.
*   This ensures your custom visual style remains consistent even during special events.

## Performance Tips

*   **Precision:** Use `mediump float` for better performance on mobile devices.
*   **Complexity:** Avoid heavy loops or complex branching (if/else) inside the shader, as this runs for every single pixel.
*   **Texture Lookups:** Minimize the number of `texture2D` calls if possible.