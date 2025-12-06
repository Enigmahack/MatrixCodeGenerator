# Matrix Digital Rain Simulation (v7.3.2)

## Project Overview
This project is a high-fidelity, customizable simulation of the "Matrix Digital Rain" effect, built using HTML5 Canvas and modern JavaScript. It features a modular architecture for maintainability and extensibility, allowing for complex visual effects, custom fonts, and detailed configuration.

The current directory (`MatrixCode_v7.3.2`) represents the **modular development environment**.

## Architecture
The application is orchestrated by a `MatrixKernel`, which manages several specialized subsystems.

### Core Components (`js/core/`)
*   **`MatrixKernel.js`**: The main entry point. It initializes managers, sets up the game loop (`requestAnimationFrame`), and handles window resizing.
*   **`Utils.js`**: Helper functions for RNG, color manipulation, and data formatting.

### Configuration & State (`js/config/`)
*   **`ConfigurationManager.js`**: The single source of truth for application settings.
    *   Manages state persistence via `localStorage` (keys: `matrix_config_v7.3.1`, `matrix_slots_v7.3.1`).
    *   Calculates derived values (e.g., `cycleDuration`, `streamRgb`) to optimize performance.
    *   Implements a logical subscription system (`subscribe`, `notify`) to update components when settings change.

### Simulation & Data (`js/simulation/`, `js/data/`)
*   **`MatrixGrid.js`**: Manages the grid state (characters, alpha, decay) efficiently.
*   **`SimulationSystem.js`**: Controls the logic for falling streams, droplets, and erasers.
*   **`StreamModes.js`**: Defines behaviors for different stream types.

### Rendering (`js/rendering/`)
*   **`CanvasRenderer.js`**: Handles all drawing operations to the `matrixCanvas`. It supports advanced features like bloom, smoothing, and scaling.

### Visual Effects (`js/effects/`)
*   **`EffectRegistry.js`**: Manages active visual effects.
*   **Individual Effects**: Modular classes (e.g., `PulseEffect.js`, `FirewallEffect.js`, `DejaVuEffect.js`) that encapsulate specific visual behaviors.

### User Interface (`js/ui/`)
*   **`UIManager.js`**: Manages the settings panel, tabs, and user inputs.
*   **`NotificationManager.js`**: Displays toast notifications for user feedback.
*   **`FontManager.js`**: Handles custom font loading and storage via IndexedDB.

## Development Workflow

### Running the Project
Since this is a client-side web application, no compilation is strictly required for development.
1.  **Open `index.html`** directly in a modern web browser.
2.  **Refresh** the page to see changes made to the source files.

### Key Conventions
*   **Initialization**: The `MatrixKernel` is instantiated on `DOMContentLoaded` in `index.html`.
*   **Private Members**: Methods and properties starting with `_` (e.g., `_initializeManagers`) are treated as private.
*   **State Management**: Components should **not** modify `config.state` directly. They should use `config.set(key, value)` or read derived values from `config.derived`.
*   **Event Subscription**: Use `config.subscribe(callback)` to react to setting changes (e.g., resizing the grid when resolution changes).
*   **Loop**: The simulation runs on a fixed timestep loop within `MatrixKernel`, while rendering happens every animation frame.

## Directory Structure
```
MatrixCode_v7.3.2/
├── index.html              # Entry point
├── css/
│   └── style.css           # Application styling
└── js/
    ├── config/             # Configuration logic
    ├── core/               # Kernel and Utils
    ├── data/               # Grid and Font data
    ├── effects/            # Visual effect modules
    ├── rendering/          # Canvas rendering
    ├── simulation/         # Physics/Logic simulation
    └── ui/                 # UI Managers
```
