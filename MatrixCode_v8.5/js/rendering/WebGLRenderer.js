// =========================================================================
// WEBGL RENDERER
// =========================================================================

// =========================================================================
// RENDER PIPELINE PASSES (SOLID / Open-Closed Architecture)
// =========================================================================

class RenderPass {
    constructor(name, enabled = true) {
        this.name = name;
        this.enabled = enabled;
    }
    
    // Abstract method
    // Returns the texture that should be used as input for the next pass
    execute(renderer, sourceTex, s, d, time) {
        throw new Error("RenderPass.execute() must be implemented.");
    }
}

class PostProcessPass extends RenderPass {
    execute(renderer, sourceTex, s, d, time) {
        if (!renderer.postProcessor) return sourceTex;

        const gl = renderer.gl;
        
        // Ensure all shaders are compiled
        const passes = [
            { id: 'effect1', source: s.effectShader1Content, compile: (src) => renderer.postProcessor.compileEffect1Shader(src) },
            { id: 'effect2', source: s.effectShader2Content, compile: (src) => renderer.postProcessor.compileEffect2Shader(src) },
            { id: 'totalFX1', source: s.totalFX1ShaderContent, compile: (src) => renderer.postProcessor.compileTotalFX1Shader(src) },
            { id: 'totalFX2', source: s.totalFX2ShaderContent, compile: (src) => renderer.postProcessor.compileTotalFX2Shader(src) },
            { id: 'globalFX', source: s.globalFXShaderContent, compile: (src) => renderer.postProcessor.compileGlobalFXShader(src) },
            { id: 'custom', source: s.shaderEnabled ? s.customShader : null, compile: (src) => renderer.postProcessor.compileCustomShader(src) }
        ];

        renderer.lastSources = renderer.lastSources || {};
        passes.forEach(p => {
            if (p.source !== renderer.lastSources[p.id]) {
                p.compile(p.source);
                renderer.lastSources[p.id] = p.source;
            }
        });

        const params = {
            effect1: s.effect1Parameter,
            effect2: s.effect2Parameter,
            totalFX1: s.totalFX1Parameter,
            totalFX2: s.totalFX2Parameter,
            globalFX: s.globalFXParameter,
            custom: s.shaderParameter,
            brightness: typeof s.brightness === 'number' ? s.brightness : 1.0,
            customParams: s.customShaderParams || {}
        };

        // Final output to screen handled by PostProcessor.render (it binds null FBO)
        renderer.postProcessor.render(sourceTex, time, renderer.mouseX, renderer.mouseY, params, null);
        
        return null; // Pipeline ends here
    }
}

class QuantizedEffectsPass extends RenderPass {
    execute(renderer, sourceTex, s, d, time) {
        if (!renderer.effects) return sourceTex;

        const gl = renderer.gl;
        // The Quantized logic expects to render TO fboA2. 
        // If sourceTex is already texA2, we need to render to a different FBO to avoid Read/Write feedback loop.
        let targetFBO = renderer.fboCodeProcessed; 
        let targetTex = renderer.texCodeProcessed;

        if (sourceTex === renderer.texCodeProcessed) {
             targetFBO = renderer.fboA2;
             targetTex = renderer.texA2;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
        gl.viewport(0, 0, renderer.fboWidth, renderer.fboHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        if (renderer._renderQuantizedLineGfx(s, d, sourceTex, targetFBO)) {
            return targetTex;
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.fboLinePersist);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
            renderer._drawFullscreenTexture(sourceTex, 1.0, 0);
            return targetTex;
        }
    }
}



class WebGLRenderer {
    constructor(canvasId, grid, config, effects) {
        this.cvs = document.getElementById(canvasId);
        
        // Enforce WebGL2
        this.gl = this.cvs.getContext('webgl2', { alpha: false, preserveDrawingBuffer: false });
        
        if (!this.gl) {
            console.error("WebGLRenderer: WebGL 2 hardware acceleration not supported.");
            throw new Error("WebGL 2 not supported");
        }
        
        // Check for Float Texture Support (for HDR Bloom)
        this.canUseFloat = false;
        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (ext) this.canUseFloat = true;

        this.grid = grid;
        this.config = config;
        this.effects = effects;
        this.glyphAtlases = new Map();

        // Enforce configuration sync
        if (this.config.state.renderingEngine !== 'webgl') {
            this.config.state.renderingEngine = 'webgl';
        }

        // --- Core WebGL State ---
        this.program = null;       
        this.bloomProgram = null;  
        this.colorProgram = null;  
        this.atlasTexture = null;  
        this.vao = null;           
        
        // --- Buffers ---
        this.instanceCapacity = 0; 
        this.instanceBuffer = null;
        this.instanceData = null; // Interleaved Float32Array
        this.instanceDataU32 = null; // Uint32 view for colors
        this.instanceDataU16 = null; // Uint16 view for chars
        this.instanceDataU8 = null; // Uint8 view for decays

        this.depthBuffer = null; 

        // --- Uniform Location Cache ---
        this.uLocs = new Map();
        
        // --- Framebuffers for Bloom ---
        this.fboA = null; 
        this.fboA2 = null;
        this.fboCodeProcessed = null; 
        this.fboB = null; 
        this.fboC = null; // New Scratch FBO
        this.texA = null; 
        this.texA2 = null;
        this.texCodeProcessed = null; 
        this.texB = null; 
        this.texC = null; // New Scratch Texture
        this.bloomWidth = 0;
        this.bloomHeight = 0;

        // --- State Tracking ---
        this.w = 0;
        this.h = 0;
        this.needsAtlasUpdate = true;
        
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this._setupMouseTracking();

        this._initGlimmerTexture(); // Generate Optimization Texture
        this._initShaders();
        this._initBuffers();
        this._initBloomBuffers();
        this._initLineGfxBuffers();
        console.log("Rendering Engine: WebGL 2 (v8 CellGrid Optimized Fixed)");

        if (typeof PostProcessor !== 'undefined') {
            this.postProcessor = new PostProcessor(config, this.gl);
            this.lastSources = {};
        }

        // Initialize Render Pipeline
        this.pipeline = [
            // new BloomPass('Bloom'), // MOVED TO POST-PROCESSOR PASS 5 (globalFX)
            new QuantizedEffectsPass('QuantizedLineGfx'),
            new PostProcessPass('PostProcessingPipeline')
        ];
    }

    setGrid(grid) {
        this.grid = grid;
    }

    dispose() {
        if (this._mouseMoveHandler) window.removeEventListener('mousemove', this._mouseMoveHandler);
        if (this._touchMoveHandler) window.removeEventListener('touchmove', this._touchMoveHandler);
        if (this.postProcessor && this.postProcessor.canvas && this.postProcessor.canvas.parentNode) {
            this.postProcessor.canvas.parentNode.removeChild(this.postProcessor.canvas);
        }
        if (this.gl) {
            if (this.program2D) this.gl.deleteProgram(this.program2D);
            if (this.program && this.program !== this.program2D) this.gl.deleteProgram(this.program);
            
            if (this.bloomProgram) this.gl.deleteProgram(this.bloomProgram);
            if (this.colorProgram) this.gl.deleteProgram(this.colorProgram);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        }
    }

    _isMenuOpen() {
        const panel = document.getElementById('settingsPanel');
        return panel && panel.classList.contains('open');
    }

    _setupMouseTracking() {
        this._mouseMoveHandler = (e) => {
            if (this._isMenuOpen()) return;

            // Fallback for 2D or unlocked 3D (standard cursor tracking)
            const rect = this.cvs.getBoundingClientRect();
            this.mouseX = (e.clientX - rect.left) / rect.width;
            this.mouseY = 1.0 - ((e.clientY - rect.top) / rect.height);
        };
        this._touchMoveHandler = (e) => {
            if (this._isMenuOpen()) return;
            if (e.touches.length > 0) {
                const rect = this.cvs.getBoundingClientRect();
                this.mouseX = (e.clientX - rect.left) / rect.width;
                this.mouseY = 1.0 - ((e.clientY - rect.top) / rect.height);
            }
        };
        window.addEventListener('mousemove', this._mouseMoveHandler);
        window.addEventListener('touchmove', this._touchMoveHandler, { passive: true });
    }



    _initGlimmerTexture() {
        // Generate a 64x256 Noise Texture for Glimmer Optimization
        // Uses Strict Orthogonal "Manhattan" Walkers for Tetris-like connectivity
        const w = 64;
        const h = 256;
        const data = new Uint8Array(w * h);
        data.fill(0);
        
        // More walkers, but much sparser trail (fragmented)
        const numWalkers = 40;
        
        for (let n = 0; n < numWalkers; n++) {
            let x = Math.floor(Math.random() * w);
            let y = 0;
            
            let steps = 0;
            const maxSteps = h * 4; 
            
            while (y < h && steps < maxSteps) {
                // Fragmented: Only 40% chance to draw a block at current step
                // This creates "broken" connections and inconsistency
                if (Math.random() < 0.4) {
                    data[y * w + x] = 255;
                }
                
                const r = Math.random();
                if (r < 0.65) {
                    // Move UP (65% chance)
                    y++;
                } else if (r < 0.825) {
                    // Move LEFT
                    x = (x - 1 + w) % w;
                } else {
                    // Move RIGHT
                    x = (x + 1) % w;
                }
                steps++;
            }
        }
        
        this.glimmerTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.glimmerTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE, w, h, 0, this.gl.LUMINANCE, this.gl.UNSIGNED_BYTE, data);
        
        // Use NEAREST to preserve "Blocky/Digital" look
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
    }

