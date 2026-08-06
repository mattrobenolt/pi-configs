# Stacked PRs with gh stack

Playbook for stacked branches/PRs via the `gh stack` CLI extension. Condensed
from the [upstream agent skill](https://github.com/github/gh-stack/tree/main/skills/gh-stack).

## The model

A stack is an ordered chain of branches rooted on a trunk, each branch one PR
based on the branch below it, so a reviewer sees only that layer's diff.
Printed trunk-first, left to right:

```
(main) <- auth <- api <- frontend
```

Left is the bottom, right is the top. Merge from any layer lands that PR plus
every unmerged PR below it, bottom-up. GitHub auto-rebases the rest after a
partial merge; `gh stack sync` is the local counterpart. Protection and CI
evaluate against trunk at every layer.

## Setup

```bash
gh extension install github/gh-stack
git config rerere.enabled true         # init enables it, but asks under a TTY; preset it
git config remote.pushDefault origin   # required when the repo has more than one remote
```

With multiple remotes, never run `push`, `submit`, `sync`, `rebase`, or `link`
without `--remote <name>` unless `remote.pushDefault` is configured.

## Non-interactive rules

`gh stack` branches on whether stdout is a TTY: under a PTY, bare commands open
prompts or full-screen TUIs and block forever. Never rely on detection — pass
the flags:

| Always run | Never run bare |
|---|---|
| `gh stack view --json` | `gh stack view` (TUI; `--short` is safe but human-formatted) |
| `gh stack submit --auto` | `gh stack submit` (prompts per title) |
| `gh stack merge <target> --yes` | `gh pr merge` (cannot merge a stack) |
| `gh stack init <branch>...` | `gh stack init` |
| `gh stack add <branch>` | `gh stack add` (fails even piped) |
| `gh stack checkout <target>` | `gh stack checkout` (selection menu) |
| `gh stack up` / `down` / `top` / `bottom` | `gh stack switch` (menu-only) |
| — | `gh stack modify` (TUI-only, no non-interactive path) |

`gh stack <command> --help` is authoritative for flags. `gh stack help
<command>` does not work — it prints the top-level help.

## Branch placement

- Create the stack before writing code. One dependent concern per layer,
  bottom to top. Do not implement everything on trunk and split it later —
  there is no non-interactive reorder.
- `init` checks out the last branch listed, so one command lays down the whole
  chain: `gh stack init auth api frontend`. Existing branches are adopted —
  existence decides, there is no adopt mode. `--base` selects a non-default
  trunk. Existing PRs keep their titles and bodies.
- Name branches `<topic>/<concern>` (`billing/schema`, `billing/api`). Names
  are verbatim, slashes kept. Repository naming conventions win.
- Stage with `git add` and `git commit`, not `add -Am`. Without flags, `add`
  does not touch the working tree, so uncommitted changes carry onto the new
  branch. `add` runs only from the top branch (exit 5 otherwise).
- To change a lower layer: check out the layer that owns the change (find
  ownership with `gh stack view --json` or `git log --all -- <path>`), edit,
  commit, `gh stack rebase --upstack`, `gh stack top`, `gh stack push`. Never
  commit a lower layer's concern on the top branch.

## Core loop

```bash
gh stack init auth
git add ... && git commit -m "Add auth middleware"
gh stack add api
git add ... && git commit -m "Add API routes"
gh stack submit --auto          # push every branch, create draft PRs, link the Stack
gh stack view --json            # confirm
```

`submit` creates drafts by default; `--open` marks new and existing PRs ready
for review. Title generation: a single-commit branch uses the commit subject
and body; a multi-commit branch gets a humanized branch name. There is no
custom-title flag — rewrite with `github_pr update` per pr-body.md.

Neither `push` nor `submit` is atomic: branches go up sequentially with
per-branch `--force-with-lease`. A rejection means that branch moved on the
remote; fix it and rerun — reruns skip what already landed. `push` never
creates or updates PRs.

A fully merged stack cannot be extended: `submit` forks the remaining unmerged
branches into a new stack rooted at the trunk.

## Staying in sync

```bash
gh stack sync                   # fetch, reconcile with GitHub, rebase, push, refresh PRs
gh stack sync --prune           # also delete local branches for merged PRs
```

Trap: on local/remote divergence, `sync` prints both chains, changes nothing,
and exits **0** with `Sync aborted`. Exit 0 does not mean synced — check the
output or re-run `view --json`. Recovery:

- Keep the remote: `gh stack unstack --local` (the GitHub stack survives),
  then `gh stack checkout <stack-number>`.
- Keep the local: `gh stack unstack` (PRs and branches survive), then
  `gh stack submit --auto`.

Squash merges are detected: merged parents are replayed with `--onto`, so no
manual action is needed. If the replay conflicts, `sync` restores every branch
and exits 3 — run `gh stack rebase` to recreate the conflict and resolve it.

## Merging

```bash
gh stack merge 42 --yes           # PR #42 plus every unmerged PR below it
gh stack merge 7 --yes            # every unmerged PR in stack #7
gh stack merge 42 --yes --squash  # or --merge, --rebase, --merge-method <method>
```

All-or-nothing: if any PR in the set cannot merge, none do. Without a method
flag, the last-used method is reused. A merge queue on the base branch
overrides everything: the stack is queued, the queue picks the method (your
flag is ignored with a warning), and the PRs may land in separate groups. Only
basic state is checked (open, not a draft); bypassing merge requirements is
not supported.

## Reading state

`view --json` writes the payload to stdout; status messages go to stderr. Do
not parse stderr — branch on exit codes.

```
trunk           string
currentBranch   string
branches[]      name, head, base, isCurrent, isMerged, isQueued, needsRebase
branches[].pr   number, url, state ("OPEN" | "MERGED" | "QUEUED"); absent without a PR
```

`base` is the saved parent SHA the branch was last known to contain; it may
lag the parent's current tip. `needsRebase` is true when the parent tip is no
longer an ancestor of the branch.

`checkout` accepts a stack number, PR number, PR URL, or branch name. A bare
number resolves as stack number, then PR number, then branch name. Branch
names resolve against local stacks only — use a stack or PR number to pull a
stack down from GitHub. If a different local stack already covers those
branches, run `gh stack unstack --local` first, then retry.

## Exit codes

| Code | Meaning | Recovery |
|---|---|---|
| 0 | Success | — (but see the `Sync aborted` trap above) |
| 1 | Generic error | Read stderr |
| 2 | Not in a stack | `gh stack init` or `gh stack checkout <target>` |
| 3 | Rebase conflict | See below |
| 4 | GitHub API failure | Check `gh auth status`, retry |
| 5 | Invalid arguments | Fix the invocation; see `<command> --help` |
| 6 | Branch in several stacks | Check out a branch unique to the intended stack |
| 7 | Rebase already in progress | `gh stack rebase --continue` or `--abort` |
| 8 | Stack file locked | Another `gh stack` process; retry after ~5s |
| 9 | Stacked PRs unavailable | Not enabled on the repo; tell the user |
| 10 | Modify recovery required | `gh stack modify --abort` |

Exit 3: after `rebase`, resolve the files, `git add`, then
`gh stack rebase --continue` (`--abort` restores every branch). After `sync`,
the stack was already restored — run `gh stack rebase` to recreate the
conflict, then resolve and continue. `rerere` replays each resolution
automatically as the same conflict cascades upstack, which it does once per
layer above the change.

Exit 6 has no flag workaround; commands that take an explicit stack number
(`gh stack merge 7`, `gh stack unstack 7`) sidestep it entirely.

## Restructuring

No non-interactive reorder, rename, or removal. Metadata changes do not change
Git ancestry — reorder commits first, then rebuild:

```bash
gh stack unstack                        # removes grouping; PRs/branches survive
# To swap models and migration in: main <- models <- migration <- ui
old_models=$(git rev-parse models)
old_migration=$(git rev-parse migration)
git rebase --onto main "$old_models" migration
git rebase --onto migration main models
git rebase --onto models "$old_migration" ui
gh stack init --base main migration models ui   # adopts the existing branches
gh stack submit --auto                  # fixes bases, re-links the Stack
```

Preserve the old boundary SHAs before moving any branch. For a different
reorder, identify each layer's range with `git log <old-parent>..<branch>` and
replay the ranges bottom to top.

## Stacks without local tracking

`gh stack link` creates and updates a stack purely through the API — for
branches managed by jj, git-town, a separate worktree, or any flow where the
local `.git/gh-stack` state would be wrong:

```bash
gh stack link branch-a branch-b branch-c   # bottom to top
gh stack link 7 feature-d                  # append to existing stack #7
```

Membership is additive only; `link` never removes a PR. Local navigation will
not work on the result — run `gh stack checkout <stack-number>` later if local
tracking is needed.

## Caveats

Private preview: stack map, auto-rebase, and stacked merge need the feature
enabled on the repository (exit 9 without it). Everything degrades to an
ordinary manual stack — chain PR bases by hand and rebase each downstream
branch after merges.

Stacks are strictly linear: one parent, at most one child. Use separate stacks
for parallel work. Stack one cohesive story — foundational layers low,
dependents high; ordering constraints that are not code dependencies stay the
operator's job.
