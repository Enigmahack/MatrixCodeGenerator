// =========================================================================
// FONT MANAGER
// =========================================================================

class FontManager {
  constructor(config, notificationMgr) {
    this.config = config;
    this.notifications = notificationMgr;

    // IndexedDB
    this.dbName = 'MatrixFontDB';
    this.storeName = 'fonts';
    this.db = null;

    // Runtime font bookkeeping
    this.loadedFonts = [];     // { name, display, isEmbedded, mimeType?, data? }
    this.subscribers = [];
    this.embeddedFontName = 'MatrixEmbedded';

    // Internal: promises to prevent duplicate loads per face
    this._facePromises = new Map(); // key: fontName -> Promise<void>
    this._defaultCanvasPx = 20;     // used for document.fonts.load exact-size readiness
    this._loadTimeoutMs = 8000;     // defensive timeout for font loads

    // Listen for config resets to re-inject custom font entries
    this.config.subscribe((key) => this._onConfigChange(key));
  }

  _onConfigChange(key) {
    if (key === 'ALL' || key === 'fontSettings') {
        // Re-ensure all loaded fonts exist in the new settings
        this.loadedFonts.forEach(f => {
            this._ensureFontConfig(f.name);
        });
    }
    
    // Check if the current font family is actually available
    if (key === 'fontFamily' || key === 'ALL') {
        const currentFont = this.config.get('fontFamily');
        const isDefault = currentFont === 'MatrixEmbedded';
        const isLoaded = this.loadedFonts.some(f => f.name === currentFont);
        
        if (!isDefault && !isLoaded) {
            this.notifications.show(`Font "${currentFont}" not found. Using fallback.`, 'warning');
        }
    }
  }

  /** Initialize: inject embedded font (if present) + open DB + load stored fonts. */
  async init() {
    if (typeof DEFAULT_FONT_DATA === 'string' && DEFAULT_FONT_DATA.length > 50) {
      await this.injectEmbeddedFont();
    }
    try {
      await this._openDB();
      await this._loadFontsFromDB();
    } catch (error) {
      console.warn('Font DB Error:', error);
      this.notifications.show('Failed to initialize Font Database', 'error');
    }
  }

  /** Subscribe to changes in loadedFonts. */
  subscribe(callback) {
    this.subscribers.push(callback);
  }

  /** Notify subscribers. */
  _notify() {
    this.subscribers.forEach(cb => cb(this.loadedFonts));
  }

  /** Ensure config entry exists for a font. */
  _ensureFontConfig(fontName) {
    const settings = { ...this.config.get('fontSettings') };
    if (!settings[fontName]) {
      settings[fontName] = {
        active: false,
        useCustomChars: false,
        customCharacters: ""
      };
      this.config.set('fontSettings', settings);
    }
  }

  /**
   * Inject embedded default Matrix font (data: URI or base64) if not yet loaded.
   * Uses FontFace + document.fonts to ensure readiness.
   */
  async injectEmbeddedFont() {
    const isFontInjected = this.loadedFonts.some(f => f.name === this.embeddedFontName);
    if (isFontInjected) return;

    const ok = await this._registerFontFace({
      name: this.embeddedFontName,
      // DEFAULT_FONT_DATA is expected to be a data: URL (e.g., data:font/woff2;base64,...)
      // If it's raw base64, wrap as data:font/woff2;base64,<data>
      // Otherwise, provide a normal URL to a woff2 file.
      sourceUrl: DEFAULT_FONT_DATA,
      // Hint the format since data URLs don’t carry a MIME header you can inspect easily.
      formatHint: "format('woff2')",
      canvasPx: this._defaultCanvasPx
    });

    if (ok) {
      this.loadedFonts.push({
        name: this.embeddedFontName,
        display: 'The Matrix Custom Code',
        isEmbedded: true
      });

      // Ensure default font is active/configured
      const settings = { ...this.config.get('fontSettings') };
      if (!settings[this.embeddedFontName]) {
        settings[this.embeddedFontName] = {
          active: true,
          useCustomChars: false,
          customCharacters: ""
        };
        this.config.set('fontSettings', settings);
      }
    } else {
        this.notifications.show('Failed to load embedded font', 'error');
    }
  }

