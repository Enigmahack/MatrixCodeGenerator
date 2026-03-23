import re

with open('MatrixCode_v8.5/js/config/ConfigTemplate.js', 'r', encoding='utf-8') as f:
    content = f.read()

# For each sub-behavior, we want to add Type, Growth, and Bias.
behaviors = [
    'BlockSpawner',
    'SpreadingNudge',
    'ShoveFill',
    'HoleFiller',
    'BlockThicken',
    'AxisShift'
]

for b in behaviors:
    insert_str = f"""    {{ sub: 'V2 Generator (Sub-Behaviors)', id: '{b}BehaviorType', type: 'select', label: 'Behavior Type', options: [{{label: 'Core (Every Step)', value: 'core'}}, {{label: 'Pool (Scheduled)', value: 'pool'}}], dep: '{b}Enabled', tier: 'advanced' }},
    {{ sub: 'V2 Generator (Sub-Behaviors)', id: '{b}GrowthMode', type: 'select', label: 'Growth Mode', options: [{{label: 'Edge (Outermost)', value: 'edge'}}, {{label: 'Spine (Initial)', value: 'spine'}}], dep: '{b}Enabled', tier: 'advanced' }},
    {{ sub: 'V2 Generator (Sub-Behaviors)', id: '{b}SpawnBias', type: 'select', label: 'Spawn Bias', options: [{{label: 'Single Strip', value: 'single'}}, {{label: 'Wider', value: 'wider'}}], dep: '{b}Enabled', tier: 'advanced' }},
"""
    # Find the line where the behavior is enabled
    pattern = rf"(\{{ sub: 'V2 Generator \(Sub-Behaviors\)', [^}}]*id: '{b}Enabled',.*?\}}\n)"
    content = re.sub(pattern, r"\1" + insert_str, content)

with open('MatrixCode_v8.5/js/config/ConfigTemplate.js', 'w', encoding='utf-8') as f:
    f.write(content)

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'r', encoding='utf-8') as f:
    cm = f.read()

for prefix in ['quantizedDefault', 'quantizedGenerateV2']:
    for b in behaviors:
        insert_str = f"""            "{prefix}{b}BehaviorType": "pool",
            "{prefix}{b}GrowthMode": "edge",
            "{prefix}{b}SpawnBias": "single",
"""
        pattern = rf'(            "{prefix}{b}Enabled": [a-z]+,\n)'
        cm = re.sub(pattern, r"\1" + insert_str, cm)

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'w', encoding='utf-8') as f:
    f.write(cm)
