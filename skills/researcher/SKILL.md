---
name: researcher
description: 'Autonomous measurement-driven optimization loop for performance, memory, latency, or binary-size work on real codebases. Generalizes the autoresearch pattern beyond ML into "anything you can build, run, and measure." Treats each change as a falsifiable hypothesis: commit before running, measure after, keep only what improves the primary metric, revert on discard. Use when the user wants to reduce memory/RSS/CPU/binary size, optimize a hot path, hit a latency target, or generally "make X faster/lighter" through iterative experimentation rather than a single rewrite. Triggers on "optimize", "reduce memory", "lower RSS", "make it lighter", "profile and improve", "research loop", "autoresearch", or when a measurable metric and a keep/discard discipline are needed. Do NOT use for bug diagnosis (use hypothesis-driven / systematic-debugging) or greenfield feature work.'
---

# Researcher — Measurement-Driven Optimization Loop

Run an optimization research campaign against a real codebase with a measurable metric. Think → Test → Reflect, autonomously, with `.lab/` as the untracked source of truth.

## When to activate

- A measurable optimization target exists (memory, RSS, CPU, latency, binary size, allocs/op, startup time).
- The user wants iterative, evidence-backed improvement rather than a one-shot rewrite.
- There is a way to build and run the code and read a number out.

Do not activate for: bug diagnosis (use hypothesis-driven), trivial one-line fixes, or work with no measurable signal.

## Core discipline (non-negotiable)

1. **Commit before running.** Every real experiment is committed with `experiment: <desc>` before measurement. This is the safety net.
2. **Measure after.** Run all measure commands (primary + secondary), record raw values.
3. **Keep / discard by the primary metric.** Improved past the noise threshold → keep. Equal or worse → `git reset --hard HEAD~1` and log discard.
4. **Log every result.** A row in `.lab/results.tsv` and an entry in `.lab/log.md`. No result goes unrecorded.
5. **Protect `.lab/`.** It is untracked and survives all git operations. Never `git clean` over it. Use targeted resets.

## Safety hardening for critical infrastructure

When the codebase is production-critical, add two co-gates alongside the metric:

- **Tests stay green.** The project's test/lint/coverage commands are part of every experiment's run chain. An experiment that improves the metric but breaks tests is a **discard**, no exceptions. Record the failure as the discard reason.
- **Behavior is preserved.** The metric win is only valid if behavior is unchanged. The existing test suite is the guardrail; if coverage is enforced (e.g. 100% thresholds), that enforcement catches drift. State the behavior-preservation falsifier up front: "this experiment is wrong if test X fails or behavior Y changes."

State these gates in `.lab/config.md` under `constraints` so every iteration honors them.

## Workflow

### Phase 0 — Resume check

If `.lab/` exists: read `config.md`, `results.tsv`, `branches.md`, tail of `log.md`. Summarize objective, metrics, best vs baseline, last status. Ask: resume or start fresh? On fresh: archive to `.lab.bak.<ts>/`.

If not: Phase 1.

### Phase 1 — Discovery

