# Go memory measurement reference

Techniques for measuring and reducing memory footprint of a Go binary running as a long-lived process (sidecar, daemon, controller). Load when the optimization target is a Go program's RSS/heap/binary size.

## System-level metrics (the numbers that matter in a container)

A container's memory limit pressures against the process's resident set, not Go's logical heap. Measure the OS view, not just the runtime view.

- **`/proc/<pid>/status`** → `VmRSS` (current resident), `VmHWM` (peak resident high-water mark), `VmSize` (virtual). `VmHWM` is the number that bites a pod limit; sample it after a run that exercises bursts. `grep -E 'Vm(RSS|HWM|Size)' /proc/<pid>/status`.
- **`/proc/<pid>/smaps_rollup`** → aggregate `Rss`, `Pss`, `Pss_Anon`, `Pss_File`. Cheap single read. `Pss_File` includes mapped text pages (binary size shows up here).
- **`pmap -x <pid>`** → per-mapping RSS. Confirms whether RSS is text, heap (anon), or file-backed.
- **`size <binary>`** → text/data/bss sizes without running. Quick check on binary-segment contributions.

Primary metric for sidecar memory work: **`VmHWM` in KB** after a run long enough to exercise the hot paths and one burst. Secondary: steady-state `VmRSS`, total GC allocs, binary bytes.

## Go runtime signals

- **`GODEBUG=gctrace=1`** — prints a line per GC: `gc N @X%: Y+Z+Q ms sc, B→C GB→GC MB→MC`. Key fields: `B→C` = heap live before→after, `G` prefix = goroutines, and the totals at line end include `next_gc`. Most useful: it reveals *garbage churn* — how much is allocated and freed per collection. A steady-state process with low live set but high churn is allocating transient garbage. Parse total allocs by summing `C-B` deltas or by adding a `runtime.MemStats` probe. Simplest: count lines and read `HeapAlloc` trends.
- **`runtime/pprof`** heap profiles — `pprof.StartCPUProfile` is for CPU; for memory use `pprof.WriteHeapProfile` at a point, or expose `net/http/pprof` and `go tool pprof http://host/debug/pprof/heap`. `go tool pprof -alloc_objects` shows allocation count sources (the real signal for churn); `-inuse_space` shows what's live (the signal for steady-state footprint).
- **`runtime.ReadMemStats`** — `MemStats{HeapAlloc, HeapInuse, HeapSys, TotalAlloc, NumGC, Mallocs, Frees}`. `TotalAlloc` / runtime-seconds = alloc rate. `Mallocs - Frees` = live object count. Cheap to read but causes a STW; sample sparingly (a few times across a run, not per-tick).
- **`GOMAXPROCS`** — each P has caches; lowering it can reduce mcache footprint for low-concurrency sidecars. Measure before committing.

## Levers, roughly in order of bang-for-buck for a sidecar

1. **`GOMEMLIMIT` / `debug.SetMemoryLimit`** — soft memory cap. Makes GC proactive instead of reactive. For a tiny-live-set, bursty-allocation sidecar this is the single biggest structural lever. Set to your target cap (e.g. 32–64 MiB). Watch for GC CPU spike if set too low; pair with `GOGC`. This is a one-liner and the first thing to test.
2. **Binary stripping** — `go build -ldflags="-s -w" -trimpath`. Drops DWARF + symbol tables. Reduces binary size → fewer mapped text pages → lower `Pss_File` / RSS. Zero code risk. Test first; it's free.
3. **Stream instead of buffer** — replace `os.ReadFile(path)` + `sha256.Sum256(data)` with `io.Copy(file, sha256.New())` using a fixed `bufio` buffer (32 KiB). Eliminates allocations proportional to file size. The classic offender is hashing/reading a multi-MB file every tick.
4. **Reuse buffers / pools** — `sync.Pool` for per-iteration scratch (maps, slices, byte buffers) when an allocation is repeated on a hot path. Only when measurement shows the allocation matters.
5. **Tune `GOGC`** — default 100 (collect at 2× live). With `GOMEMLIMIT` set, you can often *raise* `GOGC` (less frequent GC) and let the limit drive collection, reducing CPU. Without a limit, *lowering* `GOGC` collects sooner but burns CPU. Measure both directions; don't assume.
6. **Shrink dependency footprint** — heavy deps (metrics libs, HTTP routers) bring goroutines, caches, init allocs. A lighter dep can cut baseline RSS. Measure the swap in isolation.
7. **Lazy / fewer goroutines** — each goroutine starts at ~8 KiB stack (grows on demand) plus runtime overhead. A sidecar with 3 goroutines vs 30 is a small but real difference. Don't spawn-per-request.
8. **Avoid `bytes.Buffer` for throwaway captures** — `io.Discard` for output you don't need; capped buffers when you do. Per-command stdout/stderr buffers add up on hot paths.

