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
            fadingTriangles: [], // Store active reveal zones
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
        const colorStr = this.c.derived.streamColorStr || this.c.defaults.streamColor;
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
        this.supermanState = { 
            active: false, 
            type: 0, 
            cells: new Set(), 
            illuminatedCells: new Set(), 
            fadingTriangles: [], // Ensure this is initialized!
            flickerTimer: 0, 
            globalTimer: 0, 
            boltId: 0 
        };
        this.shaderState = { activeId: 0, timer: 0, duration: 0 };
        this.smithState = { active: false, triggered: false, timer: 0, duration: 60 };
        this.sheetState = { spawning: true, timer: 600 };
        this.endFlashTriggered = false;
        this.sheetFadeVal = 1.0;
        
        this.flashState.active = false;
        this.flashState.nextFlash = 30; 
        
        this.MAX_BLACK_LEVEL = 0.5;
        this.baseBlackLevel = this.c.get('crashEnableFlash') ? this.MAX_BLACK_LEVEL : 0.0; 

        // Immediate Spawn of all sheets
        const maxSheets = this.c.get('crashSheetCount');
        this.blackSheets = [];
        this._updateBlackSheets(maxSheets); // Force fill

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
                const originalPulseMA = this.c.get('pulseMovieAccurate');
                
                this.c.set('pulseDelaySeconds', 0.1);
                this.c.set('pulseMovieAccurate', true);
                
                this.registry.trigger('Pulse');
                
                this.c.set('pulseDelaySeconds', originalPulseDelay);
                this.c.set('pulseMovieAccurate', originalPulseMA);
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
        // Always call _updateBlackSheets to handle movement/wrapping, even if not spawning
        this._updateBlackSheets(this.sheetState.spawning ? maxSheets : 0);
        
        if (this.blackSheets.length > maxSheets) this.blackSheets.splice(maxSheets);
        
        // --- SUPERMAN (Lightning) ---
        if (this.c.get('crashEnableSuperman')) {
            if (this.supermanState.active) {
                this.supermanState.globalTimer--;
                // Update every frame for smooth animation
                this._generateSupermanBolt();
                
                if (this.supermanState.globalTimer <= 0) {
                    // Transition Active Reveal to Fading
                    if (this.supermanState.activeReveal) {
                        this.supermanState.fadingTriangles.push(this.supermanState.activeReveal);
                        this.supermanState.activeReveal = null;
                    }
                    
                    this.supermanState.active = false;
                    this.supermanState.cells.clear();
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
        
        // Update Fading Triangles (Reveals)
        for (let i = this.supermanState.fadingTriangles.length - 1; i >= 0; i--) {
            const t = this.supermanState.fadingTriangles[i];
            t.alpha -= 0.05; // Fade out speed
            if (t.alpha <= 0) {
                this.supermanState.fadingTriangles.splice(i, 1);
            }
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
            if (!this.smithState.triggered && Math.random() < 0.001) { 
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

        // 1. Black Sheets - GPU HANDLED (Mask Texture)

        // 2. Superman Lightning (Updated)
        if (this.supermanState.active) {
            const tracerColor = this.c.derived.tracerColorUint32;
            
            // Triangle Reveals are now GPU HANDLED via getReveals() / Shadow Mask Punch-out

            // Render Main Bolt (Foreground)
            if (this.supermanState.cells.size > 0) {
                for (const idx of this.supermanState.cells) {
                    const char = grid.getChar(idx);
                    if (char !== ' ') {
                        // Bolt: Tracer Color, High Glow
                        grid.setHighPriorityEffect(idx, char, tracerColor, 1.0, grid.fontIndices[idx], 1.0);
                    }
                }
            }
        }

        // 3. Crash Bars (White Blocks) - Rendered on top
        if (this.crashBars.length > 0) {
            const activeFonts = this.c.derived.activeFonts;
            const fontData = activeFonts[0]; // Use default font
            const charSet = fontData.chars;
            const tracerColor = this.c.derived.tracerColorUint32;
            
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
                        
                        // Use High Priority to ensure color is enforced and shadows are ignored
                        grid.setHighPriorityEffect(idx, char, tracerColor, alpha, 0, 0.5); 
                    }
                }
            }
        }

        // 4. Snapshots (Smith)
        for (const [idx, snap] of this.snapshotOverlay) {
             if (snap.alpha <= 0.01) continue;
             const char = snap.char;
             // Snap color is stored as hex string
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
        // Fill up to maxSheets immediately
        while (this.blackSheets.length < maxSheets) { 
            const grid = this.g;
            // Generate dimensions (4 to 16)
            const w = Utils.randomInt(4, 16);
            const h = Utils.randomInt(4, 16);
            
            let c = Math.floor(Math.random() * (grid.cols - w));
            let row = Math.floor(Math.random() * (grid.rows - h));
            
            // Orthogonal Movement Logic
            const speedScale = (Math.random() * 1.5 + 0.5); 
            let dx = 0;
            let dy = 0;

            // Configurable Chance to be stationary
            const stationaryChance = this.c.get('crashStationaryChance') / 100.0;
            if (Math.random() > stationaryChance) {
                const axis = Math.random() < 0.5 ? 'x' : 'y';
                const dir = Math.random() < 0.5 ? 1 : -1;
                
                dx = axis === 'x' ? (0.2 + Math.random() * 0.3) * speedScale * dir : 0;
                dy = axis === 'y' ? (0.2 + Math.random() * 0.3) * speedScale * dir : 0;
            }
            
            const maxAlpha = this.c.get('crashSheetOpacity');

            this.blackSheets.push({ 
                c, r: row, w, h,
                posX: c, posY: row, 
                baseDx: dx, 
                baseDy: dy, 
                targetW: w, targetH: h, 
                // Requirement 1: Immediate Spawn (No Fade In)
                currentAlpha: maxAlpha, 
                targetAlpha: maxAlpha, 
                maxAlpha: maxAlpha,
                blur: 0.0
            });
        }

        // Update Position & Wrapping
        for (const s of this.blackSheets) {
            // Update Alpha (Fade Out logic handled by sheetFadeVal globally, but per-sheet fade-in removed)
            s.maxAlpha = this.c.get('crashSheetOpacity') * this.sheetFadeVal;
            s.currentAlpha = s.maxAlpha; 

            // Move
            s.posX += s.baseDx * this.c.get('crashSheetSpeed');
            s.posY += s.baseDy * this.c.get('crashSheetSpeed');
            
            // Wrapping Logic (Requirement 2)
            if (s.posX > this.g.cols) s.posX -= this.g.cols;
            if (s.posX + s.w < 0) s.posX += this.g.cols;
            
            if (s.posY > this.g.rows) s.posY -= this.g.rows;
            if (s.posY + s.h < 0) s.posY += this.g.rows;
        }
    }

    // New Generic Interface for Renderer (Requirement 4: Layering/Wrapping Visuals)
    getMasks() {
        if (!this.active) return [];
        const masks = [];
        const cols = this.g.cols;
        const rows = this.g.rows;

        for (const s of this.blackSheets) {
            // Main Body
            masks.push({
                x: s.posX, y: s.posY, w: s.w, h: s.h,
                alpha: s.currentAlpha, blur: s.blur
            });

            // Horizontal Wrapping Ghost
            if (s.posX + s.w > cols) {
                masks.push({
                    x: s.posX - cols, y: s.posY, w: s.w, h: s.h,
                    alpha: s.currentAlpha, blur: s.blur
                });
            } else if (s.posX < 0) {
                 masks.push({
                    x: s.posX + cols, y: s.posY, w: s.w, h: s.h,
                    alpha: s.currentAlpha, blur: s.blur
                });
            }

            // Vertical Wrapping Ghost
            if (s.posY + s.h > rows) {
                masks.push({
                    x: s.posX, y: s.posY - rows, w: s.w, h: s.h,
                    alpha: s.currentAlpha, blur: s.blur
                });
            } else if (s.posY < 0) {
                masks.push({
                    x: s.posX, y: s.posY + rows, w: s.w, h: s.h,
                    alpha: s.currentAlpha, blur: s.blur
                });
            }
        }
        return masks;
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
                    color: this.c.derived.tracerColorStr, 
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
            // Initialize active reveal for this new bolt
            s.activeReveal = { 
                type: 'strip', 
                trunk: [], 
                branch: [], 
                alpha: 1.0 
            };
        }
        
        const g = s.geometry;
        
        // Draw Main Path and capture points
        const trunkPoints = this._drawJaggedLine(g.start.x, g.start.y, g.end.x, g.end.y, s.cells, 2);
        
        // Update active reveal geometry
        if (s.activeReveal) {
            s.activeReveal.trunk = trunkPoints;
            s.activeReveal.branch = []; // Reset branch
        }

        // Draw Branches
        if (g.branches) {
            for (const b of g.branches) {
                const branchPoints = this._drawJaggedLine(g.split.x, g.split.y, b.x, b.y, s.cells, 1);
                // For the reveal, we only care about the first/longest branch to define the "V" shape
                // If there are multiple, we could potentially handle them, but let's stick to the primary split for the reveal web
                if (s.activeReveal && s.activeReveal.branch.length === 0) {
                    s.activeReveal.branch = branchPoints;
                }
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
            for (let i = 0; i < numBranches; i++) {
                let tx, ty;
                let attempts = 0;
                let valid = false;
                
                while (!valid && attempts < 10) {
                    attempts++;
                    const useHorizontal = Math.random() < 0.5;
                    
                    if (useHorizontal) {
                        ty = end.y;
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
        }
    }

    getReveals() {
        const reveals = [...this.supermanState.fadingTriangles];
        if (this.supermanState.activeReveal) {
            reveals.push(this.supermanState.activeReveal);
        }
        return reveals;
    }
    
    _drawJaggedLine(x0, y0, x1, y1, set, baseThickness = 1) {
        const points = [];
        
        // Elastic / Arcing Lightning with Time-Based Animation
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.ceil(dist * 0.8); // High resolution for smooth arcs
        
        // Perpendicular Vector for displacement
        const dx = x1 - x0;
        const dy = y1 - y0;
        const nx = -dy / dist; // Normalized Perpendicular X
        const ny = dx / dist;  // Normalized Perpendicular Y
        
        let px = x0;
        let py = y0;
        
        const time = this.frame * 0.3; 
        const seed = this.supermanState.boltId; 

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            
            let tx = x0 + dx * t;
            let ty = y0 + dy * t;
            
            const thickness = baseThickness;

            // Chaotic Displacement
            const arc1 = Math.sin(t * Math.PI + seed + time * 0.5) * 4.0;
            const arc2 = Math.sin(t * Math.PI * 4.0 + seed * 2.0 - time * 1.5) * 2.0;
            const jitter = Math.sin(t * Math.PI * 25.0 + time * 8.0) * 0.8;
            const noise = (Math.random() - 0.5) * 1.2;
            const envelope = Math.sin(t * Math.PI); 
            
            const displacement = (arc1 + arc2 + jitter + noise) * envelope * 2.0;

            tx += nx * displacement;
            ty += ny * displacement;
            
            points.push({x: tx, y: ty}); // Capture point
            
            if (i > 0) {
                this._drawLine(px, py, tx, ty, set, thickness);
            }
            
            px = tx;
            py = ty;
        }
        return points;
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