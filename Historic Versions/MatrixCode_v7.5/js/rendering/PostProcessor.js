class PostProcessor {
    constructor(config) {
        this.config = config;
        this.gl = null;
        this.program = null;
        this.canvas = document.createElement('canvas'); // Offscreen WebGL canvas
        this.texture = null;
        this.positionBuffer = null;
        
        this.defaultFragmentShader = `
            precision mediump float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            varying vec2 vTexCoord;
            
            void main() {
                gl_FragColor = texture2D(uTexture, vTexCoord);
            }
        `;
        
        this.vertexShaderSource = `
            attribute vec2 aPosition;
            varying vec2 vTexCoord;
            void main() {
                // Map -1..1 to 0..1 for tex coords (flip Y if needed)
                vTexCoord = (aPosition + 1.0) * 0.5;
                vTexCoord.y = 1.0 - vTexCoord.y; 
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;
        
        this._initWebGL();
    }

    _initWebGL() {
        this.gl = this.canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
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
        
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        
        this.compileShader(this.config.get('customShader') || this.defaultFragmentShader);
    }

    compileShader(fragSource) {
        if (!this.gl) return;
        
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
        
        if (!vs || !fs) return; // Compilation failed

        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, vs);
        this.gl.attachShader(prog, fs);
        this.gl.linkProgram(prog);
        
        if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
            console.warn("Program Link Error", this.gl.getProgramInfoLog(prog));
            return;
        }
        
        this.program = prog;
    }

    resize(width, height) {
        if (!this.gl) return;
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    render(sourceCanvas, time) {
        if (!this.gl || !this.program) return;

        this.gl.useProgram(this.program);

        // Bind Vertex Buffer
        const posLoc = this.gl.getAttribLocation(this.program, 'aPosition');
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(posLoc);
        this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

        // Update Texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, sourceCanvas);
        
        // Uniforms
        const uTex = this.gl.getUniformLocation(this.program, 'uTexture');
        this.gl.uniform1i(uTex, 0);
        
        const uRes = this.gl.getUniformLocation(this.program, 'uResolution');
        this.gl.uniform2f(uRes, this.canvas.width, this.canvas.height);
        
        const uTime = this.gl.getUniformLocation(this.program, 'uTime');
        this.gl.uniform1f(uTime, time);

        // Draw
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
}
