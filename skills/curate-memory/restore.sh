#!/usr/bin/env bash
# Restore memory files from backup before re-running curation.
# Usage: ./restore.sh [generation]  (default: 1 = most recent backup)
#
# Restores MEMORY.md.1 → MEMORY.md for all memory files.
# Run this to reset before iterating on the curation skill.

set -euo pipefail

GEN="${1:-1}"

restore_file() {
    local f="$1"
    local backup="${f}.${GEN}"
    if [[ -f "$backup" ]]; then
        cp "$backup" "$f"
        echo "restored: $f (from .${GEN})"
    else
        echo "skipped: $f (no .${GEN} backup)"
    fi
}

# Global memory files
restore_file ~/.pi/agent/memory/MEMORY.md
restore_file ~/.pi/agent/memory/SELF.md
restore_file ~/.pi/agent/memory/USER.md

# Project memory files
find ~/.pi/agent/projects -name "MEMORY.md" | while read -r f; do
    restore_file "$f"
done

echo "done — run ./run.sh to curate again"
