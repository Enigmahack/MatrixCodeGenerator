// Name: Digital Entropy (VHS/Glitch)
// Description: A heavy glitch effect with chromatic aberration, scanlines, and tracking noise.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter; // Controls glitch intensity

varying vec2      vTexCoord;

float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = rand(i);
    float b = rand(i + vec2(1.0, 0.0));
    float c = rand(i + vec2(0.0, 1.0));
    float d = rand(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 uv = vTexCoord;
    float amount = uParameter;
    
    // 1. Horizontal Glitch / Shifting
    float glitchTime = uTime * 5.0;
    float noiseVal = noise(vec2(uv.y * 100.0, glitchTime));
    
    // Create discrete glitch lines
    float lineGlitch = step(0.98 - (amount * 0.1), rand(vec2(glitchTime, floor(uv.y * 20.0))));
    uv.x += lineGlitch * (noiseVal - 0.5) * 0.1 * amount;
    
    // 2. Chromatic Aberration
    float shift = 0.02 * amount * noise(vec2(uTime, uv.y));
    float r = texture2D(uTexture, uv + vec2(shift, 0.0)).r;
    float g = texture2D(uTexture, uv).g;
    float b = texture2D(uTexture, uv - vec2(shift, 0.0)).b;
    vec3 col = vec3(r, g, b);
    
    // 3. Tracking Noise / Static
    float staticNoise = rand(uv + uTime) * 0.2 * amount;
    col += staticNoise;
    
    // 4. Scanlines
    float scanline = sin(uv.y * uResolution.y * 1.5) * 0.05 * amount;
    col -= scanline;
    
    // 5. Vertical Jump
    float jump = step(0.99, rand(vec2(uTime * 0.1, 0.0))) * amount * 0.2;
    uv.y = fract(uv.y + jump);
    
    // 6. Vignette
    float vig = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
    vig = pow(vig * 15.0, 0.15);
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
}
