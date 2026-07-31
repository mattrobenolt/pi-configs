---
name: just
description: "Write correct, idiomatic justfiles for just (the casey/just command runner). Use when creating, editing, or reviewing a justfile/Justfile, adding or refactoring recipes, splitting recipes into modules, or migrating Makefiles/npm scripts to just. Triggers on any task involving justfile, .just files, or just recipes. Verified against just 1.57; version-gated features are marked — check `just --version` before relying on them."
---

# Justfile Best Practices

just is a command runner, not a build system. No file targets, no mtimes, no incremental rebuilds, no `.PHONY`. Dependencies are recipes, deduplicated per invocation. If the task needs incremental artifact builds, use make/ninja/bazel instead of contorting just.

## Semantics You Will Get Wrong

### Every recipe line runs in its own shell

State never carries between lines — `cd`, variable assignments, and exports all die at end of line.

```just
# WRONG — terraform runs in the justfile dir, not infra/:
deploy:
    cd infra
    terraform apply

# RIGHT — chain, or use a shebang recipe for multi-step logic:
deploy:
    cd infra && terraform apply

plan:
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra
    terraform plan
```

Rule of thumb: more than ~3 lines of logic → shebang recipe (`#!/usr/bin/env bash` or python3) or `[script('bash')]`. Shebang recipes run as one process, so `set -euo pipefail`, loops, and case statements work normally. Always put `set -euo pipefail` at the top of multi-line bash bodies.

### Interpolation happens before the shell sees the line

`{{var}}` is substituted by just's parser; the shell receives the raw text. just never quotes for you.

```just
# WRONG — splits on whitespace, breaks on quotes in the value:
greet name:
    echo {{ name }}

# RIGHT:
greet name:
    echo "{{ name }}"
```

To emit literal `{{` for the shell (awk, helm, Go templates): `{{ "{{" }}` or `{{{{`.

### Top-level backticks and assignments run at parse time

`version := \`git describe --tags\`` shells out on EVERY just invocation — including `just --list` and recipes that never reference it. Same trap: `require("docker")` at file scope kills every invocation (even `--list`) on machines without docker.

- `set lazy` (1.47+) skips evaluating variables the invoked recipes don't use. Opt in on any justfile with backtick assignments.
- Or compute inside the recipe body where it belongs.
- Preconditions belong in a dependency recipe, not parse-time `require()`:

```just
_check-docker:
    @command -v docker >/dev/null || { echo "docker is required"; exit 1; }

deploy: _check-docker
    docker compose up -d
```

### Recipes run from the justfile's directory

`just` invoked from a subdirectory still executes recipes with cwd = justfile dir. For cwd-sensitive tools use `[no-cd]`, or take the caller's directory as a defaulted parameter:

```just
[no-cd]
fmt-here:
    prettier --write .

test module=invocation_directory():
    cargo test --manifest-path "{{ module }}/Cargo.toml"
```

### dotenv values are environment, not justfile variables

`set dotenv-load` exposes `.env` values to recipe shells and to `env("VAR")` — but NOT to `{{VAR}}` interpolation. The most common dotenv surprise.

```just
set dotenv-load

db_url := env("DATABASE_URL", "postgres://localhost/dev")

migrate:
    psql "{{ db_url }}" -f migrations.sql
```

### `set export` leaks everything

`set export` puts every justfile variable into every recipe's environment, including secrets. Prefer per-variable `export NAME := ...` or `$param` exported parameters. Never combine global `set export` with tokens or passwords.

### Variadic args are one space-joined string

`*args` / `+args` interpolate as a single joined string; `"$@"` does not work by default, so quoting is hopeless for paths with spaces. For real argv pass-through:

```just
set positional-arguments

test *args:
    cargo test "$@"
```

(or `[positional-arguments]` per-recipe, 1.29+)

### The default shell is weak

Default is `sh -cu`: POSIX only, no pipefail, no `-u`. Within one line, `cmd1 | cmd2` masks cmd1's failure, and unset variables expand to empty strings. Don't write bashisms in default-shell recipes. When bash is needed everywhere:

```just
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
```

Never `set shell := ["bash", "-c"]` — strictly worse than the default.

### OS-gated recipes silently no-op elsewhere

`[macos] release:` run on Linux exits 0 with no output and no error. Dispatch through a public wrapper with private per-OS implementations, or branch inside the body.

### `[confirm]` hangs in CI

A `[confirm]` recipe waits on stdin forever in non-interactive runs. CI invocations must pass `just --yes`. Attribute form with custom prompt: `[confirm("Deploy to production?")]`.

## Anatomy of a Good Justfile

```just
set minimum-version := "1.55.0" # 1.55+; pin when using newer features
set default-list # 1.52+; bare `just` lists recipes
set positional-arguments # "$@" works in recipe bodies
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Run the test suite
[group('test')]
test *args:
    cargo test "$@"

# Lint everything
[group('check')]
lint: (check "fmt") (check "clippy")

alias t := test
alias l := lint

[group('check')]
[private]
check what:
    cargo {{ what }}
```

Conventions that make justfiles discoverable:

