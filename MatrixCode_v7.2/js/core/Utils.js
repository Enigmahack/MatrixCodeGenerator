const APP_VERSION = "7.1";

        // =========================================================================
        // 1. CORE UTILITIES / CONSTANTS
        // =========================================================================
        const Utils = {
            randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
            randomFloat: (min, max) => Math.random() * (max - min) + min,
            hexToRgb: (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 255, b: 0 };
            },
            packRgb: (r, g, b) => (r << 16) | (g << 8) | b,
            unpackRgb: (intVal) => ({ r: (intVal >> 16) & 0xFF, g: (intVal >> 8) & 0xFF, b: intVal & 0xFF }),
            hslToRgb: (h, s, l) => {
                s /= 100; l /= 100;
                const k = n => (n + h / 30) % 12;
                const a = s * Math.min(l, 1 - l);
                const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
                return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)) };
            },
            CHARS: '012345789Z:<=>"*+-._!|⽇゠ウエオカキクコサシスセソツテナニヌネハヒフホマミムメモヤラリワヲンワヲン',
            getRandomChar: () => Utils.CHARS.charAt(Math.floor(Math.random() * Utils.CHARS.length)),
            getUniqueChar: (exclude) => { let c; do { c = Utils.getRandomChar(); } while (c === exclude); return c; },
            downloadJson: (data, filename) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            }
        };

        const CELL_TYPE = { EMPTY: 0, TRAIL: 1, TRACER: 2, ROTATOR: 3 };

        // =========================================================================
        // 1.1 NOTIFICATION SYSTEM 
        // =========================================================================
