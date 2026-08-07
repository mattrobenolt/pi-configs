# DeepSeek V4 Flash 0731 — evidence brief

Status: draft, 2026-08-07. pi route: `fireworks/accounts/fireworks/models/deepseek-v4-flash-0731`
(Fireworks: 1M ctx, 384K max output, thinking `minimal/low/medium/high/max`, text-only).
First-party API: `deepseek-v4-flash` (dated slug `-0731` pin-able; the undated alias was
silently re-pointed at this checkpoint on release day).

## What it is

The official release of DeepSeek V4 Flash, shipped 2026-07-31, superseding the April/June
preview. **Identical architecture to the preview** — 284B total / ~13B active MoE, 1M context,
hybrid attention (4:1 compressed KV + top-512 lightning indexer), bundled DSpark speculative
decoding (the HF repo reads 304B params = base + drafter). DeepSeek's changelog says it "was
only re-post-trained"; every gain is downstream of pretraining. MIT weights. New API surface:
native Responses API ("specifically adapted for Codex") and an `/anthropic` endpoint.
Pricing unchanged: $0.14/$0.28 per 1M (Fireworks list matches), first-party cache hit
$0.0028/M (~98% discount; Fireworks cache read is $0.028, 10x worse).

## Vendor claims & methodology

Nine agent/coding benchmarks, all self-run on DeepSeek's **unreleased** harness, minimal mode,
`max` effort, temp 1.0 / top_p 0.95 — not third-party reproducible at release:

| Benchmark | Flash-0731 | Flash preview | V4-Pro Preview | GLM-5.2 | Opus-4.8 |
|---|---|---|---|---|---|
| Terminal-Bench 2.1 | 82.7 | 61.8 | 72.1 | 81.0 | 85.0 |
| DeepSWE | 54.4 | 7.3 | 12.8 | 46.2 | 58.0 |
| Toolathlon-Verified | 70.3 | 49.7 | 55.9 | 59.9 | 76.2 |
| Cybergym | 76.7 | 38.7 | 52.7 | – | 83.1 |
| NL2Repo | 54.2 | 39.4 | 38.5 | 48.9 | 69.7 |
| Agents' Last Exam | 25.2 | 15.8 | 16.5 | 23.8 | 25.7 |
| AutomationBench Public | 25.1 | 10.8 | 12.8 | 12.9 | 27.2 |
| DSBench-FullStack/Hard (internal) | 68.7/59.6 | 37.0/25.8 | 41.8/31.1 | 61.8/54.5 | 71.6/71.7 |

Headline "beats our own Pro on all nine" is real per the table but the comparison target is a
preview build; expect the gap to narrow when Pro gets the same post-training. Opus 4.8 beats
Flash-0731 on all nine rows (DeepSeek published that too). The DeepSWE 7.3→54.4 move is mostly
the preview's broken agent scaffolding being fixed, not a 7.5x capability jump (Prograsec's
read; a 7.3 is format-failure territory).

## Neutral evals

- **Artificial Analysis** (independent): Intelligence Index 40 → 50 at launch (page shows 52
  under v4.1.1). One point behind GLM-5.2 (51) and GPT-5.6 Luna (51), seven behind Kimi K3 (57),
  tied with Gemini 3.6 Flash. GDPval-AA v2 Elo 1189 → **1559** — second-highest open weights
  behind K3 (1687), ahead of GLM-5.2 (1510). AA's own Terminal-Bench: 79% (vs vendor's 82.7).
  Verbosity 4/4: ~206-210M output tokens to run the index vs ~100M median — sticker price
  understates real cost. ~106 tok/s, 1.3s first chunk. Pareto frontier for intelligence vs
  cost per task; ~60% lower cost per task than Luna max even after Luna's 80% price cut.
- **LMArena** (human preference): text Elo **1436, rank ~79** on 48k+ votes — far below its
  benchmark aggregate; V4 Pro (1458) sits above it. WebDev board 8th at 1577 (preliminary).
  Benchmark-vs-preference divergence consistent with an agentic/tool-use-tuned retrain.
- **vals.ai**: 63.95% ± 1.31 (no same-harness comparator collected).
- No Latch/METR-style behavioral teardown found as of 2026-08-07.

## Behavioral properties (field reports)

