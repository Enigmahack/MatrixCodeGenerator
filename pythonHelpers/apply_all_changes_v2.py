import re

def apply_clean_changes(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    gcfg = "this._getGenConfig" if is_base_effect else "this._getConfig"

    # 1. Behavior Registration & loop
    if is_base_effect:
        # Update loop in _attemptGrowth
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
        # SequenceGeneratorV2 loop
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

    # 2. _getMaxLayer
    content = re.sub(r"_getMaxLayer\(\) \{.*?\}", 
                     f"""_getMaxLayer() {{
        let val = {cfg}('LayerCount');
        let maxLayer = (val === undefined || val === null) ? 0 : val - 1;
        return Math.max(0, Math.min(maxLayer, 1));
    }}""", content, flags=re.DOTALL)

    # 3. Behavior definitions (type, growth, bias, layer argument)
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

    # Function signatures to (s, behavior, layer)
    content = re.sub(r"function\(s, behavior\) \{", "function(s, behavior, layer) {", content)
    content = re.sub(r"function\(s\) \{", "function(s, behavior, layer) {", content)

    # 4. _spawnBlock bias
    pattern_sb = r"(    _spawnBlock\(x, y, w, h, layer = 0,.*source = null\) \{)" if is_base_effect else r"(    _spawnBlock\(x, y, w, h, layer, bypassOccupancy = false, source = null\) \{)"
    repl_sb = r"\1\n        if (source && typeof source === 'string' && this.growthPool) {\n            const b = this.growthPool.get(source);\n            if (b && b.bias === 'wider') {\n                if (w === 1) w = 2 + Math.floor(Math.random() * 2);\n                if (h === 1) h = 2 + Math.floor(Math.random() * 2);\n            }\n        }"
    content = re.sub(pattern_sb, repl_sb, content)

    # 5. Main Nudge Growth update
    nudge_pattern = r"(const \{ bw, bh \} = this\._calcBlockSize\(.*?\), s\.fillRatio\);)\s*(this\._attemptNudgeGrowthWithParams\(.*?, bw, bh, .*?\);)"
    def nudge_repl(m):
        return f"{m.group(1)}\n                    const maxL = this._getMaxLayer();\n                    for (let l = 0; l <= maxL; l++) {{\n                        this._attemptNudgeGrowthWithParams(l, bw, bh, {('s.genOriginX, s.genOriginY' if is_base_effect else 's.scx, s.scy')});\n                    }}"
    content = re.sub(nudge_pattern, nudge_repl, content)

    # 6. Growth constraints
    content = content.replace("const onSpine = onXSpine || onYSpine;\n", "const onSpine = onXSpine || onYSpine;\n                    if (behavior && behavior.growth === 'spine' && !onSpine) return false;\n")
    content = content.replace("if (!onSpine && !onOuterPerimeter) return false;\n", "if (behavior && behavior.growth === 'edge' && !onOuterPerimeter) return false;\n                    if (!onSpine && !onOuterPerimeter) return false;\n")

    # 7. Layer-specific state
    content = content.replace("if (!s.shoveStrips) s.shoveStrips = [];", "if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];")
    content = content.replace("s.shoveStrips", "s.shoveStripsByLayer[layer]")
    content = content.replace("s.spreadingNudgeSymmetryQueue", "s[`spreadingNudgeSymmetryQueue_${layer}`]")
    content = content.replace("s.spreadingNudgeNextSpawnStep", "s[`spreadingNudgeNextSpawnStep_${layer}`]")
    content = content.replace("s.spreadingNudgeNextDist", "s[`spreadingNudgeNextDist_${layer}`]")
    content = content.replace("s.spreadingNudgeCycles", "s[`spreadingNudgeCycles_${layer}`]")
    content = content.replace("s.axisShiftAxes", "s[`axisShiftAxes_${layer}`]")
    content = content.replace("s.axisShiftCandidates", "s[`axisShiftCandidates_${layer}`]")
    content = content.replace("s.axisShiftNextStep", "s[`axisShiftNextStep_${layer}`]")
    content = content.replace("s.holeQIdx", "s[`holeQIdx_${layer}`]")

    # 8. _tickLayerDirs
    content = re.sub(r"_tickLayerDirs\(s\) \{.*?\}", 
                     "_tickLayerDirs(s) {\n        for (let l = 0; l <= 1; l++) {\n            if (s.layerDirLife && s.layerDirLife[l] > 0) {\n                s.layerDirLife[l]--;\n                if (s.layerDirLife[l] <= 0) {\n                    s.layerDirs[l] = this._pickLayerDirs(4);\n                    s.layerDirLife[l] = 4 + l;\n                }\n            }\n        }\n    }", 
                     content, flags=re.DOTALL)

    # 9. RE-DECLARATION CLEANUP (Very thorough)
    content = re.sub(r'^\s*(const|let)\s+layer\s*=\s*(layer|l|targetLayer|targetLayerIndex|1);.*?\n', '', content, flags=re.MULTILINE)
    content = content.replace("const targetLayer = l;", "")
    content = content.replace("const targetLayer = 1;", "")
    content = content.replace("const targetLayer = layer;", "")
    content = content.replace("const layer = l;", "")
    
    # Standardize _attemptNudgeGrowthWithParams
    content = content.replace("_attemptNudgeGrowthWithParams(targetLayer,", "_attemptNudgeGrowthWithParams(layer,")
    # Fix the internal hole_filler loop
    content = content.replace("for (let l = 0; l <= 1; l++)", "const l = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

apply_clean_changes('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
apply_clean_changes('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
