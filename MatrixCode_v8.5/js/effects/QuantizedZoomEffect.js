class QuantizedZoomEffect extends QuantizedBaseEffect {
    constructor(g, c, r) {
        super(g, c, r);
        this.name = "QuantizedZoom";
        this.active = false;

        this.configPrefix = "quantizedZoom";

        // Simulation State
        this.timer = 0;
        this.state = 'IDLE';
        this.alpha = 1.0;

        // Zoom State
        this.zoomScale = 0.5;
        this._zoomProgress = 0;
        this.spawnX = 0;
        this.spawnY = 0;
        this._zoomOpacity = 1.0;

        // Snapshot (frozen image captured once)
        this._snapshotCanvas = null;
        this._snapshotCtx = null;
        this._snapshotCaptured = false;
    }

    // Zoom only uses Layer 1 — no multi-layer promotion or L0 persistence.
    getConfig(key) {
        if (key === 'SingleLayerMode') return false;
        if (key === 'LayerCount') return 1;
        if (key === 'GeneratorTakeover') return true;
        if (key === 'ManualSeedOnly') return false; // Enable base-class automatic seeding for the tap position
        if (key === 'FadeInFrames' || key === 'FadeFrames') return 0;
        return super.getConfig(key);
    }

    trigger(force = false, spawnPosition = null) {
        if (this.active && !force) return false;

        // Mutually Exclusive Lock
        if (window.matrix && window.matrix.effectRegistry) {
            const siblings = ["QuantizedPulse", "QuantizedAdd", "QuantizedRetract", "QuantizedClimb"];
            for (const name of siblings) {
                const eff = window.matrix.effectRegistry.get(name);
                if (eff && eff.active) return false;
            }
        }

        this.spawnX = spawnPosition && typeof spawnPosition.x === 'number' ? spawnPosition.x : window.innerWidth / 2;
        this.spawnY = spawnPosition && typeof spawnPosition.y === 'number' ? spawnPosition.y : window.innerHeight / 2;

        if (!super.trigger(force, spawnPosition)) return false;

        this.zoomScale = 0.5;
        this._zoomProgress = 0;
        this._zoomOpacity = 1.0;
        this._snapshotCaptured = false;

        this._initShadowWorld();
        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    /**
     * Captures a single frozen snapshot of the currently visible code.
     * One-time cost at trigger; never updated again.
     */
    _captureSnapshot() {
        const g = this.g;
        const d = this.c.derived;
        const s = this.c.state;
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (!this._snapshotCanvas) {
            this._snapshotCanvas = document.createElement('canvas');
            this._snapshotCtx = this._snapshotCanvas.getContext('2d');
        }
        this._snapshotCanvas.width = w;
        this._snapshotCanvas.height = h;

        if (!QuantizedBaseEffect.sharedAtlas) {
            QuantizedBaseEffect.sharedAtlas = new GlyphAtlas(this.c);
        }
        const atlas = QuantizedBaseEffect.sharedAtlas;
        atlas.update();

        const ctx = this._snapshotCtx;
        const cols = g.cols;
        const rows = g.rows;
        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const chars = g.chars;

        const originX = (w * 0.5) - (cols * cellW * 0.5 * s.stretchX);
        const originY = (h * 0.5) - (rows * cellH * 0.5 * s.stretchY);

        const colors = g.colors;
        const alphas = g.alphas;
        const maxSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const fontStr = `${style}${s.fontWeight} ${maxSize}px ${s.fontFamily}`;

        ctx.save();
        ctx.translate(originX, originY);
        if (s.stretchX !== 1 || s.stretchY !== 1) ctx.scale(s.stretchX, s.stretchY);
        ctx.font = fontStr;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        for (let y = 0; y < rows; y++) {
            const rowOff = y * cols;
            const cy = (y + 0.5) * cellH;
            for (let x = 0; x < cols; x++) {
                const i = rowOff + x;
                const charCode = chars[i];
                if (charCode <= 32) continue;
                const a = alphas ? alphas[i] : 1.0;
                if (a < 0.01) continue;

                const c = colors[i];
                const r = c & 0xFF;
                const gr = (c >> 8) & 0xFF;
                const b = (c >> 16) & 0xFF;

                ctx.globalAlpha = a;
                ctx.fillStyle = `rgb(${r},${gr},${b})`;
                ctx.fillText(String.fromCharCode(charCode), (x + 0.5) * cellW, cy);
            }
        }
        ctx.restore();
        this._snapshotCaptured = true;
    }

    update() {
        if (!this.active) return;

        super.update();

        const s = this.c.state;

        // Capture snapshot once after a few warmup frames
        if (!this._snapshotCaptured && this.animFrame > 5) {
            this._captureSnapshot();
        }

        // Progress zoom scale and opacity
        if (this.state !== 'WAITING' && s.quantizedZoomZoomEnabled) {
            const delayFrames = (s.quantizedZoomDelay || 0) * 60;
            const rate = s.quantizedZoomZoomRate || 1.0;
            const minScale = 0.5;
            const maxScale = s.quantizedZoomMaxScale || 1.5;

            if (this.animFrame >= delayFrames) {
                this._zoomProgress += 0.005 * rate;
                const t = Math.min(1.0, this._zoomProgress);
                const smoothT = t * t * (3 - 2 * t);
                this.zoomScale = minScale + ((maxScale - minScale) * smoothT);

                // Fade out as zoom progresses
                const baseOpacity = s.quantizedZoomOpacity ?? 1.0;
                this._zoomOpacity = baseOpacity * (1.0 - smoothT);
            } else {
                this.zoomScale = minScale;
                this._zoomOpacity = s.quantizedZoomOpacity ?? 1.0;
            }
        }
    }

    /**
     * Override render to draw the frozen zoomed snapshot onto the overlay canvas.
     * Uses a clip path from revealed blocks — no scratch canvas or compositing modes.
     */
    render(ctx, d) {
        // Let the base handle gridCache for WebGL perimeter line texture
        super.render(ctx, d);

        if (!this._snapshotCaptured || this._zoomOpacity < 0.01) return;

        const s = this.c.state;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        const srGrid = this.shadowRevealGrid;
        if (!srGrid) return;
        const blocksX = this.logicGridW;
        const blocksY = this.logicGridH;
        if (!blocksX || !blocksY) return;

        const bs = this.getBlockSize();
        const pitchX = Math.max(1, bs.w);
        const pitchY = Math.max(1, bs.h);
        const { offX, offY } = this._computeCenteredOffset(blocksX, blocksY, pitchX, pitchY);

        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const cols = this.g.cols;
        const originX = (w * 0.5) - (cols * cellW * 0.5 * s.stretchX);
        const originY = (h * 0.5) - (this.g.rows * cellH * 0.5 * s.stretchY);
        const stepX = cellW * s.stretchX;
        const stepY = cellH * s.stretchY;

        // Build clip path from revealed blocks
        ctx.save();
        ctx.beginPath();
        let hasClip = false;
        for (let by = 0; by < blocksY; by++) {
            for (let bx = 0; bx < blocksX; bx++) {
                if (srGrid[by * blocksX + bx] === 0) continue;
                const px = originX + (bx - offX) * pitchX * stepX;
                const py = originY + (by - offY) * pitchY * stepY;
                ctx.rect(px, py, pitchX * stepX, pitchY * stepY);
                hasClip = true;
            }
        }
        if (!hasClip) { ctx.restore(); return; }
        ctx.clip();

        // Draw zoomed + tiled snapshot within the clip
        ctx.globalAlpha = this._zoomOpacity;

        const sx = this.spawnX;
        const sy = this.spawnY;
        const Z = this.zoomScale;
        const snap = this._snapshotCanvas;
        const sw = snap.width;
        const sh = snap.height;

        ctx.translate(sx, sy);
        ctx.scale(Z, Z);
        ctx.translate(-sx, -sy);

        // 2x2 tiling: four copies meeting at the spawn point
        ctx.drawImage(snap, sx - sw, sy - sh);
        ctx.drawImage(snap, sx,      sy - sh);
        ctx.drawImage(snap, sx - sw, sy);
        ctx.drawImage(snap, sx,      sy);

        ctx.restore();
    }
}

if (typeof window !== 'undefined') window.QuantizedZoomEffect = QuantizedZoomEffect;
