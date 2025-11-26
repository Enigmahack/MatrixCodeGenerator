💻 Matrix Digital Rain Simulation v5.0.4 

A customizable, optimized, modular canvas-based recreation of the iconic digital rain effect. Now featuring post-processing effects, advanced tracer lifecycles, and a revamped rendering engine.

Yes, it's been over 25 years since this movie came out and there's still some dufus out there trying to get the code looking like the actual screens in the movie. No, it's not NEARLY as good, performant, optimized, accurate, detailed, or just plain neato as http://www.thematrixscreensaver.com/ but it's a not bad attempt.

<img width="1280" height="687" alt="image" src="https://github.com/user-attachments/assets/d2a8add2-74d7-48a5-a86d-bdca5eb20590" />


🚀 What's New in v5.0

Compared to previous versions (v4.x), this release introduces significant visual and architectural overhauls:

Modular Architecture: The codebase has been completely refactored into distinct Logic, Data, and Rendering layers for better stability.

Inverse Proportional Cross-Fade: Tracers no longer "snap" or overlap awkwardly. As the white leading tracer fades out, the green stream character fades in on the exact same cell proportionally, creating a seamless trail.

Post-Processing Effects: added support for Bloom (glow), Resolution Scaling (supersampling or performance mode), and Edge Smoothing.

Advanced Tracer Lifecycle: Tracers now have configurable Attack (Fade In), Hold, and Release (Fade Out) timings.

"Dark Pulse" Effect: The Pulse effect now drops the luminosity of frozen characters by 80%, creating a high-contrast "dormant" state before the wave hits.


✨ Features

This simulation offers deep customization through an integrated settings panel accessible via the Settings (Gear) icon in the top-right corner.

Core Customization
Appearance: Full control over Stream Color and Tracer Color.

Performance & Flow: Adjust Speed (writing cycle), Stream Min/Max Length, and Decay Fade Speed to control the persistence and rate of the trails.

Gaps & Holes: Configure the Hole Rate (percentage of black space within a trail).

Layout: Fine-tune the grid with controls for Font Size, Horizontal Spacing, and Vertical Spacing.

Visuals & Post-FX (New)
Bloom: Toggle an upscaling bloom effect to give the code that CRT-monitor glow. Controls for Strength and Opacity.

Resolution Scale: Adjust the internal rendering resolution (0.5x to 2.0x) to balance sharpness vs. performance.

Edge Smoothing: Optional anti-aliasing filter for softer text rendering.

Advanced Effects
Tracer Lifecycle: Fine-tune exactly how the leading character behaves with Attack Frames, Hold Frames, and Release Frames.

Variable Brightness: Toggle and control the Brightness Variance to give the characters a more organic, shimmering look.

Rotators: Characters can randomly cycle to new glyphs. Now supports Cross-fade Frames for smooth morphing between characters.

Inverted Tracers: A special stream mode where the tracer character only appears in the gaps (Holes).

Pulse Effect: A cinematic effect that freezes the screen (dimming it by 80%) and triggers an expanding white pulse wave.

Configuration Management
Save Slots: Quickly SAVE and LOAD up to five different preset configurations directly in your browser's local storage.

Export/Import: Export your current settings to a JSON file to share with others, and Import settings from any compatible file.

Factory Reset: Instantly revert all settings to the "Gold Master" defaults.


▶️ How to Run

This project is a single-file application requiring no external dependencies or build steps.

Download: Clone the repository or download the MatrixCode_v5.0.4.html file.

Launch: Open the file directly in any modern web browser (Chrome, Firefox, Edge, Safari).

Configure: Click the gear icon in the top-right corner to open the settings panel and begin customizing!


🛠️ Technologies

HTML5 (Structure)

CSS3 (Styling, Backdrop Filters, and Panel Layout)

Vanilla JavaScript (Modular ES6+ Class Structure)

Canvas API (High-performance rendering with Offscreen buffering for Bloom)


📄 License

This project is licensed under... Uhhh... I don't know how this part works. I mean, I didn't really do anything special here except ingest far too much caffeine, spend way too much time reading up on Canvas, and depending far too much on Gemini to help me fill in the blanks, poorly.

Do whatever you want with this code. Use it, customize it, steal it, claim it as your own... It's entirely up to you. Just have fun with it.
