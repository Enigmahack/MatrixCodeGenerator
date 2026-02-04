// =========================================================================
// CHARACTER SELECTOR MODAL
// =========================================================================

class CharacterSelectorModal {
    constructor(config, fontManager, notificationMgr) {
        this.config = config;
        this.fonts = fontManager;
        this.notifications = notificationMgr;
        this.dom = null;
        this.currentFont = null;
        
        // Canvas for glyph detection
        this.scanCanvas = document.createElement('canvas');
        this.scanCanvas.width = 20;
        this.scanCanvas.height = 20;
        this.scanCtx = this.scanCanvas.getContext('2d', { willReadFrequently: true });

        // Subscribe to config changes for fontSettings
        this.config.subscribe((key) => this._handleConfigChange(key));
    }

    show() {
        if (!this.dom) {
            this._createDOM();
        }
        this._refreshFontList();
        
        const currentFamily = this.config.get('fontFamily');
        const isKnown = this.fonts.loadedFonts.some(f => f.name === currentFamily) || currentFamily === 'MatrixEmbedded';
        this.currentFont = isKnown ? currentFamily : 'MatrixEmbedded';
        
        if (this.dom.fontSelect.querySelector(`option[value="${this.currentFont}"]`)) {
            this.dom.fontSelect.value = this.currentFont;
        } else {
             this.currentFont = 'MatrixEmbedded';
             this.dom.fontSelect.value = 'MatrixEmbedded';
        }

        this._loadFontSettings(this.currentFont);
        this.dom.overlay.classList.add('visible');
    }

    hide() {
        if (this.dom) {
            this.dom.overlay.classList.remove('visible');
        }
    }
    
    _handleConfigChange(key) {
        if (key === 'fontSettings' && this.dom && this.dom.overlay.classList.contains('visible')) {
            // If font settings changed while modal is open, reload current font settings to refresh UI
            this._loadFontSettings(this.currentFont);
        }
    }

    _createDOM() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const content = document.createElement('div');
        content.className = 'modal-content';
        
        // Header
        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = '<h3 class="modal-title">Manage Characters</h3><div class="modal-close">×</div>';
        header.querySelector('.modal-close').onclick = () => this.hide();
        
        // Body
        const body = document.createElement('div');
        body.className = 'modal-body';
        
        // 1. Font Selector
        const fontRow = document.createElement('div');
        fontRow.innerHTML = '<label class="modal-label">Select Font to Edit</label>';
        this.fontSelect = document.createElement('select');
        this.fontSelect.onchange = (e) => this._loadFontSettings(e.target.value);
        fontRow.appendChild(this.fontSelect);
        body.appendChild(fontRow);
        
        // 2. Active Toggle
        const activeRow = document.createElement('div');
        activeRow.className = 'checkbox-row';
        activeRow.innerHTML = '<span>Include in Rain</span><input type="checkbox" id="fontActiveToggle">';
        activeRow.querySelector('input').onchange = (e) => this._updateSetting('active', e.target.checked);
        this.activeToggle = activeRow.querySelector('input');
        body.appendChild(activeRow);
        
        // 3. Custom Chars Toggle
        const customToggleRow = document.createElement('div');
        customToggleRow.className = 'checkbox-row';
        customToggleRow.innerHTML = '<span>Use Custom Characters</span><input type="checkbox" id="fontCustomToggle">';
        customToggleRow.querySelector('input').onchange = (e) => {
            this._updateSetting('useCustomChars', e.target.checked);
            this._toggleInputs(e.target.checked);
        };
        this.customToggle = customToggleRow.querySelector('input');
        body.appendChild(customToggleRow);

        // 4. Use All Characters Toggle
        const useAllRow = document.createElement('div');
        useAllRow.className = 'checkbox-row';
        useAllRow.innerHTML = '<span>Auto-Detect All Characters</span><input type="checkbox" id="fontUseAllToggle">';
        useAllRow.querySelector('input').onchange = (e) => {
            this._updateSetting('useAllChars', e.target.checked);
            this._handleUseAll(e.target.checked);
        };
        this.useAllToggle = useAllRow.querySelector('input');
        body.appendChild(useAllRow);

