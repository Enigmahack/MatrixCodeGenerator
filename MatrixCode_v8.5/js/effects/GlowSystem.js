
class GlowSystem {
    constructor(grid) {
        this.grid = grid;
        this.sources = [];
    }

    /**
     * Adds a transient radial glow source.
     * @param {number} x - Center Column.
     * @param {number} y - Center Row.
     * @param {number} radius - Radius in cells.
     * @param {number} intensity - Peak intensity.
     * @param {number|null} color - Tint color (Uint32).
     * @param {number} duration - Frames.
     * @param {string} decayFn - 'linear', 'exponential', 'none'.
     */
    add(x, y, radius, intensity, color = null, duration = 0, decayFn = 'linear') {
        this.addRadial(x, y, radius, intensity, color, duration, decayFn);
    }

    addRadial(x, y, radius, intensity, color = null, duration = 0, decayFn = 'linear') {
        this.sources.push({
            type: 'radial', x, y, radius, intensity, color, 
            duration: Math.max(1, duration), 
            maxDuration: Math.max(1, duration), 
            decayFn, 
            age: 0
        });
    }

    /**
     * Adds a transient rectangular glow source.
     * @param {number} x - Center Column.
     * @param {number} y - Center Row.
     * @param {number} width - Full Width in cells.
     * @param {number} height - Full Height in cells.
     * @param {number} intensity - Peak intensity (inside box).
     * @param {number|null} color - Tint color.
     * @param {number} duration - Frames.
     * @param {string} decayFn - 'linear', 'exponential'.
     * @param {number} falloff - Soft edge radius outside the box (0 = hard edge).
     */
    addRect(x, y, width, height, intensity, color = null, duration = 0, decayFn = 'linear', falloff = 2) {
        this.sources.push({
            type: 'rect', x, y, w: width, h: height, falloff, intensity, color,
            duration: Math.max(1, duration),
            maxDuration: Math.max(1, duration),
            decayFn,
            age: 0
        });
    }

    update() {
        // Lifecycle Management
        for (let i = this.sources.length - 1; i >= 0; i--) {
            const s = this.sources[i];
            s.age++;
            if (s.age >= s.duration) {
                this.sources.splice(i, 1);
            }
        }
    }

    apply() {
        if (this.sources.length === 0) return;

        const grid = this.grid;
        const cols = grid.cols;
        const rows = grid.rows;
        
        const gEnvGlows = grid.envGlows;
        const gColors = grid.colors;

        for (const s of this.sources) {
            // Calculate lifecycle intensity
            let currentIntensity = s.intensity;
            if (s.decayFn === 'linear') {
                currentIntensity *= 1.0 - (s.age / s.maxDuration);
            } else if (s.decayFn === 'exponential') {
                const prog = s.age / s.maxDuration;
                currentIntensity *= (1.0 - (prog * prog));
            }

            if (currentIntensity <= 0.01) continue;

            // Determine Bounds
            let minX, maxX, minY, maxY;

            if (s.type === 'rect') {
                const halfW = s.w / 2;
                const halfH = s.h / 2;
                const margin = s.falloff;
                minX = Math.floor(s.x - halfW - margin);
                maxX = Math.ceil(s.x + halfW + margin);
                minY = Math.floor(s.y - halfH - margin);
                maxY = Math.ceil(s.y + halfH + margin);
            } else {
                // Radial
                const r = s.radius;
                minX = Math.floor(s.x - r);
                maxX = Math.ceil(s.x + r);
                minY = Math.floor(s.y - r);
                maxY = Math.ceil(s.y + r);
            }

            // Clamp to grid
            minX = Math.max(0, minX); maxX = Math.min(cols - 1, maxX);
            minY = Math.max(0, minY); maxY = Math.min(rows - 1, maxY);

            for (let cy = minY; cy <= maxY; cy++) {
                for (let cx = minX; cx <= maxX; cx++) {
                    const idx = cy * cols + cx;
                    
                    if (grid.state[idx] === 0) continue; 

                    let boost = 0;

                    if (s.type === 'rect') {
                        // Signed Distance Field logic for Box
                        // distance from center relative to half-size
                        const dx = Math.abs(cx - s.x) - (s.w / 2);
                        const dy = Math.abs(cy - s.y) - (s.h / 2);
                        
                        // dist > 0 means outside. dist <= 0 means inside.
                        // We only care about outside distance for falloff.
                        // Inside is full intensity.
                        const outsideDist = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2);
                        
                        if (outsideDist <= 0) {
                            boost = currentIntensity; // Inside box
                        } else if (outsideDist < s.falloff) {
                            // Fade out
                            boost = currentIntensity * (1.0 - (outsideDist / s.falloff));
                        }
                    } else {
                        // Radial
                        const dx = cx - s.x;
                        const dy = cy - s.y;
                        const dist = Math.sqrt(dx*dx + dy*dy);
                        if (dist < s.radius) {
                            boost = currentIntensity * (1.0 - (dist / s.radius));
                        }
                    }

                    if (boost > 0.01) {
                        gEnvGlows[idx] += boost;

                        if (s.color !== null) {
                            const blendFactor = Math.min(1.0, boost * 0.5);
                            const cur = gColors[idx];
                            const cR = cur & 0xFF;
                            const cG = (cur >> 8) & 0xFF;
                            const cB = (cur >> 16) & 0xFF;
                            
                            const sR = s.color & 0xFF;
                            const sG = (s.color >> 8) & 0xFF;
                            const sB = (s.color >> 16) & 0xFF;

                            const nR = cR + (sR - cR) * blendFactor;
                            const nG = cG + (sG - cG) * blendFactor;
                            const nB = cB + (sB - cB) * blendFactor;
                            const nA = (cur >> 24) & 0xFF;

                            gColors[idx] = ((nA & 0xFF) << 24) | ((Math.floor(nB) & 0xFF) << 16) | ((Math.floor(nG) & 0xFF) << 8) | (Math.floor(nR) & 0xFF);
                        }
                    }
                }
            }
        }
    }
}


