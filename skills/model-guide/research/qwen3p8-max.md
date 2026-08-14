# Qwen3.8-Max — evidence brief

Status: draft, 2026-08-12. pi route: `fireworks/accounts/fireworks/models/qwen3p8-max`.
**Route ≠ model here.** Fireworks serves it at 262K context, text-only. The native Alibaba
API is 1M context with image+video input. Every multimodal/long-context headline below is
the Alibaba deployment, not ours.

## What it is

Alibaba's flagship, GA 2026-08-03 (previewed 2026-07-19 at WAIC with no benchmark table —
the "second only to Fable 5" slogan ran for fifteen days before any checkable number
existed). 2.4T-total / ~95B-active sparse MoE on the Qwen3.5 architecture; the claimed
mechanism for the generational jump is RL-environment scaling (internal score index peaks
~4,000 environments). Native deployment: 1M context, 131K max output, up to 262K reasoning
tokens, text/image/video in, text out. `reasoning_effort` low/medium/xhigh, **default
xhigh**; `preserve_thinking` on by default. $2.00/$6.00 per 1M, implicit cache hit $0.25
(10% of input), explicit cache $2.50 write / $0.17 read — **flat rate across the full 1M
window** (no tiered context pricing; unusual vs Gemini 3.1 Pro / Sol).

**Open weights: promised, not shipped.** Alibaba committed to weights for Qwen3.8-Max and a
new Qwen3.8-27B "the week of August 10" (HF + ModelScope). As of 2026-08-11/12 neither
repository exists and no license has been named; AA classifies the model proprietary.
Precedent is Apache-2.0 (Qwen3.6-27B) — likely, not confirmed. At 2.4T the checkpoint is a
multi-node datacenter artifact regardless; the 27B is the practically interesting sibling.

## Vendor claims & methodology

Full table published at GA (fifteen days after the preview), all rows Alibaba's own harness
— prompts, sampling, retries, and scaffolding all vendor-chosen. Honest losses included
(SWE-bench Pro, HLE), which buys some credibility:

| Benchmark | Qwen3.8-Max | Opus 4.8 | Fable 5 | GPT-5.6 Sol | Qwen3.7-Max |
|---|---|---|---|---|---|
| Terminal-Bench 2.1 | 86.6 | 84.6 | 84.6 | 88.8 | 74.5 |
| SWE-bench Pro | 67.7 | 69.2 | 80.0 | 64.6 | 60.6 |
| PaperBench | 93.0 | 80.3 | 88.8 | 90.5 | 64.8 |
| IFBench | 82.8 | 62.2 | 63.5 | 72.7 | 79.1 |
| HLE | 43.6 | 45.7 | 53.3 | 47.2 | 41.4 |
| OSWorld-Verified | 86.1 | — | 85.0 | 83.2 | — |
| FrontierSWE | 73.5 | — | 88.8 | — | 40.7 |
| DeepSWE (vendor) | 56.6 | — | — | — | 21.6 |

Reads: agentic execution is the real generational jump (DeepSWE 21.6→56.6, FrontierSWE
40.7→73.5, JobBench 31.3→53.4). Reasoning ceiling barely moved (GPQA 92.4→92.6). Deep
software engineering still trails Fable 5 by 12-15 points on the vendor's own rows. HLE is
last among the four flagships. The multimodal table (MathVision 95.2, OmniDocBench 92.1,
OSWorld lead) is its strongest story — and irrelevant to our text-only route. Launch demo:
reproduced a research paper's six main results over ~5 days / 125 GPU-hours, then beat its
method on AIME24 by 2.7 — single vignette, vendor-run.

## Neutral evals

- **AA Intelligence Index 58** (v4.1.1), 9th of 185, read 2026-08-07..12. Score history is
  a caution: first run published at 53 then pulled (AA blamed intermittent endpoint
  failures), press ran 56 on Aug 6, the board read 58 on Aug 7 — while the *whole index*
  drifted +1-3 points (K3 57→60, Opus 5 61→63, GLM 51→53). Cross-date comparisons are
  invalid; only same-day reads rank. Current same-day order: Opus 5 63 > Fable 5 62 > Sol
  61 > K3 60 > **Qwen 58** > Sonnet 5 55 > GLM 53.
