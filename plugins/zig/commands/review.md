---
description: Comprehensive parallel Zig code review — Tiger Style, idioms, deslop, simplification, docs, tests, and API design
---

## Step 1: Get the diff

```bash
git diff main...HEAD
```

Fall back to `git diff HEAD` if that returns nothing.

## Step 2: Launch seven parallel review agents

Spawn all seven in a **single message** so they run concurrently. Each agent receives the full diff. All agents are **report-only** — they must not make changes.

**Tiger Style agent:**
> Use the zig:tiger-style skill to review the following diff. Report violations only — do not make any changes. For each finding include the file and approximate line, what rule is violated, and whether it is a must-fix or a suggestion.
>
> [full diff]

**Zig idioms agent:**
> Use the zig:write skill to review the following diff for Zig 0.15 correctness issues and outdated patterns. Report findings only — do not make any changes. For each finding include the file and approximate line, what the issue is, and the correct 0.15 pattern.
>
> [full diff]

**Deslop agent:**
> Use the deslop skill to review the following diff for AI-generated comment slop. Report findings only — do not remove any comments. For each finding include the file and approximate line, the comment text, and why it is slop.
>
> [full diff]

**Simplify agent:**
> Use the simplify skill to review the following diff for simplification opportunities. Report opportunities only — do not make any changes. For each finding include the file and approximate line and a concise description of what could be simplified and why.
>
> [full diff]

**Documentation agent:**
> Review the following diff for documentation accuracy and completeness. Report findings only — do not make any changes.
>
> - **Required docstrings**: Every public function, type, variable, and module must have a docstring. Flag any that are missing.
> - **Docstring accuracy**: Do existing docstrings still accurately describe the function/type after the change?
> - **Inline comments**: Do they still reflect the current logic, or are they stale/misleading?
> - **README and markdown**: Does any prose or example need updating to match new behavior?
>
> Do not flag docs for style — only flag where docs are wrong, stale, or absent.
>
> [full diff]

**Test coverage agent:**
> Review the following diff for missing or inadequate test coverage. Report findings only — do not make any changes.
>
> Focus on: untested public functions, uncovered behavior changes, untested error paths, and deleted tests that should have been updated. Only flag gaps that represent a real risk of undetected regression.
>
> [full diff]

**API design agent:**
> Review the following diff for public API and interface design quality. Report findings only — do not make any changes.
>
> Focus on clarity, ergonomics, minimalism (is anything `pub` that shouldn't be?), consistency with Zig stdlib conventions, error contracts, ownership semantics, and composability with Zig idioms.
>
> [full diff]

## Step 3: Aggregate results

Once all agents return, **filter before reporting**. Drop any finding that:

- Has no concrete, unambiguous fix
- Is already enforced by the compiler or type system
- Would generate disagreement between two reasonable engineers
- Requires context the reviewer doesn't have

Then produce the report:

```
## Tiger Style
[must-fix findings, then suggestions — or "No issues found."]

## Zig Idioms
[findings — or "No issues found."]

## Deslop
[findings — or "No issues found."]

## Simplify
[findings — or "No issues found."]

## Documentation
[findings — or "No issues found."]

## Test Coverage
[findings — or "No issues found."]

## API Design
[findings — or "No issues found."]

---
**Summary:** X must-fix, Y suggestions across Z categories.
```
