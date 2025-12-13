
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

        // Optimization: Pre-rendered Rainbow Palette (24 steps)
        // Used for "Star Power" / Glitter / Rainbow effects to avoid fillText
        this.rainbowColors = [];
        const rainbowSteps = 24;
        for (let i = 0; i < rainbowSteps; i++) {
            const hue = (i / rainbowSteps) * 360;
            this.rainbowColors.push(`hsl(${hue}, 100%, 70%)`);
        }
        // Cached block offset for rainbow section
        this.rainbowOffsetStart = 0; 
        
        // Safety flags
        this.rainbowSupported = true;
        this.valid = true;
        this.MAX_HEIGHT = 8192; // Common safe limit for mobile/desktop
    }

    /**
     * Initializes or updates the atlas if configuration has changed.
     */
    update() {
        const s = this.config.state;
        const d = this.config.derived;

        // ... existing change detection ...
        // Determine font and chars to use
        const fontFamily = this.fontName || s.fontFamily;
        const charList = this.customChars || Utils.CHARS; // string or array-like string

        // Build dependency keys
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${fontFamily}`;
        const paletteStr = d.paletteColorsStr.join(',');
        const fullConfigStr = paletteStr + '|' + s.overlapColor + '|' + charList.length + charList;

        if (this.currentFont === fontBase && this.currentPalette === fullConfigStr && !this.needsUpdate) {
            return;
        }

        const paletteChanged = this.currentPalette !== fullConfigStr;
        const fontChanged = this.currentFont !== fontBase;
        this.currentFont = fontBase;
        this.currentPalette = fullConfigStr;
        this.needsUpdate = false;

        const padding = Math.max(s.tracerGlow, 10) * 2;
        const layoutChanged =
            fontChanged ||
            this._lastMaxSize !== maxSize ||
            this._lastPadding !== padding ||
            this._lastCharListKey !== (charList.length + ':' + charList);

        if (layoutChanged) {
            this.cellSize = Math.ceil(maxSize + padding);
            this.halfCell = this.cellSize / 2;

            const cols = Math.ceil(Math.sqrt(charList.length));
            const rows = Math.ceil(charList.length / cols);
            this._lastCols = cols;
            this._lastRows = rows;

            const newAtlasWidth = cols * this.cellSize;
            const newBlockHeight = rows * this.cellSize;
            const paletteLen = d.paletteColorsStr?.length || 0;

            // --- SAFETY CHECK ---
            // Calculate height with rainbow
            let totalBlocks = paletteLen + 1 + this.rainbowColors.length;
            let requiredHeight = newBlockHeight * totalBlocks;

            if (requiredHeight > this.MAX_HEIGHT) {
                console.warn(`[GlyphAtlas] Texture too large (${requiredHeight}px). Disabling Rainbow Optimization.`);
                this.rainbowSupported = false;
                
                // Recalculate without rainbow
                totalBlocks = paletteLen + 1;
                requiredHeight = newBlockHeight * totalBlocks;
                
                if (requiredHeight > this.MAX_HEIGHT) {
                    console.error(`[GlyphAtlas] Texture CRITICAL (${requiredHeight}px). Atlas disabled.`);
                    this.valid = false;
                    return; // Abort
                }
            } else {
                this.rainbowSupported = true;
            }
            this.valid = true;

            const newAtlasHeight = requiredHeight;

            if (this.canvas.width !== newAtlasWidth || this.canvas.height !== newAtlasHeight) {
                this.canvas.width = newAtlasWidth;
                this.canvas.height = newAtlasHeight;
            }

            this.atlasWidth = newAtlasWidth;
            this.blockHeight = newBlockHeight;
            this.atlasHeight = newAtlasHeight;
            this.rainbowOffsetStart = (paletteLen + 1) * newBlockHeight;

            this.ctx.font = fontBase;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';

            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
            this.charMap.clear();

            this._redrawAll(d, s, charList, paletteLen);
            
            for (let i = 0; i < charList.length; i++) {
                const char = charList[i];
                const col = i % this._lastCols;
                const row = (i / this._lastCols) | 0;
                this.charMap.set(char, {
                    x: col * this.cellSize,
                    y: row * this.cellSize,
                    w: this.cellSize,
                    h: this.cellSize
                });
            }

            this._lastMaxSize = maxSize;
            this._lastPadding = padding;
            this._lastCharListKey = charList.length + ':' + charList;
        } else {
            // Layout unchanged: fast repaint
            if (!this.valid) return;
            
            this.ctx.font = fontBase;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';
            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);

            const paletteLen = d.paletteColorsStr?.length || 0;
            this._redrawAll(d, s, charList, paletteLen);
        }
    }

    _redrawAll(d, s, charList, paletteLen) {
        // 1. Palette Blocks
        for (let pIdx = 0; pIdx < paletteLen; pIdx++) {
            this.ctx.fillStyle = d.paletteColorsStr[pIdx];
            const yOffset = pIdx * this.blockHeight;
            this._drawBlock(charList, yOffset);
        }

        // 2. Overlap Color Block
        this.ctx.fillStyle = s.overlapColor;
        const overlapYOffset = paletteLen * this.blockHeight;
        this._drawBlock(charList, overlapYOffset);

        // 3. Rainbow Blocks (only if supported)
        if (this.rainbowSupported) {
            for (let rIdx = 0; rIdx < this.rainbowColors.length; rIdx++) {
                this.ctx.fillStyle = this.rainbowColors[rIdx];
                const yOffset = this.rainbowOffsetStart + (rIdx * this.blockHeight);
                this._drawBlock(charList, yOffset);
            }
        }
    }

    _drawBlock(charList, yOffset) {
        for (let i = 0; i < charList.length; i++) {
            const char = charList[i];
            const col = i % this._lastCols;
            const row = (i / this._lastCols) | 0;

            const x = col * this.cellSize + this.halfCell;
            const y = row * this.cellSize + this.halfCell + yOffset;

            this.ctx.fillText(char, x, y);
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