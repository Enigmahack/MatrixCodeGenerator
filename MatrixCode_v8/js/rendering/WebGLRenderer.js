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
        this.texA = null; 
        this.texB = null; 
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

        const matrixVS = `${version}
            layout(location=0) ${attribute} vec2 a_position;
            layout(location=1) ${attribute} vec2 a_offset;
            layout(location=2) ${attribute} float a_charIdx;
            layout(location=3) ${attribute} vec4 a_color;
            layout(location=4) ${attribute} float a_scale;

            uniform vec2 u_resolution;
            uniform vec2 u_atlasSize;
            uniform float u_cellSize;
            uniform float u_cols;
            uniform float u_mirror;
            uniform vec2 u_stretch;

            ${varying} vec2 v_uv;
            ${varying} vec4 v_color;
            ${varying} float v_isSolid;

            void main() {
                vec2 centerPos = (a_position - 0.5) * u_cellSize * a_scale;
                vec2 stretchedPos = (a_offset + centerPos) * u_stretch;
                if (u_mirror < 0.0) stretchedPos.x = u_resolution.x - stretchedPos.x;
                vec2 clip = (stretchedPos / u_resolution) * 2.0 - 1.0;
                clip.y = -clip.y; 
                gl_Position = vec4(clip, 0.0, 1.0);

                v_color = a_color;
                if (a_charIdx < -0.5) {
                    v_isSolid = 1.0; v_uv = vec2(0.0);
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
                attribute vec2 a_position; attribute vec2 a_offset; attribute float a_charIdx; attribute vec4 a_color; attribute float a_scale;
                uniform vec2 u_resolution; uniform vec2 u_atlasSize; uniform float u_cellSize; uniform float u_cols; uniform float u_mirror; uniform vec2 u_stretch;
                varying vec2 v_uv; varying vec4 v_color; varying float v_isSolid;
                void main() {
                    vec2 centerPos = (a_position - 0.5) * u_cellSize * a_scale;
                    vec2 stretchedPos = (a_offset + centerPos) * u_stretch;
                    if (u_mirror < 0.0) { stretchedPos.x = u_resolution.x - stretchedPos.x; }
                    vec2 clip = (stretchedPos / u_resolution) * 2.0 - 1.0; clip.y = -clip.y;
                    gl_Position = vec4(clip, 0.0, 1.0);
                    v_color = a_color;
                    if (a_charIdx < -0.5) { v_isSolid = 1.0; v_uv = vec2(0.0); } else { v_isSolid = 0.0; float row = floor(a_charIdx / u_cols); float col = mod(a_charIdx, u_cols); vec2 uvBase = vec2(col, row) * u_cellSize; vec2 uvPixel = uvBase + (a_position * u_cellSize); v_uv = uvPixel / u_atlasSize; }
                }
             `;
        }

        const matrixFS = `${version}
            precision mediump float;
            ${varyingIn} vec2 v_uv; ${varyingIn} vec4 v_color; ${varyingIn} float v_isSolid;
            uniform sampler2D u_texture;
            ${outColor}
            void main() {
                if (v_isSolid > 0.5) { ${setFragColor} = v_color; } 
                else { vec4 tex = ${texture2D}(u_texture, v_uv); if (tex.a < 0.1) discard; ${setFragColor} = vec4(v_color.rgb, v_color.a * tex.a); }
            }
        `;

        this.program = this._createProgram(finalMatrixVS, matrixFS);

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
    }

    _initBloomBuffers() {
        this.fboA = this.gl.createFramebuffer(); this.texA = this.gl.createTexture();
        this.fboB = this.gl.createFramebuffer(); this.texB = this.gl.createTexture();
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
        const scale = s.resolution;
        this.handleAppearanceChange();
        this.w = window.innerWidth;
        this.h = window.innerHeight;
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
            }
        }
        if (this.postProcessor) { this.postProcessor.resize(pw, ph); this.postProcessor.canvas.style.width = `${this.w}px`; this.postProcessor.canvas.style.height = `${this.h}px`; }

        // Buffer resize
        const totalCells = this.grid.cols * this.grid.rows;
        const capacity = totalCells * 6; // Safety margin for layers
        if (capacity > this.instanceCapacity) {
            this.instanceCapacity = capacity;
            this.instanceData = new Float32Array(capacity * 8);
            if (this.instanceBuffer) this.gl.deleteBuffer(this.instanceBuffer);
            this.instanceBuffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
            this._setupVAO();
        }
    }

    _setupVAO() {
        if (this.vao) this.gl.deleteVertexArray(this.vao);
        this.vao = this.gl.createVertexArray();
        this.gl.bindVertexArray(this.vao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        const stride = 32;
        this.gl.enableVertexAttribArray(1); this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, 0); this.gl.vertexAttribDivisor(1, 1);
        this.gl.enableVertexAttribArray(2); this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, 8); this.gl.vertexAttribDivisor(2, 1);
        this.gl.enableVertexAttribArray(3); this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, 12); this.gl.vertexAttribDivisor(3, 1);
        this.gl.enableVertexAttribArray(4); this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, stride, 28); this.gl.vertexAttribDivisor(4, 1);
        this.gl.bindVertexArray(null);
    }

    _bindInstanceAttributes(offset) {
        const stride = 32;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
        
        this.gl.enableVertexAttribArray(1); 
        this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride, offset);
        this.gl.vertexAttribDivisor(1, 1);

        this.gl.enableVertexAttribArray(2); 
        this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, offset + 8);
        this.gl.vertexAttribDivisor(2, 1);

        this.gl.enableVertexAttribArray(3); 
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, stride, offset + 12);
        this.gl.vertexAttribDivisor(3, 1);

        this.gl.enableVertexAttribArray(4); 
        this.gl.vertexAttribPointer(4, 1, this.gl.FLOAT, false, stride, offset + 28);
        this.gl.vertexAttribDivisor(4, 1);
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
        if (!this.instanceData || this.fboWidth === 0) return; 
        
        const { state: s, derived: d } = this.config;
        const grid = this.grid;
        const activeFonts = d.activeFonts;
        
        // --- PRE-CALCULATION & ATLAS UPDATES ---
        for (const font of activeFonts) {
            let atlas = this.glyphAtlases.get(font.name);
            if (!atlas) {
                atlas = new GlyphAtlas(this.config, font.name, font.chars);
                this.glyphAtlases.set(font.name, atlas);
            } else {
                atlas.fontName = font.name; atlas.customChars = font.chars;
            }
            if (this.needsAtlasUpdate || atlas.needsUpdate) atlas.update();

            // Ensure WebGL Texture Exists
            if (!atlas.glTexture) {
                atlas.glTexture = this.gl.createTexture();
                this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
                this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
                // Initial Upload
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
                atlas.resetChanges();
            } else if (atlas.hasChanges) {
                this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas.canvas);
                atlas.resetChanges();
            }
        }
        this.needsAtlasUpdate = false;

        // --- OPTIMIZED BUCKETING (Single Pass) ---
        const totalCells = grid.cols * grid.rows;
        const numFonts = activeFonts.length;
        
        // 1. Initialize Buckets
        const counts = new Uint32Array(numFonts);
        // Pass 1: Count instances per font
        for (let i = 0; i < totalCells; i++) {
            const overrideActive = grid.overrideActive[i];
            
            if (overrideActive) {
                // Override Layer (CHAR or SOLID)
                if (overrideActive === 2) { // SOLID
                    // Solid counts to Bucket 0 (any valid bucket works for Solid, but we pick 0)
                    if (numFonts > 0) counts[0]++;
                } else { // CHAR
                    const fIdx = grid.overrideFontIndices[i];
                    if (fIdx < numFonts && grid.overrideChars[i] > 0 && grid.overrideAlphas[i] > 0.01) {
                        if (this.glyphAtlases.has(activeFonts[fIdx].name)) {
                            counts[fIdx]++;
                            if (grid.overrideGlows[i] > 0) counts[fIdx]++; 
                        }
                    }
                }
            } else {
                // Standard Layer
                if (grid.state[i] === 0) continue;
                const alpha = grid.alphas[i];
                if (alpha <= 0.01) continue;

                const fIdx = grid.fontIndices[i];
                if (fIdx < numFonts) {
                    if (this.glyphAtlases.has(activeFonts[fIdx].name)) {
                        counts[fIdx]++;
                        if (grid.glows[i] > 0) counts[fIdx]++;
                    }
                }

                // Rotator Target
                const mix = grid.mix[i];
                if (mix > 0.01) {
                    if (fIdx < numFonts) {
                         if (this.glyphAtlases.has(activeFonts[fIdx].name)) counts[fIdx]++;
                    }
                }

                // Overlap
                if (grid.renderMode[i] === 1) { 
                    const sFIdx = grid.secondaryFontIndices[i];
                    if (sFIdx < numFonts && grid.secondaryChars[i] > 0) {
                        if (this.glyphAtlases.has(activeFonts[sFIdx].name)) {
                            counts[sFIdx]++;
                            if (grid.secondaryGlows[i] > 0) counts[sFIdx]++;
                        }
                    }
                }
            }
        }

        // 2. Calculate Offsets
        const offsets = new Uint32Array(numFonts);
        const currentOffsets = new Uint32Array(numFonts);
        let accumulated = 0;
        for (let f = 0; f < numFonts; f++) {
            offsets[f] = accumulated;
            currentOffsets[f] = accumulated;
            accumulated += counts[f] * 8; 
        }
        
        const cw = d.cellWidth; const ch = d.cellHeight;
        const xOff = s.fontOffsetX; const yOff = s.fontOffsetY;
        const dissolveEnabled = s.dissolveEnabled;
        const dissolveMin = s.dissolveMinSize / s.fontSize;
        const decayDur = s.decayFadeDurationFrames;

        // PASS 2: Write
        for (let i = 0; i < totalCells; i++) {
            const overrideActive = grid.overrideActive[i];
            const px = (i % grid.cols) * cw + cw * 0.5 + xOff;
            const py = Math.floor(i / grid.cols) * ch + ch * 0.5 + yOff;

            let scale = 1.0;
            if (!overrideActive && dissolveEnabled) {
                const decay = grid.decays[i];
                if (decay >= 2) {
                    const prog = (decay - 2) / decayDur;
                    scale = Math.max(0.1, 1.0 - (prog * (1.0 - dissolveMin)));
                }
            }

            const write = (fIdx, cCode, cR, cG, cB, cA, cScale, cGlow, cAtlas) => {
                if (fIdx >= numFonts) return; 
                
                let ptr = currentOffsets[fIdx];
                const charStr = String.fromCharCode(cCode);
                const sprite = cAtlas.get(charStr);
                
                if (sprite) {
                    const col = Math.round(sprite.x / cAtlas.cellSize);
                    const row = Math.round(sprite.y / cAtlas.cellSize);
                    const charIdx = (row * cAtlas._lastCols) + col;
                    
                    if (cGlow > 0) {
                        const glowScale = cScale + (Math.min(5, cGlow) / s.fontSize);
                        this.instanceData[ptr++] = px; this.instanceData[ptr++] = py;
                        this.instanceData[ptr++] = charIdx;
                        this.instanceData[ptr++] = cR; this.instanceData[ptr++] = cG; this.instanceData[ptr++] = cB;
                        this.instanceData[ptr++] = cA * 0.4;
                        this.instanceData[ptr++] = glowScale;
                    }

                    this.instanceData[ptr++] = px; this.instanceData[ptr++] = py;
                    this.instanceData[ptr++] = charIdx;
                    this.instanceData[ptr++] = cR; this.instanceData[ptr++] = cG; this.instanceData[ptr++] = cB;
                    this.instanceData[ptr++] = cA;
                    this.instanceData[ptr++] = cScale;
                } else {
                    if (cGlow > 0) {
                        this.instanceData[ptr++] = px; this.instanceData[ptr++] = py; this.instanceData[ptr++] = -1;
                        this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0;
                        this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0;
                    }
                    this.instanceData[ptr++] = px; this.instanceData[ptr++] = py; this.instanceData[ptr++] = -1;
                    this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0;
                    this.instanceData[ptr++] = 0; this.instanceData[ptr++] = 0;
                }
                
                currentOffsets[fIdx] = ptr;
            };
            
            const writeSolid = (fIdx, cR, cG, cB, cA) => {
                if (fIdx >= numFonts) return;
                let ptr = currentOffsets[fIdx];
                this.instanceData[ptr++] = px; this.instanceData[ptr++] = py;
                this.instanceData[ptr++] = -1; // Solid
                this.instanceData[ptr++] = cR; this.instanceData[ptr++] = cG; this.instanceData[ptr++] = cB;
                this.instanceData[ptr++] = cA;
                this.instanceData[ptr++] = 1.1; // Scale > 1 for full cover
                currentOffsets[fIdx] = ptr;
            }

            if (overrideActive) {
                if (overrideActive === 2) { // SOLID
                    if (numFonts > 0) {
                        const colorInt = grid.overrideColors[i];
                        const r = (colorInt & 0xFF) / 255;
                        const g = ((colorInt >> 8) & 0xFF) / 255;
                        const b = ((colorInt >> 16) & 0xFF) / 255;
                        const alpha = grid.overrideAlphas[i];
                        writeSolid(0, r, g, b, alpha);
                    }
                } else { // CHAR
                    const fIdx = grid.overrideFontIndices[i];
                    const charCode = grid.overrideChars[i];
                    const alpha = grid.overrideAlphas[i];
                    
                    if (charCode > 0 && alpha > 0.01 && fIdx < numFonts) {
                        const colorInt = grid.overrideColors[i];
                        const r = (colorInt & 0xFF) / 255;
                        const g = ((colorInt >> 8) & 0xFF) / 255;
                        const b = ((colorInt >> 16) & 0xFF) / 255;
                        
                        const atlas = this.glyphAtlases.get(activeFonts[fIdx]?.name);
                        if (atlas) write(fIdx, charCode, r, g, b, alpha, scale, grid.overrideGlows[i], atlas);
                    }
                }
            } else {
                if (grid.state[i] === 0) continue;
                const alpha = grid.alphas[i];
                if (alpha <= 0.01) continue;

                const fIdx = grid.fontIndices[i];
                const atlas = this.glyphAtlases.get(activeFonts[fIdx]?.name);
                
                if (atlas) {
                    const colorInt = grid.colors[i];
                    const r = (colorInt & 0xFF) / 255;
                    const g = ((colorInt >> 8) & 0xFF) / 255;
                    const b = ((colorInt >> 16) & 0xFF) / 255;
                    
                    const mix = grid.mix[i];
                    const primAlpha = alpha * (1.0 - mix);
                    
                    write(fIdx, grid.chars[i], r, g, b, primAlpha, scale, grid.glows[i], atlas);
                    
                    if (mix > 0.01) {
                        const nextChar = grid.getRotatorTarget(i, false);
                        const cCode = (nextChar && typeof nextChar === 'string') ? nextChar.charCodeAt(0) : (nextChar || 0);
                        write(fIdx, cCode, r, g, b, alpha * mix, scale, grid.glows[i], atlas);
                    }
                }

                if (grid.renderMode[i] === 1) {
                    const sFIdx = grid.secondaryFontIndices[i];
                    const sAtlas = this.glyphAtlases.get(activeFonts[sFIdx]?.name);
                    if (sAtlas && grid.secondaryChars[i] > 0) {
                        const sColor = grid.secondaryColors[i];
                        const sr = (sColor & 0xFF) / 255;
                        const sg = ((sColor >> 8) & 0xFF) / 255;
                        const sb = ((sColor >> 16) & 0xFF) / 255;
                        write(sFIdx, grid.secondaryChars[i], sr, sg, sb, alpha, scale, grid.secondaryGlows[i], sAtlas);
                    }
                }
            }
        }

        // --- DRAW ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA);
        this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        if (this.colorProgram) {
            this.gl.useProgram(this.colorProgram);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
            this.gl.enableVertexAttribArray(0); this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
            this.gl.uniform4f(this.gl.getUniformLocation(this.colorProgram, 'u_color'), 0, 0, 0, s.clearAlpha);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        }

        if (accumulated > 0) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
            this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, accumulated));

            this.gl.useProgram(this.program);
            const locRes = this.gl.getUniformLocation(this.program, 'u_resolution');
            const locAtlasSize = this.gl.getUniformLocation(this.program, 'u_atlasSize');
            const locCellSize = this.gl.getUniformLocation(this.program, 'u_cellSize');
            const locCols = this.gl.getUniformLocation(this.program, 'u_cols');
            const locMirror = this.gl.getUniformLocation(this.program, 'u_mirror');
            const locStretch = this.gl.getUniformLocation(this.program, 'u_stretch');
            
            this.gl.uniform2f(locRes, this.w, this.h);
            this.gl.uniform1f(locMirror, s.mirrorEnabled ? -1.0 : 1.0);
            this.gl.uniform2f(locStretch, s.stretchX, s.stretchY);
            this.gl.uniform1i(this.gl.getUniformLocation(this.program, 'u_texture'), 0);

            this.gl.bindVertexArray(this.vao);

            for (let f = 0; f < numFonts; f++) {
                const count = counts[f];
                if (count === 0) continue;
                
                const atlas = this.glyphAtlases.get(activeFonts[f].name);
                if (!atlas || !atlas.glTexture) continue;

                this.gl.activeTexture(this.gl.TEXTURE0);
                this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
                
                this.gl.uniform2f(locAtlasSize, atlas.canvas.width, atlas.canvas.height);
                this.gl.uniform1f(locCellSize, atlas.cellSize);
                this.gl.uniform1f(locCols, atlas._lastCols);

                const byteOffset = offsets[f] * 4;
                this._bindInstanceAttributes(byteOffset);
                
                this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, count);
            }
            
            this.gl.bindVertexArray(null);
        }

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
            this._runBlur(this.texA, true, s.bloomStrength * 2.5, this.fboWidth, this.fboHeight); 

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 
            this._runBlur(this.texB, false, s.bloomStrength * 2.5, this.bloomWidth, this.bloomHeight, s.bloomOpacity);
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