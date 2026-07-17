---
name: github
description: "Use structured GitHub tools for pull requests, local code review, review/comment CRUD, issues, and CI. Trigger for GitHub PR/issue inspection or mutation, reviewing a PR, posting or editing comments/reviews, and checking or waiting for CI. Clone or fetch repositories and review locally; never review from an API diff."
---

# GitHub Workflow

Use `github_pr`, `github_review`, `github_issue`, and `github_ci` for covered GitHub operations. Do not reconstruct equivalent `gh` or `gh api` commands through `bash`.

The tools handle GitHub metadata and communication. The local repository provides the code. Never review a pull request from an API-provided diff or remote file listing.

## Supported user stories

- **Inspect and review a PR:** gather metadata, discussion, exact refs/SHAs, and CI with `github_pr inspect`; clone or fetch the repository; inspect and test the change locally.
- **Submit a coherent review:** use `github_review submit` for the verdict, full review body, and optional batched inline comments, pinned to the locally reviewed head SHA.
- **Discuss code inline:** create a focused line/range/file comment, reply in its thread, and update or delete your own review comments without constructing API payloads.
- **Manage the PR conversation:** create, update, or delete top-level PR comments with `github_pr`; prefer editing corrections over posting follow-up noise.
- **Open or update a PR:** inspect the actual change, follow the repository template and [PR body guidance](references/pr-body.md), then use `github_pr create` or `update` so titles and Markdown bodies are transported exactly.
- **Triage issues:** inspect/list, create/update, close/reopen, and manage issue comments with `github_issue`.
- **Wait for CI:** use `github_ci status` with `wait: true`, pinned to the expected head SHA; inspect failed runs and logs without shell polling loops.
- **Audit writes:** read the full body echoed in every create/update tool result. If it is wrong, edit that same object rather than posting a correction.

These stories define the intended surface. Releases, merges, reactions, workflow mutation, thread resolution, and arbitrary REST/GraphQL calls are not implied.

## Reviewing a pull request

1. Call `github_pr` with `action: "inspect"` to get the PR's repository, base/head refs and SHAs, existing reviews, inline comments, conversation comments, and CI state.
2. Reuse a matching local checkout when one already exists. Verify its remote matches the requested `owner/repo`.
3. Never disturb a dirty working tree. Fetch the PR and create a detached worktree for the exact head SHA.
4. If no checkout exists, clone the repository into temporary review space, then fetch the PR head. GitHub exposes PR heads from the base repository as `pull/<number>/head`.
5. Verify `git rev-parse HEAD` equals the `head.sha` returned by `github_pr inspect`.
6. Inspect the change locally with `git diff <base_sha>...<head_sha>`. Read surrounding code, callers, tests, configuration, and history as needed; do not stop at changed hunks.
7. Run focused tests or checks appropriate to the repository.
8. Before drafting feedback, read [references/review-feedback.md](references/review-feedback.md). Follow its severity, inline-placement, concise-summary, and collapsible-provenance guidance.
9. Read existing review threads before reporting findings so you do not duplicate feedback.
10. Submit through `github_review` with `expected_head_sha` set to the exact SHA reviewed locally. Batch precise line/range comments into the review, and use a standalone whole-file comment only when no honest line target exists. Do not put code-specific findings only in the summary. If the tool reports that the head changed, fetch and review the new head before posting.

Typical isolated-checkout shape:

```bash
# Existing clean clone, without touching its active worktree:
git fetch origin <base-ref>
git fetch origin pull/<pr-number>/head
git worktree add --detach <temporary-path> <head-sha>

# In the review worktree:
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

Put findings on the most specific honest GitHub surface. Attach code-specific feedback to the relevant diff line or range; use a whole-file comment only for a genuinely file-wide concern. Keep the overall review body focused on the verdict, cross-cutting findings, scope, validation, and uncertainty. Put the exhaustive record of clean checks in a collapsed `<details><summary>Provenance: what was reviewed</summary>…</details>` block rather than flooding the visible review with praise or checklist narration. See [references/review-feedback.md](references/review-feedback.md) for the required format and examples.

Use `github_pr` for top-level PR conversation comments. Use `github_issue` for issue comments. A PR conversation comment is not an inline review comment, and it is not a substitute for correctly placed review feedback.

Prefer editing an existing comment for corrections, formatting fixes, clarification, or status refreshes. Use a reply when the discussion genuinely advances, especially after someone has responded. Delete only accidental, duplicate, sensitive, or irreparably misplaced comments.

Create and read operations return comment/review IDs and URLs. Retain those handles and pass either the ID or GitHub URL to update/delete operations instead of searching with `gh api`.

Every create/update result visibly echoes the complete submitted body. Check that output when correctness matters. If the content is wrong, update the same PR, issue, review, or comment; do not post a corrective follow-up.

## Creating or updating a pull request

1. Read the local diff, commits, linked issue or decision record, and validation results. Do not generate the PR story from filenames or commit subjects alone.
2. Find and follow the repository's PR template and contribution guidance. Preserve required sections and checklists.
3. Read [references/pr-body.md](references/pr-body.md) before drafting the title or body. Explain why, summarize the behavioral change, and surface material risk without narrating the diff. Run its LLM-specific compression and claim-verification pass: do not repeat routine test counts, lint/build status, or other CI facts in the body.
4. Use GitHub's draft state for intentionally incomplete work instead of putting `[WIP]` in the title.
5. Create or update through `github_pr`, passing the complete Markdown body. Use `owner/repo#number` references and issue-closing keywords deliberately.
6. Read the full title and body echoed by the tool. If either is wrong or stale, update that same PR rather than adding a corrective conversation comment.

Keep the body current when review changes the scope, behavior, validation, rollout, or tradeoffs. The merged PR should describe the code that landed.

## PR and issue lifecycle

Use `github_pr` to view/list, create, or update pull requests. Use its comment actions only for the top-level PR conversation; route inline code discussion through `github_review`.

Use `github_issue` to view/list, create/update, close/reopen, and manage issue comments. Even though GitHub implements PR conversation comments through its issue-comment API, keep the user-facing distinction: PR work goes through `github_pr`, issue work through `github_issue`.

Pass `repo: "owner/repo"` explicitly for writes. Preserve the IDs and URLs returned by mutations so later edits and deletes do not require rediscovery.

## CI

Use `github_ci` with `action: "status"` for PR checks. Set `wait: true` to wait until checks finish instead of writing shell polling or sleep loops. Pass `expected_head_sha` when CI must correspond to code inspected locally.

The wait result is one of:

- `passed`
- `failed`
- `cancelled`
- `timed_out`
- `head_changed`
- `no_checks`

If CI fails, use the returned run IDs with `github_ci` `action: "failed_logs"`. Do not automatically rerun workflows. If the head changes, fetch and inspect the new code before proceeding.

## Cross-repository references

GitHub auto-links issues and PRs across repositories using `owner/repo#number`, for example `planetscale/psevents#51`. Use this form instead of a bare `#51` or a full URL when referencing work in another repository.

## Escape hatch

The structured tools intentionally do not cover arbitrary REST/GraphQL calls, releases, workflow dispatch, reactions, or every repository setting. Use `gh` only when the requested operation is genuinely outside the tool surface, not as a fallback for a covered operation that returned a useful error.
