import re

def fix_layer_count_logic(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = r"this\.getConfig" if is_base_effect else r"this\._getConfig"

    # Replace the core logic in _getMaxLayer
    # Using regex to handle potential spacing differences
    pattern = rf"(let maxLayer = {cfg}\('LayerCount'\);\s*if \(maxLayer === undefined \|\| maxLayer === null\) maxLayer = 0;\s*maxLayer = Math\.min\(maxLayer, 1\);)"
    
    def repl_func(match):
        c = "this.getConfig" if is_base_effect else "this._getConfig"
        return f"let val = {c}('LayerCount');\n        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;\n        maxLayer = Math.max(0, Math.min(maxLayer, 1));"

    content = re.sub(pattern, repl_func, content)

    # 2. Update QuantizedSequenceGeneratorV2 constructor and other inline usages
    if not is_base_effect:
        # const _maxLayer = Math.min(this._getConfig('LayerCount') ?? 0, 1);
        content = re.sub(r"const _maxLayer = Math\.min\(this\._getConfig\('LayerCount'\) \?\? 0, 1\);",
                         r"const _maxLayer = Math.max(0, Math.min((this._getConfig('LayerCount') ?? 1) - 1, 1));", content)
        # const maxLayer = Math.min(1, this._getConfig('LayerCount') ?? 0);
        content = re.sub(r"const maxLayer = Math\.min\(1, this\._getConfig\('LayerCount'\) \?\? 0\);",
                                  r"const maxLayer = Math.max(0, Math.min((this._getConfig('LayerCount') ?? 1) - 1, 1));", content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

# Special case for ZoomEffect
with open('MatrixCode_v10.0/js/effects/QuantizedZoomEffect.js', 'r', encoding='utf-8') as f:
    zoom = f.read()
zoom = zoom.replace("if (key === 'LayerCount') return 1;", "if (key === 'LayerCount') return 2;")
with open('MatrixCode_v10.0/js/effects/QuantizedZoomEffect.js', 'w', encoding='utf-8') as f:
    f.write(zoom)

fix_layer_count_logic('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
fix_layer_count_logic('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)

# Update ConfigurationManager defaults
with open('MatrixCode_v10.0/js/config/ConfigurationManager.js', 'r', encoding='utf-8') as f:
    cm = f.read()

cm = re.sub(r'("quantizedDefaultLayerCount": )1,', r'\1 2,', cm)
cm = re.sub(r'("quantizedDefaultLayerCount": )0,', r'\1 1,', cm)
cm = re.sub(r'("quantizedGenerateV2LayerCount": )1,', r'\1 2,', cm)
cm = re.sub(r'("quantizedGenerateV2LayerCount": )0,', r'\1 1,', cm)

with open('MatrixCode_v10.0/js/config/ConfigurationManager.js', 'w', encoding='utf-8') as f:
    f.write(cm)
