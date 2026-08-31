# GLM 5.3 Flash — Evidence Brief

**pi ID:** `fireworks/accounts/fireworks/models/glm-5p3-flash`
**Status in pi:** default-seat challenger (2026-08-29)
**Brief posture:** same-day add + full local eval. Vendor numbers flagged where unverified.

---

## 1. What it is

- **Vendor:** Z.ai. Announced 2026-08-26 ([z.ai/blog/glm-5.3-flash](https://z.ai/blog/glm-5.3-flash)); live on Fireworks 2026-08-29.
- **Architecture:** 320B total / 18B active — **a new base model**, not a 5.3 post-training refresh. First GLM with hybrid **sparse + linear attention** (linear for local dependencies via state modeling, sparse indexer for global retrieval; IndexPool compresses 4 indexer key vectors into 1). vs GLM-5.3: 3.0x less attention compute, 4.4x smaller KV cache. mHC (Manifold-Constrained Hyper-Connections). 30T-token multimodal pre-train. Paper: [arXiv 2602.15763](https://arxiv.org/abs/2602.15763). 45 layers (vs GLM-4.5's 92).
- **Modalities: vision + text.** First natively multimodal GLM-5. Confirmed live on Fireworks (image_url block accepted, alertmanager screenshot read correctly).
- **Context:** 1M. **Enforced as prompt + max_tokens ≤ 1,048,576** on the Fireworks route — a 917,505-token prompt with `max_tokens: 131072` 400s with "maximum context length is 1048576... total of at least 1048577". Same prompt with `max_tokens: 2000` completes in ~30s.
- **Pricing:** $0.15 / $0.50 per 1M, cached $0.029 (Fireworks serverless). Cheaper than DeepSeek V4 Flash 0731 on both axes after its 2026-08-29 hike to $0.22/$0.66.
- **Thinking:** always on. Fireworks enum `low/medium/high/xhigh/max`; `none` rejected ("reasoning cannot be disabled"); no `minimal`. Probed live 2026-08-29.
- **Weights:** MIT promised, not shipped at Fireworks launch.

## 2. Vendor claims (unverified unless noted)

- AA Intelligence Index **57** at **$0.045/task** — "pushes the Pareto frontier... a level of intelligence previously only available at roughly 10x the cost." Vendor-cited; not independently re-read.
- "Outperforms GLM 5.2 across benchmarks and real-world workloads at one-tenth the price."
- "Approaching Claude Opus 4.8 on coding and agentic benchmarks." Opus 4.8 is retired here; the comparison target in our terms would be the frontier cluster — no neutral number exists yet.
- GLM Coding Plan quota: 3x the points of 5.3-proper.

## 3. Local eval (2026-08-29, all Fireworks @`max` unless noted)

Run dirs: `evals/model-duel/runs/2026-08-29T19*`.

| Arm | Result |
|---|---|
| Routine pack vs DeepSeek Flash 0731 (2 reps) | **12/12 = 12/12**; $0.0199 vs $0.0240; 19s vs 25s avg; 10.2K vs 22.4K output tokens |
| Hard pack vs DeepSeek (2 reps) | **4/4 = 4/4**; $0.0087 vs $0.0162; 27s vs 53s avg; 4.8K vs 19.3K output tokens |
| Needle ~925K (gist + verbatim, 1 rep) | **2/2 PASS**, 43s, $0.139 each — 5.2 does this at ~$1.30; 5.3-proper cannot (hangs) |
| Needle 32K/234K | 4/4 PASS, $0.009-0.035 each |
| Vision (vision-slug-bug, 2 reps) | **2/2 PASS**, $0.003/run, honest alert OCR (correct German-transliteration cases), real root-cause fix |
| Guess-vs-abstain (5 trap questions, no real answers) | **5/5 ABSTAIN**, 0 fabrications; on a first batch with 2 mislabeled questions it answered both *correctly* |
| Strict json_schema + thinking (10 reps, numeric extraction) | **10/10 correct** — no integer corruption |

Method notes: the behavioral probes are 10-question suites, same shape as the DeepSeek probes but smaller — DeepSeek's bans were earned on AA-Omniscience-scale evidence. The vision-transcript check (fabricated-OCR attribution, the DeepSeek 2026-08-12 failure mode) found honest reading.

## 4. Route gotchas (measured)

- **prompt + max_tokens ≤ 1,048,576, enforced.** pi sends `max_tokens` from models.json on every call — `131072` makes any prompt over ~917K fail with a 400 that looks like a model failure. models.json `maxTokens` set to 65536. A proper fix would clamp per-request in the pi layer.
- Deployment backing on Fireworks is vLLM (`glm-5p3-flash-vllm`).
- **Throughput (2026-08-29, controlled stream): ~50-64 tok/s steady-state**, TTFT 0.13s warm / 1-4s cold; agentic wall-clock 36.5 tok/s (vs deepseek 81, proper 22). Fastest TTFT-to-content of the three at `low` — best interactive feel.
- OpenRouter field data: Fireworks 50 tps / 1.03s TTFT / 99.84% completion over its window.

## 5. Seat read

- **Challenges DeepSeek Flash 0731's default**: cheaper per token post-hike ($0.15/$0.50 vs $0.22/$0.66), 12/12 + 4/4 parity, half the output tokens, vision and ~925K context added, both ban-probes clean.
- **Dominates GLM 5.3 proper on economics**: Z.ai's own scorecard (same harnesses) — Flash DeepSWE 63.4 vs proper 66.9, TB2.1 84.3 vs 88.2, AutomationBench 48.8, Toolathlon 78.4, GDPval-AA 1773 (the one AA-run row — beats Opus 4.8 1582, K3 1685, Sol 1728; only Opus 5's 1852 is higher). The ~9x token premium buys ~3.5-4 pass points; per-success math (Flash ~$0.15-0.25/task at 63.4% → $0.25-0.40/success; proper ~$1.50-2/task at 66.9% → $2.50-3/success) favors Flash ~8-10x. Proper's remaining cases: one-shot-expensive work, >64K output, the 40B-vs-18B-active reasoning-tail bet.
- DeepSeek retains: 384K output cap (vs 64K), $0.007 cache-read (vs $0.029 — prefix-stable loops), neutral DeepSWE 53% ±4 (Flash's 63.4 is vendor-run only), deeper behavioral evidence trail, full `minimal`→`max` ladder.
- **Deep-context seats**: Flash is the only sub-$1 model on the route that serves ~925K — 5.2's marathon role at 1/9th the cost where <64K output suffices.
- **Cheap vision coding**: brackets M3's multimodal seat from above (M3 is banned from coding).
- Verifier seats stay banned pending larger-n abstention evidence.

## 6. Open questions / watch items

- Independent AA read (vendor 57 unconfirmed; same-day ordering would put it at Qwen's 58 / K3's 60 level).
- Neutral DeepSWE — the deciding number for the default seat if Matt wants more than local parity.
- Latch/METR-style behavioral teardown — none exists.
- Bigger abstention probe (AA-Omniscience-scale) before any verifier-adjacent use.
- Weights shipping (MIT promised).
- Throughput: 50 tps is batch-adequate; interactive streaming may disappoint.
- Knowledge parity with proper confirmed on n=21 external-sourced quiz (2026-08-29, see GLM 5.3 findings in MODEL_GUIDE.md) — Flash's newer 30T corpus matches proper's recall at 1/9 price; a larger AA-Omniscience-style run would firm this up.
- **Throughput prediction (2026-08-29):** Flash runs on Fireworks's `glm-5p3-flash-vllm` deployment (vanilla vLLM; proper and DeepSeek return canonical paths = optimized stack). Measured 50-64 tok/s against a ~200-250 single-stream bandwidth ceiling (18B active FP8 ≈ 18GB/token). Cross-provider spread on identical weights (Baseten 109, Friendli 77, Fireworks 50 tps) proves deployment-bound, not model-bound. **When Fireworks ports Flash to its optimized stack, expect ~2x toward ~180-220 tok/s — DeepSeek-class or higher (DeepSeek's 100-138 includes DSpark spec-decode; its unboosted base is lower).** Spec drafting on hybrid linear-attention state is the hard part, so spec-boosted rates beyond that are unlikely near-term. Prefill is already fast (~23K tok/s on the 925K needle). Re-run `/tmp/throughput.py` when the deployment id stops saying `-vllm`.
