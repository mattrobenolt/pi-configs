# Performance/memory research PR template

Copy this into the PR body for each kept experiment. Fill every placeholder;
delete nothing. This is the evidence-before-claims gate: a reviewer should be
able to reproduce the measurement from the body alone.

If the target repo has its own PR template with required fields (e.g. a
Security Impact section for PCI-scoped repos), **append those fields** — do
not drop them. This template covers the research evidence; the repo's
template covers project-specific compliance.

---

## <Hypothesis ID>: <one-line statement>

<!-- e.g. "H4: Stripped binary (-s -w -trimpath) lowers RSS via fewer mapped text pages" -->

### Hypothesis & mechanism
<What was hypothesized, and the mechanism by which it would improve the metric. One paragraph.>

### Falsifier
<"This hypothesis is wrong if I see X." State the observation that would have
disproved it, and note the experiment that ruled it out.>

### Measured results

Primary metric drives the keep decision. Direction: **lower is better**.

| Metric | Baseline | This change | Delta | Notes |
|--------|----------|-------------|-------|-------|
| VmHWM_KB (primary) | <b> | <n> | <n-b> (<%>) | peak resident set |
| VmRSS_KB | | | | steady-state resident |
| gc_count | | | | GC cycles over run |
| max_heap_after_KB | | | | max live heap after GC |
| binary_bytes | | | | file size |

### Method
- Bench command: `<exact script/bench-memory invocation>`
- Run window: <N>s, poll interval <X>s, HTTP scrape interval <Y>s
- Load: concurrent GET /metrics + GET /status every <Y>s; one mid-run converge at t=<N/2>s
- Env: `GODEBUG=gctrace=1 GOMAXPROCS=2`, Linux <arch>, Go <version>
- Baseline binary: unstripped `go build .` at commit <sha>
- Changed binary: <build flags / commit>

### Reproduce
```sh
<the exact two commands a reviewer runs to re-measure both baseline and change>
```

### Tests & behavior preservation
- `make test`: <PASS/FAIL>  (100% coverage enforced on: metrics, hashstore, crashtrack, restarter, reloader)
- `make lint`: <PASS/FAIL>
- Behavior unchanged because: <one sentence — what test/semantic guardrail proves the restart/reload/status behavior is identical>

### Security impact
<PCI-scoped repo: state the security impact, or "none — build-flag/resource change with no input handling surface".>

### Limits
<What was NOT tested. e.g. "real s6 subprocesses absent in bench env; exec output buffers are tiny either way", "production 30s poll interval vs bench 5s — absolute numbers are stressed, relative delta is the signal".>

### Lab reference
Experiment #<N> on `research/memory-footprint`, commit <sha>. Full log in `.lab/log.md`.
