import re

def fix_behaviors_state(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update shove_fill
    content = content.replace("if (!s.shoveStrips) s.shoveStrips = [];",
                              "if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];")
    content = content.replace("s.shoveStrips", "s.shoveStripsByLayer[layer]")

    # 2. Update spreading_nudge
    # Note: spreadingNudgeNextSpawnStep and others are objects/arrays.
    content = content.replace("s.spreadingNudgeSymmetryQueue", "s[`spreadingNudgeSymmetryQueue_${layer}`]")
    content = content.replace("s.spreadingNudgeNextSpawnStep", "s[`spreadingNudgeNextSpawnStep_${layer}`]")
    content = content.replace("s.spreadingNudgeNextDist", "s[`spreadingNudgeNextDist_${layer}`]")
    content = content.replace("s.spreadingNudgeCycles", "s[`spreadingNudgeCycles_${layer}`]")

    # 3. Update axis_shift
    content = content.replace("s.axisShiftCandidates", "s[`axisShiftCandidates_${layer}`]")
    content = content.replace("s.axisShiftAxes", "s[`axisShiftAxes_${layer}`]")
    content = content.replace("s.axisShiftNextStep", "s[`axisShiftNextStep_${layer}`]")

    # 4. Update hole_filler
    content = content.replace("s.holeQIdx", "s[`holeQIdx_${layer}`]")

    # 5. Fix any remaining targetLayer = l (where l is not defined)
    content = content.replace("const targetLayer = l;", "const targetLayer = layer;")
    content = content.replace("const layer = targetLayer;", "const layer = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_behaviors_state('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js')
fix_behaviors_state('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js')
