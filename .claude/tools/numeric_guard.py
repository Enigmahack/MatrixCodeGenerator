#!/usr/bin/env python3
"""
Numeric Stability Scanner for MatrixCode v8.5

Detects potential NaN/Infinity sources:
  1. Division without zero-guard
  2. Math operations on unvalidated inputs (hue, brightness, color)
  3. Modulo operations that can produce negative values
  4. Missing isNaN/isFinite checks on color/brightness calculations
  5. Unchecked array/typed-array access patterns

Usage:
  python .claude/tools/numeric_guard.py [--verbose] [--file path]
"""

import re
import os
import sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))
V85 = os.path.join(ROOT, 'MatrixCode_v8.5', 'js')

# Files to skip (data-only, tools, workers)
SKIP_FILES = {'QuantizedPatterns.js', 'FontData.js', 'QuantizedBFSWorker.js',
              'QuantizedAnimationEncoder.js', 'QuantizedAnimationOptimizer.js'}

# High-risk function/property names that handle numeric values
NUMERIC_CONTEXTS = [
    'hue', 'brightness', 'saturation', 'alpha', 'glow', 'intensity',
    'decay', 'fade', 'speed', 'radius', 'scale', 'color', 'luma',
    'variance', 'bloom', 'threshold', 'opacity',
]


def scan_file(path, verbose=False):
    """Scan a single file for numeric stability issues."""
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    fname = os.path.basename(path)
    issues = []

    for i, line in enumerate(lines):
        lineno = i + 1
        stripped = line.strip()

        # Skip comments
        if stripped.startswith('//') or stripped.startswith('*'):
            continue

        # 1. Division without zero guard
        # Skip lines containing HTML templates, string literals with tags, or URLs
        is_html_line = bool(re.search(r'[`\'"].*<\w+[\s/>]|innerHTML|outerHTML|textContent|href\s*=|https?://', stripped))
        if is_html_line:
            div_results = []
        else:
            # Require arithmetic context: number or ) or variable before the /
            div_results = re.findall(r'(?<=[\w)\]])\s*/\s*([a-zA-Z_]\w*(?:\.\w+)*)', stripped)

        for divisor in div_results:
            # Skip obvious safe divisors
            if divisor in ('2', '255', '256', '360', 'Math', 'PI', 'length', 'size'):
                continue
            # Check if there's a zero guard within 3 lines
            context = ''.join(lines[max(0, i-3):i+4])
            has_guard = any(g in context for g in [
                f'{divisor} === 0', f'{divisor} == 0', f'{divisor} !== 0',
                f'{divisor} != 0', f'{divisor} || ', f'{divisor} > 0',
                f'Math.max({divisor}', f'Math.max(1', f'|| 1',
                f'{divisor} < ', f'if ({divisor})', f'if({divisor})',
            ])
            if not has_guard:
                # Check if it's in a numeric context
                is_numeric = any(ctx in stripped.lower() for ctx in NUMERIC_CONTEXTS)
                if is_numeric:
                    issues.append({
                        'line': lineno,
                        'type': 'DIV_NO_GUARD',
                        'severity': 'warn',
                        'msg': f"Division by '{divisor}' without visible zero-guard in numeric context",
                        'code': stripped[:120],
                    })

        # 2. Modulo that can produce negative values
        mod_pat = re.findall(r'(\w+)\s*%\s*(\w+)', stripped)
        for lhs, rhs in mod_pat:
            # In JS, -5 % 3 = -2 which is often unexpected for hue/angle wrapping
            is_angle = any(ctx in stripped.lower() for ctx in ['hue', 'angle', 'rotation', 'phase', 'degree'])
            if is_angle:
                # Check if there's a positivity fix nearby
                context = ''.join(lines[max(0, i-2):i+3])
                has_fix = any(g in context for g in [
                    '+ 360) %', '+ 1.0) %', 'Math.abs', '+ rhs) %',
                    f'+ {rhs}) %', 'while', '< 0',
                ])
                if not has_fix:
                    issues.append({
                        'line': lineno,
                        'type': 'NEGATIVE_MOD',
                        'severity': 'warn',
                        'msg': f"Modulo '{lhs} % {rhs}' in angle/hue context may produce negative values",
                        'code': stripped[:120],
                    })

        # 3. Math.sqrt / Math.log / Math.asin without domain guard
        for func in ['Math.sqrt', 'Math.log', 'Math.asin', 'Math.acos']:
            if func in stripped:
                context = ''.join(lines[max(0, i-2):i+3])
                has_guard = any(g in context for g in [
                    'Math.max(0', 'Math.abs', 'Math.max(1',
                    'clamp', '>= 0', '> 0', 'if (',
                ])
                if not has_guard:
                    issues.append({
                        'line': lineno,
                        'type': 'DOMAIN_RISK',
                        'severity': 'info',
                        'msg': f"'{func}' without visible domain guard (could produce NaN)",
                        'code': stripped[:120],
                    })

        # 4. Color parsing without NaN check
        if 'parseInt' in stripped and ('color' in stripped.lower() or 'hex' in stripped.lower() or '16)' in stripped):
            context = ''.join(lines[i:min(len(lines), i+5)])
            if 'isNaN' not in context and 'NaN' not in context and '|| 0' not in context:
                issues.append({
                    'line': lineno,
                    'type': 'PARSE_NO_NAN',
                    'severity': 'info',
                    'msg': "parseInt in color context without isNaN guard",
                    'code': stripped[:120],
                })

        # 5. Typed array access without bounds check (hot loop risk)
        typed_access = re.findall(r'(chars|colors|alphas|glows|decays|brightness)\[(\w+)\]', stripped)
        for arr_name, index_var in typed_access:
            # Only flag if index comes from calculation (not simple loop var)
            if any(op in index_var for op in ['+', '-', '*']):
                context = ''.join(lines[max(0, i-3):i+1])
                if 'Math.min' not in context and 'Math.max' not in context and 'clamp' not in context:
                    if verbose:  # Only in verbose mode as this is very noisy
                        issues.append({
                            'line': lineno,
                            'type': 'BOUNDS_RISK',
                            'severity': 'info',
                            'msg': f"Typed array '{arr_name}[{index_var}]' with computed index",
                            'code': stripped[:120],
                        })

    return issues


