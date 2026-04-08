// Name: Hue Shift
precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter;

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
    hsv.x = fract(hsv.x + uTime * 0.05 * (0.2 + 0.8*uParameter));           // animate hue
    hsv.y *= mix(1.0, 0.35, uParameter);                                    // desaturate
    vec3 outc = hsv2rgb(hsv);
    gl_FragColor = vec4(outc, 1.0);
}
