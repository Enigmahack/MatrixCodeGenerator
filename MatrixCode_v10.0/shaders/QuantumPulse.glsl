// Name: Quantum Pulse
// Description: A radial distortion effect with wave-like displacement and color shifts.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter; // Controls pulse intensity

varying vec2      vTexCoord;

void main() {
    vec2 uv = vTexCoord;
    float amount = uParameter;
    
    // 1. Calculate distance from mouse
    vec2 mouse = uMouse;
    float dist = distance(uv, mouse);
    
    // 2. Wave-like displacement
    float pulse = sin(dist * 20.0 - uTime * 5.0) * 0.5 + 0.5;
    float strength = amount * (1.0 - smoothstep(0.0, 0.5, dist));
    
    // 3. Distortion
    vec2 distortedUV = uv + (uv - mouse) * strength * pulse * 0.2;
    
    // 4. Color sampling with chromatic aberration
    float r = texture2D(uTexture, distortedUV + vec2(strength * 0.01, 0.0)).r;
    float g = texture2D(uTexture, distortedUV).g;
    float b = texture2D(uTexture, distortedUV - vec2(strength * 0.01, 0.0)).b;
    
    vec3 col = vec3(r, g, b);
    
    // 5. Add a "glow" around the mouse
    float glow = 1.0 - smoothstep(0.0, 0.1, dist);
    col += vec3(0.0, 1.0, 0.5) * glow * amount;

    gl_FragColor = vec4(col, 1.0);
}
