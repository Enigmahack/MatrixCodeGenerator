/**
 * ConfigTemplate.js - Definitions for all UI controls and configuration settings.
 */

/**
 * Settings that all Quantized effects share and can inherit from Quantized Defaults.
 * To add a new shared setting, simply add its definition here.
 */
const QuantizedInheritableSettings = [
    { sub: 'General', id: 'ShadowWorldFadeSpeed', type: 'range', label: 'Shadow World Fade Rate', min: 0, max: 2, step: 0.1, unit: 's', description: "Fading between current world and shadow world when blocks are added/removed." },
    { sub: 'General', id: 'GlassBloom', type: 'range', label: 'Interior Brightness', min: 1.0, max: 5.0, step: 0.1, description: "Scales character brightness inside quantized blocks." },
    { sub: 'General', id: 'GlassBloomScaleToSize', type: 'checkbox', label: 'Scale to Effect Size', description: "When enabled, Interior Brightness is at full strength when the effect begins and fades to 1 (flat) as blocks fill in." },
    { sub: 'General', id: 'GlassCompressionThreshold', type: 'range', label: 'Compression Threshold', min: 0.0, max: 1.0, step: 0.01, description: "Clamps pixels below this brightness to black. 0 = all levels pass through." },
    
    { sub: 'Line Basics', id: 'LineGfxColor', type: 'color', label: 'Line Tint' },
    { sub: 'Line Basics', id: 'LineGfxBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 2.0, step: 0.05, description: "Scales the overall brightness of the lines." },
    { sub: 'Line Basics', id: 'LineGfxIntensity', type: 'range', label: 'Intensity', min: 0.01, max: 1.0, step: 0.01 },
    { sub: 'Line Basics', id: 'LineGfxGlow', type: 'range', label: 'Line Glow', min: 0.0, max: 10.0, step: 0.1, description: "Intensity of the soft glow around generated lines." },
    { sub: 'Line Basics', id: 'LineGfxPersistence', type: 'range', label: 'Fade Duration', min: 0, max: 180, step: 1, unit: 'fr', description: "Similar to burn-in, controls how long lines linger." },

    { sub: 'Line Advanced', sub_header: 'Natural Refraction', id: 'GlassRefractionEnabled', type: 'checkbox', label: 'Enable Natural Refraction', description: "Adds a light-refraction highlight centered on block edges." },
    { sub: 'Line Advanced', id: 'GlassRefractionWidth', type: 'range', label: 'Width', min: 0.0, max: 1.0, step: 0.01, dep: 'GlassRefractionEnabled', description: "Width of the refraction band as a fraction of cell size." },
    { sub: 'Line Advanced', id: 'GlassRefractionBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 3.0, step: 0.05, dep: 'GlassRefractionEnabled', description: "Brightness of the refraction edge highlight." },
    { sub: 'Line Advanced', id: 'GlassRefractionSaturation', type: 'range', label: 'Saturation', min: 0.0, max: 3.0, step: 0.05, dep: 'GlassRefractionEnabled', description: "Saturation boost for the refraction edge highlight." },
    { sub: 'Line Advanced', id: 'GlassRefractionCompression', type: 'range', label: 'Strength', min: 0.0, max: 10.0, step: 0.1, dep: 'GlassRefractionEnabled', description: "Barrel distortion strength. Pulls the sampled coordinates toward the nearest cell boundary on both axes, simulating the optical bend of a curved glass edge. Stronger values snap tightly to the grid lines." },
    { sub: 'Line Advanced', id: 'GlassRefractionOffset', type: 'range', label: 'Offset', min: 0.0, max: 0.5, step: 0.01, dep: 'GlassRefractionEnabled', description: "Shifts the peak of the refraction band away from the edge center." },
    { sub: 'Line Advanced', id: 'GlassRefractionGlow', type: 'range', label: 'Glow', min: 0.0, max: 2.0, step: 0.05, dep: 'GlassRefractionEnabled', description: "Additive glow emission at the refraction peak." },

    { sub: 'Line Advanced', sub_header: 'Color & Composition', id: 'LineGfxTintOffset', type: 'range', label: 'Tint offset', min: -1.0, max: 1.0, step: 0.01, description: "Adjusts the hue of the lines to compensate for bloom or layering color shifts." },
    { sub: 'Line Advanced', id: 'LineGfxSaturation', type: 'range', label: 'Saturation', min: 0.0, max: 2.0, step: 0.05, description: "Boosts color saturation of the lines." },
    { sub: 'Line Advanced', id: 'LineGfxAdditiveStrength', type: 'range', label: 'Additive Strength', min: 0.0, max: 2.0, step: 0.05, description: "Controls how strongly the lines add to the underlying character color." },

    { sub: 'Line Advanced', sub_header: 'Shape & Sharpness', id: 'LineGfxSharpness', type: 'range', label: 'Line Sharpness', min: 0.01, max: 0.2, step: 0.01, description: "Controls the hardness of the line edges." },
    { sub: 'Line Advanced', id: 'LineGfxRoundness', type: 'range', label: 'Line Roundness', min: 0.0, max: 1.0, step: 0.05, description: "Applies a circular intensity profile across the line thickness for a rounded look." },
    { sub: 'Line Advanced', id: 'LineGfxGlowFalloff', type: 'range', label: 'Glow Falloff', min: 0.5, max: 10.0, step: 0.1, description: "Controls how quickly the glow intensity drops off with distance." },

    { sub: 'Line Advanced', sub_header: 'Sampling & Offset', id: 'LineGfxSampleOffsetX', type: 'range', label: 'Char Sample X Offset', min: -50, max: 50, step: 1, unit: 'px', description: "Shifts where the line samples character brightness horizontally." },
    { sub: 'Line Advanced', id: 'LineGfxSampleOffsetY', type: 'range', label: 'Char Sample Y Offset', min: -50, max: 50, step: 1, unit: 'px', description: "Shifts where the line samples character brightness vertically." },
    { sub: 'Line Advanced', id: 'LineGfxMaskSoftness', type: 'range', label: 'Char Mask Softness', min: 0.0, max: 5.0, step: 0.1, description: "Softens the character highlights for a smoother, antialiased look within the lines." },
    { sub: 'Line Advanced', id: 'LineGfxOffsetX', type: 'range', label: 'X Offset', min: -50, max: 50, step: 1, unit: 'px' },
    { sub: 'Line Advanced', id: 'LineGfxOffsetY', type: 'range', label: 'Y Offset', min: -50, max: 50, step: 1, unit: 'px' },
];

const generateQuantizedEffectSettings = (prefix, label, action) => {
    const settings = [
        { cat: 'Effects', type: 'accordion_header', label: label },
        { cat: 'Effects', type: 'button', label: "Trigger " + label, action: action, class: 'btn-warn' },
        { cat: 'Effects', id: prefix + "Enabled", type: 'checkbox', label: 'Enabled' },
        { cat: 'Effects', id: prefix + "AutoGenerateRemaining", type: 'checkbox', label: 'Auto generate remaining animation', dep: prefix + "Enabled", description: "When the manual animation is complete but does not fill the screen, allow the Block Generator to take over and finish the animation" },
        
        { cat: 'Effects', type: 'sub_accordion', label: 'Look Settings', dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "FrequencySeconds", type: 'range', label: 'Frequency', min: 10, max: 600, step: 5, unit: 's', dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "DurationSeconds", type: 'range', label: 'Duration', min: 1, max: 20, step: 0.1, unit: 's', dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "Speed", type: 'range', label: 'Speed', min: 0.1, max: 10.0, step: 0.1, dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "BlockWidthCells", type: 'range', label: 'Block Width', min: 1, max: 16, step: 1, unit: 'ch', dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "BlockHeightCells", type: 'range', label: 'Block Height', min: 1, max: 16, step: 1, unit: 'ch', dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "BorderIllumination", type: 'range', label: 'Intensity', min: 0, max: 10, step: 0.1, dep: prefix + "Enabled" },
        { cat: 'Effects', id: prefix + "PerimeterThickness", type: 'range', label: 'Line Width', min: 0.1, max: 10.0, step: 0.1, dep: prefix + "Enabled", description: "10.0 = 1 Character width. 0.1 = ~1 Pixel." },
        { cat: 'Effects', type: 'end_group' },

        { cat: 'Effects', id: prefix + "OverrideDefaults", type: 'checkbox', label: 'Override Quantized Defaults', dep: prefix + "Enabled", description: "When enabled, you can customize the individual look of this effect. Otherwise, it will inherit from 'Quantized Defaults'." },
    ];

    // Add inheritable settings as overrides
    let currentSub = '';
    QuantizedInheritableSettings.forEach(s => {
        if (s.sub !== currentSub) {
            if (currentSub !== '') settings.push({ cat: 'Effects', type: 'end_group' });
            settings.push({ cat: 'Effects', type: 'sub_accordion', label: s.sub + ' Override', dep: [prefix + "Enabled", prefix + "OverrideDefaults"] });
            currentSub = s.sub;
        }

        if (s.sub_header) {
            settings.push({ cat: 'Effects', type: 'accordion_subheader', label: s.sub_header, dep: [prefix + "Enabled", prefix + "OverrideDefaults"] });
        }

        // Clone the setting and update ID and Dependencies
        const override = { ...s };
        override.cat = 'Effects';
        override.id = prefix + s.id;
        
        // Handle dependencies
        if (s.dep) {
            // Prefix local dependencies (e.g. GlassRefractionEnabled -> quantizedPulseGlassRefractionEnabled)
            const deps = Array.isArray(s.dep) ? s.dep : [s.dep];
            const mappedDeps = deps.map(d => {
                if (d.startsWith('!')) return '!' + prefix + d.substring(1);
                return prefix + d;
            });
            override.dep = [prefix + "Enabled", prefix + "OverrideDefaults", ...mappedDeps];
        } else {
            override.dep = [prefix + "Enabled", prefix + "OverrideDefaults"];
        }

        settings.push(override);
    });

    if (currentSub !== '') settings.push({ cat: 'Effects', type: 'end_group' });

    return settings;
};

const ConfigTemplate = [
    // 1. GLOBAL TAB
    { cat: 'Global', type: 'accordion_header', label: 'Code Basics' },
    { cat: 'Global', id: 'backgroundColor', type: 'color', label: 'Background Color' },
    { cat: 'Global', id: 'streamPalette', type: 'color_list', label: 'Code Colors', max: 3 },
    { cat: 'Global', id: 'paletteBias', type: 'range', label: 'Color Mix', min: 0, max: 1, step: 0.05, transform: v => (v * 100).toFixed(0) + '% Mix', description: "Left: Solid Streams. Right: Random Characters. Middle: Blend." },
    { cat: 'Global', id: 'colorMixType', type: 'range', label: 'Mix Type', min: 0, max: 1, step: 0.05, transform: v => v < 0.3 ? 'Stream Colors' : (v > 0.7 ? 'Character Colors' : 'Mixed'), description: "Controls whether colors are assigned per-stream or per-character." },
    { cat: 'Global', id: 'brightness', type: 'range', label: 'Overall Brightness', min: 0.1, max: 3.0, step: 0.1, transform: v => (v * 100).toFixed(0) + '% Brightness', description: "Boosts the overall luminance of all characters." },
    { cat: 'Global', id: 'tracerColor', type: 'color', label: 'Tracer Color', description: "The head of the stream that writes the code to the screen" },
    { cat: 'Global', id: 'fontSize', type: 'range', label: 'Font Size', min: 10, max: 80, step: 1, unit: 'px' },
    { cat: 'Global', id: 'streamSpeed', type: 'range', label: 'Flow Speed', min: 4, max: 20, step: 1 },
    { cat: 'Global', id: 'performanceMode', type: 'checkbox', label: 'Performance Mode', description: "Optimizes settings for older hardware: Font 24px (min), No Bloom/Post-Process, 0.75x Res, No Smoothing." },

    { cat: 'Global', type: 'accordion_header', label: 'Rendering Quality' },
    { cat: 'Global', id: 'resolution', type: 'range', label: 'Resolution Scale', min: 0.5, max: 2.0, step: 0.1, transform: v => v + 'x' },
    { cat: 'Global', id: 'smoothingEnabled', type: 'checkbox', label: 'Anti-Aliasing', dep: '!shaderEnabled', description: 'Anti-aliasing is automatically disabled when a custom shader is in use.' },
    { cat: 'Global', id: 'smoothingAmount', type: 'range', label: 'Blur Amount', min: 0, max: 2.0, step: 0.1, unit: 'px', dep: ['smoothingEnabled', '!shaderEnabled'] },
    { cat: 'Global', id: 'brightnessFloor', type: 'range', label: 'Brightness Floor', min: 0.0, max: 0.5, step: 0.01, description: "The minimum brightness level for all characters. Default is 0.05." },
    { cat: 'Global', id: 'glowIntensityMultiplier', type: 'range', label: 'Glow Intensity', min: 0.0, max: 1.0, step: 0.05, description: "Controls the strength of the additive glow on characters. Lower values preserve more detail in dense characters." },
    { cat: 'Global', id: 'burnInBoost', type: 'range', label: 'Trail Brightness Boost', min: 0.0, max: 5.0, step: 0.1, description: "Controls the brightness boost applied to trails (phosphor persistence). Default is 2.0." },
    { cat: 'Global', id: 'maxAlpha', type: 'range', label: 'Max Opacity', min: 0.1, max: 1.0, step: 0.01, description: "The maximum alpha (transparency) for characters. Default is 0.99." },

    { cat: 'Global', type: 'accordion_header', label: 'Global FX' },
    { cat: 'Global', id: 'tracerGlow', type: 'range', label: 'Tracer Glow', min: 0, max: 50, unit: 'px', description: "Determines the glow intensity of the leading tracer characters." },
    { cat: 'Global', id: 'clearAlpha', type: 'range', label: 'Burn-In (Phosphor Persistence)', hideValue: true, min: 0.0, max: 1.0, step: 0.01, invert: true, description: 'Adjusts the phosphor persistence effect. Higher values leave longer, smeary trails behind moving characters.' },
    
    { cat: 'Global', type: 'accordion_subheader', label: 'Bloom FX' },
    { cat: 'Global', id: 'globalBloomEnabled', type: 'checkbox', label: 'Enable Bloom' },
    { cat: 'Global', id: 'globalBloomType', type: 'select', label: 'Bloom Type', options: [
        { label: 'Gaussian (Fast)', value: 'gaussian' },
        { label: 'Box (Performance)', value: 'box' },
        { label: 'Dual Filtering (High Quality)', value: 'dual' },
        { label: 'Star (Artistic)', value: 'star' },
        { label: 'Bokeh (Cinematic)', value: 'bokeh' },
        { label: 'Kawase (Smooth)', value: 'kawase' }
    ], dep: 'globalBloomEnabled' },
    { cat: 'Global', id: 'globalBloomBrightness', type: 'range', label: 'Brightness', min: 0.0, max: 2.0, step: 0.05, dep: 'globalBloomEnabled' },
    { cat: 'Global', id: 'globalBloomIntensity', type: 'range', label: 'Intensity', min: 0.0, max: 2.0, step: 0.05, dep: 'globalBloomEnabled' },
    { cat: 'Global', id: 'globalBloomWidth', type: 'range', label: 'Bloom Width', min: 1.0, max: 10.0, step: 0.1, dep: 'globalBloomEnabled' },
    { cat: 'Global', id: 'globalBloomThreshold', type: 'range', label: 'Threshold', min: 0.0, max: 1.0, step: 0.01, dep: 'globalBloomEnabled' },

    // 2. APPEARANCE TAB
    { cat: 'Appearance', type: 'accordion_header', label: 'Character Fonts' },
    { cat: 'Appearance', id: 'fontFamily', type: 'select', label: 'Font Family', options: 'fonts' },
    { cat: 'Appearance', type: 'font_list' },
    { cat: 'Appearance', type: 'button', label: 'Manage Character Sets', action: 'manageCharacters', class: 'btn-info' },
    { cat: 'Appearance', type: 'button', label: 'Import Font File (.ttf/.otf)', action: 'importFont', class: 'btn-info' },
    { cat: 'Appearance', id: 'italicEnabled', type: 'checkbox', label: 'Italicize' },
    { cat: 'Appearance', id: 'mirrorEnabled', type: 'checkbox', label: 'Mirror / Flip Text' },

    { cat: 'Appearance', type: 'accordion_header', label: 'Character Effects' },
    { cat: 'Appearance', type: 'accordion_subheader', label: 'General' },
    { cat: 'Appearance', id: 'variableBrightnessEnabled', type: 'checkbox', label: 'Variable Brightness', description: 'Allows for brightness variance when characters are written' },
    { cat: 'Appearance', id: 'lockBrightnessToCharacters', type: 'checkbox', label: 'Lock Brightness to Characters', description: 'Lock a brightness to a specific character instead of a character position', dep: 'variableBrightnessEnabled' },
    { cat: 'Appearance', id: 'brightnessVariance', type: 'range', label: 'Brightness Variance', min: 0, max: 90, unit: '%', dep: 'variableBrightnessEnabled' },
    { cat: 'Appearance', id: 'gradualColorStreams', type: 'checkbox', label: 'Gradual Color Streams', description: "Immediately blends tracer color to stream color behind the head, removing tracer glow." },
    { cat: 'Appearance', id: 'gradualColorStreamsFrequency', type: 'range', label: 'Frequency', min: 1, max: 100, step: 1, unit: '%', dep: 'gradualColorStreams', description: "Probability that a tracer will use the gradual color effect." },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Tracers' },
    { cat: 'Appearance', id: 'tracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 150, unit: 'fr' },
    { cat: 'Appearance', id: 'tracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 150, unit: 'fr' },
    { cat: 'Appearance', id: 'tracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 150, unit: 'fr' },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Stream Trails' },
    { cat: 'Appearance', id: 'dissolveEnabled', type: 'checkbox', label: 'Dissolving Stream Trails' },
    { cat: 'Appearance', id: 'dissolveScalePercent', type: 'range', label: 'Dissolve Scale', min: -100, max: 100, unit: '%', dep: 'dissolveEnabled', description: 'Percentage size change during dissolve. Negative values shrink, positive values grow.' },
    { cat: 'Appearance', id: 'deteriorationEnabled', type: 'checkbox', label: 'Enable Trail Ghosting' },
    { cat: 'Appearance', id: 'deteriorationStrength', type: 'range', label: 'Ghosting Offset', min: 1, max: 10, unit: 'px', dep: 'deteriorationEnabled' },

    { cat: 'Appearance', type: 'accordion_subheader', label: 'Character Overlap' },
    { cat: 'Appearance', id: 'overlapEnabled', type: 'checkbox', label: 'Enable Overlap' },
    { cat: 'Appearance', id: 'overlapColor', type: 'color', label: 'Overlap Color', dep: 'overlapEnabled' },
    { cat: 'Appearance', id: 'overlapDensity', type: 'range', label: 'Overlap Density', min: 0.1, max: 1.0, step: 0.1, dep: 'overlapEnabled' },
    { cat: 'Appearance', id: 'overlapTarget', type: 'select', label: 'Overlap Target', options: [{ label: 'Streams Only', value: 'stream' }, { label: 'All Characters', value: 'all' }], dep: 'overlapEnabled' },

    { cat: 'Appearance', type: 'accordion_header', label: 'Glimmer Tracers' },
    { cat: 'Appearance', id: 'upwardTracerEnabled', type: 'checkbox', label: 'Glimmer Tracers', description: 'Invisible scanners that light up existing code' },
    { cat: 'Appearance', id: 'upwardTracerChance', type: 'range', label: 'Frequency', min: 0, max: 1.0, step: 0.01, transform: v => (v * 100).toFixed(0) + '%', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerAttackFrames', type: 'range', label: 'Fade In', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerHoldFrames', type: 'range', label: 'Hold', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerReleaseFrames', type: 'range', label: 'Fade Out', min: 0, max: 180, unit: 'fr', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerSpeedMult', type: 'range', label: 'Vertical Climb Speed', min: 0.5, max: 4.0, step: 0.1, transform: v => v + 'x', dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerGlimmerSpeed', type: 'range', label: 'Glimmer Blink Speed', min: 0.01, max: 10.0, step: 0.01, dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerGlimmerSize', type: 'range', label: 'Glimmer Grid Size', min: 2, max: 6, step: 1, dep: 'upwardTracerEnabled', description: "The number of mini blocks that determine the shape of the Glimmer highlighting." },
    { cat: 'Appearance', id: 'upwardTracerGlimmerFill', type: 'range', label: 'Glimmer Fill', min: 2, max: 12, step: 1, dep: 'upwardTracerEnabled', description: "The amount of mini blocks that are lit within the Glimmer Grid." },
    { cat: 'Appearance', id: 'upwardTracerGlimmerGlow', type: 'range', label: 'Glimmer Glow', min: 0, max: 50, step: 1, dep: 'upwardTracerEnabled' },
    { cat: 'Appearance', id: 'upwardTracerGlimmerFlicker', type: 'range', label: 'Glimmer Flicker', min: 0.0, max: 1.0, step: 0.05, dep: 'upwardTracerEnabled', transform: v => (v * 100).toFixed(0) + '%', description: "How often Glimmer highlights will flicker on/off, adding to the randomness of the highlighting." },

    { cat: 'Appearance', type: 'accordion_header', label: 'Grid Layout' },
    { cat: 'Appearance', id: 'horizontalSpacingFactor', type: 'range', label: 'Column Gap', min: 0.5, max: 2.0, step: 0.05 },
    { cat: 'Appearance', id: 'verticalSpacingFactor', type: 'range', label: 'Row Gap', min: 0.5, max: 2.0, step: 0.05 },
    { cat: 'Appearance', id: 'stretchX', type: 'range', label: 'View Window Stretch X', min: 0.5, max: 3.0, step: 0.1 },
    { cat: 'Appearance', id: 'stretchY', type: 'range', label: 'View Window Stretch Y', min: 0.5, max: 3.0, step: 0.1 },

    // 3. BEHAVIOR TAB
    { cat: 'Behavior', type: 'accordion_header', label: 'Streams' },
    { cat: 'Behavior', id: 'releaseInterval', type: 'range', label: 'Event Timer', description: "For synchronized events (like tracer release) this is the interval between events.", min: 1, max: 10, step: 1 },
    { cat: 'Behavior', id: 'desyncIntensity', type: 'range', label: 'Tracer Desync', min: 0, max: 1, step: 0.05, transform: v => (v * 100).toFixed(0) + '%', description: "Varies the speed and release timing of tracers. 0% is uniform sync." },
    { cat: 'Behavior', id: 'minStreamGap', type: 'range', label: 'Min Gap Between Streams', min: 2, max: 50, unit: 'px' },
    { cat: 'Behavior', id: 'minEraserGap', type: 'range', label: 'Min Gap Between Erasers', min: 2, max: 50, unit: 'px' },
    { cat: 'Behavior', id: 'minGapTypes', type: 'range', label: 'Min Gap Between Types', min: 1, max: 100, unit: 'px', description: "Minimum space between tracer types, preventing short streams" },
    { cat: 'Behavior', id: 'decayFadeDurationFrames', type: 'range', label: 'Stream Fade Out Speed', min: 1, max: 180, unit: 'fr' },
    { cat: 'Behavior', id: 'trailLengthVarianceEnabled', type: 'checkbox', label: 'Variable Trail Length' },
    { cat: 'Behavior', id: 'trailLengthVariance', type: 'range', label: 'Length Variance', min: 0, max: 600, unit: 'fr', dep: 'trailLengthVarianceEnabled', description: "Randomizes the length of the trail. Range is between Fade Speed and this value." },
    { cat: 'Behavior', id: 'streamVisibleLengthScale', type: 'range', label: 'Stream Length Scale', min: 0.8, max: 2.0, step: 0.1, transform: v => v + 'x', description: "Scales the visible length of all code streams." },
    { cat: 'Behavior', id: 'allowTinyStreams', type: 'checkbox', label: 'Allow Tiny Streams', description: "Increases the probability of very short streams spawning." },
    { cat: 'Behavior', id: 'holeRate', type: 'range', label: 'Gaps in Code Stream', min: 0, max: 0.5, step: 0.01, transform: v => (v * 100).toFixed(0) + '%', description: 'Probability of missing data segments (empty spaces) appearing within a code stream.' },

    { cat: 'Behavior', type: 'accordion_header', label: 'Tracers' },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Tracers' },
    { cat: 'Behavior', id: 'streamSpawnCount', type: 'range', label: 'Tracer Release Count', min: 1, max: 20, step: 1, description: "Max number of tracers released per cycle. A tracer is the leading character that 'writes' the stream to the screen." },
    { cat: 'Behavior', id: 'preferClusters', type: 'checkbox', label: 'Prefer Clusters', description: "Slightly increases the chance of tracers spawning side-by-side." },
    { cat: 'Behavior', id: 'tracerStopChance', type: 'range', label: 'Tracer Drop-out', min: 0, max: 10, step: 1, transform: v => v + '%', description: 'Chance for a tracer to randomly stop, leaving a hanging stream.' },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Erasers' },
    { cat: 'Behavior', id: 'eraserSpawnCount', type: 'range', label: 'Eraser Release Count', min: 0, max: 20, step: 1, description: "Invisible tracers that erase code streams instead of writing it." },
    { cat: 'Behavior', id: 'eraserStopChance', type: 'range', label: 'Eraser Drop-out', min: 0, max: 10, step: 1, transform: v => v + '%', description: 'Chance for an eraser to randomly stop, leaving a hanging stream.' },
    { cat: 'Behavior', type: 'accordion_subheader', label: 'Inverted Tracers' },
    { cat: 'Behavior', id: 'invertedTracerEnabled', type: 'checkbox', label: 'Inverted Tracers', description: "Tracers that only write occassional characters" },
    { cat: 'Behavior', id: 'invertedTracerChance', type: 'range', label: 'Inverted Frequency', min: 0.01, max: 0.20, step: 0.01, dep: 'invertedTracerEnabled', transform: v => (v * 100).toFixed(0) + '%' },

    { cat: 'Behavior', type: 'accordion_header', label: 'Rotators' },
    { cat: 'Behavior', id: 'rotatorEnabled', type: 'checkbox', label: 'Symbol Rotator' },
    { cat: 'Behavior', id: 'rotatorChance', type: 'range', label: 'Rotator Chance', min: 0, max: 100, step: 1, unit: '%', dep: 'rotatorEnabled', description: "Rotators are characters that change over time. This is the likelyhood that a rotator will be spawned." },
    { cat: 'Behavior', id: 'rotatorSyncToTracer', type: 'checkbox', label: 'Sync to Tracer cycles', dep: 'rotatorEnabled', description: "Lock the rotator change to the cycles that move the tracers" },
    { cat: 'Behavior', id: 'rotatorSyncMultiplier', type: 'range', label: 'Sync Divider', min: 0.1, max: 1, step: 0.1, dep: ['rotatorEnabled', 'rotatorSyncToTracer'], transform: v => v + 'x' },
    { cat: 'Behavior', id: 'rotatorCycleFactor', type: 'range', label: 'Rotation Speed', min: 1, max: 20, dep: ['rotatorEnabled', '!rotatorSyncToTracer'] },
    { cat: 'Behavior', id: 'rotatorCrossfadeFrames', type: 'range', label: 'Crossfade Smoothness', min: 1, max: 9, unit: 'fr', dep: 'rotatorEnabled' },
    { cat: 'Behavior', id: 'rotateDuringFade', type: 'checkbox', label: 'Rotate during fade', dep: 'rotatorEnabled' },
    { cat: 'Behavior', id: 'rotatorDesyncEnabled', type: 'checkbox', label: 'Desynchronize Rotators', dep: 'rotatorEnabled', description: "Allow rotators to rotate at different speeds" },
    { cat: 'Behavior', id: 'rotatorDesyncVariance', type: 'range', label: 'Desync Variance', min: 0, max: 100, unit: '%', dep: ['rotatorEnabled', 'rotatorDesyncEnabled'] },
    { cat: 'Behavior', id: 'rotatorRandomSpeedEnabled', type: 'checkbox', label: 'Randomize Rotation Speed', dep: 'rotatorEnabled', description: "Vary the rotation speed randomly throughout the rotator's life cycle." },

    // 4. EFFECTS TAB
    { cat: 'Effects', type: 'header', label: 'Movie Effects' },
    { cat: 'Effects', type: 'header', label: 'Trilogy' },

    { cat: 'Effects', type: 'accordion_header', label: 'Pulse' },
    { cat: 'Effects', type: 'button', label: 'Trigger Pulse Now', action: 'pulse', class: 'btn-warn' },
    { cat: 'Effects', id: 'pulseEnabled', type: 'checkbox', label: 'Enable Pulses' },
    { cat: 'Effects', id: 'pulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'pulseEnabled', description: "Enables movie-accurate timing and visuals, disabling custom controls." },
    { cat: 'Effects', id: 'pulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseDelaySeconds', type: 'range', label: 'Delay', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['pulseEnabled', '!pulseMovieAccurate'], description: "Honor blank spaces within the code streams." },
    { cat: 'Effects', id: 'pulseIgnoreTracers', type: 'checkbox', label: 'Preserve Tracer Glow', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseDimming', type: 'range', label: 'Initial Dim Amount', min: 0.0, max: 1.0, step: 0.05, dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['pulseEnabled', '!pulseMovieAccurate'], description: "Blend the outer edge (tracer color) to inner edge (code color)" },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit: 'px', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['pulseEnabled', '!pulseMovieAccurate'] },
    { cat: 'Effects', id: 'pulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['pulseEnabled', '!pulseMovieAccurate'], description: "Start at a full square" },
    { cat: 'Effects', id: 'pulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['pulseEnabled', '!pulseMovieAccurate'] },

    { cat: 'Effects', type: 'accordion_header', label: 'Clear Pulse' },
    { cat: 'Effects', type: 'button', label: 'Trigger Clear Pulse Now', action: 'clearpulse', class: 'btn-warn' },
    { cat: 'Effects', id: 'clearPulseEnabled', type: 'checkbox', label: 'Enable Clear Pulse' },
    { cat: 'Effects', id: 'clearPulseMovieAccurate', type: 'checkbox', label: 'Movie Accurate', dep: 'clearPulseEnabled', description: "Enables movie-accurate visual artifacts (tearing/lag) without dimming the screen." },
    { cat: 'Effects', id: 'clearPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseDurationSeconds', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, unit: 's', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], description: "Honor blank spaces within the code streams." },
    { cat: 'Effects', id: 'clearPulseBlend', type: 'checkbox', label: 'Color Blend', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], description: "Blend the outer edge (tracer color) to inner edge (code color)" },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseWidth', type: 'range', label: 'Wave Width', min: 10, max: 400, step: 10, unit: 'px', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseRandomPosition', type: 'checkbox', label: 'Random Start Location', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },
    { cat: 'Effects', id: 'clearPulseInstantStart', type: 'checkbox', label: 'Instant Start', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'], description: "Start at a full square" },
    { cat: 'Effects', id: 'clearPulseCircular', type: 'checkbox', label: 'Circular Pulse', dep: ['clearPulseEnabled', '!clearPulseMovieAccurate'] },

    { cat: 'Effects', type: 'accordion_header', label: 'Pulse Storm' },
    { cat: 'Effects', type: 'button', label: 'Trigger Pulse Storm Now', action: 'minipulse', class: 'btn-warn' },
    { cat: 'Effects', id: 'miniPulseEnabled', type: 'checkbox', label: 'Enable Storms' },
    { cat: 'Effects', id: 'miniPulseFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, unit: 's', dep: 'miniPulseEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseUseTracerGlow', type: 'checkbox', label: 'Use Tracer Glow', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulsePreserveSpaces', type: 'checkbox', label: 'Preserve Spaces', dep: 'miniPulseEnabled', description: "Honor blank spaces within the code streams." },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseThickness', type: 'range', label: 'Wave Width', min: 10, max: 150, unit: 'px', dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseSpawnChance', type: 'range', label: 'Density', min: 0.01, max: 0.5, step: 0.01, dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseSpeed', type: 'range', label: 'Speed', min: 5, max: 50, dep: 'miniPulseEnabled' },
    { cat: 'Effects', id: 'miniPulseSize', type: 'range', label: 'Blast Size Max', min: 50, max: 400, unit: 'px', dep: 'miniPulseEnabled' },

    { cat: 'Effects', type: 'accordion_header', label: 'Deja Vu' },
    { cat: 'Effects', type: 'button', label: 'Trigger Deja Vu Now', action: 'dejavu', class: 'btn-warn' },
    { cat: 'Effects', id: 'dejaVuEnabled', type: 'checkbox', label: 'Enable Deja Vu' },
    { cat: 'Effects', id: 'dejaVuFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuDurationSeconds', type: 'range', label: 'Duration', min: 1, max: 10, step: 0.1, unit: 's', dep: 'dejaVuEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuMinRectHeight', type: 'range', label: 'Minimum Thickness', min: 2, max: 5, unit: 'rows', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuMaxRectHeight', type: 'range', label: 'Maximum Thickness', min: 6, max: 50, unit: 'rows', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuHoleBrightness', type: 'range', label: 'Intensity', min: 0, max: 1, step: 0.01, dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuRandomizeColors', type: 'checkbox', label: 'Enable Color Writing', dep: 'dejaVuEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuIntensity', type: 'range', label: 'Flash Frequency', min: 0.01, max: 0.1, step: 0.01, dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuBarDurationFrames', type: 'range', label: 'Flash Length', min: 10, max: 60, unit: 'fr', dep: 'dejaVuEnabled' },
    { cat: 'Effects', id: 'dejaVuVarianceFrames', type: 'range', label: 'Flash Length Variance', min: 0, max: 120, unit: 'fr', dep: 'dejaVuEnabled' },

    { cat: 'Effects', type: 'accordion_header', label: 'Superman' },
    { cat: 'Effects', type: 'button', label: 'Trigger Superman', action: 'superman', class: 'btn-warn' },
    { cat: 'Effects', id: 'supermanEnabled', type: 'checkbox', label: 'Enable Superman Effects' },
    { cat: 'Effects', id: 'supermanFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanDurationSeconds', type: 'range', label: 'Duration', min: 0.5, max: 6.0, step: 0.1, unit: 's', dep: 'supermanEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanGlow', type: 'range', label: 'Glow amount', min: 1, max: 10, dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanFadeSpeed', type: 'range', label: 'Fade Duration', min: 5, max: 60, dep: 'supermanEnabled', description: 'Higher values mean trails last longer.' },
    { cat: 'Effects', id: 'supermanBoltThickness', type: 'range', label: 'Bolt Thickness', min: 1, max: 10, step: 1, dep: 'supermanEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'supermanEnabled' },
    { cat: 'Effects', id: 'supermanFlickerRate', type: 'range', label: 'Flicker Jitter', min: 1, max: 10, unit: 'fr', dep: 'supermanEnabled', description: 'Lower is faster electricity.' },
    { cat: 'Effects', id: 'supermanWidth', type: 'range', label: 'Scatter Height', min: 1, max: 10, dep: 'supermanEnabled', description: 'How vertically erratic the lightning path is.' },
    { cat: 'Effects', id: 'supermanSpawnSpeed', type: 'range', label: 'Bolt Speed', min: 10, max: 100, dep: 'supermanEnabled', description: 'Speed from left to right' },

    { cat: 'Effects', type: 'accordion_header', label: 'Boot/Crash' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Boot Sequence' },
    { cat: 'Effects', id: 'bootSequenceEnabled', type: 'checkbox', label: 'Start Code with Boot' },
    { cat: 'Effects', type: 'button', label: 'Trigger Boot Now', action: 'boot', class: 'btn-warn' },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Sequence' },
    { cat: 'Effects', id: 'crashEnabled', type: 'checkbox', label: 'Enable Crash' },
    { cat: 'Effects', id: 'crashFrequencySeconds', type: 'range', label: 'Frequency', min: 50, max: 500, step: 1, unit: 's', transform: v => v === 500 ? 'Random' : v + 's', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashDurationSeconds', type: 'range', label: 'Duration', min: 5, max: 120, step: 5, unit: 's', dep: 'crashEnabled' },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Crash Visuals', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashSheetCount', type: 'range', label: 'Shadowbox Density', min: 0, max: 200, step: 1, dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashSheetSpeed', type: 'range', label: 'Shadowbox Speed', min: 0.1, max: 3.0, step: 0.1, dep: 'crashEnabled', transform: v => v + 'x' },
    { cat: 'Effects', id: 'crashSheetOpacity', type: 'range', label: 'Shadowbox Opacity', min: 0.0, max: 1.0, step: 0.01, dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashStationaryChance', type: 'range', label: 'Shadowbox Movement Level', min: 0, max: 100, unit: '%', invert: true, dep: 'crashEnabled', description: "How likely a shadow box is to move when spawned." },
    { cat: 'Effects', id: 'crashFlashDelayMin', type: 'range', label: 'Flash Delay Min', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashFlashDelayMax', type: 'range', label: 'Flash Delay Max', min: 1, max: 10, step: 0.5, unit: 's', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashEnableSmith', type: 'checkbox', label: 'Infect Characters (Agent Smith)', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashEnableSuperman', type: 'checkbox', label: 'Simulate Physics (Superman)', dep: 'crashEnabled' },
    { cat: 'Effects', id: 'crashEnableFlash', type: 'checkbox', label: 'Flash Screen on Crash', dep: 'crashEnabled' },
    { cat: 'Effects', type: 'button', label: 'Trigger Crash Now', action: 'crash', class: 'btn-warn' },

    { cat: 'Effects', type: 'header', label: 'Resurrections' },

    { cat: 'Effects', type: 'accordion_header', label: 'Quantized Defaults' },
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
            
            if (s.dep) {
                const deps = Array.isArray(s.dep) ? s.dep : [s.dep];
                setting.dep = deps.map(d => {
                    if (d.startsWith('!')) return '!' + defPrefix + d.substring(1);
                    return defPrefix + d;
                });
            }
            
            defaults.push(setting);
        });
        if (currentSub !== '') defaults.push({ cat: 'Effects', type: 'end_group' });
        return defaults;
    })(),

    ...generateQuantizedEffectSettings('quantizedPulse', 'Quantized Pulse', 'quantizedPulse'),
    ...generateQuantizedEffectSettings('quantizedAdd', 'Quantized Add', 'quantizedAdd'),
    ...generateQuantizedEffectSettings('quantizedRetract', 'Quantized Retract', 'quantizedRetract'),
    ...generateQuantizedEffectSettings('quantizedClimb', 'Quantized Climb', 'quantizedClimb'),
    ...generateQuantizedEffectSettings('quantizedZoom', 'Quantized Zoom', 'quantizedZoom'),

    ...generateQuantizedEffectSettings('quantizedGenerateV2', 'Quantized Block Generator', 'QuantizedBlockGenerator'),

    { cat: 'Effects', type: 'sub_accordion', label: 'Generation Settings', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2RandomStart', type: 'checkbox', label: 'Random Start Location', dep: 'quantizedGenerateV2Enabled', description: 'When enabled, the effect originates at a random point on screen. That point becomes the center for all growth instead of the screen center.' },
    { cat: 'Effects', id: 'quantizedGenerateV2SpineBoost', type: 'range', label: 'Spine Burst', min: 0, max: 10, step: 1, unit: 'steps', dep: 'quantizedGenerateV2Enabled', description: 'Number of guaranteed-growth ticks for the initial cardinal spine strips before their normal step pattern kicks in. Gives the spines a visible lead over expansion rows/columns.' },
    { cat: 'Effects', id: 'quantizedGenerateV2SimultaneousSpawns', type: 'range', label: 'Max Actions', min: 1, max: 10, step: 1, dep: 'quantizedGenerateV2Enabled', description: "The maximum number of growth actions to attempt in a single step." },
    { cat: 'Effects', id: 'quantizedGenerateV2LayerCount', type: 'range', label: 'Layer Count', min: 1, max: 3, step: 1, dep: 'quantizedGenerateV2Enabled', description: "Number of additional layers to generate (Layer 0 is always base, max 3 additional = 4 total). Layers 2 and 3 are used by Invisible Layer Growth." },
    { cat: 'Effects', id: 'quantizedGenerateV2MinBlockWidth', type: 'range', label: 'Min Block Width', min: 1, max: 8, step: 1, dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxBlockWidth', type: 'range', label: 'Max Block Width', min: 1, max: 8, step: 1, dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2MinBlockHeight', type: 'range', label: 'Min Block Height', min: 1, max: 8, step: 1, dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxBlockHeight', type: 'range', label: 'Max Block Height', min: 1, max: 8, step: 1, dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2FadeInFrames', type: 'range', label: 'Fade In', min: 0, max: 60, unit: 'fr', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2FadeFrames', type: 'range', label: 'Fade Out', min: 0, max: 60, unit: 'fr', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'sub_accordion', label: 'Rhythm & Timing', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Intersection Pause', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2IntersectionPause', type: 'checkbox', label: 'Enable', dep: 'quantizedGenerateV2Enabled', description: 'When two strips of the same axis reach the same grow count, they may swap to a different step pattern momentarily.' },
    { cat: 'Effects', id: 'quantizedGenerateV2IntersectionPauseChance', type: 'range', label: 'Pause Probability', min: 0.0, max: 1.0, step: 0.05, dep: 'quantizedGenerateV2IntersectionPause', transform: v => (v * 100).toFixed(0) + '%' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Size Scaling', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2FillThreshold', type: 'range', label: 'Scale-Up Threshold', min: 0.05, max: 0.9, step: 0.01, dep: 'quantizedGenerateV2Enabled', transform: v => (v * 100).toFixed(0) + '%', description: 'Fill ratio at which strips begin using scaled block sizes. Below this threshold all blocks are 1×1.' },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxBlockScale', type: 'range', label: 'Max Block Scale', min: 1, max: 5, step: 1, dep: 'quantizedGenerateV2Enabled', description: 'Maximum block dimension along a strip\'s growth axis (aspect-ratio scaled, 1–5 cells).' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Inside-Out Expansion', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutEnabled', type: 'checkbox', label: 'Enable', dep: 'quantizedGenerateV2Enabled', description: 'After the initial spine strips grow, seed parallel rows and columns at increasing perpendicular distances from both axes (wave 1 = ±1, wave 2 = ±2, etc.).' },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutDelay', type: 'range', label: 'Start Delay', min: 0, max: 20, step: 1, unit: 'steps', dep: 'quantizedGenerateV2InsideOutEnabled', description: 'Number of global steps to wait before the first expansion wave fires. Gives the spine strips time to establish.' },
    { cat: 'Effects', id: 'quantizedGenerateV2InsideOutPeriod', type: 'range', label: 'Wave Speed', min: 1, max: 10, step: 1, unit: 'steps', dep: 'quantizedGenerateV2InsideOutEnabled', description: 'Steps between each successive expansion wave. Lower = faster inside-out fill.' },
    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'sub_accordion', label: 'Behavior Settings', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', type: 'sortable_list', id: 'quantizedBehaviorPool', label: 'Behavior Pool', dep: 'quantizedGenerateV2Enabled' },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Main Nudge Growth', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeEnabled', type: 'checkbox', label: 'Enabled', dep: 'quantizedGenerateV2Enabled', description: 'Default enabled state for Main Nudge Growth. Can also be toggled live in the Behavior Pool above.' },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 20, step: 1, unit: 'steps', dep: 'quantizedGenerateV2NudgeEnabled', description: 'Number of global steps to wait before nudge strips begin spawning, giving main strips time to establish.' },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeChance', type: 'range', label: 'Spawn Rate', min: 0.05, max: 1.0, step: 0.05, dep: 'quantizedGenerateV2NudgeEnabled', transform: v => (v * 100).toFixed(0) + '%', description: 'Probability per tick that a new nudge strip is attempted.' },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxNudgeStrips', type: 'range', label: 'Max Strips', min: 1, max: 20, step: 1, dep: 'quantizedGenerateV2NudgeEnabled', description: 'Maximum number of simultaneous nudge strips.' },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeAxisBias', type: 'range', label: 'Axis Bias', min: 0.0, max: 1.0, step: 0.05, dep: 'quantizedGenerateV2NudgeEnabled', transform: v => v < 0.35 ? 'Vertical (E/W)' : v > 0.65 ? 'Horizontal (N/S)' : 'Mixed', description: 'Controls which axis nudge strips originate from. Left spawns from the vertical axis (x=origin), growing East/West. Right spawns from the horizontal axis (y=origin), growing North/South.' },
    { cat: 'Effects', id: 'quantizedGenerateV2NudgeSpacing', type: 'range', label: 'Min Spacing', min: 1, max: 10, step: 1, dep: 'quantizedGenerateV2NudgeEnabled', description: 'Minimum Manhattan distance between nudge strip origin points. Prevents crowding along the axis.' },

    { cat: 'Effects', type: 'accordion_subheader', label: 'Invisible Layer Growth', dep: 'quantizedGenerateV2Enabled' },
    { cat: 'Effects', id: 'quantizedGenerateV2InvisibleEnabled', type: 'checkbox', label: 'Enabled', dep: 'quantizedGenerateV2Enabled', description: 'Spawns L2/L3 strips from pre-existing blocks on the axes. L2 originates on the X axis (y=origin) and grows N/S; L3 originates on the Y axis (x=origin) and grows E/W. Requires Layer Count ≥ 3 for L3.' },
    { cat: 'Effects', id: 'quantizedGenerateV2InvisibleStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 20, step: 1, unit: 'steps', dep: 'quantizedGenerateV2InvisibleEnabled', description: 'Global steps to wait before invisible strips begin spawning.' },
    { cat: 'Effects', id: 'quantizedGenerateV2InvisibleChance', type: 'range', label: 'Spawn Rate', min: 0.05, max: 1.0, step: 0.05, dep: 'quantizedGenerateV2InvisibleEnabled', transform: v => (v * 100).toFixed(0) + '%', description: 'Probability per tick that a new invisible strip is attempted.' },
    { cat: 'Effects', id: 'quantizedGenerateV2MaxInvisibleStrips', type: 'range', label: 'Max Strips', min: 1, max: 20, step: 1, dep: 'quantizedGenerateV2InvisibleEnabled', description: 'Maximum number of simultaneous invisible strips across both layers.' },
    { cat: 'Effects', id: 'quantizedGenerateV2InvisibleSpacing', type: 'range', label: 'Min Spacing', min: 1, max: 10, step: 1, dep: 'quantizedGenerateV2InvisibleEnabled', description: 'Minimum Manhattan distance between invisible strip origin points.' },

    { cat: 'Effects', type: 'end_group' },

    { cat: 'Effects', type: 'header', label: 'Special Effects' },

    { cat: 'Effects', type: 'accordion_header', label: 'Star Power' },
    { cat: 'Effects', id: 'starPowerEnabled', type: 'checkbox', label: 'Enable Star Power' },
    { cat: 'Effects', id: 'starPowerFreq', type: 'range', label: 'Frequency', min: 5, max: 100, dep: 'starPowerEnabled', unit: '%' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Look', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerRainbowMode', type: 'select', label: 'Color Mode', options: [{ label: 'Full Stream', value: 'stream' }, { label: 'Per Char', value: 'char' }], dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerSaturation', type: 'range', label: 'Saturation', min: 0, max: 100, unit: '%', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerIntensity', type: 'range', label: 'Intensity', min: 10, max: 90, unit: '%', dep: 'starPowerEnabled' },
    { cat: 'Effects', type: 'accordion_subheader', label: 'Feel', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerColorCycle', type: 'checkbox', label: 'Cycle Colors', dep: 'starPowerEnabled' },
    { cat: 'Effects', id: 'starPowerCycleSpeed', type: 'range', label: 'Cycle Speed', min: 1, max: 20, dep: 'starPowerEnabled' },

    { cat: 'Effects', type: 'accordion_header', label: 'Rainbow Streams' },
    { cat: 'Effects', id: 'rainbowStreamEnabled', type: 'checkbox', label: 'Enable Rainbow Streams' },
    { cat: 'Effects', id: 'rainbowStreamChance', type: 'range', label: 'Frequency', min: 0.05, max: 1.0, step: 0.05, dep: 'rainbowStreamEnabled', transform: v => (v * 100).toFixed(0) + '%' },
    { cat: 'Effects', id: 'rainbowStreamIntensity', type: 'range', label: 'Brightness', min: 10, max: 90, unit: '%', dep: 'rainbowStreamEnabled' },

    { cat: 'Effects', type: 'header', label: 'Post Processing' },
    { cat: 'Effects', type: 'accordion_header', label: 'User Shader' },
    { cat: 'Effects', id: 'shaderEnabled', type: 'checkbox', label: 'Enable User Shader' },
    { cat: 'Effects', type: 'info_description', id: 'currentShaderNameDisplay', text: 'none' },
    { cat: 'Effects', type: 'button', label: 'Import Fragment Shader (.glsl)', id: 'importShader_effects', action: 'importShader', class: 'btn-info', dep: 'shaderEnabled' },
    { cat: 'Effects', type: 'container', id: 'dynamicShaderControls', dep: 'shaderEnabled' },
    { cat: 'Effects', id: 'shaderParameter', type: 'range', label: 'Global Parameter', min: 0.0, max: 1.0, step: 0.01, dep: 'shaderEnabled' },
    { cat: 'Effects', type: 'info_description', text: 'Uniforms provided: uTexture (sampler2D), uTime (float), uResolution (vec2), uMouse (vec2), uParameter (float). Output to gl_FragColor.', dep: 'shaderEnabled' },

    // 5. DEBUG TAB
    { cat: 'Debug', type: 'accordion_header', label: 'General' },
    { cat: 'Debug', id: 'showFpsCounter', type: 'checkbox', label: 'Show FPS Counter', description: "Displays the current frames-per-second in the top-left corner." },
    { cat: 'Debug', id: 'debugEnabled', type: 'checkbox', label: 'Detailed Performance Stats', dep: 'showFpsCounter', description: "Shows detailed performance logs." },
    { cat: 'Debug', id: 'simulationPaused', type: 'checkbox', label: 'Pause Code Flow', description: "Freezes the falling code animation." },
    { cat: 'Debug', id: 'logErrors', type: 'checkbox', label: 'Log Errors to Console', description: "Allows application errors to be logged to the browser console." },
    { cat: 'Debug', id: 'quantEditorEnabled', type: 'checkbox', label: 'QuantEditor', description: "Enable the visual editor for Quantized Pulse Effect." },

    { cat: 'Debug', type: 'accordion_header', label: 'Post Processing', icon: '󰋚', description: 'Pipeline: Effect 1 -> Effect 2 -> Total FX1 -> Total FX2 -> Global FX -> Custom' },
    { cat: 'Debug', type: 'checkbox', label: 'Bypass All Shaders', id: 'postProcessBypassAll' },
    { cat: 'Debug', type: 'button', label: 'Unload All Shaders', action: 'unloadAllShaders', class: 'btn-danger' },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Effect 1' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'effectShader1Enabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'effectShader1NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (E1)', action: 'importShader_E1', class: 'btn-info', dep: 'effectShader1Enabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'effect1Parameter', min: 0.0, max: 1.0, step: 0.01 },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Effect 2' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'effectShader2Enabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'effectShader2NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (E2)', action: 'importShader_E2', class: 'btn-info', dep: 'effectShader2Enabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'effect2Parameter', min: 0.0, max: 1.0, step: 0.01 },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Total FX1' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'totalFX1Enabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'totalFX1NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (FX1)', action: 'importShader_FX1', class: 'btn-info', dep: 'totalFX1Enabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'totalFX1Parameter', min: 0.0, max: 1.0, step: 0.01 },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Total FX2' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'totalFX2Enabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'totalFX2NameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (FX2)', action: 'importShader_FX2', class: 'btn-info', dep: 'totalFX2Enabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'totalFX2Parameter', min: 0.0, max: 1.0, step: 0.01 },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Global FX (Bloom, etc.)' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'globalFXEnabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'globalFXNameDisplay', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (GLO)', action: 'importShader_GLO', class: 'btn-info', dep: 'globalFXEnabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'globalFXParameter', min: 0.0, max: 1.0, step: 0.01 },
    
    { cat: 'Debug', type: 'accordion_subheader', label: 'Custom User Shader' },
    { cat: 'Debug', type: 'checkbox', label: 'Enabled', id: 'shaderEnabled_debug', bind: 'shaderEnabled' },
    { cat: 'Debug', type: 'info_description', label: 'Shader', id: 'currentShaderNameDisplay_debug', text: 'none' },
    { cat: 'Debug', type: 'button', label: 'Load Shader (CUST)', id: 'importShader_debug', action: 'importShader', class: 'btn-info', dep: 'shaderEnabled' },
    { cat: 'Debug', type: 'range', label: 'Parameter', id: 'shaderParameter_debug', bind: 'shaderParameter', min: 0.0, max: 1.0, step: 0.01 },

    { cat: 'Debug', type: 'accordion_header', label: 'Layers' },
    { cat: 'Debug', id: 'layerEnableBackground', type: 'checkbox', label: 'Enable Background Color', description: 'Draws the black background to clear the previous frame.' },
    { cat: 'Debug', id: 'layerEnablePrimaryCode', type: 'checkbox', label: 'Show Primary Code', description: 'The main Matrix rain simulation.' },
    { cat: 'Debug', id: 'layerEnableShadowWorld', type: 'checkbox', label: 'Show Shadow World', description: 'The alternate reality revealed by effects.' },
    { cat: 'Debug', id: 'layerEnableQuantizedLines', type: 'checkbox', label: 'Show Quantized Lines', description: 'The yellow/green grid lines from quantized effects.' },
    { cat: 'Debug', id: 'layerEnableQuantizedGridCache', type: 'checkbox', label: 'Show Quantized Source Grid', description: 'The raw character grid used to generate lines (Sparse Optimization).' },
    { cat: 'Debug', id: 'quantizedSourceGridOffsetX', type: 'range', label: 'Source Grid X Offset', min: -100, max: 100, step: 1, dep: 'layerEnableQuantizedGridCache' },
    { cat: 'Debug', id: 'quantizedSourceGridOffsetY', type: 'range', label: 'Source Grid Y Offset', min: -100, max: 100, step: 1, dep: 'layerEnableQuantizedGridCache' },
    { cat: 'Debug', id: 'layerEnableEditorGrid', type: 'checkbox', label: 'Show Editor Grid', description: 'The alignment grid in the Quantized Editor.' },
    { cat: 'Debug', id: 'layerEnableEditorOverlay', type: 'checkbox', label: 'Show Editor Changes', description: 'The green schematic blocks in the Quantized Editor.' },
    { cat: 'Debug', id: 'highlightErasers', type: 'checkbox', label: 'Highlight Erasers', description: "Draws a red border around invisible eraser tracers." },
    { cat: 'Debug', id: 'quantizedSolidPerimeter', type: 'checkbox', label: 'Solid Perimeter Lines', description: 'Renders grid lines as solid blocks instead of character-based masks.' },

    // 6. SYSTEM TAB
    { cat: 'System', type: 'accordion_header', label: 'Configuration' },
    { cat: 'System', type: 'slot', idx: 0, id: 'slot_0' },
    { cat: 'System', type: 'slot', idx: 1, id: 'slot_1' },
    { cat: 'System', type: 'slot', idx: 2, id: 'slot_2' },
    { cat: 'System', type: 'slot', idx: 3, id: 'slot_3' },
    { cat: 'System', type: 'slot', idx: 4, id: 'slot_4' },
    { cat: 'System', type: 'button', label: 'Export Config (JSON)', action: 'export', class: 'btn-info' },
    { cat: 'System', type: 'button', label: 'Import Config (JSON)', action: 'import', class: 'btn-info' },
    { cat: 'System', id: 'hideMenuIcon', type: 'checkbox', label: 'Hide Settings Icon', description: 'Hover your mouse over the top right or press the Toggle UI Panel keybind to show' },
    { cat: 'System', id: 'doubleClickToReset', type: 'checkbox', label: 'Double Click to Reset', description: 'Double click/tap sliders to reset them to default values.' },
    { cat: 'System', id: 'suppressToasts', type: 'checkbox', label: 'Suppress Toast Messages', description: 'Disable pop-up notifications at the bottom of the screen.' },
    { cat: 'System', id: 'debugTabEnabled', type: 'checkbox', label: 'Enable Debug Mode', description: "Shows the hidden Debug tab for advanced settings and alignment tools." },

    { cat: 'System', type: 'accordion_header', label: 'Key Bindings' },
    { cat: 'System', id: 'enableKeybinds', type: 'checkbox', label: 'Enable Keybinds', description: 'Master switch for key bindings. When enabled, keybinds will force effects to run even if the effect is disabled in settings.' },
    { cat: 'System', type: 'info_description', text: 'Click a button to assign a new key. Press Backspace or Delete to clear.' },
    { cat: 'System', type: 'keybinder', id: 'BootSequence', label: 'Boot Animation' },
    { cat: 'System', type: 'keybinder', id: 'CrashSequence', label: 'Crash Animation' },
    { cat: 'System', type: 'keybinder', id: 'BootCrashSequence', label: 'Boot to Crash' },
    { cat: 'System', type: 'keybinder', id: 'Pulse', label: 'Pulse' },
    { cat: 'System', type: 'keybinder', id: 'ClearPulse', label: 'Clear Pulse' },
    { cat: 'System', type: 'keybinder', id: 'MiniPulse', label: 'Pulse Storm' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedPulse', label: 'Quantized Pulse' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedAdd', label: 'Quantized Add' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedRetract', label: 'Quantized Retract' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedClimb', label: 'Quantized Climb' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedZoom', label: 'Quantized Zoom' },
    { cat: 'System', type: 'keybinder', id: 'QuantizedBlockGenerator', label: 'Quantized Block Generator' },
    { cat: 'System', type: 'keybinder', id: 'DejaVu', label: 'Deja Vu' },
    { cat: 'System', type: 'keybinder', id: 'Superman', label: 'Superman' },
    { cat: 'System', type: 'keybinder', id: 'ToggleUI', label: 'Toggle UI Panel' },

    { cat: 'System', type: 'accordion_header', label: 'System Reset' },
    { cat: 'System', type: 'info_description', text: 'Clears the current font cache, and resets all font entries to default' },
    { cat: 'System', type: 'button', label: 'Clear Font Cache', action: 'clearCache', class: 'btn-warn' },
    { cat: 'System', type: 'header', label: 'CAUTION ZONE' },
    { cat: 'System', type: 'button', label: 'Factory Reset All', action: 'reset', class: 'btn-danger', caution: true },

    { cat: 'System', type: 'accordion_header', label: 'About' },
    { cat: 'System', type: 'about_content' },
    { cat: 'System', type: 'accordion_subheader', label: 'Frequently Asked Questions' },
    { cat: 'System', type: 'faq_item', question: 'What is this?', answer: 'This is a highly customizable Matrix Digital Rain simulation built with HTML5 Canvas and JavaScript.' },
    { cat: 'System', type: 'faq_item', question: 'How do I change the code?', answer: 'Use the settings panel on the right side of the screen to customize various aspects like colors, speeds, and effects.' },
    { cat: 'System', type: 'faq_item', question: 'Can I use my own font?', answer: 'Yes, go to the "Appearance" tab, under "Character Fonts" you can import your own TTF or OTF font file.' },
    { cat: 'System', type: 'faq_item', question: 'Why is it sometimes slow?', answer: 'Performance depends on your device and settings. Try reducing "Resolution Scale" or disabling some effects under the "Effects" tab.' },
    { cat: 'System', type: 'faq_item', question: 'Is this more AI slop?', answer: 'Yes and no. LLM\'s were definitely used to make this, but the person who programmed it is a real person, and much of the code was hand-written, not just \'vibe coded\'. It\'s not perfect, but it\'s being slowly improved.' },
    { cat: 'System', type: 'faq_item', question: 'How do I leave feedback or suggestions on your app?', answer: 'Free to reach out via github! I\'m definitely open to ideas and suggestions.' }
];
