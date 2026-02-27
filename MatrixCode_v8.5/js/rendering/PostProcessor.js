// =========================================================================
// POST PROCESSOR
// =========================================================================

/**
 * PostProcessor manages a multi-pass GLSL rendering pipeline.
 * The pipeline structure (Effect 1 -> Effect 2 -> Total FX1 -> Total FX2 -> Global FX -> Custom)
 * provides flexible and performant post-processing.
 */
class PostProcessor {
    constructor(config, gl = null) {
        this.config = config;
        this.gl = gl;
        
        // Pipeline Programs
        this.effect1Program = null;
        this.effect2Program = null;
        this.totalFX1Program = null;
        this.totalFX2Program = null;
        this.globalFXProgram = null;
        this.customProgram = null;
        
        this.canvas = gl ? null : document.createElement('canvas');
        
        // Textures
        this.texture = null; // Source Input
        this.intermediateTex1 = null; 
        this.intermediateTex2 = null;
        
        // Buffers
        this.positionBuffer = null;
        this.framebuffer1 = null; 
        this.framebuffer2 = null;
        
        this.defaultFragmentShader = `
            precision mediump float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec2 uMouse;
            uniform float uGlobalBrightness;
            uniform float uBurnIn; // clearAlpha mapped (0..1)
            varying vec2 vTexCoord;
            
            void main() {
                vec4 col = texture2D(uTexture, vTexCoord);
                
                // Burn-In Brightness: As alpha accumulates (trails), we boost the RGB
                // This simulates the phosphor "overloading" or glowing brighter where it's burned in.
                float burnBoost = 1.0 + (col.a * uBurnIn * 2.0);
                vec3 finalColor = col.rgb * uGlobalBrightness * burnBoost;
                
                gl_FragColor = vec4(finalColor, col.a);
            }
        `;

        this.bloomFragmentShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uParameter;      // Global master blend (0..1)
            uniform float uBloomRadius;    // Glow Radius mapped from config (1..10)
            uniform float uBloomIntensity; // Glow Intensity mapped from config (0..1)
            uniform float uGlobalBrightness;
            uniform float uBurnIn;         // Phosphor burn-in effect
            varying vec2 vTexCoord;

            // Simple pseudo-random for jittered sampling to create a "haze"
            float rand(vec2 co) {
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                vec2 texelSize = 1.0 / uResolution;
                
                // Radius scaling: 1..10 maps to significant spatial spread
                float radius = uBloomRadius * 3.0; 
                
                vec3 blur = vec3(0.0);
                float totalWeight = 0.0;
                
                // Jittered 16-tap sampling for a smoother "fuzzy haze"
                const int samples = 16;
                float seed = uTime;
                
                for(int i = 0; i < samples; i++) {
                    float fi = float(i);
                    // Use a golden angle / spiral distribution with per-frame jitter
                    float angle = fi * 2.39996 + rand(vTexCoord + seed) * 6.28;
                    float dist = sqrt(fi / float(samples)) * radius;
                    
                    vec2 offset = vec2(cos(angle), sin(angle)) * dist * texelSize;
                    vec4 sampleCol = texture2D(uTexture, vTexCoord + offset);
                    
                    // Gaussian-like weight based on distance
                    float weight = 1.0 - (dist / (radius + 0.1));
                    blur += sampleCol.rgb * weight;
                    totalWeight += weight;
                }
                
                blur /= max(0.1, totalWeight);

                // For a "general glow", we don't use a hard softMask anymore.
                // Instead we use a very mild boost for highlights but allow everyone to glow.
                float luminance = dot(blur, vec3(0.299, 0.587, 0.114));
                float extraction = 0.5 + luminance * 0.5; // Always at least 50% contribution
                
                // Additive Blend: Original + (Blurred * Intensity * Master Parameter)
                // We use uParameter * 2.0 because it's usually 0.5 in the UI by default.
                float finalIntensity = uBloomIntensity * (uParameter * 2.0);
                
                // Apply Phosphor Burn and Global Brightness to the base color
                float burnBoost = 1.0 + (color.a * uBurnIn * 2.0);
                vec3 baseColor = color.rgb * uGlobalBrightness * burnBoost;
                
                vec3 finalColor = baseColor + (blur * finalIntensity * extraction);
                
                gl_FragColor = vec4(finalColor, color.a);
            }
        `;
        
        this.vertexShaderSource = `
            attribute vec2 aPosition;
            varying vec2 vTexCoord;
            uniform float uFlipY;
            void main() {
                vTexCoord = (aPosition + 1.0) * 0.5;
                if (uFlipY > 0.5) {
                    vTexCoord.y = 1.0 - vTexCoord.y; 
                }
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;
        
        if (this.gl) {
            this._setupSharedGL();
        } else {
            this._initWebGL();
        }
    }

    _setupSharedGL() {
        const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
        
        this.texture = this._createTexture();
        this.intermediateTex1 = this._createTexture();
        this.intermediateTex2 = this._createTexture();
        
        this.framebuffer1 = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer1);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.intermediateTex1, 0);
        