## Measurement harness shape

A bench script for a Go sidecar should:

1. Clean runtime state dirs (services, hash stores) to a known baseline.
2. Build the binary under test (`go build` with the experiment's flags).
3. Launch it against fixtures with `GODEBUG=gctrace=1` redirected to a `run.log`, in the background.
4. Optionally trigger a burst mid-run (mutate a fixture / touch a config) to exercise the change path.
5. Sample `VmRSS`/`VmHWM` from `/proc/<pid>/status` on a cadence; capture final `smaps_rollup`.
6. Kill after the wall-clock budget.
7. Parse `run.log` gctrace for total allocs / GC count; parse status for peak `VmHWM`; parse `size` for binary bytes.
8. Print a single TSV line: `VmHWM_KB\tVmRSS_KB\tgc_allocs\tbinary_bytes`.

Keep fixtures deterministic and small enough that the harness is fast but representative of the production service tree (a handful of services, a few trigger files, one config change to exercise converge).

## Pitfalls

- **macOS measurements lie.** RSS reporting and `madvise` heuristics differ from Linux. Always measure on the production OS (Linux for containers). A binary that looks bounded on macOS can RSS-spike on Linux.
- **`VmHWM` is sticky.** It only resets on exec. To measure a clean peak, start a fresh process each run; don't reuse PIDs.
- **GC CPU cost vs memory.** Aggressive `GOMEMLIMIT`/low `GOGC` lowers RSS but raises GC CPU. Track a secondary CPU metric (gctrace `Y+Z` ms, or `perf stat`) if the sidecar has latency-sensitive duties.
- **Scavenger latency.** Go returns memory to the OS on a delay. Longer run windows catch the steady-state after the scavenger settles; short runs overstate RSS.
- **`ReadMemStats` STW.** Don't call it on the hot path you're measuring; it perturbs the result.
- **Production-build fidelity (the expensive one).** A local `go build` defaults to `CGO_ENABLED=1` when a C compiler is present, dynamically linking glibc (~1.2 MB of libc resident in RSS). Production often builds `CGO_ENABLED=0` (static, no libc) via a CI workflow. If the bench builds differently than production, the baseline is inflated by libc that production never has, and any change that merely matches production's build (e.g. "set CGO=0 in the Makefile") shows up as a fake win. Before baselining, diff the bench's build flags against the release workflow's and make them match. Record the confirmed flags.
- **Load validity.** Idle polling isn't representative. If the system serves HTTP, the bench must drive `/metrics` + `/status` (or the production scrape paths) at a realistic cadence, or the serving-path allocations (JSON encode, status snapshot, monitored-file hashing, metrics serialization) are invisible and the numbers mislead. State which production paths the bench drives and which it doesn't.
- **GOMEMLIMIT becomes a safety net after churn is removed.** A cap that actively reduced peak RSS before the dominant transient-allocation source was fixed will stop binding once it's fixed (the transient peak is gone). Re-measure the cap's marginal value after each keep; don't assume the first sweep's verdict holds.
- **Build-flag changes must reach the release path.** A Makefile `build` target change doesn't ship if the CI workflow invokes `go build` directly. Trace build-flag changes to the production build (workflow or Makefile-as-called-by-workflow), not just the local Makefile. Consider converging CI onto `make build` so flags live in one place and can't drift.
- **`encoding/json/v2` is a GOEXPERIMENT, not a drop-in.** Enabling it re-implements v1 on top of v2 (both compile in → binary grows). Migrating call sites to v2 directly still grows the binary vs v1. It's an unstable experiment — don't pin it on critical infra for a memory loss.
