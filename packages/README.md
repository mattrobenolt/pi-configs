# Packages

This directory contains local package-shaped code loaded by pi.

Use this for code that behaves like an installable package or local fork: its own `package.json`, tests, changelog, README, and source tree. Keep one-off personal pi extensions in `extensions/` instead.

Packages are managed through pnpm workspaces from the repo root. Keep dependencies in each package's `package.json`, but let the root `pnpm-lock.yaml` own the resolved dependency graph.

Useful commands:

```sh
pnpm add <dep> --filter <package-name>
pnpm -r --if-present check
pnpm update -r
pnpm outdated -r
```

Current packages:

- `better-diff/` — syntax-highlighted edit/write diff renderer.
- `memory/` — five-target memory system with qmd-backed search.
- `notion/` — Notion tools for reading pages and databases. Extracts token from macOS Keychain automatically.
- `pi-core/` — shared utilities used by other packages (tool output, file helpers, context, preview).
- `slack/` — native Slack tools and background conversation loop. Kept installed, but filtered out by default in `settings.json`.
- `term/` — named terminal workspace backed by zellij.
- `todos/` — file-backed todo manager and selector.
- `webfetch/` — web fetch and search tools. See `webfetch/README.md` for full docs.
