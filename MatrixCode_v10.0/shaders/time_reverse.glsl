// Name: Time Reverse
// Description: Plays back a 1-second (16-frame, sampled 15fps) buffer in reverse order. Sharp 4x4 atlas.

precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uHistoryTexture;
uniform float     uHistoryIndex;
uniform vec2      uResolution;
uniform float     uTime;
uniform float     uParameter; // Playback speed (0 = live, >0 = reverse)

varying vec2      vTexCoord;

void main() {
    if (uParameter <= 0.0) {
        gl_FragColor = texture2D(uTexture, vTexCoord);
        return;
    }

    // 1. Calculate reverse offset based on time
    // We capture every 4th frame (stride 4), so 16 frames = 64 frames of time (~1s).
    // playbackSpeed 15.0 frames per second is the capture rate.
    float playbackSpeed = uParameter * 15.0; 
    float frameOffset = mod(uTime * playbackSpeed, 16.0);
    
    // 2. Playback logic: newest frame is always (uHistoryIndex - 1)
    float targetFrame = mod(uHistoryIndex - 1.0 - floor(frameOffset) + 16.0, 16.0);
    
    // 3. Atlas layout: 4x4 grid
    float col = mod(targetFrame, 4.0);
    float row = floor(targetFrame / 4.0);
    
    // 4. Map normalized UV to the 0.25x0.25 sub-region
    vec2 atlasUV = vTexCoord * 0.25 + vec2(col * 0.25, row * 0.25);
    
    gl_FragColor = texture2D(uHistoryTexture, atlasUV);
}
