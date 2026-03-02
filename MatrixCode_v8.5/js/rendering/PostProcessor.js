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
        this.width = 0;
        this.height = 0;
        this.lastBrightness = 1.0;
        
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
                float burnBoost = 1.0 + (col.a * uBurnIn * 2.0);
                
                // Ensure uGlobalBrightness is at least 0.0, defaulting to 1.0 if uninitialized
                float gb = uGlobalBrightness;
                if (gb <= 0.0) gb = 1.0; 

                vec3 finalColor = col.rgb * gb * burnBoost;
                
                gl_FragColor = vec4(finalColor, col.a);
            }
        `;

        this.bloomFragmentShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uBloomRadius;    
            uniform float uBloomIntensity; 
            uniform float uBloomBrightness;
            uniform float uBloomThreshold;
            uniform float uGlobalBrightness;
            uniform float uBurnIn;         
            varying vec2 vTexCoord;

            float rand(vec2 co) {
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            vec3 threshold(vec3 color, float th) {
                float luma = dot(color, vec3(0.299, 0.587, 0.114));
                return color * smoothstep(th, th + 0.05, luma);
            }

            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                vec2 texelSize = 1.0 / uResolution;
                float radius = uBloomRadius * 3.0; 
                
                vec3 blur = vec3(0.0);
                float totalWeight = 0.0;
                const int samples = 16;
                for(int i = 0; i < samples; i++) {
                    float fi = float(i);
                    float angle = fi * 2.39996 + rand(vTexCoord + uTime) * 6.28;
                    float dist = sqrt(fi / float(samples)) * radius;
                    vec2 offset = vec2(cos(angle), sin(angle)) * dist * texelSize;
                    vec3 sampleCol = texture2D(uTexture, vTexCoord + offset).rgb;
                    sampleCol = threshold(sampleCol, uBloomThreshold);
                    float weight = 1.0 - (dist / (radius + 0.1));
                    blur += sampleCol * weight;
                    totalWeight += weight;
                }
                blur /= max(0.1, totalWeight);

                float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;
                float burnBoost = 1.0 + (color.a * uBurnIn * 2.0);
                vec3 baseColor = color.rgb * gb * burnBoost;
                
                vec3 finalColor = baseColor + (blur * uBloomIntensity * uBloomBrightness);
                gl_FragColor = vec4(finalColor, color.a);
            }
        `;

        this.boxBloomShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uBloomRadius;
            uniform float uBloomIntensity;
            uniform float uBloomBrightness;
            uniform float uBloomThreshold;
            uniform float uGlobalBrightness;
            uniform float uBurnIn;
            varying vec2 vTexCoord;

            vec3 threshold(vec3 color, float th) {
                float luma = dot(color, vec3(0.299, 0.587, 0.114));
                return color * smoothstep(th, th + 0.05, luma);
            }

            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                vec2 texelSize = (1.0 / uResolution) * uBloomRadius;
                vec3 blur = vec3(0.0);
                for(float x = -1.0; x <= 1.0; x++) {
                    for(float y = -1.0; y <= 1.0; y++) {
                        vec3 s = texture2D(uTexture, vTexCoord + vec2(x, y) * texelSize).rgb;
                        blur += threshold(s, uBloomThreshold);
                    }
                }
                blur /= 9.0;
                float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;
                vec3 baseColor = color.rgb * gb * (1.0 + color.a * uBurnIn * 2.0);
                gl_FragColor = vec4(baseColor + blur * uBloomIntensity * uBloomBrightness, color.a);
            }
        `;

        this.dualBloomShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uBloomRadius;
            uniform float uBloomIntensity;
            uniform float uBloomBrightness;
            uniform float uBloomThreshold;
            uniform float uGlobalBrightness;
            uniform float uBurnIn;
            varying vec2 vTexCoord;

            vec3 threshold(vec3 color, float th) {
                float luma = dot(color, vec3(0.299, 0.587, 0.114));
                return color * smoothstep(th, th + 0.05, luma);
            }

            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                vec2 texelSize = (1.0 / uResolution) * uBloomRadius * 0.5;
                vec3 blur = texture2D(uTexture, vTexCoord).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(-1, -1) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(1, -1) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(-1, 1) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(1, 1) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(0, -2) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(0, 2) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(-2, 0) * texelSize).rgb;
                blur += texture2D(uTexture, vTexCoord + vec2(2, 0) * texelSize).rgb;
                blur = threshold(blur / 9.0, uBloomThreshold);
                float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;
                vec3 baseColor = color.rgb * gb * (1.0 + color.a * uBurnIn * 2.0);
                gl_FragColor = vec4(baseColor + blur * uBloomIntensity * uBloomBrightness, color.a);
            }
        `;

        this.starBloomShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uBloomRadius;
            uniform float uBloomIntensity;
            uniform float uBloomBrightness;
            uniform float uBloomThreshold;
            uniform float uGlobalBrightness;
            uniform float uBurnIn;
            varying vec2 vTexCoord;

            vec3 threshold(vec3 color, float th) {
                float luma = dot(color, vec3(0.299, 0.587, 0.114));
                return color * smoothstep(th, th + 0.05, luma);
            }

            void main() {
                vec4 color = texture2D(uTexture, vTexCoord);
                vec2 texelSize = 1.0 / uResolution;
                vec3 blur = vec3(0.0);
                float radius = uBloomRadius * 4.0;
                
                // Rotated 45 degrees for better visual contrast against vertical rain
                // cos(45) and sin(45) are approx 0.707
                vec2 dir1 = vec2(0.707, 0.707);
                vec2 dir2 = vec2(0.707, -0.707);

                for(int i = -8; i <= 8; i++) {
                    float fi = float(i);
                    vec2 off1 = dir1 * fi * radius * texelSize;
                    vec2 off2 = dir2 * fi * radius * texelSize;
                    
                    blur += threshold(texture2D(uTexture, vTexCoord + off1).rgb, uBloomThreshold) * (1.0 - abs(fi)/9.0);
                    blur += threshold(texture2D(uTexture, vTexCoord + off2).rgb, uBloomThreshold) * (1.0 - abs(fi)/9.0);
                }
                blur /= 18.0;
                float gb = (uGlobalBrightness <= 0.0) ? 1.0 : uGlobalBrightness;
                vec3 baseColor = color.rgb * gb * (1.0 + color.a * uBurnIn * 2.0);
                gl_FragColor = vec4(baseColor + blur * uBloomIntensity * uBloomBrightness, color.a);
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
        this.boxBloomProgram = this._compileProgram(this.boxBloomShader);
        this.dualBloomProgram = this._compileProgram(this.dualBloomShader);
        this.starBloomProgram = this._compileProgram(this.starBloomShader);
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
        this.boxBloomProgram = this._compileProgram(this.boxBloomShader);
        this.dualBloomProgram = this._compileProgram(this.dualBloomShader);
        this.starBloomProgram = this._compileProgram(this.starBloomShader);
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
    compileGlobalFXShader(fragSource) { this.globalFXProgram = fragSource ? this._compileProgram(fragSource) : null; }
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

        this.width = width;
        this.height = height;
        
        // Use same format as WebGLRenderer for parity (HALF_FLOAT support)
        let type = this.gl.UNSIGNED_BYTE;
        let internalFormat = this.gl.RGBA;
        
        // Detect support for half float
        const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && this.gl instanceof WebGL2RenderingContext);
        if (isWebGL2) {
            internalFormat = this.gl.RGBA16F;
            type = this.gl.HALF_FLOAT;
        } else {
            const ext = this.gl.getExtension('OES_texture_half_float');
            if (ext) {
                type = ext.HALF_FLOAT_OES || 0x8D61;
            }
        }
        
        [this.texture, this.intermediateTex1, this.intermediateTex2].forEach(tex => {
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalFormat, width, height, 0, this.gl.RGBA, type, null);
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

        // Ensure intermediate textures are clean before starting the chain
        // This prevents "ghosting" or persistent brightness from previous passes
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer1);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer2);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        for (let i = 0; i < activePasses.length; i++) {
            const isLast = (i === activePasses.length - 1);
            const isFinalTarget = isLast && targetFBO === null;
            
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, isLast ? targetFBO : activeFBO);
            
            // Explicitly set viewport for the target of THIS pass
            if (isFinalTarget) {
                this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
                this.gl.clearColor(br, bg, bb, 1.0);
                this.gl.enable(this.gl.BLEND);
                this.gl.blendEquation(this.gl.FUNC_ADD);
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                // Use stored dimensions or fallback to context size
                const vw = this.width || this.gl.drawingBufferWidth;
                const vh = this.height || this.gl.drawingBufferHeight;
                this.gl.viewport(0, 0, vw, vh);
                this.gl.clearColor(0, 0, 0, 0);
                // Intermediate passes should strictly overwrite to avoid alpha accumulation issues
                this.gl.disable(this.gl.BLEND);
                this.gl.blendEquation(this.gl.FUNC_ADD);
            }
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            // ARCHITECTURAL FIX: Only apply global brightness and burn-in to the FINAL pass.
            // Intermediate passes use 1.0 for brightness and 0.0 for burn-in to prevent exponential accumulation.
            const passBrightness = isLast ? brightness : 1.0;
            const currentParams = { ...(activePasses[i].customParams || {}) };
            
            if (!isLast) {
                currentParams.uBurnIn = 0.0;
            } else if (currentParams.uBurnIn === undefined) {
                currentParams.uBurnIn = this.config.get('clearAlpha') || 0.0;
            }
            
            this._drawPass(activePasses[i].prog, input, time, mouseX, mouseY, activePasses[i].param, flip, passBrightness, currentParams);
            
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

    _getBloomProgram(type) {
        switch(type) {
            case 'box': return this.boxBloomProgram;
            case 'dual': return this.dualBloomProgram;
            case 'star': return this.starBloomProgram;
            default: return this.bloomProgram;
        }
    }

    /**
     * Main render entry point for the post-processing pipeline.
     */
    render(source, time, mouseX = 0, mouseY = 0, params = {}, targetFBO = null) {
        if (!this.gl) return;

        // More robust brightness check: ensure it's a valid number and at least 0.
        let brightness = 1.0;
        if (typeof params.brightness === 'number' && !isNaN(params.brightness)) {
            brightness = params.brightness;
        }
        
        this.lastBrightness = brightness;

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

        const globalBloomType = this.config.get('globalBloomType');
        const globalBloomProg = this._getBloomProgram(globalBloomType);

        // Define the pipeline chain
        const activePasses = [
            { id: 'effect1', prog: this.effect1Program, param: params.effect1 ?? 0.5, enabled: this.config.get('effectShader1Enabled') },
            { id: 'effect2', prog: this.effect2Program, param: params.effect2 ?? 0.5, enabled: this.config.get('effectShader2Enabled') },
            { id: 'totalFX1', prog: this.totalFX1Program, param: params.totalFX1 ?? 0.5, enabled: this.config.get('totalFX1Enabled') },
            { id: 'totalFX2', prog: this.totalFX2Program, param: params.totalFX2 ?? 0.5, enabled: this.config.get('totalFX2Enabled') },
            // NEW Global Bloom FX
            {
                id: 'globalBloom',
                prog: globalBloomProg,
                param: 0.5,
                enabled: this.config.get('globalBloomEnabled')
            },
            // Global FX: Selected in Debug menu. Falls back to Bloom ONLY if enabled there.
            { 
                id: 'globalFX', 
                prog: this.globalFXProgram || this.bloomProgram, 
                param: params.globalFX ?? 0.5, 
                enabled: this.config.get('globalFXEnabled') 
            },
            { id: 'custom', prog: this.customProgram || this.defaultProgram, param: params.custom ?? 0.5, enabled: this.config.get('shaderEnabled'), customParams: params.customParams }
        ].filter(p => p.prog !== null && p.enabled);
        
        if (activePasses.length === 0) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            const d = this.config.derived;
            const br = d && d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
            const bg = d && d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
            const bb = d && d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
            
            if (targetFBO === null) {
                this.gl.clearColor(br, bg, bb, 1.0);
            } else {
                this.gl.clearColor(0, 0, 0, 0);
            }
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);

            this._drawPass(this.defaultProgram, inputTex, time, mouseX, mouseY, 0.5, flipY, brightness);
            return;
        }

        // Add Global Params to ALL passes for consistency
        const commonParams = {
            uBurnIn: this.config.get('clearAlpha') || 0.0
        };

        // Add Global Bloom Params
        if (this.config.get('globalBloomEnabled')) {
            const pass = activePasses.find(p => p.id === 'globalBloom');
            if (pass) {
                pass.customParams = {
                    ...commonParams,
                    uBloomBrightness: this.config.get('globalBloomBrightness'),
                    uBloomIntensity: this.config.get('globalBloomIntensity'),
                    uBloomRadius: this.config.get('globalBloomWidth'),
                    uBloomThreshold: this.config.get('globalBloomThreshold')
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
        // Use stored dimensions or fallback to context size
        const rw = Math.max(1, this.width || this.gl.drawingBufferWidth);
        const rh = Math.max(1, this.height || this.gl.drawingBufferHeight);
        this.gl.uniform2f(uRes, rw, rh);
        
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
