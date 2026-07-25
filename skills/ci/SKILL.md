---
name: ci
disable-model-invocation: true
description: "Improve CI workflows: caching for faster builds, GitHub Actions security hygiene (SHA pinning, zizmor, pinact, least-privilege permissions), and measuring CI improvements with real data. Use when investigating slow CI, adding caching, auditing workflow security, or improving build stability. Depot runner specifics are PlanetScale-specific — ask for confirmation if the project may not use Depot."
---

# CI

## Depot runners

The Depot patterns in this skill (Depot Cache, `depot-ubuntu-*` runners, `depot/build-push-action`) are specific to **PlanetScale projects**. Not all projects use Depot. If you're unsure whether a project uses Depot runners, **ask the user** before applying Depot-specific advice. The general GitHub Actions patterns (SHA pinning, zizmor, pinact, permissions, `actions/cache`) apply to any GitHub Actions project.

## CI hygiene patterns

### SHA-pin all third-party actions

Every `uses:` reference to a third-party action must be pinned to a full 40-character SHA with a version comment:

```yaml
# Good
- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
- uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0

# Bad — mutable tag, can be force-pushed
- uses: actions/checkout@v7
```

Local composite actions (`./.github/actions/...`) and relative references (`./action`) don't need pinning — they resolve from the repo.

**Automate with pinact**: `pinact run --verify -min-age 3` pins refs to SHAs and adds/updates version comments. Run the check in CI and provide a local just recipe:

```make
# Check that all actions references are SHA-pinned with valid version comments
pinact-check:
    pinact run -check --verify -min-age 3 .github/workflows/*.yaml .github/actions/*/action.y*

# Pin and update version comments
pinact:
    pinact run --verify -min-age 3 .github/workflows/*.yaml .github/actions/*/action.y*
```

