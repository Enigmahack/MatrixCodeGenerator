import re

def add_bias_to_spawn(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # In QuantizedBaseEffect
    pattern1 = r"(    _spawnBlock\(x, y, w, h, layer = 0, isShifter = false, expireFrames = 0, skipConnectivity = false, allowInternal = false, suppressFades = false, isMirroredSpawn = false, bypassOccupancy = false, source = null\) \{\n)"
    replacement1 = r"\1        if (source && typeof source === 'string' && this.growthPool) {\n            const b = this.growthPool.get(source);\n            if (b && b.bias === 'wider') {\n                if (w === 1) w = 2 + Math.floor(Math.random() * 2);\n                if (h === 1) h = 2 + Math.floor(Math.random() * 2);\n            }\n        }\n"
    content = re.sub(pattern1, replacement1, content)
    
    # In QuantizedSequenceGeneratorV2
    pattern2 = r"(    _spawnBlock\(x, y, w, h, layer, bypassOccupancy = false, source = null\) \{\n)"
    replacement2 = r"\1        if (source && typeof source === 'string' && this.growthPool) {\n            const b = this.growthPool.get(source);\n            if (b && b.bias === 'wider') {\n                if (w === 1) w = 2 + Math.floor(Math.random() * 2);\n                if (h === 1) h = 2 + Math.floor(Math.random() * 2);\n            }\n        }\n"
    content = re.sub(pattern2, replacement2, content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

add_bias_to_spawn('MatrixCode_v10.0/js/effects/QuantizedBaseEffect.js')
add_bias_to_spawn('MatrixCode_v10.0/js/effects/QuantizedSequenceGeneratorV2.js')
