# flake-parts Patterns at PlanetScale

## Standard Consumer Flake Structure

All new projects use flake-parts with `planetscale/nix-devshell` modules. The canonical minimal flake:

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.follows = "planetscale/flake-parts";
    planetscale = {
      url = "github:planetscale/nix-devshell";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = with inputs.planetscale.flakeModules; [
        base
        go   # if Go project
        zig  # if Zig project
      ];

      perSystem =
        { pkgs, config, ... }:
        {
          devShells.default = pkgs.mkShell {
            inputsFrom = with config.devShells; [
              base
              go
              zig
            ];

            packages = with pkgs; [ just postgresql ];  # project-specific extras
          };
        };
    };
}
```

## Available nix-devshell Modules

- `base` — company-wide tools (awscli2, git, jq, ripgrep, fd, gnumake, gcloud, ps-toolbox PATH). Sets supported `systems` via `mkDefault`.
- `go` — go-bin_1_26 (mattware), gopls, golangci-lint, gotestsum. Package overridable via `nix-devshell.go.package`.
- `zig` — zig_0_15, zls_0_15 (nixpkgs), ziglint, zigdoc (mattware). Package overridable via `nix-devshell.zig.package`.
- `queryPath` — base + just (team module).

## Composition Pattern

`imports` and `inputsFrom` always mirror each other — this is intentional. They serve different purposes:
- `imports` — brings module definitions into scope (defines `devShells.base`, `devShells.go`, etc.)
- `inputsFrom` — merges those shells' packages into `devShells.default`

## Supported Systems

`base` module sets these via `lib.mkDefault` (consumers can override):
```nix
[ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ]
```

x86_64-darwin is NOT supported. Linux-only projects override:
```nix
systems = [ "x86_64-linux" "aarch64-linux" ];
```

## Input Conventions

- `nixpkgs` — each project pins independently (do NOT follow from planetscale — too restrictive)
- `flake-parts` — always follow from planetscale: `flake-parts.follows = "planetscale/flake-parts"`
- `planetscale.inputs.nixpkgs.follows = "nixpkgs"` — always set so planetscale uses the project's nixpkgs

## Overriding Go/Zig Version

Access mattware transitively through the planetscale input:

```nix
perSystem = { system, ... }:
  let
    mattware = inputs.planetscale.inputs.mattware.packages.${system};
  in
  {
    nix-devshell.go.package = mattware.go-bin_1_24;
  };
```

## allowUnfree

Set via `_module.args.pkgs` in `perSystem`:

```nix
perSystem = { system, ... }: {
  _module.args.pkgs = import inputs.nixpkgs {
    inherit system;
    config.allowUnfree = true;
  };
};
```

## Multiple Shells (e.g. ci + default)

When multiple shells share env vars / shellHook, use a `let` binding — `inputsFrom` does NOT propagate env vars or shellHooks:

```nix
let
  mkDevShell = packages: pkgs.mkShell {
    inputsFrom = with config.devShells; [ base go zig ];
    inherit packages;
    GOEXPERIMENT = "jsonv2";
    shellHook = ''export PATH="$PWD/bin:$PATH"'';
  };
in
{
  devShells.ci = mkDevShell (with pkgs; [ gotestsum shellcheck ]);
  devShells.default = mkDevShell (with pkgs; [ etcd_3_6 gh nodejs_25 ]);
}
```

## Lock File Discipline

NEVER run `nix flake update` (updates all inputs, forces full rebuilds). Only update what changed:

```bash
nix flake lock --update-input planetscale
```

To restore a specific input to its previous pin and only update one:
```bash
git checkout main -- flake.lock
nix flake lock --update-input planetscale
```

## Nix Style Preferences

- Use `with pkgs;` for package lists
- Use `with inputs.planetscale.flakeModules;` for imports
- Use `with config.devShells;` for inputsFrom
- Use `let` bindings to eliminate repeated prefixes
- Avoid `inherit (inputs) mattware` — access transitively via `inputs.planetscale.inputs.mattware`
