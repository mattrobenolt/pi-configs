# AGENTS.md

This directory is the source of truth for the `self-improve` skill. Keep it small, sharp, and operational.

## Purpose

`self-improve` turns observed friction into autonomous repo-local improvements. It should reduce Matt's need to steer future sessions, not generate retrospective paperwork.

## Best-practice sources

When editing this skill, ground changes in:

- The project/root `AGENTS.md` for repo conventions and ownership boundaries.
- `skills/wwmd/SKILL.md` for judgment, autonomy, verification, and escalation posture.
- `skills/skill-creator/SKILL.md` for skill packaging and progressive disclosure.
- Primary project docs or source files for project-specific behavior. Do not encode guessed conventions.

## Editing rules

Prefer deletion and tightening over expansion. If a sentence cannot change behavior, cut it.

Keep `SKILL.md` as the executable workflow. Put reusable delegation text in `prompts/`. Do not add README/changelog/process docs; that is how a skill becomes a filing cabinet with delusions of grandeur.

Do not make this skill ask for approval by default. It may escalate only for secrets/auth, irreversible changes, permission walls, or scope explosions.

## Prompt ownership

The prompt files in `prompts/` are owned by this skill. They are not generic agents; they are reusable task briefs to pass to subagents when breadth, critique, or implementation help is useful.

When improving prompts:

- Make the expected evidence explicit.
- Include stop rules and scope boundaries.
- Prefer project-local action.
- Remove vague personality instructions unless they directly affect output quality.
- Preserve the director model: subagents advise or execute bounded work; the caller owns synthesis and final judgment.

## Verification

For markdown-only edits, run at least a sanity check that files exist and frontmatter remains parseable enough for pi discovery. For TypeScript/scripts/extensions touched by a self-improve change, run the relevant project checks from the root instructions.
