// =========================================================================
// GLYPH ATLAS
// =========================================================================

class GlyphAtlas {
    constructor(config, fontName = null, customChars = null, debugLabel = null) {
        this.config = config;
        this.fontName = fontName;
        this.customChars = customChars;
        this._debugLabel = debugLabel || (fontName ? `atlas-${fontName}` : 'atlas-unnamed');

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true, willReadFrequently: true });
        this.ctx.imageSmoothingEnabled = this.config.state.smoothingEnabled;
        
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
        this._filteredCharsCache = new Map(); // key: font+'::'+rawChars → filtered string

        // Font loading validation
        this._fontValidationRetries = 0;
        this._rejectedChars = new Set(); // Chars rejected by signature check (may be font race condition)
        
        // Lazy Loading State
        this.usedChars = []; // List of characters currently in atlas
        this.capacity = 0;   // Current max characters
        this.minCapacity = 256; // Starting capacity
        this.hasChanges = false;
        this.nextId = 0;
        this.fontReady = false;
    }

    /**
     * Initializes or updates the atlas configuration.
     * Clears the atlas and resets state to allow lazy loading.
     */
    update(force = false) {
        const s = this.config.state;
        const d = this.config.derived;

        this.ctx.imageSmoothingEnabled = s.smoothingEnabled;

        // Determine font info (but NOT the full char list anymore for pre-fill)
        const fontFamily = this.fontName || s.fontFamily;
        
        // Check sizing dependencies
        const maxSize = s.fontSize + s.tracerSizeIncrease;
        const style = s.italicEnabled ? 'italic ' : '';
        const fontBase = `${style}${s.fontWeight} ${maxSize}px ${fontFamily}`;
        const padding = 10 * 2; // Fixed padding, decoupled from tracerGlow
        
        // Palette/color changes do not affect atlas layout (glyphs are always drawn in white;
        // color is applied by the shader). Only font properties invalidate the atlas.
        const fullConfigStr = fontBase + '|' + padding;

        const isFontReady = document.fonts.check(fontBase);

        if (!force &&
            this.currentFont === fontBase &&
            this.currentPalette === fullConfigStr &&
            this.fontReady === isFontReady &&
            !this.needsUpdate) {
            // Even when atlas is unchanged, re-filter charsets in case they were rebuilt
            this._filterActiveFontChars(fontBase);
            return;
        }

        // Configuration changed: Reset everything
        this.currentFont = fontBase;
        this.currentPalette = fullConfigStr;
        this.fontReady = isFontReady;

        // If font isn't ready, we force a retry next frame, but we TRY to render anyway (Canvas fallback)
        if (!isFontReady) {
            this.needsUpdate = true;
            if (this.config.state.logErrors) console.warn(`[GlyphAtlas:${this._debugLabel}] Font NOT ready: "${fontBase}" | fontName=${this.fontName}`);
        } else {
            if (this._debugFontLogged !== fontBase) {
                if (this.config.state.logErrors) console.log(`[GlyphAtlas:${this._debugLabel}] Font READY: "${fontBase}" | fontName=${this.fontName} | chars=${this.usedChars.length}`);
                this._debugFontLogged = fontBase;
            }
            this.needsUpdate = false;
        }

        // Reset dynamic state (including filter cache since font changed)
        this._filteredCharsCache.clear();
        this._rejectedChars.clear(); // Allow re-checking rejected chars on atlas rebuild
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

        // Save previously used characters before clearing, so we can pre-populate after
        // reset to avoid an empty GPU texture upload (which causes a one-frame blank flash)
        const prevUsedChars = this.usedChars.slice();

        // Reset dynamic state
        this.usedChars = [];
        this.charMap.clear();
        this._invalidateCodeRectCache();
        this.capacity = Math.max(this.minCapacity, prevUsedChars.length);

        // Initial sizing (reset = true)
        this._resizeAtlas(d, true);

        // Pre-populate atlas with previous characters (drawn with the current font) so that
        // the full GPU texture upload has valid glyph data rather than an empty canvas
        if (prevUsedChars.length > 0) {
            const cols = this._lastCols;
            for (let i = 0; i < prevUsedChars.length; i++) {
                const char = prevUsedChars[i];
                const col = i % cols;
                const row = (i / cols) | 0;
                this.charMap.set(char, {
                    x: col * this.cellSize,
                    y: row * this.cellSize,
                    w: this.cellSize,
                    h: this.cellSize,
                    id: i
                });
                this.ctx.fillText(char, col * this.cellSize + this.halfCell, row * this.cellSize + this.halfCell);
                const code = char.charCodeAt(0);
                if (code < 65536) this.codeToId[code] = i;
            }
            this.usedChars = prevUsedChars;

            // Validate that characters actually rendered on the canvas.
            // document.fonts.check() can return true before the font is fully ready
            // for canvas rendering, causing random characters to render as blank.
            if (isFontReady) {
                const blankChars = this._findBlankAtlasChars();
                if (blankChars.length > 0) {
                    // Remove blank entries so addChar can re-attempt them
                    for (const blankChar of blankChars) {
                        this.charMap.delete(blankChar);
                        const code = blankChar.charCodeAt(0);
                        if (code < 65536) this.codeToId[code] = -1;
                    }
                    this._fontValidationRetries++;
                    if (this._fontValidationRetries < 30) {
                        this.needsUpdate = true; // Force retry next frame
                    }
                    if (this.config.state.logErrors) {
                        console.warn(`[GlyphAtlas:${this._debugLabel}] ${blankChars.length} blank chars after pre-population (retry ${this._fontValidationRetries}): "${blankChars.join('')}"`);
                    }
                } else {
                    this._fontValidationRetries = 0;
                }
            }
        }

        // Filter active font charsets to remove characters unsupported by this font
        this._filterActiveFontChars(fontBase);
    }

    /**
     * Scans the atlas canvas for characters whose cells have no alpha content.
     * Returns an array of blank character strings.
     * Uses a single getImageData call for the full atlas, then spot-checks each cell.
     */
    _findBlankAtlasChars() {
        if (this.usedChars.length === 0) return [];

        const cols = this._lastCols;
        const cs = this.cellSize;
        const w = this.atlasWidth;
        const h = this.atlasHeight;

        // Read entire atlas pixel data once (much faster than per-cell getImageData)
        const fullData = this.ctx.getImageData(0, 0, w, h).data;
        const blanks = [];

        for (let i = 0; i < this.usedChars.length; i++) {
            const cellX = (i % cols) * cs;
            const cellY = ((i / cols) | 0) * cs;

            // Scan the entire cell, checking every 4th pixel's alpha for speed.
            // Characters like "." or "_" render far from center, so we must check the full cell.
            let hasContent = false;
            for (let py = cellY, endY = Math.min(cellY + cs, h); py < endY && !hasContent; py += 2) {
                for (let px = cellX, endX = Math.min(cellX + cs, w); px < endX; px += 2) {
                    if (fullData[(py * w + px) * 4 + 3] > 0) {
                        hasContent = true;
                        break;
                    }
                }
            }
            if (!hasContent) {
                blanks.push(this.usedChars[i]);
            }
        }
        return blanks;
    }

    /**
     * Filters config.derived.activeFonts charsets to only include characters
     * that the current font can actually render (not tofu/blank).
     * Uses a per-key cache so repeated calls with unchanged data are free.
     */
    _filterActiveFontChars(fontBase) {
        const activeFonts = this.config.derived?.activeFonts;
        if (!activeFonts || !fontBase) return;

        for (const font of activeFonts) {
            const raw = font.chars;
            if (!raw || raw.length === 0) continue;
            const filtered = this._getFilteredChars(raw, fontBase);
            if (filtered && filtered.length > 0) {
                font.chars = filtered;
            }
        }
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
        this.hasChanges = true;
        this.nextId++;
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

        // Check if supported first (but don't permanently reject — font may not be ready yet)
        const checkFont = this.currentFont.replace(/\d+px/, '16px');
        const sig = this._getCharSignature(checkFont, char);
        const emptySig = this._getCharSignature(checkFont, '\uFFFF');

        if (!sig || sig === emptySig) {
            // Character failed signature check — may be unsupported OR font race condition.
            // Track it and force a retry on next update cycle.
            if (!this._rejectedChars.has(char)) {
                this._rejectedChars.add(char);
                this.needsUpdate = true; // Force atlas rebuild next frame to retry
                if (!this._debugRejected) this._debugRejected = 0;
                this._debugRejected++;
                if (this._debugRejected <= 10 && this.config.state.logErrors) console.warn(`[GlyphAtlas:${this._debugLabel}] REJECTED char "${char}" (0x${char.charCodeAt(0).toString(16)}) font=${this.currentFont} — will retry`);
            }
            return null;
        }

        this.usedChars.push(char);
        this.hasChanges = true;
        this.nextId++;
        if (!this._debugAdded) this._debugAdded = 0;
        this._debugAdded++;
        if (this._debugAdded <= 3 && this.config.state.logErrors) console.log(`[GlyphAtlas:${this._debugLabel}] ADDED char "${char}" (0x${char.charCodeAt(0).toString(16)}) total=${this.usedChars.length} font=${this.currentFont}`);
        
        if (this.usedChars.length > this.capacity) {
            this._expandAtlas();
        }

        // Always draw the new char (even after expansion)
        if (this.valid) {
            const index = this.usedChars.length - 1;
            const success = this._drawSingleChar(char, index);
            if (success === false) {
                // Draw failed (blank glyph) — font not truly ready
                return null;
            }
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

        // Validate the character actually rendered (font race condition protection).
        // Check alpha channel for any non-zero content.
        let hasContent = false;
        const data = imageData.data;
        for (let p = 3; p < data.length; p += 16) { // Sample every 4th pixel's alpha
            if (data[p] > 0) { hasContent = true; break; }
        }
        if (!hasContent) {
            // Character drew blank — font likely not truly ready yet.
            // Remove from atlas so it will be re-attempted.
            this.charMap.delete(char);
            const code = char.charCodeAt(0);
            if (code < 65536) this.codeToId[code] = -1;
            // Pop it from usedChars (it was the last one pushed)
            if (this.usedChars.length > 0 && this.usedChars[this.usedChars.length - 1] === char) {
                this.usedChars.pop();
            }
            this.needsUpdate = true; // Force atlas rebuild next frame
            return false; // Signal draw failure
        }

        this.dirtyRects.push({
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            data: imageData
        });
        
        // Update fast lookup
        const code = char.charCodeAt(0);
        if (code < 65536) this.codeToId[code] = index;
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
     * Fast lookup by charCode — avoids String.fromCharCode allocation in hot loops.
     * Uses a pre-sized cache array indexed by charCode for O(1) access.
     */
    getByCode(charCode) {
        let rect = this._codeRectCache ? this._codeRectCache[charCode] : undefined;
        if (rect !== undefined) return rect;
        // Fallback: convert to string, do standard get, cache result
        const char = String.fromCharCode(charCode);
        rect = this.get(char);
        if (!this._codeRectCache) this._codeRectCache = new Array(65536);
        this._codeRectCache[charCode] = rect;
        return rect;
    }

    /** Invalidate the charCode rect cache when atlas is rebuilt */
    _invalidateCodeRectCache() {
        this._codeRectCache = null;
    }

    /**
     * Filters the character list to only include those supported by the font.
     * Caches the result to avoid expensive re-scans.
     */
    _getFilteredChars(rawList, font) {
        // Use a key that includes the font and the raw list for cache lookup
        const key = font + '::' + rawList.length + ':' + rawList;

        const cached = this._filteredCharsCache.get(key);
        if (cached !== undefined) {
            return cached;
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
            if (sig && sig !== emptySig) {
                filtered.push(char);
            }
        }

        const result = (typeof rawList === 'string') ? filtered.join('') : filtered;
        this._filteredCharsCache.set(key, result);

        if (result.length < rawList.length && this.config.state.logErrors) {
            console.log(`[GlyphAtlas:${this._debugLabel}] Filtered chars: ${rawList.length} -> ${result.length} (removed ${rawList.length - result.length} unsupported)`);
        }
        return result;
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
