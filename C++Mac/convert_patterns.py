import json
import re

def convert():
    with open('MatrixCode_v8.5/js/effects/QuantizedPatterns.js', 'r') as f:
        content = f.read()

    match = re.search(r'window\.matrixPatterns = (\{.*?\});', content, re.DOTALL)
    if not match:
        print("Could not find matrixPatterns object")
        return

    json_str = match.group(1)
    json_str = re.sub(r',\s*([\]}])', r'\1', json_str)
    json_str = re.sub(r'(\w+):', r'"\1":', json_str)
    
    try:
        patterns = json.loads(json_str)
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        return

    with open('C++Mac/QuantizedPatterns.hpp', 'w') as f:
        f.write("#pragma once\n\n")
        f.write("#include <vector>\n")
        f.write("#include <string>\n")
        f.write("#include <unordered_map>\n\n")
        f.write("namespace Matrix {\n\n")
        
        f.write("typedef std::vector<int> StepData;\n")
        f.write("typedef std::vector<StepData> PatternData;\n\n")
        
        f.write("inline const std::unordered_map<std::string, PatternData>& GetPatterns() {\n")
        f.write("    static std::unordered_map<std::string, PatternData> patterns;\n")
        f.write("    if (!patterns.empty()) return patterns;\n\n")
        
        for name, data in patterns.items():
            f.write(f'    patterns["{name}"] = {{\n')
            for step in data:
                f.write('        {')
                f.write(', '.join(map(str, step)))
                f.write('},\n')
            f.write('    };\n\n')
            
        f.write("    return patterns;\n")
        f.write("}\n\n")
        f.write("} // namespace Matrix\n")

if __name__ == "__main__":
    convert()
