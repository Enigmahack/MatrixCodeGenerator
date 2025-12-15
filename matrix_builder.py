import os
import re
import sys
import argparse
import glob
from collections import defaultdict

# --- Configuration ---

# Known core files mapping to enforce structure if regex heuristics fail or to force specific locations
CODE_MAP = {
    # Core
    'APP_VERSION': 'js/core/Utils.js',
    'Utils': 'js/core/Utils.js',
    'MatrixKernel': 'js/core/MatrixKernel.js',
    
    # Config
    'ConfigurationManager': 'js/config/ConfigurationManager.js',
    
    # Data
    'CellGrid': 'js/data/CellGrid.js',
    'DEFAULT_FONT_DATA': 'js/data/FontData.js',
    
    # Simulation
    'StreamMode': 'js/simulation/StreamModes.js',
    'StandardMode': 'js/simulation/StreamModes.js',
    'StarPowerMode': 'js/simulation/StreamModes.js',
    'RainbowMode': 'js/simulation/StreamModes.js',
    'SimulationSystem': 'js/simulation/SimulationSystem.js',
    'StreamManager': 'js/simulation/StreamManager.js',
    
    # Effects
    'EffectRegistry': 'js/effects/EffectRegistry.js',
    'AbstractEffect': 'js/effects/EffectRegistry.js',
    'PulseEffect': 'js/effects/PulseEffect.js',
    'MiniPulseEffect': 'js/effects/MiniPulseEffect.js',
    'DejaVuEffect': 'js/effects/DejaVuEffect.js',
    'FirewallEffect': 'js/effects/FirewallEffect.js',
    'SupermanEffect': 'js/effects/SupermanEffect.js',
    'ClearPulseEffect': 'js/effects/ClearPulseEffect.js',
    'BootEffect': 'js/effects/BootEffect.js',
    'CrashEffect': 'js/effects/CrashEffect.js',
    'ReverseEffect': 'js/effects/ReverseEffect.js',
    
    # UI
    'NotificationManager': 'js/ui/NotificationManager.js',
    'FontManager': 'js/ui/FontManager.js',
    'UIManager': 'js/ui/UIManager.js',
    'CharacterSelectorModal': 'js/ui/CharacterSelectorModal.js',
    
    # Rendering
    'WebGLRenderer': 'js/rendering/WebGLRenderer.js',
    'GlyphAtlas': 'js/rendering/GlyphAtlas.js',
    'PostProcessor': 'js/rendering/PostProcessor.js'
}

# Files that must be loaded first/last if no explicit dependency is found
FORCED_FIRST = [
    'js/core/Utils.js', 
    'js/config/ConfigurationManager.js', 
    'js/data/FontData.js',
    'js/data/MatrixGrid.js',
    'js/effects/EffectRegistry.js' # Base class usually here
]

FORCED_LAST = [
    'js/core/MatrixKernel.js' # Main entry point
]

def ensure_dir(file_path):
    directory = os.path.dirname(file_path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)

# --- Dependency Analysis ---

def scan_file_content(content):
    """
    Scans JS content for class definitions and dependencies.
    Returns:
        defined_classes: set of class names defined in this file
        dependencies: set of class names this file extends
    """
    defined_classes = set()
    dependencies = set()
    
    # Regex for "class ClassName" and "class ClassName extends ParentName"
    # We also handle "const ClassName =" but less common in this project's style
    class_pattern = re.compile(r'class\s+(\w+)(?:\s+extends\s+(\w+))?')
    
    for match in class_pattern.finditer(content):
        class_name = match.group(1)
        parent_name = match.group(2)
        
        defined_classes.add(class_name)
        if parent_name:
            dependencies.add(parent_name)
            
    return defined_classes, dependencies

