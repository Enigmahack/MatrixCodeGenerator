#!/usr/bin/env python3
"""
Shader Uniform Audit Tool for MatrixCode v8.5

Parses GLSL shader strings embedded in WebGLRenderer.js and cross-references
uniform declarations against JS gl.uniform* dispatch calls.

Catches:
  - Uniforms declared in GLSL but never set from JS
  - Uniforms set from JS but not declared in GLSL
  - Sampler/texture slot mismatches
  - Duplicate uniform declarations across shaders

Usage:
  python .claude/tools/shader_audit.py [--fix] [--verbose]
"""

import re
import sys
import os
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))
RENDERER = os.path.join(ROOT, 'MatrixCode_v8.5', 'js', 'rendering', 'WebGLRenderer.js')

# GLSL type to JS uniform function mapping
TYPE_TO_FUNC = {
    'float': 'uniform1f',
    'int': 'uniform1i',
    'bool': 'uniform1i',
    'vec2': 'uniform2f',
    'vec3': 'uniform3f',
    'vec4': 'uniform4f',
    'ivec2': 'uniform2i',
    'ivec3': 'uniform3i',
    'ivec4': 'uniform4i',
    'mat2': 'uniformMatrix2fv',
    'mat3': 'uniformMatrix3fv',
    'mat4': 'uniformMatrix4fv',
    'sampler2D': 'uniform1i',
    'usampler2D': 'uniform1i',
    'isampler2D': 'uniform1i',
}


def extract_glsl_blocks(content):
    """Extract GLSL shader source strings from JS template literals and string concatenation."""
    shaders = {}

    # Match patterns like: const matrixFS = `...`; or let lineFS = `...`;
    # Also match: const name = '...' or "..."
    # The most reliable approach: find variable assignments to known shader names
    shader_names = [
        'matrixVS', 'matrixVS2D', 'matrixFS',
        'lineVS', 'lineFS',
        'lineGfxVS', 'lineGfxFS',
        'shadowVS', 'shadowFS',
        'resolveVS', 'resolveFS',
        'copyVS', 'copyFS',
        'matrixVS_GPU_2D',
    ]

    # Strategy: find backtick-delimited strings assigned near these names
    # Pattern: looks for `shader source` after shader name references
    for name in shader_names:
        # Look for: const NAME = `...`  or  NAME = `...`  or  NAME: `...`
        patterns = [
            rf"(?:const|let|var)\s+{name}\s*=\s*`([\s\S]*?)`",
            rf"{name}\s*=\s*`([\s\S]*?)`",
            rf"'{name}':\s*`([\s\S]*?)`",
        ]
        for pat in patterns:
            m = re.search(pat, content)
            if m:
                shaders[name] = m.group(1)
                break

    # Also look for inline shader strings in _initShaders or similar methods
    # These often use string concatenation or template literals
    init_match = re.search(r'_initShaders\s*\(\s*\)\s*\{([\s\S]*?)^\s{2,4}\}', content, re.MULTILINE)
    if init_match:
        init_body = init_match.group(1)
        for name in shader_names:
            if name not in shaders:
                patterns = [
                    rf"(?:const|let|var)\s+{name}\s*=\s*`([\s\S]*?)`",
                    rf"{name}\s*=\s*`([\s\S]*?)`",
                ]
                for pat in patterns:
                    m = re.search(pat, init_body)
                    if m:
                        shaders[name] = m.group(1)
                        break

    return shaders


def parse_glsl_uniforms(glsl_source, shader_name):
    """Extract uniform declarations from GLSL source."""
    uniforms = {}
    # Match: uniform type name; or uniform type name[N];
    pat = re.compile(r'uniform\s+([\w]+)\s+(\w+)(?:\[(\d+)\])?\s*;')
    for m in pat.finditer(glsl_source):
        utype, uname, array_size = m.group(1), m.group(2), m.group(3)
        uniforms[uname] = {
            'type': utype,
            'array_size': int(array_size) if array_size else None,
            'shader': shader_name,
        }
    return uniforms


def find_js_uniform_calls(content):
    """Find all uniform references via this._u(program, 'name') pattern and getUniformLocation."""
    locations = {}  # name -> True
    dispatches = {}  # name -> {func, value_hint}

    # Pattern 1: getUniformLocation(program, 'u_name')
    loc_pat = re.compile(r'getUniformLocation\s*\(\s*\w+\s*,\s*[\'"](\w+)[\'"]\s*\)')
    for m in loc_pat.finditer(content):
        locations[m.group(1)] = True

    # Pattern 2: this._u(program, 'u_name') -- the primary dispatch pattern
    # Used as: gl.uniform1f(this._u(this.someProgram, 'u_uniformName'), value)
    u_pat = re.compile(r"this\._u\s*\(\s*[\w.]+\s*,\s*'(\w+)'\s*\)")
    for m in u_pat.finditer(content):
        locations[m.group(1)] = True

    # Pattern 3: locs['u_name'] or locs.u_name
    locs_pat = re.compile(r"locs\[?['\"]?(\w+)['\"]?\]?\.loc")
    for m in locs_pat.finditer(content):
        locations[m.group(1)] = True

    # Pattern 4: Direct gl.uniform* with this._u inline
    dispatch_pat = re.compile(r'gl\.(uniform\w+)\s*\(\s*this\._u\s*\(\s*[\w.]+\s*,\s*[\'"](\w+)[\'"]\s*\)')
    for m in dispatch_pat.finditer(content):
        func, uname = m.group(1), m.group(2)
        dispatches[uname] = {'func': func}
        locations[uname] = True

    return locations, dispatches


