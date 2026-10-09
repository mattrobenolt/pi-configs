# Term

The `term` tool owns a private Zellij workspace for each Pi session. Bash and Zsh support tracked shell commands.

## Shell commands

Use `run` for shell commands.

```json
{ "action": "run", "name": "build", "text": "pnpm check", "timeoutMs": 30000 }
```

The first call creates an interactive shell. Later calls preserve its directory and environment. The `cwd` parameter applies only to a new terminal.

A prompt hook records the exit status in a private file. Completion survives Ctrl-C and the loss of markers from scrollback. The tool retains only the latest command for each terminal.

The tracker owns the `__pi_term_*` names. Commands that replace prompt hooks can disable completion tracking. Terminal output can contain text from background processes.

If a run times out, use `wait` with the same name.

```json
{ "action": "wait", "name": "build", "timeoutMs": 30000 }
```

A timeout does not stop the command. A second run fails while the previous command remains incomplete. `interrupt` sends Ctrl-C. `kill` closes the terminal.

Tracked timeouts and progress updates show only output after the current command start marker. They omit prior scrollback and tracker input. If the start marker is absent, they omit ambiguous output. `read` still exposes raw terminal history.

## Dedicated processes and raw input

Use `ensure` with startup argv for dedicated processes.

```json
{"action":"ensure","name":"server","command":["node","server.js"]}
{"action":"wait","name":"server","pattern":"Listening on port"}
```

Use `send` for raw input to a program or REPL.

```json
{ "action": "send", "name": "repl", "text": "print(1 + 1)", "enter": true }
```

`send` does not track command completion. A process terminal defaults to an exit wait. An untracked interactive shell requires an explicit wait condition.

The default shell profile is `clean`. `shellProfile: "default"` loads the normal shell configuration. `closeOnExit: true` discards final output and exit status.

## Output waits

A `pattern` selects an output wait. Patterns match literal text by default. Explicit regex mode uses JavaScript multiline syntax.

```json
{ "action": "wait", "name": "server", "pattern": "^READY$", "matchMode": "regex" }
```

Output waits search the complete scrollback, including old output and command echo. The result includes match evidence outside the returned tail. Silence indicates inactivity, not completion.

Wait outcomes are explicit:

- `matched`: the output condition was met.
- `exited`: the process or tracked command finished.
- `exited_without_match`: the process finished without the requested output or silence condition.
- `silent`: the terminal met the quiet interval.
- `timed_out`: the deadline expired. The process continues.
- `missing`: the pane disappeared. The tool cannot recover its final output or status.

A nonzero exit retains its numeric status and marks the tool result as an error. `conditionMet` distinguishes completion from early exit.

## Reads and backend failures

Delta reads accept `limit` and retain unread lines. They also detect changes to partial lines. The tool caps terminal output at 2000 lines or 50KB. A truncated response includes `fullOutputPath`.

Read-only queries retry three times after invalid responses. Mutations never retry automatically. Unconfirmed creations remain registered for adoption instead of another process launch.

Session changes and shutdown close the workspace and remove temporary files. Output artifacts do not survive those events.

## Tests

Run the checks from the repository root.

```sh
nix develop --command pnpm --filter term-extension test
nix develop --command pnpm --filter term-extension test:integration
nix develop --command pnpm check
```

The dev shell supplies Zellij and Python. The integration suite creates and removes its own workspace.
