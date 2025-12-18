// Constants for Cell State and Render Modes
const CELL_STATE = {
    INACTIVE: 0,
    ACTIVE: 1
    // OVERRIDE state is determined by the overrideActive flag
};

const RENDER_MODE = {
    STANDARD: 0, // Mix between Primary and Secondary based on 'mix'
    OVERLAP: 1,  // Visual Overlap (both visible)
    ADDITIVE: 2  // Additive blending (future proofing)
};

const OVERRIDE_MODE = {
    NONE: 0,
    CHAR: 1,
    SOLID: 2
};

class CellGrid {
    constructor(config) {
        this.config = config;

        // Grid dimensions
        this.cols = 0;
        this.rows = 0;

        // --- Core State ---
        this.activeIndices = new Set(); // Tracks active (non-empty) cells
        this.state = null; // Uint8: INACTIVE / ACTIVE

        // --- Primary Layer ---
        this.chars = null;        // Uint16
        this.colors = null;       // Uint32 (0xAABBGGRR) - Current Display Color
        this.baseColors = null;   // Uint32 (0xAABBGGRR) - Target/Stream Color
        this.alphas = null;       // Float32
        this.glows = null;        // Float32
        this.fontIndices = null;  // Uint8

        // --- Secondary Layer (Rotators / Overlaps) ---
        this.secondaryChars = null; // Uint16
        this.secondaryColors = null; // Uint32
        this.secondaryAlphas = null; // Float32
        this.secondaryGlows = null;  // Float32
        this.secondaryFontIndices = null; // Uint8
        
        // --- Mixing & Rendering ---
        this.mix = null;        // Float32 (0.0 = Primary, 1.0 = Secondary)
        this.renderMode = null; // Uint8 (RENDER_MODE)

        // --- Override Layer (Effects) ---
        this.overrideActive = null; // Uint8 (OVERRIDE_MODE)
        this.overrideChars = null;  // Uint16
        this.overrideColors = null; // Uint32
        this.overrideAlphas = null; // Float32
        this.overrideGlows = null;  // Float32
        this.overrideFontIndices = null; // Uint8

        // --- Passive Layer (Effects) ---
        this.effectActive = null;   // Uint8
        this.effectChars = null;    // Uint16
        this.effectColors = null;   // Uint32
        this.effectAlphas = null;   // Float32
        this.effectGlows = null;    // Float32
        this.effectFontIndices = null; // Uint8

        // --- Simulation Logic Storage ---
        this.types = null;      // Uint8 (Tracer, Rotator, Empty)
        this.decays = null;     // Uint8
        this.ages = null;       // Int32
        this.brightness = null; // Float32
        this.rotatorOffsets = null; // Uint8 (Static noise for desync)
        
        // Auxiliary
        this.cellLocks = null;  // Uint8 (Prevent updates)
        
        // Sparse Data (Maps for memory efficiency)
        this.complexStyles = new Map(); // Dynamic styling data
        
        // Rotator Targets (Dense for GPU upload)
        this.nextChars = null;     // Uint16Array
        this.nextOverlapChars = null; // Uint16Array
    }

    /**
     * Resizes the grid based on new width and height.
     */
    resize(width, height) {
        const d = this.config.derived;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
        if (!d || !d.cellWidth || !d.cellHeight) return;

        const newCols = Math.max(1, (width / d.cellWidth) | 0);
        const newRows = Math.max(1, (height / d.cellHeight) | 0);

        if (newCols !== this.cols || newRows !== this.rows) {
            this._resizeGrid(newCols, newRows);
        }
    }

