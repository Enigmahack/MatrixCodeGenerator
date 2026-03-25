class BootEffect extends AbstractEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "BootSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = 4.2; 
    }

    trigger(force = false) {
        if (this.active && !force) return false;

        // Request slot from orchestrator
        this.shaderSlot = this.r.requestShaderSlot(this, this._getShaderSource(), 0.0);

        this.active = true;
        this.startTime = performance.now();
        return true;
    }

    stop() {
        this.active = false;
        if (this.shaderSlot) {
            this.r.releaseShaderSlot(this);
            this.shaderSlot = null;
        }
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
            if (this.c.get('runBothInOrder') && this.c.get('crashEnabled') && this.r) {
                this.r.trigger('CrashSequence');
            }
            return;
        }

        if (this.shaderSlot) {
            this.c.set(this.shaderSlot.param, progress);
        }
    }

    _getShaderSource() {
        return `
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; // 0.0 to 1.0 over duration
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
    vec2 p = uv * 2.0 - 1.0;
    float r = 0.05;
    float d = sdRoundedBox(p, vec2(1.0 - margin), r);
    return 1.0 - smoothstep(0.0, softness, d);
}

// Smooth CRT-style warp to prevent frame-alternating flicker
float smoothJitter(float coord, float target, float amount, float scale) {
    float jitter = (noise(coord * scale + uTime * 0.5) - 0.5) * amount;
    return target + jitter;
}

// Colors from Matrix Boot aesthetic
const vec3 bootCyan = vec3(0.0, 0.65, 0.85); 
const vec3 bootWhite = vec3(0.85, 0.95, 1.0);

// Generative Scene Logic
vec3 getScannerScene(int pattern, vec2 uv, float t) {
    vec3 col = bootWhite;
    float jitter = 0.008; // Gentle smooth jitter
    
    // Pattern 0: Horizontal Split (Cyan Top)
    if (pattern == 0) {
        float split = smoothJitter(uv.x, 0.5, jitter, 40.0);
        col = (uv.y > split) ? bootCyan : bootWhite;
    }
    // Pattern 1: Horizontal Split (White Top)
    else if (pattern == 1) {
        float split = smoothJitter(uv.x, 0.5, jitter, 40.0);
        col = (uv.y > split) ? bootWhite : bootCyan;
    }
    // Pattern 2: Vertical Band Cyan
    else if (pattern == 2) {
        float width = 0.15 + (noise(uTime * 0.2) - 0.5) * 0.1;
        float left = smoothJitter(uv.y, 0.5 - width, jitter, 60.0);
        float right = smoothJitter(uv.y, 0.5 + width, jitter, 60.0);
        col = (uv.x > left && uv.x < right) ? bootCyan : bootWhite;
    }
    // Pattern 3: Horizontal Band Cyan
    else if (pattern == 3) {
        float height = 0.15 + (noise(uTime * 0.2 + 10.0) - 0.5) * 0.1;
        float top = smoothJitter(uv.x, 0.5 + height, jitter, 60.0);
        float bot = smoothJitter(uv.x, 0.5 - height, jitter, 60.0);
        col = (uv.y > bot && uv.y < top) ? bootCyan : bootWhite;
    }
    // Pattern 4: Triple Horizontal
    else if (pattern == 4) {
        float j1 = smoothJitter(uv.x, 0.33, jitter, 50.0);
        float j2 = smoothJitter(uv.x, 0.66, jitter, 50.0);
        if (uv.y > j2) col = bootCyan;
        else if (uv.y > j1) col = bootWhite;
        else col = bootCyan;
    }
    // Pattern 5: Top Band Cyan
    else if (pattern == 5) {
        float split = smoothJitter(uv.x, 0.2, jitter, 40.0);
        col = (uv.y > 1.0 - split) ? bootCyan : bootWhite;
    }
    // Pattern 6: Full Cyan
    else if (pattern == 6) {
        col = bootCyan;
    }
    // Pattern 7: Full White
    else if (pattern == 7) {
        col = bootWhite;
    }
    // Pattern 8: Vertical Split (Cyan Left)
    else if (pattern == 8) {
        float split = smoothJitter(uv.y, 0.5, jitter, 40.0);
        col = (uv.x < split) ? bootCyan : bootWhite;
    }
    // Pattern 9: Quad Split
    else if (pattern == 9) {
        float hSplit = smoothJitter(uv.x, 0.5, jitter, 30.0);
        float vSplit = smoothJitter(uv.y, 0.5, jitter, 30.0);
        bool h = uv.y > hSplit;
        bool v = uv.x > vSplit;
        col = (h == v) ? bootCyan : bootWhite;
    }
    
    return col;
}

void main() {
    vec4 codeColor = texture2D(uTexture, vTexCoord);
    vec2 uv = vTexCoord;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);

    vec3 finalColor = vec3(0.0); 
    float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;

    float alpha = 0.0;
    vec3 layerCol = vec3(0.0);

    if (uParameter < 0.3) {
        // --- EXPANSION PHASE (0% to 30%) ---
        float t = uParameter / 0.3;
        
        // Dot -> Vertical Line -> Box
        float t_dot = smoothstep(0.0, 0.2, t);
        float t_v_stretch = smoothstep(0.2, 0.6, t);
        float t_h_stretch = smoothstep(0.6, 1.0, t);

        float size_v = mix(0.005, 1.1, t_v_stretch * t_v_stretch);
        float size_h = mix(0.005, 1.1 * aspect, t_h_stretch * t_h_stretch);
        
        float d = sdRoundedBox(p, vec2(size_h, size_v), 0.005);
        float glow = exp(-max(0.0, d) * 20.0);
        float mask = 1.0 - smoothstep(0.0, 0.01, d);
        
        alpha = max(mask, glow * 0.5);
        layerCol = mix(bootCyan, bootWhite, t_h_stretch) * gb;

    } else if (uParameter < 0.85) {
        // --- GENERATIVE VARIETY (30% to 85%) ---
        float t_variety = (uParameter - 0.3) / 0.55;
        
        // Rhythmic smooth crossfading
        float cycle_speed = 8.0; 
        float raw_cycle = t_variety * cycle_speed; 
        float cycle_idx = floor(raw_cycle);
        float cycle_frac = fract(raw_cycle);
        
        int pattern1 = int(random(cycle_idx + 123.456) * 10.0);
        int pattern2 = int(random(cycle_idx + 1.0 + 123.456) * 10.0);
        
        vec3 scene1 = getScannerScene(pattern1, uv, uTime);
        vec3 scene2 = getScannerScene(pattern2, uv, uTime);
        
        // Smooth crossfade during the last 40% of each cycle
        float fade = smoothstep(0.6, 1.0, cycle_frac);
        layerCol = mix(scene1, scene2, fade) * gb;
        
        // Subtle scanline for texture, no flickering
        float scanline = sin(uv.y * uResolution.y * 1.5) * 0.03 + 0.97;
        layerCol *= scanline;
        
        alpha = 1.0;

    } else {
        // --- FINAL HOLD & FADE (85% to 100%) ---
        // Keep the last generated scene
        float cycle_idx = floor(8.0);
        int pattern = int(random(cycle_idx + 123.456) * 10.0);
        layerCol = getScannerScene(pattern, uv, uTime) * gb;
        
        float scanline = sin(uv.y * uResolution.y * 1.5) * 0.03 + 0.97;
        layerCol *= scanline;
        
        alpha = 1.0;
    }

    // Global fade out over the last 15% to reveal background code
    float global_fade = smoothstep(0.85, 1.0, uParameter);
    alpha *= (1.0 - global_fade);

    // --- CRT EFFECTS ---
    float vignette = crtFrame(uv, 0.0, 0.05);
    alpha *= vignette;

    // Composite
    vec3 background = (uParameter < 0.3) ? vec3(0.0) : codeColor.rgb;
    finalColor = mix(background, layerCol, alpha);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;
    }

}
