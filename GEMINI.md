# Matrix Digital Rain Simulation (v7.3.1)

## Project Overview
This project is a high-fidelity, customizable simulation of the "Matrix Digital Rain" effect, built using HTML5 Canvas and modern JavaScript. It features a modular architecture for maintainability and extensibility, allowing for complex visual effects, custom fonts, and detailed configuration.

The codebase exists in two forms:
1.  **Monolithic HTML:** A single self-contained file (e.g., `MatrixCode_v7.3.1.html`) for easy distribution.
2.  **Modular Directory:** A structured development environment (e.g., `MatrixCode_v7.3.1/`) with separate CSS and JS files.

## Architecture
The application is driven by a `MatrixKernel` which orchestrates several subsystems:

*   **Core (`js/core/`)**:
    *   `MatrixKernel.js`: The main entry point and game loop.
    *   `Utils.js`: Helper functions (RNG, color conversion, etc.).
*   **Data (`js/data/`)**:
    *   `MatrixGrid.js`: Manages the grid state (characters, alpha, decay) using TypedArrays for performance.
    *   `FontData.js`: Contains base64 encoded default fonts.
*   **Simulation (`js/simulation/`)**:
    *   `SimulationSystem.js`: Controls the logic of falling streams and erasers.
    *   `StreamModes.js`: Defines different stream behaviors (Standard, Star Power, Rainbow).
*   **Rendering (`js/rendering/`)**:
    *   `CanvasRenderer.js`: Handles drawing the grid to the canvas, including bloom and scaling.
*   **Effects (`js/effects/`)**:
    *   `EffectRegistry.js`: Manages active visual effects.
    *   Individual effect files (e.g., `PulseEffect.js`, `FirewallEffect.js`).
*   **Configuration (`js/config/`)**:
    *   `ConfigurationManager.js`: Manages application state, defaults, and LocalStorage persistence.
*   **UI (`js/ui/`)**:
    *   `UIManager.js`: Handles the settings panel, tabs, and user inputs.
    *   `NotificationManager.js`: Displays toast notifications.
    *   `FontManager.js`: Handles custom font loading and storage via IndexedDB.

## Build System
A Python script, `matrix_builder.py`, is used to switch between the monolithic and modular formats.

### Key Commands
*   **Split (Monolith -> Modular):**
    ```bash
    python3 matrix_builder.py split <input_monolith_file> <output_directory>
    ```
    *Example:* `python3 matrix_builder.py split MatrixCode_v7.3.1.html MatrixCode_dev`

*   **Combine (Modular -> Monolith):**
    ```bash
    python3 matrix_builder.py combine <input_directory> <output_monolith_file>
    ```
    *Example:* `python3 matrix_builder.py combine MatrixCode_dev MatrixCode_Release.html`

*   **Refresh (Update Index):**
    Updates `index.html` in the modular directory to include any new JavaScript files found in the structure.
    ```bash
    python3 matrix_builder.py refresh <input_directory>
    ```

## Development Workflow
1.  **Edit:** Make changes in the modular directory (`MatrixCode_v7.3.1/`).
2.  **Test:** Open `MatrixCode_v7.3.1/index.html` in a browser to verify changes.
3.  **New Files:** If you add a new JS file (e.g., a new Effect):
    *   Place it in the appropriate subdirectory (e.g., `js/effects/`).
    *   Run `python3 matrix_builder.py refresh MatrixCode_v7.3.1`.
    *   **Important:** You must also manually register the new class in `MatrixKernel.js` (for effects) or `UIManager.js` (for controls).
4.  **Release:** Run the `combine` command to generate a single HTML file for distribution.

## Key Conventions
*   **State Management:** The `ConfigurationManager` is the source of truth for settings. Components subscribe to changes via `config.subscribe(key, callback)`.
*   **Performance:** The grid uses TypedArrays (`Uint16Array`, `Float32Array`, etc.) to minimize memory overhead and garbage collection.
*   **Styling:** Styles are in `css/style.css`. The UI uses a custom accordion and tab system.
*   **Font Handling:** Custom fonts are stored in IndexedDB (`MatrixFontDB`) to avoid re-uploading and to handle large file sizes efficiently.
