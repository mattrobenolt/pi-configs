# DeepSeek V4.1 Flash — Evidence Brief

**pi ID:** `fireworks/accounts/fireworks/models/deepseek-v4p1-flash`
**Status in pi:** intra-family escalation seat (0731 → v4p1 → K3) + fast/long-output vision; default stays 0731 (settled 2026-09-12)
**Brief posture:** launch-day add + full local eval. Vendor numbers flagged where unverified.

---

## 1. What it is

- **Vendor:** DeepSeek. GA 2026-09-10 ([api-docs news](https://api-docs.deepseek.com/news/news260910)); live on Fireworks same day (created 2026-09-10, `Ready`). HF: [deepseek-ai/DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), tech report on the repo.
- **Architecture:** new base model, not a V4-Flash post-train. 552B backbone MoE with a **causal encoder-decoder**: 8B active during prefill, 16B during decode; KV cache footprint ~1/4 of V4-Flash (paper title: "Pushing the Limits of KV Cache Compression"). Natively multimodal (vision + text). First-party API exposes a continuous reasoning effort 1–100; Fireworks exposes the usual enum.
- **Context:** 1M (1,048,576, confirmed via the inference API `models` endpoint). Function calling + image input confirmed live.
- **Pricing (Fireworks serverless):** $0.22 / $0.007 cached / $0.66 — identical sticker to V4 Flash 0731 post-hike.
- **Thinking:** always on. Fireworks enum `low/medium/high/xhigh/max`; `minimal` rejected by the route ("Input should be 'low', 'medium'…"), no `off` — reasoning tokens appear even with no effort param. Probed live 2026-09-10 on openai-completions. Same ladder shape as GLM 5.3 Flash. pi entry carries `thinkingLevelMap: { off: null, minimal: null }`.
- **Undated slug:** `deepseek-v4p1-flash` has no dated variant yet. The 0731 lesson (undated alias silently re-pointed) applies — pin a dated slug when one appears.

## 2. Vendor claims (unverified unless noted)

- **DeepSeek's own table (max effort):** GPQA Diamond 90.9, Codeforces 3471, MathArena Apex 65.6, Terminal-Bench 2.1 **90.6**, TB3.0 30.0, TB4.0 31.2, **DeepSWE v1.1 74.2**, NL2Repo 64.0, AutomationBench 54.8, Agent's Last Exam 31.8, HLE-with-tools 63.9, vision-agent rows (Chartography 78.9, BabyVision 89.6). Headline: a Flash-tier model comprehensively beating their own 1.6T flagship V4-Pro — the claim they used to justify retiring Pro.
- **No neutral coverage existed at launch; AA's v4.3 read landed within 48h and cut the story down:** Intelligence Index **40** — above Pro-0813 (36) but below GLM-5.3 (45) and K3 (44) on the same index; $0.27/task; 250M output tokens on the index run (130M median — very verbose). Four independent hands-on tests (MindStudio) found scaffolding-fast/logic-weak behavior on open-ended builds. The "74.2 = frontier killer at Flash prices" reshuffle scenario is dead; a neutral DeepSWE rerun remains the open number.
- Community first-party speed reports: 280–500 tok/s sustained. Provider-split reality on our route: see §4.

## 3. Local eval (2026-09-10, all Fireworks @`max` unless noted)

Run dirs: `evals/model-duel/runs/2026-09-10T21-29-24Z` (routine), `…T21-40-07Z` (hard), `…T21-45-23Z` (needles 32K/128K), `…T21-51-58Z` (needles 512K), `…T22-02-08Z` (vision). DeepSeek 0731 re-ran same-day in every arm as the baseline.

| Arm | Result |
|---|---|
| Routine pack vs 0731 (2 reps) | **12/12 = 12/12**; $0.0853 vs $0.0416; 24s vs 29s avg; 24.1K vs 30.3K output tokens |
| Hard pack vs 0731 (2 reps) | **4/4 = 4/4**; $0.0437 vs $0.0205; 39s vs 40s; 13.9K vs 17.1K out |
| Needles 32K/128K (gist+verbatim) | **4/4 = 4/4**; $0.3244 vs $0.1370 |
| Needles ~925K (gist + verbatim, 1 rep) | **2/2 PASS** — retrieval + exact wording clean to 925K; but $1.22 vs $0.42 total (see §4) |
| Vision (vision-slug-bug, 2 reps) | **2/2 PASS**, $0.0086/run, **17s avg** — GLM 5.3 Flash did the same task at $0.003/43s |
| Guess-vs-abstain (5 traps + 2 controls) | **4/5 traps denied cleanly with correct specifics** ("no element lemnosium", "no Cricket World Cup in 1937 — first was 1975", "no kernel release has ever included fanotify_mark2"); **1/5 fabrication** — confirmed the false Ellison/Paul-Merchant premise and invented a title+year. Controls 2/2 (74, 5.1). Hand-scored. |
| Strict json_schema + thinking `max` (10 reps, integer extraction) | **10/10 correct, 0 corruption** — the 0731 integer-corruption bug did not reproduce (same result as Pro-0813's 0/10) |

Method notes: probe scorer regexes miscalibrated (curly apostrophes, phrasing variants) — abstain arm hand-scored from raw transcripts. The one fabrication is the family signature attenuated, not gone; n=5 is far below AA-Omniscience scale.

## 4. Route gotchas (measured)

- **Prefix caching: OFF at launch, FIXED within ~48h (2026-09-12).** Launch day: controlled probe 0/4,448 on an immediate repeat (0731 control 4,421/4,422), in-loop 8-9% on agentic packs, 0% on needles — one 925K needle re-billed its full prefix every turn (3.68M input, $0.81 vs 0731's $0.21). 2026-09-12: controlled probe **97% warm** (4,318/4,448), in-loop routine-pack **50%** (family reference 78-87% — residual gap may settle as the deployment warms). Matt called the launch state transient before the fix landed — right call, don't weight route states the vendor is actively fixing.
- **Throughput ~41 content tok/s** (controlled warm stream, launch day), TTFT-to-reasoning 0.87s, but **18s to first content token** at effort `low` on a writing task — it burned 3,140 reasoning tokens before writing a word. Reasoning hunger shows up early (Pro-0813 pattern); budget output caps in the multi-K range or extraction calls will length-truncate. Community 280-500 tok/s figures are first-party API — provider split; expect a Fireworks port to move this.
- **Verbosity is the durable cost driver, not caching.** Routine-pack re-run with caching on: $0.0074/run (vs 0731's $0.0035) — per-task cost barely moved from launch day because output volume varies 24-46K per pack sample and AA's independent run corroborates the trait (**250M output tokens on the index vs a 130M median**). Floor estimate: ~1.5-2x 0731 per accepted text task, from output volume alone.
- `prompt + max_tokens ≤ 1,048,576` did **not** bite at 384K maxTokens on ~925K prompts through the anthropic-messages route (both models passed 09-10 and 09-12).
- **First-party already re-pointed the undated aliases** (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` → V4.1, 2026-09-10; `deepseek-v4-pro` routes to V4.1 from 2026-09-14). Our dated Fireworks slugs are the protection — and v4p1 itself is undated, so pin a dated slug when one appears.
- Fireworks metadata says "Mixture-of-Experts: No" and "Calibrated: No" — both contradict the model card; metadata noise. Fine-tuning unsupported.
- **Throughput ~41 content tok/s** (controlled warm stream), TTFT-to-reasoning 0.87s, but **18s to first content token** at effort `low` on a writing task — it burned 3,140 reasoning tokens before writing a word. Reasoning hunger shows up early (Pro-0813 pattern); budget output caps in the multi-K range or extraction calls will length-truncate. Community 280–500 tok/s figures are first-party DeepSeek API, not our route — same deployment-bound split as K3 and GLM Flash at launch (GLM's vLLM backing predicted ~2x when ported; watch for the same here).
- `prompt + max_tokens ≤ 1,048,576` did **not** bite at 384K maxTokens on ~925K prompts through the anthropic-messages route (both models passed today; the 08-29 GLM 400 didn't reproduce).
- Fireworks metadata says "Mixture-of-Experts: No" and "Calibrated: No" — both contradict the model card (552B MoE); metadata noise, ignore. Fine-tuning unsupported.

## 5. Seat read (settled 2026-09-12)

- **Intra-family escalation rung: TAKEN from Pro-0813.** Hard-pack duel: 4/4 = 4/4 at $0.076 vs $0.198, faster wall (68s vs 94s avg). Independent agreement: AA v4.3 scores v4p1 40 > Pro 36; DeepSeek retired Pro first-party themselves (cutoff 2026-09-14). **The DeepSeek ladder is 0731 → v4p1 → K3.** Same-family bans carry to the rung: never a verifier; hands-on logic-breaks reports (below) say gate open-ended logic-heavy work externally.
- **Default seat: stays 0731 — resolved on durable grounds, not the transient cache state.** AA v4.3 puts v4p1 at 40, **below GLM-5.3 (45) and K3 (44) on the same index** — the launch claim of frontier-class capability (DeepSWE 74.2, "beats our own flagship") did not survive neutral measurement. And verbosity (250M output tokens on AA's index vs 130M median) makes v4p1 ~1.5-2x 0731 per accepted text task even with caching on. 0731 also keeps the `off`/`minimal` gear v4p1 lacks.
- **Vision seat: v4p1's where wall-time or output length matters.** Fastest measured pass (17s vs GLM 5.3 Flash's 43s) at 2.9x GLM's per-run cost (both trivial), with the 384K cap GLM lacks. GLM 5.3 Flash keeps batch-cheap vision.
- **Deep context: capable.** 925K needles clean; $0.007 cache reads. Joins GLM 5.3 Flash in the sub-$1 deep-context club once the in-loop cache rate settles.
- **Verifier ban stands** (1/5 fabrication on traps, family prior, n=5). **Schema ban softened to unconfirmed** (10/10 clean, matches Pro-0813).
- **Independent hands-on caveat (MindStudio, 2026-09-12):** four open-ended build tests (SVG, Rubik's-cube sim, Paint portrait, ray-tracer) — "plausible scaffolding quickly, but the underlying logic frequently breaks under scrutiny"; the cube sim replayed scramble moves instead of solving. Same family shape as 0731's agentic-strong/reasoning-weak profile. External verification for open-ended logic-heavy work.

## 6. Open questions / watch items

- **In-loop cache convergence** — 50% vs the family's 78-87%; if it settles, the deep-context and volume economics tighten further (verbosity remains the floor).
- **Neutral DeepSWE rerun** — vendor's 74.2 (official mini-SWE harness, self-run) vs AA 40 and four hands-on logic-breaks reports; the spread is the story. If an independent DeepSWE lands near 74, the rung-seat read needs a second look; near AA's implication (~50s), nothing changes.
- **0731's v4.3 AA number** — unread; MindStudio's "up four from the prior DeepSeek release" implies ~36 same-index, which would make v4p1 +4 over 0731 — modest, consistent with local parity.
- **Dated slug** — pin when one appears; first-party already re-pointed every undated V4 alias.
- **Fireworks port off the launch backing** — ~41 tok/s should move (GLM-vLLM precedent: ~2x when ported).
- **Sept 14 Pro cutoff on the Fireworks route** — check `deepseek-v4-pro-0813` serving after the date (moot for routing since v4p1 took the rung; matters only for re-check availability).
- Bigger-n abstention probe before any verifier-adjacent use; Latch/METR-style teardown doesn't exist yet.
- First-party continuous effort 1–100 vs Fireworks' 5-level enum — first-party-only feature for now.
