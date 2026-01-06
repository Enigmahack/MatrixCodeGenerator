class UIManager {
    constructor(c, effects, fonts, notificationMgr, charSelector) {
        // Core dependencies and state
        this.c = c;
        this.effects = effects; // Renamed from this.eff for clarity, consistency
        this.fonts = fonts;
        this.notifications = notificationMgr;
        this.charSelector = charSelector;
        this.dom = this._initializeDOM();
        this.scrollState = { isDown: false, startX: 0, scrollLeft: 0, dragDistance: 0 };
        this.ignoreNextClick = false; // Retain existing logic for drag/click distinction
        this.isKeyBindingActive = false; // Flag to suspend global key inputs
        this.defs = this._generateDefinitions();

        // Event subscriptions
        this.c.subscribe((key, state) => this.refresh(key));
        this.fonts.subscribe(() => this.refresh('fontFamily'));

        // Initialization
        this.init();
    }

    /**
     * Establish initial DOM structure using expected selectors and IDs.
     * @private
     */
    _initializeDOM() {
        return {
            panel: document.getElementById('settingsPanel'),
            toggle: document.getElementById('menuToggle'),
            tabs: document.getElementById('navTabs'),
            content: document.getElementById('contentArea'),
            tooltip: document.getElementById('ui-tooltip') || this._createTooltip(),
            keyTrap: document.getElementById('ui-key-trap') || this._createKeyTrap(),
            track: null, // Initialized later in init
        };
    }

    /**
     * Create invisible input trap for key binding.
     * @private
     */
    _createKeyTrap() {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'ui-key-trap';
        // Ensure element is rendered but invisible/unobtrusive
        input.style.position = 'fixed';
        input.style.top = '0';
        input.style.left = '0';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.zIndex = '-1';
        input.setAttribute('aria-hidden', 'true');
        document.body.appendChild(input);
        return input;
    }

    /**
     * Create the tooltip element and attach to the DOM.
     * @private
     */
    _createTooltip() {
        const tooltip = document.createElement('div');
        tooltip.id = 'ui-tooltip';
        document.body.appendChild(tooltip);
        return tooltip;
    }

    /**
     * Generate all UI component definitions for settings dynamically.
     * This method orchestrates the gathering of definitions from category-specific methods.
     * @private
     */
    _generateDefinitions() {
        return [
            ...this._generateGlobalSettings(),

            // APPEARANCE TAB
            ...this._generateAppearanceSettings(),

            // BEHAVIOR TAB
            ...this._generateBehaviorSettings(),

            // FX TAB
            ...this._generateFXSettings(),

            // SYSTEM TAB
            ...this._generateSystemTab()
        ];
    }

    /**
     * Generates definitions for the 'Global' settings category.
     * @private
     * @returns {Array<Object>} An array of UI control definition objects.
     */
    _generateGlobalSettings() {
        return [
            { cat: 'Global', type: 'accordion_header', label: 'Code Basics' },
            { cat: 'Global', id: 'backgroundColor', type: 'color', label: 'Background Color' },
            { cat: 'Global', id: 'streamPalette', type: 'color_list', label: 'Code Colors', max: 3 },
            { cat: 'Global', id: 'paletteBias', type: 'range', label: 'Color Mix', min: 0, max: 1, step: 0.05, transform: v=>(v*100).toFixed(0)+'% Mix', description: "Left: Solid Streams. Right: Random Characters. Middle: Blend." },
            { cat: 'Global', id: 'colorMixType', type: 'range', label: 'Mix Type', min: 0, max: 1, step: 0.05, transform: v => v < 0.3 ? 'Stream Colors' : (v > 0.7 ? 'Character Colors' : 'Mixed'), description: "Controls whether colors are assigned per-stream or per-character." },
            { cat: 'Global', id: 'tracerColor', type: 'color', label: 'Tracer Color', description: "The head of the stream that writes the code to the screen" },
            { cat: 'Global', id: 'fontSize', type: 'range', label: 'Font Size', min: 10, max: 80, step: 1, unit: 'px' },
            { cat: 'Global', id: 'streamSpeed', type: 'range', label: 'Flow Speed', min: 4, max: 20, step: 1 },
            { cat: 'Global', id: 'showFpsCounter', type: 'checkbox', label: 'Show FPS Counter', description: "Displays the current frames-per-second in the top-left corner." },

            { cat: 'Global', type: 'accordion_header', label: 'Rendering Quality' },
            { cat: 'Global', id: 'resolution', type: 'range', label: 'Resolution Scale', min: 0.5, max: 2.0, step: 0.1, transform: v=>v+'x' },
            { cat: 'Global', id: 'smoothingEnabled', type: 'checkbox', label: 'Anti-Aliasing', dep: '!shaderEnabled', description: 'Anti-aliasing is automatically disabled when a custom shader is in use.' },
            { cat: 'Global', id: 'smoothingAmount', type: 'range', label: 'Blur Amount', min: 0.1, max: 2.0, step: 0.1, unit: 'px', dep: ['smoothingEnabled', '!shaderEnabled'] },
        ];
    }


    /**
     * Generates definitions for the 'Appearance' settings category.
     * @private
     * @returns {Array<Object>} An array of UI control definition objects.
     */
    _generateAppearanceSettings() {
        return [
            { cat: 'Appearance', type: 'accordion_header', label: 'Character Customization' },
            { cat: 'Appearance', id: 'fontFamily', type: 'select', label: 'Font Family', options: () => this._getFonts() },
            { cat: 'Appearance', type: 'font_list' },
            { cat: 'Appearance', type: 'button', label: 'Manage Character Sets', action: 'manageCharacters', class: 'btn-info' },
            { cat: 'Appearance', type: 'button', label: 'Import Font File (.ttf/.otf)', action: 'importFont', class: 'btn-info' },
            { cat: 'Appearance', id: 'italicEnabled', type: 'checkbox', label: 'Italicize' },
            { cat: 'Appearance', id: 'mirrorEnabled', type: 'checkbox', label: 'Mirror / Flip Text' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Character Effects' }, // Main Accordion Header
            { cat: 'Appearance', type: 'accordion_subheader', label: 'General' },
            { cat: 'Appearance', id: 'variableBrightnessEnabled', type: 'checkbox', label: 'Variable Brightness', description: 'Allows for brightness variance when characters are written' },
            { cat: 'Appearance', id: 'brightnessVariance', type: 'range', label: 'Brightness Variance', min: 0, max: 90, unit: '%', dep: 'variableBrightnessEnabled' },
            
            { cat: 'Appearance', type: 'accordion_subheader', label: 'Stream Trails' },
            { cat: 'Appearance', id: 'decayFadeDurationFrames', type: 'range', label: 'Stream Fade Out Speed', min: 1, max: 180, unit:'fr' },
            { cat: 'Appearance', id: 'trailLengthVarianceEnabled', type: 'checkbox', label: 'Variable Trail Length' },
            { cat: 'Appearance', id: 'trailLengthVariance', type: 'range', label: 'Length Variance', min: 0, max: 600, unit: 'fr', dep: 'trailLengthVarianceEnabled', description: "Randomizes the length of the trail. Range is between Fade Speed and this value." },
            { cat: 'Appearance', id: 'dissolveEnabled', type: 'checkbox', label: 'Dissolving Stream Trails' }, 
            { cat: 'Appearance', id: 'dissolveScalePercent', type: 'range', label: 'Dissolve Scale', min: -100, max: 100, unit: '%', dep: 'dissolveEnabled', description: 'Percentage size change during dissolve. Negative values shrink, positive values grow.' },
            { cat: 'Appearance', id: 'deteriorationEnabled', type: 'checkbox', label: 'Enable Trail Ghosting' },
            { cat: 'Appearance', id: 'deteriorationStrength', type: 'range', label: 'Ghosting Offset', min: 1, max: 10, unit: 'px', dep: 'deteriorationEnabled' },
            
            { cat: 'Appearance', type: 'accordion_subheader', label: 'Character Overlap' },
            { cat: 'Appearance', id: 'overlapEnabled', type: 'checkbox', label: 'Enable Overlap' },
            { cat: 'Appearance', id: 'overlapColor', type: 'color', label: 'Overlap Color', dep: 'overlapEnabled' },
            { cat: 'Appearance', id: 'overlapDensity', type: 'range', label: 'Overlap Density', min: 0.1, max: 1.0, step: 0.1, dep: 'overlapEnabled' },
            { cat: 'Appearance', id: 'overlapTarget', type: 'select', label: 'Overlap Target', options: [{label:'Streams Only',value:'stream'},{label:'All Characters',value:'all'}], dep: 'overlapEnabled' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Glow Effects' },
            { cat: 'Appearance', id: 'enableBloom', type: 'checkbox', label: 'Enable Code Glow' },
            { cat: 'Appearance', id: 'bloomStrength', type: 'range', label: 'Glow Radius', min: 1, max: 10, unit: 'px', dep: 'enableBloom' },
            { cat: 'Appearance', id: 'bloomOpacity', type: 'range', label: 'Glow Intensity', min: 0, max: 1, step: 0.05, dep: 'enableBloom' },
            { cat: 'Appearance', id: 'clearAlpha', type: 'range', label: 'Burn-in', hideValue: true, min: 0.0, max: 1.0, step: 0.01, invert: true, description: 'Adjusts the phosphor persistence effect. Higher values leave longer, smeary trails behind moving characters.' },
        
            { cat: 'Appearance', type: 'accordion_header', label: 'Grid Layout' },
            { cat: 'Appearance', id: 'horizontalSpacingFactor', type: 'range', label: 'Column Gap', min: 0.5, max: 2.0, step: 0.05 },
            { cat: 'Appearance', id: 'verticalSpacingFactor', type: 'range', label: 'Row Gap', min: 0.5, max: 2.0, step: 0.05 },
            { cat: 'Appearance', id: 'fontOffsetX', type: 'range', label: 'Cell Offset X', min: -100, max: 100, unit: 'px' },
            { cat: 'Appearance', id: 'fontOffsetY', type: 'range', label: 'Cell Offset Y', min: -100, max: 100, unit: 'px' },
            
            // View Window Controls
            { cat: 'Appearance', id: 'stretchX', type: 'range', label: 'View Window Stretch X', min: 0.5, max: 3.0, step: 0.1 },
            { cat: 'Appearance', id: 'stretchY', type: 'range', label: 'View Window Stretch Y', min: 0.5, max: 3.0, step: 0.1 },
        ];
    }

    /**
     * Generates definitions for the 'Behavior' settings category.
     * @private
     * @returns {Array<Object>} An array of UI control definition objects.
     */
    _generateBehaviorSettings() {
        return [
            { cat: 'Behavior', type: 'accordion_header', label: 'Streams' },
            { cat: 'Behavior', id: 'releaseInterval', type: 'range', label: 'Event Timer', description: "For synchronized events (like tracer release) this is the interval between events.", min: 1, max: 10, step: 1 },
            { cat: 'Behavior', id: 'desyncIntensity', type: 'range', label: 'Tracer Desync', min: 0, max: 1, step: 0.05, transform: v=>(v*100).toFixed(0)+'%', description: "Varies the speed and release timing of tracers. 0% is uniform sync." },
            { cat: 'Behavior', id: 'minStreamGap', type: 'range', label: 'Min Gap Between Streams', min: 2, max: 50, unit: 'px' },
            { cat: 'Behavior', id: 'minEraserGap', type: 'range', label: 'Min Gap Between Erasers', min: 2, max: 50, unit: 'px' },
            { cat: 'Behavior', id: 'minGapTypes', type: 'range', label: 'Min Gap Between Types', min: 1, max: 100, unit: 'px', description: "Minimum space between tracer types, preventing short streams" },
            { cat: 'Behavior', id: 'allowTinyStreams', type: 'checkbox', label: 'Allow Tiny Streams', description: "Increases the probability of very short streams spawning." },
            { cat: 'Behavior', id: 'gradualColorStreams', type: 'checkbox', label: 'Gradual Color Streams', description: "Immediately blends tracer color to stream color behind the head, removing tracer glow." },
            { cat: 'Behavior', id: 'holeRate', type: 'range', label: 'Gaps in Code Stream', min: 0, max: 0.5, step: 0.01, transform: v=>(v*100).toFixed(0)+'%', description: 'Probability of missing data segments (empty spaces) appearing within a code stream.' },
        
            { cat: 'Behavior', type: 'accordion_header', label: 'Tracers' },
            { cat: 'Behavior', type: 'accordion_subheader', label: 'Tracers'},
            { cat: 'Behavior', id: 'streamSpawnCount', type: 'range', label: 'Tracer Release Count', min: 1, max: 20, step: 1, description: "Maximum number of tracers released per-cycle" },
            { cat: 'Behavior', id: 'preferClusters', type: 'checkbox', label: 'Prefer Clusters', description: "Slightly increases the chance of tracers spawning side-by-side." },
            { cat: 'Behavior', id: 'tracerStopChance', type: 'range', label: 'Tracer Drop-out', min: 0, max: 10, step: 1, transform: v=>v+'%', description: 'Chance for a tracer to randomly stop, leaving a hanging stream.'},
            { cat: 'Behavior', id: 'tracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'tracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'tracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 20, unit: 'fr' },
            { cat: 'Behavior', id: 'tracerGlow', type: 'range', label: 'Tracer Glow', min: 0, max: 50, unit:'px' },
            { cat: 'Behavior', type: 'accordion_subheader', label: 'Erasers'},
            { cat: 'Behavior', id: 'eraserSpawnCount', type: 'range', label: 'Eraser Release Count', min: 0, max: 20, step: 1, description: "Invisible tracers that start erasing code" },
            { cat: 'Behavior', id: 'eraserStopChance', type: 'range', label: 'Eraser Drop-out', min: 0, max: 10, step: 1, transform: v=>v+'%', description: 'Chance for an eraser to randomly stop, leaving a hanging stream.' },
            { cat: 'Behavior', type: 'accordion_subheader', label: 'Inverted Tracers'},
            { cat: 'Behavior', id: 'invertedTracerEnabled', type: 'checkbox', label: 'Inverted Tracers', description: "Tracers that only write occassional characters" },
            { cat: 'Behavior', id: 'invertedTracerChance', type: 'range', label: 'Inverted Frequency', min: 0.01, max: 0.20, step: 0.01, dep: 'invertedTracerEnabled', transform: v=>(v*100).toFixed(0)+'%'},

            { cat: 'Behavior', type: 'accordion_header', label: 'Glimmer Tracers'},
            { cat: 'Behavior', id: 'upwardTracerEnabled', type: 'checkbox', label: 'Glimmer Tracers', description: 'Invisible scanners that light up existing code' },
            { cat: 'Behavior', id: 'upwardTracerChance', type: 'range', label: 'Frequency', min: 0, max: 1.0, step: 0.01, transform: v=>(v*100).toFixed(0)+'%', dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerSpeedMult', type: 'range', label: 'Vertical Climb Speed', min: 0.5, max: 4.0, step: 0.1, transform: v=>v+'x', dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerGlimmerSpeed', type: 'range', label: 'Glimmer Blink Speed', min: 0.01, max: 10.0, step: 0.01, dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerGlimmerSize', type: 'range', label: 'Glimmer Grid Size', min: 2, max: 6, step: 1, dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerGlimmerFill', type: 'range', label: 'Glimmer Fill', min: 2, max: 12, step: 1, dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerGlimmerGlow', type: 'range', label: 'Glimmer Glow', min: 0, max: 50, step: 1, dep: 'upwardTracerEnabled' },
            { cat: 'Behavior', id: 'upwardTracerGlimmerFlicker', type: 'range', label: 'Glimmer Flicker', min: 0.0, max: 1.0, step: 0.05, dep: 'upwardTracerEnabled', transform: v=>(v*100).toFixed(0)+'%' },
            
            { cat: 'Behavior', type: 'accordion_header', label: 'Rotators' },
            { cat: 'Behavior', id: 'rotatorEnabled', type: 'checkbox', label: 'Symbol Rotator' },
            { cat: 'Behavior', id: 'rotatorChance', type: 'range', label: 'Rotator Chance', min: 0, max: 1.0, step: 0.01, dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotatorSyncToTracer', type: 'checkbox', label: 'Sync to Tracer cycles', dep: 'rotatorEnabled', description: "Lock the rotator change to the cycles that move the tracers" },
            { cat: 'Behavior', id: 'rotatorSyncMultiplier', type: 'range', label: 'Sync Divider', min: 0.1, max: 1, step: 0.1, dep: ['rotatorEnabled','rotatorSyncToTracer'], transform: v => v + 'x' },
            { cat: 'Behavior', id: 'rotatorCycleFactor', type: 'range', label: 'Rotation Speed', min: 1, max: 20, dep: ['rotatorEnabled', '!rotatorSyncToTracer'] },
            { cat: 'Behavior', id: 'rotatorCrossfadeFrames', type: 'range', label: 'Crossfade Smoothness', min: 1, max: 9, unit: 'fr', dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotateDuringFade', type: 'checkbox', label: 'Rotate during fade', dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotatorDesyncEnabled', type: 'checkbox', label: 'Desynchronize Rotators', dep: 'rotatorEnabled' },
            { cat: 'Behavior', id: 'rotatorDesyncVariance', type: 'range', label: 'Desync Variance', min: 0, max: 100, unit: '%', dep: ['rotatorEnabled', 'rotatorDesyncEnabled'] },
        ];
    }

    /**
     * Generates definitions for the 'FX' settings category.
     * @private
     * @returns {Array<Object>} An array of UI control definition objects.
     */
    _generateFXSettings() {
        return [
            { cat: 'Effects', type: 'header', label: 'Movie Effects' }, // Using header for main section
            
            { cat: 'Effects', type: 'header', label: 'Trilogy' }, // Sub-header

            { cat: 'Effects', type: 'accordion_header', label: 'Pulse' },
            { cat: 'Effects', type: 'button', label: 'Trigger Pulse Now', action: 'pulse', class: 'btn-warn' },
            { cat: 'Effects', id: 'pulseEnabled', type: 'checkbox', label: 'Enable Pulses' },
            { cat: 'Effects', id: 'pulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'pulseEnabled', description: "Enables movie-accurate timing and visuals, disabling custom controls." },
            { cat: 'Effects', id: 'pulseFrequencySeconds', type: 'range', label: 'Frequency', min: 15, max: 300, step: 5, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseDelaySeconds', type: 'range', label: 'Delay', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseIgnoreTracers', type: 'checkbox', label: 'Preserve Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseDimming', type: 'range', label: 'Initial Dim Amount', min: 0.0, max: 1.0, step: 0.05, dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['pulseEnabled', '!pulseMovieAccurate'], description: "Blend the outer edge (tracer color) to inner edge (code color)" },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit:'px', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            { cat: 'Effects', id: 'pulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['pulseEnabled', '!pulseMovieAccurate'], description: "Start at a full square" },
            { cat: 'Effects', id: 'pulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
            
            { cat: 'Effects', type: 'accordion_header', label: 'Clear Pulse' },
            { cat: 'Effects', type: 'button', label: 'Trigger Clear Pulse Now', action: 'clearpulse', class: 'btn-warn' },
            { cat: 'Effects', id: 'clearPulseEnabled', type: 'checkbox', label: 'Enable Clear Pulse' },
            { cat: 'Effects', id: 'clearPulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'clearPulseEnabled', description: "Enables movie-accurate visual artifacts (tearing/lag) without dimming the screen." },
            { cat: 'Effects', id: 'clearPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 15, max: 300, step: 5, unit: 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], description: "Blend the outer edge (tracer color) to inner edge (code color)" },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit:'px', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
            { cat: 'Effects', id: 'clearPulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], description: "Start at a full square" },
            { cat: 'Effects', id: 'clearPulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },

            { cat: 'Effects', type: 'accordion_header', label: 'Pulse Storm' },
            { cat: 'Effects', type: 'button', label: 'Trigger Pulse Storm Now', action: 'minipulse', class: 'btn-warn' },
            { cat: 'Effects', id: 'miniPulseEnabled', type: 'checkbox', label: 'Enable Storms' },
            { cat: 'Effects', id: 'miniPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 30, max: 600, step: 10, unit: 's', dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, unit: 's', dep: 'miniPulseEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: 'miniPulseEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseThickness', type: 'range', label: 'Wave Width', min: 10, max: 150, unit: 'px', dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseSpawnChance', type: 'range', label: 'Density', min: 0.01, max: 0.5, step: 0.01, dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseSpeed', type: 'range', label: 'Speed', min: 5, max: 50, dep: 'miniPulseEnabled' },
            { cat: 'Effects', id: 'miniPulseSize', type: 'range', label: 'Blast Size Max', min: 50, max: 400, unit: 'px', dep: 'miniPulseEnabled' },
        
            { cat: 'Effects', type: 'accordion_header', label: 'Deja Vu' },
            { cat: 'Effects', type: 'button', label: 'Trigger Deja Vu Now', action: 'dejavu', class: 'btn-warn' },
            { cat: 'Effects', id: 'dejaVuEnabled', type: 'checkbox', label: 'Enable Deja Vu' },
            { cat: 'Effects', id: 'dejaVuFrequencySeconds', type: 'range', label: 'Frequency', min: 30, max: 600, step: 10, unit: 's', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, step: 0.1, unit: 's', dep: 'dejaVuEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuMinRectHeight', type: 'range', label: 'Minimum Thickness', min: 2, max: 5, unit: 'rows', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuMaxRectHeight', type: 'range', label: 'Maximum Thickness', min: 6, max: 50, unit: 'rows', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuHoleBrightness', type: 'range', label: 'Intensity', min: 0, max: 1, step: 0.01, dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuRandomizeColors', type: 'checkbox', label: 'Enable Color Writing', dep: 'dejaVuEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuIntensity', type: 'range', label: 'Flash Frequency', min: 0.01, max: 0.1, step: 0.01, dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuBarDurationFrames', type: 'range', label: 'Flash Length', min: 10, max: 60, unit: 'fr', dep: 'dejaVuEnabled' },
            { cat: 'Effects', id: 'dejaVuVarianceFrames', type: 'range', label: 'Flash Length Variance', min: 0, max: 120, unit: 'fr', dep: 'dejaVuEnabled' },
            
            { cat: 'Effects', type: 'accordion_header', label: 'Superman' },
            { cat: 'Effects', type: 'button', label: 'Trigger Superman', action: 'superman', class: 'btn-warn' },
            { cat: 'Effects', id: 'supermanEnabled', type: 'checkbox', label: 'Enable Superman Effects' },
            { cat: 'Effects', id: 'supermanFrequencySeconds', type: 'range', label: 'Frequency', min: 15, max: 300, step: 5, unit: 's', dep: 'supermanEnabled' },
            { cat: 'Effects', id: 'supermanDurationSeconds', type: 'range', label: 'Duration', min: 0.5, max: 6.0, step: 0.1, unit: 's', dep: 'supermanEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'supermanEnabled' },
            { cat: 'Effects', id: 'supermanGlow', type: 'range', label: 'Glow amount', min: 1, max: 10, dep: 'supermanEnabled' },
            { cat: 'Effects', id: 'supermanFadeSpeed', type: 'range', label: 'Fade Duration', min: 5, max: 60, dep: 'supermanEnabled', description: 'Higher values mean trails last longer.' },
            { cat: 'Effects', id: 'supermanBoltThickness', type: 'range', label: 'Bolt Thickness', min: 1, max: 10, step: 1, dep: 'supermanEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'supermanEnabled' },
            { cat: 'Effects', id: 'supermanFlickerRate', type: 'range', label: 'Flicker Jitter', min: 1, max: 10, unit: 'fr', dep: 'supermanEnabled', description: 'Lower is faster electricity.' },
            { cat: 'Effects', id: 'supermanWidth', type: 'range', label: 'Scatter Height', min: 1, max: 10, dep: 'supermanEnabled', description: 'How vertically erratic the lightning path is.' },
            { cat: 'Effects', id: 'supermanSpawnSpeed', type: 'range', label: 'Bolt Speed', min: 10, max: 100, dep: 'supermanEnabled', description: 'Speed from left to right' },

            { cat: 'Effects', type: 'accordion_header', label: 'Boot/Crash' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Boot Sequence' },
            { cat: 'Effects', id: 'bootSequenceEnabled', type: 'checkbox', label: 'Start Code with Boot' },
            { cat: 'Effects', type: 'button', label: 'Trigger Boot Now', action: 'boot', class: 'btn-warn' },
            
            { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Sequence' },
            { cat: 'Effects', id: 'crashEnabled', type: 'checkbox', label: 'Enable Crash' },
            { cat: 'Effects', id: 'crashFrequencySeconds', type: 'range', label: 'Frequency', min: 60, max: 600, step: 10, unit: 's', dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashDurationSeconds', type: 'range', label: 'Duration', min: 5, max: 120, step: 5, unit: 's', dep: 'crashEnabled' },
            
            { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Visuals', dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashSheetCount', type: 'range', label: 'Shadowbox Density', min: 0, max: 200, step: 1, dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashSheetSpeed', type: 'range', label: 'Shadowbox Speed', min: 0.1, max: 3.0, step: 0.1, dep: 'crashEnabled', transform: v=>v+'x' },
            { cat: 'Effects', id: 'crashSheetOpacity', type: 'range', label: 'Shadowbox Opacity', min: 0.0, max: 1.0, step: 0.01, dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashStationaryChance', type: 'range', label: 'Shadowbox Movement Level', min: 0, max: 100, unit: '%', invert: true, dep: 'crashEnabled', description: "How likely a shadow box is to move when spawned." },
            { cat: 'Effects', id: 'crashFlashDelayMin', type: 'range', label: 'Flash Delay Min', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashFlashDelayMax', type: 'range', label: 'Flash Delay Max', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled' },
            
            { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Features', dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashMovieFps', type: 'checkbox', label: 'Movie FPS', dep: 'crashEnabled', description: "When enabled, locks the rendering to 30 fps for most effects." },
            { cat: 'Effects', id: 'crashEnableSmith', type: 'checkbox', label: 'Enable Agent Smith', description: "Randomly introduces agent Smith within the crash. Subtle.", dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashEnableSuperman', type: 'checkbox', label: 'Enable Code Bolts', dep: 'crashEnabled' },
            { cat: 'Effects', id: 'crashEnableFlash', type: 'checkbox', label: 'Enable Flash/Fade', dep: 'crashEnabled' },

            { cat: 'Effects', type: 'button', label: 'Trigger Crash Now', action: 'crash', class: 'btn-warn', dep: 'crashEnabled' },

            { cat: 'Effects', type: 'accordion_subheader', label: 'Macros' },
            { cat: 'Effects', id: 'runBothInOrder', type: 'checkbox', label: 'Run Both in Order', description: 'Automatically triggers the Crash sequence after the Boot sequence completes.' },
            { cat: 'Effects', type: 'button', label: 'Trigger Sequence Now', action: 'boot_crash_sequence', class: 'btn-warn' },

            { cat: 'Effects', type: 'header', label: 'Resurrections' }, // Sub-header

            { cat: 'Effects', type: 'accordion_header', label: 'Quantized Pulse' },
            { cat: 'Effects', type: 'button', label: 'Trigger Quantized Pulse', action: 'quantizedPulse', class: 'btn-warn' },
            { cat: 'Effects', id: 'quantizedPulseEnabled', type: 'checkbox', label: 'Enable Quantized Pulse' },
            { cat: 'Effects', id: 'quantizedPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 10, max: 300, step: 5, unit: 's', dep: 'quantizedPulseEnabled' },
            { cat: 'Effects', id: 'quantizedPulseDurationSeconds', type: 'range', label: 'Max Duration', min: 0.5, max: 10, step: 0.1, unit: 's', dep: 'quantizedPulseEnabled' },
            { cat: 'Effects', id: 'quantizedPulseSpeed', type: 'range', label: 'Speed', min: 1, max: 10, step: 1, invert: true, dep: 'quantizedPulseEnabled', description: "Controls the animation update rate. Right = Fast (Update every cycle). Left = Slow (Update every 10 cycles)." },
            { cat: 'Effects', id: 'quantizedPulseFadeInFrames', type: 'range', label: 'Fade In', min: 0, max: 60, unit: 'fr', dep: 'quantizedPulseEnabled' },
            { cat: 'Effects', id: 'quantizedPulseFadeFrames', type: 'range', label: 'Fade Out', min: 0, max: 60, unit: 'fr', dep: 'quantizedPulseEnabled' },
            { cat: 'Effects', id: 'quantizedBlockWidthCells', type: 'range', label: 'Block Width', min: 1, max: 20, step: 1, dep: 'quantizedPulseEnabled', description: "Width of each block in character cells." },
            { cat: 'Effects', id: 'quantizedBlockHeightCells', type: 'range', label: 'Block Height', min: 1, max: 20, step: 1, dep: 'quantizedPulseEnabled', description: "Height of each block in character cells." },
            { cat: 'Effects', id: 'quantizedPulseBorderIllumination', type: 'range', label: 'Border Illumination', min: 0.0, max: 10.0, step: 0.1, dep: 'quantizedPulseEnabled' },

            { cat: 'Effects', type: 'accordion_header', label: 'Quantized Add' },
            { cat: 'Effects', type: 'button', label: 'Trigger Quantized Add', action: 'quantizedAdd', class: 'btn-warn' },
            { cat: 'Effects', id: 'quantizedAddEnabled', type: 'checkbox', label: 'Enable Quantized Add' },
            { cat: 'Effects', id: 'quantizedAddFrequencySeconds', type: 'range', label: 'Frequency', min: 10, max: 300, step: 5, unit: 's', dep: 'quantizedAddEnabled' },
            { cat: 'Effects', id: 'quantizedAddDurationSeconds', type: 'range', label: 'Max Duration', min: 0.5, max: 10, step: 0.1, unit: 's', dep: 'quantizedAddEnabled' },
            { cat: 'Effects', id: 'quantizedAddFadeInFrames', type: 'range', label: 'Fade In', min: 0, max: 60, unit: 'fr', dep: 'quantizedAddEnabled' },
            { cat: 'Effects', id: 'quantizedAddFadeFrames', type: 'range', label: 'Fade Out', min: 0, max: 60, unit: 'fr', dep: 'quantizedAddEnabled' },
            { cat: 'Effects', id: 'quantizedAddBorderIllumination', type: 'range', label: 'Border Illumination', min: 0.0, max: 10.0, step: 0.1, dep: 'quantizedAddEnabled' },

            { cat: 'Effects', type: 'accordion_header', label: 'Quantized Retract' },
            { cat: 'Effects', type: 'button', label: 'Trigger Quantized Retract', action: 'quantizedRetract', class: 'btn-warn' },
            { cat: 'Effects', id: 'quantizedRetractEnabled', type: 'checkbox', label: 'Enable Quantized Retract' },
            { cat: 'Effects', id: 'quantizedRetractFrequencySeconds', type: 'range', label: 'Frequency', min: 10, max: 300, step: 5, unit: 's', dep: 'quantizedRetractEnabled' },
            { cat: 'Effects', id: 'quantizedRetractDurationSeconds', type: 'range', label: 'Max Duration', min: 0.5, max: 10, step: 0.1, unit: 's', dep: 'quantizedRetractEnabled' },
            { cat: 'Effects', id: 'quantizedRetractFadeInFrames', type: 'range', label: 'Fade In', min: 0, max: 60, unit: 'fr', dep: 'quantizedRetractEnabled' },
            { cat: 'Effects', id: 'quantizedRetractFadeFrames', type: 'range', label: 'Fade Out', min: 0, max: 60, unit: 'fr', dep: 'quantizedRetractEnabled' },
            { cat: 'Effects', id: 'quantizedRetractBorderIllumination', type: 'range', label: 'Border Illumination', min: 0.0, max: 10.0, step: 0.1, dep: 'quantizedRetractEnabled' },

            { cat: 'Effects', type: 'header', label: 'Special Effects' }, // Header for Special Effects

            { cat: 'Effects', type: 'accordion_header', label: 'Star Power' },
            { cat: 'Effects', id: 'starPowerEnabled', type: 'checkbox', label: 'Enable Star Power' },
            { cat: 'Effects', id: 'starPowerFreq', type: 'range', label: 'Frequency', min: 5, max: 100, dep: 'starPowerEnabled', unit:'%' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'starPowerEnabled' },
            { cat: 'Effects', id: 'starPowerRainbowMode', type: 'select', label: 'Color Mode', options: [{label:'Full Stream',value:'stream'}, {label:'Per Char',value:'char'}], dep: 'starPowerEnabled' },
            { cat: 'Effects', id: 'starPowerSaturation', type: 'range', label: 'Saturation', min: 0, max: 100, unit:'%', dep: 'starPowerEnabled' },
            { cat: 'Effects', id: 'starPowerIntensity', type: 'range', label: 'Intensity', min: 10, max: 90, unit:'%', dep: 'starPowerEnabled' },
            { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'starPowerEnabled' },
            { cat: 'Effects', id: 'starPowerColorCycle', type: 'checkbox', label: 'Cycle Colors', dep: 'starPowerEnabled' },
            { cat: 'Effects', id: 'starPowerCycleSpeed', type: 'range', label: 'Cycle Speed', min: 1, max: 20, dep: 'starPowerEnabled' },
            
            { cat: 'Effects', type: 'accordion_header', label: 'Rainbow Streams' },
            { cat: 'Effects', id: 'rainbowStreamEnabled', type: 'checkbox', label: 'Enable Rainbow Streams' },
            { cat: 'Effects', id: 'rainbowStreamChance', type: 'range', label: 'Frequency', min: 0.05, max: 1.0, step: 0.05, dep: 'rainbowStreamEnabled', transform: v=>(v*100).toFixed(0)+'%' },
            { cat: 'Effects', id: 'rainbowStreamIntensity', type: 'range', label: 'Brightness', min: 10, max: 90, unit: '%', dep: 'rainbowStreamEnabled' },
            
            { cat: 'Effects', type: 'accordion_header', label: 'Time Manipulation' },
            { cat: 'Effects', type: 'button', label: 'Trigger Reverse Time', action: 'reverse_time', class: 'btn-warn' },

            { cat: 'Effects', type: 'header', label: 'Post Processing' },
            { cat: 'Effects', type: 'accordion_header', label: 'Shader' },
            { cat: 'Effects', type: 'info_description', id: 'currentShaderNameDisplay', text: 'Loaded: No shader.' },
            { cat: 'Effects', id: 'shaderEnabled', type: 'checkbox', label: 'Enable Custom Shader' },
            { cat: 'Effects', id: 'shaderParameter', type: 'range', label: 'Shader Parameter', min: 0.0, max: 1.0, step: 0.01, dep: 'shaderEnabled', description: "A generic 0.0-1.0 value passed to the shader as 'uParameter'." },
            { cat: 'Effects', type: 'button', label: 'Import Fragment Shader (.glsl)', action: 'importShader', class: 'btn-info', dep: 'shaderEnabled' },
            { cat: 'Effects', type: 'info_description', text: 'Uniforms provided: uTexture (sampler2D), uTime (float), uResolution (vec2), uMouse (vec2), uParameter (float). Output to gl_FragColor.', dep: 'shaderEnabled' },
        ];
    }

    /**
     * Generates definitions for the 'System' settings category.
     * @private
     * @returns {Array<Object>} An array of UI control definition objects.
     */
    _generateSystemTab() {
        return [
            { cat: 'System', type: 'accordion_header', label: 'Configuration' },
            { cat: 'System', type: 'slot', idx: 0, id: 'slot_0' },
            { cat: 'System', type: 'slot', idx: 1, id: 'slot_1' },
            { cat: 'System', type: 'slot', idx: 2, id: 'slot_2' },
            { cat: 'System', type: 'button', label: 'Export Config (JSON)', action: 'export', class: 'btn-info' },
            { cat: 'System', type: 'button', label: 'Import Config (JSON)', action: 'import', class: 'btn-info' },
            { cat: 'System', id: 'hideMenuIcon', type: 'checkbox', label: 'Hide Settings Icon', description: 'Hover your mouse over the top right or press the Toggle UI Panel keybind to show' },
            { cat: 'System', id: 'suppressToasts', type: 'checkbox', label: 'Suppress Toast Messages', description: 'Disable pop-up notifications at the bottom of the screen.' },

            { cat: 'System', type: 'accordion_header', label: 'Key Bindings' },
            { cat: 'System', type: 'info_description', text: 'Click a button to assign a new key. Press Backspace or Delete to clear.' },
            { cat: 'System', type: 'keybinder', id: 'BootSequence', label: 'Boot Animation' },
            { cat: 'System', type: 'keybinder', id: 'CrashSequence', label: 'Crash Animation' },
            { cat: 'System', type: 'keybinder', id: 'BootCrashSequence', label: 'Boot to Crash' },
            { cat: 'System', type: 'keybinder', id: 'Pulse', label: 'Pulse' },
            { cat: 'System', type: 'keybinder', id: 'ClearPulse', label: 'Clear Pulse' },
            { cat: 'System', type: 'keybinder', id: 'MiniPulse', label: 'Pulse Storm' },
            { cat: 'System', type: 'keybinder', id: 'QuantizedPulse', label: 'Quantized Pulse' },
            { cat: 'System', type: 'keybinder', id: 'QuantizedAdd', label: 'Quantized Add' },
            { cat: 'System', type: 'keybinder', id: 'QuantizedRetract', label: 'Quantized Retract' },
            { cat: 'System', type: 'keybinder', id: 'DejaVu', label: 'Deja Vu' },
            { cat: 'System', type: 'keybinder', id: 'Superman', label: 'Superman' },
            { cat: 'System', type: 'keybinder', id: 'ReverseTime', label: 'Reverse Time' },
            { cat: 'System', type: 'keybinder', id: 'ToggleUI', label: 'Toggle UI Panel' },
        
            { cat: 'System', type: 'accordion_header', label: 'System Reset' },
            { cat: 'System', type: 'info_description', text: 'Clears the current font cache, and resets all font entries to default' },
            { cat: 'System', type: 'button', label: 'Clear Font Cache', action: 'clearCache', class: 'btn-warn' },
            // CAUTION separator - will be handled in renderControl
            { cat: 'System', type: 'header', label: 'CAUTION ZONE' }, // Use header for visual separation and text
            { cat: 'System', type: 'button', label: 'Factory Reset All', action: 'reset', class: 'btn-danger', caution: true },
        
            { cat: 'System', type: 'accordion_header', label: 'Debug' },
            { cat: 'System', id: 'debugEnabled', type: 'checkbox', label: 'Enable Debug Messages', description: "Enables verbose console logging and additional metrics." },
            { cat: 'System', id: 'highlightErasers', type: 'checkbox', label: 'Highlight Erasers', description: "Draws a red border around invisible eraser tracers." },
            { cat: 'System', id: 'logErrors', type: 'checkbox', label: 'Log Errors to Console', description: "Allows application errors to be logged to the browser console." },

            { cat: 'System', type: 'accordion_header', label: 'About' },
            { cat: 'System', type: 'about_content' },
            { cat: 'System', type: 'accordion_subheader', label: 'Frequently Asked Questions' },
            { cat: 'System', type: 'faq_item', question: 'What is this?', answer: 'This is a highly customizable Matrix Digital Rain simulation built with HTML5 Canvas and JavaScript.' },
            { cat: 'System', type: 'faq_item', question: 'How do I change the code?', answer: 'Use the settings panel on the right side of the screen to customize various aspects like colors, speeds, and effects.' },
            { cat: 'System', type: 'faq_item', question: 'Can I use my own font?', answer: 'Yes, go to the "Appearance" tab, under "Character Customization" you can import your own TTF or OTF font file.' },
            { cat: 'System', type: 'faq_item', question: 'Why is it sometimes slow?', answer: 'Performance depends on your device and settings. Try reducing "Resolution Scale" or disabling some effects under the "Effects" tab.' },
            { cat: 'System', type: 'faq_item', question: 'Is this more AI slop?', answer: 'Yes and no. LLM\'s were definitely used to make this, but the person who programmed it is a real person, and much of the code was hand-written, not just \'vibe coded\'. It\'s not perfect, but it\'s being slowly improved.' },
            { cat: 'System', type: 'faq_item', question: 'How do I leave feedback or suggestions on your app?', answer: 'Feel free to reach out via github! I\'m definitely open to ideas and suggestions.' }
        ];
    }

    /**
     * Initialize the events, tabs, and UI components.
     */
    init() {
        // Toggle button for the settings panel
        this.dom.toggle.onclick = () => this.togglePanel();

        // Create and populate tabs and content containers
        this._setupTabs();

        // Update footer version
        document.getElementById('globalStatus').textContent = `Matrix Code v${APP_VERSION}`;

        // Initialize File Input Handlers
        this._setupFileHandlers();

        // Handle tab dragging and horizontal scrolling
        this._setupTabScroll();

        // Refresh UI
        this.refresh('ALL');
    }

    /**
     * Toggles the settings panel visibility.
     */
    togglePanel() {
        const isOpen = this.dom.panel.classList.toggle('open');
        this.dom.panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        this.dom.toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    /**
     * Sets up the tabs and their corresponding content containers.
     * Creates category tabs and assigns content containers to each.
     * @private
     */
    _setupTabs() {
        this.dom.track = document.createElement('div'); // Initialize track here
        this.dom.track.id = 'tabTrack';
        this.dom.tabs.appendChild(this.dom.track);

        const categories = [...new Set(this.defs.map(def => def.cat))];
        const tabContentContainers = {}; // Mapping of category -> content container div

        // Create tabs and attach event handlers
        categories.forEach((category, index) => {
            const tabButton = this._createTabButton(category, index === 0);
            this.dom.track.appendChild(tabButton);

            // Create corresponding content container for the tab
            const contentContainer = this._createTabContentContainer(category, index === 0);
            this.dom.content.appendChild(contentContainer);
            tabContentContainers[category] = contentContainer;
        });

        // Populate tab content
        this._populateTabContent(tabContentContainers);
    }

    /**
     * Creates a tab button element for a category.
     * @private
     * @param {string} category - The category name for the tab.
     * @param {boolean} isActive - Whether the tab should be active by default.
     * @returns {HTMLElement} The created tab button element.
     */
    _createTabButton(category, isActive) {
        const button = document.createElement('button');
        button.className = `tab-btn ${isActive ? 'active' : ''}`;
        button.textContent = category;
        button.onclick = () => this._handleTabClick(category, button);
        return button;
    }

    /**
     * Handles when a tab is clicked and activates the corresponding tab content.
     * @private
     * @param {string} category - The category associated with the clicked tab.
     * @param {HTMLElement} button - The clicked tab button element.
     */
    _handleTabClick(category, button) {
        // Use this.scrollState.dragDistance for distinguishing drag from click
        if (this.scrollState.dragDistance > 3) {
            this.scrollState.dragDistance = 0; // Reset for next interaction
            return; 
        }

        // Deactivate all tabs and their content
        this.dom.tabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        this.dom.content.querySelectorAll('.tab-content-group').forEach(content => content.classList.remove('active'));

        // Activate selected tab and content
        button.classList.add('active');
        document.getElementById(`tab-content-${category}`).classList.add('active');
    }

    /**
     * Creates a tab content container for a given category.
     * @private
     * @param {string} category - The category name for the content container.
     * @param {boolean} isActive - Whether the content container should be active by default.
     * @returns {HTMLElement} The created tab content container element.
     */
    _createTabContentContainer(category, isActive) {
        const container = document.createElement('div');
        container.className = `tab-content-group ${isActive ? 'active' : ''}`;
        container.id = `tab-content-${category}`;
        return container;
    }

    /**
     * Populates tabs with content, including accordions and controls.
     * @private
     * @param {Object} tabContentContainers - A map of category names to their content container elements.
     */
    _populateTabContent(tabContentContainers) {
        let currentAccordionBody = null;
        let lastCat = null;

        this.defs.forEach(def => {
            const container = tabContentContainers[def.cat];
            if (!container) return;

            // Reset accordion context when switching tabs/categories
            if (def.cat !== lastCat) {
                currentAccordionBody = null;
                lastCat = def.cat;
            }

            // Handle Accordion Headers (Start new accordion)
            if (def.type === 'accordion_header') {
                currentAccordionBody = this._createAccordion(container, def.label);
                return;
            } 
            // Handle Accordion Subheaders
            else if (def.type === 'accordion_subheader') {
                if (currentAccordionBody) {
                    const el = this.renderControl(def);
                    if (el) currentAccordionBody.appendChild(el);
                }
                return;
            }
            // Handle Section Headers (Break out of accordion)
            // Exception: CAUTION ZONE remains inside for special handling below
            if (def.type === 'header' && def.label !== 'CAUTION ZONE') {
                currentAccordionBody = null;
                const el = this.renderControl(def);
                if (el) container.appendChild(el);
                return;
            }

            // Handle Controls
            if (currentAccordionBody) {
                // Special handling for CAUTION ZONE inside an accordion
                if (def.cat === 'System' && def.label === 'CAUTION ZONE' && def.type === 'header') {
                    const cautionZoneDiv = document.createElement('div');
                    cautionZoneDiv.className = 'caution-zone';
                    const headerEl = this.renderControl(def);
                    cautionZoneDiv.appendChild(headerEl);
                    currentAccordionBody.appendChild(cautionZoneDiv);
                } else {
                    if (def.caution) return; // Skip caution items here, handled separately
                    const controlElement = this.renderControl(def);
                    if (controlElement) currentAccordionBody.appendChild(controlElement);
                }
            } else {
                // Orphan controls (outside any accordion) - e.g. top level buttons or headers
                const controlElement = this.renderControl(def);
                if (controlElement) container.appendChild(controlElement);
            }
        });
        
        // Post-process: Insert Factory Reset into the created Caution Zone
        const factoryResetDef = this.defs.find(d => d.action === 'reset' && d.caution);
        if (factoryResetDef) {
            const cautionZoneDiv = this.dom.content.querySelector('.caution-zone');
            if (cautionZoneDiv) {
                const controlElement = this.renderControl(factoryResetDef);
                if (controlElement) cautionZoneDiv.appendChild(controlElement);
            }
        }
    }

    /**
     * Creates an accordion section with a header and a container for controls.
     * @private
     * @param {HTMLElement} tabContentGroup - The parent container for the accordion.
     * @param {string} label - The label for the accordion header.
     * @returns {HTMLElement} The body element of the created accordion where controls can be appended.
     */
    _createAccordion(tabContentGroup, label) {
        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item';

        const header = document.createElement('div');
        header.className = 'accordion-header';
        header.innerHTML = `
            ${label}
            <span class="accordion-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </span>
        `;

        const body = document.createElement('div');
        body.className = 'accordion-content';

        header.onclick = () => this._toggleAccordion(header, body, tabContentGroup);

        accordionItem.appendChild(header);
        accordionItem.appendChild(body);
        tabContentGroup.appendChild(accordionItem);

        // Default open logic: REMOVED per user request
        // const accordionsInTab = Array.from(tabContentGroup.children).filter(child => child.classList.contains('accordion-item'));
        // if (accordionsInTab.length === 1) { 
        //     body.classList.add('open');
        //     header.classList.add('active');
        //     header.querySelector('.accordion-icon').classList.add('rotated');
        // }

        return body;
    }

    /**
     * Toggles the visibility of an accordion section and manages sibling accordions.
     * @private
     * @param {HTMLElement} header - The header element of the accordion.
     * @param {HTMLElement} body - The body element of the accordion.
     * @param {HTMLElement} group - The parent group containing all accordions (tabContentGroup).
     */
    _toggleAccordion(header, body, group) {
        const isOpen = body.classList.contains('open');

        // Close other accordions in the group
        group.querySelectorAll('.accordion-content').forEach(siblingBody => {
            siblingBody.classList.remove('open');
            siblingBody.previousElementSibling?.classList.remove('active');
            siblingBody.previousElementSibling?.querySelector('.accordion-icon')?.classList.remove('rotated');
        });

        // Toggle the current accordion
        if (isOpen) {
            body.classList.remove('open');
            header.classList.remove('active');
            header.querySelector('.accordion-icon')?.classList.remove('rotated');
        } else {
            body.classList.add('open');
            header.classList.add('active');
            header.querySelector('.accordion-icon')?.classList.add('rotated');
        }
    }

    /**
     * Setup input handlers for font and config import.
     * @private
     */
    _setupFileHandlers() {
        document.getElementById('importFile').onchange = e => this._handleConfigImport(e);
        document.getElementById('importFontFile').onchange = e => this._handleFontImport(e);
        
        // Add shader input
        const shaderInput = document.createElement('input');
        shaderInput.type = 'file';
        shaderInput.id = 'importShaderFile';
        shaderInput.accept = '.glsl,.frag,.txt';
        shaderInput.style.display = 'none';
        document.body.appendChild(shaderInput);
        shaderInput.onchange = e => this._handleShaderImport(e);
    }

    /**
     * Handles the import of a shader file.
     * @private
     */
    _handleShaderImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = ev => {
            const source = ev.target.result;
            this.c.set('customShader', source);
            this.notifications.show('Shader Imported', 'success');
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    /**
     * Updates the slot name inputs from the current configuration.
     */
    updateSlotNames() {
        if (this.c.slots) {
            this.c.slots.forEach((slot, i) => {
                const slotInput = document.getElementById(`slot-input-${i}`);
                if (slotInput) {
                    slotInput.value = slot.name;
                }
            });
        }
    }

    /**
     * Handles the import of a JSON configuration file.
     * @private
     * @param {Event} event - The change event from the file input.
     */
    _handleConfigImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                // Merge loaded config with defaults to ensure all properties exist
                this.c.state = { ...this.c.defaults, ...data.state };
                
                // Handle Saved Presets
                if (data.savedPresets) {
                    this.c.slots = data.savedPresets;
                    this.c.saveSlots();
                    this.updateSlotNames(); // Force update immediately
                }

                this.c.updateDerivedValues();
                this.c.save();
                this.c.notify('ALL');
                this.notifications.show('Configuration Loaded', 'success');
            } catch (error) {
                console.error("Error loading config:", error);
                this.notifications.show('Invalid Configuration File', 'error');
            }
            event.target.value = ''; // Reset input value to allow re-importing the same file
        };
        reader.readAsText(file);
    }

    /**
     * Handles the import of a custom font file.
     * @private
     * @param {Event} event - The change event from the file input.
     */
    _handleFontImport(event) {
        const file = event.target.files[0];
        if (file) this.fonts.importFont(file);
        event.target.value = ''; // Reset input value
    }

    /**
     * Set up drag and scroll functionality for tabs.
     * @private
     */
    _setupTabScroll() {
        const tabs = this.dom.tabs;
        tabs.addEventListener('mousedown', e => this._startDrag(e));
        tabs.addEventListener('mouseleave', () => this._stopDrag());
        tabs.addEventListener('mouseup', () => this._stopDrag());
        tabs.addEventListener('mousemove', e => this._doDrag(e));

        // Ensure overflow handling matches standard behavior for wheel support
        tabs.style.overflowX = 'auto'; 
        tabs.style.overscrollBehaviorX = 'contain';

        // Converts vertical mouse wheel scrolling into horizontal scrolling for the tabs
        tabs.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
                return;
            }
            if (e.deltaY !== 0) {
                // preventDefault stops the browser "back" gesture or vertical page scroll
                e.preventDefault(); 
                tabs.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    /**
     * Initiates the drag operation for tab scrolling.
     * @private
     * @param {MouseEvent} e - The mouse down event.
     */
    _startDrag(e) {
        if (e.button !== 0) return; // Only respond to primary click (left mouse button)
        this.scrollState.isDown = true;
        this.scrollState.startX = e.pageX - this.dom.tabs.offsetLeft;
        this.scrollState.scrollLeft = this.dom.tabs.scrollLeft;
        this.scrollState.dragDistance = 0;
        this.ignoreNextClick = false; // Reset flag
        this.dom.tabs.style.cursor = 'grabbing';
    }

    /**
     * Stops the drag operation for tab scrolling.
     * @private
     */
    _stopDrag() {
        this.scrollState.isDown = false;
        this.dom.tabs.style.cursor = 'grab';
        // Reset dragDistance here to avoid blocking a subsequent immediate click after a very short drag
        this.scrollState.dragDistance = 0; 
    }

    /**
     * Handles the drag movement for tab scrolling.
     * @private
     * @param {MouseEvent} e - The mouse move event.
     */
    _doDrag(e) {
        if (!this.scrollState.isDown) return;

        e.preventDefault(); // Prevent text highlighting during drag
        const x = e.pageX - this.dom.tabs.offsetLeft;
        const walk = (x - this.scrollState.startX) * 1.5; // Multiplier for faster scrolling
        this.dom.tabs.scrollLeft = this.scrollState.scrollLeft - walk;
        this.scrollState.dragDistance = Math.abs(x - this.scrollState.startX); // Update based on actual movement
        if (this.scrollState.dragDistance > 3) this.ignoreNextClick = true; // Set flag if dragged enough to be considered a drag
    }


    /**
     * Retrieves the list of available fonts, including embedded and custom fonts.
     * @private
     * @returns {Array<Object>} An array of font objects suitable for select options.
     */
    _getFonts() {
        return [
            ...this.fonts.loadedFonts.map(f => ({label:f.display, value:f.name, custom:true}))
        ];
    }
    
    /**
     * Updates the UI list of custom fonts (used in the font manager section).
     * @param {HTMLElement} el - The DOM element to populate with the font list.
     */
    updateFontList(el) {
        el.innerHTML = '';
        this.fonts.loadedFonts.filter(f => !f.isEmbedded).forEach(f => {
            const div = document.createElement('div');
            div.className = 'font-item';
            div.innerHTML = `<span class="font-name">${f.display}</span>`;
            const btn = document.createElement('div');
            btn.className = 'font-delete-btn';
            btn.innerHTML = '×';
            btn.onclick = () => { if(confirm('Delete font?')) this.fonts.deleteFont(f.name); };
            div.appendChild(btn);
            el.appendChild(div);
        });
    }

    /**
     * Displays a tooltip with a given text near a target element.
     * @param {string} text - The text to display in the tooltip.
     * @param {HTMLElement} target - The element relative to which the tooltip should be positioned.
     */
    showTooltip(text, target) {
        this.dom.tooltip.textContent = text;
        this.dom.tooltip.classList.add('visible');
        const rect = target.getBoundingClientRect();
        const tipRect = this.dom.tooltip.getBoundingClientRect();
        let top = rect.top + (rect.height / 2) - (tipRect.height / 2);
        let left = rect.left - tipRect.width - 12; // Default to left of target
        
        // Adjust position if it goes off-screen
        if (top < 10) top = 10;
        if (left < 10) left = rect.right + 12; // Move to right if it's too far left
        
        this.dom.tooltip.style.top = `${top}px`;
        this.dom.tooltip.style.left = `${left}px`;
    }

    /**
     * Hides the currently displayed tooltip.
     */
    hideTooltip() {
        this.dom.tooltip.classList.remove('visible');
        // Reset dragDistance here to avoid blocking a subsequent immediate click after a very short drag
        this.scrollState.dragDistance = 0; 
    }

    /**
     * Updates the text/state of a specific keybinder button.
     * @param {string} id - The ID of the keybinding action (e.g., 'Pulse').
     */
    updateKeyBinderVisuals(id) {
        const btn = document.getElementById(`btn-key-${id}`);
        if (!btn) return;

        const def = this.defs.find(d => d.id === id);
        if (!def) return;

        const bindings = this.c.get('keyBindings') || {};
        const rawKey = bindings[id] || 'None';
        const displayKey = rawKey === ' ' ? 'SPACE' : rawKey.toUpperCase();

        btn.textContent = `${def.label}: [ ${displayKey} ]`;
        btn.className = 'action-btn btn-info'; // Reset class
    }

    /**
     * Creates a styled label group for a UI control, optionally including an info icon with a tooltip.
     * @param {Object} def - The definition object for the UI control.
     * @returns {HTMLElement} The created label group DOM element.
     */
    createLabelGroup(def) {
        const group = document.createElement('div');
        group.className = 'control-label-group';
        const text = document.createElement('span');
        text.textContent = def.label;
        group.appendChild(text);

        if (def.description) {
            const icon = document.createElement('span');
            icon.className = 'info-icon';
            icon.textContent = '?';
            const show = (e) => this.showTooltip(def.description, e.target);
            icon.onmouseenter = show;
            icon.onmouseleave = () => this.hideTooltip();
            // Handle touch events for mobile tooltips
            icon.addEventListener('touchstart', (e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                if (this.dom.tooltip.classList.contains('visible')) { 
                    this.hideTooltip(); 
                } else { 
                    show(e); 
                    // Automatically hide tooltip after a short delay on touch devices
                    setTimeout(() => this.hideTooltip(), 3000); 
                } 
            });
            group.appendChild(icon);
        }
        return group;
    }

    /**
     * Renders the content of a color list control into the provided wrapper.
     * @private
     * @param {HTMLElement} wrapper - The container element.
     * @param {Object} def - The control definition.
     */
    _renderColorList(wrapper, def) {
        wrapper.innerHTML = '';
        const palette = this.c.get(def.id) || ["#00FF00"];
        
        palette.forEach((color, idx) => {
            const item = document.createElement('div');
            item.className = 'color-list-item';
            
            const cInput = document.createElement('input');
            cInput.type = 'color';
            cInput.value = color;
            
            // Optimisation: Update state directly on input to allow dragging without re-render
            cInput.oninput = e => {
                const newP = [...this.c.get(def.id)];
                newP[idx] = e.target.value;
                this.c.state[def.id] = newP; // Direct state mutation
                this.c.updateDerivedValues(); // Force derived update for live preview
            };

            // Commit change on release
            cInput.onchange = e => {
                const newP = [...this.c.get(def.id)];
                newP[idx] = e.target.value;
                this.c.set(def.id, newP); // Triggers save and refresh
            };
            
            item.appendChild(cInput);
            
            if (palette.length > 1 && idx > 0) {
                const delBtn = document.createElement('div');
                delBtn.className = 'btn-icon-remove';
                delBtn.textContent = '×';
                delBtn.onclick = () => {
                    const newP = this.c.get(def.id).filter((_, i) => i !== idx);
                    this.c.set(def.id, newP);
                    this._renderColorList(wrapper, def);
                    this.refresh('streamPalette');
                };
                item.appendChild(delBtn);
            }
            
            wrapper.appendChild(item);
        });
        
        if (palette.length < (def.max || 3)) {
            const addBtn = document.createElement('div');
            addBtn.className = 'btn-icon-add';
            addBtn.textContent = '+';
            addBtn.onclick = () => {
                const newP = [...this.c.get(def.id), "#ffffff"];
                this.c.set(def.id, newP);
                this._renderColorList(wrapper, def);
                this.refresh('streamPalette');
            };
            wrapper.appendChild(addBtn);
        }
    }

    /**
     * Dynamically renders a UI control element based on its definition.
     * @param {Object} def - The definition object for the control.
     * @returns {HTMLElement|null} The created control element, or null if it's an accordion header.
     */
    renderControl(def) {
        if (def.type === 'accordion_header') { return null; }
        if (def.type === 'accordion_subheader') {
            const el = document.createElement('div');
            el.className = 'accordion-subheader';
            el.textContent = def.label;
            if(def.dep) el.setAttribute('data-dep', JSON.stringify(def.dep));
            return el;
        }
        if (def.type === 'header') {
            const el = document.createElement('div'); el.className = 'section-header'; el.textContent = def.label; return el;
        }
        if (def.type === 'about_content') {
            const div = document.createElement('div'); div.style.padding = '1rem'; div.style.textAlign = 'center'; div.style.color = '#86efac';
            
            const logoChar = Utils.getRandomKatakanaChar();
            const initialColor = this.c.get('streamColor');
            const initialSvgDataUrl = Utils.generateGlyphSVG(logoChar, initialColor, 48, this.c.get('fontFamily'));

            div.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                    <img id="matrixLogo" src="${initialSvgDataUrl}" alt="Matrix Logo" style="height: 48px; width: 48px; margin-right: 10px;"/>
                    <h3 style="margin:0; color:#fff; font-size: 1.1rem; letter-spacing:1px;">Matrix Digital Rain</h3>
                </div>
                <div style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; margin-bottom:1.5rem;"><p style="margin:0.5rem 0;"><strong>Version:</strong> ${APP_VERSION}</p><p style="margin:0.5rem 0;"><strong>Created:</strong> November 2025</p></div><p style="font-size:0.9rem;"><a href="https://github.com/enigmahack" target="_blank" style="color:#22c55e; text-decoration:none; border-bottom:1px solid #22c55e; padding-bottom:2px; transition:all 0.2s;">github.com/enigmahack</a></p>`;
            return div;
        }
        if (def.type === 'info_description') {
            const div = document.createElement('div');
            div.className = 'info-description';
            div.textContent = def.text;
            if (def.id) div.id = `in-${def.id}`;
            return div;
        }
        if (def.type === 'faq_item') {
            const container = document.createElement('div');
            container.className = 'faq-item';
            const question = document.createElement('div');
            question.className = 'faq-question';
            question.textContent = def.question;
            const answer = document.createElement('div');
            answer.className = 'faq-answer';
            answer.textContent = def.answer;
            container.appendChild(question);
            container.appendChild(answer);
            return container;
        }
        const row = document.createElement('div');
        if (def.type === 'button') {
            const btn = document.createElement('button'); btn.className = `action-btn ${def.class||'btn-info'}`; btn.textContent = def.label; btn.id = `btn-${def.action}`; btn.name = def.action; btn.onclick = () => this.handleAction(def.action); row.appendChild(btn);
        } else if (def.type === 'slot') {
            row.className = 'slot-container';
            const inp = document.createElement('input'); inp.className = 'slot-name-input'; inp.value = this.c.slots[def.idx].name; inp.id = `slot-input-${def.idx}`; inp.name = `slot_name_${def.idx}`; inp.onchange = e => this.c.renameSlot(def.idx, e.target.value);
            inp.onfocus = e => e.target.value = '';
            const grp = document.createElement('div'); grp.className = 'slot-btn-group';
            const save = document.createElement('button'); save.className = 'btn-icon'; save.textContent = 'SAVE'; save.id = `btn-save-${def.idx}`; save.onclick = () => { this.c.saveToSlot(def.idx); };
            const load = document.createElement('button'); load.className = 'btn-icon'; load.textContent = 'LOAD'; load.id = `btn-load-${def.idx}`; load.onclick = () => { this.c.loadFromSlot(def.idx); };
            grp.append(save, load); row.append(inp, grp);
        } else if (def.type === 'font_list') {
            row.className = 'font-manager-list'; row.id = 'fontListUI'; this.updateFontList(row);
        } else {
            row.className = def.type === 'checkbox' ? 'checkbox-row' : 'control-row';
            const labelGroup = this.createLabelGroup(def);
            if(def.type !== 'checkbox') { const hdr = document.createElement('div'); hdr.className = 'control-header'; hdr.appendChild(labelGroup); 
            if(!def.hideValue && def.type === 'range') { const valDisp = document.createElement('span'); valDisp.id = `val-${def.id}`; hdr.appendChild(valDisp); } row.appendChild(hdr); } 
                else { row.appendChild(labelGroup); }
            let inp;

            if(def.type === 'range') { 
                inp = document.createElement('input'); 
                inp.type = 'range'; 
                inp.min=def.min; 
                inp.max=def.max; 
                if(def.step) inp.step=def.step; 
                
                let isTouching = false;

                inp.value = def.invert ? (def.max+def.min)-this.c.get(def.id) : this.c.get(def.id);                            
                
                inp.oninput = e => { 
                    if (isTouching) return; // Block native updates during touch interaction
                    const v = parseFloat(e.target.value); 
                    let actual = def.invert ? (def.max+def.min)-v : v; 
                    
                    // Dynamic precision based on step
                    const step = def.step || 1;
                    const decimals = (step.toString().split('.')[1] || '').length;
                    if (typeof actual === 'number') actual = parseFloat(actual.toFixed(decimals));

                    this.c.set(def.id, actual); 
                    const disp = document.getElementById(`val-${def.id}`); 
                    if(disp) disp.textContent = def.transform ? def.transform(actual) : actual + (def.unit || '');
                }; 

                let startX = 0;
                let startY = 0;
                let startValue = 0;
                let isHorizontalDrag = false;

                inp.addEventListener('touchstart', e => {
                    isTouching = true;
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    startValue = parseFloat(e.target.value);
                    isHorizontalDrag = false;
                    
                    // Prevent "jump to tap" visually
                    requestAnimationFrame(() => {
                        inp.value = startValue;
                    });
                }, { passive: false });

                inp.addEventListener('touchmove', e => {
                    const x = e.touches[0].clientX;
                    const y = e.touches[0].clientY;
                    const dx = x - startX;
                    const dy = y - startY;

                    if (!isHorizontalDrag && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
                        isHorizontalDrag = true;
                    }

                    if (isHorizontalDrag) {
                        e.preventDefault(); 
                        const rect = inp.getBoundingClientRect();
                        const relativeX = Math.min(Math.max(0, x - rect.left), rect.width);
                        const percent = relativeX / rect.width;
                        const min = parseFloat(def.min);
                        const max = parseFloat(def.max);
                        let newVal = min + (percent * (max - min));
                        
                        // Dynamic precision based on step
                        const step = parseFloat(def.step || 1);
                        newVal = Math.round(newVal / step) * step;
                        
                        if (newVal < min) newVal = min;
                        if (newVal > max) newVal = max;

                        inp.value = newVal;
                        
                        let actual = def.invert ? (max+min)-newVal : newVal; 
                        
                        const decimals = (step.toString().split('.')[1] || '').length;
                        if (typeof actual === 'number') actual = parseFloat(actual.toFixed(decimals));

                        this.c.set(def.id, actual); 
                        
                        const disp = document.getElementById(`val-${def.id}`); 
                        if(disp) disp.textContent = def.transform ? def.transform(actual) : actual + (def.unit || '');
                    }
                }, { passive: false });
                
                inp.addEventListener('touchend', () => {
                    isTouching = false;
                    isHorizontalDrag = false;
                });
            }

            else if(def.type === 'color') { 
                const w = document.createElement('div'); 
                w.className = 'color-wrapper'; 
                inp = document.createElement('input'); 
                inp.type = 'color'; 
                inp.value = this.c.get(def.id); 
                inp.id = `in-${def.id}`; 
                inp.name = def.id; 
                
                inp.oninput = e => { 
                    this.c.state[def.id] = e.target.value; 
                    this.c.updateDerivedValues(); // Force derived update for live preview
                }; 
                inp.onchange = e => { this.c.set(def.id, e.target.value); }; // Commit and refresh
                
                w.appendChild(inp); row.appendChild(w); 
                if(def.dep) row.setAttribute('data-dep', JSON.stringify(def.dep)); 
                if(def.id) row.id = `row-${def.id}`; 
                return row; 
            }
            
            else if(def.type === 'color_list') {
                const wrapper = document.createElement('div');
                wrapper.className = 'color-list-wrapper';
                wrapper.id = `in-${def.id}`;
                this._renderColorList(wrapper, def);
                row.appendChild(wrapper);
                if(def.dep) row.setAttribute('data-dep', JSON.stringify(def.dep)); 
                if(def.id) row.id = `row-${def.id}`;
                return row;
            }

            else if(def.type === 'keybinder') {
                const btn = document.createElement('button');
                // Initial text setup
                const rawKey = (this.c.get('keyBindings') || {})[def.id] || 'None';
                const initialDisplay = rawKey === ' ' ? 'SPACE' : rawKey.toUpperCase();
                
                btn.className = 'action-btn btn-info';
                btn.id = `btn-key-${def.id}`;
                btn.textContent = `${def.label}: [ ${initialDisplay} ]`;
                
                btn.onclick = () => {
                    this.isKeyBindingActive = true; 
                    btn.textContent = `${def.label}: [ Press Key... ]`;
                    btn.classList.remove('btn-info');
                    btn.classList.add('btn-warn');
                    
                    // Focus trap to isolate input from global listeners
                    this.dom.keyTrap.focus();
                    
                    const handler = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        
                        let newKey = e.key;
                        
                        // Handle special keys
                        if (newKey === 'Backspace' || newKey === 'Delete') {
                            newKey = null;
                        } else if (newKey.length === 1) {
                            newKey = newKey.toLowerCase();
                        }
                        
                        // Save config
                        try {
                            const bindings = { ...this.c.get('keyBindings') };
                            if (newKey) {
                                bindings[def.id] = newKey;
                            } else {
                                delete bindings[def.id];
                            }
                            this.c.set('keyBindings', bindings); // Triggers refresh() -> updateKeyBinderVisuals()
                        } catch (err) {
                            console.error("Failed to save keybinding:", err);
                            btn.textContent = "Error Saving";
                        }
                        
                        // Cleanup
                        this.dom.keyTrap.blur();
                        this.isKeyBindingActive = false;
                        
                        // Force immediate visual update just in case refresh is delayed
                        this.updateKeyBinderVisuals(def.id);
                    };
                    
                    this.dom.keyTrap.addEventListener('keydown', handler, { once: true });
                };
                row.appendChild(btn);
                return row;
            }

            else if(def.type === 'checkbox') { 
                inp = document.createElement('input'); 
                inp.type = 'checkbox'; 
                inp.checked = this.c.get(def.id); 
                inp.onchange = e => { 
                    if(e.target.checked && def.warning) alert(def.warning);
                    this.c.set(def.id, e.target.checked); 
                }; 
                row.onclick = e => { if(e.target !== inp) { inp.checked = !inp.checked; inp.dispatchEvent(new Event('change')); }}; 
            }
            else if(def.type === 'select') { inp = document.createElement('select'); (typeof def.options === 'function' ? def.options() : def.options).forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; if(o.custom) opt.className = 'custom-font-opt'; if(this.c.get(def.id) === o.value) opt.selected = true; inp.appendChild(opt); }); inp.onchange = e => this.c.set(def.id, e.target.value); }
            row.appendChild(inp);
            if(def.id) { inp.id = `in-${def.id}`; inp.name = def.id; }
            if(def.dep) row.setAttribute('data-dep', JSON.stringify(def.dep)); if(def.id) row.id = `row-${def.id}`;
        }
        return row;
    }

    /**
     * Handles UI actions triggered by buttons or other interactive elements.
     * @param {string} action - The action identifier.
     */
    handleAction(action) {
        if(action === 'reset' && confirm('Reset all settings?')) this.c.reset();
        if(action === 'clearCache' && confirm('Clear all custom fonts?')) this.fonts.deleteAllFonts();
        if(action === 'export') Utils.downloadJson({version:APP_VERSION, state:this.c.state, savedPresets:this.c.slots}, `matrix_conf_v${APP_VERSION}.json`);
        if(action === 'import') document.getElementById('importFile').click();
        if(action === 'importFont') document.getElementById('importFontFile').click();
        if(action === 'importShader') document.getElementById('importShaderFile').click();
        if(action === 'manageCharacters') this.charSelector.show();
        if(action === 'boot') { if(this.effects.trigger('BootSequence')) this.notifications.show('Boot Sequence Initiated', 'success'); else this.notifications.show('Boot Sequence Active...', 'info'); }
        if(action === 'crash') { if(this.effects.trigger('CrashSequence')) this.notifications.show('System Crash Initiated', 'danger'); else this.notifications.show('Crash Sequence Active...', 'info'); }
        if(action === 'boot_crash_sequence') {
            if(this.effects.trigger('BootSequence')) {
                this.notifications.show('Boot Sequence Initiated', 'success');
                setTimeout(() => {
                    if(this.effects.trigger('CrashSequence')) this.notifications.show('System Crash Initiated', 'danger');
                }, 4000);
            } else {
                this.notifications.show('Sequence Active...', 'info');
            }
        }
        if(action === 'pulse') { if(this.effects.trigger('Pulse')) this.notifications.show('Pulse Triggered', 'success'); else this.notifications.show('Pulse already active...', 'info'); }
        if(action === 'clearpulse') { if(this.effects.trigger('ClearPulse')) this.notifications.show('Clear Pulse Triggered', 'success'); else this.notifications.show('Clear Pulse active...', 'info'); }
        if(action === 'minipulse') { if(this.effects.trigger('MiniPulse')) this.notifications.show('Pulse Storm Triggered', 'success'); else this.notifications.show('Pulse Storm active...', 'info'); }
        if(action === 'quantizedPulse') { if(this.effects.trigger('QuantizedPulse')) this.notifications.show('Quantized Pulse Triggered', 'success'); else this.notifications.show('Quantized Pulse active...', 'info'); }
        if(action === 'quantizedAdd') { if(this.effects.trigger('QuantizedAdd')) this.notifications.show('Quantized Add Triggered', 'success'); else this.notifications.show('Quantized Add active...', 'info'); }
        if(action === 'quantizedRetract') { if(this.effects.trigger('QuantizedRetract')) this.notifications.show('Quantized Retract Triggered', 'success'); else this.notifications.show('Quantized Retract active...', 'info'); }
        if(action === 'dejavu') { if(this.effects.trigger('DejaVu')) this.notifications.show('Deja Vu Triggered', 'success'); else this.notifications.show('Deja Vu already active...', 'info'); }
        if(action === 'superman') { if(this.effects.trigger('Superman')) this.notifications.show('Neo is flying...', 'success'); else this.notifications.show('Superman active...', 'info'); }
        if(action === 'reverse_time') { if(this.effects.trigger('ReverseTime')) this.notifications.show('Time Reversal Initiated', 'success'); else this.notifications.show('Temporal anomaly detected...', 'info'); }
    }

    /**
     * Refreshes the UI to reflect current configuration settings.
     * @param {string} key - The specific configuration key to refresh, or 'ALL' to refresh all controls.
     */
    refresh(key) {
        try {
            if(key === 'ALL') { 
                this.defs.forEach(d => { if(d.id) this.refresh(d.id); }); 
                
                // Refresh Slot Names
                this.updateSlotNames();

                this.refresh('fontFamily'); // Special refresh for font list
                this.dom.content.querySelectorAll('[data-dep]').forEach(row => {
                    try {
                        const depRule = JSON.parse(row.getAttribute('data-dep')); 
                        const rules = Array.isArray(depRule) ? depRule : [depRule]; 
                        let conditionsMet = true;
                        for (let rule of rules) { 
                            let target = rule; 
                            let expected = true; 
                            if (target.startsWith('!')) { target = target.substring(1); expected = false; } 
                            let actualVal = this.c.get(target);
                            if (actualVal === 'true') actualVal = true;
                            if (actualVal === 'false') actualVal = false;
                            const actual = !!actualVal; 
                            if (actual !== expected) { conditionsMet = false; break; } 
                        }
                        if(conditionsMet) row.classList.remove('control-disabled'); 
                        else row.classList.add('control-disabled');
                    } catch(e) { console.warn("Error processing dependency row:", e); }
                });
                return; 
            }
            if (key === 'keyBindings') {
                this.defs.filter(d => d.type === 'keybinder').forEach(d => this.refresh(d.id));
                return;
            }
                        if (key === 'fontFamily' || key === 'fontSettings') { // Now also refreshes on fontSettings changes
                            const sel = document.getElementById('in-fontFamily');
                            if(sel) { 
                                sel.innerHTML = ''; 
                                this._getFonts().forEach(o => { 
                                    const opt = document.createElement('option'); 
                                    opt.value = o.value; 
                                    opt.textContent = o.label; 
                                    if(o.custom) opt.className = 'custom-font-opt'; 
                                    if(this.c.get('fontFamily') === o.value) opt.selected = true; 
                                    sel.appendChild(opt); 
                                }); 
                            }
                            const list = document.getElementById('fontListUI'); 
                            if (list) this.updateFontList(list); 
                            // Update logo and favicon when font family or settings change, re-randomize char
                            const currentPrimaryColor = this.c.get('streamPalette')[0]; // Use primary palette color
                            
                            const logo = document.getElementById('matrixLogo');
                            if (logo) {
                                const randomChar = Utils.getRandomKatakanaChar();
                                logo.src = Utils.generateGlyphSVG(randomChar, currentPrimaryColor, 48, this.c.get('fontFamily'));
                            }
                            const favicon = document.getElementById('favicon');
                            if (favicon) {
                                const randomChar = Utils.getRandomKatakanaChar();
                                favicon.href = Utils.generateGlyphSVG(randomChar, currentPrimaryColor, 32, this.c.get('fontFamily')); // Use a smaller size for favicon
                            }
                            return;
                        }
                        // Removed the separate `if (key === 'streamColor')` block as its functionality
                        // is now handled by the 'streamPalette' block, and this 'fontFamily'/'fontSettings' block.
                        // ... the rest of the refresh method ...
                        if (key === 'customShader' || key === 'shaderEnabled' || key === 'ALL') {
                            const shaderNameDisplay = document.getElementById('in-currentShaderNameDisplay');
                if (shaderNameDisplay) {
                    let name = 'No shader loaded.';
                    const customShaderSource = this.c.get('customShader');
                    const shaderEnabled = this.c.get('shaderEnabled');
                    
                    if (shaderEnabled && customShaderSource) {
                        // 1. Try to find a name metadata tag in the first 500 chars
                        // Matches "// Name: My Shader" or "// Shader: My Shader" case-insensitive
                        const nameMatch = customShaderSource.substring(0, 500).match(/^\s*\/\/\s*(?:Name|Shader|Title):\s*(.+)$/im);
                        
                        if (nameMatch && nameMatch[1]) {
                            name = nameMatch[1].trim();
                        } 
                        // 2. Fallback: Check if it's standard code
                        else if (customShaderSource.trim().startsWith('precision')) {
                            name = 'Custom Shader (No Name)';
                        }
                        // 3. Fallback: If it doesn't look like code (maybe it really is a path?)
                        else if (customShaderSource.length < 200 && (customShaderSource.includes('/') || customShaderSource.includes('\\'))) {
                             const parts = customShaderSource.split(/[\/\\]/);
                             name = parts[parts.length - 1];
                        }
                        else {
                             name = 'Custom Shader';
                        }
                    } else if (shaderEnabled) {
                         name = 'Unnamed/Default Shader'; 
                    }
                    shaderNameDisplay.textContent = `Loaded: ${name}`;
                }
            }
            if (key === 'streamPalette') {
                 const palette = this.c.get('streamPalette');
                 const biasRow = document.getElementById('row-paletteBias');
                 if (biasRow) {
                     if (palette && palette.length > 1) {
                         biasRow.classList.remove('control-disabled');
                     } else {
                         biasRow.classList.add('control-disabled');
                     }
                 }
                 
                 // Update UI Elements based on primary color
                 if (palette && palette.length > 0) {
                     const color = palette[0];
                     
                     // Update Settings Wheel
                     const toggle = this.dom.toggle;
                     if (toggle) {
                         toggle.style.setProperty('--accent', color);
                         toggle.style.borderColor = color;
                         // toggle.style.color = color; // Removed to allow CSS hover override
                         toggle.style.boxShadow = `0 0 5px ${color}40`; // Subtle glow using hex alpha
                     }

                     // Update Logo & Favicon
                     const logo = document.getElementById('matrixLogo');
                     if (logo) {
                        const randomChar = Utils.getRandomKatakanaChar();
                        logo.src = Utils.generateGlyphSVG(randomChar, color, 48, this.c.get('fontFamily'));
                     }
                     const favicon = document.getElementById('favicon');
                     if (favicon) {
                        const randomChar = Utils.getRandomKatakanaChar();
                        favicon.href = Utils.generateGlyphSVG(randomChar, color, 32, this.c.get('fontFamily'));
                     }
                 }
            }

            if (key === 'hideMenuIcon' || key === 'ALL') {
                const shouldHide = this.c.get('hideMenuIcon');
                const toggleBtn = this.dom.toggle;
                
                // Clear any existing listeners/timeouts
                if (this._menuIconTimeout) clearTimeout(this._menuIconTimeout);
                if (this._menuMouseMoveHandler) {
                    document.removeEventListener('mousemove', this._menuMouseMoveHandler);
                    this._menuMouseMoveHandler = null;
                }

                if (shouldHide) {
                    toggleBtn.style.transition = 'opacity 0.5s ease-in-out, transform 0.3s ease';
                    
                    const showIcon = () => {
                        toggleBtn.style.opacity = '1';
                        toggleBtn.style.pointerEvents = 'auto';
                        clearTimeout(this._menuIconTimeout);
                        
                        // Hide again after 1s of no activity near it? 
                        // Or just 1s after showing? The prompt says "hide itself after one second".
                        this._menuIconTimeout = setTimeout(() => {
                            // Only hide if panel is CLOSED
                            if (!this.dom.panel.classList.contains('open')) {
                                toggleBtn.style.opacity = '0';
                                toggleBtn.style.pointerEvents = 'none';
                            }
                        }, 1000);
                    };

                    // Initial hide after delay
                    showIcon(); 

                    // Hot-zone detection
                    this._menuMouseMoveHandler = (e) => {
                        // Top right corner hot-zone (100x100px)
                        const isHotZone = (e.clientX > window.innerWidth - 100) && (e.clientY < 100);
                        if (isHotZone || this.dom.panel.classList.contains('open')) {
                            showIcon();
                        }
                    };
                    document.addEventListener('mousemove', this._menuMouseMoveHandler);
                } else {
                    // Reset to always visible
                    toggleBtn.style.opacity = '1';
                    toggleBtn.style.pointerEvents = 'auto';
                }
            }

            if(key) {
                // Keybinder Refresh Logic
                if (document.getElementById(`btn-key-${key}`)) {
                    this.updateKeyBinderVisuals(key);
                }

                const inp = document.getElementById(`in-${key}`);
                if(inp) { 
                    const def = this.defs.find(d=>d.id===key); 
                    if(def) { 
                        const val = this.c.get(key); 
                        if(def.type === 'checkbox') inp.checked = val; 
                        else if(def.type === 'color_list') this._renderColorList(inp, def);
                        else if(def.type === 'range') { 
                            inp.value = def.invert ? (def.max+def.min)-val : val; 
                            const disp = document.getElementById(`val-${key}`); 
                            if(disp) {
                                let displayVal = val;
                                if (!def.transform && typeof val === 'number') {
                                    const step = def.step || 1;
                                    const decimals = (step.toString().split('.')[1] || '').length;
                                    displayVal = parseFloat(val.toFixed(decimals));
                                }
                                disp.textContent = def.transform ? def.transform(val) : displayVal + (def.unit || ''); 
                            }
                        } else {
                            // Handle boolean values in select dropdowns correctly
                            inp.value = String(val);
                        }
                    } 
                }
            }
            // Update dependents
            this.dom.content.querySelectorAll(`[data-dep*="${key}"]`).forEach(row => {
                try {
                    const depRule = JSON.parse(row.getAttribute('data-dep')); 
                    const rules = Array.isArray(depRule) ? depRule : [depRule]; 
                    let conditionsMet = true;
                    for (let rule of rules) { 
                        let target = rule; 
                        let expected = true; 
                        if (target.startsWith('!')) { target = target.substring(1); expected = false; } 
                        // Handle boolean vs string "true"/"false" mismatch
                        let actualVal = this.c.get(target);
                        if (actualVal === 'true') actualVal = true;
                        if (actualVal === 'false') actualVal = false;
                        const actual = !!actualVal; 
                        if (actual !== expected) { conditionsMet = false; break; } 
                    }
                    if(conditionsMet) row.classList.remove('control-disabled'); 
                    else row.classList.add('control-disabled');
                } catch(e) { console.warn("Error processing dependency row:", e); }
            });
        } catch(e) { console.warn("UI Refresh Error:", e); }
    }
}

    // =========================================================================
    // 10.0 MATRIX KERNEL
    // =========================================================================
