import os
import re
import sys
import argparse
import glob
import base64
import json
from collections import defaultdict

# --- Configuration ---

CODE_MAP = {
    'APP_VERSION': 'js/core/Utils.js',
    'Utils': 'js/core/Utils.js',
    'MatrixKernel': 'js/core/MatrixKernel.js',
    'ConfigurationManager': 'js/config/ConfigurationManager.js',
    'CellGrid': 'js/data/CellGrid.js',
    'DEFAULT_FONT_DATA': 'js/data/FontData.js',
    'StreamMode': 'js/simulation/StreamModes.js',
    'StandardMode': 'js/simulation/StreamModes.js',
    'StarPowerMode': 'js/simulation/StreamModes.js',
    'RainbowMode': 'js/simulation/StreamModes.js',
    'SimulationSystem': 'js/simulation/SimulationSystem.js',
    'StreamManager': 'js/simulation/StreamManager.js',
    'EffectRegistry': 'js/effects/EffectRegistry.js',
    'AbstractEffect': 'js/effects/EffectRegistry.js',
    'GlowSystem': 'js/effects/GlowSystem.js',
    'PulseEffect': 'js/effects/PulseEffect.js',
    'MiniPulseEffect': 'js/effects/MiniPulseEffect.js',
    'DejaVuEffect': 'js/effects/DejaVuEffect.js',
    'FirewallEffect': 'js/effects/FirewallEffect.js',
    'SupermanEffect': 'js/effects/SupermanEffect.js',
    'ClearPulseEffect': 'js/effects/ClearPulseEffect.js',
    'BootEffect': 'js/effects/BootEffect.js',
    'CrashEffect': 'js/effects/CrashEffect.js',
    'ReverseEffect': 'js/effects/ReverseEffect.js',
    'QuantizedPulseEffect': 'js/effects/QuantizedPulseEffect.js',
    'QuantizedAddEffect': 'js/effects/QuantizedAddEffect.js',
    'QuantizedRetractEffect': 'js/effects/QuantizedRetractEffect.js',
    'NotificationManager': 'js/ui/NotificationManager.js',
    'FontManager': 'js/ui/FontManager.js',
    'UIManager': 'js/ui/UIManager.js',
    'CharacterSelectorModal': 'js/ui/CharacterSelectorModal.js',
    'WebGLRenderer': 'js/rendering/WebGLRenderer.js',
    'GlyphAtlas': 'js/rendering/GlyphAtlas.js',
    'PostProcessor': 'js/rendering/PostProcessor.js'
}

FORCED_FIRST = [
    'js/core/Utils.js', 
    'js/config/ConfigurationManager.js', 
    'js/data/FontData.js',
    'js/data/CellGrid.js',
    'js/effects/EffectRegistry.js'
]

FORCED_LAST = [
    'js/core/MatrixKernel.js'
]

def ensure_dir(file_path):
    directory = os.path.dirname(file_path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)

def scan_file_content(content):
    defined_classes = set()
    dependencies = set()
    class_pattern = re.compile(r'class\s+(\w+)(?:\s+extends\s+(\w+))?')
    for match in class_pattern.finditer(content):
        class_name = match.group(1)
        parent_name = match.group(2)
        defined_classes.add(class_name)
        if parent_name:
            dependencies.add(parent_name)
    return defined_classes, dependencies

