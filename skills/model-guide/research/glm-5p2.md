# GLM 5.2 — Critical Model Evaluation Brief

**pi ID:** `fireworks/accounts/fireworks/models/glm-5p2`
**Status in pi:** default agent model
**Brief posture:** skeptical teardown, not vendor marketing. Written the way the MiniMax M3 brief was written.

---

## 1. What it is

- **Vendor:** Z.ai (formerly Zhipu AI), a ~127-person Chinese lab. [datanorth.ai](https://datanorth.ai/news/zhipu-ai-releases-glm-5-2), [testingcatalog](https://testingcatalog.net/zhipus-glm-5-2-tops-open-source-coding-benchmark-beating-claude-and-gemini/)
- **Release date:** June 13, 2026 — but the initial release was a **coding-plan drop with zero benchmark numbers**; API, chatbot, open weights, and the full scorecard followed three days later on June 16. Multiple independent outlets flagged this explicitly: MarkTechPost's headline was literally *"…and No Benchmarks at Launch"* ([marktechpost.com](https://www.marktechpost.com/2026/06/14/z-ai-launches-glm-5-2-with-a-usable-1m-token-context-two-thinking-effort-levels-and-no-benchmarks-at-launch/)); Digital Applied called it "a coding-plan rollout first and a benchmark story later" ([digitalapplied.com](https://www.digitalapplied.com/blog/glm-5-2-zai-flagship-coding-plan-release)); ground.news and awesomeagents.ai corroborate the same timeline.
- **Architecture:** Mixture-of-Experts, reported as **744B total / ~40B active** parameters ([datanorth.ai](https://datanorth.ai/news/zhipu-ai-releases-glm-5-2)), though Fireworks lists 743B ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)) and VentureBeat's own writeup says **753B** ([venturebeat.com](https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost)) — a real three-way inconsistency in basic spec reporting across otherwise-careful outlets, and Z.ai has published **no architecture paper**, so the exact figure isn't independently verifiable from a primary source ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)).
- **License:** MIT, "no regional limits," distributed on Hugging Face under `zai-org` ([venturebeat.com](https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost)). This is a genuinely disruptive point in the current climate: the U.S. government forced Anthropic to pull Claude Fable 5 / Mythos 5 offline entirely (export-control order against foreign-national access) the day *before* GLM-5.2 shipped ([the-decoder.com](https://the-decoder.com/us-government-forces-anthropic-to-disable-claude-fable-5-and-mythos-5-for-all-customers-worldwide/), [awesomeagents.ai](https://awesomeagents.ai/news/zhipu-glm-5-2-open-source/)). GLM-5.2 is positioned as the counter-move: sovereign, no export-control exposure, self-hostable.
- **Context / output:** 1M-token input context, up to 131,072 output tokens ([docs.z.ai](https://docs.z.ai/guides/llm/glm-5.2) lists 128K rounded, [datanorth.ai](https://datanorth.ai/news/zhipu-ai-releases-glm-5-2) and [kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive) confirm 131,072 exactly). The 1M window is claimed "usable" rather than nominal-only, enabled by **IndexShare** — reusing one indexer across every 4 sparse attention layers, cutting per-token FLOPs ~2.9x at 1M context ([docs.z.ai](https://docs.z.ai/guides/llm/glm-5.2)). No independent stress test of degradation past 200K tokens exists yet — kie.ai flags this explicitly as unverified ("Z.ai claims the window is usable rather than degraded... neither has been independently stress-tested").
- **Modalities: TEXT ONLY.** No vision. Confirmed independently by kie.ai, which flags it as "the binding constraint on GLM-5.2's autoresearch use case" and cites a named practitioner (Chubby) hitting this wall directly ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)).
- **Pricing:** $1.40/$4.40 per M input/output tokens, $0.26 cached — confirmed identically across venturebeat, kie.ai, and docs.z.ai. Same rate as GLM-5.1 (no price increase for the new generation).
- **Two effort levels:** "High" and "Max," trading latency/token spend for reasoning depth. Under Max, GLM-5.2 burns ~85K output tokens/task per venturebeat's own reporting on the vendor chart, or ~43-45K per Artificial Analysis's independent measurement on their Intelligence Index tasks — see Section 3, this matters a lot for the "1/6th cost" claim.

---

## 2. Vendor benchmark claims + methodology critique

Z.ai's own benchmark table (posted to the HF model card / z.ai blog, first appearing ~June 16-17) is the source most secondary outlets are simply re-plotting. Full table as published:

| Benchmark | GLM-5.2 | GLM-5.1 | GPT-5.5 | Claude Opus 4.8 | Gemini 3.1 Pro |
|---|---|---|---|---|---|
| HLE | 40.5 | 31 | 41.4* | 49.8* | 45 |
| GPQA-Diamond | 91.2 | 86.2 | 93.6 | 93.6 | 94.3 |
| AIME 2026 | 99.2 | 95.3 | 98.3 | 95.7 | 98.2 |
| CritPt | 20.9 | 4.6 | 27.1 | 20.9 | 17.7 |
| SWE-bench Pro | 62.1 | 58.4 | 58.6 | 69.2 | 54.2 |
| NL2Repo | 48.9 | 42.7 | 50.7 | 69.7 | 33.4 |
| **DeepSWE** | **46.2** | 18 | **70** | 58 | 10 |
| ProgramBench | 63.7 | 50.9 | 70.8 | 71.9 | 39.5 |
| Terminal-Bench 2.1 | 81.0 | 63.5/62.0† | 84 | 85 | 74 |
| FrontierSWE (Dominance) | 74.4 | 30.5 | 72.6 | 75.1 | 39.6 |
| SWE-Marathon | 13.0 | 1.0 | 12.0 | 26.0 | 4.0 |

*(source: [huggingface.co/zai-org/GLM-5.2](https://huggingface.co/zai-org/GLM-5.2) model card table; †GLM-5.1's Terminal-Bench number is reported inconsistently as 63.5 in one z.ai render and 62.0 in another mirrored copy — minor but real.)*

**What's clean about this table:** unlike the MiniMax M3 case, Z.ai's own published table is *not* uniformly self-flattering — it openly shows GPT-5.5 beating GLM-5.2 by large margins on DeepSWE (70 vs 46.2), NL2Repo (50.7 vs 48.9), ProgramBench (70.8 vs 63.7), GPQA (93.6 vs 91.2), HLE (41.4 vs 40.5), and Terminal-Bench (84 vs 81.0). It also shows Opus 4.8 beating GLM-5.2 across nearly every coding metric, sometimes by wide margins (SWE-bench Pro 69.2 vs 62.1, NL2Repo 69.7 vs 48.9, SWE-Marathon 26.0 vs 13.0 — literally half). This is a materially more honest scorecard than what MiniMax shipped. **The methodology problem isn't the raw table — it's the headline distilled from it.**

**The headline critique.** VentureBeat's title — *"beats GPT-5.5 on multiple long-horizon coding benchmarks for 1/6th the cost"* ([venturebeat.com](https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost)) is built by **cherry-picking the four rows where GLM-5.2 edges out GPT-5.5** (SWE-bench Pro +3.5, FrontierSWE +1.8, PostTrainBench, SWE-Marathon +1.0) while silently omitting the rows in the *same table* where GPT-5.5 wins by much larger margins (DeepSWE by 23.8 points, NL2Repo by 1.8, ProgramBench by 7.1, Terminal-Bench by 3). A reader of the VentureBeat piece alone would not know DeepSWE — arguably the single hardest, most representative long-horizon SWE benchmark in the set — shows GPT-5.5 beating GLM-5.2 by a wide margin on the vendor's own numbers. That is precisely the "buried mid-pack number to preserve a headline" pattern from the MiniMax teardown, just executed with a cleaner underlying data table.

**No benchmark suite at launch, then a benchmark suite that skips a load-bearing metric.** Z.ai shipped GLM-5.2 on June 13 with zero benchmark numbers — confirmed independently by five separate outlets (MarkTechPost, Digital Applied, ground.news, awesomeagents.ai, buildfastwithai) ([marktechpost.com](https://www.marktechpost.com/2026/06/14/z-ai-launches-glm-5-2-with-a-usable-1m-token-context-two-thinking-effort-levels-and-no-benchmarks-at-launch/), [buildfastwithai.com](https://www.buildfastwithai.com/blogs/glm-5-2-review-2026)). This matches the task brief's premise (datanorth's framing that early figures come from independent evaluations). But the more important finding: **the full scorecard, when it did land, conspicuously omits SWE-bench Verified** — the single most historically-tracked SWE benchmark, and the one GLM-5.1 *did* report (77.8%, per digitalapplied.com). Bind AI's comparison piece confirms this directly: *"SWE-bench Verified | Not reported"* for GLM-5.2, while GPT-5.5 (82.6% via vals.ai) and Opus 4.8 (88.6% self-reported) both have numbers on the board ([blog.getbind.co](https://blog.getbind.co/glm-5-2-vs-claude-opus-4-8-vs-gpt-5-5-which-is-better-for-coding/)). Dropping the one apples-to-apples legacy metric while introducing several newer, less cross-comparable benchmarks (FrontierSWE, SWE-Marathon, PostTrainBench, DeepSWE) where the vendor controls more of the framing is the same "swap the comparison metric to hide a gap" pattern flagged in the MiniMax brief — except here it's an *omission* rather than a substitution of a weaker prior-generation competitor number.

**Scaffolding asymmetry, confirmed by a genuinely neutral source.** Bind AI's independent piece states plainly: *"The harness issue is not a technical footnote. It represents a structural problem in how frontier labs publish benchmark results, where each one optimizes its submission environment for its own model's strengths."* On Scale AI's standardized SEAL harness across 1,865 SWE-bench Pro tasks — a neutral third-party scaffold, not self-reported — the ranking holds: **Opus 4.8 69.2% > GLM 5.2 62.1% > GPT-5.5 58.6%** ([blog.getbind.co](https://blog.getbind.co/glm-5-2-vs-claude-opus-4-8-vs-gpt-5-5-which-is-better-for-coding/)). This is the good news buried in the noise: unlike MiniMax's SWE-bench Pro margin (which collapsed under independent scrutiny), **GLM-5.2's specific SWE-bench Pro > GPT-5.5 claim survives a neutral harness.** Treat that one claim as real. Don't extend that credibility to the rest of the scorecard by association.

**"Bench-maxxed" accusation, unresolved.** Prominent AI commentator Bindu Reddy explicitly claimed GLM-5.2 is bench-maxxed, with the specific claim that *internal evals run weaker than the published benchmark numbers* ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive), citing [x.com/bindureddy](https://x.com/bindureddy/status/2067291976102535352)). This is the closest analog in the current record to the DeepSWE-independent-run gap that sank MiniMax's claims — but as of this writing **it is an assertion, not a reproduced measurement.** kie.ai's own deep-dive flags this as the top unresolved item and explicitly calls for "independent reproduction... watch for a public harness publishing matched-pair runs." No such run has surfaced yet. Flag it as an open risk, not a confirmed gap.

**Reasoning-token inflation undercuts the "1/6th cost" framing at the task level, not just the per-token level.** A Hacker News discussion of GPT-5.5 vs GLM-5.2 reasoning efficiency found GPT-5.5 (xhigh) averaging ~16K tokens to first-file on a math-evaluator task, while GLM-5.2 (Max) spent ~45K tokens and 15+ minutes on the same class of task ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive), citing [news.ycombinator.com/item?id=48567759](https://news.ycombinator.com/item?id=48567759)). Artificial Analysis independently measured the same pattern on their own Intelligence Index: GLM-5.2 uses ~43K output tokens per task versus GLM-5.1's 26K and open-weight peers MiniMax-M3 (24K) and Kimi K2.6 (35K), pushing real cost-per-task to ~$0.46 versus MiniMax-M3's $0.18 ([aiweekly.co](https://aiweekly.co/alerts/z-ais-glm-52-tops-open-weights-intelligence-index-at-51)). **The per-token sticker price is genuinely ~1/6-1/7 of GPT-5.5/Opus 4.8. The realized cost-per-completed-task is not — GLM-5.2 partially spends that price advantage back on verbosity.** This is the single most important quantitative correction to the "1/6th the cost" headline: it's true on a per-token basis and materially overstated on a per-task basis.

**Design Arena "beats Fable 5" claim is a narrow crowdsourced-UI benchmark, not a general capability claim.** VentureBeat cites GLM-5.2 beating Fable 5 (ELO 1360) on Design Arena. Separately, on the broader lmarena.ai WebDev leaderboard, GLM-5.2 (Max) sits **#2, 59 Elo points behind** Fable 5 ([dev.to/kunal_d6a8fea2309e1571ee7](https://dev.to/kunal_d6a8fea2309e1571ee7/glm-52-vs-claude-fable-5-open-source-ai-challenges-the-throne-2026-347g)). These aren't strictly contradictory (different arenas measure different things), but a reader who only sees the VentureBeat "beats Fable 5" line has no way to know that on the closest analogous public leaderboard, GLM-5.2 trails by a real margin. Treat single-benchmark "beats the SOTA closed model" claims from press coverage as unrepresentative until cross-checked against a second leaderboard — which is exactly what happened here.

**Verdict on methodology:** mixed, not clean. The vendor's raw table is more honest than MiniMax's was (it doesn't hide losses within the table itself), but the press headline built from it is selectively curated, the most standard/comparable legacy benchmark (SWE-bench Verified) is conspicuously dropped, and the per-token cost advantage is real while the per-task cost advantage is inflated by verbosity that isn't disclosed in the marketing copy.

---

## 3. Neutral / independent evals — the most important section

**Artificial Analysis Intelligence Index v4.1 — genuinely independent, methodology published, most trustworthy number in this brief.** GLM-5.2 (Max) scores **51**, the highest of any open-weight model, ahead of MiniMax-M3 (44), DeepSeek V4-Pro (44), and Kimi K2.6 (43), and edging past Gemini 3.5 Flash (High) by a single point — the first time an open-weight model has cleared Google's efficiency-tier flagship ([artificialanalysis.ai](https://artificialanalysis.ai/models/glm-5-2), [aiscroll.io](https://aiscroll.io/article/general/glm-5-2-overtakes-gemini-flash/)). **But it ranks only 4th overall**, behind Fable 5 (~60, currently pulled from public access), Opus 4.8 (~56), and GPT-5.5 (xhigh) — so "SOTA open-weight" and "beats the closed frontier" are two different claims, and only the first one is true here. AA's own writeup is candid about the caveat: 43K output tokens per task (vs 89M-token-corpus average across models AA tracks) pushes real cost-per-task above the sticker-price comparison would suggest ([aiweekly.co](https://aiweekly.co/alerts/z-ais-glm-52-tops-open-weights-intelligence-index-at-51)).

**DeepSWE — the direct analog to the MiniMax teardown, and it does NOT show a MiniMax-scale gap.** This is the load-bearing check the task explicitly asked for. Findings across sources:
- Z.ai's own table: GLM-5.2 46.2% (vendor self-report)
- Datacurve (the benchmark's own maker, running its own official leaderboard — the closest thing to a neutral authority here): GLM-5.2 at **44% pass@1 at max effort**, "indisputable #1 open-source model," beating Kimi K2.7 Code by 17 points ([testingcatalog.net](https://testingcatalog.net/zhipus-glm-5-2-tops-open-source-coding-benchmark-beating-claude-and-gemini/), corroborated a day later at [testingcatalog.net/open-source...](https://testingcatalog.net/open-source-glm-5-2-tops-coding-benchmark-beats-claude-and-gemini/))
- kie.ai's independently-compiled figure: **44% at $3.92/78K tokens**, versus Gemini 3.5 Flash at 37%/$7.34/276K tokens ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive))
- BenchLM's separately-mirrored DeepSWE snapshot (captured June 14, before GLM-5.2 was added) shows Fable 5 (xhigh) 69.9%, GPT-5.5 (xhigh) 67.0%, Opus 4.8 (max) 59.0% ([benchlm.ai/benchmarks/deepSwe](https://benchlm.ai/benchmarks/deepSwe)) — roughly consistent with the shape of Z.ai's own table (GPT-5.5 70, Opus 4.8 58), which is itself a useful cross-check that the vendor's DeepSWE numbers for the *other* models weren't fabricated either.

**Conclusion: unlike MiniMax M3 (vendor claimed 59-80%, independent DeepSWE run scored 13.3%), GLM-5.2's DeepSWE numbers hold up under independent/third-party measurement — 44-46% across vendor, benchmark-maker, and aggregator sources, with reasonable internal consistency on the comparison models too.** This is the single cleanest finding in this brief and cuts directly against assuming GLM-5.2 will fabricate benchmark wins the way MiniMax did. It also confirms GPT-5.5 (67-70%) and Opus 4.8 (58-59%) both meaningfully outscore GLM-5.2 on DeepSWE specifically — so "beats GPT-5.5 on long-horizon coding" is false on this particular, arguably-most-representative long-horizon benchmark, even though it's true on SWE-bench Pro and FrontierSWE.

**SWE-bench Pro under a neutral harness (Scale AI SEAL, 1,865 tasks, post-cutoff repos to prevent memorization):** Opus 4.8 69.2% > GLM 5.2 62.1% > GPT-5.5 58.6% ([blog.getbind.co](https://blog.getbind.co/glm-5-2-vs-claude-opus-4-8-vs-gpt-5-5-which-is-better-for-coding/)). GLM-5.2's edge over GPT-5.5 here is real under a non-vendor harness — the strongest surviving piece of the "beats GPT-5.5" claim.

**LMArena / Chatbot Arena:** crowdsourced human-preference data is messy and conflicting across trackers (some aggregator sites show internally-inconsistent pricing/Elo pairs for GLM-5.2 — treat those specific mirrors skeptically). The one clean, citable independent comparison: on lmarena's WebDev leaderboard, GLM-5.2 (Max) is **#2 at Elo 1595, 59 points behind Fable 5** ([dev.to/kunal_d6a8fea2309e1571ee7](https://dev.to/kunal_d6a8fea2309e1571ee7/glm-52-vs-claude-fable-5-open-source-ai-challenges-the-throne-2026-347g)). On the same source's Agent category, the gap is much larger and more decision-relevant: **Fable 5 wins 14.05% of matchups versus GLM-5.2's 4.51%** — roughly a 3x gap specifically in multi-step agentic tool-use scenarios, the exact category the "long-horizon coding" headline is trying to claim. GLM-5.1's own LMArena text-Elo position (1471, from a May 2026 snapshot) sits ~30 Elo below the frontier cluster (1490-1502) ([presenc.ai](https://presenc.ai/research/lmsys-chatbot-arena-elo-rankings-may-2026)).

**Independent behavioral eval (GLM 5.2 vs Kimi K2.6, same harness, real data-engineering task):** an independently-published, evidence-first comparison ([github.com/dakshjain-1616](https://github.com/dakshjain-1616/-Independent-Evaluation-Report-GLM-5.2-vs-Kimi-k-2.6)) ran both models through the identical NEO agent workflow on a real repo audit/enrichment task. Key finding: **GLM 5.2 wrote an incorrect value straight into its final dataset and never surfaced the discrepancy — a silent data error invisible to output-level review** — while its narrower internal citation-count definition was internally consistent (not a fabrication) but *undercounted* the true scope of the problem relative to ground truth (its reported rates of 20/33/16% versus a recomputed ground truth of 44/44/26%). The same report notes GLM's evidence packaging is weak: no preserved intermediate result files, so a reviewer must "take the enriched output on faith or recompute from scratch."

**Terminal-Bench 2.1** (81.0 vendor/Cline-corroborated) appears consistently across kie.ai, apidog, and Cline's own public statement ("first open-weights model to cross 80%... beats every other open model, beats Gemini" — [venturebeat.com](https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost)), which is a real third-party toolmaker testimonial rather than a press re-plot, and is the strongest corroboration of "big generational leap" in this brief (62.0→81.0 GLM-5.1→GLM-5.2).

**AA-Omniscience hallucination-rate tracking (independent, longitudinal):** 67% (GLM-4.5) → 95% (GLM-4.6) → **28% (GLM-5.2)** ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive), citing @teortaxesTex tracking of Artificial Analysis data). A real, independently-tracked improvement — but 28% is still a nontrivial hallucination rate on this specific metric, not a "solved" number.

---

## 4. Behavioral properties / quirks

- **Text-only, hard constraint, independently confirmed as a binding limitation** — not a spec-sheet footnote. kie.ai names a specific practitioner (Chubby/@kimmonismus) hitting the vision wall directly on an autoresearch workflow requiring chart interpretation, forcing a fallback to programmatic analysis instead ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)). Any task involving screenshots, diagrams, UI review by eye, or chart reading is a hard no.
- **Reasoning-token verbosity is a real, independently-measured trait, not vendor spin.** GLM-5.2 (Max) burns roughly 2-2.7x the reasoning tokens of GPT-5.5 (xhigh) on comparable tasks (45K vs 16K tokens on a HN-documented math-evaluator test; 43K vs implied lower baselines on Artificial Analysis's Intelligence Index). This means latency and realized cost both run higher than the headline per-token price implies, especially at "Max" effort.
- **DeepSWE's own task shape** — multi-file coordinated edits, ~600+ lines touched per fix on average, isolated containers, strict CPU/memory limits ([testingcatalog.net](https://testingcatalog.net/zhipus-glm-5-2-tops-open-source-coding-benchmark-beating-claude-and-gemini/)) — is architecturally the closest neutral proxy available for "long-horizon multi-file coding stamina," and GLM-5.2's independently-measured 44% pass@1 there (vs the vendor's own 46.2%) is a genuine, non-catastrophic result. This is meaningfully different from MiniMax M3's collapse under the same style of test.
- **Silent under-reporting rather than fabrication or refusal.** The independent GLM-5.2 vs Kimi K2.6 comparison found GLM's error-reporting bias runs toward quietly *undercounting* problems it detects using an internally-consistent-but-narrower definition, rather than either (a) fabricating a confident wrong answer or (b) abstaining. It also produces less durable evidence trails (no preserved intermediate artifacts) than a competing model on the identical task, meaning verification of its own claims requires more manual re-derivation work from a reviewer. This is a distinct behavioral profile from MiniMax M3's abstain-vs-fabricate axis — GLM-5.2's failure mode looks more like "confidently ships a plausible-but-wrong number without flagging uncertainty," which is arguably a worse failure mode for autonomous coding agents than an honest abstention, because nothing in the output signals the reviewer should double-check.
- **"Zero failed runs across 84" agent-reliability claim is circulating but explicitly unverified.** Multiple independent commentators (via kie.ai's aggregation) flag this as the single most consequential and least-verified claim about GLM-5.2's real-world agent reliability, and explicitly call for someone to run a matched-pair harness against Opus 4.8 to check it. As of this brief, no such reproduction has surfaced. Do not treat this as established.
- **Weak spots relative to closed frontier:** CritPt (physics research reasoning) 20.9 vs GPT-5.5's 27.1 — a real, non-marginal gap on the vendor's own table. HLE 40.5, close to GPT-5.5 (41.4) but ~9.3 points behind Opus 4.8 (49.8). GPQA-Diamond 91.2, a real but modest ~2.4pt gap behind GPT-5.5/Opus (93.6). ARC-AGI-2: 22.8% versus GPT-5.5's 85% — a large gap, though at 1/7th the per-task cost ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)). Read together, GLM-5.2 is competitive-to-strong on agentic coding tasks specifically and meaningfully behind the closed frontier on hard general reasoning/science benchmarks.
- **Self-hostable at real-world consumer scale.** Unsloth's 1-bit GGUF quantization runs at ~21.6 tok/s on a Mac Studio M3 Ultra (256GB RAM) ([kie.ai](https://kie.ai/blog/glm-5-2-benchmark-deep-dive)) — a genuinely new capability tier for a frontier-adjacent open model, independent of the pi/Fireworks-hosted deployment being evaluated here.
- **On the user's own "good for delegated Zig implementation" observation:** there is no Zig-specific benchmark anywhere in the record (expected — no lab benchmarks per-language coding). The closest indirect support is DeepSWE's task shape (multi-file, large diffs, strict resource limits, five languages) showing non-catastrophic 44-46% independent pass@1, plus Terminal-Bench 2.1's jump to 81.0 (shell/agent multi-step tasks, language-agnostic). Both are consistent with — but do not directly prove — reliable behavior on a systems language like Zig. Treat the user's subjective read as plausible and roughly consistent with the neutral data, but not independently confirmed for that specific language.

---

## 5. Pros / cons

**Pros:**
- Real, independently-confirmed generational leap on Terminal-Bench 2.1 (62.0 → 81.0), corroborated by a third-party toolmaker (Cline) rather than just press re-plotting of the vendor chart.
- SWE-bench Pro > GPT-5.5 holds up under a neutral, non-vendor harness (Scale AI SEAL) — one of the few claims in this brief that survives independent scrutiny cleanly.
- DeepSWE pass@1 (44-46%) is corroborated across the benchmark's own maker (Datacurve), an independent aggregator (kie.ai), and the vendor — no MiniMax-style collapse under scrutiny.
- Artificial Analysis Intelligence Index: genuinely the top open-weight score (51), from a methodology-transparent third party, not a vendor-selected metric.
- MIT license with no regional restrictions, at a moment when the closest closed competitors (Fable 5, Mythos 5) are under active U.S. export-control lockout — a real strategic advantage for sovereign/offline deployment, not just a cost story.
- Per-token price is genuinely ~1/6-1/7 of GPT-5.5/Opus 4.8 — the raw sticker-price advantage is real and large.
- 1M usable context backed by a real architectural change (IndexShare) with a stated, plausible mechanism (indexer reuse across sparse attention layers), even though the paper itself hasn't been published.

**Cons:**
- The "beats GPT-5.5 on long-horizon coding at 1/6 cost" headline is a selective read of the vendor's own mixed scorecard: GPT-5.5 wins DeepSWE by 23.8 points, NL2Repo, ProgramBench, and Terminal-Bench on that same table.
- SWE-bench Verified — the one legacy benchmark that would let you compare cleanly against GLM-5.1's own prior 77.8% and against GPT-5.5's 82.6%/Opus's 88.6% — is simply not reported for GLM-5.2. That's a conspicuous omission of exactly the metric that would be least favorable.
- Reasoning-token verbosity (2-2.7x GPT-5.5's token spend at "Max" effort) means the realized per-task cost advantage is meaningfully smaller than the per-token price advantage — Artificial Analysis's own task-cost figures put GLM-5.2 at $0.46/task versus MiniMax-M3's $0.18.
- Text-only, no vision — a hard, independently-confirmed wall for any workflow touching screenshots, diagrams, charts, or UI-by-eye review.
- The "zero failed runs across 84" agent-reliability claim and the "bench-maxxed" counter-claim are both unresolved — nobody has published the matched-pair reproduction either way.
- Independent behavioral testing shows a silent-undercounting failure mode: it can ship a plausible-but-wrong result without flagging uncertainty and without leaving a reproducible evidence trail, which is a worse trust profile for autonomous coding agents than a model that abstains when unsure.
- Real, non-marginal gaps remain on hard general reasoning (CritPt, ARC-AGI-2, HLE vs Opus) — this is not a frontier-reasoning model, it's a frontier-adjacent coding/agentic model.
- Basic spec reporting (parameter count: 744B vs 743B vs 753B across sources) is inconsistent even among careful outlets, and no architecture paper exists to settle it.

---

## 6. When to use / when not (pi subagent routing)

GLM-5.2 is pi's default agent model, and the neutral evidence mostly supports that choice **for its actual, narrower niche** — everyday delegated coding, project-scale context work, and long-horizon multi-file engineering tasks at a genuinely favorable per-token price — while pushing back hard on the marketing frame that it's now interchangeable with the closed frontier.

**Genuine niche — use it as the default for:**
- Everyday delegated coding tasks, especially multi-file, multi-step engineering work bounded by text/code (its DeepSWE and Terminal-Bench numbers are the most independently-corroborated results in this brief, and both point at exactly this workload).
- Long-horizon coding marathons where project-level context matters — the 1M context window is architecturally real (IndexShare), not a marketing number, even if not independently stress-tested at the extreme end.
- Cost-sensitive delegation where the task doesn't need frontier-tier general reasoning — the per-token price advantage is real and large even after discounting for verbosity.
- Any workload where sovereign/offline/no-export-control deployment matters, given Fable 5/Mythos 5's current lockout — this is a structural advantage independent of benchmark scores.

**Should never be routed to:**
- Anything requiring vision or multimodal input — screenshots, diagrams, chart reading, UI-by-eye review. This is a hard, independently-confirmed wall, not a soft preference.
- Tasks that need the absolute reasoning frontier — hard physics/research reasoning (CritPt gap of 6.2 points vs GPT-5.5 on vendor's own table), ARC-AGI-2-style novel abstract reasoning (22.8% vs GPT-5.5's 85%), or graduate-level science reasoning at the margin (GPQA-Diamond, HLE both trail Opus 4.8 by meaningful amounts).
- Anything where the review/verification step matters more than the generation step and where silent, unflagged errors are costly — the independent GLM vs Kimi comparison found GLM-5.2 will ship a wrong number without surfacing the discrepancy, which is a worse failure mode for a verifier role than an abstain-heavy model.
- Latency-sensitive interactive work — the reasoning-token verbosity at Max effort (2-2.7x GPT-5.5's token spend) makes it a poor fit for anything where wall-clock response time matters more than per-token cost.

**Where the closed models earn their keep over the default:**
- **Opus 4.8** wins essentially every coding benchmark in this brief under both vendor and neutral scrutiny (SWE-bench Pro 69.2 vs 62.1 under Scale AI's SEAL harness; DeepSWE 58 vs 46.2; NL2Repo 69.7 vs 48.9; SWE-Marathon literally 2x). For the hardest, highest-stakes long-horizon engineering tasks, Opus 4.8 is still the stronger coder by a real, neutrally-confirmed margin — route there when correctness on a genuinely hard multi-hour task matters more than cost.
- **GPT-5.5** wins DeepSWE by a wide margin (70 vs 46.2, confirmed independently) and wins on reasoning-token efficiency (roughly 1/2 to 1/3 the tokens for comparable reasoning depth per the HN-documented comparison) — better fit when latency/efficiency matters as much as raw capability, or for the specific class of long-horizon task DeepSWE is meant to represent.
- **Fable/Mythos-class models** would in principle be the strongest available (Fable 5 leads LMArena's Agent category by ~3x win-rate over GLM-5.2, and leads WebDev Elo by 59 points), but they are currently locked out under U.S. export control and unavailable for general routing regardless of capability — a moot comparison for practical pi routing today, though worth revisiting if that changes.

**Honest verdict on the default choice:** the neutral data supports GLM-5.2 as the right default for the actual workload pi routes to it most — bounded, text-based, multi-file coding and agentic tasks at a real cost advantage — and the most load-bearing vendor claim (DeepSWE performance) survives independent scrutiny better than MiniMax M3's did, which is a meaningfully different trust profile. But "beats GPT-5.5 on long-horizon coding" as a general statement is false — GPT-5.5 wins the single hardest long-horizon benchmark in the set (DeepSWE) by a wide, independently-confirmed margin, and Opus 4.8 wins almost everything. The correct framing for routing purposes isn't "GLM-5.2 beats the closed frontier," it's "GLM-5.2 gets close enough on the specific benchmarks it was tuned for, at a real (if overstated) cost advantage, for a model with zero export-control risk" — which is a good enough case to keep it as the default for routine delegated coding, provided escalation to Opus 4.8/GPT-5.5 remains available and is actually used for the hardest, highest-stakes long-horizon or vision-touching tasks rather than being routed to GLM-5.2 by default inertia.

---

## Sources

- https://z.ai/blog/glm-5.2
- https://docs.z.ai/guides/llm/glm-5.2
- https://huggingface.co/zai-org/GLM-5.2
- https://huggingface.co/blog/zai-org/glm-52-blog
- https://the-decoder.com/zhipu-ais-glm-5-2-closes-in-on-closed-source-leaders-in-coding-marathons/
- https://the-decoder.com/us-government-forces-anthropic-to-disable-claude-fable-5-and-mythos-5-for-all-customers-worldwide/
- https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost
- https://datanorth.ai/news/zhipu-ai-releases-glm-5-2
- https://kie.ai/blog/glm-5-2-benchmark-deep-dive
- https://www.marktechpost.com/2026/06/14/z-ai-launches-glm-5-2-with-a-usable-1m-token-context-two-thinking-effort-levels-and-no-benchmarks-at-launch/
- https://www.digitalapplied.com/blog/glm-5-2-zai-flagship-coding-plan-release
- https://ground.news/article/zai-launches-glm-52-with-a-usable-1m-token-context-two-thinking-effort-levels-and-no-benchmarks-at-launch
- https://awesomeagents.ai/news/zhipu-glm-5-2-open-source/
- https://www.buildfastwithai.com/blogs/glm-5-2-review-2026
- https://artificialanalysis.ai/models/glm-5-2
- https://artificialanalysis.ai/articles/glm-5-2-is-the-new-leading-open-weights-model-on-the-artificial-analysis-intelligence-index
- https://aiweekly.co/alerts/z-ais-glm-52-tops-open-weights-intelligence-index-at-51
- https://aiscroll.io/article/general/glm-5-2-overtakes-gemini-flash/
- https://testingcatalog.net/zhipus-glm-5-2-tops-open-source-coding-benchmark-beating-claude-and-gemini/
- https://testingcatalog.net/open-source-glm-5-2-tops-coding-benchmark-beats-claude-and-gemini/
- https://benchlm.ai/benchmarks/deepSwe
- https://benchlm.ai/models/glm-5-2
- https://blog.getbind.co/glm-5-2-vs-claude-opus-4-8-vs-gpt-5-5-which-is-better-for-coding/
- https://apidog.com/blog/glm-5-2-benchmarks/
- https://dev.to/kunal_d6a8fea2309e1571ee7/glm-52-vs-claude-fable-5-open-source-ai-challenges-the-throne-2026-347g
- https://presenc.ai/research/lmsys-chatbot-arena-elo-rankings-may-2026
- https://github.com/dakshjain-1616/-Independent-Evaluation-Report-GLM-5.2-vs-Kimi-k-2.6
- https://news.ycombinator.com/item?id=48567759
