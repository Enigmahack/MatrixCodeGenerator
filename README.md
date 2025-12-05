Check out the live demo here: 
https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v7.3.html
#
💻 Matrix Digital Rain Simulation v7.3
The quest for the "perfect" rain continues. v7.3 represents a massive leap forward in typographical control and visual fidelity. Going beyond hardcoded fonts and standard fading to a fully customizable engine that allows you to inject your own glyphs and simulate the analog signal decay seen in the original film.

<img width="3838" height="1955" alt="image" src="https://github.com/user-attachments/assets/da2a1739-49e8-404b-a4c5-d9d8bb3c9bf4" />
<img width="3834" height="1957" alt="image" src="https://github.com/user-attachments/assets/7a759436-d8b7-41d4-923a-9ff1a8e05aa6" />
<img width="3838" height="1955" alt="image" src="https://github.com/user-attachments/assets/71adcfee-d368-4ebc-ad31-5b0bb58c75a5" />
<img width="3836" height="1954" alt="image" src="https://github.com/user-attachments/assets/783e8762-a27d-4812-8007-491cce461b3f" />

#
🚀 What's New in v7.3
This release focuses on deeper customization, advanced visual effects, and a refined user experience. We've overhauled core systems for better performance and introduced powerful new ways to control the digital rain.

**Core System Overhauls & Performance:**
*   **Modular Architecture**: Major refactoring of the simulation engine into a more modular `MatrixKernel` with dedicated systems for Grid, Simulation, Effects, and Rendering, enhancing maintainability and future expansion.
*   **Optimized Grid**: The underlying grid structure has been re-engineered using TypedArrays for significant performance improvements, especially in large simulations.

**Enhanced Visuals & Effects:**
*   **Advanced Pulse Effects (Pulse & Clear Pulse)**: Both the standard `Pulse` and new `Clear Pulse` effects now offer:
    *   **Aspect Ratio Awareness**: Pulses initiating from the center expand with the canvas's aspect ratio, ensuring they hit all outer edges simultaneously.
    *   **Center Snapping**: Pulses randomly spawned near the center will snap to the exact center for a more impactful, symmetrical effect.
*   **New "Clear Pulse" Effect**: Introduces a non-intrusive pulse that passes through the live matrix code without pausing the simulation or dimming the background. It highlights active code and fills gaps, creating a connected, tracer-like wave. Configurable with its own frequency, duration, width, and blending options.
*   **Pulse Storm (formerly Mini Pulse) Enhancements**: Renamed to "Pulse Storm", this effect now includes a "Preserve Spaces" option to control whether empty gaps are filled during the storm, and features improved alpha blending for a smoother fade-out.
*   **Superman Effect Refinements**: The "Superman" effect has been significantly enhanced:
    *   **Controlled Movement**: Improved erratic movement with a center-biased path, ensuring the lightning bolt stays within a reasonable vertical range.
    *   **Dynamic Spawning**: The bolt now spawns left-to-right with adjustable speed, leaving a visible "impression" behind.
    *   **Fade-out Duration**: Features a configurable fade-out duration, allowing the trails to dissipate smoothly.
    *   **Single Branch Focus**: Streamlined to a single, powerful lightning bolt for a more focused effect.
    *   **Performance Optimizations**: Further performance improvements for a smoother experience.
*   **Fine-tuned Deterioration**: Improved "Ghosting" with more control over `deteriorationStrength`, alongside refined `dissolve` effects for more realistic code decay.
*   **Inverted Tracers**: More explicit control over `invertedTracerChance` for streams that clear existing code rather than writing new characters, adding negative space to the rain.

**Stream & Flow Control:**
*   **Granular Stream Management**: New settings for `streamSpawnCount` and `eraserSpawnCount` allow for precise control over the number of falling streams and eraser streams.
*   **Flow Rhythm**: `releaseInterval` now controls the rhythm of new stream releases, allowing for more dynamic and less uniform rain patterns.
*   **Gap Control**: `minStreamGap` and `minEraserGap` provide better spatial control over stream placement, preventing streams from spawning too close together.
*   **Life Cycle in Seconds**: `ttlMinSeconds` and `ttlMaxSeconds` now define stream lifespan in seconds for more intuitive configuration.

