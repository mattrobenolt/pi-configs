---
name: github
description: "Use structured GitHub tools for pull requests, local code review, review/comment CRUD, thread resolution, issues, and CI. Trigger for GitHub PR/issue inspection or mutation, reviewing a PR, posting or editing comments/reviews, resolving review threads, watching or waiting for CI, following PR feedback, and managing stacked PRs (create_stack for chained PRs; gh stack for local rebase, sync, and merge). Clone or fetch repositories and review locally; never review from an API diff."
---

# GitHub Workflow

Use `github_pr`, `github_review`, `github_issue`, and `github_ci` for covered GitHub operations. Do not reconstruct equivalent `gh` or `gh api` commands through `bash`.

The tools handle GitHub metadata and communication. The local repository provides the code. Never review a pull request from an API-provided diff or remote file listing.

## Writing style

All text posted to GitHub — PR titles and bodies, review summaries, inline comments, replies, and issue comments — follows [references/writing-style.md](references/writing-style.md): simplified technical English (ASD-STE100) adapted for review discussion. Read it before drafting anything that lands on GitHub.

The reference files are long (170–420 lines). Read each one to the end before drafting. The sections that correct agent failure modes sit in the second half, so a partial read produces exactly the bodies those sections prohibit. The rules with the most leverage: sentences stay under 20 words for instructions and 25 for explanations; the only modals are can, will, and must; no contractions, present perfect, "-ing" verb forms, or semicolons; identifiers and quoted errors stay untouched in backticks.

## Supported user stories

- **Inspect and review a PR:** gather metadata, discussion, exact refs/SHAs, and CI with `github_pr inspect`; clone or fetch the repository; inspect and test the change locally.
- **Submit a coherent review:** use `github_review submit` for the verdict, full review body, and optional batched inline comments, pinned to the locally reviewed head SHA.
- **Discuss code inline:** create a focused line/range/file comment, reply in its thread, and update or delete your own review comments without constructing API payloads.
- **Resolve a conversation:** after addressing inline feedback, resolve (or reopen) the review thread with `github_review resolve_thread`/`unresolve_thread`, identified by any inline comment in the thread or by the thread node ID from `list_threads`; use `list_threads` to see which threads are still open.
- **Manage the PR conversation:** create, update, or delete top-level PR comments with `github_pr`; prefer editing corrections over posting follow-up noise.
- **Open or update a PR:** inspect the actual change, follow the repository template and [PR body guidance](references/pr-body.md), then use `github_pr create` or `update` so titles and Markdown bodies are transported exactly.
  - In the validation section, report only checks beyond routine CI. If none ran, write exactly `No validation beyond the repository's required CI.`
- **Open a stacked PR:** push the branches, then use `github_pr action=create_stack` with `pull_requests` ordered bottom to top. Read [references/stacked-prs.md](references/stacked-prs.md) for layer planning and merge behavior; `gh pr merge` cannot merge a stack.
- **Triage issues:** inspect/list, create/update, close/reopen, and manage issue comments with `github_issue`.
- **Follow a PR:** creating a PR, commenting on one, or reviewing one starts a background watch. A notice arrives for new comments, reviews, inline replies, CI results, and merge or close. All feedback is surfaced, including bot reviews. Verify each claim against the code before acting. Do not poll for feedback.
- **Audit writes:** read the full body echoed in every create/update tool result. If it is wrong, edit that same object rather than posting a correction.

