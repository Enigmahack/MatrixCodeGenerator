import re

def fix_max_layer(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    
    # 1. Simplify _getMaxLayer
    # Old logic: val-1, clamped 0..1, then promoted to 1 if usePromotion.
    # New logic: val-1, clamped 0..1.
    pattern = rf"(_getMaxLayer\(\) \{{.*?const usePromotion = .*?;.*?if \(usePromotion && .*?\) return 1;.*?return maxLayer;.*?\}})"
    
    # Let's use a simpler replacement for _getMaxLayer
    new_get_max = f"""_getMaxLayer() {{
        let val = {cfg}('LayerCount');
        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;
        return Math.max(0, Math.min(maxLayer, 1));
    }}"""
    
    content = re.sub(r"_getMaxLayer\(\) \{.*?\}", new_get_max, content, flags=re.DOTALL)

    # 2. Remove promotion skipping logic
    # Find loops like: for (let l = 0; l <= maxLayer; l++) { if (usePromotion && l !== 1) continue; ... }
    content = re.sub(r"if \(usePromotion && l !== 1\) continue;", "", content)
    
    # Find minL logic: const minL = usePromotion ? 1 : 0;
    content = re.sub(r"const minL = usePromotion \? 1 : 0;", "const minL = 0;", content)
    
    # Find targetL logic: const targetL = usePromotion ? 1 : 0;
    content = re.sub(r"const targetL = usePromotion \? 1 : 0;", "const targetL = 0;", content)

    # 3. Update hardcoded layer 1 usage in behaviors
    # In QuantizedBaseEffect
    if is_base_effect:
        # block_spawner_despawner
        content = content.replace("const layer = 1;", "const maxL = this._getMaxLayer();\n            for (let l = 0; l <= maxL; l++) {\n                const layer = l;")
        # Need to close the brace later... this is tricky with string replacement.
        # I'll use a more targeted approach for each behavior.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_max_layer('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
fix_max_layer('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
