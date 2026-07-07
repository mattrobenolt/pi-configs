# WWMD Evolution Plan — corpus-sourced lens sharpening

*Drafted 2026-06-17. This is a proposal, not a settled spec. Decisions flagged ⚑ are Matt's calls.*

## What this is

WWMD is procedural memory: a hand-shaped judgment lens. Its own meta-loop is
**elicit → extract → encode** from Matt's corrections. Right now that loop runs at
single-session scale and depends on the agent remembering to fold a correction back in.

This plan scales the loop to the **entire pi session corpus**: mine every session for the
reward signal (corrections, verdicts, divergences), distill recurring patterns into candidate
lens refinements, prove each candidate improves the lens via **held-out replay**, and gate every
change through Matt. His accept/reject verdicts become the next round of labels.

**North star: the director sits in the USER role.** WWMD is a *constitution* — a written approximation
of Matt's judgment, transplanted into the director so it can sit where Matt sits: in the **user/driver**
seat, owning execution end-to-end and driving *workers*, not in the assistant seat waiting to be driven.
The input Matt gives in a session (direction, corrections, refusals, demands to verify) is exactly what
the director must learn to give its workers. The corpus of Matt's corrections is a record of *how Matt
drives*. Goal: remove Matt up a level — he drives/trusts the director; the director drives the workers;
routing to Matt shrinks to the irreducible (novel, irreversible, strategic-taste).

