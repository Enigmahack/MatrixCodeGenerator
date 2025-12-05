# General Suggestions

General Suggestions to follow: 

\#\#\# Best Practices for Enhancing Performance, Stability, and Extensibility of This Codebase

\#\#\#\# 1\. \*\*Implement Before-and-After Value Checkers\*\*  
   \- \*\*Purpose:\*\* Avoid unnecessary operations and memory writes when no meaningful changes occur.  
   \- \*\*Recommendation:\*\*   
     \- Add guards to \`setter\` methods (e.g., in \`ConfigurationManager\`) to bypass operations when values are unchanged.  
     \- Example:  
       \`\`\`javascript  
       set(key, value) {  
           if (this.state\[key\] \=== value) return; // Skip redundant updates  
           this.state\[key\] \= value;  
           // Update logic follows here...  
       }  
       \`\`\`

\#\#\#\# 2\. \*\*Extract Initialization Processes into Dedicated Methods\*\*  
   \- \*\*Purpose:\*\* Simplify constructors by offloading repetitive logic into dedicated private helper methods.  
   \- \*\*Recommendation:\*\*  
     \- For classes like \`MatrixKernel\` or \`ConfigurationManager\`, create modular methods (\`\_initializeEffects\`, \`\_initializeDefaults\`, \`\_resizeGrid\`) to encapsulate repetitive setup tasks.  
     \- Reduces complexity, improves readability, and aids debugging.

\#\#\#\# 3\. \*\*Avoid Redundant Computations\*\*  
   \- \*\*Purpose:\*\* Reduce repetitive calculations or operations in critical performance paths to improve efficiency.  
   \- \*\*Recommendation:\*\*  
     \- Cache results of computations that could be reused in multiple places (e.g., \`updateDerivedValues\` has been optimized with precomputed \`hFactor\` and \`vFactor\` values).  
     \- Avoid recomputing values unnecessarily within loops or during frame updates.

\#\#\#\# 4\. \*\*Optimize Resource-Intensive Operations\*\*  
   \- \*\*Purpose:\*\* Minimize memory allocation and improve processing during high-frequency operations (e.g., rendering loops, grid resizing).  
   \- \*\*Recommendation:\*\*  
     \- For resizing operations, only reinitialize arrays when their size changes, as in the \`\_resizeGrid\` method of \`MatrixGrid\`.  
     \- Leverage typed arrays (\`Uint16Array\`, \`Uint8Array\`, etc.) for fixed-size data storage.  
     \- Avoid allocating memory unless explicitly needed by deferring array initialization (e.g., set to \`null\` until required).

\#\#\#\# 5\. \*\*Centralize Reusable Logic\*\*  
   \- \*\*Purpose:\*\* Eliminate duplication through reusable helper utilities or centralized methods.  
   \- \*\*Recommendation:\*\*  
     \- Use utility functions (e.g., \`Utils.hexToRgb\`, \`createRGBString\`) for shared operations across the codebase.  
     \- Modularize similar tasks (e.g., effect registration in \`MatrixKernel\`).  
     \- Example:  
       \`\`\`javascript  
       const createRGBString \= (color) \=\> {  
           const rgb \= Utils.hexToRgb(color);  
           return \`rgb(${rgb.r},${rgb.g},${rgb.b})\`;  
       };  
       \`\`\`

\#\#\#\# 6\. \*\*Improve State Management Consistency\*\*  
   \- \*\*Purpose:\*\* Keep related state variables consistent to prevent unintended misconfigurations.  
   \- \*\*Recommendation:\*\*   
     \- Ensure logical constraints are enforced. For instance, maintain relationships between \`streamMinLength\` and \`streamMaxLength\` in \`ConfigurationManager\` using conditions in the \`set\` method:  
       \`\`\`javascript  
       if (key \=== 'streamMinLength') {  
           this.state.streamMaxLength \= Math.max(this.state.streamMaxLength, value);  
       } else if (key \=== 'streamMaxLength') {  
           this.state.streamMinLength \= Math.min(this.state.streamMinLength, value);  
       }  
       \`\`\`

\#\#\#\# 7\. \*\*Debounce High-Frequency Event Listeners\*\*  
   \- \*\*Purpose:\*\* Prevent performance degradation caused by overly frequent event triggers, such as window resize events.  
   \- \*\*Recommendation:\*\*  
     \- Use debouncing for events like \`resize\` to limit the frequency of handler executions.  
     \- Example:  
       \`\`\`javascript  
       \_setupResizeListener() {  
           let resizeTimer;  
           window.addEventListener('resize', () \=\> {  
               clearTimeout(resizeTimer);  
               resizeTimer \= setTimeout(() \=\> this.\_resize(), 100);  
           });  
       }  
       \`\`\`

\#\#\#\# 8\. \*\*Abstract Complexity Through Helper Classes/Methods\*\*  
   \- \*\*Purpose:\*\* Reduce duplication and streamline operations.  
   \- \*\*Recommendation:\*\*   
     \- Use helper classes or methods for frequently required tasks such as RGB conversion, array randomization, or stylization.  
     \- Example:  
       \- Utility wrappers like \`Utils.hexToRgb\`, \`Utils.randomInt\`, and simplified initialization helpers (e.g., \`\_resizeGrid\` in \`MatrixGrid\`).

\#\#\#\# 9\. \*\*Split Responsibilities into Logical Modules\*\*  
   \- \*\*Purpose:\*\* Improve maintainability and encourage separation of concerns.  
   \- \*\*Recommendation:\*\*  
     \- Group related responsibilities into modules or methods.  
     \- Example: In \`MatrixKernel\`, segregated responsibilities for initializing managers, effects, and the renderer into separate methods, making the constructor concise and comprehensible.

\#\#\#\# 10\. \*\*Guard Against LocalStorage Errors\*\*  
   \- \*\*Purpose:\*\* Prevent application crashes due to invalid or inaccessible data.  
   \- \*\*Recommendation:\*\*  
     \- Use \`try-catch\` blocks with proper fallback for local storage operations.  
     \- Validate deserialized data to ensure it matches the required structure before merging.

\#\#\#\# 11\. \*\*Clear Documentation and Naming Conventions\*\*  
   \- \*\*Purpose:\*\* Enhance readability and ease of understanding for future developers or tools like other LLMs.  
   \- \*\*Recommendation:\*\*  
     \- Use clear and concise method, class, and variable names to communicate intent.  
     \- Add moderately detailed comments to describe what critical methods and properties do, especially for complex computations (e.g., \`updateDerivedValues\`).

\#\#\#\# 12\. \*\*Make Subscriptions More Robust\*\*  
   \- \*\*Purpose:\*\* Ensure that subscriber callbacks are safe and efficient.  
   \- \*\*Recommendation:\*\*  
     \- Validate callback functions are properly passed in the \`subscribe\` method.  
     \- Prevent duplicate subscriptions by maintaining a unique set of subscribers if needed.

\#\#\#\# 13\. \*\*Avoid Hardcoding Configuration Keys\*\*  
   \- \*\*Purpose:\*\* To enable dynamic extensibility and avoid coupling logic to hardcoded fields.  
   \- \*\*Recommendation:\*\*  
     \- Use dynamic configuration resolution for subscriptions and actions, reducing hardcoded checks throughout the codebase.  
     \- Example: In \`MatrixKernel\` resize-related subscriptions:  
       \`\`\`javascript  
       const resizeDependentKeys \= new Set(\['resolution', 'stretchX', 'stretchY', 'fontSize', 'horizontalSpacingFactor'\]);  
       this.config.subscribe((key) \=\> {  
           if (resizeDependentKeys.has(key) || key \=== 'ALL') {  
               this.\_resize(); // Resize only when necessary  
           }  
       });  
       \`\`\`

\#\#\#\# 14\. \*\*Use Modern ES Syntax and Best Practices\*\*  
   \- \*\*Purpose:\*\* Ensure consistency and take advantage of performance improvements in modern JavaScript engines.  
   \- \*\*Recommendation:\*\*  
     \- Use ES6+ features like \`const\`, \`let\`, destructuring, and arrow functions where possible.  
     \- Avoid \`var\` due to potential scoping issues.  
     \- Favor \`Map\` and \`Set\` for collections that require fast lookups and uniqueness.

\#\#\#\# 15\. \*\*Optimize Rendering and Animation\*\*  
   \- \*\*Purpose:\*\* Reduce rendering overhead for smoother animations in high-frequency loops (e.g., \`requestAnimationFrame\`).  
   \- \*\*Recommendation:\*\*  
     \- Avoid redundant frame updates inside loops or excessive function calls.  
     \- E.g., split complex repetitive tasks in \`MatrixKernel.\_loop\` into focused methods like \`\_updateFrame\`.

\---

\#\#\# Overall Benefits  
These best practices will:  
\- Reduce computational overhead by minimizing redundant operations.  
\- Improve code modularity for easier scalability and maintenance.  
\- Ensure robust and consistent state management.  
\- Leverage modern JavaScript best practices for optimized performance.  
\- Simplify debugging and code comprehension through structured, encapsulated logic. 


# CSS

:root {  
    \--bg-color: \#000;  
    \--panel-bg: rgba(10, 12, 16, 0.96);   
    \--panel-border: rgba(34, 197, 94, 0.3);  
    \--text-main: \#4ade80;  
    \--text-muted: \#86efac;  
    \--accent: \#22c55e;  
    \--accent-glow: rgba(34, 197, 94, 0.4);  
    \--danger: \#ef4444;  
    \--safe-top: env(safe-area-inset-top, 20px);  
    \--safe-right: env(safe-area-inset-right, 20px);  
}

\* {  
    box-sizing: border-box;  
    margin: 0;  
    padding: 0;  
}

html, body {  
    height: 100%;  
    font-family: 'Segoe UI', 'Roboto', monospace;  
    background-color: var(--bg-color);  
    overscroll-behavior: none;  
}

canvas {  
    display: block;  
    position: absolute;  
    top: 0;  
    left: 0;  
    width: 100vw;  
    height: 100vh;  
}

\#bloomCanvas {  
    display: none;  
}

/\* Toggle Button \*/  
\#menuToggle {  
    position: fixed;  
    top: max(0.75rem, var(--safe-top));  
    right: max(1.2rem, var(--safe-right));  
    width: 44px;  
    height: 44px;  
    border-radius: 50%;  
    border: 1px solid var(--panel-border);  
    background: rgba(10, 12, 16, 0.6);  
    color: var(--text-main);  
    display: flex;  
    align-items: center;  
    justify-content: center;  
    z-index: 30;  
    transition: all 0.3s ease;  
}

\#menuToggle:hover {  
    background: var(--accent);  
    color: \#000;  
    box-shadow: 0 0 20px var(--accent);  
    transform: rotate(90deg);  
}

/\* Settings Panel \*/  
\#settingsPanel {  
    position: fixed;  
    top: 0;  
    right: 0;  
    height: 100%;  
    width: 340px;  
    max-width: 100%;  
    background-color: var(--panel-bg);  
    box-shadow: \-10px 0 30px rgba(0, 0, 0, 0.8);  
    border-left: 1px solid var(--panel-border);  
    z-index: 20;  
    display: flex;  
    flex-direction: column;  
    transform: translateX(100%);  
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);  
    font-size: 0.9rem;  
    color: var(--text-main);  
}

\#settingsPanel\[aria-hidden="false"\] {  
    transform: translateX(0);  
}

\#panelHeader {  
    padding: 1.25rem;  
    padding-top: max(1.25rem, var(--safe-top));  
    border-bottom: 1px solid var(--panel-border);  
    background: linear-gradient(90deg, rgba(34, 197, 94, 0.1), transparent);  
}

.panel-title {  
    font-size: 1.2rem;  
    text-transform: uppercase;  
    letter-spacing: 2px;  
    text-shadow: 0 0 10px var(--accent-glow);  
}

\#panelFooter {  
    padding: 1rem;  
    border-top: 1px solid var(--panel-border);  
    text-align: center;  
}

/\* Toast Container \*/  
\#toast-container {  
    position: fixed;  
    bottom: 20px;  
    left: 50%;  
    transform: translateX(-50%);  
    z-index: 10001;  
    display: flex;  
    flex-direction: column;  
    gap: 10px;  
    align-items: center;  
    pointer-events: none; /\* Prevent user interactions \*/  
}

/\* Base Styles for Toast Messages \*/  
.toast-msg {  
    background: \#1f2937; /\* Dark background \*/  
    border: 1px solid; /\* Border color will depend on the toast type \*/  
    color: \#fff; /\* White text \*/  
    padding: 12px 24px;  
    border-radius: 8px;  
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);  
    font-size: 0.9rem;  
    opacity: 0; /\* Initial state for animation \*/  
    transform: translateY(10px); /\* Slide in effect \*/  
    transition: opacity 0.3s ease, transform 0.3s ease;  
    pointer-events: auto; /\* Allow interaction on visible elements \*/  
}

/\* Visible Toast Animation \*/  
.toast-msg.visible {  
    opacity: 1;  
    transform: translateY(0);  
}

/\* Toast Types \*/  
.toast-info {  
    border-color: var(--info, \#3b82f6);  
}

.toast-success {  
    border-color: var(--success, \#4ade80);  
    color: var(--success-text, \#e6ffe6);  
}

.toast-error {  
    border-color: var(--danger, \#ef4444);  
    color: var(--error-text, \#ffe6e6);  
}

/\* For smaller devices \*/  
@media (max-width: 600px) {  
    \#settingsPanel {  
        width: 90%;  
        max-width: 100%;  
    }  
}

# HTML

\<\!DOCTYPE html\>  
\<html lang="en"\>  
\<head\>  
    \<meta charset="UTF-8"\>  
    \<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"\>  
    \<title\>Matrix Digital Rain\</title\>  
    \<link rel="stylesheet" href="css/style.css"\>  
\</head\>  
\<body\>  
    \<\!-- Primary Canvas for Matrix Animation \--\>  
    \<canvas id="matrixCanvas" aria-label="Matrix Digital Rain Animation"\>\</canvas\>

    \<\!-- Hidden Bloom Canvas for Layer Effects \--\>  
    \<canvas id="bloomCanvas" hidden aria-hidden="true"\>\</canvas\>

    \<\!-- Toggle Button for Opening Settings Menu \--\>  
    \<button id="menuToggle" aria-controls="settingsPanel" aria-expanded="false" aria-label="Open Settings"\>  
        \<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" aria-hidden="true" focusable="false"\>  
            \<path d="M9.405..."\>\</path\>  
        \</svg\>  
    \</button\>

    \<\!-- Input for Importing Files \--\>  
    \<input type="file" id="importFile" accept=".json" hidden aria-label="Import JSON Configuration" /\>  
    \<input type="file" id="importFontFile" accept=".ttf,.otf,.woff,.woff2" hidden aria-label="Import Font Files" /\>

    \<\!-- Settings Panel \--\>  
    \<aside id="settingsPanel" role="dialog" aria-hidden="true"\>  
        \<header id="panelHeader" role="banner"\>  
            \<h2 class="panel-title"\>Settings\</h2\>  
        \</header\>

        \<\!-- Navigation Tabs \--\>  
        \<nav id="navTabs" role="tablist" aria-label="Settings Navigation"\>\</nav\>

        \<\!-- Content Area \--\>  
        \<main id="contentArea"\>  
            \<\!-- Dynamic content will populate through scripts \--\>  
        \</main\>

        \<\!-- Panel Footer \--\>  
        \<footer id="panelFooter"\>  
            \<p id="globalStatus" class="status-msg"\>Matrix Code v7.3.1\</p\>  
        \</footer\>  
    \</aside\>

    \<\!-- JavaScript Dependencies \--\>  
    \<script src="js/core/Utils.js" defer\>\</script\>  
    \<script src="js/ui/NotificationManager.js" defer\>\</script\>  
    \<script src="js/config/ConfigurationManager.js" defer\>\</script\>  
    \<script src="js/data/MatrixGrid.js" defer\>\</script\>  
    \<script src="js/simulation/StreamModes.js" defer\>\</script\>  
    \<script src="js/simulation/SimulationSystem.js" defer\>\</script\>  
    \<script src="js/effects/EffectRegistry.js" defer\>\</script\>  
    \<script src="js/effects/PulseEffect.js" defer\>\</script\>  
    \<script src="js/effects/ClearPulseEffect.js" defer\>\</script\>  
    \<script src="js/effects/MiniPulseEffect.js" defer\>\</script\>  
    \<script src="js/effects/DejaVuEffect.js" defer\>\</script\>  
    \<script src="js/effects/SupermanEffect.js" defer\>\</script\>  
    \<script src="js/effects/FirewallEffect.js" defer\>\</script\>  
    \<script src="js/rendering/CanvasRenderer.js" defer\>\</script\>  
    \<script src="js/data/FontData.js" defer\>\</script\>  
    \<script src="js/ui/FontManager.js" defer\>\</script\>  
    \<script src="js/ui/UIManager.js" defer\>\</script\>  
    \<script src="js/core/MatrixKernel.js" defer\>\</script\>  
\</body\>  
\</html\>

# CanvasRenderer

class CanvasRenderer {  
    constructor(canvasId, grid, config, effects) {  
        this.cvs \= document.getElementById(canvasId);  
        this.ctx \= this.cvs.getContext('2d', { alpha: false });  
        this.bloomCvs \= document.getElementById('bloomCanvas');  
        this.bloomCtx \= this.bloomCvs.getContext('2d', { alpha: true });

        this.grid \= grid;  
        this.config \= config;  
        this.effects \= effects;

        this.w \= 0; // Canvas width  
        this.h \= 0; // Canvas height  
    }

    /\*\*  
     \* Resize canvas based on window dimensions and configuration settings.  
     \* \- Uses scale factor for resolution improvement.  
     \* \- Adjusts bloom canvas size independently for performance.  
     \*/  
    resize() {  
        const { resolution: scale, state } \= this.config;  
        this.w \= window.innerWidth;  
        this.h \= window.innerHeight;

        this.\_resizeCanvas(this.cvs, this.w, this.h, scale);  
        this.\_resizeCanvas(this.bloomCvs, this.w / 4, this.h / 4, scale \* 0.25, this.bloomCtx);  
        this.updateSmoothing();  
    }

    \_resizeCanvas(canvas, width, height, scale, context \= this.ctx) {  
        canvas.width \= width \* scale;  
        canvas.height \= height \* scale;  
        canvas.style.width \= \`${width}px\`;  
        canvas.style.height \= \`${height}px\`;

        if (context) {  
            context.scale(1, 1);  
            context.setTransform(scale, 0, 0, scale, 0, 0); // Reset scaling to avoid stacking transformations.  
        }  
    }

    /\*\*  
     \* Updates canvas smoothing filters for blur effects.  
     \* Ensures visual fidelity when smoothing is enabled in settings.  
     \*/  
    updateSmoothing() {  
        const smoothing \= this.config.state.smoothingEnabled ? this.config.state.smoothingAmount : 0;  
        this.cvs.style.filter \= \`blur(${smoothing}px)\`;  
    }

    /\*\*  
     \* Calculates the alpha and phase of the tracer based on its age and active state.  
     \* Optimized logic with early returns and simplified operations.  
     \*/  
    \_getTracerState(index, state) {  
        const { ages, decays } \= this.grid;  
        const age \= ages\[index\];  
        const decay \= decays\[index\];

        if (age \<= 0 || decay \>= 2\) return { alpha: 0, phase: 'none' };

        const { tracerAttackFrames: attack, tracerHoldFrames: hold, tracerReleaseFrames: release } \= state;  
        const activeTime \= age \- 1;

        if (activeTime \< attack) {  
            return { alpha: attack \> 0 ? (activeTime / attack) : 1.0, phase: 'attack' };  
        } else if (activeTime \< attack \+ hold) {  
            return { alpha: 1.0, phase: 'hold' };  
        } else if (activeTime \< attack \+ hold \+ release) {  
            const releaseTime \= activeTime \- (attack \+ hold);  
            return { alpha: 1.0 \- (releaseTime / release), phase: 'release' };  
        }

        return { alpha: 0, phase: 'none' };  
    }

    /\*\*  
     \* Main render method called on each frame.  
     \* Optimized with pre-computed constants and reduced redundant state changes.  
     \*/  
    render(frame) {  
        const { state: s, derived: d } \= this.config;  
        const scale \= s.resolution; // Pre-compute scale.  
        const bloomEnabled \= s.enableBloom;

        // Clear canvas and apply scaling beforehand.  
        this.\_resetContext(this.ctx, s, scale);  
        if (bloomEnabled) this.bloomCtx.clearRect(0, 0, this.bloomCvs.width, this.bloomCvs.height);

        // Adjust for vertical mirror effect.  
        this.\_applyMirrorEffect(this.ctx, s);  
        if (bloomEnabled) this.\_applyMirrorEffect(this.bloomCtx, s, scale);

        const drawParams \= {  
            defaultColor: d.streamColorStr,  
            fontBase: d.fontBaseStr,  
            tracerColor: d.tracerColorStr,  
        };

        this.\_drawGrid(drawParams, frame, bloomEnabled);

        // Apply bloom effect by combining bloom layer with lighter blend mode.  
        if (bloomEnabled) {  
            this.\_applyBloom(s, scale);  
        }  
    }

    \_resetContext(ctx, s, scale) {  
        ctx.save();  
        ctx.setTransform(scale \* s.stretchX, 0, 0, scale \* s.stretchY, 0, 0);  
        ctx.fillStyle \= \`rgba(0,0,0,${s.clearAlpha})\`;  
        ctx.fillRect(0, 0, this.w / s.stretchX, this.h / s.stretchY);  
    }

    \_applyMirrorEffect(ctx, s) {  
        if (s.mirrorEnabled) {  
            ctx.scale(-1, 1);  
            ctx.translate(-this.w / s.stretchX, 0);  
        }  
    }

    \_drawGrid(drawParams, frame, bloomEnabled) {  
        const {  
            alphas,  
            decays,  
            cols,  
            rows,  
            activeIndices,  
            complexStyles,  
            getChar,  
            rotatorProg,  
            nextChars,  
        } \= this.grid;

        const { state: s, derived: d } \= this.config;  
        const totalCells \= cols \* rows;

        let lastColor \= drawParams.defaultColor;  
        this.ctx.fillStyle \= lastColor;

        const xOff \= s.fontOffsetX;  
        const yOff \= s.fontOffsetY;

        const activeCellIndices \= this.effects.hasActiveEffects() ? \[...Array(totalCells).keys()\] : activeIndices;

        for (const i of activeCellIndices) {  
            const gridAlpha \= alphas\[i\];  
            if (gridAlpha \<= 0.01) continue;

            const tState \= this.\_getTracerState(i, s);  
            if (tState.alpha \=== 0\) continue;

            const x \= i % cols;  
            const y \= Math.floor(i / cols);  
            const px \= x \* d.cellWidth \+ d.cellWidth \* 0.5 \+ xOff;  
            const py \= y \* d.cellHeight \+ d.cellHeight \* 0.5 \+ yOff;

            let cellColor \= drawParams.defaultColor;  
            const cellStyle \= complexStyles.get(i);

            // Dynamic color adjustments (cached if unchanged).  
            if (cellStyle) {  
                cellColor \= this.\_getCellColor(cellStyle, frame);  
            }

            this.\_setFillStyle(cellColor, lastColor, bloomEnabled);  
            this.\_drawCellCharacter(i, px, py, tState.alpha, cellStyle);  
            lastColor \= cellColor;  
        }  
    }

    \_getCellColor(style, frame) {  
        if (style.glitter && Math.random() \< 0.02) return '\#FFFFFF';  
          
        let hue \= style.h;  
        if (style.cycle) hue \= (hue \+ frame \* style.speed) % 360;

        const { r, g, b } \= Utils.hslToRgb(hue, style.s, style.l);  
        return \`rgb(${r},${g},${b})\`;  
    }

    \_setFillStyle(color, lastColor, bloomEnabled) {  
        if (color \=== lastColor) return;

        this.ctx.fillStyle \= color;  
        if (bloomEnabled) this.bloomCtx.fillStyle \= color;  
    }

    \_drawCellCharacter(i, x, y, alpha, style) {  
        const char \= this.grid.getChar(i);

        this.ctx.globalAlpha \= alpha;  
        this.ctx.fillText(char, x, y);  
        if (this.config.state.enableBloom) {  
            this.bloomCtx.globalAlpha \= alpha;  
            this.bloomCtx.fillText(char, x, y);  
        }  
    }

    \_applyBloom(s, scale) {  
        this.bloomCtx.restore();  
        this.ctx.save();

        this.ctx.globalCompositeOperation \= 'lighter';  
        this.ctx.filter \= \`blur(${s.bloomStrength \* 4}px)\`;  
        this.ctx.globalAlpha \= s.bloomOpacity;  
        this.ctx.drawImage(this.bloomCvs, 0, 0, this.w \* scale, this.h \* scale);

        this.ctx.restore();  
    }  
}

# NotificationManager

class NotificationManager {  
    constructor() {  
        this.container \= document.getElementById('toast-container') || this.\_createContainer();  
    }

    /\*\*  
     \* Creates and initializes the toast container if it doesn't exist.  
     \* @returns {HTMLElement} The toast container DOM element.  
     \*/  
    \_createContainer() {  
        const container \= document.createElement('div');  
        container.id \= 'toast-container';  
        container.setAttribute('aria-live', 'polite'); // Accessibility: Announce updates to screen readers.  
        container.setAttribute('role', 'status'); // Accessibility: Define the type of content the container holds.  
        document.body.appendChild(container);  
        return container;  
    }

    /\*\*  
     \* Displays a notification with the specified message and type.  
     \* @param {string} message \- The message to display in the notification.  
     \* @param {string} \[type='info'\] \- The type of the notification ('info', 'success', 'error', etc.).  
     \* @param {number} \[duration=3000\] \- The duration (in milliseconds) for the notification to be visible.  
     \*/  
    show(message, type \= 'info', duration \= 3000\) {  
        // Create the notification element.  
        const toast \= this.\_createToast(message, type);

        // Ensure the container is attached.  
        if (\!document.body.contains(this.container)) {  
            document.body.appendChild(this.container);  
        }

        // Add the notification to the container and apply the "visible" class for animation.  
        this.container.appendChild(toast);  
        requestAnimationFrame(() \=\> toast.classList.add('visible'));

        // Set timers for hiding and removing the notification.  
        this.\_scheduleToastRemoval(toast, duration);  
    }

    /\*\*  
     \* Creates an individual toast element.  
     \* @private  
     \* @param {string} message \- The message to display.  
     \* @param {string} type \- The type of the notification.  
     \* @returns {HTMLElement} The toast DOM element.  
     \*/  
    \_createToast(message, type) {  
        const toast \= document.createElement('div');  
        toast.className \= \`toast-msg toast-${type}\`;  
        toast.textContent \= message;  
        toast.setAttribute('role', 'alert'); // Accessibility: Specify that this is an alert message.  
        return toast;  
    }

    /\*\*  
     \* Schedules the removal of the notification after the specified duration.  
     \* Handles smooth animation states before removing the DOM element.  
     \* @private  
     \* @param {HTMLElement} toast \- The toast element to remove.  
     \* @param {number} duration \- How long the toast remains visible.  
     \*/  
    \_scheduleToastRemoval(toast, duration) {  
        setTimeout(() \=\> {  
            // Trigger fade-out animation by removing the "visible" class.  
            toast.classList.remove('visible');  
            // Remove the toast element from the DOM after the animation completes.  
            setTimeout(() \=\> toast.remove(), 300); // Matches CSS animation transition time.  
        }, duration);  
    }  
}

# FontManager

class FontManager {  
    constructor(config, notificationMgr) {  
        this.config \= config;  
        this.notifications \= notificationMgr;  
        this.dbName \= 'MatrixFontDB';  
        this.storeName \= 'fonts';  
        this.db \= null;  
        this.loadedFonts \= \[\];  
        this.subscribers \= \[\];  
        this.embeddedFontName \= 'MatrixEmbedded';  
    }

    /\*\*  
     \* Initialize the FontManager by injecting the embedded font and loading fonts from the database.  
     \*/  
    async init() {  
        if (DEFAULT\_FONT\_DATA && DEFAULT\_FONT\_DATA.length \> 50\) {  
            this.injectEmbeddedFont();  
        }

        try {  
            await this.\_openDB();  
            await this.\_loadFontsFromDB();  
        } catch (error) {  
            console.warn('Font DB Error:', error);  
        }  
    }

    /\*\*  
     \* Add a subscription callback to be notified on font changes.  
     \* @param {Function} callback \- The callback function to execute on changes.  
     \*/  
    subscribe(callback) {  
        this.subscribers.push(callback);  
    }

    /\*\*  
     \* Notify all subscribers about font changes.  
     \* Executes the callback functions passed via subscribe.  
     \*/  
    \_notify() {  
        this.subscribers.forEach(callback \=\> callback(this.loadedFonts));  
    }

    /\*\*  
     \* Inject the embedded default Matrix font if it hasn't already been loaded.  
     \*/  
    injectEmbeddedFont() {  
        const isFontInjected \= this.loadedFonts.some(f \=\> f.name \=== this.embeddedFontName);  
        if (isFontInjected) return;

        this.\_injectCSS(this.embeddedFontName, DEFAULT\_FONT\_DATA, "format('woff2')");  
        this.loadedFonts.push({  
            name: this.embeddedFontName,  
            display: 'The Matrix Custom Code',  
            isEmbedded: true,  
        });  
    }

    /\*\*  
     \* Inject a font into the document as a CSS @font-face rule.  
     \* @param {string} name \- Font's name.  
     \* @param {string} url \- The URL or source of the font data.  
     \* @param {string} format \- The format of the font data (e.g., 'format("woff2")').  
     \*/  
    \_injectCSS(name, url, format) {  
        const existingStyle \= document.getElementById(\`style-${name}\`);  
        if (existingStyle) existingStyle.remove();

        const style \= document.createElement('style');  
        style.id \= \`style-${name}\`;  
        style.textContent \= \`  
            @font-face {  
                font-family: '${name}';  
                src: url('${url}') ${format};  
            }  
        \`;  
        document.head.appendChild(style);  
    }

    /\*\*  
     \* Open or create the IndexedDB for storing font data.  
     \* @returns {Promise} Resolves when the database connection is successful.  
     \*/  
    async \_openDB() {  
        return new Promise((resolve, reject) \=\> {  
            const request \= indexedDB.open(this.dbName, 1);

            request.onupgradeneeded \= event \=\> {  
                const db \= event.target.result;  
                if (\!db.objectStoreNames.contains(this.storeName)) {  
                    db.createObjectStore(this.storeName, { keyPath: 'name' });  
                }  
            };

            request.onsuccess \= event \=\> {  
                this.db \= event.target.result;  
                resolve();  
            };

            request.onerror \= () \=\> reject(request.error);  
        });  
    }

    /\*\*  
     \* Load all fonts stored in the database into the application.  
     \* @returns {Promise} Resolves once fonts are loaded.  
     \*/  
    async \_loadFontsFromDB() {  
        return new Promise(resolve \=\> {  
            if (\!this.db) return resolve();

            const transaction \= this.db.transaction(this.storeName, 'readonly');  
            const objectStore \= transaction.objectStore(this.storeName);

            objectStore.getAll().onsuccess \= event \=\> {  
                const storedFonts \= event.target.result;

                // Reset the font list, keeping only the embedded font.  
                this.loadedFonts \= this.loadedFonts.filter(f \=\> f.isEmbedded);

                // Inject fonts from the database into the application.  
                storedFonts.forEach(font \=\> {  
                    this.loadedFonts.push(font);

                    const type \= font.mimeType || font.data.type;  
                    const format \= this.\_getFormatFromType(type);  
                    this.\_injectCSS(font.name, URL.createObjectURL(font.data), format);  
                });

                this.\_notify();  
                resolve();  
            };  
        });  
    }

    /\*\*  
     \* Determine the CSS format string for a given MIME type.  
     \* @param {string} mimeType \- The MIME type of the font file.  
     \* @returns {string} The corresponding format string for @font-face.  
     \*/  
    \_getFormatFromType(mimeType) {  
        if (mimeType.includes('woff2')) return "format('woff2')";  
        if (mimeType.includes('woff')) return "format('woff')";  
        if (mimeType.includes('opentype') || mimeType.includes('otf')) return "format('opentype')";  
        return "format('truetype')";  
    }

    /\*\*  
     \* Import a custom font into the database and inject it as a CSS @font-face.  
     \* @param {File} file \- The font file to import.  
     \*/  
    importFont(file) {  
        const reader \= new FileReader();

        reader.onload \= event \=\> {  
            const blob \= new Blob(\[event.target.result\], { type: file.type });  
            const fontName \= \`CustomFont\_${Date.now()}\`; // Unique font name.  
            const record \= {  
                name: fontName,  
                display: file.name,  
                data: blob,  
                mimeType: file.type,  
            };

            const transaction \= this.db.transaction(this.storeName, 'readwrite');  
            const objectStore \= transaction.objectStore(this.storeName);

            objectStore.put(record).onsuccess \= () \=\> {  
                const format \= this.\_getFormatFromType(file.type);  
                this.\_injectCSS(fontName, URL.createObjectURL(blob), format);

                this.loadedFonts.push(record);  
                this.config.set('fontFamily', fontName);  
                this.\_notify();

                this.notifications.show(\`Imported: ${file.name}\`, 'success');  
            };

            transaction.onerror \= () \=\> {  
                this.notifications.show('Database Write Failed', 'error');  
            };  
        };

        reader.readAsArrayBuffer(file);  
    }

    /\*\*  
     \* Delete a font by its ID from the database and the DOM.  
     \* @param {string} id \- The ID of the font to delete.  
     \* @returns {Promise} Resolves once the font is deleted.  
     \*/  
    deleteFont(id) {  
        return new Promise(resolve \=\> {  
            const transaction \= this.db.transaction(this.storeName, 'readwrite');  
            const objectStore \= transaction.objectStore(this.storeName);

            objectStore.delete(id).onsuccess \= () \=\> {  
                document.getElementById(\`style-${id}\`)?.remove();  
                this.loadedFonts \= this.loadedFonts.filter(font \=\> font.name \!== id);

                if (this.config.state.fontFamily \=== id) {  
                    this.config.set('fontFamily', this.config.defaults.fontFamily);  
                }

                this.\_notify();  
                resolve();  
            };  
        });  
    }

    /\*\*  
     \* Clear all fonts from the database and only keep embedded fonts.  
     \* @returns {Promise} Resolves once all fonts are deleted.  
     \*/  
    deleteAllFonts() {  
        return new Promise(resolve \=\> {  
            const transaction \= this.db.transaction(this.storeName, 'readwrite');  
            const objectStore \= transaction.objectStore(this.storeName);

            objectStore.clear().onsuccess \= () \=\> {  
                // Remove all non-embedded fonts.  
                this.loadedFonts  
                    .filter(font \=\> \!font.isEmbedded)  
                    .forEach(font \=\> document.getElementById(\`style-${font.name}\`)?.remove());

                // Keep only embedded fonts.  
                this.loadedFonts \= this.loadedFonts.filter(font \=\> font.isEmbedded);

                this.\_notify();  
                resolve();  
            };  
        });  
    }  
}

# UIManager

class UIManager {  
    constructor(c, effects, fonts, notificationMgr) {  
        // Core dependencies and state  
        this.c \= c;  
        this.effects \= effects;  
        this.fonts \= fonts;  
        this.notifications \= notificationMgr;  
        this.dom \= this.\_initializeDOM();  
        this.scrollState \= { isDown: false, startX: 0, scrollLeft: 0, dragDistance: 0 };  
        this.defs \= this.\_generateDefinitions();

        // Event subscriptions  
        this.c.subscribe((key, state) \=\> this.refresh(key));  
        this.fonts.subscribe(() \=\> this.refresh('fontFamily'));

        // Initialization  
        this.init();  
    }

    /\*\*  
     \* Establish initial DOM structure using expected selectors and IDs.  
     \* @private  
     \*/  
    \_initializeDOM() {  
        return {  
            panel: document.getElementById('settingsPanel'),  
            toggle: document.getElementById('menuToggle'),  
            tabs: document.getElementById('navTabs'),  
            content: document.getElementById('contentArea'),  
            tooltip: document.getElementById('ui-tooltip') || this.\_createTooltip(),  
            track: document.getElementById('tabTrack'),  
        };  
    }

    /\*\*  
     \* Create the tooltip element and attach to the DOM.  
     \* @private  
     \*/  
    \_createTooltip() {  
        const tooltip \= document.createElement('div');  
        tooltip.id \= 'ui-tooltip';  
        document.body.appendChild(tooltip);  
        return tooltip;  
    }

    /\*\*  
     \* Generate all UI component definitions for settings dynamically.  
     \* Place this logic in a separate file if it gets too large.  
     \* @private  
     \*/  
    \_generateDefinitions() {  
        return \[  
            {  
                cat: 'Global',  
                type: 'accordion\_header',  
                label: 'Code Basics',  
            },  
            { cat: 'Global', id: 'streamColor', type: 'color', label: 'Code Color' },  
            ...this.\_generateGlobalSettings(),  
            ...this.\_generateAppearanceSettings(),  
            ...this.\_generateBehaviorSettings(),  
            ...this.\_generateFXSettings(),  
            ...this.\_generateSystemTab()  
        \];  
    }

    /\*\*  
     \* Initialize the events, tabs, and UI components.  
     \*/  
    init() {  
        // Toggle button for the settings panel  
        this.dom.toggle.onclick \= () \=\> this.togglePanel();

        // Create and populate tabs and content containers  
        this.\_setupTabs();

        // Initialize File Input Handlers  
        this.\_setupFileHandlers();

        // Handle tab dragging and horizontal scrolling  
        this.\_setupTabScroll();

        // Refresh UI  
        this.refresh('ALL');  
    }

    /\*\*  
     \* Toggles the settings panel visibility.  
     \*/  
    togglePanel() {  
        this.dom.panel.classList.toggle('open');  
    }

    /\*\*  
     \* Sets up the tabs and their corresponding content containers.  
     \* Creates category tabs and assigns content containers to each.  
     \* @private  
     \*/  
    \_setupTabs() {  
        const categories \= \[...new Set(this.defs.map(def \=\> def.cat))\];  
        const tabContentContainers \= {}; // Mapping of category \-\> content container div

        // Create tabs and attach event handlers  
        categories.forEach((category, index) \=\> {  
            const tabButton \= this.\_createTabButton(category, index \=== 0);  
            this.dom.track.appendChild(tabButton);

            // Create corresponding content container for the tab  
            const contentContainer \= this.\_createTabContentContainer(category, index \=== 0);  
            this.dom.content.appendChild(contentContainer);  
            tabContentContainers\[category\] \= contentContainer;  
        });

        // Populate tab content  
        this.\_populateTabContent(tabContentContainers);  
    }

    /\*\*  
     \* Creates a tab button element for a category.  
     \* @private  
     \*/  
    \_createTabButton(category, isActive) {  
        const button \= document.createElement('button');  
        button.className \= \`tab-btn ${isActive ? 'active' : ''}\`;  
        button.textContent \= category;  
        button.onclick \= () \=\> this.\_handleTabClick(category, button);  
        return button;  
    }

    /\*\*  
     \* Handles when a tab is clicked and activates the corresponding tab content.  
     \* @private  
     \*/  
    \_handleTabClick(category, button) {  
        if (this.scrollState.dragDistance \> 3\) return; // Ignore click if it was a drag.

        // Deactivate all tabs and their content  
        this.dom.tabs.querySelectorAll('.tab-btn').forEach(btn \=\> btn.classList.remove('active'));  
        this.dom.content.querySelectorAll('.tab-content-group').forEach(content \=\> content.classList.remove('active'));

        // Activate selected tab and content  
        button.classList.add('active');  
        document.getElementById(\`tab-content-${category}\`).classList.add('active');  
    }

    /\*\*  
     \* Creates a tab content container for a given category.  
     \* @private  
     \*/  
    \_createTabContentContainer(category, isActive) {  
        const container \= document.createElement('div');  
        container.className \= \`tab-content-group ${isActive ? 'active' : ''}\`;  
        container.id \= \`tab-content-${category}\`;  
        return container;  
    }

    /\*\*  
     \* Populate tabs with content, including accordions and controls.  
     \* @private  
     \*/  
    \_populateTabContent(tabContentContainers) {  
        let currentAccordionBody \= null;

        this.defs.forEach(def \=\> {  
            const container \= tabContentContainers\[def.cat\];  
            if (\!container) return;

            if (def.type \=== 'accordion\_header') {  
                currentAccordionBody \= this.\_createAccordion(container, def.label);  
            } else if (currentAccordionBody) {  
                const controlElement \= this.renderControl(def);  
                if (controlElement) currentAccordionBody.appendChild(controlElement);  
            }  
        });  
    }

    /\*\*  
     \* Creates an accordion section with a header and a container for controls.  
     \* @private  
     \*/  
    \_createAccordion(tabContentGroup, label) {  
        const accordionItem \= document.createElement('div');  
        accordionItem.className \= 'accordion-item';

        const header \= document.createElement('div');  
        header.className \= 'accordion-header';  
        header.innerHTML \= \`  
            ${label}  
            \<span class="accordion-icon"\>  
                \<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"\>  
                    \<polyline points="9 18 15 12 9 6"\>\</polyline\>  
                \</svg\>  
            \</span\>  
        \`;

        const body \= document.createElement('div');  
        body.className \= 'accordion-content';

        header.onclick \= () \=\> this.\_toggleAccordion(header, body, tabContentGroup);

        accordionItem.appendChild(header);  
        accordionItem.appendChild(body);  
        tabContentGroup.appendChild(accordionItem);

        return body;  
    }

    /\*\*  
     \* Toggles the visibility of an accordion section and manages sibling accordions.  
     \* @private  
     \*/  
    \_toggleAccordion(header, body, group) {  
        const isOpen \= body.classList.contains('open');

        // Close other accordions in the group  
        group.querySelectorAll('.accordion-content').forEach(siblingBody \=\> {  
            siblingBody.classList.remove('open');  
            siblingBody.previousElementSibling?.classList.remove('active');  
            siblingBody.previousElementSibling?.querySelector('.accordion-icon').classList.remove('rotated');  
        });

        // Toggle the current accordion  
        if (isOpen) {  
            body.classList.remove('open');  
            header.classList.remove('active');  
            header.querySelector('.accordion-icon').classList.remove('rotated');  
        } else {  
            body.classList.add('open');  
            header.classList.add('active');  
            header.querySelector('.accordion-icon').classList.add('rotated');  
        }  
    }

    /\*\*  
     \* Setup input handlers for font and config import.  
     \* @private  
     \*/  
    \_setupFileHandlers() {  
        document.getElementById('importFile').onchange \= e \=\> this.\_handleConfigImport(e);  
        document.getElementById('importFontFile').onchange \= e \=\> this.\_handleFontImport(e);  
    }

    \_handleConfigImport(event) {  
        const file \= event.target.files\[0\];  
        if (\!file) return;

        const reader \= new FileReader();  
        reader.onload \= ev \=\> {  
            try {  
                const data \= JSON.parse(ev.target.result);  
                this.c.state \= { ...this.c.defaults, ...data.state };  
                this.c.updateDerivedValues();  
                this.c.save();  
                this.c.notify('ALL');  
                this.notifications.show('Configuration Loaded', 'success');  
            } catch (error) {  
                this.notifications.show('Invalid Configuration File', 'error');  
            }  
            event.target.value \= ''; // Reset input value  
        };  
        reader.readAsText(file);  
    }

    \_handleFontImport(event) {  
        const file \= event.target.files\[0\];  
        if (file) this.fonts.importFont(file);  
        event.target.value \= ''; // Reset input value  
    }

    /\*\*  
     \* Set up drag and scroll functionality for tabs.  
     \* @private  
     \*/  
    \_setupTabScroll() {  
        const tabs \= this.dom.tabs;  
        tabs.addEventListener('mousedown', e \=\> this.\_startDrag(e));  
        tabs.addEventListener('mouseleave', () \=\> this.\_stopDrag());  
        tabs.addEventListener('mouseup', () \=\> this.\_stopDrag());  
        tabs.addEventListener('mousemove', e \=\> this.\_doDrag(e));

        tabs.addEventListener('wheel', e \=\> {  
            if (Math.abs(e.deltaX) \>= Math.abs(e.deltaY)) return;

            e.preventDefault(); // Prevent vertical scrolling/browser behavior  
            tabs.scrollLeft \+= e.deltaY;  
        }, { passive: false });  
    }

    \_startDrag(e) {  
        if (e.button \!== 0\) return; // Only respond to primary click (left mouse button)  
        this.scrollState.isDown \= true;  
        this.scrollState.startX \= e.pageX \- this.dom.tabs.offsetLeft;  
        this.scrollState.scrollLeft \= this.dom.tabs.scrollLeft;  
        this.scrollState.dragDistance \= 0;  
        this.dom.tabs.style.cursor \= 'grabbing';  
    }

    \_stopDrag() {  
        this.scrollState.isDown \= false;  
        this.dom.tabs.style.cursor \= 'grab';  
    }

    \_doDrag(e) {  
        if (\!this.scrollState.isDown) return;

        e.preventDefault(); // Prevent text highlighting during drag  
        const x \= e.pageX \- this.dom.tabs.offsetLeft;  
        const walk \= (x \- this.scrollState.startX) \* 1.5;  
        this.dom.tabs.scrollLeft \= this.scrollState.scrollLeft \- walk;  
        this.scrollState.dragDistance \+= Math.abs(walk);  
    }

    /\*\*  
     \* Dynamically render a UI control.  
     \* This is a simplified version of your existing render logic.  
     \*/  
    renderControl(def) {  
        // IMPLEMENT SAME LOGIC AS BEFORE BUT BREAK DOWN COMPLEX LOGIC INTO MODULAR METHODS, if needed  
        // For example, checkbox rendering, accordion headers, sliders, etc., should be split into  
        // methods like \`\_renderCheckbox\`, \`\_renderRange\`, \`\_renderSelect\`, etc.  
    }

    // Other existing methods: \`refresh\`, \`showTooltip\`, \`hideTooltip\`, \`handleAction\`, etc.  
}

# SimulationSystem

class SimulationSystem {  
    constructor(grid, config) {  
        this.grid \= grid;  
        this.config \= config;  
        this.activeStreams \= \[\];  
        this.lastStreamInColumn \= new Array(grid.cols).fill(null);  
        this.modes \= this.\_initializeModes(config);  
    }

    \_initializeModes(config) {  
        return {  
            'STANDARD': new StandardMode(config),  
            'STAR\_POWER': new StarPowerMode(config),  
            'RAINBOW': new RainbowMode(config)  
        };  
    }

    update(frame) {  
        if (this.lastStreamInColumn.length \!== this.grid.cols) {  
            this.\_resetColumns();  
        }  
        this.\_manageStreams(frame);  
        this.\_updateCells(frame);  
    }

    \_resetColumns() {  
        this.lastStreamInColumn \= new Array(this.grid.cols).fill(null);  
        this.activeStreams \= \[\];  
    }

    \_manageStreams(frame) {  
        const { state: s, derived: d } \= this.config;  
        const period \= Math.max(1, Math.floor(d.cycleDuration \* s.releaseInterval));

        if (frame % period \=== 0\) {  
            this.\_spawnStreams(s, d);  
        }

        if (frame % d.cycleDuration \=== 0\) {  
            this.\_processActiveStreams(frame);  
        }  
    }

    \_spawnStreams(s, d) {  
        const columns \= this.\_shuffleArray(\[...Array(this.grid.cols).keys()\]);  
        let streamCount \= s.streamSpawnCount;  
        let eraserCount \= s.eraserSpawnCount;

        for (const col of columns) {  
            if (streamCount \<= 0 && eraserCount \<= 0\) break;

            const hasContent \= this.\_columnHasContent(col, Math.min(this.grid.rows, 40));  
            const lastStream \= this.lastStreamInColumn\[col\];

            if (hasContent && eraserCount \> 0 && this.\_canSpawn(lastStream, s.minEraserGap)) {  
                this.\_spawnStreamAt(col, true);  
                eraserCount--;  
            } else if (\!hasContent && streamCount \> 0 && this.\_canSpawn(lastStream, s.minStreamGap)) {  
                this.\_spawnStreamAt(col, false);  
                streamCount--;  
            }  
        }  
    }

    \_shuffleArray(array) {  
        for (let i \= array.length \- 1; i \> 0; i--) {  
            const j \= Math.floor(Math.random() \* (i \+ 1));  
            \[array\[i\], array\[j\]\] \= \[array\[j\], array\[i\]\];  
        }  
        return array;  
    }

    \_columnHasContent(col, maxRows) {  
        for (let y \= 0; y \< maxRows; y++) {  
            if (this.grid.decays\[this.grid.getIndex(col, y)\] \> 0\) return true;  
        }  
        return false;  
    }

    \_canSpawn(lastStream, minGap) {  
        return \!lastStream || \!lastStream.active || lastStream.y \> minGap;  
    }

    \_processActiveStreams(frame) {  
        for (let i \= this.activeStreams.length \- 1; i \>= 0; i--) {  
            const stream \= this.activeStreams\[i\];  
            if (\!stream.active) {  
                this.activeStreams.splice(i, 1);  
                continue;  
            }  
            if (stream.delay \> 0\) {  
                stream.delay--;  
                continue;  
            }

            stream.age++;

            if (stream.age \>= stream.visibleLen) {  
                this.\_handleStreamCompletion(stream);  
                continue;  
            }

            if (stream.y \< stream.len) {  
                stream.y++;  
                this.\_writeHead(stream, frame);  
            }  
        }  
    }

    \_handleStreamCompletion(stream) {  
        stream.active \= false;  
        if (\!stream.isEraser) {  
            this.\_spawnStreamAt(stream.x, true);  
        }  
    }

    \_spawnStreamAt(x, forceEraser) {  
        const s \= this.config.state;  
        const stream \= this.\_initializeStream(x, forceEraser, s);

        this.modes\[stream.mode\].spawn(stream);  
        this.activeStreams.push(stream);  
        this.lastStreamInColumn\[x\] \= stream;  
    }

    \_initializeStream(x, forceEraser, s) {  
        const baseStream \= {  
            x,  
            y: \-1,  
            active: true,  
            delay: 0,  
            age: 0,  
            len: 0,  
            holes: new Set(),  
            decayY: \-1,  
            decayStarted: false,  
            visibleLen: 0,  
            mode: 'STANDARD',  
            baseHue: 0,  
            isInverted: false,  
            isEraser: forceEraser  
        };

        if (forceEraser) {  
            return this.\_initializeEraserStream(baseStream, s);  
        } else {  
            return this.\_initializeTracerStream(baseStream, s);  
        }  
    }

    \_initializeEraserStream(stream, s) {  
        stream.len \= this.grid.rows \+ 5;  
        stream.visibleLen \= Math.max(Math.floor(Utils.randomFloat(s.ttlMinSeconds, s.ttlMaxSeconds) \* 60), this.grid.rows \+ 20);  
        return stream;  
    }

    \_initializeTracerStream(stream, s) {  
        const lifeFrames \= Math.max(Math.floor(Utils.randomFloat(s.ttlMinSeconds, s.ttlMaxSeconds) \* 60), 60);

        stream.len \= Utils.randomInt(4, this.grid.rows \* 3);  
        stream.visibleLen \= lifeFrames;  
        stream.isInverted \= s.invertedTracerEnabled && Math.random() \< s.invertedTracerChance;

        for (let i \= 0; i \< stream.len; i++) {  
            if (Math.random() \< s.holeRate) stream.holes.add(i);  
        }  
        stream.holes.delete(0);

        if (s.starPowerEnabled && Math.random() \< s.starPowerFreq / 100\) {  
            stream.mode \= 'STAR\_POWER';  
        } else if (s.rainbowStreamEnabled && Math.random() \< s.rainbowStreamChance) {  
            stream.mode \= 'RAINBOW';  
        }

        return stream;  
    }

    \_writeHead(stream, frame) {  
        const idx \= this.grid.getIndex(stream.x, stream.y);  
        if (idx \=== \-1) return;

        if (stream.isEraser) {  
            this.\_handleEraserHead(idx);  
        } else {  
            this.\_handleTracerHead(stream, idx, frame);  
        }  
    }

    \_handleEraserHead(idx) {  
        if (this.grid.decays\[idx\] \> 0 && this.grid.types\[idx\] \!== CELL\_TYPE.EMPTY) {  
            this.grid.ages\[idx\] \= 0;  
            this.grid.decays\[idx\] \= 2;  
        } else {  
            this.\_clearCell(idx);  
        }  
    }

    \_handleTracerHead(stream, idx, frame) {  
        const shouldWrite \= stream.isInverted  
            ? stream.holes.has(stream.y)  
            : \!stream.holes.has(stream.y);

        if (shouldWrite) {  
            const { state: s, derived: d } \= this.config;  
            const cellType \= s.rotatorEnabled && Math.random() \< s.rotatorChance  
                ? CELL\_TYPE.ROTATOR  
                : CELL\_TYPE.TRACER;

            this.grid.types\[idx\] \= cellType;  
            this.grid.ages\[idx\] \= 1;  
            this.grid.decays\[idx\] \= 1;  
            this.grid.rotatorProg\[idx\] \= 0;  
            this.grid.activeIndices.add(idx);

            this.grid.setChar(idx, Utils.getRandomChar());  
            this.grid.brightness\[idx\] \= s.variableBrightnessEnabled  
                ? Utils.randomFloat(d.varianceMin, 1.0)  
                : 1.0;

            this.grid.alphas\[idx\] \= this.grid.brightness\[idx\];  
            const style \= this.modes\[stream.mode\].style(stream, frame, s);  
            if (style) {  
                this.grid.complexStyles.set(idx, style);  
            } else {  
                this.grid.complexStyles.delete(idx);  
            }  
        } else {  
            this.\_clearCell(idx);  
        }  
    }

    \_clearCell(idx) {  
        this.grid.types\[idx\] \= CELL\_TYPE.EMPTY;  
        this.grid.ages\[idx\] \= 0;  
        this.grid.decays\[idx\] \= 0;  
        this.grid.alphas\[idx\] \= 0;

        this.grid.complexStyles.delete(idx);  
        this.grid.nextChars.delete(idx);  
        this.grid.activeIndices.delete(idx); // Improves performance  
    }

    \_updateCells(frame) {  
        const { state: s, derived: d } \= this.config;

        for (const idx of this.grid.activeIndices) {  
            this.\_updateCell(idx, frame, s, d);  
        }  
    }

    \_updateCell(idx, frame, s, d) {  
        const decay \= this.grid.decays\[idx\];  
        if (decay \=== 0\) return;

        let age \= this.grid.ages\[idx\];  
        if (age \> 0\) {  
            age \= this.\_incrementAge(age, d.maxState);  
            this.grid.ages\[idx\] \= age;  
        }

        if (s.rotatorEnabled && this.grid.types\[idx\] \=== CELL\_TYPE.ROTATOR) {  
            this.\_handleRotator(idx, frame, s, d);  
        }

        if (decay \>= 2 && this.\_shouldDecay(idx, decay, s.decayFadeDurationFrames)) {  
            this.\_clearCell(idx);  
        } else {  
            this.grid.alphas\[idx\] \= this.\_calculateAlpha(idx, age, decay, s.decayFadeDurationFrames);  
        }  
    }

    \_incrementAge(age, maxState) {  
        return age \< maxState ? age \+ 1 : 0;  
    }

    \_handleRotator(idx, frame, s, d) {  
        const prog \= this.grid.rotatorProg\[idx\];

        if (prog \> 0\) {  
            this.\_progressRotator(idx, prog, s.rotatorCrossfadeFrames);  
        } else if (this.grid.decays\[idx\] \=== 1\) {  
            this.\_cycleRotator(idx, frame, s.rotatorCrossfadeFrames, d.rotatorCycleFrames);  
        }  
    }

    \_progressRotator(idx, prog, crossfadeFrames) {  
        this.grid.rotatorProg\[idx\] \= prog \+ 1;  
        if (prog \> crossfadeFrames) {  
            const nextChar \= this.grid.nextChars.get(idx);  
            if (nextChar) {  
                this.grid.setChar(idx, nextChar);  
            }  
            this.grid.rotatorProg\[idx\] \= 0;  
        }  
    }

    \_cycleRotator(idx, frame, crossfadeFrames, cycleFrames) {  
        if (frame % cycleFrames \=== 0\) {  
            if (crossfadeFrames \<= 2\) {  
                this.grid.setChar(idx, Utils.getUniqueChar(this.grid.getChar(idx)));  
            } else {  
                this.grid.rotatorProg\[idx\] \= 1;  
                this.grid.nextChars.set(idx, Utils.getUniqueChar(this.grid.getChar(idx)));  
            }  
        }  
    }

    \_shouldDecay(idx, decay, fadeDurationFrames) {  
        return decay \> fadeDurationFrames \+ 2;  
    }

    \_calculateAlpha(idx, age, decay, fadeDurationFrames) {  
        if (age \> 0\) {  
            return 1.0;  
        } else if (decay \=== 1\) {  
            return 0.95 \* this.grid.brightness\[idx\];  
        } else if (decay \>= 2\) {  
            const ratio \= (decay \- 2\) / fadeDurationFrames;  
            return 0.95 \* (1 \- ratio) \* this.grid.brightness\[idx\];  
        }  
        return 0;  
    }  
}

# StreamMode

class StreamMode {  
    constructor(config) {  
        this.config \= config;  
    }

    spawn(stream) {  
        // Default implementation for spawning a stream  
    }

    style(stream, frame, state) {  
        // Default implementation for style (no special effects)  
        return null;  
    }  
}

class StandardMode extends StreamMode {  
    // Inherits default behavior with no specific changes  
}

class StarPowerMode extends StreamMode {  
    spawn(stream) {  
        stream.baseHue \= Utils.randomInt(0, 360);  
    }

    style(stream, frame, state) {  
        const hue \= (state.starPowerRainbowMode \=== 'char')  
            ? (frame \+ (stream.x \* 10)) % 360 // Character-based hue  
            : stream.baseHue; // Fixed hue based on baseHue  
        return this.\_createStyle(hue, state.starPowerSaturation, state.starPowerIntensity, state.starPowerColorCycle, state.starPowerCycleSpeed, state.starPowerGlitter);  
    }

    \_createStyle(hue, saturation, lightness, cycle, speed, glitter) {  
        return { h: hue, s: saturation, l: lightness, cycle, speed, glitter };  
    }  
}

class RainbowMode extends StreamMode {  
    spawn(stream) {  
        stream.baseHue \= Utils.randomInt(0, 360);  
    }

    style(stream, frame, state) {  
        return this.\_createStyle(stream.baseHue, 100, state.rainbowStreamIntensity);  
    }

    \_createStyle(hue, saturation, lightness) {  
        return { h: hue, s: saturation, l: lightness, cycle: false, speed: 0, glitter: false };  
    }  
}

# Utils

const APP\_VERSION \= "7.3";

// \=========================================================================  
// 1\. CORE UTILITIES / CONSTANTS  
// \=========================================================================  
const Utils \= {  
    // Generates a random integer between min (inclusive) and max (inclusive)  
    randomInt: (min, max) \=\> min \+ Math.floor(Math.random() \* (max \- min \+ 1)),

    // Generates a random floating-point number between min (inclusive) and max (exclusive)  
    randomFloat: (min, max) \=\> min \+ Math.random() \* (max \- min),

    // Converts a 6-character hex color code (e.g., "\#RRGGBB") to an { r, g, b } object format  
    hexToRgb: (hex) \=\> {  
        if (typeof hex \!== "string" || \!/^\#?(\[A-Fa-f0-9\]{6})$/.test(hex)) {  
            // Default to a valid fallback RGB value  
            return { r: 0, g: 255, b: 0 }; // Default green  
        }  
        const value \= parseInt(hex.replace(/^\#/, ''), 16);  
        return {  
            r: (value \>\> 16\) & 0xFF,  
            g: (value \>\> 8\) & 0xFF,  
            b: value & 0xFF  
        };  
    },

    // Packs 3 RGB components (r, g, b) into a single 24-bit integer  
    packRgb: (r, g, b) \=\> ((r & 0xFF) \<\< 16\) | ((g & 0xFF) \<\< 8\) | (b & 0xFF),

    // Unpacks a 24-bit integer into RGB components {r, g, b}  
    unpackRgb: (intVal) \=\> ({  
        r: (intVal \>\> 16\) & 0xFF,  
        g: (intVal \>\> 8\) & 0xFF,  
        b: intVal & 0xFF  
    }),

    // Converts HSL (hue, saturation, lightness) to RGB { r, g, b }  
    hslToRgb: (h, s, l) \=\> {  
        s /= 100;  
        l /= 100;

        const chroma \= (1 \- Math.abs(2 \* l \- 1)) \* s;  
        const x \= chroma \* (1 \- Math.abs((h / 60\) % 2 \- 1));  
        const m \= l \- chroma / 2;

        let rgb \= \[0, 0, 0\];  
        if (h \>= 0 && h \< 60\) rgb \= \[chroma, x, 0\];  
        else if (h \>= 60 && h \< 120\) rgb \= \[x, chroma, 0\];  
        else if (h \>= 120 && h \< 180\) rgb \= \[0, chroma, x\];  
        else if (h \>= 180 && h \< 240\) rgb \= \[0, x, chroma\];  
        else if (h \>= 240 && h \< 300\) rgb \= \[x, 0, chroma\];  
        else if (h \>= 300 && h \< 360\) rgb \= \[chroma, 0, x\];

        return {  
            r: Math.round((rgb\[0\] \+ m) \* 255),  
            g: Math.round((rgb\[1\] \+ m) \* 255),  
            b: Math.round((rgb\[2\] \+ m) \* 255\)  
        };  
    },

    // List of available characters for random selection  
    CHARS: '012345789Z:\<=\>"\*+-.\_\!|⽇゠ウエオカキクコサシスセソツテナニヌネハヒフホマミムメモヤラリワヲンワヲン',

    // Returns a random character from the predefined CHARS list  
    getRandomChar: () \=\> {  
        const index \= Utils.randomInt(0, Utils.CHARS.length \- 1);  
        return Utils.CHARS\[index\];  
    },

    // Returns a random character from the CHARS list, excluding the provided character  
    getUniqueChar: (exclude) \=\> {  
        if (Utils.CHARS.length \<= 1\) return null;  
        let char;  
        do {  
            char \= Utils.getRandomChar();  
        } while (char \=== exclude);  
        return char;  
    },

    // Downloads a JSON object as a file with the given filename  
    downloadJson: (data, filename \= "file.json") \=\> {  
        const blob \= new Blob(\[JSON.stringify(data, null, 2)\], { type: "application/json" });  
        const url \= URL.createObjectURL(blob);

        const link \= document.createElement("a");  
        link.href \= url;  
        link.download \= filename;

        document.body.appendChild(link);  
        link.click();

        // Clean up  
        document.body.removeChild(link);  
        URL.revokeObjectURL(url);  
    }  
};

// Predefined cell types for use in the grid  
const CELL\_TYPE \= {  
    EMPTY: 0,  
    TRAIL: 1,  
    TRACER: 2,  
    ROTATOR: 3  
};

# MatrixKernel

class MatrixKernel {  
    constructor() {  
        // Initialize core components  
        this.\_initializeManagers();  
        this.\_initializeEffects();  
        this.\_initializeRendererAndUI();  
          
        // Frame handling and rendering variables  
        this.frame \= 0;  
        this.lastTime \= 0;  
        this.accumulator \= 0;  
        this.timestep \= 1000 / 60;

        // Window resize handling  
        this.\_setupResizeListener();

        // Configuration subscription for dynamic updates  
        this.\_setupConfigSubscriptions();

        // Perform the initial resize setup and start the loop  
        this.\_resize();  
        requestAnimationFrame((time) \=\> this.\_loop(time));  
    }

    // Initialize managers and core components  
    \_initializeManagers() {  
        this.notifications \= new NotificationManager();  
        this.config \= new ConfigurationManager();  
        this.grid \= new MatrixGrid(this.config);  
        this.simulation \= new SimulationSystem(this.grid, this.config);  
        this.effectRegistry \= new EffectRegistry(this.grid, this.config);  
    }

    // Register effects in the EffectRegistry  
    \_initializeEffects() {  
        const effects \= \[  
            PulseEffect,  
            ClearPulseEffect,  
            MiniPulseEffect,  
            DejaVuEffect,  
            SupermanEffect,  
            FirewallEffect  
        \];  
        effects.forEach((EffectClass) \=\> this.effectRegistry.register(new EffectClass(this.grid, this.config)));  
    }

    // Initialize Renderer, FontManager, and UIManager  
    \_initializeRendererAndUI() {  
        this.renderer \= new CanvasRenderer('matrixCanvas', this.grid, this.config, this.effectRegistry);  
        this.fontMgr \= new FontManager(this.config, this.notifications);  
        this.ui \= new UIManager(this.config, this.effectRegistry, this.fontMgr, this.notifications);

        // Initialize font manager  
        this.fontMgr.init();  
    }

    // Setup window resize handling  
    \_setupResizeListener() {  
        let resizeTimer;  
        window.addEventListener('resize', () \=\> {  
            clearTimeout(resizeTimer);  
            resizeTimer \= setTimeout(() \=\> this.\_resize(), 100); // Debounce resize events  
        });  
    }

    // Handle configuration changes  
    \_setupConfigSubscriptions() {  
        const resizeTriggers \= \[  
            'resolution',  
            'stretchX',  
            'stretchY',  
            'fontSize',  
            'horizontalSpacingFactor'  
        \];

        this.config.subscribe((key) \=\> {  
            // Resize the canvas and grid on resolution-related changes  
            if (resizeTriggers.includes(key) || key \=== 'ALL') {  
                this.\_resize();  
            }

            // Update renderer when smoothing settings change  
            if (\['smoothingEnabled', 'smoothingAmount'\].includes(key)) {  
                this.renderer.updateSmoothing();  
            }  
        });  
    }

    // Resize the grid and renderer dimensions  
    \_resize() {  
        this.renderer.resize();  
        this.grid.resize(  
            window.innerWidth / this.config.state.stretchX,  
            window.innerHeight / this.config.state.stretchY  
        );  
    }

    // The main update loop for the simulation  
    \_loop(time) {  
        if (\!this.lastTime) this.lastTime \= time;  
        const delta \= time \- this.lastTime;  
        this.lastTime \= time;

        this.accumulator \+= delta;  
        while (this.accumulator \>= this.timestep) {  
            this.\_updateFrame();  
            this.accumulator \-= this.timestep;  
        }

        this.renderer.render(this.frame);  
        requestAnimationFrame((nextTime) \=\> this.\_loop(nextTime));  
    }

    // Updates logic for each frame  
    \_updateFrame() {  
        this.frame++;  
        this.effectRegistry.update();  
        this.simulation.update(this.frame);  
    }  
}

// Initialize the MatrixKernel on DOMContentLoaded  
window.addEventListener('DOMContentLoaded', () \=\> new MatrixKernel());

# MatrixGrid

class MatrixGrid {  
    constructor(config) {  
        this.config \= config;

        // Grid dimensions  
        this.cols \= 0;  
        this.rows \= 0;

        // Grid storage and state tracking  
        this.activeIndices \= new Set(); // Tracks active (non-empty) cells  
        this.chars \= null;  
        this.types \= null;  
        this.alphas \= null;  
        this.decays \= null;  
        this.ages \= null;  
        this.brightness \= null;  
        this.rotatorProg \= null;

        // Auxiliary storage  
        this.complexStyles \= new Map(); // Tracks complex character styling  
        this.nextChars \= new Map(); // Tracks characters for transitions  
    }

    // Resize the grid based on new width and height  
    resize(width, height) {  
        const d \= this.config.derived;  
        const newCols \= Math.max(1, Math.floor(width / d.cellWidth));  
        const newRows \= Math.max(1, Math.floor(height / d.cellHeight));

        if (newCols \!== this.cols || newRows \!== this.rows) {  
            this.\_resizeGrid(newCols, newRows);  
        }  
    }

    // Get 1D array index from 2D coordinates (x, y)  
    getIndex(x, y) {  
        if (x \< 0 || x \>= this.cols || y \< 0 || y \>= this.rows) {  
            return \-1; // Out of bounds  
        }  
        return y \* this.cols \+ x;  
    }

    // Set a character at the specified index  
    setChar(idx, charStr) {  
        if (typeof charStr \=== "string" && charStr.length \> 0\) {  
            this.chars\[idx\] \= charStr.charCodeAt(0);  
        }  
    }

    // Get a character from the specified index  
    getChar(idx) {  
        return String.fromCharCode(this.chars\[idx\]);  
    }

    // \====================  
    // Private Methods  
    // \====================

    \_resizeGrid(newCols, newRows) {  
        const totalCells \= newCols \* newRows;

        // Reinitialize arrays with new size  
        this.chars \= new Uint16Array(totalCells);  
        this.types \= new Uint8Array(totalCells);  
        this.alphas \= new Float32Array(totalCells);  
        this.decays \= new Uint8Array(totalCells);  
        this.ages \= new Int32Array(totalCells);  
        this.brightness \= new Float32Array(totalCells);  
        this.rotatorProg \= new Uint8Array(totalCells);

        // Clear auxiliary storage  
        this.complexStyles.clear();  
        this.nextChars.clear();  
        this.activeIndices.clear();

        // Update grid dimensions  
        this.cols \= newCols;  
        this.rows \= newRows;  
    }  
}

# ConfigurationManager

class ConfigurationManager {  
    constructor() {  
        this.storageKey \= 'matrix\_config\_v7.3';  
        this.slotsKey \= 'matrix\_slots\_v7.3';  
        this.defaults \= this.\_initializeDefaults();

        this.state \= { ...this.defaults };  
        this.derived \= {};  
        this.slots \= this.\_loadSlots();  
        this.subscribers \= \[\];

        this.\_loadState();  
        this.updateDerivedValues();  
    }

    // \====================  
    // Initialization Helpers  
    // \====================

    \_initializeDefaults() {  
        return {  
            // \--- GLOBAL \---  
            streamColor: "\#65d778",  
            streamSpeed: 15,  
            clearAlpha: 0.9,  
            enableBloom: true,  
            bloomStrength: 2,  
            bloomOpacity: 0.45,  
            resolution: 1,  
            smoothingEnabled: true,  
            smoothingAmount: 0.4,  
            stretchX: 1,  
            stretchY: 1.1,

            // \--- STREAMS \---  
            streamSpawnCount: 4,  
            eraserSpawnCount: 4,  
            releaseInterval: 4,  
            minStreamGap: 15,  
            minEraserGap: 15,  
            holeRate: 0.15,  
            ttlMinSeconds: 2,  
            ttlMaxSeconds: 5.5,  
            decayFadeDurationFrames: 24,  
            dissolveEnabled: true,  
            dissolveMinSize: 19,  
            deteriorationEnabled: true,  
            deteriorationType: 'ghost',  
            deteriorationStrength: 2,  
            invertedTracerEnabled: true,  
            invertedTracerChance: 0.1,

            // \--- FONT & GLYPHS \---  
            fontFamily: 'MatrixEmbedded',  
            fontSize: 19,  
            fontWeight: 'normal',  
            italicEnabled: false,  
            mirrorEnabled: false,  
            fontOffsetY: 0,  
            fontOffsetX: 0,  
            horizontalSpacingFactor: 0.7,  
            verticalSpacingFactor: 0.95,  
            variableBrightnessEnabled: true,  
            brightnessVariance: 20,

            // \--- MUTATORS (TRACERS) \---  
            tracerColor: "\#d9f2f2",  
            tracerSizeIncrease: 1,  
            tracerGlow: 15,  
            tracerAttackFrames: 8,  
            tracerHoldFrames: 0,  
            tracerReleaseFrames: 6,

            // \--- MUTATORS (ROTATORS) \---  
            rotatorEnabled: true,  
            rotatorChance: 0.13,  
            rotatorSyncToTracer: true,  
            rotatorSyncMultiplier: 0.5,  
            rotatorCycleFactor: 11,  
            rotatorCrossfadeFrames: 6,

            // \--- GLYPH FX \---  
            starPowerEnabled: false,  
            starPowerFreq: 100,  
            starPowerRainbowMode: 'char',  
            starPowerColorCycle: false,  
            starPowerCycleSpeed: 14,  
            starPowerSaturation: 100,  
            starPowerIntensity: 51,  
            starPowerGlitter: false,

            rainbowStreamEnabled: false,  
            rainbowStreamChance: 1,  
            rainbowStreamIntensity: 50,

            // \--- GLYPH FX (FIREWALL ANOMALY) \---  
            firewallEnabled: true,  
            firewallFrequencySeconds: 150,  
            firewallReverseDurationFrames: 10,  
            firewallEraseDurationFrames: 25,

            // \--- EVENTS (PULSES) \---  
            pulseEnabled: true,  
            pulseFrequencySeconds: 220,  
            pulseDelayFrames: 60,  
            pulseDurationSeconds: 1.8,  
            pulsePreserveSpaces: true,  
            pulseRandomPosition: true,  
            pulseWidth: 130,  
            pulseDimming: 0.2,  
            pulseIgnoreTracers: true,  
            pulseCircular: false,  
            pulseBlend: false,  
            pulseInstantStart: false,

            clearPulseEnabled: true,  
            clearPulseFrequencySeconds: 195,  
            clearPulseDurationSeconds: 1,  
            clearPulsePreserveSpaces: true,  
            clearPulseRandomPosition: true,  
            clearPulseWidth: 150,  
            clearPulseIgnoreTracers: true,  
            clearPulseCircular: true,  
            clearPulseBlend: true,  
            clearPulseInstantStart: false,

            miniPulseEnabled: true,  
            miniPulseFrequencySeconds: 450,  
            miniPulseDurationSeconds: 5,  
            miniPulseSpawnChance: 0.06,  
            miniPulseSize: 140,  
            miniPulseThickness: 92,  
            miniPulseSpeed: 14,  
            miniPulsePreserveSpaces: true,

            dejaVuEnabled: true,  
            dejaVuAutoMode: true,  
            dejaVuFrequencySeconds: 300,  
            dejaVuDurationSeconds: 5,  
            dejaVuBarDurationFrames: 30,  
            dejaVuVarianceFrames: 60,  
            dejaVuIntensity: 0.06,  
            dejaVuHoleBrightness: 0.02,  
            dejaVuMinRectHeight: 1,  
            dejaVuMaxRectHeight: 10,  
            dejaVuRandomizeColors: false,

            supermanEnabled: true,  
            supermanDurationSeconds: 6,  
            supermanFlickerRate: 2,  
            supermanWidth: 2,  
            supermanSpawnSpeed: 75,  
            supermanFadeSpeed: 6,  
            supermanIncludeColors: true,  
            supermanGlow: 4,  
            supermanBoltThickness: 5,  
            supermanProb: 4  
        };  
    }

    \_loadSlots() {  
        try {  
            const storedSlots \= localStorage.getItem(this.slotsKey);  
            if (storedSlots) {  
                return JSON.parse(storedSlots);  
            }  
        } catch (e) {  
            console.warn('Failed to load slots:', e);  
        }

        // Default slots if not found or error occurs  
        return Array(3).fill(null).map((\_, i) \=\> ({ name: \`Save Slot ${i \+ 1}\`, data: null }));  
    }

    saveSlots() {  
        try {  
            localStorage.setItem(this.slotsKey, JSON.stringify(this.slots));  
        } catch (e) {  
            console.warn('Failed to save slots:', e);  
        }  
    }

    \_loadState() {  
        try {  
            const storedState \= localStorage.getItem(this.storageKey);  
            if (storedState) {  
                const parsed \= JSON.parse(storedState);  
                delete parsed.customFonts; // Remove unsupported keys if present  
                this.state \= { ...this.defaults, ...parsed };  
            }  
        } catch (e) {  
            console.warn('Failed to load configuration:', e);  
        }  
    }

    save() {  
        try {  
            localStorage.setItem(this.storageKey, JSON.stringify(this.state));  
        } catch (e) {  
            console.warn('Failed to save configuration:', e);  
        }  
    }

    get(key) {  
        return this.state\[key\];  
    }

    set(key, value) {  
        if (this.state\[key\] \=== value) return; // Skip if no change in value

        this.state\[key\] \= value;

        // Maintain consistency between related properties  
        if (key \=== 'streamMinLength') {  
            this.state.streamMaxLength \= Math.max(this.state.streamMaxLength, value);  
        } else if (key \=== 'streamMaxLength') {  
            this.state.streamMinLength \= Math.min(this.state.streamMinLength, value);  
        }

        this.updateDerivedValues();  
        this.save();  
        this.notify(key);  
    }

    reset() {  
        this.state \= { ...this.defaults };  
        this.updateDerivedValues();  
        this.save();  
        this.notify('ALL');  
    }

    saveToSlot(index) {  
        if (this.slots\[index\]) {  
            this.slots\[index\] \= {  
                name: this.slots\[index\].name,  
                data: JSON.parse(JSON.stringify(this.state))  
            };  
            this.saveSlots();  
        }  
    }

    loadFromSlot(index) {  
        if (\!this.slots\[index\]?.data) return false;

        this.state \= { ...this.defaults, ...this.slots\[index\].data };  
        this.updateDerivedValues();  
        this.save();  
        this.notify('ALL');  
        return true;  
    }

    renameSlot(index, name) {  
        if (this.slots\[index\]) {  
            this.slots\[index\].name \= name;  
            this.saveSlots();  
        }  
    }

    subscribe(callback) {  
        if (typeof callback \=== "function") {  
            this.subscribers.push(callback);  
        }  
    }

    notify(key) {  
        this.subscribers.forEach((callback) \=\> callback(key, this.state));  
    }

    updateDerivedValues() {  
        const s \= this.state;  
        const cycleDuration \= 21 \- s.streamSpeed;  
        const hFactor \= Math.max(0.5, s.horizontalSpacingFactor);  
        const vFactor \= Math.max(0.5, s.verticalSpacingFactor);  
        const rotatorCycleFrames \= s.rotatorSyncToTracer  
            ? Math.max(1, Math.floor(cycleDuration / s.rotatorSyncMultiplier))  
            : Math.max(10, Math.round(60 \- s.rotatorCycleFactor \* 2.5));

        const createRGBString \= (color) \=\> {  
            const rgb \= Utils.hexToRgb(color);  
            return \`rgb(${rgb.r},${rgb.g},${rgb.b})\`;  
        };

        this.derived \= {  
            cycleDuration,  
            safeAttack: Math.min(Math.max(1, s.tracerAttackFrames), cycleDuration),  
            safeRelease: Math.min(s.tracerReleaseFrames, cycleDuration),  
            holdFrames: Math.max(0, s.tracerHoldFrames),  
            maxState: cycleDuration \+ Math.max(0, s.tracerHoldFrames) \+ cycleDuration,  
            rotatorCycleFrames,  
            cellWidth: s.fontSize \* hFactor,  
            cellHeight: s.fontSize \* vFactor,  
            varianceMin: 1.0 \- s.brightnessVariance / 100,  
            streamRgb: Utils.hexToRgb(s.streamColor),  
            tracerRgb: Utils.hexToRgb(s.tracerColor),  
            streamColorStr: createRGBString(s.streamColor),  
            tracerColorStr: createRGBString(s.tracerColor),  
            fontBaseStr: \`${s.italicEnabled ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}\`  
        };  
    }  
} 
