class CanvasRenderer {
    constructor(canvasId, grid, config, effects) {
        this.cvs = document.getElementById(canvasId);
        this.ctx = this.cvs.getContext('2d', { alpha: true });
        this.grid = grid;
        this.config = config;
        this.effects = effects;
        this.w = 0;
        this.h = 0;
        
        console.log("Rendering Engine: Canvas 2D Fallback");
    }

    setGrid(grid) {
        this.grid = grid;
    }

    resize() {
        this.w = window.innerWidth;
        this.h = window.innerHeight;
        this.cvs.width = this.w;
        this.cvs.height = this.h;
    }

    handleFontChange() {}
    preallocate() {}
    updateSmoothing() {}
    
    dispose() {
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.w, this.h);
        }
    }

    render(frame) {
        if (!this.ctx || !this.grid) return;

        const g = this.grid;
        const s = this.config.state;
        const d = this.config.derived;
        const ctx = this.ctx;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.w, this.h);

        const cw = d.cellWidth;
        const ch = d.cellHeight;
        const cols = g.cols;
        const rows = g.rows;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Simple 2D render loop
        for (let i = 0; i < cols * rows; i++) {
            const alpha = g.alphas[i];
            if (alpha <= 0.01 && !g.overrideActive[i]) continue;

            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * cw + (cw / 2);
            const y = row * ch + (ch / 2);

            let charCode = g.chars[i];
            let colorU32 = g.colors[i];
            let finalAlpha = alpha;

            // Handle Overrides
            if (g.overrideActive && g.overrideActive[i]) {
                charCode = g.overrideChars[i] || charCode;
                colorU32 = g.overrideColors[i] || colorU32;
                finalAlpha = g.overrideAlphas[i];
            }

            if (finalAlpha <= 0.01) continue;

            const r = (colorU32 & 0xFF);
            const g8 = (colorU32 >> 8) & 0xFF;
            const b = (colorU32 >> 16) & 0xFF;

            ctx.globalAlpha = finalAlpha;
            ctx.fillStyle = `rgb(${r},${g8},${b})`;
            
            // Note: In 2D fallback, we don't support multiple fonts per frame easily
            // We just use the first active font for simplicity
            const fontName = d.activeFonts && d.activeFonts[0] ? d.activeFonts[0].name : 'monospace';
            ctx.font = `${ch}px "${fontName}"`;
            
            ctx.fillText(String.fromCharCode(charCode), x, y);
        }
        ctx.globalAlpha = 1.0;
    }
}
