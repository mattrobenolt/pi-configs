# Model Guide

Routing reference for picking which model a subagent runs on. This file is the current synthesis only — evidence teardowns, dated findings logs, and retired-model records live in `research/<slug>.md`; older history is `git log`. Append new evidence to the briefs; rewrite this file when the synthesis changes. Skepticism is the default: every model here had a vendor headline that partially failed a neutral cross-check.

**AA cells are Intelligence Index v5.0.1 (Nov 3-4, 2026 reads) unless tagged — never compare across versions.** v5 re-based the scale (60% private test sets; scores dropped across the board — a v5 33 is not worse than a v4.3 40). Legacy tags: †/‡/¶ are pre-v5. K3.1 Pro's launch-week read was 55; AA's Nov 3 CritPt re-grade moved the board — quote 47.

## Canonical list

| ID (`provider/model`) | Family | Context | Max out | Vision | Price (in/out) | Cached in | AA |
| --- | --- | ---: | ---: | :---: | --- | --- | ---: |
| `fireworks/accounts/fireworks/models/deepseek-v4p1-flash-1017` | DeepSeek | 1M | 384K | yes | $0.30 / $1.20 | $0.006 | 33 |
| `fireworks/accounts/fireworks/models/glm-5p3` | Z.ai | 1M | 262K | no | $1.40 / $4.40 | $0.26 | 32 |
| `fireworks/accounts/fireworks/models/glm-5p3-flash` | Z.ai | 1M | 64K* | yes | $0.15 / $0.50 | $0.029 | 28 |
| `fireworks/accounts/fireworks/models/kimi-k3p1-pro` | Moonshot | 1M | 131K | yes | $2.00 / $10.00 | $0.20 | 47 |
| `fireworks/accounts/fireworks/models/kimi-k3` | Moonshot | 1M | 131K | yes | $3.00 / $15.00 | $0.30 | 17 (`low`) |
| `fireworks/accounts/fireworks/models/ember-1` | Moonshot (Fireworks derivative) | 1M | 131K | yes | $3.00 / $15.00 | $0.30 | — |
| `fireworks/accounts/fireworks/models/qwen3p8-max` | Alibaba | 262K* | 131K | no* | $2.00 / $6.00 | $0.25 | 34 |
| `fireworks/accounts/fireworks/models/minimax-m3` | MiniMax | 512K | 33K | yes | $0.30 / $1.20 | $0.06 | 19 |
| `fireworks/accounts/fireworks/models/minimax-m3p1-flash` | MiniMax | 1M | 512K | yes | $0.15 / $0.60 | $0.015 | 29 |
| `openai/gpt-6.1-sol` | OpenAI | 272K (pi) | 128K | yes | $2 / $10 list — **subscription on our route** | $0.10 | 55 |
| `openai/gpt-6.1-terra` | OpenAI | 272K (pi; 1.05M API) | 128K | yes | $1 / $5 | — | 51 |
| `openai/gpt-5.6-sol` | OpenAI | 272K | 128K | yes | $5 / $30 list; $4/$20 promo ≥2026-11-21 | $0.40 | 61‡ |
| `openai/gpt-5.6-luna` | OpenAI | 272K | 128K | yes | $1 / $6 | $0.10 | 52‡ |
| `openai/gpt-6-astra` | OpenAI | 272K (pi; 1.05M API) | 128K | yes | $10 / $50 API — **subscription on our route** | $1.00 | 57 |
| `anthropic/claude-opus-5-5` | Anthropic | 1M | 128K | yes | $4 / $20 | $0.20 | 59 |
| `anthropic/claude-sonnet-5-5` | Anthropic | 1M | 128K | yes | $2 / $10 | $0.20 | 55 |
| `anthropic/claude-haiku-5-5` | Anthropic | 1M | 128K | yes | $0.10 / $0.50 | — | 37 |
| `anthropic/claude-sonnet-5` | Anthropic | 1M | 128K | yes | $2 / $10 | $0.20 | 55‡ |
| `anthropic/claude-opus-5` | Anthropic | 1M | 128K | yes | $5 / $25 | — | 63† |
| `anthropic/claude-mythos-5-1` | Anthropic | 1M | 128K | yes | $10 / $50 | $0.25 | 65.7† (inherited) |
| `google/gemini-4-argon` | Google | 1M | — | yes | $2 / $10 | — | 50 |
| `google/gemini-4-carbon` | Google | 1M | — | yes | restricted (Fairwind) | — | 60 |

