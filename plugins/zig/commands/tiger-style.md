---
description: Tiger Style compliance review of the current branch diff
---

Use the zig:tiger-style skill to review the current diff against Tiger Style rules.

```bash
git diff main...HEAD
```

Fall back to `git diff HEAD` if that returns nothing. Read relevant source files in full when context is needed to make a finding.

Report violations only — do not make any changes. Scope findings to code introduced or made worse by this diff only; do not flag pre-existing issues in moved or unchanged code.

For each finding:
- File and approximate line
- What rule is violated
- Must-fix or suggestion
