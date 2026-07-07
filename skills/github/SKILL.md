---
name: github
description: "Interact with GitHub using the `gh` CLI. Use `gh issue`, `gh pr`, `gh run`, and `gh api` for issues, PRs, CI runs, and advanced queries."
license: From mitsuhiko/agent-stuff
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Pull Requests

Check CI status on a PR:
```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:
```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:
```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:
```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:
```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## Inline PR Review Comments

Do not use `gh pr comment` for inline comments. That only creates a general PR conversation comment. Inline file/line comments are pull request review comments.

Prefer the bundled helper script instead of hand-writing `gh api` payloads:
```bash
./scripts/pr-inline-comment.py \
  --repo owner/repo \
  --pr 55 \
  --path src/file.ts \
  --line 123 \
  --side RIGHT \
  --body 'This is the inline review comment.'
```

Run it from this skill directory, or invoke it by absolute path. The script fetches the PR head SHA itself and posts to the correct review-comment API.

For multiple inline comments, write a JSON array and pass it with `--comments`:
```json
[
  {
    "path": "src/file.ts",
    "line": 123,
    "side": "RIGHT",
    "body": "This is the first inline comment."
  },
  {
    "path": "src/other.ts",
    "line": 45,
    "side": "RIGHT",
    "body": "This is another inline comment."
  }
]
```

```bash
./scripts/pr-inline-comment.py \
  --repo owner/repo \
  --pr 55 \
  --comments /tmp/pr-comments.json \
  --review-body 'Review comments'
```

Use `side=RIGHT` for added lines and unchanged context lines on the PR side. Use `side=LEFT` for deleted lines from the base side. The `line` value is the file line number shown in GitHub's diff, not the old deprecated `position` value. For a whole-file comment, omit `line` and pass `--subject-type file`.

For multi-line comments, use `start_line`/`start_side` plus `line`/`side`, where `line` is the last line of the selected range:
```json
{
  "path": "src/file.ts",
  "start_line": 120,
  "start_side": "RIGHT",
  "line": 123,
  "side": "RIGHT",
  "body": "This range has a problem."
}
```

If GitHub rejects the comment with a validation error, the target line usually is not part of the PR diff, the side is wrong, or the PR head SHA changed. Fetch the PR diff and verify the target before retrying:
```bash
gh pr diff 55 --repo owner/repo -- src/file.ts
```

Raw API fallback for cases the script does not cover:
```bash
HEAD_SHA=$(gh pr view 55 --repo owner/repo --json headRefOid --jq .headRefOid)

gh api repos/owner/repo/pulls/55/comments \
  --method POST \
  -f commit_id="$HEAD_SHA" \
  -f path='src/file.ts' \
  -F line=123 \
  -f side=RIGHT \
  -f body='This is the inline review comment.'
```

## JSON Output

Most commands support `--json` for structured output.  You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
