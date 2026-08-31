# GLM 5.3 — Evidence Brief (STUB — vendor claims only, no neutral evals)

**pi ID:** `fireworks/accounts/fireworks/models/glm-5p3`
**Status in pi:** provisional heir to GLM 5.2's marathon seat (2026-08-28)
**Brief posture:** day-one stub. Everything below is vendor-sourced unless marked otherwise. Fill in `Neutral evals` when AA / DeepSWE-rerun / vals.ai / LMArena numbers exist, then run the local duel before any seat change.

---

## 1. What it is

- **Vendor:** Z.ai. Announced 2026-08-14 ([z.ai/blog/glm-5.3](https://z.ai/blog/glm-5.3)); available on Fireworks 2026-08-28.
- **Architecture:** 744B-A40B MoE — the *same* architecture as GLM 5.2. Per third-party summary ([Puter developer docs](https://developer.puter.com/ai/z-ai/glm-5.3/)): "a post-training refresh of GLM-5.2... all reported gains come from expanded reinforcement-learning post-training rather than a new base model."
- **Weights:** MIT open weights promised "publicly available soon in two weeks" per the launch blog — NOT shipped as of Fireworks availability. GLM-5.3-Flash (320B-class, hybrid sparse+linear attention, mHC) is a separate sibling model, not this one.
- **Context / output:** 1M-token context, 128K max output ([docs.z.ai GLM-5.3 overview](https://docs.z.ai/guides/llm/glm-5.3)). Fireworks catalog says "1040k tokens" context ([fireworks.ai/models/fireworks/glm-5p3](https://fireworks.ai/models/fireworks/glm-5p3)) — treat as the 1M window.
- **Modalities: TEXT ONLY** (same as 5.2; confirmed on Fireworks catalog — "Support image input: Not supported").
- **Pricing:** $1.40 / $4.40 per 1M, $0.26 cached — identical to 5.2 ([Fireworks serverless pricing](https://docs.fireworks.ai/serverless/pricing)). A GLM 5.3 Fast variant exists at $2.10/$0.39/$6.60 — not added to models.json.
- **Thinking:** `reasoning_effort` accepts `low`/`high`/`max` only; **defaults to `max` if unset or given any other value**; thinking can NO LONGER be disabled ([zai-org/glm-5 README](https://github.com/zai-org/glm-5/blob/main/README.md)). This removes the `off` floor the family had on Fireworks.

## 2. Vendor benchmark claims + methodology critique

All from Z.ai's launch materials (blog + glm-5 repo README), all self-run, zero third-party reproduction at Fireworks launch:

| Claim | GLM-5.2 → GLM-5.3 | Source |
|---|---|---|
| Internal Code Bench | "+50%" relative | z.ai blog |
| Terminal-Bench 3.0 | 4.6 → 28.3 | z.ai blog |
| DeepSWE v1.1 | 46.2 → 66.9 | z.ai blog |
| CyberGym | 77.2% → 84.5% | z.ai blog |
| ExploitBench | 24.4% → 54.4% | z.ai blog |

Methodology notes:

- **"Code Bench" is an internal Z.ai benchmark** — the +50% headline is on a test they made, they run, and they grade. Weight accordingly.
- The DeepSWE 66.9 figure is the one that matters for routing: the neutral common-harness rerun of 5.2 measured 44 ±2, so if 5.3's 66.9 survives the same neutral harness it lands inside K3's cluster (69 ±5 @ $4.65/task) at ~$1.40/$4.40 vs K3's $3/$15. That is the entire case for seat pressure. Guide base rate: no vendor headline has survived neutral cross-check intact (5.2's own DeepSWE was the exception that *did* hold — 44-46% corroborated — so Z.ai has partial credit here).
- The cyber numbers (CyberGym/ExploitBench) are marketed as "emergent cyber capabilities." Capability marketing, not authorization. No routing consequence.

## 3. Neutral evals

**None as of 2026-08-28.** No AA Intelligence Index read, no neutral DeepSWE rerun, no vals.ai, no LMArena. Do not quote the vendor numbers as established.

## 4. Local notes

- Added to `models.json` 2026-08-28: `glm-5p3`, 1M/131K. Thinking map corrected 2026-08-29 after live probe: Fireworks enum is `low/medium/high/xhigh/max/none`; `none` rejected ("thinking-only model"), `minimal` not in enum → native `low`→`max` ladder, `off`/`minimal` null.
- Matt practice note: he never ran GLM 5.2 below `xhigh`, so the 5.2 guide line "prefer `high` (pack-measured 2.7x tokens, zero pass gain)" is not practice-validated.
- Drew's review pipeline and Drew's main session stay on GLM 5.2 — the personality prompt is tuned against it; a swap without evals is a voice change.

## 5. Local eval results (2026-08-29, duel harness, Fireworks route)

All run dirs under `evals/model-duel/runs/2026-08-29T02*`.

**Routine pack** (6 Matt-shaped tasks ×2 reps, 5.3@`max` vs 5.2@`xhigh`): 12/12 = 12/12. 5.3: $0.213 total, 17s avg, 13.8K out tokens. 5.2: $0.401, 61s, 47.1K. → 2x cheaper, 3.6x faster, 3.4x leaner.

**Hard pack** (new `tasks-hard/`, authored to break the 12/12 ceiling): `ts-lease-fencing` (cross-module stale-ack/fencing bugfix; hidden tests catch ack-only partial fixes — the renew-expiry hole is hidden-only) and `ts-manifest-merge` (spec-precision canonical render + deep merge; 10 hidden edge tests). Both fixtures validated with reference solutions pre-flight. Result: 4/4 = 4/4, gap widens — 5.3: $0.120, 26s avg, 10.1K tokens; 5.2: $0.526, 175s, 53.4K → 4.4x cheaper, 6.7x faster, 5.3x leaner. Capability ceiling still not found locally.

**Gear floor** (5.3@`low`, routine pack, 1 rep): 6/6, $0.117, 15s avg. `low` is a viable cheap gear — no DeepSeek-style thinking-off collapse.

**Long context**: needle pack @`max`: 32K/234K pass ($0.085/$0.33-0.39). **~925K: dead** — both gist and verbatim tasks hit 300s with 0 tokens; raw streaming curl (`low` effort, 500 max_tokens) shows zero first byte at 420s and 600s. 5.2 completed the identical input in 108-292s (2026-08-07 arm). Not thinking latency, not harness config — the Fireworks route does not serve ~1M-token 5.3 requests at launch. Operational ceiling: between 234K and 925K, unbissected.

**Read**: 5.3 dominates 5.2 at identical sticker price on every local axis except depth. 5.2 keeps the marathon seat purely because its 1M window works and 5.3's doesn't on this route today.

## 6. Open questions / watch items

- Fireworks deep-context serving fix — re-run the 925K needles when it lands. THIS is the promotion gate for the marathon seat.
- Neutral DeepSWE v1.1 rerun of 5.3 — does 66.9 hold? If yes, K3's text-escalation seat gets real price pressure.
- AA Index read — 5.2 was 53 on the 2026-08-12 refresh.
- Does 5.2's silent-under-counting verifier failure mode carry over? (Assume yes until probed.)
- Do the MIT weights actually ship?
- GLM 5.3 Fast ($2.10/$6.60) — worth probing only if latency starts mattering.
