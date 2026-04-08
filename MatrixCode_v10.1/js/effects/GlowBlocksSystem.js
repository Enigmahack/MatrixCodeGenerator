/**
 * GlowBlocksSystem
 * Manages invisible floating blocks that influence the brightness and color of underlying characters.
 */
class GlowBlocksSystem {
    constructor(grid, config) {
        this.grid = grid;
        this.config = config;
        this.blocks = [];
        this.influenceBuffer = null;
        this.colorBuffer = null;
        this._lastSize = 0;
    }

    _initBuffer() {
        const total = this.grid.cols * this.grid.rows;
        if (total !== this._lastSize) {
            this.influenceBuffer = new Float32Array(total);
            this.colorBuffer = new Uint32Array(total);
            this._lastSize = total;
        }
    }

    update() {
        const s = this.config.state;
        if (!s.glowBlocksEnabled) {
            if (this.blocks.length > 0) this.blocks = [];
            return;
        }

        this._initBuffer();

        // 1. Density/Frequency Management
        const targetCount = Math.floor(s.glowBlocksDensity * s.glowBlocksFrequency);
        
        // Spawn/Despawn to match target count
        while (this.blocks.length < targetCount) {
            this.blocks.push(this._createBlock());
        }
        while (this.blocks.length > targetCount) {
            this.blocks.pop();
        }

        // 2. Update Positions (Floating/Bouncing)
        const speed = s.glowBlocksSpeed;
        const cols = this.grid.cols;
        const rows = this.grid.rows;

        for (let i = 0; i < this.blocks.length; i++) {
            const b = this.blocks[i];
            b.x += b.vx * speed;
            b.y += b.vy * speed;

            // Wrap around with margin based on block size
            if (b.x < -b.w) b.x = cols;
            if (b.x > cols) b.x = -b.w;
            if (b.y < -b.h) b.y = rows;
            if (b.y > rows) b.y = -b.h;
        }

        // 3. Decay Persistence (Fade Rate)
        const fadeRate = s.glowBlocksFadeRate;
        if (fadeRate >= 1.0) {
            this.influenceBuffer.fill(0);
        } else {
            // Decay existing influence
            const factor = 1.0 - fadeRate;
            for (let i = 0; i < this.influenceBuffer.length; i++) {
                this.influenceBuffer[i] *= factor;
            }
        }
    }

