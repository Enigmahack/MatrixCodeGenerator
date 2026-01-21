class QuantizedEffectEditor {
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
        this.redoStack = [];
        
        // Optimization: Dirty Flags
        this.isDirty = true;
        this.lastHoverHash = "";
    }

    _decodeSequence(sequence) {
        if (!sequence || sequence.length === 0) return [[]];
        
        const OPS_INV = { 1: 'add', 2: 'rem', 3: 'addRect', 4: 'addLine', 5: 'remLine', 6: 'addSmart', 7: 'removeBlock' };
        
        const decodedSeq = [];
        for (const step of sequence) {
            const decodedStep = [];
            if (Array.isArray(step) && step.length > 0 && typeof step[0] === 'number') {
                let i = 0;
                while (i < step.length) {
                    const opCode = step[i++];
                    const opName = OPS_INV[opCode];
                    if (!opName) continue;
                    
                    let args = [];
                    if (opCode === 1 || opCode === 6 || opCode === 7) {
                        args = [step[i++], step[i++]];
                    } else if (opCode === 3) {
                        args = [step[i++], step[i++], step[i++], step[i++]];
                    } else if (opCode === 2 || opCode === 4 || opCode === 5) {
                        const x = step[i++];
                        const y = step[i++];
                        const mask = step[i++];
                        if (mask & 1) decodedStep.push({ op: opName, args: [x, y, 'N'] });
                        if (mask & 2) decodedStep.push({ op: opName, args: [x, y, 'S'] });
                        if (mask & 4) decodedStep.push({ op: opName, args: [x, y, 'E'] });
                        if (mask & 8) decodedStep.push({ op: opName, args: [x, y, 'W'] });
                        if (mask === 0 && opCode === 2) {
                             decodedStep.push({ op: 'rem', args: [x, y] });
                        }
                        continue; 
                    }
                    decodedStep.push({ op: opName, args: args });
                }
            } else {
                for (const opObj of step) {
                    if (Array.isArray(opObj)) {
                        decodedStep.push({ op: opObj[0], args: opObj.slice(1) });
                    } else {
                        decodedStep.push(opObj);
                    }
                }
            }
            decodedSeq.push(decodedStep);
        }
        return decodedSeq;
    }

    _switchEffect(effectName) {
        const newEffect = this.registry.get(effectName);
        if (!newEffect) return;

        if (this.effect === newEffect) return;

        // Deactivate old effect logic
        if (this.active && this.effect) {
             this.effect.active = false;
             this.effect.editorPreviewOp = null;
             if (this.effect.g) this.effect.g.clearAllOverrides();
        }

        // Disable all quantized effects to ensure a clean slate for the new one
        const qEffects = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom'];
        if (this.registry) {
            qEffects.forEach(name => {
                const eff = this.registry.get(name);
                if (eff) {
                    eff.active = false;
                    if (eff.state) eff.state = 'IDLE'; 
                    if (eff.g) eff.g.clearAllOverrides();
                }
            });
        }

        this.redoStack = [];
        this.effect = newEffect;
        
        // Activate new effect logic
        if (this.active) {
            this.effect.trigger(true); 
            
            // Robust loading: Ensure sequence is loaded from global Patterns if trigger didn't
            if ((!this.effect.sequence || this.effect.sequence.length <= 1) && window.matrixPatterns && window.matrixPatterns[this.effect.name]) {
                this.effect.sequence = window.matrixPatterns[this.effect.name];
            }

            // DECODE ON LOAD
            this.effect.sequence = this._decodeSequence(this.effect.sequence);

            this.effect.debugMode = true;
            this.effect.manualStep = true; 
            if (this.effect.expansionPhase >= this.effect.sequence.length) {
                this.effect.expansionPhase = this.effect.sequence.length - 1;
            }
            this.effect.refreshStep();
            this._updateUI(); 
            this.isDirty = true;
        }
    }

    toggle(isActive) {
        this.active = isActive;
        if (this.active) {
            const qEffects = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom'];
            if (this.registry) {
                qEffects.forEach(name => {
                    const eff = this.registry.get(name);
                    if (eff) {
                        eff.active = false;
                        if (eff.state) eff.state = 'IDLE'; 
                        if (eff.g) eff.g.clearAllOverrides();
                    }
                });
            }
        }

        if (this.active && this.effect) {
            this.redoStack = []; 
            this._createUI();
            this._createCanvas();
            this._attachListeners();
            
            this.effect.trigger(true); 
            
            if ((!this.effect.sequence || this.effect.sequence.length <= 1) && window.matrixPatterns && window.matrixPatterns[this.effect.name]) {
                this.effect.sequence = window.matrixPatterns[this.effect.name];
            }

            this.effect.sequence = this._decodeSequence(this.effect.sequence);
            
            this.effect.debugMode = true;
            this.effect.manualStep = true; 
            if (this.effect.expansionPhase >= this.effect.sequence.length) {
                this.effect.expansionPhase = this.effect.sequence.length - 1;
            }
            this.effect.refreshStep();
            this._updateUI(); 
            this.isDirty = true;
            this._renderLoop();
        } else {
            this._removeUI();
            this._removeCanvas();
            this._detachListeners();
            if (this.effect) {
                this.effect.active = false; 
                this.effect.debugMode = false; 
                this.effect.manualStep = false; 
                this.effect.editorPreviewOp = null; 
                if (this.effect.g) this.effect.g.clearAllOverrides();
            }
            this.selectionRect = null;
            this.redoStack = [];
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
        this.canvas.style.zIndex = '9000'; 
        this.canvas.style.pointerEvents = 'none'; 
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
        
        // Throttling: Only render if dirty or preview op exists (animations?)
        // If the effect is static in editor mode, we don't need to redraw unless input happens.
        if (!this.isDirty && !this.effect.editorPreviewOp) return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.isDirty = true; // Resize forces redraw
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, width, height);

        // 1. Render Actual Effect Preview (Base Layer)
        if (this.effect && typeof this.effect.renderEditorPreview === 'function') {
            this.effect.renderEditorPreview(ctx, this.effect.c.derived, this.effect.editorPreviewOp);
        }

        if (!this.effect.layout) return; 
        
        const l = this.effect.layout;
        const grid = this.effect.g;
        const blocksX = Math.ceil(grid.cols / l.cellPitchX);
        const blocksY = Math.ceil(grid.rows / l.cellPitchY);
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const startX = l.screenOriginX;
        const startY = l.screenOriginY;

        // 2. Render Background Grid (Overlay)
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

        // 3. Render Holes (Optimized Flood Fill)
        if (this.highlightChanges) {
            const logicGrid = this.effect.logicGrid;
            const lgW = this.effect.logicGridW;
            const lgH = this.effect.logicGridH;
            
            // Only re-calculate flood fill if step logic changed
            if (this.effect._maskDirty || !this._cachedExternalMask || this._cachedMaskW !== lgW) {
                const isExternal = new Uint8Array(lgW * lgH); 
                const queue = [];

                for (let x = 0; x < lgW; x++) { queue.push(x); queue.push((lgH - 1) * lgW + x); }
                for (let y = 1; y < lgH - 1; y++) { queue.push(y * lgW); queue.push(y * lgW + (lgW - 1)); }

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
                this._cachedExternalMask = isExternal;
                this._cachedMaskW = lgW;
            }

            ctx.save();
            ctx.fillStyle = 'rgba(128, 0, 128, 0.5)'; 
            const ext = this._cachedExternalMask;
            
            for (let y = 0; y < lgH; y++) {
                for (let x = 0; x < lgW; x++) {
                    const idx = y * lgW + x;
                    if (logicGrid[idx] === 0 && ext[idx] === 0) {
                        const rectX = startX + (x * l.cellPitchX * l.screenStepX);
                        const rectY = startY + (y * l.cellPitchY * l.screenStepY);
                        const rectW = l.cellPitchX * l.screenStepX;
                        const rectH = l.cellPitchY * l.screenStepY;
                        ctx.fillRect(rectX, rectY, rectW, rectH);
                    }
                }
            }
            ctx.restore();
        }

        // 4. Render Active Selection
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

        // 5. Render Paste Preview
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
        
        // Reset dirty flag after render
        this.isDirty = false;
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
        header.textContent = 'Quantized Effect Editor';
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
            
            const effects = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom'];
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

        // Block Size Controls
        const sizeControls = document.createElement('div');
        sizeControls.style.marginBottom = '10px';
        sizeControls.style.display = 'flex';
        sizeControls.style.alignItems = 'center';
        sizeControls.style.justifyContent = 'space-between';
        
        const lblSize = document.createElement('span');
        lblSize.textContent = 'Block Size:';
        
        const inpW = document.createElement('input');
        inpW.type = 'number';
        inpW.min = '1';
        inpW.max = '50';
        inpW.style.width = '40px';
        inpW.style.background = '#333';
        inpW.style.color = '#fff';
        inpW.style.border = '1px solid #555';
        
        const lblX = document.createElement('span');
        lblX.textContent = 'x';
        
        const inpH = document.createElement('input');
        inpH.type = 'number';
        inpH.min = '1';
        inpH.max = '50';
        inpH.style.width = '40px';
        inpH.style.background = '#333';
        inpH.style.color = '#fff';
        inpH.style.border = '1px solid #555';
        
        const btnSetSize = this._createBtn('Set', () => {
            this._changeBlockSize(parseInt(inpW.value), parseInt(inpH.value));
        });
        
        sizeControls.append(lblSize, inpW, lblX, inpH, btnSetSize);
        container.appendChild(sizeControls);
        
        this.inpBlockW = inpW;
        this.inpBlockH = inpH;

        // Speed Control
        const speedControls = document.createElement('div');
        speedControls.style.marginBottom = '10px';
        speedControls.style.display = 'flex';
        speedControls.style.alignItems = 'center';
        
        const lblSpeed = document.createElement('span');
        lblSpeed.textContent = 'Speed:';
        lblSpeed.style.marginRight = '10px';
        
        const inpSpeed = document.createElement('input');
        inpSpeed.type = 'number';
        inpSpeed.min = '0.1';
        inpSpeed.step = '0.1';
        inpSpeed.style.width = '50px';
        inpSpeed.style.background = '#333';
        inpSpeed.style.color = '#fff';
        inpSpeed.style.border = '1px solid #555';
        inpSpeed.style.marginRight = '10px';
        
        const btnSetSpeed = this._createBtn('Set', () => {
            if (this.effect) {
                const val = parseFloat(inpSpeed.value);
                this.effect.c.state[this.effect.configPrefix + 'Speed'] = isNaN(val) ? 1.0 : val;
                alert(`Speed set to ${val}`);
            }
        });
        
        speedControls.append(lblSpeed, inpSpeed, btnSetSpeed);

        // Duration Control
        const lblDur = document.createElement('span');
        lblDur.textContent = 'Duration (s):';
        lblDur.style.marginLeft = '15px';
        lblDur.style.marginRight = '10px';
        
        const inpDur = document.createElement('input');
        inpDur.type = 'number';
        inpDur.min = '0.5';
        inpDur.step = '0.5';
        inpDur.style.width = '50px';
        inpDur.style.background = '#333';
        inpDur.style.color = '#fff';
        inpDur.style.border = '1px solid #555';
        inpDur.style.marginRight = '10px';
        
        const btnSetDur = this._createBtn('Set', () => {
            if (this.effect) {
                const val = parseFloat(inpDur.value);
                this.effect.c.state[this.effect.configPrefix + 'DurationSeconds'] = isNaN(val) ? 5.0 : val;
                alert(`Duration set to ${val}s`);
            }
        });
        
        speedControls.append(lblDur, inpDur, btnSetDur);
        this.inpDuration = inpDur;

        container.appendChild(speedControls);
        this.inpSpeed = inpSpeed;

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
        addTool('cleanInternal', 'Clean Internal');
        
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
        checkbox.onchange = (e) => { this.highlightChanges = e.target.checked; this.isDirty = true; };
        colorToggle.append(checkbox, document.createTextNode(' Highlight Changes'));
        container.appendChild(colorToggle);

        const gridToggle = document.createElement('label');
        gridToggle.style.display = 'block';
        gridToggle.style.marginTop = '5px';
        const gridCheck = document.createElement('input');
        gridCheck.type = 'checkbox';
        gridCheck.checked = this.showGrid;
        gridCheck.onchange = (e) => { this.showGrid = e.target.checked; this.isDirty = true; };
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
        this.selectionRect = null; 
        if (tool !== 'paste') this.clipboard = null; 
        this._updateUI();
    }

    _selectFace(face) { this.currentFace = face; this._updateUI(); }

    _changeBlockSize(w, h) {
        if (!this.effect) return;
        if (isNaN(w) || w < 1) w = 4;
        if (isNaN(h) || h < 1) h = 4;
        
        const prefix = this.effect.configPrefix;
        this.effect.c.state[prefix + 'BlockWidthCells'] = w;
        this.effect.c.state[prefix + 'BlockHeightCells'] = h;
        
        // Re-init logic grid with new size
        const currentStep = this.effect.expansionPhase;
        this.effect._initLogicGrid(); 
        this.effect.jumpToStep(currentStep); 
        
        this.isDirty = true;
    }

    _updateUI() {
        if (!this.dom) return;
        
        if (this.effect && this.inpBlockW && this.inpBlockH) {
            const bs = this.effect.getBlockSize();
            this.inpBlockW.value = bs.w;
            this.inpBlockH.value = bs.h;
            
            if (this.inpSpeed) {
                const spd = this.effect.c.state[this.effect.configPrefix + 'Speed'];
                this.inpSpeed.value = (spd !== undefined) ? spd : 1.0;
            }
            
            if (this.inpDuration) {
                const dur = this.effect.c.state[this.effect.configPrefix + 'DurationSeconds'];
                this.inpDuration.value = (dur !== undefined) ? dur : 5.0;
            }
        }

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
        this.redoStack = [];
        let newStep = this.effect.expansionPhase + delta;
        if (newStep < 0) newStep = 0;
        if (newStep >= this.effect.sequence.length) newStep = this.effect.sequence.length - 1;
        this.effect.expansionPhase = newStep;
        this.effect.jumpToStep(newStep); 
        this._updateUI();
        this.isDirty = true;
    }

    _addStep() {
        this.redoStack = [];
        const newStepIdx = this.effect.expansionPhase + 1;
        this.effect.sequence.splice(newStepIdx, 0, []); 
        this._changeStep(1);
    }

    _delStep() {
        if (this.effect.sequence.length <= 1) return;
        this.redoStack = [];
        this.effect.sequence.splice(this.effect.expansionPhase, 1);
        this._changeStep(0); 
    }

    _exportData() {
        const encoded = this._encodeSequence(this.effect.sequence);
        const json = JSON.stringify(encoded);
        navigator.clipboard.writeText(json).then(() => { alert('Sequence data copied to clipboard (Compressed)!'); });
    }

    _savePattern() {
        const effectsToSave = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom'];
        const fullPatterns = window.matrixPatterns || {};

        effectsToSave.forEach(effName => {
            const eff = this.registry.get(effName);
            if (!eff) return;

            let sequenceToSave = eff.sequence;
            const isInstanceEmpty = (!sequenceToSave || sequenceToSave.length === 0 || (sequenceToSave.length === 1 && sequenceToSave[0].length === 0));
            const globalData = (window.matrixPatterns && window.matrixPatterns[effName]);
            const hasGlobalData = globalData && globalData.length > 0;

            if (isInstanceEmpty && hasGlobalData) {
                return;
            }

            if (!sequenceToSave) return;

            let isDecoded = false;
            for (const step of sequenceToSave) {
                if (step && step.length > 0) {
                    if (typeof step[0] === 'object') {
                        isDecoded = true;
                    }
                    break;
                }
            }

            if (isDecoded) {
                sequenceToSave = this._encodeSequence(sequenceToSave);
            }

            fullPatterns[effName] = sequenceToSave;
        });
        
        if (typeof window.require !== 'undefined') {
            try {
                const { ipcRenderer } = window.require('elec' + 'tron');
                ipcRenderer.send('save-patterns', fullPatterns);
                alert('Patterns saved to disk successfully!');
                return;
            } catch (e) {
                console.warn("IPC Save failed, falling back to download:", e);
            }
        }
        
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

    _encodeSequence(sequence) {
        const OPS = { 'add': 1, 'rem': 2, 'addRect': 3, 'addLine': 4, 'remLine': 5, 'addSmart': 6, 'removeBlock': 7 };
        const FACES = { 'N': 1, 'n': 1, 'S': 2, 's': 2, 'E': 4, 'e': 4, 'W': 8, 'w': 8 };
        
        const packedSequence = [];
        for (const step of sequence) {
            const stepData = [];
            for (const opObj of step) {
                let opName, args;
                if (Array.isArray(opObj)) {
                    if (typeof opObj[0] === 'number') {
                        stepData.push(...opObj);
                        continue;
                    }
                    opName = opObj[0];
                    args = opObj.slice(1);
                } else {
                    opName = opObj.op;
                    args = opObj.args;
                }

                const opCode = OPS[opName];
                if (!opCode) continue;

                stepData.push(opCode);
                if (opCode === 1 || opCode === 6 || opCode === 7) {
                    stepData.push(args[0], args[1]);
                } else if (opCode === 3) {
                    stepData.push(args[0], args[1], args[2], args[3]);
                } else if (opCode === 2 || opCode === 4 || opCode === 5) {
                    stepData.push(args[0], args[1]);
                    let mask = 0;
                    if (args.length > 2 && typeof args[2] === 'string') {
                        mask = FACES[args[2].toUpperCase()] || 0;
                    } else if (typeof args[2] === 'number') {
                         mask = args[2];
                    }
                    stepData.push(mask);
                }
            }
            packedSequence.push(stepData);
        }
        return packedSequence;
    }


    _undo() {
        const step = this.effect.sequence[this.effect.expansionPhase];
        if (step && step.length > 0) { 
            const op = step.pop(); 
            this.redoStack.push(op);
            this.effect.refreshStep(); 
            this.isDirty = true;
        }
    }

    _redo() {
        const step = this.effect.sequence[this.effect.expansionPhase];
        if (this.redoStack.length > 0) {
            const op = this.redoStack.pop();
            step.push(op);
            this.effect.refreshStep();
            this.isDirty = true;
        }
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
        this.redoStack = [];
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
        if (count > 0) {
            this.effect.refreshStep();
            this.isDirty = true;
        }
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
        this.redoStack = [];
        const step = this.effect.sequence[this.effect.expansionPhase];
        for (const pt of this.clipboard.data) {
            step.push({ op: 'add', args: [targetX + pt.x, targetY + pt.y] });
        }
        this.effect.refreshStep();
        this.isDirty = true;
    }

    _cleanInternalLines() {
        if (!this.effect) return;
        
        // Ensure state is up to date
        this.effect._updateRenderGridLogic();
        const blocksX = this.effect.logicGridW;
        const blocksY = this.effect.logicGridH;
        
        // Force distance map re-calculation
        this.effect._distMapDirty = true;
        const distMap = this.effect._computeDistanceField(blocksX, blocksY);
        const grid = this.effect.renderGrid;
        
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        const step = this.effect.sequence[this.effect.expansionPhase];
        let count = 0;
        
        for (let i = 0; i < grid.length; i++) {
            if (grid[i] !== -1 && distMap[i] > 4) {
                const bx = i % blocksX;
                const by = Math.floor(i / blocksX);
                const rx = bx - cx; // Convert to relative coordinates
                const ry = by - cy;
                
                // Add removal for all faces
                step.push({ op: 'remLine', args: [rx, ry, 'N'] });
                step.push({ op: 'remLine', args: [rx, ry, 'S'] });
                step.push({ op: 'remLine', args: [rx, ry, 'E'] });
                step.push({ op: 'remLine', args: [rx, ry, 'W'] });
                count++;
            }
        }
        
        if (count > 0) {
            this.effect.refreshStep();
            this.isDirty = true;
            alert(`Cleaned internal lines for ${count} blocks.`);
        } else {
            alert("No internal blocks > 4 distance found.");
        }
    }

    _onKeyDown(e) {
        if (!this.active) return;
        
        // Shortcuts
        if ((e.ctrlKey || e.metaKey)) {
            if (e.key === 'c') { e.preventDefault(); this._copySelection(); return; }
            if (e.key === 'x') { e.preventDefault(); this._cutSelection(); return; }
            if (e.key === 'v') { e.preventDefault(); this._startPaste(); return; }
            if (e.key === 'z') { e.preventDefault(); this._undo(); return; }
            if (e.key === 'y') { e.preventDefault(); this._redo(); return; }
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
        
        // Optimize: Check if hover changed
        const hoverHash = hit ? `${hit.x},${hit.y}` : "null";
        
        if (this.currentTool === 'addRect' || this.currentTool === 'select') {
            if (this.dragStart && hit) {
                // Update Preview op for drawing
                this.effect.editorPreviewOp = {
                    op: 'addRect',
                    args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y]
                };
                this.isDirty = true; // Dragging requires redraw
            } else {
                if (this.effect.editorPreviewOp) {
                    this.effect.editorPreviewOp = null;
                    this.isDirty = true;
                }
            }
        }
        
        if (hoverHash !== this.lastHoverHash) {
            this.lastHoverHash = hoverHash;
            if (hit) {
                this.hoverBlock = hit;
            } else {
                this.hoverBlock = null;
            }
            // If dragging, we already set dirty. If not dragging, we might need dirty for cursor highlight?
            // Editor doesn't draw cursor highlight unless pasting.
            if (this.currentTool === 'paste') this.isDirty = true;
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

            if (this.currentTool === 'cleanInternal') {
                this._cleanInternalLines();
                this.currentTool = 'select'; // Reset tool
                this._updateUI();
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
                this.redoStack = [];
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
                this.isDirty = true;
            }
        }
    }

    _onMouseUp(e) {
        if (!this.active) return;
        
        if (this.dragStart) {
            const hit = this.effect.hitTest(e.clientX, e.clientY);
            if (hit) {
                if (this.currentTool === 'addRect') {
                    this.redoStack = [];
                    const step = this.effect.sequence[this.effect.expansionPhase];
                    step.push({ op: 'addRect', args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y] });
                    this.effect.refreshStep();
                    this.isDirty = true;
                } else if (this.currentTool === 'select') {
                    // Define Selection Rect
                    const x1 = Math.min(this.dragStart.x, hit.x);
                    const y1 = Math.min(this.dragStart.y, hit.y);
                    const x2 = Math.max(this.dragStart.x, hit.x);
                    const y2 = Math.max(this.dragStart.y, hit.y);
                    this.selectionRect = { x: x1, y: y1, w: x2-x1, h: y2-y1 };
                    this.isDirty = true;
                }
            }
            this.dragStart = null;
            this.effect.editorPreviewOp = null;
            this.isDirty = true; // Ensure preview cleared
        }
    }
}