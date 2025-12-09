precision mediump float;

// Inputs provided by the application
uniform sampler2D uTexture;
// uniform float uTime; // NOT needed for static grain
varying vec2 vTexCoord;

// Shader Configuration
const float GRAIN_AMOUNT = 0.05; // Increase this value (0.0 to 1.0) to make the grain more noticeable

// 1. Random function
// Generates a seemingly random float based on the input coordinate 'st'.
float random(vec2 st) {
    // This uses a "magic" dot product and large number to generate noise.
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // 2. Sample the original texture
    vec4 color = texture2D(uTexture, vTexCoord);
    
    // 3. Calculate static noise
    // The key here is to pass only the coordinate (vTexCoord) to the random function.
    // We are NOT using 'uTime', so the result for any given coordinate is always the same.
    float noiseValue = random(vTexCoord);
    
    // Map the random value from [0.0, 1.0] to a useful noise range, e.g., [-1.0, 1.0]
    // (noiseValue - 0.5) shifts the range to [-0.5, 0.5]
    // * 2.0 expands the range to [-1.0, 1.0]
    float finalNoise = (noiseValue - 0.5) * 2.0;

    // 4. Apply grain to the color
    // We only apply the noise to the Red, Green, and Blue channels (.rgb).
    // The noise value is scaled by the GRAIN_AMOUNT.
    // A negative noise makes the pixel darker, a positive noise makes it brighter.
    color.rgb += finalNoise * GRAIN_AMOUNT;
    
    // 5. Output final color
    gl_FragColor = color;
}