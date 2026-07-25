# Pull Request Titles and Bodies

## Purpose

Treat the PR title and body as the durable explanation of the change. A future
reader should be able to understand what changed, why it changed, how it was
validated, and any material risk without reconstructing intent from the diff or
an expired chat link.

Write for reviewers now and code archaeologists later. Keep the body concise;
it is context, not a narrated diff, CI transcript, or proof that the author was
busy. Do not restate information GitHub already displays clearly.

## Read before writing

Read the repository's PR template and contribution guidance first. Preserve
required headings, checklists, issue syntax, and domain-specific sections. Do
not replace a project template with a preferred generic format.

Read the actual diff, commits, linked issue or design document, and validation
results. Verify factual claims against primary sources. Do not infer motivation
from filenames or turn commit messages into a confident story.

If the change's purpose or intended behavior is unclear, resolve that before
creating a ready-for-review PR. Use a draft PR when the implementation or
review contract is intentionally incomplete.

## Write the title

Summarize the concrete outcome of the PR in a short, specific phrase. Prefer an
imperative title that reads naturally after "This change will..." unless the
repository requires another convention.

Name the behavior or subsystem being changed. Avoid vague titles such as "Fix
bug," "Cleanup," "Updates," "Phase 1," or an issue number without a summary.
Do not add `[WIP]` when GitHub's draft state expresses that status.

Examples:

- `Preserve idempotency keys across retry attempts`
- `Route Horizon proxy alerts to the owning team`
- `Remove the deprecated branch status endpoint`

## Write the body

Answer these questions, using the repository template where one exists:

1. **Why is this change needed?** State the problem, user impact, incident,
   requirement, or maintenance constraint. Include enough context that links
   supplement the explanation rather than carrying it entirely.
2. **What changed?** Summarize the chosen approach and the important behavioral
   difference. Do not list every modified file or restate the diff.
3. **How was it validated?** Describe evidence that helps a reviewer understand
   coverage: the regression scenario, meaningful manual behavior, benchmark
   method, or an important gap. Do not transcribe routine CI status.
4. **What should reviewers pay attention to?** Call out a load-bearing design
   decision, intentional tradeoff, migration boundary, or requested review
   focus only when one genuinely exists.
5. **What are the operational consequences?** When relevant, describe rollout,
   compatibility, migrations, feature flags, observability, rollback, security,
   performance, or deployment ordering.

Omit headings that add no information when the repository template permits it.
A tiny PR may need only a paragraph plus validation. A risky PR should say more,
but length must be earned by reviewer-relevant context.

A useful default shape is:

```markdown
## Why

[Problem and relevant context.]

## What changed

[Behavioral summary and important implementation decision.]

## Validation

- [Behavior covered by a regression test.]
- [Manual scenario or measurement not represented by routine CI.]

## Risk and rollout

[Only when relevant: compatibility, migration, flag, rollout, rollback, or
known limitation.]
```

## Correct common LLM failure modes

LLMs tend to optimize for a body that *looks complete*: many headings, a bullet
for every file, and a triumphant testing section. Optimize instead for
information the reviewer cannot get more reliably from the diff, GitHub UI, or
CI.

### Do not transcribe CI

CI is the source of truth for pass/fail status. Do not write:

```markdown
## Testing

- ✅ 100/100 tests passed
- ✅ Lint passed
- ✅ Type checking passed
- ✅ Build succeeded
```

Test counts, green-check inventories, coverage slogans, and routine build or
lint results become stale and make the body longer without helping review. Do
not move this noise into a `<details>` block; omit it.

Describe the validation *shape* only when it adds information. For example:

```markdown
## Validation

The regression test reproduces an acknowledged timeout and asserts that retrying
commits only one write.
```

Mention a command only when it is not represented by ordinary CI, gives the
reviewer a useful focused reproduction path, or records a meaningful benchmark
method. If the repository template requires a testing section and there was no
additional manual validation, say that once without enumerating checks:

```markdown
## Validation

No validation beyond the repository's required CI.
```

### Summarize the result, not the work log

Generate the body from the final diff and current decisions, not the original
plan, intermediate attempts, assistant transcript, or first commit message.
Agents commonly describe what they intended to build rather than what landed.

Synthesize the PR-level behavioral change. Do not emit:

- a file-by-file walkthrough
- one bullet per commit
- line counts or numbers of files changed
- a list of functions added, renamed, or moved when the diff already shows it
- a chronological account of debugging and implementation

Include an implementation detail only when it explains a non-obvious decision,
constraint, tradeoff, or risk.

### Remove plausible but unsupported claims

Check every claim against the final diff, linked requirement, or actual
validation. Delete claims about tests, behavior, compatibility, performance,
security, motivation, or design decisions that cannot be grounded.

Do not infer the *why* from code structure. The diff can show what changed; the
issue, incident, decision record, and task context explain why. If that context
is unavailable, do not invent a rationale that merely sounds likely.

Watch specifically for:

- changes claimed in the body but absent from the diff
- significant changes omitted because they were not in the original plan
- tests or documentation claimed but not changed
- "backward compatible," "production-ready," or "no breaking changes" without
  an actual compatibility analysis
- "comprehensive coverage," "robust," "seamless," "enhanced," or similar
  marketing language that substitutes confidence for information
