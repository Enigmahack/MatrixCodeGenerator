import re

def fix_sources(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    content = content.replace("'block_spawner'", "'block_spawner_despawner'")
    content = content.replace(", 'block_thicken'", ", 'block_thicken'") # already fine
    content = content.replace(", 'hole_filler'", ", 'hole_filler'") # already fine
    content = content.replace(", 'shove_fill'", ", 'shove_fill'") # already fine

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_sources('MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js')
fix_sources('MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js')
