
// pixelate.glsl
precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter;

varying vec2      vTexCoord;

void main() {
    float scale = mix(1.0, 0.15, uParameter);      // 1.0 no pixelate; 0.15 heavy
    vec2 grid = floor(vTexCoord * uResolution * scale) / (uResolution * scale);
    vec4 color = texture2D(uTexture, grid);
    gl_FragColor = color;
}