- **DeepSWE v1.1 (common mini-swe-agent harness): 57% ±3% at $3.73/task, 95K output tokens,
  111 steps [xhigh]** — read 2026-08-06..12. Sits exactly between GLM 5.2 (44% ±2, $3.92)
  and the frontier cluster (K3 69 ±5, Fable 70 ±4, Sol 73 ±3, Opus 5 74 ±4). Notably, the
  vendor's own DeepSWE claim (56.6) matches the neutral rerun within noise — the first
  vendor in this guide whose central coding claim needed no discount.
- **GDPval-AA v2 Elo 1739** — ahead of K3 (1685), ~tied Fable 5 (1743) and Sol max (1730),
  behind only Opus 5 (1852). The catch is how it gets there: 64 steps/task vs a 14-step
  median, ~15x input-token growth (full history resent per step). Strong, but by grinding.
- **AA-Omniscience: hallucination rate 23% → 40% vs Qwen3.7-Max**, accuracy flat ~31%. The
  model now guesses where its predecessor abstained. Never a verifier.
- **AA-LCR (long-context retrieval) dropped 2 points** vs 3.7-Max — the 1M-window marketing
  is not matched by retrieval improvement.
- **τ³-Banking 42%** — a 32-point generational jump AA itself flagged as an outlier (ahead
  of models that beat it everywhere else). Discount that row.
- **Verbosity/economics**: 150M output tokens on the Intelligence Index vs 71M median.
  Cost to run the Index: $1,741 vs Qwen3.7-Max's $1,064 — +64% spend while unit price fell
  20-26%. Per Index task: $1.14 vs K3's $0.86 and GLM's $0.57 (Aug 6 reads) — cheaper
  tokens, more expensive work. Speed 47.6 tok/s on Alibaba's API (median ~71) — AA calls it
  "notably slow and very verbose." Fireworks throughput unmeasured (speed is a route
  property — see the K3 provider-split lesson).
- No LMArena signal, no vals.ai read, no Latch/METR behavioral teardown found as of
  2026-08-12.

## Fireworks route — probed 2026-08-12 (live API)

`accounts/fireworks/models/qwen3p8-max`, list-matching $2/$6/$0.25-cached:

- **262,144 context** (vs 1M native), **no image input** (`supports_image_input: false`).
- **Tool calling works** despite `supports_tools: false` in the models API metadata — the
  flag is wrong; a live probe returned a clean `tool_calls` response with
  `finish_reason: tool_calls`.
- Thinking on by default (`reasoning_content` present even on trivial prompts).
  `reasoning_effort` enum on this route: `low, medium, high, xhigh, max, none, adaptive`
  (int/bool forms also accepted). `none` verified to suppress reasoning;
  `chat_template_kwargs.enable_thinking: false` also works. `minimal` is rejected.
- `max_tokens: 131072` accepted without error (untried at that depth).
- models.json entry added 2026-08-12: 262144 ctx / 131072 out / text-only /
  thinkingLevelMap off→none, minimal/low→low, medium→medium, high→high, xhigh→xhigh,
  max→max.

## Routing synthesis (2026-08-12)

Earns a slot; displaces nothing.

- **Seventh quorum family (Alibaba/Qwen).** The primary structural value — quorums want
  discrete families, and 58-AA + DeepSWE 57 makes it a substantive seat, not a token one.
- **Mid-tier text-coding escalation between GLM and K3.** DeepSWE 57 ±3 @ $3.73 is the
  cheapest ≥55% score on the common harness other than DeepSeek (53 @ $0.10). It beats GLM
  5.2 on both DeepSWE axes (57 vs 44, $3.73 vs $3.92) — but GLM keeps the marathon seat
  (1M context on our route vs Qwen's 262K, MIT weights, track record). K3 keeps hard-task
  escalation (69 vs 57 for only ~25% more per task) and the vision seat (Qwen's route is
  text-only).
- **Not the default.** DeepSeek V4 Flash is ~14x cheaper per input token with local
  12/12-parity evidence; Qwen's verbosity (2.1x median output) widens that per task.
- **Not a verifier.** 40% hallucination, regressing in the wrong direction (guess vs
  abstain). Same ban as DeepSeek/K3.
- **Watch items.** (1) Weights + license — if Apache-2.0 lands, the open-weight-bias
  argument strengthens; a K3-style bespoke license weakens it. Promise is already overdue.
  (2) Fireworks may raise the route to 1M/multimodal — recheck `supports_image_input` and
  context on catalog updates. (3) AA score churn (53→56→58 in a week) — distrust any single
  read. (4) Qwen3.8-27B — if the agentic gains survive the distill, it's the interesting
  local-model candidate, not the 2.4T.
