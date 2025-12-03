import os
import re
import sys
import argparse
import shutil
import glob
from datetime import datetime

# --- Configuration ---

# Mapping of classes/variables to target files
CODE_MAP = {
    # Core
    'APP_VERSION': 'js/core/Utils.js',
    'Utils': 'js/core/Utils.js',
    'CELL_TYPE': 'js/core/Utils.js',
    'MatrixKernel': 'js/core/MatrixKernel.js',
    
    # Config
    'ConfigurationManager': 'js/config/ConfigurationManager.js',
    
    # Data
    'MatrixGrid': 'js/data/MatrixGrid.js',
    'DEFAULT_FONT_DATA': 'js/data/FontData.js',
    
    # Simulation
    'StreamMode': 'js/simulation/StreamModes.js',
    'StandardMode': 'js/simulation/StreamModes.js',
    'StarPowerMode': 'js/simulation/StreamModes.js',
    'RainbowMode': 'js/simulation/StreamModes.js',
    'SimulationSystem': 'js/simulation/SimulationSystem.js',
    
    # Effects
    'EffectRegistry': 'js/effects/EffectRegistry.js',
    'AbstractEffect': 'js/effects/EffectRegistry.js',
    'PulseEffect': 'js/effects/PulseEffect.js',
    'MiniPulseEffect': 'js/effects/MiniPulseEffect.js',
    'DejaVuEffect': 'js/effects/DejaVuEffect.js',
    
    # UI
    'NotificationManager': 'js/ui/NotificationManager.js',
    'FontManager': 'js/ui/FontManager.js',
    'UIManager': 'js/ui/UIManager.js',
    
    # Rendering
    'CanvasRenderer': 'js/rendering/CanvasRenderer.js',
}

# Helper to create directories
def ensure_dir(file_path):
    directory = os.path.dirname(file_path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)

