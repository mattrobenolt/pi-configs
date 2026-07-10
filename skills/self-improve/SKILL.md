---
name: self-improve
description: Autonomous project-scoped improvement loop for agent behavior, prompts, skills, docs, tests, and workflow. Use at the end of work, after a messy session, when asked to self-improve/reflect/retro, or when pairing with WWMD to turn judgment gaps into concrete repo-local changes. Runs without approval unless it hits an explicit wall.
disable-model-invocation: true
---

# Self-Improve

Run an autonomous improvement loop. Do not present a menu and wait for approval. The point is to remove friction while the evidence is fresh.

Default scope is the current project. Prefer project-local fixes over global habit edits. Escalate only for irreversible changes, secrets/auth boundaries, missing permissions, or a change that would clearly outgrow the project.

## Load the local rules first

- The nearest project instructions: `AGENTS.md`.
- `wwmd` when the work involves judgment, review, delegation, or deciding what not to do.
- `skill-creator` when changing this skill or another skill.

## Stance

Act like a maintainer, not a suggestion engine. Identify the smallest improvement that would have prevented the observed friction, make it, verify it, and leave evidence. Delete or narrow bad instructions before adding new ones.

The loop must have teeth: any finding can change the plan, kill a proposed change, or produce a follow-up todo. If a finding has no concrete action, drop it.

## The autonomous cycle

1. Reconstruct what happened from the current conversation, tool output, errors, tests, subagent summaries, and touched files.
2. Run the WWMD lens over the workflow itself: simpler? right tool? objectively verified? sure or guessing? long-term ramification? would Matt wince?
3. **Act on findings in the same turn.** The most common self-improve failure is collecting friction and not encoding it. A subagent's self-report that flags a stale skill, a broken path, or a tool surprise is a signal that loses value every turn it sits unacted. Update the skill, fix the prompt, add the note — now, not "later."
4. Inspect project-local control surfaces first: `AGENTS.md`, repo docs, scripts, tests, local skills, local agents/subagent prompts, extension config, CI/devshell commands.
5. Check this skill's owned prompt resources under `skills/self-improve/prompts/` when using or improving self-improve subagents.
6. Pick a bounded batch of high-signal changes. Bias toward 1–3 tight edits over a grand self-help seminar.
7. Create/claim todos for the chosen work with tags `self-improve` and `project` or `global`.
8. Implement, verify mechanically where possible, and mark todos done. Commit only if the user explicitly asked for commits or the repo convention requires it.
9. Summarize what changed, what verified it, and any residual risk/follow-up.

## What to improve

Look for actionable gaps only:

| Area | Project-first action |
| --- | --- |
| Agent config | Tighten repo `AGENTS.md`; add missing project conventions; delete vague or contradictory instructions. |
| Subagent prompts | Improve local agent definitions or this skill's prompt resources; make scope, evidence, and stop rules sharper. |
| Skills | Fix trigger descriptions, stale instructions, missing references, or autonomy boundaries. |
| Tests | Add or update the test that would have caught the bug or regression actually observed. |
| Docs | Update docs that became wrong or caused avoidable confusion. |
| Scripts/devshell | Codify repeated manual commands; fix flaky or misleading scripts; prefer the flake/devshell. |
| Extensions/tools | Tighten schemas, descriptions, defaults, and debug output when tool behavior caused friction. |
| Workflow | Remove unnecessary back-and-forth, slow loops, or repeated manual checks. |
| Code quality | Simplify code revealed as brittle, noisy, or overbuilt by the session. |
| Solved algorithms | When a task involves a well-known algorithm (compression, crypto, hashing), link the proven C library or defer — don't hand-roll. A literal-only encoder passing round-trip with its own decoder is a stub, not a solution. |
| Flaky tests | Understand what the test is measuring before iterating on bounds. A warmup separating setup from measurement beats a bigger timeout. |
| Self-report findings | When a subagent's self-report flags friction, encode it immediately — update the skill, fix the prompt, add the note. Findings left for later are findings lost. |
| Model cost tiers | Match the model to the task's difficulty. Cheap models for routine work, strong models for hard design + adversarial review. Don't burn Opus on scaffolding. |

## Scope rules

Project scope is the default. Write project-specific conventions into the project, not global memory.

Global scope is allowed only when the lesson clearly generalizes across projects or fixes the agent environment itself. If you make a global change, include why it is not project-specific in the final summary.

Self-improve owns these files and may update them when evidence supports it:

- `skills/self-improve/SKILL.md`
- `skills/self-improve/AGENTS.md`
- `skills/self-improve/prompts/*.md`

## Final output

Keep it short:

```markdown
Changed:
- `path`: what changed and why

Verified:
- `command` → relevant result

Follow-up:
- TODO-xxxx or `none`
```

Never say done without verification. If verification is impossible, say exactly why and what evidence you used instead.