def get_dependency_order(source_dir):
    """
    Scans all JS files in source_dir and determines a safe load order using topological sort.
    """
    files_data = {} # path -> { definitions: [], dependencies: [] }
    all_files = []
    
    # 1. Gather all files
    for root, dirs, files in os.walk(source_dir):
        if 'js' not in root and 'js' not in dirs: # optimizations
            pass
        
        for file in files:
            if file.endswith(".js"):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, source_dir).replace('\\', '/')
                
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    defs, deps = scan_file_content(content)
                    files_data[rel_path] = {'defs': defs, 'deps': deps}
                    all_files.append(rel_path)

    # 2. Build Dependency Graph (File -> File)
    # Map defined class -> file that defines it
    class_to_file = {}
    for f, data in files_data.items():
        for cls in data['defs']:
            class_to_file[cls] = f
            
    # Build edges
    adj_list = defaultdict(list)
    in_degree = defaultdict(int)
    
    # Initialize in_degree for all files
    for f in all_files:
        in_degree[f] = 0

    for f, data in files_data.items():
        for dep_cls in data['deps']:
            if dep_cls in class_to_file:
                dependency_file = class_to_file[dep_cls]
                if dependency_file != f: # Ignore self-dependency
                    adj_list[dependency_file].append(f)
                    in_degree[f] += 1
    
    # 3. Topological Sort (Kahn's Algorithm)
    queue = []
    
    # Add files with 0 in-degree
    for f in all_files:
        if in_degree[f] == 0:
            queue.append(f)
            
    sorted_files = []
    
    # Deterministic sort for queue to ensure consistent builds for independent files
    queue.sort()
    
    while queue:
        u = queue.pop(0)
        sorted_files.append(u)
        
        for v in adj_list[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v)
                queue.sort() # Keep queue sorted
                
    if len(sorted_files) != len(all_files):
        print("Warning: Cyclic dependency detected or disconnected graph. Fallback to partial sort.")
        missing = set(all_files) - set(sorted_files)
        print(f"  Unsorted files: {missing}")
        sorted_files.extend(list(missing)) # Append remaining files

    # 4. Enforce Forced Ordering (Weighted Sort)
    # Assign weights: Forced First (-100), Standard (0), Forced Last (100)
    # But we must respect dependencies! 
    # Actually, if Dependencies say A -> B, but Forced says B first... Forced wins?
    # Usually Forced First are Utils/Config which have no deps, so it aligns.
    # We will just re-arrange based on FORCED lists if they are present in the sorted list.
    
    final_list = []
    middle_list = []
    
    # Extract forced first
    for f in FORCED_FIRST:
        if f in sorted_files:
            final_list.append(f)
            sorted_files.remove(f)
            
    # Extract forced last (store for end)
    last_list = []
    for f in FORCED_LAST:
        if f in sorted_files:
            last_list.append(f)
            sorted_files.remove(f)
            
    # Remaining files go in middle (preserving topo sort order)
    final_list.extend(sorted_files)
    final_list.extend(last_list)
    
    return final_list

# --- Split Logic ---

def identify_target_file(block_content, current_hint=None):
    """
    Identifies where a block of code belongs based on class definitions.
    """
    # 1. Check for explicit map matches
    for key, path in CODE_MAP.items():
        if f"class {key}" in block_content or f"const {key}" in block_content:
            return path
            
    # 2. Check for class definitions and inheritance heuristics
    class_match = re.search(r'class\s+(\w+)(?:\s+extends\s+(\w+))?', block_content)
    if class_match:
        cls_name = class_match.group(1)
        parent_name = class_match.group(2)
        
        if cls_name.endswith('Effect'): return f"js/effects/{cls_name}.js"
        if cls_name.endswith('Mode'): return f"js/simulation/StreamModes.js" # Usually grouped
        if 'Manager' in cls_name: return f"js/ui/{cls_name}.js"
        
        if parent_name:
            if 'Effect' in parent_name: return f"js/effects/{cls_name}.js"
            
    # 3. Fallback
    return current_hint or "js/core/Utils.js" # Default dump