        this.scanStatus = document.createElement('div');
        this.scanStatus.className = 'scan-status';
        body.appendChild(this.scanStatus);
        
        // 5. Visual Picker
        const pickerGroup = document.createElement('div');
        pickerGroup.innerHTML = '<label class="modal-label">Visual Selector</label><div class="modal-desc">Click characters to add/remove them. Empty boxes are unsupported by this font.</div>';
        this.charGrid = document.createElement('div');
        this.charGrid.className = 'char-grid-container';
        pickerGroup.appendChild(this.charGrid);
        body.appendChild(pickerGroup);

        // 6. Manual Input (Fallback)
        const inputGroup = document.createElement('div');
        inputGroup.innerHTML = '<label class="modal-label">Manual Input</label>';
        this.charInput = document.createElement('textarea');
        this.charInput.className = 'char-input';
        this.charInput.placeholder = 'Or paste characters here...';
        this.charInput.oninput = (e) => {
            this._updateSetting('customCharacters', e.target.value);
            this._updateGridSelection();
        };
        inputGroup.appendChild(this.charInput);
        body.appendChild(inputGroup);
        
        // Footer
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'action-btn btn-info';
        saveBtn.textContent = 'Done';
        saveBtn.style.width = 'auto';
        saveBtn.onclick = () => this.hide();
        footer.appendChild(saveBtn);
        