    _createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source.trim());
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const err = this.gl.getShaderInfoLog(shader);
            const typeStr = (type === this.gl.VERTEX_SHADER) ? "VERTEX" : "FRAGMENT";
            console.error(`[WebGLRenderer] ${typeStr} Shader compile error:\n${err}`);
            
            // Log source with line numbers for easier debugging
            const lines = source.trim().split('\n');
            const numberedSource = lines.map((line, i) => `${(i + 1).toString().padStart(3, ' ')}: ${line}`).join('\n');
            console.error(`[WebGLRenderer] ${typeStr} Shader Source:\n${numberedSource}`);
            
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    _createProgram(vsSource, fsSource) {
        const vs = this._createShader(this.gl.VERTEX_SHADER, vsSource);
        const fs = this._createShader(this.gl.FRAGMENT_SHADER, fsSource);
        
        if (!vs || !fs) {
            if (this.config.state.logErrors) console.error('[WebGLRenderer] Failed to create program: Shader compilation failed.');
            return null;
        }

        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, vs);
        this.gl.attachShader(prog, fs);
        this.gl.linkProgram(prog);
        if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
            const err = this.gl.getProgramInfoLog(prog);
            console.error('Program link error:', err);
            return null;
        }

        // Cache all uniforms with their types for SOLID type-safe dispatch
        const count = this.gl.getProgramParameter(prog, this.gl.ACTIVE_UNIFORMS);
        const locs = {};
        for (let i = 0; i < count; i++) {
            const info = this.gl.getActiveUniform(prog, i);
            locs[info.name] = {
                loc: this.gl.getUniformLocation(prog, info.name),
                type: info.type
            };
        }
        this.uLocs.set(prog, locs);

        if (this.config.state.logErrors) console.log(`[WebGLRenderer] Shader Program created successfully. Cached ${count} uniforms.`);
        return prog;
    }

    _u(prog, name) {
        const locs = this.uLocs.get(prog);
        return (locs && locs[name]) ? locs[name].loc : null;
    }

    _uType(prog, name) {
        const locs = this.uLocs.get(prog);
        return (locs && locs[name]) ? locs[name].type : null;
    }

        _initShaders() {
            // --- SHADOW MASK SHADER ---
            const shadowVS = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 a_quad;
                layout(location=1) in vec4 a_rect;
                layout(location=2) in float a_alpha;
                layout(location=3) in float a_blur;
                uniform vec2 u_gridSize;
                out vec2 v_uv;
                out float v_alpha;
                out float v_blur;
                void main() {
                    vec2 size = a_rect.zw;
                    vec2 pos = a_rect.xy;
                    vec2 worldPos = pos + (a_quad * size);
                    vec2 uv = worldPos / u_gridSize;
                    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                    v_uv = a_quad;
                    v_alpha = a_alpha;
                    v_blur = a_blur;
                }
            `;
    
            const shadowFS = `#version 300 es
                precision highp float;
                in vec2 v_uv;
                in float v_alpha;
                in float v_blur;
                out vec4 fragColor;
                void main() {
                    vec2 d = abs(v_uv - 0.5) * 2.0;
                    float dist = max(d.x, d.y);
                    float edge = 1.0 - smoothstep(1.0 - max(0.001, v_blur), 1.0, dist);
                    fragColor = vec4(0.0, 0.0, 0.0, v_alpha * edge);
                }
            `;
            this.shadowProgram = this._createProgram(shadowVS, shadowFS);
    
            // --- QUANTIZED LINE GFX SHADER ---
            const lineVS = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 a_quad;
                out vec2 v_uv;
                void main() {
                    // a_quad is -1..1 (screen quad)
                    v_uv = a_quad * 0.5 + 0.5;
                    gl_Position = vec4(a_quad, 0.0, 1.0);
                }
            `;

            const lineFS = `#version 300 es
                precision highp float;
                in vec2 v_uv;
                uniform sampler2D u_characterBuffer;
                uniform sampler2D u_persistenceBuffer;
                uniform sampler2D u_shadowMask;
                uniform sampler2D u_sourceGrid;
                uniform sampler2D u_logicGrid;
                uniform vec2 u_logicGridSize; 
                uniform vec2 u_screenOrigin;
                uniform vec2 u_screenStep;
                uniform vec2 u_cellPitch;
                uniform vec2 u_blockOffset; 
                uniform vec2 u_userBlockOffset;
                uniform vec2 u_resolution;
                uniform vec2 u_offset;
                uniform vec2 u_sourceGridOffset;
                uniform vec2 u_sampleOffset;
                uniform int u_mode; // 0 = Generate, 1 = Composite, 2 = Pure Blit
                uniform ivec4 u_layerOrder; 
                
                uniform float u_thickness;
                uniform vec3 u_color;
                uniform vec3 u_fadeColor;
                uniform float u_intensity;
                uniform float u_glow;
                uniform float u_tintOffset;
                uniform float u_saturation;
                uniform float u_brightness;
                uniform float u_additiveStrength;
                uniform float u_sharpness;
                uniform float u_glowFalloff;
                uniform float u_roundness;
                uniform float u_maskSoftness;
                uniform float u_persistence;
                uniform bool u_showInterior;
                
                // Glass Rendering Uniforms
                uniform bool u_glassEnabled;
                uniform float u_glassBodyOpacity;
                uniform float u_glassEdgeGlow;
                uniform float u_glassRefraction;
                uniform float u_glassChromaticAberration;
                uniform float u_glassFresnel;
                uniform float u_glassBevel;
                uniform float u_glassOverlapRefraction;
                uniform float u_glassOverlapGlow;
                uniform float u_glassOverlapOpacity;
                uniform float u_glassBloom;
                uniform float u_glassLensCurvature;
                uniform float u_glassDarkness;
                
                out vec4 fragColor;

                vec4 getOccupancy(vec2 pos) {
                    if (pos.x < 0.0 || pos.x >= u_logicGridSize.x || pos.y < 0.0 || pos.y >= u_logicGridSize.y) return vec4(0.0);
                    return texture(u_logicGrid, (pos + 0.5) / u_logicGridSize);
                }

                float getLayerVal(vec4 occ, int idx) {
                    if (idx == 0) return occ.r;
                    if (idx == 1) return occ.g;
                    if (idx == 2) return occ.b;
                    if (idx == 3) return occ.a;
                    return 0.0;
                }

                float getSDF(vec2 p, vec2 a, vec2 b) {
                    vec2 pa = p - a, ba = b - a;
                    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                    return length(pa - ba * h);
                }

                vec3 boostSaturation(vec3 rgb, float amount) {
                    float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
                    return mix(vec3(luma), rgb, amount);
                }

                // Simple hue shift using rotation around the gray axis
                vec3 applyHueShift(vec3 color, float shift) {
                    if (abs(shift) < 0.001) return color;
                    const vec3 k = vec3(0.57735, 0.57735, 0.57735);
                    float angle = shift * 6.283185; // Map [-1..1] to [-2PI..2PI]
                    float cosAngle = cos(angle);
                    return color * cosAngle + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - cosAngle);
                }

                void main() {
                    // Mode 2: Shadow Mask Generation
                    if (u_mode == 2) {
                        vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution - u_offset;
                        vec2 gridPos = (screenPos - u_screenOrigin) / u_screenStep;
                        vec2 logicPos = gridPos / u_cellPitch + u_blockOffset - u_userBlockOffset;
                        vec2 blockCoord = floor(logicPos);
                        
                        vec4 occ = getOccupancy(blockCoord);
                        float maskSum = getLayerVal(occ, u_layerOrder.x) + getLayerVal(occ, u_layerOrder.y) + getLayerVal(occ, u_layerOrder.z) + getLayerVal(occ, u_layerOrder.w);
                        fragColor = vec4(maskSum, 0.0, 0.0, maskSum);
                        return;
                    }

                    // Mode 1: Composite / Glass / Lines
                    if (u_mode == 1) {
                        vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution - u_offset;
                        vec2 gridPos = (screenPos - u_screenOrigin) / u_screenStep;
                        vec2 logicPos = gridPos / u_cellPitch + u_blockOffset - u_userBlockOffset;
                        vec2 cellLocal = fract(logicPos);

                        vec4 base = texture(u_characterBuffer, v_uv);
                        vec4 persist = texture(u_persistenceBuffer, v_uv);
                        float normalLine = persist.r;
                        float fadeLine = persist.g;
                        float totalLine = normalLine + fadeLine;

                        vec2 sourceUV = v_uv + ((u_sourceGridOffset + u_sampleOffset) / u_resolution);
                        
                        // Sample Shadow World Character (Stencil)
                        float shadowLuma = 0.0;
                        if (u_maskSoftness > 0.0) {
                            float s = u_maskSoftness / u_resolution.x;
                            shadowLuma += texture(u_sourceGrid, sourceUV).r;
                            shadowLuma += texture(u_sourceGrid, sourceUV + vec2(s, 0.0)).r;
                            shadowLuma += texture(u_sourceGrid, sourceUV + vec2(-s, 0.0)).r;
                            shadowLuma += texture(u_sourceGrid, sourceUV + vec2(0.0, s)).r;
                            shadowLuma += texture(u_sourceGrid, sourceUV + vec2(0.0, -s)).r;
                            shadowLuma /= 5.0;
                        } else {
                            shadowLuma = texture(u_sourceGrid, sourceUV).r;
                        }
                        
                        // Apply Line Roundness as "Edge Softness" for the mask
                        float edgeSoft = max(0.001, u_roundness * 0.5);
                        float maskedLuma = smoothstep(0.5 - edgeSoft, 0.5 + edgeSoft, shadowLuma);
                        
                        float blockMask = texture(u_shadowMask, v_uv).r;
                        float isVisible = step(0.001, blockMask);
                        
                        vec3 resultColor = base.rgb * (1.0 - u_glassDarkness);

                        if (isVisible > 0.5) {
                            vec3 blockColor = vec3(0.0);
                            
                            if (u_glassEnabled) {
                                float stackCount = blockMask; 
                                float refOverlap = 1.0 + max(0.0, stackCount - 1.0) * u_glassOverlapRefraction;
                                float glowOverlap = 1.0 + max(0.0, stackCount - 1.0) * u_glassOverlapGlow;
                                float opacityOverlap = 1.0 + max(0.0, stackCount - 1.0) * u_glassOverlapOpacity;

                                vec2 centerOffset = cellLocal - 0.5;
                                float distToCenter = length(centerOffset);
                                float refraction = u_glassRefraction * refOverlap;
                                float lensCurv = pow(distToCenter * 2.0, u_glassLensCurvature);
                                vec2 displacement = centerOffset * lensCurv * refraction;
                                float ab = u_glassChromaticAberration;
                                
                                vec3 glassCode;
                                glassCode.r = texture(u_characterBuffer, v_uv + displacement * (1.0 + ab)).r;
                                glassCode.g = texture(u_characterBuffer, v_uv + displacement).g;
                                glassCode.b = texture(u_characterBuffer, v_uv + displacement * (1.0 - ab)).b;
                                
                                float fresnel = pow(distToCenter * 2.0, 3.0) * u_glassFresnel * glowOverlap;
                                float bevel = 0.0;
                                float bSoft = 0.05;
                                bevel += (1.0 - smoothstep(0.0, bSoft, cellLocal.x)) * u_glassBevel;
                                bevel += (1.0 - smoothstep(0.0, bSoft, cellLocal.y)) * u_glassBevel;
                                bevel -= smoothstep(1.0 - bSoft, 1.0, cellLocal.x) * u_glassBevel;
                                bevel -= smoothstep(1.0 - bSoft, 1.0, cellLocal.y) * u_glassBevel;
                                
                                blockColor = (glassCode * u_glassBloom * opacityOverlap * u_glassBodyOpacity) + (fresnel * 0.5) + bevel;
                            } else {
                                // Reveal Mode: Show the main pass results (which now include shadow world rain)
                                blockColor = base.rgb * u_glassBloom * u_glassBodyOpacity;
                            }
                            
                            resultColor = blockColor;
                        }

                        // Composite Grid Lines
                        if (totalLine > 0.001) {
                            float colorT = normalLine / (totalLine + 0.001);
                            // Decouple color mixing from Roundness (use fixed curve for color)
                            vec3 lineBaseColor = mix(u_fadeColor, u_color, pow(colorT, 1.5));
                            lineBaseColor = applyHueShift(lineBaseColor, u_tintOffset);
                            lineBaseColor = boostSaturation(mix(lineBaseColor, vec3(1.0), pow(totalLine, 8.0) * 0.5), u_saturation) * u_brightness;
                            
                            // Apply "Edge Softness" to the lines themselves as well
                            float softLine = smoothstep(0.5 - edgeSoft, 0.5 + edgeSoft, totalLine);
                            float lineIntensity = softLine * u_intensity * u_additiveStrength * maskedLuma;
                            
                            if (u_glassEnabled && isVisible > 0.5) lineIntensity *= u_glassEdgeGlow;
                            
                            resultColor += lineBaseColor * lineIntensity;
                        }

                        fragColor = vec4(resultColor, base.a);
                        return;
                    }

                    // Mode 0: Generate Lines
                    vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution - u_offset;
                    vec2 gridPos = (screenPos - u_screenOrigin) / u_screenStep;
                    vec2 logicPos = gridPos / u_cellPitch + u_blockOffset - u_userBlockOffset;
                    vec2 nearestI = floor(logicPos + 0.5);
                    vec2 p = (logicPos - nearestI) * u_cellPitch;
                    
                    float normalMax = 0.0;
                    float fadeMax = 0.0;
                    float halfThick = (u_thickness / 10.0) * 0.5;
                    
                    // Link u_roundness to sharpness for generation phase
                    float genSharp = u_sharpness + (u_roundness * 0.2); 

                    vec4 occNW = getOccupancy(nearestI + vec2(-1.0, -1.0));
                    vec4 occNE = getOccupancy(nearestI + vec2(0.0, -1.0));
                    vec4 occSW = getOccupancy(nearestI + vec2(-1.0, 0.0));
                    vec4 occSE = getOccupancy(nearestI + vec2(0.0, 0.0));

                    int L0 = u_layerOrder.x; int L1 = u_layerOrder.y;
                    float a0NW = getLayerVal(occNW, L0); float a0NE = getLayerVal(occNE, L0);
                    float a0SW = getLayerVal(occSW, L0); float a0SE = getLayerVal(occSE, L0);

                    for(int i=0; i<4; i++) {
                        int L;
                        if (i == 0) L = u_layerOrder.x;
                        else if (i == 1) L = u_layerOrder.y;
                        else if (i == 2) L = u_layerOrder.z;
                        else L = u_layerOrder.w;

                        float aNW = getLayerVal(occNW, L); float aNE = getLayerVal(occNE, L);
                        float aSW = getLayerVal(occSW, L); float aSE = getLayerVal(occSE, L);
                        bool isL1 = (L == L1);

                        if (abs(aNW - aNE) > 0.01) {
                            float d = getSDF(p, vec2(0.0, -u_cellPitch.y), vec2(0.0, 0.0));
                            float val = max(1.0 - smoothstep(halfThick - genSharp, halfThick + genSharp + 0.001, d), exp(-d * u_glowFalloff) * (u_glow * 0.5)) * max(aNW, aNE);
                            if (isL1 && a0NW > 0.01 && a0NE > 0.01) fadeMax = max(fadeMax, val); else normalMax = max(normalMax, val);
                        }
                        if (abs(aSW - aSE) > 0.01) {
                            float d = getSDF(p, vec2(0.0, 0.0), vec2(0.0, u_cellPitch.y));
                            float val = max(1.0 - smoothstep(halfThick - genSharp, halfThick + genSharp + 0.001, d), exp(-d * u_glowFalloff) * (u_glow * 0.5)) * max(aSW, aSE);
                            if (isL1 && a0SW > 0.01 && a0SE > 0.01) fadeMax = max(fadeMax, val); else normalMax = max(normalMax, val);
                        }
                        if (abs(aNW - aSW) > 0.01) {
                            float d = getSDF(p, vec2(-u_cellPitch.x, 0.0), vec2(0.0, 0.0));
                            float val = max(1.0 - smoothstep(halfThick - genSharp, halfThick + genSharp + 0.001, d), exp(-d * u_glowFalloff) * (u_glow * 0.5)) * max(aNW, aSW);
                            if (isL1 && a0NW > 0.01 && a0SW > 0.01) fadeMax = max(fadeMax, val); else normalMax = max(normalMax, val);
                        }
                        if (abs(aNE - aSE) > 0.01) {
                            float d = getSDF(p, vec2(0.0, 0.0), vec2(u_cellPitch.x, 0.0));
                            float val = max(1.0 - smoothstep(halfThick - genSharp, halfThick + genSharp + 0.001, d), exp(-d * u_glowFalloff) * (u_glow * 0.5)) * max(aNE, aSE);
                            if (isL1 && a0NE > 0.01 && a0SE > 0.01) fadeMax = max(fadeMax, val); else normalMax = max(normalMax, val);
                        }
                    }
                    fragColor = vec4(normalMax, fadeMax * (1.0 - u_persistence), 0.0, 1.0);
                }
            `;

            this.lineProgram = this._createProgram(lineVS, lineFS);

            // --- MATRIX SHADERS (SPLIT 2D/3D) ---
            
            const matrixVS_Common = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 a_quad;
                layout(location=1) in vec2 a_pos;
                layout(location=2) in float a_charIdx;
                layout(location=3) in vec4 a_color;
                layout(location=4) in float a_alpha;
                layout(location=5) in float a_decay;
                layout(location=6) in float a_glow;
                layout(location=7) in float a_mix;
                layout(location=8) in float a_nextChar;
                layout(location=10) in float a_maxDecay;
                layout(location=11) in float a_shapeID;
                layout(location=12) in float a_glimmerFlicker;
                layout(location=13) in float a_glimmerAlpha;
                layout(location=14) in float a_dissolve;
    
                out vec2 v_uv;
                out vec2 v_uv2;
                out vec4 v_color;
                out float v_mix;
                out float v_glow;
                out float v_prog;
                out vec2 v_screenUV;
                out vec2 v_cellPos;
                out vec2 v_cellUV;
                out float v_glimmerFlicker;
                out float v_glimmerAlpha;
                out float v_shapeID;
            `;
    
            // 2D Vertex Shader
            const matrixVS2D = matrixVS_Common + `
                uniform vec2 u_resolution;
                uniform vec2 u_atlasSize;
                uniform vec2 u_gridSize;
                uniform float u_cellSize;
                uniform float u_cols;
                uniform float u_decayDur;
                uniform vec2 u_stretch;
                uniform float u_mirror;
                uniform float u_dissolveEnabled;
                uniform float u_dissolveScale;
    
                void main() {
                    // Optimized Effect Passing
                    v_glimmerFlicker = a_glimmerFlicker;
                    v_glimmerAlpha = a_glimmerAlpha;
                    v_shapeID = a_shapeID;
                    v_prog = a_dissolve;
                    
                    // Decay Scale Logic (Legacy support for non-optimized effects if needed)
                    float scale = 1.0;
                    if (v_prog > 0.0 && u_dissolveEnabled > 0.5) {
                        scale = mix(1.0, u_dissolveScale, v_prog);
                    }
                    
                    v_cellUV = a_quad;
                    // Position Calculation (2D)
                    vec2 centerPos2D = (a_quad - 0.5) * u_cellSize * scale;
                    vec2 worldPos = a_pos + centerPos2D;
                    
                    v_cellPos = floor(a_pos / u_cellSize);
                    
                    // Mirror/Stretch
                    vec2 gridCenter = u_gridSize * 0.5;
                    worldPos.x = (worldPos.x - gridCenter.x) * u_stretch.x + (u_resolution.x * 0.5);
                    worldPos.y = (worldPos.y - gridCenter.y) * u_stretch.y + (u_resolution.y * 0.5);
                    
                    if (u_mirror < 0.0) worldPos.x = u_resolution.x - worldPos.x;
    
                    // 2D Mode (Legacy Clip Space)
                    vec2 clip = (worldPos / u_resolution) * 2.0 - 1.0;
                    clip.y = -clip.y;
                    gl_Position = vec4(clip, 0.0, 1.0);
                    
                    // Pass Attributes
                    vec3 ndc = gl_Position.xyz / gl_Position.w;
                    v_screenUV = ndc.xy * 0.5 + 0.5;
    
                    v_color = a_color;
                    v_color.a *= a_alpha;
                    v_mix = a_mix;
                    v_glow = a_glow;
    
                    // UV 1
                    float cIdx = a_charIdx;
                    if (cIdx < 65534.5) {
                        float row = floor(cIdx / u_cols);
                        float col = mod(cIdx, u_cols);
                        vec2 uvBase = vec2(col, row) * u_cellSize;
                        v_uv = (uvBase + (a_quad * u_cellSize)) / u_atlasSize;
                    } else {
                        v_uv = vec2(-1.0, -1.0);
                    }
    
                    // UV 2
                    if (a_mix > 0.0) {
                        float cIdx2 = a_nextChar;
                        if (cIdx2 < 65534.5) {
                            float row2 = floor(cIdx2 / u_cols);
                            float col2 = mod(cIdx2, u_cols);
                            vec2 uvBase2 = vec2(col2, row2) * u_cellSize;
                            v_uv2 = (uvBase2 + (a_quad * u_cellSize)) / u_atlasSize;
                        } else {
                            v_uv2 = vec2(-1.0, -1.0);
                        }
                    } else {
                        v_uv2 = v_uv;
                    }
                }
            `;
    

    
            // Optimized Fragment Shader (Shared)
            const matrixFS = `#version 300 es
                precision highp float;
                in vec2 v_uv;
                in vec2 v_uv2;
                in vec4 v_color;
                in float v_mix;
                in float v_glow;
                in float v_prog;
                in vec2 v_screenUV;
                in vec2 v_cellPos;
                in vec2 v_cellUV;
                in float v_glimmerFlicker;
                in float v_glimmerAlpha;
                in float v_shapeID;
                
                uniform sampler2D u_texture;
                uniform sampler2D u_shadowMask; 
                uniform sampler2D u_glimmerNoise; 
                
                uniform float u_time;
                uniform float u_dissolveEnabled; 
                uniform float u_dissolveScale;
                uniform float u_dissolveSize;
                
                uniform float u_deteriorationEnabled;
                uniform float u_deteriorationStrength;
                uniform vec2 u_atlasSize;
                uniform vec2 u_gridSize; 
                uniform float u_cellSize; 
                uniform vec2 u_cellScale; 
                uniform vec4 u_overlapColor;
                uniform float u_glimmerSpeed;
                uniform float u_glimmerSize;
                uniform float u_glimmerIntensity;
                uniform float u_glimmerFlicker; 
                uniform float u_brightness;
                
                // 0 = Base (Glyphs/Glow), 1 = Shadow
                uniform int u_passType;
                uniform bool u_glassEnabled;
                
                out vec4 fragColor;
    
                // Helper to apply all visual degradations (Dissolve + Ghosting) identically
                float getProcessedAlpha(vec2 uv) {
                    if (uv.x < 0.0) return 0.0;
                    float a = texture(u_texture, uv).a;
    
                    // Optimized Trail Ghosting (Vertical Blur)
                    if (u_deteriorationEnabled > 0.5 && v_prog > 0.0) {
                        float blurDist = (u_deteriorationStrength * v_prog) / u_atlasSize.y;
                        float g1 = texture(u_texture, uv + vec2(0.0, blurDist)).a;
                        float g2 = texture(u_texture, uv - vec2(0.0, blurDist)).a;
                        
                        // Alpha Erosion Dissolve (Burn away from edges)
                        if (u_dissolveEnabled > 0.5) {
                            float erosion = v_prog * 1.2; 
                            float threshold = erosion + 0.1;
                            a = min(a, smoothstep(erosion, threshold, a));
                            g1 = min(g1, smoothstep(erosion, threshold, g1));
                            g2 = min(g2, smoothstep(erosion, threshold, g2));
                        }
                        a = max(a, max(g1, g2) * 0.5);
                    } else if (u_dissolveEnabled > 0.5 && v_prog > 0.0) {
                        float erosion = v_prog * 1.2; 
                        a = min(a, smoothstep(erosion, erosion + 0.1, a));
                    }
                    
                    return a;
                }
    
                void main() {
                    // Decode High Priority Signal
                    bool isHighPriority = (v_mix >= 9.5);
                    float useMix = isHighPriority ? v_mix - 10.0 : v_mix;
    
                    // Sample Shadow Mask using screen coordinates for perfect alignment
                    float shadow = texture(u_shadowMask, v_screenUV).a;
                    
                    // Sample Texture with Effects
                    float tex1 = getProcessedAlpha(v_uv);
                    vec4 baseColor = v_color;
                    
                    // Default Standard Mode
                    float finalAlpha = tex1;
                    
                    // --- OPTIMIZED GLIMMER LOGIC ---
                    float glimmer = 0.0;
                    if (v_glimmerAlpha > 0.0) {
                        float rawTex = texture(u_texture, v_uv).a;
                        if (rawTex > 0.3) {
                            vec2 center = vec2(0.5);
                            vec2 sizeBounds = vec2(0.1, 0.1); 
                            float rotation = 0.0;
                            
                            // Shape ID Decoding (CPU Determined)
                            int sID = int(v_shapeID + 0.5);
                            if (sID == 1) { center = vec2(0.2, 0.5); sizeBounds = vec2(0.08, 0.45); }
                            else if (sID == 2) { center = vec2(0.8, 0.5); sizeBounds = vec2(0.08, 0.45); }
                            else if (sID == 3) { center = vec2(0.5, 0.8); sizeBounds = vec2(0.45, 0.08); }
                            else if (sID == 4) { center = vec2(0.5, 0.2); sizeBounds = vec2(0.45, 0.08); }
                            else if (sID == 5) { center = vec2(0.5, 0.5); sizeBounds = vec2(0.45, 0.06); }
                            else if (sID == 6) { center = vec2(0.5, 0.5); sizeBounds = vec2(0.15, 0.15); }
                            else if (sID == 7) { rotation = 0.785398; sizeBounds = vec2(0.05, 0.55); }
                            else if (sID == 8) { rotation = -0.785398; sizeBounds = vec2(0.05, 0.55); }

                            // Sample Noise Texture (Static per cell seed offset)
                            vec2 noiseUV = (v_cellPos / 64.0) + (v_shapeID * 0.123);
                            float activeVal = texture(u_glimmerNoise, noiseUV).r;
                            
                            // Draw Shape
                            vec2 p = v_cellUV - center;
                            if (rotation != 0.0) {
                                float s = sin(rotation); float c = cos(rotation);
                                p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
                            }
                            p = abs(p);
                            float d = length(max(p - sizeBounds, vec2(0.0))) + min(max(p.x - sizeBounds.x, p.y - sizeBounds.y), 0.0) - 0.01;
                            float shape = (1.0 - smoothstep(-0.01, 0.01, d)) + (1.0 - smoothstep(0.0, 0.15, d)) * 0.4;

                            glimmer = shape * (0.4 + (0.6 * activeVal)) * v_glimmerFlicker * v_glimmerAlpha;
                        }
                    }
    
                    if (useMix >= 5.0) {
                        // DUAL World Mode (Shadow Transition Overlap)
                        float originalBaseAlpha = baseColor.a; // OW Combined Alpha (Sim * Fade)
                        float nwA = v_glow; // NW Combined Alpha (Sim * Fade)
                        
                        float tex2 = getProcessedAlpha(v_uv2);
                        float owA = tex1 * originalBaseAlpha;
                        
                        // Overlap: combine the character strokes from both worlds
                        finalAlpha = max(owA, tex2 * nwA);
                        baseColor.a = 1.0; 
                    } else if (useMix >= 4.0) {
                        // Overlay Mode (Tracers/Effects)
                        // Use baseColor so tracers follow Stream Color.
                        float originalBaseAlpha = baseColor.a;
                        
                        float ovAlpha = useMix - 4.0;
                        float tex2 = getProcessedAlpha(v_uv2);
                        float effA = tex2 * ovAlpha;
                        
                        float simA = tex1 * originalBaseAlpha;
                        
                        // Mix towards White (Tracer-like) instead of just boosting brightness
                        vec3 targetColor = vec3(0.95, 0.95, 0.95); 
                        baseColor.rgb = mix(baseColor.rgb, targetColor, effA);
                        
                        finalAlpha = max(simA, effA);
                        baseColor.a = 1.0; // Prevent base instance alpha (0 for empty) from killing the overlay
                    } else if (useMix >= 3.0) {
                        // Solid Mode
                        finalAlpha = 1.0;
                    } else if (useMix >= 2.0) {
                        // Overlap Mode
                        // Apply same effects to secondary character
                        float tex2 = getProcessedAlpha(v_uv2);
                        
                        float intersection = tex1 * tex2;
                        // Primary visible, secondary invisible except intersection
                        finalAlpha = tex1; 
                        
                        // If intersecting, use overlap color
                        if (intersection > 0.1) {
                                baseColor.rgb = u_overlapColor.rgb;
                        }
                    } else if (useMix > 0.0) {
                        // Rotator Mix
                        // For rotator, we might NOT want dissolve/ghosting on the incoming char yet?
                        // Usually rotator happens on active cells (decay=0).
                        // If decay=0, getProcessedAlpha just returns raw alpha. So it's safe.
                        float tex2 = getProcessedAlpha(v_uv2);
                        finalAlpha = mix(tex1, tex2, useMix);
                    }
    
                    if (finalAlpha < 0.01) discard;
    
                    // Apply Shadow Darkening
                    // shadow = 0..1 (0=No Shadow, 1=Black)
                    // glassMask = 0..1 (quantized blocks)
                    float glassMask = texture(u_shadowMask, v_screenUV).r;
                    
                    // REDUNDANCY REMOVED: Shadow now only affects streamAlpha below
                    // This prevents double-darkening (RGB * shadow * Alpha * shadow)
    
                    vec4 col = baseColor;
                    // Boost brightness for glow (Bloom trigger)
                    // Multiply by alpha to ensure it fades out with the character
                    if (v_glow > 0.0) {
                        float glowFactor = v_glow;
                        if (!isHighPriority) {
                            float gSMult = 1.0 - shadow;
                            if (u_glassEnabled && glassMask > 0.001) gSMult = 1.0;
                            glowFactor *= gSMult;
                        }
                        
                        col.rgb += (glowFactor * 0.3 * col.a);
                    }
    
                    // Base Alpha (Stream Fade)
                    float sAlphaMult = 1.0 - shadow;
                    if (isHighPriority || glassMask > 0.001) sAlphaMult = 1.0;
                    float streamAlpha = col.a * finalAlpha * sAlphaMult;
                    if (!isHighPriority && glassMask > 0.001) streamAlpha *= glassMask;
    
                    if (glimmer > 0.0) {
                        // 1. Turn the block White (mix base color to white)
                        // Clamp mixing factor to 1.0 to stay within white range
                        col.rgb = mix(col.rgb, vec3(1.0), min(1.0, glimmer));
                        
                        // 2. Add Bright Glow (Additively)
                        // Use u_glimmerIntensity (from slider) to boost brightness significantly
                        // We do NOT multiply by shadow here, allowing glimmer to pierce darkness
                        // Scale by 0.3 to match standard glow intensity curve
                        vec3 glowBoost = vec3(u_glimmerIntensity * 0.3) * glimmer;
                        col.rgb += glowBoost;
    
                        // Force alpha to be at least the glimmer opacity
                        streamAlpha = max(streamAlpha, glimmer);
                    }
    
                    // Boosted brightness (Task 3: +5% floor)
                    fragColor = vec4(col.rgb * (u_brightness + 0.05), streamAlpha);
                }
            `;
            
            this.program2D = this._createProgram(matrixVS2D, matrixFS);
            this.program = this.program2D; // Default fallback
    
            // Keep existing Bloom/Color programs
            const bloomVS = `#version 300 es
                layout(location=0) in vec2 a_position; 
                out vec2 v_uv; 
                void main(){ 
                    v_uv = a_position * 0.5 + 0.5; 
                    gl_Position = vec4(a_position, 0.0, 1.0); 
                }`;
            const bloomFS = `#version 300 es
                precision highp float; 
                in vec2 v_uv; 
                uniform sampler2D u_image; 
                uniform bool u_horizontal; 
                uniform float u_weight[5]; 
                uniform float u_spread; 
                uniform float u_opacity; 
                uniform bool u_extract; // NEW: Highlight Extraction Flag
                
                out vec4 fragColor; 
                
                vec4 getSample(vec2 uv) {
                    vec4 col = texture(u_image, uv);
                    if (u_extract) {
                        float brightness = max(max(col.r, col.g), col.b);
                        
                        // If it's too dark, it doesn't contribute to bloom at all
                        if (brightness < 0.1) return vec4(0.0);
                        
                        // Otherwise, scale it based on how bright it is, boosting the core
                        float extractAmt = smoothstep(0.1, 0.9, brightness);
                        // Multiply RGB by alpha to premultiply it, preventing dark halos when blended
                        vec3 rgb = col.rgb * extractAmt * 2.0;
                        float a = col.a * extractAmt;
                        return vec4(rgb * a, a);
                    }
                    return col;
                }

                void main(){ 
                    // Increase the perceived spread by multiplying the offset significantly
                    vec2 tex_offset = (vec2(1.0) / vec2(textureSize(u_image, 0))) * u_spread; 
                    
                    vec4 result = getSample(v_uv) * u_weight[0]; 
                    if(u_horizontal){ 
                        // Widen the loop to reach further pixels (simulate 11-tap)
                        for(int i=1; i<5; ++i){ 
                            float dist = float(i) * 2.0; // Step twice as far for each weight
                            result += getSample(v_uv + vec2(tex_offset.x * dist, 0.0)) * u_weight[i]; 
                            result += getSample(v_uv - vec2(tex_offset.x * dist, 0.0)) * u_weight[i]; 
                        } 
                    } else { 
                        for(int i=1; i<5; ++i){ 
                            float dist = float(i) * 2.0;
                            result += getSample(v_uv + vec2(0.0, tex_offset.y * dist)) * u_weight[i]; 
                            result += getSample(v_uv - vec2(0.0, tex_offset.y * dist)) * u_weight[i]; 
                        } 
                    } 
                    
                    if (u_extract) {
                         fragColor = result * u_opacity;
                    } else {
                         // Normal blur passes (already premultiplied by extraction pass)
                         fragColor = result * u_opacity;
                    }
                }`;
            this.bloomProgram = this._createProgram(bloomVS, bloomFS);
    
            const colorVS = `#version 300 es\nlayout(location=0) in vec2 a_position; void main(){ gl_Position=vec4(a_position, 0.0, 1.0); }`;
            const colorFS = `#version 300 es\nprecision highp float; uniform vec4 u_color; out vec4 fragColor; void main(){ fragColor=u_color; }`;
            this.colorProgram = this._createProgram(colorVS, colorFS);
        }
    _initBuffers() {
        const quadVerts = new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]);
        const screenQuadVerts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
        
        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVerts, this.gl.STATIC_DRAW);
        
        this.screenQuadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, screenQuadVerts, this.gl.STATIC_DRAW);

        // Shadow Instance Buffer (Dynamic)
        this.shadowInstanceBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowInstanceBuffer);
        this.shadowInstanceCapacity = 1000;
        // Initial capacity: 1000 sheets * 24 bytes (x,y,w,h,alpha,blur)
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowInstanceCapacity * 24, this.gl.DYNAMIC_DRAW);

        // Instance buffers will be created in resize()
        this.posBuffer = null;
        this.instanceBuffer = null;
    }

    _initBloomBuffers() {
        this.fboA = this.gl.createFramebuffer(); this.texA = this.gl.createTexture();
        this.fboA2 = this.gl.createFramebuffer(); this.texA2 = this.gl.createTexture();
        this.fboCodeProcessed = this.gl.createFramebuffer(); this.texCodeProcessed = this.gl.createTexture();
        this.fboB = this.gl.createFramebuffer(); this.texB = this.gl.createTexture();
        this.fboC = this.gl.createFramebuffer(); this.texC = this.gl.createTexture();
        
        // Line Persistence
        this.fboLinePersist = this.gl.createFramebuffer();
        this.texLinePersist = this.gl.createTexture();
        
        // Shadow Mask FBO
        this.shadowMaskFbo = this.gl.createFramebuffer(); 
        this.shadowMaskTex = this.gl.createTexture();
    }

    _initLineGfxBuffers() {
        this.logicGridTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.lastLogicGridWidth = 0;
        this.lastLogicGridHeight = 0;

        this.sourceGridTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceGridTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.lastSourceGridSeed = -1;

        // Initialize VAO for line/glass rendering (Mode 0, 1, 2)
        this.vaoLine = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.vaoLine);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.bindVertexArray(null);
    }

    _configureFramebuffer(fbo, tex, width, height) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        
        let internalFormat = this.gl.RGBA;
        let type = this.gl.UNSIGNED_BYTE;
        
        if (this.canUseFloat) {
            internalFormat = this.gl.RGBA16F;
            type = this.gl.HALF_FLOAT;
        }
        
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, internalFormat, width, height, 0, this.gl.RGBA, type, null);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, tex, 0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    handleFontChange() { this.glyphAtlases.clear(); this.needsAtlasUpdate = true; }
    handleAppearanceChange() { this.needsAtlasUpdate = true; }
    updateSmoothing() { 
        const s = this.config.state.smoothingEnabled ? this.config.state.smoothingAmount : 0; 
        this.cvs.style.filter = `blur(${s}px)`; 
    }

    resize() {
        const s = this.config.state;
        const d = this.config.derived;
        const scale = s.resolution;
        
        this.handleAppearanceChange();
        this.w = window.innerWidth;
        this.h = window.innerHeight;
        
        // Fix: Explicitly set CSS size to match window, independent of buffer resolution
        this.cvs.style.width = `${this.w}px`;
        this.cvs.style.height = `${this.h}px`;
        
        const pw = Math.floor(this.w * scale);
        const ph = Math.floor(this.h * scale);

        if (this.cvs.width !== pw || this.cvs.height !== ph) {
            this.cvs.width = pw; this.cvs.height = ph; this.gl.viewport(0, 0, pw, ph);
        }
        
        if (this.fboWidth !== pw || this.fboHeight !== ph) {
            this.fboWidth = pw; this.fboHeight = ph;
            this.bloomWidth = Math.floor(pw * 0.5); this.bloomHeight = Math.floor(ph * 0.5);
            if (pw > 0 && ph > 0) {
                        this._configureFramebuffer(this.fboA, this.texA, this.fboWidth, this.fboHeight);
                        this._configureFramebuffer(this.fboA2, this.texA2, this.fboWidth, this.fboHeight);
                        this._configureFramebuffer(this.fboCodeProcessed, this.texCodeProcessed, this.fboWidth, this.fboHeight);
                        this._configureFramebuffer(this.fboLinePersist, this.texLinePersist, this.fboWidth, this.fboHeight);                this._configureFramebuffer(this.fboB, this.texB, this.bloomWidth, this.bloomHeight);
                this._configureFramebuffer(this.fboC, this.texC, this.bloomWidth, this.bloomHeight);
                
                // Shadow Mask (Matches Render Resolution)
                this._configureFramebuffer(this.shadowMaskFbo, this.shadowMaskTex, this.fboWidth, this.fboHeight);
            }
        }
        if (this.postProcessor) { 
            this.postProcessor.resize(pw, ph); 
            if (this.postProcessor.canvas) {
                this.postProcessor.canvas.style.width = `${this.w}px`; 
                this.postProcessor.canvas.style.height = `${this.h}px`; 
            }
        }

        // --- Resize Buffers ---
        const totalCells = this.grid.cols * this.grid.rows;
        this.instanceCapacity = totalCells;
        
        // Static Position Buffer
        if (this.posBuffer) this.gl.deleteBuffer(this.posBuffer);
        this.posBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, totalCells * 8, this.gl.STATIC_DRAW); // 2 floats * 4 bytes
        
        const posData = new Float32Array(totalCells * 2);
        const cw = d.cellWidth; const ch = d.cellHeight;
        for (let i = 0; i < totalCells; i++) {
             const col = i % this.grid.cols;
             const row = Math.floor(i / this.grid.cols);
             posData[i*2] = col * cw + cw * 0.5;
             posData[i*2+1] = row * ch + ch * 0.5;
        }
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, posData);

        // Interleaved Dynamic Buffer
        // Stride = 40 bytes (Optimized & Aligned)
        if (this.instanceBuffer) this.gl.deleteBuffer(this.instanceBuffer);
        this.instanceBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, totalCells * 40, this.gl.DYNAMIC_DRAW);

        const bufferSize = totalCells * 40;
        this.instanceBufferData = new ArrayBuffer(bufferSize);
        this.instanceData = new Float32Array(this.instanceBufferData);
        this.instanceDataU32 = new Uint32Array(this.instanceBufferData);
        this.instanceDataU16 = new Uint16Array(this.instanceBufferData);
        this.instanceDataU8 = new Uint8Array(this.instanceBufferData);

        this._setupVAO();
    }

    _setupVAO() {
        if (this.vao) this.gl.deleteVertexArray(this.vao);
        this.vao = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.vao);

        // 0: Quad (Vertex)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);

        // 1: Pos (Static Instance)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribDivisor(1, 1);

        // Interleaved Attributes (Stride = 40 bytes)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);

        // 2: CharIdx (U16 at offset 0)
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 1, this.gl.UNSIGNED_SHORT, false, 40, 0);
        this.gl.vertexAttribDivisor(2, 1);

        // 8: NextChar (U16 at offset 2)
        this.gl.enableVertexAttribArray(8);
        this.gl.vertexAttribPointer(8, 1, this.gl.UNSIGNED_SHORT, false, 40, 2);
        this.gl.vertexAttribDivisor(8, 1);

        // 3: Color (U32 at offset 4, normalized)
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.UNSIGNED_BYTE, true, 40, 4);
        this.gl.vertexAttribDivisor(3, 1);

        // 4: Alpha (F32 at offset 8)
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, 40, 8);
        this.gl.vertexAttribDivisor(4, 1);

        // 6: Glow (F32 at offset 12)
        this.gl.enableVertexAttribArray(6);
        this.gl.vertexAttribPointer(6, 1, this.gl.FLOAT, false, 40, 12);
        this.gl.vertexAttribDivisor(6, 1);

        // 7: Mix (F32 at offset 16)
        this.gl.enableVertexAttribArray(7);
        this.gl.vertexAttribPointer(7, 1, this.gl.FLOAT, false, 40, 16);
        this.gl.vertexAttribDivisor(7, 1);

        // 5: Decay (U8 at offset 20)
        this.gl.enableVertexAttribArray(5);
        this.gl.vertexAttribPointer(5, 1, this.gl.UNSIGNED_BYTE, false, 40, 20);
        this.gl.vertexAttribDivisor(5, 1);
        
        // 11: ShapeID (U8 at offset 21)
        this.gl.enableVertexAttribArray(11);
        this.gl.vertexAttribPointer(11, 1, this.gl.UNSIGNED_BYTE, false, 40, 21);
        this.gl.vertexAttribDivisor(11, 1);

        // 10: MaxDecay (U16 at offset 22)
        this.gl.enableVertexAttribArray(10);
        this.gl.vertexAttribPointer(10, 1, this.gl.UNSIGNED_SHORT, false, 40, 22);
        this.gl.vertexAttribDivisor(10, 1);

        // 12: GlimmerFlicker (F32 at offset 24)
        this.gl.enableVertexAttribArray(12);
        this.gl.vertexAttribPointer(12, 1, this.gl.FLOAT, false, 40, 24);
        this.gl.vertexAttribDivisor(12, 1);
        
        // 13: GlimmerAlpha (F32 at offset 28)
        this.gl.enableVertexAttribArray(13);
        this.gl.vertexAttribPointer(13, 1, this.gl.FLOAT, false, 40, 28);
        this.gl.vertexAttribDivisor(13, 1);

        // 14: Dissolve (F32 at offset 32)
        this.gl.enableVertexAttribArray(14);
        this.gl.vertexAttribPointer(14, 1, this.gl.FLOAT, false, 40, 32);
        this.gl.vertexAttribDivisor(14, 1);

        this.gl.bindVertexArray(null);
    }



    _drawFullscreenTexture(texture, opacity, blurAmt) {
        if (!this.bloomProgram) return;
        this.gl.useProgram(this.bloomProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
                this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_image'), 0);
        
                const weights = [1.0, 0.0, 0.0, 0.0, 0.0];
                this.gl.uniform1fv(this.gl.getUniformLocation(this.bloomProgram, 'u_weight'), weights);
                this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_spread'), 0.0);
                this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_opacity'), opacity);
                this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_horizontal'), 1);
                this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_extract'), 0);
        
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);    }

    _renderQuantizedShadows(fx) {
        if (!fx || !fx.renderGrid) return;
        
        const s = this.config.state;
        const d = this.config.derived;
        const fxState = fx.getWebGLRenderState(s, d);
        const [gw, gh] = fxState.logicGridSize;

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.shadowMaskFbo);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 

        // 1. Prepare Logic Texture
        const now = fx.animFrame;
        const fadeIn = fx.getConfig('FadeInFrames') || 0;
        const fadeOut = fx.getConfig('FadeFrames') || 0;

        const occupancy = new Uint8Array(gw * gh * 4);
        for (let i = 0; i < gw * gh; i++) {
            for (let L = 0; L < 4; L++) {
                const grid = fx.layerGrids[L];
                const rGrid = fx.removalGrids[L];
                let alpha = 0;
                
                if (grid && grid[i] !== -1) {
                    const birth = grid[i];
                    alpha = (fadeIn > 0 && now < birth + fadeIn) 
                        ? Math.floor(Math.max(0, Math.min(1, (now - birth) / fadeIn)) * 255)
                        : 255;
                } else if (rGrid && rGrid[i] !== -1) {
                    const death = rGrid[i];
                    alpha = (fadeOut > 0 && now < death + fadeOut)
                        ? Math.floor(Math.max(0, Math.min(1, 1.0 - (now - death) / fadeOut)) * 255)
                        : 0;
                }
                occupancy[i * 4 + L] = alpha;
            }
        }
        
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, gw, gh, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, occupancy);
        
        // 2. Prepare Uniforms
        const scale = s.resolution || 1.0;
        const gridPixW = fx.g.cols * d.cellWidth * scale; 
        const gridPixH = fx.g.rows * d.cellHeight * scale;
        const screenStepX = d.cellWidth * s.stretchX * scale;
        const screenStepY = d.cellHeight * s.stretchY * scale;
        const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (this.fboWidth * 0.5);
        const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (this.fboHeight * 0.5);

        const uniforms = {
            u_mode: 2,
            u_logicGridSize: fxState.logicGridSize,
            u_screenOrigin: [screenOriginX, screenOriginY],
            u_screenStep: [screenStepX, screenStepY],
            u_cellPitch: fxState.cellPitch,
            u_blockOffset: fxState.blockOffset,
            u_userBlockOffset: fxState.userBlockOffset,
            u_resolution: [this.fboWidth, this.fboHeight],
            u_offset: [s.quantizedLineGfxOffsetX * scale, s.quantizedLineGfxOffsetY * scale],
            u_layerOrder: fxState.layerOrder,
            u_showInterior: fxState.showInterior,
            u_logicGrid: 1
        };

        const textures = { 1: this.logicGridTexture };

        this._drawFullscreenPass(this.lineProgram, this.shadowMaskFbo, uniforms, textures, { src: this.gl.ONE, dst: this.gl.ONE });
        
        this.gl.disable(this.gl.BLEND);
    }

    _drawFullscreenPass(program, targetFBO, uniforms = {}, textures = {}, blend = null, viewport = null) {
        if (!program) return;
        
        // 1. Target Management
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
        if (viewport) {
            this.gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);
        } else {
            this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
        }

        // 2. Program and VAO Setup
        this.gl.useProgram(program);
        this.gl.bindVertexArray(this.vaoLine);

        // 3. Blend State
        if (blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(blend.src, blend.dst);
        } else {
            this.gl.disable(this.gl.BLEND);
        }

        // 4. Type-Aware Uniform Dispatch (SOLID/DIP)
        for (const [name, value] of Object.entries(uniforms)) {
            const loc = this._u(program, name);
            const type = this._uType(program, name);
            if (!loc) continue;

            if (typeof value === 'number') {
                // Correctly dispatch based on shader type
                if (type === this.gl.INT || type === this.gl.BOOL || type === this.gl.SAMPLER_2D) {
                    this.gl.uniform1i(loc, Math.floor(value));
                } else {
                    this.gl.uniform1f(loc, value);
                }
            } else if (Array.isArray(value) || value instanceof Float32Array || value instanceof Int32Array) {
                if (value.length === 2) this.gl.uniform2fv(loc, value);
                else if (value.length === 3) this.gl.uniform3fv(loc, value);
                else if (value.length === 4) {
                    if (value instanceof Int32Array || type === this.gl.INT_VEC4) this.gl.uniform4iv(loc, value);
                    else this.gl.uniform4fv(loc, value);
                }
                else if (value.length > 4) this.gl.uniform1fv(loc, value);
            } else if (typeof value === 'boolean') {
                this.gl.uniform1i(loc, value ? 1 : 0);
            }
        }

        // 5. Texture Dispatch
        for (const [unit, tex] of Object.entries(textures)) {
            const slot = parseInt(unit);
            this.gl.activeTexture(this.gl.TEXTURE0 + slot);
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        }

        // 6. Execute
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        // 7. Standard Cleanup (Internal State)
        this.gl.bindVertexArray(null);
    }

    _renderQuantizedLineGfx(s, d, sourceTex, targetFBO = null) {
        let fx = null;
        if (this.effects && this.effects.effects) {
            const effectList = (Array.isArray(this.effects.effects)) 
                ? this.effects.effects 
                : (this.effects.effects instanceof Map) 
                    ? Array.from(this.effects.effects.values()) 
                    : [];
            fx = effectList.find(e => e.active && e.name.startsWith('Quantized'));
        }
        if (!fx || !fx.renderGrid) return false;

        const fxState = fx.getWebGLRenderState(s, d);
        const [gw, gh] = fxState.logicGridSize;
        if (gw <= 0 || gh <= 0) return false;

        // Ensure logic texture is initialized
        if (gw !== this.lastLogicGridWidth || gh !== this.lastLogicGridHeight) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, gw, gh, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
            this.lastLogicGridWidth = gw;
            this.lastLogicGridHeight = gh;
        }

        // 1. Prepare Data Logic (Occupancy & Source Characters)
        const now = fx.animFrame;
        const fadeIn = fx.getConfig('FadeInFrames') || 0;
        const fadeOut = fx.getConfig('FadeFrames') || 0;

        const occupancy = new Uint8Array(gw * gh * 4);
        for (let gy = 0; gy < gh; gy++) {
            const rowOff = gy * gw;
            for (let gx = 0; gx < gw; gx++) {
                const i = rowOff + gx;
                const tidx = i * 4;
                for (let L = 0; L < 4; L++) {
                    const grid = fx.layerGrids[L];
                    const rGrid = fx.removalGrids[L];
                    let alpha = 0;

                    if (grid && grid[i] !== -1) {
                        const birth = grid[i];
                        alpha = (fadeIn > 0 && now < birth + fadeIn) 
                            ? Math.floor(Math.max(0, Math.min(1, (now - birth) / fadeIn)) * 255) 
                            : 255;
                    } else if (rGrid && rGrid[i] !== -1) {
                        const death = rGrid[i];
                        alpha = (fadeOut > 0 && now < death + fadeOut)
                            ? Math.floor(Math.max(0, Math.min(1, 1.0 - (now - death) / fadeOut)) * 255)
                            : 0;
                    }
                    occupancy[tidx + L] = alpha;
                }
            }
        }
        
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
        this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, gw, gh, this.gl.RGBA, this.gl.UNSIGNED_BYTE, occupancy);

        // Upload Source Grid Texture (Characters)
        if (fx.gridCacheCanvas) {
            // Force upload if seed changed or if it's the first time
            if (fx.lastGridSeed !== this.lastSourceGridSeed || this.lastSourceGridSeed === -1) {
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceGridTexture);
                this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, fx.gridCacheCanvas);
                this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
                this.lastSourceGridSeed = fx.lastGridSeed;
            }
        }
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);

        const prog = this.lineProgram;
        if (!prog) return false;

        // 2. Compute Transform State
        const scale = s.resolution || 1.0;
        const gridPixW = fx.g.cols * d.cellWidth * scale;
        const gridPixH = fx.g.rows * d.cellHeight * scale;
        const screenStepX = d.cellWidth * s.stretchX * scale;
        const screenStepY = d.cellHeight * s.stretchY * scale;
        const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (this.fboWidth * 0.5);
        const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (this.fboHeight * 0.5);

        const sharedUniforms = {
            u_logicGridSize: fxState.logicGridSize,
            u_screenOrigin: [screenOriginX, screenOriginY],
            u_screenStep: [screenStepX, screenStepY],
            u_cellPitch: fxState.cellPitch,
            u_blockOffset: fxState.blockOffset,
            u_userBlockOffset: fxState.userBlockOffset,
            u_resolution: [this.fboWidth, this.fboHeight],
            u_offset: [s.quantizedLineGfxOffsetX * scale, s.quantizedLineGfxOffsetY * scale],
            u_layerOrder: fxState.layerOrder,
            u_showInterior: fxState.showInterior,
            u_logicGrid: 1,
            u_shadowMask: 3,
            u_sourceGrid: 4,
            u_intensity: fxState.intensity,
            u_thickness: fxState.thickness,
            u_glow: fxState.glow,
            u_tintOffset: fxState.tintOffset,
            u_sharpness: fxState.sharpness,
            u_glowFalloff: fxState.glowFalloff,
            u_roundness: fxState.roundness,
            u_maskSoftness: fxState.maskSoftness,
            u_brightness: fxState.brightness,
            u_saturation: fxState.saturation,
            u_additiveStrength: fxState.additiveStrength,
            u_color: fxState.color,
            u_fadeColor: fxState.fadeColor
        };

        const commonTextures = {
            1: this.logicGridTexture,
            3: this.shadowMaskTex,
            4: this.sourceGridTexture
        };

        // --- PASS 1: GENERATE & FADE ---
        // A) Clear NORMAL (Red) for this frame, while DECAYING existing FADE (Green)
        this._drawFullscreenPass(this.colorProgram, this.fboLinePersist, 
            { u_color: [0.0, fxState.persistence, 0.0, 1.0] },
            {},
            { src: this.gl.ZERO, dst: this.gl.SRC_COLOR }
        );

        // B) Add new lines (Mode 0)
        this._drawFullscreenPass(prog, this.fboLinePersist, { ...sharedUniforms, u_mode: 0 }, commonTextures, { src: this.gl.ONE, dst: this.gl.ONE });

        // --- PASS 2: COMPOSITE ---
        const compUniforms = { 
            ...sharedUniforms, 
            u_mode: 1,
            u_characterBuffer: 0,
            u_persistenceBuffer: 2,
            u_sourceGridOffset: [s.quantizedSourceGridOffsetX * scale, s.quantizedSourceGridOffsetY * scale],
            u_sampleOffset: fxState.sampleOffset,
            u_glassEnabled: s.quantizedGlassEnabled,
            u_glassBodyOpacity: s.quantizedGlassBodyOpacity,
            u_glassEdgeGlow: s.quantizedGlassEdgeGlow,
            u_glassRefraction: s.quantizedGlassRefraction,
            u_glassChromaticAberration: s.quantizedGlassChromaticAberration,
            u_glassFresnel: s.quantizedGlassFresnel,
            u_glassBevel: s.quantizedGlassBevel,
            u_glassOverlapRefraction: s.quantizedGlassOverlapRefraction,
            u_glassOverlapGlow: s.quantizedGlassOverlapGlow,
            u_glassOverlapOpacity: s.quantizedGlassOverlapOpacity,
            u_glassBloom: s.quantizedGlassBloom,
            u_glassLensCurvature: s.quantizedGlassLensCurvature,
            u_glassDarkness: s.quantizedGlassDarkness * fx.alpha
        };

        const compTextures = {
            ...commonTextures,
            0: sourceTex,
            2: this.texLinePersist
        };

        this._drawFullscreenPass(prog, targetFBO || this.fboA2, compUniforms, compTextures, null);

        // Final Cleanup
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        return true;
    }

            _runBlur(sourceTex, horizontal, strength, width, height, opacity = 1.0, extract = false) {
                if (!this.bloomProgram) return;
                this.gl.disable(this.gl.BLEND);
                this.gl.useProgram(this.bloomProgram);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
                this.gl.enableVertexAttribArray(0);
                this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        
                this.gl.activeTexture(this.gl.TEXTURE0);
                this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTex);
                this.gl.uniform1i(this._u(this.bloomProgram, 'u_image'), 0);
        
                // Broader Gaussian weights to actually push the glow out further
                const weights = [0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216];
                this.gl.uniform1fv(this._u(this.bloomProgram, 'u_weight'), weights);
        
                // Multiply the strength slider by a base factor to ensure it creates a wide radius
                // Base strength goes up to 10. Multiplying by 10.0 means we get up to 100 pixel offsets.
                this.gl.uniform1f(this._u(this.bloomProgram, 'u_spread'), strength * 10.0);
                this.gl.uniform1f(this._u(this.bloomProgram, 'u_opacity'), opacity);
                this.gl.uniform1i(this._u(this.bloomProgram, 'u_horizontal'), horizontal ? 1 : 0);
                this.gl.uniform1i(this._u(this.bloomProgram, 'u_extract'), extract ? 1 : 0);
        
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            }    render(frame) {
        if (!this.posBuffer || this.fboWidth === 0) return; 
        
        const { state: s, derived: d } = this.config;
        const grid = this.grid;
        const totalCells = grid.cols * grid.rows;
        const activeFonts = d.activeFonts;
        const gl = this.gl;

        // Determine if any quantized effect is truly active for shader logic
        let hasActiveQuantizedEffect = false;
        if (this.effects) {
             const effectList = (Array.isArray(this.effects.effects)) 
                ? this.effects.effects 
                : (this.effects.effects instanceof Map) 
                    ? Array.from(this.effects.effects.values()) 
                    : [];
             hasActiveQuantizedEffect = effectList.some(e => e.active && e.name.startsWith('Quantized'));
        }

        gl.enable(gl.BLEND);
        // gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // --- ATLAS UPDATE ---
        const font = activeFonts[0];
        if (!font) return;

        let atlas = this.glyphAtlases.get(font.name);
        if (!atlas) {
            atlas = new GlyphAtlas(this.config, font.name, font.chars);
            this.glyphAtlases.set(font.name, atlas);
        } else {
            atlas.fontName = font.name; 
        }

        if (this.needsAtlasUpdate || atlas.needsUpdate) atlas.update();

        if (!atlas.glTexture || atlas.needsFullUpdate) {
            // Full Upload (Initial or Resize)
            if (!atlas.glTexture) atlas.glTexture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
            
            // Re-apply parameters in case it's a new texture
            this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
            atlas.resetChanges();
        } else if (atlas.dirtyRects.length > 0) {
            // Incremental Update
            this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
            for (const rect of atlas.dirtyRects) {
                this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, rect.x, rect.y, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rect.data);
            }
            atlas.resetChanges();
        }
        this.needsAtlasUpdate = false;

        // --- MERGE & MAP ---
        if (!this.instanceData) return;

        const gChars = grid.chars;
        const gNext = grid.nextChars;
        const gSecChars = grid.secondaryChars;
        const gColors = grid.colors;
        const gAlphas = grid.alphas;
        const gDecays = grid.decays;
        const gMaxDecays = grid.maxDecays;
        const gGlows = grid.glows;
        const gMix = grid.mix;
        const gMode = grid.renderMode;
        
        const gEnvGlows = grid.envGlows;

        const ovActive = grid.overrideActive;
        const ovChars = grid.overrideChars;
        const ovColors = grid.overrideColors;
        const ovAlphas = grid.overrideAlphas;
        const ovGlows = grid.overrideGlows;
        const ovNextChars = grid.overrideNextChars;

        const effActive = grid.effectActive;
        const effChars = grid.effectChars;
        const effColors = grid.effectColors;
        const effAlphas = grid.effectAlphas;
        const effGlows = grid.effectGlows;

        const lookup = atlas.codeToId;
        
        const m16 = this.instanceDataU16;
        const m32 = this.instanceDataU32;
        const mF32 = this.instanceData;
        const mU8 = this.instanceDataU8;

        const gParams = grid.genericParams;

        const mapChar = (c) => {
            if (c <= 32) return 65535;
            let id = lookup[c];
            if (id === -1) {
                const rect = atlas.addChar(String.fromCharCode(c));
                id = rect ? rect.id : 65535;
            }
            return id;
        };
        
        for (let i = 0; i < totalCells; i++) {
            const baseOff = i * 10; // Float32 index (40 bytes / 4)
            const u16Off = i * 20;  // Uint16 index (40 bytes / 2)
            const u8Off = i * 40;   // Uint8 index

            // Initialize defaults
            mF32[baseOff + 2] = 0; // Alpha
            mF32[baseOff + 3] = 0; // Glow
            mF32[baseOff + 4] = 0; // Mix
            mU8[u8Off + 20] = 0;   // Decay
            mU8[u8Off + 21] = 0;   // ShapeID
            m16[u16Off + 11] = 0;  // MaxDecay (at byte 22)
            mF32[baseOff + 6] = 1.0; // GlimmerFlicker (at byte 24)
            mF32[baseOff + 7] = 0;   // GlimmerAlpha (at byte 28)
            mF32[baseOff + 8] = 0;   // Dissolve (at byte 32)
            
            // PRIORITY 1: PASSIVE EFFECT (Pulse, etc.)
            if (effActive && effActive[i]) {
                if (effActive[i] === 3) {
                    // SHADOW MODE reveal (Quantized Effects)
                    const sGrid = (fx && fx.shadowGrid) ? fx.shadowGrid : null;
                    const char = sGrid ? sGrid.chars[i] : gChars[i];
                    m16[u16Off + 0] = mapChar(char);
                    m32[baseOff + 1] = sGrid ? sGrid.colors[i] : gColors[i];
                    mF32[baseOff + 2] = sGrid ? sGrid.alphas[i] : 1.0;
                    mU8[u8Off + 20] = sGrid ? sGrid.decays[i] : gDecays[i];
                    m16[u16Off + 11] = sGrid ? (sGrid.maxDecays ? sGrid.maxDecays[i] : 0) : (gMaxDecays ? gMaxDecays[i] : 0);
                    mF32[baseOff + 3] = (sGrid ? sGrid.glows[i] : gGlows[i]) + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    mF32[baseOff + 4] = 0.0; // Standard render mode
                    m16[u16Off + 1] = 65535;
                } else if (effActive[i] === 2) {
                    // OVERLAY MODE
                    m16[u16Off + 0] = mapChar(gChars[i]);
                    m32[baseOff + 1] = effColors[i];
                    mF32[baseOff + 2] = gAlphas[i];
                    mU8[u8Off + 20] = gDecays[i];
                    mF32[baseOff + 3] = gGlows[i] + effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    m16[u16Off + 1] = mapChar(effChars[i]);
                    let eAlpha = effAlphas[i];
                    if (eAlpha > 0.99) eAlpha = 0.99;
                    mF32[baseOff + 4] = 4.0 + eAlpha; 
                } else if (effActive[i] === 4) {
                    // HIGH PRIORITY
                    m16[u16Off + 0] = mapChar(effChars[i]);
                    m32[baseOff + 1] = effColors[i];
                    mF32[baseOff + 2] = effAlphas[i];
                    mF32[baseOff + 3] = effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    mF32[baseOff + 4] = 10.0;
                    m16[u16Off + 1] = 65535;
                } else {
                    // STANDARD OVERRIDE
                    m16[u16Off + 0] = mapChar(effChars[i]);
                    m32[baseOff + 1] = effColors[i];
                    mF32[baseOff + 2] = effAlphas[i];
                    mF32[baseOff + 3] = effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    mF32[baseOff + 4] = 0.0;
                    m16[u16Off + 1] = 65535;
                }
            } else if (ovActive && ovActive[i]) {
                // PRIORITY 2: HARD OVERRIDE
                const ov = ovActive[i];
                if (ov === 5) {
                    m16[u16Off + 0] = mapChar(gChars[i]);
                    m32[baseOff + 1] = gColors[i]; 
                    mF32[baseOff + 2] = gAlphas[i] * ovAlphas[i];
                    mF32[baseOff + 3] = grid.overrideGlows[i]; 
                    
                    const nwRotMix = (grid.overrideMix[i] || 0.0);
                    m16[u16Off + 1] = (nwRotMix > 0.5) ? mapChar(ovNextChars[i]) : mapChar(ovChars[i]);
                    mF32[baseOff + 4] = 5.0 + nwRotMix; 
                    mU8[u8Off + 20] = gDecays[i];
                    m16[u16Off + 11] = gMaxDecays ? gMaxDecays[i] : 0;
                } else if (ov === 2) {
                    m16[u16Off + 0] = 65535;
                    m16[u16Off + 1] = 65535;
                    mF32[baseOff + 4] = 3.0;
                    m32[baseOff + 1] = ovColors[i];
                    mF32[baseOff + 2] = ovAlphas[i];
                    mF32[baseOff + 3] = (gEnvGlows ? gEnvGlows[i] : 0);
                } else {
                    m16[u16Off + 0] = mapChar(ovChars[i]);
                    const mode = gMode[i];
                    if (mode === 1) {
                        m16[u16Off + 1] = mapChar(gSecChars[i]);
                        mF32[baseOff + 4] = 2.0; 
                    } else {
                        m16[u16Off + 1] = 65535;
                        mF32[baseOff + 4] = 0.0;
                    }
                    m32[baseOff + 1] = ovColors[i];
                    mF32[baseOff + 2] = ovAlphas[i];
                    mF32[baseOff + 3] = ovGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    if (ov === 3) {
                         const mixVal = grid.overrideMix[i];
                         mF32[baseOff + 4] = mixVal;
                         if (mixVal > 0.0) m16[u16Off + 1] = mapChar(ovNextChars[i]);
                    } else if (gMix[i] > 0) {
                         mF32[baseOff + 4] = gMix[i];
                    }
                }
            } else {
                // PRIORITY 3: STANDARD SIMULATION
                const mix = gMix[i];
                let c = gChars[i];
                if (mix >= 30.0) {
                    const ec = effChars[i];
                    if (ec > 0) c = ec;
                }

                m16[u16Off + 0] = mapChar(c);
                m32[baseOff + 1] = gColors[i];
                mF32[baseOff + 2] = gAlphas[i];
                mU8[u8Off + 20] = gDecays[i];
                m16[u16Off + 11] = gMaxDecays ? gMaxDecays[i] : 0;
                mF32[baseOff + 3] = gGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                
                const mode = gMode[i];
                if (mode === 1) {
                    m16[u16Off + 1] = mapChar(gSecChars[i]);
                    mF32[baseOff + 4] = 2.0; 
                } else {
                    mF32[baseOff + 4] = mix;
                    m16[u16Off + 1] = (mix > 0.0) ? mapChar(gNext[i]) : 65535;
                }
            }

            // Copy Optimized Parameters
            if (gParams) {
                const gIdx = i * 4;
                // Solution 2: Isolate Scene from Memory
                // If the cell is using a high-level visual override (Mode 1 or 4),
                // we must suppress simulation-driven parameters like Dissolve and Flicker.
                const isOverridden = effActive && (effActive[i] === 1 || effActive[i] === 4);
                
                mF32[baseOff + 6] = isOverridden ? 1.0 : gParams[gIdx];     // GlimmerFlicker
                mU8[u8Off + 21]   = isOverridden ? 0 : gParams[gIdx + 1];   // ShapeID
                mF32[baseOff + 7] = isOverridden ? 0 : gParams[gIdx + 2];   // GlimmerAlpha
                mF32[baseOff + 8] = isOverridden ? 0 : gParams[gIdx + 3];   // Dissolve
            }
        }

        if (atlas.hasChanges) {
             this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
             this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
             atlas.resetChanges();
        }

        // --- UPLOAD ---
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceData);


        // --- SHADOW MASK PASS ---
        // Render Shadow Masks from Effects (Generic)
        if (this.fboWidth > 0 && this.fboHeight > 0) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.shadowMaskFbo);
            this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
            
            this.gl.colorMask(true, true, true, true); // Ensure writes are enabled
            this.gl.clearColor(0, 0, 0, 0); 
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            // Collect Masks from All Active Effects
            let masks = [];
            if (this.effects) {
                 // Support both Array and Map structures for EffectRegistry
                 const effectList = (Array.isArray(this.effects.effects)) 
                    ? this.effects.effects 
                    : (this.effects.effects instanceof Map) 
                        ? Array.from(this.effects.effects.values()) 
                        : (typeof this.effects.get === 'function' && typeof this.effects.getAll === 'function') // Handle registry with getters
                            ? this.effects.getAll() // Assuming a getAll exists, or fallback to iterating specific known effects if not
                            : []; 

                 // If getAll doesn't exist, we might need to rely on the Map iterator if effects.effects is private.
                 // However, let's assume standard iteration is possible.
                 // Fallback: If effects.effects is a Map, use values().
                 const iterable = (this.effects.effects instanceof Map) ? this.effects.effects.values() : effectList;

                 for (const effect of iterable) {
                     if (effect.active) {
                         // GPU-Accelerated Shadow for Quantized Effects
                         if (effect instanceof QuantizedBaseEffect) {
                             this._renderQuantizedShadows(effect);
                             continue;
                         }
                         
                         // Check for CrashEffect legacy support or new Generic Interface
                         if (effect.name === 'CrashSequence' && effect.blackSheets) {
                             // Legacy/Specific Support for CrashEffect
                             for (const s of effect.blackSheets) {
                                 masks.push({
                                     x: s.posX, y: s.posY, w: s.w, h: s.h,
                                     alpha: s.currentAlpha * s.maxAlpha,
                                     blur: (s.blur !== undefined) ? s.blur : 0.0 // Default to 0 for Crash
                                 });
                             }
                         }
                         // Future Generic Interface: getMasks()
                         if (typeof effect.getMasks === 'function') {
                             const effectMasks = effect.getMasks();
                             if (Array.isArray(effectMasks)) {
                                 masks.push(...effectMasks);
                             }
                         }
                     }
                 }
            }
            
            if (masks.length > 0 && this.shadowInstanceBuffer) {
                this.gl.useProgram(this.shadowProgram);
                
                // Upload Instance Data (x, y, w, h, alpha, blur) - 6 floats
                const count = masks.length;
                if (!this.shadowData || this.shadowData.length < count * 6) {
                    this.shadowData = new Float32Array(count * 6 * 2); 
                }
                
                const data = this.shadowData;
                for (let i=0; i<count; i++) {
                    const m = masks[i];
                    data[i*6+0] = m.x;
                    data[i*6+1] = m.y;
                    data[i*6+2] = m.w;
                    data[i*6+3] = m.h;
                    data[i*6+4] = m.alpha;
                    data[i*6+5] = (m.blur !== undefined) ? m.blur : 0.2; // Default blur if missing
                }
                
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowInstanceBuffer);
                
                // 6 floats * 4 bytes = 24 bytes per instance
                const stride = 24;
                
                if (count > this.shadowInstanceCapacity) {
                     this.shadowInstanceCapacity = Math.max(count, this.shadowInstanceCapacity * 2);
                     this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowInstanceCapacity * stride, this.gl.DYNAMIC_DRAW);
                     this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, data.subarray(0, count*6));
                } else {
                     this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, data.subarray(0, count*6));
                }
                
                // Setup Attributes
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
                this.gl.enableVertexAttribArray(0);
                this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
                
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowInstanceBuffer);
                
                // a_rect (vec4)
                this.gl.enableVertexAttribArray(1);
                this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, stride, 0);
                this.gl.vertexAttribDivisor(1, 1);
                
                // a_alpha (float)
                this.gl.enableVertexAttribArray(2);
                this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, 16);
                this.gl.vertexAttribDivisor(2, 1);
                
                // a_blur (float)
                this.gl.enableVertexAttribArray(3);
                this.gl.vertexAttribPointer(3, 1, this.gl.FLOAT, false, stride, 20);
                this.gl.vertexAttribDivisor(3, 1);
                
                this.gl.uniform2f(this._u(this.shadowProgram, 'u_gridSize'), grid.cols, grid.rows);
                
                this.gl.enable(this.gl.BLEND);
                this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                
                this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, count);
                
                this.gl.vertexAttribDivisor(1, 0);
                this.gl.vertexAttribDivisor(2, 0);
                this.gl.vertexAttribDivisor(3, 0);
                this.gl.disableVertexAttribArray(1);
                this.gl.disableVertexAttribArray(2);
                this.gl.disableVertexAttribArray(3);
            }

            // --- REVEAL PUNCH-OUT PASS (Subtract Alpha) ---
            // Only necessary if we have drawn shadows
            if (typeof masks !== 'undefined' && masks && masks.length > 0 && this.effects) {
                let crash = null;
                // Locate CrashEffect
                if (Array.isArray(this.effects.effects)) {
                     crash = this.effects.effects.find(e => e.name === 'CrashSequence');
                } else if (this.effects.effects instanceof Map) {
                     crash = this.effects.effects.get('CrashSequence');
                } else if (typeof this.effects.get === 'function') {
                     crash = this.effects.get('CrashSequence');
                }

                if (crash && crash.active && typeof crash.getReveals === 'function') {
                    const reveals = crash.getReveals();
                    if (reveals.length > 0) {
                        // Use Color Program to draw fading triangles
                        this.gl.useProgram(this.colorProgram);
                        
                        // Punch-out blend mode: DestAlpha = DestAlpha * (1 - SrcAlpha)
                        // Src = (0,0,0, RevealAlpha)
                        this.gl.blendFunc(this.gl.ZERO, this.gl.ONE_MINUS_SRC_ALPHA);
                        
                        if (!this.revealBuffer) {
                            this.revealBuffer = this.gl.createBuffer();
                        }
                        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.revealBuffer);
                        
                        // Enable Position Attribute (Location 0 in colorProgram)
                        this.gl.enableVertexAttribArray(0);
                        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    
                        const cols = grid.cols;
                        const rows = grid.rows;
                        
                        // Buffer for batching vertices
                        // Estimate size: 50 reveals * 100 segments * 6 verts * 2 coords = ~60k floats
                        // Just allocate dynamically per frame or reuse a large buffer.
                        // For simplicity/safety in this refactor, let's process per reveal and use bufferData.
                        
                        for (const r of reveals) {
                            const alpha = r.alpha;
                            if (alpha <= 0.01) continue;
    
                            this.gl.uniform4f(this._u(this.colorProgram, 'u_color'), 0, 0, 0, alpha);
                            
                            let vertices = null;

                            if (r.type === 'rects' && r.rects) {
                                const count = r.rects.length;
                                if (count > 0) {
                                    const data = new Float32Array(count * 6 * 2);
                                    let ptr = 0;
                                    for (const rect of r.rects) {
                                        const x1 = (rect.x / cols) * 2.0 - 1.0;
                                        const y1 = (rect.y / rows) * 2.0 - 1.0; 
                                        const x2 = ((rect.x + rect.w) / cols) * 2.0 - 1.0;
                                        const y2 = ((rect.y + rect.h) / rows) * 2.0 - 1.0;
                                        
                                        // Triangle 1
                                        data[ptr++] = x1; data[ptr++] = y1;
                                        data[ptr++] = x2; data[ptr++] = y1;
                                        data[ptr++] = x1; data[ptr++] = y2;
                                        
                                        // Triangle 2
                                        data[ptr++] = x2; data[ptr++] = y1;
                                        data[ptr++] = x2; data[ptr++] = y2;
                                        data[ptr++] = x1; data[ptr++] = y2;
                                    }
                                    vertices = data;
                                }
                            }
                            else if (r.type === 'strip' && r.trunk && r.branch) {
                                // Draw Triangle Strip between Trunk and Branch
                                const len = Math.min(r.trunk.length, r.branch.length);
                                if (len < 2) continue;
                                
                                // 2 triangles per segment * (len-1) segments * 3 verts * 2 coords
                                const data = new Float32Array((len - 1) * 6 * 2);
                                let ptr = 0;
                                
                                for (let i = 0; i < len - 1; i++) {
                                    // Points in Grid Space
                                    const t1 = r.trunk[i];
                                    const t2 = r.trunk[i+1];
                                    const b1 = r.branch[i];
                                    const b2 = r.branch[i+1];
                                    
                                    // Convert to Clip Space
                                    // X: 0..cols -> -1..1
                                    // Y: 0..rows -> -1..1
                                    const ax = (t1.x / cols) * 2.0 - 1.0; const ay = (t1.y / rows) * 2.0 - 1.0;
                                    const bx = (t2.x / cols) * 2.0 - 1.0; const by = (t2.y / rows) * 2.0 - 1.0;
                                    const cx = (b1.x / cols) * 2.0 - 1.0; const cy = (b1.y / rows) * 2.0 - 1.0;
                                    const dx = (b2.x / cols) * 2.0 - 1.0; const dy = (b2.y / rows) * 2.0 - 1.0;
                                    
                                    // Triangle 1: t1, t2, b1
                                    data[ptr++] = ax; data[ptr++] = ay;
                                    data[ptr++] = bx; data[ptr++] = by;
                                    data[ptr++] = cx; data[ptr++] = cy;
                                    
                                    // Triangle 2: t2, b2, b1
                                    data[ptr++] = bx; data[ptr++] = by;
                                    data[ptr++] = dx; data[ptr++] = dy;
                                    data[ptr++] = cx; data[ptr++] = cy;
                                }
                                vertices = data;
                            } 
                            // Legacy/Fallback Triangle support (if needed, though we moved to strip)
                            else if (r.p1 && r.p2 && r.p3) {
                                const x1 = (r.p1.x / cols) * 2.0 - 1.0; const ay = (r.p1.y / rows) * 2.0 - 1.0;
                                const x2 = (r.p2.x / cols) * 2.0 - 1.0; const by = (r.p2.y / rows) * 2.0 - 1.0;
                                const x3 = (r.p3.x / cols) * 2.0 - 1.0; const cy = (r.p3.y / rows) * 2.0 - 1.0;
                                vertices = new Float32Array([x1, ay, x2, by, x3, cy]);
                            }

                            if (vertices) {
                                this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);
                                this.gl.drawArrays(this.gl.TRIANGLES, 0, vertices.length / 2);
                            }
                        }
                    }
                }
            }
        }

        // --- DRAW ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA);
        this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
        
        // 1. Trail Fade (Draw Black Quad)
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        if (this.colorProgram) {
            if (s.layerEnableBackground !== false) {
                this.gl.useProgram(this.colorProgram);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
                this.gl.enableVertexAttribArray(0); 
                this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
                
                const br = d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
                const bg = d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
                const bb = d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
                
                this.gl.uniform4f(this._u(this.colorProgram, 'u_color'), br, bg, bb, s.clearAlpha);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            }
        }

        let finalMainTex = this.texA;

        // 2. Draw Cells
        if (s.layerEnablePrimaryCode !== false && this.program2D) {
            const activeProgram = this.program2D;
            this.gl.useProgram(activeProgram);
            
            this.gl.uniform2f(this._u(activeProgram, 'u_resolution'), this.w, this.h);
            this.gl.uniform2f(this._u(activeProgram, 'u_atlasSize'), atlas.canvas.width, atlas.canvas.height);
            
            const gridPixW = grid.cols * d.cellWidth;
            const gridPixH = grid.rows * d.cellHeight;
            this.gl.uniform2f(this._u(activeProgram, 'u_gridSize'), gridPixW, gridPixH);

            this.gl.uniform1f(this._u(activeProgram, 'u_cellSize'), atlas.cellSize);
            this.gl.uniform1f(this._u(activeProgram, 'u_cols'), atlas._lastCols);
            this.gl.uniform1f(this._u(activeProgram, 'u_decayDur'), s.decayFadeDurationFrames);
            this.gl.uniform2f(this._u(activeProgram, 'u_stretch'), s.stretchX, s.stretchY);
            this.gl.uniform1f(this._u(activeProgram, 'u_mirror'), s.mirrorEnabled ? -1.0 : 1.0);
            
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
            this.gl.uniform1i(this._u(activeProgram, 'u_texture'), 0);
            
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.shadowMaskTex);
            this.gl.uniform1i(this._u(activeProgram, 'u_shadowMask'), 1);
            
            this.gl.activeTexture(this.gl.TEXTURE2);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.glimmerTexture);
            this.gl.uniform1i(this._u(activeProgram, 'u_glimmerNoise'), 2);
            
            this.gl.uniform1f(this._u(activeProgram, 'u_time'), performance.now() / 1000.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_dissolveEnabled'), s.dissolveEnabled ? 1.0 : 0.0);
            this.gl.uniform1i(this._u(activeProgram, 'u_glassEnabled'), (s.quantizedGlassEnabled && hasActiveQuantizedEffect) ? 1 : 0);
            this.gl.uniform1f(this._u(activeProgram, 'u_glimmerSpeed'), s.upwardTracerGlimmerSpeed || 1.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_glimmerSize'), s.upwardTracerGlimmerSize || 3.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_glimmerFill'), s.upwardTracerGlimmerFill || 3.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_glimmerIntensity'), s.upwardTracerGlimmerGlow || 10.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_glimmerFlicker'), s.upwardTracerGlimmerFlicker !== undefined ? s.upwardTracerGlimmerFlicker : 0.5);
            this.gl.uniform1f(this._u(activeProgram, 'u_brightness'), s.brightness !== undefined ? s.brightness : 1.0);

            const cellScaleX = (d.cellWidth / atlas.cellSize);
            const cellScaleY = (d.cellHeight / atlas.cellSize);
            this.gl.uniform2f(this._u(activeProgram, 'u_cellScale'), cellScaleX, cellScaleY);

            const percent = s.dissolveScalePercent !== undefined ? s.dissolveScalePercent : -20;
            const dissolveScale = s.dissolveEnabled ? (1.0 + (percent / 100.0)) : 1.0;
            this.gl.uniform1f(this._u(activeProgram, 'u_dissolveScale'), dissolveScale);
            this.gl.uniform1f(this._u(activeProgram, 'u_dissolveSize'), s.dissolveMinSize || 1.0);
            
            this.gl.uniform1f(this._u(activeProgram, 'u_deteriorationEnabled'), s.deteriorationEnabled ? 1.0 : 0.0);
            this.gl.uniform1f(this._u(activeProgram, 'u_deteriorationStrength'), s.deteriorationStrength);
            
            const ovRgb = Utils.hexToRgb(s.overlapColor || "#FFD700");
            this.gl.uniform4f(this._u(activeProgram, 'u_overlapColor'), ovRgb.r/255.0, ovRgb.g/255.0, ovRgb.b/255.0, 1.0);

            this.gl.bindVertexArray(this.vao);
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, this.instanceCapacity);
            this.gl.bindVertexArray(null);
        }

        // --- RENDER PIPELINE EXECUTION ---
        let currentTex = this.texA;
        
        if (this.pipeline) {
            for (const pass of this.pipeline) {
                if (pass.enabled) {
                    const result = pass.execute(this, currentTex, s, d, performance.now() / 1000);
                    if (result !== null) {
                        currentTex = result;
                    }
                }
            }
        } else {
            // Fallback if pipeline fails to initialize
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this._drawFullscreenTexture(currentTex, 1.0, 0);
        }

        // Cleanup: Unbind all textures to prevent feedback in next frame
        for (let i = 0; i < 8; i++) {
            this.gl.activeTexture(this.gl.TEXTURE0 + i);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }
    }
}

