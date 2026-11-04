# Kimi K3.1 Pro — evidence brief

Launched 2026-10-23 (Moonshot), weights released ~2026-11-04. Fireworks serverless: `accounts/fireworks/models/kimi-k3p1-pro`, $2.00 / $0.20 cached / $10.00 per 1M. 2.78T MoE, 104B active, 93 layers, 1M context, native vision (text+image in), MXFP4 weights / MXFP8 activations. Post-trained from K3 with large-scale joint RL across "hundreds of downstream domains" — same architecture, much more post-training compute. Not a new base model.

## Neutral evals (Artificial Analysis, v5.0.1 index)

- Intelligence Index: **55** (4th overall), vs K3 (max) 44 — an 11-point jump in one post-training cycle. Trails Opus 5.5 (58), Sonnet 5.5 (56), Muse Wonder Full (56).
- Terminal-Bench 4.0 (AA's own mini-swe-agent harness, 66 tasks, 3 repeats): **67.2% — highest of any model AA has run**. Sonnet 5.5 63.6%, Opus 5.5 59.6%, K3 12.6%. Notably *higher* than Moonshot's own Claude-Code-harness 65.7% — the score survived leaving the vendor harness.
- AutomationBench-AA: 73% (K3 58%). GDPval-AA: 1,846 Elo (K3 1,534; Opus 5.5 1,866). AA-Briefcase: ~1,675 (K3 1,497; Sonnet 5.5 leads at 1,824).
- AA-Omniscience: 20 → 30; hallucination rate 53% → 44%, accuracy 48% → 51%. Improved abstention, still not a verifier.
- Moderate elsewhere: HLE 47→52%, CritPt 23→25%, SciCode 59→61%.

## Caveats

- The 13%→67% Terminal-Bench jump is a post-training-targeted gain; generalization to unmeasured agentic work is open.
- Harness sensitivity is real: Opus 5.5 swings 59.6 (AA/mini-swe-agent) to 66.4 (Moonshot/Claude Code) — the K3.1 Pro vs Opus ordering inverts between harnesses.
- Weak spots in Moonshot's own table: Terminal-Bench-Science 38.1% (Opus 63.3, Astra 68.1), ProgramBench 31.5% (Opus 65.0). LiveBench 2.0: 76.7, 14th — behind DeepSeek V4.1 Flash (79.2) and Opus 5.5 (86.5). Bito coding: 72%, flat vs K3, behind Sonnet 5.5 (75%) and Opus (87%).
- No SWE-bench Verified entry, no Vals/Epoch/Aider coverage, no system card as of 2026-11-04.
- AA-PersonalityBench: biggest personality shift AA has measured between a model and its predecessor — clusters with GPT-6.1 Sol/Astra now, not with K3/GLM-5.3. More organized/terse, less warm/expressive. Treat K3 behavioral priors as partially void; the eval-awareness/imaginary-grader failure mode is unprobed on K3.1 Pro specifically (keep the ban until probed).
- Speed: ~32 tok/s on Kimi's API, 131s TTFT (vs K3's 44 tok/s, 69s). Fireworks route untested — K3 was 163 tok/s there vs 33 first-party, so measure before weighting.

## Cost

First-party prices dropped 33% vs K3 ($3/$15 → $2/$10) while output per task rose 14% (48K → 55K tokens) — AA cost per task flat at ~$1.98-2.00. Fireworks serverless matches the $2/$0.20/$10 sticker. Roughly Sonnet 5.5's per-token price at a fraction of Opus's $4/$20.

## Verdict

Real, third-party-confirmed jump over K3 — the K3 seat's heir apparent for paired frontier execution. vs Sonnet 5.5: index 55 vs 56 (statistical tie), ahead on AA Terminal-Bench (67.2 vs 63.6) and AutomationBench, behind on Briefcase and Bito coding. Unseated pending local duels; K3 bans (no verifier, no self-acceptance) carry until the eval-awareness probe is re-run.
