Print this core system API reference verbatim. Do NOT read any files — this IS the reference.

# Core System APIs — MatrixCode v8.5

---

## MatrixKernel (`js/core/MatrixKernel.js`, 1,027 lines)

### Init Order
1. `_initializeManagers()` — Config, Notifications, Dual Worlds, EffectRegistry
2. `_initializeEffects()` — Auto-register from ConfigTemplate
3. Frame vars: frame=0, timestep=1000/60, accumulator
4. Setup: idle detection, resize, input, tap-to-spawn, FPS buffer, config subscriptions

### Properties
- `activeWorldIndex`, `worlds[{grid, sim}]`, `grid`, `simulation`
- `config`, `effectRegistry`, `renderer`, `fontMgr`, `ui`
- `frame`, `isIdle`, `isEditorWindow`, `fpsDisplayElement`

### Methods
```
async initAsync()                    // Full async startup
swapWorlds()                         // Flip active/inactive world
get activeWorld() → {grid, sim}
get inactiveWorld() → {grid, sim}
_loop(time)                          // Main frame loop
_resize()                            // Handle window resize
_chunkedPreallocate()                // Deterministic preallocation
```

---

## CellGrid (`js/data/CellGrid.js`, 486 lines)

### Methods
```
initialize(cols, rows, buffers)
resize(width, height, buffers)
copyFrom(other)                      // Deep clone
setCell(idx, char, color, alpha, fontIndex)
setCellColor(idx, color)
setCellGlow(idx, glow)               // Also marks ACTIVE
setOverride(idx, charStr, colorUint32, alpha, fontIndex, glow)
clearCell(idx)
```

### Arrays (per cell, indexed by `row * cols + col`)
**Primary:** chars(U16), colors(U32), baseColors(U32), alphas(F32), glows(F32), fontIndices(U8)
**Secondary:** secondaryChars/Colors/Alphas/Glows/FontIndices, mix(F32), renderMode(U8)
**Override:** overrideActive(U8), overrideChars/Colors/Alphas/Glows, overrideMix(F32), overrideNextChars(U16)
**Effect:** effectActive(U8), effectChars/Colors/Alphas/Glows/FontIndices
**Sim:** types(U8), decays(U8), maxDecays(U16), ages(I32), brightness(F32), streamSeeds(U8)
**Aux:** cellLocks(U8), genericParams(F32×4), nextChars(U16), activeFlag(U8), activeIndices(Set)

---

## SimulationSystem (`js/simulation/SimulationSystem.js`, 813 lines)

### Properties
- `useWorker` (SharedArrayBuffer available), `worker`, `workerBuffers`
- `streamManager`, `glowSystem`, `glowBlocksSystem`, `timeScale`

### Methods
```
update(frame)                        // Main simulation step
reset()                              // Clear state
_initWorker()                        // Setup SAB worker
_createSharedBuffers(total)
```

---

## StreamManager (`js/simulation/StreamManager.js`, 772 lines)

### Properties
- `activeStreams`, `lastStreamInColumn[]`, `lastEraserInColumn[]`
- `columnSpeeds(F32)`, `streamsPerColumn(I16)`, `_glimmerColCounts(U8)`
- `modes: { StandardMode, StarPowerMode, RainbowMode }`

### Methods
```
update(frame, timeScale)
spawn(x, y, params)
purge()
cloneState(other)
resize(cols)
```

---

## WebGLRenderer (`js/rendering/WebGLRenderer.js`, 4,558 lines)

### Render Pipeline
1. Build instance buffer (CPU loop or GPU resolve)
2. Shadow mask pass
3. Quantized line GFX pass (lineFS: mode0→mode1→mode2)
4. Main matrix pass (matrixFS)
5. PostProcessor

### Key Internal Objects
- `_resolveInputTex[0-6]`, `_resolveOutputTex[0-3]` (GPU Phase 3)
- `charIndexTexture` (R16UI, GPU Phase 1)
- `shadowFadeTexture`, `shadowColorTexture`, `shadowCharIndexTexture` (GPU Phase 2)
- `_sharedAtlasGLTexture` (keyed by currentPalette)
- `_gpuResolvedThisFrame` flag for CPU/GPU fallback

---

## UIManager (`js/ui/UIManager.js`, 2,085 lines)

### Properties
- `c` (config), `effects` (registry), `fonts`, `notifications`
- `charSelector`, `dom` (panel, toggle, tabs, content, tooltip, keyTrap, track)
- `uiSearchQuery`, `defs` (ConfigTemplate definitions)

### Methods
```
init()                               // Initialize events/tabs/components
togglePanel()                        // Show/hide settings
refresh(key, isRecursive)            // Refresh UI for changed config ('ALL' for full)
```

---

## EffectRegistry (`js/effects/EffectRegistry.js`, 435 lines)

### Methods
```
register(effect)                     // Add effect
autoRegister(template)               // Auto-create from ConfigTemplate
trigger(name, force, ...args) → bool // Trigger by name
update()                             // Update all active effects
postUpdate()                         // Post-update cleanup
get(name) → AbstractEffect
getActiveEffects() → []
isQuantizedActive() → bool
requestShaderSlot(effect, source, parameter?) → slot|null  // 4 slots total
releaseShaderSlot(effect)
```

---

## GlyphAtlas (`js/rendering/GlyphAtlas.js`, 532 lines)

### Methods
```
get(char) → {x,y,w,h,id}            // Lazy add + lookup
getByCode(charCode) → {x,y,w,h,id}  // O(1) Int16Array lookup
addChar(char) → {x,y,w,h,id}|null
update(force?) → void
resetChanges() → void
```

### Properties
- `canvas`, `charMap(Map)`, `codeToId(Int16Array[65536])`
- `cellSize`, `atlasWidth`, `atlasHeight`, `capacity`
- `dirtyRects[]` (incremental GPU upload), `needsFullUpdate`

---

## Utils (`js/core/Utils.js`, 268 lines)
```
randomInt(min, max), randomFloat(min, max)
hexToRgb(hex) → {r,g,b}
rgbToHex(r,g,b) → string
clamp(val, min, max)
lerp(a, b, t)
APP_VERSION = "8.5"
```
