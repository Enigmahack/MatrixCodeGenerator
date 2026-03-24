import re

def fix_file(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    gcfg = "this._getGenConfig" if is_base_effect else "this._getConfig"

    # 1. Update _getMaxLayer (already did this, but ensuring it's correct)
    new_get_max = f"""_getMaxLayer() {{
        let val = {cfg}('LayerCount');
        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;
        return Math.max(0, Math.min(maxLayer, 1));
    }}"""
    content = re.sub(r"_getMaxLayer\(\) \{.*?\}", new_get_max, content, flags=re.DOTALL)

    # 2. Fix _attemptV2Growth hardcoded nudge
    # Find: this._attemptNudgeGrowthWithParams(1, bw, bh, s.scx, s.scy);
    # Replace with loop
    nudge_pattern = r"(if \(Math\.random\(\) <= nudgeChance\) \{\s*)(const \{ bw, bh \} = .*?;)\s*(this\._attemptNudgeGrowthWithParams\(.*?, bw, bh, .*?\);)\s*(\})"
    def nudge_repl(m):
        return f"{m.group(1)}{m.group(2)}\n                    const maxL = this._getMaxLayer();\n                    for (let l = 0; l <= maxL; l++) {{\n                        this._attemptNudgeGrowthWithParams(l, bw, bh, {('s.genOriginX, s.genOriginY' if is_base_effect else 's.scx, s.scy')});\n                    }}\n                {m.group(4)}"
    content = re.sub(nudge_pattern, nudge_repl, content)

    # 3. Update Behaviors to loop internally and use layer-specific state
    
    # 3a. block_spawner_despawner
    # Find the function(s, behavior) { ... }
    # I'll replace the start of the function to add the loop
    content = content.replace("this.registerBehavior('block_spawner_despawner', function(s, behavior) {",
                              "this.registerBehavior('block_spawner_despawner', function(s, behavior) {\n            const maxL = this._getMaxLayer();\n            for (let l = 0; l <= maxL; l++) {\n                const layer = l;")
    # And need to close the loop at the end of the behavior... this is hard with replace.
    # I'll use a more surgical approach for each.

    # Actually, it's better to just pass 'layer' to the behavior and have the execution loop handle the layers.
    # I'll update the execution loop in _attemptV2Growth.

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

# I'll do a manual patch for the behaviors because they are too complex for regex.
# Actually, I'll use python to find the start and end of each behavior and wrap it.

def wrap_behavior(content, name):
    pattern = rf"this\.registerBehavior\('{name}', function\(s, behavior\) \{{(.*?)\}}, \{{.*?\}}\);"
    # This is also hard due to nested braces.
    return content

# NEW PLAN:
# 1. Update _attemptGrowth execution loop to loop over layers.
# 2. Update behaviors to accept (s, behavior, layer).
# 3. Update behaviors to use the passed 'layer' instead of hardcoded 1.
# 4. Update state in behaviors to be layer-specific (e.g. s.shoveStrips[layer]).

# Let's start with the execution loop.
