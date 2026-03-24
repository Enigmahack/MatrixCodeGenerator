import re

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'r', encoding='utf-8') as f:
    cm = f.read()

behaviors = [
    'BlockSpawner',
    'SpreadingNudge',
    'ShoveFill',
    'HoleFiller',
    'BlockThicken',
    'AxisShift'
]

# Specifically replace in the `quantizedDefault` and `quantizedGenerateV2` sections of the defaults object.
for prefix in ['quantizedDefault', 'quantizedGenerateV2']:
    for b in behaviors:
        # Match something like: "quantizedDefaultBlockSpawnerEnabled": true,
        pattern = rf'(            "{prefix}{b}Enabled": (true|false),)'
        
        def replacer(match):
            val = match.group(2)
            return f"""            "{prefix}{b}Enabled": {val},
            "{prefix}{b}BehaviorType": "pool",
            "{prefix}{b}GrowthMode": "edge",
            "{prefix}{b}SpawnBias": "single","""
        
        cm = re.sub(pattern, replacer, cm)

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'w', encoding='utf-8') as f:
    f.write(cm)

