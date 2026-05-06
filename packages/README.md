# Packages

This directory contains local package-shaped code loaded by pi.

Use this for code that behaves like an installable package or local fork: its own `package.json`, tests, changelog, README, and source tree. Keep one-off personal pi extensions in `extensions/` instead.

Packages are managed through npm workspaces from the repo root. Keep dependencies in each package's `package.json`, but let the root `package-lock.json` own the resolved dependency graph.

Useful commands:

```sh
npm install <dep> --workspace=<package-name>
npm run check --workspaces --if-present
npm update --workspaces
npm outdated --workspaces
```

Current packages:

- `better-diff/` — syntax-highlighted edit/write diff renderer.
- `memory/` — five-target memory system with qmd-backed search.
- `slack/` — native Slack tools and background conversation loop. Kept installed, but filtered out by default in `settings.json`.
- `term/` — named terminal workspace backed by zellij.
- `todos/` — file-backed todo manager and selector.
