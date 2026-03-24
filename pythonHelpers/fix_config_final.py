import re

def fix_configuration_manager():
    path = 'MatrixCode_v8.5/js/config/ConfigurationManager.js'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Define behaviors and their defaults
    # For simplicity, I'll insert them after another behavioral setting that exists
    behaviors_to_ensure = [
        'BlockSpawner',
        'SpreadingNudge',
        'ShoveFill',
        'HoleFiller',
        'BlockThicken',
        'AxisShift'
    ]

    for prefix in ['quantizedDefault', 'quantizedGenerateV2']:
        for b in behaviors_to_ensure:
            enabled_key = f"{prefix}{b}Enabled"
            type_key = f"{prefix}{b}BehaviorType"
            growth_key = f"{prefix}{b}GrowthMode"
            bias_key = f"{prefix}{b}SpawnBias"
            
            # If the Enabled key is missing, we need to add it.
            # I'll find a common anchor in each section.
            if enabled_key not in content:
                # Anchor for quantizedDefault: "quantizedDefaultQuadrantCount": "4",
                if prefix == 'quantizedDefault':
                    anchor = r'("quantizedDefaultQuadrantCount": "4",)'
                else:
                    anchor = r'("quantizedGenerateV2MergeDelay": true,)'
                
                insertion = f'\n            "{enabled_key}": false,\n            "{type_key}": "pool",\n            "{growth_key}": "edge",\n            "{bias_key}": "single",'
                content = re.sub(anchor, r"\1" + insertion, content)
            else:
                # If Enabled key is there, ensure Type/Growth/Bias are also there (not duplicated)
                # I'll remove any existing ones and re-insert to be sure
                pattern = rf'            "{enabled_key}": (true|false),.*?\n'
                # Find the existing value
                match = re.search(pattern, content)
                if match:
                    val = match.group(1)
                    # Remove any existing behavior/growth/bias keys immediately following it
                    # (This also handles my previous duplication issue)
                    sub_pattern = rf'            "{enabled_key}": (true|false),\s*(?:            "{prefix}{b}(?:BehaviorType|GrowthMode|SpawnBias)": "[^"]+",\s*)*'
                    replacement = f'            "{enabled_key}": {val},\n            "{type_key}": "pool",\n            "{growth_key}": "edge",\n            "{bias_key}": "single",\n'
                    content = re.sub(sub_pattern, replacement, content, flags=re.MULTILINE)

    # Finally, deduplicate the entire file based on keys just in case.
    # But ONLY for the behavioral keys we just touched.
    lines = content.split('\n')
    seen_keys = set()
    new_lines = []
    for line in lines:
        match = re.search(r'^\s*"([^"]+)":', line)
        if match:
            key = match.group(1)
            if any(key.endswith(s) for s in ['BehaviorType', 'GrowthMode', 'SpawnBias']):
                if key in seen_keys:
                    continue
                seen_keys.add(key)
        new_lines.append(line)
    content = '\n'.join(new_lines)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Fixed behaviors in {path}")

if __name__ == "__main__":
    fix_configuration_manager()
