// Name: Thermal Matrix
// Description: Maps the code luminance to a thermal/heat vision color ramp.

precision highp float;

uniform sampler2D uTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uMouse;
uniform float     uParameter; // Controls thermal contrast

varying vec2      vTexCoord;

// Heatmap color ramp: Blue -> Purple -> Red -> Yellow -> White
vec3 heatMap(float t) {
    vec3 c1 = vec3(0.0, 0.0, 0.5);  // Deep Blue
    vec3 c2 = vec3(0.5, 0.0, 0.5);  // Purple
    vec3 c3 = vec3(1.0, 0.0, 0.0);  // Red
    vec3 c4 = vec3(1.0, 1.0, 0.0);  // Yellow
    vec3 c5 = vec3(1.0, 1.0, 1.0);  // White

    if (t < 0.25) return mix(c1, c2, t * 4.0);
    if (t < 0.5)  return mix(c2, c3, (t - 0.25) * 4.0);
    if (t < 0.75) return mix(c3, c4, (t - 0.5) * 4.0);
    return mix(c4, c5, (t - 0.75) * 4.0);
}

void main() {
    vec4 base = texture2D(uTexture, vTexCoord);
    
    // Calculate luminance
    float luma = dot(base.rgb, vec3(0.299, 0.587, 0.114));
    
    // Apply contrast based on parameter
    luma = pow(luma, 2.0 - uParameter * 1.5);
    
    // Add some "scan" noise
    float noise = fract(sin(vTexCoord.y * 500.0 + uTime * 10.0)) * 0.05;
    luma = clamp(luma + noise, 0.0, 1.0);
    
    vec3 thermal = heatMap(luma);
    
    // Mix with base based on parameter? No, full thermal is better.
    // But we can keep the alpha from the original.
    gl_FragColor = vec4(thermal, base.a);
}