**User Interface & Experience:**
*   **Reorganized FX Tab**: A new dedicated "FX" tab consolidates all visual effects, categorized into "Movie FX" (Pulse, Clear Pulse, Pulse Storm, Deja Vu, Superman) and "Special FX" (Star Power, Rainbow Streams), each within its own accordion menu for improved navigation.
*   **Accordion UI**: The settings panel has been redesigned with an intuitive accordion-style interface, making it easier to navigate and manage a growing number of options.
*   **Enhanced Mobile Scroll Guard**: Sliders on mobile devices now only respond to horizontal touch and drag gestures, completely preventing accidental value changes during vertical page scrolling, even when touching the slider area.
*   **Clear on Focus for Save Slots**: Input fields for saving/renaming presets now clear their content upon focus, streamlining the renaming process.
*   **Notification System**: A new, dedicated `NotificationManager` provides clear and consistent feedback for user actions like font imports, saves, and effect triggers.
*   **Improved Font Management**: The `FontManager` has been refined for more robust handling of custom font files, including better format detection and integration with the new notification system.

**Minor Adjustments:**
*   Default values for several parameters like `streamColor`, `tracerColor`, `bloomStrength`, `bloomOpacity`, `resolution`, `smoothingAmount`, `fontSize`, `tracerGlow`, `pulseDurationSeconds`, `pulseWidth`, and `pulseDimming` have been updated for a more balanced out-of-box experience.
*   The `randomStopEnabled` and `randomStopChance` features have been removed for a more focused stream behavior model.

#
🚀 What's New in v7.3.1
This patch release includes bug fixes, mobile usability enhancements, and a brand new visual effect.

**Bug Fixes:**
*   Resolved an issue where certain configurations could lead to incorrect character rendering.
*   Fixed minor performance regressions introduced in specific effect combinations.

**Mobile Enhancements:**
*   Further improvements to mobile responsiveness and touch interactions, especially for slider controls and panel navigation.
*   Optimized resource loading for faster initial page load on mobile devices.

**New Visual Effect:**
*   **Firewall Effect**: A dynamic effect that simulates a firewall's protective barrier, adding a layer of visual defense with configurable patterns and intensity.

#
🚀 What's New in v7.3.2
This version primarily focuses on refining the robust architecture introduced in `v7.3.1`, ensuring stability and minor optimizations without introducing major new features or breaking changes. It's about polishing the experience and reinforcing the foundational improvements.

#
#
✨ Features
🔠 Advanced Typography (Glyphs Tab)
Font Import: A new "Import Font File" button allows you to upload custom typography directly into the engine.

Persistent Storage: Imported fonts are saved to an internal database (MatrixFontDB), so you don't have to re-upload them every time you open the page.

Fine-Tuning: Added Font Offset X and Font Offset Y sliders to adjust your custom fonts within the grid cells.

Styling: Added Italicize and Mirror/Flip options. The Mirror option flips the entire canvas horizontally, useful for rear-projection setups, or if your code isn't already reversed like the movie.
#
👻 Visuals & Physics
Dissolve & Deterioration:

Ghosting: Enable "Ghosting" to see characters split and drift apart as they fade.

Dissolve Target Size: Characters can now shrink (dissolve) to a specific pixel size (e.g., 1px) rather than just disappearing, adding depth.

Inverted Tracers: Added logic for "Inverted Tracers"—streams where the "head" is actually a gap/hole rather than a bright character, adding negative space to the rain.

Rotator Crossfading: You can now adjust the Crossfade Smoothness to determine how softly one character morphs into another.
#
🎛️ UI & System
Toggle Switches: Replaced the old text-based toggles with animated sliding switches for clearer "On/Off" states.

Font Cache Management: A new system button to "Clear Font Cache" in case your database gets too large or corrupted.

Toast Notifications: New floating status messages (Toasts) confirm actions like "Font Imported" or "Saved to Slot 1".
#
🛠️ Technical Improvements
IndexedDB Integration: Moved away from simple LocalStorage for complex data. We now use an asynchronous database to handle large font blobs without freezing the main thread.

WOFF2 Support: The engine now correctly detects and provides format hints for modern web fonts (woff and woff2).

