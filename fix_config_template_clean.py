import re

with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "r") as f:
    content = f.read()

# I want to modify the loop in generateQuantizedEffectSettings
# to skip "V2 Generator" sub-sections if prefix is "quantizedGenerateV2"

replacement = """        if (prefix === 'quantizedGenerateV2' && s.sub.startsWith('V2 Generator')) return;

        if (s.sub !== currentSub) {"""

content = content.replace("        if (s.sub !== currentSub) {", replacement)

with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "w") as f:
    f.write(content)
