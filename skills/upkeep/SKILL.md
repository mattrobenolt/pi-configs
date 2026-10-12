---
name: upkeep
description: "Update a project's full dependency surface in one pass: lockfile deps, toolchains, flake inputs, CI version pins, and GitHub Actions SHAs. Use when asked to update or bump dependencies, refresh flake inputs, update the Go/Rust/Node toolchain, run an explicit Zig toolchain upgrade, pin or refresh GitHub Actions, update OpenTofu providers or modules, or run routine upkeep/maintenance on a project. First-class: Zig 0.16 build.zig.zon, Go (deps and the go directive/toolchain), Nix flakes, Rust, Python (uv), JavaScript (npm/pnpm/bun), OpenTofu (providers and modules), plus a generic table for other package managers. Nix-first: the devShell flake provides every tool and toolchain. Add missing tools to the devShell, never install globally."
---

# Upkeep

Update the whole dependency surface of one project in one pass: lockfiles, toolchains, flake inputs, CI pins, GitHub Actions, and hook repos. A run ends with the project current, verified, and reported. Default scope is everything the inventory finds.

Core doctrine: **Nix decides, every other surface syncs.** The devShell flake is the only place a toolchain version is chosen. `go.mod`, CI files, and version files mirror what the devShell provides.

## Rules

- Update within existing semver ranges by default. Minor and patch only.
- Treat a major bump or an edition bump as a decision. Make it only on request or with clear intent in the repo. Otherwise list it under Needs decision.
- Zig toolchains are always pinned. The devShell uses a versioned nixpkgs attr (`zig_0_16`), never the floating `zig` package. A flake update moves Zig within the pinned minor only. Patch releases (0.16.0 to 0.16.1) are safe.
- Routine upkeep never jumps a Zig minor. Zig 0.x minors break code by design. A 0.16 to 0.17 move is a dedicated, explicit upgrade, run only on owner request.
- If a project uses the floating `zig` attr, flag it under Needs decision. Do not switch the attr uninvited.
- Never hand-edit a lockfile or a computed hash.
- Nothing is done until the verify gate passes.

## Environment: Nix provides every tool

- Run all commands inside `nix develop -c <command>`.
- If a tool is missing from the devShell (pinact, cargo-edit, govulncheck), add it to the devShell packages in flake.nix. For a one-shot, use `nix run nixpkgs#<tool>`.
- Never install tools with `go install`, `cargo install`, `npm i -g`, or Homebrew.
- If the project has no flake, flag it in the report. Do not create one uninvited.

## Core loop

1. Inventory every manifest, lockfile, and version pin. Record the tool versions the devShell provides.
2. Update the flake first. Toolchain versions move with it.
3. Update dependencies, one ecosystem at a time.
4. Sync every version pin to the devShell toolchains.
5. Pin and refresh GitHub Actions with pinact.
6. Run the verify gate inside `nix develop`.
7. Commit by concern, then write the report.

The flake update moves the devShell toolchains. Dependencies must compile against the final toolchain, not the old one. The gate runs once, at the end, against the final state.

### Inventory map

| File | Ecosystem |
| --- | --- |
| `go.mod` | Go |
| `build.zig.zon` | Zig |
| `flake.nix` / `flake.lock` | Nix |
| `Cargo.toml` + `Cargo.lock` | Rust |
| `package.json` + `package-lock.json` / `pnpm-lock.yaml` / `bun.lockb` | npm / pnpm / bun |
| `pyproject.toml` + `uv.lock` | Python (uv) |
| `requirements*.txt` with pip-tools header | Python (pip-tools) |
| `pyproject.toml` + `poetry.lock` | Python (Poetry) |
| `Gemfile` + `Gemfile.lock` | Ruby |
| `Package.swift` | Swift |
| `*.tf` / `*.tf.json` | OpenTofu (modules and constraints) |
| `.terraform.lock.hcl` | OpenTofu providers lock |
| `.github/workflows/*` | Actions (pinact + version keys) |

Also grep for version pins: `.nvmrc`, `.python-version`, `rust-toolchain.toml`, `Dockerfile`, and CI matrices.

## Runbook: Nix first

