class FirewallEffect extends AbstractEffect {
    constructor(g, c) {
        super(g, c);
        this.name = "Firewall";
        this.active = false;
        this.autoTimer = c.state.firewallFrequencySeconds * 60;
        this.column = -1;
        this.state = 'IDLE'; 
        this.reverseTimer = 0;
        this.eraseTimer = 0;
        this.snapChars = null;
        this.cleanupFrames = 2; // Add a final cleanup buffer frame
    }

    trigger() {
        if (this.active) return false;
        
        // 1. Pick Random Column
        this.column = Utils.randomInt(1, this.g.cols - 2); 
        this.reverseTimer = this.c.state.firewallReverseDurationFrames; 
        this.eraseTimer = this.c.state.firewallEraseDurationFrames + this.cleanupFrames; // Add buffer
        this.active = true;
        this.state = 'REVERSING';

        // 2. Snapshot the existing code
        this.snapChars = new Uint16Array(this.g.rows);
        for (let y = 0; y < this.g.rows; y++) {
            const idx = this.g.getIndex(this.column, y);
            this.snapChars[y] = this.g.chars[idx];
        }
        
        return true;
    }

    update() {
        const s = this.c.state;

        // Auto-trigger logic
        if (!this.active && s.firewallEnabled && this.autoTimer-- <= 0) { 
            this.trigger(); 
            this.autoTimer = s.firewallFrequencySeconds * 60; 
        }
        if (!this.active) { return; }

        if (this.state === 'REVERSING') {
            if (this.reverseTimer-- <= 0) {
                this.state = 'ERASING';
            }
        } else if (this.state === 'ERASING') {
            this.eraseTimer--;
            
            // If we are in the last two frames (cleanup buffer), ensure the column is empty
            if (this.eraseTimer <= this.cleanupFrames) {
                // Deep clean the column so it is totally empty
                for (let y = 0; y < this.g.rows; y++) {
                    const idx = this.g.getIndex(this.column, y);
                    this.g.types[idx] = CELL_TYPE.EMPTY;
                    this.g.alphas[idx] = 0;
                    this.g.ages[idx] = 0;
                    this.g.decays[idx] = 0;
                    this.g.rotatorProg[idx] = 0;
                    this.g.complexStyles.delete(idx);
                }
            }

            if (this.eraseTimer <= 0) {
                this.active = false;
                this.snapChars = null;
            }
        }
    }

    getOverride(i) {
        if (!this.active || this.snapChars === null) return null;

        const x = i % this.g.cols; 
        if (x !== this.column) return null; 
        
        const y = Math.floor(i / this.g.cols);
        const s = this.c.state;
        const d = this.c.derived;

        const originalChar = String.fromCharCode(this.snapChars[y]);

        // Fix for residual flash: If timer is in cleanup phase, return a transparent block.
        if (this.state === 'ERASING' && this.eraseTimer <= this.cleanupFrames) {
             return { char: '', color: '#000000', alpha: 0.0, glow: 0, size: 0, solid: true, bgColor: '#000000' };
        }

        // --- PHASE 1: REVERSE FLOW ---
        if (this.state === 'REVERSING') {
            const maxT = s.firewallReverseDurationFrames;
            const progress = 1.0 - (this.reverseTimer / maxT);
            
            // Sample characters from below to create upward illusion
            let charToDraw = originalChar;
            const slideOffset = Math.floor(progress * this.g.rows * 0.5); 
            const sampleY = Math.min(this.g.rows - 1, y + slideOffset);
            
            const charCode = this.snapChars[sampleY] || this.snapChars[y];
            
            return {
                char: String.fromCharCode(charCode),
                color: d.streamColorStr, // Use stream color
                alpha: 1.0,
                glow: 20,
                size: 2,
                solid: false,
                blend: false
            };
        } 
        
        // --- PHASE 2: ERASE & FADE ---
        else if (this.state === 'ERASING') {
            const maxT = s.firewallEraseDurationFrames - this.cleanupFrames; // Base duration for fade
            const progress = 1.0 - (this.eraseTimer / maxT);

            // Calculate Alpha for the Fade
            const alpha = Math.max(0, 1.0 - progress);
            
            if (alpha <= 0.01) return null;

            // Use the base stream color RGB values
            const streamRgb = d.streamRgb;
            
            // Flicker the solid color between the stream color and a bright white/tracer color
            const isTracer = Math.random() > 0.7;
            const r = isTracer ? 255 : streamRgb.r;
            const g = isTracer ? 255 : streamRgb.g;
            const b = isTracer ? 255 : streamRgb.b;
            
            // Create RGBA string so the BLOCK fades
            const rgbaColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;

            return {
                char: originalChar,
                color: rgbaColor, 
                alpha: alpha, 
                glow: 30 * alpha,
                size: 4,
                solid: true, 
                bgColor: rgbaColor, 
                blend: false
            };
        }

        return null;
    }
}