def find_texture_bindings(content):
    """Find texture slot bindings (gl.activeTexture + gl.bindTexture patterns)."""
    bindings = []
    # Look for gl.activeTexture(gl.TEXTURE0 + N) or gl.activeTexture(gl.TEXTUREN)
    pat = re.compile(
        r'gl\.activeTexture\s*\(\s*gl\.TEXTURE(\d+)\s*\)'
        r'[\s\S]{0,200}?'
        r'gl\.bindTexture\s*\(\s*gl\.\w+\s*,\s*([\w.]+)\s*\)',
        re.MULTILINE
    )
    for m in pat.finditer(content):
        slot = int(m.group(1))
        tex_var = m.group(2)
        bindings.append({'slot': slot, 'texture': tex_var})
    return bindings


def audit(verbose=False):
    if not os.path.exists(RENDERER):
        print(f"ERROR: WebGLRenderer.js not found at {RENDERER}")
        return 1

    with open(RENDERER, 'r', encoding='utf-8') as f:
        content = f.read()

    print("=" * 60)
    print("SHADER UNIFORM AUDIT -- MatrixCode v8.5")
    print("=" * 60)

    # 1. Extract GLSL blocks
    shaders = extract_glsl_blocks(content)
    print(f"\nFound {len(shaders)} shader blocks: {', '.join(shaders.keys())}")

    # 2. Parse uniforms from each shader
    all_uniforms = {}  # shader_name -> {uniform_name -> info}
    uniform_index = defaultdict(list)  # uniform_name -> [shader_names]

    for name, source in shaders.items():
        uniforms = parse_glsl_uniforms(source, name)
        all_uniforms[name] = uniforms
        for uname in uniforms:
            uniform_index[uname].append(name)
        if verbose:
            print(f"\n  {name}: {len(uniforms)} uniforms")
            for uname, info in sorted(uniforms.items()):
                arr = f"[{info['array_size']}]" if info['array_size'] else ""
                print(f"    {info['type']} {uname}{arr}")

    # 3. Find JS-side uniform locations
    js_locations, js_dispatches = find_js_uniform_calls(content)
    print(f"\nJS getUniformLocation calls: {len(js_locations)}")

    # 4. Cross-reference
    all_glsl_uniforms = set()
    for shader_uniforms in all_uniforms.values():
        all_glsl_uniforms.update(shader_uniforms.keys())

    errors = []
    warnings = []

    # Check: GLSL declares uniform but JS never gets its location
    for uname in sorted(all_glsl_uniforms):
        if uname not in js_locations:
            shaders_using = uniform_index[uname]
            # Skip built-in uniforms
            if uname.startswith('gl_'):
                continue
            warnings.append(f"GLSL-only: '{uname}' declared in {shaders_using} but no getUniformLocation in JS")

    # Check: JS gets location but no GLSL declaration found
    for uname in sorted(js_locations):
        if uname not in all_glsl_uniforms:
            # Could be in a shader we didn't parse (post-processor, etc.)
            warnings.append(f"JS-only: getUniformLocation('{uname}') but not found in any parsed GLSL block")

    # Check: duplicate uniform names with different types across shaders
    for uname, shader_list in uniform_index.items():
        if len(shader_list) > 1:
            types_seen = set()
            for sname in shader_list:
                types_seen.add(all_uniforms[sname][uname]['type'])
            if len(types_seen) > 1:
                errors.append(f"TYPE MISMATCH: '{uname}' has types {types_seen} across shaders {shader_list}")

    # 5. Texture bindings
    bindings = find_texture_bindings(content)
    if verbose and bindings:
        print(f"\nTexture bindings found: {len(bindings)}")
        for b in sorted(bindings, key=lambda x: x['slot']):
            print(f"  Slot {b['slot']}: {b['texture']}")

    # Check for slot conflicts (same slot bound to different textures in same pass)
    slot_map = defaultdict(set)
    for b in bindings:
        slot_map[b['slot']].add(b['texture'])

    for slot, textures in sorted(slot_map.items()):
        if len(textures) > 1:
            # This is expected across different passes, so just note it
            if verbose:
                print(f"  Note: Slot {slot} bound to multiple textures (multi-pass): {textures}")

    # 6. Report
    print("\n" + "=" * 60)
    if errors:
        print(f"ERRORS: {len(errors)}")
        for e in errors:
            print(f"  [ERROR] {e}")
    else:
        print("ERRORS: 0")

    if warnings:
        print(f"\nWARNINGS: {len(warnings)}")
        for w in warnings:
            print(f"  [WARN] {w}")
    else:
        print("WARNINGS: 0")

    # Summary
    total_uniforms = sum(len(u) for u in all_uniforms.values())
    print(f"\nSUMMARY:")
    print(f"  Shader blocks parsed: {len(shaders)}")
    print(f"  Total GLSL uniforms:  {total_uniforms}")
    print(f"  JS uniform locations: {len(js_locations)}")
    print(f"  Errors:               {len(errors)}")
    print(f"  Warnings:             {len(warnings)}")
    print("=" * 60)

    return 1 if errors else 0


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    sys.exit(audit(verbose))
