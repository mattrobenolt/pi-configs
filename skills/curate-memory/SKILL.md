---
name: curate-memory
description: Non-interactive memory curation. Reads each memory file, fact-checks where possible, consolidates, and overwrites. Designed to run via `pi --print --no-extensions --skill`. Logs results to curation.log.
---

# Memory Curation

You are running in non-interactive mode. Process each memory file systematically and exit. Do not ask for confirmation — just do the work.

## Files to curate

Process in this order:
1. `~/.pi/agent/memory/MEMORY.md` — global env/config/prefs
2. `~/.pi/agent/memory/SELF.md` — behavioral learnings about how to work with Matt
3. `~/.pi/agent/memory/USER.md` — observations about Matt as a person
4. All `~/.pi/agent/projects/**/*.md` — per-project memories

**Skip** `~/.pi/agent/memory/daily/` entirely — daily logs are the archive, never curate them.
**Skip** any file under 40 lines — not worth the churn.

First, discover all project memory files:

```bash
find ~/.pi/agent/projects -name "*.md" | sort
```

## For each file

### Step 1: Read and check size

Read the file. Count lines. If under 40 lines, log "skipped (under threshold)" and move on.

### Step 2: Rotate backup

Before overwriting, rotate up to 3 generations:

```bash
cd "$(dirname <file>)"
cp -f "$(basename <file>).2" "$(basename <file>).3" 2>/dev/null || true
cp -f "$(basename <file>).1" "$(basename <file>).2" 2>/dev/null || true
cp -f "$(basename <file>)" "$(basename <file>).1"
```

### Step 3: Find the project directory

For project `MEMORY.md` files, find the local checkout path using two methods in order:

**Method 1: Frontmatter.** Check if the file starts with `---`. If so, parse `project-dirs` and look up the current hostname (`hostname` command). If the path exists on disk, use it.

**Method 2: Session history.** If no frontmatter path, check `~/.pi/agent/sessions/` for a directory matching this project. The session dirs are named like `--Users-matt-code-planetscale-exosphere-zig--`. Convert to a path by replacing `--` with `/` and stripping the leading `/`:

```bash
ls ~/.pi/agent/sessions/ | grep -i "exosphere-zig"
# --Users-matt-code-planetscale-exosphere-zig--
# → /Users/matt/code/planetscale/exosphere-zig
```

Check if that directory exists on disk. If so, use it.

If neither method finds a path, log "fact-check: repo not on this machine" and skip.

### Step 4: Fact-check

With the project directory in hand, pick **3-5 specific claims** from the memory file to verify — don't try to verify everything. Prioritise:
1. Claims about major subsystems or libraries ("uses X", "wraps Y")
2. Key file paths mentioned (`src/foo.zig`, `Justfile`, etc.)
3. Build or test commands

For each: read the relevant file or run a targeted command. Note verified/stale. Move on.

**Time-box this step** — if verification of one claim is taking more than a few seconds, skip it.

Stale = file no longer exists, command has changed, dependency removed, subsystem was ripped out

For `SELF.md`, `USER.md`, and global `MEMORY.md`: skip fact-checking, go straight to curation.

### Step 4: Curate

Rewrite the file content with these rules:

**Preserve:**
- All concrete decisions with context ("decided X because Y")
- Specific technical facts, API patterns, known gotchas
- Dates and session references where they add context
- Anything verified in step 3

**Consolidate:**
- Multiple observations about the same thing → one canonical entry
- Repeated themes → single clear statement
- Redundant examples → keep the most illustrative one

**Remove:**
- Entries explicitly superseded by a later entry
- Resolved issues or TODOs that are clearly done
- Stale file paths or commands that failed fact-check
- Generic filler that adds no information ("remember to be careful about X")
- Refactor history / changelog sections — that's what git log is for

**Target:** 30–50% reduction in line count while preserving all information density. Shorter is better. If in doubt, keep it.

**Format:** preserve any existing structure (headers, sections, #tags). Don't restructure unless it genuinely helps clarity.

### Step 5: Gap-fill from sessions

Before writing, search the session index for discussions related to this memory file:

```bash
qmd search "<key terms from this project/topic>" -c pi-sessions -n 5
```

Read the results. Look for:
- Decisions or conclusions that were reached but not recorded
- Patterns or gotchas that came up in conversation but are absent from memory
- Corrections or updates to things currently in the memory file
- Preferences or working style notes (for SELF.md/USER.md)

If anything significant is missing, add it to the curated content. Keep additions concise — same standard as the rest of the file.

Skip this step if the sessions index is empty or returns no relevant results.

### Step 6: Write

Write the curated content back to the original file path using the `write` tool.

### Step 7: Log

Append a single line to `~/.pi/agent/memory/curation.log`:

```
[YYYY-MM-DD HH:MM:SS] <relative-path>: <before> lines → <after> lines [fact-check: <summary or "n/a">] [gaps: <N added from sessions or "none">]
```

Example:
```
[2026-03-31 09:00:12] memory/MEMORY.md: 87 lines → 52 lines [fact-check: n/a] [gaps: 2 added from sessions]
[2026-03-31 09:00:18] projects/git/github.com/planetscale/exosphere-zig/MEMORY.md: 210 lines → 134 lines [fact-check: 3 verified, 1 stale (removed), 2 unverifiable] [gaps: none]
```

## After all files

Run qmd update to re-index:

```bash
qmd update
```

Append final log entry:

```
[YYYY-MM-DD HH:MM:SS] curation complete — <N> files processed, <M> skipped
```

Then print a brief summary of what was done to stdout.
