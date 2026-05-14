# pi-configs

Personal [pi](https://github.com/mariozechner/pi-coding-agent) configuration. Extensions, agents, skills, and themes that shape how I work with AI day-to-day.

This is an evolving workbench — some things are battle-tested, some are experimental, some exist because they seemed interesting and haven't been fully evaluated yet.

## Structure

```
extensions/   Pi-only TypeScript extensions: tools, UI, hooks, and session behavior
agents/       Pi subagent definitions loaded by the subagent package/tool
skills/       Loose pi-local skills and compatibility adapters
plugins/      Claude Code plugin bundles exposed through the local marketplace
packages/     Local package/fork code and workspace packages
scripts/      Repo-local automation and eval helpers
themes/       Color themes
```

The portability boundary is intentional:

- Put shareable domain bundles in `plugins/`. A plugin may contain skills, slash commands, agents, LSP settings, MCP config, or other Claude Code plugin metadata.
- Put pi runtime behavior in `extensions/`. These files call the pi extension API directly and are not portable to Claude Code or Codex without being rewritten as MCP tools, CLIs, or skills.
- Put package-shaped code in `packages/`. If it has its own `package.json`, tests, changelog, README, and source tree, it does not belong at the repo root.
- Put only loose local skills in `skills/`. If a skill belongs to a shareable domain such as Zig, the plugin copy is canonical and the root skill should be a pi compatibility adapter.

## Extensions

Extensions are loaded automatically from the `extensions/` directory on session start.

| Extension              | What it does                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answer.ts`            | `/answer` command and `Ctrl+.` shortcut — presents an interactive TUI for answering questions extracted from the last assistant message                         |
| `btw.ts`               | `/btw` — floating side-chat overlay for tangential questions without polluting the main session                                                                 |
| `compaction-model.ts`  | Uses a local llamacpp model for compaction when the active model is local                                                                                       |
| `cost.ts`              | `/cost [days]` — token usage summary broken down by date, project, and model                                                                                    |
| `devshell.ts`          | `/cd` and `/direnv`; wraps shell commands with direnv, rewrites via rtk, and resolves file tools relative to the current cwd                                     |
| `execute-command.ts`   | `execute_command` tool — lets the agent queue a slash command or message to fire after its current turn ends                                                    |
| `notion.ts`            | `NotionRead` and `NotionSearch` tools — read/search Notion using `NOTION_TOKEN` or the local macOS Notion app token                                             |
| `notify.ts`            | Sends a native desktop notification (OSC 777) when the agent finishes a turn — requires Ghostty with `desktop-notifications = true`                             |
| `prompt-editor.ts`     | Named "modes" for model + thinking combinations — cycle with `Ctrl+Space`, pick with `/mode` or `Ctrl+Shift+M`                                                 |
| `setup.ts`             | Session defaults: activates `grep`, `find`, `ls`; auto-expands tool outputs; registers `get_system_prompt`, `get_tools`, `get_last_payload` introspection tools |
| `statusline.ts`        | Footer showing repo/directory, branch, dirty state, current time, extension statuses, model, thinking level, and token usage                                    |
| `temporal-context.ts`  | Injects hidden temporal context only after long pauses, currently gaps of 30+ minutes between user/assistant messages                                           |
| `webfetch.ts`          | `webfetch` and `websearch` tools — GitHub-URL-aware fetching and Exa-powered web search                                                                         |
| `whimsical.ts`         | Animated loading messages with shimmer effect. Purely cosmetic.                                                                                                 |

## Agents

Custom agent definitions invoked as subagents via the `subagent` tool/package.

**General purpose:**

| Agent                     | What it does                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `autoresearch`            | Autonomous experiment loop for optimization targets — runs benchmarks, keeps improvements, reverts regressions |
| `code-review`             | Orchestrates a two-model parallel code review plus adversarial consolidation                                   |
| `incident-summary`        | Summarizes a Slack incident channel with timeline, root cause, and resolution                                  |
| `planner`                 | Interactive brainstorming and planning — clarifies requirements, explores approaches, writes plans             |
| `researcher`              | Deep research using `websearch` and `webfetch` — produces a structured findings report                         |
| `reviewer`                | Code review for quality, security, and correctness                                                             |
| `reviewer-second-opinion` | Adversarial synthesis for parallel code reviews                                                               |
| `scout`                   | Fast read-only codebase recon — maps code, conventions, and patterns before making changes                     |
| `worker`                  | Implements tasks from todos — writes code, runs tests, commits                                                |

**Zig review suite** — runs in parallel via the `zig-review` skill, then synthesizes via `zig-review-second-opinion`:

`zig-review-api` · `zig-review-deslop` · `zig-review-docs` · `zig-review-idioms` · `zig-review-simplify` · `zig-review-tests` · `zig-review-tiger-style` · `zig-review-second-opinion`

## Skills

Skills are markdown files loaded by the agent to provide domain-specific knowledge and workflows.

Root-level skills are pi-local. For shareable plugin-owned domains, prefer the plugin version as the source of truth. Today `plugins/zig` owns the canonical Zig writing and Tiger Style skills; `skills/zig` and `skills/tiger-style` are compatibility adapters so pi can still load them from the root skill directory.

| Skill             | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| `code-simplifier` | Refactor code for clarity and consistency                                |
| `commit`          | Write concise git commit messages                                        |
| `curate-memory`   | Non-interactive memory curation — consolidates and compacts memory files |
| `deslop`          | Strip AI-generated comment noise from code diffs                         |
| `github`          | Interact with GitHub via `gh` CLI                                        |
| `iterate-pr`      | Fix CI failures and review feedback in a loop until checks pass          |
| `learn-codebase`  | Discover project conventions and surface security concerns               |
| `nix-devshell`    | Work within Nix flake-based devShells                                    |
| `nushell`         | Write and edit Nushell scripts                                           |
| `pi-update`       | Update the local pi coding agent packages                                |
| `self-improve`    | Meta-skill for improving agent behavior and configuration                |
| `session-reader`  | Read and analyze pi session JSONL files                                  |
| `simplify`        | Find simplification opportunities in code                                |
| `skill-creator`   | Guide for creating new skills                                            |
| `tiger-style`     | TigerBeetle's coding style guide for Zig                                 |
| `write-like-matt` | Draft Slack messages in Matt's voice                                     |
| `zig`             | Idiomatic Zig 0.15 patterns and common migration pitfalls                |
| `zig-review`      | Orchestrates the full parallel Zig review suite                          |

## Setup

Uses a Nix flake devshell and pnpm workspaces. Do not use npm in this repo; `pnpm-lock.yaml` owns the dependency graph.

From the repo root:

```sh
direnv allow   # or: nix develop
pnpm install
```

If `node_modules/` is missing or stale, the setup is still just:

```sh
pnpm install
```

Normal checks:

```sh
pnpm check
pnpm lint
pnpm fmt
pnpm fmt:check
```

Do not add per-package lockfiles under `packages/*`; run package dependency changes from the root with pnpm workspace commands:

```sh
pnpm --filter <package-name> add <dep>
pnpm update
pnpm outdated -r
```

Use `pnpm update` to update dependencies across the workspace. Use `pnpm update --latest` only when intentionally moving package manifests past their current semver ranges.

## Packages

Local workspaces:

- `./packages/better-diff` — syntax-highlighted edit/write diff renderer
- `./packages/memory` — five-target memory system with qmd-backed search
- `./packages/pi-core` — shared primitives used by local pi extensions and packages
- `./packages/slack` — native Slack tools and background conversation loop
- `./packages/term` — named terminal workspace backed by zellij
- `./packages/todos` — file-backed todo manager and selector

Loaded via `settings.json`:

- `./packages/better-diff`
- `./packages/memory`
- `./packages/slack` with `extensions: []`, so the package is installed but its extension resources are filtered out by default
- `./packages/term`
- `./packages/todos`
- `git:github.com/ocodista/pi-token-bloat`
- `git:github.com/nicobailon/pi-subagents`
- `git:github.com/nicobailon/pi-mcp-adapter`
- `git:github.com/HazAT/pi-ghostty`
- `git:github.com/championswimmer/pi-cache-graph`

`pi-core` is a workspace dependency, not a pi-loaded package. Use `pi config` or edit `settings.json` to re-enable the Slack package resources when you actually want them.

## Plugins

`.claude-plugin/marketplace.json` is a local Claude Code marketplace index. It points at plugin bundles under `plugins/`; it is not a pi extension loader.

- `plugins/zig` — canonical Zig development bundle: skills, commands, and agents for Zig 0.15 / Tiger Style work.
- `plugins/lsp` — Claude Code LSP configuration bundle.
