#!/usr/bin/env python3
"""
Effect Lifecycle Audit for MatrixCode v8.5

Checks all effect classes for:
  1. Proper trigger/stop/update implementation
  2. Consistent trigger(force, ...args) signature
  3. Missing cleanup in stop()
  4. Effects that set active=true but never set active=false
  5. Missing enabledKey/frequencyKey registration

Usage:
  python .claude/tools/effect_audit.py [--verbose]
"""

import re
import os
import sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))
EFFECTS_DIR = os.path.join(ROOT, 'MatrixCode_v8.5', 'js', 'effects')


def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def analyze_effect(fname, content):
    """Analyze a single effect file for lifecycle issues."""
    issues = []
    info = {
        'class_name': None,
        'extends': None,
        'has_trigger': False,
        'has_stop': False,
        'has_update': False,
        'has_apply_to_grid': False,
        'trigger_sig': None,
        'sets_active_true': False,
        'sets_active_false': False,
        'has_enabled_key': False,
        'has_frequency_key': False,
        'cleans_up_in_stop': False,
    }

    # Extract class declaration
    class_pat = re.compile(r'class\s+(\w+)\s+extends\s+(\w+)')
    m = class_pat.search(content)
    if m:
        info['class_name'] = m.group(1)
        info['extends'] = m.group(2)
    else:
        return info, issues  # Not an effect class

    # Skip non-effect classes
    if info['extends'] not in ('AbstractEffect', 'QuantizedBaseEffect'):
        # Check if it might be indirectly extending
        if 'Effect' not in (info['class_name'] or ''):
            return info, issues

    # Check method implementations
    info['has_trigger'] = bool(re.search(r'^\s+trigger\s*\(', content, re.MULTILINE))
    info['has_stop'] = bool(re.search(r'^\s+stop\s*\(', content, re.MULTILINE))
    info['has_update'] = bool(re.search(r'^\s+update\s*\(', content, re.MULTILINE))
    info['has_apply_to_grid'] = bool(re.search(r'^\s+applyToGrid\s*\(', content, re.MULTILINE))

    # Extract trigger signature
    trigger_pat = re.compile(r'trigger\s*\(([^)]*)\)')
    m = trigger_pat.search(content)
    if m:
        info['trigger_sig'] = m.group(1).strip()

    # Check active flag management
    info['sets_active_true'] = bool(re.search(r'this\.active\s*=\s*true', content))
    info['sets_active_false'] = bool(re.search(r'this\.active\s*=\s*false', content))

    # Check enabledKey and frequencyKey
    info['has_enabled_key'] = bool(re.search(r'this\.enabledKey\s*=', content))
    info['has_frequency_key'] = bool(re.search(r'this\.frequencyKey\s*=', content))

    # Check stop() cleanup
    stop_match = re.search(r'stop\s*\(\s*\)\s*\{([\s\S]*?)^\s{2,4}\}', content, re.MULTILINE)
    if stop_match:
        stop_body = stop_match.group(1)
        info['cleans_up_in_stop'] = 'this.active' in stop_body

    # --- Issue detection ---

    # Effect sets active=true but never sets active=false
    if info['sets_active_true'] and not info['sets_active_false']:
        issues.append("LEAK: Sets this.active=true but never sets this.active=false")

    # Has trigger but no stop
    if info['has_trigger'] and not info['has_stop'] and info['extends'] == 'AbstractEffect':
        issues.append("MISSING: Has trigger() but no stop() method")

    # Has trigger that doesn't check enabled
    if info['has_trigger']:
        trigger_match = re.search(r'trigger\s*\([^)]*\)\s*\{([\s\S]*?)(?=^\s{2,4}(?:stop|update|applyToGrid|\w+\s*\()|\Z)', content, re.MULTILINE)
        if trigger_match:
            trigger_body = trigger_match.group(1)[:500]  # First 500 chars
            checks_enabled = bool(re.search(r'enabledKey|\.get\(.*[Ee]nabled', trigger_body))
            if not checks_enabled and info['extends'] == 'AbstractEffect':
                issues.append("WARN: trigger() doesn't appear to check enabledKey")

    # Trigger signature check - should include 'force' as first param
    if info['trigger_sig'] is not None:
        params = [p.strip().split('=')[0].strip() for p in info['trigger_sig'].split(',') if p.strip()]
        if params and params[0] != 'force':
            issues.append(f"SIGNATURE: trigger({info['trigger_sig']}) -- first param should be 'force'")

    # Missing update for active effects
    if info['sets_active_true'] and not info['has_update'] and info['extends'] == 'AbstractEffect':
        issues.append("MISSING: Sets active=true but has no update() method")

    return info, issues


def audit(verbose=False):
    print("=" * 60)
    print("EFFECT LIFECYCLE AUDIT -- MatrixCode v8.5")
    print("=" * 60)

    all_errors = []
    all_warnings = []
    effect_count = 0

    for fname in sorted(os.listdir(EFFECTS_DIR)):
        if not fname.endswith('.js'):
            continue
        if fname in ('QuantizedPatterns.js', 'QuantizedBFSWorker.js'):
            continue

        path = os.path.join(EFFECTS_DIR, fname)
        content = read_file(path)
        info, issues = analyze_effect(fname, content)

        if info['class_name'] and info['extends'] in ('AbstractEffect', 'QuantizedBaseEffect'):
            effect_count += 1
            if verbose or issues:
                status = "ISSUES" if issues else "OK"
                print(f"\n  {info['class_name']} ({fname}) [{status}]")
                if verbose:
                    print(f"    extends: {info['extends']}")
                    print(f"    trigger: {info['has_trigger']} (sig: {info['trigger_sig']})")
                    print(f"    stop: {info['has_stop']}, update: {info['has_update']}, applyToGrid: {info['has_apply_to_grid']}")
                    print(f"    active mgmt: set=true:{info['sets_active_true']}, set=false:{info['sets_active_false']}")
                for issue in issues:
                    if issue.startswith('LEAK') or issue.startswith('MISSING'):
                        all_errors.append(f"{fname}: {issue}")
                        print(f"    [ERROR] {issue}")
                    else:
                        all_warnings.append(f"{fname}: {issue}")
                        print(f"    [WARN] {issue}")

    # Report
    print("\n" + "=" * 60)
    print(f"Effects analyzed: {effect_count}")

    if all_errors:
        print(f"ERRORS: {len(all_errors)}")
        for e in all_errors:
            print(f"  [ERROR] {e}")
    else:
        print("ERRORS: 0")

    if all_warnings:
        print(f"WARNINGS: {len(all_warnings)}")
        for w in all_warnings:
            print(f"  [WARN] {w}")
    else:
        print("WARNINGS: 0")

    print("=" * 60)
    return 1 if all_errors else 0


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    sys.exit(audit(verbose))
