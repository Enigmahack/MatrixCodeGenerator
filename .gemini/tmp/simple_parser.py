import re
import sys

def parse_settings(file_path):
    with open(file_path, 'r') as f:
        lines = f.readlines()

    categories = {}

    for line in lines:
        line = line.strip()
        if not line.startswith('{'):
            continue

        def extract(key):
            # Regex explanation:
            # 1. Match the key followed by colon: key:\s*
            # 2. Group 1: Quoted string: [\'"']([^'"']+)['"']
            # 3. OR (|)
            # 4. Group 2: Unquoted value until comma or closing brace: ([^,}}]+)
            pattern = r"{}:
                s*(?:['"]([^'"]+)['"]|([^,}}]+))".format(key)
            match = re.search(pattern, line)
            if match:
                return match.group(1) or match.group(2)
            return None

        cat = extract('cat')
        type_val = extract('type')
        label = extract('label')
        id_val = extract('id')
        action = extract('action')
        
        if label: label = label.strip()
        if cat: cat = cat.strip()

        if not cat: continue

        if cat not in categories:
            categories[cat] = []

        item = {
            'type': type_val,
            'label': label,
            'id': id_val,
            'action': action,
            'line': line
        }
        categories[cat].append(item)

    print("# Matrix Code v7.1 - Current Settings Structure\n")
    
    for cat, items in categories.items():
        print(f"## Category: {cat}")
        for item in items:
            t = item['type']
            l = item['label']
            
            if t == 'header':
                print(f"\n### {l}")
            elif t == 'button':
                print(f"- **[Button] {l}** (Action: `{item['action']}`)")
            elif t == 'slot':
                # quick extract idx
                m = re.search(r"idx:\s*(\d+)", item['line'])
                idx = int(m.group(1)) + 1 if m else "?"
                print(f"- **[System] Save Slot {idx}**")
            elif t == 'font_list':
                print(f"- **[List] Font Manager List**")
            elif t == 'about_content':
                print(f"- **[Info] About Content Block**")
            elif item['id']:
                print(f"- **{l}** (ID: `{item['id']}`, Type: `{t}`)")
            else:
                print(f"- **{l}** (Type: `{t}`)")
        print("")

if __name__ == "__main__":
    parse_settings("/Users/enigma/.gemini/tmp/31fd1d63ed5416b0b59ee80d4ef1ad978703547e6e40603edb8cd95d95f93070/extracted_defs.js")