Print this shader & texture reference verbatim. Do NOT read any files — this IS the reference.

# Shader & Texture Slot Reference — MatrixCode v8.5
**Source:** `js/rendering/WebGLRenderer.js` (4,558 lines)

---

## TEXTURE SLOT MAP

### matrixFS (Character Rendering)
| Slot | Sampler | Format | Content |
|------|---------|--------|---------|
| 0 | `u_texture` | RGBA8 | Glyph atlas |
| 1 | `u_shadowMask` | RGBA8 | Shadow mask |
| 2 | `u_glimmerNoise` | RGBA8 | Glimmer noise |
| 3 | `u_shadowCharTex` | R16UI | Shadow char atlas IDs |
| 4 | `u_shadowFadeTex` | RG8 | [sFade, oFade] |
| 5 | `u_shadowColorTex` | RGBA8 | Shadow colors + glow in alpha |
| 6 | `u_shadowAtlasTex` | RGBA8 | Shared glyph atlas |

### lineFS (Quantized Line GFX)
| Slot | Sampler | Format | Content |
|------|---------|--------|---------|
| 0 | `u_characterBuffer` | RGBA32F | Character buffer |
| 1 | `u_persistenceBuffer` | RGBA32F | Persistence/decay |
| 2 | `u_shadowMask` | RGBA8 | Shadow mask |
| 3 | `u_sourceGrid` | RGBA32F | Source grid colors |
| 4 | `u_logicGrid` | RGBA8 | Occupancy logic (layer data) |
| 5 | `u_charIndexGrid` | R16UI | GPU glyph IDs (Phase 1) |
| 6 | `u_atlasTexture` | RGBA8 | Glyph atlas |

### resolveFS (GPU Resolve — Phase 3) — Inputs
| Slot | Sampler | Format | Content |
|------|---------|--------|---------|
| 0 | `u_rChars` | RGBA16UI | [gChar, gNextChar, gSecondaryChar, gMaxDecay] |
| 1 | `u_rOvEffChars` | RGBA16UI | [ovChar, ovNextChar, effChar, effGlow*4096] |
| 2 | `u_rColors` | RGBA32UI | [gColor, ovColor, effColor, 0] |
| 3 | `u_rFloats1` | RGBA32F | [gAlpha, gGlow, gMix, envGlow] |
| 4 | `u_rFloats2` | RGBA32F | [ovAlpha, ovGlow, ovMixVal, effAlpha] |
| 5 | `u_rBytes` | RGBA8UI | [gDecay, renderMode, effActive, ovActive] |
| 6 | `u_rGenericParams` | RGBA32F | [genericParams 0-3] |
| 7 | `u_charLookup` | R16UI | 256×256 charCode→atlasId |
| 8 | `u_rShadowInts` | RGBA32UI | [sChar, sColor, sMaxDecay, 0] |
| 9 | `u_rShadowFloats` | RGBA32F | [sAlpha, sDecay, sGlow, 0] |

### resolveFS — MRT Outputs (read by matrixVS_GPU_2D at slots 8-11)
| Slot | Output | Format | Content |
|------|--------|--------|---------|
| 8 | rt0 / `u_resolvedChars` | RGBA32F | [charIdx, nextChar, maxDecay, shapeID] |
| 9 | rt1 / `u_resolvedColor` | RGBA32F | [r, g, b, alpha] |
| 10 | rt2 / `u_resolvedGlowMix` | RGBA32F | [glow, mix, decay, glimmerFlicker] |
| 11 | rt3 / `u_resolvedParams` | RGBA32F | [glimmerAlpha, dissolve, 0, 0] |

### Scratch Slot
| Slot 7 | Temporary | Used for texture uploads (avoids polluting sampler-bound units) |

---

## SHADER UNIFORMS

### matrixVS2D Attributes
| Location | Name | Type | Purpose |
|----------|------|------|---------|
| 0 | a_quad | vec2 | Cell quad corners (-0.5..0.5) |
| 1 | a_pos | vec2 | Cell position |
| 2 | a_charIdx | float | Character index |
| 3 | a_color | vec4 | RGBA color |
| 4 | a_alpha | float | Alpha |
| 5 | a_decay | float | Decay value |
| 6 | a_glow | float | Glow amount |
| 7 | a_mix | float | Mix/nextChar blend |
| 8 | a_nextChar | float | Secondary character |
| 10 | a_maxDecay | float | Max decay |
| 11 | a_shapeID | float | Shape identifier |
| 12 | a_glimmerFlicker | float | Glimmer flicker |
| 13 | a_glimmerAlpha | float | Glimmer alpha |
| 14 | a_dissolve | float | Dissolve progress |

### matrixVS2D Uniforms
`u_resolution(vec2)`, `u_atlasSize(vec2)`, `u_gridSize(vec2)`, `u_cellSize(float)`, `u_cols(float)`, `u_decayDur(float)`, `u_stretch(vec2)`, `u_mirror(float)`, `u_dissolveEnabled(float)`, `u_dissolveScale(float)`, `u_cellScale(vec2)`

