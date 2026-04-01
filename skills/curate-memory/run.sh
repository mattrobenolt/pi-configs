#!/usr/bin/env nu
# Memory curation wrapper — called hourly by launchd.
# Decides whether to actually curate based on time elapsed and session activity.

let last_run_file = ($env.HOME | path join ".pi/agent/memory/curation-last-run")
let sessions_index = ($env.HOME | path join ".pi/agent/sessions-index")
let now = (date now)

# Thresholds
let max_age = 24hr
let busy_session_count = 5     # curate sooner if this many new sessions

# Check last run
let should_run = if ($last_run_file | path exists) {
    let last_ts = (open $last_run_file | str trim | into datetime)
    let elapsed = $now - $last_ts
    let new_sessions = (
        glob ($sessions_index | path join "**/*.md")
        | each { |f| ls $f } | flatten
        | where modified > $last_ts
        | length
    )

    if $elapsed > $max_age {
        print $"Curating: ($elapsed) since last run"
        true
    } else if $new_sessions >= $busy_session_count {
        print $"Curating: ($new_sessions) new sessions since last run \(busy day\)"
        true
    } else {
        print $"Skipping: only ($new_sessions) new sessions, ($elapsed) elapsed"
        false
    }
} else {
    print "Curating: no previous run recorded"
    true
}

if not $should_run { exit 0 }

# Run curation via pi
pi --print --no-session --no-extensions --no-skills --no-prompt-templates --model "anthropic/claude-haiku-4-5" --skill $"($env.HOME)/.pi/agent/skills/curate-memory/SKILL.md" --tools read,write,bash,find "curate memory"

# Record successful run
$now | format date "%+" | save --force $last_run_file
