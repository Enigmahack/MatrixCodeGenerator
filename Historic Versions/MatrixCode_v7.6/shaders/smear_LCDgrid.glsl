// Name: Vertical Smear + LED Grid

// Vertical Smear (upwards only) + LED Matrix Grid (faded, brightness-aware)
// Uniforms: uTexture, uResolution, uTime, uMouse, uParameter, vTexCoord
// uParameter drives the smear length in pixels: 0.0 = none, 1.0 = MAX_SMEAR_PX

precision mediump float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter;

varying vec2      vTexCoord;

// ------------------- Tunables -------------------

// If the smear still goes the wrong way, flip this sign to -1.0.
// +1.0 means "sample from above" when vTexCoord.y increases toward the top.
// -1.0 means "sample from below".
const float Y_SIGN            = +1.0;

const float MAX_SMEAR_PX      = 48.0;   // max smear length (pixels) at uParameter=1
const float SMEAR_DECAY       = 0.30;   // exponential falloff per tap (higher = faster decay)
const int   SMEAR_TAPS_COUNT  = 8;      // unrolled taps count (do not change in code block)

// Smear applies more strongly to bright glyphs.
// Raise or lower the range to taste.
const float SMEAR_LUMA_MIN    = 0.30;   // start applying smear above this luma
const float SMEAR_LUMA_MAX    = 0.85;   // full smear by this luma

// LED grid parameters
const float GRID_SPACING_PX   = 8.0;    // cell size (pixels)
const float GRID_THICKNESS_PX = 1.0;    // seam thickness (pixels)
const float GRID_FADE_MAX     = 0.15;   // max darkening on grid lines
const float GRID_CROSS_GLOW   = 0.02;   // tiny highlight at intersections
const float GRID_LUMA_POWER   = 1.2;    // tie grid visibility to luma (>=1.0 less persistent in dark)

// ------------------- Helpers -------------------

float luma(vec3 c) {
    // Rec.709 luma
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Sample along vertical with Y_SIGN and clamp to [0,1] range.
vec3 sampleVertical(vec2 uv, float offsetPx, vec2 px) {
    float y = clamp(uv.y + Y_SIGN * offsetPx * px.y, 0.0, 1.0);
    return texture2D(uTexture, vec2(uv.x, y)).rgb;
}

// Upward-only smear via unrolled taps for WebGL1 stability.
vec3 smearUp(vec2 uv, float smearLenPx, float brightnessFactor) {
    // brightnessFactor scales how much we mix the smear in (from 0..1)
    vec2  px    = 1.0 / uResolution;
    float stepPx= smearLenPx / float(SMEAR_TAPS_COUNT);

    vec3 accum  = texture2D(uTexture, uv).rgb;
    float wsum  = 1.0;

    // Unrolled 8 taps with exponential weights
    {
        float w1 = exp(-1.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 1.0, px) * w1;
        wsum  += w1;

        float w2 = exp(-2.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 2.0, px) * w2;
        wsum  += w2;

        float w3 = exp(-3.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 3.0, px) * w3;
        wsum  += w3;

        float w4 = exp(-4.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 4.0, px) * w4;
        wsum  += w4;

        float w5 = exp(-5.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 5.0, px) * w5;
        wsum  += w5;

        float w6 = exp(-6.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 6.0, px) * w6;
        wsum  += w6;

        float w7 = exp(-7.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 7.0, px) * w7;
        wsum  += w7;

        float w8 = exp(-8.0 * SMEAR_DECAY);
        accum += sampleVertical(uv, stepPx * 8.0, px) * w8;
        wsum  += w8;
    }

    vec3 smeared = accum / wsum;

    // Mix based on glyph brightness so darker glyphs retain less shadow,
    // matching your observation.
    vec3 base    = texture2D(uTexture, uv).rgb;
    float lum    = luma(base);
    float mixAmt = brightnessFactor * smoothstep(SMEAR_LUMA_MIN, SMEAR_LUMA_MAX, lum);

    return mix(base, smeared, mixAmt);
}

// LED grid mask in pixel space (gl_FragCoord).
// Returns line intensity in 0..1.
float gridMask(vec2 frag) {
    float modX  = mod(frag.x, GRID_SPACING_PX);
    float distX = min(modX, GRID_SPACING_PX - modX);

    float modY  = mod(frag.y, GRID_SPACING_PX);
    float distY = min(modY, GRID_SPACING_PX - modY);

    float lineX = 1.0 - smoothstep(GRID_THICKNESS_PX, GRID_THICKNESS_PX + 1.0, distX);
    float lineY = 1.0 - smoothstep(GRID_THICKNESS_PX, GRID_THICKNESS_PX + 1.0, distY);

    return max(lineX, lineY);
}

void main() {
    vec2 uv         = vTexCoord;
    vec4 base4      = texture2D(uTexture, uv);
    vec3 base       = base4.rgb;
    vec2 frag       = gl_FragCoord.xy;

    // Smear length driven by uParameter (pixels)
    float smearLenPx = clamp(uParameter, 0.0, 1.0) * MAX_SMEAR_PX;

    // Smear strength factor (independent of luma ramp)
    float smearStrength = 1.0; // keep 1.0; you can expose a second uniform if desired

    // Upward-only smear with brightness-aware mixing
    vec3 color = smearUp(uv, smearLenPx, smearStrength);

    // LED grid faded by brightness so it is less persistent in dark regions
    float gridI   = gridMask(frag);
    float lum     = pow(luma(color), GRID_LUMA_POWER); // make grid respond more to bright glyphs
    float fadeAmt = GRID_FADE_MAX * lum;               // reduce grid visibility in dark areas

    color *= mix(1.0, 1.0 - fadeAmt, gridI);

    // Tiny intersection glow (also brightness-aware)
    if (GRID_CROSS_GLOW > 0.0) {
        float modX  = mod(frag.x, GRID_SPACING_PX);
        float distX = min(modX, GRID_SPACING_PX - modX);
        float lineX = 1.0 - smoothstep(GRID_THICKNESS_PX, GRID_THICKNESS_PX + 1.0, distX);

        float modY  = mod(frag.y, GRID_SPACING_PX);
        float distY = min(modY, GRID_SPACING_PX - modY);
        float lineY = 1.0 - smoothstep(GRID_THICKNESS_PX, GRID_THICKNESS_PX + 1.0, distY);

        color += vec3(GRID_CROSS_GLOW) * (lineX * lineY) * lum;
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}