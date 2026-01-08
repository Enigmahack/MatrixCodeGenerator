// =========================================================================
// GLYPH ATLAS
// =========================================================================

class GlyphAtlas {
    constructor(config, fontName = null, customChars = null) {
        this.config = config;
        this.fontName = fontName;
        this.customChars = customChars;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true, willReadFrequently: true });
        
        // Map character strings to their rect in the atlas
        this.charMap = new Map();
        
        // Atlas dimensions and cell size
        this.cellSize = 0;
        this.atlasWidth = 0;
        this.atlasHeight = 0;
        
        // State tracking for updates
        this.currentFont = '';
        this.currentPalette = '';
        this.needsUpdate = true;

        // Pre-calculated half sizes for centering
        this.halfCell = 0;

        // Internal caches for differential updates
        this.fixedCols = 16; // Strategy 4: Default safety
        this._lastCols = 0;
        this._lastRows = 0;
        this._lastCharListKey = '';
        
        // Safety flags
        this.valid = true;
        this.MAX_HEIGHT = 8192; // Common safe limit for mobile/desktop

        // Fast Lookup for Renderer (CharCode -> AtlasID)
        this.codeToId = new Int16Array(65536).fill(-1);

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
        
        // If font isn't ready, we force a retry next frame, but we TRY to render anyway (Canvas fallback)
        if (!isFontReady) {
            this.needsUpdate = true;
            // console.warn(`[GlyphAtlas] Font ${fontBase} not ready. Rendering with fallback.`);
        } else {
            this.needsUpdate = false;
        }
        
        // Reset dynamic state
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
        
        // Strategy 4: Fixed Width, Vertical Expansion
        // Fix columns based on a reasonable texture width (e.g., 2048)
        const TARGET_WIDTH = 2048;
        this.fixedCols = Math.max(1, Math.floor(TARGET_WIDTH / this.cellSize));

        // Reset dynamic state
        this.usedChars = [];
        this.charMap.clear();
        this.capacity = this.minCapacity;
        
        // Initial sizing (reset = true)
        this._resizeAtlas(d, true);
    }

    _resizeAtlas(d, reset = false) {
        // Use fixed columns
        const cols = this.fixedCols;
        const rows = Math.ceil(this.capacity / cols);
        
        this._lastCols = cols;
        this._lastRows = rows;
        
        const newAtlasWidth = cols * this.cellSize;
        const newAtlasHeight = rows * this.cellSize;

        if (newAtlasHeight > this.MAX_HEIGHT) {
             console.error(`[GlyphAtlas] Texture Limit Exceeded: Height ${newAtlasHeight} > ${this.MAX_HEIGHT}`);
             console.error(`Details: Capacity=${this.capacity}, Cols=${cols}, Rows=${rows}, CellSize=${this.cellSize}`);
             this.valid = false;
             return;
        }
        this.valid = true;

        this.atlasWidth = newAtlasWidth;
        this.atlasHeight = newAtlasHeight;

        // Preserve existing content if not resetting
        let savedContent = null;
        if (!reset && this.canvas.width > 0 && this.canvas.height > 0) {
             savedContent = document.createElement('canvas');
             savedContent.width = this.canvas.width;
             savedContent.height = this.canvas.height;
             savedContent.getContext('2d').drawImage(this.canvas, 0, 0);
        }

        // Resize Canvas (clears content)
        if (this.canvas.width !== this.atlasWidth || this.canvas.height !== this.atlasHeight) {
            this.canvas.width = this.atlasWidth;
            this.canvas.height = this.atlasHeight;
        } else {
            this.ctx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
        }
        
        // Restore content
        if (savedContent) {
            this.ctx.drawImage(savedContent, 0, 0);
        }

        // Full update required on resize/clear (GPU texture must be resized)
        this.needsFullUpdate = true;
        this.dirtyRects = []; // Clear partial updates as we are doing full

        // Setup Context (State is lost on resize)
        this.ctx.font = this.currentFont;
        this.ctx.textBaseline = 'middle';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#FFFFFF';
        
        if (reset) {
            this.codeToId.fill(-1);
        }
    }

    /**
     * Adds a character to the atlas if space permits, expanding if necessary.
     */
    addChar(char) {
        if (!this.valid) return null;
        
        // Safety: Check if already exists to prevent duplicates
        if (this.charMap.has(char)) {
            const rect = this.charMap.get(char);
            const code = char.charCodeAt(0);
            if (code < 65536) this.codeToId[code] = rect.id;
            return rect;
        }
        
        // Check if supported first
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
        }

        // Always draw the new char (even after expansion)
        if (this.valid) {
            const index = this.usedChars.length - 1;
            this._drawSingleChar(char, index);
        }

        // Return the new mapping
        return this.charMap.get(char);
    }

    _expandAtlas() {
        // Double capacity
        this.capacity *= 2;
        
        // Re-calculate dimensions and resize canvas (preserving content)
        const d = this.config.derived; 
        this._resizeAtlas(d, false);
    }

    _drawSingleChar(char, index) {
        const col = index % this._lastCols;
        const row = (index / this._lastCols) | 0;
        
        const x = col * this.cellSize + this.halfCell;
        const y = row * this.cellSize + this.halfCell;
        
        const rect = {
            x: col * this.cellSize,
            y: row * this.cellSize,
            w: this.cellSize,
            h: this.cellSize,
            id: index // Store index for shader lookup
        };
        this.charMap.set(char, rect);
        
        this.ctx.fillText(char, x, y);

        // Strategy 2: Incremental Updates - Capture pixel data
        const imageData = this.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
        this.dirtyRects.push({
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            data: imageData
        });
        
        // Update fast lookup
        const code = char.charCodeAt(0);
    }

    resetChanges() {
        this.hasChanges = false; // Keep for compatibility if used elsewhere
        this.dirtyRects = [];
        this.needsFullUpdate = false;
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