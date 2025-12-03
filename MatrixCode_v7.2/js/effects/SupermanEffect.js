class SupermanEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); 
                this.name = "Superman"; 
                this.active = false; 
                this.lightningPath = new Set();
                this.timer = 0;
            }

            trigger() { 
                if(this.active) return false; 
                this.active = true; 
                this.timer = this.c.state.supermanDurationSeconds * 60; 
                this.flickerTimer = 0;
                this._generateBolt();
                return true; 
            }

            update() {
                if(!this.active) return;
                this.timer--;
                
                if (this.timer <= 0) {
                    this.active = false;
                    this.lightningPath.clear();
                    return;
                }

                // Flicker logic: regenerate the bolt shape every N frames
                const s = this.c.state;
                this.flickerTimer++;
                if (this.flickerTimer >= s.supermanFlickerRate) {
                    this._generateBolt();
                    this.flickerTimer = 0;
                }
            }

            _generateBolt() {
                this.lightningPath.clear();
                const s = this.c.state;
                const startY = Math.floor(this.g.rows / 2);
                
                // Create multiple "tendrils" for a thick electricity look
                const tendrils = 1; 
                
                for(let t=0; t<tendrils; t++) {
                    let cy = startY + Utils.randomInt(-1, 1); // Slight variance at source
                    for (let x = 0; x < this.g.cols; x++) {
                        // Erratic movement calculation
                        const variance = Math.max(1, s.supermanWidth); // Scale variance by setting
                        const move = Utils.randomInt(-variance, variance);
                        cy += move;
                        
                        // Bounds checking
                        if (cy < 0) cy = 0;
                        if (cy >= this.g.rows) cy = this.g.rows - 1;

                        const thickness = s.supermanBoltThickness; // Change this value to make it thicker (e.g., 2, 3, 5)
                        const halfThick = Math.floor(thickness / 2);

                        for (let dy = -halfThick; dy <= halfThick; dy++) {
                            const thickY = cy + dy;
                            // Check bounds to prevent wrapping or errors
                            if (thickY >= 0 && thickY < this.g.rows) {
                                const idx = this.g.getIndex(x, thickY);
                                if (idx !== -1) this.lightningPath.add(idx);
                            }
                        }

                        // Branching logic (Tree structure)
                        if (Math.random() < s.supermanProb) {
                            this._createBranch(x, cy, Utils.randomInt(0, 50));
                        }
                    }
                }
            }

            _createBranch(startX, startY, length) {
                let cy = startY;
                const s = this.c.state;
                // Determine direction (usually forks out)
                const dirY = Math.random() > 0.2 ? 1 : -1;

                for (let i = 1; i < length; i++) {
                    let cx = startX + i;
                    if (cx >= this.g.cols) break;

                    // Branches move away from main line faster
                    cy += (Utils.randomInt(0, 0.5) * dirY); 
                    
                    if (cy < 0 || cy >= this.g.rows) break;
                    
                    const idx = this.g.getIndex(cx, cy);
                    if (idx !== -1) this.lightningPath.add(idx);
                }
            }

            getOverride(i) {
                if (!this.active || !this.lightningPath.has(i)) return null;

                // Check if there is actual content at this grid position
                // "Ignored spaces" interpretation: Only light up if there is a char
                const alpha = this.g.alphas[i];
                if (alpha <= 0.05) return null;

                const s = this.c.state;
                
                // High Voltage look
                return {
                    char: this.g.getChar(i),
                    color: s.supermanIncludeColors ? null : '#21cd33ff', 
                    color: s.supermanIncludeColors ? '#ffffffff' : '#b9e4b8ff', 
                    alpha: 1, 
                    glow: s.supermanGlow, 
                    size: 1,
                    solid: true
                };
            }
        }