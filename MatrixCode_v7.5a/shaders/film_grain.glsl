precision mediump float;

// Uniforms provided by PostProcessor.js
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uParameter;

// Use vTexCoord from Vertex Shader for correct orientation
varying vec2 vTexCoord;

// Shader Configuration
const float GRAIN_AMOUNT = 0.1; // Intensity of the grain (0.0 to 1.0)
const bool ANIMATED = true;      // Whether the grain dances (true) or is static (false)
const float SPEED = 2.2;         // Speed of grain animation

// Random function
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // Sample the original texture using standard texture coordinates
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // Calculate noise
    // We can use gl_FragCoord or vTexCoord for noise seed
    float t = ANIMATED ? uTime * SPEED : 0.0;
    
    // Generate random noise value [-1.0, 1.0]
    float noise = (random(vTexCoord + t) - 0.5) * 2.0;
    
    // Apply grain
    color.rgb += noise * ((uParameter - 0.1) + GRAIN_AMOUNT);
    
    // Output final color
    gl_FragColor = color;
}
