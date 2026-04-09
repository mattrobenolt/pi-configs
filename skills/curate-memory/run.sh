#!/usr/bin/env nu
# Memory curation wrapper — called hourly by launchd.
# Decides whether to actually curate based on time elapsed and session activity.

const DEFAULT_QMD_DAEMON_URL = "http://localhost:8181"
const QMD_READY_ATTEMPTS = 10
const QMD_READY_DELAY = 300ms


def qmd-daemon-url []: nothing -> string {
    (($env.PI_MEMORY_QMD_DAEMON_URL? | default $DEFAULT_QMD_DAEMON_URL) | str trim | str replace -r '/+$' '')
}


def qmd-daemon-healthy []: nothing -> bool {
    let url = (qmd-daemon-url)
    let result = (^curl -sf $"($url)/health" | complete)
    if $result.exit_code != 0 {
        return false
    }

    try {
        let payload = ($result.stdout | from json)
        ($payload.status? | default "") == "ok"
    } catch {
        false
    }
}


def ensure-qmd-daemon [] {
    if ((which qmd | length) == 0) {
        print "QMD unavailable; curation will fall back to CLI searches"
        return
    }

    if (qmd-daemon-healthy) {
        let url = (qmd-daemon-url)
        print $"QMD daemon ready at ($url)"
        return
    }

    let start = (^qmd mcp --http --daemon | complete)
    if $start.exit_code != 0 and not ($start.stderr | str contains "Already running") {
        print $"QMD daemon start failed; curation will fall back to CLI searches: ($start.stderr | str trim)"
        return
    }

    for _attempt in (0..<$QMD_READY_ATTEMPTS) {
        if (qmd-daemon-healthy) {
            let url = (qmd-daemon-url)
            print $"QMD daemon ready at ($url)"
            return
        }
        sleep $QMD_READY_DELAY
    }

    print "QMD daemon did not become healthy in time; curation will fall back to CLI searches"
}

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

ensure-qmd-daemon

# Run curation via pi
pi --print --no-session --no-extensions --no-skills --no-prompt-templates --model "anthropic/claude-haiku-4-5" --skill $"($env.HOME)/.pi/agent/skills/curate-memory/SKILL.md" --tools read,write,bash,find "curate memory"

# Record successful run
$now | format date "%+" | save --force $last_run_file
