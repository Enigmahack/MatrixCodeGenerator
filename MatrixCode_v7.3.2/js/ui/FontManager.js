class FontManager {
    constructor(config, notificationMgr) {
        this.config = config;
        this.notifications = notificationMgr;
        this.dbName = 'MatrixFontDB';
        this.storeName = 'fonts';
        this.db = null;
        this.loadedFonts = [];
        this.subscribers = [];
        this.embeddedFontName = 'MatrixEmbedded';
    }

    /**
     * Initialize the FontManager by injecting the embedded font and loading fonts from the database.
     */
    async init() {
        if (DEFAULT_FONT_DATA && DEFAULT_FONT_DATA.length > 50) {
            this.injectEmbeddedFont();
        }

        try {
            await this._openDB();
            await this._loadFontsFromDB();
        } catch (error) {
            console.warn('Font DB Error:', error);
        }
    }

    /**
     * Add a subscription callback to be notified on font changes.
     * @param {Function} callback - The callback function to execute on changes.
     */
    subscribe(callback) {
        this.subscribers.push(callback);
    }

    /**
     * Notify all subscribers about font changes.
     * Executes the callback functions passed via subscribe.
     */
    _notify() {
        this.subscribers.forEach(callback => callback(this.loadedFonts));
    }

    /**
     * Inject the embedded default Matrix font if it hasn't already been loaded.
     */
    injectEmbeddedFont() {
        const isFontInjected = this.loadedFonts.some(f => f.name === this.embeddedFontName);
        if (isFontInjected) return;

        this._injectCSS(this.embeddedFontName, DEFAULT_FONT_DATA, "format('woff2')");
        this.loadedFonts.push({
            name: this.embeddedFontName,
            display: 'The Matrix Custom Code',
            isEmbedded: true,
        });
    }

    /**
     * Inject a font into the document as a CSS @font-face rule.
     * @param {string} name - Font's name.
     * @param {string} url - The URL or source of the font data.
     * @param {string} format - The format of the font data (e.g., 'format("woff2")').
     */
    _injectCSS(name, url, format) {
        const existingStyle = document.getElementById(`style-${name}`);
        if (existingStyle) existingStyle.remove();

        const style = document.createElement('style');
        style.id = `style-${name}`;
        style.textContent = `
            @font-face {
                font-family: '${name}';
                src: url('${url}') ${format};
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Open or create the IndexedDB for storing font data.
     * @returns {Promise} Resolves when the database connection is successful.
     */
    async _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'name' });
                }
            };

            request.onsuccess = event => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Load all fonts stored in the database into the application.
     * @returns {Promise} Resolves once fonts are loaded.
     */
    async _loadFontsFromDB() {
        return new Promise(resolve => {
            if (!this.db) return resolve();

            const transaction = this.db.transaction(this.storeName, 'readonly');
            const objectStore = transaction.objectStore(this.storeName);

            objectStore.getAll().onsuccess = event => {
                const storedFonts = event.target.result;

                // Reset the font list, keeping only the embedded font.
                this.loadedFonts = this.loadedFonts.filter(f => f.isEmbedded);

                // Inject fonts from the database into the application.
                storedFonts.forEach(font => {
                    this.loadedFonts.push(font);

                    const type = font.mimeType || font.data.type;
                    const format = this._getFormatFromType(type);
                    this._injectCSS(font.name, URL.createObjectURL(font.data), format);
                });

                this._notify();
                resolve();
            };
        });
    }

    /**
     * Determine the CSS format string for a given MIME type.
     * @param {string} mimeType - The MIME type of the font file.
     * @returns {string} The corresponding format string for @font-face.
     */
    _getFormatFromType(mimeType) {
        if (mimeType.includes('woff2')) return "format('woff2')";
        if (mimeType.includes('woff')) return "format('woff')";
        if (mimeType.includes('opentype') || mimeType.includes('otf')) return "format('opentype')";
        return "format('truetype')";
    }

    /**
     * Import a custom font into the database and inject it as a CSS @font-face.
     * @param {File} file - The font file to import.
     */
    importFont(file) {
        const reader = new FileReader();

        reader.onload = event => {
            const blob = new Blob([event.target.result], { type: file.type });
            const fontName = `CustomFont_${Date.now()}`; // Unique font name.
            const record = {
                name: fontName,
                display: file.name,
                data: blob,
                mimeType: file.type,
            };

            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            objectStore.put(record).onsuccess = () => {
                const format = this._getFormatFromType(file.type);
                this._injectCSS(fontName, URL.createObjectURL(blob), format);

                this.loadedFonts.push(record);
                this.config.set('fontFamily', fontName);
                this._notify();

                this.notifications.show(`Imported: ${file.name}`, 'success');
            };

            transaction.onerror = () => {
                this.notifications.show('Database Write Failed', 'error');
            };
        };

        reader.readAsArrayBuffer(file);
    }

    /**
     * Delete a font by its ID from the database and the DOM.
     * @param {string} id - The ID of the font to delete.
     * @returns {Promise} Resolves once the font is deleted.
     */
    deleteFont(id) {
        return new Promise(resolve => {
            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            objectStore.delete(id).onsuccess = () => {
                document.getElementById(`style-${id}`)?.remove();
                this.loadedFonts = this.loadedFonts.filter(font => font.name !== id);

                if (this.config.state.fontFamily === id) {
                    this.config.set('fontFamily', this.config.defaults.fontFamily);
                }

                this._notify();
                resolve();
            };
        });
    }

    /**
     * Clear all fonts from the database and only keep embedded fonts.
     * @returns {Promise} Resolves once all fonts are deleted.
     */
    deleteAllFonts() {
        return new Promise(resolve => {
            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            objectStore.clear().onsuccess = () => {
                // Remove all non-embedded fonts.
                this.loadedFonts
                    .filter(font => !font.isEmbedded)
                    .forEach(font => document.getElementById(`style-${font.name}`)?.remove());

                // Keep only embedded fonts.
                this.loadedFonts = this.loadedFonts.filter(font => font.isEmbedded);

                this._notify();
                resolve();
            };
        });
    }
}

    // =========================================================================
    // 9.0 UI MANAGER
    // =========================================================================
