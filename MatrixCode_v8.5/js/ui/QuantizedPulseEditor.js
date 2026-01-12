class QuantizedPulseEditor {
    constructor(registry, uimanager) {
        this.registry = registry;
        this.ui = uimanager;
        // Default to Pulse if available
        this.effect = this.registry ? this.registry.get('QuantizedPulse') : null;
        
        this.active = false;
        this.dom = null;
        this.currentTool = 'add'; 
        this.currentFace = 'N'; 
        this.hoverBlock = null;

        this._boundMouseDown = this._onMouseDown.bind(this);
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundMouseUp = this._onMouseUp.bind(this);
        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundRender = this._renderLoop.bind(this);
        
        this.dragStart = null;
        this.showGrid = false; 
        this.highlightChanges = true; 
        this.canvas = null;
        this.ctx = null;

        this.selectionRect = null;
        this.clipboard = null;
    }

    _switchEffect(effectName) {
        const newEffect = this.registry.get(effectName);
        if (!newEffect) return;

        if (this.effect === newEffect) return;

        // Deactivate old effect logic
        if (this.active && this.effect) {
             this.effect.active = false;
             this.effect.editorPreviewOp = null;
        }

        this.effect = newEffect;

        // Activate new effect logic
        if (this.active) {
            this.effect.trigger(true); 
            this.effect.debugMode = true;
            this.effect.manualStep = true; 
            if (this.effect.expansionPhase >= this.effect.sequence.length) {
                this.effect.expansionPhase = this.effect.sequence.length - 1;
            }
            this.effect.refreshStep();
            this._updateUI(); // Refresh UI labels
        }
    }

    toggle(isActive) {
        this.active = isActive;
        if (this.active && this.effect) {
            this._createUI();
            this._createCanvas();
            this._attachListeners();
            // Force effect to be active and paused for editing
            this.effect.trigger(true); 
            this.effect.debugMode = true;
            this.effect.manualStep = true; 
            // Ensure we are at a valid step
            if (this.effect.expansionPhase >= this.effect.sequence.length) {
                this.effect.expansionPhase = this.effect.sequence.length - 1;
            }
            this.effect.refreshStep();
            this._renderLoop();
        } else {
            this._removeUI();
            this._removeCanvas();
            this._detachListeners();
            if (this.effect) {
                this.effect.active = false; 
                this.effect.debugMode = false; // Reset debug mode
                this.effect.manualStep = false; // Reset manual stepping
                this.effect.editorPreviewOp = null; 
            }
            this.selectionRect = null;
        }
    }

    _createCanvas() {
        if (this.canvas) return;
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'quant-editor-canvas';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '9000'; // Below UI, above Matrix
        this.canvas.style.pointerEvents = 'none'; // Let events pass to window listeners
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }

    _removeCanvas() {
        if (this.canvas) {
            document.body.removeChild(this.canvas);
            this.canvas = null;
            this.ctx = null;
        }
    }

    _renderLoop() {
        if (!this.active) return;
        this._render();
        requestAnimationFrame(this._boundRender);
    }

    _render() {
        if (!this.canvas || !this.ctx) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, width, height);

        if (!this.effect.layout) return; 
        
        const l = this.effect.layout;
        // Dynamically calculate grid metrics to ensure they match current layout/grid
        const grid = this.effect.g;
        const blocksX = Math.ceil(grid.cols / l.cellPitchX);
        const blocksY = Math.ceil(grid.rows / l.cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const startX = l.screenOriginX;
        const startY = l.screenOriginY;

        // Render Background Grid
        if (this.showGrid) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; 
            ctx.lineWidth = 1;
            ctx.beginPath();

            // Draw verticals
            for (let bx = 0; bx <= blocksX; bx++) {
                const x = startX + (bx * l.cellPitchX * l.screenStepX);
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
            }
            // Draw horizontals
            for (let by = 0; by <= blocksY; by++) {
                const y = startY + (by * l.cellPitchY * l.screenStepY);
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
            ctx.stroke();
            
            // Highlight Center Block
            const centerX = startX + (cx * l.cellPitchX * l.screenStepX);
            const centerY = startY + (cy * l.cellPitchY * l.screenStepY);
            
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.fillRect(centerX, centerY, l.cellPitchX * l.screenStepX, l.cellPitchY * l.screenStepY);

            ctx.restore();
        }

        if (!this.highlightChanges) return;

        // Render Holes (Flood Fill)
        const logicGrid = this.effect.logicGrid;
        const lgW = this.effect.logicGridW;
        const lgH = this.effect.logicGridH;
        
        ctx.save();
        ctx.fillStyle = 'rgba(128, 0, 128, 0.5)'; // Purple for holes
        
        // 1. Identify External Empty Space via BFS
        const isExternal = new Uint8Array(lgW * lgH); // 0=Unknown, 1=External
        const queue = [];

        // Seed edges
        for (let x = 0; x < lgW; x++) {
            queue.push(x); // Top edge
            queue.push((lgH - 1) * lgW + x); // Bottom edge
        }
        for (let y = 1; y < lgH - 1; y++) {
            queue.push(y * lgW); // Left edge
            queue.push(y * lgW + (lgW - 1)); // Right edge
        }

        let head = 0;
        while(head < queue.length) {
            const idx = queue[head++];
            if (isExternal[idx] || logicGrid[idx] === 1) continue;
            isExternal[idx] = 1; 
            const x = idx % lgW;
            const y = Math.floor(idx / lgW);
            if (x > 0) queue.push(idx - 1);
            if (x < lgW - 1) queue.push(idx + 1);
            if (y > 0) queue.push(idx - lgW);
            if (y < lgH - 1) queue.push(idx + lgW);
        }

        // 2. Render Internal Empty Space (Holes)
        for (let y = 0; y < lgH; y++) {
            for (let x = 0; x < lgW; x++) {
                const idx = y * lgW + x;
                if (logicGrid[idx] === 0 && isExternal[idx] === 0) {
                    const rectX = startX + (x * l.cellPitchX * l.screenStepX);
                    const rectY = startY + (y * l.cellPitchY * l.screenStepY);
                    const rectW = l.cellPitchX * l.screenStepX;
                    const rectH = l.cellPitchY * l.screenStepY;
                    ctx.fillRect(rectX, rectY, rectW, rectH);
                }
            }
        }
        ctx.restore();

        // Render Active Selection
        if (this.selectionRect) {
            ctx.save();
            const minX = this.selectionRect.x + cx;
            const minY = this.selectionRect.y + cy;
            const w = this.selectionRect.w;
            const h = this.selectionRect.h;
            
            const selX = startX + (minX * l.cellPitchX * l.screenStepX);
            const selY = startY + (minY * l.cellPitchY * l.screenStepY);
            const selW = (w + 1) * l.cellPitchX * l.screenStepX;
            const selH = (h + 1) * l.cellPitchY * l.screenStepY;
            
            ctx.strokeStyle = '#0088FF';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(selX, selY, selW, selH);
            ctx.fillStyle = 'rgba(0, 136, 255, 0.1)';
            ctx.fillRect(selX, selY, selW, selH);
            ctx.restore();
        }

        // Render Paste Preview
        if (this.currentTool === 'paste' && this.clipboard && this.hoverBlock) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            const ox = this.hoverBlock.x + cx;
            const oy = this.hoverBlock.y + cy;
            
            for (const pt of this.clipboard.data) {
                const rectX = startX + ((ox + pt.x) * l.cellPitchX * l.screenStepX);
                const rectY = startY + ((oy + pt.y) * l.cellPitchY * l.screenStepY);
                const rectW = l.cellPitchX * l.screenStepX;
                const rectH = l.cellPitchY * l.screenStepY;
                ctx.fillRect(rectX, rectY, rectW, rectH);
            }
            ctx.restore();
        }

        // Render Operations
        const step = this.effect.sequence[this.effect.expansionPhase];
        const opsToRender = step ? [...step] : [];
        if (this.effect.editorPreviewOp) {
            opsToRender.push(this.effect.editorPreviewOp);
        }

        if (opsToRender.length === 0) return;

        ctx.save();
        ctx.globalAlpha = 0.8;

        for (const opData of opsToRender) {
             let op, args;
             if (Array.isArray(opData)) {
                 op = opData[0];
                 args = opData.slice(1);
             } else {
                 op = opData.op;
                 args = opData.args;
             }
             
             ctx.beginPath();
             if (op === 'add' || op === 'addSmart' || op === 'addRect') {
                 ctx.strokeStyle = '#00FF00'; 
                 ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
             } else {
                 ctx.strokeStyle = '#FF0000'; 
                 ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
             }
             
             if (opData === this.effect.editorPreviewOp) {
                 ctx.strokeStyle = (this.currentTool === 'select') ? '#0088FF' : '#FFFF00'; 
                 ctx.setLineDash([5, 5]);
             } else {
                 ctx.setLineDash([]);
             }
             
             ctx.lineWidth = 2;

             let x1, y1, x2, y2;
             if (op === 'addRect') {
                 x1 = args[0]; y1 = args[1]; x2 = args[2]; y2 = args[3];
             } else {
                 x1 = args[0]; y1 = args[1]; x2 = args[0]; y2 = args[1];
             }
             
             const minX = Math.min(x1, x2) + cx;
             const maxX = Math.max(x1, x2) + cx;
             const minY = Math.min(y1, y2) + cy;
             const maxY = Math.max(y1, y2) + cy;
             
             const rectX = startX + (minX * l.cellPitchX * l.screenStepX);
             const rectY = startY + (minY * l.cellPitchY * l.screenStepY);
             const rectW = ((maxX - minX + 1) * l.cellPitchX * l.screenStepX);
             const rectH = ((maxY - minY + 1) * l.cellPitchY * l.screenStepY);
             
             ctx.rect(rectX, rectY, rectW, rectH);
             ctx.fill();
             ctx.stroke();
        }
        ctx.restore();
    }

    _createUI() {
        if (this.dom) return;

        const container = document.createElement('div');
        container.id = 'quant-editor-ui';
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.left = '10px';
        container.style.zIndex = '10000';
        container.style.background = 'rgba(0, 0, 0, 0.8)';
        container.style.border = '1px solid #0f0';
        container.style.padding = '10px';
        container.style.color = '#0f0';
        container.style.fontFamily = 'monospace';
        container.style.userSelect = 'none';
        container.style.cursor = 'default';

        const header = document.createElement('div');
        header.textContent = 'Quantized Pulse Editor';
        header.style.marginBottom = '10px';
        header.style.fontWeight = 'bold';
        header.style.cursor = 'move';
        header.style.background = '#222';
        header.style.padding = '5px';
        header.style.borderBottom = '1px solid #0f0';
        container.appendChild(header);
        
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        header.onmousedown = (e) => {
            isDragging = true;
            dragOffsetX = e.clientX - container.offsetLeft;
            dragOffsetY = e.clientY - container.offsetTop;
            e.preventDefault(); 
        };
        const onGlobalMouseMove = (e) => {
            if (isDragging) {
                container.style.left = (e.clientX - dragOffsetX) + 'px';
                container.style.top = (e.clientY - dragOffsetY) + 'px';
            }
        };
        const onGlobalMouseUp = () => { isDragging = false; };
        window.addEventListener('mousemove', onGlobalMouseMove);
        window.addEventListener('mouseup', onGlobalMouseUp);
        this._cleanupDrag = () => {
            window.removeEventListener('mousemove', onGlobalMouseMove);
            window.removeEventListener('mouseup', onGlobalMouseUp);
        };

        // Effect Selector
        if (this.registry) {
            const effectSelect = document.createElement('select');
            effectSelect.style.width = '100%';
            effectSelect.style.marginBottom = '10px';
            effectSelect.style.background = '#333';
            effectSelect.style.color = '#0f0';
            effectSelect.style.border = '1px solid #0f0';
            
            const effects = ['QuantizedPulse', 'QuantizedExpansion', 'QuantizedRetract', 'QuantizedAdd'];
            effects.forEach(effName => {
                if (this.registry.get(effName)) {
                    const opt = document.createElement('option');
                    opt.value = effName;
                    opt.textContent = effName;
                    if (this.effect && this.effect.name === effName) opt.selected = true;
                    effectSelect.appendChild(opt);
                }
            });
            effectSelect.onchange = (e) => this._switchEffect(e.target.value);
            container.appendChild(effectSelect);
        }

        const stepControls = document.createElement('div');
        stepControls.style.marginBottom = '10px';
        const btnPrev = this._createBtn('<', () => this._changeStep(-1));
        const btnNext = this._createBtn('>', () => this._changeStep(1));
        const btnAddStep = this._createBtn('+', () => this._addStep());
        const btnDelStep = this._createBtn('-', () => this._delStep());
        this.stepLabel = document.createElement('span');
        this.stepLabel.style.margin = '0 10px';
        this.stepLabel.textContent = `Step: 0`;
        stepControls.append(btnPrev, this.stepLabel, btnNext, document.createTextNode(' '), btnAddStep, btnDelStep);
        container.appendChild(stepControls);

        // Edit Actions (Copy/Paste)
        const editControls = document.createElement('div');
        editControls.style.marginBottom = '10px';
        editControls.style.display = 'grid';
        editControls.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
        editControls.style.gap = '5px';
        const btnCopy = this._createBtn('Copy', () => this._copySelection());
        const btnCut = this._createBtn('Cut', () => this._cutSelection());
        const btnPaste = this._createBtn('Paste', () => this._startPaste());
        const btnDelSel = this._createBtn('Del', () => this._deleteSelection());
        editControls.append(btnCopy, btnCut, btnPaste, btnDelSel);
        container.appendChild(editControls);

        const toolControls = document.createElement('div');
        toolControls.style.marginBottom = '10px';
        toolControls.style.display = 'grid';
        toolControls.style.gridTemplateColumns = '1fr 1fr';
        toolControls.style.gap = '5px';

        this.tools = {};
        const addTool = (id, label) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.background = '#333';
            btn.style.color = '#fff';
            btn.style.border = '1px solid #555';
            btn.style.cursor = 'pointer';
            btn.style.padding = '2px 5px';
            btn.onclick = () => this._selectTool(id);
            toolControls.appendChild(btn);
            this.tools[id] = btn;
        };

        addTool('select', 'Select');
        addTool('add', 'Add Block');
        addTool('removeBlock', 'Rem Block');
        addTool('addLine', 'Add Line');
        addTool('removeLine', 'Rem Line');
        addTool('addRect', 'Add Rect');
        addTool('addSmart', 'Add Smart');
        
        container.appendChild(toolControls);

        const faceControls = document.createElement('div');
        faceControls.id = 'face-controls';
        faceControls.style.marginBottom = '10px';
        ['N', 'S', 'E', 'W'].forEach(f => {
            const btn = this._createBtn(f, () => this._selectFace(f));
            faceControls.appendChild(btn);
            if (!this.faceBtns) this.faceBtns = {};
            this.faceBtns[f] = btn;
        });
        container.appendChild(faceControls);

        const colorToggle = document.createElement('label');
        colorToggle.style.display = 'block';
        colorToggle.style.marginTop = '5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.highlightChanges;
        checkbox.onchange = (e) => { this.highlightChanges = e.target.checked; };
        colorToggle.append(checkbox, document.createTextNode(' Highlight Changes'));
        container.appendChild(colorToggle);

        const gridToggle = document.createElement('label');
        gridToggle.style.display = 'block';
        gridToggle.style.marginTop = '5px';
        const gridCheck = document.createElement('input');
        gridCheck.type = 'checkbox';
        gridCheck.checked = this.showGrid;
        gridCheck.onchange = (e) => { this.showGrid = e.target.checked; };
        gridToggle.append(gridCheck, document.createTextNode(' Show Grid'));
        container.appendChild(gridToggle);
        
        const btnExport = this._createBtn('Copy Data', () => this._exportData());
        btnExport.style.marginTop = '10px';
        btnExport.style.width = '48%';
        container.appendChild(btnExport);

        const btnSave = this._createBtn('Save Pattern', () => this._savePattern());
        btnSave.style.marginTop = '10px';
        btnSave.style.width = '48%';
        btnSave.style.marginLeft = '4%';
        container.appendChild(btnSave);

        const legend = document.createElement('div');
        legend.style.marginTop = '10px';
        legend.style.fontSize = '12px';
        legend.style.background = 'rgba(0,0,0,0.5)';
        legend.style.padding = '5px';
        legend.innerHTML = `
            <div style="display:flex;align-items:center;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;background:rgba(0,255,0,0.5);margin-right:5px;border:1px solid #0f0;"></span>Add</div>
            <div style="display:flex;align-items:center;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;background:rgba(255,0,0,0.5);margin-right:5px;border:1px solid #f00;"></span>Remove</div>
            <div style="display:flex;align-items:center;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;background:rgba(128,0,128,0.5);margin-right:5px;"></span>Hole</div>
            <div style="display:flex;align-items:center;"><span style="display:inline-block;width:10px;height:10px;background:none;border:1px dashed #0088FF;margin-right:5px;"></span>Selection</div>
        `;
        container.appendChild(legend);

        document.body.appendChild(container);
        this.dom = container;
        this._updateUI();
    }

    _removeUI() {
        if (this.dom) { document.body.removeChild(this.dom); this.dom = null; }
        if (this._cleanupDrag) { this._cleanupDrag(); this._cleanupDrag = null; }
    }

    _createBtn(text, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.marginRight = '5px';
        btn.style.background = '#333';
        btn.style.color = '#fff';
        btn.style.border = '1px solid #555';
        btn.style.cursor = 'pointer';
        btn.onclick = onClick;
        return btn;
    }

    _attachListeners() {
        window.addEventListener('mousedown', this._boundMouseDown);
        window.addEventListener('mousemove', this._boundMouseMove);
        window.addEventListener('mouseup', this._boundMouseUp);
        window.addEventListener('keydown', this._boundKeyDown);
    }

    _detachListeners() {
        window.removeEventListener('mousedown', this._boundMouseDown);
        window.removeEventListener('mousemove', this._boundMouseMove);
        window.removeEventListener('mouseup', this._boundMouseUp);
        window.removeEventListener('keydown', this._boundKeyDown);
    }

    _selectTool(tool) {
        this.currentTool = tool;
        this.selectionRect = null; // Clear selection on tool change
        if (tool !== 'paste') this.clipboard = null; // Maybe keep clipboard? No, let's keep it.
        this._updateUI();
    }

    _selectFace(face) { this.currentFace = face; this._updateUI(); }

    _updateUI() {
        if (!this.dom) return;
        this.stepLabel.textContent = `Step: ${this.effect.expansionPhase} / ${this.effect.sequence.length - 1}`;
        for (const t in this.tools) {
            this.tools[t].style.background = (t === this.currentTool) ? '#00aa00' : '#333';
        }
        const showFaces = (this.currentTool === 'addLine' || this.currentTool === 'removeLine');
        document.getElementById('face-controls').style.display = showFaces ? 'block' : 'none';
        if (showFaces) {
            for (const f in this.faceBtns) {
                this.faceBtns[f].style.background = (f === this.currentFace) ? '#00aa00' : '#333';
            }
        }
    }

    _changeStep(delta) {
        let newStep = this.effect.expansionPhase + delta;
        if (newStep < 0) newStep = 0;
        if (newStep >= this.effect.sequence.length) newStep = this.effect.sequence.length - 1;
        this.effect.expansionPhase = newStep;
        this.effect.jumpToStep(newStep); 
        this._updateUI();
    }

    _addStep() {
        const newStepIdx = this.effect.expansionPhase + 1;
        this.effect.sequence.splice(newStepIdx, 0, []); 
        this._changeStep(1);
    }

    _delStep() {
        if (this.effect.sequence.length <= 1) return;
        this.effect.sequence.splice(this.effect.expansionPhase, 1);
        this._changeStep(0); 
    }

    _exportData() {
        const json = JSON.stringify(this.effect.sequence);
        navigator.clipboard.writeText(json).then(() => { alert('Sequence data copied to clipboard!'); });
    }

    _savePattern() {
        if (!this.effect) return;
        const patternName = this.effect.name;
        const sequence = this.effect.sequence;
        
        // Update global object
        const fullPatterns = window.matrixPatterns || {};
        fullPatterns[patternName] = sequence;
        
        // Try Electron IPC first
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.send('save-patterns', fullPatterns);
                alert('Patterns saved to disk successfully!');
                return;
            } catch (e) {
                console.warn("IPC Save failed, falling back to download:", e);
            }
        }
        
        // Generate JS content matching the file structure we created
        const jsonContent = JSON.stringify(fullPatterns, null, 4);
        const jsContent = `window.matrixPatterns = ${jsonContent};`;
        
        const blob = new Blob([jsContent], {type: 'application/javascript'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'QuantizedPatterns.js';
        a.click();
        URL.revokeObjectURL(url);
    }

    _undo() {
        const step = this.effect.sequence[this.effect.expansionPhase];
        if (step && step.length > 0) { step.pop(); this.effect.refreshStep(); }
    }

    // CLIPBOARD OPERATIONS
    _copySelection() {
        if (!this.selectionRect) return;
        const grid = this.effect.logicGrid;
        const w = this.effect.logicGridW;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(this.effect.logicGridH / 2);
        
        const r = this.selectionRect;
        const data = [];
        
        console.log(`Copying Selection: Rect=${JSON.stringify(r)}, GridW=${w}, GridH=${this.effect.logicGridH}, CX=${cx}, CY=${cy}`);

        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                const idx = (y+cy) * w + (x+cx);
                if (grid[idx] === 1) {
                    data.push({ x: x - r.x, y: y - r.y });
                }
            }
        }
        this.clipboard = { w: r.w, h: r.h, data: data };
        console.log("Copied", data.length, "blocks");
        alert(`Copied ${data.length} blocks!`);
    }

    _deleteSelection() {
        if (!this.selectionRect) return;
        const step = this.effect.sequence[this.effect.expansionPhase];
        const grid = this.effect.logicGrid;
        const w = this.effect.logicGridW;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(this.effect.logicGridH / 2);
        const r = this.selectionRect;

        let count = 0;
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                const idx = (y+cy) * w + (x+cx);
                if (grid[idx] === 1) {
                    step.push({ op: 'removeBlock', args: [x, y] });
                    count++;
                }
            }
        }
        if (count > 0) this.effect.refreshStep();
    }

    _cutSelection() {
        this._copySelection();
        this._deleteSelection();
    }

    _startPaste() {
        if (!this.clipboard || this.clipboard.data.length === 0) { alert("Clipboard empty"); return; }
        this.currentTool = 'paste';
        this._updateUI();
    }

    _commitPaste(targetX, targetY) {
        if (!this.clipboard) return;
        const step = this.effect.sequence[this.effect.expansionPhase];
        for (const pt of this.clipboard.data) {
            step.push({ op: 'add', args: [targetX + pt.x, targetY + pt.y] });
        }
        this.effect.refreshStep();
    }

    _onKeyDown(e) {
        if (!this.active) return;
        
        // Shortcuts
        if ((e.ctrlKey || e.metaKey)) {
            if (e.key === 'c') { e.preventDefault(); this._copySelection(); return; }
            if (e.key === 'x') { e.preventDefault(); this._cutSelection(); return; }
            if (e.key === 'v') { e.preventDefault(); this._startPaste(); return; }
            if (e.key === 'z') { e.preventDefault(); this._undo(); return; }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault(); this._deleteSelection(); return; 
        }

        if (e.key === 'ArrowRight') this._changeStep(1);
        if (e.key === 'ArrowLeft') this._changeStep(-1);
    }

    _onMouseMove(e) {
        if (!this.active) return;
        const hit = this.effect.hitTest(e.clientX, e.clientY);
        
        if (this.currentTool === 'addRect' || this.currentTool === 'select') {
            if (this.dragStart && hit) {
                // Update Preview op for drawing
                this.effect.editorPreviewOp = {
                    op: 'addRect',
                    args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y]
                };
            } else {
                this.effect.editorPreviewOp = null;
            }
        }
        
        if (hit) {
            this.hoverBlock = hit;
        } else {
            this.hoverBlock = null;
        }
    }

    _onMouseDown(e) {
        if (!this.active) return;
        
        const settingsPanel = document.getElementById('settingsPanel');
        const menuToggle = document.getElementById('menuToggle');
        if (this.dom.contains(e.target) || 
            (settingsPanel && settingsPanel.contains(e.target)) ||
            (menuToggle && menuToggle.contains(e.target))) {
            return;
        }

        const hit = this.effect.hitTest(e.clientX, e.clientY);
        if (hit) {
            if (this.currentTool === 'paste') {
                this._commitPaste(hit.x, hit.y);
                return;
            }

            if (this.currentTool === 'addRect' || this.currentTool === 'select') {
                this.dragStart = hit;
                return; // Wait for mouse up
            }

            // Apply Tool (Immediate tools) with Toggle Logic
            const dx = hit.x;
            const dy = hit.y;
            const step = this.effect.sequence[this.effect.expansionPhase];
            
            let opName = null;
            let args = null;

            if (this.currentTool === 'add') { opName = 'add'; args = [dx, dy]; } 
            else if (this.currentTool === 'addSmart') { opName = 'addSmart'; args = [dx, dy]; } 
            else if (this.currentTool === 'removeBlock') { opName = 'removeBlock'; args = [dx, dy]; } 
            else if (this.currentTool === 'addLine') { opName = 'addLine'; args = [dx, dy, this.currentFace]; } 
            else if (this.currentTool === 'removeLine') { opName = 'remLine'; args = [dx, dy, this.currentFace]; }

            if (opName) {
                const existingIdx = step.findIndex(o => {
                    let oOp, oArgs;
                    if (Array.isArray(o)) {
                        oOp = o[0];
                        oArgs = o.slice(1);
                    } else {
                        oOp = o.op;
                        oArgs = o.args;
                    }
                    
                    return oOp === opName && 
                    oArgs.length === args.length && 
                    oArgs.every((v, i) => v === args[i]);
                });
                if (existingIdx !== -1) { step.splice(existingIdx, 1); } 
                else { step.push({ op: opName, args: args }); }
                this.effect.refreshStep();
            }
        }
    }

    _onMouseUp(e) {
        if (!this.active) return;
        
        if (this.dragStart) {
            const hit = this.effect.hitTest(e.clientX, e.clientY);
            if (hit) {
                if (this.currentTool === 'addRect') {
                    const step = this.effect.sequence[this.effect.expansionPhase];
                    step.push({ op: 'addRect', args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y] });
                    this.effect.refreshStep();
                } else if (this.currentTool === 'select') {
                    // Define Selection Rect
                    const x1 = Math.min(this.dragStart.x, hit.x);
                    const y1 = Math.min(this.dragStart.y, hit.y);
                    const x2 = Math.max(this.dragStart.x, hit.x);
                    const y2 = Math.max(this.dragStart.y, hit.y);
                    this.selectionRect = { x: x1, y: y1, w: x2-x1, h: y2-y1 };
                }
            }
            this.dragStart = null;
            this.effect.editorPreviewOp = null;
        }
    }
}