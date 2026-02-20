// =========================================================================
// WEBGL RENDERER
// =========================================================================

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
        this.instanceData = null; 
        this.instanceBuffer = null;
        this.depthBuffer = null; // New Depth Buffer

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

        this._initGlimmerTexture(); // Generate Optimization Texture
        this._initShaders();
        this._initBuffers();
        this._initBloomBuffers();
        this._initLineGfxBuffers();
        console.log("Rendering Engine: WebGL 2 (v8 CellGrid Optimized Fixed)");

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
            this.lastEffectSource = null;
        }
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
            // --- SHADOW MASK SHADER ---
            const shadowVS = `#version 300 es
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
                precision mediump float;
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
                    v_uv = a_quad;
                    gl_Position = vec4(a_quad * 2.0 - 1.0, 0.0, 1.0);
                }
            `;

            const lineFS = `#version 300 es
                precision highp float;
                in vec2 v_uv;
                uniform sampler2D u_characterBuffer;
                uniform sampler2D u_persistenceBuffer;
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
                uniform ivec3 u_layerOrder; 
                
                uniform float u_thickness;
                uniform vec3 u_color;
                uniform vec3 u_fadeColor;
                uniform float u_intensity;
                uniform float u_glow;
                uniform float u_saturation;
                uniform float u_brightness;
                uniform float u_additiveStrength;
                uniform float u_sharpness;
                uniform float u_glowFalloff;
                uniform float u_roundness;
                uniform float u_maskSoftness;
                uniform float u_persistence;
                uniform bool u_showInterior;
                
                out vec4 fragColor;

                vec3 getOccupancy(vec2 pos) {
                    if (pos.x < 0.0 || pos.x >= u_logicGridSize.x || pos.y < 0.0 || pos.y >= u_logicGridSize.y) return vec3(0.0);
                    return texture(u_logicGrid, (pos + 0.5) / u_logicGridSize).rgb;
                }

                float getLayerVal(vec3 occ, int layerIdx) {
                    if (layerIdx == 0) return occ.r;
                    if (layerIdx == 1) return occ.g;
                    if (layerIdx == 2) return occ.b;
                    return 0.0;
                }

                vec3 boostSaturation(vec3 c, float s) {
                    float luma = dot(c, vec3(0.299, 0.587, 0.114));
                    return mix(vec4(luma).rgb, c, s);
                }

                void main() {
                    if (u_mode == 2) {
                        // Render Shadow Mask (Inside areas) - GPU Accelerated
                        vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution - u_offset;
                        vec2 gridPos = (screenPos - u_screenOrigin) / u_screenStep;
                        vec2 logicPos = gridPos / u_cellPitch + u_blockOffset - u_userBlockOffset;
                        vec2 blockCoord = floor(logicPos);
                        
                        vec3 occ = getOccupancy(blockCoord);
                        float mask = 0.0;
                        for(int i=0; i<3; i++) {
                            mask = max(mask, getLayerVal(occ, u_layerOrder[i]));
                        }
                        fragColor = vec4(0.0, 0.0, 0.0, mask);
                        return;
                    }

                    if (u_mode == 1) {
                        vec4 base = texture(u_characterBuffer, v_uv);
                        float persist = texture(u_persistenceBuffer, v_uv).r;
                        
                        // Sample Source Grid for illumination points
                        vec2 sourceUV = v_uv + ((u_sourceGridOffset + u_sampleOffset) / u_resolution);
                        
                        // Soft Sampling for character mask
                        float charLuma = 0.0;
                        if (u_maskSoftness > 0.0) {
                            float s = u_maskSoftness / u_resolution.x;
                            charLuma += texture(u_sourceGrid, sourceUV).r;
                            charLuma += texture(u_sourceGrid, sourceUV + vec2(s, 0.0)).r;
                            charLuma += texture(u_sourceGrid, sourceUV + vec2(-s, 0.0)).r;
                            charLuma += texture(u_sourceGrid, sourceUV + vec2(0.0, s)).r;
                            charLuma += texture(u_sourceGrid, sourceUV + vec2(0.0, -s)).r;
                            charLuma /= 5.0;
                        } else {
                            vec4 sourceChar = texture(u_sourceGrid, sourceUV);
                            charLuma = max(sourceChar.r, max(sourceChar.g, sourceChar.b));
                        }
                        
                        // Calculate Dynamic Color based on normalized persistence (0..1)
                        float colorT = clamp(persist, 0.0, 1.0);
                        
                        // Line Roundness affects color transition dynamics
                        float profileT = pow(colorT, mix(1.0, 3.0, u_roundness));
                        vec3 dynamicColor = mix(u_fadeColor, u_color, profileT);
                        
                        // Add a "hot core" boost if roundness is high
                        dynamicColor = mix(dynamicColor, vec3(1.0), pow(colorT, 8.0) * u_roundness * 0.5);
                        
                        // Apply Saturation and Brightness to the highlight color
                        dynamicColor = boostSaturation(dynamicColor, u_saturation);
                        dynamicColor *= u_brightness;
                        
                        // Additive highlight based on Source Grid characters
                        vec3 highlight = dynamicColor * persist * charLuma * u_additiveStrength * u_intensity;
                        
                        fragColor = vec4(base.rgb + highlight, base.a);
                        return;
                    }

                    // GENERATE MODE (u_mode == 0)
                    // Standardize to 0=Top coordinate system
                    vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution - u_offset;
                    vec2 gridPos = (screenPos - u_screenOrigin) / u_screenStep;
                    vec2 logicPos = gridPos / u_cellPitch + u_blockOffset - u_userBlockOffset;
                    
                    vec2 blockCoord = floor(logicPos);
                    vec2 cellLocal = fract(logicPos);
                    
                    vec3 centerOcc = getOccupancy(blockCoord);
                    // In 0=Top, +1 is Below, -1 is Above
                    vec3 leftOcc = getOccupancy(blockCoord + vec2(-1.0, 0.0));
                    vec3 rightOcc = getOccupancy(blockCoord + vec2(1.0, 0.0));
                    vec3 aboveOcc = getOccupancy(blockCoord + vec2(0.0, -1.0));
                    vec3 belowOcc = getOccupancy(blockCoord + vec2(0.0, 1.0));

                    float total = 0.0;
                    float halfThick = (u_thickness / 10.0) * 0.5;

                    // UNION ALPHA approach for Perimeter-only mode
                    float unionC = 0.0;
                    float unionN = 0.0;
                    float unionS = 0.0;
                    float unionW = 0.0;
                    float unionE = 0.0;

                    if (!u_showInterior) {
                        for (int i = 0; i < 3; i++) {
                            int L = u_layerOrder[i];
                            unionC = max(unionC, getLayerVal(centerOcc, L));
                            unionN = max(unionN, getLayerVal(aboveOcc, L));
                            unionS = max(unionS, getLayerVal(belowOcc, L));
                            unionW = max(unionW, getLayerVal(leftOcc, L));
                            unionE = max(unionE, getLayerVal(rightOcc, L));
                        }

                        // Binary Presence Check: only an edge if one side is occupied and the other is not.
                        // This prevents internal flashes when a block is added adjacent to an existing one.
                        bool isEdgeN = (unionC > 0.01) != (unionN > 0.01);
                        bool isEdgeS = (unionC > 0.01) != (unionS > 0.01);
                        bool isEdgeW = (unionC > 0.01) != (unionW > 0.01);
                        bool isEdgeE = (unionC > 0.01) != (unionE > 0.01);

                        if (isEdgeN || isEdgeS || isEdgeW || isEdgeE) {
                            float layerDist = 1e10;
                            float edgeW = 0.0;
                            // Line intensity follows the alpha of whichever cell is currently fading
                            if (isEdgeW) { layerDist = min(layerDist, cellLocal.x * u_cellPitch.x); edgeW = max(edgeW, max(unionC, unionW)); }
                            if (isEdgeE) { layerDist = min(layerDist, (1.0 - cellLocal.x) * u_cellPitch.x); edgeW = max(edgeW, max(unionC, unionE)); }
                            if (isEdgeN) { layerDist = min(layerDist, cellLocal.y * u_cellPitch.y); edgeW = max(edgeW, max(unionC, unionN)); }
                            if (isEdgeS) { layerDist = min(layerDist, (1.0 - cellLocal.y) * u_cellPitch.y); edgeW = max(edgeW, max(unionC, unionS)); }

                            float line = 1.0 - smoothstep(halfThick - u_sharpness, halfThick + u_sharpness, layerDist);
                            if (u_roundness > 0.0 && halfThick > 0.0) {
                                float normalizedDist = clamp(layerDist / halfThick, 0.0, 1.0);
                                line *= mix(1.0, sqrt(1.0 - normalizedDist * normalizedDist), u_roundness);
                            }
                            float glow = exp(-layerDist * u_glowFalloff) * (u_glow * 0.5);
                            total = max(line, glow) * edgeW;
                        }
                    } else {
                        for (int i = 0; i < 3; i++) {
                            int L = u_layerOrder[i];
                            float cL = getLayerVal(centerOcc, L);
                            
                            float nN = getLayerVal(aboveOcc, L);
                            float nS = getLayerVal(belowOcc, L);
                            float nW = getLayerVal(leftOcc, L);
                            float nE = getLayerVal(rightOcc, L);

                            bool isEdgeN = (cL > 0.01 || nN > 0.01) && (abs(cL - nN) > 0.01);
                            bool isEdgeS = (cL > 0.01 || nS > 0.01) && (abs(cL - nS) > 0.01);
                            bool isEdgeW = (cL > 0.01 || nW > 0.01) && (abs(cL - nW) > 0.01);
                            bool isEdgeE = (cL > 0.01 || nE > 0.01) && (abs(cL - nE) > 0.01);

                            if (isEdgeN || isEdgeS || isEdgeW || isEdgeE) {
                                float layerDist = 1e10;
                                float edgeW = 0.0;
                                if (isEdgeW) { layerDist = min(layerDist, cellLocal.x * u_cellPitch.x); edgeW = max(edgeW, abs(cL - nW)); }
                                if (isEdgeE) { layerDist = min(layerDist, (1.0 - cellLocal.x) * u_cellPitch.x); edgeW = max(edgeW, abs(cL - nE)); }
                                if (isEdgeN) { layerDist = min(layerDist, cellLocal.y * u_cellPitch.y); edgeW = max(edgeW, abs(cL - nN)); }
                                if (isEdgeS) { layerDist = min(layerDist, (1.0 - cellLocal.y) * u_cellPitch.y); edgeW = max(edgeW, abs(cL - nS)); }

                                int obs = 0;
                                for (int m = 0; m < i; m++) {
                                    int M = u_layerOrder[m];
                                    if (getLayerVal(centerOcc, M) > 0.5) obs++;
                                }

                                float op = (obs < 2) ? 1.0 : (obs == 2) ? 0.3 : 0.0;
                                if (obs == 2) {
                                    // 3rd layer dim rule: North/South faces only (H-lines)
                                    if (!isEdgeN && !isEdgeS) op = 0.0;
                                }

                                if (op > 0.0) {
                                    float line = 1.0 - smoothstep(halfThick - u_sharpness, halfThick + u_sharpness, layerDist);
                                    if (u_roundness > 0.0 && halfThick > 0.0) {
                                        float normalizedDist = clamp(layerDist / halfThick, 0.0, 1.0);
                                        line *= mix(1.0, sqrt(1.0 - normalizedDist * normalizedDist), u_roundness);
                                    }
                                    float glow = exp(-layerDist * u_glowFalloff) * (u_glow * 0.5);
                                    total = max(total, max(line, glow) * op * edgeW);
                                }
                            }
                        }
                    }

                    // Apply (1 - p) scaling here to prevent additive saturation
                    total *= (1.0 - u_persistence);
                    fragColor = vec4(total, 0.0, 0.0, 1.0);
                }
            `;
            this.lineProgram = this._createProgram(lineVS, lineFS);

            // --- MATRIX SHADERS (SPLIT 2D/3D) ---
            
            const matrixVS_Common = `#version 300 es
                precision mediump float;
                layout(location=0) in vec2 a_quad;
                layout(location=1) in vec2 a_pos;
                layout(location=2) in float a_charIdx;
                layout(location=3) in vec4 a_color;
                layout(location=4) in float a_alpha;
                layout(location=5) in float a_decay;
                layout(location=6) in float a_glow;
                layout(location=7) in float a_mix;
                layout(location=8) in float a_nextChar;
                layout(location=9) in vec3 a_depth;
                layout(location=10) in float a_maxDecay;
    
                out vec2 v_uv;
                out vec2 v_uv2;
                out vec4 v_color;
                out float v_mix;
                out float v_glow;
                out float v_prog;
                out vec2 v_screenUV;
                out vec2 v_cellPos;
                out vec2 v_cellUV;
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
                    // Decay Scale Logic
                    float scale = 1.0;
                    v_prog = 0.0;
                    v_cellUV = a_quad;
                    if (a_decay >= 2.0) {
                        float duration = (a_maxDecay > 0.0) ? a_maxDecay : u_decayDur;
                        v_prog = (a_decay - 2.0) / duration;
                        if (u_dissolveEnabled > 0.5) {
                            scale = mix(1.0, u_dissolveScale, v_prog);
                        } else {
                            scale = 1.0;
                        }
                    }
                    
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
                    float row = floor(cIdx / u_cols);
                    float col = mod(cIdx, u_cols);
                    vec2 uvBase = vec2(col, row) * u_cellSize;
                    v_uv = (uvBase + (a_quad * u_cellSize)) / u_atlasSize;
    
                    // UV 2
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
    

    
            // Optimized Fragment Shader (Shared)
            const matrixFS = `#version 300 es
                precision mediump float;
                in vec2 v_uv;
                in vec2 v_uv2;
                in vec4 v_color;
                in float v_mix;
                in float v_glow;
                in float v_prog;
                in vec2 v_screenUV;
                in vec2 v_cellPos;
                in vec2 v_cellUV;
                
                uniform sampler2D u_texture;
                uniform sampler2D u_shadowMask; 
                uniform sampler2D u_glimmerNoise; // <-- Optimization Texture
                
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
                uniform float u_glimmerFill; // Unused in optimized version (baked into texture density)
                uniform float u_glimmerIntensity;
                uniform float u_glimmerFlicker; // Controls spread of flicker
                
                // 0 = Base (Glyphs/Glow), 1 = Shadow
                uniform int u_passType;
                
                out vec4 fragColor;
    
                // Pseudo-random function
                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }
                
                vec2 random2(vec2 st) {
                    st = vec2( dot(st,vec2(127.1,311.7)),
                               dot(st,vec2(269.5,183.3)) );
                    return -1.0 + 2.0*fract(sin(st)*43758.5453123);
                }

                // Helper to apply all visual degradations (Dissolve + Ghosting) identically
                float getProcessedAlpha(vec2 uv) {
                    float a = texture(u_texture, uv).a;
                    float ghost1 = 0.0;
                    float ghost2 = 0.0;
    
                    // Trail Ghosting (Vertical Blur) - Sample first
                    if (u_deteriorationEnabled > 0.5 && v_prog > 0.0) {
                        float blurDist = (u_deteriorationStrength * v_prog) / u_atlasSize.y;
                        ghost1 = texture(u_texture, uv + vec2(0.0, blurDist)).a;
                        ghost2 = texture(u_texture, uv - vec2(0.0, blurDist)).a;
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
                    
                    // GLIMMER LOGIC (State 30.0 -> useMix 20.0)
                    float glimmer = 0.0;
                    if (useMix >= 19.5) {
                        float gOpacity = clamp(useMix - 20.0, 0.0, 1.0);
                        useMix = 0.0; // Reset
                        
                        float rawTex = texture(u_texture, v_uv).a;
                        if (rawTex > 0.3) {
                            // 1. Calculate Seed with Time Step (Pattern Switching)
                            // u_glimmerSpeed controls the frequency of pattern changes (Hz)
                            float switchFreq = max(0.01, u_glimmerSpeed);
                            float timeStep = floor(u_time * switchFreq);
                            
                            vec2 cellGridPos = v_cellPos;
                            
                            // Perturb seed with timeStep to switch patterns
                            vec2 seed = cellGridPos + vec2(timeStep * 37.0, timeStep * 11.0);
                            float cellRand = random(seed);

                            // 2. Determine Shape/Position
                            // "Lamp illuminating pattern from behind" - Shapes are geometric/tech
                            vec2 center = vec2(0.5);
                            vec2 sizeBounds = vec2(0.1, 0.1); // Default
                            float rotation = 0.0;
                            
                            // Probability Distribution (Refactored for Balance):
                            // 0.00 - 0.40: Vertical Bars (40%) -> High priority per user request
                            // 0.40 - 0.60: Horizontal Bars (20%)
                            // 0.60 - 0.70: Small Rects (10%)
                            // 0.70 - 1.00: Diagonals (30%) -> Split evenly 15% each
                            
                            if (cellRand < 0.20) {
                                // Vertical Left
                                center = vec2(0.2, 0.5);
                                sizeBounds = vec2(0.08, 0.45);
                            } else if (cellRand < 0.40) {
                                // Vertical Right
                                center = vec2(0.8, 0.5);
                                sizeBounds = vec2(0.08, 0.45);
                            } else if (cellRand < 0.47) {
                                // Horizontal Top
                                center = vec2(0.5, 0.8);
                                sizeBounds = vec2(0.45, 0.08);
                            } else if (cellRand < 0.54) {
                                // Horizontal Bottom
                                center = vec2(0.5, 0.2);
                                sizeBounds = vec2(0.45, 0.08);
                            } else if (cellRand < 0.60) {
                                // Horizontal Middle
                                center = vec2(0.5, 0.5);
                                sizeBounds = vec2(0.45, 0.06);
                            } else if (cellRand < 0.70) {
                                // Small Rect Center
                                center = vec2(0.5, 0.5);
                                sizeBounds = vec2(0.15, 0.15);
                            } else if (cellRand < 0.85) {
                                // Diagonal 1: Bottom-Left to Top-Right (/)
                                // Rotation +45 deg aligns local X with diagonal
                                rotation = 0.785398; 
                                sizeBounds = vec2(0.05, 0.55); 
                            } else {
                                // Diagonal 2: Top-Left to Bottom-Right (\)
                                // Rotation -45 deg
                                rotation = -0.785398; 
                                sizeBounds = vec2(0.05, 0.55);
                            }

                            // 3. Sample Noise Texture (Luminosity Modulator)
                            // Remove continuous scrolling. Pattern is static per timeStep.
                            
                            // Map Cell Position to Texture Space
                            vec2 noiseUV = vec2(cellGridPos.x / 64.0, cellGridPos.y / 64.0);
                            // Apply random offset based on seed
                            noiseUV += vec2(cellRand * 123.0, cellRand * 456.0);

                            float activeVal = texture(u_glimmerNoise, noiseUV).r;
                            
                            // 4. Draw Shape (Geometry is Constant per Cell)
                            vec2 p = v_cellUV - center;
                            
                            // Apply Rotation if needed
                            if (rotation != 0.0) {
                                float s = sin(rotation);
                                float c = cos(rotation);
                                p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
                            }
                            
                            p = abs(p);
                            
                            float r = 0.01; // Sharp corners
                            float d = length(max(p - sizeBounds, 0.0)) + min(max(p.x - sizeBounds.x, p.y - sizeBounds.y), 0.0) - r;
                            
                            float core = 1.0 - smoothstep(-0.01, 0.01, d);
                            float halo = 1.0 - smoothstep(0.0, 0.15, d);
                            
                            float shape = core + (halo * 0.4);

                            // 5. Apply Luminosity & Flicker
                            // "Bad Connection / Fluorescent" Flicker
                            float flicker = 1.0;
                            
                            // Flicker Spread Control:
                            // u_glimmerFlicker determines probability of a cell being "faulty"
                            if (cellRand < u_glimmerFlicker) {
                                // 1. Primary Flicker Cycle (Variable speed per cell)
                                float cycleSpeed = 10.0 + (cellRand * 20.0);
                                float flickerBase = sin(u_time * cycleSpeed + (cellRand * 100.0));
                                
                                // 2. Hard Cutout (Thresholding)
                                // Occasional complete dropouts. If base wave is low, light cuts out.
                                float cutout = smoothstep(-0.4, -0.2, flickerBase);
                                
                                // 3. High Frequency Jitter (When ON)
                                // Simulates the electrical noise
                                float jitter = 0.7 + 0.6 * fract(sin(dot(vec2(u_time, cellRand), vec2(12.9898,78.233))) * 43758.5453);
                                
                                flicker = cutout * jitter;
                                
                                // 4. Long Random Dropouts (The "Dead Cell" Effect)
                                // Sample noise at a very slow speed
                                vec2 dropoutUV = vec2(cellGridPos.x / 13.0, (u_time * 0.5) + cellRand * 50.0);
                                float dropoutVal = texture(u_glimmerNoise, dropoutUV).r;
                                // 20% chance to be completely dead at any moment for flickering cells
                                if (dropoutVal < 0.2) {
                                    flicker = 0.0;
                                }
                            }
                            
                            // Combine: Shape * NoiseModulation * Flicker * Opacity
                            glimmer = shape * (0.4 + (0.6 * activeVal)) * flicker;
                            glimmer *= gOpacity;

                        }
                    }
    
                    if (useMix >= 4.0) {
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
                    // LAYER PRECEDENCE:
                    // 1. Background Code & Tracers -> Affect by Shadow
                    // 2. High Priority Effects (Lightning) -> Ignore Shadow (v_mix >= 10.0)
                    
                    if (!isHighPriority) {
                        baseColor.rgb *= (1.0 - shadow);
                    }
    
                    vec4 col = baseColor;
                    // Boost brightness for glow (Bloom trigger)
                    // Multiply by alpha to ensure it fades out with the character
                    if (v_glow > 0.0) {
                        // GLOW logic must also respect shadow for non-high-priority effects!
                        // If shadow is active, the baseColor is darkened.
                        // The GLOW should also be darkened/suppressed.
                        // Otherwise a black char will still emit light.
                        
                        float glowFactor = v_glow;
                        if (!isHighPriority) {
                            glowFactor *= (1.0 - shadow);
                        }
                        
                        col.rgb += (glowFactor * 0.3 * col.a);
                    }
    
                    // Base Alpha (Stream Fade)
                    float streamAlpha = col.a * finalAlpha;
    
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
    
                    fragColor = vec4(col.rgb, streamAlpha);
                }
            `;
            
            this.program2D = this._createProgram(matrixVS2D, matrixFS);
            this.program = this.program2D; // Default fallback
    
            // Keep existing Bloom/Color programs
            const bloomVS = `#version 300 es\nlayout(location=0) in vec2 a_position; out vec2 v_uv; void main(){ v_uv=a_position*0.5+0.5; gl_Position=vec4(a_position, 0.0, 1.0); }`;
            const bloomFS = `#version 300 es\nprecision mediump float; in vec2 v_uv; uniform sampler2D u_image; uniform bool u_horizontal; uniform float u_weight[5]; uniform float u_spread; uniform float u_opacity; out vec4 fragColor; void main(){ vec2 tex_offset=(1.0/vec2(textureSize(u_image, 0)))*u_spread; vec3 result=texture(u_image, v_uv).rgb*u_weight[0]; if(u_horizontal){ for(int i=1; i<5; ++i){ result+=texture(u_image, v_uv+vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; result+=texture(u_image, v_uv-vec2(tex_offset.x*float(i), 0.0)).rgb*u_weight[i]; } }else{ for(int i=1; i<5; ++i){ result+=texture(u_image, v_uv+vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; result+=texture(u_image, v_uv-vec2(0.0, tex_offset.y*float(i))).rgb*u_weight[i]; } } fragColor=vec4(result*u_opacity, 1.0); }`;
            this.bloomProgram = this._createProgram(bloomVS, bloomFS);
    
            const colorVS = `#version 300 es\nlayout(location=0) in vec2 a_position; void main(){ gl_Position=vec4(a_position, 0.0, 1.0); }`;
            const colorFS = `#version 300 es\nprecision mediump float; uniform vec4 u_color; out vec4 fragColor; void main(){ fragColor=u_color; }`;
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
        // Initial capacity: 1000 sheets * 20 bytes (x,y,w,h,a)
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowInstanceCapacity * 20, this.gl.DYNAMIC_DRAW);

        // Instance buffers will be created in resize()
        this.posBuffer = null;
        this.charBuffer = null;
        this.colorBuffer = null;
        this.alphaBuffer = null;
        this.decayBuffer = null;
        this.glowBuffer = null;
        this.mixBuffer = null;
        this.nextCharBuffer = null;
        this.maxDecayBuffer = null;
        
        // Mapped Arrays (CPU side)
        this.mappedChars = null;
        this.mappedNextChars = null;
    }

    _initBloomBuffers() {
        this.fboA = this.gl.createFramebuffer(); this.texA = this.gl.createTexture();
        this.fboA2 = this.gl.createFramebuffer(); this.texA2 = this.gl.createTexture();
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
                this._configureFramebuffer(this.fboLinePersist, this.texLinePersist, this.fboWidth, this.fboHeight);
                this._configureFramebuffer(this.fboB, this.texB, this.bloomWidth, this.bloomHeight);
                this._configureFramebuffer(this.fboC, this.texC, this.bloomWidth, this.bloomHeight);
                
                // Shadow Mask (Matches Render Resolution)
                this._configureFramebuffer(this.shadowMaskFbo, this.shadowMaskTex, this.fboWidth, this.fboHeight);
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
        const xOff = 0; const yOff = 0;
        for (let i = 0; i < totalCells; i++) {
             const col = i % this.grid.cols;
             const row = Math.floor(i / this.grid.cols);
             posData[i*2] = col * cw + cw * 0.5 + xOff;
             posData[i*2+1] = row * ch + ch * 0.5 + yOff;
        }
        
        // Fix: Explicitly bind posBuffer before uploading posData
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, posData);

        // Dynamic Buffers
        this.charBuffer = ensureBuf(this.charBuffer, totalCells * 2); // Uint16
        this.colorBuffer = ensureBuf(this.colorBuffer, totalCells * 4); // Uint32 (RGBA)
        this.alphaBuffer = ensureBuf(this.alphaBuffer, totalCells * 4); // Float32
        this.decayBuffer = ensureBuf(this.decayBuffer, totalCells); // Uint8
        this.glowBuffer = ensureBuf(this.glowBuffer, totalCells * 4); // Float32
        this.mixBuffer = ensureBuf(this.mixBuffer, totalCells * 4); // Float32
        this.nextCharBuffer = ensureBuf(this.nextCharBuffer, totalCells * 2); // Uint16
        this.maxDecayBuffer = ensureBuf(this.maxDecayBuffer, totalCells * 2); // Uint16

        // Mapped Arrays
        this.mappedChars = new Uint16Array(totalCells);
        this.mappedNextChars = new Uint16Array(totalCells);
        
        // Upload Buffers (CPU merging for overrides/effects)
        this.uploadColors = new Uint32Array(totalCells);
        this.uploadAlphas = new Float32Array(totalCells);
        this.uploadDecays = new Uint8Array(totalCells); // Decays usually don't have overrides but safe to copy
        this.uploadMaxDecays = new Uint16Array(totalCells);
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

        // 10: MaxDecay (Dynamic Instance, Uint16 -> Float)
        // Location 9 is depth (unused in 2D but reserved), skipping to 10
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.maxDecayBuffer);
        this.gl.enableVertexAttribArray(10);
        this.gl.vertexAttribPointer(10, 1, this.gl.UNSIGNED_SHORT, false, 0, 0);
        this.gl.vertexAttribDivisor(10, 1);

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

    _renderQuantizedShadows(fx) {
        if (!fx || !fx.renderGrid) return;
        
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.shadowMaskFbo);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 

        const gw = fx.logicGridW;
        const gh = fx.logicGridH;
        
        const now = fx.animFrame;
        const fadeIn = fx.getConfig('FadeInFrames') || 0;
        const fadeOut = fx.getConfig('FadeFrames') || 0;

        const occupancy = new Uint8Array(gw * gh * 3);
        for (let i = 0; i < gw * gh; i++) {
            for (let L = 0; L < 3; L++) {
                const grid = fx.layerGrids[L];
                const rGrid = fx.removalGrids[L];
                let alpha = 0;
                
                if (grid && grid[i] !== -1) {
                    const birth = grid[i];
                    if (fadeIn > 0 && now < birth + fadeIn) {
                        alpha = Math.floor(Math.max(0, Math.min(1, (now - birth) / fadeIn)) * 255);
                    } else {
                        alpha = 255;
                    }
                } else if (rGrid && rGrid[i] !== -1) {
                    const death = rGrid[i];
                    if (fadeOut > 0 && now < death + fadeOut) {
                        alpha = Math.floor(Math.max(0, Math.min(1, 1.0 - (now - death) / fadeOut)) * 255);
                    } else {
                        rGrid[i] = -1;
                        alpha = 0;
                    }
                }
                occupancy[i * 3 + L] = alpha;
            }
        }
        
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB, gw, gh, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, occupancy);
        
        const prog = this.lineProgram;
        this.gl.useProgram(prog);
        
        const s = this.config.state;
        const d = this.config.derived;
        const scale = s.resolution;
        const bs = fx.getBlockSize();
        const cellPitchX = Math.max(1, bs.w);
        const cellPitchY = Math.max(1, bs.h);
        const { offX, offY } = fx._computeCenteredOffset(gw, gh, cellPitchX, cellPitchY);
        
        const screenStepX = d.cellWidth * s.stretchX * scale;
        const screenStepY = d.cellHeight * s.stretchY * scale;
        const gridPixW = fx.g.cols * d.cellWidth * scale; 
        const gridPixH = fx.g.rows * d.cellHeight * scale;
        const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (this.fboWidth * 0.5);
        const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (this.fboHeight * 0.5);

        const uLoc = (n) => this.gl.getUniformLocation(prog, n);
        this.gl.uniform1i(uLoc('u_mode'), 2); 
        this.gl.uniform2f(uLoc('u_logicGridSize'), gw, gh);
        this.gl.uniform2f(uLoc('u_screenOrigin'), screenOriginX, screenOriginY);
        this.gl.uniform2f(uLoc('u_screenStep'), screenStepX, screenStepY);
        this.gl.uniform2f(uLoc('u_cellPitch'), cellPitchX, cellPitchY);
        this.gl.uniform2f(uLoc('u_blockOffset'), offX, offY);
        this.gl.uniform2f(uLoc('u_userBlockOffset'), fx.userBlockOffX || 0, fx.userBlockOffY || 0);
        this.gl.uniform2f(uLoc('u_resolution'), this.fboWidth, this.fboHeight);
        this.gl.uniform2f(uLoc('u_offset'), s.quantizedLineGfxOffsetX * scale, s.quantizedLineGfxOffsetY * scale);
        this.gl.uniform3iv(uLoc('u_layerOrder'), new Int32Array(fx.layerOrder || [0, 1, 2]));
        this.gl.uniform1i(uLoc('u_showInterior'), fx.getConfig('ShowInterior') !== false);

        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
        this.gl.uniform1i(uLoc('u_logicGrid'), 1);

        this.gl.bindVertexArray(this.vaoLine);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        this.gl.disable(this.gl.BLEND);
    }

    _renderQuantizedLineGfx(s, d, sourceTex) {
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

        const gw = fx.logicGridW;
        const gh = fx.logicGridH;
        if (gw <= 0 || gh <= 0) return false;
        
        if (gw !== this.lastLogicGridWidth || gh !== this.lastLogicGridHeight) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB, gw, gh, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, null);
            this.lastLogicGridWidth = gw;
            this.lastLogicGridHeight = gh;
        }

        const now = fx.animFrame;
        const fadeIn = fx.getConfig('FadeInFrames') || 0;
        const fadeOut = fx.getConfig('FadeFrames') || 0;

        const occupancy = new Uint8Array(gw * gh * 3);
        for (let gy = 0; gy < gh; gy++) {
            const rowOff = gy * gw;
            for (let gx = 0; gx < gw; gx++) {
                const i = rowOff + gx;
                const tidx = i * 3;
                for (let L = 0; L < 3; L++) {
                    const grid = fx.layerGrids[L];
                    const rGrid = fx.removalGrids[L];
                    let alpha = 0;
                    
                    if (grid && grid[i] !== -1) {
                        const birth = grid[i];
                        if (fadeIn > 0 && now < birth + fadeIn) {
                            alpha = Math.floor(Math.max(0, Math.min(1, (now - birth) / fadeIn)) * 255);
                        } else {
                            alpha = 255;
                        }
                    } else if (rGrid && rGrid[i] !== -1) {
                        const death = rGrid[i];
                        if (fadeOut > 0 && now < death + fadeOut) {
                            alpha = Math.floor(Math.max(0, Math.min(1, 1.0 - (now - death) / fadeOut)) * 255);
                        } else {
                            // Only cleanup in the shadow pass or separate update to avoid partial updates
                            alpha = 0;
                        }
                    }
                    occupancy[tidx + L] = alpha;
                }
            }
        }
                this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
                this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, gw, gh, this.gl.RGB, this.gl.UNSIGNED_BYTE, occupancy);
                
                // 2. Update Source Grid Texture (Characters)
                if (fx.gridCacheCanvas) {
                    if (fx.lastGridSeed !== this.lastSourceGridSeed) {
                        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceGridTexture);
                        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
                        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, fx.gridCacheCanvas);
                        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
                        this.lastSourceGridSeed = fx.lastGridSeed;
                    }
                }
                
                this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
        
                const prog = this.lineProgram;
                this.gl.useProgram(prog);
                
                const scale = s.resolution;
                const bs = fx.getBlockSize();
                const cellPitchX = Math.max(1, bs.w);
                const cellPitchY = Math.max(1, bs.h);
                const { offX, offY } = fx._computeCenteredOffset(gw, gh, cellPitchX, cellPitchY);
                
                const screenStepX = d.cellWidth * s.stretchX * scale;
                const screenStepY = d.cellHeight * s.stretchY * scale;
                const gridPixW = fx.g.cols * d.cellWidth * scale; 
                const gridPixH = fx.g.rows * d.cellHeight * scale;
                const screenOriginX = ((0 - (gridPixW * 0.5)) * s.stretchX) + (this.fboWidth * 0.5);
                const screenOriginY = ((0 - (gridPixH * 0.5)) * s.stretchY) + (this.fboHeight * 0.5);
        
                const uLoc = (n) => this.gl.getUniformLocation(prog, n);
                this.gl.uniform2f(uLoc('u_logicGridSize'), gw, gh);
                this.gl.uniform2f(uLoc('u_screenOrigin'), screenOriginX, screenOriginY);
                this.gl.uniform2f(uLoc('u_screenStep'), screenStepX, screenStepY);
                this.gl.uniform2f(uLoc('u_cellPitch'), cellPitchX, cellPitchY);
                this.gl.uniform2f(uLoc('u_blockOffset'), offX, offY);
                this.gl.uniform2f(uLoc('u_userBlockOffset'), fx.userBlockOffX || 0, fx.userBlockOffY || 0);
                this.gl.uniform2f(uLoc('u_resolution'), this.fboWidth, this.fboHeight);
                this.gl.uniform2f(uLoc('u_offset'), s.quantizedLineGfxOffsetX * scale, s.quantizedLineGfxOffsetY * scale);
                this.gl.uniform2f(uLoc('u_sourceGridOffset'), s.quantizedSourceGridOffsetX * scale, s.quantizedSourceGridOffsetY * scale);
                
                const sampleOffX = fx.getLineGfxValue('SampleOffsetX');
                const sampleOffY = fx.getLineGfxValue('SampleOffsetY');
                this.gl.uniform2f(uLoc('u_sampleOffset'), sampleOffX * scale, sampleOffY * scale);
                
                this.gl.uniform3iv(uLoc('u_layerOrder'), new Int32Array(fx.layerOrder || [0, 1, 2]));
                this.gl.uniform1i(uLoc('u_showInterior'), fx.getConfig('ShowInterior') !== false);
                
                const thickness = fx.getLineGfxValue('Thickness');
                this.gl.uniform1f(uLoc('u_thickness'), thickness);
                
                const colHex = fx.getLineGfxValue('Color');
                const col = Utils.hexToRgb(colHex || "#ffffff");
                this.gl.uniform3f(uLoc('u_color'), col.r/255, col.g/255, col.b/255);
                
                const fColHex = fx.getLineGfxValue('FadeColor');
                const fCol = Utils.hexToRgb(fColHex || "#eeff00");
                this.gl.uniform3f(uLoc('u_fadeColor'), fCol.r/255, fCol.g/255, fCol.b/255);

                const intensity = fx.getLineGfxValue('Intensity');
                this.gl.uniform1f(uLoc('u_intensity'), intensity * fx.alpha); 
                
                const glow = fx.getLineGfxValue('Glow');
                this.gl.uniform1f(uLoc('u_glow'), glow);
                
                this.gl.uniform1f(uLoc('u_saturation'), fx.getLineGfxValue('Saturation'));
                this.gl.uniform1f(uLoc('u_brightness'), fx.getLineGfxValue('Brightness'));
                this.gl.uniform1f(uLoc('u_additiveStrength'), fx.getLineGfxValue('AdditiveStrength'));
                this.gl.uniform1f(uLoc('u_sharpness'), fx.getLineGfxValue('Sharpness'));
                this.gl.uniform1f(uLoc('u_glowFalloff'), fx.getLineGfxValue('GlowFalloff'));
                this.gl.uniform1f(uLoc('u_roundness'), fx.getLineGfxValue('Roundness'));
                this.gl.uniform1f(uLoc('u_maskSoftness'), fx.getLineGfxValue('MaskSoftness'));
        
                this.gl.activeTexture(this.gl.TEXTURE1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.logicGridTexture);
                this.gl.uniform1i(uLoc('u_logicGrid'), 1);
        
                this.gl.activeTexture(this.gl.TEXTURE3);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceGridTexture);
                this.gl.uniform1i(uLoc('u_sourceGrid'), 3);
        
                // PASS 1: GENERATE
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboLinePersist);
                this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
                
                this.gl.enable(this.gl.BLEND);
                this.gl.blendFunc(this.gl.ZERO, this.gl.SRC_COLOR); 
                const persistence = fx.getLineGfxValue('Persistence') ?? 0.0;
                this.gl.uniform1f(uLoc('u_persistence'), persistence); // Set uniform for Mode 0
                
                this.gl.useProgram(this.colorProgram);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
                this.gl.enableVertexAttribArray(0);
                this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
                this.gl.uniform4f(this.gl.getUniformLocation(this.colorProgram, 'u_color'), persistence, persistence, persistence, 1.0);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 
                this.gl.useProgram(prog);
                this.gl.uniform1i(uLoc('u_mode'), 0); 
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        
                // PASS 2: COMPOSITE
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA2);
                this.gl.disable(this.gl.BLEND);
                
                // A. Pure blit (Mode 2) - Preserves original alpha
                this.gl.useProgram(prog);
                this.gl.uniform1i(uLoc('u_mode'), 2);
                this.gl.activeTexture(this.gl.TEXTURE0);
                this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTex);
                this.gl.uniform1i(uLoc('u_characterBuffer'), 0);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        
                // B. Apply highlights (Mode 1)
                this.gl.uniform1i(uLoc('u_mode'), 1);
                this.gl.activeTexture(this.gl.TEXTURE2);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.texLinePersist);
                this.gl.uniform1i(uLoc('u_persistenceBuffer'), 2);
                
                // Ensure u_sourceGrid is also bound for mode 1 (already bound to unit 3 above)
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        
                this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                return true;
            }

    _runBlur(sourceTex, horizontal, strength, width, height, opacity = 1.0) {
        if (!this.bloomProgram) return;
        this.gl.disable(this.gl.BLEND);
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
        
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    render(frame) {
        if (!this.posBuffer || this.fboWidth === 0) return; 
        
        const { state: s, derived: d } = this.config;
        const grid = this.grid;
        const activeFonts = d.activeFonts;
        const gl = this.gl;

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
        const totalCells = grid.cols * grid.rows;
        if (this.mappedChars.length !== totalCells) return;

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
        
        const mChars = this.mappedChars;
        const mNext = this.mappedNextChars;
        const uColors = this.uploadColors;
        const uAlphas = this.uploadAlphas;
        const uDecays = this.uploadDecays;
        const uMaxDecays = this.uploadMaxDecays;
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
                if (effActive[i] === 3) {
                    // SHADOW MODE
                    const c = gChars[i];
                    mChars[i] = mapChar(c);
                    uColors[i] = gColors[i];
                    uAlphas[i] = 1.0; // Force full alpha, let ovAlpha handle opacity
                    uDecays[i] = gDecays[i];
                    uMaxDecays[i] = 0; // Effects don't use variable decay
                    uGlows[i] = 0.0; // Disable glow for shadowboxes
                    
                    let eAlpha = effAlphas[i];
                    if (eAlpha > 0.99) eAlpha = 0.99;
                    uMix[i] = 5.0 + eAlpha; 
                    mNext[i] = 0;
                    continue;
                }

                if (effActive[i] === 2) {
                    // OVERLAY MODE: Draw Sim + White Effect
                    // 1. Load Simulation
                    const c = gChars[i];
                    mChars[i] = mapChar(c);
                    uColors[i] = effColors[i]; // Use effect-provided color (allows dimming)
                    uAlphas[i] = gAlphas[i];
                    uDecays[i] = gDecays[i];
                    uGlows[i] = gGlows[i] + effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    // 2. Load Effect
                    mNext[i] = mapChar(effChars[i]);
                    let eAlpha = effAlphas[i];
                    if (eAlpha > 0.99) eAlpha = 0.99;
                    uMix[i] = 4.0 + eAlpha; 
                    continue;
                }

                if (effActive[i] === 4) {
                    // HIGH PRIORITY OVERRIDE (Superman/Lightning)
                    // Behaves like Standard Override but sets Mix >= 10.0 to signal "Ignore Shadow"
                    mChars[i] = mapChar(effChars[i]);
                    uColors[i] = effColors[i];
                    uAlphas[i] = effAlphas[i];
                    uGlows[i] = effGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
                    
                    uDecays[i] = 0; 
                    uMix[i] = 10.0; // Signal Value
                    mNext[i] = 0;
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

            // PRIORITY 2: HARD OVERRIDE (Deja Vu, etc.)
            // These usually indicate a logic change or interruption.
            const ov = ovActive[i];
            if (ov) {
                if (ov === 2) { // SOLID
                    mChars[i] = 0;
                    mNext[i] = 0;
                    uMix[i] = 3.0; // Trigger SOLID mode in shader
                    uColors[i] = ovColors[i];
                    uAlphas[i] = ovAlphas[i];
                    uDecays[i] = 0;
                    uGlows[i] = (gEnvGlows ? gEnvGlows[i] : 0);
                } else { // CHAR (Mode 1) or FULL (Mode 3)
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
                    
                    if (ov === 3) {
                         // FULL OVERRIDE: Use Override Mix (New World state)
                         const mixVal = grid.overrideMix[i];
                         uMix[i] = mixVal;
                         if (mixVal > 0) {
                             mNext[i] = mapChar(ovNextChars[i]);
                         }
                    } else {
                         // CHAR OVERRIDE: Inherit Main Mix (Old World state)
                         if (gMix[i] > 0) {
                             uMix[i] = gMix[i];
                         }
                    }
                }
                continue;
            }

            // PRIORITY 3: STANDARD SIMULATION
            // Check for Glimmer (mix >= 30.0) which uses effectChars for non-destructive cycling
            const mix = gMix[i];
            let c = gChars[i];
            
            if (mix >= 30.0) {
                // Use visual override from effectChars if available
                const ec = effChars[i];
                if (ec > 0) c = ec;
            }

            mChars[i] = mapChar(c);
            uColors[i] = gColors[i];
            uAlphas[i] = gAlphas[i];
            uDecays[i] = gDecays[i];
            uMaxDecays[i] = gMaxDecays ? gMaxDecays[i] : 0;
            uGlows[i] = gGlows[i] + (gEnvGlows ? gEnvGlows[i] : 0);
            
            const mode = gMode[i];
            if (mode === 1) { // OVERLAP
                mNext[i] = mapChar(gSecChars[i]);
                uMix[i] = 2.0; 
            } else {
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

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.maxDecayBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uMaxDecays);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.glowBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uGlows);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.mixBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, uMix);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nextCharBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mNext);


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
                
                this.gl.uniform2f(this.gl.getUniformLocation(this.shadowProgram, 'u_gridSize'), grid.cols, grid.rows);
                
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
    
                            this.gl.uniform4f(this.gl.getUniformLocation(this.colorProgram, 'u_color'), 0, 0, 0, alpha);
                            
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
            // Respect layerEnableBackground (Default: true)
            // If disabled, we don't clear/fade, which might look glitchy (hall of mirrors), but it's what was asked.
            // Actually, usually "disable background" means transparent background. 
            // But here we are drawing a full screen quad.
            // If layerEnableBackground is false, we skip this draw call.
            if (s.layerEnableBackground !== false) {
                this.gl.useProgram(this.colorProgram);
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.screenQuadBuffer);
                this.gl.enableVertexAttribArray(0); 
                this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
                
                // Apply Background Color for Fade
                const br = d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
                const bg = d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
                const bb = d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
                
                this.gl.uniform4f(this.gl.getUniformLocation(this.colorProgram, 'u_color'), br, bg, bb, s.clearAlpha);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            }
        }

        let finalMainTex = this.texA;

        // 2. Draw Cells
        // Respect layerEnablePrimaryCode
        if (s.layerEnablePrimaryCode !== false) {
            // Determine Program based on mode
            const activeProgram = this.program2D;
        this.gl.useProgram(activeProgram);
        
        // --- Shared Uniforms ---
        this.gl.uniform2f(this.gl.getUniformLocation(activeProgram, 'u_resolution'), this.w, this.h);
        this.gl.uniform2f(this.gl.getUniformLocation(activeProgram, 'u_atlasSize'), atlas.canvas.width, atlas.canvas.height);
        
        // Calculate Grid Size in Pixels for Centering
        const gridPixW = grid.cols * d.cellWidth;
        const gridPixH = grid.rows * d.cellHeight;
        this.gl.uniform2f(this.gl.getUniformLocation(activeProgram, 'u_gridSize'), gridPixW, gridPixH);

        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_cellSize'), atlas.cellSize);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_cols'), atlas._lastCols);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_decayDur'), s.decayFadeDurationFrames);
        
        // Grid Layout Stretch
        this.gl.uniform2f(this.gl.getUniformLocation(activeProgram, 'u_stretch'), s.stretchX, s.stretchY);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_mirror'), s.mirrorEnabled ? -1.0 : 1.0);
        
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
        this.gl.uniform1i(this.gl.getUniformLocation(activeProgram, 'u_texture'), 0);
        
        // Bind Shadow Mask
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.shadowMaskTex);
        this.gl.uniform1i(this.gl.getUniformLocation(activeProgram, 'u_shadowMask'), 1);
        
        // Bind Glimmer Optimization Texture
        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.glimmerTexture);
        this.gl.uniform1i(this.gl.getUniformLocation(activeProgram, 'u_glimmerNoise'), 2);
        
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_time'), performance.now() / 1000.0);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_dissolveEnabled'), s.dissolveEnabled ? 1.0 : 0.0);
        
        // Decoupled: Shader blink speed is constant, Slider controls Char Cycle speed
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_glimmerSpeed'), s.upwardTracerGlimmerSpeed || 1.0);
        
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_glimmerSize'), s.upwardTracerGlimmerSize || 3.0);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_glimmerFill'), s.upwardTracerGlimmerFill || 3.0);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_glimmerIntensity'), s.upwardTracerGlimmerGlow || 10.0);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_glimmerFlicker'), s.upwardTracerGlimmerFlicker !== undefined ? s.upwardTracerGlimmerFlicker : 0.5);

        // Calculate Cell Scale (Aspect Ratio Correction)
        const scaleMult = 1.0;
        const cellScaleX = (d.cellWidth / atlas.cellSize) * scaleMult;
        const cellScaleY = (d.cellHeight / atlas.cellSize) * scaleMult;
        this.gl.uniform2f(this.gl.getUniformLocation(activeProgram, 'u_cellScale'), cellScaleX, cellScaleY);

        
        // Target Scale: 1.0 + percent/100. e.g. -20% -> 0.8
        const percent = s.dissolveScalePercent !== undefined ? s.dissolveScalePercent : -20;
        const dissolveScale = s.dissolveEnabled ? (1.0 + (percent / 100.0)) : 1.0;
        
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_dissolveScale'), dissolveScale);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_dissolveSize'), s.dissolveMinSize || 1.0);
        
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_deteriorationEnabled'), s.deteriorationEnabled ? 1.0 : 0.0);
        this.gl.uniform1f(this.gl.getUniformLocation(activeProgram, 'u_deteriorationStrength'), s.deteriorationStrength);
        
        // Pass Overlap Color
        const ovRgb = Utils.hexToRgb(s.overlapColor || "#FFD700");
        this.gl.uniform4f(this.gl.getUniformLocation(activeProgram, 'u_overlapColor'), ovRgb.r/255.0, ovRgb.g/255.0, ovRgb.b/255.0, 1.0);

        this.gl.bindVertexArray(this.vao);
        
        // Ensure blending is enabled for the main draw
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        // Draw Main Pass
        this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, totalCells);
        this.gl.bindVertexArray(null);

        // --- 3rd Pass: Quantized Line GFX ---
        if (this.effects) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA2);
            this.gl.viewport(0, 0, this.fboWidth, this.fboHeight);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            if (this._renderQuantizedLineGfx(s, d, this.texA)) {
                finalMainTex = this.texA2;
            } else {
                // If GFX enabled but no active effect, we should probably clear persistence
                // so old lines don't get stuck.
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboLinePersist);
                this.gl.clearColor(0, 0, 0, 0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT);
                
                // Still need to blit texA to fboA2 if we want to use finalMainTex consistently
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboA2);
                this._drawFullscreenTexture(this.texA, 1.0, 0);
                finalMainTex = this.texA2;
            }
        }

        } // End layerEnablePrimaryCode check

        // --- POST PROCESS (Bloom) ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
        const br = d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
        const bg = d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
        const bb = d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
        
        this.gl.clearColor(br, bg, bb, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
        
        const blurAmt = s.smoothingEnabled ? s.smoothingAmount : 0;
        this._drawFullscreenTexture(finalMainTex, 1.0, blurAmt);

        if (s.enableBloom) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboB);
            this.gl.viewport(0, 0, this.bloomWidth, this.bloomHeight);
            let spread = s.bloomStrength * 1.0; 
            this._runBlur(finalMainTex, true, spread, this.fboWidth, this.fboHeight); 

            const iterations = 3;
            for (let i = 0; i < iterations; i++) {
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboC);
                this._runBlur(this.texB, false, spread, this.bloomWidth, this.bloomHeight);
                
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboB);
                this._runBlur(this.texC, true, spread, this.bloomWidth, this.bloomHeight);
            }

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.ONE, this.gl.ONE); 
            this._drawFullscreenTexture(this.texB, s.bloomOpacity, 0);
        }

        if (this.postProcessor) {
            const customSource = s.shaderEnabled ? s.customShader : null;
            const effectSource = s.effectShader;

            // Compile Custom Shader if changed
            if (customSource !== this.lastShaderSource) {
                this.postProcessor.compileShader(customSource);
                this.lastShaderSource = customSource;
            }
            
            // Compile Effect Shader if changed
            if (effectSource !== this.lastEffectSource) {
                this.postProcessor.compileEffectShader(effectSource);
                this.lastEffectSource = effectSource;
            }

            const isActive = (s.shaderEnabled && customSource) || effectSource;

            if (isActive) {
                const param = s.shaderParameter !== undefined ? s.shaderParameter : 0.5;
                const effectParam = s.effectParameter !== undefined ? s.effectParameter : 0.0;
                this.postProcessor.render(this.cvs, performance.now() / 1000, this.mouseX, this.mouseY, param, effectParam);
                
                if (this.postProcessor.canvas.style.display === 'none') {
                    this.postProcessor.canvas.style.display = 'block';
                    this.cvs.style.opacity = '0'; 
                }
            } else {
                if (this.postProcessor.canvas.style.display !== 'none') {
                    this.postProcessor.canvas.style.display = 'none';
                    this.cvs.style.opacity = '1';
                }
            }
        }
    }
}

