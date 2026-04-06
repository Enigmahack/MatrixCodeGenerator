import re

def dedup_config_template():
    path = 'MatrixCode_v10.0/js/config/ConfigTemplate.js'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    seen_ids = set()
    new_lines = []
    
    # regex to find id: 'SomeID'
    id_pattern = re.compile(r"id:\s*'([^']+)'")
    
    for line in lines:
        match = id_pattern.search(line)
        if match:
            id_val = match.group(1)
            # We only want to deduplicate the specific ones we added
            if any(id_val.endswith(suffix) for suffix in ['BehaviorType', 'GrowthMode', 'SpawnBias']):
                if id_val in seen_ids:
                    continue
                seen_ids.add(id_val)
        new_lines.append(line)
        
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"Deduplicated {path}")

def dedup_configuration_manager():
    path = 'MatrixCode_v10.0/js/config/ConfigurationManager.js'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    seen_keys = set()
    new_lines = []
    
    # regex to find "Key":
    key_pattern = re.compile(r'^\s*"([^"]+)"\s*:')
    
    for line in lines:
        match = key_pattern.search(line)
        if match:
            key_val = match.group(1)
            # Again, only deduplicate our new fields
            if any(key_val.endswith(suffix) for suffix in ['BehaviorType', 'GrowthMode', 'SpawnBias']):
                if key_val in seen_keys:
                    continue
                seen_keys.add(key_val)
        new_lines.append(line)
        
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"Deduplicated {path}")

if __name__ == "__main__":
    dedup_config_template()
    dedup_configuration_manager()
