# Ember-1 — Critical Model Evaluation Brief

Fireworks model path: `accounts/fireworks/models/ember-1`
Confirmed pi ID: `fireworks/accounts/fireworks/models/ember-1` (1M context, 131.1K max output, thinking and vision enabled — same serving envelope as kimi-k3)
Prepared: 2026-09-24 · Status: launch teardown + live route probe; zero neutral reproduction exists

---

## 1. Routing verdict

Ember-1 is a **K3-seat challenger on a research-preview clock — not seated**.

- It is Fireworks Research's post-train of Kimi K3, trained to reason more concisely: claimed K3-max quality at 35-50% fewer tokens, at the **identical $3.00/$0.30/$15.00 sticker**. None of the savings is per-token price; all of it is tokens per task.
- **Every quality number is Fireworks-run.** No third party has published a run ([Orcarouter, 2026-09-23](https://www.orcarouter.ai/blog/ember-1-release): "no third party has published a run of Ember-1 as of writing"); Artificial Analysis has not indexed it; the DeepSWE leaderboard has no ember-1 entry. The 75.2% DeepSWE figure is a single vendor run at n=113.
- **The two-week research-preview window (released 2026-09-22 → ~2026-10-07, permanence "based on community demand") bars durable routing.** On-demand deployment (dedicated GPUs, no rate limits) exists as the only durability path.
- Every K3-family behavioral ban carries until probed: never verifier, never self-acceptance, explicit non-goals, external acceptance, bounded runs. The fine-tune targets token count, not the imaginary-grader behavior or the hallucination trajectory.
- Not a quorum family — a K3 derivative (Moonshot lineage); "Fireworks is a host, not a family" still holds. An ember-1 vote is not independent of K3.
- Right use inside the window: A/B against K3 on real traffic (the duel harness at `evals/model-duel/` is the natural instrument), plus K3-shaped work where a failed attempt is cheap to retry. **Promotion requires permanence + local parity — not vendor tables.**

---

## 2. What it is

- **Vendor / release:** Fireworks Research, model created 2026-09-22, [launch blog](https://fireworks.ai/blog/ember-1) 2026-09-23. First of an announced series of Fireworks specialized models, trained on Fireworks Serverless Training (vendor: >50 training experiments, >200 evaluations).
- **Base:** Kimi K3 (2.8T MoE). Post-train, not a new architecture — the [model page](https://fireworks.ai/models/fireworks/ember-1) lists 2.78T params, MoE, provider Fireworks. Training collection spans mathematics, coding, instruction following, conversation, search, tool use, and software engineering — standalone problems plus extended interactions, with task/environment feedback to preserve self-reflection while cutting excess reasoning.
- **Route envelope:** identical to K3 on our host — 1M context, 131.1K max output, thinking + vision. Vision verified live 2026-09-24 (64×64 red PNG → "Solid bright red").
- **Pricing:** $3.00 input / $0.30 cached / $15.00 output per 1M — identical to K3's sticker on the same route. ([Model page](https://fireworks.ai/models/fireworks/ember-1); OpenRouter lists the same rates.)
- **Release status:** Research Preview on serverless; **two-week access window, permanent "based on community demand"**; on-demand deployment available. No published weights — a Fireworks-proprietary checkpoint on an open base; not itself an open-weight model.

The mechanism claim is specific and worth taking seriously: K3 spends >90% of generated tokens on reasoning, and in multi-turn agent loops those traces are replayed and re-billed every turn (context grows ~quadratically with turns). Fireworks' experiments found 35-50% of K3's reasoning removable without accuracy loss; the fine-tune internalizes the cut (and claims restrained token use on unsuccessful attempts — cheaper failures, not fewer failures).

---

## 3. Vendor claims and methodology critique

### The comparison table (all Fireworks-run)

| Benchmark | N | K3 low | K3 high | K3 max | Ember-1 | Token Δ vs K3-max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Terminal-Bench 2.1 | 89 | 76.4% | 77.6% | 80.9% | **82.0%** | −51.9% |
| SWE-bench Verified | 500 | 80.4% | 86.0% | **93.2%** | 92.2% | −15.5% |
| SWE-Interact | 75 | 6.7% | 13.3% | **21.3%** | 20.0% | −32.5% |
| DeepSWE 1.1 | 113 | 55.8% | 62.8% | 66.4% | **75.2%** | −23.7% |
| τ-2 Bench Airline | 50 | 64% | 64% | 64% | **66%** | −5.9% |

Cost units decoded: the blog's dollar column is per benchmark run, not per task (DeepSWE −$126.9 over 113 tasks ≈ $1.12/task ≈ 23.7% of K3's neutral $4.65/task — the arithmetic coheres with the independent K3 baseline, which is a point in Fireworks' favor).

### What to discount

- **The DeepSWE +8.8 gain is the suspicious row.** A token-efficiency fine-tune *gaining* 8.8 points over its parent on DeepSWE while SWE-bench Verified *drops* 1.0 is not a uniform efficiency story. A plausible mechanism exists — leaner traces mean fewer steps, so more attempts fit the harness's fixed budget (K3 burns 98 steps/81K output tokens there) — but it is one vendor run at n=113 (±4-5 CI territory per this guide's DeepSWE convention), from the vendor selling the model, on a benchmark family ("software engineering," "extended interactions") the training collection explicitly targets. Treat 75.2 as unverified upside; the load-bearing claim is parity-at-fewer-tokens.
- **Savings are uneven: 5.9% (τ-2) to 51.9% (TB2.1).** The "roughly 40%" headline is an average across that spread. Low-deliberation, single-turn workloads should expect the τ-2 end ([Orcarouter](https://www.orcarouter.ai/blog/ember-1-release)).
- **The SII/Bedside Bench Pareto claim runs on Fireworks' own framework** — the Specialized Intelligence Index is Fireworks' product (introduced the same week), the runs are Fireworks-executed, and the cost axis is modeled on K3's public rate card, with the comparison set (Sol, Astra, Opus 5) chosen by Fireworks.
- **K3-low domination is the framing, and it's fair** — the table's real claim is "the most cost-optimized way to run K3 is no longer to turn its effort down, it's Ember-1." That claim survives even if every Ember-1 score regresses to K3-max parity.

### The strongest vendor evidence (still vendor)

Two live A/B tests on customer production coding traffic (~35% fewer tokens per task at comparable quality; one customer now in production replacing the base model) and an internal rollout Fireworks describes as "no news" — developers didn't notice the swap. One A/B table: score 0.751→0.753, steps 23.8→21.4, output tokens 49.3K→29.9K, reasoning tokens −71.3%, total tokens −39%. A/B task-completion data is harder to game than a leaderboard, but test sets, pass criteria, and sample sizes were all vendor-chosen.

### The named risk

Reasoning compression that removes waste is free; compression that removes a step the model needed is not — and in an agent it surfaces later as a wrong tool call, not a wrong sentence ([Orcarouter](https://www.orcarouter.ai/blog/ember-1-release)). Benchmark parity does not certify long-tail parity. The multi-turn A/B data is the only evidence that addresses this, and it is vendor-reported.

---

## 4. Neutral evidence

**None exists.** No AA index entry, no DeepSWE leaderboard entry, no vals.ai/LMArena/Latch/METR coverage. The only third-party numbers are operational, not capability: [OpenRouter](https://openrouter.ai/fireworks/ember-1) lists the Fireworks route at $3.00/$15.00/$0.30 with 0.65s latency, 49 tok/s, 100% uptime — the 49 tok/s reads as gateway-measured; our direct-route probe measured 76-87 tok/s (below).

This is the first model added to this guide with zero neutral coverage; the local route probe (§5) substitutes partially, per the guide's new-model protocol.

---

## 5. Local route probe (2026-09-24, direct Fireworks route)

All calls raw against `https://api.fireworks.ai/inference/v1/chat/completions`, plus pi one-shots (`pi -p`, ~2.5s wall on trivial prompts).

### Thinking ladder — full Fireworks enum, `none` really disables

`reasoning_effort` accepts `low` / `medium` / `high` / `xhigh` / `max` / `none` / `adaptive`; `minimal` is rejected (validation error lists the enum). **`none` verified to disable reasoning** — 0 reasoning tokens, content-only completion. K3 proper cannot disable thinking (`low`/`high`/`max` only); this is a real surface difference from the parent.

### Default effort is heavy — the K3 truncation trap reproduces on day one

Compositional probe (450-word TCP congestion-control explanation, `max_tokens: 4096`):

| Effort | Reasoning tok | Content tok | Finish | Wall | tok/s (content) |
| --- | ---: | ---: | --- | ---: | ---: |
| default (unpinned) | 4,014 | 82 | `length` (truncated) | 47.3s | 1.7 |
| `max` (pinned) | 4,096 | **0** | `length` (truncated) | 50.8s | 0 |
| `high` (pinned) | 19 | 644 | `stop` | 8.4s | 76.5 |
| `low` (pinned) | 15 | 729 | `stop` | 8.9s | 82.0 |

The unpinned default behaves like K3's default-max: on a real task it reasoning-hungers into the output cap (58 words of content from 4,096 tokens). Pinned `max` is the exact 2026-08-21 Drew-incident shape — all-reasoning, zero content, `finish_reason: length`, no error. **Reasoning shares the `max_tokens` budget on this route, same as K3.** Output-capped ember-1 calls must pin the effort and budget content separately; watch `completion_tokens_details.reasoning_tokens` (reported on this route).

On trivial prompts the default is light (39 reasoning tokens on 17×23 — vs pinned `max`'s 46, i.e. default tracks the max arm on both probes; whether it is max or an adaptive mode that goes heavy on compositional work, the rule is identical: pin it).

### The lean behavior is real — at explicit `low`/`high`

Same prompt that burned 4,014 reasoning tokens at default: **15-19 reasoning tokens at `low`/`high`, complete answers (536/468 words), 8-9s wall.** This is the launch claim verified in the only place it can be verified today — token behavior, not quality. The efficiency story lives at the explicit efforts; an unpinned call does not get it.

One anomaly in the good direction: under a tight cap (`max_tokens: 30`, default effort) the route went content-first with 0 reasoning tokens (`finish: length`, real content) — the serving layer appears to suppress thinking under tight budgets (n=1). K3 lacks this survival behavior; do not rely on it.

### Throughput and vision

76-87 tok/s blended and content at the lean gears — K3-class on our route (AA's current K3-on-Fireworks rows read 77-85 tok/s). Vision serves (red PNG, correct, 64 reasoning tokens). No long-run throughput or cache-hit measurement yet; reasoning-content preservation (`reasoning_content` resend contract) unverified — assume K3's carries until probed.

---

## 6. Behavioral carryover from K3 (until probed)

- **Imaginary grader / eval-maxxing.** Latch's finding (explicit eval-awareness in ~61% of 2,544 Pi trajectories; persisted on 29% of direct tasks; ~4x token/time tax) is a property of the base model's behavior. A token-efficiency post-train has no measured effect on it. "Restrained token use on unsuccessful attempts" cuts the *cost* of the confident loop, not its existence. Never let ember-1 define and accept its own success criteria.
- **Hallucination.** K3's AA-Omniscience trajectory (39→51%) is the family signal; ember-1 is unmeasured. Never a factual verifier.
- **Proactiveness under ambiguity.** Moonshot's own caveat carries — explicit non-goals in task specs, bounded runs.
- **Preserved thinking.** Assume K3's contract (complete assistant message incl. `reasoning_content` + `tool_calls` on every turn; no mid-session hot-swap) until probed.

---

## 7. Pros / cons

**Pros**

- Same sticker as K3 with a **measured** lean-reasoning behavior at `low`/`high` (4,014→15-19 reasoning tokens on the probe prompt) — if quality parity verifies, K3's seats at ~60% per-task cost, and multi-turn loops save more than the headline (reasoning re-bills every turn; the A/B showed total −39% with steps down 10%).
- Full thinking ladder including verified `none` — a gear K3 proper lacks; extraction/utility shapes become routable (quality at `none` unmeasured — probe before relying on it).
- K3-class throughput on our route (76-87 tok/s); vision serves; identical 1M/131K envelope; function calling.
- Best case is material: claimed DeepSWE 75.2 at −23.7% tokens ≈ $3.55/task → **$4.72/success — would lead the open-weight field per-success** (K3 $6.74, GLM 5.3 ~$5.78 by the same math, Qwen $6.54) with vision and 1M context. If it verifies.
- The A/B evidence (production traffic, task-completion metrics) is the strongest form vendor evidence takes.

**Cons**

- **Zero neutral coverage** — every number from the vendor that sells it; first guide model added in this state.
- **Research preview** — ~2026-10-07 serverless clock, permanence demand-gated, no weights, no SLA. Nothing durable can route to it.
- **Unpinned default is a trap** — heavy reasoning that truncates capped calls all-reasoning (reproduced day one); the inverse of Astra's default-low.
- Savings uneven (5.9-51.9%) — low-deliberation workloads won't feel the headline.
- DeepSWE +8.8 is one vendor run, n=113, on a benchmark family the training set targets.
- K3's trust profile carried wholesale: never verifier, never self-acceptance.

---

## 8. When to use / when not

**Use (inside the window):**

- A/B / shadow runs against K3 on real traffic — the deciding evidence for any seat change;
- K3-shaped repo-scale or vision work where a failed attempt is cheap to retry, at pinned `low`/`high`;
- probing the `none` gear for extraction/utility shapes (cheap probes first).

**Do not use for:**

- anything durable — production commitments, seat changes, configs that outlive ~2026-10-07;
- verifier, self-acceptance, or factual roles (K3 bans);
- unpinned effort on output-capped calls (probe result);
- routing on the vendor table, including the DeepSWE 75.2;
- quorum votes (not an independent family);
- low-deliberation volume where the savings evaporate (τ-2 end of the spread).

**Promotion criteria** (all three): permanence past the window (or an on-demand commitment); local parity vs K3 on the duel packs; and if it lands anywhere neutral (AA, DeepSWE leaderboard), the usual neutral-first read. Seat math if parity holds: K3's seats at ~60% cost — Matt's call, not a launch-day edit.

---

## 9. Watch items

- **Permanence decision ~2026-10-07** (community-demand-gated) — the gating fact for everything.
- AA / DeepSWE leaderboard indexing; any third-party run.
- Local duel vs K3 (routine + hard packs, `low`/`high` vs K3 `max`) — the real parity test.
- Quality at `none` (extraction viability) and at `low` on hard tasks (the blog's own K3-low table shows what low-effort did to the parent).
- Preserved-thinking contract; long-run throughput; cache-hit rate on the route.
- The Ember series itself — "first in a series"; if the pattern holds, each release gets this protocol.

---

## Sources

- https://fireworks.ai/blog/ember-1 (launch blog, 2026-09-23)
- https://fireworks.ai/models/fireworks/ember-1 (pricing, specs, release status)
- https://www.orcarouter.ai/blog/ember-1-release (independent launch read, 2026-09-23 — the only third-party analysis; no reproduction)
- https://openrouter.ai/fireworks/ember-1 (rates, throughput/uptime row)
- https://artificialanalysis.ai/models/kimi-k3/providers (K3-on-Fireworks throughput reference)
- Local probes 2026-09-24: `pi -p` one-shots + raw calls to `https://api.fireworks.ai/inference/v1/chat/completions` (effort enum, reasoning-token accounting, truncation, streaming throughput, vision)
