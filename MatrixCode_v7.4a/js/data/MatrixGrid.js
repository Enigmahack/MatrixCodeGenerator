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

        // Auxiliary storage
        this.complexStyles = new Map(); // Tracks complex character styling
        this.nextChars = new Map(); // Tracks characters for transitions
        this.noiseDirty = true;
    }

    /**
     * Resizes the grid based on new width and height, reallocating arrays only if dimensions change.
     * @param {number} width - The new width of the grid area.
     * @param {number} height - The new height of the grid area.
     */
    resize(width, height) {
        const d = this.config.derived;
        const newCols = Math.max(1, Math.floor(width / d.cellWidth));
        const newRows = Math.max(1, Math.floor(height / d.cellHeight));

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
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
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
        if (typeof charStr === "string" && charStr.length > 0) {
            this.chars[idx] = charStr.charCodeAt(0);
        }
    }

    /**
     * Gets the character from the specified grid index.
     * @param {number} idx - The 1D index of the cell.
     * @returns {string} The character at the index.
     */
    getChar(idx) {
        // Ensure chars array is not null before accessing
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

        // Reinitialize arrays with new size
        this.chars = new Uint16Array(totalCells);
        this.types = new Uint8Array(totalCells);
        this.alphas = new Float32Array(totalCells);
        this.decays = new Uint8Array(totalCells);
        this.ages = new Int32Array(totalCells);
        this.brightness = new Float32Array(totalCells);
        this.rotatorProg = new Float32Array(totalCells);

        // Color Palette Index (0-2)
        this.paletteIndices = new Uint8Array(totalCells);

        // Font Index (0-255) for multi-font support
        this.fontIndices = new Uint8Array(totalCells);
        
        // Imposition Layer (Overlap)
        this.overlapChars = new Uint16Array(totalCells);
        
        // Cell Locks (for pausing simulation under effects)
        this.cellLocks = new Uint8Array(totalCells);

        this.activeIndices = new Set();
        this.complexStyles = new Map();
        this.nextChars = new Map();
        this.nextOverlapChars = new Map();
        this.noiseDirty = true;

        // Update grid dimensions
        this.cols = newCols;
        this.rows = newRows;
    }
}


// --- FontData.js ---
