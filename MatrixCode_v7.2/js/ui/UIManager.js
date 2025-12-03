class UIManager {
                    constructor(c, effects, fonts, notificationMgr) {
                        this.c = c; this.eff = effects; this.fonts = fonts; this.notifications = notificationMgr;
                        this.dom = { panel: document.getElementById('settingsPanel'), toggle: document.getElementById('menuToggle'), tabs: document.getElementById('navTabs'), content: document.getElementById('contentArea'), track: null, tooltip: null };
                        this.scrollState = { isDown: false, startX: 0, scrollLeft: 0, dragDistance: 0 }; this.ignoreNextClick = false;
                        this.fonts.subscribe(f => this.refresh('fontFamily'));
                        this.defs = [
            // GLOBAL TAB
            { cat: 'Global', type: 'accordion_header', label: 'Code Timing' },
            { cat: 'Global', id: 'streamSpeed', type: 'range', label: 'Flow Speed', min: 4, max: 20 },
            { cat: 'Global', id: 'releaseInterval', type: 'range', label: 'Release Rhythm (Nth Tick)', min: 1, max: 10, step: 1 },
        
            { cat: 'Global', type: 'accordion_header', label: 'Rendering Quality' },
            { cat: 'Global', id: 'resolution', type: 'range', label: 'Resolution Scale', min: 0.5, max: 2.0, step: 0.1, transform: v=>v+'x' },
            { cat: 'Global', id: 'smoothingEnabled', type: 'checkbox', label: 'Anti-Aliasing' },
            { cat: 'Global', id: 'smoothingAmount', type: 'range', label: 'Blur Amount', min: 0.1, max: 2.0, step: 0.1, unit: 'px', dep: 'smoothingEnabled' },
        
            // APPEARANCE TAB
            { cat: 'Appearance', type: 'accordion_header', label: 'Colors' },
            { cat: 'Appearance', id: 'streamColor', type: 'color', label: 'Code Color' },
            { cat: 'Appearance', id: 'tracerColor', type: 'color', label: 'Tracer Color' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Glyph Details' },
            { cat: 'Appearance', id: 'fontSize', type: 'range', label: 'Font Size', min: 10, max: 80, unit: 'px' },
            { cat: 'Appearance', id: 'fontFamily', type: 'select', label: 'Font Family', options: () => this._getFonts() },
            { cat: 'Appearance', type: 'font_list' },
            { cat: 'Appearance', type: 'button', label: 'Import Font File (.ttf/.otf)', action: 'importFont', class: 'btn-info' },
            { cat: 'Appearance', id: 'fontWeight', type: 'select', label: 'Weight', options: [{label:'Thin',value:'100'},{label:'Light',value:'300'},{label:'Normal',value:'normal'},{label:'Bold',value:'bold'},{label:'Heavy',value:'900'}] },
            { cat: 'Appearance', id: 'italicEnabled', type: 'checkbox', label: 'Italicize' },
            { cat: 'Appearance', id: 'mirrorEnabled', type: 'checkbox', label: 'Mirror / Flip Text' },
            { cat: 'Appearance', id: 'variableBrightnessEnabled', type: 'checkbox', label: 'Variable Brightness', description: 'Randomizes the luminance of individual characters within a stream for a shimmering / flashing look.' },
            { cat: 'Appearance', id: 'brightnessVariance', type: 'range', label: 'Brightness Variance', min: 0, max: 90, unit: '%', dep: 'variableBrightnessEnabled' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Glow Effects' },
            { cat: 'Appearance', id: 'enableBloom', type: 'checkbox', label: 'Enable Code Glow' },
            { cat: 'Appearance', id: 'bloomStrength', type: 'range', label: 'Glow Radius', min: 1, max: 10, unit: 'px', dep: 'enableBloom' },
            { cat: 'Appearance', id: 'bloomOpacity', type: 'range', label: 'Glow Intensity', min: 0, max: 1, step: 0.05, dep: 'enableBloom' },
            { cat: 'Appearance', id: 'tracerGlow', type: 'range', label: 'Tracer Glow', min: 0, max: 50, unit:'px' },
            { cat: 'Appearance', id: 'clearAlpha', type: 'range', label: 'Burn-in', hideValue: true, min: 0.05, max: 1.0, step: 0.05, invert: true, description: 'Adjusts the phosphor persistence effect. Higher values leave longer, smeary trails behind moving characters.' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Character Effects' },
            { cat: 'Appearance', id: 'dissolveEnabled', type: 'checkbox', label: 'Dissolve (Shrink) Effect' }, 
            { cat: 'Appearance', id: 'dissolveMinSize', type: 'range', label: 'Dissolve Target Size', min: 1, max: 20, unit:'px', dep: 'dissolveEnabled' },
            { cat: 'Appearance', id: 'deteriorationEnabled', type: 'checkbox', label: 'Enable Ghosting' },
            { cat: 'Appearance', id: 'deteriorationStrength', type: 'range', label: 'Ghost Distance', min: 1, max: 10, unit: 'px', dep: 'deteriorationEnabled' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Grid Layout' },
            { cat: 'Appearance', id: 'horizontalSpacingFactor', type: 'range', label: 'Column Gap', min: 0.5, max: 2.0, step: 0.05 },
            { cat: 'Appearance', id: 'verticalSpacingFactor', type: 'range', label: 'Row Gap', min: 0.5, max: 2.0, step: 0.05 },
            { cat: 'Appearance', id: 'fontOffsetX', type: 'range', label: 'Cell Offset X', min: -20, max: 20, unit: 'px' },
            { cat: 'Appearance', id: 'fontOffsetY', type: 'range', label: 'Cell Offset Y', min: -20, max: 20, unit: 'px' },
            { cat: 'Appearance', id: 'stretchX', type: 'range', label: 'View Window Stretch X', min: 0.5, max: 3.0, step: 0.1 },
            { cat: 'Appearance', id: 'stretchY', type: 'range', label: 'View Window Stretch Y', min: 0.5, max: 3.0, step: 0.1 },
        
            // BEHAVIOR TAB
            { cat: 'Behavior', type: 'accordion_header', label: 'Streams' },
            { cat: 'Behavior', id: 'ttlMinSeconds', type: 'range', label: 'Min Life', min: 0.5, max: 20, step: 0.5, unit: 's' },
            { cat: 'Behavior', id: 'ttlMaxSeconds', type: 'range', label: 'Max Life', min: 1, max: 30, step: 0.5, unit: 's' },
            { cat: 'Behavior', id: 'decayFadeDurationFrames', type: 'range', label: 'Stream Fade Out Speed', min: 1, max: 120, unit:'fr' },
            { cat: 'Behavior', id: 'streamSpawnCount', type: 'range', label: 'Tracer Release Count', min: 1, max: 20, step: 1 },
            { cat: 'Behavior', id: 'eraserSpawnCount', type: 'range', label: 'Eraser Release Count', min: 0, max: 20, step: 1, dep: 'invertedTracerEnabled' },
            { cat: 'Behavior', id: 'minStreamGap', type: 'range', label: 'Min Gap Between Streams', min: 5, max: 50, unit: 'px' },
            { cat: 'Behavior', id: 'minEraserGap', type: 'range', label: 'Min Gap Before Eraser', min: 5, max: 50, unit: 'px' },
            { cat: 'Behavior', id: 'holeRate', type: 'range', label: 'Gaps / Broken Code', min: 0, max: 0.5, step: 0.05, transform: v=>(v*100).toFixed(0)+'%', description: 'Probability of missing data segments (empty spaces) appearing within a code stream.' },
        
            { cat: 'Behavior', type: 'accordion_header', label: 'Tracers' },
            { cat: 'Behavior', id: 'tracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'tracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'tracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'invertedTracerEnabled', type: 'checkbox', label: 'Inverted Tracers', description: "Spawns 'eraser' signals that travel downwards, clearing existing code trails." },
            { cat: 'Behavior', id: 'invertedTracerChance', type: 'range', label: 'Inverted Tracer Chance', min: 0.01, max: 0.20, step: 0.01, dep: 'invertedTracerEnabled', transform: v=>(v*100).toFixed(0)+'%' },
        
            { cat: 'Behavior', type: 'accordion_header', label: 'Rotators' },
            { cat: 'Behavior', id: 'rotatorEnabled', type: 'checkbox', label: 'Enable Rotators' },
            { cat: 'Behavior', id: 'rotatorChance', type: 'range', label: 'Rotator Chance', min: 0, max: 0.2, step: 0.01, dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotatorSyncToTracer', type: 'checkbox', label: 'Sync to Tracer cycles', dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotatorSyncMultiplier', type: 'range', label: 'Sync Divider', min: 0.1, max: 1, step: 0.1, dep: ['rotatorEnabled','rotatorSyncToTracer'], transform: v => v + 'x' },
            { cat: 'Behavior', id: 'rotatorCycleFactor', type: 'range', label: 'Rotation Speed', min: 1, max: 20, dep: ['rotatorEnabled', '!rotatorSyncToTracer'] },
            { cat: 'Behavior', id: 'rotatorCrossfadeFrames', type: 'range', label: 'Crossfade Smoothness', min: 1, max: 9, unit: 'fr', dep: 'rotatorEnabled' },
        
            { cat: 'Behavior', type: 'accordion_header', label: 'Movie FX' },
            { cat: 'Behavior', type: 'button', label: 'Trigger Pulse Now', action: 'pulse', class: 'btn-warn' },
            { cat: 'Behavior', id: 'pulseEnabled', type: 'checkbox', label: 'Enable Pulses' },
            { cat: 'Behavior', id: 'pulseFrequencySeconds', type: 'range', label: 'Frequency', min: 15, max: 300, step: 5, unit: 's', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseRandomPosition', type: 'checkbox', label: 'Random Pos', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit:'px', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseBlend', type: 'checkbox', label: 'Color Blend', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseDimming', type: 'range', label: 'Dimming', min: 0.0, max: 1.0, step: 0.05, dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseIgnoreTracers', type: 'checkbox', label: 'Ignore Tracers', dep: 'pulseEnabled' },
            { cat: 'Behavior', id: 'pulseCircular', type: 'checkbox', label: 'Circular', dep: 'pulseEnabled' },
            
            { cat: 'Behavior', type: 'button', label: 'Trigger Storm', action: 'minipulse', class: 'btn-warn' },
            { cat: 'Behavior', id: 'miniPulseEnabled', type: 'checkbox', label: 'Enable Storms' },
            { cat: 'Behavior', id: 'miniPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 30, max: 600, step: 10, unit: 's', dep: 'miniPulseEnabled' },
            { cat: 'Behavior', id: 'miniPulseDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, unit: 's', dep: 'miniPulseEnabled' },
            { cat: 'Behavior', id: 'miniPulseSpawnChance', type: 'range', label: 'Density', min: 0.01, max: 0.5, step: 0.01, dep: 'miniPulseEnabled' },
            { cat: 'Behavior', id: 'miniPulseSize', type: 'range', label: 'Blast Size', min: 50, max: 400, unit: 'px', dep: 'miniPulseEnabled' },
            { cat: 'Behavior', id: 'miniPulseThickness', type: 'range', label: 'Thickness', min: 10, max: 100, unit: 'px', dep: 'miniPulseEnabled' },
            { cat: 'Behavior', id: 'miniPulseSpeed', type: 'range', label: 'Speed', min: 5, max: 50, dep: 'miniPulseEnabled' },
        
            { cat: 'Behavior', type: 'button', label: 'Trigger Deja Vu Now', action: 'dejavu', class: 'btn-warn' },
            { cat: 'Behavior', id: 'dejaVuEnabled', type: 'checkbox', label: 'Enable Deja Vu' },
            { cat: 'Behavior', id: 'dejaVuFrequencySeconds', type: 'range', label: 'Frequency', min: 30, max: 600, step: 10, unit: 's', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuIntensity', type: 'range', label: 'Intensity', min: 0.01, max: 0.1, step: 0.01, dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, step: 0.1, unit: 's', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuBarDurationFrames', type: 'range', label: 'Flash Dur', min: 10, max: 60, unit: 'fr', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuVarianceFrames', type: 'range', label: 'Flash Var', min: 0, max: 120, unit: 'fr', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuMinRectHeight', type: 'range', label: 'Min Height', min: 2, max: 5, unit: 'rows', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuMaxRectHeight', type: 'range', label: 'Max Height', min: 6, max: 50, unit: 'rows', dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuHoleBrightness', type: 'range', label: 'Hole Bright', min: 0, max: 1, step: 0.01, dep: 'dejaVuEnabled' },
            { cat: 'Behavior', id: 'dejaVuRandomizeColors', type: 'checkbox', label: 'Colors', dep: 'dejaVuEnabled' },
            
            { cat: 'Behavior', type: 'button', label: 'Trigger Superman', action: 'superman', class: 'btn-warn' },
            { cat: 'Behavior', id: 'supermanEnabled', type: 'checkbox', label: 'Enable Superman FX' },
            { cat: 'Behavior', id: 'supermanDurationSeconds', type: 'range', label: 'Duration', min: 0.5, max: 6.0, step: 0.1, unit: 's', dep: 'supermanEnabled' },
            { cat: 'Behavior', id: 'supermanFlickerRate', type: 'range', label: 'Flicker Jitter', min: 1, max: 10, unit: 'fr', dep: 'supermanEnabled', description: 'Lower is faster electricity.' },
            { cat: 'Behavior', id: 'supermanWidth', type: 'range', label: 'Scatter Height', min: 1, max: 5, dep: 'supermanEnabled', description: 'How vertically erratic the lightning path is.' },
            { cat: 'Behavior', id: 'supermanIncludeColors', type: 'checkbox', label: 'Extra Bright', dep: 'supermanEnabled' },
            { cat: 'Behavior', id: 'supermanGlow', type: 'range', label: 'Voltage Glow', min: 1, max: 4, dep: 'supermanEnabled' },
            { cat: 'Behavior', id: 'supermanBoltThickness', type: 'range', label: 'Bolt Thickness', min: 1, max: 5, step: 1, dep: 'supermanEnabled' },

            { cat: 'Behavior', type: 'accordion_header', label: 'Special FX' },
            { cat: 'Behavior', id: 'starPowerEnabled', type: 'checkbox', label: 'Enable Star Power' },
            { cat: 'Behavior', id: 'starPowerFreq', type: 'range', label: 'Spawn Rate', min: 5, max: 100, dep: 'starPowerEnabled', unit:'%' },
            { cat: 'Behavior', id: 'starPowerRainbowMode', type: 'select', label: 'Color Mode', options: [{label:'Full Stream',value:'stream'}, {label:'Per Char',value:'char'}], dep: 'starPowerEnabled' },
            { cat: 'Behavior', id: 'starPowerColorCycle', type: 'checkbox', label: 'Cycle Colors', dep: 'starPowerEnabled' },
            { cat: 'Behavior', id: 'starPowerCycleSpeed', type: 'range', label: 'Cycle Speed', min: 1, max: 20, dep: 'starPowerEnabled' },
            { cat: 'Behavior', id: 'starPowerSaturation', type: 'range', label: 'Saturation', min: 0, max: 100, unit:'%', dep: 'starPowerEnabled' },
            { cat: 'Behavior', id: 'starPowerIntensity', type: 'range', label: 'Intensity', min: 10, max: 90, unit:'%', dep: 'starPowerEnabled' },
            { cat: 'Behavior', id: 'starPowerGlitter', type: 'checkbox', label: 'Glitter', dep: 'starPowerEnabled' },
            
            { cat: 'Behavior', id: 'rainbowStreamEnabled', type: 'checkbox', label: 'Enable Rainbow Streams' },
            { cat: 'Behavior', id: 'rainbowStreamChance', type: 'range', label: 'Rainbow Chance', min: 0.05, max: 1.0, step: 0.05, dep: 'rainbowStreamEnabled', transform: v=>(v*100).toFixed(0)+'%' },
            { cat: 'Behavior', id: 'rainbowStreamIntensity', type: 'range', label: 'Brightness', min: 10, max: 90, unit: '%', dep: 'rainbowStreamEnabled' },
        
            // SYSTEM TAB
            { cat: 'System', type: 'accordion_header', label: 'Config' },
            { cat: 'System', type: 'slot', idx: 0 },
            { cat: 'System', type: 'slot', idx: 1 },
            { cat: 'System', type: 'slot', idx: 2 },
            { cat: 'System', type: 'button', label: 'Export Config (JSON)', action: 'export', class: 'btn-info' },
            { cat: 'System', type: 'button', label: 'Import Config (JSON)', action: 'import', class: 'btn-info' },
        
            { cat: 'System', type: 'accordion_header', label: 'Maintenance' },
            { cat: 'System', type: 'button', label: 'Clear Font Cache', action: 'clearCache', class: 'btn-warn' },
            // CAUTION separator - will be handled in renderControl
            { cat: 'System', type: 'header', label: 'CAUTION ZONE' }, // Use header for visual separation and text
            { cat: 'System', type: 'button', label: 'Factory Reset All', action: 'reset', class: 'btn-danger', caution: true },
        
            { cat: 'System', type: 'accordion_header', label: 'About' },
            { cat: 'System', type: 'about_content' }
        ];
                        this.c.subscribe((k, s) => this.refresh(k));
                        this.init();
                    }
                    
                    _getFonts() { return [ {label:'Gothic (Win)', value:'"MS Gothic", monospace'}, {label:'Console', value:'Consolas, monaco, monospace'}, ...this.fonts.loadedFonts.map(f => ({label:f.display, value:f.name, custom:true})) ]; }
                    
                    updateFontList(el) {
                        el.innerHTML = '';
                        this.fonts.loadedFonts.filter(f => !f.isEmbedded).forEach(f => {
                            const div = document.createElement('div'); div.className = 'font-item';
                            div.innerHTML = `<span class="font-name">${f.display}</span>`;
                            const btn = document.createElement('div'); btn.className = 'font-delete-btn'; btn.innerHTML = '×';
                            btn.onclick = () => { if(confirm('Delete font?')) this.fonts.deleteFont(f.name); };
                            div.appendChild(btn); el.appendChild(div);
                        });
                    }
        
                    init() {
                        this.dom.toggle.onclick = () => this.dom.panel.classList.toggle('open');
                        this.dom.track = document.createElement('div'); this.dom.track.id = 'tabTrack'; this.dom.tabs.appendChild(this.dom.track);
                        if(!this.dom.tooltip) { this.dom.tooltip = document.createElement('div'); this.dom.tooltip.id = 'ui-tooltip'; document.body.appendChild(this.dom.tooltip); }
                        
                        // Ensure overflow handling matches standard behavior for wheel support
                        this.dom.tabs.style.overflowX = 'auto'; 
                        this.dom.tabs.style.overscrollBehaviorX = 'contain';
        
                        const cats = [...new Set(this.defs.map(d => d.cat))];
                        const tabContentContainers = {}; // Map category to its tab content container
        
                        cats.forEach((cat, i) => {
                            // Create Tab Button
                            const btn = document.createElement('button');
                            btn.className = `tab-btn ${i === 0 ? 'active' : ''}`;
                            btn.textContent = cat;
                            btn.onclick = () => { 
                                if(this.ignoreNextClick) return;
                                this.dom.tabs.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); 
                                this.dom.content.querySelectorAll('.tab-content-group').forEach(g=>g.classList.remove('active')); document.getElementById(`tab-content-${cat}`).classList.add('active'); 
                            };
                            this.dom.track.appendChild(btn);
        
                            // Create Tab Content Container (for accordions)
                            const tabContentGroup = document.createElement('div');
                            tabContentGroup.className = `tab-content-group ${i === 0 ? 'active' : ''}`;
                            tabContentGroup.id = `tab-content-${cat}`;
                            this.dom.content.appendChild(tabContentGroup);
                            tabContentContainers[cat] = tabContentGroup;
                        });
        
                        // Now populate tab content with accordions and controls
                        let activeAppendingBody = null; // Renamed for clarity: this is where we put controls
        
                        this.defs.forEach(d => {
                            const tabContentGroup = tabContentContainers[d.cat];
                            if (!tabContentGroup) return; // Should not happen with correct defs
        
                            if (d.type === 'accordion_header') {
                                const accordionItem = document.createElement('div');
                                accordionItem.className = 'accordion-item';
        
                                const header = document.createElement('div');
                                header.className = 'accordion-header';
                                header.innerHTML = `${d.label} <span class="accordion-icon"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>`;
                                accordionItem.appendChild(header);
        
                                const body = document.createElement('div');
                                body.className = 'accordion-content';
                                accordionItem.appendChild(body);
                                tabContentGroup.appendChild(accordionItem);
                                
                                activeAppendingBody = body; // Update the outer variable
        
                                header.onclick = () => {
                                    const isOpen = body.classList.contains('open');
                                    
                                    // Close peers
                                    tabContentGroup.querySelectorAll('.accordion-content').forEach(peerBody => {
                                        if (peerBody !== body) { 
                                            peerBody.classList.remove('open');
                                            if(peerBody.previousElementSibling) {
                                                peerBody.previousElementSibling.classList.remove('active');
                                                const icon = peerBody.previousElementSibling.querySelector('.accordion-icon');
                                                if(icon) icon.classList.remove('rotated');
                                            }
                                        }
                                    });
        
                                    // Toggle self
                                    if (isOpen) {
                                        body.classList.remove('open');
                                        header.classList.remove('active');
                                        header.querySelector('.accordion-icon').classList.remove('rotated');
                                    } else {
                                        body.classList.add('open');
                                        header.classList.add('active');
                                        header.querySelector('.accordion-icon').classList.add('rotated');
                                    }
                                };
                                
                                // Default open logic: Open if it is the FIRST accordion in this tab
                                const accordionsInTab = Array.from(tabContentGroup.children).filter(child => child.classList.contains('accordion-item'));
                                if (accordionsInTab.length === 1) { 
                                    body.classList.add('open');
                                    header.classList.add('active');
                                    header.querySelector('.accordion-icon').classList.add('rotated');
                                }
        
                            } else if (activeAppendingBody) {
                                // Handle special case for CAUTION ZONE in Maintenance accordion
                                if (d.cat === 'System' && d.label === 'CAUTION ZONE' && d.type === 'header') {
                                    const cautionZoneDiv = document.createElement('div');
                                    cautionZoneDiv.className = 'caution-zone';
                                    const headerEl = this.renderControl(d); // Render the header itself
                                    cautionZoneDiv.appendChild(headerEl);
                                    
                                    activeAppendingBody.appendChild(cautionZoneDiv); // Append container
                                    
                                    // Temporarily redirect append target for items inside caution zone
                                    const originalAppendingBody = activeAppendingBody;
                                    activeAppendingBody = cautionZoneDiv; 
                                    
                                    // Render next control (Factory Reset All) into cautionZoneDiv
                                    // Look ahead in defs
                                    const nextDefIndex = this.defs.indexOf(d) + 1;
                                    if (nextDefIndex < this.defs.length && this.defs[nextDefIndex].caution) {
                                        const nextControlElement = this.renderControl(this.defs[nextDefIndex]);
                                        if (nextControlElement) {
                                            activeAppendingBody.appendChild(nextControlElement);
                                            // Remove from defs iteration logic?? No, forEach continues.
                                            // We must flag it as processed or handle it.
                                            // Actually, the simplest way without modifying the loop structure is to let the loop hit it, 
                                            // but we need to know it's already done.
                                            // OR: simpler approach: Just let the loop continue. 
                                            // But 'activeAppendingBody' is now 'cautionZoneDiv'.
                                            // The next item will be appended to 'cautionZoneDiv'.
                                            // We just need to reset 'activeAppendingBody' back to 'originalAppendingBody' after the next item.
                                            // But we can't easily do that inside a forEach loop.
                                            
                                            // Alternative: Do NOT perform lookahead.
                                            // Just let 'activeAppendingBody' remain as 'cautionZoneDiv' for the next item.
                                            // But we need to break out of it after the next item.
                                            // This implies structure knowledge. 
                                            
                                            // Let's stick to the visual container logic:
                                            // We rendered the header. We set 'activeAppendingBody' to the caution div.
                                            // The NEXT item in the loop will be appended to 'activeAppendingBody' (the caution div).
                                            // We need a way to "pop" the stack.
                                            // Since we know it's the last item in the System tab usually, maybe it's fine?
                                            // Or we can flag the next item to pop.
                                            // Let's assume caution items are always leaf nodes in this specific UI.
                                            
                                            // Actually, simpler: Just render the caution zone container here, append the header.
                                            // Let the loop proceed.
                                            // The loop will append the next item to 'activeAppendingBody'.
                                            // If 'activeAppendingBody' is the caution zone, it works.
                                            // But subsequent items (if any) would also go there.
                                            // In this specific config, Factory Reset is the last item in Maintenance.
                                            // So it is fine.
                                        }
                                    }
                                } else {
                                    if (d.caution) return;
                                    const controlElement = this.renderControl(d);
                                    if (controlElement) {
                                        activeAppendingBody.appendChild(controlElement);
                                    }
                                }
                            }
                        });
        
                        document.getElementById('importFile').onchange = e => { 
                            const f = e.target.files[0]; if(!f) return; 
                            const r=new FileReader(); r.onload=ev=>{ try { const d=JSON.parse(ev.target.result); this.c.state={...this.c.defaults, ...d.state}; this.c.updateDerivedValues(); this.c.save(); this.c.notify('ALL'); this.notifications.show('Config Loaded', 'success'); } catch(e){ this.notifications.show('Invalid File', 'error'); } e.target.value = ''; }; r.readAsText(f); 
                        };
                        document.getElementById('importFontFile').onchange = e => { const f=e.target.files[0]; if(f) this.fonts.importFont(f); e.target.value = ''; };
        
                        // --- DRAG LOGIC ---
                        const startDrag = (e) => { if (e.button !== 0) return; this.scrollState.isDown = true; this.scrollState.startX = e.pageX - this.dom.tabs.offsetLeft; this.scrollState.scrollLeft = this.dom.tabs.scrollLeft; this.scrollState.dragDistance = 0; this.ignoreNextClick = false; this.dom.tabs.style.cursor = 'grabbing'; };
                        const stopDrag = () => { this.scrollState.isDown = false; this.dom.tabs.style.cursor = 'grab'; };
                        const doDrag = (e) => { if (!this.scrollState.isDown) return; e.preventDefault(); const x = e.pageX - this.dom.tabs.offsetLeft; const walk = (x - this.scrollState.startX) * 1.5; this.dom.tabs.scrollLeft = this.scrollState.scrollLeft - walk; this.scrollState.dragDistance += Math.abs(x - this.scrollState.startX); if (this.scrollState.dragDistance > 3) this.ignoreNextClick = true; };
        
                        this.dom.tabs.addEventListener('mousedown', startDrag); this.dom.tabs.addEventListener('mouseleave', stopDrag);
                        this.dom.tabs.addEventListener('mouseup', stopDrag); this.dom.tabs.addEventListener('mousemove', doDrag);
        
                        // --- MOUSE WHEEL SUPPORT ---
                                        // Converts vertical mouse wheel scrolling into horizontal scrolling for the tabs
                                        this.dom.tabs.addEventListener('wheel', (e) => {
                                            if (e.deltaY !== 0) {
                                                // preventDefault stops the browser "back" gesture or vertical page scroll
                                                e.preventDefault(); 
                                                this.dom.tabs.scrollLeft += e.deltaY;
                                            }
                                        }, { passive: false });
                        
                                        this.refresh('ALL');
                                    }
            showTooltip(text, target) {
                this.dom.tooltip.textContent = text; this.dom.tooltip.classList.add('visible');
                const rect = target.getBoundingClientRect(); const tipRect = this.dom.tooltip.getBoundingClientRect();
                let top = rect.top + (rect.height / 2) - (tipRect.height / 2); let left = rect.left - tipRect.width - 12; 
                if (top < 10) top = 10; if (left < 10) left = rect.right + 12; 
                this.dom.tooltip.style.top = `${top}px`; this.dom.tooltip.style.left = `${left}px`;
            }
            hideTooltip() { this.dom.tooltip.classList.remove('visible'); }

            createLabelGroup(d) {
                const group = document.createElement('div'); group.className = 'control-label-group';
                const text = document.createElement('span'); text.textContent = d.label; group.appendChild(text);
                if (d.description) {
                    const icon = document.createElement('span'); icon.className = 'info-icon'; icon.textContent = '?';
                    const show = (e) => this.showTooltip(d.description, e.target);
                    icon.onmouseenter = show; icon.onmouseleave = () => this.hideTooltip();
                    icon.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (this.dom.tooltip.classList.contains('visible')) { this.hideTooltip(); } else { show(e); setTimeout(() => this.hideTooltip(), 3000); } });
                    group.appendChild(icon);
                }
                return group;
            }

            renderControl(d) {
                if (d.type === 'accordion_header') { return null; }
                if (d.type === 'header') {
                    const el = document.createElement('div'); el.className = 'section-header'; el.textContent = d.label; return el;
                }
                if (d.type === 'about_content') {
                    const div = document.createElement('div'); div.style.padding = '1rem'; div.style.textAlign = 'center'; div.style.color = '#86efac';
                    div.innerHTML = `<h3 style="margin-top:0; margin-bottom: 1rem; color:#fff; font-size: 1.1rem; letter-spacing:1px;">Matrix Digital Rain</h3><div style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; margin-bottom:1.5rem;"><p style="margin:0.5rem 0;"><strong>Version:</strong> ${APP_VERSION}</p><p style="margin:0.5rem 0;"><strong>Created:</strong> November 2025</p></div><p style="font-size:0.9rem;"><a href="https://github.com/enigmahack" target="_blank" style="color:#22c55e; text-decoration:none; border-bottom:1px solid #22c55e; padding-bottom:2px; transition:all 0.2s;">github.com/enigmahack</a></p>`;
                    return div;
                }
                const row = document.createElement('div');
                if (d.type === 'button') {
                    const btn = document.createElement('button'); btn.className = `action-btn ${d.class||'btn-info'}`; btn.textContent = d.label; btn.id = `btn-${d.action}`; btn.name = d.action; btn.onclick = () => this.handleAction(d.action); row.appendChild(btn);
                } else if (d.type === 'slot') {
                    row.className = 'slot-container';
                    const inp = document.createElement('input'); inp.className = 'slot-name-input'; inp.value = this.c.slots[d.idx].name; inp.id = `slot-input-${d.idx}`; inp.name = `slot_name_${d.idx}`; inp.onchange = e => this.c.renameSlot(d.idx, e.target.value);
                    const grp = document.createElement('div'); grp.className = 'slot-btn-group';
                    const save = document.createElement('button'); save.className = 'btn-icon'; save.textContent = 'SAVE'; save.id = `btn-save-${d.idx}`; save.onclick = () => { this.c.saveToSlot(d.idx); this.notifications.show(`Saved Slot ${d.idx+1}`, 'success'); };
                    const load = document.createElement('button'); load.className = 'btn-icon'; load.textContent = 'LOAD'; load.id = `btn-load-${d.idx}`; load.onclick = () => { if(this.c.loadFromSlot(d.idx)) this.notifications.show(`Loaded Slot ${d.idx+1}`, 'success'); };
                    grp.append(save, load); row.append(inp, grp);
                } else if (d.type === 'font_list') {
                    row.className = 'font-manager-list'; row.id = 'fontListUI'; this.updateFontList(row);
                } else {
                    row.className = d.type === 'checkbox' ? 'checkbox-row' : 'control-row';
                    const labelGroup = this.createLabelGroup(d);
                    if(d.type !== 'checkbox') { const hdr = document.createElement('div'); hdr.className = 'control-header'; hdr.appendChild(labelGroup); 
                    if(!d.hideValue && d.type === 'range') { const valDisp = document.createElement('span'); valDisp.id = `val-${d.id}`; hdr.appendChild(valDisp); } row.appendChild(hdr); } 
                        else { row.appendChild(labelGroup); }
                    let inp;

                    if(d.type === 'range') { 
                        inp = document.createElement('input'); 
                        inp.type = 'range'; 
                        inp.min=d.min; 
                        inp.max=d.max; 
                        if(d.step) 
                            inp.step=d.step; 
                            inp.value = d.invert ? (d.max+d.min)-this.c.get(d.id) : this.c.get(d.id);                            
                            inp.oninput = e => { 
                                
                                    const v = parseFloat(e.target.value); 
                                    const actual = d.invert ? (d.max+d.min)-v : v; 
                                    this.c.set(d.id, actual); 
                                    const disp = document.getElementById(`val-${d.id}`); 
                                    
                                    if(disp) disp.textContent = d.transform ? d.transform(actual) : actual + (d.unit || '');
                                }; 

                            let startX = 0; 
                            let startY = 0; 
                            let isDragging = false; 
                            this._isDraggingHorizontally = false; 
                            inp.addEventListener('touchstart', e => { 
                                startX = e.touches[0].clientX; 
                                startY = e.touches[0].clientY; 
                                isDragging = true; 
                                this._isDraggingHorizontally = false; }); 

                            inp.addEventListener('touchmove', e => { 
                                if (!isDragging) return; 
                                    const currentX = e.touches[0].clientX; 
                                    const currentY = e.touches[0].clientY; const dx = currentX - startX; 
                                    const dy = currentY - startY; // If vertical movement is much greater than horizontal, prevent default 

                                if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { // Threshold of 10px to differentiate from accidental slight vertical movement 
                                    e.preventDefault(); this._isDraggingHorizontally = false; }
                                    else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { 
                                            this._isDraggingHorizontally = true; } 
                                        else { 
                                            this._isDraggingHorizontally = false; }}); 
                                            
                                        inp.addEventListener('touchend', () => { isDragging = false; this._isDraggingHorizontally = false; }); }

                    else if(d.type === 'color') { const w = document.createElement('div'); w.className = 'color-wrapper'; inp = document.createElement('input'); inp.type = 'color'; inp.value = this.c.get(d.id); inp.id = `in-${d.id}`; inp.name = d.id; inp.oninput = e => this.c.set(d.id, e.target.value); w.appendChild(inp); row.appendChild(w); if(d.dep) row.setAttribute('data-dep', JSON.stringify(d.dep)); if(d.id) row.id = `row-${d.id}`; return row; }
                    else if(d.type === 'checkbox') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = this.c.get(d.id); inp.onchange = e => this.c.set(d.id, e.target.checked); row.onclick = e => { if(e.target !== inp) { inp.checked = !inp.checked; inp.dispatchEvent(new Event('change')); }}; }
                    else if(d.type === 'select') { inp = document.createElement('select'); (typeof d.options === 'function' ? d.options() : d.options).forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; if(o.custom) opt.className = 'custom-font-opt'; if(this.c.get(d.id) === o.value) opt.selected = true; inp.appendChild(opt); }); inp.onchange = e => this.c.set(d.id, e.target.value); }
                    row.appendChild(inp);
                    if(d.id) { inp.id = `in-${d.id}`; inp.name = d.id; }
                    if(d.dep) row.setAttribute('data-dep', JSON.stringify(d.dep)); if(d.id) row.id = `row-${d.id}`;
                }
                return row;
            }

            handleAction(a) {
                if(a === 'reset' && confirm('Reset all settings?')) this.c.reset();
                if(a === 'clearCache' && confirm('Clear all custom fonts?')) this.fonts.deleteAllFonts().then(() => this.notifications.show('Cache Cleared', 'success'));
                if(a === 'export') Utils.downloadJson({version:APP_VERSION, state:this.c.state}, 'matrix_conf.json');
                if(a === 'import') document.getElementById('importFile').click();
                if(a === 'importFont') document.getElementById('importFontFile').click();
                if(a === 'pulse') { if(this.eff.trigger('Pulse')) this.notifications.show('Pulse Triggered', 'success'); else this.notifications.show('Pulse already active...', 'info'); }
                if(a === 'minipulse') { if(this.eff.trigger('MiniPulse')) this.notifications.show('Storm Triggered', 'success'); else this.notifications.show('Storm already active...', 'info'); }
                if(a === 'dejavu') { if(this.eff.trigger('DejaVu')) this.notifications.show('Deja Vu Triggered', 'success'); else this.notifications.show('Deja Vu already active...', 'info'); }
                if(a === 'superman') { if(this.eff.trigger('Superman')) this.notifications.show('Neo is flying...', 'success'); else this.notifications.show('Superman active...', 'info'); }
            }

            refresh(k) {
                try {
                    if(k === 'ALL') { this.defs.forEach(d => { if(d.id) this.refresh(d.id); }); this.refresh('fontFamily'); 
                        this.dom.content.querySelectorAll('.accordion-content').forEach(accordionBody => {
                            const allDepRows = accordionBody.querySelectorAll('[data-dep]');
                            allDepRows.forEach(row => {
                                try {
                                    const depRule = JSON.parse(row.getAttribute('data-dep')); const rules = Array.isArray(depRule) ? depRule : [depRule]; let conditionsMet = true;
                                    for (let rule of rules) { let target = rule; let expected = true; if (target.startsWith('!')) { target = target.substring(1); expected = false; } const actual = !!this.c.get(target); if (actual !== expected) { conditionsMet = false; break; } }
                                    if(conditionsMet) row.classList.remove('control-disabled'); else row.classList.add('control-disabled');
                                } catch(e) {}
                            });
                        });
                        return; 
                    }
                    if(k === 'fontFamily') {
                        const sel = document.getElementById('in-fontFamily');
                        if(sel) { sel.innerHTML = ''; this._getFonts().forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; if(o.custom) opt.className = 'custom-font-opt'; if(this.c.get('fontFamily') === o.value) opt.selected = true; sel.appendChild(opt); }); }
                        const list = document.getElementById('fontListUI'); if(list) this.updateFontList(list); return;
                    }
                    if(k) {
                        const inp = document.getElementById(`in-${k}`);
                        if(inp) { const def = this.defs.find(d=>d.id===k); if(def) { const val = this.c.get(k); if(def.type === 'checkbox') inp.checked = val; else if(def.type === 'range') { inp.value = def.invert ? (def.max+def.min)-val : val; const disp = document.getElementById(`val-${k}`); if(disp) disp.textContent = def.transform ? def.transform(val) : val + (def.unit || ''); } else inp.value = val; } }
                    }
                    this.dom.content.querySelectorAll(`[data-dep*="${k}"]`).forEach(row => {
                        try {
                            const depRule = JSON.parse(row.getAttribute('data-dep')); const rules = Array.isArray(depRule) ? depRule : [depRule]; let conditionsMet = true;
                            for (let rule of rules) { let target = rule; let expected = true; if (target.startsWith('!')) { target = target.substring(1); expected = false; } const actual = !!this.c.get(target); if (actual !== expected) { conditionsMet = false; break; } }
                            if(conditionsMet) row.classList.remove('control-disabled'); else row.classList.add('control-disabled');
                        } catch(e) {}
                    });
                } catch(e) { console.warn("UI Error", e); }
            }
        }
        
        // =========================================================================
        // 9. KERNEL
        // =========================================================================
