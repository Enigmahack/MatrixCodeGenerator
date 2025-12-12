class CrashEffect extends AbstractEffect {
    constructor(g, c, registry) {
        super(g, c);
        this.registry = registry; 
        this.name = "CrashSequence";
        this.active = false;
        this.startTime = 0;
        this.durationSeconds = 30; 
        
        this.originalShader = null;
        this.originalShaderEnabled = false;
        this.originalShaderParameter = 0.5;
        this.frame = 0;

        this.snapshotOverlay = new Map(); 
        this.blackSheets = []; 
        
        this.supermanState = {
            active: false,
            type: 0, 
            axis: 0, 
            cells: new Set(), 
            fluxTriangles: [], 
            flickerTimer: 0,
            initialBranches: [],
            burstTimer: 0, 
            isBursting: false,
            cooldown: 0,
            edgeType: 0,
            isMirrored: false
        };
        
        this.shaderState = {
            activeId: 0, 
            timer: 0,
            duration: 0
        };
        
        this.smithState = { active: false, triggered: false, timer: 0, duration: 60 };
        this.globalRevealAlpha = 1.0;
        this.sheetState = { spawning: true, timer: 600 };
        
        this.chaosState = {
            activeCount: 0,
            breakTimer: 0,
            nextBreak: 180 
        };
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

float random(float n) { return fract(sin(n) * 43758.5453123); }
float rect(vec2 uv, vec2 pos, vec2 size) {
    vec2 d = abs(uv - pos) - size;
    return 1.0 - step(0.0, max(d.x, d.y));
}

void main() {
    vec2 uv = vTexCoord;
    float phase_idx = floor(uParameter + 0.001);
    float progress = fract(uParameter); 
    
    vec4 finalColor = texture2D(uTexture, uv);

    if (phase_idx == 2.0) {
        vec4 distColor = vec4(0.0);
        float active = 0.0;
        if (progress < 0.33) { 
            if (uv.y < 0.25) { 
                vec2 center = vec2(0.5, 0.125); 
                vec2 dist = uv - center;
                dist *= 0.6; dist.y *= 0.3; 
                distColor = texture2D(uTexture, center + dist);
                distColor.rgb *= 1.5;
                active = 1.0;
            }
        } else if (progress < 0.66) { 
            if (uv.y > 0.1 && uv.y < 0.225) { 
                vec2 center = vec2(0.5, 0.1625); 
                vec2 dist = uv - center;
                dist *= 0.6; dist.y *= 0.1; 
                distColor = texture2D(uTexture, center + dist);
                distColor.rgb *= 1.5;
                active = 1.0;
            }
        } else { 
            vec2 center = vec2(0.5, 0.5);
            vec2 dist = uv - center;
            dist.y *= 0.02; 
            distColor = texture2D(uTexture, center + dist);
            distColor.rgb *= 1.5;
            float localP = (progress - 0.66) / 0.34;
            active = 1.0 - localP;
        }
        if (active > 0.0) finalColor = mix(finalColor, distColor, 0.5 * active);
    }
    
    if (phase_idx == 3.0) {
        for (float i = 0.0; i < 3.0; i++) {
            float seed = i * 12.34;
            float dur = 0.2 + random(seed)*0.3; 
            float offset = random(seed + 1.0) * 10.0;
            float localT = mod(uTime + offset, dur + 0.1); 
            if (localT < dur) {
                float prog = localT / dur;
                float cycleIdx = floor((uTime + offset) / (dur + 0.1));
                float subSeed = seed + cycleIdx * 7.89;
                vec2 pos = vec2(random(subSeed), random(subSeed + 1.0));
                float type = random(subSeed + 2.0); 
                if (type < 0.6) { 
                    vec2 size = vec2(0.3 + random(subSeed)*0.5, 0.05 + random(subSeed)*0.1);
                    if (rect(uv, pos, size) > 0.0) {
                        float smearX = (uv.x - pos.x) * 0.5 + pos.x; 
                        finalColor = mix(finalColor, texture2D(uTexture, vec2(smearX, uv.y)), 0.8);
                    }
                } else if (type < 0.8) { 
                    vec2 size = vec2(0.2 + random(subSeed)*0.3, 0.005); 
                    if (rect(uv, pos, size) > 0.0) {
                        float gray = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
                        finalColor.rgb = vec3(gray * 2.0); 
                    }
                } else { 
                    vec2 size = vec2(0.02, 0.5 + random(subSeed)*0.5); 
                    if (size.y < 1.0) size.y = 1.0; 
                    if (rect(uv, pos, size) > 0.0) {
                        float fade = 1.0 - prog; 
                        finalColor = mix(finalColor, vec4(1.0), fade * 0.8);
                    }
                }
            }
        }
    }

    if (phase_idx == 7.0) {
        float startY = 0.45;
        float initHeight = 0.05; 
        float expand = min(progress / 0.2, 1.0); 
        float currentTop = (startY - initHeight) - ((startY - initHeight) * expand); 
        if (uv.y <= startY && uv.y >= currentTop) {
            float alpha = 1.0 - smoothstep(0.1, 0.4, progress);
            finalColor = mix(finalColor, vec4(0.0, 0.0, 0.0, 1.0), alpha);
        }
        if (progress > 0.3 && progress < 0.35) {
             if (abs(uv.y - 0.2) < 0.02) finalColor = texture2D(uTexture, vec2(0.5, 0.2)) * 2.0;
        }
    }
    
    if (phase_idx == 8.0) {
        vec2 center = vec2(0.5, 0.5);
        vec2 dist = uv - center;
        dist.y *= 0.1; 
        vec4 distColor = texture2D(uTexture, center + dist);
        float alpha = 1.0 - smoothstep(0.0, 0.8, progress);
        finalColor = mix(finalColor, distColor, alpha);
        finalColor.rgb += vec3(alpha * 0.5); 
    }
    
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
        this.currentPhase = 0;
        this.frame = 0;
        this.snapshotOverlay.clear(); 
        this.blackSheets = []; 
        this.supermanState = { active: false, axis: 0, cells: new Set(), fluxTriangles: [], flickerTimer: 0, initialBranches: [], burstTimer: 0, isBursting: false, cooldown: 0, edgeType: 0, isMirrored: false };
        this.shaderState = { activeId: 0, timer: 0, duration: 0 };
        this.smithState = { active: false, triggered: false, timer: 0, duration: 60 };
        this.burstCount = 0;
        this.globalRevealAlpha = 1.0;
        this.sheetState = { spawning: true, timer: 600 };
        this.chaosState = { activeCount: 0, breakTimer: 0, nextBreak: 180 };
        // console.log("CrashEffect Triggered");
        return true;
    }

    update() {
        if (!this.active) return;
        
        this.frame++; 

        const elapsedTime = (performance.now() - this.startTime) / 1000;
        const progress = elapsedTime / this.durationSeconds;

        if (progress >= 1.0) {
            this.active = false;
            this.c.set('customShader', this.originalShader);
            this.c.set('shaderEnabled', this.originalShaderEnabled);
            this.c.set('shaderParameter', this.originalShaderParameter);
            this.snapshotOverlay.clear();
            this.blackSheets = [];
            this.supermanState.cells.clear();
            // console.log("CrashEffect Finished");
            return;
        }

        // --- CHAOS LOGIC ---
        
        if (this.chaosState.breakTimer > 0) {
            this.chaosState.breakTimer--;
            this.globalRevealAlpha = 0.0; 
            this.c.set('shaderParameter', 0.0); 
            return; 
        } else {
            this.chaosState.nextBreak--;
            if (this.chaosState.nextBreak <= 0) {
                this.chaosState.breakTimer = 60; 
                this.chaosState.nextBreak = 180 + Math.random() * 180; 
                this.chaosState.activeCount = 0;
                return;
            }
        }
        
        if (this.globalRevealAlpha < 1.0) this.globalRevealAlpha += 0.1;

        this.chaosState.activeCount = 0;
        if (this.supermanState.active) this.chaosState.activeCount++;
        if (this.shaderState.activeId !== 0) this.chaosState.activeCount++;
        if (this.snapshotOverlay.size > 0) this.chaosState.activeCount++; 

        const canSpawn = this.chaosState.activeCount < 2;

        this.sheetState.timer--;
        if (this.sheetState.timer <= 0) {
            this.sheetState.spawning = !this.sheetState.spawning;
            this.sheetState.timer = this.sheetState.spawning ? 600 : 300; 
        }
        if (this.sheetState.spawning) this._updateBlackSheets();
        else {
            for (let i = this.blackSheets.length - 1; i >= 0; i--) {
                const s = this.blackSheets[i];
                s.age++;
                if (s.age >= s.life) this.blackSheets.splice(i, 1);
                s.posX += s.dx; s.posY += s.dy;
                s.w += (s.targetW - s.w) * 0.05; s.h += (s.targetH - s.h) * 0.05;
                s.c = Math.floor(s.posX); s.r = Math.floor(s.posY);
            }
        }
        for (const s of this.blackSheets) {
            if (Math.random() < 0.01) s.targetAlpha = (s.targetAlpha > 0.5) ? 0.0 : s.maxAlpha;
            s.currentAlpha += (s.targetAlpha - s.currentAlpha) * 0.1;
            s.posX += s.dx; s.posY += s.dy;
            if (Math.random() < 0.02) { s.targetW = Math.max(2, s.targetW + (Math.random() - 0.5) * 4); s.targetH = Math.max(2, s.targetH + (Math.random() - 0.5) * 4); }
            s.w += (s.targetW - s.w) * 0.05; s.h += (s.targetH - s.h) * 0.05;
            s.c = Math.floor(s.posX); s.r = Math.floor(s.posY);
        }

        this._updateSnapshots();
        
        if (this.supermanState.active) {
            this._updateSuperman();
            this.supermanState.globalTimer--;
            if (this.supermanState.globalTimer <= 0) {
                this.supermanState.active = false;
                this.supermanState.cells.clear();
                this.supermanState.fluxTriangles = [];
            }
        } else if (canSpawn) {
            if (Math.random() < 0.03) {
                const type = Math.random() < 0.6 ? 0 : 1; 
                this._triggerSuperman(type);
            }
        }
        
        if (canSpawn && Math.random() < 0.04) this._triggerWhiteBlock(); 
        if (canSpawn && Math.random() < 0.03) this._triggerColumnBurst(); 
        
        if (!this.smithState.triggered && canSpawn && Math.random() < 0.005) { 
            this._triggerSmith();
        }
        if (this.smithState.active) {
            this.smithState.timer--;
            if (this.smithState.timer <= 0) this.smithState.active = false;
        }
        
        if (this.registry && canSpawn) { 
            if (Math.random() < 0.002) this.registry.trigger('ClearPulse');
            // Removed MiniPulse
        }

        if (this.shaderState.activeId === 0) {
            if (canSpawn && Math.random() < 0.02) {
                const r = Math.random();
                let id = 0;
                let dur = 0;
                if (r < 0.15) { id = 2; dur = 60; } 
                else if (r < 0.50) { id = 3; dur = 45; } 
                else if (r < 0.70) { id = 7; dur = 60; } 
                else if (r < 0.85) { id = 8; dur = 30; } 
                else { id = 9; dur = 45; } 
                
                this.shaderState.activeId = id;
                this.shaderState.duration = dur;
                this.shaderState.timer = 0;
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

    _updateBlackSheets() {
        if (this.blackSheets.length < 500) { 
            if (Math.random() < 0.8) { 
                const grid = this.g;
                const r = Math.random();
                let w, h;
                if (r < 0.4) { w = Math.floor(Math.random() * 4) + 1; h = Math.floor(Math.random() * 4) + 1; } 
                else if (r < 0.8) { w = Math.floor(Math.random() * 8) + 5; h = Math.floor(Math.random() * 8) + 5; } 
                else { w = Math.floor(Math.random() * 13) + 13; h = Math.floor(Math.random() * 13) + 13; }
                let c;
                if (Math.random() < 0.8) { 
                    if (Math.random() < 0.5) c = Math.floor(Math.random() * (grid.cols * 0.2)); 
                    else c = Math.floor(grid.cols * 0.8 + Math.random() * (grid.cols * 0.2)) - w; 
                    if (c < 0) c = 0; 
                } else { c = Math.floor(Math.random() * (grid.cols - w)); }
                const row = Math.floor(Math.random() * (grid.rows - h));
                const duration = Math.floor(Math.random() * 200) + 100; 
                const axis = Math.random() < 0.5 ? 0 : 1;
                const expandAmount = Math.floor(Math.random() * w) + 2; 
                const speedScale = Math.random() * 0.6 + 0.2;
                this.blackSheets.push({ 
                    c, r: row, w, h, axis, expandAmount, age: 0, life: duration, 
                    posX: c, posY: row, dx: (Math.random() - 0.5) * speedScale, dy: (Math.random() - 0.5) * speedScale, targetW: w, targetH: h, 
                    flashFrames: 0, 
                    maxAlpha: 0.75 + Math.random() * 0.2, 
                    currentAlpha: 0.0, targetAlpha: 1.0 
                });
            }
        }
        for (let i = this.blackSheets.length - 1; i >= 0; i--) {
            const s = this.blackSheets[i];
            s.age++;
            if (s.age >= s.life) this.blackSheets.splice(i, 1);
        }
    }

    _getFontName(i) {
        const fontIdx = this.g.getFont(i);
        const fonts = this.c.derived.activeFonts;
        return (fonts && fonts[fontIdx]) ? fonts[fontIdx].name : this.c.state.fontFamily;
    }

    _getCellColor(i) {
        const pIdx = this.g.paletteIndices[i];
        const palette = this.c.derived.paletteColorsStr;
        // Use palette color if available, otherwise default stream color
        return (palette && palette[pIdx]) ? palette[pIdx] : this.c.derived.streamColorStr;
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
                
                if (headDist < 1.0) {
                    isSmithPixel = true;
                    brightness = 0.5; 
                    if (ny > 0.28 && ny < 0.34 && Math.abs(nx - 0.5) < 0.18) brightness = 0.0; 
                    if (ny > 0.65) brightness = 0.2; 
                    if (ny > 0.65 && Math.abs(nx - 0.5) < 0.04) brightness = 0.8; 
                }
                if (ny > 0.65 && Math.abs(nx - 0.5) < 0.45) {
                    isSmithPixel = true;
                    if (Math.abs(nx - 0.5) < 0.04) brightness = 0.8; 
                    else brightness = 0.2; 
                }
                
                if (isSmithPixel) {
                    // Use the cell's actual color instead of a hardcoded green
                    const cellColor = this._getCellColor(i);
                    const fontName = this._getFontName(i);
                    
                    this.snapshotOverlay.set(i, {
                        char: grid.getChar(i), 
                        color: cellColor, 
                        font: fontName,
                        alpha: brightness, 
                        endFrame: endFrame, 
                        isFrozen: true, 
                        isSmith: true
                    });
                }
            }
        }
    }

    _triggerSuperman(type) {
        this.supermanState.active = true;
        this.supermanState.type = type; 
        this.supermanState.axis = Math.random() < 0.5 ? 0 : 1;
        this.supermanState.globalTimer = (type === 0) ? 60 : 150; 
        this.supermanState.flickerTimer = 0;
        this.supermanState.isBursting = true; 
        this.supermanState.burstTimer = 0;
        this.supermanState.cooldown = 0;
        if (type === 0) this._initializeSupermanBranches();
    }

    _initializeSupermanBranches() {
        this.supermanState.initialBranches = [];
        const grid = this.g;
        const numBranches = Math.floor(Math.random() * 3) + 1; 
        const isHorizEdge = Math.random() < 0.5;
        this.supermanState.edgeType = isHorizEdge ? 0 : 1;
        for (let i = 0; i < numBranches; i++) {
            let targetX, targetY;
            if (this.supermanState.axis === 0) { 
                if (isHorizEdge) { targetX = Math.floor(grid.cols/2 + Math.random()*(grid.cols/2)); targetY = grid.rows - 1; }
                else { targetX = grid.cols - 1; targetY = Math.floor(grid.rows/2 + Math.random()*(grid.rows/2)); }
            } else { 
                if (isHorizEdge) { targetX = Math.floor(Math.random()*(grid.cols/2)); targetY = grid.rows - 1; }
                else { targetX = 0; targetY = Math.floor(grid.rows/2 + Math.random()*(grid.rows/2)); }
            }
            this.supermanState.initialBranches.push({ targetX, targetY, isHorizEdge });
        }
    }

    _updateSuperman() {
        const s = this.supermanState;
        if (s.type === 0) { 
            if (s.isBursting) s.burstTimer++;
            const grid = this.g;
            for (const branch of s.initialBranches) {
                const speed = (Math.random() - 0.5) * 4.0;
                if (branch.isHorizEdge) { branch.targetX += speed; } else { branch.targetY += speed; }
            }
        }
        s.flickerTimer++;
        if (s.flickerTimer >= 3) { s.flickerTimer = 0; this._generateSupermanBolt(); }
    }

    _generateSupermanBolt() {
        const s = this.supermanState;
        s.cells.clear();
        s.fluxTriangles = [];
        const grid = this.g;
        const axis = s.axis;
        const startX = axis === 0 ? 0 : grid.cols - 1;
        const startY = 0;
        const endX = axis === 0 ? grid.cols - 1 : 0;
        const endY = grid.rows - 1;
        if (s.type === 1) { 
            this._drawDisplacedLine(startX, startY, endX, endY, 6.0, 5, s.cells);
        } else { 
            const tDiv = 0.4;
            const divX = startX + (endX - startX) * tDiv;
            const divY = startY + (endY - startY) * tDiv;
            this._drawLine(startX, startY, endX, endY, s.cells, 2.0, 0.0);
            for (const branch of s.initialBranches) {
                this._drawLine(divX, divY, branch.targetX, branch.targetY, s.cells, 2.0, 0.0);
                s.fluxTriangles.push({ p1: {x: divX, y: divY}, p2: {x: endX, y: endY}, p3: {x: branch.targetX, y: branch.targetY} });
            }
        }
    }
    
    _drawLine(x0, y0, x1, y1, set, jitterAmt = 2.0, thickness = 0.0) {
        const dist = Math.sqrt((x1-x0)**2 + (y1-y0)**2);
        const steps = Math.ceil(dist);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            let x = x0 + (x1 - x0) * t;
            let y = y0 + (y1 - y0) * t;
            x += (Math.random() - 0.5) * jitterAmt; 
            y += (Math.random() - 0.5) * jitterAmt;
            if (thickness > 0) {
                const r = Math.floor(thickness);
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        const ix = Math.floor(x + dx);
                        const iy = Math.floor(y + dy);
                        if (ix >= 0 && ix < this.g.cols && iy >= 0 && iy < this.g.rows) set.add(iy * this.g.cols + ix);
                    }
                }
            } else {
                const ix = Math.floor(x);
                const iy = Math.floor(y);
                if (ix >= 0 && ix < this.g.cols && iy >= 0 && iy < this.g.rows) set.add(iy * this.g.cols + ix);
            }
        }
    }
    
    _drawDisplacedLine(x0, y0, x1, y1, jitter, depth, set) {
        if (depth === 0) { this._drawLine(x0, y0, x1, y1, set, 0, 0); return; }
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx*dx + dy*dy);
        const nx = -dy / len;
        const ny = dx / len;
        const offset = (Math.random() - 0.5) * jitter * 2.0; 
        const dmx = mx + nx * offset;
        const dmy = my + ny * offset;
        this._drawDisplacedLine(x0, y0, dmx, dmy, jitter * 0.6, depth - 1, set);
        this._drawDisplacedLine(dmx, dmy, x1, y1, jitter * 0.6, depth - 1, set);
    }
    
    _pointInTriangle(px, py, p1, p2, p3) {
        const area = 0.5 * (-p2.y * p3.x + p1.y * (-p2.x + p3.x) + p1.x * (p2.y - p3.y) + p2.x * p3.y);
        const s = 1 / (2 * area) * (p1.y * p3.x - p1.x * p3.y + (p3.y - p1.y) * px + (p1.x - p3.x) * py);
        const t = 1 / (2 * area) * (p1.x * p2.y - p1.y * p2.x + (p1.y - p2.y) * px + (p2.x - p1.x) * py);
        return s > 0 && t > 0 && (1 - s - t) > 0;
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
                const fontName = this._getFontName(i);
                this.snapshotOverlay.set(i, { 
                    char: grid.getChar(i), 
                    color: '#FFFFFF', 
                    font: fontName,
                    alpha: 1.0, 
                    endFrame: endFrame, 
                    isFrozen: true 
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
            const fontName = this._getFontName(i);
            this.snapshotOverlay.set(i, { 
                char: Utils.getRandomChar(), 
                color: '#FFFFFF', 
                font: fontName,
                alpha: 1.0, 
                endFrame: endFrame, 
                isFrozen: true 
            });
        }
    }

    _updateSnapshots() {
        const currentFrame = this.frame; 
        for (const [index, snapshot] of this.snapshotOverlay.entries()) {
            if (currentFrame > snapshot.endFrame) this.snapshotOverlay.delete(index);
            else {
                if (snapshot.isSmith) {
                    const rem = snapshot.endFrame - currentFrame;
                    if (rem < 30) snapshot.alpha = rem / 30.0;
                } else {
                    const rem = snapshot.endFrame - currentFrame;
                    if (rem < 3) snapshot.alpha = rem / 3.0; 
                }
            }
        }
    }

    _generateVines() {}

    getOverride(i) {
        if (!this.active) return null;

        const grid = this.g;
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);

        // Always resolve the correct font for this cell
        const fontName = this._getFontName(i);

        if (this.supermanState.cells.has(i)) {
            return { char: grid.getChar(i), color: '#FFFFFF', font: fontName, alpha: 1.0, glow: 5, size: 0, solid: false, blend: true };
        }
        
        for (const tri of this.supermanState.fluxTriangles) {
            if (this._pointInTriangle(col, row, tri.p1, tri.p2, tri.p3)) {
                let fluxColor = '#00FF00'; 
                if (this.c.derived && this.c.derived.streamColorStr) fluxColor = this.c.derived.streamColorStr;
                else if (this.c.state.streamColor) fluxColor = this.c.state.streamColor;
                return { char: grid.getChar(i), color: fluxColor, font: fontName, alpha: 1.0, glow: 2, solid: true, bgColor: '#000000', blend: true };
            }
        }

        const snapshot = this.snapshotOverlay.get(i);
        if (snapshot) {
            if (snapshot.isSmith) {
                return { char: snapshot.char, color: snapshot.color, font: snapshot.font || fontName, alpha: snapshot.alpha, glow: 0, size: 0, solid: false, blend: true };
            }
            return { char: snapshot.char, color: snapshot.color, font: snapshot.font || fontName, alpha: snapshot.alpha, glow: 8, size: 0, solid: false, blend: true };
        }

        if (this.globalRevealAlpha < 0.05) return null; 

        let totalAlpha = 0.0;
        
        for (const s of this.blackSheets) {
            if (col >= s.c && col < s.c + s.w &&
                row >= s.r && row < s.r + s.h) {
                
                let sheetAlpha = s.currentAlpha * s.maxAlpha;

                // Edge Fading: Soften the edges of the rectangle
                const nx = (col - s.posX) / s.w;
                const ny = (row - s.posY) / s.h;
                
                // Linear fade on all sides (20% of width/height)
                const fadeSize = 0.2;
                const fadeL = nx < fadeSize ? nx / fadeSize : 1.0;
                const fadeR = (1.0 - nx) < fadeSize ? (1.0 - nx) / fadeSize : 1.0;
                const fadeT = ny < fadeSize ? ny / fadeSize : 1.0;
                const fadeB = (1.0 - ny) < fadeSize ? (1.0 - ny) / fadeSize : 1.0;
                
                sheetAlpha *= Math.min(fadeL, fadeR, fadeT, fadeB);

                // Accumulation: Allow slight darkening on overlap
                // Base is Max, plus a small fraction of the product to simulate density without instant black
                totalAlpha = Math.max(totalAlpha, sheetAlpha) + (sheetAlpha * 0.2); 
                if (totalAlpha > 1.0) totalAlpha = 1.0;
            }
        }
        
        if (totalAlpha > 0.01) {
            if (this.globalRevealAlpha < 1.0) totalAlpha *= this.globalRevealAlpha;
            
            // Use the specific cell color instead of global stream color
            // This fixes the "inconsistency" issue when using palettes
            const dimColor = this._getCellColor(i);
            
            // Fix: Check if cell is active to prevent lighting up empty space
            const isActive = this.g.alphas[i] > 0.05;
            // Text fades out as sheet gets darker
            const textAlpha = isActive ? Math.max(0, 1.0 - totalAlpha) : 0.0;
            
            return { 
                char: isActive ? grid.getChar(i) : '', 
                color: dimColor, 
                font: fontName,
                alpha: textAlpha, 
                solid: true, 
                bgColor: `rgba(0, 0, 0, ${totalAlpha})`, // Pure Black
                blend: false 
            };
        }
        
        return null;
    }
}
