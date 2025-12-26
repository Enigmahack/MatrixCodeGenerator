class QuantizedPulseEffect extends AbstractEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedPulse";
        this.active = false;
        
        // Simulation State
        this.blocks = [];      // {x, y}
        this.lines = [];       // {x, y, w, h, alpha, persistence}
        this.frontier = [];    // {x, y}
        
        // Bitmask Map: Bit 0 = Occupied, Bit 1 = Frontier, Bits 2-15 = BurstID
        this.map = null;       // Uint16Array
        this.mapCols = 0;
        this.burstCounter = 0;
        
        this.origin = null;    // {x, y} center of plus
        this.blocksAdded = 0;
        this.tendrils = [];    // [{x,y}, {x,y}...]
        
        // Catch/Stall State
        this.catchTimer = 0;   
        
        // Timing
        this.nextExpandTime = 0;
        this.currentDelay = 0;
        this.blockSize = 4;
        this.timeoutId = null;
        
        // Fade State
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.fadeInAlpha = 0.0;
    }

    _getEffectiveState() {
        const s = this.c.state;
        const fadeFrames = s.quantizedPulseFadeFrames !== undefined ? s.quantizedPulseFadeFrames : 15;
        const fadeInFrames = s.quantizedPulseFadeInFrames !== undefined ? s.quantizedPulseFadeInFrames : 5;
        // If fadeFrames is 0 (Off), fade is instant (speed 1.0)
        const lineSpeed = fadeFrames > 0 ? (1.0 / fadeFrames) : 1.0;

        return {
            enabled: s.quantizedPulseEnabled,
            freq: s.quantizedPulseFrequencySeconds,
            duration: s.quantizedPulseDurationSeconds || 2.0,
            fadeFrames: fadeFrames,
            fadeInFrames: fadeInFrames,
            baseDelay: 2.0,     // Much faster start (was 8)
            acceleration: 0.98, // Very subtle acceleration (was 0.94)
            minDelay: 0.5,      // Keep top speed cap same
            blockSize: 4,
            lineFadeSpeed: lineSpeed 
        };
    }
    
    stop() {
        this.active = false;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        
        // Immediate cleanup
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        if (this.map) this.map.fill(0);
    }
    
    beginFade() {
        const s = this._getEffectiveState();
        if (s.fadeFrames > 0) {
            this.isFading = true;
            this.fadeAlpha = 1.0;
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        } else {
            this.stop();
        }
    }

    trigger() {
        if (this.active) return false;
        // Safety check: if blocks exist, we are effectively active (or zombies), so prevent trigger
        if (this.blocks && this.blocks.length > 0) {
             // Force stop to clean up zombies
             this.stop();
        }
        
        this.active = true;
        this.isFading = false;
        this.fadeAlpha = 1.0;
        this.startTime = Date.now();
        
        const s = this._getEffectiveState();
        this.fadeInAlpha = (s.fadeInFrames > 0) ? 0.0 : 1.0;

        if (s.duration > 0) {
            this.timeoutId = setTimeout(() => {
                this.beginFade();
            }, s.duration * 1000);
        }
        
        // Resize map if needed
        const total = this.g.cols * this.g.rows;
        if (!this.map || this.map.length !== total) {
            this.map = new Uint16Array(total);
        } else {
            this.map.fill(0);
        }
        this.mapCols = this.g.cols;
        this.burstCounter = 0;

        // Reset all arrays (reuse if possible, but assignment is cleaner for GC in this case)
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.tendrils = [];
        this.blocksAdded = 0;
        this.catchTimer = 0;
        
        const cx = Math.floor((this.g.cols / 2) / 4) * 4;
        const cy = Math.floor((this.g.rows / 2) / 4) * 4;
        
        this._addBlock(cx, cy);
        this.origin = {x: cx, y: cy};
        this.blocksAdded = 1;
        
        this.currentDelay = s.baseDelay;
        this.nextExpandTime = this.currentDelay;
        
        return true;
    }

    _addBlock(x, y, burstId = 0) {
        if (this._isOccupied(x, y)) return;

        this.blocks.push({x, y});
        
        if (x >= 0 && y >= 0 && x < this.mapCols && y < this.g.rows) {
            // Set Occupied (Bit 0) and BurstID (Bits 2-15)
            // Clear Frontier (Bit 1)
            this.map[y * this.mapCols + x] = (this.map[y * this.mapCols + x] & ~2) | 1 | (burstId << 2);
        }

        const bs = 4;

        const potentialNeighbors = [
            {x: x, y: y - bs, side: 0}, 
            {x: x + bs, y: y, side: 1}, 
            {x: x, y: y + bs, side: 2}, 
            {x: x - bs, y: y, side: 3}  
        ];

        potentialNeighbors.forEach(pn => {
            if (this._isOccupied(pn.x, pn.y)) {
                // Check if neighbor is part of the current expansion burst
                let isNewInCycle = false;
                if (pn.x >= 0 && pn.x < this.mapCols && pn.y >= 0 && pn.y < this.g.rows) {
                     const nbVal = this.map[pn.y * this.mapCols + pn.x];
                     const nbBurst = nbVal >> 2;
                     // Only consider it "new in cycle" if burstId matches AND burstId is > 0
                     // (burstId 0 is reserved for initial or non-burst blocks)
                     if (burstId > 0 && nbBurst === burstId) isNewInCycle = true;
                }
                
                if (!isNewInCycle) {
                    let lx, ly, lw, lh;
                    if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }
                    else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; }
                    else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; }
                    else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }
                    
                    const s = this._getEffectiveState();
                    const persistence = s.fadeFrames > 0 ? Math.floor(5 + Math.random() * 10) : 0;
                    
                    this.lines.push({x: lx, y: ly, w: lw, h: lh, alpha: 1.0, persistence: persistence});
                }
            } else {
                if (pn.x >= 0 && pn.x < this.g.cols && pn.y >= 0 && pn.y < this.g.rows) {
                    const pIdx = pn.y * this.mapCols + pn.x;
                    if ((this.map[pIdx] & 2) === 0) {
                        this.frontier.push({x: pn.x, y: pn.y});
                        this.map[pIdx] |= 2;
                    }
                }
            }
        });
    }

    _isOccupied(x, y) {
        if (x < 0 || y < 0 || x >= this.mapCols) return false; // Bounds check (y check implied by index range but safer to be explicit if rows needed)
        // Actually simple bounds check is good
        if (y >= this.g.rows) return false;
        
        return (this.map[y * this.mapCols + x] & 1) !== 0;
    }

    update() {
        if (!this.active) return;
        const s = this._getEffectiveState();
        
        // Handle Fade In
        if (this.fadeInAlpha < 1.0) {
            this.fadeInAlpha += 1.0 / Math.max(1, s.fadeInFrames);
            if (this.fadeInAlpha > 1.0) this.fadeInAlpha = 1.0;
        }
        
        if (this.isFading) {
            const decay = 1.0 / Math.max(1, s.fadeFrames);
            this.fadeAlpha -= decay;
            if (this.fadeAlpha <= 0) {
                this.stop();
            }
            return;
        }
        
        // Duration Check
        if (s.duration > 0 && (Date.now() - this.startTime) > s.duration * 1000) {
            this.beginFade();
            return;
        }

        // Removed catchTimer logic for consistent speed

        if (this.frontier.length > 0 || this.blocksAdded < 5) {
            if (--this.nextExpandTime <= 0) {
                
                if (this.blocksAdded < 5) {
                    this._updateStart(s);
                } else {
                    this._updateExpansion(s);
                }

                this.currentDelay = Math.max(s.minDelay, this.currentDelay * s.acceleration);
                this.nextExpandTime = Math.max(1, Math.floor(this.currentDelay));
            }
        }

        this._updateLines(s);
        this._updateTendrils(s);

        if (this.frontier.length === 0 && this.lines.length === 0 && this.tendrils.length === 0) {
            this.active = false;
        } 
        
        if (this.blocks.length > 8000) this.active = false;
    }

    _updateTendrils(s) {
        if (this.blocks.length === 0) return;
        
        const MAX_TENDRILS = 12;
        const SPAWN_RATE = 0.2;
        
        if (this.tendrils.length < MAX_TENDRILS && Math.random() < SPAWN_RATE) {
            if (this.frontier.length > 0) {
                const start = this.frontier[Math.floor(Math.random() * this.frontier.length)];
                const used = this.tendrils.some(t => t.path.some(b => b.x === start.x && b.y === start.y));
                if (!used) {
                    this.tendrils.push({
                        path: [{x: start.x, y: start.y}],
                        searchCount: 0
                    });
                }
            }
        }
        
        for (let i = this.tendrils.length - 1; i >= 0; i--) {
            const t = this.tendrils[i];
            const path = t.path;
            const tip = path[path.length - 1];
            
            // Check if tip is now occupied by main blob (overcome)
            if (this._isOccupied(tip.x, tip.y)) {
                this.tendrils.splice(i, 1);
                continue;
            }

            if (this._hasCode(tip.x, tip.y)) {
                 this._hardenTendril(path);
                 this.tendrils.splice(i, 1);
                 continue;
            }
            
            // Search Limit (10 changes)
            if (t.searchCount >= 10) {
                 this._hardenTendril(path);
                 this.tendrils.splice(i, 1);
                 continue;
            }

            const neighbors = [
                {x: tip.x, y: tip.y - 4},
                {x: tip.x + 4, y: tip.y},
                {x: tip.x, y: tip.y + 4},
                {x: tip.x - 4, y: tip.y}
            ];
                 
            const candidates = neighbors.filter(n => 
                !this._isOccupied(n.x, n.y) && 
                !path.some(tb => tb.x === n.x && tb.y === n.y) &&
                n.x >= 0 && n.x < this.mapCols && n.y >= 0 && n.y < this.g.rows
            );
            
            if (candidates.length > 0) {
                const next = candidates[Math.floor(Math.random() * candidates.length)];
                path.push(next);
                if (path.length > 3) {
                    path.shift(); 
                }
                
                t.searchCount++;
                
                if (this._hasCode(next.x, next.y)) {
                    this._hardenTendril(path);
                    this.tendrils.splice(i, 1);
                }
            } else {
                // Stuck -> Harden
                this._hardenTendril(path);
                this.tendrils.splice(i, 1);
            }
        }
    }

    _hasCode(x, y) {
        // Check center of the 4x4 block
        const gx = x + 2;
        const gy = y + 2;
        if (gx < 0 || gy < 0 || gx >= this.g.cols || gy >= this.g.rows) return false;
        
        const idx = this.g.getIndex(gx, gy);
        return (this.g.state && this.g.state[idx] === 1);
    }

    _hardenTendril(path) {
        path.forEach(b => {
             this._addBlock(b.x, b.y, this.burstCounter);
        });
    }

    _updateLines(s) {
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].persistence > 0) {
                this.lines[i].persistence--;
            } else {
                this.lines[i].alpha -= s.lineFadeSpeed;
                if (this.lines[i].alpha <= 0) this.lines.splice(i, 1);
            }
        }
    }

    _updateStart(s) {
        const neighbors = [
            {x: this.origin.x, y: this.origin.y - 4},
            {x: this.origin.x + 4, y: this.origin.y},
            {x: this.origin.x, y: this.origin.y + 4},
            {x: this.origin.x - 4, y: this.origin.y}
        ];
        
        const next = neighbors.find(n => !this._isOccupied(n.x, n.y));
        if (next) {
            this._addBlock(next.x, next.y);
            this.blocksAdded++;
            const fIdx = this.frontier.findIndex(f => f.x === next.x && f.y === next.y);
            if (fIdx !== -1) {
                const f = this.frontier[fIdx];
                if (f.x >= 0 && f.y >= 0 && f.x < this.mapCols && f.y < this.g.rows) {
                    this.map[f.y * this.mapCols + f.x] &= ~2;
                }
                const l = this.frontier.pop();
                if (fIdx < this.frontier.length) {
                    this.frontier[fIdx] = l;
                }
            }
        }
    }

    _updateExpansion(s) {
        let burstCount = Math.ceil(1 / Math.max(0.2, this.currentDelay));
        if (burstCount > 12) burstCount = 12; 
        
        // Increment Burst Counter (1..16383)
        this.burstCounter = (this.burstCounter + 1) & 0x3FFF; 
        if (this.burstCounter === 0) this.burstCounter = 1;

        for(let b=0; b<burstCount; b++) {
            if (this.frontier.length === 0) break;

            let totalWeight = 0;
            const weights = this.frontier.map(f => {
                let w = 1.0; 
                const dx = Math.abs(f.x - this.origin.x);
                const dy = Math.abs(f.y - this.origin.y);
                
                if (dx < 4 || dy < 4) { w += 80.0; } 
                else if (dx < 12 || dy < 12) { w += 20.0; } 

                let neighbors = 0;
                if (this._isOccupied(f.x, f.y - 4)) neighbors++;
                if (this._isOccupied(f.x + 4, f.y)) neighbors++;
                if (this._isOccupied(f.x, f.y + 4)) neighbors++;
                if (this._isOccupied(f.x - 4, f.y)) neighbors++;
                if (neighbors >= 2) { w += 10.0; }

                w += Math.random() * 5.0;
                totalWeight += w;
                return w;
            });

            let r = Math.random() * totalWeight;
            let winnerIdx = -1;
            for(let i=0; i<weights.length; i++) {
                r -= weights[i];
                if (r <= 0) { winnerIdx = i; break; }
            }
            if (winnerIdx === -1 && weights.length > 0) winnerIdx = weights.length - 1;

            if (winnerIdx !== -1) {
                const winner = this.frontier[winnerIdx];
                if (winner.x >= 0 && winner.y >= 0 && winner.x < this.mapCols && winner.y < this.g.rows) {
                    this.map[winner.y * this.mapCols + winner.x] &= ~2;
                }
                
                // Swap-pop removal (O(1))
                const last = this.frontier.pop();
                if (winnerIdx < this.frontier.length) {
                    this.frontier[winnerIdx] = last;
                }
                
                if (!this._isOccupied(winner.x, winner.y)) {
                    this._addBlock(winner.x, winner.y, this.burstCounter);
                    
                    // GROUP ADDITION LOGIC
                    const rand = Math.random();
                    
                    // 30% chance for 2x2 (Big Square)
                    if (rand < 0.3) {
                        const candidates = [
                            [{x:4,y:0}, {x:0,y:4}, {x:4,y:4}],    
                            [{x:-4,y:0}, {x:0,y:4}, {x:-4,y:4}],  
                            [{x:4,y:0}, {x:0,y:-4}, {x:4,y:-4}],  
                            [{x:-4,y:0}, {x:0,y:-4}, {x:-4,y:-4}] 
                        ];
                        
                        for(const cluster of candidates) {
                            const valid = cluster.some(offset => 
                                !this._isOccupied(winner.x + offset.x, winner.y + offset.y)
                            );
                            
                            if (valid) {
                                cluster.forEach(offset => {
                                    const tx = winner.x + offset.x;
                                    const ty = winner.y + offset.y;
                                    this._addBlock(tx, ty, this.burstCounter);
                                    const exIdx = this.frontier.findIndex(f => f.x === tx && f.y === ty);
                                    if (exIdx !== -1) {
                                        if (tx >= 0 && ty >= 0 && tx < this.mapCols && ty < this.g.rows) {
                                            this.map[ty * this.mapCols + tx] &= ~2;
                                        }
                                        const l = this.frontier.pop();
                                        if (exIdx < this.frontier.length) {
                                            this.frontier[exIdx] = l;
                                        }
                                    }
                                });
                                break; 
                            }
                        }
                    }
                    // 50% chance for 1x2 or 2x1 (Rectangle)
                    else if (rand < 0.8) {
                        const type = Math.random() < 0.5 ? 'h' : 'v';
                        let extra = null;
                        
                        if (type === 'h') {
                            if (!this._isOccupied(winner.x + 4, winner.y)) extra = {x: winner.x + 4, y: winner.y};
                            else if (!this._isOccupied(winner.x - 4, winner.y)) extra = {x: winner.x - 4, y: winner.y};
                        } 
                        
                        if (!extra) { 
                             if (!this._isOccupied(winner.x, winner.y + 4)) extra = {x: winner.x, y: winner.y + 4};
                             else if (!this._isOccupied(winner.x, winner.y - 4)) extra = {x: winner.x, y: winner.y - 4};
                        }
                        
                        if (extra) {
                            this._addBlock(extra.x, extra.y, this.burstCounter);
                            const exIdx = this.frontier.findIndex(f => f.x === extra.x && f.y === extra.y);
                            if (exIdx !== -1) {
                                if (extra.x >= 0 && extra.y >= 0 && extra.x < this.mapCols && extra.y < this.g.rows) {
                                    this.map[extra.y * this.mapCols + extra.x] &= ~2;
                                }
                                const l = this.frontier.pop();
                                if (exIdx < this.frontier.length) {
                                    this.frontier[exIdx] = l;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    applyToGrid(grid) {
        // No grid overrides
    }

    render(ctx, derived) {
        if (!this.active) return;
        const s = this.c.state;
        const cw = derived.cellWidth * s.stretchX;
        const ch = derived.cellHeight * s.stretchY;
        const colorStr = '#FFFF00'; 
        
        const masterAlpha = this.fadeAlpha * this.fadeInAlpha;
        
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, cw * 0.15); 
        
        ctx.beginPath();
        ctx.strokeStyle = colorStr;
        ctx.shadowBlur = 15;
        ctx.shadowColor = colorStr;
        ctx.globalAlpha = masterAlpha;
        
        ctx.setLineDash([cw * 0.5, cw * 0.5, cw * 1.5, cw * 0.5]);

        for (const b of this.blocks) {
            const nTop = this._isOccupied(b.x, b.y - 4);
            const nRight = this._isOccupied(b.x + 4, b.y);
            const nBottom = this._isOccupied(b.x, b.y + 4);
            const nLeft = this._isOccupied(b.x - 4, b.y);
            
            const bx = b.x * cw;
            const by = b.y * ch;
            const bw = 4 * cw;
            const bh = 4 * ch;

            if (!nTop) { ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); }
            if (!nRight) { ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); }
            if (!nBottom) { ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); }
            if (!nLeft) { ctx.moveTo(bx, by); ctx.lineTo(bx, by + bh); }
        }
        ctx.stroke();

        // Render Tendrils
        if (this.tendrils.length > 0) {
            ctx.globalAlpha = 0.5 * masterAlpha;
            ctx.setLineDash([cw * 0.2, cw * 0.2]); 
            ctx.beginPath();
            for (const t of this.tendrils) {
                for (const b of t.path) {
                    const bx = b.x * cw;
                    const by = b.y * ch;
                    const bw = 4 * cw;
                    const bh = 4 * ch;
                    ctx.rect(bx, by, bw, bh);
                }
            }
            ctx.stroke();
            ctx.globalAlpha = masterAlpha;
        }

        ctx.shadowBlur = 0; 
        
        ctx.setLineDash([cw * 0.25, cw * 0.25, cw * 0.5, cw * 0.25]);
        
        for (const l of this.lines) {
            ctx.globalAlpha = l.alpha * masterAlpha;
            ctx.beginPath();
            const lx = l.x * cw;
            const ly = l.y * ch;
            const lPxW = l.w * cw;
            const lPxH = l.h * ch;
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + lPxW, ly + lPxH);
            ctx.stroke();
        }
        
        ctx.setLineDash([]); 
        ctx.globalAlpha = 1.0; // Reset for safety (though canvas usually isolates)
        ctx.shadowBlur = 0;
    }
}