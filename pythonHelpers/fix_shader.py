import re

def fix_shader(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Mode 1 (Composite): Remove brightDeltaB and make Layer 1 identical to Layer 0
    # Find brightDeltaB initialization
    content = content.replace("float brightDeltaB = 0.0;", "float brightDeltaB = 0.0; // Synchronized")
    
    # Remove the logic that set brightDeltaB to -0.3
    content = re.sub(r"brightDeltaB = \(l0occ > 0\.01\) \? -0\.3 : 0\.0;", "brightDeltaB = 0.0;", content)

    # 2. Mode 0 (Generate): Remove fadeMax distinction
    # Old logic: if (isS123 && a0NW > 0.01 && a0NE > 0.01) { fadeMax = max(fadeMax, val); } else { normalMax = max(normalMax, val); }
    # We want everything to go to normalMax.
    
    # I'll use a more targeted replacement for the mode 0 loop body
    pattern = r"if \(isS123 && a0NW > 0\.01 && a0NE > 0\.01\) \{\s*fadeMax = max\(fadeMax, val\);\s*\} else \{\s*normalMax = max\(normalMax, val\);\s*\}"
    content = re.sub(pattern, "normalMax = max(normalMax, val);", content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_shader('MatrixCode_v10.0/js/rendering/WebGLRenderer.js')