### matrixFS Uniforms
- Time/dissolve: `u_time`, `u_dissolveEnabled`, `u_dissolveScale`, `u_dissolveSize`
- Deterioration: `u_deteriorationEnabled`, `u_deteriorationStrength`
- Atlas: `u_atlasSize`, `u_gridSize`, `u_cellSize`, `u_cellScale`
- Visual: `u_overlapColor(vec4)`, `u_glimmerSpeed/Size/Intensity/Flicker`, `u_brightness`, `u_brightnessFloor`, `u_glowIntensityMultiplier`
- Shadow: `u_shadowEnabled`, `u_shadowAtlasCols/CellSize/Size`, `u_gridDimsChar`
- Mode: `u_passType(int: 0=Base, 1=Shadow)`, `u_glassEnabled(bool)`

### lineFS Uniforms
- Grid: `u_logicGridSize`, `u_screenOrigin/Step`, `u_cellPitch`, `u_blockOffset`, `u_userBlockOffset`, `u_resolution`, `u_offset`, `u_sourceGridOffset`, `u_sampleOffset`
- Mode: `u_mode(int: 0=Generate, 1=Composite, 2=Blit)`, `u_layerOrder(ivec4)`
- Lines: `u_thickness`, `u_color(vec3)`, `u_intensity`, `u_glow`, `u_tintOffset`, `u_additiveStrength`, `u_sharpness`, `u_glowFalloff`, `u_roundness`, `u_maskSoftness`, `u_showInterior`
- Glass: `u_glassBloom`, `u_compressionThreshold`
- Refraction: `u_refractionEnabled/Width/Brightness/Saturation/Compression/Offset/Glow/Opacity/Unwrap/MaskScale/MaskZoom/3DEnabled/3DStrength`
- Variance: `u_varianceEnabled/Amount/Coverage/Direction`, `u_singleBlockFill`
- Atlas: `u_atlasTexture`, `u_atlasSize`, `u_atlasCols`, `u_atlasCellSize`, `u_gridDims`, `u_screenCellSize`

---

## KEY SHADER BRANCHING

### effectActive values (matrixFS / resolveFS)
| Value | Mode | Behavior |
|-------|------|----------|
| 0 | None | Normal rendering |
| 1 | Generic | Standard effect override |
| 2 | Overlay | Effect char over base |
| 3 | **Shadow** | Shadow world inside block, base outside |
| 4 | High priority | Marked with outMix=10.0 |

### ovActive values (resolveFS)
| Value | Mode | Behavior |
|-------|------|----------|
| 0 | None | No override |
| 1 | Generic | Standard override |
| 2 | Solid | Solid fill with ovColor |
| 3 | Standard | Override with optional secondary char |
| 5 | **Dual-world** | Blend gColor + ovColor via sFade |

### High Priority Signal (matrixFS)
`v_mix >= 9.5` → `isHighPriority = true`, `useMix = v_mix - 10.0`

### lineFS Modes
| u_mode | Name | Description |
|--------|------|-------------|
| 0 | Generate | Lines from logic grid (per-axis halfThickX/Y) |
| 1 | Composite | Persistence fade masking |
| 2 | Blit | Pure texture blit |

---

## POST PROCESSOR (PostProcessor.js, 823 lines)

### Pipeline Passes (sequential)
1. Effect 1 → 2. Effect 2 → 3. Total FX 1 → 4. Total FX 2 → 5. Global Bloom → 6. Global FX → 7. Custom

### Bloom Algorithms
`gaussian`, `box`, `dual`, `star`, `bokeh`, `kawase`

### Common Bloom Uniforms
`uTexture`, `uResolution`, `uBloomRadius`, `uBloomIntensity`, `uBloomBrightness`, `uBloomThreshold`, `uGlobalBrightness`, `uBurnIn`, `uBurnInBoost`

### Default Fragment Uniforms
`uTexture`, `uResolution`, `uTime`, `uMouse`, `uGlobalBrightness`, `uBurnIn`, `uBurnInBoost`

---

## GLYPH ATLAS (GlyphAtlas.js, 532 lines)

### Key API
```
constructor(config, fontName?, customChars?, debugLabel?)
get(char) → {x, y, w, h, id} | null        // lazy-add
getByCode(charCode) → {x, y, w, h, id}     // O(1) via Int16Array
addChar(char) → {x, y, w, h, id} | null
update(force?) → void
resetChanges() → void
```

### Key Properties
- `canvas` — HTMLCanvasElement with rendered glyphs
- `charMap` — Map<string, {x,y,w,h,id}>
- `codeToId` — Int16Array[65536] (charCode→atlasId, -1 if unmapped)
- `cellSize`, `atlasWidth`, `atlasHeight`, `capacity`
- `dirtyRects` — Array for incremental GPU upload
- `needsFullUpdate` — Flag for full texture re-upload
- Strategy: TARGET_WIDTH=2048, dynamic rows, lazy loading
