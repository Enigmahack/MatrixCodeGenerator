// Name: Matrix Real-World Blue Hue
precision highp float;                    // highp for desktop; switch to mediump for mobile if needed

uniform sampler2D uTexture;
uniform vec2      uResolution;            // (width, height)
uniform float     uTime;                  // seconds
uniform vec2      uMouse;                 // normalized [0..1]
uniform float     uParameter;             // UI slider [0..1]

varying vec2      vTexCoord;

vec3 rgb2hsv(vec3 c){
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.x, p.y, p.w, c.r), vec4(c.r, p.y, p.z, p.x), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec3 rgb = texture2D(uTexture, vTexCoord).rgb;
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = mix(hsv.x, 0.55, uParameter * 0.25);    // Hue change                                       
    hsv.y = mix(hsv.y, 0.0, uParameter * 0.25);            // Saturation change
    vec3 outc = hsv2rgb(hsv);
    gl_FragColor = vec4(outc, 1.0);
}