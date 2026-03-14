import re

with open("MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js", "r") as f:
    content = f.read()

replacement = """        // 2. Otherwise (Override is ON, or it's not inheritable), use the effect-specific key.
        if (val !== undefined && val !== null && val !== "") return val;

        // 3. Fallback to quantizedGenerateV2 for generative settings (if not already the prefix)
        if (prefix !== 'quantizedGenerateV2') {
            const genKey = 'quantizedGenerateV2' + keySuffix;
            const genVal = this.config[genKey];
            if (genVal !== undefined && genVal !== null && genVal !== "") return genVal;
        }"""

content = content.replace('        // 2. Otherwise (Override is ON, or it\'s not inheritable), use the effect-specific key.\n        if (val !== undefined && val !== null && val !== "") return val;', replacement)

# Let's also check if there's any remaining direct reference to `quantizedGenerateV2` inside that file
content = re.sub(r"this\.config\.quantizedGenerateV2([A-Za-z0-9_]+)", r"this._getConfig('\1')", content)

with open("MatrixCode_v8.5/js/effects/QuantizedSequenceGeneratorV2.js", "w") as f:
    f.write(content)
