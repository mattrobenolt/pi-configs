---
name: self-improve
description: Autonomous project-scoped improvement loop for agent behavior, prompts, skills, docs, tests, and workflow. Use at the end of work, after a messy session, when asked to self-improve/reflect/retro, or when pairing with WWMD to turn judgment gaps into concrete repo-local changes. Runs without approval unless it hits an explicit wall.
disable-model-invocation: true
---

# Self-Improve

Run an autonomous improvement loop. Do not present a menu and wait for approval. The point is to remove friction while the evidence is fresh.

Default scope is the current project. Prefer project-local fixes over global habit edits. Escalate only for irreversible changes, secrets/auth boundaries, missing permissions, or a change that would clearly outgrow the project.

## Load the local rules first

Read these before making changes:

- The nearest project instructions: `AGENTS.md`.
- This skill's local rules: `skills/self-improve/AGENTS.md`.
- `wwmd` when the work involves judgment, review, delegation, or deciding what not to do.
- `skill-creator` when changing this skill or another skill.
- `session-reader` only when the relevant session/subagent transcript is not already summarized in the conversation.

## Stance

Act like a maintainer, not a suggestion engine. Identify the smallest improvement that would have prevented the observed friction, make it, verify it, and leave evidence. Delete or narrow bad instructions before adding new ones.

The loop must have teeth: any finding can change the plan, kill a proposed change, or produce a follow-up todo. If a finding has no concrete action, drop it.

## The autonomous cycle

1. Reconstruct what happened from the current conversation, tool output, errors, tests, subagent summaries, and touched files.
2. Run the WWMD lens over the workflow itself: simpler? right tool? objectively verified? sure or guessing? long-term ramification? would Matt wince?
3. Inspect project-local control surfaces first: `AGENTS.md`, repo docs, scripts, tests, local skills, local agents/subagent prompts, extension config, CI/devshell commands.
4. Check this skill's owned prompt resources under `skills/self-improve/prompts/` when using or improving self-improve subagents.
5. Pick a bounded batch of high-signal changes. Bias toward 1–3 tight edits over a grand self-help seminar.
6. Create/claim todos for the chosen work with tags `self-improve` and `project` or `global`.
7. Implement, verify mechanically where possible, and mark todos done. Commit only if the user explicitly asked for commits or the repo convention requires it.
8. Summarize what changed, what verified it, and any residual risk/follow-up.

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

## Scope rules

Project scope is the default. Write project-specific conventions into the project, not global memory.

Global scope is allowed only when the lesson clearly generalizes across projects or fixes the agent environment itself. If you make a global change, include why it is not project-specific in the final summary.

Self-improve owns these files and may update them when evidence supports it:

- `skills/self-improve/SKILL.md`
- `skills/self-improve/AGENTS.md`
- `skills/self-improve/prompts/*.md`

## Subagent use

Use subagents for breadth or adversarial review, not as a way to outsource judgment. You remain the director.

When delegating self-improvement work, feed agents the relevant prompt from `skills/self-improve/prompts/` and require evidence: changed files, commands run, validation output, and residual risks. Discard uncited claims. Synthesize; do not average.

Suggested split:

- `prompts/auditor.md` — find friction and missed opportunities from session/project evidence.
- `prompts/prompt-reviewer.md` — critique AGENTS.md, skills, and subagent prompts.
- `prompts/implementer.md` — apply a bounded accepted improvement with verification.

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
