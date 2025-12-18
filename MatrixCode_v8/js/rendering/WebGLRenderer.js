class WebGLRenderer {
    constructor(canvasId, grid, config, effects) {
        this.cvs = document.getElementById(canvasId);
        
        // Attempt WebGL2, fallback to WebGL1
        this.gl = this.cvs.getContext('webgl2', { alpha: false, preserveDrawingBuffer: false });
        this.isWebGL2 = !!this.gl;
        
        if (!this.gl) {
            this.gl = this.cvs.getContext('webgl', { alpha: false, preserveDrawingBuffer: false });
        }

        if (!this.gl) {
            console.error("WebGLRenderer: Hardware acceleration not supported.");
            throw new Error("WebGL not supported");
        }
        
        // Check for Float Texture Support (for HDR Bloom)
        this.canUseFloat = false;
        if (this.isWebGL2) {
            const ext = this.gl.getExtension('EXT_color_buffer_float');
            if (ext) this.canUseFloat = true;
        } else {
            const ext = this.gl.getExtension('OES_texture_float');
            const extLin = this.gl.getExtension('OES_texture_float_linear');
            if (ext && extLin) this.canUseFloat = true;
        }

        // WebGL1 Extension for Instancing
        if (!this.isWebGL2) {
            const ext = this.gl.getExtension('ANGLE_instanced_arrays');
            if (!ext) {
                console.error("WebGLRenderer: ANGLE_instanced_arrays not supported.");
                throw new Error("WebGL Instancing not supported");
            }
            this.gl.vertexAttribDivisor = ext.vertexAttribDivisorANGLE.bind(ext);
            this.gl.drawArraysInstanced = ext.drawArraysInstancedANGLE.bind(ext);
            
            const vaoExt = this.gl.getExtension('OES_vertex_array_object');
            if(vaoExt) {
                this.gl.createVertexArray = vaoExt.createVertexArrayOES.bind(vaoExt);
                this.gl.bindVertexArray = vaoExt.bindVertexArrayOES.bind(vaoExt);
                this.gl.deleteVertexArray = vaoExt.deleteVertexArrayOES.bind(vaoExt);
            } else {
                 this.gl.createVertexArray = () => null;
                 this.gl.bindVertexArray = () => {}; 
                 this.gl.deleteVertexArray = () => {};
            }
        }

        this.grid = grid;
        this.config = config;
        this.effects = effects;
        this.glyphAtlases = new Map();

        // --- Core WebGL State ---
        this.program = null;       
        this.bloomProgram = null;  
        this.colorProgram = null;  
        this.atlasTexture = null;  
        this.vao = null;           
        
        // --- Buffers ---
        this.instanceCapacity = 0; 
        this.instanceData = null; 
        this.instanceBuffer = null;

        // --- Framebuffers for Bloom ---
        this.fboA = null; 
        this.fboB = null; 
        this.fboC = null; // New Scratch FBO
        this.texA = null; 
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

        this._initShaders();
        this._initBuffers();
        this._initBloomBuffers();
        console.log("Rendering Engine: WebGL (v8 CellGrid Optimized Fixed)");

        if (typeof PostProcessor !== 'undefined') {
            this.postProcessor = new PostProcessor(config);
            this.postProcessor.canvas.id = 'shaderCanvas';
            this.postProcessor.canvas.style.position = 'absolute';
            this.postProcessor.canvas.style.top = '0';
            this.postProcessor.canvas.style.left = '0';
            this.postProcessor.canvas.style.zIndex = '2'; 
            this.postProcessor.canvas.style.display = 'none'; 
            
            if (this.cvs.parentNode) {
                this.cvs.parentNode.insertBefore(this.postProcessor.canvas, this.cvs.nextSibling);
            }
            this.lastShaderSource = null;
        }
    }

    dispose() {
        if (this._mouseMoveHandler) window.removeEventListener('mousemove', this._mouseMoveHandler);
        if (this._touchMoveHandler) window.removeEventListener('touchmove', this._touchMoveHandler);
        if (this.postProcessor && this.postProcessor.canvas && this.postProcessor.canvas.parentNode) {
            this.postProcessor.canvas.parentNode.removeChild(this.postProcessor.canvas);
        }
        if (this.gl) {
            if (this.program) this.gl.deleteProgram(this.program);
            if (this.bloomProgram) this.gl.deleteProgram(this.bloomProgram);
            if (this.colorProgram) this.gl.deleteProgram(this.colorProgram);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        }
    }

    _setupMouseTracking() {
        this._mouseMoveHandler = (e) => {
            const rect = this.cvs.getBoundingClientRect();
            this.mouseX = (e.clientX - rect.left) / rect.width;
            this.mouseY = 1.0 - ((e.clientY - rect.top) / rect.height);
        };
        this._touchMoveHandler = (e) => {
            if (e.touches.length > 0) this._mouseMoveHandler(e.touches[0]);
        };
        window.addEventListener('mousemove', this._mouseMoveHandler);
        window.addEventListener('touchmove', this._touchMoveHandler, { passive: true });
    }

    _createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    _createProgram(vsSource, fsSource) {
        const vs = this._createShader(this.gl.VERTEX_SHADER, vsSource);
        const fs = this._createShader(this.gl.FRAGMENT_SHADER, fsSource);
        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, vs);
        this.gl.attachShader(prog, fs);
        this.gl.linkProgram(prog);
        if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    _initShaders() {
        const version = this.isWebGL2 ? '#version 300 es' : '';
        const attribute = this.isWebGL2 ? 'in' : 'attribute';
        const varying = this.isWebGL2 ? 'out' : 'varying';
        const varyingIn = this.isWebGL2 ? 'in' : 'varying';
        const texture2D = this.isWebGL2 ? 'texture' : 'texture2D';
        const outColor = this.isWebGL2 ? 'out vec4 fragColor;' : '';
        const setFragColor = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';

        // Optimized Vertex Shader
        const matrixVS = `${version}
            precision mediump float;
            layout(location=0) ${attribute} vec2 a_quad;      // 0..1
            layout(location=1) ${attribute} vec2 a_pos;       // Cell Center X,Y
            layout(location=2) ${attribute} float a_charIdx;  // Char Index
            layout(location=3) ${attribute} vec4 a_color;     // Normalized Color
            layout(location=4) ${attribute} float a_alpha;    // Alpha
            layout(location=5) ${attribute} float a_decay;    // Decay State
            layout(location=6) ${attribute} float a_glow;     // Glow Amount
            layout(location=7) ${attribute} float a_mix;      // Mix Factor
            layout(location=8) ${attribute} float a_nextChar; // Next Char Index

            uniform vec2 u_resolution;
            uniform vec2 u_atlasSize;
            uniform float u_cellSize;
            uniform float u_cols;
            uniform float u_decayDur;
            uniform vec2 u_stretch;
            uniform float u_mirror;
            
            uniform float u_dissolveEnabled;
            uniform float u_dissolveScale;

            ${varying} vec2 v_uv;
            ${varying} vec2 v_uv2;
            ${varying} vec4 v_color;
            ${varying} float v_mix;
            ${varying} float v_glow;
            ${varying} float v_prog;

            void main() {
                // Decay Scale Logic
                float scale = 1.0;
                v_prog = 0.0;
                if (a_decay >= 2.0) {
                    v_prog = (a_decay - 2.0) / u_decayDur;
                    if (u_dissolveEnabled > 0.5) {
                        scale = mix(1.0, u_dissolveScale, v_prog);
                    } else {
                        scale = 1.0;
                    }
                }
                
                // Position Calculation
                vec2 centerPos = (a_quad - 0.5) * u_cellSize * scale;
                vec2 worldPos = a_pos + centerPos;
                
                // Mirror/Stretch
                worldPos.x = (worldPos.x - (u_resolution.x * 0.5)) * u_stretch.x + (u_resolution.x * 0.5);
                worldPos.y = (worldPos.y - (u_resolution.y * 0.5)) * u_stretch.y + (u_resolution.y * 0.5);
                if (u_mirror < 0.0) worldPos.x = u_resolution.x - worldPos.x;

                // Clip Space
                vec2 clip = (worldPos / u_resolution) * 2.0 - 1.0;
                clip.y = -clip.y;
                gl_Position = vec4(clip, 0.0, 1.0);

                // Pass Attributes
                v_color = a_color;
                v_color.a *= a_alpha;
                v_mix = a_mix;
                v_glow = a_glow;

                // UV 1
                float cIdx = a_charIdx;
                float row = floor(cIdx / u_cols);
                float col = mod(cIdx, u_cols);
                vec2 uvBase = vec2(col, row) * u_cellSize;
                v_uv = (uvBase + (a_quad * u_cellSize)) / u_atlasSize;

                // UV 2 (Rotator Target)
                if (a_mix > 0.0) {
                    float cIdx2 = a_nextChar;
                    float row2 = floor(cIdx2 / u_cols);
                    float col2 = mod(cIdx2, u_cols);
                    vec2 uvBase2 = vec2(col2, row2) * u_cellSize;
                    v_uv2 = (uvBase2 + (a_quad * u_cellSize)) / u_atlasSize;
                } else {
                    v_uv2 = v_uv;
                }
            }
        `;

        // Optimized Fragment Shader
        const matrixFS = `${version}
            precision mediump float;
            ${varyingIn} vec2 v_uv;
            ${varyingIn} vec2 v_uv2;
            ${varyingIn} vec4 v_color;
            ${varyingIn} float v_mix;
            ${varyingIn} float v_glow;
            ${varyingIn} float v_prog;
            
            uniform sampler2D u_texture;
            uniform float u_time;
            uniform float u_dissolveEnabled; // 0.0 or 1.0
            uniform float u_dissolveScale;
            uniform float u_dissolveSize;
            
            uniform float u_deteriorationEnabled;
            uniform float u_deteriorationStrength;
            uniform vec2 u_atlasSize;
            uniform vec4 u_overlapColor;
            
            ${outColor}

            // Pseudo-random function
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            // Helper to apply all visual degradations (Dissolve + Ghosting) identically
            float getProcessedAlpha(vec2 uv) {
                float a = ${texture2D}(u_texture, uv).a;
                float ghost1 = 0.0;
                float ghost2 = 0.0;

                // Trail Ghosting (Vertical Blur) - Sample first
                if (u_deteriorationEnabled > 0.5 && v_prog > 0.0) {
                    float blurDist = (u_deteriorationStrength * v_prog) / u_atlasSize.y;
                    ghost1 = ${texture2D}(u_texture, uv + vec2(0.0, blurDist)).a;
                    ghost2 = ${texture2D}(u_texture, uv - vec2(0.0, blurDist)).a;
                }

                // Alpha Erosion Dissolve (Burn away from edges)
                // Apply to MAIN char AND GHOSTS
                if (u_dissolveEnabled > 0.5 && v_prog > 0.0) {
                    float erosion = v_prog * 1.2; 
                    a = min(a, smoothstep(erosion, erosion + 0.1, a));
                    if (ghost1 > 0.0) ghost1 = min(ghost1, smoothstep(erosion, erosion + 0.1, ghost1));
                    if (ghost2 > 0.0) ghost2 = min(ghost2, smoothstep(erosion, erosion + 0.1, ghost2));
                }

                // Combine
                if (u_deteriorationEnabled > 0.5 && v_prog > 0.0) {
                    a = max(a, max(ghost1, ghost2) * 0.5);
                }
                
                return a;
            }

            void main() {
                // Sample Texture with Effects
                float tex1 = getProcessedAlpha(v_uv);
                vec4 baseColor = v_color;
                
                float finalAlpha = tex1;

                if (v_mix >= 4.0) {
                    // Overlay Mode (White on top of Primary)
                    float ovAlpha = v_mix - 4.0;
                    float tex2 = getProcessedAlpha(v_uv2);
                    float effA = tex2 * ovAlpha;
                    
                    baseColor.rgb = mix(baseColor.rgb, vec3(1.0), effA);
                    finalAlpha = max(tex1, effA);
                } else if (v_mix >= 3.0) {
                    // Solid Mode
                    finalAlpha = 1.0;
                } else if (v_mix >= 2.0) {
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
                } else if (v_mix > 0.0) {
                    // Rotator Mix
                    // For rotator, we might NOT want dissolve/ghosting on the incoming char yet?
                    // Usually rotator happens on active cells (decay=0).
                    // If decay=0, getProcessedAlpha just returns raw alpha. So it's safe.
                    float tex2 = getProcessedAlpha(v_uv2);
                    finalAlpha = mix(tex1, tex2, v_mix);
                }

                if (finalAlpha < 0.01) discard;

                vec4 col = baseColor;
                // Boost brightness for glow (Bloom trigger)
                // Multiply by alpha to ensure it fades out with the character
                if (v_glow > 0.0) {
                    col.rgb += (v_glow * 0.3 * col.a);
                }

                ${setFragColor} = vec4(col.rgb, col.a * finalAlpha);
            }
        `;
        
        // Fallback for WebGL1
        let finalVS = matrixVS;
        let finalFS = matrixFS;
        
        if (!this.isWebGL2) {
             finalVS = `
                precision mediump float;
                attribute vec2 a_quad; attribute vec2 a_pos; attribute float a_charIdx; attribute vec4 a_color;
                attribute float a_alpha; attribute float a_decay; attribute float a_glow; attribute float a_mix; attribute float a_nextChar;
                uniform vec2 u_resolution; uniform vec2 u_atlasSize; uniform float u_cellSize; uniform float u_cols; uniform float u_decayDur;
                uniform vec2 u_stretch; uniform float u_mirror;
                varying vec2 v_uv; varying vec2 v_uv2; varying vec4 v_color; varying float v_mix; varying float v_glow; varying float v_prog;
                void main() {
                    float scale = 1.0;
                    v_prog = 0.0;
                    if (a_decay >= 2.0) { v_prog = (a_decay - 2.0) / u_decayDur; scale = max(0.1, 1.0 - v_prog); }
                    vec2 centerPos = (a_quad - 0.5) * u_cellSize * scale;
                    vec2 worldPos = a_pos + centerPos;
                    worldPos.x = (worldPos.x - (u_resolution.x * 0.5)) * u_stretch.x + (u_resolution.x * 0.5);
                    worldPos.y = (worldPos.y - (u_resolution.y * 0.5)) * u_stretch.y + (u_resolution.y * 0.5);
                    if (u_mirror < 0.0) worldPos.x = u_resolution.x - worldPos.x;
                    vec2 clip = (worldPos / u_resolution) * 2.0 - 1.0; clip.y = -clip.y;
                    gl_Position = vec4(clip, 0.0, 1.0);
                    v_color = a_color; v_color.a *= a_alpha; v_mix = a_mix; v_glow = a_glow;
                    float cIdx = a_charIdx; float row = floor(cIdx / u_cols); float col = mod(cIdx, u_cols);
                    vec2 uvBase = vec2(col, row) * u_cellSize; v_uv = (uvBase + (a_quad * u_cellSize)) / u_atlasSize;
                    if (a_mix > 0.0) { float cIdx2 = a_nextChar; float row2 = floor(cIdx2 / u_cols); float col2 = mod(cIdx2, u_cols); vec2 uvBase2 = vec2(col2, row2) * u_cellSize; v_uv2 = (uvBase2 + (a_quad * u_cellSize)) / u_atlasSize; } else { v_uv2 = v_uv; }
                }
             `;
             finalFS = `
                precision mediump float;
                varying vec2 v_uv; varying vec2 v_uv2; varying vec4 v_color; varying float v_mix; varying float v_glow; varying float v_prog;
                uniform sampler2D u_texture; uniform float u_time; uniform float u_dissolveEnabled; uniform float u_dissolveSize;
                float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
                void main() {
                    float tex1 = texture2D(u_texture, v_uv).a;
                    float finalAlpha = tex1;
                    if (v_mix >= 3.0) { finalAlpha = 1.0; }
                    else if (v_mix >= 2.0) { float tex2 = texture2D(u_texture, v_uv2).a; finalAlpha = max(tex1, tex2); }
                    else if (v_mix > 0.0) { float tex2 = texture2D(u_texture, v_uv2).a; finalAlpha = mix(tex1, tex2, v_mix); }
                    if (u_dissolveEnabled > 0.5 && v_prog > 0.0) {
                        vec2 noiseCoord = floor(gl_FragCoord.xy / max(1.0, u_dissolveSize));
                        float noise = random(noiseCoord);
                        if (noise < v_prog) discard;
                    }
                    if (finalAlpha < 0.01) discard;
                    vec4 col = v_color;
                    if (v_glow > 0.0) { col.rgb += (v_glow * 0.3); }
                    gl_FragColor = vec4(col.rgb, col.a * finalAlpha);
                }
             `;
        }

        this.program = this._createProgram(finalVS, finalFS);

        // Keep existing Bloom/Color programs
        const bloomVS = this.isWebGL2 ? `#version 300 es\nlayout(location=0) in vec2 a_position; out vec2 v_uv; void main(){ v_uv=a_position*0.5+0.5; gl_Position=vec4(a_position, 0.0, 1.0); }` : `attribute vec2 a_position; varying vec2 v_uv; void main(){ v_uv=a_position*0.5+0.5; gl_Position=vec4(a_position, 0.0, 1.0); }`;
        const bloomFS = this.isWebGL2 ? `#version 300 es\nprecision mediump float; in vec2 v_uv; uniform sampler2D u_image; uniform bool u_horizontal; uniform float u_weight[5]; uniform float u_spread; uniform float u_opacity; out vec4 fragColor; void main(){ vec2 tex_offset=(1.0/vec2(textureSize(u_image, 0)))*u_spread; vec3 result=texture(u_image, v_uv).rgb*u_weight[0]; if(u_horizontal){ for(int i=1; i<5; ++i){ result+=texture(u_image, v_uv+vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; result+=texture(u_image, v_uv-vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; } }else{ for(int i=1; i<5; ++i){ result+=texture(u_image, v_uv+vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; result+=texture(u_image, v_uv-vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; } } fragColor=vec4(result*u_opacity, 1.0); }` : `precision mediump float; varying vec2 v_uv; uniform sampler2D u_image; uniform bool u_horizontal; uniform float u_weight[5]; uniform float u_spread; uniform float u_opacity; uniform vec2 u_texSize; void main(){ vec2 tex_offset=(1.0/u_texSize)*u_spread; vec3 result=texture2D(u_image, v_uv).rgb*u_weight[0]; if(u_horizontal){ for(int i=1; i<5; ++i){ result+=texture2D(u_image, v_uv+vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; result+=texture2D(u_image, v_uv-vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; } }else{ for(int i=1; i<5; ++i){ result+=texture2D(u_image, v_uv+vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; result+=texture2D(u_image, v_uv-vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; } } gl_FragColor=vec4(result*u_opacity, 1.0); }`;
        this.bloomProgram = this._createProgram(bloomVS, bloomFS);

        const colorVS = this.isWebGL2 ? `#version 300 es\nlayout(location=0) in vec2 a_position; void main(){ gl_Position=vec4(a_position, 0.0, 1.0); }` : `attribute vec2 a_position; void main(){ gl_Position=vec4(a_position, 0.0, 1.0); }`;
        const colorFS = this.isWebGL2 ? `#version 300 es\nprecision mediump float; uniform vec4 u_color; out vec4 fragColor; void main(){ fragColor=u_color; }` : `precision mediump float; uniform vec4 u_color; void main(){ gl_FragColor=u_color; }`;
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

        // Instance buffers will be created in resize()
        this.posBuffer = null;
        this.charBuffer = null;
        this.colorBuffer = null;
        this.alphaBuffer = null;
        this.decayBuffer = null;
        this.glowBuffer = null;
        this.mixBuffer = null;
        this.nextCharBuffer = null;
        
        // Mapped Arrays (CPU side)
        this.mappedChars = null;
        this.mappedNextChars = null;
    }

    _initBloomBuffers() {
        this.fboA = this.gl.createFramebuffer(); this.texA = this.gl.createTexture();
        this.fboB = this.gl.createFramebuffer(); this.texB = this.gl.createTexture();
        this.fboC = this.gl.createFramebuffer(); this.texC = this.gl.createTexture();
    }

    _configureFramebuffer(fbo, tex, width, height) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        
        let internalFormat = this.gl.RGBA;
        let type = this.gl.UNSIGNED_BYTE;
        
        if (this.canUseFloat) {
            if (this.isWebGL2) {
                internalFormat = this.gl.RGBA16F;
                type = this.gl.HALF_FLOAT;
            } else {
                type = this.gl.FLOAT; // WebGL1 usually requires FLOAT for OES_texture_float
            }
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
                this._configureFramebuffer(this.fboB, this.texB, this.bloomWidth, this.bloomHeight);
                this._configureFramebuffer(this.fboC, this.texC, this.bloomWidth, this.bloomHeight);
            }
        }
        if (this.postProcessor) { this.postProcessor.resize(pw, ph); this.postProcessor.canvas.style.width = `${this.w}px`; this.postProcessor.canvas.style.height = `${this.h}px`; }

        // --- Resize Buffers ---
        const totalCells = this.grid.cols * this.grid.rows;
        
        // Helper to recreate buffer
        const ensureBuf = (buf, size, drawType = this.gl.DYNAMIC_DRAW) => {
             if (buf) this.gl.deleteBuffer(buf);
             const newBuf = this.gl.createBuffer();
             this.gl.bindBuffer(this.gl.ARRAY_BUFFER, newBuf);
             this.gl.bufferData(this.gl.ARRAY_BUFFER, size, drawType);
             return newBuf;
        };

        // Static Position Buffer
        this.posBuffer = ensureBuf(this.posBuffer, totalCells * 8, this.gl.STATIC_DRAW); // 2 floats * 4 bytes
        const posData = new Float32Array(totalCells * 2);
        const cw = d.cellWidth; const ch = d.cellHeight;
        const xOff = s.fontOffsetX; const yOff = s.fontOffsetY;
        for (let i = 0; i < totalCells; i++) {
             const col = i % this.grid.cols;
             const row = Math.floor(i / this.grid.cols);
             posData[i*2] = col * cw + cw * 0.5 + xOff;
             posData[i*2+1] = row * ch + ch * 0.5 + yOff;
        }
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, posData);

        // Dynamic Buffers
        this.charBuffer = ensureBuf(this.charBuffer, totalCells * 2); // Uint16
        this.colorBuffer = ensureBuf(this.colorBuffer, totalCells * 4); // Uint32 (RGBA)
        this.alphaBuffer = ensureBuf(this.alphaBuffer, totalCells * 4); // Float32
        this.decayBuffer = ensureBuf(this.decayBuffer, totalCells); // Uint8
        this.glowBuffer = ensureBuf(this.glowBuffer, totalCells * 4); // Float32
        this.mixBuffer = ensureBuf(this.mixBuffer, totalCells * 4); // Float32
        this.nextCharBuffer = ensureBuf(this.nextCharBuffer, totalCells * 2); // Uint16

        // Mapped Arrays
        this.mappedChars = new Uint16Array(totalCells);
        this.mappedNextChars = new Uint16Array(totalCells);
        
        // Upload Buffers (CPU merging for overrides/effects)
        this.uploadColors = new Uint32Array(totalCells);
        this.uploadAlphas = new Float32Array(totalCells);
        this.uploadDecays = new Uint8Array(totalCells); // Decays usually don't have overrides but safe to copy
        this.uploadGlows = new Float32Array(totalCells);
        this.uploadMix = new Float32Array(totalCells);

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

        // 2: CharIdx (Dynamic Instance, Uint16 -> Float/Int)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.charBuffer);
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 1, this.gl.UNSIGNED_SHORT, false, 0, 0);
        this.gl.vertexAttribDivisor(2, 1);

        // 3: Color (Dynamic Instance, Uint32 -> Vec4 Normalized)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.UNSIGNED_BYTE, true, 0, 0);
        this.gl.vertexAttribDivisor(3, 1);

        // 4: Alpha (Dynamic Instance, Float)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.alphaBuffer);
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribDivisor(4, 1);

        // 5: Decay (Dynamic Instance, Uint8 -> Float)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.decayBuffer);
        this.gl.enableVertexAttribArray(5);
        this.gl.vertexAttribPointer(5, 1, this.gl.UNSIGNED_BYTE, false, 0, 0);
        this.gl.vertexAttribDivisor(5, 1);

        // 6: Glow (Dynamic Instance, Float)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.glowBuffer);
        this.gl.enableVertexAttribArray(6);
        this.gl.vertexAttribPointer(6, 1, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribDivisor(6, 1);

        // 7: Mix (Dynamic Instance, Float)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.mixBuffer);
        this.gl.enableVertexAttribArray(7);
        this.gl.vertexAttribPointer(7, 1, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribDivisor(7, 1);

        // 8: NextChar (Dynamic Instance, Uint16 -> Float/Int)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nextCharBuffer);
        this.gl.enableVertexAttribArray(8);
        this.gl.vertexAttribPointer(8, 1, this.gl.UNSIGNED_SHORT, false, 0, 0);
        this.gl.vertexAttribDivisor(8, 1);

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
        
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    _runBlur(sourceTex, horizontal, strength, width, height, opacity = 1.0) {
        if (!this.bloomProgram) return;
        this.gl.useProgram(this.bloomProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTex);
        this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_image'), 0);
        
        const weights = [0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216];
        this.gl.uniform1fv(this.gl.getUniformLocation(this.bloomProgram, 'u_weight'), weights);
        
        this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_spread'), strength);
        this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_opacity'), opacity);
        this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_horizontal'), horizontal ? 1 : 0);
        
        if (!this.isWebGL2) {
             this.gl.uniform2f(this.gl.getUniformLocation(this.bloomProgram, 'u_texSize'), width, height);
        }

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    render(frame) {
        if (!this.posBuffer || this.fboWidth === 0) return; 
        
        const { state: s, derived: d } = this.config;
        const grid = this.grid;
        const activeFonts = d.activeFonts;
        
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

        if (!atlas.glTexture) {
            atlas.glTexture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
            this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
            atlas.resetChanges();
        } else if (atlas.hasChanges) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
            atlas.resetChanges();
        }
        this.needsAtlasUpdate = false;

        // --- MERGE & MAP ---
        const totalCells = grid.cols * grid.rows;
        if (this.mappedChars.length !== totalCells) return;

        const gChars = grid.chars;
        const gNext = grid.nextChars;
        const gSecChars = grid.secondaryChars;
        const gColors = grid.colors;
        const gAlphas = grid.alphas;
        const gDecays = grid.decays;
        const gGlows = grid.glows;
        const gMix = grid.mix;
        const gMode = grid.renderMode;
        
        const gEnvGlows = grid.envGlows;

        const ovActive = grid.overrideActive;
        const ovChars = grid.overrideChars;
        const ovColors = grid.overrideColors;
        const ovAlphas = grid.overrideAlphas;
        const ovGlows = grid.overrideGlows;

        const effActive = grid.effectActive;
        const effChars = grid.effectChars;
        const effColors = grid.effectColors;
        const effAlphas = grid.effectAlphas;
        const effGlows = grid.effectGlows;

        const lookup = atlas.codeToId;
        
        const mChars = this.mappedChars;
        const mNext = this.mappedNextChars;
        const uColors = this.uploadColors;
        const uAlphas = this.uploadAlphas;
        const uDecays = this.uploadDecays;
        const uGlows = this.uploadGlows;
        const uMix = this.uploadMix;

        const mapChar = (c) => {
            if (c <= 32) return 0;
            let id = lookup[c];
            if (id === -1) {
                const rect = atlas.addChar(String.fromCharCode(c));
                id = rect ? rect.id : 0;
            }
            return id;
        };
        
        for (let i = 0; i < totalCells; i++) {
            // PRIORITY 1: PASSIVE EFFECT (Pulse, etc.)
            if (effActive && effActive[i]) {
                if (effActive[i] === 2) {
                    // OVERLAY MODE: Draw Sim + White Effect
                    // 1. Load Simulation
                    const c = gChars[i];
                    mChars[i] = mapChar(c);
                    uColors[i] = gColors[i];
                    uAlphas[i] = gAlphas[i];
                    uDecays[i] = gDecays[i];
                    uGlows[i] = gGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    // 2. Load Effect
                    mNext[i] = mapChar(effChars[i]);
                    let eAlpha = effAlphas[i];
                    if (eAlpha > 0.99) eAlpha = 0.99;
                    uMix[i] = 4.0 + eAlpha; 
                    continue;
                }

                // STANDARD OVERRIDE (Replace)
                mChars[i] = mapChar(effChars[i]);
                uColors[i] = effColors[i];
                uAlphas[i] = effAlphas[i];
                uGlows[i] = effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                
                // Force "Solid" render behavior for effects to prevent simulation fading
                uDecays[i] = 0; 
                uMix[i] = 0.0; // Treat as solid/override in shader
                mNext[i] = 0;
                continue; 
            }

            // PRIORITY 2: HARD OVERRIDE (Deja Vu, Firewall, etc.)
            // These usually indicate a logic change or interruption.
            const ov = ovActive[i];
            if (ov) {
                if (ov === 2) { // SOLID
                    mChars[i] = 0;
                    mNext[i] = 0;
                    uMix[i] = 0.0; 
                    uColors[i] = ovColors[i];
                    uAlphas[i] = ovAlphas[i];
                    uDecays[i] = 0;
                    uGlows[i] = (gEnvGlows ? gEnvGlows[i] : 0);
                } else { // CHAR
                    mChars[i] = mapChar(ovChars[i]);
                    
                    const mode = gMode[i];
                    if (mode === 1) { // OVERLAP
                        mNext[i] = mapChar(gSecChars[i]);
                        uMix[i] = 2.0; 
                    } else {
                        mNext[i] = 0;
                        uMix[i] = 0;
                    }
                    
                    uColors[i] = ovColors[i];
                    uAlphas[i] = ovAlphas[i];
                    uDecays[i] = 0;
                    uGlows[i] = ovGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                }
                continue;
            }

            // PRIORITY 3: STANDARD SIMULATION
            const c = gChars[i];
            mChars[i] = mapChar(c);
            uColors[i] = gColors[i];
            uAlphas[i] = gAlphas[i];
            uDecays[i] = gDecays[i];
            uGlows[i] = gGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
            
            const mode = gMode[i];
            if (mode === 1) { // OVERLAP
                mNext[i] = mapChar(gSecChars[i]);
                uMix[i] = 2.0; 
            } else {
                const mix = gMix[i];
                uMix[i] = mix;
                if (mix > 0) {
                    mNext[i] = mapChar(gNext[i]);
                } else {
                    mNext[i] = 0;
                }
            }
        }


        if (atlas.hasChanges) {
             this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
             this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
             atlas.resetChanges();
        }

        // --- UPLOAD ---
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.charBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mChars);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uColors);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.alphaBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uAlphas);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.decayBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uDecays);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.glowBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uGlows);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.mixBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uMix);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nextCharBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mNext);


        // --- DRAW ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA);
        this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
        
        // 1. Trail Fade (Draw Black Quad)
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        if (this.colorProgram) {
            this.gl.useProgram(this.colorProgram);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
            this.gl.enableVertexAttribArray(0); 
            this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
            this.gl.uniform4f(this.gl.getUniformLocation(this.colorProgram, 'u_color'), 0, 0, 0, s.clearAlpha);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        }

        // 2. Draw Cells
        this.gl.useProgram(this.program);
        
        // Uniforms
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_resolution'), this.w, this.h);
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_atlasSize'), atlas.canvas.width, atlas.canvas.height);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_cellSize'), atlas.cellSize);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_cols'), atlas._lastCols);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_decayDur'), s.decayFadeDurationFrames);
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_stretch'), s.stretchX, s.stretchY);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_mirror'), s.mirrorEnabled ? -1.0 : 1.0);
        this.gl.uniform1i(this.gl.getUniformLocation(this.program, 'u_texture'), 0);
        
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_time'), performance.now() / 1000.0);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_dissolveEnabled'), s.dissolveEnabled ? 1.0 : 0.0);
        
        // Target Scale: 1.0 + percent/100. e.g. -20% -> 0.8
        const percent = s.dissolveScalePercent !== undefined ? s.dissolveScalePercent : -20;
        const dissolveScale = s.dissolveEnabled ? (1.0 + (percent / 100.0)) : 1.0;
        
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_dissolveScale'), dissolveScale);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_dissolveSize'), s.dissolveMinSize || 1.0);
        
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_deteriorationEnabled'), s.deteriorationEnabled ? 1.0 : 0.0);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_deteriorationStrength'), s.deteriorationStrength);
        
        // Pass Overlap Color
        const ovRgb = Utils.hexToRgb(s.overlapColor || "#FFD700");
        this.gl.uniform4f(this.gl.getUniformLocation(this.program, 'u_overlapColor'), ovRgb.r/255.0, ovRgb.g/255.0, ovRgb.b/255.0, 1.0);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
        
        this.gl.bindVertexArray(this.vao);
        
        // Draw
        this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, totalCells);
        this.gl.bindVertexArray(null);

        // --- POST PROCESS (Bloom) ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
        
        const blurAmt = s.smoothingEnabled ? s.smoothingAmount : 0;
        this._drawFullscreenTexture(this.texA, 1.0, blurAmt);

        if (s.enableBloom) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboB);
            this.gl.viewport(0, 0, this.bloomWidth, this.bloomHeight);
            let spread = s.bloomStrength * 1.0; 
            this._runBlur(this.texA, true, spread, this.fboWidth, this.fboHeight); 

            const iterations = 3;
            for (let i = 0; i < iterations; i++) {
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboC);
                this._runBlur(this.texB, false, spread, this.bloomWidth, this.bloomHeight);
                
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboB);
                this._runBlur(this.texC, true, spread, this.bloomWidth, this.bloomHeight);
            }

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 
            this._drawFullscreenTexture(this.texB, s.bloomOpacity, 0);
        }

        if (this.postProcessor && s.shaderEnabled) {
            const currentShader = s.customShader;
            if (currentShader && currentShader !== this.lastShaderSource) {
                this.postProcessor.compileShader(currentShader);
                this.lastShaderSource = currentShader;
            }
            const param = s.shaderParameter !== undefined ? s.shaderParameter : 0.5;
            this.postProcessor.render(this.cvs, performance.now() / 1000, this.mouseX, this.mouseY, param);
            
            if (this.postProcessor.canvas.style.display === 'none') {
                this.postProcessor.canvas.style.display = 'block';
                this.cvs.style.opacity = '0'; 
            }
        } else {
            if (this.postProcessor && this.postProcessor.canvas.style.display !== 'none') {
                this.postProcessor.canvas.style.display = 'none';
                this.cvs.style.opacity = '1';
            }
        }
    }
}