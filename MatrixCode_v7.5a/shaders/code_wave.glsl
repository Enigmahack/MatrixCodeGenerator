precision mediump float;

uniform sampler2D uTexture;
uniform float uTime;
varying vec2 vTexCoord;

void main() {
    // Create a new coordinate variable
    vec2 distortedCoord = vTexCoord;

    // Modify the X coordinate based on the Y coordinate and Time
    // This creates a wave that moves horizontally
    distortedCoord.x += sin(vTexCoord.y * 10.0 + uTime) * 0.01;

    // Sample the texture using our NEW, distorted coordinates
    vec4 color = texture2D(uTexture, distortedCoord);

    gl_FragColor = color;
}