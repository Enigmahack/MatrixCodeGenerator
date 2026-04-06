// Name: Holographic Interference
// Description: A futuristic holographic display effect with RGB split, scanlines, and digital noise.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter; // Controls interference intensity

varying vec2      vTexCoord;

float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec2 uv = vTexCoord;
    float amount = uParameter;
    
    // 1. Subtle horizontal jitter
    float jitter = (rand(vec2(uTime, floor(uv.y * 100.0))) - 0.5) * 0.005 * amount;
    uv.x += jitter;
    
    // 2. RGB Split (Chromatic Aberration)
    float shift = 0.01 * amount;
    float r = texture2D(uTexture, uv + vec2(shift, 0.0)).r;
    float g = texture2D(uTexture, uv).g;
    float b = texture2D(uTexture, uv - vec2(shift, 0.0)).b;
    vec3 col = vec3(r, g, b);
    
    // 3. Scanlines
    float scanline = sin(uv.y * uResolution.y * 1.0) * 0.1 * amount;
    col -= scanline;
    
    // 4. Interference Pattern (Horizontal bars)
    float bars = sin(uv.y * 10.0 + uTime * 2.0) * 0.05 * amount;
    col += bars;
    
    // 5. Global Flicker
    float flicker = (rand(vec2(uTime, 0.0)) * 0.1 + 0.9) * (1.0 - 0.2 * amount);
    col *= flicker;
    
    // 6. Cyan/Blue Tint (Holographic look)
    col.b += 0.2 * amount;
    col.g += 0.1 * amount;

    gl_FragColor = vec4(col, 1.0);
}
