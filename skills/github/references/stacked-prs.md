# Stacked PRs with gh stack

Playbook for stacked branches/PRs via the `gh stack` CLI extension. Condensed
from the [upstream agent skill](https://github.com/github/gh-stack/blob/main/skills/gh-stack/SKILL.md).

## The model (all of it)

Each branch builds on the one below, rooted on trunk; each branch is one PR
whose base is the branch below. Merge from any layer lands that PR **plus every
unmerged PR below it**, bottom-up. GitHub auto-rebases the rest after a partial
merge; `gh stack sync` is the local counterpart. Protection and CI evaluate
against trunk at every layer.

## Rules that actually bite

- Stack one cohesive story, foundational layers low. Don't stack unrelated
  work, and don't stack for ordering constraints that aren't code dependencies
  — the tool manages topology, not policy.
- Every command non-interactive: `view --json`, `submit --auto`, branch names
  always positional. Bare invocations hang on prompts/TUIs.
- `submit --auto` generates titles/bodies from commits for PRs it creates —
  rewrite bodies after with `github_pr update` (per pr-body.md). For adopted
  PRs that already exist, `submit` links them into the Stack and reports them
  up to date; titles and bodies survive untouched.
- Creating the Stack disables auto-merge on member PRs ("incompatible with
  stacked PRs"). If a layer had auto-merge set before `submit`, re-enable it
  deliberately afterward, knowing the merge now lands everything below too.
- Need to change a lower layer? Navigate down (`gh stack down`/`checkout`),
  commit there, `gh stack rebase --upstack`, `gh stack push`. Never sneak a
  lower layer's change into the top branch — it lands in the wrong PR.

## The 95% workflow

```bash
gh stack init layer-1            # or: gh stack init existing-a existing-b  (adopts, links existing PRs)
# ... code, git add/commit per layer ...
gh stack add layer-2
gh stack submit --auto           # pushes, creates/links PRs into a GitHub Stack
gh stack sync --prune            # routine: fetch, cascade-rebase, push, sync PR state, prune merged
```

Rebase conflict → exit 3: resolve markers, `git add`, `gh stack rebase --continue`.
Squash-merges are detected and replayed with `rebase --onto` automatically.
Restructure (reorder/rename/remove a layer): `gh stack unstack` removes the
GitHub-side Stack and local tracking (PRs/branches survive), rearrange,
re-`init`.

## Caveats

Private preview: stack map/auto-rebase/merge-stack need the feature enabled on
the repo (exit code 9 without it). Everything degrades to an ordinary manual
stack — chain PR bases by hand and rebase each downstream branch after merges
(`git rebase origin/main` + force-push + retarget; lazily, one branch per merge).
Stacks are strictly linear, and merging happens in the GitHub UI, not the CLI —
`gh pr merge` and the synchronous REST merge endpoint both reject stacked PRs;
the only API path is the async merge endpoint (`PUT /repos/o/r/pulls/N/merge-async`
with an `sha` head pin, poll `GET .../merge-async/{uuid}`), which cancels if the
head moves. Prefer the UI merge button.
