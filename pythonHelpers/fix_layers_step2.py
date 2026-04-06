import re

def fix_max_layer(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    
    # 1. Update _getMaxLayer to return 0 for 1 layer, 1 for 2 layers.
    new_get_max = f"""_getMaxLayer() {{
        let val = {cfg}('LayerCount');
        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;
        return Math.max(0, Math.min(maxLayer, 1));
    }}"""
    content = re.sub(r"_getMaxLayer\(\) \{.*?\}", new_get_max, content, flags=re.DOTALL)

    # 2. Fix behaviors that were hardcoded to layer 1 or used promotion logic
    
    # Remove usePromotion logic that skips layer 0
    content = re.sub(r"if \(usePromotion && l !== 1\) continue;", "", content)
    
    # Fix minL/targetL logic that was skipping layer 0
    content = re.sub(r"const minL = usePromotion \? 1 : 0;", "const minL = 0;", content)
    content = re.sub(r"const targetL = usePromotion \? 1 : 0;", "const targetL = 0;", content)
    content = re.sub(r"const targetLayer = 1;", "const targetLayer = l;", content) # inside loops
    
    # Update _attemptNudgeGrowthWithParams to use targetLayer parameter
    content = content.replace("const layer = 1;", "const layer = targetLayer;")

    # In loops that specifically used layer 1, make them use the current loop variable 'l'
    # e.g. _attemptAdvancedGrowth has loops for l = 1 to maxLayer.
    # Change them to loop from 0 to maxLayer.
    content = content.replace("for (let l = 1; l <= maxLayer; l++)", "for (let l = 0; l <= maxLayer; l++)")
    
    # Some specific places use hardcoded 1
    content = content.replace("this._attemptNudgeGrowthWithParams(1, ", "this._attemptNudgeGrowthWithParams(l, ")
    
    # In _attemptV2Growth, if it's not in a loop, we need to wrap it.
    # This is better done with a more targeted replacement.

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_max_layer('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
fix_max_layer('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
