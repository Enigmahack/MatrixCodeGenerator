import re

def fix_duplicate_layer_declarations(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match the start of a behavior function that includes 'layer' in its arguments
    # and then look for a 'const layer =' or 'let layer =' inside.
    # We use a non-greedy match for the function body, but we need to be careful with braces.
    # For simplicity, we can just replace all 'const layer = layer;' and 'const layer = l;'
    # and 'const layer = targetLayer;' if 'layer' is already available.
    
    # We can also just look for 'const layer = layer;' and 'const layer = l;' globally if we are sure 
    # 'layer' or 'l' is the intended variable from the outer scope.
    # In my previous step, I added 'layer' to the function arguments.
    
    content = content.replace("const layer = layer;", "// const layer = layer;")
    content = content.replace("const layer = l;", "// const layer = l;")
    content = content.replace("const layer = targetLayer;", "// const layer = targetLayer;")
    
    # Also fix the weird 'shoveStripsByLayer[layer]ByLayer[layer]' I saw in my previous tool output
    content = content.replace("s.shoveStripsByLayer[layer]ByLayer[layer]", "s.shoveStripsByLayer[layer]")
    
    # Fix the 'hole_filler' specifically if it had an issue
    # The user said line 4685 in QuantizedBaseEffect.js
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_duplicate_layer_declarations('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js')
fix_duplicate_layer_declarations('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js')
