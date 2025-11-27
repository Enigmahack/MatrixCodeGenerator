💻 Matrix Digital Rain Simulation v5.7
A customizable, optimized, modular canvas-based recreation of the iconic digital rain effect. Now featuring "Deja Vu" glitch effects, frame-rate independent physics, and dynamic font selection.

Yes, it's been over 25 years since this movie came out and there's still some dufus out there trying to get the code looking like the actual screens in the movie. No, it's not NEARLY as good, performant, optimized, accurate, detailed, or just plain neato as http://www.thematrixscreensaver.com/ but it's a not bad attempt.

![Recording 2025-11-26 111429](https://github.com/user-attachments/assets/583571cc-ad89-4ea1-97fa-9ded403fb969)

<img width="3830" height="1914" alt="Screenshot 2025-11-26 110920" src="https://github.com/user-attachments/assets/aed7a857-9d44-467f-b988-08d84ddbb47d" />

<img width="3838" height="1914" alt="Screenshot 2025-11-26 111028" src="https://github.com/user-attachments/assets/ac4d7b80-39ca-46c1-ad30-fc9df406d3b7" />

##
🚀 What's New in v5.7
This version focuses on cinematic effects, stability, and smoothness.

"Deja Vu" Glitch Effect: A new cinematic event inspired by the movie. Horizontal strips of "bad code" flash across the screen, rewriting the characters in the grid before disappearing. Highly customizable via the new "Glitch" tab.

Fixed Time Step Engine: The physics logic has been decoupled from the frame rate. The rain now falls at the consistent, correct speed whether you are on a 60Hz office monitor or a 240Hz gaming display.

Font Selection: You are no longer stuck with the default font. Choose between Matrix Standard, Gothic, Console, Typewriter, or system defaults directly from the settings.

DPI-Aware Resolution: The code now automatically detects high-DPI (Retina) displays and sets the resolution scale accordingly for crisp text out of the box.

Garbage Collection Optimization: Significant reduction in memory thrashing by pre-calculating render strings, resulting in fewer micro-stutters.

UI Polish: The settings panel now features physics-based smooth scrolling for the navigation tabs.

##
✨ Features
This simulation offers deep customization through an integrated settings panel accessible via the Settings (Gear) icon in the top-right corner.

Core Customization
Appearance: Full control over Stream Color and Tracer Color.

Typography: Select your preferred Font Face to change the vibe from "Hacker" to "Retro Terminal."

Performance & Flow: Adjust Speed (writing cycle), Stream Min/Max Length, and Decay Fade Speed.

Layout: Fine-tune the grid with controls for Font Size, Horizontal Spacing, and Vertical Spacing.

Visuals & Post-FX
Bloom: Toggle an upscaling bloom effect to give the code that CRT-monitor glow. Controls for Strength and Opacity.

Resolution Scale: Adjust the internal rendering resolution (0.5x to 2.0x).

Edge Smoothing: Optional anti-aliasing filter for softer text rendering.

Advanced Effects
Deja Vu (Glitch): [NEW] Configure the frequency, duration, intensity, and size of the glitch bars. Includes an "Auto Trigger" mode to act as a screensaver event.

Tracer Lifecycle: Fine-tune exactly how the leading character behaves with Attack, Hold, and Release timings.

Variable Brightness: Toggle and control the Brightness Variance to give the characters a more organic, shimmering look.

Rotators: Characters can randomly cycle to new glyphs with smooth cross-fading.

Pulse Effect: A cinematic effect that freezes the screen (dimming it by 80%) and triggers an expanding white pulse wave.

Configuration Management
Debug Tab: Manually trigger the Pulse or Deja Vu effects to test your settings immediately.

Save Slots: Quickly SAVE and LOAD up to five different preset configurations directly in your browser's local storage.

Export/Import: Export your current settings to a JSON file to share with others.

Factory Reset: Instantly revert all settings to the "Gold Master" defaults.


##  
▶️ How to Run
This project is a single-file application requiring no external dependencies or build steps.

Download: Clone the repository or download the MatrixCode_v5.7.html file.

Launch: Open the file directly in any modern web browser (Chrome, Firefox, Edge, Safari).

Configure: Click the gear icon in the top-right corner to open the settings panel and begin customizing!


##  
🛠️ Technologies
HTML5 (Structure)

CSS3 (Styling, Backdrop Filters, and Panel Layout)

Vanilla JavaScript (Modular ES6+ Class Structure)

Canvas API (High-performance rendering with Offscreen buffering for Bloom)


##  
📄 License
This project is licensed under... Uhhh... I don't know how this part works. I mean, I didn't really do anything special here except ingest far too much caffeine, spend way too much time reading up on Canvas, and depending far too much on Gemini to help me fill in the blanks, poorly.

Do whatever you want with this code. Use it, customize it, steal it, claim it as your own... It's entirely up to you. Just have fun with it.