def get_dependency_order(source_dir):
    files_data = {}
    all_files = []
    
    # Strictly target the 'js' subdirectory to avoid node_modules and other root files
    search_root = os.path.join(source_root, 'js') if 'source_root' in globals() else source_dir
    # Optimization: if the source_dir passed is the root, we look for 'js' inside it.
    actual_js_path = os.path.join(source_dir, 'js')
    if os.path.exists(actual_js_path):
        scan_dir = actual_js_path
    else:
        scan_dir = source_dir

    for root, dirs, files in os.walk(scan_dir):
        # Skip node_modules and hidden dirs
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', '.github', '.vscode']]
        
        for file in files:
            if file in ['main.js', 'SimulationWorker.js']: continue 
            if file.endswith(".js"):
                full_path = os.path.join(root, file)
                # rel_path should be relative to source_dir (root of the project)
                rel_path = os.path.relpath(full_path, source_dir).replace('\\', '/')
                
                # Safety Check: Skip files that use Node.js 'fs' module (prevents bundling main.js or tools)
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                if "require('fs')" in content or 'require("fs")' in content or "require('electron')" in content or 'require("electron")' in content:
                    print(f"  [Warning] Skipping {rel_path} (Detected Node.js/Electron dependency)")
                    continue

                defs, deps = scan_file_content(content)
                files_data[rel_path] = {'defs': defs, 'deps': deps}
                all_files.append(rel_path)

    class_to_file = {}
    for f, data in files_data.items():
        for cls in data['defs']:
            class_to_file[cls] = f
            
    adj_list = defaultdict(list)
    in_degree = defaultdict(int)
    for f in all_files: in_degree[f] = 0

    for f, data in files_data.items():
        for dep_cls in data['deps']:
            if dep_cls in class_to_file:
                dependency_file = class_to_file[dep_cls]
                if dependency_file != f: 
                    adj_list[dependency_file].append(f)
                    in_degree[f] += 1
    
    queue = []
    for f in all_files:
        if in_degree[f] == 0: queue.append(f)
            
    sorted_files = []
    queue.sort()
    while queue:
        u = queue.pop(0)
        sorted_files.append(u)
        for v in adj_list[u]:
            in_degree[v] -= 1
            if in_degree[v] == 0:
                queue.append(v); queue.sort()
                
    if len(sorted_files) != len(all_files):
        missing = set(all_files) - set(sorted_files)
        sorted_files.extend(list(missing))

    final_list = []
    for f in FORCED_FIRST:
        if f in sorted_files:
            final_list.append(f)
            sorted_files.remove(f)
            
    last_list = []
    for f in FORCED_LAST:
        if f in sorted_files:
            last_list.append(f)
            sorted_files.remove(f)
            
    final_list.extend(sorted_files)
    final_list.extend(last_list)
    return final_list

def identify_target_file(block_content, current_hint=None):
    for key, path in CODE_MAP.items():
        if f"class {key}" in block_content or f"const {key}" in block_content:
            return path
    class_match = re.search(r'class\s+(\w+)(?:\s+extends\s+(\w+))?', block_content)
    if class_match:
        cls_name = class_match.group(1)
        parent_name = class_match.group(2)
        if cls_name.endswith('Effect'): return f"js/effects/{cls_name}.js"
        if cls_name.endswith('Mode'): return f"js/simulation/StreamModes.js"
        if 'Manager' in cls_name: return f"js/ui/{cls_name}.js"
        if parent_name and 'Effect' in parent_name: return f"js/effects/{cls_name}.js"
    return current_hint or "js/core/Utils.js"