- "low risk" justified only by green tests

### Do not fill empty sections with boilerplate

Use structure to improve scanning, not to simulate rigor. Omit optional sections
that have nothing useful to say. Do not repeat the title under `Summary`, repeat
the issue under `Why`, or add `N/A` paragraphs unless the repository template
requires them.

A tiny PR does not need `Summary`, `Changes`, `Implementation`, `Testing`,
`Risks`, and `Notes` headings. One precise paragraph is better than a fully
populated form containing no new information.

### Run a final compression pass

Ask of every sentence: can the reviewer learn this more reliably from the diff,
CI, or GitHub metadata? If yes, remove it unless it explains why that fact
matters. Then check that the remaining body still contains the motivation,
behavioral change, material risk, and non-obvious validation.

## Keep signal visible

Put the problem, approach, and material risk in the visible body. Do not hide
information required to decide whether the PR is safe to merge.

Use a collapsed `<details>` block for supporting material that is useful to
audit but noisy to read by default: long command output, exhaustive benchmark
tables, generated-file inventories, or mechanical implementation notes.

```markdown
<details>
<summary>Detailed benchmark results</summary>

[Supporting output.]

</details>
```

Do not add a ceremonial checklist of every file touched or everything that
looks correct. Reviewers can read the diff; tell them what the diff cannot.

## Describe validation honestly

Treat validation as reviewer context, not a status dashboard. Explain what
behavior the tests or manual checks establish and disclose consequential gaps.
Let CI report whether routine suites, lint, type checks, and builds passed.

If a non-routine command is worth including, report it exactly as run. Do not
say "all tests pass" when only a focused package was tested. Include benchmark
numbers only with the baseline, measurement method, and relevant environment.

For user-visible changes, include before/after screenshots, recordings, or
reproduction steps when they communicate behavior better than prose. For bug
fixes, explain the failing scenario and the evidence that now covers it.

## Link work precisely

When merging this PR should close an issue, put a GitHub closing keyword in the
PR body. Prefer `Fixes #123` for a same-repository issue and
`Fixes owner/repo#123` for a cross-repository issue. The `#` is required:
`Fixes 123` does not use the required issue-reference syntax. `Fix #123` is a
valid alternative, but prefer the conventional `Fixes #123`; a bare issue
reference only links the issue.

GitHub also recognizes `Close`, `Closes`, `Closed`, `Fix`, `Fixes`, `Fixed`,
`Resolve`, `Resolves`, and `Resolved`, in any case and optionally followed by a
colon. Use one clear keyword per issue when closing several, for example:

```markdown
Fixes #123
Fixes owner/repo#456
```

Closing keywords work only when the PR targets the repository's default branch;
otherwise use an informational reference or link the issue manually. Do not put
the closing keyword only in a commit message: it can close the issue after
merge, but GitHub will not show the PR as its linked pull request.

Use `Related to owner/repo#123` or plain prose when the relationship is
informational. Use `owner/repo#number` for cross-repository issues and PRs.
Avoid bare issue numbers when they could resolve to the wrong repository.

Link design documents, incidents, and prior decisions, but preserve the
load-bearing context in the body in case an external or private link becomes
unavailable.

## Expose tradeoffs and boundaries

State intentional limitations, rejected alternatives, compatibility breaks,
and follow-up work when they affect review. Do not manufacture an alternatives
section for an obvious change.

Keep unrelated cleanup out of the PR. If the diff exposes a pre-existing
problem, link a follow-up rather than implying this PR solves it. Be explicit
about stacked PR dependencies and merge or deployment order.

## Request useful review

Call out review focus when specialized attention would materially improve the
review, for example:

- `Review focus: retry ordering and duplicate-write behavior.`
- `The schema migration has been reviewed separately in owner/repo#123.`

Do not ask for generic "thoughts" or narrate every implementation choice.
Inline author comments are better for a specific non-obvious line; the PR body
is better for cross-cutting context.

## Keep the body current

Update the title and body when review materially changes the scope, behavior,
validation, rollout, or tradeoffs. The merged PR should describe the code that
actually landed, not the first draft.

Before creating or updating the PR, check:

- Does the title say what outcome the change produces?
- Does the body explain why the change exists?
- Does it summarize behavior rather than enumerate files?
- Does validation explain coverage instead of repeating CI status or test counts?
- Are all factual claims exact and verified against the final diff?
- Are material risks, limitations, and rollout constraints visible?
- Are links supplemental rather than load-bearing?
- Are issue-closing keywords intentional?
- Does the body follow the repository template?
- Is noisy supporting evidence collapsed or omitted?

## Sources

This guidance synthesizes:

- [Google Engineering Practices: Writing good CL descriptions](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
- [GitHub: Creating a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request)
- [GitHub: How to write the perfect pull request](https://github.blog/developer-skills/github/how-to-write-the-perfect-pull-request/)
- [Analyzing Message-Code Inconsistency in AI Coding Agent-Authored Pull Requests](https://arxiv.org/html/2601.04886)
- [How AI Coding Agents Communicate](https://arxiv.org/html/2602.17084)
- [Code Change Characteristics and Description Alignment](https://arxiv.org/html/2601.17627)
- [Generative AI for Pull Request Descriptions](https://arxiv.org/html/2402.08967)
