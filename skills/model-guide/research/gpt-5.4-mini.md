# GPT-5.4 mini — Critical Model Evaluation Brief

pi ID: `openai-codex/gpt-5.4-mini` · Brief date: 2026-07-09 · Bar: skeptical teardown, not vendor marketing

---

## 1. What it is

- **Vendor**: OpenAI.
- **Released**: March 17, 2026, alongside GPT-5.4 nano. Snapshot ID `gpt-5.4-mini-2026-03-17`. ([openai.com](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/), [ai-tldr.dev](https://ai-tldr.dev/models/gpt-5-4-mini/))
- **Architecture**: small-tier model in the GPT-5.4 family, positioned below flagship GPT-5.4 and above GPT-5.4 nano. No parameter count, MoE/dense structure, or architecture details disclosed — all "undisclosed/null" in every third-party spec table checked (ai-tldr.dev, topreviewed.ai). This is normal for OpenAI but worth flagging: there is zero independently verifiable architecture info, only relative-tier positioning from OpenAI's own naming.
- **Context**: vendor claims 400K tokens. pi caps this model at 272K in practice (a pi-side ceiling, not a vendor spec — worth remembering when routing tasks that assume the full 400K). Max output 128K tokens. Knowledge cutoff August 31, 2025.
- **Modalities**: text + image input, text-only output. No audio/video. No fine-tuning support.
- **Price**: $0.75/1M input, $4.50/1M output, $0.075/1M cached input (90% discount on cache hits). Batch API halves both sides ($0.375/$2.25). Confirmed against OpenAI's own pricing docs. ([developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing))
- **Open/closed**: fully closed. API-only, no weights, no self-hosting path. This matters directly for the GLM 5.2 comparison in §6 — GLM 5.2 is MIT-licensed and self-hostable; gpt-5.4-mini is not.

---

## 2. Vendor benchmark claims + methodology critique

OpenAI's launch post ([openai.com](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)) headlines: "approaches the performance of the larger GPT-5.4 model on several evaluations, including SWE-Bench Pro and OSWorld-Verified," plus "runs more than 2x faster" than GPT-5 mini. Reported numbers:

| Benchmark | GPT-5.4 (xhigh) | GPT-5.4 mini (xhigh) | GPT-5 mini (high) |
|---|---|---|---|
| SWE-Bench Pro (Public) | 57.7% | 54.4% | 45.7% |
| Terminal-Bench 2.0 | 75.1% | 60.0% | 38.2% |
| Toolathlon | 54.6% | 42.9% | 26.9% |
| GPQA Diamond | 93.0% | 88.0% | 81.6% |
| OSWorld-Verified | 75.0% | 72.1% | 42.0% |
| MCP Atlas | 67.2% | 57.7% | 47.6% |

**Methodology critique — concrete oddities, not clean:**

1. **All infra is OpenAI's own, all comparisons are intra-family.** Every table on the launch page compares GPT-5.4 mini against GPT-5.4 (base) and GPT-5 mini (predecessor) — zero competitor models (no Gemini, no Claude, no GLM, no Kimi) appear anywhere on OpenAI's own launch page. This is a "look how far we've come" post, not a "here's where we stand" post. You cannot assess competitive standing from the vendor page at all; you need third-party aggregators for that (see §3).
2. **Asymmetric reasoning-effort configs, semi-disclosed.** The table pits GPT-5.4 mini at "xhigh" effort against GPT-5 mini at "high" — with a footnote admitting "high" is the *ceiling* for GPT-5 mini, it has no xhigh tier. That's disclosed (credit where due) but it still means the comparison is each model's best case vs. best case, not equal-effort or equal-latency/equal-cost operating points. A more honest comparison would show GPT-5.4 mini at an effort level cost/latency-matched to GPT-5 mini's ceiling, which OpenAI doesn't provide.
3. **Headline benchmark itself has since been disclosed as broken by OpenAI's own team.** This is the big one: on 2026-07-08 (one day before this brief), OpenAI published "Separating signal from noise in coding evaluations" auditing SWE-Bench Pro — the *exact* benchmark used as GPT-5.4 mini's headline coding claim — and found **~30% of SWE-Bench Pro tasks are broken** (200/731 flagged by automated pipeline, 249/731 by human annotators), due to overly strict tests, underspecified prompts, low-coverage tests, and misleading prompts. OpenAI explicitly recommends the community treat SWE-Bench Pro results with caution going forward. ([openai.com/index/separating-signal-from-noise-coding-evaluations](https://openai.com/index/separating-signal-from-noise-coding-evaluations/)) This doesn't mean the 54.4% number is fabricated, but it means a meaningful fraction of the underlying tasks contributing to that score are not measuring what they claim to measure — some real fixes were failing overly-strict tests, some broken fixes were passing low-coverage tests. Any headline built on SWE-Bench Pro (from any vendor, including this one) should be treated as directionally suggestive, not precise.
4. **Toolathlon and MCP Atlas are legitimate third-party benchmarks** (Toolathlon from an academic team, arXiv 2510.25726; MCP Atlas from Scale AI, arXiv 2602.00933) — so unlike some vendor launches that invent in-house evals, OpenAI is at least citing benchmarks built and open-sourced by outside groups. That's a genuine point in their favor. But OpenAI still runs the evaluation itself and reports its own numbers — no independent party has reproduced OpenAI's specific Toolathlon/MCP-Atlas scores for gpt-5.4-mini as of this writing.
5. **No SWE-Bench Verified number offered at all.** Notably absent from the launch post. OpenAI stopped reporting SWE-Bench Verified for its own stated reasons (contamination, see their prior post "why we no longer evaluate SWE-bench Verified") — a defensible position, but it also means there's no year-over-year comparable coding number bridging GPT-5/GPT-5 mini era claims to GPT-5.4 mini.

**Verdict**: not clean. The launch page is well-organized and cites real third-party benchmarks, but it's an intra-family showcase with no competitor numbers, a partially-disclosed asymmetric config, and its central coding claim rests on a benchmark OpenAI's own research team flagged as ~30% broken the day before this brief was written.

---

## 3. Neutral / independent evals — the load-bearing section

**DeepSWE (independent, most important cross-check found).** DeepSWE is a separate long-horizon coding benchmark (113 novel tasks across 91 active repos, 5 languages, purpose-built verifiers, tasks never merged upstream to avoid contamination) run by DataCurve, explicitly designed to fix problems the DeepSWE team found in SWE-Bench Pro (~8% solution leakage/false positives in their own audit of SWE-Bench Pro rollouts) and SWE-Bench Verified. On DeepSWE's live leaderboard, **gpt-5.4-mini (think x-high) scores 24.3% pass@1** (95% CI ±4.0%, pass@4 46.0%, median cost-to-pass $2.03). ([deepswe.datacurve.ai](https://deepswe.datacurve.ai/), [benchmarklist.com](https://benchmarklist.com/models/openai-gpt-5.4-mini/), corroborated independently at [ai-stats.phaseo.app](https://ai-stats.phaseo.app/benchmarks/deepswe): "GPT 5.4 Mini | 17 Mar 2026 | 24% | mini-swe-agent; effort xhigh; 24% +/-3%")

That 24.3% sits in this independent DeepSWE ranking (pass@1):

| Model | DeepSWE pass@1 |
|---|---|
| gpt-5.5 [xhigh] | 70% |
| gpt-5.4 [xhigh] | 56% |
| claude-opus-4.7 [max] | 54% |
| claude-sonnet-4.6 [high] | 32% |
| gemini-3.5-flash [medium] | 28% |
| **gpt-5.4-mini [xhigh]** | **24%** |
| kimi-k2.6 | 24% |
| mimo-v2.5-pro | 19% |
| glm-5.1 | 18% |
| gemini-3.1-pro | 10% |

**Important caveat on this comparison**: DeepSWE is *not* the same benchmark as SWE-Bench Pro — it's a distinct, harder, contamination-resistant benchmark, so 24.3% on DeepSWE and 54.4% on SWE-Bench Pro are not directly the "same test, different number" contradiction that made the MiniMax M3 case so damning. But the qualitative picture is the same kind of gap: on a benchmark specifically designed to strip out the leakage/contamination/loose-verifier issues that inflate scores on easier public benchmarks, gpt-5.4-mini drops to roughly half its own-benchmark headline and lands in the bottom third of a 13-model field — below its own base model (56%), well below GPT-5.5 (70%), and only tied with Kimi K2.6, just above GLM-5.1 (18%, one generation behind the GLM 5.2 default this brief is routing against). The vendor's "approaches GPT-5.4-level performance" framing does not survive contact with this independent long-horizon benchmark: the gap to GPT-5.4 base widens from ~3 points (SWE-Bench Pro, per-vendor) to ~32 points (DeepSWE, independent).

**Artificial Analysis (independent, aggregator).** AA scores GPT-5.4 mini (xhigh) at **40 on their Intelligence Index v4.1** (9-eval composite: GDPval-AA v2, τ³-Banking, Terminal-Bench v2.1, SciCode, HLE, GPQA Diamond, CritPt, AA-Omniscience, AA-LCR), ranked **#12 of 47** models tracked, and generates notably verbose output (220M tokens on the eval suite vs. 72M average — a real cost tax AA calls out explicitly). Coding Index (separate composite) is 51.5 vs. GPT-5.4 base's 57.3. ([artificialanalysis.ai/models/gpt-5-4-mini](https://artificialanalysis.ai/models/gpt-5-4-mini), [ominigate.ai](https://ominigate.ai/en/vs/gpt-5-4-vs-gpt-5-4-mini), [verdictpal.com](https://verdictpal.com/models/gpt-5-4-mini)) AA's own framing ("well above average among comparable models") is doing some cherry-picked-cohort work — "average" here means AA's self-defined price-tier peer group, not the full field, where it actually sits mid-pack (#12/47).

**Vals AI Agentic Index**: gpt-5.4-mini ranks **#10 of 18** at a score of 51 — solidly mid-pack on agentic tasks, not top-tier. ([verdictpal.com](https://verdictpal.com/models/gpt-5-4-mini), sourcing vals.ai)

**Toolathlon (independent leaderboard, not OpenAI-run)**: the public Toolathlon leaderboard (toolathlon.xyz) does not list a gpt-5.4-mini row in the data pulled for this brief, but shows GLM 5.2 (max) at 59.9% pass@1 and GPT-5.5 at 73.5% — useful context since OpenAI's own Toolathlon number for gpt-5.4-mini (42.9%) is self-run and not corroborated against this independent leaderboard's methodology.

**Bottom line**: there IS a neutral cross-check, and it materially qualifies the vendor story. DeepSWE — independently run, contamination-resistant, purpose-built to expose exactly the kind of inflation OpenAI's own SWE-Bench Pro audit later confirmed — puts gpt-5.4-mini in the bottom third of frontier/near-frontier models on genuine long-horizon software engineering, well behind its own base model and this brief's default (GLM 5.2, one generation ahead of the glm-5.1 comparator shown above). Artificial Analysis and Vals AI both independently confirm a mid-pack (not "near-frontier") standing once you leave OpenAI's own family-only framing.

---

## 4. Behavioral properties / quirks

- **Genuinely fast, and that's the real differentiator, not the score.** OpenRouter/third-party serving data: ~185 tok/s output vs. GPT-5.4 base's ~94 tok/s, and time-to-first-token of ~6.5s vs. base's ~176s under max reasoning load ([ominigate.ai](https://ominigate.ai/en/vs/gpt-5-4-vs-gpt-5-4-mini)). Independently corroborated "2x faster than GPT-5 mini" claim is plausible and consistent across sources (ai-tldr.dev, verdent.ai, aifreeapi.com) though none independently re-measured it against GPT-5 mini directly — it's a repeated citation of OpenAI's own claim, not a re-run benchmark.
- **Full computer-use / tool surface at mini-tier pricing is unusual.** Supports hosted shell, apply_patch, computer use (screenshot-driven UI operation), MCP, tool search, skills — a complete agentic tool stack rarely offered this cheap. This is the actual product differentiator, more than any benchmark number.
- **Reddit/Copilot field reports (anecdotal, not benchmark-grade) consistently describe it as an execution model, not a planning model**: "in terms of planning it is kinda dumb even on high reasoning so use a different model for it. but with a detailed plan, it is REALLY good for execution... quite fast as well" and "EXTREMELY request efficient" for large refactors when given a detailed plan (r/GithubCopilot via neura.market). This lines up exactly with OpenAI's own stated design intent: "a larger model handles planning, coordination, and final judgment, while GPT-5.4 mini handles narrower supporting tasks in parallel" — i.e., OpenAI's own launch post explicitly describes this model as a subagent executor, not a top-level planner.
- **Token-verbosity tax.** AA flags 220M tokens consumed on their eval suite vs. 72M average for comparable models — meaning even where it scores adequately, it may cost more in practice than the sticker price suggests, especially on output-heavy tasks where output is billed at 6x input rate.
- **Long-context degrades hard, disproportionately vs. the frontier sibling.** On OpenAI's own MRCR v2 needle-in-haystack numbers: GPT-5.4 base holds 86.0% at 64K-128K and 79.3% at 128K-256K; GPT-5.4 mini drops to 47.7% and 33.6% at the same ranges respectively. This is a much steeper degradation curve than the "near-frontier" coding story suggests — long-context retrieval is one of the mini tier's weakest points, not a strength, despite the 400K context window headline.
- **Capability ceiling vs. frontier**: HLE without tools drops from 39.8% (GPT-5.4 base) to 28.2% (mini); OSWorld-Verified drops less (75.0% → 72.1%, a real strength area). The ceiling gap is uneven across task types — computer-use/screen-reading holds up close to frontier, hard closed-book reasoning and long-context retrieval do not.

---

## 5. Pros / cons

**Pros:**
- Cheapest OpenAI tier with a *complete* agentic tool surface (computer use, hosted shell, apply_patch, MCP, tool search) — genuinely rare combination at $0.75/$4.50.
- Real, independently-corroborated speed advantage (~185 tok/s, ~6.5s TTFT) that matters more for subagent-fanout UX than most benchmark deltas.
- 90% cached-input discount plus 50% Batch discount stack meaningfully for input-heavy, repeated-context workloads (repo Q&A, code review) — effective cost can undercut the sticker price by an order of magnitude in the right architecture.
- Vision input support at this price/speed tier is a genuine capability GLM 5.2 (text-only) simply cannot offer.
- OSWorld-Verified (computer use) holds up close to frontier (72.1% vs. base's 75.0%) — the model's actual strength area, not its marketed strength area (coding).

**Cons:**
- Independent DeepSWE score (24.3% pass@1) is roughly half the vendor's own SWE-Bench Pro headline (54.4%) and puts it in the bottom third of a 13-model field on genuine long-horizon engineering — barely ahead of GLM-5.1 and tied with Kimi K2.6.
- The vendor's headline coding benchmark (SWE-Bench Pro) was disclosed by OpenAI's own research team, one day before this brief, to have ~30% broken tasks — undermining confidence in the precision of any SWE-Bench Pro number, vendor or otherwise.
- Field reports and OpenAI's own positioning agree: weak at planning, even at high reasoning effort — it needs a stronger model to hand it a detailed plan, it is not a standalone reasoning engine.
- Long-context retrieval degrades sharply (MRCR v2: 86.0%→47.7% at 64-128K comparing base to mini) despite the 400K headline window — and pi caps it further to 272K.
- No fine-tuning, no self-hosting, no open weights — full vendor lock-in, API-only, subject to OpenAI pricing/availability changes.
- Verbose/token-hungry on eval suites (220M vs. 72M average per AA) — real cost inflation risk on output-heavy tasks given output is billed at 6x the input rate.
- No GPT-5.5-mini exists yet — escalation path from mini jumps straight to full-cost GPT-5.4 base or GPT-5.5, no intermediate step.

---

## 6. When to use / when not — pi subagent routing

**Context**: default pi agent is GLM 5.2 (open-weight/MIT, self-hostable, $1.40/$4.40, 1M context, text-only, independently strong on coding — GLM 5.2 scores 62.1% on SWE-Bench Pro per Z.ai's own self-reported figure and is a leading open-weights model on Toolathlon 59.9%/MCP-Atlas 76.8% per independent Toolathlon leaderboard). gpt-5.4-mini needs to earn its place *against* that baseline, not against a strawman.

**gpt-5.4-mini's genuine niche in a pi routing setup:**
- **Vision-dependent subagent tasks.** GLM 5.2 is text-only. Any subtask requiring reading a screenshot, UI mock, diagram, or image-based bug report has no GLM 5.2 path at all — this is the single cleanest, least arguable case for gpt-5.4-mini over the default.
- **Computer-use / screen-operating subagents.** OSWorld-Verified 72.1% (mini) vs. GLM 5.2 having no comparable computer-use benchmark presence at all — this is an OpenAI-ecosystem-specific capability (hosted shell, computer use) that doesn't have a GLM 5.2 equivalent.
- **High-volume, input-heavy, narrow-scope execution steps in an agent loop** where a bigger model (or GLM 5.2 itself) has already produced the plan — read file, run test, interpret result, apply small patch. This matches both OpenAI's own stated design intent and the anecdotal field reports above. Cache discounts make this cheap if the harness structure supports prefix caching.
- **Latency-critical fan-out** where many parallel narrow subagent calls need to return fast — the ~6.5s TTFT / ~185 tok/s profile beats waiting on a slower, larger model for trivial per-call latency.
- **OpenAI-specific tool ecosystem dependencies** — if the harness already uses Codex, Responses API skills, or OpenAI-flavored MCP tooling, staying in-ecosystem avoids integration friction that would exist calling out to GLM 5.2's separate API surface.

**What it should never do:**
- Hard reasoning or longest-horizon coding tasks. The independent DeepSWE number (24.3%) says this plainly — it is not a capable standalone software engineer on genuinely novel, long-horizon problems. Don't hand it an ambiguous or underspecified engineering task and expect it to plan its way through; both benchmark data and field reports agree it needs the plan handed to it.
- Anything requiring large-context retrieval precision beyond ~100K tokens — the MRCR v2 falloff (47.7% at 64-128K) means it will silently miss details in big repo/document contexts well before hitting its context ceiling.
- Final judgment / verification / plan-authoring roles in a multi-agent architecture — this is explicitly not what it's built for, per both OpenAI's own positioning and observed behavior.

**Where it beats GLM 5.2, specifically (the key question):**
GLM 5.2 is cheaper on the API list price in one direction only ($1.40/$4.40 vs $0.75/$4.50 — GLM is actually pricier on both ends per raw list price, though its 81% cache discount and MIT self-host option can undercut this in the right deployment) and independently stronger on long-horizon coding (SWE-Bench Pro 62.1% self-reported vs. gpt-5.4-mini's 54.4% vendor-reported — and no independent long-horizon cross-check like DeepSWE has been found for GLM 5.2 in this research pass, so that comparison itself carries some asymmetry worth flagging). Given that, gpt-5.4-mini earns the pick over GLM 5.2 specifically when: (1) the task needs vision input — GLM 5.2 has none; (2) the task needs computer-use / screen-operating tool calls — GLM 5.2 has no comparable capability; (3) per-call latency matters more than per-token cost, e.g. many small fast subagent calls in a tight loop, where mini's TTFT/throughput profile is a genuine edge; (4) the harness is already OpenAI-native (Codex, Responses API tool surface) and switching API providers mid-pipeline adds real integration cost. Outside those four cases — plain-text coding, repo Q&A, code review, routine narrow agent-loop calls with no vision/tool-use requirement — GLM 5.2 is the better default: independently stronger on coding benchmarks, open-weight (no vendor lock-in), and not meaningfully more expensive once cache discounts are factored in on either side.

---

## Sources

- https://openai.com/index/introducing-gpt-5-4-mini-and-nano/
- https://openai.com/index/separating-signal-from-noise-coding-evaluations/
- https://ai-tldr.dev/models/gpt-5-4-mini/
- https://www.verdent.ai/guides/gpt-5-4-mini-api-developers
- https://developers.openai.com/api/docs/pricing
- https://artificialanalysis.ai/models/gpt-5-4-mini
- https://artificialanalysis.ai/models/comparisons/gpt-5-4-mini-vs-gpt-5-4
- https://artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning
- https://benchmarklist.com/models/openai-gpt-5.4-mini/
- https://ai-stats.phaseo.app/benchmarks/deepswe
- https://deepswe.datacurve.ai/
- https://deepswe.datacurve.ai/blog/deepswe
- https://entrpi.github.io/misc/deep-swe-minimax-m3/ (cross-reference table)
- https://www.thequery.in/articles/deepswe-benchmark-claude-loophole-gpt-55-coding-leader
- https://verdictpal.com/models/gpt-5-4-mini
- https://ominigate.ai/en/vs/gpt-5-4-vs-gpt-5-4-mini
- https://topreviewed.ai/models/gpt-5-4-mini
- https://www.aifreeapi.com/en/posts/gpt-5-4-mini-vs-gpt-5-mini
- https://www.aifreeapi.com/en/posts/gpt-5-4-vs-gpt-5-mini
- https://www.neura.market/directories/copilot/posts/reddit-1sb938g
- https://www.reddit.com/r/codex/comments/1rwdjwl/anyone_tried_gpt54_mini_worth_it/
- Scale AI SWE-Bench Pro: https://scale.com/blog/swe-bench-pro , https://arxiv.org/html/2509.16941v1 , https://github.com/scaleapi/SWE-bench_Pro-os
- Toolathlon: https://toolathlon.xyz/introduction , https://arxiv.org/pdf/2510.25726
- MCP-Atlas: https://github.com/scaleapi/mcp-atlas , https://arxiv.org/html/2602.00933
- GLM 5.2 (comparator): https://claudefa.st/blog/models/glm-5-2 , https://www.llmreference.com/model/glm-5.2 , https://www.datacamp.com/blog/glm-5-2 , https://avenchat.com/blog/glm-5.2-review

Not fetchable during this research pass (HTTP 522 both attempts): https://elkapi.com/gpt-54-mini-075m-2x-faster/ — speed claim corroborated instead via ai-tldr.dev, verdent.ai, ominigate.ai, and aifreeapi.com, which independently cite the same "2x faster than GPT-5 mini" figure and consistent tok/s and TTFT numbers.
