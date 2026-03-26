Print this architecture reference verbatim. Do NOT read any files — this IS the reference.

# Architecture Reference — MatrixCode v8.5

---

## System Overview
```
index.html → MatrixKernel (init)
  ├── ConfigurationManager (state + persistence)
  ├── Dual Worlds: worlds[0], worlds[1]
  │   ├── CellGrid (typed arrays: chars, colors, alphas, glows, overrides, effects)
  │   └── SimulationSystem → StreamManager + GlowSystem + GlowBlocksSystem
  ├── EffectRegistry → [all effects]
  ├── WebGLRenderer → PostProcessor
  ├── FontManager → GlyphAtlas
  └── UIManager → QuantizedEffectEditor
```

## Frame Loop
```
requestAnimationFrame → _loop(time)
  1. Accumulator-based fixed timestep (1000/60 ms)
  2. simulation.update(frame) → streams, glows, worker sync
  3. effectRegistry.update() → active effects
  4. renderer.render() → WebGL draw calls → PostProcessor
  5. FPS tracking
```

## Data Flow
```
Config Change → config.set(key, value)
  → notify() → subscribers[]
    → SimulationSystem (worker differential sync)
    → WebGLRenderer (shader uniforms)
    → EffectRegistry (effect params)
    → UIManager (refresh controls)
```

## Dual-World Ping-Pong
```
kernel.worlds[0] = { grid: CellGrid, sim: SimulationSystem }
kernel.worlds[1] = { grid: CellGrid, sim: SimulationSystem }

kernel.activeWorldIndex → current world
kernel.swapWorlds() → flip active/inactive
  - Quantized effects use inactive world for shadow rendering
  - Shadow world runs its own sim independently
```

## Effect Lifecycle
```
EffectRegistry.trigger(name, force, ...args)
  → effect.trigger(force, ...args) → bool
  → effect.update() [each frame while active]
  → effect.applyToGrid(grid) [write overrides to CellGrid]
  → effect.stop() [when done]

Quantized effects additionally:
  → getWebGLRenderState() → uniforms/textures for WebGL
  → getLineGfxValue(key) → line rendering params
  → shadowController.updateShadowSim() → shadow world
```

## Rendering Pipeline
```
WebGLRenderer.render():
  1. Build instance buffer (CPU or GPU resolve)
  2. Shadow mask pass (if Quantized active)
  3. Quantized line GFX pass (lineFS: generate → composite → blit)
  4. Main matrix pass (matrixFS: characters + effects + shadow blend)
  5. PostProcessor pipeline (Effect1 → Effect2 → TotalFX1 → TotalFX2 → Bloom → GlobalFX → Custom)
```

## GPU Offloading (3 Phases)
```
Phase 1 — Glyph Lookup:   _buildCharIndexData() → R16UI texture → lineFS samples atlas directly
Phase 2 — Shadow Blending: Shadow data → 3 textures (fade, color, charIndex) → matrixFS reads GPU-side
Phase 3 — Instance Resolve: resolveFS (MRT shader) → 4 RGBA32F outputs → matrixVS_GPU_2D reads via texelFetch
```

## Override Priority (resolveFS / CPU)
```
PRIORITY 1: effectActive > 0
  3 → Shadow reveal (shadow world inside block)
  2 → Overlay (effect char over base)
  4 → High priority (mix += 10.0 signal)
  1 → Standard effect override

PRIORITY 2: overrideActive > 0
  5 → Dual-world blend (gColor + ovColor via sFade)
  2 → Solid fill
  1/3 → Standard override

FALLBACK: Base grid character
```

## Behavior Pool System
```
registerBehavior(id, fn, options)
  options.type:   'core' → runs every step, all layers
                  'pool' → randomly picked per step
  options.growth: 'edge' → spawns from perimeter (needs outsideMap)
                  'spine' → blocks on X/Y spine only
  options.bias:   'wider' → expands block dimensions on spawn

Per-step: outsideMap computed when SpawnFromPerimeter OR edge-mode behavior is enabled
```

## Key Typed Arrays in CellGrid (per cell)
```
Primary:    chars(Uint16), colors(Uint32), alphas(Float32), glows(Float32), fontIndices(Uint8)
Secondary:  secondaryChars, secondaryColors, secondaryAlphas, secondaryGlows, secondaryFontIndices
Blend:      mix(Float32), renderMode(Uint8)
Override:   overrideActive(Uint8), overrideChars, overrideColors, overrideAlphas, overrideGlows
Effect:     effectActive(Uint8), effectChars, effectColors, effectAlphas, effectGlows
Sim:        types(Uint8), decays(Uint8), maxDecays(Uint16), ages(Int32), brightness(Float32)
Auxiliary:  cellLocks(Uint8), genericParams(Float32, 4 per cell), nextChars, streamSeeds
```

## Config Inheritance
```
quantizedDefault{Suffix} → base default for all effects
{prefix}{Suffix} → per-effect override (e.g., quantizedPulseGlassBloom)
{prefix}OverrideDefaults → toggle: use per-effect or inherit from default

inheritableSuffixes includes: GlassBloom, LineGfxColor, LineGfxPersistence,
  GlassRefractionEnabled/Width/Brightness/Saturation/..., PerimeterEchoEnabled,
  LineGfxBrightnessVarianceCoverage, etc.
```

## Worker Architecture
```
SimulationWorker.js — Off-thread simulation via SharedArrayBuffer
  - Zero-copy: reads/writes same typed arrays as main thread
  - Differential config sync: only changed keys sent
  - Messages: 'resize', 'config'

QuantizedBFSWorker.js — Off-thread flood-fill & distance field
  - computeTrueOutside() → outsideMap
  - computeDistanceField() → distMap
```

## Key Singletons / Globals
```
window.matrix = MatrixKernel instance
window.matrixPatterns = pre-computed animation sequences
QuantizedRenderer.instance (singleton)
QuantizedBaseEffect.sharedRenderer/sharedCanvases/sharedBuffers (static)
```
