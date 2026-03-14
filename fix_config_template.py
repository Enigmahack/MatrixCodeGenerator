import re

with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "r") as f:
    content = f.read()

# I need to add the new generator settings to the overrides logic

# First, find QuantizedInheritableSettings
# Add the generator settings to the list

generator_settings = """
    { sub: 'V2 Generator', sub_header: 'Generator Core', id: 'SpineBoost', type: 'range', label: 'Spine Boost Multiplier', min: 1, max: 10, step: 1, tier: 'advanced', description: "Boosts growth probability along the central X/Y spines of the cross.", tags: ['growth', 'spine'] },
    { sub: 'V2 Generator', id: 'FillThreshold', type: 'range', label: 'Fill Threshold', min: 0.1, max: 1.0, step: 0.05, tier: 'advanced', description: "Fill ratio threshold before maximum block scaling limits apply.", tags: ['growth', 'scale', 'threshold'] },
    { sub: 'V2 Generator', id: 'MaxBlockScale', type: 'range', label: 'Max Block Scale', min: 1, max: 10, step: 1, tier: 'advanced', description: "Maximum block size multiplier once threshold is reached.", tags: ['growth', 'scale'] },
    { sub: 'V2 Generator', id: 'GenerativeScaling', type: 'checkbox', label: 'Generative Scaling', tier: 'advanced', description: "Dynamically scale block size/speed based on aspect ratio.", tags: ['growth', 'scale', 'auto'] },
    { sub: 'V2 Generator', id: 'AllowAsymmetry', type: 'checkbox', label: 'Allow Asymmetry', tier: 'advanced', description: "Allows uneven growth speeds across the axes.", tags: ['growth', 'uneven'] },
    { sub: 'V2 Generator', id: 'QuadrantCount', type: 'range', label: 'Max Direction Count', min: 1, max: 4, step: 1, tier: 'advanced', description: "Maximum number of allowed growth directions at any one time.", tags: ['growth', 'directions'] },
    
    { sub: 'V2 Generator (Sub-Behaviors)', sub_header: 'Block Spawner/Despawner', id: 'BlockSpawnerEnabled', type: 'checkbox', label: 'Enable Spawner', tier: 'advanced', description: "Randomly spawns and despawns blocks outside the main edge.", tags: ['spawn', 'despawn'] },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'BlockSpawnerStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, dep: 'BlockSpawnerEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'BlockSpawnerRate', type: 'range', label: 'Spawn Rate', min: 1, max: 50, step: 1, dep: 'BlockSpawnerEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'BlockSpawnerCount', type: 'range', label: 'Max Spawns per Rate', min: 1, max: 20, step: 1, dep: 'BlockSpawnerEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'BlockSpawnerDespawnRate', type: 'range', label: 'Despawn Rate', min: 1, max: 50, step: 1, dep: 'BlockSpawnerEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'BlockSpawnerDespawnCount', type: 'range', label: 'Max Despawns per Rate', min: 1, max: 20, step: 1, dep: 'BlockSpawnerEnabled', tier: 'advanced' },

    { sub: 'V2 Generator (Sub-Behaviors)', sub_header: 'Spreading Nudge', id: 'SpreadingNudgeEnabled', type: 'checkbox', label: 'Enable Spreading Nudge', tier: 'advanced', description: "Sends 'nudges' outward along the spines.", tags: ['nudge', 'spine'] },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, dep: 'SpreadingNudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeChance', type: 'range', label: 'Nudge Chance', min: 0.1, max: 1.0, step: 0.1, dep: 'SpreadingNudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeSpawnSpeed', type: 'range', label: 'Spawn Speed', min: 1, max: 10, step: 1, dep: 'SpreadingNudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeMaxInstances', type: 'range', label: 'Max Nudge Instances', min: 1, max: 100, step: 1, dep: 'SpreadingNudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeRange', type: 'range', label: 'Nudge Spread Range', min: 0.1, max: 1.0, step: 0.1, dep: 'SpreadingNudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'SpreadingNudgeSymmetry', type: 'checkbox', label: 'Enforce Symmetry', dep: 'SpreadingNudgeEnabled', tier: 'advanced' },

    { sub: 'V2 Generator (Sub-Behaviors)', sub_header: 'Shove Fill', id: 'ShoveFillEnabled', type: 'checkbox', label: 'Enable Shove Fill', tier: 'advanced', description: "Fills large blocks aggressively.", tags: ['fill', 'shove'] },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'ShoveFillStartDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, dep: 'ShoveFillEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'ShoveFillRate', type: 'range', label: 'Fill Rate', min: 1, max: 50, step: 1, dep: 'ShoveFillEnabled', tier: 'advanced' },

    { sub: 'V2 Generator (Sub-Behaviors)', sub_header: 'Hole Filler', id: 'HoleFillerEnabled', type: 'checkbox', label: 'Enable Hole Filler', tier: 'advanced', description: "Actively searches for and fills enclosed holes.", tags: ['hole', 'fill'] },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'HoleFillerRate', type: 'range', label: 'Fill Rate', min: 1, max: 50, step: 1, dep: 'HoleFillerEnabled', tier: 'advanced' },
    
    { sub: 'V2 Generator (Sub-Behaviors)', sub_header: 'Inside Out Expansion', id: 'InsideOutEnabled', type: 'checkbox', label: 'Enable Inside Out Expansion', tier: 'advanced', description: "Starts a secondary expansion from the inside after a delay.", tags: ['expand', 'inside'] },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'InsideOutDelay', type: 'range', label: 'Start Delay', min: 0, max: 100, step: 1, dep: 'InsideOutEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'InsideOutBucketSize', type: 'range', label: 'Bucket Size', min: 1, max: 10, step: 1, dep: 'InsideOutEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Sub-Behaviors)', id: 'InsideOutStepsBetweenBuckets', type: 'range', label: 'Steps Between Buckets', min: 1, max: 20, step: 1, dep: 'InsideOutEnabled', tier: 'advanced' },

    { sub: 'V2 Generator (Core)', sub_header: 'Other Generator Settings', id: 'NudgeEnabled', type: 'checkbox', label: 'Enable Main Nudge', tier: 'advanced', description: "Enables core nudge behaviors along spines.", tags: ['nudge'] },
    { sub: 'V2 Generator (Core)', id: 'NudgeStartDelay', type: 'range', label: 'Nudge Start Delay', min: 0, max: 100, step: 1, dep: 'NudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Core)', id: 'NudgeChance', type: 'range', label: 'Nudge Chance', min: 0.1, max: 1.0, step: 0.1, dep: 'NudgeEnabled', tier: 'advanced' },
    { sub: 'V2 Generator (Core)', id: 'L3AllowNudges', type: 'checkbox', label: 'Allow L3 Nudges', tier: 'advanced', description: "Allows L3 (temporary) nudges.", tags: ['nudge', 'l3'] },
    { sub: 'V2 Generator (Core)', id: 'ShiftFrequency', type: 'range', label: 'Shift Frequency', min: 1, max: 10, step: 1, tier: 'advanced', description: "Controls how often quadrants attempt to shift/grow in a blocky manner.", tags: ['shift', 'growth'] },
    { sub: 'V2 Generator (Core)', id: 'ShiftMaxThickness', type: 'range', label: 'Shift Max Thickness', min: 1, max: 20, step: 1, tier: 'advanced', description: "Maximum allowed thickness for shifted blocks.", tags: ['shift', 'thickness'] },
"""

insert_index = content.find("];\n\nconst generateQuantizedEffectSettings")
new_content = content[:insert_index] + generator_settings + content[insert_index:]

with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "w") as f:
    f.write(new_content)
