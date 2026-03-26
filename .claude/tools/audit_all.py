#!/usr/bin/env python3
"""
Master Audit Runner for MatrixCode v8.5

Runs all audit tools and produces a unified report.

Usage:
  python .claude/tools/audit_all.py [--verbose]
  python .claude/tools/audit_all.py --quick     # Only shader + config (fastest)
"""

import subprocess
import sys
import os
import time

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, '..', '..'))

AUDITS = [
    ('Shader Uniform Audit', 'shader_audit.py'),
    ('Config Inheritance Audit', 'config_audit.py'),
    ('Effect Lifecycle Audit', 'effect_audit.py'),
    ('Numeric Stability Scan', 'numeric_guard.py'),
    ('Cross-Module Reference Audit', 'cross_ref.py'),
]

QUICK_AUDITS = [
    ('Shader Uniform Audit', 'shader_audit.py'),
    ('Config Inheritance Audit', 'config_audit.py'),
]


def main():
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    quick = '--quick' in sys.argv

    audits = QUICK_AUDITS if quick else AUDITS
    mode = "QUICK" if quick else "FULL"

    print("=" * 60)
    print(f"MASTER AUDIT -- MatrixCode v8.5 ({mode})")
    print("=" * 60)

    results = []
    total_start = time.time()

    for name, script in audits:
        script_path = os.path.join(BASE, script)
        args = [sys.executable, script_path]
        if verbose:
            args.append('--verbose')

        print(f"\n{'-' * 60}")
        print(f"Running: {name}...")
        print(f"{'-' * 60}")

        start = time.time()
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
        result = subprocess.run(args, capture_output=False, cwd=ROOT, env=env)
        elapsed = time.time() - start

        results.append({
            'name': name,
            'exit_code': result.returncode,
            'elapsed': elapsed,
        })

    # Summary
    total_elapsed = time.time() - total_start
    print(f"\n{'=' * 60}")
    print(f"MASTER AUDIT SUMMARY ({total_elapsed:.1f}s total)")
    print(f"{'=' * 60}")

    has_errors = False
    for r in results:
        status = "PASS" if r['exit_code'] == 0 else "FAIL"
        if r['exit_code'] != 0:
            has_errors = True
        print(f"  [{status}] {r['name']} ({r['elapsed']:.1f}s)")

    if has_errors:
        print("\nResult: ERRORS FOUND -- review output above")
    else:
        print("\nResult: ALL CHECKS PASSED")

    print("=" * 60)
    return 1 if has_errors else 0


if __name__ == '__main__':
    sys.exit(main())
