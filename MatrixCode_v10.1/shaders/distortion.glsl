// Name: Pedal: Overdrive/Distortion
// Description: High-gain visual clipping and saturation with increased contrast.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uParameter; // Gain / Contrast intensity

varying vec2      vTexCoord;

// Manual soft-clipping since tanh is not in GLSL ES 1.0
vec3 softClip(vec3 x) {
    return x / (1.0 + abs(x));
}

void main() {
    vec4 base = texture2D(uTexture, vTexCoord);
    vec3 col = base.rgb;
    
    // 1. Boost gain
    float gain = 1.0 + uParameter * 15.0;
    col *= gain;
    
    // 2. Add Contrast (push colors out)
    float contrast = 1.0 + uParameter * 2.0;
    col = (col - 0.5) * contrast + 0.5;
    
    // 3. Soft-clipping distortion
    col = softClip(col * 1.5);
    
    // 4. Noise / Interference
    float noise = fract(sin(dot(vTexCoord + uTime * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
    col += (noise - 0.5) * 0.1 * uParameter;
    
    // 5. Color shifting
    col.r *= (1.0 + 0.3 * uParameter);
    col.b *= (1.0 - 0.2 * uParameter);

    gl_FragColor = vec4(col, base.a);
}