    getIndex(x, y) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
        return y * this.cols + x;
    }

    // --- Primary Layer Modifiers ---

    setPrimary(idx, charStr, colorUint32, alpha, fontIndex = 0, glow = 0) {
        this.chars[idx] = charStr.charCodeAt(0);
        this.colors[idx] = colorUint32;
        this.alphas[idx] = alpha;
        this.glows[idx] = glow;
        this.fontIndices[idx] = fontIndex;
        this.state[idx] = CELL_STATE.ACTIVE;
        this.activeIndices.add(idx);
    }

    setRotatorTarget(idx, charStr, isSecondary = false) {
        const code = charStr.charCodeAt(0);
        if (isSecondary) {
            this.nextOverlapChars[idx] = code;
        } else {
            this.nextChars[idx] = code;
        }
    }

    getRotatorTarget(idx, isSecondary = false) {
        const code = isSecondary ? this.nextOverlapChars[idx] : this.nextChars[idx];
        return (code > 0) ? String.fromCharCode(code) : null;
    }
    
    // --- Secondary Layer Modifiers ---

    setSecondary(idx, charStr, colorUint32, alpha, fontIndex = 0, glow = 0) {
        this.secondaryChars[idx] = charStr.charCodeAt(0);
        this.secondaryColors[idx] = colorUint32;
        this.secondaryAlphas[idx] = alpha;
        this.secondaryGlows[idx] = glow;
        this.secondaryFontIndices[idx] = fontIndex;
    }

    // --- Override Layer Modifiers ---

    // This is a 'permanent' or hard override - it directly changes state
    setOverride(idx, charStr, colorUint32, alpha, fontIndex = 0, glow = 0) {
        this.overrideChars[idx] = charStr ? charStr.charCodeAt(0) : 32;
        this.overrideColors[idx] = colorUint32;
        this.overrideAlphas[idx] = alpha;
        this.overrideGlows[idx] = glow;
        this.overrideFontIndices[idx] = fontIndex;
        this.overrideActive[idx] = OVERRIDE_MODE.CHAR;
    }

    // This is a soft override 
    setEffectOverride(idx, charStr, colorUint32, alpha, fontIndex = 0, glow = 0) {
        this.effectActive[idx] = 1;
        this.effectChars[idx] = charStr ? charStr.charCodeAt(0) : 32;
        this.effectColors[idx] = colorUint32;
        this.effectAlphas[idx] = alpha;
        this.effectFontIndices[idx] = fontIndex;
        this.effectGlows[idx] = glow;
    }

    // Overlay Override (Mixes Effect Char on top of Primary)
    setEffectOverlay(idx, charStr, alpha, fontIndex = 0) {
        this.effectActive[idx] = 2; // 2 = Overlay Mode
        this.effectChars[idx] = charStr ? charStr.charCodeAt(0) : 32;
        this.effectAlphas[idx] = alpha;
        this.effectFontIndices[idx] = fontIndex;
        // Color is assumed White/Global for overlay in simplified shader logic
        // Glow is additive
    }

    // Shadow Overlay (Mixes Black Block on top of Primary)
    setEffectShadow(idx, alpha) {
        this.effectActive[idx] = 3; // 3 = Shadow Mode
        this.effectAlphas[idx] = alpha;
        // Chars/Colors/Fonts ignored for shadow
    }

    setSolidOverride(idx, colorUint32, alpha) {
        this.overrideColors[idx] = colorUint32;
        this.overrideAlphas[idx] = alpha;
        this.overrideActive[idx] = OVERRIDE_MODE.SOLID;
        // Chars/Glows ignored for Solid
    }

    clearOverride(idx) {
        this.overrideActive[idx] = OVERRIDE_MODE.NONE;
    }

    clearEffectOverride(idx) {
        this.effectActive[idx] = 0;
    }

    clearAllOverrides() {
        if (this.overrideActive) {
            this.overrideActive.fill(0);
        }
    }

    clearAllEffects(){
        if (this.effectActive){
            this.effectActive.fill(0);
        }
    }

    // --- General State Management ---

    clearCell(idx) {
        this.state[idx] = CELL_STATE.INACTIVE;
        this.chars[idx] = 32; // Space
        this.alphas[idx] = 0;
        this.glows[idx] = 0;
        this.mix[idx] = 0;
        this.renderMode[idx] = RENDER_MODE.STANDARD;
        
        // Clear simulation data
        this.types[idx] = 0;
        this.ages[idx] = 0;
        this.decays[idx] = 0;
        
        // Also clear secondary to be safe
        this.secondaryChars[idx] = 32;
        this.secondaryAlphas[idx] = 0;
        
        this.activeIndices.delete(idx);
        
        // Clear maps
        this.complexStyles.delete(idx);
        this.nextChars[idx] = 0;
        this.nextOverlapChars[idx] = 0;
    }

    getChar(idx) {
        // Helper for simulation reading
        return String.fromCharCode(this.chars[idx]);
    }

    getState(idx){
        // Helper for getting cell state
        return this.state[idx];
    }

    _resizeGrid(newCols, newRows) {
        const total = newCols * newRows;

        // Core
        this.state = new Uint8Array(total);

        // Primary
        this.chars = new Uint16Array(total);
        this.colors = new Uint32Array(total);
        this.baseColors = new Uint32Array(total);
        this.alphas = new Float32Array(total);
        this.glows = new Float32Array(total);
        this.fontIndices = new Uint8Array(total);

        // Secondary
        this.secondaryChars = new Uint16Array(total);
        this.secondaryColors = new Uint32Array(total);
        this.secondaryAlphas = new Float32Array(total);
        this.secondaryGlows = new Float32Array(total);
        this.secondaryFontIndices = new Uint8Array(total);

        // Mix / Mode
        this.mix = new Float32Array(total);
        this.renderMode = new Uint8Array(total);

        // Override
        this.overrideActive = new Uint8Array(total);
        this.overrideChars = new Uint16Array(total);
        this.overrideColors = new Uint32Array(total);
        this.overrideAlphas = new Float32Array(total);
        this.overrideGlows = new Float32Array(total);
        this.overrideFontIndices = new Uint8Array(total);

        // Effects
        this.effectActive = new Uint8Array(total)
        this.effectChars = new Uint16Array(total);
        this.effectColors = new Uint32Array(total);
        this.effectAlphas = new Float32Array(total);
        this.effectFontIndices = new Uint8Array(total);
        this.effectGlows = new Float32Array(total);

        // Simulation
        this.types = new Uint8Array(total);
        this.decays = new Uint8Array(total);
        this.ages = new Int32Array(total);
        this.brightness = new Float32Array(total);
        this.rotatorOffsets = new Uint8Array(total);
        this.cellLocks = new Uint8Array(total);
        
        // Rotators
        this.nextChars = new Uint16Array(total);
        this.nextOverlapChars = new Uint16Array(total);

        // Environmental Glows (Additive, per frame)
        this.envGlows = new Float32Array(total);

        // Initialize static data
        for (let i = 0; i < total; i++) {
            this.rotatorOffsets[i] = (Math.random() * 255) | 0;
        }

        this.activeIndices = new Set();
        this.complexStyles = new Map();
        
        this.cols = newCols;
        this.rows = newRows;
    }
}