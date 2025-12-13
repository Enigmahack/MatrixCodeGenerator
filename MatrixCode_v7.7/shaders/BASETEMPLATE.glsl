// base_template.glsl
precision highp float;                    // highp for desktop; switch to mediump for mobile if needed

uniform sampler2D uTexture;
uniform vec2      uResolution;            // (width, height)
uniform float     uTime;                  // seconds
uniform vec2      uMouse;                 // normalized [0..1]
uniform float     uParameter;             // UI slider [0..1]

varying vec2      vTexCoord;

void main() {
    vec4 base = texture2D(uTexture, vTexCoord);
    gl_FragColor = base;                  // start from base; 
}