def get_combine_order(source_dir):
    """
    Dynamically determine the file combination order based on directory structure
    and a set of explicit priorities.
    """
    
    # Directories to scan in specific order
    DIR_ORDER = [
        'js/core',
        'js/ui',       # NotificationManager (independent)
        'js/config',
        'js/data',
        'js/simulation',
        'js/effects',
        'js/rendering',
        # 'js/ui' handled again implicitly or via explicit list if needed, but 'ui' is already listed.
        # UIManager/FontManager are dependent on others. We handle this via FORCED_LAST.
    ]
    
    # Files that MUST load first within the project scope (or their dir scope)
    FORCED_FIRST = [
        'js/core/Utils.js',
        'js/ui/NotificationManager.js',
        'js/config/ConfigurationManager.js',
        'js/data/MatrixGrid.js',
        'js/data/FontData.js',
        'js/simulation/StreamModes.js',
        'js/simulation/SimulationSystem.js',
        'js/effects/EffectRegistry.js'
    ]
    
    # Files that MUST load last
    FORCED_LAST = [
        'js/rendering/CanvasRenderer.js',
        'js/ui/FontManager.js',
        'js/ui/UIManager.js',
        'js/core/MatrixKernel.js'
    ]
    
    all_files = []
    
    # 1. Walk directories in order
    for d in DIR_ORDER:
        full_path = os.path.join(source_dir, d)
        if not os.path.exists(full_path):
            continue
            
        # Get all JS files in this specific directory (non-recursive to respect DIR_ORDER)
        # Actually, os.walk is recursive. Let's use os.listdir for control or glob.
        # But we want to allow nested folders? Let's stick to top-level of these dirs for now as per structure.
        
        js_files = glob.glob(os.path.join(full_path, "*.js"))
        
        # Normalize paths relative to source_dir
        rel_files = [os.path.relpath(f, source_dir) for f in js_files]
        all_files.extend(rel_files)

    # Remove duplicates (in case DIR_ORDER causes overlaps, though unlikely with current structure)
    all_files = list(dict.fromkeys(all_files))
    
    # Filter out the forced ones
    dynamic_files = [f for f in all_files if f not in FORCED_FIRST and f not in FORCED_LAST]
    
    # Sort dynamic files alphabetically (or could be by sub-folder)
    dynamic_files.sort()
    
    # Assemble final order
    # Note: We verify existence of FORCED files during read, or filtering here.
    # We should only include FORCED files that actually exist in the gathered list?
    # Or strictly enforce them? 
    # Let's strictly enforce the *order*, but only include if they exist (to allow partial builds?)
    # For safety, we just return the list. The reader will check existence.
    
    final_order = []
    
    for f in FORCED_FIRST:
        final_order.append(f)
        
    final_order.extend(dynamic_files)
    
    for f in FORCED_LAST:
        final_order.append(f)
        
    return final_order

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
    else:
        print("  - Warning: No CSS found.")

    # 2. Extract HTML Body (excluding scripts)
    body_match = re.search(r'<body.*?>(.*?)</body>', content, re.DOTALL)
    if body_match:
        body_content = body_match.group(1)
        body_content_clean = re.sub(r'<script>.*?</script>', '', body_content, flags=re.DOTALL).strip()
        
        # Note: We don't know the exact file list yet for the dynamic loader in index.html.
        # For now, we will use the same get_combine_order logic *after* we write the files, 
        # or we can write a placeholder and update it? 
        # Simpler: Write the files first, THEN generate index.html at the end.
    
    # 3. Extract and Split JavaScript
    script_match = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
    files_content = {} # Define here to be accessible later

    if script_match:
        full_js = script_match.group(1)
        lines = full_js.split('\n')
        current_file = 'js/core/Utils.js' 
        buffer = []
        
        def get_target_file(line):
            # Check known map
            for key, path in CODE_MAP.items():
                if f"class {key}" in line: return path
                if f"const {key}" in line:
                    if key in ['APP_VERSION', 'Utils', 'CELL_TYPE', 'DEFAULT_FONT_DATA']:
                        if key in line: return path
            
            # Heuristic for new Effects
            # "class SomeEffect extends AbstractEffect" or just "class SomeEffect"
            # We match "class XEffect"
            effect_match = re.search(r'class\s+(\w+Effect)\b', line)
            if effect_match:
                name = effect_match.group(1)
                # If not mapped explicitly
                if name not in CODE_MAP:
                    return f"js/effects/{name}.js"
            
            # Heuristic for new Modes
            mode_match = re.search(r'class\s+(\w+Mode)\b', line)
            if mode_match:
                name = mode_match.group(1)
                if name not in CODE_MAP:
                    return f"js/simulation/{name}.js"

            return None

        for line in lines:
            new_target = get_target_file(line)
            
            if "class AbstractEffect" in line:
                new_target = CODE_MAP['AbstractEffect']

            if new_target and new_target != current_file:
                if current_file:
                    if current_file not in files_content: files_content[current_file] = []
                    files_content[current_file].extend(buffer)
                    buffer = []
                current_file = new_target
            
            buffer.append(line)

        if current_file:
            if current_file not in files_content: files_content[current_file] = []
            files_content[current_file].extend(buffer)

        # Write JS files
        for rel_path, lines_list in files_content.items():
            full_path = os.path.join(output_dir, rel_path)
            ensure_dir(full_path)
            text = '\n'.join(lines_list).strip() + '\n'
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(text)
            print(f"  - Wrote {rel_path}")
            
    # 4. Generate index.html (Now that files exist)
    if body_match:
        # Get the dynamic order based on what we just wrote
        # We need to pass output_dir to get_combine_order
        # But get_combine_order expects the files to exist. We just wrote them.
        load_order = get_combine_order(output_dir)
        
        dev_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Matrix Digital Rain - DEV</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    {body_content_clean}

    <!-- Dev Scripts -->
"""
        for script_path in load_order:
            # Check if file actually exists (it should)
            if os.path.exists(os.path.join(output_dir, script_path)):
                dev_html += f'    <script src="{script_path}"></script>\n'
            
        dev_html += """
    <script>
        // Auto-initialize if not already done by the classes
        // (MatrixKernel initializes itself on DOMContentLoaded)
    </script>
