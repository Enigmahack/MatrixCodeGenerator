Run the quick file summarizer to get a compact API overview of one or more files WITHOUT reading them directly. This saves tokens by showing only the API surface.

Usage — replace `$ARGUMENTS` with the target file path:

```
python .claude/tools/quick_summary.py $ARGUMENTS
```

Examples:
- Single file: `python .claude/tools/quick_summary.py MatrixCode_v8.5/js/effects/CrashEffect.js`
- All files: `python .claude/tools/quick_summary.py --all`

Print the output verbatim. Do NOT read the source files afterward unless you need to edit specific lines.
