import re

def fix_initializations(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Fix spreading_nudge initialization
    # Add spreadingNudgeSymmetryQueue to initialization block
    old_init = r"if \(!s\[`spreadingNudgeNextDist_\$\{layer\}`\]\) \{"
    new_init = """if (!s[`spreadingNudgeNextDist_${layer}`]) {
                s[`spreadingNudgeNextDist_${layer}`] = { 'V1': 1, 'V-1': 1, 'H1': 1, 'H-1': 1 };
                s[`spreadingNudgeNextSpawnStep_${layer}`] = { 'V1': 0, 'V-1': 0, 'H1': 0, 'H-1': 0 };
                s[`spreadingNudgeSymmetryQueue_${layer}`] = [];
                s[`spreadingNudgeCycles_${layer}`] = { 
                    'V1': { step: 0, lastTempBlock: null }, 
                    'V-1': { step: 0, lastTempBlock: null }, 
                    'H1': { step: 0, lastTempBlock: null }, 
                    'H-1': { step: 0, lastTempBlock: null } 
                };
            }"""
    # Replace the existing init block (which I might have partially written)
    content = re.sub(r"if \(!s\[`spreadingNudgeNextDist_\$\{layer\}`\]\) \{.*?\}", new_init, content, flags=re.DOTALL)

    # 2. Fix shove_fill initialization
    # Ensure s.shoveStripsByLayer[layer] is initialized
    # I already have: if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];
    
    # 3. Fix axis_shift initialization
    # Ensure all are initialized
    # I have: if (!s[`axisShiftAxes_${layer}`]) s[`axisShiftAxes_${layer}`] = [];
    # if (!s.axisShiftUsedStrips) s.axisShiftUsedStrips = new Set();
    # if (!s[`axisShiftCandidates_${layer}`]) s[`axisShiftCandidates_${layer}`] = [];
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_initializations('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js')
fix_initializations('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js')
