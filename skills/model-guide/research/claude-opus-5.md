# Claude Opus 5 — Model Evaluation Brief

Now in `pi --list-models` (1M / 128K / thinking+vision) — specs confirmed. | Compiled 2026-07-24 | Bar: skeptical teardown, not vendor marketing

---

## 1. What it is

- **Vendor**: Anthropic. **Release**: July 23–24, 2026 (rolled out across providers; announcement dated July 24). Succeeds Opus 4.8 (May 28, 2026) as the Opus-tier flagship. [anthropic.com/news/claude-opus-5](https://www.anthropic.com/news/claude-opus-5)
- **Positioning**: "comes close to the frontier intelligence of Claude Fable 5 at half the price" — a pitch against Anthropic's own Mythos-class flagship, not rival labs. The everyday enterprise model, below Fable 5/Mythos 5 in the tier hierarchy. Default model on Claude Max; strongest model on Claude Pro.
- **Context / output**: 1,000,000 token input context (default, no beta header), 128,000 token max output (300K via Message Batches API with `output-300k-2026-03-24` beta header). Unchanged from 4.8. [platform.claude.com/docs/en/about-claude/models/overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- **Modalities**: text, images, files as input. Knowledge cutoff May 2026 (up from 4.8's Jan 2026).
- **Pricing**: standard $5/M input, $25/M output — identical to 4.8. Fast mode (2.5x throughput): $10/M input, $50/M output (2x base, same as 4.8). Prompt caching up to 90% savings, batch processing 50% savings. US-only inference available at 1.1x pricing. [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **API ID**: `claude-opus-5` (Claude API, Vertex AI, Claude Platform on AWS); Bedrock-style `anthropic.claude-opus-53`. Model ID format is dateless (same as 4.8).
- **Closed/open**: fully closed. No weights, no self-hosting. API/Bedrock/Vertex/Foundry only.
- **Now in `pi --list-models`** — confirmed at 1M / 128K / thinking+vision within hours of launch.

---

## 2. Drop-in replacement for 4.8

The only required code change is the model ID string: `claude-opus-4-8` → `claude-opus-5`. Everything else carries over:

| Surface | Opus 4.8 | Opus 5 | Same? |
| --- | --- | --- | --- |
| Price | $5 / $25 | $5 / $25 | ✅ |
| Context window | 1M (default) | 1M (default) | ✅ |
| Max output | 128K (300K batch beta) | 128K (300K batch beta) | ✅ |
| Tokenizer | Opus-4.7-era | Opus-4.7-era (unchanged) | ✅ |
| Effort default | `high` | `high` | ✅ |
| Adaptive thinking | always-on | always-on | ✅ |
| Extended thinking (`thinking.type:"enabled"`) | No | No | ✅ |
| Vision/multimodal | yes | yes | ✅ |
| Data retention | none required | none required | ✅ |

Anthropic ships a `/claude-api migrate ... to claude-opus-5` skill and a [migration-guide section](https://platform.claude.com/docs/en/about-claude/models/migration-guide) for the 4.8→5 path. 4.8 remains available — not a forced cutover.

New features shipped alongside the launch (both beta):
- **Automatic API fallbacks**: safety-flagged requests route to the best available model instead of blocking. With fallbacks on, requests always route to the best available model by default.
- **Mid-conversation tool changes**: developers can change which tools Claude can use within a conversation without invalidating the prompt cache.

---

## 3. Vendor benchmark claims + methodology critique

All performance numbers are Anthropic-run on Anthropic's own harnesses. Day-one, so no neutral cross-checks exist yet.

- **Frontier-Bench v0.1**: Anthropic claims SOTA, "more than doubles 4.8's score at lower cost per task." Footnote: "internal run of Frontier-Bench v0.1, on the mini-SWE-agent harness and a GKE backend, mean reward over 5 attempts per task." **Notable: 4.8 served as safety-classifier fallback for Opus 5 and Fable 5** — meaning some of Opus 5's "wins" include tasks where 4.8 answered after a refusal.
- **CursorBench 3.2**: "at max effort, within 0.5% of Fable 5's peak score, but at half the cost per task." Also "greater performance at a given cost than all other models on high, xhigh, and max effort."
- **ARC-AGI 3**: "score is three times as high as the next-best model."
- **Zapier AutomationBench**: "pass rate is around 1.5× the next-best model for the same cost per task."
- **OSWorld 2.0**: "outperforms every other model at any given cost, surpassing Fable 5's best result at just over a third of the cost."
- **Life sciences**: "better performance than 4.8 on every one of our life sciences evaluations" (structural biology, organic chemistry, bioinformatics). Most notable gains: organic chemistry +10.2pts, protein-function prediction +7.7pts.

Methodology concerns (same pattern as 4.8):
- All evals are Anthropic-run on Anthropic-chosen harnesses/scaffolding.
- Effort-plot presentation: performance plotted by effort tier, but competitor tiers unspecified (same ambiguity as 4.8's launch).
- Early-access vignettes (FreeCAD machine-part from raw pixels, open-source bug fix finding root cause, market data feed with self-built test harness) are single-run testimonials, not controlled evals.
- No independent benchmark numbers exist yet (AA, DeepSWE, vals.ai, LMArena all pending).

---

## 4. Neutral / independent evals — pending

**Day-one: no blind or independent evals exist.**

- **Artificial Analysis Intelligence Index v4.1**: No Opus 5 entry. Current leaderboard: Fable 5 (with fallback) 60, GPT-5.6 Sol 59, Opus 4.8 (max) 56, GPT-5.5 (xhigh) 55. [artificialanalysis.ai/providers/anthropic](https://artificialanalysis.ai/providers/anthropic)
- **DeepSWE**: No entry.
- **vals.ai SWE-bench Verified**: No entry.
- **LMArena**: No entry.

Treat all performance claims as provisional pending blind verification — same standard the guide applied to GPT-5.6 at launch. The key open question from 4.8: whether vendor coding superiority claims survive neutral harnesses (4.8's "beats GPT-5.5 on hard coding" flipped under DeepSWE — GPT-5.5 led by 9-12pts; Cursor's audit found 63% of 4.8's SWE-bench Pro "wins" were retrieval, not derivation).

---

## 5. Alignment and safety

- **Most-aligned model to date** per Anthropic's automated behavioral audit: misalignment score 2.3 (lowest of recent models), lowest deceptive-behavior rate, least susceptible to misuse tricks. Adheres to Claude's Constitution better than 4.8, Sonnet 5, or Fable 5. [anthropic.com/news/claude-opus-5](https://www.anthropic.com/news/claude-opus-5)
- **Does not advance the dual-use frontier**: behind Mythos 5 on bio research and offensive cybersecurity. Close to Mythos 5 at *finding* vulnerabilities, substantially behind on *exploitation* (OSS-Fuzz eval).
- **Cyber classifiers**: proportionally less restrictive than Fable 5 (~85% less intervention expected). Allows finding vulnerabilities in source code; blocks binary-based scanning, penetration testing, exploit generation. In Claude.ai/Code/Cowork, flagged requests fall back to Opus 4.8 by default. Cyber Verification Program (CVP) enterprises get a version with fewer restrictions.
- **Biology**: same safeguard suite as 4.8. Fable 5 biology-blocked requests now route to Opus 5 (previously 4.8). Now the most capable generally available model for scientific research.
- **No data retention requirements** for general access (same as 4.8, unlike Fable 5/Mythos 5 which require 30-day retention).
- **System card**: [anthropic.com/claude-opus-5-system-card](https://www.anthropic.com/claude-opus-5-system-card)

Caveat (same as 4.8): "most aligned" is measured on Anthropic's own behavioral audit. No independent instrument exists yet. Eval-awareness is a documented confound (4.8's system card: grader awareness ~5% of cases).

---

## 6. Behavioral properties

- "Thoughtful and proactive" — Anthropic's framing. Stronger self-verification and agency than 4.8 per early-access reports (writing computer vision pipelines unprompted, finding root causes community patches missed, building test harnesses when no validation feed exists).
- **Inherits 4.8's open questions** (no neutral data yet to confirm or deny carryover):
  - Whether vendor coding leads survive neutral harnesses (4.8's didn't — DeepSWE reversed the GPT-5.5 comparison).
  - Whether honesty/alignment claims hold under independent measurement (4.8's "4x honest" had no independent instrument).
  - Whether real-world regression complaints carry over (4.8: thrashing, instruction-following, progress destruction, forced balance-slot criticism).
  - Whether Vending-Bench/business-negotiation regression carries over (4.8 removed business-skills training → worse negotiation).
  - Whether prompt-injection behavior improved or carries 4.8's API-level regression (7% vs 4.7's 2.3%).

---

## 7. Availability

Available on Claude API, Claude.ai, Claude Code, Claude Cowork, Amazon Bedrock, Google Cloud (Vertex AI), and Microsoft Foundry. Default model on Claude Max; strongest model on Claude Pro. Also available on Claude Team and Enterprise.

---

## 8. Decision summary

**Verdict: straightforward drop-in for 4.8 at the same price.** Use Opus 5 where you used Opus 4.8 — the API surface, pricing, context window, output limits, tokenizer, and effort defaults are all identical. The only change is the model ID string. Don't trust vendor benchmark superiority claims until blind evals arrive (4.8's didn't survive neutral harnesses, and this is the same vendor on the same harnesses). Revisit this brief when AA Index, DeepSWE, vals.ai, or LMArena numbers land.
