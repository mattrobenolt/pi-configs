---
name: agent-slack
description: |
  Read, search, and interact with Slack. Use when:
  - Reading a Slack message or thread (given a URL or channel+ts)
  - Browsing recent channel messages / channel history
  - Searching Slack messages or files
  - Sending, editing, or deleting a message; adding/removing reactions
  - Listing channels/conversations
  - Fetching a Slack canvas as markdown
  - Looking up Slack users
  Triggers: "slack message", "slack thread", "slack URL", "slack link", "read slack", "reply on slack", "search slack", "channel history", "recent messages"
---

# Slack with `agent-slack`

Invoke via the skill's wrapper script (resolves relative to this skill's directory):

```bash
./run.sh <command> [args]
```

This uses `nix run github:stablyai/agent-slack` — no global install needed. First run fetches from the Nix store; subsequent runs are cached and fast.

## Auth

Auth is automatic on macOS — reads token from Slack.app local data. If it fails:

```bash
./run.sh auth import-desktop
./run.sh auth test
./run.sh auth whoami
```

## Search

```bash
# Search messages (preferred — use channel scope for reliability)
./run.sh search messages "query" --channel general
./run.sh search messages "query" --after 2026-01-01

# Search everything (messages + files)
./run.sh search all "query"
```

## Read messages and threads

```bash
# Single message (includes thread summary if threaded)
./run.sh message get "https://workspace.slack.com/archives/C123/p1700000000000000"

# Full thread
./run.sh message list "https://workspace.slack.com/archives/C123/p1700000000000000"

# Recent channel history
./run.sh message list general --limit 20
```

## Send / reply / react

```bash
./run.sh message send "https://...thread_url" "reply text"
./run.sh message react add "https://...msg_url" "eyes"
```

## Channels and users

```bash
./run.sh channel list
./run.sh user list
./run.sh user get "@alice"
```

## Identity

Matt Robenolt (the user) is `U097K33T0N6` (`@matt`) on `planetscale.slack.com`. Use this ID when filtering by author or searching for Matt's messages.

Known collaborators on `planetscale.slack.com`:

| Name | Handle | User ID |
|------|--------|---------|
| Matt Robenolt | @matt | U097K33T0N6 |
| Max Englander | @max | U097K33FM1Q |
| Joe Miller | @joe | U097HJR5E93 |
| Isaac Diamond | @isaac | U09A5H9EYP6 |
| Matt Burke (Spraints) | @spraints | U09BNA1AQQY |
| Hans Nielsen | @hans | U09Q9GW32RZ |
| Sam Lambert (CEO) | @sam | U09734L8P9D |
| Nick Van Wiggeren (CTO) | @nick | U097KH3QELU |
| Travis Cole | @tcole | U097KH77GAY |
| Tom Pang | @tom | U099MCBNV39 |
| Ben Dicken | @ben | U097DNQNPBM |
| Mickael Carl | @mickael | U09JS3GLC3X |

For anyone not in this table, resolve on the fly: `user get "@handle"`.

## Workspace

The wrapper script always injects `--workspace https://planetscale.slack.com` automatically. Never pass `--workspace` manually.

```bash
./run.sh message list general --limit 20
```

## Canvas

```bash
./run.sh canvas get "https://workspace.slack.com/docs/T123/F456"
```

## Output

All output is JSON, aggressively pruned (null/empty fields removed). Pipe to `jq` for filtering.
