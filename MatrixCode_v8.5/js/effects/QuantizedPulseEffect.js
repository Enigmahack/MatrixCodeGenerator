class QuantizedPulseEffect extends AbstractEffect {
    constructor(grid, config) {
        super(grid, config);
        this.name = "QuantizedPulse";
        this.active = false;
        
        // Simulation State
        this.blocks = [];      // {x, y}
        this.lines = [];       // {x, y, w, h, alpha, persistence}
        this.frontier = [];    // {x, y}
        this.origin = null;    // {x, y} center of plus
        this.blocksAdded = 0;
        
        // Catch/Stall State
        this.catchTimer = 0;   
        
        // Timing
        this.nextExpandTime = 0;
        this.currentDelay = 0;
        this.blockSize = 4;
    }

    _getEffectiveState() {
        const s = this.c.state;
        return {
            enabled: s.quantizedPulseEnabled,
            freq: s.quantizedPulseFrequencySeconds,
            baseDelay: 2.0,     // Much faster start (was 8)
            acceleration: 0.98, // Very subtle acceleration (was 0.94)
            minDelay: 0.5,      // Keep top speed cap same
            blockSize: 4,
            lineFadeSpeed: 0.15 
        };
    }

    trigger() {
        if (this.active) return false;
        
        this.active = true;
        this.blocks = [];
        this.lines = [];
        this.frontier = [];
        this.blocksAdded = 0;
        this.catchTimer = 0;
        
        const cx = Math.floor((this.g.cols / 2) / 4) * 4;
        const cy = Math.floor((this.g.rows / 2) / 4) * 4;
        
        this._addBlock(cx, cy);
        this.origin = {x: cx, y: cy};
        this.blocksAdded = 1;
        
        const s = this._getEffectiveState();
        this.currentDelay = s.baseDelay;
        this.nextExpandTime = this.currentDelay;
        
        return true;
    }

    _addBlock(x, y) {
        this.blocks.push({x, y});
        const bs = 4;

        const potentialNeighbors = [
            {x: x, y: y - bs, side: 0}, 
            {x: x + bs, y: y, side: 1}, 
            {x: x, y: y + bs, side: 2}, 
            {x: x - bs, y: y, side: 3}  
        ];

        potentialNeighbors.forEach(pn => {
            if (this._isOccupied(pn.x, pn.y)) {
                let lx, ly, lw, lh;
                if (pn.side === 0) { lx = x; ly = y; lw = bs; lh = 0; }
                else if (pn.side === 1) { lx = x + bs; ly = y; lw = 0; lh = bs; }
                else if (pn.side === 2) { lx = x; ly = y + bs; lw = bs; lh = 0; }
                else if (pn.side === 3) { lx = x; ly = y; lw = 0; lh = bs; }
                
                const persistence = Math.floor(5 + Math.random() * 10);
                this.lines.push({x: lx, y: ly, w: lw, h: lh, alpha: 1.0, persistence: persistence});
            } else {
                if (pn.x >= -4 && pn.x < this.g.cols && pn.y >= -4 && pn.y < this.g.rows) {
                    if (!this.frontier.find(f => f.x === pn.x && f.y === pn.y)) {
                        this.frontier.push({x: pn.x, y: pn.y});
                    }
                }
            }
        });
    }

    _isOccupied(x, y) {
        return this.blocks.some(b => b.x === x && b.y === y);
    }

    update() {
        if (!this.active) return;
        const s = this._getEffectiveState();

        if (this.catchTimer > 0) {
            this.catchTimer--;
            this._updateLines(s);
            return; 
        }

        if (this.frontier.length > 0 || this.blocksAdded < 5) {
            if (--this.nextExpandTime <= 0) {
                
                if (this.blocksAdded > 20 && Math.random() < 0.05) {
                    this.catchTimer = Math.floor(5 + Math.random() * 10);
                }

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

        if (this.frontier.length === 0 && this.lines.length === 0) {
            this.active = false;
        } 
        
        if (this.blocks.length > 8000) this.active = false;
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
            if (fIdx !== -1) this.frontier.splice(fIdx, 1);
        }
    }

    _updateExpansion(s) {
        let burstCount = Math.ceil(1 / Math.max(0.2, this.currentDelay));
        if (burstCount > 6) burstCount = 6; 
        
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
                this.frontier.splice(winnerIdx, 1);
                
                if (!this._isOccupied(winner.x, winner.y)) {
                    this._addBlock(winner.x, winner.y);
                    
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
                            const valid = cluster.every(offset => 
                                !this._isOccupied(winner.x + offset.x, winner.y + offset.y)
                            );
                            
                            if (valid) {
                                cluster.forEach(offset => {
                                    const tx = winner.x + offset.x;
                                    const ty = winner.y + offset.y;
                                    this._addBlock(tx, ty);
                                    const exIdx = this.frontier.findIndex(f => f.x === tx && f.y === ty);
                                    if (exIdx !== -1) this.frontier.splice(exIdx, 1);
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
                            this._addBlock(extra.x, extra.y);
                            const exIdx = this.frontier.findIndex(f => f.x === extra.x && f.y === extra.y);
                            if (exIdx !== -1) this.frontier.splice(exIdx, 1);
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
        
        ctx.lineCap = 'butt';
        ctx.lineWidth = Math.max(1, cw * 0.15); 
        
        const occupied = new Set(this.blocks.map(b => `${b.x},${b.y}`));
        
        ctx.beginPath();
        ctx.strokeStyle = colorStr;
        ctx.shadowBlur = 15;
        ctx.shadowColor = colorStr;
        ctx.globalAlpha = 1.0;
        
        ctx.setLineDash([cw * 0.5, cw * 0.5, cw * 1.5, cw * 0.5]);

        for (const b of this.blocks) {
            const nTop = occupied.has(`${b.x},${b.y-4}`);
            const nRight = occupied.has(`${b.x+4},${b.y}`);
            const nBottom = occupied.has(`${b.x},${b.y+4}`);
            const nLeft = occupied.has(`${b.x-4},${b.y}`);
            
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

        ctx.shadowBlur = 0; 
        
        ctx.setLineDash([cw * 0.25, cw * 0.25, cw * 0.5, cw * 0.25]);
        
        for (const l of this.lines) {
            ctx.globalAlpha = l.alpha;
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
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    }
}