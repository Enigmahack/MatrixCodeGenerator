import re

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'r', encoding='utf-8') as f:
    cm = f.read()

def remove_duplicates(cm):
    lines = cm.split('\n')
    seen = set()
    new_lines = []
    for line in lines:
        match = re.search(r'^\s*"([^"]+)":', line)
        if match:
            key = match.group(1)
            if key in seen:
                continue
            seen.add(key)
        new_lines.append(line)
    return '\n'.join(new_lines)

cm = remove_duplicates(cm)

with open('MatrixCode_v8.5/js/config/ConfigurationManager.js', 'w', encoding='utf-8') as f:
    f.write(cm)
