Run the master audit suite to check for common bugs before they happen. Execute this command:

```
python .claude/tools/audit_all.py --verbose
```

After reviewing the output, summarize the findings and suggest fixes for any ERRORS found. For WARNINGS, note them but don't auto-fix unless asked.

The audit suite includes:
1. **Shader Uniform Audit** — GLSL ↔ JS uniform mismatches
2. **Config Inheritance Audit** — Missing inheritableSuffixes, orphaned keys
3. **Effect Lifecycle Audit** — trigger/stop/cleanup issues
4. **Numeric Stability Scan** — NaN/Infinity risk detection
5. **Cross-Module Reference Audit** — Worker scope issues, circular deps