- **Hallucination 84%** on AA-Omniscience (down from the preview's 96%), accuracy unchanged at
  37%. Nano-tier reliability: generates rather than refuses. The anti-M3. Never a verifier.
- **Thinking-on + strict `json_schema` corrupts integer values** (schema-valid, wrong numbers;
  8/13 runs across two request paths, prodSens 2026-08-04). `enable_thinking: false` fixes it
  and is ~7x cheaper on extraction — but thinking-off collapses multi-step reasoning (2-hop
  math 0/6 on 0731; preview 2/6; Pro unaffected). Thinking-budget floor ~256 tokens.
  Treat thinking and strict structured output as mutually exclusive on this model.
- **Rules-file/skills adherence at depth**: recurring reports that long rules files and system
  prompts are followed loosely; plausibly architectural (compressed KV → instructions deep in
  context survive as summaries, not exact wording). Mixed reports — many call it a workhorse;
  harness/template variance is a factor. Mitigations: absolute wording, positive instructions
  over prohibitions, numbered steps. **Did not reproduce in our local probes** (see below).
- **Tool-call formatting flakes** (yage.ai, Awais/Kilo retrospectives): null optional fields,
  arrays as escaped strings, markdown-autolink file paths. A repair layer or tolerant parser
  is recommended for production tool loops.
- **Error compounding on open-ended loops**: field report of ~30min / ~100K-token failed runs
  when a multi-turn agent makes an early wrong decision with no deterministic gate.
- Launch-week infra bugs (no official Jinja chat template, vLLM DSpark loader silently
  dropping tensors) — mostly fixed within days; relevant only to self-hosting.

## Local eval (model-duel, our harness, 2026-08-06/07)

`~/.pi/agent/evals/model-duel/` — pi-harness duels vs GLM-5.2 on Matt-shaped tasks
(drew-flavored TS bugfix/feature/removal, exosphere-flavored Zig bugfix/parser, AGENTS.md
rules probe) plus a synthetic needle pack (gist + verbatim probes at ~60K/233K/925K tokens).

- Coding pack, `high` thinking: **12/12 vs 12/12**. DeepSeek 4.1x cheaper per accepted task
  ($0.045 vs $0.187), 3.3x output tokens, 2.2x slower wall-clock (66s vs 30s avg).
- Coding pack, top gear (`max` vs GLM `xhigh`): **12/12 vs 12/12**. GLM paid 2.7x its own
  high arm and slowed; DeepSeek at `max` cost the same as its high arm and got *faster*
  (47s). Top-gear ratio: ~12x cheaper per accepted task. **`max` is DeepSeek's sweet spot.**
- Needle pack: **6/6 both**. All gist needles at all depths; verbatim exact-token rule
  reproduced perfectly at ~925K. No invented IDs. 925K question: $0.13-0.18 vs GLM's $1.30.
- Rules probe: followed all four AGENTS.md rules in all reps (short-context caveat applies).
- Diff quality spot-check: byte-identical minimal fixes to GLM on the abort bug.

## Pros

- GLM-5.2-class capability at ~$0.14/$0.28 — the cheapest per accepted task of anything in
  the guide at this intelligence level; ~4-12x cheaper than GLM per task in local duels.
- Fast at `max` (~106 tok/s; 69-99s for a 925K-token question vs GLM's 108-292s).
- MIT weights, self-hostable, 1M context, retrieval intact to the top of the window (local).
- Native Responses API + Anthropic endpoint; wide provider availability (Fireworks, Baseten,
  Together, DeepInfra, first-party).

## Cons

- 84% hallucination; never a factual verifier, never unsupervised structured-extraction with
  thinking on (integer-corruption bug).
- Verbose: real cost ≈ 2-3x what sticker + task counts suggest unless cached.
- Human preference (LMArena 1436/rank-79) lags its benchmark standing — chat polish is not
  the strength.
- Rules-at-depth concern unresolved at realistic sizes (our probe was small-context).
- Fireworks serving showed 91.6% uptime in OpenRouter stats — watch it; first-party DeepSeek
  (99.9%, 98% cache discount) is the economic fallback, with the data-residency caveat.
- Vendor agent numbers unreproduced; DSBench rows are internal test sets.

## When to use / not use

Use: day-to-day grunt coding at `max` thinking — issue bugfixes, small features, removals,
mechanical refactors; cache-heavy batch loops; draft-executor under a frontier planner.

Not: factual verification; long-horizon autonomous loops without deterministic gates (GLM
marathon seat unchallenged by our data); structured-output extraction with thinking on;
vision; anything where 91.6% provider uptime is unacceptable without a fallback route.

## Sources

- HF model card: https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731
- AA article: https://artificialanalysis.ai/articles/deepseek-v4-flash-0731-scores-50-on-the-artificial-analysis-intelligence-index-10-points-above-previous-deepseek-v4-flash
- AA model page: https://artificialanalysis.ai/models/deepseek-v4-flash
- LMArena split: https://www.eesel.ai/blog/deepseek-v4-flash-review
- prodSens structured-output + thinking probes: https://prodsens.live/2026/08/04/deepseek-v4-flash-api-cost-thinking-mode-corrupts-strict-json/
- Prograsec field reports (rules adherence, launch bugs): https://prograsec.com/insights/deepseek-v4-flash-0731
- yage.ai agent economics + tool-call flakes: https://yage.ai/share/deepseek-v4-flash-0731-agent-economics-en-20260801.html
- OpenRouter provider stats: https://openrouter.ai/deepseek/deepseek-v4-flash-0731
- Local: ~/.pi/agent/evals/model-duel/README.md + runs/2026-08-06T23-19-50Z, 2026-08-06T23-41-27Z, 2026-08-07T00-11-25Z, 2026-08-07T00-37-00Z
