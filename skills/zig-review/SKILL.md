---
name: zig-review
description: >
  Comprehensive Zig code review across all quality dimensions. Triggers on /zig-review.
  Runs 7 parallel specialized agents (each on a different model), then a cross-family
  second-opinion agent on the aggregated result. Always operates on the full branch diff
  against main. Report-only: never makes changes.
---

# Zig Review

## Step 1: Get the diff (for context)

```bash
git diff main...HEAD
```

Fall back to `git diff HEAD` if that returns nothing.

## Step 2: Launch seven parallel review agents

Spawn all seven in a **single message** so they run concurrently. Each agent fetches the diff itself — do not pass the diff in the prompt. All agents are **report-only**.

Use these subagent types with the following prompts:

**`zig-review-tiger-style`:**
> Review the current branch for Tiger Style violations introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag issues that are new or made worse by this PR — not pre-existing problems in moved code. Report only — no changes.

**`zig-review-idioms`:**
> Review the current branch for Zig 0.15 idiom and correctness issues introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag issues that are new or made worse by this PR. Report only — no changes.

**`zig-review-api`:**
> Review the current branch for public API design issues introduced by this PR. Diff against main (`git diff main...HEAD`). Pay special attention to new `pub` declarations that didn't exist on main. Only flag issues introduced or worsened by this PR. Report only — no changes.

**`zig-review-simplify`:**
> Review the current branch for simplification opportunities in code introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag complexity that is new to this PR, not pre-existing. Report only — no changes.

**`zig-review-docs`:**
> Review the current branch for documentation issues introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag missing/stale docs on newly written or changed functions. Report only — no changes.

**`zig-review-tests`:**
> Review the current branch for test coverage gaps in code introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag gaps for new logic or changed behavior — not pre-existing untested code that was merely moved. Report only — no changes.

**`zig-review-deslop`:**
> Review the current branch for AI-generated comment slop introduced by this PR. Diff against main (`git diff main...HEAD`). Only flag slop in added lines (`+` prefix in the diff). Report only — no changes.

## Step 3: Aggregate results

Once all seven agents return, **filter before aggregating**. Drop any finding that:

- Has no concrete, unambiguous fix ("consider whether...", "you could also...")
- Is already enforced by the compiler or type system
- Is a naming quibble where the existing name is already clear
- Would generate disagreement between two reasonable engineers
- Requires context the reviewer doesn't have
- Would itself generate new findings if acted on (too vague to be actionable)

Produce an intermediate aggregated report in this format:

```
## Tiger Style
[must-fix findings, then suggestions — or "No issues found."]

## Zig Idioms
[findings — or "No issues found."]

## API Design
[findings — or "No issues found."]

## Simplify
[findings — or "No issues found."]

## Documentation
[findings — or "No issues found."]

## Test Coverage
[findings — or "No issues found."]

## Deslop
[findings — or "No issues found."]
```

## Step 4: Second opinion

Pass the aggregated report to the **`zig-review-second-opinion`** agent with this prompt:

> Here is an aggregated code review of the current branch, produced by a set of Claude models. Review it independently: challenge weak findings, confirm strong ones, and add anything missed. Fetch the diff yourself for reference.
>
> [aggregated report]

## Step 5: Final output

Combine the aggregated primary report with the second opinion into the final output:

```
## Tiger Style
[findings]

## Zig Idioms
[findings]

## API Design
[findings]

## Simplify
[findings]

## Documentation
[findings]

## Test Coverage
[findings]

## Deslop
[findings]

---

## Second Opinion (GPT-5.4)

### Challenged Findings
[...]

### Confirmed Findings
[...]

### Additional Findings
[...]

### Systemic Observations
[...]

---
**Summary:** X must-fix, Y suggestions across Z categories. Second opinion challenged A findings and added B new ones.
```

Keep findings concise — one line per issue where possible, with file and line context.
