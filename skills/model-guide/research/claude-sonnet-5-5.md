# Claude Sonnet 5.5 — Critical Model Evaluation Brief

Confirmed pi ID: `anthropic/claude-sonnet-5-5` (1M context, 128K max output, thinking + vision — `pi --list-models` 2026-09-29; models-store.json agrees)
Prepared: 2026-09-29 · Status: launch-day+1 teardown; one neutral composite read (AA), one independent hands-on; no METR/DeepSWE-leaderboard/vals yet

---

## 1. Routing verdict

Sonnet 5.5 **inherits the Sonnet seat on launch day** (defined-plan agentic execution + untrusted-input ingestion + vision/computer-use) — same-family drop-in at the identical $2/$10 sticker, better on every vendor row, trivially reversible. Same bar Opus 5.5 cleared for the Opus seat on 2026-09-22.

- The old "not cheaper than Opus per task" caveat dies with Sonnet 5 — it measured Sonnet 5's tokenizer inflation + 3-6x turn counts against Opus **4.8**. 5.5's comparison is Opus 5.5 at half the per-token price, and the vendor claims ~30% fewer tokens per task than Sonnet 5.
- The new cost trap is effort, not turns: AA measured **~193K output tokens per index task at `max` — the most they have ever measured, ~60% more than Opus 5.5, ~7x Astra**. Independent hands-on (ComputingForGeeks, launch day): `max` spent 20-22x `medium`'s tokens/money for identical scores on routine infra tasks; `medium` matched `high` at half the tokens; `low` was the only failing gear (0/3 K8s deploys). **Pin `medium` for routine (Claude Code's default); the API default `high` roughly doubled output tokens with no measured gain on single-file generation.**
- Injection robustness — the seat's reason to exist — strengthens: Gray Swan Shade 3.01% overall success vs Sonnet 5's 19.47%; Sonnet 5.5's own answers compromised 0.07% (4/5,901). Caveat: 25% of attacked requests rerouted to the Sonnet 5 fallback, and 12.01% of *those* were compromised — the number depends on the fallback.
- First Sonnet with flagship-class cyber safeguards: system card says expect increased refusals "even on benign cybersecurity-related tasks"; blocked requests fall back to **Sonnet 5** (automatic in Anthropic apps, opt-in on the API). Route known cyber work directly at the target, same as Fable/Opus 5.5 policy.
- Thinking-off is gone: `off`/`minimal` unmapped (models-store.json), five levels `low`→`max`. The floor is `between_tools` (no up-front thinking, works at `high` or below) — a migration item for anything that ran Sonnet 5 with thinking off.

## 2. What it is

- Anthropic, released **2026-09-28** — second model of the Claude 5.5 family (Opus 5.5 was 09-22; Haiku 5.5 "coming weeks"). GA, not preview; retirement not sooner than 2027-09-28.
- $2/$10 (Sonnet 5's intro price, made permanent in August — the guide's "$3/$15 after 2026-08-31" note was wrong), cache reads $0.20, writes $2.50 (5m) / $4 (1h), batch 50%, **no fast mode**, US-only inference 1.1x. Same tokenizer as Sonnet 5.
- 1M context native (no beta header), 128K out (300K via Batches beta header), cutoff June 2026, minimum cacheable prompt 512 tokens (down from 1,024).
- Effort `low`→`max`; default `high` on the API, `medium` in Claude Code/apps. Adaptive thinking always on; `between_tools` is the lowest setting. Five breaking changes from Sonnet 5 (forced tool use 400s among them — the Fable 5.1 edges).
- Route probe 2026-09-29: answers on `anthropic/claude-sonnet-5-5`, ~10s wall at `low` for a trivial prompt (pi startup included).

## 3. Vendor claims and methodology critique

All Anthropic-run, day one. The launch table's one "beats Opus 5.5" row is effort-mismatched (P.K. Sharma's teardown did the arithmetic):

