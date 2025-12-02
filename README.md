Check out the live demo here: 
https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v7.1.html
#
💻 Matrix Digital Rain Simulation v7.1
The quest for the "perfect" rain continues. v7.1 represents a massive leap forward in typographical control and visual fidelity. Going beyond hardcoded fonts and standard fading to a fully customizable engine that allows you to inject your own glyphs and simulate the analog signal decay seen in the original film.

<img width="3840" height="1885" alt="image" src="https://github.com/user-attachments/assets/eecd274c-3cb1-42a6-a75b-e149feafaf36" />
<img width="3839" height="1909" alt="image" src="https://github.com/user-attachments/assets/06dc1c92-19b2-4c1b-8faf-f7859d7e4ac7" />
<img width="3837" height="1914" alt="image" src="https://github.com/user-attachments/assets/6ebe42d1-2e39-47bc-9ebc-a3681d3c0262" />
<img width="3834" height="1915" alt="image" src="https://github.com/user-attachments/assets/d0037881-19d5-48dd-957a-4118b6b23e09" />
<img width="3839" height="1915" alt="image" src="https://github.com/user-attachments/assets/41dcfdc5-b7a9-4064-8f63-3f5feef2dc52" />
<img width="3836" height="1915" alt="image" src="https://github.com/user-attachments/assets/7d15e00a-f446-4961-8ecb-f302d998642f" />
<img width="3836" height="1917" alt="image" src="https://github.com/user-attachments/assets/8d57dd80-df38-4ad4-91b6-e430657e84f0" />



#
🚀 What's New in v7.1
This release is all about Customization, Support, and Atmospherics. Simply fading text out wasn't accurate enough; it needed to "ghost" and deteriorate. Furthermore you can now load your own fonts. 

Custom Font Manager & Injection: You are no longer stuck with the default embedded fonts. v7.1 includes a full Font Manager that uses your browser's IndexedDB to save custom .ttf, .otf, and .woff files. If you have created a custom Matrix font, you can now drag and drop it directly into the simulation and it will persist across reloads.

Code Ghosting: In the movie, the code doesn't just turn black; it blurs and "ghosts" as it fades. It creates fuzzy, drifting ghosts of characters as they die out, simulating a CRT phosphor decay effect.

Synced Rotators: Previously, characters changed randomly. Now, with Rotator Sync, the changing characters (rotators) can lock their cycle speed to the movement of the tracers. This creates a "mechanical" feel, where the code shifts exactly as it falls.

"Gel" Physics UI: The settings panel tabs now feature a custom physics engine with "Gel Damping." When you scroll or drag the tabs, they bounce and settle organically rather than stopping abruptly—feels much better on touch screens.

There's a LOT more in there from special features to colors, and more so take a look around the settings. 
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
Because v7.1 introduces a new database structure for fonts, your previous settings from v6.2 might be reset to defaults upon first load. However, the export/import JSON structure remains backward compatible for most core settings.
