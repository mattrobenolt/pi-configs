# pi-configs

Personal [pi](https://github.com/mariozechner/pi-coding-agent) configuration. Extensions, agents, skills, and themes that shape how I work with AI day-to-day.

This is an evolving workbench — some things are battle-tested, some are experimental, some exist because they seemed interesting and haven't been fully evaluated yet.

## Structure

```
extensions/   TypeScript extensions that add tools, UI, and behavior to pi
agents/       Custom agent definitions for specialized subagent tasks
skills/       Markdown skill files that give the agent domain-specific knowledge
themes/       Color themes (just Dracula)
```

## Extensions

Extensions are loaded automatically from the `extensions/` directory on session start.

| Extension | What it does |
|---|---|
| `answer.ts` | `/answer` command and `Ctrl+.` shortcut — presents an interactive TUI for answering questions extracted from the last assistant message |
| `better-diff/` | Replaces default edit/write diff output with Shiki syntax-highlighted diffs, adapting to split or unified layout based on terminal width |
| `btw.ts` | `/btw` — floating side-chat overlay for tangential questions without polluting the main session |
| `cost.ts` | `/cost [days]` — token usage summary broken down by date, project, and model |
| `direnv.ts` | Loads direnv environments into bash tool invocations, tracks CWD across commands, shows a rich footer with git status, nix badge, and token usage |
| `execute-command.ts` | `execute_command` tool — lets the agent queue a slash command or message to fire after its current turn ends |
| `memory.ts` | Five-target memory system (global, project, self, user, daily) with context injection before every turn and qmd-powered semantic search |
| `notify.ts` | Sends a native desktop notification (OSC 777) when the agent finishes a turn — requires Ghostty with `desktop-notifications = true` |
| `prompt-editor.ts` | Named "modes" for model + thinking level combinations — cycle with `Ctrl+Space`, pick with `/mode` |
| `setup.ts` | Session defaults: activates `grep`, `find`, `ls` built-in tools; auto-expands tool outputs; registers `get_system_prompt`, `get_tools`, `get_last_payload` introspection tools |
| `slack.ts` | Native Slack tools: `SlackRead`, `SlackSearch`, `SlackReply`, `SlackUserLookup`, `SlackChannelHistory`; auth comes from Slack.app and default workspace comes from `settings.json` |
| `statusline.ts` | Footer showing repo name, git branch, dirty state, current time, model, and token usage |
| `zellij.ts` | `zellij` tool for session/pane/tab management via the official CLI automation surface; new panes default to a quiet shell launched through `direnv exec <cwd>` so flake/devshell context loads without prompt junk |
| `todos/` | File-backed todo manager with locking, tags, session assignment, and a TUI selector — the `todo` tool used for task tracking in longer sessions |
| `webfetch.ts` | `webfetch` and `websearch` tools — GitHub-URL-aware fetching and Exa-powered web search |
| `whimsical.ts` | Animated loading messages with shimmer effect. Purely cosmetic. |

## Agents

Custom agent definitions invoked as subagents via the `Agent` tool.

**General purpose:**

| Agent | What it does |
|---|---|
| `planner` | Interactive brainstorming and planning — clarifies requirements, explores approaches, writes plans |
| `researcher` | Deep research using `websearch` and `webfetch` — produces a structured findings report |
| `reviewer` | Code review for quality, security, and correctness |
| `scout` | Fast read-only codebase recon — maps code, conventions, and patterns before making changes |
| `worker` | Implements tasks from todos — writes code, runs tests, commits |
| `autoresearch` | Autonomous experiment loop for optimization targets — runs benchmarks, keeps improvements, reverts regressions |

**Zig review suite** — runs in parallel via the `zig-review` skill, then synthesizes via `zig-review-second-opinion`:

`zig-review-api` · `zig-review-deslop` · `zig-review-docs` · `zig-review-idioms` · `zig-review-simplify` · `zig-review-tests` · `zig-review-tiger-style` · `zig-review-second-opinion`

## Skills

Skills are markdown files loaded by the agent to provide domain-specific knowledge and workflows.

| Skill | What it does |
|---|---|
| `code-simplifier` | Refactor code for clarity and consistency |
| `commit` | Write concise git commit messages |
| `curate-memory` | Non-interactive memory curation — consolidates and compacts memory files |
| `deslop` | Strip AI-generated comment noise from code diffs |
| `github` | Interact with GitHub via `gh` CLI |
| `iterate-pr` | Fix CI failures and review feedback in a loop until checks pass |
| `learn-codebase` | Discover project conventions and surface security concerns |
| `nix-devshell` | Work within Nix flake-based devShells |
| `nushell` | Write and edit Nushell scripts |
| `self-improve` | Meta-skill for improving agent behavior and configuration |
| `session-reader` | Read and analyze pi session JSONL files |
| `simplify` | Find simplification opportunities in code |
| `skill-creator` | Guide for creating new skills |
| `tiger-style` | TigerBeetle's coding style guide for Zig |
| `zig` | Idiomatic Zig 0.15 patterns and common migration pitfalls |
| `zig-review` | Orchestrates the full parallel Zig review suite |

## Setup

Uses a Nix flake devshell. From the repo root:

```sh
direnv allow   # or: nix develop
npm install
```

Type checking:

```sh
npm run check
npm run fmt
```

## Packages

Loaded via `settings.json`:

- `./pi-subagents` — subagent infrastructure (local fork)
