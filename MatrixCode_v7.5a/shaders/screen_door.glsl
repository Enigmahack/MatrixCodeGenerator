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

// Boosting Pixel Brightness
const float BRIGHTNESS_THRESHOLD = 0.4; // Only pixels brighter than this will be boosted
const float BRIGHTNESS_BOOST = 1.6;     // How much to multiply the existing bright colors by


void main() {
    vec4 color = texture2D(uTexture, vTexCoord);

    vec2 pixelCoord = vTexCoord * uResolution.xy;
    vec2 scaledCoord = pixelCoord / GRID_CELL_SIZE;
    vec2 fractionalPart = fract(scaledCoord * uParameter);
    float verticalLine = step(fractionalPart.x, LINE_THICKNESS * uParameter + 0.1);
    float horizontalLine = step(fractionalPart.y, LINE_THICKNESS * uParameter + 0.1);
    float gridMask = min(verticalLine + horizontalLine, 1.0);
    vec3 blendedColor = mix(color.rgb, GRID_COLOR, gridMask);
    color.rgb = mix(color.rgb, blendedColor, GRID_OPACITY * uParameter);


    // 1. Calculate the final grid-processed color's overall brightness (Luminance).
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

    // 2. Determine the boost factor
    // The 'step' function returns 1.0 if the condition is true, 0.0 if false.
    // If the pixel's brightness is above the threshold, this 'boostFactor' will be 1.0.
    float boostFactor = step(BRIGHTNESS_THRESHOLD, brightness);
    
    // 3. Apply the boost to the color channels.
    // We mix between a base factor of 1.0 (no change) and the desired BRIGHTNESS_BOOST.
    // mix(Color A, Color B, Factor)
    // If boostFactor is 0.0: returns 1.0 (color.rgb * 1.0)
    // If boostFactor is 1.0: returns BRIGHTNESS_BOOST (color.rgb * 1.2)
    float finalMultiplier = mix(1.0, BRIGHTNESS_BOOST, boostFactor);
    
    color.rgb *= finalMultiplier;

    gl_FragColor = color;
}