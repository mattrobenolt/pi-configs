# Pull Request Titles and Bodies

## Purpose

Treat the PR title and body as the durable explanation of the change. A future
reader should be able to understand what changed, why it changed, how it was
validated, and any material risk without reconstructing intent from the diff or
an expired chat link.

Write for reviewers now and code archaeologists later. Keep the body concise;
it is context, not a narrated diff, CI transcript, or proof that the author was
busy. Do not restate information GitHub already displays clearly.

Write the title and body in the style defined by
[writing-style.md](writing-style.md).

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
3. **What was validated beyond routine CI?** Apply the cases in
   [Write the Validation section](#write-the-validation-section).
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

[If nothing beyond CI ran: "No validation beyond the repository's required CI."]
[Otherwise: each check, what it established, and its exact command.]

## Risk and rollout

[Only when relevant: compatibility, migration, flag, rollout, rollback, or
known limitation.]
```

<!-- Keep this shape. Models copy sample output, even banned samples, so this file shows none.
The exact case 1 sentence leaves no slot for filler.
One rule at the point of use beats repeated prose bans against the learned prior. -->
## Write the Validation section

Routine CI status — test counts, lint, type checks, build, and coverage — never
appears in the PR body. The rule covers `<details>` blocks. GitHub displays that
status next to the PR. A count restated in the body goes stale on the next push.

Validation beyond CI means a new regression test, a manual check, or a
benchmark. Apply case 1 or case 2. When a gap exists, add case 3.

1. **Nothing beyond CI.** Write exactly this sentence:

   ```markdown
   No validation beyond the repository's required CI.
   ```

   If case 3 does not apply, stop there.

2. **Validation beyond CI exists.** Describe only those checks:

   - the failure that the new regression test reproduces
   - the behavior that the manual check exercised
   - the result that the benchmark measured

   State what each check established. Give each command exactly as you ran it.
   For a bug fix, name the failure scenario and the evidence that now covers
   it. For a benchmark, give the baseline, the method, and the environment. For
   a user-visible change, add before and after screenshots, a recording, or
   reproduction steps. For example:

   ```markdown
   The regression test reproduces an acknowledged timeout and asserts that a
   retry commits only one write.
   ```

3. **A consequential behavior has no coverage.** For each gap, add a line that
   starts with `Not covered:`. Name the behavior. State why the gap is
   acceptable, or link the follow-up issue.

If the repository template mandates a section or checklist for tests, follow it
exactly. Tick each true box. Add no commentary. If the section takes free text,
apply the cases above.

## Correct common LLM failure modes

LLMs tend to optimize for a body that *looks complete*: many headings, a bullet
for every file, and a triumphant testing section. Optimize instead for
information the reviewer cannot get more reliably from the diff, GitHub UI, or
CI.

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
- `The schema migration was reviewed separately in owner/repo#123.`

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
- Does validation report only checks beyond CI, or the exact case 1 sentence?
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
