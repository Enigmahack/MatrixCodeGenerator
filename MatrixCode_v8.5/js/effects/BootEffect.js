class BootEffect extends AbstractEffect {
    constructor(g, c, registry) {
        super(g, c);
        this.registry = registry;
        this.name = "BootSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = 3.5; 
        this.originalShader = null; 
        this.originalShaderEnabled = false; 
        this.originalShaderParameter = 0.5; 
    }

    trigger() {
        if (this.active) return false;

        // Set Effect Shader (Pass 1)
        this.c.set('effectShader', `
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; // 0.0 to 1.0 over 3.5s
varying vec2 vTexCoord;

// --- UTILS ---

float random(float n) {
    return fract(sin(n * 12.9898) * 43758.5453123);
}

float noise(float p) {
    float i = floor(p);
    float f = fract(p);
    return mix(random(i), random(i + 1.0), f * f * (3.0 - 2.0 * f));
}

float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float vignetteRect(vec2 uv, float margin) {
    vec2 v = smoothstep(0.0, margin, uv) * smoothstep(1.0, 1.0 - margin, uv);
    return v.x * v.y;
}

float smoothstep_custom(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

// "Scanner Sheet" with subtle torn edges
// axis: 0 = none, 1 = jagged horizontal edges, 2 = jagged vertical edges
float scannerSheet(vec2 uv, vec2 center, vec2 size, float blur, int axis) {
    vec2 pos = uv - center;
    
    // Torn edge effect
    float jagged = 0.0;
    if (axis == 1) {
        jagged = (noise(uv.x * 50.0) - 0.5) * 0.005; 
        pos.y += jagged;
    } else if (axis == 2) {
        jagged = (noise(uv.y * 50.0) - 0.5) * 0.005;
        pos.x += jagged;
    }

    vec2 d = abs(pos) - size;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    return 1.0 - smoothstep(0.0, blur, dist);
}

// Asymmetrical Scanner Scenes (Full Span + Torn Edges)
vec3 getScannerScene(int pattern, vec2 uv) {
    vec3 col = vec3(1.0); 
    
    // Pattern 0: Split Scan (Full Width)
    if (pattern == 0) {
        float top = scannerSheet(uv, vec2(0.5, 0.75), vec2(1.0, 0.25), 0.02, 1);
        float bot = scannerSheet(uv, vec2(0.5, 0.25), vec2(1.0, 0.25), 0.02, 1);
        
        float art = scannerSheet(uv, vec2(0.5, 0.6), vec2(1.0, 0.05), 0.01, 1); 
        
        vec3 cTop = vec3(0.85, 0.9, 0.95);
        vec3 cBot = vec3(1.0);
        
        col = mix(vec3(0.9), cBot, bot);
        col = mix(col, cTop, top);
        col = mix(col, vec3(0.7), art);
    }
    
    // Pattern 1: Faded Gradient + Full Height Side Bar
    if (pattern == 1) {
        float grad = smoothstep(0.0, 1.0, uv.y);
        col = vec3(mix(0.6, 1.0, grad));
        float bar = scannerSheet(uv, vec2(0.15, 0.5), vec2(0.08, 1.0), 0.05, 2); 
        col = mix(col, vec3(0.95), bar);
    }
    
    // Pattern 2: Bottom Bar (Full Width)
    if (pattern == 2) {
        col = vec3(0.85);
        float bar = scannerSheet(uv, vec2(0.5, 0.15), vec2(1.0, 0.15), 0.03, 1);
        float art = scannerSheet(uv, vec2(0.5, 0.85), vec2(1.0, 0.05), 0.01, 1);
        
        col = mix(col, vec3(1.0), bar);
        col = mix(col, vec3(0.9), art);
    }
    
    // Pattern 3: Thick Vertical Block (Full Height)
    if (pattern == 3) {
        col = vec3(1.0);
        float side = scannerSheet(uv, vec2(0.9, 0.5), vec2(0.15, 1.0), 0.08, 2);
        float block = scannerSheet(uv, vec2(0.3, 0.5), vec2(0.15, 1.0), 0.01, 2); 
        
        vec3 blueLeak = vec3(0.7, 0.85, 1.0);
        col = mix(col, blueLeak, side);
        col = mix(col, vec3(0.8), block);
    }
    
    // Pattern 4: Top Header (Full Width)
    if (pattern == 4) {
        col = vec3(0.95);
        float head = scannerSheet(uv, vec2(0.5, 0.9), vec2(1.0, 0.1), 0.02, 1);
        float bar = scannerSheet(uv, vec2(0.5, 0.1), vec2(1.0, 0.05), 0.01, 1);
        
        col = mix(col, vec3(1.0), head);
        col = mix(col, vec3(0.85), bar);
    }
    
    // Pattern 5: Corner Heavy (Full Span components)
    if (pattern == 5) {
        col = vec3(0.9);
        float vStrip = scannerSheet(uv, vec2(0.1, 0.5), vec2(0.15, 1.0), 0.1, 2);
        float hStrip = scannerSheet(uv, vec2(0.5, 0.4), vec2(1.0, 0.08), 0.02, 1);
        
        col = mix(col, vec3(1.0), vStrip);
        col = mix(col, vec3(0.8), hStrip);
    }
    
    // Pattern 6: Wide Horizontal Split (Full Width)
    if (pattern == 6) {
        col = vec3(1.0);
        float mid = scannerSheet(uv, vec2(0.5, 0.4), vec2(1.0, 0.15), 0.05, 1);
        col = mix(vec3(0.85), vec3(1.0), mid);
    }
    
    return col;
}

void main() {
    vec4 origColor = texture2D(uTexture, vTexCoord);
    vec2 uv = vTexCoord;
    
    vec2 p = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    p.x *= aspect;

    vec4 finalColor = vec4(0.0, 0.0, 0.0, 1.0); 
    
    // --- TIMING ---
    float t_dot = smoothstep_custom(0.15, 0.25, uParameter);
    float t_v_stretch = smoothstep_custom(0.25, 0.35, uParameter);
    float t_h_stretch = smoothstep_custom(0.35, 0.45, uParameter);
    
    vec3 whiteLayer = vec3(0.0);
    float whiteAlpha = 0.0;
    
    if (uParameter < 0.45) {
        if (uParameter > 0.15) {
            float line_thickness = 0.008; 
            float max_height = 2.0; 
            float max_width = 2.0 * aspect;
            
            float current_radius = line_thickness * t_dot;
            float added_height = mix(0.0, max_height, t_v_stretch * t_v_stretch);
            float added_width = mix(0.0, max_width, t_h_stretch * t_h_stretch);
            float active_radius = mix(current_radius, 0.0, t_h_stretch);
            
            float d = sdRoundedBox(p, vec2(added_width, added_height), active_radius);
            
            float glow = 1.0 - smoothstep(0.0, 0.015, d);
            float core = 1.0 - smoothstep(0.0, 0.0005, d);
            whiteAlpha = max(glow, core);
            
            if (t_h_stretch < 0.1) {
                 float total_h = added_height + active_radius;
                 float v_fade = smoothstep(total_h, total_h * 0.5, abs(p.y));
                 whiteAlpha *= v_fade;
            } else {
                 whiteAlpha = mix(whiteAlpha, 1.0, t_h_stretch);
            }
            whiteLayer = vec3(1.0);
        }
    } else {
        // --- FLASHES ---
        float t_flash_phase = (uParameter - 0.45) / 0.55; 
        
        float cycle_count = 22.0; 
        float raw_cycle = t_flash_phase * cycle_count;
        float cycle_index = floor(raw_cycle);
        
        float rnd = random(cycle_index + 123.45); 
        int pattern = int(rnd * 7.0); 
        
        whiteLayer = getScannerScene(pattern, uv);
        whiteAlpha = 1.0; 
        
        float fade_out = smoothstep_custom(0.90, 1.0, uParameter);
        whiteAlpha *= (1.0 - fade_out);
    }
    
    // --- COMPOSITE ---
    
    // Tighter, less intense vignette
    float border = vignetteRect(uv, 0.01); // 1% margin
    whiteAlpha *= border;
    
    vec3 background = vec3(0.0);
    if (uParameter > 0.90) {
         background = origColor.rgb;
    }
    
    finalColor.rgb = mix(background, whiteLayer, whiteAlpha);
    
    gl_FragColor = finalColor;
}
`); 
        
        this.c.set('effectParameter', 0.0); 

        this.active = true;
        this.startTime = performance.now();
        // console.log("BootEffect Triggered");
        return true;
    }

    update() {
        if (!this.active) return;

        const elapsedTime = (performance.now() - this.startTime) / 1000;
        let progress = elapsedTime / this.durationSeconds;

        if (progress >= 1.0) {
            this.active = false;
            this.c.set('effectShader', null);
            this.c.set('effectParameter', 0.0);
            // console.log("BootEffect Finished");

            if (this.c.get('runBothInOrder') && this.registry) {
                this.registry.trigger('CrashSequence');
            }
            return;
        }

        this.c.set('effectParameter', progress);
    }

    getOverride(i) {
        return null;
    }
}

