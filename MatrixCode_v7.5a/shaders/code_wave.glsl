precision mediump float;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uParameter;

varying vec2 vTexCoord;

void main() {
    // Create a new coordinate variable
    vec2 distortedCoord = vTexCoord;

    // Modify the X coordinate based on the Y coordinate and Time
    // This creates a wave that moves horizontally
    distortedCoord.x += sin(vTexCoord.y * (uParameter * 10) + uTime);

    // Sample the texture using our NEW, distorted coordinates
    vec4 color = texture2D(uTexture, distortedCoord);

    gl_FragColor = color;
}