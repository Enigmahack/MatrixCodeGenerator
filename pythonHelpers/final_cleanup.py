import re

def final_cleanup(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix the messed up shoveStrips access
    content = content.replace("s.shoveStripsByLayer[layer]ByLayer[layer]ByLayer[layer]", "s.shoveStripsByLayer[layer]")
    content = content.replace("s.shoveStripsByLayer[layer]ByLayer[layer]", "s.shoveStripsByLayer[layer]")
    
    # Fix the nudge growth loop which I might have nested too much
    # this._attemptNudgeGrowthWithParams(l, bw, bh, s.scx, s.scy);
    # was already wrapped in a loop.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

final_cleanup('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js')
final_cleanup('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js')
