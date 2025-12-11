precision mediump float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uParameter;
varying vec2 vTexCoord;

// Change this value to make the lines denser!
// It represents the WIDTH/HEIGHT of one grid cell in pixels.
const float GRID_CELL_SIZE = 2.0; // Lower numbers = lines closer together, but line thickness is proportional
const float LINE_THICKNESS = 0.3;
const vec3 GRID_COLOR = vec3(0.0, 0.0, 0.0);
const float GRID_OPACITY = 0.5;

// CRT Color Shift (Chromatic Aberration) Settings
const float SHIFT_AMOUNT = 0.01;       // Magnitude of the color fringe (very small)

// Brightness Boost (Thresholding/Glow) Settings
const float BRIGHTNESS_THRESHOLD = 0.3;  // Only pixels brighter than this will be boosted
const float BRIGHTNESS_BOOST = 1.6;      // How much to multiply bright colors by

// --- Barrel Distortion Settings ---
const float BARREL_DISTORTION_AMOUNT = 1.0; // Controls the bulge magnitude (0.0 to 1.0)

void main() {
    
    // --- 1. CRT Barrel Distortion (Warp) ---
    
    // A. Center coordinates: shifts vTexCoord from [0.0, 1.0] to [-0.5, 0.5]
    vec2 centeredCoord = vTexCoord - 0.5;
    
    // B. Calculate distance squared from center
    // The distortion effect should be stronger in the corners than in the middle.
    // dot(v, v) is a fast way to get length squared (r*r).
    float r2 = dot(centeredCoord, centeredCoord); 
    
    // C. Calculate the distortion factor
    // The factor must be > 1.0 for a convex (bulging) look. 
    // It's calculated by adding a fraction of the distance (r2) to 1.0.
    float factor = 1.0 + r2 * (BARREL_DISTORTION_AMOUNT * uParameter * 0.25);

    // D. Apply the factor and shift back to 0.0-1.0 range
    // This coordinate will be our base for sampling the warped image.
    vec2 warpedTexCoord = centeredCoord * factor + 0.5;

    // --- Boundary Check ---
    // If the warped coordinate is outside [0.0, 1.0], it's smeared/clipped.
    // The 'any' function checks if any component (x or y) of the boolean vector is true.
    if (any(lessThan(warpedTexCoord, vec2(0.0))) || any(greaterThan(warpedTexCoord, vec2(1.0)))) {
        // If the coordinate is outside the bounds, output black (or transparent)
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return; // Exit the shader immediately to skip all further calculations
    }

    // --- 2. CRT Chromatic Shift (Red/Blue Fringing) ---
    
    // The centerBias calculation remains based on the original vTexCoord 
    // to keep the color shift aligned with the screen's surface.
    vec2 pixelCoord = vTexCoord * uResolution.xy;
    vec2 scaledCoord = pixelCoord / GRID_CELL_SIZE;
    vec2 fractionalPart = fract(scaledCoord);
    
    float centerBias = fractionalPart.x - 0.5; 
    float shiftMagnitude = sin(centerBias * 3.14159265); 

    // Sample the texture three times using the **warpedTexCoord** as the base
    vec2 redCoord   = warpedTexCoord + vec2(-shiftMagnitude * SHIFT_AMOUNT * uParameter, 0.0);
    vec2 blueCoord  = warpedTexCoord + vec2( shiftMagnitude * SHIFT_AMOUNT * uParameter, 0.0);
    
    // Use the base warped coordinate for the green channel
    float red   = texture2D(uTexture, redCoord).r;
    float green = texture2D(uTexture, warpedTexCoord).g; 
    float blue  = texture2D(uTexture, blueCoord).b;
    
    vec4 finalColor = vec4(red, green, blue, 1.0);

    // --- 3. Static Grid Overlay ---

    // The grid lines are calculated using the original screen coordinate (vTexCoord)
    // which simulates the grid being painted onto the curved glass.
    float verticalLine = step(fractionalPart.x, LINE_THICKNESS);
    float horizontalLine = step(fractionalPart.y, LINE_THICKNESS);
    float gridMask = min(verticalLine + horizontalLine, 1.0);

    // Apply the grid
    vec3 blendedColor = mix(finalColor.rgb, GRID_COLOR, gridMask);
    finalColor.rgb = mix(finalColor.rgb, blendedColor, GRID_OPACITY);


    // --- 4. Brightness Boost (Thresholding/Glow Effect) ---

    float brightness = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float boostFactor = step(BRIGHTNESS_THRESHOLD, brightness);
    float finalMultiplier = mix(1.0, BRIGHTNESS_BOOST, boostFactor);
    finalColor.rgb *= finalMultiplier;

    
    // 5. Output Final Color
    gl_FragColor = finalColor;
}