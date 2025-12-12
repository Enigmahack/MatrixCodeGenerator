
class MatrixGrid {
    constructor(config) {
        this.config = config;

        // Grid dimensions
        this.cols = 0;
        this.rows = 0;

        // Grid storage and state tracking
        this.activeIndices = new Set(); // Tracks active (non-empty) cells
        this.chars = null;
        this.types = null;
        this.alphas = null;
        this.decays = null;
        this.ages = null;
        this.brightness = null;
        this.rotatorProg = null;
        this.rotatorOffsets = null;

        // Auxiliary storage
        this.complexStyles = new Map(); // Tracks complex character styling
        this.nextChars = new Map(); // Tracks characters for transitions
    }

    /**
     * Resizes the grid based on new width and height, reallocating arrays only if dimensions change.
     * @param {number} width - The new width of the grid area.
     * @param {number} height - The new height of the grid area.
     */
    resize(width, height) {
        const d = this.config.derived;

        // Defensive guards to avoid NaN/Infinity causing zero/invalid sizes
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return; // Ignore invalid dimensions; preserves existing buffers
        }
        if (!d || !Number.isFinite(d.cellWidth) || !Number.isFinite(d.cellHeight) || d.cellWidth <= 0 || d.cellHeight <= 0) {
            return; // Derived not ready; avoid thrashing allocations
        }

        // Compute new grid size using integer math
        const newCols = Math.max(1, (width / d.cellWidth) | 0);
        const newRows = Math.max(1, (height / d.cellHeight) | 0);

        // Reallocate only when shape changes
        if (newCols !== this.cols || newRows !== this.rows) {
            this._resizeGrid(newCols, newRows);
        }
    }

    /**
     * Gets the 1D array index from 2D coordinates (x, y).
     * @param {number} x - The column index.
     * @param {number} y - The row index.
     * @returns {number} The 1D index, or -1 if out of bounds.
     */
    getIndex(x, y) {
        // Branch order keeps fast path hot (common valid case avoids extra checks)
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) {
            return -1; // Out of bounds
        }
        return y * this.cols + x;
    }

    /**
     * Sets a character at the specified grid index.
     * @param {number} idx - The 1D index of the cell.
     * @param {string} charStr - The character string to set.
     */
    setChar(idx, charStr) {
        // Fast path: minimal type/length checking, identical behavior
        if (typeof charStr === "string" && charStr.length > 0) {
            // Using bitwise OR to coerce to 32-bit int is unnecessary; charCodeAt already returns int
            this.chars[idx] = charStr.charCodeAt(0);
        }
    }

    /**
     * Gets the character from the specified grid index.
     * @param {number} idx - The 1D index of the cell.
     * @returns {string} The character at the index.
     */
    getChar(idx) {
        // Preserve original behavior: return '' on invalid; charCode 0 returns '\u0000'
        if (!this.chars || idx < 0 || idx >= this.chars.length) return '';
        return String.fromCharCode(this.chars[idx]);
    }

    /**
     * Sets the font index at the specified grid index.
     * @param {number} idx - The 1D index of the cell.
     * @param {number} fontIndex - The index of the font to use.
     */
    setFont(idx, fontIndex) {
        if (this.fontIndices && idx >= 0 && idx < this.fontIndices.length) {
            this.fontIndices[idx] = fontIndex;
        }
    }

    /**
     * Gets the font index from the specified grid index.
     * @param {number} idx - The 1D index of the cell.
     * @returns {number} The font index at the index.
     */
    getFont(idx) {
        if (!this.fontIndices || idx < 0 || idx >= this.fontIndices.length) return 0;
        return this.fontIndices[idx];
    }

    /**
     * Reinitializes all grid arrays and dimensions.
     * @private
     * @param {number} newCols - The new number of columns.
     * @param {number} newRows - The new number of rows.
     */
    _resizeGrid(newCols, newRows) {
        const totalCells = newCols * newRows;

        // Allocate typed arrays (zero-initialized by spec)
        this.chars        = new Uint16Array(totalCells);
        this.types        = new Uint8Array(totalCells);
        this.alphas       = new Float32Array(totalCells);
        this.decays       = new Uint8Array(totalCells);
        this.ages         = new Int32Array(totalCells);
        this.brightness   = new Float32Array(totalCells);
        this.rotatorProg  = new Float32Array(totalCells);
        this.rotatorOffsets = new Uint8Array(totalCells); // Offset for desync logic
        
        // Fill rotatorOffsets with 0..254 (preserves original range & distribution)
        for (let i = 0; i < totalCells; i++) {
            // Bitwise OR is faster than Math.floor and yields identical 0..254 range
            this.rotatorOffsets[i] = (Math.random() * 255) | 0;
        }

        // Color Palette Index (0-2)
        this.paletteIndices = new Uint8Array(totalCells);

        // Font Index (0-255) for multi-font support
        this.fontIndices = new Uint8Array(totalCells);
        
        // Imposition Layer (Overlap)
        this.overlapChars = new Uint16Array(totalCells);
        
        // Cell Locks (for pausing simulation under effects)
        this.cellLocks = new Uint8Array(totalCells);

        // Replace containers (preserves prior semantics that new objects are created on resize)
        this.activeIndices     = new Set();
        this.complexStyles     = new Map();
        this.nextChars         = new Map();
        this.nextOverlapChars  = new Map();

        // Update grid dimensions
        this.cols = newCols;
        this.rows = newRows;
    }

}


// --- FontData.js ---
