Print this effects API reference verbatim. Do NOT read any files — this IS the reference.

# Effects API Reference — MatrixCode v8.5

## AbstractEffect (base class, in EffectRegistry.js)
```
constructor(g, c, r)  // grid, config, registry
trigger(force=false) → bool
stop() → void
update() → void
applyToGrid(grid) → void
preallocate() → void
getActiveIndices() → Set
```
Properties: `active`, `name`, `enabledKey`, `frequencyKey`, `shaderSlot`

---

## QuantizedBaseEffect (extends AbstractEffect)
**File:** `js/effects/QuantizedBaseEffect.js` (2,675 lines)

### Static Shared Resources
- `sharedRenderer: QuantizedRenderer`
- `sharedCharCache: Map`
- `sharedCanvases: { mask, scratch, gridCache, perimeterMask, lineMask, echo }`
- `sharedBuffers: { renderGrid, logicGrid, shadowRevealGrid, layerGrids[], removalGrids[], ... }`
- `lastGridSeed: number`

### Public Methods
```
trigger(force=false, spawnPosition=null) → bool
stop() → void
update() → void
applyToGrid(grid) → void
getWebGLRenderState() → Object       // returns uniforms/textures for WebGL
getLineGfxValue(key) → number|null
getEchoGfxValue(key) → number|null
getBlockSize() → { w, h }
getConfig(key) → any                 // reads from configPrefix + key
```

### Key Properties
- `configPrefix: string` — used to look up `{prefix}{Key}` config values
- `sequenceManager: QuantizedSequence`
- `shadowController: QuantizedShadow`
- `logicGridW/H: number`
- `activeBlocks: []`, `activeIndices: Set`
- `shadowRevealGrid, layerGrids[], renderGrid: TypedArray`
- `step: number` — incremented each cycle

### Config Key Pattern
Reads `{configPrefix}{Suffix}` where suffix is one of:
`Enabled`, `FrequencySeconds`, `Speed`, `BlockWidthCells`, `BlockHeightCells`,
`ShadowWorldFadeSpeed`, `GlassBloom`, `LineGfxColor`, `LineGfxPersistence`,
`PerimeterEchoEnabled`, `SingleLayerMode`, `LayerCount`, `FadeInFrames`, `FadeFrames`

---

## QuantizedProceduralEngine (mixin for QuantizedBaseEffect)
**File:** `js/effects/QuantizedProceduralEngine.js` (3,379 lines)

### Key Methods
```
_initProceduralState() → void
registerBehavior(id, fn, options) → void
  // options: { enabled, type:'core'|'pool', growth:'edge'|'spine', bias:'wider', label }
_spawnBlock(x, y, w, h, layer, ...) → blockId | -1
_nudgeBlocks() → void
_retractBlocks() → void
computeStructuralIntegrity() → void
```

---

## QuantizedSequence
**File:** `js/effects/QuantizedSequence.js` (413 lines)
```
constructor()
executeStepOps(fx, step, startFrameOverride?) → void
```
**OPS:** `ADD, REM, RECT, SMART, REM_BLOCK, ADD_L, RECT_L, SMART_L, REM_L, NUDGE, NUDGE_ML, GROUP`
**FACES:** `N, S, E, W`

---

## QuantizedSequenceGeneratorV2
**File:** `js/effects/QuantizedSequenceGeneratorV2.js` (2,137 lines)
```
constructor(cols, rows, configState, configPrefix='quantizedGenerateV2')
_init() → void
_getConfig(keySuffix) → any
_getBuffer(key, length, type=Uint8Array) → TypedArray
```

---

## QuantizedRenderer (singleton)
**File:** `js/effects/QuantizedRenderer.js` (415 lines)
```
constructor()
updateMask(fx, w, h, s, d) → void
dispatchBFS(fx) → void
```
Properties: `_bfsWorker`, `_asyncOutsideMap`, `_asyncDistMap`

---

## QuantizedShadow
**File:** `js/effects/QuantizedShadow.js` (223 lines)
```
constructor()
initShadowWorld(fx) → void
initShadowWorldBase(fx) → SimulationSystem
updateShadowSim(fx) → bool
```
Properties: `shadowGrid`, `shadowSim`, `shadowFade: Float32Array`, `oldWorldFade: Float32Array`, `activeIndices: Set`

---

## Simple Quantized Effects (all extend QuantizedBaseEffect)

