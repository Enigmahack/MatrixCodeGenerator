// =========================================================================
// POST PROCESSOR
// =========================================================================

class PostProcessor {
    constructor(config) {
        this.config = config;
        this.gl = null;
        this.program = null; // Custom User Shader
        this.effectProgram = null; // System Effect Shader (e.g. Deja Vu)
        this.canvas = document.createElement('canvas'); // Offscreen WebGL canvas
        
        // Textures
        this.texture = null; // Source Input
        this.intermediateTexture = null; // Output of Pass 1
        
        // Buffers
        this.positionBuffer = null;
        this.framebuffer = null; // For Pass 1
        
        this.defaultFragmentShader = `
            precision mediump float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec2 uMouse;
            uniform float uParameter;
            varying vec2 vTexCoord;
            
            void main() {
                gl_FragColor = texture2D(uTexture, vTexCoord);
            }
        `;
        
        this.vertexShaderSource = `
            attribute vec2 aPosition;
            varying vec2 vTexCoord;
            uniform float uFlipY;
            void main() {
                // Map -1..1 to 0..1 for tex coords
                vTexCoord = (aPosition + 1.0) * 0.5;
                if (uFlipY > 0.5) {
                    vTexCoord.y = 1.0 - vTexCoord.y; 
                }
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;
        
        this._initWebGL();
    }

    _initWebGL() {
        this.gl = this.canvas.getContext('webgl', { 
            alpha: true, 
            preserveDrawingBuffer: true 
        });
        if (!this.gl) {
            console.warn("WebGL not supported for Post Processing");
            return;
        }
        
        // Full screen quad
        const vertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1
        ]);
        
        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
        
        // Input Texture
        this.texture = this._createTexture();
        // Intermediate Texture (for Pass 1 output)
        this.intermediateTexture = this._createTexture();
        
        // Framebuffer for Pass 1
        this.framebuffer = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.intermediateTexture, 0);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        
        this.defaultProgram = this._compileProgram(this.defaultFragmentShader);
        
        this.compileShader(this.config.get('customShader'));
        this.compileEffectShader(this.config.get('effectShader'));
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

    compileShader(fragSource) {
        if (!fragSource) {
            this.program = null;
            return;
        }
        this.program = this._compileProgram(fragSource);
    }

    compileEffectShader(fragSource) {
        if (!fragSource) {
            this.effectProgram = null;
            return;
        }
        this.effectProgram = this._compileProgram(fragSource);
    }

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
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Resize textures
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.intermediateTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    }

    render(sourceCanvas, time, mouseX = 0, mouseY = 0, param = 0.5, effectParam = 0.0) {
        if (!this.gl) return;

        // Ensure state is clean before we start
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Upload Source to Input Texture
        this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, sourceCanvas);

        let inputTex = this.texture;
        let flipY = 1.0; // Default: Flip Y for Canvas source

        // PASS 1: Effect Shader (e.g. Deja Vu)
        if (this.effectProgram) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT); // Clear intermediate FBO
            
            this._drawPass(this.effectProgram, inputTex, time, mouseX, mouseY, effectParam, flipY);
            
            // Output of Pass 1 becomes Input of Pass 2
            inputTex = this.intermediateTexture;
            flipY = 0.0; // Next pass uses FBO source, no flip needed
        }

        // PASS 2: Custom Shader (Final Post-Process)
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); // Draw to screen (canvas)
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        const prog = this.program || this.defaultProgram;
        this._drawPass(prog, inputTex, time, mouseX, mouseY, param, flipY);
    }

    _drawPass(prog, texture, time, mouseX, mouseY, param, flipY) {
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
        this.gl.uniform2f(uRes, this.canvas.width, this.canvas.height);
        
        const uTime = this.gl.getUniformLocation(prog, 'uTime');
        this.gl.uniform1f(uTime, time);

        const uMouse = this.gl.getUniformLocation(prog, 'uMouse');
        if (uMouse) this.gl.uniform2f(uMouse, mouseX, mouseY);

        const uParam = this.gl.getUniformLocation(prog, 'uParameter');
        if (uParam) this.gl.uniform1f(uParam, param);
        
        const uFlip = this.gl.getUniformLocation(prog, 'uFlipY');
        if (uFlip) this.gl.uniform1f(uFlip, flipY);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
}