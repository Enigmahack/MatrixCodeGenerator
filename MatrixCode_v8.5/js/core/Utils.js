// =========================================================================
// CORE UTILITIES / CONSTANTS
// =========================================================================

const APP_VERSION = "8.5";

const Utils = {
    /**
     * Generates a random integer between min (inclusive) and max (inclusive).
     * @param {number} min - The minimum value (inclusive).
     * @param {number} max - The maximum value (inclusive).
     * @returns {number} A random integer.
     */
    randomInt: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),

    /**
     * Generates a random floating-point number between min (inclusive) and max (exclusive).
     * @param {number} min - The minimum value (inclusive).
     * @param {number} max - The maximum value (exclusive).
     * @returns {number} A random floating-point number.
     */
    randomFloat: (min, max) => min + Math.random() * (max - min),

    /**
     * Converts a color string (Hex "#RRGGBB" or "rgb(r,g,b)") to an { r, g, b } object.
     * @param {string} input - The color string.
     * @returns {{r: number, g: number, b: number}} An object with red, green, and blue components.
     */
    hexToRgb: (input) => {
        if (typeof input !== "string") return { r: 0, g: 255, b: 0 };

        // Handle Hex (6 or 8 digits)
        const hexMatch = input.match(/^#?([A-Fa-f0-9]{6})([A-Fa-f0-9]{2})?$/);
        if (hexMatch) {
            const value = parseInt(hexMatch[1], 16);
            return {
                r: (value >> 16) & 0xFF,
                g: (value >> 8) & 0xFF,
                b: value & 0xFF
            };
        }

        // Handle RGB / RGBA
        const match = input.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return {
                r: parseInt(match[1], 10),
                g: parseInt(match[2], 10),
                b: parseInt(match[3], 10)
            };
        }

        // Fallback
        return { r: 0, g: 255, b: 0 }; 
    },

    /**
     * Packs 3 RGB components (r, g, b) into a single 24-bit integer.
     * @param {number} r - Red component (0-255).
     * @param {number} g - Green component (0-255).
     * @param {number} b - Blue component (0-255).
     * @returns {number} The packed 24-bit integer.
     */
    packRgb: (r, g, b) => ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF),

    /**
     * Packs RGB components into a single 32-bit integer (0xAABBGGRR) for Little Endian (RR GG BB AA in memory).
     * @param {number} r - Red (0-255).
     * @param {number} g - Green (0-255).
     * @param {number} b - Blue (0-255).
     * @param {number} a - Alpha (0-255), defaults to 255.
     * @returns {number} The packed 32-bit integer.
     */
    packAbgr: (r, g, b, a = 255) => {
        return ((a & 0xFF) << 24) | ((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF);
    },

    /**
     * Unpacks a 24-bit integer into RGB components {r, g, b}.
     * @param {number} intVal - The packed 24-bit integer.
     * @returns {{r: number, g: number, b: number}} An object with red, green, and blue components.
     */
    unpackRgb: (intVal) => ({
        r: (intVal >> 16) & 0xFF,
        g: (intVal >> 8) & 0xFF,
        b: intVal & 0xFF
    }),

    /**
     * Converts HSL (hue, saturation, lightness) to RGB { r, g, b }.
     * @param {number} h - Hue (0-360).
     * @param {number} s - Saturation (0-100).
     * @param {number} l - Lightness (0-100).
     * @returns {{r: number, g: number, b: number}} An object with red, green, and blue components.
     */
    hslToRgb: (h, s, l) => {
        s /= 100;
        l /= 100;

        const chroma = (1 - Math.abs(2 * l - 1)) * s;
        const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - chroma / 2;

        let rgb = [0, 0, 0];
        if (h >= 0 && h < 60) rgb = [chroma, x, 0];
        else if (h >= 60 && h < 120) rgb = [x, chroma, 0];
        else if (h >= 120 && h < 180) rgb = [0, chroma, x];
        else if (h >= 180 && h < 240) rgb = [0, x, chroma];
        else if (h >= 240 && h < 300) rgb = [x, 0, chroma];
        else if (h >= 300 && h < 360) rgb = [chroma, 0, x];

        return {
            r: Math.round((rgb[0] + m) * 255),
            g: Math.round((rgb[1] + m) * 255),
            b: Math.round((rgb[2] + m) * 255)
        };
    },

    /**
     * Creates an RGB color string from an {r, g, b} object.
     * @param {{r: number, g: number, b: number}} color - The color object.
     * @returns {string} An RGB color string (e.g., "rgb(255,0,0)").
     */
    createRGBString: (color) => `rgb(${color.r},${color.g},${color.b})`,

    // List of available characters for random selection
    CHARS: '012345789Z:<=>"*+-._!|⽇゠ウエオカキクコサシスセソツテナニヌネハヒフホマミムメモヤラリワヲン',

    // Subset of Katakana characters for specific use cases
    KATAKANA_CHARS: 'ウエオカキクコサシスセソツテナニヌネハヒフホマミムメモヤラリワヲン',

    /**
     * Returns a random character from the predefined KATAKANA_CHARS list.
     * @returns {string} A single random Katakana character.
     */
    getRandomKatakanaChar: () => {
        const index = Utils.randomInt(0, Utils.KATAKANA_CHARS.length - 1);
        return Utils.KATAKANA_CHARS[index];
    },

    /**
     * Returns a random character from the predefined CHARS list.
     * @returns {string} A single random character.
     */
    getRandomChar: () => {
        const index = Utils.randomInt(0, Utils.CHARS.length - 1);
        return Utils.CHARS[index];
    },

    /**
     * Generates a random character from the CHARS list, excluding the provided character.
     * @param {string} exclude - The character to exclude from the random selection.
     * @returns {string|null} A unique random character, or null if no other characters are available.
     */
    getUniqueChar: (exclude) => {
        if (Utils.CHARS.length <= 1) return null;
        let char;
        do {
            char = Utils.getRandomChar();
        } while (char === exclude);
        return char;
    },

    /**
     * Computes the SHA-256 hash of an ArrayBuffer.
     * @param {ArrayBuffer} buffer - The input buffer.
     * @returns {Promise<string>} The hex string of the hash.
     */
    computeSHA256: async (buffer) => {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    },

    /**
     * Downloads a JSON object as a file.
     * @param {Object} data - The JSON object to download.

    /**
     * Downloads a JSON object as a file.
     * @param {Object} data - The JSON object to download.
     * @param {string} [filename="file.json"] - The name of the file to save.
     */
    downloadJson: (data, filename = "file.json") => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();

        // Clean up
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    /**
     * Generates an SVG data URL for a single Matrix glyph.
     * @param {string} char - The character to render (e.g., '0').
     * @param {string} color - The color of the character (e.g., '#00FF00').
     * @param {number} size - The font size in pixels.
     * @param {string} fontFamily - The font family to use.
     * @returns {string} A data URL containing the SVG image.
     */
    generateGlyphSVG: (char, color, size = 24, fontFamily = 'monospace') => {
        // Ensure the char is a string and handle potential empty or non-string inputs
        char = String(char || ' '); 

        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <rect width="${size}" height="${size}" fill="transparent"/>
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                      font-family="${fontFamily}" font-size="${size * 0.8}" fill="${color}">
                    ${char}
                </text>
            </svg>
        `.replace(/\s+/g, ' ').trim(); // Minify SVG string

        // Encode SVG to UTF-8 before Base64 encoding for characters outside Latin1 range
        const utf8Svg = unescape(encodeURIComponent(svg));
        return `data:image/svg+xml;base64,${btoa(utf8Svg)}`;
    }
};

// Predefined cell types for use in the grid
const CELL_TYPE = {
    EMPTY: 0,
    TRAIL: 1,
    TRACER: 2,
    ROTATOR: 3,
    UPWARD_TRACER: 4
};

const CELL_TYPE_MASK = 0x7F; // 127
const CELL_FLAGS = {
    GRADUAL: 0x80 // 128
};
