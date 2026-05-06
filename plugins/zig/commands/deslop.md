---
description: Remove AI-generated comment slop from the current branch diff
---

Use the deslop skill to find and remove AI-generated comment slop introduced in the current diff.

```bash
git diff main...HEAD
```

Fall back to `git diff HEAD` if that returns nothing. Read the full source files for any changed sections to understand the existing comment style and density before removing anything.

Only remove comments from the diff's added lines (`+` prefix). Do not touch pre-existing comments in unchanged code.

After identifying slop, remove it directly using the Edit tool. Show a summary of what was removed when done.
