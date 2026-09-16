# Claude Fable 5.1 — Evidence Brief

**pi ID:** `anthropic/claude-fable-5-1`
**Status in pi:** the juggernaut — drop-in successor to Fable 5 (Matt directive, 2026-09-09)
**Brief posture:** launch-week add. Fable 5 brief archived at `research/fable-5.md`; family-level evidence from it carries as priors, flagged where unmeasured on 5.1.

---

## 1. What it is

- **Vendor:** Anthropic, released 2026-09-01 ([anthropic.com/claude-fable-and-mythos-5-1](https://www.anthropic.com/claude-fable-and-mythos-5-1)). GA successor to Fable 5 (now legacy; retirement not sooner than 2027-06-09; 5.1's not sooner than 2027-09-01). Same announcement as **Mythos 5.1** — identical weights, safeguards tuned for cyber/life-sciences work, Project Glasswing / verification programs only.
- **Specs: unchanged from Fable 5.** 1M context / 128K max out, text+image in, adaptive thinking always on (cannot be disabled), same tokenizer, $10/$50. Knowledge cutoff moved Jan 2026 → **June 2026**. Defaults: effort `high` in Claude Code / API, `medium` on claude.ai/Cowork.
- **The economics change: cache reads $1.00 → $0.25 per 1M (0.025x base input; every other Claude is 0.1x).** Cache writes unchanged ($12.50 5m / $20 1h). Batch 50% ($5/$25). US-only inference 1.1x. Anthropic's own indexed-cost measurement (4 weeks of August 2026 usage, default effort): **~25% cheaper typical workloads, up to ~45% highly agentic** (cache-read-dominated loops). A Fable 5.1 cache hit is now *cheaper than an Opus 5 cache hit* ($0.25 vs $0.50) despite double the base price.
- **Availability:** Claude API, Bedrock, GCP, Microsoft Foundry, Claude apps/Code. **Priority Tier dropped** (Fable 5 had it). ZDR now available for eligible API customers as a bridge until Enterprise Frontier Safeguards (EFS — customer-VCI monitoring architecture) ships in phases fall 2026; otherwise 30-day retention stands.

## 2. Vendor claims (Anthropic-run, safeguards ON)

| Row | Fable 5.1 | Fable 5 | Opus 5 | Sol |
|---|---|---|---|---|
| Terminal-Bench Science 0.1 | 52.6 | 24.7 | 29.0 | 22.4 |
| Terminal-Bench 4.0 | 55.8 (Mythos 5.1: 60.9) | 42.0 | 52.3 | 37.3 |
| GDPval-AA v2 | 1853 | 1723 | 1824 | 1711 |
| OSWorld 2.0 (Aug-2026 release) strict/partial | 41.7 / 77.9 | 36.1 / 72.9 | 39.6 / 75.4 | — |
| HLE no-tools / with-tools | 60.9 / 65.0 | 57.8 / 63.8 | 56.6 / 63.6 | — |
| AutomationBench | 31.4 | 17.1 | 26.9 | 19.6 |
| CursorBench 3.2.0 | 73.4 | 70.5 | 70.0 | 67.2 |
| SWE-bench Pro (system card, via BenchLM) | 81.2 | 80.3 | — | — |

**Methodology notes (better than Fable 5's launch):** Anthropic ran the table with production safeguards on and scored **zero on intervened tasks** — so headline numbers are net of safeguard cost, and they say so. They publish SE (±3.5-4.5 on TB-Science) and reproduce the public leaderboard's Opus/Fable numbers within noise on their setup (29.0/24.7 vs public 30.0/21.4). OSWorld uses the authors' Aug-2026 task release with competitors re-run under same conditions — not comparable to older OSWorld prints, and they flag it. Fable 5's Stripe-vignette era this is not.

- **The one row that more than doubles: TB-Science 52.6 vs 24.7.** Long-horizon agentic research is the release's actual story (consistent with Anthropic's own framing: strongest gains on long-running problem-solving; low/medium effort ≈ Fable 5 at much lower cost — effort ladder is now a real cost lever, e.g. low effort ≈26% TB-Science at ~$11/task vs Fable 5 max's 24.7% at ~$44/task per launch coverage).
- **Mythos 5.1's TB4 60.9 vs Fable 5.1's 55.8** — the cleanest published quantification of the safeguard tax: ~5 points of agentic-coding capability locked behind the classifiers.

## 3. Neutral evals

- **AA Intelligence Index v4.1.1: 65.7 (max with fallback) — #1 in the field**, +3.6 over Fable 5 (62.1), ahead of Opus 5 (63.1) and GPT-6 Astra (61.2). Same-day 2026-09-03 read (printed in OpenAI's launch table; AA's own Astra article says Astra's 61 is "5 points lower than Claude Fable 5.1 (max with fallback)"). First same-version number that puts a Fable clearly at the top of the general-intelligence index.
- AA Coding Agent Index v1.4: **blank at Astra's launch** (OpenAI's table). A later AA model-page snapshot shows 81.6 at max w/fallback — but on a re-versioned scale that doesn't reconcile with v1.4 (where Fable 5 scored 67.2); hold until AA publishes a same-version comparison. AA version churn burned Fable 5 before (64.9→60 on a reweight) — same discipline applies.
- AA model-page per-effort snapshot (latency profile, the routing-relevant part): **first answer token 131s at `max`, 45s at `xhigh`, 9.4s at `high`, 6.2s at `low`**; ~71 tok/s output at max. Fable 5's 109s-TTFT-at-max interactive ban carries — and gets worse at max — but the ladder now exposes genuinely interactive-ish lower gears Fable 5 never demonstrated.
- DeepSWE v1.1: **67.4 as printed on OpenAI's launch chart** (provenance: their run) vs Fable 5's 69.9 ±4 — within noise; no DeepSWE upgrade signal, and Astra (74.1), Opus 5 (73.7), Gemini 3.8 Flash (73.8) top the same chart.
- BenchLM aggregate: 82.7/100, #1 of 229 — their weighting includes the system-card rows above; "independent external-consensus gate cleared, verified rank withheld pending coverage thresholds."
- No vals.ai / LMArena / METR / Latch entries yet.

## 4. Safeguards & fallback (updated materially from Fable 5)

- **Precision improved:** ~60% fewer cyber false-positive interventions per Claude Code session vs Fable 5's launch safeguards; ~85% fewer elementary/medical-biology false positives; research biology still routes to Opus. **Defensive source-code vulnerability discovery is now allowed on-model** (was blocked on 5); exploit generation, pentest, binary vuln scanning still redirected.
- **Fallback targets unchanged:** cyber → Opus 4.8 (still the retired model — the guide's "don't mirror legacy fallbacks, use Opus 5 directly" note carries), biology → Opus 5. Intervened tasks in the launch eval were completed by those models.
- **The exosphere finding (Fable 5, 2026-08-09: cyber filter framing-immune, 4/4 blocks incl. authorized-preamble retries) is a family-architecture prior** — 5.1's classifiers are the same policy gates with better precision. Assume red-team-shaped work still blocks until probed on 5.1; Anthropic's own taxonomy (high-risk dual use is policy-gated, not prompt-tunable) is unchanged.

## 5. Migration / operational contract (what "drop-in" does and doesn't mean)

Same price, specs, tokenizer, thinking mode, seat — a model-ID swap for routing purposes. Three **breaking** API changes:

1. **Forced tool use rejected** — `tool_choice: {"type":"any"}` / `{"type":"tool"}` returns a 400. Use `auto` + instruction (+ `strict: true` / structured outputs).
2. **Earlier models cannot read 5.1's thinking blocks.** 5.1 reads older models' blocks; the reverse fails — a router/fallback moving a 5.1 conversation to Opus 5 drops the blocks (unbilled) and the target re-plans. Mid-session downgrade loses thinking; the guide's no-hot-swap hygiene stands.
3. **Editing earlier turns invalidates thinking blocks** after the edit.

Additive: per-message effort (beta — change effort mid-conversation without busting the prompt cache), turn-scoped system messages (beta), `display: "updates"` progress between tool calls, content provenance, the cache-read cut.

## 6. Local / hands-on

- **Route probe (2026-09-09):** `pi -p` one-shot on `anthropic/claude-fable-5-1` — answers, ~5.9s wall at pi default effort. Route healthy.
- No local duel, no safeguard probe on 5.1 yet. Fable 5's local history (exosphere 4/4 blocks) is the family prior.

## 7. Seat read

- **Juggernaut seat transfers from Fable 5 unchanged** (Matt directive: drop-in). Same protocol: conscious invocation, prep with cheaper agents so its tokens go to execution, batch/async for max effort, never sole security reviewer, Opus 5 directly for known cyber/bio.
- What changed for the better: **~25-45% cheaper effective cost** (cache economics — the prep-heavy pattern Fable routing already mandates is exactly the cache-read-dominated shape that saves most); AA 65.7 makes it the general-intelligence frontier rather than co-frontier; TB-Science 52.6 more than doubles the long-horizon research row; effort ladder is now a cost/latency lever (low ≈ Fable 5 quality at ~¼ price); ZDR path exists for eligible customers; knowledge cutoff June 2026.
- What carries as Fable-5-measured priors (unmeasured on 5.1, same family): Endor Labs 19% SecPass / record memorization — keep the never-sole-security-reviewer ban; 20.9% Terminal-Bench fallback rate (5.1's is claimed lower via precision, unverified); Roboflow mid-pack vision.
- What got worse: TTFT at max 109s → 131s (AA snapshot); Priority Tier gone; three breaking API edges for harnesses that force tools or rewrite history.
- vs GPT-6 Astra (same $10/$50 sticker, added 8 days later): Fable 5.1 owns general intelligence (65.7 vs 61.2), knowledge work (HLE 65.0 vs 57.2, GDPval 1853 vs no-entry), and cache-heavy long loops ($0.25 vs $1 reads). Astra owns coding-agent efficiency (CAI 67.0 ≈ Fable 5's 67.2 at <½ per-task cost), computer use, science/automation rows, and cyber capability (gated). Route by work shape; see the Astra brief.

## 8. Watch items

- AA same-version CAI for Fable 5.1 (the Astra head-to-head coding number).
- Safeguard probe on 5.1 (exosphere-style) — does the framing-immune cyber block carry at the claimed higher precision?
- Endor-style independent real-CVE rerun (SecPass/memorization priors from 5).
- vals.ai SWE-bench Verified (5's 95.0 was the defensible baseline; 5.1's SWE-bench Pro 81.2 is system-card only).
- Fallback-rate measurement on 5.1 (Anthropic claims fewer interventions; 20.9%-on-TB was the 5 number).
- EFS rollout (fall 2026) — changes the retention story for regulated work.
- Muse Spark 1.3: AA's Astra article notes it trails only Fable 5.1 on the Intelligence Index — Meta's flagship is now in Fable's rearview; watch for a seat challenge.
