
import re

def parse_settings(file_path):
    with open(file_path, 'r') as f:
        lines = f.readlines()

    categories = {}

    for line in lines:
        line = line.strip()
        if not line.startswith('{'):
            continue

        # Extract Category
        m_cat = re.search(r"cat:\s*['"]([^'"]+)['"]", line)
        cat = m_cat.group(1) if m_cat else None
        if not cat: continue

        if cat not in categories:
            categories[cat] = []

        # Extract Label
        m_label = re.search(r"label:\s*['"]([^'"]+)['"]", line)
        label = m_label.group(1) if m_label else "No Label"

        # Extract Type
        m_type = re.search(r"type:\s*['"]([^'"]+)['"]", line)
        type_val = m_type.group(1) if m_type else "unknown"

        # Extract ID
        m_id = re.search(r"id:\s*['"]([^'"]+)['"]", line)
        id_val = m_id.group(1) if m_id else None

        # Extract Action
        m_action = re.search(r"action:\s*['"]([^'"]+)['"]", line)
        action = m_action.group(1) if m_action else None

        categories[cat].append({
            'label': label,
            'type': type_val,
            'id': id_val,
            'action': action,
            'line': line
        })

    print("# Matrix Code v7.1 - Current Settings Structure\n")
    
    # Defined order of categories based on standard usage if possible, or just iterate
    # The dict preserves insertion order in modern Python (3.7+)
    
    for cat, items in categories.items():
        print(f"## {cat}")
        for item in items:
            t = item['type']
            l = item['label']
            
            if t == 'header':
                print(f"\n### {l}")
            elif t == 'button':
                print(f"- **[Button] {l}** (Action: `{item['action']}`)")
            elif t == 'slot':
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
