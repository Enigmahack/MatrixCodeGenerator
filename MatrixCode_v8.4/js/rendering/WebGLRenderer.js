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

        // --- 3D Camera State ---
        // x,y,z = World Position
        // vx,vy,vz = Velocity
        this.camera = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, yaw: 0 };
        // flySpeed is now managed by config.state.flySpeed
        this.keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
        this._setupKeyboardTracking();
        this._setupScrollTracking();

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
            if (this.program) this.gl.deleteProgram(this.program);
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
        // Click to capture pointer in 3D mode
        this.cvs.addEventListener('mousedown', () => {
            const is3D = (this.config.state.renderMode3D === true || this.config.state.renderMode3D === 'true');
            if (is3D && !this._isMenuOpen()) {
                this.cvs.requestPointerLock();
            }
        });

        this._mouseMoveHandler = (e) => {
            if (this._isMenuOpen()) return;

            // If pointer is locked, use delta movement for infinite turning
            if (document.pointerLockElement === this.cvs) {
                // Normalize delta relative to screen size to keep sensitivity consistent
                // Accumulate directly into mouseX/Y but wrap/clamp isn't strictly needed for the look logic 
                // since we map it to angles in _updateCamera. 
                // However, our _updateCamera expects 0..1 values currently.
                // Let's adapt _updateCamera to handle continuous accumulation or modify this to update yaw/pitch directly.
                
                // Better approach: Pass deltas to a tracking object, or accumulate virtual mouse coordinates.
                // Let's simply add the delta to the existing 0..1 mouseX/Y, allowing them to go <0 or >1.
                // The camera logic uses (mouseX - 0.5) * Scale.
                // So if mouseX keeps growing, Yaw keeps rotating. This is perfect for infinite turning.
                
                const sensitivity = 0.002;
                this.mouseX += e.movementX * sensitivity;
                this.mouseY += e.movementY * sensitivity;
                
                // Clamp Pitch (Y) to prevent flipping over (optional, but good for FPS feel)
                // Let's leave Y unclamped here and let _updateCamera handle pitch clamping if needed, 
                // or just let it spin if that's the desired "fly" feel. 
                // Standard FPS clamps pitch.
                
            } else {
                // Fallback for 2D or unlocked 3D (standard cursor tracking)
                const rect = this.cvs.getBoundingClientRect();
                this.mouseX = (e.clientX - rect.left) / rect.width;
                this.mouseY = 1.0 - ((e.clientY - rect.top) / rect.height);
            }
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

    _setupKeyboardTracking() {
        window.addEventListener('keydown', (e) => {
            if (this.keys.hasOwnProperty(e.code)) {
                this.keys[e.code] = true;
                if(this.config.state.renderMode3D) e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (this.keys.hasOwnProperty(e.code)) {
                this.keys[e.code] = false;
            }
        });
    }

    _setupScrollTracking() {
        window.addEventListener('wheel', (e) => {
            if (this._isMenuOpen()) return;
            if (this.config.state.renderMode3D === true || this.config.state.renderMode3D === 'true') {
                e.preventDefault();
                // Scroll Up (Negative Delta) -> Increase Speed
                // Scroll Down (Positive Delta) -> Decrease Speed
                const delta = e.deltaY * -0.05; 
                let newSpeed = (this.config.state.flySpeed || 15.0) + delta;
                
                // Clamp speed reasonably (e.g. -50 to 100)
                newSpeed = Math.max(-50.0, Math.min(100.0, newSpeed));
                
                // Save to config (updates profile automatically via ConfigurationManager logic)
                this.config.set('flySpeed', newSpeed);
            }
        }, { passive: false });
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

        // --- SHADOW MASK SHADER ---
        const shadowVS = this.isWebGL2 ? `#version 300 es
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
                gl_Position.y = -gl_Position.y;
                v_uv = a_quad;
                v_alpha = a_alpha;
                v_blur = a_blur;
            }
        ` : `
            attribute vec2 a_quad;
            attribute vec4 a_rect;
            attribute float a_alpha;
            attribute float a_blur;
            uniform vec2 u_gridSize;
            varying vec2 v_uv;
            varying float v_alpha;
            varying float v_blur;
            void main() {
                vec2 size = a_rect.zw;
                vec2 pos = a_rect.xy;
                vec2 worldPos = pos + (a_quad * size);
                vec2 uv = worldPos / u_gridSize;
                gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                gl_Position.y = -gl_Position.y;
                v_uv = a_quad;
                v_alpha = a_alpha;
                v_blur = a_blur;
            }
        `;

        const shadowFS = this.isWebGL2 ? `#version 300 es
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
        ` : `
            precision mediump float;
            varying vec2 v_uv;
            varying float v_alpha;
            varying float v_blur;
            void main() {
                vec2 d = abs(v_uv - 0.5) * 2.0;
                float dist = max(d.x, d.y);
                float edge = 1.0 - smoothstep(1.0 - max(0.001, v_blur), 1.0, dist);
                gl_FragColor = vec4(0.0, 0.0, 0.0, v_alpha * edge);
            }
        `;
        this.shadowProgram = this._createProgram(shadowVS, shadowFS);

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
            layout(location=9) ${attribute} vec3 a_depth;     // World X, Y-Offset, Base Z

            uniform vec2 u_resolution;
            uniform vec2 u_atlasSize;
            uniform vec2 u_gridSize;
            uniform float u_cellSize;
            uniform float u_cols;
            uniform float u_decayDur;
            uniform vec2 u_stretch;
            uniform float u_mirror;
            
            uniform mat4 u_projection;
            uniform mat4 u_view;
            uniform float u_is3D;
            
            // New uniforms for infinite scroll
            uniform vec3 u_cameraPos;
            uniform vec3 u_wrapSize; // X, Y, Z dimensions of forest

            uniform float u_dissolveEnabled;
            uniform float u_dissolveScale;

            ${varying} vec2 v_uv;
            ${varying} vec2 v_uv2;
            ${varying} vec4 v_color;
            ${varying} float v_mix;
            ${varying} float v_glow;
            ${varying} float v_prog;
            ${varying} vec2 v_screenUV; // For sampling Shadow Mask
            ${varying} vec2 v_shadowUV; // NEW: Grid-space UV

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
                
                // Calculate Shadow UV before transformations
                v_shadowUV = worldPos / u_gridSize;
                
                // Mirror/Stretch - Pivot around GRID center, not screen center
                vec2 gridCenter = u_gridSize * 0.5;
                worldPos.x = (worldPos.x - gridCenter.x) * u_stretch.x + (u_resolution.x * 0.5);
                worldPos.y = (worldPos.y - gridCenter.y) * u_stretch.y + (u_resolution.y * 0.5);
                
                if (u_mirror < 0.0) worldPos.x = u_resolution.x - worldPos.x;

                if (u_is3D > 0.5) {
                    // 3D Mode (Infinite Volumetric Scroll)
                    // a_depth = Base World Position (X, Y-Offset, Z)
                    
                    // 1. Calculate Relative Position (World - Camera)
                    vec3 basePos = vec3(a_depth.x, a_depth.y, a_depth.z);
                    vec3 diff = basePos - u_cameraPos;
                    
                    // 2. Wrap coordinates to keep cells within u_wrapSize box centered on camera
                    vec3 wrappedDiff = mod(diff + u_wrapSize * 0.5, u_wrapSize) - u_wrapSize * 0.5;
                    
                    // 3. Reconstruct World Position
                    vec3 finalPos = u_cameraPos + wrappedDiff;
                    
                    // 4. Apply Column Logic (Vertical Characters)
                    // Y: We need to respect the character's vertical position within the column (worldPos.y)
                    // But we also want to wrap Y if the camera goes up/down too far.
                    // The a_depth.y gives us a random column offset.
                    // worldPos.y is 0..ScreenHeight.
                    // Let's center worldPos.y
                    float charY = worldPos.y - (u_resolution.y * 0.5);
                    
                    // Combined Y: Column Base Y + Character Y
                    // Since a_depth.y is wrapped, the whole column wraps.
                    finalPos.y += charY;
                    
                    // Quad local offset
                    vec2 quadOffset = (a_quad - 0.5) * u_cellSize * scale;
                    
                    // Final 3D Pos (World Space aligned)
                    // Note: We apply quadOffset directly to X/Y. This means characters are 2D planes 
                    // aligned with the world axes (facing -Z initially, but since we are inside them, 
                    // they look like flat strips).
                    gl_Position = u_projection * u_view * vec4(finalPos.x + quadOffset.x, -finalPos.y + quadOffset.y, finalPos.z, 1.0);
                } else {
                    // 2D Mode (Legacy Clip Space)
                    vec2 clip = (worldPos / u_resolution) * 2.0 - 1.0;
                    clip.y = -clip.y;
                    gl_Position = vec4(clip, 0.0, 1.0);
                }
                
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
                    ${varyingIn} vec2 v_screenUV;
                    ${varyingIn} vec2 v_shadowUV;
                    
                    uniform sampler2D u_texture;
                    uniform sampler2D u_shadowMask; // <-- New Input
                    uniform float u_time;
                    uniform float u_dissolveEnabled; // 0.0 or 1.0
                    uniform float u_dissolveScale;
                    uniform float u_dissolveSize;
                    
                    uniform float u_deteriorationEnabled;
                    uniform float u_deteriorationStrength;
                    uniform vec2 u_atlasSize;
                    uniform vec4 u_overlapColor;
                    
                    // 0 = Base (Glyphs/Glow), 1 = Shadow
                    uniform int u_passType;
                    
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
                        // Decode High Priority Signal
                        bool isHighPriority = (v_mix >= 9.5);
                        float useMix = isHighPriority ? v_mix - 10.0 : v_mix;
        
                        // Sample Shadow Mask
                        float shadow = ${texture2D}(u_shadowMask, v_shadowUV).a;
                        
                        // Sample Texture with Effects
                        float tex1 = getProcessedAlpha(v_uv);
                        vec4 baseColor = v_color;
                        
                        // Default Standard Mode
                        float finalAlpha = tex1;
        
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
                        attribute vec3 a_depth;
                        uniform vec2 u_resolution; uniform vec2 u_atlasSize; uniform vec2 u_gridSize; uniform float u_cellSize; uniform float u_cols; uniform float u_decayDur;
                        uniform vec2 u_stretch; uniform float u_mirror;
                        uniform mat4 u_projection; uniform mat4 u_view; uniform float u_is3D;
                        uniform vec3 u_cameraPos; uniform vec3 u_wrapSize;
                        varying vec2 v_uv; varying vec2 v_uv2; varying vec4 v_color; varying float v_mix; varying float v_glow; varying float v_prog; varying vec2 v_screenUV; varying vec2 v_shadowUV;
                        void main() {
                            float scale = 1.0;
                            v_prog = 0.0;
                            if (a_decay >= 2.0) { v_prog = (a_decay - 2.0) / u_decayDur; scale = max(0.1, 1.0 - v_prog); }
                            vec2 centerPos = (a_quad - 0.5) * u_cellSize * scale;
                            vec2 worldPos = a_pos + centerPos;
                            v_shadowUV = worldPos / u_gridSize;
                            vec2 gridCenter = u_gridSize * 0.5;
                            worldPos.x = (worldPos.x - gridCenter.x) * u_stretch.x + (u_resolution.x * 0.5);
                            worldPos.y = (worldPos.y - gridCenter.y) * u_stretch.y + (u_resolution.y * 0.5);
                            if (u_mirror < 0.0) worldPos.x = u_resolution.x - worldPos.x;
                            
                            if (u_is3D > 0.5) {
                                vec3 basePos = vec3(a_depth.x, a_depth.y, a_depth.z);
                                vec3 diff = basePos - u_cameraPos;
                                vec3 wrappedDiff = mod(diff + u_wrapSize * 0.5, u_wrapSize) - u_wrapSize * 0.5;
                                vec3 finalPos = u_cameraPos + wrappedDiff;
                                float charY = worldPos.y - (u_resolution.y * 0.5);
                                finalPos.y += charY;
                                vec2 quadOffset = (a_quad - 0.5) * u_cellSize * scale;
                                
                                // World Aligned
                                gl_Position = u_projection * u_view * vec4(finalPos.x + quadOffset.x, -finalPos.y + quadOffset.y, finalPos.z, 1.0);
                            } else {
                                vec2 clip = (worldPos / u_resolution) * 2.0 - 1.0; clip.y = -clip.y;
                                gl_Position = vec4(clip, 0.0, 1.0);
                            }
                            vec3 ndc = gl_Position.xyz / gl_Position.w;
                            v_screenUV = ndc.xy * 0.5 + 0.5; 
                            v_color = a_color; v_color.a *= a_alpha; v_mix = a_mix; v_glow = a_glow;
                            float cIdx = a_charIdx; float row = floor(cIdx / u_cols); float col = mod(cIdx, u_cols);
                            vec2 uvBase = vec2(col, row) * u_cellSize; v_uv = (uvBase + (a_quad * u_cellSize)) / u_atlasSize;
                            if (a_mix > 0.0) { float cIdx2 = a_nextChar; float row2 = floor(cIdx2 / u_cols); float col2 = mod(cIdx2, u_cols); vec2 uvBase2 = vec2(col2, row2) * u_cellSize; v_uv2 = (uvBase2 + (a_quad * u_cellSize)) / u_atlasSize; } else { v_uv2 = v_uv; }
                        }
                     `;
                     finalFS = `
                        precision mediump float;
                        varying vec2 v_uv; varying vec2 v_uv2; varying vec4 v_color; varying float v_mix; varying float v_glow; varying float v_prog; varying vec2 v_screenUV; varying vec2 v_shadowUV;
                        uniform sampler2D u_texture; uniform sampler2D u_shadowMask; uniform float u_time; uniform float u_dissolveEnabled; uniform float u_dissolveSize;
                        float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
                        void main() {
                            bool isHighPriority = (v_mix >= 9.5);
                            float useMix = isHighPriority ? v_mix - 10.0 : v_mix;
                            
                            float shadow = texture2D(u_shadowMask, v_shadowUV).a;
                            float tex1 = texture2D(u_texture, v_uv).a;
                            float finalAlpha = tex1;
                            if (useMix >= 3.0) { finalAlpha = 1.0; }
                            else if (useMix >= 2.0) { float tex2 = texture2D(u_texture, v_uv2).a; finalAlpha = max(tex1, tex2); }
                            else if (useMix > 0.0) { float tex2 = texture2D(u_texture, v_uv2).a; finalAlpha = mix(tex1, tex2, useMix); }
                            if (u_dissolveEnabled > 0.5 && v_prog > 0.0) {
                                vec2 noiseCoord = floor(gl_FragCoord.xy / max(1.0, u_dissolveSize));
                                float noise = random(noiseCoord);
                                if (noise < v_prog) discard;
                            }
                            if (finalAlpha < 0.01) discard;
                            vec4 col = v_color;
                            
                            if (!isHighPriority) { 
                                col.rgb *= (1.0 - shadow); 
                            }
                            // WebGL1 simplified glow logic - assumes glow attribute handling elsewhere or simplified here
                             if (v_glow > 0.0) {
                                float glowFactor = v_glow;
                                if (!isHighPriority) glowFactor *= (1.0 - shadow);
                                col.rgb += (glowFactor * 0.3 * col.a);
                            }
                            
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
        
        // Mapped Arrays (CPU side)
        this.mappedChars = null;
        this.mappedNextChars = null;
    }

    _initBloomBuffers() {
        this.fboA = this.gl.createFramebuffer(); this.texA = this.gl.createTexture();
        this.fboB = this.gl.createFramebuffer(); this.texB = this.gl.createTexture();
        this.fboC = this.gl.createFramebuffer(); this.texC = this.gl.createTexture();
        
        // Shadow Mask FBO
        this.shadowMaskFbo = this.gl.createFramebuffer(); 
        this.shadowMaskTex = this.gl.createTexture();
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
        
        // Depth Buffer (Static Instance) - Now Vec3 (WorldX, Y-Offset, BaseZ)
        this.depthBuffer = ensureBuf(this.depthBuffer, totalCells * 12, this.gl.STATIC_DRAW);
        const depthData = new Float32Array(totalCells * 3);
        
        // Generate random world positions for columns (Forest)
        const colData = new Float32Array(this.grid.cols * 3);
        const spreadX = 4000.0; 
        const spreadZ = 4000.0;
        const spreadY = 2000.0; // Vertical scatter range
        
        for(let c=0; c<this.grid.cols; c++) {
            // Random X
            colData[c*3+0] = (Math.random() - 0.5) * spreadX; 
            // Random Y Offset (Vertical Scatter)
            colData[c*3+1] = (Math.random() - 0.5) * spreadY;
            // Random Z
            colData[c*3+2] = -(Math.random() * spreadZ); 
        }

        const posData = new Float32Array(totalCells * 2);
        const cw = d.cellWidth; const ch = d.cellHeight;
        const xOff = s.fontOffsetX; const yOff = s.fontOffsetY;
        for (let i = 0; i < totalCells; i++) {
             const col = i % this.grid.cols;
             const row = Math.floor(i / this.grid.cols);
             posData[i*2] = col * cw + cw * 0.5 + xOff;
             posData[i*2+1] = row * ch + ch * 0.5 + yOff;
             
             depthData[i*3+0] = colData[col*3+0];
             depthData[i*3+1] = colData[col*3+1];
             depthData[i*3+2] = colData[col*3+2];
        }
        
        // Fix: Explicitly bind posBuffer before uploading posData
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, posData);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.depthBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, depthData);

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

        // 9: Depth (Static Instance, Vec3: X, Y-Offset, Z)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.depthBuffer);
        this.gl.enableVertexAttribArray(9);
        this.gl.vertexAttribPointer(9, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.vertexAttribDivisor(9, 1);

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
                if (effActive[i] === 3) {
                    // SHADOW MODE
                    const c = gChars[i];
                    mChars[i] = mapChar(c);
                    uColors[i] = gColors[i];
                    uAlphas[i] = 1.0; // Force full alpha, let ovAlpha handle opacity
                    uDecays[i] = gDecays[i];
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

            // PRIORITY 2: HARD OVERRIDE (Deja Vu, Firewall, etc.)
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
                                        // Invert Y: 0 is Top (+1), Rows is Bottom (-1)
                                        const y1 = 1.0 - (rect.y / rows) * 2.0; 
                                        const x2 = ((rect.x + rect.w) / cols) * 2.0 - 1.0;
                                        const y2 = 1.0 - ((rect.y + rect.h) / rows) * 2.0;
                                        
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
                                    // Y: 0..rows -> 1..-1 (Inverted)
                                    const ax = (t1.x / cols) * 2.0 - 1.0; const ay = 1.0 - (t1.y / rows) * 2.0;
                                    const bx = (t2.x / cols) * 2.0 - 1.0; const by = 1.0 - (t2.y / rows) * 2.0;
                                    const cx = (b1.x / cols) * 2.0 - 1.0; const cy = 1.0 - (b1.y / rows) * 2.0;
                                    const dx = (b2.x / cols) * 2.0 - 1.0; const dy = 1.0 - (b2.y / rows) * 2.0;
                                    
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
                                const x1 = (r.p1.x / cols) * 2.0 - 1.0; const y1 = 1.0 - (r.p1.y / rows) * 2.0;
                                const x2 = (r.p2.x / cols) * 2.0 - 1.0; const y2 = 1.0 - (r.p2.y / rows) * 2.0;
                                const x3 = (r.p3.x / cols) * 2.0 - 1.0; const y3 = 1.0 - (r.p3.y / rows) * 2.0;
                                vertices = new Float32Array([x1, y1, x2, y2, x3, y3]);
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

        // 2. Draw Cells
        this.gl.useProgram(this.program);
        
        // Uniforms
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_resolution'), this.w, this.h);
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_atlasSize'), atlas.canvas.width, atlas.canvas.height);
        
        // Calculate Grid Size in Pixels for Centering
        const gridPixW = grid.cols * d.cellWidth;
        const gridPixH = grid.rows * d.cellHeight;
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_gridSize'), gridPixW, gridPixH);

        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_cellSize'), atlas.cellSize);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_cols'), atlas._lastCols);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_decayDur'), s.decayFadeDurationFrames);
        this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_stretch'), s.stretchX, s.stretchY);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_mirror'), s.mirrorEnabled ? -1.0 : 1.0);
        
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, atlas.glTexture);
        this.gl.uniform1i(this.gl.getUniformLocation(this.program, 'u_texture'), 0);
        
        // Bind Shadow Mask
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.shadowMaskTex);
        this.gl.uniform1i(this.gl.getUniformLocation(this.program, 'u_shadowMask'), 1);
        
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_time'), performance.now() / 1000.0);
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_dissolveEnabled'), s.dissolveEnabled ? 1.0 : 0.0);

        // --- 3D Camera Update ---
        this._updateCamera();
        // Handle potentially stringified boolean from UI select
        const isModeActive = (s.renderMode3D === true || s.renderMode3D === 'true');
        const is3D = isModeActive ? 1.0 : 0.0;
        this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_is3D'), is3D);
        
        // Pass infinite scroll uniforms
        const wrapSizeX = 4000.0;
        const wrapSizeY = 2000.0;
        const wrapSizeZ = 4000.0;
        
        this.gl.uniform3f(this.gl.getUniformLocation(this.program, 'u_cameraPos'), this.camera.x, this.camera.y, this.camera.z);
        this.gl.uniform3f(this.gl.getUniformLocation(this.program, 'u_wrapSize'), wrapSizeX, wrapSizeY, wrapSizeZ);
        
        if (isModeActive) {
            const aspect = this.w / this.h;
            const fov = 60 * Math.PI / 180;
            
            // Perspective
            const proj = this._makePerspective(fov, aspect, 1.0, 5000.0);
            
            // Camera Pos
            const camX = this.camera.x;
            const camY = this.camera.y;
            const camZ = this.camera.z;
            
            // Look Direction
            const lookDirX = Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch);
            const lookDirY = Math.sin(this.camera.pitch);
            const lookDirZ = -Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch);
            
            const targetX = camX + lookDirX;
            const targetY = camY + lookDirY;
            const targetZ = camZ + lookDirZ;
            
            const view = this._makeLookAt(camX, camY, camZ, targetX, targetY, targetZ, 0, 1, 0);
            
            this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, 'u_projection'), false, proj);
            this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, 'u_view'), false, view);
        } else {
             const ident = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
             this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, 'u_projection'), false, ident);
             this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, 'u_view'), false, ident);
        }
        
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

        this.gl.bindVertexArray(this.vao);
        
        // Ensure blending is enabled for the main draw
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        // Draw Main Pass
        this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, totalCells);
        this.gl.bindVertexArray(null);

        // --- POST PROCESS (Bloom) ---
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
        const br = d.bgRgb ? d.bgRgb.r / 255.0 : 0.0;
        const bg = d.bgRgb ? d.bgRgb.g / 255.0 : 0.0;
        const bb = d.bgRgb ? d.bgRgb.b / 255.0 : 0.0;
        
        this.gl.clearColor(br, bg, bb, 1);
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

    _updateCamera() {
        const isActive = (this.config.state.renderMode3D === true || this.config.state.renderMode3D === 'true');
        if (!isActive) return;
        
        // --- 1. Input Processing (Blocked when menu is open) ---
        if (!this._isMenuOpen()) {
            // Mouse Look (Yaw/Pitch)
            const fov = 60 * Math.PI / 180;
            this.camera.yaw = (this.mouseX - 0.5) * fov * 4.0; 
            this.camera.pitch = (this.mouseY - 0.5) * fov * 2.5;
            
            // Clamp Pitch
            const pitchLimit = Math.PI / 2 - 0.1;
            this.camera.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.camera.pitch));
        }

        // --- 2. Physics & Position Update (Always runs) ---
        
        // Calculate Forward Vector
        const forwardX = Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch);
        const forwardY = Math.sin(this.camera.pitch);
        const forwardZ = -Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch);

        // Apply constant forward flight (Fly Speed)
        const speed = this.config.state.flySpeed || 15.0;
        this.camera.x += forwardX * speed;
        this.camera.y += forwardY * speed;
        this.camera.z += forwardZ * speed;

        // Strafe Logic with Momentum
        const rightX = -forwardZ;
        const rightZ = forwardX;
        // Up Vector is roughly (0,1,0) for world strafe or relative? 
        // Let's stick to simple World Y for Up/Down strafe to match previous feel
        
        let accX = 0;
        let accY = 0;
        let accZ = 0;
        
        // Input (Blocked if menu open)
        if (!this._isMenuOpen()) {
            const accel = 2.0; // Acceleration per frame
            
            if (this.keys.ArrowUp) accY += accel;
            if (this.keys.ArrowDown) accY -= accel;
            if (this.keys.ArrowLeft) {
                accX -= rightX * accel;
                accZ -= rightZ * accel;
            }
            if (this.keys.ArrowRight) {
                accX += rightX * accel;
                accZ += rightZ * accel;
            }
        }

        // Apply Acceleration to Velocity
        this.camera.vx += accX;
        this.camera.vy += accY;
        this.camera.vz += accZ;

        // Apply Friction
        const friction = 0.90;
        this.camera.vx *= friction;
        this.camera.vy *= friction;
        this.camera.vz *= friction;

        // Apply Velocity to Position
        this.camera.x += this.camera.vx;
        this.camera.y += this.camera.vy;
        this.camera.z += this.camera.vz;
    }

    _makePerspective(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, (2 * far * near) * nf, 0
        ]);
    }

    _makeLookAt(ex, ey, ez, tx, ty, tz, ux, uy, uz) {
        const z0 = ex - tx, z1 = ey - ty, z2 = ez - tz;
        let len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
        const zx = z0 * len, zy = z1 * len, zz = z2 * len;

        const x0 = uy * zz - uz * zy, x1 = uz * zx - ux * zz, x2 = ux * zy - uy * zx;
        len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
        if (!len) {
            // zero length vector
            return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        }
        len = 1 / len;
        const xx = x0 * len, xy = x1 * len, xz = x2 * len;

        const y0 = zy * xz - zz * xy, y1 = zz * xx - zx * xz, y2 = zx * xy - zy * xx;
        // len = Math.sqrt(y0*y0 + y1*y1 + y2*y2); // Should be 1 already if up is normalized and perpendicular
        // Just normalize to be safe
        len = 1 / Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
        const yx = y0 * len, yy = y1 * len, yz = y2 * len;

        return new Float32Array([
            xx, yx, zx, 0,
            xy, yy, zy, 0,
            xz, yz, zz, 0,
            -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1
        ]);
    }
}