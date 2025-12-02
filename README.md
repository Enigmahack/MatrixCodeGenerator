Check out the live demo here: 
https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v7.2.html
#
💻 Matrix Digital Rain Simulation v7.2
The quest for the "perfect" rain continues. v7.2 represents a massive leap forward in typographical control and visual fidelity. Going beyond hardcoded fonts and standard fading to a fully customizable engine that allows you to inject your own glyphs and simulate the analog signal decay seen in the original film.

<img width="3838" height="1955" alt="image" src="https://github.com/user-attachments/assets/da2a1739-49e8-404b-a4c5-d9d8bb3c9bf4" />
<img width="3834" height="1957" alt="image" src="https://github.com/user-attachments/assets/7a759436-d8b7-41d4-923a-9ff1a8e05aa6" />
<img width="3838" height="1955" alt="image" src="https://github.com/user-attachments/assets/71adcfee-d368-4ebc-ad31-5b0bb58c75a5" />
<img width="3836" height="1954" alt="image" src="https://github.com/user-attachments/assets/783e8762-a27d-4812-8007-491cce461b3f" />

#
🚀 What's New in v7.2
This release focuses on deeper customization, advanced visual effects, and a refined user experience. We've overhauled core systems for better performance and introduced powerful new ways to control the digital rain.

**Core System Overhauls & Performance:**
*   **Modular Architecture**: Major refactoring of the simulation engine into a more modular `MatrixKernel` with dedicated systems for Grid, Simulation, Effects, and Rendering, enhancing maintainability and future expansion.
*   **Optimized Grid**: The underlying grid structure has been re-engineered using TypedArrays for significant performance improvements, especially in large simulations.

**Enhanced Visuals & Effects:**
*   **Fine-tuned Deterioration**: Improved "Ghosting" with more control over `deteriorationStrength`, alongside refined `dissolve` effects for more realistic code decay.
*   **Advanced Pulse Effect**: The `Pulse` effect now offers more control with new `pulseCircular`, `pulseBlend`, and `pulseInstantStart` options, allowing for a wider range of visual impact.
*   **New "Mini Pulse" Effect**: Introducing a dynamic new "Mini Pulse" effect (also known as "Storm"), which spawns localized, expanding rings of code disruption, creating a chaotic and energetic visual burst. Configurable parameters include frequency, duration, spawn chance, size, thickness, and speed.
*   **Inverted Tracers**: More explicit control over `invertedTracerChance` for streams that clear existing code rather than writing new characters, adding negative space to the rain.

**Stream & Flow Control:**
*   **Granular Stream Management**: New settings for `streamSpawnCount` and `eraserSpawnCount` allow for precise control over the number of falling streams and eraser streams.
*   **Flow Rhythm**: `releaseInterval` now controls the rhythm of new stream releases, allowing for more dynamic and less uniform rain patterns.
*   **Gap Control**: `minStreamGap` and `minEraserGap` provide better spatial control over stream placement, preventing streams from spawning too close together.
*   **Life Cycle in Seconds**: `ttlMinSeconds` and `ttlMaxSeconds` now define stream lifespan in seconds for more intuitive configuration.

**User Interface & Experience:**
*   **Accordion UI**: The settings panel has been redesigned with an intuitive accordion-style interface, making it easier to navigate and manage a growing number of options.
*   **Mobile Scroll Guard**: Sliders on mobile devices now only respond to horizontal touch and drag gestures, preventing accidental value changes during vertical page scrolling.
*   **Notification System**: A new, dedicated `NotificationManager` provides clear and consistent feedback for user actions like font imports, saves, and effect triggers.
*   **Improved Font Management**: The `FontManager` has been refined for more robust handling of custom font files, including better format detection and integration with the new notification system.

**Minor Adjustments:**
*   Default values for several parameters like `streamColor`, `tracerColor`, `bloomStrength`, `bloomOpacity`, `resolution`, `smoothingAmount`, `fontSize`, `tracerGlow`, `pulseDurationSeconds`, `pulseWidth`, and `pulseDimming` have been updated for a more balanced out-of-the-box experience.
*   The `randomStopEnabled` and `randomStopChance` features have been removed for a more focused stream behavior model.
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
📝 Note on Upgrading from v6.2
Because v7.2 introduces a new database structure for fonts, your previous settings from v6.2 might be reset to defaults upon first load. However, the export/import JSON structure remains backward compatible for most core settings.
