
class GlyphAtlas {
    constructor(config, fontName = null, customChars = null) {
        this.config = config;
        this.fontName = fontName;
        this.customChars = customChars;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        
        // Map character strings to their rect in the atlas
        this.charMap = new Map();
        
        // Atlas dimensions and cell size
        this.cellSize = 0;
        this.atlasWidth = 0;
        this.atlasHeight = 0;
        this.blockHeight = 0; // Height of one color set
        
        // State tracking for updates
        this.currentFont = '';
        this.currentPalette = '';
        this.needsUpdate = true;

        // Pre-calculated half sizes for centering
        this.halfCell = 0;

        // Internal caches for differential updates
        this._lastCols = 0;
        this._lastRows = 0;
        this._lastCharListKey = '';
        this._lastMaxSize = 0;
        this._lastPadding = 0;
    }

    /**
     * Initializes or updates the atlas if configuration has changed.
     */
    update() {
        const s = this.config.state;
        const d = this.config.derived;

        // Determine font and chars to use
        const fontFamily = this.fontName || s.fontFamily;
        const charList = this.customChars || Utils.CHARS; // string or array-like string

        // Build dependency keys
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${fontFamily}`;
        const paletteStr = d.paletteColorsStr.join(',');
        const fullConfigStr = paletteStr + '|' + s.overlapColor + '|' + charList.length + charList;

        // Early exit if nothing changed and no pending update
        if (this.currentFont === fontBase &&
            this.currentPalette === fullConfigStr &&
            !this.needsUpdate) {
            return;
        }

        // Update tracked keys
        const paletteChanged = this.currentPalette !== fullConfigStr;
        const fontChanged = this.currentFont !== fontBase;

        this.currentFont = fontBase;
        this.currentPalette = fullConfigStr;
        this.needsUpdate = false;

        // Compute layout-affecting values
        const padding = Math.max(s.tracerGlow, 10) * 2;
        const layoutChanged =
            fontChanged ||
            this._lastMaxSize !== maxSize ||
            this._lastPadding !== padding ||
            this._lastCharListKey !== (charList.length + ':' + charList);

        // If layout changed, recompute grid and resize canvas if needed
        if (layoutChanged) {
            this.cellSize = Math.ceil(maxSize + padding);
            this.halfCell = this.cellSize / 2;

            // Calculate atlas grid
            const cols = Math.ceil(Math.sqrt(charList.length));
            const rows = Math.ceil(charList.length / cols);
            this._lastCols = cols;
            this._lastRows = rows;

            // Dimensions per color block
            const newAtlasWidth = cols * this.cellSize;
            const newBlockHeight = rows * this.cellSize;

            // Total height = Palette Colors + 1 Overlap Color
            const blocksCount = (d.paletteColorsStr?.length || 0) + 1;
            const newAtlasHeight = newBlockHeight * blocksCount;

            // Resize canvas only if dimensions changed (avoid resetting context unnecessarily)
            if (this.canvas.width !== newAtlasWidth || this.canvas.height !== newAtlasHeight) {
                this.canvas.width = newAtlasWidth;
                this.canvas.height = newAtlasHeight;
            }

            // Update stored dimensions
            this.atlasWidth = newAtlasWidth;
            this.blockHeight = newBlockHeight;
            this.atlasHeight = newAtlasHeight;

            // Context state (must be set after resize because resize resets state)
            this.ctx.font = fontBase;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';

            // Clear and rebuild char map (only needed when layout changes)
            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
            this.charMap.clear();

            // Draw characters for palette blocks + overlap, and build charMap for the first block
            const paletteLen = d.paletteColorsStr?.length || 0;

            // Draw palette blocks
            for (let pIdx = 0; pIdx < paletteLen; pIdx++) {
                this.ctx.fillStyle = d.paletteColorsStr[pIdx];
                const yOffset = pIdx * this.blockHeight;

                for (let i = 0; i < charList.length; i++) {
                    const char = charList[i];
                    const col = i % this._lastCols;
                    const row = (i / this._lastCols) | 0;

                    const x = col * this.cellSize + this.halfCell;
                    const y = row * this.cellSize + this.halfCell + yOffset;

                    this.ctx.fillText(char, x, y);

                    // Store map ONLY for the first block; rects same for other blocks
                    if (pIdx === 0) {
                        this.charMap.set(char, {
                            x: col * this.cellSize,
                            y: row * this.cellSize,
                            w: this.cellSize,
                            h: this.cellSize
                        });
                    }
                }
            }

            // Draw overlap color block (final block)
            this.ctx.fillStyle = s.overlapColor;
            const overlapYOffset = paletteLen * this.blockHeight;

            for (let i = 0; i < charList.length; i++) {
                const char = charList[i];
                const col = i % this._lastCols;
                const row = (i / this._lastCols) | 0;

                const x = col * this.cellSize + this.halfCell;
                const y = row * this.cellSize + this.halfCell + overlapYOffset;

                this.ctx.fillText(char, x, y);
            }

            // Update layout caches
            this._lastMaxSize = maxSize;
            this._lastPadding = padding;
            this._lastCharListKey = charList.length + ':' + charList;
        } else {
            // Layout unchanged: only colors or shader-related visual aspects changed
            // We redraw the atlas (fast) without rebuilding charMap or recomputing layout.

            // Keep existing dimensions; ensure context state is valid
            this.ctx.font = fontBase;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';

            // Clear whole atlas and repaint with new colors
            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);

            const paletteLen = d.paletteColorsStr?.length || 0;

            for (let pIdx = 0; pIdx < paletteLen; pIdx++) {
                this.ctx.fillStyle = d.paletteColorsStr[pIdx];
                const yOffset = pIdx * this.blockHeight;

                for (let i = 0; i < charList.length; i++) {
                    const char = charList[i];
                    const col = i % this._lastCols;
                    const row = (i / this._lastCols) | 0;

                    const x = col * this.cellSize + this.halfCell;
                    const y = row * this.cellSize + this.halfCell + yOffset;

                    this.ctx.fillText(char, x, y);
                }
            }

            // Overlap block repaint
            this.ctx.fillStyle = s.overlapColor;
            const overlapYOffset = paletteLen * this.blockHeight;

            for (let i = 0; i < charList.length; i++) {
                const char = charList[i];
                const col = i % this._lastCols;
                const row = (i / this._lastCols) | 0;

                const x = col * this.cellSize + this.halfCell;
                const y = row * this.cellSize + this.halfCell + overlapYOffset;

                this.ctx.fillText(char, x, y);
            }
            // Note: charMap remains valid since layout did not change.
        }
    }

    /**
     * Returns the source coordinates for a character.
     * @param {string} char 
         * @returns {Object|null} Source rect {x,y,w,h} or null
     */
    get(char) {
        return this.charMap.get(char);
    }
}