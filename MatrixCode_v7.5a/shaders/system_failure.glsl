precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; // Represents the progress/phase of the crash sequence (Phase Index + Progress 0-1)
varying vec2 vTexCoord;

// --- UTILS ---

float smoothstep_custom(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

// 2D Random
vec2 random2(vec2 st) {
    st = vec2( dot(st,vec2(127.1,311.7)),
              dot(st,vec2(269.5,183.3)) );
    return -1.0 + 2.0 * fract(sin(st)*43758.5453123);
}

// 2D Noise
float noise (vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f*f*(3.0-2.0*f);
    return mix( mix( dot( random2(i + vec2(0.0,0.0)), f - vec2(0.0,0.0) ),
                     dot( random2(i + vec2(1.0,0.0)), f - vec2(1.0,0.0) ), u.x),
                mix( dot( random2(i + vec2(0.0,1.0)), f - vec2(0.0,1.0) ),
                     dot( random2(i + vec2(1.0,1.0)), f - vec2(1.0,1.0) ), u.x), u.y);
}

// --- EFFECT FUNCTIONS ---

vec4 applyBlackRectangles(vec4 color, vec2 uv, float time, float intensity) {
    float rect_count = 3.0;
    vec4 result = color;
    
    for (float i = 0.0; i < 3.0; ++i) { // GLSL loops need const bounds usually, or strict checks
        // Dynamic Offset
        vec2 offset = random2(vec2(time * (0.1 + i * 0.01) + i * 10.0, 0.0));
        offset = (offset * 0.5 + 0.5) * 0.8 + 0.1;

        // Dynamic Size
        float size_x = 0.1 + sin(time * (0.5 + i * 0.1)) * 0.05 + 0.1;
        float size_y = 0.2 + cos(time * (0.6 + i * 0.15)) * 0.08 + 0.1;
        
        // Rotation
        float rotation = time * (0.3 + i * 0.05);
        float cr = cos(rotation);
        float sr = sin(rotation);
        mat2 rot_matrix = mat2(cr, -sr, sr, cr);
        vec2 rotated_uv = rot_matrix * (uv - offset);

        // SDF Box
        float rect_edge_x = abs(rotated_uv.x) / size_x;
        float rect_edge_y = abs(rotated_uv.y) / size_y;

        // Fade Edges
        float rect_alpha = smoothstep_custom(0.9, 1.0, max(rect_edge_x, rect_edge_y)); 
        
        // Mix Black
        vec4 rect_color = vec4(0.0, 0.0, 0.0, 1.0);
        result = mix(result, rect_color, (1.0 - rect_alpha) * intensity);
    }
    return result;
}

void main() {
    vec2 uv = vTexCoord;
    float phase_idx = floor(uParameter);
    float phase_prog = fract(uParameter);
    
    // Default Sampling
    vec4 finalColor = texture2D(uTexture, uv);

    // --- PHASE 2: Partial Clear Code bursts + Stretch/Zoom ---
    if (phase_idx == 2.0) {
        // Intermittent bursts
        float burst_freq = 5.0; // Hz
        float burst_trigger = sin(uTime * burst_freq);
        if (burst_trigger > 0.8) {
            // Distort UVs
            vec2 center = vec2(0.5, 0.5);
            vec2 dist_uv = uv - center;
            
            // Stretch Vertically (sample smaller Y range)
            dist_uv.y *= 0.33; 
            // Zoom In (sample smaller total range)
            dist_uv *= 0.6; 
            
            vec2 sample_uv = dist_uv + center;
            
            // Check bounds to avoid clamping/repeating artifacts if desired, 
            // though texture wrap usually handles it or clamps.
            if (sample_uv.x >= 0.0 && sample_uv.x <= 1.0 && sample_uv.y >= 0.0 && sample_uv.y <= 1.0) {
                 finalColor = texture2D(uTexture, sample_uv);
                 // Boost brightness for "burst"
                 finalColor.rgb *= 1.5;
            }
        }
    }

    // --- PHASE 3: Horizontal Smearing ---
    if (phase_idx == 3.0) {
        // "7-20 frame-long flashes" -> rapid oscillation
        float smear_trigger = noise(vec2(uTime * 10.0, 0.0));
        if (smear_trigger > 0.6) {
             // "1/2 up the bottom of the screen"
             if (uv.y < 0.5) {
                 // Smear horizontally: Sample X based on a stretched coordinate?
                 // Or blur? A simple stretch is cheaper and looks digital.
                 // Stretched pixels = sample a tiny range of X across the whole screen.
                 float smear_center_x = 0.5;
                 float stretch_factor = 0.1; // Very stretched
                 float new_x = (uv.x - smear_center_x) * stretch_factor + smear_center_x;
                 
                 // Add some vertical jitter "2-3 characters tall"
                 float jitter = (noise(vec2(uv.y * 20.0, uTime)) - 0.5) * 0.02;
                 
                 finalColor = texture2D(uTexture, vec2(new_x, uv.y + jitter));
                 finalColor.rgb *= vec3(1.2, 1.5, 1.2); // Greenish tint boost
                 finalColor.a *= 0.8; // Transparent
                 
                 // Layer original transparently?
                 vec4 orig = texture2D(uTexture, uv);
                 finalColor = mix(orig, finalColor, 0.7);
             }
        }
    }
    
    // --- PHASE 5: Smearing partial ---
    if (phase_idx == 5.0) {
        // "Three cells are smeared vertically from the bottom 1/3 of the screen"
        if (uv.y < 0.33) {
            float smear_trigger = step(0.9, random2(vec2(floor(uv.x * 20.0), floor(uTime * 10.0))).x);
             if (smear_trigger > 0.0) {
                 // Vertical smear
                 float new_y = fract(uv.y * 0.1 + uTime); // Scrolling smear
                 vec4 smearCol = texture2D(uTexture, vec2(uv.x, new_y));
                 finalColor = mix(finalColor, smearCol, 0.8);
             }
        }
    }

    // --- PHASE 7: Horizontal Black Strip ---
    if (phase_idx == 7.0) {
        // "Quickly fades in... periodically"
        float period = 1.0; 
        float t = mod(uTime, period) / period; // 0-1
        
        if (t < 0.5) { // Active for half the period
             float strip_height = 0.05; // ~6 cells relative to screen
             float center_y = 0.3 + t * 0.4; // Move vertically 0.3 -> 0.7
             
             float dist = abs(uv.y - center_y);
             if (dist < strip_height) {
                 float alpha = smoothstep_custom(strip_height * 0.8, strip_height, dist);
                 // Center is alpha 0 (black), edges 1 (orig). Inverted:
                 alpha = 1.0 - alpha;
                 
                 // "Fades in... before becoming entirely transparent"
                 // Actually prompt says: "fades in and obscures... before becoming transparent"
                 // Let's just mix black.
                 finalColor = mix(finalColor, vec4(0.0,0.0,0.0,1.0), alpha * 0.9);
             }
        }
    }

    // --- SHARED: Black Rectangles (Phases 1a, 1b, 4, 5) ---
    if (phase_idx == 0.0 || phase_idx == 1.0 || phase_idx == 4.0 || phase_idx == 5.0) {
        finalColor = applyBlackRectangles(finalColor, uv, uTime, 0.8);
    }
    
    // --- Global Glitch Noise (Always active to some degree) ---
    // Subtle noise overlay
    float noise_val = noise(uv * 30.0 + uTime * 2.0);
    if (noise_val > 0.95) {
        finalColor.rgb = mix(finalColor.rgb, vec3(0.8, 1.0, 0.8), 0.3); // Bright specs
    }

    gl_FragColor = finalColor;
}