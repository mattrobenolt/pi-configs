# Herdr extension

`extensions/herdr.ts` exposes the Herdr socket API as native pi tools. All
Herdr tools are `deferred`: they stay out of the system prompt until
`tool_search` loads them.

Run `/reload` after editing. A new pi session loads the extension automatically.

## Discovery

All Herdr tools use `deferred` exposure. The built-in `tool_search` finds them
and declares the matches on the next model turn. Ask for a domain:

```text
tool_search("herdr pane split")
tool_search("herdr agent prompt")
tool_search("herdr supervisor fleet")
tool_search("herdr raw call")
```

## Tools

| Tool              | Purpose                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `herdr_fleet`     | Supervisor `status` and `digest`. Digest reads pane tails and groups decisions, blocked, working, and idle. Read-only.                                                                                         |
| `herdr_agent`     | `list`, `get`, `read`, `start`, `prompt`, `wait`, `send_keys`, `rename`, `focus`, `explain`.                                                                                                                   |
| `herdr_pane`      | `list`, `get`, `current`, `layout`, `process_info`, `split`, `read`, `run`, `wait_output`, `close`, `zoom`, `focus_direction`, `rename`, `send_text`, `send_keys`, `neighbor`, `edges`, `resize`, `input_set`. |
| `herdr_workspace` | `list`, `get`, `create`, `focus`, `rename`, `close`.                                                                                                                                                           |
| `herdr_tab`       | `list`, `get`, `create`, `focus`, `rename`, `close`, `move`.                                                                                                                                                   |
| `herdr_worktree`  | `list`, `create`, `open`, `remove`.                                                                                                                                                                            |
| `herdr_events`    | One-shot `wait`, or a bounded `watch` of pane status, output, or scroll events.                                                                                                                                |
| `herdr_notify`    | Show a Herdr notification or toast.                                                                                                                                                                            |
| `herdr_catalog`   | List/search all socket methods, or return one method's request schema.                                                                                                                                         |
| `herdr_call`      | Raw call escape hatch for every socket method.                                                                                                                                                                 |

`herdr_call` plus `herdr_catalog` provides full API coverage. The typed tools
cover the supervisor's common paths.

## Supervisor loop

1. `herdr_fleet` with `action: "digest"` finds agents that need a decision.
2. `herdr_agent` with `action: "read"` gets the last terminal output.
3. `herdr_agent` with `action: "prompt"` sends a real turn; `wait: true` waits
   for idle, done, or blocked.
4. `herdr_pane` with `action: "split"` creates a worker pane.
5. `herdr_agent` with `action: "start"` starts a `pi`, Claude, Codex, or other
   supported agent in that pane.
6. `herdr_events` with `action: "watch"` monitors several panes without
   polling.

Use files, git, CI, PRs, Slack, and service state as external truth. An agent
status is a claim. Do not close a pane or workspace you did not create unless
the user asked.

## Server 0.9.1 behavior

- `agent.start` can return `launch_pending: true`. The `herdr_agent` `start`
  action polls `agent.get` until `interactive_ready`.
- A new pane may still run shell startup. `herdr_agent` `start` retries
  `agent_pane_busy` for up to 45 seconds.
- `pane.agent_status_changed` requires a `pane_id`. `herdr_events` builds one
  subscription per pane.
- The catalog uses `HERDR_BIN_PATH` when it is set, so it matches the running
  server rather than a newer CLI on `PATH`.

## Schema

```sh
herdr api schema --json
```

`herdr_catalog` caches that document per session. Use `refresh: true` after a
Herdr upgrade or a server restart.
