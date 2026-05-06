# Plugins

This directory contains Claude Code plugin bundles.

The root `.claude-plugin/marketplace.json` file is the local marketplace index. It points Claude Code at plugin directories under `plugins/`.

Plugins are distribution units, not pi extensions. A plugin may contain skills, slash commands, agents, LSP configuration, MCP configuration, or other Claude Code plugin metadata. Runtime code that calls the pi extension API belongs in `extensions/`, not here.

Current plugins:

- `zig/` — canonical Zig development bundle. Owns Zig 0.15 and Tiger Style skills plus Zig commands and agents.
- `lsp/` — Claude Code LSP settings.
