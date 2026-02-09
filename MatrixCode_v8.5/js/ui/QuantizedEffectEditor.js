class QuantizedEffectEditor {
    constructor(registry, uimanager) {
        this.registry = registry;
        this.ui = uimanager;
        // Default to Pulse if available
        this.effect = this.registry ? this.registry.get('QuantizedPulse') : null;
        
        this.active = false;
        this.dom = null;
        this.currentTool = 'select'; 
        this.currentFace = 'N'; 
        this.currentLayer = 0; // 0, 1, 2
        this.layerColors = ['#0f0', '#0af', '#f0c']; // Green, Blue, Magenta
        this.hoverBlock = null;

        this._boundMouseDown = this._onMouseDown.bind(this);
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundMouseUp = this._onMouseUp.bind(this);
        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundWheel = this._onWheel.bind(this);
        this._boundRender = this._renderLoop.bind(this);
        
        this.dragStart = null;
        this.showGrid = false; 
        this.highlightChanges = true; 
        this.canvas = null;
        this.ctx = null;

        this.selectionRect = null;
        this.selectedBlocks = new Set(); // Set of "x,y" strings
        this.clipboard = null;
        this.redoStack = [];
        
        // Optimization: Dirty Flags
        this.isDirty = true;
        this.lastHoverHash = "";

        // Communication
        const params = new URLSearchParams(window.location.search);
        this.isStandalone = params.get('mode') === 'editor'; 
        this.channel = new BroadcastChannel('matrix-quant-editor');
        this.isPoppedOut = false; // Set to true on main window if standalone is open
        this.channel.onmessage = (e) => this._onRemoteMessage(e.data);

        if (this.isStandalone) {
            this._log("QuantizedEffectEditor: Running in Standalone Mode");
            // Delay initial sync slightly to ensure MatrixKernel has finished async registry init
            setTimeout(() => this._sendRemote({ type: 'requestSync' }), 100);
        } else {
            // Main window: check if an editor is already open
            this._sendRemote({ type: 'ping' });
        }
    }

    _onRemoteMessage(msg) {
        if (this.isStandalone) {
             if (msg.type === 'ping') {
                 this._sendRemote({ type: 'hello' });
                 this._sendRemote({ type: 'requestSync' });
                 return;
             }
             if (msg.type === 'sync') {
                 this._log(`[Editor-Remote] Sync Received. Tool: ${msg.tool}, Phase: ${msg.phase}, Ops: ${msg.currentStepOps ? msg.currentStepOps.length : 0}`);
                 if (msg.effectName) {
                     // Only switch if different to avoid reset
                     if (!this.effect || this.effect.name !== msg.effectName) {
                         this._switchEffect(msg.effectName);
                     }
                     
                     // Force sequence decoding if we have global data but the effect hasn't loaded it yet
                     if (this.effect && (!this.effect.sequence || this.effect.sequence.length <= 1) && window.matrixPatterns && window.matrixPatterns[this.effect.name]) {
                         this.effect.sequence = this._decodeSequence(window.matrixPatterns[this.effect.name]);
                     }
                 }
                 if (this.effect && msg.phase !== undefined) {
                     this.effect.expansionPhase = msg.phase;
                     this.effect.jumpToStep(msg.phase);
                 }
                 if (msg.tool) this.currentTool = msg.tool;
                 if (msg.face) this.currentFace = msg.face;
                 if (msg.layer !== undefined) this.currentLayer = msg.layer;
                 
                 if (msg.selectionRect) {
                     this.selectionRect = msg.selectionRect;
                 } else if (msg.selectionRect === null) {
                     this.selectionRect = null;
                 }

                 if (msg.selectedBlocks) {
                     this.selectedBlocks = new Set(msg.selectedBlocks);
                 } else if (msg.selectedBlocks === null) {
                     this.selectedBlocks.clear();
                 }

                 // Sync sequence data for current step if provided
                 if (msg.currentStepOps && this.effect) {
                     const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                     this.effect.sequence[targetIdx] = msg.currentStepOps;
                     this.effect.refreshStep();
                 }

                 this._updateUI();
                 this.isDirty = true;
             }
             return; 
        }
        
        // Main Window receives messages
        if (msg.type === 'ping') {
            this.isPoppedOut = true;
            this._removeUI();
            this._sendRemote({ 
                type: 'sync', 
                effectName: this.effect ? this.effect.name : null,
                phase: this.effect ? this.effect.expansionPhase : 0,
                tool: this.currentTool,
                face: this.currentFace,
                layer: this.currentLayer,
                selectionRect: this.selectionRect,
                selectedBlocks: this.selectedBlocks.size > 0 ? Array.from(this.selectedBlocks) : null
            });
            return;
        }
        if (msg.type === 'requestSync') {
            this.isPoppedOut = true;
            this._removeUI();
            this._sendRemote({ 
                type: 'sync', 
                effectName: this.effect ? this.effect.name : null,
                phase: this.effect ? this.effect.expansionPhase : 0,
                tool: this.currentTool,
                face: this.currentFace,
                layer: this.currentLayer,
                selectionRect: this.selectionRect,
                selectedBlocks: this.selectedBlocks.size > 0 ? Array.from(this.selectedBlocks) : null
            });
            return;
        }
        if (msg.type === 'hello') {
            this.isPoppedOut = true;
            this._removeUI(); // Hide local if remote opens
            return;
        }
        if (msg.type === 'bye') {
            this.isPoppedOut = false;
            if (this.active) this._createUI(); // Show local if remote closes
            return;
        }

        if (msg.type === 'sync') {
            if (msg.phase !== undefined && this.effect) {
                if (this.effect.expansionPhase !== msg.phase) {
                    this._log(`[Editor-Main] Syncing Phase: ${this.effect.expansionPhase} -> ${msg.phase}`);
                    this.effect.expansionPhase = msg.phase;
                    this.effect.refreshStep();
                }
            }
            if (msg.tool) this.currentTool = msg.tool;
            if (msg.face) this.currentFace = msg.face;
            if (msg.layer !== undefined) this.currentLayer = msg.layer;
            
            if (msg.selectionRect) {
                this.selectionRect = msg.selectionRect;
            } else if (msg.selectionRect === null) {
                this.selectionRect = null;
            }

            if (msg.selectedBlocks) {
                this.selectedBlocks = new Set(msg.selectedBlocks);
            } else if (msg.selectedBlocks === null) {
                this.selectedBlocks.clear();
            }

            // Sync sequence data for current step if provided
            if (msg.currentStepOps && this.effect) {
                const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                // console.log(`[Editor-Main] Syncing currentStepOps for step ${targetIdx}`);
                this.effect.sequence[targetIdx] = msg.currentStepOps;
                this.effect.refreshStep();
            }

            this.isDirty = true;
            return;
        }

        switch (msg.type) {
            case 'switchEffect': 
                this._log(`[Editor-Main] switchEffect: ${msg.effectName}`);
                this._switchEffect(msg.effectName); 
                break;
            case 'changeStep': this._changeStep(msg.delta); break;
            case 'addStep': this._addStep(); break;
            case 'delStep': this._delStep(); break;
            case 'resetSteps': this._resetSteps(); break;
            case 'selectTool': this._selectTool(msg.tool); break;
            case 'selectFace': this._selectFace(msg.face); break;
            case 'changeBlockSize': this._changeBlockSize(msg.w, msg.h); break;
            case 'setSpeed': 
                if (this.effect) {
                    this.effect.c.set(this.effect.configPrefix + 'Speed', msg.val);
                    this._updateUI();
                }
                break;
            case 'setDuration':
                if (this.effect) {
                    this.effect.c.set(this.effect.configPrefix + 'DurationSeconds', msg.val);
                    this._updateUI();
                }
                break;
            case 'setLayer': this.currentLayer = msg.layer; this.isDirty = true; this._updateUI(); break;
            case 'toggleHighlight': this.highlightChanges = msg.val; this.isDirty = true; break;
            case 'toggleGrid': this.showGrid = msg.val; this.isDirty = true; break;
            case 'toggleShadow': 
                if (this.effect) this.effect.c.set('layerEnableShadowWorld', msg.val); 
                this.isDirty = true; 
                break;
            case 'toggleRemovals':
                if (this.effect) this.effect.c.set('layerEnableEditorRemovals', msg.val); 
                this.isDirty = true; 
                break;
            case 'export': this._exportData(); break;
            case 'save': this._savePattern(); break;
            case 'clean': this._cleanInternalSequence(); break;
            case 'undo': this._undo(); break;
            case 'redo': this._redo(); break;
            case 'merge':
                if (this.effect) {
                    this._log(`[Editor-Main] Merge Command Received. MultiSelect: ${!!msg.multiSelect}, HasSelection: ${!!msg.selection}`);
                    this.redoStack = [];

                    // Ensure logic state is fully updated for this step before merge
                    if (typeof this.effect._updateRenderGridLogic === 'function') {
                        this.effect._updateRenderGridLogic();
                    }

                    const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                    const step = this.effect.sequence[targetIdx];
                    if (!step) {
                        this._error(`[Editor-Main] Merge failed: No step data found at targetIdx ${targetIdx}`);
                        break;
                    }
                    const originalOps = JSON.parse(JSON.stringify(step));

                    let count = 0;
                    if (msg.multiSelect && msg.selection) {
                        this._log(`[Editor-Main] Performing mergeBlocksAtStep with ${msg.selection.length} blocks at index ${targetIdx}`);
                        count = this.effect.mergeBlocksAtStep(msg.selection, targetIdx);
                    } else if (msg.selection) {
                        this._log(`[Editor-Main] Performing mergeSelectionAtStep with rect at index ${targetIdx}`);
                        count = this.effect.mergeSelectionAtStep(msg.selection, targetIdx);
                    } else {
                        this._log(`[Editor-Main] Performing flattenLayers at index ${targetIdx}`);
                        const layersToMerge = [1, 2]; // Default
                        count = this.effect.flattenLayers(layersToMerge, null, targetIdx);
                    }

                    this._log(`[Editor-Main] Merge complete. Blocks modified: ${count}`);

                    if (count > 0) {
                        const mergedOps = step.splice(0, step.length);
                        step.push({ 
                            op: 'group', 
                            ops: mergedOps, 
                            replacesStep: true, 
                            originalOps: originalOps,
                            label: 'Merge Layers (Remote)' 
                        });
                        this.ui.notifications.show(`${count} blocks merged into Layer 0 (Remote)`, 'success');
                    }
                    
                    this.effect.refreshStep();
                    this.isDirty = true;
                    this._updateUI(); // Added to refresh step counter
                    this._broadcastSync(); // Notify remote of updated sequence
                }
                break;
        }
    }

    _sendRemote(msg) {
        this.channel.postMessage(msg);
    }

    _log(...args) {
        if (this.ui.c.get('logErrors')) {
            console.log(...args);
        }
    }

    _warn(...args) {
        if (this.ui.c.get('logErrors')) {
            console.warn(...args);
        }
    }

    _error(...args) {
        if (this.ui.c.get('logErrors')) {
            console.error(...args);
        }
    }

    _broadcastSync() {
        if (!this.isStandalone && !this.isPoppedOut) return;
        
        const phase = this.effect ? this.effect.expansionPhase : 0;
        const targetIdx = Math.max(0, phase - 1);
        const currentStepOps = (this.effect && this.effect.sequence[targetIdx]) ? this.effect.sequence[targetIdx] : null;

        this._sendRemote({ 
            type: 'sync', 
            effectName: this.effect ? this.effect.name : null,
            phase: phase,
            tool: this.currentTool,
            face: this.currentFace,
            layer: this.currentLayer,
            selectionRect: this.selectionRect,
            selectedBlocks: this.selectedBlocks.size > 0 ? Array.from(this.selectedBlocks) : null,
            currentStepOps: currentStepOps
        });
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
                    
                    let args = [];
                    if (opCode === 1 || opCode === 6 || opCode === 7) {
                        args = [step[i++], step[i++]];
                    } else if (opCode === 3) {
                        args = [step[i++], step[i++], step[i++], step[i++]];
                    } else if (opCode === 8) { // addLayered
                        const x = step[i++];
                        const y = step[i++];
                        const l = step[i++];
                        decodedStep.push({ op: 'add', args: [x, y], layer: l });
                        continue;
                    } else if (opCode === 9) { // addRectLayered
                        const x1 = step[i++];
                        const y1 = step[i++];
                        const x2 = step[i++];
                        const y2 = step[i++];
                        const l = step[i++];
                        decodedStep.push({ op: 'addRect', args: [x1, y1, x2, y2], layer: l });
                        continue;
                    } else if (opCode === 10) { // addSmartLayered
                        const x = step[i++];
                        const y = step[i++];
                        const l = step[i++];
                        decodedStep.push({ op: 'addSmart', args: [x, y], layer: l });
                        continue;
                    } else if (opCode === 11) { // removeBlockLayered
                        const x = step[i++];
                        const y = step[i++];
                        const l = step[i++];
                        decodedStep.push({ op: 'removeBlock', args: [x, y], layer: l });
                        continue;
                    } else if (opCode === 12) { // nudge
                        const x = step[i++];
                        const y = step[i++];
                        const w = step[i++];
                        const h = step[i++];
                        const l = step[i++];
                        const fMask = step[i++];
                        const FACES_INV = { 1: 'N', 2: 'S', 4: 'E', 8: 'W' };
                        const face = FACES_INV[fMask] || 'N';
                        decodedStep.push({ op: 'nudge', args: [x, y, w, h, face], layer: l });
                        continue;
                    } else if (opCode === 2 || opCode === 4 || opCode === 5) {
                        const x = step[i++];
                        const y = step[i++];
                        let mask = step[i++];
                        
                        // Unpack Layer
                        const l = (mask >> 4) & 0x3; // Extract 2 bits
                        mask = mask & 0xF; // Clear layer bits
                        
                        if (mask & 1) decodedStep.push({ op: opName, args: [x, y, 'N'], layer: l });
                        if (mask & 2) decodedStep.push({ op: opName, args: [x, y, 'S'], layer: l });
                        if (mask & 4) decodedStep.push({ op: opName, args: [x, y, 'E'], layer: l });
                        if (mask & 8) decodedStep.push({ op: opName, args: [x, y, 'W'], layer: l });
                        if (mask === 0 && opCode === 2) {
                             decodedStep.push({ op: 'rem', args: [x, y], layer: l });
                        }
                        continue; 
                    }
                    decodedStep.push({ op: opName, args: args });
                }
            } else {
                for (const opObj of step) {
                    if (Array.isArray(opObj)) {
                        decodedStep.push({ op: opObj[0], args: opObj.slice(1) });
                    } else if (opObj && opObj.op === 'group' && opObj.ops) {
                        // Recursively decode group ops
                        const decodedGroup = { op: 'group', ops: [] };
                        // We wrap ops in a temporary step to reuse decode logic (shallow)
                        const tempResult = this._decodeSequence([opObj.ops]);
                        decodedGroup.ops = tempResult[0];
                        decodedStep.push(decodedGroup);
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
        if (this.isStandalone) {
            this._sendRemote({ type: 'switchEffect', effectName });
        }
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
        const qEffects = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom', 'QuantizedBlockGenerator'];
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
        this.selectionRect = null;
        this.selectedBlocks.clear();
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
            
            // Start at Step 1 if available
            this.effect.expansionPhase = Math.min(1, this.effect.sequence.length);

            this.effect.refreshStep();
            this._updateUI(); 
            this.isDirty = true;
            this._broadcastSync();
        }
    }

    toggle(isActive) {
        this._log("QuantizedEffectEditor: toggle", isActive);
        this.active = isActive;

        if (this.isStandalone) {
            if (this.active) {
                this._sendRemote({ type: 'hello' });
                this._createUI();
                this._updateUI();
            } else {
                this._sendRemote({ type: 'bye' });
                this._removeUI();
            }
            return;
        }

        if (this.isPoppedOut && this.active) {
            // Standalone is active, don't show local UI
            return;
        }

        if (this.active) {
            this.redoStack = []; 
            this._createUI();
            this._createCanvas();
            this._attachListeners();
            
            if (this.effect) {
                // Force re-trigger to ensure init logic runs (e.g. Shadow World)
                this.effect.active = false;
                const triggered = this.effect.trigger(true); 
                
                if (!triggered) {
                    console.warn("QuantizedEffectEditor: Forced trigger failed for", this.effect.name, "- Activating manually.");
                    this.effect.active = true;
                    if (typeof this.effect._initLogicGrid === 'function') this.effect._initLogicGrid();
                    if (typeof this.effect._initShadowWorld === 'function') {
                        this.effect._initShadowWorld();
                    } else if (typeof this.effect._initShadowWorldBase === 'function') {
                        this.effect._initShadowWorldBase(false);
                    }
                }

                if ((!this.effect.sequence || this.effect.sequence.length <= 1) && window.matrixPatterns && window.matrixPatterns[this.effect.name]) {
                    this.effect.sequence = window.matrixPatterns[this.effect.name];
                }

                this.effect.sequence = this._decodeSequence(this.effect.sequence);
                
                this.effect.debugMode = true;
                this.effect.manualStep = true; // ENABLED: Allow stepping one by one
                
                // Start at Step 1 if available
                this.effect.expansionPhase = Math.min(1, this.effect.sequence.length);

                this.effect.refreshStep();
                this._updateUI(); 
                this.isDirty = true;
                this._renderLoop();
                this._broadcastSync();
            }
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

    _cleanInternalSequence() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'clean' });
            return;
        }
        if (!this.effect) return;
        const threshVal = this.effect.getConfig('CleanInnerDistance');
        const thresh = (threshVal !== undefined) ? threshVal : 4;

        const sequence = this.effect.sequence;
        
        // Save current state
        const originalPhase = this.effect.expansionPhase;
        this.redoStack = [];
        let totalCount = 0;

        // Iterate steps to find lines that become internal
        for (let i = 0; i < sequence.length; i++) {
            this.effect.jumpToStep(i);
            
            // Ensure logic state is fully updated for this step
            if (typeof this.effect._updateRenderGridLogic === 'function') {
                this.effect._updateRenderGridLogic();
            }
            
            // Force rebuild of edge cache to get current line state and distance map
            const w = this.effect.logicGridW;
            const h = this.effect.logicGridH;
            
            // We must call private method to ensure cache is built for this exact step state
            if (typeof this.effect._rebuildEdgeCache === 'function') {
                this.effect._rebuildEdgeCache(w, h);
            }
            
            const distMap = this.effect._distMap;
            const edgeMaps = this.effect._cachedEdgeMaps;
            
            if (!distMap || !edgeMaps) continue;

            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            const stepRemovals = [];
            
            // Iterate all active edges in the cache across all layers
            for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
                const edgeMap = edgeMaps[layerIdx];
                if (!edgeMap) continue;

                for (const [key, value] of edgeMap) {
                    // value = { type: 'add'|'rem', op: ... }
                    if (value.type !== 'add') continue;

                    const op = value.op;
                    // Get coordinates from the operation that created the line
                    // addLine ops store x1, y1 (block coords relative to center)
                    const dx = op.x1;
                    const dy = op.y1;
                    const bx = cx + dx;
                    const by = cy + dy;

                    if (bx < 0 || bx >= w || by < 0 || by >= h) continue;

                    const idx = by * w + bx;
                    
                    // Check if this block is deep inside
                    if (distMap[idx] > thresh) {
                        // Use the face from the original op to target the removal correctly
                        const face = op.face || 'N'; 
                        stepRemovals.push({ op: 'remLine', args: [dx, dy, face], layer: layerIdx });
                    }
                }
            }
            
            if (stepRemovals.length > 0) {
                sequence[i].push(...stepRemovals);
                totalCount += stepRemovals.length;
            }
        }

        // Restore original state
        this.effect.jumpToStep(originalPhase);
        this.isDirty = true;
        this._broadcastSync();
        
        if (totalCount > 0) {
            alert(`Cleaner: Added ${totalCount} removal operations to clean internal lines.`);
        } else {
            alert("Cleaner: No deep internal lines found to remove.");
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
        this.canvas.style.zIndex = '10'; 
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
        if (!this.active || this.isStandalone) return;
        
        // Override: Ensure effect stays alive and visible while editing
        if (this.effect) {
             this.effect.active = true;
             if (this.effect.state === 'FADE_OUT' || this.effect.state === 'IDLE') {
                 this.effect.state = 'SUSTAIN';
                 this.effect.alpha = 1.0;
             }
             // Increment frame to support line fading in editor
             this.effect.animFrame++;
             // console.log("QuantizedEffectEditor: loop frame", this.effect.animFrame);
        }

        this._render();
        requestAnimationFrame(this._boundRender);
    }

    _render() {
        if (!this.canvas || !this.ctx) return;
        
        // Remove Throttling to ensure live updates from configuration changes
        // This ensures the canvas is cleared and redrawn every frame when the editor is active.

        const width = window.innerWidth;
        const height = window.innerHeight;
        
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.isDirty = true; // Resize forces redraw
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, width, height);

        // 1. Render actual effect components (Fades, Source Grid etc)
        // This also triggers _updateMask which is essential for line fade logic.
        this.effect.renderEditorPreview(ctx, this.effect.c.derived, this.effect.editorPreviewOp);

        // Ensure layout exists for schematic rendering
        if (!this.effect.layout) {
            // Force a mask update to generate layout if missing
            if (typeof this.effect._ensureCanvases === 'function') {
                this.effect._ensureCanvases(width, height);
            }
            if (typeof this.effect._updateMask === 'function') {
                this.effect._updateMask(width, height, this.effect.c.state, this.effect.c.derived);
            }
            if (!this.effect.layout) return; // Still missing? Bail.
        }
        
        const l = this.effect.layout;
        const grid = this.effect.g;
        
        // Calculate Grid Metrics
        // Note: effect.layout might use different scaling than simple blocks, but we trust it.
        const blocksX = this.effect.logicGridW;
        const blocksY = this.effect.logicGridH;
        const cx = Math.floor(blocksX / 2);
        const cy = Math.floor(blocksY / 2);
        
        // User Editor Offsets
        const gridOffX = 0;
        const gridOffY = 0;
        const changesOffX = 0;
        const changesOffY = 0;

        // 2. Render Background Grid (Overlay)
        if (this.showGrid) {
            this.effect.renderEditorGrid(ctx);
        }

        // 3. Render Schematic Layer (Blocks & Ops)
        if (this.highlightChanges) {
            this.effect.renderEditorOverlay(ctx);
        }

        // 3b. Render Editor Preview Op (Schematic)
        if (this.effect.editorPreviewOp) {
            const op = this.effect.editorPreviewOp;
            const layerColor = this.layerColors[this.currentLayer] || '#0f0';
            
            // Adjust opacity for fill, keep stroke solid/opaque
            // Simple hex to rgba parser or just use the color directly if it's hex and rely on globalAlpha?
            // layerColors are hex (e.g. #0f0, #0af). 
            // Let's use canvas globalAlpha for fill.
            
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = layerColor;
            ctx.strokeStyle = layerColor;
            
            // We want stroke to be more opaque, but we set globalAlpha.
            // Let's manually set strokeStyle with high alpha if possible, or reset globalAlpha for stroke.
            
            const drawBlock = (bx, by) => {
                 // Absolute Logic Coordinates
                 const absX = cx + bx;
                 const absY = cy + by;
                 
                 // Snapped Cell Coordinates
                 const cellX = Math.round((absX - l.offX + l.userBlockOffX) * l.cellPitchX);
                 const cellY = Math.round((absY - l.offY + l.userBlockOffY) * l.cellPitchY);
                 
                 const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                 const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                 
                 const nextCellX = Math.round((absX + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                 const nextCellY = Math.round((absY + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                 const w = (nextCellX - cellX) * l.screenStepX;
                 const h = (nextCellY - cellY) * l.screenStepY;

                 ctx.globalAlpha = 0.3;
                 ctx.fillRect(x, y, w, h);
                 ctx.globalAlpha = 0.8;
                 ctx.strokeRect(x, y, w, h);
            };

            if (op.op === 'addRect') {
                const [x1, y1, x2, y2] = op.args;
                const minX = Math.min(x1, x2);
                const maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        drawBlock(x, y);
                    }
                }
            } else if (op.op === 'add' || op.op === 'addSmart') {
                const [x, y] = op.args;
                drawBlock(x, y);
            }
            // Add other tool previews here if needed

            ctx.restore();
        }
        
        // Define shared variables needed for selection rendering
        if (this.selectionRect) {
            ctx.save();
            // selectionRect is now in ABSOLUTE Logic Coords (0..W)
            const minX = this.selectionRect.x;
            const minY = this.selectionRect.y;
            const maxX = minX + this.selectionRect.w + 1; 
            const maxY = minY + this.selectionRect.h + 1;
            
            // Calculate Snapped Bounds (min and max corners)
            // Note: offX is relative to center? No, logicGrid coordinates 0..W.
            // l.offX is used to align Logic Grid to Screen Grid.
            // Formula: ScreenX = Origin + ( (LogicX - offX + userOff) * Pitch ) * Step
            
            const cellX1 = Math.round((minX - l.offX + l.userBlockOffX) * l.cellPitchX);
            const cellY1 = Math.round((minY - l.offY + l.userBlockOffY) * l.cellPitchY);
            const cellX2 = Math.round((maxX - l.offX + l.userBlockOffX) * l.cellPitchX);
            const cellY2 = Math.round((maxY - l.offY + l.userBlockOffY) * l.cellPitchY);
            
            const selX = l.screenOriginX + (cellX1 * l.screenStepX) + l.pixelOffX + changesOffX;
            const selY = l.screenOriginY + (cellY1 * l.screenStepY) + l.pixelOffY + changesOffY;
            const selW = (cellX2 - cellX1) * l.screenStepX;
            const selH = (cellY2 - cellY1) * l.screenStepY;
            
            ctx.strokeStyle = '#0088FF';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(selX, selY, selW, selH);
            ctx.fillStyle = 'rgba(0, 136, 255, 0.1)';
            ctx.fillRect(selX, selY, selW, selH);
            ctx.restore();
        }

        // Define shared variables needed for multi-block selection rendering
        if (this.selectedBlocks.size > 0) {
            ctx.save();
            ctx.strokeStyle = '#0088FF';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.fillStyle = 'rgba(0, 136, 255, 0.1)';

            for (const key of this.selectedBlocks) {
                const [absX, absY] = key.split(',').map(Number);
                
                const cellX = Math.round((absX - l.offX + l.userBlockOffX) * l.cellPitchX);
                const cellY = Math.round((absY - l.offY + l.userBlockOffY) * l.cellPitchY);
                
                const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                
                const nextCellX = Math.round((absX + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                const nextCellY = Math.round((absY + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                const w = (nextCellX - cellX) * l.screenStepX;
                const h = (nextCellY - cellY) * l.screenStepY;

                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
            }
            ctx.restore();
        }

        // 5. Render Tool Preview (Drag/Hover)
        // If we have an editorPreviewOp, visual feedback is handled by renderEditorPreview.
        // But for Paste, we draw manually.
        if (this.currentTool === 'paste' && this.clipboard && this.hoverBlock) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            const ox = this.hoverBlock.x + cx;
            const oy = this.hoverBlock.y + cy;
            
            for (const pt of this.clipboard.data) {
                const absX = ox + pt.x;
                const absY = oy + pt.y;
                
                const cellX = Math.round((absX - l.offX + l.userBlockOffX) * l.cellPitchX);
                const cellY = Math.round((absY - l.offY + l.userBlockOffY) * l.cellPitchY);
                
                const x = l.screenOriginX + (cellX * l.screenStepX) + l.pixelOffX + changesOffX;
                const y = l.screenOriginY + (cellY * l.screenStepY) + l.pixelOffY + changesOffY;
                
                const nextCellX = Math.round((absX + 1 - l.offX + l.userBlockOffX) * l.cellPitchX);
                const nextCellY = Math.round((absY + 1 - l.offY + l.userBlockOffY) * l.cellPitchY);
                const w = (nextCellX - cellX) * l.screenStepX;
                const h = (nextCellY - cellY) * l.screenStepY;

                ctx.fillRect(x, y, w, h);
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
        container.style.zIndex = '11';
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

        // Pop Out / External Button
        const btnPopOut = this._createBtn(this.isStandalone ? 'Dock (Close)' : 'Pop Out', () => {
            if (this.isStandalone) {
                window.close();
            } else {
                if (typeof window.require !== 'undefined') {
                    try {
                        const { ipcRenderer } = window.require('elec' + 'tron');
                        ipcRenderer.send('open-editor');
                    } catch (e) {
                        console.error("Electron Pop Out failed:", e);
                    }
                } else {
                    window.open(window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'mode=editor', '_blank', 'width=400,height=800');
                }
            }
        });
        btnPopOut.style.width = '100%';
        btnPopOut.style.marginBottom = '10px';
        btnPopOut.style.background = '#040';
        btnPopOut.style.borderColor = '#0f0';
        container.appendChild(btnPopOut);
        
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        header.onmousedown = (e) => {
            if (this.isStandalone) return;
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
            effectSelect.title = "Select the Quantized effect to edit";
            
            const effects = ['QuantizedPulse', 'QuantizedClimb', 'QuantizedRetract', 'QuantizedAdd', 'QuantizedZoom', 'QuantizedBlockGenerator'];
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

            const selectorSeparator = document.createElement('div');
            selectorSeparator.style.marginBottom = '10px';
            selectorSeparator.style.borderBottom = '1px solid #0f0';
            container.appendChild(selectorSeparator);
        }

        // Block Size Controls
        const sizeControls = document.createElement('div');
        sizeControls.style.marginBottom = '10px';
        sizeControls.style.paddingBottom = '10px';
        sizeControls.style.borderBottom = '1px dashed #444';
        sizeControls.style.display = 'flex';
        sizeControls.style.alignItems = 'center';
        sizeControls.style.justifyContent = 'space-between';
        
        const lblSize = document.createElement('span');
        lblSize.textContent = 'Block Size:';
        
        const inpW = document.createElement('input');
        inpW.type = 'number';
        inpW.min = '1';
        inpW.max = '8';
        inpW.style.width = '40px';
        inpW.style.background = '#333';
        inpW.style.color = '#fff';
        inpW.style.border = '1px solid #555';
        
        const lblX = document.createElement('span');
        lblX.textContent = 'x';
        
        const inpH = document.createElement('input');
        inpH.type = 'number';
        inpH.min = '1';
        inpH.max = '8';
        inpH.style.width = '40px';
        inpH.style.background = '#333';
        inpH.style.color = '#fff';
        inpH.style.border = '1px solid #555';
        
        const btnSetSize = this._createBtn('Set', () => {
            this._changeBlockSize(parseInt(inpW.value), parseInt(inpH.value));
        });
        btnSetSize.title = "Update logic grid resolution";
        
        sizeControls.append(lblSize, inpW, lblX, inpH, btnSetSize);
        container.appendChild(sizeControls);
        
        this.inpBlockW = inpW;
        this.inpBlockH = inpH;

        // Speed Control
        const speedControls = document.createElement('div');
        speedControls.style.marginBottom = '10px';
        speedControls.style.paddingBottom = '10px';
        speedControls.style.borderBottom = '1px dashed #444';
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
            const val = parseFloat(inpSpeed.value);
            const finalVal = isNaN(val) ? 1.0 : val;
            if (this.isStandalone) {
                this._sendRemote({ type: 'setSpeed', val: finalVal });
            } else if (this.effect) {
                this.effect.c.set(this.effect.configPrefix + 'Speed', finalVal);
                alert(`Speed set to ${finalVal}`);
            }
        });
        btnSetSpeed.title = "Set animation step interval";
        
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
            const val = parseFloat(inpDur.value);
            const finalVal = isNaN(val) ? 5.0 : val;
            if (this.isStandalone) {
                this._sendRemote({ type: 'setDuration', val: finalVal });
            } else if (this.effect) {
                this.effect.c.set(this.effect.configPrefix + 'DurationSeconds', finalVal);
                alert(`Duration set to ${finalVal}s`);
            }
        });
        btnSetDur.title = "Set total effect lifetime";
        
        speedControls.append(lblDur, inpDur, btnSetDur);
        this.inpDuration = inpDur;

        container.appendChild(speedControls);
        this.inpSpeed = inpSpeed;

        const stepControls = document.createElement('div');
        stepControls.style.marginBottom = '10px';
        stepControls.style.paddingBottom = '10px';
        stepControls.style.borderBottom = '1px dashed #444';
        const btnPrev = this._createBtn('<', () => this._changeStep(-1));
        btnPrev.title = "Previous Step";
        const btnNext = this._createBtn('>', () => this._changeStep(1));
        btnNext.title = "Next Step";
        const btnAddStep = this._createBtn('+', () => this._addStep());
        btnAddStep.title = "Insert New Step";
        const btnDelStep = this._createBtn('-', () => this._delStep());
        btnDelStep.title = "Delete Current Step";
        this.stepLabel = document.createElement('span');
        this.stepLabel.style.margin = '0 10px';
        this.stepLabel.textContent = `Step: 0`;
        stepControls.append(btnPrev, this.stepLabel, btnNext, document.createTextNode(' '), btnAddStep, btnDelStep);
        container.appendChild(stepControls);

        const btnReset = this._createBtn('Reset All Steps', () => this._resetSteps());
        btnReset.title = "Clear all steps and reset sequence to empty";
        btnReset.style.width = '100%';
        btnReset.style.marginBottom = '10px';
        btnReset.style.color = '#ff4444';
        btnReset.style.borderColor = '#ff4444';
        container.appendChild(btnReset);

        // Edit Actions (Copy/Paste)
        const editControls = document.createElement('div');
        editControls.style.marginBottom = '10px';
        editControls.style.paddingBottom = '10px';
        editControls.style.borderBottom = '1px dashed #444';
        editControls.style.display = 'grid';
        editControls.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
        editControls.style.gap = '5px';
        const btnCopy = this._createBtn('Copy', () => this._copySelection());
        btnCopy.title = "Copy selected blocks to clipboard";
        const btnCut = this._createBtn('Cut', () => this._cutSelection());
        btnCut.title = "Cut selected blocks to clipboard";
        const btnPaste = this._createBtn('Paste', () => this._startPaste());
        btnPaste.title = "Enter Paste mode";
        const btnDelSel = this._createBtn('Del', () => this._deleteSelection());
        btnDelSel.title = "Delete selected blocks";
        editControls.append(btnCopy, btnCut, btnPaste, btnDelSel);
        container.appendChild(editControls);

        const toolControls = document.createElement('div');
        toolControls.style.marginBottom = '10px';
        toolControls.style.display = 'grid';
        toolControls.style.gridTemplateColumns = '1fr 1fr';
        toolControls.style.gap = '5px';

        this.tools = {};
        const addTool = (id, label, title) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.title = title || "";
            btn.style.background = '#333';
            btn.style.color = '#fff';
            btn.style.border = '1px solid #555';
            btn.style.cursor = 'pointer';
            btn.style.padding = '2px 5px';
            btn.onclick = () => this._selectTool(id);
            toolControls.appendChild(btn);
            this.tools[id] = btn;
        };

        addTool('select', 'Select', "Drag to select blocks");
        addTool('add', 'Add Block', "Click to toggle block existence");
        addTool('nudge', 'Nudge Block', "Drag to shift existing blocks");
        addTool('removeBlock', 'Rem Block', "Click to force remove block");
        addTool('addLine', 'Add Line', "Click block edges to force line visibility");
        addTool('removeLine', 'Rem Line', "Click block edges to hide lines");
        addTool('addRect', 'Add Rect', "Drag to add multiple blocks");
        
        container.appendChild(toolControls);

        const faceControls = document.createElement('div');
        faceControls.id = 'face-controls';
        faceControls.style.marginBottom = '10px';
        faceControls.style.paddingBottom = '10px';
        faceControls.style.borderBottom = '1px dashed #444';
        ['N', 'S', 'E', 'W'].forEach(f => {
            const btn = this._createBtn(f, () => this._selectFace(f));
            btn.title = `Select ${f} face for line tools`;
            faceControls.appendChild(btn);
            if (!this.faceBtns) this.faceBtns = {};
            this.faceBtns[f] = btn;
        });
        container.appendChild(faceControls);
        this.faceControls = faceControls;

        const colorToggle = document.createElement('label');
        colorToggle.style.display = 'block';
        colorToggle.style.marginTop = '10px';
        colorToggle.title = "Visual feedback for operation changes";
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.highlightChanges;
        checkbox.onchange = (e) => { 
            if (this.isStandalone) {
                this._sendRemote({ type: 'toggleHighlight', val: e.target.checked });
            }
            this.highlightChanges = e.target.checked; 
            this.isDirty = true; 
        };
        colorToggle.append(checkbox, document.createTextNode(' Highlight Changes'));
        container.appendChild(colorToggle);

        // Layer Controls
        const layerControls = document.createElement('div');
        layerControls.style.marginTop = '10px';
        layerControls.style.paddingTop = '10px';
        layerControls.style.borderTop = '1px solid #555';
        
        const lblLayer = document.createElement('div');
        lblLayer.textContent = 'Active Layer:';
        lblLayer.style.marginBottom = '5px';
        layerControls.appendChild(lblLayer);

        const layerBtnGroup = document.createElement('div');
        layerBtnGroup.style.display = 'flex';
        layerBtnGroup.style.gap = '5px';
        layerBtnGroup.style.marginBottom = '10px';

        this.layerBtns = [];
        [0, 1, 2].forEach(l => {
            const btn = this._createBtn(`L${l}`, () => {
                this.currentLayer = l;
                this._updateUI();
                if (this.isStandalone) this._sendRemote({ type: 'setLayer', layer: l });
            });
            btn.style.flex = '1';
            btn.title = `Select Layer ${l} for drawing. L0 is base, L1/L2 are overlays.`;
            layerBtnGroup.appendChild(btn);
            this.layerBtns[l] = btn;
        });
        layerControls.appendChild(layerBtnGroup);

        const btnMergeSel = this._createBtn('Merge Selection to L0', () => {
            if (!this.effect) return;
            this._log(`[Editor] Merge Selection Button Clicked. Standalone: ${this.isStandalone}`);
            this.redoStack = [];

            const targetIdx = Math.max(0, this.effect.expansionPhase - 1);

            if (this.isStandalone) {
                // In standalone mode, we DON'T check local state (which may be inaccurate/incomplete)
                // We just send the selection to the main window and let IT perform the merge.
                if (this.selectedBlocks.size > 0) {
                    const blocks = Array.from(this.selectedBlocks).map(key => {
                        const [x, y] = key.split(',').map(Number);
                        return { x, y };
                    });
                    this._log(`[Editor] Sending Remote Merge (Multi-Select: ${blocks.length} blocks)`);
                    this._sendRemote({ type: 'merge', selection: blocks, multiSelect: true });
                    this.selectedBlocks.clear();
                    this.isDirty = true;
                } else if (this.selectionRect) {
                    this._log(`[Editor] Sending Remote Merge (Rect: ${JSON.stringify(this.selectionRect)})`);
                    this._sendRemote({ type: 'merge', selection: this.selectionRect });
                } else {
                    this.ui.notifications.show("No selection to merge", "info");
                }
                return;
            }

            // --- LOCAL EXECUTION (Main Window) ---
            // Ensure logic state is fully updated for this step before merge
            if (typeof this.effect._updateRenderGridLogic === 'function') {
                this.effect._updateRenderGridLogic();
            }

            const step = this.effect.sequence[targetIdx];
            if (!step) return;
            
            // Snapshot before merge for undo support
            const originalOps = JSON.parse(JSON.stringify(step));
            
            let count = 0;
            if (this.selectedBlocks.size > 0) {
                const blocks = Array.from(this.selectedBlocks).map(key => {
                    const [x, y] = key.split(',').map(Number);
                    return { x, y };
                });
                count = this.effect.mergeBlocksAtStep(blocks, targetIdx);
                this.selectedBlocks.clear();
            } else if (this.selectionRect) {
                count = this.effect.mergeSelectionAtStep(this.selectionRect, targetIdx);
            } else {
                this.ui.notifications.show("No selection to merge", "info");
                return;
            }

            if (count > 0) {
                // Wrap the entire new state in a transformative group
                const mergedOps = step.splice(0, step.length);
                step.push({ 
                    op: 'group', 
                    ops: mergedOps, 
                    replacesStep: true, 
                    originalOps: originalOps,
                    label: 'Merge Selected Blocks'
                });

                this.effect.refreshStep();
                this.isDirty = true;
                this.ui.notifications.show(`${count} blocks merged to Layer 0`, 'success');
                this._broadcastSync();
            } else {
                this.ui.notifications.show("No blocks found in selection on Layers 1 or 2", "info");
            }
        });
        btnMergeSel.style.width = '100%';
        btnMergeSel.title = "Move only selected blocks from L1/L2 to L0.";
        layerControls.appendChild(btnMergeSel);

        container.appendChild(layerControls);

        const gridToggle = document.createElement('label');
        gridToggle.style.display = 'block';
        gridToggle.style.marginTop = '10px';
        gridToggle.style.paddingTop = '10px';
        gridToggle.style.borderTop = '1px solid #555';
        gridToggle.title = "Show logic grid block boundaries";
        const gridCheck = document.createElement('input');
        gridCheck.type = 'checkbox';
        gridCheck.checked = this.showGrid;
        gridCheck.onchange = (e) => { 
            if (this.isStandalone) {
                this._sendRemote({ type: 'toggleGrid', val: e.target.checked });
            }
            this.showGrid = e.target.checked; 
            this.isDirty = true; 
        };
        gridToggle.append(gridCheck, document.createTextNode(' Show Grid Overlay'));
        container.appendChild(gridToggle);

        const shadowToggle = document.createElement('label');
        shadowToggle.style.display = 'block';
        shadowToggle.style.marginTop = '5px';
        shadowToggle.title = "Enable background simulation reveal";
        const shadowCheck = document.createElement('input');
        shadowCheck.type = 'checkbox';
        shadowCheck.checked = (this.effect && this.effect.c.state.layerEnableShadowWorld !== false);
        shadowCheck.onchange = (e) => { 
            if (this.isStandalone) {
                this._sendRemote({ type: 'toggleShadow', val: e.target.checked });
            }
            if (this.effect) this.effect.c.set('layerEnableShadowWorld', e.target.checked); 
            this.isDirty = true; 
        };
        shadowToggle.append(shadowCheck, document.createTextNode(' Use Shadow World'));
        container.appendChild(shadowToggle);

        const removalsToggle = document.createElement('label');
        removalsToggle.style.display = 'block';
        removalsToggle.style.marginTop = '5px';
        removalsToggle.style.marginBottom = '10px';
        removalsToggle.title = "Show blocks that are being explicitly removed";
        const removalsCheck = document.createElement('input');
        removalsCheck.type = 'checkbox';
        removalsCheck.checked = (this.effect && this.effect.c.state.layerEnableEditorRemovals !== false);
        removalsCheck.onchange = (e) => { 
            if (this.isStandalone) {
                this._sendRemote({ type: 'toggleRemovals', val: e.target.checked });
            }
            if (this.effect) this.effect.c.set('layerEnableEditorRemovals', e.target.checked); 
            this.isDirty = true; 
        };
        removalsToggle.append(removalsCheck, document.createTextNode(' Show Removals'));
        container.appendChild(removalsToggle);
        
        const exportControls = document.createElement('div');
        exportControls.style.display = 'flex';
        exportControls.style.justifyContent = 'space-between';
        exportControls.style.marginTop = '10px';
        exportControls.style.paddingTop = '10px';
        exportControls.style.borderTop = '1px solid #555';

        const btnExport = this._createBtn('Copy Data', () => this._exportData());
        btnExport.title = "Copy the compressed sequence data to clipboard";
        btnExport.style.width = '32%';
        btnExport.style.marginRight = '0';

        const btnSave = this._createBtn('Save Pattern', () => this._savePattern());
        btnSave.title = "Save all patterns to QuantizedPatterns.js";
        btnSave.style.width = '32%';
        btnSave.style.marginRight = '0';

        const btnClean = this._createBtn('Clean Internal', () => this._cleanInternalSequence());
        btnClean.title = "Remove lines more than 3 blocks from the perimeter across all steps";
        btnClean.style.width = '32%';
        btnClean.style.marginRight = '0';
        
        exportControls.appendChild(btnExport);
        exportControls.appendChild(btnSave);
        exportControls.appendChild(btnClean);
        container.appendChild(exportControls);

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
        window.addEventListener('wheel', this._boundWheel, { passive: false });
    }

    _detachListeners() {
        window.removeEventListener('mousedown', this._boundMouseDown);
        window.removeEventListener('mousemove', this._boundMouseMove);
        window.removeEventListener('mouseup', this._boundMouseUp);
        window.removeEventListener('keydown', this._boundKeyDown);
        window.removeEventListener('wheel', this._boundWheel);
    }

    _selectTool(tool) {
        if (this.isStandalone) {
            this._sendRemote({ type: 'selectTool', tool });
        }
        this.currentTool = tool;
        this.selectionRect = null; 
        this.selectedBlocks.clear();
        if (tool !== 'paste') this.clipboard = null; 
        this._updateUI();
        this.isDirty = true;
        this._broadcastSync();
    }

    _selectFace(face) { 
        if (this.isStandalone) {
            this._sendRemote({ type: 'selectFace', face });
        }
        this.currentFace = face; this._updateUI(); 
        this._broadcastSync();
    }

    _changeBlockSize(w, h) {
        if (this.isStandalone) {
            this._sendRemote({ type: 'changeBlockSize', w, h });
            return;
        }
        if (!this.effect) return;
        if (isNaN(w) || w < 1) w = 4;
        if (isNaN(h) || h < 1) h = 4;
        
        const prefix = this.effect.configPrefix;
        
        // Use set() to trigger auto-alignment logic in ConfigurationManager
        this.effect.c.set(prefix + 'BlockWidthCells', w);
        this.effect.c.set(prefix + 'BlockHeightCells', h);
        
        // Re-init logic grid with new size
        const currentStep = this.effect.expansionPhase;
        this.effect._initLogicGrid(); 
        this.effect.jumpToStep(currentStep); 
        
        this.isDirty = true;
        this._broadcastSync();
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

        if (this.effect && this.stepLabel) {
            this.stepLabel.textContent = `Step: ${this.effect.expansionPhase} / ${this.effect.sequence.length}`;
        }
        for (const t in this.tools) {
            this.tools[t].style.background = (t === this.currentTool) ? '#00aa00' : '#333';
        }

        // Update layer buttons
        if (this.layerBtns) {
            this.layerBtns.forEach((btn, l) => {
                btn.style.background = (this.currentLayer === l) ? '#00aa00' : '#333';
            });
        }

        const showFaces = (this.currentTool === 'addLine' || this.currentTool === 'removeLine' || this.currentTool === 'nudge');
        if (this.faceControls) {
            this.faceControls.style.display = showFaces ? 'block' : 'none';
            if (showFaces) {
                for (const f in this.faceBtns) {
                    this.faceBtns[f].style.background = (f === this.currentFace) ? '#00aa00' : '#333';
                }
            }
        }
    }

    _changeStep(delta) {
        if (this.isStandalone) {
            this._sendRemote({ type: 'changeStep', delta });
            return;
        }
        this.redoStack = [];
        
        const oldStep = this.effect.expansionPhase;
        let newStep = oldStep + delta;
        
        // Clamp to minimum Step 1
        if (newStep < 1) newStep = 1;
        
        // Procedural Generation Support (Only if attempting to go past the end)
        if (delta > 0 && newStep > this.effect.sequence.length) {
            if (this.effect.name === 'QuantizedBlockGenerator' || (this.effect.state === 'GENERATING' && typeof this.effect._attemptGrowth === 'function')) {
                if (!this.effect.sequence[this.effect.expansionPhase]) {
                    this.effect.sequence[this.effect.expansionPhase] = [];
                }
                this.effect.expansionPhase = newStep;
                this.effect._attemptGrowth();
                this._updateUI();
                this.isDirty = true;
                this._broadcastSync();
                return;
            }
        }

        // Limit to sequence length
        if (newStep > this.effect.sequence.length) newStep = this.effect.sequence.length;

        this._log(`[Editor] ChangeStep: ${oldStep} -> ${newStep} (Delta: ${delta}, Len: ${this.effect.sequence.length})`);

        // Force jumpToStep for all changes to ensure immediate visibility (skip fades) and state parity
        this.effect.expansionPhase = newStep;
        this.effect.jumpToStep(newStep);

        this._updateUI();
        this.isDirty = true;
        this._broadcastSync();
    }

    _addStep() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'addStep' });
            return;
        }
        this.redoStack = [];
        // Insert at the current phase index (between current state and next step)
        const insertIdx = this.effect.expansionPhase;
        this._log(`[Editor] Inserting new empty step at index ${insertIdx} (Current Phase: ${this.effect.expansionPhase})`);
        
        this.effect.sequence.splice(insertIdx, 0, []); 
        
        // Move into the new step
        this._changeStep(1);
    }

    _delStep() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'delStep' });
            return;
        }
        // Foundation Bypass: Cannot delete if at Step 1 or Step 0, or if it's the last remaining step
        if (this.effect.expansionPhase <= 1 || this.effect.sequence.length <= 1) {
            this._warn("[Editor] Deletion blocked: Step 1 is a foundational step and cannot be removed.");
            this.ui.notifications.show("Step 1 is foundational and cannot be deleted", "info");
            return;
        }
        
        this.redoStack = [];
        
        // The current step being viewed is at index (expansionPhase - 1)
        const targetIdx = this.effect.expansionPhase - 1;
        this._log(`[Editor] Deleting step at index ${targetIdx} (Phase was ${this.effect.expansionPhase})`);
        
        this.effect.sequence.splice(targetIdx, 1);
        
        // Step back so we are looking at the previous valid state
        this._changeStep(-1);
    }

    _resetSteps() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'resetSteps' });
            return;
        }
        if (!this.effect) return;
        if (!confirm("Are you sure you want to RESET ALL STEPS for this effect? This will clear the entire animation sequence.")) return;
        
        this.redoStack = [];
        this.effect.sequence = [[]]; // Reset to single empty step
        this.effect.expansionPhase = 1; // Default to Step 1
        
        // Clear transient mask operations
        if (this.effect.maskOps) this.effect.maskOps = [];
        
        // Reset the logic grid
        if (typeof this.effect._initLogicGrid === 'function') {
            this.effect._initLogicGrid();
        }
        
        this.effect.refreshStep();
        this._updateUI();
        this.isDirty = true;
        
        this._log("QuantizedEffectEditor: Steps reset for", this.effect.name);
        this._broadcastSync();
    }

    _exportData() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'export' });
            return;
        }
        const encoded = this._encodeSequence(this.effect.sequence);
        const json = JSON.stringify(encoded);
        navigator.clipboard.writeText(json).then(() => { alert('Sequence data copied to clipboard (Compressed)!'); });
    }

    _savePattern() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'save' });
            return;
        }
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
        const OPS = { 'add': 1, 'rem': 2, 'addRect': 3, 'addLine': 4, 'remLine': 5, 'addSmart': 6, 'removeBlock': 7, 'nudge': 12 };
        const FACES = { 'N': 1, 'n': 1, 'S': 2, 's': 2, 'E': 4, 'e': 4, 'W': 8, 'w': 8 };
        
        const packedSequence = [];
        for (const step of sequence) {
            const stepData = [];
            for (const opObj of step) {
                let opName, args, layer = 0;
                if (Array.isArray(opObj)) {
                    if (typeof opObj[0] === 'number') {
                        stepData.push(...opObj);
                        continue;
                    }
                    opName = opObj[0];
                    args = opObj.slice(1);
                    // Legacy array format likely doesn't have layer
                } else {
                    opName = opObj.op;
                    args = opObj.args;
                    layer = opObj.layer || 0;
                }

                const opCode = OPS[opName];
                if (!opCode) {
                    if (opName === 'group' && opObj.ops) {
                        // Recursively encode group ops
                        const encodedGroup = { op: 'group', ops: [] };
                        const tempResult = this._encodeSequence([opObj.ops]);
                        encodedGroup.ops = tempResult[0];
                        stepData.push(encodedGroup);
                    }
                    continue;
                }

                if (opCode === 1) { // add
                    if (layer > 0) {
                        stepData.push(8, args[0], args[1], layer); // 8: addLayered
                    } else {
                        stepData.push(1, args[0], args[1]);
                    }
                } else if (opCode === 3) { // addRect
                    if (layer > 0) {
                        stepData.push(9, args[0], args[1], args[2], args[3], layer); // 9: addRectLayered
                    } else {
                        stepData.push(3, args[0], args[1], args[2], args[3]);
                    }
                } else if (opCode === 6) { // addSmart
                    if (layer > 0) {
                         stepData.push(10, args[0], args[1], layer); // 10: addSmartLayered
                    } else {
                         stepData.push(6, args[0], args[1]);
                    }
                } else if (opCode === 7) { // removeBlock
                    if (layer > 0) {
                         stepData.push(11, args[0], args[1], layer); // 11: removeBlockLayered
                    } else {
                         stepData.push(7, args[0], args[1]);
                    }
                } else if (opCode === 12) { // nudge(x, y, w, h, face, layer)
                    const dx = args[0];
                    const dy = args[1];
                    let face = args[4];

                    // Refactor existing/missing directions to match "away from center" logic
                    if (!face) {
                         if (dx === 0 && dy === 0) face = 'N'; // Default
                         else if (Math.abs(dy) > Math.abs(dx)) face = (dy > 0) ? 'S' : 'N';
                         else face = (dx > 0) ? 'E' : 'W';
                    }
                    
                    const fMask = FACES[face.toUpperCase()] || 0;
                    // OpCode 12: [12, x, y, w, h, layer, faceMask]
                    stepData.push(12, args[0], args[1], args[2], args[3], layer, fMask);
                } else if (opCode === 2 || opCode === 4 || opCode === 5) {
                    // rem(2), addLine(4), remLine(5)
                    stepData.push(opCode, args[0], args[1]);
                    let mask = 0;
                    if (args.length > 2 && typeof args[2] === 'string') {
                        mask = FACES[args[2].toUpperCase()] || 0;
                    } else if (typeof args[2] === 'number') {
                         mask = args[2];
                    }
                    
                    // Pack Layer into Mask (Bits 4-5) to avoid stream ambiguity
                    if (layer > 0) {
                        mask = mask | (layer << 4);
                    }
                    stepData.push(mask);
                }
            }
            packedSequence.push(stepData);
        }
        return packedSequence;
    }


    _undo() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'undo' });
            return;
        }
        const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
        const step = this.effect.sequence[targetIdx];
        if (step && step.length > 0) { 
            const action = step.pop(); 
            
            // Support for transformative operations (like merge) that snapshot the state
            if (action.replacesStep && action.originalOps) {
                step.splice(0, step.length, ...action.originalOps);
            }
            
            this.redoStack.push(action);
            this.effect.refreshStep(); 
            this.isDirty = true;
            this._broadcastSync();
        }
    }

    _redo() {
        if (this.isStandalone) {
            this._sendRemote({ type: 'redo' });
            return;
        }
        const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
        const step = this.effect.sequence[targetIdx];
        if (this.redoStack.length > 0) {
            const action = this.redoStack.pop();
            step.push(action);
            this.effect.refreshStep();
            this.isDirty = true;
            this._broadcastSync();
        }
    }

    // CLIPBOARD OPERATIONS
    _copySelection() {
        if (!this.selectionRect) return;
        const grid = this.effect.logicGrid;
        const w = this.effect.logicGridW;
        
        const r = this.selectionRect; // Absolute coords now
        const data = [];
        
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                const idx = y * w + x;
                if (grid[idx] === 1) {
                    data.push({ x: x - r.x, y: y - r.y });
                }
            }
        }
        this.clipboard = { w: r.w, h: r.h, data: data };
        this._log("Copied", data.length, "blocks");
        alert(`Copied ${data.length} blocks!`);
    }

    _deleteSelection() {
        if (!this.selectionRect) return;
        this.redoStack = [];
        const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
        const step = this.effect.sequence[targetIdx];
        const grid = this.effect.logicGrid;
        const w = this.effect.logicGridW;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(this.effect.logicGridH / 2);
        const r = this.selectionRect; // Absolute

        let count = 0;
        for (let y = r.y; y <= r.y + r.h; y++) {
            for (let x = r.x; x <= r.x + r.w; x++) {
                const idx = y * w + x;
                if (grid[idx] === 1) {
                    // Convert absolute back to relative for removeBlock args
                    step.push({ op: 'removeBlock', args: [x - cx, y - cy], layer: this.currentLayer });
                    count++;
                }
            }
        }
        if (count > 0) {
            if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
            this.effect.refreshStep();
            this.isDirty = true;
            this._broadcastSync();
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
        this._broadcastSync();
    }

    _commitPaste(targetX, targetY) {
        if (!this.clipboard) return;
        this.redoStack = [];
        const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
        const step = this.effect.sequence[targetIdx];
        for (const pt of this.clipboard.data) {
            step.push({ op: 'add', args: [targetX + pt.x, targetY + pt.y] });
        }
        if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
        this.effect.refreshStep();
        this.isDirty = true;
        this._broadcastSync();
    }

    _onKeyDown(e) {
        if (!this.active) return;

        // Ignore if typing in an input field or text area
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        // Shortcuts
        if (e.key === 'Escape') {
            if (this.selectedBlocks.size > 0 || this.selectionRect) {
                this.selectedBlocks.clear();
                this.selectionRect = null;
                this.isDirty = true;
                e.preventDefault();
                return;
            }
        }

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

    _getHitTest(clientX, clientY) {
        if (!this.effect) return null;
        
        // We use changesOff because that's where the visual blocks are drawn.
        // gridOff should ideally match but changesOff is primary for 'hitting' things.
        const options = {
            editorOffX: this.effect.c.state.quantizedEditorChangesOffsetX || 0,
            editorOffY: this.effect.c.state.quantizedEditorChangesOffsetY || 0
        };
        
        return this.effect.hitTest(clientX, clientY, options);
    }

    _onMouseMove(e) {
        if (!this.active) return;
        const hit = this._getHitTest(e.clientX, e.clientY);
        
        // Optimize: Check if hover changed
        const hoverHash = hit ? `${hit.x},${hit.y}` : "null";
        
        if (this.currentTool === 'addRect' || this.currentTool === 'select' || this.currentTool === 'nudge') {
            if (this.dragStart && hit) {
                // Update Preview op for drawing
                if (this.currentTool === 'nudge') {
                    // Nudge preview: Just the block itself, or the shift?
                    // Just showing the block being added is enough for now.
                    // Nudge op args: x, y, w, h
                    // We need to calculate top-left and size from drag
                    const x1 = Math.min(this.dragStart.x, hit.x);
                    const y1 = Math.min(this.dragStart.y, hit.y);
                    const x2 = Math.max(this.dragStart.x, hit.x);
                    const y2 = Math.max(this.dragStart.y, hit.y);
                    const w = x2 - x1 + 1;
                    const h = y2 - y1 + 1;
                    
                    // We render it as an 'addRect' preview visually
                    this.effect.editorPreviewOp = {
                        op: 'addRect',
                        args: [x1, y1, x2, y2]
                    };
                } else {
                    this.effect.editorPreviewOp = {
                        op: 'addRect',
                        args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y]
                    };
                }
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
        if ((this.dom && this.dom.contains(e.target)) || 
            (settingsPanel && settingsPanel.contains(e.target)) ||
            (menuToggle && menuToggle.contains(e.target))) {
            return;
        }

        const hit = this._getHitTest(e.clientX, e.clientY);

        // Deselect previous on new select click (unless CTRL is held)
        if (this.currentTool === 'select' && !e.ctrlKey) {
            if (this.selectedBlocks.size > 0 || this.selectionRect) {
                this.selectedBlocks.clear();
                this.selectionRect = null;
                this.isDirty = true;
            }
        }

        if (hit) {
            // Multi-Select Toggle with CTRL
            if (e.ctrlKey) {
                // If we have a selectionRect, bake it into selectedBlocks first
                if (this.selectionRect) {
                    const r = this.selectionRect;
                    for (let ry = r.y; ry <= r.y + r.h; ry++) {
                        for (let rx = r.x; rx <= r.x + r.w; rx++) {
                            this.selectedBlocks.add(`${rx},${ry}`);
                        }
                    }
                    this.selectionRect = null;
                }

                const key = `${hit.absX},${hit.absY}`;
                if (this.selectedBlocks.has(key)) {
                    this.selectedBlocks.delete(key);
                } else {
                    this.selectedBlocks.add(key);
                }
                this.isDirty = true;
                this._broadcastSync();
                return;
            }

            if (this.currentTool === 'paste') {
                this._commitPaste(hit.x, hit.y);
                return;
            }

            if (this.currentTool === 'addRect' || this.currentTool === 'select' || this.currentTool === 'nudge') {
                this.dragStart = hit;
                this._broadcastSync();
                return; // Wait for mouse up
            }

            // Apply Tool (Immediate tools) with Toggle Logic
            const dx = hit.x;
            const dy = hit.y;
            const step = this.effect.sequence[this.effect.expansionPhase];
            
            // Smart Line Toggle (Shared Edges)
            if (this.currentTool === 'addLine' || this.currentTool === 'removeLine') {
                const cx = Math.floor(this.effect.logicGridW / 2);
                const cy = Math.floor(this.logicGridH / 2);
                const absX = dx + cx; 
                const absY = dy + cy;
                const f = this.currentFace;

                // Determine Canonical Key
                let u=0, v=0, type='';
                if (f === 'N') { u = absX; v = absY; type = 'H'; }
                else if (f === 'S') { u = absX; v = absY + 1; type = 'H'; }
                else if (f === 'W') { u = absX; v = absY; type = 'V'; }
                else if (f === 'E') { u = absX + 1; v = absY; type = 'V'; }

                const key = `${type}_${u}_${v}`;

                // Target current visible step (N-1) or first step (0)
                const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                const step = this.effect.sequence[targetIdx];

                // 1. Clear ALL Overrides on this Edge in TARGET STEP
                for (let i = step.length - 1; i >= 0; i--) {
                    const op = step[i];
                    let oName, oArgs;
                    if (Array.isArray(op)) { oName = op[0]; oArgs = op.slice(1); }
                    else { oName = op.op; oArgs = op.args; }

                    if (oName === 'addLine' || oName === 'remLine') {
                        const ox = oArgs[0] + cx;
                        const oy = oArgs[1] + cy;
                        const oface = oArgs[2];
                        let ou=0, ov=0, otype='';
                        if (oface === 'N') { ou = ox; ov = oy; otype = 'H'; }
                        else if (oface === 'S') { ou = ox; ov = oy + 1; otype = 'H'; }
                        else if (oface === 'W') { ou = ox; ov = oy; otype = 'V'; }
                        else if (oface === 'E') { ou = ox + 1; ov = oy; otype = 'V'; }

                        if (ou === u && ov === v && otype === type) {
                            step.splice(i, 1);
                        }
                    }
                }

                // 2. Determine Current Visibility State
                const isVisible = this.effect.getEdgeVisibility(absX, absY, f);

                // 3. Apply Toggle Logic based on Desired vs Actual
                let transientOp = null;
                if (this.currentTool === 'addLine') {
                    if (!isVisible) {
                        step.push({ op: 'addLine', args: [dx, dy, f], layer: this.currentLayer });       
                    } else {
                        transientOp = { 
                            type: 'removeLine', x1: dx, y1: dy, x2: dx, y2: dy, face: f, 
                            startFrame: this.effect.animFrame, layer: this.currentLayer 
                        };
                    }
                } else if (this.currentTool === 'removeLine') {
                    if (isVisible) {
                        step.push({ op: 'remLine', args: [dx, dy, f], layer: this.currentLayer });       
                    } else {
                        transientOp = { 
                            type: 'addLine', x1: dx, y1: dy, x2: dx, y2: dx, face: f, 
                            startFrame: this.effect.animFrame, layer: this.currentLayer 
                        };
                    }
                }
                
                if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
                this.effect.refreshStep();
                if (transientOp) {
                    this.effect.maskOps.push(transientOp);
                }
                this.isDirty = true;
                this._broadcastSync();
                return;
            }

            // Basic Block Tools
            let opName = null;
            let args = null;

            if (this.currentTool === 'add') { opName = 'add'; args = [dx, dy]; } 
            else if (this.currentTool === 'removeBlock') { opName = 'removeBlock'; args = [dx, dy]; } 

            if (opName) {
                this.redoStack = [];
                const argsMatch = (o, op, a) => {
                    let oOp, oArgs;
                    if (Array.isArray(o)) {
                        oOp = o[0]; oArgs = o.slice(1);
                    } else {
                        oOp = o.op; oArgs = o.args;
                    }
                    return oOp === op && oArgs.length === a.length && oArgs.every((v, i) => v === a[i]);
                };

                const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                const step = this.effect.sequence[targetIdx];
                const existingIdx = step.findIndex(o => argsMatch(o, opName, args));
                let deletedOp = null;
                
                if (existingIdx !== -1) { 
                    deletedOp = step[existingIdx];
                    step.splice(existingIdx, 1); 
                } else { 
                    const newOp = { op: opName, args: args };
                    if (opName === 'add' || opName === 'nudge') newOp.layer = this.currentLayer;
                    if (opName === 'removeBlock') newOp.layer = this.currentLayer;
                    step.push(newOp); 
                }

                if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
                this.effect.refreshStep();

                if (deletedOp && (opName === 'add')) {
                    this.effect.maskOps.push({ 
                        type: 'removeBlock', 
                        x1: dx, y1: dy, x2: dx, y2: dy, 
                        startFrame: this.effect.animFrame, 
                        layer: this.currentLayer 
                    });
                }

                this.isDirty = true;
                this._broadcastSync();
            }        }
    }

    _onMouseUp(e) {
        if (!this.active) return;
        
        if (this.dragStart) {
            const hit = this._getHitTest(e.clientX, e.clientY);
            if (hit) {
                const targetIdx = Math.max(0, this.effect.expansionPhase - 1);
                const step = this.effect.sequence[targetIdx];

                if (this.currentTool === 'addRect') {
                    this.redoStack = [];
                    step.push({ 
                        op: 'addRect', 
                        args: [this.dragStart.x, this.dragStart.y, hit.x, hit.y],
                        layer: this.currentLayer
                    });
                    if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
                    this.effect.refreshStep();
                    this.isDirty = true;
                } else if (this.currentTool === 'nudge') {
                    this.redoStack = [];
                    
                    let targetX, targetY, targetW, targetH;

                    if (this.dragStart.x === hit.x && this.dragStart.y === hit.y) {
                        // Click nudge. Check if we have an active selection.
                        if (this.selectedBlocks.size > 0) {
                            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                            const cx = Math.floor(this.effect.logicGridW / 2);
                            const cy = Math.floor(this.effect.logicGridH / 2);
                            for (const key of this.selectedBlocks) {
                                const [absX, absY] = key.split(',').map(Number);
                                const rx = absX - cx;
                                const ry = absY - cy;
                                minX = Math.min(minX, rx);
                                maxX = Math.max(maxX, rx);
                                minY = Math.min(minY, ry);
                                maxY = Math.max(maxY, ry);
                            }
                            targetX = minX; targetY = minY;
                            targetW = maxX - minX + 1; targetH = maxY - minY + 1;
                        } else if (this.selectionRect) {
                            const cx = Math.floor(this.effect.logicGridW / 2);
                            const cy = Math.floor(this.effect.logicGridH / 2);
                            targetX = this.selectionRect.x - cx;
                            targetY = this.selectionRect.y - cy;
                            targetW = this.selectionRect.w + 1;
                            targetH = this.selectionRect.h + 1;
                        } else {
                            // Single block nudge
                            targetX = hit.x; targetY = hit.y;
                            targetW = 1; targetH = 1;
                        }
                    } else {
                        // Drag nudge
                        targetX = Math.min(this.dragStart.x, hit.x);
                        targetY = Math.min(this.dragStart.y, hit.y);
                        const x2 = Math.max(this.dragStart.x, hit.x);
                        const y2 = Math.max(this.dragStart.y, hit.y);
                        targetW = x2 - targetX + 1;
                        targetH = y2 - targetY + 1;
                    }

                    step.push({ 
                        op: 'nudge', 
                        args: [targetX, targetY, targetW, targetH, this.currentFace],
                        layer: this.currentLayer
                    });
                    if (this.effect.expansionPhase === 0) this.effect.expansionPhase = 1;
                    this.effect.refreshStep();
                    this.isDirty = true;
                } else if (this.currentTool === 'select') {
                    // Define Selection Rect
                    // dragStart and hit are in block coordinates relative to CENTER (from hitTest)
                    // hitTest returns { x: bx - cx, y: by - cy, absX: bx, absY: by }
                    // We want ABSOLUTE logic coordinates (0..W) for simpler bounds checking in flattenLayers?
                    // flattenLayers converts ops (relative) to absolute (0..W). 
                    // So let's store Absolute coords in selectionRect.
                    
                    const absStart = this.dragStart.absX !== undefined ? this.dragStart : { absX: this.dragStart.x, absY: this.dragStart.y }; // Fallback
                    
                    const x1 = Math.min(this.dragStart.absX, hit.absX);
                    const y1 = Math.min(this.dragStart.absY, hit.absY);
                    const x2 = Math.max(this.dragStart.absX, hit.absX);
                    const y2 = Math.max(this.dragStart.absY, hit.absY);
                    
                    this.selectionRect = { x: x1, y: y1, w: x2-x1, h: y2-y1 };
                    this.isDirty = true;
                }
            }
            this.dragStart = null;
            this.effect.editorPreviewOp = null;
            this.isDirty = true; // Ensure preview cleared
            this._broadcastSync();
        }
    }

    _onWheel(e) {
        if (!this.active) return;
        
        // Prevent interfering with UI scrolling
        const settingsPanel = document.getElementById('settingsPanel');
        if (this.dom && this.dom.contains(e.target)) return;
        if (settingsPanel && settingsPanel.contains(e.target)) return;

        e.preventDefault();

        if (e.deltaY < 0) {
            this._changeStep(-1);
        } else if (e.deltaY > 0) {
            this._changeStep(1);
        }
    }
}

