# AGENTS.md

This directory is a personal `pi` config/workbench. Treat it like an experimental but intentional codebase: small, readable changes, minimal ceremony, and no cargo-cult scaffolding.

## What lives here

- `extensions/`: custom pi extensions and tools, mostly TypeScript.
- `themes/`: local theme definitions.
- `skills/`: local skills and skill development scratch space.
- `APPEND_SYSTEM.md`: extra system-style behavior and tone guidance.
- `flake.nix`: the dev shell. Prefer it over installing random stuff globally.

Ignore generated or runtime state unless a task explicitly targets it:

- `node_modules/`
- `sessions/`
- `.direnv/`
- `auth.json`

## Working style

Default to editing the smallest thing that works. This repo is for shaping a personal environment, not building an enterprise sadness machine.

Preserve existing style:

- TypeScript is straightforward, functional, and light on abstraction.
- Prefer obvious code over framework-y cleverness.
- Keep extensions self-contained unless there is a real reuse win.
- Don’t add dependencies casually. The bar should be “this removes real complexity,” not “I felt like npm today.”

## Extensions

Extensions usually export a default function taking `ExtensionAPI` and register tools or hooks from there.

When adding or editing extensions:

- Prefer small single-purpose files.
- Keep tool schemas tight and descriptions useful.
- Return structured details when they help debugging, but don’t overdo it.
- Avoid hidden side effects on session start unless the behavior is clearly intentional.
- If enabling tools globally, be explicit about which tools and why.

## Commands

Use the dev shell from `flake.nix`. Inside it, the normal checks are:

```sh
npm run check
npm run lint
npm run fmt
npm run fmt:check
```

Run `npm run check` after TypeScript changes. Run formatting when touching extension code.

## File hygiene

Don’t edit generated/vendor/state directories unless the task is specifically about them.

Don’t commit noise from:

- `sessions/`
- `.direnv/`
- `node_modules/`

If a change would affect personal secrets or machine-local auth/config, stop and make that explicit first.

## Making changes

When implementing something new, bias toward:

1. extending an existing extension if it is genuinely the same concern,
2. otherwise creating a new focused extension,
3. only then introducing shared helpers.

Document non-obvious behavior inline, but keep comments sparse. Comments should explain why something exists, not narrate syntax everyone can already read.

## For future agents

Assume the owner knows what they want but is using this repo to iterate quickly. Be opinionated, keep things clean, and don’t “help” by broadening scope. Tight diffs win.