def split_monolith(input_file, output_dir):
    print(f"Splitting {input_file} into {output_dir}...")
    
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Extract CSS
    css_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
    if css_match:
        css_content = css_match.group(1).strip()
        css_path = os.path.join(output_dir, 'css/style.css')
        ensure_dir(css_path)
        with open(css_path, 'w', encoding='utf-8') as f:
            f.write(css_content)
        print(f"  - Extracted CSS to css/style.css")

    # 2. Extract Shaders
    # <script type="x-shader/x-fragment" id="filename.glsl">...</script>
    shader_matches = re.finditer(r'<script type="x-shader/x-fragment" id="(.*?)">\s*(.*?)\s*</script>', content, re.DOTALL)
    for match in shader_matches:
        s_id = match.group(1)
        s_content = match.group(2)
        s_path = os.path.join(output_dir, 'shaders', s_id)
        ensure_dir(s_path)
        with open(s_path, 'w', encoding='utf-8') as f:
            f.write(s_content)
        print(f"  - Extracted Shader to shaders/{s_id}")

    # 3. Extract Presets
    # <script type="application/json" id="filename.json">...</script>
    preset_matches = re.finditer(r'<script type="application/json" id="(.*?)">\s*(.*?)\s*</script>', content, re.DOTALL)
    for match in preset_matches:
        p_id = match.group(1)
        p_content = match.group(2)
        p_path = os.path.join(output_dir, 'presets', p_id)
        ensure_dir(p_path)
        with open(p_path, 'w', encoding='utf-8') as f:
            f.write(p_content)
        print(f"  - Extracted Preset to presets/{p_id}")

    # 4. Extract JS
    # We ignore the shader/preset scripts above by being specific about what we remove later?
    # Or we just parse specific JS blocks.
    # The monolithic files usually have one big <script> block for code.
    
    # Find the main JS script block (not shaders/json)
    # Simple heuristic: script without type or type="text/javascript"
    script_matches = re.finditer(r'<script(?: type="text/javascript")?>\s*(.*?)\s*</script>', content, re.DOTALL)
    
    full_js = ""
    for match in script_matches:
        js_chunk = match.group(1)
        # Check if it looks like JS (contains class/function/var)
        if "class " in js_chunk or "function " in js_chunk or "const " in js_chunk:
             full_js += js_chunk + "\n"
    
    if full_js:
        # Method A: Split by Separators // --- filename ---
        parts = re.split(r'// --- ([a-zA-Z0-9_/\\.]+\.js) ---\n', full_js)
        
        files_to_write = defaultdict(str)
        
        if len(parts) > 1:
            if parts[0].strip():
                files_to_write['js/core/Utils.js'] += parts[0]
                
            for i in range(1, len(parts), 2):
                fname = parts[i].strip()
                fcontent = parts[i+1]
                fname = fname.replace('\\', '/')
                if not fname.startswith('js/'):
                    found = False
                    for known in CODE_MAP.values():
                        if os.path.basename(known) == fname:
                            fname = known
                            found = True
                            break
                    if not found:
                        if 'Effect' in fname: fname = f"js/effects/{fname}"
                        elif 'Manager' in fname: fname = f"js/ui/{fname}"
                        else: fname = f"js/core/{fname}"
                
                files_to_write[fname] += fcontent
        else:
            # Method B: Parsing classes manually
            print("  - No file separators found. Parsing code blocks...")
            lines = full_js.split('\n')
            current_file = 'js/core/Utils.js'
            buffer = []
            
            for line in lines:
                if line.strip().startswith('class ') or line.strip().startswith('const '):
                     temp_target = identify_target_file(line)
                     if temp_target and temp_target != current_file:
                         if buffer:
                             files_to_write[current_file] += '\n'.join(buffer) + '\n'
                             buffer = []
                         current_file = temp_target
                
                buffer.append(line)
            
            if buffer:
                files_to_write[current_file] += '\n'.join(buffer)

        # Write JS files
        for fpath, fcontent in files_to_write.items():
            full_path = os.path.join(output_dir, fpath)
            ensure_dir(full_path)
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(fcontent.strip() + '\n')
            print(f"  - Wrote {fpath}")
            
    # 5. Generate index.html
    body_match = re.search(r'<body.*?>(.*?)</body>', content, re.DOTALL)
    body_content = ""
    if body_match:
        body_content = body_match.group(1)
        # Remove all scripts from body content
        body_content = re.sub(r'<script.*?>.*?</script>', '', body_content, flags=re.DOTALL).strip()

    load_order = get_dependency_order(output_dir)
    
    dev_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Matrix Digital Rain - DEV</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    {body_content}

    <!-- Dev Scripts -->
"""
    for script_path in load_order:
        dev_html += f'    <script src="{script_path}"></script>\n'
        
    dev_html += """
