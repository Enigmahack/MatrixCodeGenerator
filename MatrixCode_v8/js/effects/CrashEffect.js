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
        this.crashBars = [];
        this.shadowMap = null;
        
        this.supermanState = {
            active: false,
            type: 0, 
            cells: new Set(), 
            illuminatedCells: new Set(),
            flickerTimer: 0,
            globalTimer: 0,
            boltId: 0
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
        this.crashBars = [];
        this.supermanState = { active: false, type: 0, cells: new Set(), illuminatedCells: new Set(), flickerTimer: 0, globalTimer: 0, boltId: 0 };
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
        this.MAX_BLACK_LEVEL = sheetOpacity; 
        
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
            this.snapshotOverlay.clear();
            this.blackSheets = [];
            this.crashBars = [];
            this.supermanState.cells.clear();
            this.supermanState.illuminatedCells.clear();
            this.supermanState.geometry = null;
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
                    this.supermanState.illuminatedCells.clear();
                    this.supermanState.geometry = null;
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
        
        // Update Crash Bars
        for (let i = this.crashBars.length - 1; i >= 0; i--) {
            const b = this.crashBars[i];
            b.age++;
            if (b.age > b.maxAge) {
                this.crashBars.splice(i, 1);
            }
        }

        if (Math.random() < 0.005) this._triggerWhiteBlock(); 
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
            // ... (Black Sheet Logic - Keeping existing code via surrounding context match if possible, or just rewriting applyToGrid to be safe)
            // To avoid huge replacement, I will match the function start and just replace the Superman section?
            // The instruction is to update applyToGrid. I'll replace the Superman section specifically.
        }
        // ... (Black sheets loop is long) ...
    }
    // Actually, I'll replace the whole applyToGrid method to be clean.
    
    applyToGrid(grid) {
        if (!this.active) return;
        
        const cols = grid.cols;
        const rows = grid.rows;

        // 1. Black Sheets (Additive Accumulation)
        if (this.baseBlackLevel > 0.01 || this.blackSheets.length > 0) {
            const total = cols * rows;
            if (!this.shadowMap || this.shadowMap.length !== total) {
                this.shadowMap = new Float32Array(total);
            } else {
                this.shadowMap.fill(0);
            }

            // Accumulate Opacity
            let activeShadows = false;
            for (const s of this.blackSheets) {
                 const minX = Math.floor(s.posX);
                 const maxX = Math.floor(s.posX + s.w);
                 const minY = Math.floor(s.posY);
                 const maxY = Math.floor(s.posY + s.h);
                 const sAlpha = s.currentAlpha * s.maxAlpha;

                 if (sAlpha < 0.001) continue;

                 const rMinX = Math.max(0, minX);
                 const rMaxX = Math.min(cols, maxX);
                 const rMinY = Math.max(0, minY);
                 const rMaxY = Math.min(rows, maxY);

                 for (let y = rMinY; y < rMaxY; y++) {
                     const rowOffset = y * cols;
                     const ny = (y - s.posY) / s.h;
                     for (let x = rMinX; x < rMaxX; x++) {
                         const nx = (x - s.posX) / s.w;
                         const edgeFade = Math.min(nx/0.2, (1-nx)/0.2, ny/0.2, (1-ny)/0.2, 1.0);
                         const finalAlpha = sAlpha * edgeFade;
                         if (finalAlpha > 0.001) {
                            this.shadowMap[rowOffset + x] += finalAlpha;
                            activeShadows = true;
                         }
                     }
                 }
            }
            
            // Apply to Grid
            if (activeShadows) {
                for (let i = 0; i < total; i++) {
                    const acc = this.shadowMap[i];
                    if (acc > 0.01) {
                        // Clamp to 1.0 max opacity
                        grid.setEffectShadow(i, Math.min(1.0, acc));
                    }
                }
            }
            
            // Global Fade removed to prevent premature blackout. 
            // Sheets provide the shadowbox effect.
        }

        // 2. Superman Lightning (Updated)
        if (this.supermanState.active) {
            const streamColor = this.c.derived.streamColorUint32;
            
            // Render Illuminated Triangle (Background)
            for (const idx of this.supermanState.illuminatedCells) {
                 const char = grid.getChar(idx);
                 // Preserve spaces: Only illuminate if there is a character
                 if (char !== ' ') {
                     // Illuminated: Stream Color, Low Glow, Moderate Alpha
                     grid.setEffectOverride(idx, char, streamColor, 0.5, grid.fontIndices[idx], 0.3);
                 }
            }

            // Render Main Bolt (Foreground)
            if (this.supermanState.cells.size > 0) {
                for (const idx of this.supermanState.cells) {
                    const char = grid.getChar(idx);
                    if (char !== ' ') {
                        // Bolt: Bright White, Moderate Glow
                        grid.setEffectOverride(idx, char, 0xFFFFFFFF, 1.0, grid.fontIndices[idx], 1.0);
                    }
                }
            }
        }

        // 3. Crash Bars (White Blocks) - Rendered on top
        if (this.crashBars.length > 0) {
            const activeFonts = this.c.derived.activeFonts;
            const fontData = activeFonts[0]; // Use default font
            const charSet = fontData.chars;
            
            for (const bar of this.crashBars) {
                const limitY = Math.min(rows, bar.y + bar.h);
                const limitX = Math.min(cols, bar.x + bar.w);
                
                for (let y = bar.y; y < limitY; y++) {
                    const rowOffset = y * cols;
                    for (let x = bar.x; x < limitX; x++) {
                        const idx = rowOffset + x;
                        
                        // Static Random Char based on position and bar ID
                        const seed = Math.floor(idx * 137 + bar.id * 997);
                        const char = charSet[seed % charSet.length];
                        
                        // Random Alpha between 0.75 and 1.0
                        const alphaSeed = Math.floor(idx * 223 + bar.id * 773);
                        const alpha = 0.75 + (alphaSeed % 26) / 100;
                        
                        // White Overlay (Mixes on top of existing code)
                        grid.setEffectOverlay(idx, char, alpha, 0); 
                    }
                }
            }
        }

        // 4. Snapshots (Smith)
        for (const [idx, snap] of this.snapshotOverlay) {
             if (snap.alpha <= 0.01) continue;
             const char = snap.char;
             const color = Utils.hexToRgb(snap.color);
             const packedColor = Utils.packAbgr(color.r, color.g, color.b);
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
        
        const asciiArt = [
            "                                      *##*#*####+                                        ",
            "                                   # @@@%%#%%%%%##*-                                      ",
            "                                  % @%%#*+**+=::=*+-=:                                    ",
            "                                 % @#+                -#                                  ",
            "                                = @#=                  .%                                 ",
            "                                @@#-                   +=                                ",
            "                               = @@%*-:                 + @                                ",
            "                               * @@@#=:.               .+ @                                ",
            "                               * @@@*-                  = @                                ",
            "                               : @@@+-=#@@@@@@@*-+%@@@@@%=                                ",
            "                               -+%%+-*% @@@@@@@.  % @@@%%%%                                ",
            "                              :***%+-:-% @@@@%=   .#%%#*#=                                ",
            "                               :-:*+-:..-++-=     ===-:+:                                ",
            "                                --*#+++=-...-+%###:-===+                                 ",
            "                                 :=**++=--.  :*#*.   :+                                  ",
            "                                   =*+++=-    -===.  .-                                  ",
            "                                   *##**+-+**+.     :-                                   ",
            "                                   **#####**########*                                    ",
            "                                   +*######*+=--.  -*                                    ",
            "                                   +*+*#####********+                                    ",
            "                                   # -++########*#*++ .                                  ",
            "                                 .%*    =*#######*+-  ++                                 ",
            "                              .*#%%#-      =####**    ++=-=.                             ",
            "                         :=+***##%%##        .***     +++=--===--:                       ",
            "                  +++++++++*+*########       :###%    ++++==-+======--                   ",
            "               +***++++++++++****####**      #%**#+    *+++***+====+++++==               ",
            "            =*+*+++++++++++++*%%#*##***+      #**      =++++*++==+********+              ",
            "            %#*++++*++++**+++++*#*#****+      ++*       +++++++++******####*             ",
            "            ###*+++**+++***+++*+++******+     ++*#      -=+++++++*****#%%%##:            ",
            "            ####**+***+++***++#*+++*****+:    =+*##     .=++++==+*****#%%%#%%            ",
            "           -#####******+++****+*++++*****+    =+*##*     =+++===+*#**##%%%#%%-           ",
            "           *%#######***+++*****+*+++++****+   -***#**    =+++===+*#**##%%%% @%%           ",
            "           #%#*###*##***+++*****+#+++++****=  :*#####=   -=++===**#*##%%%%%%%%           ",
            "           #%#*##%##%#**++++****++#+++++***+   =++++++    =++===*#####%%%% @@%%           "
        ];

        const grid = this.g;
        const artHeight = asciiArt.length;
        const artWidth = asciiArt[0].length; // Assuming consistent width or max width
        
        const startR = Math.floor((grid.rows - artHeight) / 2);
        const startC = Math.floor((grid.cols - artWidth) / 2);
        const endFrame = this.frame + 60;
        
        for (let r = 0; r < artHeight; r++) {
            const line = asciiArt[r];
            const rowIdx = startR + r;
            if (rowIdx < 0 || rowIdx >= grid.rows) continue;
            
            for (let c = 0; c < line.length; c++) {
                const char = line[c];
                if (char === ' ') continue; // Skip spaces
                
                const colIdx = startC + c;
                if (colIdx < 0 || colIdx >= grid.cols) continue;
                
                const i = rowIdx * grid.cols + colIdx;
                
                this.snapshotOverlay.set(i, {
                    char: char, 
                    color: '#00FF00', 
                    alpha: 1.0, // Full brightness for ASCII art
                    endFrame: endFrame, 
                    isSmith: true
                });
            }
        }
    }

    _getStaticChar(idx) {
        // Deterministic pseudo-random character based on index and current bolt
        // Simple hash: (idx * magic1 + boltId * magic2) % len
        const seed = Math.floor(idx * 137 + this.supermanState.boltId * 997);
        const charSet = Utils.CHARS;
        return charSet[seed % charSet.length];
    }

    _triggerSuperman(type) {
        this.supermanState.active = true;
        this.supermanState.type = type; 
        this.supermanState.globalTimer = 60; // Short duration
        this.supermanState.flickerTimer = 0;
        this.supermanState.boltId = Math.random() * 1000; // Unique ID for this bolt instance
        this._generateSupermanBolt();
    }

    _generateSupermanBolt() {
        const s = this.supermanState;
        s.cells.clear();
        
        if (!s.geometry) {
            this._initSupermanGeometry();
        }
        
        // Draw Main Path (Jittered) - Thicker
        const g = s.geometry;
        this._drawJaggedLine(g.start.x, g.start.y, g.end.x, g.end.y, s.cells, 2);
        
        // Draw Branches (Jittered)
        if (g.branches) {
            for (const b of g.branches) {
                this._drawJaggedLine(g.split.x, g.split.y, b.x, b.y, s.cells, 1);
            }
        }
    }

    _initSupermanGeometry() {
        const grid = this.g;
        const s = this.supermanState;
        
        // 1. Pick Start/End Corners
        const corners = [
            { x: 0, y: 0 }, // TL
            { x: grid.cols - 1, y: 0 }, // TR
            { x: grid.cols - 1, y: grid.rows - 1 }, // BR
            { x: 0, y: grid.rows - 1 } // BL
        ];
        
        const startIdx = Utils.randomInt(0, 3);
        const endIdx = (startIdx + 2) % 4; // Opposite corner
        
        const start = corners[startIdx];
        const end = corners[endIdx];
        
        s.geometry = { start, end };
        
        // Type 1: Branching
        if (s.type === 1) {
            // Split Point (35-40%)
            const splitT = 0.35 + (Math.random() * 0.05);
            const splitX = Math.floor(start.x + (end.x - start.x) * splitT);
            const splitY = Math.floor(start.y + (end.y - start.y) * splitT);
            s.geometry.split = { x: splitX, y: splitY };
            
            // Calculate Main Bolt Angle
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const mainAngle = Math.atan2(dy, dx);
            
            const branches = [];
            const numBranches = Utils.randomInt(1, 3);
            let furthestBranch = null;
            let maxDist = -1;
            
            // Define adjacent edges for the END corner
            // If end is TL (0,0) -> Edges are Top (y=0) and Left (x=0)
            // If end is TR (w,0) -> Edges are Top (y=0) and Right (x=w)
            // etc.
            
            for (let i = 0; i < numBranches; i++) {
                let tx, ty;
                let attempts = 0;
                let valid = false;
                
                while (!valid && attempts < 10) {
                    attempts++;
                    // Pick one of the two adjacent edges
                    // Edge 1 is Horizontal (y = end.y)
                    // Edge 2 is Vertical (x = end.x)
                    const useHorizontal = Math.random() < 0.5;
                    
                    if (useHorizontal) {
                        ty = end.y;
                        // Random X along that edge (constrain slightly to avoid overlap with start side?)
                        tx = Utils.randomInt(0, grid.cols - 1);
                    } else {
                        tx = end.x;
                        ty = Utils.randomInt(0, grid.rows - 1);
                    }
                    
                    // Check Angle Constraint (< 50 deg)
                    const bDx = tx - splitX;
                    const bDy = ty - splitY;
                    const branchAngle = Math.atan2(bDy, bDx);
                    
                    let diff = Math.abs(branchAngle - mainAngle);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff; // Normalize to 0..PI
                    const deg = diff * (180 / Math.PI);
                    
                    if (deg < 50) {
                        valid = true;
                    }
                }
                
                if (valid) {
                    const bPoint = { x: tx, y: ty };
                    branches.push(bPoint);
                    
                    const d = Math.hypot(tx - splitX, ty - splitY);
                    if (d > maxDist) {
                        maxDist = d;
                        furthestBranch = bPoint;
                    }
                }
            }
            s.geometry.branches = branches;
            
            // Calculate Illuminated Triangle
            // P1: Split, P2: End Corner, P3: Furthest Branch
            if (furthestBranch) {
                this._calculateIlluminatedTriangle(s.geometry.split, end, furthestBranch);
            }
        }
    }

    _calculateIlluminatedTriangle(p1, p2, p3) {
        const grid = this.g;
        const set = this.supermanState.illuminatedCells;
        set.clear();
        
        // Bounding box of triangle
        const minX = Math.min(p1.x, p2.x, p3.x);
        const maxX = Math.max(p1.x, p2.x, p3.x);
        const minY = Math.min(p1.y, p2.y, p3.y);
        const maxY = Math.max(p1.y, p2.y, p3.y);
        
        // Barycentric helper
        const areaOrig = Math.abs((p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y));
        
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (x < 0 || x >= grid.cols || y < 0 || y >= grid.rows) continue;
                
                // Check if inside
                // Area of sub-triangles
                const area1 = Math.abs((p1.x - x) * (p2.y - y) - (p2.x - x) * (p1.y - y));
                const area2 = Math.abs((p2.x - x) * (p3.y - y) - (p3.x - x) * (p2.y - y));
                const area3 = Math.abs((p3.x - x) * (p1.y - y) - (p1.x - x) * (p3.y - y));
                
                if (Math.abs(area1 + area2 + area3 - areaOrig) < 1.0) {
                    set.add(y * grid.cols + x);
                }
            }
        }
    }
    
    _drawJaggedLine(x0, y0, x1, y1, set, thickness = 1) {
        // Connected Line with Flexing (Intermediate Points)
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const segments = Math.max(2, Math.floor(dist / 10)); // One segment every ~10px
        
        let px = x0;
        let py = y0;
        
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            
            let tx, ty;
            if (i === segments) {
                tx = x1;
                ty = y1;
            } else {
                // Intermediate point with jitter
                tx = x0 + (x1 - x0) * t;
                ty = y0 + (y1 - y0) * t;
                
                const jitter = (Math.random() - 0.5) * 2.0; 
                tx += jitter;
                ty += jitter;
            }
            
            // Draw straight line from (px, py) to (tx, ty)
            this._drawLine(px, py, tx, ty, set, thickness);
            
            px = tx;
            py = ty;
        }
    }

    _drawLine(x0, y0, x1, y1, set, thickness = 1) {
        // Bresenham-like algorithm for connected line
        let x = Math.floor(x0);
        let y = Math.floor(y0);
        const endX = Math.floor(x1);
        const endY = Math.floor(y1);
        
        const dx = Math.abs(endX - x);
        const dy = Math.abs(endY - y);
        const sx = (x < endX) ? 1 : -1;
        const sy = (y < endY) ? 1 : -1;
        let err = dx - dy;
        
        while (true) {
            // Apply thickness by adding neighbors
            for (let ox = 0; ox < thickness; ox++) {
                for (let oy = 0; oy < thickness; oy++) {
                    const cx = x + ox;
                    const cy = y + oy;
                    if (cx >= 0 && cx < this.g.cols && cy >= 0 && cy < this.g.rows) {
                        set.add(cy * this.g.cols + cx);
                    }
                }
            }
            
            if (x === endX && y === endY) break;
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
    }

    _triggerWhiteBlock() {
        const grid = this.g;
        const h = 11; 
        const r = Math.floor(Math.random() * (grid.rows - h));
        const duration = 18; 
        
        this.crashBars.push({
            x: 0, 
            y: r,
            w: grid.cols, 
            h: h,
            age: 0,
            maxAge: duration,
            id: Math.random() * 10000 // Seed for static randomness
        });
    }

    _triggerColumnBurst() {
        const grid = this.g;
        const col = Math.floor(Math.random() * grid.cols);
        let startRow = Math.floor(Math.random() * (grid.rows / 2)); 
        let height = Math.floor(Math.random() * (grid.rows / 2)) + (grid.rows / 4);
        if (Math.random() < 0.3) { startRow = 0; height = grid.rows; }
        const duration = 8; 
        
        this.crashBars.push({
            x: col, 
            y: startRow,
            w: 1, 
            h: height,
            age: 0,
            maxAge: duration,
            id: Math.random() * 10000 
        });
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