- **Terminal-Bench 4.0: 70.6% is Sonnet 5.5 at `max` ($12.54/task); Opus 5.5's 66.4% is at `xhigh` ($7.35).** The cheaper model's winning run costs 71% more than the flagship run it beats. At matched defaults (`medium`): 28.8% vs Opus's 57.6% — not close. At matched cost, Opus leads TB4 and CursorBench; Sonnet's distinctiveness is the cheap end, where Opus has no point on the curve.
- **FrontierCode 1.1 inverts at the top: 52.1% @`xhigh` vs 46.2% @`max`** — `max` ran extra review subagents that strayed out of scope. Second Anthropic model in a week whose top rung buys nothing (Opus 5.5's TB4 did the same).
- CursorBench 4.0 55.5% is a `max` score (series: 39.2 medium / 47.8 high / 53.1 xhigh); the effort curve is real on long agentic tasks — the "just use medium" read has a ceiling.
- GDPval-AA v2.1 1844 (2 behind Opus 5.5) and AA-Briefcase 1811 are AA-run benchmarks — semi-neutral rows inside a vendor table.
- System-card-only rows: SWE-bench Pro 81.3% (Opus 5.5: 89.9% — conceding the row in the card, not the launch page), SWE-bench Multilingual 90.3%, AutomationBench 44.7% (edges Opus 5.5's 42.5%), FrontierSWE v2 61.9% (vs Astra 65.5%).
- Sonnet 5's TB4 10.3% baseline is absurdly low (rebuilt benchmark, timeout-sensitive) — the "7x jump" says as much about the old model as the new one.
- Behavioral audit: improves/matches Sonnet 5 on most alignment measures (vendor-run). Eval-awareness family caveat (Opus 5.5's "often suspects it is being evaluated") unprobed on 5.5 — assume it carries.

## 4. Neutral evals

- **AA Intelligence Index 56 at `max`** (day-one read, current index version — v4.3.2-era; same-scale field: Opus 5.5 58, Fable 5.1 53, Astra 53, GPT-6.1 Sol 52). Second-highest on the index at launch. **Caveat: AA ran a pre-release build with a structured-outputs bug (fixed for launch); a rerun may move it.**
- AA's own TB4.0 run: **64% — ahead of Opus 5.5 and GPT-6 Astra (60%)** on their harness.
- AA-Omniscience: 54% accuracy vs Opus 5.5's 66%, hallucination 47% vs 59% — less accurate, guesses less. Not a verifier seat either way.
- ComputingForGeeks (independent, launch day, real linters + real k3s cluster): `medium` was the only gear that was cheap, fast, and correct at once; Claude Code run $0.057/12s per task vs Sonnet 5's $0.157/48s. n=1 shop, small task set — directional, not definitive.
- Gray Swan Shade (third-party, vendor-cited): prompt-injection numbers above. Malicious-refusal rates moved slightly *down* (85.2% vs 87.9% on Claude Code prompts) without production safeguards.
- No DeepSWE leaderboard entry, no vals.ai, no LMArena, no METR as of 2026-09-29.

## 5. Pros / Cons / When / When not

**Pros.** Same price as the model it replaces with large measured gains (TB4 10.3→70.6, Chartography 15.6→61.6, GDPval +395 Elo); best-measured injection robustness in the guide (0.07% own-answer); ~2 Elo behind Opus 5.5 on GDPval at half the per-token price; 30%+ faster generation; `medium` gear is the measured sweet spot for routine work.

**Cons.** `max` is a token furnace with no measured gain (193K out/task on AA's index; 20-22x `medium` cost for identical scores in the independent run); FrontierCode inverts at `max`; cyber safeguards now fire on a Sonnet (benign-cyber refusals, Sonnet 5 fallback); thinking-off gone (`between_tools` floor); day-one evidence is vendor + one AA read with a known-buggy build; eval-awareness family prior unprobed.

**When to use.** Everything the Sonnet seat owned: defined-plan high-volume agentic execution, agent loops ingesting untrusted input (the injection numbers are the citable differentiator), vision/computer-use, polished docs/slides/spreadsheets (vendor-emphasized, unverified locally). At `medium` for routine; `high`/`xhigh` for long agentic tasks where the CursorBench effort curve is real.

**When not to use.** `max` on anything routine (20x cost, no gain); `low` on infrastructure/code that must deploy (0/3 in the independent run); known cyber/red-team-shaped work (safeguards + Sonnet 5 fallback — route directly); verifier/self-acceptance (family eval-awareness prior, 47% hallucination); open-ended judgment work (Opus 5.5's seat — at matched cost Opus still leads the hard rows).

## 6. Findings log

- *2026-09-29:* Added launch-day+1. Route confirmed in `pi --list-models` + models-store.json (1M/128K/thinking+vision; $2/$10; cacheRead $0.20; `off`/`minimal` unmapped; forceAdaptiveThinking). Live probe: answers, ~10s wall at `low`. Seat: inherits Sonnet 5's (execution + untrusted-input + vision) — drop-in, same price, reversible. Sonnet 5 superseded; kept as 5.5's cyber-fallback target. Key operational findings: `max`-effort token hunger (AA 193K/task; independent 20-22x `medium` for parity), API default `high` vs Claude Code `medium` (pin it), FrontierCode top-rung inversion, cyber safeguards + fallback-to-Sonnet-5, injection robustness 0.07% own-answer. Watch: AA rerun on the fixed build, DeepSWE/vals/METR entries, safeguard false-positive rate in the field, Haiku 5.5.