        content.append(header, body, footer);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        
        this.dom = { overlay, fontSelect: this.fontSelect };
    }

    _refreshFontList() {
        this.fontSelect.innerHTML = '';
        const fonts = [
            { name: 'MatrixEmbedded', display: 'Matrix Custom Code (Default)' },
            ...this.fonts.loadedFonts.filter(f => !f.isEmbedded)
        ];
        fonts.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = f.display || f.name;
            this.fontSelect.appendChild(opt);
        });
    }

    _loadFontSettings(fontName) {
        this.currentFont = fontName;
        const allSettings = this.config.get('fontSettings') || {};
        
        if (!allSettings[fontName]) {
             allSettings[fontName] = { active: false, useCustomChars: false, useAllChars: false, customCharacters: "" };
        }
        const settings = allSettings[fontName];
        
        this.activeToggle.checked = settings.active;
        this.customToggle.checked = settings.useCustomChars;
        this.useAllToggle.checked = settings.useAllChars;
        this.charInput.value = settings.customCharacters || "";
        
        this._toggleInputs(settings.useCustomChars);
        
        // If Use All is checked, run the scan logic visually but don't overwrite if not needed
        // Ideally we only run scan if useAllChars is TRUE.
        if (settings.useCustomChars) {
            if (settings.useAllChars) {
                this._handleUseAll(true); // Will re-scan and disable inputs
            } else {
                this._renderGrid(); // Just render grid for manual selection
            }
        }
    }

    _toggleInputs(enabled) {
        const opacity = enabled ? 1 : 0.5;
        this.useAllToggle.disabled = !enabled;
        this.useAllToggle.parentElement.style.opacity = opacity;
        
        // If "Use All" is checked, specific inputs are disabled regardless of "Use Custom"
        const allChecked = this.useAllToggle.checked;
        const manualEnabled = enabled && !allChecked;

        this.charInput.disabled = !manualEnabled;
        this.charInput.style.opacity = manualEnabled ? 1 : 0.5;
        this.charGrid.style.opacity = manualEnabled ? 1 : 0.5;
        this.charGrid.style.pointerEvents = manualEnabled ? 'auto' : 'none';
        
        if (enabled && !allChecked) {
            this._renderGrid();
        }
    }

    async _handleUseAll(checked) {
        if (!checked) {
            this._toggleInputs(true); // Re-enable manual inputs
            this.scanStatus.textContent = '';
            return;
        }

        this.charInput.disabled = true;
        this.charInput.style.opacity = 0.5;
        this.charGrid.style.opacity = 0.5;
        this.charGrid.style.pointerEvents = 'none';
        
        this.scanStatus.textContent = 'Scanning font for all valid glyphs...';
        
        // Yield to UI render
        await new Promise(r => setTimeout(r, 50));
        
        const validChars = this._scanForChars(this.currentFont);
        
        this.charInput.value = validChars;
        this._updateSetting('customCharacters', validChars);
        
        this.scanStatus.textContent = `Scan complete. Found ${validChars.length} characters.`;
        this._renderGrid(); // Visual confirmation
    }

    _scanForChars(fontName) {
        const ranges = [
            [33, 126], // Basic Latin
            [161, 255], // Latin-1
            [1024, 1279], // Cyrillic
            [913, 969], // Greek
            [5792, 5887], // Runic
            [12353, 12447], // Hiragana
            [12448, 12543], // Katakana
            [65377, 65439] // Halfwidth Katakana
        ];
        
        let valid = "";
        
        // Get "tofu" or empty signature
        const emptySig = this._getCharSignature(fontName, '\uFFFF');
        const spaceSig = this._getCharSignature(fontName, ' ');

        for (const [start, end] of ranges) {
            for (let i = start; i <= end; i++) {
                const char = String.fromCharCode(i);
                const sig = this._getCharSignature(fontName, char);
                
                // If distinct from empty/tofu, it's valid
                if (sig && sig !== emptySig && sig !== spaceSig) {
                    valid += char;
                }
            }
        }
        return valid;
    }
    
    _getCharSignature(fontName, char) {
        this.scanCtx.clearRect(0, 0, 20, 20);
        this.scanCtx.font = `16px "${fontName}"`;
        this.scanCtx.textBaseline = 'middle';
        this.scanCtx.textAlign = 'center';
        this.scanCtx.fillStyle = '#fff';
        this.scanCtx.fillText(char, 10, 10);
        
        // Get pixel data hash-ish
        const data = this.scanCtx.getImageData(5, 5, 10, 10).data; // Sample center 10x10
        let sum = 0;
        for(let i=3; i<data.length; i+=4) { // check alpha only
            sum += data[i];
        }
        return sum; // simple sum signature
    }

    _renderGrid() {
        this.charGrid.innerHTML = '';
        
        // Define grid ranges (subset of scan ranges for visual sanity)
        const ranges = [
            [33, 126], // ASCII
            [12448, 12543] // Katakana
        ];
        
        const currentSet = new Set(this.charInput.value.split(''));
        const emptySig = this._getCharSignature(this.currentFont, '\uFFFF');

        for (const [start, end] of ranges) {
            for (let i = start; i <= end; i++) {
                const char = String.fromCharCode(i);
                const sig = this._getCharSignature(this.currentFont, char);
                
                // If valid glyph
                if (sig && sig !== emptySig) {
                    const el = document.createElement('div');
                    el.className = 'char-grid-item';
                    el.textContent = char;
                    el.style.fontFamily = this.currentFont;
                    
                    if (currentSet.has(char)) el.classList.add('selected');
                    
                    el.onclick = () => {
                        if (this.useAllToggle.checked) return; // Locked
                        this._toggleChar(char);
                        el.classList.toggle('selected');
                    };
                    
                    this.charGrid.appendChild(el);
                }
            }
        }
    }

    _toggleChar(char) {
        let val = this.charInput.value;
        if (val.includes(char)) {
            val = val.replace(char, '');
        } else {
            val += char;
        }
        this.charInput.value = val;
        this._updateSetting('customCharacters', val);
    }

    _updateGridSelection() {
        const currentSet = new Set(this.charInput.value.split(''));
        Array.from(this.charGrid.children).forEach(el => {
            if (currentSet.has(el.textContent)) el.classList.add('selected');
            else el.classList.remove('selected');
        });
    }

    _updateSetting(key, value) {
        if (!this.currentFont) return;
        
        const allSettings = { ...this.config.get('fontSettings') };
        if (!allSettings[this.currentFont]) {
            allSettings[this.currentFont] = {};
        }
        
        allSettings[this.currentFont][key] = value;
        this.config.set('fontSettings', allSettings);
    }
}


