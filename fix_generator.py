import re

with open("MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js", "r") as f:
    lines = f.readlines()

new_lines = []
inserted = False

for line in lines:
    if not inserted and "getConfig(keySuffix) {" in line:
        # We will insert _getGenConfig right BEFORE getConfig
        new_lines.append("""
    _getGenConfig(keySuffix) {
        const val = this.getConfig(keySuffix);
        if (val !== null && val !== undefined && val !== "") return val;
        
        if (this.configPrefix !== 'quantizedGenerateV2') {
            const genKey = 'quantizedGenerateV2' + keySuffix;
            const genVal = this.c.state[genKey];
            if (genVal !== undefined && genVal !== null && genVal !== "") return genVal;
        }
        
        return null;
    }

""")
        inserted = True

    # 1. Replace this.c.get('quantizedGenerateV2...') with this._getGenConfig('...')
    line = re.sub(r"this\.c\.get\('quantizedGenerateV2([A-Za-z0-9_]+)'\)", r"this._getGenConfig('\1')", line)
    
    # 2. Replace this.c.get(this.configPrefix + 'SpreadingNudge...') with this._getGenConfig('SpreadingNudge...')
    line = re.sub(r"this\.c\.get\(this\.configPrefix \+ 'SpreadingNudge([A-Za-z0-9_]+)'\)", r"this._getGenConfig('SpreadingNudge\1')", line)

    # 3. Replace s.quantizedGenerateV2... with this._getGenConfig('...')
    # careful with s['quantizedGenerateV2' + key]
    line = re.sub(r"s\.quantizedGenerateV2([A-Za-z0-9_]+)", r"this._getGenConfig('\1')", line)
    line = re.sub(r"s\['quantizedGenerateV2' \+ key\]", r"this._getGenConfig(key)", line)

    new_lines.append(line)

with open("MatrixCode_v8.5/js/effects/QuantizedBaseEffect.js", "w") as f:
    f.writelines(new_lines)
