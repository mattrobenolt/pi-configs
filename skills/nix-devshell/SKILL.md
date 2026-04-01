---
name: nix-devshell
description: Work within Nix flake-based devShells. Use when working in any project that has a flake.nix, when commands fail due to missing tools, when dependencies need to be added or removed, or when setting up a development environment. Triggers on flake.nix presence, missing command errors, or dependency management tasks. IMPORTANT — always prefer the devShell over installing tools globally or via pip/npm/brew.
---

# Nix DevShells

## Detecting Shell Status

Before running project commands, check if already inside a devShell:

```bash
echo $IN_NIX_SHELL
```

- If set (`pure` or `impure`): already in the shell, proceed normally.
- If empty: need to enter the shell first.

## Entering the DevShell

If not already in the shell and working in a project with `flake.nix`:

```bash
nix develop -c $SHELL
```

Or to run a single command within the shell without entering it:

```bash
nix develop -c <command>
```

Prefer `nix develop -c <command>` for one-off commands. Enter the shell interactively when multiple commands are needed.

## Missing Tools

When a command is not found or a tool is missing, **do not** install it via `brew`, `pip`, `npm -g`, `cargo install`, `go install`, or any other global package manager. Instead:

1. Check if a `flake.nix` exists in the project.
2. If yes, add the tool to the devShell's `packages` list.
3. Run `nix develop` to get the updated shell.

Example — adding `jq` to a devShell:

```nix
packages = with pkgs; [
  # ... existing packages
  jq  # added
];
```

Then re-enter the shell or run `nix develop -c <command>`.

## Modifying the DevShell

All devShells use `flake.nix` with `pkgs.mkShell`. The key sections:

- **`packages`** — CLI tools and programs available in the shell (equivalent to `nativeBuildInputs`)
- **`buildInputs`** — libraries needed for compilation/linking (headers, shared libs)
- **`shellHook`** — shell commands run on entry (env vars, PATH manipulation)

### Platform-Specific Packages

Use `lib.optionals` for platform-specific packages:

```nix
packages = with pkgs; [
  # common packages
  go
]
++ lib.optionals stdenv.isLinux [
  gdb
  perf
]
++ lib.optionals stdenv.isDarwin [
  tracy
];
```

All devShells must work on both macOS and Linux (nixOS).

### Finding Package Names

Search for available packages:

```bash
nix search nixpkgs <query>
```

## Updating Flake Inputs

NEVER run `nix flake update` — it updates all inputs and forces full rebuilds. Only update what changed:

```bash
nix flake lock --update-input <input-name>
```

To restore a specific input to its previous pin and only update one:
```bash
git checkout main -- flake.lock
nix flake lock --update-input planetscale
```

## flake-parts (PlanetScale Standard)

All PlanetScale projects use `flake-parts` with `planetscale/nix-devshell` modules. See [references/flake-parts.md](references/flake-parts.md) for:
- Standard consumer flake structure
- Available modules (base, go, zig, queryPath)
- Composition patterns, input conventions, version overrides
- Multiple shells, allowUnfree, lock file discipline

## Key Rules

- The devShell is the **sole** source of development dependencies. Never work around it.
- If a tool would be helpful, add it to the devShell — that's the whole point.
- Never use `pip install`, `npm install -g`, `brew install`, etc. for project tooling.
- When adding packages, run `nix develop` again to pick up changes.
- If `flake.lock` changes, commit it alongside the `flake.nix` changes.
