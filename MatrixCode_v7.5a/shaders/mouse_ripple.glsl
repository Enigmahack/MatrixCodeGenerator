
// mouse_ripple_lens.glsl
precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter;

varying vec2      vTexCoord;

void main() {
    vec2 uv = vTexCoord;
    vec2 center = vec2(uMouse.x, 1.0 - uMouse.y);
    float radius = mix(0.02, 0.60, uParameter);
    float dist = distance(uv, center);
    float mask = smoothstep(radius, 0.0, dist);

    // Dynamic ripple offset
    float wave = sin(24.0*dist - 4.0*uTime) * 0.003 * uParameter;
    vec2 dir = normalize(uv - center);
    uv += dir * wave * mask;

    // Mild magnification inside the lens
    float magnify = mix(1.0, 1.15, uParameter);
    uv = mix(uv, center + (uv - center)/magnify, mask);

    gl_FragColor = texture2D(uTexture, uv);
}
