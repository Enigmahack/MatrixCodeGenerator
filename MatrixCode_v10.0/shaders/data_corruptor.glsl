// Name: Data Corruptor
// Description: A block-based glitch effect that shifts and swaps screen segments.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter; // Controls corruption frequency/size

varying vec2      vTexCoord;

float rand(float n){return fract(sin(n) * 43758.5453123);}
float rand(vec2 n){return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);}

void main() {
    vec2 uv = vTexCoord;
    float amount = uParameter;
    
    // 1. Blocky UV Coordinates
    float blockSize = 8.0 + (1.0 - amount) * 32.0;
    vec2 blockUV = floor(uv * blockSize) / blockSize;
    
    // 2. Random block shift
    float glitchTrigger = step(0.9, rand(vec2(floor(uTime * 10.0), blockUV.y)));
    if (glitchTrigger > 0.5) {
        uv.x += (rand(blockUV + uTime) - 0.5) * 0.1 * amount;
        uv.y += (rand(blockUV - uTime) - 0.5) * 0.1 * amount;
    }
    
    // 3. Color Corruption
    vec4 col = texture2D(uTexture, uv);
    
    float colorTrigger = step(0.95 - (amount * 0.1), rand(blockUV + floor(uTime * 5.0)));
    if (colorTrigger > 0.5) {
        float r = rand(blockUV.xy);
        if (r < 0.5) col.rgb = col.gbr;
        else col.rgb = col.brg;
    }
    
    // 4. Brightness flicker
    float flicker = rand(uTime) * 0.1 * amount;
    col.rgb += flicker;

    gl_FragColor = col;
}
