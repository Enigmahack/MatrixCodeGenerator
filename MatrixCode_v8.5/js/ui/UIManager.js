// =========================================================================
// UI MANAGER
// =========================================================================

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
     * This method orchestrates the gathering of definitions from the global ConfigTemplate.
     * @private
     */
    _generateDefinitions() {
        if (typeof ConfigTemplate === 'undefined') {
            console.error("ConfigTemplate not found. UI cannot be generated.");
            return [];
        }
        return ConfigTemplate;
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
        if (!this.dom.track) {
            this.dom.track = document.createElement('div');
            this.dom.track.id = 'tabTrack';
            this.dom.tabs.appendChild(this.dom.track);
        } else {
            this.dom.track.innerHTML = '';
        }

        const showDebug = this.c.get('debugTabEnabled');
        const categories = [...new Set(this.defs.map(def => def.cat))].filter(cat => {
            if (cat === 'Debug' && !showDebug) return false;
            return true;
        });

        const tabContentContainers = {}; // Mapping of category -> content container div
        this.dom.content.innerHTML = '';

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
        const content = document.getElementById(`tab-content-${category}`);
        if (content) content.classList.add('active');
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
     * Populates tabs with content using a stack-based container system.
     * @private
     * @param {Object} tabContentContainers - A map of category names to their content container elements.
     */
    _populateTabContent(tabContentContainers) {
        const containerStacks = {}; // category -> [tabGroup, currentAccordion, currentSubAccordion]

        this.defs.forEach(def => {
            const tabGroup = tabContentContainers[def.cat];
            if (!tabGroup) return;

            // Initialize stack for category if needed
            if (!containerStacks[def.cat]) {
                containerStacks[def.cat] = [tabGroup];
            }
            const stack = containerStacks[def.cat];

            // 1. Handle Structural Types (Accordion Headers, Sub-Accordions, End Groups)
            
            // Accordion Header: Pops everything except tab root, pushes new accordion
            if (def.type === 'accordion_header') {
                while (stack.length > 1) stack.pop(); 
                const accordionBody = this._createAccordion(tabGroup, def.label);
                stack.push(accordionBody);
                return;
            } 

            // Sub Accordion: Pushes new nested body onto the stack
            if (def.type === 'sub_accordion' || def.type === 'accordion_subheader_group') {
                const parent = stack[stack.length - 1];
                const subBody = this._createSubAccordion(parent, def.label, def.dep);
                stack.push(subBody);
                return;
            }

            // End Group: Manually return to previous nesting level
            if (def.type === 'end_group') {
                if (stack.length > 1) stack.pop();
                return;
            }

            // Standard Section Header
            if (def.type === 'header') {
                // CAUTION ZONE: Stays nested in current stack, but adds visual grouping
                if (def.label === 'CAUTION ZONE') {
                    const parent = stack[stack.length - 1];
                    const cautionZoneDiv = document.createElement('div');
                    cautionZoneDiv.className = 'caution-zone';
                    const headerEl = this.renderControl(def);
                    cautionZoneDiv.appendChild(headerEl);
                    parent.appendChild(cautionZoneDiv);
                    return;
                }

                // Standard headers pop everything to become top-level tab titles
                while (stack.length > 1) stack.pop();
                const el = this.renderControl(def);
                if (el) tabGroup.appendChild(el);
                return;
            }

            // 2. Handle Content Controls
            const target = stack[stack.length - 1];

            // Subheader: Logic simplified to append to top of current stack
            if (def.type === 'accordion_subheader') {
                const sub = document.createElement('div');
                sub.className = 'accordion-subheader';
                sub.textContent = def.label;
                if (def.dep) sub.setAttribute('data-dep', JSON.stringify(def.dep));
                target.appendChild(sub);
                return;
            }

            // Special handling for Caution Zone items
            if (def.caution) {
                const cautionZone = target.querySelector('.caution-zone');
                if (cautionZone) {
                    const el = this.renderControl(def);
                    if (el) cautionZone.appendChild(el);
                    return;
                }
            }

            const controlElement = this.renderControl(def);
            if (controlElement) target.appendChild(controlElement);
        });
    }

    /**
     * Creates a sub-accordion nested inside another container.
     */
    _createSubAccordion(parent, label, dep) {
        const subAcc = document.createElement('div');
        subAcc.className = 'sub-accordion';
        if (dep) subAcc.setAttribute('data-dep', JSON.stringify(dep));

        const header = document.createElement('div');
        header.className = 'sub-accordion-header';
        header.innerHTML = `
            <span>${label}</span>
            <span class="accordion-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </span>
        `;

        const body = document.createElement('div');
        body.className = 'sub-accordion-content';

        header.onclick = (e) => {
            e.stopPropagation();
            this._toggleAccordion(header, body);
        };

        subAcc.appendChild(header);
        subAcc.appendChild(body);
        parent.appendChild(subAcc);

        return body;
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

        return body;
    }

    /**
     * Unified logic for toggling accordion visibility.
     * @private
     * @param {HTMLElement} header - The header element of the accordion.
     * @param {HTMLElement} body - The body element of the accordion.
     * @param {HTMLElement} [group] - Optional parent to handle exclusive opening (Accordion mode).
     */
    _toggleAccordion(header, body, group) {
        const isOpening = !body.classList.contains('open');

        // Close other accordions in the group (Exclusive accordion mode)
        if (group && isOpening) {
            group.querySelectorAll('.accordion-content.open').forEach(openBody => {
                if (openBody !== body) {
                    openBody.classList.remove('open');
                    const otherHeader = openBody.previousElementSibling;
                    otherHeader?.classList.remove('active');
                    otherHeader?.querySelector('.accordion-icon')?.classList.remove('rotated');
                }
            });
        }

        // Toggle the current accordion
        body.classList.toggle('open');
        header.classList.toggle('active');
        header.querySelector('.accordion-icon')?.classList.toggle('rotated');
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
     * Retrieves the list of available shaders.
     * @private
     * @returns {Array<Object>} An array of shader objects suitable for select options.
     */
    _getShaders() {
        return [
            { label: 'None', value: 'none' },
            { label: 'Blue Hue', value: 'matrix_blue_hue.glsl' },
            { label: 'CRT Monitor', value: 'crt_monitor.glsl' },
            { label: 'Dirty LCD', value: 'dirty_LCD.glsl' },
            { label: 'Double Vision', value: 'double_vision.glsl' },
            { label: 'Film Grain', value: 'film_grain.glsl' },
            { label: 'Hue Shift', value: 'hue_shift.glsl' },
            { label: 'Mouse Ripple', value: 'mouse_ripple.glsl' },
            { label: 'Pixelate', value: 'pixelate.glsl' },
            { label: 'Screen Door', value: 'screen_door.glsl' },
            { label: 'Smear LCD Grid', value: 'smear_LCDgrid.glsl' },
            { label: 'Static Grain', value: 'static_grain.glsl' }
        ];
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
                e.stopPropagation(); 
                if (this.dom.tooltip.classList.contains('visible')) { 
                    this.hideTooltip(); 
                } else { 
                    show(e); 
                    // Automatically hide tooltip after a short delay on touch devices
                    setTimeout(() => this.hideTooltip(), 3000); 
                } 
            }, { passive: true });
            group.appendChild(icon);
        }
        return group;
    }

    /**
     * Renders a sortable list of behaviors for the Block Generator.
     * @private
     */
    _renderSortableList(wrapper, def) {
        wrapper.className = 'sortable-list-wrapper';
        const list = document.createElement('div');
        list.className = 'sortable-list';
        list.id = `sortable-${def.id}`;
        wrapper.appendChild(list);

        const updateList = () => {
            list.innerHTML = '';
            // Get current effect and its growth pool
            const effect = window.matrix?.effects?.get('QuantizedBlockGenerator');
            if (!effect || !effect.growthPool) {
                list.innerHTML = '<div class="status-msg">Block Generator not active or no behaviors found.</div>';
                return;
            }

            const behaviors = Array.from(effect.growthPool.entries());
            
            behaviors.forEach(([id, data], index) => {
                const item = document.createElement('div');
                item.className = 'sortable-item';
                item.draggable = true;
                item.dataset.id = id;
                item.dataset.index = index;

                item.innerHTML = `
                    <div class="sortable-handle">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </div>
                    <div class="sortable-label">${id.replace(/_/g, ' ').toUpperCase()}</div>
                    <div class="sortable-toggle">
                        <input type="checkbox" ${data.enabled ? 'checked' : ''} id="toggle-${id}">
                    </div>
                `;

                // Toggle logic
                const toggle = item.querySelector(`#toggle-${id}`);
                toggle.onclick = (e) => {
                    e.stopPropagation();
                    effect.setBehaviorFlag(id, toggle.checked);
                };

                // Drag & Drop Logic
                item.addEventListener('dragstart', (e) => {
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index);
                });

                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    list.querySelectorAll('.sortable-item').forEach(i => i.style.borderTop = '');
                });

                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const draggingItem = list.querySelector('.dragging');
                    if (draggingItem !== item) {
                        const rect = item.getBoundingClientRect();
                        const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                        list.insertBefore(draggingItem, next ? item.nextSibling : item);
                    }
                });

                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    // Finalize order in growthPool
                    const newPool = new Map();
                    list.querySelectorAll('.sortable-item').forEach(el => {
                        const behaviorId = el.dataset.id;
                        newPool.set(behaviorId, effect.growthPool.get(behaviorId));
                    });
                    effect.growthPool = newPool;
                    this.notifications.show('Behavior Priority Updated', 'success');
                });

                list.appendChild(item);
            });
        };

        // Initial render
        updateList();
        
        // Refresh when effect is triggered
        window.addEventListener('effect_triggered', (e) => {
            if (e.detail === 'QuantizedBlockGenerator') updateList();
        });
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
        } else if (def.type === 'sortable_list') {
            this._renderSortableList(row, def);
        } else if (def.type === 'slot') {
            row.className = 'slot-container';
            const inp = document.createElement('input'); inp.className = 'slot-name-input'; inp.value = this.c.slots[def.idx].name; inp.id = `slot-input-${def.idx}`; inp.name = `slot_name_${def.idx}`; inp.onchange = e => this.c.renameSlot(def.idx, e.target.value);
            inp.onfocus = e => e.target.select();
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
            if(!def.hideValue && def.type === 'range') { 
                const valDisp = document.createElement('span'); 
                valDisp.id = `val-${def.id}`;
                valDisp.title = "Click to manual input";
                valDisp.style.cursor = "pointer";
                
                // Set initial value
                const initialVal = this.c.get(def.id);
                let displayVal = initialVal;
                if (!def.transform && typeof initialVal === 'number') {
                    const step = def.step || 1;
                    const decimals = (step.toString().split('.')[1] || '').length;
                    displayVal = parseFloat(initialVal.toFixed(decimals));
                }
                valDisp.textContent = def.transform ? def.transform(initialVal) : displayVal + (def.unit || '');

                valDisp.onclick = () => {
                    if (valDisp.querySelector('input')) return;
                    
                    const currentVal = this.c.get(def.id);
                    valDisp.textContent = '';
                    
                    const numInput = document.createElement('input');
                    numInput.type = 'number';
                    numInput.value = currentVal;
                    numInput.className = 'manual-input'; 
                    // basic inline styles to make it fit
                    numInput.style.width = '60px';
                    numInput.style.background = '#222';
                    numInput.style.color = '#fff';
                    numInput.style.border = '1px solid #444';
                    numInput.style.borderRadius = '3px';
                    numInput.style.padding = '0 2px';

                    if (def.min !== undefined) numInput.min = def.min;
                    if (def.max !== undefined) numInput.max = def.max;
                    if (def.step !== undefined) numInput.step = def.step;

                    let committed = false;
                    const commit = () => {
                        if (committed) return;
                        let newVal = parseFloat(numInput.value);
                        if (isNaN(newVal)) {
                             this.refresh(def.id);
                             return;
                        }
                        
                        // Clamp
                        if (def.min !== undefined && newVal < def.min) newVal = def.min;
                        if (def.max !== undefined && newVal > def.max) newVal = def.max;

                        // Step precision
                        if (def.step) {
                            const step = parseFloat(def.step);
                            newVal = Math.round(newVal / step) * step;
                        }

                        committed = true;
                        this.c.set(def.id, newVal);
                    };

                    numInput.onblur = () => {
                        if (!committed) this.refresh(def.id);
                    };

                    numInput.onkeydown = (e) => {
                         e.stopPropagation(); // Ensure keys like Backspace reach the input
                         if(e.key === 'Enter') commit();
                         if(e.key === 'Escape') this.refresh(def.id);
                    };

                    valDisp.appendChild(numInput);
                    numInput.focus();
                    numInput.select();
                };

                hdr.appendChild(valDisp); 
            } row.appendChild(hdr); } 
                else { row.appendChild(labelGroup); }
            let inp;

            if(def.type === 'range') { 
                inp = document.createElement('input'); 
                inp.type = 'range'; 
                inp.min=def.min; 
                inp.max=def.max; 
                if(def.step) inp.step=def.step; 

                const resetToDefault = () => {
                     if (this.c.get('doubleClickToReset')) {
                        const defaultVal = this.c.defaults[def.id];
                        if (defaultVal !== undefined) {
                            this.c.set(def.id, defaultVal);
                            this.notifications.show(`Reset ${def.label}`, 'info');
                            return true;
                        }
                    }
                    return false;
                };
                inp.ondblclick = resetToDefault;
                
                let isTouching = false;
                let lastTapTime = 0;

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
                    const currentTime = new Date().getTime();
                    const tapLength = currentTime - lastTapTime;
                    if (tapLength < 300 && tapLength > 0) {
                        if (resetToDefault()) {
                            e.preventDefault();
                            return;
                        }
                    }
                    lastTapTime = currentTime;

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
            else if(def.type === 'select') { 
                inp = document.createElement('select'); 
                let options = def.options;
                if (options === 'fonts') options = this._getFonts();
                else if (options === 'shaders') options = this._getShaders();
                else if (typeof options === 'function') options = options();
                
                (options || []).forEach(o => { 
                    const opt = document.createElement('option'); 
                    opt.value = o.value; 
                    opt.textContent = o.label; 
                    if(o.custom) opt.className = 'custom-font-opt'; 
                    if(this.c.get(def.id) === o.value) opt.selected = true; 
                    inp.appendChild(opt); 
                }); 
                inp.onchange = e => this.c.set(def.id, e.target.value); 
            }
            else if(def.type === 'text') {
                inp = document.createElement('input');
                inp.type = 'text';
                const val = this.c.get(def.id);
                inp.value = def.transform ? def.transform(val) : (val || "");
                inp.onchange = e => {
                    const finalVal = def.parse ? def.parse(e.target.value) : e.target.value;
                    this.c.set(def.id, finalVal);
                };
            }
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
        if(action === 'quantizedClimb') { if(this.effects.trigger('QuantizedClimb')) this.notifications.show('Quantized Climb Triggered', 'success'); else this.notifications.show('Quantized Climb active...', 'info'); }
        if(action === 'quantizedZoom') { if(this.effects.trigger('QuantizedZoom')) this.notifications.show('Quantized Zoom Triggered', 'success'); else this.notifications.show('Quantized Zoom active...', 'info'); }
        if(action === 'QuantizedBlockGenerator') { if(this.effects.trigger('QuantizedBlockGenerator')) this.notifications.show('Quantized Block Generator Triggered', 'success'); else this.notifications.show('Quantized Block Generator already active...', 'info'); }
        if(action === 'dejavu') { if(this.effects.trigger('DejaVu')) this.notifications.show('Deja Vu Triggered', 'success'); else this.notifications.show('Deja Vu already active...', 'info'); }
        if(action === 'superman') { if(this.effects.trigger('Superman')) this.notifications.show('Neo is flying...', 'success'); else this.notifications.show('Superman active...', 'info'); }
    }

    /**
     * Refreshes the UI to reflect current configuration settings.
     * @param {string} key - The specific configuration key to refresh, or 'ALL' to refresh all controls.
     */
    refresh(key, isRecursive = false) {
        try {
            if(key === 'ALL') { 
                this.defs.forEach(d => { if(d.id) this.refresh(d.id, true); }); 
                this.updateSlotNames();
                this.refresh('fontFamily', true);
                
                // Unified initial dependency refresh
                this.dom.content.querySelectorAll('[data-dep]').forEach(row => {
                    this._updateRowVisibility(row);
                });
                return; 
            }

            if (key === 'keyBindings') {
                this.defs.filter(d => d.type === 'keybinder').forEach(d => this.refresh(d.id));
                return;
            }

            if (key === 'debugTabEnabled') {
                this._setupTabs();
                return;
            }

            if (key === 'fontFamily' || key === 'fontSettings') {
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
                
                const currentPrimaryColor = this.c.get('streamPalette')[0];
                const logo = document.getElementById('matrixLogo');
                if (logo) {
                    const randomChar = Utils.getRandomKatakanaChar();
                    logo.src = Utils.generateGlyphSVG(randomChar, currentPrimaryColor, 48, this.c.get('fontFamily'));
                }
                const favicon = document.getElementById('favicon');
                if (favicon) {
                    const randomChar = Utils.getRandomKatakanaChar();
                    favicon.href = Utils.generateGlyphSVG(randomChar, currentPrimaryColor, 32, this.c.get('fontFamily'));
                }
                return;
            }

            if (key === 'customShader' || key === 'shaderEnabled') {
                const shaderNameDisplay = document.getElementById('in-currentShaderNameDisplay');
                if (shaderNameDisplay) {
                    let name = 'No shader loaded.';
                    const customShaderSource = this.c.get('customShader');
                    const shaderEnabled = this.c.get('shaderEnabled');
                    
                    if (shaderEnabled && customShaderSource) {
                        const nameMatch = customShaderSource.substring(0, 500).match(/^\s*\/\/\s*(?:Name|Shader|Title):\s*(.+)$/im);
                        if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();
                        else if (customShaderSource.trim().startsWith('precision')) name = 'Custom Shader (No Name)';
                        else if (customShaderSource.length < 200 && (customShaderSource.includes('/') || customShaderSource.includes('\\'))) {
                             const parts = customShaderSource.split(/[\/\\]/);
                             name = parts[parts.length - 1];
                        }
                        else name = 'Custom Shader';
                    } else if (shaderEnabled) name = 'Unnamed/Default Shader'; 
                    shaderNameDisplay.textContent = `Loaded: ${name}`;
                }
            }

            if (key === 'streamPalette') {
                 const palette = this.c.get('streamPalette');
                 const biasRow = document.getElementById('row-paletteBias');
                 if (biasRow) {
                     if (palette && palette.length > 1) biasRow.classList.remove('control-disabled');
                     else biasRow.classList.add('control-disabled');
                 }
                 
                 if (palette && palette.length > 0) {
                     const color = palette[0];
                     const toggle = this.dom.toggle;
                     if (toggle) {
                         toggle.style.setProperty('--accent', color);
                         toggle.style.borderColor = color;
                         toggle.style.boxShadow = `0 0 5px ${color}40`;
                     }

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

            if (key === 'quantEditorEnabled') {
                const enabled = this.c.get('quantEditorEnabled');
                if (!isRecursive) {
                     location.reload(); 
                     return; 
                }
                if (typeof QuantizedEffectEditor !== 'undefined') {
                    if (!this.quantEditor) this.quantEditor = new QuantizedEffectEditor(this.effects, this);
                    this.quantEditor.toggle(enabled);
                }
            }

            if (key === 'hideMenuIcon') {
                const shouldHide = this.c.get('hideMenuIcon');
                const toggleBtn = this.dom.toggle;
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
                        this._menuIconTimeout = setTimeout(() => {
                            if (!this.dom.panel.classList.contains('open')) {
                                toggleBtn.style.opacity = '0';
                                toggleBtn.style.pointerEvents = 'none';
                            }
                        }, 1000);
                    };
                    showIcon(); 
                    this._menuMouseMoveHandler = (e) => {
                        const isHotZone = (e.clientX > window.innerWidth - 100) && (e.clientY < 100);
                        if (isHotZone || this.dom.panel.classList.contains('open')) showIcon();
                    };
                    document.addEventListener('mousemove', this._menuMouseMoveHandler);
                } else {
                    toggleBtn.style.opacity = '1';
                    toggleBtn.style.pointerEvents = 'auto';
                }
            }

            // Update specific control values
            if(key) {
                if (document.getElementById(`btn-key-${key}`)) this.updateKeyBinderVisuals(key);

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
                        } else if (def.type === 'text') {
                            inp.value = def.transform ? def.transform(val) : (val || "");
                        } else inp.value = String(val);
                    } 
                }
            }

            // Update dependents
            this.dom.content.querySelectorAll(`[data-dep*="${key}"]`).forEach(row => {
                this._updateRowVisibility(row);
            });
        } catch(e) { console.warn("UI Refresh Error:", e); }
    }

    /**
     * Updates visibility and disabled state of a UI row based on its dependencies.
     * @private
     */
    _updateRowVisibility(row) {
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
                if (!!actualVal !== expected) { conditionsMet = false; break; } 
            }

            // Apply visibility logic
            if(conditionsMet) {
                row.classList.remove('control-disabled');
                // Structural elements should be fully shown
                if (row.classList.contains('sub-accordion') || row.classList.contains('accordion-subheader')) {
                    row.style.display = '';
                }
            } else {
                row.classList.add('control-disabled');
                // Structural elements should be fully hidden when dependencies fail
                if (row.classList.contains('sub-accordion') || row.classList.contains('accordion-subheader')) {
                    row.style.display = 'none';
                }
            }
        } catch(e) {}
    }
}
