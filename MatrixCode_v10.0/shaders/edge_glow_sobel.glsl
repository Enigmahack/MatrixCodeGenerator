// Name: Edge Glow (Sobel)
precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter;

varying vec2      vTexCoord;

void main() {
    vec2 uv = vTexCoord;
    vec2 px = 1.0 / uResolution;          // per‑pixel offsets

    // Luma samples
    float tl = dot(texture2D(uTexture, uv + px*vec2(-1,  1)).rgb, vec3(0.2126,0.7152,0.0722));
    float  l = dot(texture2D(uTexture, uv + px*vec2(-1,  0)).rgb, vec3(0.2126,0.7152,0.0722));
    float bl = dot(texture2D(uTexture, uv + px*vec2(-1, -1)).rgb, vec3(0.2126,0.7152,0.0722));
    float  t = dot(texture2D(uTexture, uv + px*vec2( 0,  1)).rgb, vec3(0.2126,0.7152,0.0722));
    float  b = dot(texture2D(uTexture, uv + px*vec2( 0, -1)).rgb, vec3(0.2126,0.7152,0.0722));
    float tr = dot(texture2D(uTexture, uv + px*vec2( 1,  1)).rgb, vec3(0.2126,0.7152,0.0722));
    float  r = dot(texture2D(uTexture, uv + px*vec2( 1,  0)).rgb, vec3(0.2126,0.7152,0.0722));
    float br = dot(texture2D(uTexture, uv + px*vec2( 1, -1)).rgb, vec3(0.2126,0.7152,0.0722));

    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy =  tl + 2.0*t + tr - bl - 2.0*b - br;
    float edge = sqrt(gx*gx + gy*gy);

    vec4 base = texture2D(uTexture, uv);
    float glowAmt = mix(0.0, 0.6, uParameter);
    base.rgb += edge * glowAmt;

    gl_FragColor = clamp(base, 0.0, 1.0);
}