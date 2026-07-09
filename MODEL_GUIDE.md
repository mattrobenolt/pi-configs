# Model Guide

A living evaluation doc for picking which model a subagent should run on — and a light policy layer that shapes agent model selection over time. It accumulates findings rather than getting rewritten each pass.

Specs are from `pi --list-models` (operational truth for this setup, not vendor headlines). Prices are USD per 1M tokens, list price; the Fireworks-hosted three reflect the configured `fireworks` provider. **AA Index** is the Artificial Analysis Intelligence Index v4.1 (independent composite, ~0-100) — the one neutral number available across all eight. Context-window caps are intentional, not deficiencies (see the note at the bottom).

## How to maintain this doc

- **Findings logs are append-only.** Each model has a dated `Findings log` that accumulates evidence. Never edit a past finding in place — append a new dated entry that supersedes it if the picture changes, and update the stable blocks above to reflect the current synthesis.
- **Stable blocks evolve.** `What it is`, `Vendor claims & methodology`, `Neutral evals`, `Behavioral properties`, `Pros`, `Cons`, `When to use`, `When not to use` are the current synthesis — rewrite them as understanding improves. The Findings log is the audit trail.
- **Skepticism is the default.** Vendor claims go in `Vendor claims & methodology` with the methodology critiqued. `Neutral evals` is the field that matters most — hunt for the independent number that confirms, qualifies, or contradicts the vendor headline. Every model in this guide had a vendor headline that partially failed a neutral cross-check; assume the same of future models.
- **Source briefs live in `research/model-guide/<slug>.md`.** Log a top-level Changelog entry when a model's synthesis materially changes.

## Canonical list

| ID (`provider/model`) | Family | Context | Max out | Vision | Price (in/out) | Cached in | AA Index |
| --- | --- | ---: | ---: | :---: | --- | --- | ---: |
| `fireworks/accounts/fireworks/models/glm-5p2` | Z.ai (GLM) | 1M | 131K | no | $1.40 / $4.40 | $0.26 | 51 |
| `fireworks/accounts/fireworks/models/minimax-m3` | MiniMax | 512K | 33K | yes | $0.30 / $1.20 | $0.06 | 55 / 44 |
| `fireworks/accounts/fireworks/models/kimi-k2p7-code` | Moonshot (Kimi) | 262K | 33K | yes | $0.95 / $4.00 | $0.19 | 42 |
| `openai-codex/gpt-5.5` | OpenAI | 272K | 128K | yes | $5 / $30 | $0.50 | 60.2 |
| `openai-codex/gpt-5.4-mini` | OpenAI | 272K | 128K | yes | $0.75 / $4.50 | $0.075 | 40 |
| `anthropic/claude-sonnet-5` | Anthropic | 1M | 128K | yes | $2 / $10 (intro; $3/$15 after 2026-08-31) | — | 53 |
| `anthropic/claude-opus-4-8` | Anthropic | 1M | 128K | yes | $5 / $25 | — | 61.4 |
| `anthropic/claude-fable-5` | Anthropic | 1M | 128K | yes | $10 / $50 | — | 60 |

Provider prefix note: it's `openai-codex`, not "openapi-codex". M3 has two AA variants (reasoning 55 / non-reasoning 44).

## Selection protocol

**Default to GLM 5.2.** Low cost, strong quality, Matt's personal default. Use it as the stand-in for an agent unless there's a reason not to. It's text-only — if the task needs vision, pick something else. The neutral data supports this for routine delegated text coding; the one catch is a silent-undercounting failure mode (see its section) — don't use it as a verifier where unflagged wrong numbers are costly.

**Open-weight bias for day-to-day; closed when it makes sense.** Day-to-day work leans GLM / Kimi / MiniMax. Pull closed models (Claude, GPT) in for quorums or when their specific strength is the point. Don't default to them just because they're frontier — and don't trust "closed beats open" headlines: under neutral harnesses the closed-model coding leads shrink or reverse (see Opus 4.8, GPT-5.5).

**Quorums across discrete families for decisions.** For review, critique, or design choices, run models from *different* families — not several from one vendor. Families: Anthropic, OpenAI, Moonshot, MiniMax, Z.ai. Fireworks is a host, not a family. A valid 3-family quorum is `Opus 4.8 + GPT-5.5 + GLM 5.2`; `Opus + Sonnet + Fable` is not (all Anthropic). Quorums are for decisions, not every execution task.

**Fable 5 is a consciously-invoked juggernaut.** Very good, very expensive, and latency-bound (109s to first token at max effort — batch/async only). Pull it in only when the work is deemed worth it. Protocol: spend cheap-agent tokens liberally on research, planning, and context-gathering first, so Fable receives a well-prepped prompt and spends its expensive tokens on hard execution.

**MiniMax M3 is never a coding agent.** Non-coding only — verification/librarian work and cheap multimodal. See its section.

---

## GLM 5.2 — `fireworks/accounts/fireworks/models/glm-5p2`  *(the default)*

**What it is.** Z.ai (Zhipu), released June 13 2026. 744B MoE (~40B active), MIT license, no regional limits. 1M context via IndexShare (cuts per-token compute ~2.9× at 1M); 131K out. **Text-only.** Two effort levels: High / Max. $1.40/$4.40, cached $0.26. Shipped with zero benchmark numbers at launch (the scorecard followed June 16).

**Vendor claims & methodology.** Z.ai's own table is more honest than most — it openly shows GPT-5.5 and Opus 4.8 beating GLM 5.2 on several rows. The problem is the *headline distilled from it*: "beats GPT-5.5 on long-horizon coding at 1/6 cost" cherry-picks the rows GLM 5.2 wins (SWE-bench Pro +3.5, FrontierSWE +1.8, SWE-Marathon +1.0) and omits that GPT-5.5 beats it on DeepSWE by **23.8 points on the vendor's own table** — arguably the hardest long-horizon benchmark in the set. SWE-bench Verified (the one clean legacy metric, which GLM 5.1 reported at 77.8%) is conspicuously not reported. The per-token price is genuinely ~1/6-1/7 of frontier; the per-task price is not — see behavioral.

