// Name: Double Vision
precision mediump float;

// Inputs provided by the application
uniform sampler2D uTexture;
uniform float uTime;
uniform float uParameter;
varying vec2 vTexCoord;

// Configuration for the effect
const float BLUR_SAMPLES = 2.0; // How many times to sample the texture (higher = smoother but slower)
const float BLUR_AMOUNT = 0.0001; // How intense the blur is

void main() {
    // 1. Center the coordinates
    // We shift vTexCoord (0.0 to 1.0) so that the center of the screen is (0.0, 0.0).
    vec2 center = vec2(0.5, 0.5); // The blur's origin point (center of the screen)
    vec2 direction = vTexCoord - center; // Vector pointing from center to the current pixel

    // 2. Initialize the final color
    // We start with a black color (vec4(0.0))
    vec4 finalColor = vec4(0.0);

    // 3. Loop through samples
    for (float i = 0.0; i < BLUR_SAMPLES; i++) {
        // Calculate the current step along the blur ray.
        // The 'mix' function smoothly interpolates (mixes) between two values.
        // It's used here to define a position along the ray from 0.0 (center) to 1.0 (current pixel).
        float step = i / (BLUR_SAMPLES - 1.0);

        // Calculate the new coordinate for this sample.
        // This coordinate is closer to the center than the original vTexCoord.
        vec2 sampleCoord = mix(vTexCoord, center, step * BLUR_AMOUNT * (uParameter * 10.0) * 100.0);
        
        // --- IMPORTANT LOGIC EXPLAINED BELOW ---
        // 'mix(A, B, t)' returns A*(1-t) + B*t. 
        // We use 'step * BLUR_AMOUNT * 100.0' to control how much to mix towards the center.
        // The factor of 100.0 turns the small BLUR_AMOUNT (e.g., 0.005) into a more usable ratio (e.g., 0.5).

        // Sample the color at the new, shifted coordinate
        vec4 sampledColor = texture2D(uTexture, sampleCoord);

        // Add the sampled color to our final average
        finalColor += sampledColor;
    }

    // 4. Calculate the average color
    // Divide the accumulated colors by the number of samples taken.
    gl_FragColor = finalColor / BLUR_SAMPLES;
}