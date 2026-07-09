# Kimi K2.7 Code — Critical Model Evaluation Brief

pi ID: `fireworks/accounts/fireworks/models/kimi-k2p7-code`
Prepared: 2026-07-09 · Status: skeptical teardown, not vendor summary

---

## 1. What it is

- **Vendor:** Moonshot AI (Beijing; backed by Alibaba, Tencent, China Mobile; ~$20B valuation as of May 2026). [kimi.com](https://www.kimi.com/resources/kimi-k2-7-code)
- **Release date:** June 12, 2026. Fifth major K2-line release in under a year (K2 base Jul 2025 → K2 Thinking Nov 2025 → K2.5 Jan 2026 → K2.6 Apr 2026 → K2.7 Code Jun 2026). [pureailabs.com](https://pureailabs.com/ai-coder/kimi-code-review/)
- **Architecture:** MoE, 1T total params / 32B active per token, 384 experts (8 selected + 1 shared), 61 layers (1 dense), MLA attention, SwiGLU, 160K vocab. Built directly on the K2.6 checkpoint — same backbone, coding-specialized post-training. Ships **natively INT4-quantized** (same scheme as K2-Thinking); no higher-precision release exists to fall back to. [huggingface.co/moonshotai/Kimi-K2.7-Code](https://huggingface.co/moonshotai/Kimi-K2.7-Code)
- **Context / output:** 262,144-token context. Default `max_tokens` is **32,768 (32K)**, not user-adjustable to "unlimited" in the way some aggregator pages (modelgrep) claim — the Kimi API quickstart docs are explicit that 32K is the default output cap. Task brief's "33K" figure is a rounding of this 32,768 default. [platform.kimi.ai quickstart](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)
- **Modalities:** text + image + video (MoonViT, 400M-param vision encoder). Recommended max resolution 4K image / FHD video — higher costs latency with no quality gain per Moonshot's own docs.
- **Pricing (Fireworks, matches Moonshot's own):** $0.95/1M input, $4.00/1M output, $0.19/1M cached input. A HighSpeed variant exists at 2x price ($1.90/$8.00, $0.38 cached) for ~180–260 tok/s. [fireworks.ai/blog](https://fireworks.ai/blog/kimi-k2p7-code)
- **License:** Modified MIT. Per one independent teardown that actually opened the LICENSE file: standard MIT text **plus an added clause requiring UI attribution once a deployment exceeds 100M MAU or $20M/month revenue** — a real but narrow restriction, not a blocker for typical use. [future-stack-reviews.com](https://future-stack-reviews.com/glm-5-2-kimi-k2-7-code-open-weights/)
- **Behavioral lock-in:** thinking mode **cannot be disabled** — `thinking: {"type": "disabled"}` throws an API error, and in Kimi Code CLI, requests with thinking off get silently routed to K2.6 instead. Temperature is hard-pinned to 1.0, top-p to 0.95, n to 1 — any other value errors out. This is unusual rigidity for a model API and forecloses cheap/fast "quick answer" calls entirely. [kimi.com](https://www.kimi.com/resources/kimi-k2-7-code), [devops.com](https://devops.com/moonshot-ais-kimi-k2-7-code-targets-token-efficiency-in-agentic-coding/)
- Self-host footprint: ~630–640GB at native INT4 (8×H200-class), ~2TB class at higher precision by deployment math — not a laptop model despite the "open weight" framing. [future-stack-reviews.com](https://future-stack-reviews.com/glm-5-2-kimi-k2-7-code-open-weights/)

---

## 2. Vendor benchmark claims + methodology critique

Moonshot's own comparison table (kimi.com resource page + HF model card, identical numbers):

| Benchmark | K2.6 | **K2.7 Code** | GPT-5.5 | Opus 4.8 |
|---|---|---|---|---|
| Kimi Code Bench v2 | 50.9 | **62.0** (+21.8%) | 69.0 | 67.4 |
| Program Bench | 48.3 | **53.6** (+11.0%) | 69.1 | 63.8 |
| MLS Bench Lite | 26.7 | **35.1** (+31.5%) | 35.5 | 42.8 |
| Kimi Claw 24/7 Bench | 42.9 | **46.9** | 52.8 | 50.4 |
| MCP Atlas | 69.4 | **76.0** | 79.4 | 81.3 |
| MCP Mark Verified | 72.8 | **81.1** | 92.9 | 76.4 |

**Oddities, in order of severity:**

1. **Non-comparable harnesses in the vendor's own headline table.** K2.7 Code and K2.6 were run in **Kimi Code CLI** at fixed temp=1.0/top-p=0.95; GPT-5.5 ran in **Codex (xhigh)**; Opus 4.8 ran in **Claude Code (xhigh)**. Three different agent scaffolds, three different tool-calling loops, three different prompt/harness overheads — presented in one table as if the numbers are apples-to-apples. Moonshot discloses this in a footnote, which is more transparency than some vendors offer, but it doesn't fix the comparison. [kimi.com footnote](https://www.kimi.com/resources/kimi-k2-7-code)

2. **Two of six benchmarks are explicitly in-house and non-reproducible.** Kimi Code Bench v2 and Kimi Claw 24/7 Bench are Moonshot-designed, Moonshot-administered, Moonshot-scored. No public dataset, no external leaderboard, no way for anyone outside Moonshot to rerun them. These two benchmarks also carry the two largest relative gains claimed (+21.8%, and the agentic "roughly 10%" framing) — the flashiest numbers are the least checkable ones.

3. **The "external" benchmarks aren't independently run either.** Program Bench and MLS-Bench Lite have public test definitions (programbench.com, mls-bench.com), which is better than pure in-house — but Moonshot still self-administered and self-scored K2.7 Code's runs. Neither programbench.com nor mls-bench.com's own leaderboards were checked against Moonshot's submitted number for this brief; treat as vendor-reported-on-a-third-party-testset, not third-party-verified.

4. **MCP Atlas and MCP Mark Verified claims don't match the actual public leaderboard.** Scale AI's live MCP-Atlas leaderboard (labs.scale.com/leaderboard/mcp_atlas, updated Apr 8 2026) lists neither Kimi K2.6 nor K2.7 Code — the only Kimi model present is **kimi-k2p5 at 64.4%**, well below the 76.0 Moonshot reports for K2.7 Code and even the 69.4 claimed for K2.6. Moonshot says it "followed the official MCP-Atlas evaluation configuration," but the score never appears on Scale's own board, meaning it was a self-run replication of the eval harness, not a submission verified by the benchmark owner. This is the single clearest instance of a vendor claim that a neutral, checkable source directly contradicts.

5. **The predecessor (K2.6) *did* submit to public leaderboards — SWE-Bench Verified/Pro/Multilingual, Terminal-Bench 2.0, GPQA-Diamond, LiveCodeBench — all visible in K2.6's HF README. K2.7 Code conspicuously drops every one of those public/reproducible benchmarks from its own card and replaces them with the in-house Kimi Code Bench v2 / Kimi Claw suite.** That's a benchmark-suite swap in the exact direction that removes external checkability — worth flagging on its own, independent of whether the new suite is "worse."

6. **Downstream aggregator confusion compounds the problem.** At least one secondary source (VM0.ai) attributes a "SWE-bench Pro 58.6, beats GPT-5.4 and Opus 4.6" claim to K2.7 Code — but 58.6 is actually **K2.6's** SWE-Bench Pro score from the K2.6 HF README, not a K2.7 Code number (K2.7 Code has never published a SWE-Bench Pro score at all). Several review sites have silently carried K2.6's public-benchmark credibility over onto K2.7 Code, which never earned it. Same source also cites a "hallucination rate dropped from 65% to 39%" figure that appears nowhere in Moonshot's own materials — unsourced, likely a misattribution or fabrication by the aggregator. Both are flagged here as noise to filter out, not facts to repeat.

7. **All reported gains are relative-to-K2.6 percentages, not absolute rank-among-competitors.** "+21.8%" sounds decisive; the underlying absolute numbers (62.0 vs GPT-5.5's 69.0, Opus's 67.4) show K2.7 Code still trailing both closed frontier models on every coding benchmark it reports except MCP Mark Verified. The framing leads with relative improvement over its own prior release, not standing versus the field.

**Net verdict on methodology:** this is a dirtier setup than a clean release. Non-comparable scaffolds in the flagship table, headline gains concentrated on the least-checkable benchmarks, at least one categorical claim (MCP Atlas 76.0) that contradicts the benchmark owner's own public leaderboard, and a suite swap away from previously-submitted public tests. Multiple independent outlets (DevOps.com, VentureBeat, felloai, awesomeagents, agentguides) converged on the same read within days of launch: *treat every number as vendor-reported and directional.*

---

## 3. Neutral / independent evals — the load-bearing section

**Artificial Analysis (genuinely independent, most important data point found):**

- Intelligence Index: **Kimi K2.7 Code = 42, Kimi K2.6 = 44.** By AA's own independent methodology, **the "coding-focused successor" scores *lower* than its own predecessor on general intelligence** — the opposite direction of every vendor claim. [artificialanalysis.ai/models/comparisons/kimi-k2-7-code-vs-kimi-k2-6](https://artificialanalysis.ai/models/comparisons/kimi-k2-7-code-vs-kimi-k2-6)
- A second AA-derived source (Opper.ai) puts K2.7 Code's Intelligence Index at 41.9, Coding Index at 60.8, global rank #26 of 538 tracked LLMs, GPQA Diamond 90%, HLE 33%, Terminal-Bench Hard 45%, τ²-Bench Telecom 90%. [opper.ai/moonshot/kimi-k2-7-code](https://opper.ai/moonshot/kimi-k2-7-code)
- Output speed is the one place K2.7 Code independently beats K2.6 (46 tok/s vs 43 tok/s) — consistent with the token-efficiency pitch, though a small margin.
- This is the closest analog to the M3/DeepSWE gap in this brief: **the vendor's own comparison table shows K2.7 Code beating K2.6 on all six reported benchmarks; the one clean neutral index available shows it losing to K2.6.** That's a direct contradiction, not just an "inside variance" nuance.

**DeepSWE (independent, high-discriminating-power benchmark, 70-point spread across models):**

- **No K2.7 Code score exists.** Moonshot has not submitted it. The only public number is **K2.6 at 24% pass@1, tied with GPT-5.4-mini** — a mid-pack/weak result for a model whose vendor positions it as beating Opus and GPT-5-class systems on its own suites. [rankedagi.com/models/kimi-k2-6](https://rankedagi.com/models/kimi-k2-6)
- Independent developer Sugumaran Balasubramaniyan (built a model-router for the Hermes Agent platform using DeepSWE as reference signal) publicly challenged Moonshot on this gap: *"Respectfully, every model 'improves' double digits on its own test suite"* — and asked why K2.7 Code wasn't submitted to DeepSWE. His stated conditional: *"I would route coding tasks to K2.7-Code if the independent numbers hold up."* As of this writing, they haven't been produced. [venturebeat.com](https://venturebeat.com/technology/kimi-k2-7-code-cuts-thinking-tokens-30-practitioners-say-benchmarks-dont-check-out)
- **Caveat, per the task instructions:** this is a K2.6 proxy number, not a K2.7 Code measurement. Given AA's finding that K2.7 Code underperforms K2.6 on general intelligence, there's no basis to assume K2.7 Code would score *better* than 24% on DeepSWE — if anything the AA data point argues the opposite.

**KernelBench-Hard (independent, public, GPU-kernel-generation benchmark):**

- Researcher Elliot Arledge ran K2.7 Code, K2.6, and Claude Fable 5 head-to-head, publishing full logs at kernelbench.com. Result: on 5 of 6 problems K2.7 Code produced genuinely authored Triton kernels where K2.6 had used library wrappers (more honest), but **2 of those authored kernels failed on the model's own bugs**, and the **MoE kernel score regressed from K2.6's 0.222 to K2.7's 0.157** — a real capability regression on a public, reproducible test. Arledge's verdict: *"K2.7 is more honest but not more capable."* [devops.com / open-techstack.com](https://open-techstack.com/blog/kimi-k2-7-code-open-weights-agentic-coding/)

**MCP-Atlas (independent, Scale AI, public leaderboard):**

- The live public leaderboard (updated April 2026) does not list Kimi K2.6 or K2.7 Code at all. The only Kimi entry is kimi-k2p5 at 64.4% pass rate (rank ~12 of 20), well below Moonshot's self-reported 76.0 for K2.7 Code. This directly undercuts the vendor's MCP Atlas claim — see §2 point 4.

**GLM 5.2 comparisons (the actual competitive question for pi routing):**

- GLM 5.2 published its SWE-bench Pro score (62.1%) with third-party verification per Z.ai's own materials, and independent testers (open-techstack.com) rank it the top open-weight model on SWE-Bench Pro, Terminal-Bench 2.1, and FrontierSWE — benchmarks K2.7 Code simply doesn't report numbers for at all. In a Composio 21-integration tool-use eval, GLM 5.2 edged K2.7 Code 0.800 vs 0.775 — close, but GLM ahead on the one truly independent apples-to-apples run found. [open-techstack.com/glm-5-2-vs-kimi-k2-7-code-comparison](https://open-techstack.com/blog/glm-5-2-vs-kimi-k2-7-code-comparison/), [composio.dev](https://composio.dev/content/glm-vs-kimi)
- A blind head-to-head build test (Kilo Blog: feature-flag service with a deliberate caching trap) scored GLM 5.2's plan 9.0 vs K2.7 Code's 8.1 — GLM caught the invalidation trap and reasoned explicitly about hash-key tradeoffs; K2.7 Code missed the trap and defaulted to a costlier crypto choice (bcrypt) without justification. Execution was closer: GLM passed 15/15 integration checks, K2.7 Code 14/15. [blog.kilo.ai](https://blog.kilo.ai/p/glm-52-vs-kimi-k27-code-which-model)

**Bottom line for §3:** every independent, reproducible, checkable data point found — AA Intelligence Index, DeepSWE (K2.6 proxy), KernelBench-Hard, the MCP-Atlas public leaderboard, and a blind build comparison against GLM 5.2 — either contradicts or fails to corroborate the vendor's "substantial gains" narrative. The one place K2.7 Code independently wins is raw token/output efficiency (speed, cost), not coding quality.

---

## 4. Behavioral properties / quirks

- **~30% fewer thinking tokens than K2.6** is the actual differentiated pitch, and it's the one claim that's mechanically easy to verify yourself (count tokens on your own workload) rather than trust a leaderboard. Independent commentary (Futurum Group's Mitch Ashley, quoted in DevOps.com) frames this correctly as a *transitory* advantage: "Selling a release's efficiency gain is shipping a feature that the next model erases."
- **Mandatory thinking, fixed sampling params.** No non-thinking mode, temperature pinned to 1.0, top_p to 0.95, n=1 — any deviation errors. This means no cheap "quick classify/format" calls on this model id; every single call pays reasoning-token overhead, undercutting the token-efficiency pitch for latency-sensitive, low-complexity tasks. In Kimi Code CLI, disabling thinking silently reroutes you to K2.6, which is a confusing failure mode if you're not aware of it.
- **"More honest, not more capable"** (Arledge's KernelBench framing) — this is the closest behavioral analog to the M3 "abstains vs fabricates" property. K2.7 Code appears tuned to write real, authored implementations rather than reach for library-wrapper shortcuts, which is a genuinely different failure mode than K2.6's — but "more honest" code that has *more actual bugs* (2/6 failing kernels, MoE regression) is not a strict improvement. It trades one kind of dishonesty (wrapper-as-answer) for a different kind of unreliability (bugs in real but broken code).
- **Verbosity / over-engineering is the single most consistently reported user complaint** across Reddit (r/LLMDevs, r/kimi, r/LocalLLaMA), PureAILabs, and open-techstack: a yes/no question returns three paragraphs; a file-rename script comes back with a full CLI, progress bars, and error logging nobody asked for. The documented mitigation ("Keep it simple. No unnecessary abstractions." in the system prompt) helps but doesn't eliminate it — this is a tax on every session, not a one-time setup cost.
- **Long-horizon / tool-use stamina is a genuine, differently-sourced strength.** Documented unattended sessions of 12+ hours and 4,000+ tool calls (Moonshot's own claim, but consistent with the architectural design — Preserve Thinking retains reasoning across turns instead of discarding it) and Reddit reports of 200–300 sequential tool calls without falling over, which multiple users say exceeds what GPT-5.2-class models handle before hitting context/rate limits. This is plausible given the 262K context and native agentic post-training, though it's not independently benchmarked.
- **"Lost in the middle" context degradation** reported once the 262K window fills — Moonshot's own recommended workaround is agentic sequential file reading rather than dumping a whole repo in at once, an implicit admission that the advertised context length degrades in practice before you hit the wall.
- **Vision support is real and functional** (image + experimental video, 4K/FHD recommended max), positioned for screenshot-to-code review, UI diffing, and mockup-to-component work — a genuine capability GLM 5.2 (text-only) categorically lacks.
- **Native INT4 quantization ships as the only public build.** Unlike GLM 5.2 (ships FP8/BF16, community quantizes down), K2.7 Code's benchmark numbers and your self-hosted deployment are running the *same* precision — arguably a plus for benchmark-to-reality fidelity, though Moonshot's own card doesn't explicitly confirm the published scores were run at this quantization level, so even this is not fully nailed down.

---

## 5. Pros / cons

**Pros:**
- Real cost advantage: $0.95/$4.00 per 1M vs Opus 4.8's $5/$25 — roughly 5–6x cheaper on paper, and developer reports (Reddit, aggregated by aitooldiscovery.com) cite 75–90% API spend reduction at production volume switching off Claude/GPT-tier models.
- Token efficiency is a real, independently-verifiable (do it yourself) property, not just a vendor slogan — and it compounds in long agentic loops where you pay per-step reasoning overhead repeatedly.
- Genuine vision/video multimodality that GLM 5.2 lacks entirely — useful for screenshot-driven frontend/UI debugging workflows.
- Long-horizon tool-use stamina (hundreds of sequential tool calls, Preserve Thinking across turns) is a real architectural differentiator, not just a benchmark number.
- Open weights (Modified MIT), self-hostable if you have ~640GB+ of GPU memory, with a low-friction migration path from K2.6 (same infra, same serving stack — vLLM/SGLang/KTransformers).
- Fireworks day-0 support plus a dedicated "Fast" serving tier in progress for latency-sensitive agent loops.

**Cons:**
- The vendor's own comparison table uses three different agent scaffolds (Kimi Code CLI vs Codex xhigh vs Claude Code xhigh) for what's presented as a single apples-to-apples ranking — a real methodological flaw, not just a nitpick.
- Two of the six headline benchmarks are unreproducible in-house Moonshot suites, and they carry the largest claimed gains.
- The one independently checkable public leaderboard for a claimed benchmark (MCP-Atlas) doesn't show the vendor's number at all.
- An independent AA Intelligence Index measurement shows K2.7 Code scoring *worse* than its own predecessor (42 vs 44) — directly contradicting the "substantial gains" narrative.
- No independent DeepSWE, SWE-bench Verified, SWE-bench Pro, LiveCodeBench, or Terminal-Bench numbers exist for K2.7 Code at all, months after other 2026-era releases (GLM 5.2 the same week) shipped with exactly these public numbers.
- Mandatory thinking mode with hard-pinned sampling params removes the option of cheap, low-latency calls for simple tasks — a real operational cost, not a style choice.
- Consistently and repeatedly reported over-verbosity/over-engineering across independent user reports — adds real code-review burden.
- Independent KernelBench-Hard testing shows an actual capability regression (MoE kernel score 0.222→0.157) alongside more "honest" but still-broken code.
- Self-hosting requires ~640GB+ VRAM (native INT4) — not remotely a laptop or single-GPU-workstation model despite "open weight" framing; most users end up on the hosted API anyway, which trains on your data by default unless you negotiate enterprise terms.
- Hosted API is a Singapore-registered entity under a Beijing-headquartered parent with an Entity List flag noted by at least one independent teardown — a real (if often overstated) data-governance consideration for regulated/sensitive codebases.

---

## 6. When to use / when not — for pi subagent routing

Context: pi's default coding agent is **GLM 5.2** — open-weight, cheap, strong coding (independently-verified SWE-Bench Pro leader among open models), text-only, 1M native context.

**Kimi K2.7 Code's genuine niche:** agentic coding tasks that (a) need image/screenshot input (UI bugs, mockup-to-code, visual diffing) — GLM 5.2 cannot do this at all — or (b) are extremely long tool-call loops where K2.7 Code's lower per-step reasoning-token cost and demonstrated multi-hundred-tool-call stamina compound into meaningful savings, *and* where you've validated on your own workload that the output quality is acceptable. It is a reasonable second-opinion / cheap-parallel-worker model for high-volume, lower-stakes coding tasks where 5x cost savings over closed frontier models matters more than being state-of-the-art.

**It should never be used for:**
- Anything requiring a quick, cheap, low-reasoning-overhead call — the model cannot disable thinking or vary sampling params, so every invocation pays full reasoning-token cost. If the task is "format this JSON" or "yes/no answer," this is the wrong model.
- High-stakes reasoning where a wrong output is expensive (architecture reviews, security audits) — no independent evidence exists that K2.7 Code's reasoning capability actually improved over K2.6, and one independent measurement (AA Intelligence Index) says it's worse.
- Tasks over ~180–200K tokens of working context — independent reports note recall degradation approaching the 262K ceiling, and GLM 5.2's native 1M context has real headroom here that K2.7 Code doesn't.
- Anything where you're trusting the vendor's benchmark claims as a reason to switch — there is no independent SWE-bench/DeepSWE/Terminal-Bench number for K2.7 Code to validate against; you're flying blind on quality relative to GLM 5.2 or closed frontier models until you run your own eval.
- Code review / correctness-critical output without a human or second-model check — the KernelBench finding (2/6 authored kernels still buggy) and the DeepSWE proxy (K2.6 at 24%, tied with GPT-5.4-mini) both suggest real reliability gaps under adversarial/discriminating tests, even as it looks strong on vendor suites.

**Vs. GLM 5.2 specifically — does Kimi ever win?** Only on two axes: **vision/multimodality** (categorical — GLM 5.2 is text-only, full stop) and **token efficiency / cost-per-step in very long tool-call loops** (real but modest — Composio tool-use showed GLM 5.2 slightly *ahead* at 0.800 vs 0.775, and a blind build comparison had GLM's plan quality ahead 9.0 vs 8.1). On every other axis found in independent testing — SWE-Bench Pro standing, context window (1M vs 262K), benchmark transparency, a blind head-to-head build/plan test, and even the one clean neutral intelligence index available — **GLM 5.2 either ties or wins.** The honest routing rule: default to GLM 5.2 for coding; escalate to Kimi K2.7 Code specifically when the task involves an image/screenshot the model needs to reason about, or when you've already benchmarked your own workload and found K2.7 Code cheaper without a quality hit. Don't route to it on the strength of Moonshot's launch numbers alone.

---

## Sources

- https://www.kimi.com/resources/kimi-k2-7-code
- https://huggingface.co/moonshotai/Kimi-K2.7-Code
- https://fireworks.ai/blog/kimi-k2p7-code
- https://devops.com/moonshot-ais-kimi-k2-7-code-targets-token-efficiency-in-agentic-coding/
- https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-kimi-k2-7-code-in-microsoft-foundry/4532286
- https://venturebeat.com/technology/kimi-k2-7-code-cuts-thinking-tokens-30-practitioners-say-benchmarks-dont-check-out
- https://open-techstack.com/blog/kimi-k2-7-code-open-weights-agentic-coding/
- https://open-techstack.com/blog/glm-5-2-vs-kimi-k2-7-code-comparison/
- https://vff.ai/article/2026/06/13/kimi-k2-7-code-cuts-thinking-tokens-30-but-practitioners-say-the-benchmarks-don
- https://pureailabs.com/ai-coder/kimi-code-review/
- https://www.vm0.ai/en/models/kimi-k2-7-code
- https://awesomeagents.ai/models/kimi-k2-7-code/
- https://agentguides.dev/reviews/kimi-k2-7-code-review/
- https://felloai.com/kimi-k2-7-code/
- https://aitoolsreview.co.uk/insights/kimi-k2-7-code
- https://artificialanalysis.ai/models/comparisons/kimi-k2-7-code-vs-kimi-k2-6
- https://opper.ai/moonshot/kimi-k2-7-code
- https://labs.scale.com/leaderboard/mcp_atlas
- https://rankedagi.com/models/kimi-k2-6
- https://huggingface.co/moonshotai/Kimi-K2.6/raw/main/README.md
- https://composio.dev/content/glm-vs-kimi
- https://blog.kilo.ai/p/glm-52-vs-kimi-k27-code-which-model
- https://regolo.ai/glm-5-2-vs-kimi-k2-7-code-the-definitive-guide-for-coding/
- https://future-stack-reviews.com/glm-5-2-kimi-k2-7-code-open-weights/
- https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart
- https://platform.kimi.ai/docs/pricing/chat-k27-code
- https://benchlm.ai/models/kimi-k2-7-code
- https://lushbinary.com/blog/kimi-k2-7-code-developer-guide-benchmarks-api-hermes-agent/
- https://wisgate.ai/blogs/what-is-kimi-k2-7-code
