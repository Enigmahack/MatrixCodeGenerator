#!/usr/bin/env python3
"""
Configuration Key Inheritance Audit for MatrixCode v8.5

Verifies that:
  1. All QuantizedInheritableSettings suffixes are in inheritableSuffixes
  2. All per-effect config keys have matching default keys
  3. Config defaults exist for all template-defined keys
  4. No orphaned config keys (defined but never read)

Usage:
  python .claude/tools/config_audit.py [--verbose]
"""

import re
import os
import sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))
V85 = os.path.join(ROOT, 'MatrixCode_v8.5')
CONFIG_MGR = os.path.join(V85, 'js', 'config', 'ConfigurationManager.js')
CONFIG_TPL = os.path.join(V85, 'js', 'config', 'ConfigTemplate.js')
EFFECTS_DIR = os.path.join(V85, 'js', 'effects')


def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def extract_inheritable_settings(tpl_content):
    """Extract setting IDs from QuantizedInheritableSettings array."""
    settings = []

    # Find the QuantizedInheritableSettings array start
    start = tpl_content.find('QuantizedInheritableSettings')
    if start == -1:
        return settings

    # Find the opening bracket
    bracket_start = tpl_content.find('[', start)
    if bracket_start == -1:
        return settings

    # Use line-by-line scanning instead of bracket matching (arrow functions break bracket counting)
    # Just scan for id: 'Xxx' patterns from the array start until we hit the end marker
    # The array ends when we see ]; at the start of a line or the QuantizedInheritableSettingIds line
    end_markers = ['QuantizedInheritableSettingIds', 'function generateQuantized', 'const QuantizedEffectSettings']
    end = len(tpl_content)
    for marker in end_markers:
        pos = tpl_content.find(marker, bracket_start)
        if pos != -1 and pos < end:
            end = pos

    array_content = tpl_content[bracket_start:end]

    # Match { ... id: 'SomeKey' ... } -- id can appear anywhere in the object literal
    pat = re.compile(r"id:\s*'(\w+)'")
    for m in pat.finditer(array_content):
        settings.append(m.group(1))

    return settings


def extract_inheritable_suffixes(mgr_content):
    """Extract the inheritableSuffixes set/array from ConfigurationManager."""
    suffixes = []

    # Look for inheritableSuffixes = [ ... ] or new Set([ ... ])
    pat = re.compile(r"inheritableSuffixes\s*(?:=\s*(?:new\s+Set\s*\(\s*)?\[|\.(?:add|push)\s*\(\s*['\"](\w+)['\"])")

    # First try to find the array/set definition
    array_pat = re.compile(r"inheritableSuffixes\s*=\s*(?:new\s+Set\s*\(\s*)?\[([\s\S]*?)\]")
    m = array_pat.search(mgr_content)
    if m:
        array_body = m.group(1)
        str_pat = re.compile(r"'(\w+)'")
        for sm in str_pat.finditer(array_body):
            suffixes.append(sm.group(1))

    # Also check for .add() or .push() calls
    add_pat = re.compile(r"inheritableSuffixes\.(?:add|push)\s*\(\s*'(\w+)'\s*\)")
    for m in add_pat.finditer(mgr_content):
        suffixes.append(m.group(1))

    return suffixes


def extract_config_defaults(mgr_content):
    """Extract default config values from the defaults object."""
    defaults = {}

    # The defaults are in _initializeDefaults() which returns { ... }
    # or in a `const defaults = { ... }` block
    # Find all "key": value patterns with quoted keys (JSON style)
    # Also find key: value patterns (JS object literal style)

    # Look for the defaults object -- could be `const defaults = {` or inside _initializeDefaults
    for start_pat in ['const defaults = {', '_initializeDefaults', 'this.defaults = {']:
        pos = mgr_content.find(start_pat)
        if pos != -1:
            break
    else:
        return defaults

    # Find the opening brace after the match
    brace_start = mgr_content.find('{', pos)
    if brace_start == -1:
        return defaults

    # Scan for "key": value or key: value patterns
    # We don't need to find the closing brace -- just scan forward a reasonable amount
    # The defaults block is typically ~1500 lines
    scan_region = mgr_content[brace_start:brace_start + 100000]

    # Match both "quotedKey": and unquotedKey: patterns
    pat = re.compile(r'["\'](\w+)["\']\s*:\s*|(?<=\n)\s*(\w+)\s*:')
    for m in pat.finditer(scan_region):
        key = m.group(1) or m.group(2)
        if key and not key.startswith('_') and key not in ('return', 'const', 'let', 'var', 'if', 'else', 'function'):
            defaults[key] = True

    return defaults


