class SupermanEffect extends AbstractEffect {
            constructor(g, c) { 
                super(g, c); 
                this.name = "Superman"; 
                this.active = false; 
                this.lightningPath = new Set();
                this.afterimages = new Map(); 
                this.timer = 0;
                this.spawnX = 0;
            }

            trigger() { 
                if(this.active) return false; 
                this.active = true; 
                this.timer = this.c.state.supermanDurationSeconds * 60; 
                this.flickerTimer = 0;
                this.spawnX = 0;
                this.afterimages.clear();
                this._generateBolt();
                return true; 
            }

            update() {
                const s = this.c.state;
                
                // Update afterimages (fade out)
                if (this.afterimages.size > 0) {
                    // Fade speed: higher = slower. Default ~20.
                    // 20 -> 0.05 decay. 
                    const decay = 1.0 / Math.max(1, s.supermanFadeSpeed || 20); 
                    
                    for (const [index, alpha] of this.afterimages) {
                        const newAlpha = alpha - decay;
                        if (newAlpha <= 0.01) {
                            this.afterimages.delete(index);
                        } else {
                            this.afterimages.set(index, newAlpha);
                        }
                    }
                }

                if(!this.active && this.afterimages.size === 0) {
                     return;
                }

                if (this.active) {
                    this.timer--;
                    
                    // Spawning logic
                    // Speed 40 ~ crosses screen in roughly 0.5-1s depending on refresh rate.
                    // Factor: Speed 40 -> 0.04 * cols per frame. 
                    // If cols=100, 4 cells/frame. 25 frames total.
                    const speedVal = s.supermanSpawnSpeed || 40;
                    const speedFactor = Math.max(1, speedVal) / 1000; 
                    this.spawnX += (this.g.cols * speedFactor);
                    
                    if (this.spawnX > this.g.cols) this.spawnX = this.g.cols;

                    if (this.timer <= 0) {
                        this.active = false;
                        this.lightningPath.clear();
                        return;
                    }

                    this.flickerTimer++;
                    if (this.flickerTimer >= s.supermanFlickerRate) {
                        this._generateBolt();
                        this.flickerTimer = 0;
                    } else {
                        this._refreshAfterimages();
                    }
                }
            }

            _generateBolt() {
                this.lightningPath.clear();
                const s = this.c.state;
                const startY = Math.floor(this.g.rows / 2);
                let cy = startY;
                
                const limitX = Math.floor(this.spawnX);

                for (let x = 0; x < this.g.cols; x++) {
                    if (x > limitX) break;

                    // Jitter / Width logic
                    const variance = Math.max(1, s.supermanWidth); 
                    const noise = Utils.randomInt(-variance, variance);
                    
                    // Gentle center pull to keep it on screen but allow jitter
                    const distFromCenter = (this.g.rows / 2) - cy;
                    cy += noise + (distFromCenter * 0.05); 

                    if (cy < 0) cy = 0;
                    if (cy >= this.g.rows) cy = this.g.rows - 1;

                    const thickness = s.supermanBoltThickness; 
                    const halfThick = Math.floor(thickness / 2);

                    for (let dy = -halfThick; dy <= halfThick; dy++) {
                        const thickY = Math.round(cy) + dy;
                        if (thickY >= 0 && thickY < this.g.rows) {
                            const idx = this.g.getIndex(x, thickY);
                            if (idx !== -1) {
                                this.lightningPath.add(idx);
                            }
                        }
                    }
                }
                
                this._refreshAfterimages();
            }

            _refreshAfterimages() {
                for (const idx of this.lightningPath) {
                    this.afterimages.set(idx, 1.0);
                }
            }

            getOverride(i) {
                if (this.afterimages.has(i)) {
                    const alphaChar = this.g.alphas[i];
                    if (alphaChar <= 0.05) return null;

                    const effectAlpha = this.afterimages.get(i);
                    const s = this.c.state;
                    
                    const fontIdx = this.g.fontIndices[i];
                    const fontName = this.c.derived.activeFonts[fontIdx]?.name || s.fontFamily;

                    return {
                        char: this.g.getChar(i),
                        font: fontName,
                        color: s.supermanIncludeColors ? '#ffffffff' : '#b9e4b8ff', 
                        alpha: effectAlpha, 
                        glow: s.supermanGlow, 
                        size: 1,
                        solid: false, 
                        blend: true 
                    };
                }
                return null;
            }

            getActiveIndices() {
                if ((!this.active && this.afterimages.size === 0)) return new Set();
                return this.afterimages.keys();
            }
        }


    // =========================================================================
    // 7.0 CANVAS RENDERER
    // =========================================================================
