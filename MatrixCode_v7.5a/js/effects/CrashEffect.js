class CrashEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "CrashSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = 3; // TESTING ONLY: 3s Total
        this.currentPhase = 0; 
        this.originalShader = null;
        this.originalShaderEnabled = false;
        this.originalShaderParameter = 0.5;
        this.frame = 0; // Local frame counter

        this.snapshotOverlay = new Map(); 
        this.blackSheets = []; 
        
        this._phaseCache = {
            superman5: { vines: [] } 
        };

        this.phases = [
            { id: '1a', duration: 3, description: 'Sheets + Deja Vu' }, 
            // Others ignored
            { id: '1b', duration: 8, description: 'placeholder' },
            { id: '2', duration: 5, description: 'placeholder' },
            { id: '3', duration: 8, description: 'placeholder' },
            { id: '4', duration: 8, description: 'placeholder' },
            { id: '5', duration: 15, description: 'placeholder' },
            { id: '6', duration: 5, description: 'placeholder' },
            { id: '7', duration: 3, description: 'placeholder' },
        ];
    }

    trigger() {
        if (this.active) return false;

        this.originalShaderEnabled = this.c.state.shaderEnabled;
        this.originalShader = this.c.state.customShader;
        this.originalShaderParameter = this.c.state.shaderParameter;

        this.c.set('shaderEnabled', true);
        this.c.set('customShader', `
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
`);
        
        this.c.set('shaderParameter', 0.0); 

        this.active = true;
        this.startTime = performance.now();
        this.currentPhase = 0;
        this.frame = 0; // Reset frame
        this.snapshotOverlay.clear(); 
        this.blackSheets = []; 
        console.log("CrashEffect Triggered (3s Test)");
        return true;
    }

    update() {
        if (!this.active) return;
        
        this.frame++; // Increment local frame

        const elapsedTime = (performance.now() - this.startTime) / 1000;
        let progress = elapsedTime / this.durationSeconds;

        if (progress >= 1.0) {
            this.active = false;
            this.c.set('customShader', this.originalShader);
            this.c.set('shaderEnabled', this.originalShaderEnabled);
            this.c.set('shaderParameter', this.originalShaderParameter);
            this.snapshotOverlay.clear();
            this.blackSheets = [];
            console.log("CrashEffect Finished");
            return;
        }

        let accumulatedDuration = 0;
        let phaseFound = false;
        for (let i = 0; i < this.phases.length; i++) {
            accumulatedDuration += this.phases[i].duration;
            if (elapsedTime < accumulatedDuration) {
                this.currentPhase = i;
                phaseFound = true;
                break;
            }
        }
        if (!phaseFound) this.currentPhase = this.phases.length - 1;

        // --- JS LOGIC ---
        
        this._updateBlackSheets();
        this._updateSnapshots();

        const phaseId = this.phases[this.currentPhase].id;

        if (phaseId === '1a') {
            if (Math.random() < 0.03) { 
                this._triggerWhiteBlock();
            }
        }
    }

    _updateBlackSheets() {
        if (this.blackSheets.length < 200) {
            if (Math.random() < 0.8) { 
                const grid = this.g;
                const r = Math.random();
                let w, h;
                if (r < 0.4) { w = Math.floor(Math.random() * 4) + 1; h = Math.floor(Math.random() * 4) + 1; } 
                else if (r < 0.8) { w = Math.floor(Math.random() * 8) + 5; h = Math.floor(Math.random() * 8) + 5; } 
                else { w = Math.floor(Math.random() * 13) + 13; h = Math.floor(Math.random() * 13) + 13; }
                
                let c;
                if (Math.random() < 0.6) { 
                    if (Math.random() < 0.5) c = Math.floor(Math.random() * (grid.cols * 0.3)); 
                    else c = Math.floor(grid.cols * 0.7 + Math.random() * (grid.cols * 0.3)) - w; 
                    if (c < 0) c = 0; 
                } else {
                    c = Math.floor(Math.random() * (grid.cols - w)); 
                }
                
                const row = Math.floor(Math.random() * (grid.rows - h));
                const duration = Math.floor(Math.random() * 120) + 60; 
                const axis = Math.random() < 0.5 ? 0 : 1;
                const expandAmount = Math.floor(Math.random() * w) + 2; 
                
                this.blackSheets.push({ c, r: row, w, h, axis, expandAmount, age: 0, life: duration });
            }
        }
        for (let i = this.blackSheets.length - 1; i >= 0; i--) {
            const s = this.blackSheets[i];
            s.age++;
            if (s.age >= s.life) this.blackSheets.splice(i, 1);
        }
    }

    _triggerWhiteBlock() {
        const grid = this.g;
        // 1 or 2 instances
        const count = Math.random() < 0.5 ? 1 : 2;
        
        for (let k = 0; k < count; k++) {
            const h = 11; 
            const r = Math.floor(Math.random() * (grid.rows - h));
            const duration = 18; // 0.3s
            const endFrame = this.frame + duration; // Use local frame
            
            for (let row = r; row < r + h; row++) {
                for (let col = 0; col < grid.cols; col++) {
                    const i = row * grid.cols + col;
                    this.snapshotOverlay.set(i, {
                        char: grid.getChar(i), 
                        color: '#FFFFFF',
                        alpha: 1.0,
                        endFrame: endFrame,
                        isFrozen: true
                    });
                }
            }
        }
    }

    _updateSnapshots() {
        const currentFrame = this.frame; // Use local frame
        for (const [index, snapshot] of this.snapshotOverlay.entries()) {
            if (currentFrame > snapshot.endFrame) {
                this.snapshotOverlay.delete(index);
            } else {
                const rem = snapshot.endFrame - currentFrame;
                if (rem < 5) snapshot.alpha = rem / 5.0; 
            }
        }
    }

    _triggerSnapshot(isColumn) {}
    _generateVines() {}

    getOverride(i) {
        if (!this.active) return null;

        const grid = this.g;
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);

        const snapshot = this.snapshotOverlay.get(i);
        if (snapshot) {
            return {
                char: snapshot.char,
                color: snapshot.color,
                alpha: snapshot.alpha,
                glow: 10,
                size: 0,
                solid: false, 
                blend: true
            };
        }

        for (const s of this.blackSheets) {
            const progress = s.age / s.life;
            let curW = s.w;
            let curH = s.h;
            if (s.axis === 0) curW += s.expandAmount * progress; 
            else curH += s.expandAmount * progress; 
            
            if (col >= s.c && col < s.c + curW &&
                row >= s.r && row < s.r + curH) {
                return {
                    solid: true,
                    bgColor: '#000000', 
                    alpha: 1.0,
                    color: '#000000', 
                    char: ' ' 
                };
            }
        }
        
        return null;
    }
}