| Class | File | Lines | configPrefix | Notes |
|-------|------|-------|--------------|-------|
| QuantizedPulseEffect | QuantizedPulseEffect.js | 60 | `"quantizedPulse"` | Radial pulse |
| QuantizedAddEffect | QuantizedAddEffect.js | 63 | `"quantizedAdd"` | Additive reveal |
| QuantizedClimbEffect | QuantizedClimbEffect.js | 47 | `"quantizedClimb"` | Vertical climb |
| QuantizedRetractEffect | QuantizedRetractEffect.js | 57 | `"quantizedRetract"` | Block retraction |
| QuantizedZoomEffect | QuantizedZoomEffect.js | 535 | `"quantizedZoom"` | Zoom + strips |
| QuantizedBlockGeneration | QuantizedBlockGeneration.js | 35 | `"quantizedGenerateV2"` | Procedural gen |

---

## Classic Effects (all extend AbstractEffect)

### PulseEffect (529 lines)
```
trigger(force=false) → bool
stop() → void
update() → void
applyToGrid(grid) → void
```
Config: `pulseEnabled`, `pulseFrequencySeconds`, `pulseDurationSeconds`, `pulseDelaySeconds`, `pulseWidth`, `pulseCircular`, `pulseMovieAccurate`, `pulsePreserveSpaces`, `pulseIgnoreTracers`, `pulseUseTracerGlow`, `pulseDimming`, `pulseBlend`, `pulseRandomPosition`, `pulseInstantStart`, `pulseAspectRatio`
State: `origin`, `radius`, `snap`, `renderData`, `chunks`, `state: 'WAITING'|'EXPANDING'`

### ClearPulseEffect (341 lines)
Same pattern as PulseEffect. Config prefix: `clearPulse*`

### MiniPulseEffect (178 lines)
Config: `miniPulseEnabled`, `miniPulseDurationSeconds`, `miniPulseSpawnChance`, `miniPulseSize`, `miniPulseSpeed`, `miniPulseThickness`, `miniPulsePreserveSpaces`, `miniPulseUseTracerGlow`
State: `pulses: []` — `{ x, y, r, maxR, speed }`

### DejaVuEffect (319 lines)
```
trigger(force=false, durationSeconds=null) → bool
```
Config: `dejaVuEnabled`, `dejaVuDurationSeconds`, `dejaVuIntensity`, `dejaVuMinRectHeight`, `dejaVuMaxRectHeight`, `dejaVuBarDurationFrames`, `dejaVuHoleBrightness`, `dejaVuRandomizeColors`
State: `bars: []`, `map: Uint8Array`, `vertGlitch`, `doubleGlitch`, `horizGlitch`

### SupermanEffect (165 lines)
Config: `supermanEnabled`, `supermanDurationSeconds`, `supermanFadeSpeed`, `supermanSpawnSpeed`, `supermanFlickerRate`, `supermanWidth`, `supermanBoltThickness`, `supermanGlow`
State: `lightningPath: Set`, `afterimages: Map`

### CrashEffect (1,076 lines)
```
trigger() → bool
getOverride(i) → Object|null
```
State: `frame`, `snapshotOverlay: Map`, `supermanState`, `shaderState`, `smithState`, `flashState`, `baseBlackLevel`

### BootEffect (272 lines)
```
trigger() → bool
getOverride(i) → null
```
Config: `shaderEnabled`, `customShader`, `shaderParameter`, `runBothInOrder`
State: `durationSeconds: 3.5`, `startTime`

---

## Support Systems

### GlowSystem (174 lines)
```
add(x, y, radius, intensity, color?, duration?, decayFn?) → void
addRadial(x, y, radius, intensity, color?, duration?, decayFn?) → void
addRect(x, y, w, h, intensity, color?, duration?, decayFn?, falloff?) → void
update() → void
apply() → void
```
`decayFn: 'linear'|'exponential'|'none'`

### GlowBlocksSystem (233 lines)
```
update() → void
apply() → void
```
Config: `glowBlocksEnabled`, `glowBlocksDensity`, `glowBlocksFrequency`, `glowBlocksSpeed`, `glowBlocksFadeRate`, `glowBlocksArea`, `glowBlocksAllowShapes`, `glowBlocksIntensity`, `glowBlocksLuminanceBoost`, `glowBlocksTintInfluence`, `glowBlocksStaticColorEnabled`, `glowBlocksStaticColor`

### EffectRegistry (435 lines)
```
register(effect) → void
autoRegister(template) → void
trigger(name, force=false, ...args) → bool
update() → void
postUpdate() → void
get(name) → AbstractEffect|undefined
getActiveEffects() → AbstractEffect[]
isQuantizedActive() → bool
requestShaderSlot(effect, source, parameter?) → slot|null
releaseShaderSlot(effect) → void
```
Shader Slots: 4 total — `{ id, content, param, enabled, name, owner }`