</body>
</html>"""

    with open(os.path.join(output_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(dev_html)
    print(f"  - Generated index.html")

# --- Combine Logic ---

def fix_missing_braces(content, filename):
    """
    Heuristic to detect and fix missing closing braces.
    Removes comments and strings to count balanced braces.
    """
    clean = content
    # Remove comments
    clean = re.sub(r'//.*', '', clean)
    clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.DOTALL)
    # Remove strings (double and single quotes)
    clean = re.sub(r'"[^"\\]*(\\.[^"\\]*)*"', '', clean)
    clean = re.sub(r"'[^'\\]*(\\.[^'\\]*)*'", '', clean)
    # Remove template literals (backticks)
    clean = re.sub(r'`[^`\\]*(\\.[^`\\]*)*`', '', clean)
    
    opens = clean.count('{')
    closes = clean.count('}')
    
    diff = opens - closes
    if diff > 0:
        print(f"  Warning: {filename} seems to have {diff} missing closing brace(s). Auto-fixing.")
        return content + ("\n}" * diff)
    return content

def combine_modular(source_dir, output_file):
    print(f"Combining {source_dir} into {output_file}...")
    
    index_path = os.path.join(source_dir, 'index.html')
    if not os.path.exists(index_path):
        print("Error: index.html not found.")
        return

    with open(index_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # 1. CSS
    css_path = os.path.join(source_dir, 'css/style.css')
    css_block = ""
    if os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            css_block = f.read()

    # 2. Shaders (Embed as Scripts)
    shaders_block = ""
    shaders_dir = os.path.join(source_dir, 'shaders')
    if os.path.exists(shaders_dir):
        for s_file in sorted(os.listdir(shaders_dir)):
            if s_file.endswith('.glsl') or s_file.endswith('.frag') or s_file.endswith('.vert'):
                with open(os.path.join(shaders_dir, s_file), 'r', encoding='utf-8') as f:
                    s_content = f.read()
                    shaders_block += f'<script type="x-shader/x-fragment" id="{s_file}">\n{s_content}\n</script>\n'
    
    # 3. Presets (Embed as JSON Scripts)
    presets_block = ""
    presets_dir = os.path.join(source_dir, 'presets')
    if os.path.exists(presets_dir):
         for p_file in sorted(os.listdir(presets_dir)):
             if p_file.endswith('.json'):
                 with open(os.path.join(presets_dir, p_file), 'r', encoding='utf-8') as f:
                     p_content = f.read()
                     presets_block += f'<script type="application/json" id="{p_file}">\n{p_content}\n</script>\n'

    # 4. JS
    load_order = get_dependency_order(source_dir)
    js_combined = ""
    for rel_path in load_order:
        full_path = os.path.join(source_dir, rel_path)
        if os.path.exists(full_path):
            with open(full_path, 'r', encoding='utf-8') as f:
                raw_js = f.read()
                # Apply fix
                fixed_js = fix_missing_braces(raw_js, rel_path)
                
                js_combined += f"\n// --- {os.path.basename(rel_path)} ---\n"
                js_combined += fixed_js + "\n"

    # Construct HTML
    html_content = re.sub(r'<link rel="stylesheet" href="css/style.css">', 
                          f'<style>\n{css_block}\n</style>', 
                          html_content)
    
    # Remove existing script references
    html_content = re.sub(r'<script src="js/.*?".*?></script>', '', html_content)
    
    # Inject Combined Content
    # We prefer to put assets (shaders/presets) in the head or early body
    # And JS at the end.
    
    injection_point = '</body>'
    combined_payload = f"""
{shaders_block}
{presets_block}
<script>
{js_combined}
</script>
"""
    
    if '<!-- Dev Scripts -->' in html_content:
        html_content = html_content.replace('<!-- Dev Scripts -->', combined_payload)
    else:
        html_content = html_content.replace('</body>', combined_payload + '</body>')

    # Clean up
    html_content = re.sub(r'\n\s*\n', '\n', html_content)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"Build complete: {output_file}")

def refresh_dev_index(source_dir):
    print(f"Refreshing index.html in {source_dir}...")
    index_path = os.path.join(source_dir, 'index.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Remove existing script tags
    content = re.sub(r'\s*<script src="js/.*?".*?></script>', '', content)
    
    # Generate new
    load_order = get_dependency_order(source_dir)
    scripts_block = ""
    for s in load_order:
        scripts_block += f'    <script src="{s}"></script>\n'
        
    if '<!-- Dev Scripts -->' in content:
        content = content.replace('<!-- Dev Scripts -->', '<!-- Dev Scripts -->\n' + scripts_block)
    else:
        content = content.replace('</body>', scripts_block + '</body>')
        
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated index.html with {len(load_order)} scripts.")

# --- CLI ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Matrix Code Builder v2.0 (Robust)")
    subparsers = parser.add_subparsers(dest='command', help='Command')

    split_parser = subparsers.add_parser('split', help='Split monolith -> modular')
    split_parser.add_argument('input', help='Input HTML')
    split_parser.add_argument('output', help='Output Dir')

    combine_parser = subparsers.add_parser('combine', help='Combine modular -> monolith')
    combine_parser.add_argument('input', help='Input Dir')
    combine_parser.add_argument('output', help='Output HTML')

    refresh_parser = subparsers.add_parser('refresh', help='Refresh index.html imports')
    refresh_parser.add_argument('input', help='Input Dir')

    args = parser.parse_args()

    if args.command == 'split':
        split_monolith(args.input, args.output)
    elif args.command == 'combine':
        combine_modular(args.input, args.output)
    elif args.command == 'refresh':
        refresh_dev_index(args.input)
    else:
        parser.print_help()