Touch Physics: The UI manager now calculates velocity and drag distance to distinguish between a "tap" and a "swipe," preventing accidental clicks while scrolling through tabs on mobile.
#
📝 Note on Upgrading from Previous Versions

With continuous improvements and architectural changes, especially the significant modularization introduced in `v7.3` and refined through `v7.3.1` and `v7.3.2`, your previous settings might be reset to defaults upon first load due to config schema updates. However, the export/import JSON structure remains largely compatible for most core settings. The journey from monolithic code to a modular, maintainable structure has been a key focus.

---

## 🏗️ Development Workflow

This project now supports a modular development workflow using a Python script to manage file splitting and combination. This allows for easier development and maintenance of individual components while still enabling the creation of a single monolithic HTML file for release.

### `matrix_builder.py` Script

The `matrix_builder.py` script provides three main commands: `split`, `combine`, and `refresh`.

#### `split` command

This command takes a monolithic HTML file (e.g., `MatrixCode_vX.Y.html`) and splits it into a modular directory structure. The output directory will contain:
-   `index.html`: A development-friendly HTML file that links to all the individual CSS and JavaScript files.
-   `css/style.css`: The extracted CSS styles.
-   `js/`: A directory containing JavaScript files for each class and utility, organized by category (e.g., `js/core/Utils.js`, `js/ui/UIManager.js`). New effect or simulation mode files will be automatically detected and placed into their respective `js/effects/` or `js/simulation/` subdirectories.

**Usage:**
```bash
python3 matrix_builder.py split <input_monolith_file> <output_directory>
```
**Example:**
```bash
python3 matrix_builder.py split MatrixCode_v7.3.html MatrixCode_v7.3_dev
```
This will create a `MatrixCode_v7.3_dev` directory containing the modular project structure.

#### `combine` command

This command takes a modular project directory and combines all its contents back into a single monolithic HTML file. It intelligently orders the JavaScript files based on dependencies and directory structure, automatically including any newly added effect or simulation mode files. This is useful for generating release builds or for packaging the application into a single portable file.

**Usage:**
```bash
python3 matrix_builder.py combine <input_directory> <output_monolith_file>
```
**Example:**
```bash
python3 matrix_builder.py combine MatrixCode_v7.3_dev MatrixCode_v7.3_Release.html
```
This will create a `MatrixCode_v7.3_Release.html` file containing the combined application.

#### `refresh` command

This command updates the `index.html` file within a modular project directory to reflect any changes in the JavaScript file structure (e.g., adding a new effect file). It ensures that the development `index.html` correctly links all current JavaScript files in the appropriate loading order.

**Usage:**
```bash
python3 matrix_builder.py refresh <input_directory>
```
**Example:**
```bash
python3 matrix_builder.py refresh MatrixCode_v7.3_dev
```
This will update the `index.html` file in `MatrixCode_v7.3_dev` to include any newly added `.js` files.

### Workflow Example

1.  **Initial Split:**
    ```bash
    python3 matrix_builder.py split MatrixCode_v7.3.html MatrixCode_v7.3_dev
    ```
2.  **Development:**
    Navigate to the `MatrixCode_v7.3_dev/` directory. Open `MatrixCode_v7.3_dev/index.html` in your web browser for development.
    Make changes to the individual JavaScript (`.js`) and CSS (`.css`) files within this directory.

    **If you add new `.js` files (e.g., a new effect):**
    After creating the new file (e.g., `js/effects/MyNewEffect.js`), you must also:
    *   Manually register the new effect in `js/core/MatrixKernel.js` (e.g., `this.effectRegistry.register(new MyNewEffect(...));`).
    *   If you want a UI button, manually add it to `js/ui/UIManager.js`'s `this.defs` array and handle its action in `handleAction()`.
    *   **Then, run the `refresh` command** to update your development `index.html`:
        ```bash
        python3 matrix_builder.py refresh MatrixCode_v7.3_dev
        ```
    Your `MatrixCode_v7.3_dev/index.html` will now include the new script.

3.  **Generate Release Build:**
    Once you are satisfied with your changes, run the `combine` command to generate a new monolithic release file:
    ```bash
    python3 matrix_builder.py combine MatrixCode_v7.3_dev MatrixCode_v7.3_Release.html
    ```
    The `MatrixCode_v7.3_Release.html` file will contain all your latest changes in a single, self-contained file.