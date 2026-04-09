#!/usr/bin/env nu

const DEFAULT_QMD_DAEMON_URL = "http://localhost:8181"
const READY_ATTEMPTS = 10
const READY_DELAY = 300ms


def daemon-url []: nothing -> string {
    (($env.PI_MEMORY_QMD_DAEMON_URL? | default $DEFAULT_QMD_DAEMON_URL) | str trim | str replace -r '/+$' '')
}


def daemon-healthy []: nothing -> bool {
    let url = (daemon-url)
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


def ensure-daemon []: nothing -> bool {
    if (daemon-healthy) {
        return true
    }

    let start = (^qmd mcp --http --daemon | complete)
    if $start.exit_code != 0 and not ($start.stderr | str contains "Already running") {
        return false
    }

    for _attempt in (0..<$READY_ATTEMPTS) {
        if (daemon-healthy) {
            return true
        }
        sleep $READY_DELAY
    }

    false
}


def searches-for-mode [mode: string, query: string] {
    if $mode == "keyword" {
        return [{type: "lex", query: $query}]
    }
    if $mode == "semantic" {
        return [{type: "vec", query: $query}]
    }
    if $mode == "deep" {
        return [
            {type: "lex", query: $query}
            {type: "vec", query: $query}
        ]
    }
    error make {msg: $"Unsupported mode: ($mode)"}
}


def cli-subcommand [mode: string] {
    if $mode == "keyword" {
        return "search"
    }
    if $mode == "semantic" {
        return "vsearch"
    }
    if $mode == "deep" {
        return "query"
    }
    error make {msg: $"Unsupported mode: ($mode)"}
}


def main [
    query: string,
    --collection (-c): string = "pi-sessions",
    --limit (-n): int = 5,
    --mode (-m): string = "deep",
] {
    if (ensure-daemon) {
        let payload = {
            searches: (searches-for-mode $mode $query)
            limit: $limit
            collections: [$collection]
        }
        let url = (daemon-url)
        let result = (^curl -sf -X POST $"($url)/query" -H "content-type: application/json" -d ($payload | to json) | complete)
        if $result.exit_code == 0 {
            print ($result.stdout | from json | to json)
            return
        }
    }

    let subcommand = (cli-subcommand $mode)
    let result = (^qmd $subcommand --json -c $collection -n ($limit | into string) $query | complete)
    if $result.exit_code != 0 {
        error make {msg: ($result.stderr | str trim)}
    }
    print $result.stdout
}
