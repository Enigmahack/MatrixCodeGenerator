class FontManager {
            constructor(config, notificationMgr) {
                this.config = config; this.notifications = notificationMgr;
                this.dbName = 'MatrixFontDB'; this.storeName = 'fonts'; this.db = null;
                this.loadedFonts = []; this.subs = []; this.embeddedFontName = 'MatrixEmbedded';
            }
            async init() { if(DEFAULT_FONT_DATA && DEFAULT_FONT_DATA.length > 50) this.injectEmbeddedFont(); try { await this._openDB(); await this._loadFontsFromDB(); } catch(e) { console.warn("Font DB Error", e); } }
            subscribe(cb) { this.subs.push(cb); }
            _notify() { this.subs.forEach(cb => cb(this.loadedFonts)); }
            injectEmbeddedFont() { if(this.loadedFonts.some(f => f.name === this.embeddedFontName)) return; this._injectCSS(this.embeddedFontName, DEFAULT_FONT_DATA, "format('woff2')"); this.loadedFonts.push({ name: this.embeddedFontName, display: "The Matrix Custom Code", isEmbedded: true }); }
            _injectCSS(name, url, format) { const existing = document.getElementById(`style-${name}`); if(existing) existing.remove(); const style = document.createElement('style'); style.id = `style-${name}`; style.textContent = `@font-face { font-family: '${name}'; src: url('${url}') ${format}; }`; document.head.appendChild(style); }
            _openDB() { return new Promise((res, rej) => { const r = indexedDB.open(this.dbName, 1); r.onupgradeneeded = e => { if(!e.target.result.objectStoreNames.contains(this.storeName)) { e.target.result.createObjectStore(this.storeName, { keyPath: 'name' }); } }; r.onsuccess = e => { this.db = e.target.result; res(); }; r.onerror = rej; }); }
            _loadFontsFromDB() { return new Promise((res) => { if(!this.db) return res(); const t = this.db.transaction(this.storeName, 'readonly'); t.objectStore(this.storeName).getAll().onsuccess = e => { this.loadedFonts = this.loadedFonts.filter(f => f.isEmbedded); e.target.result.forEach(f => { this.loadedFonts.push(f); const type = f.mimeType || f.data.type; const format = this._getFormatFromType(type); this._injectCSS(f.name, URL.createObjectURL(f.data), format); }); this._notify(); res(); }; }); }
            _getFormatFromType(type) { if (type.includes('woff2')) return "format('woff2')"; if (type.includes('woff')) return "format('woff')"; if (type.includes('opentype') || type.includes('otf')) return "format('opentype')"; return "format('truetype')"; }
            importFont(file) {
                const reader = new FileReader();
                reader.onload = e => {
                    const blob = new Blob([e.target.result], {type: file.type}); const id = `CustomFont_${Date.now()}`;
                    const rec = { name: id, display: file.name, data: blob, mimeType: file.type };
                    const t = this.db.transaction(this.storeName, 'readwrite');
                    t.objectStore(this.storeName).put(rec).onsuccess = () => { const format = this._getFormatFromType(file.type); this._injectCSS(id, URL.createObjectURL(blob), format); this.loadedFonts.push(rec); this.config.set('fontFamily', id); this._notify(); this.notifications.show(`Imported: ${file.name}`, 'success'); };
                    t.onerror = () => this.notifications.show("Database Write Failed", 'error');
                };
                reader.readAsArrayBuffer(file);
            }
            deleteFont(id) { return new Promise(res => { const t = this.db.transaction(this.storeName, 'readwrite'); t.objectStore(this.storeName).delete(id).onsuccess = () => { document.getElementById(`style-${id}`)?.remove(); this.loadedFonts = this.loadedFonts.filter(f => f.name !== id); if(this.config.state.fontFamily === id) { this.config.set('fontFamily', this.config.defaults.fontFamily); } this._notify(); res(); }; }); }
            deleteAllFonts() { return new Promise(res => { const t = this.db.transaction(this.storeName, 'readwrite'); t.objectStore(this.storeName).clear().onsuccess = () => { this.loadedFonts.filter(f => !f.isEmbedded).forEach(f => { document.getElementById(`style-${f.name}`)?.remove(); }); this.loadedFonts = this.loadedFonts.filter(f => f.isEmbedded); this._notify(); res(); }; }); }
        }

        // =========================================================================
        // 8. UI MANAGER
        // =========================================================================
