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
        this.zoomScale = 0.25;
        this._smoothedZoom = 0.25;   // EMA-smoothed zoom for jitter-free motion
        this.spawnX = 0;
        this.spawnY = 0;
        this._zoomOpacity = 1.0;
        this._savedBrightness = null; // Original brightness to restore on terminate
        this._fadingOut = false;      // True once base lifecycle ends; drives a timed fade-out
        this._fadeOutProgress = 0;    // 0→1 fade-out interpolant

        // Strip-based dynamic background — captures complete stream segments
        this._segmentLibrary = [];      // Array of captured stream segments (black-to-black)
        this._maxSegments = 512;        // Max segments to keep in library
        this._stripsCaptured = false;   // Whether we have enough segments to render
        this._captureInterval = 2;      // Capture every N frames during warmup
        this._captureFrame = 0;         // Internal frame counter for capture pacing
        this._bgCanvas = null;          // Offscreen canvas for composited background tile
        this._bgCtx = null;
        this._bgDirty = true;           // Whether the background tile needs rebuilding
        this._bgTileW = 0;             // Current tile dimensions
        this._bgTileH = 0;
        this._lastFontStr = '';         // Track font changes for invalidation
    }

    getConfig(key) {
        if (key === 'LayerCount') return 1;
        if (key === 'GeneratorTakeover') return false;
        if (key === 'ManualSeedOnly') return false; // Enable base-class automatic seeding for the tap position

        if (!super.getConfig('TriggerBrightnessSwell')) {
            if (key === 'FadeInFrames' || key === 'FadeFrames') return 0;
        }

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

        this.zoomScale = 0.25;
        this._smoothedZoom = 0.25;
        this._zoomOpacity = 1.0;
        this._savedBrightness = this.c.state.brightness ?? 1.0;
        this._fadingOut = false;
        this._fadeOutProgress = 0;
        this._stripsCaptured = false;
        this._segmentLibrary = [];
        this._captureFrame = 0;
        this._bgDirty = true;

        // Match BlockGenerator: check for sequence and enter GENERATING if none exists
        const hasSequence = this.sequence && this.sequence.length > 0 && !(this.sequence.length === 1 && this.sequence[0].length === 0);
        if (!hasSequence) {
            this.state = 'GENERATING';
            this.alpha = 1.0;
            this.timer = 0;
            this.expansionPhase = 0;
        }

        if (this.state === 'GENERATING') {
            this._initProceduralState(true);
        } else {
            this._initProceduralState(false);
        }
        if (this.renderGrid) this.renderGrid.fill(-1);

        return true;
    }

    /**
     * Scans a column and extracts complete stream segments — contiguous runs
     * of visible characters bounded by dark/empty cells on both ends.
     * Each segment has its own length, so strips don't all start and stop
     * at the same row, eliminating horizontal seam lines in the tile.
     */
    _captureColumnSegments(col) {
        const g = this.g;
        const rows = g.rows;
        const cols = g.cols;
        const chars = g.chars;
        const colors = g.colors;
        const alphas = g.alphas;
        const darkThreshold = 0.03;
        const minSegmentLen = 3; // Ignore tiny fragments

        const segments = [];
        let segStart = -1;

        for (let y = 0; y <= rows; y++) {
            const isDark = (y >= rows) ||
                           (chars[y * cols + col] <= 32) ||
                           (alphas[y * cols + col] < darkThreshold);

            if (!isDark && segStart === -1) {
                // Start of a new segment
                segStart = y;
            } else if (isDark && segStart !== -1) {
                // End of segment — capture it
                const len = y - segStart;
                if (len >= minSegmentLen) {
                    const seg = {
                        length: len,
                        chars: new Uint16Array(len),
                        colors: new Uint32Array(len),
                        alphas: new Float32Array(len)
                    };
                    for (let r = 0; r < len; r++) {
                        const i = (segStart + r) * cols + col;
                        seg.chars[r] = chars[i];
                        seg.colors[r] = colors[i];
                        seg.alphas[r] = alphas[i];
                    }
                    segments.push(seg);
                }
                segStart = -1;
            }
        }
        return segments;
    }

    /**
     * Captures segments from a batch of columns spread across the grid.
     * Samples every 3rd column (offset rotates per frame) for variety.
     */
    _captureSegmentBatch() {
        const cols = this.g.cols;
        const offset = this._captureFrame % 3;
        for (let x = offset; x < cols; x += 3) {
            if (this._segmentLibrary.length >= this._maxSegments) break;
            const segs = this._captureColumnSegments(x);
            for (let i = 0; i < segs.length; i++) {
                if (this._segmentLibrary.length >= this._maxSegments) break;
                this._segmentLibrary.push(segs[i]);
            }
        }
    }

    /**
     * Builds the background tile from the segment library.
     * For each tile column, picks segments from the library and stacks
     * them with natural dark gaps, each column starting at a different
     * pseudo-random vertical offset. This eliminates any horizontal
     * seam — every column's streams begin and end at different rows.
     *
     * The tile height is set large enough (~2x screen) so that vertical
     * tiling repetition is also hard to spot.
     */
    _buildBackgroundTile() {
        const s = this.c.state;
        const d = this.c.derived;
        const cellW = d.cellWidth;
        const cellH = d.cellHeight;
        const segs = this._segmentLibrary;
        if (segs.length === 0) return;

        const tileColCount = Math.min(segs.length, Math.ceil(this.g.cols * 1.5));
        // Use 2x screen rows for tile height to push vertical repeat far out
        const tileRows = this.g.rows * 2;
        const tileW = Math.ceil(tileColCount * cellW * s.stretchX);
        const tileH = Math.ceil(tileRows * cellH * s.stretchY);

        if (tileW <= 0 || tileH <= 0) return;

        if (!this._bgCanvas) {
            this._bgCanvas = document.createElement('canvas');
            this._bgCtx = this._bgCanvas.getContext('2d');
        }
        this._bgCanvas.width = tileW;
        this._bgCanvas.height = tileH;

        const ctx = this._bgCtx;
        const maxSize = s.fontSize + (s.tracerSizeIncrease || 0);
        const style = s.italicEnabled ? 'italic ' : '';
        const fontStr = `${style}${s.fontWeight} ${maxSize}px ${s.fontFamily}`;

        ctx.clearRect(0, 0, tileW, tileH);
        ctx.save();
        if (s.stretchX !== 1 || s.stretchY !== 1) ctx.scale(s.stretchX, s.stretchY);
        ctx.font = fontStr;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        // Deterministic PRNG for reproducible layout
        let seed = segs.length * 7 + 13;
        const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 1) / 0x3fffffff; };

        // Pre-shuffle segment indices
        const segOrder = new Array(segs.length);
        for (let i = 0; i < segs.length; i++) segOrder[i] = i;
        for (let i = segs.length - 1; i > 0; i--) {
            const j = (rand() * (i + 1)) | 0;
            const tmp = segOrder[i]; segOrder[i] = segOrder[j]; segOrder[j] = tmp;
        }
        let segPick = 0;

        const gapMin = 2;  // Minimum dark gap between segments (in cell rows)
        const gapMax = 8;  // Maximum dark gap

        for (let col = 0; col < tileColCount; col++) {
            const cx = (col + 0.5) * cellW;

            // Each column starts at a different random offset into the tile
            let cursor = Math.floor(rand() * tileRows * 0.4);

            // Stack segments with dark gaps until we fill the tile height
            while (cursor < tileRows) {
                const seg = segs[segOrder[segPick % segs.length]];
                segPick++;

                // Draw this segment at the cursor position, wrapping around tile height
                for (let r = 0; r < seg.length; r++) {
                    const tileY = (cursor + r) % tileRows;
                    const charCode = seg.chars[r];
                    if (charCode <= 32) continue;
                    const a = seg.alphas[r];
                    if (a < 0.01) continue;

                    const c = seg.colors[r];
                    const rv = c & 0xFF;
                    const gv = (c >> 8) & 0xFF;
                    const bv = (c >> 16) & 0xFF;

                    ctx.globalAlpha = a;
                    ctx.fillStyle = `rgb(${rv},${gv},${bv})`;
                    ctx.fillText(String.fromCharCode(charCode), cx, (tileY + 0.5) * cellH);
                }

                cursor += seg.length;
                // Add a dark gap
                cursor += gapMin + Math.floor(rand() * (gapMax - gapMin + 1));
            }
        }

        ctx.restore();
        this._bgTileW = tileW;
        this._bgTileH = tileH;
        this._bgDirty = false;
        this._lastFontStr = fontStr;
    }

    /**
     * Override _swapStates to prevent the base class from setting
     * this.active = false directly, which would kill our fade-out.
     * We let the swap logic run but intercept the deactivation.
     */
    _swapStates() {
        if (this.hasSwapped || this.isSwapping) return;
        const result = this._commitShadowState();
        if (result === 'ASYNC') {
            this.isSwapping = true;
            this.swapTimer = 5;
        } else if (result === 'SYNC') {
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            this.hasSwapped = true;
            this.alpha = 0.0;
            // Do NOT set this.active = false — let _terminate handle it
        } else {
            this.g.clearAllOverrides();
            // Do NOT set this.active = false — let _terminate handle it
        }
    }

    /**
     * Override updateTransition to prevent direct deactivation.
     */
    updateTransition(deactivate = true) {
        if (!this.isSwapping) return false;
        this._updateShadowSim();
        this.swapTimer--;
        if (this.swapTimer <= 0) {
            this.g.clearAllOverrides();
            if (this.g.cellLocks) this.g.cellLocks.fill(0);
            this.isSwapping = false;
            this.hasSwapped = true;
            this.shadowGrid = null;
            this.shadowSim = null;
            // Do NOT set this.active = false — let _terminate handle it
            return true;
        }
        return false;
    }

    update() {
        // During fade-out, skip base update but keep running our logic
        if (this._fadingOut) {
            const s = this.c.state;
            this._fadeOutProgress = Math.min(1.0, this._fadeOutProgress + 0.02);
            const fo = this._fadeOutProgress * this._fadeOutProgress;

            // Zoom opacity fades to zero
            this._zoomOpacity *= (1.0 - fo);

            // Brightness restores toward saved value
            s.brightness += (this._savedBrightness - s.brightness) * Math.min(1.0, this._fadeOutProgress * 2.0);

            // Once complete, do final termination
            if (this._fadeOutProgress >= 1.0) {
                s.brightness = this._savedBrightness;
                this._savedBrightness = null;
                this._fadingOut = false;
                super._terminate();
            }
            return;
        }

        if (!this.active) return;

        super.update();

        const s = this.c.state;

        // Capture stream segments during warmup, then build tile once
        if (this.animFrame > 2 && !this._stripsCaptured) {
            this._captureFrame++;
            if (this._captureFrame % this._captureInterval === 0) {
                if (this._segmentLibrary.length < this._maxSegments) {
                    this._captureSegmentBatch();
                }
            }
            // Once we have enough segments, freeze the library and build the tile
            if (this._segmentLibrary.length >= 24) {
                this._stripsCaptured = true;
                this._buildBackgroundTile();
            }
        }

        // Only rebuild if the font changed after initial build
        if (this._stripsCaptured) {
            const maxSize = s.fontSize + (s.tracerSizeIncrease || 0);
            const style = s.italicEnabled ? 'italic ' : '';
            const fontStr = `${style}${s.fontWeight} ${maxSize}px ${s.fontFamily}`;
            if (fontStr !== this._lastFontStr) {
                this._buildBackgroundTile();
            }
        }

        // Derive zoom scale, opacity, and code brightness from fill ratio
        if (this._stripsCaptured) {
            const minScale = 0.25;
            const maxScale = s.quantizedZoomMaxScale || 1.5;
            const baseOpacity = s.quantizedZoomOpacity ?? 1.0;

            // Compute fill ratio from shadowRevealGrid
            const srGrid = this.shadowRevealGrid;
            const totalBlocks = this.logicGridW * this.logicGridH;
            let fillRatio = 0;
            if (srGrid && totalBlocks > 0) {
                let revealed = 0;
                for (let i = 0; i < totalBlocks; i++) {
                    if (srGrid[i]) revealed++;
                }
                fillRatio = revealed / totalBlocks;
            }

            // Zoom background opacity: stays high, drops sharply at end
            const fadeT = Math.pow(fillRatio, 8);
            this._zoomOpacity = baseOpacity * (1.0 - fadeT);

            // Brightness: starts at full, dims as fill progresses
            const minBrightness = 0.05;
            const dimFactor = 1.0 - fillRatio * (1.0 - minBrightness);
            s.brightness = this._savedBrightness * dimFactor;

            // Target zoom from fill ratio, EMA-smoothed for continuous motion
            const targetZoom = minScale + ((maxScale - minScale) * fillRatio);
            this._smoothedZoom += (targetZoom - this._smoothedZoom) * 0.08;
            this.zoomScale = this._smoothedZoom;
        }
    }

    /**
     * Intercept termination to start fade-out phase. The actual fade-out
     * runs at the top of update(), completely independent of the base
     * class lifecycle.
     */
    _terminate() {
        if (this._stripsCaptured && !this._fadingOut) {
            this._fadingOut = true;
            this._fadeOutProgress = 0;
            // Keep this.active = true so update() keeps being called
            return;
        }

        // Fallback: if strips were never captured, terminate immediately
        if (this._savedBrightness !== null) {
            this.c.state.brightness = this._savedBrightness;
            this._savedBrightness = null;
        }
        super._terminate();
    }

    /**
     * Override render to draw the strip-composed background onto the overlay canvas.
     * Dynamically tiles the background to fill any zoom extent seamlessly.
     * Uses a clip path from revealed blocks.
     */
    render(ctx, d) {
        // Let the base handle gridCache for WebGL perimeter line texture
        super.render(ctx, d);

        if (!this._stripsCaptured || this._zoomOpacity < 0.01) return;
        if (!this._bgCanvas || this._bgTileW <= 0 || this._bgTileH <= 0) return;

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

        // Draw zoomed + tiled strip-based background within the clip
        ctx.globalAlpha = this._zoomOpacity;

        const sx = this.spawnX;
        const sy = this.spawnY;
        const Z = this.zoomScale;
        const tw = this._bgTileW;
        const th = this._bgTileH;
        const tile = this._bgCanvas;

        ctx.translate(sx, sy);
        ctx.scale(Z, Z);
        ctx.translate(-sx, -sy);

        // Compute visible bounds in pre-zoom (unscaled) space
        // The clip already limits drawing, but we need to know how many tiles to draw
        const invZ = 1.0 / Z;
        const visL = sx - (sx * invZ);
        const visT = sy - (sy * invZ);
        const visW = w * invZ;
        const visH = h * invZ;

        // Calculate tile start indices to cover the visible area
        const startCol = Math.floor((visL) / tw) - 1;
        const startRow = Math.floor((visT) / th) - 1;
        const endCol = Math.ceil((visL + visW) / tw) + 1;
        const endRow = Math.ceil((visT + visH) / th) + 1;

        for (let ty = startRow; ty <= endRow; ty++) {
            for (let tx = startCol; tx <= endCol; tx++) {
                ctx.drawImage(tile, tx * tw, ty * th);
            }
        }

        ctx.restore();
    }
}

if (typeof window !== 'undefined') window.QuantizedZoomEffect = QuantizedZoomEffect;
