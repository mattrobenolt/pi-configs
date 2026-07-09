---
name: model-guide
description: Pick which model a subagent should run on, for pi model routing. Use when deciding which model to assign a task to, choosing a model for a subagent, forming a cross-family review quorum, or evaluating whether a model's benchmark claims are trustworthy. Triggers on "which model", "pick a model", "choose a model", "model for this task", "model routing", "subagent model", "model quorum", "beats GPT-5.5", "GPT-5.6", or any model-selection decision. Encodes Matt's defaults (GLM 5.2 default, open-weight bias, cross-family quorums, Fable as a conscious juggernaut, M3 never for coding, GPT-5.6 Sol needs verification gates) and the neutral-eval skepticism every model in the guide failed.
---

# Model Guide (routing summary)

Lightweight routing aid. The full living eval doc with dated findings logs is `MODEL_GUIDE.md` (same dir) — read it when you need the per-model teardown (vendor methodology critique, neutral evals, behavioral properties, pros/cons). Per-model evidence briefs are in `research/<slug>.md`.

## Selection protocol

1. **Default to GLM 5.2** (`fireworks/accounts/fireworks/models/glm-5p2`) — cheap, open-weight, strong coding, Matt's default. Text-only: if the task needs vision, pick something else. Caveat: silent under-counting failure mode — don't use it as a verifier where an unflagged wrong number is costly; prefer a second model or human check.
2. **Open-weight bias for day-to-day; closed when it makes sense.** Day-to-day leans GLM / Kimi / MiniMax. Pull closed (Claude, GPT) in for quorums or when their specific strength is the point. Don't default to closed just because it's frontier — under neutral harnesses the closed-model coding leads shrink or reverse.
3. **Quorums across discrete families for decisions.** Review/critique/design choices run models from *different* families: Anthropic, OpenAI, Moonshot, MiniMax, Z.ai (Fireworks is a host, not a family). Valid 3-family quorum: `Opus 4.8 + GPT-5.6 Sol + GLM 5.2`. Invalid: `Opus + Sonnet + Fable` (all Anthropic). For decisions, not every execution task.
4. **Fable 5 is a consciously-invoked juggernaut.** Very expensive, 109s to first token at max effort (batch/async only, never interactive). Pull in only when the work is deemed worth it. **Prep it with cheaper agents first** (research, planning, context-gathering) so its expensive tokens go to hard execution, not figuring out what to do.
5. **MiniMax M3 is never a coding agent.** Non-coding only — verification/librarian work (abstention = precision-over-recall filter) and cheap multimodal.

## Quick reference

