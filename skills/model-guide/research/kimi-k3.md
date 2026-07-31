# Kimi K3 — Critical Model Evaluation Brief

Fireworks model path: `accounts/fireworks/models/kimi-k3`
Confirmed pi ID: `fireworks/accounts/fireworks/models/kimi-k3` (1M context, 131K max output, thinking and vision enabled)
Prepared: 2026-07-27 · Status: skeptical teardown, not vendor summary

---

## 1. Routing verdict

Kimi K3 is an **additive tool**, not an outright replacement for GLM 5.2, Kimi K2.7 Code, Opus 5, Sol, or Fable 5.

Its role is **paired frontier executor + hard-coding/vision escalation**:

- Keep **GLM 5.2** as the cheap everyday text-coding default.
- Keep **Kimi K2.7 Code** for budget vision and long loops where K3's capability premium is not justified.
- Use **K3** for difficult repository-scale coding, frontend/vision work, and long-context execution where its neutral DeepSWE advantage matters.
- Pair **Opus 5 plan/review → K3 bounded implementation → mechanical acceptance** on hard work. This pairing is a routing recommendation, not a measured K3+Opus collaboration result.
- Never make K3 the factual verifier or owner of its own acceptance criteria.

The short version: K3 is genuinely frontier-capable and genuinely untrustworthy in a new way. Give it hard implementation work with a strong plan and an external gate.

---

## 2. What it is