- Update all inputs: `nix flake update`. Update one input: `nix flake update nixpkgs`.
- Before you commit, read `git diff flake.lock`. Note which toolchain versions moved.
- Compare tool versions before and after: `nix develop -c sh -c 'zig version; go version; rustc --version; node --version'` (run only those present).
- The lock moves within each input's pinned ref. `nixpkgs-unstable` stays unstable. A move to a release branch is a flake.nix edit and a decision. Report it, do not do it silently.
- If the project wires checks, also run `nix flake check`.

## Runbook: Go

- Preview: `go list -m -u all`.
- Update within majors: `go get -u ./...`, then `go mod tidy`.
- Go version: read the devShell version with `go version`. Set the `go` directive to that minor: `go get go@1.<minor>`. Move the toolchain line with `go get toolchain@latest`.
- GOTOOLCHAIN auto-downloads what `go.mod` requires, so the directive is the real pin. CI `setup-go` must mirror it anyway.
- A major dep bump changes the module path with a `/vN` suffix and rewrites imports. Make it only as an explicit decision.
- Run `govulncheck ./...` when the devShell has it.
- Gate fallbacks: `go build ./... && go test ./...`.

## Runbook: Zig 0.16

- Deps live in `.dependencies` in `build.zig.zon`. Each entry has `.url` and `.hash`, or `.path` for local deps. No `.version` field exists on deps. The version lives in the tarball URL.
- Update one dep: `zig fetch --save=<name> <tarball-url>`. This overwrites the entry and rewrites both url and hash (verified on 0.16.0).
- Find the new tag: `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name`. Build the URL as `https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz`.
- Update many deps: edit each `.url`, delete each stale `.hash`, then run `zig build --fetch`. It downloads all deps in one pass and writes the missing hashes.
- Use tag tarballs only. A branch tarball serves mutable content under a fixed URL.
- Never touch `.fingerprint` (0.16 package identity) and never hand-write `.hash`.
- Toolchain: routine upkeep moves the pinned minor (`zig_0_16`) through nixpkgs patch releases only. Sync CI `zig-version:` keys to the pinned compiler version.
- Raise `.minimum_zig_version` only when the code requires newer std.
- On an owner-requested Zig upgrade, read the release notes first. Follow the zig skill (`../zig/SKILL.md`) for the port.
- Gate fallbacks: `zig build` and `zig build test`, plus the project's non-default build flags. Lazy analysis hides broken dead branches.

## Runbook: Rust

- `cargo update` stays within Cargo.toml ranges and touches Cargo.lock only. This is the default action.
- `cargo upgrade` bumps manifest ranges. It needs cargo-edit from nixpkgs. `--incompatible` crosses majors, so run it only as an explicit decision.
- Toolchain: sync `rust-toolchain.toml` to the devShell rustc. Treat `rust-version` (MSRV) as a promise to users. Raise it deliberately, never as routine sync.
- Edition bumps are migrations, not upkeep. Never touch them here.
- Gate fallbacks: `cargo build && cargo test`. Add `cargo clippy` and `cargo fmt --check` when the project uses them.

## Runbook: JavaScript

| PM | Preview | Update in range | Major (explicit) |
| --- | --- | --- | --- |
| pnpm | `pnpm outdated -r` | `pnpm update -r` | `pnpm update -r <pkg>@<range>` |
| npm | `npm outdated` | `npm update` | `npm install <pkg>@<version>` |
| bun | `bun outdated` | `bun update` | `bun update --latest` |

- Commit `package.json` and the lockfile together.
- On peer conflicts, report and stop. Never pass `--force` or `--legacy-peer-deps`.
- Node surfaces: `.nvmrc`, `engines.node`, CI `node-version:`, devShell `nodejs`. Sync them to the devShell major.

## Runbook: GitHub Actions

- Pin unpinned actions: `pinact run` (full-length SHA plus a `# vX.Y.Z` comment).
- Refresh pinned actions: `pinact run --update`.
- Verify: `pinact run --check --verify-comment`. Add `--no-api` for an offline syntactic check.
- Export `GITHUB_TOKEN` first. pinact resolves tags via the API and rate limits otherwise.
- One-shot: `nix run nixpkgs#pinact -- run --update`. If upkeep recurs on the project, add pinact to the devShell.
- After pinact, sync workflow tool keys (`setup-go`, `node-version`, `zig-version`, rust toolchain) to the devShell versions.

## Runbook: Python (uv)

