Check out the live demo here: 
https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v6.4.html



💻 Matrix Digital Rain Simulation v6.1
A customizable, optimized, modular canvas-based recreation of the iconic digital rain effect. Now featuring "Star Power" effects, rainbow streams, and massive performance improvements.

Yes, it's been over 25 years since this movie came out and there's still some dufus (me) out there trying to get the code looking like the actual screens in the movie. No, it's not NEARLY as good, performant, optimized, accurate, detailed, or just plain neato as The Matrix Screensaver, but it's a not bad attempt.

![MatrixCodeRecording5 7](https://github.com/user-attachments/assets/45396696-9013-4b4e-9e2b-695ba23a94bc)

<img width="1278" height="687" alt="image" src="https://github.com/user-attachments/assets/50ee0bd8-9194-4d98-b4c6-31bead67ff82" />

<img width="1280" height="686" alt="image" src="https://github.com/user-attachments/assets/dfb8b9f7-6fb2-4cfa-b698-e29b6329227d" />

<img width="1280" height="689" alt="image" src="https://github.com/user-attachments/assets/be70ce02-ac02-4cfb-8555-81d6c8b3ed61" />


##
🚀 What's New in v6.1
This release is a major overhaul focusing on rendering efficiency and adding some flashy new visual modes.

Star Power & Rainbow Streams: We finally broke the green monochrome rule. You can now enable "Rainbow Streams" (random solid colors) or "Star Power" tracers that cycle through the color spectrum or glitter with white sparks.

Memory Optimization (No More Jank): The "Pulse" effect has been completely rewritten to use TypedArrays and parallel memory states. This eliminates the garbage collection stutter that used to happen when the pulse triggered.

Rendering Pipeline Overhaul: Implemented "State Guarding" for the Canvas context. The engine now intelligently checks to ensure we only talk to the GPU when absolutely necessary, significantly reducing CPU load.

Smart Caching: Color strings and HSL calculations are now cached, reducing the overhead of generating thousands of string objects per frame.

Bloom Optimization: The bloom filter no longer relies on the expensive ctx.filter method. It now utilizes a down-scaling/up-scaling technique that looks just as good but runs exponentially faster on lower-end hardware.

Stability Fixes: Fixed a critical bug where resizing the browser window aggressively could cause an array-out-of-bounds error and crash the loop.
##
✨ Features
This simulation offers deep customization through an integrated settings panel accessible via the Settings (Gear) icon in the top-right corner.

Core Customization
Appearance: Full control over Stream Color and Tracer Color.

Typography: Select your preferred Font Face to change the overall look of the character set. 

Performance & Flow: Adjust Speed (writing cycle), Stream Min/Max Length, and Decay Fade Speed.

Layout: Fine-tune the grid with controls for Font Size, Horizontal Spacing, and Vertical Spacing.

Visuals & Post-FX
Bloom: Toggle an optimized upscaling bloom effect to give the code that CRT-monitor glow.

Resolution Scale: Adjust the internal rendering resolution (0.5x to 2.0x).

Edge Smoothing: Optional anti-aliasing filter for softer text rendering.

Dissolve Effect: Characters shrink as they fade out for a more organic decay.

Advanced Effects
[NEW] Star Power:

Rainbow Modes: Set tracers to cycle through colors per stream or per character.

Glitter: Add random white flashes to tracers for extra sparkle.

Rainbow Streams: Set a percentage of streams to spawn with random static colors.

Deja Vu (Glitch): Horizontal strips of "bad code" flash across the screen, rewriting the characters in the grid before disappearing. Highly customizable frequency and intensity.

Pulse Effect: A cinematic effect that freezes the screen (dimming it by 80%) and triggers an expanding white pulse wave.

Tracers & Rotators: Fine-tune tracer lifecycle (Attack/Hold/Release) and enable random character rotation (glyph cycling).

Configuration Management
Debug Tab: Manually trigger the Pulse or Deja Vu effects to test your settings immediately.

Save Slots: Quickly SAVE and LOAD up to five different preset configurations directly in your browser's local storage.

Export/Import: Export your current settings to a JSON file to share with others.

Factory Reset: Instantly revert all settings to the "Gold Master" defaults.

##
▶️ How to Run
This project is a single-file application requiring no external dependencies or build steps.

Download: Clone the repository or download the MatrixCode_v6.1_Optimized.html file.

Launch: Open the file directly in any modern web browser (Chrome, Firefox, Edge, Safari).

Configure: Click the gear icon in the top-right corner to open the settings panel and begin customizing!

##
🛠️ Technologies
HTML5 (Structure)

CSS3 (Styling, Backdrop Filters, and Panel Layout)

Vanilla JavaScript (Modular ES6+ Class Structure)

Canvas API (High-performance rendering with State Guarding and Offscreen buffering)

##
📄 License
This project is licensed under... Uhhh... I don't know how this part works. I mean, I didn't really do anything special here except ingest far too much caffeine, spend way too much time reading up on Canvas optimization, and depending far too much on Gemini to help me fill in the blanks, poorly.

Do whatever you want with this code. Use it, customize it, steal it, claim it as your own... It's entirely up to you. Just have fun with it.
