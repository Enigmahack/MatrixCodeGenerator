import re

def fix_generator(filepath, is_base_effect=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update registerBehavior
    old_register = r"registerBehavior\(id,\s*fn,\s*options\s*=\s*\{\}\)\s*\{\s*this\.growthPool\.set\(id,\s*\{\s*fn:\s*fn,\s*enabled:\s*options\.enabled\s*\?\?\s*true,\s*label:\s*options\.label\s*\|\|\s*id\s*\}\);\s*\}"
    new_register = """registerBehavior(id, fn, options = {}) {
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
    content = re.sub(old_register, new_register, content)

    # 2. Update the update loop
    # For QuantizedBaseEffect
    if is_base_effect:
        # Replace the execution loop for QuantizedBaseEffect
        old_loop_pattern = r"// Axis Shift: tick deterministically every step.*?if \(enabledBehaviors\.length > 0\) \{\s*for \(let q = 0; q < quota; q\+\+\) \{\s*const b = enabledBehaviors\[Math\.floor\(Math\.random\(\) \* enabledBehaviors\.length\)\];\s*b\.fn\.call\(this, s\);\s*\}\s*\}"
        new_loop = """// INCREMENT AGE OF ALL ACTIVE BLOCKS
        for (const b of this.activeBlocks) b.stepAge = (b.stepAge || 0) + 1;

        const quota = this.getConfig('SimultaneousSpawns') || 1;
        if (!this._enabledPoolBehaviorsBuf) this._enabledPoolBehaviorsBuf = [];
        const poolBehaviors = this._enabledPoolBehaviorsBuf;
        poolBehaviors.length = 0;

        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled) {
                if (b.type === 'core') {
                    // Core runs every step
                    b.fn.call(this, s, b);
                } else {
                    poolBehaviors.push(b);
                }
            }
        }

        if (poolBehaviors.length > 0) {
            // "pool" runs based on scheduler (quadrant population)
            const qCount = parseInt(this._getGenConfig('QuadrantCount') ?? 4);
            const dynamicQuota = Math.max(1, Math.floor(quota * (qCount / 4)));
            for (let q = 0; q < dynamicQuota; q++) {
                const b = poolBehaviors[Math.floor(Math.random() * poolBehaviors.length)];
                b.fn.call(this, s, b);
            }
        }"""
        content = re.sub(old_loop_pattern, new_loop, content, flags=re.DOTALL)
    else:
        # For QuantizedSequenceGeneratorV2
        old_loop_pattern = r"const quota = this\._getConfig\('SimultaneousSpawns'\) \|\| 1;\s*const enabledBehaviors = \[\.\.\.this\.growthPool\.values\(\)\]\.filter\(b => b\.fn && b\.enabled\);\s*if \(enabledBehaviors\.length > 0\) \{\s*for \(let q = 0; q < quota; q\+\+\) \{\s*const b = enabledBehaviors\[Math\.floor\(Math\.random\(\) \* enabledBehaviors\.length\)\];\s*b\.fn\.call\(this, s\);\s*\}\s*\}"
        new_loop = """const quota = this._getConfig('SimultaneousSpawns') || 1;
        const poolBehaviors = [];
        for (const b of this.growthPool.values()) {
            if (b.fn && b.enabled) {
                if (b.type === 'core') {
                    b.fn.call(this, s, b);
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
                b.fn.call(this, s, b);
            }
        }"""
        content = re.sub(old_loop_pattern, new_loop, content, flags=re.DOTALL)

    # 3. Update behavior config loading
    # Finding block_spawner_despawner options dict
    def replace_behavior_config(match):
        label = match.group(1)
        config_prefix = match.group(2)
        return f""", type: this._getGenConfig('{config_prefix}BehaviorType') ?? 'pool', growth: this._getGenConfig('{config_prefix}GrowthMode') ?? 'edge', bias: this._getGenConfig('{config_prefix}SpawnBias') ?? 'single', label: {label}"""
    
    # We will replace all occurrences of `label: 'Something'` inside registerBehavior to include type, growth, bias
    content = re.sub(r", label: ('Block Spawner/Despawner')", r", type: this._getGenConfig('BlockSpawnerBehaviorType') ?? 'pool', growth: this._getGenConfig('BlockSpawnerGrowthMode') ?? 'edge', bias: this._getGenConfig('BlockSpawnerSpawnBias') ?? 'single', label: \1", content)
    content = re.sub(r", label: ('Spreading Nudge')", r", type: this._getGenConfig('SpreadingNudgeBehaviorType') ?? 'pool', growth: this._getGenConfig('SpreadingNudgeGrowthMode') ?? 'edge', bias: this._getGenConfig('SpreadingNudgeSpawnBias') ?? 'single', label: \1", content)
    content = re.sub(r", label: ('Shove Fill')", r", type: this._getGenConfig('ShoveFillBehaviorType') ?? 'pool', growth: this._getGenConfig('ShoveFillGrowthMode') ?? 'edge', bias: this._getGenConfig('ShoveFillSpawnBias') ?? 'single', label: \1", content)
    content = re.sub(r", label: ('Aggressive Hole Filler')", r", type: this._getGenConfig('HoleFillerBehaviorType') ?? 'pool', growth: this._getGenConfig('HoleFillerGrowthMode') ?? 'edge', bias: this._getGenConfig('HoleFillerSpawnBias') ?? 'single', label: \1", content)
    content = re.sub(r", label: ('Block Thicken')", r", type: this._getGenConfig('BlockThickenBehaviorType') ?? 'pool', growth: this._getGenConfig('BlockThickenGrowthMode') ?? 'edge', bias: this._getGenConfig('BlockThickenSpawnBias') ?? 'single', label: \1", content)
    content = re.sub(r", label: ('Axis Shift')", r", type: this._getGenConfig('AxisShiftBehaviorType') ?? 'pool', growth: this._getGenConfig('AxisShiftGrowthMode') ?? 'edge', bias: this._getGenConfig('AxisShiftSpawnBias') ?? 'single', label: \1", content)

    # For SequenceGeneratorV2 it uses this._getConfig
    content = re.sub(r", label: ('Block Spawner/Despawner') \}\);", r", type: gen._getConfig('BlockSpawnerBehaviorType') ?? 'pool', growth: gen._getConfig('BlockSpawnerGrowthMode') ?? 'edge', bias: gen._getConfig('BlockSpawnerSpawnBias') ?? 'single', label: \1 });", content)
    content = re.sub(r", label: ('Spreading Nudge') \}\);", r", type: gen._getConfig('SpreadingNudgeBehaviorType') ?? 'pool', growth: gen._getConfig('SpreadingNudgeGrowthMode') ?? 'edge', bias: gen._getConfig('SpreadingNudgeSpawnBias') ?? 'single', label: \1 });", content)
    content = re.sub(r", label: ('Shove Fill') \}\);", r", type: gen._getConfig('ShoveFillBehaviorType') ?? 'pool', growth: gen._getConfig('ShoveFillGrowthMode') ?? 'edge', bias: gen._getConfig('ShoveFillSpawnBias') ?? 'single', label: \1 });", content)
    content = re.sub(r", label: ('Aggressive Hole Filler') \}\);", r", type: gen._getConfig('HoleFillerBehaviorType') ?? 'pool', growth: gen._getConfig('HoleFillerGrowthMode') ?? 'edge', bias: gen._getConfig('HoleFillerSpawnBias') ?? 'single', label: \1 });", content)
    content = re.sub(r", label: ('Block Thicken') \}\);", r", type: gen._getConfig('BlockThickenBehaviorType') ?? 'pool', growth: gen._getConfig('BlockThickenGrowthMode') ?? 'edge', bias: gen._getConfig('BlockThickenSpawnBias') ?? 'single', label: \1 });", content)
    content = re.sub(r", label: ('Axis Shift') \}\);", r", type: gen._getConfig('AxisShiftBehaviorType') ?? 'pool', growth: gen._getConfig('AxisShiftGrowthMode') ?? 'edge', bias: gen._getConfig('AxisShiftSpawnBias') ?? 'single', label: \1 });", content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_generator('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js', True)
fix_generator('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js', False)