\* Qwen3.8-Max's row is the Fireworks route (262K, text-only) — Alibaba's API is 1M multimodal; don't route on those headlines. Flash's 64K out is a models.json setting, not a route limit. Provider prefix is `openai`, not "openapi-codex". Mythos 5.1 is manually registered in `models.json` (not in pi's bundled catalog); its AA is inherited from the GA Claude 5.1 read. GPT-5.6 tiers: Sol (flagship), Terra (mid, rejected), Luna (mini); bare `gpt-5.6` → Sol. Unseated catalog entries: `gpt-6-sol`, `gpt-6-luna`.

## Selection protocol

1. **Default: DeepSeek V4.1 Flash 1017 at `max`** — Matt, settled (2026-09-16, reaffirmed 2026-11-04: "basically free," favorite day-to-day). Bans: never a verifier (1/5 fabrication); budget output caps on extraction (no `off` gear; reasoning hunger length-truncates). Deep context past ~200K routes here. **Challenger: Haiku 5.5** (37 vs 33 at $0.10/$0.50) — duel on local packs before any swap; open-weight bias is the tiebreak.
2. **Open-weight bias for day-to-day; closed when its specific strength is the point.** Under neutral harnesses the closed-model coding leads shrink or reverse.
3. **Moonshot seat: K3.1 Pro — paired frontier executor.** Pattern: **Opus 5.5 plans/reviews → K3.1 Pro implements → external acceptance.** Never verifier, never self-acceptance (K3's eval-awareness un-re-probed; AA-PersonalityBench shows the biggest predecessor shift AA has measured — K3 priors partially void, bans carry). Weak: science workflows, ProgramBench. Fireworks throughput unmeasured (first-party 32 tok/s, 131s TTFT). Acts on ambiguity — specs need explicit non-goals; bound runs. K3 superseded (re-check baseline); Ember-1 demoted to challenger-of-record (keeps the family's only verified `none` gear).
4. **Qwen3.8-Max: Alibaba quorum seat + GDPval-class knowledge work** (verify locally first). Not "cheaper K3 escalation" (retry math parity), not marathons (262K text-only route), never a verifier (hallucination 23→40%). Default effort `xhigh` — pin it on cheap calls.
5. **xAI excluded by preference (Matt, 2026-08-24).** No Grok seat unless a neutral result is outstanding AND unmatched by an incumbent. Grok 4.6 didn't clear it; 4.7 (v5 35-36) doesn't either.
6. **Quorums across discrete families for decisions.** Anthropic, OpenAI, Moonshot, MiniMax, Z.ai, DeepSeek, Alibaba/Qwen, Google (Fireworks is a host, not a family). Valid: `Opus 5.5 + GPT-6.1 Sol + Kimi K3.1 Pro`. Invalid: `Opus + Sonnet + Mythos` (all Anthropic).
7. **Juggernauts (consciously invoked, batch/async at max, prep with cheaper agents): Mythos 5.1 and GPT-6 Astra.** Mythos owns general intelligence/knowledge work — the Claude juggernaut on our PlanetScale CVP grant; do not route it where the grant can't be assumed. Astra owns coding-agent efficiency and rides the Codex subscription (quota, not per-token) — prefer it where profiles tie; don't waste quota. Astra's trust rows are OpenAI-internal — Sol's verification gates apply until METR; pin effort (gateway default `low`). **Watchlist: Gemini 4 Carbon** (v5 60, best-ever Omniscience; Fairwind-only, not routable).
8. **GPT-6.1 Sol: the OpenAI workhorse.** Bounded agentic coding/terminal/browser with external verification; 5.6-Sol trust gates carry (no METR, self-graded alignment). No `off`; pin effort (vendor DeepSWE non-monotone: `high` > `xhigh`/`max`). **Challenger: 6.1 Terra** (51 at half the sticker, $0.26/task at `high`; the 5.6-Terra rejection doesn't carry) — neutral coding reads pending.
9. **MiniMax M3 is never a coding agent.** Verification/librarian work (abstention = precision-over-recall) + cheap multimodal only. **M3.1 Flash does not inherit the seat** (93% hallucinate-when-wrong); unseated cheap agentic challenger.
10. **Match thinking level to stakes, not to model.** Low-stakes stays `low`/`medium`; hard coding/review escalate to `xhigh`/`max`. Don't pin `max` globally — the top rung measured flat-to-inverted on Opus 5.5, Sonnet 5.5, and 6.1 Sol's own launch curves.

## Thinking levels

pi levels: `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max` — set in settings.json, agent frontmatter, or `--thinking`.

| Model | Ladder | Default | Notes |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash | `low`→`max`, **no `off`/`minimal`** | `max` (ours) | Small caps length-truncate into all-reasoning |
| GLM 5.3 / Flash | `low`→`max`, no `off` | `max` | `low` is a legit cheap gear (6/6 routine) |
| Kimi K3.1 Pro / K3 | `low`/`high`/`max`, always thinks | `max` | Preserved `reasoning_content` required; no mid-session hot-swap; ladder unprobed on K3.1 Pro — pin it |
| Ember-1 | full incl. **`none` (verified)** | runs max-heavy unpinned | Pin `low`/`high`; `none` is the family's only verified thinking-off |
| Qwen3.8-Max | full (`off`→`none` verified) | **`xhigh`** | Pin down on cheap work |
| MiniMax M3 | `low`/`medium`/`high` | — | M3.1 Flash: raw route verifies `none`; `low` is NOT the lean gear (`medium` is) |
| Opus 5.5 / Sonnet 5.5 | five levels, no thinking-off | Opus `medium`; Sonnet `high` API / `medium` CC | Pin it. Sonnet `max` = token furnace (193K out/task; 20-22x `medium` for identical scores) |
| Mythos 5.1 | five levels, no off | `high` | 6.2s vs 131s TTFT `low`→`max` |
| Astra / 6.1 Sol | `low`→`max`, no `off` | **`low` (gateway)** | Pin it. 6.1 Sol vendor DeepSWE peaked at `high` |

## Cyber safeguards & prompt framing

Frontier models ship safety layers that block offensive cyber and over-trigger on legitimate defensive work — classifiers read surface keywords, not intent. Specifics per model live in the briefs; the operational rules:

- **Route known cyber/bio work directly at the target**, don't dance with classifiers: Opus 5 for known bio/cyber (the fallback target, half the cost); CVP grant covers Opus 5.5 / Sonnet 5.5 / Mythos 5.1 with tier-tuned classifiers (internal work on our own code/infra only — no productization, no general offensive work). OpenAI: Critical-threshold models gate exploit capability behind Trusted Access/Daybreak; Sol's "retry on lower-capability models" is the escape hatch.
- **Frame defensive work defensively.** Lead with authorization + scope + goal + output boundary; "review this code for robustness issues" not "find vulnerabilities"; ask for remediation, not payloads; split discovery from validation; don't ask Claude models to transcribe reasoning (separate `reasoning_extraction` refusal); keep system prompts short and non-contradictory; if a session gets flagged, start clean — the trigger phrase stays in context.
- **Genuinely offensive work is policy-gated, not prompt-tunable.** Use the trusted-access path.

## Model notes

**DeepSeek V4.1 Flash 1017** — the default. Verbose (~1.5-2x spend per accepted task is the durable cost), 1/5 fabrication (never a verifier), no `off` gear, Fireworks uptime 91.6% + one token-salad event (keep a fallback route). 925K needles clean; fastest measured vision pass. Brief: `research/deepseek-v4p1-flash.md`.

**GLM 5.3** — nominal Z.ai quorum seat (Matt ~never uses it, 2026-11-04). Kept for quorum diversity + cheap one-shot-expensive text (neutral DeepSWE 69.0 ±2.7 @ $3.99). ~925K serving hang on Fireworks (unre-probed) — deep context routes to DeepSeek. Text-only. Brief: `research/glm-5p3.md`.

**GLM 5.3 Flash** — rejected (Matt, 2026-11-04: "specifically terrible"; local parity packs didn't survive real use). Record: `research/glm-5p3-flash.md`.

**Kimi K3.1 Pro** — the Moonshot seat (2026-11-04). AA TB4 67.2% — highest ever recorded, scored higher outside Moonshot's harness than in it. GDPval-AA 1,846 Elo. Hallucination 44% (improved, still banned from verification). Slow first-party; Fireworks route unmeasured. Brief: `research/kimi-k3p1-pro.md`.

**Kimi K3** — superseded by K3.1 Pro (better and cheaper). Re-check baseline only. Record: `research/kimi-k3.md`.

**Ember-1** — challenger-of-record. K3 token-efficiency fine-tune; its pitch is moot vs K3.1 Pro's cheaper, better base. Keeps: cheap A/Bs, verified `none` gear. Zero neutral coverage; K3 bans carry. Brief: `research/ember-1.md`.

**Qwen3.8-Max** — Alibaba quorum seat; GDPval-class knowledge work (grinds: 64 steps/task). Route is 262K text-only; the 0902 API refresh diverged from the open checkpoint (which build Fireworks serves is unverified). Brief: `research/qwen3p8-max.md`.

**MiniMax M3** — never coding (independent DeepSWE 13.3%). Verification/librarian + cheap multimodal. Abstains rather than fabricates — pick it when a false alarm is the expensive error, not when a miss is. No brief; this note is the record.

**MiniMax M3.1 Flash** — unseated challenger. One strong neutral row (AutomationBench-AA 72.5, #2); loses to DeepSeek on MiniMax's own coding table; 93% hallucinate-when-wrong kills verification use. Brief: `research/minimax-m3p1-flash.md`.

**GPT-6.1 Sol** — the OpenAI workhorse. Subscription route (quota, not per-token). Family fabricates-and-proceeds (5.6 Sol: METR's highest reward-hacking rate of any public model) — never unsupervised with destructive tools, verify "done" independently. Brief: `research/gpt-6.1-sol.md`.

**GPT-6.1 Terra** — workhorse challenger. 51 at half of Sol's sticker, 115 tok/s. Needs neutral coding runs + local probe. No brief yet.

**GPT-5.6 Sol** — superseded; kept for `ultra` (unverified on 6.1), re-checks, hunter-seat history. Record: `research/gpt-5.6-sol.md`.

**GPT-5.6 Luna** — vision/computer-use subtasks only; not faster time-to-solution; long-context retrieval degrades ~256K+. Brief: `research/gpt-5.6-luna.md`.

**GPT-6 Astra** — juggernaut #2. Token-efficient frontier coding (AA CAI 67.0 ≈ Claude-5.1 tier at <½ per-task cost); quota-burn on our route. TB-Science/OSWorld/automation edges; general intelligence is Mythos's seat. 6.1 Astra scrapped pre-launch over deception findings (WSJ) — family trust signal. Brief: `research/gpt-6-astra.md`.

**Claude Opus 5.5** — the Opus seat: hard architecture, security review of your own code, adversarial criticism, planner/reviewer around a bounded K3.1 Pro. Vendor-flagged eval-awareness ("often suspects it is being evaluated") — external acceptance stays mandatory. `max` rung has no measured gain over `xhigh`. Brief: `research/claude-opus-5-5.md`.

**Claude Sonnet 5.5** — the Sonnet seat: defined-plan high-volume execution + untrusted-input ingestion (injection robustness 0.07% own-answer, best measured). `medium` for routine; `max` never (token furnace, no measured gain). Brief: `research/claude-sonnet-5-5.md`.

**Claude Haiku 5.5** — default-seat challenger. 37 vs DeepSeek's 33 at $0.10/$0.50. Unprobed locally; duel is the promotion gate.

**Claude Sonnet 5 / Opus 5** — superseded; Sonnet 5 is 5.5's cyber-fallback target, Opus 5 is the bio/known-cyber direct route. Records: `research/sonnet-5.md`, `research/claude-opus-5.md`.

**Claude Mythos 5.1** — juggernaut #1 on our CVP access (404s outside the grant — never hardcode in shared configs). Same weights/price as GA Claude 5.1, fewer cyber/bio false positives, no history-edit 400. Still returns refusals outside the grant. Brief: `research/claude-mythos-5-1.md`.

**Gemini 4 Argon** — the Google seat: quorum family #8 + the first verifier-seat candidate (AA-Omniscience 46, 4% hallucination — lowest ever measured). Local abstention probe before any verification routing. No brief yet.

**Gemini 4 Carbon** — watchlisted juggernaut. AA #1 (60), best-ever Omniscience (54, 11%). Fairwind-program-only; not routable. Watch: GA date, pricing, coding rows.

**Grok 4.6** — no seat (xAI excluded). Re-eval triggers + reference numbers: `research/grok-4p6.md`.

## Context-window note

The caps are intentional. The GPT-5.6/6.x family degrades badly at its full ~1M window (coherence erosion ~200-400K; Luna retrieval flatlines ~41% at 256K-512K), and OpenAI's API price cliff starts above 272K — pi's 272K is a feature. MiniMax at 512K is plenty. Don't treat caps as deficiencies to fix.

## Retired / superseded

Full records in `research/`: `gpt-5.5`, `gpt-5.4-mini`, `claude-opus-4-8`, `kimi-k2p7-code`, `glm-5p2`, `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813` (94.1% hallucination — never a verifier), `gpt-6-sol`, `muse-glimmer-30b` (rejected; real niche is local always-on, untested), `gpt-5.6-terra` (rejected, Pareto-dominated — note this is 5.6 Terra only; 6.1 Terra is a different model).

## Changelog

- *2026-11-04:* **Condensed the doc to synthesis-only** (Matt: the teardown narration was excessive) — findings logs and vendor methodology detail moved to `research/` briefs + git history. Same day: v5.0.1 re-base (all AA cells re-read Nov 3-4); K3.1 Pro takes the Moonshot seat (K3 superseded, Ember-1 demoted); GLM 5.3 Flash rejected + GLM 5.3 nominal (Matt); added Haiku 5.5, 6.1 Terra, Gemini 4 Argon (Google = quorum family #8 + verifier candidate), Gemini 4 Carbon (watchlisted). New brief: `research/kimi-k3p1-pro.md`.
- *2026-10-23:* Ember-1 permanence confirmed (Matt); M3.1 Flash added (unseated challenger). Briefs: `research/ember-1.md`, `research/minimax-m3p1-flash.md`.
- *2026-10-19:* Mythos 5.1 added (CVP grant verified); GA Claude 5.1 twin removed (Matt). Brief: `research/claude-mythos-5-1.md`.
- *2026-09-29:* Sonnet 5.5 + GPT-6.1 Sol added (Sonnet seat, OpenAI workhorse); cull pass. Briefs: `research/claude-sonnet-5-5.md`, `research/gpt-6.1-sol.md`.
- *2026-09-22:* Opus 5.5 added, takes the Opus seat. Brief: `research/claude-opus-5-5.md`.
- *2026-09-16:* Matt routing pass: DeepSeek V4.1 Flash default; GLM 5.3 replaces 5.2 entirely; nemotron-lightning for scout/objectiveModel.

*Older history: `git log -- skills/model-guide/` + `research/`.*