        this.framebuffer2 = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer2);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.intermediateTex2, 0);
        
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        this.defaultProgram = this._compileProgram(this.defaultFragmentShader);
        this.bloomProgram = this._compileProgram(this.bloomFragmentShader);
    }

    _initWebGL() {
        this.gl = this.canvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: true });
        if (!this.gl) return;
        
        const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
        
        this.texture = this._createTexture();
        this.intermediateTex1 = this._createTexture();
        this.intermediateTex2 = this._createTexture();
        
        this.framebuffer1 = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer1);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.intermediateTex1, 0);
        
        this.framebuffer2 = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer2);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.intermediateTex2, 0);
        
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        
        this.defaultProgram = this._compileProgram(this.defaultFragmentShader);
        this.bloomProgram = this._compileProgram(this.bloomFragmentShader);
    }

    _createTexture() {
        const tex = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        return tex;
    }

    /**
     * Compile individual passes of the pipeline.
     */
    compileEffect1Shader(fragSource) { this.effect1Program = fragSource ? this._compileProgram(fragSource) : null; }
    compileEffect2Shader(fragSource) { this.effect2Program = fragSource ? this._compileProgram(fragSource) : null; }
    compileTotalFX1Shader(fragSource) { this.totalFX1Program = fragSource ? this._compileProgram(fragSource) : null; }
    compileTotalFX2Shader(fragSource) { this.totalFX2Program = fragSource ? this._compileProgram(fragSource) : null; }
    compileGlobalFXShader(fragSource) { this.globalFXProgram = fragSource ? this._compileProgram(fragSource) : this.bloomProgram; }
    compileCustomShader(fragSource) { this.customProgram = fragSource ? this._compileProgram(fragSource) : null; }

    _compileProgram(fragSource) {
        if (!this.gl) return null;
        if (!fragSource) fragSource = this.defaultFragmentShader;

        const createShader = (type, source) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, source);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.warn(type === this.gl.VERTEX_SHADER ? 'Vertex Shader Error' : 'Fragment Shader Error', this.gl.getShaderInfoLog(shader));
                this.gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = createShader(this.gl.VERTEX_SHADER, this.vertexShaderSource);
        const fs = createShader(this.gl.FRAGMENT_SHADER, fragSource);
        
        if (!vs || !fs) return null;

        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, vs);
        this.gl.attachShader(prog, fs);
        this.gl.linkProgram(prog);
        
        if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
            console.warn("Program Link Error", this.gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    resize(width, height) {
        if (!this.gl) return;
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        
        [this.texture, this.intermediateTex1, this.intermediateTex2].forEach(tex => {
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        });
    }

    _applyChain(activePasses, currentInput, currentFlip, targetFBO, time, mouseX, mouseY, brightness) {
        let input = currentInput;
        let flip = currentFlip;
        let activeFBO = this.framebuffer1;
        let activeTex = this.intermediateTex1;

        const d = this.config.derived;
        const br = d && d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
        const bg = d && d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
        const bb = d && d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;

        for (let i = 0; i < activePasses.length; i++) {
            const isLast = (i === activePasses.length - 1);
            const isFinalTarget = isLast && targetFBO === null;
            
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, isLast ? targetFBO : activeFBO);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            // If rendering to screen, use background color. Otherwise use transparent.
            if (isFinalTarget) {
                this.gl.clearColor(br, bg, bb, 1.0);
                this.gl.enable(this.gl.BLEND);
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this.gl.clearColor(0, 0, 0, 0);
                // Intermediate passes should strictly overwrite to avoid alpha accumulation issues
                this.gl.disable(this.gl.BLEND);
            }
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            this._drawPass(activePasses[i].prog, input, time, mouseX, mouseY, activePasses[i].param, flip, brightness, activePasses[i].customParams);
            
            if (!isLast) {
                input = activeTex;
                flip = 0.0;
                if (activeFBO === this.framebuffer1) {
                    activeFBO = this.framebuffer2;
                    activeTex = this.intermediateTex2;
                } else {
                    activeFBO = this.framebuffer1;
                    activeTex = this.intermediateTex1;
                }
            }
        }
    }

    /**
     * Main render entry point for the post-processing pipeline.
     */
    render(source, time, mouseX = 0, mouseY = 0, params = {}, targetFBO = null) {
        if (!this.gl) return;

        const brightness = params.brightness ?? 1.0;

        let inputTex;
        let flipY = 0.0;

        if (source instanceof WebGLTexture || (typeof WebGLTexture !== 'undefined' && source instanceof WebGLTexture)) {
            inputTex = source;
            flipY = 0.0;
        } else {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, source);
            inputTex = this.texture;
            flipY = 1.0;
        }

        // We enable blending here for the first texture upload if needed,
        // but _applyChain disables it for internal passes.
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);

        // Master bypass check
        if (this.config.get('postProcessBypassAll')) {
            this._renderBypass(source, targetFBO, brightness);
            return;
        }

        // Define the pipeline chain
        const activePasses = [
            { id: 'effect1', prog: this.effect1Program, param: params.effect1 ?? 0.5, enabled: this.config.get('effectShader1Enabled') },
            { id: 'effect2', prog: this.effect2Program, param: params.effect2 ?? 0.5, enabled: this.config.get('effectShader2Enabled') },
            { id: 'totalFX1', prog: this.totalFX1Program, param: params.totalFX1 ?? 0.5, enabled: this.config.get('totalFX1Enabled') },
            { id: 'totalFX2', prog: this.totalFX2Program, param: params.totalFX2 ?? 0.5, enabled: this.config.get('totalFX2Enabled') },
            { id: 'globalFX', prog: this.globalFXProgram || this.bloomProgram, param: params.globalFX ?? 0.5, enabled: this.config.get('globalFXEnabled') || this.config.get('enableBloom') },
            { id: 'custom', prog: this.customProgram || this.defaultProgram, param: params.custom ?? 0.5, enabled: this.config.get('shaderEnabled'), customParams: params.customParams }
        ].filter(p => p.prog !== null && p.enabled);
        
        if (activePasses.length === 0) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            if (targetFBO === null) {
                const d = this.config.derived;
                const br = d && d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
                const bg = d && d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
                const bb = d && d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
                this.gl.clearColor(br, bg, bb, 1.0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            }

            this._drawPass(this.defaultProgram, inputTex, time, mouseX, mouseY, 0.5, flipY, brightness);
            return;
        }

        // Add Global Params to ALL passes for consistency
        const commonParams = {
            uBurnIn: this.config.get('clearAlpha') || 0.0
        };

        // Add Bloom Params to globalFX pass if it's the bloom shader
        if (this.config.get('enableBloom')) {
             const bloomPass = activePasses.find(p => p.id === 'globalFX');
             if (bloomPass && (bloomPass.prog === this.bloomProgram || !this.globalFXProgram)) {
                 bloomPass.customParams = {
                     ...commonParams,
                     uBloomRadius: this.config.get('bloomStrength') || 1.0,
                     uBloomIntensity: this.config.get('bloomOpacity') || 0.5
                 };
             }
        }

        // Apply common params to other passes too
        activePasses.forEach(p => {
            if (p.id !== 'globalFX') {
                p.customParams = { ...commonParams, ...(p.customParams || {}) };
            }
        });

        this._applyChain(activePasses, inputTex, flipY, targetFBO, time, mouseX, mouseY, brightness);
    }

    _renderBypass(source, targetFBO, brightness = 1.0) {
        let inputTex;
        let flipY = 0.0;
        if (source instanceof WebGLTexture || (typeof WebGLTexture !== 'undefined' && source instanceof WebGLTexture)) {
            inputTex = source;
            flipY = 0.0;
        } else {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, source);
            inputTex = this.texture;
            flipY = 1.0;
        }
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
        this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
        const d = this.config.derived;
        const br = d && d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
        const bg = d && d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
        const bb = d && d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
        this.gl.clearColor(br, bg, bb, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Explicitly enable blending for the bypass draw if we want it to be opaque 
        // against the background color we just cleared.
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);

        this._drawPass(this.defaultProgram, inputTex, 0, 0, 0, 0.5, flipY, brightness, { uBurnIn: this.config.get('clearAlpha') });
    }

    _drawPass(prog, texture, time, mouseX, mouseY, param, flipY, brightness = 1.0, customParams = null) {
        this.gl.useProgram(prog);

        const posLoc = this.gl.getAttribLocation(prog, 'aPosition');
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(posLoc);
        this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        
        const uTex = this.gl.getUniformLocation(prog, 'uTexture');
        this.gl.uniform1i(uTex, 0);
        
        const uRes = this.gl.getUniformLocation(prog, 'uResolution');
        this.gl.uniform2f(uRes, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
        const uTime = this.gl.getUniformLocation(prog, 'uTime');
        this.gl.uniform1f(uTime, time);

        const uMouse = this.gl.getUniformLocation(prog, 'uMouse');
        if (uMouse) this.gl.uniform2f(uMouse, mouseX, mouseY);

        const uParam = this.gl.getUniformLocation(prog, 'uParameter');
        if (uParam) this.gl.uniform1f(uParam, param);
        
        const uFlip = this.gl.getUniformLocation(prog, 'uFlipY');
        if (uFlip) this.gl.uniform1f(uFlip, flipY);

        const uGlobalBright = this.gl.getUniformLocation(prog, 'uGlobalBrightness');
        if (uGlobalBright) this.gl.uniform1f(uGlobalBright, brightness);

        // Apply Custom Parameters
        if (customParams) {
            for (const [key, value] of Object.entries(customParams)) {
                const loc = this.gl.getUniformLocation(prog, key);
                if (loc) {
                    this.gl.uniform1f(loc, value);
                }
            }
        }

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
}
