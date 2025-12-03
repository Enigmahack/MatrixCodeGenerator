import os
import re
import sys
import argparse
import shutil
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

# Order is critical for the combined build
LOAD_ORDER = [
    'js/core/Utils.js',
    'js/ui/NotificationManager.js',
    'js/config/ConfigurationManager.js',
    'js/data/MatrixGrid.js',
    'js/simulation/StreamModes.js',
    'js/simulation/SimulationSystem.js',
    'js/effects/EffectRegistry.js',
    'js/effects/PulseEffect.js',
    'js/effects/MiniPulseEffect.js',
    'js/effects/DejaVuEffect.js',
    'js/rendering/CanvasRenderer.js',
    'js/data/FontData.js',
    'js/ui/FontManager.js',
    'js/ui/UIManager.js',
    'js/core/MatrixKernel.js',
]

# Helper to create directories
def ensure_dir(file_path):
    directory = os.path.dirname(file_path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)

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
    # We want everything inside body, but we replace the main script tag with our loaders
    body_match = re.search(r'<body.*?>(.*?)</body>', content, re.DOTALL)
    if body_match:
        body_content = body_match.group(1)
        # Remove the main script block
        body_content_clean = re.sub(r'<script>.*?</script>', '', body_content, flags=re.DOTALL).strip()
        
        # Construct the Dev HTML
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
        for script_path in LOAD_ORDER:
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

    # 3. Extract and Split JavaScript
    script_match = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
    if script_match:
        full_js = script_match.group(1)
        
        # We need to parse the JS to find boundaries. 
        # This is a simple parser that looks for "class Name" or "const Name =" 
        # It assumes standard formatting from the source file.
        
        # Strategy: We will iterate through the known keys in CODE_MAP.
        # We find the start index of each key definition.
        # We sort these start indices to know the order they appear in the file.
        # The text between index[i] and index[i+1] belongs to key[i].
        
        definitions = []
        
        for key in CODE_MAP.keys():
            # Regex for class definition
            class_pattern = re.compile(r'\bclass\s+' + re.escape(key) + r'\b')
            # Regex for const definition
            const_pattern = re.compile(r'\bconst\s+' + re.escape(key) + r'\s*=')
            
            match = None
            match_type = ""
            
            m_class = class_pattern.search(full_js)
            m_const = const_pattern.search(full_js)
            
            if m_class:
                match = m_class
                match_type = "class"
            elif m_const:
                match = m_const
                match_type = "const"
            
            if match:
                definitions.append({
                    'key': key,
                    'start': match.start(),
                    'file': CODE_MAP[key]
                })
        
        # Sort by position in file
        definitions.sort(key=lambda x: x['start'])
        
        # Now extract content
        for i, item in enumerate(definitions):
            start = item['start']
            # For the last item, go to the end of the string
            end = definitions[i+1]['start'] if i + 1 < len(definitions) else len(full_js)
            
            # Look backward from start to find comments or headers
            # We want to capture the section headers like // === ...
            
            # Simple heuristic: Go back to the previous newline, then check if preceding lines are comments
            chunk = full_js[start:end]
            
            # This chunk might be missing the header "class X" because we searched for it?
            # No, full_js[start:] includes the match.
            
            # Refined extraction:
            # We want to grab the preceding comments too if they exist immediately before
            # But checking boundaries of previous chunk is safer.
            
            prev_end = definitions[i-1]['start'] if i > 0 else 0
            # The gap between prev_end and start might contain the section header for this item
            # OR it might contain the closing brace of the previous item.
            # This is tricky without a full parser.
            
            # Alternative Strategy:
            # The file is structured with distinct sections.
            # Let's regex for the header comments: // === 1. CORE ... ===
            # The current file structure is very clean.
            
            # Let's try a simpler approach for this specific file structure.
            # We will read the file line by line and toggle output files based on detection.
            pass # Moved to the logic below
            
        # LINE BY LINE PARSER STRATEGY
        lines = full_js.split('\n')
        current_file = None
        buffer = []
        
        # Default file for things at the top (APP_VERSION)
        current_file = 'js/core/Utils.js' 
        
        # Mapping logic
        def get_target_file(line):
            for key, path in CODE_MAP.items():
                if f"class {key}" in line:
                    return path
                if f"const {key}" in line:
                    # Special handling for APP_VERSION or Utils
                    if key == 'APP_VERSION' and 'APP_VERSION' in line: return path
                    if key == 'Utils' and 'Utils' in line: return path
                    if key == 'CELL_TYPE' and 'CELL_TYPE' in line: return path
                    if key == 'DEFAULT_FONT_DATA' and 'DEFAULT_FONT_DATA' in line: return path
            return None

        files_content = {}
        
        for line in lines:
            # Detect start of a new block
            new_target = get_target_file(line)
            
            # Special handling: AbstractEffect should go to EffectRegistry
            if "class AbstractEffect" in line:
                new_target = CODE_MAP['AbstractEffect']

            if new_target and new_target != current_file:
                # If we were buffering, save to the old file
                if current_file:
                    if current_file not in files_content: files_content[current_file] = []
                    files_content[current_file].extend(buffer)
                    buffer = []
                
                current_file = new_target
            
            buffer.append(line)

        # Flush last buffer
        if current_file:
            if current_file not in files_content: files_content[current_file] = []
            files_content[current_file].extend(buffer)

        # Write files
        for rel_path, lines_list in files_content.items():
            full_path = os.path.join(output_dir, rel_path)
            ensure_dir(full_path)
            
            # Clean up: Remove leading/trailing empty lines
            text = '\n'.join(lines_list).strip() + '\n'
            
            # For Utils.js, make sure APP_VERSION is at the top if it got pushed down
            # (The line parser should handle it, but just in case)
            
            # Write
            mode = 'a' if os.path.exists(full_path) else 'w'
            # We should probably overwrite initially to be clean, but our loop splits chunks.
            # Actually, the dictionary aggregation `files_content` handles the chunks.
            # So we can just write 'w'.
            
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(text)
            print(f"  - Wrote {rel_path}")

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
    
    # 3. Read JS Files
    js_combined = ""
    for js_rel_path in LOAD_ORDER:
        js_path = os.path.join(source_dir, js_rel_path)
        if os.path.exists(js_path):
            with open(js_path, 'r', encoding='utf-8') as f:
                js_combined += f"\n// --- {os.path.basename(js_rel_path)} ---\\n"
                js_combined += f.read() + "\n"
        else:
            print(f"Warning: Expected JS file not found: {js_rel_path}")

    # 4. Construct Final HTML
    # Replace CSS link with style block
    html_content = re.sub(r'<link rel="stylesheet" href="css/style.css">', 
                          f'<style>\n{css_block}\n</style>', 
                          html_content)
    
    # Replace script tags with combined JS
    # We look for the "Dev Scripts" section or just before the closing body
    
    # Regex to remove the individual script tags we added
    # Matches <script src="..." ></script>
    html_content = re.sub(r'<script src="js/.*?".*?></script>', '', html_content)
    
    # Inject the master script
    master_script = f"""<script>
{js_combined}
    </script>"""
    
    # Insert before the inline script or closing body
    # We had a placeholder inline script in the split version
    
    html_content = html_content.replace('<!-- Dev Scripts -->', master_script)
    
    # Clean up empty lines if any
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"Build complete: {output_file}")


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

    args = parser.parse_args()

    if args.command == 'split':
        split_monolith(args.input, args.output)
    elif args.command == 'combine':
        combine_modular(args.input, args.output)
    else:
        parser.print_help()
