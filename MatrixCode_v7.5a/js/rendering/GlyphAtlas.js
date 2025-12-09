class GlyphAtlas {
    constructor(config, fontName = null, customChars = null) {
        this.config = config;
        this.fontName = fontName;
        this.customChars = customChars;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        
        // Map character codes to their x/y coordinates in the atlas
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
    }

    /**
     * Initializes or updates the atlas if configuration has changed.
     */
    update() {
        const s = this.config.state;
        const d = this.config.derived;

        // Determine font and chars to use
        const fontFamily = this.fontName || s.fontFamily;
        const charList = this.customChars || Utils.CHARS;

        // Check if update is needed (font, color, or size change)
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${fontFamily}`;
        const paletteStr = d.paletteColorsStr.join(',');
        
        // Include overlap color and charList length/content in dependency check
        const fullConfigStr = paletteStr + '|' + s.overlapColor + '|' + charList.length + charList;

        if (this.currentFont === fontBase && 
            this.currentPalette === fullConfigStr && 
            !this.needsUpdate) {
            return;
        }

        this.currentFont = fontBase;
        this.currentPalette = fullConfigStr;
        this.needsUpdate = false;

        // Calculate cell dimensions (add padding for glow/blur)
        const padding = Math.max(s.tracerGlow, 10) * 2;
        this.cellSize = Math.ceil(maxSize + padding);
        this.halfCell = this.cellSize / 2;

        // Calculate atlas dimensions
        const cols = Math.ceil(Math.sqrt(charList.length));
        const rows = Math.ceil(charList.length / cols);

        this.atlasWidth = cols * this.cellSize;
        this.blockHeight = rows * this.cellSize; // Height of ONE color set
        
        // Total height = Palette Colors + 1 Overlap Color
        const colorsToDraw = [...d.paletteColorsStr, s.overlapColor];
        this.atlasHeight = this.blockHeight * colorsToDraw.length;

        // Resize canvas
        this.canvas.width = this.atlasWidth;
        this.canvas.height = this.atlasHeight;

        // Clear and set up context
        this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
        this.ctx.font = fontBase;
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';

        this.charMap.clear();

        // Draw Characters for each color in the palette + overlap
        colorsToDraw.forEach((color, pIdx) => {
            this.ctx.fillStyle = color;
            const yOffset = pIdx * this.blockHeight;

            for (let i = 0; i < charList.length; i++) {
                const char = charList[i];
                const col = i % cols;
                const row = Math.floor(i / cols);
                
                const x = col * this.cellSize + this.halfCell;
                const y = row * this.cellSize + this.halfCell + yOffset;

                this.ctx.fillText(char, x, y);

                // Store map ONLY for the first block (pIdx 0) as relative coords are same
                if (pIdx === 0) {
                    this.charMap.set(char, {
                        x: col * this.cellSize,
                        y: row * this.cellSize,
                        w: this.cellSize,
                        h: this.cellSize
                    });
                }
            }
        });
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