def split_monolith(input_file, output_dir):
    print(f"Splitting {input_file} into {output_dir}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    css_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
    if css_match:
        css_path = os.path.join(output_dir, 'css/style.css')
        ensure_dir(css_path)
        with open(css_path, 'w', encoding='utf-8') as f: f.write(css_match.group(1).strip())

    shader_matches = re.finditer(r'<script type="x-shader/x-fragment" id="(.*?)">[\s]*([\s\S]*?)[\s]*</script>', content)
    for match in shader_matches:
        s_id, s_content = match.groups()
        s_path = os.path.join(output_dir, 'shaders', s_id)
        ensure_dir(s_path)
        with open(s_path, 'w', encoding='utf-8') as f: f.write(s_content)

    preset_matches = re.finditer(r'<script type="application/json" id="(.*?)">[\s]*([\s\S]*?)[\s]*</script>', content)
    for match in preset_matches:
        p_id, p_content = match.groups()
        p_path = os.path.join(output_dir, 'presets', p_id)
        ensure_dir(p_path)
        with open(p_path, 'w', encoding='utf-8') as f: f.write(p_content)

    script_matches = re.finditer(r'<script(?: type="text/javascript")?>[\s]*([\s\S]*?)[\s]*</script>', content)
    full_js = ""
    for match in script_matches:
        js_chunk = match.group(1)
        if any(kw in js_chunk for kw in ["class ", "function ", "const "]): full_js += js_chunk + "\n"
    
    if full_js:
        parts = re.split(r'// --- ([a-zA-Z0-9_/\\.]+\.js) ---\n', full_js)
        files_to_write = defaultdict(str)
        if len(parts) > 1:
            if parts[0].strip(): files_to_write['js/core/Utils.js'] += parts[0]
            for i in range(1, len(parts), 2):
                fname = parts[i].strip().replace('\\', '/')
                if not fname.startswith('js/'):
                    found = False
                    for known in CODE_MAP.values():
                        if os.path.basename(known) == fname: fname = known; found = True; break
                    if not found:
                        if 'Effect' in fname: fname = f"js/effects/{fname}"
                        elif 'Manager' in fname: fname = f"js/ui/{fname}"
                        else: fname = f"js/core/{fname}"
                files_to_write[fname] += parts[i+1]
        else:
            lines = full_js.split('\n'); current_file = 'js/core/Utils.js'; buffer = []
            for line in lines:
                if line.strip().startswith(('class ', 'const ')):
                     temp_target = identify_target_file(line)
                     if temp_target and temp_target != current_file:
                         if buffer: files_to_write[current_file] += '\n'.join(buffer) + '\n'
                         buffer = []; current_file = temp_target
                buffer.append(line)
            if buffer: files_to_write[current_file] += '\n'.join(buffer)

        for fpath, fcontent in files_to_write.items():
            full_path = os.path.join(output_dir, fpath)
            ensure_dir(full_path)
            with open(full_path, 'w', encoding='utf-8') as f: f.write(fcontent.strip() + '\n')
            
    body_match = re.search(r'<body.*?>(.*?)</body>', content, re.DOTALL)
    body_content = re.sub(r'<script.*?>.*?</script>', '', body_match.group(1), flags=re.DOTALL).strip() if body_match else ""
    load_order = get_dependency_order(output_dir)
    
    scripts_html = "".join([f'    <script src="{s}"></script>\n' for s in load_order])
    dev_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    {body_content}

    <!-- Dev Scripts -->
{scripts_html}
</body>
</html>"""
    with open(os.path.join(output_dir, 'index.html'), 'w', encoding='utf-8') as f: f.write(dev_html)

# --- Combine Logic ---

def combine_modular(source_dir, output_file):
    print(f"Combining {source_dir} into {output_file}...")
    index_path = os.path.join(source_dir, 'index.html')
    if not os.path.exists(index_path):
        print("Error: index.html not found."); return

    with open(index_path, 'r', encoding='utf-8') as f: html_content = f.read()

    css_path = os.path.join(source_dir, 'css/style.css')
    css_block = ""
    if os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f: css_block = f.read()

    embedded_shaders = {}
    shaders_dir = os.path.join(source_dir, 'shaders')
    if os.path.exists(shaders_dir):
        for s_file in sorted(os.listdir(shaders_dir)):
            if s_file.endswith(('.glsl', '.frag', '.vert')):
                with open(os.path.join(shaders_dir, s_file), 'r', encoding='utf-8') as f: embedded_shaders[s_file] = f.read()
    
    embedded_presets = {}
    presets_dir = os.path.join(source_dir, 'presets')
    if os.path.exists(presets_dir):
         for p_file in sorted(os.listdir(presets_dir)):
             if p_file.endswith('.json'):
                 with open(os.path.join(presets_dir, p_file), 'r', encoding='utf-8') as f:
                     try: embedded_presets[p_file] = json.load(f)
                     except: pass

    embedded_fonts = {}
    fonts_dir = os.path.join(source_dir, 'fonts')
    if os.path.exists(fonts_dir):
        for f_file in sorted(os.listdir(fonts_dir)):
            if f_file.endswith(('.woff2', '.ttf', '.otf')):
                with open(os.path.join(fonts_dir, f_file), 'rb') as f:
                    data = base64.b64encode(f.read()).decode('utf-8')
                    mtype = 'font/woff2' if f_file.endswith('woff2') else 'application/octet-stream'
                    embedded_fonts[f_file] = f"data:{mtype};base64,{data}"

    load_order = get_dependency_order(source_dir)
    js_combined = ""
    for rel_path in load_order:
        full_path = os.path.join(source_dir, rel_path)
        if os.path.exists(full_path):
            with open(full_path, 'r', encoding='utf-8') as f:
                js_combined += f"\n// --- {os.path.basename(rel_path)} ---\n{f.read()}\n"

    worker_block = ""
    worker_path = os.path.join(source_dir, 'js/simulation/SimulationWorker.js')
    if os.path.exists(worker_path):
        print("  - Bundling SimulationWorker.js...")
        worker_deps = ['js/core/Utils.js', 'js/data/CellGrid.js', 'js/simulation/StreamModes.js', 'js/simulation/StreamManager.js', 'js/effects/GlowSystem.js']
        worker_code = ""
        for dep in worker_deps:
            d_path = os.path.join(source_dir, dep)
            if os.path.exists(d_path):
                with open(d_path, 'r', encoding='utf-8') as f:
                    worker_code += f"\n// --- Worker Dep: {os.path.basename(dep)} ---\n{f.read()}\n"
        with open(worker_path, 'r', encoding='utf-8') as f:
            worker_code += "\n// --- SimulationWorker.js ---\n" + re.sub(r'importScripts\(.*\);', '', f.read())
        worker_code_esc = worker_code.replace('`', '\\`').replace('${', '\\${')
        worker_block = f"""<script id="simulation-worker-source" type="javascript/worker">
{worker_code}
</script>"""

    assets_json = json.dumps({'shaders': embedded_shaders, 'presets': embedded_presets, 'fonts': embedded_fonts})
    
    patch_code = r"""
// --- Patch: Integrate Embedded Assets ---
(function() {
    if (typeof ConfigurationManager !== 'undefined') {
        const orig = ConfigurationManager.prototype._loadSlots;
        ConfigurationManager.prototype._loadSlots = function() {
            let local = null; try { local = orig.call(this); } catch(e) {}
            if (local && local.length > 0 && local[0].name) return local;
            if (typeof __EMBEDDED_ASSETS__ !== 'undefined' && __EMBEDDED_ASSETS__.presets) {
                for (const k in __EMBEDDED_ASSETS__.presets) {
                    const p = __EMBEDDED_ASSETS__.presets[k];
                    if (p && p.savedPresets) return p.savedPresets;
                }
            }
            return local || [];
        };
    }
    if (typeof FontManager !== 'undefined') {
        const orig = FontManager.prototype.init;
        FontManager.prototype.init = async function() {
            await orig.call(this);
            if (typeof __EMBEDDED_ASSETS__ !== 'undefined' && __EMBEDDED_ASSETS__.fonts) {
                for (const [n, d] of Object.entries(__EMBEDDED_ASSETS__.fonts)) {
                    const fam = n.split('.')[0].replace(/-/g, ' ');
                    if (this.loadedFonts.some(f => f.name === fam)) continue;
                    const ok = await this._registerFontFace({ name: fam, sourceUrl: d, formatHint: n.endsWith('woff2')?"format('woff2')":"format('truetype')", canvasPx: 20 });
                    if (ok) this.loadedFonts.push({ name: fam, display: fam, isEmbedded: true });
                }
                this._notify();
            }
        };
    }
    if (typeof PostProcessor !== 'undefined') {
        const orig = PostProcessor.prototype.compileShader;
        PostProcessor.prototype.compileShader = function(src) {
            if (typeof __EMBEDDED_ASSETS__ !== 'undefined' && __EMBEDDED_ASSETS__.shaders && __EMBEDDED_ASSETS__.shaders[src]) {
                src = __EMBEDDED_ASSETS__.shaders[src];
            }
            return orig.call(this, src);
        };
    }
})();
"""
    html_content = re.sub(r'<link rel="stylesheet" href="css/style.css">', f'<style>\n{css_block}\n</style>', html_content)
    html_content = re.sub(r'<script src="(js/.*?|main\.js)".*?></script>', '', html_content)
    
    payload = f"""<script>const __EMBEDDED_ASSETS__ = {assets_json};</script>
{worker_block}
<script>
{js_combined}
{patch_code}
</script>"""
    
    if '<!-- Dev Scripts -->' in html_content:
        html_content = html_content.replace('<!-- Dev Scripts -->', payload)
    else:
        html_content = html_content.replace('</body>', payload + '</body>')

    with open(output_file, 'w', encoding='utf-8') as f: f.write(re.sub(r'\n\s*\n', '\n', html_content))
    print(f"Build complete: {output_file}")

def refresh_dev_index(source_dir):
    print(f"Refreshing index.html in {source_dir}...")
    index_path = os.path.join(source_dir, 'index.html')
    with open(index_path, 'r', encoding='utf-8') as f: content = f.read()
    content = re.sub(r'\s*<script src="(js/.*?|main\.js)".*?></script>', '', content)
    load_order = get_dependency_order(source_dir)
    scripts_block = "".join([f'    <script src="{s}"></script>\n' for s in load_order])
    if '<!-- Dev Scripts -->' in content: content = content.replace('<!-- Dev Scripts -->', '<!-- Dev Scripts -->\n' + scripts_block)
    else: content = content.replace('</body>', scripts_block + '</body>')
    with open(index_path, 'w', encoding='utf-8') as f: f.write(content)
    print(f"Updated index.html with {len(load_order)} scripts.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Matrix Code Builder v2.1")
    subparsers = parser.add_subparsers(dest='command')
    s_p = subparsers.add_parser('split'); s_p.add_argument('input'); s_p.add_argument('output')
    c_p = subparsers.add_parser('combine'); c_p.add_argument('input'); c_p.add_argument('output')
    r_p = subparsers.add_parser('refresh'); r_p.add_argument('input')
    args = parser.parse_args()
    if args.command == 'split': split_monolith(args.input, args.output)
    elif args.command == 'combine': combine_modular(args.input, args.output)
    elif args.command == 'refresh': refresh_dev_index(args.input)
    else: parser.print_help()