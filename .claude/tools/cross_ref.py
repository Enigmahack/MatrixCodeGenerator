#!/usr/bin/env python3
"""
Cross-Module Reference Validator for MatrixCode v8.5

Checks for:
  1. Worker files using symbols not available in their scope
  2. Classes referenced but not defined in any scanned file
  3. Circular dependency detection
  4. Missing importScripts in worker files
  5. Global window.* assignments and their consumers

Usage:
  python .claude/tools/cross_ref.py [--verbose]
"""

import re
import os
import sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))
V85 = os.path.join(ROOT, 'MatrixCode_v8.5')
JS_DIR = os.path.join(V85, 'js')

SKIP_FILES = {'QuantizedPatterns.js', 'FontData.js'}


def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def scan_definitions(content):
    """Extract all class/const/function definitions."""
    defs = set()

    # Classes
    for m in re.finditer(r'class\s+(\w+)', content):
        defs.add(m.group(1))

    # Top-level const/let/var assignments
    for m in re.finditer(r'^(?:const|let|var)\s+(\w+)\s*=', content, re.MULTILINE):
        defs.add(m.group(1))

    # Function declarations
    for m in re.finditer(r'^function\s+(\w+)', content, re.MULTILINE):
        defs.add(m.group(1))

    return defs


def scan_references(content):
    """Extract class/constructor references (new Xxx, extends Xxx, instanceof Xxx)."""
    refs = set()

    for m in re.finditer(r'new\s+(\w+)', content):
        refs.add(m.group(1))
    for m in re.finditer(r'extends\s+(\w+)', content):
        refs.add(m.group(1))
    for m in re.finditer(r'instanceof\s+(\w+)', content):
        refs.add(m.group(1))

    # Static method calls: ClassName.method
    for m in re.finditer(r'([A-Z]\w+)\.\w+\s*\(', content):
        name = m.group(1)
        if name not in ('Math', 'Array', 'Object', 'JSON', 'Date', 'Promise',
                        'Float32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
                        'Int16Array', 'Int32Array', 'Set', 'Map', 'WeakMap',
                        'WebGLRenderingContext', 'HTMLCanvasElement', 'URL',
                        'SharedArrayBuffer', 'ArrayBuffer', 'DataView',
                        'ImageData', 'Blob', 'Worker', 'Error', 'TypeError',
                        'String', 'Number', 'Boolean', 'RegExp', 'Symbol',
                        'Uint8ClampedArray', 'Float64Array', 'BigInt64Array',
                        'FontFace', 'Response', 'Request', 'Headers',
                        'WebSocket', 'EventSource', 'AbortController',
                        'Infinity', 'NaN', 'CSS', 'Node'):
            refs.add(name)

    return refs


def scan_worker_deps(content):
    """Extract importScripts paths from worker files."""
    imports = []
    for m in re.finditer(r"importScripts\s*\(\s*['\"]([^'\"]+)['\"]", content):
        imports.append(m.group(1))
    return imports


