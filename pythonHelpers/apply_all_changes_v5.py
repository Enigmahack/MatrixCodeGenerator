import re

def apply_final_changes(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    cfg = "this.getConfig" if is_base_effect else "this._getConfig"
    gcfg = "this._getGenConfig" if is_base_effect else "this._getConfig"

    # 1. getMaxLayer (min 1, max 2 in UI -> internal 0, 1)
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

    # 3. Behavior definitions
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
        content = content.replace(f"label: '{l}'", new_opts)

    # Function signatures
    # (Do this AFTER label replacement to avoid recursion)
    content = content.replace("function(s, behavior) {", "function(s, behavior, layer) {")
    content = content.replace("function(s) {", "function(s, behavior, layer) {")

    # 4. State updates (Word boundary aware)
    def sub_state(c, old, new):
        return re.sub(rf'\b{re.escape(old)}\b', new, c)

    content = sub_state(content, "s.shoveStrips", "s.shoveStripsByLayer[layer]")
    content = content.replace("if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];", "if (!s.shoveStripsByLayer) s.shoveStripsByLayer = {}; if (!s.shoveStripsByLayer[layer]) s.shoveStripsByLayer[layer] = [];")
    
    content = sub_state(content, "s.spreadingNudgeSymmetryQueue", "s[`spreadingNudgeSymmetryQueue_${layer}`]")
    content = sub_state(content, "s.spreadingNudgeNextSpawnStep", "s[`spreadingNudgeNextSpawnStep_${layer}`]")
    content = sub_state(content, "s.spreadingNudgeNextDist", "s[`spreadingNudgeNextDist_${layer}`]")
    content = sub_state(content, "s.spreadingNudgeCycles", "s[`spreadingNudgeCycles_${layer}`]")
    content = sub_state(content, "s.axisShiftAxes", "s[`axisShiftAxes_${layer}`]")
    content = sub_state(content, "s.axisShiftCandidates", "s[`axisShiftCandidates_${layer}`]")
    content = sub_state(content, "s.axisShiftNextStep", "s[`axisShiftNextStep_${layer}`]")
    content = sub_state(content, "s.holeQIdx", "s[`holeQIdx_${layer}`]")

    # 5. Initialization block for spreading nudge
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
    content = re.sub(r"// State Initialization\s*if \(!s\.spreadingNudgeNextDist\) \{.*?\}", sn_init, content, flags=re.DOTALL)

    # 6. _tickLayerDirs
    content = re.sub(r"_tickLayerDirs\(s\) \{.*?\}", 
                     "_tickLayerDirs(s) {\n        for (let l = 0; l <= 1; l++) {\n            if (s.layerDirLife && s.layerDirLife[l] > 0) {\n                s.layerDirLife[l]--;\n                if (s.layerDirLife[l] <= 0) {\n                    s.layerDirs[l] = this._pickLayerDirs(4);\n                    s.layerDirLife[l] = 4 + l;\n                }\n            }\n        }\n    }", 
                     content, flags=re.DOTALL)

    # 7. Redeclaration Cleanup
    content = re.sub(r'^\s*(const|let)\s+layer\s*=\s*(1|l|targetLayer|targetLayerIndex);.*?\n', '', content, flags=re.MULTILINE)
    content = content.replace("const targetLayer = 1;", "")
    content = content.replace("const targetLayer = l;", "")
    content = content.replace("const targetLayer = layer;", "")
    content = content.replace("const layer = l;", "")
    
    # Standardize _attemptNudgeGrowthWithParams
    content = content.replace("_attemptNudgeGrowthWithParams(targetLayer,", "_attemptNudgeGrowthWithParams(layer,")
    # Fix the internal hole_filler loop
    content = content.replace("for (let l = 0; l <= 1; l++)", "const l = layer;")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

apply_final_changes('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
apply_final_changes('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
