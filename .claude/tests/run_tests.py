#!/usr/bin/env python3
"""
Master test runner for MatrixCode v8.5.
Discovers and runs all test_*.js files via `node --test`.
"""
import os
import sys
import subprocess
import argparse
import time

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))

# ANSI colors
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BOLD = '\033[1m'
RESET = '\033[0m'

def discover_tests(filter_pattern=None):
    """Find all test_*.js files in the tests directory."""
    tests = []
    for f in sorted(os.listdir(TESTS_DIR)):
        if f.startswith('test_') and f.endswith('.js'):
            if filter_pattern and filter_pattern not in f:
                continue
            tests.append(os.path.join(TESTS_DIR, f))
    return tests

def run_test(test_path):
    """Run a single test file. Returns (name, passed, output)."""
    name = os.path.basename(test_path)
    try:
        result = subprocess.run(
            ['node', '--test', test_path],
            capture_output=True, text=True, timeout=60,
            cwd=os.path.dirname(os.path.dirname(TESTS_DIR))
        )
        output = result.stdout + result.stderr
        passed = result.returncode == 0
        return name, passed, output
    except subprocess.TimeoutExpired:
        return name, False, "TIMEOUT: Test took longer than 60 seconds"
    except Exception as e:
        return name, False, f"ERROR: {str(e)}"

def main():
    parser = argparse.ArgumentParser(description='MatrixCode v8.5 Test Runner')
    parser.add_argument('--filter', '-f', help='Filter test files by substring')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show full output')
    args = parser.parse_args()

    tests = discover_tests(args.filter)
    if not tests:
        print(f"{YELLOW}No test files found{' matching filter' if args.filter else ''}.{RESET}")
        sys.exit(1)

    print(f"\n{BOLD}MatrixCode v8.5 Test Suite{RESET}")
    print(f"Running {len(tests)} test file(s)...\n")

    start = time.time()
    results = []
    passed_count = 0
    failed_count = 0

    for test_path in tests:
        name, passed, output = run_test(test_path)
        results.append((name, passed, output))

        if passed:
            passed_count += 1
            print(f"  {GREEN}PASS{RESET}  {name}")
        else:
            failed_count += 1
            print(f"  {RED}FAIL{RESET}  {name}")

        if args.verbose or not passed:
            # Show output for failures (or all if verbose)
            for line in output.strip().split('\n'):
                if line.strip():
                    print(f"        {line}")

    elapsed = time.time() - start
    print(f"\n{'=' * 50}")
    total = passed_count + failed_count
    color = GREEN if failed_count == 0 else RED
    print(f"{color}{BOLD}{passed_count}/{total} passed{RESET} in {elapsed:.1f}s")

    if failed_count > 0:
        print(f"\n{RED}Failed tests:{RESET}")
        for name, passed, _ in results:
            if not passed:
                print(f"  - {name}")

    sys.exit(0 if failed_count == 0 else 1)

if __name__ == '__main__':
    main()