Interview the user (skip what's obvious from context). Use defaults when the user has no preference:

1. **Objective** — one sentence.
2. **Primary metric** — required, drives keep/discard. Name, measure command (outputs a number), direction (lower/higher better).
3. **Secondary metrics** — tracked for context, only break ties.
4. **Scope** — files/areas modifiable.
5. **Constraints** — off-limits, plus the two safety gates above for critical code.
6. **Run chain** — the full command sequence to build + run one experiment and emit the metric(s). Entire chain must succeed.
7. **Wall-clock budget per experiment** — default 5 min; raise for long-settling runtimes (GC, scavenger, JVM).
8. **Termination** — target value, experiment count, or "plateau / diminishing returns / user interrupt."

Repeat the config back; get explicit confirmation before Phase 2.

### Phase 2 — Lab setup

1. `git checkout -b research/<slug>` from current HEAD.
2. Create `.lab/` at repo root.
3. `.lab/config.md` — all agreed parameters, baseline + best placeholders.
4. `.lab/results.tsv` — header: `experiment\tbranch\tparent\tcommit\tprimary\tsecondary\tstatus\tduration_s\tdescription`. Status: `keep|discard|crash|thought|keep*|interesting`.
5. `.lab/log.md`.
6. `.lab/parking-lot.md`.
7. `.lab/branches.md` — Branch, Forked from, Status, Experiments, Best metric, Notes.
8. Add `.lab/` and `run.log` to `.gitignore`.
9. Run experiment **#0 = baseline** (no changes). Record it. Fill baseline + best in config.
10. Begin.

### Phase 3 — Autonomous research

**THINK** — read `results.tsv`, last 5 `log.md` entries, `branches.md`, `parking-lot.md`, and in-scope source. Re-read discipline. Analyze, hypothesize, check convergence signals.

**TEST** — implement one logical change, commit, run the full measure chain, record raw values.

**REFLECT** — what confirmed, what surprised, what breaks the model. Update parking lot.

For every real experiment:
1. `git commit -m "experiment: <desc>"` before running.
2. Run the entire run chain (build + tests + measure). All must succeed.
3. Decide: keep / keep* (primary up, secondary regressed — log trade-off) / discard (reset --hard HEAD~1) / interesting / crash (reset, read last 50 lines of run.log; trivial→fix&rerun once, fundamental→move on, 3 crashes→rethink) / timeout (kill, log crash, reset; 2 in a row→reassess).
4. Append `results.tsv` row + `log.md` entry.

Log entry format:
```
## Experiment N — <title>
Branch / Type (thought|real) / Parent (#M) / Hypothesis / Changes / Result / Duration / Status / Insight
```

### Autonomy

Default: work autonomously, log instead of reporting. Consult the user only when (a) the only viable path needs files outside scope, or (b) all strategies, branches, and parking-lot ideas are exhausted.

### Branching

Fork when an approach diverges fundamentally or a branch stagnates. `git checkout <keep-commit>` → `git checkout -b research/<new-slug>` → register in `branches.md`. Consider all branches when thinking. Mark exhausted branches `closed`.

### Re-validation

Every 10 real experiments: re-run current HEAD, compare to recorded best. If regressed >2%, log drift and consider forking from best.

### Phase 4 — Wrap-up

On termination/interrupt: re-validate global best, write `.lab/summary.md` (total experiments, keeps/discards per branch, best vs baseline, top impactful changes, genealogy, key insights, failed approaches, remaining parking lot), checkout best branch/commit, report concisely.

## Convergence signals

| Signal | Action |
|--------|--------|
| 5+ discards in a row | Approach exhausted; pivot |
| Metric plateau (<0.5% over 5 keeps) | Try something radically different |
| Same code area modified 3+ times | Explore elsewhere |
| Results contradict theory | Model is wrong — rethink |
| 2+ timeouts in a row | Approach too expensive |
| Fighting the language/runtime to move the needle | Likely at the floor; consider stopping |

The last signal is the "stop before rewriting in another language" guardrail. If the only remaining wins require abandoning the implementation language or core dependencies the user declared in-scope, pause and report: we've reached the practical floor for this stack. Don't drift into a rewrite unless the user explicitly green-lights it.

## Hypothesis strategies (tools, not rails)

Ablation · Amplification (push what works) · Combination (merge wins across branches) · Inversion · Isolation (one variable) · Analogy · Simplification (remove complexity, preserve metric) · Scaling (order of magnitude) · Decomposition (split a big change) · Sweep (parameter across a range).

## Output contract

When reporting: **Metric** (baseline → best, % delta), **Changes** (the kept experiments and what each did), **Evidence** (the measurements, including at least one experiment that ruled out a credible alternative), **Limits** (what wasn't tested, assumptions remaining), **Next** (smallest action to go further, or "at practical floor").

## Resources

- `references/go-memory.md` — Go-specific measurement: VmHWM/VmRSS/smaps_rollup, GODEBUG=gctrace=1, runtime/pprof heap profiles, GOMEMLIMIT/debug.SetMemoryLimit, binary stripping, pmap. Load when optimizing a Go binary.
- `references/hypothesis-strategies.md` — elaborated strategy playbook with examples.
- `references/pr-template.md` — copy-paste PR body for each kept experiment. Surfaces hypothesis, falsifier, measured baseline-vs-new table, reproduction commands, test/behavior-preservation evidence, security impact, limits. Use it verbatim per PR; append the target repo's own required PR fields (e.g. PCI Security Impact) when present.