</body>
</html>"""
        
        with open(os.path.join(output_dir, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(dev_html)
        print(f"  - Generated index.html")

    print("Split complete.")


def combine_modular(source_dir, output_file):
    print(f"Combining {source_dir} into {output_file}...")
    
    # 1. Read HTML Template (index.html)
    index_path = os.path.join(source_dir, 'index.html')
    if not os.path.exists(index_path):
        print("Error: index.html not found in source directory.")
        return

    with open(index_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # 2. Read CSS
    css_path = os.path.join(source_dir, 'css/style.css')
    css_block = ""
    if os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            css_block = f.read()
    
    # 3. Read JS Files (Dynamic Order)
    load_order = get_combine_order(source_dir)
    
    js_combined = ""
    for js_rel_path in load_order:
        js_path = os.path.join(source_dir, js_rel_path)
        if os.path.exists(js_path):
            with open(js_path, 'r', encoding='utf-8') as f:
                js_combined += f"\n// --- {os.path.basename(js_rel_path)} ---\n"
                js_combined += f.read() + "\n"
        else:
            # Warning only if it was in our FORCED lists but missing
            print(f"Warning: Expected JS file not found: {js_rel_path}")

    # 4. Construct Final HTML
    html_content = re.sub(r'<link rel="stylesheet" href="css/style.css">', 
                          f'<style>\n{css_block}\n</style>', 
                          html_content)
    
    html_content = re.sub(r'<script src="js/.*?".*?></script>', '', html_content)
    
    master_script = f"""<script>
{js_combined}
    </script>"""
    
    html_content = html_content.replace('<!-- Dev Scripts -->', master_script)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"Build complete: {output_file}")


def refresh_dev_index(source_dir):
    print(f"Refreshing index.html in {source_dir}...")
    
    index_path = os.path.join(source_dir, 'index.html')
    if not os.path.exists(index_path):
        print("Error: index.html not found.")
        return

    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Strip existing scripts
    # We look for the <!-- Dev Scripts --> marker as a safe anchor if possible, 
    # or just regex replace all script src tags.
    
    # Better approach: Read the "skeleton" (everything except the script src lines we inserted)
    # But we don't have a clean skeleton.
    
    # Regex to remove <script src="js/..."> tags
    content_clean = re.sub(r'\s*<script src="js/.*?".*?></script>', '', content)
    
    # Generate new script tags
    load_order = get_combine_order(source_dir)
    new_scripts = ""
    for script_path in load_order:
        if os.path.exists(os.path.join(source_dir, script_path)):
            new_scripts += f'    <script src="{script_path}"></script>\n'
            
    # Insert them back. 
    # We look for <!-- Dev Scripts -->
    if '<!-- Dev Scripts -->' in content_clean:
        content_new = content_clean.replace('<!-- Dev Scripts -->', '<!-- Dev Scripts -->\n' + new_scripts)
    else:
        # Fallback: Insert before the first inline script or closing body
        # This is risky if there are other scripts.
        # Let's try to put it before the inline script that has "MatrixKernel" or "DOMContentLoaded"
        # Or just before </body>
        print("Warning: <!-- Dev Scripts --> marker not found. Appending to body end.")
        content_new = content_clean.replace('</body>', new_scripts + '</body>')

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(content_new)
        
    print(f"Updated index.html with {len(load_order)} scripts.")


# --- CLI ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Matrix Code Builder")
    subparsers = parser.add_subparsers(dest='command', help='Command to run')

    # Split Command
    split_parser = subparsers.add_parser('split', help='Split monolithic HTML into modules')
    split_parser.add_argument('input', help='Input HTML file')
    split_parser.add_argument('output', help='Output directory')

    # Combine Command
    combine_parser = subparsers.add_parser('combine', help='Combine modules into monolithic HTML')
    combine_parser.add_argument('input', help='Input directory (containing index.html)')
    combine_parser.add_argument('output', help='Output HTML file')

    # Refresh Command
    refresh_parser = subparsers.add_parser('refresh', help='Update index.html with current JS files')
    refresh_parser.add_argument('input', help='Input directory')

    args = parser.parse_args()

    if args.command == 'split':
        split_monolith(args.input, args.output)
    elif args.command == 'combine':
        combine_modular(args.input, args.output)
    elif args.command == 'refresh':
        refresh_dev_index(args.input)
    else:
        parser.print_help()