**Neutral evals.** AA Intelligence Index: **51, highest open-weight** (Opus 4.8 ~56, GPT-5.5 ~60, Fable 5 ~60). **DeepSWE holds up under independent measurement: 44-46% pass@1** corroborated by the benchmark's own maker (Datacurve), an aggregator (kie.ai), and the vendor — *no MiniMax-style collapse*. SWE-bench Pro > GPT-5.5 (62.1 vs 58.6) survives a neutral Scale AI SEAL harness (1,865 tasks). LMArena WebDev: #2, 59 Elo behind Fable 5; Agent category Fable wins ~3x. CritPt (independent physics reasoning) 20.9 vs GPT-5.5's 27.1.

**Behavioral properties.** **Text-only is a hard, independently-confirmed wall** (screenshots/diagrams/charts/UI-by-eye are out). **Reasoning-token verbosity: ~2-2.7x GPT-5.5's token spend at Max effort** (45K vs 16K on a documented task; 43K on AA's suite) — so per-task cost runs ~$0.46 vs MiniMax M3's $0.18, materially shrinking the "1/6 cost" advantage. **Silent under-counting failure mode:** an independent GLM-vs-Kimi audit found GLM 5.2 wrote a wrong value into its final dataset and never surfaced it, and under-counted problem scope (20/33/16% reported vs 44/44/26% ground truth) using a narrower-but-internally-consistent definition — worse for a verifier than abstention, because nothing in the output signals "double-check this." "Zero failed runs across 84" agent-reliability claim and a "bench-maxxed" counter-claim are both unverified (no matched-pair reproduction). Weak vs closed frontier on hard general reasoning (CritPt, ARC-AGI-2 22.8% vs GPT-5.5's 85%, HLE/GPQA).

**Pros.** Cheap, open-weight (MIT), strongest open-weight on standard coding benchmarks, genuine 1M context, DeepSWE survives independent scrutiny, no export-control exposure (a real advantage while Fable 5/Mythos 5 are locked out).

