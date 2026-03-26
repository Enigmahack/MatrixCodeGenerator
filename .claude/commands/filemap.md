Print this file map reference verbatim. Do NOT read any files — this IS the reference.

# MatrixCode v8.5 — File Map

## js/config/ (3,422 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| ConfigTemplate.js | 755 | `QuantizedInheritableSettings` | UI control definitions, all Quantized effect settings, inheritance |
| ConfigurationManager.js | 2,667 | `class ConfigurationManager` | Global state, localStorage, config slots, subscribers |

## js/core/ (1,295 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| MatrixKernel.js | 1,027 | `class MatrixKernel` | App kernel, frame loop, effect orchestration, resize/input |
| Utils.js | 268 | `const Utils` | Helpers (randomInt, hexToRgb, etc.), APP_VERSION="8.5" |

## js/data/ (489 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| CellGrid.js | 486 | `class CellGrid` | Grid data (primary/secondary worlds), override modes, render modes |
| FontData.js | 3 | Base64 constants | Embedded font data |

## js/effects/ (44,319 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| EffectRegistry.js | 435 | `class EffectRegistry` | Effect registration, shader slot orchestration (4 slots) |
| QuantizedBaseEffect.js | 2,675 | `class QuantizedBaseEffect` | **Base for all Quantized effects** — shared canvases, buffers, animation, shadow world, GPU offloading |
| QuantizedProceduralEngine.js | 3,379 | Mixin methods | Growth pools, behavior pool, block spawning, nudging, strips |
| QuantizedSequenceGeneratorV2.js | 2,137 | `class QuantizedSequenceGeneratorV2` | Headless animation generator for Block Generator v2 |
| QuantizedPatterns.js | 30,435 | `window.matrixPatterns` | **HUGE** — Pre-computed animation sequences (never read fully) |
| QuantizedSequence.js | 413 | `class QuantizedSequence` | Command-based animation executor (ADD, REM, RECT, SMART, NUDGE, GROUP) |
| QuantizedRenderer.js | 415 | `class QuantizedRenderer` | 2D Canvas renderer, BFS worker, edge batching, distance fields |
| QuantizedShadow.js | 223 | `class QuantizedShadow` | Shadow world fade transitions, ping-pong sync |
| QuantizedZoomEffect.js | 535 | `class QuantizedZoomEffect` | Zoom + strip-based backgrounds |
| QuantizedPulseEffect.js | 60 | `class QuantizedPulseEffect` | Radial pulse animation |
| QuantizedAddEffect.js | 63 | `class QuantizedAddEffect` | Additive block reveal |
| QuantizedClimbEffect.js | 47 | `class QuantizedClimbEffect` | Vertical/directional climb |
| QuantizedRetractEffect.js | 57 | `class QuantizedRetractEffect` | Block retraction/fade |
| QuantizedBlockGeneration.js | 35 | `class QuantizedBlockGeneration` | Procedural block generator wrapper |
| QuantizedBFSWorker.js | 123 | Worker script | Offthread flood-fill & distance field |
| BootEffect.js | 272 | `class BootEffect` | Startup sequence + custom shader |
| PulseEffect.js | 529 | `class PulseEffect` | Classic radial pulse (movie-accurate mode) |
| ClearPulseEffect.js | 341 | `class ClearPulseEffect` | Expanding clear wave |
| CrashEffect.js | 1,076 | `class CrashEffect` | Crash sequence (superman overlay, glitch bars, black sheets) |
| DejaVuEffect.js | 319 | `class DejaVuEffect` | Glitch effects (vertical, double, horizontal) |
| MiniPulseEffect.js | 178 | `class MiniPulseEffect` | Small pulse points |
| SupermanEffect.js | 165 | `class SupermanEffect` | Lightning bolt + afterimages |
| GlowSystem.js | 174 | `class GlowSystem` | Transient radial glow sources |
| GlowBlocksSystem.js | 233 | `class GlowBlocksSystem` | Invisible floating blocks for brightness/color influence |

## js/rendering/ (5,913 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| WebGLRenderer.js | 4,558 | `class WebGLRenderer` | **Core WebGL pipeline** — GLSL shaders, render passes, GPU offloading, texture management |
| PostProcessor.js | 823 | `class PostProcessor` | Multi-pass GLSL post-processing (6 effect passes) |
| GlyphAtlas.js | 532 | `class GlyphAtlas` | Character atlas generation, glyph mapping, font cache |

## js/simulation/ (2,093 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| SimulationSystem.js | 813 | `class SimulationSystem` | Physics simulation, stream management, web worker integration |
| StreamManager.js | 772 | `class StreamManager` | Stream spawning, column tracking, glimmer density, modes |
| StreamModes.js | 64 | Mode classes | Stream behavior modes (Standard, StarPower, etc.) |
| SimulationWorker.js | 444 | Worker script | Off-thread simulation |

## js/ui/ (4,284 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| UIManager.js | 2,085 | `class UIManager` | Panel generation, controls, tabs, config sync |
| QuantizedEffectEditor.js | 2,263 | `class QuantizedEffectEditor` | In-app visual editor for block sequences |
| FontManager.js | 495 | `class FontManager` | Font loading, IndexedDB persistence |
| CharacterSelectorModal.js | 359 | `class CharacterSelectorModal` | Glyph selection modal |
| NotificationManager.js | 80 | `class NotificationManager` | Toast notifications |

## js/tools/ (346 lines)
| File | Lines | Export | Purpose |
|------|-------|--------|---------|
| QuantizedAnimationEncoder.js | 162 | Node CLI script | Animation sequence encoder |
| QuantizedAnimationOptimizer.js | 184 | `class QuantizedAnimationOptimizer` | Sequence redundancy optimizer |

## Other Key Files
| File | Purpose |
|------|---------|
| MatrixCode_v8.5/index.html | Main entry point |
| MatrixCode_v8.5/main.js | Electron entry (multi-display) |
| matrix_builder.py | Build/split/combine utility |
| ProblemList.txt | Current issues tracking |

## Class Hierarchy
```
AbstractEffect
├── QuantizedBaseEffect (+ ProceduralEngine mixin)
│   ├── QuantizedPulseEffect
│   ├── QuantizedAddEffect
│   ├── QuantizedClimbEffect
│   ├── QuantizedRetractEffect
│   ├── QuantizedZoomEffect
│   └── QuantizedBlockGeneration
├── PulseEffect
├── ClearPulseEffect
├── CrashEffect
├── DejaVuEffect
├── MiniPulseEffect
├── BootEffect
└── SupermanEffect
```

**Total: 63,159 lines across 44 JS files**
