#!/usr/bin/env python3
"""
Quick File Summarizer for MatrixCode v8.5

Generates a compact summary of any JS file showing:
  - Class declarations and inheritance
  - Method signatures (public and private)
  - Property assignments in constructor
  - Config key reads
  - Uniform/texture references
  - Line count and structure

Designed to replace reading entire files when you just need the API surface.

Usage:
  python .claude/tools/quick_summary.py <file_path>
  python .claude/tools/quick_summary.py MatrixCode_v8.5/js/effects/CrashEffect.js
  python .claude/tools/quick_summary.py --all   # Summarize all files
"""

import re
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))


def summarize_file(path):
    """Generate a compact summary of a JS file."""
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    total_lines = len(lines)
    content = ''.join(lines)
    fname = os.path.basename(path)

    output = []
    output.append(f"# {fname} ({total_lines} lines)")
    output.append(f"# Path: {os.path.relpath(path, ROOT).replace(chr(92), '/')}")

    # Classes
    class_pat = re.compile(r'class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{')
    classes = class_pat.findall(content)
    if classes:
        output.append("\n## Classes")
        for cls, parent in classes:
            ext = f" extends {parent}" if parent else ""
            output.append(f"  class {cls}{ext}")

    # Constructor properties (this.xxx = yyy)
    ctor_match = re.search(r'constructor\s*\([^)]*\)\s*\{([\s\S]*?)(?=^\s{2,4}(?:\w+\s*\(|get\s|set\s|static\s))', content, re.MULTILINE)
    if ctor_match:
        ctor_body = ctor_match.group(1)
        props = re.findall(r'this\.(\w+)\s*=', ctor_body)
        if props:
            # Deduplicate and limit
            unique_props = list(dict.fromkeys(props))
            output.append(f"\n## Constructor Properties ({len(unique_props)})")
            for p in unique_props[:40]:
                output.append(f"  this.{p}")
            if len(unique_props) > 40:
                output.append(f"  ... and {len(unique_props) - 40} more")

    # Methods with signatures -- must be valid JS method names, not control flow
    js_keywords = {'if', 'else', 'for', 'while', 'switch', 'catch', 'do', 'try', 'return', 'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of'}
    method_pat = re.compile(r'^(\s+)((?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([a-zA-Z_]\w*))\s*\(([^)]*)\)\s*\{', re.MULTILINE)
    methods = [(m[0], m[1], m[2], m[3]) for m in method_pat.findall(content) if m[2] not in js_keywords]
    if methods:
        public = [(m[1].strip(), m[3].strip()) for m in methods if not m[2].startswith('_')]
        private = [(m[1].strip(), m[3].strip()) for m in methods if m[2].startswith('_')]

        if public:
            output.append(f"\n## Public Methods ({len(public)})")
            for name, params in public:
                output.append(f"  {name}({params})")

        if private:
            output.append(f"\n## Private Methods ({len(private)})")
            for name, params in private:
                output.append(f"  {name}({params})")

    # Config key reads
    config_reads = set()
    config_pat = re.compile(r"(?:config\.get|getConfig|this\.getConfig)\s*\(\s*['\"](\w+)['\"]")
    for m in config_pat.finditer(content):
        config_reads.add(m.group(1))

    prefix_config = set()
    prefix_pat = re.compile(r"(?:config\.get|getConfig)\s*\(\s*(?:this\.)?(?:configPrefix|prefix)\s*\+\s*['\"](\w+)['\"]")
    for m in prefix_pat.finditer(content):
        prefix_config.add(m.group(1))

    if config_reads or prefix_config:
        output.append(f"\n## Config Reads")
        for k in sorted(config_reads):
            output.append(f"  config.get('{k}')")
        for k in sorted(prefix_config):
            output.append(f"  config.get(prefix + '{k}')")

    # Uniform references
    uniform_refs = set()
    uniform_pat = re.compile(r"['\"]u_(\w+)['\"]")
    for m in uniform_pat.finditer(content):
        uniform_refs.add(f"u_{m.group(1)}")

    if uniform_refs:
        output.append(f"\n## Uniform References ({len(uniform_refs)})")
        for u in sorted(uniform_refs):
            output.append(f"  {u}")

    # Constants and enums
    const_pat = re.compile(r'(?:const|static)\s+(\w+)\s*=\s*\{([^}]+)\}', re.MULTILINE)
    consts = const_pat.findall(content)
    enum_like = []
    for name, body in consts:
        if name.isupper() or re.search(r'\w+:\s*\d+', body):
            entries = re.findall(r'(\w+)\s*:\s*(\d+|[\'"][^"\']+[\'"])', body)
            if entries:
                enum_like.append((name, entries))

    if enum_like:
        output.append(f"\n## Constants/Enums")
        for name, entries in enum_like:
            vals = ', '.join(f'{k}={v}' for k, v in entries[:10])
            output.append(f"  {name}: {{{vals}}}")

    # Event/subscriber patterns
    if 'subscribe(' in content or 'addEventListener(' in content:
        subs = re.findall(r"(?:subscribe|addEventListener)\s*\(\s*['\"]?(\w+)?['\"]?", content)
        if subs:
            output.append(f"\n## Subscriptions/Events")
            for s in set(subs):
                output.append(f"  {s}")

    return '\n'.join(output)


def main():
    if len(sys.argv) < 2:
        print("Usage: python quick_summary.py <file_path|--all>")
        sys.exit(1)

    if sys.argv[1] == '--all':
        v85 = os.path.join(ROOT, 'MatrixCode_v8.5', 'js')
        for dirpath, dirs, files in os.walk(v85):
            dirs[:] = [d for d in dirs if d not in ('node_modules',)]
            for fname in sorted(files):
                if not fname.endswith('.js'):
                    continue
                if fname in ('QuantizedPatterns.js', 'FontData.js'):
                    print(f"# {fname} (DATA FILE -- skipped)")
                    print()
                    continue
                path = os.path.join(dirpath, fname)
                print(summarize_file(path))
                print()
    else:
        target = sys.argv[1]
        # Resolve relative to ROOT if not absolute
        if not os.path.isabs(target):
            target = os.path.join(ROOT, target)
        if not os.path.exists(target):
            # Try with MatrixCode_v8.5 prefix
            alt = os.path.join(ROOT, 'MatrixCode_v8.5', target)
            if os.path.exists(alt):
                target = alt
            else:
                print(f"File not found: {target}")
                sys.exit(1)

        print(summarize_file(target))


if __name__ == '__main__':
    main()
