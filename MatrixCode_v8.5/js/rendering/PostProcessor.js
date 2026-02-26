// =========================================================================
// POST PROCESSOR
// =========================================================================

class PostProcessor {
    constructor(config, gl = null) {
        this.config = config;
        this.gl = gl;
        this.codeProgram1 = null; 
        this.codeProgram2 = null;
        this.effectProgram = null; 
        this.program = null; // Custom User Shader
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
        this.compileShader(this.config.get('customShader'));
        this.compileEffectShader(this.config.get('effectShader'));
        this.compileCodeShader1(this.config.get('codeShader1'));
        this.compileCodeShader2(this.config.get('codeShader2'));
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
        this.compileShader(this.config.get('customShader'));
        this.compileEffectShader(this.config.get('effectShader'));
        this.compileCodeShader1(this.config.get('codeShader1'));
        this.compileCodeShader2(this.config.get('codeShader2'));
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
        this.program = fragSource ? this._compileProgram(fragSource) : null;
    }

    compileEffectShader(fragSource) {
        this.effectProgram = fragSource ? this._compileProgram(fragSource) : null;
    }

    compileCodeShader1(fragSource) {
        this.codeProgram1 = fragSource ? this._compileProgram(fragSource) : null;
    }

    compileCodeShader2(fragSource) {
        this.codeProgram2 = fragSource ? this._compileProgram(fragSource) : null;
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
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        
        [this.texture, this.intermediateTex1, this.intermediateTex2].forEach(tex => {
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        });
    }

    _applyChain(activePasses, currentInput, currentFlip, targetFBO, time, mouseX, mouseY) {
        let input = currentInput;
        let flip = currentFlip;
        let activeFBO = this.framebuffer1;
        let activeTex = this.intermediateTex1;

        // CRITICAL: Disable blending so full-screen passes strictly overwrite 
        // the cleared FBOs instead of pre-multiplying their alpha.
        this.gl.disable(this.gl.BLEND);

        for (let i = 0; i < activePasses.length; i++) {
            const isLast = (i === activePasses.length - 1);
            
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, isLast ? targetFBO : activeFBO);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            this._drawPass(activePasses[i].prog, input, time, mouseX, mouseY, activePasses[i].param, flip);
            
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

    renderCodePasses(source, time, mouseX, mouseY, params, targetFBO = null) {
        if (!this.gl) return;
        const activePasses = [
            { prog: this.codeProgram1, param: params.code1 !== undefined ? params.code1 : 0.5 },
            { prog: this.codeProgram2, param: params.code2 !== undefined ? params.code2 : 0.5 }
        ].filter(p => p.prog !== null);

        if (activePasses.length === 0) {
            // No code shaders, just copy source to target if target is different
            if (targetFBO !== null) {
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
                this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
                this._drawPass(this.defaultProgram, source, time, mouseX, mouseY, 0.5, 0.0);
            }
            return;
        }

        this._applyChain(activePasses, source, 0.0, targetFBO, time, mouseX, mouseY);
    }

    renderFinalPasses(source, time, mouseX, mouseY, params, targetFBO = null) {
        if (!this.gl) return;
        const activePasses = [
            { prog: this.effectProgram, param: params.effect !== undefined ? params.effect : 0.0 },
            { prog: this.program || this.defaultProgram, param: params.custom !== undefined ? params.custom : 0.5 }
        ].filter(p => p.prog !== null);

        this._applyChain(activePasses, source, 0.0, targetFBO, time, mouseX, mouseY);
    }

    render(source, time, mouseX = 0, mouseY = 0, params = {}, targetFBO = null) {
        if (!this.gl) return;

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

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        // Filter active passes
        const activePasses = [
            { prog: this.codeProgram1, param: params.code1 !== undefined ? params.code1 : 0.5 },
            { prog: this.codeProgram2, param: params.code2 !== undefined ? params.code2 : 0.5 },
            { prog: this.effectProgram, param: params.effect !== undefined ? params.effect : 0.0 },
            { prog: this.program || this.defaultProgram, param: params.custom !== undefined ? params.custom : 0.5 }
        ].filter(p => p.prog !== null);
        
        if (activePasses.length === 0) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFBO);
            this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
            this._drawPass(this.defaultProgram, inputTex, time, mouseX, mouseY, 0.5, flipY);
            return;
        }

        this._applyChain(activePasses, inputTex, flipY, targetFBO, time, mouseX, mouseY);
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
        this.gl.uniform2f(uRes, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
        
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
