import re

def apply_final_changes(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    gcfg = "this._getGenConfig" if is_base_effect else "this._getConfig"

    # 1. RegisterBehavior and getMaxLayer (identical to before)
    old_reg = r"registerBehavior\(id,\s*fn,\s*options\s*=\s*\{\}\)\s*\{\s*this\.growthPool\.set\(id,\s*\{\s*fn:\s*fn,\s*enabled:\s*options\.enabled\s*\?\?\s*true,\s*label:\s*options\.label\s*\|\|\s*id\s*\}\);\s*\}"
    new_reg = """registerBehavior(id, fn, options = {}) {
        this.growthPool.set(id, {
            id: id,
            fn: fn,
            enabled: options.enabled ?? true,
            label: options.label || id,
            type: options.type || 'pool',
            growth: options.growth || 'edge',
            bias: options.bias || 'single'
        });
    }"""
    content = re.sub(old_reg, new_reg, content)

    new_get_max = f"""_getMaxLayer() {{
        let val = {cfg}('LayerCount');
        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;
        return Math.max(0, Math.min(maxLayer, 1));
    }}"""
    content = re.sub(r"_getMaxLayer\(\) \{.*?\}", new_get_max, content, flags=re.DOTALL)

    # 2. Execution Loop
    if is_base_effect:
        old_loop = r"// Axis Shift: tick deterministically every step.*?if \(enabledBehaviors\.length > 0\) \{\s*for \(let q = 0; q < quota; q\+\+\) \{\s*const b = enabledBehaviors\[Math\.floor\(Math\.random\(\) \* enabledBehaviors\.length\)\];\s*b\.fn\.call\(this, s\);\s*\}\s*\}"
        new_loop = """// INCREMENT AGE OF ALL ACTIVE BLOCKS
        for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

        const quota = this.getConfig('SimultaneousSpawns') || 1;
        if (!this._enabledPoolBehaviorsBuf) this._enabledPoolBehaviorsBuf = [];
        const poolBehaviors = this._enabledPoolBehaviorsBuf;
        poolBehaviors.length = 0;

        const maxL = this._getMaxLayer();
        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled) {
                if (b.type === 'core') {
                    for (let l = 0; l <= maxL; l++) {
                        b.fn.call(this, s, b, l);
                    }
                } else {
                    poolBehaviors.push(b);
                }
            }
        }

        if (poolBehaviors.length > 0) {
            const qCount = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
            const dynamicQuota = Math.max(1, Math.floor(quota * (qCount / 4)));
            for (let q = 0; q < dynamicQuota; q++) {
                const b = poolBehaviors[Math.floor(Math.random() * poolBehaviors.length)];
                for (let l = 0; l <= maxL; l++) {
                    b.fn.call(this, s, b, l);
                }
            }
        }"""
        content = re.sub(old_loop, new_loop, content, flags=re.DOTALL)
    else:
        old_loop = r"const quota = this\._getConfig\('SimultaneousSpawns'\) \|\| 1;\s*const enabledBehaviors = \[\.\.\.this\.growthPool\.values\(\)\]\.filter\(b => b\.fn && b\.enabled\);\s*if \(enabledBehaviors\.length > 0\) \{\s*for \(let q = 0; q < quota; q\+\+\) \{\s*const b = enabledBehaviors\[Math\.floor\(Math\.random\(\) \* enabledBehaviors\.length\)\];\s*b\.fn\.call\(this, s\);\s*\}\s*\}"
        new_loop = """const quota = this._getConfig('SimultaneousSpawns') || 1;
        const poolBehaviors = [];
        const maxL = this._getMaxLayer();
        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled) {
                if (b.type === 'core') {
                    for (let l = 0; l <= maxL; l++) {
                        b.fn.call(this, s, b, l);
                    }
                } else {
                    poolBehaviors.push(b);
                }
            }
        }
        if (poolBehaviors.length > 0) {
            const qCount = parseInt(this._getConfig('QuadrantCount') ?? 4);
            const dynamicQuota = Math.max(1, Math.floor(quota * (qCount / 4)));
            for (let q = 0; q < dynamicQuota; q++) {
                const b = poolBehaviors[Math.floor(Math.random() * poolBehaviors.length)];
                for (let l = 0; l <= maxL; l++) {
                    b.fn.call(this, s, b, l);
                }
            }
        }"""
        content = re.sub(old_loop, new_loop, content, flags=re.DOTALL)

    # 3. Main Nudge Growth
    nudge_pattern = r"(const \{ bw, bh \} = this\._calcBlockSize\(.*?\), s\.fillRatio\);)\s*(this\._attemptNudgeGrowthWithParams\(.*?, bw, bh, .*?\);)"
    def nudge_repl(m):
        return f"{m.group(1)}\n                    const maxL = this._getMaxLayer();\n                    for (let l = 0; l <= maxL; l++) {{\n                        this._attemptNudgeGrowthWithParams(l, bw, bh, {('s.genOriginX, s.genOriginY' if is_base_effect else 's.scx, s.scy')});\n                    }}"
    content = re.sub(nudge_pattern, nudge_repl, content)

    # 4. _spawnBlock bias
    pattern_sb = r"(    _spawnBlock\(x, y, w, h, layer = 0,.*source = null\) \{)" if is_base_effect else r"(    _spawnBlock\(x, y, w, h, layer, bypassOccupancy = false, source = null\) \{)"
    repl_sb = r"\1\n        if (source && typeof source === 'string' && this.growthPool) {\n            const b = this.growthPool.get(source);\n            if (b && b.bias === 'wider') {\n                if (w === 1) w = 2 + Math.floor(Math.random() * 2);\n                if (h === 1) h = 2 + Math.floor(Math.random() * 2);\n            }\n        }"
    content = re.sub(pattern_sb, repl_sb, content)

    # 5. Behavior labels and options
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
        new_opts = f"type: {gcfg}('{b}BehaviorType') ?? 'pool', growth: {gcfg}('{b}GrowthMode') ?? 'edge', bias: {gcfg}('{b}SpawnBias') ?? 'single', label: '{l}'"
        content = re.sub(rf"label:\s*'{l}'", new_opts, content)

    # Change function signatures
    content = re.sub(r"function\(s, behavior\) \{", "function(s, behavior, layer) {", content)
    content = re.sub(r"function\(s\) \{", "function(s, behavior, layer) {", content)

    # 6. Specific Behavior Logic Fixes
    # Block Spawner constraints
    content = content.replace("const onSpine = onXSpine || onYSpine;\n", "const onSpine = onXSpine || onYSpine;\n                    if (behavior && behavior.growth === 'spine' && !onSpine) return false;\n")
    content = content.replace("if (!onSpine && !onOuterPerimeter) return false;\n", "if (behavior && behavior.growth === 'edge' && !onOuterPerimeter) return false;\n                    if (!onSpine && !onOuterPerimeter) return false;\n")

    # Layer-specific state (using very specific replacements)
    content = content.replace("if (!s.shoveStrips) s.shoveStrips = [];", "if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];")
    # Avoid recursive replacement by using unique token
    content = content.replace("s.shoveStrips", "SHOVE_STRIPS_TOKEN")
    content = content.replace("SHOVE_STRIPS_TOKENByLayer", "s.shoveStripsByLayer") # revert accidental prefix match if any
    content = content.replace("SHOVE_STRIPS_TOKEN", "s.shoveStripsByLayer[layer]")

    content = content.replace("s.spreadingNudgeSymmetryQueue", "s[`spreadingNudgeSymmetryQueue_${layer}`]")
    content = content.replace("s.spreadingNudgeNextSpawnStep", "s[`spreadingNudgeNextSpawnStep_${layer}`]")
    content = content.replace("s.spreadingNudgeNextDist", "s[`spreadingNudgeNextDist_${layer}`]")
    content = content.replace("s.spreadingNudgeCycles", "s[`spreadingNudgeCycles_${layer}`]")
    content = content.replace("s.axisShiftAxes", "s[`axisShiftAxes_${layer}`]")
    content = content.replace("s.axisShiftCandidates", "s[`axisShiftCandidates_${layer}`]")
    content = content.replace("s.axisShiftNextStep", "s[`axisShiftNextStep_${layer}`]")
    content = content.replace("s.holeQIdx", "s[`holeQIdx_${layer}`]")

    # State initialization for spreading nudge
    sn_init = """// State Initialization
            if (!s[`spreadingNudgeNextDist_${layer}`]) {
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
    # Replace the snippet that starts sn initialization
    content = re.sub(r"// State Initialization\s*if \(!s\[`spreadingNudgeNextDist_\$\{layer\}`\]\) \{.*?\}", sn_init, content, flags=re.DOTALL)
    # If it wasn't already initialized with template literal (clean file won't have it)
    content = re.sub(r"// State Initialization\s*if \(!s\.spreadingNudgeNextDist\) \{.*?\}", sn_init, content, flags=re.DOTALL)

    # _tickLayerDirs
    content = re.sub(r"_tickLayerDirs\(s\) \{.*?\}", 
                     "_tickLayerDirs(s) {\n        for (let l = 0; l <= 1; l++) {\n            if (s.layerDirLife && s.layerDirLife[l] > 0) {\n                s.layerDirLife[l]--;\n                if (s.layerDirLife[l] <= 0) {\n                    s.layerDirs[l] = this._pickLayerDirs(4);\n                    s.layerDirLife[l] = 4 + l;\n                }\n            }\n        }\n    }", 
                     content, flags=re.DOTALL)

    # 7. Redeclaration Cleanup
    # Specifically target re-declarations inside functions that now have 'layer' in signature
    content = re.sub(r'^\s*(const|let)\s+layer\s*=\s*(1|l|targetLayer|targetLayerIndex);.*?\n', '', content, flags=re.MULTILINE)
    content = content.replace("const targetLayer = 1;", "")
    content = content.replace("const targetLayer = l;", "")
    content = content.replace("const targetLayer = layer;", "")
    content = content.replace("const layer = l;", "")
    
    content = content.replace("_attemptNudgeGrowthWithParams(targetLayer,", "_attemptNudgeGrowthWithParams(layer,")
    content = content.replace("for (let l = 0; l <= 1; l++)", "const l = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

apply_final_changes('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js', True)
apply_final_changes('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js', False)
