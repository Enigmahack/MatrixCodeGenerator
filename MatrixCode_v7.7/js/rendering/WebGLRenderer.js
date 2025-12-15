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

        // WebGL1 Extension for Instancing
        if (!this.isWebGL2) {
            const ext = this.gl.getExtension('ANGLE_instanced_arrays');
            if (!ext) {
                console.error("WebGLRenderer: ANGLE_instanced_arrays not supported.");
                throw new Error("WebGL Instancing not supported");
            }
            // Polyfill methods onto gl context for uniform usage
            this.gl.vertexAttribDivisor = ext.vertexAttribDivisorANGLE.bind(ext);
            this.gl.drawArraysInstanced = ext.drawArraysInstancedANGLE.bind(ext);
            this.gl.createVertexArray = () => { return this.gl.createExtension('OES_vertex_array_object')?.createVertexArrayOES(); };
            this.gl.bindVertexArray = (vao) => { return this.gl.createExtension('OES_vertex_array_object')?.bindVertexArrayOES(vao); };
            this.gl.deleteVertexArray = (vao) => { return this.gl.createExtension('OES_vertex_array_object')?.deleteVertexArrayOES(vao); };
            // Note: Vertex Arrays (VAO) are also an extension in WebGL1 (OES_vertex_array_object)
            // We need that too for _setupVAO to work unmodified.
            const vaoExt = this.gl.getExtension('OES_vertex_array_object');
            if(vaoExt) {
                this.gl.createVertexArray = vaoExt.createVertexArrayOES.bind(vaoExt);
                this.gl.bindVertexArray = vaoExt.bindVertexArrayOES.bind(vaoExt);
                this.gl.deleteVertexArray = vaoExt.deleteVertexArrayOES.bind(vaoExt);
            } else {
                 // Fallback without VAOs is painful; strict requirement for now?
                 console.warn("WebGLRenderer: OES_vertex_array_object not supported. Performance may degrade.");
                 // Minimal shim to prevent crashes, though logic might fail if we rely on VAO state.
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
        this.program = null;       // Main Matrix Shader
        this.bloomProgram = null;  // Bloom/Blur Shader
        this.atlasTexture = null;  // Font Texture
        this.vao = null;           // Vertex Array Object
        
        // --- Buffers ---
        // Capacity: Total number of cells. 
        // Layout per instance: [x, y, charIndex, r, g, b, a, scale] (8 floats)
        this.instanceCapacity = 0; 
        this.instanceData = null; 
        this.instanceBuffer = null;

        // --- Framebuffers for Bloom ---
        this.fboA = null; // Main Render Target
        this.fboB = null; // Ping-Pong Target
        this.texA = null; // Texture for FBO A
        this.texB = null; // Texture for FBO B
        this.bloomWidth = 0;
        this.bloomHeight = 0;

        // --- State Tracking ---
        this.w = 0;
        this.h = 0;
        this.needsAtlasUpdate = true;
        this.smoothingValue = 0;
        
        // Mouse tracking (kept for parity with CanvasRenderer, though mostly used by PostProcessor)
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this._setupMouseTracking();

        // Performance / Cache
        this._tracerStateObj = { alpha: 0, phase: 'none' };
        
        // Initialize
        this._initShaders();
        this._initBuffers();
        this._initBloomBuffers();
        console.log("Rendering Engine: WebGL");

        // --- Post Processor Integration ---
        if (typeof PostProcessor !== 'undefined') {
            this.postProcessor = new PostProcessor(config);
            this.postProcessor.canvas.id = 'shaderCanvas';
            this.postProcessor.canvas.style.position = 'absolute';
            this.postProcessor.canvas.style.top = '0';
            this.postProcessor.canvas.style.left = '0';
            this.postProcessor.canvas.style.zIndex = '2'; 
            this.postProcessor.canvas.style.display = 'none'; 
            
            // Insert after main canvas
            if (this.cvs.parentNode) {
                this.cvs.parentNode.insertBefore(this.postProcessor.canvas, this.cvs.nextSibling);
            }
            this.lastShaderSource = null;
        }
    }

    dispose() {
        if (this._mouseMoveHandler) {
            window.removeEventListener('mousemove', this._mouseMoveHandler);
        }
        if (this._touchMoveHandler) {
            window.removeEventListener('touchmove', this._touchMoveHandler);
        }

        // Remove PostProcessor canvas
        if (this.postProcessor && this.postProcessor.canvas && this.postProcessor.canvas.parentNode) {
            this.postProcessor.canvas.parentNode.removeChild(this.postProcessor.canvas);
        }

        // WebGL Cleanup could involve deleting buffers/textures, but usually optional if context is lost.
        // For good measure:
        if (this.gl) {
            // Simple cleanup attempt
            if (this.program) this.gl.deleteProgram(this.program);
            if (this.bloomProgram) this.gl.deleteProgram(this.bloomProgram);
            if (this.atlasTexture) this.gl.deleteTexture(this.atlasTexture);
            // We don't destroy the context or canvas, just reset.
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

    // 1. SHADER COMPILATION AND SETUP

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
        // --- Main Matrix Shader (Instanced) ---
        const version = this.isWebGL2 ? '#version 300 es' : '';
        const attribute = this.isWebGL2 ? 'in' : 'attribute';
        const varying = this.isWebGL2 ? 'out' : 'varying';
        const varyingIn = this.isWebGL2 ? 'in' : 'varying';
        const texture2D = this.isWebGL2 ? 'texture' : 'texture2D';
        const outColor = this.isWebGL2 ? 'out vec4 fragColor;' : '';
        const setFragColor = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';

        const matrixVS = `${version}
            layout(location=0) ${attribute} vec2 a_position;   // Quad vertex (0..1)
            layout(location=1) ${attribute} vec2 a_offset;     // Cell pixel position
            layout(location=2) ${attribute} float a_charIdx;   // Character Index in Atlas
            layout(location=3) ${attribute} vec4 a_color;      // RGBA
            layout(location=4) ${attribute} float a_scale;     // Scale factor

            uniform vec2 u_resolution;
            uniform vec2 u_atlasSize;   // Texture dimensions
            uniform float u_cellSize;   // Size of one cell in texture (px)
            uniform float u_cols;       // Columns in atlas
            uniform float u_mirror;     // 1.0 or -1.0 for mirroring
            uniform vec2 u_stretch;     // Stretch factors (x, y)

            ${varying} vec2 v_uv;
            ${varying} vec4 v_color;
            ${varying} float v_isSolid;

            void main() {
                // 1. Calculate Screen Position
                vec2 centerPos = (a_position - 0.5) * u_cellSize * a_scale;
                vec2 stretchedPos = (a_offset + centerPos) * u_stretch;
                
                if (u_mirror < 0.0) {
                    stretchedPos.x = u_resolution.x - stretchedPos.x;
                }

                vec2 clip = (stretchedPos / u_resolution) * 2.0 - 1.0;
                clip.y = -clip.y; 
                gl_Position = vec4(clip, 0.0, 1.0);

                // 2. Calculate Atlas UVs or Solid Mode
                v_color = a_color;
                
                if (a_charIdx < -0.5) {
                    v_isSolid = 1.0;
                    v_uv = vec2(0.0);
                } else {
                    v_isSolid = 0.0;
                    float row = floor(a_charIdx / u_cols);
                    float col = mod(a_charIdx, u_cols);
                    vec2 uvBase = vec2(col, row) * u_cellSize;
                    vec2 uvPixel = uvBase + (a_position * u_cellSize);
                    v_uv = uvPixel / u_atlasSize;
                }
            }
        `;

        let finalMatrixVS = matrixVS;
        if (!this.isWebGL2) {
             finalMatrixVS = `
                attribute vec2 a_position;
                attribute vec2 a_offset;
                attribute float a_charIdx;
                attribute vec4 a_color;
                attribute float a_scale;

                uniform vec2 u_resolution;
                uniform vec2 u_atlasSize;
                uniform float u_cellSize;
                uniform float u_cols;
                uniform float u_mirror;
                uniform vec2 u_stretch;

                varying vec2 v_uv;
                varying vec4 v_color;
                varying float v_isSolid;

                void main() {
                    vec2 centerPos = (a_position - 0.5) * u_cellSize * a_scale;
                    vec2 stretchedPos = (a_offset + centerPos) * u_stretch;
                    if (u_mirror < 0.0) { stretchedPos.x = u_resolution.x - stretchedPos.x; }
                    vec2 clip = (stretchedPos / u_resolution) * 2.0 - 1.0;
                    clip.y = -clip.y;
                    gl_Position = vec4(clip, 0.0, 1.0);
                    
                    v_color = a_color;
                    if (a_charIdx < -0.5) {
                        v_isSolid = 1.0;
                        v_uv = vec2(0.0);
                    } else {
                        v_isSolid = 0.0;
                        float row = floor(a_charIdx / u_cols);
                        float col = mod(a_charIdx, u_cols);
                        vec2 uvBase = vec2(col, row) * u_cellSize;
                        vec2 uvPixel = uvBase + (a_position * u_cellSize);
                        v_uv = uvPixel / u_atlasSize;
                    }
                }
             `;
        }

        const matrixFS = `${version}
            precision mediump float;
            ${varyingIn} vec2 v_uv;
            ${varyingIn} vec4 v_color;
            ${varyingIn} float v_isSolid;
            uniform sampler2D u_texture;
            ${outColor}

            void main() {
                if (v_isSolid > 0.5) {
                    ${setFragColor} = v_color;
                } else {
                    vec4 tex = ${texture2D}(u_texture, v_uv);
                    if (tex.a < 0.1) discard;
                    ${setFragColor} = vec4(v_color.rgb, v_color.a * tex.a);
                }
            }
        `;

        this.program = this._createProgram(finalMatrixVS, matrixFS);

        // --- Bloom/Blur Shader (Post Process Quad) ---
        const bloomVS = `${version}
            layout(location=0) ${attribute} vec2 a_position;
            ${varying} vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5; // Map -1..1 to 0..1
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;
        let finalBloomVS = bloomVS;
        if(!this.isWebGL2) {
            finalBloomVS = `attribute vec2 a_position; varying vec2 v_uv; void main(){ v_uv=a_position*0.5+0.5; gl_Position=vec4(a_position, 0.0, 1.0); }`;
        }

        // Gaussian Blur (9-tap) with Spread
        const bloomFS = `${version}
            precision mediump float;
            ${varyingIn} vec2 v_uv;
            uniform sampler2D u_image;
            uniform bool u_horizontal;
            uniform float u_weight[5];
            uniform float u_spread;
            ${outColor}

            void main() {
                vec2 tex_offset = (1.0 / vec2(textureSize(u_image, 0))) * u_spread; 
                vec3 result = ${texture2D}(u_image, v_uv).rgb * u_weight[0]; 
                
                if(u_horizontal) {
                    for(int i = 1; i < 5; ++i) {
                        result += ${texture2D}(u_image, v_uv + vec2(tex_offset.x * float(i), 0.0)).rgb * u_weight[i];
                        result += ${texture2D}(u_image, v_uv - vec2(tex_offset.x * float(i), 0.0)).rgb * u_weight[i];
                    }
                } else {
                    for(int i = 1; i < 5; ++i) {
                        result += ${texture2D}(u_image, v_uv + vec2(0.0, tex_offset.y * float(i))).rgb * u_weight[i];
                        result += ${texture2D}(u_image, v_uv - vec2(0.0, tex_offset.y * float(i))).rgb * u_weight[i];
                    }
                }
                ${setFragColor} = vec4(result, 1.0);
            }
        `;
        
        let finalBloomFS = bloomFS;
        if (!this.isWebGL2) {
             finalBloomFS = `
                precision mediump float;
                varying vec2 v_uv;
                uniform sampler2D u_image;
                uniform bool u_horizontal;
                uniform float u_weight[5];
                uniform float u_spread;
                uniform vec2 u_texSize;

                void main() {
                    vec2 tex_offset = (1.0 / u_texSize) * u_spread;
                    vec3 result = texture2D(u_image, v_uv).rgb * u_weight[0];
                    if(u_horizontal) {
                        for(int i = 1; i < 5; ++i) {
                            result += texture2D(u_image, v_uv + vec2(tex_offset.x * float(i), 0.0)).rgb * u_weight[i];
                            result += texture2D(u_image, v_uv - vec2(tex_offset.x * float(i), 0.0)).rgb * u_weight[i];
                        }
                    } else {
                        for(int i = 1; i < 5; ++i) {
                            result += texture2D(u_image, v_uv + vec2(0.0, tex_offset.y * float(i))).rgb * u_weight[i];
                            result += texture2D(u_image, v_uv - vec2(0.0, tex_offset.y * float(i))).rgb * u_weight[i];
                        }
                    }
                    gl_FragColor = vec4(result, 1.0);
                }
             `;
        }

        this.bloomProgram = this._createProgram(finalBloomVS, finalBloomFS);
    }

    _initBuffers() {
        // --- Main Quad (Unit Square) ---
        // Used for both instanced cells and full-screen bloom passes
        const quadVerts = new Float32Array([
            0, 0,  1, 0,  0, 1,
            0, 1,  1, 0,  1, 1
        ]); // 0..1 quad

        // We also need a -1..1 quad for the full screen passes
        const screenQuadVerts = new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1, 1,   1, -1,   1, 1
        ]);

        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVerts, this.gl.STATIC_DRAW);

        this.screenQuadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, screenQuadVerts, this.gl.STATIC_DRAW);

        // --- Instance Buffer (Dynamic) ---
        // Created in resize() based on grid size
    }

    _initBloomBuffers() {
        // Create Framebuffers and Textures for Bloom Ping-Pong
        // Sizes will be set in resize()
        this.fboA = this.gl.createFramebuffer();
        this.texA = this.gl.createTexture();
        this.fboB = this.gl.createFramebuffer();
        this.texB = this.gl.createTexture();
    }

    _configureFramebuffer(fbo, tex, width, height) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, tex, 0);
        
        const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
        if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
            console.error("WebGLRenderer: Framebuffer incomplete! Status:", status);
        }
        
        // Unbind
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    // 2. PUBLIC API (CanvasRenderer Replacement)

    handleFontChange() {
        this.glyphAtlases.clear();
        this.needsAtlasUpdate = true;
    }

    handleAppearanceChange() {
        this.needsAtlasUpdate = true;
    }

    updateSmoothing() {
        // In WebGL, smoothing is handled via the Bloom/Blur shaders or texture filtering.
        this.smoothingValue = this.config.state.smoothingEnabled ? this.config.state.smoothingAmount : 0;
    }

    resize() {
        const s = this.config.state;
        const d = this.config.derived;
        const scale = s.resolution;
        
        // Trigger atlas update on resize (font size usually changes here)
        this.handleAppearanceChange();
        
        // Logical Size
        this.w = window.innerWidth;
        this.h = window.innerHeight;

        // Physical Size
        const pw = Math.floor(this.w * scale);
        const ph = Math.floor(this.h * scale);

        if (this.cvs.width !== pw || this.cvs.height !== ph) {
            this.cvs.width = pw;
            this.cvs.height = ph;
            this.gl.viewport(0, 0, pw, ph);
        }
        
        // FBO A: FULL Resolution (Stores the sharp scene + trails)
        // FBO B: HALF Resolution (Used for blur pass)
        
        if (this.fboWidth !== pw || this.fboHeight !== ph) {
            this.fboWidth = pw;
            this.fboHeight = ph;
            
            this.bloomWidth = Math.floor(pw * 0.5);
            this.bloomHeight = Math.floor(ph * 0.5);

            if (pw > 0 && ph > 0) {
                // Resize FBO A (Full Res)
                this._configureFramebuffer(this.fboA, this.texA, this.fboWidth, this.fboHeight);
                // Resize FBO B (Half Res)
                this._configureFramebuffer(this.fboB, this.texB, this.bloomWidth, this.bloomHeight);
            }
        }
            
        // Resize Post Processor
        if (this.postProcessor) {
            this.postProcessor.resize(pw, ph);
            this.postProcessor.canvas.style.width = `${this.w}px`;
            this.postProcessor.canvas.style.height = `${this.h}px`;
        }

        // Reallocate Instance Buffer if grid size grew significantly
        // Layout: x, y, charIdx, r, g, b, a, scale (8 floats)
        const totalCells = this.grid.cols * this.grid.rows;
        // Add buffer for Main + Overlap + Tracer layers (worst case: 3x cells)
        const capacity = totalCells * 6; 

        if (capacity > this.instanceCapacity) {
            this.instanceCapacity = capacity;
            this.instanceData = new Float32Array(capacity * 8);
            
            if (this.instanceBuffer) this.gl.deleteBuffer(this.instanceBuffer);
            this.instanceBuffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
            
            // Rebuild VAO
            this._setupVAO();
        }
    }

    _setupVAO() {
        if (this.vao) this.gl.deleteVertexArray(this.vao);
        this.vao = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.vao);

        // 1. Quad Geometry (Not Instanced)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);

        // 2. Instance Data (Instanced)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        
        const stride = 8 * 4; // 8 floats * 4 bytes

        // Offset (vec2)
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, 0);
        this.gl.vertexAttribDivisor(1, 1);

        // CharIdx (float)
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, 2 * 4);
        this.gl.vertexAttribDivisor(2, 1);

        // Color (vec4)
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, 3 * 4);
        this.gl.vertexAttribDivisor(3, 1);

        // Scale (float)
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, stride, 7 * 4);
        this.gl.vertexAttribDivisor(4, 1);

        this.gl.bindVertexArray(null);
    }

    _getTracerState(index, state, out) {
        // Reset defaults
        out.alpha = 0;
        out.phase = 'none';

        const age = this.grid.ages[index];
        const decay = this.grid.decays[index];
        if (age <= 0 || decay >= 2) return out;

        const type = this.grid.types[index];
        // Use local constants or globals if available. 
        // Fallback to 2 (Tracer) and 3 (Rotator) if CELL_TYPE is missing.
        const C_TRACER = (typeof CELL_TYPE !== 'undefined') ? CELL_TYPE.TRACER : 2;
        const C_ROTATOR = (typeof CELL_TYPE !== 'undefined') ? CELL_TYPE.ROTATOR : 3;

        if (type !== C_TRACER && type !== C_ROTATOR) return out;

        const activeTime = age - 1;
        const attack = state.tracerAttackFrames;
        const hold = state.tracerHoldFrames;
        const release = state.tracerReleaseFrames;

        if (activeTime < attack) {
            out.alpha = (attack > 0) ? (activeTime / attack) : 1.0;
            out.phase = 'attack';
        } else if (activeTime < attack + hold) {
            out.alpha = 1.0;
            out.phase = 'hold';
        } else if (activeTime < attack + hold + release) {
            const relTime = activeTime - (attack + hold);
            out.alpha = 1.0 - (relTime / release);
            out.phase = 'release';
        }
        return out;
    }

    _bindInstanceAttributes(offset) {
        const stride = 32; // 8 floats * 4 bytes
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);

        // Attrib 1: Offset (vec2)
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, offset);
        this.gl.vertexAttribDivisor(1, 1);

        // Attrib 2: CharIdx (float)
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, offset + 8);
        this.gl.vertexAttribDivisor(2, 1);

        // Attrib 3: Color (vec4)
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, offset + 12);
        this.gl.vertexAttribDivisor(3, 1);

        // Attrib 4: Scale (float)
        this.gl.enableVertexAttribArray(4);
        this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, stride, offset + 28);
        this.gl.vertexAttribDivisor(4, 1);
    }

    render(frame) {
        if (!this.instanceData) return;
        
        // Wait for resize
        if (this.fboWidth === 0 || this.fboHeight === 0) return;

        const { state: s, derived: d } = this.config;
        const grid = this.grid;

        // Ensure GlyphAtlas class is available
        if (typeof GlyphAtlas === 'undefined') return;

        const activeFonts = d.activeFonts;
        if (!activeFonts || activeFonts.length === 0) return;

        // Update Atlases Logic (Inline)
        // We iterate active fonts to ensure they are generated/updated
        for (let fi = 0; fi < activeFonts.length; fi++) {
            const font = activeFonts[fi];
            let atlas = this.glyphAtlases.get(font.name);
            if (!atlas) {
                atlas = new GlyphAtlas(this.config, font.name, font.chars);
                this.glyphAtlases.set(font.name, atlas);
            } else {
                atlas.fontName = font.name;
                atlas.customChars = font.chars;
            }
            if (this.needsAtlasUpdate || atlas.needsUpdate) {
                atlas.update();
            }
        }
        this.needsAtlasUpdate = false;

        const xOff = s.fontOffsetX;
        const yOff = s.fontOffsetY;
        const cw = d.cellWidth;
        const ch = d.cellHeight;
        
        // Prepare Constants
        const paletteNorm = d.paletteRgbs.map(rgb => [rgb.r/255, rgb.g/255, rgb.b/255]);
        const tracerRgb = d.tracerRgb;
        const tracerColor = [tracerRgb.r/255, tracerRgb.g/255, tracerRgb.b/255];
        const oc = Utils.hexToRgb(s.overlapColor || '#ffffff');
        const overlapColor = [oc.r/255, oc.g/255, oc.b/255];
        const C_TRACER = (typeof CELL_TYPE !== 'undefined') ? CELL_TYPE.TRACER : 2;
        const C_ROTATOR = (typeof CELL_TYPE !== 'undefined') ? CELL_TYPE.ROTATOR : 3;

        // --- PREPARE FBO ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA);
        this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
        
        // Clear FBO A once at the start
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this._drawFullscreenColor(0, 0, 0, s.clearAlpha);

        // --- FONT LOOP ---
        for (let fIdx = 0; fIdx < activeFonts.length; fIdx++) {
            const fontData = activeFonts[fIdx];
            const atlas = this.glyphAtlases.get(fontData.name);
            if (!atlas) continue;

            // --- TEXTURE MANAGEMENT ---
            let glTexture = atlas.glTexture;
            let textureNeedsUpload = false;

            if (!glTexture) {
                glTexture = this.gl.createTexture();
                atlas.glTexture = glTexture;
                this.gl.bindTexture(this.gl.TEXTURE_2D, glTexture);
                this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
                textureNeedsUpload = true;
            } else {
                this.gl.bindTexture(this.gl.TEXTURE_2D, glTexture);
                if (atlas.hasChanges) {
                    textureNeedsUpload = true;
                }
            }

            if (textureNeedsUpload) {
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
                atlas.resetChanges();
            }
            
            // --- PASS 1: COUNT INSTANCES FOR THIS FONT ---
            let nMain = 0;
            let nOverlap = 0;
            let nTracer = 0;

            for (const i of grid.activeIndices) {
                // Determine effective font
                const cellFontIdx = grid.getFont(i);
                let effectiveFontName = (activeFonts[cellFontIdx] || activeFonts[0]).name;
                
                const override = this.effects.getOverride(i);
                if (override && override.font) {
                    effectiveFontName = override.font;
                }
                
                if (effectiveFontName !== fontData.name) continue;

                // Main Count
                const gridAlpha0 = grid.alphas[i];
                let gridAlpha = gridAlpha0;
                const tState = this._getTracerState(i, s, this._tracerStateObj);

                if (tState.phase === 'attack' || tState.phase === 'hold') gridAlpha = 0.0;
                
                if (override) {
                     if (override.solid) nMain++; 
                     if (override.alpha !== undefined) gridAlpha = override.alpha;
                }
                if (gridAlpha > 0.01) {
                    nMain++;
                    // Ghost Logic (Count)
                    if (s.deteriorationEnabled) {
                        const decay = grid.decays[i];
                        if (decay >= 2) nMain += 2; // Add 2 ghosts
                    }
                }

                // Overlap Count
                if (s.overlapEnabled && grid.overlapChars) {
                    const ovCode = grid.overlapChars[i];
                    if (ovCode > 0 && gridAlpha > 0.05) {
                        const type = grid.types[i];
                        const overlapTarget = s.overlapTarget || 'stream';
                        let allowOverlap = true;
                        if (overlapTarget === 'stream' && type !== C_TRACER && type !== C_ROTATOR) allowOverlap = false;
                        const style = grid.complexStyles.get(i);
                        if (style && style.isEffect) allowOverlap = false;
                        if (allowOverlap) nOverlap++;
                    }
                }

                // Tracer Count
                if (tState.phase !== 'none' && tState.alpha > 0.01) nTracer++;
            }

            // --- SETUP POINTERS ---
            let ptrMain = 0;
            let ptrOverlap = nMain * 8;
            let ptrTracer = (nMain + nOverlap) * 8;
            
            // --- PASS 2: FILL BUFFER ---
            for (const i of grid.activeIndices) {
                // Font Check (Repeat)
                const cellFontIdx = grid.getFont(i);
                let effectiveFontName = (activeFonts[cellFontIdx] || activeFonts[0]).name;
                const override = this.effects.getOverride(i);
                if (override && override.font) effectiveFontName = override.font;
                if (effectiveFontName !== fontData.name) continue;

                const gridAlpha0 = grid.alphas[i];
                const tState = this._getTracerState(i, s, this._tracerStateObj);
                let gridAlpha = gridAlpha0;

                if (tState.phase === 'attack' || tState.phase === 'hold') {
                    gridAlpha = 0.0;
                }

                // Size Logic (Override + Dissolve)
                let drawScale = 1.0;
                if (override && override.size) {
                    drawScale = 1.0 + (override.size / s.fontSize);
                } else if (s.dissolveEnabled) {
                    const decay = grid.decays[i];
                    if (decay >= 2) {
                        const prog = (decay - 2) / s.decayFadeDurationFrames;
                        const minRatio = s.dissolveMinSize / s.fontSize;
                        drawScale = Math.max(0.1, 1.0 - (prog * (1.0 - minRatio)));
                    }
                }

                const age = grid.ages[i];
                const type = grid.types[i];

                let r=0, g=1, b=0; 
                let pIdx = grid.paletteIndices[i];
                if (pIdx >= paletteNorm.length) pIdx = 0;
                const pc = paletteNorm[pIdx];
                r = pc[0]; g = pc[1]; b = pc[2];

                const style = grid.complexStyles.get(i);
                if (style) {
                    if (style.glitter && Math.random() < 0.02) { r=1; g=1; b=1; }
                    else {
                        let h = style.h;
                        if (style.cycle) h = (h + (frame * style.speed)) % 360;
                        const rgb = Utils.hslToRgb(h, style.s, style.l);
                        r=rgb.r/255; g=rgb.g/255; b=rgb.b/255;
                    }
                }

                let charCode = grid.chars[i];
                const px = (i % grid.cols) * cw + cw * 0.5 + xOff;
                const py = Math.floor(i / grid.cols) * ch + ch * 0.5 + yOff;

                if (override) {
                     if (override.solid) {
                         const bg = Utils.hexToRgb(override.bgColor || '#000000');
                         this.instanceData[ptrMain++] = px;
                         this.instanceData[ptrMain++] = py;
                         this.instanceData[ptrMain++] = -1.0; 
                         this.instanceData[ptrMain++] = bg.r/255;
                         this.instanceData[ptrMain++] = bg.g/255;
                         this.instanceData[ptrMain++] = bg.b/255;
                         this.instanceData[ptrMain++] = 1.0; 
                         this.instanceData[ptrMain++] = 1.1; 
                     }
                     if (override.alpha !== undefined) gridAlpha = override.alpha;
                     if (override.char) charCode = override.char.charCodeAt(0);
                     if (override.color) {
                         const c = Utils.hexToRgb(override.color);
                         r = c.r/255; g = c.g/255; b = c.b/255;
                     }
                }

                // 1. MAIN CHAR
                if (gridAlpha > 0.01) {
                    const charStr = String.fromCharCode(charCode);
                    const sprite = atlas.get(charStr);
                    if (sprite) {
                        const col = Math.round(sprite.x / atlas.cellSize);
                        const row = Math.round(sprite.y / atlas.cellSize);
                        const charIdx = (row * atlas._lastCols) + col;

                        this.instanceData[ptrMain++] = px;
                        this.instanceData[ptrMain++] = py;
                        this.instanceData[ptrMain++] = charIdx;
                        this.instanceData[ptrMain++] = r;
                        this.instanceData[ptrMain++] = g;
                        this.instanceData[ptrMain++] = b;
                        this.instanceData[ptrMain++] = gridAlpha;
                        this.instanceData[ptrMain++] = drawScale;

                        // Ghost Logic (Fill)
                        if (s.deteriorationEnabled) {
                            const decay = grid.decays[i];
                            if (decay >= 2) {
                                 const prog = (decay - 2) / s.decayFadeDurationFrames;
                                 const off = s.deteriorationStrength * prog;
                                 const ghostAlpha = gridAlpha * 0.8 * prog;
                                 
                                 if (ghostAlpha > 0.01) {
                                     // Ghost 1 (Up)
                                     this.instanceData[ptrMain++] = px;
                                     this.instanceData[ptrMain++] = py - off;
                                     this.instanceData[ptrMain++] = charIdx;
                                     this.instanceData[ptrMain++] = r; this.instanceData[ptrMain++] = g; this.instanceData[ptrMain++] = b;
                                     this.instanceData[ptrMain++] = ghostAlpha;
                                     this.instanceData[ptrMain++] = drawScale;

                                     // Ghost 2 (Down)
                                     this.instanceData[ptrMain++] = px;
                                     this.instanceData[ptrMain++] = py + off;
                                     this.instanceData[ptrMain++] = charIdx;
                                     this.instanceData[ptrMain++] = r; this.instanceData[ptrMain++] = g; this.instanceData[ptrMain++] = b;
                                     this.instanceData[ptrMain++] = ghostAlpha;
                                     this.instanceData[ptrMain++] = drawScale;
                                 } else {
                                     // Counted but skipped due to low alpha, advance ptr to keep alignment?
                                     // No, buffer is contiguous. Counted space can be unused if we strictly use subarray up to totalFloats.
                                     // Wait, 'totalFloats' is calculated via 'ptrTracer'. 
                                     // If we don't increment ptrMain here, 'ptrOverlap' calculation earlier will be wrong?
                                     // NO. 'ptrOverlap' was pre-calculated: 'let ptrOverlap = nMain * 8'.
                                     // IF we don't fill these slots, there will be gaps in the buffer.
                                     // AND the overlap data will be written starting at 'ptrOverlap', overwriting whatever garbage is there.
                                     // BUT if we counted them in 'nMain', we reserved space BEFORE 'ptrOverlap'.
                                     // So if we skip writing, we leave gaps.
                                     // Instanced draw uses 'count'.
                                     // If we counted them, we told GL to draw 'nMain' instances.
                                     // If we skip writing, we have uninitialized data.
                                     // BETTER: Don't skip. Or write degenerate instances (alpha 0).
                                     // Writing degenerate instances is safer.
                                     
                                     // Actually, my 'nMain' count logic in Pass 1 was strict:
                                     // if (decay >= 2) nMain += 2;
                                     // In Pass 2:
                                     // if (decay >= 2) ... check ghostAlpha.
                                     // ghostAlpha depends on prog.
                                     // If ghostAlpha <= 0.01, we skip.
                                     // So counts might mismatch!
                                     // FIX: Write zero-alpha instances if ghostAlpha is too low, or match Pass 1 logic exactly.
                                     // Pass 1 didn't check ghostAlpha.
                                     // So I should just write them. The shader will discard if alpha is low or I can set alpha 0.
                                     
                                     if (ghostAlpha <= 0.01) {
                                         // Write dummy
                                         this.instanceData[ptrMain++] = px; this.instanceData[ptrMain++] = py; this.instanceData[ptrMain++] = charIdx;
                                         this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0;
                                         this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0;
                                         
                                         this.instanceData[ptrMain++] = px; this.instanceData[ptrMain++] = py; this.instanceData[ptrMain++] = charIdx;
                                         this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0;
                                         this.instanceData[ptrMain++] = 0; this.instanceData[ptrMain++] = 0;
                                     }
                                 }
                            }
                        }
                    }
                }
                
                // 2. OVERLAP
                if (s.overlapEnabled && grid.overlapChars) {
                    const ovCode = grid.overlapChars[i];
                    if (ovCode > 0 && gridAlpha > 0.05) {
                         const overlapTarget = s.overlapTarget || 'stream';
                         let allowOverlap = true;
                         if (overlapTarget === 'stream' && type !== C_TRACER && type !== C_ROTATOR) allowOverlap = false;
                         if (style && style.isEffect) allowOverlap = false; 

                         if (allowOverlap) {
                             const ovChar = String.fromCharCode(ovCode);
                             const ovSprite = atlas.get(ovChar);
                             if (ovSprite) {
                                const col = Math.round(ovSprite.x / atlas.cellSize);
                                const row = Math.round(ovSprite.y / atlas.cellSize);
                                const charIdx = (row * atlas._lastCols) + col;

                                this.instanceData[ptrOverlap++] = px;
                                this.instanceData[ptrOverlap++] = py;
                                this.instanceData[ptrOverlap++] = charIdx;
                                this.instanceData[ptrOverlap++] = overlapColor[0];
                                this.instanceData[ptrOverlap++] = overlapColor[1];
                                this.instanceData[ptrOverlap++] = overlapColor[2];
                                this.instanceData[ptrOverlap++] = gridAlpha; 
                                this.instanceData[ptrOverlap++] = drawScale; 
                             }
                         }
                    }
                }

                // 3. TRACER
                if (tState.phase !== 'none' && tState.alpha > 0.01) {
                     const charStr = String.fromCharCode(charCode);
                     const sprite = atlas.get(charStr);
                     if (sprite) {
                         const col = Math.round(sprite.x / atlas.cellSize);
                         const row = Math.round(sprite.y / atlas.cellSize);
                         const charIdx = (row * atlas._lastCols) + col;

                         this.instanceData[ptrTracer++] = px;
                         this.instanceData[ptrTracer++] = py;
                         this.instanceData[ptrTracer++] = charIdx;
                         this.instanceData[ptrTracer++] = tracerColor[0];
                         this.instanceData[ptrTracer++] = tracerColor[1];
                         this.instanceData[ptrTracer++] = tracerColor[2];
                         this.instanceData[ptrTracer++] = tState.alpha;
                         this.instanceData[ptrTracer++] = 1.0 + (s.tracerSizeIncrease / s.fontSize); 
                     }
                }
            }

            const totalFloats = ptrTracer; 

            // --- DRAW CALLS FOR THIS FONT ---
            if (totalFloats > 0) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
                // Safe upload for WebGL 1/2
                this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, totalFloats));

                this.gl.useProgram(this.program);
                const locRes = this.gl.getUniformLocation(this.program, 'u_resolution');
                const locAtlasSize = this.gl.getUniformLocation(this.program, 'u_atlasSize');
                const locCellSize = this.gl.getUniformLocation(this.program, 'u_cellSize');
                const locCols = this.gl.getUniformLocation(this.program, 'u_cols');
                const locMirror = this.gl.getUniformLocation(this.program, 'u_mirror');
                const locStretch = this.gl.getUniformLocation(this.program, 'u_stretch');
                
                this.gl.uniform2f(locRes, this.w, this.h);
                this.gl.uniform2f(locAtlasSize, atlas.canvas.width, atlas.canvas.height);
                this.gl.uniform1f(locCellSize, atlas.cellSize);
                this.gl.uniform1f(locCols, atlas._lastCols);
                this.gl.uniform1f(locMirror, s.mirrorEnabled ? -1.0 : 1.0);
                this.gl.uniform2f(locStretch, s.stretchX, s.stretchY);
                this.gl.uniform1i(this.gl.getUniformLocation(this.program, 'u_texture'), 0);

                this.gl.bindVertexArray(this.vao);

                if (nMain > 0) {
                    this._bindInstanceAttributes(0);
                    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, nMain);
                }

                if (nOverlap > 0) {
                    this._bindInstanceAttributes(nMain * 32); 
                    this.gl.blendFunc(this.gl.DST_ALPHA, this.gl.ZERO);
                    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, nOverlap);
                }

                if (nTracer > 0) {
                     this._bindInstanceAttributes((nMain + nOverlap) * 32);
                     this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                     this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, nTracer);
                }
                
                this.gl.bindVertexArray(null); 
            }
        } // End Font Loop

        // 2. Composite to Screen
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
            this._runBlur(this.texA, true, s.bloomStrength, this.fboWidth, this.fboHeight); 

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 
            this._runBlur(this.texB, false, s.bloomStrength, this.bloomWidth, this.bloomHeight);
        }

        // Post Processor
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