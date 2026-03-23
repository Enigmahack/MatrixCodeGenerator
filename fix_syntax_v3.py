import re

def fix_tick_layer_dirs(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the broken _tickLayerDirs and fix it.
    # It should loop over layers 0 and 1.
    
    # Replace the broken { const l = layer; ... } with a proper loop.
    # But wait, layer is not defined in _tickLayerDirs(s) scope if it's not a behavior.
    # _tickLayerDirs(s) is called from generateStep and update.
    
    pattern = r"\{ const l = layer;\s*// Pick a random count"
    # Actually, let's just restore the loop: for (let l = 0; l <= 1; l++) {
    content = content.replace("{ const l = layer;\n            // Pick a random count",
                              "for (let l = 0; l <= 1; l++) {\n            // Pick a random count")
    
    # Also fix the same in QuantizedSequenceGeneratorV2.js
    content = content.replace("{ const l = layer;\n            // Pick a random count",
                              "for (let l = 0; l <= 1; l++) {\n            // Pick a random count")

    # Now let's fix the 'layer has already been declared' error the user mentioned.
    # I'll search for 'const layer = layer;' and 'const layer = l;' and UNCOMMENT them if they were declarations
    # Wait, I already commented them out. 
    # Let's see if there are any UNCOMMENTED ones left.
    
    # I'll also check for 'const targetLayer = layer;' which is fine unless redeclared.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_tick_layer_dirs('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js')
fix_tick_layer_dirs('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js')
