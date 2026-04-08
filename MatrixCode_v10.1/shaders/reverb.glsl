// Name: Pedal: Reverb
// Description: Thick temporal blur by averaging 16 past frames from the history atlas.

precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uHistoryTexture;
uniform float     uHistoryIndex;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uParameter; // Reverb size / decay length

varying vec2      vTexCoord;

void main() {
    vec4 current = texture2D(uTexture, vTexCoord);
    vec4 accumulated = current;
    
    // Average 16 frames from the 64-frame atlas
    float frames = 1.0 + uParameter * 63.0;
    float weight = 1.0;
    
    for (int i = 1; i < 16; i++) {
        float f = float(i) * (frames / 16.0);
        float targetFrame = mod(uHistoryIndex - 1.0 - f + 64.0, 64.0);
        float col = mod(targetFrame, 8.0);
        float row = floor(targetFrame / 8.0);
        vec2 atlasUV = vTexCoord * 0.125 + vec2(col * 0.125, row * 0.125);
        
        vec4 hist = texture2D(uHistoryTexture, atlasUV);
        float w = 1.0 - (float(i) / 16.0);
        accumulated += hist * w;
        weight += w;
    }
    
    accumulated /= weight;
    
    gl_FragColor = vec4(accumulated.rgb, max(current.a, accumulated.a));
}