`--verify` checks that the SHA matches the tag. `--min-age 3` refuses to pin actions younger than 3 days (supply-chain hygiene — don't pin something that might still be yanked).

### Audit with zizmor

[zizmor](https://github.com/zizmorcore/zizmor) audits GitHub Actions workflows for security issues: injection via `github.event.*` in `run:` steps, excessive permissions, secret exposure, toxic combos. Run it in a dedicated security workflow:

```yaml
name: GitHub Actions Security
on:
  pull_request:
    paths: ['.github/**', 'Justfile', 'flake.nix']
  push:
    branches: [main]
    paths: ['.github/**', 'Justfile', 'flake.nix']
permissions: {}
jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@<sha> # v7.0.0
        with:
          persist-credentials: false
      - uses: zizmorcore/zizmor-action@<sha> # v0.6.0
        with:
          advanced-security: false
          min-confidence: medium
```

Also provide a local just recipe so developers can run it without CI:

```make
lint-actions:
    zizmor --format=plain --min-confidence=medium .
```

Install both `pinact` and `zizmor` in the Nix devShell so they're available without `pip install` or `npm install`.

### Least-privilege permissions

Set `permissions: {}` at the workflow level (deny all), then grant only what each job needs:

```yaml
permissions: {}  # workflow-level: deny all

jobs:
  unit-test:
    permissions:
      actions: write   # for cache save/restore
      contents: read
  build-and-push:
    permissions:
      contents: read
      packages: write
      id-token: write  # for OIDC auth to cloud registries
```

Never use `permissions: write-all` or leave permissions unset on a workflow that handles secrets.

### persist-credentials: false

Always set `persist-credentials: false` on `actions/checkout` when the job uses a token with elevated permissions. Otherwise the checkout action persists the token to `.git/config`, making it available to any subsequent `git` command or script — a secret-leak vector flagged by zizmor.

```yaml
- uses: actions/checkout@<sha>
  with:
    persist-credentials: false
    token: ${{ secrets.BOT_TOKEN }}
```

## Caching

### Audit checklist

Before adding caches, identify what each CI job downloads, builds, or computes from scratch on every run:

1. **Package/dependency downloads** — language package managers (Zig global cache, Go modules, npm, pip/uv, Cargo, Maven, Gradle)
2. **Compilation artifacts** — build caches that are expensive to recompute (Go build cache, ccache)
3. **Docker layer misses** — Dockerfiles that `COPY . .` before fetching deps, invalidating the fetch layer on every source change
4. **Toolchain downloads** — Nix store, pre-built binaries fetched from GitHub releases

For each item: is it already cached? What file(s) pin its identity (lock files, manifest hashes)? What's the cache key?

### actions/cache patterns

#### Cache key design

The cache key must change when the cached content changes and stay stable when it doesn't. Use a content hash of the manifest/lock file:

```yaml
key: ${{ runner.os }}-zig-deps-${{ hashFiles('build.zig.zon') }}
restore-keys: |
  ${{ runner.os }}-zig-deps-
```

- **Exact key**: hash of the lock file. A hit means the entire cache is valid — zero download.
- **Restore key prefix**: falls back to the most recent cache with the same prefix. A single dependency bump restores the previous cache and only downloads the delta.

#### What to cache vs. what not to cache

Cache **package/download caches** (the fetch output), not compilation output, unless the compilation is the bottleneck:

- ✅ `~/.cache/zig/p` (Zig global package cache — downloaded tarballs)
- ✅ `~/go/pkg/mod` + `~/.cache/go-build` (Go modules + build cache)
- ✅ `~/.cache/uv` (uv package cache for Python)
- ✅ `~/.cargo/registry` (Cargo registry cache)
- ❌ `~/.cache/zig/o` (Zig compilation artifacts — architecture/build-flag specific, not worth the overhead for ephemeral CI)

#### Composite action caching

If multiple jobs share the same setup steps via a composite action (e.g., `.github/actions/setup-nix/action.yml`), add the cache step there so all consuming jobs benefit from a single change.

### Dockerfile layer caching

#### Split COPY to isolate dependency fetch

The anti-pattern: `COPY . .` then `RUN zig build` in one layer. Any source change invalidates the layer, forcing a full re-fetch inside the container.

The fix: copy only the manifest files first, fetch deps, then copy the rest:

```dockerfile
# syntax=docker/dockerfile:1

COPY build.zig.zon build.zig ./
RUN --mount=type=cache,target=/root/.cache/zig \
    zig build --fetch

COPY . .
RUN --mount=type=cache,target=/root/.cache/zig \
    zig build -Doptimize=ReleaseFast
```

The fetch layer is only invalidated when `build.zig.zon` or `build.zig` change — not on every source edit.

#### BuildKit cache mounts

`--mount=type=cache,target=<path>` persists a directory across builds even when the layer is invalidated. Requires `# syntax=docker/dockerfile:1` as the first line.

#### Verify the fetch step works standalone

Before pushing, verify the dependency fetch command works with only the manifest files present (no `src/`):

```bash
cd /tmp && mkdir test-fetch && cd test-fetch
cp /path/to/repo/build.zig.zon /path/to/repo/build.zig ./
zig build --fetch  # should succeed without src/
```

### Depot-specific caching

On Depot GitHub Actions runners (`runs-on: depot-ubuntu-*`), `actions/cache` is transparently routed to Depot Cache — a faster remote cache backend. No config change needed.

`depot/cache-mount` (cache disks) only works in Depot CI jobs, **not** on Depot GitHub Actions runners. See [references/depot-cache.md](references/depot-cache.md) for the full product matrix.

## Measuring CI improvements

### Establish a baseline

Before making changes, find a recent successful CI run on the target branch and record step-level timings:

```bash
gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs --jq '
  .jobs[] |
  "\(.name):\n" + ([.steps[] | "  \(.name): \(.started_at) → \(.completed_at)"] | join("\n")) + "\n"
'
```

Focus on the **work step** duration (the actual test/build/lint command), not job overhead.

### Cold vs. warm cache runs

1. **Cold cache**: First push after adding caching. Caches are populated — often slightly slower due to save overhead.
2. **Warm cache**: Second push (empty commit or trivial change). Caches are hit — this is the steady-state improvement.

```bash
git commit --allow-empty -m "chore: trigger warm-cache CI measurement"
git push
```

### Compare the right things

Compare the **work step** duration, not total job time. Job time includes queue waits, runner setup, and post-step cleanup that vary with load.

Present results as a table only when the data shows a consistent signal. If results are mixed/noise, say so in prose.

### Stability is a valid outcome

If the speed improvement is modest but the change eliminates an external network dependency (e.g., re-downloading from GitHub on every push), that's a real win. State it explicitly.

## Common pitfalls

- **Cache key too broad**: `${{ runner.os }}-deps` without a hash means every run gets the same cache regardless of dependency changes. Always include a content hash.
- **Cache key too narrow**: A key that includes the commit SHA means every push is a cache miss. Hash the lock file, not the commit.
- **Forgetting restore-keys**: Without a restore-key prefix, a single dependency bump is a full cache miss.
- **Dockerfile without syntax directive**: `--mount=type=cache` requires `# syntax=docker/dockerfile:1`. Without it, the mount is silently ignored or errors.
- **Measuring total job time instead of step time**: Queue waits and runner provisioning vary independently of your caching change.
- **Caching too much**: Don't cache compilation artifacts that are architecture or build-flag specific on ephemeral runners. The cache restore overhead can exceed the recompute cost.
- **Unpinned actions**: Mutable tags (`@v7`) can be force-pushed. Always pin to SHAs.
- **Missing `persist-credentials: false`**: Checkout persists the token to `.git/config` by default — a secret-leak vector.
