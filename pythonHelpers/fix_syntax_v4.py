import re

def remove_bad_lines(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    for line in lines:
        # Remove lines that declare layer if it's already in the scope
        # or if they are redundant reassignments I added.
        if re.search(r'^\s*(//\s*)?(const|let)\s+layer\s*=\s*(layer|l|targetLayer);', line):
            continue
        # Also fix the shoveStripsByLayer duplicate
        line = line.replace("s.shoveStripsByLayer[layer]ByLayer[layer]", "s.shoveStripsByLayer[layer]")
        new_lines.append(line)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

remove_bad_lines('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js')
remove_bad_lines('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js')