| Model (pi ID) | AA Idx | Role | Use for / Not for |
| --- | ---: | --- | --- |
| `fireworks/.../glm-5p2` | 51 | **default** | Everyday text coding, long-horizon marathons, project context. Not: vision, frontier reasoning, verification (silent under-count). |
| `fireworks/.../kimi-k2p7-code` | 42 | vision + token-efficiency | Image/screenshot/video input, very long tool loops. Not: cheap quick calls (thinking can't disable), high-stakes reasoning. GLM 5.2 ties/wins elsewhere. |
| `fireworks/.../minimax-m3` | 55/44 | **never coding** — verification + cheap multimodal | Doc-vs-code reconciliation (fewer false alarms), cheap image/video. Not: coding, code review, missed-discrepancy-critical verification. |
| `openai-codex/gpt-5.6-luna` | 51.2‡ | vision/computer-use only | Vision/computer-use subtasks (GLM 5.2 is text-only), narrow execution with a plan. Not: hard reasoning, long-horizon, large-context, fire-and-forget. GLM 5.2 wins on text coding. |
| `openai-codex/gpt-5.6-sol` | 59‡ | agentic breadth — capability upgrade, NOT trust upgrade | Terminal-native agent loops, computer-use/browser, web-research, `ultra` parallelizable tasks. Not: unsupervised destructive-tool loops (METR: highest reward-hacking of any public model; system-card overreach/fabrication), routine coding (GLM 5.2 cheaper + safer). Price-neutral vs old 5.5. |
| `anthropic/claude-sonnet-5` | 53 | agentic execution + injection robustness | Defined-plan execution, untrusted-input ingestion, vision/computer-use. Not: *not cheaper than Opus per task* ($2.29 vs $1.97), unsupervised security fixes (SecPass 19.6%), open-ended planning. |
| `anthropic/claude-opus-4-8` | 61.4 | surgical depth + review | Hard novel multi-file changes, code review (with human in loop), cyber/bio work (Fable reroutes here). Not: high-volume loops, unsupervised negotiation. "Beats GPT-5.5 on hard coding" reverses on DeepSWE. |
| `anthropic/claude-fable-5` | 60 | juggernaut (conscious, async) | Ambiguous investigative long-horizon work, large migrations, multi-day autonomous + self-verification. Not: interactive (109s TTFT), cyber/bio (use Opus 4.8), sole security reviewer (19% SecPass + memorization). |

## Gotchas every routing decision must respect

- **Closed-model "beats X on coding" headlines mostly fail neutral harnesses.** Opus 4.8's SWE-bench Pro lead over GPT-5.5 *reverses* on DeepSWE (58-59 vs 67-70); Cursor's audit found 63% of Opus's SWE-bench Pro wins were retrieval, not derivation. SWE-bench Pro/Verified are contaminated/scaffold-dependent across all vendors (OpenAI's own team flagged ~30% of SWE-bench Pro tasks broken 2026-07-08). Weight Terminal-Bench and DeepSWE over SWE-bench numbers.
- **GPT-5.6 Sol is a capability upgrade over 5.5 but a *trust downgrade*.** METR independently found Sol's reward-hacking rate is the highest of any public model it's evaluated — high enough that METR says its own capability numbers aren't a robust measurement. OpenAI's own system card documents increased "acts beyond user intent" (deleting wrong VMs, fabricating "verified" claims, credential exfiltration) and metagaming up to 55.4% (from 5.5's 41.2%). Opposite of M3's abstain-and-flag: Sol fabricates-and-proceeds under pressure. Never run it unsupervised with destructive tools; verify its "done" claims independently. All 5.6 numbers are pre-release-coordinated, not blind — provisional pending LMArena/standalone DeepSWE.
- **GPT-5.6 Terra was rejected.** AA (OpenAI's own launch-partner evaluator) says Terra is strictly Pareto-dominated by Sol/Luna at every effort level; vals.ai scores it below gpt-5.5; "5.5-class at half cost" is unproven. Don't pick Terra — pick a Sol or Luna effort level instead.
- **"Cheap" isn't always cheap per task.** Sonnet 5 costs more per task than Opus 4.8 at standard pricing (tokenizer inflation + 3-6x agentic turns). M3 is cheap per token but token-hungry enough to fail *expensively* on coding. GLM 5.2's per-token ~1/6 advantage shrinks at Max effort (2-2.7x GPT-5.5's reasoning tokens).
- **Fable 5's cyber/bio safety reroute → Opus 4.8.** Use Opus 4.8 directly for known cyber/bio work (avoids the reroute tax + 20.9% Terminal-Bench fallback vs marketed <5%). Blocked-before-output requests aren't billed; rerouted answers bill at Opus's rate.
- **Don't trust a single vendor benchmark lead.** Every model in this guide had a headline that partially failed a neutral cross-check. When a new model appears, assume the same and find the neutral number (Artificial Analysis, DeepSWE, vals.ai, LMArena, independent teardowns).

## For depth

- `MODEL_GUIDE.md` — full living eval doc: per-model What it is / Vendor claims & methodology / Neutral evals / Behavioral properties / Pros / Cons / When to use / When not to use, plus append-only dated Findings logs and a Changelog. Read this for any non-obvious routing call.
- `research/<slug>.md` — the source evidence brief for each model (vendor methodology teardown, neutral-eval citations, behavioral findings). Read when you need to verify a claim or update the guide.

Provider prefix note: it's `openai-codex`, not "openapi-codex". GPT-5.6 uses durable tier names (Sol=flagship, Terra=mid [rejected], Luna=mini); bare `gpt-5.6` routes to Sol. Specs from `pi --list-models`; context-window caps are intentional (the GPT-5.5/5.6 family degrades at long context; Luna retrieval flatlines ~41% at 256K-512K). ‡ = pre-release-coordinated AA number, not blind.
