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
        this.shiftCounter = 0;
        this.shiftInterval = 2; // Shift every 2 frames during reversing
        this._firewallRandomColor = null; // Store the random color for a given trigger
    } // Added missing closing brace

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

        // Generate random color once per trigger if enabled
        if (this.c.state.firewallRandomColorEnabled) {
            const randomHue = Utils.randomInt(0, 359);
            this._firewallRandomColor = Utils.hslToRgb(randomHue, 100, 70);
        } else {
            this._firewallRandomColor = null; // Clear if not using random color
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
            } else {
                this.shiftCounter++;
                if (this.shiftCounter >= this.shiftInterval) {
                    this._shiftColumnCharsUpwards();
                    this.shiftCounter = 0;
                }
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

    _shiftColumnCharsUpwards() {
        if (!this.snapChars) return;
        const topChar = this.snapChars[0];
        for (let y = 0; y < this.g.rows - 1; y++) {
            this.snapChars[y] = this.snapChars[y + 1];
        }
        this.snapChars[this.g.rows - 1] = topChar;
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
            const charCode = this.snapChars[y];
            
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

            let finalRgb;
            if (s.firewallRandomColorEnabled) {
                finalRgb = this._firewallRandomColor;
            } else {
                // Use the configured firewall color
                finalRgb = Utils.hexToRgb(s.firewallColor);
            }
            
            // Create RGBA string so the BLOCK fades
            const rgbaColor = `rgba(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b}, ${alpha})`;

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
