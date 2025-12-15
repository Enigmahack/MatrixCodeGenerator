
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

        // Glyph Cache Optimization: Filter unsupported characters
        this.testCanvas = document.createElement('canvas');
        this.testCanvas.width = 20;
        this.testCanvas.height = 20;
        this.testCtx = this.testCanvas.getContext('2d', { willReadFrequently: true });
        this._cachedFilteredChars = null;
        this._cachedFilterKey = '';
        
        // Lazy Loading State
        this.usedChars = []; // List of characters currently in atlas
        this.capacity = 0;   // Current max characters
        this.minCapacity = 256; // Starting capacity
        this.hasChanges = false;
        this.fontReady = false;
    }

    /**
     * Initializes or updates the atlas configuration.
     * Clears the atlas and resets state to allow lazy loading.
     */
    update() {
        const s = this.config.state;
        const d = this.config.derived;

        // Determine font info (but NOT the full char list anymore for pre-fill)
        const fontFamily = this.fontName || s.fontFamily;
        
        // Check sizing dependencies
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${fontFamily}`;
        const padding = 10 * 2; // Fixed padding, decoupled from tracerGlow
        
        const paletteStr = d.paletteColorsStr.join(',');
        const fullConfigStr = paletteStr + '|' + s.overlapColor + '|' + fontBase + '|' + padding;

        const isFontReady = document.fonts.check(fontBase);

        if (this.currentFont === fontBase && 
            this.currentPalette === fullConfigStr && 
            this.fontReady === isFontReady && 
            !this.needsUpdate) {
            return;
        }

        // Configuration changed: Reset everything
        this.currentFont = fontBase;
        this.currentPalette = fullConfigStr;
        this.fontReady = isFontReady;
        
        // If font isn't ready, we force a retry next frame
        this.needsUpdate = !isFontReady;
        
        // Measure exact bounds to avoid clipping ascenders/descenders
        // Use a representative string with high/low chars
        this.ctx.font = fontBase;
        const metrics = this.ctx.measureText("Mjg|[]{}()"); 
        // fallback if metrics not supported
        let actualHeight = maxSize;
        if (metrics.actualBoundingBoxAscent && metrics.actualBoundingBoxDescent) {
            actualHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        } else {
            actualHeight = maxSize * 1.2; // generous fallback
        }

        this.cellSize = Math.ceil(Math.max(maxSize, actualHeight) + padding);
        this.halfCell = this.cellSize / 2;
        
        // Reset dynamic state
        this.usedChars = [];
        this.charMap.clear();
        this.capacity = this.minCapacity;
        
        // Initial sizing (empty)
        this._resizeAtlas(d);
    }

    _resizeAtlas(d) {
        // Calculate grid for current capacity
        const cols = Math.ceil(Math.sqrt(this.capacity));
        const rows = Math.ceil(this.capacity / cols);
        
        this._lastCols = cols;
        this._lastRows = rows;
        
        const newAtlasWidth = cols * this.cellSize;
        const newBlockHeight = rows * this.cellSize;
        const paletteLen = d.paletteColorsStr?.length || 0;

        // Safety Check & Dynamic Rainbow Optimization
        let rainbowSteps = 24; 
        let totalBlocks = paletteLen + 1 + rainbowSteps;
        let requiredHeight = newBlockHeight * totalBlocks;

        if (requiredHeight > this.MAX_HEIGHT) {
            // Try reducing rainbow steps to fit
            const attempts = [12, 8, 4]; // Degrade quality
            let found = false;
            for (const s of attempts) {
                const h = newBlockHeight * (paletteLen + 1 + s);
                if (h <= this.MAX_HEIGHT) {
                    console.log(`[GlyphAtlas] Optimizing: Reducing rainbow to ${s} steps to fit atlas limit.`);
                    rainbowSteps = s;
                    totalBlocks = paletteLen + 1 + s;
                    requiredHeight = h;
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Info log instead of warning, as this is an expected optimization fallback
                console.log(`[GlyphAtlas] Atlas height (${requiredHeight}px) exceeds limit (${this.MAX_HEIGHT}px). Disabling Rainbow optimization.`);
                this.rainbowSupported = false;
                rainbowSteps = 0;
                
                // Recalculate without rainbow
                totalBlocks = paletteLen + 1;
                requiredHeight = newBlockHeight * totalBlocks;
            } else {
                this.rainbowSupported = true;
            }
        } else {
            this.rainbowSupported = true;
        }

        if (requiredHeight > this.MAX_HEIGHT) {
            console.error(`[GlyphAtlas] Texture CRITICAL (${requiredHeight}px). Atlas disabled.`);
            this.valid = false;
            return; // Abort
        }
        
        this.valid = true;

        // Regenerate Rainbow Colors for current step count
        if (this.rainbowSupported) {
            this.rainbowColors = [];
            for (let i = 0; i < rainbowSteps; i++) {
                const hue = (i / rainbowSteps) * 360;
                this.rainbowColors.push(`hsl(${hue}, 100%, 70%)`);
            }
        }

        this.atlasWidth = newAtlasWidth;
        this.atlasHeight = requiredHeight;
        this.blockHeight = newBlockHeight;
        this.rainbowOffsetStart = (paletteLen + 1) * newBlockHeight;

        // Resize Canvas (clears content)
        if (this.canvas.width !== this.atlasWidth || this.canvas.height !== this.atlasHeight) {
            this.canvas.width = this.atlasWidth;
            this.canvas.height = this.atlasHeight;
        } else {
            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
        }

        // Setup Context
        this.ctx.font = this.currentFont;
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';
    }

    /**
     * Adds a character to the atlas if space permits, expanding if necessary.
     */
    addChar(char) {
        if (!this.valid) return null;
        
        // Check if supported first
        // Note: We use a simplified check here or rely on the caller?
        // Let's do the check here to avoid polluting atlas with tofu.
        // But we need to cache the check.
        // Using _getCharSignature is slightly expensive per-frame if hit often.
        // We'll trust that 'char' is unique and not in map.
        
        // Verify support
        const checkFont = this.currentFont.replace(/\d+px/, '16px'); 
        const sig = this._getCharSignature(checkFont, char);
        const emptySig = this._getCharSignature(checkFont, '\uFFFF');
        
        if (!sig || sig === emptySig) {
            // Unsupported, do not add
            return null;
        }
        
        this.usedChars.push(char);
        
        if (this.usedChars.length > this.capacity) {
            this._expandAtlas();
        } else {
            // Just draw the new char at the end
            const index = this.usedChars.length - 1;
            this._drawSingleChar(char, index);
        }

        // Return the new mapping
        return this.charMap.get(char);
    }

    _expandAtlas() {
        // Double capacity
        this.capacity *= 2;
        
        // Re-calculate dimensions and resize canvas
        // Warning: Resizing clears the canvas! We must redraw EVERYTHING.
        const oldUsed = [...this.usedChars];
        const d = this.config.derived; // Need palette info
        
        this._resizeAtlas(d);
        
        // Re-add all characters to map and draw them
        this.charMap.clear();
        for (let i = 0; i < oldUsed.length; i++) {
            this._drawSingleChar(oldUsed[i], i);
        }
    }

    _drawSingleChar(char, index) {
        const d = this.config.derived;
        const s = this.config.state;
        const paletteLen = d.paletteColorsStr?.length || 0;
        
        const col = index % this._lastCols;
        const row = (index / this._lastCols) | 0;
        
        const x = col * this.cellSize + this.halfCell;
        const baseY = row * this.cellSize + this.halfCell;
        
        const rect = {
            x: col * this.cellSize,
            y: row * this.cellSize,
            w: this.cellSize,
            h: this.cellSize
        };
        this.charMap.set(char, rect);
        this.hasChanges = true;

        // 1. Palette Blocks
        for (let pIdx = 0; pIdx < paletteLen; pIdx++) {
            this.ctx.fillStyle = d.paletteColorsStr[pIdx];
            const y = baseY + (pIdx * this.blockHeight);
            this.ctx.fillText(char, x, y);
        }

        // 2. Overlap Color Block
        this.ctx.fillStyle = s.overlapColor;
        const overlapY = baseY + (paletteLen * this.blockHeight);
        this.ctx.fillText(char, x, overlapY);

        // 3. Rainbow Blocks
        if (this.rainbowSupported) {
            for (let rIdx = 0; rIdx < this.rainbowColors.length; rIdx++) {
                this.ctx.fillStyle = this.rainbowColors[rIdx];
                const y = baseY + this.rainbowOffsetStart + (rIdx * this.blockHeight);
                this.ctx.fillText(char, x, y);
            }
        }
    }

    resetChanges() {
        this.hasChanges = false;
    }

    /**
     * Returns the source coordinates for a character.
     * Lazily adds the character if not present.
     * @param {string} char 
         * @returns {Object|null} Source rect {x,y,w,h} or null
     */
    get(char) {
        const rect = this.charMap.get(char);
        if (rect) return rect;
        
        // Lazy Load
        return this.addChar(char);
    }

    /**
     * Filters the character list to only include those supported by the font.
     * Caches the result to avoid expensive re-scans.
     */
    _getFilteredChars(rawList, font) {
        // Use a key that includes the font (with size replaced by standard) and the raw list
        // Note: We use the full fontBase as key because if size changes significantly, 
        // we might want to re-check (though unlikely to change support).
        const key = font + '::' + rawList.length + ':' + rawList;
        
        if (this._cachedFilteredChars !== null && this._cachedFilterKey === key) {
            return this._cachedFilteredChars;
        }

        const filtered = [];
        // Pre-calculate empty signature (tofu)
        // We use a fixed size for checking to avoid large canvas requirements
        const checkFont = font.replace(/\d+px/, '16px'); 
        const emptySig = this._getCharSignature(checkFont, '\uFFFF');

        for (let i = 0; i < rawList.length; i++) {
            const char = rawList[i];
            const sig = this._getCharSignature(checkFont, char);
            // If signature exists and is different from tofu, it's supported.
            // (We assume space ' ' is either not in list or handled by renderer if empty)
            if (sig && sig !== emptySig) {
                filtered.push(char);
            }
        }
        
        // If we filtered out everything (e.g. font not loaded yet), 
        // fall back to raw list to avoid complete invisibility, 
        // or return empty string? 
        // Returning empty string means nothing draws.
        // Returning raw list means we might draw boxes.
        // Let's return filtered. If font loads later, update() should be triggered by something?
        // Actually, GlyphAtlas doesn't auto-update on font load unless triggered externally.
        // But usually FontManager triggers a re-render/update.
        
        this._cachedFilteredChars = (typeof rawList === 'string') ? filtered.join('') : filtered;
        this._cachedFilterKey = key;
        
        // console.log(`[GlyphAtlas] Filtered chars: ${rawList.length} -> ${filtered.length}`);
        return this._cachedFilteredChars;
    }

    /**
     * Computes a simple pixel sum signature for a character to detect 'tofu'.
     */
    _getCharSignature(font, char) {
        this.testCtx.clearRect(0, 0, 20, 20);
        this.testCtx.font = font;
        this.testCtx.textBaseline = 'middle';
        this.testCtx.textAlign = 'center';
        this.testCtx.fillStyle = '#fff';
        this.testCtx.fillText(char, 10, 10);
        
        const data = this.testCtx.getImageData(5, 5, 10, 10).data;
        let sum = 0;
        // Check alpha channel
        for(let i = 3; i < data.length; i += 4) {
            sum += data[i];
        }
        return sum;
    }
}