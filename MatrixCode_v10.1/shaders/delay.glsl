// Name: Pedal: Delay/Echo
// Description: Multi-tap echo effect using the feedback texture.

precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uFeedbackTexture;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uParameter; // Controls echo feedback amount

varying vec2      vTexCoord;

void main() {
    vec4 current = texture2D(uTexture, vTexCoord);
    
    // Sample the feedback (previous frame) with a slight offset or zoom
    // This creates an "infinite" tunnel echo
    vec2 echoUV = (vTexCoord - 0.5) * 0.995 + 0.5;
    vec4 echo = texture2D(uFeedbackTexture, echoUV);
    
    // Mix current with feedback. 
    // uParameter controls how long the echo lasts.
    float feedback = 0.5 + uParameter * 0.45;
    vec3 col = current.rgb + echo.rgb * feedback;
    
    // Saturation protection / clipping
    col = min(col, vec3(1.5));
    
    // Fade out based on alpha too
    gl_FragColor = vec4(col, max(current.a, echo.a * feedback));
}