def audit(verbose=False, single_file=None):
    print("=" * 60)
    print("NUMERIC STABILITY SCAN -- MatrixCode v8.5")
    print("=" * 60)

    all_issues = defaultdict(list)
    files_scanned = 0

    if single_file:
        path = os.path.join(ROOT, single_file)
        if os.path.exists(path):
            issues = scan_file(path, verbose)
            all_issues[single_file] = issues
            files_scanned = 1
        else:
            print(f"File not found: {path}")
            return 1
    else:
        for dirpath, dirs, files in os.walk(V85):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
            for fname in files:
                if not fname.endswith('.js') or fname in SKIP_FILES:
                    continue
                path = os.path.join(dirpath, fname)
                rel_path = os.path.relpath(path, ROOT).replace('\\', '/')
                issues = scan_file(path, verbose)
                if issues:
                    all_issues[rel_path] = issues
                files_scanned += 1

    # Report
    total_warn = 0
    total_info = 0

    for fpath, issues in sorted(all_issues.items()):
        warns = [i for i in issues if i['severity'] == 'warn']
        infos = [i for i in issues if i['severity'] == 'info']
        total_warn += len(warns)
        total_info += len(infos)

        if warns or verbose:
            print(f"\n  {fpath}")
            for issue in issues:
                if issue['severity'] == 'warn' or verbose:
                    tag = issue['type']
                    print(f"    L{issue['line']:4d} [{tag}] {issue['msg']}")
                    if verbose:
                        print(f"           {issue['code']}")

    print("\n" + "=" * 60)
    print(f"Files scanned: {files_scanned}")
    print(f"Warnings:      {total_warn}")
    print(f"Info:          {total_info}")
    print("=" * 60)

    return 0


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    single_file = None
    for arg in sys.argv[1:]:
        if arg.startswith('--file='):
            single_file = arg.split('=', 1)[1]
        elif not arg.startswith('-'):
            single_file = arg

    sys.exit(audit(verbose, single_file))
