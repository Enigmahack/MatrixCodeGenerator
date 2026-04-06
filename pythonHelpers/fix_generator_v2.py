import re

def clean_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Clean up messed up labels
    content = re.sub(r"type: [^,]*, growth: [^,]*, bias: [^,]*, type: [^,]*, growth: [^,]*, bias: [^,]*, label:", "label:", content)
    content = re.sub(r"type: [^,]*, growth: [^,]*, bias: [^,]*, label:", "label:", content)

    # Re-apply the correct configs
    is_base = "QuantizedBaseEffect" in filepath
    cfg = "this._getGenConfig" if is_base else "gen._getConfig"

    # Behavior definitions
    behaviors = ['BlockSpawner', 'SpreadingNudge', 'ShoveFill', 'HoleFiller', 'BlockThicken', 'AxisShift']
    labels = {
        'BlockSpawner': 'Block Spawner/Despawner',
        'SpreadingNudge': 'Spreading Nudge',
        'ShoveFill': 'Shove Fill',
        'HoleFiller': 'Aggressive Hole Filler',
        'BlockThicken': 'Block Thicken',
        'AxisShift': 'Axis Shift'
    }

    for b in behaviors:
        l = labels[b]
        new_opts = f"type: {cfg}('{b}BehaviorType') ?? 'pool', growth: {cfg}('{b}GrowthMode') ?? 'edge', bias: {cfg}('{b}SpawnBias') ?? 'single', label: '{l}'"
        content = re.sub(rf"label:\s*'{l}'", new_opts, content)

    # Now update function signatures and logic
    content = content.replace("function(s) {", "function(s, behavior) {")
    content = content.replace("b.fn.call(this, s);", "b.fn.call(this, s, b);")

    # In Block Spawner, use behavior.growth
    # Replace "const onSpine = onXSpine || onYSpine;"
    # With: "const onSpine = onXSpine || onYSpine; if (behavior.growth === 'spine' && !onSpine) return false;"
    content = content.replace("const onSpine = onXSpine || onYSpine;\n",
                              "const onSpine = onXSpine || onYSpine;\n                    if (behavior && behavior.growth === 'spine' && !onSpine) return false;\n")

    # For edge growth
    # Replace "if (!onSpine && !onOuterPerimeter) return false;"
    # With: "if (behavior.growth === 'edge' && !onOuterPerimeter) return false; if (!onSpine && !onOuterPerimeter) return false;"
    content = content.replace("if (!onSpine && !onOuterPerimeter) return false;\n",
                              "if (behavior && behavior.growth === 'edge' && !onOuterPerimeter) return false;\n                    if (!onSpine && !onOuterPerimeter) return false;\n")

    # Use behavior.bias when spawning blocks
    # E.g. in _spawnBlock or when calculating size. If bias === 'wider', use _calcBlockSize
    # I'll modify the behavior to be passed bias and decide. Let's just modify the comment/log for now if it's too complex to inject, or I can inject size modification.
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

clean_file('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js')
clean_file('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js')