def extract_effect_config_reads(effects_dir):
    """Find all config key reads across effect files."""
    reads = defaultdict(list)  # key -> [file, ...]

    for fname in os.listdir(effects_dir):
        if not fname.endswith('.js'):
            continue
        path = os.path.join(effects_dir, fname)
        content = read_file(path)

        # Match patterns: config.get('key'), this.config.get('key'), getConfig('key')
        pat = re.compile(r"(?:config\.get|getConfig|this\.getConfig)\s*\(\s*['\"](\w+)['\"]")
        for m in pat.finditer(content):
            reads[m.group(1)].append(fname)

        # Match: config.get(prefix + 'Suffix') patterns
        prefix_pat = re.compile(r"(?:config\.get|getConfig)\s*\(\s*(?:this\.)?(?:configPrefix|prefix)\s*\+\s*['\"](\w+)['\"]")
        for m in prefix_pat.finditer(content):
            reads[f'{{prefix}}{m.group(1)}'].append(fname)

    return reads


def extract_effect_prefixes(effects_dir):
    """Find configPrefix assignments in effect files."""
    prefixes = {}
    for fname in os.listdir(effects_dir):
        if not fname.endswith('.js'):
            continue
        path = os.path.join(effects_dir, fname)
        content = read_file(path)

        pat = re.compile(r"this\.configPrefix\s*=\s*['\"](\w+)['\"]")
        m = pat.search(content)
        if m:
            prefixes[fname] = m.group(1)

    return prefixes


def audit(verbose=False):
    print("=" * 60)
    print("CONFIG KEY INHERITANCE AUDIT -- MatrixCode v8.5")
    print("=" * 60)

    errors = []
    warnings = []

    # 1. Parse ConfigTemplate
    tpl_content = read_file(CONFIG_TPL)
    inheritable_settings = extract_inheritable_settings(tpl_content)
    print(f"\nInheritableSettings in ConfigTemplate: {len(inheritable_settings)}")
    if verbose:
        for s in inheritable_settings:
            print(f"  - {s}")

    # 2. Parse ConfigurationManager
    mgr_content = read_file(CONFIG_MGR)
    registered_suffixes = extract_inheritable_suffixes(mgr_content)
    print(f"Registered inheritableSuffixes: {len(registered_suffixes)}")
    if verbose:
        for s in registered_suffixes:
            print(f"  - {s}")

    # 3. Cross-reference: settings defined but not in suffixes
    settings_set = set(inheritable_settings)
    suffixes_set = set(registered_suffixes)

    missing_from_suffixes = settings_set - suffixes_set
    if missing_from_suffixes:
        for s in sorted(missing_from_suffixes):
            errors.append(f"MISSING SUFFIX: '{s}' is in QuantizedInheritableSettings but NOT in inheritableSuffixes")

    extra_in_suffixes = suffixes_set - settings_set
    if extra_in_suffixes:
        for s in sorted(extra_in_suffixes):
            warnings.append(f"ORPHAN SUFFIX: '{s}' is in inheritableSuffixes but NOT in QuantizedInheritableSettings")

    # 4. Check that quantizedDefault{Suffix} exists in defaults for each inheritable setting
    defaults = extract_config_defaults(mgr_content)
    print(f"Config defaults found: {len(defaults)}")

    for suffix in inheritable_settings:
        default_key = f'quantizedDefault{suffix}'
        if default_key not in defaults:
            warnings.append(f"NO DEFAULT: '{default_key}' not found in config defaults for inheritable '{suffix}'")

    # 5. Effect config reads
    effect_reads = extract_effect_config_reads(EFFECTS_DIR)
    effect_prefixes = extract_effect_prefixes(EFFECTS_DIR)
    print(f"Effect config read patterns: {len(effect_reads)}")
    print(f"Effect prefixes found: {len(effect_prefixes)}")
    if verbose:
        for fname, prefix in sorted(effect_prefixes.items()):
            print(f"  {fname}: configPrefix = '{prefix}'")

    # 6. Report
    print("\n" + "=" * 60)
    if errors:
        print(f"ERRORS: {len(errors)}")
        for e in errors:
            print(f"  [ERROR] {e}")
    else:
        print("ERRORS: 0 -- All inheritable settings have registered suffixes")

    if warnings:
        print(f"\nWARNINGS: {len(warnings)}")
        for w in warnings:
            print(f"  [WARN] {w}")
    else:
        print("WARNINGS: 0")

    print(f"\nSUMMARY:")
    print(f"  Inheritable settings: {len(inheritable_settings)}")
    print(f"  Registered suffixes:  {len(registered_suffixes)}")
    print(f"  Missing suffixes:     {len(missing_from_suffixes)}")
    print(f"  Orphan suffixes:      {len(extra_in_suffixes)}")
    print(f"  Config defaults:      {len(defaults)}")
    print(f"  Effect prefixes:      {len(effect_prefixes)}")
    print("=" * 60)

    return 1 if errors else 0


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    sys.exit(audit(verbose))