- **Doc comment on every recipe.** The comment immediately above a recipe is its `just --list` entry — this is how people find things. `[doc('...')]` overrides it; `[doc]` suppresses it.
- **kebab-case names with verb prefixes** for families: `check-fmt`, `check-types`, `codegen-proto`. Prefixes sort together and group naturally.
- **`[group('name')]` on related recipes** so `--list` prints sections. Listing the same group twice on one recipe is a compile error as of 1.57.
- **Aliases immediately after the recipe** they point to (`alias t := test`), never in a separate section.
- **Private helpers** are `_`-prefixed AND marked `[private]`; both hide from `--list`. Keep them next to their callers.
- **Default behavior is a decision, never an accident.** Every justfile gets either a meaningful default (`default: lint test`) or `set default-list` so bare `just` prints the recipe listing. Never leave it to "first recipe in the file." The old `[private]` + `default: @just --list` wrapper is superseded — `default-list` does that job with no recipe and nothing to hide from the listing. Keep a wrapper only for a customized listing (e.g. `just --list --unsorted`).
- **Indent with 4 spaces**, run `just --fmt` (stable since 1.50; before that it needs `--unstable`). Enforce `just --fmt --check` in CI. The formatter canonicalizes more than whitespace: `{{ var }}` gets interior spaces, boolean settings collapse to bare form (`set default-list`, not `set default-list := true`), and stacked attributes are sorted. Write examples in that style so a fmt check stays clean.

## Structure at Scale

One justfile per project until it hurts, then split by domain:

```just
mod ci # ci.just or ci/mod.just next to the justfile; invoke as `just ci::check`
mod release

import? 'local.just' # optional per-developer overrides, gitignored
```

- `import?` (optional import) is the escape hatch for machine-local recipes. Plain `import` errors when the file is missing.
- Module directory names are case-sensitive on Linux even when macOS tolerates them — stick to lowercase.
- Recipes are deduplicated per invocation: `just test deploy` where both depend on `build` runs `build` once. `just test && just deploy` runs it twice (two invocations). Recursive `just recipe` calls inside a recipe body are new invocations — variables re-evaluate, deps re-run.

## Reach for Built-ins Before Shelling Out

just's functions work cross-platform; shell equivalents don't:

- Paths: `justfile_directory()`, `invocation_directory()`, `config_directory()`, path joins with `/` operator, `absolute_path()`, `canonicalize()`, `file_name()`, `parent_directory()`, `extension()`, `path_exists()`
- Env: `env("VAR", "default")`, `env_var("VAR")` (errors if unset), `env_var_or_default(...)`
- Strings: `quote()`, `replace()`, `trim()`, `lowercase()`/`uppercase()`, `kebabcase()`/`snakecase()`/`pascalcase()`, `split()`, `join()`
- System: `os()`, `arch()`, `num_cpus()`, `num_jobs()` (1.56+, empty unless `--jobs` passed), `shell("cmd")`
- Integrity: `sha256_file()`, `blake3_file()`
- Assertions in recipes: `{{ assert(path_exists("dist/") == "true", "run 'just build' first") }}`. The explicit comparison is required — `assert(some_function(...), ...)` without one errors out unless `set lists` (unstable) is enabled.
- Color constants (1.37+): `{{ RED }}`, `{{ GREEN }}`, `{{ BOLD }}`, `{{ NORMAL }}` etc. — no hand-rolled ANSI escapes.

## Features Worth Using (with versions)

- `set minimum-version := "1.x.y"` (1.55+) — place at the very top; turns "mystery parse error on old just" into a clear message.
- `[arg('name', long, short='n', pattern='...', help='...')]` (1.45–1.46+) — real flags/options on recipes; `just --usage recipe` (1.46+) prints generated help.
- `[parallel]` on a recipe — runs its dependencies concurrently; cap with `just --jobs N` (1.56+).
- `[script('python3')]` / `[script]` with `set script-interpreter` (1.33+) — multi-line recipes in any interpreter without shebang tempfiles.
- `set fallback` + `set ceiling := "path"` (1.43+) — walk up to parent justfiles in monorepos without leaking into sibling repos.
- Subsequent dependencies `recipe: dep && cleanup` — `cleanup` runs after `recipe` body. Useful for teardown.
- Recipe flags with fixed values: `[arg('force', long, value='--force')]` makes `--force` pass a literal — good for requiring explicit flags on dangerous recipes.
- Unstable: lists and `&&`/`||` expression operators need `set unstable` + `set lists` (1.53+). Fine for personal projects; pin just in CI when relying on anything unstable — there is no per-feature gate.

## Anti-Patterns

- Treating just like make: no file targets, no timestamp checking. A `build` recipe re-runs every time.
- No deliberate default: bare `just` running whatever recipe happens to be first. Always pick `default:` or `set default-list`.
- Giant one-line shell chains instead of a shebang recipe.
- `set export` + secrets at file scope.
- bashisms in default `sh -cu` recipes (`[[ ]]`, arrays, `pipefail` assumptions).
- Top-level backticks for values only one recipe needs (see parse-time trap).
- Hardcoded paths/values that belong in variables at the top or recipe parameters with defaults.
- Recipes with no doc comment — invisible in practice.

## Verify Before Shipping

```sh
just --fmt --check      # formatting (stable 1.50+)
just --list             # parses the whole file; also your discoverability check
just --evaluate         # inspect variable values without running anything
just --show recipe      # print a recipe's resolved body
just -n recipe          # dry run: print commands without executing
```

Run shellcheck on shebang/script recipe bodies. It doesn't understand `{{...}}` interpolation — expect false positives around interpolated values; don't contort recipes to silence them.

`just --version` first when editing an unfamiliar repo's justfile: if it uses version-gated features without a `minimum-version` pin, add one.
