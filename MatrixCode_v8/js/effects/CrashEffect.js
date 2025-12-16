class CrashEffect extends AbstractEffect {
    constructor(g, c, registry) {
        super(g, c);
        this.registry = registry; 
        this.name = "CrashSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = this.c.get('crashDurationSeconds') || 30; 
        
        this.originalShader = null;
        this.originalShaderEnabled = false;
        this.originalShaderParameter = 0.5;
        this.originalFade = 0; // To store/restore fade speed
        this.frame = 0;

        this.snapshotOverlay = new Map(); 
        this.blackSheets = []; 
        
        this.supermanState = {
            active: false,
            type: 0, 
            cells: new Set(), 
            flickerTimer: 0,
            globalTimer: 0
        };
        
        this.shaderState = {
            activeId: 0, 
            timer: 0,
            duration: 0
        };
        
        this.smithState = { active: false, triggered: false, timer: 0, duration: 60 };
        this.sheetState = { spawning: true, timer: 600 };
        
        this.flashState = {
            active: false,
            timer: 0,
            duration: 40, 
            nextFlash: 60, 
            cycleDuration: 240
        };
        
        this.MAX_BLACK_LEVEL = 0.5; 
        this.baseBlackLevel = this.MAX_BLACK_LEVEL; 
        this.endFlashTriggered = false;
        this.sheetFadeVal = 1.0;
    }

    trigger() {
        if (this.active) return false;

        this.originalShaderEnabled = this.c.state.shaderEnabled;
        this.originalShader = this.c.state.customShader;
        this.originalShaderParameter = this.c.state.shaderParameter;
        
        // OVERRIDE: Disable stream fade during crash (Fix #3)
        this.originalFade = this.c.get('decayFadeDurationFrames');
        this.c.set('decayFadeDurationFrames', 0);

        // Get Stream Color for the Splash
        const colorStr = this.c.derived.streamColorStr || '#00FF00';
        const rgb = Utils.hexToRgb(colorStr);
        const vec3Color = `vec3(${rgb.r/255.0}, ${rgb.g/255.0}, ${rgb.b/255.0})`;

        this.c.set('shaderEnabled', true);
        this.c.set('customShader', `
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uParameter; 
varying vec2 vTexCoord;

// --- UTILS ---
float random(float n) { return fract(sin(n) * 43758.5453123); }
float rect(vec2 uv, vec2 pos, vec2 size) {
    vec2 d = abs(uv - pos) - size;
    return 1.0 - step(0.0, max(d.x, d.y));
}
float scannerSheet(vec2 uv, vec2 center, vec2 size, float blur, int axis) {
    vec2 pos = uv - center;
    vec2 d = abs(pos) - size;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    return 1.0 - smoothstep(0.0, blur, dist);
}

void main() {
    vec2 uv = vTexCoord;
    float phase_idx = floor(uParameter + 0.001);
    float progress = fract(uParameter); 
    
    vec4 finalColor = texture2D(uTexture, uv);
    vec3 splashColor = ${vec3Color};

    // --- PHASE 10: SPLASH EFFECT ---
    if (phase_idx == 10.0) {
         float t = progress; 
         float bar = scannerSheet(uv, vec2(0.5, 0.5), vec2(1.0, 0.2), 0.3, 1);
         float flashAlpha = bar * (1.0 - smoothstep(0.0, 0.6, t));
         if (flashAlpha > 0.0) {
            finalColor.rgb += splashColor * flashAlpha * 3.0; 
         }
    }

    // --- PHASE 2: DISTORTION ---
    if (phase_idx == 2.0) {
        vec2 center = vec2(0.5, 0.5);
        vec2 dist = uv - center;
        dist.y *= 0.02; 
        vec4 distColor = texture2D(uTexture, center + dist);
        distColor.rgb *= 1.5;
        float active = 1.0 - ((progress - 0.66) / 0.34);
        if (active > 0.0) finalColor = mix(finalColor, distColor, 0.5 * active);
    }
    
    // --- PHASE 9: STRETCH ---
    if (phase_idx == 9.0) {
        float sampleX = 0.3;
        vec4 stretchColor = texture2D(uTexture, vec2(sampleX, uv.y));
        float flicker = 0.5 + 0.5 * sin(progress * 30.0); 
        if (abs(uv.x - 0.33) < 0.05) { stretchColor.rgb *= 0.3; }
        stretchColor.rgb *= (1.0 + flicker);
        float alpha = (0.5 + 0.5 * flicker) * (1.0 - progress); 
        finalColor = mix(finalColor, stretchColor, alpha);
    }
    
    gl_FragColor = finalColor;
}
`);
        
        this.c.set('shaderParameter', 0.0); 

        this.active = true;
        this.startTime = performance.now();
        this.frame = 0;
        this.snapshotOverlay.clear(); 
        this.blackSheets = []; 
        this.supermanState = { active: false, type: 0, cells: new Set(), flickerTimer: 0, globalTimer: 0 };
        this.shaderState = { activeId: 0, timer: 0, duration: 0 };
        this.smithState = { active: false, triggered: false, timer: 0, duration: 60 };
        this.sheetState = { spawning: true, timer: 600 };
        this.endFlashTriggered = false;
        this.sheetFadeVal = 1.0;
        
        this.flashState.active = false;
        this.flashState.nextFlash = 30; 
        
        this.MAX_BLACK_LEVEL = 0.5;
        this.baseBlackLevel = this.c.get('crashEnableFlash') ? this.MAX_BLACK_LEVEL : 0.0; 

        return true;
    }

    update() {
        if (!this.active) return;
        
        this.frame++; 
        const elapsedTime = (performance.now() - this.startTime) / 1000;
        this.durationSeconds = this.c.get('crashDurationSeconds') || 30;
        const progress = elapsedTime / this.durationSeconds;

        this.sheetFadeVal = Math.min(1.0, this.sheetFadeVal + (1.0 / 45.0));
        const sheetOpacity = this.c.get('crashSheetOpacity');
        this.MAX_BLACK_LEVEL = Math.min(0.5, sheetOpacity); 
        
        // Trigger End Pulse
        if (progress > 0.92 && !this.endFlashTriggered) {
            this.endFlashTriggered = true;
            if (this.registry) {
                const originalPulseDelay = this.c.get('pulseDelaySeconds');
                this.c.set('pulseDelaySeconds', 0.1);
                this.registry.trigger('Pulse');
                this.c.set('pulseDelaySeconds', originalPulseDelay);
            }
        }

        // --- END ---
        if (progress >= 1.0) {
            this.active = false;
            this.c.set('customShader', this.originalShader);
            this.c.set('shaderEnabled', this.originalShaderEnabled);
            this.c.set('shaderParameter', this.originalShaderParameter);
            this.c.set('decayFadeDurationFrames', this.originalFade); // Restore Fade
            this.snapshotOverlay.clear();
            this.blackSheets = [];
            this.supermanState.cells.clear();
            return;
        }

        // --- FLASH & FADE LOGIC ---
        const enableFlash = this.c.get('crashEnableFlash');
        if (enableFlash) {
            this.baseBlackLevel = this.MAX_BLACK_LEVEL * this.sheetFadeVal;
            if (this.flashState.active) {
                this.flashState.timer++;
                const p = Math.min(1.0, this.flashState.timer / this.flashState.duration);
                this.c.set('shaderParameter', 10.0 + p);
                if (this.flashState.timer === 1) this.sheetFadeVal = 0.0; 
                if (this.flashState.timer >= this.flashState.duration) {
                    this.flashState.active = false;
                    this.c.set('shaderParameter', 0.0);
                }
            } else {
                this.flashState.nextFlash--;
                if (this.flashState.nextFlash <= 0) this._triggerFlash();
            }
        } else {
            this.baseBlackLevel = 0.0;
            this.c.set('shaderParameter', 0.0);
        }
        
        // --- SHADERS ---
        if (!this.flashState.active) {
            if (this.shaderState.activeId === 0) {
                 if (Math.random() < 0.01) {
                    const r = Math.random();
                    let id = 0; let dur = 0;
                    if (r < 0.3) { id = 3; dur = 20; } // These IDs need to match shader code or be unused
                    else if (r < 0.6) { id = 9; dur = 30; } // Phase 9 is implemented
                    else { id = 2; dur = 40; } // Phase 2 is implemented
                    
                    if (id === 2 || id === 9) {
                        this.shaderState.activeId = id;
                        this.shaderState.duration = dur;
                        this.shaderState.timer = 0;
                    }
                 }
            } else {
                this.shaderState.timer++;
                if (this.shaderState.timer >= this.shaderState.duration) {
                    this.shaderState.activeId = 0;
                    this.c.set('shaderParameter', 0.0);
                } else {
                    const p = this.shaderState.timer / this.shaderState.duration;
                    this.c.set('shaderParameter', this.shaderState.activeId + p);
                }
            }
        }

        // --- BLACK SHEETS ---
        const maxSheets = this.c.get('crashSheetCount');
        this.sheetState.timer--;
        if (this.sheetState.timer <= 0) {
            this.sheetState.spawning = !this.sheetState.spawning;
            this.sheetState.timer = this.sheetState.spawning ? 400 : 200; 
        }
        if (this.sheetState.spawning) this._updateBlackSheets(maxSheets);
        if (this.blackSheets.length > maxSheets) this.blackSheets.splice(maxSheets);
        
        // Update Sheets
        const userSpeed = this.c.get('crashSheetSpeed');
        for (const s of this.blackSheets) {
            s.maxAlpha = sheetOpacity * this.sheetFadeVal;
            if (s.baseDx === undefined) { s.baseDx = s.dx; s.baseDy = s.dy; }
            s.posX += s.baseDx * userSpeed; 
            s.posY += s.baseDy * userSpeed;
            if (s.posX <= -s.w * 0.5 || s.posX >= this.g.cols - s.w * 0.5) s.baseDx *= -1;
            if (s.posY <= -s.h * 0.5 || s.posY >= this.g.rows - s.h * 0.5) s.baseDy *= -1;
            s.w += (s.targetW - s.w) * 0.05; s.h += (s.targetH - s.h) * 0.05;
            s.currentAlpha += (s.targetAlpha - s.currentAlpha) * 0.1;
        }

        // --- SUPERMAN (Lightning) ---
        if (this.c.get('crashEnableSuperman')) {
            if (this.supermanState.active) {
                this.supermanState.globalTimer--;
                this.supermanState.flickerTimer++;
                if (this.supermanState.flickerTimer > 2) {
                    this._generateSupermanBolt();
                    this.supermanState.flickerTimer = 0;
                }
                if (this.supermanState.globalTimer <= 0) {
                    this.supermanState.active = false;
                    this.supermanState.cells.clear();
                }
            } else {
                // Random trigger
                if (Math.random() < 0.02) {
                    const type = Math.random() < 0.5 ? 0 : 1; 
                    this._triggerSuperman(type);
                }
            }
        } else {
            this.supermanState.active = false;
        }
        
        // --- OTHER ELEMENTS ---
        this._updateSnapshots();
        if (Math.random() < 0.02) this._triggerWhiteBlock(); 
        if (Math.random() < 0.02) this._triggerColumnBurst(); 
        
        if (this.c.get('crashEnableSmith')) {
            if (!this.smithState.triggered && Math.random() < 0.005) { 
                this._triggerSmith();
            }
            if (this.smithState.active) {
                this.smithState.timer--;
                if (this.smithState.timer <= 0) this.smithState.active = false;
            }
        }
        
        if (this.registry) { 
            if (Math.random() < 0.001) this.registry.trigger('ClearPulse');
        }
    }
    
    applyToGrid(grid) {
        if (!this.active) return;
        
        const cols = grid.cols;
        const rows = grid.rows;

        // 1. Black Sheets (Fix #2: Rendering)
        if (this.baseBlackLevel > 0.01 || this.blackSheets.length > 0) {
            // Apply sheets
            for (const s of this.blackSheets) {
                 const minX = Math.floor(s.posX);
                 const maxX = Math.floor(s.posX + s.w);
                 const minY = Math.floor(s.posY);
                 const maxY = Math.floor(s.posY + s.h);
                 const sAlpha = s.currentAlpha * s.maxAlpha;

                 if (sAlpha < 0.01) continue;

                 // Clamp to grid
                 const rMinX = Math.max(0, minX);
                 const rMaxX = Math.min(cols, maxX);
                 const rMinY = Math.max(0, minY);
                 const rMaxY = Math.min(rows, maxY);

                 for (let y = rMinY; y < rMaxY; y++) {
                     const rowOffset = y * cols;
                     const ny = (y - s.posY) / s.h; // normalized Y 0..1 in sheet
                     
                     for (let x = rMinX; x < rMaxX; x++) {
                         const nx = (x - s.posX) / s.w; // normalized X 0..1
                         
                         // Edge Fade
                         const edgeFade = Math.min(nx/0.2, (1-nx)/0.2, ny/0.2, (1-ny)/0.2, 1.0);
                         const finalAlpha = sAlpha * edgeFade;
                         
                         if (finalAlpha > 0.01) {
                            grid.setSolidOverride(rowOffset + x, 0xFF000000, finalAlpha);
                         }
                     }
                 }
            }
            
            // Global Fade (during flash/flicker)
            if (this.baseBlackLevel > 0.05) {
                 for (let i = 0; i < grid.rows * grid.cols; i++) {
                     // Check if already solidly overridden (optimization?)
                     // Just overwrite with max alpha if needed, or blend?
                     // setSolidOverride overwrites. 
                     // We probably want to apply global fade only where no sheet is present?
                     // Or just iterate and set.
                     // A simple global loop:
                     if (grid.overrideActive[i] === 0) { // Only affect non-overridden cells
                        grid.setSolidOverride(i, 0xFF000000, this.baseBlackLevel);
                     }
                 }
            }
        }

        // 2. Superman Lightning (Fix #1: Rendering & Logic)
        if (this.supermanState.active && this.supermanState.cells.size > 0) {
            for (const idx of this.supermanState.cells) {
                // Bright White/Green Bolt
                const char = grid.getChar(idx);
                // 0xFFFFFFFF (White) or Greenish? User said "Superman effect".
                // Superman usually uses White center, Green glow.
                grid.setOverride(idx, char, 0xFFFFFFFF, 1.0, grid.fontIndices[idx], 5.0);
            }
        }

        // 3. Snapshots (Smith / White Blocks)
        for (const [idx, snap] of this.snapshotOverlay) {
             if (snap.alpha <= 0.01) continue;
             const char = snap.char;
             const color = Utils.hexToRgb(snap.color); // Need packed
             const packedColor = Utils.packAbgr(color.r, color.g, color.b);
             
             // Snapshots are solid text overrides
             grid.setOverride(idx, char, packedColor, snap.alpha, grid.fontIndices[idx], snap.isSmith ? 0 : 8.0);
        }
    }

    _triggerFlash() {
        this.flashState.active = true;
        this.flashState.timer = 0;
        this.flashState.duration = 40; 
        const minS = this.c.get('crashFlashDelayMin');
        const maxS = this.c.get('crashFlashDelayMax');
        this.flashState.nextFlash = (minS + Math.random() * (maxS - minS)) * 60; 
    }

    _updateBlackSheets(maxSheets) {
        if (this.blackSheets.length < maxSheets) { 
            if (Math.random() < 0.4) { 
                const grid = this.g;
                const r = Math.random();
                let w, h;
                if (r < 0.4) { w = Utils.randomInt(4, 8); h = Utils.randomInt(4, 8); } 
                else if (r < 0.8) { w = Utils.randomInt(8, 16); h = Utils.randomInt(8, 16); } 
                else { w = Utils.randomInt(16, 24); h = Utils.randomInt(16, 24); }
                
                let c = Math.floor(Math.random() * (grid.cols - w));
                let row = Math.floor(Math.random() * (grid.rows - h));
                const speedScale = (Math.random() * 1.5 + 0.5); 
                
                this.blackSheets.push({ 
                    c, r: row, w, h,
                    posX: c, posY: row, 
                    baseDx: (Math.random() - 0.5) * speedScale, 
                    baseDy: (Math.random() - 0.5) * speedScale, 
                    targetW: w, targetH: h, 
                    maxAlpha: this.c.get('crashSheetOpacity'), 
                    currentAlpha: 0.0, targetAlpha: 1.0 
                });
            }
        }
    }

    _getFontName(i) {
        const fontIdx = this.g.fontIndices[i];
        const fonts = this.c.derived.activeFonts;
        return (fonts && fonts[fontIdx]) ? fonts[fontIdx].name : this.c.state.fontFamily;
    }

    _triggerSmith() {
        this.smithState.triggered = true;
        this.smithState.active = true;
        this.smithState.timer = 60; 
        const grid = this.g;
        const w = Math.floor(grid.cols * 0.8);
        const h = Math.floor(grid.rows * 0.8);
        const startC = Math.floor((grid.cols - w) / 2);
        const startR = Math.floor((grid.rows - h) / 2);
        const endFrame = this.frame + 60;
        
        for (let r = 0; r < h; r++) {
            for (let c = 0; c < w; c++) {
                const nx = c / w;
                const ny = r / h;
                const i = (startR + r) * grid.cols + (startC + c);
                const dx = nx - 0.5;
                const dy = ny - 0.3;
                const headDist = (dx*dx)/(0.2*0.2) + (dy*dy)/(0.3*0.3);
                let isSmithPixel = false;
                let brightness = 0.0;
                
                if (headDist < 1.0) { isSmithPixel = true; brightness = 0.5; if (ny > 0.28 && ny < 0.34 && Math.abs(nx - 0.5) < 0.18) brightness = 0.0; if (ny > 0.65) brightness = 0.2; if (ny > 0.65 && Math.abs(nx - 0.5) < 0.04) brightness = 0.8; }
                if (ny > 0.65 && Math.abs(nx - 0.5) < 0.45) { isSmithPixel = true; if (Math.abs(nx - 0.5) < 0.04) brightness = 0.8; else brightness = 0.2; }
                
                if (isSmithPixel) {
                    this.snapshotOverlay.set(i, {
                        char: grid.getChar(i), color: '#00FF00', // Simplified
                        alpha: brightness, endFrame: endFrame, isSmith: true
                    });
                }
            }
        }
    }

    _triggerSuperman(type) {
        this.supermanState.active = true;
        this.supermanState.type = type; 
        this.supermanState.globalTimer = 60; // Short duration
        this.supermanState.flickerTimer = 0;
        this._generateSupermanBolt();
    }

    _generateSupermanBolt() {
        const s = this.supermanState;
        s.cells.clear();
        const grid = this.g;
        const cx = Math.floor(grid.cols / 2);
        const cy = Math.floor(grid.rows / 2);
        
        // Fix #1: Diagonal Variations
        if (s.type === 0) {
            // Variation 1: Main Diagonal Bolt (just before center to axis/corner)
            const dirX = Math.random() < 0.5 ? 1 : -1;
            const dirY = Math.random() < 0.5 ? 1 : -1;
            
            const startX = cx - (dirX * Utils.randomInt(2, 5));
            const startY = cy - (dirY * Utils.randomInt(2, 5));
            
            // Extend to edge
            const endX = dirX > 0 ? grid.cols - 1 : 0;
            const endY = dirY > 0 ? grid.rows - 1 : 0;
            
            this._drawJaggedLine(startX, startY, endX, endY, s.cells);
        } else {
            // Variation 2: Branching from Center to Axis (constrained)
            const axis = Math.floor(Math.random() * 4); // 0:Top, 1:Right, 2:Bot, 3:Left
            const startX = cx;
            const startY = cy;
            const numBranches = Utils.randomInt(3, 6);
            
            for(let k=0; k<numBranches; k++) {
                const spread = 0.2 + (Math.random() * 0.6); // Spread along the target edge
                let targetX, targetY;
                if (axis === 0) { targetX = Math.floor(grid.cols * spread); targetY = 0; } 
                else if (axis === 1) { targetX = grid.cols - 1; targetY = Math.floor(grid.rows * spread); }
                else if (axis === 2) { targetX = Math.floor(grid.cols * spread); targetY = grid.rows - 1; }
                else { targetX = 0; targetY = Math.floor(grid.rows * spread); }
                
                this._drawJaggedLine(startX, startY, targetX, targetY, s.cells);
            }
        }
    }
    
    _drawJaggedLine(x0, y0, x1, y1, set) {
        const dist = Math.hypot(x1-x0, y1-y0);
        const steps = Math.ceil(dist * 1.5); // More steps for continuity
        const dx = (x1-x0) / steps;
        const dy = (y1-y0) / steps;
        let cx = x0; let cy = y0;
        
        for(let i=0; i<=steps; i++) {
            // Thin line (no thickness loop)
            const jitter = (Math.random() - 0.5) * 1.5; 
            const px = Math.floor(cx + jitter);
            const py = Math.floor(cy + jitter);
            
            if(px>=0 && px<this.g.cols && py>=0 && py<this.g.rows) {
                set.add(py * this.g.cols + px);
            }
            cx += dx; cy += dy;
        }
    }

    _triggerWhiteBlock() {
        const grid = this.g;
        const h = 11; 
        const r = Math.floor(Math.random() * (grid.rows - h));
        const duration = 18; 
        const endFrame = this.frame + duration;
        for (let row = r; row < r + h; row++) {
            for (let col = 0; col < grid.cols; col++) {
                const i = row * grid.cols + col;
                this.snapshotOverlay.set(i, { 
                    char: grid.getChar(i), color: '#FFFFFF', alpha: 1.0, endFrame: endFrame, isFrozen: true 
                });
            }
        }
    }

    _triggerColumnBurst() {
        const grid = this.g;
        const col = Math.floor(Math.random() * grid.cols);
        let startRow = Math.floor(Math.random() * (grid.rows / 2)); 
        let height = Math.floor(Math.random() * (grid.rows / 2)) + (grid.rows / 4);
        if (Math.random() < 0.3) { startRow = 0; height = grid.rows; }
        const duration = 8; 
        const endFrame = this.frame + duration;
        for (let r = startRow; r < startRow + height && r < grid.rows; r++) {
            const i = r * grid.cols + col;
            this.snapshotOverlay.set(i, { 
                char: Utils.getRandomChar(), color: '#FFFFFF', alpha: 1.0, endFrame: endFrame, isFrozen: true 
            });
        }
    }

    _updateSnapshots() {
        const currentFrame = this.frame; 
        for (const [index, snapshot] of this.snapshotOverlay.entries()) {
            if (currentFrame > snapshot.endFrame) this.snapshotOverlay.delete(index);
            else {
                const rem = snapshot.endFrame - currentFrame;
                if (snapshot.isSmith) { if (rem < 30) snapshot.alpha = rem / 30.0; } 
                else { if (rem < 10) snapshot.alpha = rem / 10.0; }
            }
        }
    }
}