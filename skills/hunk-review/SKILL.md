---
name: hunk-review
description: Answer Hunk review notes from a live Hunk pane with the hunk_review tool. Use when a user message starts with "Hunk review notes:" or when asked to read, answer, or navigate Hunk comments in this repository.
---

# Hunk review

## Incoming notes

The user reviews a diff in Hunk, which runs in a Rex pane beside this session. Pressing `ctrl+g` in Hunk stages this message in the input:

```text
Hunk review notes:
- path/to/file.ts:139 — note body
```

Hunk supplies the note body and the anchor, including a line range when the note covers one. The staged text contains no note IDs and no reply instructions.

## Read the notes

Call the `hunk_review` tool with `action: "read"`. It returns the live session, the selected file and hunk, and every note as `[note id] path:start-end — body` (`path:line` for a single line). An unanswered user note is marked `(unanswered)`.

If the tool reports more than one matching session, call it with `action: "status"` and pass the chosen `session_id`.

## Answer each note

1. Read the code at the anchor.
2. Fix the code, or decide that the note needs an answer only.
3. Call `hunk_review` with:
   - `action: "reply"`
   - `note_id`: the id from the read
   - `summary`: the answer, one or two sentences
4. If you changed code, call `hunk_review` with `action: "reload"`.

Add your own finding with `action: "comment"`, `file`, `line`, and `summary`. Move the user's review with `action: "navigate"`, using `note_id` or `file` with `hunk`.

Rules:

- Reply to every user note that you addressed.
- Do not reply to agent notes unless the user asks.
- Do not delete or clear user notes.
- Keep each reply short. State the fix or the answer, not a summary of the review.
- Do not start the Hunk TUI. The user owns the Hunk pane.

## Constraints

- Hunk stores live notes in the running session. If the pane closes, the notes are gone.
- `hunk skill show` fails in this environment. The Nix package omits the bundled skill.
