import re

def fix_behaviors(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. block_spawner_despawner
    # Already partially fixed by my previous replace, but let's ensure it's correct.
    # It should use the 'layer' argument (3rd arg).
    content = content.replace("function(s, behavior) {", "function(s, behavior, layer) {")
    content = content.replace("const layer = targetLayer;", "const layer = layer;") # if I broke it before
    content = content.replace("const layer = l;", "const layer = layer;") # if I broke it before

    # 2. spreading_nudge
    # Needs layer-specific queues to remain separate.
    content = content.replace("const targetLayer = l;", "const targetLayer = layer;")
    content = content.replace("s.spreadingNudgeSymmetryQueue", "s[`spreadingNudgeSymmetryQueue_${layer}`]")
    content = content.replace("s.spreadingNudgeNextSpawnStep", "s[`spreadingNudgeNextSpawnStep_${layer}`]")
    content = content.replace("s.spreadingNudgeNextDist", "s[`spreadingNudgeNextDist_${layer}`]")

    # 3. shove_fill
    # Needs layer-specific shove strips.
    content = content.replace("if (!s.shoveStrips) s.shoveStrips = [];", "if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];")
    content = content.replace("s.shoveStrips", "s.shoveStripsByLayer[layer]")

    # 4. block_thicken
    content = content.replace("const layer = targetLayer;", "const layer = layer;")

    # 5. hole_filler
    # It had an internal loop for (let l = 0; l <= 1; l++).
    # We should remove that loop and use the passed 'layer'.
    # Actually, if it's called for each layer, we don't need the internal loop.
    content = re.sub(r"for \(let l = 0; l <= 1; l\+\+\) \{", "{ const l = layer;", content)
    # This might leave an extra closing brace... I'll need to be careful.
    # Alternatively, just change the loop to for (let l = layer; l <= layer; l++).
    content = content.replace("for (let l = 0; l <= 1; l++)", "for (let l = layer; l <= layer; l++)")

    # 6. axis_shift
    # Needs layer-specific candidates?
    # axisShiftCandidates is populated in _updateRenderGridLogic?
    # No, it's populated in spreading_nudge.
    # If spreading_nudge is layer-specific, then axisShiftCandidates should be too.
    content = content.replace("s.axisShiftCandidates", "s[`axisShiftCandidates_${layer}`]")
    content = content.replace("s.axisShiftAxes", "s[`axisShiftAxes_${layer}`]")

    # 7. Final cleanup of any missed 'l' or 'targetLayer' hardcodes
    content = content.replace("targetLayer = 1", "targetLayer = layer")
    content = content.replace("const layer = 1;", "const layer = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_behaviors('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js', True)
fix_behaviors('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js', False)
