# 🌐 Matrix Digital Rain Simulation Project Guide

## 📂 Directory Structure Overview

### Core Files
- `matrix_builder.py`: Main tool for splitting/combining modular files
- `README.md`: Project overview and feature documentation
- `.gitignore`: Version control configuration
- `ToDoList.txt`: Pending development tasks

### Version History
- `Historic Versions/`: Contains all previous version artifacts (v3.5 - v8.5+)
- `MatrixCode_v8.5/`: Current working directory structure

## 🧱 Project Overview

This project implements a **digital rain simulation** using WebGL technology, originally inspired by the Matrix movie franchise. It features:
- Multiple visual effects (Pulse, Clear Pulse, Superman, Firewall)
- Custom font support with glyph management
- Modular architecture for easy development and maintenance
- Versioned HTML outputs for different release states
- Web-based interface with responsive design

## 🛠️ Development Workflow

### 🔧 Main Tools
1. **matrix_builder.py** - Handles file splitting/combining:
   ```bash
   python3 matrix_builder.py split <input> <output>
   python3 matrix_builder.py combine <input> <output>
   python3 matrix_builder.py refresh <input>
   ```
2. **Git Version Control** - Used for tracking changes across versions (v3.5 - v8.5+)

### 📁 Directory Structure
```
MatrixCode_v8.5/
├───css/
│   └── style.css
├───js/
│   ├── core/
│   │   ├── Utils.js
│   │   └── MatrixKernel.js
│   ├── config/
│   │   └── ConfigurationManager.js
│   ├── data/
│   │   ├── CellGrid.js
│   │   └── FontData.js
│   ├── simulation/
│   │   ├── StreamModes.js
│   │   ├── SimulationSystem.js
│   │   └── StreamManager.js
│   ├── effects/
│   │   ├── EffectRegistry.js
│   │   ├── PulseEffect.js
│   │   ├── MiniPulseEffect.js
│   │   ├── DejaVuEffect.js
│   │   ├── FirewallEffect.js
│   │   ├── SupermanEffect.js
│   │   ├── ClearPulseEffect.js
│   │   └── BootEffect.js
│   ├── ui/
│   │   ├── UIManager.js
│   │   ├── FontManager.js
│   │   └── CharacterSelectorModal.js
│   └── rendering/
│       ├── WebGLRenderer.js
│       ├── GlyphAtlas.js
│       └── PostProcessor.js
├───shaders/
└───presets/
```

## 📌 Key Files Explained

### `matrix_builder.py`
Handles modular development workflow:
- **split**: Splits monolithic HTML into modular components
- **combine**: Combines modular files back into a single release build
- **refresh**: Updates the development index.html with new scripts

### `README.md`
Contains detailed feature documentation and version history:
- Shows live demo links for different versions
- Documents visual effects and customization options
- Provides project roadmap and release notes

## 🧪 Development Conventions

1. **Version Control**: Use Git to track changes across versions (v3.5 - v8.5+)
2. **File Structure**: Follow the modular architecture for easy maintenance
3. **Font Management**: Use the FontManager for custom font handling
4. **Effect System**: Extend the EffectRegistry for new visual effects
5. **Responsive Design**: Ensure compatibility across devices and screen sizes

## 📚 Additional Resources

- [Live Demo](https://enigmahack.github.io/MatrixCodeGenerator/MatrixCode_v8.4.html)
- [Font Repository](https://github.com/Rezmason/matrix)
- [Project Roadmap](#project-overview)

> Note: This project uses a modular architecture for easier development and maintenance. Always use the matrix_builder.py tool when making changes to the file structure.