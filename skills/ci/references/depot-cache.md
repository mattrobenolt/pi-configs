# Depot Cache Product Matrix

**Depot is used by PlanetScale projects.** Not all projects use Depot. If you're unsure whether a project uses Depot runners, ask the user before applying Depot-specific advice.

Depot offers three distinct caching products. They are **not** interchangeable — each works with specific Depot products and runner types.

## Products

| Product | What it caches | Where it works | Config needed |
|---|---|---|---|
| **Depot Cache** (remote cache) | GitHub Actions cache API entries | Depot GitHub Actions runners only | None — `actions/cache` is transparently routed |
| **Persistent Docker layer cache** | BuildKit layers (Docker image layers) | Depot remote container builders | None — automatic on every project |
| **Cache disks** (`depot/cache-mount`) | Durable POSIX filesystem, shared across workflows | Depot CI jobs only | `depot/cache-mount` action with `name` + `path` |

## Determining which product applies

Check the `runs-on:` field in the workflow:

```yaml
runs-on: depot-ubuntu-24.04    # → Depot GitHub Actions runner
runs-on: depot-ubuntu-latest   # → Depot GitHub Actions runner
```

These use **Depot Cache** for `actions/cache` and **persistent Docker layer cache** for `depot/build-push-action`. They do **not** support `depot/cache-mount`.

```yaml
runs-on: depot-ci-...          # → Depot CI (separate product)
```

This supports all three, including `depot/cache-mount`.

## Depot Cache (for actions/cache)

When a job runs on a Depot GitHub Actions runner, any action that uses the GitHub Actions cache API automatically uses Depot Cache instead of standard GitHub Actions cache. This includes:

- `actions/cache`
- `actions/setup-node` (npm/yarn cache)
- `actions/setup-python` (pip cache)
- `actions/setup-java` (Maven/Gradle cache)
- Any custom action that calls the cache API

Cache entries are scoped by repository — one repo cannot read another's cache entries. No configuration is needed beyond using a Depot runner.

Default retention: 14 days. Configurable to 7, 14, or 30 days with size limits from 25GB to no limit.

## Persistent Docker layer cache

Depot remote container builders (used via `depot/build-push-action` or `depot build`) have persistent NVMe cache SSDs. Docker layers stay in cache across builds within a project. No `cache-from`/`cache-to` config needed — it's automatic.

Cache retention: 7, 14, or 30 days (configurable per project). Default cache size: 50GB, expandable to 1000GB.

## Cache disks (depot/cache-mount)

Only for Depot CI. Mounts a durable POSIX filesystem at a path in the job. Identified by a name that's global to the Depot org — any workflow mounting the same name reuses the same disk.

Key behaviors:
- **Read-only by default** — set `write-lock` to write
- **Not scoped to repository** — any build in the org that knows the disk name can read it
- **Public fork PRs skip mounting** — untrusted forks can't read org cached data
- **Selective directory locking** — multiple jobs can write to different directories on the same disk concurrently using non-overlapping `write-lock` paths
- **Unlimited parallel readers**
- Default retention: 14 days

Best fit: one-writer-many-readers pattern (scheduled job populates, fan-out jobs read), content-addressed tool caches (GOCACHE, CARGO_HOME, ~/.m2), read-only reference data.
