class MatrixGrid {
            constructor(config) {
                this.config = config;
                this.cols = 0; this.rows = 0;
                this.activeIndices = new Set();
                this.chars = new Uint16Array(0);
                this.types = new Uint8Array(0);
                this.alphas = new Float32Array(0);
                this.decays = new Uint8Array(0);
                this.ages = new Int32Array(0);
                this.brightness = new Float32Array(0);
                this.rotatorProg = new Uint8Array(0);
                this.complexStyles = new Map(); 
                this.nextChars = new Map();
            }

            resize(width, height) {
                const d = this.config.derived;
                const nc = Math.max(1, Math.floor(width / d.cellWidth));
                const nr = Math.max(1, Math.floor(height / d.cellHeight));
                if (nc !== this.cols || nr !== this.rows) {
                    const total = nc * nr;
                    this.chars = new Uint16Array(total); this.types = new Uint8Array(total);
                    this.alphas = new Float32Array(total); this.decays = new Uint8Array(total);
                    this.ages = new Int32Array(total); this.brightness = new Float32Array(total);
                    this.rotatorProg = new Uint8Array(total);
                    this.complexStyles.clear(); this.nextChars.clear();
                    this.activeIndices.clear();
                    this.cols = nc; this.rows = nr;
                }
            }
            getIndex(x, y) { if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return -1; return y * this.cols + x; }
            setChar(idx, charStr) { this.chars[idx] = charStr.charCodeAt(0); }
            getChar(idx) { return String.fromCharCode(this.chars[idx]); }
        }

        // =========================================================================
        // 3.1 STREAM MODES (STRATEGY)
        // =========================================================================
        /**
         * Strategy Pattern for Stream Behavior.
         * Allows different visual styles (Standard, Star Power, Rainbow) to be swapped dynamically.
         * New modes can be added by extending StreamMode and registering in SimulationSystem.
         */