**Eval design (corrected 2026-06-17).** The independent variable is the **lens version**, NOT the model.
Hold the director at **dense, capable models** (2–3 for robustness — it's a judgment role; a small model
pattern-matches the checklist instead of exercising judgment, so don't eval there). Measure the
*absolute* catch-rate of the lensed director against Matt's held-out corrections (how close to Matt it
gets), and whether lens-v(N+1) beats lens-vN. Open-weight SOTA (DeepSeek/GLM/Kimi) are valid director
candidates alongside closed frontier — a selection question, not a tier question. Replay-against-
corrections is a *proxy* for the real target (the director running its drive/improve loop and not handing
Matt something he'd correct); higher-fidelity loop eval comes later.

## RLAIF-inspired, not RL

No gradients, no weight updates, no gym — the base model is frozen; we edit a *constitution* (the
skill), not weights. The precise lineage is **RLAIF / Constitutional AI** (Bai et al., 2022): bottle
the human's principles into a written artifact once, then a judge applies them to generate the
feedback signal at scale, removing the human from the loop. WWMD = the constitution; the director
applying it = the AI-feedback judge. The loop is RL-*shaped* at the system level (a policy acts, the
environment emits reward via Matt's corrections, behavior is optimized over iterations) without
being RL-*implemented*. The rigor lives in replay: corrections are labels, catch-rate is the reward.
Watch the inherited failure modes — reward-hacking (anchor on objective verifiers), reward-model
overfitting (≥2-project generalization bar), drift (recalibrate as taste evolves), Goodhart
(spot-check the judge, not just the work).

## Two tiers of source signal

**Tier A — pre-distilled memory files (cheap, immediate).** SELF.md (~612 lines), USER.md, daily
logs are an already-appended, #tag-annotated correction corpus Matt deliberately kept *for this
analysis*. The write side of memory works; this is its payoff. Diff these against the current lens
→ candidate changes in one pass. Already surfaced (2026-06-17): "find the fast feedback loop before
grinding a slow one", "watch for normalizing your own framing", "objective verification as the
ungameable signal / reference implementations".

**Tier B — raw session corpus (expensive, higher value).** The unique value of the JSONL corpus is
corrections that *never made it into SELF.md* — the ones the agent didn't recognize as lessons.
Those are, by definition, the lens's blind spots. This is the map-reduce pipeline below.

## What already exists (reuse, don't rebuild)

- `packages/memory/index.ts` → `extractSessionMarkdown` turns each session JSONL into clean
  chat-only markdown (tool/thinking noise stripped). Runs on `session_shutdown`.
- `sessions-index/YYYY-MM/*.md` → ~432 indexed sessions, ~16.8MB / ~4M tokens. Source corpus.
- qmd `pi-sessions` collection → keyword / semantic / hybrid search over the above.
- `curate-memory` skill → already does crude session gap-fill via qmd queries. Closest prior art.
- `memory/operating/{feedback,decisions,recentThreads}.md` → short, deterministically injected
  operating memory. A natural home for some distilled output.
- `scripts/local-llm-eval.mjs` → existing local-model eval harness pattern to copy for replay.

Known gaps: ~70 sessions unindexed (empty-text or `getSessionFile undefined` bug); backfill is
cheap and reuses `extractSessionMarkdown`.

## The reward-signal taxonomy

Every mined episode is classified into one of:

- **correction** — Matt redirects mid-flight ("no, wrong path", "stop, slow down").
- **verdict** — Matt judges what shipped ("this is good", "too much", would-wince).
- **divergence** — agent's stated read vs Matt's actual call. *Highest value* — the skill says so.
- **friction** — what slowed the work; repeated mistakes across sessions.
- **praise** — positive signal; what to keep doing (don't only learn from failure).

## Pipeline (map-reduce, because 4M tokens > context)

**Phase 0 — Extract the episode corpus**
1. Backfill the ~70 unindexed sessions through `extractSessionMarkdown`.
2. *Deterministic prefilter* (cheap, scriptable — do NOT point an LLM at "find lines starting with
   No"): regex + qmd to find candidate correction/verdict turns, emit each with a context window
   (the agent turns before + Matt's turn + the recovery after).
3. *Per-session LLM pass* (cheap local model / haiku, one session at a time) → structured episode
   records:
   ```
   {session, project, situation, agent_move, matt_response, signal_type,
    lesson, lens_mapping: <which prescribed question caught it | "UNCOVERED">}
   ```
   Output: an append-only `episodes.jsonl`. This is the durable artifact; everything downstream
   reads it, not the raw corpus.

**Phase 1 — Distill candidates**
4. Cluster episodes by lesson/theme (qmd embeddings or LLM grouping).
5. Strong model synthesizes each cluster → a candidate lens change: sharpen an existing prescribed
   question, add a wildcard pattern, or name a recurring blind spot (an UNCOVERED cluster).
   **Verify-gate:** every candidate cites ≥k supporting episodes across ≥2 distinct
   projects/sessions. A rule backed by one incident is an anecdote, not a lens change — this is the
   guard against Reflexion-style entrenchment.

**Phase 2 — Held-out replay (the honest reward)**
6. Hold out a labeled set of correction/divergence episodes. Metric = **catch-rate**: apply the
   lens (current vs candidate) to the pre-correction context and check whether it flags the issue
   Matt corrected. Compare lens-vN vs lens-vN+1. Reuses the `local-llm-eval.mjs` harness shape.
7. A candidate ships only if it raises catch-rate on held-out episodes without regressing others.

**Phase 3 — Human gate + encode**
8. Present proposed SKILL.md diffs with evidence (supporting episodes + catch-rate delta).
9. Matt accepts / rejects / edits. Verdicts logged as new labels → feeds the next iteration.
   This is the literal elicit → extract → encode meta-loop, now at corpus scale.

## Alignment with recorded decisions

- JSONL stays the source of truth. ✓ (episodes derive from it)
- Archive vs operating memory stay separate. ✓ (episodes.jsonl is archive; only distilled lens
  rules touch the skill / operating memory)
- Search is archival, not hot-path. ✓ (this whole pipeline is offline/batch)
- No auto-search re-enable. ✓ (unaffected)

## Resolved decisions (2026-06-17)

1. **Output = skill.** WWMD is the distillation target. No routing back into the memory system.
   Episodes archive stays separate; lens-level cross-project patterns → SKILL.md via gated diffs;
   project/ops-specific one-offs stay in SELF.md, not the lens.
2. **Corpus scope.** Mine whole corpus into the episode store; promote a pattern to the lens only
   if it generalizes across ≥2 projects. (Single-project corrections are project memory.)
3. **Autonomy.** Propose-and-gate. Matt approves every lens change. Taste is the reward function;
   unvalidated self-reflection entrenches wrong beliefs.
4. **Reframe.** Not literal RL — offline distillation + held-out replay + human-in-the-loop
   preference. Confirmed directionally what Matt meant.

## Sequencing

Tier A first — it's a few hours, needs no new infra, and produces gated candidates immediately
(three already in hand). Tier B (episode extraction → replay eval) is the larger build; prototype
the replay harness on 10–20 hand-picked correction episodes before committing to the full pipeline.
