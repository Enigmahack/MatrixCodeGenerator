import re

def fix_file_v3(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Fix the double-layer-by-layer thing in shove_fill
    content = re.sub(r"s\.shoveStripsByLayer\[layer\]ByLayer\[layer\]ByLayer", "s.shoveStripsByLayer", content)
    content = re.sub(r"s\.shoveStripsByLayer\[layer\]ByLayer\[layer\]", "s.shoveStripsByLayer[layer]", content)

    # 2. Fix the undefined 'l' in nudge growth
    nudge_pattern = r"(this\._calcBlockSize\(.*?\), s\.fillRatio\);)\s*(this\._attemptNudgeGrowthWithParams\(l, bw, bh, .*?\);)"
    def nudge_repl(m):
        return f"{m.group(1)}\n                    const maxL = this._getMaxLayer();\n                    for (let l = 0; l <= maxL; l++) {{\n                        {m.group(2)}\n                    }}"
    content = re.sub(nudge_pattern, nudge_repl, content)

    # 3. Ensure behaviors accept (s, behavior, layer) and use 'layer'
    # Find registerBehavior calls
    content = re.sub(r"function\(s, behavior\) \{", "function(s, behavior, layer) {", content)
    
    # 4. Fix any remaining targetLayer = l or layer = l
    content = content.replace("const targetLayer = l;", "const targetLayer = layer;")
    content = content.replace("const layer = targetLayer;", "const layer = layer;")
    content = content.replace("const layer = l;", "const layer = layer;")

    # 5. Fix hole_filler loop
    content = content.replace("for (let l = layer; l <= layer; l++)", "const l = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_file_v3('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
fix_file_v3('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