These stories define the intended surface. Releases, merges, reactions, workflow mutation, and arbitrary REST/GraphQL pass-through calls are not implied. Thread resolution is covered via `github_review` (see [Thread resolution](#thread-resolution)).

## Reviewing a pull request

1. Call `github_pr` with `action: "inspect"` to get the PR's repository, base/head refs and SHAs, existing reviews, inline comments, conversation comments, and CI state.
2. If already inside a matching local checkout (verify the remote matches the requested `owner/repo`), review in place: `gh pr checkout <number>` fetches and checks out the PR's head branch, including from forks. This is a legitimate `gh` use — checkout is git work, not a covered tool operation. It requires a clean working tree.
3. If the working tree is dirty, stop and use `ask_user` to ask how to proceed — offer stashing or committing the changes and checking out in place versus an isolated detached worktree. Never disturb uncommitted changes without explicit approval.
4. If no checkout exists, clone the repository into temporary review space, then fetch the PR head. GitHub exposes PR heads from the base repository as `pull/<number>/head`.
5. Verify `git rev-parse HEAD` equals the `head.sha` returned by `github_pr inspect`.
6. Inspect the change locally with `git diff <base_sha>...<head_sha>`. Read surrounding code, callers, tests, configuration, and history as needed; do not stop at changed hunks.
7. Run focused tests or checks appropriate to the repository.
8. Before drafting feedback, read [references/review-feedback.md](references/review-feedback.md). Follow its severity, inline-placement, concise-summary, and collapsible-provenance guidance.
9. Read existing review threads before reporting findings so you do not duplicate feedback.
10. Submit through `github_review` with `expected_head_sha` set to the exact SHA reviewed locally. Batch precise line/range comments into the review, and use a standalone whole-file comment only when no honest line target exists. Do not put code-specific findings only in the summary. If the tool reports that the head changed, fetch and review the new head before posting.

Typical checkout shapes:

```bash
# Already inside the repo with a clean tree — preferred:
gh pr checkout <pr-number>

# Dirty tree and the user chose an isolated worktree — leave the active tree alone:
git fetch origin <base-ref>
git fetch origin pull/<pr-number>/head
git worktree add --detach <temporary-path> <head-sha>

# In the review checkout:
git rev-parse HEAD
git diff <base-sha>...<head-sha>
```

If the repository history is too shallow to compute the merge base, deepen or unshallow the fetch rather than falling back to an API diff.

## Review and comment semantics

Use `github_review` for review verdicts and inline code discussion:

- `submit` approves, requests changes, or leaves a neutral review, optionally with batched inline line comments.
- `comment` creates one standalone inline line, range, or whole-file comment.
- `reply` responds in an existing inline review thread.
- `update_review` edits the submitted review summary body.
- `update_comment` and `delete_comment` manage inline review comments and replies.
- `list_threads` lists every review thread with its GraphQL node ID (`PRRT_…`), resolved/outdated state, path, and comments.
- `resolve_thread` and `unresolve_thread` mark a thread addressed or reopen it, identified by any inline comment in the thread (`comment`) or by thread node ID (`thread`); they do not pin a head SHA.

Put findings on the most specific honest GitHub surface. Attach code-specific feedback to the relevant diff line or range; use a whole-file comment only for a genuinely file-wide concern. Keep the overall review body focused on the verdict, cross-cutting findings, scope, validation, and uncertainty. Put the exhaustive record of clean checks in a collapsed `<details><summary>Provenance: what was reviewed</summary>…</details>` block rather than flooding the visible review with praise or checklist narration. See [references/review-feedback.md](references/review-feedback.md) for the required format and examples.

Use `github_pr` for top-level PR conversation comments. Use `github_issue` for issue comments. A PR conversation comment is not an inline review comment, and it is not a substitute for correctly placed review feedback.

Prefer editing an existing comment for corrections, formatting fixes, clarification, or status refreshes. Use a reply when the discussion genuinely advances, especially after someone has responded. Delete only accidental, duplicate, sensitive, or irreparably misplaced comments.

Create and read operations return comment/review IDs and URLs. Retain those handles and pass either the ID or GitHub URL to update/delete operations instead of searching with `gh api`.

Every create/update result visibly echoes the complete submitted body. Check that output when correctness matters. If the content is wrong, update the same PR, issue, review, or comment; do not post a corrective follow-up.

## Thread resolution

GitHub exposes review-thread resolution only through its GraphQL API; the REST API cannot resolve a thread or report its resolved state. `github_review` wraps that for you — do not drop into `gh api graphql`.

- `list_threads` returns every review thread on the PR with its GraphQL node ID (`PRRT_…`), `isResolved`, `isOutdated`, path, line range, and the inline comments it contains. Use it to see which threads are still open before resolving.
- `resolve_thread` marks a thread addressed. Pass any inline review comment in the thread (`comment`: numeric ID or `#discussion_r…` URL) and the containing thread is resolved, or pass the thread node ID (`thread`) directly from a `list_threads` result. It does **not** require `expected_head_sha` — resolving is a conversation action, not code feedback pinned to a reviewed head. `pr_number` is also optional: omit it when passing a `thread` node ID, or omit it when resolving by `comment` (the PR is looked up automatically from the comment).
- `unresolve_thread` reopens a thread with the same identification options (`comment` or `thread`; `pr_number` optional).

Resolving an already-resolved thread is a no-op; you do not need to pre-check. Resolve a thread only after the feedback it raised has actually been addressed (code changed, question answered, or explicitly decided). Do not resolve threads to silence unresolved disagreement — leave those open or move them to a top-level PR conversation.

## Creating or updating a pull request

1. Read the local diff, commits, linked issue or decision record, and validation results. Do not generate the PR story from filenames or commit subjects alone.
2. Find and follow the repository's PR template and contribution guidance. Preserve required sections and checklists.
3. Read [references/pr-body.md](references/pr-body.md) and [references/writing-style.md](references/writing-style.md) completely before drafting the title or body. Explain why, summarize the behavioral change, and surface material risk without narrating the diff. Run the LLM-specific compression and claim-verification pass from pr-body.md.
4. Use GitHub's draft state for intentionally incomplete work instead of putting `[WIP]` in the title.
5. Create or update through `github_pr`, passing the complete Markdown body. Use `owner/repo#number` references and issue-closing keywords deliberately.
6. Read the full title and body echoed by the tool. If either is wrong or stale, update that same PR rather than adding a corrective conversation comment.

Keep the body current when review changes the scope, behavior, validation, rollout, or tradeoffs. The merged PR should describe the code that landed.

## PR and issue lifecycle

Use `github_pr` to view/list, create, update, or stack pull requests. Use its comment actions only for the top-level PR conversation; route inline code discussion through `github_review`.

Use `github_issue` to view/list, create/update, close/reopen, and manage issue comments. Even though GitHub implements PR conversation comments through its issue-comment API, keep the user-facing distinction: PR work goes through `github_pr`, issue work through `github_issue`.

Pass `repo: "owner/repo"` explicitly for writes. Preserve the IDs and URLs returned by mutations so later edits and deletes do not require rediscovery.

## PR watches

Creating a PR, commenting on one, or reviewing one starts a background watch. The watch covers CI for the current head, new conversation comments, reviews, inline replies, head moves, and merge or close. It posts one notice per poll.

Rules:

- Do not poll for feedback or CI. Wait for the notice.
- On a notice, read the full thread with `github_pr inspect`, then reply through `github_pr comment` or `github_review reply`.
- The watch surfaces every author, including bots. Treat each comment, human or bot, as a claim to verify against the code. Do not apply a suggestion you have not checked.
- The watch backs off as the PR goes quiet. It stops on merge, close, or after 7 days without activity.
- A resumed session catches up on feedback that arrived while Pi was off. The watch cannot poll while Pi is not running.
- `github_pr action: "watches"` lists active watches; `action: "unwatch"` with `pr_number` stops one; `action: "watch"` with `pr_number` starts one for a PR that was not watched automatically.
- The user can also list or stop watches with `/pr-watch` and `/pr-watch stop <id>`.

## CI

PR watches cover CI for pull requests automatically. Use `github_ci` for a one-shot snapshot, workflow runs, and failed logs.

Use `github_ci` with `action: "watch"` and `ref` only for a commit or branch without a PR, or when the user asks for a CI watch. The call returns immediately and does not block the conversation. A completion notice arrives when checks settle. An idle agent wakes on the notice. A busy agent receives it after the current turn.

Pass `pr_number` or `ref`, not both. For commits outside a PR (a branch just pushed to, a tag, an arbitrary SHA), pass `ref`. Pass `expected_head_sha` when CI must correspond to code inspected locally. The watch reports `head_changed` if the head moves.

Watch operations:

- `action: "watch"` starts a watch and returns a job id such as `ci-1`.
- `action: "watches"` lists running watches with progress.
- `action: "watches"` with `watch_id` shows one watch.
- `action: "unwatch"` with `watch_id` stops one watch.

Use `action: "status"` only for a one-shot snapshot. No operation blocks. Start a watch when you need to wait.

The result is one of:

- `passed`
- `failed`
- `timed_out`
- `head_changed`
- `no_checks`
- `cancelled`

If CI fails, use the returned run IDs with `github_ci` `action: "failed_logs"`. Do not automatically rerun workflows. If the head changes, fetch and inspect the new code before proceeding.

## Stacked PRs

A stack is a server-side GitHub object: each branch maps to one PR whose base is the branch below it, rooted on trunk. Merge from any layer lands that PR plus everything below it, bottom-up; GitHub auto-rebases the remainder after partial merges. Stack only one cohesive story (foundational layers low, dependents high); ordering constraints that are not code dependencies stay the operator's job. The feature is enabled per repository; without it, everything degrades to an ordinary manual stack.

Use `github_pr` for stack membership and creation:

- `create_stack` with `pull_requests` ordered bottom to top creates the PR chain and the stack in one call. Each entry is `{head, title}` for a branch or `{pr_number}` for an existing PR. It reuses an open PR for a branch, so rerunning after a partial failure is safe. `base` sets the bottom of a new stack; `stack_number` appends to an existing stack.
- `view_stack` takes `stack_number` or `pr_number`. `view` and `inspect` also report a PR's stack and position.
- `unstack` removes the unmerged PRs that can leave a stack; locked or queued PRs stay. The stack dissolves when none remain. PRs, branches, and code are untouched.

Push the branches before `create_stack`. Do not create the PRs one at a time and then shell out to `gh stack link`.

Use the `gh stack` CLI for local stack tracking, rebase, sync, checkout, and merge. Hard agent rules: `gh stack` branches on whether stdout is a TTY, so never run commands bare — `view --json`, `submit --auto`, `merge <target> --yes`, positional branch names always; `switch` and `modify` are TUI-only with no non-interactive path. Adopt existing branch chains with `gh stack init <bottom>...<top>` when you need local tracking; for remote membership alone, `create_stack` with `pr_number` entries is enough. Merge with `gh stack merge <pr|stack> --yes` — `gh pr merge` cannot merge a stack.

Read [references/stacked-prs.md](references/stacked-prs.md) before building or managing a stack — layer planning, mid-stack changes, merging, sync traps, exit codes, restructuring, and the manual fallback.

## Cross-repository references

GitHub auto-links issues and PRs across repositories using `owner/repo#number`, for example `planetscale/psevents#51`. Use this form instead of a bare `#51` or a full URL when referencing work in another repository.

## Escape hatch

The structured tools intentionally do not cover arbitrary REST/GraphQL calls, releases, workflow dispatch, reactions, or every repository setting. Use `gh` only when the requested operation is genuinely outside the tool surface, not as a fallback for a covered operation that returned a useful error.
