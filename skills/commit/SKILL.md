---
name: commit
description: Write concise git commit messages and commit staged changes. Trigger when the user says "commit this", "commit that", "make a commit", "commit the changes", or any instruction to create a git commit. Do NOT auto-stage files — only commit what is already staged.
---

# Commit

## Workflow

1. Run `git diff --cached` to see what's staged
2. If nothing is staged, tell the user and stop
3. Run `git log --oneline -10` to see recent message style in this repo
4. Write a commit message following the rules below
5. Commit with `git commit`

## Commit Message Rules

Write the message as a single short line. Target under 50 characters, hard max 72.

**Voice and tone:**
- Write like a human jotting a note, not an AI summarizing a diff
- Lowercase unless a proper noun
- No period at the end
- Imperative mood ("fix crash" not "fixed crash" or "fixes crash")

**Content:**
- State *what* changed at a high level, not *how*
- One line. No body, no bullet lists, no paragraphs
- Only add a body (separated by blank line) if the change is genuinely complex AND the "why" isn't obvious from the diff — this should be rare
- When a body is warranted, keep it to 1-3 short sentences. Never bullet lists.

**What to avoid:**
- Never list files or functions changed
- Never describe every individual change
- Never use filler like "various improvements" or "minor updates"
- Never use prefixes like `feat:`, `fix:`, `chore:` unless the repo already uses them (check git log)
- Never wrap the message in quotes when passing to `git commit -m`

## Examples

Good:
- `fix null pointer in session cleanup`
- `add rate limiting to auth endpoints`
- `remove unused profile migration`
- `handle timeout when upstream is slow`
- `update parser for new v3 schema`

Bad:
- `Fix: Updated the session cleanup handler to properly check for null pointers before accessing session data` (too long, too detailed)
- `feat: add rate limiting` (prefix not needed)
- `Various improvements to auth and session handling` (vague filler)
- `Update files` (meaningless)

## Commit Command

Always pass the message via heredoc to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
message here
EOF
)"
```
