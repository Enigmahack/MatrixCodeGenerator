with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "r") as f:
    lines = f.readlines()

new_lines = []
in_generator_settings_func = False

for i, line in enumerate(lines):
    if "const generateQuantizedEffectSettings =" in line:
        in_generator_settings_func = True
    if "return settings;" in line and in_generator_settings_func:
        # End of func
        # in_generator_settings_func = False # will do it after append
        pass
    
    # Check for the line to remove if it's outside the func
    if "if (prefix === 'quantizedGenerateV2' && s.sub.startsWith('V2 Generator')) return;" in line:
        if not in_generator_settings_func:
            # Skip this line!
            continue
    
    new_lines.append(line)
    if "return settings;" in line and in_generator_settings_func:
        in_generator_settings_func = False

with open("MatrixCode_v8.5/js/config/ConfigTemplate.js", "w") as f:
    f.writelines(new_lines)