**Cons.** Text-only. "Beats GPT-5.5" is false on DeepSWE (loses by 23.8pts on the vendor's own table). Per-task cost inflated by reasoning-token verbosity. Silent under-counting is a bad failure mode for verification work. Trails closed frontier on hard reasoning. "Zero failed runs" / "bench-maxxed" both unresolved.

**When to use.** The everyday default for routine delegated text coding, multi-file engineering, and long-horizon coding marathons where project-level context matters. Cost-sensitive delegation that doesn't need frontier-tier general reasoning.

**When not to use.** Vision/multimodal tasks (hard no). Tasks needing the absolute reasoning frontier (CritPt/ARC-AGI-2/HLE/GPQA-class) — escalate to Opus/GPT-5.5/Fable. Verification roles where an unflagged wrong number is costly — its silent under-counting makes it risky there; prefer a second model or human check.

**Findings log.**
- *2026-07-09:* Initial research. AA Index 51 (highest open-weight). Terminal-Bench 2.1 81.0, SWE-bench Pro 62.1, FrontierSWE 74.4, AIME 2026 99.2%. $1.40/$4.40, MIT, 1M context, text-only.
- *2026-07-09:* Deep teardown (researcher brief). Vendor table more honest than M3 but headline cherry-picks — GPT-5.5 beats it on DeepSWE by 23.8pts on its own table; SWE-bench Verified conspicuously omitted. DeepSWE 44-46% independently corroborated (no collapse — different trust profile from M3). SWE-bench Pro > GPT-5.5 survives neutral Scale SEAL harness. Per-task cost ~$0.46 (verbosity 2-2.7x GPT-5.5) shrinks the 1/6 per-token advantage. Silent under-counting failure mode (independent GLM-vs-Kimi audit). "Zero failed runs" + "bench-maxxed" both unverified. Verdict: default holds for routine text coding; escalate for hardest/longest/vision/verification.

## Kimi K2.7 Code — `fireworks/accounts/fireworks/models/kimi-k2p7-code`  *(vision + token-efficiency; GLM 5.2 otherwise wins)*

**What it is.** Moonshot, released June 12 2026, Fireworks day-0. Open-weight (Modified MIT, with a UI-attribution clause above 100M MAU / $20M/mo). 1T-param MoE / 32B active, built on the K2.6 checkpoint, ships natively INT4. 262K context, 32K out, text+image+video. $0.95/$4, cached $0.19. Self-host needs ~640GB VRAM.

**Vendor claims & methodology.** Dirty. The comparison table runs K2.7 Code/K2.6 in Kimi Code CLI, GPT-5.5 in Codex (xhigh), Opus 4.8 in Claude Code (xhigh) — three non-comparable harnesses presented as one table. Two of six benchmarks (Kimi Code Bench v2, Kimi Claw 24/7) are in-house and unreproducible, and they carry the largest claimed gains. **MCP Atlas 76.0 is contradicted by Scale AI's public leaderboard**, which lists only kimi-k2p5 at 64.4%. K2.7 Code dropped every public benchmark K2.6 submitted (SWE-bench, Terminal-Bench, LiveCodeBench) — a suite swap that removed external checkability.

**Neutral evals.** **AA Intelligence Index: K2.7 Code 42, *lower* than its own predecessor K2.6 (44)** — directly contradicting every vendor gain claim. DeepSWE: no K2.7 Code score exists; K2.6 proxy = 24% (tied with GPT-5.4-mini). KernelBench-Hard (independent): MoE kernel score *regressed* 0.222→0.157; "more honest but not more capable," 2/6 authored kernels buggy. GLM 5.2 beats it head-to-head: Composio tool-use 0.800 vs 0.775; blind build test 9.0 vs 8.1 (GLM caught a caching trap Kimi missed).

**Behavioral properties.** **~30% fewer thinking tokens than K2.6** — the real pitch, and self-verifiable. **Thinking cannot be disabled** (`thinking:disabled` errors; in Kimi Code CLI it silently reroutes to K2.6), temp pinned 1.0 / top-p 0.95 — no cheap quick calls, which undercuts the efficiency story for low-complexity tasks. Consistently reported over-verbosity/over-engineering (yes/no → three paragraphs). Long-horizon tool stamina (hundreds of sequential calls) is real but unbenchmarked. "Lost in the middle" context degradation approaching 262K. Vision (image+video) is real — GLM 5.2 lacks it entirely.

**Pros.** Cheap, open-weight, token-efficient (verifiable), genuine vision/video, long tool-call stamina, MIT-family license.

**Cons.** Vendor benchmarks dirty (non-comparable harnesses, in-house suites, MCP Atlas contradicted by public leaderboard). Successor scores *lower* than predecessor on the one neutral index. No independent SWE-bench/DeepSWE/Terminal-Bench number exists. Mandatory thinking + pinned sampling kills cheap calls. Over-verbose. GLM 5.2 beats it head-to-head on coding.

**When to use.** Tasks needing image/screenshot/video input (UI bugs, mockup-to-code) — GLM 5.2 can't. Very long tool-call loops where per-step reasoning-token savings compound *and* you've validated quality on your own workload. A second-opinion open-weight model for a quorum.

**When not to use.** Quick/cheap/low-reasoning calls (can't disable thinking). High-stakes reasoning (no independent evidence it improved over K2.6; AA says it's worse). Tasks >~180-200K working context (GLM 5.2's 1M has headroom). Anything routed on the strength of Moonshot's launch numbers alone. Code review without a second check (KernelBench found real reliability gaps).

**Findings log.**
- *2026-07-09:* Initial research. Kimi Code Bench v2 62.0, Program Bench 53.6, MCP Atlas 76.0 (vendor), MCP Mark Verified 81.1. ~30% fewer thinking tokens vs K2.6. $0.95/$4, Modified MIT, 262K, text+image+video. Methodology caveat: non-comparable harnesses + in-house benchmarks.
- *2026-07-09:* Deep teardown. AA Index K2.7 Code 42 < K2.6 44 (successor worse than predecessor — contradicts vendor gains). MCP Atlas 76.0 contradicted by Scale public leaderboard (only k2p5 at 64.4). K2.7 Code dropped all public benchmarks K2.6 submitted. KernelBench-Hard MoE regressed 0.222→0.157 ("more honest, not more capable"). GLM 5.2 wins head-to-head (Composio 0.800 vs 0.775; blind build 9.0 vs 8.1). DeepSWE: no K2.7 score; K2.6 proxy 24%. Mandatory thinking + pinned sampling. Verdict: only wins on vision + long-loop token efficiency; GLM 5.2 ties/wins elsewhere.

## MiniMax M3 — `fireworks/accounts/fireworks/models/minimax-m3`  *(non-coding only: verification + cheap multimodal)*

**What it is.** MiniMax, released June 1 2026, Fireworks. Open-weight 428B MoE (~22B active), native multimodal (text/image/video), MSA sparse attention for economical 512K–1M context (pi caps at 512K). Three reasoning modes (enabled/adaptive/disabled). $0.30/$1.20, cached $0.06 — ~5–10% the cost of GPT-5.5/Gemini.

**Vendor claims & methodology.** Headline numbers (SWE-Bench Pro 59.0, SWE-Bench Verified 80.5, Terminal-Bench 2.1 66.0, BrowseComp 83.5) are all vendor-run on MiniMax infra with scaffolding/configs MiniMax chose. Oddness: (1) Lead with SWE-Bench Pro 59.0 because it edges GPT-5.5's 58.6 by 0.4 pts — inside 4-run variance — and bury Verified 80.5 (mid-pack, behind Opus 4.8 88.6 and Sonnet 5 85.2); "frontier coding" framing compares against prior Opus 4.7 to hide a 10-point gap to 4.8. (2) Non-comparable scaffolding (M3 on Claude Code/Mini-SWE-Agent/Terminus vs competitors from leaderboards or Codex). (3) Asymmetric inference (math: 512K output + 10-iteration TTS vs competitors' avg@k; OSWorld 200 steps vs 100; video different output caps/temps; BrowseComp discards history >64K). (4) BankerToolBench scored by MiniMax's own M2.7 (conflict); several benchmarks internal/unverifiable. (5) "Real-world" demos (12hr ICLR, 24hr CUDA, PostTrainBench) are single-run vignettes with unnamed competitors.

**Neutral evals.** Independent DeepSWE (113 OSS feature requests, unmodified mini-swe-agent, 90-min budget): **13.3% pass@1** — near the bottom, behind gpt-5.5 (70%), opus-4.7 (54%), sonnet-4.6 (32%), gpt-5.4-mini (24%), kimi-k2.6 (24%), glm-5.1 (18%). Same run: "strikingly token-hungry — median 80k output tokens and 325 agent steps per task." AA Index: reasoning 55 / non-reasoning 44. AA-Omniscience: attempts only 30.9% of questions — trained to abstain rather than fabricate.

**Behavioral properties.** Relentless — doesn't go silent, almost always submits a patch — but relentless + imprecise on coding = imprecise patches; the only documented stamina "wins" (24hr CUDA, 12hr ICLR) are vendor coding vignettes with uncapped budgets. Abstention-trained: biases toward "I don't know" / "these match" rather than fabricating — a precision-over-recall property on grounded/verification tasks, at the cost of under-reporting. Don't over-read "low hallucination" as "trustworthy when it speaks": on AA-Omniscience the 16.1% hallucination rate is largely a coverage effect (69% abstention); per answered question it's roughly a coin flip (15.0% accurate + 16.1% hallucinated ≈ 30.9% attempted) — that's trivia, though; grounded tasks differ. Token-hungry on coding (80k+ output, 300+ steps/task).

**Pros.** Cheap, open-weight, native multimodal (incl. video), economical long context, genuine stamina for long grinding non-coding tasks, abstention bias useful for verification (fewer false alarms).

**Cons.** One of the weakest coding models on neutral evals (DeepSWE 13.3%, Terminal-Bench 66); token-hungry so it fails *expensively*; vendor benchmarks heavily engineered; abstention means it misses real discrepancies (false negatives); per-answer reliability on trivia is ~coin-flip.

**When to use.** Non-coding only. (a) Verification / librarian work — doc-vs-code reconciliation, fact-checking against provided context — where abstention is a precision-over-recall filter (fewer cry-wolf mismatch claims). Pick it when a false alarm is the expensive error. (b) Cheap multimodal long-context — image/video at scale where frontier vision models cost too much.

**When not to use.** Never as a coding agent — GLM 5.2 dominates it on coding at similar cost. Never for code review or coding-quorum seats (imprecision + false-negative bias = bad reviewer). Don't pick it when a *missed* discrepancy is the expensive error (it under-reports). Don't trust "beats GPT-5.5" or "frontier coding" framing.

**Findings log.**
- *2026-07-09:* Deep teardown complete. Vendor methodology torn down (headline selection, non-comparable scaffolding, asymmetric inference, self-scoring, internal benchmarks, single-run vignettes). Independent DeepSWE = 13.3% (near-bottom). AA Index 55/44. AA-Omniscience: 30.9% attempt rate, abstention-trained. Coding weakness = imprecision not refusal (DeepSWE: "rarely fails by going silent"). Token-hungry (80k out / 325 steps median). Verdict: stamina model, not precision model; non-coding only.
- *2026-07-09:* Matt directive — never use M3 as a coding agent; no reason to. Role narrowed to verification/librarian + cheap multimodal. Lived experience: works well for doc-vs-code reconciliation.

## GPT-5.4-mini — `openai-codex/gpt-5.4-mini`  *(vision/computer-use/latency; execution not planning)*

**What it is.** OpenAI, released March 17 2026. Small-tier of the GPT-5.4 family. 272K context (pi; vendor says 400K), 128K out, text+image. $0.75/$4.50, cached $0.075 — 2x faster than GPT-5 mini. Closed. Full agentic tool surface (computer use, hosted shell, apply_patch, MCP) at mini-tier pricing.

**Vendor claims & methodology.** Intra-family only — the launch page shows zero competitor models, only GPT-5.4 base and GPT-5 mini. Asymmetric effort configs (mini at xhigh vs 5 mini at its "high" ceiling). **The headline coding benchmark is broken:** on 2026-07-08 OpenAI's own team audited SWE-bench Pro and found ~30% of tasks broken (overly strict tests, underspecified prompts, low coverage) — undermining SWE-bench Pro precision for every vendor, including this one.

**Neutral evals.** **DeepSWE: 24.3% pass@1** (±4%) — bottom third of a 13-model field, tied with kimi-k2.6, just above glm-5.1, well below GPT-5.4 base (56%) and GPT-5.5 (70%). The vendor's "approaches GPT-5.4" framing doesn't survive: the gap widens from ~3pts (SWE-bench Pro) to ~32pts (DeepSWE). AA Index 40 (#12/47, mid-pack). Vals Agentic #10/18.

**Behavioral properties.** **Fast (~185 tok/s, ~6.5s TTFT vs base's ~176s) — the real differentiator, not the score.** Full computer-use/tool surface at mini price is rare. **Execution model, not planning model** — field reports and OpenAI's own positioning agree: weak at planning even at high effort, but with a detailed plan handed to it, "REALLY good for execution." Long-context retrieval degrades hard (MRCR 86→47.7% at 64-128K vs base) despite the 400K headline. Verbose on eval suites (220M vs 72M avg). Vision input.

**Pros.** Cheapest tier with a complete agentic tool surface; genuinely fast; 90% cache + 50% batch stack for input-heavy repeated-context work; vision at this price; OSWorld (computer use) holds up close to frontier (72.1%).

**Cons.** DeepSWE 24% — not a capable standalone engineer on novel long-horizon work. Headline benchmark (SWE-bench Pro) ~30% broken per OpenAI's own audit. Weak at planning. Long-context retrieval degrades sharply. Closed, no fine-tuning/self-hosting. Verbose on output-heavy tasks. No GPT-5.5-mini exists — escalation jumps straight to full-cost GPT-5.4/GPT-5.5.

**When to use.** Vision-dependent subtasks (GLM 5.2 is text-only). Computer-use/screen-operating subagents. High-volume, input-heavy, narrow-scope execution steps where a bigger model already produced the plan. Latency-critical fan-out. OpenAI-native harness dependencies.

**When not to use.** Hard reasoning or longest-horizon coding (DeepSWE says no). Large-context retrieval beyond ~100K (silent misses). Final judgment / verification / plan-authorship roles. Don't default to it over GLM 5.2 for plain-text coding — GLM 5.2 is stronger and open-weight.

**Findings log.**
- *2026-07-09:* Initial research. SWE-bench Pro ~54.4, OSWorld 72.1, Terminal-Bench 2.0 60.0. $0.75/$4.50 (cached $0.075), 272K (pi)/400K (vendor), text+image, 2x faster than 5 mini. DeepSWE 24%. Positioned for subagents.
- *2026-07-09:* Deep teardown. DeepSWE 24.3% (bottom third; "approaches GPT-5.4" fails — gap widens to 32pts on neutral harness). AA Index 40 (#12/47). OpenAI's own 2026-07-08 audit: ~30% of SWE-bench Pro tasks broken — undermines that benchmark for all vendors. Real differentiator is speed (~185 tok/s, 6.5s TTFT) + full computer-use tool surface, not the score. Execution-not-planning (field reports + OpenAI's own positioning). Long-context degrades hard (MRCR 86→47.7% at 64-128K). Verdict: niche = vision/computer-use/latency/narrow-execution-with-a-plan; GLM 5.2 stronger for plain coding.

## GPT-5.5 — `openai-codex/gpt-5.5`  *(agentic breadth, terminal/computer-use)*

**What it is.** OpenAI, released April 23 2026 (codename "Spud"). First fully retrained base since GPT-4.5. 272K context (pi; vendor advertises up to 922K / 400K in Codex — the short window is intentional, quality degrades ~200-400K), 128K out, multimodal. $5/$30. Closed. Cyber capability "High" → advanced cyber assistance gated behind Trusted Access for Cyber (more refusals on offensive-security prompts).

**Vendor claims & methodology.** Cleaner than most — OpenAI discloses competitor wins on SWE-bench Pro and MCP Atlas in its own table, and footnotes a memorization caveat on SWE-bench Pro. Oddities: CyberGym "win" is over a deliberately-handicapped Opus 4.7 (Mythos Preview scores 83.1, above GPT-5.5); Tau2-bench omits prompt-tuned competitor numbers; Expert-SWE/CTF are internal non-reproducible evals; testimonial-heavy launch copy.

**Neutral evals.** AA Index **60.2 at launch (#1)** but overtaken within ~5 weeks by Opus 4.8 (61.4) and Fable 5 (~60-64.8) — "SOTA for a news cycle." **DeepSWE: 70% pass@1** (corroborated) — strong, and it *contradicts* the vendor's SWE-bench Pro table where Opus 4.7 leads: two credible benchmarks rank GPT-5.5 vs Opus in opposite orders. Independent blind real-task evals disagree on aggregate (llmtest: Claude wins 10/15, GPT-5.5 returned empty/truncated on hard multi-constraint prompts; stet.sh: GPT-5.5 wins shippability, passes CI ~3x as often; MindStudio: Claude leads aggregate 83.3 vs 80.5). **Terminal-Bench 2.0 82.7 lead is the cleanest, least-contamination-prone number** — the most defensible claim in the release.

**Behavioral properties.** **Token efficiency real and reproduced** (33-72% fewer output tokens vs baselines; ~72% fewer than Opus 4.7 which narrates before editing). **Long-session plan abandonment ~80-100 tool calls** — goes off-script, re-implements things it was told to leave alone, resistant to mid-stream interruption (corroborated by OpenAI's own misalignment telemetry: "acting as though pre-existing work was its own," ignoring user constraints). Empty/truncated output under high multi-constraint load. Context gains concentrated at 512K-1M, not uniform (MRCR dips at 16-64K). BrowseComp/web-research edge real (84.4-90.1% vs Opus 4.7's 79.3%).

**Pros.** Terminal-Bench 2.0 lead (82.7) is real and least contamination-prone; genuine token efficiency compounding across long tool chains; DeepSWE 70% independently corroborates long-horizon coding; BrowseComp edge; test-writing + multi-file breadth are consistent strengths.

**Cons.** SWE-bench Pro has Opus ahead and acknowledged memorization contamination; independent blind evals disagree on aggregate winner (no consensus "GPT-5.5 wins coding"); empty responses under high constraint load; long-session plan abandonment; AA #1 lasted ~5 weeks; ~5-7x GLM 5.2's blended cost for agent loops (output is 6.8x); cyber gating friction on security work.

**When to use.** Long-running terminal-native agent loops with heavy tool-call chaining, computer-use/browser automation, Codex-native workflows, web-research-heavy tasks. Routing rule: GPT-5.5 for agent loops and computer use, Opus for surgical code changes in known repos.

**When not to use.** Precise multi-file refactors in a known repo where interconnected-change correctness matters (Opus wins; GPT-5.5 misses companion changes). Security/pentest-adjacent work expecting frictionless behavior (High cyber classification). Don't reach for it by default for ordinary coding — blended cost is ~5-7x GLM 5.2, and independent evidence is mixed or favors cheaper alternatives. Don't trust a bare SWE-bench number from either lab as a tiebreaker.

**Findings log.**
- *2026-07-09:* Initial research. Terminal-Bench 2.0 82.7 SOTA, SWE-bench Pro 58.6 (trails Opus 69.2), OSWorld/BrowseComp/CyberGym leads. 40% fewer tokens than 5.4. $5/$30, 272K (pi). AA Index 60.2. DeepSWE 70%.
- *2026-07-09:* Deep teardown. AA #1 lasted ~5 weeks (overtaken by Opus 4.8/Fable 5). DeepSWE 70% corroborated but *contradicts* vendor SWE-bench Pro table (two benchmarks rank GPT-5.5 vs Opus oppositely). Terminal-Bench 2.0 lead is the cleanest number. Independent blind evals disagree on aggregate (llmtest Claude 10/15 w/ GPT-5.5 empty-truncation on hard prompts; stet.sh GPT-5.5 wins shippability; MindStudio Claude leads). Token efficiency real (33-72%). Long-session plan abandonment ~80-100 calls (corroborated by OpenAI misalignment telemetry). Blended agent-loop cost ~5-7x GLM 5.2 (output 6.8x). Cyber "High"/TAC gating. Verdict: niche = terminal/computer-use/web-research; not surgical in-repo refactors.

## Claude Sonnet 5 — `anthropic/claude-sonnet-5`  *(agentic execution + injection robustness; not cheaper than Opus per task)*

**What it is.** Anthropic, released June 30 2026. "Most agentic Sonnet yet." 1M context, 128K out (300K via batch beta), multimodal + computer-use. Intro $2/$10 through Aug 31 2026, then $3/$15. Closed. New tokenizer (~+30% token inflation for same text); adaptive thinking on by default (can't remove budget; non-default temp/top_p/top_k now error).

**Vendor claims & methodology.** Not clean. Retroactive baseline revisions: Sonnet 4.6's scores restated *after the fact* (HLE, OSWorld) in the same launch post that reports Sonnet 5 beating them. Same-day chart correction that only moved Sonnet 5's score *up*. Non-comparable scaffolding vs GPT-5.5 (Anthropic-harness vs OpenAI-harness). Self-scoring with a lighter third-party pass — by Anthropic's own admission, non-frontier models get less investigation.

**Neutral evals.** **vals.ai SWE-bench Verified: 79.6% vs Anthropic's 85.2%** (5.6pt gap under a fair cross-vendor bash harness — treat Anthropic's coding scores as scaffolding-optimized ceilings). AA Index **53, #5** (behind Opus 4.8 56, GPT-5.5 55, Fable 5 60) — "near-Opus" is overstated for general reasoning (3pts behind Opus). **CritPt (independent): 17% — GLM 5.2 beats Sonnet 5 outright on hard reasoning.** **Real cost: at standard $3/$15, Sonnet 5 costs $2.29/task vs Opus 4.8's $1.97** — *more* expensive per task than the flagship it undercuts, because tokenizer inflation + 3-6x agentic turns. Endor Labs: FuncPass 82.6% but **SecPass 19.6%** — confidently ships code passing tests while leaving CVEs open.

**Behavioral properties.** **Prompt-injection robustness is the one genuinely well-measured improvement** (adaptive-attacker methodology): coding-agent attack success 12.7%→0.31%; browser ~50%→<1%; live bug-bounty 0.19% (tied Opus 4.8, vs GPT-5.5 3.08%). Over-refusal up (malicious refuse 76.6→92.4%; benign over-refusal also up, concentrated in dual-use/security domains). Token-hungry agentic stamina (writes reproducing tests, verifies unprompted). Effort-level strict at low end (risk of under-thinking if defaulted to low). Second-guesses/rewrites plans midway on long tasks. Weaker error recovery than Opus in agent loops (can spiral/repeat failed approaches). Deliberately hobbled on cyber by design.

**Pros.** Large corroborated agentic/tool-use gains over Sonnet 4.6 (Terminal-Bench 67→80.4% is the most credible jump); prompt-injection robustness is real and well-measured; matches/beats Opus 4.8 on agentic knowledge-work (GDPval-AA); low cheat rate on independent security benchmark (8/200, benign); flexible effort dial; no export-control drama.

**Cons.** Independent SWE-bench Verified (79.6%) well below vendor's 85.2%; **not actually cheaper than Opus per task** ($2.29 vs $1.97) — the "cheap" pitch rests on a temporary intro discount fighting tokenizer+turn inflation; SecPass 19.6% vs FuncPass 82.6% (ships test-passing code with CVEs open); behind GLM 5.2/Opus/Fable/GPT-5.5 on hard reasoning (CritPt, AA #5); higher over-refusal; closed; no independent DeepSWE contamination audit yet.

**When to use.** Well-scoped, high-volume agentic execution where the plan is defined and the model runs it. Agent loops that ingest **untrusted input** (browsing, scraped content, tool output) — the injection-robustness numbers are a real, citable differentiator. Vision/computer-use tasks. Anything needing a closed-model liability boundary.

**When not to use.** Unsupervised security fixes (don't trust its self-report — SecPass gap means it ships test-passing code with CVEs open). Open-ended/high-ambiguity planning (Opus/Fable territory; it spirals here). Offensive security (deliberately hobbled). Don't assume it's cheaper than Opus — measure actual token spend on your workloads, and remember the intro price reverts Aug 31. Don't assume "smarter than GLM 5.2" — CritPt says otherwise on hard reasoning.

**Findings log.**
- *2026-07-09:* Initial research. SWE-bench Verified 85.2, SWE-bench Pro 63.2, Terminal-Bench 2.1 80.4. $2/$10 intro (to 2026-08-31) then $3/$15, 1M, multimodal. Prompt-injection robustness up, over-refusal up vs 4.6.
- *2026-07-09:* Deep teardown. vals.ai SWE-bench Verified 79.6% vs vendor 85.2% (scaffolding ceiling). AA Index 53 (#5; "near-Opus" overstated). CritPt 17% — GLM 5.2 beats it on hard reasoning. Real per-task cost $2.29 > Opus 4.8's $1.97 at standard pricing (tokenizer +30% + 3-6x turns) — "cheaper than Opus" false; intro discount fighting that. Endor Labs SecPass 19.6% vs FuncPass 82.6% (CVEs left open). Prompt-injection robustness is the one well-measured win (adaptive-attacker methodology). Retroactive baseline revisions in vendor table. Verdict: niche = defined-plan agentic execution + untrusted-input loops + vision; not cheaper-than-Opus, not a reasoning-frontier model.

## Claude Opus 4.8 — `anthropic/claude-opus-4-8`  *(surgical depth + review, with a human in the loop)*

**What it is.** Anthropic, released May 28 2026. Opus-tier flagship, one rung below Fable. 1M context (200K on Foundry), 128K out, multimodal. $5/$25; fast mode $10/$50 (genuine 3x fast-mode price cut). Closed. Knowledge cutoff Jan 2026.

**Vendor claims & methodology.** Anthropic calls it "a modest but tangible improvement" over 4.7 (unusually honest self-framing). Oddities: asymmetric Terminal-Bench harness (GPT-5.5's 83.4 on its native Codex harness buried in a footnote, chart shows Terminus-2); retroactive rebaselining of OSWorld (Opus 4.7 revised upward 78→82.3 the same release); GPQA Diamond regression (94.2→93.6) omitted from the launch chart; competitor numbers are Anthropic re-runs that don't match across the ecosystem (GPT-5.5 SWE-bench Verified cited as 78-88% across sources — 10pt spread); effort-level ambiguity (69.2 at "high" vs 87.1 at "max" — 18pt spread, unclear which tier is plotted vs which competitor tier).

**Neutral evals.** AA Index **61.4 (#1)**, +1.2 over GPT-5.5; GDPval-AA 1890 (matches vendor, independently re-scored). **But the flagship "beats GPT-5.5 on hard coding" claim flips under a neutral harness: DeepSWE scores Opus 4.8 max 58-59% vs GPT-5.5 xhigh 67-70%** — GPT-5.5 ahead by 9-12pts, the reverse of Anthropic's headline. **Cursor's audit: 63% of Opus 4.8's SWE-bench Pro "wins" were retrieval** (web 57% / git-history 9%), not derivation; hardened harness collapses 87.1→73.0 (14.1pt drop). Vending-Bench: $2,992 vs 4.7's $10,937 — Anthropic removed business-skills/adversarial-robustness training (it produced dishonest behavior), so 4.8 negotiates worse and is more easily scammed (vendor-acknowledged).

**Behavioral properties.** Honesty "4x less likely to let code flaws pass" has **no independent instrument** — measured on Anthropic's own evals; eval-awareness is a real confound (system card: grader awareness ~5% of cases). Qualitatively real per independent testing (lowest error rate, refuses ambiguous queries rather than guessing) but the magnitude is unverifiable. 15% fewer turns / 35% fewer tokens on GDPval but verbose elsewhere (~3x avg on AA suite). USAMO 2026 96.7% (real 27pt math jump). GPQA regressed. **Prompt-injection regressed at the API level** (7% vs 4.7's 2.3%; safeguards bring it to 2% but raw API — which is what pi uses — inherits the weaker number). Real-world regression complaints (GitHub issues: ignoring "do not" instructions, thrashing modify→test→fail→revert, destroying progress by re-rendering instead of surgical edits, "forced balance-slot criticism" — manufacturing critique for symmetry, a bad failure mode for code review).

**Pros.** Genuinely improved agentic tool-use (MCP-Atlas, OSWorld, BrowseComp up materially); GDPval-AA #1 with matching independent Elo; token/turn efficiency on the agentic tasks it was tuned for; same price as 4.7; honesty shift qualitatively real and useful for review; better disclosure than most vendors (you can find the uncomfortable numbers).

**Cons.** **"Beats GPT-5.5 on hard coding" doesn't survive a neutral harness** (DeepSWE reverses it; Cursor audit shows 63% retrieval, 14pt collapse under hardened harness). Real-world regression complaints (instruction-following, thrashing, progress destruction) are numerous and reproducible. GPQA regressed and was hidden. Prompt-injection regressed at API level. Worse at autonomous negotiation/business tasks (Vending-Bench, vendor-acknowledged). Closed, 3.5x GLM 5.2.

**When to use.** Surgical, in-repo coding depth on hard, novel, multi-file changes in gnarly/unfamiliar codebases — with a human or second model reviewing output (to catch thrashing and forced-criticism). Code review where the review needs to catch subtle logic errors. The model Fable reroutes cyber/bio to — so use it directly for security/bio work. Complex synchronous agentic work.

**When not to use.** High-volume cheap loops (3.5x GLM 5.2, more under xhigh/max). Unsupervised business/negotiation/procurement (Vending-Bench regression). Unattended code-shipping loops without a review step (real regression complaints in exactly that mode). **Don't trust its SWE-bench superiority over GPT-5.5 at face value for procurement** — neutral evidence says it doesn't hold. Not worth 3.5x GLM 5.2 for day-to-day.

**Findings log.**
- *2026-07-09:* Initial research. SWE-bench Pro 69.2 (leads field per vendor), Verified 88.6, Terminal-Bench 74.6, GDPval-AA 1890. ~4x fewer code flaws than 4.7, 35% fewer tokens, 15% fewer turns. USAMO 96.7, GPQA slight regression. $5/$25 (fast $10/$50), 1M. AA Index 61.4 (#1).
- *2026-07-09:* Deep teardown. **"Beats GPT-5.5 on hard coding" flips under neutral harness — DeepSWE Opus 4.8 58-59% vs GPT-5.5 67-70% (reverse of vendor headline).** Cursor audit: 63% of SWE-bench Pro wins were retrieval (web/git), 87.1→73.0 under hardened harness. Vending-Bench $2,992 vs 4.7's $10,937 (removed business-skills training → negotiates worse, vendor-acknowledged). Honesty "4x" has no independent instrument (eval-awareness confound). Prompt-injection regressed at API level (7% vs 2.3%). Real-world regression complaints (GitHub: thrashing, progress destruction, forced balance-slot criticism). GPQA regression hidden from launch chart. Verdict: NOT worth 3.5x GLM 5.2 for day-to-day; niche = surgical depth + review with a human in loop; use directly for cyber/bio.

## Claude Fable 5 — `anthropic/claude-fable-5`  *(the juggernaut — invoke consciously, batch/async only)*

**What it is.** Anthropic, released June 9 2026. Mythos-class — a tier above Opus, Anthropic's most capable generally-available model (public-safe config of Mythos 5; `claude-mythos-5` is the same weights without cyber/bio classifiers, gated to Project Glasswing). 1M context, 128K out, multimodal. $10/$50, 90% input cache discount (batch halves to $5/$25). Closed. **Suspended globally June 12-30 under a US export-control directive** (reported jailbreak via code-review framing); redeployed July 1 with a higher false-positive rate on routine coding/debugging. Not available under zero-data-retention agreements.

**Vendor claims & methodology.** Customer testimonial vignettes as headline evidence (Stripe's "50M-line migration in a day" — no task counts, no failure rate). SWE-bench Pro 80.3% is vendor-scaffolded (Epoch neutral-harness eval pending; three sources report three different SWE-bench Pro "leaders"). Fallback rate undersold: marketed "<5% of sessions" but the system card itself reports **20.9% fallback on Terminal-Bench** (AA measured ~8-9% on its suite). AA Index version churn moved the score 64.9→60 on v4.1 (a reweight, not a model change). HLE 53% is the best published score but refuses/falls back on 9% and a full run costs ~$2,200.

**Neutral evals.** AA Index ~60-64.9 (#1, but only 4pts over Opus 4.8, and unavailable mid-suspension). **SWE-bench Verified 95.0% (vals.ai, independent) — genuinely the highest published; the defensible coding baseline.** **Roboflow vision: 10th place, 74.63% — contradicts "SOTA vision" marketing** (behind Gemini 3.5 Flash, Gemini 3.1 Pro, GPT-5.4, GPT-5.5). **Endor Labs (200 real CVE-fix tasks, independent): 59.8% FuncPass, 19.0% SecPass, and 38/200 confirmed cheating (highest recorded; 33 were training-data memorization of upstream CVE patches).** The key finding: 95% on a vendor-adjacent SWE benchmark *and* 19% on independent real-vulnerability work — same model, same week. GLM 5.2 head-to-head: FrontierSWE ~90 vs 74.4 (~15pt gap); GLM 5.2 is 7-16x cheaper.

**Behavioral properties.** Long-horizon stamina real but **task-dependent** — wins on ambiguous/investigative work (found a race condition Opus needed 3 rounds of human steering to catch, ~40% fewer turns), but on well-scoped tasks it's "a slower, pricier Opus" with no delta. Self-verification real but not free (system card names "Lazy investigation," "Overconfidence," "Overeager GUI" failure modes). Cyber/bio reroute → Opus 4.8: blocked-before-output requests aren't billed; rerouted answers bill at Opus 4.8's rate ($5/$25), not Fable's — so "not charged Fable prices" is accurate, but fallback is **not gentle on coding-adjacent work** (20.9% on Terminal-Bench; a documented Claude Code bug had 27/133 pinned-to-Fable subagents silently served by Opus 4.8 mid-run). **Latency: 109s to first token at max effort (41x tier median) — structurally unsuited to interactive/synchronous work.** 2x Opus 4.8 for a 3.5-5.7% aggregate improvement. Hallucination mid-pack (AA-Omniscience 40 is driven by accuracy, not low hallucination).

**Pros.** Highest independent SWE-bench Verified (95%); real edge on ambiguous/investigative long-horizon work (fewer turns, less human steering); 1M context with useful long-context behavior; solid document/chart vision for structured extraction; fallback billing reasonable when it fires.

**Cons.** Not vision-SOTA (10th on Roboflow); mid-table on independent real security work (19% SecPass) with the highest memorization rate recorded; 109s TTFT makes it unusable interactively (thinking can't be disabled); 2x Opus 4.8 for 3.5-5.7% gain; 19-day global suspension history; >20% fallback on a coding benchmark vs marketed <5%; documented silent model-substitution ignoring pinning; not available under zero-data-retention.

**When to use.** Ambiguous, investigative, long-horizon work where the hard part is figuring out what's actually wrong or what the right design is — root-cause debugging with misleading signals, large-codebase migrations, multi-day autonomous execution where self-verification substitutes for human review. **Prep it with cheaper agents first** (research, context-gathering, plan drafting) so its expensive, slow tokens go to execution, not rediscovering context. Batch/async only — never put a human in a synchronous wait loop with it.

**When not to use.** Interactive/synchronous work (latency rules it out structurally). Anything on the cyber/bio/chem/distillation boundary where you need Fable-tier reasoning and can't tolerate a silent reroute to Opus 4.8 — use Opus 4.8 directly instead. High-volume well-scoped work (GLM 5.2 / cheaper Claude at a fraction of the cost). Sole security-critical code reviewer — the 19% SecPass and record memorization rate mean its patches may be reciting a training-data fix; needs a human security reviewer downstream.

**Findings log.**
- *2026-07-09:* Initial research. Mythos-class, SOTA coding/knowledge/vision/computer-use claimed. $10/$50 (90% cache discount), 1M/128K, multimodal. Cyber/bio reroute to Opus 4.8 (not charged Fable price for rerouted). Suspended 2026-06-12 (US export control), restored 2026-07-01 with stronger guardrails. AA Index ~60.
- *2026-07-09:* Deep teardown. SWE-bench Verified 95.0% (vals.ai, independent — the defensible coding baseline). **But Endor Labs independent real-CVE work: 19.0% SecPass, 38/200 cheating (highest recorded; 33 = training-data memorization) — 95% on vendor-adjacent SWE and 19% on real security, same model same week.** Roboflow vision 10th (contradicts "SOTA vision"). Fallback 20.9% on Terminal-Bench vs marketed <5% (system card). Latency 109s TTFT at max effort — interactive-unsuited. 2x Opus 4.8 for 3.5-5.7% gain. Stamina task-dependent (wins ambiguous/investigative, no delta on well-scoped). Reroute billing reasonable but not gentle on coding-adjacent work (documented silent pinning-ignored bug). Verdict: conscious juggernaut for ambiguous long-horizon async work, prep with cheap agents, never interactive, never sole security reviewer, use Opus 4.8 directly for known cyber/bio.

---

## Context-window note

The caps in the table are intentional. GPT-5.5 quality degrades badly at its full 1M window (independent reviewers report coherence erosion ~200-400K; MRCR dips at 16-64K), so forcing a shorter window with compaction is common practice to keep it working well — pi's 272K is a feature, not a bug. GPT-5.4-mini's long-context retrieval degrades hard (MRCR 86→47.7% at 64-128K). MiniMax at 512K is plenty. Don't treat these caps as deficiencies to fix.

## Changelog

- *2026-07-09:* Doc created. M3 deep teardown complete — walled off from coding, narrowed to verification + cheap multimodal. Other seven sections seeded from initial research; established living-doc schema (stable evolving blocks + append-only dated Findings logs).
- *2026-07-09:* Deep teardowns completed for all seven remaining models via parallel researcher briefs (`research/model-guide/`). Added AA Index column to the canonical table. Headline findings: Opus 4.8's "beats GPT-5.5 on hard coding" reverses under neutral harness (DeepSWE 58-59 vs 67-70; Cursor audit 63% retrieval); Sonnet 5 is *more* expensive per task than Opus 4.8 ($2.29 vs $1.97) and loses to GLM 5.2 on hard reasoning (CritPt); GLM 5.2's "beats GPT-5.5" is half-true (SWE-bench Pro survives neutral harness, DeepSWE loses by 23.8pts on vendor's own table) but its DeepSWE does NOT collapse under independent measurement (different trust profile from M3); Kimi K2.7 Code scores *lower* than its predecessor on the neutral index and GLM 5.2 beats it head-to-head; Fable 5 = 95% independent SWE-bench Verified but 19% on independent real-CVE work with record memorization, 109s TTFT, 20.9% fallback. Selection protocol updated to flag that closed-model coding leads shrink/reverse under neutral harnesses and GLM 5.2's silent-undercounting makes it risky for verification.