- Preview: `uv lock --upgrade --dry-run`.
- Update within constraints: `uv lock --upgrade`, then `uv sync`.
- One package: `uv lock --upgrade-package <name>`.
- A major bump needs a new constraint in pyproject.toml. Edit the constraint, then run `uv lock --upgrade-package <name>`. Explicit decision only.
- Python version: the devShell interpreter owns it. Sync `.python-version` to the devShell minor. `uv python pin <minor>` writes the file.
- Treat `requires-python` as a promise to users. Raise the lower bound deliberately, never as routine sync.
- The devShell provides the interpreter and the uv binary. Never run `uv python install` or `uv self update`.

## Runbook: OpenTofu

- Only `tofu`. Never run the `terraform` CLI. The devShell provides opentofu.
- Two dep surfaces, different mechanics:
- Providers: constraints in `required_providers`, versions locked in `.terraform.lock.hcl`. `tofu init -upgrade` moves within constraints and rewrites the lock. Commit the lock.
- Modules: pins sit in the `.tf` files themselves. Edit `ref=vX.Y.Z` on git sources or the `version =` attribute on registry modules. No module lockfile exists.
- Latest registry module version: `curl -s https://registry.opentofu.org/v1/modules/<ns>/<name>/<provider>/versions | jq -r '.modules[0].versions[0].version'`.
- Latest git module tag: `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name`.
- After a module pin edit, run `tofu init` to refresh modules.
- A major bump edits the provider constraint or the module pin. Explicit decision only.
- Tofu version: the devShell opentofu owns it. Sync `required_version` to the devShell minor.
- Gate fallbacks: `tofu init -upgrade && tofu validate`. Run `tofu test` when `*.tftest.hcl` exists. `tofu plan` needs state and credentials. Run it when both are present, otherwise report.

## Other ecosystems

| Ecosystem | Update in range | Notes |
| --- | --- | --- |
| pip-tools | `pip-compile --upgrade` | one command per requirements file |
| Poetry | `poetry update` | majors via explicit `poetry update <pkg>` in pyproject |
| Bundler | `bundle update` | `--conservative` holds shared deps |
| Swift PM | `swift package update` | majors change manifest API, decide first |

Anything not listed: find the lockfile, find its conservative update command, then run it. If you cannot identify the command with confidence, report it instead of guessing.

## Version pin surfaces

| Toolchain | Surfaces (sync to devShell) |
| --- | --- |
| Go | `go`/`toolchain` directives, CI `setup-go` |
| Zig | CI `zig-version`, zon `.minimum_zig_version` (raise only on need). The pinned attr (`zig_0_16`) owns the minor |
| Rust | `rust-toolchain.toml`. `rust-version` moves only deliberately |
| Node | `.nvmrc`, `engines.node`, CI `node-version` |
| Python | `.python-version` (write with `uv python pin`), `requires-python` lower bound is deliberate |
| OpenTofu | `ref=`/`version=` module pins, `required_providers` constraints, `required_version` syncs to the devShell minor |
| Any | Dockerfile base images |

Dockerfile base-image bumps count only when a build gate can verify them.

## Verify gate

1. Read the project's own instructions first: `AGENTS.md`, `CONTRIBUTING.md`, `justfile`, `Makefile`. Use its check command when one exists.
2. Run it inside `nix develop -c ...`.
3. Fallbacks: Go `go build ./... && go test ./...`. Zig `zig build && zig build test`. Rust `cargo test`. Python `uv sync && uv run pytest`. JS `pnpm test` / `npm test` / `bun test`. OpenTofu `tofu init -upgrade && tofu validate`. Nix `nix flake check`.
4. On failure: fix the fallout, or revert that bump and file it under Held back.

## Commits

- One commit per concern: flake and toolchains, deps per ecosystem, CI and pinact.
- Split commits keep every bump revertable in isolation.
- Follow the repo convention when it documents one.

## Automation coexistence

- If Renovate or Dependabot config exists, read it before you touch anything. Respect its pins, holds, and constraints.
- Upkeep covers what the bots miss: toolchain surfaces, pinact SHAs, devShell sync.

## Report

Three sections, always:

- **Updated** — every item, with from and to versions.
- **Held back** — item plus reason.
- **Needs decision** — majors, nixpkgs branch moves, EOL versions, peer conflicts, Zig minor jumps, floating `zig` attrs.
