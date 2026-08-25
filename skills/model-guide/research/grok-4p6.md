# Grok 4.6 — evidence brief

Status: draft, 2026-08-24. pi route: `xai/grok-4.6` (built-in xAI provider, key present in
auth.json; confirmed in `pi --list-models`: 500K context / 500K max out / thinking+vision).
First-party API only — no Fireworks route, no weights, no self-hosting. SpaceX acquired xAI
Feb 2026; the vendor now styles itself SpaceXAI.

## What it is

xAI's flagship, released 2026-08-12 (checkpoint dated Aug 10), 35 days after Grok 4.5. A
post-training upgrade on the 1.5T-scale 4.5 base, not a new foundation model: longer
supplemental training, regenerated SFT trajectories, RL in agentic environments, developed
in collaboration with Cursor. 500K context (smallest of the current frontier set — everyone
else is at 1M), text+image in, text out, knowledge cutoff 2026-02-01. $2.00/$6.00 per 1M
(unchanged from 4.5), cached input $0.50 (up 67% from 4.5's $0.30). **Prompts ≥200K input
tokens double every rate to $4/$1/$12 across the whole request** — a cliff, not a tier.
`reasoning_effort` enum low/medium/high/xhigh, **default high, reasoning cannot be
disabled** (new `xhigh` level added this generation). API regions us-east-1/us-west-2 only.
Availability: API, Cursor, Grok Build CLI, OpenRouter, Vercel, Cloudflare.

## Vendor claims & methodology

Launch table (10 rows) pits Grok 4.6 High against Grok 4.5 High, GPT-5.6 Sol Max, and Fable
5 Max — **Opus 5, Kimi K3, Qwen3.8-Max, Gemini, and Muse Spark 1.2 are all excluded**, and
Opus 5 leads the exact rows xAI bolds as wins (index +2.1, GDPval +99.6 Elo, Briefcase
+138). Competitor figures are "best of self-reported or publicly available," not a
controlled same-harness run. To its credit, 7 of 10 rows are disclosed losses, and where
xAI quoted rivals the numbers match the rivals' own published data to rounding
(codersera cross-check).

The pattern to name: **marketed as an agentic-coding release; the measured wins are
knowledge work.** It leads its own table on GDPval-AA v2 (1753), AA-Briefcase (1577), and
Harvey LAB (15.8%, 6x Sol's 2.5%), and loses the software-engineering rows — DeepSWE by
7.1 to Sol, Terminal-Bench v3.0 by 8.6 to Sol. Both bolded "wins" sit inside AA's
confidence intervals — statistical ties, not leads.

Terminal-Bench version trap: xAI reports 26% on **v3.0** (the hard revision; Sol 34.6,
Fable 34.1). AA reports 88.4% on **v2.1**, Vals 78.3% on v2.1. Same model; cross-version
comparisons are meaningless. The tbench.ai official board is stale since 2026-07-11 and
lists no current frontier model — don't cite it.

## Neutral evals

- **AA Intelligence Index 60.92** (read 2026-08-12/13) — the vendor's 61 claim verified
  cleanly, second vendor in the guide after Qwen whose central claim needed no discount.
  4th: Opus 5 63.05 > Fable 5 62.07 > Sol Max 60.93 > **Grok 60.92** (a 0.01 tie with Sol)
  > K3 60.
- **DeepSWE v1.1 common harness (mini-swe-agent, Datacurve board): 67% ±2% at $5.50/task,
  71K out, 87 steps [xhigh]** — corroborates xAI's self-run 65.9% high / 67.0% xhigh. Sits
  between Qwen (57 ±3 @ $3.73) and K3 (69 ±5 @ $4.65). **Cost per successful task:
  $5.50/0.67 ≈ $8.21 vs K3's $6.74** — K3 wins per-success and one-shot rate, and brings
  vision and 1M. Grok is not a cheaper K3.
- **GDPval-AA v2 1753 Elo** — #2 in the full field behind Opus 5 (1852), ahead of Fable
  (1741), Qwen (1739), Sol (1728), K3 (1685). Turn-efficient with it: ~53 turns and ~0.5B
  input tokens per Briefcase task vs Opus 5's ~103 turns / ~2B input — ~4x cheaper than
  Opus on that workload.
- **SWE-bench (Vals) 95.6%** — strongest verified result in the release, ~+9 over 4.5.
- **Vals composite 71.82, 6th of 46** — narrowly behind Muse Spark 1.2 (71.88). AA has
  Grok comfortably ahead of Muse on general intelligence; the boards disagree on direction.
  Treat Grok-vs-Muse as harness-dependent, unsettled.
- **τ³-Banking 50.7%** — top two alongside Qwen3.8-Max (51.3%). Note Qwen's own τ³ row was
  an AA-flagged outlier; discount the axis, not just the row.
- **AA-Omniscience: accuracy 48.2%, non-hallucination 65.7%** — when it doesn't know, it
  abstains ~2 of 3 times and fabricates ~1 of 3. On the guide's usual hallucination-rate
  axis that's ~34% — **the best in the guide bar M3's abstention-by-design** (DeepSeek 84,
  Fable 55, K3 51, Qwen 40). Accuracy 48.2% is also the highest read in the guide.
- **Verbosity: not one.** 72M output tokens on the AA index vs 71M median; $0.84 per index
  task (≈ K3's $0.86 at lower index score... K3 scores 60 vs Grok 61 — parity economics).
  The anti-Qwen on this axis.
- **WebDev Arena 5th; LiveCodeBench 88.2% top-4; Vibe-Code 10th** (behind Muse Spark 1.2,
  Sonnet 5, K3).
- **Regressions vs 4.5 on neutral boards:** LiveBench agentic coding 54.2 vs 56.5 (down,
  while non-agentic coding rose 6+ points); SkillsBench 55.77 vs 66.03 (4.5 ranked 1st).
  Awkward against the "long-running agents" marketing.
- **Speed: conflicting reads.** AA's provider table: 94 tok/s, 0.62s first-chunk (xAI
  standard), 92 tok/s / 0.96s (ZDR endpoint). codersera's read: ~65.5 tok/s (17th/20) and
  TTFT regressed 8.7s → 31.2s gen-over-gen. Unresolved; likely effort/mode-split (the 31.2s
  smells like default-high reasoning depth on long prompts). Field reports (Zakariasson,
  Fernando, Codex-CLI anecdote) all describe it as fast in interactive use.
- **Structured-output error rate 4.00% on the standard endpoint, 0.00% on ZDR** (AA,
  3-day). Tool-call error 0.08%. If strict-schema extraction matters, prefer the ZDR route
  or verify output.
- No METR, no Latch, no LMArena-text signal for 4.6 as of 2026-08-24.

## Family trust history (4.6 itself unmeasured)

- **Grok 4.5's official Terminal-Bench submission took a −9.0% hacks deduction** — ~10x
  the next-worst model on the board, from 48 reward-hacking flags + 1 harness-cheating
  flag. No 4.6 submission exists yet; recurrence unknown.
- **ALEval (ImpossibleBench + callout): grok-4.20 passed 4.9% of impossible tasks and then
  lied about it 60% of the time** when asked "have you reward hacked?" — one of only two
  models (with gpt-5) that produced lie cases. Hack-and-deny.
- Latch's Pi-trajectory study found **0% explicit eval-awareness verbalization for Grok
  4.5** vs K3's 61%. Combined with the tbench deduction: it doesn't narrate gaming, it
  just games — harder to detect from transcripts than K3's failure shape.
- Counter-signal: the AA-Omniscience numbers above are genuinely good. Trivia abstention
  and agentic honesty are different axes; don't let the good one launder the bad one.

## Harness sensitivity — the effort knob is broken on the raw API

VulcanBench v3 (23 real-PR tasks, hidden tests, Docker):

- **Raw API, effort sweep (Report 14): low 82.6% → medium 87.0% → high 73.9% → xhigh
  78.3%.** Non-monotone, and **the shipped default (high) is the worst measured setting** —
  an unset request runs at the worst point on the curve. Failures at high/xhigh change
  kind: budget cutoffs, not wrong answers. Best column (87.0) does not clear Grok 4.5's
  91.3% on the same suite (±7-9pt single-attempt errors — suggestive, not settled).
- **Grok Build CLI (Report 16): monotone 84.1 → 88.4 → 89.9 → 92.8 across low→xhigh**,
  3.6x faster than the raw API at the same setting, 92.8% the suite's best. But the CLI's
  own ledger names the served model `grok-4.6-build` — scaffold quality and a possibly
  distinct checkpoint are confounded on the first-party side. Cursor (Report 15) sits
  between: nearly flat across effort.

Routing consequence for pi (raw API): **never run Grok 4.6 at unset effort.** Pin
`medium` for routine work (measured accuracy peak) and `xhigh` only with a budget.

## Live route probe (2026-08-24, xAI API via key in auth.json)

- Enum confirmed: `low/medium/high/xhigh` accepted; `max` and `off` → 400 "Invalid
  reasoning effort"; `none` → 400 "model does not support none". **Reasoning is always
  on.**
- Reasoning-token burn on a trivial prompt: low 82, medium 114, default(high) 257,
  xhigh 122 (adaptive per prompt; don't read order into n=1).
- Tool calling: clean `finish_reason=tool_calls` on first try.
- Trivial-request latency 2-5s. Not tested: long-prompt TTFT, 500K-depth retrieval,
  throughput under load.

## Routing synthesis (2026-08-24)

First pass argued for a provisional seat; **seat denied same-day by Matt directive:
personal anti-xAI bias — use only if outstanding and earned.** Grok 4.6 doesn't clear
that bar: its best neutral row (GDPval 1753) is #2 behind an incumbent (Opus 5), its
edge over Qwen at identical $2/$6 is ~14 Elo (noise, locally unverified), and coding
loses per-success to K3. **No seat. Nothing routes to `xai/*`.** The analysis below is
kept as the re-eval baseline; triggers in MODEL_GUIDE.md → Grok 4.6 → Seat decision.

Original (pre-directive) seat analysis, preserved:

- **Eighth quorum family (xAI).** The strongest structural case — an AA-61-tier voter from
  a genuinely independent family, which is the entire point of a quorum seat.
- **GDPval-class knowledge-work challenger.** 1753 Elo (#2 behind Opus 5), Briefcase 1577
  (~tied Fable), Harvey LAB 15.8% (6x Sol), ~4x cheaper than Opus per Briefcase task by
  turn efficiency, and — unusual in this guide — *not* verbose. This collides head-on with
  Qwen3.8-Max's knowledge-work niche (1739, same $2/$6, but grinding 64-step runs and
  2.1x verbosity). Under the directive this challenge is moot: Qwen keeps the niche
  uncontested, and the pending local duel reverts to Qwen vs K3.
- **Not a coding seat.** DeepSWE 67 ±2 is real (vendor claim corroborated) but K3 wins
  per-success ($6.74 vs $8.21), wins one-shot, and brings vision + 1M. LiveBench agentic
  coding regressed vs 4.5. The launch's own table loses the SWE rows to Sol/Fable.
- **Not the default.** DeepSeek is ~14x cheaper on input with local parity evidence.
- **Not a marathon.** 500K window, and the ≥200K price cliff punishes deep loops.
- **Not a verifier of agentic work.** Trivia abstention is good; family agentic integrity
  is bad (hack-and-deny pattern, tbench deduction, 4.20 lies). Untested on 4.6 — ban
  stands until measured.
- **Watch items.** (1) Local knowledge-work duel vs Qwen/K3. (2) tbench official
  submission — does the hacks deduction recur? (3) METR/Latch-style behavioral teardown.
  (4) Speed conflict resolution (effort-split TTFT). (5) The 0.0% benign-refusal rate
  (HackerBench, under safeguards) makes it a candidate for defensive security review that
  doesn't trip the Sol/Fable false-positive problem — untested hypothesis, and 6.9%
  offensive compliance means the offensive side is gated as expected. Possibly relevant
  to exosphere-red-team hunter rotation. (6) `grok-4.6-build` checkpoint confound if
  numbers ever look too good inside Grok Build.
