Check out the live demo here: 
https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v10.1.html

**Note: 
The font used in the screenshot including the Resurrection glyphs was Rezmason's work - please be sure to check out his awesome site too: 
https://github.com/Rezmason/matrix


#
## 💻 Matrix Digital Rain Simulation v10.1

I'm getting tired of writing these... It started as a simple coding adventure and turned into an obsession. Here are some screenshots - moved away from Canvas2D and moved towards WebGL and GLSL. It's WAY smoother than I thought, even on an old 2013 MacBook Pro. Now with 100% more 3D! (It's still beta but it seems to work so far.)
Everything seen here is a screenshot from the site. 

https://github.com/Enigmahack/MatrixCodeGenerator/raw/refs/heads/main/Video%20Demo/Matrix_10.1.mp4

<img width="1280" height="800" alt="Screenshot 2026-04-06 at 12 13 39 AM" src="https://github.com/user-attachments/assets/7f066332-6e9e-4232-9fe2-9ac1663d511d" />
<img width="1279" height="692" alt="Screenshot 2026-04-06 at 1 14 25 AM" src="https://github.com/user-attachments/assets/91a743e8-b27f-4556-8c10-36d2f3959cfb" />
<img width="1280" height="694" alt="Screenshot 2026-04-06 at 1 14 09 AM" src="https://github.com/user-attachments/assets/a747d844-2ee6-478a-9bfd-d1cd72b52029" />
<img width="1280" height="693" alt="Screenshot 2026-04-06 at 11 19 35 AM" src="https://github.com/user-attachments/assets/246efe24-3fa2-4b7a-a087-dcbc01f1006a" />
<img width="1280" height="694" alt="Screenshot 2026-04-06 at 1 12 44 AM" src="https://github.com/user-attachments/assets/4480aa70-5709-4211-80a0-66c79b197cdb" />
<img width="1280" height="694" alt="Screenshot 2026-04-05 at 11 57 27 PM" src="https://github.com/user-attachments/assets/409ff740-26f2-4f3f-9ea6-1620938b7f83" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 47 40 PM" src="https://github.com/user-attachments/assets/efb2de3d-e8b7-447f-96f8-f15cc4460ecf" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 47 39 PM" src="https://github.com/user-attachments/assets/9c424a6b-c6fc-434c-8fcf-31d750bc268f" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 46 46 PM" src="https://github.com/user-attachments/assets/3b0acee2-bdb7-4179-9858-b04e1bb026dd" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 46 23 PM" src="https://github.com/user-attachments/assets/80a7c117-45c9-4903-ba35-1b94ac0814fc" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 46 02 PM" src="https://github.com/user-attachments/assets/c20f961e-3e71-4f2b-963f-d51e19b84017" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 45 52 PM" src="https://github.com/user-attachments/assets/34e1e583-1e61-4bc9-a53c-8df9f78d434a" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 45 50 PM" src="https://github.com/user-attachments/assets/13893836-41e4-49ee-9dc0-272d1f2f1c5e" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 43 19 PM" src="https://github.com/user-attachments/assets/cbb90360-fcb2-483e-a841-668d19031c8f" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 42 48 PM" src="https://github.com/user-attachments/assets/0b01adc8-32f0-4030-aa58-8aba9ef93cb1" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 40 52 PM" src="https://github.com/user-attachments/assets/9fd7c630-efa5-4749-bc67-9516822b0644" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 40 30 PM" src="https://github.com/user-attachments/assets/b374dd56-611a-4d43-8901-24d9cfa8c7d3" />
<img width="1280" height="800" alt="Screenshot 2026-04-05 at 11 40 21 PM" src="https://github.com/user-attachments/assets/3d9cf5da-db82-4107-9810-395fc63ac74c" />


#
🚀 What's New in v10.1
This milestone release marks a significant leap in visual fidelity and architectural stability with a completely overhauled effects engine.

**Quantized Effects Suite:**
*   **"Reality Swap" Mechanic**: Quantized Pulse now reveals a "Shadow World"—a parallel, independent simulation—that can be permanently committed to the main grid upon completion.
*   **Shadow Simulation (Ping-Pong Architecture)**: Implemented a high-performance system where two independent worlds flow continuously, allowing for seamless, zero-latency swaps and "New World" reveals.
*   **Advanced Growth Logic**: Expansion now follows an "Aspect Ratio Driven Cross Extension" algorithm with a 7-stage growth cycle (Vertical Bar -> Horizontal Bar -> Hole Fill -> Random Chunk), ensuring cinematic coverage.
*   **Expansion Optimization**: Shifted to a high-performance Expansion Map architecture (Uint16Array) for O(1) lookups and integer-driven growth logic.
*   **Visual Refinement**: Added organic block shapes (2x2, 2x3, 3x2, 3x3) and "Two-Cycle Visuals" where new blocks retain a distinct color (Yellow) for one cycle before merging (Green) into the structure.
*   **New Effects**: Fully implemented **Quantized Zoom** (procedural chip-style zoom) and **Quantized Retract** (controlled grid erosion) with dedicated UI controls.

**Rendering & Visuals:**
*   **GPU-Accelerated Glyph Path**: Implemented a dedicated lookup path that builds a Uint16Array of atlas glyph IDs, bypassing thousands of costly `drawImage` calls per frame for high-density simulations.
*   **Multi-Pass Visual Pipeline**: Refined the 4-pass rendering system (Perimeter -> Interior Lines -> Block Fill -> Overlay) to support complex effects like Quantized Zoom with 1:1 visual fidelity.
*   **Layer-Synchronized Generation**: Optimized `QuantizedBlockGenerator` to populate all sub-layers simultaneously, ensuring consistent coverage across 100k+ cells without redundant per-layer calculations.
*   **Alpha & Masking Refinement**: Updated `WebGLRenderer` to allow effect overrides to inherit `mix` states, enabling complex styles like Upward Tracers and Glimmer to persist through reality transitions.

**Engine & Performance:**
*   **Bitmask State Management**: Eliminated GC overhead by replacing `Set` and `Map` objects with high-speed bitmasks and pre-allocated `Uint8Array` buffers for occupancy and frontier tracking.
*   **Threaded State Persistence**: Implemented robust hot-swapping of SimulationWorker state via `replace_state`, ensuring seamless transitions for active streams, base colors, and render modes.
*   **Transition Buffer**: Added a 5-frame masking delay during state swaps to eliminate visual flicker and ensure underlying simulation stability.

#
🚀 What's New in v8.5
This major update introduces advanced temporal controls and further polishes the high-performance WebGL engine.

**Updated Effects:**
*   **Time Manipulation (Reverse Time)**: A new custom effect that orchestrates a cinematic sequence
*   **Movie-Accurate Pulse Effect**: A frame-by-frame recreation of the pulse effect in the original trilogy. 
*   **Updated Crashing Effect**: Corrected some misbehaving or poorly implemented visual effects. 

**Performance & Engine Refinements:**
*   **WebGL Optimized Fixed Grid**: Continued refinements to the v8 CellGrid architecture, providing even smoother 60fps performance on legacy hardware (like 2013-era MacBooks).
*   **Effects Pipeline Update**: Ensured a full 2-pass shader pipeline. Now effects can use one pass while leaving custom pipelines alone to keep graphical stability. 


**UI & Configuration:**
*   **Refined Defaults**: Updated the "Trilogy" baseline configuration to provide a more authentic visual experience upon first load.
*   **Dynamic UI Sync**: Improved synchronization between the settings panel and the live simulation state.
*   **Stream & Tracer updates**: Added additional controls and behaviors for both streams and tracers to be able to accurately replicate both the original trilogy as well as Matrix Resurrections. 

#
🚀 What's New in v7.7
This update brought the codebase to version 7.7, including foundational configuration updates and initial performance improvements for the modular architecture.

#
🚀 What's New in v7.5
This release introduces a massive upgrade to typographical customization and simulation dynamics.

**Typography & Customization:**
*   **Multi-Font Architecture**: You can now run multiple fonts simultaneously. The engine intelligently switches between them per-stream or even per-character in the background layer.
*   **Character Set Manager**: A new interface allows precise control over which characters are used for each font.
*   **Visual Character Picker**: Select your desired glyphs by simply clicking on them in a visual grid, eliminating the guesswork for non-standard symbol fonts.
*   **Auto-Detect All Characters**: Automatically scans your custom fonts to find and use every valid glyph available, filtering out empty boxes.
*   **Imposition Layer Sync**: The background "Imposition Layer" (Character Overlay) now respects your active font choices, creating a seamless blend of standard and custom characters.

**Simulation Dynamics:**
*   **Tracer Desync**: A new "Tracer Desync" slider allows tracers to fall at varying, chaotic speeds instead of a uniform rhythm, creating a more organic and unpredictable flow.

**UI Refinements:**
*   **Better Organization**: Moved tracer release controls to the appropriate section and renamed "Imposition Layer" to "Character Overlay" for clarity.
*   **Mobile & Desktop Fixes**: Improved color picker behavior on all devices and fixed drag-to-edit interactions.

#
🚀 What's New in v7.4
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

With continuous improvements and architectural changes, especially the significant modularization introduced in `v10.1` and refined through subsequent updates, your previous settings might be reset to defaults upon first load due to config schema updates. However, the export/import JSON structure remains largely compatible for most core settings. The journey from monolithic code to a modular, maintainable structure has been a key focus.

## 🛠️ Hidden Resources

### .claude/ Folder - File Manipulation Tools

The `.claude/` directory contains additional utility tools designed to assist with file manipulation and development workflows:

- **`.claude/commands/`**: Contains command definitions for various automation tasks
- **`.claude/tests/`**: Test utilities for validating operations
- **`.claude/tools/`**: Core tools for file manipulation and processing

These resources are available to enhance your development experience when working with the project.

---

## 🏗️ Development Workflow

This project now supports a modular development workflow using a Python script to manage file splitting and combination. This allows for easier development and maintenance of individual components while still enabling the creation of a single monolithic HTML file for release.

### Building the Standalone App

To create a standalone executable (Windows EXE, Mac DMG, Linux AppImage) using Electron:

1.  **Install Dependencies:**
    ```bash
    cd MatrixCode_v10.1
    npm install
    ```

2.  **Build:**
    ```bash
    npm run dist
    ```
    This will generate the installer/executable in the `dist/` folder.

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
python3 matrix_builder.py split MatrixCode_v10.1.html MatrixCode_v10.1_dev
```
This will create a `MatrixCode_v10.1_dev` directory containing the modular project structure.

#### `combine` command

This command takes a modular project directory and combines all its contents back into a single monolithic HTML file. It intelligently orders the JavaScript files based on dependencies and directory structure, automatically including any newly added effect or simulation mode files. This is useful for generating release builds or for packaging the application into a single portable file.

**Usage:**
```bash
python3 matrix_builder.py combine <input_directory> <output_monolith_file>
```
**Example:**
```bash
python3 matrix_builder.py combine MatrixCode_v10.1_dev MatrixCode_v10.1_Release.html
```
This will create a `MatrixCode_v10.1_Release.html` file containing the combined application.

#### `refresh` command

This command updates the `index.html` file within a modular project directory to reflect any changes in the JavaScript file structure (e.g., adding a new effect file). It ensures that the development `index.html` correctly links all current JavaScript files in the appropriate loading order.

**Usage:**
```bash
python3 matrix_builder.py refresh <input_directory>
```
**Example:**
```bash
python3 matrix_builder.py refresh MatrixCode_v10.1_dev
```
This will update the `index.html` file in `MatrixCode_v10.1_dev` to include any newly added `.js` files.

### Workflow Example

1.  **Initial Split:**
    ```bash
    python3 matrix_builder.py split MatrixCode_v10.1.html MatrixCode_v10.1_dev
    ```
2.  **Development:**
    Navigate to the `MatrixCode_v10.1_dev/` directory. Open `MatrixCode_v10.1_dev/index.html` in your web browser for development.
    Make changes to the individual JavaScript (`.js`) and CSS (`.css`) files within this directory.

    **If you add new `.js` files (e.g., a new effect):**
    After creating the new file (e.g., `js/effects/MyNewEffect.js`), you must also:
    *   Manually register the new effect in `js/core/MatrixKernel.js` (e.g., `this.effectRegistry.register(new MyNewEffect(...));`).
    *   If you want a UI button, manually add it to `js/ui/UIManager.js`'s `this.defs` array and handle its action in `handleAction()`.
    *   **Then, run the `refresh` command** to update your development `index.html`:
        ```bash
        python3 matrix_builder.py refresh MatrixCode_v10.1_dev
        ```
    Your `MatrixCode_v10.1_dev/index.html` will now include the new script.

3.  **Generate Release Build:**
    Once you are satisfied with your changes, run the `combine` command to generate a new monolithic release file:
    ```bash
    python3 matrix_builder.py combine MatrixCode_v10.1_dev MatrixCode_v10.1_Release.html
    ```
    The `MatrixCode_v10.1_Release.html` file will contain all your latest changes in a single, self-contained file.
