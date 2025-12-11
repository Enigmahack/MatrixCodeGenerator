// Name: Dirty LCD Monitor
precision mediump float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uParameter;
varying vec2 vTexCoord;

// Change this value to make the lines denser!
// It represents the WIDTH/HEIGHT of one grid cell in pixels.
const float GRID_CELL_SIZE = 2.0; // Lower numbers = More lines, but thickness is proportional
const float LINE_THICKNESS = 0.4;
const vec3 GRID_COLOR = vec3(0.0, 0.0, 0.0);
const float GRID_OPACITY = 0.5;

// Adding grain dirtyness to the screen
const float GRAIN_AMOUNT = 0.05; // Increase this value (0.0 to 1.0) to make the grain more noticeable

// Random graininess
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Boosting Pixel Brightness
const float BRIGHTNESS_THRESHOLD = 0.4; // Only pixels brighter than this will be boosted
const float BRIGHTNESS_BOOST = 1.6;     // How much to multiply the existing bright colors by


void main() {
    vec4 color = texture2D(uTexture, vTexCoord);

    vec2 pixelCoord = vTexCoord * uResolution.xy;
    vec2 scaledCoord = pixelCoord / GRID_CELL_SIZE;
    vec2 fractionalPart = fract(scaledCoord);
    float verticalLine = step(fractionalPart.x, LINE_THICKNESS);
    float horizontalLine = step(fractionalPart.y, LINE_THICKNESS);
    float gridMask = min(verticalLine + horizontalLine, 1.0);
    vec3 blendedColor = mix(color.rgb, GRID_COLOR, gridMask);
    color.rgb = mix(color.rgb, blendedColor, GRID_OPACITY);


    // 1. Calculate the final grid-processed color's overall brightness (Luminance).
    float brightness = dot(color.rgb, vec3(0.1126, 0.7152, 0.0522));

    // 2. Determine the boost factor
    // The 'step' function returns 1.0 if the condition is true, 0.0 if false.
    // If the pixel's brightness is above the threshold, this 'boostFactor' will be 1.0.
    float boostFactor = step(BRIGHTNESS_THRESHOLD, brightness);
    
    // 3. Apply the boost to the color channels.
    // We mix between a base factor of 1.0 (no change) and the desired BRIGHTNESS_BOOST.
    // mix(Color A, Color B, Factor)
    // If boostFactor is 0.0: returns 1.0 (color.rgb * 1.0)
    // If boostFactor is 1.0: returns BRIGHTNESS_BOOST (color.rgb * 1.2)
    float finalMultiplier = mix(uParameter + 1.0, BRIGHTNESS_BOOST, boostFactor * uParameter);
    
    color.rgb *= finalMultiplier;
    
    // 5. Calculate static noise    
    float noiseValue = random(vTexCoord);
    
    // Map the random value from [0.0, 1.0] to a useful noise range, e.g., [-1.0, 1.0]
    // (noiseValue - 0.5) shifts the range to [-0.5, 0.5]
    // * 2.0 expands the range to [-1.0, 1.0]
    float finalNoise = (noiseValue - 0.5) * 2.0;

    // 6. Apply grain to the color
    // We only apply the noise to the Red, Green, and Blue channels (.rgb).
    // The noise value is scaled by the GRAIN_AMOUNT.
    // A negative noise makes the pixel darker, a positive noise makes it brighter.
    color.rgb += finalNoise * GRAIN_AMOUNT;
    
    // 7. Output final color
    gl_FragColor = color;
}