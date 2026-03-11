/**
 * ConfigTemplate.js - Definitions for all UI controls and configuration settings.
 */

/**
 * Settings that all Quantized effects share and can inherit from Quantized Defaults.
 * To add a new shared setting, simply add its definition here.
 */
const QuantizedInheritableSettings = [
    { sub: 'General', id: 'LayerPromotionEnabled', type: 'checkbox', label: 'Layer Promotion (3 Steps)', tier: 'basic', description: "After 3 logic steps, Layer 1 blocks move to Layer 0. This makes Layer 1 the active 'discovery' layer while Layer 0 represents the permanent structure.", tags: ['logic', 'foundation'] },
    { sub: 'General', id: 'PerimeterEchoEnabled', type: 'checkbox', label: 'Perimeter Echo', tier: 'basic', description: "When enabled, replicates the external perimeter with a trailing delay.", tags: ['delay', 'echo', 'perimeter'] },
    { sub: 'General', id: 'EchoGfxDelay', type: 'range', label: 'Delay', min: 1, max: 8, step: 1, tier: 'basic', description: "How many steps behind the perimeter the echo follows.", tags: ['delay', 'echo', 'steps'] },
    { sub: 'General', id: 'ShadowWorldFadeSpeed', type: 'range', label: 'Shadow World Fade Rate', min: 0, max: 2, step: 0.1, unit: 's', tier: 'advanced', description: "Fading between current world and shadow world when blocks are added/removed.", tags: ['fade', 'speed', 'transition'] },
    { sub: 'General', id: 'GlassBloom', type: 'range', label: 'Interior Brightness', min: 1.0, max: 5.0, step: 0.1, tier: 'basic', description: "Scales character brightness inside quantized blocks.", tags: ['bright', 'bloom', 'glow'] },
    { sub: 'General', id: 'GlassBloomScaleToSize', type: 'checkbox', label: 'Scale to Effect Size', tier: 'advanced', description: "When enabled, Interior Brightness is at full strength when the effect begins and fades to 1 (flat) as blocks fill in.", tags: ['dynamic', 'scale'] },
    { sub: 'General', id: 'GlassCompressionThreshold', type: 'range', label: 'Compression Threshold', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced', description: "Clamps pixels below this brightness to black. 0 = all levels pass through.", tags: ['black', 'cutoff', 'limit'] },
    
    { sub: 'Line Basics', id: 'LineGfxColor', type: 'color', label: 'Line Tint', tier: 'basic', tags: ['color', 'tint', 'hue'] },
    { sub: 'Line Basics', id: 'LineGfxBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 2.0, step: 0.05, tier: 'basic', description: "Scales the overall brightness of the lines.", tags: ['light', 'luminance'] },
    { sub: 'Line Basics', id: 'LineGfxOpacity', type: 'range', label: 'Opacity', min: 0.0, max: 4.0, step: 0.05, tier: 'basic', description: "Overall opacity of the lines. Values > 1.0 will over-draw for extra punch.", tags: ['alpha', 'transparency'] },
    { sub: 'Line Basics', id: 'LineGfxIntensity', type: 'range', label: 'Intensity', min: 0.01, max: 4.0, step: 0.01, tier: 'advanced', tags: ['strength', 'power'] },
    { sub: 'Line Basics', id: 'LineGfxGlow', type: 'range', label: 'Line Glow', min: 0.0, max: 10.0, step: 0.1, tier: 'basic', description: "Intensity of the soft glow around generated lines.", tags: ['bloom', 'glow', 'blur'] },
    { sub: 'Line Basics', id: 'LineGfxPersistence', type: 'range', label: 'Fade Duration', min: 0, max: 180, step: 1, unit: 'fr', tier: 'advanced', description: "Similar to burn-in, controls how long lines linger.", tags: ['trail', 'fade', 'length'] },
    { sub: 'Line Basics', id: 'LineGfxBrightnessVarianceEnabled', type: 'checkbox', label: 'Enable Brightness Variance', tier: 'advanced', description: "Applies random brightness variations to individual line segments.", tags: ['random', 'flicker', 'variety'] },
    { sub: 'Line Basics', id: 'LineGfxBrightnessVarianceAmount', type: 'range', label: 'Variance Amount', min: 0.0, max: 1.0, step: 0.05, dep: 'LineGfxBrightnessVarianceEnabled', tier: 'advanced', description: "Amount of random brightness reduction applied to lines.", tags: ['random', 'amount'] },
    { sub: 'Line Basics', id: 'LineGfxBrightnessVarianceCoverage', type: 'range', label: 'Variance Coverage', min: 0, max: 100, step: 5, unit: '%', dep: 'LineGfxBrightnessVarianceEnabled', tier: 'advanced', description: "Percentage of rows/columns that will be affected by the variance.", tags: ['random', 'area'] },
    { sub: 'Line Basics', id: 'LineGfxBrightnessVarianceDirection', type: 'range', label: 'Variance Direction', min: 0, max: 2, step: 1, dep: 'LineGfxBrightnessVarianceEnabled', tier: 'advanced', transform: v => ['H', 'Mixed', 'V'][v] ?? 'Mixed', description: "H = horizontal lines only, Mixed = both, V = vertical lines only.", tags: ['direction', 'axis'] },

    { sub: 'Line Advanced', sub_header: 'Natural Refraction', id: 'GlassRefractionEnabled', type: 'checkbox', label: 'Enable Natural Refraction', tier: 'advanced', description: "Adds a light-refraction highlight centered on block edges.", tags: ['glass', 'bend', 'light'] },
    { sub: 'Line Advanced', id: 'GlassRefractionWidth', type: 'range', label: 'Width', min: 0.0, max: 1.0, step: 0.01, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Width of the refraction band as a fraction of cell size.", tags: ['size', 'width'] },
    { sub: 'Line Advanced', id: 'GlassRefractionBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 3.0, step: 0.05, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Brightness of the refraction edge highlight.", tags: ['light', 'bright'] },
    { sub: 'Line Advanced', id: 'GlassRefractionSaturation', type: 'range', label: 'Saturation', min: 0.0, max: 3.0, step: 0.05, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Saturation boost for the refraction edge highlight.", tags: ['color', 'vivid'] },
    { sub: 'Line Advanced', id: 'GlassRefractionCompression', type: 'range', label: 'Strength', min: 0.0, max: 10.0, step: 0.1, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Barrel distortion strength. Pulls the sampled coordinates toward the nearest cell boundary on both axes, simulating the optical bend of a curved glass edge. Stronger values snap tightly to the grid lines.", tags: ['distort', 'warp', 'bend'] },
    { sub: 'Line Advanced', id: 'GlassRefractionOffset', type: 'range', label: 'Offset', min: 0.0, max: 0.5, step: 0.01, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Shifts the peak of the refraction band away from the edge center.", tags: ['shift', 'position'] },
    { sub: 'Line Advanced', id: 'GlassRefractionGlow', type: 'range', label: 'Glow', min: 0.0, max: 2.0, step: 0.05, dep: 'GlassRefractionEnabled', tier: 'advanced', description: "Additive glow emission at the refraction peak.", tags: ['bloom', 'glow'] },

    { sub: 'Line Advanced', sub_header: 'Color & Composition', id: 'LineGfxTintOffset', type: 'range', label: 'Tint offset', min: -1.0, max: 1.0, step: 0.01, tier: 'advanced', description: "Adjusts the hue of the lines to compensate for bloom or layering color shifts.", tags: ['hue', 'tint', 'color'] },
    { sub: 'Line Advanced', id: 'LineGfxSaturation', type: 'range', label: 'Saturation', min: 0.0, max: 2.0, step: 0.05, tier: 'advanced', description: "Boosts color saturation of the lines.", tags: ['vivid', 'color'] },
    { sub: 'Line Advanced', id: 'LineGfxAdditiveStrength', type: 'range', label: 'Additive Strength', min: 0.0, max: 2.0, step: 0.05, tier: 'advanced', description: "Controls how strongly the lines add to the underlying character color.", tags: ['blend', 'mix'] },

    { sub: 'Line Advanced', sub_header: 'Shape & Sharpness', id: 'LineGfxSharpness', type: 'range', label: 'Line Sharpness', min: 0.01, max: 0.2, step: 0.01, tier: 'advanced', description: "Controls the hardness of the line edges.", tags: ['hard', 'soft', 'edges'] },
    { sub: 'Line Advanced', id: 'LineGfxRoundness', type: 'range', label: 'Line Roundness', min: 0.0, max: 1.0, step: 0.05, tier: 'advanced', description: "Applies a circular intensity profile across the line thickness for a rounded look.", tags: ['round', 'smooth', 'shape'] },
    { sub: 'Line Advanced', id: 'LineGfxGlowFalloff', type: 'range', label: 'Glow Falloff', min: 0.5, max: 10.0, step: 0.1, tier: 'advanced', description: "Controls how quickly the glow intensity drops off with distance.", tags: ['bloom', 'fade', 'spread'] },

    { sub: 'Line Advanced', sub_header: 'Sampling & Offset', id: 'LineGfxSampleOffsetX', type: 'range', label: 'Char Sample X Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', description: "Shifts where the line samples character brightness horizontally.", tags: ['shift', 'sample'] },
    { sub: 'Line Advanced', id: 'LineGfxSampleOffsetY', type: 'range', label: 'Char Sample Y Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', description: "Shifts where the line samples character brightness vertically.", tags: ['shift', 'sample'] },
    { sub: 'Line Advanced', id: 'LineGfxMaskSoftness', type: 'range', label: 'Char Mask Softness', min: 0.0, max: 5.0, step: 0.1, tier: 'advanced', description: "Softens the character highlights for a smoother, antialiased look within the lines.", tags: ['blur', 'soft', 'smooth'] },
    { sub: 'Line Advanced', id: 'LineGfxOffsetX', type: 'range', label: 'X Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['position', 'shift'] },
    { sub: 'Line Advanced', id: 'LineGfxOffsetY', type: 'range', label: 'Y Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['position', 'shift'] },

    { sub: 'Line Advanced', id: 'EchoGfxThickness', type: 'range', label: 'Echo Width', min: 0.1, max: 10.0, step: 0.1, tier: 'basic', description: "Width of the echo lines.", tags: ['size', 'width'] },
    { sub: 'Line Advanced', id: 'EchoGfxBrightness', type: 'range', label: 'Echo Brightness', min: 0.0, max: 2.0, step: 0.05, tier: 'basic', description: "Brightness of the echo lines.", tags: ['light', 'bright'] },
    { sub: 'Line Advanced', id: 'EchoGfxOpacity', type: 'range', label: 'Echo Opacity', min: 0.0, max: 4.0, step: 0.05, tier: 'basic', description: "Overall opacity of the echo lines. Values > 1.0 will over-draw for extra punch.", tags: ['alpha', 'transparency'] },
    { sub: 'Line Advanced', id: 'EchoGfxIntensity', type: 'range', label: 'Echo Intensity', min: 0.01, max: 4.0, step: 0.01, tier: 'advanced', tags: ['strength', 'power'] },
    { sub: 'Line Advanced', id: 'EchoGfxColor', type: 'color', label: 'Echo Tint', tier: 'basic', tags: ['color', 'tint', 'hue'] },
    { sub: 'Line Advanced', id: 'EchoGfxSaturation', type: 'range', label: 'Echo Saturation', min: 0.0, max: 2.0, step: 0.05, tier: 'advanced', tags: ['vivid', 'color'] },
    { sub: 'Line Advanced', id: 'EchoGfxGlow', type: 'range', label: 'Echo Glow', min: 0.0, max: 10.0, step: 0.1, tier: 'basic', tags: ['bloom', 'glow', 'blur'] },
    { sub: 'Line Advanced', id: 'EchoGfxSampleOffsetX', type: 'range', label: 'Echo Sample X Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['shift', 'sample'] },
    { sub: 'Line Advanced', id: 'EchoGfxSampleOffsetY', type: 'range', label: 'Echo Sample Y Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['shift', 'sample'] },
    { sub: 'Line Advanced', id: 'EchoGfxOffsetX', type: 'range', label: 'Echo X Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['position', 'shift'] },
    { sub: 'Line Advanced', id: 'EchoGfxOffsetY', type: 'range', label: 'Echo Y Offset', min: -50, max: 50, step: 1, unit: 'px', tier: 'advanced', tags: ['position', 'shift'] },
];

const generateQuantizedEffectSettings = (prefix, label, action) => {
    const effectDep = `activeQuantizedEffect:${prefix}`;
    const settings = [
        { cat: 'Effects', type: 'accordion_subheader', label: 'Options', dep: effectDep },
        { cat: 'Effects', id: prefix + "Enabled", type: 'checkbox', label: 'Enabled', dep: effectDep, tier: 'basic', tags: ['auto', 'on'] },
        { cat: 'Effects', id: prefix + "EnableAnimationCache", type: 'checkbox', label: 'Enable Animation Cache', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', description: "Passively pre-render the animation to be played back instead of generating live. Good for performance. Changes to generation settings flushes the cache, and will be generated live until pre-render is complete.", tags: ['perf', 'cache', 'smooth'] },
        ...(prefix !== 'quantizedGenerateV2' ? [{ cat: 'Effects', id: prefix + "GeneratorTakeover", type: 'checkbox', label: 'Generator Takeover', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', description: "When the animation reaches the last step, the Block Generator (V2) will take over and continue growing the effect procedurally.", tags: ['procedural', 'endless'] }] : []),
        
        { cat: 'Effects', type: 'sub_accordion', label: 'Look Settings', dep: [effectDep, prefix + "Enabled"] },
        { cat: 'Effects', id: prefix + "FrequencySeconds", type: 'range', label: 'Frequency', min: 10, max: 600, step: 5, unit: 's', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', tags: ['timing', 'auto'] },
        { cat: 'Effects', id: prefix + "DurationSeconds", type: 'range', label: 'Duration', min: 1, max: 20, step: 0.1, unit: 's', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', tags: ['timing', 'length'] },
        { cat: 'Effects', id: prefix + "Speed", type: 'range', label: 'Speed', min: 0.1, max: 10.0, step: 0.1, dep: [effectDep, prefix + "Enabled"], tier: 'basic', tags: ['fast', 'slow', 'motion'] },
        { cat: 'Effects', id: prefix + "BlockWidthCells", type: 'range', label: 'Block Width', min: 1, max: 16, step: 1, unit: 'ch', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', tags: ['size', 'width', 'grid'] },
        { cat: 'Effects', id: prefix + "BlockHeightCells", type: 'range', label: 'Block Height', min: 1, max: 16, step: 1, unit: 'ch', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', tags: ['size', 'height', 'grid'] },
        { cat: 'Effects', id: prefix + "BorderIllumination", type: 'range', label: 'Intensity', min: 0, max: 10, step: 0.1, dep: [effectDep, prefix + "Enabled"], tier: 'advanced', tags: ['bright', 'glow'] },
        { cat: 'Effects', id: prefix + "PerimeterThickness", type: 'range', label: 'Line Width', min: 0.1, max: 10.0, step: 0.1, dep: [effectDep, prefix + "Enabled"], description: "10.0 = 1 Character width. 0.1 = ~1 Pixel.", tier: 'basic', tags: ['size', 'width', 'line'] },
        { cat: 'Effects', type: 'end_group' },

        { cat: 'Effects', id: prefix + "OverrideDefaults", type: 'checkbox', label: 'Override Quantized Defaults', dep: [effectDep, prefix + "Enabled"], tier: 'advanced', description: "When enabled, you can customize the individual look of this effect. Otherwise, it will inherit from 'Quantized Defaults'.", tags: ['custom', 'unique'] },
    ];

    // Add inheritable settings as overrides
    let currentSub = '';
    QuantizedInheritableSettings.forEach(s => {
        if (s.sub !== currentSub) {
            if (currentSub !== '') settings.push({ cat: 'Effects', type: 'end_group' });
            settings.push({ cat: 'Effects', type: 'sub_accordion', label: s.sub + ' Override', dep: [effectDep, prefix + "Enabled", prefix + "OverrideDefaults"] });
            currentSub = s.sub;
        }

        if (s.sub_header) {
            settings.push({ cat: 'Effects', type: 'accordion_subheader', label: s.sub_header, dep: [effectDep, prefix + "Enabled", prefix + "OverrideDefaults"] });
        }

        // Clone the setting and update ID and Dependencies
        const override = { ...s };
        override.cat = 'Effects';
        override.id = prefix + s.id;
        
        // Handle dependencies
        const deps = [effectDep, prefix + "Enabled", prefix + "OverrideDefaults"];
        if (s.dep) {
            const sDeps = Array.isArray(s.dep) ? s.dep : [s.dep];
            sDeps.forEach(d => {
                if (d.startsWith('!')) deps.push('!' + prefix + d.substring(1));
                else deps.push(prefix + d);
            });
        }
        override.dep = deps;

        settings.push(override);
    });

    if (currentSub !== '') settings.push({ cat: 'Effects', type: 'end_group' });

    return settings;
};

const ConfigTemplate = [
    // 1. GLOBAL TAB
    { cat: 'Global', type: 'accordion_header', label: 'Code Basics' },
    { cat: 'Global', id: 'backgroundColor', type: 'color', label: 'Background Color', tier: 'basic', tags: ['bg', 'dark', 'black'] },
    { cat: 'Global', id: 'streamPalette', type: 'color_list', label: 'Code Colors', max: 3, tier: 'basic', tags: ['green', 'hue', 'tint'] },
    { cat: 'Global', id: 'paletteBias', type: 'range', label: 'Color Mix', min: 0, max: 1, step: 0.05, tier: 'advanced', transform: v => (v * 100).toFixed(0) + '% Mix', description: "Left: Solid Streams. Right: Random Characters. Middle: Blend.", tags: ['color', 'mix', 'random'] },
    { cat: 'Global', id: 'colorMixType', type: 'range', label: 'Mix Type', min: 0, max: 1, step: 0.05, tier: 'advanced', transform: v => v < 0.3 ? 'Stream Colors' : (v > 0.7 ? 'Character Colors' : 'Mixed'), description: "Controls whether colors are assigned per-stream or per-character.", tags: ['color', 'mode', 'type'] },
    { cat: 'Global', id: 'tracerColor', type: 'color', label: 'Tracer Color', tier: 'advanced', description: "The head of the stream that writes the code to the screen", tags: ['head', 'lead', 'front'] },
    { cat: 'Global', id: 'tracerGlow', type: 'range', label: 'Tracer Glow', min: 0, max: 50, unit: 'px', tier: 'advanced', description: "Determines the glow intensity of the leading tracer characters.", tags: ['head', 'bloom', 'shine'] },
    { cat: 'Global', id: 'brightness', type: 'range', label: 'Overall Brightness', min: 0.1, max: 3.0, step: 0.1, tier: 'basic', transform: v => (v * 100).toFixed(0) + '% Brightness', description: "Boosts the overall luminance of all characters.", tags: ['light', 'luminance', 'intensity'] },
    { cat: 'Global', type: 'accordion_subheader', label: 'Code Style' },
    { cat: 'Global', id: 'fontSize', type: 'range', label: 'Font Size', min: 10, max: 80, step: 1, unit: 'px', tier: 'basic', tags: ['size', 'big', 'small', 'scale'] },
    { cat: 'Global', id: 'streamSpeed', type: 'range', label: 'Flow Speed', min: 4, max: 20, step: 1, tier: 'basic', tags: ['fast', 'slow', 'motion'] },

    { cat: 'Global', type: 'accordion_header', label: 'Rendering Quality' },
    { cat: 'Global', id: 'resolution', type: 'range', label: 'Resolution Scale', min: 0.5, max: 2.0, step: 0.1, tier: 'advanced', transform: v => v + 'x', tags: ['quality', 'sharp', 'pixel'] },
    { cat: 'Global', id: 'smoothingEnabled', type: 'checkbox', label: 'Anti-Aliasing', dep: '!shaderEnabled', tier: 'advanced', description: 'Anti-aliasing is automatically disabled when a custom shader is in use.', tags: ['blur', 'smooth', 'edges'] },
    { cat: 'Global', id: 'smoothingAmount', type: 'range', label: 'Blur Amount', min: 0, max: 2.0, step: 0.1, unit: 'px', dep: ['smoothingEnabled', '!shaderEnabled'], tier: 'advanced', tags: ['blur', 'soft'] },
    { cat: 'Global', id: 'brightnessFloor', type: 'range', label: 'Brightness Floor', min: 0.0, max: 0.5, step: 0.01, tier: 'advanced', description: "The minimum brightness level for all characters. Default is 0.05.", tags: ['dark', 'dim', 'min'] },
    { cat: 'Global', id: 'glowIntensityMultiplier', type: 'range', label: 'Glow Intensity', min: 0.0, max: 1.0, step: 0.05, tier: 'advanced', description: "Controls the strength of the additive glow on characters. Lower values preserve more detail in dense characters.", tags: ['bloom', 'bright', 'detail'] },
    { cat: 'Global', id: 'burnInBoost', type: 'range', label: 'Trail Brightness Boost', min: 0.0, max: 5.0, step: 0.1, tier: 'advanced', description: "Controls the brightness boost applied to trails (phosphor persistence). Default is 2.0.", tags: ['ghost', 'trail', 'bright'] },
    { cat: 'Global', id: 'maxAlpha', type: 'range', label: 'Max Opacity', min: 0.1, max: 1.0, step: 0.01, tier: 'advanced', description: "The maximum alpha (transparency) for characters. Default is 0.99.", tags: ['transparency', 'alpha', 'see-through'] },
    { cat: 'Global', type: 'accordion_subheader', label: 'Quick Presets' },
    { cat: 'Global', id: 'performanceMode', type: 'checkbox', label: 'Performance Mode', description: "Optimizes settings for lower-end hardware. Disables: Bloom, Post-Process, Dissolve, Deterioration, Line Variance, Refraction. Sets 0.75x resolution, pauses when hidden/idle, and reduces spawn rate. All settings are restored when turned off.", tier: 'basic', tags: ['fast', 'lag', 'optimize', 'low', 'performance'] },

    { cat: 'Global', type: 'accordion_header', label: 'Global FX' },
    { cat: 'Global', id: 'clearAlpha', type: 'range', label: 'Burn-In (Phosphor Persistence)', hideValue: true, min: 0.0, max: 1.0, step: 0.01, tier: 'basic', invert: true, description: 'Adjusts the phosphor persistence effect. Higher values leave longer, smeary trails behind moving characters.', tags: ['trail', 'length', 'phosphor', 'smear'] },
    
    { cat: 'Global', type: 'accordion_subheader', label: 'Bloom FX' },
    { cat: 'Global', id: 'globalBloomEnabled', type: 'checkbox', label: 'Enable Bloom', tier: 'basic', tags: ['glow', 'blur', 'light'] },
    { cat: 'Global', id: 'globalBloomType', type: 'select', label: 'Bloom Type', tier: 'advanced', options: [
        { label: 'Gaussian (Fast)', value: 'gaussian' },
        { label: 'Box (Performance)', value: 'box' },
        { label: 'Dual Filtering (High Quality)', value: 'dual' },
        { label: 'Star (Artistic)', value: 'star' },
        { label: 'Bokeh (Cinematic)', value: 'bokeh' },
        { label: 'Kawase (Smooth)', value: 'kawase' }
    ], dep: 'globalBloomEnabled', tags: ['quality', 'style'] },
    { cat: 'Global', id: 'globalBloomBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 2.0, step: 0.05, dep: 'globalBloomEnabled', tier: 'advanced', tags: ['glow', 'intensity'] },
    { cat: 'Global', id: 'globalBloomIntensity', type: 'range', label: 'Intensity', min: 0.0, max: 2.0, step: 0.05, dep: 'globalBloomEnabled', tier: 'advanced', tags: ['glow', 'strength'] },
    { cat: 'Global', id: 'globalBloomWidth', type: 'range', label: 'Bloom Width', min: 1.0, max: 10.0, step: 0.1, dep: 'globalBloomEnabled', tier: 'advanced', tags: ['glow', 'spread', 'size'] },
    { cat: 'Global', id: 'globalBloomThreshold', type: 'range', label: 'Threshold', min: 0.0, max: 1.0, step: 0.01, dep: 'globalBloomEnabled', tier: 'advanced', tags: ['glow', 'limit', 'cutoff'] },

    // 2. APPEARANCE TAB
    { cat: 'Appearance', type: 'accordion_header', label: 'Character Fonts' },
    { cat: 'Appearance', id: 'fontFamily', type: 'select', label: 'Font Family', options: 'fonts', tier: 'basic', tags: ['style', 'text', 'type'] },
    { cat: 'Appearance', type: 'font_list', tier: 'advanced', tags: ['glyphs', 'set'] },
    { cat: 'Appearance', type: 'button', label: 'Manage Character Sets', action: 'manageCharacters', class: 'btn-info', tier: 'advanced', tags: ['glyphs', 'edit'] },
    { cat: 'Appearance', type: 'button', label: 'Import Font File (.ttf/.otf)', action: 'importFont', class: 'btn-info', tier: 'advanced', tags: ['upload', 'custom'] },
    { cat: 'Appearance', id: 'italicEnabled', type: 'checkbox', label: 'Italicize', tier: 'advanced', tags: ['slant', 'style'] },
    { cat: 'Appearance', id: 'mirrorEnabled', type: 'checkbox', label: 'Mirror / Flip Text', tier: 'advanced', tags: ['backward', 'reverse'] },

    { cat: 'Appearance', type: 'accordion_header', label: 'Character Effects' },
    { cat: 'Appearance', type: 'accordion_subheader', label: 'General' },
    { cat: 'Appearance', id: 'variableBrightnessEnabled', type: 'checkbox', label: 'Variable Brightness', tier: 'basic', description: 'Allows for brightness variance when characters are written', tags: ['random', 'flicker'] },
    { cat: 'Appearance', id: 'lockBrightnessToCharacters', type: 'checkbox', label: 'Lock Brightness to Characters', tier: 'advanced', description: 'Lock a brightness to a specific character instead of a character position', dep: 'variableBrightnessEnabled', tags: ['static', 'consistent'] },
    { cat: 'Appearance', id: 'brightnessVariance', type: 'range', label: 'Brightness Variance', min: 0, max: 90, unit: '%', dep: 'variableBrightnessEnabled', tier: 'advanced', tags: ['random', 'amount'] },
    { cat: 'Appearance', id: 'gradualColorStreams', type: 'checkbox', label: 'Gradual Color Streams', tier: 'advanced', description: "Immediately blends tracer color to stream color behind the head, removing tracer glow.", tags: ['smooth', 'fade'] },
    { cat: 'Appearance', id: 'gradualColorStreamsFrequency', type: 'range', label: 'Frequency', min: 1, max: 100, step: 1, unit: '%', dep: 'gradualColorStreams', tier: 'advanced', description: "Probability that a tracer will use the gradual color effect.", tags: ['chance', 'amount'] },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Tracers' },
    { cat: 'Appearance', id: 'tracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 150, unit: 'fr', tier: 'advanced', tags: ['entry', 'start', 'smooth'] },
    { cat: 'Appearance', id: 'tracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 150, unit: 'fr', tier: 'advanced', tags: ['stay', 'pause'] },
    { cat: 'Appearance', id: 'tracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 150, unit: 'fr', tier: 'advanced', tags: ['exit', 'end', 'smooth'] },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Stream Trails' },
    { cat: 'Appearance', id: 'dissolveEnabled', type: 'checkbox', label: 'Dissolving Stream Trails', tier: 'advanced', tags: ['shrink', 'grow', 'particles'] },
    { cat: 'Appearance', id: 'dissolveScalePercent', type: 'range', label: 'Dissolve Scale', min: -100, max: 100, unit: '%', dep: 'dissolveEnabled', tier: 'advanced', description: 'Percentage size change during dissolve. Negative values shrink, positive values grow.', tags: ['size', 'scale'] },
    { cat: 'Appearance', id: 'deteriorationEnabled', type: 'checkbox', label: 'Enable Trail Ghosting', tier: 'advanced', tags: ['artifact', 'lag', 'echo'] },
    { cat: 'Appearance', id: 'deteriorationStrength', type: 'range', label: 'Ghosting Offset', min: 1, max: 10, unit: 'px', dep: 'deteriorationEnabled', tier: 'advanced', tags: ['offset', 'spread'] },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Character Overlap' },
    { cat: 'Appearance', id: 'overlapEnabled', type: 'checkbox', label: 'Enable Overlap', tier: 'advanced', tags: ['stack', 'double', 'depth'] },
    { cat: 'Appearance', id: 'overlapColor', type: 'color', label: 'Overlap Color', dep: 'overlapEnabled', tier: 'advanced', tags: ['stack', 'tint'] },
    { cat: 'Appearance', id: 'overlapDensity', type: 'range', label: 'Overlap Density', min: 0.1, max: 1.0, step: 0.1, dep: 'overlapEnabled', tier: 'advanced', tags: ['amount', 'chance'] },
    { cat: 'Appearance', id: 'overlapTarget', type: 'select', label: 'Overlap Target', options: [{ label: 'Streams Only', value: 'stream' }, { label: 'All Characters', value: 'all' }], dep: 'overlapEnabled', tier: 'advanced', tags: ['mode', 'scope'] },

    { cat: 'Appearance', type: 'accordion_header', label: 'Glimmer Tracers' },
    { cat: 'Appearance', id: 'upwardTracerEnabled', type: 'checkbox', label: 'Glimmer Tracers', tier: 'basic', description: 'Invisible scanners that light up existing code', tags: ['scanner', 'up', 'glint'] },
    { cat: 'Appearance', id: 'upwardTracerChance', type: 'range', label: 'Frequency', min: 0, max: 1.0, step: 0.01, transform: v => (v * 100).toFixed(0) + '%', dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['amount', 'chance'] },
    { cat: 'Appearance', id: 'upwardTracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['smooth', 'start'] },
    { cat: 'Appearance', id: 'upwardTracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['stay', 'pause'] },
    { cat: 'Appearance', id: 'upwardTracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['smooth', 'end'] },
    { cat: 'Appearance', type: 'accordion_subheader', label: 'Movement', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerSpeedMult', type: 'range', label: 'Vertical Climb Speed', min: 0.5, max: 4.0, step: 0.1, transform: v => v + 'x', dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['fast', 'slow', 'motion'] },
    { cat: 'Appearance', id: 'upwardTracerGlimmerSpeed', type: 'range', label: 'Glimmer Blink Speed', min: 0.01, max: 10.0, step: 0.01, dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['blink', 'flash', 'fast'] },
    { cat: 'Appearance', type: 'accordion_subheader', label: 'Glimmer Shape', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerGlimmerSize', type: 'range', label: 'Glimmer Grid Size', min: 2, max: 6, step: 1, dep: 'upwardTracerEnabled', tier: 'advanced', description: "The number of mini blocks that determine the shape of the Glimmer highlighting.", tags: ['area', 'blocks'] },
    { cat: 'Appearance', id: 'upwardTracerGlimmerFill', type: 'range', label: 'Glimmer Fill', min: 2, max: 12, step: 1, dep: 'upwardTracerEnabled', tier: 'advanced', description: "The amount of mini blocks that are lit within the Glimmer Grid.", tags: ['density', 'lit'] },
    { cat: 'Appearance', id: 'upwardTracerGlimmerGlow', type: 'range', label: 'Glimmer Glow', min: 0, max: 50, step: 1, dep: 'upwardTracerEnabled', tier: 'advanced', tags: ['bloom', 'bright'] },
    { cat: 'Appearance', id: 'upwardTracerGlimmerFlicker', type: 'range', label: 'Glimmer Flicker', min: 0.0, max: 1.0, step: 0.05, dep: 'upwardTracerEnabled', transform: v => (v * 100).toFixed(0) + '%', tier: 'advanced', description: "How often Glimmer highlights will flicker on/off, adding to the randomness of the highlighting.", tags: ['glitch', 'random'] },

    { cat: 'Appearance', type: 'accordion_header', label: 'Grid Layout' },
    { cat: 'Appearance', id: 'horizontalSpacingFactor', type: 'range', label: 'Column Gap', min: 0.5, max: 2.0, step: 0.05, tier: 'advanced', tags: ['width', 'spacing', 'density'] },
    { cat: 'Appearance', id: 'verticalSpacingFactor', type: 'range', label: 'Row Gap', min: 0.5, max: 2.0, step: 0.05, tier: 'advanced', tags: ['height', 'spacing', 'density'] },
    { cat: 'Appearance', id: 'stretchX', type: 'range', label: 'View Window Stretch X', min: 0.5, max: 3.0, step: 0.1, tier: 'advanced', tags: ['zoom', 'width'] },
    { cat: 'Appearance', id: 'stretchY', type: 'range', label: 'View Window Stretch Y', min: 0.5, max: 3.0, step: 0.1, tier: 'advanced', tags: ['zoom', 'height'] },

    // 3. BEHAVIOR TAB
    { cat: 'Behavior', type: 'accordion_header', label: 'Streams' },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Timing' },
    { cat: 'Behavior', id: 'releaseInterval', type: 'range', label: 'Event Timer', tier: 'advanced', description: "For synchronized events (like tracer release) this is the interval between events.", min: 1, max: 10, step: 1, tags: ['timing', 'sync'] },
    { cat: 'Behavior', id: 'desyncIntensity', type: 'range', label: 'Tracer Desync', min: 0, max: 1, step: 0.05, tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: "Varies the speed and release timing of tracers. 0% is uniform sync.", tags: ['random', 'timing'] },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Spacing' },
    { cat: 'Behavior', id: 'minStreamGap', type: 'range', label: 'Min Gap Between Streams', min: 2, max: 50, unit: 'px', tier: 'advanced', tags: ['spacing', 'empty'] },
    { cat: 'Behavior', id: 'minEraserGap', type: 'range', label: 'Min Gap Between Erasers', min: 2, max: 50, unit: 'px', tier: 'advanced', tags: ['spacing', 'empty'] },
    { cat: 'Behavior', id: 'minGapTypes', type: 'range', label: 'Min Gap Between Types', min: 1, max: 100, unit: 'px', tier: 'advanced', description: "Minimum space between tracer types, preventing short streams", tags: ['spacing', 'variety'] },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Length' },
    { cat: 'Behavior', id: 'decayFadeDurationFrames', type: 'range', label: 'Stream Fade Out Speed', min: 1, max: 180, unit: 'fr', tier: 'advanced', tags: ['tail', 'fade', 'speed'] },
    { cat: 'Behavior', id: 'trailLengthVarianceEnabled', type: 'checkbox', label: 'Variable Trail Length', tier: 'advanced', tags: ['random', 'variety'] },
    { cat: 'Behavior', id: 'trailLengthVariance', type: 'range', label: 'Length Variance', min: 0, max: 600, unit: 'fr', dep: 'trailLengthVarianceEnabled', tier: 'advanced', description: "Randomizes the length of the trail. Range is between Fade Speed and this value.", tags: ['random', 'range'] },
    { cat: 'Behavior', id: 'streamVisibleLengthScale', type: 'range', label: 'Stream Length Scale', min: 0.8, max: 2.0, step: 0.1, transform: v => v + 'x', tier: 'advanced', description: "Scales the visible length of all code streams.", tags: ['long', 'short', 'scale'] },
    { cat: 'Behavior', id: 'allowTinyStreams', type: 'checkbox', label: 'Allow Tiny Streams', tier: 'advanced', description: "Increases the probability of very short streams spawning.", tags: ['small', 'short', 'dots'] },
    { cat: 'Behavior', id: 'holeRate', type: 'range', label: 'Gaps in Code Stream', min: 0, max: 0.5, step: 0.01, tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'Probability of missing data segments (empty spaces) appearing within a code stream.', tags: ['empty', 'broken', 'segments'] },

    { cat: 'Behavior', type: 'accordion_header', label: 'Tracers' },
    { cat: 'Behavior', id: 'streamSpawnCount', type: 'range', label: 'Tracer Release Count', min: 1, max: 20, step: 1, tier: 'basic', description: "Max number of tracers released per cycle. A tracer is the leading character that 'writes' the stream to the screen.", tags: ['density', 'amount', 'rain'] },
    { cat: 'Behavior', id: 'preferClusters', type: 'checkbox', label: 'Prefer Clusters', tier: 'advanced', description: "Slightly increases the chance of tracers spawning side-by-side.", tags: ['grouping', 'pattern'] },
    { cat: 'Behavior', id: 'tracerStopChance', type: 'range', label: 'Tracer Drop-out', min: 0, max: 10, step: 1, tier: 'advanced', transform: v => v + '%', description: 'Chance for a tracer to randomly stop, leaving a hanging stream.', tags: ['random', 'incomplete'] },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Erasers' },
    { cat: 'Behavior', id: 'eraserSpawnCount', type: 'range', label: 'Eraser Release Count', min: 0, max: 20, step: 1, tier: 'basic', description: "Invisible tracers that erase code streams instead of writing it.", tags: ['cleaning', 'clearing', 'delete'] },
    { cat: 'Behavior', id: 'eraserStopChance', type: 'range', label: 'Eraser Drop-out', min: 0, max: 10, step: 1, tier: 'advanced', transform: v => v + '%', description: 'Chance for an eraser to randomly stop, leaving a hanging stream.', tags: ['random', 'incomplete'] },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Inverted Tracers' },
    { cat: 'Behavior', id: 'invertedTracerEnabled', type: 'checkbox', label: 'Inverted Tracers', tier: 'advanced', description: "Tracers that only write occassional characters", tags: ['sparse', 'dots'] },
    { cat: 'Behavior', id: 'invertedTracerChance', type: 'range', label: 'Inverted Frequency', min: 0.01, max: 0.20, step: 0.01, dep: 'invertedTracerEnabled', tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', tags: ['sparse', 'amount'] },

    { cat: 'Behavior', type: 'accordion_header', label: 'Rotators' },
    { cat: 'Behavior', id: 'rotatorEnabled', type: 'checkbox', label: 'Symbol Rotator', tier: 'basic', tags: ['change', 'motion', 'symbols'] },
    { cat: 'Behavior', id: 'rotatorChance', type: 'range', label: 'Rotator Chance', min: 0, max: 100, step: 1, unit: '%', dep: 'rotatorEnabled', tier: 'advanced', description: "Rotators are characters that change over time. This is the likelyhood that a rotator will be spawned.", tags: ['amount', 'chance'] },
    { cat: 'Behavior', id: 'rotatorSyncToTracer', type: 'checkbox', label: 'Sync to Tracer cycles', dep: 'rotatorEnabled', tier: 'advanced', description: "Lock the rotator change to the cycles that move the tracers", tags: ['timing', 'sync'] },
    { cat: 'Behavior', id: 'rotatorSyncMultiplier', type: 'range', label: 'Sync Divider', min: 0.1, max: 1, step: 0.1, dep: ['rotatorEnabled', 'rotatorSyncToTracer'], tier: 'advanced', transform: v => v + 'x', tags: ['speed', 'timing'] },
    { cat: 'Behavior', id: 'rotatorCycleFactor', type: 'range', label: 'Rotation Speed', min: 1, max: 20, dep: ['rotatorEnabled', '!rotatorSyncToTracer'], tier: 'advanced', tags: ['fast', 'slow'] },
    { cat: 'Behavior', id: 'rotatorCrossfadeFrames', type: 'range', label: 'Crossfade Smoothness', min: 1, max: 9, unit: 'fr', dep: 'rotatorEnabled', tier: 'advanced', tags: ['smooth', 'transition'] },
    { cat: 'Behavior', id: 'rotateDuringFade', type: 'checkbox', label: 'Rotate during fade', dep: 'rotatorEnabled', tier: 'advanced', tags: ['motion'] },
    { cat: 'Behavior', id: 'rotatorDesyncEnabled', type: 'checkbox', label: 'Desynchronize Rotators', dep: 'rotatorEnabled', tier: 'advanced', description: "Allow rotators to rotate at different speeds", tags: ['random', 'variety'] },
    { cat: 'Behavior', id: 'rotatorDesyncVariance', type: 'range', label: 'Desync Variance', min: 0, max: 100, unit: '%', dep: ['rotatorEnabled', 'rotatorDesyncEnabled'], tier: 'advanced', tags: ['random', 'amount'] },
    { cat: 'Behavior', id: 'rotatorRandomSpeedEnabled', type: 'checkbox', label: 'Randomize Rotation Speed', dep: 'rotatorEnabled', tier: 'advanced', description: "Vary the rotation speed randomly throughout the rotator's life cycle.", tags: ['random', 'variety'] },

    // 4. EFFECTS TAB
    { cat: 'Effects', type: 'accordion_header', label: 'Trilogy', startOpen: true },

    { cat: 'Effects', type: 'sub_accordion', label: 'Pulse' },
    { cat: 'Effects', type: 'button', label: 'Trigger Pulse Now', action: 'pulse', class: 'btn-warn', tier: 'basic', tags: ['wave', 'ripple', 'action'] },
    { cat: 'Effects', id: 'pulseEnabled', type: 'checkbox', label: 'Enable Pulses', tier: 'basic', tags: ['wave', 'auto'] },
    { cat: 'Effects', id: 'pulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'pulseEnabled', tier: 'advanced', description: "Enables movie-accurate timing and visuals, disabling custom controls.", tags: ['real', 'original'] },
    { cat: 'Effects', id: 'pulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', tier: 'advanced', transform: v => v === 500 ? 'Random' : v + 's', dep: ['pulseEnabled', '!pulseMovieAccurate'], tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'pulseDelaySeconds', type: 'range', label: 'Delay', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'pulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['timing', 'length'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['light', 'bright'] },
    { cat: 'Effects', id: 'pulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', description: "Honor blank spaces within the code streams.", tags: ['empty', 'gaps'] },
    { cat: 'Effects', id: 'pulseIgnoreTracers', type: 'checkbox', label: 'Preserve Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['light', 'mask'] },
    { cat: 'Effects', id: 'pulseDimming', type: 'range', label: 'Initial Dim Amount', min: 0.0, max: 1.0, step: 0.05, dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['dark', 'dim'] },
    { cat: 'Effects', id: 'pulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', description: "Blend the outer edge (tracer color) to inner edge (code color)", tags: ['color', 'smooth'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit: 'px', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['size', 'thick'] },
    { cat: 'Effects', id: 'pulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['random', 'position'] },
    { cat: 'Effects', id: 'pulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', description: "Start at a full square", tags: ['fast', 'jump'] },
    { cat: 'Effects', id: 'pulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['pulseEnabled', '!pulseMovieAccurate'], tier: 'advanced', tags: ['round', 'ring'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Clear Pulse' },
    { cat: 'Effects', type: 'button', label: 'Trigger Clear Pulse Now', action: 'clearpulse', class: 'btn-warn', tier: 'basic', tags: ['wave', 'reveal', 'action'] },
    { cat: 'Effects', id: 'clearPulseEnabled', type: 'checkbox', label: 'Enable Clear Pulse', tier: 'basic', tags: ['wave', 'reveal', 'auto'] },
    { cat: 'Effects', id: 'clearPulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'clearPulseEnabled', tier: 'advanced', description: "Enables movie-accurate visual artifacts (tearing/lag) without dimming the screen.", tags: ['real', 'original'] },
    { cat: 'Effects', id: 'clearPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', tier: 'advanced', transform: v => v === 500 ? 'Random' : v + 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'clearPulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', tags: ['timing', 'length'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', tags: ['light', 'bright'] },
    { cat: 'Effects', id: 'clearPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', description: "Honor blank spaces within the code streams.", tags: ['empty', 'gaps'] },
    { cat: 'Effects', id: 'clearPulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', description: "Blend the outer edge (tracer color) to inner edge (code color)", tags: ['color', 'smooth'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit: 'px', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', tags: ['size', 'thick'] },
    { cat: 'Effects', id: 'clearPulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', tags: ['random', 'position'] },
    { cat: 'Effects', id: 'clearPulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', description: "Start at a full square", tags: ['fast', 'jump'] },
    { cat: 'Effects', id: 'clearPulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], tier: 'advanced', tags: ['round', 'ring'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Pulse Storm' },
    { cat: 'Effects', type: 'button', label: 'Trigger Pulse Storm Now', action: 'minipulse', class: 'btn-warn', tier: 'basic', tags: ['weather', 'chaos', 'action'] },
    { cat: 'Effects', id: 'miniPulseEnabled', type: 'checkbox', label: 'Enable Storms', tier: 'basic', tags: ['auto', 'chaos'] },
    { cat: 'Effects', id: 'miniPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'miniPulseEnabled', tier: 'advanced', tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'miniPulseDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, unit: 's', dep: 'miniPulseEnabled', tier: 'advanced', tags: ['timing', 'length'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: 'miniPulseEnabled', tier: 'advanced', tags: ['light', 'bright'] },
    { cat: 'Effects', id: 'miniPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: 'miniPulseEnabled', tier: 'advanced', description: "Honor blank spaces within the code streams.", tags: ['empty', 'gaps'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseThickness', type: 'range', label: 'Wave Width', min: 10, max: 150, unit: 'px', dep: 'miniPulseEnabled', tier: 'advanced', tags: ['size', 'thick'] },
    { cat: 'Effects', id: 'miniPulseSpawnChance', type: 'range', label: 'Density', min: 0.01, max: 0.5, step: 0.01, dep: 'miniPulseEnabled', tier: 'advanced', tags: ['amount', 'chance'] },
    { cat: 'Effects', id: 'miniPulseSpeed', type: 'range', label: 'Speed', min: 5, max: 50, dep: 'miniPulseEnabled', tier: 'advanced', tags: ['fast', 'slow'] },
    { cat: 'Effects', id: 'miniPulseSize', type: 'range', label: 'Blast Size Max', min: 50, max: 400, unit: 'px', dep: 'miniPulseEnabled', tier: 'advanced', tags: ['size', 'area'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Deja Vu' },
    { cat: 'Effects', type: 'button', label: 'Trigger Deja Vu Now', action: 'dejavu', class: 'btn-warn', tier: 'basic', tags: ['glitch', 'error', 'action'] },
    { cat: 'Effects', id: 'dejaVuEnabled', type: 'checkbox', label: 'Enable Deja Vu', tier: 'basic', tags: ['auto', 'glitch'] },
    { cat: 'Effects', id: 'dejaVuFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'dejaVuDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, step: 0.1, unit: 's', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['timing', 'length'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuMinRectHeight', type: 'range', label: 'Minimum Thickness', min: 2, max: 5, unit: 'rows', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['size', 'short'] },
    { cat: 'Effects', id: 'dejaVuMaxRectHeight', type: 'range', label: 'Maximum Thickness', min: 6, max: 50, unit: 'rows', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['size', 'tall'] },
    { cat: 'Effects', id: 'dejaVuHoleBrightness', type: 'range', label: 'Intensity', min: 0, max: 1, step: 0.01, dep: 'dejaVuEnabled', tier: 'advanced', tags: ['light', 'bright'] },
    { cat: 'Effects', id: 'dejaVuRandomizeColors', type: 'checkbox', label: 'Enable Color Writing', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['rainbow', 'random'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuIntensity', type: 'range', label: 'Flash Frequency', min: 0.01, max: 0.1, step: 0.01, dep: 'dejaVuEnabled', tier: 'advanced', tags: ['flicker', 'fast'] },
    { cat: 'Effects', id: 'dejaVuBarDurationFrames', type: 'range', label: 'Flash Length', min: 10, max: 60, unit: 'fr', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['timing', 'fast'] },
    { cat: 'Effects', id: 'dejaVuVarianceFrames', type: 'range', label: 'Flash Length Variance', min: 0, max: 120, unit: 'fr', dep: 'dejaVuEnabled', tier: 'advanced', tags: ['random', 'variety'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Superman' },
    { cat: 'Effects', type: 'button', label: 'Trigger Superman', action: 'superman', class: 'btn-warn', tier: 'basic', tags: ['lightning', 'physics', 'action'] },
    { cat: 'Effects', id: 'supermanEnabled', type: 'checkbox', label: 'Enable Superman Effects', tier: 'basic', tags: ['auto', 'lightning'] },
    { cat: 'Effects', id: 'supermanFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'supermanEnabled', tier: 'advanced', tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'supermanDurationSeconds', type: 'range', label: 'Duration', min: 0.5, max: 6.0, step: 0.1, unit: 's', dep: 'supermanEnabled', tier: 'advanced', tags: ['timing', 'length'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanGlow', type: 'range', label: 'Glow amount', min: 1, max: 10, dep: 'supermanEnabled', tier: 'advanced', tags: ['bloom', 'bright'] },
    { cat: 'Effects', id: 'supermanFadeSpeed', type: 'range', label: 'Fade Duration', min: 5, max: 60, dep: 'supermanEnabled', tier: 'advanced', description: 'Higher values mean trails last longer.', tags: ['tail', 'length'] },
    { cat: 'Effects', id: 'supermanBoltThickness', type: 'range', label: 'Bolt Thickness', min: 1, max: 10, step: 1, dep: 'supermanEnabled', tier: 'advanced', tags: ['size', 'width'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanFlickerRate', type: 'range', label: 'Flicker Jitter', min: 1, max: 10, unit: 'fr', dep: 'supermanEnabled', tier: 'advanced', description: 'Lower is faster electricity.', tags: ['fast', 'spark'] },
    { cat: 'Effects', id: 'supermanWidth', type: 'range', label: 'Scatter Height', min: 1, max: 10, dep: 'supermanEnabled', tier: 'advanced', description: 'How vertically erratic the lightning path is.', tags: ['random', 'jitter'] },
    { cat: 'Effects', id: 'supermanSpawnSpeed', type: 'range', label: 'Bolt Speed', min: 10, max: 100, dep: 'supermanEnabled', tier: 'advanced', description: 'Speed from left to right', tags: ['fast', 'motion'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Boot/Crash' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Boot Sequence' },
    { cat: 'Effects', id: 'bootSequenceEnabled', type: 'checkbox', label: 'Start Code with Boot', tier: 'basic', tags: ['intro', 'start'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Boot Now', action: 'boot', class: 'btn-warn', tier: 'basic', tags: ['intro', 'start', 'action'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Sequence' },
    { cat: 'Effects', id: 'crashEnabled', type: 'checkbox', label: 'Enable Crash', tier: 'basic', tags: ['auto', 'error', 'stop'] },
    { cat: 'Effects', id: 'crashFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'crashEnabled', tier: 'advanced', tags: ['timing', 'auto'] },
    { cat: 'Effects', id: 'crashDurationSeconds', type: 'range', label: 'Duration', min: 5, max: 120, step: 5, unit: 's', dep: 'crashEnabled', tier: 'advanced', tags: ['timing', 'length'] },

    { cat: 'Effects', type: 'sub_accordion', label: 'Crash Visuals', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashSheetCount', type: 'range', label: 'Shadowbox Density', min: 0, max: 200, step: 1, dep: 'crashEnabled', tier: 'advanced', tags: ['blocks', 'amount'] },
    { cat: 'Effects', id: 'crashSheetSpeed', type: 'range', label: 'Shadowbox Speed', min: 0.1, max: 3.0, step: 0.1, dep: 'crashEnabled', transform: v => v + 'x', tier: 'advanced', tags: ['fast', 'slow'] },
    { cat: 'Effects', id: 'crashSheetOpacity', type: 'range', label: 'Shadowbox Opacity', min: 0.0, max: 1.0, step: 0.01, dep: 'crashEnabled', tier: 'advanced', tags: ['alpha', 'see-through'] },
    { cat: 'Effects', id: 'crashStationaryChance', type: 'range', label: 'Shadowbox Movement Level', min: 0, max: 100, unit: '%', invert: true, dep: 'crashEnabled', tier: 'advanced', description: "How likely a shadow box is to move when spawned.", tags: ['static', 'motion'] },
    { cat: 'Effects', id: 'crashFlashDelayMin', type: 'range', label: 'Flash Delay Min', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled', tier: 'advanced', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'crashFlashDelayMax', type: 'range', label: 'Flash Delay Max', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled', tier: 'advanced', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'crashEnableSmith', type: 'checkbox', label: 'Infect Characters (Agent Smith)', dep: 'crashEnabled', tier: 'advanced', tags: ['faces', 'agent'] },
    { cat: 'Effects', id: 'crashEnableSuperman', type: 'checkbox', label: 'Simulate Physics (Superman)', dep: 'crashEnabled', tier: 'advanced', tags: ['lightning', 'sparks'] },
    { cat: 'Effects', id: 'crashEnableFlash', type: 'checkbox', label: 'Flash Screen on Crash', dep: 'crashEnabled', tier: 'advanced', tags: ['bright', 'white'] },
    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'button', label: 'Trigger Crash Now', action: 'crash', class: 'btn-warn', tier: 'basic', tags: ['error', 'stop', 'action'] },

    { cat: 'Effects', type: 'accordion_header', label: 'Resurrections', startOpen: true },

    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Pulse',     action: 'quantizedPulse',          class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedPulse',         tier: 'basic', tags: ['quantizedpulse', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Add',       action: 'quantizedAdd',            class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedAdd',           tier: 'basic', tags: ['quantizedadd', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Retract',   action: 'quantizedRetract',        class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedRetract',       tier: 'basic', tags: ['quantizedretract', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Climb',     action: 'quantizedClimb',          class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedClimb',         tier: 'basic', tags: ['quantizedclimb', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Zoom',      action: 'quantizedZoom',           class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedZoom',          tier: 'basic', tags: ['quantizedzoom', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Expansion', action: 'quantizedExpansion',      class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedExpansion',     tier: 'basic', tags: ['quantizedexpansion', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Quantized Crawler',   action: 'quantizedCrawler',        class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedCrawler',       tier: 'basic', tags: ['quantizedcrawler', 'action', 'trigger'] },
    { cat: 'Effects', type: 'button', label: 'Trigger Block Generator',     action: 'QuantizedBlockGenerator', class: 'btn-warn', dep: 'activeQuantizedEffect:quantizedGenerateV2',   tier: 'basic', tags: ['blockgenerator', 'action', 'trigger'] },
    { cat: 'Effects', id: 'activeQuantizedEffect', type: 'select', label: 'Selected Effect', options: [
        { label: 'Quantized Pulse', value: 'quantizedPulse' },
        { label: 'Quantized Add', value: 'quantizedAdd' },
        { label: 'Quantized Retract', value: 'quantizedRetract' },
        { label: 'Quantized Climb', value: 'quantizedClimb' },
        { label: 'Quantized Zoom', value: 'quantizedZoom' },
        { label: 'Quantized Expansion', value: 'quantizedExpansion' },
        { label: 'Quantized Crawler', value: 'quantizedCrawler' },
        { label: 'Block Generator', value: 'quantizedGenerateV2' }
    ], tier: 'basic', tags: ['mode', 'switch', 'type'] },

    ...generateQuantizedEffectSettings('quantizedPulse', 'Quantized Pulse', 'quantizedPulse'),
    ...generateQuantizedEffectSettings('quantizedAdd', 'Quantized Add', 'quantizedAdd'),
    ...generateQuantizedEffectSettings('quantizedRetract', 'Quantized Retract', 'quantizedRetract'),
    ...generateQuantizedEffectSettings('quantizedClimb', 'Quantized Climb', 'quantizedClimb'),
    ...generateQuantizedEffectSettings('quantizedZoom', 'Quantized Zoom', 'quantizedZoom'),
    ...generateQuantizedEffectSettings('quantizedExpansion', 'Quantized Expansion', 'quantizedExpansion'),
    ...generateQuantizedEffectSettings('quantizedCrawler', 'Quantized Crawler', 'quantizedCrawler'),

    ...generateQuantizedEffectSettings('quantizedGenerateV2', 'Quantized Block Generator', 'QuantizedBlockGenerator'),

    { cat: 'Effects', type: 'sub_accordion', label: 'Generation Settings', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2RandomStart', type: 'checkbox', label: 'Random Start Location', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'When enabled, the effect originates at a random point on screen. That point becomes the center for all growth instead of the screen center.', tags: ['random', 'position'] },
    { cat: 'Effects', id: 'quantizedGenerateV2AllowAsymmetry', type: 'checkbox', label: 'Allow Asymmetry', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Allow deferred columns/rows for unpredictable, non-symmetric growth patterns.', tags: ['random', 'chaos'] },
    { cat: 'Effects', id: 'quantizedGenerateV2GenerativeScaling', type: 'checkbox', label: 'Generative Scaling', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Scales the number of growth events per step based on the available opportunities. Prevents overcrowding in dense areas while maintaining growth in sparse areas.', tags: ['scale', 'smart'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpineBoost', type: 'range', label: 'Spine Burst', min: 0, max: 10, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Number of guaranteed-growth ticks for the initial cardinal spine strips before their normal step pattern kicks in. Gives the spines a visible lead over expansion rows/columns.', tags: ['growth', 'start'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SimultaneousSpawns', type: 'range', label: 'Max Actions', min: 1, max: 10, step: 1, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: "The maximum number of growth actions to attempt in a single step.", tags: ['amount', 'fast'] },
    { cat: 'Effects', id: 'quantizedGenerateV2LayerCount', type: 'range', label: 'Layer Count', min: 1, max: 3, step: 1, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: "Number of additional layers to generate (Layer 0 is always base, max 3 additional = 4 total).", tags: ['depth', 'complexity'] },
    { cat: 'Effects', id: 'quantizedGenerateV2QuadrantCount', type: 'select', label: 'Quadrant Restriction', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', options: [{ label: 'All (4 Directions)', value: '4' }, { label: 'Three (3 Directions)', value: '3' }, { label: 'Half (2 Directions)', value: '2' }, { label: 'Single (1 Direction)', value: '1' }], description: 'Limits each layer to a randomly assigned subset of cardinal growth directions assigned at trigger time. Each layer independently receives this many directions. For example, selecting "Half" might assign East+North to Layer 0 and West+South to Layer 1.', tags: ['direction', 'limit'] },
    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'sub_accordion', label: 'Rhythm & Timing', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Intersection Pause', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2IntersectionPause', type: 'checkbox', label: 'Enable', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'When two strips of the same axis reach the same grow count, they may swap to a different step pattern momentarily.', tags: ['pause', 'smart'] },
    { cat: 'Effects', id: 'quantizedGenerateV2IntersectionPauseChance', type: 'range', label: 'Pause Probability', min: 0.0, max: 1.0, step: 0.05, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2IntersectionPause'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', tags: ['chance', 'amount'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Size Scaling', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2FillThreshold', type: 'range', label: 'Scale-Up Threshold', min: 0.05, max: 0.9, step: 0.01, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'Fill ratio at which strips begin using scaled block sizes. Below this threshold all blocks are 1×1.', tags: ['size', 'limit'] },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxBlockScale', type: 'range', label: 'Max Block Scale', min: 1, max: 5, step: 1, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Maximum block dimension along a strip\'s growth axis (aspect-ratio scaled, 1–5 cells).', tags: ['size', 'large'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Inside-Out Expansion', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutEnabled', type: 'checkbox', label: 'Enable', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'After the initial spine strips grow, seed parallel rows and columns at increasing perpendicular distances from both axes (wave 1 = ±1, wave 2 = ±2, etc.).', tags: ['pattern', 'bloom'] },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutDelay', type: 'range', label: 'Start Delay', min: 0, max: 20, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2InsideOutEnabled'], tier: 'advanced', description: 'Number of global steps to wait before the first expansion wave fires. Gives the spine strips time to establish.', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutPeriod', type: 'range', label: 'Wave Speed', min: 1, max: 10, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2InsideOutEnabled'], tier: 'advanced', description: 'Steps between each successive expansion wave. Lower = faster inside-out fill.', tags: ['speed', 'fast'] },
    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'sub_accordion', label: 'Behavior Settings', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', type: 'sortable_list', id: 'quantizedBehaviorPool', label: 'Behavior Pool', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', tags: ['logic', 'stack'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Main Nudge Growth', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeEnabled', type: 'checkbox', label: 'Enabled', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Default enabled state for Main Nudge Growth. Can also be toggled live in the Behavior Pool above.', tags: ['growth', 'lateral'] },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 20, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Number of global steps to wait before nudge strips begin spawning, giving main strips time to establish.', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeChance', type: 'range', label: 'Randomness', min: 0.05, max: 1.0, step: 0.05, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2NudgeEnabled'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'Controls the probability of block addition and retraction in the 3-step cycle.', tags: ['chance', 'amount'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Block Spawner', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2BlockSpawnerEnabled', type: 'checkbox', label: 'Enabled', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'When enabled, spawns 1x1 blocks ahead of existing nudge strips to create connection points.', tags: ['spawn', 'ahead'] },
    { cat: 'Effects', id: 'quantizedGenerateV2BlockSpawnerStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 50, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Global steps to wait before the Block Spawner becomes active.', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2BlockSpawnerRandomness', type: 'range', label: 'Randomness', min: 0.0, max: 1.0, step: 0.05, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2BlockSpawnerEnabled'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'Probability per step that a block will be spawned ahead of a nudge strip.', tags: ['chance', 'random'] },
    { cat: 'Effects', id: 'quantizedGenerateV2BlockSpawnerCount', type: 'range', label: 'Spawn Count', min: 1, max: 10, step: 1, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2BlockSpawnerEnabled'], tier: 'advanced', description: 'Maximum number of anticipatory blocks to attempt to spawn per global step.', tags: ['amount', 'count'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Spreading Nudge', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeEnabled', type: 'checkbox', label: 'Enabled', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'When enabled, periodically performs nudge growth at random locations along the axes.', tags: ['spawn', 'spreader'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeChance', type: 'range', label: 'Growth Chance', min: 0.05, max: 1.0, step: 0.05, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'Probability of block addition and retraction in the 3-step cycle for spreading points.', tags: ['chance', 'amount'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeLockToAxis', type: 'checkbox', label: 'Lock to Axis', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', description: 'Force nudge growth to occur strictly on the X or Y cardinal axes.', tags: ['axis', 'lock'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgePreferCenter', type: 'checkbox', label: 'Prefer Center', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', description: 'Favor nudge growth points closer to the seed origin.', tags: ['center', 'bias'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeRange', type: 'range', label: 'Spreading Range', min: 0.0, max: 1.0, step: 0.05, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', description: 'How far from the center/axis nudge growth can occur.', tags: ['random', 'range'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeSpawnSpeed', type: 'range', label: 'Spawn Speed', min: 1, max: 10, step: 1, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', description: 'Maximum steps of delay between each axial movement. 1 is fastest (every step), 10 is slowest (up to 10 steps delay).', tags: ['timing', 'speed'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeMaxInstances', type: 'range', label: 'Max Instances', min: 4, max: 100, step: 4, dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', description: 'Maximum number of perpendicular nudge strips allowed at once.', tags: ['limit', 'density'] },
    { cat: 'Effects', id: 'quantizedGenerateV2SpreadingNudgeSymmetry', type: 'checkbox', label: 'Prefer Symmetry', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2SpreadingNudgeEnabled'], tier: 'advanced', description: 'Attempt to perform matching nudge growth on the opposite side of the axis.', tags: ['symmetry', 'mirror'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Flood Fill', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2FloodFillEnabled', type: 'checkbox', label: 'Enabled', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Periodically extends the layer 1 block extent by one full row or column in a random direction.', tags: ['fill', 'expand'] },
    { cat: 'Effects', id: 'quantizedGenerateV2FloodFillStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2FloodFillEnabled'], tier: 'advanced', description: 'Steps to wait before the first flood fill fires.', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2FloodFillRate', type: 'range', label: 'Fill Rate', min: 1, max: 20, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2FloodFillEnabled'], tier: 'advanced', description: 'How many steps between each fill. Lower values fill faster.', tags: ['speed', 'rate'] },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Shove Fill', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'] },
    { cat: 'Effects', id: 'quantizedGenerateV2ShoveFillEnabled', type: 'checkbox', label: 'Enabled', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2Enabled'], tier: 'advanced', description: 'Shoots 1–3 cell wide strips outward from the spawn center in selected quadrant directions, backfilling behind each step. Stops at the canvas perimeter. Respects Quadrant Restriction and Allow Asymmetry.', tags: ['shove', 'push'] },
    { cat: 'Effects', id: 'quantizedGenerateV2ShoveFillStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2ShoveFillEnabled'], tier: 'advanced', description: 'Steps to wait before the first shove fires.', tags: ['timing', 'wait'] },
    { cat: 'Effects', id: 'quantizedGenerateV2ShoveFillRate', type: 'range', label: 'Fill Rate', min: 1, max: 20, step: 1, unit: 'steps', dep: ['activeQuantizedEffect:quantizedGenerateV2', 'quantizedGenerateV2ShoveFillEnabled'], tier: 'advanced', description: 'Steps between each outward advance. Lower values move faster.', tags: ['speed', 'rate'] },

    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Quantized Defaults' },
    ...(() => {
        const defaults = [];
        let currentSub = '';
        const defPrefix = 'quantizedDefault';
        QuantizedInheritableSettings.forEach(s => {
            if (s.sub !== currentSub) {
                if (currentSub !== '') defaults.push({ cat: 'Effects', type: 'end_group' });
                defaults.push({ cat: 'Effects', type: 'sub_accordion', label: s.sub });
                currentSub = s.sub;
            }
            if (s.sub_header) {
                defaults.push({ cat: 'Effects', type: 'accordion_subheader', label: s.sub_header });
            }
            const setting = { ...s };
            setting.cat = 'Effects';
            setting.id = defPrefix + s.id;
            setting.tags = (setting.tags || []).concat(['default', 'global']);
            
            if (s.dep) {
                const deps = Array.isArray(s.dep) ? s.dep : [s.dep];
                setting.dep = deps.map(d => {
                    if (d.startsWith('!')) return '!' + defPrefix + d.substring(1);
                    return defPrefix + d;
                });
            }
            
            // Inherit tier from definition (allows some defaults to be basic)
            setting.tier = s.tier || 'advanced';
            
            defaults.push(setting);
        });
        if (currentSub !== '') defaults.push({ cat: 'Effects', type: 'end_group' });
        return defaults;
    })(),

    { cat: 'Effects', type: 'accordion_header', label: 'Special Effects', startOpen: true },

    { cat: 'Effects', type: 'sub_accordion', label: 'Star Power' },
    { cat: 'Effects', id: 'starPowerEnabled', type: 'checkbox', label: 'Enable Star Power', tier: 'basic', tags: ['sparkle', 'rainbow', 'glimmer'] },
    { cat: 'Effects', id: 'starPowerFreq', type: 'range', label: 'Frequency', min: 5, max: 100, dep: 'starPowerEnabled', tier: 'advanced', unit: '%', tags: ['amount', 'chance'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerRainbowMode', type: 'select', label: 'Color Mode', options: [{ label: 'Full Stream', value: 'stream' }, { label: 'Per Char', value: 'char' }], dep: 'starPowerEnabled', tier: 'advanced', tags: ['color', 'rainbow'] },
    { cat: 'Effects', id: 'starPowerSaturation', type: 'range', label: 'Saturation', min: 0, max: 100, unit: '%', dep: 'starPowerEnabled', tier: 'advanced', tags: ['color', 'vivid'] },
    { cat: 'Effects', id: 'starPowerIntensity', type: 'range', label: 'Intensity', min: 10, max: 90, unit: '%', dep: 'starPowerEnabled', tier: 'advanced', tags: ['light', 'bright'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerColorCycle', type: 'checkbox', label: 'Cycle Colors', dep: 'starPowerEnabled', tier: 'advanced', tags: ['rainbow', 'animate'] },
    { cat: 'Effects', id: 'starPowerCycleSpeed', type: 'range', label: 'Cycle Speed', min: 1, max: 20, dep: 'starPowerEnabled', tier: 'advanced', tags: ['fast', 'slow'] },

    { cat: 'Effects', type: 'end_group' },
    { cat: 'Effects', type: 'sub_accordion', label: 'Rainbow Streams' },
    { cat: 'Effects', id: 'rainbowStreamEnabled', type: 'checkbox', label: 'Enable Rainbow Streams', tier: 'basic', tags: ['color', 'prismatic'] },
    { cat: 'Effects', id: 'rainbowStreamChance', type: 'range', label: 'Frequency', min: 0.05, max: 1.0, step: 0.05, dep: 'rainbowStreamEnabled', tier: 'advanced', transform: v => (v * 100).toFixed(0) + '%', tags: ['chance', 'amount'] },
    { cat: 'Effects', id: 'rainbowStreamIntensity', type: 'range', label: 'Brightness', min: 10, max: 90, unit: '%', dep: 'rainbowStreamEnabled', tier: 'advanced', tags: ['light', 'bright'] },

    { cat: 'Effects', type: 'accordion_header', label: 'Post Processing', startOpen: true },
    { cat: 'Effects', type: 'sub_accordion', label: 'User Shader' },
    { cat: 'Effects', id: 'shaderEnabled', type: 'checkbox', label: 'Enable User Shader', tier: 'basic', tags: ['custom', 'glsl', 'glitch'] },
    { cat: 'Effects', type: 'info_description', id: 'currentShaderNameDisplay', text: 'none' },
    { cat: 'Effects', type: 'button', label: 'Import Fragment Shader (.glsl)', id: 'importShader_effects', action: 'importShader', class: 'btn-info', tier: 'advanced', tags: ['upload', 'code'] },
    { cat: 'Effects', type: 'container', id: 'dynamicShaderControls', dep: 'shaderEnabled' },
    { cat: 'Effects', id: 'shaderParameter', type: 'range', label: 'Global Parameter', min: 0.0, max: 1.0, step: 0.01, dep: 'shaderEnabled', tier: 'advanced', tags: ['amount', 'power'] },
    { cat: 'Effects', type: 'info_description', text: 'Uniforms provided: uTexture (sampler2D), uTime (float), uResolution (vec2), uMouse (vec2), uParameter (float). Output to gl_FragColor.', dep: 'shaderEnabled' },

    // 5. DEBUG TAB
    { cat: 'Debug', type: 'accordion_header', label: 'General' },
    { cat: 'Debug', id: 'showFpsCounter', type: 'checkbox', label: 'Show FPS Counter', tier: 'basic', description: "Displays the current frames-per-second in the top-left corner.", tags: ['stats', 'perf'] },
    { cat: 'Debug', id: 'debugEnabled', type: 'checkbox', label: 'Detailed Performance Stats', dep: 'showFpsCounter', tier: 'advanced', description: "Shows detailed performance logs.", tags: ['stats', 'verbose'] },
    { cat: 'Debug', id: 'simulationPaused', type: 'checkbox', label: 'Pause Code Flow', tier: 'basic', description: "Freezes the falling code animation.", tags: ['stop', 'freeze'] },
    { cat: 'Debug', id: 'logErrors', type: 'checkbox', label: 'Log Errors to Console', tier: 'basic', description: "Allows application errors to be logged to the browser console.", tags: ['dev', 'console'] },
    { cat: 'Debug', id: 'quantEditorEnabled', type: 'checkbox', label: 'QuantEditor', tier: 'advanced', description: "Enable the visual editor for Quantized Pulse Effect.", tags: ['editor', 'visual'] },

    { cat: 'Debug', type: 'accordion_header', label: 'Post Processing', icon: '󰋚', description: 'Pipeline: Effect 1 -> Effect 2 -> Total FX1 -> Total FX2 -> Global FX -> Custom' },
    { cat: 'Debug', type: 'checkbox', label: 'Bypass All Shaders', id: 'postProcessBypassAll', tier: 'advanced', tags: ['clean', 'off'] },
    { cat: 'Debug', type: 'button', label: 'Unload All Shaders', action: 'unloadAllShaders', class: 'btn-danger', tier: 'advanced', tags: ['clear', 'reset'] },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Effect 1' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'effectShader1Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'effectShader1NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (E1)', action: 'importShader_E1', class: 'btn-info', dep: 'effectShader1Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'effect1Parameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Effect 2' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'effectShader2Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'effectShader2NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (E2)', action: 'importShader_E2', class: 'btn-info', dep: 'effectShader2Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'effect2Parameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Total FX1' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'totalFX1Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'totalFX1NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (FX1)', action: 'importShader_FX1', class: 'btn-info', dep: 'totalFX1Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'totalFX1Parameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Total FX2' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'totalFX2Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'totalFX2NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (FX2)', action: 'importShader_FX2', class: 'btn-info', dep: 'totalFX2Enabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'totalFX2Parameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Global FX (Bloom, etc.)' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'globalFXEnabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'globalFXNameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (GLO)', action: 'importShader_GLO', class: 'btn-info', dep: 'globalFXEnabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'globalFXParameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Custom User Shader' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'shaderEnabled_debug', bind: 'shaderEnabled', tier: 'advanced' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'currentShaderNameDisplay_debug', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (CUST)', id: 'importShader_debug', action: 'importShader', class: 'btn-info', dep: 'shaderEnabled', tier: 'advanced' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'shaderParameter_debug', bind: 'shaderParameter', min: 0.0, max: 1.0, step: 0.01, tier: 'advanced' },

    { cat: 'Debug', type: 'accordion_header', label: 'Layers' },
    { cat: 'Debug', id: 'layerEnableBackground', type: 'checkbox', label: 'Enable Background Color', tier: 'advanced', description: 'Draws the black background to clear the previous frame.', tags: ['clear', 'bg'] },
    { cat: 'Debug', id: 'layerEnablePrimaryCode', type: 'checkbox', label: 'Show Primary Code', tier: 'advanced', description: 'The main Matrix rain simulation.', tags: ['main', 'visibility'] },
    { cat: 'Debug', id: 'layerEnableShadowWorld', type: 'checkbox', label: 'Show Shadow World', tier: 'advanced', description: 'The alternate reality revealed by effects.', tags: ['effects', 'visibility'] },
    { cat: 'Debug', id: 'layerEnableQuantizedLines', type: 'checkbox', label: 'Show Quantized Lines', tier: 'advanced', description: 'The yellow/green grid lines from quantized effects.', tags: ['grid', 'lines'] },
    { cat: 'Debug', id: 'layerEnableCanvasLines', type: 'checkbox', label: 'Show Canvas Line Drawing', tier: 'advanced', description: 'The primary line drawing layer for quantized effects.', tags: ['grid', 'lines'] },
    { cat: 'Debug', id: 'layerEnablePerimeterEcho', type: 'checkbox', label: 'Show Perimeter Echo Line Drawing', tier: 'advanced', description: 'The secondary echo line drawing layer.', tags: ['grid', 'lines'] },    { cat: 'Debug', id: 'layerEnableQuantizedGridCache', type: 'checkbox', label: 'Show Quantized Source Grid', tier: 'advanced', description: 'The raw character grid used to generate lines (Sparse Optimization).', tags: ['cache', 'perf'] },    { cat: 'Debug', id: 'quantizedSourceGridOffsetX', type: 'range', label: 'Source Grid X Offset', min: -100, max: 100, step: 1, tier: 'advanced', dep: 'layerEnableQuantizedGridCache' },
    { cat: 'Debug', id: 'quantizedSourceGridOffsetY', type: 'range', label: 'Source Grid Y Offset', min: -100, max: 100, step: 1, tier: 'advanced', dep: 'layerEnableQuantizedGridCache' },
    { cat: 'Debug', id: 'layerEnableEditorGrid', type: 'checkbox', label: 'Show Editor Grid', tier: 'advanced', description: 'The alignment grid in the Quantized Editor.' },
    { cat: 'Debug', id: 'layerEnableEditorOverlay', type: 'checkbox', label: 'Show Editor Changes', tier: 'advanced', description: 'The green schematic blocks in the Quantized Editor.' },
    { cat: 'Debug', id: 'highlightErasers', type: 'checkbox', label: 'Highlight Erasers', tier: 'advanced', description: "Draws a red border around invisible eraser tracers.", tags: ['see', 'dev'] },
    { cat: 'Debug', id: 'quantizedSolidPerimeter', type: 'checkbox', label: 'Solid Perimeter Lines', tier: 'advanced', description: 'Renders grid lines as solid blocks instead of character-based masks.', tags: ['solid', 'blocks'] },

    // 6. SYSTEM TAB
    { cat: 'System', type: 'accordion_header', label: 'Configuration' },
    { cat: 'System', type: 'slot', idx: 0, id: 'slot_0', tier: 'basic', tags: ['preset', 'save', 'load'] },
    { cat: 'System', type: 'slot', idx: 1, id: 'slot_1', tier: 'basic', tags: ['preset', 'save', 'load'] },
    { cat: 'System', type: 'slot', idx: 2, id: 'slot_2', tier: 'basic', tags: ['preset', 'save', 'load'] },
    { cat: 'System', type: 'slot', idx: 3, id: 'slot_3', tier: 'basic', tags: ['preset', 'save', 'load'] },
    { cat: 'System', type: 'slot', idx: 4, id: 'slot_4', tier: 'basic', tags: ['preset', 'save', 'load'] },
    { cat: 'System', type: 'button', label: 'Export Config (JSON)', action: 'export', class: 'btn-info', tier: 'advanced', tags: ['save', 'file'] },
    { cat: 'System', type: 'button', label: 'Import Config (JSON)', action: 'import', class: 'btn-info', tier: 'advanced', tags: ['load', 'file'] },
    { cat: 'System', id: 'hideMenuIcon', type: 'checkbox', label: 'Hide Settings Icon', tier: 'basic', description: 'Hover your mouse over the top right or press the Toggle UI Panel keybind to show', tags: ['ui', 'clean'] },
    { cat: 'System', id: 'doubleClickToReset', type: 'checkbox', label: 'Double Click to Reset', tier: 'basic', description: 'Double click/tap sliders to reset them to default values.', tags: ['ux', 'short'] },
    { cat: 'System', id: 'suppressToasts', type: 'checkbox', label: 'Suppress Toast Messages', tier: 'advanced', description: 'Disable pop-up notifications at the bottom of the screen.', tags: ['ui', 'quiet'] },
    { cat: 'System', id: 'debugTabEnabled', type: 'checkbox', label: 'Enable Debug Mode', tier: 'advanced', description: "Shows the hidden Debug tab for advanced settings and alignment tools.", tags: ['dev', 'tabs'] },

    { cat: 'System', type: 'accordion_header', label: 'Key Bindings' },
    { cat: 'System', id: 'enableKeybinds', type: 'checkbox', label: 'Enable Keybinds', tier: 'basic', description: 'Master switch for key bindings. When enabled, keybinds will force effects to run even if the effect is disabled in settings.', tags: ['keyboard', 'short'] },
    { cat: 'System', type: 'info_description', text: 'Click a button to assign a new key. Press Backspace or Delete to clear.' },
    { cat: 'System', type: 'keybinder', id: 'BootSequence', label: 'Boot Animation', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'CrashSequence', label: 'Crash Animation', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'BootCrashSequence', label: 'Boot to Crash', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'Pulse', label: 'Pulse', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'ClearPulse', label: 'Clear Pulse', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'MiniPulse', label: 'Pulse Storm', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedPulse', label: 'Quantized Pulse', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedAdd', label: 'Quantized Add', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedRetract', label: 'Quantized Retract', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedClimb', label: 'Quantized Climb', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedZoom', label: 'Quantized Zoom', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedBlockGenerator', label: 'Quantized Block Generator', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'DejaVu', label: 'Deja Vu', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'Superman', label: 'Superman', tier: 'advanced' },
    { cat: 'System', type: 'keybinder', id: 'ToggleUI', label: 'Toggle UI Panel', tier: 'advanced' },

    { cat: 'System', type: 'accordion_header', label: 'System Reset' },
    { cat: 'System', type: 'info_description', text: 'Clears the current font cache, and resets all font entries to default' },
    { cat: 'System', type: 'button', label: 'Clear Font Cache', action: 'clearCache', class: 'btn-warn', tier: 'advanced', tags: ['fix', 'fonts'] },
    { cat: 'System', type: 'header', label: 'CAUTION ZONE' },
    { cat: 'System', type: 'button', label: 'Factory Reset All', action: 'reset', class: 'btn-danger', caution: true, tier: 'advanced', tags: ['clear', 'wipe', 'nuke'] },

    { cat: 'System', type: 'accordion_header', label: 'About' },
    { cat: 'System', type: 'about_content', tier: 'basic' },
    { cat: 'System', type: 'accordion_subheader', label: 'Frequently Asked Questions' },
    { cat: 'System', type: 'faq_item', question: 'What is this?', answer: 'This is a highly customizable Matrix Digital Rain simulation built with HTML5 Canvas and JavaScript.', tier: 'advanced' },
    { cat: 'System', type: 'faq_item', question: 'How do I change the code?', answer: 'Use the settings panel on the right side of the screen to customize various aspects like colors, speeds, and effects.', tier: 'advanced' },
    { cat: 'System', type: 'faq_item', question: 'Can I use my own font?', answer: 'Yes, go to the "Appearance" tab, under "Character Fonts" you can import your own TTF or OTF font file.', tier: 'advanced' },
    { cat: 'System', type: 'faq_item', question: 'Why is it sometimes slow?', answer: 'Performance depends on your device and settings. Try reducing "Resolution Scale" or disabling some effects under the "Effects" tab.', tier: 'advanced' },
    { cat: 'System', type: 'faq_item', question: 'Is this more AI slop?', answer: 'Yes and no. LLM\'s were definitely used to make this, but the person who programmed it is a real person, and much of the code was hand-written, not just \'vibe coded\'. It\'s not perfect, but it\'s being slowly improved.', tier: 'advanced' },
    { cat: 'System', type: 'faq_item', question: 'How do I leave feedback or suggestions on your app?', answer: 'Free to reach out via github! I\'m definitely open to ideas and suggestions.', tier: 'advanced' }
];
