# 💻 Matrix Digital Rain Simulation v3.5

A customizable, somewhat performant, canvas-based recreation of the iconic digital rain effect, complete with dynamic effects, variable character decay, and a basic GUI for live configuration.
Yes, it's been over 25 years since this movie came out and there's still some dufus out there trying to get the code looking like the actual screens in the movie. 
No, it's not NEARLY as good, performant, optimized, accurate, detailed, or just plain neato as http://www.thematrixscreensaver.com/ but it's a not bad attempt. 

## ✨ Features

This simulation offers some customizations through an integrated settings panel accessible via the **Settings (Gear) icon** in the top-right corner.

(This is not an exhaustive list of settings and will vary depending on how much I change between iterations.)
### Core Customization

  * **Appearance:** Full control over **Stream Color** and **Tracer Color** (the leading character).
  * **Performance & Flow:** Adjust **Speed** (writing cycle), **Stream Min/Max Length**, and **Decay Fade Speed** to control the persistence and rate of the trails.
  * **Gaps & Holes:** Configure the **Hole Rate** (percentage of black space within a trail) and **Eraser Start Delay**.
  * **Layout:** Fine-tune the grid with controls for **Font Size**, **Horizontal Spacing**, and **Vertical Spacing**.

### Advanced Effects

  * **Variable Brightness:** Toggle and control the **Brightness Variance** to give the characters a more organic, shimmering look.
  * **Rotators:** Enable characters to randomly cycle to a new character over time, with controls for **Chance** and **Speed Factor**.
  * **Inverted Tracers:** A special stream mode where the tracer character *only* appears in the gaps (`Holes`), offering a unique visual style.
  * **Pulse Effect:** A built-in cinematic effect that randomly freezes the screen and triggers an expanding **white pulse** wave. All parameters are configurable, including frequency, delay, and duration.

### Configuration Management

  * **Save Slots:** Quickly **SAVE** and **LOAD** up to five different preset configurations directly in your browser's local storage.
  * **Export/Import:** **Export** your current settings to a JSON file to share with others, and **Import** settings from any compatible file.

-----

## ▶️ How to Run

This project is a single-file application requiring no external dependencies or build steps.

1.  **Download:** Clone the repository or download the `MatrixCode_v3.5.html` file.
2.  **Launch:** Open the file directly in any modern web browser (Chrome, Firefox, Edge, Safari).
3.  **Configure:** Click the **gear icon** in the top-right corner to open the settings panel and begin customizing\!

-----

## 🛠️ Technologies

  * **HTML5** (Structure)
  * **CSS3** (Styling and Panel Layout)
  * **Vanilla JavaScript** (Core Logic, Rendering, and State Management)
  * **Canvas API** (High-performance rendering)

-----

## 📄 License

This project is licensed under... Uhhh... I don't know how this part works. I mean, I didn't really do anything special here except ingest far too much caffiene, 
spend way too much time reading up on Canvas, and depending far too much on Gemini to help me fill in the blanks, poorly. 

Do whatever you want with this code. Use it, customize it, steal it, claim it as your own... It's entirely up to you. Just have fun with it. 

-----