  /**
   * Programmatic font registration using FontFace.
   * Replaces the old <style>@font-face</style> injection.
   *
   * @param {Object} opts
   *  - name: string (family)
   *  - sourceUrl: string (Blob URL, data: URL, or http(s) URL)
   *  - formatHint: string e.g. "format('woff2')" (optional but recommended)
   *  - weight/style/stretch/unicodeRange: CSS descriptors (optional)
   *  - canvasPx: number (exact size you’ll use for canvas metrics readiness)
   *  - preload: boolean (inject <link rel="preload"> if sourceUrl is http(s))
   */
  async _registerFontFace(opts) {
    const {
      name,
      sourceUrl,
      formatHint,
      weight = '400',
      style = 'normal',
      stretch = 'normal',
      unicodeRange,
      canvasPx = this._defaultCanvasPx,
      preload = false
    } = opts;

    // De-dupe: once per family
    if (this._facePromises.has(name)) {
      return this._facePromises.get(name);
    }

    const task = (async () => {
      // (Optional) preload for http(s) sources
      if (preload && /^https?:/.test(sourceUrl)) {
        this._injectPreload(sourceUrl);
      }

      // src string (programmatic FontFace supports url()+format())
      const src = formatHint ? `url("${sourceUrl}") ${formatHint}` : `url("${sourceUrl}")`;

      const descriptors = { weight, style, stretch };
      if (unicodeRange) descriptors.unicodeRange = unicodeRange;

      const face = new FontFace(name, src, descriptors);

      // Defensive timeout so we never hang the animation pipeline.
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`Font load timeout: ${name}`)), this._loadTimeoutMs)
      );

      // Load the font bytes & parse the face
      await Promise.race([face.load(), timeout]);

      // Register with the document
      document.fonts.add(face);

      // Ensure exact face+size is available for canvas metrics
      await document.fonts.load(`${canvasPx}px "${name}"`);
      await document.fonts.ready;
      return true;
    })().catch(err => {
      console.warn(`[FontManager] Failed to load "${name}"`, err);
      return false;
    });

    this._facePromises.set(name, task);
    return task;
  }

  /** Preload helper to avoid late discovery & double fetch. */
  _injectPreload(href) {
    const existing = document.querySelector(`link[rel="preload"][as="font"][href="${href}"]`);
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.href = href;
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous'; // critical for font preloads to be reusable from cache
    document.head.appendChild(link);
  }

  /**
   * Legacy wrapper: Keep method name for compatibility.
   * Internally routes to FontFace registration.
   *
   * @param {string} name    - family name
   * @param {string} url     - Blob URL / data URL / http(s)
   * @param {string} format  - e.g., "format('woff2')"
   */
  async _injectCSS(name, url, format) {
    return this._registerFontFace({ name, sourceUrl: url, formatHint: format, canvasPx: this._defaultCanvasPx });
  }

  /** Open/create IndexedDB store. */
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

  /** Load stored fonts: register faces + ensure readiness, then notify. */
  async _loadFontsFromDB() {
    return new Promise(resolve => {
      if (!this.db) return resolve();

      const txn = this.db.transaction(this.storeName, 'readonly');
      const store = txn.objectStore(this.storeName);

      store.getAll().onsuccess = async event => {
        const storedFonts = event.target.result || [];

        // Keep only embedded font in runtime list; reload DB fonts fresh
        this.loadedFonts = this.loadedFonts.filter(f => f.isEmbedded);

        await Promise.all(storedFonts.map(async (font) => {
          this.loadedFonts.push(font);
          this._ensureFontConfig(font.name);

          const type = font.mimeType || (font.data && font.data.type) || 'font/woff2';
          const format = this._getFormatFromType(type);

          const blobUrl = URL.createObjectURL(font.data);
          const ok = await this._registerFontFace({
            name: font.name,
            sourceUrl: blobUrl,
            formatHint: format,
            canvasPx: this._defaultCanvasPx
          });

          // Once registered and ready, we can revoke the blob URL to free memory
          // (the face is now owned by document.fonts).
          try { URL.revokeObjectURL(blobUrl); } catch (_) {}
          if (!ok) {
            console.warn(`Font "${font.name}" failed to register from DB`);
          }
        }));

        this._notify();
        resolve();
      };
    });
  }

  /** Map MIME -> format() hint for @font-face / FontFace src. */
  _getFormatFromType(mimeType = '') {
    const mt = mimeType.toLowerCase();
    if (mt.includes('woff2')) return "format('woff2')";
    if (mt.includes('woff'))  return "format('woff')";
    if (mt.includes('opentype') || mt.includes('otf')) return "format('opentype')";
    return "format('truetype')";
  }

  /**
   * Import a custom font file: hash, persist in DB, register via FontFace, notify.
   * Keeps your existing external behavior but ensures readiness & object URL cleanup.
   */
  importFont(file) {
    const reader = new FileReader();

    reader.onload = async event => {
      const arrayBuffer = event.target.result;
      const blob = new Blob([arrayBuffer], { type: file.type });

      let fontName;
      try {
        const hash = await Utils.computeSHA256(arrayBuffer);
        fontName = `CustomFont_${hash.substring(0, 16)}`;
      } catch (e) {
        console.warn("Hashing failed, falling back to timestamp", e);
        fontName = `CustomFont_${Date.now()}`;
      }

      const record = {
        name: fontName,
        display: file.name,
        data: blob,
        mimeType: file.type
      };

      const txn = this.db.transaction(this.storeName, 'readwrite');
      const store = txn.objectStore(this.storeName);

      store.put(record).onsuccess = async () => {
        const format = this._getFormatFromType(file.type);

        // Register via FontFace & ensure ready
        const blobUrl = URL.createObjectURL(blob);
        const ok = await this._registerFontFace({
          name: fontName,
          sourceUrl: blobUrl,
          formatHint: format,
          canvasPx: this._defaultCanvasPx
        });
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}

        this.loadedFonts.push(record);
        this._ensureFontConfig(fontName);

        // If desired, auto-activate imported font (kept as comment to preserve your behavior)
        const settings = { ...this.config.get('fontSettings') };
        settings[fontName].active = true;
        this.config.set('fontSettings', settings);

        
        if (ok) {
          this.config.set('fontFamily', fontName);
          this._notify();
          this.notifications.show(`Imported: ${file.name}`, 'success');
        } else {
          this.notifications.show(`Import failed: ${file.name}`, 'error');
        }
      };

      txn.onerror = () => {
        this.notifications.show('Database Write Failed', 'error');
      };
    };

    reader.readAsArrayBuffer(file);
  }

  /**
   * Delete by font id/name.
   * Note: FontFace entries registered in document.fonts can’t be explicitly “removed”,
   * but removing config, style tags (legacy), and revoking Blob URLs (handled above)
   * prevents leaks and stops future use.
   */
  deleteFont(id) {
    return new Promise(resolve => {
      const txn = this.db.transaction(this.storeName, 'readwrite');
      const store = txn.objectStore(this.storeName);

      store.delete(id).onsuccess = () => {
        // Remove legacy style tag (if any)
        document.getElementById(`style-${id}`)?.remove();

        const deletedFont = this.loadedFonts.find(font => font.name === id);
        this.loadedFonts = this.loadedFonts.filter(font => font.name !== id);

        // Deactivate in config to prevent rendering issues
        const settings = { ...this.config.get('fontSettings') };
        if (settings[id]) {
          settings[id].active = false;
          this.config.set('fontSettings', settings);
        }

        if (this.config.state.fontFamily === id) {
          this.config.set('fontFamily', this.config.defaults.fontFamily);
          this.notifications.show(`Deleted font was active. Reverted to default.`, 'warning');
        } else {
             this.notifications.show(`Deleted font: ${deletedFont ? deletedFont.display : id}`, 'success');
        }

        this._notify();
        resolve();
      };
      
      store.delete(id).onerror = () => {
          this.notifications.show('Failed to delete font', 'error');
          resolve();
      };
    });
  }

  /** Clear DB + keep only embedded runtime fonts. */
  deleteAllFonts() {
    return new Promise(resolve => {
      const txn = this.db.transaction(this.storeName, 'readwrite');
      const store = txn.objectStore(this.storeName);

      store.clear().onsuccess = () => {
        // Remove any legacy <style> tags
        this.loadedFonts
          .filter(font => !font.isEmbedded)
          .forEach(font => document.getElementById(`style-${font.name}`)?.remove());

        // Keep only embedded fonts
        this.loadedFonts = this.loadedFonts.filter(font => font.isEmbedded);

        this._notify();
        this.notifications.show('All custom fonts deleted', 'success');
        resolve();
      };
      
      store.clear().onerror = () => {
          this.notifications.show('Failed to clear fonts', 'error');
          resolve();
      };
    });
  }

  // ---------- Canvas helpers (optional but handy) ----------

  /**
   * Build a safe canvas font shorthand string for metrics & drawing.
   * @param {string} family
   * @param {number} sizePx
   * @param {string} weight
   * @param {string} style
   * @param {string} fallbackStack
   */
  buildCanvasFont({ family, sizePx = this._defaultCanvasPx, weight = '400', style = 'normal', fallbackStack = 'monospace' } = {}) {
    // e.g. "normal 400 20px 'MatrixEmbedded', monospace"
    return `${style} ${weight} ${sizePx}px '${family}', ${fallbackStack}`;
  }

  /**
   * Ensure a specific family is ready for the given canvas size before drawing.
   * (Useful if you change sizes dynamically.)
   */
  async ensureReadyForCanvasSize(family, sizePx = this._defaultCanvasPx) {
    await document.fonts.load(`${sizePx}px "${family}"`);
       await document.fonts.ready;
  }
}

