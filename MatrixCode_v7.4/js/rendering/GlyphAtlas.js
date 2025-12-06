class GlyphAtlas {
    constructor(config) {
        this.config = config;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        
        // Map character codes to their x/y coordinates in the atlas
        this.charMap = new Map();
        
        // Atlas dimensions and cell size
        this.cellSize = 0;
        this.atlasWidth = 0;
        this.atlasHeight = 0;
        
        // State tracking for updates
        this.currentFont = '';
        this.currentColor = '';
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

        // Check if update is needed (font, color, or size change)
        // We use the MAX font size needed (including tracer size increase)
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${s.fontFamily}`;
        const primaryColor = d.streamColorStr;

        if (this.currentFont === fontBase && 
            this.currentColor === primaryColor && 
            !this.needsUpdate) {
            return;
        }

        this.currentFont = fontBase;
        this.currentColor = primaryColor;
        this.needsUpdate = false;

        // Calculate cell dimensions (add padding for glow/blur)
        // Padding needs to account for the largest blur we might apply
        const padding = Math.max(s.tracerGlow, 10) * 2;
        this.cellSize = Math.ceil(maxSize + padding);
        this.halfCell = this.cellSize / 2;

        // Calculate atlas dimensions
        const charList = Utils.CHARS;
        const cols = Math.ceil(Math.sqrt(charList.length));
        const rows = Math.ceil(charList.length / cols);

        this.atlasWidth = cols * this.cellSize;
        this.atlasHeight = rows * this.cellSize;

        // Resize canvas
        this.canvas.width = this.atlasWidth;
        this.canvas.height = this.atlasHeight;

        // Clear and set up context
        this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
        this.ctx.font = fontBase;
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';
        
        // Draw Characters
        // We draw TWO sets: 
        // 1. The "Green" (Stream) set
        // 2. The "White" (Tracer) set? 
        // Actually, simpler approach: Draw WHITE characters. 
        // Then use `globalCompositeOperation` to tint them?
        // No, tinting at runtime is slow.
        // We should stick to the PRIMARY stream color for the main atlas.
        // Tracers (White) can be drawn with standard fillText or a secondary white atlas.
        // For now, let's optimize the BULK of the rendering: the Green Stream Characters.

        this.ctx.fillStyle = primaryColor;

        this.charMap.clear();

        for (let i = 0; i < charList.length; i++) {
            const char = charList[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            const x = col * this.cellSize + this.halfCell;
            const y = row * this.cellSize + this.halfCell;

            this.ctx.fillText(char, x, y);

            // Store the source rectangle for this character
            this.charMap.set(char, {
                x: col * this.cellSize,
                y: row * this.cellSize,
                w: this.cellSize,
                h: this.cellSize
            });
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