    _createBlock() {
        const s = this.config.state;
        const maxArea = s.glowBlocksArea;
        const area = Math.floor(1 + Math.random() * maxArea);
        
        // Velocity: -1 to 1 range
        const vx = (Math.random() - 0.5) * 2;
        const vy = (Math.random() - 0.5) * 2;
        
        const shape = [];
        if (s.glowBlocksAllowShapes) {
            this._generateRandomShape(area, shape);
        } else {
            // Rectangular shape that fits the area
            const w = Math.ceil(Math.sqrt(area));
            const h = Math.ceil(area / w);
            for (let py = 0; py < h; py++) {
                for (let px = 0; px < w; px++) {
                    if (shape.length < area) shape.push({x: px, y: py});
                }
            }
        }

        // Calculate bounding box for wrapping
        let minX = 0, maxX = 0, minY = 0, maxY = 0;
        shape.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });

        // Determine Color
        let color;
        if (s.glowBlocksStaticColorEnabled) {
            const rgb = Utils.hexToRgb(s.glowBlocksStaticColor);
            color = (255 << 24) | (rgb.b << 16) | (rgb.g << 8) | rgb.r;
        } else {
            // Random Vibrant Color for Tinting
            const r = 50 + Math.floor(Math.random() * 205);
            const g = 50 + Math.floor(Math.random() * 205);
            const b = 50 + Math.floor(Math.random() * 205);
            color = (255 << 24) | (b << 16) | (g << 8) | r; // ABGR
        }

        return {
            x: Math.random() * this.grid.cols,
            y: Math.random() * this.grid.rows,
            vx, vy,
            w: maxX - minX + 1,
            h: maxY - minY + 1,
            shape,
            color
        };
    }

    /**
     * Generates a random edge-connected shape using a simplified growth algorithm.
     */
    _generateRandomShape(area, shape) {
        shape.push({x: 0, y: 0});
        const visited = new Set(["0,0"]);
        const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        
        while (shape.length < area) {
            // Pick a random existing point to grow from
            const base = shape[Math.floor(Math.random() * shape.length)];
            const dir = neighbors[Math.floor(Math.random() * 4)];
            const nx = base.x + dir[0];
            const ny = base.y + dir[1];
            const key = `${nx},${ny}`;
            
            if (!visited.has(key)) {
                visited.add(key);
                shape.push({x: nx, y: ny});
            }
        }
    }

    apply() {
        const s = this.config.state;
        if (!s.glowBlocksEnabled || this.blocks.length === 0) return;

        const cols = this.grid.cols;
        const rows = this.grid.rows;
        const intensity = s.glowBlocksIntensity;
        const luminanceBoost = s.glowBlocksLuminanceBoost;
        const tintInfluence = s.glowBlocksTintInfluence / 100.0;

        // Static Color Sync: If enabled, force all blocks to the same color
        let staticColor = null;
        if (s.glowBlocksStaticColorEnabled) {
            const rgb = Utils.hexToRgb(s.glowBlocksStaticColor);
            staticColor = (255 << 24) | (rgb.b << 16) | (rgb.g << 8) | rgb.r;
        }

        // 1. Accumulate current block influence into the persistence buffer
        for (let i = 0; i < this.blocks.length; i++) {
            const b = this.blocks[i];
            const bx = Math.floor(b.x);
            const by = Math.floor(b.y);
            
            // Sync color if static is enabled
            if (staticColor !== null) b.color = staticColor;
            
            for (let j = 0; j < b.shape.length; j++) {
                const p = b.shape[j];
                let cx = bx + p.x;
                let cy = by + p.y;
                
                // Wrap coordinates
                cx = (cx % cols + cols) % cols;
                cy = (cy % rows + rows) % rows;
                
                const idx = cy * cols + cx;
                
                // Add intensity to influence buffer
                this.influenceBuffer[idx] = Math.min(2.0, this.influenceBuffer[idx] + intensity);
                // Assign block color to color buffer (latest block wins for simplicity)
                this.colorBuffer[idx] = b.color;
            }
        }

        // 2. Apply the influence buffer to the actual grid state
        const gEnvGlows = this.grid.envGlows;
        const gColors = this.grid.colors;
        const gState = this.grid.state;

        for (let i = 0; i < this.influenceBuffer.length; i++) {
            const influence = this.influenceBuffer[i];
            if (influence <= 0.01) continue;
            
            // Only influence active characters
            if (gState[i] === 0) continue;

            // Apply Luminance Boost
            gEnvGlows[i] += influence * luminanceBoost;

            // Apply Tint Influence
            if (tintInfluence > 0) {
                const blend = Math.min(1.0, influence * tintInfluence);
                const targetColor = this.colorBuffer[i];
                
                const cur = gColors[i];
                const cR = cur & 0xFF;
                const cG = (cur >> 8) & 0xFF;
                const cB = (cur >> 16) & 0xFF;
                
                const tR = targetColor & 0xFF;
                const tG = (targetColor >> 8) & 0xFF;
                const tB = (targetColor >> 16) & 0xFF;

                const nR = cR + (tR - cR) * blend;
                const nG = cG + (tG - cG) * blend;
                const nB = cB + (tB - cB) * blend;
                const nA = (cur >> 24) & 0xFF;

                gColors[i] = ((nA & 0xFF) << 24) | ((Math.floor(nB) & 0xFF) << 16) | ((Math.floor(nG) & 0xFF) << 8) | (Math.floor(nR) & 0xFF);
            }
        }
    }
}