def audit(verbose=False):
    print("=" * 60)
    print("CROSS-MODULE REFERENCE AUDIT -- MatrixCode v8.5")
    print("=" * 60)

    # Phase 1: Scan all files
    file_defs = {}    # filepath -> set of defined names
    file_refs = {}    # filepath -> set of referenced names
    all_defs = {}     # name -> filepath (first definition wins)
    file_deps = defaultdict(set)  # filepath -> set of filepaths it depends on

    all_files = []
    for dirpath, dirs, files in os.walk(JS_DIR):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
        for fname in sorted(files):
            if not fname.endswith('.js') or fname in SKIP_FILES:
                continue
            path = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(path, V85).replace('\\', '/')
            all_files.append((rel_path, path))

    for rel_path, path in all_files:
        content = read_file(path)
        defs = scan_definitions(content)
        refs = scan_references(content)

        file_defs[rel_path] = defs
        file_refs[rel_path] = refs

        for d in defs:
            if d not in all_defs:
                all_defs[d] = rel_path

    print(f"\nFiles scanned: {len(all_files)}")
    print(f"Total definitions: {len(all_defs)}")

    errors = []
    warnings = []

    # Phase 2: Check for undefined references
    all_def_names = set(all_defs.keys())
    # Add well-known browser globals
    browser_globals = {
        'window', 'document', 'console', 'navigator', 'performance',
        'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout',
        'setInterval', 'clearTimeout', 'clearInterval', 'fetch',
        'localStorage', 'sessionStorage', 'indexedDB', 'self',
        'postMessage', 'onmessage', 'importScripts', 'atob', 'btoa',
        'alert', 'confirm', 'prompt', 'AudioContext', 'OffscreenCanvas',
    }

    for rel_path, _ in all_files:
        refs = file_refs.get(rel_path, set())
        defs = file_defs.get(rel_path, set())

        unresolved = refs - all_def_names - browser_globals - defs
        if unresolved and verbose:
            print(f"\n  {rel_path}: {len(unresolved)} unresolved references")
            for u in sorted(unresolved):
                print(f"    ? {u}")

    # Phase 3: Worker validation
    workers = [
        'js/simulation/SimulationWorker.js',
        'js/effects/QuantizedBFSWorker.js',
    ]

    for worker_rel in workers:
        worker_path = os.path.join(V85, worker_rel.replace('/', os.sep))
        if not os.path.exists(worker_path):
            continue

        content = read_file(worker_path)
        imports = scan_worker_deps(content)
        refs = scan_references(content)
        local_defs = scan_definitions(content)

        # Resolve imported definitions
        available_defs = set(local_defs)
        for imp in imports:
            # Resolve relative to worker location
            worker_dir = os.path.dirname(worker_rel)
            resolved = os.path.normpath(os.path.join(worker_dir, imp)).replace('\\', '/')
            if resolved in file_defs:
                available_defs.update(file_defs[resolved])

        missing = refs - available_defs - browser_globals
        if missing:
            for m in sorted(missing):
                if m in all_defs:
                    source = all_defs[m]
                    errors.append(f"WORKER '{worker_rel}': Uses '{m}' (defined in {source}) but doesn't import it")
                elif verbose:
                    warnings.append(f"WORKER '{worker_rel}': References unknown '{m}'")

        if verbose:
            print(f"\n  Worker: {worker_rel}")
            print(f"    Imports: {imports}")
            print(f"    Available defs: {len(available_defs)}")
            print(f"    References: {len(refs)}")

    # Phase 4: Dependency graph for circular detection
    for rel_path, _ in all_files:
        refs = file_refs.get(rel_path, set())
        defs = file_defs.get(rel_path, set())
        for ref in refs:
            if ref in all_defs and all_defs[ref] != rel_path:
                file_deps[rel_path].add(all_defs[ref])

    # Simple cycle detection (DFS)
    visited = set()
    in_stack = set()
    cycles = []

    def dfs(node, path):
        if node in in_stack:
            cycle_start = path.index(node)
            cycles.append(path[cycle_start:] + [node])
            return
        if node in visited:
            return
        visited.add(node)
        in_stack.add(node)
        path.append(node)
        for dep in file_deps.get(node, set()):
            dfs(dep, path)
        path.pop()
        in_stack.remove(node)

    for rel_path, _ in all_files:
        if rel_path not in visited:
            dfs(rel_path, [])

    if cycles:
        for cycle in cycles[:5]:  # Limit output
            warnings.append(f"CIRCULAR: {' -> '.join(cycle)}")

    # Phase 5: window.* globals
    globals_defined = {}
    for rel_path, path in all_files:
        content = read_file(path)
        for m in re.finditer(r'window\.(\w+)\s*=', content):
            name = m.group(1)
            if name not in ('matrix', 'matrixPatterns', 'onerror', 'onload'):
                globals_defined.setdefault(name, []).append(rel_path)

    if globals_defined and verbose:
        print(f"\n  window.* globals:")
        for name, files in sorted(globals_defined.items()):
            print(f"    window.{name} = ... ({', '.join(files)})")

    # Report
    print("\n" + "=" * 60)
    if errors:
        print(f"ERRORS: {len(errors)}")
        for e in errors:
            print(f"  [ERROR] {e}")
    else:
        print("ERRORS: 0")

    if warnings:
        print(f"\nWARNINGS: {len(warnings)}")
        for w in warnings[:20]:
            print(f"  [WARN] {w}")
        if len(warnings) > 20:
            print(f"  ... and {len(warnings) - 20} more")
    else:
        print("WARNINGS: 0")

    print("=" * 60)
    return 1 if errors else 0


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    sys.exit(audit(verbose))
