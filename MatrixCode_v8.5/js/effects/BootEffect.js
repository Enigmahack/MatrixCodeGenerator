class BootEffect extends AbstractEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "BootSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = 3.5; 
    }

    trigger() {
        if (this.active) return false;

        // Request slot from orchestrator
        this.shaderSlot = this.r.requestShaderSlot(this, this._getShaderSource(), 0.0);

        this.active = true;
        this.startTime = performance.now();
        return true;
    }

    _getShaderSource() {
        return `
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; // 0.0 to 1.0 over 3.5s
uniform float uGlobalBrightness;
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

// CRT Tube frame vignette
float crtFrame(vec2 uv, float margin, float softness) {
    // Subtle corner rounding for the CRT tube feel
    vec2 p = uv * 2.0 - 1.0;
    float r = 0.05;
    float d = sdRoundedBox(p, vec2(1.0 - margin), r);
    return 1.0 - smoothstep(0.0, softness, d);
}

float smoothstep_custom(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

// Minimal Jitter: Moreso straight but retains organic "CRT" character
float jaggedCheck(float coord, float target, float jitterAmount, float scale) {
    float jitter = (noise(coord * scale + uTime * 0.05) - 0.5) * jitterAmount;
    return target + jitter;
}

// Colors from MainBoot.png
const vec3 bootCyan = vec3(0.0, 0.65, 0.85); 
const vec3 bootWhite = vec3(0.85, 0.95, 1.0);

// Optimized scene logic based on MainBoot.png aesthetic
vec3 getScannerScene(int pattern, vec2 uv, float expansion) {
    vec3 col = bootWhite;
    float jitter = 0.0015;
    
    // Pattern 0: Horizontal Split (Matches MainBoot.png)
    if (pattern == 0 || pattern == 7) {
        float split = jaggedCheck(uv.x, 0.45, jitter, 80.0);
        // Fuzzy transition between the cyan top and white bottom
        float mask = smoothstep(split, split + 0.02, uv.y);
        col = mix(bootWhite, bootCyan, mask);
    }
    // Pattern 1: Vertical Band
    else if (pattern == 1) {
        float width = 0.12 + (expansion * 0.1); 
        float left = jaggedCheck(uv.y, 0.5 - width, jitter, 120.0);
        float right = jaggedCheck(uv.y, 0.5 + width, jitter, 120.0);
        col = (uv.x > left && uv.x < right) ? bootCyan : bootWhite;
    }
    // Pattern 2: Triple Split
    else if (pattern == 2) {
        float j1 = jaggedCheck(uv.x, 0.33, jitter, 100.0);
        float j2 = jaggedCheck(uv.x, 0.66, jitter, 100.0);
        if (uv.y > j2) col = bootCyan;
        else if (uv.y > j1) col = bootWhite;
        else col = bootCyan;
    }
    // Pattern 3: Horizontal Middle Band
    else if (pattern == 3) {
        float height = 0.15 + (expansion * 0.1);
        float top = jaggedCheck(uv.x, 0.5 + height, jitter, 110.0);
        float bot = jaggedCheck(uv.x, 0.5 - height, jitter, 110.0);
        col = (uv.y > bot && uv.y < top) ? bootCyan : bootWhite;
    }
    // Pattern 6: Heavy Top
    else if (pattern == 6) {
        float split = jaggedCheck(uv.x, 0.25 - (expansion * 0.15), jitter, 100.0);
        col = (uv.y > split) ? bootCyan : bootWhite;
    }
    // Pure screens
    else if (pattern >= 8) {
        col = (pattern == 9) ? bootWhite : bootCyan;
    }
    
    return col;
}

void main() {
    vec4 codeColor = texture2D(uTexture, vTexCoord);
    vec2 uv = vTexCoord;
    
    vec2 p = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    p.x *= aspect;

    vec4 finalColor = vec4(0.0, 0.0, 0.0, 1.0); 
    
    // Brightness application
    float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;

    vec3 whiteLayer = vec3(0.0);
    float whiteAlpha = 0.0;
    float jitter = 0.0015;
    
    if (uParameter < 0.45) {
        // --- INITIAL DOT/BOX EXPANSION ---
        if (uParameter > 0.15) {
            float t_dot = smoothstep_custom(0.15, 0.25, uParameter);
            float t_v_stretch = smoothstep_custom(0.25, 0.35, uParameter);
            float t_h_stretch = smoothstep_custom(0.35, 0.45, uParameter);

            float line_thickness = 0.008; 
            float current_radius = line_thickness * t_dot;
            float added_height = mix(0.0, 2.0, t_v_stretch * t_v_stretch);
            float added_width = mix(0.0, 2.0 * aspect, t_h_stretch * t_h_stretch);
            float active_radius = mix(current_radius, 0.0, t_h_stretch);
            
            float d = sdRoundedBox(p, vec2(added_width, added_height), active_radius);
            whiteAlpha = max(1.0 - smoothstep(0.0, 0.015, d), 1.0 - smoothstep(0.0, 0.0005, d));
            whiteLayer = bootWhite * gb; 
        }
    } else if (uParameter < 0.80) {
        // --- VARIETY SCENES (45% to 80%) ---
        float t_variety = (uParameter - 0.45) / 0.35;
        float cycle_count = 12.0; 
        float raw_cycle = t_variety * cycle_count;
        float cycle_index = floor(raw_cycle);
        float cycle_frac = fract(raw_cycle);
        
        float expansion = smoothstep(0.85, 1.0, cycle_frac);
        float rnd = random(cycle_index + 456.78); 
        int pattern = int(rnd * 10.0); 
        
        whiteLayer = getScannerScene(pattern, uv, expansion) * gb;
        whiteAlpha = 1.0; 
    } else {
        // --- FINAL VERTICAL WIPE (80% to 100%) ---
        float t_final = (uParameter - 0.80) / 0.20;
        float split = jaggedCheck(uv.y, t_final, jitter, 100.0); 
        whiteLayer = (uv.x < split) ? (bootCyan * gb) : (bootWhite * gb);
        whiteAlpha = 1.0; 

        // Very tight fade-out in the last few frames
        float fade_out = smoothstep(0.96, 1.0, uParameter);
        whiteAlpha *= (1.0 - fade_out);
    }

    // --- CRT BEAM INCONSISTENCY ---
    float lineId = floor(uv.y * (uResolution.y / 2.0));
    float beamNoise = noise(uv.x * 3.5 + random(lineId) * 100.0);
    float beamFade = mix(0.94, 1.0, smoothstep(0.1, 0.25, beamNoise));
    float lineMargin = 0.001 * random(lineId + 0.5);
    float beamEdges = smoothstep(0.0, lineMargin, uv.x) * smoothstep(1.0, 1.0 - lineMargin, uv.x);
    whiteLayer *= beamFade * beamEdges;

    // --- COMPOSITE ---
    
    // Black CRT Frame (Vignette)
    float border = crtFrame(uv, 0.005, 0.02); 
    whiteAlpha *= border;

    // Foundational Background Logic:
    // 1. Black during expansion.
    // 2. Solid colored background during variety (hiding code).
    // 3. Falling code revealed ONLY at the very end.
    
    vec3 voidBackground = (uParameter < 0.45) ? vec3(0.0) : (bootWhite * gb);
    float codeReveal = smoothstep(0.96, 1.0, uParameter);
    vec3 finalBackground = mix(voidBackground, codeColor.rgb, codeReveal);
    
    finalColor.rgb = mix(finalBackground, whiteLayer, whiteAlpha);

    gl_FragColor = vec4(finalColor.rgb, 1.0);
}
`;
    }

    update() {
        if (!this.active) return;
        const elapsedTime = (performance.now() - this.startTime) / 1000;
        let progress = elapsedTime / this.durationSeconds;

        if (progress >= 1.0) {
            this.active = false;
            if (this.shaderSlot) {
                this.r.releaseShaderSlot(this);
                this.shaderSlot = null;
            }
            if (this.c.get('runBothInOrder') && this.r) {
                this.r.trigger('CrashSequence');
            }
            return;
        }

        if (this.shaderSlot) {
            this.c.set(this.shaderSlot.param, progress);
        }
    }

    getOverride(i) {
        return null;
    }
}
