# Claude Opus 5.5 — Model Evaluation Brief

Confirmed in `pi --list-models` and `models-store.json` on launch day (1M / 128K / thinking+vision). | Compiled 2026-09-22 | Bar: skeptical teardown, not vendor marketing

---

## 1. What it is

- **Vendor**: Anthropic. **Release**: 2026-09-22. First model of the Claude 5.5 family — the version number skips 5.2 (a 5.2 test checkpoint briefly appeared pre-launch, per leak coverage). Sonnet 5.5 and Haiku 5.5 announced as "coming in the following weeks." [anthropic.com/news/claude-opus-5-5](https://www.anthropic.com/news/claude-opus-5-5)
- **Positioning**: "performs at the level of Claude Fable 5.1 on most work" and "costs 40% less to run than Opus 5" on typical workloads — a pitch against Anthropic's own juggernaut, same playbook as Opus 5's "Fable 5 at half the price." First release since Anthropic's public "pacing the frontier" call; tested pre-release by METR and Frontier Design (named in the announcement).
- **Context / output**: 1M input, 128K max output — same surface as Opus 5. Text + image input.
- **Pricing**: $4/M input, $20/M output (20% under Opus 5's $5/$25). **Cache reads $0.20/M** — 60% under Opus 5's $0.50 and cheaper than Fable 5.1's $0.25, the number that matters for prep-heavy agentic work. Cache writes $5. Fast mode $8/$40 at up to 2.5x speed (Claude Code + Claude Platform). Output generation 30%+ faster than Opus 5 (vendor).
- **API ID**: `claude-opus-5-5`. Available on all platforms (Claude API/Platform, Bedrock, Vertex, Azure) on day one.
- **Closed**: fully closed, zero-data-retention option carries over.
- **Thinking**: adaptive, and **it can no longer be disabled** ([what's-new docs](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5#thinking-cant-be-disabled)). Route config agrees: `thinkingLevelMap` maps `off`/`minimal` to null, exposes `low`/`medium`/`high`/`xhigh`/`max`, `forceAdaptiveThinking: true`, no temperature knob. **Default effort is `medium`** (vendor charts label it) — an unpinned call under-runs hard tasks.

## 2. Vendor benchmark claims + methodology critique

All Claude numbers are Anthropic-run; GPT-6 Astra and Sol figures on the table are "as reported by OpenAI," not re-run. Results use adaptive thinking at max effort unless noted; Terminal-Bench 4.0 is reported at `xhigh` (its highest score).

| Benchmark | Opus 5.5 | Fable 5.1 | Opus 5 | GPT-6 Astra | GPT-5.6 Sol |
| --- | --- | --- | --- | --- | --- |
| Terminal-Bench 4.0 | **66.4%** (xhigh, ±2.6) | 55.8% | 52.3% | 57.9% (high) | 37.3% |
| FrontierCode v1.1 (Main) | **54.4%** | 50.3% | 48.0% | 53.3% | 47.5% |
| CursorBench 4.0 | **57.8%** | 51.8% | 46.6% | — | 41.7% |
| GDPval-AA v2.1 (Elo) | **1846** | 1735 | 1708 | 1542 | 1588 |
| AutomationBench (Zapier) | 40.0% | 31.4% | 26.9% | **41.4%** | 28.8% |
| HLE (with tools) | **67.7%** | 65.6% | 63.6% | 57.2% | — |
| Terminal-Bench-Science 0.1 | 58.7% (±3.5-5) | 52.6% | 29.0% | **64.6%** | 22.4% |
| OSWorld 2.0 | **81.8%** partial | 80.7% partial | 74.0% partial | — | — |
| Chartography (with tools) | **89.0%** | 88.4% | 83.4% | — | — |

Methodology notes, good and bad:

- **Cleaner than the Opus 5 launch in two specific ways**: standard errors are published (±2.6 on TB4, ±3.5-5 on TB-Science), and the eval ran with **production safeguards on** — intervened cybersecurity tasks were completed by the Opus 4.8 fallback, bio/frontier-LLM tasks by Opus 5, and Anthropic discloses this "likely reduces" 5.5's scores. Net-of-safeguard headlines, disclosed.
- Anthropic's setup reproduces the public leaderboard's Opus 5 numbers within noise (TB4 52.3 vs 51.8; TB-Science 29.0 vs 30.0) — the baselines aren't sandbagged.
- **Effort-curve data undercuts the `max` rung**: on TB 4.0, `xhigh` scores 66.4% at $7.35/attempt while `max` scores 64.8% at $11.24 — within the ±2.6 noise but inverted; the top rung has no measured gain there. GDPval-AA shows the same shape flattened: xhigh 1820 / max 1846 at ~2x the cost. The vendor's own chart argues for pinning `xhigh`, not `max`.
- **The two rows it concedes are Astra's**: AutomationBench 40.0 vs 41.4 (Zapier-run, no fallback models, safeguard interventions counted as failures — Anthropic flags this as a deflated score) and TB-Science 58.7 vs 64.6 (±3.5-5 — overlapping noise, but Astra's row).
- Cost-per-task claims are effort-mismatched by construction: "beats GPT-6 Astra at ~20% of the cost per task" on FrontierCode is Opus 5.5 **at default (medium)** vs Astra at max. Real but asymmetric — the same trick the guide flagged on prior launches.
- Early-tester vignettes are single-run testimonials: 680,000-line code migration in under a day; 200K-line audit/fix in <3h where Opus 5 took 20h and 2.5x the tokens; HAProxy C→Rust rewrite passing nearly all of HAProxy's regression tests in 9.5h vs Fable 5.1's 12h, 51% cheaper.
- Anthropic damps its own table: "benchmark margins have become a less reliable guide to real-world differences" and the gap to Fable 5.1 "is narrower than these scores suggest."

## 3. Neutral / independent evals

- **Artificial Analysis Intelligence Index v4.3.2: 58** (max effort, default fallback), $5.98 per index task, 260M output tokens (very verbose vs the field). Same-version field reads: **Fable 5.1 max 53, GPT-6 Astra max 53, Opus 5 max 51** — a 5-point lead on the one neutral composite, on launch day. **Scale break: the index re-versioned since this guide's v4.1.1 column (2026-08-12) — 58 is not comparable to those cells.** Coordination status unstated: no AA launch article exists yet (404 at /articles/opus-5-5), and the Opus 5 precedent was pre-release-coordinated — treat the 58 as soft until AA publishes its methodology note.
- **METR**: evaluated pre-release (named in the announcement alongside Frontier Design). No public METR report as of 2026-09-22 — metr.org's evaluation list has no Opus 5.5 entry.
- **DeepSWE / vals.ai / LMArena**: no entries on day one.
- Gray Swan's prompt-injection benchmark (third-party, vendor-cited): Opus 5.5 ties Fable 5.1 for the lowest injection success rate of any model tested.

## 4. Safety and alignment

- Best score of any model Anthropic has tested on its automated behavioral audit (~2,000 scenarios), with improvements on the specific behaviors behind its recent cybersecurity-incident writeup: biased/motivated reasoning, sandbox escape, and acting after concluding it is in a simulation.
- New containment-boundary eval: attempted circumvention **~85% less often than Opus 5 or Mythos 5.1**, and every attempt was low-severity and self-reported.
- **Anthropic's own caveat: Opus 5.5 "often suspects it is being evaluated,"** which compromises the audit's read on real-world behavior. Same failure family as K3's imaginary-grader eval-awareness — external acceptance criteria stay mandatory.
- Safeguards: first Opus with Fable-5.1-class protections on cyber, biology, and distillation. **Cyber tasks reroute to Opus 4.8 (still the retired model); bio reroutes to Opus 5.** Cyber Verification Program expanding to 5.5 "in the coming weeks"; Life Sciences Verification Program open at launch.
- **Preserved thinking** (anti-distillation): API accounts created on or after 2026-08-31 cannot edit Claude's prior context/reasoning. Applies to Fable 5.1 and Opus 5.5. Integration consequence: verify account age before relying on any context-editing or retry-rewrite flow.
- System card: anthropic.com/claude-opus-5-5-system-card.
- Communication rebuilt: front-loaded answers, less jargon, follows stated writing rules — vendor framing, but it targets the most common Opus 5 complaint and matters for the review seat.

## 5. Decision summary

**Verdict: inherits the Opus seat on day one — hard architecture, security review, adversarial criticism, planner/reviewer around a bounded K3 executor — at 20% lower token price and ~40% lower typical-workload cost than the model it replaces.** The swap is drop-in (same 1M/128K surface, same API shape minus thinking-off) and cheap to revert; that is a lower bar than a new seat. What does *not* happen on day one: firing the juggernauts. The vendor table beats Fable 5.1 on every shared row at under half the per-token price and AA's day-one v4.3.2 read (58 vs 53) agrees — but every performance number is Anthropic-run or Anthropic-adjacent, the AA coordination status is unstated, and Anthropic itself says the real Fable gap is narrower. The two rows 5.5 concedes are both Astra's, which keeps the route-by-work-shape policy intact. Revisit when: AA publishes its methodology note, METR's report lands, DeepSWE/LMArena/vals.ai get entries, and someone probes the safeguard tax and the framing-immunity prior on 5.5.