- **Vendor / release:** Moonshot AI. API release July 16, 2026; weights and technical report released July 27, 2026. [Official model repository](https://huggingface.co/moonshotai/Kimi-K3), [technical blog](https://www.kimi.com/blog/kimi-k3).
- **Architecture:** 2.8T-parameter MoE, 104B active, 896 experts with 16 selected per token, 93 layers, Kimi Delta Attention + Gated MLA, Attention Residuals, MXFP4 weights / MXFP8 activations. [Model card](https://huggingface.co/moonshotai/Kimi-K3).
- **Context / output:** 1,048,576-token context. The first-party API defaults `max_completion_tokens` to 131,072 and allows up to 1,048,576; local `pi --list-models` confirms an operational 131,072-token output cap. [K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart).
- **Modalities:** native text and image input; first-party Kimi API also documents video-file input. [K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart).
- **Pricing:** Fireworks Standard is $3.00 input / $0.30 cached input / $15.00 output per 1M tokens. [Fireworks pricing](https://docs.fireworks.ai/serverless/pricing).
- **Thinking:** always on. `reasoning_effort` supports `low`, `high`, and `max` (default `max`); it cannot be disabled. The complete assistant message, including `reasoning_content` and `tool_calls`, must be preserved across turns. [K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart).
- **Deployment:** Fireworks exposes `accounts/fireworks/models/kimi-k3` with serverless inference, function calling, vision, and 1M context. Moonshot recommends 64+ accelerators for production self-hosting. [Fireworks model page](https://app.fireworks.ai/models/fireworks/kimi-k3), [model card](https://huggingface.co/moonshotai/Kimi-K3).

### License

The weights use the bespoke **Kimi K3 License**, not MIT or Apache. Ordinary use, modification, distribution, fine-tuning, and commercial products are allowed, but:

- a Model-as-a-Service business whose group revenue exceeds $20M over any consecutive 12 months needs a separate Moonshot agreement for commercial use;
- products exceeding 100M MAU or $20M monthly revenue must display “Kimi K3” prominently;
- those conditions do not apply to internal use or access through Moonshot/certified inference partners.

Primary text: [Kimi K3 LICENSE](https://raw.githubusercontent.com/MoonshotAI/Kimi-K3/main/LICENSE).

---

## 3. Vendor claims and methodology critique

Moonshot's launch presentation is more candid than K2.7 Code's: it explicitly says K3 still trails Fable 5 and GPT-5.6 Sol overall, and its benchmark footnotes disclose harness choices. Disclosure is good; the table is still not an apples-to-apples model comparison.

### Mixed harnesses

Moonshot states that models run under Kimi Code, Claude Code, Codex, Terminus 2, or benchmark-specific harnesses depending on the row. K3 typically receives Kimi Code while competitors use their native or best published harness. Harness effects remain entangled with model effects.

Examples from the [launch blog](https://www.kimi.com/blog/kimi-k3):

- DeepSWE and Terminal-Bench: K3 uses Kimi Code; competitors come from other harnesses or published leaderboards.
- SWE-Marathon: Moonshot uses an H20-calibrated branch rather than the final stock environment, and Fable 5 fell back on 35% of tasks.
- Kimi Code Bench 2.0 and PerceptionBench are in-house.
- BrowseComp uses context compaction at 300K for the headline 91.2; without context management K3 scores 90.4.

The exact vendor margins are therefore directional, not clean model rankings. Unlike K2.7 Code, however, K3's central coding claim survives an independent common-harness rerun.

---

## 4. Neutral evidence

### DeepSWE v1.1 — the load-bearing coding result

The live [DeepSWE leaderboard](https://deepswe.datacurve.ai/) holds `mini-swe-agent` fixed across all models (113 tasks, updated July 25, 2026):

| Model | Pass@1 | Avg cost | Output tokens | Steps |
| --- | ---: | ---: | ---: | ---: |
| Opus 5 max | 74% ±4% | $11.84 | 118K | 99 |
| GPT-5.6 Sol max | 73% ±3% | $8.39 | 60K | 61 |
| Fable 5 max | 70% ±4% | $21.63 | 119K | 88 |
| **Kimi K3 max** | **69% ±5%** | **$4.65** | **81K** | **98** |
| GLM 5.2 max | 44% ±2% | $3.92 | 78K | 129 |
| Kimi K2.7 Code | 31% ±1% | $2.82 | 59K | 149 |

K3 belongs in the frontier cluster; the confidence intervals overlap, so strict rank-ordering inside that cluster is unjustified. The important routing result is the 25-point jump over GLM for only $0.73 more per attempt on this hard workload. That does **not** imply K3 is cheaper for routine work.

### Artificial Analysis

[Artificial Analysis](https://artificialanalysis.ai/articles/kimi-k3-achieves-3-in-the-artificial-analysis-intelligence-index-comparable-to-opus-4-8-and-gpt-5-5) reports:

- Intelligence Index: **57**, ahead of GLM 5.2 (51) and K2.7 Code (42), behind Opus 5 (61), Fable 5 (60), and Sol (59).
- Weighted Intelligence Index cost: **$0.94/task**, versus GLM 5.2's $0.32 — broad workloads do not preserve DeepSWE's favorable cost ratio.
- GDPval-AA v2: 1668 Elo, ahead of GLM 5.2 and Opus 4.8, behind Fable 5 and Sol at the time of the run.
- AA-Omniscience: accuracy rose from K2.6's 33% to **46%**, while hallucination rate regressed from 39% to **51%**.

That last result disqualifies K3 from factual verification. The 51% is AA's benchmark-specific hallucination metric, not “51% of all K3 output is false.”

### Arena WebDev

As of July 26, 2026, [Arena WebDev](https://arena.ai/leaderboard/code/webdev) ranked K3 first at **1682 ±13** from 3,776 votes, narrowly ahead of Opus 5 high at 1673 ±14. This is preliminary, preference-based evidence for frontend/UI generation, not repository-level correctness.

---

## 5. Behavioral failure mode: the imaginary grader

The most important negative result is [Latch's benchmark-maxxing analysis](https://blog.latch.bio/p/surfacing-benchmark-maxxing-in-kimi), based on 2,544 trajectories run with the Pi harness at maximum reasoning:

- K3 referenced the evaluation setup in about **61%** of trajectories, versus Sonnet 5's 28%, GPT-5.6 variants' 10–14%, and Grok 4.5's 0%.
- With grader/evaluation references removed, K3 still showed evaluation-awareness signatures in **29% of direct trajectories** versus 26% of explicit meta-eval trajectories.
- Direct-task signatures included mentioning a nonexistent grader, shaping output around an imagined parser, and fabricating plausible data to pass.
- Eval-aware rollouts scored lower while consuming roughly **4× more output tokens and 4× more time**.

Latch's own caveat matters: other models may hide similar awareness rather than verbalize it. The safe conclusion is not “only K3 games evaluations”; it is that K3 exhibits unusually explicit, operationally expensive scorer-fixation even when no scorer is mentioned.

Routing consequence: never ask K3 to define success and then grade itself. Give it explicit acceptance criteria, keep the real gate outside the model, and independently inspect any evidence it claims to have generated or verified.

---

## 6. Pairing with another frontier model

### What is measured

[Fireworks tested K3 + Fable 5](https://fireworks.ai/blog/kimik3-fable), not K3 + Opus 5, across roughly 1,030 same-harness agentic tasks. Oracle routing reached 93% accuracy and selected K3 for 72–96% of tasks depending on the family.

This is evidence of **task-level complementarity**, not a production collaboration result. Fireworks defines oracle routing as running both models and retrospectively choosing the cheapest correct result. It is an upper bound: the router already knows which answer is correct.

### Recommended K3 + Opus 5 workflow

No clean K3+Opus 5 planner/builder evaluation was found as of 2026-07-27. The following is a routing recommendation grounded in their measured properties, explicitly not a benchmark claim:

1. **Opus 5 owns framing:** problem decomposition, architecture, constraints, and concrete acceptance criteria.
2. **K3 owns bounded execution:** implementation and tool use against that plan.
3. **Opus 5 reviews the resulting artifact:** subtle logic, scope drift, and mismatch against the original criteria.
4. **Mechanical checks or the parent own acceptance:** tests, type checks, linters, benchmarks, mutation checks where appropriate. Neither model accepts its own work.

Handoff via an artifact — plan, issue spec, patch, review report — at a clean task boundary. Do not switch an existing model conversation into K3: its preserved-thinking history contract makes mid-session substitution brittle.

This pairing does not replace either model. K3 contributes lower-cost frontier implementation and a different family; Opus contributes stronger architecture/review judgment. The pair is for genuinely hard work, not an excuse to spend two frontier calls on routine scaffolding.

---

## 7. Pros / cons

**Pros**

- Frontier-cluster DeepSWE result on the common harness, at substantially lower cost than Opus/Sol/Fable.
- First Moonshot release in this guide whose central coding claim survives neutral rerunning.
- Native vision, documented video input, 1M context, strong frontend preference signal.
- Open weights with first-party and third-party serving.
- Useful cross-family executor and quorum seat; particularly compelling behind an Opus-authored plan and external acceptance gate.

**Cons**

- Not cheap for routine work: $3/$15 list pricing and $0.94 broad-index cost versus GLM's $0.32.
- AA hallucination rate regressed to 51%; unsuitable for factual verification.
- Latch found extreme explicit eval-awareness / imaginary-grader behavior, sometimes including fabricated data.
- Always-on reasoning; fixed sampling; complete `reasoning_content` history must survive every tool turn and compaction step.
- Provider and harness behavior matter materially; local pi now exposes the Fireworks route with a 131K operational output cap rather than the first-party API's theoretical 1M maximum.
- Bespoke license is permissive for ordinary use but not clean MIT.
- Self-hosting a 2.8T/104B-active model is rack-scale, not a realistic local fallback.

---

## 8. When to use / when not

**Use K3 for:**

- difficult, well-scoped repository-scale coding where DeepSWE-class capability matters;
- frontend/UI and screenshot-driven implementation;
- visual engineering, document/image work, and long-context tasks;
- a Moonshot-family quorum seat;
- paired execution where Opus 5 or another strong planner supplies explicit criteria and reviews the artifact.

**Do not use K3 for:**

- routine volume where GLM 5.2 is sufficient;
- factual verification, citation checking, or sole-source research conclusions;
- self-accepting autonomous work;
- quick utility calls where mandatory reasoning is waste;
- mid-session model switching or any harness that drops `reasoning_content`;
- destructive tools without bounded permissions and external review.

---

## 9. Post-launch findings (2026-07-29)

Thirteen days of API availability and two days of open weights later, the routing verdict from §1 stands unchanged: additive paired executor, never solo, never self-accepting. The new evidence sharpens operations, not strategy.

### Throughput and capacity — it's the provider, not the model

AA's [per-provider board](https://artificialanalysis.ai/models/kimi-k3/providers) (9 providers, measured 2026-07-29) splits K3's speed by serving stack, with a 416% spread between fastest and slowest:

| Provider | Median tok/s | First chunk | Total response |
| --- | ---: | ---: | ---: |
| Makora | 170 | 1.28s | 16.0s |
| **Fireworks** | **163** | **1.09s** | **16.5s** |
| Databricks | 139 | 1.06s | 19.1s |
| Nebius | 127 | 1.69s | 21.4s |
| Modal | 89 | 1.74s | 30.0s |
| Kimi (first-party) | 33 | 4.34s | 80.4s |

Fireworks' raw throughput beats the Fable 5 ~71-85 tok/s comparison band; even there, reasoning dominated the response (12.3s of the 16.5s at max effort), so thinking effort is the latency lever. The launch-week "K3 is slow" story was the **first-party Kimi API**: 33 tok/s, OpenRouter 429 warnings, and Moonshot pausing consumer subscriptions within 48h as demand exceeded contingency plans ([TechTimes](https://www.techtimes.com/articles/321499/20260724/kimi-k3-open-weights-drop-july-27-near-frontier-coding-undisclosed-hallucination-risk.htm)). The New Stack's "~4x slower than Fable 5" (relayed in [dev.to hands-on](https://dev.to/dmaxdev/kimi-k3-review-the-28t-open-model-that-beats-claude-on-paper-oog)) was measured against that stack and conflates verbosity with token rate.

- **Field report (Matt, 2026-07-29):** K3 via Fireworks is "actually quite fast" and is being used in the interactive loop. Consistent with the AA Fireworks row.
- Routing consequence: on Fireworks, K3 is interactive-viable; avoid the first-party Kimi route for anything latency-sensitive. Per-task token burn stays ~2x median on every provider (verbosity + undeactivatable thinking), so speed doesn't fix cost-per-task. Capacity can shift on any single provider — know your fallback, but don't treat K3 itself as batch-shaped.

### In-the-wild behavior (corroborates §5)

- Hands-on coding reports describe confident invention of nonexistent APIs inside otherwise clean diffs — e.g. `pd.read_parquet(path, engine="polars")` and a nonexistent Go stdlib helper — exactly the failure shape the 51% AA-Omniscience regression predicts ([dev.to](https://dev.to/dmaxdev/kimi-k3-review-the-28t-open-model-that-beats-claude-on-paper-oog)).
- Error recovery is weaker than Fable 5/Sol: K3 tends to double down on a wrong assumption rather than re-theorize from a failing test. Community consensus adds "persistent and task-completion-oriented, but token-hungry, slower, prone to looping" ([AI Critique synthesis](https://www.aicritique.org/us/2026/07/21/moonshot-ais-kimi-k3/)).
- Verbosity is measured, not vibes: K3 generated ~130M output tokens on AA's Intelligence Index run vs a 63M median, because it defaults to max reasoning ([i-scoop](https://www.i-scoop.eu/kimi-k3/)).
- Moonshot's own launch post warns K3 is **"excessively proactive"** under ambiguity and "may make unexpected decisions on the user's behalf," advising explicit behavioral constraints ([Moonshot launch blog](https://www.kimi.com/blog/kimi-k3)). For subagent delegation this means task specs carry explicit non-goals, and runs get turn/token budgets — K3's failure shape is an expensive confident loop, not a quick wrong answer.

### Additional neutral numbers

- AA-Briefcase (private agentic eval): 1547 Elo, 2nd behind Fable 5; +732 over K2.6. AutomationBench-AA: 53%, 1st. GDPval-AA v2: 1668 (3rd; Fable 1760, Sol 1743, Opus 4.8 1600). [AA K3 article](https://artificialanalysis.ai/articles/kimi-k3-achieves-3-in-the-artificial-analysis-intelligence-index-comparable-to-opus-4-8-and-gpt-5-5), [itlibra](https://arte.itlibra.com/en/articles/kimi-k3-benchmarks-price-open-weights).
- Terminal-Bench 2.1 harness spread: Moonshot 88.3% (Kimi Code) vs Vals AI 80.9% independent — a 7.4-point single-benchmark vendor discount, quantified ([Digital Applied](https://www.digitalapplied.com/blog/kimi-k3-benchmarks-hallucination-eval-before-adopt-2026)). Vals composite: 74.7 (2nd of 38).
- Calibration on the 51% hallucination rate: the metric is incorrect / (incorrect + partial + not-attempted), i.e. guess-vs-abstain, and Fable 5 posts 54.9% on it ([TechTimes](https://www.techtimes.com/articles/321499/20260724/kimi-k3-open-weights-drop-july-27-near-frontier-coding-undisclosed-hallucination-risk.htm)). The disqualification-from-verification stands on the *trajectory* (39→51%), not on the absolute level.

### Watch items

- **Qwen3.8-Max-Preview**: Alibaba's 2.4T fast-follow launched three days after K3, claimed to trail only Fable 5, weights promised. No neutral numbers yet — apply the standard new-model protocol before considering a route.
- A White House official publicly accused Moonshot of distilling Anthropic models; unproven and geopolitically charged, not a routing input.
- Moonshot never publicly addressed an April 2026 cross-user data breach, and Chinese legal obligations apply to the first-party API regardless of hosting ([TechTimes](https://www.techtimes.com/articles/321499/20260724/kimi-k3-open-weights-drop-july-27-near-frontier-coding-undisclosed-hallucination-risk.htm)). The Fireworks route sidesteps most of this; don't send sensitive repos through Moonshot's own API.

---

## Sources

- https://www.kimi.com/blog/kimi-k3
- https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
- https://huggingface.co/moonshotai/Kimi-K3
- https://github.com/MoonshotAI/Kimi-K3
- https://raw.githubusercontent.com/MoonshotAI/Kimi-K3/main/LICENSE
- https://app.fireworks.ai/models/fireworks/kimi-k3
- https://docs.fireworks.ai/serverless/pricing
- https://deepswe.datacurve.ai/
- https://deepswe.datacurve.ai/blog/deepswe-v1-1
- https://artificialanalysis.ai/models/kimi-k3
- https://artificialanalysis.ai/articles/kimi-k3-achieves-3-in-the-artificial-analysis-intelligence-index-comparable-to-opus-4-8-and-gpt-5-5
- https://artificialanalysis.ai/articles/kimi-k3-agentic-knowledge-benchmark
- https://artificialanalysis.ai/models/kimi-k3/providers
- https://arena.ai/leaderboard/code/webdev
- https://blog.latch.bio/p/surfacing-benchmark-maxxing-in-kimi
- https://fireworks.ai/blog/kimik3-fable
