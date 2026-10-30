# MiniMax M3.1 Flash — Critical Model Evaluation Brief

Fireworks model path: `accounts/fireworks/models/minimax-m3p1-flash`
Confirmed pi ID: `fireworks/accounts/fireworks/models/minimax-m3p1-flash` (pi bundled catalog; 1M context, 512K max output, thinking + vision, anthropic-messages API)
Prepared: 2026-10-23 · Status: launch teardown (released 2026-10-19) + live route probe; one neutral index read (AA), one independent AutomationBench retest, one Vals TB4 row

---

## 1. Routing verdict

M3.1 Flash is a **cheap agentic challenger, not seated** — and it does **not** inherit M3's seat.

- The M3 seat exists because of one behavioral property: abstention-training (precision-over-recall verification/librarian work). M3.1 Flash **breaks that property on the neutral read**: AA-Omniscience 56% correct (best of the flash class) but a **93% hallucination rate** — when it fails, it answers wrong instead of abstaining (AA index sub-score 16). M3's defining niche does not transfer. Keep verification/librarian work on M3 until a local probe says otherwise.
- What it actually is: a flash-class agentic/coding model at the cheapest sticker in the guide ($0.15/$0.60, cached $0.015 — half of M3). AA Intelligence Index 42-43 (v4.3.2, reads 2026-10-19→22 — already drifted one point) puts it at GLM-5.3-Flash parity (42), below DeepSeek V4.1 Flash-1017 (45, same-version read per VentureBeat/The Decoder — the guide's canonical DS cell is 40 on v4.3, do not mix). AA per-task cost $0.22 vs GLM-F $0.28, DS $0.26.
- The one strong neutral row: **AutomationBench-AA 72.5, independently retested by AA (2026-10-19), #2 overall behind Gemini 4 Argon and best open-weights** — at $0.07/task. Business-workflow agentic is its best measured shape.
- Coding evidence is split: vendor DeepSWE 73.7% (<$0.30/task, own harness) with no neutral DeepSWE leaderboard entry yet; Vals Terminal-Bench 4.0 25.25% (mini-SWE-agent, #22 of 52) vs vendor's own 38.1 (Codex harness) — the usual harness spread, and DeepSeek beats it on MiniMax's own table (42.3 vs 38.1).
- **Verdict: challenger to the GLM-5.3-Flash default-seat challenge, pending a local duel.** Seat math if the duel confirms parity: same price class as GLM-F, vision, 1M context, plus a real `off`/`none` gear GLM-F lacks. Promotion is a duel + Matt's call, same protocol as Ember-1.

---

## 2. What it is

- **Vendor / release:** MiniMax, released 2026-10-19 ([launch blog](https://www.minimax.io/blog/minimax-m31f)); on Fireworks serverless 2026-10-17 per the [model page](https://fireworks.ai/models/fireworks/minimax-m3p1-flash). "Space Bunny," the anonymous model that processed 200T+ tokens on the arenas, was an early version.
- **Architecture:** 428B MoE, ~23B active, native multimodal (text/image/video in, text out). Changes vs M3: sparse attention (MSA) throughout including the first three layers, quantization-aware training (mxfp8), DSpark speculative-decoding draft head replacing the EAGLE-like MTP. 1M context, 512K max output.
- **Weights:** released 2026-10-23 ([HF: MiniMaxAI/MiniMax-M3.1-Flash](https://huggingface.co/MiniMaxAI/MiniMax-M3.1-Flash)) under the **MiniMax Community License — not permissive**: non-commercial free; commercial use requires "Built with MiniMax M3.1-Flash" attribution + a one-time notice to MiniMax, and written authorization above $20M/yr revenue. Prohibited-use appendix (military, etc.). "Open-weight" with strings; the open-weight bias applies at reduced strength.
- **Pricing:** $0.15 input / $0.60 output / $0.015 cached per 1M, flat — half of M3's $0.30/$1.20, same input as GLM-5.3-Flash with a $0.10 dearer output token. MiniMax also sells an M Plan subscription and a free tier on some gateways (OpenCode, NVIDIA 262K); our route is Fireworks per-token.
- **Thinking:** vendor says always-on, `low`→`max`, default heavy. **The raw Fireworks route accepts `none` and `off` and they verified-disable reasoning (0 reasoning tokens)** — but pi's bundled catalog maps `off`/`minimal`→null, so through pi the effective ladder is `low`→`max`.

---

## 3. Vendor claims and methodology critique

MiniMax's [own table](https://openlm.ai/minimax-m3.1/) (harnesses disclosed, to their credit):

| Benchmark | M3.1 Flash | DS V4.1 Flash-1017 | K3 | GLM 5.3 | GPT-5.6 Sol | Opus 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AutomationBench v1.0.6 | 62.8 | 60.5 | 46.7 | 48.8 | 45.8 | 50.3 |
| BankerToolBench | 76.2 | — | 69.1 | 74.5 | 74.6 | 76.2 |
| Terminal-Bench 4.0 | 38.1 | 42.3 | 12.6 | 37.9 | 39.9 | 51.8 |
| DeepSWE v1.1 | 73.7 | 77.0 | 67.5 | 66.9 | 73.0 | 74.0 |
| OSWorld 2.0 | 61.7 | — | 58.3 | — | 65.7 | 70.6 |
| Agents' Last Exam | 29.6 | — | 28.3 | — | 30.6 | 32.2 |
| CyberGym | 82.2 | — | 80.0 | 84.5 | 83.6 | — |
| HLE (w/o tools) | 43.4 | 44.0 | 43.5 | 42.3 | 49.5 | 55.6 |

### What to discount

- **It loses to DeepSeek V4.1 Flash-1017 on MiniMax's own table** wherever both ran (TB4 38.1 vs 42.3, DeepSWE 73.7 vs 77.0, HLE 43.4 vs 44.0). The "beats DeepSeek" press framing (VentureBeat headline) rests on AutomationBench 62.8 vs 60.5 — one row, vendor-run, 600-task public subset.
- **DeepSWE 73.7% is vendor-run** (mini-SWE-agent 2.4.5, 512K cap) with no neutral leaderboard entry as of 2026-10-23. Treat like every vendor DeepSWE: unverified until the leaderboard lands.
- **TB4 is harness-volatile:** vendor 38.1 (Codex 0.149.1) vs Vals' independent 25.25% (mini-SWE-agent) — a 13-point harness spread on the same model. Neither number routes anything by itself.
- **"70% cheaper, 3x faster"** is against M3 on agentic tasks, vendor-measured. The 200+ tok/s output claim is first-party serving with DSpark speculative decoding; our Fireworks route measured 38-136 tok/s content (§5).
- **CyberGym 82.2** is vendor-run at 1M context with Claude Code as harness; no neutral cyber eval exists (no AA Cyber Index row).

---

## 4. Neutral evidence

- **AA Intelligence Index v4.3.2: 42** (VentureBeat, 2026-10-19) **→ 43** (Ridge, read 2026-10-22, joint #23 of 36 with Haiku 5.5). +13-14 over M3's 29. Per-task index cost **$0.22** vs M3's $0.51, GLM-F $0.28, DS-1017 $0.26. **Verbosity flag: 180M output tokens to run the index — "very verbose"** (AA via Ridge); the list-price advantage narrows on real bills, same disease as DeepSeek (250M).
- **AA-Omniscience: 56% correct — best of the flash class** (DS 43%, GLM-F 28%) — **but 93% hallucination rate**: of non-correct responses, nearly all were outright wrong rather than partial/abstained. Overall Omniscience score 16. The model attempts almost everything. This is the anti-M3.
- **AutomationBench-AA: 72.5, independently retested by AA (2026-10-19)** — #2 of 14 behind Gemini 4 Argon (77.5), best open-weights; $0.07/task, 55.8K output tokens/task, 447s/task. The strongest neutral row it has. (Vendor's 62.8 was the 600-task public v1.0.6 subset; AA's is 657 tasks — different sets, both real.)
- **Vals Terminal-Bench 4.0: 25.25%** (mini-SWE-agent, #22 of 52; Ridge 2026-10-22). Weak, harness-dependent.
- **Arena+ text Elo 1500, 29th of 33** (Ridge 2026-10-22) — weak human-preference showing. (1588 on Code Arena WebDev is a different board.)
- **No DeepSWE leaderboard entry, no AA Cyber, no Harvey LAB-AA, no METR, no Latch-style behavioral study** as of 2026-10-23.

---

## 5. Local route probe (2026-10-23, direct Fireworks route)

Raw calls against `https://api.fireworks.ai/inference/v1/chat/completions`.

### Thinking ladder — fuller than advertised

`reasoning_effort` accepts the full Fireworks enum: `low`/`medium`/`high`/`xhigh`/`max`/`none`/`adaptive` — **`none` and `off` both verified to disable reasoning** (0 reasoning tokens, content-only), contradicting the vendor "always-on" framing. pi's bundled catalog maps `off`/`minimal`→null, so pi users get `low`→`max`; the `none` gear exists on the raw route for extraction shapes (quality at `none` unmeasured).

Compositional probe (450-word TCP explanation, 8192 cap):

| Effort | Reasoning tok | Words | Wall | Content tok/s |
| --- | ---: | ---: | ---: | ---: |
| default | 2,183 | 549 | 19.8s | 43 |
| `low` | 2,046 | 546 | 18.9s | 45 |
| `medium` | 495 | 613 | 10.2s | 86 |
| `high` | 926 | 602 | 12.7s | 70 |
| `xhigh` | 1,443 | 546 | 14.7s | 53 |
| `max` | 2,738 | 519 | 19.1s | 38 |
| `none` | 0 | 596 | 6.8s | 128 |

**The default is heavy and tracks `max`** on compositional work (2,183 vs 2,738 reasoning tokens), light on trivia (49 reasoning tokens on 17×23) — adaptive-ish, but pin it: `medium` was 2x faster and 4x fewer reasoning tokens than default on the same prompt with the most complete answer. **`low` is not a lean gear here** — 2,046 reasoning tokens, ≈default. The cheap gears are `medium`/`high`, which is backwards from the Ember-1 pattern. Odd, n=1 per cell, re-probe before trusting the shape.

### Truncation trap reproduces

300-token cap, "explain TCP congestion control in detail": **all-reasoning, empty content, `finish: length` — at default AND at pinned `low`** (299/300 reasoning tokens). Reasoning shares the output budget. Budget output caps on any extraction call, exactly the DeepSeek/K3 rule. (One abstain-probe answer also returned empty content into a 1,500 cap at `low` — same signature.)

### Abstention probe (5 unanswerable traps, `low`)

4/5 clean abstains, 0 fabrications, with or without an abstention-licensing system prompt (the 5th was the empty-content truncation, not a fabrication). n=5, `low` only — this *softens* the AA 93% hallucination read for our use (AA runs no abstention hint at default effort) but does not overturn it: never a verifier until a real probe pack says so.

### Vision and throughput

Vision serves (64×64 red PNG → "Red", 107 reasoning tokens, 2.1s). Content throughput 38-86 tok/s at thinking gears, 128-136 with thinking off; streaming TTFT 0.9s. The 200+ tok/s claim is first-party DSpark serving, not this route.

---

## 6. Behavioral priors (until probed)

- **Fabricate-over-abstain under pressure** (AA-Omniscience 93%) — the Sol-family failure shape, opposite of M3. Never a factual verifier, never self-acceptance; external acceptance on anything that matters.
- **Verbose** (AA 180M output tokens/index) — real cost runs above the sticker; cache rate on the route unmeasured.
- **Eval-awareness unknown** — no Latch-style study; MiniMax trained it on agentic harnesses (BankerToolBench judged by MiniMax-M2.7, an own-family judge — self-grading adjacency worth noting).
- **Proactiveness/loop-bounding unprobed** — bound runs per standard practice.

---

## 7. Pros / cons

**Pros**

- Cheapest sticker in the guide at flash-class capability: AA 42-43 at $0.22/task, $0.15/$0.60/$0.015.
- **Best neutral row is genuinely strong:** AutomationBench-AA 72.5 independent, #2 overall, best open-weights, $0.07/task.
- Vision + 1M context + 512K output on our route; function calling; structured output on Fireworks.
- Real `none`/`off` gear on the raw route (verified) — extraction shapes routable, a gear GLM-F and DS lack.
- Throughput fine (38-86 tok/s thinking, 128+ off); 0.9s TTFT.
- Weights out (2026-10-23) — self-hostable in principle, though the license is non-permissive.

**Cons**

- **93% hallucinate-when-wrong (AA-Omniscience)** — kills the M3 verification niche; never a verifier.
- Coding unverified neutrally: vendor DeepSWE only; Vals TB4 25.25% weak; loses to DeepSeek on MiniMax's own table.
- Arena+ 1500 (29th/33) — weak preference showing.
- Verbose (180M out/index) — the sticker understates task cost.
- Default effort heavy; **`low` is not the lean gear** (probe); truncation trap at tight caps even at `low`.
- License is MiniMax Community (attribution + notice + $20M-auth), not Apache/MIT — the open-weight bias applies at reduced strength.
- Four days old; one neutral index read that already drifted a point.

---

## 8. When to use / when not

**Use (now):**

- A/B / duel against GLM-5.3-Flash and DeepSeek V4.1 Flash on the routine + hard packs — the deciding evidence for any seat change;
- cheap agentic business-workflow shapes (its one strong neutral row) where a failed attempt is cheap;
- probing the `none` gear for extraction (raw route only; budget the cap).

**Do not use for:**

- verification, fact-checking, librarian work (93% hallucinate-when-wrong — M3 keeps that seat);
- self-acceptance or "done" claims without external checks;
- unpinned-effort calls on capped outputs (truncation trap);
- durable seat changes on four-day-old evidence;
- quorum votes as a new family — it *is* a seventh-family-eligible MiniMax vote, but don't treat a four-day-old model as the deciding vote.

**Promotion criteria:** local duel parity-or-better vs GLM-5.3-Flash (routine + hard packs, pinned efforts); a neutral DeepSWE landing that confirms the vendor 73.7 within CI; re-read AA after the index settles. If all three land, the default-seat challenger picture becomes a three-way (DS default, GLM-F, M3.1F) — Matt's call.

---

## 9. Watch items

- DeepSWE leaderboard entry; AA index re-read (42→43 in three days — unsettled).
- Local duel vs GLM-5.3-Flash — the real seat test.
- Cache-hit rate on the Fireworks route; long-context needles (1M claim untested locally).
- Quality at `none` (extraction viability) and the `low`-is-not-lean anomaly (re-probe).
- M3.1 **Pro** — announced "arriving later"; when it lands it gets this protocol.
- License adoption: whether the Community License notice/attribution terms matter for any Matt use case.

---

## Sources

- https://www.minimax.io/blog/minimax-m31f (launch blog, 2026-10-19)
- https://fireworks.ai/models/fireworks/minimax-m3p1-flash (specs, pricing)
- https://huggingface.co/MiniMaxAI/MiniMax-M3.1-Flash (weights, MiniMax Community License, mxfp8)
- https://openlm.ai/minimax-m3.1/ (vendor benchmark table with harness disclosure)
- https://venturebeat.com/technology/minimaxs-new-m3-1-flash-beats-deepseek-and-opus-5-on-a-key-business-benchmark-at-lower-cost-but-with-a-high-hallucination-rate (AA 42, Omniscience 56%/93%, per-task costs, 2026-10-19)
- https://www.ridgebench.com/models/minimax-m3.1-flash + /news/minimax-m3-1-flash-1019 (AA 43 read 10-22, Arena+ 1500, Vals TB4 25.25%, 180M verbosity, $0.009/point)
- https://llmlearner.com/rankings/automationbench-aa (AA independent retest 72.5, #2, $0.07/task)
- https://the-decoder.com/minimax-m3-1-flash-shows-chinas-ai-price-race-has-no-floor-in-sight/ (HLE/CritPt cross-reads)
- https://models.dev/models/minimax/MiniMax-M3.1-Flash/ (24-provider price matrix)
- Local probes 2026-10-23: raw Fireworks chat-completions (effort enum, reasoning accounting, truncation, abstain n=5, vision, streaming throughput)
