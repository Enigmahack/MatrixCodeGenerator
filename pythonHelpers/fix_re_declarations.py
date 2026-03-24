import re

def fix_re_declarations(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    for line in lines:
        # Match "const layer = ..." or "let layer = ..." where it's a redeclaration
        if re.search(r'\b(const|let)\s+layer\s*=', line):
            # If 'layer' is also in the function signature, this line should be removed.
            # But we don't know the signature easily here.
            # However, we know we WANT to remove these re-declarations.
            if 'layer = layer' in line or 'layer = l' in line or 'layer = targetLayer' in line or 'layer = 1' in line:
                continue
        new_lines.append(line)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

fix_re_declarations('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js')
fix_re_declarations('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js')
